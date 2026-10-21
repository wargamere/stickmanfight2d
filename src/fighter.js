// Fighter: state machine, physics, animation, move execution.

import { clamp, lerp, approach, ease, rand, sign } from './util.js';
import { makePose, copyPose, lerpPose, solvePose, hurtCapsules } from './skeleton.js';
import { POSES } from './poses.js';
import { Trail } from './effects.js';
import { createAccessories } from './accessories.js';

export const GRAVITY = 0.86;
export const ARENA_HALF = 1000;

const EXPR = {
  attack: 'attack', hitstun: 'hurt', juggle: 'hurt', knockdown: 'hurt', getup: 'hurt', parried: 'hurt',
  grabbed: 'hurt', ultlocked: 'hurt', blockstun: 'attack', defeat: 'hurt', dizzy: 'ko', ko: 'ko', victory: 'happy',
};
const NEUTRAL_STATES = new Set(['idle', 'walk', 'run']);
const HURT_STATES = new Set(['hitstun', 'juggle', 'knockdown', 'getup', 'grabbed', 'ultlocked', 'dizzy', 'frozen', 'ko']);

function getPose(p) {
  return typeof p === 'string' ? POSES[p] : p;
}

// Sample a keyframe list [[frame, pose, ease], ...] at frame f into out
export function sampleKeys(keys, f, out) {
  if (f <= keys[0][0]) return copyPose(getPose(keys[0][1]), out);
  for (let i = 1; i < keys.length; i++) {
    const k = keys[i];
    if (f < k[0]) {
      const p = keys[i - 1];
      const t = (f - p[0]) / (k[0] - p[0]);
      const e = ease[k[2] || 'smooth'] || ease.smooth;
      return lerpPose(getPose(p[1]), getPose(k[1]), e(t), out);
    }
  }
  return copyPose(getPose(keys[keys.length - 1][1]), out);
}

// ---------------------------------------------------------------- animation helpers
// Pose <-> flat array, so springs can run over every channel at once.
const NP = 16;
const A = { hipX: 0, hipY: 1, lean: 2, head: 3, hfX: 4, hfY: 5, hbX: 6, hbY: 7, ffX: 8, ffY: 9, fbX: 10, fbY: 11, rot: 12, w: 13, w2: 14, wl: 15 };
const ANGLE = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0];
// [stiffness, damping] per state; tuned for a 3-6 frame settle with little overshoot
const SPRINGS = {
  default: [0.26, 0.38],
  idle: [0.2, 0.42],
  walk: [0.3, 0.36],
  run: [0.36, 0.3],
  block: [0.36, 0.3],
  blockstun: [0.36, 0.3],
  hitstun: [0.3, 0.38],
  parried: [0.26, 0.38],
  juggle: [0.32, 0.34],
  knockdown: [0.3, 0.38],
  getup: [0.34, 0.32],
  dizzy: [0.14, 0.5],
  ultlocked: [0.4, 0.3],
  grabbed: [0.4, 0.3],
  intro: [0.18, 0.46],
  victory: [0.18, 0.46],
  defeat: [0.16, 0.46],
};

function wrapDeg(d) {
  d %= 360;
  if (d > 180) d -= 360;
  else if (d < -180) d += 360;
  return d;
}

function packPose(p, a) {
  a[0] = p.hip[0];
  a[1] = p.hip[1];
  a[2] = p.lean;
  a[3] = p.head;
  a[4] = p.hf[0];
  a[5] = p.hf[1];
  a[6] = p.hb[0];
  a[7] = p.hb[1];
  a[8] = p.ff[0];
  a[9] = p.ff[1];
  a[10] = p.fb[0];
  a[11] = p.fb[1];
  a[12] = p.rot;
  a[13] = p.w == null ? NaN : p.w;
  a[14] = p.w2 == null ? NaN : p.w2;
  a[15] = p.wl ?? 0;
}

function unpackPose(a, o, p) {
  p.hip[0] = a[0] + o[0];
  p.hip[1] = a[1] + o[1];
  p.lean = a[2] + o[2];
  p.head = a[3] + o[3];
  p.hf[0] = a[4] + o[4];
  p.hf[1] = a[5] + o[5];
  p.hb[0] = a[6] + o[6];
  p.hb[1] = a[7] + o[7];
  p.ff[0] = a[8] + o[8];
  p.ff[1] = Math.max(0, a[9] + o[9]);
  p.fb[0] = a[10] + o[10];
  p.fb[1] = Math.max(0, a[11] + o[11]);
  p.rot = a[12] + o[12];
  p.w = a[13] !== a[13] ? null : a[13] + o[13];
  p.w2 = a[14] !== a[14] ? null : a[14] + o[14];
  p.wl = a[15] + o[15];
}

// Foot offset along a step cycle. ph in cycles; the foot is planted (sliding back
// exactly as fast as the body moves) for `duty` of the cycle, then swings forward.
function stepFoot(ph, stride, lift, duty) {
  ph -= Math.floor(ph);
  if (ph < duty) return [stride * (0.5 - ph / duty), 0];
  const t = (ph - duty) / (1 - duty);
  return [stride * (ease.inOut(t) - 0.5), lift * Math.sin(Math.PI * t)];
}

// Running stride: short ground contact, the heel kicks up behind before reaching forward.
export const RUN_STRIDE = 64, RUN_DUTY = 0.36;
function runFoot(ph) {
  ph -= Math.floor(ph);
  if (ph < RUN_DUTY) return [RUN_STRIDE * (0.5 - ph / RUN_DUTY), 0];
  const t = (ph - RUN_DUTY) / (1 - RUN_DUTY);
  const x = RUN_STRIDE * (ease.inOut(t) - 0.5);
  const y = 34 * Math.sin(Math.PI * Math.min(1, t * 1.15)) * (1 - t * 0.35);
  return [x, Math.max(0, y)];
}

