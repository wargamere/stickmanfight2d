// Unit tests for pure game logic and data integrity: `npm test`
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { segSegDist, capsuleHit, clamp, makeRng, readable, luminance } from '../src/util.js';
import { solvePose, makePose, lerpPose, BONES } from '../src/skeleton.js';
import { POSES } from '../src/poses.js';
import { FIST_SET, ARMED_SET } from '../src/moves.js';
import { FIGHTER_DEFS, getFighter, allFighters, STARTERS } from '../src/roster.js';
import { TOWERS, MODS, buildMods, ACHIEVEMENTS } from '../src/modes.js';
import { aiParams, AI_LEVELS } from '../src/ai.js';
import { Controller } from '../src/input.js';
import { defaultSave } from '../src/save.js';
import { ARENAS } from '../src/arenas.js';
import { sampleKeys, Fighter } from '../src/fighter.js';

test('segment distance and capsule overlap', () => {
  assert.equal(segSegDist(0, 0, 10, 0, 0, 5, 10, 5).d, 5);
  assert.ok(Math.abs(segSegDist(0, 0, 10, 0, 5, -5, 5, 5).d) < 1e-9); // crossing
  assert.ok(capsuleHit({ ax: 0, ay: 0, bx: 10, by: 0, r: 3 }, { ax: 0, ay: 5, bx: 10, by: 5, r: 3 }));
  assert.equal(capsuleHit({ ax: 0, ay: 0, bx: 10, by: 0, r: 2 }, { ax: 0, ay: 5, bx: 10, by: 5, r: 2 }), null);
});

test('seeded RNG is deterministic', () => {
  const a = makeRng(42), b = makeRng(42);
  for (let i = 0; i < 20; i++) assert.equal(a(), b());
  assert.ok(clamp(5, 0, 3) === 3 && clamp(-1, 0, 3) === 0);
});

test('readable() lightens dark accents', () => {
  assert.ok(luminance(readable('#1a1028')) > luminance('#1a1028'));
  assert.equal(readable('#ffd23f'), '#ffd23f');
});

test('IK keeps bone lengths and plants feet', () => {
  const J = solvePose(POSES.stance, 0, 0, 1, 1, null, {});
  const len = (a, b) => Math.hypot(J[a + 'X'] - J[b + 'X'], J[a + 'Y'] - J[b + 'Y']);
  assert.ok(Math.abs(len('hip', 'kneeF') - BONES.thigh) < 0.01);
  assert.ok(Math.abs(len('kneeF', 'footF') - BONES.shin) < 0.01);
  assert.ok(Math.abs(len('neck', 'elbowF') - BONES.uarm) < 0.01);
  assert.ok(Math.abs(J.footFY) < 0.5 && Math.abs(J.footBY) < 0.5, 'feet on the ground');
  // facing flips x
  const M = solvePose(POSES.stance, 0, 0, -1, 1, null, {});
  assert.ok(Math.abs(M.handFX + J.handFX) < 1e-6);
});

test('every pose solves to finite joints', () => {
  for (const [name, p] of Object.entries(POSES)) {
    const J = solvePose(p, 0, 0, 1, 1, { kind: 'katana', len: 70 }, {});
    for (const [k, v] of Object.entries(J)) if (typeof v === 'number') assert.ok(Number.isFinite(v), `${name}.${k}`);
  }
  const mid = lerpPose(POSES.stance, POSES.jab, 0.5, makePose());
  assert.ok(mid.hf[0] > POSES.stance.hf[0] && mid.hf[0] < POSES.jab.hf[0]);
});

function checkMove(id, m, where) {
  assert.ok(m.dur > 0, `${where}.${id} dur`);
  let last = -1;
  for (const k of m.keys) {
    assert.ok(k[0] > last || (k[0] === 0 && last === -1), `${where}.${id} keyframes increasing`);
    last = k[0];
    if (typeof k[1] === 'string') assert.ok(POSES[k[1]], `${where}.${id} pose ${k[1]}`);
  }
  for (const h of m.hits || []) {
    assert.ok(h.f[0] <= h.f[1], `${where}.${id} hit window`);
    assert.ok(h.dmg > 0, `${where}.${id} damage`);
    assert.ok(h.a || h.area, `${where}.${id} hitbox shape`);
  }
  if (m.chain) assert.ok(m.chain.at < m.dur, `${where}.${id} chain opens before end`);
}

