// =============================================================================
// Stickman Fight 2D: procedural audio engine
//
// All sound is synthesized at runtime with the WebAudio API. There are no
// samples and no libraries. The module has two halves:
//
//   1. SFX: every effect is a small "patch" of layered oscillators, filtered
//      noise, FM pairs and envelopes, built with the `Voice` helper below.
//      Each patch is a function `(ac, dest, when, opts)` that can render into
//      ANY BaseAudioContext, including an OfflineAudioContext for tests.
//   2. Music: a 16th-note step sequencer that drives synthesized instruments,
//      scheduled with the standard lookahead technique.
//
// Signal chain (live):
//
//   sfx voices ──► sfxBus ◄── sfx reverb return
//        └──────► sfx reverb send ──┘
//   music racks ─► musicIn ─► pause lowpass ─► pause duck ─► musicBus ─┐
//   sfxBus ─────────────────────────────────────────────────────────────┼► master ─► limiter ─► out
//
// The module is import-safe in Node: nothing touches `window` or creates an
// AudioContext until `audio.unlock()` is called.
// =============================================================================

const HAS_WINDOW = typeof window !== 'undefined';
const TINY = 0.0001; // "silence" target for exponential ramps (-80 dB)
const MUSIC_BUS_LEVEL = 0.55; // music sits under the SFX
const PAUSE_DUCK = 0.35;
const SFX_BURST_WINDOW = 0.04; // seconds
const SFX_BURST_MAX = 4; // same-name plays allowed inside the window
const MAX_VOICES = 32;
const GLUE_DRIVE = 2.2; // tanh drive of the per-voice soft limiter

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Small fast seeded PRNG, returns a function producing floats in [0, 1). */
function mulberry32(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash01 = (n) => mulberry32(n)();

// =============================================================================
// Shared buffers (cached per context): noise, reverb impulses, shaper curves
// =============================================================================

const ctxCaches = new WeakMap();
function cacheFor(ac) {
  let c = ctxCaches.get(ac);
  if (!c) {
    c = new Map();
    ctxCaches.set(ac, c);
  }
  return c;
}

/**
 * 2 s mono looping noise buffer, built once per context:
 * 'white' | 'pink' | 'brown' | 'hiss' (white noise high-passed around 6 kHz,
 * so hats and cymbals need no per-hit filter nodes).
 */
function noiseBuffer(ac, kind = 'white') {
  const cache = cacheFor(ac);
  const key = 'noise:' + kind;
  if (cache.has(key)) return cache.get(key);
  const sr = ac.sampleRate;
  const len = Math.floor(sr * 2);
  const buf = ac.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const rng = mulberry32({ white: 101, pink: 202, brown: 303, hiss: 404 }[kind] || 505);
  if (kind === 'pink') {
    // Paul Kellet's refined pink filter
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = rng() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  } else if (kind === 'brown') {
    // leaky integrator, then a DC blocker so envelopes never pick up an offset
    let last = 0, x1 = 0, y1 = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (rng() * 2 - 1)) / 1.02;
      y1 = last - x1 + 0.997 * y1;
      x1 = last;
      d[i] = y1;
    }
    // make the loop seamless: tilt so the end meets the start, then re-center
    const seam = d[len - 1] - d[0];
    let mean = 0;
    for (let i = 0; i < len; i++) {
      d[i] -= seam * (i / (len - 1));
      mean += d[i] / len;
    }
    for (let i = 0; i < len; i++) d[i] -= mean;
  } else if (kind === 'hiss') {
    // two cascaded one-pole high-passes at ~6 kHz
    const rc = 1 / (2 * Math.PI * 6000);
    const k = rc / (rc + 1 / sr);
    let x1 = 0, y1 = 0, y2 = 0, z1 = 0;
    for (let i = 0; i < len; i++) {
      const x = rng() * 2 - 1;
      y1 = k * (y1 + x - x1);
      x1 = x;
      const y = k * (z1 + y1 - y2);
      y2 = y1;
      z1 = y;
      d[i] = y;
    }
  } else {
    for (let i = 0; i < len; i++) d[i] = rng() * 2 - 1;
  }
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
  const k = 0.98 / (peak || 1);
  for (let i = 0; i < len; i++) d[i] *= k;
  cache.set(key, buf);
  return buf;
}

/**
 * Algorithmic reverb impulse: decorrelated stereo noise with a power-law decay
 * and progressive damping (the tail gets darker as it fades, like a real room).
 */
function impulse(ac, seconds, decay) {
  const cache = cacheFor(ac);
  const key = `ir:${seconds}:${decay}`;
  if (cache.has(key)) return cache.get(key);
  const sr = ac.sampleRate;
  const len = Math.max(2, Math.floor(sr * seconds));
  const pre = Math.floor(sr * 0.012);
  const fadeIn = Math.floor(sr * 0.004);
  const buf = ac.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const rng = mulberry32(9001 + ch * 7919);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const x = (i - pre) / (len - pre);
      const k = 0.08 + 0.8 * x; // one-pole damping coefficient grows over time
      lp = lp * k + (rng() * 2 - 1) * (1 - k);
      const fi = i - pre < fadeIn ? (i - pre) / fadeIn : 1;
      d[i] = lp * Math.pow(1 - x, decay) * fi;
    }
  }
  cache.set(key, buf);
  return buf;
}

/** Builds a send-reverb (input gain -> highpass -> convolver -> return gain -> dest). */
function makeReverb(ac, dest, seconds, decay, ret) {
  const input = ac.createGain();
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 180;
  const conv = ac.createConvolver();
  conv.buffer = impulse(ac, seconds, decay);
  const out = ac.createGain();
  out.gain.value = ret;
  input.connect(hp);
  hp.connect(conv);
  conv.connect(out);
  out.connect(dest);
  return { input, nodes: [input, hp, conv, out] };
}

/**
 * 0.5 s of six detuned square waves (the classic 808 cymbal cluster), rendered
 * once per context so metallic percussion costs one buffer source per hit.
 * Base pitch METAL_F0; retune with playbackRate.
 */
const METAL_F0 = 540;
function metalBuffer(ac) {
  const cache = cacheFor(ac);
  if (cache.has('metal')) return cache.get('metal');
  const sr = ac.sampleRate;
  const len = Math.floor(sr * 0.5);
  const buf = ac.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const ratios = [1, 1.342, 1.2312, 1.6532, 1.9523, 2.1523];
  for (let i = 0; i < len; i++) {
    let x = 0;
    for (const k of ratios) x += (i * METAL_F0 * k / sr) % 1 < 0.5 ? 1 : -1;
    d[i] = x / ratios.length;
  }
  cache.set('metal', buf);
  return buf;
}

const curveCache = new Map();
/** Soft-saturation (tanh) waveshaper curve; `k` is the drive. */
function satCurve(k) {
  const key = Math.round(k * 10) / 10;
  if (curveCache.has(key)) return curveCache.get(key);
  const n = 2048;
  const c = new Float32Array(n);
  const norm = Math.tanh(key) || 1;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = key < 0.05 ? x : Math.tanh(key * x) / norm;
  }
  curveCache.set(key, c);
  return c;
}

// =============================================================================
// Voice: a tiny patch builder. Tracks every node it creates, schedules
// everything relative to `t`, and disposes the whole graph when the
// last-ending source fires `ended`.
// =============================================================================

class Voice {
  constructor(ac, dest, when, opts = {}) {
    this.ac = ac;
    this.dest = dest;
    this.t = when;
    this.p = opts.pitch || 1; // pitch multiplier applied by the composite layers
    this.rev = opts.reverb || null; // reverb send input (optional)
    this.dly = opts.delay || null; // delay send input (optional, used by music)
    this.nyq = ac.sampleRate / 2;
    this.nodes = [];
    this.srcs = [];
    this.end = when;
    this.last = null;
    this.disposed = false;
    this.os = opts.oversample || '2x'; // waveshaper oversampling ('none' for music voices)
  }

  // -- node factories ---------------------------------------------------------

  reg(n) {
    this.nodes.push(n);
    return n;
  }

  hz(f) {
    return clamp(f, 0.01, this.nyq * 0.98);
  }

  fz(f) {
    return clamp(f, 10, this.nyq * 0.95);
  }

  chain(a, b) {
    a.connect(b);
    return b;
  }

  gain(v = 1) {
    const g = this.reg(this.ac.createGain());
    g.gain.value = v;
    return g;
  }

  filter(type, f, q = 0.707, gainDb = 0) {
    const n = this.reg(this.ac.createBiquadFilter());
    n.type = type;
    n.frequency.value = this.fz(f);
    n.Q.value = q;
    if (gainDb) n.gain.value = gainDb;
    return n;
  }

  shaper(k) {
    const n = this.reg(this.ac.createWaveShaper());
    n.curve = satCurve(k);
    n.oversample = this.os;
    return n;
  }

  _play(src, s, e, offset) {
    if (offset !== undefined) src.start(s, offset);
    else src.start(s);
    src.stop(e);
    this.srcs.push(src);
    if (e >= this.end) {
      this.end = e;
      this.last = src;
    }
    return src;
  }

  /** Raw oscillator (no pitch multiplier) with an optional exponential glide. */
  osc(type, f, at, dur, f2 = 0, glide = 0) {
    const o = this.reg(this.ac.createOscillator());
    o.type = type;
    const s = this.t + at;
    o.frequency.setValueAtTime(this.hz(f), s);
    if (f2) o.frequency.exponentialRampToValueAtTime(this.hz(f2), s + Math.max(0.001, glide));
    return this._play(o, s, s + dur);
  }

  /** Looping noise source from the cached buffer, started at a random offset. */
  noise(kind, at, dur) {
    const src = this.reg(this.ac.createBufferSource());
    const buf = noiseBuffer(this.ac, kind || 'white');
    src.buffer = buf;
    src.loop = true;
    const s = this.t + at;
    return this._play(src, s, s + dur, Math.random() * (buf.duration - 0.05));
  }

  /** LFO routed into an AudioParam. Optional rate ramp to `rate2` over `dur`. */
  lfo(param, rate, depth, at, dur, type = 'sine', rate2 = 0) {
    const o = this.osc(type, rate, at, dur, rate2, dur);
    const g = this.gain(depth);
    o.connect(g);
    g.connect(param);
    return { osc: o, gain: g };
  }

  // -- envelopes ---------------------------------------------------------------

  /** Attack / hold / exponential decay. `curve: 'exp'` gives a swelling attack. */
  env(param, at, a, h, d, peak, curve) {
    const s = this.t + at;
    const pk = Math.max(peak, TINY * 2);
    const a2 = Math.max(0.0005, a);
    if (curve === 'exp') {
      param.setValueAtTime(TINY, s);
      param.exponentialRampToValueAtTime(pk, s + a2);
    } else {
      param.setValueAtTime(0, s);
      param.linearRampToValueAtTime(pk, s + a2);
    }
    if (h > 0) param.setValueAtTime(pk, s + a2 + h);
    param.exponentialRampToValueAtTime(TINY, s + a2 + h + Math.max(0.002, d));
  }

  /** ADSR for sustained notes. Sources must run until `len + rel * 1.3`. */
  adsr(param, at, a, d, sus, rel, len, peak) {
    const s = this.t + at;
    const a2 = Math.max(0.001, a);
    param.setValueAtTime(0, s);
    param.linearRampToValueAtTime(peak, s + a2);
    if (sus < 1) param.setTargetAtTime(peak * sus, s + a2, Math.max(0.005, d / 3));
    param.setTargetAtTime(0, s + Math.max(len, a2), Math.max(0.005, rel / 5));
  }

  /** Exponential frequency sweep f -> f2 (over glide) -> f3 (by `end`). */
  sweep(param, at, f, f2, glide, f3, end) {
    const s = this.t + at;
    param.setValueAtTime(this.fz(f), s);
    param.exponentialRampToValueAtTime(this.fz(f2), s + Math.max(0.002, glide));
    if (f3) param.exponentialRampToValueAtTime(this.fz(f3), s + Math.max(glide + 0.005, end));
  }

  // -- routing ------------------------------------------------------------------

  /** Connects a layer to the voice output, with optional pan and send levels. */
  out(node, o = {}) {
    let n = node;
    if (o.pan && this.ac.createStereoPanner) {
      const p = this.reg(this.ac.createStereoPanner());
      p.pan.value = clamp(o.pan, -1, 1);
      n.connect(p);
      n = p;
    }
    n.connect(this.dest);
    if (o.send && this.rev) n.connect(this.chain(this.gain(o.send), this.rev));
    if (o.dly && this.dly) n.connect(this.chain(this.gain(o.dly), this.dly));
  }

  /** Serial filter chain from a spec `{type, f, f2, glide, f3, q, gain}` or an array of them. */
  filters(n, spec, at, len) {
    let last = n;
    for (const fs of Array.isArray(spec) ? spec : [spec]) {
      const bq = this.filter(fs.type || 'lowpass', fs.f * this.p, fs.q ?? 0.707, fs.gain || 0);
      if (fs.f2) {
        this.sweep(bq.frequency, at, fs.f * this.p, fs.f2 * this.p, fs.glide ?? len * 0.5,
          fs.f3 ? fs.f3 * this.p : 0, len);
      }
      last.connect(bq);
      last = bq;
    }
    return last;
  }

  /** Amplitude tremolo stage: gain swings between 1 and 1 - depth. */
  trem(n, [rate, depth, rate2 = 0], at, len) {
    const g = this.gain(1 - depth / 2);
    this.lfo(g.gain, rate, depth / 2, at, len + 0.03, 'sine', rate2);
    n.connect(g);
    return g;
  }

  // -- composite layers ---------------------------------------------------------
  // Shared options: at (offset s), a/h/d (attack, hold, decay), vol, filt, dist,
  // trem, send (reverb), dly (delay), pan, aCurve ('exp' for swells).

  /** Pitched oscillator layer with optional glide, vibrato, drive and filter. */
  tone(o) {
    const at = o.at || 0;
    const a = o.a ?? 0.002;
    const h = o.h || 0;
    const d = o.d ?? 0.2;
    const len = a + h + d;
    const osc = this.osc(o.type || 'sine', o.f * this.p, at, len + 0.03,
      o.f2 ? o.f2 * this.p : 0, o.glide ?? len * 0.5);
    if (o.detune) osc.detune.value = o.detune;
    if (o.vib) this.lfo(osc.detune, o.vib[0], o.vib[1], at, len + 0.03);
    let n = osc;
    if (o.dist) n = this.chain(n, this.shaper(o.dist));
    if (o.filt) n = this.filters(n, o.filt, at, len);
    if (o.trem) n = this.trem(n, o.trem, at, len);
    const amp = this.gain(0);
    this.env(amp.gain, at, a, h, d, o.vol ?? 1, o.aCurve);
    n.connect(amp);
    this.out(amp, o);
    return { osc, amp };
  }

  /** Noise layer (white / pink / brown) through an optional filter chain. */
  nz(o) {
    const at = o.at || 0;
    const a = o.a ?? 0.001;
    const h = o.h || 0;
    const d = o.d ?? 0.1;
    const len = a + h + d;
    const src = this.noise(o.kind || 'white', at, len + 0.03);
    let n = src;
    if (o.filt) n = this.filters(n, o.filt, at, len);
    if (o.dist) n = this.chain(n, this.shaper(o.dist));
    if (o.trem) n = this.trem(n, o.trem, at, len);
    const amp = this.gain(0);
    this.env(amp.gain, at, a, h, d, o.vol ?? 1, o.aCurve);
    n.connect(amp);
    this.out(amp, o);
    return { src, amp };
  }

  /** Struck-metal / bell ring: inharmonic sine partials, higher ones decay faster. */
  ring(o) {
    const at = o.at || 0;
    const a = o.a ?? 0.001;
    const d = o.d ?? 0.5;
    const bus = this.gain(1);
    (o.ratios || [1, 2.76, 5.4]).forEach((ratio, i) => {
      const f = o.f * ratio * this.p;
      if (f > this.nyq * 0.9) return;
      const pd = d / (1 + i * (o.damp ?? 0.6));
      const osc = this.osc('sine', o.chirp ? f * o.chirp : f, at, a + pd + 0.03, o.chirp ? f : 0, 0.025);
      const g = this.gain(0);
      this.env(g.gain, at, a, 0, pd, (o.vol ?? 1) / Math.pow(i + 1, o.tilt ?? 0.8), o.aCurve);
      osc.connect(g);
      g.connect(bus);
    });
    this.out(bus, o);
    return bus;
  }

