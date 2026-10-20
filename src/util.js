// Small math / helper toolkit shared by every module.

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const sign = (v) => (v < 0 ? -1 : 1);
export const approach = (v, target, step) =>
  v < target ? Math.min(v + step, target) : Math.max(v - step, target);
export const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

// Easing
export const ease = {
  lin: (t) => t,
  in: (t) => t * t,
  out: (t) => 1 - (1 - t) * (1 - t),
  inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  smooth: (t) => t * t * (3 - 2 * t),
  snap: (t) => 1 - Math.pow(1 - t, 4),
  back: (t) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  elastic: (t) =>
    t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1,
};

// Deterministic RNG (mulberry32)
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  const rng = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.range = (lo, hi) => lo + rng() * (hi - lo);
  rng.int = (lo, hi) => Math.floor(lo + rng() * (hi - lo + 1));
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  rng.chance = (p) => rng() < p;
  return rng;
}

// Global non-deterministic helpers (visual randomness only)
export const rand = (lo = 0, hi = 1) => lo + Math.random() * (hi - lo);
export const randInt = (lo, hi) => Math.floor(lo + Math.random() * (hi - lo + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const chance = (p) => Math.random() < p;

// Geometry: closest distance between segments p1-q1 and p2-q2.
export function segSegDist(p1x, p1y, q1x, q1y, p2x, p2y, q2x, q2y) {
  const d1x = q1x - p1x, d1y = q1y - p1y;
  const d2x = q2x - p2x, d2y = q2y - p2y;
  const rx = p1x - p2x, ry = p1y - p2y;
  const a = d1x * d1x + d1y * d1y;
  const e = d2x * d2x + d2y * d2y;
  const f = d2x * rx + d2y * ry;
  let s, t;
  if (a <= 1e-6 && e <= 1e-6) return { d: Math.hypot(rx, ry), x: p1x, y: p1y };
  if (a <= 1e-6) {
    s = 0;
    t = clamp(f / e, 0, 1);
  } else {
    const c = d1x * rx + d1y * ry;
    if (e <= 1e-6) {
      t = 0;
      s = clamp(-c / a, 0, 1);
    } else {
      const b = d1x * d2x + d1y * d2y;
      const denom = a * e - b * b;
      s = denom !== 0 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }
  const cx1 = p1x + d1x * s, cy1 = p1y + d1y * s;
  const cx2 = p2x + d2x * t, cy2 = p2y + d2y * t;
  return { d: Math.hypot(cx1 - cx2, cy1 - cy2), x: (cx1 + cx2) / 2, y: (cy1 + cy2) / 2 };
}

// Capsule {ax, ay, bx, by, r} vs capsule overlap. Returns contact point or null.
export function capsuleHit(c1, c2) {
  const res = segSegDist(c1.ax, c1.ay, c1.bx, c1.by, c2.ax, c2.ay, c2.bx, c2.by);
  return res.d <= c1.r + c2.r ? res : null;
}

// Color helpers
export function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
export function shade(hex, amt) {
  // amt -1..1 : darken / lighten
  const [r, g, b] = hexToRgb(hex);
  const f = (c) => Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
export function mixHex(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  const m = (i) => Math.round(lerp(A[i], B[i], t));
  return `rgb(${m(0)},${m(1)},${m(2)})`;
}

export function formatNum(n) {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
