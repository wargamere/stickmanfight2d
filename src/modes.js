// Game-mode data: towers, modifiers, achievements and rewards.

export const MODS = {
  lowgrav: { name: 'Low Gravity', desc: 'Floaty jumps, endless juggles.', color: '#8fe8ff', apply: (m) => ({ ...m, gravity: 0.62, jump: 0.86 }) },
  glass: { name: 'Glass Cannon', desc: 'Everyone deals 75% more damage.', color: '#ff5c5c', apply: (m) => ({ ...m, damage: 1.75 }) },
  turbo: { name: 'Turbo', desc: 'The whole fight runs 25% faster.', color: '#ffd23f', apply: (m) => ({ ...m, turbo: 1.25 }) },
  meter: { name: 'Power Surge', desc: 'Power meter fills 3x faster.', color: '#c58bff', apply: (m) => ({ ...m, meter: 3 }) },
  regen: { name: 'Regenerator', desc: 'The enemy slowly regenerates health.', color: '#3ddc97', apply: (m) => ({ ...m, regen: 6 }) },
  giant: { name: 'Giant', desc: 'The enemy is huge and tough.', color: '#ff9a3c', apply: (m) => ({ ...m, cpuScale: 1.32, cpuHp: 1.45 }) },
  armored: { name: 'Armored', desc: 'The enemy takes 30% less damage.', color: '#9aa3ad', apply: (m) => ({ ...m, dmgTaken: [1, 0.7] }) },
  poison: { name: 'Toxic Air', desc: 'Both fighters slowly lose health.', color: '#9dff5c', apply: (m) => ({ ...m, poison: 6 }) },
  boss: { name: 'Champion', desc: 'Tower champion: +35% health.', color: '#ffd23f', apply: (m) => ({ ...m, cpuHp: (m.cpuHp || 1) * 1.35 }) },
  sudden: { name: 'Sudden Death', desc: 'Both start at 30% health.', color: '#ff4d6d', apply: (m) => ({ ...m, startHp: [0.3, 0.3] }) },
  frail: { name: 'Frail', desc: 'You take 40% more damage.', color: '#ff8a8a', apply: (m) => ({ ...m, dmgTaken: [1.4, (m.dmgTaken || [1, 1])[1]] }) },
  mirror: { name: 'Mirror Match', desc: 'Face your own reflection.', color: '#ffffff', apply: (m) => m },
};

import { makeRng } from './util.js';

export function buildMods(list = []) {
  let m = {};
  for (const id of list) if (MODS[id]) m = MODS[id].apply(m);
  return m;
}

// floor: [opponent, aiLevel, mods[], rounds(wins needed), coins]
const F = (opp, lvl, mods = [], rounds = 1, coins = 60) => ({ opp, lvl, mods, rounds, coins });