  /** Two-operator FM (bells, clangs, zaps). Modulation index decays index -> index2. */
  fm(o) {
    const at = o.at || 0;
    const a = o.a ?? 0.002;
    const h = o.h || 0;
    const d = o.d ?? 0.5;
    const len = a + h + d;
    const f = o.f * this.p;
    const mf = f * (o.ratio ?? 2);
    const car = this.osc(o.type || 'sine', f, at, len + 0.03, o.f2 ? o.f2 * this.p : 0, o.glide ?? len);
    const mod = this.osc(o.modType || 'sine', mf, at, len + 0.03);
    const mg = this.gain(0);
    const s = this.t + at;
    mg.gain.setValueAtTime((o.index ?? 2) * mf, s);
    mg.gain.exponentialRampToValueAtTime(Math.max(0.01, (o.index2 ?? 0.1) * mf), s + len);
    mod.connect(mg);
    mg.connect(car.frequency);
    const amp = this.gain(0);
    this.env(amp.gain, at, a, h, d, o.vol ?? 1, o.aCurve);
    car.connect(amp);
    this.out(amp, o);
    return { osc: car, amp };
  }

  /**
   * Random crackle: one noise source through a band-pass whose frequency and
   * gain are re-triggered `count` times (cheap: 3 nodes for any count).
   */
  crackle(o) {
    const at = o.at || 0;
    const dur = o.dur ?? 0.3;
    const n = o.count ?? 10;
    const d = o.d ?? 0.01;
    const vol = o.vol ?? 1;
    const src = this.noise(o.kind || 'white', at, dur + d + 0.05);
    const bp = this.filter('bandpass', 2000, o.q ?? 2);
    const g = this.gain(0);
    const times = [];
    for (let i = 0; i < n; i++) times.push(Math.random() * dur);
    times.sort((x, y) => x - y);
    for (let i = 1; i < n; i++) times[i] = Math.max(times[i], times[i - 1] + 0.004);
    const s0 = this.t + at;
    g.gain.setValueAtTime(0, s0);
    for (let i = 0; i < n; i++) {
      const ti = s0 + times[i];
      const gap = i + 1 < n ? times[i + 1] - times[i] : d;
      const di = Math.max(0.002, Math.min(d, gap * 0.9));
      const shape = o.decay === false ? 0.6 + 0.4 * Math.random() : 1 - (i / n) * 0.8;
      g.gain.setValueAtTime(vol * shape * (0.5 + 0.5 * Math.random()), ti);
      g.gain.exponentialRampToValueAtTime(TINY, ti + di);
      bp.frequency.setValueAtTime(this.fz(rnd(o.fmin ?? 1000, o.fmax ?? 6000) * this.p), ti);
    }
    src.connect(bp);
    bp.connect(g);
    this.out(g, o);
    return g;
  }

  // -- lifecycle ----------------------------------------------------------------

  /** Auto-dispose when the last source ends. `cb` runs after disposal. */
  done(cb) {
    if (!this.last) {
      this.dispose();
      if (cb) cb(this);
      return this;
    }
    this.last.onended = () => {
      this.dispose();
      if (cb) cb(this);
    };
    return this;
  }

  /** Fast fade + early stop (voice stealing). */
  kill() {
    if (this.disposed) return;
    const now = this.ac.currentTime;
    for (const g of [this.outGain, this.revGain]) {
      if (!g) continue;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(0, now + 0.03);
    }
    for (const s of this.srcs) {
      try {
        s.stop(now + 0.04);
      } catch (e) {
        /* already stopped */
      }
    }
    setTimeout(() => this.dispose(), 120);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const n of this.nodes) {
      try {
        n.disconnect();
      } catch (e) {
        /* already disconnected */
      }
    }
    this.nodes.length = 0;
    this.srcs.length = 0;
    this.last = null;
  }
}

// =============================================================================
// SFX patches
// =============================================================================

// Per-sfx output gain, calibrated offline (K-weighted short-term loudness,
// peaks capped near -6 dBFS) so every effect lands at a consistent level.
const LEVELS = {
  hitLight: 0.499, hitMedium: 0.499, hitHeavy: 0.476, hitSlash: 0.509, block: 0.5, parry: 0.425,
  guardBreak: 0.494, whoosh: 1.736, whooshHeavy: 1.04, swingBlade: 2.128, jump: 1.299,
  doubleJump: 0.52, land: 0.46, dash: 2.442, step: 0.488, throw: 0.475, wallBounce: 0.49,
  groundBounce: 0.456, knockdown: 0.427, breaker: 0.432, counter: 0.487, ko: 0.377, perfect: 0.903,
  fire: 0.776, fireball: 0.581, explosion: 0.402, ice: 1.2, shatter: 0.495, shock: 0.342,
  thunder: 0.576, shadow: 0.474, teleport: 1.85, energy: 0.503, beam: 0.643, charge: 0.824,
  heal: 1.157, poison: 1.276, chain: 1.52, metal: 0.534, ground: 0.376, rock: 0.562, wind: 1.829,
  laser: 1.012, mine: 0.611, ultimateStart: 0.455, ultimateHit: 0.35, uiMove: 0.677, uiSelect: 0.316,
  uiBack: 0.345, uiError: 0.377, coin: 0.485, unlock: 0.531, achievement: 0.466,
  announceRound: 0.418, announceFight: 0.449, countdown: 0.882, timeUp: 0.504, victory: 0.405,
  defeat: 0.485,
};

// Pre-gain into the per-voice tanh soft limiter ("glue") for impact sounds.
const GLUE = {
  hitLight: 0.709, hitMedium: 0.595, hitHeavy: 0.475, hitSlash: 0.661, block: 0.755,
  guardBreak: 0.407, doubleJump: 0.782, land: 0.717, throw: 0.464, wallBounce: 0.57,
  groundBounce: 0.579, knockdown: 0.793, breaker: 0.655, counter: 0.616, ko: 0.225, fire: 2.145,
  fireball: 1.054, explosion: 0.647, shatter: 0.682, shock: 0.536, thunder: 0.678, shadow: 0.561,
  energy: 0.628, ground: 0.61, rock: 1.002, ultimateStart: 0.442, ultimateHit: 0.259,
  announceFight: 0.425,
};

const SFX = {};
/**
 * Registers a patch. `vary` is the random pitch spread per play (+-4% default;
 * tonal jingles use 0 so they stay in tune with the music). Sounds listed in
 * GLUE run through a tanh soft limiter: lower crest factor, more perceived
 * weight at the same peak, and a bit of saturation "meat".
 */
function def(name, fn, { vary = 0.04 } = {}) {
  SFX[name] = { fn, vary, glue: GLUE[name] || 0, level: LEVELS[name] ?? 1 };
}

/**
 * Layered impact used by most hits. `s` = size (0 light .. 1 huge).
 * Click transient + band-passed crack + pitch-dropping saturated thump +
 * mid punch + low noise body (+ sub boom when big).
 */
function impact(v, at, s, bright = 1) {
  // transient click
  v.nz({ at, a: 0.0005, d: 0.01 + 0.006 * s, vol: 0.4, filt: { type: 'highpass', f: 2600 } });
  // smack: bright slap that carries the hit on small speakers
  v.nz({ at, a: 0.0008, d: 0.08 + 0.04 * s, vol: 0.6, filt: { type: 'bandpass', f: 3000 * bright, q: 0.8 } });
  // crack: band-passed noise sweeping down
  v.nz({
    at, a: 0.001, d: 0.12 + 0.2 * s, vol: 0.8 + 0.25 * s,
    filt: { type: 'bandpass', f: (2600 - 1000 * s) * bright, f2: (1300 - 500 * s) * bright, glide: 0.06 + 0.1 * s, q: 0.9 },
  });
  // thump: saturated sine with a fast pitch drop
  v.tone({ at, f: 210 - 90 * s, f2: 88 - 30 * s, glide: 0.04 + 0.08 * s, a: 0.001, d: 0.1 + 0.3 * s, vol: 0.7, dist: 1.5 + 1.5 * s });
  // chest punch: mid-body triangle
  v.tone({ at, type: 'triangle', f: 380 - 140 * s, f2: 140 - 40 * s, glide: 0.035, a: 0.001, d: 0.06 + 0.1 * s, vol: 0.45 });
  // body noise
  v.nz({ at, kind: 'pink', a: 0.002, d: 0.07 + 0.22 * s, vol: 0.45 + 0.35 * s, filt: { type: 'lowpass', f: 1300 - 500 * s, q: 0.9 } });
  // sub boom for the big ones
  if (s >= 0.6) v.tone({ at, f: 70 - 12 * s, f2: 38, glide: 0.25, a: 0.004, d: 0.3 + 0.45 * s, vol: 0.5 * s });
}

/** A short brass-ish note for jingles. */
function brass(v, at, m, len, vol = 0.3) {
  v.tone({ at, type: 'sawtooth', f: mtof(m), a: 0.012, h: len, d: 0.25, vol, detune: -6,
    filt: { type: 'lowpass', f: 1200, f2: 3400, glide: 0.04, f3: 1600, q: 1 }, send: 0.25 });
  v.tone({ at, type: 'square', f: mtof(m), a: 0.012, h: len, d: 0.25, vol: vol * 0.45, detune: 6,
    filt: { type: 'lowpass', f: 2600 }, send: 0.25 });
}

// ---- combat -----------------------------------------------------------------

def('hitLight', (v) => impact(v, 0, 0.1));

def('hitMedium', (v) => impact(v, 0, 0.45));

def('hitHeavy', (v) => {
  impact(v, 0, 0.9);
  v.nz({ kind: 'brown', d: 0.5, vol: 0.3, filt: { type: 'lowpass', f: 320, f2: 90, glide: 0.4 }, send: 0.15 });
});

def('hitSlash', (v) => {
  // the cut: bright noise sweeping up, then a sizzle
  v.nz({ a: 0.012, d: 0.16, vol: 0.8, filt: { type: 'bandpass', f: 1800, f2: 7500, glide: 0.12, q: 2.2 } });
  v.nz({ a: 0.001, d: 0.05, vol: 0.5, filt: { type: 'highpass', f: 5000 } });
  // blade ring
  v.ring({ at: 0.005, f: 2650, ratios: [1, 1.47, 2.09, 2.76, 3.52], d: 0.34, vol: 0.22, send: 0.12 });
  // flesh hit underneath
  v.tone({ f: 260, f2: 90, glide: 0.06, d: 0.1, vol: 0.6, dist: 1.5 });
  v.nz({ kind: 'pink', d: 0.07, vol: 0.3, filt: { type: 'lowpass', f: 900 } });
});

def('block', (v) => {
  // dull guarded thud
  v.tone({ f: 190, f2: 95, glide: 0.06, d: 0.13, vol: 0.9, dist: 1.2 });
  v.nz({ kind: 'pink', d: 0.09, vol: 0.6, filt: { type: 'lowpass', f: 700, q: 1.2 } });
  v.nz({ d: 0.03, vol: 0.25, filt: { type: 'bandpass', f: 1400, q: 1.5 } });
  // short metallic tick
  v.ring({ at: 0.002, f: 3300, ratios: [1, 1.53, 2.31], d: 0.07, vol: 0.18 });
  v.nz({ d: 0.006, vol: 0.4, filt: { type: 'highpass', f: 4000 } });
});

def('parry', (v) => {
  v.nz({ d: 0.006, vol: 0.6, filt: { type: 'highpass', f: 3500 } }); // contact click
  v.nz({ d: 0.05, vol: 0.35, filt: { type: 'bandpass', f: 5000, q: 1.5 } }); // scrape
  // the "ting": bell partials with a tiny upward chirp into pitch
  v.ring({ f: 1568, ratios: [1, 2.0, 2.76, 4.07, 5.4], d: 0.95, vol: 0.5, chirp: 0.97, send: 0.25 });
  v.fm({ f: 2349, ratio: 3.5, index: 2.5, index2: 0.1, d: 0.6, vol: 0.22, send: 0.25 });
  // shimmer: two slightly detuned high sines beating against each other
  v.tone({ at: 0.01, f: 3136, a: 0.01, d: 0.75, vol: 0.12, vib: [9, 15], send: 0.3 });
  v.tone({ at: 0.01, f: 3146, a: 0.01, d: 0.75, vol: 0.12, send: 0.3 });
  v.nz({ at: 0.005, a: 0.02, d: 0.3, vol: 0.1, filt: { type: 'highpass', f: 9000 }, send: 0.3 });
});

def('guardBreak', (v) => {
  impact(v, 0, 0.7);
  // glass crack: dense high crackle + inharmonic glassy ring + crunchy mid
  v.crackle({ dur: 0.16, count: 14, fmin: 2500, fmax: 8000, d: 0.012, vol: 0.8, q: 3 });
  v.ring({ at: 0.004, f: 3100, ratios: [1, 1.37, 2.21, 2.93, 3.61], d: 0.4, vol: 0.2, send: 0.18 });
  v.nz({ a: 0.001, d: 0.13, vol: 0.5, dist: 4, filt: { type: 'bandpass', f: 1100, q: 0.8 } });
  v.tone({ f: 110, f2: 45, glide: 0.3, a: 0.003, d: 0.5, vol: 0.4 });
});

def('whoosh', (v) => {
  v.nz({ a: 0.06, d: 0.12, vol: 0.8, filt: { type: 'bandpass', f: 500, f2: 2200, glide: 0.07, f3: 900, q: 1.6 } });
  v.nz({ kind: 'pink', a: 0.05, d: 0.1, vol: 0.35, filt: { type: 'lowpass', f: 900 } });
});

def('whooshHeavy', (v) => {
  v.nz({ a: 0.14, d: 0.24, vol: 0.9, filt: { type: 'bandpass', f: 220, f2: 950, glide: 0.16, f3: 350, q: 1.3 } });
  v.nz({ kind: 'brown', a: 0.12, d: 0.22, vol: 0.6, filt: { type: 'lowpass', f: 420 } });
});

def('swingBlade', (v) => {
  v.nz({ a: 0.045, d: 0.1, vol: 0.8, filt: { type: 'bandpass', f: 1400, f2: 6500, glide: 0.07, f3: 3000, q: 3 } });
  v.nz({ at: 0.03, a: 0.01, d: 0.06, vol: 0.3, filt: { type: 'highpass', f: 7000 } });
  v.ring({ at: 0.04, f: 4700, ratios: [1, 1.41], d: 0.12, vol: 0.05 });
});

def('jump', (v) => {
  v.nz({ a: 0.008, d: 0.09, vol: 0.6, filt: { type: 'bandpass', f: 800, f2: 2200, glide: 0.08, q: 1.2 } });
  v.tone({ type: 'triangle', f: 280, f2: 560, glide: 0.07, a: 0.003, d: 0.08, vol: 0.35 });
  v.nz({ kind: 'pink', d: 0.04, vol: 0.4, filt: { type: 'lowpass', f: 400 } }); // push-off scuff
});

def('doubleJump', (v) => {
  v.nz({ a: 0.005, d: 0.12, vol: 0.6, filt: { type: 'bandpass', f: 1500, f2: 4500, glide: 0.1, q: 1.4 } });
  v.tone({ f: 520, f2: 1250, glide: 0.08, a: 0.002, d: 0.1, vol: 0.4 });
  v.tone({ f: 900, f2: 600, glide: 0.02, d: 0.03, vol: 0.5 }); // pop
});

def('land', (v) => {
  v.tone({ f: 130, f2: 55, glide: 0.06, d: 0.11, vol: 0.9, dist: 1 });
  v.nz({ kind: 'pink', d: 0.08, vol: 0.6, filt: { type: 'lowpass', f: 600 } });
  v.nz({ at: 0.005, a: 0.005, d: 0.08, vol: 0.15, filt: { type: 'bandpass', f: 3000, q: 0.8 } }); // dust
});

def('dash', (v) => {
  v.nz({ a: 0.02, d: 0.2, vol: 0.8, filt: { type: 'bandpass', f: 700, f2: 3800, glide: 0.08, f3: 1800, q: 0.9 } });
  v.nz({ a: 0.01, d: 0.12, vol: 0.3, filt: { type: 'highpass', f: 5000 } });
  v.nz({ kind: 'pink', d: 0.05, vol: 0.35, filt: { type: 'lowpass', f: 500 } }); // foot push
});

def('step', (v) => {
  v.nz({ d: 0.025, vol: 0.6, filt: { type: 'bandpass', f: 1800, q: 1.5 } });
  v.tone({ f: 160, f2: 90, glide: 0.03, d: 0.04, vol: 0.6 });
});

