// Fighter accessories: signature gear (headbands, scarves, hoods...) plus
// cosmetic hats bought in the shop. Cloth uses verlet strands.

import { Strand } from './skeleton.js';
import { shade, TAU, rand } from './util.js';

function headFrame(J) {
  // unit vectors: "up" of the head (from neck to head) and "forward"
  const ux = (J.headX - J.neckTopX), uy = (J.headY - J.neckTopY);
  const l = Math.hypot(ux, uy) || 1;
  const upx = ux / l, upy = uy / l;
  // forward = up rotated toward facing
  const fx = -upy * -J.facing, fy = upx * -J.facing;
  return { upx, upy, fx: fx, fy: fy };
}

// --- signature pieces -------------------------------------------------------
const PIECES = {
  headband: {
    strands: () => [new Strand(7, 7, { gravity: 0.28, drag: 0.9 }), new Strand(6, 7, { gravity: 0.3, drag: 0.9 })],
    anchor(J, i) {
      const h = headFrame(J);
      const r = J.headR;
      const bx = J.headX - h.fx * r * 0.9 + h.upx * r * 0.25;
      const by = J.headY - h.fy * r * 0.9 + h.upy * r * 0.25;
      return [bx + (i ? h.upx * 3 : 0), by + (i ? h.upy * 3 : 0)];
    },
    behind(ctx, J, look, acc) {
      acc.strands.forEach((s, i) => s.draw(ctx, i ? shade(look.accent, -0.2) : look.accent, 5 * J.scale, 2.5 * J.scale, look.outline));
    },
    front(ctx, J, look) {
      const h = headFrame(J);
      const r = J.headR;
      ctx.save();
      ctx.translate(J.headX + h.upx * r * 0.25, J.headY + h.upy * r * 0.25);
      ctx.rotate(Math.atan2(h.upy, h.upx) + Math.PI / 2);
      ctx.fillStyle = look.outline;
      ctx.fillRect(-r - 2, -4.5 * J.scale, 2 * r + 4, 9 * J.scale);
      ctx.fillStyle = look.flash ? '#fff' : look.accent;
      ctx.fillRect(-r - 0.5, -3 * J.scale, 2 * r + 1, 6 * J.scale);
      ctx.restore();
    },
  },
  scarf: {
    strands: () => [new Strand(10, 8, { gravity: 0.22, drag: 0.92 }), new Strand(8, 7, { gravity: 0.25, drag: 0.92 })],
    anchor(J, i) {
      return [J.neckX - J.facing * 4 * J.scale, J.neckY - 3 * J.scale - i * 3];
    },
    behind(ctx, J, look, acc) {
      acc.strands.forEach((s, i) => s.draw(ctx, i ? shade(look.accent, -0.25) : look.accent, 7 * J.scale, 3 * J.scale, look.outline));
    },
    front(ctx, J, look) {
      ctx.fillStyle = look.outline;
      ctx.beginPath();
      ctx.ellipse(J.neckTopX, J.neckTopY + 1, 11 * J.scale, 7 * J.scale, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = look.flash ? '#fff' : look.accent;
      ctx.beginPath();
      ctx.ellipse(J.neckTopX, J.neckTopY + 1, 9 * J.scale, 5 * J.scale, 0, 0, TAU);
      ctx.fill();
    },
  },
  ponytail: {
    strands: () => [new Strand(7, 7, { gravity: 0.4, drag: 0.88 })],
    anchor(J) {
      const h = headFrame(J);
      const r = J.headR;
      return [J.headX - h.fx * r * 0.8 + h.upx * r * 0.6, J.headY - h.fy * r * 0.8 + h.upy * r * 0.6];
    },
    behind(ctx, J, look, acc) {
      acc.strands[0].draw(ctx, look.hair || shade(look.color, -0.45), 8 * J.scale, 3 * J.scale, look.outline);
    },
    front(ctx, J, look) {
      // hair cap
      const h = headFrame(J);
      ctx.save();
      ctx.beginPath();
      ctx.arc(J.headX, J.headY, J.headR + 1, Math.atan2(h.upy, h.upx) - 1.9, Math.atan2(h.upy, h.upx) + 1.9);
      ctx.closePath();
      ctx.fillStyle = look.flash ? '#fff' : look.hair || shade(look.color, -0.45);
      ctx.fill();
      ctx.restore();
      const a = PIECES.ponytail.anchor(J);
      ctx.fillStyle = look.flash ? '#fff' : look.accent;
      ctx.beginPath();
      ctx.arc(a[0], a[1], 4 * J.scale, 0, TAU);
      ctx.fill();
    },
  },
  hood: {
    strands: () => [new Strand(9, 9, { gravity: 0.3, drag: 0.9 })],
    anchor(J) {
      return [J.neckX - J.facing * 6 * J.scale, J.neckY];
    },
    behind(ctx, J, look, acc) {
      acc.strands[0].draw(ctx, look.cloak || shade(look.accent, -0.35), 16 * J.scale, 6 * J.scale, look.outline);
    },
    front(ctx, J, look) {
      const h = headFrame(J);
      const r = J.headR;
      const cx = J.headX, cy = J.headY;
      const ang = Math.atan2(h.upy, h.upx);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ang + Math.PI / 2);
      ctx.scale(J.facing, 1);
      ctx.beginPath();
      ctx.moveTo(-r * 1.25, r * 0.5);
      ctx.quadraticCurveTo(-r * 1.4, -r * 1.2, -r * 0.2, -r * 1.6);
      ctx.quadraticCurveTo(r * 0.9, -r * 1.5, r * 1.05, -r * 0.2);
      ctx.lineTo(r * 0.5, -r * 0.35);
      ctx.quadraticCurveTo(-r * 0.2, -r * 0.6, -r * 0.4, r * 0.7);
      ctx.closePath();
      ctx.lineWidth = 3;
      ctx.strokeStyle = look.outline;
      ctx.stroke();
      ctx.fillStyle = look.flash ? '#fff' : look.cloak || shade(look.accent, -0.35);
      ctx.fill();
      ctx.restore();
    },
  },
  spiky: {
    front(ctx, J, look) {
      const h = headFrame(J);
      const r = J.headR;
      ctx.save();
      ctx.translate(J.headX, J.headY);
      ctx.rotate(Math.atan2(h.upy, h.upx) + Math.PI / 2);
      ctx.scale(J.facing, 1);
      ctx.beginPath();
      const spikes = [[-1.2, 0.1], [-1.5, -0.9], [-0.7, -0.8], [-0.6, -1.8], [0.05, -1.0], [0.4, -1.9], [0.6, -0.9], [1.4, -1.2], [1.0, -0.2]];
      ctx.moveTo(-r * 1.0, r * 0.1);
      for (const [x, y] of spikes) ctx.lineTo(x * r, y * r);
      ctx.lineTo(r * 0.9, -r * 0.1);
      ctx.quadraticCurveTo(0, -r * 0.9, -r, r * 0.1);
      ctx.closePath();
      ctx.lineWidth = 3;
      ctx.strokeStyle = look.outline;
      ctx.stroke();
      ctx.fillStyle = look.flash ? '#fff' : look.hair || look.accent;
      ctx.fill();
      ctx.restore();
    },
  },
  flame: {
    front(ctx, J, look) {
      const h = headFrame(J);
      const r = J.headR;
      const t = look.time || 0;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 6; i++) {
        const k = i / 5;
        const off = (k - 0.5) * r * 1.6;
        const fl = r * (1.2 + Math.sin(t * 0.3 + i * 1.7) * 0.35) * (1 - Math.abs(k - 0.45) * 0.9);
        const bx = J.headX + h.upx * r * 0.6 + h.fx * off * -0.2 - h.upy * off;
        const by = J.headY + h.upy * r * 0.6 + h.fy * off * -0.2 + h.upx * off;
        const tx = bx + h.upx * fl - J.facing * 4;
        const ty = by + h.upy * fl;
        const g = ctx.createLinearGradient(bx, by, tx, ty);
        g.addColorStop(0, look.accent);
        g.addColorStop(1, 'rgba(255,230,120,0)');
        ctx.strokeStyle = g;
        ctx.lineWidth = 7 * J.scale;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(tx, ty);
        ctx.stroke();
      }
      ctx.restore();
    },
  },
  beads: {
    front(ctx, J, look) {
      const n = 7;
      for (let i = 0; i < n; i++) {
        const a = (i / (n - 1)) * Math.PI;
        const x = J.neckX + Math.cos(a) * 10 * J.scale * J.facing;
        const y = J.neckY - 2 + Math.sin(a) * 7 * J.scale;
        ctx.fillStyle = look.outline;
        ctx.beginPath();
        ctx.arc(x, y, 4 * J.scale, 0, TAU);
        ctx.fill();
        ctx.fillStyle = look.flash ? '#fff' : i === 3 ? '#e04848' : '#a0652f';
        ctx.beginPath();
        ctx.arc(x, y, 2.7 * J.scale, 0, TAU);
        ctx.fill();
      }
    },
  },
  mask: {
    front(ctx, J, look) {
      const h = headFrame(J);
      const r = J.headR;
      ctx.save();
      ctx.translate(J.headX, J.headY);
      ctx.rotate(Math.atan2(h.upy, h.upx) + Math.PI / 2);
      ctx.scale(J.facing, 1);
      ctx.beginPath();
      ctx.moveTo(-r * 0.2, r * 0.05);
      ctx.lineTo(r * 1.08, r * 0.05);
      ctx.quadraticCurveTo(r * 0.9, r * 0.95, -r * 0.1, r * 0.95);
      ctx.closePath();
      ctx.fillStyle = look.flash ? '#fff' : look.mask || '#1d1d24';
      ctx.fill();
      // fangs
      ctx.fillStyle = look.flash ? '#fff' : look.accent;
      ctx.beginPath();
      ctx.moveTo(r * 0.45, r * 0.4);
      ctx.lineTo(r * 0.6, r * 0.8);
      ctx.lineTo(r * 0.75, r * 0.4);
      ctx.fill();
      ctx.restore();
    },
  },
  visor: {
    front(ctx, J, look) {
      const h = headFrame(J);
      const r = J.headR;
      // antenna
      const ax = J.headX + h.upx * r - h.fx * r * 0.4, ay = J.headY + h.upy * r - h.fy * r * 0.4;
      ctx.strokeStyle = look.outline;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax + h.upx * 14 - J.facing * 4, ay + h.upy * 14);
      ctx.stroke();
      ctx.strokeStyle = look.flash ? '#fff' : '#9aa3ad';
      ctx.lineWidth = 2;
      ctx.stroke();
      const blink = Math.floor((look.time || 0) / 20) % 2 === 0;
      ctx.fillStyle = blink ? look.accent : '#552';
      ctx.beginPath();
      ctx.arc(ax + h.upx * 15 - J.facing * 4, ay + h.upy * 15, 3.2, 0, TAU);
      ctx.fill();
    },
  },
  horns: {
    front(ctx, J, look) {
      const h = headFrame(J);
      const r = J.headR;
      ctx.save();
      ctx.translate(J.headX, J.headY);
      ctx.rotate(Math.atan2(h.upy, h.upx) + Math.PI / 2);
      ctx.scale(J.facing, 1);
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * r * 0.5 - r * 0.2, -r * 0.7);
        ctx.quadraticCurveTo(s * r * 1.4, -r * 1.3, s * r * 1.1 + r * 0.3, -r * 2.2);
        ctx.quadraticCurveTo(s * r * 0.9, -r * 1.2, s * r * 0.1, -r * 0.85);
        ctx.closePath();
        ctx.lineWidth = 3;
        ctx.strokeStyle = look.outline;
        ctx.stroke();
        ctx.fillStyle = look.flash ? '#fff' : look.horn || '#e8e0d0';
        ctx.fill();
      }
      ctx.restore();
    },
  },
  beard: {
    front(ctx, J, look) {
      const h = headFrame(J);
      const r = J.headR;
      ctx.save();
      ctx.translate(J.headX, J.headY);
      ctx.rotate(Math.atan2(h.upy, h.upx) + Math.PI / 2);
      ctx.scale(J.facing, 1);
      ctx.beginPath();
      ctx.moveTo(-r * 0.2, r * 0.2);
      ctx.quadraticCurveTo(r * 1.1, r * 0.2, r * 0.9, r * 0.6);
      ctx.quadraticCurveTo(r * 0.6, r * 1.6, r * 0.1, r * 1.5);
      ctx.quadraticCurveTo(-r * 0.4, r * 1.0, -r * 0.2, r * 0.2);
      ctx.closePath();
      ctx.lineWidth = 3;
      ctx.strokeStyle = look.outline;
      ctx.stroke();
      ctx.fillStyle = look.flash ? '#fff' : look.hair || '#5b3a1e';
      ctx.fill();
      ctx.restore();
    },
  },
  shades: {
    front(ctx, J, look) {
      const h = headFrame(J);
      const r = J.headR;
      ctx.save();
      ctx.translate(J.headX, J.headY);
      ctx.rotate(Math.atan2(h.upy, h.upx) + Math.PI / 2);
      ctx.scale(J.facing, 1);
      ctx.fillStyle = '#111';
      ctx.fillRect(-r * 0.1, -r * 0.35, r * 1.15, r * 0.42);
      ctx.fillStyle = look.accent;
      ctx.globalAlpha = 0.7;
      ctx.fillRect(r * 0.15, -r * 0.3, r * 0.6, r * 0.12);
      ctx.restore();
    },
  },
};

