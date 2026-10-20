// The roster: 12 original fighters. Each has a base move set (fists or
// armed), three ground specials (K, back+K, down+K), an air special and a
// cinematic ultimate.

import { FIST_SET, ARMED_SET, SET_POSES } from './moves.js';
import { rand, pick } from './util.js';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const H = (o) => ({ stun: 20, kb: [5, 0], stop: 6, sfx: 'hitMedium', spark: 'medium', ...o });

// Tempo scaling for the shared sets (heavier fighters swing slower)
function scaleMove(m, tempo) {
  if (tempo === 1) return { ...m };
  const S = (f) => Math.max(0, Math.round(f * tempo));
  const out = { ...m, dur: S(m.dur) };
  out.keys = m.keys.map((k) => [S(k[0]), k[1], k[2]]);
  // keep keyframes strictly increasing
  for (let i = 1; i < out.keys.length; i++) if (out.keys[i][0] <= out.keys[i - 1][0]) out.keys[i][0] = out.keys[i - 1][0] + 1;
  if (m.hits) out.hits = m.hits.map((h) => ({ ...h, f: [S(h.f[0]), Math.max(S(h.f[0]), S(h.f[1]))] }));
  if (m.chain) out.chain = { ...m.chain, at: S(m.chain.at) };
  if (m.cancel != null) out.cancel = S(m.cancel);
  if (m.jc != null) out.jc = S(m.jc);
  if (m.vel) out.vel = m.vel.map((v) => [S(v[0]), ...v.slice(1)]);
  if (m.ev) out.ev = m.ev.map((e) => [S(e[0]), e[1], e[2]]);
  return out;
}

// Re-target a set's hitboxes for a weapon reach multiplier
function withReach(m, reachR) {
  if (!m.hits) return m;
  return { ...m, hits: m.hits.map((h) => ({ ...h, r: Math.round((h.r || 14) * reachR) })) };
}

const skin = (name, color, accent, extra = {}) => ({ name, color, accent, ...extra });

// Generic barrage helper for ultimates
function barrage(c, t, t0, t1, every, poses, hitOpts, extra) {
  if (t < t0 || t >= t1) return;
  const k = Math.floor((t - t0) / every);
  c.pose(poses[k % poses.length]);
  if ((t - t0) % every === 0) {
    c.hit(typeof hitOpts === 'function' ? hitOpts(k) : hitOpts);
    if (extra) extra(k);
  }
}

// ---------------------------------------------------------------------------
// 1. KAI — The Wanderer
// ---------------------------------------------------------------------------
const KAI = {
  id: 'kai', name: 'KAI', title: 'The Wanderer',
  bio: 'A drifting martial artist who channels raw spirit through open palms. Balanced, honest, deadly.',
  set: 'fist', accessories: ['headband'],
  stats: { hp: 1000, power: 1, speed: 1, defense: 1, weight: 1, jump: 1 },
  bars: { power: 3, speed: 3, defense: 3, range: 3, difficulty: 1 },
  skins: [
    skin('Wanderer', '#4aa3ff', '#ff4d4d'),
    skin('Midnight', '#2b3a67', '#ffd23f', { price: 300 }),
    skin('Jade', '#3ddc97', '#ffffff', { price: 300 }),
    skin('Golden', '#ffcf3d', '#ff3d6e', { price: 500 }),
  ],
  victoryPose: 'victoryFist', introPose: 'victoryBow',
  specials: {
    S1: {
      name: 'Spirit Palm', special: true, tag: 'proj', range: [180, 900], dur: 38, stam: 14,
      keys: [[0, 'stance'], [8, 'castWind'], [13, 'cast', 'snap'], [24, 'cast'], [38, 'stance']],
      ev: [[13, 'proj', { kind: 'energy', spd: 11.5, r: 18, life: 100, color: '#7fe7ff', sfx: 'energy', hit: H({ dmg: 55, stun: 22, kb: [6, -2], elem: 'energy', spark: 'heavy', sfx: 'hitHeavy' }) }]],
    },
    S2: {
      name: 'Ascending Strike', special: true, tag: 'anti', dur: 56, stam: 16, until: 'land', landLag: 12,
      keys: [[0, 'risingWind'], [5, 'rising', 'snap'], [30, 'rising'], [44, 'fall']],
      vel: [[5, 4, -17]], ev: [[0, 'invuln', { n: 12 }], [5, 'sfx', { name: 'whooshHeavy' }], [5, 'fx', { ring: 70, color: '#7fe7ff', oy: 40 }]],
      hits: [{ f: [5, 18], a: 'elbowF', b: 'handF', r: 24, dmg: 70, stun: 34, kb: [3, -15], launch: true, kd: true, stop: 9, sfx: 'hitHeavy', spark: 'heavy', elem: 'energy', shake: 0.3 }],
    },
    S3: {
      name: 'Cyclone Kick', special: true, tag: 'rush', dur: 44, stam: 15,
      keys: [[0, 'kickWind'], [6, { ...spinPose(0) }], [12, { ...spinPose(180) }], [18, { ...spinPose(360) }], [24, { ...spinPose(540) }], [30, { ...spinPose(720) }], [44, 'stance']],
      vel: [[4, 6.5, -5]], gravity: 0.45,
      hits: [
        { f: [7, 11], a: 'kneeF', b: 'footF', r: 18, dmg: 26, stun: 22, kb: [2, -5], stop: 4, sfx: 'hitLight', spark: 'light' },
        { f: [15, 19], a: 'kneeF', b: 'footF', r: 18, dmg: 26, stun: 22, kb: [2, -5], stop: 4, sfx: 'hitLight', spark: 'light' },
        { f: [24, 29], a: 'kneeF', b: 'footF', r: 18, dmg: 40, stun: 26, kb: [9, -7], kd: true, stop: 8, sfx: 'hitHeavy', spark: 'heavy', shake: 0.2 },
      ],
      ev: [[6, 'sfx', { name: 'whoosh' }], [14, 'sfx', { name: 'whoosh' }], [22, 'sfx', { name: 'whooshHeavy' }]],
    },
    SA: {
      name: 'Falling Palm', special: true, tag: 'proj', air: true, dur: 30, stam: 12,
      keys: [[0, 'airWind'], [8, { ...castAir() }, 'snap'], [30, 'fall']],
      gravity: 0.25, vel: [[0, -1, -3]],
      ev: [[8, 'proj', { kind: 'energy', spd: 12, ang: 0.6, r: 16, life: 70, color: '#7fe7ff', hit: H({ dmg: 45, stun: 20, kb: [5, -4], elem: 'energy' }) }]],
    },
  },
  ult: {
    name: 'STORM OF FISTS',
    move: {
      name: 'Storm of Fists', special: true, isUlt: true, dur: 40,
      keys: [[0, 'stance'], [6, 'dash'], [10, 'jab', 'snap'], [26, 'jab'], [40, 'stance']],
      vel: [[6, 16]], ev: [[0, 'invuln', { n: 14 }]],
      hits: [{ f: [8, 24], a: 'elbowF', b: 'handF', r: 32, dmg: 20, lock: true, unblock: true, stun: 30, kb: [2, 0] }],
    },
    script(c, t) {
      if (t === 1) {
        c.face();
        c.place(62);
        c.zoom(1.5);
        c.dark(0.7);
      }
      barrage(c, t, 2, 62, 4, ['jab', 'cross', 'jab', 'cross', 'airPunch'], (k) => ({ dmg: 8, spark: k % 3 ? 'light' : 'medium', sfx: k % 2 ? 'hitLight' : 'hitMedium', shake: 0.05 }), (k) => {
        c.def.lockPose = k % 2 ? 'hurtHigh' : 'hurtMid';
        if (k % 3 === 0) c.ghost(0.35);
      });
      if (t === 62) c.pose('upperWind');
      if (t === 68) {
        c.pose('uppercut');
        c.final({ dmg: 135, kb: [5, -19], elem: 'energy', linger: 30 });
        c.fx.explosion(c.def.x, c.def.y - 90, '#7fe7ff', 1);
      }
    },
  },
};

function spinPose(rot) {
  return { hip: [0, 84], lean: -6, head: 0, hf: [44, 20], hb: [-44, 20], ff: [76, 50], fb: [-24, 16], w: null, w2: null, wl: 0, rot };
}
function castAir() {
  return { hip: [4, 80], lean: 24, head: 0, hf: [52, -26], hb: [48, -30], ff: [18, 40], fb: [-14, 30], w: null, w2: null, wl: 0, rot: 0 };
}

