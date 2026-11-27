// The arm sim (#359): the world holds a cube by friction, every scenario can be done (by a script driving it as a
// person's keys would), the same drive gives the same numbers, a network file is what the code says it is, and a
// training runs. The physics is MuJoCo's official WebAssembly build.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import loadMujoco from '@mujoco/mujoco';
import { ARM, TASKS, attempt, blank, createArm, exam, examPlacements, forward, layers, names, notNet, orders, placement, dice, reach, shape } from '../lib/arm/core.mjs';
import { generation, runGoes, shareOut, startTraining, trained } from '../lib/arm/train.mjs';

const M = await loadMujoco();

// by hand, as a person's keys would: over the cube, down, shut, up, over where it goes, down, open, away; job after job
const go = (sim, to, shut, secs, speed = 1) => { for (let i = 0; i < secs * 60 && sim.done == null; i++) { const p = sim.pose().grip, d = [to[0] - p[0], to[1] - p[1], to[2] - p[2]], n = Math.hypot(...d) || 1, s = Math.min(speed, n * 8); sim.act({ world: d.map(v => v / n * s), shut }); } };
function byHand(task, at) {
  const sim = createArm(M, { at, task });
  for (let turn = 0; turn < 4 && sim.done == null; turn++) {
    const p = sim.pose(), c = p.cubes[p.now].p;
    go(sim, [c[0], c[1] + 0.12, c[2]], false, 1.5); go(sim, c, false, 0.8); go(sim, c, true, 0.35);
    if (task === 'grab') { go(sim, [c[0], 0.25, c[2]], true, 1.5); continue; }
    const g = sim.pose().goal, top = Math.max(g[1], c[1]) + 0.13;
    go(sim, [c[0], top, c[2]], true, 1); go(sim, [g[0], top, g[2]], true, 2.5, 0.8); go(sim, [g[0], g[1] + 0.003, g[2]], true, 1.2, 0.5); go(sim, [g[0], g[1] + 0.003, g[2]], false, 0.4); go(sim, [g[0], g[1] + 0.13, g[2]], false, 0.8);
  }
  const out = { done: sim.done, stage: sim.stage, pose: sim.pose() };
  sim.free();
  return out;
}

test('every scenario can be done, the cubes held by friction alone: pick up, into the tray, and four cubes stacked', () => {
  for (const task of ['grab', 'tray']) for (const at of examPlacements(task).slice(0, 4)) assert.ok(byHand(task, at).done != null, `${task} ${JSON.stringify(at)}`);
  const stacks = examPlacements('stack').slice(0, 4).map(at => byHand('stack', at));
  assert.equal(stacks.filter(s => s.done != null).length, 4, `the script stacks four cubes every time (${stacks.map(s => s.stage).join(' ')} of 3 placed)`);
  const tower = stacks.find(s => s.done != null).pose.cubes;
  tower.forEach((c, i) => assert.ok(Math.abs(c.p[1] - (0.025 + 0.05 * i)) < 0.004 && Math.hypot(c.p[0] - tower[0].p[0], c.p[2] - tower[0].p[2]) < 0.04, `cube ${i} is on the stack`));
});

test('the same drive twice gives the same numbers to the last digit, in a world used again too', () => {
  const at = examPlacements('stack')[1];
  assert.deepEqual(byHand('stack', at), byHand('stack', at));
  assert.deepEqual(byHand('tray', examPlacements('tray')[2]), byHand('tray', examPlacements('tray')[2]));
});

