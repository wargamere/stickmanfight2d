// Boot, canvas scaling, fixed-timestep loop and scene management.

import { initInput, updateInputs, endInputFrame, setPointerMapper, pointer } from './input.js';
import { audio } from './audio.js';
import { loadSave, persist } from './save.js';
import { createScenes } from './scenes.js';
import { initTouch, drawTouch } from './touch.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });

export const view = { w: 1280, h: 720, scale: 1, ox: 0, oy: 0, dpr: 1, cw: 0, ch: 0 };

let maxPixels = 2560 * 1440;
function resize() {
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  // cap the backing store so huge/retina screens don't melt weaker GPUs
  while (dpr > 0.5 && window.innerWidth * window.innerHeight * dpr * dpr > maxPixels) dpr *= 0.9;
  const cw = Math.floor(window.innerWidth * dpr);
  const ch = Math.floor(window.innerHeight * dpr);
  canvas.width = cw;
  canvas.height = ch;
  view.dpr = dpr;
  view.cw = cw;
  view.ch = ch;
  const aspect = cw / ch;
  view.h = 720;
  view.w = Math.round(Math.min(1710, Math.max(960, 720 * aspect)));
  view.scale = Math.min(cw / view.w, ch / view.h);
  view.ox = (cw - view.w * view.scale) / 2;
  view.oy = (ch - view.h * view.scale) / 2;
}
window.addEventListener('resize', resize);
resize();
setPointerMapper((cx, cy) => [((cx * view.dpr) - view.ox) / view.scale, ((cy * view.dpr) - view.oy) / view.scale]);
initInput(canvas);

// ---------------------------------------------------------------------------
// Game object shared by scenes
// ---------------------------------------------------------------------------
const save = loadSave();
if (save.settings.quality === 'low') {
  maxPixels = 1280 * 720;
  resize();
}
audio.setVolumes({ master: save.settings.master, music: save.settings.music, sfx: save.settings.sfx });

const game = {
  view,
  save,
  canvas,
  scene: null,
  next: null,
  fade: 0,
  fadeDir: 0,
  time: 0,
  controllers: [],
  persist: () => persist(save),
  go(scene, instant = false) {
    if (instant || !this.scene) {
      this.scene?.exit?.();
      this.scene = scene;
      scene.enter?.();
      this.fade = 1;
      this.fadeDir = -1;
      return;
    }
    this.next = scene;
    this.fadeDir = 1;
  },
};
game.scenes = createScenes(game);
initTouch(canvas, game);

// unlock audio on first interaction
const unlock = () => {
  audio.unlock();
};
window.addEventListener('pointerdown', unlock, { passive: true });
window.addEventListener('keydown', unlock);

// ---------------------------------------------------------------------------
// Fixed-timestep loop (60 Hz simulation)
// ---------------------------------------------------------------------------
const STEP = 1000 / 60;
let last = performance.now();
let acc = 0;

function tick() {
  game.time++;
  updateInputs(game.scene?.controllers?.() || []);
  if (game.fadeDir > 0) {
    game.fade += 0.12;
    if (game.fade >= 1) {
      game.fade = 1;
      game.scene?.exit?.();
      game.scene = game.next;
      game.next = null;
      game.scene?.enter?.();
      game.fadeDir = -1;
    }
  } else if (game.fadeDir < 0) {
    game.fade -= 0.08;
    if (game.fade <= 0) {
      game.fade = 0;
      game.fadeDir = 0;
    }
  }
  if (game.scene && game.fadeDir <= 0) game.scene.update(view);
  game.toasts?.update();
  endInputFrame();
}

function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#07060d';
  ctx.fillRect(0, 0, view.cw, view.ch);
  ctx.setTransform(view.scale, 0, 0, view.scale, view.ox, view.oy);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, view.w, view.h);
  ctx.clip();
  if (game.scene) game.scene.draw(ctx, view);
  drawTouch(ctx, view, game);
  if (game.fade > 0) {
    ctx.fillStyle = `rgba(7,6,13,${game.fade})`;
    ctx.fillRect(0, 0, view.w, view.h);
  }
  game.toasts?.draw(ctx, view);
  ctx.restore();
}

// Auto performance mode: if the browser can't hold ~40fps for a few seconds
// during play, drop to performance mode once.
let slowFrames = 0;
function watchPerformance(dt) {
  if (save.settings.quality !== 'high' || save.settings.autoPerfDone) return;
  if (!game.scene || !game.scene.wantsTouch) return; // only judge during fights
  slowFrames = dt > 25 ? slowFrames + 1 : Math.max(0, slowFrames - 2);
  if (slowFrames > 150) {
    save.settings.quality = 'low';
    save.settings.autoPerfDone = true;
    persist(save);
    maxPixels = 1280 * 720;
    resize();
    game.toasts?.push('PERFORMANCE MODE', 'Lowered effects for a smoother framerate (Settings → Graphics)', '#4ab8ff', '⚡');
  }
}

function frame(now) {
  let dt = now - last;
  last = now;
  watchPerformance(dt);
  if (dt > 250) dt = 250;
  acc += dt;
  let n = 0;
  while (acc >= STEP && n < 5) {
    tick();
    acc -= STEP;
    n++;
  }
  if (n === 5) acc = 0;
  draw();
  requestAnimationFrame(frame);
}

async function boot() {
  try {
    if (document.fonts && document.fonts.load) {
      await Promise.race([
        Promise.all([
          document.fonts.load('40px "Bangers"'),
          document.fonts.load('20px "Russo One"'),
          document.fonts.load('20px "Rajdhani"'),
        ]),
        new Promise((r) => setTimeout(r, 1500)),
      ]);
    }
  } catch (e) {
    /* fonts are optional */
  }
  const bootEl = document.getElementById('boot');
  if (bootEl) {
    bootEl.style.opacity = '0';
    setTimeout(() => bootEl.remove(), 400);
  }
  game.go(game.scenes.initial(), true);
  canvas.focus();
  requestAnimationFrame(frame);
}
boot();

// debugging / automated tests
window.__game = game;
window.__view = view;
window.__pointer = pointer;
