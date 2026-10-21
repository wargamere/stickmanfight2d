// Match flow: intros, rounds, timer, KO slow-motion, announcer, results.
// Also hosts training-mode helpers.

import { Fighter } from './fighter.js';
import { World } from './world.js';
import { HUD } from './hud.js';
import { AI } from './ai.js';
import { Controller, DEFAULT_BINDINGS, keyLabel } from './input.js';
import { getFighter } from './roster.js';
import { audio } from './audio.js';
import { ARENAS } from './arenas.js';
import { clamp, pick } from './util.js';

export function makeController(kind, opts = {}) {
  const c = new Controller();
  if (kind === 'solo') {
    c.keyMap = opts.bindings?.solo || DEFAULT_BINDINGS.solo;
    c.padIndex = 'any';
    c.useTouch = true;
  } else if (kind === 'p1') {
    c.keyMap = opts.bindings?.p1 || DEFAULT_BINDINGS.p1;
    c.padIndex = 0;
    c.useTouch = true;
  } else if (kind === 'p2') {
    c.keyMap = opts.bindings?.p2 || DEFAULT_BINDINGS.p2;
    c.padIndex = 1;
  }
  return c;
}

export class Match {
  // cfg: { mode, p1:{id,skin,hat,ctrl:'solo'|'p1'|'cpu', level}, p2:{...}, arena, rounds, time,
  //        mods, labels, startHp:[a,b], onEnd(result), settings, bindings, intro:true }
  constructor(cfg) {
    this.cfg = cfg;
    this.mode = cfg.mode || 'arcade';
    this.settings = cfg.settings || {};
    this.roundsToWin = cfg.rounds ?? 2;
    this.timeLimit = cfg.time === Infinity || cfg.time === 0 ? Infinity : (cfg.time || 99) * 60;
    this.labels = cfg.labels || ['P1', 'P2'];
    const mods = cfg.mods || {};
    const mk = (pc, side) => {
      const def = getFighter(pc.id);
      const ctrl = pc.ctrl === 'cpu' ? new Controller() : makeController(pc.ctrl, { bindings: cfg.bindings });
      const f = new Fighter(def, {
        side, controller: ctrl, skin: def.skins[pc.skin || 0] || def.skins[0], hat: pc.hat,
        hpMult: side === 1 ? mods.cpuHp || 1 : mods.p1Hp || 1, scaleMult: side === 1 ? mods.cpuScale || 1 : 1,
      });
      if (pc.ctrl === 'cpu') {
        f.ai = new AI(f, pc.level ?? 2, { dummy: pc.dummy });
        ctrl.ai = f.ai;
      }
      return f;
    };
    this.f = [mk(cfg.p1, 0), mk(cfg.p2, 1)];
    // mirror match: give P2 an alternate skin automatically
    if (cfg.p1.id === cfg.p2.id && (cfg.p1.skin || 0) === (cfg.p2.skin || 0)) {
      const def = this.f[1].def;
      this.f[1].skin = def.skins[1] || def.skins[0];
      this.f[1].acc = this.f[1].acc; // accessories keep shape
    }
    this.arenaId = cfg.arena || pick(ARENAS.filter((a) => a.id !== 'lab' && a.id !== 'void')).id;
    this.world = new World({
      arena: this.arenaId, fighters: this.f, quality: this.settings.quality || 'high',
      mods: { gravity: mods.gravity, damage: mods.damage, speed: mods.speed, meter: mods.meter, jump: mods.jump, dmgTaken: mods.dmgTaken },
      settings: { shake: this.settings.shake ?? 1, damageNumbers: this.settings.damageNumbers !== false, flashes: this.settings.flashes !== false },
    });
    this.hud = new HUD();
    this.wins = [0, 0];
    this.round = 0;
    this.phase = 'intro';
    this.phaseT = 0;
    this.timeLeft = this.timeLimit;
    this.paused = false;
    this.acc = 0;
    this.slow = null;
    this.result = null;
    this.events = [];
    this.stats = { perfects: [0, 0], ultKOs: [0, 0] };
    this.keyHints = cfg.keyHints || [null, null];
    this.subLabel = cfg.subLabel || '';
    this.hookWorld();
    this.timeScale = mods.turbo || 1;
    if (mods.startHp && !cfg.startHp) cfg.startHp = mods.startHp;
    if (this.mode === 'demo') this.world.muted = true;
    if (mods.regen) this.regen = mods.regen;
    if (mods.poison) this.poisonFloor = mods.poison;
    this.startRound(true);
    if (this.mode === 'training') this.setupTraining();
    const track = cfg.music || (ARENAS.find((a) => a.id === this.arenaId) || {}).music || 'battle1';
    if (this.mode !== 'demo') audio.playMusic(track);
  }