test('the hand goes where it is sent, and the arm stops at the table and at its limits', () => {
  const sim = createArm(M, {}), p0 = sim.pose().grip;
  for (let i = 0; i < 30; i++) sim.act({ hand: [1, 0, 0] });                       // outwards
  let p = sim.pose().grip;
  assert.ok(p[0] - p0[0] > 0.12 && Math.abs(p[1] - p0[1]) < 0.02 && Math.abs(p[2]) < 1e-3, `straight out, level to 2 cm (${p.map(v => v.toFixed(3))})`);
  for (let i = 0; i < 240; i++) sim.act({ hand: [0, -1, 0] });                     // down, into the table
  p = sim.pose().grip;
  assert.ok(p[1] > ARM.floor - 0.004 && p[1] < ARM.floor + 0.01, `stops on the table (${p[1]})`);
  for (let i = 0; i < 600; i++) sim.act({ joints: [1, 1, -1] });                   // every motor to its end
  assert.ok(sim.qt[0] <= ARM.lim.q0[1] && sim.qt[1] <= ARM.lim.a1[1] && sim.qt[2] >= ARM.lim.e[0] && reach(sim.qt).y >= ARM.floor);
  const q = sim.q; assert.ok(Math.abs(q[0] - sim.qt[0]) < 0.05 && Math.abs(q[1] - sim.qt[1]) < 0.05 && Math.abs(q[2] - sim.qt[2]) < 0.05, 'the arm is where it was ordered');
  sim.free();
});

test('placements: as many cubes as the scenario has, apart from each other, the same for everyone', () => {
  const rnd = dice(4);
  for (let i = 0; i < 50; i++) { const c = placement(rnd, 'stack').cubes; assert.equal(c.length, 4); for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) assert.ok(Math.hypot(c[a].r * Math.cos(c[a].a) - c[b].r * Math.cos(c[b].a), c[a].r * Math.sin(c[a].a) - c[b].r * Math.sin(c[b].a)) >= 0.13); }
  assert.deepEqual(examPlacements('stack'), examPlacements('stack'));
  assert.equal(examPlacements('stack').length, TASKS.stack.exam); assert.equal(examPlacements('grab').length, 20);
  assert.notDeepEqual(examPlacements('grab'), examPlacements('tray'));
});

test('a later start has the first cubes already stacked, and a half-way start the fingers round the cube', () => {
  const at = examPlacements('stack')[0], sim = createArm(M, { at: { ...at, stacked: 2 }, task: 'stack' });
  assert.equal(sim.stage, 2); assert.equal(sim.pose().now, 3);
  for (let i = 0; i < 60; i++) sim.act({});
  assert.equal(sim.stage, 2, 'and they stay stacked');
  sim.free();
  const s2 = createArm(M, { at: { cubes: [{ r: 0.3, a: 0.5, yaw: 0 }], start: 'cube' } });
  for (let i = 0; i < 20; i++) s2.act({ shut: true });
  for (let i = 0; i < 50; i++) s2.act({ hand: [0, 1, 0], shut: true });
  assert.ok(s2.jobs[0].lift > 0.14, `lifted (${s2.jobs[0].lift})`);
  s2.free();
});

test('a network: its size, its layout, and why something is not one', () => {
  const net = blank('grab', { h: 2 }), sh = shape(net);
  assert.deepEqual(net.inputs, TASKS.grab.inputs);
  assert.deepEqual(names(blank('stack')).inputs.slice(-4), ['goal: out', 'goal: up', 'goal: side', 'in place']);
  assert.equal(sh.nin, 7); assert.equal(sh.nout, 4); assert.equal(net.w.length, 7 * 2 + 2 + 2 * 4 + 4);
  // W1 (a row of inputs per unit), b1, W2 (a row of outputs per unit), b2
  net.w = net.w.map((_, i) => (i % 7 - 3) / 10);
  const x = [0.5, -1, 0.25, 1, 0, 1, 0], u = [0, 1].map(j => Math.tanh(x.reduce((s, v, i) => s + net.w[j * 7 + i] * v, 0) + net.w[14 + j]));
  const want = [0, 1, 2, 3].map(o => Math.tanh(u[0] * net.w[16 + o] + u[1] * net.w[20 + o] + net.w[24 + o]));
  assert.deepEqual(forward(net, x), want);
  assert.deepEqual(layers(net, x), { h: u, y: want });                             // the drawing's values are the network's own
  assert.deepEqual(names(net), { inputs: ['cube: out', 'cube: up', 'cube: side', 'fingers', 'height', 'between', 'squeezing'], outputs: ['out', 'up', 'side', 'grip'] });
  assert.deepEqual(layers({ ...net, h: 0, w: blank('grab', { h: 0 }).w }, x), { h: [], y: [0, 0, 0, 0] });
  assert.deepEqual(orders({ ...net, control: 'hand' }, [0.1, 0.2, 0.3, 0.4]), { hand: [0.1, 0.2, 0.3], shut: true });
  assert.deepEqual(orders({ ...net, control: 'joints', roll: true }, [0.1, 0.2, 0.3, 0.4, -1]), { joints: [0.1, 0.2, 0.3], roll: 0.4, shut: false });
  assert.equal(notNet(net), null);
  assert.match(notNet({ ...net, inputs: ['cube', 'camera'] }), /no input "camera"/);
  assert.match(notNet({ ...net, h: 3 }), /hidden layer/);
  assert.match(notNet({ ...net, w: [1, 2] }), /w is 28 numbers/);
  assert.match(notNet({ ...net, control: 'mind' }), /control/);
});

