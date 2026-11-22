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
  skid marks (ours and, in a race, the others' from their `sk`) `skids.py` and the grounds' landscapes (dunes for
  sand, countryside for earth and road; the road's width) `grounds.py`, the autopilot (a tiny network trained in
  the browser to drive a lap, I; in race rooms outside races) `autopilot.py`, the Claude bridge's loader
  (`bridge.js` in index.html, the renderer on `__sim`) `bridge.py`, last in the chain
  (check: extract the original `index.html` to a scratch
  dir, run mp-hooks, track-shape, gates, cameras, maps, road-level, damage, freelook, glass, weather, cars, even, bridges, grade, skids, grounds, autopilot, bridge, diff engine.js: it
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
- Grounds (#308, `grounds.py`): the world's hills come from the ground: `COUNTRY` (earth or road) builds them with
  `countryHeight`, sand with `duneHeight`; the road is always on earth (`COURSE.base` is 'earth' whenever
  `COURSE.road`). `setSurface` rebuilds the world when the landscape or the road changes and says so (true):
  don't rebuild again after it. Anything as wide as the road uses `ROAD_HALF` (6 m), not a number.
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
- The ghost car (#310) is timed by our lap (`simTime - lap.lapStart`) and its path comes from the replay tape
  (`rp.buf`, `mpTrace`): keep `recordFrame` recording in races. It is see-through with a depth-only twin drawn
  after everything solid (`mpGhostDepth`), so only its nearest surfaces show; a model that loads later gets the
  same treatment from `V.onModel`.
- The autopilot (#311) trains on the player's own car with the real physics (`stepCar`, `collideGates`), so
  anything that keeps state between drives must be reset in `aiStartEpisode` (gear, revs, wheel spin...: two
  tries that start differently can't be compared), and it saves `H` / `C` when training starts and puts them
  back after every try: anything that rebuilds the world must call `aiHalt()` first (`regenerateWorld` does).
  In a race room it is off in races (`aiAllowed`, `mpGrid` halts it) and silent while it trains: no `s`, `hit`
  or `repair` goes out, and `mpLap` posts none of the autopilot's laps.
  Tests: `__sim.aiTrainSync(gens)`, `__sim.aiTry(weights)` (how a drive ends), one generation per call from a
  timer (a long synchronous run gets the headless tab killed).
- Claude bridge (README): to work in the super admin's own browser, ask them for the code (🤝 Claude → Connect) and
  `node scripts/bridge.mjs claim <code>`, then `node scripts/bridge.mjs state | screenshot | click '{"text":"Train"}' …`
  (screenshots are saved to a file to look at); `events` reads what they write. Commands are in `public/sim/bridge.js`.
  Or the MCP tools (`.mcp.json` → `scripts/bridge-mcp.mjs`): `sim_pair { code }`, `sim_state`, `sim_screenshot`, `sim_command`.
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