  get world_() {
    return this.world;
  }

  hookWorld() {
    const W = this.world;
    W.on.ko = (def, att) => this.onKO(def, att);
    W.on.hit = (att, def, h, dmg, tag) => this.emit('hit', { att, def, h, dmg, tag });
    W.on.parry = (def) => this.emit('parry', { f: def });
    W.on.breaker = (f) => this.emit('breaker', { f });
    W.on.ultimate = (f) => this.emit('ultimate', { f });
    W.on.ultHit = (att, def, dmg) => this.emit('ultHit', { att, def, dmg });
    W.on.guardBreak = (def) => this.emit('guardBreak', { f: def });
    W.on.counter = (def) => this.emit('counter', { f: def });
    W.on.wallSplat = (f) => this.emit('wallSplat', { f });
  }
  sfx(name, opts) {
    if (this.mode !== 'demo') audio.sfx(name, opts);
  }
  emit(type, data) {
    if (this.cfg.onEvent) this.cfg.onEvent(type, data, this);
  }
  onComboEnd(side, hits, dmg) {
    this.emit('combo', { side, hits, dmg });
  }

  startRound(first = false) {
    this.round++;
    const W = this.world;
    W.ents.length = 0;
    W.fx.clear();
    W.cine = null;
    W.freeze = 0;
    W.dimTarget = 0;
    W.cam.override = null;
    const [a, b] = this.f;
    const keepMeter = [a.meter, b.meter];
    a.resetRound(-240);
    b.resetRound(240);
    a.meter = first ? (this.cfg.startMeter?.[0] ?? 0) : keepMeter[0];
    b.meter = first ? (this.cfg.startMeter?.[1] ?? 0) : keepMeter[1];
    if (first && this.cfg.startHp) {
      a.hp = a.dispHp = Math.round(a.maxHp * this.cfg.startHp[0]);
      b.hp = b.dispHp = Math.round(b.maxHp * this.cfg.startHp[1]);
    }
    a.ragdoll = b.ragdoll = null;
    a.visible = b.visible = true;
    a.ctrl.reset();
    b.ctrl.reset();
    W.cam.reset(0);
    this.timeLeft = this.timeLimit;
    this.koSide = null;
    if (first && this.cfg.intro !== false && this.mode !== 'training') {
      this.phase = 'intro';
      a.setState('intro');
      b.setState('intro');
      a.x = -420;
      b.x = 420;
    } else {
      this.phase = 'ready';
      if (this.mode === 'training') this.phase = 'fight';
    }
    this.phaseT = 0;
  }

