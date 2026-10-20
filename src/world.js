// World: the fight simulation (fighters, entities, combat, cinematics) and
// its rendering. Match flow (rounds, timer, announcer) lives in match.js.

import { clamp, lerp, rand, sign, capsuleHit, chance } from './util.js';
import { Effects, SPARK_COLORS } from './effects.js';
import { Camera } from './camera.js';
import { Ragdoll } from './ragdoll.js';
import { drawStickman } from './skeleton.js';
import { copyPose, lerpPose, makePose } from './skeleton.js';
import { POSES } from './poses.js';
import { sampleKeys, ARENA_HALF } from './fighter.js';
import { Projectile, GroundWave, Strike, Aura, Mine, Wall, Beam } from './entities.js';
import { createArenaState, updateArena, drawArenaBack, drawArenaFront, arenaImpact } from './arenas.js';
import { audio } from './audio.js';

const ELEM_SFX = { fire: 'fire', ice: 'ice', shock: 'shock', shadow: 'shadow', poison: 'poison', void: 'shadow', energy: 'energy', earth: 'ground', wind: 'wind' };

export class World {
  constructor({ arena = 'dojo', fighters, quality = 'high', mods = {}, settings = {} }) {
    this.fighters = fighters;
    this.fx = new Effects();
    this.fx.quality = quality === 'low' ? 0.5 : 1;
    this.ents = [];
    this.cam = new Camera();
    this.cam.shakeScale = settings.shake ?? 1;
    this.settings = settings;
    this.arenaId = arena;
    this.arena = createArenaState(arena, { quality, seed: (Math.random() * 1e9) | 0 });
    this.time = 0;
    this.freeze = 0;
    this.freezeOwner = null;
    this.cine = null;
    this.dim = 0;
    this.dimTarget = 0;
    this.flash = null;
    this.banner = null;
    this.on = {};
    this.tiredTextAt = [-99, -99];
    // modifiers
    this.gravityMult = mods.gravity ?? 1;
    this.dmgMult = mods.damage ?? 1;
    this.speedMult = mods.speed ?? 1;
    this.meterMult = mods.meter ?? 1;
    this.jumpMult = mods.jump ?? 1;
    this.dmgTaken = mods.dmgTaken || [1, 1];
    this.infiniteMeter = [false, false];
    this.infiniteStamina = [false, false];
    this.showHitboxes = false;
    fighters[0].opp = fighters[1];
    fighters[1].opp = fighters[0];
    for (const f of fighters) f.world = this;
  }

  // ---------------------------------------------------------------- services
  sfx(name, opts) {
    if (!this.muted) audio.sfx(name, opts);
  }
  shake(a) {
    this.cam.shake(a);
  }
  flashScreen(color, a = 0.4) {
    if (this.settings.flashes === false) a *= 0.35;
    this.flash = { color, a };
  }
  arenaImpact(x, y, p) {
    try {
      arenaImpact(this.arena, x, y, p);
    } catch (e) {
      /* arena optional */
    }
  }
  emit(name, ...args) {
    const fn = this.on[name];
    if (fn) fn(...args);
  }

  // ---------------------------------------------------------------- tick
  tick(view) {
    this.time++;
    const [a, b] = this.fighters;
    this.dim = lerp(this.dim, this.dimTarget, 0.15);
    if (this.flash) {
      this.flash.a *= 0.86;
      if (this.flash.a < 0.01) this.flash = null;
    }
    if (this.banner) {
      this.banner.t++;
      if (this.banner.t > 70) this.banner = null;
    }

    if (this.freeze > 0) {
      this.freeze--;
      const o = this.freezeOwner;
      if (o) {
        if (this.time % 2 === 0) {
          const ang = rand(0, Math.PI * 2);
          const r = rand(80, 160);
          this.fx.spark(o.x + Math.cos(ang) * r, o.y - 90 + Math.sin(ang) * r, ang + Math.PI, rand(4, 8), o.skin.accent, 16, 20, 3);
        }
        o.computePose();
        o.solve();
        o.visualUpdate();
      }
      if (this.freeze === 0) {
        this.freezeOwner = null;
        if (!this.cine) {
          this.cam.override = null;
          this.dimTarget = 0;
        }
      }
      this.fx.update();
      this.cam.update(this.fighters, view);
      updateArena(this.arena, 1 / 60);
      return;
    }

    if (this.cine) this.tickCinematic();

    for (const f of this.fighters) {
      if (f.state === 'ko') {
        if (f.ragdoll) f.ragdoll.update(0.75 * this.gravityMult);
        continue;
      }
      if (this.cine && (f === this.cine.att || f === this.cine.def)) continue;
      f.tick();
    }
    this.resolvePush(view);
    for (const f of this.fighters) {
      if (f.state === 'ko') continue;
      f.computePose();
      f.solve();
    }
    if (!this.cine) {
      this.checkMelee(a, b);
      this.checkMelee(b, a);
    }
    // entities
    for (const e of this.ents) if (!e.dead) e.update();
    this.clashProjectiles();
    this.ents = this.ents.filter((e) => !e.dead);
    for (const f of this.fighters) if (f.state !== 'ko') f.visualUpdate();
    // trailing health
    for (const f of this.fighters) {
      if (f.dispHp > f.hp) {
        if (f.comboHits === 0 || f.state === 'ko') f.dispHp = Math.max(f.hp, f.dispHp - f.maxHp * 0.012);
      } else f.dispHp = f.hp;
    }
    this.fx.update();
    this.cam.update(this.fighters, view);
    updateArena(this.arena, 1 / 60);
  }

  resolvePush(view) {
    const [a, b] = this.fighters;
    const skip = (f) => f.state === 'ko' || f.state === 'grabbed' || f.state === 'ultlocked' || f.state === 'cine' || f.noPush > 0;
    if (skip(a) || skip(b)) return;
    const dx = b.x - a.x;
    const W = 20 * (a.scale + b.scale);
    const vertical = Math.abs(a.y - b.y) < 95 * Math.max(a.scale, b.scale);
    if (vertical && Math.abs(dx) < W) {
      const s = dx === 0 ? (a.facing > 0 ? 1 : -1) : sign(dx);
      const push = (W - Math.abs(dx)) / 2;
      a.x -= s * push;
      b.x += s * push;
      const lim = ARENA_HALF - 22;
      // cornered: push the other one out
      if (a.x < -lim) {
        b.x += -lim - a.x;
        a.x = -lim;
      }
      if (a.x > lim) {
        b.x -= a.x - lim;
        a.x = lim;
      }
      if (b.x < -lim) {
        a.x += -lim - b.x;
        b.x = -lim;
      }
      if (b.x > lim) {
        a.x -= b.x - lim;
        b.x = lim;
      }
    }
    // keep both on camera
    const maxSep = view.w / this.cam.minZoom - 160;
    const d = b.x - a.x;
    if (Math.abs(d) > maxSep) {
      const over = Math.abs(d) - maxSep;
      // push back whoever is moving away
      const av = a.vx * -sign(d), bv = b.vx * sign(d);
      if (av > bv) a.x += sign(d) * over;
      else b.x -= sign(d) * over;
    }
  }

