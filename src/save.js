// Persistent progress (localStorage, guarded — the game works without it).

const KEY = 'stickman-fight-2d/save-v1';

export function defaultSave() {
  return {
    v: 1,
    coins: 250,
    unlocked: ['kai', 'rosa', 'nyx'],
    skins: {},
    equipped: {},
    hats: ['none'],
    towers: {},
    stats: {
      wins: 0, losses: 0, matches: 0, kos: 0, perfects: 0, maxCombo: 0, parries: 0, ults: 0, breakers: 0,
      throws: 0, survivalBest: 0, damage: 0, towerFloors: 0, versus: 0, playFrames: 0,
    },
    ach: {},
    settings: {
      master: 0.8, music: 0.55, sfx: 0.9, shake: 1, damageNumbers: true, flashes: true,
      quality: 'high', difficulty: 2, touch: 'auto', rounds: 2, time: 99, autoPerfDone: false,
    },
    bindings: null,
    daily: { last: '', streak: 0, best: 0 },
    lastP1: 'kai',
    lastP2: 'rosa',
    tutorialSeen: false,
  };
}

function merge(base, data) {
  if (!data || typeof data !== 'object') return base;
  for (const k of Object.keys(base)) {
    if (!(k in data)) continue;
    const b = base[k], d = data[k];
    if (b && typeof b === 'object' && !Array.isArray(b) && d && typeof d === 'object' && !Array.isArray(d)) {
      base[k] = merge(b, d);
    } else if (d !== undefined && typeof d === typeof b || b === null) {
      base[k] = d;
    }
  }
  return base;
}

export function loadSave() {
  const s = defaultSave();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) merge(s, JSON.parse(raw));
  } catch (e) {
    /* storage unavailable */
  }
  // starters are always available
  for (const id of ['kai', 'rosa', 'nyx']) if (!s.unlocked.includes(id)) s.unlocked.push(id);
  if (!s.hats.includes('none')) s.hats.unshift('none');
  return s;
}

export function persist(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    return true;
  } catch (e) {
    return false;
  }
}

export function resetSave() {
  try {
    localStorage.removeItem(KEY);
  } catch (e) {
    /* ignore */
  }
  return defaultSave();
}

export function ownsSkin(s, id, idx) {
  if (idx === 0) return true;
  return (s.skins[id] || []).includes(idx);
}

export function equipped(s, id) {
  return s.equipped[id] || { skin: 0, hat: 'none' };
}
