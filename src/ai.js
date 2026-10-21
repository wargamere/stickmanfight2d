// CPU opponent. Drives a Controller exactly like a human would (virtual
// button presses), perceiving the opponent through a reaction-time delay.

import { clamp, lerp, rand, chance, pick } from './util.js';
import { Projectile, GroundWave, Strike } from './entities.js';

export const AI_LEVELS = [
  { name: 'Rookie', react: 30, block: 0.12, parry: 0, combo: 2, special: 0.12, anti: 0.08, breaker: 0, ult: 0.25, aggro: 0.3, mistake: 0.3, tech: 0, recover: 0.25, punish: 0.15, zone: 0.2, jumpIn: 0.08 },
  { name: 'Easy', react: 24, block: 0.3, parry: 0, combo: 2, special: 0.2, anti: 0.2, breaker: 0.05, ult: 0.5, aggro: 0.4, mistake: 0.18, tech: 0.05, recover: 0.4, punish: 0.3, zone: 0.3, jumpIn: 0.1 },
  { name: 'Normal', react: 17, block: 0.55, parry: 0.04, combo: 3, special: 0.3, anti: 0.4, breaker: 0.25, ult: 0.8, aggro: 0.55, mistake: 0.1, tech: 0.2, recover: 0.65, punish: 0.55, zone: 0.4, jumpIn: 0.12 },
  { name: 'Hard', react: 12, block: 0.75, parry: 0.12, combo: 4, special: 0.4, anti: 0.65, breaker: 0.55, ult: 1, aggro: 0.65, mistake: 0.05, tech: 0.45, recover: 0.85, punish: 0.8, zone: 0.5, jumpIn: 0.14 },
  { name: 'Nightmare', react: 8, block: 0.9, parry: 0.3, combo: 5, special: 0.5, anti: 0.85, breaker: 0.8, ult: 1, aggro: 0.75, mistake: 0.01, tech: 0.7, recover: 0.95, punish: 0.95, zone: 0.55, jumpIn: 0.15 },
];

// Interpolate parameters for fractional difficulty (towers ramp smoothly)
export function aiParams(level) {
  const l = clamp(level, 0, AI_LEVELS.length - 1);
  const i = Math.floor(l), t = l - i;
  const a = AI_LEVELS[i], b = AI_LEVELS[Math.min(AI_LEVELS.length - 1, i + 1)];
  const out = { name: a.name };
  for (const k in a) if (typeof a[k] === 'number') out[k] = lerp(a[k], b[k], t);
  out.react = Math.round(out.react);
  out.combo = Math.round(out.combo);
  return out;
}

const BTNS = ['atk', 'spc', 'ult', 'dash', 'up', 'grab'];

export class AI {
  constructor(fighter, level = 2, opts = {}) {
    this.f = fighter;
    this.setLevel(level);
    this.held = { left: false, right: false, up: false, down: false, atk: false, spc: false, ult: false, dash: false, grab: false };
    this.taps = new Set();
    this.noDoubleTap = true; // the CPU dashes on purpose with tap('dash'), never by re-pressing a direction
    this.stepT = 0;
    this.stepDir = 0;
    this.cool = {};
    for (const b of BTNS) this.cool[b] = 0;
    this.hist = [];
    this.dir = 0;
    this.blockT = 0;
    this.plan = null;
    this.think = 0;
    this.comboLeft = 0;
    this.decidedMove = null;
    this.style = opts.style || this.inferStyle();
    this.dummy = opts.dummy || null; // training dummy behaviour
    this.idleT = 0;
    this.lastOppMove = null;
    this.wantJumpAttack = false;
  }
  setLevel(level) {
    this.level = level;
    this.p = aiParams(level);
  }
  inferStyle() {
    const sp = this.f.def.specials || {};
    const hasProj = sp.S1 && sp.S1.tag === 'proj';
    const b = this.f.def.bars || {};
    if (hasProj && (b.range || 3) >= 4) return 'zoner';
    if ((b.speed || 3) >= 4) return 'rush';
    if ((b.power || 3) >= 5) return 'bruiser';
    return 'balanced';
  }
  tap(b) {
    if (this.cool[b] > 0) return false;
    this.taps.add(b);
    this.cool[b] = 3;
    return true;
  }
  // snapshot of the opponent `react` frames ago
  perceive() {
    const o = this.f.opp;
    this.hist.push({
      x: o.x, y: o.y, vx: o.vx, vy: o.vy, state: o.state, move: o.move, moveF: o.moveF,
      grounded: o.grounded, facing: o.facing, stun: o.stun,
    });
    if (this.hist.length > 60) this.hist.shift();
    const i = Math.max(0, this.hist.length - 1 - this.p.react);
    return this.hist[i];
  }

