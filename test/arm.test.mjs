// The arm sim (#359): the world holds a cube by friction, every scenario can be done (by a script driving it as a
// person's keys would), the same drive gives the same numbers, a network file is what the code says it is, and a
// training runs. The physics is MuJoCo's official WebAssembly build.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import loadMujoco from '@mujoco/mujoco';
import { ARM, ARMS, TASKS, attempt, blank, createArm, exam, examPlacements, forward, layers, names, notNet, orders, placement, dice, reach, joints, sceneXml, shape } from '../lib/arm/core.mjs';
import { generation, handStart, runGoes, shareOut, startTraining, trained } from '../lib/arm/train.mjs';

const M = await loadMujoco();

// by hand, as a person's keys would: over the cube, down, shut, up, over where it goes, down, open, away; job after job
// (a slower arm is given its moves' time in proportion: k)
const go = (sim, to, shut, secs, speed = 1) => { for (let i = 0; i < secs * 60 && sim.done == null; i++) { const p = sim.pose().grip, d = [to[0] - p[0], to[1] - p[1], to[2] - p[2]], n = Math.hypot(...d) || 1, s = Math.min(speed, n * 8); sim.act({ world: d.map(v => v / n * s), shut }); if (sim.stage < (sim.peak = Math.max(sim.peak ?? 0, sim.stage))) sim.fell = true; } };
function byHand(task, at, arm = 'desk') {
  const sim = createArm(M, { at, task, arm }), k = ARM.hand / ARMS[arm].hand;
  for (let turn = 0; turn < 4 && sim.done == null; turn++) {
    const p = sim.pose(), c = p.cubes[p.now].p;
    go(sim, [c[0], c[1] + 0.12, c[2]], false, 1.5 * k); go(sim, c, false, 0.8 * k); go(sim, c, true, 0.35 * k);
    if (task === 'grab') { go(sim, [c[0], 0.25, c[2]], true, 1.5 * k); continue; }
    const g = sim.pose().goal, top = Math.max(g[1], c[1]) + 0.13;
    go(sim, [c[0], top, c[2]], true, 1 * k); go(sim, [g[0], top, g[2]], true, 2.5 * k, 0.8); go(sim, [g[0], g[1] + 0.003, g[2]], true, 1.2 * k, 0.5); go(sim, [g[0], g[1] + 0.003, g[2]], false, 0.4 * k); go(sim, [g[0], g[1] + 0.13, g[2]], false, 0.8 * k);
  }
  const out = { done: sim.done, stage: sim.stage, fell: !!sim.fell, pose: sim.pose() };
  sim.free();
  return out;
}

