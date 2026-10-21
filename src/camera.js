// Fighting-game camera: frames both fighters, dynamic zoom, trauma shake,
// directional kicks and cinematic overrides.

import { clamp, lerp } from './util.js';
import { ARENA_HALF } from './fighter.js';

export const GROUND_SCREEN = 0.8; // ground line at 80% of view height

export class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.zoom = 1;
    this.trauma = 0;
    this.sx = 0;
    this.sy = 0;
    this.kx = 0;
    this.ky = 0;
    this.rot = 0;
    this.override = null; // {x, y, zoom, k}
    this.t = 0;
    this.shakeScale = 1;
    this.minZoom = 0.72;
    this.maxZoom = 1.32;
  }
  reset(x = 0) {
    this.x = x;
    this.y = 0;
    this.zoom = 1;
    this.trauma = 0;
    this.kx = this.ky = 0;
    this.override = null;
  }
  shake(amount) {
    this.trauma = Math.min(1, this.trauma + amount);
  }
  kick(dx, dy) {
    this.kx += dx;
    this.ky += dy;
  }
  update(fighters, view) {
    this.t++;
    let tx, ty, tz;
    const live = fighters.filter((f) => f && f.visible !== false);
    if (this.override) {
      tx = this.override.x;
      ty = this.override.y ?? 0;
      tz = this.override.zoom;
    } else if (live.length) {
      let minX = Infinity, maxX = -Infinity, minY = 0;
      for (const f of live) {
        const fx = f.ragdoll ? f.ragdoll.cx : f.x;
        const fy = f.ragdoll ? f.ragdoll.cy : f.y;
        minX = Math.min(minX, fx);
        maxX = Math.max(maxX, fx);
        minY = Math.min(minY, fy);
      }
      tx = (minX + maxX) / 2;
      const span = maxX - minX;
      tz = clamp((view.w * 0.58) / (span + 420), this.minZoom, this.maxZoom);
      // rise when fighters go high
      ty = minY < -120 ? (minY + 120) * 0.75 : 0;
    } else {
      tx = 0;
      ty = 0;
      tz = 1;
    }
    const k = this.override?.k ?? 0.1;
    this.x = lerp(this.x, tx, k);
    this.y = lerp(this.y, ty, k);
    this.zoom = lerp(this.zoom, tz, (this.override?.k ?? 0.06));
    // keep inside arena
    const half = view.w / 2 / this.zoom;
    if (half < ARENA_HALF + 120) {
      const lim = ARENA_HALF + 120 - half;
      this.x = clamp(this.x, -lim, lim);
    } else this.x = lerp(this.x, 0, 0.2);
    const topLimit = -430;
    this.y = clamp(this.y, topLimit, 0);
    // shake
    this.trauma = Math.max(0, this.trauma - 0.022);
    const s = this.trauma * this.trauma * 26 * this.shakeScale;
    this.sx = s * (Math.sin(this.t * 1.7) + Math.sin(this.t * 3.1) * 0.5) * 0.7;
    this.sy = s * (Math.cos(this.t * 2.3) + Math.sin(this.t * 4.7) * 0.5) * 0.7;
    this.rot = this.trauma * this.trauma * 0.012 * Math.sin(this.t * 2.1) * this.shakeScale;
    this.kx *= 0.78;
    this.ky *= 0.78;
  }
  // translate/scale ctx so world coords can be drawn directly
  apply(ctx, view) {
    ctx.translate(view.w / 2 + this.sx + this.kx, view.h * GROUND_SCREEN + this.sy + this.ky);
    if (this.rot) ctx.rotate(this.rot);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x, -this.y);
  }
  toScreen(wx, wy, view) {
    return [view.w / 2 + (wx - this.x) * this.zoom + this.sx, view.h * GROUND_SCREEN + (wy - this.y) * this.zoom + this.sy];
  }
  // snapshot given to the arena renderer (shake applied by caller)
  view() {
    return { x: this.x, y: this.y, zoom: this.zoom };
  }
}