def('throw', (v) => {
  // grab rustle and the swing over the shoulder
  v.crackle({ dur: 0.14, count: 5, fmin: 1500, fmax: 3500, d: 0.03, vol: 0.4, q: 1 });
  v.nz({ a: 0.06, d: 0.1, vol: 0.4, filt: { type: 'bandpass', f: 600, f2: 1800, glide: 0.12, q: 1 } });
  // heavy slam
  impact(v, 0.2, 0.85);
  v.nz({ at: 0.2, kind: 'brown', d: 0.4, vol: 0.5, filt: { type: 'lowpass', f: 350 }, send: 0.1 });
});

def('wallBounce', (v) => {
  impact(v, 0, 0.7);
  v.tone({ type: 'triangle', f: 135, f2: 105, glide: 0.2, d: 0.32, vol: 0.4 }); // wall resonance
  v.crackle({ at: 0.03, dur: 0.25, count: 7, fmin: 400, fmax: 1600, d: 0.025, vol: 0.45, q: 4 }); // rattle
});

def('groundBounce', (v) => {
  impact(v, 0, 0.55);
  v.nz({ kind: 'pink', d: 0.2, vol: 0.4, filt: { type: 'lowpass', f: 500 } });
  // smaller second bounce
  v.tone({ at: 0.15, f: 140, f2: 60, glide: 0.05, d: 0.1, vol: 0.45 });
  v.nz({ at: 0.15, kind: 'pink', d: 0.06, vol: 0.25, filt: { type: 'lowpass', f: 700 } });
  v.nz({ at: 0.02, a: 0.02, d: 0.25, vol: 0.12, filt: { type: 'highpass', f: 2500 } }); // dust
});

def('knockdown', (v) => {
  v.tone({ f: 110, f2: 42, glide: 0.1, d: 0.34, vol: 1, dist: 2 });
  v.nz({ kind: 'pink', d: 0.18, vol: 0.7, filt: { type: 'lowpass', f: 700 } });
  v.nz({ d: 0.03, vol: 0.4, filt: { type: 'bandpass', f: 1500, q: 1 } });
  // limbs landing a beat later
  v.tone({ at: 0.11, f: 150, f2: 70, glide: 0.05, d: 0.1, vol: 0.5 });
  v.nz({ at: 0.11, kind: 'pink', d: 0.07, vol: 0.35, filt: { type: 'lowpass', f: 900 } });
  v.nz({ at: 0.02, a: 0.05, d: 0.35, vol: 0.12, filt: { type: 'bandpass', f: 2500, q: 0.6 } }); // dust slide
});

def('breaker', (v) => {
  // rising energy whoosh
  v.nz({ a: 0.22, aCurve: 'exp', d: 0.04, vol: 0.7, filt: { type: 'bandpass', f: 300, f2: 3500, glide: 0.24, q: 2 } });
  v.tone({ type: 'sawtooth', f: 150, f2: 900, glide: 0.24, a: 0.2, aCurve: 'exp', d: 0.05, vol: 0.18, filt: { type: 'lowpass', f: 2500 } });
  // bright pop
  v.nz({ at: 0.24, d: 0.012, vol: 0.8, filt: { type: 'highpass', f: 2000 } });
  v.tone({ at: 0.24, f: 1400, f2: 700, glide: 0.05, d: 0.12, vol: 0.4, send: 0.3 });
  v.ring({ at: 0.24, f: 1975, ratios: [1, 1.5, 2.0, 3.0], d: 0.45, vol: 0.18, send: 0.3 });
  // shockwave
  v.tone({ at: 0.24, f: 120, f2: 32, glide: 0.35, d: 0.55, vol: 0.9, dist: 1.5 });
  v.nz({ at: 0.24, kind: 'pink', a: 0.01, d: 0.5, vol: 0.5, filt: { type: 'lowpass', f: 1800, f2: 150, glide: 0.45 }, send: 0.3 });
});

def('counter', (v) => {
  impact(v, 0, 0.35);
  v.nz({ d: 0.006, vol: 0.7, filt: { type: 'highpass', f: 3000 } });
  v.tone({ type: 'square', f: 1760, d: 0.2, vol: 0.12, filt: { type: 'lowpass', f: 5000 }, send: 0.2 });
  v.tone({ type: 'sawtooth', f: 2637, d: 0.16, vol: 0.08, filt: { type: 'lowpass', f: 6000 }, send: 0.2 });
  v.fm({ f: 1318, ratio: 2.01, index: 3, index2: 0.2, d: 0.32, vol: 0.25, send: 0.2 });
});

def('ko', (v) => {
  impact(v, 0, 1);
  v.tone({ f: 110, f2: 38, glide: 0.6, a: 0.003, d: 1.8, vol: 0.9, dist: 2.5, send: 0.4 }); // boom
  v.tone({ f: 52, f2: 32, glide: 1.0, a: 0.01, d: 2.2, vol: 0.45 }); // sub
  v.tone({ type: 'triangle', f: 240, f2: 95, glide: 0.08, d: 0.3, vol: 0.5 }); // body
  v.nz({ kind: 'brown', a: 0.01, d: 2.0, vol: 0.6, filt: { type: 'lowpass', f: 700, f2: 90, glide: 1.6 }, send: 0.5 }); // rumble
  v.nz({ a: 0.001, d: 0.35, vol: 0.6, filt: { type: 'bandpass', f: 1800, f2: 350, glide: 0.3, q: 0.9 }, send: 0.6 }); // big crack
  v.fm({ f: 180, ratio: 1.41, index: 5, index2: 0.3, d: 1.2, vol: 0.2, send: 0.5 }); // metallic body
  v.nz({ at: 0.02, a: 0.05, d: 1.6, vol: 0.18, filt: { type: 'highpass', f: 3000 }, send: 0.6 }); // air tail
});

def('perfect', (v) => {
  [84, 88, 91, 96].forEach((m, i) => v.fm({
    at: i * 0.065, f: mtof(m), ratio: 3.5, index: 1.5, index2: 0.05, d: 0.9 - i * 0.1, vol: 0.28, send: 0.4, pan: (i - 1.5) * 0.25,
  }));
  v.tone({ at: 0.2, f: mtof(100), a: 0.02, d: 0.8, vol: 0.06, vib: [7, 20], send: 0.5 });
  v.nz({ a: 0.15, d: 0.6, vol: 0.1, filt: { type: 'highpass', f: 9000 }, send: 0.5 });
}, { vary: 0 });

// ---- elements & specials ------------------------------------------------------

def('fire', (v) => {
  v.nz({ a: 0.04, d: 0.5, vol: 0.8, filt: { type: 'bandpass', f: 500, f2: 1400, glide: 0.1, f3: 600, q: 0.8 }, trem: [22, 0.5], send: 0.1 });
  v.nz({ kind: 'brown', a: 0.03, d: 0.45, vol: 0.7, filt: { type: 'lowpass', f: 500 }, trem: [14, 0.4] });
  v.crackle({ dur: 0.45, count: 10, fmin: 2000, fmax: 6000, d: 0.008, vol: 0.25, q: 2 });
});

def('fireball', (v) => {
  v.nz({ a: 0.02, d: 0.4, vol: 0.8, filt: { type: 'bandpass', f: 400, f2: 2200, glide: 0.08, f3: 500, q: 1 }, trem: [25, 0.5] });
  v.tone({ type: 'sawtooth', f: 180, f2: 60, glide: 0.3, a: 0.01, d: 0.35, vol: 0.4, dist: 2, filt: { type: 'lowpass', f: 900, q: 2 } });
  v.nz({ d: 0.008, vol: 0.25, filt: { type: 'highpass', f: 2500 } });
  v.crackle({ at: 0.05, dur: 0.3, count: 6, fmin: 2500, fmax: 7000, d: 0.006, vol: 0.2, q: 2 });
});

def('explosion', (v) => {
  v.nz({ d: 0.012, vol: 0.9, filt: { type: 'highpass', f: 1500 } });
  v.nz({ a: 0.002, d: 0.25, vol: 0.8, filt: { type: 'bandpass', f: 3000, f2: 500, glide: 0.2, q: 0.7 }, send: 0.4 });
  v.tone({ f: 90, f2: 34, glide: 0.5, a: 0.004, d: 1.1, vol: 0.9, dist: 3, send: 0.3 });
  v.nz({ kind: 'brown', a: 0.005, d: 1.7, vol: 0.75, filt: { type: 'lowpass', f: 1200, f2: 90, glide: 1.2 }, trem: [9, 0.3], send: 0.5 });
  v.nz({ kind: 'pink', a: 0.002, d: 0.4, vol: 0.6, dist: 3, filt: { type: 'bandpass', f: 700, f2: 250, glide: 0.3, q: 0.8 } }); // crunch
  v.crackle({ at: 0.06, dur: 0.6, count: 14, fmin: 800, fmax: 4000, d: 0.02, vol: 0.4, q: 2 });
});

def('ice', (v) => {
  v.nz({ d: 0.03, vol: 0.5, filt: { type: 'highpass', f: 4500 } });
  v.crackle({ dur: 0.08, count: 5, fmin: 3000, fmax: 9000, d: 0.006, vol: 0.5, q: 2 });
  const notes = [2637, 3136, 3520, 4186, 4699, 5274];
  for (let i = 0; i < 6; i++) {
    v.fm({ at: i * 0.035 + rnd(0, 0.015), f: pick(notes), ratio: 2.76, index: 1.2, index2: 0.05, d: 0.35, vol: 0.18, send: 0.35, pan: rnd(-0.4, 0.4) });
  }
  v.ring({ f: 1900, ratios: [1, 1.71, 2.53, 3.4], d: 0.6, vol: 0.12, send: 0.3 }); // glassy body
  v.nz({ a: 0.05, d: 0.5, vol: 0.1, filt: { type: 'bandpass', f: 7000, q: 2 }, send: 0.4 }); // frost hiss
});

def('shatter', (v) => {
  v.nz({ d: 0.12, vol: 0.8, filt: { type: 'highpass', f: 1800 }, send: 0.2 });
  v.tone({ f: 200, f2: 70, glide: 0.08, d: 0.15, vol: 0.6 });
  v.crackle({ dur: 0.2, count: 16, fmin: 3000, fmax: 9000, d: 0.008, vol: 0.6, q: 3 });
  // shards tinkling down, dense at first
  for (let i = 0; i < 12; i++) {
    const at = 0.01 + Math.pow(Math.random(), 1.6) * 0.45;
    v.ring({ at, f: rnd(2500, 7000), ratios: [1, 1.53], d: rnd(0.05, 0.16), vol: 0.22 * (1 - at), pan: rnd(-0.5, 0.5), send: 0.25 });
  }
});

def('shock', (v) => {
  const p = v.p;
  const a = v.tone({ type: 'sawtooth', f: 120, a: 0.004, h: 0.32, d: 0.12, vol: 0.5, dist: 4, filt: [{ type: 'highpass', f: 300 }, { type: 'lowpass', f: 6000 }] });
  const b = v.tone({ type: 'square', f: 181, a: 0.004, h: 0.3, d: 0.1, vol: 0.3, dist: 3, filt: { type: 'bandpass', f: 1800, q: 0.7 } });
  // random frequency jumps make it spit and arc
  for (let x = 0.02; x < 0.42; x += 0.018 + Math.random() * 0.02) {
    a.osc.frequency.setValueAtTime(rnd(70, 300) * p, v.t + x);
    b.osc.frequency.setValueAtTime(rnd(120, 520) * p, v.t + x);
  }
  v.lfo(a.osc.frequency, 53, 70 * p, 0, 0.47, 'square');
  v.crackle({ dur: 0.42, count: 26, fmin: 1500, fmax: 9000, d: 0.012, vol: 0.8, q: 1, decay: false });
  v.nz({ d: 0.012, vol: 0.7, filt: { type: 'highpass', f: 1800 } });
  v.tone({ f: 2400, f2: 600, glide: 0.04, d: 0.05, vol: 0.2 }); // zap onset
});

def('thunder', (v) => {
  v.nz({ d: 0.02, vol: 1, filt: { type: 'highpass', f: 1200 } });
  v.crackle({ dur: 0.25, count: 18, fmin: 1500, fmax: 7000, d: 0.012, vol: 0.8, q: 1 });
  v.nz({ a: 0.002, d: 0.3, vol: 0.7, filt: { type: 'bandpass', f: 2500, f2: 600, glide: 0.25, q: 0.6 }, send: 0.5 });
  // rolling rumble: overlapping swells
  [[0.05, 0.9, 1.0], [0.35, 0.7, 1.2], [0.8, 0.5, 1.4]].forEach(([at, vol, d]) => {
    v.nz({ at, kind: 'brown', a: 0.08, d, vol, filt: { type: 'lowpass', f: 400, f2: 90, glide: d }, send: 0.4 });
  });
  v.tone({ f: 55, f2: 30, glide: 1.2, a: 0.01, d: 1.6, vol: 0.5 });
});

def('shadow', (v) => {
  // reversed swell that cuts off abruptly
  v.nz({ kind: 'pink', a: 0.5, aCurve: 'exp', d: 0.07, vol: 0.9, filt: { type: 'lowpass', f: 250, f2: 2200, glide: 0.5, q: 3 }, send: 0.2 });
  for (const [f, det] of [[55, -10], [58, 10]]) {
    v.tone({ type: 'sawtooth', f, a: 0.45, aCurve: 'exp', d: 0.12, vol: 0.25, detune: det, filt: { type: 'lowpass', f: 200, f2: 900, glide: 0.45 } });
  }
  // dark "thoom" landing
  v.tone({ at: 0.5, f: 90, f2: 40, glide: 0.2, d: 0.35, vol: 0.7, dist: 1.5, send: 0.3 });
  v.nz({ at: 0.5, kind: 'brown', d: 0.3, vol: 0.4, filt: { type: 'lowpass', f: 300 }, send: 0.3 });
});

def('teleport', (v) => {
  const z = v.tone({ type: 'square', f: 300, f2: 2600, glide: 0.14, a: 0.005, h: 0.08, d: 0.1, vol: 0.18,
    filt: { type: 'bandpass', f: 800, f2: 5000, glide: 0.15, q: 4 } });
  v.lfo(z.osc.frequency, 35, 120 * v.p, 0, 0.22);
  v.tone({ type: 'sawtooth', f: 306, f2: 2650, glide: 0.14, a: 0.005, h: 0.08, d: 0.1, vol: 0.12, filt: { type: 'lowpass', f: 3000 } });
  v.nz({ a: 0.02, d: 0.15, vol: 0.4, filt: { type: 'bandpass', f: 2000, f2: 9000, glide: 0.14, q: 3 } });
  v.tone({ at: 0.17, f: 1800, f2: 3600, glide: 0.04, d: 0.06, vol: 0.2, send: 0.2 }); // pop out
});

def('energy', (v) => {
  // tonal charge
  const c = v.tone({ type: 'sawtooth', f: 220, f2: 880, glide: 0.22, a: 0.2, aCurve: 'exp', d: 0.04, vol: 0.2,
    filt: { type: 'lowpass', f: 1200, f2: 4000, glide: 0.22, q: 4 } });
  v.lfo(c.osc.detune, 18, 40, 0, 0.25);
  v.tone({ f: 440, f2: 1760, glide: 0.22, a: 0.2, aCurve: 'exp', d: 0.04, vol: 0.25 });
  // release
  v.nz({ at: 0.22, d: 0.01, vol: 0.6, filt: { type: 'highpass', f: 2000 } });
  v.tone({ at: 0.22, type: 'sawtooth', f: 900, f2: 150, glide: 0.25, d: 0.35, vol: 0.3, filt: { type: 'lowpass', f: 3000, f2: 400, glide: 0.3 }, send: 0.3 });
  v.nz({ at: 0.22, a: 0.005, d: 0.35, vol: 0.6, filt: { type: 'bandpass', f: 2500, f2: 600, glide: 0.3, q: 1 }, send: 0.3 });
  v.tone({ at: 0.22, f: 160, f2: 50, glide: 0.15, d: 0.25, vol: 0.6 });
});

def('beam', (v) => {
  const hold = 1.0;
  // start burst
  v.nz({ d: 0.15, vol: 0.5, filt: { type: 'bandpass', f: 3000, f2: 800, glide: 0.15, q: 1 } });
  v.tone({ f: 1200, f2: 300, glide: 0.12, d: 0.12, vol: 0.3 });
  // sustained buzzing core: detuned saws + square with fast vibrato
  for (const det of [-12, 12]) {
    const s = v.tone({ type: 'sawtooth', f: 220, a: 0.04, h: hold, d: 0.15, vol: 0.2, detune: det, filt: { type: 'bandpass', f: 1400, q: 1.5 } });
    v.lfo(s.osc.frequency, 31, 6, 0, hold + 0.25);
  }
  v.tone({ type: 'square', f: 440, a: 0.04, h: hold, d: 0.15, vol: 0.07, filt: { type: 'lowpass', f: 3000 }, trem: [17, 0.5] });
  v.nz({ a: 0.04, h: hold, d: 0.15, vol: 0.22, filt: { type: 'bandpass', f: 4000, q: 1 }, trem: [23, 0.6] });
  v.tone({ f: 110, a: 0.03, h: hold, d: 0.2, vol: 0.4 }); // body hum
});