  // ---------------------------------------------------------------- melee hit detection
  checkMelee(att, def) {
    if (att.state !== 'attack' || !att.move.hits || att.hitstop > 0) return;
    const m = att.move;
    const J = att.J;
    for (let i = 0; i < m.hits.length; i++) {
      const h = m.hits[i];
      if (att.moveF < h.f[0] || att.moveF > h.f[1]) continue;
      if (h.rehit) {
        const last = att.moveRehit[i] ?? -999;
        if (att.moveF - last < h.rehit) continue;
      } else if (att.moveHitDone.has(i)) continue;
      if (!def.hittable) continue;
      if (def.state === 'knockdown' && !h.otg) continue;
      if (h.airOnly && def.grounded) continue;
      const cap = this.hitCapsule(att, h, J);
      if (!cap) continue;
      let contact = null;
      for (const hb of def.hurt) {
        contact = capsuleHit(cap, hb);
        if (contact) break;
      }
      if (!contact) continue;
      const res = this.applyHit(att, def, h, contact.x, contact.y, null);
      if (res !== 'miss') {
        att.moveHitDone.add(i);
        att.moveRehit[i] = att.moveF;
        att.moveContact = true;
        if (h.bounce && res === 'hit') {
          att.vy = h.bounce;
          att.vx = -att.facing * 2;
          att.setState('air');
          att.airJumps = 1;
          att.airDashes = 1;
        }
      }
      if (att.state !== 'attack') return;
    }
  }

  hitCapsule(att, h, J) {
    const s = att.scale;
    if (h.area) {
      // facing-space rect relative to origin: [x, y(up), w, h]
      const [x, y, w, hh] = h.area;
      const cx = att.x + att.facing * (x + w / 2) * s;
      const cy = att.y - (y + hh / 2) * s;
      const r = Math.min(w, hh) / 2 * s;
      const long = (Math.max(w, hh) / 2) * s - r;
      if (w >= hh) return { ax: cx - long, ay: cy, bx: cx + long, by: cy, r };
      return { ax: cx, ay: cy - long, bx: cx, by: cy + long, r };
    }
    const ax = J[h.a + 'X'], ay = J[h.a + 'Y'];
    if (ax == null) return null;
    const bx = h.b ? J[h.b + 'X'] : ax, by = h.b ? J[h.b + 'Y'] : ay;
    if (bx == null) return null;
    return { ax, ay, bx, by, r: (h.r || 14) * s };
  }