export class Fighter {
  constructor(def, opts) {
    this.def = def;
    this.side = opts.side; // 0 = left/P1, 1 = right/P2
    this.ctrl = opts.controller;
    this.skin = opts.skin || def.skins[0];
    this.world = null;
    this.opp = null;
    this.name = def.name;
    this.scale = (def.scale || 1) * (opts.scaleMult || 1);
    this.maxHp = Math.round(def.stats.hp * (opts.hpMult || 1));
    this.weapon = def.weapon || null;
    this.trail = new Trail(9);
    this.trail2 = new Trail(9);
    this.acc = createAccessories(def, this.skin, opts.hat);
    this.pose = makePose();
    this.tmpPose = makePose();
    this.prevPose = makePose();
    this.rpose = makePose(); // rendered pose (springs + impulses on top of this.pose)
    this.aT = new Float64Array(NP);
    this.aX = new Float64Array(NP);
    this.aV = new Float64Array(NP);
    this.aO = new Float64Array(NP);
    this.aOV = new Float64Array(NP);
    this.animInit = false;
    this.snapPose = false;
    this.J = {};
    this.hurt = [];
    this.stats = { dealt: 0, taken: 0, maxCombo: 0, parries: 0, blocks: 0, hits: 0, specials: 0, ults: 0, breakers: 0, throws: 0 };
    this.resetRound(opts.side === 0 ? -260 : 260);
  }

  resetRound(x) {
    this.x = x;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.facing = x < 0 ? 1 : -1;
    this.grounded = true;
    this.hp = this.maxHp;
    this.dispHp = this.maxHp; // trailing red bar
    this.stamina = 100;
    this.stamDelay = 0;
    this.tired = false;
    this.meter = this.meter ?? 0;
    this.state = 'idle';
    this.stateT = 0;
    this.move = null;
    this.moveF = 0;
    this.hitstop = 0;
    this.stun = 0;
    this.invuln = 0;
    this.armor = 0;
    this.flash = 0;
    this.airJumps = 1;
    this.airDashes = 1;
    this.comboHits = 0; // hits taken in current combo
    this.comboDmg = 0;
    this.juggleHits = 0;
    this.wbOk = true;
    this.gbOk = true;
    this.kdOnLand = false;
    this.status = { burn: 0, poison: 0, slow: 0, shock: 0, power: 0, speed: 0, regen: 0, freeze: 0, mark: 0 };
    this.counterWin = 0;
    this.counterMove = null;
    this.heal = 0;
    this.blend = 0;
    this.flipT = 0;
    this.walkPhase = 0;
    this.hurtPose = 'hurtHigh';
    this.lastAttacker = null;
    this.timedBonus = 0;
    this.koVel = null;
    this.ragdoll = null;
    this.alpha = 1;
    this.visible = true;
    this.grabbedBy = null;
    this.techWindow = 0;
    this.ultLock = false;
    this.parryRecoil = 0;
    this.landLag = 0;
    this.wallSide = 0;
    this.lastHitFrame = -99;
    this.hitShake = 0;
    this.trail.clear();
    this.trail2.clear();
    this.wasAirborneHit = false;
    this.ghostT = 0;
    this.noPush = 0;
    this.emote = null;
    this.spin = 0;
    this.spinV = 0;
    this.animInit = false;
    this.aO.fill(0);
    this.aOV.fill(0);
    this.acc.reset();
  }

  get speedMult() {
    let m = this.def.stats.speed;
    if (this.status.slow > 0) m *= 0.6;
    if (this.status.speed > 0) m *= 1.3;
    if (this.tired) m *= 0.82;
    return m * (this.world?.speedMult || 1);
  }
  get isNeutral() {
    return NEUTRAL_STATES.has(this.state);
  }
  get isHurt() {
    return HURT_STATES.has(this.state);
  }
  get isAirborne() {
    return !this.grounded;
  }
  get alive() {
    return this.hp > 0;
  }
  // can this fighter currently be hit?
  get hittable() {
    if (this.invuln > 0) return false;
    if (this.state === 'ko' || this.state === 'grabbed' || this.state === 'ultlocked') return false;
    if (this.state === 'getup' || this.state === 'intro') return false;
    return true;
  }

  setState(s) {
    if (this.state !== s || s === 'attack') {
      copyPose(this.animInit ? this.rpose : this.pose, this.prevPose);
      this.blend = s === 'attack' ? 3 : 0;
    }
    this.state = s;
    this.stateT = 0;
    if (s !== 'attack') this.move = null;
  }

  faceOpponent() {
    if (!this.opp) return;
    const dx = this.opp.x - this.x;
    if (Math.abs(dx) > 4) this.facing = dx > 0 ? 1 : -1;
  }

  spendStamina(n) {
    if (this.world?.infiniteStamina?.[this.side]) return true;
    if (this.stamina < n * 0.5 && n > 0) return false;
    this.stamina = Math.max(0, this.stamina - n);
    this.stamDelay = 32;
    if (this.stamina <= 0) this.tired = true;
    return true;
  }
  addMeter(n) {
    this.meter = clamp(this.meter + n * (this.world?.meterMult || 1), 0, 100);
  }

  // ------------------------------------------------------------------ moves
  startMove(id, opts = {}) {
    const m = typeof id === 'string' ? this.def.moves[id] : id;
    if (!m) return false;
    if (m.stam && !opts.free && !this.spendStamina(m.stam)) {
      this.world?.onTired?.(this);
      return false;
    }
    this.setState('attack');
    this.move = m;
    this.moveF = 0;
    this.moveContact = false;
    this.moveWasAir = false;
    this.moveHitDone = new Set();
    this.moveRehit = {};
    this.moveFrom = opts.from || null;
    this.chainTimed = !!opts.timed;
    this.moveSpecial = !!m.special;
    if (m.special) this.stats.specials++;
    if (m.air) this.grounded = false;
    if (!m.air && this.grounded) this.faceOpponent();
    if (m.onStart) m.onStart(this);
    this.runEvents(0);
    this.applyMoveVel(0);
    return true;
  }

  applyMoveVel(f) {
    const vel = this.move?.vel;
    if (!vel) return;
    for (const v of vel) {
      if (v[0] === f) {
        this.vx = v[1] * this.facing * (this.move.special ? 1 : Math.min(1.25, this.speedMult));
        if (v.length > 2) this.vy = v[2];
      }
    }
  }

  runEvents(f) {
    const ev = this.move?.ev;
    if (!ev) return;
    for (const e of ev) if (e[0] === f) this.world.moveEvent(this, e[1], e[2] || {});
  }

  tryUltimate() {
    if (this.meter < 100 && !this.world?.infiniteMeter?.[this.side]) return false;
    if (!this.def.ult) return false;
    this.meter = this.world?.infiniteMeter?.[this.side] ? 100 : 0;
    this.stats.ults++;
    this.startMove(this.def.ult.move, { free: true });
    this.world.superFlash(this, this.def.ult);
    return true;
  }