def('charge', (v) => {
  v.tone({ type: 'sawtooth', f: 130, f2: 1040, glide: 0.6, a: 0.05, h: 0.5, d: 0.08, vol: 0.2,
    filt: { type: 'lowpass', f: 600, f2: 5000, glide: 0.6, q: 5 }, trem: [8, 0.6, 32] });
  v.tone({ f: 260, f2: 2080, glide: 0.6, a: 0.05, h: 0.5, d: 0.08, vol: 0.25, trem: [8, 0.5, 32] });
  v.nz({ a: 0.5, aCurve: 'exp', d: 0.08, vol: 0.2, filt: { type: 'bandpass', f: 1000, f2: 8000, glide: 0.6, q: 2 } });
});

def('heal', (v) => {
  [72, 74, 76, 79, 81, 84, 88].forEach((m, i) => {
    v.tone({ at: i * 0.065, type: 'triangle', f: mtof(m), a: 0.01, d: 0.45, vol: 0.22, send: 0.4, pan: (i - 3) * 0.12 });
    v.tone({ at: i * 0.065, f: mtof(m + 12), a: 0.01, d: 0.3, vol: 0.06, send: 0.4 });
  });
  v.tone({ f: mtof(60), a: 0.15, d: 0.6, vol: 0.15, send: 0.3 }); // warm base
  v.nz({ a: 0.25, d: 0.5, vol: 0.07, filt: { type: 'highpass', f: 7000 }, send: 0.5 });
}, { vary: 0.01 });

def('poison', (v) => {
  for (let i = 0; i < 8; i++) {
    const f = rnd(180, 420);
    v.tone({ at: i * 0.075 + rnd(0, 0.03), f, f2: f * 2.2, glide: 0.05, a: 0.004, d: 0.06, vol: 0.35, filt: { type: 'lowpass', f: 1500 } });
  }
  v.nz({ kind: 'brown', a: 0.05, d: 0.6, vol: 0.5, filt: { type: 'bandpass', f: 400, q: 3 }, trem: [11, 0.7] });
  v.tone({ type: 'sawtooth', f: 70, a: 0.05, d: 0.5, vol: 0.12, filt: { type: 'lowpass', f: 300 }, vib: [6, 30] }); // sickly drone
});

def('chain', (v) => {
  let at = 0;
  for (let i = 0; i < 9; i++) {
    v.fm({ at, f: rnd(2200, 4200), ratio: rnd(1.3, 1.5), index: 2.5, index2: 0.2, d: rnd(0.05, 0.1), vol: 0.32 * (1 - i / 12), pan: rnd(-0.3, 0.3) });
    at += rnd(0.018, 0.05) * (1 + i * 0.12);
  }
  v.crackle({ dur: 0.35, count: 10, fmin: 3000, fmax: 7000, d: 0.01, vol: 0.3, q: 2 });
});

def('metal', (v) => {
  v.nz({ d: 0.006, vol: 0.4, filt: { type: 'highpass', f: 2500 } });
  v.fm({ f: 523, ratio: 1.414, index: 6, index2: 0.4, d: 0.8, vol: 0.35, send: 0.25 });
  v.ring({ f: 860, ratios: [1, 2.76, 5.4, 8.93], d: 0.7, vol: 0.25, send: 0.2 });
  v.tone({ f: 200, f2: 120, glide: 0.05, d: 0.1, vol: 0.4 });
});

def('ground', (v) => {
  v.tone({ f: 95, f2: 38, glide: 0.4, a: 0.003, d: 0.8, vol: 1, dist: 2.5, send: 0.2 });
  v.tone({ type: 'triangle', f: 200, f2: 85, glide: 0.06, d: 0.25, vol: 0.5 }); // body
  v.nz({ kind: 'brown', a: 0.01, d: 1.1, vol: 0.7, filt: { type: 'lowpass', f: 600, f2: 90, glide: 1 }, trem: [13, 0.45], send: 0.3 });
  v.nz({ a: 0.001, d: 0.12, vol: 0.5, dist: 3, filt: { type: 'bandpass', f: 900, q: 0.8 } });
  v.crackle({ at: 0.04, dur: 0.6, count: 12, fmin: 300, fmax: 1500, d: 0.03, vol: 0.35, q: 3 });
});

def('rock', (v) => {
  v.tone({ f: 140, f2: 60, glide: 0.06, d: 0.12, vol: 0.6 });
  v.crackle({ dur: 0.5, count: 14, fmin: 250, fmax: 1800, d: 0.035, vol: 0.7, q: 2.5 });
  v.nz({ kind: 'pink', a: 0.01, d: 0.4, vol: 0.3, filt: { type: 'lowpass', f: 900, f2: 300, glide: 0.4 } });
});

def('wind', (v) => {
  v.nz({ kind: 'pink', a: 0.35, d: 0.6, vol: 0.9, filt: { type: 'bandpass', f: 350, f2: 1100, glide: 0.4, f3: 500, q: 1.8 }, send: 0.2 });
  v.nz({ a: 0.3, d: 0.5, vol: 0.12, filt: { type: 'bandpass', f: 900, f2: 1500, glide: 0.4, f3: 1100, q: 12 } }); // whistle
});

def('laser', (v) => {
  v.tone({ type: 'square', f: 1900, f2: 280, glide: 0.16, a: 0.002, d: 0.18, vol: 0.2, filt: { type: 'lowpass', f: 5000 } });
  v.tone({ type: 'sawtooth', f: 2850, f2: 420, glide: 0.16, d: 0.17, vol: 0.1, filt: { type: 'lowpass', f: 6000 } });
  v.tone({ f: 950, f2: 140, glide: 0.16, d: 0.18, vol: 0.3 });
});

def('mine', (v) => {
  for (const at of [0, 0.16]) {
    v.tone({ at, type: 'square', f: 1320, a: 0.002, h: 0.055, d: 0.02, vol: 0.18, filt: { type: 'lowpass', f: 4000 } });
    v.tone({ at, f: 2640, a: 0.002, h: 0.05, d: 0.02, vol: 0.08 });
  }
}, { vary: 0.01 });

def('ultimateStart', (v) => {
  impact(v, 0, 0.8);
  v.tone({ f: 82, f2: 55, glide: 0.5, a: 0.01, d: 0.9, vol: 0.3, dist: 1.5, send: 0.3 }); // low drone
  // rising sweep
  v.nz({ at: 0.05, a: 0.75, aCurve: 'exp', d: 0.06, vol: 0.6, filt: { type: 'bandpass', f: 200, f2: 6000, glide: 0.8, q: 2.5 }, send: 0.3 });
  v.tone({ at: 0.05, type: 'sawtooth', f: 90, f2: 900, glide: 0.8, a: 0.7, aCurve: 'exp', d: 0.08, vol: 0.18,
    filt: { type: 'lowpass', f: 400, f2: 5000, glide: 0.8, q: 3 }, send: 0.2 });
  // the "shing"
  v.nz({ at: 0.85, d: 0.4, vol: 0.5, filt: { type: 'highpass', f: 6000 }, send: 0.5 });
  v.ring({ at: 0.85, f: 2093, ratios: [1, 1.5, 2.0, 2.52, 3.0], d: 1.0, vol: 0.3, send: 0.5 });
  v.fm({ at: 0.85, f: 4186, ratio: 1.5, index: 2, index2: 0.1, d: 0.6, vol: 0.12, send: 0.5 });
});

def('ultimateHit', (v) => {
  impact(v, 0, 1);
  v.tone({ f: 115, f2: 36, glide: 0.7, a: 0.003, d: 1.9, vol: 1, dist: 3, send: 0.4 });
  v.tone({ f: 52, f2: 30, glide: 1.0, a: 0.01, d: 2.0, vol: 0.45 });
  v.tone({ type: 'triangle', f: 260, f2: 100, glide: 0.08, d: 0.35, vol: 0.5 }); // body
  v.nz({ kind: 'brown', a: 0.01, d: 2.0, vol: 0.65, filt: { type: 'lowpass', f: 1500, f2: 90, glide: 1.5 }, trem: [7, 0.25], send: 0.5 });
  v.nz({ a: 0.001, d: 0.4, vol: 0.7, filt: { type: 'bandpass', f: 3500, f2: 500, glide: 0.35, q: 0.7 }, send: 0.5 });
  v.fm({ f: 140, ratio: 1.41, index: 8, index2: 0.3, d: 1.5, vol: 0.2, send: 0.5 });
  v.ring({ f: 1046, ratios: [1, 1.5, 2.0, 2.76], d: 1.4, vol: 0.12, send: 0.6 });
  v.crackle({ at: 0.03, dur: 0.6, count: 14, fmin: 1000, fmax: 6000, d: 0.015, vol: 0.4 });
});

// ---- UI & announcer -----------------------------------------------------------

def('uiMove', (v) => {
  v.tone({ type: 'triangle', f: 1800, d: 0.025, vol: 0.5 });
  v.tone({ f: 3600, d: 0.012, vol: 0.2 });
}, { vary: 0.015 });

def('uiSelect', (v) => {
  v.tone({ type: 'square', f: 988, h: 0.035, d: 0.03, vol: 0.25, filt: { type: 'lowpass', f: 3500 } });
  v.tone({ at: 0.05, type: 'square', f: 1480, h: 0.04, d: 0.12, vol: 0.25, filt: { type: 'lowpass', f: 4000 } });
  v.tone({ at: 0.05, f: 2960, d: 0.08, vol: 0.08 });
}, { vary: 0 });

def('uiBack', (v) => {
  v.tone({ type: 'triangle', f: 880, h: 0.03, d: 0.03, vol: 0.4 });
  v.tone({ at: 0.05, type: 'triangle', f: 587, h: 0.03, d: 0.08, vol: 0.4 });
}, { vary: 0 });

def('uiError', (v) => {
  for (const at of [0, 0.11]) {
    v.tone({ at, type: 'square', f: 140, a: 0.004, h: 0.07, d: 0.03, vol: 0.3, filt: { type: 'lowpass', f: 1500 } });
    v.tone({ at, type: 'sawtooth', f: 147, a: 0.004, h: 0.07, d: 0.03, vol: 0.25, filt: { type: 'lowpass', f: 1500 } });
  }
}, { vary: 0 });

def('coin', (v) => {
  v.tone({ type: 'square', f: 988, a: 0.002, h: 0.06, d: 0.02, vol: 0.22, filt: { type: 'lowpass', f: 6000 } });
  v.tone({ at: 0.07, type: 'square', f: 1319, a: 0.002, h: 0.05, d: 0.4, vol: 0.22, filt: { type: 'lowpass', f: 6000 } });
  v.tone({ at: 0.07, f: 2638, d: 0.25, vol: 0.06 });
}, { vary: 0 });

def('unlock', (v) => {
  [72, 76, 79, 84, 88].forEach((m, i) => {
    v.tone({ at: i * 0.07, type: 'square', f: mtof(m), a: 0.003, h: 0.04, d: 0.25, vol: 0.18, filt: { type: 'lowpass', f: 4000 }, send: 0.25 });
    v.tone({ at: i * 0.07, type: 'triangle', f: mtof(m), d: 0.3, vol: 0.25 });
  });
  [79, 84, 88, 91].forEach((m) => v.tone({
    at: 0.36, type: 'sawtooth', f: mtof(m), a: 0.01, h: 0.25, d: 0.5, vol: 0.08, vib: [6, 8],
    filt: { type: 'lowpass', f: 3000, f2: 1500, glide: 0.6 }, send: 0.35,
  }));
  v.fm({ at: 0.36, f: mtof(96), ratio: 3.5, index: 1.5, index2: 0.05, d: 0.7, vol: 0.12, send: 0.4 });
  v.nz({ at: 0.36, a: 0.05, d: 0.6, vol: 0.08, filt: { type: 'highpass', f: 8000 }, send: 0.4 });
}, { vary: 0 });

def('achievement', (v) => {
  v.fm({ f: mtof(91), ratio: 3.5, index: 1.8, index2: 0.05, d: 1.0, vol: 0.3, send: 0.45 }); // G6
  v.fm({ at: 0.13, f: mtof(98), ratio: 3.5, index: 1.8, index2: 0.05, d: 1.1, vol: 0.3, send: 0.45 }); // D7
  v.tone({ at: 0.13, type: 'triangle', f: mtof(79), a: 0.03, h: 0.2, d: 0.6, vol: 0.18, send: 0.4 });
  v.tone({ at: 0.13, type: 'triangle', f: mtof(86), a: 0.03, h: 0.2, d: 0.6, vol: 0.12, send: 0.4 });
  v.nz({ at: 0.1, a: 0.1, d: 0.5, vol: 0.06, filt: { type: 'highpass', f: 9000 }, send: 0.4 });
}, { vary: 0 });

def('announceRound', (v) => {
  // deep drum hit
  v.tone({ f: 130, f2: 60, glide: 0.07, a: 0.002, d: 1.0, vol: 1, dist: 1.6, send: 0.4 });
  v.tone({ type: 'triangle', f: 210, f2: 100, glide: 0.05, d: 0.25, vol: 0.45 });
  v.nz({ kind: 'pink', d: 0.18, vol: 0.6, filt: { type: 'lowpass', f: 700, q: 1.2 }, send: 0.4 });
  v.nz({ d: 0.012, vol: 0.4, filt: { type: 'bandpass', f: 1800 } });
  // gong swell
  v.fm({ f: 98, ratio: 1.47, index: 3.5, index2: 0.6, a: 0.25, aCurve: 'exp', d: 1.6, vol: 0.35, send: 0.6 });
  v.ring({ f: 196, ratios: [1, 1.48, 2.05, 2.69, 3.42], a: 0.3, d: 1.6, vol: 0.25, send: 0.6 });
  v.nz({ a: 0.4, d: 1.2, vol: 0.08, filt: { type: 'bandpass', f: 2200, q: 1.2 }, send: 0.6 }); // shimmer
  v.tone({ f: 49, a: 0.05, h: 0.4, d: 1.2, vol: 0.4 }); // sub swell
}, { vary: 0 });

def('announceFight', (v) => {
  impact(v, 0, 0.7);
  // power-chord stab A2 E3 A3 E4
  [45, 52, 57, 64].forEach((m, i) => v.tone({
    type: 'sawtooth', f: mtof(m), a: 0.003, h: 0.12, d: 0.7, vol: 0.18, detune: i % 2 ? 7 : -7, dist: 1.5,
    filt: { type: 'lowpass', f: 6000, f2: 700, glide: 0.5, q: 1.5 }, send: 0.35,
  }));
  v.nz({ a: 0.002, d: 1.2, vol: 0.35, filt: { type: 'highpass', f: 4500 }, send: 0.4 }); // crash
  v.nz({ d: 0.25, vol: 0.3, filt: { type: 'bandpass', f: 2500, f2: 800, glide: 0.2, q: 0.8 } });
}, { vary: 0 });

def('countdown', (v) => {
  v.nz({ d: 0.004, vol: 0.4, filt: { type: 'highpass', f: 3000 } });
  v.tone({ f: 1046, d: 0.1, vol: 0.5 });
  v.tone({ type: 'square', f: 2093, d: 0.04, vol: 0.08, filt: { type: 'lowpass', f: 5000 } });
}, { vary: 0 });

def('timeUp', (v) => {
  v.tone({ type: 'square', f: 220, a: 0.008, h: 0.65, d: 0.1, vol: 0.25, filt: { type: 'lowpass', f: 2000 }, trem: [14, 0.35] });
  v.tone({ type: 'square', f: 233, a: 0.008, h: 0.65, d: 0.1, vol: 0.25, filt: { type: 'lowpass', f: 2000 } });
  v.tone({ type: 'sawtooth', f: 110, a: 0.008, h: 0.65, d: 0.1, vol: 0.2, filt: { type: 'lowpass', f: 1200 } });
}, { vary: 0 });

