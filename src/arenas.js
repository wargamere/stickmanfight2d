// Stickman Fight 2D — procedural arena backgrounds.
//
// Ten animated, parallax stage backdrops drawn entirely with the Canvas 2D API.
// Static / complex silhouettes are pre-rendered once into offscreen canvases
// (at 2x resolution on 'high' quality) and blitted every frame; only cheap
// animated details (particles, glows, swinging props) are drawn live.
//
// Coordinate contract (see game camera):
//   world -> screen: sx = view.w/2 + (wx - cam.x) * cam.zoom
//                    sy = view.h*0.8 + (wy - cam.y) * cam.zoom
//   Ground surface is world y = 0, y points down.
//   A parallax layer with factor p is entered with `layer(ctx, cam, view, p)`.

// ═════════════════════════════════════════════════════════════════════════
// Shared helpers
// ═════════════════════════════════════════════════════════════════════════

const TAU = Math.PI * 2;
const FLOOR_H = 800;       // distance (floor units) from ground line to the floor's vanishing point
const FIELD_M = 90;        // margin around the screen for wrapped ambient particle fields
const FIELD_W = 1710 + FIELD_M * 2;
const FIELD_H = 720 + FIELD_M * 2;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const mod = (a, n) => ((a % n) + n) % n;
const smooth = (t) => t * t * (3 - 2 * t);

// Deterministic seeded RNG (mulberry32) with a few conveniences.
function makeRng(seed) {
  let a = seed >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (lo, hi) => lo + (hi - lo) * r();
  r.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * r());
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.chance = (p) => r() < p;
  return r;
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Periodic smooth value noise on t ∈ [0,1) with n control points -> [-1, 1].
function pnoise(rng, n) {
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) v[i] = rng() * 2 - 1;
  return (t) => {
    const x = mod(t, 1) * n;
    const i = Math.floor(x);
    const f = smooth(x - i);
    return v[i % n] * (1 - f) + v[(i + 1) % n] * f;
  };
}

// Periodic fractal noise: octaves = [[controlPoints, amplitude], ...].
function pfbm(rng, octaves) {
  const fs = octaves.map(([n, a]) => [pnoise(rng, n), a]);
  return (t) => {
    let s = 0;
    for (let i = 0; i < fs.length; i++) s += fs[i][0](t) * fs[i][1];
    return s;
  };
}

// ── Colors ───────────────────────────────────────────────────────────────
function hexRgb(h) {
  h = h.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a, b, t) {
  const A = hexRgb(a), B = hexRgb(b);
  const c = (i) => Math.round(lerp(A[i], B[i], t)).toString(16).padStart(2, '0');
  return '#' + c(0) + c(1) + c(2);
}
function rgba(hex, a) {
  const c = hexRgb(hex);
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}
function lin(g, x0, y0, x1, y1, stops) {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  for (let i = 0; i < stops.length; i++) gr.addColorStop(stops[i][0], stops[i][1]);
  return gr;
}
function rad(g, x, y, r0, r1, stops) {
  const gr = g.createRadialGradient(x, y, r0, x, y, r1);
  for (let i = 0; i < stops.length; i++) gr.addColorStop(stops[i][0], stops[i][1]);
  return gr;
}

// ── Offscreen canvases ───────────────────────────────────────────────────
// Cached layers are budgeted (~28MB per arena at 'high'): big full-width tiles of
// soft, distant scenery use a lower resolution than crisp near-field sprites.
let _cacheBytes = 0;
function createCanvas(w, h) {
  w = Math.max(1, Math.min(8192, Math.ceil(w)));
  h = Math.max(1, Math.min(8192, Math.ceil(h)));
  _cacheBytes += w * h * 4;
  try {
    if (typeof document !== 'undefined' && document.createElement) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    }
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  } catch (e) { /* no canvas support (e.g. Node) */ }
  return null;
}

// Sprite: pre-rendered image anchored at (ax, ay) in its own units.
function makeSprite(w, h, ax, ay, res, draw) {
  const c = createCanvas(w * res, h * res);
  if (!c) return null;
  const g = c.getContext('2d');
  g.scale(c.width / w, c.height / h);
  g.translate(ax, ay);
  draw(g);
  return { c, w, h, ax, ay };
}
function drawSprite(ctx, s, x, y, sc = 1) {
  if (s) ctx.drawImage(s.c, x - s.ax * sc, y - s.ay * sc, s.w * sc, s.h * sc);
}

// Horizontally periodic tile (period w). Content drawn by `draw(g, w, h)` must
// wrap itself (see `wrap`).
//  - Opaque silhouettes keep a small wrapped margin and are blitted with
//    drawImage, neighbouring copies overlapping by one unit (no seams, fast).
//  - Translucent tiles (clouds, fog, floor detail) go through a repeat-x pattern,
//    because overlapping translucent copies would show a double-alpha seam.
function makeTile(w, h, res, draw, translucent = false) {
  const m = translucent ? 0 : 4;
  const c = createCanvas((w + 2 * m) * res, h * res);
  if (!c) return null;
  const g = c.getContext('2d');
  g.scale(c.width / (w + 2 * m), c.height / h);
  g.translate(m, 0);
  draw(g, w, h);
  return { c, w, h, m, pat: null };
}
const makeTileT = (w, h, res, draw) => makeTile(w, h, res, draw, true);
const wrap = (w, x, fn) => { fn(x - w); fn(x); fn(x + w); };

// Repeat a tile across layer bounds b with its top at layer y; optional solid fill below it.
function drawTile(ctx, b, t, y, scroll = 0, fill = null) {
  if (t && t.m === 0) {
    if (!t.pat) t.pat = ctx.createPattern(t.c, 'repeat-x');
    if (t.pat) {
      t.pat.setTransform({ a: t.w / t.c.width, b: 0, c: 0, d: t.h / t.c.height, e: mod(scroll, t.w), f: y });
      ctx.fillStyle = t.pat;
      ctx.fillRect(b.x0 - 2, y, b.x1 - b.x0 + 4, t.h);
    }
  } else if (t) {
    const ppu = t.c.width / (t.w + 2 * t.m);
    const e = 1;
    const sx = (t.m - e) * ppu, sw = (t.w + 2 * e) * ppu;
    let x = Math.floor((b.x0 - scroll) / t.w) * t.w + scroll;
    for (; x < b.x1; x += t.w) ctx.drawImage(t.c, sx, 0, sw, t.c.height, x - e, y, t.w + 2 * e, t.h);
  }
  const bottom = y + (t ? t.h : 0);
  if (fill && b.y1 > bottom - 1) {
    ctx.fillStyle = fill;
    ctx.fillRect(b.x0 - 4, bottom - 1, b.x1 - b.x0 + 8, b.y1 - bottom + 6);
  }
}

// Draw sprite instances (o = {s, x, y, sc}) repeated with a period across bounds.
function drawInstances(ctx, b, list, period) {
  for (let i = 0; i < list.length; i++) {
    const o = list[i], s = o.s;
    if (!s) continue;
    const sc = o.sc || 1;
    const left = s.ax * sc, right = (s.w - s.ax) * sc;
    let x = o.x + Math.ceil((b.x0 - right - o.x) / period) * period;
    for (; x - left < b.x1; x += period) {
      ctx.drawImage(s.c, x - left, (o.y || 0) - s.ay * sc, s.w * sc, s.h * sc);
    }
  }
}

// Call fn(x) for each periodic copy of a point that is visible within [x0-pad, x1+pad].
function eachCopy(x, period, x0, x1, pad, fn) {
  let xx = x + Math.ceil((x0 - pad - x) / period) * period;
  for (; xx < x1 + pad; xx += period) fn(xx);
}

// ── Glow / puff sprites (shared, lazily created) ─────────────────────────
const _glowCache = new Map();
function glowSprite(rgb, kind = 0) {
  const key = rgb + '|' + kind;
  let s = _glowCache.get(key);
  if (s !== undefined) return s;
  s = createCanvas(128, 128);
  if (s) {
    const g = s.getContext('2d');
    const stops = kind === 0
      ? [[0, 1], [0.12, 0.8], [0.35, 0.28], [0.65, 0.08], [1, 0]]   // bright core glow
      : kind === 1
        ? [[0, 0.75], [0.35, 0.55], [0.7, 0.18], [1, 0]]            // soft puff
        : [[0, 0.5], [0.5, 0.35], [0.8, 0.1], [1, 0]];              // flat haze
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    for (const [o, a] of stops) gr.addColorStop(o, `rgba(${rgb},${a})`);
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
  }
  _glowCache.set(key, s);
  return s;
}
function drawGlow(ctx, rgb, x, y, r, a = 1, kind = 0) {
  if (a <= 0.004 || r <= 0) return;
  const s = glowSprite(rgb, kind);
  if (!s) return;
  ctx.globalAlpha = a > 1 ? 1 : a;
  ctx.drawImage(s, x - r, y - r, r * 2, r * 2);
}
// Stretched glow (ellipse).
function drawGlowE(ctx, rgb, x, y, rx, ry, a = 1, kind = 0) {
  if (a <= 0.004) return;
  const s = glowSprite(rgb, kind);
  if (!s) return;
  ctx.globalAlpha = a > 1 ? 1 : a;
  ctx.drawImage(s, x - rx, y - ry, rx * 2, ry * 2);
}

// ── Transforms ───────────────────────────────────────────────────────────
// Enter a parallax layer (caller must ctx.restore()). Returns visible bounds in layer coords.
function layer(ctx, cam, view, p) {
  const z = 1 + (cam.zoom - 1) * p;
  ctx.save();
  ctx.translate(view.w / 2, view.h * 0.8);
  ctx.scale(z, z);
  ctx.translate(-cam.x * p, -cam.y * p);
  return {
    p, z,
    x0: cam.x * p - view.w / 2 / z,
    x1: cam.x * p + view.w / 2 / z,
    y0: cam.y * p - (view.h * 0.8) / z,
    y1: cam.y * p + (view.h * 0.2) / z,
  };
}
// Screen position of a layer point (for reflections / glows drawn in screen space).
function layerToScreen(cam, view, p, x, y) {
  const z = 1 + (cam.zoom - 1) * p;
  return [view.w / 2 + (x - cam.x * p) * z, view.h * 0.8 + (y - cam.y * p) * z, z];
}

// Compose base matrix m with local translate/rotate/scale and set it.
function setLocal(ctx, m, x, y, rot, sx, sy) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const a = c * sx, b = s * sx, cc = -s * sy, d = c * sy;
  ctx.setTransform(
    m.a * a + m.c * b, m.b * a + m.d * b,
    m.a * cc + m.c * d, m.b * cc + m.d * d,
    m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f,
  );
}

// ── Floor (perspective plane in front of the ground line) ───────────────
// Floor coords: u = world x, r = depth below the ground line (0 at ground line,
// screen row = gy + r*zoom). Lines of constant u converge toward a vanishing
// point FLOOR_H above the ground line at screen centre.
function floorView(cam, view) {
  const z = cam.zoom, gy = view.h * 0.8 - cam.y * z;
  return { z, gy, cx: view.w / 2, camX: cam.x, rMax: Math.max(0, (view.h - gy) / z + 1), w: view.w, h: view.h };
}
const fX = (F, u, r) => F.cx + (u - F.camX) * F.z * (1 + r / FLOOR_H);
const fY = (F, r) => F.gy + r * F.z;
const fU0 = (F, r) => F.camX - F.cx / (F.z * (1 + r / FLOOR_H));
const fU1 = (F, r) => F.camX + F.cx / (F.z * (1 + r / FLOOR_H));

// Fill the floor band with a vertical gradient (stops are in floor depth units 0..240).
function floorBase(ctx, F, stops) {
  if (F.gy >= F.h) return;
  ctx.fillStyle = lin(ctx, 0, F.gy, 0, F.gy + 240 * F.z, stops);
  ctx.fillRect(-2, F.gy, F.w + 4, F.h - F.gy + 2);
}
// Non-perspective texture overlay on the floor (for grain/noise detail).
function floorTexture(ctx, F, t, alpha = 1, op = 'source-over') {
  if (!t || F.gy >= F.h) return;
  const fz = F.z * (1 + Math.min(F.rMax, 240) / (2 * FLOOR_H));
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = op;
  ctx.translate(F.cx, F.gy);
  ctx.scale(fz, F.z);
  ctx.translate(-F.camX, 0);
  const b = { x0: F.camX - F.cx / fz, x1: F.camX + F.cx / fz };
  drawTile(ctx, b, t, 0);
  ctx.restore();
}
// Stroke floor lines of constant u (converging) every `step` units, offset `off`.
function floorRays(ctx, F, step, off, r0 = 0, r1 = F.rMax) {
  if (F.gy >= F.h) return;
  r1 = Math.min(r1, F.rMax);
  const u0 = Math.min(fU0(F, r0), fU0(F, r1)), u1 = Math.max(fU1(F, r0), fU1(F, r1));
  let u = Math.floor((u0 - off) / step) * step + off;
  for (; u <= u1; u += step) {
    ctx.moveTo(fX(F, u, r0), fY(F, r0));
    ctx.lineTo(fX(F, u, r1), fY(F, r1));
  }
}
// Add a polygon given in floor coords (flat array u,r,u,r...) to the current path, offset by du.
function floorPoly(ctx, F, pts, du) {
  ctx.moveTo(fX(F, pts[0] + du, pts[1]), fY(F, pts[1]));
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(fX(F, pts[i] + du, pts[i + 1]), fY(F, pts[i + 1]));
  ctx.closePath();
}
function floorLine(ctx, F, pts, du) {
  ctx.moveTo(fX(F, pts[0] + du, pts[1]), fY(F, pts[1]));
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(fX(F, pts[i] + du, pts[i + 1]), fY(F, pts[i + 1]));
}
// Iterate periodic floor features: calls fn(du) for each period copy that may be visible.
function floorCopies(F, period, uMin, uMax, fn) {
  const u0 = fU0(F, F.rMax) - 50, u1 = fU1(F, F.rMax) + 50;
  let k = Math.floor((u0 - uMax) / period);
  for (; k * period + uMin < u1; k++) fn(k * period);
}