test('shared move sets are well formed', () => {
  for (const [id, m] of Object.entries(FIST_SET)) checkMove(id, m, 'FIST');
  for (const [id, m] of Object.entries(ARMED_SET)) checkMove(id, m, 'ARMED');
  // keyframe frames sample
  const out = makePose();
  sampleKeys(FIST_SET.L1.keys, 4, out);
  assert.ok(out.hf[0] > 40, 'jab extends by its active frame');
});

test('render pose springs settle on the target and take the short way round', () => {
  const f = new Fighter(getFighter('kai'), { side: 0, controller: new Controller() });
  f.setState('idle');
  for (let i = 0; i < 40; i++) f.computePose();
  assert.ok(Math.abs(f.rpose.hip[1] - f.pose.hip[1]) < 0.1, 'settles on the target');
  // after a flip the drawn rotation can sit near 360; it must come back via 0, not spin backwards
  f.aX[12] = 350;
  f.aV[12] = 0;
  f.computePose();
  assert.ok(f.rpose.rot > -10 && f.rpose.rot <= 0, `rot ${f.rpose.rot}`);
  // a hit snaps to the hurt pose at once, plus a decaying whip
  f.setState('hitstun');
  f.stun = 20;
  f.hitReact(true, 1);
  f.computePose();
  assert.ok(f.rpose.head < f.pose.head - 10, 'head whips back on a high hit');
  for (let i = 0; i < 60; i++) f.computePose();
  assert.ok(Math.abs(f.rpose.head - f.pose.head) < 0.5, 'whip decays');
});

test('roster: 12 unique fighters with complete kits', () => {
  assert.equal(FIGHTER_DEFS.length, 12);
  assert.equal(new Set(FIGHTER_DEFS.map((d) => d.id)).size, 12);
  for (const s of STARTERS) assert.ok(FIGHTER_DEFS.some((d) => d.id === s));
  for (const def of allFighters()) {
    for (const k of ['L1', 'L2', 'L3', 'L4', 'LAUNCH', 'HEAVY', 'DASHATK', 'AIR1', 'AIR2', 'DIVE', 'THROW', 'S1', 'S2', 'S3', 'SA', 'ULT']) {
      assert.ok(def.moves[k], `${def.id} missing ${k}`);
      checkMove(k, def.moves[k], def.id);
    }
    assert.equal(def.skins.length, 4, `${def.id} skins`);
    assert.ok(typeof def.ult.script === 'function', `${def.id} ult script`);
    const lockHit = (def.ult.move.hits || []).some((h) => h.lock) || (def.ult.move.ev || []).some((e) => e[2]?.hit?.lock);
    assert.ok(lockHit, `${def.id} ult has a lock hit`);
    for (const b of Object.values(def.bars)) assert.ok(b >= 1 && b <= 5);
    if (!STARTERS.includes(def.id)) assert.ok(def.unlock?.cost > 0, `${def.id} has a price`);
  }
});

test('tempo scaling stretches heavy fighters', () => {
  const brutus = getFighter('brutus'), kai = getFighter('kai');
  assert.ok(brutus.moves.L1.dur > kai.moves.L1.dur);
  assert.ok(getFighter('volt').moves.L1.dur < kai.moves.L1.dur);
});

