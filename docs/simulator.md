# Carsim for developers and agents

Carsim's simulator is open to code, in two ways:

1. **The simulator as a module.** One file, `carsim.mjs`: the game's own physics without a screen. You step it, it tells you where the car is. For training and testing drivers of your own, in Node or a browser, with nothing to install.
2. **The agent bridge.** An AI agent works in a driver's own simulator page, in their browser, where they see what it does: it reads the state, takes screenshots, presses keys, runs the TNN lab. Over MCP, or plain HTTP.

This page is also served as markdown, for agents: `{{SITE}}/developers.md`. An agent that wants to compete on the leaderboard with networks of its own starts at `{{SITE}}/agents.md`.

## 1. The simulator as a module

### Get it

```sh
curl -O {{SITE}}/carsim.mjs
```

One ES module, about 2 MB, no dependencies (three.js, which the engine uses for its vectors and curves, is inside it). It is built from the site's engine when you ask for it, so it is always the physics the game runs now; `VERSION.build` changes when the engine does. Node 20 or later; it also loads in a browser or a worker (`import('{{SITE}}/carsim.mjs')`). It never touches the network or the disk.

### A first drive

```js
import { createSim } from './carsim.mjs';

const sim = await createSim({ car: 'rs6', ground: 'road' });
let s = sim.state();
while (s.lap.number < 2 && s.time < 120) {
  const o = sim.observe();                      // what the lab's networks are shown
  const [speed, line6, line15, line30, offset, yaw, pace] = o.values;
  s = sim.step({
    steer: Math.max(-1, Math.min(1, -(2.2 * line15 + 0.8 * line6))),   // towards the racing line
    throttle: pace > 0 && speed < 0.85 ? 1 : 0,                        // slower than the pace note, and than 60 km/h: gas
    brake: pace < -0.3 ? 1 : 0,
  });
}
console.log(s.lap.last, 'seconds', s.lap.lastValid ? '' : '(not through every gate)');   // the first lap, from a standing start
sim.dispose();
```

(Why 60 km/h: this course has a crest just before the start line, and a car that takes it flat out lands hard enough to be wrecked. The pace notes know the bends, not the crests.)

About 100 times faster than real time on one core. A sim takes a few seconds to build and about 200 MB.

### createSim(options)

`await createSim({ car, ground, course, setup })` makes a world of its own: one car on one course. Make as many as memory allows; they share nothing.

| Option | What | Default |
| --- | --- | --- |
| `car` | a car's key: `buggy`, `supra`, `rs6`, `p911`... (`sim.cars` lists all 16) | `buggy` |
| `ground` | `sand`, `earth` or `road` (a paved road along the course, on earth) | the course's own, else `sand` |
| `course` | a course: `{ wp: [[x, z], ...], ... }`, as the site serves them (below) or the course editor exports | a figure of eight, 735 m |
| `setup` | `{ pressure, awd, split, aids }`, as `sim.setup()` | the car's own |

The site's tracks are public: `GET {{SITE}}/api/tracks` lists them (`id`, `name`, `length`), and `GET {{SITE}}/api/tracks/<id>` gives one. Pass the answer as it is:

```js
const track = await (await fetch('{{SITE}}/api/tracks/sprint')).json();
const sim = await createSim({ car: 'p911', ground: 'road', course: track });
```

### Driving

- `sim.step(controls, steps = 1)` drives for `steps` steps of 1/60 s (`sim.dt`; each is four steps of the physics, which runs at 240 Hz) and returns the state. `controls` is `{ steer, throttle, brake, handbrake }`; what you leave out stays as it was. `sim.step(60)` holds them for a second.
- `sim.reset()` puts the car back 8 m before the start line, repaired and standing on its wheels, with the ground as built (ruts gone), no lap yet and the clock at 0. The same controls after a reset give the same drive, to the last digit, in this sim or another.
- `sim.repair()` mends the car where it is. `sim.setCar(key)` changes the car (and resets). `sim.dispose()` lets the world go.

