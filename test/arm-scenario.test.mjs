// The arm sim's scenarios of one's own (#365): shapes, sizes and colours on the table, trays where one wants them, and
// rules that say which goes where. The rules read as a person writes them, a scenario that can't be run says why, its
// placements are the same for everyone, each shape can be picked up and put in its tray by hand (friction alone), and
// the built-in scenarios are not touched (their exams are test/arm.test.mjs's).
import test from 'node:test';
import assert from 'node:assert/strict';
import loadMujoco from '@mujoco/mujoco';
import { TASKS, blank, createArm, examPlacements, exam, netKey, notNet, placement, dice, taskOf, sceneXml } from '../lib/arm/core.mjs';
import { CUBE_ITEM, EXAMPLES, checkScenario, cleanScenario, compileScenario, parseRules, scenarioKey } from '../lib/arm/scenario.mjs';

const M = await loadMujoco();
const S = (o = {}) => ({ kind: 'armsim-scenario', name: 't', objects: [{ shape: 'cube', size: [5], color: 'red', n: 1 }], trays: [{ name: 'A', color: 'green', at: [100, 30], size: [14, 14] }], rules: 'anything → A', limit: 10, exam: 5, ...o });
const where = (spec) => checkScenario(spec).objects.map(o => o.to);

test('rules: one a line, the first that fits decides; shapes, colours, sizes, not, or, stays', () => {
  const objects = [{ shape: 'cube', size: [5], color: 'red', n: 1 }, { shape: 'ball', size: [4], color: 'blue', n: 1 }, { shape: 'box', size: [8, 3, 4], color: 'red', n: 1 }, { shape: 'cylinder', size: [3, 6], color: 'green', n: 1 }];
  const trays = [{ name: 'A', color: 'green', at: [100, 30], size: [20, 20] }, { name: 'Big ones', color: 'blue', at: [-100, 30], size: [20, 20] }];
  const go = rules => where(S({ objects, trays, rules, limit: 60 }));
  assert.deepEqual(go('red → A\nball -> Big ones\nanything else: stays'), ['A', 'Big ones', 'A', null]);
  assert.deepEqual(go('red box to big ones\nred or green => A'), ['A', null, 'Big ones', 'A']);
  assert.deepEqual(go('not red → A'), [null, 'A', null, 'A']);
  assert.deepEqual(go('wider than 3.5 cm → A\ntaller than 55 mm → Big ones'), ['A', 'A', null, 'Big ones']);    // a box's width is its narrower side
  assert.deepEqual(go('big → A\nsmall → Big ones'), ['Big ones', 'Big ones', 'A', null]);   // against the others, by their largest side: below the middle of the smallest (4) and the largest (8) small, above it big, 6 neither
  assert.deepEqual(go('# a note\n\nheavier than 90 g → A'), ['A', null, null, null]);
  // what it can't read, line by line
  const bad = checkScenario(S({ objects, trays, rules: 'red → C\nshiny → A\nred\n→ A' })).errors.map(e => e.line);
  assert.deepEqual(bad, [1, 2, 3, 4]);
  assert.match(parseRules('red → C', trays).errors[0].msg, /no tray called "C" \(there are: A, Big ones/);
  assert.match(parseRules('shiny → A', trays).errors[0].msg, /"shiny": not a shape/);
});

test('a scenario that can not be run says why; one that can, what each object does', () => {
  const msg = o => checkScenario(S(o)).errors.map(e => e.msg).join(' | ');
  assert.match(msg({ objects: [] }), /at least one object/);
  assert.match(msg({ trays: [], rules: '' }), /at least one tray/);
  assert.match(msg({ rules: '' }), /Write a rule/);
  assert.match(msg({ rules: 'blue → A' }), /No rule sends any object/);
  assert.match(msg({ objects: [{ shape: 'ball', size: [8], color: 'red', n: 1 }] }), /too wide for the fingers/);
  assert.equal(msg({ objects: [{ shape: 'box', size: [9, 4, 4], color: 'red', n: 1 }] }), '');           // gripped across its narrower side
  assert.match(msg({ trays: [{ name: 'A', color: 'green', at: [100, 30], size: [14, 14] }, { name: 'B', color: 'blue', at: [110, 30], size: [14, 14] }] }), /A and B overlap/);
  assert.match(msg({ objects: [{ shape: 'cube', size: [5], color: 'red', n: 3 }] }), /Tray A is too small for its 3 objects/);
  assert.match(msg({ objects: [{ shape: 'cube', size: [5], color: 'red', n: 8 }], trays: [{ name: 'A', color: 'green', at: [0, 30], size: [30, 30] }] }), /not room enough|too small/);
  assert.match(checkScenario(S({ objects: [{ shape: 'cube', size: [6], color: 'red', n: 1 }] })).warnings[0].msg, /reBot Arm's fingers/);
  for (const x of EXAMPLES) assert.deepEqual(checkScenario(x).errors, [], x.name);
  // out of range or missing: put right (a file is always one the sim can read)
  const c = cleanScenario({ objects: [{ shape: 'blob', size: [99], color: 'orange', n: 40 }], trays: [{ at: [999, 1] }], limit: 1e9 });
  assert.deepEqual(c.objects, [{ shape: 'cube', size: [10], color: 'white', n: 8 }]);
  assert.deepEqual(c.trays, [{ name: 'A', color: 'green', at: [150, 18], size: [14, 14] }]);
  assert.equal(c.limit, 120);
  assert.deepEqual(cleanScenario(c), c);
});

test('compiled: its jobs in the listed order, each to a place of its own in its tray; its placements the same for everyone', () => {
  const sc = EXAMPLES[0], T = compileScenario(sc);
  assert.equal(taskOf(sc), T); assert.equal(taskOf(T), T); assert.equal(taskOf('tray'), TASKS.tray);
  assert.deepEqual(T.jobs.map(j => [j.cube, j.to]), [[0, 0], [1, 0], [2, 1], [3, 1]]);
  for (const j of T.jobs) {
    const t = T.trays[j.to], dx = j.slot[0] - t.x, dy = j.slot[1] - t.y, u = dx * t.c + dy * t.s, v = -dx * t.s + dy * t.c;
    assert.ok(Math.abs(u) < t.hx - T.items[j.cube].foot && Math.abs(v) < t.hy - T.items[j.cube].foot, 'its place is in its tray');
  }
  assert.notDeepEqual(T.jobs[0].slot, T.jobs[1].slot);
  assert.equal(scenarioKey({ ...sc, name: 'another name' }), scenarioKey(sc));          // the name is not the scenario
  assert.notEqual(scenarioKey({ ...sc, limit: sc.limit + 1 }), scenarioKey(sc));
  const a = examPlacements(sc), b = examPlacements(structuredClone(sc));
  assert.deepEqual(a, b); assert.equal(a.length, sc.exam);
  for (const p of [...a, ...Array.from({ length: 30 }, (_, i) => placement(dice(i), sc))]) {
    assert.equal(p.cubes.length, 4);
    const xy = p.cubes.map(c => [c.r * Math.cos(c.a), c.r * Math.sin(c.a)]);
    for (let i = 0; i < 4; i++) {
      for (const t of T.trays) { const dx = xy[i][0] - t.x, dy = xy[i][1] - t.y; assert.ok(Math.abs(dx * t.c + dy * t.s) > t.hx || Math.abs(-dx * t.s + dy * t.c) > t.hy, 'not in a tray'); }
      for (let j = 0; j < i; j++) assert.ok(Math.hypot(xy[i][0] - xy[j][0], xy[i][1] - xy[j][1]) >= 0.11, 'apart');
    }
  }
  // the built-in scenarios' cube is what core's constants were
  assert.deepEqual([CUBE_ITEM.hz, CUBE_ITEM.wide, CUBE_ITEM.inn, CUBE_ITEM.touchGap], [0.025, 0.05, 0.03, 0.022]);
  assert.match(sceneXml(1, 'desk'), /<geom name="cube0" type="box" size="0.025 0.025 0.025" class="pad" mass="0.1" conaffinity="3"\/>/);
  assert.match(sceneXml(4, 'desk', T.items), /type="box" size="0.0250 0.0250 0.0250"/);
});

// by hand, as a person's keys would: over the object, down, shut, up, over its place in its tray, down, open, up; object after object.
// Carried at 60 cm/s: a cylinder swung round the base at 80 (the desk arm's tray script) slips out once in five (its side
// touches the pads along a line, not a face)
const go = (sim, to, shut, secs, speed = 1) => { for (let i = 0; i < secs * 60 && sim.done == null; i++) { const p = sim.pose().grip, d = [to[0] - p[0], to[1] - p[1], to[2] - p[2]], n = Math.hypot(...d) || 1, s = Math.min(speed, n * 8); sim.act({ world: d.map(v => v / n * s), shut }); } };
function byHand(sc, at, arm = 'desk') {
  const sim = createArm(M, { at, task: sc, arm }), k = arm === 'desk' ? 1 : 0.5 / 0.3;
  for (let turn = 0; turn < 8 && sim.done == null && !sim.lost; turn++) {
    const p = sim.pose(), c = p.cubes[p.now].p, g = p.goal;
    go(sim, [c[0], 0.2, c[2]], false, 1.5 * k); go(sim, c, false, 0.8 * k); go(sim, c, true, 0.35 * k);
    go(sim, [c[0], 0.24, c[2]], true, 1 * k); go(sim, [g[0], 0.24, g[2]], true, 3 * k, 0.6); go(sim, [g[0], g[1] + 0.003, g[2]], true, 1.4 * k, 0.5); go(sim, [g[0], g[1] + 0.003, g[2]], false, 0.4 * k); go(sim, [g[0], 0.2, g[2]], false, 0.8 * k);
  }
  const out = { done: sim.done, stage: sim.stage, of: sim.pose().of, lost: sim.lost, pose: sim.pose() };
  sim.free();
  return out;
}

test('each shape can be sorted by hand into its tray, held by friction alone, on both arms', () => {
  const mixed = S({ objects: [{ shape: 'ball', size: [5], color: 'yellow', n: 1 }, { shape: 'box', size: [8, 4, 4], color: 'purple', n: 1 }, { shape: 'cylinder', size: [4, 6], color: 'blue', n: 1 }, { shape: 'cube', size: [3], color: 'red', n: 1 }],
    trays: [{ name: 'A', color: 'green', at: [100, 30], size: [20, 14] }, { name: 'B', color: 'grey', at: [-100, 30], size: [26, 14] }], rules: 'ball or cube → A\nanything → B', limit: 60, exam: 4 });
  for (const arm of ['desk', 'b601']) {
    const runs = examPlacements(mixed).map(at => byHand(mixed, at, arm));
    assert.equal(runs.filter(r => r.done != null).length, runs.length, `${arm}: ${runs.map(r => `${r.stage} of ${r.of}${r.lost ? ' (lost one)' : ''}`).join(', ')}`);
    const last = runs[0].pose, T = compileScenario(mixed);
    last.cubes.forEach((c, i) => {                                           // each in the tray its rule says, standing on the table
      const t = T.trays[T.jobs.find(j => j.cube === i).to], x = c.p[0], y = -c.p[2], dx = x - t.x, dy = y - t.y;
      assert.ok(Math.abs(dx * t.c + dy * t.s) < t.hx && Math.abs(-dx * t.s + dy * t.c) < t.hy, `${arm}: object ${i} in tray ${t.name}`);
      assert.ok(Math.abs(c.p[1] - T.items[i].hz) < 0.01, `${arm}: object ${i} at rest on the table`);
    });
  }
  // an object no rule sends anywhere is left alone: the scenario is done without it
  const one = S({ objects: [{ shape: 'cube', size: [5], color: 'red', n: 1 }, { shape: 'cube', size: [5], color: 'blue', n: 1 }], rules: 'red → A' });
  const r = byHand(one, examPlacements(one)[0]);
  assert.ok(r.done != null && r.of === 1, `${r.stage} of ${r.of}`);
});

test('a network for one\'s own scenario carries it: checked, examined on it, the same numbers twice, listed under its key', () => {
  const sc = EXAMPLES[2], net = { ...blank(sc, { h: 0 }), w: blank(sc, { h: 0 }).w.map((_, i) => ((i * 7919) % 13) / 13 - 0.5) };
  assert.equal(net.task, 'custom'); assert.deepEqual(net.scenario, cleanScenario(sc)); assert.equal(notNet(net), null);
  assert.match(notNet({ ...net, scenario: { ...sc, rules: 'pink → Nope' } }), /its scenario: Rule 1/);
  assert.equal(netKey(net), `custom:${scenarioKey(sc)}`); assert.equal(netKey(blank('tray')), 'tray');
  const a = exam(M, net), b = exam(M, structuredClone(net));
  assert.deepEqual(a, b); assert.equal(a.task, 'custom'); assert.equal(a.of, sc.exam);
});

test('the sorting networks that come with the sim (one\'s own scenario\'s start) pass their exams as their files say', async () => {
  const { readFileSync } = await import('node:fs');
  for (const [file, least] of [['sort', 8], ['b601-sort', 8]]) {
    const net = JSON.parse(readFileSync(new URL(`../lib/arm/networks/${file}.json`, import.meta.url), 'utf8'));
    assert.equal(notNet(net), null); assert.equal(net.task, 'custom'); assert.deepEqual(net.scenario, cleanScenario(EXAMPLES[0]));
    const x = exam(M, net);
    assert.ok(x.done >= least, `${file}: ${x.done} of ${x.of}`);
    assert.deepEqual({ done: x.done, of: x.of, time: x.time }, net.exam);
  }
});