  // ---------------------------------------------------------------- update
  update(view) {
    if (this.paused) return;
    this.phaseT++;
    const W = this.world;
    const [a, b] = this.f;

    switch (this.phase) {
      case 'intro': {
        // fighters stride in from the edges and strike their intro pose
        for (const f of this.f) {
          const target = f.side === 0 ? -240 : 240;
          f.x += (target - f.x) * 0.06;
          f.facing = f.side === 0 ? 1 : -1;
        }
        if (this.phaseT === 1 && this.cfg.introText) this.hud.say(this.cfg.introText, { size: 80, life: 70, color: '#ffd23f', style: 'grow', sub: this.cfg.introSub });
        if (this.phaseT > 75 || (this.phaseT > 20 && this.skipPressed())) {
          for (const f of this.f) {
            f.x = f.side === 0 ? -240 : 240;
            f.setState('idle');
          }
          this.phase = 'ready';
          this.phaseT = 0;
        }
        break;
      }
      case 'ready': {
        if (this.phaseT === 1) {
          const final = this.wins[0] === this.roundsToWin - 1 && this.wins[1] === this.roundsToWin - 1 && this.roundsToWin > 1;
          const label = this.cfg.roundLabel ? this.cfg.roundLabel(this.round) : final ? 'FINAL ROUND' : this.roundsToWin > 1 ? `ROUND ${this.round}` : this.cfg.singleLabel || 'ROUND 1';
          this.hud.say(label, { size: 96, life: 58, color: '#ffffff' });
          this.sfx('announceRound');
          if (final && this.mode !== 'demo') audio.setIntensity(0.8);
        }
        if (this.phaseT === 60) {
          this.hud.say('FIGHT!', { size: 140, life: 40, color: '#ffd23f' });
          this.sfx('announceFight');
          W.shake(0.2);
        }
        if (this.phaseT >= 70) {
          this.phase = 'fight';
          this.phaseT = 0;
        }
        break;
      }
      case 'fight': {
        if (!W.freeze && !W.cine && this.timeLimit !== Infinity) {
          this.timeLeft--;
          if (this.timeLeft === 600) this.sfx('countdown');
          if (this.timeLeft <= 0) this.timeUp();
        }
        if (this.mode === 'training') this.trainingTick();
        if (this.regen && W.time % 30 === 0) {
          const f = this.f[1];
          if (f.hp > 0 && f.comboHits === 0) f.hp = Math.min(f.maxHp, f.hp + this.regen);
        }
        if (this.poisonFloor && W.time % 40 === 0) {
          for (const f of this.f) if (f.hp > 1 && f.state !== 'ko') f.hp = Math.max(1, f.hp - this.poisonFloor);
        }
        const low = Math.min(a.hp / a.maxHp, b.hp / b.maxHp);
        if (this.mode !== 'demo') audio.setIntensity(low < 0.3 ? 1 : low < 0.55 ? 0.5 : 0.15);
        break;
      }
      case 'ko': {
        // slow motion then let the ragdoll settle
        if (this.phaseT === 70) this.slow = null;
        const loser = this.f[this.koSide];
        const settled = !loser.ragdoll || loser.ragdoll.settled > 20;
        if (this.phaseT > 110 && (settled || this.phaseT > 200)) this.roundOver();
        break;
      }
      case 'timeup':
        if (this.phaseT > 100) this.roundOver();
        break;
      case 'roundEnd':
        if (this.phaseT > 120 || (this.phaseT > 40 && this.skipPressed())) this.nextRound();
        break;
      case 'matchEnd':
        if (this.phaseT > 170 || (this.phaseT > 60 && this.skipPressed())) {
          if (!this.ended) {
            this.ended = true;
            this.cfg.onEnd?.(this.result, this);
          }
        }
        break;
    }

    // inputs + simulation (with slow motion)
    const scale = (this.slow ? this.slow.scale : 1) * this.timeScale;
    this.acc += scale;
    let steps = 0;
    while (this.acc >= 1 && steps < 3) {
      this.acc -= 1;
      steps++;
      for (const f of this.f) if (f.ai) f.ai.update();
      // freeze controls outside of the fight phase
      if (this.phase !== 'fight' && this.phase !== 'ko') {
        for (const f of this.f) {
          f.ctrl.reset();
          f.ctrl.frame++;
        }
      } else for (const f of this.f) f.ctrl.update();
      W.tick(view);
    }
    if (steps === 0) {
      // keep cosmetics alive in heavy slow-mo
      W.fx.update();
    }
    this.hud.update(this);
  }

  skipPressed() {
    return this.f.some((f) => !f.ai && (f.ctrl.held.atk || f.ctrl.held.spc));
  }

  onKO(def, att) {
    if (this.phase !== 'fight') return;
    this.koSide = def.side;
    this.phase = 'ko';
    this.phaseT = 0;
    this.slow = { scale: 0.25 };
    const W = this.world;
    W.cam.override = { x: def.x, y: Math.min(0, def.y) - 60, zoom: 1.45, k: 0.12 };
    setTimeout(() => {}, 0);
    const winner = this.f[1 - def.side];
    const perfect = winner.hp >= winner.maxHp;
    const both = winner.hp <= 0;
    this.hud.say(both ? 'DOUBLE K.O.' : 'K.O.', { size: 170, life: 100, color: '#ff3d3d', sub: perfect ? 'PERFECT' : '' });
    this.sfx('ko');
    W.flashScreen('#ffffff', 0.7);
    W.shake(0.6);
    if (perfect) {
      this.stats.perfects[winner.side]++;
      setTimeout(() => this.sfx('perfect'), 600);
    }
    this.lastKO = { winner: winner.side, perfect, byUlt: !!(W.cine || att?.state === 'cine') };
    this.emit('ko', { winner, loser: def, perfect });
  }

