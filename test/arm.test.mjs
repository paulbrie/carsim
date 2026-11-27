// The arm sim (#359): the world holds a cube by friction, the same drive gives the same numbers, a network file is
// what the code says it is, and a training runs. The physics is Rapier's deterministic build.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ARM, TASKS, TRAY, attempt, blank, createArm, exam, examPlacements, forward, notNet, orders, reach, shape } from '../lib/arm/core.mjs';
import { generation, runGoes, startTraining, trained } from '../lib/arm/train.mjs';

const { default: RAPIER } = await import('@dimforge/rapier3d-deterministic-compat');
await RAPIER.init();

// by hand, as a person's keys would: over the cube, down, shut, up, over the tray, down, open, away
function byHand(at) {
  const sim = createArm(RAPIER, { at, task: 'tray' }), tray = { x: TRAY.r * Math.cos(TRAY.a), z: -TRAY.r * Math.sin(TRAY.a) };
  const go = (to, shut, secs) => { for (let i = 0; i < secs * 60; i++) { const p = reach(sim.q), d = [to[0] - p.x, to[1] - p.y, to[2] - p.z], n = Math.hypot(...d) || 1, s = Math.min(1, n * 20); sim.act({ world: d.map(v => v / n * s), shut }); } };
  const c = [at.r * Math.cos(at.a), 0.025, -at.r * Math.sin(at.a)];
  go([c[0], 0.15, c[2]], false, 1.2); go([c[0], 0.025, c[2]], false, 0.6); go([c[0], 0.025, c[2]], true, 0.3); go([c[0], 0.2, c[2]], true, 0.6);
  const lift = sim.lift;
  go([tray.x, 0.2, tray.z], true, 2); go([tray.x, 0.03, tray.z], true, 0.6); go([tray.x, 0.03, tray.z], false, 0.3); go([tray.x, 0.2, tray.z], false, 0.6);
  const out = { lift, done: sim.done, cube: sim.pose().cube.p, tray };
  sim.free();
  return out;
}

test('a cube is picked up, carried and put in the tray, held by friction alone: near, far, turned', () => {
  for (const at of [{ r: 0.3, a: 0, yaw: 0 }, { r: 0.42, a: -1, yaw: 0 }, { r: 0.2, a: 1, yaw: 0.5 }, { r: 0.35, a: 0.6, yaw: 0.78 }]) {
    const r = byHand(at);
    assert.equal(r.lift, 0.15, `lifted (${JSON.stringify(at)})`);
    assert.ok(r.done != null && r.done < 7, `in the tray (${JSON.stringify(at)})`);
    assert.ok(Math.hypot(r.cube[0] - r.tray.x, r.cube[2] - r.tray.z) < 0.01, 'where it was aimed, to a centimetre');
  }
});

test('the same drive twice gives the same numbers to the last digit', () => {
  const at = { r: 0.33, a: 0.4, yaw: 0.2 };
  assert.deepEqual(byHand(at), byHand(at));
});

test('the hand goes where it is sent, and the arm stops at the table and at its limits', () => {
  const sim = createArm(RAPIER, {}), p0 = reach(sim.q);
  for (let i = 0; i < 30; i++) sim.act({ hand: [1, 0, 0] });                       // outwards
  let p = reach(sim.q);
  assert.ok(p.r - p0.r > 0.15 && Math.abs(p.y - p0.y) < 0.02 && Math.abs(sim.q[0]) < 1e-9, 'straight out, level to 2 cm (the motors lag)');
  for (let i = 0; i < 240; i++) sim.act({ hand: [0, -1, 0] });                     // down, into the table
  p = reach(sim.q);
  assert.ok(p.y >= ARM.floor && p.y < ARM.floor + 0.01, `stops on the table (${p.y})`);
  for (let i = 0; i < 600; i++) sim.act({ joints: [1, 1, -1] });                   // every motor to its end
  assert.ok(sim.q[0] <= ARM.lim.q0[1] && sim.q[1] <= ARM.lim.a1[1] && sim.q[2] >= ARM.lim.e[0] && reach(sim.q).y >= ARM.floor);
  sim.free();
});