def('victory', (v) => {
  const lead = [[0, 72, 0.09], [0.12, 76, 0.09], [0.24, 79, 0.09], [0.36, 84, 0.28], [0.72, 81, 0.09], [0.84, 83, 0.09], [0.96, 84, 0.75]];
  for (const [at, m, len] of lead) brass(v, at, m, len);
  for (const m of [55, 60, 64]) brass(v, 0.36, m, 0.25, 0.1);
  for (const m of [48, 60, 64, 67]) brass(v, 0.96, m, 0.75, 0.12);
  // drum hits and a cymbal on the last chord
  for (const at of [0, 0.36, 0.96]) {
    v.tone({ at, f: 150, f2: 50, glide: 0.06, d: 0.3, vol: 0.6 });
    v.nz({ at, d: 0.18, vol: 0.35, filt: { type: 'highpass', f: 1200 } });
  }
  v.nz({ at: 0.96, d: 1.2, vol: 0.25, filt: { type: 'highpass', f: 5000 }, send: 0.4 });
  v.ring({ at: 0.96, f: mtof(96), ratios: [1, 2, 3], d: 0.9, vol: 0.05, send: 0.4 });
}, { vary: 0 });

def('defeat', (v) => {
  const lead = (at, m, len, vol = 0.28) => {
    v.tone({ at, type: 'triangle', f: mtof(m), a: 0.02, h: len, d: 0.35, vol, vib: [5, 12], send: 0.3 });
    v.tone({ at, type: 'square', f: mtof(m), a: 0.02, h: len, d: 0.3, vol: vol * 0.25, filt: { type: 'lowpass', f: 1400 }, send: 0.3 });
  };
  for (const [at, m, len] of [[0, 76, 0.24], [0.3, 74, 0.24], [0.6, 72, 0.24], [0.9, 71, 0.2], [1.2, 69, 0.75]]) lead(at, m, len);
  const pad = (at, notes, len) => notes.forEach((m, i) => v.tone({
    at, type: 'sawtooth', f: mtof(m), a: 0.25, h: len, d: 0.6, vol: 0.06, detune: i % 2 ? 8 : -8,
    filt: { type: 'lowpass', f: 900 }, send: 0.4,
  }));
  pad(0, [57, 60, 64], 0.5);
  pad(0.6, [53, 57, 60], 0.45);
  pad(1.2, [45, 57, 60, 64], 0.7);
  v.tone({ at: 1.2, f: mtof(33), a: 0.05, h: 0.6, d: 0.6, vol: 0.4 }); // low A
}, { vary: 0 });

/**
 * Renders sfx `name` into `ac` (any BaseAudioContext) at time `when`.
 * opts: { vol, pitch, reverb (AudioNode send input), raw (ignore level calibration),
 * glue (override the soft-limiter pre-gain; 0 disables) }.
 * Returns the Voice (`.end` is the last stop time).
 */
function renderSfxInto(name, ac, dest, when, opts = {}) {
  const d = SFX[name];
  const lvl = (opts.raw ? 1 : d.level) * (opts.vol ?? 1);
  const glue = opts.glue ?? d.glue;
  const v = new Voice(ac, null, when, { pitch: opts.pitch || 1 });
  v.outGain = v.gain(lvl);
  v.outGain.connect(dest);
  v.dest = v.outGain;
  if (glue) {
    const sh = v.shaper(GLUE_DRIVE);
    sh.connect(v.outGain);
    v.dest = v.chain(v.gain(glue), sh);
  }
  if (opts.reverb) {
    v.revGain = v.gain(lvl);
    v.revGain.connect(opts.reverb);
    v.rev = v.revGain;
  }
  d.fn(v);
  return v;
}

/** name -> (ac, dest, when, opts) synth functions (the documented internal shape). */
const SYNTHS = {};
for (const name of Object.keys(SFX)) {
  SYNTHS[name] = (ac, dest, when, opts) => renderSfxInto(name, ac, dest, when, opts);
}

const SFX_REVERB = { seconds: 2.2, decay: 2.8, ret: 0.55 };

// =============================================================================
// Music: instruments
// Each instrument is (rack, time, ...args) and builds a self-disposing Voice
// routed into one of the rack's buses (drums / bass / tone).
// =============================================================================

const INST = {
  kick(r, t, vel = 1, o = {}) {
    const v = r.voice(t, r.drums);
    const hard = o.hard || 0;
    v.tone({ f: 155 + 70 * hard, f2: 47, glide: 0.055 + 0.02 * hard, a: 0.001, d: 0.36 + 0.14 * hard, vol: vel, dist: 0.6 + 2.6 * hard });
    v.nz({ kind: 'hiss', d: 0.006, vol: 0.15 * vel }); // beater click
    v.done();
  },

  snare(r, t, vel = 1) {
    const v = r.voice(t, r.drums);
    v.tone({ type: 'triangle', f: 240, f2: 170, glide: 0.04, d: 0.12, vol: 0.5 * vel });
    v.nz({ d: 0.2, vol: 0.4 * vel, filt: { type: 'highpass', f: 1200, q: 0.9 }, send: 0.12 });
    v.done();
  },

  clap(r, t, vel = 0.5) {
    vel *= 0.6;
    const v = r.voice(t, r.drums);
    const src = v.noise('white', 0, 0.3);
    const bp = v.filter('bandpass', 1150, 1.3);
    const g = v.gain(0);
    g.gain.setValueAtTime(0, t);
    for (const o of [0, 0.011, 0.022]) {
      g.gain.setValueAtTime(vel, t + o);
      g.gain.exponentialRampToValueAtTime(vel * 0.08, t + o + 0.01);
    }
    g.gain.setValueAtTime(vel * 0.85, t + 0.033);
    g.gain.exponentialRampToValueAtTime(TINY, t + 0.25);
    src.connect(bp);
    bp.connect(g);
    v.out(g, { send: 0.25 });
    v.done();
  },

  hat(r, t, vel = 0.2, open = false) {
    const v = r.voice(t, r.drums);
    v.nz({ kind: 'hiss', d: open ? 0.3 : 0.05, vol: vel, pan: 0.18 });
    v.done();
  },

  shaker(r, t, vel = 0.1) {
    const v = r.voice(t, r.drums);
    v.nz({ kind: 'hiss', a: 0.015, d: 0.05, vol: vel, pan: -0.25 });
    v.done();
  },

  crash(r, t, vel = 0.3) {
    const v = r.voice(t, r.drums);
    v.nz({ kind: 'hiss', a: 0.002, d: 1.9, vol: vel * 0.8, send: 0.3 });
    v.done();
  },

  tom(r, t, f, vel = 0.7) {
    const v = r.voice(t, r.drums);
    v.tone({ f: f * 1.7, f2: f, glide: 0.05, a: 0.001, d: 0.45, vol: vel, dist: 0.7, send: 0.15 });
    v.nz({ kind: 'pink', d: 0.07, vol: 0.35 * vel, filt: { type: 'lowpass', f: 1800 } });
    v.done();
  },

  taiko(r, t, f, vel = 0.8) {
    const v = r.voice(t, r.drums);
    v.tone({ f: f * 1.6, f2: f, glide: 0.05, a: 0.002, d: f < 80 ? 0.9 : 0.5, vol: vel, dist: 0.6, send: 0.25 });
    v.tone({ type: 'triangle', f: f * 2.6, f2: f * 1.6, glide: 0.04, d: 0.16, vol: vel * 0.25 });
    v.nz({ kind: 'pink', d: 0.13, vol: vel * 0.5, filt: { type: 'lowpass', f: 650, q: 1.2 }, send: 0.25 });
    v.nz({ d: 0.012, vol: vel * 0.18, filt: { type: 'bandpass', f: 1600, q: 1 } });
    v.done();
  },

  /** Taiko rim / woodblock "ka". */
  ka(r, t, vel = 0.3) {
    const v = r.voice(t, r.drums);
    v.tone({ f: 1750, f2: 1500, glide: 0.02, d: 0.05, vol: vel * 0.6 });
    v.nz({ d: 0.018, vol: vel, filt: { type: 'bandpass', f: 3000, q: 2.5 }, pan: 0.2 });
    v.done();
  },

  /** Industrial metal hit: 808-style square cluster + FM anvil ping. */
  metal(r, t, vel = 0.25, f = 540, d = 0.22) {
    const v = r.voice(t, r.drums);
    const src = v.reg(r.ac.createBufferSource());
    src.buffer = metalBuffer(r.ac);
    src.playbackRate.value = f / METAL_F0;
    v._play(src, t, t + Math.min(0.45, d + 0.05));
    const bp = v.filter('bandpass', 3800, 1.1);
    const hp = v.filter('highpass', 1600);
    const amp = v.gain(0);
    v.env(amp.gain, 0, 0.001, 0, d, vel);
    src.connect(bp);
    bp.connect(hp);
    hp.connect(amp);
    v.out(amp, { send: 0.25, pan: f > 600 ? 0.3 : -0.3 });
    // anvil ping on the main hits only (ticks stay cheap)
    if (d > 0.1) v.fm({ f: f * 2.3, ratio: 1.41, index: 2.5, index2: 0.2, d: d * 1.2, vol: vel * 0.35, send: 0.2 });
    v.done();
  },

  riser(r, t, len, vel = 0.2) {
    const v = r.voice(t, r.drums);
    v.nz({ a: len, aCurve: 'exp', d: 0.05, vol: vel, filt: { type: 'bandpass', f: 300, f2: 7000, glide: len, q: 2 }, send: 0.35 });
    v.done();
  },

  /** Cinematic low boom. */
  boom(r, t, vel = 0.7) {
    const v = r.voice(t, r.drums);
    v.tone({ f: 85, f2: 28, glide: 0.6, a: 0.003, d: 1.5, vol: vel, dist: 1.8, send: 0.35 });
    v.nz({ kind: 'brown', a: 0.005, d: 1.3, vol: vel * 0.7, filt: { type: 'lowpass', f: 600, f2: 80, glide: 1.1 }, send: 0.4 });
    v.nz({ d: 0.15, vol: vel * 0.4, filt: { type: 'bandpass', f: 1500, f2: 400, glide: 0.12, q: 0.8 }, send: 0.4 });
    v.done();
  },

  gong(r, t, vel = 0.3) {
    const v = r.voice(t, r.drums);
    v.tone({ f: 70, f2: 50, glide: 0.1, d: 0.6, vol: vel * 0.8 }); // mallet
    v.fm({ f: 82, ratio: 1.47, index: 4, index2: 0.4, a: 0.03, d: 3, vol: vel, send: 0.6 });
    v.ring({ f: 165, ratios: [1, 1.52, 2.03, 2.71, 3.4], a: 0.2, d: 2.5, vol: vel * 0.3, send: 0.6 });
    v.done();
  },

  /** Slow airy noise swell (ambience). */
  air(r, t, len, vel = 0.12) {
    const v = r.voice(t, r.tone);
    v.nz({ kind: 'pink', a: len * 0.5, d: len * 0.5, vol: vel, filt: { type: 'bandpass', f: 300, f2: 1300, glide: len * 0.5, f3: 400, q: 1.5 }, send: 0.4 });
    v.done();
  },

  bass(r, t, m, len, o = {}) {
    const v = r.voice(t, r.bass);
    const f = mtof(m);
    const rel = 0.05;
    const dur = len + rel * 1.3 + 0.02;
    const mix = v.gain(0.5);
    v.osc(o.wave || 'sawtooth', f, 0, dur).connect(mix);
    const b = v.osc(o.wave2 || 'sawtooth', f, 0, dur);
    b.detune.value = 8;
    b.connect(mix);
    let n = mix;
    if (o.dist) n = v.chain(n, v.shaper(o.dist));
    const cut = o.cut ?? 400;
    const lp = v.filter('lowpass', cut, o.q ?? 4);
    lp.frequency.setValueAtTime(v.fz(cut + (o.env ?? 1500)), t);
    lp.frequency.exponentialRampToValueAtTime(cut, t + (o.ed ?? 0.1));
    n.connect(lp);
    const amp = v.gain(0);
    lp.connect(amp);
    if (o.sub) {
      const s = v.osc('sine', f, 0, dur);
      s.connect(v.gain(o.sub)).connect(amp);
    }
    v.adsr(amp.gain, 0, 0.004, 0.2, o.sus ?? 0.75, rel, len, o.vel ?? 0.6);
    v.out(amp);
    v.done();
  },

  sub(r, t, m, len, vel = 0.3) {
    const v = r.voice(t, r.bass);
    const rel = 0.6;
    const osc = v.osc('sine', mtof(m), 0, len + rel * 1.3 + 0.03);
    const amp = v.gain(0);
    v.adsr(amp.gain, 0, 0.3, 0, 1, rel, len, vel);
    osc.connect(amp);
    v.out(amp);
    v.done();
  },

  /** Detuned-saw pad with a slow filter swell. */
  pad(r, t, notes, len, o = {}) {
    const v = r.voice(t, r.tone);
    const a = o.a ?? 0.6;
    const rel = o.r ?? 0.8;
    const cut = o.cut ?? 1200;
    const dur = len + rel * 1.3 + 0.05;
    const sum = v.gain(1 / (2 * Math.sqrt(notes.length)));
    notes.forEach((m, i) => {
      for (const det of [-9, 9]) {
        const osc = v.osc(o.wave || 'sawtooth', mtof(m), 0, dur);
        osc.detune.value = det + (i % 2 ? 2 : -2);
        osc.connect(sum);
      }
    });
    // filter opens during the attack, then stays put (static filters are cheap)
    const lp = v.filter('lowpass', cut * 0.55, o.q ?? 0.7);
    lp.frequency.setValueAtTime(cut * 0.55, t);
    lp.frequency.linearRampToValueAtTime(cut, t + a);
    sum.connect(lp);
    const amp = v.gain(0);
    v.adsr(amp.gain, 0, a, 0, 1, rel, len, o.vel ?? 0.3);
    lp.connect(amp);
    v.out(amp, { send: o.send ?? 0.35, dly: o.dly || 0 });
    v.done();
  },

  /** Choir-ish pad: detuned saws with vibrato through an "ah" formant bank. */
  choir(r, t, notes, len, o = {}) {
    const v = r.voice(t, r.tone);
    const a = o.a ?? 0.35;
    const rel = o.r ?? 0.7;
    const dur = len + rel * 1.3 + 0.05;
    const sum = v.gain(1 / (2 * Math.sqrt(notes.length)));
    const vib = v.osc('sine', 5.2, 0, dur);
    const vibG = v.gain(0);
    vib.connect(vibG);
    vibG.gain.setValueAtTime(0, t);
    vibG.gain.linearRampToValueAtTime(14, t + 0.6);
    for (const m of notes) {
      for (const det of [-10, 10]) {
        const osc = v.osc('sawtooth', mtof(m), 0, dur);
        osc.detune.value = det;
        vibG.connect(osc.detune);
        osc.connect(sum);
      }
    }
    const form = v.gain(1);
    for (const [f, q, g] of [[650, 7, 1], [1080, 9, 0.6], [2650, 11, 0.35]]) {
      const bp = v.filter('bandpass', f, q);
      sum.connect(bp);
      bp.connect(v.gain(g * 3)).connect(form);
    }
    const body = v.filter('lowpass', 500, 0.5);
    sum.connect(body);
    body.connect(v.gain(0.35)).connect(form);
    const amp = v.gain(0);
    v.adsr(amp.gain, 0, a, 0, 1, rel, len, o.vel ?? 0.35);
    form.connect(amp);
    v.out(amp, { send: o.send ?? 0.5 });
    v.done();
  },

  /** Brass-like chord stab with a snappy filter envelope. */
  stab(r, t, notes, len, o = {}) {
    const v = r.voice(t, r.tone);
    const rel = 0.12;
    const dur = len + rel * 1.3 + 0.03;
    const sum = v.gain(1 / (2 * Math.sqrt(notes.length)));
    for (const m of notes) {
      for (const det of [-8, 8]) {
        const osc = v.osc('sawtooth', mtof(m), 0, dur);
        osc.detune.value = det;
        osc.connect(sum);
      }
    }
    let n = sum;
    if (o.dist) n = v.chain(n, v.shaper(o.dist));
    const cut = o.cut ?? 600;
    const lp = v.filter('lowpass', cut, o.q ?? 1.5);
    lp.frequency.setValueAtTime(cut, t);
    lp.frequency.linearRampToValueAtTime(o.peak ?? 4200, t + 0.015);
    lp.frequency.setTargetAtTime(cut, t + 0.015, (o.fd ?? 0.25) / 3);
    n.connect(lp);
    const amp = v.gain(0);
    v.adsr(amp.gain, 0, 0.006, 0.25, 0.55, rel, len, o.vel ?? 0.25);
    lp.connect(amp);
    v.out(amp, { send: o.send ?? 0.3, dly: o.dly || 0 });
    v.done();
  },

  /** Short plucky arpeggio note. */
  arp(r, t, m, len, o = {}) {
    const v = r.voice(t, r.tone);
    const d = len + 0.12;
    const osc = v.osc(o.wave || 'square', mtof(m), 0, d + 0.03);
    const lp = v.filter('lowpass', o.cut ?? 3000, o.q ?? 1.2);
    lp.frequency.setValueAtTime(v.fz(o.cut ?? 3000), t);
    lp.frequency.exponentialRampToValueAtTime(o.cut2 ?? 700, t + d);
    const amp = v.gain(0);
    v.env(amp.gain, 0, 0.003, 0, d, o.vel ?? 0.15);
    osc.connect(lp);
    lp.connect(amp);
    v.out(amp, { dly: o.dly ?? 0.3, send: o.send || 0, pan: o.pan || 0 });
    v.done();
  },

  /** Two-oscillator lead with delayed vibrato. */
  lead(r, t, m, len, o = {}) {
    const v = r.voice(t, r.tone);
    const f = mtof(m);
    const rel = o.r ?? 0.12;
    const dur = len + rel * 1.3 + 0.03;
    const vib = v.osc('sine', 5.5, 0, dur);
    const vg = v.gain(0);
    vib.connect(vg);
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(0, t + 0.15);
    vg.gain.linearRampToValueAtTime(o.vib ?? 16, t + 0.45);
    const sum = v.gain(0.5);
    const waves = [o.wave || 'sawtooth', o.wave2 || 'sawtooth'];
    [-7, 7].forEach((det, i) => {
      const osc = v.osc(waves[i], f, 0, dur);
      osc.detune.value = det;
      vg.connect(osc.detune);
      osc.connect(sum);
    });
    let n = sum;
    if (o.dist) n = v.chain(n, v.shaper(o.dist));
    const lp = v.filter('lowpass', o.cut ?? 2600, o.q ?? 1.2);
    n.connect(lp);
    const amp = v.gain(0);
    v.adsr(amp.gain, 0, o.a ?? 0.012, 0.25, 0.7, rel, len, o.vel ?? 0.18);
    lp.connect(amp);
    v.out(amp, { dly: o.dly ?? 0.3, send: o.send ?? 0.2, pan: o.pan || 0 });
    v.done();
  },

  /** Koto-ish pluck: triangle + saw, falling filter, slight pitch bend into the note. */
  pluck(r, t, m, len, o = {}) {
    const v = r.voice(t, r.tone);
    const f = mtof(m);
    const vel = o.vel ?? 0.5;
    const dec = o.decay ?? clamp(0.4 + len, 0.4, 1.4);
    const amp = v.gain(0);
    v.env(amp.gain, 0, 0.002, 0, dec, vel);
    if (o.lite) {
      // tremolo re-strike: a bare triangle is enough under the main pluck
      v.osc('triangle', f, 0, dec + 0.03).connect(amp);
      v.out(amp, { pan: o.pan || 0 });
      v.done();
      return;
    }
    const tri = v.osc('triangle', f * 1.015, 0, dec + 0.03, f, 0.025);
    const saw = v.osc('sawtooth', f * 1.015, 0, dec + 0.03, f, 0.025);
    const sg = v.gain(0.4);
    saw.connect(sg);
    const lp = v.filter('lowpass', 1000, 2.5);
    lp.frequency.setValueAtTime(v.fz(o.bright ?? 5000), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(300, f * 1.5), t + dec * 0.5);
    tri.connect(lp);
    sg.connect(lp);
    lp.connect(amp);
    v.out(amp, { dly: o.dly ?? 0.25, send: o.send ?? 0.3, pan: o.pan || 0 });
    v.nz({ d: 0.015, vol: 0.2 * vel, filt: { type: 'bandpass', f: 3200, q: 1.5 }, pan: o.pan || 0 });
    v.done();
  },

  bell(r, t, m, o = {}) {
    const v = r.voice(t, r.tone);
    const f = mtof(m);
    const d = o.d ?? 1.8;
    const vel = o.vel ?? 0.2;
    v.fm({ f, ratio: o.ratio ?? 3.5, index: o.index ?? 1.6, index2: 0.05, d, vol: vel, send: o.send ?? 0.45, dly: o.dly ?? 0.3, pan: o.pan || 0 });
    v.tone({ f: f * 2.005, d: d * 0.35, vol: vel * 0.18, pan: o.pan || 0 });
    v.done();
  },

  /** Breathy shakuhachi-style flute: scooped sine + breath noise + delayed vibrato. */
  flute(r, t, m, len, o = {}) {
    const v = r.voice(t, r.tone);
    const f = mtof(m);
    const rel = 0.2;
    const dur = len + rel * 1.3 + 0.03;
    const sum = v.gain(1);
    const osc = v.osc('sine', f * 0.97, 0, dur, f, 0.08);
    osc.connect(sum);
    v.osc('triangle', f * 2 * 0.97, 0, dur, f * 2, 0.08).connect(v.gain(0.08)).connect(sum);
    const vib = v.osc('sine', 5, 0, dur);
    const vg = v.gain(0);
    vib.connect(vg);
    vg.connect(osc.detune);
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(18, t + 0.5);
    const br = v.noise('white', 0, dur);
    const bf = v.filter('bandpass', f * 2, 3);
    br.connect(bf);
    bf.connect(v.gain(0.35)).connect(sum);
    const amp = v.gain(0);
    v.adsr(amp.gain, 0, 0.09, 0.2, 0.8, rel, len, o.vel ?? 0.15);
    sum.connect(amp);
    v.out(amp, { send: o.send ?? 0.45, dly: o.dly ?? 0.25 });
    v.done();
  },
};