  trySpecial(inp, air = false) {
    const fwd = inp.dir() * this.facing;
    let id;
    if (air) {
      id = this.def.moves.SA ? 'SA' : null;
      if (!id) return false;
    } else if (inp.held.down && this.def.moves.S3) id = 'S3';
    else if (fwd < 0 && this.def.moves.S2) id = 'S2';
    else id = 'S1';
    if (this.tired && !this.world?.infiniteStamina?.[this.side]) {
      this.world.onTired(this);
      return false;
    }
    return this.startMove(id);
  }

  tryThrow() {
    return this.startMove('THROW');
  }

  // ------------------------------------------------------------------ main tick
  tick() {
    const inp = this.ctrl;
    if (this.flash > 0) this.flash--; // white impact flash: first frames of the freeze only
    if (this.hitstop > 0) {
      this.hitstop--;
      inp.freezeBuffer(); // buffered presses don't age during hit-freeze
      return;
    }
    this.stateT++;
    if (this.invuln > 0) this.invuln--;
    if (this.armor > 0) this.armor--;
    if (this.counterWin > 0) this.counterWin--;
    if (this.parryRecoil > 0) this.parryRecoil--;
    if (this.techWindow > 0) this.techWindow--;
    if (this.noPush > 0) this.noPush--;
    if (this.blend > 0) this.blend--;
    this.tickStatus();

    // stamina regen
    if (this.stamDelay > 0) this.stamDelay--;
    else if (this.stamina < 100) {
      const blocking = this.state === 'block' || this.state === 'blockstun';
      this.stamina = Math.min(100, this.stamina + (blocking ? 0.18 : 0.42) * (this.def.stats.stamRegen || 1));
    }
    if (this.tired && this.stamina >= 35) this.tired = false;

    switch (this.state) {
      case 'idle':
      case 'walk':
      case 'run':
        this.neutral(inp);
        break;
      case 'block':
        this.blockState(inp);
        break;
      case 'blockstun':
        this.vx *= 0.82;
        if (--this.stun <= 0) this.setState(inp.held.down ? 'block' : 'idle');
        break;
      case 'jumpsquat':
        if (this.stateT >= 3) this.doJump(inp);
        break;
      case 'air':
        this.airState(inp);
        break;
      case 'land':
        this.vx *= 0.7;
        if (this.stateT >= (this.landLag || 4)) {
          this.landLag = 0;
          this.setState('idle');
          this.neutral(inp);
        }
        break;
      case 'dash':
        this.dashState(inp);
        break;
      case 'backdash':
        this.vx *= 0.88;
        if (this.stateT === 1) this.invuln = Math.max(this.invuln, 9);
        if (this.stateT >= 18) this.setState('idle');
        break;
      case 'attack':
        this.attackState(inp);
        break;
      case 'hitstun':
        this.vx *= 0.86;
        this.checkBreaker(inp);
        if (this.state === 'hitstun' && --this.stun <= 0) this.recoverNeutral();
        break;
      case 'juggle':
        this.juggleState(inp);
        break;
      case 'knockdown':
        this.vx *= 0.85;
        if (this.stateT >= (this.kdTime || 34)) {
          this.setState('getup');
          this.invuln = 20;
        }
        break;
      case 'getup':
        this.invuln = Math.max(this.invuln, 1);
        if (this.stateT >= 18) {
          this.invuln = 4;
          this.recoverNeutral();
        }
        break;
      case 'dizzy':
        this.vx *= 0.85;
        if (--this.stun <= 0) this.recoverNeutral();
        break;
      case 'frozen':
        this.vx *= 0.9;
        if (--this.stun <= 0) {
          this.world.fx.shards(this.x, this.y - 80 * this.scale, 16, '#bff4ff');
          this.world.sfx('shatter', { pan: this.pan() });
          this.recoverNeutral();
        }
        break;
      case 'grabbed':
      case 'ultlocked':
        break;
      case 'parried':
        this.vx *= 0.8;
        if (--this.stun <= 0) this.recoverNeutral();
        break;
      case 'burst':
        this.vx *= 0.9;
        this.vy *= 0.9;
        if (this.stateT >= 22) {
          this.setState(this.grounded ? 'idle' : 'air');
        }
        break;
      case 'intro':
      case 'victory':
      case 'defeat':
      case 'ko':
        break;
    }

    this.physics();
  }

  recoverNeutral() {
    this.comboHits = 0;
    this.comboDmg = 0;
    this.juggleHits = 0;
    this.wbOk = true;
    this.gbOk = true;
    this.kdOnLand = false;
    this.setState(this.grounded ? 'idle' : 'air');
  }

  pan() {
    return clamp(this.x / 1000, -1, 1);
  }

  // ------------------------------------------------------------------ neutral
  neutral(inp) {
    const W = this.world;
    this.faceOpponent();
    if (this.comboHits) this.recoverNeutralSoft();
    const dir = inp.dir();
    const fwd = dir * this.facing;

    if (inp.buffered('ult', 6)) {
      inp.consume('ult');
      if (this.tryUltimate()) return;
    }
    if (inp.combo2(4, 6)) {
      inp.consume('atk');
      inp.consume('spc');
      if (this.tryThrow()) return;
    }
    if (inp.buffered('spc', 6)) {
      inp.consume('spc');
      if (this.trySpecial(inp)) return;
    }
    if (inp.buffered('atk', 6)) {
      inp.consume('atk');
      let id = 'L1';
      if (this.state === 'run') id = 'DASHATK';
      else if (inp.held.down) id = 'LAUNCH';
      else if (fwd < 0) id = 'HEAVY'; // back + attack: committal power strike
      if (this.startMove(id)) return;
    }
    if (inp.buffered('up', 5)) {
      inp.consume('up');
      this.setState('jumpsquat');
      return;
    }
    const dashPressed = inp.buffered('dash', 4);
    if (dashPressed || inp.dashTap) {
      inp.consume('dash');
      const d = inp.dashTap ? inp.dashTap * this.facing : fwd < 0 ? -1 : 1;
      if (this.startDash(d)) return;
    }
    if (inp.held.down) {
      this.setState('block');
      this.vx = 0;
      return;
    }
    if (dir !== 0) {
      if (this.state === 'run' && fwd > 0) {
        this.vx = this.facing * 7.6 * this.speedMult;
        this.walkPhase += (Math.abs(this.vx) * RUN_DUTY) / RUN_STRIDE;
        if (this.stateT % 6 === 0) W.fx.dust(this.x - this.facing * 10, 0, 1, -this.facing, undefined, 0.6);
        return;
      }
      if (this.state !== 'walk') this.setState('walk');
      const sp = (fwd > 0 ? 4.4 : 3.5) * this.speedMult;
      this.vx = approach(this.vx, dir * sp, 1.4);
      this.walkPhase += Math.abs(this.vx) / 48;
      if (this.stateT % 16 === 8) W.sfx('step', { vol: 0.5, pan: this.pan() });
    } else {
      if (this.state !== 'idle') this.setState('idle');
      this.vx *= 0.7;
    }
  }