  update() {
    const f = this.f, o = f.opp;
    for (const b of BTNS) {
      this.held[b] = false;
      if (this.cool[b] > 0) this.cool[b]--;
    }
    if (!o) return;
    const P = this.perceive();
    if (this.dummy) this.dummyUpdate(P);
    else this.brain(P);
    // apply
    const d = this.dir;
    this.held.left = d < 0;
    this.held.right = d > 0;
    this.held.down = this.blockT > 0 || this.holdDown;
    if (this.blockT > 0) this.blockT--;
    for (const b of this.taps) this.held[b] = true;
    this.taps.clear();
  }

  // ------------------------------------------------------------------ training dummy
  dummyUpdate(P) {
    const f = this.f;
    this.dir = 0;
    this.holdDown = false;
    switch (this.dummy) {
      case 'stand':
        break;
      case 'block':
        this.holdDown = true;
        break;
      case 'random':
        if (f.opp.state === 'attack') {
          if (this.blockRoll == null) this.blockRoll = chance(0.5);
          this.holdDown = this.blockRoll;
        } else this.blockRoll = null;
        break;
      case 'jump':
        if (f.grounded && f.isNeutral && f.world.time % 50 === 0) this.tap('up');
        break;
      case 'recover':
        if (f.state === 'juggle' && f.stun <= 0) this.tap('up');
        break;
    }
  }

  // ------------------------------------------------------------------ main brain
  brain(P) {
    const f = this.f, o = f.opp, p = this.p, W = f.world;
    const dx = o.x - f.x;
    const dist = Math.abs(dx);
    const toward = dx >= 0 ? 1 : -1;
    this.holdDown = false;

    // --- hurt states: breaker, recovery, tech
    if (f.state === 'hitstun' || f.state === 'juggle') {
      this.dir = 0;
      const canBreak = f.meter >= 50 && f.comboHits >= 3 + Math.floor((1 - p.breaker) * 4);
      if (canBreak && f.comboDmg > 90 && chance(p.breaker * 0.12)) {
        this.tap('atk');
        this.tap('spc');
        return;
      }
      if (f.state === 'juggle' && f.stun <= 0 && !f.kdOnLand && chance(p.recover * 0.3)) this.tap('up');
      return;
    }
    if (f.state === 'grabbed') {
      if (chance(p.tech * 0.25)) {
        this.tap('atk');
        this.tap('spc');
      }
      return;
    }
    if (f.state === 'knockdown' || f.state === 'getup') {
      // wake-up option chosen once
      if (this.wakeup == null) this.wakeup = chance(p.block) ? 'block' : chance(0.3) ? 'backdash' : 'none';
      if (f.state === 'getup' && this.wakeup === 'block') this.blockT = 18;
      if (f.state === 'getup' && f.stateT === 16 && this.wakeup === 'backdash') {
        this.dir = -toward;
        this.tap('dash');
      }
      return;
    }
    this.wakeup = null;

    // --- currently attacking: manage strings / cancels
    if (f.state === 'attack') {
      this.manageAttack(o, dist);
      return;
    }

    // --- airborne
    if (!f.grounded && f.state === 'air') {
      this.airBrain(o, dx, dist, toward);
      return;
    }

    if (!(f.isNeutral || f.state === 'block' || f.state === 'land' || f.state === 'dash' || f.state === 'blockstun')) {
      this.dir = 0;
      return;
    }

    // --- defense: threats
    const threat = this.threat(P, dist);
    if (threat) {
      if (threat === 'jumpover' && f.grounded) {
        if (chance(0.5 + p.block * 0.5)) this.tap('up');
        return;
      }
      if (threat === 'parry') {
        // fresh tap of block right before impact
        this.blockT = 10;
        this.cool.up = 4;
        return;
      }
      if (threat === 'block') {
        this.blockT = Math.max(this.blockT, 10);
        this.dir = 0;
        return;
      }
      if (threat === 'anti') {
        if (this.useTagged('anti') || this.press('LAUNCH')) return;
      }
    }
    if (this.blockT > 0) {
      this.dir = 0;
      return;
    }

    // --- mistakes / hesitation
    if (this.think > 0) {
      this.think--;
      return;
    }
    if (chance(p.mistake * 0.05)) {
      this.think = Math.round(rand(10, 40));
      this.dir = chance(0.5) ? 0 : -toward;
      return;
    }

    // --- punish opportunities
    const oppRecovering = this.isRecovering(o);
    if (oppRecovering && dist < 190 && chance(p.punish)) {
      if (f.meter >= 100 && chance(p.ult)) {
        this.tap('ult');
        return;
      }
      this.startCombo(dist);
      return;
    }

    // ultimate when the opponent is close and vulnerable-ish
    if (f.meter >= 100 && dist < 170 && chance(p.ult * 0.04)) {
      this.tap('ult');
      return;
    }

    // --- neutral game
    const range = this.idealRange();
    const stamLow = f.stamina < 25;
    if (stamLow && dist < 260) {
      this.dir = -toward; // back off to recover stamina
      if (chance(0.03)) this.tap('dash');
      return;
    }

    // zoning: projectiles / zone specials at range
    if (dist > 240 && chance(p.zone * (this.style === 'zoner' ? 0.06 : 0.025))) {
      if (this.useTagged('proj', dist) || this.useTagged('zone', dist)) return;
    }

    if (dist > range + 40) {
      // approach
      this.dir = toward;
      if (dist > 420 && chance(0.02 + p.aggro * 0.02)) this.tap('dash');
      if (dist > 250 && dist < 420 && chance(p.jumpIn * 0.05)) {
        this.tap('up');
        this.wantJumpAttack = true;
      }
      if (dist > 160 && dist < 520 && chance(p.special * 0.012)) this.useTagged('rush', dist);
      return;
    }
    if (dist < 50) {
      // too close: throw or step back
      if (chance(0.06 + p.aggro * 0.05)) {
        this.tap('atk');
        this.tap('spc');
        return;
      }
      this.dir = -toward;
      return;
    }

    // in range: decide an action every few frames
    if (chance(0.1 + p.aggro * 0.25)) {
      const r = Math.random();
      if (r < 0.5) this.startCombo(dist);
      else if (r < 0.62) this.press('LAUNCH');
      else if (r < 0.7 && o.state === 'block') {
        // walk in for a throw
        this.dir = toward;
        if (dist < 80) {
          this.tap('atk');
          this.tap('spc');
        }
      } else if (r < 0.78) this.press('HEAVY');
      else if (r < 0.9 && chance(p.special)) this.useAnySpecial(dist);
      else if (r < 0.96) {
        this.tap('up');
        this.dir = toward;
        this.wantJumpAttack = true;
      } else this.tap('dash');
      return;
    }
    // footsies: commit to a short step, feint or pause so movement reads as deliberate
    if (this.stepT > 0) {
      this.stepT--;
      this.dir = this.stepDir;
      return;
    }
    const want = dist > range ? toward : -toward;
    const r = Math.random();
    this.stepDir = r < 0.5 ? want : r < 0.68 ? -want : 0;
    this.stepT = Math.round(rand(8, 22));
    this.dir = this.stepDir;
  }