test('every scenario can be done, the cubes held by friction alone: pick up, into the tray, and four cubes stacked', () => {
  for (const task of ['grab', 'tray']) for (const at of examPlacements(task).slice(0, 4)) assert.ok(byHand(task, at).done != null, `${task} ${JSON.stringify(at)}`);
  const stacks = examPlacements('stack').map(at => byHand('stack', at));
  assert.equal(stacks.filter(s => s.done != null).length, 10, `the script stacks four cubes every time (${stacks.map(s => s.stage).join(' ')} of 3 placed)`);
  // and the stack never counts as knocked down while the next cube is set on it (#361: the cube below is 5 cm under the grip)
  assert.deepEqual(stacks.map(s => s.fell), stacks.map(() => false));
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
  assert.deepEqual(names(blank('stack')).inputs, ['go: out', 'go: side', 'rise', 'fingers', 'between', 'squeezing', 'in place']);
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

// ---- the reBot Arm B601-RS (#361)
test('the notes: nothing to go by until the grip is up, then the way to the cube; with it in the fingers, the way to where it goes', () => {
  const sim = createArm(M, { at: examPlacements('tray')[0], task: 'tray' });
  let n = sim.note();
  assert.ok(n.rise > 0.05 && n.free === 0, `at home the grip is below the travel height: up first (${n.rise})`);
  assert.ok(sim.observe(['go']).every(v => v === 0), 'no way to go yet');
  for (let i = 0; i < 40; i++) sim.act({ hand: [0, 1, 0] });
  n = sim.note();
  assert.ok(n.free === 1 && Math.hypot(...sim.observe(['go'])) > 0.2, 'up there, it is shown the way to the cube');
  sim.free();
  // the network written by hand follows them: the cube ends in the tray, and four cubes get stacked
  const a = attempt(M, handStart('tray'), examPlacements('tray')[4]), b = attempt(M, handStart('stack'), examPlacements('stack')[1]);
  assert.ok(a.ok && a.time < 6, `tray by the hand-written network (${a.time})`);
  assert.ok(b.ok && b.stage === 3, `stack by the hand-written network (${b.time})`);
  assert.equal(handStart('tray').w.filter(Boolean).length, 7);
  assert.throws(() => handStart('grab'), /not shown/);
});

test('the networks that come with the tray and the stack, on both arms, pass their exams as their files say', () => {
  for (const [file, least] of [['tray', 20], ['stack', 9], ['b601-tray', 20], ['b601-stack', 10]]) {
    const net = JSON.parse(readFileSync(new URL(`../lib/arm/networks/${file}.json`, import.meta.url), 'utf8'));
    assert.equal(notNet(net), null);
    const x = exam(M, net);
    assert.ok(x.done >= least, `${file}: ${x.done} of ${x.of}`);
    assert.deepEqual({ done: x.done, of: x.of, time: x.time }, net.exam);
  }
});

test('the B601: its makers’ figures, the hand straight down where the joints say, every scenario done by hand on it', () => {
  const B = ARMS.b601, xml = sceneXml(1, 'b601');
  // as published (Rebot_Arm_description/RS): the links' offsets and masses, the motors' peak torques
  for (const s of ['pos="-0.236 0 0"', 'pos="0.228 -0.072746 0.0045"', 'mass="1.9641"', 'mass="1.0273"', 'actuatorfrcrange="-36 36"', 'actuatorfrcrange="-14 14"', 'range="0 0.05"']) assert.ok(xml.includes(s), s);
  assert.equal(sceneXml(1), sceneXml(1, 'desk'), 'the desk arm as it was');
  // the planar model (reach, joints) is where MuJoCo puts the grip, to 2 mm, with the hand hanging straight down
  for (const [r, y, a] of [[0.25, 0.03, 0.4], [0.4, 0.2, -1], [0.3, 0.12, 2]]) {
    const q = joints(r, y, a, B), sim = createArm(M, { arm: 'b601', at: { cubes: [{ r: 0.3, a: -2.5, yaw: 0 }] } });
    for (let i = 0; i < 4; i++) sim.qt[i] = q[i];
    for (let i = 0; i < 240; i++) sim.act({});
    const p = sim.pose().grip, want = reach(q, B);
    assert.ok(Math.hypot(p[0] - want.x, p[1] - want.y, p[2] - want.z) < 0.002, `${r} ${y} ${a}: ${p.map(v => v.toFixed(3))} against ${[want.x, want.y, want.z].map(v => v.toFixed(3))}`);
    sim.free();
  }
  for (const task of ['grab', 'tray']) for (const at of examPlacements(task).slice(0, 4)) assert.ok(byHand(task, at, 'b601').done != null, `${task} ${JSON.stringify(at)}`);
  const stacks = examPlacements('stack').map(at => byHand('stack', at, 'b601'));
  assert.equal(stacks.filter(s => s.done != null).length, 10, `stacked on the B601 (${stacks.map(s => s.stage).join(' ')} of 3)`);
  assert.deepEqual(stacks.map(s => s.fell), stacks.map(() => false));
});

test('the B601 stops at its own limits: the wrist’s bend keeps the hand from going higher, and the table', () => {
  const sim = createArm(M, { arm: 'b601' });
  for (let i = 0; i < 400; i++) sim.act({ hand: [1, 1, 0] });                       // out and up, as far as it goes
  const L = ARMS.b601.lim, qt = sim.qt;
  assert.ok(qt[1] - qt[2] <= L.a2[1] + 1e-9 && qt[1] <= L.a1[1] && qt[2] >= L.e[0], `within its limits (${qt.map(v => v.toFixed(3))})`);
  for (let i = 0; i < 400; i++) sim.act({ hand: [0, -1, 0] });
  assert.ok(sim.pose().grip[1] > ARMS.b601.floor - 0.004, `stops above the table (${sim.pose().grip[1]})`);
  for (let i = 0; i < 300; i++) sim.act({ roll: 1 });
  assert.ok(Math.abs(sim.qt[3] - sim.qt[0]) <= L.roll + 1e-9, 'the hand turns no further than its joint');
  sim.free();
});

test('networks are for one arm: the file says which, the exam drives that one', () => {
  const n = blank('grab', { arm: 'b601' });
  assert.equal(n.arm, 'b601'); assert.equal(blank('grab').arm, undefined, 'the desk arm\'s say nothing (as before)');
  assert.equal(notNet(n), null);
  assert.match(notNet({ ...n, arm: 'ur5' }), /arm is one of desk, b601/);
  const net = JSON.parse(readFileSync(new URL('../lib/arm/networks/b601-grab.json', import.meta.url), 'utf8'));
  assert.equal(net.arm, 'b601'); assert.equal(notNet(net), null);
  const x = exam(M, net);
  assert.deepEqual({ done: x.done, of: x.of, time: x.time }, net.exam, 'the network that comes with the B601 passes its exam as its file says');
  assert.ok(x.done >= 17);
  assert.notDeepEqual(exam(M, { ...net, arm: undefined }).time, x.time, 'and on the desk arm it is another exam');
  const desk = JSON.parse(readFileSync(new URL('../lib/arm/networks/grab.json', import.meta.url), 'utf8'));
  assert.equal(exam(M, { ...desk, arm: 'b601' }).done, 13, 'the desk arm\'s network on the B601 as it is: 13 of 20 (the page says so)');
});

test('the B601 is drawn where its physics is: the drawing’s grip on core’s', async () => {
  const THREE = await import('three'), { buildB601 } = await import('../lib/arm/scene.mjs');
  const mat = () => new THREE.MeshBasicMaterial(), mesh = (geo, m, parent) => { const x = new THREE.Mesh(geo, m); parent.add(x); return x; };
  const d = buildB601(THREE, mesh, mat, mat()), scene = new THREE.Scene(); scene.add(d.root);
  const sim = createArm(M, { arm: 'b601', at: examPlacements('grab')[3] });
  for (let i = 0; i < 90; i++) sim.act({ hand: [Math.sin(i / 9), -0.5, Math.cos(i / 7)], roll: 0.5 });
  for (let i = 0; i < 60; i++) sim.act({});                                         // still: the grip's site is from the step before its joints'
  const p = sim.pose();
  d.pose(p.j, p.open); scene.updateMatrixWorld(true);
  const g = d.grip.getWorldPosition(new THREE.Vector3());
  assert.ok(Math.hypot(g.x - p.grip[0], g.y - p.grip[1], g.z - p.grip[2]) < 1e-4, `${g.toArray().map(v => v.toFixed(4))} against ${p.grip.map(v => v.toFixed(4))}`);
  sim.free();
});

// The same in every engine (#359): Math.sin and the like are each engine's own (Chrome 159 and Node 24 differ in the last
// digit, and an exam came out 0.05 s apart), so what a drive is made of uses lib/arm/math.mjs, built from + − × ÷ and sqrt.
test('the arm’s own sin, cos, tanh, atan2, acos, log and hypot: Node’s to the last digit, and the same numbers as when they were written', async () => {
  const m = await import('../lib/arm/math.mjs');
  let s = 2024; const rnd = () => { s = Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9 | 0; const t = Math.imul(s ^ (s >>> 13), 3266489909); return ((t ^ (t >>> 16)) >>> 0) / 4294967296; };
  const buf = new Float64Array(1), u = new Uint32Array(buf.buffer), scales = [1, 0.3, 1.6, 3.2, 6.3, 0.05, 40, 1e-6, 22, 700, 1e4, 3e6];
  let h = 0; const add = v => { buf[0] = v; h = Math.imul(h ^ u[0], 16777619) ^ u[1]; h = Math.imul(h, 2654435761) | 0; };
  const same = (a, b, what) => { if (!(Object.is(a, b) || (a !== a && b !== b))) assert.fail(`${what}: ${a} here, ${b} Node's`); };
  for (let i = 0; i < 200000; i++) {
    const a = (rnd() * 2 - 1) * scales[i % 12], b = (rnd() * 2 - 1) * scales[(i * 7 + 3) % 12], c = rnd() * 2 - 1;
    // the hash: what any engine must give (headless Chrome 143 and 159 gave it too, where their own Math gave two others)
    add(m.sin(a)); add(m.cos(a)); add(m.tanh(a)); add(m.acos(c)); add(m.log(Math.abs(a))); add(m.atan2(a, b)); add(m.hypot(a, b)); add(m.hypot(a, b, c)); add(m.ipow(0.999, i % 500));
    // Node's own, which the shipped networks' exams were measured with (sin and cos up to 820 000 radians: math.mjs says why)
    if (Math.abs(a) < 8e5) { same(m.sin(a), Math.sin(a), `sin(${a})`); same(m.cos(a), Math.cos(a), `cos(${a})`); }
    same(m.tanh(a), Math.tanh(a), `tanh(${a})`); same(m.acos(c), Math.acos(c), `acos(${c})`); same(m.log(Math.abs(a)), Math.log(Math.abs(a)), `log(${Math.abs(a)})`);
    same(m.atan2(a, b), Math.atan2(a, b), `atan2(${a}, ${b})`); same(m.hypot(a, b), Math.hypot(a, b), `hypot(${a}, ${b})`); same(m.hypot(a, b, c), Math.hypot(a, b, c), `hypot(${a}, ${b}, ${c})`);
  }
  assert.equal(h >>> 0, 798014060);
  // the edges
  const edge = [0, -0, 1, -1, 0.5, -0.5, Infinity, -Infinity, NaN, Math.PI, Math.PI / 2, Math.PI / 4, 3 * Math.PI / 4, 1e-310, 2 ** -27, 2 ** -28, 2 ** -29, 2 ** -54, 22, 0.4375, 0.6875, 1.1875, 2.4375, 2 ** 66, 0.3, 0.78125];
  for (let k = 1; k <= 40; k++) edge.push(k * Math.PI / 2, k * (Math.PI / 2) * (1 + 1e-15), k * (Math.PI / 2) * (1 - 1e-15));
  for (const p of edge) for (const x of [p, -p]) {
    for (const f of ['sin', 'cos', 'tanh', 'acos', 'log']) if (f.length > 3 || !(Math.abs(x) > 8e5 && Math.abs(x) < Infinity)) same(m[f](x), Math[f](x), `${f}(${x})`);
    for (const q of edge) { same(m.atan2(x, q), Math.atan2(x, q), `atan2(${x}, ${q})`); same(m.atan2(x, -q), Math.atan2(x, -q), `atan2(${x}, ${-q})`); same(m.hypot(x, q), Math.hypot(x, q), `hypot(${x}, ${q})`); same(m.hypot(x, q, 1), Math.hypot(x, q, 1), `hypot(${x}, ${q}, 1)`); }
  }
  // beyond 820 000 radians: still a sine, of nearly that angle (and the same one everywhere)
  assert.ok(Math.abs(m.sin(1e7) - Math.sin(1e7)) < 1e-8 && Math.abs(m.cos(-3e9) - Math.cos(-3e9)) < 1e-6);
});

test('what a drive and a training are made of asks the engine for nothing it may answer in its own way', () => {
  // Math's that every engine must give alike (exact, or correctly rounded): anything else goes through lib/arm/math.mjs
  const exact = new Set(['abs', 'min', 'max', 'round', 'floor', 'ceil', 'trunc', 'sign', 'sqrt', 'imul', 'fround', 'PI']);
  for (const file of ['core.mjs', 'train.mjs', 'math.mjs', 'worker.mjs']) {
    const src = readFileSync(new URL(`../lib/arm/${file}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
    const used = [...new Set([...src.matchAll(/\bMath\.(\w+)/g)].map(x => x[1]))].filter(n => !exact.has(n));
    assert.deepEqual(used, [], `lib/arm/${file} uses Math.${used.join(', Math.')}`);
    assert.ok(!/\*\*/.test(src), `lib/arm/${file} uses ** (the engine's pow)`);
  }
});