  timeUp() {
    const [a, b] = this.f;
    const pa = a.hp / a.maxHp, pb = b.hp / b.maxHp;
    this.phase = 'timeup';
    this.phaseT = 0;
    this.sfx('timeUp');
    this.hud.say('TIME!', { size: 140, life: 90, color: '#ffd23f' });
    if (Math.abs(pa - pb) < 0.001) this.koSide = -1;
    else this.koSide = pa < pb ? 0 : 1;
    this.lastKO = { winner: this.koSide === -1 ? -1 : 1 - this.koSide, perfect: false, timeout: true };
  }

  roundOver() {
    const W = this.world;
    this.slow = null;
    W.cam.override = null;
    const winSide = this.lastKO.winner;
    if (winSide >= 0) {
      this.wins[winSide]++;
      const w = this.f[winSide];
      if (w.state !== 'ko') {
        w.setState('victory');
        w.vx = 0;
      }
      const loser = this.f[1 - winSide];
      if (loser.state !== 'ko') loser.setState('defeat');
      W.cam.override = { x: w.x, y: -40, zoom: 1.3, k: 0.06 };
    }
    const matchWon = winSide >= 0 && this.wins[winSide] >= this.roundsToWin;
    if (matchWon) {
      this.phase = 'matchEnd';
      this.phaseT = 0;
      const humanWon = this.cfg.p1.ctrl !== 'cpu' && winSide === 0;
      const vs = this.cfg.p2.ctrl !== 'cpu';
      let label;
      if (this.mode === 'demo') label = '';
      else if (vs) label = `${this.labels[winSide]} WINS`;
      else label = humanWon ? 'YOU WIN' : 'YOU LOSE';
      if (label) this.hud.say(label, { size: 120, life: 170, color: humanWon || vs ? '#ffd23f' : '#ff5c5c', style: 'grow', sub: this.f[winSide].def.name });
      if (this.mode !== 'demo') audio.stopMusic(0.6);
      this.sfx(humanWon || vs ? 'victory' : 'defeat');
      this.result = {
        winner: winSide,
        humanWon,
        wins: this.wins.slice(),
        stats: this.f.map((f) => ({ ...f.stats })),
        hpLeft: this.f.map((f) => Math.max(0, f.hp) / f.maxHp),
        perfect: this.lastKO.perfect,
        perfects: this.stats.perfects.slice(),
        timeLeft: this.timeLeft,
        rounds: this.round,
        fighters: this.f.map((f) => f.def.id),
      };
    } else {
      this.phase = 'roundEnd';
      this.phaseT = 0;
      if (winSide < 0) this.hud.say('DRAW', { size: 120, life: 100 });
      else this.hud.say(this.f[winSide].def.name + ' WINS', { size: 90, life: 100, color: '#ffffff', style: 'grow', sub: this.lastKO.perfect ? 'PERFECT ROUND' : '' });
    }
  }

  nextRound() {
    this.startRound(false);
  }

  // ---------------------------------------------------------------- training
  setupTraining() {
    this.training = { dummy: 'stand', meter: true, refill: true, hitboxes: false, idle: 0, lastCombo: null, last: [] };
    this.world.infiniteMeter = [true, true];
    this.world.infiniteStamina = [true, false];
    this.timeLeft = Infinity;
    this.timeLimit = Infinity;
  }
  setDummy(mode) {
    const d = this.f[1];
    this.training.dummy = mode;
    if (mode.startsWith('cpu')) {
      d.ai.dummy = null;
      d.ai.setLevel(Number(mode.slice(3)) || 2);
    } else d.ai.dummy = mode;
  }
  trainingTick() {
    const T = this.training;
    const W = this.world;
    W.showHitboxes = T.hitboxes;
    W.infiniteMeter = [T.meter, T.meter];
    for (const f of this.f) {
      if (f.comboHits === 0 && f.isNeutral) {
        if (T.refill && f.hp < f.maxHp) {
          f.idleRefill = (f.idleRefill || 0) + 1;
          if (f.idleRefill > 50) {
            f.hp = f.maxHp;
            f.dispHp = f.maxHp;
            f.stamina = 100;
          }
        }
      } else f.idleRefill = 0;
      if (f.hp <= 0) f.hp = 1;
    }
  }

  // ---------------------------------------------------------------- draw
  draw(ctx, view) {
    this.world.draw(ctx, view);
    this.hud.draw(ctx, view, this);
  }
}

// Key hint labels for HUD (ultimate key)
export function ultHint(kind, bindings) {
  const map = bindings?.[kind] || DEFAULT_BINDINGS[kind];
  if (!map) return null;
  return `[${keyLabel(map.ult[0])}]`;
}

export { clamp };
