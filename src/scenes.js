// All screens: title, menus, character/stage select, fights, towers,
// survival, training, locker, profile, settings, controls, how-to-play.

import { Match } from './match.js';
import { menu, sideMenus, pointer, DEFAULT_BINDINGS, keyLabel, lastKey, wasAnyKeyPressed, ACTIONS, keyPressedThisFrame } from './input.js';
import { audio } from './audio.js';
import { ARENAS, drawArenaPreview } from './arenas.js';
import { FIGHTER_DEFS, getFighter, STARTERS } from './roster.js';
import { HATS } from './accessories.js';
import { TOWERS, MODS, buildMods, ACHIEVEMENTS, QUICK_DIFFICULTIES, MOVE_LIST_COMMON } from './modes.js';
import { Progress } from './progress.js';
import { FighterPreview } from './preview.js';
import { drawPortrait } from './hud.js';
import { resetSave, ownsSkin, equipped, persist } from './save.js';
import { AI_LEVELS } from './ai.js';
import {
  C, text, FONT_UI, FONT_BIG, FONT_BODY, sfx, panel, roundRect, skewPanel, title, hints, coins, coinIcon, bar,
  lockIcon, ListMenu, Toasts, backdrop, vignette, wrapText, inRect, clamp, lerp, ease, rgba, shade,
} from './ui.js';
import { pick, shuffle, formatNum, readable } from './util.js';

const PLAYABLE_ARENAS = ARENAS.filter((a) => a.id !== 'lab');
const arenaName = (id) => (ARENAS.find((a) => a.id === id) || { name: id }).name;
const SPECIAL_INPUTS = { S1: 'SPC', S2: 'BACK + SPC', S3: 'DOWN + SPC', SA: 'SPC (air)' };