// =============================================================================
// Music: tracks
// Each track: { bpm, bars (loop length), seed, cut: [filter at I=0, at I=1],
// mix, step(rack, bar, step16, time, stepDur) }.
// =============================================================================

/** { bar: [[step, midi, lenSteps], ...] } -> Map(bar*16+step -> [midi, len]) */
function mel(bars) {
  const m = new Map();
  for (const [bar, notes] of Object.entries(bars)) {
    for (const [s, n, len] of notes) m.set(Number(bar) * 16 + s, [n, len]);
  }
  return m;
}

// ---- menu: D minor, moody pads + gentle arp ------------------------------------
const MENU_PROG = [ // 2 bars each
  { root: 38, pad: [53, 57, 60, 64] }, // Dm9
  { root: 34, pad: [50, 53, 57, 60] }, // Bbmaj7
  { root: 31, pad: [53, 55, 58, 62] }, // Gm9
  { root: 33, pad: [52, 55, 57, 61] }, // A7sus
  { root: 34, pad: [50, 53, 57, 62] }, // Bbmaj7
  { root: 36, pad: [52, 55, 60, 62] }, // Cadd9
  { root: 38, pad: [53, 57, 60, 64] }, // Dm9
  { root: 33, pad: [52, 57, 61, 64] }, // A
];
const MENU_MEL = mel({
  8: [[0, 74, 6], [6, 77, 2], [8, 76, 4], [12, 74, 4]],
  9: [[0, 72, 8], [8, 69, 8]],
  10: [[0, 76, 6], [6, 79, 2], [8, 77, 4], [12, 76, 4]],
  11: [[0, 74, 12]],
  12: [[0, 77, 4], [4, 81, 4], [8, 79, 4], [12, 77, 4]],
  13: [[0, 76, 8], [8, 74, 8]],
  14: [[0, 73, 8], [8, 76, 8]],
  15: [[0, 69, 12]],
});

// ---- battle1: A minor synthwave / DnB drive ----------------------------------------
const B1_PROG = [ // 2 bars each
  { root: 33, tri: [57, 60, 64] }, // Am
  { root: 29, tri: [57, 60, 65] }, // F
  { root: 36, tri: [55, 60, 64] }, // C
  { root: 31, tri: [55, 59, 62] }, // G
  { root: 38, tri: [57, 62, 65] }, // Dm
  { root: 29, tri: [57, 60, 65] }, // F
  { root: 36, tri: [55, 60, 64] }, // C
  { root: 28, tri: [56, 59, 64] }, // E
];
const B1_BASS_A = [0, 0, 12, 0, 0, 0, 12, 0, 0, 0, 12, 0, 0, 12, 0, 12];
const B1_BASS_B = [0, null, 0, 12, 0, null, 12, 0, 0, null, 0, 12, 0, 12, 7, 12];
const B1_MEL = mel({
  4: [[0, 76, 3], [3, 74, 3], [6, 72, 2], [8, 74, 4], [12, 76, 4]],
  5: [[0, 79, 6], [6, 76, 2], [8, 74, 8]],
  6: [[0, 74, 3], [3, 72, 3], [6, 71, 2], [8, 72, 4], [12, 74, 4]],
  7: [[0, 71, 6], [6, 67, 2], [8, 69, 8]],
  12: [[0, 79, 3], [3, 76, 3], [6, 72, 2], [8, 76, 4], [12, 79, 4]],
  13: [[0, 81, 6], [6, 79, 2], [8, 76, 8]],
  14: [[0, 80, 3], [3, 76, 3], [6, 71, 2], [8, 76, 4], [12, 80, 4]],
  15: [[0, 83, 8], [8, 81, 4], [12, 80, 4]],
});

// ---- battle2: D "In" scale (D Eb G A Bb), taiko + koto -------------------------------
const B2_DRONE = [ // 2 bars each
  [38, 45, 50], [38, 45, 50], [38, 45, 50], [38, 45, 50],
  [34, 41, 46], [39, 46, 51], [43, 50, 55], [33, 45, 50],
];
const B2_ROOT = [38, 38, 38, 38, 34, 39, 31, 33];
const B2_BASS = { 0: 0, 3: 0, 6: 7, 8: 12, 11: 0, 14: 7 };
const B2_MEL = mel({
  0: [[0, 69, 2], [2, 74, 2], [4, 75, 4], [8, 74, 2], [10, 69, 2], [12, 70, 4]],
  1: [[0, 69, 6], [6, 67, 2], [8, 69, 8]],
  2: [[0, 74, 2], [2, 75, 2], [4, 79, 4], [8, 81, 2], [10, 79, 2], [12, 75, 4]],
  3: [[0, 74, 12]],
  4: [[0, 69, 2], [2, 74, 2], [4, 75, 4], [8, 74, 2], [10, 69, 2], [12, 70, 4]],
  5: [[0, 69, 6], [6, 67, 2], [8, 69, 8]],
  6: [[0, 74, 2], [2, 75, 2], [4, 79, 4], [8, 81, 2], [10, 82, 2], [12, 81, 4]],
  7: [[0, 74, 4], [4, 75, 2], [6, 74, 2], [8, 69, 8]],
  8: [[0, 82, 4], [4, 81, 4], [8, 79, 2], [10, 81, 2], [12, 82, 4]],
  9: [[0, 86, 8], [8, 82, 4], [12, 81, 4]],
  10: [[0, 79, 4], [4, 75, 4], [8, 74, 4], [12, 75, 4]],
  11: [[0, 79, 12]],
  12: [[0, 81, 4], [4, 82, 2], [6, 81, 2], [8, 79, 4], [12, 75, 4]],
  13: [[0, 74, 6], [6, 75, 2], [8, 79, 8]],
  14: [[0, 81, 2], [2, 79, 2], [4, 75, 2], [6, 74, 2], [8, 70, 4], [12, 69, 4]],
  15: [[0, 74, 8]],
});
const B2_FLUTE = mel({
  8: [[0, 74, 15]],
  10: [[0, 75, 8], [8, 74, 7]],
  12: [[0, 69, 15]],
  14: [[0, 67, 8], [8, 69, 7]],
});

// ---- battle3: F# phrygian industrial ----------------------------------------------------
const B3_ROOT = [30, 30, 30, 30, 30, 30, 30, 30, 38, 38, 40, 40, 30, 30, 31, 31];
const B3_RIFF_A = [0, 0, 12, 0, 0, 1, 0, 0, 0, 0, 12, 0, 3, 0, 1, 0];
const B3_RIFF_B = [0, null, 0, 12, null, 0, 1, 0, 0, null, 0, 12, 0, 3, 1, null];
const B3_LEAD = mel({
  12: [[0, 78, 3], [3, 79, 3], [6, 81, 2], [8, 79, 3], [11, 78, 3], [14, 76, 2]],
  13: [[0, 78, 6], [6, 73, 2], [8, 74, 4], [12, 73, 4]],
  14: [[0, 79, 3], [3, 81, 3], [6, 83, 2], [8, 81, 3], [11, 79, 3], [14, 78, 2]],
  15: [[0, 79, 8], [8, 78, 8]],
});

// ---- boss: E phrygian, choir + ostinato + heavy drums -----------------------------------
const BOSS_PROG = [ // 2 bars each
  { root: 28, ch: [52, 55, 59, 64] }, // Em
  { root: 29, ch: [53, 57, 60, 65] }, // F
  { root: 31, ch: [55, 59, 62, 67] }, // G
  { root: 29, ch: [53, 57, 60, 65] }, // F
  { root: 33, ch: [57, 60, 64, 69] }, // Am
  { root: 29, ch: [53, 57, 60, 65] }, // F
  { root: 38, ch: [53, 57, 62, 65] }, // Dm
  { root: 28, ch: [52, 56, 59, 64] }, // E (major: phrygian dominant pull)
];
const BOSS_RIFF = [0, 0, 12, 0, 7, 0, 12, 7];
const BOSS_RIFF_E = [0, 1, 0, 4, 0, 1, 7, 1];
const BOSS_MEL = mel({
  8: [[0, 69, 4], [4, 72, 4], [8, 76, 8]],
  9: [[0, 74, 4], [4, 72, 4], [8, 71, 4], [12, 72, 4]],
  10: [[0, 69, 8], [8, 77, 8]],
  11: [[0, 76, 4], [4, 74, 4], [8, 72, 8]],
  12: [[0, 74, 4], [4, 77, 4], [8, 81, 8]],
  13: [[0, 79, 4], [4, 77, 4], [8, 76, 4], [12, 74, 4]],
  14: [[0, 76, 8], [8, 80, 8]],
  15: [[0, 83, 4], [4, 81, 4], [8, 80, 4], [12, 77, 4]],
});

// ---- tower: A minor ambience ------------------------------------------------------------
const TOWER_PROG = [ // 4 bars each
  { root: 33, pad: [57, 60, 64, 71] }, // Am9
  { root: 29, pad: [57, 60, 64, 67] }, // Fmaj9
  { root: 36, pad: [55, 59, 64, 67] }, // Cmaj7
  { root: 28, pad: [55, 59, 62, 69] }, // Em7(11)
];
const TOWER_BELLS = [69, 72, 74, 76, 79, 81, 84];

