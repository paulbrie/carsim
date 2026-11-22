# Sand Buggy Rally

Real-time multiplayer racing on the **Sand Buggy** vehicle sim: sign in with Google, open a room,
pick one of eleven cars and a paint, and race up to eight drivers on sand, earth or road, around the figure-8 or a
map the super admin made.

- **Next.js 16** (App Router) + **Tailwind 4** + **shadcn/ui** (radix-nova) for the pages
- **UI SDK** (`@ui-sdk/react`) for what shadcn lacks: the paint colour picker, the segmented controls and the map picker
- **subjecto** for client state (the socket's rooms, room, standings: `lib/client/net.ts`)
- **Auth.js** (next-auth v5) with Google; a name-only guest sign-in for development
- **One Node.js process** (`server.mjs`): Next, the race WebSocket at `/ws`, and `/api/health`, on `$PORT`: made for Railway

## Run it

```bash
npm install                  # also copies three.js into public/sim/vendor (postinstall)
cp .env.example .env.local   # set AUTH_SECRET (openssl rand -base64 32), and Google if you have it
npm run dev                  # http://localhost:7001
npm test                     # race server and ticket tests (node:test)
npm run typecheck
```

Without Google credentials the sign-in page offers a guest name instead (development only, or
`AUTH_GUEST=1`). To try a race alone, `node scripts/bot-driver.mjs <ROOM CODE>` adds a scripted
driver to a room: it gets ready, lines up, drives the course, and finishes.

## Course editor (single player: `/sim/index.html`, E)

Besides waypoints, bridges, terrain brushes and ground paint, the SHAPE section has:

- **Smooth curves**, to a **min. corner radius** (10–60 m): the waypoints are reshaped so no bend
  is tighter than that, cutting the tight bends the way a racing line does while the straights stay
  where they are (no point moves more than ~1.2× the radius). A hairpin between close straights
  opens only as far as that allows. The info line shows the tightest corner; **Undo smoothing**
  puts the waypoints back.
- **Banking** (off–25°): the ground under each bend tilts toward its inside, at the angle a car
  needs at the ground's cornering speed (sand 14, earth 18, road 24 m/s; tan θ = v²/gR), capped by
  the slider, eased in and out over ~25 m, flat near bridges and crossings, and blended back into the
  dunes 9–16 m out. The physics feels it, and the bots' speed plan counts it. Saved with the course
  (and in Export), with its own best laps.
- **Level the road** (off–100%): the road's rise and fall along the course is smoothed (three passes
  of a ±32 m moving average, half a dune's wavelength each side: the crests are cut, the troughs
  filled, the land's long slopes kept), blended in by the slider. Across, the road is flat (plus the
  banking) to 8 m out, then the cut or fill slopes back into the dunes at about 1 in 2.5. Where the
  course crosses itself both branches meet at one height. On the figure-8 the steepest grade goes
  from 26% to 4%, the climb per lap from 29 m to 13 m; "Course ready" shows the grade before → after.
  Saved with the course and in maps, with its own best laps.
- **Max. grade** (off, 3–15%): no stretch of the road steeper than that. The height profile is cut
  and filled to the nearest one that keeps the grade (the mean of the highest profile under it and
  the lowest above it that do, so a crest is cut and a trough filled by as much as it takes, no
  more; an unbridged crossing counts as one point, so both branches keep one height), then eased so
  the grade changes over at least grade × 200 m either side: crests and dips of 200 m radius or more,
  no taking off over a crest. "Course ready" adds the sharpest crest or dip. Even-grade sections and
  the bridges' ramps (built for 8%) keep their own grades. Saved with the course (`grade`) and in maps.
- **Optimise the road**: Smooth curves to the min. corner radius (undoable), levelling 100%, max.
  grade 6% (or lower if already set), and banking 25°, so every bend gets the angle its speed needs.
  On the figure-8 map the tightest corner goes from 10 to 16 m (a hairpin opens only so far), the
  steepest grade away from the bridges from 5% to under 2%, the sharpest crest or dip from 215 m to
  over 1.6 km in radius.
- A levelled road, or one with a max. grade, is graded **over the terrain strokes**: they are applied
  first, so the road stays smooth where they cross it (off the road they stay as drawn). Without
  either, the strokes go on top as before.
