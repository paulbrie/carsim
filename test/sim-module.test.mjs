// The simulator as a module to download (ticket #355): carsim.mjs is built from the engine as it is, loads in plain
// Node with nothing around it, and does what docs/simulator.md says. Every part of its API is used here: it reads the
// engine's functions by name (lib/sim-module/api.template.js), so an engine change that breaks it fails here.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { simModule } from '../lib/sim-module/serve.mjs';

const root = new URL('..', import.meta.url).pathname;
let dir, M, sim;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carsim-module-'));
  const m = simModule(root), file = path.join(dir, 'carsim.mjs');
  assert.match(m.build, /^[0-9a-f]{12}$/);
  assert.equal(simModule(root), m, 'built once for the same files');
  assert.doesNotMatch(m.source, /^\s*import\s.*\sfrom\s/m, 'one file: it imports nothing');
  fs.writeFileSync(file, m.source);
  M = await import(pathToFileURL(file).href);
  sim = await M.createSim({ car: 'rs6', ground: 'road' });
});
after(() => { sim?.dispose(); fs.rmSync(dir, { recursive: true, force: true }); });

// the docs' own driver: towards the racing line, by the pace note
const pilot = s => { const [, line6, line15, , , , pace] = s.observe().values; return { steer: Math.max(-1, Math.min(1, -(2.2 * line15 + 0.8 * line6))), throttle: pace > 0 ? 1 : 0, brake: pace < -0.3 ? 1 : 0 }; };
const sig = s => [s.car.x, s.car.z, s.car.heading, s.car.speed, s.track.driven].map(v => v.toFixed(9)).join(' ');

test('carsim.mjs: a sim starts in Node, on nothing of the page\'s, and says what it is', () => {
  for (const k of ['window', 'document', 'localStorage', '__sim', '__aiWorker', 'requestAnimationFrame']) assert.equal(k in globalThis && k !== 'localStorage' ? typeof globalThis[k] : 'undefined', 'undefined', `${k} was put on the real globals`);
  assert.match(M.VERSION.build, /^[0-9a-f]{12}$/); assert.deepEqual(M.GROUNDS, ['sand', 'earth', 'road']);
  assert.equal(sim.car, 'rs6'); assert.equal(sim.ground, 'road'); assert.equal(sim.dt, 1 / 60);
  assert.ok(sim.cars.length >= 16 && sim.cars.every(c => c.key && c.name && c.about));
  assert.ok(sim.inputs.find(i => i.id === 'rays').names.length === 5);
  const s = sim.state();
  assert.equal(s.time, 0); assert.equal(s.lap.number, 0); assert.equal(s.lap.started, false);
  assert.ok(Math.abs(s.car.speed) < 0.2, 'standing'); assert.ok(s.wheels.every(w => w.contact && w.ground === 'asphalt'), 'on its wheels, on the road');
  assert.ok(s.track.on && Math.abs(s.track.headingError) < 0.3 && s.car.condition === 1);
  assert.ok(Math.abs(s.track.along - (s.track.length - 8)) < 2, '8 m before the start line');
  const c = sim.course();
  assert.equal(c.ground, 'road'); assert.equal(c.halfWidth, 6); assert.ok(c.length > 700 && c.length < 770 && c.gates.length >= 4 && c.line.length === Math.round(c.length));
  // the state's offset is to the left of the centre line, as the course's own points give it
  const p = c.line.reduce((a, q) => (q.x - s.car.x) ** 2 + (q.z - s.car.z) ** 2 < (a.x - s.car.x) ** 2 + (a.z - s.car.z) ** 2 ? q : a);
  assert.ok(Math.abs((s.car.x - p.x) * Math.cos(p.heading) - (s.car.z - p.z) * Math.sin(p.heading) - s.track.offset) < 0.05);
  assert.ok(Math.abs(sim.heightAt(s.car.x, s.car.z) - s.car.y) < 2); assert.equal(sim.groundAt(s.car.x, s.car.z), 'asphalt');
});