  recoverNeutralSoft() {
    this.comboHits = 0;
    this.comboDmg = 0;
    this.juggleHits = 0;
    this.wbOk = true;
    this.gbOk = true;
  }

  startDash(d) {
    if (this.tired && !this.world?.infiniteStamina?.[this.side]) {
      this.world.onTired(this);
      return false;
    }
    if (!this.spendStamina(9)) return false;
    if (d > 0) {
      this.setState('dash');
      this.vx = this.facing * 13.5 * Math.min(1.3, this.speedMult);
      this.world.sfx('dash', { pan: this.pan() });
      this.world.fx.dust(this.x, 0, 4, -this.facing);
    } else {
      this.setState('backdash');
      this.vx = -this.facing * 11 * Math.min(1.25, this.speedMult);
      this.world.sfx('dash', { pan: this.pan(), pitch: 0.9 });
      this.world.fx.dust(this.x, 0, 3, this.facing);
    }
    return true;
  }

  dashState(inp) {
    this.vx *= 0.9;
    if (this.stateT % 3 === 0) this.world.fx.ghost(this.J, this.lookFor(), 12, 0.35);
    if (inp.buffered('atk', 6)) {
      inp.consume('atk');
      if (this.startMove(inp.held.down ? 'LAUNCH' : 'DASHATK')) return;
    }
    if (inp.buffered('spc', 6)) {
      inp.consume('spc');
      if (this.trySpecial(inp)) return;
    }
    if (inp.buffered('up', 5)) {
      inp.consume('up');
      this.setState('jumpsquat');
      this.dashJump = true;
      return;
    }
    if (this.stateT >= 15) {
      const fwd = inp.dir() * this.facing;
      if (fwd > 0) this.setState('run');
      else this.setState('idle');
    }
  }

  blockState(inp) {
    this.vx *= 0.7;
    if (!inp.held.down) {
      this.setState('idle');
      return;
    }
    if (inp.buffered('ult', 6)) {
      inp.consume('ult');
      if (this.tryUltimate()) return;
    }
    if (inp.combo2(4, 6)) {
      inp.consume('atk');
      inp.consume('spc');
      if (this.tryThrow()) return;
    }
    if (inp.buffered('atk', 6)) {
      inp.consume('atk');
      if (this.startMove('LAUNCH')) return;
    }
    if (inp.buffered('spc', 6)) {
      inp.consume('spc');
      if (this.trySpecial(inp)) return;
    }
    if (inp.buffered('up', 5)) {
      inp.consume('up');
      this.setState('jumpsquat');
    }
  }

  doJump(inp) {
    const dir = inp.dir();
    const jv = 17.6 * (this.def.stats.jump || 1) * (this.world?.jumpMult || 1);
    this.vy = -jv;
    const carry = this.dashJump ? this.vx * 0.8 : 0;
    this.vx = dir * 5.2 * Math.min(1.2, this.speedMult) + carry;
    this.dashJump = false;
    this.grounded = false;
    this.airJumps = 1;
    this.airDashes = 1;
    this.setState('air');
    this.shove(A.hipY, 0, 4);
    this.world.sfx('jump', { pan: this.pan() });
    this.world.fx.dust(this.x, 0, 4, 0, undefined, 0.7);
  }

  airState(inp) {
    const W = this.world;
    const dir = inp.dir();
    // air control
    const maxA = 5.4 * Math.min(1.2, this.speedMult);
    if (dir !== 0) this.vx = approach(this.vx, dir * maxA, 0.45);
    if (this.flipT > 0) this.flipT--;
    if (inp.buffered('atk', 5)) {
      inp.consume('atk');
      if (this.startMove(inp.held.down ? 'DIVE' : 'AIR1')) return;
    }
    if (inp.buffered('spc', 5)) {
      inp.consume('spc');
      if (this.trySpecial(inp, true)) return;
    }
    // wall jump
    const atWall = this.x <= -ARENA_HALF + 30 ? -1 : this.x >= ARENA_HALF - 30 ? 1 : 0;
    if (inp.buffered('up', 4) && atWall && dir === atWall) {
      inp.consume('up');
      this.vy = -15.5;
      this.vx = -atWall * 8.5;
      this.facing = -atWall;
      this.flipT = 20;
      this.airJumps = 1;
      W.sfx('jump', { pan: this.pan(), pitch: 1.2 });
      W.fx.dust(this.x + atWall * 10, this.y - 40, 5, -atWall);
      return;
    }
    if (inp.buffered('up', 4) && this.airJumps > 0 && this.stateT > 3) {
      inp.consume('up');
      this.airJumps--;
      this.vy = -15 * (this.def.stats.jump || 1);
      if (dir !== 0) this.vx = dir * maxA;
      this.flipT = 22;
      W.sfx('doubleJump', { pan: this.pan() });
      W.fx.ring(this.x, this.y + 4, 10, 46, 'rgba(255,255,255,0.7)', 14, 4, 3);
      return;
    }
    if (inp.buffered('dash', 4) && this.airDashes > 0) {
      inp.consume('dash');
      if (this.spendStamina(8)) {
        this.airDashes--;
        const d = dir !== 0 ? dir : this.facing;
        this.vx = d * 12.5;
        this.vy = -2.5;
        this.airDashT = 10;
        W.sfx('dash', { pan: this.pan(), pitch: 1.1 });
      }
    }
    if (this.airDashT > 0) {
      this.airDashT--;
      this.vy = Math.min(this.vy, 0.5);
      if (this.airDashT % 2 === 0) W.fx.ghost(this.J, this.lookFor(), 10, 0.3);
    }
  }