- **Even grade**: click it, then the first and the last waypoint of a section (forward along the
  course): the road between them rises or falls at one constant grade, from the ground's height at
  the first to the height at the last (flat if they're level), cut and filled into the dunes like
  the levelling, banking on top; where it crosses another branch, that one is brought to its height.
  The section's waypoints turn blue, the info line lists each section and its grade once built;
  **Clear even grades** removes them. Sections are waypoint indices (`even` in the course, in maps,
  in Export), kept through adding and deleting waypoints; Smooth curves sets them aside (Undo brings
  them back).

## Damage

Every car crumples where it is hit (`scripts/patches/damage.py`): gate posts crease it, other cars
dent it, the ground folds it (a nose-dive shortens the nose and bows the bonnet up, a rollover brings
the roof down). Dents deepen with the impact speed, up to ~45 cm; the ends are crumple zones, the
cabin gives less than half as much; the detailed models' panels hang loose, then fly off.

- **Frame:** a hit over 6 m/s also bends the frame: the axle nearest it goes out of line (both wheels
  the same way, a thrust angle) and that corner sits lower, both pulling the car toward the side hit
  (a 14 m/s corner hit: ~15° off line in 4 s with the wheel straight). "Frame bent · it pulls right"
  on the hit; the damage panel draws the four wheels turned by their toe, orange when out of line.
- **Bots** crumple where you hit them too; a restart (T) repairs everyone.
- **In a race** each hit (`[x, y, z, push direction, speed, kind]`, body space) goes to the room and is
  replayed on that car in the others' sims, so everyone sees every car's dents; the server keeps
  each player's hits until they repair (a new race, a wreck reset, a reload), so a late joiner sees
  them as they are. At most 15 hits a second go out (20/s with bursts of 40 accepted, 400 kept per player).
- **Glass** (`scripts/patches/glass.py`) breaks the way car glass does. The windscreen (laminated)
  cracks in a spider web round the hit and stays in, a web more with each hard hit. Side, rear and
  roof glass (tempered) bursts into small cubes that fall mostly into the cabin, leaving the frame
  empty. Head and tail lamp lenses shatter (clear or red flakes); mirrors and the buggy's deflector
  crack. Glass is found on any model by name (glass, window, windscreen, lens) or by what it is
  (glTF transmission, a see-through blend), not the dashboard's screens. It is split into panes,
  typed by where each sits and faces: lamps low at the ends; above them windscreen, rear, roof and
  side windows; inner and outer skins together. A pane breaks from the load of a hit near it (its
  speed, fading to nothing 60 cm from the pane) or when the dents bend it (a crushed pillar or roof).
  A direct side-window hit bursts it from about 8–10 m/s; a door hit just below the window, from
  10–13 m/s; a roof crush takes the side and roof glass and cracks the windscreen. It rides on
  `bodyHit`, so bots and the other players' cars break the same panes, and repairs mend them.
  Shards settle and go after 30 s; breaking glass has its own sound.
- **Repair:** T (restart) or, wrecked, R / Enter; in a race, the grid at every start.

## Bridges

A bridge reshapes the course around it (`scripts/patches/bridges.py`):

- **Even ramps**: each ramp up to the deck is one constant grade, rounded off over its first and last few
  metres, from the road's own height 40 m out (longer, up to 60 m, to keep it at 8%), so no S-curve, no
  step at the deck, both ends alike.
- **A cutting**: at a crossing the road underneath runs 2.4 m below the ground, on grades of at most 7% in
  and out, between banks of 1 in 1.5; the deck stands 5 m over the cutting's bed (4 m under the girders),
  so it sits lower and the ramps are shorter or gentler. The levelling no longer forces a bridged
  crossing's two roads to one height.
- **Straight**: the deck follows the road's chord across it; adding a bridge in the editor puts the
  waypoints near it on the deck's line (Undo puts them back), and COURSE's **Straighten at bridges** does
  it for every bridge (the automatic ones at crossings too).
- **Tidy ends**: the abutments reach down to the cutting; past their width the embankment starts a few
  metres beyond the deck's end, a slope rather than a cliff.

On the Figure-8 map: the deck went from 4.4 m above the ground to 5 m over a 2.3 m cutting (1.7 m lower),
and the ramps from S-curves peaking at 10-11% to an even 8% and 6.6%.

## Weather

Five skies (`scripts/patches/weather.py`): **Clear** (the default), **Clouds** (sunny, fair-weather
clouds), **Grey** (overcast: soft light, faint shadows), **Rain** (low dark clouds, light rain,
shorter visibility) and **Sunset** (the sun 9° up, orange light and long shadows, clouds lit from
below). The clouds are fbm noise in the sky dome, drifting; each sky also sets the sun (colour,
strength, height), the hemisphere light, the fog, the exposure and the reflections (the environment
map is re-rendered from it). Rain is a few thousand streaks falling around the camera; it is only
visual (the grip is the same). Single player: **O** or the Weather button, remembered in the
browser. A race: the host picks it with the ground and laps (`weather` in the room; the sim gets
`?weather=` and `weather` messages), and O does nothing there.

## Skid marks

A tire that slides or spins on asphalt or a bridge deck leaves rubber on it (`scripts/patches/skids.py`):
locked wheels, wheelspin, a handbrake turn, a car drifting or understeering past its grip. A mark starts
once the contact patch slides 0.5 m/s faster than a gripping tire creeps anyway (1 m/s plus 10% of the
speed) and is darkest at 6 m/s past it; a lightly loaded wheel leaves a fainter one. They are as wide
as the tread rolling and narrower sliding sideways, with soft edges and the tread's streaks. Sand and
earth keep their ruts instead. The last ~12,000 pieces stay (the oldest go first), until the course or
ground changes. In a race the other players' cars leave them too: each car's state carries its four
wheels' marks (`sk`, 4 bits a wheel), relayed by the server.

## Grounds

Each ground has its own landscape (`scripts/patches/grounds.py`). **Sand**: the dunes, slip faces and
all. **Earth**: a firm-earth countryside instead: broad rolling hills (about 15% at the steepest, no slip
faces), patched with dry grass that stops at the course's verges and wears off where wheels pack the
ground; a cooler haze than the desert's dust. **Road**: tarmac through the same countryside, with earth
verges (off the road the ground is earth, not sand). The tarmac is 12 m wide: two 4.5 m lanes between
the edge lines and 1.5 m shoulders; on the road the bridges' decks, ramps and cuttings are as wide.
Switching between sand and the other two rebuilds the world (other hills), as switching the road on or
off already did.

## Autopilot: a tiny network that learns to drive (I)

**I** or the **🧠 Autopilot** button opens the Autopilot panel (single player, and in a race room in the lobby
or after your finish, not on the grid or in a race: a race starting stops it; while it trains there the others
see none of it, and its laps are never your best laps); **Train** has a neural network learn to drive a lap of this course with this
car, in the browser, on the sim's own physics (`scripts/patches/autopilot.py`); **Drive it** hands the car to
the best one so far (any driving key takes it back). What it learnt is kept per course, car and size in the
browser; **Save to file** downloads it (weights, generations, chart, as JSON) and **Load file** brings it back,
here or in another browser (made with another car or course, it asks first, and its record doesn't count).
**Save to server** keeps it on the server under a name, and **From server** lists everyone's (this car and
course's first): load any, delete yours. `/api/autopilots` (signed in; `lib/autopilots/store.mjs`, one JSON file
each in `<DATA_DIR>/autopilots`, at most 50 a driver; only the one who saved it, or the super admin, deletes it).

- **The network:** 7 inputs straight to 2 outputs (steering, and a pedal: + throttle, − brake), each the tanh
  of a weighted sum: 16 weights. **Bigger net** puts a hidden layer of 8 between (82 weights).
- **What it sees:** by default its speed; where the racing line is 6, 15 and 30 m ahead (the sine of the
  bearing); how far it is to the side of the line; its yaw rate; and a pace note: the speed the line can be taken
  at there (from its bends and the ground's grip, the same profile the bots use) less its own. **Inputs, outputs
  and penalties** (in the panel) picks others too: the distances to the course's left and right edges (the
  tarmac's on road, the gate posts' off it), 5 edge rays (feelers at ±60°, ±30° and ahead: how far until they
  leave the course, up to 40 m, drawn on the track), its sideways speed, its wheels' sinkage (the deepest:
  digging in on sand), its tilt (roll and pitch: about to roll over), the g (forward and sideways acceleration,
  smoothed over 0.1 s); and a third output, the handbrake (on
  above 0). Each set is a network and a training of its own (`AI_INPUTS`, `aiSetInputs`).