export const TOWERS = [
  {
    id: 'beginnings', name: 'Tower of Beginnings', arena: 'dojo', color: '#ff9a3c', reward: 'brutus', bonus: 300,
    desc: 'Every legend starts on the first step.',
    floors: [F('kai', 0.3), F('nyx', 0.6), F('rosa', 0.9, [], 1, 70), F('kai', 1.1, ['glass'], 1, 80), F('brutus', 1.4, ['boss'], 2, 150)],
  },
  {
    id: 'storm', name: 'Storm Spire', arena: 'rooftop', color: '#ffe23d', reward: 'volt', bonus: 400,
    desc: 'Lightning never strikes twice. He does.',
    floors: [F('nyx', 1.3), F('rosa', 1.5, ['lowgrav']), F('brutus', 1.6, [], 1, 80), F('kai', 1.8, ['turbo'], 1, 90), F('nyx', 1.9, ['meter'], 1, 90), F('volt', 2.1, ['boss'], 2, 180)],
  },
  {
    id: 'frost', name: 'Frozen Peak', arena: 'glacier', color: '#7fe3ff', reward: 'yuki', bonus: 450,
    desc: 'The air is thin. The blades are not.',
    floors: [F('volt', 1.8), F('kai', 1.9, ['armored']), F('rosa', 2.0, ['glass'], 1, 90), F('brutus', 2.1, ['giant'], 1, 100), F('mirror', 2.2, ['mirror'], 1, 100), F('yuki', 2.4, ['boss'], 2, 200)],
  },
  {
    id: 'ember', name: 'Caldera Forge', arena: 'volcano', color: '#ff6a2a', reward: 'ignis', bonus: 500,
    desc: 'Hot enough to melt steel. And resolve.',
    floors: [F('brutus', 2.1), F('yuki', 2.2, ['poison']), F('volt', 2.3, ['turbo'], 1, 100), F('nyx', 2.4, ['regen'], 1, 100), F('rosa', 2.5, ['sudden'], 1, 110), F('kai', 2.6, ['glass', 'lowgrav'], 1, 120), F('ignis', 2.8, ['boss'], 2, 220)],
  },
  {
    id: 'jade', name: 'Whispering Bamboo', arena: 'bamboo', color: '#47d16c', reward: 'zen', bonus: 550,
    desc: 'Silence is the loudest strike.',
    floors: [F('ignis', 2.5), F('yuki', 2.6, ['armored']), F('mirror', 2.7, ['mirror', 'turbo'], 1, 110), F('brutus', 2.8, ['giant', 'regen'], 1, 120), F('volt', 2.9, ['meter'], 1, 120), F('rosa', 3.0, [], 2, 130), F('zen', 3.1, ['boss', 'regen'], 2, 240)],
  },
  {
    id: 'serpent', name: 'Sky Sanctum', arena: 'temple', color: '#a6ff4d', reward: 'viper', bonus: 600,
    desc: 'Above the clouds, the serpent coils.',
    floors: [F('zen', 2.8), F('ignis', 2.9, ['lowgrav']), F('nyx', 3.0, ['frail'], 1, 120), F('yuki', 3.1, ['glass'], 1, 130), F('volt', 3.2, ['turbo', 'meter'], 1, 130), F('kai', 3.3, ['armored', 'regen'], 1, 140), F('viper', 3.4, ['boss'], 2, 260)],
  },
  {
    id: 'necro', name: 'Moonlit Necropolis', arena: 'necropolis', color: '#5ff0c8', reward: 'mortis', bonus: 700,
    desc: 'The dead keep score.',
    floors: [F('viper', 3.0), F('zen', 3.1, ['poison']), F('mirror', 3.2, ['mirror', 'glass'], 1, 140), F('brutus', 3.3, ['giant', 'armored'], 1, 150), F('nyx', 3.4, ['turbo'], 1, 150), F('ignis', 3.5, ['sudden'], 1, 150), F('mortis', 3.6, ['boss', 'regen'], 2, 280)],
  },
  {
    id: 'foundry', name: 'Iron Foundry', arena: 'foundry', color: '#c7d0db', reward: 'unit7', bonus: 800,
    desc: 'Built to break you. Programmed to enjoy it.',
    floors: [F('mortis', 3.3), F('viper', 3.4, ['frail']), F('volt', 3.5, ['turbo', 'glass'], 1, 150), F('zen', 3.6, ['armored', 'regen'], 1, 160), F('yuki', 3.7, ['lowgrav', 'meter'], 1, 160), F('mirror', 3.8, ['mirror'], 2, 170), F('brutus', 3.9, ['giant', 'boss'], 2, 180), F('unit7', 4.0, ['boss', 'armored'], 2, 300)],
  },
  {
    id: 'void', name: 'The Void', arena: 'void', color: '#c58bff', reward: 'omega', bonus: 1500,
    desc: 'The last tower. Nothing waits at the top. Nothing hungry.',
    floors: [F('unit7', 3.8), F('mortis', 3.9, ['poison']), F('viper', 4.0, ['turbo'], 1, 180), F('ignis', 4.1, ['glass', 'meter'], 1, 190), F('mirror', 4.2, ['mirror', 'frail'], 1, 200), F('zen', 4.3, ['regen', 'armored'], 2, 210), F('volt', 4.4, ['turbo', 'lowgrav'], 2, 220), F('omega', 4.6, ['boss'], 2, 500)],
  },
];

