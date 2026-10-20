// In-fight HUD: health, stamina, meter, timer, round pips, combo counters,
// announcer text and the ultimate banner.

import { clamp, lerp, ease, shade, rgba } from './util.js';

export const FONT_BIG = '"Bangers", "Impact", "Arial Black", sans-serif';
export const FONT_UI = '"Russo One", "Arial Black", "Segoe UI", sans-serif';
export const FONT_BODY = '"Rajdhani", "Segoe UI", "Helvetica Neue", Arial, sans-serif';

export function text(ctx, str, x, y, { size = 24, font = FONT_UI, color = '#fff', align = 'center', base = 'middle', stroke = null, sw = 4, alpha = 1, shadow = null } = {}) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.font = `${size}px ${font}`;
  ctx.textAlign = align;
  ctx.textBaseline = base;
  if (shadow) {
    ctx.fillStyle = shadow;
    ctx.fillText(str, x + size * 0.06, y + size * 0.08);
  }
  if (stroke) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = sw;
    ctx.strokeStyle = stroke;
    ctx.strokeText(str, x, y);
  }
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
  ctx.restore();
}

function skewRect(ctx, x, y, w, h, skew) {
  ctx.beginPath();
  ctx.moveTo(x + skew, y);
  ctx.lineTo(x + w + skew, y);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
}

