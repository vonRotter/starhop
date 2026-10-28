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
(reward: hyperdrive; a jump costs 1 crystal), find the lost probe on Dune (reward: super scanner),
and a star party with 4 star fruit and 4 ice (reward: golden crown and gold paint).

**Bolt** the mechanic camps by his crashed ship on Bloom: bring 3 crystals and 2 star fruit (plans
for a boost upgrade), put sensors on 3 Frost geysers between bursts (plans for an air suit), win a
medal in the ring race around Pebble (plans for a big energy tank), and, once you have the
hyperdrive, find his 3 gears on Dune (super jetpack and his hard hat).

The **workbench** in Pip's outpost turns resources into upgrades (boost, energy tank, air suit; each
needs Bolt's plans), ship paint (💎1 🧊1) and hats (⭐2: party hat, flower, propeller cap). Owned
paint and hats can be swapped there for free.

Hazards are gentle: on Frost and Dune an air meter runs down while you walk and refills by the
ship (the air suit doubles it); running out just puts you back at the ship and drops one of each
resource. Frost has slippery ice patches and geysers that rumble before they blow. Dune has
sandstorms every minute or so: the view closes in and the wind pushes you, unless you shelter on
the far side of a mesa. In space, the **ring race** loops around Pebble through an asteroid belt
(fly through the first ring to start; 🥇 38 s, 🥈 52 s, 🥉 75 s).

The quest log (J / View) has the quests, a discovery log with pictures of every creature, plant
and resource (unknown ones as shadows), a planet page with three stars each (scan all, collect
all, all quests) and your gear. **Options** (title or pause menu): invert up/down, mouse and stick
speed, graphics (high, medium, low: no shadows and a lower resolution) and music. Each area has
its own little synthesized music loop.

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
| Use, talk, get in, collect, workbench (hold for sensors) | E | X |
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
(jetpack, hyperjump, the probe). Then milestone 2 in a second profile: a milestone-1 save continues
(save migration), options, Bolt's four quests, crafting, geyser sensors, ice, running out of air,
the ring race, gears and a sandstorm with shelter, Pip's star party, log pictures and a reload.
`ONLY_M2=1` runs just that part, `SKIP_M2=1` leaves it out. It fails on any console error or
warning. `tests/planets.mjs` takes screenshots of every planet. Set `CHROME` to the Chromium binary if it is not at
`/opt/pw-browsers/...`.

Built with three.js and TypeScript (Vite). All code and models were written by Claude
(Anthropic's AI) from plain-language direction.