test('carsim.mjs: the controls do what the documentation says; the same drive twice is the same', () => {
  let s = sim.reset();
  const h0 = s.car.heading;
  s = sim.step({ throttle: 0.6, steer: 1 }, 120);                        // + is left: the heading grows, and the car is left of the line
  assert.ok(s.car.speed > 3 && wrap(s.car.heading - h0) > 0.2 && s.track.offset > 0.5 && s.car.steer > 0, JSON.stringify(s.car));
  assert.equal(s.controls.steer, 1); assert.equal(s.controls.throttle, 0.6);
  // progress is counted through a long step too (many steps with no look in between)
  sim.reset(); const far = sim.step({ throttle: 1, steer: 0 }, 240);
  assert.ok(far.track.driven > 25 && Math.abs(far.track.driven - (far.track.along + 8 > far.track.length ? far.track.along + 8 - far.track.length : far.track.along + 8)) < 3, `driven ${far.track.driven} m, ${far.track.along} m along`);
  sim.reset(); sim.step({ throttle: 0.6, steer: 1 }, 120);
  const o = sim.observe();
  assert.deepEqual(o.names, ['speed', 'line 6 m', 'line 15 m', 'line 30 m', 'offset', 'yaw rate', 'pace note']);
  assert.ok(Math.abs(o.values[0] - s.car.speed / 20) < 1e-3 && o.values[4] > 0, 'speed ÷ 20; offset + left');
  assert.ok(o.values[2] > 0, 'the line is to the right of a car that turned left: its bearing is +');
  assert.equal(sim.observe(['speed', 'rays', 'edges']).values.length, 8);
  assert.throws(() => sim.observe(['nope']), /no input/);
  // the brake held at a standstill reverses
  sim.reset(); s = sim.step({ brake: 1 }, 180);
  assert.ok(s.car.speed < -0.5 && s.car.gear === -1, `reversing: ${s.car.speed} in ${s.car.gear}`);
  // the same controls after a reset: the same drive, to the last digit
  const drive = n => { let r; for (let i = 0; i < n; i++) r = sim.step(pilot(sim)); return r; };
  sim.reset(); const a = sig(drive(600)); sim.reset(); const b = sig(drive(600));
  assert.equal(a, b);
  assert.ok(Math.abs(sim.time - 10) < 1e-6);
});
const wrap = a => a - Math.round(a / (2 * Math.PI)) * 2 * Math.PI;

test('carsim.mjs: the documentation\'s first drive laps the course', async () => {
  const md = fs.readFileSync(new URL('../docs/simulator.md', import.meta.url), 'utf8');
  const code = md.split('### A first drive')[1].match(/```js\n([\s\S]*?)```/)[1];
  assert.match(code, /import \{ createSim \} from '\.\/carsim\.mjs';/);
  const said = [];
  await new (Object.getPrototypeOf(async () => { }).constructor)('createSim', 'console', code.replace(/^import .*$/m, ''))(M.createSim, { log: (...a) => said.push(a) });
  assert.ok(said[0][0] > 25 && said[0][0] < 70, `a first lap of ${said[0][0]} s`);
  assert.equal(said[0][1], 'seconds');
});

test('carsim.mjs: another car, its setup, a course of the site\'s, a network at the wheel', async () => {
  assert.equal(sim.setCar('supra').car.wrecked, false); assert.equal(sim.car, 'supra');
  assert.throws(() => sim.setCar('nope'), /no car/);
  const up = sim.setup({ pressure: 2, aids: false });
  assert.equal(up.pressure, 2); assert.equal(up.aids, false); assert.equal(up.pressures.length, 3); assert.ok(up.mass > 1000 && up.power > 100);
  assert.throws(() => sim.setup({ awd: true }), /built one way/);
  await assert.rejects(M.createSim({ car: 'nope' }), /no car/);
  await assert.rejects(M.createSim({ ground: 'ice' }), /ground is one of/);
  await assert.rejects(M.createSim({ course: { wp: [[0, 0]] } }), /at least 3 waypoints/);
  // a course as /api/tracks/<id> answers, on sand, with the buggy; then a network trained there (a generation) drives it
  const wp = Array.from({ length: 12 }, (_, i) => [+(90 * Math.cos(i / 12 * 2 * Math.PI)).toFixed(1), +(60 * Math.sin(i / 12 * 2 * Math.PI)).toFixed(1)]);
  const b = await M.createSim({ course: { track: { id: 'oval', course: { wp, base: 'sand' } } } });
  try {
    assert.equal(b.ground, 'sand'); assert.equal(b.car, 'buggy');
    const c = b.course(); assert.ok(c.length > 420 && c.length < 520, `an oval of ${c.length} m`); assert.deepEqual(c.waypoints[3], wp[3]);
    assert.ok(b.state().wheels.every(w => w.contact && /sand/.test(w.ground)));
    assert.equal(sim.course().length > 700, true, 'the first sim keeps its own course');
    b.raw.aiTrainSync(1);
    const net = JSON.parse(JSON.stringify(b.raw.aiExport()));
    assert.equal(net.kind, 'carsim-autopilot');
    const info = b.autopilot({ network: { ...net, kind: undefined } });  // (as /api/networks/<id> answers: no kind)
    assert.deepEqual([info.sameCar, info.sameCourse, info.weights, info.inputs.length], [true, true, net.w.length, 7]);
    const s = b.step(240);
    assert.equal(s.time, 4); assert.ok(Number.isFinite(s.controls.steer) && Math.abs(s.controls.steer) <= 1 && s.controls.throttle >= 0);
    assert.throws(() => b.observe(['speed']), /a network is driving/);
    assert.equal(b.observe().values.length, 7);
    assert.throws(() => b.autopilot({ kind: 'carsim-autopilot', h: 0, w: [1, 2] }), /not a carsim network/);
    assert.equal(b.autopilot(false), null);
    assert.equal(b.step({ throttle: 1 }, 60).controls.throttle, 1);
    assert.equal(typeof b.raw.aiTrainSync, 'function');
  } finally { b.dispose(); }
  assert.throws(() => b.state(), /disposed/);
});