// ---------------------------------------------------------------------------
// 2. ROSA — Crimson Blade
// ---------------------------------------------------------------------------
const ROSA = {
  id: 'rosa', name: 'ROSA', title: 'Crimson Blade',
  bio: 'A duelist whose katana moves faster than rumor. Patient, precise, and lethal on the counter.',
  set: 'armed', accessories: ['ponytail'],
  weapon: { kind: 'katana', len: 74, metal: '#eef3f8', guard: '#d4a72c', handle: '#1d1d24' },
  reach: 1.0,
  stats: { hp: 960, power: 1.04, speed: 1.05, defense: 1, weight: 0.95, jump: 1 },
  bars: { power: 4, speed: 4, defense: 2, range: 4, difficulty: 3 },
  skins: [
    skin('Crimson', '#ff3b5c', '#ffd6e0', { hair: '#2b1020' }),
    skin('Sakura', '#ff9ec7', '#ffffff', { hair: '#5a2340', price: 300 }),
    skin('Onyx', '#2c2c38', '#ff3b5c', { hair: '#111', price: 400 }),
    skin('Ivory', '#f4efe6', '#c9a227', { hair: '#7a5230', price: 500 }),
  ],
  trailColor: '#ffb3c6',
  victoryPose: 'victoryRest', introPose: 'counterStance',
  specials: {
    S1: {
      name: 'Crescent Wave', special: true, tag: 'proj', range: [200, 900], dur: 36, stam: 14, trail: true,
      keys: [[0, 'armed'], [6, 'slashWind'], [11, 'slash', 'snap'], [22, 'slash'], [36, 'armed']],
      hits: [{ f: [11, 13], a: 'handF', b: 'wTip', r: 12, dmg: 30, stun: 18, kb: [4, 0], sfx: 'hitSlash', spark: 'slash', stop: 5 }],
      ev: [[11, 'proj', { kind: 'crescent', spd: 12.5, r: 22, life: 90, color: '#ff6b8b', sfx: 'swingBlade', hit: H({ dmg: 48, stun: 22, kb: [6, -2], sfx: 'hitSlash', spark: 'slash' }) }]],
    },
    S2: {
      name: 'Flash Step', special: true, tag: 'rush', range: [80, 520], dur: 38, stam: 15, trail: true,
      keys: [[0, 'armedLow'], [6, 'lunge', 'snap'], [18, 'lunge'], [24, 'counterStrike'], [38, 'armed']],
      vel: [[6, 26]], friction: 0.9,
      ev: [[6, 'invuln', { n: 12 }], [6, 'noPush', { n: 14 }], [6, 'sfx', { name: 'dash' }], [6, 'fx', { ghost: true }], [10, 'fx', { ghost: true }], [14, 'fx', { ghost: true }], [22, 'face', {}]],
      hits: [{ f: [7, 16], area: [-40, 40, 120, 90], dmg: 62, stun: 30, kb: [-3, -11], launch: true, stop: 9, sfx: 'hitSlash', spark: 'slashHeavy', shake: 0.25 }],
    },
    S3: {
      name: 'Iai Counter', special: true, tag: 'counter', dur: 46, stam: 10,
      keys: [[0, 'armed'], [4, 'counterStance', 'snap'], [40, 'counterStance'], [46, 'armed']],
      ev: [[3, 'counter', { n: 34, move: 'S3X' }], [3, 'sfx', { name: 'charge', vol: 0.5 }]],
    },
    S3X: {
      name: 'Iai Strike', special: true, dur: 36, trail: true,
      keys: [[0, 'counterStance'], [3, 'counterStrike', 'snap'], [20, 'counterStrike'], [36, 'armed']],
      vel: [[3, 14]],
      ev: [[3, 'sfx', { name: 'swingBlade' }], [3, 'noPush', { n: 10 }]],
      hits: [{ f: [3, 9], a: 'wBase', b: 'wTip', r: 18, dmg: 95, stun: 34, kb: [9, -9], kd: true, wb: true, stop: 14, sfx: 'hitSlash', spark: 'slashHeavy', shake: 0.45 }],
    },
    SA: {
      name: 'Falling Crescent', special: true, tag: 'proj', air: true, dur: 30, stam: 12, trail: true,
      keys: [[0, 'airSlashWind'], [7, 'airSlash', 'snap'], [30, 'fall']],
      gravity: 0.3, vel: [[0, -1, -3]],
      ev: [[7, 'proj', { kind: 'crescent', spd: 12, ang: 0.55, r: 20, life: 70, color: '#ff6b8b', sfx: 'swingBlade', hit: H({ dmg: 40, stun: 20, kb: [5, -3], sfx: 'hitSlash', spark: 'slash' }) }]],
    },
  },
  ult: {
    name: 'CRIMSON TEMPEST',
    move: {
      name: 'Crimson Tempest', special: true, isUlt: true, dur: 40, trail: true,
      keys: [[0, 'armedLow'], [6, 'lunge', 'snap'], [26, 'lunge'], [40, 'armed']],
      vel: [[6, 18]], ev: [[0, 'invuln', { n: 14 }]],
      hits: [{ f: [7, 22], a: 'wBase', b: 'wTip', r: 26, dmg: 22, lock: true, unblock: true, stun: 30, kb: [2, 0] }],
    },
    script(c, t) {
      if (t === 1) {
        c.face();
        c.dark(0.92);
        c.zoom(1.45);
        c.ghost(0.6);
        c.hide(true);
        c.def.lockPose = 'hurtMid';
      }
      if (t > 4 && t < 64 && (t - 5) % 6 === 0) {
        const [cx, cy] = c.center();
        const a = rand(0, Math.PI);
        c.fx.slashMark(cx, cy, a, 320, '#ffffff', 14, 10);
        c.fx.slashMark(cx, cy, a, 340, '#ff3b5c', 16, 18);
        c.hit({ dmg: 13, spark: 'slash', sfx: 'hitSlash', shake: 0.08 });
        c.def.lockPose = pick(['hurtHigh', 'hurtMid']);
        if (t % 12 === 5) c.sfx('swingBlade');
      }
      if (t === 66) {
        // reappear on the far side, back turned, blade resting
        c.hide(false);
        c.place(-120);
        c.pose('victoryRest');
        c.dark(0.5);
        c.zoom(1.3);
      }
      if (t === 92) {
        c.sfx('metal', { pitch: 1.4 });
        for (let i = 0; i < 30; i++) c.fx.dot(c.def.x + rand(-60, 60), c.def.y - rand(20, 180), rand(-4, 4), rand(-4, 1), pick(['#ff9ec7', '#ff3b5c', '#ffffff']), rand(30, 60), rand(3, 5), 0.08, true);
        c.final({ dmg: 150, kb: [4, -13], linger: 30 });
      }
    },
  },
};

// ---------------------------------------------------------------------------
// 3. NYX — Night Fang
// ---------------------------------------------------------------------------
const NYX = {
  id: 'nyx', name: 'NYX', title: 'Night Fang',
  bio: 'A shadow assassin with twin fangs and no reflection. Here, then behind you, then gone.',
  set: 'armed', accessories: ['scarf'],
  weapon: { kind: 'dagger', len: 34, dual: true, metal: '#d7dde6', handle: '#2a1b3d', guard: '#7b5cff' },
  reach: 1.15,
  stats: { hp: 900, power: 0.95, speed: 1.2, defense: 0.95, weight: 0.9, jump: 1.08 },
  bars: { power: 2, speed: 5, defense: 2, range: 2, difficulty: 4 },
  skins: [
    skin('Night', '#9b5cff', '#d6c2ff'),
    skin('Ash', '#5d6470', '#ff5c8a', { price: 300 }),
    skin('Blood Moon', '#c2183b', '#1a1a1a', { price: 400 }),
    skin('Ghost', '#e6f0ff', '#62d0ff', { price: 500 }),
  ],
  trailColor: '#b37bff',
  victoryPose: 'victoryArms', introPose: 'counterStance',
  specials: {
    S1: {
      name: 'Shadow Kunai', special: true, tag: 'proj', range: [160, 800], dur: 32, stam: 13,
      keys: [[0, 'armed'], [6, 'throwWind'], [11, 'throwRelease', 'snap'], [20, 'throwRelease'], [32, 'armed']],
      ev: [[11, 'proj', { kind: 'kunai', count: 3, spread: 0.28, spd: 15, r: 11, life: 70, color: '#b37bff', sfx: 'swingBlade', hit: H({ dmg: 22, stun: 15, kb: [3, -1], sfx: 'hitSlash', spark: 'slash', elem: 'shadow', stop: 3 }) }]],
    },
    S2: {
      name: 'Shade Step', special: true, tag: 'tp', dur: 28, stam: 14,
      keys: [[0, 'armed'], [4, 'crouch'], [16, 'crouch'], [20, 'armedLow'], [28, 'armed']],
      ev: [[3, 'hide', { n: 16 }], [3, 'sfx', { name: 'shadow' }], [13, 'tp', { to: 'behind', dist: 75, sfx: 'teleport' }], [14, 'show', {}], [14, 'invuln', { n: 4 }]],
    },
    S3: {
      name: 'Venom Edge', special: true, tag: 'rush', range: [60, 300], dur: 34, stam: 14, trail: true,
      keys: [[0, 'armed'], [4, 'thrustWind'], [8, 'lunge', 'snap'], [18, 'lunge'], [34, 'armed']],
      vel: [[8, 15]], friction: 0.88,
      hits: [{ f: [8, 15], a: 'handF', b: 'wTip', r: 18, dmg: 44, stun: 24, kb: [6, -2], stop: 7, sfx: 'hitSlash', spark: 'slash', elem: 'poison', status: { poison: 240 } }],
    },
    SA: {
      name: 'Rain of Kunai', special: true, tag: 'proj', air: true, dur: 30, stam: 12,
      keys: [[0, 'airWind'], [7, 'throwRelease', 'snap'], [30, 'fall']],
      gravity: 0.3, vel: [[0, -1, -3]],
      ev: [[7, 'proj', { kind: 'kunai', count: 2, spread: 0.3, ang: 0.75, spd: 15, r: 11, life: 60, color: '#b37bff', sfx: 'swingBlade', hit: H({ dmg: 22, stun: 15, kb: [3, -1], sfx: 'hitSlash', spark: 'slash', elem: 'shadow' }) }]],
    },
  },
  ult: {
    name: 'ECLIPSE',
    move: {
      name: 'Eclipse', special: true, isUlt: true, dur: 36, trail: true,
      keys: [[0, 'armedLow'], [5, 'lunge', 'snap'], [22, 'lunge'], [36, 'armed']],
      vel: [[5, 19]], ev: [[0, 'invuln', { n: 12 }]],
      hits: [{ f: [6, 20], a: 'wBase', b: 'wTip', r: 28, dmg: 20, lock: true, unblock: true, stun: 30, kb: [2, 0] }],
    },
    script(c, t) {
      if (t === 1) {
        c.dark(0.97);
        c.zoom(1.5);
        c.sfx('shadow');
      }
      if (t >= 4 && t < 76 && (t - 4) % 6 === 0) {
        const k = (t - 4) / 6;
        const side = k % 2 ? 1 : -1;
        c.att.facing = -side;
        c.place(70 + (k % 3) * 10, k % 4 === 3 ? -90 : 0);
        c.pose(pick(['slash', 'riseSlash', 'thrust', 'airSpin']));
        c.ghost(0.55);
        c.hit({ dmg: 10, spark: 'slash', sfx: 'hitSlash', elem: 'shadow', shake: 0.06 });
        c.def.lockPose = pick(['hurtHigh', 'hurtMid']);
        c.att.trail.clear();
      }
      if (t === 76) {
        c.att.facing = c.att.x < c.def.x ? 1 : -1;
        c.place(30, -220);
        c.pose('airDiveArmed');
        c.dark(0.6);
      }
      if (t > 76 && t < 86) {
        c.att.y = Math.min(0, c.att.y + 22);
      }
      if (t === 86) {
        c.final({ dmg: 140, kb: [3, -12], elem: 'shadow', linger: 28 });
        c.fx.burst(c.def.x, c.def.y - 60, '#b37bff', 40, 16);
      }
    },
  },
};