  // ---------------------------------------------------------------- hit resolution
  // returns 'hit' | 'block' | 'parry' | 'counter' | 'armor' | 'miss'
  applyHit(att, def, h, cx, cy, proj) {
    if (!def.hittable) return 'miss';
    if (def.state === 'knockdown' && !h.otg) return 'miss';
    const kbDir = proj ? sign(proj.vx || proj.dir || def.x - proj.x) : att.facing;
    const fromFront = def.facing === -kbDir;
    const stopBase = h.stop ?? 5;

    // counter stance
    if (def.counterWin > 0 && fromFront && !h.unblock && !h.lock) {
      def.counterWin = 0;
      def.invuln = 24;
      def.startMove(def.counterMove, { free: true });
      if (!proj) {
        att.setState('parried');
        att.stun = 30;
        att.vx = -att.facing * 3;
      } else proj.dead = true;
      def.hitstop = att.hitstop = 10;
      this.fx.parrySpark(cx, cy);
      this.fx.text(def.x, def.y - 200 * def.scale, 'COUNTER!', { color: '#7ff3ff', size: 34 });
      this.sfx('counter', { pan: def.pan() });
      this.flashScreen('#bff8ff', 0.25);
      this.shake(0.25);
      this.emit('counter', def, att);
      return 'counter';
    }

    // parry: block tapped just before impact
    const canDefend = def.grounded && fromFront && !h.unblock && !h.lock;
    const defStates = def.state === 'block' || def.state === 'blockstun' || def.state === 'idle' || def.state === 'walk';
    if (canDefend && defStates && def.ctrl.held.down && def.ctrl.age('down') <= 6) {
      def.ctrl.pressAt.down = -999; // one parry per tap
      def.addMeter(14);
      def.stamina = Math.min(100, def.stamina + 15);
      def.stats.parries++;
      def.setState('idle');
      if (!proj) {
        att.setState('parried');
        att.stun = 26;
        att.vx = -att.facing * 4;
      }
      def.hitstop = att.hitstop = 12;
      this.fx.parrySpark(cx, cy);
      this.fx.text(def.x, def.y - 210 * def.scale, 'PARRY!', { color: '#7ff3ff', size: 38 });
      this.sfx('parry', { pan: def.pan() });
      this.flashScreen('#e0fbff', 0.3);
      this.shake(0.15);
      this.emit('parry', def, att);
      return 'parry';
    }

    // block
    if (canDefend && (def.state === 'block' || def.state === 'blockstun')) {
      const chip = Math.round(h.dmg * (h.chip ?? (proj ? 0.14 : 0.06)) * att.def.stats.power * this.dmgMult);
      def.hp = Math.max(1, def.hp - chip);
      const guard = (h.guard ?? h.dmg * 0.42) * (def.def.stats.guard || 1);
      def.stamina -= guard;
      def.stamDelay = 40;
      def.stats.blocks++;
      att.addMeter(3);
      def.addMeter(4);
      if (def.stamina <= 0) {
        this.guardBreak(def, att);
      } else {
        def.setState('blockstun');
        def.stun = h.bstun ?? Math.round((h.stun ?? 16) * 0.72);
        def.vx = kbDir * Math.max(2.5, (h.kb?.[0] ?? 3) * 0.8);
        if (!proj && Math.abs(def.x) > ARENA_HALF - 40) att.vx = -kbDir * 4;
      }
      def.hitstop = Math.round(stopBase * 0.75);
      if (!proj) att.hitstop = def.hitstop;
      def.hitShake = 3;
      this.fx.blockSpark(cx, cy, kbDir);
      this.sfx('block', { pan: def.pan(), vol: clamp(h.dmg / 50, 0.5, 1.2) });
      this.emit('block', def, att, h);
      return 'block';
    }

    // ---- clean hit
    let dmg = h.dmg * att.def.stats.power * this.dmgMult * this.dmgTaken[def.side] / (def.def.stats.defense || 1);
    if (att.status.power > 0) dmg *= 1.25;
    if (def.status.mark > 0) dmg *= 1.15;
    const scaling = h.noScale ? 1 : Math.max(0.32, 1 - def.comboHits * 0.075);
    dmg *= scaling;
    let tag = null;
    let extraStun = 0;
    if (def.state === 'attack' && def.move && def.move.hits && !proj) {
      const first = def.move.hits[0].f[0];
      if (def.moveF < first) {
        dmg *= 1.2;
        extraStun = 8;
        tag = 'COUNTER HIT';
      } else if (def.moveF > def.move.hits[def.move.hits.length - 1].f[1]) {
        dmg *= 1.1;
        tag = 'PUNISH';
      }
    }
    if (!proj && !att.grounded && def.facing === att.facing && (def.state === 'block' || def.state === 'blockstun')) {
      tag = 'CROSS-UP!';
      dmg *= 1.1;
    }
    if (att.timedBonus && !proj) {
      dmg *= 1.12;
      att.timedBonus = 0;
      this.fx.ring(cx, cy, 6, 50, '#ffd36b', 10, 3);
    }

    // super armor absorbs the hit's reaction
    if (def.armor > 0 && !h.lock && !h.unblock) {
      dmg = Math.round(dmg * 0.6);
      def.hp = Math.max(1, def.hp - dmg);
      def.flash = 4;
      def.hitstop = att.hitstop = Math.round(stopBase * 0.6);
      this.fx.hitSpark(cx, cy, kbDir, 'light', '#ffffff');
      this.fx.text(def.x, def.y - 200 * def.scale, 'ARMOR', { color: '#ffd36b', size: 24 });
      this.sfx('metal', { pan: def.pan() });
      return 'armor';
    }

    dmg = Math.max(1, Math.round(dmg));
    const wasAirborne = !def.grounded;
    def.hp -= dmg;
    def.comboHits++;
    def.comboDmg += dmg;
    def.lastAttacker = att;
    att.stats.dealt += dmg;
    att.stats.hits++;
    def.stats.taken += dmg;
    att.stats.maxCombo = Math.max(att.stats.maxCombo, def.comboHits);
    att.addMeter(dmg * 0.13);
    def.addMeter(dmg * 0.09);
    def.flash = 3;
    def.status.regen = 0;
    if (h.drain) att.hp = Math.min(att.maxHp, att.hp + dmg * h.drain);

    // status
    if (h.status) {
      for (const k in h.status) def.status[k] = Math.max(def.status[k], h.status[k]);
    }

    const ko = def.hp <= 0;
    const stop = ko ? stopBase + 10 : stopBase;
    def.hitstop = stop;
    if (!proj) att.hitstop = stop;
    def.hitShake = clamp(h.dmg / 8, 3, 9);

    // effects
    const sparkKind = h.spark || 'light';
    const col = SPARK_COLORS[h.elem] || SPARK_COLORS[sparkKind] || '#ffe9a8';
    this.fx.hitSpark(cx, cy, kbDir, sparkKind === 'slashHeavy' || sparkKind === 'heavy' || h.dmg >= 60 ? (sparkKind.startsWith('slash') ? 'slashHeavy' : 'heavy') : sparkKind, col);
    if (h.elem === 'fire') this.fx.explosion(cx, cy, '#ff7b2a', 0.35);
    if (h.elem === 'ice') this.fx.shards(cx, cy, 6, '#bff4ff', 0.7);
    if (h.elem === 'shock') {
      this.fx.bolt(cx - 40, cy - 30, cx + 40, cy + 30, '#fff36b', 8, 3, 6, 14);
      this.fx.bolt(cx + 30, cy - 40, cx - 30, cy + 40, '#ffffff', 8, 2, 6, 14);
    }
    if (h.elem === 'shadow' || h.elem === 'void') this.fx.burst(cx, cy, col, 10, 8);
    this.sfx(h.sfx || 'hitLight', { pan: def.pan(), vol: clamp(0.7 + h.dmg / 120, 0.7, 1.3) });
    if (h.elem && ELEM_SFX[h.elem] && h.dmg >= 30) this.sfx(ELEM_SFX[h.elem], { pan: def.pan(), vol: 0.55 });
    const shake = h.shake ?? clamp(h.dmg / 400, 0.03, 0.2);
    this.shake(shake);
    if (h.dmg >= 60) this.cam.kick(kbDir * 6, -3);
    if (h.dmg >= 55) this.arenaImpact(cx, cy, clamp(h.dmg / 120, 0.2, 0.9));
    if (this.settings.damageNumbers !== false) {
      this.fx.text(cx + rand(-14, 14), cy - 30, String(dmg), {
        size: clamp(18 + dmg / 4, 18, 42), color: dmg >= 60 ? '#ffb347' : '#ffffff', life: 40, vy: -2,
      });
    }
    if (tag) this.fx.text(def.x, def.y - 215 * def.scale, tag, { color: tag === 'PUNISH' ? '#ff9a5c' : '#ffe066', size: 28 });

    // reaction
    if (def.state === 'attack' && def.move?.until === 'land') def.move = null;
    def.trail.clear();
    const weight = def.def.stats.weight || 1;
    const kbx = (h.kb?.[0] ?? 3) * kbDir / weight;
    let kby = h.kb?.[1] ?? 0;
    const stun = Math.round((h.stun ?? 16) * Math.max(0.45, 1 - def.comboHits * 0.03)) + extraStun;

    if (h.pull) {
      def.x = att.x + att.facing * (60 + 30 * att.scale);
      def.facing = -att.facing;
    }

    if (ko) {
      this.koFighter(def, att, kbx * 1.4 + kbDir * 3, Math.min(kby, -7) - 3, h);
      return 'hit';
    }

    if (h.lock) {
      def.facing = -kbDir;
      this.startCinematic(att, def, att.def.ult.script);
      return 'hit';
    }

    if (h.status && h.status.freeze) {
      def.setState('frozen');
      def.stun = h.status.freeze;
      def.vx = kbx * 0.5;
      def.status.freeze = 0;
      this.sfx('ice', { pan: def.pan() });
      return 'hit';
    }

    const goAir = wasAirborne || h.launch || kby < -3;
    def.facing = -kbDir;
    if (goAir) {
      def.setState('juggle');
      def.grounded = false;
      def.juggleHits++;
      if (wasAirborne && !h.launch && kby > -5 && !(h.kd && kby > 0)) kby = -5.5 + Math.min(3, def.juggleHits * 0.25);
      if (h.launch) kby *= Math.max(0.55, 1 - def.juggleHits * 0.06);
      def.vy = kby;
      def.vx = kbx;
      def.stun = stun;
      def.kdOnLand = def.kdOnLand || !!h.kd;
      if (h.wb && def.wbOk) {
        def.wbPending = true;
        def.wbOk = false;
      }
      if (h.gb && def.gbOk) {
        def.gbPending = true;
        def.gbOk = false;
      }
      def.spinDir = chance(0.5) ? 1 : -1;
      if (def.y >= -1) def.y = -2;
    } else {
      def.setState('hitstun');
      def.stun = stun;
      def.vx = kbx;
      def.hurtPose = chance(0.5) ? 'hurtHigh' : 'hurtMid';
      if (!proj && Math.abs(def.x) > ARENA_HALF - 45) att.vx = -kbDir * Math.abs(kbx) * 0.7;
      if (h.kd) {
        def.kdOnLand = true;
      }
    }
    this.emit('hit', att, def, h, dmg, tag);
    return 'hit';
  }

