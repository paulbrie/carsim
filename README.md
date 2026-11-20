# Sand Buggy Rally

Real-time multiplayer racing on the **Sand Buggy** vehicle sim: sign in with Google, open a room,
pick a car and a paint, and race up to eight drivers on sand, earth or road, around the figure-8 or a
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
- **Optimise the road**: levelling 100% and banking 25°, so every bend gets the angle its speed needs.

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

## Maps and the super admin

`SUPER_ADMIN_EMAIL` in `lib/admin.ts` (a constant: aelythe@gmail.com) is the super admin, when signed in
with Google and that email verified by Google (`session.user.admin`, worked out on every request;
guests never are). Only the super admin can create, edit and delete maps; anyone signed in can race them.

- **`/maps`** (the user menu's *Maps*, admin only): new map (a copy of another, or an editor
  *Export course* file), copy, delete, open in the editor. The figure-8 is built in: editable, not deletable.
- **`/maps/[id]`**: the sim in edit mode (`/sim/index.html?edit=1`) on its course editor, with the
  map's course and nothing saved in the browser; *Save* (or Ctrl/Cmd+S) puts the course on the
  server. E drives the course to try it, and back.
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
  `node scripts/extract-engine.mjs new.html /tmp/x && python3 scripts/patches/mp-hooks.py /tmp/x/engine.js scripts/patches/mp-block.js && python3 scripts/patches/track-shape.py /tmp/x && python3 scripts/patches/gates.py /tmp/x && python3 scripts/patches/cameras.py /tmp/x && python3 scripts/patches/maps.py /tmp/x && python3 scripts/patches/road-level.py /tmp/x && python3 scripts/patches/damage.py /tmp/x && python3 scripts/patches/freelook.py /tmp/x && python3 scripts/patches/glass.py /tmp/x`.
  Gates are 6 m tall (banner foot ~5 m) and fade to 25% when the camera comes within 6–15 m of one.
  The detailed models' driver's-seat camera sits 0.3 m ahead of (and 5 cm above) the driver's eyes.
  **Shift+drag** or **right-drag** looks around: the chase camera swings round the car (drag right:
  the view turns right; down: from higher up), the cockpit view turns your head (up to ~130° each way);
  let go and it eases back behind after 0.7 s. The orbit (C) and editor cameras keep their own mouse controls.
  Opened without `?mp=1`, `/sim/index.html` is the single-player sim as it was (editor, bots, replays).
- **Physics run in each browser.** A client reports its car 20 times a second; the server relays
  the positions to the room; the others draw it 120 ms in the past, interpolated, and push against
  it like the sim's bots (each side moves only its own car). Laps and the finish come from the
  sim's own gate timing; the server keeps the order and the clock (a finish time far from the
  server's own measure is replaced by it), adds 5 s per gate missed, and ends the race when all
  have finished or left, or 60 s after the winner.
- **A race:** lobby (host picks ground and laps; the others get ready) → countdown (5 s, on the
  grid, held) → racing → results → back to the grid. Late joiners watch and race the next one; a
  dropped connection keeps its seat for 20 s; a second tab takes over the seat.
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
   The maps are files: add a **volume** (e.g. mounted at `/data`) and set `DATA_DIR=/data`, or every
   deploy starts again from the figure-8 alone.
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
| `lib/admin.ts` | the super admin (`SUPER_ADMIN_EMAIL`) |
| `lib/maps/store.mjs` | the maps on disk, course checks (tested in `test/maps.test.mjs`) |
| `app/api/maps/` | the maps API |
| `app/maps/`, `components/maps-admin.tsx`, `components/map-editor.tsx` | the admin's map list and editor |
| `lib/client/maps.ts` | the maps from the browser: lists, a room's course |
| `lib/client/net.ts` | the browser's socket, subjecto Subjects |
| `components/race-room.tsx` | the race page: panel, standings, results |
| `components/sim-frame.tsx` | the sim iframe and its postMessage bridge |
| `components/race-controls.tsx` | car, paint (UI SDK colour picker), map (UI SDK select), ground and laps (UI SDK segmented controls) |
| `auth.ts` | Auth.js: Google, guest |
| `public/sim/` | the engine |

## Not yet

- Car-to-car contact is approximate (each side pushes only itself, against a position 120 ms old).
- The single-player sim (`/sim/index.html`) still has its own editor, saved in that browser only;
  its Export can be imported as a map by the super admin.
- Rooms are in memory only: one replica, and a restart clears them.
