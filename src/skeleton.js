// Stickman skeleton: pose description -> joint positions (2-bone IK) -> drawing.
//
// Poses are authored in "facing space": x points the way the fighter faces,
// y points UP, origin is the ground point under the fighter. Hands are relative
// to the shoulder, feet relative to the origin. World space has y pointing down.

import { DEG, clamp, lerp, shade, rgba } from './util.js';

export const BONES = {
  spine: 50,
  neck: 7,
  headR: 14,
  uarm: 31,
  larm: 30,
  thigh: 42,
  shin: 42,
};

export const DEFAULT_POSE = {
  hip: [0, 80],
  lean: 0,
  head: 0,
  hf: [22, -44],
  hb: [-12, -46],
  ff: [14, 0],
  fb: [-16, 0],
  w: null,
  w2: null,
  wl: 0,
  rot: 0,
};

const POSE_KEYS2 = ['hip', 'hf', 'hb', 'ff', 'fb'];

export function makePose(over) {
  const p = {
    hip: DEFAULT_POSE.hip.slice(),
    lean: 0,
    head: 0,
    hf: DEFAULT_POSE.hf.slice(),
    hb: DEFAULT_POSE.hb.slice(),
    ff: DEFAULT_POSE.ff.slice(),
    fb: DEFAULT_POSE.fb.slice(),
    w: null,
    w2: null,
    wl: 0,
    rot: 0,
  };
  if (over) applyPose(p, over);
  return p;
}

export function applyPose(p, over) {
  for (const k in over) {
    const v = over[k];
    if (Array.isArray(v)) p[k] = v.slice();
    else p[k] = v;
  }
  return p;
}

export function copyPose(src, dst = makePose()) {
  for (const k of POSE_KEYS2) {
    dst[k][0] = src[k][0];
    dst[k][1] = src[k][1];
  }
  dst.lean = src.lean;
  dst.head = src.head;
  dst.w = src.w;
  dst.w2 = src.w2;
  dst.wl = src.wl;
  dst.rot = src.rot;
  return dst;
}

function lerpAngle(a, b, t) {
  if (a == null) return b;
  if (b == null) return t < 0.5 ? a : b;
  return a + (b - a) * t;
}

// out = lerp(a, b, t). out may alias a.
export function lerpPose(a, b, t, out = makePose()) {
  for (const k of POSE_KEYS2) {
    out[k][0] = lerp(a[k][0], b[k][0], t);
    out[k][1] = lerp(a[k][1], b[k][1], t);
  }
  out.lean = lerp(a.lean, b.lean, t);
  out.head = lerp(a.head, b.head, t);
  out.w = a.w == null && b.w == null ? null : lerpAngle(a.w, b.w, t);
  out.w2 = a.w2 == null && b.w2 == null ? null : lerpAngle(a.w2, b.w2, t);
  out.wl = lerp(a.wl ?? 0, b.wl ?? 0, t);
  out.rot = lerp(a.rot, b.rot, t);
  return out;
}

// Two-bone IK. Returns [jointX, jointY, endX, endY] (facing space, y up).
function ik2(ax, ay, tx, ty, l1, l2, bend) {
  let dx = tx - ax, dy = ty - ay;
  let d = Math.hypot(dx, dy);
  if (d < 1e-4) {
    dx = 0;
    dy = -1;
    d = 1;
  }
  const ux = dx / d, uy = dy / d;
  const dc = clamp(d, Math.abs(l1 - l2) + 0.5, l1 + l2 - 0.01);
  const a = Math.acos(clamp((l1 * l1 + dc * dc - l2 * l2) / (2 * l1 * dc), -1, 1)) * bend;
  const ca = Math.cos(a), sa = Math.sin(a);
  const jx = ax + l1 * (ux * ca - uy * sa);
  const jy = ay + l1 * (ux * sa + uy * ca);
  return [jx, jy, ax + ux * dc, ay + uy * dc];
}

