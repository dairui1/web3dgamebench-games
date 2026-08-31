# Signal Drift

A browser-native 3D arcade flight game built with Three.js. Pilot a compact
courier craft through a storm-damaged relay field above an endless cloud sea:
restore three relay gates in order, keep your charge cell alive, dodge mines,
rotating cutters and arc lightning, then cross the extraction ring to win.

## Run

```bash
npm install        # dependencies are already vendored in node_modules
npm run dev        # dev server
npm run build      # type-checks and emits the static production build to dist/
npm run preview    # serves dist/
```

The production build is fully static and makes no runtime network requests.
All visuals are procedural (geometry, canvas textures, shaders) — no external
assets.

## Controls

| Action        | Desktop                    | Touch (390×844 verified)     |
| ------------- | -------------------------- | ---------------------------- |
| Steer         | `W A S D` / arrow keys     | drag left side of the screen |
| Boost         | hold `Shift`               | hold right side / BOOST      |
| Pause         | `P` / `Esc`                | pause overlay button         |
| Sound on/off  | `M`                        | —                            |
| Confirm/retry | `Enter` / `Space`          | overlay buttons              |

The page auto-pauses when it loses visibility. Audio (a small WebAudio synth)
is optional and only starts after the first user interaction.

## Gameplay

- Charge drains constantly; boosting drains faster. Collect amber charge cells
  (they magnetize toward you when close). At zero charge the craft is lost.
- Fly through the relay gates 1 → 2 → 3 in order; the active gate pulses amber
  with a beacon column. Restored gates glow cyan.
- Hazards: sweeping mines, spinning cutter blades at the corridor edge, and
  telegraphed arc-lightning strikes. Cloud-level surges push you up and cost
  charge. Straying far from the beacons also drains charge.
- Score: +15 per cell, +250 per relay, +1000 for extraction plus a time bonus.
- The course layout, hazard placement and lightning scheduling derive from the
  fixed seed `94721` (mulberry32 RNG), so every run has the same fair layout.

## Runtime inspection contract

`window.__WEB3DGAMEBENCH__` is updated every frame with a JSON-serializable
object: `phase` (`ready|playing|paused|won|lost`), `score`, `player {x,y,z}`,
`relaysRestored`, `charge`, `seed` (94721), `restartCount`, plus telemetry
(`speed`, `heading`, `pitch`, `elapsed`, `objective`, `target`, `offCourse`,
`cellsCollected`, `muted`).

## Testing

`tools/` contains the harness used to play the shipped build in headless
Chromium (raw CDP, no extra packages):

- `tools/serve.mjs` — static server for `dist/`
- `tools/drive.mjs desktop|phone` — full autopilot playthrough at 1440×900 and
  390×844 (touch emulation): verifies phases, ordered relays, win, restart,
  pause, movement, console cleanliness; screenshots land in `tools/shots/`
- `tools/visual.mjs` — captures boost/bank/defeat feedback moments

Both suites passed on the final build (`ALL CHECKS PASSED`).