  attackState(inp) {
    const m = this.move;
    const f = ++this.moveF;
    this.applyMoveVel(f);
    this.runEvents(f);
    if (this.state !== 'attack' || this.move !== m) return; // event changed state

    // friction
    if (this.grounded && !m.air) {
      const hasVel = m.vel && m.vel.some((v) => v[0] === f);
      if (!hasVel) this.vx *= m.friction || 0.84;
    }
    if (m.air && m.gravity === 0 && f > (m.vel?.[m.vel.length - 1]?.[0] ?? 0)) {
      // keep velocity (dives)
    }

    // throw-cancel: the second button of an ATK+SPC pair arrived a frame or two late
    if (f <= 4 && !this.moveFrom && this.grounded && (m.id === 'L1' || (m.special && !m.isUlt))) {
      const first = m.id === 'L1' ? 'atk' : 'spc';
      const other = m.id === 'L1' ? 'spc' : 'atk';
      if (!inp.consumed[other] && inp.age(other) <= 6 && Math.abs(inp.pressAt[other] - inp.pressAt[first]) <= 5) {
        inp.consume('atk');
        inp.consume('spc');
        if (m.stam) this.stamina = Math.min(100, this.stamina + m.stam); // refund the cancelled move
        if (m.special) this.stats.specials--;
        this.tryThrow();
        return;
      }
    }

    // ultimate cancel (on contact) / special cancel
    if (m.cancel != null && f >= m.cancel && this.moveContact) {
      if (inp.buffered('ult', 8) && (this.meter >= 100 || this.world?.infiniteMeter?.[this.side]) && !m.isUlt) {
        inp.consume('ult');
        if (this.tryUltimate()) return;
      }
      if (inp.buffered('spc', 8) && !m.special) {
        inp.consume('spc');
        const air = !this.grounded;
        if (this.trySpecial(inp, air)) {
          this.move.fromCancel = true;
          return;
        }
      }
    }
    // jump cancel (launchers)
    if (m.jc != null && f >= m.jc && this.moveContact && inp.buffered('up', 8)) {
      inp.consume('up');
      this.vy = -18.5 * (this.def.stats.jump || 1);
      this.vx = this.facing * 2.5;
      this.grounded = false;
      this.airJumps = 1;
      this.airDashes = 1;
      this.setState('air');
      this.world.sfx('jump', { pan: this.pan() });
      return;
    }
    // chain
    if (m.chain && f >= m.chain.at && inp.buffered('atk', 9)) {
      const timed = inp.age('atk') <= f - m.chain.at; // pressed inside the window (not mashed early)
      inp.consume('atk');
      const nextId = m.chain.to;
      // air chains only in air, ground chains only on ground
      if (this.startMove(nextId, { from: m, timed })) {
        if (timed) this.timedBonus = 1;
        return;
      }
    }
    // landing for air moves (and ground moves that leap)
    if (!this.grounded) this.moveWasAir = true;
    if ((m.air || m.until === 'land') && this.grounded) {
      if (m.air ? m.landEnd || f > 2 : this.moveWasAir) {
        if (m.landEv) for (const e of m.landEv) this.world.moveEvent(this, e[0], e[1] || {});
        this.landLag = m.landLag || 5;
        this.setState('land');
        this.world.sfx('land', { pan: this.pan() });
        return;
      }
    }
    if (m.until === 'land' && !this.grounded) {
      if (f >= m.dur) this.moveF = m.dur - 1; // hold last frame
      return;
    }
    if (f >= m.dur) {
      if (m.next) {
        this.startMove(m.next, { free: true, from: m });
        return;
      }
      if (this.grounded) {
        this.setState('idle');
        this.neutral(inp);
      } else this.setState('air');
    }
  }

  checkBreaker(inp) {
    if (this.comboHits < 1) return;
    const can = this.meter >= 50 || this.world?.infiniteMeter?.[this.side];
    if (!can) return;
    if (inp.combo2(4, 6) || inp.buffered('grab', 4)) {
      inp.consume('atk');
      inp.consume('spc');
      this.world.breaker(this);
    }
  }

  juggleState(inp) {
    if (this.stun > 0) this.stun--;
    // tumble: spin decays toward a pose that follows the arc (head back on the way up, flat on the way down)
    const base = lerp(-22, -84, clamp((this.vy + 6) / 14, 0, 1));
    this.spinV += wrapDeg(base - this.spin) * 0.06;
    this.spinV *= 0.9;
    this.spin += this.spinV;
    this.checkBreaker(inp);
    if (this.state !== 'juggle') return;
    // air recovery once stun expired
    if (this.stun <= 0 && !this.kdOnLand) {
      const any = inp.buffered('up', 6) || inp.buffered('atk', 6) || inp.buffered('spc', 6) || inp.buffered('dash', 6);
      if (any) {
        inp.consume('up');
        inp.consume('atk');
        inp.consume('spc');
        inp.consume('dash');
        this.airRecover();
      }
    } else if (this.stun <= 0 && this.kdOnLand && this.vy > 0) {
      const any = inp.buffered('up', 4) || inp.buffered('dash', 4);
      if (any && this.y < -60) {
        inp.consume('up');
        inp.consume('dash');
        this.airRecover();
      }
    }
  }

  airRecover() {
    this.recoverNeutral();
    this.vy = Math.min(this.vy, -7);
    this.vx = -this.facing * 3;
    this.invuln = 12;
    this.flipT = 18;
    this.airJumps = 0;
    this.setState('air');
    this.world.sfx('doubleJump', { pan: this.pan(), pitch: 1.2 });
    this.world.fx.ring(this.x, this.y - 70 * this.scale, 10, 70, '#ffffff', 12, 4);
  }

