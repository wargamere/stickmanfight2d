// Animated fighter showcase for menus (character select, locker, results).

import { Fighter } from './fighter.js';
import { World } from './world.js';
import { Controller } from './input.js';
import { getFighter } from './roster.js';

const VIEW = { w: 1280, h: 720 };

export class FighterPreview {
  constructor(id, { skin = 0, hat = 'none', mode = 'showcase', facing = 1 } = {}) {
    this.id = id;
    const def = getFighter(id);
    this.f = new Fighter(def, { side: 0, controller: new Controller(), skin: def.skins[skin] || def.skins[0], hat });
    this.d = new Fighter(getFighter('kai'), { side: 1, controller: new Controller() });
    this.world = new World({ arena: 'lab', fighters: [this.f, this.d], quality: 'high' });
    this.world.muted = true;
    this.world.infiniteStamina = [true, true];
    this.world.infiniteMeter = [false, false];
    this.f.x = 0;
    this.d.x = 980;
    this.d.visible = false;
    this.mode = mode;
    this.facing = facing;
    this.t = 0;
    this.step = 0;
    this.wait = 50;
    const sp = def.specials;
    const usable = ['S1', 'S3', 'S2'].filter((k) => sp[k] && sp[k].tag !== 'tp' && sp[k].tag !== 'heal');
    this.script = ['L1', 'LAUNCH', usable[0], 'L1', usable[1] || 'HEAVY', 'HEAVY', usable[2] || 'L1', 'DASHATK'].filter(Boolean);
    if (mode === 'victory') this.f.setState('victory');
    this.update(); // solve joints before the first draw
  }
  setSkin(idx, hat) {
    const def = this.f.def;
    this.f.skin = def.skins[idx] || def.skins[0];
    if (hat != null) this.f.acc.hat = hat;
  }
  update() {
    this.t++;
    const f = this.f, d = this.d;
    d.invuln = 999;
    d.x = 980;
    d.state = 'idle';
    f.facing = this.facing;
    if (this.mode === 'victory') {
      if (f.state !== 'victory') f.setState('victory');
    } else if (this.mode === 'idle') {
      if (f.state !== 'idle') f.setState('idle');
    } else if (f.state === 'idle' || f.state === 'walk') {
      if (--this.wait <= 0) {
        const mv = this.script[this.step % this.script.length];
        this.step++;
        f.startMove(mv, { free: true });
        this.chainLeft = mv === 'L1' ? 3 : 0;
        this.wait = 46;
      } else {
        // drift back to the centre
        f.x *= 0.9;
      }
    } else if (f.state === 'attack' && f.move?.chain && this.chainLeft > 0 && f.moveF >= f.move.chain.at + 2) {
      this.chainLeft--;
      f.startMove(f.move.chain.to, { free: true });
    }
    if (f.state === 'air' || f.state === 'land' || f.state === 'juggle') {
      /* physics handles it */
    }
    if (Math.abs(f.x) > 260 && f.grounded && f.state !== 'attack') f.x *= 0.85;
    f.facing = this.facing;
    this.world.tick(VIEW);
    if (Math.abs(f.x) > 600) f.x = 0;
  }
  draw(ctx, x, y, scale = 1) {
    const W = this.world;
    const f = this.f;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.translate(-f.x * 0.6, 0);
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(f.x, 2, 50 * f.scale, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    for (const e of W.ents) if (Math.abs(e.x - f.x) < 700) e.draw(ctx);
    W.fx.drawBack(ctx);
    W.fx.drawGhosts(ctx);
    W.drawFighter(ctx, f);
    if (f.trail.pts.length > 1) f.trail.draw(ctx, f.def.trailColor || f.skin.accent, 0.75);
    W.fx.drawFront(ctx);
    ctx.restore();
  }
}