// ── Screen-space finishing ───────────────────────────────────────────────
function vignette(ctx, view, rgb, strength, inner = 0.35, cy = 0.5) {
  const r = Math.hypot(view.w / 2, view.h * 0.62);
  const g = ctx.createRadialGradient(view.w / 2, view.h * cy, r * inner, view.w / 2, view.h * cy, r);
  g.addColorStop(0, `rgba(${rgb},0)`);
  g.addColorStop(0.6, `rgba(${rgb},${strength * 0.45})`);
  g.addColorStop(1, `rgba(${rgb},${strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, view.w, view.h);
}
function screenGrad(ctx, view, stops, op = 'source-over') {
  ctx.globalCompositeOperation = op;
  ctx.fillStyle = lin(ctx, 0, 0, 0, view.h, stops);
  ctx.fillRect(0, 0, view.w, view.h);
  ctx.globalCompositeOperation = 'source-over';
}
// Sky gradient filled across a near-static layer (stops: [offset, color] between y0..y1).
function drawSky(ctx, cam, view, stops, y0 = -760, y1 = 0, p = 0.04) {
  const b = layer(ctx, cam, view, p);
  ctx.fillStyle = lin(ctx, 0, y0, 0, y1, stops);
  ctx.fillRect(b.x0 - 4, b.y0 - 4, b.x1 - b.x0 + 8, b.y1 - b.y0 + 8);
  ctx.restore();
}

// ── Ambient particle fields (screen-wrapped, parallax per particle) ──────
function makeField(rng, n, init) {
  const a = [];
  for (let i = 0; i < n; i++) {
    const p = { x: rng() * FIELD_W, y: rng() * FIELD_H, d: 0.5, vx: 0, vy: 0, s: 1, ph: rng() * TAU, rot: rng() * TAU, vr: 0 };
    init(p, rng, i);
    a.push(p);
  }
  return a;
}
function stepField(list, dt, t, sway = 0, swayF = 1) {
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    p.x += (p.vx + (sway ? Math.sin(t * swayF + p.ph) * sway : 0)) * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    if (p.x < 0 || p.x >= FIELD_W) p.x = mod(p.x, FIELD_W);
    if (p.y < 0 || p.y >= FIELD_H) p.y = mod(p.y, FIELD_H);
  }
}
// Screen position of a field particle; returns false when off-screen. Writes into out[0..2].
const _fp = [0, 0, 1];
function fieldPos(p, cam, view) {
  const z = 1 + (cam.zoom - 1) * p.d;
  const sx = mod(p.x - cam.x * p.d * z, FIELD_W) - FIELD_M;
  if (sx > view.w + FIELD_M) return false;
  const sy = mod(p.y - cam.y * p.d * z, FIELD_H) - FIELD_M;
  if (sy > view.h + FIELD_M) return false;
  _fp[0] = sx; _fp[1] = sy; _fp[2] = z;
  return true;
}
// Draw a field of rotating sprites (petals, leaves, flakes) in screen space.
function drawSpriteField(ctx, list, cam, view, sprites, t, flutter = 2) {
  const m = ctx.getTransform();
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (!fieldPos(p, cam, view)) continue;
    const s = sprites[p.v || 0];
    if (!s) continue;
    const sc = p.s * _fp[2];
    const fl = flutter ? 0.25 + 0.75 * Math.abs(Math.cos(t * flutter + p.ph)) : 1;
    ctx.globalAlpha = p.a == null ? 1 : p.a;
    setLocal(ctx, m, _fp[0], _fp[1], p.rot, sc, sc * fl);
    ctx.drawImage(s.c, -s.ax, -s.ay, s.w, s.h);
  }
  ctx.setTransform(m);
  ctx.globalAlpha = 1;
}
// Batched dots for a field (snow, motes): one path per call.
function drawDotField(ctx, list, cam, view, color, alpha, sizeMul = 1, filter = null) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (filter && !filter(p)) continue;
    if (!fieldPos(p, cam, view)) continue;
    const r = p.s * _fp[2] * sizeMul;
    ctx.moveTo(_fp[0] + r, _fp[1]);
    ctx.arc(_fp[0], _fp[1], r, 0, TAU);
  }
  ctx.fill();
  ctx.globalAlpha = 1;
}
// Additive glowing dots for a field (embers, motes).
function drawGlowField(ctx, list, cam, view, rgb, t, sizeMul = 1, alphaMul = 1) {
  ctx.globalCompositeOperation = 'lighter';
  const s = glowSprite(rgb, 0);
  if (s) {
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!fieldPos(p, cam, view)) continue;
      const a = (p.a == null ? 1 : p.a) * alphaMul * (0.55 + 0.45 * Math.sin(t * (p.tw || 3) + p.ph));
      if (a <= 0.01) continue;
      const r = p.s * _fp[2] * sizeMul;
      ctx.globalAlpha = a > 1 ? 1 : a;
      ctx.drawImage(s, _fp[0] - r, _fp[1] - r, r * 2, r * 2);
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

// ── Impact debris (world-space physics particles) ────────────────────────
// kinds: 'puff' soft cloud, 'spark' additive streak, 'glow' additive dot,
//        'chip' tumbling shard, 'leaf' fluttering sprite, 'ring' floor ripple, 'flash'.
function addDebris(S, o) {
  if (S.debris.length >= S.maxDebris) return null;
  const p = {
    k: 'puff', x: 0, y: 0, vx: 0, vy: 0, g: 0, drag: 0, life: 1, max: 1, s: 6, grow: 0,
    c: '#ffffff', rgb: '255,255,255', rot: 0, vr: 0, a: 1, front: false, fy: 0, bounce: -1,
    spr: null, ph: 0, sway: 0,
  };
  for (const k in o) p[k] = o[k];
  p.max = p.life;
  S.debris.push(p);
  return p;
}
function updateDebris(S, dt) {
  const d = S.debris;
  for (let i = d.length - 1; i >= 0; i--) {
    const p = d[i];
    p.life -= dt;
    if (p.life <= 0) { d[i] = d[d.length - 1]; d.pop(); continue; }
    p.vy += p.g * dt;
    if (p.drag) { const k = 1 / (1 + p.drag * dt); p.vx *= k; p.vy *= k; }
    p.x += (p.vx + (p.sway ? Math.sin(S.t * 3 + p.ph) * p.sway : 0)) * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    p.s += p.grow * dt;
    if (p.bounce >= 0 && p.y > p.fy && p.vy > 0) {
      p.y = p.fy;
      if (p.vy > 60 && p.bounce > 0) { p.vy *= -p.bounce; p.vx *= 0.6; p.vr *= 0.5; }
      else { p.vy = 0; p.g = 0; p.vx *= 0.5; p.vr = 0; p.sway = 0; p.drag = 6; }
    }
  }
}
function drawDebris(ctx, S, cam, view, front) {
  const d = S.debris;
  if (!d.length) return;
  layer(ctx, cam, view, 1);
  const m = ctx.getTransform();
  for (let i = 0; i < d.length; i++) {
    const p = d[i];
    if (p.front !== front) continue;
    const f = p.life / p.max;
    switch (p.k) {
      case 'puff': {
        const a = p.a * (f < 0.7 ? f / 0.7 : 1) * Math.min(1, (1 - f) * 8);
        drawGlow(ctx, p.rgb, p.x, p.y, p.s, a, 1);
        break;
      }
      case 'glow': {
        ctx.globalCompositeOperation = 'lighter';
        drawGlow(ctx, p.rgb, p.x, p.y, p.s, p.a * f, 0);
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'flash': {
        ctx.globalCompositeOperation = 'lighter';
        drawGlow(ctx, p.rgb, p.x, p.y, p.s * (1.4 - f * 0.4), p.a * f * f, 0);
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'spark': {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = p.a * Math.min(1, f * 2);
        ctx.strokeStyle = p.c;
        ctx.lineWidth = p.s;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'chip': {
        ctx.globalAlpha = p.a * Math.min(1, f * 3);
        ctx.fillStyle = p.c;
        const c = Math.cos(p.rot) * p.s, s = Math.sin(p.rot) * p.s;
        ctx.beginPath();
        ctx.moveTo(p.x + c, p.y + s);
        ctx.lineTo(p.x - s * 0.6, p.y + c * 0.6);
        ctx.lineTo(p.x - c * 0.8, p.y - s * 0.8);
        ctx.fill();
        break;
      }
      case 'leaf': {
        if (!p.spr) break;
        ctx.globalAlpha = p.a * Math.min(1, f * 3);
        const fl = p.vy === 0 && p.g === 0 ? 1 : 0.3 + 0.7 * Math.abs(Math.cos(S.t * 4 + p.ph));
        setLocal(ctx, m, p.x, p.y, p.rot, p.s, p.s * fl);
        ctx.drawImage(p.spr.c, -p.spr.ax, -p.spr.ay, p.spr.w, p.spr.h);
        ctx.setTransform(m);
        break;
      }
      case 'ring': {
        const r = p.s * (1 - f) + 4;
        ctx.globalAlpha = p.a * f;
        ctx.strokeStyle = p.c;
        ctx.lineWidth = 2 + 2 * f;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, r, r * 0.16, 0, 0, TAU);
        ctx.stroke();
        break;
      }
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
}
// Common burst helper.
function burst(S, n, make) {
  for (let i = 0; i < n; i++) if (!addDebris(S, make(S.rng, i))) break;
}

// Simple damped pendulum list (lanterns, chains): {ang, av, ...}
function stepPendulums(list, dt, k, damp, t, wind = 0) {
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    const target = wind ? Math.sin(t * 0.8 + o.ph) * wind : 0;
    o.av += (-(o.ang - target) * k - o.av * damp) * dt;
    o.ang += o.av * dt;
  }
}
function kickPendulums(list, x, power, reach, strength, period = 0) {
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    const dx = period ? mod(o.x - x + period / 2, period) - period / 2 : o.x - x;
    const f = power * strength / (1 + Math.abs(dx) / reach);
    o.av += (dx >= 0 ? -1 : 1) * f * (0.7 + 0.3 * Math.sin(o.ph * 7));
  }
}

// Arena implementations register here: IMPL[id] = { build, update, back, front, impact }.
const IMPL = {};

// ═════════════════════════════════════════════════════════════════════════
// Shared drawing primitives for East-Asian architecture (dojo, temple bits)
// ═════════════════════════════════════════════════════════════════════════

// Curved temple roof. (x, y) = centre of the eave line, w = half width, h = height.
function roofPath(g, x, y, w, h, flare) {
  g.beginPath();
  g.moveTo(x - w - flare, y - h * 0.34);
  g.quadraticCurveTo(x - w * 0.82, y + h * 0.06, x - w * 0.55, y);
  g.lineTo(x + w * 0.55, y);
  g.quadraticCurveTo(x + w * 0.82, y + h * 0.06, x + w + flare, y - h * 0.34);
  g.quadraticCurveTo(x + w * 0.6, y - h * 0.36, x + w * 0.4, y - h);
  g.lineTo(x - w * 0.4, y - h);
  g.quadraticCurveTo(x - w * 0.6, y - h * 0.36, x - w - flare, y - h * 0.34);
  g.closePath();
}
function roofRim(g, x, y, w, h, flare, color, lw) {
  g.strokeStyle = color;
  g.lineWidth = lw;
  g.beginPath();
  g.moveTo(x + w + flare, y - h * 0.34);
  g.quadraticCurveTo(x + w * 0.6, y - h * 0.36, x + w * 0.4, y - h);
  g.lineTo(x - w * 0.4, y - h);
  g.quadraticCurveTo(x - w * 0.6, y - h * 0.36, x - w - flare, y - h * 0.34);
  g.stroke();
}
function drawPagoda(g, x, by, s, tiers, body, roof, rim, lamp) {
  let y = by;
  g.fillStyle = body;
  g.fillRect(x - 70 * s, y - 16 * s, 140 * s, 16 * s);
  y -= 16 * s;
  for (let i = 0; i < tiers; i++) {
    const bw = 104 * s * (1 - i * 0.11);
    const bh = (i === 0 ? 62 : 40) * s;
    g.fillStyle = body;
    g.fillRect(x - bw / 2, y - bh, bw, bh);
    if (lamp) {
      g.fillStyle = lamp;
      g.fillRect(x - 7 * s, y - bh * 0.72, 14 * s, bh * 0.5);
    }
    y -= bh;
    const rw = bw * 0.82, rh = 24 * s;
    g.fillStyle = roof;
    roofPath(g, x, y + 5 * s, rw, rh, 12 * s);
    g.fill();
    if (rim) roofRim(g, x, y + 5 * s, rw, rh, 12 * s, rim, 1.6 * s);
    y -= rh - 6 * s;
  }
  g.fillStyle = roof;
  g.fillRect(x - 2.5 * s, y - 70 * s, 5 * s, 72 * s);
  for (let k = 0; k < 6; k++) g.fillRect(x - 7 * s, y - 14 * s - k * 9 * s, 14 * s, 3 * s);
  g.beginPath();
  g.arc(x, y - 72 * s, 5 * s, 0, TAU);
  g.fill();
}
function drawPine(g, x, by, h, color, rng) {
  g.fillStyle = color;
  g.strokeStyle = color;
  g.lineWidth = h * 0.06;
  g.beginPath();
  g.moveTo(x, by);
  const lean = rng.range(-0.25, 0.25) * h;
  g.quadraticCurveTo(x + lean * 0.2, by - h * 0.5, x + lean, by - h * 0.85);
  g.stroke();
  const pads = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < pads; i++) {
    const t = 0.45 + (i / pads) * 0.55;
    const px = x + lean * t + rng.range(-0.35, 0.35) * h;
    const py = by - h * t;
    const pw = h * rng.range(0.22, 0.4) * (1.2 - t * 0.5);
    g.beginPath();
    g.ellipse(px, py, pw, pw * 0.34, 0, 0, TAU);
    g.ellipse(px - pw * 0.4, py + pw * 0.05, pw * 0.6, pw * 0.28, 0, 0, TAU);
    g.ellipse(px + pw * 0.45, py + pw * 0.04, pw * 0.55, pw * 0.26, 0, 0, TAU);
    g.fill();
  }
}

// ═════════════════════════════════════════════════════════════════════════
// 1. Sunset Dojo
// ═════════════════════════════════════════════════════════════════════════

const DOJO_SKY = [[0, '#1c1540'], [0.24, '#3f225b'], [0.46, '#7d3369'], [0.64, '#c64f69'], [0.79, '#ee8256'], [0.91, '#f9b45f'], [1, '#ffdc8e']];

function dojoHall(res) {
  const body = '#3c1f38', roof = '#26132a', rim = 'rgba(255,170,110,0.85)';
  return makeSprite(900, 430, 450, 430, res, (g) => {
    // warm interior glow behind the screens
    g.fillStyle = rad(g, 0, -110, 10, 380, [[0, 'rgba(255,190,110,0.35)'], [1, 'rgba(255,150,90,0)']]);
    g.fillRect(-450, -430, 900, 430);
    g.fillStyle = '#2e1830';
    g.fillRect(-370, -38, 740, 38);
    g.fillStyle = '#4a2a40';
    for (let i = 0; i < 5; i++) g.fillRect(-60 + i * 6, -38 + i * 7.6, 120 - i * 12, 3);
    g.fillStyle = body;
    g.fillRect(-300, -190, 600, 152);
    for (let i = 0; i < 8; i++) {
      const x = -300 + i * 75 + 9;
      g.fillStyle = lin(g, 0, -176, 0, -60, [[0, 'rgba(255,214,140,0.85)'], [1, 'rgba(255,160,90,0.55)']]);
      g.fillRect(x, -172, 57, 118);
      g.strokeStyle = 'rgba(70,30,40,0.7)';
      g.lineWidth = 1.5;
      g.beginPath();
      for (let k = 1; k < 4; k++) { g.moveTo(x + k * 14.25, -172); g.lineTo(x + k * 14.25, -54); }
      for (let k = 1; k < 6; k++) { g.moveTo(x, -172 + k * 19.7); g.lineTo(x + 57, -172 + k * 19.7); }
      g.stroke();
    }
    g.fillStyle = '#24112a';
    for (let i = 0; i <= 8; i++) g.fillRect(-304 + i * 75, -190, 8, 152);
    g.fillStyle = roof;
    roofPath(g, 0, -184, 372, 52, 34);
    g.fill();
    roofRim(g, 0, -184, 372, 52, 34, rim, 2);
    g.fillStyle = body;
    g.fillRect(-190, -300, 380, 70);
    g.fillStyle = 'rgba(255,200,130,0.55)';
    for (let i = 0; i < 6; i++) g.fillRect(-170 + i * 58, -288, 40, 46);
    g.fillStyle = roof;
    roofPath(g, 0, -282, 300, 118, 46);
    g.fill();
    roofRim(g, 0, -282, 300, 118, 46, rim, 2.4);
    // ridge ornaments
    g.beginPath();
    g.moveTo(-125, -400); g.quadraticCurveTo(-140, -420, -128, -428); g.lineTo(-112, -400);
    g.moveTo(125, -400); g.quadraticCurveTo(140, -420, 128, -428); g.lineTo(112, -400);
    g.fill();
  });
}

function dojoCherry(res, rng, w = 560, h = 520) {
  return makeSprite(w, h, w / 2, h, res, (g) => {
    const trunk = '#2c1622';
    const tips = [];
    const branch = (x, y, ang, len, wid, depth) => {
      const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
      g.strokeStyle = trunk;
      g.lineWidth = wid;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + Math.cos(ang + 0.4) * len * 0.5, y + Math.sin(ang + 0.4) * len * 0.5, x2, y2);
      g.stroke();
      if (depth <= 0 || len < 30) { tips.push([x2, y2]); return; }
      const n = depth > 2 ? 2 : rng.int(2, 3);
      for (let i = 0; i < n; i++) {
        branch(x2, y2, ang + rng.range(-0.75, 0.75), len * rng.range(0.6, 0.8), wid * 0.62, depth - 1);
      }
    };
    branch(0, 0, -Math.PI / 2 + rng.range(-0.15, 0.15), h * 0.3, 30, 4);
    // blossom clusters: shadow -> mid -> lit -> highlight speckles, then loose petals
    const layers = [['#9c4470', 7, 7, 10, 22], ['#d2739b', 1, 7, 8, 18], ['#f2a6c2', -5, 5, 6, 13], ['#ffd9e6', -9, 6, 2.5, 6]];
    for (const [col, off, n, r0, r1] of layers) {
      g.fillStyle = col;
      g.beginPath();
      for (const [tx, ty] of tips) {
        for (let i = 0; i < n; i++) {
          const r = rng.range(r0, r1);
          const px = tx + rng.range(-34, 34), py = ty + rng.range(-24, 20) + off;
          g.moveTo(px + r, py);
          g.arc(px, py, r, 0, TAU);
        }
      }
      g.fill();
    }
    g.fillStyle = 'rgba(255,214,228,0.8)';
    g.beginPath();
    for (const [tx, ty] of tips) {
      for (let i = 0; i < 5; i++) {
        const px = tx + rng.range(-50, 50), py = ty + rng.range(-30, 50), r = rng.range(1.2, 2.6);
        g.moveTo(px + r, py);
        g.arc(px, py, r, 0, TAU);
      }
    }
    g.fill();
  });
}

function dojoLantern(res) {
  return makeSprite(40, 70, 20, 0, res, (g) => {
    g.strokeStyle = '#2b1418';
    g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(0, 9); g.stroke();
    g.fillStyle = rad(g, -4, 28, 2, 22, [[0, '#fff2b8'], [0.35, '#ffb35a'], [0.75, '#e2502f'], [1, '#a3271f']]);
    g.beginPath();
    g.ellipse(0, 33, 17, 21, 0, 0, TAU);
    g.fill();
    g.strokeStyle = 'rgba(120,30,20,0.35)';
    g.lineWidth = 1;
    g.beginPath();
    for (let k = -3; k <= 3; k++) {
      const yy = 33 + k * 5.5, hw = 17 * Math.sqrt(Math.max(0, 1 - (k * 5.5 / 21) ** 2));
      g.moveTo(-hw, yy); g.lineTo(hw, yy);
    }
    g.stroke();
    g.fillStyle = 'rgba(130,25,20,0.55)';
    g.beginPath(); g.arc(0, 34, 6, 0, TAU); g.fill();
    g.fillStyle = '#2b1418';
    g.fillRect(-9, 9, 18, 5);
    g.fillRect(-8, 52, 16, 4);
    g.strokeStyle = '#c22b22';
    g.lineWidth = 1.2;
    g.beginPath();
    for (let k = -2; k <= 2; k++) { g.moveTo(k * 1.6, 56); g.lineTo(k * 2, 68); }
    g.stroke();
  });
}

function dojoPetal(res, light) {
  return makeSprite(14, 10, 7, 5, res * 1.5, (g) => {
    g.fillStyle = lin(g, -7, 0, 7, 0, light ? [[0, '#ffe3ec'], [1, '#f7a3c0']] : [[0, '#f6a2bf'], [1, '#d96b95']]);
    g.beginPath();
    g.moveTo(-7, 0);
    g.quadraticCurveTo(-3, -6, 4, -4);
    g.lineTo(7, -1); g.lineTo(5, 0.5); g.lineTo(7, 2);
    g.quadraticCurveTo(-1, 6, -7, 0);
    g.fill();
  });
}

// Vermilion gate drawn live (cheap vector shapes, no big cached sprite).
function dojoGate(g, x) {
  for (const px of [x - 620, x + 620]) {
    g.fillStyle = lin(g, px - 24, 0, px + 24, 0, [[0, '#4e1519'], [0.45, '#8c2a27'], [1, '#4a1418']]);
    g.beginPath();
    g.moveTo(px - 25, 0); g.lineTo(px - 19, -600); g.lineTo(px + 19, -600); g.lineTo(px + 25, 0);
    g.fill();
    g.fillStyle = '#1d1015';
    g.fillRect(px - 28, -42, 56, 42);
  }
  g.fillStyle = '#7e2523';
  g.fillRect(x - 720, -500, 1440, 30);
  g.fillRect(x - 15, -596, 30, 96);
  g.fillStyle = '#4a1418';
  g.fillRect(x - 720, -472, 1440, 4);
  g.fillStyle = '#1d1015';
  g.fillRect(x - 46, -584, 92, 70);
  g.strokeStyle = '#c99a4a';
  g.lineWidth = 3;
  g.strokeRect(x - 40, -578, 80, 58);
  g.beginPath(); g.arc(x, -549, 14, 0, TAU); g.stroke();
  g.fillStyle = '#862927';
  g.beginPath();
  g.moveTo(x - 770, -624); g.quadraticCurveTo(x, -585, x + 770, -624);
  g.lineTo(x + 780, -644); g.quadraticCurveTo(x, -606, x - 780, -644);
  g.fill();
  g.fillStyle = '#1a0f14';
  g.beginPath();
  g.moveTo(x - 786, -642); g.quadraticCurveTo(x, -604, x + 786, -642);
  g.lineTo(x + 810, -680); g.quadraticCurveTo(x, -630, x - 810, -680);
  g.fill();
  g.strokeStyle = 'rgba(255,170,110,0.85)';
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(x + 810, -680); g.quadraticCurveTo(x, -630, x - 810, -680); g.stroke();
}

IMPL.dojo = {
  build(S) {
    const R = S.rng, res = S.res;
    // High streak clouds lit from below (soft -> low res is fine)
    S.clouds = makeTileT(2400, 400, res * 0.25, (g, w) => {
      for (let i = 0; i < 24; i++) {
        const x = R() * w, y = R.range(40, 360), cw = R.range(160, 560), ch = R.range(9, 22);
        const lit = y / 400;
        wrap(w, x, (xx) => {
          g.fillStyle = lin(g, 0, y - ch * 1.6, 0, y + ch, [[0, rgba(mix('#5a2f6c', '#9a4a78', lit), 0.0)], [0.45, rgba(mix('#6c3a78', '#c45f78', lit), 0.75)], [1, rgba(mix('#e98a78', '#ffc08a', lit), 0.9)]]);
          g.beginPath();
          g.ellipse(xx, y, cw, ch, 0, 0, TAU);
          for (let k = 0; k < 4; k++) {
            const ox = R.range(-0.6, 0.6) * cw, r = ch * R.range(0.7, 1.5);
            g.ellipse(xx + ox, y - r * 0.5, r * R.range(3, 6), r, 0, 0, TAU);
          }
          g.fill();
        });
      }
    });
    // Far range with a lone snow-capped cone
    S.mtnA = makeTile(2400, 400, res * 0.5, (g, w, h) => {
      const f = pfbm(R, [[5, 55], [13, 22], [37, 8], [97, 3]]);
      const cone = 1980;
      const ht = (x) => {
        const d = Math.abs(mod(x - cone + w / 2, w) - w / 2);
        return Math.max(150 + f(x / w), 340 - d * 0.52 + f(x / w + 0.3) * 0.15);
      };
      const path = () => {
        g.beginPath();
        g.moveTo(-8, h);
        for (let x = -8; x <= w + 8; x += 4) g.lineTo(x, h - ht(x));
        g.lineTo(w + 8, h);
        g.closePath();
      };
      path();
      g.fillStyle = lin(g, 0, h - 340, 0, h, [[0, '#8c547c'], [0.55, '#b06c84'], [1, '#e89f80']]);
      g.fill();
      g.save();
      path();
      g.clip();
      g.fillStyle = lin(g, 0, h - 340, 0, h - 240, [[0, '#f2c6cf'], [1, '#d9a2b8']]);
      g.beginPath();
      for (const c of [cone - w, cone, cone + w]) {
        g.moveTo(c - 200, h - 400);
        for (let k = -9; k <= 9; k++) {
          const xx = c + k * 11;
          g.lineTo(xx, h - 268 + Math.abs(k) * 2.5 - (k % 2 ? 0 : 16) + R.range(-6, 6));
        }
        g.lineTo(c + 200, h - 400);
        g.closePath();
      }
      g.fill();
      g.restore();
    });
    S.mtnB = makeTile(2400, 300, res * 0.5, (g, w, h) => {
      const f = pfbm(R, [[6, 45], [17, 18], [61, 5], [300, 2.5]]);
      g.beginPath();
      g.moveTo(-8, h);
      for (let x = -8; x <= w + 8; x += 3) g.lineTo(x, h - (120 + f(x / w)));
      g.lineTo(w + 8, h);
      g.closePath();
      g.fillStyle = lin(g, 0, h - 200, 0, h, [[0, '#673865'], [1, '#b0607a']]);
      g.fill();
    });
    S.hills = makeTile(2400, 440, res * 0.5, (g, w, h) => {
      const f = pfbm(R, [[4, 30], [11, 14], [40, 4]]);
      const hy = (x) => h - (70 + f(x / w));
      g.beginPath();
      g.moveTo(-8, h);
      for (let x = -8; x <= w + 8; x += 4) g.lineTo(x, hy(x));
      g.lineTo(w + 8, h);
      g.closePath();
      g.fillStyle = lin(g, 0, h - 110, 0, h, [[0, '#45244d'], [1, '#7a3c5c']]);
      g.fill();
      const col = '#45244d';
      for (let i = 0; i < 26; i++) {
        const x = R() * w, th = R.range(40, 110);
        wrap(w, x, (xx) => drawPine(g, xx, hy(x) + 6, th, col, makeRng(i * 977 + 13)));
      }
      wrap(w, 700, (xx) => drawPagoda(g, xx, hy(700) + 8, 1.05, 5, col, '#3a1d42', 'rgba(255,150,100,0.5)', 'rgba(255,190,120,0.6)'));
      wrap(w, 1900, (xx) => drawPagoda(g, xx, hy(1900) + 8, 0.7, 3, col, '#3a1d42', 'rgba(255,150,100,0.4)', 'rgba(255,190,120,0.5)'));
    });
    const hall = dojoHall(res * 0.75);
    const pag = makeSprite(320, 680, 160, 680, res * 0.75, (g) => {
      g.fillStyle = rad(g, 0, -200, 10, 260, [[0, 'rgba(255,170,100,0.18)'], [1, 'rgba(255,150,90,0)']]);
      g.fillRect(-160, -680, 320, 680);
      drawPagoda(g, 0, 0, 1.55, 5, '#3c1f38', '#26132a', 'rgba(255,170,110,0.8)', 'rgba(255,200,130,0.75)');
    });
    const shrine = makeSprite(420, 240, 210, 240, res * 0.75, (g) => {
      g.fillStyle = '#3c1f38';
      g.fillRect(-140, -110, 280, 110);
      g.fillStyle = 'rgba(255,200,130,0.6)';
      g.fillRect(-110, -96, 220, 70);
      g.fillStyle = '#24112a';
      for (let i = 0; i < 5; i++) g.fillRect(-112 + i * 55, -100, 6, 100);
      g.fillStyle = '#26132a';
      roofPath(g, 0, -104, 190, 90, 26);
      g.fill();
      roofRim(g, 0, -104, 190, 90, 26, 'rgba(255,170,110,0.8)', 2);
    });
    S.buildings = [{ s: hall, x: 560, sc: 0.82 }, { s: pag, x: -700, sc: 0.9 }, { s: shrine, x: 1500 }, { s: pag, x: 2300, sc: 0.75 }];
    S.trees = [
      { s: dojoCherry(res * 0.6, makeRng(S.seed * 31 + 1)), x: -1250 },
      { s: dojoCherry(res * 0.6, makeRng(S.seed * 31 + 2), 640, 560), x: 1120 },
      { s: dojoCherry(res * 0.6, makeRng(S.seed * 31 + 3)), x: 2150, sc: 0.9 },
    ];
    // Low courtyard wall with tiled cap
    S.wall = makeTile(2400, 140, res * 0.75, (g, w, h) => {
      g.fillStyle = lin(g, 0, h - 92, 0, h, [[0, '#8a4b57'], [1, '#5a2e3e']]);
      g.fillRect(-8, h - 92, w + 16, 92);
      g.fillStyle = '#3f2230';
      g.fillRect(-8, h - 14, w + 16, 14);
      for (let x = 0; x < w; x += 300) {
        wrap(w, x, (xx) => {
          g.fillStyle = '#3a1d2b';
          g.fillRect(xx - 8, h - 96, 16, 96);
        });
      }
      for (const cx of [450, 1650]) {
        wrap(w, cx, (xx) => {
          g.fillStyle = 'rgba(255,205,135,0.75)';
          g.beginPath(); g.arc(xx, h - 52, 24, 0, TAU); g.fill();
          g.strokeStyle = '#5a2d3a'; g.lineWidth = 3;
          g.beginPath(); g.arc(xx, h - 52, 24, 0, TAU);
          g.moveTo(xx - 24, h - 52); g.lineTo(xx + 24, h - 52);
          g.moveTo(xx, h - 76); g.lineTo(xx, h - 28); g.stroke();
        });
      }
      g.fillStyle = '#2a1622';
      g.beginPath();
      g.moveTo(-8, h - 90);
      g.lineTo(w + 8, h - 90);
      g.lineTo(w + 8, h - 112);
      g.lineTo(-8, h - 112);
      g.fill();
      g.fillStyle = '#3a2030';
      g.fillRect(-8, h - 92, w + 16, 4);
      g.strokeStyle = 'rgba(0,0,0,0.25)';
      g.lineWidth = 1;
      g.beginPath();
      for (let x = 0; x < w + 8; x += 9) { g.moveTo(x, h - 110); g.lineTo(x, h - 92); }
      g.stroke();
      g.strokeStyle = 'rgba(255,170,120,0.8)';
      g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(-8, h - 112); g.lineTo(w + 8, h - 112); g.stroke();
    });
    S.lanternSpr = dojoLantern(res);
    S.lanterns = [];
    for (let i = 0; i < 7; i++) {
      const t = (i + 0.5) / 7;
      S.lanterns.push({ x: -1250 + t * 2500, t, ang: 0, av: 0, ph: R() * TAU, len: 14 + R() * 10 });
    }
    S.petalSpr = [dojoPetal(res, false), dojoPetal(res, true)];
    S.petals = makeField(S.frng, S.n(70), (p, r) => {
      p.d = r.range(0.25, 0.85); p.s = 0.55 + p.d * 0.8; p.vx = r.range(25, 60); p.vy = r.range(18, 40);
      p.vr = r.range(-2, 2); p.v = r.int(0, 1); p.a = 0.55 + p.d * 0.45;
    });
    S.petalsF = makeField(S.frng, S.n(16), (p, r) => {
      p.d = r.range(1.2, 1.6); p.s = r.range(1.8, 2.6); p.vx = r.range(50, 90); p.vy = r.range(35, 60);
      p.vr = r.range(-2.5, 2.5); p.v = r.int(0, 1); p.a = 0.9;
    });
    // Plank rows (floor depth of each seam), growing toward the viewer
    S.rows = [0];
    for (let r = 0, w = 15; r < 300; w *= 1.13) { r += w; S.rows.push(r); }
    S.grain = makeTileT(1600, 260, res * 0.5, (g, w, h) => {
      for (let i = 0; i < 260; i++) {
        const y = R() * h, x = R() * w, len = R.range(80, 400);
        const dark = R() < 0.7;
        g.strokeStyle = dark ? `rgba(40,16,6,${R.range(0.12, 0.3)})` : `rgba(255,210,160,${R.range(0.05, 0.12)})`;
        g.lineWidth = R.range(0.6, 1.8);
        wrap(w, x, (xx) => {
          g.beginPath();
          g.moveTo(xx, y);
          g.bezierCurveTo(xx + len * 0.3, y + R.range(-2, 2), xx + len * 0.6, y + R.range(-2, 2), xx + len, y);
          g.stroke();
        });
      }
    });
    S.birds = null;
    S.birdTimer = 4;
  },

  update(S, dt) {
    const t = S.t;
    stepField(S.petals, dt, t, 22, 1.3);
    stepField(S.petalsF, dt, t, 30, 1.1);
    stepPendulums(S.lanterns, dt, 9, 1.1, t, 0.05);
    S.birdTimer -= dt;
    if (S.birdTimer <= 0) {
      const R = S.rng, dir = R() < 0.5 ? 1 : -1;
      S.birds = { x: -dir * 1300, y: R.range(-520, -360), dir, list: Array.from({ length: R.int(4, 7) }, (_, i) => [i * -38 * dir + R.range(-10, 10), Math.abs(i - 2) * 14 + R.range(-6, 6), R() * TAU]) };
      S.birdTimer = R.range(14, 24);
    }
    if (S.birds) {
      S.birds.x += S.birds.dir * 70 * dt;
      if (Math.abs(S.birds.x) > 1500) S.birds = null;
    }
  },

  back(ctx, S, cam, view) {
    const t = S.t;
    drawSky(ctx, cam, view, DOJO_SKY, -780, 0);
    // Sun with glow and slow rays
    let b = layer(ctx, cam, view, 0.03);
    const sx = -60, sy = -250;
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(ctx, '255,120,70', sx, sy, 640, 0.45);
    drawGlow(ctx, '255,200,120', sx, sy, 230, 0.6);
    if (S.hi) {
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(t * 0.02);
      ctx.fillStyle = 'rgba(255,190,120,0.05)';
      ctx.beginPath();
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * TAU;
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, 900, a, a + 0.09);
      }
      ctx.fill();
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = rad(ctx, sx - 12, sy - 12, 5, 64, [[0, '#fffbe6'], [0.6, '#ffe7a6'], [1, '#ffc272']]);
    ctx.beginPath(); ctx.arc(sx, sy, 62, 0, TAU); ctx.fill();
    ctx.restore();
    b = layer(ctx, cam, view, 0.05);
    drawTile(ctx, b, S.clouds, -640, t * 7);
    ctx.restore();
    b = layer(ctx, cam, view, 0.09);
    drawTile(ctx, b, S.mtnA, -400, 0, '#e89f80');
    ctx.restore();
    // Distant birds
    if (S.birds) {
      b = layer(ctx, cam, view, 0.14);
      ctx.strokeStyle = 'rgba(50,20,50,0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (const [ox, oy, ph] of S.birds.list) {
        const x = S.birds.x + ox, y = S.birds.y + oy, f = Math.sin(t * 9 + ph) * 5;
        ctx.moveTo(x - 9, y - f); ctx.quadraticCurveTo(x - 4, y - 2, x, y + 1); ctx.quadraticCurveTo(x + 4, y - 2, x + 9, y - f);
      }
      ctx.stroke();
      ctx.restore();
    }
    b = layer(ctx, cam, view, 0.16);
    drawTile(ctx, b, S.mtnB, -300, 0, '#b0607a');
    ctx.restore();
    b = layer(ctx, cam, view, 0.27);
    drawTile(ctx, b, S.hills, -440, 0, '#7a3c5c');
    ctx.restore();
    b = layer(ctx, cam, view, 0.42);
    drawInstances(ctx, b, S.buildings, 3600);
    ctx.fillStyle = '#3c1f38';
    ctx.fillRect(b.x0 - 4, -1, b.x1 - b.x0 + 8, b.y1 + 4);
    ctx.restore();
    b = layer(ctx, cam, view, 0.54);
    drawInstances(ctx, b, S.trees, 2900);
    ctx.restore();
    b = layer(ctx, cam, view, 0.62);
    drawTile(ctx, b, S.wall, -140, 0, '#5a2e3e');
    ctx.restore();
    b = layer(ctx, cam, view, 0.74);
    eachCopy(0, 4400, b.x0, b.x1, 860, (gx) => dojoGate(ctx, gx));
    ctx.restore();

    // Lantern string (poles every 2500)
    b = layer(ctx, cam, view, 0.9);
    const span = 2500, top = -640, sag = 120;
    ctx.fillStyle = '#2a1520';
    eachCopy(-1250, span, b.x0, b.x1, 30, (px) => {
      ctx.fillRect(px - 9, top - 20, 18, -top + 20);
      ctx.fillRect(px - 16, top - 26, 32, 8);
    });
    ctx.strokeStyle = 'rgba(40,18,26,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    eachCopy(-1250, span, b.x0 - span, b.x1, 0, (px) => {
      ctx.moveTo(px, top);
      ctx.quadraticCurveTo(px + span / 2, top + sag * 2, px + span, top);
    });
    ctx.stroke();
    const m = ctx.getTransform();
    const ls = S.lanternSpr;
    const flick = 0.85 + 0.15 * Math.sin(t * 7.3) * Math.sin(t * 3.1);
    const lit = (S.litX = S.litX || []);
    lit.length = 0;
    for (const L of S.lanterns) {
      eachCopy(L.x, span, b.x0, b.x1, 80, (lx) => {
        const ly = top + sag * 4 * L.t * (1 - L.t) - 2;
        lit.push(lx);
        const ex = lx - Math.sin(L.ang) * (L.len + 34), ey = ly + Math.cos(L.ang) * (L.len + 34);
        ctx.globalCompositeOperation = 'lighter';
        drawGlow(ctx, '255,140,60', ex, ey, 90, 0.32 * flick);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#2b1418';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx - Math.sin(L.ang) * L.len, ly + Math.cos(L.ang) * L.len); ctx.stroke();
        if (ls) {
          setLocal(ctx, m, lx - Math.sin(L.ang) * L.len, ly + Math.cos(L.ang) * L.len, L.ang, 1, 1);
          ctx.drawImage(ls.c, -ls.ax, -ls.ay, ls.w, ls.h);
          ctx.setTransform(m);
        }
      });
    }
    ctx.restore();
    // Back petals (behind fighters)
    drawSpriteField(ctx, S.petals, cam, view, S.petalSpr, t, 2.2);

    // Floor: polished wooden planks
    const F = floorView(cam, view);
    if (F.gy < view.h) {
      floorBase(ctx, F, [[0, '#c98048'], [0.08, '#9a5a33'], [0.4, '#6c3b24'], [1, '#3a1f15']]);
      floorTexture(ctx, F, S.grain, 1);
      // alternate plank tint
      const rows = S.rows;
      ctx.fillStyle = 'rgba(60,20,10,0.16)';
      ctx.beginPath();
      for (let k = 0; k < rows.length - 1 && rows[k] < F.rMax; k++) {
        const r0 = rows[k], r1 = rows[k + 1];
        const L = 230 + ((k * 53) % 110), off = (k * 137) % L;
        let u = Math.floor((fU0(F, r1) - off) / L) * L + off;
        for (let n = Math.floor(u / L); u < fU1(F, r1); u += L, n++) {
          if (((n * 7 + k * 3) & 3) !== 0) continue;
          ctx.moveTo(fX(F, u, r0), fY(F, r0));
          ctx.lineTo(fX(F, u + L, r0), fY(F, r0));
          ctx.lineTo(fX(F, u + L, r1), fY(F, r1));
          ctx.lineTo(fX(F, u, r1), fY(F, r1));
        }
      }
      ctx.fill();
      // seams + joints
      ctx.strokeStyle = 'rgba(35,12,6,0.55)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let k = 1; k < rows.length && rows[k] < F.rMax; k++) {
        const y = fY(F, rows[k]);
        ctx.moveTo(0, y); ctx.lineTo(view.w, y);
      }
      for (let k = 0; k < rows.length - 1 && rows[k] < F.rMax; k++) {
        const r0 = rows[k], r1 = rows[k + 1];
        const L = 230 + ((k * 53) % 110), off = (k * 137) % L;
        let u = Math.floor((fU0(F, r1) - off) / L) * L + off;
        for (; u < fU1(F, r1); u += L) {
          ctx.moveTo(fX(F, u, r0), fY(F, r0));
          ctx.lineTo(fX(F, u, r1), fY(F, r1));
        }
      }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,200,150,0.12)';
      ctx.beginPath();
      for (let k = 1; k < rows.length && rows[k] < F.rMax; k++) {
        const y = fY(F, rows[k]) + 1.2;
        ctx.moveTo(0, y); ctx.lineTo(view.w, y);
      }
      ctx.stroke();
      // sunset sheen + lantern / gate reflections
      ctx.globalCompositeOperation = 'lighter';
      const [ssx] = layerToScreen(cam, view, 0.03, -60, -250);
      drawGlowE(ctx, '255,150,80', ssx, F.gy + 10 * F.z, 700 * F.z, 110 * F.z, 0.35, 2);
      for (const wx of lit) {
        const [lx] = layerToScreen(cam, view, 0.9, wx, 0);
        drawGlowE(ctx, '255,140,70', lx, F.gy + 40 * F.z, 26 * F.z, 50 * F.z, 0.18 * flick, 1);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      for (const gx of [-620, 620]) {
        eachCopy(gx, 4400, cam.x * 0.74 - view.w, cam.x * 0.74 + view.w, 0, (xx) => {
          const [px, , pz] = layerToScreen(cam, view, 0.74, xx, 0);
          if (px < -60 || px > view.w + 60) return;
          drawGlowE(ctx, '60,12,18', px, F.gy, 34 * pz, 120 * F.z, 0.45, 1);
        });
      }
      ctx.fillStyle = 'rgba(255,205,150,0.55)';
      ctx.fillRect(0, F.gy - 0.5, view.w, 1.5 * F.z);
      ctx.fillStyle = lin(ctx, 0, F.gy, 0, view.h, [[0, 'rgba(30,10,20,0)'], [1, 'rgba(30,10,20,0.35)']]);
      ctx.fillRect(0, F.gy, view.w, view.h - F.gy);
    }
  },

  front(ctx, S, cam, view) {
    drawSpriteField(ctx, S.petalsF, cam, view, S.petalSpr, S.t, 1.6);
    screenGrad(ctx, view, [[0, 'rgba(255,140,80,0.06)'], [0.5, 'rgba(255,140,80,0)'], [1, 'rgba(60,10,40,0.12)']]);
    vignette(ctx, view, '40,10,40', 0.5);
  },

  impact(S, x, y, p) {
    kickPendulums(S.lanterns, x, p, 500, 1.6, 2500);
    burst(S, S.n(Math.round(6 + p * 14)), (R) => ({
      k: 'leaf', spr: S.petalSpr[R.int(0, 1)], x: x + R.range(-40, 40), y: y - R.range(0, 30),
      vx: R.range(-160, 160) * (0.5 + p), vy: -R.range(80, 260) * (0.5 + p), g: 160, drag: 2.2,
      life: R.range(2, 3.5), s: R.range(1.2, 1.9), rot: R() * TAU, vr: R.range(-6, 6), ph: R() * TAU,
      sway: 30, front: R() < 0.4, fy: R.range(2, 40), bounce: 0,
    }));
    burst(S, S.n(Math.round(3 + p * 6)), (R) => ({
      k: 'puff', rgb: '210,160,120', x: x + R.range(-50, 50), y: R.range(-6, 0), vx: R.range(-90, 90), vy: -R.range(5, 30),
      drag: 3, life: R.range(0.6, 1.1), s: R.range(16, 30), grow: 40, a: 0.35, fy: 10,
    }));
  },
};

// ═════════════════════════════════════════════════════════════════════════
// 2. Neon Rooftop
// ═════════════════════════════════════════════════════════════════════════

const ROOF_SKY = [[0, '#05050f'], [0.35, '#0c0a24'], [0.6, '#1d1140'], [0.8, '#3a1953'], [0.92, '#652466'], [1, '#8a2f6e']];
const NEON = ['255,60,200', '60,240,255', '255,200,60', '140,90,255', '255,90,90'];

// Skyline strip: rectangles with lit window dots. Used for the far and mid tiles.
function skylineTile(R, w, h, res, o) {
  return makeTile(w, h, res, (g) => {
    let x = 0;
    const blds = [];
    while (x < w) {
      const bw = R.range(o.minW, o.maxW), bh = R.range(o.minH, o.maxH) * (R() < 0.12 ? 1.35 : 1);
      blds.push([x, bw, Math.min(bh, h - 20)]);
      x += bw + R.range(-6, 10);
    }
    for (const [bx, bw, bh] of blds) {
      wrap(w, bx, (xx) => {
        g.fillStyle = o.body;
        g.fillRect(xx, h - bh, bw, bh);
        if (R() < 0.3) g.fillRect(xx + bw * 0.2, h - bh - 14, bw * 0.6, 14);
        if (R() < 0.25) { g.fillRect(xx + bw * 0.5 - 1, h - bh - 70, 2, 70); }
        if (o.edge && R() < 0.35) {
          g.fillStyle = `rgba(${R.pick(NEON)},${o.edge})`;
          g.fillRect(xx + (R() < 0.5 ? 0 : bw - 2), h - bh, 2, bh * R.range(0.4, 1));
        }
      });
    }
    // windows
    for (const [bx, bw, bh] of blds) {
      const cols = Math.floor((bw - 8) / o.wx), rows = Math.floor((bh - 16) / o.wy);
      const density = R.range(0.08, o.density);
      const tint = R.pick(['255,210,140', '150,230,255', '255,150,230', '255,240,200']);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (R() > density) continue;
          g.fillStyle = `rgba(${tint},${R.range(o.wa * 0.4, o.wa)})`;
          const wx = bx + 5 + c * o.wx, wy = h - bh + 10 + r * o.wy;
          wrap(w, wx, (xx) => g.fillRect(xx, wy, o.wx * 0.5, o.wy * 0.55));
        }
      }
    }
    g.fillStyle = lin(g, 0, h - 200, 0, h, [[0, 'rgba(0,0,0,0)'], [1, o.haze]]);
    g.fillRect(-8, h - 200, w + 16, 200);
  });
}

function roofBuilding(res, R, w, h) {
  return makeSprite(w + 20, h + 90, (w + 20) / 2, h + 90, res, (g) => {
    const x0 = -w / 2;
    g.fillStyle = lin(g, x0, 0, x0 + w, 0, [[0, '#1c1736'], [0.5, '#141029'], [1, '#100d22']]);
    g.fillRect(x0, -h, w, h);
    // crown
    const crown = R.int(0, 2);
    g.fillStyle = '#141029';
    if (crown === 0) { g.fillRect(x0 + w * 0.15, -h - 30, w * 0.7, 30); g.fillRect(x0 + w * 0.35, -h - 55, w * 0.3, 25); }
    if (crown === 1) { g.beginPath(); g.moveTo(x0, -h); g.lineTo(0, -h - 70); g.lineTo(x0 + w, -h); g.fill(); }
    if (crown === 2) { g.fillRect(-3, -h - 85, 6, 85); g.fillRect(x0 + w * 0.1, -h - 18, w * 0.8, 18); }
    const tint = R.pick(['255,210,140', '150,230,255', '255,170,230']);
    const cols = Math.floor((w - 20) / 16), rows = Math.floor((h - 30) / 20);
    for (let r = 0; r < rows; r++) {
      const fade = 1 - (r / rows) * 0.55;
      for (let c = 0; c < cols; c++) {
        const lit = R() < 0.32;
        g.fillStyle = lit ? `rgba(${R() < 0.8 ? tint : R.pick(NEON)},${R.range(0.45, 0.9) * fade})` : 'rgba(40,34,70,0.8)';
        g.fillRect(x0 + 12 + c * 16, -h + 14 + r * 20, 8, 11);
      }
    }
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (let r = 0; r < rows; r += 4) g.fillRect(x0, -h + 10 + r * 20, w, 3);
    g.fillStyle = 'rgba(255,80,200,0.35)';
    g.fillRect(x0, -h, 2, h);
    g.fillStyle = 'rgba(80,230,255,0.25)';
    g.fillRect(x0 + w - 2, -h, 2, h);
  });
}

// Invented glyph: 2-4 strokes on a 3x4 grid.
function glyphStrokes(g, R, x, y, s) {
  const n = R.int(2, 4);
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const a = [R.int(0, 2), R.int(0, 3)];
    const b = [clamp(a[0] + R.int(-2, 2), 0, 2), clamp(a[1] + R.int(-2, 2), 0, 3)];
    if (a[0] === b[0] && a[1] === b[1]) b[1] = (b[1] + 2) % 4;
    g.moveTo(x + a[0] * s * 0.5, y + a[1] * s * 0.4);
    g.lineTo(x + b[0] * s * 0.5, y + b[1] * s * 0.4);
  }
  g.stroke();
}
function neonSign(res, R, kind, rgb) {
  const dims = kind === 'v' ? [70, 250] : kind === 'h' ? [300, 92] : [120, 120];
  const [w, h] = dims;
  return makeSprite(w + 40, h + 40, (w + 40) / 2, (h + 40) / 2, res, (g) => {
    g.fillStyle = 'rgba(12,8,24,0.92)';
    g.fillRect(-w / 2, -h / 2, w, h);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const tube = (lw, blur) => {
      g.strokeStyle = blur ? `rgb(${rgb})` : 'rgba(255,255,255,0.9)';
      g.shadowColor = `rgb(${rgb})`;
      g.shadowBlur = blur;
      g.lineWidth = lw;
    };
    const paint = () => {
      g.strokeRect(-w / 2 + 6, -h / 2 + 6, w - 12, h - 12);
      const RR = makeRng(Math.floor(R.seedv));
      if (kind === 'v') {
        for (let i = 0; i < 4; i++) glyphStrokes(g, RR, -20, -h / 2 + 22 + i * 55, 40);
      } else if (kind === 'h') {
        g.font = 'bold 54px sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.strokeText(R.word, 0, 3);
      } else {
        g.beginPath();
        g.moveTo(8, -38); g.lineTo(-18, 6); g.lineTo(4, 6); g.lineTo(-8, 40); g.lineTo(22, -10); g.lineTo(0, -10); g.closePath();
        g.stroke();
        g.beginPath(); g.arc(0, 0, 48, 0, TAU); g.stroke();
      }
    };
    R.seedv = R() * 1e6;
    tube(6, 16); paint();
    tube(2, 0); g.shadowBlur = 0; paint();
  });
}

IMPL.rooftop = {
  build(S) {
    const R = S.rng, res = S.res;
    S.clouds = makeTileT(2400, 360, res * 0.25, (g, w) => {
      for (let i = 0; i < 18; i++) {
        const x = R() * w, y = R.range(60, 330), cw = R.range(200, 520), ch = R.range(18, 40);
        wrap(w, x, (xx) => {
          g.fillStyle = lin(g, 0, y - ch, 0, y + ch, [[0, 'rgba(60,30,90,0)'], [0.6, 'rgba(90,40,110,0.45)'], [1, 'rgba(200,80,170,0.5)']]);
          g.beginPath();
          g.ellipse(xx, y, cw, ch, 0, 0, TAU);
          g.ellipse(xx + cw * 0.3, y - ch * 0.5, cw * 0.5, ch, 0, 0, TAU);
          g.fill();
        });
      }
    });
    S.far = skylineTile(R, 2400, 600, res * 0.5, { minW: 30, maxW: 110, minH: 140, maxH: 520, body: '#1b1838', wx: 7, wy: 9, density: 0.3, wa: 0.45, haze: 'rgba(110,40,120,0.85)', edge: 0 });
    S.mid = skylineTile(R, 2400, 520, res * 0.5, { minW: 60, maxW: 170, minH: 120, maxH: 380, body: '#120f27', wx: 11, wy: 14, density: 0.3, wa: 0.6, haze: 'rgba(80,28,100,0.95)', edge: 0.5 });
    const bres = res * 0.6;
    S.near = [
      { s: roofBuilding(bres, R, 280, 640), x: -800 },
      { s: roofBuilding(bres, R, 320, 560), x: 680 },
      { s: roofBuilding(bres, R, 240, 700), x: 1120 },
      { s: roofBuilding(bres, R, 300, 520), x: -1300 },
      { s: roofBuilding(bres, R, 260, 600), x: 1700 },
    ];
    const words = ['ZEKKO', 'VEXA', 'NOIRU', 'KAZO', 'LUMA', 'TOVRA', 'OKIDO'];
    let wi = R.int(0, words.length - 1);
    S.signs = [];
    const addSign = (kind, x, y, rgb) => {
      R.word = words[wi++ % words.length];
      S.signs.push({ s: neonSign(res * 0.6, R, kind, rgb), x, y, rgb, kind, a: 1, flick: 0, ph: R() * TAU });
    };
    addSign('v', -625, -390, NEON[0]);
    addSign('h', 600, -470, NEON[1]);
    addSign('s', 1000, -260, NEON[2]);
    addSign('h', -1300, -380, NEON[3]);
    addSign('v', 1540, -360, NEON[4]);
    addSign('h', 2050, -420, NEON[0]);
    // smaller signs on the mid skyline
    S.midSigns = [];
    for (const [x, y, kind, rgb] of [[-260, -330, 'h', NEON[3]], [420, -300, 's', NEON[0]], [-900, -280, 'v', NEON[1]], [1050, -340, 'h', NEON[4]]]) {
      R.word = words[wi++ % words.length];
      S.midSigns.push({ s: neonSign(res * 0.4, R, kind, rgb), x, y, rgb, kind, a: 1, flick: 0, ph: R() * TAU });
    }
    // Live windows that toggle on/off on the near buildings
    S.wins = [];
    for (const b of S.near) {
      if (!b.s) continue;
      for (let i = 0; i < 6; i++) {
        S.wins.push({ x: b.x - b.s.w / 2 + 22 + R.int(0, Math.floor((b.s.w - 60) / 16)) * 16, y: -(b.s.h - 90) + 14 + R.int(2, 22) * 20, on: R() < 0.5, t: R.range(1, 8), c: R.pick(['255,210,140', '150,230,255', '255,170,230']) });
      }
    }
    // Antenna beacons (layer p, x, y)
    S.beacons = [
      [0.22, -420, -560], [0.22, 380, -610], [0.22, 960, -520], [0.42, -800, -760], [0.42, 1120, -800], [0.12, 120, -470], [0.12, -900, -500],
    ].map(([p, x, y]) => ({ p, x, y, ph: R() * 3 }));
    const pres = res * 0.75;
    S.tower = makeSprite(280, 470, 140, 470, pres, (g) => {
      g.strokeStyle = '#0e0c1a';
      g.lineWidth = 7;
      g.beginPath();
      for (const lx of [-90, -30, 30, 90]) { g.moveTo(lx, 0); g.lineTo(lx * 0.8, -230); }
      g.moveTo(-90, -40); g.lineTo(90, -150); g.moveTo(90, -40); g.lineTo(-90, -150);
      g.stroke();
      g.fillStyle = '#0e0c1a';
      g.fillRect(-100, -236, 200, 10);
      g.fillStyle = lin(g, -95, 0, 95, 0, [[0, '#2c2036'], [0.4, '#1b1426'], [1, '#110d1a']]);
      g.beginPath();
      g.moveTo(-95, -226); g.lineTo(-95, -410); g.lineTo(0, -460); g.lineTo(95, -410); g.lineTo(95, -226);
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.5)';
      g.lineWidth = 2;
      g.beginPath();
      for (let y = -250; y > -410; y -= 32) { g.moveTo(-95, y); g.lineTo(95, y); }
      g.stroke();
      g.strokeStyle = 'rgba(255,90,200,0.35)';
      g.beginPath(); g.moveTo(-95, -226); g.lineTo(-95, -410); g.lineTo(0, -460); g.stroke();
    });
    S.ac = makeSprite(340, 140, 170, 140, pres, (g) => {
      const unit = (x, w, h) => {
        g.fillStyle = lin(g, 0, -h, 0, 0, [[0, '#2a2440'], [1, '#141020']]);
        g.fillRect(x, -h, w, h);
        g.strokeStyle = 'rgba(0,0,0,0.5)';
        g.lineWidth = 2;
        g.beginPath(); g.arc(x + w / 2, -h / 2, h * 0.32, 0, TAU); g.stroke();
        g.beginPath();
        for (let k = -2; k <= 2; k++) { g.moveTo(x + w / 2 - h * 0.3, -h / 2 + k * 6); g.lineTo(x + w / 2 + h * 0.3, -h / 2 + k * 6); }
        g.stroke();
        g.fillStyle = 'rgba(80,230,255,0.25)';
        g.fillRect(x, -h, w, 2);
      };
      unit(-160, 130, 90); unit(-20, 110, 70); unit(100, 60, 120);
      g.fillStyle = '#100d1c';
      g.fillRect(110, -130, 40, 10);
    });
    S.shed = makeSprite(280, 240, 140, 240, pres, (g) => {
      g.fillStyle = '#17132a';
      g.fillRect(-130, -200, 260, 200);
      g.fillStyle = '#0f0c1c';
      g.fillRect(-140, -214, 280, 16);
      g.fillStyle = '#231d3a';
      g.fillRect(-30, -150, 60, 150);
      g.fillStyle = 'rgba(255,220,150,0.18)';
      g.fillRect(-30, -150, 60, 150);
      g.fillStyle = '#ffe2a8';
      g.fillRect(-8, -172, 16, 7);
    });
    S.props = [{ s: S.tower, x: -560 }, { s: S.ac, x: 700 }, { s: S.shed, x: 1260 }];
    S.noise = makeTileT(1200, 250, res * 0.5, (g, w, h) => {
      for (let i = 0; i < 1600; i++) {
        g.fillStyle = R() < 0.5 ? `rgba(0,0,0,${R.range(0.1, 0.35)})` : `rgba(160,140,220,${R.range(0.03, 0.08)})`;
        const x = R() * w, y = R() * h, s = R.range(1, 4);
        wrap(w, x, (xx) => g.fillRect(xx, y, s * 1.6, s * 0.5));
      }
    });
    // Puddles in floor space (u, r, half width, half depth), period 1800
    S.puddles = [];
    for (let i = 0; i < 9; i++) S.puddles.push([R() * 1800, R.range(12, 150), R.range(60, 190), R.range(6, 20)]);
    S.rain = makeField(S.frng, S.n(170), (p, r) => { p.d = r.range(0.3, 0.85); p.vx = -90; p.vy = r.range(900, 1200); p.len = r.range(14, 26); });
    S.rainF = makeField(S.frng, S.n(40), (p, r) => { p.d = r.range(1.2, 1.6); p.vx = -120; p.vy = r.range(1300, 1600); p.len = r.range(30, 48); });
    S.splash = [];
    S.cars = [];
    S.carT = 1;
    S.flash = 0;
    S.flashT = R.range(4, 9);
    S.bolt = null;
  },

  update(S, dt) {
    const R = S.rng, t = S.t;
    stepField(S.rain, dt, t);
    stepField(S.rainF, dt, t);
    for (const w of S.wins) {
      w.t -= dt;
      if (w.t <= 0) { w.on = !w.on; w.t = R.range(2, 12); }
    }
    for (const s of S.signs.concat(S.midSigns)) {
      s.flick -= dt;
      if (s.flick <= 0 && R() < dt * 0.15) s.flick = R.range(0.2, 0.9);
      s.a = s.flick > 0 ? (Math.sin(t * 60 + s.ph) > 0.2 ? 1 : 0.15) : 0.92 + 0.08 * Math.sin(t * 9 + s.ph);
    }
    // Rain splashes on the floor (floor coords)
    const nS = S.hi ? 5 : 2;
    for (let i = 0; i < nS; i++) if (R() < dt * 40) S.splash.push({ u: R.range(-1400, 1400), r: R.range(2, 220), t: 0 });
    for (let i = S.splash.length - 1; i >= 0; i--) {
      const s = S.splash[i];
      s.t += dt;
      if (s.t > 0.35) S.splash.splice(i, 1);
    }
    // Flying vehicles
    S.carT -= dt;
    if (S.carT <= 0) {
      const dir = R() < 0.5 ? 1 : -1, p = R.range(0.14, 0.32);
      S.cars.push({ p, x: -dir * 1500, y: R.range(-640, -360), vx: dir * R.range(90, 170), bob: R() * TAU });
      S.carT = R.range(3, 7);
    }
    for (let i = S.cars.length - 1; i >= 0; i--) {
      const c = S.cars[i];
      c.x += c.vx * dt;
      if (Math.abs(c.x) > 1700) S.cars.splice(i, 1);
    }
    // Distant lightning
    S.flashT -= dt;
    if (S.flashT <= 0) {
      S.flash = 1;
      S.flashT = R.range(8, 18);
      const bx = R.range(-700, 700);
      const pts = [bx, -760];
      let x = bx, y = -760;
      while (y < -330) { x += R.range(-40, 40); y += R.range(25, 55); pts.push(x, y); }
      S.bolt = pts;
    }
    S.flash = Math.max(0, S.flash - dt * 2.4);
  },

  back(ctx, S, cam, view) {
    const t = S.t;
    drawSky(ctx, cam, view, ROOF_SKY, -780, 0);
    const fl = S.flash > 0 ? S.flash * (0.6 + 0.4 * Math.sin(S.flash * 40)) : 0;
    let b = layer(ctx, cam, view, 0.03);
    ctx.globalCompositeOperation = 'lighter';
    drawGlowE(ctx, '200,60,160', 0, -40, 1400, 300, 0.35, 2);
    if (fl > 0.02) {
      ctx.globalAlpha = fl * 0.35;
      ctx.fillStyle = '#9a8cff';
      ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      if (S.bolt && fl > 0.3) {
        ctx.globalAlpha = fl;
        ctx.strokeStyle = '#e8e0ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(S.bolt[0], S.bolt[1]);
        for (let i = 2; i < S.bolt.length; i += 2) ctx.lineTo(S.bolt[i], S.bolt[i + 1]);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
    b = layer(ctx, cam, view, 0.05);
    drawTile(ctx, b, S.clouds, -720, t * 5);
    ctx.restore();
    b = layer(ctx, cam, view, 0.12);
    drawTile(ctx, b, S.far, -600, 0, '#4a1d5c');
    ctx.restore();
    // Flying vehicles between skyline depths
    for (const c of S.cars) {
      b = layer(ctx, cam, view, c.p);
      const y = c.y + Math.sin(t * 1.3 + c.bob) * 6, dir = Math.sign(c.vx);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = lin(ctx, c.x - dir * 90, 0, c.x, 0, [[0, 'rgba(255,60,90,0)'], [1, 'rgba(255,60,90,0.5)']]);
      ctx.fillRect(Math.min(c.x, c.x - dir * 90), y - 1, 90, 2);
      drawGlow(ctx, '255,240,220', c.x + dir * 6, y, 14, 0.9);
      drawGlow(ctx, '255,60,80', c.x - dir * 6, y, 10, 0.8);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.restore();
    }
    b = layer(ctx, cam, view, 0.22);
    drawTile(ctx, b, S.mid, -520, 0, '#2a1a44');
    for (const s of S.midSigns) {
      eachCopy(s.x, 2400, b.x0, b.x1, 120, (x) => {
        ctx.globalCompositeOperation = 'lighter';
        drawGlow(ctx, s.rgb, x, s.y, 110, 0.18 * s.a, 2);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = (0.35 + 0.65 * s.a) * 0.8;
        drawSprite(ctx, s.s, x, s.y, 0.5);
        ctx.globalAlpha = 1;
      });
    }
    ctx.restore();
    // Near buildings, live windows and neon signs
    b = layer(ctx, cam, view, 0.42);
    drawInstances(ctx, b, S.near, 3800);
    for (const w of S.wins) {
      if (!w.on) continue;
      ctx.fillStyle = `rgba(${w.c},0.85)`;
      eachCopy(w.x, 3800, b.x0, b.x1, 10, (x) => ctx.fillRect(x, w.y, 8, 11));
    }
    const signScreen = (S.signScreen = S.signScreen || []);
    signScreen.length = 0;
    for (const s of S.signs) {
      eachCopy(s.x, 3800, b.x0, b.x1, 200, (x) => {
        ctx.globalCompositeOperation = 'lighter';
        drawGlow(ctx, s.rgb, x, s.y, 220, 0.32 * s.a, 2);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 0.35 + 0.65 * s.a;
        drawSprite(ctx, s.s, x, s.y);
        ctx.globalAlpha = 1;
        signScreen.push(x, s);
      });
    }
    ctx.restore();
    // Blinking beacons
    ctx.globalCompositeOperation = 'lighter';
    for (const be of S.beacons) {
      const on = mod(t + be.ph, 1.6) < 0.25;
      if (!on) continue;
      const [x, y, z] = layerToScreen(cam, view, be.p, be.x, be.y);
      if (x < -50 || x > view.w + 50) continue;
      drawGlow(ctx, '255,50,50', x, y, 22 * z, 0.9);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    // Rain (back)
    ctx.strokeStyle = 'rgba(170,185,255,0.26)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const p of S.rain) {
      if (!fieldPos(p, cam, view)) continue;
      const l = p.len * _fp[2];
      ctx.moveTo(_fp[0], _fp[1]);
      ctx.lineTo(_fp[0] - l * 0.08, _fp[1] + l);
    }
    ctx.stroke();
    // Rooftop props
    b = layer(ctx, cam, view, 0.8);
    drawInstances(ctx, b, S.props, 3600);
    eachCopy(1260, 3600, b.x0, b.x1, 200, (x) => {
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(ctx, '255,210,140', x, -168, 70, 0.55 + 0.05 * Math.sin(t * 13));
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    });
    ctx.restore();
    // Parapet + railing just behind the fighting line
    b = layer(ctx, cam, view, 0.95);
    ctx.fillStyle = '#1b1729';
    ctx.fillRect(b.x0 - 4, -30, b.x1 - b.x0 + 8, b.y1 + 34);
    ctx.fillStyle = 'rgba(255,90,200,0.25)';
    ctx.fillRect(b.x0 - 4, -31, b.x1 - b.x0 + 8, 2);
    ctx.strokeStyle = '#0f0c1a';
    ctx.lineWidth = 4;
    ctx.beginPath();
    eachCopy(0, 140, b.x0, b.x1, 4, (x) => { ctx.moveTo(x, -30); ctx.lineTo(x, -86); });
    ctx.moveTo(b.x0 - 4, -84); ctx.lineTo(b.x1 + 4, -84);
    ctx.moveTo(b.x0 - 4, -58); ctx.lineTo(b.x1 + 4, -58);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(120,200,255,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(b.x0 - 4, -86); ctx.lineTo(b.x1 + 4, -86);
    ctx.stroke();
    ctx.restore();

    // Wet rooftop floor with neon reflections
    const F = floorView(cam, view);
    if (F.gy < view.h) {
      floorBase(ctx, F, [[0, '#342a52'], [0.2, '#211a38'], [1, '#0b0914']]);
      // mirrored skyline on the wet surface
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, F.gy, view.w, view.h - F.gy);
      ctx.clip();
      for (const [p, a] of [[0.22, 0.3], [0.42, 0.24]]) {
        ctx.save();
        ctx.translate(0, F.gy);
        ctx.scale(1, -0.55);
        ctx.translate(0, -F.gy);
        const bb = layer(ctx, cam, view, p);
        ctx.globalAlpha = a;
        if (p < 0.3) drawTile(ctx, bb, S.mid, -520);
        else drawInstances(ctx, bb, S.near, 3800);
        ctx.restore();
        ctx.restore();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
      ctx.fillStyle = lin(ctx, 0, F.gy, 0, F.gy + 200 * F.z, [[0, 'rgba(22,18,38,0)'], [1, 'rgba(14,11,24,0.85)']]);
      ctx.fillRect(0, F.gy, view.w, view.h - F.gy);
      floorTexture(ctx, F, S.noise, 1);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      floorRays(ctx, F, 220, 40);
      for (const r of [38, 110, 220]) {
        if (r < F.rMax) { ctx.moveTo(0, fY(F, r)); ctx.lineTo(view.w, fY(F, r)); }
      }
      ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      // sky glow on the wet surface
      drawGlowE(ctx, '190,60,160', view.w / 2, F.gy, view.w * 0.7, 70 * F.z, 0.28, 2);
      // neon sign reflections (vertical streaks)
      for (let i = 0; i < signScreen.length; i += 2) {
        const s = signScreen[i + 1];
        const [sx, , sz] = layerToScreen(cam, view, 0.42, signScreen[i], 0);
        drawGlowE(ctx, s.rgb, sx, F.gy + 40 * F.z, 50 * sz, 190 * F.z, 0.4 * s.a, 1);
      }
      ctx.globalCompositeOperation = 'source-over';
      // puddles: darker, glossier patches
      ctx.globalAlpha = 1;
      floorCopies(F, 1800, 0, 1800, (du) => {
        for (const [u, r, hw, hd] of S.puddles) {
          if (r - hd > F.rMax) continue;
          const x = fX(F, u + du, r), y = fY(F, r);
          if (x < -400 || x > view.w + 400) continue;
          const sc = F.z * (1 + r / FLOOR_H);
          ctx.fillStyle = 'rgba(10,6,22,0.35)';
          ctx.beginPath();
          ctx.ellipse(x, y, hw * sc, hd * F.z, 0, 0, TAU);
          ctx.fill();
          ctx.strokeStyle = 'rgba(200,170,255,0.12)';
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.globalCompositeOperation = 'lighter';
          drawGlowE(ctx, '150,80,220', x, y, hw * sc * 0.9, hd * F.z * 0.9, 0.3, 2);
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
        }
      });
      // rain splashes / ripples
      ctx.strokeStyle = 'rgba(190,200,255,0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const s of S.splash) {
        if (s.r > F.rMax) continue;
        const x = fX(F, s.u, s.r), y = fY(F, s.r), k = s.t / 0.35;
        if (x < -20 || x > view.w + 20) continue;
        const rx = (2 + k * 10) * F.z;
        ctx.moveTo(x + rx, y);
        ctx.ellipse(x, y, rx, rx * 0.25, 0, 0, TAU);
      }
      ctx.stroke();
      ctx.fillStyle = 'rgba(120,200,255,0.35)';
      ctx.fillRect(0, F.gy - 0.5, view.w, 1.5);
    }
  },

  front(ctx, S, cam, view) {
    ctx.strokeStyle = 'rgba(200,212,255,0.38)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    for (const p of S.rainF) {
      if (!fieldPos(p, cam, view)) continue;
      const l = p.len * _fp[2];
      ctx.moveTo(_fp[0], _fp[1]);
      ctx.lineTo(_fp[0] - l * 0.08, _fp[1] + l);
    }
    ctx.stroke();
    screenGrad(ctx, view, [[0, 'rgba(20,10,60,0.15)'], [0.6, 'rgba(20,10,60,0)'], [1, 'rgba(60,0,60,0.18)']]);
    vignette(ctx, view, '5,0,20', 0.6);
  },

  impact(S, x, y, p) {
    const n = S.n(Math.round(2 + p * 3));
    for (let i = 0; i < n; i++) {
      addDebris(S, { k: 'ring', c: 'rgba(170,200,255,0.9)', x: x + S.rng.range(-60, 60), y: S.rng.range(4, 30), life: S.rng.range(0.6, 1.1), s: 70 + p * 90, a: 0.6 });
    }
    burst(S, S.n(Math.round(8 + p * 16)), (R) => ({
      k: 'spark', c: 'rgba(170,210,255,0.8)', x: x + R.range(-30, 30), y: R.range(-4, 4), vx: R.range(-260, 260), vy: -R.range(150, 420) * (0.5 + p),
      g: 1400, life: R.range(0.3, 0.6), s: 1.5, a: 0.8, fy: R.range(0, 30), bounce: 0,
    }));
    burst(S, S.n(Math.round(2 + p * 5)), (R) => ({
      k: 'puff', rgb: '140,130,190', x: x + R.range(-40, 40), y: -R.range(0, 10), vx: R.range(-60, 60), vy: -R.range(10, 40),
      drag: 3, life: R.range(0.5, 0.9), s: R.range(14, 24), grow: 40, a: 0.3,
    }));
    for (const s of S.signs) if (S.rng() < p * 0.6) s.flick = S.rng.range(0.15, 0.5);
  },
};

// ═════════════════════════════════════════════════════════════════════════
// 3. Caldera Forge
// ═════════════════════════════════════════════════════════════════════════

const VOLC_SKY = [[0, '#0a0405'], [0.35, '#1e0808'], [0.6, '#3d0f0a'], [0.8, '#76210e'], [0.92, '#b33e1a'], [1, '#de6428']];

// Cluster of hexagonal basalt columns, lit from below by lava.
function basaltCluster(res, R, w, h) {
  return makeSprite(w, h + 20, w / 2, h + 10, res, (g) => {
    const cols = [];
    let x = -w / 2 + 10, prev = R.range(0.3, 0.6);
    while (x < w / 2 - 10) {
      const cw = R.range(22, 40);
      const env = 1 - Math.pow(Math.abs(x + cw / 2) / (w / 2), 2) * 0.6;
      prev = clamp(prev + R.range(-0.28, 0.28), 0.18, 1);
      cols.push([x, cw, h * prev * env, R.range(-0.06, 0.06)]);
      x += cw - 1;
    }
    cols.sort((a, b) => a[2] - b[2]);
    for (const [cx, cw, ch, tilt] of cols) {
      const top = -ch, dx = tilt * ch;
      g.fillStyle = lin(g, 0, top, 0, 0, [[0, '#1d100d'], [0.6, '#160a08'], [1, '#4a190c']]);
      g.beginPath();
      g.moveTo(cx, 10); g.lineTo(cx + dx, top); g.lineTo(cx + cw + dx, top); g.lineTo(cx + cw, 10);
      g.fill();
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.beginPath();
      g.moveTo(cx + cw * 0.62, 10); g.lineTo(cx + cw * 0.62 + dx, top); g.lineTo(cx + cw + dx, top); g.lineTo(cx + cw, 10);
      g.fill();
      g.fillStyle = 'rgba(255,120,50,0.18)';
      g.fillRect(cx, top + 6, 1.5, ch);
      g.fillStyle = '#2d1a16';
      g.beginPath();
      g.moveTo(cx + dx, top); g.lineTo(cx + dx + cw * 0.25, top - 6); g.lineTo(cx + dx + cw * 0.75, top - 6); g.lineTo(cx + dx + cw, top);
      g.lineTo(cx + dx + cw * 0.75, top + 4); g.lineTo(cx + dx + cw * 0.25, top + 4); g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(255,130,60,0.3)';
      g.lineWidth = 1;
      g.stroke();
      g.strokeStyle = 'rgba(0,0,0,0.4)';
      g.beginPath();
      for (let y = top + 24 + R() * 30; y < -6; y += R.range(28, 70)) { g.moveTo(cx + dx * (1 - (y - top) / ch), y); g.lineTo(cx + cw + dx * (1 - (y - top) / ch), y + R.range(-3, 3)); }
      g.stroke();
    }
  });
}

IMPL.volcano = {
  build(S) {
    const R = S.rng, res = S.res;
    // Smoke banks: unions of puffs filled with one vertical gradient (lit from below)
    S.smoke = makeTileT(2400, 460, res * 0.25, (g, w) => {
      for (let i = 0; i < 16; i++) {
        const cx = R() * w, cy = R.range(90, 360), span = R.range(260, 760);
        const lit = cy / 460;
        g.fillStyle = lin(g, 0, cy - 140, 0, cy + 50, [[0, rgba('#170909', 0.0)], [0.35, rgba('#1d0b0a', 0.85)], [0.8, rgba(mix('#3a120c', '#7a2a12', lit), 0.9)], [1, rgba('#a0381a', 0.6)]]);
        g.beginPath();
        const n = Math.floor(span / 50);
        for (let k = 0; k < n; k++) {
          const px = cx - span / 2 + (k / n) * span + R.range(-20, 20);
          const env = Math.sin((k / n) * Math.PI);
          const r = R.range(30, 60) + env * 50;
          const py = cy - env * 40 - R.range(0, 30);
          if (py + r > 450) continue;
          wrap(w, px, (xx) => { g.moveTo(xx + r, py); g.arc(xx, py, r, 0, TAU); });
        }
        g.fill();
      }
    });
    S.ridge = makeTile(2400, 320, res * 0.5, (g, w, h) => {
      const f = pfbm(R, [[7, 55], [19, 25], [53, 10], [140, 4]]);
      const y = (x) => h - (130 + f(x / w) + Math.abs(f(x / w + 0.37)) * 0.8);
      g.beginPath();
      g.moveTo(-8, h);
      for (let x = -8; x <= w + 8; x += 3) g.lineTo(x, y(x));
      g.lineTo(w + 8, h);
      g.closePath();
      g.fillStyle = lin(g, 0, h - 240, 0, h, [[0, '#2a0e0c'], [0.6, '#3a120c'], [1, '#6a2412']]);
      g.fill();
    });
    S.cliffs = makeTile(2400, 520, res * 0.5, (g, w, h) => {
      const spires = S.spires = [];
      for (let i = 0; i < 8; i++) spires.push([(i + R.range(0.1, 0.9)) * (w / 8), R.range(150, 400), R.range(60, 150)]);
      const f = pfbm(R, [[11, 30], [37, 12], [120, 5]]);
      const jag = pfbm(R, [[90, 14], [260, 6]]);
      const ht = (x) => {
        let v = 60 + f(x / w);
        for (const [sx, sh, sw] of spires) {
          const d = mod(x - sx + w / 2, w) - w / 2, ad = Math.abs(d);
          const lean = d < 0 ? 1 : 0.8;
          if (ad < sw) v = Math.max(v, sh * Math.pow(1 - ad / sw, 0.55 * lean) + jag(x / w) * (1 - ad / sw));
        }
        return v;
      };
      S.cliffHt = ht;
      g.beginPath();
      g.moveTo(-8, h);
      for (let x = -8; x <= w + 8; x += 3) g.lineTo(x, h - ht(x));
      g.lineTo(w + 8, h);
      g.closePath();
      g.fillStyle = lin(g, 0, h - 420, 0, h, [[0, '#130807'], [0.65, '#1c0a08'], [1, '#5e1d0c']]);
      g.fill();
      g.save();
      g.clip();
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.lineWidth = 2;
      g.beginPath();
      for (let i = 0; i < 160; i++) {
        const x = R() * w, y = h - R() * 380;
        g.moveTo(x, y); g.lineTo(x + R.range(-6, 6), y + R.range(20, 60));
      }
      g.stroke();
      g.restore();
    });
    S.cols = [
      { s: basaltCluster(res * 0.6, R, 300, 300), x: -980 },
      { s: basaltCluster(res * 0.6, R, 240, 220), x: 900 },
      { s: basaltCluster(res * 0.6, R, 340, 360), x: 1950 },
    ];
    // Lava crust pattern that slides along the river
    S.crust = makeTileT(1200, 40, res * 0.5, (g, w) => {
      for (let i = 0; i < 34; i++) {
        const x = R() * w, y = R.range(6, 34), rw = R.range(20, 70), rh = R.range(1.5, 4);
        wrap(w, x, (xx) => {
          g.fillStyle = `rgba(110,26,8,${R.range(0.35, 0.6)})`;
          g.beginPath(); g.ellipse(xx, y, rw, rh, 0, 0, TAU); g.fill();
        });
      }
    });
    S.rock = makeTileT(1400, 250, res * 0.5, (g, w, h) => {
      for (let i = 0; i < 900; i++) {
        const x = R() * w, y = R() * h, s = R.range(2, 10);
        g.fillStyle = R() < 0.6 ? `rgba(0,0,0,${R.range(0.15, 0.4)})` : `rgba(140,70,50,${R.range(0.05, 0.12)})`;
        wrap(w, x, (xx) => {
          g.beginPath();
          g.moveTo(xx, y); g.lineTo(xx + s, y + s * 0.2); g.lineTo(xx + s * 0.6, y + s * 0.5); g.closePath();
          g.fill();
        });
      }
    });
    // Glowing floor cracks (floor coords, period 2000), three pulse groups
    S.cracks = [[], [], []];
    for (let i = 0; i < 22; i++) {
      let u = R() * 2000, r = R.range(22, 230);
      const pts = [u, r];
      const n = R.int(5, 10), dir = R() < 0.5 ? -1 : 1;
      for (let k = 0; k < n; k++) {
        u += dir * R.range(10, 34);
        r += R.range(-10, 10) * (0.6 + r / 120);
        r = Math.max(3, r);
        pts.push(u, r);
        if (R() < 0.3) {
          const br = [u, r];
          let bu = u, bv = r;
          for (let j = 0; j < R.int(2, 3); j++) { bu += R.range(-20, 20); bv += R.range(6, 16) * (R() < 0.5 ? -1 : 1); br.push(bu, Math.max(2, bv)); }
          S.cracks[(i + 1) % 3].push(br);
        }
      }
      S.cracks[i % 3].push(pts);
    }
    S.embers = makeField(S.frng, S.n(80), (p, r) => { p.d = r.range(0.3, 0.9); p.s = r.range(2, 4.5) * (0.6 + p.d); p.vx = r.range(-10, 20); p.vy = -r.range(40, 100); p.tw = r.range(3, 8); });
    S.embersF = makeField(S.frng, S.n(16), (p, r) => { p.d = r.range(1.2, 1.5); p.s = r.range(5, 9); p.vx = r.range(-10, 30); p.vy = -r.range(80, 150); p.tw = r.range(3, 8); });
    S.ash = makeField(S.frng, S.n(40), (p, r) => { p.d = r.range(0.4, 1); p.s = r.range(1, 2.2); p.vx = r.range(10, 30); p.vy = r.range(15, 35); });
    S.shimmer = Array.from({ length: S.hi ? 7 : 3 }, () => ({ x: S.frng.range(-900, 900), y: S.frng.range(-300, 0), s: S.frng.range(140, 260), sp: S.frng.range(18, 35) }));
    S.vparts = [];
    S.eruptT = 2;
    S.erupt = 0;
    S.flare = 0;
    // Lava falls spill from notches just below two spire tops
    S.falls = [];
    for (const i of [1, 5]) {
      const [sx, sh, sw] = S.spires[i];
      const fx = sx + sw * 0.22;
      S.falls.push([fx, -S.cliffHt(fx) * 0.92]);
    }
  },

  update(S, dt) {
    const R = S.rng, t = S.t;
    stepField(S.embers, dt, t, 25, 1.7);
    stepField(S.embersF, dt, t, 30, 1.3);
    stepField(S.ash, dt, t, 10, 0.9);
    for (const h of S.shimmer) {
      h.y -= h.sp * dt;
      if (h.y < -420) { h.y = 20; h.x = R.range(-1000, 1000); }
    }
    S.flare = Math.max(0, S.flare - dt * 1.2);
    S.erupt = Math.max(0, S.erupt - dt * 0.7);
    S.eruptT -= dt;
    const vp = S.vparts;
    if (S.eruptT <= 0) {
      S.eruptT = R.range(5, 9);
      S.erupt = 1;
      const n = S.hi ? 22 : 11;
      for (let i = 0; i < n; i++) vp.push({ k: 0, x: 320 + R.range(-30, 30), y: -470, vx: R.range(-170, 170), vy: -R.range(220, 460), life: R.range(1.6, 2.6), m: 0 });
    }
    if (R() < dt * (S.hi ? 7 : 3.5)) vp.push({ k: 1, x: 320 + R.range(-30, 30), y: -480, vx: R.range(5, 25), vy: -R.range(25, 45), life: R.range(5, 8), m: 0, s: R.range(30, 50) });
    for (let i = vp.length - 1; i >= 0; i--) {
      const p = vp[i];
      p.life -= dt;
      p.m += dt;
      if (p.life <= 0) { vp[i] = vp[vp.length - 1]; vp.pop(); continue; }
      if (p.k === 0) p.vy += 320 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.k === 1) p.s += dt * 14;
    }
  },

  back(ctx, S, cam, view) {
    const t = S.t;
    drawSky(ctx, cam, view, VOLC_SKY, -780, 0);
    let b = layer(ctx, cam, view, 0.04);
    ctx.globalCompositeOperation = 'lighter';
    drawGlowE(ctx, '255,90,30', 320, -60, 1500, 360, 0.3 + 0.1 * S.erupt, 2);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.restore();
    b = layer(ctx, cam, view, 0.05);
    drawTile(ctx, b, S.smoke, -800, t * 4);
    ctx.restore();

    // Distant volcano (live vector) with plume, lava streams and bombs
    b = layer(ctx, cam, view, 0.08);
    const vx = 320, top = -470;
    for (const p of S.vparts) {
      if (p.k !== 1) continue;
      const a = Math.min(1, p.m * 0.8) * Math.min(1, p.life * 0.4) * 0.7;
      drawGlow(ctx, '40,16,14', p.x, p.y, p.s, a, 1);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = lin(ctx, 0, top, 0, 0, [[0, '#251010'], [0.5, '#1d0b0a'], [1, '#4a160c']]);
    ctx.beginPath();
    ctx.moveTo(vx - 900, 0);
    ctx.quadraticCurveTo(vx - 420, -120, vx - 140, -380);
    ctx.lineTo(vx - 70, top + 4); ctx.lineTo(vx - 30, top + 14); ctx.lineTo(vx + 20, top + 10); ctx.lineTo(vx + 70, top);
    ctx.lineTo(vx + 150, -370);
    ctx.quadraticCurveTo(vx + 440, -110, vx + 950, 0);
    ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    const pulse = 0.75 + 0.25 * Math.sin(t * 2.2) + S.erupt * 0.6;
    drawGlowE(ctx, '255,120,40', vx, top + 6, 150, 60, 0.6 * pulse);
    ctx.lineCap = 'round';
    for (const [lw, col] of [[7, `rgba(255,80,20,${0.3 * pulse})`], [2.2, `rgba(255,190,90,${0.8 * pulse})`]]) {
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(vx - 40, top + 12); ctx.quadraticCurveTo(vx - 90, -330, vx - 160, -230); ctx.quadraticCurveTo(vx - 210, -150, vx - 250, -90);
      ctx.moveTo(vx + 30, top + 12); ctx.quadraticCurveTo(vx + 70, -360, vx + 120, -280); ctx.quadraticCurveTo(vx + 170, -190, vx + 230, -130);
      ctx.moveTo(vx - 5, top + 14); ctx.quadraticCurveTo(vx + 10, -380, vx - 20, -320);
      ctx.stroke();
    }
    for (const p of S.vparts) {
      if (p.k !== 0) continue;
      drawGlow(ctx, '255,140,50', p.x, p.y, 16, Math.min(1, p.life), 0);
      drawGlow(ctx, '255,230,160', p.x, p.y, 5, Math.min(1, p.life), 0);
    }
    if (S.erupt > 0) drawGlow(ctx, '255,170,80', vx, top, 260 * S.erupt + 60, S.erupt * 0.8);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.restore();

    b = layer(ctx, cam, view, 0.14);
    drawTile(ctx, b, S.ridge, -320, 0, '#6a2412');
    ctx.restore();
    b = layer(ctx, cam, view, 0.28);
    drawTile(ctx, b, S.cliffs, -520, 0, '#5e1d0c');
    // lava falls down the cliff faces
    ctx.globalCompositeOperation = 'lighter';
    for (const [fx, fy] of S.falls) {
      eachCopy(fx, 2400, b.x0, b.x1, 120, (x) => {
        drawGlowE(ctx, '255,90,25', x, fy * 0.45, 70, -fy * 0.65, 0.4, 1);
        drawGlowE(ctx, '255,120,40', x, -6, 90, 26, 0.5, 1);
        ctx.fillStyle = lin(ctx, 0, fy, 0, 0, [[0, 'rgba(255,210,110,0.95)'], [0.5, 'rgba(255,130,40,0.85)'], [1, 'rgba(230,70,20,0.8)']]);
        ctx.beginPath();
        ctx.moveTo(x - 4, fy);
        for (let k = 1; k <= 8; k++) { const yy = fy * (1 - k / 8); ctx.lineTo(x - 4 - k * 1.6 + Math.sin(k * 1.7 + t * 3) * 2, yy); }
        for (let k = 8; k >= 0; k--) { const yy = fy * (1 - k / 8); ctx.lineTo(x + 4 + k * 1.4 + Math.sin(k * 2.3 + t * 2.6) * 2, yy); }
        ctx.fill();
        ctx.fillStyle = 'rgba(255,245,200,0.5)';
        for (let k = 0; k < 5; k++) {
          const yy = fy + mod(t * 140 + k * (-fy / 5), -fy);
          const wv = 2 + (yy - fy) / -fy * 6;
          ctx.fillRect(x - wv * 0.5 + Math.sin(yy * 0.05) * 2, yy, wv, 10);
        }
      });
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();

    // Lava river
    b = layer(ctx, cam, view, 0.42);
    const w0 = b.x0 - 4, ww = b.x1 - b.x0 + 8;
    ctx.globalCompositeOperation = 'lighter';
    drawGlowE(ctx, '255,100,30', cam.x * 0.42, -20, ww * 0.8, 90, 0.4 + 0.08 * Math.sin(t * 1.7), 2);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = lin(ctx, 0, -34, 0, 0, [[0, '#9a2a0c'], [0.3, '#f07a26'], [0.55, '#ffc35c'], [0.8, '#f08a30'], [1, '#b8380f']]);
    ctx.fillRect(w0, -34, ww, 36);
    ctx.save();
    ctx.translate(0, -36);
    drawTile(ctx, { x0: b.x0, x1: b.x1 }, S.crust, 0, t * 26);
    ctx.globalAlpha = 0.5;
    drawTile(ctx, { x0: b.x0, x1: b.x1 }, S.crust, 2, -t * 14 + 400);
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#1a0907';
    ctx.fillRect(w0, 0, ww, b.y1 + 4);
    ctx.restore();

    b = layer(ctx, cam, view, 0.66);
    drawInstances(ctx, b, S.cols, 3200);
    ctx.restore();

    // Heat shimmer bands + embers + ash behind the fighters
    b = layer(ctx, cam, view, 0.9);
    ctx.globalCompositeOperation = 'lighter';
    for (const h of S.shimmer) {
      eachCopy(h.x, 2400, b.x0, b.x1, h.s, (x) => drawGlowE(ctx, '255,110,40', x + Math.sin(t * 1.3 + h.s) * 30, h.y, h.s * 1.8, h.s * 0.25, 0.06, 2));
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.restore();
    drawDotField(ctx, S.ash, cam, view, '#6b5752', 0.55);
    drawGlowField(ctx, S.embers, cam, view, '255,130,40', t, 1, 0.9);

    // Floor: basalt with pulsing lava cracks
    const F = floorView(cam, view);
    if (F.gy < view.h) {
      floorBase(ctx, F, [[0, '#4a2014'], [0.1, '#2a120c'], [0.5, '#170a07'], [1, '#0a0504']]);
      floorTexture(ctx, F, S.rock, 1);
      ctx.globalCompositeOperation = 'lighter';
      drawGlowE(ctx, '255,110,40', view.w / 2, F.gy, view.w * 0.75, 40 * F.z, 0.32, 2);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let gi = 0; gi < 3; gi++) {
        const pulse = clamp(0.55 + 0.45 * Math.sin(t * 1.6 + gi * 2.1) + S.flare * 0.8, 0, 1.6);
        ctx.beginPath();
        floorCopies(F, 2000, 0, 2200, (du) => { for (const pts of S.cracks[gi]) if (pts[1] < F.rMax + 20) floorLine(ctx, F, pts, du); });
        ctx.strokeStyle = `rgba(255,70,15,${0.16 * pulse})`;
        ctx.lineWidth = 12 * F.z;
        ctx.stroke();
        ctx.strokeStyle = `rgba(255,110,30,${0.35 * pulse})`;
        ctx.lineWidth = 4 * F.z;
        ctx.stroke();
        ctx.strokeStyle = `rgba(255,210,120,${Math.min(1, 0.8 * pulse)})`;
        ctx.lineWidth = 1.4 * F.z;
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(255,150,80,0.45)';
      ctx.fillRect(0, F.gy - 0.5, view.w, 1.5);
    }
  },

  front(ctx, S, cam, view) {
    drawGlowField(ctx, S.embersF, cam, view, '255,150,60', S.t, 1, 0.8);
    screenGrad(ctx, view, [[0, 'rgba(30,0,0,0.25)'], [0.5, 'rgba(60,10,0,0)'], [1, 'rgba(120,30,0,0.12)']]);
    vignette(ctx, view, '20,0,0', 0.6);
  },

  impact(S, x, y, p) {
    S.flare = Math.min(1.5, S.flare + p);
    burst(S, S.n(Math.round(10 + p * 20)), (R) => ({
      k: 'glow', rgb: '255,140,50', x: x + R.range(-40, 40), y: y + R.range(-20, 10), vx: R.range(-200, 200), vy: -R.range(100, 380),
      g: 200, drag: 1.2, life: R.range(0.8, 1.8), s: R.range(5, 10), a: 1, front: R() < 0.35,
    }));
    burst(S, S.n(Math.round(5 + p * 8)), (R) => ({
      k: 'chip', c: R.pick(['#2a1410', '#3b1d16', '#1a0c0a']), x: x + R.range(-30, 30), y: R.range(-10, 0), vx: R.range(-220, 220), vy: -R.range(120, 360) * (0.6 + p),
      g: 1200, life: R.range(0.8, 1.4), s: R.range(3, 7), rot: R() * TAU, vr: R.range(-12, 12), fy: R.range(0, 40), bounce: 0.35,
    }));
    burst(S, S.n(Math.round(3 + p * 5)), (R) => ({
      k: 'puff', rgb: '70,40,36', x: x + R.range(-50, 50), y: -R.range(0, 20), vx: R.range(-80, 80), vy: -R.range(10, 50), drag: 2.5,
      life: R.range(0.8, 1.4), s: R.range(18, 34), grow: 40, a: 0.5,
    }));
    addDebris(S, { k: 'flash', rgb: '255,120,40', x, y: 4, life: 0.5, s: 140 + p * 120, a: 0.6 });
  },
};

// ═════════════════════════════════════════════════════════════════════════
// 4. Frozen Peak
// ═════════════════════════════════════════════════════════════════════════

const GLAC_SKY = [[0, '#02040c'], [0.3, '#06102a'], [0.55, '#0b2142'], [0.75, '#143657'], [0.9, '#1f5470'], [1, '#2d7486']];

// One stylised peak with a lit face, a shadowed face and a jagged snow cap.
// Randomness is pre-drawn so wrapped copies are identical.
function snowPeak(g, R, w, h, px, ph, hw, pal) {
  const L = [], Rr = [], ridge = [], snow = [];
  const N = 9;
  for (let i = 1; i < N; i++) {
    L.push([-hw * (i / N) + R.range(-6, 6), ph * (1 - i / N) + R.range(-8, 8)]);
    Rr.push([hw * (i / N) + R.range(-6, 6), ph * (1 - i / N) + R.range(-8, 8)]);
  }
  for (let i = 1; i <= 6; i++) ridge.push([hw * 0.12 * (i / 6) + R.range(-10, 10), ph * (1 - i / 6)]);
  const snowLine = ph * R.range(0.55, 0.7);
  for (let i = 0; i <= 10; i++) snow.push([-hw * (1 - snowLine / ph) + (i / 10) * 2 * hw * (1 - snowLine / ph), snowLine + (i % 2 ? R.range(-24, -4) : R.range(4, 18))]);
  wrap(w, px, (x) => {
    const Y = (v) => h - v;
    const shape = () => {
      g.beginPath();
      g.moveTo(x - hw, h + 2);
      for (let i = L.length - 1; i >= 0; i--) g.lineTo(x + L[i][0], Y(L[i][1]));
      g.lineTo(x, Y(ph));
      for (const [dx, v] of Rr) g.lineTo(x + dx, Y(v));
      g.lineTo(x + hw, h + 2);
      g.closePath();
    };
    shape();
    g.fillStyle = lin(g, 0, Y(ph), 0, h, [[0, pal.lit], [1, pal.haze]]);
    g.fill();
    g.save();
    shape();
    g.clip();
    g.fillStyle = lin(g, 0, Y(ph), 0, h, [[0, pal.shadow], [1, pal.haze]]);
    g.beginPath();
    g.moveTo(x, Y(ph));
    for (const [dx, v] of ridge) g.lineTo(x + dx, Y(v));
    g.lineTo(x + hw + 10, h + 2);
    g.lineTo(x + hw + 10, Y(ph) - 10);
    g.fill();
    // snow cap
    g.beginPath();
    g.moveTo(x, Y(ph) - 20);
    g.lineTo(x - hw, Y(ph) - 20);
    for (const [dx, v] of snow) g.lineTo(x + dx, Y(v));
    g.lineTo(x + hw, Y(ph) - 20);
    g.closePath();
    g.fillStyle = pal.snowLit;
    g.fill();
    g.beginPath();
    g.moveTo(x, Y(ph));
    for (const [dx, v] of ridge) g.lineTo(x + dx, Y(v));
    g.lineTo(x + hw + 10, h + 2);
    g.lineTo(x + hw + 10, Y(ph) - 10);
    g.clip();
    g.beginPath();
    g.moveTo(x - hw, Y(ph) - 20);
    for (const [dx, v] of snow) g.lineTo(x + dx, Y(v));
    g.lineTo(x + hw, Y(ph) - 20);
    g.closePath();
    g.fillStyle = pal.snowShadow;
    g.fill();
    g.restore();
  });
}

function snowPine(g, x, by, h, dark, snowC) {
  const tiers = 4;
  for (let i = 0; i < tiers; i++) {
    const t0 = i / tiers;
    const yb = by - h * 0.15 - t0 * h * 0.7, wb = h * 0.3 * (1 - t0 * 0.7);
    g.fillStyle = dark;
    g.beginPath();
    g.moveTo(x - wb, yb); g.lineTo(x, yb - h * 0.38); g.lineTo(x + wb, yb);
    g.fill();
    g.fillStyle = snowC;
    g.beginPath();
    g.moveTo(x - wb * 0.85, yb - 2); g.lineTo(x, yb - h * 0.38); g.lineTo(x + wb * 0.3, yb - h * 0.22); g.lineTo(x - wb * 0.2, yb - h * 0.12);
    g.fill();
  }
  g.fillStyle = dark;
  g.fillRect(x - h * 0.03, by - h * 0.16, h * 0.06, h * 0.16);
}

function auroraSprite(top, mid) {
  const c = createCanvas(4, 256);
  if (!c) return null;
  const g = c.getContext('2d');
  g.fillStyle = lin(g, 0, 0, 0, 256, [[0, 'rgba(0,0,0,0)'], [0.35, top], [0.82, mid], [0.9, 'rgba(200,255,230,0.9)'], [1, 'rgba(120,255,200,0)']]);
  g.fillRect(0, 0, 4, 256);
  return c;
}

IMPL.glacier = {
  build(S) {
    const R = S.rng, res = S.res;
    S.stars = makeTileT(2400, 780, res * 0.5, (g, w, h) => {
      for (let i = 0; i < 30; i++) {
        const x = (i / 30) * w, y = h * 0.25 + Math.sin((i / 30) * TAU) * 120;
        wrap(w, x, (xx) => {
          g.fillStyle = rad(g, xx, y, 0, 160, [[0, 'rgba(120,160,220,0.08)'], [1, 'rgba(120,160,220,0)']]);
          g.fillRect(xx - 160, y - 160, 320, 320);
        });
      }
      for (let i = 0; i < 700; i++) {
        const x = R() * w, y = Math.pow(R(), 1.4) * h * 0.85, s = R() < 0.92 ? R.range(0.6, 1.3) : R.range(1.5, 2.2);
        g.fillStyle = `rgba(${R.pick(['255,255,255', '200,220,255', '255,240,220'])},${R.range(0.3, 0.95)})`;
        wrap(w, x, (xx) => { g.beginPath(); g.arc(xx, y, s, 0, TAU); g.fill(); });
      }
    });
    S.tw = Array.from({ length: S.n(40) }, () => ({ x: S.frng.range(-1200, 1200), y: S.frng.range(-760, -300), s: S.frng.range(1.2, 2.4), ph: S.frng() * TAU, f: S.frng.range(1, 3) }));
    S.aur = [auroraSprite('rgba(120,90,255,0.25)', 'rgba(60,255,160,0.55)'), auroraSprite('rgba(255,90,200,0.2)', 'rgba(60,240,200,0.45)')];
    S.ribbons = [
      { y: -440, amp: 70, h: 260, f1: 0.0021, f2: 0.0053, s1: 0.13, s2: 0.21, a: 0.6, spr: 0, x0: -1300, x1: 800 },
      { y: -380, amp: 50, h: 190, f1: 0.0027, f2: 0.0071, s1: -0.17, s2: 0.11, a: 0.5, spr: 1, x0: -300, x1: 1400 },
      { y: -560, amp: 40, h: 160, f1: 0.0016, f2: 0.0049, s1: 0.09, s2: -0.15, a: 0.35, spr: 0, x0: -1400, x1: 1400 },
    ];
    const far = { lit: '#9cb6d2', shadow: '#55729a', snowLit: '#e6f0fa', snowShadow: '#9fb4d4', haze: '#2f6f86' };
    S.mtnFar = makeTile(2400, 460, res * 0.5, (g, w, h) => {
      const pk = [];
      for (let i = 0; i < 9; i++) pk.push([(i + R()) * (w / 9), R.range(200, 430), R.range(220, 360)]);
      pk.sort((a, b) => b[1] - a[1]);
      for (const [x, ph, hw] of pk) snowPeak(g, R, w, h, x, ph, hw, far);
    });
    const mid = { lit: '#5d7fa6', shadow: '#2c4769', snowLit: '#cfe0f0', snowShadow: '#7b95ba', haze: '#21506a' };
    S.mtnMid = makeTile(2400, 380, res * 0.5, (g, w, h) => {
      const pk = [];
      for (let i = 0; i < 8; i++) pk.push([(i + R()) * (w / 8), R.range(140, 330), R.range(170, 280)]);
      pk.sort((a, b) => b[1] - a[1]);
      for (const [x, ph, hw] of pk) snowPeak(g, R, w, h, x, ph, hw, mid);
    });
    S.ridge = makeTile(2400, 320, res * 0.5, (g, w, h) => {
      const f = pfbm(R, [[5, 40], [14, 18], [50, 5]]);
      const y = (x) => h - (90 + f(x / w));
      g.beginPath();
      g.moveTo(-8, h);
      for (let x = -8; x <= w + 8; x += 4) g.lineTo(x, y(x));
      g.lineTo(w + 8, h);
      g.closePath();
      g.fillStyle = lin(g, 0, h - 150, 0, h, [[0, '#cfe1ef'], [0.25, '#8eabc8'], [1, '#2a4d6a']]);
      g.fill();
      for (let i = 0; i < 42; i++) {
        const x = R() * w, th = R.range(50, 130);
        wrap(w, x, (xx) => snowPine(g, xx, y(x) + 10, th, '#1c3450', '#d6e6f2'));
      }
    });
    S.crystals = [];
    for (const [x, sc] of [[-860, 1], [940, 0.85], [1900, 1.1]]) {
      S.crystals.push({
        x, sc,
        s: makeSprite(300, 420, 150, 420, res * 0.6, (g) => {
          const n = R.int(5, 8);
          for (let i = 0; i < n; i++) {
            const bx = R.range(-110, 110), bw = R.range(18, 40), bh = R.range(120, 400) * (1 - Math.abs(bx) / 200), lean = R.range(-0.35, 0.35);
            const tx = bx + lean * bh;
            g.fillStyle = lin(g, bx - bw, 0, bx + bw, 0, [[0, 'rgba(190,235,255,0.85)'], [0.5, 'rgba(110,180,225,0.75)'], [1, 'rgba(50,100,160,0.85)']]);
            g.beginPath();
            g.moveTo(bx - bw, 0); g.lineTo(tx - bw * 0.6, -bh * 0.85); g.lineTo(tx, -bh); g.lineTo(tx + bw * 0.6, -bh * 0.85); g.lineTo(bx + bw, 0);
            g.fill();
            g.strokeStyle = 'rgba(235,250,255,0.8)';
            g.lineWidth = 1.5;
            g.beginPath(); g.moveTo(bx - bw, 0); g.lineTo(tx - bw * 0.6, -bh * 0.85); g.lineTo(tx, -bh); g.stroke();
            g.strokeStyle = 'rgba(255,255,255,0.35)';
            g.beginPath(); g.moveTo(tx, -bh); g.lineTo(bx + bw * 0.1, 0); g.stroke();
          }
          g.fillStyle = lin(g, 0, -40, 0, 0, [[0, 'rgba(230,242,252,0)'], [0.5, '#dfecf7'], [1, '#c3d8ea']]);
          g.beginPath(); g.ellipse(0, 0, 150, 40, 0, Math.PI, TAU); g.fill();
        }),
      });
    }
    S.ice = makeTileT(1600, 250, res * 0.5, (g, w, h) => {
      for (let i = 0; i < 26; i++) {
        let x = R() * w, y = R() * h;
        g.strokeStyle = `rgba(235,248,255,${R.range(0.15, 0.4)})`;
        g.lineWidth = R.range(0.6, 1.4);
        const pts = [[x, y]];
        for (let k = 0; k < R.int(3, 7); k++) { x += R.range(-50, 50); y += R.range(-10, 10); pts.push([x, y]); }
        wrap(w, 0, (o) => {
          g.beginPath();
          pts.forEach(([px, py], k) => (k ? g.lineTo(px + o, py) : g.moveTo(px + o, py)));
          g.stroke();
        });
      }
      for (let i = 0; i < 40; i++) {
        const x = R() * w, y = R() * h, rw = R.range(30, 120);
        wrap(w, x, (xx) => {
          g.fillStyle = rad(g, xx, y, 0, rw, [[0, 'rgba(240,250,255,0.18)'], [1, 'rgba(240,250,255,0)']]);
          g.fillRect(xx - rw, y - rw, rw * 2, rw * 2);
        });
      }
    });
    S.snow = makeField(S.frng, S.n(120), (p, r) => { p.d = r.range(0.3, 0.85); p.s = r.range(0.8, 2.2) * (0.6 + p.d * 0.6); p.vx = r.range(20, 50); p.vy = r.range(30, 70); });
    S.snowF = makeField(S.frng, S.n(30), (p, r) => { p.d = r.range(1.2, 1.6); p.s = r.range(3, 5.5); p.vx = r.range(40, 80); p.vy = r.range(70, 120); });
    S.glints = Array.from({ length: S.n(22) }, () => ({ u: S.frng.range(-1300, 1300), r: S.frng.range(4, 200), ph: S.frng() * TAU, f: S.frng.range(0.6, 1.6) }));
    S.gust = 0;
  },

  update(S, dt) {
    const t = S.t;
    const gust = 1 + 0.8 * Math.max(0, Math.sin(t * 0.23)) ** 3;
    S.gust = gust;
    stepField(S.snow, dt * gust, t, 18, 0.8);
    stepField(S.snowF, dt * gust, t, 25, 0.6);
  },

  back(ctx, S, cam, view) {
    const t = S.t;
    drawSky(ctx, cam, view, GLAC_SKY, -780, 0);
    let b = layer(ctx, cam, view, 0.02);
    drawTile(ctx, b, S.stars, -780);
    ctx.fillStyle = '#ffffff';
    for (const s of S.tw) {
      eachCopy(s.x, 2400, b.x0, b.x1, 4, (x) => {
        ctx.globalAlpha = 0.25 + 0.75 * Math.max(0, Math.sin(t * s.f + s.ph));
        ctx.fillRect(x - s.s / 2, s.y - s.s / 2, s.s, s.s);
      });
    }
    ctx.globalAlpha = 1;
    // crescent moon
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(ctx, '150,190,255', -400, -500, 150, 0.4);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.beginPath();
    ctx.rect(-460, -560, 120, 120);
    ctx.arc(-388, -509, 27, 0, TAU);
    ctx.clip('evenodd');
    ctx.fillStyle = '#eef4ff';
    ctx.beginPath();
    ctx.arc(-400, -500, 30, 0, TAU);
    ctx.fill();
    ctx.restore();
    ctx.restore();

    // Aurora ribbons (vertical gradient strips along animated curves)
    b = layer(ctx, cam, view, 0.035);
    ctx.globalCompositeOperation = 'lighter';
    const step = S.hi ? 9 : 16;
    let aurI = 0;
    for (const rb of S.ribbons) {
      const spr = S.aur[rb.spr];
      if (!spr) continue;
      const xa = Math.max(b.x0, rb.x0), xb = Math.min(b.x1, rb.x1);
      for (let x = Math.floor(xa / step) * step; x < xb; x += step) {
        const e = Math.min(1, (x - rb.x0) / 300, (rb.x1 - x) / 300);
        if (e <= 0) continue;
        const y = rb.y + Math.sin(x * rb.f1 + t * rb.s1) * rb.amp + Math.sin(x * rb.f2 - t * rb.s2 * 2) * rb.amp * 0.4;
        const hh = rb.h * (0.7 + 0.18 * Math.sin(x * 0.011 + t * 0.7) + 0.12 * Math.sin(x * 0.047 - t * 1.3));
        const a = rb.a * e * (0.4 + 0.6 * Math.sin(x * 0.006 - t * 0.5 + rb.y) ** 2) * (0.85 + 0.15 * Math.sin(x * 0.09 + t * 2));
        ctx.globalAlpha = a;
        ctx.drawImage(spr, x - step * 0.5, y - hh, step * 2, hh * 1.1);
        aurI += a;
      }
    }
    S.aurI = aurI;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.restore();

    b = layer(ctx, cam, view, 0.07);
    drawTile(ctx, b, S.mtnFar, -460, 0, '#2f6f86');
    ctx.restore();
    b = layer(ctx, cam, view, 0.15);
    drawTile(ctx, b, S.mtnMid, -380, 0, '#21506a');
    ctx.restore();
    b = layer(ctx, cam, view, 0.3);
    drawTile(ctx, b, S.ridge, -320, 0, '#2a4d6a');
    ctx.restore();
    b = layer(ctx, cam, view, 0.6);
    drawInstances(ctx, b, S.crystals, 3400);
    ctx.restore();
    // Snow drift just behind the fighting line
    b = layer(ctx, cam, view, 0.88);
    ctx.fillStyle = lin(ctx, 0, -46, 0, 0, [[0, '#e8f3fb'], [0.5, '#b7d2e6'], [1, '#86a9c6']]);
    ctx.beginPath();
    ctx.moveTo(b.x0 - 10, b.y1 + 4);
    const x0 = Math.floor(b.x0 / 40) * 40;
    for (let x = x0 - 40; x <= b.x1 + 40; x += 40) {
      ctx.lineTo(x, -18 - 14 * Math.sin(x * 0.0041) - 9 * Math.sin(x * 0.013 + 1.3) - 6 * Math.sin(x * 0.031));
    }
    ctx.lineTo(b.x1 + 10, b.y1 + 4);
    ctx.fill();
    ctx.restore();
    drawDotField(ctx, S.snow, cam, view, '#eef6ff', 0.75);

    // Icy, reflective floor
    const F = floorView(cam, view);
    if (F.gy < view.h) {
      floorBase(ctx, F, [[0, '#b8d8ea'], [0.12, '#7aa8c8'], [0.5, '#3f6c94'], [1, '#1b355a']]);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, F.gy, view.w, view.h - F.gy);
      ctx.clip();
      ctx.translate(0, F.gy);
      ctx.scale(1, -0.6);
      ctx.translate(0, -F.gy);
      const bb = layer(ctx, cam, view, 0.15);
      ctx.globalAlpha = 0.3;
      drawTile(ctx, bb, S.mtnMid, -380);
      ctx.restore();
      ctx.restore();
      ctx.globalAlpha = 1;
      floorTexture(ctx, F, S.ice, 1);
      ctx.globalCompositeOperation = 'lighter';
      drawGlowE(ctx, '80,255,180', view.w * 0.45, F.gy + 50 * F.z, view.w * 0.6, 90 * F.z, Math.min(0.3, (S.aurI || 0) * 0.004), 2);
      // glints
      ctx.fillStyle = '#ffffff';
      for (const gl of S.glints) {
        if (gl.r > F.rMax) continue;
        const a = Math.max(0, Math.sin(t * gl.f + gl.ph)) ** 6;
        if (a < 0.05) continue;
        const x = fX(F, gl.u, gl.r), y = fY(F, gl.r), s = (3 + a * 5) * F.z;
        if (x < -10 || x > view.w + 10) continue;
        ctx.globalAlpha = a;
        ctx.fillRect(x - s, y - 0.6, s * 2, 1.2);
        ctx.fillRect(x - 0.6, y - s, 1.2, s * 2);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillRect(0, F.gy - 0.5, view.w, 1.5);
    }
  },

  front(ctx, S, cam, view) {
    ctx.globalCompositeOperation = 'source-over';
    const s = glowSprite('240,248,255', 1);
    if (s) {
      for (const p of S.snowF) {
        if (!fieldPos(p, cam, view)) continue;
        const r = p.s * _fp[2];
        ctx.globalAlpha = 0.8;
        ctx.drawImage(s, _fp[0] - r, _fp[1] - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;
    }
    screenGrad(ctx, view, [[0, 'rgba(0,10,40,0.2)'], [0.55, 'rgba(0,20,60,0)'], [1, 'rgba(120,200,255,0.06)']]);
    vignette(ctx, view, '0,8,30', 0.55);
  },

  impact(S, x, y, p) {
    burst(S, S.n(Math.round(5 + p * 8)), (R) => ({
      k: 'puff', rgb: '235,245,255', x: x + R.range(-50, 50), y: -R.range(0, 30), vx: R.range(-120, 120), vy: -R.range(20, 90), drag: 2.5,
      life: R.range(0.8, 1.5), s: R.range(18, 36), grow: 50, a: 0.65, front: R() < 0.3,
    }));
    burst(S, S.n(Math.round(6 + p * 10)), (R) => ({
      k: 'chip', c: R.pick(['#e6f6ff', '#a8d8f5', '#cdeeff']), x: x + R.range(-30, 30), y: R.range(-10, 0), vx: R.range(-260, 260), vy: -R.range(150, 380) * (0.6 + p),
      g: 1200, life: R.range(0.7, 1.3), s: R.range(3, 6), rot: R() * TAU, vr: R.range(-14, 14), fy: R.range(0, 40), bounce: 0.3,
    }));
    burst(S, S.n(Math.round(4 + p * 6)), (R) => ({
      k: 'glow', rgb: '200,240,255', x: x + R.range(-40, 40), y: -R.range(10, 80), vx: R.range(-60, 60), vy: -R.range(20, 60), life: R.range(0.5, 1), s: R.range(6, 12), a: 0.8,
    }));
  },
};

// ═════════════════════════════════════════════════════════════════════════
// 5. Whispering Bamboo
// ═════════════════════════════════════════════════════════════════════════

const BAMBOO_SKY = [[0, '#7da493'], [0.4, '#b3cdab'], [0.7, '#e3e2b2'], [0.88, '#f8edc2'], [1, '#fff5d6']];

function bambooLeafPath(g, x, y, ang, len, wid) {
  const dx = Math.cos(ang), dy = Math.sin(ang), px = -dy, py = dx;
  g.moveTo(x, y);
  g.quadraticCurveTo(x + dx * len * 0.45 + px * wid, y + dy * len * 0.45 + py * wid, x + dx * len, y + dy * len);
  g.quadraticCurveTo(x + dx * len * 0.45 - px * wid, y + dy * len * 0.45 - py * wid, x, y);
}

// One bamboo stalk sprite (anchored at its base) with nodes, side branches and leaf sprays.
function bambooStalk(res, R, H, wid, col, leafCol) {
  const W = 260;
  return makeSprite(W, H, W / 2, H, res, (g) => {
    const hi = mix(col, '#ffffff', 0.25), lo = mix(col, '#000000', 0.3);
    g.fillStyle = lin(g, -wid / 2, 0, wid / 2, 0, [[0, lo], [0.18, hi], [0.45, col], [1, lo]]);
    g.beginPath();
    g.moveTo(-wid / 2, 0); g.lineTo(-wid * 0.36, -H); g.lineTo(wid * 0.36, -H); g.lineTo(wid / 2, 0);
    g.fill();
    let y = -R.range(20, 60);
    const leaves = [];
    while (y > -H + 20) {
      const ww = wid * (1 - (-y / H) * 0.28);
      g.fillStyle = lo;
      g.fillRect(-ww / 2 - 1.5, y - 1.5, ww + 3, 3);
      g.fillStyle = rgba(hi, 0.6);
      g.fillRect(-ww / 2, y + 1.5, ww, 1.5);
      if (-y > H * 0.3 && R() < 0.55) {
        const side = R() < 0.5 ? -1 : 1;
        const bl = R.range(40, 100), ba = -Math.PI / 2 + side * R.range(0.6, 1.1);
        const bx = side * ww * 0.45, ex = bx + Math.cos(ba) * bl, ey = y + Math.sin(ba) * bl;
        g.strokeStyle = lo;
        g.lineWidth = Math.max(1.2, wid * 0.08);
        g.beginPath(); g.moveTo(bx, y); g.lineTo(ex, ey); g.stroke();
        leaves.push([ex, ey, side], [bx + (ex - bx) * 0.55, y + (ey - y) * 0.55, side]);
      }
      y -= R.range(60, 100) * (wid / 22) * (1 + (-y / H) * 0.25);
    }
    const lc = [leafCol, mix(leafCol, '#ffffff', 0.18), mix(leafCol, '#000000', 0.2)];
    for (let c = 0; c < 3; c++) {
      g.fillStyle = lc[c];
      g.beginPath();
      for (const [lx, ly, side] of leaves) {
        const n = R.int(1, 3);
        for (let i = 0; i < n; i++) {
          const a = side > 0 ? R.range(0.15, 1.2) : Math.PI - R.range(0.15, 1.2);
          bambooLeafPath(g, lx, ly, a, R.range(34, 62) * (wid / 22) ** 0.4, R.range(4, 7));
        }
      }
      g.fill();
    }
  });
}

function stoneLantern(res) {
  return makeSprite(140, 260, 70, 260, res, (g) => {
    const st = '#6d7262', dk = '#4c5245', moss = '#6f8f4a';
    g.fillStyle = dk;
    g.fillRect(-44, -18, 88, 18);
    g.fillStyle = st;
    g.fillRect(-34, -30, 68, 14);
    g.fillRect(-12, -120, 24, 92);
    g.fillRect(-36, -136, 72, 18);
    g.fillStyle = dk;
    g.fillRect(-28, -186, 56, 50);
    g.fillStyle = '#ffd98a';
    g.fillRect(-16, -176, 32, 32);
    g.fillStyle = st;
    g.beginPath();
    g.moveTo(-60, -186); g.quadraticCurveTo(-30, -196, -14, -226); g.lineTo(14, -226); g.quadraticCurveTo(30, -196, 60, -186);
    g.fill();
    g.beginPath(); g.arc(0, -236, 10, 0, TAU); g.fill();
    g.fillStyle = moss;
    g.beginPath();
    g.ellipse(-30, -190, 22, 6, 0.2, 0, TAU);
    g.ellipse(10, -222, 10, 4, 0, 0, TAU);
    g.ellipse(-28, -26, 16, 5, 0, 0, TAU);
    g.ellipse(30, -14, 20, 6, 0, 0, TAU);
    g.fill();
  });
}

function stalkLayer(R, n, period, sprites) {
  const list = [];
  for (let i = 0; i < n; i++) {
    list.push({ s: sprites[i % sprites.length], x: (i + R.range(0.1, 0.9)) * (period / n), fl: R() < 0.5 ? -1 : 1, sc: R.range(0.85, 1.1), ph: R() * TAU });
  }
  return list;
}

// Draw swaying stalks: per-stalk skew (x' = x + k*y) keeps the base planted.
function drawStalks(ctx, b, list, period, t, amp) {
  const m = ctx.getTransform();
  for (const o of list) {
    const s = o.s;
    if (!s) continue;
    const half = s.w * 0.5 * o.sc;
    eachCopy(o.x, period, b.x0, b.x1, half + 60, (x) => {
      const k = (Math.sin(t * 0.55 + o.ph) * 0.014 + Math.sin(t * 1.4 + o.ph * 2.3) * 0.004) * amp;
      const sx = o.fl * o.sc, sc = o.sc;
      ctx.setTransform(m.a * sx, m.b * sx, (m.a * k + m.c) * sc, (m.b * k + m.d) * sc, m.a * x + m.e, m.b * x + m.f);
      ctx.drawImage(s.c, -s.ax, -s.ay, s.w, s.h);
    });
  }
  ctx.setTransform(m);
}

IMPL.bamboo = {
  build(S) {
    const R = S.rng, res = S.res;
    S.hills = makeTile(2400, 300, res * 0.25, (g, w, h) => {
      const f = pfbm(R, [[4, 50], [11, 22], [31, 8]]);
      g.beginPath();
      g.moveTo(-8, h);
      for (let x = -8; x <= w + 8; x += 6) g.lineTo(x, h - (150 + f(x / w)));
      g.lineTo(w + 8, h);
      g.fillStyle = lin(g, 0, h - 220, 0, h, [[0, '#9fbea0'], [1, '#d7e2bf']]);
      g.fill();
    });
    const far = [0, 1, 2, 3].map(() => bambooStalk(res * 0.35, R, 760, R.range(8, 12), '#a2bf9f', '#9ab996'));
    const mid = [0, 1, 2, 3].map(() => bambooStalk(res * 0.45, R, 900, R.range(14, 19), '#72a06c', '#6f9b66'));
    const near = [0, 1, 2].map(() => bambooStalk(res * 0.55, R, 1150, R.range(26, 34), '#3f6d40', '#3d6a3a'));
    S.far = stalkLayer(R, 34, 2000, far);
    S.mid = stalkLayer(R, 20, 2200, mid);
    S.near = stalkLayer(R, 8, 2600, near).filter((o) => Math.abs(mod(o.x + 1300, 2600) - 1300) > 260);
    S.lantern = stoneLantern(res * 0.7);
    S.leafSpr = [0, 1].map((v) => makeSprite(26, 10, 13, 5, res, (g) => {
      g.fillStyle = v ? '#8fb55e' : '#5f8f3e';
      g.beginPath();
      bambooLeafPath(g, -13, 0, 0, 26, 4.5);
      g.fill();
    }));
    // Flagstone floor (floor coords, period 1600)
    S.stones = [[], [], []];
    const rows = [0, 22, 50, 86, 132, 190, 262, 350];
    for (let ri = 0; ri < rows.length - 1; ri++) {
      const r0 = rows[ri], r1 = rows[ri + 1], gap = 2.5 + ri * 0.7, dh = r1 - r0;
      let u = R.range(0, 80);
      const start = u;
      while (u < start + 1600 - 50) {
        let wdt = R.range(70, 200) * (1 + ri * 0.06);
        if (u + wdt > start + 1600 - 50) wdt = start + 1600 - u;
        const j = (a) => R.range(-a, a);
        const cr = Math.min(wdt * 0.12, dh * 0.3);
        const pts = [
          u + gap + cr + j(4), r0 + gap + j(1),
          u + wdt * 0.5 + j(10), r0 + gap + j(dh * 0.08),
          u + wdt - gap - cr + j(4), r0 + gap + j(1),
          u + wdt - gap + j(3), r0 + gap + cr * 0.6,
          u + wdt - gap + j(5), r1 - gap - cr * 0.6,
          u + wdt - gap - cr + j(4), r1 - gap,
          u + wdt * 0.5 + j(10), r1 - gap + j(dh * 0.06),
          u + gap + cr + j(4), r1 - gap,
          u + gap + j(5), r1 - gap - cr * 0.6,
          u + gap + j(3), r0 + gap + cr * 0.6,
        ];
        S.stones[R() < 0.3 ? 2 : R.int(0, 1)].push(pts);
        u += wdt;
      }
    }
    S.moss = makeTileT(1400, 260, res * 0.5, (g, w, h) => {
      for (let i = 0; i < 140; i++) {
        const x = R() * w, y = R() * h, rw = R.range(10, 50);
        wrap(w, x, (xx) => {
          g.fillStyle = rad(g, xx, y, 0, rw, [[0, 'rgba(80,120,40,0.4)'], [1, 'rgba(80,120,40,0)']]);
          g.fillRect(xx - rw, y - rw, rw * 2, rw * 2);
        });
      }
      for (let i = 0; i < 50; i++) {
        const x = R() * w, y = R() * h;
        g.fillStyle = R() < 0.5 ? 'rgba(150,120,50,0.6)' : 'rgba(90,120,50,0.7)';
        wrap(w, x, (xx) => { g.beginPath(); bambooLeafPath(g, xx, y, R.range(-0.3, 0.3), 16, 3); g.fill(); });
      }
    });
    S.motes = makeField(S.frng, S.n(55), (p, r) => { p.d = r.range(0.3, 0.9); p.s = r.range(2, 4); p.vx = r.range(-6, 6); p.vy = r.range(-8, 4); p.tw = r.range(0.5, 1.5); p.a = 0.7; });
    S.leaves = makeField(S.frng, S.n(10), (p, r) => { p.d = r.range(0.5, 0.9); p.s = r.range(0.8, 1.1); p.vx = r.range(8, 24); p.vy = r.range(20, 40); p.vr = r.range(-1, 1); p.v = r.int(0, 1); p.a = 0.85; });
    S.leavesF = makeField(S.frng, S.n(4), (p, r) => { p.d = r.range(1.25, 1.5); p.s = r.range(2, 2.6); p.vx = r.range(15, 30); p.vy = r.range(30, 50); p.vr = r.range(-1, 1); p.v = r.int(0, 1); p.a = 0.95; });
    S.flies = Array.from({ length: S.n(14) }, () => ({ x: S.frng.range(-1300, 1300), y: S.frng.range(-320, -30), ph: S.frng() * TAU, f: S.frng.range(0.3, 0.7), bl: S.frng() * TAU }));
    S.ferns = makeSprite(420, 160, 0, 160, res * 0.5, (g) => {
      g.fillStyle = '#1f3320';
      for (let i = 0; i < 9; i++) {
        const a = -Math.PI / 2 + R.range(-0.9, 0.9) + 0.4, L = R.range(90, 160);
        g.beginPath();
        let x = R.range(0, 120), y = 0;
        const ex = x + Math.cos(a) * L * 1.6, ey = y + Math.sin(a) * L;
        for (let k = 0; k < 10; k++) {
          const t0 = k / 10, cx = x + (ex - x) * t0, cy = y + (ey - y) * t0 + Math.sin(t0 * 3) * 10;
          bambooLeafPath(g, cx, cy, a - 1.2, 28 * (1 - t0 * 0.6), 4);
          bambooLeafPath(g, cx, cy, a + 1.2, 28 * (1 - t0 * 0.6), 4);
        }
        g.fill();
      }
    });
    S.gust = 0;
  },

  update(S, dt) {
    const t = S.t;
    stepField(S.motes, dt, t, 6, 0.4);
    stepField(S.leaves, dt, t, 30, 1.1);
    stepField(S.leavesF, dt, t, 40, 0.9);
    S.gust = Math.max(0, S.gust - dt * 0.5);
  },

  back(ctx, S, cam, view) {
    const t = S.t;
    drawSky(ctx, cam, view, BAMBOO_SKY, -780, 0);
    let b = layer(ctx, cam, view, 0.03);
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(ctx, '255,240,190', -520, -620, 520, 0.5);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.restore();
    b = layer(ctx, cam, view, 0.06);
    drawTile(ctx, b, S.hills, -300, 0, '#d7e2bf');
    ctx.restore();
    const amp = 1 + S.gust * 2.5;
    b = layer(ctx, cam, view, 0.14);
    ctx.globalAlpha = 0.85;
    drawStalks(ctx, b, S.far, 2000, t, amp);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    drawGlowE(ctx, '245,245,225', cam.x * 0.14, -60, 2200, 170, 0.55, 2);
    ctx.globalAlpha = 1;
    ctx.restore();
    // Light shafts from the upper left
    b = layer(ctx, cam, view, 0.25);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const x = -900 + i * 330 + Math.sin(i * 7.1) * 80, wdt = 70 + (i % 3) * 45;
      const a = 0.08 + 0.05 * Math.sin(t * 0.4 + i * 1.7);
      eachCopy(x, 2000, b.x0 - 600, b.x1, 300, (xx) => {
        ctx.fillStyle = lin(ctx, 0, -760, 0, 0, [[0, `rgba(255,245,200,${a * 1.6})`], [0.7, `rgba(255,240,190,${a})`], [1, 'rgba(255,240,190,0)']]);
        ctx.beginPath();
        ctx.moveTo(xx, -780); ctx.lineTo(xx + wdt, -780); ctx.lineTo(xx + wdt + 420, 0); ctx.lineTo(xx + 420 - wdt * 0.2, 0);
        ctx.fill();
      });
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
    b = layer(ctx, cam, view, 0.32);
    drawStalks(ctx, b, S.mid, 2200, t, amp);
    drawGlowE(ctx, '240,244,220', cam.x * 0.32, -30, 2000, 120, 0.5, 2);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#c9d6ad';
    ctx.fillRect(b.x0 - 4, 0, b.x1 - b.x0 + 8, b.y1 + 4);
    ctx.restore();
    b = layer(ctx, cam, view, 0.6);
    drawStalks(ctx, b, S.near, 2600, t, amp * 1.2);
    ctx.restore();
    b = layer(ctx, cam, view, 0.75);
    for (const lx of [-560, 1500]) {
      eachCopy(lx, 3400, b.x0, b.x1, 80, (x) => {
        drawSprite(ctx, S.lantern, x, 0);
        ctx.globalCompositeOperation = 'lighter';
        drawGlow(ctx, '255,200,110', x, -160, 70, 0.4 + 0.06 * Math.sin(t * 9 + x));
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      });
    }
    // fireflies
    ctx.globalCompositeOperation = 'lighter';
    for (const f of S.flies) {
      const x = f.x + Math.sin(t * f.f + f.ph) * 60, y = f.y + Math.sin(t * f.f * 1.3 + f.ph * 2) * 30;
      const a = Math.max(0, Math.sin(t * 1.1 + f.bl)) ** 2;
      if (a < 0.03) continue;
      eachCopy(x, 2600, b.x0, b.x1, 20, (xx) => {
        drawGlow(ctx, '210,255,120', xx, y, 18, a * 0.7);
        drawGlow(ctx, '255,255,210', xx, y, 4, a);
      });
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.restore();
    drawGlowField(ctx, S.motes, cam, view, '255,236,170', t, 1, 0.8);
    drawSpriteField(ctx, S.leaves, cam, view, S.leafSpr, t, 1.5);

    // Floor: mossy flagstones
    const F = floorView(cam, view);
    if (F.gy < view.h) {
      floorBase(ctx, F, [[0, '#3a4532'], [0.3, '#283022'], [1, '#161c13']]);
      const cols = ['#7f8670', '#6e7660', '#5d6e45'];
      for (let gi = 0; gi < 3; gi++) {
        ctx.fillStyle = lin(ctx, 0, F.gy, 0, F.gy + 240 * F.z, [[0, mix(cols[gi], '#fff6d0', 0.2)], [0.35, cols[gi]], [1, mix(cols[gi], '#1d241a', 0.55)]]);
        ctx.beginPath();
        floorCopies(F, 1600, 0, 1700, (du) => {
          for (const pts of S.stones[gi]) if (pts[1] < F.rMax) floorPoly(ctx, F, pts, du);
        });
        ctx.fill();
      }
      floorTexture(ctx, F, S.moss, 1);
      ctx.globalCompositeOperation = 'lighter';
      drawGlowE(ctx, '255,230,160', view.w * 0.55, F.gy + 30 * F.z, view.w * 0.6, 80 * F.z, 0.22, 2);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(40,60,30,0.5)';
      ctx.fillRect(0, F.gy - 0.5, view.w, 2);
    }
  },

  front(ctx, S, cam, view) {
    drawSpriteField(ctx, S.leavesF, cam, view, S.leafSpr, S.t, 1.2);
    // ferns hugging the bottom corners (subtle, low, slight parallax)
    if (S.ferns) {
      const z = 0.75 * (1 + (cam.zoom - 1) * 0.5);
      const off = clamp(-cam.x * 0.04, -40, 40);
      const fw = S.ferns.w * z, fh = S.ferns.h * z;
      ctx.drawImage(S.ferns.c, -70 + off, view.h - fh * 0.8, fw, fh);
      ctx.save();
      ctx.translate(view.w + 70 + off, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(S.ferns.c, 0, view.h - fh * 0.72, fw * 0.9, fh * 0.9);
      ctx.restore();
    }
    screenGrad(ctx, view, [[0, 'rgba(255,250,220,0.10)'], [0.45, 'rgba(255,250,220,0)'], [1, 'rgba(20,40,20,0.15)']]);
    vignette(ctx, view, '20,35,20', 0.45);
  },

  impact(S, x, y, p) {
    S.gust = Math.min(1, S.gust + p * 0.8);
    burst(S, S.n(Math.round(4 + p * 10)), (R) => ({
      k: 'leaf', spr: S.leafSpr[R.int(0, 1)], x: x + R.range(-420, 420), y: -R.range(450, 800), vx: R.range(-20, 40), vy: R.range(20, 60),
      g: 30, drag: 0.6, life: R.range(4, 7), s: R.range(1, 1.5), rot: R() * TAU, vr: R.range(-2, 2), ph: R() * TAU, sway: 50,
      fy: R.range(2, 60), bounce: 0, front: R() < 0.25,
    }));
    burst(S, S.n(Math.round(3 + p * 6)), (R) => ({
      k: 'puff', rgb: '190,190,150', x: x + R.range(-50, 50), y: -R.range(0, 15), vx: R.range(-80, 80), vy: -R.range(10, 40), drag: 3,
      life: R.range(0.6, 1.1), s: R.range(14, 28), grow: 40, a: 0.4,
    }));
    burst(S, S.n(Math.round(3 + p * 5)), (R) => ({
      k: 'chip', c: R.pick(['#6c7f55', '#7a846d', '#4a5640']), x: x + R.range(-20, 20), y: -2, vx: R.range(-180, 180), vy: -R.range(100, 260),
      g: 1100, life: R.range(0.6, 1), s: R.range(2, 4), rot: R() * TAU, vr: R.range(-10, 10), fy: R.range(0, 30), bounce: 0.3,
    }));
  },
};

// ═════════════════════════════════════════════════════════════════════════
// 6. Sky Sanctum
// ═════════════════════════════════════════════════════════════════════════

const TEMPLE_SKY = [[0, '#2d5aa8'], [0.35, '#6a8fd0'], [0.58, '#b9a6d2'], [0.76, '#f0b3a8'], [0.9, '#ffd09c'], [1, '#fff0c4']];

// Billowy cloud bank tile: puffs along a band, lit on top, lavender underneath.
function cloudBank(R, w, h, res, o) {
  return makeTile(w, h, res, (g) => {
    for (let pass = 0; pass < 2; pass++) {
      g.fillStyle = pass === 0
        ? lin(g, 0, h - o.top - 60, 0, h, [[0, o.shade], [1, o.base]])
        : lin(g, 0, h - o.top - 70, 0, h - o.top + 60, [[0, o.lit], [1, rgba(o.litFade, 0)]]);
      g.beginPath();
      const RR = makeRng(o.seed);
      for (let i = 0; i < o.n; i++) {
        const x = RR() * w, r = RR.range(o.rMin, o.rMax), y = h - o.top + RR.range(-o.jitter, o.jitter) + r * 0.4;
        wrap(w, x, (xx) => { g.moveTo(xx + r, y); g.arc(xx, y, r, 0, TAU); });
      }
      if (pass === 0) g.rect(-8, h - o.top + 30, w + 16, o.top);
      g.fill();
    }
  });
}

function floatingIsland(res, R, w) {
  const h = w * 1.3;
  return makeSprite(w * 1.2, h, w * 0.6, h * 0.3, res, (g) => {
    // rocky underside
    const pts = [];
    const n = 9;
    for (let i = 0; i <= n; i++) {
      const t0 = i / n, x = -w / 2 + t0 * w;
      pts.push([x, h * 0.04 + Math.sin(t0 * Math.PI) * h * 0.62 * R.range(0.75, 1.05)]);
    }
    g.fillStyle = lin(g, 0, 0, 0, h * 0.68, [[0, '#9a7c8c'], [0.4, '#7a6283'], [1, '#5b4a72']]);
    g.beginPath();
    g.moveTo(-w / 2, 0);
    for (const [x, y] of pts) g.lineTo(x, y);
    g.lineTo(w / 2, 0);
    g.fill();
    g.strokeStyle = 'rgba(60,40,70,0.35)';
    g.lineWidth = 2;
    g.beginPath();
    for (let k = 1; k < 4; k++) { g.moveTo(-w * 0.45, h * 0.1 * k); g.quadraticCurveTo(0, h * 0.1 * k + 12, w * 0.45 - k * 20, h * 0.1 * k - 4); }
    g.stroke();
    g.fillStyle = 'rgba(255,220,180,0.35)';
    g.beginPath(); g.moveTo(-w / 2, 0); g.lineTo(-w * 0.3, h * 0.35); g.lineTo(-w * 0.42, 0); g.fill();
    // grass top
    g.fillStyle = '#8fb873';
    g.beginPath(); g.ellipse(0, 0, w * 0.52, h * 0.06, 0, 0, TAU); g.fill();
    g.fillStyle = '#b5d692';
    g.beginPath(); g.ellipse(-w * 0.06, -h * 0.015, w * 0.4, h * 0.035, 0, 0, TAU); g.fill();
    // little shrine + tree
    const sx = R.range(-w * 0.2, w * 0.1);
    g.fillStyle = '#f3ebe3';
    g.fillRect(sx - 18, -46, 36, 40);
    g.fillStyle = '#d9b46a';
    g.beginPath(); g.moveTo(sx - 26, -46); g.lineTo(sx, -64); g.lineTo(sx + 26, -46); g.fill();
    g.fillStyle = '#c9b8b2';
    for (let k = 0; k < 3; k++) g.fillRect(sx - 14 + k * 12, -40, 4, 34);
    const tx = sx + 60;
    g.fillStyle = '#6f5a5a';
    g.fillRect(tx - 3, -50, 6, 46);
    g.fillStyle = '#9cc47e';
    g.beginPath(); g.arc(tx, -62, 22, 0, TAU); g.arc(tx - 16, -50, 14, 0, TAU); g.arc(tx + 14, -52, 15, 0, TAU); g.fill();
    // waterfall
    g.fillStyle = lin(g, 0, 0, 0, h * 0.62, [[0, 'rgba(240,250,255,0.9)'], [1, 'rgba(240,250,255,0)']]);
    g.fillRect(w * 0.32, 0, 6, h * 0.62);
  });
}

function templeColumn(g, x, base, top, wdt, broken) {
  g.fillStyle = lin(g, x - wdt / 2, 0, x + wdt / 2, 0, [[0, '#d6c6b8'], [0.3, '#fbf5ee'], [0.7, '#e3d6ca'], [1, '#b8a597']]);
  if (broken) {
    g.beginPath();
    g.moveTo(x - wdt / 2, base); g.lineTo(x - wdt / 2, top + 18); g.lineTo(x - wdt * 0.2, top); g.lineTo(x + wdt * 0.05, top + 22);
    g.lineTo(x + wdt * 0.3, top + 8); g.lineTo(x + wdt / 2, top + 26); g.lineTo(x + wdt / 2, base);
    g.fill();
  } else {
    g.fillRect(x - wdt / 2, top, wdt, base - top);
  }
  g.strokeStyle = 'rgba(150,120,110,0.35)';
  g.lineWidth = 1.5;
  g.beginPath();
  for (const f of [-0.25, 0, 0.25]) { g.moveTo(x + f * wdt, base - 20); g.lineTo(x + f * wdt, top + (broken ? 30 : 30)); }
  g.stroke();
  g.fillStyle = '#e9ddd0';
  g.fillRect(x - wdt * 0.75, base - 22, wdt * 1.5, 22);
  if (!broken) {
    g.fillRect(x - wdt * 0.8, top - 18, wdt * 1.6, 18);
    g.fillStyle = '#d4a94f';
    g.fillRect(x - wdt * 0.8, top - 4, wdt * 1.6, 4);
    g.beginPath(); g.arc(x - wdt * 0.62, top - 6, 6, 0, TAU); g.arc(x + wdt * 0.62, top - 6, 6, 0, TAU); g.fill();
  }
}

IMPL.temple = {
  build(S) {
    const R = S.rng, res = S.res;
    S.cirrus = makeTileT(2400, 320, res * 0.25, (g, w) => {
      for (let i = 0; i < 16; i++) {
        const x = R() * w, y = R.range(30, 280), cw = R.range(200, 500), ch = R.range(6, 14);
        wrap(w, x, (xx) => {
          g.fillStyle = lin(g, 0, y - ch, 0, y + ch, [[0, 'rgba(255,255,255,0)'], [1, `rgba(255,${Math.round(200 + y * 0.15)},${Math.round(190 + y * 0.1)},0.55)`]]);
          g.beginPath(); g.ellipse(xx, y, cw, ch, 0, 0, TAU); g.ellipse(xx + cw * 0.4, y - ch * 0.6, cw * 0.5, ch * 0.7, 0, 0, TAU); g.fill();
        });
      }
    });
    S.seaFar = cloudBank(R, 2400, 260, res * 0.25, { top: 150, n: 90, rMin: 40, rMax: 95, jitter: 40, shade: '#e3b7c6', base: '#c9a3c4', lit: 'rgba(255,240,220,0.95)', litFade: '#ffe9d6', seed: 11 });
    S.seaMid = cloudBank(R, 2400, 220, res * 0.25, { top: 110, n: 70, rMin: 45, rMax: 100, jitter: 30, shade: '#f2d2d6', base: '#dcb8cc', lit: 'rgba(255,250,240,0.95)', litFade: '#fff3e6', seed: 23 });
    S.islands = [
      { s: floatingIsland(res * 0.5, R, 180), x: -560, y: -360, p: 0.12, ph: 0 },
      { s: floatingIsland(res * 0.5, R, 120), x: 700, y: -430, p: 0.1, ph: 2 },
      { s: floatingIsland(res * 0.55, R, 240), x: 980, y: -300, p: 0.2, ph: 4 },
      { s: floatingIsland(res * 0.5, R, 150), x: -1350, y: -260, p: 0.2, ph: 1 },
    ];
    S.balus = makeTile(440, 74, res * 0.75, (g, w, h) => {
      const top = h - 64;
      g.fillStyle = lin(g, 0, top, 0, h, [[0, '#f7efe5'], [1, '#cdbbaa']]);
      for (let x = 11; x < w; x += 22) {
        g.beginPath();
        g.moveTo(x - 4, top + 10); g.quadraticCurveTo(x - 10, top + 30, x - 4, top + 52); g.lineTo(x + 4, top + 52); g.quadraticCurveTo(x + 10, top + 30, x + 4, top + 10);
        g.fill();
      }
      g.fillStyle = lin(g, 0, top, 0, top + 12, [[0, '#fffaf2'], [1, '#d9c9b8']]);
      g.fillRect(-8, top, w + 16, 12);
      g.fillStyle = '#d4a94f';
      g.fillRect(-8, top + 11, w + 16, 2);
      g.fillStyle = lin(g, 0, h - 12, 0, h, [[0, '#efe4d6'], [1, '#bfae9c']]);
      g.fillRect(-8, h - 12, w + 16, 12);
    });
    S.veins = makeTileT(1500, 250, res * 0.5, (g, w, h) => {
      for (let i = 0; i < 40; i++) {
        let x = R() * w, y = R() * h;
        g.strokeStyle = `rgba(120,100,110,${R.range(0.06, 0.16)})`;
        g.lineWidth = R.range(0.6, 1.6);
        const pts = [[x, y]];
        for (let k = 0; k < 6; k++) { x += R.range(20, 60); y += R.range(-12, 12); pts.push([x, y]); }
        wrap(w, 0, (o) => {
          g.beginPath();
          pts.forEach(([px, py], k) => (k ? g.lineTo(px + o, py) : g.moveTo(px + o, py)));
          g.stroke();
        });
      }
    });
    S.motes = makeField(S.frng, S.n(45), (p, r) => { p.d = r.range(0.3, 0.9); p.s = r.range(2, 4); p.vx = r.range(4, 14); p.vy = r.range(-14, -4); p.tw = r.range(1, 3); p.a = 0.8; });
    S.wisps = Array.from({ length: S.hi ? 5 : 3 }, (_, i) => ({ x: i * 420 + S.frng.range(0, 200), s: S.frng.range(160, 260), sp: S.frng.range(10, 22) }));
    S.doves = [];
    for (const x of [-860, -420, 380, 560, 980]) S.doves.push({ px: x, py: -62, x, y: -62, st: 0, t: R.range(0, 3), ph: R() * TAU, dir: 1, vx: 0, vy: 0 });
    S.flock = null;
    S.flockT = 3;
  },

  update(S, dt) {
    const R = S.rng, t = S.t;
    stepField(S.motes, dt, t, 8, 0.7);
    for (const w of S.wisps) w.x += w.sp * dt;
    for (const d of S.doves) {
      d.t += dt;
      if (d.st === 1) {
        d.vy -= 120 * dt;
        d.x += d.vx * dt; d.y += d.vy * dt;
        if (d.t > 7 + d.ph) { d.st = 2; d.t = 0; d.sx = d.px + d.dir * 900; d.sy = -700; }
      } else if (d.st === 2) {
        const k = Math.min(1, d.t / 3), e = 1 - (1 - k) * (1 - k);
        d.x = lerp(d.sx, d.px, e); d.y = lerp(d.sy, d.py, e) - Math.sin(k * Math.PI) * 60;
        if (k >= 1) { d.st = 0; d.t = 0; }
      }
    }
    S.flockT -= dt;
    if (S.flockT <= 0) {
      const dir = R() < 0.5 ? 1 : -1;
      S.flock = { x: -dir * 1400, y: R.range(-520, -380), dir, list: Array.from({ length: R.int(5, 9) }, (_, i) => [-i * 30 * dir + R.range(-8, 8), Math.abs(i - 3) * 12 + R.range(-5, 5), R() * TAU]) };
      S.flockT = R.range(12, 20);
    }
    if (S.flock) {
      S.flock.x += S.flock.dir * 60 * dt;
      if (Math.abs(S.flock.x) > 1600) S.flock = null;
    }
  },

  back(ctx, S, cam, view) {
    const t = S.t;
    drawSky(ctx, cam, view, TEMPLE_SKY, -780, 0);
    let b = layer(ctx, cam, view, 0.03);
    const sx = 470, sy = -90;
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(ctx, '255,190,120', sx, sy, 700, 0.5);
    drawGlow(ctx, '255,235,190', sx, sy, 240, 0.7);
    if (S.hi) {
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(-t * 0.015);
      ctx.fillStyle = 'rgba(255,230,170,0.07)';
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU;
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, 1100, a, a + 0.07 + (i % 3) * 0.03);
      }
      ctx.fill();
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = rad(ctx, sx, sy, 10, 70, [[0, '#ffffff'], [0.7, '#fff3cf'], [1, '#ffe2a0']]);
    ctx.beginPath(); ctx.arc(sx, sy, 66, 0, TAU); ctx.fill();
    ctx.restore();
    b = layer(ctx, cam, view, 0.04);
    drawTile(ctx, b, S.cirrus, -720, t * 5);
    ctx.restore();
    b = layer(ctx, cam, view, 0.07);
    drawTile(ctx, b, S.seaFar, -260, t * 3, '#c9a3c4');
    ctx.restore();
    // floating islands (bobbing)
    for (const isl of S.islands) {
      b = layer(ctx, cam, view, isl.p);
      eachCopy(isl.x, 3000, b.x0, b.x1, 200, (x) => drawSprite(ctx, isl.s, x, isl.y + Math.sin(t * 0.45 + isl.ph) * 9));
      ctx.restore();
    }
    if (S.flock) {
      b = layer(ctx, cam, view, 0.22);
      ctx.strokeStyle = 'rgba(90,80,120,0.65)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (const [ox, oy, ph] of S.flock.list) {
        const x = S.flock.x + ox, y = S.flock.y + oy, f = Math.sin(t * 8 + ph) * 6;
        ctx.moveTo(x - 10, y - f); ctx.quadraticCurveTo(x - 4, y - 2, x, y + 1); ctx.quadraticCurveTo(x + 4, y - 2, x + 10, y - f);
      }
      ctx.stroke();
      ctx.restore();
    }
    b = layer(ctx, cam, view, 0.22);
    drawTile(ctx, b, S.seaMid, -220, t * 7, '#dcb8cc');
    ctx.restore();

    // Distant sanctum facade (hazy, low contrast)
    b = layer(ctx, cam, view, 0.42);
    eachCopy(-60, 3600, b.x0, b.x1, 420, (x) => {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#efe2e4';
      ctx.fillRect(x - 330, -50, 660, 50);
      ctx.fillRect(x - 300, -76, 600, 28);
      for (let i = 0; i < 6; i++) templeColumn(ctx, x - 250 + i * 100, -76, -330, 38, false);
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#f3e8e6';
      ctx.fillRect(x - 310, -386, 620, 40);
      ctx.fillStyle = '#d9b36b';
      ctx.fillRect(x - 310, -350, 620, 4);
      ctx.fillStyle = '#efe0e0';
      ctx.beginPath(); ctx.moveTo(x - 330, -386); ctx.lineTo(x, -490); ctx.lineTo(x + 330, -386); ctx.fill();
      ctx.fillStyle = 'rgba(217,179,107,0.9)';
      ctx.beginPath(); ctx.arc(x, -425, 18, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    });
    ctx.fillStyle = '#e6d3d6';
    ctx.fillRect(b.x0 - 4, -2, b.x1 - b.x0 + 8, b.y1 + 6);
    ctx.restore();
    // Colonnade (some columns broken)
    b = layer(ctx, cam, view, 0.66);
    ctx.fillStyle = '#f0e6da';
    eachCopy(0, 2800, b.x0, b.x1, 1500, (x) => {
      ctx.fillStyle = lin(ctx, 0, -600, 0, -560, [[0, '#fbf4ea'], [1, '#d8c8b8']]);
      ctx.fillRect(x - 1345, -602, 390, 40);
      ctx.fillRect(x + 955, -602, 390, 40);
      ctx.fillStyle = '#d4a94f';
      ctx.fillRect(x - 1345, -566, 390, 3);
      ctx.fillRect(x + 955, -566, 390, 3);
    });
    eachCopy(0, 2800, b.x0, b.x1, 1500, (x) => {
      for (const [cx, br] of [[-1300, 0], [-1000, 0], [-700, 1], [700, 1], [1000, 0], [1300, 0]]) {
        templeColumn(ctx, x + cx, 0, br ? -360 : -560, 54, br);
      }
    });
    ctx.restore();
    drawGlowField(ctx, S.motes, cam, view, '255,220,140', t, 1, 0.8);
    // Balustrade + doves
    b = layer(ctx, cam, view, 0.93);
    drawTile(ctx, b, S.balus, -74, 0, '#bfae9c');
    for (const d of S.doves) {
      eachCopy(d.x, 3000, b.x0, b.x1, 30, (x) => {
        const y = d.y, fl = d.st ? Math.sin(t * 22 + d.ph) : 0;
        const dir = d.st === 1 ? Math.sign(d.vx) || 1 : d.st === 2 ? Math.sign(d.px - d.sx) || 1 : (Math.sin(d.ph) > 0 ? 1 : -1);
        const peck = d.st === 0 ? Math.max(0, Math.sin(t * 1.3 + d.ph * 3)) ** 8 * 4 : 0;
        ctx.fillStyle = '#fbf8f4';
        ctx.beginPath();
        ctx.ellipse(x, y - 6, 9, 5.5, 0, 0, TAU);
        ctx.arc(x + dir * 8, y - 11 + peck, 3.6, 0, TAU);
        ctx.moveTo(x - dir * 7, y - 6); ctx.lineTo(x - dir * 15, y - 9); ctx.lineTo(x - dir * 14, y - 3);
        ctx.fill();
        if (d.st) {
          ctx.beginPath();
          ctx.moveTo(x - 3, y - 7); ctx.lineTo(x - 2 - dir * 4, y - 7 - 14 * fl); ctx.lineTo(x + 6, y - 7);
          ctx.fill();
        }
        ctx.fillStyle = '#e8a050';
        ctx.fillRect(x + dir * 11.5 - 1, y - 11 + peck, 2.5, 1.5);
      });
    }
    ctx.restore();

    // Marble floor
    const F = floorView(cam, view);
    if (F.gy < view.h) {
      floorBase(ctx, F, [[0, '#f7eedf'], [0.2, '#e3d4c1'], [0.6, '#bba893'], [1, '#8a786a']]);
      floorTexture(ctx, F, S.veins, 1);
      ctx.strokeStyle = 'rgba(150,120,95,0.38)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      floorRays(ctx, F, 200, 100);
      for (const r of [26, 64, 118, 190, 290]) if (r < F.rMax) { ctx.moveTo(0, fY(F, r)); ctx.lineTo(view.w, fY(F, r)); }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(214,168,75,0.85)';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      floorRays(ctx, F, 800, 0);
      for (const r of [8, 12]) if (r < F.rMax) { ctx.moveTo(0, fY(F, r)); ctx.lineTo(view.w, fY(F, r)); }
      ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      const [ssx] = layerToScreen(cam, view, 0.03, 470, -90);
      drawGlowE(ctx, '255,200,140', ssx, F.gy + 20 * F.z, 600 * F.z, 120 * F.z, 0.35, 2);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillRect(0, F.gy - 0.5, view.w, 1.5);
    }
  },

  front(ctx, S, cam, view) {
    // low cloud wisps drifting along the bottom edge
    const s = glowSprite('255,248,240', 1);
    if (s) {
      const W = view.w + 600;
      for (const w of S.wisps) {
        const x = mod(w.x - cam.x * 1.3, W) - 300;
        ctx.globalAlpha = 0.33;
        ctx.drawImage(s, x - w.s * 1.6, view.h - w.s * 0.45, w.s * 3.2, w.s * 0.9);
      }
      ctx.globalAlpha = 1;
    }
    screenGrad(ctx, view, [[0, 'rgba(255,240,220,0.08)'], [0.5, 'rgba(255,230,200,0)'], [1, 'rgba(120,80,60,0.1)']]);
    vignette(ctx, view, '70,50,80', 0.35);
  },

  impact(S, x, y, p) {
    burst(S, S.n(Math.round(4 + p * 8)), (R) => ({
      k: 'puff', rgb: '245,238,228', x: x + R.range(-50, 50), y: -R.range(0, 20), vx: R.range(-110, 110), vy: -R.range(10, 60), drag: 2.5,
      life: R.range(0.7, 1.3), s: R.range(16, 32), grow: 45, a: 0.6,
    }));
    burst(S, S.n(Math.round(6 + p * 10)), (R) => ({
      k: 'glow', rgb: '255,215,120', x: x + R.range(-40, 40), y: y + R.range(-30, 10), vx: R.range(-140, 140), vy: -R.range(60, 220), g: 120, drag: 1.5,
      life: R.range(0.6, 1.3), s: R.range(5, 10), a: 0.9, front: R() < 0.3,
    }));
    burst(S, S.n(Math.round(3 + p * 5)), (R) => ({
      k: 'chip', c: R.pick(['#f4ecdf', '#e0d2c0', '#d4a94f']), x: x + R.range(-20, 20), y: -2, vx: R.range(-200, 200), vy: -R.range(100, 280),
      g: 1100, life: R.range(0.6, 1.1), s: R.range(2, 4), rot: R() * TAU, vr: R.range(-10, 10), fy: R.range(0, 30), bounce: 0.35,
    }));
    if (p > 0.25) {
      for (const d of S.doves) {
        if (d.st !== 0) continue;
        const dx = mod(d.x - x + 1500, 3000) - 1500;
        if (Math.abs(dx) > 1100) continue;
        d.st = 1; d.t = 0; d.dir = dx >= 0 ? 1 : -1;
        d.vx = d.dir * S.rng.range(140, 260); d.vy = -S.rng.range(120, 220);
      }
    }
  },
};

// ═════════════════════════════════════════════════════════════════════════
// 7. Moonlit Necropolis
// ═════════════════════════════════════════════════════════════════════════

const NECRO_SKY = [[0, '#04050b'], [0.35, '#0a1020'], [0.6, '#141f36'], [0.8, '#203547'], [0.92, '#2c4d4e'], [1, '#36625a']];

// Gnarled, leafless tree: wobbling tapered branches with a moonlit rim on one side.
function gnarledTree(res, R, w, h) {
  return makeSprite(w, h, w / 2, h, res, (g) => {
    const segs = [];
    const branch = (x, y, ang, len, wid, depth) => {
      let cx = x, cy = y, a = ang;
      const n = 4;
      for (let i = 0; i < n; i++) {
        a += R.range(-0.35, 0.35);
        const nx = cx + Math.cos(a) * (len / n), ny = cy + Math.sin(a) * (len / n);
        const w0 = wid * (1 - (i / n) * 0.35), w1 = wid * (1 - ((i + 1) / n) * 0.35);
        segs.push([cx, cy, nx, ny, (w0 + w1) / 2]);
        cx = nx; cy = ny;
      }
      if (depth <= 0 || wid < 1.6) return;
      const k = depth > 3 ? 2 : R.int(2, 3);
      for (let i = 0; i < k; i++) {
        const spread = (i - (k - 1) / 2) * R.range(0.5, 0.9);
        branch(cx, cy, a + spread + R.range(-0.2, 0.2), len * R.range(0.62, 0.8), wid * 0.62, depth - 1);
      }
    };
    branch(0, 0, -Math.PI / 2 + R.range(-0.2, 0.2), h * 0.26, w * 0.07, 6);
    for (let i = 0; i < 4; i++) {
      const s = i < 2 ? -1 : 1;
      segs.push([0, -10, s * R.range(30, 70), R.range(-4, 2), w * 0.03], [s * 50, 0, s * R.range(80, 110), 6, w * 0.015]);
    }
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(150,190,180,0.45)';
    for (const [x0, y0, x1, y1, lw] of segs) {
      g.lineWidth = lw;
      g.beginPath(); g.moveTo(x0 + lw * 0.22, y0 - lw * 0.1); g.lineTo(x1 + lw * 0.22, y1 - lw * 0.1); g.stroke();
    }
    g.strokeStyle = '#090d14';
    for (const [x0, y0, x1, y1, lw] of segs) {
      g.lineWidth = lw;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    }
  });
}

function drawBat(ctx, x, y, s, flap) {
  const wy = flap * 10 * s;
  ctx.beginPath();
  ctx.moveTo(x, y - 2 * s);
  ctx.quadraticCurveTo(x - 8 * s, y - 6 * s - wy, x - 18 * s, y - 2 * s - wy * 1.4);
  ctx.lineTo(x - 13 * s, y + 1 * s - wy * 0.5); ctx.lineTo(x - 9 * s, y - 1 * s - wy * 0.3); ctx.lineTo(x - 5 * s, y + 2 * s);
  ctx.lineTo(x, y + 4 * s);
  ctx.lineTo(x + 5 * s, y + 2 * s); ctx.lineTo(x + 9 * s, y - 1 * s - wy * 0.3); ctx.lineTo(x + 13 * s, y + 1 * s - wy * 0.5);
  ctx.lineTo(x + 18 * s, y - 2 * s - wy * 1.4);
  ctx.quadraticCurveTo(x + 8 * s, y - 6 * s - wy, x, y - 2 * s);
  ctx.moveTo(x - 2 * s, y - 3 * s); ctx.lineTo(x - 3 * s, y - 7 * s); ctx.lineTo(x, y - 4 * s); ctx.lineTo(x + 3 * s, y - 7 * s); ctx.lineTo(x + 2 * s, y - 3 * s);
}

function fogTile(R, w, h, res, rgb) {
  return makeTileT(w, h, res, (g) => {
    for (let i = 0; i < 46; i++) {
      const x = R() * w, y = R.range(h * 0.35, h * 0.75), rw = R.range(120, 300), rh = R.range(26, 60);
      wrap(w, x, (xx) => {
        g.save();
        g.translate(xx, y);
        g.scale(rw / rh, 1);
        g.fillStyle = rad(g, 0, 0, 0, rh, [[0, `rgba(${rgb},0.55)`], [0.6, `rgba(${rgb},0.25)`], [1, `rgba(${rgb},0)`]]);
        g.fillRect(-rh, -rh, rh * 2, rh * 2);
        g.restore();
      });
    }
  });
}

IMPL.necropolis = {
  build(S) {
    const R = S.rng, res = S.res;
    S.stars = makeTileT(2400, 560, res * 0.5, (g, w, h) => {
      for (let i = 0; i < 300; i++) {
        const x = R() * w, y = Math.pow(R(), 1.6) * h;
        g.fillStyle = `rgba(220,235,255,${R.range(0.2, 0.7)})`;
        wrap(w, x, (xx) => g.fillRect(xx, y, R() < 0.9 ? 1.2 : 2, R() < 0.9 ? 1.2 : 2));
      }
    });
    S.moon = makeSprite(300, 300, 150, 150, res * 0.6, (g) => {
      g.fillStyle = rad(g, -30, -30, 10, 125, [[0, '#fbf9e8'], [0.75, '#e8e5cc'], [1, '#cfcdb4']]);
      g.beginPath(); g.arc(0, 0, 120, 0, TAU); g.fill();
      g.save();
      g.beginPath(); g.arc(0, 0, 120, 0, TAU); g.clip();
      for (const [x, y, rx, ry] of [[-30, -20, 55, 38], [40, 30, 40, 30], [10, -60, 28, 20], [-50, 50, 30, 22]]) {
        g.save();
        g.translate(x, y);
        g.scale(rx / ry, 1);
        g.fillStyle = rad(g, 0, 0, 0, ry, [[0, 'rgba(150,160,150,0.28)'], [0.7, 'rgba(150,160,150,0.18)'], [1, 'rgba(150,160,150,0)']]);
        g.beginPath(); g.arc(0, 0, ry, 0, TAU); g.fill();
        g.restore();
      }
      for (let i = 0; i < 16; i++) {
        const a = R() * TAU, d = Math.sqrt(R()) * 100, r = R.range(4, 12);
        const x = Math.cos(a) * d, y = Math.sin(a) * d;
        g.fillStyle = rad(g, x + r * 0.2, y + r * 0.2, 0, r, [[0, 'rgba(140,145,130,0.3)'], [0.8, 'rgba(140,145,130,0.18)'], [1, 'rgba(140,145,130,0)']]);
        g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
      }
      g.fillStyle = rad(g, 0, 0, 80, 122, [[0, 'rgba(120,130,120,0)'], [1, 'rgba(120,130,120,0.35)']]);
      g.fillRect(-120, -120, 240, 240);
      g.restore();
    });
    S.clouds = makeTileT(2400, 420, res * 0.25, (g, w) => {
      for (let i = 0; i < 12; i++) {
        const x = R() * w, y = R.range(60, 380), cw = R.range(220, 520), ch = R.range(12, 26);
        wrap(w, x, (xx) => {
          g.fillStyle = lin(g, 0, y - ch * 1.4, 0, y + ch, [[0, 'rgba(170,200,195,0.45)'], [0.35, 'rgba(40,52,66,0.85)'], [1, 'rgba(20,28,40,0.7)']]);
          g.beginPath();
          g.ellipse(xx, y, cw, ch, 0, 0, TAU);
          g.ellipse(xx - cw * 0.3, y - ch * 0.7, cw * 0.45, ch * 0.9, 0, 0, TAU);
          g.ellipse(xx + cw * 0.35, y - ch * 0.5, cw * 0.35, ch * 0.8, 0, 0, TAU);
          g.fill();
        });
      }
    });
    S.far = makeTile(2400, 460, res * 0.5, (g, w, h) => {
      const f = pfbm(R, [[4, 40], [12, 16], [40, 5]]);
      const hy = (x) => h - (110 + f(x / w));
      const col = '#111a29';
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(-8, h);
      for (let x = -8; x <= w + 8; x += 4) g.lineTo(x, hy(x));
      g.lineTo(w + 8, h);
      g.fill();
      // Gothic cathedral silhouette
      wrap(w, 900, (cx) => {
        const by = hy(900) + 10;
        g.fillStyle = col;
        g.fillRect(cx - 150, by - 170, 300, 170);
        for (const [tx, tw, th] of [[-150, 50, 290], [100, 50, 290], [-30, 60, 230], [-220, 40, 200], [190, 40, 200]]) {
          g.fillRect(cx + tx, by - th, tw, th);
          g.beginPath(); g.moveTo(cx + tx - 4, by - th); g.lineTo(cx + tx + tw / 2, by - th - tw * 1.6); g.lineTo(cx + tx + tw + 4, by - th); g.fill();
        }
        g.fillStyle = 'rgba(150,255,190,0.45)';
        for (const [wx, wy] of [[-130, 200], [120, 210], [-8, 150], [-60, 100], [50, 110]]) {
          g.beginPath(); g.moveTo(cx + wx, by - wy); g.lineTo(cx + wx + 5, by - wy - 10); g.lineTo(cx + wx + 10, by - wy); g.lineTo(cx + wx + 10, by - wy + 14); g.lineTo(cx + wx, by - wy + 14); g.fill();
        }
        g.fillStyle = 'rgba(150,255,190,0.3)';
        g.beginPath(); g.arc(cx + 2, by - 130, 14, 0, TAU); g.fill();
      });
      g.fillStyle = lin(g, 0, h - 120, 0, h, [[0, 'rgba(54,98,90,0)'], [1, 'rgba(54,98,90,0.6)']]);
      g.fillRect(-8, h - 120, w + 16, 120);
    });
    S.mid = makeTile(2400, 320, res * 0.5, (g, w, h) => {
      const f = pfbm(R, [[5, 24], [17, 9]]);
      const hy = (x) => h - (60 + f(x / w));
      const col = '#0b111b';
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(-8, h);
      for (let x = -8; x <= w + 8; x += 4) g.lineTo(x, hy(x));
      g.lineTo(w + 8, h);
      g.fill();
      for (let i = 0; i < 9; i++) {
        const x = R() * w, kind = R.int(0, 2), s = R.range(0.8, 1.3);
        wrap(w, x, (xx) => {
          const by = hy(x) + 6;
          g.fillStyle = col;
          if (kind === 0) {
            g.fillRect(xx - 50 * s, by - 90 * s, 100 * s, 90 * s);
            g.beginPath(); g.moveTo(xx - 60 * s, by - 90 * s); g.lineTo(xx, by - 130 * s); g.lineTo(xx + 60 * s, by - 90 * s); g.fill();
            g.fillRect(xx - 3 * s, by - 160 * s, 6 * s, 32 * s); g.fillRect(xx - 12 * s, by - 150 * s, 24 * s, 6 * s);
          } else if (kind === 1) {
            g.fillRect(xx - 5 * s, by - 110 * s, 10 * s, 110 * s); g.fillRect(xx - 26 * s, by - 86 * s, 52 * s, 10 * s);
          } else {
            g.fillRect(xx - 14 * s, by - 60 * s, 28 * s, 60 * s);
            g.beginPath(); g.moveTo(xx - 14 * s, by - 60 * s); g.lineTo(xx, by - 140 * s); g.lineTo(xx + 14 * s, by - 60 * s); g.fill();
          }
        });
      }
      g.fillStyle = lin(g, 0, h - 90, 0, h, [[0, 'rgba(40,70,70,0)'], [1, 'rgba(40,70,70,0.5)']]);
      g.fillRect(-8, h - 90, w + 16, 90);
    });
    S.trees = [
      { s: gnarledTree(res * 0.5, R, 760, 720), x: -620 },
      { s: gnarledTree(res * 0.5, R, 640, 640), x: 760 },
      { s: gnarledTree(res * 0.5, R, 700, 680), x: 2000 },
    ];
    // Gravestones + iron fence strip
    S.graves = makeTile(2400, 230, res * 0.75, (g, w, h) => {
      const stone = '#1b2330', rim = 'rgba(170,205,195,0.45)';
      for (let i = 0; i < 22; i++) {
        const x = R() * w, kind = R.int(0, 3), s = R.range(0.7, 1.2), tilt = R.range(-0.12, 0.12);
        wrap(w, x, (xx) => {
          g.save();
          g.translate(xx, h - 4);
          g.rotate(tilt);
          g.fillStyle = stone;
          g.beginPath();
          if (kind === 0) { g.moveTo(-18 * s, 0); g.lineTo(-18 * s, -50 * s); g.arc(0, -50 * s, 18 * s, Math.PI, 0); g.lineTo(18 * s, 0); }
          else if (kind === 1) { g.rect(-4 * s, -78 * s, 8 * s, 78 * s); g.rect(-20 * s, -60 * s, 40 * s, 8 * s); }
          else if (kind === 2) { g.moveTo(-12 * s, 0); g.lineTo(-8 * s, -95 * s); g.lineTo(0, -108 * s); g.lineTo(8 * s, -95 * s); g.lineTo(12 * s, 0); }
          else { g.rect(-26 * s, -34 * s, 52 * s, 34 * s); }
          g.fill();
          g.strokeStyle = rim;
          g.lineWidth = 1.5;
          g.stroke();
          g.restore();
        });
      }
      // iron fence segments
      g.strokeStyle = '#06090e';
      g.fillStyle = '#06090e';
      for (let seg = 0; seg < 2; seg++) {
        const sx = seg * 800 + 520, len = 420;
        g.lineWidth = 3;
        g.beginPath();
        for (let x = sx; x <= sx + len; x += 22) {
          g.moveTo(x, h); g.lineTo(x, h - 96);
        }
        g.moveTo(sx, h - 84); g.lineTo(sx + len, h - 84);
        g.moveTo(sx, h - 30); g.lineTo(sx + len, h - 30);
        g.stroke();
        g.beginPath();
        for (let x = sx; x <= sx + len; x += 22) { g.moveTo(x - 4, h - 96); g.lineTo(x, h - 106); g.lineTo(x + 4, h - 96); }
        g.fill();
        g.fillRect(sx - 7, h - 118, 14, 118);
        g.fillRect(sx + len - 7, h - 118, 14, 118);
      }
    });
    S.fog = fogTile(R, 2400, 220, res * 0.25, '160,200,190');
    S.flag = makeTileT(1600, 260, res * 0.5, (g, w, h) => {
      for (let i = 0; i < 70; i++) {
        const x = R() * w, y = R() * h, rw = R.range(20, 70);
        wrap(w, x, (xx) => {
          g.fillStyle = rad(g, xx, y, 0, rw, [[0, 'rgba(60,90,70,0.35)'], [1, 'rgba(60,90,70,0)']]);
          g.fillRect(xx - rw, y - rw, rw * 2, rw * 2);
        });
      }
      for (let i = 0; i < 600; i++) {
        g.fillStyle = `rgba(0,0,0,${R.range(0.1, 0.3)})`;
        const x = R() * w, y = R() * h;
        wrap(w, x, (xx) => g.fillRect(xx, y, R.range(1, 4), R.range(1, 2)));
      }
    });
    S.stones = [[], []];
    const rows = [0, 24, 54, 94, 146, 210, 290];
    for (let ri = 0; ri < rows.length - 1; ri++) {
      const r0 = rows[ri], r1 = rows[ri + 1];
      let u = R.range(0, 100);
      const start = u;
      while (u < start + 1600 - 80) {
        let wdt = R.range(110, 240);
        if (u + wdt > start + 1600 - 80) wdt = start + 1600 - u;
        const gap = 4 + ri, j = (a) => R.range(-a, a);
        if (R() < 0.85) {
          S.stones[R() < 0.5 ? 0 : 1].push([u + gap + j(6), r0 + gap + j(2), u + wdt - gap + j(6), r0 + gap + j(3), u + wdt - gap + j(8), r1 - gap + j(3), u + wdt * 0.5, r1 - gap + j(4), u + gap + j(8), r1 - gap + j(3)]);
        }
        u += wdt;
      }
    }
    S.wisps = Array.from({ length: S.hi ? 7 : 4 }, () => ({ x: S.frng.range(-1300, 1300), y: S.frng.range(-260, -50), vx: 0, vy: 0, ph: S.frng() * TAU, f: S.frng.range(0.2, 0.5), tr: [] }));
    S.bats = [];
    S.batT = 2;
    S.trT = 0;
  },

  update(S, dt) {
    const R = S.rng, t = S.t;
    S.batT -= dt;
    if (S.batT <= 0) {
      S.batT = R.range(7, 13);
      const dir = R() < 0.5 ? 1 : -1, p = R.range(0.12, 0.25), y = R.range(-560, -380);
      for (let i = 0; i < R.int(3, 6); i++) S.bats.push({ p, x: -dir * 1300 - dir * i * 50 + R.range(-30, 30), y: y + R.range(-40, 40), vx: dir * R.range(110, 160), vy: R.range(-10, 10), ph: R() * TAU, s: R.range(0.7, 1) });
    }
    for (let i = S.bats.length - 1; i >= 0; i--) {
      const b = S.bats[i];
      b.x += b.vx * dt;
      b.y += (b.vy + Math.sin(t * 3 + b.ph) * 30) * dt;
      if (Math.abs(b.x) > 1800 || b.y < -1400) S.bats.splice(i, 1);
    }
    S.trT -= dt;
    const rec = S.trT <= 0;
    if (rec) S.trT = 0.06;
    for (const w of S.wisps) {
      w.vx *= 1 / (1 + dt * 1.5);
      w.vy *= 1 / (1 + dt * 1.5);
      w.x += (Math.sin(t * w.f + w.ph) * 30 + w.vx) * dt;
      w.y += (Math.cos(t * w.f * 1.3 + w.ph) * 18 + w.vy) * dt;
      w.y = clamp(w.y, -380, -30);
      if (w.x > 1400) w.x -= 2800;
      if (w.x < -1400) w.x += 2800;
      if (rec) {
        w.tr.unshift(w.x, w.y);
        if (w.tr.length > 16) w.tr.length = 16;
      }
    }
  },

  back(ctx, S, cam, view) {
    const t = S.t;
    drawSky(ctx, cam, view, NECRO_SKY, -780, 0);
    let b = layer(ctx, cam, view, 0.02);
    drawTile(ctx, b, S.stars, -780);
    ctx.restore();
    b = layer(ctx, cam, view, 0.03);
    const mx = 330, my = -430;
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(ctx, '120,170,160', mx, my, 520, 0.35);
    drawGlow(ctx, '220,240,220', mx, my, 210, 0.35);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    drawSprite(ctx, S.moon, mx, my);
    ctx.restore();
    b = layer(ctx, cam, view, 0.05);
    drawTile(ctx, b, S.clouds, -720, t * 6);
    ctx.restore();
    // bats crossing the sky
    ctx.fillStyle = '#05070c';
    for (const bt of S.bats) {
      b = layer(ctx, cam, view, bt.p);
      ctx.beginPath();
      drawBat(ctx, bt.x, bt.y, bt.s * 1.3, Math.sin(t * 16 + bt.ph));
      ctx.fill();
      ctx.restore();
    }
    b = layer(ctx, cam, view, 0.1);
    drawTile(ctx, b, S.far, -460, 0, '#1f3a3c');
    ctx.restore();
    b = layer(ctx, cam, view, 0.22);
    ctx.globalAlpha = 0.5;
    drawTile(ctx, b, S.fog, -230, t * 8);
    ctx.globalAlpha = 1;
    drawTile(ctx, b, S.mid, -320, 0, '#1e3436');
    ctx.restore();
    b = layer(ctx, cam, view, 0.34);
    ctx.globalAlpha = 0.45;
    drawTile(ctx, b, S.fog, -180, -t * 12 + 700);
    ctx.globalAlpha = 1;
    ctx.restore();
    b = layer(ctx, cam, view, 0.44);
    drawInstances(ctx, b, S.trees, 3300);
    ctx.fillStyle = '#121e22';
    ctx.fillRect(b.x0 - 4, -1, b.x1 - b.x0 + 8, b.y1 + 4);
    ctx.restore();
    b = layer(ctx, cam, view, 0.62);
    drawTile(ctx, b, S.graves, -230, 0, '#141c22');
    ctx.globalAlpha = 0.5;
    drawTile(ctx, b, S.fog, -150, t * 15 + 300);
    ctx.globalAlpha = 1;
    ctx.restore();
    // will-o'-wisps
    b = layer(ctx, cam, view, 0.85);
    ctx.globalCompositeOperation = 'lighter';
    for (const w of S.wisps) {
      const fl = 0.75 + 0.25 * Math.sin(t * 7 + w.ph);
      eachCopy(w.x, 2800, b.x0, b.x1, 60, (x) => {
        const dx = x - w.x;
        for (let i = 2; i < w.tr.length; i += 2) {
          const k = 1 - i / w.tr.length;
          drawGlow(ctx, '90,255,170', w.tr[i] + dx, w.tr[i + 1], 10 * k + 3, 0.35 * k * fl);
        }
        drawGlow(ctx, '90,255,170', x, w.y, 46, 0.35 * fl);
        drawGlow(ctx, '220,255,235', x, w.y, 9, 0.9 * fl);
      });
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.restore();

    // Floor: sunken flagstones and damp earth
    const F = floorView(cam, view);
    if (F.gy < view.h) {
      floorBase(ctx, F, [[0, '#26333a'], [0.25, '#161f25'], [1, '#080b0e']]);
      const cols = ['#323e44', '#2a3539'];
      for (let gi = 0; gi < 2; gi++) {
        ctx.fillStyle = lin(ctx, 0, F.gy, 0, F.gy + 240 * F.z, [[0, mix(cols[gi], '#9fc7bf', 0.25)], [0.4, cols[gi]], [1, '#0d1215']]);
        ctx.beginPath();
        floorCopies(F, 1600, 0, 1700, (du) => {
          for (const pts of S.stones[gi]) if (pts[1] < F.rMax) floorPoly(ctx, F, pts, du);
        });
        ctx.fill();
      }
      floorTexture(ctx, F, S.flag, 1);
      ctx.globalCompositeOperation = 'lighter';
      const [msx] = layerToScreen(cam, view, 0.03, 330, -430);
      drawGlowE(ctx, '140,190,180', msx, F.gy + 30 * F.z, 520 * F.z, 90 * F.z, 0.22, 2);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(160,210,200,0.25)';
      ctx.fillRect(0, F.gy - 0.5, view.w, 1.5);
    }
  },

  front(ctx, S, cam, view) {
    const b = layer(ctx, cam, view, 1.25);
    ctx.globalAlpha = 0.2;
    drawTile(ctx, b, S.fog, -90, S.t * 22);
    ctx.globalAlpha = 1;
    ctx.restore();
    screenGrad(ctx, view, [[0, 'rgba(0,20,30,0.25)'], [0.5, 'rgba(0,30,30,0)'], [1, 'rgba(0,10,10,0.25)']]);
    vignette(ctx, view, '0,4,8', 0.7);
  },

  impact(S, x, y, p) {
    const R = S.rng;
    burst(S, S.n(Math.round(4 + p * 8)), (RR) => ({
      k: 'puff', rgb: '70,82,84', x: x + RR.range(-50, 50), y: -RR.range(0, 20), vx: RR.range(-100, 100), vy: -RR.range(10, 50), drag: 2.5,
      life: RR.range(0.8, 1.4), s: RR.range(16, 30), grow: 40, a: 0.55,
    }));
    burst(S, S.n(Math.round(2 + p * 4)), (RR) => ({
      k: 'puff', rgb: '150,195,185', x: x + RR.range(-120, 120), y: -RR.range(0, 30), vx: RR.range(-60, 60), vy: -RR.range(0, 20), drag: 1,
      life: RR.range(1.5, 2.5), s: RR.range(40, 70), grow: 30, a: 0.25, front: RR() < 0.5,
    }));
    burst(S, S.n(Math.round(3 + p * 5)), (RR) => ({
      k: 'chip', c: RR.pick(['#2a3539', '#3a464b']), x: x + RR.range(-20, 20), y: -2, vx: RR.range(-200, 200), vy: -RR.range(100, 280),
      g: 1100, life: RR.range(0.6, 1.1), s: RR.range(2, 5), rot: RR() * TAU, vr: RR.range(-10, 10), fy: RR.range(0, 30), bounce: 0.3,
    }));
    // startled bats burst out of the trees
    if (p > 0.3) {
      const tx = R() < 0.5 ? -620 : 760;
      for (let i = 0; i < Math.round(3 + p * 5); i++) {
        S.bats.push({ p: 0.44, x: tx + R.range(-120, 120), y: R.range(-520, -380), vx: R.range(-260, 260), vy: -R.range(120, 260), ph: R() * TAU, s: R.range(0.8, 1.1) });
      }
    }
    for (const w of S.wisps) {
      const dx = w.x - x;
      if (Math.abs(dx) < 600) { w.vx += Math.sign(dx || 1) * p * 260 * (1 - Math.abs(dx) / 600); w.vy -= p * 80; }
    }
  },
};

// ═════════════════════════════════════════════════════════════════════════
// 8. Iron Foundry
// ═════════════════════════════════════════════════════════════════════════

const FOUNDRY_SKY = [[0, '#0a0807'], [0.3, '#140e0c'], [0.6, '#22160f'], [0.85, '#3a2314'], [1, '#583118']];

function gearSprite(res, r, teeth, col) {
  const R0 = r + 14;
  return makeSprite(R0 * 2, R0 * 2, R0, R0, res, (g) => {
    const td = 12, n = teeth;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * TAU, a1 = ((i + 0.22) / n) * TAU, a2 = ((i + 0.5) / n) * TAU, a3 = ((i + 0.72) / n) * TAU;
      g.lineTo(Math.cos(a0) * r, Math.sin(a0) * r);
      g.lineTo(Math.cos(a1) * (r + td), Math.sin(a1) * (r + td));
      g.lineTo(Math.cos(a2) * (r + td), Math.sin(a2) * (r + td));
      g.lineTo(Math.cos(a3) * r, Math.sin(a3) * r);
    }
    g.closePath();
    g.fillStyle = rad(g, 0, 0, r * 0.2, r + td, [[0, mix(col, '#000000', 0.2)], [0.75, col], [0.92, mix(col, '#ffffff', 0.15)], [1, mix(col, '#000000', 0.3)]]);
    g.fill();
    g.globalCompositeOperation = 'destination-out';
    const holes = teeth > 14 ? 6 : 5;
    for (let i = 0; i < holes; i++) {
      const a = (i / holes) * TAU;
      g.beginPath();
      g.arc(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55, r * 0.22, 0, TAU);
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.lineWidth = 3;
    g.beginPath(); g.arc(0, 0, r * 0.84, 0, TAU); g.stroke();
    g.fillStyle = mix(col, '#ffffff', 0.12);
    g.beginPath(); g.arc(0, 0, r * 0.2, 0, TAU); g.fill();
    g.fillStyle = '#120c0a';
    g.beginPath(); g.arc(0, 0, r * 0.08, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.12)';
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; g.beginPath(); g.arc(Math.cos(a) * r * 0.14, Math.sin(a) * r * 0.14, 2.5, 0, TAU); g.fill(); }
  });
}

IMPL.foundry = {
  build(S) {
    const R = S.rng, res = S.res;
    // Far wall: steel frame, tall cold windows
    S.wall = makeTile(2400, 760, res * 0.5, (g, w, h) => {
      g.fillStyle = '#16100d';
      g.fillRect(-8, 0, w + 16, h);
      for (let i = 0; i < 4; i++) {
        const cx = (i + 0.5) * (w / 4);
        wrap(w, cx, (x) => {
          const top = 90, bot = 470, ww = 200;
          g.fillStyle = lin(g, 0, top, 0, bot, [[0, 'rgba(120,150,190,0.55)'], [1, 'rgba(70,90,120,0.35)']]);
          g.beginPath();
          g.moveTo(x - ww / 2, bot); g.lineTo(x - ww / 2, top + ww / 2); g.arc(x, top + ww / 2, ww / 2, Math.PI, 0); g.lineTo(x + ww / 2, bot);
          g.fill();
          g.strokeStyle = '#0e0a08';
          g.lineWidth = 6;
          g.beginPath();
          for (let k = 1; k < 4; k++) { g.moveTo(x - ww / 2 + (k * ww) / 4, top + 10); g.lineTo(x - ww / 2 + (k * ww) / 4, bot); }
          for (let y = top + ww / 2; y < bot; y += 48) { g.moveTo(x - ww / 2, y); g.lineTo(x + ww / 2, y); }
          g.stroke();
          g.fillStyle = 'rgba(0,0,0,0.35)';
          for (let k = 0; k < 5; k++) g.fillRect(x - ww / 2 + R.range(0, ww - 40), top + R.range(100, 330), 40, 40);
        });
      }
      g.fillStyle = '#0d0907';
      for (let x = 0; x < w; x += 300) wrap(w, x, (xx) => g.fillRect(xx - 16, 0, 32, h));
      g.strokeStyle = '#0d0907';
      g.lineWidth = 10;
      g.beginPath();
      g.moveTo(-8, 30); g.lineTo(w + 8, 30);
      g.moveTo(-8, 80); g.lineTo(w + 8, 80);
      for (let x = 0; x < w; x += 150) { g.moveTo(x, 30); g.lineTo(x + 75, 80); g.lineTo(x + 150, 30); }
      g.stroke();
      g.fillStyle = lin(g, 0, h - 320, 0, h, [[0, 'rgba(90,50,24,0)'], [1, 'rgba(90,50,24,0.9)']]);
      g.fillRect(-8, h - 320, w + 16, 320);
    });
    S.gears = [
      { s: gearSprite(res * 0.5, 170, 18, '#3a302b'), x: -560, y: -440, w: 0.22, p: 0.2 },
      { s: gearSprite(res * 0.5, 104, 11, '#3f3430'), x: -322, y: -300, w: -0.36, p: 0.2, a0: 0.15 },
      { s: gearSprite(res * 0.5, 210, 22, '#352c28'), x: 760, y: -420, w: -0.15, p: 0.2 },
      { s: gearSprite(res * 0.55, 120, 13, '#2e2622'), x: -1020, y: -560, w: 0.3, p: 0.34 },
      { s: gearSprite(res * 0.55, 150, 16, '#2e2622'), x: 1150, y: -600, w: -0.24, p: 0.34 },
    ];
    // Pipes with flanges, valves and gauges
    S.pipes = makeTile(2400, 620, res * 0.5, (g, w, h) => {
      const pipe = (x0, y0, x1, y1, r) => {
        const horiz = y0 === y1;
        g.fillStyle = horiz
          ? lin(g, 0, y0 - r, 0, y0 + r, [[0, '#3a2c24'], [0.3, '#54402f'], [0.7, '#241a15'], [1, '#150f0c']])
          : lin(g, x0 - r, 0, x0 + r, 0, [[0, '#241a15'], [0.35, '#47362a'], [1, '#150f0c']]);
        if (horiz) g.fillRect(x0, y0 - r, x1 - x0, r * 2); else g.fillRect(x0 - r, Math.min(y0, y1), r * 2, Math.abs(y1 - y0));
        g.fillStyle = '#20180f';
        if (horiz) for (let x = x0 + 60; x < x1; x += 170) { g.fillRect(x, y0 - r - 4, 10, r * 2 + 8); }
        else for (let y = Math.min(y0, y1) + 50; y < Math.max(y0, y1); y += 150) g.fillRect(x0 - r - 4, y, r * 2 + 8, 10);
      };
      pipe(-8, 120, w + 8, 120, 26);
      pipe(-8, 180, w + 8, 180, 14);
      for (let i = 0; i < 6; i++) {
        const x = (i + R.range(0.2, 0.8)) * (w / 6), r = R.range(10, 18), y1 = i % 3 === 0 ? h - R.range(0, 60) : R.range(300, 420);
        wrap(w, x, (xx) => {
          pipe(xx, 120, xx, y1, r);
          if (R() < 0.6) {
            g.strokeStyle = '#7a2a1a';
            g.lineWidth = 4;
            g.beginPath(); g.arc(xx, 250 + i * 10, 22, 0, TAU); g.stroke();
            g.beginPath(); g.moveTo(xx - 22, 250 + i * 10); g.lineTo(xx + 22, 250 + i * 10); g.moveTo(xx, 228 + i * 10); g.lineTo(xx, 272 + i * 10); g.stroke();
          }
        });
      }
      for (let i = 0; i < 3; i++) {
        const x = R() * w;
        wrap(w, x, (xx) => {
          g.fillStyle = '#1c1511';
          g.beginPath(); g.arc(xx, 150, 22, 0, TAU); g.fill();
          g.fillStyle = '#d8cdb4';
          g.beginPath(); g.arc(xx, 150, 16, 0, TAU); g.fill();
          g.strokeStyle = '#a02818'; g.lineWidth = 2;
          g.beginPath(); g.moveTo(xx, 150); g.lineTo(xx + 10, 142); g.stroke();
        });
      }
    });
    S.vents = [[-760, -470], [230, -470], [1010, -470]].map(([x, y]) => ({ x, y, t: R.range(0, 4), on: 0 }));
    S.steam = [];
    S.sparks = [];
    S.sparkT = 1;
    S.chains = [-760, -330, 420, 880].map((x) => ({ x, hang: R.range(330, 450), ang: 0, av: 0, ph: R() * TAU }));
    S.grime = makeTileT(1400, 260, res * 0.5, (g, w, h) => {
      for (let i = 0; i < 120; i++) {
        const x = R() * w, y = R() * h, rw = R.range(14, 60);
        wrap(w, x, (xx) => {
          g.fillStyle = rad(g, xx, y, 0, rw, [[0, `rgba(${R() < 0.5 ? '0,0,0' : '90,40,20'},0.3)`], [1, 'rgba(0,0,0,0)']]);
          g.fillRect(xx - rw, y - rw, rw * 2, rw * 2);
        });
      }
    });
    S.embers = makeField(S.frng, S.n(36), (p, r) => { p.d = r.range(0.3, 0.9); p.s = r.range(1.5, 3.5); p.vx = r.range(-10, 10); p.vy = -r.range(20, 60); p.tw = r.range(4, 9); });
    S.dust = makeField(S.frng, S.n(40), (p, r) => { p.d = r.range(0.2, 0.7); p.s = r.range(0.8, 1.8); p.vx = r.range(4, 12); p.vy = r.range(-4, 6); });
    S.flick = 1;
  },

  update(S, dt) {
    const R = S.rng, t = S.t;
    stepField(S.embers, dt, t, 15, 2);
    stepField(S.dust, dt, t, 4, 0.5);
    stepPendulums(S.chains, dt, 2.2, 0.35, t, 0.02);
    S.flick = R() < 0.01 ? 0.4 : Math.min(1, S.flick + dt * 3);
    for (const v of S.vents) {
      v.t -= dt;
      if (v.t <= 0) { v.on = R.range(0.6, 1.2); v.t = R.range(3, 7); }
      if (v.on > 0) {
        v.on -= dt;
        if (R() < dt * 30) S.steam.push({ x: v.x + R.range(-6, 6), y: v.y, vx: R.range(-15, 15), vy: -R.range(70, 120), s: R.range(14, 24), life: R.range(1.5, 2.6), m: 0 });
      }
    }
    for (let i = S.steam.length - 1; i >= 0; i--) {
      const p = S.steam[i];
      p.life -= dt; p.m += dt;
      if (p.life <= 0) { S.steam.splice(i, 1); continue; }
      p.vy *= 1 / (1 + dt * 1.2);
      p.x += (p.vx + Math.sin(t * 2 + p.s) * 10) * dt; p.y += p.vy * dt; p.s += dt * 30;
    }
    // welding spark showers from the catwalk
    S.sparkT -= dt;
    if (S.sparkT <= 0) { S.sparkT = R.range(2.5, 5); S.weld = R.range(0.6, 1.4); S.weldX = R.pick([-420, 300, 1150]); }
    if (S.weld > 0) {
      S.weld -= dt;
      const n = S.hi ? 3 : 1;
      for (let i = 0; i < n; i++) S.sparks.push({ x: S.weldX + R.range(-4, 4), y: -326, vx: R.range(-90, 90), vy: R.range(-120, 40), life: R.range(0.8, 1.5), b: 0 });
    }
    for (let i = S.sparks.length - 1; i >= 0; i--) {
      const p = S.sparks[i];
      p.life -= dt;
      if (p.life <= 0) { S.sparks[i] = S.sparks[S.sparks.length - 1]; S.sparks.pop(); continue; }
      p.vy += 900 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.y > 0 && p.vy > 0) { p.y = 0; p.vy *= -0.3; p.vx *= 0.6; }
    }
  },

  back(ctx, S, cam, view) {
    const t = S.t;
    drawSky(ctx, cam, view, FOUNDRY_SKY, -820, 0);
    let b = layer(ctx, cam, view, 0.1);
    drawTile(ctx, b, S.wall, -760, 0, '#5a3218');
    // cold light shafts from the windows
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) {
      eachCopy((i + 0.5) * 600, 2400, b.x0 - 500, b.x1, 300, (x) => {
        ctx.fillStyle = lin(ctx, 0, -560, 0, 0, [[0, 'rgba(120,160,220,0.13)'], [1, 'rgba(120,160,220,0)']]);
        ctx.beginPath();
        ctx.moveTo(x - 90, -560); ctx.lineTo(x + 90, -560); ctx.lineTo(x + 420, 0); ctx.lineTo(x + 120, 0);
        ctx.fill();
      });
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
    // rotating gears with warm under-light
    for (const gr of S.gears) {
      b = layer(ctx, cam, view, gr.p);
      const m = ctx.getTransform();
      eachCopy(gr.x, 3000, b.x0, b.x1, 260, (x) => {
        if (!gr.s) return;
        setLocal(ctx, m, x, gr.y, t * gr.w + (gr.a0 || 0), 1, 1);
        ctx.drawImage(gr.s.c, -gr.s.ax, -gr.s.ay, gr.s.w, gr.s.h);
        ctx.setTransform(m);
        ctx.globalCompositeOperation = 'lighter';
        drawGlowE(ctx, '255,110,40', x, gr.y + gr.s.ay * 0.7, gr.s.ax * 1.1, gr.s.ay * 0.5, 0.18, 2);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      });
      ctx.restore();
    }
    // molten pour from a ladle (right of centre)
    b = layer(ctx, cam, view, 0.3);
    eachCopy(400, 3000, b.x0, b.x1, 300, (x) => {
      const tilt = 0.5 + Math.sin(t * 0.3) * 0.04;
      ctx.strokeStyle = '#100b09';
      ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(x - 60, -900); ctx.lineTo(x - 50, -380); ctx.moveTo(x + 40, -900); ctx.lineTo(x + 50, -380); ctx.stroke();
      ctx.save();
      ctx.translate(x, -340);
      ctx.rotate(tilt);
      // bucket body, rim-lit by its own glow
      ctx.fillStyle = lin(ctx, -80, 0, 80, 0, [[0, '#1b1310'], [0.55, '#33251e'], [0.85, '#5a3420'], [1, '#8a4a22']]);
      ctx.beginPath();
      ctx.moveTo(-84, -60); ctx.lineTo(84, -60); ctx.lineTo(70, 40); ctx.quadraticCurveTo(0, 96, -70, 40);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-80, -30); ctx.lineTo(80, -30); ctx.moveTo(-74, 10); ctx.lineTo(74, 10); ctx.stroke();
      ctx.fillStyle = '#2a1f1a';
      ctx.fillRect(-98, -44, 16, 16);
      ctx.fillRect(82, -44, 16, 16);
      ctx.fillStyle = rad(ctx, 10, -62, 4, 84, [[0, '#fff2c0'], [0.5, '#ffb347'], [1, '#e2571c']]);
      ctx.beginPath(); ctx.ellipse(0, -62, 84, 12, 0, 0, TAU); ctx.fill();
      ctx.restore();
      const lipX = x + Math.cos(tilt) * 80 - Math.sin(tilt) * -62, lipY = -340 + Math.sin(tilt) * 80 + Math.cos(tilt) * -62;
      ctx.globalCompositeOperation = 'lighter';
      drawGlowE(ctx, '255,120,30', lipX, -170, 120, 230, 0.45 * S.flick, 1);
      const wob = Math.sin(t * 13) * 2;
      ctx.fillStyle = lin(ctx, 0, lipY, 0, 0, [[0, 'rgba(255,230,150,0.95)'], [1, 'rgba(255,140,40,0.9)']]);
      ctx.beginPath();
      ctx.moveTo(lipX - 3, lipY); ctx.quadraticCurveTo(lipX + 14, lipY + 40, lipX + 10 + wob, -60); ctx.lineTo(lipX + 22 + wob, 0); ctx.lineTo(lipX - 4 - wob, 0); ctx.quadraticCurveTo(lipX + 2, -80, lipX + 5, lipY + 30);
      ctx.fill();
      drawGlowE(ctx, '255,150,50', lipX + 10, -10, 160, 40, 0.7 * S.flick, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    });
    // molten channel along the back
    ctx.fillStyle = lin(ctx, 0, -18, 0, 0, [[0, '#ff9b3a'], [0.5, '#ffd27a'], [1, '#c2410f']]);
    ctx.fillRect(b.x0 - 4, -16, b.x1 - b.x0 + 8, 16);
    ctx.fillStyle = '#120c0a';
    ctx.fillRect(b.x0 - 4, 0, b.x1 - b.x0 + 8, b.y1 + 4);
    ctx.globalCompositeOperation = 'lighter';
    drawGlowE(ctx, '255,110,30', cam.x * 0.3, -10, (b.x1 - b.x0) * 0.7, 70, 0.4, 2);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.restore();
    // pipes + steam
    b = layer(ctx, cam, view, 0.46);
    drawTile(ctx, b, S.pipes, -620);
    for (const p of S.steam) {
      const a = Math.min(1, p.m * 3) * Math.min(1, p.life * 0.6) * 0.45;
      drawGlow(ctx, '200,190,180', p.x, p.y, p.s, a, 1);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    // catwalk with lamps
    b = layer(ctx, cam, view, 0.64);
    ctx.fillStyle = '#120d0b';
    ctx.fillRect(b.x0 - 4, -340, b.x1 - b.x0 + 8, 7);
    ctx.fillRect(b.x0 - 4, -310, b.x1 - b.x0 + 8, 5);
    ctx.strokeStyle = '#120d0b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    eachCopy(0, 50, b.x0, b.x1, 50, (x) => { ctx.moveTo(x, -335); ctx.lineTo(x + 25, -310); ctx.lineTo(x + 50, -335); });
    eachCopy(0, 120, b.x0, b.x1, 10, (x) => { ctx.moveTo(x, -340); ctx.lineTo(x, -392); });
    ctx.moveTo(b.x0 - 4, -392); ctx.lineTo(b.x1 + 4, -392);
    ctx.stroke();
    ctx.fillStyle = '#100b09';
    eachCopy(-600, 1200, b.x0, b.x1, 30, (x) => ctx.fillRect(x - 12, -306, 24, 306));
    ctx.globalCompositeOperation = 'lighter';
    eachCopy(-300, 600, b.x0, b.x1, 400, (x) => {
      const fl = S.flick * (0.92 + 0.08 * Math.sin(t * 50 + x));
      ctx.fillStyle = lin(ctx, 0, -300, 0, 0, [[0, `rgba(255,200,120,${0.16 * fl})`], [1, 'rgba(255,200,120,0)']]);
      ctx.beginPath(); ctx.moveTo(x - 12, -296); ctx.lineTo(x + 12, -296); ctx.lineTo(x + 170, 0); ctx.lineTo(x - 170, 0); ctx.fill();
      drawGlow(ctx, '255,210,140', x, -296, 40, 0.8 * fl);
    });
    // welding sparks
    if (S.weld > 0) eachCopy(S.weldX, 3000, b.x0, b.x1, 60, (x) => drawGlow(ctx, '200,230,255', x, -326, 60 + Math.sin(t * 90) * 15, 0.8));
    ctx.strokeStyle = 'rgba(255,220,140,0.9)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (const p of S.sparks) { ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02); }
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#100b09';
    eachCopy(-300, 600, b.x0, b.x1, 30, (x) => { ctx.fillRect(x - 3, -306, 6, 6); ctx.beginPath(); ctx.moveTo(x - 16, -290); ctx.lineTo(x - 8, -300); ctx.lineTo(x + 8, -300); ctx.lineTo(x + 16, -290); ctx.fill(); });
    ctx.restore();
    drawDotField(ctx, S.dust, cam, view, '#d9b48a', 0.35);
    drawGlowField(ctx, S.embers, cam, view, '255,150,60', t, 1, 0.8);
    // hanging chains with hooks
    b = layer(ctx, cam, view, 0.9);
    ctx.strokeStyle = '#1a1310';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (const c of S.chains) {
      eachCopy(c.x, 2400, b.x0, b.x1, 200, (x) => {
        const top = -1300, sn = Math.sin(c.ang), cs = Math.cos(c.ang);
        const len = -top - c.hang;
        for (let d = 0; d < len; d += 13) {
          const px = x - sn * d, py = top + cs * d;
          if (py < b.y0 - 20) continue;
          if ((d / 13) & 1) { ctx.moveTo(px + 1.5, py); ctx.lineTo(px - 1.5, py + 12); }
          else { ctx.moveTo(px + 4, py + 6); ctx.ellipse(px, py + 6, 4, 7, -c.ang, 0, TAU); }
        }
        const hx = x - sn * len, hy = top + cs * len;
        ctx.moveTo(hx, hy); ctx.lineTo(hx, hy + 14);
        ctx.moveTo(hx + 8, hy + 22); ctx.arc(hx, hy + 22, 8, 0, Math.PI * 0.95);
      });
    }
    ctx.stroke();
    ctx.restore();

    // Floor: steel grate over a glowing pit
    const F = floorView(cam, view);
    if (F.gy < view.h) {
      floorBase(ctx, F, [[0, '#7a3a14'], [0.2, '#55250d'], [0.6, '#2c1309'], [1, '#120806']]);
      ctx.strokeStyle = '#17110e';
      ctx.lineWidth = 3.4 * F.z;
      ctx.beginPath();
      floorRays(ctx, F, 30, 0, 14);
      for (let r = 22; r < F.rMax; r += 10 + r * 0.08) { ctx.moveTo(0, fY(F, r)); ctx.lineTo(view.w, fY(F, r)); }
      ctx.stroke();
      ctx.strokeStyle = '#2a201b';
      ctx.lineWidth = 7 * F.z;
      ctx.beginPath();
      floorRays(ctx, F, 240, 0, 14);
      for (const r of [60, 140, 250]) if (r < F.rMax) { ctx.moveTo(0, fY(F, r)); ctx.lineTo(view.w, fY(F, r)); }
      ctx.stroke();
      // solid diamond-plate edge strip at the back
      const y0 = F.gy, y1 = fY(F, 14);
      ctx.fillStyle = lin(ctx, 0, y0, 0, y1, [[0, '#6a5a4e'], [0.3, '#3d322b'], [1, '#2a221d']]);
      ctx.fillRect(0, y0, view.w, y1 - y0);
      floorTexture(ctx, F, S.grime, 1);
      ctx.fillStyle = 'rgba(255,190,120,0.45)';
      ctx.fillRect(0, F.gy - 0.5, view.w, 1.5);
      ctx.fillStyle = lin(ctx, 0, F.gy, 0, view.h, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.3)']]);
      ctx.fillRect(0, F.gy, view.w, view.h - F.gy);
    }
  },

  front(ctx, S, cam, view) {
    screenGrad(ctx, view, [[0, 'rgba(10,5,0,0.3)'], [0.5, 'rgba(40,15,0,0)'], [1, 'rgba(80,30,0,0.15)']]);
    vignette(ctx, view, '10,4,0', 0.65);
  },

  impact(S, x, y, p) {
    kickPendulums(S.chains, x, p, 400, 0.7, 2400);
    burst(S, S.n(Math.round(14 + p * 26)), (R) => ({
      k: 'spark', c: R.pick(['rgba(255,220,140,0.95)', 'rgba(255,170,70,0.95)', 'rgba(255,250,210,0.95)']), x: x + R.range(-20, 20), y: y + R.range(-20, 10),
      vx: R.range(-420, 420), vy: -R.range(150, 520) * (0.5 + p), g: 1300, life: R.range(0.4, 0.9), s: R.range(1.2, 2.4), a: 1,
      fy: R.range(0, 40), bounce: 0.35, front: R() < 0.4,
    }));
    burst(S, S.n(Math.round(3 + p * 5)), (R) => ({
      k: 'puff', rgb: '90,70,60', x: x + R.range(-50, 50), y: -R.range(0, 20), vx: R.range(-90, 90), vy: -R.range(10, 50), drag: 2.5,
      life: R.range(0.7, 1.2), s: R.range(16, 30), grow: 40, a: 0.45,
    }));
    addDebris(S, { k: 'flash', rgb: '255,170,80', x, y: Math.min(-10, y), life: 0.25, s: 120 + p * 80, a: 0.7 });
  },
};

// ═════════════════════════════════════════════════════════════════════════
// 9. The Void
// ═════════════════════════════════════════════════════════════════════════

const VOID_SKY = [[0, '#030108'], [0.4, '#0b0420'], [0.7, '#190837'], [0.9, '#290c49'], [1, '#381056']];

// Unit polyhedra for the floating shards: [vertices, faces].
const SHARD_SHAPES = [
  // elongated octahedron (crystal)
  [[[0, -1.8, 0], [1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 0, -1], [0, 1.4, 0]],
    [[0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 1], [5, 2, 1], [5, 3, 2], [5, 4, 3], [5, 1, 4]]],
  // tetrahedron
  [[[1, 1, 1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1]], [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]]],
  // octahedron
  [[[0, -1.2, 0], [1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 0, -1], [0, 1.2, 0]],
    [[0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 1], [5, 2, 1], [5, 3, 2], [5, 4, 3], [5, 1, 4]]],
];

function drawShard(ctx, sh, x, y, s, t) {
  const [V, Fc] = SHARD_SHAPES[sh.shape];
  const ax = t * sh.rx + sh.p0, ay = t * sh.ry + sh.p1, az = sh.p2;
  const ca = Math.cos(ax), sa = Math.sin(ax), cb = Math.cos(ay), sb = Math.sin(ay), cc = Math.cos(az), sc = Math.sin(az);
  const P = _shardBuf;
  for (let i = 0; i < V.length; i++) {
    let [vx, vy, vz] = V[i];
    let y1 = vy * ca - vz * sa, z1 = vy * sa + vz * ca;
    let x2 = vx * cb + z1 * sb, z2 = -vx * sb + z1 * cb;
    const x3 = x2 * cc - y1 * sc, y3 = x2 * sc + y1 * cc;
    P[i * 3] = x + x3 * s; P[i * 3 + 1] = y + y3 * s; P[i * 3 + 2] = z2;
  }
  // painter's sort (far faces first), flat shading from a fixed light
  const order = _shardOrder;
  order.length = 0;
  for (let k = 0; k < Fc.length; k++) {
    const f = Fc[k];
    order.push(k, P[f[0] * 3 + 2] + P[f[1] * 3 + 2] + P[f[2] * 3 + 2]);
  }
  const idx = [];
  for (let k = 0; k < order.length; k += 2) idx.push(k);
  idx.sort((a, b) => order[a + 1] - order[b + 1]);
  for (const k of idx) {
    const f = Fc[order[k]];
    const i0 = f[0] * 3, i1 = f[1] * 3, i2 = f[2] * 3;
    const ux = (P[i1] - P[i0]) / s, uy = (P[i1 + 1] - P[i0 + 1]) / s, uz = P[i1 + 2] - P[i0 + 2];
    const vx = (P[i2] - P[i0]) / s, vy = (P[i2 + 1] - P[i0 + 1]) / s, vz = P[i2 + 2] - P[i0 + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const l = clamp(0.2 + 0.8 * ((nx * -0.45 + ny * -0.6 + nz * 0.66) / nl), 0.08, 1);
    ctx.fillStyle = `rgb(${Math.round(40 + 160 * l)},${Math.round(18 + 100 * l)},${Math.round(90 + 165 * l)})`;
    ctx.beginPath();
    ctx.moveTo(P[i0], P[i0 + 1]); ctx.lineTo(P[i1], P[i1 + 1]); ctx.lineTo(P[i2], P[i2 + 1]);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}
const _shardOrder = [];
const _shardBuf = new Float32Array(32);

IMPL.void = {
  build(S) {
    const R = S.rng, res = S.res;
    const blobs = (g, w, h, n, cols, rMin, rMax, a) => {
      for (let i = 0; i < n; i++) {
        const x = R() * w, y = R.range(h * 0.1, h * 0.95), r = R.range(rMin, rMax), c = R.pick(cols);
        wrap(w, x, (xx) => {
          g.fillStyle = rad(g, xx, y, 0, r, [[0, `rgba(${c},${a})`], [0.5, `rgba(${c},${a * 0.45})`], [1, `rgba(${c},0)`]]);
          g.fillRect(xx - r, y - r, r * 2, r * 2);
        });
      }
    };
    S.neb1 = makeTileT(2400, 820, res * 0.15, (g, w, h) => blobs(g, w, h, 40, ['120,40,220', '60,30,180', '200,40,160'], 160, 380, 0.35));
    S.neb2 = makeTileT(2400, 820, res * 0.15, (g, w, h) => blobs(g, w, h, 30, ['255,70,200', '60,190,255', '150,70,255'], 90, 240, 0.28));
    S.stars = makeTileT(2400, 820, res * 0.5, (g, w, h) => {
      for (let i = 0; i < 520; i++) {
        const x = R() * w, y = R() * h, s = R() < 0.9 ? R.range(0.6, 1.3) : R.range(1.6, 2.4);
        g.fillStyle = `rgba(${R.pick(['255,255,255', '220,200,255', '190,230,255'])},${R.range(0.3, 0.95)})`;
        wrap(w, x, (xx) => { g.beginPath(); g.arc(xx, y, s, 0, TAU); g.fill(); });
      }
    });
    S.tw = Array.from({ length: S.n(36) }, () => ({ x: S.frng.range(-1200, 1200), y: S.frng.range(-800, -120), s: S.frng.range(1.4, 2.6), ph: S.frng() * TAU, f: S.frng.range(1, 3) }));
    // accretion swirl around the rift
    S.swirl = makeSprite(900, 900, 450, 450, res * 0.3, (g) => {
      for (let arm = 0; arm < 3; arm++) {
        for (let i = 0; i < 160; i++) {
          const k = i / 160, a = arm * (TAU / 3) + k * 5.2, r = 60 + k * 380;
          const x = Math.cos(a) * r, y = Math.sin(a) * r * 0.55, rr = 14 + k * 46;
          const c = k < 0.5 ? '200,120,255' : '120,90,255';
          g.fillStyle = rad(g, x, y, 0, rr, [[0, `rgba(${c},${0.12 * (1 - k)})`], [1, `rgba(${c},0)`]]);
          g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
        }
      }
    });
    S.shards = [];
    const place = [
      [0.1, -420, -560, 16], [0.11, 380, -620, 14], [0.13, 560, -330, 20], [0.15, -620, -300, 22], [0.17, -260, -680, 12],
      [0.2, 860, -520, 28], [0.24, -900, -560, 30], [0.3, 300, -470, 24], [0.34, -420, -440, 26],
      [0.5, -760, -600, 40], [0.55, 820, -640, 44], [0.62, -1250, -320, 40], [0.66, 1300, -300, 44],
    ];
    for (const [p, x, y, s] of place) {
      S.shards.push({ p, x, y, s, shape: R.int(0, 2), rx: R.range(-0.5, 0.5), ry: R.range(0.2, 0.7), p0: R() * TAU, p1: R() * TAU, p2: R.range(-0.4, 0.4), ph: R() * TAU });
    }
    S.shards.sort((a, b) => a.p - b.p);
    // crystal clusters near the arena edges
    S.crystals = [-780, 820, 2300].map((x) => ({
      x,
      s: makeSprite(320, 300, 160, 300, res * 0.6, (g) => {
        for (let i = 0; i < 7; i++) {
          const bx = R.range(-100, 100), bw = R.range(14, 30), bh = R.range(90, 280) * (1 - Math.abs(bx) / 180), tx = bx + R.range(-0.5, 0.5) * bh * 0.4;
          g.fillStyle = lin(g, bx - bw, 0, bx + bw, 0, [[0, '#2a1250'], [0.45, '#7b4dd6'], [0.55, '#4b2a96'], [1, '#1a0a34']]);
          g.beginPath(); g.moveTo(bx - bw, 0); g.lineTo(tx, -bh); g.lineTo(bx + bw, 0); g.fill();
          g.strokeStyle = 'rgba(210,170,255,0.7)';
          g.lineWidth = 1.5;
          g.beginPath(); g.moveTo(bx - bw, 0); g.lineTo(tx, -bh); g.lineTo(bx + bw, 0); g.moveTo(tx, -bh); g.lineTo(bx, 0); g.stroke();
        }
      }),
    }));
    // floor facet lattice rows
    S.rows = [0, 18, 42, 74, 116, 170, 240, 330];
    S.motes = makeField(S.frng, S.n(60), (p, r) => { p.d = r.range(0.3, 0.9); p.s = r.range(1.5, 3.5); p.vx = r.range(-8, 8); p.vy = -r.range(10, 35); p.tw = r.range(1, 4); p.c = r() < 0.6 ? 0 : 1; });
    S.motesF = makeField(S.frng, S.n(10), (p, r) => { p.d = r.range(1.2, 1.5); p.s = r.range(5, 9); p.vx = r.range(-6, 6); p.vy = -r.range(15, 30); p.tw = r.range(1, 3); p.a = 0.6; });
    S.eye = { lx: 0, ly: 0, tx: 0, ty: 0, blink: 0, blinkT: 3, flare: 0, lookT: 0 };
    S.pulse = 0;
  },

  update(S, dt) {
    const R = S.rng, t = S.t, e = S.eye;
    stepField(S.motes, dt, t, 6, 0.8);
    stepField(S.motesF, dt, t, 8, 0.6);
    e.lookT -= dt;
    if (e.lookT <= 0) { e.tx = R.range(-1, 1); e.ty = R.range(-0.6, 0.6); e.lookT = R.range(1.5, 4); }
    e.lx += (e.tx - e.lx) * Math.min(1, dt * 4);
    e.ly += (e.ty - e.ly) * Math.min(1, dt * 4);
    e.blinkT -= dt;
    if (e.blinkT <= 0) { e.blink = 1; e.blinkT = R.range(4, 9); }
    e.blink = Math.max(0, e.blink - dt * 4);
    e.flare = Math.max(0, e.flare - dt * 1.5);
    S.pulse = (S.pulse + dt * 0.35) % 1;
  },

  back(ctx, S, cam, view) {
    const t = S.t, e = S.eye;
    drawSky(ctx, cam, view, VOID_SKY, -820, 0);
    let b = layer(ctx, cam, view, 0.02);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.8 + 0.2 * Math.sin(t * 0.3);
    drawTile(ctx, b, S.neb1, -820, t * 3);
    ctx.globalAlpha = 1;
    drawTile(ctx, b, S.stars, -820);
    ctx.fillStyle = '#ffffff';
    for (const s of S.tw) {
      eachCopy(s.x, 2400, b.x0, b.x1, 4, (x) => {
        ctx.globalAlpha = Math.max(0, Math.sin(t * s.f + s.ph)) ** 3;
        ctx.fillRect(x - s.s / 2, s.y - s.s / 2, s.s, s.s);
      });
    }
    ctx.restore();
    b = layer(ctx, cam, view, 0.05);
    ctx.globalAlpha = 0.75 + 0.25 * Math.sin(t * 0.21 + 1);
    drawTile(ctx, b, S.neb2, -820, -t * 6);
    ctx.globalAlpha = 1;
    // swirl + rift + eye
    const rx = 0, ry = -410;
    if (S.swirl) {
      const m = ctx.getTransform();
      ctx.globalAlpha = 0.85;
      setLocal(ctx, m, rx, ry, t * 0.06, 1, 1);
      ctx.drawImage(S.swirl.c, -S.swirl.ax, -S.swirl.ay, S.swirl.w, S.swirl.h);
      if (S.hi) {
        setLocal(ctx, m, rx, ry, -t * 0.035 + 1, 0.7, 0.7);
        ctx.drawImage(S.swirl.c, -S.swirl.ax, -S.swirl.ay, S.swirl.w, S.swirl.h);
      }
      ctx.setTransform(m);
    }
    const fl = 0.8 + 0.2 * Math.sin(t * 2.3) + e.flare;
    drawGlowE(ctx, '200,60,255', rx, ry, 260, 360, 0.45 * fl);
    drawGlowE(ctx, '255,90,200', rx, ry, 120, 260, 0.35 * fl);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    const open = 1 - Math.sin(Math.min(1, e.blink) * Math.PI);
    const H = 160, W = 58 * (0.08 + 0.92 * open);
    const rift = () => {
      ctx.beginPath();
      ctx.moveTo(rx, ry - H);
      ctx.bezierCurveTo(rx + W * 1.2, ry - H * 0.45, rx + W * 1.2, ry + H * 0.45, rx, ry + H);
      ctx.bezierCurveTo(rx - W * 1.2, ry + H * 0.45, rx - W * 1.2, ry - H * 0.45, rx, ry - H);
      ctx.closePath();
    };
    rift();
    ctx.fillStyle = rad(ctx, rx, ry, 10, H, [[0, '#2a0418'], [0.6, '#12020c'], [1, '#060008']]);
    ctx.fill();
    if (open > 0.15) {
      ctx.save();
      rift();
      ctx.clip();
      const ix = rx + e.lx * W * 0.45, iy = ry + e.ly * 50;
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(ctx, '255,120,60', ix, iy, 120, 0.45 * fl);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = rad(ctx, ix, iy, 4, 44, [[0, '#ffe9a0'], [0.35, '#ffb02e'], [0.7, '#d2422a'], [1, '#5a0c3a']]);
      ctx.beginPath(); ctx.arc(ix, iy, 44, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(90,10,40,0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < 18; i++) { const a = (i / 18) * TAU; ctx.moveTo(ix + Math.cos(a) * 14, iy + Math.sin(a) * 14); ctx.lineTo(ix + Math.cos(a) * 40, iy + Math.sin(a) * 40); }
      ctx.stroke();
      const pw = 7 + 5 * (1 - fl * 0.5);
      ctx.fillStyle = '#0a0005';
      ctx.beginPath(); ctx.ellipse(ix, iy, pw * 0.85, 34, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath(); ctx.arc(ix - 14, iy - 18, 5, 0, TAU); ctx.fill();
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'lighter';
    rift();
    ctx.strokeStyle = `rgba(230,90,255,${0.55 * fl})`;
    ctx.lineWidth = 10;
    ctx.stroke();
    ctx.strokeStyle = `rgba(160,240,255,${0.9 * Math.min(1, fl)})`;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();

    // floating shards (back to front)
    ctx.lineJoin = 'round';
    for (const sh of S.shards) {
      b = layer(ctx, cam, view, sh.p);
      ctx.strokeStyle = 'rgba(225,200,255,0.9)';
      ctx.lineWidth = 1.4 / b.z;
      eachCopy(sh.x, 3200, b.x0, b.x1, sh.s * 2, (x) => {
        const y = sh.y + Math.sin(t * 0.5 + sh.ph) * 14;
        ctx.globalCompositeOperation = 'lighter';
        drawGlow(ctx, '170,90,255', x, y, sh.s * 3.2, 0.42);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        drawShard(ctx, sh, x, y, sh.s, t);
      });
      ctx.restore();
    }
    drawGlowField(ctx, S.motes, cam, view, '190,130,255', t, 1, 0.85);
    b = layer(ctx, cam, view, 0.78);
    drawInstances(ctx, b, S.crystals, 3300);
    ctx.globalCompositeOperation = 'lighter';
    for (const c of S.crystals) eachCopy(c.x, 3300, b.x0, b.x1, 200, (x) => drawGlowE(ctx, '150,90,255', x, -60, 200, 120, 0.35 + 0.1 * Math.sin(t * 1.5 + x), 1));
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#12061f';
    ctx.fillRect(b.x0 - 4, 0, b.x1 - b.x0 + 8, b.y1 + 4);
    ctx.restore();

    // Floor: dark glassy crystal with glowing facets
    const F = floorView(cam, view);
    if (F.gy < view.h) {
      floorBase(ctx, F, [[0, '#3a1660'], [0.15, '#1f0b40'], [0.6, '#0e0520'], [1, '#05020b']]);
      ctx.globalCompositeOperation = 'lighter';
      const [rsx] = layerToScreen(cam, view, 0.05, 0, -400);
      drawGlowE(ctx, '220,80,255', rsx, F.gy + 70 * F.z, 120 * F.z, 220 * F.z, 0.5 * fl, 1);
      drawGlowE(ctx, '255,140,80', rsx, F.gy + 50 * F.z, 50 * F.z, 120 * F.z, 0.25 * fl, 1);
      drawGlowE(ctx, '140,70,255', view.w / 2, F.gy, view.w * 0.7, 50 * F.z, 0.3, 2);
      const rows = S.rows;
      ctx.strokeStyle = 'rgba(170,110,255,0.42)';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      floorRays(ctx, F, 160, 0);
      for (let k = 1; k < rows.length && rows[k] < F.rMax + 1; k++) { const y = fY(F, rows[k]); ctx.moveTo(0, y); ctx.lineTo(view.w, y); }
      for (let k = 0; k < rows.length - 1 && rows[k] < F.rMax; k++) {
        const off = (k & 1) * 80;
        let u = Math.floor((fU0(F, rows[k + 1]) - off) / 160) * 160 + off;
        for (; u < fU1(F, rows[k + 1]) + 160; u += 160) {
          ctx.moveTo(fX(F, u, rows[k]), fY(F, rows[k]));
          ctx.lineTo(fX(F, u + 80, rows[k + 1]), fY(F, rows[k + 1]));
        }
      }
      ctx.stroke();
      // energy pulses running outward along the ground line
      for (const sgn of [-1, 1]) {
        const u = sgn * S.pulse * 2200;
        const px = fX(F, u, 6);
        if (px > -200 && px < view.w + 200) drawGlowE(ctx, '170,120,255', px, F.gy + 4 * F.z, 160 * F.z, 18 * F.z, 0.6 * (1 - S.pulse), 0);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(200,150,255,0.6)';
      ctx.fillRect(0, F.gy - 0.5, view.w, 1.5);
    }
  },

  front(ctx, S, cam, view) {
    drawGlowField(ctx, S.motesF, cam, view, '170,120,255', S.t, 1, 0.5);
    screenGrad(ctx, view, [[0, 'rgba(10,0,30,0.25)'], [0.5, 'rgba(20,0,40,0)'], [1, 'rgba(30,0,50,0.2)']]);
    vignette(ctx, view, '6,0,16', 0.7);
  },

  impact(S, x, y, p) {
    S.eye.flare = Math.min(1.2, S.eye.flare + p * 0.8);
    S.eye.tx = clamp(x / 800, -1, 1);
    S.eye.ty = 0.5;
    S.eye.lookT = 2;
    addDebris(S, { k: 'ring', c: 'rgba(190,140,255,1)', x, y: 6, life: 0.8, s: 160 + p * 160, a: 0.9 });
    addDebris(S, { k: 'flash', rgb: '180,110,255', x, y: Math.min(-20, y), life: 0.35, s: 120 + p * 100, a: 0.7 });
    burst(S, S.n(Math.round(8 + p * 14)), (R) => ({
      k: 'chip', c: R.pick(['#9a6bff', '#5a2fb8', '#c9a6ff', '#67e0ff']), x: x + R.range(-30, 30), y: y + R.range(-20, 10),
      vx: R.range(-300, 300), vy: -R.range(120, 420) * (0.5 + p), g: 1000, life: R.range(0.8, 1.5), s: R.range(3, 7), rot: R() * TAU, vr: R.range(-14, 14),
      fy: R.range(0, 40), bounce: 0.4, front: R() < 0.3,
    }));
    burst(S, S.n(Math.round(6 + p * 8)), (R) => ({
      k: 'glow', rgb: '170,120,255', x: x + R.range(-60, 60), y: y + R.range(-40, 10), vx: R.range(-80, 80), vy: -R.range(40, 160), drag: 1.2,
      life: R.range(0.8, 1.6), s: R.range(6, 12), a: 0.9,
    }));
  },
};

// ═════════════════════════════════════════════════════════════════════════
// 10. Training Lab
// ═════════════════════════════════════════════════════════════════════════

const LAB_SKY = [[0, '#bfcbd8'], [0.45, '#d6dfe8'], [0.85, '#e2e9f0'], [1, '#d3dce6']];
const LAB_INK = '#2f5577';

// Cached text sprites (labels never change, so render once at high res).
const _textCache = new Map();
function textSprite(str, px, color, weight = 600) {
  const key = str + '|' + px + '|' + color + '|' + weight;
  let s = _textCache.get(key);
  if (s !== undefined) return s;
  const res = 3, font = `${weight} ${px}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
  const probe = createCanvas(4, 4);
  let w = str.length * px * 0.7;
  if (probe) { const g = probe.getContext('2d'); g.font = font; w = g.measureText(str).width; }
  s = makeSprite(w + 4, px * 1.4, (w + 4) / 2, px * 0.7, res, (g) => {
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = color;
    g.fillText(str, 0, px * 0.05);
  });
  _textCache.set(key, s);
  return s;
}

IMPL.lab = {
  build(S) {
    const R = S.rng;
    S.panels = [
      { x: -780, y: -400, w: 240, h: 140, kind: 'bars' },
      { x: -330, y: -460, w: 220, h: 120, kind: 'wave' },
      { x: 330, y: -460, w: 200, h: 120, kind: 'ring' },
      { x: 780, y: -400, w: 240, h: 140, kind: 'text' },
    ].map((p) => ({ ...p, ph: R() * TAU, seed: R.int(1, 1e6) }));
    S.lines = Array.from({ length: 14 }, () => R.range(0.3, 1));
    S.pix = makeField(S.frng, S.n(26), (p, r) => { p.d = r.range(0.4, 0.95); p.s = r.range(1.5, 3); p.vx = 0; p.vy = -r.range(6, 16); });
    S.marks = [];
    S.glitch = 0;
  },

  update(S, dt) {
    stepField(S.pix, dt, S.t);
    S.glitch = Math.max(0, S.glitch - dt);
    for (let i = S.marks.length - 1; i >= 0; i--) {
      S.marks[i].t += dt;
      if (S.marks[i].t > 1.6) S.marks.splice(i, 1);
    }
  },

  back(ctx, S, cam, view) {
    const t = S.t;
    drawSky(ctx, cam, view, LAB_SKY, -820, 0);
    // Back wall: panel seams + measuring grid
    let b = layer(ctx, cam, view, 0.5);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(70,100,130,0.10)';
    ctx.beginPath();
    for (let x = Math.floor(b.x0 / 50) * 50; x <= b.x1; x += 50) { ctx.moveTo(x, b.y0); ctx.lineTo(x, 0); }
    for (let y = 0; y >= b.y0 - 50; y -= 50) { ctx.moveTo(b.x0, y); ctx.lineTo(b.x1, y); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(60,90,125,0.2)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = Math.floor(b.x0 / 400) * 400; x <= b.x1; x += 400) { ctx.moveTo(x, b.y0); ctx.lineTo(x, 0); }
    ctx.moveTo(b.x0, -500); ctx.lineTo(b.x1, -500);
    ctx.stroke();
    // faint emblem
    ctx.strokeStyle = 'rgba(40,140,200,0.14)';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(0, -560, 64, 0, TAU); ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, -560, 78, 0, TAU);
    ctx.moveTo(0, -600); ctx.lineTo(35, -540); ctx.lineTo(-35, -540); ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = lin(ctx, 0, -60, 0, 0, [[0, '#c9d3dd'], [1, '#b3bfcb']]);
    ctx.fillRect(b.x0 - 4, -46, b.x1 - b.x0 + 8, 46);
    ctx.fillStyle = 'rgba(40,160,220,0.5)';
    ctx.fillRect(b.x0 - 4, -48, b.x1 - b.x0 + 8, 2);
    ctx.fillStyle = '#b3bfcb';
    ctx.fillRect(b.x0 - 4, 0, b.x1 - b.x0 + 8, b.y1 + 4);
    ctx.restore();
    // Ceiling light strips
    b = layer(ctx, cam, view, 0.62);
    eachCopy(0, 420, b.x0, b.x1, 160, (x) => {
      ctx.fillStyle = '#9aa8b6';
      ctx.fillRect(x - 150, -846, 300, 14);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - 140, -834, 280, 6);
      drawGlowE(ctx, '255,255,255', x, -800, 260, 90, 0.5, 2);
    });
    ctx.globalAlpha = 1;
    ctx.restore();
    // Holographic panels
    b = layer(ctx, cam, view, 0.74);
    const gl = S.glitch > 0 ? (Math.sin(t * 90) * 8 * S.glitch) : 0;
    for (const p of S.panels) {
      eachCopy(p.x, 2800, b.x0, b.x1, p.w, (x0) => {
        const x = x0 + gl, y = p.y + Math.sin(t * 0.6 + p.ph) * 4;
        const L = x - p.w / 2, T = y - p.h / 2;
        const fl = 0.85 + 0.15 * Math.sin(t * 3 + p.ph) * Math.sin(t * 7.7);
        ctx.globalAlpha = fl;
        ctx.fillStyle = 'rgba(110,205,255,0.16)';
        ctx.fillRect(L, T, p.w, p.h);
        ctx.strokeStyle = 'rgba(30,140,210,0.65)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(L, T, p.w, p.h);
        ctx.strokeStyle = 'rgba(20,130,200,0.95)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(L, T + 16); ctx.lineTo(L, T); ctx.lineTo(L + 16, T);
        ctx.moveTo(L + p.w - 16, T + p.h); ctx.lineTo(L + p.w, T + p.h); ctx.lineTo(L + p.w, T + p.h - 16);
        ctx.stroke();
        ctx.fillStyle = 'rgba(20,130,200,0.8)';
        ctx.fillRect(L + 10, T + 9, p.w * 0.35, 5);
        ctx.fillRect(L + p.w - 28, T + 9, 18, 5);
        const cx = L + 14, cy = T + 26, cw = p.w - 28, ch = p.h - 38;
        ctx.strokeStyle = 'rgba(10,150,210,0.9)';
        ctx.fillStyle = 'rgba(10,150,210,0.55)';
        if (p.kind === 'bars') {
          for (let i = 0; i < 9; i++) {
            const hgt = ch * (0.25 + 0.7 * (0.5 + 0.5 * Math.sin(t * 1.4 + i * 0.9 + p.ph)));
            ctx.fillRect(cx + i * (cw / 9) + 2, cy + ch - hgt, cw / 9 - 5, hgt);
          }
        } else if (p.kind === 'wave') {
          ctx.lineWidth = 2;
          ctx.beginPath();
          for (let i = 0; i <= 40; i++) {
            const k = i / 40;
            const yy = cy + ch / 2 + Math.sin(k * 12 + t * 3) * ch * 0.3 * Math.sin(k * 3 + t * 0.7);
            if (i) ctx.lineTo(cx + k * cw, yy); else ctx.moveTo(cx, yy);
          }
          ctx.stroke();
          ctx.globalAlpha = fl * 0.4;
          ctx.beginPath(); ctx.moveTo(cx, cy + ch / 2); ctx.lineTo(cx + cw, cy + ch / 2); ctx.stroke();
        } else if (p.kind === 'ring') {
          const rr = ch * 0.42, rcx = cx + cw * 0.32, rcy = cy + ch / 2;
          ctx.lineWidth = 6;
          ctx.globalAlpha = fl * 0.3;
          ctx.beginPath(); ctx.arc(rcx, rcy, rr, 0, TAU); ctx.stroke();
          ctx.globalAlpha = fl;
          const v = 0.55 + 0.35 * Math.sin(t * 0.8 + p.ph);
          ctx.beginPath(); ctx.arc(rcx, rcy, rr, -Math.PI / 2, -Math.PI / 2 + v * TAU); ctx.stroke();
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(rcx, rcy, rr * 0.6, t * 1.5, t * 1.5 + 4); ctx.stroke();
          for (let i = 0; i < 4; i++) ctx.fillRect(cx + cw * 0.62, cy + 6 + i * (ch / 4), cw * 0.35 * S.lines[i], 4);
        } else {
          const off = (t * 14) % 12;
          ctx.save();
          ctx.beginPath(); ctx.rect(cx, cy, cw, ch); ctx.clip();
          for (let i = 0; i < 10; i++) {
            const yy = cy + i * 12 - off;
            ctx.fillRect(cx, yy, cw * S.lines[(i + Math.floor(t * 14 / 12)) % S.lines.length], 4);
          }
          ctx.restore();
        }
        ctx.globalAlpha = 1;
      });
    }
    ctx.restore();
    drawDotField(ctx, S.pix, cam, view, '#3fb3e8', 0.35, 0.8);

    // Arena walls at x = ±1000 (world space)
    b = layer(ctx, cam, view, 1);
    for (const wx of [-1000, 1000]) {
      if (wx + 80 < b.x0 || wx - 80 > b.x1) continue;
      const side = Math.sign(wx);
      ctx.fillStyle = lin(ctx, wx - 70, 0, wx + 70, 0, [[0, 'rgba(255,90,50,0)'], [0.5, 'rgba(255,90,50,0.22)'], [1, 'rgba(255,90,50,0)']]);
      ctx.fillRect(wx - 70, b.y0 - 10, 140, -b.y0 + 10);
      ctx.fillStyle = 'rgba(255,80,40,0.75)';
      ctx.fillRect(wx - 2, b.y0 - 10, 4, -b.y0 + 10);
      ctx.fillStyle = 'rgba(255,110,60,0.5)';
      for (let k = 0; k < 6; k++) {
        const yy = -mod(t * 120 + k * 140, 840);
        ctx.fillRect(wx - 40, yy, 80, 2);
      }
      ctx.fillStyle = '#3b4652';
      ctx.fillRect(wx - 12, -70, 24, 70);
      ctx.fillStyle = mod(t, 1) < 0.5 ? '#ff5a3c' : '#a8321f';
      ctx.fillRect(wx - 6, -62, 12, 8);
      const lbl = textSprite('WALL', 18, '#c2361d', 800);
      drawSprite(ctx, lbl, wx - side * 44, -100);
      const lbl2 = textSprite(String(wx), 13, '#c2361d', 700);
      drawSprite(ctx, lbl2, wx - side * 44, -80);
    }
    ctx.restore();

    // Floor: measured grid with ticks every 100 units
    const F = floorView(cam, view);
    if (F.gy < view.h) {
      floorBase(ctx, F, [[0, '#f0f4f8'], [0.25, '#dde4eb'], [1, '#aeb9c4']]);
      // hazard zones beyond the walls
      ctx.fillStyle = 'rgba(30,36,44,0.85)';
      ctx.beginPath();
      for (const sgn of [-1, 1]) {
        const u0 = sgn * 1000, u1 = sgn * 4000;
        ctx.moveTo(fX(F, u0, 0), fY(F, 0)); ctx.lineTo(fX(F, u1, 0), fY(F, 0));
        ctx.lineTo(fX(F, u1, F.rMax), fY(F, F.rMax)); ctx.lineTo(fX(F, u0, F.rMax), fY(F, F.rMax));
        ctx.closePath();
      }
      ctx.fill();
      ctx.fillStyle = '#f2c230';
      ctx.save();
      ctx.beginPath();
      for (const sgn of [-1, 1]) {
        const u0 = sgn * 1000, u1 = sgn * 4000;
        ctx.moveTo(fX(F, u0, 0), fY(F, 0)); ctx.lineTo(fX(F, u1, 0), fY(F, 0));
        ctx.lineTo(fX(F, u1, F.rMax), fY(F, F.rMax)); ctx.lineTo(fX(F, u0, F.rMax), fY(F, F.rMax));
        ctx.closePath();
      }
      ctx.clip();
      ctx.beginPath();
      for (const sgn of [-1, 1]) {
        const ua = fU0(F, F.rMax) - 100, ub = fU1(F, F.rMax) + 100;
        const start = Math.max(sgn > 0 ? 1000 : -4000, Math.floor(ua / 60) * 60);
        for (let u = start; u < Math.min(sgn > 0 ? 4000 : -1000, ub); u += 60) {
          ctx.moveTo(fX(F, u, 0), fY(F, 0)); ctx.lineTo(fX(F, u + 30, 0), fY(F, 0));
          ctx.lineTo(fX(F, u - 10, F.rMax), fY(F, F.rMax)); ctx.lineTo(fX(F, u - 40, F.rMax), fY(F, F.rMax));
          ctx.closePath();
        }
      }
      ctx.globalAlpha = 0.85;
      ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1;
      // grid
      ctx.strokeStyle = 'rgba(70,100,135,0.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      floorRays(ctx, F, 100, 0);
      for (const r of [30, 70, 125, 200]) if (r < F.rMax) { ctx.moveTo(0, fY(F, r)); ctx.lineTo(view.w, fY(F, r)); }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(50,85,125,0.32)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      floorRays(ctx, F, 500, 0);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(20,150,210,0.7)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(fX(F, 0, 0), fY(F, 0)); ctx.lineTo(fX(F, 0, F.rMax), fY(F, F.rMax));
      ctx.stroke();
      ctx.strokeStyle = 'rgba(230,70,40,0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (const wx of [-1000, 1000]) { ctx.moveTo(fX(F, wx, 0), fY(F, 0)); ctx.lineTo(fX(F, wx, F.rMax), fY(F, F.rMax)); }
      ctx.stroke();
      // ticks + labels along the front of the ground line
      const u0 = Math.floor(fU0(F, 20) / 50) * 50, u1 = fU1(F, 20);
      ctx.strokeStyle = LAB_INK;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let u = u0; u <= u1; u += 50) {
        const major = u % 100 === 0;
        ctx.moveTo(fX(F, u, 0), fY(F, 0));
        ctx.lineTo(fX(F, u, major ? 9 : 5), fY(F, major ? 9 : 5));
      }
      ctx.stroke();
      const sc = F.z * (1 + 20 / FLOOR_H);
      for (let u = Math.ceil(u0 / 100) * 100; u <= u1; u += 100) {
        const wall = Math.abs(u) === 1000;
        const s = textSprite(String(u), 13, wall ? '#c2361d' : u === 0 ? '#1287c2' : LAB_INK, wall || u === 0 ? 800 : 600);
        drawSprite(ctx, s, fX(F, u, 20), fY(F, 20), sc);
      }
      ctx.fillStyle = 'rgba(40,150,210,0.7)';
      ctx.fillRect(0, F.gy - 1, view.w, 2);
      // impact markers
      ctx.font = `700 ${Math.round(12 * F.z)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      for (const m of S.marks) {
        const a = 1 - m.t / 1.6, x = fX(F, m.x, 0);
        ctx.globalAlpha = a;
        ctx.fillStyle = 'rgba(20,150,210,0.9)';
        ctx.fillRect(x - 1, F.gy - 140 * F.z, 2, 140 * F.z);
        ctx.fillText(`x ${Math.round(m.x)}`, x, F.gy - 148 * F.z);
      }
      ctx.globalAlpha = 1;
    }
  },

  front(ctx, S, cam, view) {
    vignette(ctx, view, '40,60,90', 0.22);
  },

  impact(S, x, y, p) {
    S.glitch = 0.25 + p * 0.3;
    S.marks.push({ x, t: 0 });
    if (S.marks.length > 4) S.marks.shift();
    addDebris(S, { k: 'ring', c: 'rgba(20,150,210,1)', x, y: 6, life: 0.7, s: 120 + p * 140, a: 0.9 });
    burst(S, S.n(Math.round(3 + p * 5)), (R) => ({
      k: 'puff', rgb: '200,210,220', x: x + R.range(-40, 40), y: -R.range(0, 15), vx: R.range(-80, 80), vy: -R.range(10, 40), drag: 3,
      life: R.range(0.5, 0.9), s: R.range(14, 24), grow: 40, a: 0.5,
    }));
    burst(S, S.n(Math.round(4 + p * 6)), (R) => ({
      k: 'chip', c: R.pick(['#3fb3e8', '#7fd3f5']), x: x + R.range(-20, 20), y: y + R.range(-20, 10), vx: R.range(-200, 200), vy: -R.range(80, 260),
      g: 900, life: R.range(0.5, 0.9), s: R.range(2, 4), rot: 0, vr: 0, fy: R.range(0, 30), bounce: 0.3,
    }));
  },
};

// ═════════════════════════════════════════════════════════════════════════
// Public API
// ═════════════════════════════════════════════════════════════════════════

export const ARENAS = [
  { id: 'dojo', name: 'Sunset Dojo', desc: 'A temple courtyard at golden hour, where blossoms ride the evening wind.', music: 'battle2', rim: '#ffb36b', shadow: 'rgba(60,18,30,0.45)', ambient: '#ff9a5a' },
  { id: 'rooftop', name: 'Neon Rooftop', desc: 'Rain-slick concrete high above a city that never powers down.', music: 'battle1', rim: '#4df3ff', shadow: 'rgba(0,0,12,0.55)', ambient: '#7a5cff' },
  { id: 'volcano', name: 'Caldera Forge', desc: 'Black basalt and rivers of fire inside a waking volcano.', music: 'battle3', rim: '#ff7a2a', shadow: 'rgba(20,0,0,0.6)', ambient: '#ff5a1f' },
  { id: 'glacier', name: 'Frozen Peak', desc: 'A wind-scoured summit beneath dancing auroras.', music: 'battle2', rim: '#9fe8ff', shadow: 'rgba(10,30,60,0.45)', ambient: '#7fd8ff' },
  { id: 'bamboo', name: 'Whispering Bamboo', desc: 'Morning mist and swaying stalks in a forest that listens.', music: 'battle2', rim: '#e8ffb0', shadow: 'rgba(20,40,20,0.45)', ambient: '#b8e08a' },
  { id: 'temple', name: 'Sky Sanctum', desc: 'A marble platform above the clouds, kissed by the rising sun.', music: 'battle1', rim: '#ffe9a8', shadow: 'rgba(80,60,40,0.35)', ambient: '#ffd58a' },
  { id: 'necropolis', name: 'Moonlit Necropolis', desc: 'Old graves, older trees, and lights that should not be there.', music: 'battle3', rim: '#9dffcf', shadow: 'rgba(0,10,10,0.6)', ambient: '#6fd1b0' },
  { id: 'foundry', name: 'Iron Foundry', desc: 'Gears grind and molten steel pours in the heart of the works.', music: 'battle3', rim: '#ffb14a', shadow: 'rgba(10,5,0,0.6)', ambient: '#ff9a3a' },
  { id: 'void', name: 'The Void', desc: 'The edge of everything. Something vast is watching.', music: 'boss', rim: '#c38bff', shadow: 'rgba(10,0,25,0.6)', ambient: '#9a5cff' },
  { id: 'lab', name: 'Training Lab', desc: 'A calm, measured space to learn every move.', music: 'battle1', rim: '#7fe9ff', shadow: 'rgba(20,40,60,0.35)', ambient: '#bfe6ff' },
];
const ARENA_BY_ID = new Map(ARENAS.map((a) => [a.id, a]));

function safeCam(cam) {
  const zoom = cam && Number.isFinite(cam.zoom) && cam.zoom > 0.05 ? cam.zoom : 1;
  return {
    x: cam && Number.isFinite(cam.x) ? cam.x : 0,
    y: cam && Number.isFinite(cam.y) ? cam.y : 0,
    zoom,
  };
}
function safeView(view) {
  const w = view && view.w > 0 ? view.w : 1280;
  const h = view && view.h > 0 ? view.h : 720;
  return { w, h };
}

export function createArenaState(id, { quality = 'high', seed = 1, res } = {}) {
  const def = ARENA_BY_ID.get(id) || ARENAS[0];
  const hi = quality !== 'low';
  const S = {
    id: def.id,
    def,
    quality: hi ? 'high' : 'low',
    hi,
    res: res || (hi ? 2 : 1),
    seed,
    rng: makeRng((hashStr(def.id) ^ Math.imul(seed | 0, 0x9e3779b1)) >>> 0),   // layout + runtime
    frng: makeRng((hashStr(def.id + ':fx') ^ Math.imul(seed | 0, 0x85ebca6b)) >>> 0), // quality-scaled particle setup
    t: 0,
    debris: [],
    maxDebris: hi ? 420 : 200,
    n: (k) => Math.max(1, Math.round(hi ? k : k * 0.5)),  // particle count scaler
  };
  const bytes0 = _cacheBytes;
  try {
    IMPL[def.id].build(S);
  } catch (e) {
    // Never let a missing canvas (e.g. headless Node) break the game.
    S.buildError = e;
  }
  S.cacheBytes = _cacheBytes - bytes0;
  return S;
}

export function updateArena(state, dt) {
  if (!state) return;
  dt = Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 0;
  state.t += dt;
  updateDebris(state, dt);
  if (!state.buildError) IMPL[state.id].update(state, dt);
}

export function drawArenaBack(ctx, state, cam, view) {
  if (!ctx || !state) return;
  cam = safeCam(cam);
  view = safeView(view);
  ctx.save();
  if (!state.buildError) IMPL[state.id].back(ctx, state, cam, view);
  else { ctx.fillStyle = state.def.ambient; ctx.fillRect(0, 0, view.w, view.h); }
  drawDebris(ctx, state, cam, view, false);
  ctx.restore();
}

export function drawArenaFront(ctx, state, cam, view) {
  if (!ctx || !state || state.buildError) return;
  cam = safeCam(cam);
  view = safeView(view);
  ctx.save();
  drawDebris(ctx, state, cam, view, true);
  IMPL[state.id].front(ctx, state, cam, view);
  ctx.restore();
}

export function arenaImpact(state, x, y, power) {
  if (!state || state.buildError) return;
  power = clamp(Number.isFinite(power) ? power : 0.5, 0, 1);
  x = Number.isFinite(x) ? x : 0;
  y = Number.isFinite(y) ? Math.min(0, y) : 0;
  state.lastImpact = { x, y, power, t: state.t };
  IMPL[state.id].impact(state, x, y, power);
}

// Stage-select thumbnails: one low-quality, low-res state per arena, animated by t.
const _previews = new Map();
export function drawArenaPreview(ctx, id, x, y, w, h, t = 0) {
  if (!ctx || !(w > 2 && h > 2)) return;
  let st = _previews.get(id);
  if (!st) {
    st = createArenaState(id, { quality: 'low', seed: 1, res: 0.75 });
    st.previewT = null;
    _previews.set(id, st);
  }
  if (st.previewT == null) {
    for (let i = 0; i < 90; i++) updateArena(st, 1 / 30);
  } else {
    const dt = t - st.previewT;
    if (dt > 0) updateArena(st, Math.min(dt, 0.1));
    else if (dt < -0.5) updateArena(st, 1 / 60);
  }
  st.previewT = t;
  const vh = 720, vw = clamp((vh * w) / h, 320, 4000);
  const view = { w: vw, h: vh };
  const cam = { x: Math.sin(t * 0.12) * 240, y: -30, zoom: 0.74 };
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.translate(x, y);
  ctx.scale(h / vh, h / vh);
  drawArenaBack(ctx, st, cam, view);
  drawArenaFront(ctx, st, cam, view);
  ctx.restore();
}