  // ------------------------------------------------------------------ status effects
  tickStatus() {
    const S = this.status;
    const W = this.world;
    if (S.burn > 0) {
      S.burn--;
      if (S.burn % 12 === 0) this.dot(6, 'fire');
      if (W.time % 3 === 0) W.fx.ember(this.x + rand(-14, 14), this.y - rand(20, 140) * this.scale, '#ff8a2a', 30);
    }
    if (S.poison > 0) {
      S.poison--;
      if (S.poison % 15 === 0) this.dot(5, 'poison');
      if (W.time % 5 === 0) W.fx.dot(this.x + rand(-14, 14), this.y - rand(40, 150) * this.scale, rand(-0.4, 0.4), -1, '#9dff5c', 30, 3, -0.03, true);
    }
    if (S.slow > 0) S.slow--;
    if (S.shock > 0) {
      S.shock--;
      if (W.time % 6 === 0) W.fx.bolt(this.x + rand(-30, 30), this.y - rand(40, 160), this.x + rand(-30, 30), this.y - rand(20, 120), '#fff36b', 5, 2, 4, 12);
    }
    if (S.power > 0) S.power--;
    if (S.speed > 0) S.speed--;
    if (S.mark > 0) S.mark--;
    if (S.regen > 0) {
      S.regen--;
      if (this.hp > 0 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + this.healRate);
      if (W.time % 6 === 0) W.fx.dot(this.x + rand(-20, 20), this.y - rand(10, 150) * this.scale, 0, -1.4, '#9dffb0', 30, 3, -0.02, true);
    }
  }

  dot(n, kind) {
    if (this.hp <= 1 || this.state === 'ko') return;
    this.hp = Math.max(1, this.hp - n);
    this.world.fx.text(this.x + rand(-10, 10), this.y - 170 * this.scale, String(n), { size: 16, color: kind === 'fire' ? '#ffb070' : '#b8ff8a', life: 30 });
  }

  // ------------------------------------------------------------------ physics
  physics() {
    const W = this.world;
    if (this.state === 'grabbed' || this.state === 'ultlocked' || this.state === 'ko') return;
    const grav = GRAVITY * (W?.gravityMult || 1);
    if (!this.grounded) {
      let g = grav;
      if (this.state === 'attack' && this.move && this.move.gravity != null) g *= this.move.gravity;
      if (this.state === 'juggle') g *= 1 + Math.min(0.6, this.juggleHits * 0.05);
      if (this.state === 'air') {
        // snappier arc: a brief hang at the apex, then a heavier fall
        if (Math.abs(this.vy) < 2.5) g *= 0.8;
        else if (this.vy > 0) g *= 1.12;
        if (this.ctrl.held.down && this.vy > -3) g *= 1.7; // fast fall
      }
      if (this.state === 'burst') g *= 0.3;
      if (this.state === 'frozen') g *= 1;
      this.vy += g;
      if (this.vy > 22) this.vy = 22;
    }
    this.x += this.vx;
    this.y += this.vy;

    // walls
    const half = 22 * this.scale;
    const L = -ARENA_HALF + half, R = ARENA_HALF - half;
    this.wallSide = 0;
    if (this.x < L || this.x > R) {
      const side = this.x < L ? -1 : 1;
      this.x = side < 0 ? L : R;
      this.wallSide = side;
      if (this.state === 'juggle' && this.wbPending && Math.abs(this.vx) > 4.5) {
        this.wbPending = false;
        this.vx = -this.vx * 0.45;
        this.vy = Math.min(this.vy, -9.5);
        this.stun = Math.max(this.stun, 14);
        W.onWallBounce(this, side);
      } else if (Math.sign(this.vx) === side) this.vx = 0;
    }

    // ground
    if (this.y >= 0) {
      const wasAir = !this.grounded;
      const impactVy = this.vy;
      this.y = 0;
      if (wasAir) this.onLand(impactVy);
      if (this.state !== 'juggle' || this.vy >= 0) {
        this.vy = 0;
        this.grounded = this.state !== 'juggle';
      }
    } else {
      this.grounded = false;
    }
  }

  onLand(impactVy) {
    const W = this.world;
    this.airJumps = 1;
    this.airDashes = 1;
    this.flipT = 0;
    this.airDashT = 0;
    switch (this.state) {
      case 'air':
        this.grounded = true;
        this.setState('land');
        this.landLag = 4;
        this.shove(A.hipY, -clamp(impactVy * 0.6, 3, 12));
        this.shove(A.lean, clamp(impactVy * 0.4, 2, 8));
        W.sfx('land', { pan: this.pan(), vol: 0.7 });
        W.fx.dust(this.x, 0, 4, 0, undefined, 0.8);
        this.faceOpponent();
        break;
      case 'juggle':
        if (this.gbPending && impactVy > 3) {
          this.gbPending = false;
          this.vy = -11;
          this.stun = Math.max(this.stun, 16);
          W.onGroundBounce(this);
          return;
        }
        this.grounded = true;
        if (this.kdOnLand || impactVy > 8 || this.hp <= 0) {
          this.knockdown(impactVy);
        } else {
          this.recoverNeutral();
          this.setState('land');
          this.landLag = 6;
        }
        break;
      case 'attack':
        this.grounded = true;
        break;
      case 'burst':
      case 'frozen':
      case 'dizzy':
        this.grounded = true;
        break;
      case 'hitstun':
        this.grounded = true;
        break;
      default:
        this.grounded = true;
        break;
    }
  }

  knockdown(impactVy = 8) {
    const W = this.world;
    this.grounded = true;
    this.setState('knockdown');
    this.shove(A.hipY, 0, clamp(impactVy * 0.5, 2, 7));
    this.shove(A.head, -10, 3);
    this.shove(A.hfY, 0, 6);
    this.kdTime = 34;
    this.vx *= 0.5;
    this.vy = 0;
    this.comboHits = 0;
    this.comboDmg = 0;
    this.juggleHits = 0;
    this.kdOnLand = false;
    this.wbPending = false;
    this.gbPending = false;
    W.sfx('knockdown', { pan: this.pan(), vol: clamp(impactVy / 12, 0.5, 1) });
    W.fx.dust(this.x, 0, 10, 0, undefined, 1.2);
    W.arenaImpact(this.x, 0, clamp(impactVy / 20, 0.2, 0.8));
    W.shake(clamp(impactVy / 60, 0.08, 0.3));
  }

