# Carsim

**Human drivers against tiny neural networks**, on the same simulated cars and tracks (https://carsim.paulbrie.com).
A person can just drive, drive and build networks, or just build networks: both sides use the same vehicle sim.
Drive alone with no account; sign in with Google to race up to eight drivers in a room (fifteen cars, sand, earth or
road, the figure-8 or a map the super admin made) and to save a network on the server. The best lap of each side,
car by car and track by track, is the leaderboard.

## The pages (#320)

| | |
|---|---|
| `/` | the home page, public: the closest duel on the board, the three ways in, the scoreboard, how a network drives and learns, the simulator, the findings (`app/page.tsx`) |
| `/drive`, `/lab` | the sim alone (`/sim/index.html`), and the same with the TNN lab opening once a car and ground are picked (`?lab=1`); redirects in `next.config.ts`; no account needed. Its start menu picks the track first: the race rooms' maps or the course of one's own (below) |
| `/leaderboard`, `/networks` | public: humans vs networks on every track; every saved network drawn from its weights |
| `/tnn` | public: what a tiny neural network is, for teenagers: a neuron to play with (`components/tnn-explainer.tsx`), the networks, evolution on a map of two weights, sizes, measured speed (`PERF` in the page: change it when re-measured), a saved network's weights |
| `/tech` | public: what the physics takes into account, with its constants, and every car's figures (torque and power curves, gearing, top speed, suspension, tires), read from `public/sim/engine.js` itself (`lib/tech/specs.mjs`) |
| `/signin` | Google (and a guest name where allowed); `/?next=…` from before still lands there |
| `/lobby`, `/race/<code>` | race rooms (signed in) |
| `/maps`, `/maps/<id>` | the super admin's maps and their editor |

- **The scoreboard** (`lib/showcase/store.mjs`, read-only, kept 10 s): a human's lap is a best lap from a race room
  (table `records`), a network's is a saved network's best exam lap (table `autopilots`, as its browser timed it) or a
  best lap a network drove in a race room (a record with `net`, #333), shown with its name and who made it. A
  network names its course by the sim's `courseKey()`; the same hash of a map's course says which map that is, as
  laid out now (`courseKey` there is the sim's, and `test/showcase.test.mjs` runs the sim's own against it). A lap on
  an earlier layout, or a network trained on a course that is no map's (the solo sim's own figure-8, a circuit of
  one's own), is on no board; the network still shows in `/networks`.
- **Watch it drive** (#336, `/networks`, signed in or not): each network's card opens the sim at
  `/sim/index.html?net=<id>` (`scripts/patches/preview.py`). It fetches the network from `/api/networks/<id>` (public:
  what it takes to drive, its best weights, and its maker's name as the page shows it), takes its ground, car and
  track (the map its course is; the figure-8 when it learnt a course of its maker's own) and drives it, a bar at the
  bottom saying whose it is (✕ ends it). Nothing of it is kept: the visitor's own lab training and settings in that
  browser stay as they were (`aiSave` does nothing while `AI.preview`; Train goes back to their own). Still for 4 s
  (against a post, off the road), it starts again from the grid. It drives with the visitor's lab settings (racing
  line, pace), which a saved network doesn't carry: one trained with others may drive a little differently.
- **Names on public pages**: a visitor who is not signed in sees "Paul B." (`publicName`, `lib/format.ts`); signed in,
  the full name.
- **The look**: one dark theme, tokens in `app/globals.css` (`--human` orange, also the primary; `--tnn` cyan; classes
  `.display`, `.heading`, `.eyebrow`, `.num`, `.panel`). Type: Archivo (wide, for headings), Geist, Geist Mono, self-hosted
  from `public/fonts` (SIL OFL). `components/brand.tsx` is the logo, `components/site-nav.tsx` the bar on every page.
  `components/track-outline.tsx` draws a track from its waypoints, `components/net-diagram.tsx` a network from its weights.
- **The sim's own page** has the same look from `public/sim/ui.css` and `public/sim/ui.js` (`scripts/patches/ui.py`, last
  in the chain, only adds them to `index.html`): the rail of buttons under the minimap (stand-ins for the sim's own
  buttons, each with its key), the keys sheet (H), the start menu's frame and **Track, car and ground** to open it again,
  the way home. Nothing in `engine.js` depends on them.

- **Next.js 16** (App Router) + **Tailwind 4** + **shadcn/ui** (radix-nova) for the pages
- **UI SDK** (`@ui-sdk/react`) for what shadcn lacks: the paint colour picker and the segmented controls
- **subjecto** for client state (the socket's rooms, room, standings: `lib/client/net.ts`)
- **Auth.js** (next-auth v5) with Google; a name-only guest sign-in for development
- **One Node.js process** (`server.mjs`): Next, the race WebSocket at `/ws`, and `/api/health`, on `$PORT`: made for Railway

## Run it

```bash
npm install                  # also copies three.js into public/sim/vendor (postinstall)
docker compose up -d         # Postgres 17 on 127.0.0.1:5554 (the maps, the best laps, the saved autopilots)
cp .env.example .env.local   # set AUTH_SECRET (openssl rand -base64 32), DATABASE_URL, and Google if you have it
npm run dev                  # http://localhost:7001 (brings the database up to migrations/ first)
npm test                     # race server, stores and ticket tests (node:test; the stores' need the Postgres above)
npm run typecheck
```

Without Google credentials the sign-in page offers a guest name instead (development only, or
`AUTH_GUEST=1`). To try a race alone, `node scripts/bot-driver.mjs <ROOM CODE>` adds a scripted
driver to a room: it gets ready, lines up, drives the course, and finishes.

## Course editor (single player: `/sim/index.html`, E)

**GENERATE A CIRCUIT** (#315) makes a new closed course: a **length** (0.5–3.5 km), a **style** (*Flowing*: few,
wide bends and long straights; *Mixed*; *Twisty*: hairpin after hairpin) and a **seed** (any number or word: the
same seed, length, style and min. corner radius always give the same circuit; **New circuit** picks a random
one). Its corners are no tighter than SHAPE's **Min. corner radius**, it never comes within 22–28 m of
itself (but where it crosses itself) and stays inside the world; it is levelled, graded (6 %) and banked (8°) as
the maps are, on the ground it is driven on, without terrain strokes, and built at once like any edit.
**Bridges** (#326: 0, 1, 2, 3 or *Random*, a number drawn from the seed) is how many times the road crosses over
itself: the blob's outline is twisted across that many of its necks (a stretch one cell wide, or a one-cell slot
between two arms of it: its two sides cut and joined crosswise, so the road loops over itself there, like the
figure-8), and the circuit kept only if the sim would bridge every crossing (55° or more, the bridges and their
ramps apart along the road as `buildTrack` wants them, the start clear of them). 0 gives the circuits as before.
The world holds only so many: with 25 m corners one fits at any length, two from about 1.2 km, three at 1.4 km
for most seeds (with 20 m corners, three from 1.4 km); fewer than asked, the hint says so. **Back** returns to the course before (the last 20). How it is made (`public/sim/circuit-gen.js`): the
outline of a random blob of grid cells (fingers of the blob are hairpins, its sides straights; never a hole or two
cells touching by a corner, so the outline never touches itself), the grid turned, the plane gently warped, some
corners cut, every corner rounded with an arc, then checked on the very Catmull-Rom curve the sim builds; the
first of up to 360 blobs within 6 % of the length wins, or the nearest. A 400 m world only holds so much road:
with 25 m corners about 1.3–1.8 km at most, with 18 m 1.4–2.6 km, with 12 m 2.1–3 km; the hint under the buttons says
when the circuit is shorter than asked. **MY CIRCUITS** keeps courses (generated or not) in this browser under a
name (`carsim.circuits` in localStorage): **Save as…**, **Load**, **Delete**; ● marks the one in the editor.
Best laps and the autopilot's trainings go by the course, so each circuit keeps its own: load another to train
on it, and back. The same generator from node writes course files (for Import, or maps with `add.mjs`):
`node scripts/maps/generate.mjs --seed 42 --km 1.6 --style twisty --r 20 [--bridges 2] --ground road [--count 10] [--out dir]`
(tests: `test/circuit-gen.test.mjs`).

Every change is built while the editor stays open (#326, `scripts/patches/live.py`): a moment (0.35 s) after the
course stops changing, not while a waypoint is held or a brush paints, the world is rebuilt (road, ground, banking,
levelling, grades, bridges and their earthworks, gates) and the note under the editor's numbers says so; closing the
editor then has nothing left to build. (A rebuild is about a second here, under half what it was: the bridges'
earthworks and the distance to the course find their nearest points from a field made once, the same ground.)

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
- **Car against car** (#322, `scripts/patches/contacts.py`: `ccSolve`, for the bots, the other players and the
  autopilot's rival alike): each car is a capsule on the ground (its box's length, its half width round the ends),
  the impulse goes in at the point where they touch, with both cars' masses and yaw inertias, so a hit off the
  centre turns them (a nudge on the rear quarter spins the car hit), with a little bounce (0.35 in a bump, 0.08 in a
  hard hit: the bodies crumple) and the bodies' scrape along each other (friction 0.3). Momentum and angular
  momentum are kept, energy only lost. A bot hit is knocked along its line (its speed), across it (it slides till its
  tires stop it, 7 m/s²) and turned off it (it catches it in about a second); before, it was on rails: we bounced off
  it as off a wall, and one hit from behind slowed down (a parked RS 6 hit at 34 km/h stopped a Supra dead and didn't
  move; now the Supra goes on at 3.6 m/s and the RS 6 at 4.3).
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
- **The cutting's ends meet the road** (#314): the cutting climbs to the road's height where it ends
  (it used to aim at the height where it was first measured, up to 35 cm off: a step a car hit at speed),
  and over its last 10 m the road's banking comes back in (it was flat to the end, then banked: a step
  at the road's edge on a bend just past an underpass).

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

## Pause

**P**, or **Pause** in the rail, stops the physics: the car, the lap's
clock and the engine's sound stand still while the camera, looking around (Shift/right-drag) and the panels go on;
**P** or **▶ Resume** drives on (`scripts/patches/pause.py`, `__sim.paused`). Not in a race (the countdown and the race:
the room's clock doesn't stop; a race starting ends a pause), in the editor or a replay, nor while the autopilot trains
(Stop is its pause). Tire pressure, P before, is **Shift+P**.

In a room, the timer's best laps with each car and the best laps with ours beside it fold away: click their
**BEST LAPS** title (kept in this browser, `sandbuggy.foldBest`; the title takes the click, the rest of the panels let
it through to the drive). The timer's checkpoint times of the last laps fold the same way, in the single-player sim
too: click **LAP DETAILS** (#317).

## The sound on or off (M) (#343)

**M**, or **Sound** in the rail (it reads On or Off), turns the sim's sound off and on: everywhere in the sim (the
course editor and a replay too: the editor's key handler used to return before M, while the engine idled on), with a
short "Sound off" / "Sound on" on screen, and kept in this browser (`carsim.muted`). One switch, `setMuted`
(`scripts/patches/sound.py`; `__sim.sound`: `muted()`, `set(on)`). In a race room, M pressed while the keyboard is in
the room's own panel is passed on to the sim (`{ t: 'mute' }`, `components/race-room.tsx`): the sim's frame doesn't
get the page's keys. A training's silence is its own (the tries make no sound unless watched).

## All-wheel drive's torque split

A car with permanent all-wheel drive shares the engine's drive between its axles as a centre differential
would (`scripts/patches/cars.py`): each axle gets its share, and the engine turns at the axles' speeds
weighted by those shares. A car's own split is `split` in its spec (the front's share; 0.5, evenly, when it
has none): the X7 sends 40/60 to the rear, so it can be pushed into a slide. **4** cycles it through 50/50,
40/60, 30/70 and 20/80 (the HUD shows it when it isn't even), kept per car in this browser
(`sandbuggy.split`). The autopilot's workers get the tab's split, and an uneven one is part of its exam
(`aiExamKind`): a training made at another split is examined again.

## Car setup (U) (#332)

**Car setup** in the rail, or **U**, slides a drawer in from the left (as the lab's; one of the two at a time) with
what a driver may change on the car, and what each choice means:

- **Drive**: a car driving all four wheels gets a slider for the front / rear share of the torque, any 5 % from
  100 / 0 to 0 / 100, with the car's own marked and one click away (the 4 key still goes round 50, 40, 30 and 20 %
  front); the buggy also chooses rear-wheel or four-wheel drive; a rear-drive car says it has nothing to set. A
  sentence says what that split does to the car, with the weight its front axle carries.
- **Tires**: the car's three pressures (Shift+P as before), and a table of the tire model's own figures for each of
  them on the ground under the car: the contact patch, how deep the tire sinks, what rolling costs at 60 km/h, how
  much lower the car sits. The sentence under it is made from those figures. On asphalt it says what is true of
  the sim today: the tire grips the same at every pressure there (the model is the sand's: pressure decides how the
  tire sinks), only its radius changes.
- **The car from above**, front to the left: the torque down each shaft, and in each wheel the grip that tire is
  spending as you drive, on driving or braking (orange) and on cornering (white); a tire at its limit turns red.

The setup is the sim's (`scripts/patches/setup.py`: `SETUP`, `__sim.setup` — `get()`, `split(front)`, `drive(awd)`,
`pressure(i)`, `figures(i)`); the drawer is its view (`public/sim/ui.js`, `#uiSetup` in `ui.css`). It is kept per car
in this browser (`sandbuggy.split`, and `sandbuggy.setup` for the pressure and the buggy's drive; only what differs
from the car's own) and put back whenever that car is picked, alone, in the lab or in a race room. A training under
way starts again when the setup changes (its workers have the car as it was), and another pressure or the buggy's
other drive is part of the lab's exam like an uneven split: the best is examined again. `tireFigures` repeats
`stepCar`'s sums for a wheel at rest: change one, change the other (`test/setup.test.mjs` checks the terms).

In a race room the room's own panel is down the same side, over the sim. The sim's page tells the room's when one of
its drawers (this one, the lab's) opens or the last one closes (`{ t: 'drawer', open }`, `ui.js`): the panel steps
aside and comes back after it; opened over a drawer, it has the sim close it (`{ t: 'drawers', close: true }`).

## Grounds

Each ground has its own landscape (`scripts/patches/grounds.py`). **Sand**: the dunes, slip faces and
all. **Earth**: a firm-earth countryside instead: broad rolling hills (about 15% at the steepest, no slip
faces), patched with dry grass that stops at the course's verges and wears off where wheels pack the
ground; a cooler haze than the desert's dust. **Road**: tarmac through the same countryside, with earth
verges (off the road the ground is earth, not sand). The tarmac is 12 m wide: two 4.5 m lanes between
the edge lines and 1.5 m shoulders; on the road the bridges' decks, ramps and cuttings are as wide.
Switching between sand and the other two rebuilds the world (other hills), as switching the road on or
off already did.

## The TNN lab (the autopilot): a tiny network that learns to drive (I)

**I** or **TNN lab** in the rail opens the lab's panel (in the code and below, the autopilot) (single player, and in a race room in the lobby
or after your finish, not on the grid or in a race: a race starting stops it; while it trains there the others
see none of it, and its laps are never your best laps); **Train** has a neural network learn to drive a lap of this course with this
car, in the browser, on the sim's own physics (`scripts/patches/autopilot.py`); **Drive it** hands the car to
the best one so far (any driving key takes it back). While it drives, **pedals around the course** draws the course
as the minimap does, with where it went coloured by its pedals (orange gas, grey coasting, blue brake, five steps a
side) and white rings where it pulled the handbrake: at each metre of the line the latest pass (`aiMapRec`, a
decision at a time), hover for the speed and pedals there; it stays after the drive, until a training or the next
drive (in full screen, right of the charts). What it learnt is kept per course, car and size in the
browser, whole (#341, `scripts/patches/keep.py`): the weights, every generation's chart (not only the last 300), the
last exam and the rivals, saved at each generation's end and again when the page is hidden or left, so a reload
loses nothing. With the browser's storage full, the chart's oldest generations go first (2000 kept, then 300, then
none); if even that won't fit, the lab says once that the training is no longer saved; **Save to file** downloads it (weights, generations, chart, as JSON) and **Load file** brings it back,
here or in another browser (made with another car or course, it asks first, and its record doesn't count).
**Save to server** keeps it on the server under a name, and **From server** lists everyone's (this car and
course's first): load any, delete yours. `/api/autopilots` (signed in; `lib/autopilots/store.mjs`, one row each in
the database's `autopilots`, at most 50 a driver; only the one who saved it, or the super admin, deletes it).

- **The network:** 7 inputs straight to 2 outputs (steering, and a pedal: + throttle, − brake), each the tanh
  of a weighted sum: 16 weights. **hidden** (in Training) puts a hidden layer of tanh units between: 2 to 64 of
  them (8: 82 weights; 64: 642), or none. Each size is a training of its own, and the choice is kept. A size not
  trained yet starts from the one shown, when both have a hidden layer: its units carried over (the first ones, to a
  smaller size), the new ones looking at the inputs but not yet heard, so it drives as before until it learns more
  (**Start over** for nothing). A bigger layer can learn more, but has more weights to tune: expect it to need
  more generations.
- **What it sees:** by default its speed; where the racing line is 6, 15 and 30 m ahead (the sine of the
  bearing); how far it is to the side of the line; its yaw rate; and a pace note: the speed the line can be taken
  at there (from its bends and the ground's grip, the same profile the bots use) less its own. **Inputs, outputs
  and penalties** (in the panel) picks others too: the racing line further ahead, 50 and 100 m (#342: the bends
  a fast car must set up for early; on the track, a marker for each when it has them), the distances to the course's left and right edges (the
  tarmac's on road, the gate posts' off it), 5 edge rays (feelers at ±60°, ±30° and ahead: how far until they
  leave the course, up to 40 m, drawn on the track), its sideways speed, its wheels' slip (the front pair's and the rear
  pair's slip ratio: + spinning, − locking), its wheels' sinkage (the deepest:
  digging in on sand), its tilt (roll and pitch: about to roll over), the g (forward and sideways acceleration,
  smoothed over 0.1 s); and a third output, the handbrake (on
  above 0). Each set is a network and a training of its own (`AI_INPUTS`, `aiSetInputs`); a set not trained yet
  starts from the one it was changed from, the new inputs' (and a new handbrake's) weights at nothing, so it drives as
  that one did and training carries on from there (`aiCarry`).
- **Brake** (ticked by default): unticked, the pedal output is gas or nothing (below 0: off, `AI.nb`), so it slows
  by lifting off or, with the handbrake output, by pulling the handbrake. A training of its own (`+nobrake` in its
  key), started from the one with the brake; saved files and the server keep it (`noBrake`).
- **The handbrake's rules** (under the handbrake output, `aiHbOk`): **only with the wheels turned** (the front wheels'
  angle, not the steering output, at least a share of the lock the car has at its speed: 30 % by default) and **never
  with the brake** (the pedal output braking). Rules, not penalties: the output still asks, `aiAct` lets it through only
  within them, in every try, exam (on every core) and Drive it, so it learns where the handbrake pays within them; the
  last exam says how long it was held back. They are part of the exam (`aiExamKind`): a best made without them is
  examined again. The rival (its own brain) keeps its handbrake free.
- **A rival** (two networks racing, without colliding): another of the same road car on the course, driven by an
  earlier best of the same network. **A replay** drives its own lap as if alone (a tape recorded before each try,
  `aiRvRecord`) and doesn't react: ours learns to keep off it, follow and pass. **A car** is a second car with physics
  of its own: the sim's physics drives one car (`car`, with `VEH`, `ENG`, `PRESSURES`, the box, `input` and the frame
  vectors), so the rival is a whole car's state kept aside and swapped in for its steps (`aiRvSwap`); both see each
  other, and they push and dent each other (`aiCarContact`: `ccSolve`, as the bots, both pushed by their masses).
  The **rival inputs** (rival ahead, behind, side, closing: all 0 beyond 30 m along the line) let the network see
  it. Training: a share of generations (`rivalShare`, half) start their tries with it ahead and slower (to catch),
  alongside, or close behind (`aiScenario`); each impact costs **contact** metres per m/s, the car behind taking 3/4
  of the blame and alongside half (so braking in front of it costs too), and **gained** pays per metre gained on it
  (0 by default: it races the clock). The rivals are copies of the best, one every 10 generations (the last 4 kept,
  `AI.rvPool`; the best races the newest at once). Every exam is also a race: a lap from the grid alongside the
  newest rival, its impacts, damage and not finishing taken off the exam's score (`aiRaceCost`). **Race it** drives
  ours against the best as rival, and shows the gap and contacts. Only with road cars (the buggy is built once).
  **Rival car**: the same as ours, or another model, which then drives with its own best training on this course in
  this browser (`aiBrainOf`: the fastest lap among its trainings; train one with that car first) as it was trained:
  its inputs, size and outputs from the training's key, its pace notes, racing line and look-ahead from its exam's
  settings, its own record lap as its demo. Its driver is swapped in for its decisions as its car is for its steps
  (`aiBrainSwap`); it doesn't learn (no earlier bests of ours as rivals), and a better training of it re-examines ours.
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
  before where it last went wrong, round the lap from the line: a flying exam going off just after the line
  practises arriving there at speed; and from the line, standing, when the exam went wrong in its first 100 m:
  with rolling starts no try practised pulling away, `aiTryFrom`, #348), scores each by the metres covered (100 m
  less for ending off the course, stuck or wrecked), and moves the weights toward the better ones (by rank, with
  Adam). Then an exam: the new weights from the start line for a lap; the best exam's weights are the autopilot.
  Physics only, 12 ms a frame; the ground's ruts are put back after every try.
  **A training that has lost the lap goes back to the best** (#348, `aiLost`): once it laps, 20 exams in a row
  without a lap put the best weights back (as Back to the best does). What pays on one generation's 15 s stretch
  can cost on another's, and training used to wander off its first laps for good: on prod's figure-8 with the X7
  (8 inputs with offset, exams from the line, 600 generations, four seeded runs headless) the generations whose
  exam lapped were 18 / 0 / 0 / 0 / 0 / 0 per hundred in one run, 24 / 91 / 45 / 15 / 9 / 0 in another; with it
  31 / 53 / 41 / 40 / 16 / 30 and 24 / 91 / 65 / 67 / 32 / 59 (flying exams with rolling starts: 23 then none, against
  69 / 37 / 38 / 90 / 60 / 35). The best lap is no faster for it by itself; one run of the ten on the fixed engine never lapped (as that
  seed didn't before).
  **How tries are scored, as settings** (#348, *Tries, exams and when to stop*): **tries last** (15 s by default),
  **a try that ends badly costs** (100 m), **… and per km/h it ended at** (0: `aiEndCost`, the speed the car had as it went
  off, stuck or wrecked: going off at 140 km/h costs more than at 60, which tells it where it was too fast), and **back to
  the best after exams without a lap** (20; 1 keeps only the steps whose exam still laps; 0 never). With 15 s tries and
  100 m, a try that went faster and then off late in its window scored about as well as a careful one, while an exam
  needs a whole lap without a mistake: on prod's figure-8 (X7, headless, 400 generations) 300 m with 25 s tries lapped in
  159 and 236 generations of two runs (best 51.5 s, 52.4 s), against 11, 45 and 98 (53.6–54.6 s) with the defaults.
  With 16 hidden units: defaults 59 and 92 generations lapped of 400 (56.0 s, 51.0 s); 300 m and 25 s, 307 and 186
  (49.6 s, 51.9 s); 100 m + 3 m a km/h and 25 s, 254 and 380 (52.3 s, 49.3 s); 300 m, 25 s and only lapping steps, 386 and
  389 (49.6 s, 51.3 s). That last, with 2 m a km/h, from scratch in the super admin's browser with every other setting at
  its default, then flying exams: 45.65 s flying in Drive it on the figure-8 with the X7 (the driver's record there: 46.02).
  **A lap's time in an exam** grows with the course (`aiLapT`: 150 s, or the course's length at 10 m/s): a flying exam on a
  2.1 km course had 150 s for its two laps, and ran out of time before the timed one however fast it went.
- **Watch at 1×** runs the training at real speed, with the sound, to follow every try (it learns the same, only
  slower); **Full speed** goes back. The panel shows the decisions a second: the network runs on the main thread,
  in the sim's input step, as it needs the car's physics state, which lives there (31 ns a decision for the 16
  weights; a training step is ~67 µs, nearly all physics: ~15,000 decisions/s flat out, ~250× real time).
- **Its hands and feet:** while it drives or trains, a steering wheel and the brake and gas pedals, top right
  (between the timer and the minimap), show exactly what it applies: the wheel turned as far as it steers (full
  lock: three quarters of a turn), the pedals in 3D (a renderer of their own, drawn into that overlay: the brake hung
  from under the dash, the gas hinged at the floor) each pressed and lit as far as it is pressed, with a see-through
  foot moving between them, and the handbrake if it has one. Without WebGL for it, a flat drawing.
- **Several cores** ("cores to train on", in the panel's *This computer* card): this tab plans each generation and
  drives some of its tries (the ones on screen); copies of the sim in Web Workers, one a core, drive the others and
  the exams at full speed, an exam alongside the next generation's tries (whose start, where the last exam went
  wrong, is then one exam late). A worker is this very `engine.js`, fetched and loaded without its imports (three
  from the import map; the drawing add-ons and the WebGL renderer stand-ins) over a DOM that is a stub taking
  anything (`aiWorkerMain`, `AI_WK`: no frames, no render chunks), booted from a copy of this tab's localStorage
  with its course, ground and car; it is used only if its ground's hash is this tab's, and drives with the same
  physics (an exam of the RS 6 network: 1634.3400375909766 in the tab and in a worker). A worker with nothing to do
  drives the tab's try too (the same result: the first in counts). About 70 MB a worker; 7 cores ran ~8
  generations where 3 ran 2 (headless). `aiTrainSync` / `aiTry` stay in the tab.
- **Beside Train:** the cores, the most generations to train (empty: no limit; the same setting as in *Tries, exams
  and when to stop*), and the speed (1×, 2×, 4×) Watch plays the training and Drive it / Race it drive at (more
  physics steps a frame). On several cores the pedals and the network aren't animated while it trains (they cost
  this tab's thread), unless watching; the diagram shows the weights.
- **How busy the cores are** (under the status, while it trains): browsers don't give a page the CPU's load per core,
  so each second it shows how much of it each of our threads worked (this tab: its frames, start to end; a worker:
  from being sent a job to its answer), the longest frame (a freeze shows there), Chrome's CPU pressure
  (`PressureObserver`), and this tab's JavaScript heap (`performance.memory`; a worker's isn't reported). The
  best's re-race against the newest rival (every 10 generations with a rival car) runs in a worker: in the tab it
  froze the page for about a second.
- **Best laps on this course** (left column): every training in this browser on this course, one row a car and
  network, the fastest first, with its generations and (hover) its exam and when the best was set (`bestAt`).
- A training step that throws stops the training with a message (`aiTrainFail`, the error in `AI.lastError`), not
  the frame loop; the Claude bridge logs the page's errors.
- **Drawing** (same card): the pedals and foot in 3D or flat; and the 3D world drawn while it trains or not (not:
  the picture stops, the panel goes on, and the training gets 15 ms of each frame instead of 12).
- **A drawer** (#331): the lab (I, or the rail's TNN lab; `/lab` once a car and ground are picked) slides in from the
  left, the window's height, and out again on ✕ or I; the drive goes on beside it, and the car's read-out moves to
  the bottom, next to it. **⤢ Full screen** widens it to the whole window, opaque: the 3D world is hidden and no
  longer drawn (all of the frame for the training); **⤡ Back to the drawer** (or Esc) narrows it back. The slide is
  CSS (`@starting-style`, `display`'s discrete transition: the sim still just shows and hides the panel); without
  them, or with reduced motion, it simply appears.
  Nothing down the left side hides under it (#339): the course editor moves beside it (a window under 720 px wide:
  the lab closes for it), the keys and the track, car and ground menu come over it, and in a room it stops short of the
  room's buttons in the bottom corner.
- **Full screen (⤢ in the panel's corner, Esc back):** three columns. The numbers (generation, best, last exam), the
  buttons and the wheel and pedals; the network as large as the screen allows (hover a dot: what it is, its value,
  its pulls on the outputs) over two charts with axes, a legend and the values under the pointer (each exam's
  score and its tries' average, the lap times and the best so far, all the generations kept); every setting in
  cards, each with what it does written under it, the inputs and outputs with a line on what they are for and
  their values live.
- **Watching it think:** the panel draws the network live while it trains or drives: each input with its value
  (km/h, degrees, metres), each output (steer left/right, gas/brake %), and a line from each input to each output
  coloured and thickened by its pull right now (value × weight; orange +, blue −). On the track, markers show
  the points on the racing line it looks at (6, 15 and 30 m ahead, and 50 and 100 m when those are inputs).
- **Driving faster** (settings there, all optional; ticket #311's RS 6 work): **pace notes: cornering g / braking g /
  acceleration g** (the bots' notes count on 0.84 g and 0.76 g on tarmac and no limit speeding up; a grippier car
  can take more), **pace note ×**, **follow a racing line** (the smoothest path within the road, **room either
  side** set, instead of the centre), **look ahead by time** (0.3 / 0.7 / 1.4 / 2.4 / 4.8 s instead of 6 / 15 / 30 / 50 / 100 m: one
  steering for every speed), **tries start rolling** (at 85 % of the notes' speed, not from a standstill), and a
  **recorded lap to follow** (**lap to follow** in the lab's left column, below; `__sim.aiDemo(trace, { who, time, src })` for any ghost's trace): its
  line and speeds take the place of the racing line and the notes. **Exams are flying laps** (two laps in a row from the
  start line, the second timed, as Drive it's laps after the first and a driver's best are: at speed over the line, on
  the ground the first lap wore, with its knocks; from a standstill a lap is ~1.5 s slower, and one lap alone hides a
  network that can't keep it up: the RS 6's 31.78 s on one wrecked in the next lap's first bend): switching it
  re-examines the best on the new exam when training starts. **Flying laps an exam times**: so many in a row after the
  first, the slowest counting, the knocks of each carried into the next: a network quick for a lap that then loses it
  scores its bad lap (the RS 6 with the handbrake, judged on one: 30.95, 31.39, then 37.89 s in Drive it; on three:
  31.00 / 31.03 / 31.05 in its exam, and six laps from 30.95 to 31.54 in Drive it, all under the record). Tries and exams start on the ground as built, not the one the
  driving before them wore (ruts and loosened ground made the same network's 31.48 s 31.68 after a few laps), and from
  a car as new (traction control and gear-change timing too): the same weights always give the same lap. Drive it decides as training does, every 1/60 s (held
  between frames), not once a frame (150 a second on a 120 Hz screen). **Back to the best** carries training on from the best weights, when it has
  wandered off from them. With an RS 6 on the figure-8 (road), from a
  36.1 s flying lap with the defaults to 33.6 s (realistic notes, look-ahead by time, rolling starts) and 32.26 s
  following the record lap (31.66 s, a driver's).
- **A lap as its example** (#340, `scripts/patches/follow.py`): how to tell the network "not like that, like this". It
  brakes where its pace note says the spot is slower than it is going, and the computed notes are cautious guesses;
  a driver's lap says where to brake and how fast each metre can be taken. **lap to follow** (left column): *none*,
  *my best lap here*, or in a race room *the ghost* picked in Best laps. Your best lap on each course with each car
  is kept in this browser with its recording as you drive (`carsim.lap.<course>.<car>`: `{ time, trace, at }`), alone
  or in a room: only a clean flying lap (`aiLapClean`: over the start line at least 0.8 of the speed over the finish,
  so not the first lap from the line; no respawn; never stopped), never the network's. Following one, the lap's line
  and speeds are the racing line and the notes (`aiDemo`, kept with whose it is and its time); a training under way
  carries on with it and the best is driven again (its time is in `aiExamKind`). A ghost's lap from the grid has its
  slow first metres replaced by the speed it ends at, eased down as the notes brake (`aiLapProfile`).
  **The review**: after Drive it, *pedals around the course* is drawn against that lap (the one followed, or your best
  lap when none is): its line in gold dashes, its speed under the pointer, and under the map (full screen: under the lap to follow) the time lost over the
  lap and the three stretches that cost the most (shaded red and numbered: from where to where, the seconds, the
  speeds, how much of it on the brake; `aiMapCmp`: more than 5 km/h slower, gaps under 10 m joined).
  Not done: notes on a stretch of the map (faster / later here), and fitting the network to the driver's own steering
  and pedals as a starting point (the ticket has the plan).
- **When to stop:** once it laps, the chart shows each generation's lap time (faster higher, dashed the best),
  and training stops by itself after so many generations without a better lap (30 unless set otherwise, 0:
  never: "stop if no better lap in … gens" beside max gens in the Training row, #330), counted afresh at each Train or Train more (#337: after such a stop,
  Train more gets as many again); the panel says how long since the best. Or a fixed number: each Train runs so many generations, then
  stops (0: until paused). Whenever training stops by itself (those two, an error, another course or car, the
  world rebuilt, the editor opened, a race starting), the lab's status line says why and at which generation
  until the next Train, and the Generation box reads "stopped", not "paused" (#323: in the full-screen lab the
  flash used to be hidden behind the panel, so training seemed to stop for no reason).
- **In a hidden tab** (another tab in front, the window minimised) training goes on: the browser sends no
  animation frames then, so a message loop drives it until the tab shows again (`aiBgKick`, #323).
- **How long:** on the figure-8 on sand with the buggy, two runs from scratch first lapped at generations 11
  and 13 (about 1–1.5 minutes of computing in headless Chrome), then got quicker (55.8 s).
- Without the pace note, or with bearings in radians (a hairpin's jumps from +180° to −180°), or always
  starting from the start line, it never got past the first sharp bend.

## Claude bridge: a Claude session working in your sim

For the super admin (as trafficsim's bridge, cut to the sim): **Claude** (in the rail) →
**Connect** shows a 6-digit code (10 minutes); a Claude session claims it with `node scripts/bridge.mjs claim
<code>` and then works in that page, in the browser it runs in (yours, with its frame rate), every command shown in
the panel's log: `state` (car, lap, autopilot, race, the panels' text), `screenshot` (the 3D view), `text`, `click`,
`set` (a field), `key`, `get` (a value of `window.__sim`), `sim` (a few of its functions by name, e.g. `aiSaveServer(name)`: the autopilot
saved on the server, as Save to server does without its name prompt; `aiForget()`: Start over without its confirm), `reload`. No
arbitrary JavaScript; the bridge's own panel and password fields are out of its reach. Write to it in the panel
(`node scripts/bridge.mjs events` reads it). **Disconnect** ends it; a reload keeps it, and so does a restart or a deploy (#348: the
pairings are kept in the database, `app_meta` `bridge.pairings`; the page's stream reconnects to the new server). Tokens are
kept per app URL in `~/.carsim-bridge.json`, so a claim on the deployed site doesn't replace the dev box's.
On the deployed site too (#346), for the super admin alone (nobody else gets the button, #338): an agent there
claims with `CARSIM_URL=https://carsim.paulbrie.com node scripts/bridge.mjs claim <code>` (the MCP tools: the same `CARSIM_URL`); past 10 wrong codes
in 10 minutes no claim is taken until they age out. `CLAUDE_BRIDGE=off` on the server turns it off (no button,
`/api/bridge/*` answers 404: `bridgeOn` in `lib/bridge/store.mjs`).
As MCP tools (`sim_pair`, `sim_state`, `sim_screenshot` (an image), `sim_command`, `sim_events`, `sim_status`):
`scripts/bridge-mcp.mjs`, which `.mcp.json` starts for Claude Code in this project.
**Without a code** (#348): with `CLAUDE_BRIDGE_AGENT_KEY` (24+ characters) in the server's environment (the dev box's
`.env.local`; not the deployed site's), `app/layout.tsx` loads `public/sim/bridge.js` on every page and the super admin's
tabs pair by themselves (*standing*), on the app's pages too (no panel there: a badge while an agent is connected, and only
`state`, `text`, `click`, `reload` and `goto`). An agent on the box, which reads the key from `.env.local`, lists them and
takes one: `node scripts/bridge.mjs pages`, `node scripts/bridge.mjs take [pageId]` (routes `/api/bridge/agent/pages` and
`/take`, header `x-bridge-key`). `goto {path}` sends the tab to another of the app's pages, e.g. from the lobby to
`/sim/index.html`, and the pairing goes with it into the sim (from a sim, only to the sim's pages). So an agent can work in
the super admin's browser overnight: through reloads, restarts and the app's own changes. Disconnect turns it off for that
tab.
Server: `lib/bridge/store.mjs` (in memory, the pairings kept in the database), `app/api/bridge/page/*` (the super admin's session and the pairing's
token), `app/api/bridge/agent/*` (the agent's token); the page: `public/sim/bridge.js` (`scripts/patches/bridge.py`
loads it and puts the renderer on `__sim` for the screenshots).

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
- **Saved** in the database (table `maps`, `lib/maps/store.mjs`), through
  `/api/maps` (GET for anyone signed in; POST, PUT, DELETE for the super admin, 403 for others).
- **Driving a map alone** (#329, `scripts/patches/tracks.py`): the sim alone (`/drive`, `/lab`) opens on a menu whose
  first row is every map, drawn, and **Your course** (the editor's or the generator's, kept aside in this browser,
  `carsim.course.mine`, while it drives a map). A pick is built at once on the ground of the moment, and stays the
  sim's course after a reload; a browser that never had a course of its own starts on the rooms' figure-8. From
  `/api/tracks` (the list: names, outlines, lengths, course keys) and `/api/tracks/<id>` (one course), public and
  read-only: nothing about who edited them. Best laps and trainings go by the course, so each map keeps its own.
- **Maps in git**: `scripts/maps/*.json`, courses as the editor's *Export course* writes them, added to
  a server's maps with `node scripts/maps/add.mjs scripts/maps/<map>.json` (named after the file, or
  `--name`; a map of that name already there is left alone, `--replace` saves the file's course over
  it), or in the app: *New map* from the file. *Serpentine* (#312): 1.59 km, twice the figure-8, about
  40 bends (the tightest 17 m, most 25–60 m) and a 270 m straight along one side of the world with the
  start on it; banked 8°, levelled, no grade over 6%. *Trefoil* (#314): 3.1 km, twice Serpentine, in the
  same 400 m world: its middle is a trefoil knot, three crossings bridged (the `bridges` entries pick which
  road goes over), and three lobes of hairpins about 34 m apart around it (switchback columns up the hill
  across the north, rows down the west and east, fingers in the south-east), on hills raised with terrain
  strokes (up to ~18 m); banked 8°, levelled, no grade over 8% (the cuttings' ends ~10%).
- **In a room** the host picks the map (lobby, or New race). The page loads its course and hands it
  to the sim as `window.__simCourse` before the iframe boots; a change goes as a `course` message and
  the sim rebuilds the world. The room's ground still applies over the map's. A waiting room (lobby,
  results) follows its map's saves within a second (#324), and a room reads its map again when a race
  starts, so an edit saved meanwhile is what everyone races (the sims reload it on the grid); a race under
  way keeps the version it started on. A deleted map falls back to the figure-8.

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
  `node scripts/extract-engine.mjs new.html /tmp/x && python3 scripts/patches/mp-hooks.py /tmp/x/engine.js scripts/patches/mp-block.js && python3 scripts/patches/track-shape.py /tmp/x && python3 scripts/patches/gates.py /tmp/x && python3 scripts/patches/cameras.py /tmp/x && python3 scripts/patches/maps.py /tmp/x && python3 scripts/patches/road-level.py /tmp/x && python3 scripts/patches/damage.py /tmp/x && python3 scripts/patches/freelook.py /tmp/x && python3 scripts/patches/glass.py /tmp/x && python3 scripts/patches/weather.py /tmp/x && python3 scripts/patches/cars.py /tmp/x && python3 scripts/patches/even.py /tmp/x && python3 scripts/patches/bridges.py /tmp/x && python3 scripts/patches/grade.py /tmp/x && python3 scripts/patches/skids.py /tmp/x && python3 scripts/patches/grounds.py /tmp/x && python3 scripts/patches/autopilot.py /tmp/x && python3 scripts/patches/pause.py /tmp/x && python3 scripts/patches/circuits.py /tmp/x && python3 scripts/patches/contacts.py /tmp/x && python3 scripts/patches/bridge.py /tmp/x && python3 scripts/patches/lab-stops.py /tmp/x && python3 scripts/patches/tires.py /tmp/x && python3 scripts/patches/live.py /tmp/x && python3 scripts/patches/tracks.py /tmp/x && python3 scripts/patches/setup.py /tmp/x && python3 scripts/patches/net-laps.py /tmp/x && python3 scripts/patches/preview.py /tmp/x && python3 scripts/patches/keep.py /tmp/x && python3 scripts/patches/follow.py /tmp/x && python3 scripts/patches/sound.py /tmp/x` (ui.py, which only adds to index.html, before live.py).
  Gates are 6 m tall (banner foot ~5 m) and fade to 25% when the camera comes within 6–15 m of one.
  The detailed models' driver's-seat camera sits 0.3 m ahead of (and 5 cm above) the driver's eyes.
  Eight of the detailed cars, the **Jaguar XJR** (X308), the **Mercedes-AMG SL 63**, the
  **Porsche 911 Turbo** (992), the **Porsche Cayenne Turbo S** (2009), the **Ford Mustang Shelby GT500**
  (2020), the **BMW X5 M Competition**, the **Mercedes-AMG GLE 63 S Coupé** and the **Volkswagen Arteon R**
  (#328: the 2.0 turbo four, 235 kW, 7-speed DSG, 4MOTION; its own engine sound, `i4t`), are built from downloaded
  models (`models/`, not in git) by `scripts/models/build-car.mjs`: into the sim's axes and metres,
  wheels, callipers and steering wheel split out, paint and glass found by name, lighter
  (meshoptimizer, textures ≤ 512 px), gzipped (1–6 MB). Their specs are the real cars' (power, torque,
  gearbox, weight, drive); their bodies' profiles, which the collision hull is built from, are measured
  off the models. The GT500's body colour came painted in a texture (blue, white stripes): its painted
  areas are plain paint here, so the paint picker works on it, without the stripes. The X5 M's model has
  no rear window: the build adds one. The GLE 63 is based on "Mercedes-AMG GLE 63 Coupe 2022"
  (https://sketchfab.com/3d-models/mercedes-amg-gle-63-coupe-2022-ac4667c76f4e4e6c813ff3e72bc07ff8) by
  ceron_alex (https://sketchfab.com/ceron_alex), licensed CC-BY-4.0: the credit its licence asks for.
  **Shift+drag** or **right-drag** looks around: the chase camera swings round the car (drag right:
  the view turns right; down: from higher up), the cockpit view turns your head (up to ~130° each way);
  let go and it eases back behind after 0.7 s. The orbit (C) and editor cameras keep their own mouse controls.
  Opened without `?mp=1`, `/sim/index.html` is the single-player sim as it was (editor, bots, replays).
- **Physics run in each browser.** A client reports its car 20 times a second; the server relays
  the positions to the room; the others interpolate it 120 ms in the past, then carry it on to where it is now
  (#322: along its heading at its speed, turning at its rate, with its slide, over those 120 ms and the trip here,
  `MP.lag`: how long our own state takes to come back from the server, which echoes it), draw it there, push
  against it like the sim's bots (each side moves only its own car, and keeps the push it gave the other,
  `pe.kicks`, till the other's own reply to it arrives) and draw its skid marks under its wheels. Before, a car was
  drawn and touched where it had been ~0.2 s before (~5 m at 90 km/h): a car rear-ending another bounced off a car
  that wasn't there yet, 8 m short, while the one ahead never felt it, and a car swerving into another drove
  through it, the other shoved a moment later by nothing (both in a test of two sims with 70 ms between them; now
  both feel the same touch in the same frame, drawn within ~0.3–0.7 m of where the other really is).
  The 120 ms are on the other's own clock (#345: each state carries `ts`, when its sim sent it, which the server passes
  on): stamped as they came in, the states arrive bunched by the server's 50 ms ticks and the network (50, 50, 50, then
  100 ms apart for states 66 ms apart), and a car at 30 m/s was drawn at 13 to 60 m/s from one frame to the next: it
  jerked. Now the offset between the clocks follows the shortest trip seen (changing the time drawn by 2% at most), and
  the car goes along a curve through its states (Catmull-Rom, `mpSpline`) that keeps its speed from one to the next:
  29 to 31 m/s in the same test (the sim, its frames stepped on a virtual clock, fed states bunched as the pipeline
  does). From a server that doesn't pass `ts` on, the states are timed as they come and joined by straight lines, as
  before. Laps and the finish come from the
  sim's own gate timing; the server keeps the order and the clock (a finish time far from the
  server's own measure is replaced by it), adds 5 s per gate missed, and ends the race when all
  have finished or left, or 60 s after the winner.
- **A race:** lobby (host picks ground and laps; the others get ready) → countdown (5 s, on the
  grid, held) → racing → results → back to the grid. Late joiners watch and race the next one; a
  dropped connection keeps its seat for 20 s; a second tab takes over the seat.
- **Best laps:** every valid lap (all gates, in order), raced or driven around the room, goes to the
  server, which keeps each driver's fastest per map, ground and car in the database (table `records`,
  `lib/race/records.mjs`; a lap can't be longer than the server's clock says since the last one).
  The room hears its map and ground's (`records`): the panel lists them (your car / all cars), and
  the sim's timer shows your BEST with that car, the checkpoint deltas against it and, all the
  time, the best lap with each car and its driver. Right of the timer, BEST LAPS lists every driver's best
  with the car you drive on this map and ground (the top 10 and yours, with the gap to the fastest; under
  the minimap, shorter, when the window is narrow). An edited map keeps its times, marked "earlier layout"
  (and without their splits).
- **A network's laps count too** (#333): driving around the room (not in a race), a lap the autopilot drives (TNN lab →
  Drive it) is a best lap of the network's own, per car, map and ground, never the driver's: a network saved on the
  server goes by its name and its maker as the server has them (`tnn:<id>`, whoever drives it); one not saved, or
  trained further since it was loaded or saved, is "Unsaved network" by whoever drove it (`tnn:local:<user>`). The
  lists show it in cyan with its maker, its ghost can be raced, and the scoreboard counts it on the network's side.
  Driving alone, its lap is the timer's BEST as ours is, with the network's name and maker under it.
- **Ghost car** (the room panel's Ghost car: Off / Track record / Car record / My best, kept in the
  browser, `lib/client/ghost.ts`): a lap better than the driver's best brings its path (`trace`: 10
  samples a second of position, orientation and steering, from the replay tape), kept in
  its record's row (`trace`). `SimFrame` asks for the chosen record's (`ghost`) and hands it to the sim,
  which drives a see-through copy of that car along it, on the start line until our lap starts and
  then in step with it. Only laps on the map as it is now have one.
- **Damage:** the sim posts `hit {h}` / `repair`; `server.mjs` relays them (`lib/race/hub.mjs`,
  `hit`, `repair`, and `hits` with everyone's so far on joining); `lib/client/net.ts` keeps the room's
  log for a sim that loads later, and `SimFrame` hands it over.
- **Chat** (#325, `lib/race/chat.mjs`, `components/chat.tsx`): two rooms on the same socket. **Everyone** (`main`):
  every driver connected, in the lobby (its Chat panel) and in the race rooms; its last 200 messages are in the
  database (`chat_messages`), sent to each page as it connects. **This race** (`room`): the room's drivers; it
  lives in the room (the last 100), a late joiner gets it, and it goes with the room. In a race room the chat is the
  panel's Chat tab (both rooms, a count of new messages on the tab), and over the track when the panel is away: new
  messages show for 12 s above the Room button, and **Enter** in the sim opens a line to write on (to this race or
  everyone; Enter sends, Esc drives on; the keys held are let go, so the car doesn't run on). A message is one
  line of at most 500 characters (no control or text-direction characters); a driver may send 5 at once, then one
  every 2 s. The super admin (`admin` in the socket's ticket) deletes a message (the bin on it) and mutes its
  driver for 24 h (`chat_mutes`; their messages are refused, they are told until when; the same button unmutes).
- **Sign-in to socket:** `/api/ws-ticket` (behind Auth.js) signs a one-minute ticket with
  `AUTH_SECRET`; `server.mjs` checks it, and the page's origin, on the upgrade.

## The database

Everything the server keeps is in **Postgres** (ticket #318): the maps (`maps`), the best laps with their ghost paths
(`records`), the saved autopilots (`autopilots`) and the chat's main room and mutes (`chat_messages`, `chat_mutes`; #325). `DATABASE_URL` says where; the server won't start without it.
Rooms and races, and the Claude bridge's pairings, are live state in the process's memory; what the sim keeps for
itself (single-player best laps, your own circuits, paint, weather…) stays in the browser.

- **Development:** `docker compose up -d` starts Postgres 17 on `127.0.0.1:5554` (`--profile tools` adds pgAdmin on
  5555); `.env.local` has `DATABASE_URL=postgres://carsim:carsim@127.0.0.1:5554/carsim`.
- **Tables and migrations:** the tables are `lib/db/schema.mjs` (Drizzle). After changing it, `npm run db:generate`
  writes the next numbered SQL file in `migrations/` (commit it; never edit `migrations/meta` by hand). The server
  applies what is pending when it starts, under an advisory lock (`lib/db/migrate.mjs`); `npm run db:migrate` does
  it by hand.
- **Who reads what:** Next's routes and pages ask the database each time (`lib/maps/store.mjs`,
  `lib/autopilots/store.mjs`). The race server answers its rooms from memory: it reads the best laps once at start
  and writes each new best through at once (a write only ever replaces a slower time), and it keeps a list of the
  maps that the database itself keeps current (the store's `NOTIFY` on every save, `lib/maps/live.mjs`). So a best
  lap changed by hand in the database shows after a restart; a map changed by hand, within a minute.
- **The files of before:** until #318 these were files under `DATA_DIR` (default `./data`). The first start with a
  database reads them in once and notes it (`app_meta`: `files_imported`); nothing already in the database is
  overwritten, and the files are left alone (keep them as a backup, or delete them). `npm run db:import` does it by
  hand (`-- --force` to read them again).
- **Tests:** the stores' tests run against that Postgres, each file in a schema of its own (`test_…`), dropped at
  the end (`test/db.mjs`; `TEST_DATABASE_URL` to point them elsewhere).

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
2. Variables: `AUTH_SECRET` (`openssl rand -base64 32`; the server won't start without it in production: every
   page would fail with Auth.js's `MissingSecret`), `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` (and `AUTH_GUEST=1` only if
   guests should be allowed). `PORT` is Railway's. Node 24 (`engines`). The Claude bridge is on there for
   the super admin (`CLAUDE_BRIDGE=off` to turn it off).
   The maps, the best laps and the saved autopilots are in Postgres: add a **Postgres** service to the project and
   set `DATABASE_URL=${{Postgres.DATABASE_URL}}` on the app (the private one: no TLS needed). The server applies
   the migrations when it starts and won't start without the database. Coming from a deploy that kept them as
   files on a volume: leave the volume and `DATA_DIR` for the first start with the database, which reads the
   files in once (see The database, below); then both can go.
3. Generate a domain, then in Google Cloud → APIs & Services → Credentials → the OAuth client
   (Web application): authorised redirect URI `https://<domain>/api/auth/callback/google`.

A redeploy restarts the process: races in progress end, and the browsers reconnect by themselves
(the server closes their sockets with 1012 on SIGTERM).

## Files

| | |
|---|---|
| `app/page.tsx`, `app/leaderboard/`, `app/networks/`, `app/signin/`, `components/showcase.tsx` | the public pages |
| `app/tnn/`, `components/tnn-explainer.tsx` | the explainer page: what a tiny neural network is and how ours learn; its evolution demo is the training's own step (ranks, ± pairs) in two weights |
| `app/tech/`, `components/tech-cars.tsx`, `lib/tech/` | the tech specs page: the physics explained, the cars' table and cards; the sim's figures read out of engine.js |
| `lib/showcase/store.mjs`, `lib/tnn.ts`, `lib/format.ts` | the scoreboard from the database; a network's shape and links for drawing; lap times and names |
| `components/site-nav.tsx`, `components/site-footer.tsx`, `components/brand.tsx`, `components/track-outline.tsx`, `components/net-diagram.tsx` | the bar, the footer (credits), the logo, a track and a network drawn |
| `public/sim/ui.css`, `public/sim/ui.js`, `scripts/patches/ui.py` | the sim page's interface over the sim's own |
| `public/fonts/`, `public/showcase/`, `app/icon.svg`, `app/opengraph-image.tsx` | the type, the home page's pictures of the sim, the icon and the share image |
| `server.mjs` | HTTP server: Next, `/ws`, `/api/health`, heartbeat, graceful shutdown |
| `lib/race/hub.mjs` | rooms and races (transport-free, tested in `test/hub.test.mjs`) |
| `lib/race/shared.mjs` | cars, paints, grounds, limits shared by server, UI and sim |
| `lib/race/ticket.mjs` | WebSocket tickets (HMAC) |
| `lib/race/chat.mjs`, `components/chat.tsx` | the chat: the main room and the mutes in the database, the race rooms' in the hub; the lobby's and the race room's chat (tested in `test/chat.test.mjs`) |
| `lib/race/records.mjs` | the best laps and their ghosts, in the database and in the race server's memory (tested in `test/records.test.mjs`, `test/hub.test.mjs`) |
| `lib/db/`, `migrations/`, `drizzle.config.mjs`, `docker-compose.yml` | the database: the pool, the tables (`schema.mjs`), the migrations and their runner, the one-time import of the old files |
| `lib/maps/live.mjs` | the race server's list of the maps, kept current by the database's NOTIFY |
| `lib/admin.ts` | the super admin (`SUPER_ADMIN_EMAIL`) |
| `lib/maps/store.mjs` | the maps in the database, course checks (tested in `test/maps.test.mjs`) |
| `lib/autopilots/store.mjs`, `app/api/autopilots/` | the trained autopilots saved on the server (tested in `test/autopilots.test.mjs`) |
| `app/api/maps/` | the maps API |
| `app/maps/`, `components/maps-admin.tsx`, `components/map-editor.tsx` | the admin's map list and editor |
| `lib/client/maps.ts` | the maps from the browser: lists, a room's course |
| `lib/client/net.ts` | the browser's socket, subjecto Subjects |
| `components/race-room.tsx` | the race page: panel, best laps, standings, results |
| `components/sim-frame.tsx` | the sim iframe and its postMessage bridge |
| `components/race-controls.tsx` | car, paint (UI SDK colour picker), the track picker, ground and laps (UI SDK segmented controls) |
| `auth.ts` | Auth.js: Google, guest |
| `public/sim/` | the engine |
| `scripts/patches/autopilot.py` | the autopilot: a tiny network trained in the browser to drive a lap (I) |
| `scripts/patches/pause.py` | pausing the drive (P, the Pause button); tire pressure on Shift+P |
| `scripts/patches/contacts.py` | car against car (`ccSolve`: the bots, the other players' cars, the rival) |
| `scripts/patches/live.py` | the course editor builds every change while it is open; faster earthworks and distance to the course |
| `scripts/patches/tracks.py`, `app/api/tracks` | driving a map alone: the start menu's tracks |
| `scripts/patches/follow.py` | a lap to follow: the driver's best lap kept, the lab's choice of the lap the network takes as its example, the review map against it |
| `scripts/patches/sound.py` | the sound on or off (M, the rail's Sound): one switch, everywhere, remembered |
| `scripts/patches/setup.py` | the car's setup: the drive, the split and the tires' pressure, kept per car; the figures for the Car setup drawer (U, `ui.js`) |
| `public/sim/circuit-gen.js`, `scripts/patches/circuits.py`, `scripts/maps/generate.mjs` | the circuit generator (the editor's GENERATE A CIRCUIT, MY CIRCUITS; course files from node; tested in `test/circuit-gen.test.mjs`) |
| `scripts/models/` | detailed car models from downloads (`cars.mjs`: what to take from each, `build-car.mjs`) |

## Not yet

- Car-to-car contact in a race is still each side's own: both see the touch, and each pushes only its own car,
  so with a lot of lag (or a sudden swerve the other side can't predict) they may see it a little differently.
- The single-player sim (`/sim/index.html`) still has its own editor, saved in that browser only;
  its Export can be imported as a map by the super admin.
- Rooms are in memory only: one replica, and a restart clears them.