test('a half-way start has the open fingers round the cube: shut and up lifts it', () => {
  for (const at of [{ r: 0.2, a: 1, yaw: 0, start: 'cube' }, { r: 0.42, a: -1, yaw: 0, start: 'cube' }, { r: 0.3, a: 0, yaw: 0.7, start: 'cube' }]) {
    const sim = createArm(RAPIER, { at });
    assert.ok(sim.near < 1e-6, 'the grip is on the cube');
    for (let i = 0; i < 20; i++) sim.act({ shut: true });
    for (let i = 0; i < 40; i++) sim.act({ hand: [0, 1, 0], shut: true });
    assert.equal(sim.lift, 0.15);
    sim.free();
  }
});

test('a network: its size, its layout, and why something is not one', () => {
  const net = blank('grab', { h: 2 }), sh = shape(net);
  assert.deepEqual(net.inputs, TASKS.grab.inputs);
  assert.equal(sh.nin, 7); assert.equal(sh.nout, 4); assert.equal(net.w.length, 7 * 2 + 2 + 2 * 4 + 4);
  // W1 (a row of inputs per unit), b1, W2 (a row of outputs per unit), b2
  net.w = net.w.map((_, i) => (i % 7 - 3) / 10);
  const x = [0.5, -1, 0.25, 1, 0, 1, 0], u = [0, 1].map(j => Math.tanh(x.reduce((s, v, i) => s + net.w[j * 7 + i] * v, 0) + net.w[14 + j]));
  const want = [0, 1, 2, 3].map(o => Math.tanh(u[0] * net.w[16 + o] + u[1] * net.w[20 + o] + net.w[24 + o]));
  assert.deepEqual(forward(net, x), want);
  assert.deepEqual(orders({ ...net, control: 'hand' }, [0.1, 0.2, 0.3, 0.4]), { hand: [0.1, 0.2, 0.3], shut: true });
  assert.deepEqual(orders({ ...net, control: 'joints', roll: true }, [0.1, 0.2, 0.3, 0.4, -1]), { joints: [0.1, 0.2, 0.3], roll: 0.4, shut: false });
  assert.equal(notNet(net), null);
  assert.match(notNet({ ...net, inputs: ['cube', 'camera'] }), /no input "camera"/);
  assert.match(notNet({ ...net, h: 3 }), /hidden layer/);
  assert.match(notNet({ ...net, w: [1, 2] }), /w is 28 numbers/);
  assert.match(notNet({ ...net, control: 'mind' }), /control/);
});

test('the exam is the same 20 placements for everyone, and a network that does nothing passes none', () => {
  assert.deepEqual(examPlacements('grab'), examPlacements('grab'));
  assert.notDeepEqual(examPlacements('grab'), examPlacements('tray'));
  const x = exam(RAPIER, blank('grab'));
  assert.equal(x.done, 0); assert.equal(x.of, 20); assert.equal(x.time, 20 * TASKS.grab.limit); assert.equal(x.mean, null);
});

test('a training: generations run, the best is kept with its exam, and its file passes that exam again', async () => {
  const evaluate = async (head, goes) => runGoes(RAPIER, head, goes), tr = startTraining({ task: 'grab', h: 4, seed: 3 });
  for (let i = 0; i < 3; i++) await generation(tr, evaluate);
  assert.equal(tr.gen, 3); assert.equal(tr.hist.length, 3);
  assert.ok(tr.net.w.some(w => w !== 0), 'the weights moved');
  const file = trained(tr, 'three generations'), again = exam(RAPIER, file);
  assert.equal(notNet(file), null);
  assert.deepEqual([again.done, again.time], [tr.best.exam.done, tr.best.exam.time]);
  // the same seed, the same training
  const tr2 = startTraining({ task: 'grab', h: 4, seed: 3 });
  for (let i = 0; i < 3; i++) await generation(tr2, evaluate);
  assert.deepEqual(tr2.net.w, tr.net.w);
});

test('the network that comes with the sim grabs the cube 20 times out of 20, as its file says', () => {
  const net = JSON.parse(readFileSync(new URL('../lib/arm/networks/grab.json', import.meta.url), 'utf8'));
  assert.equal(notNet(net), null);
  const x = exam(RAPIER, net);
  assert.equal(x.done, 20);
  assert.deepEqual({ done: x.done, of: x.of, time: x.time }, net.exam);
  const one = attempt(RAPIER, net, examPlacements('grab')[0]);
  assert.ok(one.ok && one.time < 3);
});