  idealRange() {
    switch (this.style) {
      case 'zoner':
        return 300;
      case 'rush':
        return 95;
      case 'bruiser':
        return 120;
      default:
        return 130;
    }
  }

  isRecovering(o) {
    if (o.state === 'parried' || o.state === 'dizzy' || o.state === 'land' && o.landLag > 6) return true;
    if (o.state === 'attack' && o.move && o.move.hits) {
      const last = o.move.hits[o.move.hits.length - 1].f[1];
      return o.moveF > last + 2 && o.move.dur - o.moveF > 10;
    }
    if (o.state === 'attack' && o.move && !o.move.hits && o.moveF > 12) return true;
    return false;
  }

  // Detect incoming danger using the delayed perception
  threat(P, dist) {
    const f = this.f, p = this.p, W = f.world;
    // projectiles / waves heading at us
    for (const e of W.ents) {
      if (e.owner === f || e.dead) continue;
      const ex = e.x - f.x;
      if (e instanceof GroundWave) {
        if (Math.abs(ex) < 260 && Math.sign(-ex) === e.dir) return chance(p.block) ? 'jumpover' : null;
      } else if (e instanceof Projectile) {
        const closing = Math.sign(e.vx) === Math.sign(-ex);
        if (closing && Math.abs(ex) < 240 && e.y > f.y - 220) {
          if (this.projRoll !== e) {
            this.projRoll = e;
            this.projDecision = chance(p.block);
          }
          return this.projDecision ? 'block' : null;
        }
      } else if (e instanceof Strike) {
        if (Math.abs(ex) < e.w && e.age < e.delay && e.age > e.delay - 30) {
          this.dir = Math.sign(-ex || 1);
          return null;
        }
      }
    }
    // melee
    if (P.state === 'attack' && P.move && P.move.hits && dist < 260) {
      if (this.lastOppMove !== P.move) {
        this.lastOppMove = P.move;
        this.moveRoll = Math.random();
      }
      const first = P.move.hits[0].f[0];
      const last = P.move.hits[P.move.hits.length - 1].f[1];
      // frames until active from the (perceived) state, plus our reaction delay already elapsed
      const until = first - (P.moveF + p.react);
      if (P.moveF + p.react <= last + 1) {
        if (this.moveRoll < p.parry && until >= 0 && until <= 3) return 'parry';
        if (this.moveRoll < p.block) return 'block';
      }
    }
    // jump-ins
    if (!P.grounded && P.y < -60 && P.vy > -2 && dist < 200 && (P.state === 'air' || P.state === 'attack')) {
      if (this.airRoll !== P.vy > 0) this.airRoll = chance(p.anti);
      if (this.airRoll && dist < 150) return 'anti';
      if (chance(p.block)) return 'block';
    }
    return null;
  }