  // ------------------------------------------------------------------ animation
  // Target pose for the current state (logic), written into this.pose.
  computePose() {
    const out = this.tmpPose;
    const t = this.world ? this.world.time : 0;
    const set = this.def.poseSet;
    const stance = POSES[set.stance];
    switch (this.state) {
      case 'attack': {
        sampleKeys(this.move.keys, Math.min(this.moveF, this.move.dur), out);
        break;
      }
      case 'idle': {
        copyPose(stance, out);
        // fighting bounce: knees flex, chest and fists follow a beat later
        const tired = this.tired ? 1 : 0;
        const ph = t * (tired ? 0.11 : 0.085) + this.side * 2.1;
        const amp = tired ? 3.2 : 2.2;
        out.hip[1] += Math.sin(ph) * amp - 0.6 - tired * 6;
        out.lean += Math.sin(ph - 0.6) * 1.3 + tired * 9;
        out.head += Math.sin(ph - 1.2) * 1.6 + tired * 6;
        out.hf[0] += Math.sin(ph - 0.9) * 0.9 - tired * 6;
        out.hf[1] += Math.sin(ph - 0.9) * 2.2 - tired * 16;
        out.hb[1] += Math.sin(ph - 1.15) * 2.2 - tired * 14;
        break;
      }
      case 'jumpsquat':
        copyPose(POSES.crouch, out);
        break;
      case 'walk': {
        copyPose(stance, out);
        // fighting-stance shuffle: each foot is planted while the body moves over it
        const fwd = this.vx * this.facing >= 0 ? 1 : -1;
        const ph = this.walkPhase;
        const [fx, fy] = stepFoot(ph, 24, 9, 0.5);
        const [bx, by] = stepFoot(ph + 0.5, 24, 9, 0.5);
        out.ff[0] = stance.ff[0] + fx * fwd;
        out.ff[1] = fy;
        out.fb[0] = stance.fb[0] + bx * fwd;
        out.fb[1] = by;
        out.hip[1] += -2 * Math.cos(ph * Math.PI * 4) - 1;
        out.hip[0] += fwd * 2;
        out.lean += fwd > 0 ? 3 : -5;
        out.hf[1] += Math.sin(ph * Math.PI * 4) * 1.5;
        out.hb[1] += Math.sin(ph * Math.PI * 4 - 0.6) * 1.5;
        break;
      }
      case 'run': {
        copyPose(POSES.dash, out);
        const ph = this.walkPhase;
        const [fx, fy] = runFoot(ph);
        const [bx, by] = runFoot(ph + 0.5);
        out.ff[0] = 8 + fx;
        out.ff[1] = fy;
        out.fb[0] = 8 + bx;
        out.fb[1] = by;
        // ninja run: arms trail behind, chest low and forward
        out.hip[0] = 2;
        out.hip[1] = 76 + 3.5 * Math.sin(Math.PI * 4 * (ph - 0.305));
        out.lean = 24 + 2 * Math.sin(Math.PI * 4 * (ph - 0.1));
        out.head = -12;
        out.hf[0] = -40;
        out.hf[1] = -16 + Math.sin(Math.PI * 4 * ph) * 3;
        out.hb[0] = -48;
        out.hb[1] = -8 + Math.sin(Math.PI * 4 * ph - 0.8) * 3;
        break;
      }
      case 'dash': {
        copyPose(POSES.dash, out);
        const k = clamp(this.stateT / 10, 0, 1);
        out.lean += (1 - k) * 8;
        out.ff[0] += Math.sin(this.stateT * 0.6) * 6;
        break;
      }
      case 'backdash':
        copyPose(POSES.backdash, out);
        if (this.stateT < 10) {
          out.ff[1] = 14 * Math.sin((this.stateT / 10) * Math.PI);
          out.fb[1] = 8 * Math.sin((this.stateT / 10) * Math.PI);
        }
        break;
      case 'land':
        lerpPose(POSES.land, stance, ease.out(clamp(this.stateT / Math.max(4, this.landLag || 4), 0, 1)), out);
        break;
      case 'air': {
        const vy = this.vy;
        if (vy < 0) lerpPose(POSES.jumpTuck, POSES.jumpStretch, ease.in(clamp(-vy / 17, 0, 1)), out);
        else lerpPose(POSES.jumpTuck, POSES.fall, ease.out(clamp(vy / 13, 0, 1)), out);
        out.lean += clamp(this.vx * this.facing, -6, 6) * 1.4;
        if (this.flipT > 0) {
          const p = 1 - this.flipT / 22;
          lerpPose(out, POSES.flipTuck, Math.sin(clamp(p, 0, 1) * Math.PI), out);
          out.rot = 360 * ease.inOut(clamp(p, 0, 1));
        }
        if (this.airDashT > 0) {
          copyPose(POSES.dash, out);
          out.ff[1] = 24;
          out.fb[1] = 34;
          out.hip[1] = 80;
        }
        if (this.wallSide && this.vy > 0) copyPose(POSES.wallCling, out);
        break;
      }
      case 'block': {
        copyPose(POSES[set.block], out);
        out.hip[1] += Math.sin(t * 0.08 + this.side) * 0.8;
        break;
      }
      case 'blockstun':
        copyPose(POSES[set.blockHit], out);
        break;
      case 'hitstun':
      case 'parried': {
        const k = ease.smooth(clamp(this.stun / 12, 0, 1));
        lerpPose(stance, POSES[this.state === 'parried' ? 'parried' : this.hurtPose], k, out);
        break;
      }
      case 'juggle': {
        // limbs trail behind while the body tumbles; curl up during fast spins
        const curl = clamp(0.3 + Math.abs(this.spinV) / 11, 0, 1);
        lerpPose(POSES.hurtAir, POSES.tumble, curl, out);
        const w = Math.sin(t * 0.45 + this.side);
        out.hf[0] += w * 7;
        out.hf[1] += Math.cos(t * 0.38) * 6;
        out.hb[0] -= w * 6;
        out.ff[1] += Math.sin(t * 0.33) * 6;
        out.fb[0] += Math.cos(t * 0.41) * 5;
        out.rot = this.spin;
        break;
      }
      case 'knockdown': {
        copyPose(POSES.lying, out);
        // limbs settle after the impact
        const k = clamp(1 - this.stateT / 14, 0, 1);
        out.hf[1] += k * 16;
        out.ff[1] += k * 10;
        out.hb[1] += k * 10;
        break;
      }
      case 'getup': {
        const p = this.stateT / 18;
        if (p < 0.45) lerpPose(POSES.lying, POSES.getupSit, ease.out(p / 0.45), out);
        else if (p < 0.75) lerpPose(POSES.getupSit, POSES.getupKneel, ease.smooth((p - 0.45) / 0.3), out);
        else lerpPose(POSES.getupKneel, stance, ease.out((p - 0.75) / 0.25), out);
        break;
      }
      case 'dizzy': {
        copyPose(POSES.dizzy, out);
        out.lean += Math.sin(t * 0.12) * 10;
        out.hip[0] += Math.sin(t * 0.12) * 6;
        out.head += Math.sin(t * 0.12 - 0.8) * 12;
        break;
      }
      case 'frozen':
        return; // keep pose
      case 'grabbed':
        copyPose(POSES.grabbed, out);
        if (this.grabRot) out.rot = this.grabRot;
        break;
      case 'ultlocked':
        copyPose(POSES[this.lockPose || 'hurtHigh'], out);
        if (this.lockRot) out.rot = this.lockRot;
        if (this.stateT % 4 < 2 && this.lockShake) out.hip[0] += 3;
        break;
      case 'burst':
        copyPose(POSES.aura, out);
        break;
      case 'cine':
        copyPose(this.cinePose || stance, out);
        break;
      case 'intro': {
        const intro = this.def.introPose || 'victoryBow';
        const p = clamp(this.stateT / 50, 0, 1);
        lerpPose(stance, POSES[intro], Math.sin(p * Math.PI), out);
        break;
      }
      case 'victory': {
        const vp = POSES[this.def.victoryPose || set.victory];
        lerpPose(stance, vp, ease.back(clamp(this.stateT / 18, 0, 1)), out);
        out.hip[1] += Math.sin(t * 0.1) * 1.5;
        break;
      }
      case 'defeat':
        lerpPose(POSES.hurtMid, POSES.defeatKneel, ease.out(clamp(this.stateT / 30, 0, 1)), out);
        break;
      default:
        copyPose(stance, out);
    }
    if (this.blend > 0 && this.state === 'attack') {
      lerpPose(this.prevPose, out, 1 - this.blend / 3, this.pose);
    } else copyPose(out, this.pose);
    this.animate();
  }