  guardBreak(def, att) {
    def.stamina = 0;
    def.tired = true;
    def.setState('dizzy');
    def.stun = 75;
    def.vx = -def.facing * 4;
    this.fx.text(def.x, def.y - 210 * def.scale, 'GUARD BREAK!', { color: '#ff5c5c', size: 36 });
    this.fx.shards(def.x + def.facing * 20, def.y - 110 * def.scale, 14, '#9fd8ff', 1);
    this.sfx('guardBreak', { pan: def.pan() });
    this.shake(0.35);
    this.flashScreen('#ffd0d0', 0.25);
    this.emit('guardBreak', def, att);
  }

  koFighter(def, att, vx, vy, h) {
    def.hp = 0;
    def.state = 'ko';
    def.stateT = 0;
    def.ragdoll = new Ragdoll(def.J, vx, vy, (att ? att.facing : 1) * (h && h.dmg > 60 ? 5 : 2.5));
    let bumps = 0;
    def.ragdoll.onImpact = (x, v) => {
      if (bumps++ > 3) return;
      this.fx.dust(x, 0, 10, 0, undefined, 1.3);
      this.sfx('knockdown', { vol: clamp(v / 14, 0.4, 1) });
      this.shake(clamp(v / 50, 0.1, 0.4));
      this.arenaImpact(x, 0, clamp(v / 20, 0.3, 1));
    };
    this.emit('ko', def, att, h);
  }

  breaker(f) {
    if (!this.infiniteMeter[f.side]) f.meter -= 50;
    f.stats.breakers++;
    f.setState('burst');
    f.invuln = 28;
    f.vx = 0;
    f.vy = f.grounded ? 0 : -3;
    f.comboHits = 0;
    f.comboDmg = 0;
    f.juggleHits = 0;
    f.kdOnLand = false;
    const a = f.opp;
    const cy = f.y - 90 * f.scale;
    if (a && Math.abs(a.x - f.x) < 300 && Math.abs(a.y - f.y) < 300 && a.state !== 'ko') {
      const dir = sign(a.x - f.x || a.facing * -1);
      a.setState('juggle');
      a.grounded = false;
      a.vx = dir * 11;
      a.vy = -7.5;
      a.stun = 22;
      a.kdOnLand = false;
      if (a.y >= -1) a.y = -2;
      a.facing = -dir;
      a.hitstop = 8;
    }
    f.hitstop = 8;
    this.fx.burst(f.x, cy, f.skin.accent, 30, 16);
    this.fx.ring(f.x, cy, 20, 260, '#ffffff', 22, 10);
    this.fx.text(f.x, f.y - 230 * f.scale, 'BREAKER!', { color: f.skin.accent, size: 40 });
    this.sfx('breaker', { pan: f.pan() });
    this.flashScreen('#ffffff', 0.35);
    this.shake(0.35);
    this.emit('breaker', f);
  }

  onWallBounce(f, side) {
    this.fx.dust(f.x, f.y - 60, 8, -side, 'rgba(220,220,220,0.5)', 1.2);
    this.fx.ring(f.x, f.y - 80 * f.scale, 10, 90, '#ffffff', 14, 6, 0.4);
    this.fx.text(f.x - side * 40, f.y - 200 * f.scale, 'WALL SPLAT!', { color: '#ffb347', size: 28 });
    this.sfx('wallBounce', { pan: f.pan() });
    this.shake(0.3);
    this.cam.kick(side * 8, 0);
    f.hitstop = 6;
    this.arenaImpact(f.x, f.y, 0.7);
    this.emit('wallSplat', f);
  }

  onGroundBounce(f) {
    this.fx.dust(f.x, 0, 12, 0, undefined, 1.3);
    this.fx.ring(f.x, 0, 10, 110, '#ffffff', 14, 6, 4);
    this.sfx('groundBounce', { pan: f.pan() });
    this.shake(0.28);
    f.hitstop = 5;
    this.arenaImpact(f.x, 0, 0.6);
  }

  onTired(f) {
    if (this.time - this.tiredTextAt[f.side] < 45) return;
    this.tiredTextAt[f.side] = this.time;
    this.fx.text(f.x, f.y - 200 * f.scale, 'TIRED', { color: '#9aa3ad', size: 22, life: 35 });
    this.sfx('uiError', { vol: 0.4, pan: f.pan() });
  }

  clashProjectiles() {
    const P = this.ents.filter((e) => e instanceof Projectile && !e.dead);
    for (let i = 0; i < P.length; i++) {
      for (let j = i + 1; j < P.length; j++) {
        const a = P[i], b = P[j];
        if (a.owner === b.owner || a.dead || b.dead) continue;
        if (Math.hypot(a.x - b.x, a.y - b.y) < (a.r + b.r) * 0.9) {
          const pa = a.power, pb = b.power;
          if (pa <= pb) a.die();
          if (pb <= pa) b.die();
          this.fx.burst((a.x + b.x) / 2, (a.y + b.y) / 2, '#ffffff', 16, 10);
          this.sfx('explosion', { vol: 0.4 });
        }
      }
    }
  }

