# Agents working on carsim

See README.md for the layout. Notes:

- `public/sim/engine.js` is the original engine plus the multiplayer block. When you change the
  multiplayer hooks, change `scripts/patches/mp-block.js` / `mp-hooks.py` too, and for the editor's
  SHAPE tools (smoothing, banking) `scripts/patches/track-shape.py`, (levelling) `road-level.py` and
  (Max. grade, Optimise the road, grading over the terrain strokes) `grade.py`, so a new drop of the sim can be
  re-patched; the gates (height, fade near the camera) are `scripts/patches/gates.py`, the driver's-seat
  camera `cameras.py`, the maps (a room's course, the `?edit=1` map editor) `maps.py`, car damage
  (crumpling, the bent frame, bots' dents, `bodyHit` for the multiplayer sync) `damage.py`, looking
  around the car (Shift/right-drag) `freelook.py`, breaking glass (panes, cracks, shards) `glass.py`,
  the cars made from downloaded models (XJR, SL 63, 911 Turbo: specs, sounds, menus) `cars.py`
  (check: extract the original `index.html` to a scratch
  dir, run mp-hooks, track-shape, gates, cameras, maps, road-level, damage, freelook, glass, weather, cars, even, bridges, grade, diff engine.js: it
  must be identical; index.html differs only by the hand-added `body.mp` CSS).
- New detailed cars: the download goes in `models/` (not in git), its recipe in
  `scripts/models/cars.mjs`, then `node scripts/models/build-car.mjs <key>` writes
  `public/sim/models/<key>.glb.gz` and prints its `MODELS` entry; `.cache/models/<key>.json` has the
  dimensions and body profiles for its `roadSpec` (the collision hull comes from those). Rename
  materials there so `attachModel` finds them: `paint`, `glass`/`window`, `tire`, `taillight`. A
  steering wheel buried in a cabin mesh: `--probe <box>` lists the pieces in a box. Deterministic:
  rebuilding gives the same bytes.
- Bridges' earthworks (`scripts/patches/bridges.py`, after even.py): a bridged crossing keeps its two branches'
  heights apart (`bridgedCrossing`): any profile code that brings crossing branches to one height must skip it.
- Even-grade sections (`COURSE.even`, `scripts/patches/even.py`, last in the chain) are waypoint indices:
  anything that inserts, removes or refits waypoints must keep them pointing at the same stretch (`shiftEven`).
- The weather is `scripts/patches/weather.py`, after `glass.py` in the re-patch chain (it only touches the
  rendering setup, the frame loop, the Bots button's neighbour and the editor's fog lines). Its presets
  (`WEATHERS` in engine.js) and the race's list (`WEATHERS` in `lib/race/shared.mjs`) share their keys.
- Ground shaped along the course (banking, levelling, bridge ramps) must take its height between
  course points (`alongCourse`), not at the nearest one: they are ~1 m apart, and nearest-point
  heights make ridges across every slope (#292).
- Best laps (#304): in a race (`?mp=1`) the timer's BEST comes from the server (`mpApplyBest`, from the
  room's `records`), not localStorage; anything that rebuilds the course or changes the car or ground must
  leave `loadBest` / `mpApplyBest` to set it. The server only takes a lap no longer than the time since the
  player's previous one (`lapMark`): reset it wherever the sim restarts its lap (a car, map or ground change).
- Car damage is deterministic on purpose: a hit `[cx, cy, cz, dx, dy, dz, vn, kind]` gives the same dents on
  every copy of a car, which is how the other players see ours. Keep `dentBody` / `contactOn` /
  `shedParts` free of `Math.random` (flying debris's velocity may be random: it is not replayed).
- `window.__sim` already has getters (TRACK, VEH, BRIDGE): adding another of the same name to it
  with Object.assign throws at boot and the sim never starts.
- Headless Chrome here draws the sim at about a frame a second (software WebGL). To test races,
  step the physics instead: in the iframe, `__sim.step(n)`, `__sim.placeAtGate(i, back)`,
  `__sim.override = { throttle, brake, steer }`; and use `scripts/bot-driver.mjs` for a second driver.
- UI SDK: read `node_modules/@ui-sdk/react/docs/llms.txt` (and the component pages) before using a
  component; its parts are unstyled, styles live in `app/globals.css` (`.seg*`, `.cp-*`).
- shadcn components import `cn` from `@/lib/utils` (the CLI wrote `from "cn"`, an unrelated npm
  package: rewrite it if you add components).
- Dev server: `npm run dev` on port 7001 (3000 is the admin).
- Maps: only the super admin (`lib/admin.ts`) may write them; every write path (`app/api/maps`) checks
  `session.user.admin` on the server. To test as the admin locally, sign a session cookie with
  `AUTH_SECRET` (`@auth/core/jwt` `encode`, salt `authjs.session-token`, claims `provider: 'google'`,
  `email`, `emailVerified: true`).