// ---------------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------------
export const ACHIEVEMENTS = [
  { id: 'first_win', name: 'First Blood', desc: 'Win your first match.', coins: 100 },
  { id: 'combo10', name: 'Combo Artist', desc: 'Land a 10-hit combo.', coins: 150 },
  { id: 'combo20', name: 'Combo Maestro', desc: 'Land a 20-hit combo.', coins: 300 },
  { id: 'perfect', name: 'Untouchable', desc: 'Win a round without taking damage.', coins: 200 },
  { id: 'parry1', name: 'Steel Nerves', desc: 'Parry an attack.', coins: 100 },
  { id: 'parry25', name: 'Mirror Wall', desc: 'Parry 25 attacks in total.', coins: 250 },
  { id: 'ult1', name: 'Unleashed', desc: 'Land an ultimate.', coins: 100 },
  { id: 'ultko', name: 'Cinematic Finish', desc: 'KO an opponent with an ultimate.', coins: 200 },
  { id: 'breaker', name: 'Not Today', desc: 'Escape a combo with a Breaker.', coins: 100 },
  { id: 'throws10', name: 'Grappler', desc: 'Land 10 throws.', coins: 150 },
  { id: 'wallsplat', name: 'Wall Splat', desc: 'Bounce an opponent off the wall.', coins: 75 },
  { id: 'guardbreak', name: 'Shatter', desc: 'Break an opponent\'s guard.', coins: 100 },
  { id: 'counter', name: 'Read You Like a Book', desc: 'Land a counter-stance strike.', coins: 100 },
  { id: 'tower1', name: 'First Ascent', desc: 'Clear your first tower.', coins: 200 },
  { id: 'towerall', name: 'Tower Master', desc: 'Clear every tower.', coins: 1000 },
  { id: 'omega', name: 'Unmade the Unmaker', desc: 'Defeat OMEGA at the top of The Void.', coins: 500 },
  { id: 'roster6', name: 'Gathering Storm', desc: 'Unlock 6 fighters.', coins: 300 },
  { id: 'rosterall', name: 'Full Roster', desc: 'Unlock all 12 fighters.', coins: 800 },
  { id: 'surv5', name: 'Survivor', desc: 'Survive 5 waves in Survival.', coins: 150 },
  { id: 'surv15', name: 'Unbreakable', desc: 'Survive 15 waves in Survival.', coins: 400 },
  { id: 'nightmare', name: 'Nightmare Slayer', desc: 'Beat a Nightmare CPU in Quick Fight.', coins: 300 },
  { id: 'versus10', name: 'Local Legend', desc: 'Play 10 Versus matches.', coins: 150 },
  { id: 'hat', name: 'Fashion Victim', desc: 'Buy a hat in the Locker.', coins: 100 },
  { id: 'rich', name: 'High Roller', desc: 'Hold 5,000 coins at once.', coins: 200 },
  { id: 'dmg10k', name: 'Wrecking Ball', desc: 'Deal 10,000 total damage.', coins: 200 },
  { id: 'trainee', name: 'Lab Rat', desc: 'Spend time in Training mode.', coins: 50 },
];

export const QUICK_DIFFICULTIES = [
  { name: 'ROOKIE', level: 0.2, coins: 30 },
  { name: 'EASY', level: 1, coins: 45 },
  { name: 'NORMAL', level: 2, coins: 65 },
  { name: 'HARD', level: 3, coins: 90 },
  { name: 'NIGHTMARE', level: 4, coins: 130 },
];

export const MOVE_LIST_COMMON = [
  ['Attack chain', 'ATK, ATK, ATK, ATK (time presses for bonus damage)'],
  ['Launcher', 'DOWN + ATK  → hold UP / JUMP to follow into the air'],
  ['Power strike', 'BACK + ATK (wall splat)'],
  ['Dash attack', 'Dash or run, then ATK'],
  ['Air combo', 'ATK, ATK in the air'],
  ['Dive', 'DOWN + ATK in the air'],
  ['Throw', 'ATK + SPC together (or GRAB) up close — hold BACK to throw behind'],
  ['Block / Parry', 'Hold DOWN to block, tap it right before a hit to PARRY'],
  ['Breaker', 'ATK + SPC while being comboed (costs half the power bar)'],
  ['Ultimate', 'ULT with a full power bar — or cancel a hit into it'],
  ['Movement', 'Double-tap or DASH key to dash, double jump, air dash, wall jump'],
];

// ---------------------------------------------------------------------------
// Daily challenge: the same opponent, stage and modifiers for everyone on a
// given calendar day (local time).
// ---------------------------------------------------------------------------
const DAILY_MODS = ['lowgrav', 'glass', 'turbo', 'meter', 'regen', 'giant', 'armored', 'poison', 'frail', 'sudden'];
const DAILY_FIGHTERS = ['kai', 'rosa', 'nyx', 'brutus', 'volt', 'yuki', 'ignis', 'zen', 'viper', 'mortis', 'unit7', 'omega'];
const DAILY_ARENAS = ['dojo', 'rooftop', 'volcano', 'glacier', 'bamboo', 'temple', 'necropolis', 'foundry', 'void'];

const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function dailyChallenge(date = new Date()) {
  const key = dayKey(date);
  const prev = new Date(date);
  prev.setDate(prev.getDate() - 1);
  let seed = 0;
  for (const ch of key) seed = (seed * 31 + ch.charCodeAt(0)) | 0;
  const rng = makeRng(seed);
  const pool = DAILY_MODS.slice();
  const mods = [];
  while (mods.length < 2) mods.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  if (mods.includes('sudden') && mods.includes('poison')) mods[1] = 'meter';
  return {
    key,
    yesterday: dayKey(prev),
    opp: rng.pick(DAILY_FIGHTERS),
    arena: rng.pick(DAILY_ARENAS),
    skin: rng.int(0, 3),
    mods,
    lvl: 2.6 + rng() * 0.9,
    rounds: 2,
  };
}
