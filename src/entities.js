// Projectiles, ground waves, delayed strikes, auras, mines, walls and beams.

import { capsuleHit, rand, TAU, clamp, lerp, sign } from './util.js';
import { ARENA_HALF } from './fighter.js';
import { SPARK_COLORS } from './effects.js';

function hitFighter(ent, f, cap) {
  if (!f || f === ent.owner && !ent.hitsOwner) return null;
  for (const h of f.hurt) {
    const c = capsuleHit(cap, h);
    if (c) return c;
  }
  return null;
}

class Ent {
  constructor(world, owner, o) {
    this.world = world;
    this.owner = owner;
    this.age = 0;
    this.dead = false;
    this.layer = 1; // 0 behind fighters, 1 in front
    Object.assign(this, o);
    this.hitIds = new Set();
    this.lastHitAt = {};
  }
  get target() {
    return this.owner.opp;
  }
  // try to hit the owner's opponent with capsule `cap`
  tryHit(cap, hit = this.hit) {
    const t = this.target;
    if (!t || !hit) return null;
    const key = t.side;
    if (hit.rehit) {
      if (this.age - (this.lastHitAt[key] ?? -999) < hit.rehit) return null;
    } else if (this.hitIds.has(key)) return null;
    if (!t.hittable) return null;
    const c = hitFighter(this, t, cap);
    if (!c) return null;
    const res = this.world.applyHit(this.owner, t, hit, c.x, c.y, this);
    if (res === 'miss') return null;
    this.hitIds.add(key);
    this.lastHitAt[key] = this.age;
    return res;
  }
}