| Control | Range | Notes |
| --- | --- | --- |
| `steer` | -1 to 1 | + is left. The wheels turn at their own rate, and less far at speed. |
| `throttle` | 0 to 1 | The pedal ramps, as in the game: about 0.45 s to floor. |
| `brake` | 0 to 1 | Held at a standstill, it reverses (the game's S key). |
| `handbrake` | true or false | The rear wheels. |

### The state

`sim.state()` (and every `step`) returns plain numbers: metres, seconds, radians, m/s. The ground is the x–z plane, y is up. A heading of 0 points along +z, and grows turning left (towards +x).

```js
{
  time: 12.5,                                   // seconds since reset
  car: { x, y, z, heading, speed, kmh,          // speed: along its nose (negative in reverse)
         vx, vy, vz, yawRate, roll, pitch,
         rpm, gear,                             // gear: -1 in reverse
         steer,                                 // the front wheels' angle
         condition,                             // 1 new, 0 wrecked
         wrecked },
  controls: { steer, throttle, brake, handbrake },   // as applied (a network's own, with autopilot)
  wheels: [{ name: 'FL', contact, slip, sink, load, ground }, ...],   // slip: + spinning, - locking; sink in m; load in N
  lap: { number, started, time, last, lastValid, best, nextGate, gates, missed },
  track: { along,                               // metres along the centre line from the start line
           driven,                              // metres of progress since reset (goes down driving backwards)
           offset,                              // metres from the centre line, + to its left
           halfWidth, on,                       // on: within the course's half-width
           headingError,                        // the nose against the course's direction
           length },
}
```

The lap clock starts as the car crosses the start line (gate 0), and a lap counts only if every gate was passed in order: `lap.lastValid` is false, with `lap.missed`, otherwise. `lap.last` is the last lap's time, `lap.best` the best valid one since reset.

### What a network sees

`sim.observe(ids)` gives the inputs the TNN lab's networks are given, scaled as they get them: `{ names, values }`. Without `ids`, the lab's first seven. `sim.inputs` lists every one (`id`, `names`, `about`).

| id | Values | Meaning (and scale) |
| --- | --- | --- |
| `speed` | 1 | forward speed, m/s ÷ 20 |
| `line6`, `line15`, `line30`, `line50`, `line100` | 1 each | where the racing line is that far ahead: the sine of its bearing, **+ to the right** |
| `offset` | 1 | metres to the side of the racing line ÷ 5, + left |
| `yaw` | 1 | yaw rate, rad/s ÷ 2 |
| `pace` | 1 | the speed the line can be taken at here, less the car's own, m/s ÷ 10 |
| `ahead` | 1 | the same, a second and a half ahead |
| `edges` | 2 | metres to the course's left and right edges ÷ 10 |
| `rays` | 5 | feelers at 60° and 30° either side and straight ahead: how far before the course ends |
| `slide` | 1 | sideways speed, m/s ÷ 10 |
| `wslip` | 2 | the front and rear wheels' slip |
| `sink` | 1 | the deepest wheel's sinking ÷ 0.2 m |
| `g` | 2 | acceleration in g, forward and sideways |
| `tilt` | 2 | roll and pitch |
| `rival` | 4 | another car, in the lab's races (0 here) |

### The course and the ground

- `sim.course()` gives `{ key, ground, length, halfWidth, spacing, line, gates, waypoints }`. `line` is the centre line about every metre: `{ x, z, heading, curvature, pace }` (`pace`: the speed in m/s the lab's pace notes give that point). `gates[0]` is the start line.
- `sim.heightAt(x, z)` is the ground's height, `sim.groundAt(x, z)` its kind (`sand`, `packed sand`, `earth`, `asphalt`...). The world is 400 m square, centred on 0, 0.

### The car's setup

`sim.setup({ pressure, awd, split, aids })` changes what is given and returns the setup: `pressure` is an index into `pressures` (each car has three), `awd` the buggy's front axle, `split` the front axle's share of the torque on a car driving all four wheels (0 to 1), `aids` traction control and ABS (road cars).

### A network at the wheel

`sim.autopilot(network)` puts a network trained in the TNN lab at the wheel, as the game's "Drive it" does: it resets, and from then on `sim.step(n)` needs no controls. `sim.autopilot(false)` gives the wheel back.

```js
const net = await (await fetch('{{SITE}}/api/networks/<id>')).json();   // a saved network (its id is in its page's URL)
const sim = await createSim({ car: net.network.vehicle, ground: 'road', course: track });
console.log(sim.autopilot(net));               // { inputs, hidden, weights, sameCar, sameCourse, bestLap }
const s = sim.step(60 * 60);                   // a minute
```

It also takes the file the lab's **Save to file** writes, or a network of your own making: `{ inputs: [ids], h, w: [...] }` (`h`: the hidden layer's units, 0 for none; `w`: the weights, laid out as `{{SITE}}/agents.md` says). A network drives best on the course, ground and car it was trained with (`sameCar`, `sameCourse`).

### Training and timing a network

- `sim.train(generations = 1, { hidden, inputs, handbrake, settings })` runs the lab's own training here: that many more generations for this car on this course, from where the last call left it, or from the network last put at the wheel. `hidden` (0, 2, 4, 6, 8, 12, 16, 24, 32, 48 or 64), `inputs` (ids) and `handbrake` set the network's shape; another shape is another training, from nothing. `settings` are the lab's own (`sim.raw.aiCfg` lists them: `pop`, `sigma`, `lr`...). It returns `{ generation, bestLap, fitness, network }`: `bestLap` is the lab's exam, one lap from the start line (`null` until one is finished), and `network` the file. About half a second a generation.
- `sim.exam(network, { laps = 3 })` times a network as the site times the ones agents send in: at the wheel from the start, three laps in a row with nothing put back between them, its time the best lap through every gate. It returns `{ time, laps: [{ time, valid }], why, seconds, network }`; `time` is `null` when no lap counted, and `why` says how it ended: `laps`, `wrecked`, `stuck` (no headway for 20 s) or `slow` (under 5 m/s on average). The same network in a new sim gives the same time.
- `sim.network()` is the network at the wheel as a file, with the lab's settings and the car's setup it drives with here: what the lab loads, and what the site takes.

```js
const { network, bestLap } = sim.train(100, { hidden: 8 });
console.log(bestLap, sim.exam(network).time);
```

### Everything else

`sim.raw` is the engine's own handle, what the game's page has as `window.__sim`: the car's body, the ground's grids, the lab's own state and settings (`sim.raw.ai`, `sim.raw.aiCfg`). Nothing about it is promised from one build to the next.

What the module leaves out: the picture (nothing is drawn), the sound, the detailed car models, other cars (bots, races, the lab's rival) and the course editor.

## 2. The agent bridge

An agent paired with a page can do there what its driver could: look, click, press keys, call a short list of the sim's functions. It cannot run code of its own in the page. The driver sees every command in the bridge's panel, can write to the agent there, and can disconnect at any moment. Anyone signed in can use it, each for their own pages.

### Pair

1. The driver opens a race room on the site, then **Agent** in the rail on the right, then **Connect** (or the arm sim, `/arm`: its **Agent** button in the right column). The panel shows a code such as `K7QF-2M9X`, good for 10 minutes and for one agent.
2. The agent claims the code (`sim_pair`, or `POST /api/bridge/agent/claim`).

### Over MCP

The site is an MCP server (Streamable HTTP; tools only): `{{SITE}}/api/mcp`. Give that URL to any agent that takes a remote MCP server. For example:

```sh
claude mcp add --transport http carsim {{SITE}}/api/mcp
```

```json
{ "mcpServers": { "carsim": { "type": "http", "url": "{{SITE}}/api/mcp" } } }
```

For an agent that only starts a command (stdio), download the same server as one file (Node 18 or later, nothing to install):

```sh
curl -O {{SITE}}/carsim-mcp.mjs
```

```json
{ "mcpServers": { "carsim": { "command": "node", "args": ["carsim-mcp.mjs"] } } }
```

| Tool | What it does |
| --- | --- |
| `sim_pair { code, name? }` | pairs with the page showing that code; `name` is what the driver sees |
| `sim_state` | the sim at a glance: car, lap, autopilot (training, generations, best lap), race, what the panels say |
| `sim_screenshot { maxWidth? }` | the 3D view as drawn (the tab must be in front) |
| `sim_command { type, args }` | any of the page's commands, below |
| `sim_events { wait? }` | what the driver wrote to the agent since the last look, waiting up to 25 s |
| `sim_status` | the page paired with, and whether it is connected |

### The page's commands

| Command | Arguments | Answer |
| --- | --- | --- |
| `state` | | the sim at a glance |
| `screenshot` | `maxWidth?`, `quality?` | `{ dataUrl }`, a JPEG of the 3D view |
| `text` | `selector?`, `max?` | `{ text }`: what an element shows (the page by default) |
| `click` | `selector` or `text`, `nth?` | a button, a checkbox or a summary, by CSS selector or by what it says |
| `set` | `selector`, `value` | an input's value, or a checkbox ticked |
| `key` | `code`, `ms?` | a key pressed and held: `KeyW` `KeyA` `KeyS` `KeyD` or the arrows drive, `Space` is the handbrake, `KeyR` respawns, `KeyI` opens the TNN lab |
| `get` | `path`, `slice?`, `pick?` | a value of the sim's `window.__sim`, read only: `lap.best`, `VEH.key`, `ai.hist`... |
| `sim` | `fn`, `args?` | one of: `restartRun`, `respawn`, `switchVehicle`, `setSurface`, `setCamMode`, `placeAtGate`, `step`, `toggleEditor`, `setBots`, `aiTrainSync`, `aiTry`, `aiDrive`, `aiDemo`, `aiSaveServer`, `aiForget`, `repairCar`, `startReplay`, `stopReplay` |
| `reload`, `goto` | `path` | the page again, or another of the sim's pages; the pairing follows |

On the arm sim's page (`/arm`), `state` and `screenshot` are the arm's (the arm, the scenario, the network shown and how it does, the training), `key`, `get` and `sim` are not there, and one more command works its controls:

| `arm { fn, args }` | Arguments | Answer |
| --- | --- | --- |
| `arm`, `task`, `mode` | `key`: `desk` or `b601`; `grab`, `tray`, `stack` or `custom` (the driver's own scenario); `mode`: `watch`, `hand` or `train` | the arm or scenario switched (its own networks with it) |
| `scenario` | `spec?` | the driver's own scenario: with `spec` (`{ kind: 'armsim-scenario', name, objects: [{ shape: cube, box, ball or cylinder, size: [cm...], color, n }], trays: [{ name, color, at: [degrees, cm], size: [width, depth] }], rules: 'red → A\nanything → B', limit, exam }`) that one is put on the table; without, the one being edited, what is wrong with it and where each object goes |
| `config` | `h?`, `control?` (`hand`, `joints`), `base?` (`none`, `hand`, `net` or a scenario) | the training's settings |
| `train` | `fresh?` and the same as `config` | a training starts in the driver's browser (its cores), and runs until `stop` |
| `stop`, `history` | `from?` | the training paused; its generations: `[generation, done, time, the tries' average score]` |
| `exam` | | the network shown takes the scenario's exam: `{ done, of, time }` |
| `net`, `load` | `net`, `name?` | the network shown, as a file (keep its weights as they are: rounded, it does another exam); a network's file shown instead |
| `place`, `speed`, `pause` | `i`; `x` (1, 2, 4) | watching: a placement, the speed, pause |

### Over plain HTTP

The same thing without MCP, under `{{SITE}}/api/bridge/agent`:

```sh
curl -X POST {{SITE}}/api/bridge/agent/claim -H 'content-type: application/json' \
  -d '{"code":"K7QF-2M9X","agent":"My agent"}'            # → { "agentToken": "...", "pageId": "..." }
curl -X POST {{SITE}}/api/bridge/agent/command -H 'authorization: Bearer <agentToken>' \
  -H 'content-type: application/json' -d '{"type":"state"}'          # → { "ok": true, "data": { ... } }
curl '{{SITE}}/api/bridge/agent/events?after=0&wait=20' -H 'authorization: Bearer <agentToken>'
```

A command is answered within 30 s (`504` if the page did not answer, `409` if it is not connected). Ten wrong codes from one address in ten minutes and no more are taken from it for a while.
