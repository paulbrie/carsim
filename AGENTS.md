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
  the cars made from downloaded models (XJR, SL 63, 911 Turbo, Cayenne Turbo S, GT500, X5 M, GLE 63, Arteon R: specs, sounds, menus; and all-wheel drive's front/rear torque split, `split`, 4 to change it) `cars.py`
  skid marks (ours and, in a race, the others' from their `sk`) `skids.py` and the grounds' landscapes (dunes for
  sand, countryside for earth and road; the road's width) `grounds.py`, the autopilot (a tiny network trained in
  the browser to drive a lap, I; in race rooms outside races) `autopilot.py`, pausing (P; tire pressure on Shift+P)
  `pause.py`, the course editor's GENERATE A CIRCUIT and MY CIRCUITS (the generator itself: `public/sim/circuit-gen.js`,
  also run by `scripts/maps/generate.mjs` and `test/circuit-gen.test.mjs`: keep it free of the DOM and THREE) `circuits.py`,
  car against car (the bots, the other players' cars, the autopilot's rival: `ccBody` / `ccSolve`) `contacts.py`,
  the Claude bridge's loader
  (`bridge.js` in index.html, the renderer on `__sim`) `bridge.py`, the wheels' spin solved implicitly (`wheelSpin`, #327) `tires.py`,
  and the sim page's interface (`ui.css` and `ui.js` in
  index.html, the page's title) `ui.py`, the start menu's tracks (driving a map alone, #329) `tracks.py`, a network's laps as best laps, marked with its name and maker (#333) `net-laps.py`, a saved network's preview (the networks page's Watch it drive, `?net=<id>`, #336) `preview.py`,
  last in the chain
  (check: extract the original `index.html` to a scratch
  dir, run mp-hooks, track-shape, gates, cameras, maps, road-level, damage, freelook, glass, weather, cars, even, bridges, grade, skids, grounds, autopilot, pause, circuits, contacts, bridge, lab-stops, tires, ui, live, tracks, net-laps, preview, diff engine.js: it
  must be identical; index.html differs only by the hand-added `body.mp` CSS).
- New detailed cars: the download goes in `models/` (not in git), its recipe in
  `scripts/models/cars.mjs`, then `node scripts/models/build-car.mjs <key>` writes
  `public/sim/models/<key>.glb.gz` and prints its `MODELS` entry; `.cache/models/<key>.json` has the
  dimensions and body profiles for its `roadSpec` (the collision hull comes from those). Rename
  materials there so `attachModel` finds them: `paint`, `glass`/`window`, `tire`, `taillight`. A
  steering wheel buried in a cabin mesh: `--probe <box>` lists the pieces in a box. Deterministic:
  rebuilding gives the same bytes. Start a recipe from `--list` (every part's path, material, size), and
  mind what the sim does with names: any material with `paint` in its name is repainted (a calliper called
  `..._paint1Mtl` went blue), a see-through one that is not named as a lamp (`lens`, `lamp`, `head`, `tail`)
  becomes a dark window, and only `decal_*` keeps a texture's cut-out alpha. The recipe has the tools for
  awkward sources (see the head of `cars.mjs`): `split` one material by place, `texSplit` paint out of a
  painted texture, `panes` for a missing window, `loose` / `merge` to lighten a mesh of many pieces. A new
  car also goes in `VEHICLES` (`lib/race/shared.mjs`) and `DEFAULT_PAINT` (`components/race-controls.tsx`).
- The race server (`server.mjs`: the hub, the records) loads `lib/race/*.mjs` once: a change there is not live
  until it restarts, while the pages are (#313: the lobby offered cars the running server refused). Only the lists
  of cars, grounds and weathers in `shared.mjs` are read again in development (`hub.setLists`, a few seconds after
  the file changes). A restart closes the open rooms and the Claude bridge's pairing: ask the super admin first.
- The tire's force is solved with the wheel's spin (`wheelSpin`, `scripts/patches/tires.py`, #327): a change to the force's
  curve (`Fx` from the slip in `stepCar`) must change it there too, or the wheels shake between slipping both ways at walking pace.
- A network's laps (#333) are best laps (`records`) of a driver of their own: `tnn:<autopilot id>` (a saved network, named and
  credited as the server has it: the hub's `netLap` asks `nets`, the autopilots' store) or `tnn:local:<user id>` (one not saved),
  with `net` ({ autopilot, name, creator, weights, h }). Anything that ranks or lists best laps tells the two apart by `net`
  (humans' have none). The sim sends them with `net` (`aiNetMark`: `AI.ident` while the driving weights are the saved ones).
- Bridges' earthworks (`scripts/patches/bridges.py`, after even.py): a bridged crossing keeps its two branches'
  heights apart (`bridgedCrossing`): any profile code that brings crossing branches to one height must skip it.
- Grounds (#308, `grounds.py`): the world's hills come from the ground: `COUNTRY` (earth or road) builds them with
  `countryHeight`, sand with `duneHeight`; the road is always on earth (`COURSE.base` is 'earth' whenever
  `COURSE.road`). `setSurface` rebuilds the world when the landscape or the road changes and says so (true):
  don't rebuild again after it. Anything as wide as the road uses `ROAD_HALF` (6 m), not a number.
- The course editor builds every change while it is open (#326, `scripts/patches/live.py`): anything that
  changes the course must set `ed.wpDirty` (or `ed.opsDirty` for terrain strokes alone), and the editor's frame
  (`liveFrame`) rebuilds the world once it has stayed the same for 0.35 s and no waypoint is held (`ed.drag`) or brush
  painting; don't rebuild from an edit's own handler. Its messages don't say "built when you close the editor".
- The circuit generator's bridges (#326, `circuit-gen.js`: `twist`, `crossings`, `bridgesFit`) copy the sim's rules for
  bridging a crossing (`buildTrack`'s `crossBridge` and `fits`, `RAMP`): change one, change the other, or a generated
  circuit gets fewer bridges than it says. `bridges: 0` must keep giving the circuits as before (a test compares).
- Even-grade sections (`COURSE.even`, `scripts/patches/even.py`, last in the chain) are waypoint indices:
  anything that inserts, removes or refits waypoints must keep them pointing at the same stretch (`shiftEven`).
- The weather is `scripts/patches/weather.py`, after `glass.py` in the re-patch chain (it only touches the
  rendering setup, the frame loop, the Bots button's neighbour and the editor's fog lines). Its presets
  (`WEATHERS` in engine.js) and the race's list (`WEATHERS` in `lib/race/shared.mjs`) share their keys.
- Ground shaped along the course (banking, levelling, bridge ramps) must take its height between
  course points (`alongCourse`), not at the nearest one: they are ~1 m apart, and nearest-point
  heights make ridges across every slope (#292).
- The chat (#325): `lib/race/chat.mjs` (main room in the database, mutes) and the hub's `chat` / `chatDel` / `chatMute`
  messages; a race room's chat is `room.chat`. Only the server decides who is the admin (the signed ticket's `admin`):
  the page's delete and mute buttons are only a view. In a race, Enter in the sim posts `chatKey` to the page
  (`mp-block.js`): keep Enter free for it there (a wrecked car's Enter still repairs).
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
  Every try starts on the ground as built (`B`, and `AI.freshC` from `aiFreshGround` at the end of `generateTerrain`),
  not the worn one: anything else that builds how packed the ground is (`C`) must save it again there.
  Only the 16 m chunks `markDirty` noted since are copied back (`aiGroundBack`, `aiGT`): code that writes `H` or `C`
  must call `markDirty` for what it changed, and anything that sets them wholesale (`H.set`) must set `aiGT.all = true`.
  `aiDemoNow` looks at `courseKey()` again only when `TRACK` or the car changes (or a second on): whatever changes a
  demo line must clear `AI.demoCk`.
  The hidden layer's sizes (`AI_SIZES`, #316) are the server's too (`AUTOPILOT_SIZES` in `lib/autopilots/store.mjs`; a test
  checks they match): change both.
  The exam (`aiExamStart`) is what picks the best: keep it what a real lap is (the flying one: two laps, the second
  timed, nothing put back between), and a change of exam a change of `aiExamKind` (the best is examined again).
  Tests: `__sim.aiTrainSync(gens)`, `__sim.aiTry(weights)` (how a drive ends; `aiTry(w, 0, true)`: the exam's race
  with the rival), one generation per call from a timer (a long synchronous run gets the headless tab killed).
  The autopilot's rival car is a second car's whole state swapped into `car` and the globals for its steps (`aiRvSwap`:
  `car`'s own fields, `VEH`, `VIS`, `ENG`, `PRESSURES`, `CAR_HW/ZF/ZR`, `input`, `up/fwd/down`, `hitCooldown`, the room
  hooks): per-car state the physics or damage code keeps anywhere else must be added there, or the two cars share it.
  `car.isRival` marks it swapped in (no wreck screen, its own controls in `readInput`).
  Training on several cores runs this same `engine.js` in Web Workers over a stub DOM (`aiWorkerMain`, `AI_WK`): code
  at the top level of the engine must not depend on a real page (a value read from the DOM is a stub: `''` or 0), and
  anything a try depends on must reach the workers: the course, ground and car come from the localStorage copy they
  boot with (`aiPoolSpawn`), the network's shape and the car's settings from `aiPoolSetup`, the rest of `AI_CFG` /
  `AI_PEN` and the rivals with each job (`aiPoolPump`). A worker is used only when its ground hashes as the tab's.
- Driving a map alone (#329, `tracks.py`): the sim alone keeps one course (`sandbuggy.course`) and knows which map it is
  by `courseKey()` (and `carsim.track`); the browser's own course waits in `carsim.course.mine`. Its keys are not
  `sandbuggy.*` (the autopilot's workers boot with a copy of those). `/api/tracks` is public: send nothing more there
  than the sim needs (no `updatedBy`).
- Training that stops by itself must say why (#323, `scripts/patches/lab-stops.py`): call `aiStopped(why)`, or pass a
  reason to `aiHalt(drive, why)`, not a bare `aiTrain(false)` (that is for the user's own Pause). A flash alone isn't
  enough: the full-screen lab covers the sim. The training is driven by animation frames, and by `aiBgKick`'s message loop
  while the tab is hidden: a new per-frame step of the training goes in `aiTrainFrame`, which both call.
- Claude bridge (README; development only, #338: off in production unless `CLAUDE_BRIDGE=on`, `bridgeOn`): to work in the super admin's own browser, ask them for the code (🤝 Claude → Connect) and
  `node scripts/bridge.mjs claim <code>`, then `node scripts/bridge.mjs state | screenshot | click '{"text":"Train"}' …`
  (screenshots are saved to a file to look at); `events` reads what they write. Commands are in `public/sim/bridge.js`.
  Or the MCP tools (`.mcp.json` → `scripts/bridge-mcp.mjs`): `sim_pair { code }`, `sim_state`, `sim_screenshot`, `sim_command`.
- Car against car (#322) is one contact, `ccSolve` (`contacts.py`): the bots' (`updateBots`), the other players'
  (`mpContacts`, mp-block.js) and the rival's (`aiCarContact`). Give it both cars as bodies (`ccBody`: a mass of 0 doesn't
  move) and put the velocities, yaw rates and moves it returns back on them; a new kind of car-to-car touch should
  use it too. In a race the others' `pe.pos` / `pe.q` are where they are now (carried on from 120 ms in the past by
  their speed and turn, `MP.lag` more for the trip), not where they were: anything that wants their last reported
  state reads `pe.buf`.
- Car damage is deterministic on purpose: a hit `[cx, cy, cz, dx, dy, dz, vn, kind]` gives the same dents on
  every copy of a car, which is how the other players see ours. Keep `dentBody` / `contactOn` /
  `shedParts` free of `Math.random` (flying debris's velocity may be random: it is not replayed).
- The tech specs page (#335, `/tech`): the cars' and grounds' figures are read from `engine.js` on the server
  (`lib/tech/specs.mjs` cuts `ROAD_CARS`, `BUGGY`, `car`, `ENG`, `PRESSURES`, `SURFACES`, `VEHICLE_LIST`, `SPLITS` and `DT`
  out by name and evaluates them alone): keep them top-level literals that need nothing else when they load
  (`test/tech.test.mjs` checks every car comes out). The physics text in `app/tech/page.tsx` quotes `stepCar`'s constants
  (the aids' slip limits, the damping ratios, the bump stop, the shift times...): change one, change the other.
- `window.__sim` already has getters (TRACK, VEH, BRIDGE): adding another of the same name to it
  with Object.assign throws at boot and the sim never starts.
- Headless Chrome here draws the sim at about a frame a second (software WebGL). To test races,
  step the physics instead: in the iframe, `__sim.step(n)`, `__sim.placeAtGate(i, back)`,
  `__sim.override = { throttle, brake, steer }`; and use `scripts/bot-driver.mjs` for a second driver.
- UI SDK: read `node_modules/@ui-sdk/react/docs/llms.txt` (and the component pages) before using a
  component; its parts are unstyled, styles live in `app/globals.css` (`.seg*`, `.cp-*`).
- shadcn components import `cn` from `@/lib/utils` (the CLI wrote `from "cn"`, an unrelated npm
  package: rewrite it if you add components).
- The interface (#320, README: The pages). The app: one dark theme, tokens and type classes in `app/globals.css`
  (`--human` orange is also the primary, `--tnn` cyan; `.display` / `.heading` / `.eyebrow` / `.num` / `.panel`); every
  page starts with `SiteNav`; a time is `.num`. Humans are orange and networks cyan everywhere: don't use them for
  anything else. The sim's own page: `public/sim/ui.css` restyles what the sim builds (every rule starts at `body`:
  the sim's `<style>` blocks come later in the page and would win by order), `public/sim/ui.js` adds the rail. The
  sim's buttons listed in `ITEMS` there are moved off the screen and shown as stand-ins in the rail: **a new button in
  the sim needs an entry in `ITEMS` and in the `body.ui-rail #…` list of ui.css**, or it sits on top of the rail.
  The stand-ins copy the button's text, `.on` and whether it is displayed, so keep those meaning what they do.
  Public pages (`/`, `/leaderboard`, `/networks`) are seen without signing in: names through `publicName`, nothing
  from the database that a visitor should not see. `courseKey` in `lib/showcase/store.mjs` is the sim's: change
  one, change the other (`test/showcase.test.mjs` compares them).
- Dev server: `npm run dev` on port 7001 (3000 is the admin). `next.config.ts` is read at start: a change to it
  (the `/drive` and `/lab` redirects) needs a restart.
- The database (#318, README: The database): Postgres, `DATABASE_URL` in `.env.local`, the container from
  `docker compose up -d` (port 5554). Tables in `lib/db/schema.mjs`: change it, then `npm run db:generate` and commit
  the new file in `migrations/` (the server applies it at its next start). The stores are async (`await
  mapStore().get(id)`); the hub is not: it reads maps from `lib/maps/live.mjs` (kept current by the store's NOTIFY:
  any other way of writing a map must announce it too, `MAPS_CHANNEL`) and best laps from memory (`RecordStore`:
  `load()` at start, each new best written through). New server-side data goes in a table, not in a file. Tests
  that need it take a schema of their own from `test/db.mjs` (never the app's tables).
- Maps: only the super admin (`lib/admin.ts`) may write them; every write path (`app/api/maps`) checks
  `session.user.admin` on the server. To test as the admin locally, sign a session cookie with
  `AUTH_SECRET` (`@auth/core/jwt` `encode`, salt `authjs.session-token`, claims `provider: 'google'`,
  `email`, `emailVerified: true`).
