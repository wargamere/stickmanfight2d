// End-to-end smoke tests in headless Chromium (Playwright).
//   npm run test:e2e
// Boots the game, drives real keyboard input through a fight, simulates
// full CPU-vs-CPU matches for every fighter and renders every menu screen.

import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  const { execSync } = await import('node:child_process');
  const globalRoot = execSync('npm root -g').toString().trim();
  ({ chromium } = require(join(globalRoot, 'playwright')));
}

const port = 8000 + Math.floor(Math.random() * 900);
const server = spawn(process.execPath, [join(root, 'scripts/serve.mjs'), root], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const base = `http://localhost:${port}/`;

const results = [];
const check = (name, ok, info = '') => {
  results.push({ name, ok, info });
  console.log(`${ok ? '✔' : '✘'} ${name}${info ? '  — ' + info : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

const frames = (n) => page.waitForTimeout(Math.round(n * 16.7));
async function tap(key, hold = 3) {
  await page.keyboard.down(key);
  await frames(hold);
  await page.keyboard.up(key);
}

try {
  // ---------------------------------------------------------------- boot
  await page.goto(base);
  await page.waitForTimeout(1500);
  const scene0 = await page.evaluate(() => window.__game.scene.constructor.name);
  check('boots to title screen', scene0 === 'TitleScene', scene0);
  await tap('Enter');
  await page.waitForTimeout(800);
  const scene1 = await page.evaluate(() => window.__game.scene.constructor.name);
  check('any key opens main menu', scene1 === 'MainMenu', scene1);

  // ---------------------------------------------------------------- input-driven fight
  await page.goto(base + '?fight=kai,rosa,lab&dummy=stand&nointro=1');
  await page.waitForFunction(() => window.__game?.scene?.match?.phase === 'fight', null, { timeout: 8000 });
  await page.evaluate(() => {
    const f = window.__game.scene.match.f[0];
    const orig = f.startMove.bind(f);
    window.__moves = [];
    f.startMove = (id, o) => {
      const ok = orig(id, o);
      if (ok) window.__moves.push(typeof id === 'string' ? id : id.id);
      return ok;
    };
    window.__game.scene.match.world.infiniteStamina = [true, true];
  });
  const moves = () => page.evaluate(() => window.__moves.slice());
  const reset = () => page.evaluate(() => (window.__moves.length = 0));
  const approach = async () => {
    await page.keyboard.down('KeyD');
    for (let i = 0; i < 60; i++) {
      const d = await page.evaluate(() => { const [a, b] = window.__game.scene.match.f; return b.x - a.x; });
      if (d < 95) break;
      await frames(2);
    }
    await page.keyboard.up('KeyD');
    await frames(20);
  };

  await approach();
  await reset();
  for (let i = 0; i < 4; i++) {
    await tap('KeyJ', 2);
    await frames(10);
  }
  await frames(40);
  let m = await moves();
  check('4-hit attack chain (J J J J)', ['L1', 'L2', 'L3', 'L4'].every((x) => m.includes(x)), m.join(','));

  await approach();
  await reset();
  const hp0 = await page.evaluate(() => window.__game.scene.match.f[1].hp);
  await page.keyboard.down('KeyS');
  await frames(2);
  await tap('KeyJ', 2);
  await page.keyboard.up('KeyS');
  await frames(10);
  await tap('KeyW', 3);
  await frames(14);
  await tap('KeyJ', 2);
  await frames(10);
  await tap('KeyJ', 2);
  await frames(60);
  m = await moves();
  const hp1 = await page.evaluate(() => window.__game.scene.match.f[1].hp);
  check('launcher → jump cancel → air combo', m.includes('LAUNCH') && m.includes('AIR1'), `${m.join(',')} dmg=${Math.round(hp0 - hp1)}`);

  await frames(60);
  await reset();
  await tap('KeyK', 2);
  let ents = 0;
  for (let i = 0; i < 15; i++) {
    await frames(2);
    ents = Math.max(ents, await page.evaluate(() => window.__game.scene.match.world.ents.length));
  }
  m = await moves();
  check('special fires a projectile (K)', m.includes('S1') && ents > 0, m.join(','));

  await frames(60);
  await approach();
  await reset();
  await page.keyboard.down('KeyJ');
  await page.keyboard.down('KeyK');
  await frames(3);
  await page.keyboard.up('KeyJ');
  await page.keyboard.up('KeyK');
  await frames(40);
  const thrown = await page.evaluate(() => window.__game.scene.match.f[0].stats.throws);
  const tinfo = await page.evaluate(() => { const [a, b] = window.__game.scene.match.f; return `dist=${Math.round(b.x - a.x)} dummy=${b.state}`; });
  check('throw (J + K together)', thrown > 0, `throws=${thrown} ${tinfo} moves=${(await moves()).join(',')}`);

  await frames(80);
  await page.evaluate(() => (window.__game.scene.match.f[0].meter = 100));
  await approach();
  await reset();
  await tap('KeyL', 2);
  await frames(200);
  const ults = await page.evaluate(() => window.__game.scene.match.f[0].stats.ults);
  check('ultimate (L with full power)', ults > 0, `ults=${ults}`);

  await tap('Escape', 2);
  await frames(10);
  const paused = await page.evaluate(() => !!window.__game.scene.pause);
  check('ESC pauses the fight', paused);

  // ---------------------------------------------------------------- full CPU matches
  const sims = await page.evaluate(async () => {
    const { Match } = await import('/src/match.js');
    const { FIGHTER_DEFS } = await import('/src/roster.js');
    const ids = FIGHTER_DEFS.map((d) => d.id);
    const out = [];
    for (let i = 0; i < ids.length; i++) {
      const a = ids[i], b = ids[(i + 5) % ids.length];
      try {
        const m = new Match({ mode: 'demo', p1: { id: a, ctrl: 'cpu', level: 3 }, p2: { id: b, ctrl: 'cpu', level: 3 }, arena: 'dojo', rounds: 2, time: 99, onEnd: () => {} });
        let n = 0;
        while (!m.result && n < 60 * 60 * 8) {
          m.update(window.__view);
          n++;
        }
        const c = document.createElement('canvas');
        c.width = 1280;
        c.height = 720;
        m.draw(c.getContext('2d'), window.__view);
        out.push({ a, b, ok: !!m.result, n, ults: m.f.map((f) => f.stats.ults) });
      } catch (e) {
        out.push({ a, b, ok: false, err: e.message });
      }
    }
    return out;
  });
  for (const s of sims) check(`CPU match ${s.a} vs ${s.b} completes`, s.ok, s.err || `${s.n} frames`);

  // ---------------------------------------------------------------- every screen renders
  for (const sc of ['menu', 'select', 'versus', 'setup', 'towers', 'towermap', 'locker', 'profile', 'settings', 'controls', 'howto']) {
    const before = errors.length;
    await page.goto(base + '?scene=' + sc);
    await page.waitForTimeout(900);
    check(`screen "${sc}" renders`, errors.length === before);
  }
} catch (e) {
  check('e2e run', false, e.message);
}

check('no runtime errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close();
server.kill();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