// ---------------------------------------------------------------------------
// Projectile
// ---------------------------------------------------------------------------
export class Projectile extends Ent {
  constructor(world, owner, o) {
    super(world, owner, {
      r: 16, life: 120, grav: 0, pierce: 0, homing: 0, kind: 'orb', color: '#7fe7ff',
      spin: 0, rot: 0, reflectable: true, power: 1, scale: 1, ...o,
    });
    this.hp = this.pierce + 1;
    this.trailPts = [];
  }
  update() {
    const W = this.world;
    this.age++;
    if (this.homing && this.target) {
      const t = this.target;
      const ty = t.y - 90 * t.scale;
      const a = Math.atan2(ty - this.y, t.x - this.x);
      const sp = Math.hypot(this.vx, this.vy);
      const cur = Math.atan2(this.vy, this.vx);
      let d = a - cur;
      while (d > Math.PI) d -= TAU;
      while (d < -Math.PI) d += TAU;
      const na = cur + clamp(d, -this.homing, this.homing);
      this.vx = Math.cos(na) * sp;
      this.vy = Math.sin(na) * sp;
    }
    if (this.accel) {
      this.vx *= this.accel;
      this.vy *= this.accel;
    }
    this.vy += this.grav;
    this.x += this.vx;
    this.y += this.vy;
    this.rot += this.spin;
    this.trailPts.push([this.x, this.y]);
    if (this.trailPts.length > 10) this.trailPts.shift();
    // ambient particles
    const q = W.fx.quality;
    if (this.kind === 'fireball' && Math.random() < q) W.fx.ember(this.x + rand(-8, 8), this.y + rand(-8, 8), rand(0, 1) > 0.5 ? '#ffb347' : '#ff5a1f', 24);
    if (this.kind === 'venom' && Math.random() < 0.5 * q) W.fx.dot(this.x, this.y, rand(-1, 1), rand(0, 1), '#9dff5c', 20, 3, 0.2, true);
    if (this.kind === 'bolt' && this.age % 3 === 0) W.fx.bolt(this.x, this.y, this.x - this.vx * 3 + rand(-10, 10), this.y + rand(-20, 20), '#fff36b', 4, 2, 4, 8);
    if (this.kind === 'void' && Math.random() < 0.6 * q) W.fx.dot(this.x + rand(-30, 30), this.y + rand(-30, 30), (this.x - this.x) * 0, 0, '#c58bff', 16, 2.5, 0, true);
    if (this.kind === 'ice' && Math.random() < 0.4 * q) W.fx.dot(this.x, this.y, rand(-1, 1), rand(-1, 1), '#d8fbff', 18, 2, 0.05, true);

    if (this.vortex && this.target && this.target.hittable) {
      const t = this.target;
      const dx = this.x - t.x;
      if (Math.abs(dx) < 380) t.x += sign(dx) * this.vortex * (1 - Math.abs(dx) / 380);
    }

    // hit opponent
    const cap = { ax: this.x, ay: this.y, bx: this.x - this.vx * 0.5, by: this.y - this.vy * 0.5, r: this.r * this.scale };
    const res = this.tryHit(cap);
    if (res) {
      if (res === 'parry' && this.reflectable) {
        this.reflect(); // the parrying fighter now owns it
        return;
      }
      this.hp--;
      this.world.fx.burst(this.x, this.y, this.color, 10, 7);
      if (this.onHitFx) this.onHitFx(this);
      if (this.hp <= 0) this.dead = true;
    }
    if (this.age > this.life) this.die();
    if (this.x < -ARENA_HALF - 60 || this.x > ARENA_HALF + 60) this.die();
    if (this.y > -4 && this.grav > 0) {
      this.die(true);
    }
  }
  reflect() {
    // parried: flip ownership and direction
    const newOwner = this.owner.opp && this.world.fighters.includes(this.owner) ? this.owner.opp : this.owner;
    this.owner = newOwner;
    this.vx = -this.vx * 1.15;
    this.vy = -Math.abs(this.vy) * 0.3;
    this.hitIds.clear();
    this.lastHitAt = {};
    this.age = Math.min(this.age, 20);
    this.world.fx.ring(this.x, this.y, 8, 60, '#7ff3ff', 12, 4);
  }
  die(ground = false) {
    if (this.dead) return;
    this.dead = true;
    const W = this.world;
    if (this.explode) {
      W.fx.explosion(this.x, ground ? -10 : this.y, this.color, 0.6);
      W.sfx('explosion', { vol: 0.6 });
    } else W.fx.burst(this.x, this.y, this.color, 8, 5);
  }
  draw(ctx) {
    const s = this.scale;
    const x = this.x, y = this.y;
    const dir = sign(this.vx || 1);
    ctx.save();
    if (this.tether && this.owner.J && this.owner.state === 'attack') {
      // chain back to the thrower's hand
      const hx = this.owner.J.handFX, hy = this.owner.J.handFY;
      ctx.strokeStyle = '#0b0b12';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.strokeStyle = '#c9d1db';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([5, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    switch (this.kind) {
      case 'orb':
      case 'energy':
      case 'void':
      case 'plasma': {
        // trail
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < this.trailPts.length; i++) {
          const p = this.trailPts[i];
          const k = i / this.trailPts.length;
          ctx.globalAlpha = k * 0.35;
          ctx.fillStyle = this.color;
          ctx.beginPath();
          ctx.arc(p[0], p[1], this.r * s * k, 0, TAU);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        const pulse = 1 + Math.sin(this.age * 0.5) * 0.1;
        const g = ctx.createRadialGradient(x, y, 0, x, y, this.r * 2.2 * s * pulse);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.3, this.color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, this.r * 2.2 * s * pulse, 0, TAU);
        ctx.fill();
        if (this.kind === 'void') {
          ctx.globalCompositeOperation = 'source-over';
          ctx.fillStyle = '#0a0014';
          ctx.beginPath();
          ctx.arc(x, y, this.r * 0.6 * s, 0, TAU);
          ctx.fill();
          ctx.strokeStyle = '#e2b6ff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, this.r * 0.9 * s, this.age * 0.2, this.age * 0.2 + 4);
          ctx.stroke();
        }
        break;
      }
      case 'fireball': {
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < this.trailPts.length; i++) {
          const p = this.trailPts[i];
          const k = i / this.trailPts.length;
          ctx.globalAlpha = k * 0.5;
          ctx.fillStyle = i % 2 ? '#ff5a1f' : '#ffb347';
          ctx.beginPath();
          ctx.arc(p[0] + rand(-2, 2), p[1] + rand(-2, 2), this.r * s * (0.4 + k * 0.8), 0, TAU);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        const g = ctx.createRadialGradient(x, y, 0, x, y, this.r * 2 * s);
        g.addColorStop(0, '#fff7d0');
        g.addColorStop(0.35, '#ffb347');
        g.addColorStop(0.7, 'rgba(255,80,20,0.6)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, this.r * 2 * s, 0, TAU);
        ctx.fill();
        break;
      }
      case 'crescent': {
        ctx.translate(x, y);
        ctx.scale(dir, 1);
        ctx.globalCompositeOperation = 'lighter';
        const R = this.r * 2.4 * s;
        ctx.fillStyle = this.color;
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.arc(-R * 0.5, 0, R, -1.1, 1.1);
        ctx.arc(-R * 0.85, 0, R * 0.95, 1.0, -1.0, true);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.arc(-R * 0.5, 0, R * 0.96, -0.9, 0.9);
        ctx.arc(-R * 0.62, 0, R * 0.9, 0.85, -0.85, true);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'kunai':
      case 'sickle':
      case 'shard':
      case 'ice': {
        ctx.translate(x, y);
        const ang = this.kind === 'sickle' ? this.rot : Math.atan2(this.vy, this.vx);
        ctx.rotate(ang);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.4;
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-30 * s, 0);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        if (this.kind === 'kunai') {
          ctx.fillStyle = '#0b0b12';
          ctx.beginPath();
          ctx.moveTo(14 * s, 0);
          ctx.lineTo(-2 * s, -6 * s);
          ctx.lineTo(-12 * s, 0);
          ctx.lineTo(-2 * s, 6 * s);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = '#d7dde6';
          ctx.beginPath();
          ctx.moveTo(11 * s, 0);
          ctx.lineTo(-1 * s, -3.5 * s);
          ctx.lineTo(-8 * s, 0);
          ctx.lineTo(-1 * s, 3.5 * s);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = this.color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(-15 * s, 0, 4 * s, 0, TAU);
          ctx.stroke();
        } else if (this.kind === 'sickle') {
          ctx.strokeStyle = '#0b0b12';
          ctx.lineWidth = 7;
          ctx.beginPath();
          ctx.arc(0, 0, 16 * s, 0.2, 4.4);
          ctx.stroke();
          ctx.strokeStyle = this.color;
          ctx.lineWidth = 3.5;
          ctx.stroke();
        } else {
          // ice shard
          ctx.fillStyle = '#0b0b12';
          ctx.beginPath();
          ctx.moveTo(22 * s, 0);
          ctx.lineTo(-6 * s, -9 * s);
          ctx.lineTo(-14 * s, 0);
          ctx.lineTo(-6 * s, 9 * s);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = '#bff4ff';
          ctx.beginPath();
          ctx.moveTo(18 * s, 0);
          ctx.lineTo(-4 * s, -6 * s);
          ctx.lineTo(-10 * s, 0);
          ctx.lineTo(-4 * s, 6 * s);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(-2 * s, -1.5 * s, 14 * s, 3 * s);
        }
        break;
      }
      case 'venom':
      case 'rock': {
        ctx.fillStyle = '#0b0b12';
        ctx.beginPath();
        ctx.arc(x, y, this.r * s + 3, 0, TAU);
        ctx.fill();
        ctx.fillStyle = this.kind === 'venom' ? '#7ee03f' : '#8a6a4a';
        ctx.beginPath();
        ctx.arc(x, y, this.r * s, 0, TAU);
        ctx.fill();
        ctx.fillStyle = this.kind === 'venom' ? '#d6ffb0' : '#b89470';
        ctx.beginPath();
        ctx.arc(x - this.r * 0.3, y - this.r * 0.3, this.r * 0.35 * s, 0, TAU);
        ctx.fill();
        break;
      }
      case 'bolt': {
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(x, y, 0, x, y, this.r * 2.4 * s);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.3, '#fff36b');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, this.r * 2.4 * s, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        for (let i = 0; i < 4; i++) {
          const a = rand(0, TAU);
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + Math.cos(a) * this.r * 1.8, y + Math.sin(a) * this.r * 1.8);
          ctx.stroke();
        }
        break;
      }
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Ground wave: travels along the floor; jump over it
// ---------------------------------------------------------------------------
export class GroundWave extends Ent {
  constructor(world, owner, o) {
    super(world, owner, { speed: 9, life: 70, h: 56, w: 34, kind: 'rock', color: '#d9a066', ...o });
    this.y = 0;
    this.layer = 0;
  }
  update() {
    const W = this.world;
    this.age++;
    this.x += this.dir * this.speed;
    const q = W.fx.quality;
    if (this.age % 2 === 0) {
      if (this.kind === 'rock') {
        W.fx.shard(this.x + rand(-10, 10), -rand(4, 20), rand(-2, 2), rand(-8, -3), rand(0, 1) > 0.5 ? '#8a6a4a' : '#b89470', 30, rand(4, 8));
        if (Math.random() < q) W.fx.smoke(this.x, -10, rand(-1, 1), -1, 'rgba(160,130,100,0.5)', 30, 14);
      } else if (this.kind === 'fire') {
        for (let i = 0; i < 2; i++) W.fx.ember(this.x + rand(-14, 14), -rand(0, 40), i ? '#ffb347' : '#ff5a1f', 30);
      } else if (this.kind === 'ice') {
        W.fx.shard(this.x + rand(-10, 10), -rand(4, 30), rand(-1, 1), rand(-5, -2), '#bff4ff', 26, rand(4, 7));
      } else if (this.kind === 'shadow') {
        W.fx.smoke(this.x, -20, rand(-1, 1), -1.4, 'rgba(90,40,140,0.5)', 30, 16);
      }
    }
    const cap = { ax: this.x, ay: -this.h * 0.25, bx: this.x, by: -this.h * 0.75, r: this.w * 0.5 };
    const res = this.tryHit(cap);
    if (res && !this.pierce) this.dead = true;
    if (this.age > this.life || Math.abs(this.x) > ARENA_HALF) this.dead = true;
  }
  draw(ctx) {
    const x = this.x;
    const h = this.h * Math.min(1, this.age / 6);
    ctx.save();
    if (this.kind === 'rock') {
      ctx.fillStyle = '#0b0b12';
      for (let i = 0; i < 3; i++) {
        const ox = -this.dir * i * 16;
        const hh = h * (1 - i * 0.28);
        ctx.beginPath();
        ctx.moveTo(x + ox - 14, 0);
        ctx.lineTo(x + ox - 4, -hh);
        ctx.lineTo(x + ox + 6, -hh * 0.8);
        ctx.lineTo(x + ox + 14, 0);
        ctx.fill();
      }
      ctx.fillStyle = '#9c7a55';
      for (let i = 0; i < 3; i++) {
        const ox = -this.dir * i * 16;
        const hh = h * (1 - i * 0.28) - 4;
        ctx.beginPath();
        ctx.moveTo(x + ox - 10, 0);
        ctx.lineTo(x + ox - 3, -hh);
        ctx.lineTo(x + ox + 5, -hh * 0.8);
        ctx.lineTo(x + ox + 10, 0);
        ctx.fill();
      }
    } else {
      ctx.globalCompositeOperation = 'lighter';
      const col = this.kind === 'fire' ? '#ff7b2a' : this.kind === 'ice' ? '#8fe8ff' : '#a060ff';
      const g = ctx.createLinearGradient(x, 0, x, -h * 1.4);
      g.addColorStop(0, col);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x - 28, 0);
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        ctx.lineTo(x - 28 + t * 56, -h * (0.6 + Math.sin(this.age * 0.6 + i * 2) * 0.4) * (1 - Math.abs(t - 0.5)));
      }
      ctx.lineTo(x + 28, 0);
      ctx.fill();
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Delayed strike at a location (lightning, meteor, eruption, ghost hands...)
// ---------------------------------------------------------------------------
export class Strike extends Ent {
  constructor(world, owner, o) {
    super(world, owner, { delay: 30, active: 10, w: 70, h: 260, kind: 'lightning', color: '#fff36b', ...o });
    this.layer = this.kind === 'hands' || this.kind === 'pillar' || this.kind === 'spikes' ? 0 : 1;
  }
  update() {
    const W = this.world;
    this.age++;
    if (this.track && this.age < this.delay - 12 && this.target) this.x = lerp(this.x, this.target.x, 0.06);
    if (this.age === this.delay) {
      switch (this.kind) {
        case 'lightning':
          W.sfx('thunder', { pan: this.x / 1000 });
          W.fx.bolt(this.x, -900, this.x, 0, '#fff36b', 12, 6, 14, 40);
          W.fx.bolt(this.x + 10, -900, this.x - 10, 0, '#ffffff', 10, 3, 12, 30);
          W.fx.burst(this.x, -10, '#fff36b', 20, 12);
          W.flashScreen('#fffbe0', 0.25);
          break;
        case 'meteor':
          W.fx.explosion(this.x, -20, '#ff7b2a', 1.1);
          W.sfx('explosion', { pan: this.x / 1000 });
          break;
        case 'pillar':
          W.sfx('fire', { pan: this.x / 1000 });
          break;
        case 'hands':
          W.sfx('shadow', { pan: this.x / 1000 });
          break;
        case 'spikes':
          W.sfx('ice', { pan: this.x / 1000 });
          W.fx.shards(this.x, -10, 10, '#bff4ff', 0.8);
          break;
        case 'laser':
          W.sfx('beam', { pan: this.x / 1000 });
          W.flashScreen('#ffe0f0', 0.3);
          break;
      }
      W.shake(0.25);
      W.arenaImpact(this.x, 0, 0.6);
    }
    if (this.kind === 'meteor' && this.age < this.delay) {
      // meteor falling diagonally
      if (this.age % 2 === 0) W.fx.ember(this.mx() + rand(-10, 10), this.my() + rand(-10, 10), '#ffb347', 20);
    }
    if (this.age >= this.delay && this.age < this.delay + this.active) {
      const cap = { ax: this.x, ay: -10, bx: this.x, by: -this.h, r: this.w / 2 };
      this.tryHit(cap);
      if (this.kind === 'pillar' && this.age % 2 === 0) {
        for (let i = 0; i < 3; i++) W.fx.ember(this.x + rand(-this.w / 2, this.w / 2), -rand(0, this.h), i ? '#ffb347' : '#ff5a1f', 30);
      }
    }
    if (this.age >= this.delay + this.active + 20) this.dead = true;
  }
  mx() {
    const k = this.age / this.delay;
    return lerp(this.x - 500 * (this.from || 1), this.x, k);
  }
  my() {
    const k = this.age / this.delay;
    return lerp(-900, -20, k);
  }
  draw(ctx) {
    const a = this.age, d = this.delay;
    ctx.save();
    // telegraph
    if (a < d) {
      const k = a / d;
      ctx.globalAlpha = 0.25 + 0.35 * Math.abs(Math.sin(a * 0.3));
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.ellipse(this.x, 0, this.w * 0.7, 9, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.15 * k;
      ctx.fillRect(this.x - this.w / 2, -this.h, this.w, this.h);
    }
    ctx.globalAlpha = 1;
    if (this.kind === 'meteor' && a < d) {
      const x = this.mx(), y = this.my();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(x, y, 0, x, y, 50);
      g.addColorStop(0, '#fff7d0');
      g.addColorStop(0.4, '#ff8a2a');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, 50, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#3a2618';
      ctx.beginPath();
      ctx.arc(x, y, 16, 0, TAU);
      ctx.fill();
    }
    const act = a >= d && a < d + this.active + 10;
    if (act) {
      const k = 1 - (a - d) / (this.active + 10);
      if (this.kind === 'pillar' || this.kind === 'laser') {
        ctx.globalCompositeOperation = 'lighter';
        const w = this.w * (this.kind === 'laser' ? 1.2 : 1) * (0.6 + 0.4 * k);
        const g = ctx.createLinearGradient(this.x - w / 2, 0, this.x + w / 2, 0);
        const c = this.kind === 'laser' ? '#ff5cc8' : '#ff7b2a';
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(0.3, c);
        g.addColorStop(0.5, '#fff7e0');
        g.addColorStop(0.7, c);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.globalAlpha = k;
        const top = this.kind === 'laser' ? -1400 : -this.h * (0.5 + 0.5 * Math.min(1, (a - d) / 5));
        ctx.fillRect(this.x - w / 2, top, w, -top);
      } else if (this.kind === 'hands' || this.kind === 'spikes') {
        const rise = Math.min(1, (a - d) / 5) * (a > d + this.active ? k * 2 : 1);
        for (let i = -2; i <= 2; i++) {
          const x = this.x + i * (this.w / 5);
          const h = this.h * (0.55 + 0.45 * Math.cos(i * 0.9)) * clamp(rise, 0, 1);
          ctx.fillStyle = '#0b0b12';
          ctx.beginPath();
          ctx.moveTo(x - 9, 0);
          ctx.lineTo(x, -h);
          ctx.lineTo(x + 9, 0);
          ctx.fill();
          ctx.fillStyle = this.kind === 'hands' ? '#5ff0c8' : '#bff4ff';
          ctx.beginPath();
          ctx.moveTo(x - 6, 0);
          ctx.lineTo(x, -h + 6);
          ctx.lineTo(x + 6, 0);
          ctx.fill();
          if (this.kind === 'hands') {
            // ghostly fingers
            ctx.strokeStyle = '#5ff0c8';
            ctx.lineWidth = 3;
            for (const fx of [-6, 0, 6]) {
              ctx.beginPath();
              ctx.moveTo(x, -h + 6);
              ctx.lineTo(x + fx, -h - 8);
              ctx.stroke();
            }
          }
        }
      }
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Aura attached to the owner (static field, spin, flame shield)
// ---------------------------------------------------------------------------
export class Aura extends Ent {
  constructor(world, owner, o) {
    super(world, owner, { r: 90, life: 60, kind: 'shock', color: '#fff36b', reflect: false, oy: 90, ...o });
  }
  update() {
    const W = this.world;
    this.age++;
    const o = this.owner;
    if (o.state !== 'attack' && this.bindMove) {
      this.dead = true;
      return;
    }
    this.x = o.x;
    this.y = o.y - this.oy * o.scale;
    const cap = { ax: this.x, ay: this.y, bx: this.x, by: this.y, r: this.r };
    this.tryHit(cap);
    if (this.kind === 'shock' && this.age % 3 === 0) {
      const a = rand(0, TAU), b = a + rand(0.6, 1.4);
      W.fx.bolt(this.x + Math.cos(a) * this.r, this.y + Math.sin(a) * this.r, this.x + Math.cos(b) * this.r * 0.8, this.y + Math.sin(b) * this.r * 0.8, this.color, 5, 2.5, 5, 14);
    }
    if (this.kind === 'fire' && this.age % 2 === 0) W.fx.ember(this.x + rand(-this.r, this.r), this.y + rand(-this.r, this.r) * 0.6, '#ff7b2a', 26);
    if (this.reflect) {
      for (const e of W.ents) {
        if (e instanceof Projectile && e.owner !== o && Math.hypot(e.x - this.x, e.y - this.y) < this.r + e.r) {
          e.reflect();
          W.sfx('parry', { vol: 0.6 });
        }
      }
    }
    if (this.age >= this.life) this.dead = true;
  }
  draw(ctx) {
    const k = Math.min(1, this.age / 5) * Math.min(1, (this.life - this.age) / 8);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.5 * k;
    const g = ctx.createRadialGradient(this.x, this.y, this.r * 0.3, this.x, this.y, this.r);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.8, this.color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, TAU);
    ctx.fill();
    if (this.kind === 'spin' || this.kind === 'wind') {
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 4;
      ctx.globalAlpha = 0.8 * k;
      for (let i = 0; i < 3; i++) {
        const a = this.age * 0.45 + (i * TAU) / 3;
        ctx.beginPath();
        ctx.ellipse(this.x, this.y, this.r * 0.95, this.r * 0.4, 0, a, a + 1.6);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Mine
// ---------------------------------------------------------------------------
export class Mine extends Ent {
  constructor(world, owner, o) {
    super(world, owner, { life: 420, armT: 24, r: 46, color: '#ff4d6d', ...o });
    this.y = -8;
    this.layer = 0;
  }
  update() {
    const W = this.world;
    this.age++;
    const t = this.target;
    if (this.age === this.armT) W.sfx('mine', { pan: this.x / 1000, vol: 0.6 });
    if (this.age > this.armT && t && t.hittable && Math.abs(t.x - this.x) < this.r && t.y > -70) this.boom();
    if (this.age > this.life) this.boom();
  }
  boom() {
    const W = this.world;
    this.dead = true;
    W.fx.explosion(this.x, -20, this.color, 0.9);
    W.sfx('explosion', { pan: this.x / 1000 });
    W.shake(0.3);
    const cap = { ax: this.x, ay: -20, bx: this.x, by: -120, r: 70 };
    this.tryHit(cap);
  }
  draw(ctx) {
    const armed = this.age > this.armT;
    ctx.fillStyle = '#0b0b12';
    ctx.beginPath();
    ctx.ellipse(this.x, -4, 18, 8, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#5a6270';
    ctx.beginPath();
    ctx.ellipse(this.x, -5, 15, 6, 0, 0, TAU);
    ctx.fill();
    const on = armed && Math.floor(this.age / 10) % 2 === 0;
    ctx.fillStyle = on ? this.color : '#552';
    ctx.beginPath();
    ctx.arc(this.x, -10, 4, 0, TAU);
    ctx.fill();
    if (on) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(this.x, -10, 12, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }
}

// ---------------------------------------------------------------------------
// Ice wall: blocks enemy projectiles, hits when it rises
// ---------------------------------------------------------------------------
export class Wall extends Ent {
  constructor(world, owner, o) {
    super(world, owner, { life: 160, w: 44, h: 170, hp: 3, color: '#bff4ff', ...o });
    this.layer = 0;
  }
  update() {
    const W = this.world;
    this.age++;
    if (this.age < 10) {
      const cap = { ax: this.x, ay: -10, bx: this.x, by: -this.h, r: this.w / 2 };
      this.tryHit(cap);
    }
    for (const e of W.ents) {
      if (e instanceof Projectile && e.owner !== this.owner && Math.abs(e.x - this.x) < this.w / 2 + e.r && e.y > -this.h) {
        e.die();
        this.hp--;
      }
    }
    const t = this.target;
    if (t && Math.abs(t.x - this.x) < this.w / 2 + 20 && t.y > -this.h && t.state !== 'ko') {
      t.x = this.x + sign(t.x - this.x || -this.owner.facing) * (this.w / 2 + 20);
    }
    if (this.hp <= 0 || this.age >= this.life) {
      this.dead = true;
      W.fx.shards(this.x, -this.h / 2, 18, '#bff4ff');
      W.sfx('shatter', { pan: this.x / 1000 });
    }
  }
  draw(ctx) {
    const rise = Math.min(1, this.age / 8);
    const h = this.h * rise;
    const x = this.x, w = this.w;
    ctx.save();
    ctx.fillStyle = '#0b0b12';
    ctx.beginPath();
    ctx.moveTo(x - w / 2 - 3, 0);
    ctx.lineTo(x - w / 2 - 3, -h * 0.85);
    ctx.lineTo(x - 6, -h - 3);
    ctx.lineTo(x + w / 2 + 3, -h * 0.75);
    ctx.lineTo(x + w / 2 + 3, 0);
    ctx.fill();
    const g = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
    g.addColorStop(0, '#7fd6f0');
    g.addColorStop(0.5, '#e6fbff');
    g.addColorStop(1, '#8fe0f5');
    ctx.fillStyle = g;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(x - w / 2, 0);
    ctx.lineTo(x - w / 2, -h * 0.85);
    ctx.lineTo(x - 6, -h);
    ctx.lineTo(x + w / 2, -h * 0.75);
    ctx.lineTo(x + w / 2, 0);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 8, -h * 0.2);
    ctx.lineTo(x + 4, -h * 0.5);
    ctx.lineTo(x - 2, -h * 0.75);
    ctx.stroke();
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Beam from the owner's hand
// ---------------------------------------------------------------------------
export class Beam extends Ent {
  constructor(world, owner, o) {
    super(world, owner, { life: 40, w: 46, len: 1600, color: '#7fe7ff', ...o });
  }
  update() {
    this.age++;
    const o = this.owner;
    if (o.state !== 'attack' && this.bindMove) {
      this.dead = true;
      return;
    }
    this.x = o.J.handFX;
    this.y = o.J.handFY;
    this.dir = o.facing;
    const cap = { ax: this.x, ay: this.y, bx: this.x + this.dir * this.len, by: this.y, r: this.w / 2 };
    this.tryHit(cap);
    if (this.age % 2 === 0) this.world.fx.dot(this.x + this.dir * rand(0, 900), this.y + rand(-this.w / 2, this.w / 2), this.dir * 6, 0, '#ffffff', 14, 2, 0, true);
    if (this.age >= this.life) this.dead = true;
  }
  draw(ctx) {
    const k = Math.min(1, this.age / 4) * Math.min(1, (this.life - this.age) / 8);
    const w = this.w * k * (1 + Math.sin(this.age * 0.8) * 0.08);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const x2 = this.x + this.dir * this.len;
    const g = ctx.createLinearGradient(0, this.y - w, 0, this.y + w);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.3, this.color);
    g.addColorStop(0.5, '#ffffff');
    g.addColorStop(0.7, this.color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(Math.min(this.x, x2), this.y - w, Math.abs(x2 - this.x), w * 2);
    const r = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, w * 1.8);
    r.addColorStop(0, '#ffffff');
    r.addColorStop(0.4, this.color);
    r.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = r;
    ctx.beginPath();
    ctx.arc(this.x, this.y, w * 1.8, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

export { SPARK_COLORS };