// ---------------------------------------------------------------------------
// 4. BRUTUS — The Mountain
// ---------------------------------------------------------------------------
const BRUTUS = {
  id: 'brutus', name: 'BRUTUS', title: 'The Mountain',
  bio: 'A walking landslide with a hammer forged from a fallen star. Slow to start, impossible to stop.',
  set: 'heavy', accessories: ['beard'], scale: 1.16, lineW: 8,
  weapon: { kind: 'hammer', len: 64, grip: 20, metal: '#8f98a3', handle: '#6b4a2b' },
  reach: 1.15, tempo: 1.18,
  stats: { hp: 1180, power: 1.2, speed: 0.82, defense: 1.1, weight: 1.35, jump: 0.92, guard: 0.8 },
  bars: { power: 5, speed: 1, defense: 5, range: 3, difficulty: 2 },
  skins: [
    skin('Mountain', '#ff9a3c', '#ffd27a', { hair: '#5b3a1e' }),
    skin('Granite', '#7c8590', '#ffb347', { hair: '#2f2f2f', price: 300 }),
    skin('Lava', '#d6342a', '#ffcf3d', { hair: '#1a1a1a', price: 400 }),
    skin('Frost Giant', '#9fd8ff', '#ffffff', { hair: '#e8f4ff', price: 500 }),
  ],
  trailColor: '#ffd27a',
  victoryPose: 'victoryRest', introPose: 'victoryArms',
  unlock: { tower: 'beginnings', cost: 1200 },
  specials: {
    S1: {
      name: 'Ground Pound', special: true, tag: 'proj', range: [140, 800], dur: 46, stam: 16, trail: true,
      keys: [[0, 'heavyArmed'], [8, 'slamWind'], [16, 'slam', 'snap'], [30, 'slam'], [46, 'heavyArmed']],
      hits: [{ f: [16, 18], a: 'wBase', b: 'wTip', r: 22, dmg: 40, stun: 22, kb: [3, -8], launch: true, stop: 7, sfx: 'hitHeavy', spark: 'heavy' }],
      ev: [[16, 'wave', { kind: 'rock', speed: 9.5, life: 75, h: 62, sfx: 'ground', hit: H({ dmg: 55, stun: 26, kb: [4, -11], launch: true, elem: 'earth', sfx: 'hitHeavy', spark: 'heavy' }) }], [16, 'fx', { dust: 12, shake: 0.3, ox: 70, impact: 0.6 }]],
    },
    S2: {
      name: 'Bull Rush', special: true, tag: 'rush', range: [80, 420], dur: 44, stam: 16,
      keys: [[0, 'heavyArmed'], [6, 'shoulder', 'snap'], [30, 'shoulder'], [44, 'heavyArmed']],
      vel: [[6, 12.5]], friction: 0.96,
      ev: [[0, 'armor', { n: 30 }], [6, 'sfx', { name: 'dash' }]],
      hits: [{ f: [8, 26], area: [10, 60, 70, 90], dmg: 62, stun: 28, kb: [11, -6], kd: true, wb: true, stop: 11, sfx: 'hitHeavy', spark: 'heavy', shake: 0.4, guard: 40 }],
    },
    S3: {
      name: 'Seismic Leap', special: true, tag: 'zone', range: [150, 700], dur: 50, stam: 18, until: 'land', landLag: 18, trail: true,
      keys: [[0, 'crouch'], [6, 'leap', 'snap'], [24, 'leap'], [34, 'slam']],
      ev: [[6, 'seek', { frames: 38, max: 13, vy: -19 }], [6, 'sfx', { name: 'whooshHeavy' }]],
      landEv: [['areaHit', { r: 150, h: 120, hit: H({ dmg: 78, stun: 30, kb: [5, -12], launch: true, elem: 'earth', sfx: 'hitHeavy', spark: 'heavy', shake: 0.5, otg: true }) }], ['fx', { dust: 18, shake: 0.5, ring: 180, oy: 4, squash: 4, color: '#ffd27a', impact: 1 }], ['sfx', { name: 'ground' }]],
    },
    SA: {
      name: 'Meteor Drop', special: true, tag: 'dive', air: true, dur: 60, stam: 12, until: 'land', landLag: 14, trail: true,
      keys: [[0, 'slamWind'], [8, 'slam', 'snap'], [60, 'slam']],
      vel: [[0, 0, -4], [8, 3, 16]], gravity: 1.2,
      hits: [{ f: [8, 60], a: 'wBase', b: 'wTip', r: 22, dmg: 50, stun: 24, kb: [4, -9], launch: true, stop: 8, sfx: 'hitHeavy', spark: 'heavy' }],
      landEv: [['fx', { dust: 14, shake: 0.35, ring: 140, oy: 4, squash: 4, color: '#ffd27a', impact: 0.7 }], ['areaHit', { r: 110, h: 60, hit: H({ dmg: 35, stun: 22, kb: [4, -8], launch: true, elem: 'earth' }) }]],
    },
  },
  ult: {
    name: 'TITAN FALL',
    move: {
      name: 'Titan Fall', special: true, isUlt: true, dur: 44,
      keys: [[0, 'heavyArmed'], [6, 'grabReach', 'snap'], [24, 'grabReach'], [44, 'heavyArmed']],
      vel: [[6, 11]], ev: [[0, 'invuln', { n: 14 }]],
      hits: [{ f: [8, 22], area: [10, 50, 80, 110], dmg: 25, lock: true, unblock: true, stun: 30, kb: [2, 0] }],
    },
    script(c, t) {
      if (t === 1) {
        c.face();
        c.dark(0.6);
        c.zoom(1.3);
        c.sfx('throw');
      }
      if (t < 20) {
        c.pose('grabHold');
        c.defRel(48 * c.att.scale, -30);
        c.defPose('grabbed');
      }
      if (t === 20) c.sfx('whooshHeavy');
      if (t >= 20 && t < 60) {
        // leap into the sky carrying the victim
        const k = (t - 20) / 40;
        c.att.y = -Math.sin(k * Math.PI * 0.5) * 520;
        c.pose('leap');
        c.defRel(30, -120);
        c.defPose('tumble', t * 12);
        c.zoom(1.1, c.att.x, c.att.y - 60, 0.2);
      }
      if (t === 60) c.sfx('charge');
      if (t >= 60 && t < 72) {
        const k = (t - 60) / 12;
        c.att.y = -520 * (1 - k * k);
        c.pose('slam');
        c.defRel(60, 40);
        c.defPose('tumble', 180);
      }
      if (t === 72) {
        c.att.y = 0;
        c.def.y = 0;
        c.fx.explosion(c.def.x, -10, '#ffb347', 1.4);
        c.fx.shards(c.def.x, -10, 30, '#9c7a55', 1.6);
        c.fx.dust(c.def.x, 0, 30, 0, undefined, 2);
        c.world.arenaImpact(c.def.x, 0, 1);
        c.sfx('ground');
        c.final({ dmg: 190, kb: [4, -9], elem: 'earth', shake: 1, linger: 30 });
      }
    },
  },
};