- **Like the keyboard** (two options there): the pedal snapped to full throttle / off / full brake (above +⅓,
  between, below −⅓), as W and S give, and the steering to full left / straight / full right as A and D give. Each
  is a training of its own. Harder to learn: with keyboard pedals, a run from scratch on the figure-8 (sand, buggy)
  was still stuck at the first hard bend after 80 generations (with the analogue pedal: a lap by generation 8-13).
- **Penalties** (`AI_PEN`, editable there): every drive's score loses 1 m a metre driven off the road, 150 m for
  a wreck's worth of damage (in proportion), and 100 m for wrecking the car; optionally (0 by default) so much a
  full swing of the steering or pedal output (their changes added up: jerky driving), so much a metre of extra path
  (driven beyond its progress along the line: running wide, weaving) and a reward per km/h of the average speed
  along the line; the panel shows the last exam's. How far from the line a try ends is set there too (8 m by
  default: wider gives it room for a line of its own, and to go astray).
  Off road, leaving the course (8 m from the line) ends a try anyway, before the gate posts.
- **How it learns:** evolution strategies, no gradients through the physics. A generation tries 16 noisy
  copies of the weights (±pairs) for 15 s each from one place on the line (random, or half the time 100 m
  before where it last went wrong), scores each by the metres covered (100 m less for ending off the course,
  stuck or wrecked), and moves the weights toward the better ones (by rank, with Adam). Then an exam: the new
  weights from the start line for a lap; the best exam's weights are the autopilot. Physics only, 12 ms a
  frame; the ground's ruts are put back after every try.