  // ---------------------------------------------------------------- move events
  moveEvent(f, type, p) {
    const J = f.J;
    const opp = f.opp;
    switch (type) {
      case 'proj': {
        const n = p.count || 1;
        for (let i = 0; i < n; i++) {
          const spread = n > 1 ? (i / (n - 1) - 0.5) * (p.spread || 0.4) : 0;
          const ang = (p.ang || 0) + spread;
          const from = p.from || 'handF';
          const x = (J[from + 'X'] ?? f.x) + f.facing * (p.ox || 0);
          const y = (p.y != null ? f.y - p.y * f.scale : J[from + 'Y'] ?? f.y - 100) + (p.oy || 0);
          const spd = p.spd || 10;
          this.ents.push(new Projectile(this, f, {
            x, y, vx: f.facing * Math.cos(ang) * spd, vy: Math.sin(ang) * spd + (p.vy || 0),
            r: p.r || 16, life: p.life || 100, grav: p.grav || 0, kind: p.kind || 'orb',
            color: p.color || f.skin.accent, hit: p.hit, pierce: p.pierce || 0, homing: p.homing || 0,
            spin: p.spin || 0, explode: p.explode, power: p.power || 1, scale: p.scale || 1, accel: p.accel,
            vortex: p.vortex, tether: p.tether,
          }));
        }
        if (p.sfx !== null) this.sfx(p.sfx || 'energy', { pan: f.pan() });
        break;
      }
      case 'wave':
        this.ents.push(new GroundWave(this, f, { x: f.x + f.facing * (p.ox || 40), dir: f.facing, ...p }));
        if (p.sfx !== null) this.sfx(p.sfx || 'ground', { pan: f.pan() });
        this.shake(0.15);
        break;
      case 'strike': {
        const n = p.count || 1;
        for (let i = 0; i < n; i++) {
          let x;
          if (p.at === 'opp' && opp) x = opp.x + (p.lead ? opp.vx * p.lead : 0);
          else x = f.x + f.facing * ((p.dist || 220) + i * (p.step || 0));
          x = clamp(x + (p.at === 'opp' ? i * (p.step || 0) * f.facing : 0), -ARENA_HALF + 30, ARENA_HALF - 30);
          this.ents.push(new Strike(this, f, { ...p, x, delay: (p.delay || 30) + i * (p.stagger || 0), from: f.facing }));
        }
        break;
      }
      case 'aura':
        this.ents.push(new Aura(this, f, { bindMove: true, ...p }));
        if (p.sfx) this.sfx(p.sfx, { pan: f.pan() });
        break;
      case 'mine':
        this.ents.push(new Mine(this, f, { x: f.x + f.facing * (p.ox || 40), ...p }));
        this.sfx('metal', { pan: f.pan(), vol: 0.5 });
        break;
      case 'wall':
        this.ents.push(new Wall(this, f, { x: clamp(f.x + f.facing * (p.dist || 100), -ARENA_HALF + 30, ARENA_HALF - 30), ...p }));
        this.sfx('ice', { pan: f.pan() });
        this.shake(0.12);
        break;
      case 'beam':
        this.ents.push(new Beam(this, f, { bindMove: true, ...p }));
        this.sfx('beam', { pan: f.pan() });
        break;
      case 'tp': {
        if (!opp) break;
        this.fx.ghost(f.J, f.lookFor(), 16, 0.5, f.skin.accent);
        this.fx.burst(f.x, f.y - 90 * f.scale, f.skin.accent, 12, 8);
        let nx = f.x, ny = f.y;
        if (p.to === 'behind') nx = opp.x - opp.facing * (p.dist || 80);
        else if (p.to === 'front') nx = opp.x + opp.facing * (p.dist || 90);
        else if (p.to === 'above') {
          nx = opp.x - opp.facing * 20;
          ny = Math.min(-200, opp.y - 220);
        } else if (p.to === 'forward') nx = f.x + f.facing * (p.dist || 300);
        else if (p.to === 'back') nx = f.x - f.facing * (p.dist || 260);
        nx = clamp(nx, -ARENA_HALF + 30, ARENA_HALF - 30);
        f.x = nx;
        if (ny < 0) {
          f.y = ny;
          f.grounded = false;
          f.vy = 0;
        }
        f.faceOpponent();
        f.trail.clear();
        this.fx.burst(f.x, f.y - 90 * f.scale, f.skin.accent, 12, 8);
        this.sfx(p.sfx || 'teleport', { pan: f.pan() });
        break;
      }
      case 'invuln':
        f.invuln = Math.max(f.invuln, p.n);
        break;
      case 'armor':
        f.armor = Math.max(f.armor, p.n);
        break;
      case 'counter':
        f.counterWin = p.n;
        f.counterMove = p.move;
        break;
      case 'heal':
        f.status.regen = p.frames;
        f.healRate = p.amt / p.frames;
        this.sfx('heal', { pan: f.pan() });
        break;
      case 'buff':
        f.status[p.kind] = p.frames;
        this.fx.burst(f.x, f.y - 90 * f.scale, p.color || f.skin.accent, 14, 9);
        if (p.sfx) this.sfx(p.sfx, { pan: f.pan() });
        break;
      case 'sfx':
        this.sfx(p.name, { pan: f.pan(), vol: p.vol, pitch: p.pitch });
        break;
      case 'fx':
        if (p.ring) this.fx.ring(f.x + f.facing * (p.ox || 0), f.y - (p.oy ?? 90) * f.scale, 10, p.ring, p.color || f.skin.accent, 16, 6, p.squash || 1);
        if (p.burst) this.fx.burst(f.x + f.facing * (p.ox || 0), f.y - (p.oy ?? 90) * f.scale, p.color || f.skin.accent, p.burst, 10);
        if (p.dust) this.fx.dust(f.x, 0, p.dust, 0, undefined, 1.2);
        if (p.shake) this.shake(p.shake);
        if (p.flash) this.flashScreen(p.flash, p.alpha ?? 0.25);
        if (p.ghost) this.fx.ghost(f.J, f.lookFor(), 14, 0.45, f.skin.accent);
        if (p.explode) this.fx.explosion(f.x + f.facing * (p.ox || 0), f.y - (p.oy ?? 40), p.color || '#ff8a2a', p.explode);
        if (p.impact) this.arenaImpact(f.x + f.facing * (p.ox || 0), 0, p.impact);
        break;
      case 'grab':
        this.tryGrab(f, p);
        break;
      case 'areaHit': {
        // immediate radial hit around the fighter (landing slams)
        if (opp && opp.hittable && Math.abs(opp.x - f.x) < (p.r || 140) * f.scale && opp.y > -(p.h || 90)) {
          if (!(opp.state === 'knockdown' && !p.hit.otg)) this.applyHit(f, opp, p.hit, opp.x, opp.y - 60 * opp.scale, null);
        }
        break;
      }
      case 'noPush':
        f.noPush = p.n;
        break;
      case 'hide':
        f.visible = false;
        f.invuln = Math.max(f.invuln, p.n || 10);
        break;
      case 'show':
        f.visible = true;
        break;
      case 'face':
        f.faceOpponent();
        break;
      case 'vel':
        f.vx = (p.vx ?? 0) * f.facing;
        if (p.vy != null) {
          f.vy = p.vy;
          if (p.vy < 0) f.grounded = false;
        }
        break;
      case 'seek':
        // aim velocity at the opponent's current x
        if (opp) {
          const dx = opp.x - f.x - Math.sign(opp.x - f.x) * (p.short ?? 30);
          f.facing = dx >= 0 ? 1 : -1;
          f.vx = clamp(dx / (p.frames || 30), -(p.max || 12), p.max || 12);
          if (p.vy != null) {
            f.vy = p.vy;
            f.grounded = false;
          }
        }
        break;
    }
  }

