// Particle & effect system (world space). Pooled, cheap, juicy.

import { rand, TAU, clamp, lerp, pick } from './util.js';
import { drawStickman } from './skeleton.js';

const MAX = 1600;

export class Effects {
  constructor() {
    this.parts = [];
    this.texts = [];
    this.ghosts = [];
    this.bolts = [];
    this.quality = 1; // 1 high, 0.5 low
    this.time = 0;
  }
  clear() {
    this.parts.length = 0;
    this.texts.length = 0;
    this.ghosts.length = 0;
    this.bolts.length = 0;
  }
  n(count) {
    return Math.max(1, Math.round(count * this.quality));
  }
  add(p) {
    if (this.parts.length >= MAX) this.parts.shift();
    p.age = 0;
    this.parts.push(p);
    return p;
  }

  // ------------------------------------------------------------- primitives
  spark(x, y, ang, speed, color, life = 14, len = 18, width = 3) {
    return this.add({
      t: 'spark', x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
      color, life, len, width, drag: 0.86, g: 0.15,
    });
  }
  dot(x, y, vx, vy, color, life = 30, size = 4, g = 0.3, glow = false) {
    return this.add({ t: 'dot', x, y, vx, vy, color, life, size, g, drag: 0.97, glow });
  }
  smoke(x, y, vx, vy, color, life = 30, size = 14, grow = 1.04) {
    return this.add({ t: 'smoke', x, y, vx, vy, color, life, size, grow, drag: 0.92 });
  }
  ring(x, y, r0, r1, color, life = 16, width = 6, squash = 1) {
    return this.add({ t: 'ring', x, y, r0, r1, color, life, width, squash });
  }
  flare(x, y, size, color, life = 8) {
    return this.add({ t: 'flare', x, y, size, color, life });
  }
  shard(x, y, vx, vy, color, life = 50, size = 7) {
    return this.add({
      t: 'shard', x, y, vx, vy, color, life, size, rot: rand(0, TAU), vr: rand(-0.4, 0.4), g: 0.45, drag: 0.99,
    });
  }
  ember(x, y, color, life = 50) {
    return this.add({ t: 'dot', x, y, vx: rand(-0.6, 0.6), vy: rand(-2.5, -0.8), color, life, size: rand(2, 4), g: -0.02, drag: 0.98, glow: true });
  }
  slashMark(x, y, ang, len, color, life = 12, width = 10) {
    return this.add({ t: 'slash', x, y, ang, len, color, life, width });
  }
  text(x, y, str, opts = {}) {
    const t = {
      x, y, str, age: 0,
      life: opts.life ?? 50,
      vy: opts.vy ?? -1.6,
      color: opts.color ?? '#fff',
      size: opts.size ?? 26,
      font: opts.font ?? 'Bangers',
      outline: opts.outline ?? '#000',
      pop: opts.pop ?? true,
      rot: opts.rot ?? rand(-0.08, 0.08),
    };
    this.texts.push(t);
    if (this.texts.length > 40) this.texts.shift();
    return t;
  }
  bolt(x1, y1, x2, y2, color, life = 10, width = 4, segments = 10, jitter = 26) {
    const pts = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const j = i === 0 || i === segments ? 0 : jitter;
      pts.push([lerp(x1, x2, t) + rand(-j, j), lerp(y1, y2, t) + rand(-j, j) * 0.5]);
    }
    this.bolts.push({ pts, color, life, age: 0, width });
  }
  ghost(J, look, life = 18, alpha = 0.5, tint = null) {
    if (this.ghosts.length > 40) this.ghosts.shift();
    this.ghosts.push({ J: { ...J }, look: { ...look, flash: false, glow: null }, life, age: 0, alpha, tint });
  }

  // ------------------------------------------------------------- composites
  hitSpark(x, y, dir, kind = 'light', color = '#ffe9a8') {
    const big = kind === 'heavy' || kind === 'slashHeavy' || kind === 'ult';
    const n = this.n(big ? 16 : kind === 'medium' ? 10 : 7);
    for (let i = 0; i < n; i++) {
      const a = (dir > 0 ? 0 : Math.PI) + rand(-1.1, 1.1);
      this.spark(x, y, a, rand(6, big ? 19 : 13), i % 3 === 0 ? '#ffffff' : color, rand(9, 18), rand(10, big ? 30 : 20), big ? 4 : 3);
    }
    this.flare(x, y, big ? 90 : kind === 'medium' ? 60 : 42, color, big ? 10 : 7);
    this.ring(x, y, 6, big ? 80 : 46, color, big ? 16 : 11, big ? 7 : 4);
    if (kind === 'slash' || kind === 'slashHeavy') {
      const a = rand(-0.9, 0.9) + (dir > 0 ? -0.4 : 0.4);
      this.slashMark(x, y, a, kind === 'slashHeavy' ? 150 : 100, '#ffffff', 10, kind === 'slashHeavy' ? 12 : 8);
      this.slashMark(x, y, a, kind === 'slashHeavy' ? 160 : 110, color, 12, kind === 'slashHeavy' ? 20 : 14);
    }
    if (big) {
      for (let i = 0; i < this.n(6); i++) this.dot(x, y, rand(-6, 6) + dir * 4, rand(-8, -2), color, rand(20, 40), rand(2, 4), 0.35, true);
    }
  }
  blockSpark(x, y, dir) {
    for (let i = 0; i < this.n(8); i++) {
      const a = (dir > 0 ? Math.PI : 0) + rand(-0.9, 0.9);
      this.spark(x, y, a, rand(4, 10), i % 2 ? '#9fd8ff' : '#ffffff', rand(8, 14), rand(8, 16), 2.5);
    }
    this.ring(x, y, 10, 40, '#9fd8ff', 10, 4, 1.6);
    this.flare(x, y, 40, '#9fd8ff', 6);
  }
  parrySpark(x, y) {
    for (let i = 0; i < this.n(22); i++) {
      const a = rand(0, TAU);
      this.spark(x, y, a, rand(8, 20), i % 2 ? '#ffffff' : '#7ff3ff', rand(12, 22), rand(14, 32), 3);
    }
    this.ring(x, y, 10, 120, '#7ff3ff', 18, 8);
    this.ring(x, y, 4, 70, '#ffffff', 12, 4);
    this.flare(x, y, 140, '#bff8ff', 12);
  }
  dust(x, y, n = 6, dir = 0, color = 'rgba(200,190,170,0.5)', power = 1) {
    for (let i = 0; i < this.n(n); i++) {
      this.smoke(x + rand(-10, 10), y - rand(0, 6), rand(-2, 2) * power + dir * rand(0.5, 3), rand(-1.6, -0.2) * power, color, rand(22, 40), rand(8, 16) * power, 1.03);
    }
  }
  burst(x, y, color, n = 24, speed = 12) {
    for (let i = 0; i < this.n(n); i++) {
      const a = rand(0, TAU);
      this.spark(x, y, a, rand(speed * 0.4, speed), i % 3 ? color : '#fff', rand(12, 24), rand(12, 28), 3);
    }
    this.ring(x, y, 10, speed * 12, color, 20, 8);
    this.flare(x, y, speed * 10, color, 12);
  }
  explosion(x, y, color = '#ff8a2a', size = 1) {
    this.flare(x, y, 180 * size, '#fff3c4', 10);
    this.flare(x, y, 140 * size, color, 18);
    this.ring(x, y, 10, 160 * size, color, 22, 10);
    this.ring(x, y, 10, 110 * size, '#fff', 14, 5);
    for (let i = 0; i < this.n(26 * size); i++) {
      const a = rand(0, TAU);
      const s = rand(3, 14) * size;
      this.dot(x, y, Math.cos(a) * s, Math.sin(a) * s - 2, i % 2 ? color : '#ffd36b', rand(20, 45), rand(3, 7), 0.25, true);
    }
    for (let i = 0; i < this.n(10 * size); i++) {
      this.smoke(x + rand(-30, 30) * size, y + rand(-30, 30) * size, rand(-2, 2), rand(-2.5, -0.5), 'rgba(60,50,50,0.55)', rand(40, 70), rand(20, 40) * size, 1.025);
    }
  }
  shards(x, y, n, color, power = 1) {
    for (let i = 0; i < this.n(n); i++) {
      this.shard(x, y, rand(-7, 7) * power, rand(-12, -3) * power, color, rand(40, 70), rand(4, 9));
    }
  }

  // ------------------------------------------------------------- update/draw
  update(groundY = 0) {
    this.time++;
    const P = this.parts;
    let w = 0;
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      p.age++;
      if (p.age >= p.life) continue;
      if (p.vx !== undefined) {
        p.vx *= p.drag ?? 1;
        p.vy *= p.drag ?? 1;
        p.vy += p.g ?? 0;
        p.x += p.vx;
        p.y += p.vy;
        if (p.t === 'shard' || p.t === 'dot') {
          if (p.y > groundY && p.vy > 0) {
            p.y = groundY;
            p.vy *= -0.35;
            p.vx *= 0.6;
          }
        }
        if (p.t === 'shard') p.rot += p.vr;
        if (p.t === 'smoke') p.size *= p.grow;
      }
      P[w++] = p;
    }
    P.length = w;
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.age++;
      t.y += t.vy;
      t.vy *= 0.94;
      if (t.age >= t.life) this.texts.splice(i, 1);
    }
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i];
      g.age++;
      if (g.age >= g.life) this.ghosts.splice(i, 1);
    }
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.age++;
      if (b.age >= b.life) this.bolts.splice(i, 1);
    }
  }

  drawGhosts(ctx) {
    for (const g of this.ghosts) {
      const k = 1 - g.age / g.life;
      const look = g.look;
      look.alpha = g.alpha * k;
      look.flat = true;
      if (g.tint) {
        look.color = g.tint;
        look.backColor = g.tint;
        look.outline = 'rgba(0,0,0,0)';
      }
      drawStickman(ctx, g.J, look);
    }
  }

  // Normal-blend particles (smoke, shards, slash marks)
  drawBack(ctx) {
    for (const p of this.parts) {
      const k = 1 - p.age / p.life;
      if (p.t === 'smoke') {
        ctx.globalAlpha = k * k;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, TAU);
        ctx.fill();
      } else if (p.t === 'shard') {
        ctx.globalAlpha = Math.min(1, k * 2);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(p.size, 0);
        ctx.lineTo(-p.size * 0.6, p.size * 0.7);
        ctx.lineTo(-p.size * 0.5, -p.size * 0.6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }

  // Additive particles (sparks, glows, rings, bolts)
  drawFront(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const p of this.parts) {
      const k = 1 - p.age / p.life;
      switch (p.t) {
        case 'spark': {
          ctx.globalAlpha = Math.min(1, k * 1.5);
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.width * (0.4 + k * 0.6);
          const sp = Math.hypot(p.vx, p.vy) || 1;
          const l = p.len * k;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - (p.vx / sp) * l, p.y - (p.vy / sp) * l);
          ctx.stroke();
          break;
        }
        case 'dot': {
          ctx.globalAlpha = Math.min(1, k * 1.6);
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (p.glow ? 0.6 + k * 0.4 : 1), 0, TAU);
          ctx.fill();
          if (p.glow) {
            ctx.globalAlpha = k * 0.3;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * 2.6, 0, TAU);
            ctx.fill();
          }
          break;
        }
        case 'ring': {
          const e = 1 - Math.pow(1 - p.age / p.life, 3);
          const r = lerp(p.r0, p.r1, e);
          ctx.globalAlpha = k;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = Math.max(0.5, p.width * k);
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, r, r / p.squash, 0, 0, TAU);
          ctx.stroke();
          break;
        }
        case 'flare': {
          const r = p.size * (0.6 + 0.4 * k);
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
          g.addColorStop(0, p.color);
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.globalAlpha = k;
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, TAU);
          ctx.fill();
          break;
        }
        case 'slash': {
          const e = Math.min(1, p.age / 3);
          ctx.globalAlpha = k;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.width * k;
          const l = p.len * e;
          const cx = Math.cos(p.ang), cy = Math.sin(p.ang);
          ctx.beginPath();
          ctx.moveTo(p.x - cx * l * 0.5, p.y - cy * l * 0.5);
          ctx.lineTo(p.x + cx * l * 0.5, p.y + cy * l * 0.5);
          ctx.stroke();
          break;
        }
      }
    }
    for (const b of this.bolts) {
      const k = 1 - b.age / b.life;
      ctx.globalAlpha = k * (b.age % 3 === 0 ? 0.6 : 1);
      ctx.strokeStyle = b.color;
      ctx.lineWidth = b.width * 2.4;
      ctx.beginPath();
      b.pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = b.width * 0.8;
      ctx.stroke();
    }
    ctx.restore();
  }

  drawTexts(ctx) {
    for (const t of this.texts) {
      const k = t.age / t.life;
      const pop = t.pop ? (t.age < 6 ? 0.6 + (t.age / 6) * 0.7 : 1.3 - Math.min(0.3, (t.age - 6) / 20)) : 1;
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.rotate(t.rot);
      ctx.scale(pop, pop);
      ctx.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      ctx.font = `${t.size}px ${t.font}, Impact, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(3, t.size * 0.18);
      ctx.strokeStyle = t.outline;
      ctx.lineJoin = 'round';
      ctx.strokeText(t.str, 0, 0);
      ctx.fillStyle = t.color;
      ctx.fillText(t.str, 0, 0);
      ctx.restore();
    }
  }
}

// Weapon / limb trail ribbon: history of [baseX, baseY, tipX, tipY]
export class Trail {
  constructor(len = 8) {
    this.len = len;
    this.pts = [];
  }
  push(bx, by, tx, ty) {
    this.pts.push([bx, by, tx, ty]);
    if (this.pts.length > this.len) this.pts.shift();
  }
  decay() {
    if (this.pts.length) this.pts.shift();
  }
  clear() {
    this.pts.length = 0;
  }
  draw(ctx, color, alpha = 0.8) {
    const P = this.pts;
    if (P.length < 2) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 1; i < P.length; i++) {
      const a = P[i - 1], b = P[i];
      const k = i / P.length;
      ctx.globalAlpha = alpha * k * k;
      ctx.fillStyle = color;
      ctx.beginPath();
      // ribbon quad between successive base->tip segments (biased to the tip)
      const ia = 0.45, ib = 0.45;
      ctx.moveTo(lerp(a[0], a[2], ia), lerp(a[1], a[3], ia));
      ctx.lineTo(a[2], a[3]);
      ctx.lineTo(b[2], b[3]);
      ctx.lineTo(lerp(b[0], b[2], ib), lerp(b[1], b[3], ib));
      ctx.closePath();
      ctx.fill();
    }
    // bright edge
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      i ? ctx.lineTo(p[2], p[3]) : ctx.moveTo(p[2], p[3]);
    }
    ctx.stroke();
    ctx.restore();
  }
}

export const SPARK_COLORS = {
  light: '#ffe9a8',
  medium: '#ffd36b',
  heavy: '#ffb347',
  slash: '#e8f6ff',
  slashHeavy: '#c8ecff',
  fire: '#ff7b2a',
  ice: '#8fe8ff',
  shock: '#fff36b',
  shadow: '#b37bff',
  poison: '#9dff5c',
  void: '#d18bff',
  earth: '#d9a066',
  energy: '#7fe7ff',
  wind: '#d8fff0',
  ult: '#ffffff',
};

export { clamp, pick };