// Solve a pose into world-space joints.
// weapon: {len, grip, kind} (optional), weapon2 same for off-hand.
export function solvePose(pose, ox, oy, facing, scale, weapon, out = {}) {
  const B = BONES;
  const hipX = pose.hip[0], hipY = pose.hip[1];
  const ls = Math.sin(pose.lean * DEG), lc = Math.cos(pose.lean * DEG);
  const neckX = hipX + ls * B.spine, neckY = hipY + lc * B.spine;
  const ha = (pose.lean + pose.head) * DEG;
  const headX = neckX + Math.sin(ha) * (B.neck + B.headR);
  const headY = neckY + Math.cos(ha) * (B.neck + B.headR);
  const neckTopX = neckX + Math.sin(ha) * B.neck, neckTopY = neckY + Math.cos(ha) * B.neck;

  const af = ik2(neckX, neckY, neckX + pose.hf[0], neckY + pose.hf[1], B.uarm, B.larm, -1);
  const ab = ik2(neckX, neckY, neckX + pose.hb[0], neckY + pose.hb[1], B.uarm, B.larm, -1);
  const lf = ik2(hipX, hipY, pose.ff[0], pose.ff[1], B.thigh, B.shin, 1);
  const lb = ik2(hipX, hipY, pose.fb[0], pose.fb[1], B.thigh, B.shin, 1);

  // weapon angle defaults to forearm direction
  let wa = pose.w;
  if (wa == null) wa = Math.atan2(af[3] - af[1], af[2] - af[0]) / DEG;
  let wa2 = pose.w2;
  if (wa2 == null) wa2 = Math.atan2(ab[3] - ab[1], ab[2] - ab[0]) / DEG;

  // whole-body rotation about the hip (positive = head moves forward)
  const r = -pose.rot * DEG;
  const cr = Math.cos(r), sr = Math.sin(r);
  const s = scale, f = facing;
  const W = (px, py, key) => {
    const rx = px - hipX, ry = py - hipY;
    const qx = hipX + rx * cr - ry * sr;
    const qy = hipY + rx * sr + ry * cr;
    out[key + 'X'] = ox + f * qx * s;
    out[key + 'Y'] = oy - qy * s;
  };
  W(hipX, hipY, 'hip');
  W(neckX, neckY, 'neck');
  W(neckTopX, neckTopY, 'neckTop');
  W(headX, headY, 'head');
  W(af[0], af[1], 'elbowF');
  W(af[2], af[3], 'handF');
  W(ab[0], ab[1], 'elbowB');
  W(ab[2], ab[3], 'handB');
  W(lf[0], lf[1], 'kneeF');
  W(lf[2], lf[3], 'footF');
  W(lb[0], lb[1], 'kneeB');
  W(lb[2], lb[3], 'footB');
  out.headR = B.headR * s;
  out.facing = f;
  out.scale = s;
  out.rot = pose.rot;
  out.lean = pose.lean;
  // weapons (angles in world: convert facing-space angle with rotation)
  const worldAng = (a) => {
    const fa = (a - pose.rot) * DEG;
    return Math.atan2(-Math.sin(fa), f * Math.cos(fa));
  };
  if (weapon) {
    const ang = worldAng(wa);
    const len = weapon.len * (1 + ((weapon.extend || 1) - 1) * (pose.wl ?? 0)) * s;
    const grip = (weapon.grip || 0) * s;
    const cx = Math.cos(ang), cy = Math.sin(ang);
    out.wBaseX = out.handFX - cx * grip;
    out.wBaseY = out.handFY - cy * grip;
    out.wTipX = out.handFX + cx * len;
    out.wTipY = out.handFY + cy * len;
    out.wAng = ang;
  }
  if (weapon && weapon.dual) {
    const ang = worldAng(wa2);
    const len = weapon.len * s;
    out.w2BaseX = out.handBX;
    out.w2BaseY = out.handBY;
    out.w2TipX = out.handBX + Math.cos(ang) * len;
    out.w2TipY = out.handBY + Math.sin(ang) * len;
    out.w2Ang = ang;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cloth / hair strands (verlet chain) for headbands, scarves, ponytails, capes
// ---------------------------------------------------------------------------
export class Strand {
  constructor(n, segLen, opts = {}) {
    this.n = n;
    this.seg = segLen;
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.ox = new Float32Array(n);
    this.oy = new Float32Array(n);
    this.gravity = opts.gravity ?? 0.35;
    this.drag = opts.drag ?? 0.9;
    this.stiff = opts.stiff ?? 0;
    this.inited = false;
  }
  reset(x, y) {
    for (let i = 0; i < this.n; i++) {
      this.px[i] = this.ox[i] = x;
      this.py[i] = this.oy[i] = y + i * this.seg;
    }
    this.inited = true;
  }
  // anchor (ax, ay), rest direction (dx, dy) used for slight stiffness
  update(ax, ay, dx, dy, wind = 0) {
    if (!this.inited) this.reset(ax, ay);
    const { px, py, ox, oy, n, seg } = this;
    px[0] = ox[0] = ax;
    py[0] = oy[0] = ay;
    for (let i = 1; i < n; i++) {
      const vx = (px[i] - ox[i]) * this.drag;
      const vy = (py[i] - oy[i]) * this.drag;
      ox[i] = px[i];
      oy[i] = py[i];
      px[i] += vx + wind + dx * this.stiff;
      py[i] += vy + this.gravity + dy * this.stiff;
    }
    for (let k = 0; k < 3; k++) {
      for (let i = 1; i < n; i++) {
        const ddx = px[i] - px[i - 1], ddy = py[i] - py[i - 1];
        const d = Math.hypot(ddx, ddy) || 1;
        const diff = (d - seg) / d;
        if (i === 1) {
          px[i] -= ddx * diff;
          py[i] -= ddy * diff;
        } else {
          px[i] -= ddx * diff * 0.5;
          py[i] -= ddy * diff * 0.5;
          px[i - 1] += ddx * diff * 0.5;
          py[i - 1] += ddy * diff * 0.5;
        }
      }
    }
  }
  draw(ctx, color, w0, w1, outline) {
    const { px, py, n } = this;
    if (!this.inited) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let pass = outline ? 0 : 1; pass < 2; pass++) {
      for (let i = 1; i < n; i++) {
        const t = i / (n - 1);
        ctx.strokeStyle = pass === 0 ? outline : color;
        ctx.lineWidth = lerp(w0, w1, t) + (pass === 0 ? 3 : 0);
        ctx.beginPath();
        ctx.moveTo(px[i - 1], py[i - 1]);
        ctx.lineTo(px[i], py[i]);
        ctx.stroke();
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------
function seg(ctx, ax, ay, bx, by) {
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
}

// Draws the weapon(s) given solved joints.
export function drawWeapon(ctx, J, weapon, look, which = 1) {
  if (!weapon) return;
  const bx = which === 1 ? J.wBaseX : J.w2BaseX;
  const by = which === 1 ? J.wBaseY : J.w2BaseY;
  const tx = which === 1 ? J.wTipX : J.w2TipX;
  const ty = which === 1 ? J.wTipY : J.w2TipY;
  const hx = which === 1 ? J.handFX : J.handBX;
  const hy = which === 1 ? J.handFY : J.handBY;
  if (bx == null) return;
  const s = J.scale;
  const ang = Math.atan2(ty - by, tx - bx);
  const len = Math.hypot(tx - bx, ty - by);
  const metal = look.flash ? '#fff' : weapon.metal || '#dfe6ee';
  const accent = look.flash ? '#fff' : look.accent;
  const ol = look.outline;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (weapon.kind) {
    case 'katana':
    case 'dagger': {
      const grip = weapon.kind === 'katana' ? 12 * s : 6 * s;
      const gx = hx - Math.cos(ang) * grip, gy = hy - Math.sin(ang) * grip;
      // handle
      ctx.strokeStyle = ol;
      ctx.lineWidth = 7 * s;
      ctx.beginPath();
      seg(ctx, gx, gy, tx, ty);
      ctx.stroke();
      ctx.strokeStyle = weapon.handle || '#222';
      ctx.lineWidth = 4.5 * s;
      ctx.beginPath();
      seg(ctx, gx, gy, hx, hy);
      ctx.stroke();
      // blade (slight curve)
      const nx = -Math.sin(ang), ny = Math.cos(ang);
      const curve = (weapon.kind === 'katana' ? 6 : 2) * s * (J.facing || 1);
      const mx = (hx + tx) / 2 + nx * curve * -1, my = (hy + ty) / 2 + ny * curve * -1;
      ctx.strokeStyle = metal;
      ctx.lineWidth = 3.6 * s;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.quadraticCurveTo(mx, my, tx, ty);
      ctx.stroke();
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1.4 * s;
      ctx.stroke();
      ctx.globalAlpha = 1;
      // guard
      ctx.strokeStyle = weapon.guard || '#c9a227';
      ctx.lineWidth = 3 * s;
      ctx.beginPath();
      seg(ctx, hx + nx * 5 * s, hy + ny * 5 * s, hx - nx * 5 * s, hy - ny * 5 * s);
      ctx.stroke();
      break;
    }
    case 'hammer': {
      ctx.strokeStyle = ol;
      ctx.lineWidth = 8 * s;
      ctx.beginPath();
      seg(ctx, bx, by, tx, ty);
      ctx.stroke();
      ctx.strokeStyle = weapon.handle || '#6b4a2b';
      ctx.lineWidth = 5 * s;
      ctx.beginPath();
      seg(ctx, bx, by, tx, ty);
      ctx.stroke();
      // head block perpendicular to shaft
      ctx.translate(tx, ty);
      ctx.rotate(ang);
      const hw = 16 * s, hh = 30 * s;
      ctx.fillStyle = ol;
      ctx.fillRect(-hw / 2 - 2.5 * s, -hh / 2 - 2.5 * s, hw + 5 * s, hh + 5 * s);
      ctx.fillStyle = metal;
      ctx.fillRect(-hw / 2, -hh / 2, hw, hh);
      ctx.fillStyle = accent;
      ctx.fillRect(-hw / 2, -hh / 2, hw, 5 * s);
      ctx.fillRect(-hw / 2, hh / 2 - 5 * s, hw, 5 * s);
      break;
    }
    case 'staff':
    case 'spear': {
      ctx.strokeStyle = ol;
      ctx.lineWidth = 7 * s;
      ctx.beginPath();
      seg(ctx, bx, by, tx, ty);
      ctx.stroke();
      ctx.strokeStyle = weapon.handle || '#8a5a2b';
      ctx.lineWidth = 4 * s;
      ctx.beginPath();
      seg(ctx, bx, by, tx, ty);
      ctx.stroke();
      // bands
      ctx.strokeStyle = accent;
      ctx.lineWidth = 5 * s;
      const band = (t) => {
        const x = bx + (tx - bx) * t, y = by + (ty - by) * t;
        const c = Math.cos(ang) * 3 * s, d = Math.sin(ang) * 3 * s;
        ctx.beginPath();
        seg(ctx, x - c, y - d, x + c, y + d);
        ctx.stroke();
      };
      band(0.04);
      band(0.96);
      if (weapon.kind === 'spear') {
        ctx.translate(tx, ty);
        ctx.rotate(ang);
        ctx.fillStyle = ol;
        ctx.beginPath();
        ctx.moveTo(26 * s, 0);
        ctx.lineTo(-4 * s, -8 * s);
        ctx.lineTo(-4 * s, 8 * s);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = metal;
        ctx.beginPath();
        ctx.moveTo(22 * s, 0);
        ctx.lineTo(-2 * s, -5 * s);
        ctx.lineTo(-2 * s, 5 * s);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'scythe': {
      ctx.strokeStyle = ol;
      ctx.lineWidth = 7 * s;
      ctx.beginPath();
      seg(ctx, bx, by, tx, ty);
      ctx.stroke();
      ctx.strokeStyle = weapon.handle || '#3a3a44';
      ctx.lineWidth = 4 * s;
      ctx.beginPath();
      seg(ctx, bx, by, tx, ty);
      ctx.stroke();
      // curved blade sweeping back from the tip
      ctx.translate(tx, ty);
      ctx.rotate(ang);
      const fdir = J.facing || 1;
      ctx.scale(1, fdir);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(-10 * s, -40 * s, -52 * s, -36 * s);
      ctx.quadraticCurveTo(-18 * s, -22 * s, 0, 4 * s);
      ctx.closePath();
      ctx.fillStyle = ol;
      ctx.lineWidth = 3 * s;
      ctx.strokeStyle = ol;
      ctx.stroke();
      ctx.fillStyle = metal;
      ctx.fill();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.5 * s;
      ctx.beginPath();
      ctx.moveTo(-4 * s, -6 * s);
      ctx.quadraticCurveTo(-12 * s, -36 * s, -48 * s, -35 * s);
      ctx.stroke();
      break;
    }
    case 'chain': {
      // chain-whip: wavy segmented line ending in a blade
      const segs = 10;
      const nx = -Math.sin(ang), ny = Math.cos(ang);
      const wav = (look.time || 0) * 0.4;
      ctx.lineWidth = 3 * s;
      const pts = [];
      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        const off = Math.sin(t * 7 + wav) * 6 * s * t * (1 - t) * 4;
        pts.push([hx + (tx - hx) * t + nx * off, hy + (ty - hy) * t + ny * off]);
      }
      ctx.strokeStyle = ol;
      ctx.lineWidth = 6 * s;
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.stroke();
      ctx.strokeStyle = metal;
      ctx.lineWidth = 2.5 * s;
      ctx.setLineDash([4 * s, 2 * s]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.translate(tx, ty);
      ctx.rotate(ang);
      ctx.fillStyle = ol;
      ctx.beginPath();
      ctx.moveTo(18 * s, 0);
      ctx.lineTo(-3 * s, -7 * s);
      ctx.lineTo(-3 * s, 7 * s);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.moveTo(14 * s, 0);
      ctx.lineTo(-1 * s, -4 * s);
      ctx.lineTo(-1 * s, 4 * s);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'gauntlet':
    case 'claw':
    case 'cannon':
      break; // drawn with the hands
  }
  ctx.restore();
}

// look: { color, outline, accent, lineW, flash, alpha, weapon, accessory, eye, time, glow }
export function drawStickman(ctx, J, look) {
  const s = J.scale;
  const lw = (look.lineW || 7) * s;
  const ol = look.outline || '#0b0b12';
  const col = look.flash ? '#ffffff' : look.color;
  const back = look.flash ? '#e8e8e8' : look.backColor || shade(look.color, -0.32);
  const olw = lw + 4.5 * s;
  ctx.save();
  if (look.alpha != null) ctx.globalAlpha = look.alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const weapon = look.weapon;
  if (look.drawBehind) look.drawBehind(ctx, J, look);
  // back weapon (dual) behind body
  if (weapon && weapon.dual) drawWeapon(ctx, J, weapon, look, 2);

  // Optional soft glow (ultimate ready, auras)
  if (look.glow) {
    ctx.save();
    ctx.globalAlpha = (look.alpha ?? 1) * look.glow.a;
    ctx.strokeStyle = look.glow.color;
    ctx.lineWidth = olw + 10 * s;
    ctx.beginPath();
    seg(ctx, J.hipX, J.hipY, J.neckX, J.neckY);
    seg(ctx, J.neckX, J.neckY, J.elbowFX, J.elbowFY);
    ctx.lineTo(J.handFX, J.handFY);
    seg(ctx, J.neckX, J.neckY, J.elbowBX, J.elbowBY);
    ctx.lineTo(J.handBX, J.handBY);
    seg(ctx, J.hipX, J.hipY, J.kneeFX, J.kneeFY);
    ctx.lineTo(J.footFX, J.footFY);
    seg(ctx, J.hipX, J.hipY, J.kneeBX, J.kneeBY);
    ctx.lineTo(J.footBX, J.footBY);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(J.headX, J.headY, J.headR + 7 * s, 0, Math.PI * 2);
    ctx.fillStyle = look.glow.color;
    ctx.fill();
    ctx.restore();
  }

  // ---- outline pass (everything) ----
  ctx.strokeStyle = ol;
  ctx.lineWidth = olw;
  ctx.beginPath();
  seg(ctx, J.neckX, J.neckY, J.elbowBX, J.elbowBY);
  ctx.lineTo(J.handBX, J.handBY);
  seg(ctx, J.hipX, J.hipY, J.kneeBX, J.kneeBY);
  ctx.lineTo(J.footBX, J.footBY);
  seg(ctx, J.hipX, J.hipY, J.kneeFX, J.kneeFY);
  ctx.lineTo(J.footFX, J.footFY);
  seg(ctx, J.neckX, J.neckY, J.elbowFX, J.elbowFY);
  ctx.lineTo(J.handFX, J.handFY);
  ctx.stroke();
  ctx.lineWidth = olw + 2 * s;
  ctx.beginPath();
  seg(ctx, J.hipX, J.hipY, J.neckTopX, J.neckTopY);
  ctx.stroke();
  ctx.fillStyle = ol;
  ctx.beginPath();
  ctx.arc(J.headX, J.headY, J.headR + 2.6 * s, 0, Math.PI * 2);
  ctx.fill();

  // ---- color pass: back limbs ----
  ctx.strokeStyle = back;
  ctx.lineWidth = lw;
  ctx.beginPath();
  seg(ctx, J.neckX, J.neckY, J.elbowBX, J.elbowBY);
  ctx.lineTo(J.handBX, J.handBY);
  seg(ctx, J.hipX, J.hipY, J.kneeBX, J.kneeBY);
  ctx.lineTo(J.footBX, J.footBY);
  ctx.stroke();

  // torso
  ctx.strokeStyle = col;
  ctx.lineWidth = lw + 2 * s;
  ctx.beginPath();
  seg(ctx, J.hipX, J.hipY, J.neckTopX, J.neckTopY);
  ctx.stroke();

  // front leg
  ctx.lineWidth = lw;
  ctx.beginPath();
  seg(ctx, J.hipX, J.hipY, J.kneeFX, J.kneeFY);
  ctx.lineTo(J.footFX, J.footFY);
  ctx.stroke();

  // head
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.arc(J.headX, J.headY, J.headR, 0, Math.PI * 2);
  ctx.fill();


  // eye
  if (!look.flash && look.eye !== false) {
    const f = J.facing;
    const ang = (-(J.rot || 0) - (J.lean || 0) * 0.3) * (Math.PI / 180);
    const ex = J.headX + f * Math.cos(ang) * J.headR * 0.45;
    const ey = J.headY - 2 * s + Math.sin(ang) * f * J.headR * 0.2;
    ctx.fillStyle = look.eyeColor || '#fff';
    ctx.beginPath();
    if (look.eyeShape === 'visor') {
      ctx.fillRect(ex - 6 * s, ey - 2.2 * s, 10 * s, 4.4 * s);
    } else {
      ctx.ellipse(ex, ey, 2.6 * s, 3.6 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (look.drawFront) look.drawFront(ctx, J, look);

  // front weapon goes between body and front arm for blades held in front
  if (weapon) drawWeapon(ctx, J, weapon, look, 1);

  // front arm
  ctx.strokeStyle = col;
  ctx.lineWidth = lw;
  ctx.beginPath();
  seg(ctx, J.neckX, J.neckY, J.elbowFX, J.elbowFY);
  ctx.lineTo(J.handFX, J.handFY);
  ctx.stroke();

  // hands: fists / gauntlets / claws
  const kind = weapon && weapon.kind;
  if (kind === 'gauntlet' || kind === 'claw' || kind === 'cannon') {
    const drawFist = (x, y, ex, ey, front) => {
      const a = Math.atan2(y - ey, x - ex);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a);
      if (kind === 'gauntlet') {
        ctx.fillStyle = ol;
        ctx.beginPath();
        ctx.arc(0, 0, 9 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = look.flash ? '#fff' : front ? look.accent : shade(look.accent, -0.3);
        ctx.beginPath();
        ctx.arc(0, 0, 6.5 * s, 0, Math.PI * 2);
        ctx.fill();
      } else if (kind === 'claw') {
        ctx.strokeStyle = ol;
        ctx.lineWidth = 5 * s;
        for (const k of [-1, 0, 1]) {
          ctx.beginPath();
          ctx.moveTo(0, k * 4 * s);
          ctx.lineTo(16 * s, k * 6 * s);
          ctx.stroke();
        }
        ctx.strokeStyle = look.flash ? '#fff' : look.accent;
        ctx.lineWidth = 2.2 * s;
        for (const k of [-1, 0, 1]) {
          ctx.beginPath();
          ctx.moveTo(0, k * 4 * s);
          ctx.lineTo(16 * s, k * 6 * s);
          ctx.stroke();
        }
      } else if (kind === 'cannon' && front) {
        ctx.fillStyle = ol;
        ctx.fillRect(-20 * s, -8 * s, 30 * s, 16 * s);
        ctx.fillStyle = look.flash ? '#fff' : weapon.metal || '#aab4c0';
        ctx.fillRect(-18 * s, -6 * s, 26 * s, 12 * s);
        ctx.fillStyle = look.flash ? '#fff' : look.accent;
        ctx.fillRect(6 * s, -4 * s, 4 * s, 8 * s);
      }
      ctx.restore();
    };
    drawFist(J.handBX, J.handBY, J.elbowBX, J.elbowBY, false);
    drawFist(J.handFX, J.handFY, J.elbowFX, J.elbowFY, true);
  }
  ctx.restore();
}

// Hurtboxes from joints: array of capsules
export function hurtCapsules(J, out = []) {
  const s = J.scale;
  out.length = 0;
  out.push({ ax: J.hipX, ay: J.hipY, bx: J.neckX, by: J.neckY, r: 17 * s });
  out.push({ ax: J.headX, ay: J.headY, bx: J.headX, by: J.headY, r: J.headR + 3 * s });
  out.push({ ax: J.hipX, ay: J.hipY, bx: J.footFX, by: J.footFY, r: 11 * s });
  out.push({ ax: J.hipX, ay: J.hipY, bx: J.footBX, by: J.footBY, r: 11 * s });
  return out;
}

export function rgbaColor(c, a) {
  return c.startsWith('#') ? rgba(c, a) : c;
}
