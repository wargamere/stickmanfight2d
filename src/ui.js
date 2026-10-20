// Canvas UI toolkit: panels, buttons, list menus, sliders, toasts.
// Everything works with keyboard, gamepad, mouse and touch.

import { menu, pointer } from './input.js';
import { audio } from './audio.js';
import { text, FONT_UI, FONT_BIG, FONT_BODY } from './hud.js';
import { clamp, lerp, ease, rgba, shade } from './util.js';

export const C = {
  accent: '#ffd23f',
  accent2: '#ff4d6d',
  cyan: '#4ab8ff',
  panel: 'rgba(10,9,20,0.86)',
  panelHi: 'rgba(30,26,52,0.92)',
  line: 'rgba(255,255,255,0.14)',
  dim: 'rgba(255,255,255,0.55)',
  good: '#3ddc97',
  bad: '#ff5c5c',
};

export { text, FONT_UI, FONT_BIG, FONT_BODY };

export function sfx(name) {
  audio.sfx(name, { vol: name === 'uiMove' ? 0.6 : 0.9 });
}

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function skewPanel(ctx, x, y, w, h, skew = 14) {
  ctx.beginPath();
  ctx.moveTo(x + skew, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w - skew, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
}

export function panel(ctx, x, y, w, h, { fill = C.panel, stroke = C.line, r = 14, glow = null } = {}) {
  ctx.save();
  if (glow) {
    ctx.shadowColor = glow;
    ctx.shadowBlur = 24;
  }
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

export function inRect(px, py, r) {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

// Screen title with underline swoosh
export function title(ctx, str, x, y, { size = 54, color = '#fff', align = 'left', sub = '' } = {}) {
  text(ctx, str, x, y, { size, font: FONT_BIG, color, align, stroke: '#000', sw: 7, shadow: 'rgba(0,0,0,0.5)' });
  ctx.font = `${size}px ${FONT_BIG}`;
  const w = ctx.measureText(str).width;
  const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  ctx.fillStyle = C.accent;
  ctx.beginPath();
  ctx.moveTo(x0, y + size * 0.45);
  ctx.lineTo(x0 + w + 30, y + size * 0.45);
  ctx.lineTo(x0 + w + 18, y + size * 0.45 + 6);
  ctx.lineTo(x0 - 4, y + size * 0.45 + 6);
  ctx.closePath();
  ctx.fill();
  if (sub) text(ctx, sub, x0, y + size * 0.45 + 26, { size: 18, font: FONT_BODY, color: C.dim, align: 'left' });
}

// Hint bar at the bottom: [['ENTER','Select'], ['ESC','Back']]
export function hints(ctx, view, items) {
  let x = view.w - 30;
  ctx.save();
  for (let i = items.length - 1; i >= 0; i--) {
    const [k, label] = items[i];
    ctx.font = `16px ${FONT_BODY}`;
    const lw = ctx.measureText(label).width;
    ctx.font = `13px ${FONT_UI}`;
    const kw = ctx.measureText(k).width + 16;
    x -= lw;
    text(ctx, label, x, view.h - 24, { size: 16, font: FONT_BODY, color: '#fff', align: 'left' });
    x -= kw + 8;
    roundRect(ctx, x, view.h - 36, kw, 24, 6);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    text(ctx, k, x + kw / 2, view.h - 24, { size: 13, font: FONT_UI, color: C.accent });
    x -= 26;
  }
  ctx.restore();
}

export function coinIcon(ctx, x, y, r = 10) {
  ctx.save();
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r);
  g.addColorStop(0, '#fff6c2');
  g.addColorStop(0.5, '#ffd23f');
  g.addColorStop(1, '#c98a00');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#7a5200';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#9a6a00';
  ctx.font = `${Math.round(r * 1.2)}px ${FONT_UI}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('S', x, y + 1);
  ctx.restore();
}

export function coins(ctx, view, amount, shown) {
  const x = view.w - 34, y = 40;
  const s = Math.round(shown ?? amount).toLocaleString('en-US');
  ctx.font = `22px ${FONT_UI}`;
  const w = ctx.measureText(s).width;
  panel(ctx, x - w - 56, y - 22, w + 70, 44, { r: 22 });
  coinIcon(ctx, x - w - 30, y, 12);
  text(ctx, s, x - 4, y + 1, { size: 22, align: 'right', color: C.accent });
}

export function bar(ctx, x, y, w, h, p, color, bg = 'rgba(255,255,255,0.12)') {
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w * clamp(p, 0, 1), h);
}

export function lockIcon(ctx, x, y, s = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(0, -8, 9, Math.PI, 0);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  roundRect(ctx, -13, -8, 26, 20, 4);
  ctx.fill();
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(0, 1, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Vertical list menu
// item: { label, desc, action, left, right, value(), disabled(), color, badge }
// ---------------------------------------------------------------------------
export class ListMenu {
  constructor(items, opts = {}) {
    this.items = items;
    this.i = opts.start || 0;
    this.x = opts.x ?? 80;
    this.y = opts.y ?? 200;
    this.w = opts.w ?? 420;
    this.h = opts.h ?? 58;
    this.gap = opts.gap ?? 10;
    this.size = opts.size ?? 26;
    this.onBack = opts.onBack;
    this.anim = items.map(() => 0);
    this.rects = [];
    this.t = 0;
    this.skew = opts.skew ?? 16;
    this.valueW = opts.valueW ?? 0;
    this.scroll = 0;
    this.maxVisible = opts.maxVisible || 99;
    this.enabled = true;
    this.skipDisabled();
  }
  skipDisabled(dir = 1) {
    const n = this.items.length;
    for (let k = 0; k < n && this.items[this.i]?.disabled?.(); k++) this.i = (this.i + dir + n) % n;
  }
  move(d) {
    const n = this.items.length;
    let i = this.i;
    for (let k = 0; k < n; k++) {
      i = (i + d + n) % n;
      if (!this.items[i].disabled?.()) break;
    }
    if (i !== this.i) {
      this.i = i;
      sfx('uiMove');
    }
  }
  update() {
    this.t++;
    if (!this.enabled) return;
    const it = this.items[this.i];
    if (menu.fired.up) this.move(-1);
    if (menu.fired.down) this.move(1);
    if (menu.fired.left && it?.left) {
      it.left();
      sfx('uiMove');
    }
    if (menu.fired.right && it?.right) {
      it.right();
      sfx('uiMove');
    }
    if (menu.fired.confirm && it && !it.disabled?.()) this.activate(it);
    else if (menu.fired.back && this.onBack) {
      sfx('uiBack');
      this.onBack();
      return;
    }
    // pointer
    for (let k = 0; k < this.rects.length; k++) {
      const r = this.rects[k];
      if (!r) continue;
      if (inRect(pointer.x, pointer.y, r)) {
        if (pointer.moved && this.i !== k && !this.items[k].disabled?.()) {
          this.i = k;
          sfx('uiMove');
        }
        if (pointer.pressed && !this.items[k].disabled?.()) {
          this.i = k;
          const item = this.items[k];
          // value items: left/right halves
          if (item.right && pointer.x > r.x + r.w * 0.55) {
            item.right();
            sfx('uiMove');
          } else if (item.left && pointer.x > r.x + r.w * 0.35) {
            item.left();
            sfx('uiMove');
          } else this.activate(item);
        }
      }
    }
    if (pointer.wheel && this.items.length > this.maxVisible) this.move(pointer.wheel > 0 ? 1 : -1);
    for (let k = 0; k < this.anim.length; k++) this.anim[k] = lerp(this.anim[k], k === this.i ? 1 : 0, 0.25);
  }
  activate(it) {
    if (it.action) {
      sfx('uiSelect');
      it.action();
    } else if (it.right) {
      it.right();
      sfx('uiMove');
    }
  }
  draw(ctx) {
    this.rects.length = 0;
    const n = this.items.length;
    if (this.i < this.scroll) this.scroll = this.i;
    if (this.i >= this.scroll + this.maxVisible) this.scroll = this.i - this.maxVisible + 1;
    for (let k = 0; k < n; k++) {
      const vis = k - this.scroll;
      if (vis < 0 || vis >= this.maxVisible) continue;
      const it = this.items[k];
      const a = this.anim[k] || 0;
      const x = this.x + a * 18;
      const y = this.y + vis * (this.h + this.gap);
      const w = this.w;
      const dis = it.disabled?.();
      this.rects[k] = { x: this.x, y, w: w + 18, h: this.h };
      ctx.save();
      skewPanel(ctx, x, y, w, this.h, this.skew);
      const g = ctx.createLinearGradient(x, 0, x + w, 0);
      if (a > 0.05) {
        g.addColorStop(0, rgba(it.color || C.accent, 0.95 * a));
        g.addColorStop(1, rgba(it.color || C.accent, 0.25 * a));
      } else {
        g.addColorStop(0, 'rgba(12,10,24,0.82)');
        g.addColorStop(1, 'rgba(12,10,24,0.55)');
      }
      ctx.fillStyle = a > 0.05 ? g : 'rgba(12,10,24,0.78)';
      ctx.fill();
      ctx.strokeStyle = a > 0.5 ? '#fff' : C.line;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
      const col = dis ? 'rgba(255,255,255,0.3)' : a > 0.5 ? '#0b0b12' : '#fff';
      text(ctx, it.label, x + 30, y + this.h / 2 + 1, { size: this.size, align: 'left', color: col, font: FONT_UI });
      if (it.value) {
        const v = it.value();
        const vx = x + w - 34;
        text(ctx, (it.left ? '◀  ' : '') + v + (it.right ? '  ▶' : ''), vx, y + this.h / 2 + 1, { size: this.size * 0.78, align: 'right', color: a > 0.5 ? '#0b0b12' : C.accent, font: FONT_UI });
      }
      if (it.badge) text(ctx, it.badge, x + w - 30, y + this.h / 2, { size: 14, align: 'right', color: a > 0.5 ? '#0b0b12' : C.accent2, font: FONT_UI });
    }
    if (n > this.maxVisible) {
      const total = this.maxVisible * (this.h + this.gap);
      const sh = total * (this.maxVisible / n);
      const sy = this.y + (total - sh) * (this.scroll / (n - this.maxVisible));
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillRect(this.x + this.w + 30, this.y, 4, total);
      ctx.fillStyle = C.accent;
      ctx.fillRect(this.x + this.w + 30, sy, 4, sh);
    }
  }
  current() {
    return this.items[this.i];
  }
}

// ---------------------------------------------------------------------------
// Toasts (achievements, unlocks, coin rewards)
// ---------------------------------------------------------------------------
export class Toasts {
  constructor() {
    this.list = [];
  }
  push(titleStr, body, color = C.accent, icon = '★') {
    this.list.push({ title: titleStr, body, color, icon, t: 0, life: 260 });
    if (this.list.length > 4) this.list.shift();
  }
  update() {
    for (const t of this.list) t.t++;
    this.list = this.list.filter((t) => t.t < t.life);
  }
  draw(ctx, view) {
    // stack upward from the bottom centre (clear of HUD bars and side panels)
    let y = view.h - 150;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const t = this.list[i];
      const k = t.t < 16 ? ease.back(t.t / 16) : t.t > t.life - 20 ? 1 - (t.t - (t.life - 20)) / 20 : 1;
      const w = 380, h = 70;
      const x = view.w / 2 - w / 2;
      ctx.save();
      ctx.globalAlpha = clamp(k, 0, 1);
      ctx.translate(0, (1 - clamp(k, 0, 1)) * 40);
      panel(ctx, x, y, w, h, { fill: 'rgba(12,10,24,0.94)', stroke: t.color, r: 12 });
      text(ctx, t.icon, x + 36, y + h / 2 + 2, { size: 30, color: t.color, font: FONT_BIG });
      text(ctx, t.title, x + 66, y + 24, { size: 18, align: 'left', color: t.color, font: FONT_UI });
      text(ctx, t.body, x + 66, y + 48, { size: 16, align: 'left', color: '#fff', font: FONT_BODY });
      ctx.restore();
      y -= h + 10;
    }
  }
}

// Animated menu backdrop when no live demo is available
export function backdrop(ctx, view, t, hue = '#1a1030') {
  const g = ctx.createLinearGradient(0, 0, view.w, view.h);
  g.addColorStop(0, '#0b0816');
  g.addColorStop(1, hue);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, view.w, view.h);
  ctx.save();
  ctx.globalAlpha = 0.07;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 40;
  for (let i = -4; i < 14; i++) {
    const x = ((i * 160 + t * 0.6) % (view.w + 400)) - 200;
    ctx.beginPath();
    ctx.moveTo(x, -20);
    ctx.lineTo(x - 300, view.h + 20);
    ctx.stroke();
  }
  ctx.restore();
}

export function vignette(ctx, view, a = 0.6) {
  const g = ctx.createRadialGradient(view.w / 2, view.h / 2, view.h * 0.3, view.w / 2, view.h / 2, view.w * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${a})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, view.w, view.h);
}

export function wrapText(ctx, str, x, y, maxW, lineH, opts = {}) {
  ctx.font = `${opts.size || 18}px ${opts.font || FONT_BODY}`;
  const words = str.split(' ');
  let line = '';
  let yy = y;
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      text(ctx, line, x, yy, { align: 'left', base: 'top', font: FONT_BODY, ...opts });
      line = w;
      yy += lineH;
    } else line = test;
  }
  if (line) text(ctx, line, x, yy, { align: 'left', base: 'top', font: FONT_BODY, ...opts });
  return yy + lineH;
}

export { clamp, lerp, ease, rgba, shade };
