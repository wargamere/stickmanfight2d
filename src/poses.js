// Pose library. Facing space: x forward, y up. Hands relative to shoulder,
// feet relative to the ground point under the fighter. Angles in degrees.

import { makePose } from './skeleton.js';

const P = (o) => makePose(o);

export const POSES = {
  // ---------------------------------------------------------------- neutral
  stance: P({ hip: [0, 76], lean: 6, hf: [24, 6], hb: [14, -2], ff: [18, 0], fb: [-20, 0] }),
  stanceLow: P({ hip: [0, 72], lean: 8, hf: [26, 2], hb: [16, -6], ff: [20, 0], fb: [-22, 0] }),
  armed: P({ hip: [0, 76], lean: 6, hf: [26, -14], hb: [8, -24], ff: [18, 0], fb: [-22, 0], w: 48 }),
  armedLow: P({ hip: [0, 72], lean: 8, hf: [28, -18], hb: [10, -28], ff: [20, 0], fb: [-24, 0], w: 42 }),
  heavyArmed: P({ hip: [0, 74], lean: 4, hf: [18, -26], hb: [4, -20], ff: [20, 0], fb: [-22, 0], w: 70 }),
  standTall: P({ hip: [0, 82], lean: 0, hf: [6, -58], hb: [-6, -58], ff: [8, 0], fb: [-8, 0] }),

  // ---------------------------------------------------------------- movement
  walkA: P({ hip: [2, 77], lean: 8, hf: [24, 4], hb: [14, -4], ff: [26, 4], fb: [-16, 0] }),
  walkB: P({ hip: [2, 77], lean: 8, hf: [22, 6], hb: [12, -2], ff: [6, 0], fb: [-26, 6] }),
  dash: P({ hip: [6, 66], lean: 34, hf: [-14, -36], hb: [-26, -30], ff: [30, 8], fb: [-30, 18] }),
  backdash: P({ hip: [-4, 70], lean: -14, hf: [24, 14], hb: [14, 6], ff: [24, 6], fb: [-18, 0] }),
  crouch: P({ hip: [0, 56], lean: 16, hf: [28, -4], hb: [18, -10], ff: [24, 0], fb: [-20, 0] }),
  jumpStretch: P({ hip: [0, 84], lean: 4, head: -4, hf: [18, 30], hb: [-14, 26], ff: [8, 6], fb: [-10, 2] }),
  jumpUp: P({ hip: [0, 82], lean: 4, hf: [24, 20], hb: [-18, 26], ff: [18, 30], fb: [-12, 22] }),
  jumpTuck: P({ hip: [0, 80], lean: 14, hf: [26, -6], hb: [16, -12], ff: [24, 48], fb: [0, 44] }),
  fall: P({ hip: [0, 82], lean: 2, hf: [32, -2], hb: [-28, 2], ff: [16, 12], fb: [-18, 20] }),
  land: P({ hip: [0, 58], lean: 18, hf: [30, -10], hb: [-18, -16], ff: [22, 0], fb: [-24, 0] }),
  flipTuck: P({ hip: [0, 80], lean: 30, hf: [22, -26], hb: [16, -30], ff: [26, 52], fb: [12, 50] }),
  wallCling: P({ hip: [0, 80], lean: -10, hf: [-20, 30], hb: [-26, 10], ff: [-18, 20], fb: [-22, 40] }),

  // ---------------------------------------------------------------- defense
  block: P({ hip: [-4, 72], lean: -4, hf: [18, 22], hb: [16, 8], ff: [16, 0], fb: [-24, 0] }),
  blockArmed: P({ hip: [-4, 72], lean: -4, hf: [20, 2], hb: [12, 14], ff: [16, 0], fb: [-24, 0], w: 86 }),
  blockHit: P({ hip: [-10, 70], lean: -12, hf: [14, 22], hb: [12, 10], ff: [12, 0], fb: [-28, 0] }),
  blockHitArmed: P({ hip: [-10, 70], lean: -12, hf: [16, 4], hb: [8, 14], ff: [12, 0], fb: [-28, 0], w: 92 }),

  // ---------------------------------------------------------------- hurt
  hurtHigh: P({ hip: [-8, 76], lean: -22, head: -18, hf: [-6, -22], hb: [-22, -30], ff: [14, 0], fb: [-26, 0] }),
  hurtMid: P({ hip: [-8, 70], lean: 34, head: 10, hf: [14, -44], hb: [4, -46], ff: [14, 0], fb: [-26, 0] }),
  hurtAir: P({ hip: [0, 80], lean: -12, head: -18, hf: [-22, 22], hb: [-34, 4], ff: [22, 46], fb: [0, 34] }),
  tumble: P({ hip: [0, 80], lean: 30, head: 14, hf: [26, -8], hb: [16, -14], ff: [30, 54], fb: [12, 46] }),
  parried: P({ hip: [-10, 74], lean: -24, head: -16, hf: [-8, 32], hb: [-30, 22], ff: [16, 0], fb: [-30, 0] }),
  getupSit: P({ hip: [-6, 16], lean: 14, head: 4, hf: [26, -30], hb: [-30, -48], ff: [40, 2], fb: [26, 0] }),
  lying: P({ hip: [0, 12], lean: 0, head: 0, hf: [-16, 30], hb: [16, 34], ff: [10, -2], fb: [-12, 2], rot: -92 }),
  lyingFace: P({ hip: [0, 12], lean: 0, head: 0, hf: [10, -50], hb: [-10, -50], ff: [10, 0], fb: [-10, 4], rot: 90 }),
  getupKneel: P({ hip: [-6, 44], lean: 20, hf: [30, -36], hb: [10, -40], ff: [26, 0], fb: [-34, 6] }),
  dizzy: P({ hip: [0, 74], lean: -6, head: 14, hf: [10, -54], hb: [-8, -54], ff: [14, 0], fb: [-16, 0] }),
  grabbed: P({ hip: [0, 84], lean: -10, head: -10, hf: [16, -40], hb: [-14, -40], ff: [10, 18], fb: [-10, 12] }),
  frozen: P({ hip: [0, 76], lean: 10, hf: [30, 10], hb: [16, 0], ff: [18, 0], fb: [-20, 0] }),

  // ---------------------------------------------------------------- unarmed strikes
  jabWind: P({ hip: [2, 76], lean: 8, hf: [12, 8], hb: [14, -2], ff: [20, 0], fb: [-20, 0] }),
  jab: P({ hip: [8, 75], lean: 16, hf: [61, 8], hb: [12, -2], ff: [26, 0], fb: [-18, 0] }),
  crossWind: P({ hip: [4, 76], lean: 6, hf: [24, 4], hb: [-6, 6], ff: [22, 0], fb: [-20, 0] }),
  cross: P({ hip: [12, 74], lean: 22, hf: [14, -6], hb: [62, 8], ff: [30, 0], fb: [-14, 0] }),
  kickWind: P({ hip: [-2, 80], lean: -6, hf: [18, 10], hb: [-16, 0], ff: [26, 40], fb: [-14, 0] }),
  highKick: P({ hip: [-4, 82], lean: -22, head: 8, hf: [6, 6], hb: [-28, -6], ff: [74, 92], fb: [-10, 0] }),
  spinWind: P({ hip: [0, 78], lean: 20, hf: [-20, -10], hb: [-34, -8], ff: [10, 10], fb: [-20, 0], rot: 10 }),
  spinKick: P({ hip: [4, 84], lean: -32, head: 10, hf: [-10, 10], hb: [-34, 0], ff: [84, 66], fb: [-8, 0] }),
  upperWind: P({ hip: [2, 54], lean: 22, hf: [14, -36], hb: [20, -14], ff: [24, 0], fb: [-22, 0] }),
  upperMid: P({ hip: [12, 80], lean: 14, head: -4, hf: [52, 26], hb: [6, -30], ff: [20, 0], fb: [-20, 0] }),
  uppercut: P({ hip: [10, 92], lean: -4, head: -8, hf: [18, 60], hb: [-6, -30], ff: [14, 6], fb: [-20, 0] }),
  heavyWind: P({ hip: [-10, 72], lean: -14, hf: [-36, 12], hb: [24, 14], ff: [16, 0], fb: [-28, 0] }),
  heavyPunch: P({ hip: [16, 70], lean: 30, hf: [64, 2], hb: [-26, -14], ff: [38, 0], fb: [-32, 0] }),
  slideKick: P({ hip: [0, 24], lean: -56, head: 12, hf: [-14, -30], hb: [-40, -10], ff: [80, 10], fb: [20, 20] }),
  flyKnee: P({ hip: [6, 84], lean: 10, hf: [-10, -20], hb: [-20, -16], ff: [44, 46], fb: [-16, 20] }),
  airKick: P({ hip: [0, 80], lean: -18, hf: [10, 14], hb: [-24, 6], ff: [74, 66], fb: [-8, 40] }),
  airPunch: P({ hip: [4, 80], lean: 24, hf: [56, -24], hb: [-20, 10], ff: [20, 38], fb: [-14, 30] }),
  airWind: P({ hip: [0, 82], lean: -10, hf: [-10, 40], hb: [-26, 26], ff: [22, 46], fb: [-8, 36] }),
  airSmash: P({ hip: [4, 82], lean: 28, hf: [50, -40], hb: [46, -44], ff: [16, 40], fb: [-16, 34] }),
  diveKick: P({ hip: [0, 80], lean: -26, hf: [-10, 24], hb: [-30, 10], ff: [56, 6], fb: [-14, 48], rot: 24 }),
  // follow-through / recoil poses: the strike carries on, then re-chambers
  jabRecoil: P({ hip: [6, 75], lean: 12, hf: [34, 8], hb: [14, -2], ff: [24, 0], fb: [-18, 0] }),
  crossRecoil: P({ hip: [9, 75], lean: 16, hf: [18, 2], hb: [36, 6], ff: [27, 0], fb: [-16, 0] }),
  spinRecoil: P({ hip: [2, 80], lean: -10, head: 4, hf: [-2, 8], hb: [-26, -4], ff: [40, 34], fb: [-8, 0] }),
  upperRecoil: P({ hip: [8, 80], lean: 4, hf: [20, 30], hb: [0, -20], ff: [18, 0], fb: [-20, 0] }),
  heavyWindDeep: P({ hip: [-14, 70], lean: -18, head: 6, hf: [-40, 14], hb: [26, 16], ff: [16, 0], fb: [-30, 0] }),
  heavyRecoil: P({ hip: [12, 72], lean: 22, hf: [44, -2], hb: [-14, -10], ff: [36, 0], fb: [-26, 0] }),
  airKickRecoil: P({ hip: [0, 80], lean: -6, hf: [16, 10], hb: [-22, 8], ff: [34, 40], fb: [-10, 34] }),
  slideRise: P({ hip: [6, 50], lean: 18, hf: [30, -20], hb: [10, -30], ff: [30, 0], fb: [-26, 4] }),
  grabReach: P({ hip: [8, 76], lean: 20, hf: [52, -4], hb: [48, 2], ff: [26, 0], fb: [-20, 0] }),
  grabHold: P({ hip: [0, 78], lean: 4, hf: [36, 20], hb: [30, 16], ff: [18, 0], fb: [-22, 0] }),
  throwToss: P({ hip: [-6, 80], lean: -30, hf: [-18, 54], hb: [-28, 48], ff: [26, 0], fb: [-18, 0] }),
  throwFwd: P({ hip: [14, 72], lean: 34, hf: [62, -10], hb: [56, -16], ff: [36, 0], fb: [-30, 0] }),

  // ---------------------------------------------------------------- armed strikes
  slashWind: P({ hip: [-2, 76], lean: -4, hf: [-6, 18], hb: [-18, -6], ff: [18, 0], fb: [-22, 0], w: 150 }),
  slash: P({ hip: [10, 74], lean: 24, hf: [52, -8], hb: [-16, -24], ff: [30, 0], fb: [-20, 0], w: -24, wl: 1 }),
  riseWind: P({ hip: [6, 72], lean: 22, hf: [38, -34], hb: [-10, -34], ff: [26, 0], fb: [-20, 0], w: -60 }),
  riseSlash: P({ hip: [8, 80], lean: -10, hf: [34, 40], hb: [-20, -20], ff: [26, 0], fb: [-18, 0], w: 104, wl: 1 }),
  thrustWind: P({ hip: [-6, 74], lean: 0, hf: [-4, -6], hb: [-14, -14], ff: [18, 0], fb: [-24, 0], w: 4 }),
  thrust: P({ hip: [16, 72], lean: 28, hf: [62, 0], hb: [-20, -26], ff: [36, 0], fb: [-26, 0], w: 0, wl: 1 }),
  chopWind: P({ hip: [-6, 80], lean: -16, hf: [-10, 52], hb: [-24, 30], ff: [18, 0], fb: [-22, 0], w: 128 }),
  chop: P({ hip: [14, 66], lean: 36, hf: [56, -22], hb: [-14, -34], ff: [36, 0], fb: [-26, 0], w: -46, wl: 1 }),
  armedUpWind: P({ hip: [2, 56], lean: 24, hf: [34, -46], hb: [-6, -40], ff: [24, 0], fb: [-22, 0], w: -40 }),
  armedUpMid: P({ hip: [12, 80], lean: 12, hf: [50, 6], hb: [-10, -32], ff: [22, 0], fb: [-20, 0], w: 40, wl: 1 }),
  armedUp: P({ hip: [10, 92], lean: -8, hf: [22, 58], hb: [-14, -30], ff: [14, 6], fb: [-20, 0], w: 92, wl: 1 }),
  armedHeavyWind: P({ hip: [-12, 74], lean: -18, hf: [-24, 48], hb: [-34, 30], ff: [16, 0], fb: [-30, 0], w: 140 }),
  armedHeavy: P({ hip: [18, 66], lean: 38, hf: [60, -30], hb: [-10, -40], ff: [40, 0], fb: [-32, 0], w: -52, wl: 1 }),
  lunge: P({ hip: [10, 62], lean: 40, hf: [64, -4], hb: [-30, -24], ff: [40, 6], fb: [-36, 12], w: 0, wl: 1 }),
  slashFollow: P({ hip: [12, 73], lean: 26, hf: [40, -30], hb: [-14, -28], ff: [30, 0], fb: [-20, 0], w: -72, wl: 1 }),
  riseFollow: P({ hip: [6, 82], lean: -14, hf: [20, 50], hb: [-20, -18], ff: [26, 0], fb: [-18, 0], w: 132, wl: 1 }),
  thrustRecoil: P({ hip: [10, 73], lean: 18, hf: [40, -2], hb: [-16, -22], ff: [32, 0], fb: [-24, 0], w: 4, wl: 0.4 }),
  chopFollow: P({ hip: [16, 62], lean: 42, hf: [40, -44], hb: [-12, -38], ff: [38, 0], fb: [-26, 0], w: -82, wl: 1 }),
  armedUpFollow: P({ hip: [8, 84], lean: -10, hf: [6, 56], hb: [-14, -26], ff: [16, 0], fb: [-20, 0], w: 122, wl: 1 }),
  armedHeavyWindDeep: P({ hip: [-14, 72], lean: -22, head: 6, hf: [-28, 50], hb: [-36, 30], ff: [16, 0], fb: [-32, 0], w: 150 }),
  armedHeavyFollow: P({ hip: [20, 62], lean: 42, hf: [44, -48], hb: [-8, -44], ff: [42, 0], fb: [-32, 0], w: -88, wl: 1 }),
  airSlashFollow: P({ hip: [4, 80], lean: 24, hf: [36, -34], hb: [-20, 4], ff: [20, 40], fb: [-14, 30], w: -80, wl: 1 }),
  airSlashWind: P({ hip: [0, 82], lean: -12, hf: [0, 44], hb: [-24, 24], ff: [22, 44], fb: [-8, 34], w: 120 }),
  airSlash: P({ hip: [4, 80], lean: 20, hf: [50, -18], hb: [-20, 6], ff: [20, 40], fb: [-14, 30], w: -40, wl: 1 }),
  airSpin: P({ hip: [0, 80], lean: 30, hf: [52, -34], hb: [-24, 10], ff: [22, 42], fb: [-10, 30], w: -80, wl: 1 }),
  airDiveArmed: P({ hip: [0, 80], lean: 10, hf: [30, -50], hb: [-20, 10], ff: [22, 44], fb: [-14, 36], w: -70, wl: 1 }),

  // ---------------------------------------------------------------- special templates
  castWind: P({ hip: [-6, 74], lean: -6, hf: [-12, 6], hb: [-18, 0], ff: [18, 0], fb: [-26, 0] }),
  cast: P({ hip: [12, 72], lean: 22, hf: [60, 6], hb: [56, -2], ff: [32, 0], fb: [-26, 0] }),
  castUp: P({ hip: [0, 80], lean: -8, hf: [10, 60], hb: [-8, 58], ff: [16, 0], fb: [-18, 0] }),
  castDown: P({ hip: [6, 52], lean: 44, hf: [44, -64], hb: [30, -66], ff: [30, 0], fb: [-26, 0] }),
  throwWind: P({ hip: [-6, 78], lean: -14, hf: [-32, 40], hb: [26, 10], ff: [20, 0], fb: [-24, 0] }),
  throwRelease: P({ hip: [14, 72], lean: 30, hf: [58, -4], hb: [-28, -30], ff: [36, 0], fb: [-28, 0] }),
  risingWind: P({ hip: [0, 50], lean: 26, hf: [12, -40], hb: [20, -20], ff: [24, 0], fb: [-24, 0] }),
  rising: P({ hip: [6, 86], lean: -10, head: -10, hf: [14, 62], hb: [-20, -20], ff: [20, 46], fb: [-12, 10] }),
  spinFlat: P({ hip: [0, 82], lean: -6, hf: [50, 20], hb: [-50, 20], ff: [76, 52], fb: [-30, 8] }),
  counterStance: P({ hip: [-6, 60], lean: 16, hf: [6, -46], hb: [-4, -44], ff: [26, 0], fb: [-30, 0], w: 172 }),
  counterStrike: P({ hip: [20, 64], lean: 34, hf: [64, -4], hb: [-30, -30], ff: [44, 0], fb: [-34, 0], w: 6, wl: 1 }),
  shoulder: P({ hip: [10, 70], lean: 42, head: 10, hf: [10, -30], hb: [-20, -36], ff: [36, 4], fb: [-34, 10] }),
  slamWind: P({ hip: [-4, 82], lean: -14, hf: [-4, 62], hb: [-14, 58], ff: [16, 0], fb: [-22, 0], w: 110 }),
  slam: P({ hip: [12, 54], lean: 48, hf: [52, -60], hb: [40, -62], ff: [34, 0], fb: [-30, 0], w: -70, wl: 1 }),
  leap: P({ hip: [0, 84], lean: 4, hf: [-6, 60], hb: [-16, 54], ff: [20, 40], fb: [-14, 26], w: 120 }),
  meditate: P({ hip: [0, 22], lean: 0, head: 0, hf: [24, -32], hb: [-22, -32], ff: [26, 2], fb: [-26, 2] }),
  aura: P({ hip: [0, 78], lean: -8, head: -8, hf: [40, 26], hb: [-40, 26], ff: [22, 0], fb: [-22, 0] }),
  pointUp: P({ hip: [0, 80], lean: -4, hf: [16, 60], hb: [-20, -40], ff: [16, 0], fb: [-18, 0] }),
  pointFwd: P({ hip: [4, 78], lean: 8, hf: [60, 14], hb: [-20, -40], ff: [20, 0], fb: [-18, 0] }),
  crouchPalm: P({ hip: [8, 46], lean: 30, hf: [56, -30], hb: [-10, -40], ff: [30, 0], fb: [-30, 4] }),
  victoryFist: P({ hip: [0, 82], lean: -4, head: -10, hf: [8, 60], hb: [-16, -50], ff: [14, 0], fb: [-16, 0] }),
  victoryArms: P({ hip: [0, 82], lean: -8, head: -14, hf: [34, 50], hb: [-34, 50], ff: [18, 0], fb: [-18, 0] }),
  victoryBow: P({ hip: [0, 80], lean: 34, head: 10, hf: [20, -30], hb: [16, -30], ff: [10, 0], fb: [-10, 0] }),
  victoryArmed: P({ hip: [0, 82], lean: -6, head: -8, hf: [16, 58], hb: [-14, -50], ff: [14, 0], fb: [-16, 0], w: 92 }),
  victoryRest: P({ hip: [0, 82], lean: 0, head: 0, hf: [24, 30], hb: [-14, -52], ff: [12, 0], fb: [-14, 0], w: 120 }),
  defeatKneel: P({ hip: [0, 40], lean: 40, head: 20, hf: [20, -50], hb: [10, -54], ff: [28, 0], fb: [-30, 4] }),
};

export function pose(name) {
  const p = POSES[name];
  if (!p) throw new Error('Unknown pose ' + name);
  return p;
}

// Variant of a pose with overrides
export function poseWith(name, over) {
  return makePose({ ...clonePoseObj(pose(name)), ...over });
}

function clonePoseObj(p) {
  return {
    hip: p.hip.slice(), lean: p.lean, head: p.head, hf: p.hf.slice(), hb: p.hb.slice(),
    ff: p.ff.slice(), fb: p.fb.slice(), w: p.w, w2: p.w2, wl: p.wl, rot: p.rot,
  };
}
