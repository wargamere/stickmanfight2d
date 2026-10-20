// Verlet ragdoll built from a solved stickman skeleton. Used for KOs.

import { ARENA_HALF } from './fighter.js';
import { rand } from './util.js';

const NODES = ['hip', 'neck', 'neckTop', 'head', 'elbowF', 'handF', 'elbowB', 'handB', 'kneeF', 'footF', 'kneeB', 'footB'];
const LINKS = [
  ['hip', 'neck'], ['neck', 'neckTop'], ['neckTop', 'head'],
  ['neck', 'elbowF'], ['elbowF', 'handF'], ['neck', 'elbowB'], ['elbowB', 'handB'],
  ['hip', 'kneeF'], ['kneeF', 'footF'], ['hip', 'kneeB'], ['kneeB', 'footB'],
  // stiffeners keep the body from folding into a ball
  ['hip', 'head', 0.25], ['neck', 'kneeF', 0.08], ['neck', 'kneeB', 0.08],
];

export class Ragdoll {
  constructor(J, vx, vy, spin = 0) {
    this.p = {};
    this.J = { ...J };
    for (const n of NODES) {
      const x = J[n + 'X'], y = J[n + 'Y'];
      // spin: points above the hip get extra velocity in the spin direction
      const dy = (y - J.hipY) / 100;
      const jvx = vx + rand(-1.2, 1.2) - dy * spin;
      const jvy = vy + rand(-1.2, 1.2);
      this.p[n] = { x, y, ox: x - jvx, oy: y - jvy, r: n === 'head' ? J.headR : 4 };
    }
    this.links = LINKS.map(([a, b, stiff]) => {
      const A = this.p[a], B = this.p[b];
      return { a: A, b: B, len: Math.hypot(A.x - B.x, A.y - B.y), k: stiff ?? 1 };
    });
    this.extra = { wTip: J.wTipX != null, w2: J.w2TipX != null };
    if (this.extra.wTip) {
      this.wLen = Math.hypot(J.wTipX - J.handFX, J.wTipY - J.handFY);
      this.wGrip = Math.hypot(J.wBaseX - J.handFX, J.wBaseY - J.handFY);
      this.wAng = Math.atan2(J.wTipY - J.handFY, J.wTipX - J.handFX) - Math.atan2(J.handFY - J.elbowFY, J.handFX - J.elbowFX);
    }
    if (this.extra.w2) {
      this.w2Len = Math.hypot(J.w2TipX - J.handBX, J.w2TipY - J.handBY);
      this.w2Ang = Math.atan2(J.w2TipY - J.handBY, J.w2TipX - J.handBX) - Math.atan2(J.handBY - J.elbowBY, J.handBX - J.elbowBX);
    }
    this.cx = J.hipX;
    this.cy = J.hipY;
    this.settled = 0;
    this.impacts = 0;
    this.onImpact = null;
  }
  update(gravity = 0.7) {
    let moving = 0;
    for (const n of NODES) {
      const q = this.p[n];
      const vx = (q.x - q.ox) * 0.99, vy = (q.y - q.oy) * 0.99;
      q.ox = q.x;
      q.oy = q.y;
      q.x += vx;
      q.y += vy + gravity;
      moving += Math.abs(vx) + Math.abs(vy);
    }
    for (let it = 0; it < 6; it++) {
      for (const L of this.links) {
        const dx = L.b.x - L.a.x, dy = L.b.y - L.a.y;
        const d = Math.hypot(dx, dy) || 0.001;
        const diff = ((d - L.len) / d) * 0.5 * L.k;
        L.a.x += dx * diff;
        L.a.y += dy * diff;
        L.b.x -= dx * diff;
        L.b.y -= dy * diff;
      }
      for (const n of NODES) {
        const q = this.p[n];
        const floor = -q.r * 0.9;
        if (q.y > floor) {
          const vy = q.y - q.oy;
          if (vy > 6 && n === 'hip' && this.onImpact) this.onImpact(q.x, vy);
          q.y = floor;
          // friction & bounce
          const vx = q.x - q.ox;
          q.ox = q.x - vx * 0.82;
          q.oy = q.y + vy * 0.3;
        }
        const lim = ARENA_HALF - 8;
        if (q.x < -lim || q.x > lim) {
          const vx = q.x - q.ox;
          q.x = q.x < 0 ? -lim : lim;
          q.ox = q.x + vx * 0.4;
        }
      }
    }
    this.cx = this.p.hip.x;
    this.cy = this.p.hip.y;
    if (moving < 1.5) this.settled++;
    this.syncJ();
  }
  syncJ() {
    const J = this.J;
    for (const n of NODES) {
      J[n + 'X'] = this.p[n].x;
      J[n + 'Y'] = this.p[n].y;
    }
    if (this.extra.wTip) {
      const a = Math.atan2(J.handFY - J.elbowFY, J.handFX - J.elbowFX) + this.wAng;
      J.wTipX = J.handFX + Math.cos(a) * this.wLen;
      J.wTipY = J.handFY + Math.sin(a) * this.wLen;
      J.wBaseX = J.handFX - Math.cos(a) * this.wGrip;
      J.wBaseY = J.handFY - Math.sin(a) * this.wGrip;
    }
    if (this.extra.w2) {
      const a = Math.atan2(J.handBY - J.elbowBY, J.handBX - J.elbowBX) + this.w2Ang;
      J.w2BaseX = J.handBX;
      J.w2BaseY = J.handBY;
      J.w2TipX = J.handBX + Math.cos(a) * this.w2Len;
      J.w2TipY = J.handBY + Math.sin(a) * this.w2Len;
    }
    // eye/facing heuristics for the renderer
    J.rot = (Math.atan2(J.headX - J.hipX, -(J.headY - J.hipY)) * 180) / Math.PI * J.facing;
    J.lean = 0;
  }
}