test('towers reference real fighters, arenas and modifiers', () => {
  const ids = new Set(FIGHTER_DEFS.map((d) => d.id));
  const arenas = new Set(ARENAS.map((a) => a.id));
  assert.equal(TOWERS.length, 9);
  const rewards = new Set();
  for (const t of TOWERS) {
    assert.ok(arenas.has(t.arena), `${t.id} arena`);
    assert.ok(ids.has(t.reward), `${t.id} reward`);
    rewards.add(t.reward);
    for (const f of t.floors) {
      assert.ok(f.opp === 'mirror' || ids.has(f.opp), `${t.id} floor opponent ${f.opp}`);
      for (const m of f.mods) assert.ok(MODS[m], `${t.id} mod ${m}`);
      assert.ok(f.lvl >= 0 && f.lvl <= 5);
    }
    assert.equal(t.floors[t.floors.length - 1].opp, t.reward, `${t.id} champion is its reward`);
  }
  // every non-starter can be won in a tower
  for (const d of FIGHTER_DEFS) if (!STARTERS.includes(d.id)) assert.ok(rewards.has(d.id), `${d.id} has a tower`);
  const m = buildMods(['glass', 'boss', 'lowgrav']);
  assert.equal(m.damage, 1.75);
  assert.ok(m.cpuHp > 1 && m.gravity < 1);
});

test('achievements have unique ids and rewards', () => {
  assert.equal(new Set(ACHIEVEMENTS.map((a) => a.id)).size, ACHIEVEMENTS.length);
  for (const a of ACHIEVEMENTS) assert.ok(a.coins > 0 && a.name && a.desc);
});

test('AI difficulty interpolates monotonically', () => {
  assert.equal(AI_LEVELS.length, 5);
  let prev = aiParams(0);
  for (let l = 0.5; l <= 4; l += 0.5) {
    const p = aiParams(l);
    assert.ok(p.react <= prev.react, 'reaction gets faster');
    assert.ok(p.block >= prev.block, 'blocks more');
    prev = p;
  }
});

test('controller buffers presses, detects double taps and pairs', () => {
  const c = new Controller();
  const ai = { held: {} };
  c.ai = ai;
  const step = (held) => {
    ai.held = held;
    c.update();
  };
  step({});
  step({ atk: true });
  assert.ok(c.buffered('atk', 6));
  step({});
  step({});
  assert.ok(c.buffered('atk', 6));
  c.consume('atk');
  assert.ok(!c.buffered('atk', 6));
  // hitstop freeze keeps the buffer alive
  step({ spc: true });
  for (let i = 0; i < 20; i++) {
    c.freezeBuffer();
    step({});
  }
  assert.ok(c.buffered('spc', 6), 'buffer survives hit-freeze');
  // double tap dash
  step({ right: true });
  step({});
  step({ right: true });
  assert.equal(c.dashTap, 1);
  // atk + spc pair
  step({});
  step({ atk: true, spc: true });
  assert.ok(c.combo2(4, 6));
});

test('default save has starters and sane settings', () => {
  const s = defaultSave();
  assert.deepEqual(s.unlocked.sort(), [...STARTERS].sort());
  assert.ok(s.coins >= 0);
  assert.ok(s.settings.master > 0 && s.settings.master <= 1);
});

test('arenas expose the agreed API', () => {
  assert.ok(ARENAS.length >= 10);
  for (const a of ARENAS) {
    assert.ok(a.id && a.name && a.music);
  }
});

test('daily challenge is deterministic per day and valid', async () => {
  const { dailyChallenge, MODS: M } = await import('../src/modes.js');
  const a = dailyChallenge(new Date(2026, 9, 20)), b = dailyChallenge(new Date(2026, 9, 20, 23, 59));
  assert.deepEqual(a, b);
  assert.equal(a.key, '2026-10-20');
  assert.equal(a.yesterday, '2026-10-19');
  assert.notDeepEqual(dailyChallenge(new Date(2026, 9, 21)).key, a.key);
  for (let d = 1; d < 60; d++) {
    const c = dailyChallenge(new Date(2026, 0, d));
    assert.equal(new Set(c.mods).size, 2);
    for (const m of c.mods) assert.ok(M[m]);
    assert.ok(FIGHTER_DEFS.some((f) => f.id === c.opp));
    assert.ok(ARENAS.some((x) => x.id === c.arena));
  }
});
