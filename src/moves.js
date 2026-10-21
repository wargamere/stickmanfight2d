// Shared move sets. Frame data is at 60fps (tempo 1). A fighter's `tempo`
// stat stretches/compresses every frame number when the roster is built.
//
// Move fields:
//   dur        total frames
//   keys       [[frame, poseName|poseObject, ease?], ...]
//   hits       [{ f:[from,to], a:'joint', b:'joint', r, ...hitProps }]
//   chain      { at, to }         press attack during [at, dur] -> next move
//   cancel     frame from which a connected move can cancel into special / ultimate
//   jc         jump-cancel on hit from this frame (launchers)
//   vel        [[frame, vx, vy?]] set facing-space velocity (vy<0 is up)
//   ev         [[frame, type, params]] special events (see fighter.js)
//   air        airborne move; landEnd -> ends on landing (+landLag)
//   stam       stamina cost
//
// Hit props: dmg, stun, bstun, kb:[x,y], launch, kd, wb (wall bounce),
//   gb (ground bounce), stop (hitstop), sfx, spark, guard (stamina dmg on block),
//   unblock, otg, elem, status, rehit, lock (ultimate grab), pull.

export const FIST_SET = {
  L1: {
    name: 'Jab', dur: 17, stam: 4,
    keys: [[0, 'stance'], [2, 'jabWind', 'out'], [4, 'jab', 'snap'], [6, 'jab'], [10, 'jabRecoil', 'out'], [17, 'stance']],
    hits: [{ f: [4, 6], a: 'elbowF', b: 'handF', r: 14, dmg: 30, stun: 16, kb: [3.4, 0], stop: 4, sfx: 'hitLight', spark: 'light' }],
    chain: { at: 7, to: 'L2' }, cancel: 5, vel: [[2, 3]],
  },
  L2: {
    name: 'Cross', dur: 19, stam: 4,
    keys: [[0, 'jab'], [3, 'crossWind', 'out'], [5, 'cross', 'snap'], [7, 'cross'], [11, 'crossRecoil', 'out'], [19, 'stance']],
    hits: [{ f: [5, 7], a: 'elbowB', b: 'handB', r: 14, dmg: 34, stun: 17, kb: [3.8, 0], stop: 5, sfx: 'hitLight', spark: 'light' }],
    chain: { at: 8, to: 'L3' }, cancel: 6, vel: [[3, 3.5]],
  },
  L3: {
    name: 'High Kick', dur: 23, stam: 5,
    keys: [[0, 'cross'], [4, 'kickWind', 'out'], [7, 'highKick', 'snap'], [10, 'highKick'], [15, 'kickWind', 'out'], [23, 'stance']],
    hits: [{ f: [7, 9], a: 'kneeF', b: 'footF', r: 15, dmg: 42, stun: 19, kb: [4.2, 0], stop: 6, sfx: 'hitMedium', spark: 'medium' }],
    chain: { at: 10, to: 'L4' }, cancel: 8, vel: [[4, 2.5]],
  },
  L4: {
    name: 'Spin Kick', dur: 34, stam: 7,
    keys: [[0, 'highKick'], [5, 'spinWind', 'inOut'], [10, 'spinKick', 'snap'], [14, 'spinKick'], [21, 'spinRecoil', 'out'], [34, 'stance']],
    hits: [{ f: [10, 13], a: 'kneeF', b: 'footF', r: 17, dmg: 64, stun: 26, kb: [11, -5.5], kd: true, wb: true, stop: 9, sfx: 'hitHeavy', spark: 'heavy', shake: 0.35, guard: 18 }],
    cancel: 11, vel: [[4, 5], [10, 2]],
  },
  LAUNCH: {
    name: 'Uppercut', dur: 31, stam: 6,
    keys: [[0, 'stance'], [3, 'upperWind', 'out'], [6, 'upperMid', 'snap'], [10, 'uppercut', 'snap'], [15, 'uppercut'], [23, 'upperRecoil', 'out'], [31, 'stance']],
    hits: [{ f: [6, 10], a: 'elbowF', b: 'handF', r: 20, dmg: 48, stun: 30, kb: [1.6, -17.5], launch: true, stop: 7, sfx: 'hitMedium', spark: 'medium', shake: 0.2 }],
    jc: 11, cancel: 9, vel: [[4, 5.5]],
  },
  HEAVY: {
    name: 'Power Strike', dur: 38, stam: 9,
    keys: [[0, 'stance'], [6, 'heavyWind', 'out'], [14, 'heavyWindDeep'], [16, 'heavyPunch', 'snap'], [20, 'heavyPunch'], [28, 'heavyRecoil', 'out'], [38, 'stance']],
    hits: [{ f: [16, 19], a: 'elbowF', b: 'handF', r: 19, dmg: 86, stun: 28, kb: [13, -4.5], wb: true, kd: true, stop: 11, sfx: 'hitHeavy', spark: 'heavy', shake: 0.5, guard: 32 }],
    cancel: 17, vel: [[0, -1.5], [15, 8]],
  },
  DASHATK: {
    name: 'Slide Kick', dur: 32, stam: 6,
    keys: [[0, 'dash'], [3, 'slideKick', 'snap'], [17, 'slideKick'], [24, 'slideRise', 'out'], [32, 'stance']],
    hits: [{ f: [4, 15], a: 'kneeF', b: 'footF', r: 16, dmg: 52, stun: 30, kb: [4, -11], launch: true, stop: 6, sfx: 'hitMedium', spark: 'medium' }],
    cancel: 10, vel: [[0, 13]], friction: 0.94,
  },
  AIR1: {
    name: 'Air Kick', dur: 18, stam: 4, air: true,
    keys: [[0, 'airWind'], [3, 'airKick', 'snap'], [7, 'airKick'], [12, 'airKickRecoil', 'out'], [18, 'fall']],
    hits: [{ f: [3, 7], a: 'kneeF', b: 'footF', r: 16, dmg: 32, stun: 18, kb: [3.4, -6.5], stop: 5, sfx: 'hitLight', spark: 'light' }],
    chain: { at: 8, to: 'AIR2' }, cancel: 6,
  },
  AIR2: {
    name: 'Air Smash', dur: 26, stam: 5, air: true,
    keys: [[0, 'airKick'], [4, 'airWind'], [7, 'airSmash', 'snap'], [13, 'airSmash'], [26, 'fall']],
    hits: [{ f: [7, 10], a: 'elbowF', b: 'handF', r: 19, dmg: 48, stun: 24, kb: [7, 9], kd: true, gb: true, stop: 9, sfx: 'hitHeavy', spark: 'heavy', shake: 0.3 }],
    cancel: 9,
  },
  DIVE: {
    name: 'Dive Kick', dur: 40, stam: 5, air: true, landEnd: true, landLag: 10,
    keys: [[0, 'airWind'], [4, 'diveKick', 'snap'], [40, 'diveKick']],
    hits: [{ f: [4, 40], a: 'kneeF', b: 'footF', r: 17, dmg: 44, stun: 22, kb: [4.5, -7], stop: 6, sfx: 'hitMedium', spark: 'medium', bounce: -10 }],
    vel: [[0, 1, -2], [4, 8.5, 12]], gravity: 0,
  },
  THROW: {
    name: 'Throw', dur: 30, stam: 6,
    keys: [[0, 'stance'], [3, 'grabReach', 'snap'], [12, 'grabReach'], [30, 'stance']],
    ev: [[4, 'grab', { range: 78 }]],
  },
};