// Small head portrait (stick head in fighter colors)
export function drawPortrait(ctx, f, x, y, r, flip = false) {
  ctx.save();
  ctx.translate(x, y);
  if (flip) ctx.scale(-1, 1);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.arc(0, 0, r + 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = f.skin.accent;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = f.skin.outline || '#0b0b12';
  ctx.beginPath();
  ctx.arc(0, -2, r * 0.62 + 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = f.skin.color;
  ctx.beginPath();
  ctx.arc(0, -2, r * 0.62, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = f.skin.eye || '#fff';
  ctx.beginPath();
  ctx.ellipse(r * 0.28, -4, 2.6, 3.8, 0, 0, Math.PI * 2);
  ctx.fill();
  // shoulders
  ctx.strokeStyle = f.skin.outline || '#0b0b12';
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-r * 0.7, r * 0.95);
  ctx.quadraticCurveTo(0, r * 0.45, r * 0.7, r * 0.95);
  ctx.stroke();
  ctx.strokeStyle = f.skin.color;
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.restore();
}

export class HUD {
  constructor() {
    this.combo = [
      { hits: 0, dmg: 0, show: 0, last: 0 },
      { hits: 0, dmg: 0, show: 0, last: 0 },
    ];
    this.announce = null; // {text, sub, t, life, color, style}
    this.t = 0;
  }
  say(text, opts = {}) {
    this.announce = { text, sub: opts.sub || '', t: 0, life: opts.life || 80, color: opts.color || '#ffffff', size: opts.size || 120, style: opts.style || 'slam' };
  }
  update(match) {
    this.t++;
    const W = match.world;
    if (this.announce) {
      this.announce.t++;
      if (this.announce.t > this.announce.life) this.announce = null;
    }
    // combo tracking: index = attacker side
    for (let side = 0; side < 2; side++) {
      const def = W.fighters[1 - side];
      const c = this.combo[side];
      if (def.comboHits >= 2) {
        if (def.comboHits !== c.hits) c.pop = 8;
        c.hits = def.comboHits;
        c.dmg = def.comboDmg;
        c.show = 100;
        c.live = true;
      } else {
        if (c.live && c.hits >= 2) {
          c.show = 70;
          c.final = true;
          match.onComboEnd?.(side, c.hits, c.dmg);
        }
        c.live = false;
        if (c.show > 0) c.show--;
      }
      if (c.pop > 0) c.pop--;
    }
  }

  draw(ctx, view, match) {
    const W = match.world;
    const [a, b] = W.fighters;
    const hideBars = match.mode === 'demo';
    if (!hideBars) {
      this.drawSide(ctx, view, a, 0, match);
      this.drawSide(ctx, view, b, 1, match);
      this.drawTimer(ctx, view, match);
    }
    if (hideBars) return; // menu backdrop: just the action
    this.drawCombos(ctx, view);
    this.drawIndicators(ctx, view, match);
    if (W.banner) this.drawBanner(ctx, view, W.banner);
    if (this.announce) this.drawAnnounce(ctx, view);
  }

  drawSide(ctx, view, f, side, match) {
    const W = view.w;
    const mid = W / 2;
    const barW = Math.min(520, mid - 150);
    const barH = 26;
    const y = 34;
    const dir = side === 0 ? 1 : -1;
    const x0 = side === 0 ? mid - 62 - barW : mid + 62;
    const t = this.t;

    // portrait
    const px = side === 0 ? x0 - 36 : x0 + barW + 36;
    drawPortrait(ctx, f, px, y + 22, 26, side === 1);

    // name
    text(ctx, f.def.name, side === 0 ? x0 + 6 : x0 + barW - 6, y - 14, {
      size: 20, align: side === 0 ? 'left' : 'right', color: '#fff', stroke: '#000', sw: 4,
    });
    const tag = match.labels?.[side];
    if (tag) {
      text(ctx, tag, side === 0 ? x0 + 6 + ctx.measureText(f.def.name).width + 70 : x0 + barW - 80 - f.def.name.length * 14, y - 14, {
        size: 13, align: side === 0 ? 'left' : 'right', color: f.skin.accent, font: FONT_UI, stroke: '#000', sw: 3,
      });
    }

    // health frame
    ctx.save();
    const skew = side === 0 ? 10 : -10;
    skewRect(ctx, x0 - 4, y - 4, barW + 8, barH + 8, skew);
    ctx.fillStyle = 'rgba(8,8,16,0.85)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // trailing damage
    const pDisp = clamp(f.dispHp / f.maxHp, 0, 1);
    const pHp = clamp(f.hp / f.maxHp, 0, 1);
    ctx.save();
    skewRect(ctx, x0, y, barW, barH, skew);
    ctx.clip();
    const fillFrom = (p) => (side === 0 ? x0 + barW * (1 - p) : x0);
    ctx.fillStyle = '#ff2d3d';
    ctx.fillRect(fillFrom(pDisp), y, barW * pDisp, barH);
    const low = pHp < 0.25;
    const g = ctx.createLinearGradient(0, y, 0, y + barH);
    if (low) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 0.25);
      g.addColorStop(0, lerpColor('#ff8a3d', '#ffd23f', pulse));
      g.addColorStop(1, '#d6342a');
    } else {
      g.addColorStop(0, '#fff6a8');
      g.addColorStop(0.45, '#ffd23f');
      g.addColorStop(1, '#f08c00');
    }
    ctx.fillStyle = g;
    ctx.fillRect(fillFrom(pHp), y, barW * pHp, barH);
    // gloss
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(x0, y + 2, barW, 6);
    // segment ticks
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    for (let i = 1; i < 10; i++) ctx.fillRect(x0 + (barW * i) / 10, y, 2, barH);
    ctx.restore();
    ctx.restore();

    // round pips
    const need = match.roundsToWin;
    if (need > 1) {
      for (let i = 0; i < need; i++) {
        const won = i < match.wins[side];
        const cx = side === 0 ? x0 + barW - 12 - i * 26 : x0 + 12 + i * 26;
        const cy = y + barH + 18;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = won ? '#ffd23f' : 'rgba(0,0,0,0.6)';
        ctx.strokeStyle = won ? '#fff' : 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 2;
        ctx.fillRect(-7, -7, 14, 14);
        ctx.strokeRect(-7, -7, 14, 14);
        ctx.restore();
      }
    }

    // stamina
    const sw = barW * 0.62;
    const sx = side === 0 ? x0 + barW - sw : x0;
    const sy = y + barH + 8;
    ctx.fillStyle = 'rgba(8,8,16,0.8)';
    ctx.fillRect(sx - 2, sy - 2, sw + 4, 10);
    const ps = clamp(f.stamina / 100, 0, 1);
    ctx.fillStyle = f.tired ? (t % 20 < 10 ? '#6b7280' : '#9ca3af') : '#3ddc97';
    if (side === 0) ctx.fillRect(sx + sw * (1 - ps), sy, sw * ps, 6);
    else ctx.fillRect(sx, sy, sw * ps, 6);
    if (f.tired) {
      text(ctx, 'TIRED', side === 0 ? sx - 8 : sx + sw + 8, sy + 3, { size: 12, align: side === 0 ? 'right' : 'left', color: '#ff8a8a', stroke: '#000', sw: 3 });
    }

    // super meter (bottom)
    const mw = Math.min(330, W * 0.26);
    const mh = 16;
    const my = view.h - 40;
    const mx = side === 0 ? 40 : W - 40 - mw;
    const pm = clamp(f.meter / 100, 0, 1);
    ctx.save();
    skewRect(ctx, mx - 3, my - 3, mw + 6, mh + 6, side === 0 ? 8 : -8);
    ctx.fillStyle = 'rgba(8,8,16,0.85)';
    ctx.fill();
    ctx.strokeStyle = pm >= 1 ? f.skin.accent : 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 2;
    ctx.stroke();
    skewRect(ctx, mx, my, mw, mh, side === 0 ? 8 : -8);
    ctx.clip();
    const mg = ctx.createLinearGradient(mx, 0, mx + mw, 0);
    mg.addColorStop(0, shade(f.skin.accent, -0.3));
    mg.addColorStop(1, f.skin.accent);
    ctx.fillStyle = mg;
    if (side === 0) ctx.fillRect(mx, my, mw * pm, mh);
    else ctx.fillRect(mx + mw * (1 - pm), my, mw * pm, mh);
    if (pm >= 1) {
      ctx.fillStyle = `rgba(255,255,255,${0.25 + 0.25 * Math.sin(t * 0.2)})`;
      ctx.fillRect(mx, my, mw, mh);
    }
    // breaker notch
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(mx + mw / 2 - 1, my, 3, mh);
    ctx.restore();
    const label = pm >= 1 ? 'ULTIMATE READY' : pm >= 0.5 ? 'BREAKER READY' : 'POWER';
    text(ctx, label, side === 0 ? mx : mx + mw, my - 12, {
      size: 14, align: side === 0 ? 'left' : 'right', font: FONT_UI,
      color: pm >= 1 ? f.skin.accent : pm >= 0.5 ? '#ffffff' : 'rgba(255,255,255,0.6)',
      stroke: '#000', sw: 3, alpha: pm >= 1 ? 0.75 + 0.25 * Math.sin(t * 0.25) : 1,
    });
    const hint = match.keyHints?.[side];
    if (hint && pm >= 1) {
      text(ctx, hint, side === 0 ? mx + mw + 12 : mx - 12, my + mh / 2, { size: 13, align: side === 0 ? 'left' : 'right', color: '#fff', stroke: '#000', sw: 3, font: FONT_UI });
    }
  }

  drawTimer(ctx, view, match) {
    const cx = view.w / 2, cy = 46;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      ctx.lineTo(Math.cos(a) * 40, Math.sin(a) * 40);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(8,8,16,0.88)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    const tLeft = match.timeLeft;
    const s = tLeft === Infinity ? '∞' : String(Math.max(0, Math.ceil(tLeft / 60)));
    const urgent = tLeft !== Infinity && tLeft < 600;
    text(ctx, s, cx, cy + 2, {
      size: 40, font: FONT_BIG, color: urgent ? (this.t % 30 < 15 ? '#ff4d4d' : '#ffd23f') : '#ffffff', stroke: '#000', sw: 5,
    });
    if (match.subLabel) text(ctx, match.subLabel, cx, cy + 52, { size: 14, color: '#ffd23f', stroke: '#000', sw: 3 });
  }

  drawCombos(ctx, view) {
    for (let side = 0; side < 2; side++) {
      const c = this.combo[side];
      if (c.show <= 0 || c.hits < 2) continue;
      const alpha = clamp(c.show / 20, 0, 1);
      const x = side === 0 ? 70 : view.w - 70;
      const y = view.h * 0.36;
      const pop = 1 + (c.pop || 0) * 0.04;
      const align = side === 0 ? 'left' : 'right';
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(pop, pop);
      const hue = c.hits >= 20 ? '#ff4dd8' : c.hits >= 12 ? '#ff4d4d' : c.hits >= 6 ? '#ffb347' : '#ffd23f';
      text(ctx, String(c.hits), 0, 0, { size: 84, font: FONT_BIG, color: hue, align, stroke: '#000', sw: 8, alpha });
      ctx.font = `84px ${FONT_BIG}`;
      const wNum = ctx.measureText(String(c.hits)).width;
      text(ctx, 'HITS', side === 0 ? wNum + 10 : -wNum - 10, 14, { size: 34, font: FONT_BIG, color: '#fff', align, stroke: '#000', sw: 5, alpha });
      text(ctx, `${Math.round(c.dmg)} DMG`, 0, 56, { size: 22, font: FONT_UI, color: '#fff', align, stroke: '#000', sw: 4, alpha });
      const rank = c.hits >= 25 ? 'GODLIKE!' : c.hits >= 18 ? 'UNREAL!' : c.hits >= 12 ? 'SAVAGE!' : c.hits >= 8 ? 'BRUTAL!' : c.hits >= 5 ? 'NICE!' : '';
      if (rank) text(ctx, rank, 0, 90, { size: 30, font: FONT_BIG, color: hue, align, stroke: '#000', sw: 5, alpha });
      ctx.restore();
    }
  }

  drawIndicators(ctx, view, match) {
    const W = match.world;
    if (match.mode === 'demo') return;
    W.fighters.forEach((f, i) => {
      if (f.state === 'ko' || !f.visible) return;
      const [sx, sy] = W.cam.toScreen(f.x, f.J.headY ?? f.y - 160, view);
      const label = match.labels?.[i] || (i === 0 ? 'P1' : 'P2');
      const col = i === 0 ? '#4ab8ff' : '#ff5c6c';
      const y = sy - 34;
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(sx - 7, y + 10);
      ctx.lineTo(sx + 7, y + 10);
      ctx.lineTo(sx, y + 18);
      ctx.closePath();
      ctx.fill();
      text(ctx, label, sx, y, { size: 13, font: FONT_UI, color: col, stroke: '#000', sw: 3 });
      ctx.restore();
    });
  }

  drawBanner(ctx, view, b) {
    const t = b.t;
    const inK = ease.snap(clamp(t / 10, 0, 1));
    const outK = t > 50 ? ease.in(clamp((t - 50) / 20, 0, 1)) : 0;
    const dir = b.side === 0 ? 1 : -1;
    const y = view.h * 0.62;
    const h = 92;
    ctx.save();
    ctx.translate(view.w / 2 + dir * (-(1 - inK) * view.w + outK * view.w), y);
    ctx.rotate(-0.06 * dir);
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(-view.w, -h / 2 - 6, view.w * 2, h + 12);
    const g = ctx.createLinearGradient(-view.w / 2, 0, view.w / 2, 0);
    g.addColorStop(0, rgba(normHex(b.color), 0));
    g.addColorStop(0.5, rgba(normHex(b.color), 0.9));
    g.addColorStop(1, rgba(normHex(b.color), 0));
    ctx.fillStyle = g;
    ctx.fillRect(-view.w, -h / 2, view.w * 2, 4);
    ctx.fillRect(-view.w, h / 2 - 4, view.w * 2, 4);
    text(ctx, b.fighter + ' · ULTIMATE', 0, -24, { size: 18, font: FONT_UI, color: b.color, stroke: '#000', sw: 3 });
    text(ctx, b.name, 0, 14, { size: 64, font: FONT_BIG, color: '#ffffff', stroke: '#000', sw: 7, shadow: b.color });
    ctx.restore();
  }

  drawAnnounce(ctx, view) {
    const a = this.announce;
    const t = a.t;
    const cx = view.w / 2, cy = view.h * 0.42;
    let scale = 1, alpha = 1, rot = 0;
    if (a.style === 'slam') {
      scale = t < 8 ? lerp(2.6, 1, ease.out(t / 8)) : 1 + Math.max(0, (t - 8) / a.life) * 0.08;
      alpha = t > a.life - 12 ? (a.life - t) / 12 : clamp(t / 4, 0, 1);
      rot = t < 8 ? (1 - t / 8) * -0.08 : 0;
    } else if (a.style === 'grow') {
      scale = lerp(0.6, 1.1, ease.out(clamp(t / 30, 0, 1)));
      alpha = t > a.life - 15 ? (a.life - t) / 15 : clamp(t / 6, 0, 1);
    }
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.scale(scale, scale);
    text(ctx, a.text, 0, 0, { size: a.size, font: FONT_BIG, color: a.color, stroke: '#000', sw: 12, alpha, shadow: 'rgba(0,0,0,0.5)' });
    if (a.sub) text(ctx, a.sub, 0, a.size * 0.62, { size: Math.round(a.size * 0.28), font: FONT_UI, color: '#fff', stroke: '#000', sw: 5, alpha });
    ctx.restore();
  }
}

function normHex(c) {
  return c && c.startsWith('#') ? c : '#ffffff';
}
function lerpColor(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const r = Math.round(lerp((pa >> 16) & 255, (pb >> 16) & 255, t));
  const g = Math.round(lerp((pa >> 8) & 255, (pb >> 8) & 255, t));
  const bl = Math.round(lerp(pa & 255, pb & 255, t));
  return `rgb(${r},${g},${bl})`;
}
