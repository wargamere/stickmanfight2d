// Progression: coins, unlocks, achievements and lifetime stats.

import { ACHIEVEMENTS, TOWERS } from './modes.js';
import { FIGHTER_DEFS, getFighter } from './roster.js';
import { audio } from './audio.js';

export class Progress {
  constructor(game) {
    this.game = game;
  }
  get s() {
    return this.game.save;
  }
  save() {
    this.game.persist();
  }
  coins(n, silent = false) {
    if (!n) return;
    this.s.coins = Math.max(0, Math.round(this.s.coins + n));
    if (!silent && n > 0) audio.sfx('coin');
    if (this.s.coins >= 5000) this.achieve('rich');
    this.save();
  }
  spend(n) {
    if (this.s.coins < n) return false;
    this.s.coins -= n;
    this.save();
    return true;
  }
  isUnlocked(id) {
    return this.s.unlocked.includes(id);
  }
  unlock(id, announce = true) {
    if (this.isUnlocked(id)) return false;
    this.s.unlocked.push(id);
    if (announce) {
      const d = getFighter(id);
      this.game.toasts.push('NEW FIGHTER', `${d.name} — ${d.title} joins the roster!`, d.skins[0].accent, '✦');
      audio.sfx('unlock');
    }
    const n = this.s.unlocked.length;
    if (n >= 6) this.achieve('roster6');
    if (n >= FIGHTER_DEFS.length) this.achieve('rosterall');
    this.save();
    return true;
  }
  achieve(id) {
    if (this.s.ach[id]) return false;
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (!a) return false;
    this.s.ach[id] = Date.now();
    this.s.coins += a.coins;
    this.game.toasts.push('ACHIEVEMENT UNLOCKED', `${a.name}  +${a.coins}`, '#ffd23f', '★');
    audio.sfx('achievement');
    this.save();
    return true;
  }
  towerState(id) {
    return this.s.towers[id] || { cleared: 0, done: false };
  }
  towerUnlocked(idx) {
    if (idx === 0) return true;
    return this.towerState(TOWERS[idx - 1].id).done;
  }

  // Wire match events (cfg.onEvent) to achievements. humanSides: [bool, bool]
  matchEvents(humanSides) {
    return (type, d) => {
      const human = (f) => f && humanSides[f.side];
      switch (type) {
        case 'combo':
          if (humanSides[d.side]) {
            if (d.hits >= 10) this.achieve('combo10');
            if (d.hits >= 20) this.achieve('combo20');
            this.s.stats.maxCombo = Math.max(this.s.stats.maxCombo, d.hits);
          }
          break;
        case 'parry':
          if (human(d.f)) {
            this.s.stats.parries++;
            this.achieve('parry1');
            if (this.s.stats.parries >= 25) this.achieve('parry25');
          }
          break;
        case 'ultHit':
          if (human(d.att)) {
            this.s.stats.ults++;
            this.achieve('ult1');
          }
          break;
        case 'ko':
          if (human(d.winner) && d.loser.lastAttacker === d.winner && d.winner.state === 'cine') this.achieve('ultko');
          if (human(d.winner)) this.s.stats.kos++;
          if (human(d.winner) && d.perfect) {
            this.s.stats.perfects++;
            this.achieve('perfect');
          }
          break;
        case 'breaker':
          if (human(d.f)) {
            this.s.stats.breakers++;
            this.achieve('breaker');
          }
          break;
        case 'guardBreak':
          if (!human(d.f) && humanSides.some(Boolean)) this.achieve('guardbreak');
          break;
        case 'counter':
          if (human(d.f)) this.achieve('counter');
          break;
        case 'wallSplat':
          if (d.f && !human(d.f) && humanSides.some(Boolean)) this.achieve('wallsplat');
          break;
      }
    };
  }

  // After any match: lifetime stats
  recordMatch(result, humanSide = 0) {
    const st = this.s.stats;
    st.matches++;
    if (humanSide >= 0 && result) {
      const mine = result.stats[humanSide];
      st.damage += mine.dealt;
      st.throws += mine.throws;
      if (result.winner === humanSide) st.wins++;
      else st.losses++;
      if (st.damage >= 10000) this.achieve('dmg10k');
      if (st.throws >= 10) this.achieve('throws10');
      if (result.winner === humanSide) this.achieve('first_win');
    }
    this.save();
  }
}