- **Watch at 1×** runs the training at real speed, with the sound, to follow every try (it learns the same, only
  slower); **Full speed** goes back. The panel shows the decisions a second: the network runs on the main thread,
  in the sim's input step, as it needs the car's physics state, which lives there (31 ns a decision for the 16
  weights; a training step is ~67 µs, nearly all physics: ~15,000 decisions/s flat out, ~250× real time).
- **Watching it think:** the panel draws the network live while it trains or drives: each input with its value
  (km/h, degrees, metres), each output (steer left/right, gas/brake %), and a line from each input to each output
  coloured and thickened by its pull right now (value × weight; orange +, blue −). On the track, three markers show
  the points on the racing line it looks at (6, 15 and 30 m ahead).
- **When to stop:** once it laps, the chart shows each generation's lap time (faster higher, dashed the best),
  and training stops by itself after so many generations without a better lap (30 unless set otherwise, 0:
  never); the panel says how long since the best. Or a fixed number: each Train runs so many generations, then
  stops (0: until paused).
- **How long:** on the figure-8 on sand with the buggy, two runs from scratch first lapped at generations 11
  and 13 (about 1–1.5 minutes of computing in headless Chrome), then got quicker (55.8 s).
- Without the pace note, or with bearings in radians (a hairpin's jumps from +180° to −180°), or always
  starting from the start line, it never got past the first sharp bend.

## Maps and the super admin

`SUPER_ADMIN_EMAIL` in `lib/admin.ts` (a constant: aelythe@gmail.com) is the super admin, when signed in
with Google and that email verified by Google (`session.user.admin`, worked out on every request;
guests never are). Only the super admin can create, edit and delete maps; anyone signed in can race them.

- **`/maps`** (the user menu's *Maps*, admin only): new map (a copy of another, or an editor
  *Export course* file), copy, delete, open in the editor. The figure-8 is built in: editable, not deletable.
- **`/maps/[id]`**: the sim in edit mode (`/sim/index.html?edit=1`) on its course editor, with the
  map's course and nothing saved in the browser; *Save* (or Ctrl/Cmd+S) puts the course on the
  server. E drives the course to try it, and back. **Test on** (Sand / Earth / Road, or G while
  driving) tries it on each ground a race can be on, a banked course rebuilt for that ground's
  cornering speed. The ground isn't something to save: in a race the host picks it (the map keeps
  the last one tried, for the editor to open on).
- **Saved** as `<DATA_DIR>/maps/<id>.json` (`lib/maps/store.mjs`, default `./data`, not in git), through
  `/api/maps` (GET for anyone signed in; POST, PUT, DELETE for the super admin, 403 for others).
- **In a room** the host picks the map (lobby, or New race). The page loads its course and hands it
  to the sim as `window.__simCourse` before the iframe boots; a change goes as a `course` message and
  the sim rebuilds the world. The room's ground still applies over the map's. A room reads its map
  again when a race starts, so an edit saved meanwhile is what everyone races (the sims reload it on
  the grid); a deleted map falls back to the figure-8.

## How it fits together

```
browser ─ /race/[room] (React) ──postMessage── iframe /sim/index.html?mp=1 (the engine)
   │  lib/client/net.ts (subjecto Subjects)
   └─ WebSocket /ws?ticket=… ── server.mjs ── lib/race/hub.mjs (rooms, races, in memory)
```

