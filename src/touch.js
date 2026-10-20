// On-screen touch controls: floating joystick + action buttons.

import { touchState } from './input.js';
import { FONT_UI } from './hud.js';

const BUTTONS = [
  { id: 'atk', label: 'ATK', dx: -120, dy: -115, r: 56, color: '#ff5c5c' },
  { id: 'spc', label: 'SPC', dx: -252, dy: -84, r: 44, color: '#4ab8ff' },
  { id: 'up', label: 'JUMP', dx: -112, dy: -252, r: 44, color: '#3ddc97' },
  { id: 'dash', label: 'DASH', dx: -246, dy: -206, r: 38, color: '#c58bff' },
  { id: 'ult', label: 'ULT', dx: -362, dy: -108, r: 36, color: '#ffd23f' },
  { id: 'grab', label: 'GRAB', dx: -362, dy: -210, r: 32, color: '#ff9a3c' },
];

const stick = { id: null, bx: 0, by: 0, x: 0, y: 0, active: false };
const owners = new Map(); // pointerId -> button id
let gameRef = null;
let viewRef = null;

function toVirtual(e) {
  const v = viewRef;
  return [((e.clientX * v.dpr) - v.ox) / v.scale, ((e.clientY * v.dpr) - v.oy) / v.scale];
}

function visible() {
  if (!gameRef) return false;
  const mode = gameRef.save.settings.touch;
  if (mode === 'off') return false;
  if (!gameRef.scene || !gameRef.scene.wantsTouch) return false;
  return mode === 'on' || touchState.enabled;
}

function buttonAt(x, y) {
  const v = viewRef;
  for (const b of BUTTONS) {
    const bx = v.w + b.dx, by = v.h + b.dy;
    if (Math.hypot(x - bx, y - by) < b.r + 14) return b;
  }
  return null;
}

function recompute() {
  const h = touchState.held;
  for (const k in h) h[k] = false;
  for (const id of owners.values()) if (id !== 'stick' && id !== 'pause') h[id] = true;
  if (stick.active) {
    const dx = stick.x - stick.bx, dy = stick.y - stick.by;
    const d = Math.hypot(dx, dy);
    if (d > 18) {
      const nx = dx / d, ny = dy / d;
      if (nx > 0.38) h.right = true;
      if (nx < -0.38) h.left = true;
      if (ny > 0.55) h.down = true;
      if (ny < -0.75 && d > 50) h.up = true;
    }
  }
}

export function initTouch(canvas, game) {
  gameRef = game;
  viewRef = game.view;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    if (game.save.settings.touch !== 'off') touchState.enabled = true;
    if (!visible()) return;
    const [x, y] = toVirtual(e);
    const v = viewRef;
    if (x > v.w - 100 && y > 50 && y < 136) {
      owners.set(e.pointerId, 'pause');
      game.scene?.onTouchPause?.();
      return;
    }
    const b = buttonAt(x, y);
    if (b) {
      owners.set(e.pointerId, b.id);
    } else if (x < v.w * 0.45 && stick.id == null) {
      stick.id = e.pointerId;
      stick.bx = x;
      stick.by = y;
      stick.x = x;
      stick.y = y;
      stick.active = true;
      owners.set(e.pointerId, 'stick');
    }
    recompute();
  });
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'touch') return;
    const own = owners.get(e.pointerId);
    if (!own) return;
    const [x, y] = toVirtual(e);
    if (own === 'stick') {
      stick.x = x;
      stick.y = y;
      // drag the base along when pulled far
      const dx = x - stick.bx, dy = y - stick.by;
      const d = Math.hypot(dx, dy);
      if (d > 90) {
        stick.bx = x - (dx / d) * 90;
        stick.by = y - (dy / d) * 90;
      }
    } else if (own !== 'pause') {
      // slide between buttons
      const b = buttonAt(x, y);
      if (b && b.id !== own) owners.set(e.pointerId, b.id);
    }
    recompute();
  });
  const end = (e) => {
    const own = owners.get(e.pointerId);
    if (!own) return;
    owners.delete(e.pointerId);
    if (own === 'stick') {
      stick.id = null;
      stick.active = false;
    }
    recompute();
  };
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}

export function drawTouch(ctx, view, game) {
  if (!visible()) return;
  ctx.save();
  // joystick
  const bx = stick.active ? stick.bx : 150, by = stick.active ? stick.by : view.h - 150;
  ctx.globalAlpha = stick.active ? 0.5 : 0.25;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(bx, by, 84, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 3;
  ctx.stroke();
  const kx = stick.active ? stick.x : bx, ky = stick.active ? stick.y : by;
  const dx = kx - bx, dy = ky - by;
  const d = Math.min(70, Math.hypot(dx, dy));
  const a = Math.atan2(dy, dx);
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(bx + Math.cos(a) * d, by + Math.sin(a) * d, 36, 0, Math.PI * 2);
  ctx.fill();
  // buttons
  const pressed = new Set(owners.values());
  for (const b of BUTTONS) {
    const x = view.w + b.dx, y = view.h + b.dy;
    const on = pressed.has(b.id);
    ctx.globalAlpha = on ? 0.75 : 0.38;
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.arc(x, y, b.r * (on ? 0.94 : 1), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.round(b.r * 0.42)}px ${FONT_UI}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(b.label, x, y + 1);
  }
  // pause
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(view.w - 50, 92, 24, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillRect(view.w - 58, 82, 6, 20);
  ctx.fillRect(view.w - 47, 82, 6, 20);
  ctx.restore();
}