// ---------------------------------------------------------------------------
// 5. VOLT — Storm Runner
// ---------------------------------------------------------------------------
const VOLT = {
  id: 'volt', name: 'VOLT', title: 'Storm Runner',
  bio: 'Struck by lightning seven times, he now strikes back. Blindingly fast, dangerously fragile.',
  set: 'fist', accessories: ['spiky'], scale: 0.96, tempo: 0.88,
  weapon: { kind: 'gauntlet' },
  stats: { hp: 880, power: 0.92, speed: 1.28, defense: 0.92, weight: 0.88, jump: 1.08 },
  bars: { power: 2, speed: 5, defense: 1, range: 3, difficulty: 4 },
  skins: [
    skin('Storm', '#ffe23d', '#3dd6ff', { hair: '#fff6a8' }),
    skin('Plasma', '#c04dff', '#fff36b', { hair: '#ffe6ff', price: 300 }),
    skin('Blackout', '#2a2f3a', '#fff36b', { hair: '#fff36b', price: 400 }),
    skin('Neon', '#3dff9e', '#ff3dd6', { hair: '#ffffff', price: 500 }),
  ],
  trailColor: '#fff36b',
  victoryPose: 'victoryArms', introPose: 'pointUp',
  unlock: { tower: 'storm', cost: 1500 },
  specials: {
    S1: {
      name: 'Thunder Call', special: true, tag: 'zone', range: [200, 1000], dur: 40, stam: 15,
      keys: [[0, 'stance'], [8, 'pointUp', 'snap'], [28, 'pointUp'], [40, 'stance']],
      ev: [[8, 'sfx', { name: 'charge', vol: 0.6 }], [9, 'strike', { at: 'opp', kind: 'lightning', delay: 32, active: 8, w: 72, h: 900, color: '#fff36b', track: true, hit: H({ dmg: 62, stun: 28, kb: [2, -10], launch: true, elem: 'shock', status: { shock: 60 }, sfx: 'hitHeavy', spark: 'heavy' }) }]],
    },
    S2: {
      name: 'Lightning Dash', special: true, tag: 'rush', range: [80, 600], dur: 34, stam: 14,
      keys: [[0, 'stanceLow'], [4, 'dash', 'snap'], [16, 'flyKnee'], [34, 'stance']],
      vel: [[4, 24]], friction: 0.88,
      ev: [[4, 'invuln', { n: 9 }], [4, 'noPush', { n: 10 }], [4, 'sfx', { name: 'shock' }], [4, 'fx', { ghost: true }], [7, 'fx', { ghost: true }], [10, 'fx', { ghost: true }], [16, 'face', {}]],
      hits: [{ f: [5, 14], area: [-30, 50, 110, 100], dmg: 48, stun: 26, kb: [-3, -9], launch: true, stop: 7, elem: 'shock', sfx: 'hitMedium', spark: 'medium' }],
    },
    S3: {
      name: 'Static Field', special: true, tag: 'aoe', dur: 44, stam: 18,
      keys: [[0, 'stance'], [6, 'aura', 'snap'], [38, 'aura'], [44, 'stance']],
      ev: [[6, 'aura', { kind: 'shock', r: 105, life: 34, color: '#fff36b', sfx: 'shock', hit: H({ dmg: 14, stun: 18, kb: [3, -2], rehit: 8, elem: 'shock', sfx: 'hitLight', spark: 'light', stop: 3 }) }], [0, 'armor', { n: 8 }]],
    },
    SA: {
      name: 'Bolt Dive', special: true, tag: 'dive', air: true, dur: 40, stam: 12, until: 'land', landLag: 10,
      keys: [[0, 'airWind'], [5, 'diveKick', 'snap'], [40, 'diveKick']],
      vel: [[0, 0, -3], [5, 14, 14]], gravity: 0,
      ev: [[5, 'sfx', { name: 'shock' }], [5, 'fx', { ghost: true }], [9, 'fx', { ghost: true }]],
      hits: [{ f: [5, 40], a: 'kneeF', b: 'footF', r: 20, dmg: 42, stun: 22, kb: [5, -7], elem: 'shock', stop: 6, sfx: 'hitMedium', spark: 'medium', bounce: -10 }],
    },
  },
  ult: {
    name: 'OVERLOAD',
    move: {
      name: 'Overload', special: true, isUlt: true, dur: 34,
      keys: [[0, 'stanceLow'], [4, 'dash', 'snap'], [10, 'jab', 'snap'], [24, 'jab'], [34, 'stance']],
      vel: [[4, 22]], ev: [[0, 'invuln', { n: 12 }]],
      hits: [{ f: [5, 20], area: [0, 60, 90, 100], dmg: 20, lock: true, unblock: true, stun: 30, kb: [2, 0] }],
    },
    script(c, t) {
      if (t === 1) {
        c.dark(0.85);
        c.zoom(1.35);
      }
      if (t >= 3 && t < 63 && (t - 3) % 5 === 0) {
        const k = (t - 3) / 5;
        c.att.facing = k % 2 ? -1 : 1;
        c.place(70, k % 3 === 2 ? -120 : 0);
        c.pose(pick(['jab', 'cross', 'highKick', 'airKick', 'spinKick']));
        c.ghost(0.5);
        const [cx, cy] = c.center();
        c.fx.bolt(c.att.x, c.att.y - 90, cx, cy, '#fff36b', 6, 3, 6, 18);
        c.hit({ dmg: 9, spark: 'light', sfx: k % 2 ? 'hitLight' : 'shock', elem: 'shock', shake: 0.06 });
        c.def.lockPose = pick(['hurtHigh', 'hurtMid']);
      }
      if (t === 63) {
        c.att.facing = c.att.x < c.def.x ? 1 : -1;
        c.place(160, 0);
        c.pose('pointUp');
        c.sfx('charge');
      }
      if (t === 80) {
        for (let i = 0; i < 4; i++) c.fx.bolt(c.def.x + rand(-30, 30), -1100, c.def.x, c.def.y - 60, i % 2 ? '#ffffff' : '#fff36b', 16, 7, 16, 50);
        c.sfx('thunder');
        c.flash('#fffbe0', 0.7);
        c.final({ dmg: 150, kb: [3, -15], elem: 'shock', linger: 30 });
      }
    },
  },
};

// ---------------------------------------------------------------------------
// 6. YUKI — Frost Lotus
// ---------------------------------------------------------------------------
const YUKI = {
  id: 'yuki', name: 'YUKI', title: 'Frost Lotus',
  bio: 'A mountain priestess with a spear of living ice. Every step she takes leaves winter behind.',
  set: 'armed', accessories: ['scarf'],
  weapon: { kind: 'spear', len: 62, grip: 44, metal: '#e6fbff', handle: '#5b7a9a' },
  reach: 1.2, tempo: 1.04,
  stats: { hp: 980, power: 1, speed: 1.0, defense: 1.02, weight: 1, jump: 1 },
  bars: { power: 3, speed: 3, defense: 3, range: 5, difficulty: 3 },
  skins: [
    skin('Frost', '#7fe3ff', '#ffffff'),
    skin('Glacier', '#3d6bff', '#bff4ff', { price: 300 }),
    skin('Snowfall', '#f5f9ff', '#62d0ff', { price: 400 }),
    skin('Aurora', '#3dffb0', '#c58bff', { price: 500 }),
  ],
  trailColor: '#bff4ff',
  victoryPose: 'victoryArmed', introPose: 'victoryBow',
  unlock: { tower: 'frost', cost: 1500 },
  specials: {
    S1: {
      name: 'Ice Shard', special: true, tag: 'proj', range: [180, 900], dur: 34, stam: 13, trail: true,
      keys: [[0, 'armed'], [6, 'thrustWind'], [10, 'thrust', 'snap'], [20, 'thrust'], [34, 'armed']],
      ev: [[10, 'proj', { kind: 'ice', spd: 13.5, r: 13, life: 90, color: '#8fe8ff', sfx: 'ice', hit: H({ dmg: 40, stun: 20, kb: [5, -1], elem: 'ice', status: { slow: 150 }, sfx: 'hitMedium', spark: 'medium' }) }]],
    },
    S2: {
      name: 'Glacier Wall', special: true, tag: 'trap', dur: 34, stam: 16,
      keys: [[0, 'armed'], [6, 'slamWind'], [12, 'castDown', 'snap'], [26, 'castDown'], [34, 'armed']],
      ev: [[12, 'wall', { dist: 115, life: 170, hit: H({ dmg: 40, stun: 26, kb: [4, -11], launch: true, elem: 'ice', sfx: 'hitMedium' }) }]],
    },
    S3: {
      name: 'Frost Slide', special: true, tag: 'rush', range: [60, 380], dur: 36, stam: 14, trail: true,
      keys: [[0, 'armed'], [4, 'slideKick', 'snap'], [22, 'slideKick'], [36, 'armed']],
      vel: [[4, 14]], friction: 0.95,
      ev: [[4, 'sfx', { name: 'ice' }], [6, 'fx', { dust: 4 }]],
      hits: [{ f: [5, 20], a: 'kneeF', b: 'footF', r: 18, dmg: 48, stun: 28, kb: [4, -10], launch: true, elem: 'ice', status: { slow: 90 }, stop: 7, sfx: 'hitMedium', spark: 'medium' }],
    },
    SA: {
      name: 'Hail Spears', special: true, tag: 'proj', air: true, dur: 30, stam: 12,
      keys: [[0, 'airSlashWind'], [7, 'airSlash', 'snap'], [30, 'fall']],
      gravity: 0.3, vel: [[0, -1, -3]],
      ev: [[7, 'proj', { kind: 'ice', count: 2, spread: 0.3, ang: 0.6, spd: 13, r: 12, life: 60, color: '#8fe8ff', sfx: 'ice', hit: H({ dmg: 26, stun: 18, kb: [4, -2], elem: 'ice', status: { slow: 90 } }) }]],
    },
  },
  ult: {
    name: 'ABSOLUTE ZERO',
    move: {
      name: 'Absolute Zero', special: true, isUlt: true, dur: 40, trail: true,
      keys: [[0, 'armedLow'], [6, 'thrust', 'snap'], [26, 'thrust'], [40, 'armed']],
      vel: [[6, 16]], ev: [[0, 'invuln', { n: 14 }]],
      hits: [{ f: [7, 22], a: 'wBase', b: 'wTip', r: 26, dmg: 20, lock: true, unblock: true, stun: 30, kb: [2, 0] }],
    },
    script(c, t) {
      if (t === 1) {
        c.face();
        c.dark(0.7);
        c.zoom(1.4);
        c.sfx('ice');
        c.def.lockPose = 'frozen';
      }
      if (t < 40) {
        c.pose('castUp');
        if (t % 3 === 0) {
          const [cx, cy] = c.center();
          c.fx.shard(cx + rand(-70, 70), cy + rand(-80, 80), rand(-1, 1), rand(-1, 1), '#bff4ff', 40, rand(6, 12));
        }
        if (t % 8 === 0) c.hit({ dmg: 9, spark: 'light', sfx: 'ice', elem: 'ice', shake: 0.05 });
      }
      if (t === 40) {
        c.flash('#e6fbff', 0.6);
        c.sfx('ice', { pitch: 0.7 });
      }
      if (t >= 40 && t < 64) {
        // spinning spear dance
        c.place(80);
        c.pose(['airSpin', 'riseSlash', 'slash', 'thrust'][Math.floor((t - 40) / 6) % 4]);
        if ((t - 40) % 6 === 0) c.hit({ dmg: 11, spark: 'slash', sfx: 'hitSlash', elem: 'ice' });
      }
      if (t === 64) {
        c.place(40, -200);
        c.pose('airDiveArmed');
      }
      if (t > 64 && t < 74) c.att.y = Math.min(0, c.att.y + 20);
      if (t === 74) {
        c.att.y = 0;
        c.fx.shards(c.def.x, c.def.y - 80, 40, '#bff4ff', 1.6);
        c.sfx('shatter');
        c.final({ dmg: 150, kb: [8, -12], elem: 'ice', linger: 30 });
      }
    },
  },
};

