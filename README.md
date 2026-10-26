# Starhop

A small, bright space adventure for children: fly a toon spaceship between a handful of
planets, land, hop out as a bean astronaut, scan creatures and plants, collect crystals, ice and
star fruit, and help Pip at the outpost with a few quests. Think a very small *No Man's Sky* with
the flight feel of [Tachyon](https://github.com/vonRotter/tachyon) and the look of
[Couch Party Island](https://vonrotter.github.io/couch/). Little reading, English and Norwegian
(bokmål), optional read-aloud.

Live build: **https://vonrotter.github.io/starhop/** (GitHub Actions deploys `dist` on every push
to `main`; Pages must use **Settings → Pages → Source: GitHub Actions**).

## The star system

- **Pebble**: the lilac home world with Pip's outpost and the landing pad.
- **Bloom**: green hills, trees and flowers; Bouncers, Shellbys and Flutters; star fruit bushes.
- **Frost**: snow, ice pillars (ice on top: use the jetpack) and geysers that throw you up high.
- **Dune**: sand, mesas and crystals, hidden behind a space storm. Needs the hyperdrive.

Quests from Pip: scan 3 kinds of creatures and bring 3 star fruit (reward: jetpack), bring 5 ice
(reward: hyperdrive; a jump costs 1 crystal), find the lost probe on Dune (reward: super scanner).
The quest log (J / View) also has the discovery log and your gear.

## Controls

| | Keyboard / mouse | Gamepad |
|---|---|---|
| **Fly** speed | W / S | left stick up/down |
| Steer | arrow keys (or click to capture the mouse: mouse stick) | right stick |
| Roll / slide sideways | Q E / A D (R F up/down) | left stick left/right / D-pad |
| Boost / drift (Tachyon slide) | Shift / Space | A or RT / LT |
| Next planet / autopilot | Tab / Z | Y or LB / B |
| Land (near the ground) | L | X |
| Hyperjump (with hyperdrive) | H | RB |
| **Walk** / look | WASD / arrows or mouse | left stick / right stick |
| Jump (hold in the air: jetpack) | Space | A |
| Use, talk, get in, collect (hold) | E | X |
| Scan (hold) | F or right mouse | RT / LT |
| Quest log / pause / read aloud | J / Esc / V | View or Y / Start |

Fly into a planet's glow to land on it; fly up high to go back to space. The autopilot flies to
the target planet and lands on its pad, or climbs back to space if the target is another planet.

## Couch Party Island

Opened from the island's solo mode as `?profile=<id>&name=<name>&return=<url>&lang=en|no`,
the game keeps its save per profile and shows a button back to the island (`src/couch.ts`).
Opened on its own, it saves in the browser as usual.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check and production build in dist/
npm test           # scripted Playwright play-through (needs a build and Chromium)
```

The play-through (`tests/playthrough.mjs`) runs against `npx vite preview --port 4173`: new game
with a Couch profile, quest 1 (scan, gather, autopilot to Bloom and back, land, hand in),
reload and Continue, quest log, Norwegian, a fake gamepad, and with `FULL=1` also quests 2 and 3
(jetpack, hyperjump, the probe). It fails on any console error or warning. `tests/planets.mjs`
takes screenshots of every planet. Set `CHROME` to the Chromium binary if it is not at
`/opt/pw-browsers/...`.

Built with three.js and TypeScript (Vite). All code and models were written by Claude
(Anthropic's AI) from plain-language direction.
