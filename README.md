# Sand Buggy Rally

Real-time multiplayer racing on the **Sand Buggy** vehicle sim: sign in with Google, open a room,
pick a car and a paint, and race up to eight drivers around the figure-8 on sand, earth or road.

- **Next.js 16** (App Router) + **Tailwind 4** + **shadcn/ui** (radix-nova) for the pages
- **UI SDK** (`@ui-sdk/react`) for what shadcn lacks: the paint colour picker and the segmented controls
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
  `node scripts/extract-engine.mjs new.html /tmp/x && python3 scripts/patches/mp-hooks.py /tmp/x/engine.js scripts/patches/mp-block.js && python3 scripts/patches/track-shape.py /tmp/x && python3 scripts/patches/gates.py /tmp/x && python3 scripts/patches/cameras.py /tmp/x`.
  Gates are 6 m tall (banner foot ~5 m) and fade to 25% when the camera comes within 6–15 m of one.
  The detailed models' driver's-seat camera sits 0.3 m ahead of (and 5 cm above) the driver's eyes.
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
| `lib/client/net.ts` | the browser's socket, subjecto Subjects |
| `components/race-room.tsx` | the race page: panel, standings, results |
| `components/sim-frame.tsx` | the sim iframe and its postMessage bridge |
| `components/race-controls.tsx` | car, paint (UI SDK colour picker), ground and laps (UI SDK segmented controls) |
| `auth.ts` | Auth.js: Google, guest |
| `public/sim/` | the engine |

## Not yet

- Car-to-car contact is approximate (each side pushes only itself, against a position 120 ms old).
- The course is the default figure-8; the single-player editor's courses aren't shared to rooms.
- Rooms are in memory only: one replica, and a restart clears them.