// ---------------------------------------------------------------------------
// 7. IGNIS — Ember Sage
// ---------------------------------------------------------------------------
const IGNIS = {
  id: 'ignis', name: 'IGNIS', title: 'Ember Sage',
  bio: 'A pyromancer who keeps a sun in each fist. Keep your distance — he would love that.',
  set: 'fist', accessories: ['flame'],
  weapon: { kind: 'gauntlet' },
  stats: { hp: 940, power: 1.05, speed: 0.95, defense: 0.96, weight: 0.98, jump: 0.98 },
  bars: { power: 4, speed: 2, defense: 2, range: 5, difficulty: 3 },
  skins: [
    skin('Ember', '#ff6a2a', '#ffd166'),
    skin('Blue Flame', '#2a7bff', '#7ff3ff', { price: 300 }),
    skin('Cinder', '#3a2a2a', '#ff6a2a', { price: 400 }),
    skin('Solar', '#fff1a8', '#ff3d00', { price: 500 }),
  ],
  trailColor: '#ffb347',
  victoryPose: 'victoryArms', introPose: 'castUp',
  unlock: { tower: 'ember', cost: 1800 },
  specials: {
    S1: {
      name: 'Fire Orb', special: true, tag: 'proj', range: [200, 1000], dur: 40, stam: 15,
      keys: [[0, 'stance'], [8, 'castWind'], [14, 'cast', 'snap'], [26, 'cast'], [40, 'stance']],
      ev: [[14, 'proj', { kind: 'fireball', spd: 8.5, r: 22, life: 160, power: 2, color: '#ff7b2a', sfx: 'fireball', hit: H({ dmg: 58, stun: 24, kb: [6, -3], elem: 'fire', status: { burn: 120 }, sfx: 'hitHeavy', spark: 'heavy' }) }]],
    },
    S2: {
      name: 'Meteor', special: true, tag: 'zone', range: [250, 1000], dur: 40, stam: 16,
      keys: [[0, 'stance'], [8, 'castUp', 'snap'], [30, 'castUp'], [40, 'stance']],
      ev: [[8, 'sfx', { name: 'fire' }], [10, 'strike', { at: 'opp', kind: 'meteor', delay: 44, active: 8, w: 110, h: 160, color: '#ff7b2a', lead: 14, hit: H({ dmg: 78, stun: 28, kb: [4, -12], launch: true, elem: 'fire', status: { burn: 90 }, sfx: 'hitHeavy', spark: 'heavy', shake: 0.4 }) }]],
    },
    S3: {
      name: 'Eruption', special: true, tag: 'zone', range: [120, 420], dur: 38, stam: 15,
      keys: [[0, 'stance'], [6, 'castWind'], [12, 'castDown', 'snap'], [28, 'castDown'], [38, 'stance']],
      ev: [[12, 'strike', { kind: 'pillar', dist: 230, delay: 16, active: 16, w: 90, h: 320, color: '#ff7b2a', hit: H({ dmg: 64, stun: 30, kb: [2, -16], launch: true, elem: 'fire', status: { burn: 90 }, sfx: 'hitHeavy', spark: 'heavy', rehit: 0 }) }], [12, 'fx', { dust: 6 }]],
    },
    SA: {
      name: 'Falling Sun', special: true, tag: 'proj', air: true, dur: 32, stam: 13,
      keys: [[0, 'airWind'], [8, { ...castAir() }, 'snap'], [32, 'fall']],
      gravity: 0.25, vel: [[0, -1, -3]],
      ev: [[8, 'proj', { kind: 'fireball', spd: 10, ang: 0.55, r: 18, life: 90, color: '#ff7b2a', sfx: 'fireball', explode: true, hit: H({ dmg: 46, stun: 22, kb: [5, -6], elem: 'fire', status: { burn: 90 } }) }]],
    },
  },
  ult: {
    name: 'INFERNO',
    move: {
      name: 'Inferno', special: true, isUlt: true, dur: 44,
      keys: [[0, 'castWind'], [10, 'cast', 'snap'], [30, 'cast'], [44, 'stance']],
      ev: [[0, 'invuln', { n: 12 }], [10, 'proj', { kind: 'fireball', spd: 20, r: 30, life: 60, color: '#ffb347', sfx: 'fireball', power: 9, hit: { dmg: 20, lock: true, unblock: true, stun: 30, kb: [2, 0] } }]],
    },
    script(c, t) {
      if (t === 1) {
        c.dark(0.75);
        c.zoom(1.25, c.def.x, c.def.y - 120);
        c.sfx('fire');
      }
      if (t < 70) {
        c.pose('castUp');
        c.def.y = Math.max(-170, c.def.y - 2.5);
        c.def.lockPose = 'hurtAir';
        c.def.lockRot = t * 14;
        const [cx, cy] = c.center();
        for (let i = 0; i < 4; i++) {
          const a = t * 0.35 + i * 1.57;
          const r = 50 + (t % 20) * 3;
          c.fx.ember(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.5 + 40, i % 2 ? '#ffb347' : '#ff3d00', 30);
        }
        if (t % 6 === 0) c.hit({ dmg: 9, spark: 'light', sfx: t % 12 ? 'fire' : 'hitLight', elem: 'fire', shake: 0.05, vol: 0.6 });
        if (t % 10 === 0) c.fx.ring(cx, cy + 60, 20, 160, '#ff7b2a', 18, 6, 3);
      }
      if (t === 70) {
        c.pose('cast');
        c.fx.explosion(c.def.x, c.def.y - 80, '#ff7b2a', 1.8);
        c.final({ dmg: 140, kb: [7, -10], elem: 'fire', linger: 30 });
        c.def.status.burn = 120;
      }
    },
  },
};

// ---------------------------------------------------------------------------
// 8. ZEN — Iron Monk
// ---------------------------------------------------------------------------
const ZEN = {
  id: 'zen', name: 'ZEN', title: 'Iron Monk',
  bio: 'A temple guardian whose staff turns arrows into dust and fury into calm. Outlasts everyone.',
  set: 'armed', accessories: ['beads'],
  weapon: { kind: 'staff', len: 74, grip: 46, handle: '#8a5a2b' },
  reach: 1.2, tempo: 1.02,
  stats: { hp: 1060, power: 0.98, speed: 0.98, defense: 1.08, weight: 1.08, jump: 1, stamRegen: 1.2 },
  bars: { power: 3, speed: 3, defense: 4, range: 4, difficulty: 2 },
  skins: [
    skin('Jade', '#47d16c', '#ffe8a3'),
    skin('Saffron', '#ffb02e', '#8a2be2', { price: 300 }),
    skin('Stone', '#9aa3ad', '#47d16c', { price: 400 }),
    skin('Lotus', '#ff8fb8', '#fff3c4', { price: 500 }),
  ],
  trailColor: '#a6ffbf',
  victoryPose: 'victoryBow', introPose: 'meditate',
  unlock: { tower: 'jade', cost: 1800 },
  specials: {
    S1: {
      name: 'Staff Whirl', special: true, tag: 'aoe', dur: 40, stam: 14,
      keys: [[0, 'armed'], [4, { ...staffSpin(0) }], [10, { ...staffSpin(180) }], [16, { ...staffSpin(360) }], [22, { ...staffSpin(540) }], [28, { ...staffSpin(720) }], [40, 'armed']],
      ev: [[4, 'aura', { kind: 'spin', r: 100, life: 26, color: '#a6ffbf', reflect: true, sfx: 'wind', hit: H({ dmg: 16, stun: 18, kb: [4, -3], rehit: 8, sfx: 'hitLight', spark: 'light', stop: 3 }) }]],
    },
    S2: {
      name: 'Vaulting Kick', special: true, tag: 'rush', range: [100, 500], dur: 50, stam: 15, until: 'land', landLag: 10,
      keys: [[0, 'crouch'], [6, 'jumpTuck', 'snap'], [18, 'flipTuck'], [26, 'airKick'], [50, 'airKick']],
      vel: [[6, 8.5, -15]],
      ev: [[6, 'sfx', { name: 'jump' }]],
      hits: [{ f: [20, 50], a: 'kneeF', b: 'footF', r: 20, dmg: 52, stun: 26, kb: [6, -6], stop: 8, sfx: 'hitHeavy', spark: 'heavy', kd: true }],
    },
    S3: {
      name: 'Meditate', special: true, tag: 'heal', dur: 70, stam: 30,
      keys: [[0, 'armed'], [10, 'meditate'], [60, 'meditate'], [70, 'armed']],
      ev: [[10, 'heal', { amt: 110, frames: 120 }], [10, 'fx', { ring: 90, color: '#a6ffbf', oy: 40 }]],
    },
    SA: {
      name: 'Falling Staff', special: true, tag: 'dive', air: true, dur: 40, stam: 12, until: 'land', landLag: 12, trail: true,
      keys: [[0, 'airSlashWind'], [6, 'airDiveArmed', 'snap'], [40, 'airDiveArmed']],
      vel: [[0, 0, -3], [6, 4, 13]], gravity: 0.2,
      hits: [{ f: [6, 40], a: 'wBase', b: 'wTip', r: 16, dmg: 44, stun: 22, kb: [5, -7], stop: 6, sfx: 'hitMedium', spark: 'medium', bounce: -10 }],
    },
  },
  ult: {
    name: 'JADE DRAGON',
    move: {
      name: 'Jade Dragon', special: true, isUlt: true, dur: 38, trail: true,
      keys: [[0, 'armedLow'], [6, 'thrust', 'snap'], [24, 'thrust'], [38, 'armed']],
      vel: [[6, 15]], ev: [[0, 'invuln', { n: 14 }]],
      hits: [{ f: [7, 22], a: 'wBase', b: 'wTip', r: 26, dmg: 22, lock: true, unblock: true, stun: 30, kb: [2, 0] }],
    },
    script(c, t) {
      if (t === 1) {
        c.face();
        c.dark(0.7);
        c.zoom(1.4);
      }
      barrage(c, t, 2, 56, 6, ['riseSlash', 'chop', 'thrust', 'airSpin', 'slash'], (k) => ({ dmg: 12, spark: 'medium', sfx: k % 2 ? 'hitMedium' : 'hitLight', shake: 0.07 }), (k) => {
        c.place(80);
        c.ghost(0.45);
        const [cx, cy] = c.center();
        c.fx.ring(cx, cy, 10, 90, '#a6ffbf', 12, 5);
        c.def.lockPose = k % 2 ? 'hurtHigh' : 'hurtMid';
      });
      if (t === 56) {
        c.pose('castWind');
        c.sfx('charge');
      }
      if (t > 56 && t < 74) {
        // the dragon coils
        const [cx, cy] = c.center();
        const a = t * 0.5;
        c.fx.dot(cx + Math.cos(a) * 90, cy + Math.sin(a) * 50, 0, -0.5, '#47d16c', 30, 6, 0, true);
        c.fx.dot(cx + Math.cos(a + 3) * 90, cy + Math.sin(a + 3) * 50, 0, -0.5, '#ffe8a3', 30, 4, 0, true);
      }
      if (t === 74) {
        c.pose('cast');
        c.fx.burst(c.def.x, c.def.y - 90, '#47d16c', 50, 22);
        c.final({ dmg: 150, kb: [12, -10], wb: true, linger: 30 });
      }
    },
  },
};
function staffSpin(rot) {
  return { hip: [0, 78], lean: 4, head: 0, hf: [10, 2], hb: [-6, -4], ff: [20, 0], fb: [-22, 0], w: rot, w2: null, wl: 0, rot: 0 };
}

