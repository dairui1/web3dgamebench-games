# Signal Drift

A browser-native 3D courier run built with Three.js. You fly a compact craft
through a storm-damaged relay corridor suspended above an endless cloud layer:
ignite three relay gates **in order**, keep the cells charged, dodge drifting
drones and sweeping arc bars, then cross the extraction ring.

Everything is procedural — geometry, materials, sky, clouds, particles and
audio are generated at runtime. No images, fonts, models or data are fetched.

## Run it

```bash
npm install      # dependencies are already vendored in node_modules
npm run dev      # dev server on 127.0.0.1
npm run build    # type-check + static production build into dist/
npm run preview  # serve dist/
```

`dist/` is fully static: one HTML file, one CSS bundle, one JS bundle.

## Controls

| Action | Desktop | Touch |
| --- | --- | --- |
| Steer / climb | `W A S D` or arrow keys | drag anywhere on the field |
| Boost | `Space` / `Shift` | hold **BOOST** |
| Brake | `X` / `Ctrl` | hold **BRAKE** |
| Start / restart | `Enter`, `R` | tap **Engage**, tap the field |
| Pause | `P` / `Esc` | pause card button |
| Sound | `M` | **Sound** toggle |

The game pauses itself when the tab loses visibility. Audio is synthesised with
the Web Audio API and only starts after the first user gesture.

## The loop

- **Charge** drains constantly (faster while boosting and after each relay).
  Mint motes strung along the corridor top it back up; chaining pickups
  multiplies their score.
- **Relays** must be flown through in order. Each aperture sits off the centre
  line, so the HUD calls out the alignment; miss one and you loop the corridor
  and try again.
- **Damage** comes from hazards (a charge hit, a shove, a shake) and from
  scraping the corridor wall (continuous drain, red wash).
- **Extraction** opens once all three relays are online. Cross it to win; score
  rewards remaining charge and a fast run.

## Structure

```
src/
  main.ts              boot + WebGL failure fallback
  game.ts              simulation, camera, phases, telemetry
  core/                rng, input (keyboard/pointer/touch), synthesised audio
  entities/craft.ts    procedural courier craft
  world/course.ts      closed spline corridor + corridor-space maths
  world/track.ts       rails, hoops, chevrons, boundary shell, wreckage
  world/entities.ts    relay gates, charge motes, hazards
  world/environment.ts sky dome, cloud deck, lightning, lighting rig, env map
  fx/particles.ts      point-sprite particles + corridor speed streaks
  fx/post.ts           bloom + chromatic aberration / damage / vignette pass
  ui/hud.ts            HUD, overlays, touch pad
tools/                 dev-only CDP scripts used to play-test the build
```

Rendering scales itself down (resolution → bloom → whole post stack) if frames
run long, so the game stays responsive on weak GPUs and software renderers.
`?q=high` or `?q=low` pins the graphics level.

## Runtime inspection

`window.__AETHERPLAY__` is updated every frame:

```jsonc
{
  "phase": "ready|playing|paused|won|lost",
  "score": 0,
  "player": { "x": 0, "y": 0, "z": 0 },
  "relaysRestored": 0,      // 0..3
  "charge": 100,
  "seed": 94721,
  "restartCount": 0,
  // extras
  "speed": 56, "objective": "Relay 01 · 297 m", "elapsed": 0,
  "lap": 0, "distanceToTarget": 297, "lateral": 0, "vertical": 0,
  "hits": 0, "motes": 0, "fps": 60
}
```