const TRACKS = {
  menu: {
    bpm: 100, bars: 16, seed: 11, cut: [5500, 13000],
    mix: { master: 0.74, drums: 0.52, bass: 0.21, tone: 0.49, reverb: 0.6, delay: 0.5 },
    step(r, bar, s, t, sd) {
      const ch = MENU_PROG[(bar >> 1) & 7];
      const B = bar >= 8;
      const hum = 0.9 + 0.2 * r.rand(bar, s, 1);
      if (s === 0 && (bar & 1) === 0) {
        INST.pad(r, t, ch.pad, sd * 32, { vel: 0.3, cut: B ? 1700 : 1200, a: 1.0, r: 1.4, send: 0.45 });
      }
      // arpeggio: 8ths in A, 16ths in B
      if (B || (s & 1) === 0) {
        const src = [ch.pad[0], ch.pad[1], ch.pad[2], ch.pad[3], ch.pad[1] + 12, ch.pad[2] + 12];
        const ord = [0, 2, 1, 3, 2, 4, 3, 5, 4, 2, 3, 1];
        const i = B ? bar * 16 + s : bar * 8 + (s >> 1);
        INST.arp(r, t, src[ord[i % ord.length]] + 12, sd * (B ? 1.2 : 2), {
          vel: (s % 4 === 0 ? 0.16 : 0.11) * hum, cut: 2400, cut2: 600, dly: 0.4, pan: i % 2 ? 0.25 : -0.25,
        });
      }
      // drums
      const fill = (bar & 7) === 7 && s >= 12;
      if (bar >= 2 && !fill && (s === 0 || s === 10 || ((bar & 1) && s === 7))) INST.kick(r, t, 0.75 * hum);
      if (bar >= 4 && (s === 4 || s === 12)) INST.snare(r, t, 0.38 * hum);
      if (fill) INST.snare(r, t, 0.12 + 0.07 * (s - 12));
      if ((s & 1) === 0) INST.hat(r, t, (s % 4 === 2 ? 0.13 : 0.08) * hum, B && s === 14 && (bar & 1) === 1);
      else if (B && r.rand(bar, s, 2) < 0.5) INST.hat(r, t, 0.04);
      if (s === 0 && bar === 8) INST.crash(r, t, 0.18);
      if (bar === 7 && s === 8) INST.riser(r, t, sd * 8, 0.1);
      // bass: pulsing 8ths from bar 4
      if (bar >= 4 && (s & 1) === 0) {
        INST.bass(r, t, ch.root + ((s & 7) === 6 ? 12 : 0), sd * 1.5, {
          vel: (s % 4 === 0 ? 0.55 : 0.4) * hum, cut: 260, env: 700, ed: 0.15, q: 2, sub: 0.7,
        });
      }
      const n = MENU_MEL.get(bar * 16 + s);
      if (n) INST.lead(r, t, n[0], n[1] * sd, { vel: 0.2, wave: 'triangle', wave2: 'square', cut: 2200, dly: 0.35, send: 0.3 });
    },
  },

  battle1: {
    bpm: 140, bars: 16, seed: 23, cut: [6000, 18000],
    mix: { master: 0.72, drums: 0.66, bass: 0.24, tone: 0.84, reverb: 0.45, delay: 0.4 },
    step(r, bar, s, t, sd) {
      const ch = B1_PROG[(bar >> 1) & 7];
      const B = bar >= 8;
      const I = r.I;
      const hum = 0.9 + 0.2 * r.rand(bar, s, 1);
      const bigFill = (bar & 7) === 7 && s >= 8;
      const smallFill = (bar & 3) === 3 && !bigFill && s > 12;
      // drums
      if (bigFill) {
        const tf = { 8: 210, 10: 180, 12: 150, 13: 140, 14: 120, 15: 100 }[s];
        if (tf) INST.tom(r, t, tf, 0.7);
        if (s === 8) INST.kick(r, t, 0.9);
        if (s >= 12) INST.snare(r, t, 0.3 + 0.1 * (s - 12));
      } else {
        const kick = s === 0 || s === 10 || (B ? s === 6 : (bar & 1) === 1 && s === 7) || (I > 0.66 && s === 14);
        if (kick) INST.kick(r, t, 0.95 * hum);
        if (s === 4 || s === 12) INST.snare(r, t, 0.8 * hum);
        if (smallFill) INST.snare(r, t, 0.2 + 0.1 * (s - 12));
      }
      if ((s & 1) === 0) INST.hat(r, t, (s % 4 === 2 ? 0.22 : 0.13) * hum, s === 14 && (bar & 1) === 1);
      else if (B || I > 0.33) INST.hat(r, t, (0.05 + 0.07 * I) * hum);
      if (I > 0.5 && (s === 4 || s === 12)) INST.clap(r, t, 0.35);
      if (s === 0 && (bar === 0 || bar === 8)) INST.crash(r, t, 0.3);
      if (bar === 15 && s === 0) INST.riser(r, t, sd * 16, 0.18);
      // rolling bass
      const off = (B ? B1_BASS_B : B1_BASS_A)[s];
      if (off !== null) {
        INST.bass(r, t, ch.root + off, sd * 0.9, {
          vel: (s % 4 === 0 ? 0.7 : 0.5) * hum, cut: 260 + 700 * I, env: 1700, ed: 0.08, q: 6, sub: 0.55,
        });
      }
      if (s === 0 && (bar & 1) === 0) {
        INST.pad(r, t, ch.tri.map((n) => n - 12).concat(ch.tri[0]), sd * 32, { vel: 0.2, cut: 900 + 900 * I, a: 0.4, r: 0.6 });
      }
      // arp: B section, or whenever intensity is up
      if (B || I > 0.5) {
        const src = [ch.tri[0], ch.tri[1], ch.tri[2], ch.tri[0] + 12, ch.tri[1] + 12, ch.tri[2] + 12];
        const ord = [0, 1, 2, 3, 4, 5, 4, 3];
        INST.arp(r, t, src[ord[s & 7]] + (I > 0.75 ? 12 : 0), sd * 0.9, {
          vel: 0.11 * hum, wave: 'sawtooth', cut: 3000 + 2000 * I, cut2: 900, dly: 0.25, pan: s & 1 ? 0.3 : -0.3,
        });
      }
      const n = B1_MEL.get(bar * 16 + s);
      if (n) INST.lead(r, t, n[0], n[1] * sd * 0.95, { vel: 0.17, cut: 2800, dly: 0.3, send: 0.15 });
    },
  },

  battle2: {
    bpm: 128, bars: 16, seed: 37, cut: [5000, 16000],
    mix: { master: 0.78, drums: 0.41, bass: 0.95, tone: 0.46, reverb: 0.55, delay: 0.4 },
    step(r, bar, s, t, sd) {
      const k = (bar >> 1) & 7;
      const B = bar >= 8;
      const I = r.I;
      const hum = 0.9 + 0.2 * r.rand(bar, s, 1);
      const bigFill = (bar & 7) === 7 && s >= 8;
      const smallFill = (bar & 3) === 3 && !bigFill && s >= 12;
      // taiko ensemble
      if (bigFill) {
        if ((s & 1) === 0) INST.taiko(r, t, 62, 0.5 + 0.06 * (s - 8));
        else INST.taiko(r, t, 105, 0.35 + 0.05 * (s - 8));
      } else if (smallFill) {
        INST.taiko(r, t, 105, 0.35 + 0.12 * (s - 12));
        if (s === 12) INST.taiko(r, t, 62, 0.8);
      } else {
        const big = B ? [0, 3, 6, 8, 11, 14] : [0, 6, 8];
        const mid = B ? [4, 12, 15] : [3, 11, 14];
        if (big.includes(s)) INST.taiko(r, t, 62, (s === 0 || s === 8 ? 0.95 : 0.6) * hum);
        if (mid.includes(s) || (I > 0.66 && (s === 7 || s === 15))) INST.taiko(r, t, 108, 0.5 * hum);
      }
      const ka = B ? (s & 1) === 1 : s === 2 || s === 10 || s === 13;
      if (ka || (I > 0.66 && (s & 3) === 2)) INST.ka(r, t, (B ? 0.18 : 0.3) * hum);
      if (B || I > 0.33) INST.shaker(r, t, (s % 4 === 2 ? 0.1 : 0.05) * (0.6 + I));
      if (s === 0 && (bar === 0 || bar === 8)) INST.gong(r, t, 0.3);
      // drone
      if (s === 0 && (bar & 1) === 0) INST.pad(r, t, B2_DRONE[k], sd * 32, { vel: 0.22, cut: 650 + 500 * I, a: 0.8, r: 1.0, send: 0.4 });
      // low plucked bass
      if (B2_BASS[s] !== undefined) {
        INST.pluck(r, t, B2_ROOT[k] + B2_BASS[s], sd * 2, { vel: 0.55 * hum, decay: 0.5, bright: 1600, dly: 0, send: 0.1 });
      }
      // koto melody (long notes become tremolo)
      const n = B2_MEL.get(bar * 16 + s);
      if (n) {
        INST.pluck(r, t, n[0], n[1] * sd, { vel: 0.42, pan: -0.15 });
        if (n[1] >= 8) {
          for (let j = 1; j < n[1] - 1; j++) INST.pluck(r, t + j * sd, n[0], sd, { vel: 0.3 - j * 0.012, decay: 0.3, pan: -0.15, lite: true });
        }
        if (I > 0.66) INST.pluck(r, t, n[0] + 12, n[1] * sd, { vel: 0.18, pan: 0.3, dly: 0.35 });
      }
      const fl = B2_FLUTE.get(bar * 16 + s);
      if (fl) INST.flute(r, t, fl[0], fl[1] * sd, { vel: 0.13 });
    },
  },

  battle3: {
    bpm: 150, bars: 16, seed: 41, cut: [5000, 18000],
    mix: { master: 0.68, drums: 0.39, bass: 0.2, tone: 0.9, reverb: 0.4, delay: 0.35 },
    step(r, bar, s, t, sd) {
      const B = bar >= 8;
      const I = r.I;
      const root = B3_ROOT[bar];
      const hum = 0.9 + 0.2 * r.rand(bar, s, 1);
      const bigFill = (bar & 7) === 7 && s >= 8;
      const smallFill = (bar & 3) === 3 && !bigFill && s >= 12;
      // four-on-the-floor + pickups
      if ((s & 3) === 0 && !(bigFill && s >= 12)) INST.kick(r, t, hum, { hard: 1 });
      if (((bar & 1) && s === 14) || (B && s === 7)) INST.kick(r, t, 0.7, { hard: 1 });
      if (s === 4 || s === 12) {
        INST.snare(r, t, 0.75 * hum);
        INST.clap(r, t, 0.45);
      }
      if (bigFill || smallFill) { // stutter
        INST.snare(r, t, 0.22 + 0.05 * (s - 8));
        INST.snare(r, t + sd / 2, 0.18 + 0.05 * (s - 8));
      }
      if ((bar === 7 || bar === 15) && s === 0) INST.riser(r, t, sd * 16, 0.2);
      if (s === 0 && (bar === 0 || bar === 8)) INST.crash(r, t, 0.3);
      // metallic percussion
      const metal = B ? [2, 5, 7, 10, 13, 15] : [2, 7, 10, 15];
      if (metal.includes(s)) INST.metal(r, t, (s === 7 || s === 15 ? 0.3 : 0.22) * hum, s & 1 ? 700 : 540);
      if (I > 0.33 && (s & 1)) INST.metal(r, t, 0.05 + 0.06 * I, 1300, 0.05);
      INST.hat(r, t, ((s & 3) === 2 ? 0.16 : 0.07) * hum);
      // distorted bass riff
      const off = (B ? B3_RIFF_B : B3_RIFF_A)[s];
      if (off !== null) {
        INST.bass(r, t, root + off, sd * 0.8, {
          wave: 'sawtooth', wave2: 'square', dist: 5, cut: 380 + 900 * I, env: 2400, ed: 0.07, q: 7, sub: 0.6,
          vel: (s % 4 === 0 ? 0.62 : 0.45) * hum,
        });
      }
      if (s === 0 && (bar & 3) === 0) INST.pad(r, t, [root + 24, root + 31, root + 37], sd * 64, { vel: 0.16, cut: 800 + 800 * I, a: 1.2, r: 1.0 });
      // stabs in the B section
      if (bar >= 8 && bar < 12 && (s === 0 || s === 3 || s === 6 || ((bar & 1) && s === 10))) {
        INST.stab(r, t, [root + 24, root + 31, root + 36, root + 37], sd * 1.5, { vel: 0.22, dist: 2, dly: 0.3 });
      }
      if (I > 0.66) {
        INST.arp(r, t, root + 36 + [0, 12, 7, 12, 1, 12, 7, 3][s & 7], sd * 0.8, { vel: 0.08, wave: 'square', cut: 4000, cut2: 1000, dly: 0.2 });
      }
      const n = B3_LEAD.get(bar * 16 + s);
      if (n) INST.lead(r, t, n[0], n[1] * sd * 0.95, { vel: 0.15, wave: 'sawtooth', wave2: 'square', cut: 2400, q: 3, dly: 0.35, dist: 1.5 });
    },
  },

  boss: {
    bpm: 160, bars: 16, seed: 53, cut: [5500, 18000],
    mix: { master: 0.65, drums: 0.51, bass: 0.2, tone: 0.71, reverb: 0.5, delay: 0.35 },
    step(r, bar, s, t, sd) {
      const k = (bar >> 1) & 7;
      const ch = BOSS_PROG[k];
      const B = bar >= 8;
      const I = r.I;
      const hum = 0.9 + 0.2 * r.rand(bar, s, 1);
      const bigFill = (bar & 7) === 7 && s >= 8;
      const tomFill = (bar & 3) === 3 && !bigFill && s >= 8;
      if (s === 0 && (bar === 0 || bar === 8)) {
        INST.boom(r, t, 0.65);
        INST.crash(r, t, 0.35);
      }
      if (s === 0 && bar === 12) INST.crash(r, t, 0.25);
      // drums
      if (bigFill) {
        INST.snare(r, t, 0.25 + 0.07 * (s - 8));
        if ((s & 1) === 0) INST.kick(r, t, 0.8);
        if (s === 8) INST.riser(r, t, sd * 8, 0.2);
      } else if (tomFill) {
        INST.tom(r, t, 230 - (s - 8) * 17, 0.6 + 0.03 * (s - 8));
        if ((s & 3) === 0) INST.kick(r, t, 0.9);
      } else if (!B) {
        if (s === 0 || s === 3 || s === 10 || (I > 0.5 && s === 14)) INST.kick(r, t, hum);
        if (s === 8) INST.snare(r, t, 0.9 * hum);
        if (I > 0.6 && (s & 1) === 1) INST.kick(r, t, 0.45);
      } else {
        const dbl = bar === 12 || bar === 13 || I > 0.6;
        if (s === 0 || s === 2 || s === 8 || s === 10 || (dbl && s !== 4 && s !== 12)) INST.kick(r, t, (s & 1 ? 0.55 : 1) * hum);
        if (s === 4 || s === 12) INST.snare(r, t, 0.9 * hum);
      }
      if (B || I > 0.33) INST.hat(r, t, ((s & 3) === 2 ? 0.16 : 0.07) * hum);
      else if ((s & 1) === 0) INST.hat(r, t, (s % 4 === 2 ? 0.16 : 0.1) * hum);
      // choir + brass
      if (s === 0 && (bar & 1) === 0) INST.choir(r, t, ch.ch, sd * 32, { vel: 0.35, a: 0.3, r: 0.6 });
      if ((s === 0 && (bar & 1) === 0) || (B && s === 10 && (bar & 1) === 1)) {
        INST.stab(r, t, ch.ch.map((n) => n - 12), sd * 3, { vel: 0.22 });
      }
      // string ostinato (8ths; 16ths with octave at high intensity)
      const riff = k === 7 ? BOSS_RIFF_E : BOSS_RIFF;
      if ((s & 1) === 0 || I > 0.6) {
        INST.arp(r, t, ch.root + 24 + riff[(s >> 1) & 7] + (s & 1 ? 12 : 0), sd * 0.8, {
          vel: 0.13 * hum, wave: 'sawtooth', cut: 2200 + 2000 * I, cut2: 600, dly: 0.1,
        });
      }
      if ((s & 1) === 0) {
        INST.bass(r, t, ch.root + ((s & 7) === 6 ? 12 : 0), sd * 1.6, { vel: 0.6 * hum, cut: 240 + 500 * I, env: 1200, ed: 0.1, q: 3, sub: 0.7, dist: 1.5 });
      }
      const n = BOSS_MEL.get(bar * 16 + s);
      if (n) INST.lead(r, t, n[0] + (I > 0.8 ? 12 : 0), n[1] * sd * 0.95, { vel: 0.17, cut: 3000, dly: 0.3, send: 0.25 });
    },
  },

  tower: {
    bpm: 90, bars: 16, seed: 67, cut: [4500, 10000],
    mix: { master: 0.8, drums: 0.63, bass: 0.23, tone: 0.58, reverb: 0.7, delay: 0.5 },
    step(r, bar, s, t, sd) {
      const ch = TOWER_PROG[(bar >> 2) & 3];
      const B = bar >= 8;
      if (s === 0 && (bar & 3) === 0) {
        INST.pad(r, t, ch.pad, sd * 64, { vel: 0.3, cut: 1100 + 600 * r.I, a: 2.2, r: 2.5, send: 0.6 });
        INST.sub(r, t, ch.root + 12, sd * 64, 0.3);
      }
      if (s === 0 && (bar === 0 || bar === 8)) {
        INST.air(r, t, sd * 64, 0.12);
        INST.bell(r, t, 45, { vel: 0.2, ratio: 1.4, d: 4, send: 0.7, dly: 0.2 });
      }
      // sparse bells (deterministic per position)
      if ([0, 3, 6, 8, 10, 12, 14].includes(s) && r.rand(bar, s, 3) < (B ? 0.38 : 0.26)) {
        const m = TOWER_BELLS[Math.floor(r.rand(bar, s, 4) * TOWER_BELLS.length)];
        INST.bell(r, t, m, { vel: 0.13 + 0.06 * r.rand(bar, s, 5), d: 2.2, dly: 0.45, send: 0.5, pan: r.rand(bar, s, 6) * 0.8 - 0.4 });
      }
      if (bar >= 4 && s === 0) INST.kick(r, t, 0.5);
      if (B && s === 10) INST.kick(r, t, 0.3);
      if ((bar & 1) && s === 12) INST.ka(r, t, 0.1);
      if (B && (s & 1) === 0) INST.shaker(r, t, s % 4 === 2 ? 0.05 : 0.03);
    },
  },
};