// ---------------------------------------------------------------------------
// 9. VIPER — Chain Fang
// ---------------------------------------------------------------------------
const VIPER = {
  id: 'viper', name: 'VIPER', title: 'Chain Fang',
  bio: 'A desert mercenary with a bladed chain and a poisoned grin. Never fight her at arm\'s length.',
  set: 'armed', accessories: ['mask', 'ponytail'],
  weapon: { kind: 'chain', len: 46, extend: 2.6, metal: '#c9d1db' },
  reach: 1.1,
  stats: { hp: 950, power: 1, speed: 1.06, defense: 0.98, weight: 0.95, jump: 1.02 },
  bars: { power: 3, speed: 4, defense: 2, range: 5, difficulty: 4 },
  skins: [
    skin('Viper', '#a6ff4d', '#3d8b2a', { hair: '#1b3a12', mask: '#1d1d24' }),
    skin('Cobra', '#ffcc33', '#1d1d24', { hair: '#3a2a10', mask: '#3a2a10', price: 300 }),
    skin('Coral', '#ff6f61', '#2a9d8f', { hair: '#2a1a1a', price: 400 }),
    skin('Albino', '#f2f2f2', '#e63946', { hair: '#ffffff', mask: '#e63946', price: 500 }),
  ],
  trailColor: '#c8ff8a',
  victoryPose: 'victoryArms', introPose: 'pointFwd',
  unlock: { tower: 'serpent', cost: 2000 },
  specials: {
    S1: {
      name: 'Chain Lash', special: true, tag: 'poke', range: [100, 300], dur: 36, stam: 12, trail: true,
      keys: [[0, 'armed'], [6, 'thrustWind'], [10, { ...lash() }, 'snap'], [18, { ...lash() }], [36, 'armed']],
      ev: [[10, 'sfx', { name: 'chain' }]],
      hits: [{ f: [10, 14], a: 'handF', b: 'wTip', r: 16, dmg: 46, stun: 22, kb: [6, -2], stop: 7, sfx: 'hitSlash', spark: 'slash' }],
    },
    S2: {
      name: 'Chain Hook', special: true, tag: 'proj', range: [180, 520], dur: 40, stam: 14,
      keys: [[0, 'armed'], [6, 'throwWind'], [10, 'throwRelease', 'snap'], [34, 'throwRelease'], [40, 'armed']],
      ev: [[10, 'proj', { kind: 'kunai', spd: 20, r: 12, life: 26, color: '#c9d1db', sfx: 'chain', tether: true, hit: H({ dmg: 30, stun: 30, kb: [0, 0], pull: true, sfx: 'chain', spark: 'medium' }) }]],
    },
    S3: {
      name: 'Venom Spit', special: true, tag: 'proj', range: [150, 650], dur: 34, stam: 13,
      keys: [[0, 'armed'], [6, 'castWind'], [12, 'pointFwd', 'snap'], [24, 'pointFwd'], [34, 'armed']],
      ev: [[12, 'proj', { kind: 'venom', from: 'head', spd: 10, vy: -8, grav: 0.38, r: 13, life: 120, color: '#9dff5c', sfx: 'poison', hit: H({ dmg: 28, stun: 20, kb: [3, -2], elem: 'poison', status: { poison: 320 }, sfx: 'poison', spark: 'light' }) }]],
    },
    SA: {
      name: 'Sky Lash', special: true, tag: 'poke', air: true, dur: 30, stam: 11, trail: true,
      keys: [[0, 'airSlashWind'], [6, { ...lashAir() }, 'snap'], [14, { ...lashAir() }], [30, 'fall']],
      gravity: 0.35, vel: [[0, -1, -2]],
      ev: [[6, 'sfx', { name: 'chain' }]],
      hits: [{ f: [6, 10], a: 'handF', b: 'wTip', r: 16, dmg: 38, stun: 20, kb: [5, -4], stop: 6, sfx: 'hitSlash', spark: 'slash' }],
    },
  },
  ult: {
    name: 'SERPENT COIL',
    move: {
      name: 'Serpent Coil', special: true, isUlt: true, dur: 40,
      keys: [[0, 'throwWind'], [8, 'throwRelease', 'snap'], [30, 'throwRelease'], [40, 'armed']],
      ev: [[0, 'invuln', { n: 12 }], [8, 'proj', { kind: 'kunai', spd: 24, r: 18, life: 30, color: '#c9d1db', sfx: 'chain', tether: true, power: 9, hit: { dmg: 20, lock: true, unblock: true, stun: 30, kb: [2, 0] } }]],
    },
    script(c, t) {
      if (t === 1) {
        c.face();
        c.dark(0.7);
        c.zoom(1.3);
        c.sfx('chain');
      }
      // pull in
      if (t < 16) {
        c.pose('grabHold');
        const tx = c.att.x + c.att.facing * 110;
        c.def.x += (tx - c.def.x) * 0.25;
        c.def.lockPose = 'hurtAir';
      }
      // whirl overhead and slam left/right
      if (t >= 16 && t < 76) {
        const k = (t - 16) / 20;
        const phase = k % 1;
        const a = Math.PI * phase;
        const dir = Math.floor(k) % 2 ? -1 : 1;
        c.pose(phase < 0.5 ? 'throwToss' : 'slam');
        c.defRel(Math.cos(a) * 140 * dir, -Math.sin(a) * 200 - 10);
        c.def.lockPose = 'tumble';
        c.def.lockRot = t * 20;
        if ((t - 16) % 20 === 19) {
          c.fx.dust(c.def.x, 0, 14, 0, undefined, 1.5);
          c.hit({ dmg: 22, spark: 'heavy', sfx: 'hitHeavy', shake: 0.3 });
          c.world.arenaImpact(c.def.x, 0, 0.8);
        }
      }
      if (t === 80) {
        c.pose('chop');
        c.def.status.poison = 300;
        c.final({ dmg: 120, kb: [10, -10], elem: 'poison', linger: 28 });
      }
    },
  },
};
function lash() {
  return { hip: [14, 72], lean: 26, head: 0, hf: [62, 6], hb: [-22, -26], ff: [36, 0], fb: [-26, 0], w: 4, w2: null, wl: 1, rot: 0 };
}
function lashAir() {
  return { hip: [4, 80], lean: 22, head: 0, hf: [52, -20], hb: [-20, 6], ff: [20, 40], fb: [-14, 30], w: -32, w2: null, wl: 1, rot: 0 };
}