  tryGrab(f, p) {
    const o = f.opp;
    if (!o) return;
    const range = (p.range || 78) * f.scale;
    const ok =
      o.hittable && o.grounded && Math.abs(o.x - f.x) < range + 20 * o.scale && Math.abs(o.y - f.y) < 40 &&
      !['hitstun', 'blockstun', 'juggle', 'knockdown', 'getup', 'dizzy_', 'frozen'].includes(o.state) &&
      sign(o.x - f.x) === f.facing;
    if (!ok) return;
    const back = f.ctrl.dir() * f.facing < 0;
    f.stats.throws++;
    this.startCinematic(f, o, back ? THROW_BACK : THROW_FWD, { throw: true });
  }

  // ---------------------------------------------------------------- ultimates
  superFlash(f, ult) {
    this.freeze = 42;
    this.freezeOwner = f;
    this.dimTarget = 0.85;
    this.banner = { name: ult.name, side: f.side, t: 0, color: f.skin.accent, fighter: f.def.name };
    this.cam.override = { x: f.x + f.facing * 40, y: Math.min(0, f.y) - 40, zoom: 1.55, k: 0.2 };
    this.sfx('ultimateStart', { pan: f.pan() });
    this.flashScreen(f.skin.accent, 0.35);
    this.fx.ring(f.x, f.y - 90 * f.scale, 10, 220, f.skin.accent, 26, 8);
    this.emit('ultimate', f);
  }

  startCinematic(att, def, script, opts = {}) {
    for (const e of this.ents) if (e.owner === att && e.bindMove) e.dead = true;
    this.cine = new Cine(this, att, def, script, opts);
    att.state = 'cine';
    att.stateT = 0;
    att.vx = att.vy = 0;
    def.setState(opts.throw ? 'grabbed' : 'ultlocked');
    def.vx = def.vy = 0;
    def.lockPose = 'hurtHigh';
    def.lockRot = 0;
    def.grabRot = 0;
    if (!opts.throw) {
      this.dimTarget = 0.6;
      this.cam.override = { x: (att.x + def.x) / 2, y: Math.min(0, def.y) - 30, zoom: 1.35, k: 0.12 };
    }
  }

  tickCinematic() {
    const c = this.cine;
    c.t++;
    try {
      c.script(c, c.t);
    } catch (e) {
      console.error('cinematic error', e);
      c.endNow = true;
    }
    for (const f of [c.att, c.def]) {
      if (f.state === 'ko') continue;
      f.stateT++;
      if (f.flash > 0) f.flash--;
      if (f.hitstop > 0) f.hitstop--;
    }
    if (c.endNow || c.t > 600 || (c.finished && c.t >= c.endAt)) {
      this.endCinematic();
    }
  }

  endCinematic() {
    const c = this.cine;
    if (!c) return;
    this.cine = null;
    const { att, def } = c;
    att.visible = true;
    att.alpha = 1;
    if (att.state === 'cine') {
      att.grounded = att.y >= 0;
      if (att.y > 0) att.y = 0;
      att.setState(att.grounded ? 'idle' : 'air');
      att.invuln = Math.max(att.invuln, 6);
    }
    if (def.state === 'ultlocked' || def.state === 'grabbed') {
      // released without a final hit (escape / failsafe)
      def.setState(def.y < 0 ? 'juggle' : 'idle');
      def.grounded = def.y >= 0;
      def.stun = 10;
    }
    this.dimTarget = 0;
    this.cam.override = null;
  }