- **The engine** is the original single-file sim (`index.html` this project started from, not
  committed: 28 MB with the models inline), split by `scripts/extract-engine.mjs` into
  `public/sim/index.html`, `public/sim/engine.js` and `public/sim/models/*.glb.gz`, with three.js
  0.160 served from `public/sim/vendor` instead of a CDN. Its multiplayer hooks are in one block
  (`MULTIPLAYER` in `engine.js`); `scripts/patches/` re-applies them to a new drop of the sim:
  `node scripts/extract-engine.mjs new.html /tmp/x && python3 scripts/patches/mp-hooks.py /tmp/x/engine.js scripts/patches/mp-block.js && python3 scripts/patches/track-shape.py /tmp/x && python3 scripts/patches/gates.py /tmp/x && python3 scripts/patches/cameras.py /tmp/x && python3 scripts/patches/maps.py /tmp/x && python3 scripts/patches/road-level.py /tmp/x && python3 scripts/patches/damage.py /tmp/x && python3 scripts/patches/freelook.py /tmp/x && python3 scripts/patches/glass.py /tmp/x && python3 scripts/patches/weather.py /tmp/x && python3 scripts/patches/cars.py /tmp/x && python3 scripts/patches/even.py /tmp/x && python3 scripts/patches/bridges.py /tmp/x && python3 scripts/patches/grade.py /tmp/x && python3 scripts/patches/skids.py /tmp/x && python3 scripts/patches/grounds.py /tmp/x && python3 scripts/patches/autopilot.py /tmp/x`.
  Gates are 6 m tall (banner foot ~5 m) and fade to 25% when the camera comes within 6–15 m of one.
  The detailed models' driver's-seat camera sits 0.3 m ahead of (and 5 cm above) the driver's eyes.
  Three of the detailed cars, the **Jaguar XJR** (X308), the **Mercedes-AMG SL 63** and the
  **Porsche 911 Turbo** (992), are built from downloaded models (`models/`, not in git) by
  `scripts/models/build-car.mjs`: into the sim's axes and metres, wheels, callipers and steering wheel
  split out, paint and glass found by name, lighter (meshoptimizer, textures ≤ 512 px), gzipped
  (1–6 MB). Their specs are the real cars' (power, torque, gearbox, weight, drive); their bodies'
  profiles, which the collision hull is built from, are measured off the models.
  **Shift+drag** or **right-drag** looks around: the chase camera swings round the car (drag right:
  the view turns right; down: from higher up), the cockpit view turns your head (up to ~130° each way);
  let go and it eases back behind after 0.7 s. The orbit (C) and editor cameras keep their own mouse controls.
  Opened without `?mp=1`, `/sim/index.html` is the single-player sim as it was (editor, bots, replays).
- **Physics run in each browser.** A client reports its car 20 times a second; the server relays
  the positions to the room; the others draw it 120 ms in the past, interpolated, and push against
  it like the sim's bots (each side moves only its own car), and draw its skid marks under its wheels. Laps and the finish come from the
  sim's own gate timing; the server keeps the order and the clock (a finish time far from the
  server's own measure is replaced by it), adds 5 s per gate missed, and ends the race when all
  have finished or left, or 60 s after the winner.
- **A race:** lobby (host picks ground and laps; the others get ready) → countdown (5 s, on the
  grid, held) → racing → results → back to the grid. Late joiners watch and race the next one; a
  dropped connection keeps its seat for 20 s; a second tab takes over the seat.
- **Best laps:** every valid lap (all gates, in order), raced or driven around the room, goes to the
  server, which keeps each driver's fastest per map, ground and car in `<DATA_DIR>/records.json`
  (`lib/race/records.mjs`; a lap can't be longer than the server's clock says since the last one).
  The room hears its map and ground's (`records`): the panel lists them (your car / all cars), and
  the sim's timer shows your BEST with that car, the checkpoint deltas against it and, all the
  time, the best lap with each car and its driver. Right of the timer, BEST LAPS lists every driver's best
  with the car you drive on this map and ground (the top 10 and yours, with the gap to the fastest; under
  the minimap, shorter, when the window is narrow). An edited map keeps its times, marked "earlier layout"
  (and without their splits).