  press(moveId) {
    const f = this.f;
    const toward = f.opp.x >= f.x ? 1 : -1;
    switch (moveId) {
      case 'L1':
        this.dir = 0;
        return this.tap('atk');
      case 'LAUNCH':
        this.holdDown = true;
        this.dir = 0;
        return this.tap('atk');
      case 'HEAVY':
        this.dir = -toward;
        return this.tap('atk');
      case 'S1':
        this.dir = 0;
        return this.tap('spc');
      case 'S2':
        this.dir = -toward;
        return this.tap('spc');
      case 'S3':
        this.holdDown = true;
        this.dir = 0;
        return this.tap('spc');
    }
    return false;
  }

  useTagged(tag, dist) {
    const sp = this.f.def.specials;
    for (const k of ['S1', 'S2', 'S3']) {
      const m = sp[k];
      if (!m || m.tag !== tag) continue;
      if (dist != null && m.range && (dist < m.range[0] || dist > m.range[1])) continue;
      if (this.f.stamina < (m.stam || 10)) return false;
      return this.press(k);
    }
    return false;
  }

  useAnySpecial(dist) {
    const sp = this.f.def.specials;
    const opts = ['S1', 'S2', 'S3'].filter((k) => {
      const m = sp[k];
      if (!m) return false;
      if (m.tag === 'heal') return this.f.hp < this.f.maxHp * 0.6 && dist > 300;
      if (m.tag === 'counter') return chance(0.3);
      if (m.range && (dist < m.range[0] || dist > m.range[1])) return false;
      return true;
    });
    if (!opts.length) return false;
    return this.press(pick(opts));
  }

  startCombo(dist) {
    this.comboLeft = Math.max(1, Math.round(this.p.combo + rand(-1, 1)));
    this.comboPlan = chance(0.3 + this.p.combo * 0.08) ? 'launch' : 'string';
    if (this.comboPlan === 'launch' && dist < 110) {
      this.press('LAUNCH');
      return;
    }
    this.press('L1');
  }

  manageAttack(o, dist) {
    const f = this.f, p = this.p;
    const m = f.move;
    this.dir = 0;
    if (!m) return;
    // launcher follow-up: jump cancel then air string
    if (m.id === 'LAUNCH' && f.moveContact && m.jc != null && f.moveF >= m.jc && chance(0.3 + p.combo * 0.12)) {
      this.tap('up');
      this.wantAirCombo = true;
      return;
    }
    if (m.chain && f.moveF >= m.chain.at) {
      const blocked = f.moveContact && o.state === 'blockstun';
      if (this.comboLeft > 1 && (f.moveContact || chance(0.3)) && !(blocked && chance(p.combo * 0.12))) {
        // slight timing variance
        if (f.moveF >= m.chain.at + Math.round(rand(0, 4 - Math.min(3, p.combo * 0.6)))) {
          this.comboLeft--;
          this.tap('atk');
        }
        return;
      }
    }
    // special / ultimate cancel on hit
    if (m.cancel != null && f.moveF >= m.cancel && f.moveContact && o.state !== 'blockstun' && !m.special) {
      if (f.meter >= 100 && chance(p.ult * 0.25)) {
        this.tap('ult');
        return;
      }
      if (this.comboLeft <= 1 && chance(p.special * 0.25)) {
        const sp = f.def.specials;
        const k = pick(['S1', 'S3', 'S1']);
        if (sp[k] && sp[k].tag !== 'heal' && sp[k].tag !== 'counter' && sp[k].tag !== 'trap') {
          this.press(k);
          this.comboLeft = 0;
        }
      }
    }
  }

  airBrain(o, dx, dist, toward) {
    const f = this.f, p = this.p;
    this.dir = toward;
    if (this.wantAirCombo) {
      const dy = (o.y - 90) - (f.y - 90);
      if (dist < 120 && Math.abs(dy) < 110) {
        this.tap('atk');
        this.wantAirCombo = false;
        this.comboLeft = 2;
      }
      return;
    }
    if (f.state === 'air' && this.wantJumpAttack) {
      if (f.vy > -4 && dist < 150) {
        this.holdDown = dist < 100 && f.y < -90 && chance(0.4);
        this.tap('atk');
        this.wantJumpAttack = false;
      }
      return;
    }
    if (f.def.moves.SA && dist > 200 && chance(p.special * 0.04)) this.tap('spc');
  }
}
