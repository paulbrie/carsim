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
