# Stickman Fight 2D

A fast, deep, juicy 2D stickman fighting game that runs in any modern browser.
It has **no image or audio files**: the fighters, stages, effects, music and
sound effects are all generated in code.

It started from studying the browser hit *Stickman Kombat 2D*: 1P/2P fights,
combos, specials, blocking, breakers, stamina and fighter-unlocking towers. It
keeps that pick-up-and-play core and adds a lot more depth, content and polish.
All fighters, art, audio and code here are original.

![modes](https://img.shields.io/badge/modes-towers%20·%20quick%20fight%20·%20versus%20·%20survival%20·%20training-ffd23f)
![fighters](https://img.shields.io/badge/fighters-12-ff4d6d)
![input](https://img.shields.io/badge/input-keyboard%20·%20gamepad%20·%20touch-4ab8ff)

## Play

```bash
npm install
npm start            # http://localhost:8080
```

Or build one self-contained file that runs straight from disk (double-click it):

```bash
npm run build        # → dist/index.html
```

## What's in it

| | |
|---|---|
| **12 original fighters** | KAI, ROSA, NYX, BRUTUS, VOLT, YUKI, IGNIS, ZEN, VIPER, MORTIS, UNIT-7 and the final boss OMEGA. Each has their own stats, weapon, three ground specials, an air special, a cinematic ultimate, four skins and their own accessories (cloth headbands, scarves and hoods simulated with verlet physics) |
| **9 towers** | 5–8 floors each, with **modifiers** (Low Gravity, Glass Cannon, Turbo, Giant, Toxic Air, Mirror Match…) and a champion at the top who joins your roster when you win |
| **Quick Fight** | Any matchup, any stage, five CPU difficulties from Rookie to Nightmare |
| **Versus** | Two players on one keyboard, or one gamepad each |
| **Survival** | Endless waves where your health carries over, with a boss every 5 waves |
| **Daily Challenge** | A new opponent, stage and modifier pair every day, with bonus coins for keeping a streak |
| **Training** | Dummy modes (stand / block / random / jump / air recover / CPU), hitbox view, infinite power, auto refill |
| **Progression** | Coins, a Locker with fighters, skins and 11 hats, 26 achievements, lifetime stats, all saved locally |
| **10 animated stages** | Parallax backgrounds with weather, lighting and props that react to big hits |
| **Procedural audio** | Synthesized hit sounds, element effects and announcer stings, plus six procedural music tracks that get more intense at low health |

### Combat system

- **Frame-data driven.** Every move has startup, active and recovery frames, and hitboxes come from the animated skeleton itself.
- **Chains and rhythm.** ATK×4 strings. Press ATK inside the chain window instead of mashing early and you get +12% damage.
- **Launchers and juggles.** DOWN+ATK launches. Jump-cancel into air strings that spike for **ground bounces**, and finishers cause **wall splats**. Damage and hitstun scale down as a combo goes on, so infinite combos aren't possible.
- **Cancels.** Cancel any landed normal into a special, and any hit into your ultimate.
- **Defense.** Hold to block (it drains stamina, and an empty bar means a guard break). **Tap block right before impact to parry**: the attacker is stunned and projectiles fly back at them. Blocking can't turn around, so cross-ups beat it.
- **Breakers.** Spend half a power bar to blast out of a combo.
- **Throws.** Throws beat blocking, can be thrown backwards, and can be escaped.
- **Movement.** Dash or run, invincible back-dash, double jump, air dash, fast fall and wall jump.
- **Ultimates.** A super-flash freeze and an ultimate name banner, then a scripted cinematic with camera work if the first hit connects.
- **Juice.** Hit-stop, trauma screen shake, camera kicks, sparks, slash trails, afterimages, damage numbers, slow-motion KOs and **ragdoll physics** on knockout.

## Controls

| Action | Solo / vs CPU | Versus P1 | Versus P2 | Gamepad |
|---|---|---|---|---|
| Move | A D / ← → | A D | ← → | Stick / D-pad |
| Jump | W / ↑ | W | ↑ | A |
| Block (hold) · Parry (tap) | S / ↓ | S | ↓ | Down |
| Attack | J / Z | F | K / Num1 | X |
| Special | K / X | G | L / Num2 | Y |
| Ultimate | L / C | H | ; / Num3 | LT / RT |
| Dash | Space / Shift | Space | J / Num0 | B / RB |
| Throw · Breaker | J+K / U | F+G / R | K+L / I | LB |
| Pause | Esc / P | | | Start |

Directions change what a button does: **DOWN+ATK** launcher, **BACK+ATK** power strike,
**BACK+SPC** / **DOWN+SPC** extra specials, and ATK in the air or **DOWN+ATK** for a dive.
All keys can be rebound under *Settings → Controls*. On phones and tablets a
virtual joystick and buttons appear automatically.

## Development

```bash
npm test             # unit tests: IK, move data, roster/tower integrity, input buffering, AI
npm run test:e2e     # headless Chromium: real keyboard combos, 12 full CPU matches, every screen
npm run build        # single-file production build
```

The code is plain ES modules with no framework. Each file has one job:

| File | Responsibility |
|---|---|
| `src/skeleton.js` | Pose → joints (2-bone IK), stickman and weapon rendering, cloth strands |
| `src/poses.js`, `src/moves.js` | Pose library and the shared move sets (frame data) |
| `src/roster.js` | The 12 fighters: stats, specials, ultimate cinematics |
| `src/fighter.js` | Fighter state machine, physics, animation |
| `src/world.js` | Combat resolution, entities, cinematics, rendering |
| `src/entities.js` | Projectiles, ground waves, delayed strikes, auras, mines, walls, beams |
| `src/ai.js` | CPU opponent (reaction-time perception, 5 difficulty levels) |
| `src/match.js`, `src/hud.js` | Rounds, timer, announcer, KO flow and the in-fight HUD |
| `src/scenes.js`, `src/ui.js` | Every menu and game mode, plus the canvas UI toolkit |
| `src/arenas.js`, `src/audio.js` | Procedural stages and the WebAudio sound and music engine |

The game simulates at a fixed 60 Hz and renders on a 720-pixel-tall virtual screen
that adapts to any aspect ratio.

## License

MIT