export function createScenes(game) {
  game.toasts = new Toasts();
  game.progress = new Progress(game);
  const P = game.progress;
  const S = () => game.save;
  const settings = () => game.save.settings;

  // -------------------------------------------------------------------------
  // Live demo fight behind the menus
  // -------------------------------------------------------------------------
  class DemoBG {
    constructor() {
      this.newMatch();
    }
    newMatch() {
      const ids = shuffle(FIGHTER_DEFS.map((d) => d.id));
      this.m = new Match({
        mode: 'demo',
        p1: { id: ids[0], ctrl: 'cpu', level: 3 },
        p2: { id: ids[1], ctrl: 'cpu', level: 3 },
        arena: pick(PLAYABLE_ARENAS).id,
        rounds: 1,
        time: 0,
        intro: false,
        settings: { ...settings(), damageNumbers: false },
        onEnd: () => {
          this.pending = true;
        },
      });
    }
    update(view) {
      if (this.pending) {
        this.pending = false;
        this.newMatch();
      }
      this.m.update(view);
    }
    draw(ctx, view, dim = 0.55) {
      this.m.draw(ctx, view);
      ctx.fillStyle = `rgba(6,5,14,${dim})`;
      ctx.fillRect(0, 0, view.w, view.h);
      vignette(ctx, view, 0.7);
    }
  }
  let demo = null;
  const getDemo = () => (demo ||= new DemoBG());

  class Scene {
    controllers() {
      return [];
    }
    enter() {}
    exit() {}
  }

  // A menu scene with the demo fight in the background
  class MenuScene extends Scene {
    constructor() {
      super();
      this.t = 0;
      this.dim = 0.62;
      this.music = 'menu';
    }
    enter() {
      if (this.music) audio.playMusic(this.music);
    }
    update(view) {
      this.t++;
      getDemo().update(view);
    }
    drawBG(ctx, view) {
      getDemo().draw(ctx, view, this.dim);
    }
  }

  // -------------------------------------------------------------------------
  // Title
  // -------------------------------------------------------------------------
  class TitleScene extends MenuScene {
    constructor() {
      super();
      this.touchBack = false;
      this.dim = 0.35;
    }
    update(view) {
      super.update(view);
      if (this.t > 20 && (wasAnyKeyPressed() || pointer.pressed)) {
        audio.unlock();
        sfx('uiSelect');
        game.go(new MainMenu());
      }
    }
    draw(ctx, view) {
      this.drawBG(ctx, view);
      drawLogo(ctx, view.w / 2, view.h * 0.36, 1, this.t);
      const blink = 0.55 + 0.45 * Math.sin(this.t * 0.08);
      text(ctx, 'PRESS ANY BUTTON', view.w / 2, view.h * 0.72, { size: 30, font: FONT_UI, color: '#fff', stroke: '#000', sw: 5, alpha: blink });
      text(ctx, '12 fighters · 9 towers · survival · versus · training', view.w / 2, view.h * 0.79, { size: 20, font: FONT_BODY, color: C.dim });
      text(ctx, 'Keyboard · Gamepad · Touch', view.w / 2, view.h - 30, { size: 16, font: FONT_BODY, color: 'rgba(255,255,255,0.4)' });
    }
  }

  function drawLogo(ctx, x, y, s, t) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.rotate(-0.04);
    // slash behind
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const sweep = ((t * 6) % 1400) - 700;
    const g = ctx.createLinearGradient(sweep - 120, 0, sweep + 120, 0);
    g.addColorStop(0, 'rgba(255,210,63,0)');
    g.addColorStop(0.5, 'rgba(255,210,63,0.35)');
    g.addColorStop(1, 'rgba(255,210,63,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-700, -120, 1400, 230);
    ctx.restore();
    ctx.fillStyle = C.accent2;
    ctx.beginPath();
    ctx.moveTo(-420, 18);
    ctx.lineTo(430, -6);
    ctx.lineTo(420, 10);
    ctx.lineTo(-430, 34);
    ctx.closePath();
    ctx.fill();
    text(ctx, 'STICKMAN', 0, -40, { size: 136, font: FONT_BIG, color: '#ffffff', stroke: '#000', sw: 14, shadow: 'rgba(255,77,109,0.8)' });
    text(ctx, 'FIGHT 2D', 0, 70, { size: 112, font: FONT_BIG, color: C.accent, stroke: '#000', sw: 13, shadow: 'rgba(0,0,0,0.6)' });
    ctx.restore();
  }

  // -------------------------------------------------------------------------
  // Main menu
  // -------------------------------------------------------------------------
  class MainMenu extends MenuScene {
    constructor(start = 0) {
      super();
      this.touchBack = false;
      const items = [
        { label: 'TOWERS', desc: 'Climb nine towers of escalating challenges, modifiers and champions. Beat a tower to unlock its champion.', color: '#ff9a3c', action: () => game.go(new TowerSelect()) },
        { label: 'QUICK FIGHT', desc: 'Pick a fighter, an opponent, a stage and a difficulty. Straight into the action.', color: C.accent, action: () => startQuickFight() },
        { label: 'VERSUS', desc: 'Two players, one keyboard (or two gamepads). Settle it.', color: '#ff4d6d', action: () => startVersus() },
        { label: 'SURVIVAL', desc: 'Endless waves of increasingly deadly opponents. Health carries over. How far can you go?', color: '#3ddc97', action: () => startSurvival() },
        { label: 'TRAINING', desc: 'Practice combos against a configurable dummy. Hitbox view, infinite power, instant refills.', color: '#4ab8ff', action: () => startTraining() },
        { label: 'LOCKER', desc: 'Spend coins on new fighters, color skins and hats.', color: '#c58bff', action: () => game.go(new Locker()) },
        { label: 'PROFILE', desc: 'Your stats and achievements.', color: '#ffb347', action: () => game.go(new Profile()) },
        { label: 'HOW TO PLAY', desc: 'Controls, mechanics and pro tips.', color: '#7fe3ff', action: () => game.go(new HowTo()) },
        { label: 'SETTINGS', desc: 'Audio, visuals, accessibility, touch controls and key bindings.', color: '#9aa3ad', action: () => game.go(new Settings()) },
      ];
      this.menu = new ListMenu(items, { x: 70, y: 178, w: 380, h: 46, gap: 7, size: 23, start, onBack: () => game.go(new TitleScene()) });
      this.dim = 0.7;
      const eq = equipped(S(), S().lastP1);
      this.preview = new FighterPreview(S().unlocked.includes(S().lastP1) ? S().lastP1 : 'kai', { skin: eq.skin, hat: eq.hat, facing: -1 });
    }
    update(view) {
      super.update(view);
      this.menu.update();
      this.preview.update();
      if (!S().tutorialSeen && this.t === 40) {
        game.toasts.push('NEW HERE?', 'Check HOW TO PLAY for controls & tips', '#7fe3ff', '?');
        S().tutorialSeen = true;
        game.persist();
      }
    }
    draw(ctx, view) {
      this.drawBG(ctx, view);
      drawLogo(ctx, 250, 96, 0.5, this.t);
      this.menu.draw(ctx);
      coins(ctx, view, S().coins);
      // featured fighter + description
      const cx = view.w * 0.74;
      ctx.save();
      const g = ctx.createRadialGradient(cx, view.h * 0.58, 20, cx, view.h * 0.58, 300);
      g.addColorStop(0, rgba(this.preview.f.skin.accent, 0.25));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - 320, view.h * 0.2, 640, 500);
      ctx.restore();
      this.preview.draw(ctx, cx, view.h * 0.72, 1.55);
      const it = this.menu.current();
      panel(ctx, view.w * 0.52, view.h - 140, view.w * 0.45, 90, { stroke: it.color });
      text(ctx, it.label, view.w * 0.52 + 24, view.h - 112, { size: 22, align: 'left', color: it.color, font: FONT_UI });
      wrapText(ctx, it.desc, view.w * 0.52 + 24, view.h - 92, view.w * 0.45 - 48, 22, { size: 18, color: '#fff' });
      const towersDone = TOWERS.filter((tw) => P.towerState(tw.id).done).length;
      text(ctx, `ROSTER ${S().unlocked.length}/${FIGHTER_DEFS.length}   ·   TOWERS ${towersDone}/${TOWERS.length}   ·   ACHIEVEMENTS ${Object.keys(S().ach).length}/${ACHIEVEMENTS.length}`, 70, view.h - 34, { size: 16, align: 'left', color: C.dim, font: FONT_UI });
    }
  }

  // -------------------------------------------------------------------------
  // Character select
  // steps: [{ who: 'p1'|'p2'|'cpu', label, allowLocked, input: 'all'|0|1 }]
  // simultaneous: all steps active at once (versus)
  // -------------------------------------------------------------------------
  class CharSelect extends MenuScene {
    constructor({ steps, simultaneous = false, titleStr = 'SELECT YOUR FIGHTER', onDone, onBack, music = 'menu' }) {
      super();
      this.music = music;
      this.dim = 0.8;
      this.steps = steps;
      this.simul = simultaneous;
      this.onDone = onDone;
      this.onBack = onBack;
      this.titleStr = titleStr;
      this.ids = FIGHTER_DEFS.map((d) => d.id);
      this.cols = 6;
      const startIds = [S().lastP1, S().lastP2];
      this.cursors = steps.map((st, k) => {
        let i = Math.max(0, this.ids.indexOf(startIds[k] || 'kai'));
        if (!st.allowLocked && !P.isUnlocked(this.ids[i])) i = 0;
        return { step: st, i, phase: simultaneous || k === 0 ? 'pick' : 'wait', skin: 0, hat: 'none', preview: null, pid: null, anim: 0 };
      });
      this.active = 0;
      for (const c of this.cursors) this.syncPreview(c);
    }
    canPick(c, id) {
      return c.step.allowLocked || P.isUnlocked(id);
    }
    syncPreview(c) {
      const id = this.ids[c.i];
      if (c.pid !== id) {
        const eq = equipped(S(), id);
        c.skin = c.step.who === 'cpu' ? 0 : ownsSkin(S(), id, eq.skin) ? eq.skin : 0;
        c.hat = c.step.who === 'cpu' ? 'none' : eq.hat;
        c.preview = new FighterPreview(id, { skin: c.skin, hat: c.hat, facing: this.cursors.indexOf(c) === 0 ? 1 : -1 });
        c.pid = id;
        c.anim = 0;
      }
    }
    inputFor(k) {
      if (!this.simul) return menu;
      return sideMenus[k];
    }
    cellRect(view, i) {
      const cw = 104, ch = 116, gap = 10;
      const gw = this.cols * cw + (this.cols - 1) * gap;
      const x0 = view.w / 2 - gw / 2;
      const y0 = view.h - 2 * ch - gap - 54;
      const r = Math.floor(i / this.cols), c = i % this.cols;
      return { x: x0 + c * (cw + gap), y: y0 + r * (ch + gap), w: cw, h: ch };
    }
    update(view) {
      super.update(view);
      const allDone = this.cursors.every((c) => c.phase === 'done');
      if (allDone) {
        this.doneT = (this.doneT || 0) + 1;
        if (this.doneT === 30) this.finish();
      }
      this.cursors.forEach((c, k) => {
        c.preview.update();
        c.anim++;
        if (c.activeFrom === this.t) return; // was handed control this very frame
        if (c.phase === 'wait' || c.phase === 'done') {
          if (c.phase === 'done' && !this.simul && this.inputFor(k).fired.back && k === this.lastDoneIdx()) this.unpick(k);
          if (c.phase === 'done' && this.simul && this.inputFor(k).fired.back) this.unpick(k);
          return;
        }
        const inp = this.inputFor(k);
        if (c.phase === 'pick') {
          const n = this.ids.length;
          let moved = false;
          if (inp.fired.left) {
            c.i = (c.i - 1 + n) % n;
            moved = true;
          }
          if (inp.fired.right) {
            c.i = (c.i + 1) % n;
            moved = true;
          }
          if (inp.fired.up || inp.fired.down) {
            c.i = (c.i + this.cols) % n;
            moved = true;
          }
          if (moved) {
            sfx('uiMove');
            this.syncPreview(c);
          }
          if ((menu.fired.alt && !this.simul) || (this.simul && false)) this.randomPick(c);
          if (inp.fired.confirm) this.confirm(c, k);
          else if (inp.fired.back) {
            sfx('uiBack');
            if (k > 0 && !this.simul) {
              this.unpick(k - 1);
              c.phase = 'wait';
            } else if (this.onBack) this.onBack();
          }
        } else if (c.phase === 'skin') {
          const def = getFighter(this.ids[c.i]);
          const owned = def.skins.map((_, idx) => idx).filter((idx) => ownsSkin(S(), def.id, idx));
          let j = owned.indexOf(c.skin);
          if (inp.fired.left || inp.fired.right) {
            j = (j + (inp.fired.left ? -1 : 1) + owned.length) % owned.length;
            c.skin = owned[j];
            c.preview.setSkin(c.skin);
            sfx('uiMove');
          }
          if (inp.fired.confirm) this.lockIn(c, k);
          else if (inp.fired.back) {
            c.phase = 'pick';
            sfx('uiBack');
          }
        }
      });
      // pointer: click on cells for the active cursor
      const k = this.simul ? this.cursors.findIndex((c) => c.phase === 'pick') : this.cursors.findIndex((c) => c.phase === 'pick' || c.phase === 'skin');
      if (k >= 0) {
        const c = this.cursors[k];
        for (let i = 0; i < this.ids.length; i++) {
          const r = this.cellRect(view, i);
          if (inRect(pointer.x, pointer.y, r)) {
            if (pointer.moved && c.phase === 'pick' && c.i !== i) {
              c.i = i;
              this.syncPreview(c);
              sfx('uiMove');
            }
            if (pointer.pressed) {
              if (c.phase === 'skin' && c.i === i) this.lockIn(c, k);
              else {
                c.phase = 'pick';
                c.i = i;
                this.syncPreview(c);
                this.confirm(c, k);
              }
            }
          }
        }
        if (pointer.pressed && inRect(pointer.x, pointer.y, this.randomRect(view)) && c.phase === 'pick') this.randomPick(c);
      }
    }
    lastDoneIdx() {
      let idx = -1;
      this.cursors.forEach((c, k) => {
        if (c.phase === 'done') idx = k;
      });
      return idx;
    }
    randomPick(c) {
      const pool = this.ids.filter((id) => this.canPick(c, id));
      c.i = this.ids.indexOf(pick(pool));
      this.syncPreview(c);
      sfx('uiSelect');
    }
    confirm(c, k) {
      const id = this.ids[c.i];
      if (!this.canPick(c, id)) {
        sfx('uiError');
        const d = getFighter(id);
        const tw = TOWERS.find((t) => t.reward === id);
        game.toasts.push('LOCKED', tw ? `Clear "${tw.name}" or buy in the Locker` : 'Unlock in the Locker', '#ff5c5c', '✖');
        return;
      }
      sfx('uiSelect');
      const def = getFighter(id);
      const owned = def.skins.filter((_, idx) => ownsSkin(S(), id, idx)).length;
      if (c.step.who !== 'cpu' && owned > 1) c.phase = 'skin';
      else this.lockIn(c, k);
    }
    lockIn(c, k) {
      c.phase = 'done';
      audio.sfx('announceFight', { vol: 0.35, pitch: 1.4 });
      c.preview.f.setState('victory');
      c.preview.mode = 'victory';
      if (!this.simul && k + 1 < this.cursors.length) {
        const nx = this.cursors[k + 1];
        nx.phase = 'pick';
        nx.activeFrom = this.t;
        nx.i = c.i;
        this.syncPreview(nx);
      }
    }
    unpick(k) {
      const c = this.cursors[k];
      c.phase = 'pick';
      c.preview.mode = 'showcase';
      c.preview.f.setState('idle');
      this.doneT = 0;
      if (!this.simul) for (let j = k + 1; j < this.cursors.length; j++) this.cursors[j].phase = 'wait';
      sfx('uiBack');
    }
    finish() {
      const picks = this.cursors.map((c) => ({ id: this.ids[c.i], skin: c.skin, hat: c.hat }));
      S().lastP1 = picks[0].id;
      if (picks[1]) S().lastP2 = picks[1].id;
      game.persist();
      this.onDone(picks);
    }
    randomRect(view) {
      const r = this.cellRect(view, this.ids.length - 1);
      return { x: view.w / 2 - 70, y: r.y + r.h + 12, w: 140, h: 30 };
    }
    draw(ctx, view) {
      this.drawBG(ctx, view);
      title(ctx, this.titleStr, 50, 50, { size: 46 });
      // previews and info panels
      this.cursors.forEach((c, k) => {
        const left = k === 0;
        const def = getFighter(this.ids[c.i]);
        const locked = !this.canPick(c, def.id);
        const px = left ? view.w * 0.11 : view.w * 0.89;
        const py = view.h * 0.53;
        ctx.save();
        const g = ctx.createRadialGradient(px, py - 80, 10, px, py - 80, 230);
        g.addColorStop(0, rgba(c.preview.f.skin.accent, 0.35));
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(px - 260, py - 330, 520, 420);
        ctx.restore();
        if (locked) ctx.filter = 'brightness(0) opacity(0.85)';
        c.preview.draw(ctx, px, py, 1.45);
        ctx.filter = 'none';
        if (locked) lockIcon(ctx, px, py - 140, 1.4);
        const tag = c.step.label || (c.step.who === 'cpu' ? 'CPU' : c.step.who.toUpperCase());
        const tagCol = k === 0 ? C.cyan : '#ff5c6c';
        text(ctx, tag, px, py + 30, { size: 22, font: FONT_UI, color: tagCol, stroke: '#000', sw: 4 });
        if (c.phase === 'skin') {
          text(ctx, `◀  ${def.skins[c.skin].name.toUpperCase()}  ▶`, px, py + 60, { size: 20, font: FONT_UI, color: C.accent, stroke: '#000', sw: 4 });
          text(ctx, 'choose a skin', px, py + 84, { size: 15, font: FONT_BODY, color: C.dim });
        } else if (c.phase === 'done') {
          text(ctx, 'READY!', px, py + 62, { size: 30, font: FONT_BIG, color: C.accent, stroke: '#000', sw: 5 });
        } else if (c.phase === 'wait') {
          text(ctx, 'waiting…', px, py + 60, { size: 16, font: FONT_BODY, color: C.dim });
        }
        // info panel
        const pw = Math.min(340, view.w * 0.28 - 24);
        const pxp = left ? view.w * 0.5 - 12 - pw : view.w * 0.5 + 12;
        const pyp = 96;
        panel(ctx, pxp, pyp, pw, 300, { stroke: rgba(def.skins[0].accent, 0.6) });
        text(ctx, locked ? '???' : def.name, pxp + 18, pyp + 30, { size: 34, font: FONT_BIG, align: 'left', color: '#fff', stroke: '#000', sw: 5 });
        text(ctx, def.title.toUpperCase(), pxp + 18, pyp + 58, { size: 14, font: FONT_UI, align: 'left', color: def.skins[0].accent });
        const bars = [['POWER', def.bars.power], ['SPEED', def.bars.speed], ['DEFENSE', def.bars.defense], ['RANGE', def.bars.range], ['DIFFICULTY', def.bars.difficulty]];
        bars.forEach(([name, v], i) => {
          const y = pyp + 82 + i * 20;
          text(ctx, name, pxp + 18, y + 5, { size: 12, font: FONT_UI, align: 'left', color: C.dim });
          for (let j = 0; j < 5; j++) {
            ctx.fillStyle = j < v ? (name === 'DIFFICULTY' ? '#ff8a5c' : def.skins[0].accent) : 'rgba(255,255,255,0.12)';
            ctx.fillRect(pxp + 118 + j * 26, y, 22, 9);
          }
        });
        let y = pyp + 192;
        for (const key of ['S1', 'S2', 'S3']) {
          const m = def.specials[key];
          if (!m) continue;
          text(ctx, m.name, pxp + 18, y, { size: 16, font: FONT_BODY, align: 'left', color: '#fff' });
          text(ctx, SPECIAL_INPUTS[key], pxp + pw - 16, y, { size: 12, font: FONT_UI, align: 'right', color: C.accent });
          y += 22;
        }
        text(ctx, '★ ' + def.ult.name, pxp + 18, y + 4, { size: 15, font: FONT_UI, align: 'left', color: def.skins[0].accent });
        text(ctx, 'ULT', pxp + pw - 16, y + 4, { size: 12, font: FONT_UI, align: 'right', color: C.accent });
        if (locked) {
          const tw = TOWERS.find((t) => t.reward === def.id);
          text(ctx, tw ? `Unlock: clear ${tw.name}` : 'Unlock in the Locker', pxp + pw / 2, pyp + 286, { size: 13, font: FONT_UI, color: '#ff8a8a' });
        }
      });
      // grid
      for (let i = 0; i < this.ids.length; i++) {
        const r = this.cellRect(view, i);
        const def = getFighter(this.ids[i]);
        const unlocked = P.isUnlocked(def.id);
        const hl = this.cursors.map((c, k) => (c.i === i && c.phase !== 'wait' ? k : -1)).filter((k) => k >= 0);
        ctx.save();
        skewPanel(ctx, r.x, r.y, r.w, r.h, 10);
        const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
        g.addColorStop(0, rgba(def.skins[0].accent, unlocked ? 0.35 : 0.08));
        g.addColorStop(1, 'rgba(10,9,20,0.95)');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.lineWidth = hl.length ? 4 : 2;
        ctx.strokeStyle = hl.length === 2 ? C.accent : hl[0] === 0 ? C.cyan : hl[0] === 1 ? '#ff5c6c' : C.line;
        ctx.stroke();
        ctx.clip();
        const fakeF = { skin: unlocked ? def.skins[0] : { ...def.skins[0], color: '#1a1a24', accent: '#333', eye: '#333' } };
        drawPortrait(ctx, fakeF, r.x + r.w / 2, r.y + r.h / 2 - 8, 30);
        ctx.restore();
        text(ctx, def.name, r.x + r.w / 2, r.y + r.h - 14, { size: 15, font: FONT_UI, color: unlocked ? '#fff' : 'rgba(255,255,255,0.35)', stroke: '#000', sw: 3 });
        if (!unlocked) lockIcon(ctx, r.x + r.w - 18, r.y + 22, 0.6);
        hl.forEach((k) => {
          text(ctx, k === 0 ? (this.cursors[0].step.label || 'P1') : (this.cursors[1].step.label || 'P2'), k === 0 ? r.x + 14 : r.x + r.w - 14, r.y + 14, { size: 13, font: FONT_UI, color: k === 0 ? C.cyan : '#ff5c6c', align: k === 0 ? 'left' : 'right', stroke: '#000', sw: 3 });
        });
      }
      if (!this.simul) {
        const rr = this.randomRect(view);
        panel(ctx, rr.x, rr.y, rr.w, rr.h, { r: 8 });
        text(ctx, 'RANDOM', rr.x + rr.w / 2, rr.y + rr.h / 2 + 1, { size: 14, font: FONT_UI, color: C.dim });
      }
      coins(ctx, view, S().coins);
      if (this.simul) {
        text(ctx, 'P1: WASD + F / G      P2: ARROWS + K / L      (or one gamepad each)', view.w / 2, view.h - 18, { size: 15, font: FONT_UI, color: C.dim });
      } else hints(ctx, view, [['←→', 'Choose'], ['ENTER', 'Select'], ['R', 'Random'], ['ESC', 'Back']]);
    }
  }

  // -------------------------------------------------------------------------
  // Fight setup: stage + options
  // -------------------------------------------------------------------------
  class Setup extends MenuScene {
    constructor({ kind, picks, onFight, onBack }) {
      super();
      this.dim = 0.82;
      this.kind = kind;
      this.picks = picks;
      this.arenaIdx = 0; // 0 = random
      this.diff = settings().difficulty ?? 2;
      this.rounds = settings().rounds ?? 2;
      this.time = settings().time ?? 99;
      const times = [30, 60, 99, 0];
      const items = [
        {
          label: 'STAGE',
          value: () => (this.arenaIdx === 0 ? 'RANDOM' : PLAYABLE_ARENAS[this.arenaIdx - 1].name.toUpperCase()),
          left: () => (this.arenaIdx = (this.arenaIdx - 1 + PLAYABLE_ARENAS.length + 1) % (PLAYABLE_ARENAS.length + 1)),
          right: () => (this.arenaIdx = (this.arenaIdx + 1) % (PLAYABLE_ARENAS.length + 1)),
        },
      ];
      if (kind === 'quick') {
        items.push({
          label: 'DIFFICULTY',
          value: () => QUICK_DIFFICULTIES[this.diff].name,
          left: () => (this.diff = Math.max(0, this.diff - 1)),
          right: () => (this.diff = Math.min(QUICK_DIFFICULTIES.length - 1, this.diff + 1)),
        });
      }
      items.push(
        {
          label: 'ROUNDS',
          value: () => (this.rounds === 1 ? '1 ROUND' : `BEST OF ${this.rounds * 2 - 1}`),
          left: () => (this.rounds = Math.max(1, this.rounds - 1)),
          right: () => (this.rounds = Math.min(3, this.rounds + 1)),
        },
        {
          label: 'TIMER',
          value: () => (this.time === 0 ? '∞' : `${this.time}s`),
          left: () => (this.time = times[(times.indexOf(this.time) - 1 + times.length) % times.length]),
          right: () => (this.time = times[(times.indexOf(this.time) + 1) % times.length]),
        },
        { label: 'FIGHT!', color: '#ff4d6d', action: () => this.go() },
      );
      this.menu = new ListMenu(items, { x: 60, y: 170, w: 470, h: 54, size: 22, start: items.length - 1, onBack });
    }
    go() {
      const st = settings();
      if (this.kind === 'quick') st.difficulty = this.diff;
      st.rounds = this.rounds;
      st.time = this.time;
      game.persist();
      const arena = this.arenaIdx === 0 ? pick(PLAYABLE_ARENAS).id : PLAYABLE_ARENAS[this.arenaIdx - 1].id;
      this.onFightCb({ arena, diff: this.diff, rounds: this.rounds, time: this.time });
    }
    set onFight(fn) {
      this.onFightCb = fn;
    }
    update(view) {
      super.update(view);
      this.menu.update();
    }
    draw(ctx, view) {
      this.drawBG(ctx, view);
      title(ctx, 'FIGHT SETUP', 50, 60, { size: 50 });
      this.menu.draw(ctx);
      const id = this.arenaIdx === 0 ? null : PLAYABLE_ARENAS[this.arenaIdx - 1].id;
      const pw = Math.min(640, view.w - 640), ph = pw * 0.5625;
      const px = view.w - pw - 50, py = 150;
      panel(ctx, px - 8, py - 8, pw + 16, ph + 16, { r: 10 });
      if (id) drawArenaPreview(ctx, id, px, py, pw, ph, this.t / 60);
      else {
        // random: cycle quickly through stages
        const k = Math.floor(this.t / 40) % PLAYABLE_ARENAS.length;
        drawArenaPreview(ctx, PLAYABLE_ARENAS[k].id, px, py, pw, ph, this.t / 60);
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(px, py, pw, ph);
        text(ctx, '?', px + pw / 2, py + ph / 2, { size: 140, font: FONT_BIG, color: '#fff', stroke: '#000', sw: 8 });
      }
      const a = id ? ARENAS.find((x) => x.id === id) : { name: 'Random Stage', desc: 'Let fate decide the battlefield.' };
      text(ctx, a.name.toUpperCase(), px, py + ph + 36, { size: 30, font: FONT_BIG, align: 'left', color: '#fff', stroke: '#000', sw: 5 });
      text(ctx, a.desc || '', px, py + ph + 66, { size: 18, font: FONT_BODY, align: 'left', color: C.dim });
      // matchup strip
      const [p1, p2] = this.picks;
      const d1 = getFighter(p1.id), d2 = getFighter(p2.id);
      const y = view.h - 110;
      drawPortrait(ctx, { skin: d1.skins[p1.skin] || d1.skins[0] }, 110, y, 30);
      text(ctx, d1.name, 156, y, { size: 26, font: FONT_BIG, align: 'left', color: '#fff', stroke: '#000', sw: 4 });
      text(ctx, 'VS', 300, y, { size: 34, font: FONT_BIG, color: C.accent2, stroke: '#000', sw: 5 });
      drawPortrait(ctx, { skin: d2.skins[p2.skin] || d2.skins[0] }, 360, y, 30, true);
      text(ctx, d2.name, 406, y, { size: 26, font: FONT_BIG, align: 'left', color: '#fff', stroke: '#000', sw: 4 });
      hints(ctx, view, [['↑↓', 'Option'], ['←→', 'Change'], ['ENTER', 'Fight'], ['ESC', 'Back']]);
    }
  }

  // -------------------------------------------------------------------------
  // Fight scene: hosts a Match, pause menu, training options
  // -------------------------------------------------------------------------
  class FightScene extends Scene {
    constructor(cfg, { onEnd, onQuit, onRetry, humanSides = [true, false] } = {}) {
      super();
      this.cfg = cfg;
      this.onEndCb = onEnd;
      this.onQuit = onQuit || (() => game.go(new MainMenu()));
      this.onRetry = onRetry;
      this.humanSides = humanSides;
      this.wantsTouch = true;
      this.t = 0;
      const solo = cfg.p2.ctrl === 'cpu';
      const st = settings();
      const binds = S().bindings || DEFAULT_BINDINGS;
      const ultKey = (kind) => `[${keyLabel((binds[kind] || DEFAULT_BINDINGS[kind]).ult[0])}]`;
      this.match = new Match({
        ...cfg,
        settings: st,
        bindings: S().bindings,
        keyHints: solo ? [ultKey('solo'), null] : [ultKey('p1'), ultKey('p2')],
        onEvent: P.matchEvents(humanSides),
        onEnd: (res, m) => this.onEndCb && this.onEndCb(res, m),
      });
      this.pause = null;
    }
    controllers() {
      return []; // the Match polls its own controllers once per simulation step
    }
    humanControllers() {
      return this.match.f.map((f) => f.ctrl).filter((c) => !c.ai);
    }
    onTouchPause() {
      if (!this.pause) this.openPause();
    }
    openPause() {
      this.match.paused = true;
      audio.setPaused(true);
      sfx('uiBack');
      const M = this.match;
      const items = [{ label: 'RESUME', action: () => this.closePause() }];
      if (M.mode === 'training') {
        const dummies = [['stand', 'STAND'], ['block', 'BLOCK ALL'], ['random', 'RANDOM BLOCK'], ['jump', 'JUMP'], ['recover', 'AIR RECOVER'], ['cpu1', 'CPU EASY'], ['cpu2', 'CPU NORMAL'], ['cpu3', 'CPU HARD'], ['cpu4', 'CPU NIGHTMARE']];
        const di = () => Math.max(0, dummies.findIndex((d) => d[0] === M.training.dummy));
        items.push(
          { label: 'DUMMY', value: () => dummies[di()][1], left: () => M.setDummy(dummies[(di() - 1 + dummies.length) % dummies.length][0]), right: () => M.setDummy(dummies[(di() + 1) % dummies.length][0]) },
          { label: 'HITBOXES', value: () => (M.training.hitboxes ? 'ON' : 'OFF'), left: () => (M.training.hitboxes = !M.training.hitboxes), right: () => (M.training.hitboxes = !M.training.hitboxes) },
          { label: 'INFINITE POWER', value: () => (M.training.meter ? 'ON' : 'OFF'), left: () => (M.training.meter = !M.training.meter), right: () => (M.training.meter = !M.training.meter) },
          { label: 'AUTO REFILL', value: () => (M.training.refill ? 'ON' : 'OFF'), left: () => (M.training.refill = !M.training.refill), right: () => (M.training.refill = !M.training.refill) },
          { label: 'RESET POSITIONS', action: () => { M.startRound(false); M.phase = 'fight'; this.closePause(); } },
        );
      }
      items.push({ label: 'MOVE LIST', action: () => (this.moveList = true) });
      if (this.onRetry) items.push({ label: 'RESTART', action: () => this.onRetry() });
      items.push({ label: M.mode === 'tower' ? 'LEAVE FLOOR' : 'QUIT', color: '#ff5c5c', action: () => { audio.setPaused(false); this.onQuit(); } });
      this.pause = new ListMenu(items, { x: 0, y: 0, w: 420, h: 46, size: 20, gap: 6, onBack: () => this.closePause() });
    }
    closePause() {
      this.pause = null;
      this.moveList = false;
      this.match.paused = false;
      audio.setPaused(false);
      for (const c of this.humanControllers()) c.flush();
    }
    update(view) {
      this.t++;
      if (this.pause) {
        if (this.moveList) {
          if (menu.fired.back || menu.fired.confirm || pointer.pressed) {
            this.moveList = false;
            sfx('uiBack');
          }
          return;
        }
        this.pause.x = view.w / 2 - 210;
        this.pause.y = view.h / 2 - (this.pause.items.length * 52) / 2 + 20;
        this.pause.update();
        if (menu.fired.pause && !menu.fired.confirm && !menu.fired.back) this.closePause();
        return;
      }
      if ((menu.fired.pause && (keyPressedThisFrame('Escape') || keyPressedThisFrame('KeyP') || !keyPressedThisFrame('Enter') || this.match.mode === 'training')) && this.match.phase !== 'matchEnd') {
        this.openPause();
        return;
      }
      this.match.update(view);
      if (this.match.mode === 'training' && this.t === 3600) P.achieve('trainee');
    }
    draw(ctx, view) {
      this.match.draw(ctx, view);
      if (this.match.mode === 'training') this.drawTraining(ctx, view);
      if (this.pause) {
        ctx.fillStyle = 'rgba(5,4,12,0.72)';
        ctx.fillRect(0, 0, view.w, view.h);
        if (this.moveList) {
          drawMoveList(ctx, view, this.match.f[0].def, this.match.f[1].def);
          return;
        }
        text(ctx, 'PAUSED', view.w / 2, this.pause.y - 56, { size: 64, font: FONT_BIG, color: '#fff', stroke: '#000', sw: 7 });
        this.pause.draw(ctx);
      }
    }
    drawTraining(ctx, view) {
      const M = this.match;
      const T = M.training;
      const [a, b] = M.f;
      const c = M.hud.combo[0];
      panel(ctx, 20, view.h - 168, 300, 100, { r: 10 });
      text(ctx, 'TRAINING', 36, view.h - 146, { size: 16, font: FONT_UI, align: 'left', color: C.cyan });
      text(ctx, `Dummy: ${T.dummy.toUpperCase()}`, 36, view.h - 122, { size: 16, font: FONT_BODY, align: 'left', color: '#fff' });
      text(ctx, `Last combo: ${c.hits} hits · ${Math.round(c.dmg)} dmg`, 36, view.h - 100, { size: 16, font: FONT_BODY, align: 'left', color: '#fff' });
      text(ctx, `Dummy state: ${b.state}`, 36, view.h - 78, { size: 14, font: FONT_BODY, align: 'left', color: C.dim });
      text(ctx, 'ESC: training options', view.w / 2, view.h - 72, { size: 14, font: FONT_UI, color: C.dim });
      void a;
    }
  }

  function drawMoveList(ctx, view, d1, d2) {
    const defs = d1.id === d2.id ? [d1] : [d1, d2];
    text(ctx, 'MOVE LIST', view.w / 2, 60, { size: 54, font: FONT_BIG, color: '#fff', stroke: '#000', sw: 6 });
    const colW = Math.min(560, (view.w - 100) / 2);
    // common moves
    let x = view.w / 2 - colW - 20, y = 110;
    panel(ctx, x, y, colW, 470, {});
    text(ctx, 'EVERYONE', x + 20, y + 26, { size: 18, font: FONT_UI, align: 'left', color: C.accent });
    MOVE_LIST_COMMON.forEach(([n, inp], i) => {
      text(ctx, n, x + 20, y + 62 + i * 37, { size: 17, font: FONT_UI, align: 'left', color: '#fff' });
      text(ctx, inp, x + 20, y + 80 + i * 37, { size: 14, font: FONT_BODY, align: 'left', color: C.dim });
    });
    x = view.w / 2 + 20;
    defs.forEach((def, k) => {
      const yy = y + k * 240;
      const h = defs.length === 1 ? 470 : 230;
      panel(ctx, x, yy, colW, h, { stroke: rgba(def.skins[0].accent, 0.6) });
      text(ctx, `${def.name} — ${def.title}`, x + 20, yy + 26, { size: 18, font: FONT_UI, align: 'left', color: def.skins[0].accent });
      let r = 0;
      for (const key of ['S1', 'S2', 'S3', 'SA']) {
        const m = def.specials[key];
        if (!m) continue;
        text(ctx, m.name, x + 20, yy + 60 + r * 34, { size: 17, font: FONT_BODY, align: 'left', color: '#fff' });
        text(ctx, SPECIAL_INPUTS[key], x + colW - 20, yy + 60 + r * 34, { size: 14, font: FONT_UI, align: 'right', color: C.accent });
        r++;
      }
      text(ctx, '★ ' + def.ult.name, x + 20, yy + 60 + r * 34, { size: 17, font: FONT_UI, align: 'left', color: def.skins[0].accent });
      text(ctx, 'ULT (full power)', x + colW - 20, yy + 60 + r * 34, { size: 14, font: FONT_UI, align: 'right', color: C.accent });
    });
    text(ctx, 'press any button to close', view.w / 2, view.h - 40, { size: 16, font: FONT_BODY, color: C.dim });
  }

  // -------------------------------------------------------------------------
  // Results
  // -------------------------------------------------------------------------
  class Results extends MenuScene {
    constructor({ result, match, headline, sub, rewards = [], items, winnerSide, humanSide = 0 }) {
      super();
      this.touchBack = false;
      this.dim = 0.92;
      this.music = null;
      this.result = result;
      this.headline = headline;
      this.sub = sub || '';
      this.rewards = rewards;
      this.total = rewards.reduce((s, r) => s + r[1], 0);
      this.shown = 0;
      this.names = match.f.map((f) => f.def.name);
      this.colors = match.f.map((f) => readable(f.skin.color));
      const ws = winnerSide ?? result.winner;
      const wf = match.f[Math.max(0, ws)];
      this.preview = new FighterPreview(wf.def.id, { mode: 'victory', facing: 1 });
      this.quote = wf.def.quotes ? pick(wf.def.quotes) : '';
      this.preview.setSkin(wf.def.skins.indexOf(wf.skin), wf.acc.hat);
      this.menu = new ListMenu(items, { x: 60, y: 0, w: 380, h: 50, size: 22 });
      this.humanSide = humanSide;
    }
    enter() {
      setTimeout(() => audio.playMusic('menu'), 2200);
    }
    update(view) {
      super.update(view);
      this.preview.update();
      this.menu.y = view.h - this.menu.items.length * 58 - 40;
      this.menu.update();
      if (this.shown < this.total) {
        this.shown = Math.min(this.total, this.shown + Math.max(1, this.total / 60));
        if (this.t % 4 === 0) audio.sfx('coin', { vol: 0.3, pitch: 1 + this.shown / Math.max(1, this.total) });
      }
    }
    draw(ctx, view) {
      this.drawBG(ctx, view);
      const won = this.headline.win;
      text(ctx, this.headline.text, 60, 82, { size: 92, font: FONT_BIG, align: 'left', color: won ? C.accent : '#ff5c5c', stroke: '#000', sw: 9, shadow: 'rgba(0,0,0,0.5)' });
      if (this.sub) text(ctx, this.sub, 64, 140, { size: 22, font: FONT_UI, align: 'left', color: '#fff' });
      if (this.quote) wrapText(ctx, `“${this.quote}”`, 64, 172, Math.min(440, view.w * 0.34), 26, { size: 21, color: C.dim });
      const sx = view.w * 0.52, sy = view.h * 0.74;
      const spot = ctx.createRadialGradient(sx, sy - 120, 10, sx, sy - 120, 300);
      spot.addColorStop(0, rgba(readable(this.preview.f.skin.accent), 0.28));
      spot.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = spot;
      ctx.fillRect(sx - 320, sy - 440, 640, 520);
      this.preview.draw(ctx, sx, sy, 1.7);
      // stats table
      const st = this.result.stats;
      const rows = [
        ['Damage dealt', st.map((s) => s.dealt)],
        ['Best combo', st.map((s) => s.maxCombo)],
        ['Specials', st.map((s) => s.specials)],
        ['Ultimates', st.map((s) => s.ults)],
        ['Parries', st.map((s) => s.parries)],
        ['Breakers', st.map((s) => s.breakers)],
        ['Throws', st.map((s) => s.throws)],
      ];
      const tw = 380, tx = view.w - tw - 50, ty = 60;
      panel(ctx, tx, ty, tw, 60 + rows.length * 30, {});
      text(ctx, this.names[0], tx + 210, ty + 26, { size: 16, font: FONT_UI, color: this.colors[0] });
      text(ctx, this.names[1], tx + 310, ty + 26, { size: 16, font: FONT_UI, color: this.colors[1] });
      rows.forEach(([n, v], i) => {
        const y = ty + 60 + i * 30;
        text(ctx, n, tx + 20, y, { size: 17, font: FONT_BODY, align: 'left', color: C.dim });
        v.forEach((val, k) => {
          const better = val > v[1 - k];
          text(ctx, String(Math.round(val)), tx + 210 + k * 100, y, { size: 18, font: FONT_UI, color: better ? '#fff' : 'rgba(255,255,255,0.55)' });
        });
      });
      // rewards
      if (this.rewards.length) {
        const ry = ty + 80 + rows.length * 30;
        panel(ctx, tx, ry, tw, 50 + this.rewards.length * 26, { stroke: 'rgba(255,210,63,0.5)' });
        this.rewards.forEach(([n, c], i) => {
          text(ctx, n, tx + 20, ry + 26 + i * 26, { size: 17, font: FONT_BODY, align: 'left', color: '#fff' });
          text(ctx, '+' + c, tx + tw - 20, ry + 26 + i * 26, { size: 17, font: FONT_UI, align: 'right', color: C.accent });
        });
        const y = ry + 30 + this.rewards.length * 26;
        coinIcon(ctx, tx + 30, y, 11);
        text(ctx, `${Math.round(this.shown)} COINS`, tx + 50, y + 1, { size: 20, font: FONT_UI, align: 'left', color: C.accent });
      }
      this.menu.draw(ctx);
      coins(ctx, view, S().coins);
    }
  }

  // -------------------------------------------------------------------------
  // Flows
  // -------------------------------------------------------------------------
  function startQuickFight() {
    game.go(new CharSelect({
      steps: [{ who: 'p1', label: 'YOU' }, { who: 'cpu', label: 'CPU', allowLocked: true }],
      titleStr: 'QUICK FIGHT',
      onBack: () => game.go(new MainMenu(1)),
      onDone: (picks) => quickSetup(picks),
    }));
  }
  function quickSetup(picks) {
    const setup = new Setup({ kind: 'quick', picks, onBack: () => startQuickFight() });
    setup.onFight = (opt) => runQuick(picks, opt);
    game.go(setup);
  }
  function runQuick(picks, opt) {
    const diff = QUICK_DIFFICULTIES[opt.diff];
    const cfg = {
      mode: 'arcade',
      p1: { ...picks[0], ctrl: 'solo' },
      p2: { ...picks[1], ctrl: 'cpu', level: diff.level },
      arena: opt.arena, rounds: opt.rounds, time: opt.time,
      labels: ['YOU', 'CPU'],
    };
    const fight = new FightScene(cfg, {
      onRetry: () => runQuick(picks, opt),
      onQuit: () => game.go(new MainMenu(1)),
      onEnd: (res, m) => {
        P.recordMatch(res, 0);
        const won = res.winner === 0;
        const rewards = [];
        if (won) {
          rewards.push([`Victory (${diff.name})`, diff.coins]);
          if (res.perfects[0]) rewards.push(['Perfect rounds', 40 * res.perfects[0]]);
          if (opt.diff >= 4) P.achieve('nightmare');
        } else rewards.push(['Participation', 15]);
        const combo = Math.min(60, res.stats[0].maxCombo * 3);
        if (combo >= 15) rewards.push(['Combo bonus', combo]);
        P.coins(rewards.reduce((s, r) => s + r[1], 0), true);
        game.go(new Results({
          result: res, match: m, rewards,
          headline: { text: won ? 'VICTORY' : 'DEFEAT', win: won },
          sub: `${m.f[0].def.name} vs ${m.f[1].def.name} · ${diff.name}`,
          items: [
            { label: 'REMATCH', action: () => runQuick(picks, opt) },
            { label: 'CHANGE FIGHTERS', action: () => startQuickFight() },
            { label: 'MAIN MENU', action: () => game.go(new MainMenu(1)) },
          ],
        }));
      },
    });
    game.go(fight);
  }

  function startVersus() {
    game.go(new CharSelect({
      steps: [{ who: 'p1', label: 'P1' }, { who: 'p2', label: 'P2' }],
      simultaneous: true,
      titleStr: 'VERSUS',
      onBack: () => game.go(new MainMenu(2)),
      onDone: (picks) => {
        const setup = new Setup({ kind: 'versus', picks, onBack: () => startVersus() });
        setup.onFight = (opt) => runVersus(picks, opt);
        game.go(setup);
      },
    }));
  }
  function runVersus(picks, opt) {
    const cfg = {
      mode: 'versus',
      p1: { ...picks[0], ctrl: 'p1' },
      p2: { ...picks[1], ctrl: 'p2' },
      arena: opt.arena, rounds: opt.rounds, time: opt.time,
      labels: ['P1', 'P2'],
    };
    game.go(new FightScene(cfg, {
      humanSides: [true, true],
      onRetry: () => runVersus(picks, opt),
      onQuit: () => game.go(new MainMenu(2)),
      onEnd: (res, m) => {
        S().stats.versus++;
        S().stats.matches++;
        if (S().stats.versus >= 10) P.achieve('versus10');
        P.coins(20, true);
        game.persist();
        game.go(new Results({
          result: res, match: m, rewards: [['Versus match', 20]],
          headline: { text: `P${res.winner + 1} WINS`, win: true },
          sub: `${m.f[res.winner].def.name} takes it ${res.wins[res.winner]}–${res.wins[1 - res.winner]}`,
          items: [
            { label: 'REMATCH', action: () => runVersus(picks, opt) },
            { label: 'CHANGE FIGHTERS', action: () => startVersus() },
            { label: 'MAIN MENU', action: () => game.go(new MainMenu(2)) },
          ],
        }));
      },
    }));
  }

  function startSurvival() {
    game.go(new CharSelect({
      steps: [{ who: 'p1', label: 'YOU' }],
      titleStr: 'SURVIVAL',
      onBack: () => game.go(new MainMenu(3)),
      onDone: (picks) => runSurvival(picks[0], 1, 1, 0),
    }));
  }
  function runSurvival(pickP1, wave, hp, earned) {
    const pool = FIGHTER_DEFS.map((d) => d.id).filter((id) => id !== 'omega' || wave >= 10);
    const opp = wave % 5 === 0 ? pick(['brutus', 'omega', 'mortis', 'unit7'].filter((id) => id !== 'omega' || wave >= 10)) : pick(pool);
    const mods = wave % 5 === 0 ? buildMods(['giant']) : {};
    const level = Math.min(4.6, 0.6 + wave * 0.24);
    const cfg = {
      mode: 'survival',
      p1: { ...pickP1, ctrl: 'solo' },
      p2: { id: opp, ctrl: 'cpu', level, skin: Math.floor(Math.random() * 4) },
      arena: pick(PLAYABLE_ARENAS).id, rounds: 1, time: 99,
      startHp: [hp, 1], mods, labels: ['YOU', `WAVE ${wave}`],
      intro: wave === 1, introText: wave % 5 === 0 ? `BOSS WAVE ${wave}` : `WAVE ${wave}`,
      roundLabel: () => (wave % 5 === 0 ? `BOSS WAVE ${wave}` : `WAVE ${wave}`),
      subLabel: `WAVE ${wave}`,
      startMeter: [0, 0],
    };
    game.go(new FightScene(cfg, {
      onQuit: () => endSurvival(pickP1, wave - 1, earned, null),
      onEnd: (res, m) => {
        if (res.winner === 0) {
          const reward = 20 + wave * 6;
          P.coins(reward, true);
          if (wave >= 5) P.achieve('surv5');
          if (wave >= 15) P.achieve('surv15');
          const nextHp = Math.min(1, res.hpLeft[0] + 0.3);
          game.toasts.push(`WAVE ${wave} CLEARED`, `+${reward} coins · health restored`, '#3ddc97', '✓');
          runSurvival(pickP1, wave + 1, nextHp, earned + reward);
        } else endSurvival(pickP1, wave - 1, earned, { res, m });
      },
    }));
  }
  function endSurvival(pickP1, waves, earned, last) {
    const best = S().stats.survivalBest;
    const record = waves > best;
    if (record) S().stats.survivalBest = waves;
    game.persist();
    if (!last) {
      game.go(new MainMenu(3));
      return;
    }
    P.recordMatch(last.res, 0);
    game.go(new Results({
      result: last.res, match: last.m,
      rewards: [[`${waves} waves cleared`, earned]],
      headline: { text: `${waves} WAVES`, win: waves > 0 },
      sub: record ? 'NEW PERSONAL BEST!' : `Best: ${Math.max(best, waves)} waves`,
      winnerSide: 0,
      items: [
        { label: 'TRY AGAIN', action: () => runSurvival(pickP1, 1, 1, 0) },
        { label: 'CHANGE FIGHTER', action: () => startSurvival() },
        { label: 'MAIN MENU', action: () => game.go(new MainMenu(3)) },
      ],
    }));
  }

  function startTraining() {
    game.go(new CharSelect({
      steps: [{ who: 'p1', label: 'YOU' }, { who: 'cpu', label: 'DUMMY', allowLocked: true }],
      titleStr: 'TRAINING',
      onBack: () => game.go(new MainMenu(4)),
      onDone: (picks) => {
        const cfg = {
          mode: 'training',
          p1: { ...picks[0], ctrl: 'solo' },
          p2: { ...picks[1], ctrl: 'cpu', level: 2, dummy: 'stand' },
          arena: 'lab', rounds: 1, time: 0, intro: false, music: 'battle1',
          labels: ['YOU', 'DUMMY'],
        };
        game.go(new FightScene(cfg, { onQuit: () => game.go(new MainMenu(4)) }));
      },
    }));
  }

  // -------------------------------------------------------------------------
  // Towers
  // -------------------------------------------------------------------------
  class TowerSelect extends MenuScene {
    constructor(start) {
      super();
      this.music = 'tower';
      this.dim = 0.8;
      let first = TOWERS.findIndex((t, i) => P.towerUnlocked(i) && !P.towerState(t.id).done);
      if (first < 0) first = 0;
      this.i = start ?? first;
      this.scroll = this.i;
    }
    update(view) {
      super.update(view);
      const n = TOWERS.length;
      if (menu.fired.left && this.i > 0) {
        this.i--;
        sfx('uiMove');
      }
      if (menu.fired.right && this.i < n - 1) {
        this.i++;
        sfx('uiMove');
      }
      this.scroll = lerp(this.scroll, this.i, 0.18);
      const cw = 300;
      for (let k = 0; k < n; k++) {
        const x = view.w / 2 + (k - this.scroll) * (cw + 30) - cw / 2;
        const r = { x, y: 150, w: cw, h: 430 };
        if (inRect(pointer.x, pointer.y, r) && pointer.pressed) {
          if (this.i === k) this.choose();
          else {
            this.i = k;
            sfx('uiMove');
          }
        }
      }
      if (menu.fired.confirm) this.choose();
      if (menu.fired.back) {
        sfx('uiBack');
        game.go(new MainMenu(0));
      }
    }
    choose() {
      if (!P.towerUnlocked(this.i)) {
        sfx('uiError');
        game.toasts.push('LOCKED', `Clear ${TOWERS[this.i - 1].name} first`, '#ff5c5c', '✖');
        return;
      }
      sfx('uiSelect');
      const tw = TOWERS[this.i];
      game.go(new CharSelect({
        steps: [{ who: 'p1', label: 'YOU' }],
        titleStr: tw.name.toUpperCase(),
        music: 'tower',
        onBack: () => game.go(new TowerSelect(this.i)),
        onDone: (picks) => game.go(new TowerMap(this.i, picks[0])),
      }));
    }
    draw(ctx, view) {
      this.drawBG(ctx, view);
      title(ctx, 'TOWERS', 50, 60, { size: 54, sub: 'Clear a tower to unlock its champion. Each floor brings new rules.' });
      const cw = 300;
      TOWERS.forEach((tw, k) => {
        const x = view.w / 2 + (k - this.scroll) * (cw + 30) - cw / 2;
        if (x > view.w + 20 || x + cw < -20) return;
        const sel = k === this.i;
        const unlocked = P.towerUnlocked(k);
        const st = P.towerState(tw.id);
        const y = 150 + (sel ? -10 : 0);
        ctx.save();
        ctx.globalAlpha = sel ? 1 : 0.7;
        panel(ctx, x, y, cw, 430, { stroke: sel ? tw.color : C.line, fill: 'rgba(10,9,20,0.92)' });
        ctx.save();
        roundRect(ctx, x + 10, y + 10, cw - 20, 160, 8);
        ctx.clip();
        drawArenaPreview(ctx, tw.arena, x + 10, y + 10, cw - 20, 160, this.t / 60);
        if (!unlocked) {
          ctx.fillStyle = 'rgba(0,0,0,0.65)';
          ctx.fillRect(x, y, cw, 180);
        }
        ctx.restore();
        if (!unlocked) lockIcon(ctx, x + cw / 2, y + 95, 1.5);
        text(ctx, `TOWER ${k + 1}`, x + 20, y + 196, { size: 14, font: FONT_UI, align: 'left', color: tw.color });
        text(ctx, tw.name.toUpperCase(), x + 20, y + 224, { size: 26, font: FONT_BIG, align: 'left', color: '#fff', stroke: '#000', sw: 4 });
        wrapText(ctx, tw.desc, x + 20, y + 244, cw - 40, 20, { size: 16, color: C.dim });
        // floors progress
        const n = tw.floors.length;
        for (let f = 0; f < n; f++) {
          ctx.fillStyle = f < st.cleared ? tw.color : 'rgba(255,255,255,0.15)';
          ctx.fillRect(x + 20 + f * ((cw - 40) / n), y + 304, (cw - 40) / n - 4, 10);
        }
        text(ctx, `${st.cleared}/${n} FLOORS`, x + 20, y + 332, { size: 14, font: FONT_UI, align: 'left', color: '#fff' });
        // reward
        const rd = getFighter(tw.reward);
        const got = P.isUnlocked(rd.id);
        drawPortrait(ctx, { skin: got || st.done ? rd.skins[0] : { ...rd.skins[0], color: '#1a1a24', accent: '#444', eye: '#444' } }, x + 46, y + 382, 22);
        text(ctx, 'CHAMPION', x + 82, y + 372, { size: 12, font: FONT_UI, align: 'left', color: C.dim });
        text(ctx, got ? rd.name : '???', x + 82, y + 394, { size: 20, font: FONT_UI, align: 'left', color: got ? rd.skins[0].accent : '#fff' });
        if (st.done) text(ctx, 'CLEARED', x + cw - 20, y + 384, { size: 18, font: FONT_BIG, align: 'right', color: C.good, stroke: '#000', sw: 3 });
        ctx.restore();
      });
      coins(ctx, view, S().coins);
      hints(ctx, view, [['←→', 'Tower'], ['ENTER', 'Enter'], ['ESC', 'Back']]);
    }
  }

  class TowerMap extends MenuScene {
    constructor(idx, pickP1, opts = {}) {
      super();
      this.music = 'tower';
      this.dim = 0.85;
      this.idx = idx;
      this.tw = TOWERS[idx];
      this.pick = pickP1;
      const st = P.towerState(this.tw.id);
      this.floor = Math.min(st.cleared, this.tw.floors.length - 1);
      this.climb = opts.climbFrom != null ? opts.climbFrom : this.floor;
      const items = [
        { label: 'FIGHT', color: this.tw.color, action: () => this.fight() },
        { label: 'CHANGE FIGHTER', action: () => game.go(new CharSelect({ steps: [{ who: 'p1', label: 'YOU' }], titleStr: this.tw.name.toUpperCase(), music: 'tower', onBack: () => game.go(new TowerMap(idx, pickP1)), onDone: (p) => game.go(new TowerMap(idx, p[0])) })) },
        { label: 'BACK', action: () => game.go(new TowerSelect(idx)) },
      ];
      this.menu = new ListMenu(items, { x: 0, y: 0, w: 330, h: 50, size: 22, onBack: () => game.go(new TowerSelect(idx)) });
    }
    maxFloor() {
      const st = P.towerState(this.tw.id);
      return Math.min(st.cleared, this.tw.floors.length - 1);
    }
    update(view) {
      super.update(view);
      this.climb = lerp(this.climb, this.floor, 0.08);
      if (menu.fired.up && this.floor < this.maxFloor()) {
        this.floor++;
        sfx('uiMove');
      } else if (menu.fired.down && this.floor > 0 && this.menu.i === 0) {
        this.floor--;
        sfx('uiMove');
      }
      // let up/down change floors only while FIGHT is highlighted
      const prevI = this.menu.i;
      this.menu.x = view.w - 400;
      this.menu.y = view.h - 210;
      if (!(menu.fired.up || menu.fired.down) || prevI !== 0) this.menu.update();
      else {
        // still allow pointer
        this.menu.enabled = false;
        this.menu.update();
        this.menu.enabled = true;
      }
    }
    fight() {
      const fl = this.tw.floors[this.floor];
      const oppId = fl.opp === 'mirror' ? this.pick.id : fl.opp;
      const mods = buildMods(fl.mods);
      const cfg = {
        mode: 'tower',
        p1: { ...this.pick, ctrl: 'solo' },
        p2: { id: oppId, ctrl: 'cpu', level: fl.lvl, skin: fl.opp === 'mirror' ? 2 : 0 },
        arena: this.tw.arena, rounds: fl.rounds, time: 99, mods,
        labels: ['YOU', `FLOOR ${this.floor + 1}`],
        introText: `FLOOR ${this.floor + 1}`, introSub: fl.mods.map((m) => MODS[m].name).join(' · '),
        subLabel: fl.mods.length ? fl.mods.map((m) => MODS[m].name.toUpperCase()).join(' · ') : '',
      };
      const floor = this.floor;
      game.go(new FightScene(cfg, {
        onRetry: () => this.fightAgain(),
        onQuit: () => game.go(new TowerMap(this.idx, this.pick)),
        onEnd: (res, m) => this.after(res, m, floor),
      }));
    }
    fightAgain() {
      game.go(new TowerMap(this.idx, this.pick));
    }
    after(res, m, floor) {
      P.recordMatch(res, 0);
      const st = { ...P.towerState(this.tw.id) };
      const fl = this.tw.floors[floor];
      if (res.winner === 0) {
        const first = floor >= st.cleared;
        const coinsWon = first ? fl.coins : Math.round(fl.coins * 0.3);
        P.coins(coinsWon, true);
        if (first) {
          st.cleared = floor + 1;
          S().stats.towerFloors++;
        }
        const last = floor === this.tw.floors.length - 1;
        if (last && !st.done) {
          st.done = true;
          S().towers[this.tw.id] = st;
          game.persist();
          game.go(new TowerComplete(this.idx, this.pick, res, m));
          return;
        }
        S().towers[this.tw.id] = st;
        game.persist();
        game.toasts.push(`FLOOR ${floor + 1} CLEARED`, `+${coinsWon} coins`, this.tw.color, '▲');
        game.go(new TowerMap(this.idx, this.pick, { climbFrom: floor }));
      } else {
        game.toasts.push('DEFEATED', 'Adjust your strategy and try again', '#ff5c5c', '✖');
        game.go(new TowerMap(this.idx, this.pick));
      }
    }
    draw(ctx, view) {
      this.drawBG(ctx, view);
      const tw = this.tw;
      title(ctx, tw.name.toUpperCase(), 50, 60, { size: 50, sub: tw.desc });
      // tower drawing
      const n = tw.floors.length;
      const bw = 210, bh = 58;
      const cx = view.w * 0.3;
      const baseY = view.h - 60;
      const st = P.towerState(tw.id);
      const camY = Math.max(0, (this.climb - 3) * (bh + 8));
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 120, view.w * 0.6, view.h - 120);
      ctx.clip();
      for (let f = 0; f < n; f++) {
        const y = baseY - (f + 1) * (bh + 8) + camY;
        const done = f < st.cleared;
        const sel = f === this.floor;
        const avail = f <= this.maxFloor();
        const w = bw - f * 6;
        skewPanel(ctx, cx - w / 2, y, w, bh, 10);
        ctx.fillStyle = sel ? rgba(tw.color, 0.9) : done ? rgba(tw.color, 0.35) : avail ? 'rgba(30,26,52,0.9)' : 'rgba(12,10,24,0.85)';
        ctx.fill();
        ctx.strokeStyle = sel ? '#fff' : C.line;
        ctx.lineWidth = 2;
        ctx.stroke();
        const fl = tw.floors[f];
        const oppId = fl.opp === 'mirror' ? this.pick.id : fl.opp;
        const od = getFighter(oppId);
        drawPortrait(ctx, { skin: avail ? od.skins[fl.opp === 'mirror' ? 2 : 0] : { ...od.skins[0], color: '#222', accent: '#333', eye: '#333' } }, cx - w / 2 + 34, y + bh / 2, 18);
        text(ctx, f === n - 1 ? 'CHAMPION' : `FLOOR ${f + 1}`, cx - w / 2 + 64, y + bh / 2 - 9, { size: 13, font: FONT_UI, align: 'left', color: sel ? '#0b0b12' : C.dim });
        text(ctx, avail ? (fl.opp === 'mirror' ? 'MIRROR' : od.name) : '???', cx - w / 2 + 64, y + bh / 2 + 11, { size: 18, font: FONT_UI, align: 'left', color: sel ? '#0b0b12' : '#fff' });
        if (done) text(ctx, '✓', cx + w / 2 - 22, y + bh / 2, { size: 24, font: FONT_UI, color: sel ? '#0b0b12' : C.good });
        if (!avail) lockIcon(ctx, cx + w / 2 - 24, y + bh / 2 + 2, 0.55);
      }
      // player marker
      const my = baseY - (this.climb + 1) * (bh + 8) + camY + bh / 2;
      drawPortrait(ctx, { skin: getFighter(this.pick.id).skins[this.pick.skin] || getFighter(this.pick.id).skins[0] }, cx - bw / 2 - 50, my, 22);
      text(ctx, 'YOU', cx - bw / 2 - 50, my + 38, { size: 13, font: FONT_UI, color: C.cyan });
      ctx.restore();
      // floor card
      const fl = tw.floors[this.floor];
      const oppId = fl.opp === 'mirror' ? this.pick.id : fl.opp;
      const od = getFighter(oppId);
      const px = view.w - 420, py = 140, pw = 380;
      panel(ctx, px, py, pw, 330, { stroke: tw.color });
      text(ctx, this.floor === tw.floors.length - 1 ? 'CHAMPION FLOOR' : `FLOOR ${this.floor + 1}`, px + 20, py + 28, { size: 16, font: FONT_UI, align: 'left', color: tw.color });
      drawPortrait(ctx, { skin: od.skins[fl.opp === 'mirror' ? 2 : 0] }, px + 52, py + 82, 30);
      text(ctx, fl.opp === 'mirror' ? `MIRROR ${od.name}` : od.name, px + 100, py + 72, { size: 30, font: FONT_BIG, align: 'left', color: '#fff', stroke: '#000', sw: 4 });
      text(ctx, `${od.title} · AI ${AI_LEVELS[Math.min(4, Math.round(fl.lvl))].name}`, px + 100, py + 98, { size: 15, font: FONT_BODY, align: 'left', color: C.dim });
      let y = py + 136;
      text(ctx, fl.rounds > 1 ? `BEST OF ${fl.rounds * 2 - 1}` : 'ONE ROUND', px + 20, y, { size: 15, font: FONT_UI, align: 'left', color: '#fff' });
      y += 30;
      if (!fl.mods.length) text(ctx, 'No modifiers — a clean fight.', px + 20, y, { size: 16, font: FONT_BODY, align: 'left', color: C.dim });
      for (const mid of fl.mods) {
        const md = MODS[mid];
        text(ctx, '◆ ' + md.name, px + 20, y, { size: 17, font: FONT_UI, align: 'left', color: md.color });
        text(ctx, md.desc, px + 40, y + 20, { size: 15, font: FONT_BODY, align: 'left', color: C.dim });
        y += 46;
      }
      const first = this.floor >= st.cleared;
      coinIcon(ctx, px + 30, py + 302, 10);
      text(ctx, `${first ? fl.coins : Math.round(fl.coins * 0.3)} coins${first ? '' : ' (replay)'}`, px + 48, py + 303, { size: 16, font: FONT_UI, align: 'left', color: C.accent });
      if (this.floor === tw.floors.length - 1) {
        const rd = getFighter(tw.reward);
        text(ctx, `Reward: ${P.isUnlocked(rd.id) ? rd.name : 'NEW FIGHTER'} + ${tw.bonus}`, px + pw - 20, py + 303, { size: 14, font: FONT_UI, align: 'right', color: '#fff' });
      }
      this.menu.draw(ctx);
      coins(ctx, view, S().coins);
      hints(ctx, view, [['↑↓', 'Floor'], ['ENTER', 'Fight'], ['ESC', 'Back']]);
    }
  }

  class TowerComplete extends MenuScene {
    constructor(idx, pickP1) {
      super();
      this.touchBack = false;
      this.music = null;
      this.dim = 0.85;
      this.tw = TOWERS[idx];
      this.idx = idx;
      const reward = this.tw.reward;
      this.isNew = !P.isUnlocked(reward);
      P.unlock(reward, false);
      P.coins(this.tw.bonus, true);
      P.achieve('tower1');
      if (TOWERS.every((t) => P.towerState(t.id).done)) P.achieve('towerall');
      if (reward === 'omega') P.achieve('omega');
      this.preview = new FighterPreview(reward, { mode: 'showcase', facing: 1 });
      audio.sfx('unlock');
      const next = idx + 1 < TOWERS.length;
      this.menu = new ListMenu([
        ...(next ? [{ label: 'NEXT TOWER', color: TOWERS[idx + 1].color, action: () => game.go(new TowerSelect(idx + 1)) }] : []),
        { label: 'TOWERS', action: () => game.go(new TowerSelect(idx)) },
        { label: 'MAIN MENU', action: () => game.go(new MainMenu(0)) },
      ], { x: 60, y: 0, w: 340, h: 50, size: 22 });
      this.pickP1 = pickP1;
    }
    enter() {
      setTimeout(() => audio.playMusic('menu'), 2500);
    }
    update(view) {
      super.update(view);
      this.preview.update();
      this.menu.y = view.h - this.menu.items.length * 58 - 40;
      this.menu.update();
    }
    draw(ctx, view) {
      this.drawBG(ctx, view);
      const d = getFighter(this.tw.reward);
      // rays
      ctx.save();
      ctx.translate(view.w * 0.62, view.h * 0.55);
      ctx.rotate(this.t * 0.004);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 12; i++) {
        ctx.rotate(Math.PI / 6);
        ctx.fillStyle = rgba(d.skins[0].accent, 0.07);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(600, -60);
        ctx.lineTo(600, 60);
        ctx.fill();
      }
      ctx.restore();
      text(ctx, 'TOWER CLEARED!', 60, 80, { size: 76, font: FONT_BIG, align: 'left', color: this.tw.color, stroke: '#000', sw: 8 });
      text(ctx, this.tw.name.toUpperCase(), 64, 130, { size: 22, font: FONT_UI, align: 'left', color: '#fff' });
      this.preview.draw(ctx, view.w * 0.62, view.h * 0.74, 1.8);
      text(ctx, this.isNew ? 'NEW FIGHTER UNLOCKED' : 'CHAMPION DEFEATED', view.w * 0.62, view.h * 0.2, { size: 22, font: FONT_UI, color: C.accent, stroke: '#000', sw: 4 });
      text(ctx, d.name, view.w * 0.62, view.h * 0.2 + 46, { size: 64, font: FONT_BIG, color: '#fff', stroke: '#000', sw: 7, shadow: d.skins[0].accent });
      text(ctx, d.title, view.w * 0.62, view.h * 0.2 + 86, { size: 20, font: FONT_BODY, color: d.skins[0].accent });
      coinIcon(ctx, 74, 186, 12);
      text(ctx, `+${this.tw.bonus} bonus coins`, 96, 187, { size: 22, font: FONT_UI, align: 'left', color: C.accent });
      this.menu.draw(ctx);
      coins(ctx, view, S().coins);
    }
  }

  // -------------------------------------------------------------------------
  // Locker (shop)
  // -------------------------------------------------------------------------
  class Locker extends MenuScene {
    constructor(tab = 0, fid) {
      super();
      this.dim = 0.85;
      this.tab = tab;
      this.fid = fid || S().lastP1 || 'kai';
      this.build();
    }
    build() {
      const s = S();
      const fid = this.fid;
      const def = getFighter(fid);
      let items = [];
      if (this.tab === 0) {
        items = FIGHTER_DEFS.map((d) => {
          const price = getFighter(d.id).unlock?.cost;
          return {
            label: d.name,
            value: () => (P.isUnlocked(d.id) ? 'OWNED' : price ? `${price}` : 'STARTER'),
            color: d.skins[0].accent,
            fid: d.id,
            action: () => {
              if (P.isUnlocked(d.id)) {
                this.fid = d.id;
                return;
              }
              if (!price) return;
              if (P.spend(price)) {
                P.unlock(d.id);
                this.build();
              } else this.poor();
            },
          };
        });
      } else if (this.tab === 1) {
        items = def.skins.map((sk, idx) => ({
          label: sk.name.toUpperCase(),
          color: sk.accent,
          skinIdx: idx,
          value: () => (equipped(s, fid).skin === idx ? 'EQUIPPED' : ownsSkin(s, fid, idx) ? 'OWNED' : `${sk.price}`),
          action: () => {
            if (!ownsSkin(s, fid, idx)) {
              if (!P.isUnlocked(fid)) return this.lockedMsg();
              if (!P.spend(sk.price)) return this.poor();
              (s.skins[fid] ||= []).push(idx);
              audio.sfx('unlock');
            }
            s.equipped[fid] = { ...equipped(s, fid), skin: idx };
            game.persist();
          },
        }));
      } else {
        items = Object.entries(HATS).map(([hid, h]) => ({
          label: h.name.toUpperCase(),
          hat: hid,
          value: () => (equipped(s, fid).hat === hid ? 'EQUIPPED' : s.hats.includes(hid) ? 'OWNED' : `${h.price}`),
          action: () => {
            if (!s.hats.includes(hid)) {
              if (!P.spend(h.price)) return this.poor();
              s.hats.push(hid);
              audio.sfx('unlock');
              P.achieve('hat');
            }
            s.equipped[fid] = { ...equipped(s, fid), hat: hid };
            game.persist();
          },
        }));
      }
      const prev = this.menu?.i || 0;
      this.menu = new ListMenu(items, { x: 60, y: 190, w: 420, h: 42, gap: 6, size: 19, maxVisible: 10, start: Math.min(prev, items.length - 1), onBack: () => game.go(new MainMenu(5)) });
      this.refreshPreview();
    }
    poor() {
      sfx('uiError');
      game.toasts.push('NOT ENOUGH COINS', 'Win fights and clear towers to earn more', '#ff5c5c', '✖');
    }
    lockedMsg() {
      sfx('uiError');
      game.toasts.push('FIGHTER LOCKED', 'Unlock this fighter first', '#ff5c5c', '✖');
    }
    refreshPreview() {
      const it = this.menu.current();
      const fid = this.tab === 0 ? it.fid : this.fid;
      const eq = equipped(S(), fid);
      const skin = this.tab === 1 ? it.skinIdx : eq.skin;
      const hat = this.tab === 2 ? it.hat : eq.hat;
      const key = `${fid}|${skin}|${hat}`;
      if (this.pkey !== key) {
        if (!this.preview || this.preview.id !== fid) this.preview = new FighterPreview(fid, { skin, hat, facing: -1 });
        else this.preview.setSkin(skin, hat);
        this.pkey = key;
      }
    }
    update(view) {
      super.update(view);
      if (menu.fired.tabL || menu.fired.tabR) {
        this.tab = (this.tab + (menu.fired.tabL ? 2 : 1)) % 3;
        this.menu = null;
        this.build();
        sfx('uiMove');
      }
      if (this.tab > 0 && (menu.fired.alt)) {
        // cycle fighter
        const ids = S().unlocked;
        this.fid = ids[(ids.indexOf(this.fid) + 1) % ids.length];
        this.build();
        sfx('uiMove');
      }
      // tab buttons via pointer
      for (let k = 0; k < 3; k++) {
        if (pointer.pressed && inRect(pointer.x, pointer.y, { x: 60 + k * 150, y: 120, w: 140, h: 44 })) {
          this.tab = k;
          this.menu = null;
          this.build();
          sfx('uiMove');
        }
      }
      if (this.tab > 0 && pointer.pressed && inRect(pointer.x, pointer.y, { x: view.w * 0.55, y: view.h - 120, w: 360, h: 50 })) {
        const ids = S().unlocked;
        this.fid = ids[(ids.indexOf(this.fid) + 1) % ids.length];
        this.build();
      }
      this.menu.update();
      this.refreshPreview();
      this.preview.update();
    }
    draw(ctx, view) {
      this.drawBG(ctx, view);
      title(ctx, 'LOCKER', 50, 60, { size: 54 });
      ['FIGHTERS', 'SKINS', 'HATS'].forEach((n, k) => {
        const x = 60 + k * 150;
        skewPanel(ctx, x, 120, 140, 44, 10);
        ctx.fillStyle = k === this.tab ? C.accent : 'rgba(12,10,24,0.8)';
        ctx.fill();
        ctx.strokeStyle = C.line;
        ctx.stroke();
        text(ctx, n, x + 70, 143, { size: 18, font: FONT_UI, color: k === this.tab ? '#0b0b12' : '#fff' });
      });
      this.menu.draw(ctx);
      const cx = view.w * 0.72;
      ctx.save();
      const g = ctx.createRadialGradient(cx, view.h * 0.55, 10, cx, view.h * 0.55, 280);
      g.addColorStop(0, rgba(this.preview.f.skin.accent, 0.3));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - 300, view.h * 0.15, 600, 520);
      ctx.restore();
      this.preview.draw(ctx, cx, view.h * 0.7, 1.7);
      const d = this.preview.f.def;
      text(ctx, d.name, cx, 150, { size: 46, font: FONT_BIG, color: '#fff', stroke: '#000', sw: 5 });
      text(ctx, d.title, cx, 184, { size: 18, font: FONT_BODY, color: d.skins[0].accent });
      if (this.tab === 0) {
        const it = this.menu.current();
        const dd = getFighter(it.fid);
        const tw = TOWERS.find((t) => t.reward === dd.id);
        wrapText(ctx, dd.bio, view.w * 0.55, view.h - 140, 420, 22, { size: 17, color: C.dim });
        if (!P.isUnlocked(dd.id) && tw) text(ctx, `Or unlock free: clear ${tw.name}`, view.w * 0.55, view.h - 60, { size: 15, font: FONT_UI, align: 'left', color: tw.color });
      } else {
        panel(ctx, view.w * 0.55, view.h - 120, 360, 50, { r: 10 });
        text(ctx, `FIGHTER: ${getFighter(this.fid).name}   (R / tap to switch)`, view.w * 0.55 + 180, view.h - 94, { size: 16, font: FONT_UI, color: '#fff' });
      }
      coins(ctx, view, S().coins);
      hints(ctx, view, [['Q/E', 'Tab'], ['ENTER', 'Buy / Equip'], ['ESC', 'Back']]);
    }
  }

  // -------------------------------------------------------------------------
  // Profile: stats + achievements
  // -------------------------------------------------------------------------
  class Profile extends MenuScene {
    constructor() {
      super();
      this.dim = 0.86;
      this.scroll = 0;
    }
    update(view) {
      super.update(view);
      const maxS = Math.max(0, ACHIEVEMENTS.length - 9);
      if (menu.fired.down || pointer.wheel > 0) this.scroll = Math.min(maxS, this.scroll + 1);
      if (menu.fired.up || pointer.wheel < 0) this.scroll = Math.max(0, this.scroll - 1);
      if (menu.fired.back || menu.fired.confirm) {
        sfx('uiBack');
        game.go(new MainMenu(6));
      }
      if (pointer.pressed && pointer.x < 120 && pointer.y < 120) game.go(new MainMenu(6));
    }
    draw(ctx, view) {
      this.drawBG(ctx, view);
      title(ctx, 'PROFILE', 50, 60, { size: 54 });
      const st = S().stats;
      const rows = [
        ['Matches played', st.matches], ['Wins', st.wins], ['Losses', st.losses], ['K.O.s', st.kos], ['Perfect rounds', st.perfects],
        ['Best combo', st.maxCombo], ['Parries', st.parries], ['Ultimates landed', st.ults], ['Breakers', st.breakers],
        ['Throws', st.throws], ['Total damage', formatNum(st.damage)], ['Tower floors', st.towerFloors], ['Survival best', `${st.survivalBest} waves`],
        ['Versus matches', st.versus], ['Fighters', `${S().unlocked.length}/${FIGHTER_DEFS.length}`],
      ];
      panel(ctx, 50, 120, 420, rows.length * 32 + 30, {});
      rows.forEach(([n, v], i) => {
        text(ctx, n, 74, 150 + i * 32, { size: 18, font: FONT_BODY, align: 'left', color: C.dim });
        text(ctx, String(v), 446, 150 + i * 32, { size: 18, font: FONT_UI, align: 'right', color: '#fff' });
      });
      const ax = 500, aw = view.w - ax - 50;
      const done = Object.keys(S().ach).length;
      text(ctx, `ACHIEVEMENTS ${done}/${ACHIEVEMENTS.length}`, ax, 136, { size: 20, font: FONT_UI, align: 'left', color: C.accent });
      ACHIEVEMENTS.slice(this.scroll, this.scroll + 9).forEach((a, i) => {
        const y = 160 + i * 58;
        const got = !!S().ach[a.id];
        panel(ctx, ax, y, aw, 50, { stroke: got ? 'rgba(255,210,63,0.6)' : C.line, r: 10, fill: got ? 'rgba(40,32,10,0.9)' : 'rgba(10,9,20,0.86)' });
        text(ctx, got ? '★' : '☆', ax + 26, y + 26, { size: 24, color: got ? C.accent : 'rgba(255,255,255,0.3)' });
        text(ctx, a.name, ax + 52, y + 17, { size: 17, font: FONT_UI, align: 'left', color: got ? '#fff' : 'rgba(255,255,255,0.6)' });
        text(ctx, a.desc, ax + 52, y + 36, { size: 15, font: FONT_BODY, align: 'left', color: C.dim });
        text(ctx, `+${a.coins}`, ax + aw - 20, y + 26, { size: 16, font: FONT_UI, align: 'right', color: got ? C.accent : 'rgba(255,255,255,0.4)' });
      });
      hints(ctx, view, [['↑↓', 'Scroll'], ['ESC', 'Back']]);
    }
  }

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------
  class Settings extends MenuScene {
    constructor() {
      super();
      this.dim = 0.86;
      const st = settings();
      const vol = (k) => ({
        value: () => `${Math.round(st[k] * 100)}%`,
        left: () => this.setVol(k, Math.max(0, st[k] - 0.1)),
        right: () => this.setVol(k, Math.min(1, st[k] + 0.1)),
      });
      const toggle = (k, on = 'ON', off = 'OFF') => ({ value: () => (st[k] ? on : off), left: () => this.set(k, !st[k]), right: () => this.set(k, !st[k]) });
      const cycle = (k, vals, labels) => ({
        value: () => labels[Math.max(0, vals.indexOf(st[k]))],
        left: () => this.set(k, vals[(vals.indexOf(st[k]) - 1 + vals.length) % vals.length]),
        right: () => this.set(k, vals[(vals.indexOf(st[k]) + 1) % vals.length]),
      });
      const items = [
        { label: 'MASTER VOLUME', ...vol('master') },
        { label: 'MUSIC', ...vol('music') },
        { label: 'SOUND EFFECTS', ...vol('sfx') },
        { label: 'SCREEN SHAKE', ...cycle('shake', [0, 0.5, 1], ['OFF', 'LOW', 'FULL']) },
        { label: 'SCREEN FLASHES', ...toggle('flashes', 'ON', 'REDUCED') },
        { label: 'DAMAGE NUMBERS', ...toggle('damageNumbers') },
        { label: 'GRAPHICS', ...cycle('quality', ['high', 'low'], ['HIGH', 'PERFORMANCE']), note: 'applies to the next fight' },
        { label: 'TOUCH CONTROLS', ...cycle('touch', ['auto', 'on', 'off'], ['AUTO', 'ALWAYS', 'OFF']) },
        { label: 'FULLSCREEN', action: () => toggleFullscreen() },
        { label: 'CONTROLS', action: () => game.go(new Controls()) },
        { label: 'RESET PROGRESS', color: '#ff5c5c', action: () => (this.confirm = { t: 0 }) },
      ];
      this.menu = new ListMenu(items, { x: 60, y: 140, w: 560, h: 44, gap: 7, size: 20, onBack: () => game.go(new MainMenu(8)) });
    }
    set(k, v) {
      settings()[k] = v;
      game.persist();
    }
    setVol(k, v) {
      this.set(k, Math.round(v * 10) / 10);
      const st = settings();
      audio.setVolumes({ master: st.master, music: st.music, sfx: st.sfx });
    }
    update(view) {
      super.update(view);
      if (this.confirm) {
        this.confirm.t++;
        if (keyPressedThisFrame('KeyY') || (pointer.pressed && pointer.x > view.w / 2 - 200 && pointer.x < view.w / 2 - 10 && pointer.y > view.h / 2 + 20 && pointer.y < view.h / 2 + 70)) {
          const fresh = resetSave();
          for (const k of Object.keys(game.save)) delete game.save[k];
          Object.assign(game.save, fresh);
          persist(game.save);
          game.toasts.push('PROGRESS RESET', 'A fresh start.', '#ff5c5c', '↺');
          this.confirm = null;
          game.go(new MainMenu());
        } else if (menu.fired.back || keyPressedThisFrame('KeyN') || (pointer.pressed && this.confirm.t > 5)) {
          this.confirm = null;
          sfx('uiBack');
        }
        return;
      }
      this.menu.update();
    }
    draw(ctx, view) {
      this.drawBG(ctx, view);
      title(ctx, 'SETTINGS', 50, 60, { size: 54 });
      this.menu.draw(ctx);
      const x = view.w * 0.58;
      panel(ctx, x, 140, view.w - x - 50, 230, {});
      text(ctx, 'ACCESSIBILITY', x + 24, 172, { size: 18, font: FONT_UI, align: 'left', color: C.accent });
      wrapText(ctx, 'Turn off screen shake and reduce flashes if fast motion bothers you. Performance mode halves particles for older devices. Every control can be rebound under CONTROLS.', x + 24, 194, view.w - x - 98, 24, { size: 17, color: '#fff' });
      if (this.confirm) {
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fillRect(0, 0, view.w, view.h);
        panel(ctx, view.w / 2 - 260, view.h / 2 - 110, 520, 200, { stroke: '#ff5c5c' });
        text(ctx, 'RESET ALL PROGRESS?', view.w / 2, view.h / 2 - 60, { size: 30, font: FONT_BIG, color: '#ff5c5c' });
        text(ctx, 'Coins, unlocks, towers and achievements will be erased.', view.w / 2, view.h / 2 - 22, { size: 17, font: FONT_BODY, color: '#fff' });
        panel(ctx, view.w / 2 - 200, view.h / 2 + 20, 190, 50, { fill: 'rgba(120,20,30,0.9)', r: 10 });
        text(ctx, '[Y] RESET', view.w / 2 - 105, view.h / 2 + 46, { size: 18, font: FONT_UI, color: '#fff' });
        panel(ctx, view.w / 2 + 10, view.h / 2 + 20, 190, 50, { r: 10 });
        text(ctx, '[N] CANCEL', view.w / 2 + 105, view.h / 2 + 46, { size: 18, font: FONT_UI, color: '#fff' });
      }
      hints(ctx, view, [['↑↓', 'Option'], ['←→', 'Change'], ['ESC', 'Back']]);
    }
  }

  function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
      else document.exitFullscreen?.();
    } catch (e) {
      /* not supported */
    }
  }

  // -------------------------------------------------------------------------
  // Controls: view and rebind keys
  // -------------------------------------------------------------------------
  const ACTION_NAMES = { left: 'LEFT', right: 'RIGHT', up: 'JUMP', down: 'BLOCK / DOWN', atk: 'ATTACK', spc: 'SPECIAL', ult: 'ULTIMATE', dash: 'DASH', grab: 'GRAB / BREAKER' };
  class Controls extends MenuScene {
    constructor() {
      super();
      this.dim = 0.88;
      this.col = 0;
      this.row = 0;
      this.wait = false;
      this.cols = ['solo', 'p1', 'p2'];
    }
    binds() {
      if (!S().bindings) S().bindings = JSON.parse(JSON.stringify(DEFAULT_BINDINGS));
      return S().bindings;
    }
    update(view) {
      super.update(view);
      const rows = ACTIONS.length + 1;
      if (this.wait) {
        if (wasAnyKeyPressed() && lastKey()) {
          const code = lastKey();
          if (code !== 'Escape') {
            const b = this.binds()[this.cols[this.col]];
            const act = ACTIONS[this.row];
            b[act] = [code, ...b[act].filter((c) => c !== code).slice(0, 1)];
            game.persist();
            sfx('uiSelect');
          } else sfx('uiBack');
          this.wait = false;
        }
        return;
      }
      if (menu.fired.up) this.row = (this.row - 1 + rows) % rows;
      if (menu.fired.down) this.row = (this.row + 1) % rows;
      if (menu.fired.left) this.col = (this.col + 2) % 3;
      if (menu.fired.right) this.col = (this.col + 1) % 3;
      if (menu.fired.up || menu.fired.down || menu.fired.left || menu.fired.right) sfx('uiMove');
      if (menu.fired.confirm) {
        if (this.row === ACTIONS.length) {
          S().bindings = null;
          game.persist();
          sfx('uiSelect');
          game.toasts.push('CONTROLS RESET', 'Default key bindings restored', '#4ab8ff', '↺');
        } else {
          this.wait = true;
          sfx('uiSelect');
        }
      } else if (menu.fired.back) {
        sfx('uiBack');
        game.go(new Settings());
      }
      // pointer
      const L = this.layout(view);
      if (pointer.pressed) {
        for (let r = 0; r < ACTIONS.length; r++)
          for (let c = 0; c < 3; c++) {
            if (inRect(pointer.x, pointer.y, { x: L.x0 + 200 + c * L.cw, y: L.y0 + r * 40 - 16, w: L.cw - 10, h: 34 })) {
              this.row = r;
              this.col = c;
              this.wait = true;
            }
          }
        if (inRect(pointer.x, pointer.y, { x: L.x0, y: L.y0 + ACTIONS.length * 40, w: 300, h: 40 })) {
          S().bindings = null;
          game.persist();
        }
      }
    }
    layout(view) {
      return { x0: 60, y0: 170, cw: Math.min(200, (view.w - 700) / 3) };
    }
    draw(ctx, view) {
      this.drawBG(ctx, view);
      title(ctx, 'CONTROLS', 50, 60, { size: 54 });
      const L = this.layout(view);
      const b = S().bindings || DEFAULT_BINDINGS;
      ['SOLO / VS CPU', 'VERSUS P1', 'VERSUS P2'].forEach((n, c) => text(ctx, n, L.x0 + 200 + c * L.cw + (L.cw - 10) / 2, L.y0 - 34, { size: 15, font: FONT_UI, color: c === this.col ? C.accent : C.dim }));
      ACTIONS.forEach((a, r) => {
        const y = L.y0 + r * 40;
        text(ctx, ACTION_NAMES[a], L.x0, y, { size: 17, font: FONT_UI, align: 'left', color: '#fff' });
        this.cols.forEach((col, c) => {
          const sel = r === this.row && c === this.col;
          const keys = (b[col][a] || []).slice(0, 2).map(keyLabel).join(' / ');
          panel(ctx, L.x0 + 200 + c * L.cw, y - 16, L.cw - 10, 32, { r: 6, stroke: sel ? C.accent : C.line, fill: sel ? 'rgba(60,50,10,0.9)' : 'rgba(10,9,20,0.8)' });
          text(ctx, sel && this.wait ? 'press a key…' : keys, L.x0 + 200 + c * L.cw + (L.cw - 10) / 2, y, { size: 15, font: FONT_UI, color: sel ? C.accent : '#fff' });
        });
      });
      const ry = L.y0 + ACTIONS.length * 40;
      text(ctx, 'RESET TO DEFAULTS', L.x0, ry + 4, { size: 17, font: FONT_UI, align: 'left', color: this.row === ACTIONS.length ? C.accent : '#ff8a8a' });
      const gx = L.x0 + 200 + 3 * L.cw + 20;
      if (gx + 260 < view.w) {
        panel(ctx, gx, L.y0 - 30, view.w - gx - 40, 330, {});
        text(ctx, 'GAMEPAD', gx + 20, L.y0 - 4, { size: 17, font: FONT_UI, align: 'left', color: C.accent });
        const pad = [['Stick / D-pad', 'Move, down = block'], ['A', 'Jump'], ['X', 'Attack'], ['Y', 'Special'], ['B / RB', 'Dash'], ['LB', 'Grab / Breaker'], ['LT / RT', 'Ultimate'], ['START', 'Pause']];
        pad.forEach(([k, v], i) => {
          text(ctx, k, gx + 20, L.y0 + 26 + i * 30, { size: 15, font: FONT_UI, align: 'left', color: '#fff' });
          text(ctx, v, gx + 150, L.y0 + 26 + i * 30, { size: 15, font: FONT_BODY, align: 'left', color: C.dim });
        });
      }
      hints(ctx, view, [['ENTER', 'Rebind'], ['ESC', 'Back']]);
    }
  }

  // -------------------------------------------------------------------------
  // How to play
  // -------------------------------------------------------------------------
  const PAGES = [
    {
      t: 'CONTROLS',
      rows: [
        ['Move', 'A / D  or  ← →'], ['Jump (double jump in the air)', 'W  or  ↑'], ['Block (hold) · Parry (tap just before a hit)', 'S  or  ↓'],
        ['Attack', 'J  or  Z'], ['Special', 'K  or  X'], ['Ultimate (full power bar)', 'L  or  C'], ['Dash (or double-tap a direction)', 'SPACE / SHIFT'],
        ['Throw · Breaker', 'J + K together  (or U)'], ['Pause', 'ESC / P'],
        ['Versus P1', 'WASD · F attack · G special · H ult · SPACE dash · R grab'], ['Versus P2', 'Arrows · K attack · L special · ; ult · J dash · I grab'],
      ],
    },
    {
      t: 'ATTACKING',
      rows: [
        ['Chain', 'Press ATTACK up to 4 times for a string that ends in a wall-splatting finisher.'],
        ['Rhythm bonus', 'Press the next ATTACK inside the window (not mashed early) for +12% damage — look for the gold ring.'],
        ['Launcher', 'DOWN + ATTACK knocks them skyward. Press JUMP right after it hits to chase them.'],
        ['Air combo', 'ATTACK, ATTACK in the air. The second hit spikes them down for a ground bounce.'],
        ['Power strike', 'BACK + ATTACK: slow, huge damage, smashes them into the wall.'],
        ['Specials', 'SPECIAL, BACK + SPECIAL, DOWN + SPECIAL and SPECIAL in the air. Cancel a landed hit into any of them!'],
        ['Ultimate', 'Fill the power bar by fighting. Press ULT (or cancel a hit into it) for a cinematic finisher.'],
      ],
    },
    {
      t: 'DEFENSE',
      rows: [
        ['Block', 'Hold DOWN. Blocking drains stamina — run dry and your guard breaks!'],
        ['Parry', 'Tap DOWN a split-second before a hit lands. No damage, the attacker is stunned, you gain power. Parried projectiles fly back!'],
        ['Cross-ups', 'You can\'t turn around while blocking. Jumping over a blocking opponent beats their guard.'],
        ['Breaker', 'Getting comboed? Press ATTACK + SPECIAL with half a power bar to blast free.'],
        ['Air recovery', 'When launched, press JUMP once hitstun ends to flip back to safety.'],
        ['Throw escape', 'Press ATTACK + SPECIAL right as you get grabbed.'],
        ['Throws', 'Throws beat blocking. Hold BACK while throwing to toss them behind you.'],
      ],
    },
    {
      t: 'MOVEMENT & STAMINA',
      rows: [
        ['Dash', 'Double-tap or press DASH. Keep holding forward to run. Back-dash is briefly invincible.'],
        ['Air moves', 'Double jump, air dash, fast-fall (hold DOWN) and wall jump (jump into the wall).'],
        ['Stamina', 'The green bar under your health. Attacks, dashes and blocks drain it. At zero you are TIRED: no dashes or specials.'],
        ['Power', 'Bottom bar. Half bar = one Breaker. Full bar = Ultimate.'],
        ['Juggles', 'Damage and hitstun shrink the longer a combo lasts — finish strong!'],
      ],
    },
    {
      t: 'PRO TIPS',
      rows: [
        ['Hit-confirm', 'Jab, jab — only continue into specials if the first hits connected.'],
        ['Counter hits', 'Interrupting an attack in its startup deals +20% and extra stun.'],
        ['Punish', 'Whiffed a big move? Punishing during recovery deals bonus damage.'],
        ['Zoning', 'Projectile fighters (KAI, IGNIS, UNIT-7) win at range — rushdown fighters (VOLT, NYX) want you cornered.'],
        ['Training', 'Use TRAINING with hitboxes on to learn exactly how far each move reaches.'],
        ['Towers', 'Read the modifiers before each floor — Low Gravity means juggle heaven, Toxic Air means play fast.'],
      ],
    },
  ];
  class HowTo extends MenuScene {
    constructor() {
      super();
      this.dim = 0.88;
      this.page = 0;
    }
    update(view) {
      super.update(view);
      if (menu.fired.left || (pointer.pressed && pointer.x < view.w * 0.2)) this.flip(-1);
      if (menu.fired.right || menu.fired.confirm || (pointer.pressed && pointer.x > view.w * 0.8)) this.flip(1);
      if (menu.fired.back) {
        sfx('uiBack');
        game.go(new MainMenu(7));
      }
    }
    flip(d) {
      const n = this.page + d;
      if (n < 0) return;
      if (n >= PAGES.length) {
        game.go(new MainMenu(7));
        return;
      }
      this.page = n;
      sfx('uiMove');
    }
    draw(ctx, view) {
      this.drawBG(ctx, view);
      const pg = PAGES[this.page];
      title(ctx, 'HOW TO PLAY', 50, 60, { size: 54 });
      text(ctx, `${this.page + 1}/${PAGES.length}  ${pg.t}`, view.w - 50, 60, { size: 26, font: FONT_UI, align: 'right', color: C.accent });
      panel(ctx, 50, 120, view.w - 100, view.h - 190, {});
      let y = 150;
      const keyW = Math.min(420, view.w * 0.34);
      for (const [k, v] of pg.rows) {
        text(ctx, k, 80, y + 10, { size: 19, font: FONT_UI, align: 'left', color: '#fff', base: 'top' });
        const ny = wrapText(ctx, v, 80 + keyW, y + 12, view.w - 200 - keyW, 24, { size: 19, color: C.dim });
        y = Math.max(y + 42, ny + 10);
      }
      hints(ctx, view, [['←→', 'Page'], ['ESC', 'Back']]);
    }
  }

  // -------------------------------------------------------------------------
  // Debug / automated-test entry: ?fight=p1,p2,arena&cpu=1&lvl=2
  // -------------------------------------------------------------------------
  function initial() {
    const q = new URLSearchParams(location.search);
    if (q.get('fight')) {
      const [a = 'kai', b = 'rosa', arena = 'dojo'] = q.get('fight').split(',');
      const lvl = Number(q.get('lvl') ?? 2);
      const cfg = {
        mode: q.get('mode') || 'arcade',
        p1: { id: a, ctrl: q.get('cpu') ? 'cpu' : 'solo', level: lvl },
        p2: { id: b, ctrl: 'cpu', level: lvl, dummy: q.get('dummy') || undefined },
        arena, rounds: 2, time: 99, labels: ['YOU', 'CPU'], intro: !q.get('nointro'),
      };
      const fight = () => new FightScene(cfg, { onEnd: () => game.go(fight()), humanSides: [!q.get('cpu'), false] });
      return fight();
    }
    if (q.get('scene')) {
      const map = {
        menu: () => new MainMenu(), towers: () => new TowerSelect(), locker: () => new Locker(), profile: () => new Profile(),
        settings: () => new Settings(), howto: () => new HowTo(), controls: () => new Controls(),
        select: () => new CharSelect({ steps: [{ who: 'p1', label: 'YOU' }, { who: 'cpu', label: 'CPU', allowLocked: true }], titleStr: 'QUICK FIGHT', onDone: () => {}, onBack: () => {} }),
        versus: () => new CharSelect({ steps: [{ who: 'p1', label: 'P1' }, { who: 'p2', label: 'P2' }], simultaneous: true, titleStr: 'VERSUS', onDone: () => {}, onBack: () => {} }),
        towermap: () => new TowerMap(0, { id: 'kai', skin: 0, hat: 'none' }),
        setup: () => {
          const s = new Setup({ kind: 'quick', picks: [{ id: 'kai', skin: 0 }, { id: 'rosa', skin: 0 }], onBack: () => {} });
          s.onFight = () => {};
          return s;
        },
      };
      if (map[q.get('scene')]) return map[q.get('scene')]();
    }
    return new TitleScene();
  }

  return { initial, MainMenu, TitleScene };
}