  // Render pose: springs follow the target pose, plus decaying impulse offsets
  // (hit whips, landing squash). Attacks are frame-exact; everything else eases.
  animate() {
    const T = this.aT, X = this.aX, V = this.aV, O = this.aO, OV = this.aOV;
    packPose(this.pose, T);
    const frozen = this.hitstop > 0 && !this.snapPose;
    if (!this.animInit || this.snapPose) {
      for (let i = 0; i < NP; i++) {
        X[i] = T[i];
        V[i] = 0;
      }
      this.animInit = true;
      this.snapPose = false;
    } else if (!frozen) {
      const locked = this.state === 'attack' || this.state === 'cine';
      const sp = SPRINGS[this.state] || SPRINGS.default;
      const fast = this.stateT < 4 && (this.state === 'air' || this.state === 'land' || this.state === 'jumpsquat');
      const k = fast ? 0.42 : sp[0], d = fast ? 0.3 : sp[1];
      for (let i = 0; i < NP; i++) {
        const ti = T[i];
        if (ti !== ti) {
          // no weapon angle on this pose
          X[i] = NaN;
          V[i] = 0;
          continue;
        }
        if (X[i] !== X[i]) {
          X[i] = ti;
          V[i] = 0;
          continue;
        }
        let diff = ti - X[i];
        if (ANGLE[i]) diff = wrapDeg(diff);
        if (locked) {
          V[i] = clamp(diff, -7, 7);
          X[i] = ti;
        } else {
          V[i] = V[i] * d + diff * k;
          X[i] += V[i];
        }
      }
      for (let i = 0; i < NP; i++) {
        if (O[i] === 0 && OV[i] === 0) continue;
        OV[i] = OV[i] * 0.6 - O[i] * 0.25;
        O[i] += OV[i];
        if (Math.abs(O[i]) < 0.05 && Math.abs(OV[i]) < 0.05) O[i] = OV[i] = 0;
      }
    }
    unpackPose(X, O, this.rpose);
  }

  // Impulse helpers: displacement shows at once (even during hit-freeze), velocity next frame.
  shove(i, dx, dv = 0) {
    this.aO[i] += dx;
    this.aOV[i] += dv;
  }

  // Visual reaction to a clean hit. dir: +1 if the hit pushes toward the defender's back.
  hitReact(high, power) {
    const m = clamp(power, 0.5, 1.8);
    this.snapPose = true;
    if (high) {
      this.shove(A.head, -20 * m);
      this.shove(A.lean, -10 * m);
      this.shove(A.hfX, -8 * m, 2);
      this.shove(A.hfY, 10 * m);
      this.shove(A.hbX, -10 * m);
      this.shove(A.hbY, 12 * m);
    } else {
      this.shove(A.lean, 12 * m);
      this.shove(A.head, 12 * m);
      this.shove(A.hipX, -6 * m);
      this.shove(A.hipY, -5 * m);
      this.shove(A.hfX, -10 * m);
      this.shove(A.hbX, -8 * m);
    }
  }

  solve() {
    let ox = this.x, oy = this.y;
    if (this.hitstop > 0 && this.hitShake > 0) ox += (this.hitstop % 2 ? 1 : -1) * this.hitShake;
    solvePose(this.rpose, ox, oy, this.facing, this.scale, this.weapon, this.J);
    hurtCapsules(this.J, this.hurt);
    return this.J;
  }

  // Visual-only per-frame update (strands, trails)
  visualUpdate() {
    const J = this.J;
    const m = this.state === 'attack' ? this.move : null;
    let pushed = false;
    if (m && m.hits) {
      for (const h of m.hits) {
        if (this.moveF >= h.f[0] - 2 && this.moveF <= h.f[1] + 1 && h.a) {
          const a = h.a === 'handF' && h.b === 'wTip' ? 'wBase' : h.a;
          const bx = J[a + 'X'] ?? J.handFX, by = J[a + 'Y'] ?? J.handFY;
          const tx = J[(h.b || h.a) + 'X'], ty = J[(h.b || h.a) + 'Y'];
          if (tx != null) {
            this.trail.push(bx, by, tx, ty);
            pushed = true;
          }
          break;
        }
      }
    }
    if (!pushed) this.trail.decay();
    if (this.hitstop <= 0) this.acc.update(J, this);
  }

  lookFor() {
    const sk = this.skin;
    return {
      color: sk.color,
      accent: sk.accent,
      outline: sk.outline || '#0b0b12',
      eyeColor: sk.eye || '#ffffff',
      eyeShape: this.def.eyeShape,
      lineW: this.def.lineW || 7,
      weapon: this.weapon,
      flash: this.flash > 0,
      time: this.world ? this.world.time : 0,
      expr: EXPR[this.state] || 'normal',
      rim: this.world?.arena?.def?.rim,
    };
  }
}