// ---------------------------------------------------------------------------
// 10. MORTIS — The Harvester
// ---------------------------------------------------------------------------
const MORTIS = {
  id: 'mortis', name: 'MORTIS', title: 'The Harvester',
  bio: 'A restless spirit bound to a scythe that feeds on stamina and souls alike. Every cut makes him stronger.',
  set: 'armed', accessories: ['hood'],
  weapon: { kind: 'scythe', len: 84, grip: 26, metal: '#d9fff5', handle: '#3a3a44' },
  reach: 1.25, tempo: 1.08,
  stats: { hp: 1000, power: 1.06, speed: 0.95, defense: 1, weight: 1.02, jump: 1 },
  bars: { power: 4, speed: 2, defense: 3, range: 5, difficulty: 3 },
  skins: [
    skin('Harvester', '#5ff0c8', '#2a1b3d', { cloak: '#1d1430' }),
    skin('Bone', '#efe6d2', '#8a1c1c', { cloak: '#2b2b2b', price: 300 }),
    skin('Wraith', '#8a8fff', '#0f0f2a', { cloak: '#151540', price: 400 }),
    skin('Pumpkin', '#ff8c1a', '#2b1a0a', { cloak: '#1a1a1a', price: 500 }),
  ],
  trailColor: '#5ff0c8',
  victoryPose: 'victoryArmed', introPose: 'victoryRest',
  unlock: { tower: 'necro', cost: 2500 },
  specials: {
    S1: {
      name: 'Soul Reap', special: true, tag: 'poke', range: [80, 260], dur: 42, stam: 14, trail: true,
      keys: [[0, 'armed'], [8, 'chopWind'], [15, 'chop', 'snap'], [24, 'chop'], [42, 'armed']],
      ev: [[15, 'sfx', { name: 'swingBlade', pitch: 0.8 }]],
      hits: [{ f: [15, 19], a: 'wBase', b: 'wTip', r: 22, dmg: 56, stun: 26, kb: [7, -5], drain: 0.5, elem: 'shadow', stop: 9, sfx: 'hitSlash', spark: 'slashHeavy' }],
    },
    S2: {
      name: 'Phantom Plunge', special: true, tag: 'tp', dur: 60, stam: 16, until: 'land', landLag: 14, trail: true,
      keys: [[0, 'armed'], [4, 'crouch'], [16, 'airSlashWind'], [22, 'airDiveArmed', 'snap'], [60, 'airDiveArmed']],
      ev: [[4, 'hide', { n: 14 }], [4, 'sfx', { name: 'shadow' }], [15, 'tp', { to: 'above' }], [16, 'show', {}], [16, 'vel', { vx: 0, vy: 0 }], [22, 'vel', { vx: 2, vy: 16 }]],
      gravity: 0, air: false,
      hits: [{ f: [22, 60], a: 'wBase', b: 'wTip', r: 18, dmg: 55, stun: 26, kb: [4, -8], launch: true, elem: 'shadow', stop: 8, sfx: 'hitSlash', spark: 'slashHeavy' }],
    },
    S3: {
      name: 'Grave Hands', special: true, tag: 'zone', range: [120, 600], dur: 40, stam: 15,
      keys: [[0, 'armed'], [8, 'castWind'], [14, 'castDown', 'snap'], [30, 'castDown'], [40, 'armed']],
      ev: [[14, 'strike', { kind: 'hands', dist: 130, step: 130, count: 4, stagger: 7, delay: 10, active: 12, w: 80, h: 120, color: '#5ff0c8', hit: H({ dmg: 46, stun: 28, kb: [2, -13], launch: true, elem: 'shadow', drain: 0.3, sfx: 'hitMedium' }) }]],
    },
    SA: {
      name: 'Reaper Spin', special: true, tag: 'poke', air: true, dur: 32, stam: 12, trail: true,
      keys: [[0, 'airSlashWind'], [5, { ...scytheSpin(0) }], [11, { ...scytheSpin(180) }], [17, { ...scytheSpin(360) }], [32, 'fall']],
      gravity: 0.3, vel: [[0, 0, -4]],
      hits: [
        { f: [5, 9], a: 'wBase', b: 'wTip', r: 18, dmg: 26, stun: 18, kb: [3, -5], stop: 4, sfx: 'hitSlash', spark: 'slash', drain: 0.3 },
        { f: [12, 16], a: 'wBase', b: 'wTip', r: 18, dmg: 30, stun: 22, kb: [6, -4], stop: 6, sfx: 'hitSlash', spark: 'slash', drain: 0.3 },
      ],
    },
  },
  ult: {
    name: 'FINAL HARVEST',
    move: {
      name: 'Final Harvest', special: true, isUlt: true, dur: 44, trail: true,
      keys: [[0, 'armed'], [6, 'chopWind'], [12, 'chop', 'snap'], [28, 'chop'], [44, 'armed']],
      vel: [[6, 12]], ev: [[0, 'invuln', { n: 14 }]],
      hits: [{ f: [12, 24], a: 'wBase', b: 'wTip', r: 30, dmg: 22, lock: true, unblock: true, stun: 30, kb: [2, 0] }],
    },
    script(c, t) {
      if (t === 1) {
        c.face();
        c.dark(0.95);
        c.zoom(1.35);
        c.sfx('shadow');
      }
      if (t < 60) {
        c.pose('castUp');
        c.def.y = Math.max(-120, c.def.y - 2);
        c.def.lockPose = 'hurtAir';
        // soul wisps flow from the victim to the reaper
        if (t % 2 === 0) {
          const [cx, cy] = c.center();
          const dx = c.att.x - cx, dy = c.att.y - 120 - cy;
          c.fx.dot(cx + rand(-20, 20), cy + rand(-30, 30), dx / 30, dy / 30, '#5ff0c8', 30, 4, 0, true);
        }
        if (t % 10 === 0) {
          c.hit({ dmg: 10, spark: 'light', sfx: 'shadow', elem: 'shadow', vol: 0.6 });
          c.att.hp = Math.min(c.att.maxHp, c.att.hp + 14);
        }
      }
      if (t === 60) {
        c.place(90);
        c.pose('chopWind');
        c.sfx('charge');
      }
      if (t === 72) {
        c.pose('chop');
        c.fx.slashMark(c.def.x, c.def.y - 90, -0.6, 420, '#5ff0c8', 18, 22);
        c.fx.slashMark(c.def.x, c.def.y - 90, -0.6, 380, '#ffffff', 14, 10);
        c.final({ dmg: 145, kb: [9, -12], elem: 'shadow', linger: 30 });
      }
    },
  },
};
function scytheSpin(rot) {
  return { hip: [0, 80], lean: 10, head: 0, hf: [30, -10], hb: [-20, 10], ff: [22, 42], fb: [-10, 30], w: -rot, w2: null, wl: 0, rot: 0 };
}

// ---------------------------------------------------------------------------
// 11. UNIT-7 — Steel Ronin
// ---------------------------------------------------------------------------
const UNIT7 = {
  id: 'unit7', name: 'UNIT-7', title: 'Steel Ronin',
  bio: 'A decommissioned war machine that learned honor from old samurai films. Mines, rockets, zero mercy.',
  set: 'fist', accessories: ['visor'], eyeShape: 'visor',
  weapon: { kind: 'cannon', metal: '#aab4c0' },
  stats: { hp: 1020, power: 1.02, speed: 0.96, defense: 1.06, weight: 1.15, jump: 0.96 },
  bars: { power: 3, speed: 2, defense: 4, range: 4, difficulty: 3 },
  skins: [
    skin('Steel', '#c7d0db', '#ff4d6d', { eye: '#ff4d6d' }),
    skin('Gunmetal', '#4a5260', '#3dd6ff', { eye: '#3dd6ff', price: 300 }),
    skin('Gold Unit', '#e8c15a', '#ffffff', { eye: '#ffffff', price: 400 }),
    skin('Stealth', '#1f2229', '#3dff6e', { eye: '#3dff6e', price: 500 }),
  ],
  trailColor: '#ff8fa3',
  victoryPose: 'victoryFist', introPose: 'pointFwd',
  unlock: { tower: 'foundry', cost: 2500 },
  specials: {
    S1: {
      name: 'Plasma Shot', special: true, tag: 'proj', range: [160, 1000], dur: 28, stam: 10,
      keys: [[0, 'stance'], [5, 'pointFwd', 'snap'], [18, 'pointFwd'], [28, 'stance']],
      ev: [[7, 'proj', { kind: 'plasma', spd: 17, r: 12, life: 80, color: '#ff4d6d', sfx: 'laser', hit: H({ dmg: 34, stun: 18, kb: [5, -1], elem: 'energy', sfx: 'hitMedium', spark: 'medium' }) }]],
    },
    S2: {
      name: 'Rocket Jump', special: true, tag: 'anti', dur: 30, stam: 14, until: 'land', landLag: 8,
      keys: [[0, 'crouch'], [4, 'jumpTuck', 'snap'], [14, 'airKick'], [30, 'fall']],
      vel: [[4, 3, -19]],
      ev: [[0, 'invuln', { n: 10 }], [4, 'sfx', { name: 'explosion', vol: 0.5 }], [4, 'fx', { explode: 0.4, oy: 0, color: '#ff8a2a' }]],
      hits: [{ f: [4, 16], a: 'kneeF', b: 'footF', r: 26, dmg: 50, stun: 28, kb: [3, -13], launch: true, stop: 8, sfx: 'hitHeavy', spark: 'heavy' }],
    },
    S3: {
      name: 'Proximity Mine', special: true, tag: 'trap', dur: 30, stam: 15,
      keys: [[0, 'stance'], [6, 'crouchPalm', 'snap'], [20, 'crouchPalm'], [30, 'stance']],
      ev: [[8, 'mine', { ox: 50, color: '#ff4d6d', hit: H({ dmg: 60, stun: 30, kb: [3, -14], launch: true, elem: 'fire', sfx: 'hitHeavy', spark: 'heavy' }) }]],
    },
    SA: {
      name: 'Air Strike', special: true, tag: 'proj', air: true, dur: 28, stam: 10,
      keys: [[0, 'airWind'], [6, { ...castAir() }, 'snap'], [28, 'fall']],
      gravity: 0.3, vel: [[0, -2, -3]],
      ev: [[6, 'proj', { kind: 'plasma', spd: 16, ang: 0.65, r: 12, life: 60, color: '#ff4d6d', sfx: 'laser', hit: H({ dmg: 30, stun: 18, kb: [4, -3], elem: 'energy' }) }]],
    },
  },
  ult: {
    name: 'ORBITAL STRIKE',
    move: {
      name: 'Orbital Strike', special: true, isUlt: true, dur: 48,
      keys: [[0, 'stance'], [8, 'pointFwd', 'snap'], [36, 'pointFwd'], [48, 'stance']],
      ev: [[0, 'invuln', { n: 12 }], [8, 'beam', { life: 22, w: 34, color: '#ff4d6d', hit: { dmg: 20, lock: true, unblock: true, stun: 30, kb: [2, 0] } }]],
    },
    script(c, t) {
      if (t === 1) {
        c.dark(0.8);
        c.zoom(1.0, c.def.x, c.def.y - 200);
        c.sfx('mine');
      }
      if (t < 50) {
        c.pose('pointUp');
        // targeting reticle
        const [cx, cy] = c.center();
        if (t % 4 === 0) c.fx.ring(cx, cy, 120 - t * 2, 20, '#ff4d6d', 8, 3);
        if (t % 10 === 0) c.sfx('mine', { vol: 0.5, pitch: 1 + t / 50 });
      }
      if (t >= 50 && t < 90) {
        const [cx, cy] = c.center();
        for (let i = 0; i < 2; i++) c.fx.spark(cx + rand(-40, 40), -900 + rand(0, 900), Math.PI / 2, 30, '#ff8fa3', 10, 60, 6);
        c.fx.flare(cx, cy, 160, '#ff4d6d', 4);
        if (t === 50) {
          c.sfx('beam');
          c.flash('#ffd0e0', 0.6);
        }
        if (t % 6 === 0) c.hit({ dmg: 12, spark: 'medium', sfx: 'hitMedium', elem: 'energy', shake: 0.12 });
        c.def.lockPose = 'hurtMid';
      }
      if (t === 92) {
        c.fx.explosion(c.def.x, c.def.y - 60, '#ff4d6d', 1.6);
        c.final({ dmg: 140, kb: [4, -14], elem: 'fire', linger: 30 });
      }
    },
  },
};