  // ---------------------------------------------------------------- render
  draw(ctx, view) {
    const cam = this.cam;
    // background (shake applied around arena draw)
    ctx.save();
    ctx.translate(cam.sx + cam.kx, cam.sy + cam.ky);
    try {
      drawArenaBack(ctx, this.arena, cam.view(), view);
    } catch (e) {
      ctx.fillStyle = '#223';
      ctx.fillRect(-50, -50, view.w + 100, view.h + 100);
    }
    ctx.restore();

    if (this.dim > 0.01) {
      ctx.fillStyle = `rgba(4,2,12,${this.dim * 0.75})`;
      ctx.fillRect(0, 0, view.w, view.h);
    }

    ctx.save();
    cam.apply(ctx, view);

    // shadows
    for (const f of this.fighters) {
      if (!f.visible && f.state !== 'ko') continue;
      const x = f.ragdoll ? f.ragdoll.cx : f.x;
      const h = f.ragdoll ? -f.ragdoll.cy : -f.y;
      const k = clamp(1 - h / 500, 0.25, 1);
      ctx.fillStyle = this.arena?.def?.shadow || 'rgba(0,0,0,0.35)';
      ctx.globalAlpha = k;
      ctx.beginPath();
      ctx.ellipse(x, 2, 46 * f.scale * k, 9 * k, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    for (const e of this.ents) if (e.layer === 0) e.draw(ctx);
    this.fx.drawBack(ctx);
    this.fx.drawGhosts(ctx);

    // draw order: attacker on top
    const order = this.fighters.slice().sort((p, q) => this.drawPriority(p) - this.drawPriority(q));
    for (const f of order) this.drawFighter(ctx, f);

    for (const f of this.fighters) if (f.trail.pts.length > 1) f.trail.draw(ctx, f.def.trailColor || f.skin.accent, 0.75);
    for (const e of this.ents) if (e.layer !== 0) e.draw(ctx);
    this.fx.drawFront(ctx);
    if (this.showHitboxes) this.drawHitboxes(ctx);
    if (!this.muted) this.fx.drawTexts(ctx);
    ctx.restore();

    ctx.save();
    ctx.translate(cam.sx, cam.sy);
    try {
      drawArenaFront(ctx, this.arena, cam.view(), view);
    } catch (e) {
      /* optional */
    }
    ctx.restore();

    if (this.flash) {
      ctx.fillStyle = this.flash.color;
      ctx.globalAlpha = this.flash.a;
      ctx.fillRect(0, 0, view.w, view.h);
      ctx.globalAlpha = 1;
    }
  }

  drawPriority(f) {
    if (this.cine && f === this.cine.att) return 3;
    if (f.state === 'attack') return 2;
    if (f.state === 'ko') return 0;
    return 1;
  }

  drawFighter(ctx, f) {
    const look = f.lookFor();
    look.drawBehind = f.acc.drawBehind.bind(f.acc);
    look.drawFront = f.acc.drawFront.bind(f.acc);
    if (f.state === 'ko' && f.ragdoll) {
      drawStickman(ctx, f.ragdoll.J, look);
      return;
    }
    if (!f.visible || f.J.hipX == null) return;
    if (f.invuln > 0 && (f.state === 'getup' || f.state === 'burst') && this.time % 4 < 2) look.alpha = 0.6;
    if (f.alpha < 1) look.alpha = f.alpha;
    if (f.meter >= 100 && f.state !== 'cine') {
      look.glow = { color: f.skin.accent, a: 0.18 + 0.12 * Math.sin(this.time * 0.15) };
    }
    if (f.state === 'burst') look.glow = { color: '#ffffff', a: 0.5 };
    if (f.status.power > 0) look.glow = { color: '#ff4d4d', a: 0.25 };
    if (f.status.slow > 0) look.glow = { color: '#8fe8ff', a: 0.25 };
    if (f.status.poison > 0) look.glow = { color: '#9dff5c', a: 0.2 };
    drawStickman(ctx, f.J, look);
    if (f.state === 'frozen') {
      // ice block
      const J = f.J;
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = '#bff4ff';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      const x0 = f.x - 52 * f.scale, y0 = f.y - 190 * f.scale;
      ctx.beginPath();
      ctx.moveTo(x0, f.y);
      ctx.lineTo(x0 + 6, y0 + 20);
      ctx.lineTo(x0 + 40, y0);
      ctx.lineTo(x0 + 104 * f.scale, y0 + 14);
      ctx.lineTo(x0 + 98 * f.scale, f.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      void J;
    }
    if (f.state === 'dizzy') {
      // orbiting stars
      for (let i = 0; i < 3; i++) {
        const a = this.time * 0.12 + (i * Math.PI * 2) / 3;
        const x = f.J.headX + Math.cos(a) * 24, y = f.J.headY - 24 + Math.sin(a) * 7;
        ctx.fillStyle = '#ffe066';
        ctx.font = '18px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('★', x, y);
      }
    }
  }

  drawHitboxes(ctx) {
    ctx.save();
    ctx.lineWidth = 2;
    for (const f of this.fighters) {
      ctx.strokeStyle = 'rgba(80,200,255,0.8)';
      for (const c of f.hurt) drawCapsule(ctx, c);
      if (f.state === 'attack' && f.move.hits) {
        for (const h of f.move.hits) {
          if (f.moveF < h.f[0] || f.moveF > h.f[1]) continue;
          const c = this.hitCapsule(f, h, f.J);
          if (!c) continue;
          ctx.strokeStyle = 'rgba(255,60,60,0.95)';
          drawCapsule(ctx, c);
        }
      }
    }
    ctx.restore();
  }
}

function drawCapsule(ctx, c) {
  const a = Math.atan2(c.by - c.ay, c.bx - c.ax);
  ctx.beginPath();
  ctx.arc(c.ax, c.ay, c.r, a + Math.PI / 2, a - Math.PI / 2);
  ctx.arc(c.bx, c.by, c.r, a - Math.PI / 2, a + Math.PI / 2);
  ctx.closePath();
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Cinematic helper (ultimates, throws). Scripts call these each frame.
// ---------------------------------------------------------------------------
export class Cine {
  constructor(world, att, def, script, opts) {
    this.world = world;
    this.att = att;
    this.def = def;
    this.script = script;
    this.opts = opts;
    this.t = 0;
    this.finished = false;
    this.endAt = 0;
    this.side = att.facing;
    this.tmp = makePose();
    this.fx = world.fx;
    this.dmgDone = 0;
    att.cinePose = makePose();
    copyPose(att.pose, att.cinePose);
  }
  sfx(name, opts = {}) {
    this.world.sfx(name, { pan: this.att.pan(), ...opts });
  }
  // attacker pose: name or keyframe list + local frame
  pose(p, f, blend = 1) {
    let target;
    if (Array.isArray(p)) target = sampleKeys(p, f, this.tmp);
    else target = POSES[p] || p;
    if (blend >= 1) copyPose(target, this.att.cinePose);
    else lerpPose(this.att.cinePose, target, blend, this.att.cinePose);
    this.att.pose = this.att.pose || makePose();
    copyPose(this.att.cinePose, this.att.pose);
  }
  rot(r) {
    this.att.cinePose.rot = r;
  }
  defPose(name, rot = 0) {
    this.def.lockPose = name;
    this.def.lockRot = rot;
    this.def.grabRot = rot;
  }
  // put attacker dx in front of the defender (relative to the attacker's facing)
  place(dx, dy = 0) {
    this.att.x = clamp(this.def.x - this.att.facing * dx, -ARENA_HALF + 20, ARENA_HALF - 20);
    this.att.y = Math.min(0, this.def.y + dy);
  }
  placeDef(x, y) {
    this.def.x = clamp(x, -ARENA_HALF + 20, ARENA_HALF - 20);
    this.def.y = Math.min(0, y);
  }
  defRel(dx, dy) {
    this.placeDef(this.att.x + this.att.facing * dx, this.att.y + dy);
  }
  face() {
    this.att.facing = this.def.x >= this.att.x ? 1 : -1;
  }
  flip() {
    this.att.facing *= -1;
  }
  ghost(a = 0.5) {
    this.fx.ghost(this.att.J, this.att.lookFor(), 16, a, this.att.skin.accent);
  }
  hide(v = true) {
    this.att.visible = !v;
  }
  dark(a) {
    this.world.dimTarget = a;
  }
  zoom(z, x, y, k = 0.15) {
    this.world.cam.override = {
      x: x ?? (this.att.x + this.def.x) / 2,
      y: y ?? Math.min(0, Math.min(this.att.y, this.def.y)) - 40,
      zoom: z,
      k,
    };
  }
  flash(color = '#ffffff', a = 0.5) {
    this.world.flashScreen(color, a);
  }
  shake(a) {
    this.world.shake(a);
  }
  center() {
    return [this.def.x, this.def.y - 90 * this.def.scale];
  }
  hit(o = {}) {
    const { def, att, world } = this;
    if (def.state === 'ko') return;
    let dmg = Math.round((o.dmg || 10) * att.def.stats.power * world.dmgMult * world.dmgTaken[def.side] / (def.def.stats.defense || 1));
    def.hp = Math.max(1, def.hp - dmg);
    this.dmgDone += dmg;
    def.comboHits++;
    def.comboDmg += dmg;
    att.stats.dealt += dmg;
    att.stats.hits++;
    def.stats.taken += dmg;
    att.stats.maxCombo = Math.max(att.stats.maxCombo, def.comboHits);
    def.flash = 3;
    def.lockShake = true;
    def.stateT = 0;
    const [cx, cy] = this.center();
    const x = cx + (o.ox || rand(-20, 20)), y = cy + (o.oy || rand(-40, 30));
    const col = SPARK_COLORS[o.elem] || o.color || att.skin.accent;
    this.fx.hitSpark(x, y, att.facing, o.spark || 'medium', col);
    if (o.elem === 'fire') this.fx.explosion(x, y, '#ff7b2a', 0.3);
    if (o.elem === 'shock') this.fx.bolt(x - 40, y - 40, x + 40, y + 40, '#fff36b', 8, 3, 5, 12);
    if (o.elem === 'ice') this.fx.shards(x, y, 4, '#bff4ff', 0.6);
    this.world.sfx(o.sfx || 'hitMedium', { pan: def.pan(), vol: o.vol ?? 0.9 });
    this.world.shake(o.shake ?? 0.08);
    if (this.world.settings.damageNumbers !== false) this.fx.text(x, y - 20, String(dmg), { size: 20, color: '#fff', life: 30 });
    if (o.stop) def.hitstop = att.hitstop = o.stop;
  }
  final(o = {}) {
    if (this.finished) return;
    const { def, att, world } = this;
    this.finished = true;
    this.endAt = this.t + (o.linger ?? 24);
    let dmg = Math.round((o.dmg || 50) * att.def.stats.power * world.dmgMult * world.dmgTaken[def.side] / (def.def.stats.defense || 1));
    def.hp -= dmg;
    def.comboHits++;
    def.comboDmg += dmg;
    att.stats.dealt += dmg;
    def.stats.taken += dmg;
    att.stats.maxCombo = Math.max(att.stats.maxCombo, def.comboHits);
    att.addMeter(this.opts.throw ? 6 : 0);
    def.addMeter(this.opts.throw ? 8 : 10);
    const [cx, cy] = this.center();
    this.fx.hitSpark(cx, cy, att.facing, 'heavy', SPARK_COLORS[o.elem] || att.skin.accent);
    this.fx.hitSpark(cx, cy, att.facing, 'ult', '#ffffff');
    world.sfx(o.sfx || 'ultimateHit', { pan: def.pan() });
    world.shake(o.shake ?? 0.6);
    if (o.flash !== false) world.flashScreen(o.flashColor || '#ffffff', 0.5);
    if (world.settings.damageNumbers !== false) this.fx.text(cx, cy - 40, String(dmg), { size: 46, color: '#ffb347', life: 50 });
    const kbDir = o.dir ?? att.facing;
    const kb = o.kb || [12, -12];
    def.hitstop = att.hitstop = o.stop ?? 14;
    world.dimTarget = 0;
    if (def.hp <= 0) {
      world.koFighter(def, att, kb[0] * kbDir * 1.2, kb[1] - 4, { dmg: 100 });
      this.endAt = this.t + 2;
      return;
    }
    def.setState('juggle');
    def.grounded = false;
    def.vx = kb[0] * kbDir;
    def.vy = kb[1];
    def.stun = 30;
    def.kdOnLand = o.kd !== false;
    def.facing = -kbDir;
    def.wbPending = !!o.wb;
    if (def.y >= -1) def.y = -2;
    world.cam.override = null;
    world.emit('ultHit', att, def, this.dmgDone + dmg);
  }
  release() {
    this.finished = true;
    this.endAt = this.t;
  }
}

// ---------------------------------------------------------------------------
// Throws
// ---------------------------------------------------------------------------
function throwTech(c) {
  const d = c.def;
  if (c.t <= 8 && d.ctrl.combo2(6, 10)) {
    d.ctrl.consume('atk');
    d.ctrl.consume('spc');
    const W = c.world;
    W.fx.ring((c.att.x + d.x) / 2, d.y - 90, 10, 90, '#ffffff', 14, 5);
    W.fx.text(d.x, d.y - 210, 'ESCAPE!', { color: '#7ff3ff', size: 30 });
    W.sfx('block');
    c.att.vx = -c.att.facing * 8;
    d.setState('idle');
    d.vx = c.att.facing * 8;
    d.invuln = 6;
    c.release();
    return true;
  }
  return false;
}

const THROW_FWD_KEYS = [[0, 'grabReach'], [6, 'grabHold'], [16, 'grabHold'], [22, 'throwFwd', 'snap'], [40, 'throwFwd']];
export function THROW_FWD(c, t) {
  if (t === 1) c.sfx('throw', { vol: 0.6 });
  if (throwTech(c)) return;
  c.pose(THROW_FWD_KEYS, t);
  if (t < 22) {
    c.defPose('grabbed', 0);
    const lift = Math.min(1, t / 10);
    c.defRel(46 * c.att.scale, -26 * lift);
  } else if (t === 22) {
    c.final({ dmg: 82, kb: [10, -9], sfx: 'hitHeavy', shake: 0.35, flash: false, stop: 8, linger: 12 });
  }
}
const THROW_BACK_KEYS = [[0, 'grabReach'], [6, 'grabHold'], [12, 'grabHold'], [20, 'throwToss', 'snap'], [40, 'throwToss']];
export function THROW_BACK(c, t) {
  if (t === 1) c.sfx('throw', { vol: 0.6 });
  if (throwTech(c)) return;
  c.pose(THROW_BACK_KEYS, t);
  if (t < 12) {
    c.defPose('grabbed', 0);
    c.defRel(46 * c.att.scale, -20 * Math.min(1, t / 8));
  } else if (t < 22) {
    // swing over the head
    const k = (t - 12) / 10;
    const a = Math.PI * k;
    c.defPose('tumble', -200 * k);
    c.defRel(Math.cos(a) * 60 * c.att.scale, -20 - Math.sin(a) * 130 * c.att.scale);
  } else if (t === 22) {
    c.final({ dmg: 88, kb: [9, -6], dir: -c.att.facing, sfx: 'hitHeavy', shake: 0.4, flash: false, stop: 8, linger: 12 });
    c.world.fx.dust(c.def.x, 0, 12, 0, undefined, 1.4);
  }
}