test('a network that does nothing passes none of the exam', () => {
  const x = exam(M, blank('grab'));
  assert.equal(x.done, 0); assert.equal(x.of, 20); assert.equal(x.time, 20 * TASKS.grab.limit); assert.equal(x.mean, null);
});

test('a training: generations run, the same seed gives the same training, and the exam waits for a first grab', async () => {
  const evaluate = async (head, goes) => runGoes(M, head, goes), tr = startTraining({ task: 'grab', h: 4, seed: 3 });
  let x;
  for (let i = 0; i < 3; i++) x = await generation(tr, evaluate);
  assert.equal(tr.gen, 3); assert.equal(tr.hist.length, 3);
  assert.ok(tr.net.w.some(w => w !== 0), 'the weights moved');
  // nothing grabbed in three generations: no exam was taken, and nothing passes for the best
  assert.equal(tr.grabbed, false); assert.equal(x.skipped, true); assert.equal(x.done, 0); assert.equal(tr.best, null);
  assert.equal(notNet(trained(tr, 'three generations')), null);
  const tr2 = startTraining({ task: 'grab', h: 4, seed: 3 });
  for (let i = 0; i < 3; i++) await generation(tr2, shareOut(3, async (i, head, goes) => runGoes(M, head, goes), 5));   // shared out in fives: the same
  assert.deepEqual(tr2.net.w, tr.net.w);
});

test('a training carried on from a network that grabs is examined at once, and its file passes that exam again', async () => {
  const net = JSON.parse(readFileSync(new URL('../lib/arm/networks/grab.json', import.meta.url), 'utf8'));
  const tr = startTraining({ from: net, seed: 5 }), x = await generation(tr, async (head, goes) => runGoes(M, head, goes));
  assert.ok(!x.skipped && tr.best && tr.best.exam.done > 0, `examined, and still grabbing after a generation's step (${x.done} of 20)`);
  const file = trained(tr, 'carried on'), again = exam(M, file);
  assert.deepEqual([again.done, again.time], [tr.best.exam.done, tr.best.exam.time]);
});

test('goes shared out a few at a time come back in their order, whoever finishes first', async () => {
  const seen = [], evaluate = shareOut(3, (i, head, goes) => new Promise(yes => setTimeout(() => { seen.push(i); yes(goes.map(g => ({ ok: true, time: g.at, fit: g.at }))); }, i === 0 ? 30 : 1)), 2);
  const res = await evaluate({}, Array.from({ length: 11 }, (_, k) => ({ w: [], at: k })));
  assert.deepEqual(res.map(r => r.time), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.ok(seen.filter(i => i !== 0).length >= 4, 'the quick drivers took more than the slow one');
  assert.deepEqual(await evaluate({}, []), []);
});

test('the network that comes with the sim grabs the cube 20 times out of 20, as its file says', () => {
  const net = JSON.parse(readFileSync(new URL('../lib/arm/networks/grab.json', import.meta.url), 'utf8'));
  assert.equal(notNet(net), null);
  const x = exam(M, net);
  assert.equal(x.done, 20);
  assert.deepEqual({ done: x.done, of: x.of, time: x.time }, net.exam);
  const one = attempt(M, net, examPlacements('grab')[0]);
  assert.ok(one.ok && one.time < 3);
});