// =============================================================================
// Music: rack (per playing track) and step scheduler
// =============================================================================

/** Per-track mixer: drums / bass / tone buses, tempo delay, reverb, crossfade gain. */
function createRack(ac, dest, track, intensity = 0) {
  const nodes = [];
  const keep = (n) => {
    nodes.push(n);
    return n;
  };
  const gain = (v) => {
    const g = keep(ac.createGain());
    g.gain.value = v;
    return g;
  };
  const biquad = (type, f, q = 0.707) => {
    const b = keep(ac.createBiquadFilter());
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return b;
  };
  const mix = track.mix || {};
  const r = { ac, track, I: clamp(intensity, 0, 1), seed: track.seed || 1 };

  r.out = gain(0); // crossfade gain
  r.out.connect(dest);
  // gentle tanh "mastering" stage keeps summed peaks under control
  const clip = keep(ac.createWaveShaper());
  clip.curve = satCurve(1.3);
  clip.oversample = '2x';
  clip.connect(r.out);
  r.master = gain(mix.master ?? 0.8);
  r.master.connect(clip);
  r.drums = gain(mix.drums ?? 1);
  r.drums.connect(r.master);
  r.bass = gain(mix.bass ?? 1);
  r.bass.connect(r.master);
  // tonal instruments go through the intensity-controlled lowpass
  r.tone = biquad('lowpass', 4000, 0.5);
  r.toneOut = gain(mix.tone ?? 1);
  r.tone.connect(r.toneOut);
  r.toneOut.connect(r.master);

  // tempo-synced feedback delay, darkened and thinned inside the loop
  r.dlyIn = gain(1);
  const dl = keep(ac.createDelay(2));
  dl.delayTime.value = (60 / track.bpm) * (track.delayBeats ?? 0.75);
  const dlLp = biquad('lowpass', 2800);
  const dlHp = biquad('highpass', 220);
  const fb = gain(track.delayFb ?? 0.35);
  r.dlyIn.connect(dl);
  dl.connect(dlLp);
  dlLp.connect(dlHp);
  dlHp.connect(fb);
  fb.connect(dl);
  const dlOut = gain(mix.delay ?? 0.4);
  dlHp.connect(dlOut);
  if (ac.createStereoPanner) {
    const pn = keep(ac.createStereoPanner());
    pn.pan.value = 0.35;
    dlOut.connect(pn);
    pn.connect(r.master);
  } else {
    dlOut.connect(r.master);
  }

  // reverb
  r.revIn = gain(1);
  const revHp = biquad('highpass', 200);
  const conv = keep(ac.createConvolver());
  conv.buffer = impulse(ac, 1.8, 2.6);
  const revOut = gain(mix.reverb ?? 0.5);
  r.revIn.connect(revHp);
  revHp.connect(conv);
  conv.connect(revOut);
  revOut.connect(r.master);

  const [c0, c1] = track.cut || [3500, 16000];
  const cutFor = (x) => Math.min(c0 * Math.pow(c1 / c0, x), ac.sampleRate * 0.45);
  r.tone.frequency.value = cutFor(r.I);
  r.setIntensity = (x) => {
    r.I = clamp(x, 0, 1);
    r.tone.frequency.setTargetAtTime(cutFor(r.I), ac.currentTime, 0.25);
  };
  r.voice = (t, dest2) => new Voice(ac, dest2, t, { reverb: r.revIn, delay: r.dlyIn, oversample: 'none' });
  r.rand = (bar, s, salt = 0) => hash01((r.seed * 100003 + bar * 1009 + s * 31 + salt * 7) | 0);
  r.dispose = () => {
    for (const n of nodes) {
      try {
        n.disconnect();
      } catch (e) {
        /* already gone */
      }
    }
    nodes.length = 0;
  };
  return r;
}

/** Schedules one 16th-note step of a player and advances it. */
function runStep(p) {
  const total = p.track.bars * 16;
  const i = p.step % total;
  p.track.step(p.rack, Math.floor(i / 16), i % 16, p.next, p.sd);
  p.step += 1;
  p.next += p.sd;
}

function makePlayer(ac, dest, id, startAt, intensity) {
  const track = TRACKS[id];
  return {
    id, track, rack: createRack(ac, dest, track, intensity), step: 0, next: startAt, sd: 60 / track.bpm / 4,
  };
}

// =============================================================================
// Engine (live playback)
// =============================================================================

const S = {
  ac: null,
  master: null,
  limiter: null,
  sfxBus: null,
  sfxRevIn: null,
  musicIn: null,
  pauseLP: null,
  pauseGain: null,
  musicBus: null,
  vol: { master: 1, music: 1, sfx: 1 },
  intensity: 0,
  paused: false,
  pending: null, // track requested before unlock
  pendingFade: 0.8,
  player: null,
  timer: null,
  active: new Set(), // live sfx voices, oldest first
  recent: new Map(), // sfx name -> recent start times (burst limiting)
  warned: new Set(),
  unlockAt: 0,
  primed: false,
};

function warnOnce(key, msg) {
  if (S.warned.has(key)) return;
  S.warned.add(key);
  console.warn(msg);
}

function maxCut(ac) {
  return Math.min(20000, ac.sampleRate / 2 - 100);
}

function buildGraph(ac) {
  const g = (v) => {
    const n = ac.createGain();
    n.gain.value = v;
    return n;
  };
  const lim = ac.createDynamicsCompressor();
  lim.threshold.value = -6;
  lim.knee.value = 3;
  lim.ratio.value = 16;
  lim.attack.value = 0.002;
  lim.release.value = 0.15;
  lim.connect(ac.destination);
  S.limiter = lim;
  S.master = g(S.vol.master);
  S.master.connect(lim);
  S.sfxBus = g(S.vol.sfx);
  S.sfxBus.connect(S.master);
  S.musicBus = g(S.vol.music * MUSIC_BUS_LEVEL);
  S.musicBus.connect(S.master);
  S.pauseGain = g(S.paused ? PAUSE_DUCK : 1);
  S.pauseGain.connect(S.musicBus);
  S.pauseLP = ac.createBiquadFilter();
  S.pauseLP.type = 'lowpass';
  S.pauseLP.Q.value = 0.7;
  S.pauseLP.frequency.value = S.paused ? 700 : maxCut(ac);
  S.pauseLP.connect(S.pauseGain);
  S.musicIn = g(1);
  S.musicIn.connect(S.pauseLP);
  S.sfxRevIn = makeReverb(ac, S.sfxBus, SFX_REVERB.seconds, SFX_REVERB.decay, SFX_REVERB.ret).input;
  // Pre-build the shared buffers so the first sounds don't stall.
  for (const k of ['white', 'pink', 'brown', 'hiss']) noiseBuffer(ac, k);
  metalBuffer(ac);
}

function tick() {
  const p = S.player;
  const ac = S.ac;
  if (!p || !ac) return;
  const now = ac.currentTime;
  const ahead = typeof document !== 'undefined' && document.hidden ? 1.2 : 0.12;
  if (p.next < now - 0.25) {
    // main thread stalled: skip the missed steps instead of bursting them out
    const skip = Math.ceil((now - p.next) / p.sd);
    p.step += skip;
    p.next += skip * p.sd;
  }
  try {
    while (p.next < now + ahead) runStep(p);
  } catch (e) {
    warnOnce('music-step', '[audio] music step failed: ' + (e && e.message));
    p.next = now + ahead; // avoid a tight error loop
  }
}

function fadeOutPlayer(p, fade) {
  const ac = S.ac;
  const now = ac.currentTime;
  const g = p.rack.out.gain;
  if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(now);
  else {
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
  }
  g.linearRampToValueAtTime(0, now + Math.max(0.02, fade));
  // let already-scheduled notes and tails finish (silently) before disconnecting
  setTimeout(() => p.rack.dispose(), (Math.max(0.02, fade) + 4) * 1000);
}

function startTrack(id, fade) {
  const ac = S.ac;
  if (S.player) fadeOutPlayer(S.player, fade);
  const now = ac.currentTime;
  const p = makePlayer(ac, S.musicIn, id, now + 0.06, S.intensity);
  const g = p.rack.out.gain;
  if (fade > 0) {
    g.setValueAtTime(0, now);
    g.linearRampToValueAtTime(1, now + fade);
  } else {
    g.setValueAtTime(1, now);
  }
  S.player = p;
  if (!S.timer) S.timer = setInterval(tick, 25);
  tick();
}

export const SFX_NAMES = Object.keys(SFX);
export const MUSIC_TRACKS = Object.keys(TRACKS);

export const audio = {
  /** Call from a user gesture. Creates/resumes the AudioContext lazily; safe to call often. */
  unlock() {
    if (!HAS_WINDOW) return;
    try {
      if (!S.ac) {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return;
        try {
          S.ac = new Ctor({ latencyHint: 'interactive' });
        } catch (e) {
          S.ac = new Ctor();
        }
        buildGraph(S.ac);
      }
      const ac = S.ac;
      S.unlockAt = Date.now();
      if (ac.state !== 'running' && ac.state !== 'closed') {
        const pr = ac.resume();
        if (pr && pr.catch) pr.catch(() => {});
      }
      if (!S.primed) {
        // iOS: a silent buffer started inside the gesture fully unlocks output
        const src = ac.createBufferSource();
        src.buffer = ac.createBuffer(1, 1, ac.sampleRate);
        src.connect(ac.destination);
        src.start(0);
        S.primed = true;
      }
      if (S.pending) {
        const id = S.pending;
        S.pending = null;
        startTrack(id, S.pendingFade);
      }
    } catch (e) {
      warnOnce('unlock', '[audio] unlock failed: ' + (e && e.message));
    }
  },

  get unlocked() {
    return !!S.ac && S.ac.state === 'running';
  },

  /** Plays a sound effect. opts: { vol = 1 (0..2), pitch = 1, pan = 0 (-1..1) }. */
  sfx(name, opts = {}) {
    const d = SFX[name];
    if (!d) {
      warnOnce('sfx:' + name, `[audio] unknown sfx "${name}"`);
      return;
    }
    const ac = S.ac;
    if (!ac || ac.state === 'closed') return;
    if (ac.state !== 'running' && Date.now() - S.unlockAt > 1000) return;
    const o = opts || {};
    const vol = clamp(o.vol ?? 1, 0, 2);
    if (vol <= 0) return;
    const now = ac.currentTime;
    // burst limiting: max N of the same sfx inside a short window
    let hist = S.recent.get(name);
    if (!hist) S.recent.set(name, (hist = []));
    while (hist.length && now - hist[0] > SFX_BURST_WINDOW) hist.shift();
    if (hist.length >= SFX_BURST_MAX) return;
    hist.push(now);
    // global polyphony cap: steal the oldest voice
    if (S.active.size >= MAX_VOICES) {
      const oldest = S.active.values().next().value;
      S.active.delete(oldest);
      oldest.kill();
    }
    const pitch = clamp(o.pitch ?? 1, 0.25, 4) * (1 + (Math.random() * 2 - 1) * d.vary);
    try {
      let dest = S.sfxBus;
      let panner = null;
      if (o.pan && ac.createStereoPanner) {
        panner = ac.createStereoPanner();
        panner.pan.value = clamp(o.pan, -1, 1);
        panner.connect(S.sfxBus);
        dest = panner;
      }
      const v = renderSfxInto(name, ac, dest, now, { vol, pitch, reverb: S.sfxRevIn });
      if (panner) v.reg(panner);
      S.active.add(v);
      v.done(() => S.active.delete(v));
    } catch (e) {
      warnOnce('sfx-err:' + name, `[audio] sfx "${name}" failed: ${e && e.message}`);
    }
  },

  /** Crossfades to a music track. Same id -> no-op. Before unlock it is remembered. */
  playMusic(id, { fade = 0.8 } = {}) {
    if (!TRACKS[id]) {
      warnOnce('music:' + id, `[audio] unknown music track "${id}"`);
      return;
    }
    if (!S.ac) {
      S.pending = id;
      S.pendingFade = fade;
      return;
    }
    if (S.player && S.player.id === id) return;
    startTrack(id, Math.max(0, fade));
  },

  stopMusic(fade = 0.8) {
    S.pending = null;
    if (!S.ac || !S.player) return;
    fadeOutPlayer(S.player, Math.max(0, fade));
    S.player = null;
    if (S.timer) {
      clearInterval(S.timer);
      S.timer = null;
    }
  },

  /** Volumes 0..1, any subset of { master, music, sfx }. */
  setVolumes({ master, music, sfx } = {}) {
    if (typeof master === 'number') S.vol.master = clamp(master, 0, 1);
    if (typeof music === 'number') S.vol.music = clamp(music, 0, 1);
    if (typeof sfx === 'number') S.vol.sfx = clamp(sfx, 0, 1);
    if (!S.ac) return;
    const now = S.ac.currentTime;
    S.master.gain.setTargetAtTime(S.vol.master, now, 0.02);
    S.musicBus.gain.setTargetAtTime(S.vol.music * MUSIC_BUS_LEVEL, now, 0.02);
    S.sfxBus.gain.setTargetAtTime(S.vol.sfx, now, 0.02);
  },

  /** 0..1: raises musical tension (filters open, extra layers in battle tracks). */
  setIntensity(x) {
    S.intensity = clamp(Number(x) || 0, 0, 1);
    if (S.player) S.player.rack.setIntensity(S.intensity);
  },

  /** Pause: lowpass + duck the music (it keeps running). */
  setPaused(paused) {
    S.paused = !!paused;
    if (!S.ac) return;
    const now = S.ac.currentTime;
    S.pauseLP.frequency.setTargetAtTime(S.paused ? 700 : maxCut(S.ac), now, 0.08);
    S.pauseGain.gain.setTargetAtTime(S.paused ? PAUSE_DUCK : 1, now, 0.08);
  },
};

export default audio;

// =============================================================================
// Test / tooling hooks (offline rendering). Not part of the game API.
// =============================================================================

function offlineCtx(seconds, sampleRate) {
  const Ctor = HAS_WINDOW && (window.OfflineAudioContext || window.webkitOfflineAudioContext);
  if (!Ctor) throw new Error('OfflineAudioContext unavailable');
  return new Ctor(2, Math.ceil(seconds * sampleRate), sampleRate);
}

export const _test = {
  Voice,
  SYNTHS,
  TRACKS,
  INST,
  levels: () => Object.fromEntries(Object.entries(SFX).map(([k, d]) => [k, d.level])),
  engineState: () => ({
    ctx: S.ac ? S.ac.state : null, activeVoices: S.active.size, track: S.player ? S.player.id : null,
    pending: S.pending, intensity: S.intensity, paused: S.paused, timer: !!S.timer,
  }),
  glue: () => ({ ...GLUE }),
  /** Renders one sfx (with the shared sfx reverb) into an AudioBuffer. */
  async renderSfx(name, { seconds = 3, sampleRate = 44100, pitch = 1, raw = false, glue } = {}) {
    const ac = offlineCtx(seconds, sampleRate);
    const rev = makeReverb(ac, ac.destination, SFX_REVERB.seconds, SFX_REVERB.decay, SFX_REVERB.ret);
    const v = SYNTHS[name](ac, ac.destination, 0, { pitch, reverb: rev.input, raw, glue });
    const buffer = await ac.startRendering();
    return { buffer, end: v.end };
  },
  /** Renders `seconds` of a music track (rack output, before the music bus). */
  async renderTrackOffline(id, seconds = 8, { sampleRate = 44100, intensity = 0, solo = null } = {}) {
    const ac = offlineCtx(seconds, sampleRate);
    const p = makePlayer(ac, ac.destination, id, 0.02, intensity);
    p.rack.out.gain.value = 1;
    if (solo) for (const k of ['drums', 'bass', 'toneOut']) if (k !== solo) p.rack[k].gain.value = 0;
    // schedule in chunks from suspend() callbacks, mirroring the live lookahead
    const chunk = 0.25;
    const schedule = (until) => {
      while (p.next < Math.min(seconds, until)) runStep(p);
    };
    schedule(chunk + 0.15);
    for (let t = chunk; t < seconds; t += chunk) {
      const at = t;
      ac.suspend(at).then(() => {
        schedule(at + chunk + 0.15);
        ac.resume();
      });
    }
    return ac.startRendering();
  },
};