- **Ghost car** (the room panel's Ghost car: Off / Track record / Car record / My best, kept in the
  browser, `lib/client/ghost.ts`): a lap better than the driver's best brings its path (`trace`: 10
  samples a second of position, orientation and steering, from the replay tape), kept in
  `<DATA_DIR>/ghosts/`. `SimFrame` asks for the chosen record's (`ghost`) and hands it to the sim,
  which drives a see-through copy of that car along it, on the start line until our lap starts and
  then in step with it. Only laps on the map as it is now have one.
- **Damage:** the sim posts `hit {h}` / `repair`; `server.mjs` relays them (`lib/race/hub.mjs`,
  `hit`, `repair`, and `hits` with everyone's so far on joining); `lib/client/net.ts` keeps the room's
  log for a sim that loads later, and `SimFrame` hands it over.
- **Sign-in to socket:** `/api/ws-ticket` (behind Auth.js) signs a one-minute ticket with
  `AUTH_SECRET`; `server.mjs` checks it, and the page's origin, on the upgrade.

## On the Genie box

The admin's nginx routes `https://<box>/projects/carsim` to port 7001 and keeps the prefix, so
`.env.local` there sets `BASE_PATH=/projects/carsim` (Next's basePath, also used for `/ws`,
`/api/health`, the sim's iframe and Auth.js) and `ALLOWED_DEV_ORIGINS=<public host>` (else
`next dev` blocks its own scripts for that host and the page never hydrates). Leave both unset at
a domain's root (Railway). Google's redirect URI there:
`https://<box>/projects/carsim/api/auth/callback/google`.

## Deploy on Railway

1. New project → deploy from this repo. `railway.json` sets the build (`npm run build`), the start
   (`npm start`), the health check (`/api/health`) and **one replica**: rooms live in the
   process's memory, so more replicas would split them.
2. Variables: `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` (and `AUTH_GUEST=1` only if
   guests should be allowed). `PORT` is Railway's. Node 24 (`engines`).
   The maps, the best laps and the saved autopilots are files: add a **volume** (e.g. mounted at `/data`) and
   set `DATA_DIR=/data`, or every deploy starts again from the figure-8 alone, with no times.
3. Generate a domain, then in Google Cloud → APIs & Services → Credentials → the OAuth client
   (Web application): authorised redirect URI `https://<domain>/api/auth/callback/google`.

A redeploy restarts the process: races in progress end, and the browsers reconnect by themselves
(the server closes their sockets with 1012 on SIGTERM).

## Files

| | |
|---|---|
| `server.mjs` | HTTP server: Next, `/ws`, `/api/health`, heartbeat, graceful shutdown |
| `lib/race/hub.mjs` | rooms and races (transport-free, tested in `test/hub.test.mjs`) |
| `lib/race/shared.mjs` | cars, paints, grounds, limits shared by server, UI and sim |
| `lib/race/ticket.mjs` | WebSocket tickets (HMAC) |
| `lib/race/records.mjs` | the best laps on disk (tested in `test/hub.test.mjs`) |
| `lib/admin.ts` | the super admin (`SUPER_ADMIN_EMAIL`) |
| `lib/maps/store.mjs` | the maps on disk, course checks (tested in `test/maps.test.mjs`) |
| `lib/autopilots/store.mjs`, `app/api/autopilots/` | the trained autopilots saved on the server (tested in `test/autopilots.test.mjs`) |
| `app/api/maps/` | the maps API |
| `app/maps/`, `components/maps-admin.tsx`, `components/map-editor.tsx` | the admin's map list and editor |
| `lib/client/maps.ts` | the maps from the browser: lists, a room's course |
| `lib/client/net.ts` | the browser's socket, subjecto Subjects |
| `components/race-room.tsx` | the race page: panel, best laps, standings, results |
| `components/sim-frame.tsx` | the sim iframe and its postMessage bridge |
| `components/race-controls.tsx` | car, paint (UI SDK colour picker), map (UI SDK select), ground and laps (UI SDK segmented controls) |
| `auth.ts` | Auth.js: Google, guest |
| `public/sim/` | the engine |
| `scripts/patches/autopilot.py` | the autopilot: a tiny network trained in the browser to drive a lap (I) |
| `scripts/models/` | detailed car models from downloads (`cars.mjs`: what to take from each, `build-car.mjs`) |

## Not yet

- Car-to-car contact is approximate (each side pushes only itself, against a position 120 ms old).
- The single-player sim (`/sim/index.html`) still has its own editor, saved in that browser only;
  its Export can be imported as a map by the super admin.
- Rooms are in memory only: one replica, and a restart clears them.