export const ARMED_SET = {
  L1: {
    name: 'Slash', dur: 18, stam: 4,
    keys: [[0, 'armed'], [2, 'slashWind', 'out'], [5, 'slash', 'snap'], [9, 'slashFollow', 'out'], [18, 'armed']],
    hits: [{ f: [5, 7], a: 'handF', b: 'wTip', r: 11, dmg: 31, stun: 16, kb: [3.6, 0], stop: 4, sfx: 'hitSlash', spark: 'slash' }],
    chain: { at: 8, to: 'L2' }, cancel: 6, vel: [[2, 3]], trail: true,
  },
  L2: {
    name: 'Rising Slash', dur: 20, stam: 4,
    keys: [[0, 'slash'], [3, 'riseWind', 'out'], [6, 'riseSlash', 'snap'], [10, 'riseFollow', 'out'], [20, 'armed']],
    hits: [{ f: [6, 8], a: 'handF', b: 'wTip', r: 11, dmg: 34, stun: 17, kb: [3.8, -1], stop: 5, sfx: 'hitSlash', spark: 'slash' }],
    chain: { at: 9, to: 'L3' }, cancel: 7, vel: [[3, 3]], trail: true,
  },
  L3: {
    name: 'Thrust', dur: 23, stam: 5,
    keys: [[0, 'riseSlash'], [4, 'thrustWind', 'out'], [7, 'thrust', 'snap'], [10, 'thrust'], [14, 'thrustRecoil', 'out'], [23, 'armed']],
    hits: [{ f: [7, 9], a: 'handF', b: 'wTip', r: 12, dmg: 42, stun: 19, kb: [4.6, 0], stop: 6, sfx: 'hitSlash', spark: 'slash' }],
    chain: { at: 10, to: 'L4' }, cancel: 8, vel: [[5, 5]], trail: true,
  },
  L4: {
    name: 'Cleave', dur: 36, stam: 7,
    keys: [[0, 'thrust'], [5, 'chopWind', 'inOut'], [11, 'chop', 'snap'], [16, 'chopFollow', 'out'], [36, 'armed']],
    hits: [{ f: [11, 14], a: 'handF', b: 'wTip', r: 14, dmg: 66, stun: 26, kb: [11, -5.5], kd: true, wb: true, stop: 10, sfx: 'hitHeavy', spark: 'slashHeavy', shake: 0.4, guard: 20 }],
    cancel: 12, vel: [[5, 5]], trail: true,
  },
  LAUNCH: {
    name: 'Sky Splitter', dur: 32, stam: 6,
    keys: [[0, 'armed'], [3, 'armedUpWind', 'out'], [6, 'armedUpMid', 'snap'], [10, 'armedUp', 'snap'], [16, 'armedUpFollow', 'out'], [32, 'armed']],
    hits: [{ f: [6, 10], a: 'handF', b: 'wTip', r: 14, dmg: 48, stun: 30, kb: [1.6, -17.5], launch: true, stop: 7, sfx: 'hitSlash', spark: 'slash', shake: 0.2 }],
    jc: 11, cancel: 9, vel: [[4, 5]], trail: true,
  },
  HEAVY: {
    name: 'Crushing Blow', dur: 40, stam: 9,
    keys: [[0, 'armed'], [6, 'armedHeavyWind', 'out'], [15, 'armedHeavyWindDeep'], [17, 'armedHeavy', 'snap'], [22, 'armedHeavyFollow', 'out'], [40, 'armed']],
    hits: [{ f: [17, 20], a: 'handF', b: 'wTip', r: 15, dmg: 88, stun: 28, kb: [13, -4.5], wb: true, kd: true, stop: 11, sfx: 'hitHeavy', spark: 'slashHeavy', shake: 0.5, guard: 34 }],
    cancel: 18, vel: [[0, -1.5], [16, 8]], trail: true,
  },
  DASHATK: {
    name: 'Lunge', dur: 30, stam: 6,
    keys: [[0, 'dash'], [3, 'lunge', 'snap'], [15, 'lunge'], [21, 'thrustRecoil', 'out'], [30, 'armed']],
    hits: [{ f: [4, 13], a: 'handF', b: 'wTip', r: 13, dmg: 52, stun: 30, kb: [4, -11], launch: true, stop: 6, sfx: 'hitSlash', spark: 'slash' }],
    cancel: 10, vel: [[0, 13]], friction: 0.94, trail: true,
  },
  AIR1: {
    name: 'Air Slash', dur: 18, stam: 4, air: true,
    keys: [[0, 'airSlashWind'], [3, 'airSlash', 'snap'], [9, 'airSlashFollow', 'out'], [18, 'fall']],
    hits: [{ f: [3, 7], a: 'handF', b: 'wTip', r: 12, dmg: 32, stun: 18, kb: [3.4, -6.5], stop: 5, sfx: 'hitSlash', spark: 'slash' }],
    chain: { at: 8, to: 'AIR2' }, cancel: 6, trail: true,
  },
  AIR2: {
    name: 'Air Cleave', dur: 26, stam: 5, air: true,
    keys: [[0, 'airSlash'], [4, 'airSlashWind'], [7, 'airSpin', 'snap'], [13, 'airSpin'], [26, 'fall']],
    hits: [{ f: [7, 10], a: 'handF', b: 'wTip', r: 14, dmg: 48, stun: 24, kb: [7, 9], kd: true, gb: true, stop: 9, sfx: 'hitHeavy', spark: 'slashHeavy', shake: 0.3 }],
    cancel: 9, trail: true,
  },
  DIVE: {
    name: 'Plunge', dur: 40, stam: 5, air: true, landEnd: true, landLag: 10,
    keys: [[0, 'airSlashWind'], [4, 'airDiveArmed', 'snap'], [40, 'airDiveArmed']],
    hits: [{ f: [4, 40], a: 'handF', b: 'wTip', r: 14, dmg: 44, stun: 22, kb: [4.5, -7], stop: 6, sfx: 'hitSlash', spark: 'slash', bounce: -10 }],
    vel: [[0, 1, -2], [4, 8, 12]], gravity: 0, trail: true,
  },
  THROW: FIST_SET.THROW,
};

// Shared movement / reaction animation names per set
export const SET_POSES = {
  fist: { stance: 'stance', block: 'block', blockHit: 'blockHit', victory: 'victoryFist' },
  armed: { stance: 'armed', block: 'blockArmed', blockHit: 'blockHitArmed', victory: 'victoryArmed' },
  heavy: { stance: 'heavyArmed', block: 'blockArmed', blockHit: 'blockHitArmed', victory: 'victoryRest' },
};