// --- cosmetic hats ---------------------------------------------------------
export const HATS = {
  none: { name: 'None', price: 0 },
  crown: { name: 'Golden Crown', price: 600 },
  halo: { name: 'Halo', price: 800 },
  tophat: { name: 'Top Hat', price: 450 },
  catears: { name: 'Cat Ears', price: 350 },
  kasa: { name: 'Straw Hat', price: 400 },
  devil: { name: 'Devil Horns', price: 500 },
  cap: { name: 'Backwards Cap', price: 300 },
  flower: { name: 'Flower', price: 250 },
  party: { name: 'Party Hat', price: 200 },
  propeller: { name: 'Propeller Cap', price: 700 },
  ninja: { name: 'Ninja Band', price: 350 },
};

function drawHat(ctx, J, look, id) {
  const h = headFrame(J);
  const r = J.headR;
  const t = look.time || 0;
  ctx.save();
  ctx.translate(J.headX, J.headY);
  ctx.rotate(Math.atan2(h.upy, h.upx) + Math.PI / 2);
  ctx.scale(J.facing, 1);
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#0b0b12';
  const fill = (c) => {
    ctx.stroke();
    ctx.fillStyle = look.flash ? '#fff' : c;
    ctx.fill();
  };
  switch (id) {
    case 'crown':
      ctx.beginPath();
      ctx.moveTo(-r * 0.9, -r * 0.7);
      ctx.lineTo(-r * 1.0, -r * 1.7);
      ctx.lineTo(-r * 0.45, -r * 1.2);
      ctx.lineTo(0, -r * 1.9);
      ctx.lineTo(r * 0.45, -r * 1.2);
      ctx.lineTo(r * 1.0, -r * 1.7);
      ctx.lineTo(r * 0.9, -r * 0.7);
      ctx.closePath();
      fill('#ffcc33');
      ctx.fillStyle = '#e8364f';
      ctx.beginPath();
      ctx.arc(0, -r * 1.05, r * 0.16, 0, TAU);
      ctx.fill();
      break;
    case 'halo':
      ctx.restore();
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = '#fff3a0';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(J.headX + h.upx * r * 1.7, J.headY + h.upy * r * 1.7 + Math.sin(t * 0.08) * 2, r * 1.1, r * 0.35, Math.atan2(h.upy, h.upx) + Math.PI / 2, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 10;
      ctx.stroke();
      break;
    case 'tophat':
      ctx.beginPath();
      ctx.rect(-r * 1.25, -r * 1.05, r * 2.5, r * 0.35);
      fill('#1b1b22');
      ctx.beginPath();
      ctx.rect(-r * 0.75, -r * 2.6, r * 1.5, r * 1.6);
      fill('#22222b');
      ctx.fillStyle = look.accent;
      ctx.fillRect(-r * 0.75, -r * 1.35, r * 1.5, r * 0.3);
      break;
    case 'catears':
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * r * 0.2, -r * 0.95);
        ctx.lineTo(s * r * 0.75, -r * 1.75);
        ctx.lineTo(s * r * 0.95, -r * 0.6);
        ctx.closePath();
        fill(look.color);
        ctx.fillStyle = '#ff9fc0';
        ctx.beginPath();
        ctx.moveTo(s * r * 0.4, -r * 0.95);
        ctx.lineTo(s * r * 0.72, -r * 1.45);
        ctx.lineTo(s * r * 0.82, -r * 0.8);
        ctx.fill();
      }
      break;
    case 'kasa':
      ctx.beginPath();
      ctx.moveTo(-r * 2.0, -r * 0.55);
      ctx.lineTo(0, -r * 1.9);
      ctx.lineTo(r * 2.0, -r * 0.55);
      ctx.quadraticCurveTo(0, -r * 0.85, -r * 2.0, -r * 0.55);
      fill('#d9b46a');
      ctx.strokeStyle = 'rgba(120,80,30,0.6)';
      ctx.lineWidth = 1.5;
      for (let i = -3; i <= 3; i++) {
        ctx.beginPath();
        ctx.moveTo(0, -r * 1.85);
        ctx.lineTo(i * r * 0.55, -r * 0.7);
        ctx.stroke();
      }
      break;
    case 'devil':
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * r * 0.3, -r * 0.9);
        ctx.quadraticCurveTo(s * r * 0.9, -r * 1.3, s * r * 0.75, -r * 1.85);
        ctx.quadraticCurveTo(s * r * 0.6, -r * 1.25, s * r * 0.75, -r * 0.7);
        ctx.closePath();
        fill('#e0263b');
      }
      break;
    case 'cap':
      ctx.beginPath();
      ctx.arc(0, -r * 0.2, r * 1.05, Math.PI, 0);
      ctx.closePath();
      fill(look.accent);
      ctx.beginPath();
      ctx.rect(-r * 2.0, -r * 0.35, r * 1.2, r * 0.3);
      fill(shade(look.accent, -0.3));
      break;
    case 'flower':
      ctx.translate(r * 0.6, -r * 0.8);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU + t * 0.01;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r * 0.32, Math.sin(a) * r * 0.32, r * 0.28, 0, TAU);
        fill('#ff7eb6');
      }
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.2, 0, TAU);
      fill('#ffe066');
      break;
    case 'party':
      ctx.beginPath();
      ctx.moveTo(-r * 0.7, -r * 0.75);
      ctx.lineTo(r * 0.1, -r * 2.5);
      ctx.lineTo(r * 0.8, -r * 0.7);
      ctx.closePath();
      fill('#7b5cff');
      ctx.fillStyle = '#ffe066';
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(-r * 0.2 + i * r * 0.25, -r * (1.0 + i * 0.45), r * 0.12, 0, TAU);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(r * 0.1, -r * 2.55, r * 0.22, 0, TAU);
      fill('#ff5c8a');
      break;
    case 'propeller': {
      ctx.beginPath();
      ctx.arc(0, -r * 0.3, r * 1.0, Math.PI, 0);
      ctx.closePath();
      fill('#e63946');
      ctx.fillStyle = '#ffd60a';
      ctx.fillRect(-r * 0.1, -r * 1.6, r * 0.2, r * 0.4);
      const sp = Math.sin(t * 0.6);
      ctx.beginPath();
      ctx.ellipse(0, -r * 1.65, r * 1.2 * Math.abs(sp) + 2, r * 0.18, 0, 0, TAU);
      fill('#3a86ff');
      break;
    }
    case 'ninja':
      ctx.beginPath();
      ctx.rect(-r * 1.08, -r * 0.6, r * 2.16, r * 0.45);
      fill('#2b2d42');
      ctx.fillStyle = '#c0c6d0';
      ctx.fillRect(r * 0.2, -r * 0.58, r * 0.55, r * 0.4);
      break;
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
export function createAccessories(def, skin, hatId = 'none') {
  const ids = def.accessories || [];
  const parts = ids.map((id) => {
    const P = PIECES[id];
    return { id, P, strands: P && P.strands ? P.strands() : [] };
  });
  let lastX = null;
  return {
    hat: hatId || 'none',
    reset() {
      for (const p of parts) for (const s of p.strands) s.inited = false;
      lastX = null;
    },
    update(J, f) {
      const wind = -(f.vx || 0) * 0.06 - J.facing * 0.06;
      // teleports: re-init strands
      if (lastX != null && Math.abs(J.hipX - lastX) > 120) this.reset();
      lastX = J.hipX;
      for (const p of parts) {
        p.strands.forEach((s, i) => {
          const [ax, ay] = p.P.anchor(J, i);
          s.update(ax, ay, -J.facing, 0, wind + (i ? 0.03 : 0));
        });
      }
    },
    drawBehind(ctx, J, look) {
      for (const p of parts) if (p.P && p.P.behind) p.P.behind(ctx, J, look, p);
    },
    drawFront(ctx, J, look) {
      for (const p of parts) if (p.P && p.P.front) p.P.front(ctx, J, look, p);
      if (this.hat && this.hat !== 'none') drawHat(ctx, J, look, this.hat);
    },
  };
}

export { drawHat, rand };