test('carsim.mjs: training, a network of one\'s own making, its exam and its file', async () => {
  const a = await M.createSim({ car: 'rs6', ground: 'road' });
  try {
    // a network made by hand (towards the line, no faster than 50 km/h or so): this car's and this course's unless it says otherwise
    const net = { inputs: ['speed', 'line6', 'line15', 'line30', 'offset', 'yaw', 'pace'], h: 0, w: [0, -0.8, -2.2, 0, 0, 0, 0, -40, 0, 0, 0, 0, 0, 4, 0, 28] };
    const info = a.autopilot(net);
    assert.deepEqual([info.sameCar, info.sameCourse, info.weights, info.hidden], [true, true, 16, 0]);
    const e = a.exam(net);
    assert.equal(e.why, 'laps'); assert.equal(e.laps.length, 3); assert.ok(e.laps.every(l => l.valid));
    assert.equal(e.time, Math.min(...e.laps.map(l => l.time))); assert.ok(e.time > 35 && e.time < 60 && e.seconds > 3 * e.time);
    assert.deepEqual(a.exam(net).laps, e.laps, 'again, in the same sim: the same laps');
    assert.equal(a.exam(net, { laps: 1 }).laps.length, 1);
    // its file: what the lab would save, with the settings and the setup it drove with; examined from the file, the same
    const file = a.network();
    assert.deepEqual([file.kind, file.vehicle, file.course, file.ground, file.h, file.past.length], ['carsim-autopilot', 'rs6', a.course().key, 'Road', 0, 0]);
    assert.equal(file.config.setup.vehicle, 'rs6'); assert.equal(typeof file.config.cfg.pop, 'number');
    assert.deepEqual(a.exam(file).laps, e.laps);
    assert.deepEqual(a.exam({ ...net, w: net.w.map(() => 0) }), { time: null, laps: [], why: 'stuck', seconds: 20.5, network: { ...info, bestLap: null } });
    // one that isn't a network: what is wrong with it
    assert.throws(() => a.autopilot({ ...net, inputs: ['speed', 'nope'] }), /no input "nope" \(speed, line6/); assert.throws(() => a.autopilot({ ...net, h: 3 }), /h, the hidden layer's units, is one of 0, 2, 4/);
    assert.throws(() => a.autopilot({ ...net, w: [1, 2] }), /w is 16 numbers for these inputs and this size \(it has 2\)/); assert.throws(() => a.autopilot([net]), /an object: \{ inputs, h, w \}/);
    a.autopilot(false); assert.throws(() => a.network(), /no network is driving/); assert.throws(() => a.exam(null), /not a carsim network|a network to examine/);
    // the lab's training: generations counted on, the network's shape as asked, and the car back at the start after it
    const r = a.train(2, { hidden: 4, inputs: ['speed', 'line15', 'offset', 'pace'] });
    assert.equal(r.generation, 2); assert.deepEqual([r.network.h, r.network.inputs.length, r.network.w.length], [4, 4, 4 * 4 + 4 + 4 * 2 + 2]);
    assert.ok(r.bestLap === null || r.bestLap > 20); assert.equal(a.state().time, 0); assert.equal(a.state().lap.number, 0);
    assert.equal(a.train(1).generation, 3, 'carries on');
    a.autopilot(net); assert.equal(a.train(1).network.h, 0, 'from the network last at the wheel');
    assert.throws(() => a.train(1, { hidden: 5 }), /hidden is one of/); assert.throws(() => a.train(1, { inputs: ['nope'] }), /no input "nope"/);
    assert.throws(() => a.train(1, { settings: { nope: 1 } }), /no setting "nope"/);
  } finally { a.dispose(); }
});