// ---------------------------------------------------------------------------
// 12. OMEGA — The Void (final boss)
// ---------------------------------------------------------------------------
const OMEGA = {
  id: 'omega', name: 'OMEGA', title: 'The Void',
  bio: 'The thing at the top of the last tower. It does not speak. It does not stop. It only unmakes.',
  set: 'fist', accessories: ['horns'], scale: 1.22, lineW: 8,
  weapon: { kind: 'claw' },
  tempo: 1.05,
  stats: { hp: 1250, power: 1.18, speed: 1.0, defense: 1.1, weight: 1.3, jump: 1 },
  bars: { power: 5, speed: 3, defense: 5, range: 4, difficulty: 5 },
  skins: [
    skin('Void', '#1a1028', '#c58bff', { outline: '#c58bff', eye: '#ffffff', horn: '#c58bff' }),
    skin('Abyss', '#05141f', '#3dd6ff', { outline: '#3dd6ff', eye: '#ffffff', horn: '#3dd6ff', price: 600 }),
    skin('Crimson King', '#1f0508', '#ff3d3d', { outline: '#ff3d3d', eye: '#ffe066', horn: '#ff3d3d', price: 800 }),
    skin('Radiant', '#fff8e6', '#ffb800', { outline: '#ffb800', eye: '#000000', horn: '#ffb800', price: 1000 }),
  ],
  trailColor: '#c58bff',
  victoryPose: 'victoryArms', introPose: 'aura',
  unlock: { tower: 'void', cost: 5000 },
  boss: true,
  specials: {
    S1: {
      name: 'Void Orb', special: true, tag: 'proj', range: [200, 1000], dur: 40, stam: 15,
      keys: [[0, 'stance'], [8, 'castWind'], [14, 'cast', 'snap'], [28, 'cast'], [40, 'stance']],
      ev: [[14, 'proj', { kind: 'void', spd: 6.5, r: 26, life: 170, power: 3, vortex: 1.6, color: '#c58bff', sfx: 'shadow', hit: H({ dmg: 66, stun: 26, kb: [5, -6], elem: 'void', sfx: 'hitHeavy', spark: 'heavy' }) }]],
    },
    S2: {
      name: 'Rift Step', special: true, tag: 'tp', dur: 40, stam: 15, trail: true,
      keys: [[0, 'stance'], [4, 'crouch'], [14, 'heavyWind'], [18, 'heavyPunch', 'snap'], [26, 'heavyPunch'], [40, 'stance']],
      ev: [[3, 'hide', { n: 12 }], [3, 'sfx', { name: 'teleport' }], [12, 'tp', { to: 'behind', dist: 90 }], [13, 'show', {}]],
      hits: [{ f: [18, 22], a: 'elbowF', b: 'handF', r: 24, dmg: 60, stun: 28, kb: [10, -6], kd: true, wb: true, elem: 'void', stop: 10, sfx: 'hitHeavy', spark: 'heavy' }],
    },
    S3: {
      name: 'Black Spikes', special: true, tag: 'zone', range: [100, 700], dur: 42, stam: 16,
      keys: [[0, 'stance'], [8, 'castWind'], [14, 'castDown', 'snap'], [32, 'castDown'], [42, 'stance']],
      ev: [[14, 'strike', { kind: 'spikes', dist: 120, step: 120, count: 5, stagger: 6, delay: 8, active: 10, w: 70, h: 150, color: '#c58bff', hit: H({ dmg: 40, stun: 26, kb: [3, -13], launch: true, elem: 'void', sfx: 'hitMedium' }) }]],
    },
    SA: {
      name: 'Void Rain', special: true, tag: 'proj', air: true, dur: 32, stam: 13,
      keys: [[0, 'airWind'], [8, { ...castAir() }, 'snap'], [32, 'fall']],
      gravity: 0.25, vel: [[0, -1, -3]],
      ev: [[8, 'proj', { kind: 'void', count: 2, spread: 0.4, spd: 9, ang: 0.6, r: 18, life: 80, color: '#c58bff', sfx: 'shadow', hit: H({ dmg: 34, stun: 20, kb: [4, -4], elem: 'void' }) }]],
    },
  },
  ult: {
    name: 'ANNIHILATION',
    move: {
      name: 'Annihilation', special: true, isUlt: true, dur: 44,
      keys: [[0, 'stance'], [6, 'grabReach', 'snap'], [24, 'grabReach'], [44, 'stance']],
      vel: [[6, 14]], ev: [[0, 'invuln', { n: 14 }]],
      hits: [{ f: [7, 24], area: [10, 60, 90, 120], dmg: 25, lock: true, unblock: true, stun: 30, kb: [2, 0] }],
    },
    script(c, t) {
      if (t === 1) {
        c.face();
        c.dark(1);
        c.zoom(1.2);
        c.sfx('shadow', { pitch: 0.6 });
      }
      if (t < 30) {
        c.pose('grabHold');
        c.defRel(60 * c.att.scale, -30);
        c.defPose('grabbed');
      }
      if (t === 30) {
        c.pose('aura');
        c.sfx('charge', { pitch: 0.5 });
      }
      if (t >= 30 && t < 90) {
        c.def.y = Math.max(-200, c.def.y - 3);
        c.def.lockPose = 'hurtAir';
        c.def.lockRot = Math.sin(t * 0.3) * 30;
        const [cx, cy] = c.center();
        if (t % 5 === 0) {
          c.fx.ring(cx, cy, 200, 10, '#c58bff', 14, 4);
          c.hit({ dmg: 10, spark: 'medium', sfx: t % 10 ? 'shadow' : 'hitMedium', elem: 'void', shake: 0.1, vol: 0.7 });
        }
        for (let i = 0; i < 2; i++) {
          const a = rand(0, Math.PI * 2);
          c.fx.dot(cx + Math.cos(a) * 220, cy + Math.sin(a) * 220, -Math.cos(a) * 7, -Math.sin(a) * 7, '#c58bff', 30, 3, 0, true);
        }
      }
      if (t === 92) {
        c.fx.explosion(c.def.x, c.def.y - 80, '#c58bff', 2);
        c.flash('#ffffff', 0.9);
        c.final({ dmg: 170, kb: [10, -12], elem: 'void', shake: 1, linger: 30 });
      }
    },
  },
};

// ---------------------------------------------------------------------------
export const FIGHTER_DEFS = [KAI, ROSA, NYX, BRUTUS, VOLT, YUKI, IGNIS, ZEN, VIPER, MORTIS, UNIT7, OMEGA];
export const STARTERS = ['kai', 'rosa', 'nyx'];

const built = new Map();
export function getFighter(id) {
  if (built.has(id)) return built.get(id);
  const def = FIGHTER_DEFS.find((d) => d.id === id);
  if (!def) throw new Error('Unknown fighter ' + id);
  const base = def.set === 'fist' ? FIST_SET : ARMED_SET;
  const tempo = def.tempo || 1;
  const moves = {};
  for (const k in base) {
    let m = scaleMove(base[k], tempo);
    if (def.reach && def.reach !== 1) m = withReach(m, def.reach);
    m.id = k;
    moves[k] = m;
  }
  for (const k in def.specials) moves[k] = { ...def.specials[k], id: k, special: true };
  // per-fighter: weapon users hit with weapon base too for very long weapons
  const out = {
    ...def,
    moves,
    poseSet: SET_POSES[def.set] || SET_POSES.fist,
  };
  if (def.ult) {
    out.ult = { ...def.ult, move: { ...def.ult.move, id: 'ULT' } };
    moves.ULT = out.ult.move;
  }
  built.set(id, out);
  return out;
}

export function allFighters() {
  return FIGHTER_DEFS.map((d) => getFighter(d.id));
}
