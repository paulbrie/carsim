// The public pages' scoreboard (ticket #320): humans' best laps against saved networks', from the database.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Showcase, courseKey, courseLength } from '../lib/showcase/store.mjs';
import { MapStore, DEFAULT_WP } from '../lib/maps/store.mjs';
import { RecordStore } from '../lib/race/records.mjs';
import { AutopilotStore } from '../lib/autopilots/store.mjs';
import { testDb } from './db.mjs';

const T = await testDb();
beforeEach(() => T.reset());
after(() => T.drop());

const course = (n = 5, extra = {}) => ({ wp: Array.from({ length: n }, (_, i) => [Math.cos(i) * 80, Math.sin(i) * 80]), bank: 8, level: 100, ops: [{ t: 'raise', x: 1, z: 2, r: 8, s: 0.05 }], base: 'earth', road: true, bridges: [{ x: 3, z: 4 }], noBridge: [], ...extra });
const training = (o = {}) => ({ kind: 'carsim-autopilot', version: 2, vehicle: 'rs6', vehicleName: 'Audi RS 6', course: 'x', ground: 'Road', h: 0, inputs: ['speed', 'line6'], handbrake: false, keyPedals: false, keySteering: false,
  w: [1, 2, 3, 4, 5, 6], best: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6], gen: 12, bestFit: 100, bestLap: 30.5, hist: [[1, 2, 3]], adam: null, ...o });

test('a course\'s key is the sim\'s own (courseKey in engine.js)', () => {
  // the sim's function, from its source, run on the same courses
  const src = fs.readFileSync(new URL('../public/sim/engine.js', import.meta.url), 'utf8');
  const fn = src.match(/const courseKey = \(\) => (\{ let h = 2166136261;[^\n]*\});\n/);
  assert.ok(fn, 'courseKey has moved in engine.js: bring lib/showcase/store.mjs in step');
  const sim = COURSE => Function('COURSE', fn[1])(COURSE);
  const cases = [{ wp: DEFAULT_WP }, course(), course(7, { bank: 0, level: 0 }), course(9, { grade: 6, even: [[0, 3]] }), course(4, { bridges: [], noBridge: [{ x: 1, z: 2 }] }), course(4, { bridges: [], noBridge: [] })];
  for (const c of cases) assert.equal(courseKey(c), sim(c));
  assert.equal(courseKey(null), sim({ wp: DEFAULT_WP }));               // a map with no course: the sim's figure-8
  assert.notEqual(courseKey(course(5)), courseKey(course(6)));
  assert.equal(Math.round(courseLength([[0, 0], [30, 0], [30, 40]])), 120);
});

test('the scoreboard: car by car, the best human lap and the best network lap on the track as it is now', async () => {
  let t = 1_000_000;
  const maps = new MapStore(T.db, { now: () => t }), recs = await new RecordStore(T.db, { now: () => t }).load(), pilots = new AutopilotStore(T.db, { now: () => t });
  const lake = await maps.create({ name: 'Lake', course: course(6) });
  const key = courseKey((await maps.get(lake.id)).course);
  const lap = (vehicle, id, time, mv = lake.updatedAt, ground = 'road') => recs.submit({ map: lake.id, mv, ground, vehicle, user: { id, name: id === 'a' ? 'Ann Lee' : 'Bob Ray' }, time });
  lap('rs6', 'a', 31); lap('rs6', 'b', 30); lap('x7', 'a', 34); lap('supra', 'a', 29, lake.updatedAt - 1);   // (the Supra's: on an earlier layout)
  lap('x7', 'b', 40, lake.updatedAt, 'sand');
  await recs.flush();
  const save = (name, o, owner = 'a') => pilots.create({ name, training: training({ course: key, ...o }), owner, ownerName: 'Ann Lee' });
  const fast = await save('RS 6 quick', { bestLap: 29.5 }); t += 1000;
  await save('RS 6 slow', { bestLap: 33 }); t += 1000;
  const x7 = await save('X7', { vehicle: 'x7', bestLap: 36, h: 8, inputs: ['speed'], handbrake: true, w: Array(43).fill(0.5), best: null }); t += 1000;
  await save('GLE, nobody drove it', { vehicle: 'gle63', bestLap: 35 }); t += 1000;
  await save('No lap yet', { vehicle: 'rs6', bestLap: null }); t += 1000;
  await save('Elsewhere', { course: 'zzzz', bestLap: 20 }); t += 1000;
  await save('On earth', { ground: 'Earth', bestLap: 41 });

  const s = new Showcase(T.db, { now: () => t, ttlMs: 0 }), b = await s.board();
  assert.deepEqual(b.tracks.map(x => [x.id, x.key, x.wp.length, x.bridges]), [['lake', key, 6, 1], ['figure-8', courseKey(null), 16, 0]].sort((p, q) => b.tracks.findIndex(x => x.id === p[0]) - b.tracks.findIndex(x => x.id === q[0])));
  assert.deepEqual(b.boards.map(x => `${x.track}/${x.ground}`), ['lake/road', 'lake/earth', 'lake/sand']);
  const road = b.boards[0];
  assert.deepEqual(road.rows.map(r => [r.vehicle, r.human?.time ?? null, r.human?.name ?? null, r.tnn?.time ?? null, r.tnn?.weights ?? null]),
    [['rs6', 30, 'Bob Ray', 29.5, 6], ['x7', 34, 'Ann Lee', 36, 43], ['gle63', null, null, 35, 6]]);
  assert.deepEqual([road.human.time, road.human.vehicle, road.tnn.time, road.tnn.id], [30, 'rs6', 29.5, fast.id]);
  assert.deepEqual(road.duels.map(d => [d.vehicle, +d.gap.toFixed(3)]), [['rs6', -0.5], ['x7', 2]]);              // the closest first
  assert.deepEqual([b.boards[1].human, b.boards[1].tnn.time, b.boards[2].human.time, b.boards[2].tnn], [null, 41, 40, null]);
  // the networks: newest first, each with its track (none for a course that is no map's), drawn from its best weights
  assert.deepEqual(b.networks.map(n => [n.name, n.track, n.ground]).slice(0, 3), [['On earth', 'lake', 'earth'], ['Elsewhere', null, 'road'], ['No lap yet', 'lake', 'road']]);
  const q = b.networks.find(n => n.id === fast.id), big = b.networks.find(n => n.id === x7.id);
  assert.deepEqual(q.w, [0.1, 0.2, 0.3, 0.4, 0.5, 0.6]); assert.equal(q.weights, 6); assert.equal(q.savedAt, 1_000_000);
  assert.equal(big.w.length, 43); assert.deepEqual([big.h, big.handbrake, big.inputs], [8, true, ['speed']]);       // (no best kept: the weights it has)
  assert.equal((await s.networks({ weights: false }))[0].w, null);

  // the map saved again: the laps and networks of the layout before are off its board
  t += 1000; await maps.update(lake.id, { course: course(7) });
  const b2 = await s.board();
  assert.deepEqual(b2.boards, []); assert.ok(b2.networks.every(n => n.track === null));
});

test('the scoreboard is kept for a few seconds, and a map with no course is the sim\'s figure-8', async () => {
  let t = 5000;
  const s = new Showcase(T.db, { now: () => t, ttlMs: 10_000 });
  const a = await s.board();
  assert.deepEqual(a.tracks.map(x => [x.id, x.name, x.v, x.wp]), [['figure-8', 'Figure-8', 0, DEFAULT_WP]]);
  await new MapStore(T.db, { now: () => t }).create({ name: 'New', course: course() });
  t += 9000; assert.equal(await s.board(), a);
  t += 2000; assert.deepEqual((await s.board()).tracks.map(x => x.id).sort(), ['figure-8', 'new']);
  // the maps' list carries each map's waypoints, to draw it
  const list = await new MapStore(T.db).list();
  assert.deepEqual(list.map(m => [m.id, m.wp.length]), [['figure-8', 16], ['new', 5]]);
  assert.deepEqual(list[0].wp, DEFAULT_WP);
});

test('a network\'s laps in the race rooms are network laps on the scoreboard, named and credited (#333)', async () => {
  let t = 1_000_000;
  const maps = new MapStore(T.db, { now: () => t }), recs = await new RecordStore(T.db, { now: () => t }).load(), pilots = new AutopilotStore(T.db, { now: () => t });
  const lake = await maps.create({ name: 'Lake', course: course(6) });
  const key = courseKey((await maps.get(lake.id)).course);
  const saved = await pilots.create({ name: 'Swift', training: training({ course: key, bestLap: 33 }), owner: 'c', ownerName: 'Cleo Park' });
  const lap = (vehicle, id, name, time, net = null) => recs.submit({ map: lake.id, mv: lake.updatedAt, ground: 'road', vehicle, user: { id, name }, time, net });
  lap('rs6', 'a', 'Ann Lee', 31);
  lap('rs6', `tnn:${saved.id}`, 'Swift', 30.5, { autopilot: saved.id, name: 'Swift', creator: 'Cleo Park', weights: 6, h: 0 });   // quicker than its exam
  lap('x7', 'tnn:local:a', 'Unsaved network', 40, { autopilot: null, name: 'Unsaved network', creator: 'Ann Lee', weights: 16, h: 4 });
  await recs.flush();
  // read back as the server reads them
  const again = await new RecordStore(T.db).load();
  assert.deepEqual(again.list(lake.id, 'road').map(e => [e.id, e.net?.creator ?? null]), [[`tnn:${saved.id}`, 'Cleo Park'], ['a', null], ['tnn:local:a', 'Ann Lee']]);
  const b = await new Showcase(T.db, { now: () => t, ttlMs: 0 }).board(), road = b.boards[0];
  assert.deepEqual(road.rows.map(r => [r.vehicle, r.human?.name ?? null, r.tnn && [r.tnn.name, r.tnn.ownerName, r.tnn.time, r.tnn.saved, r.tnn.room]]),
    [['rs6', 'Ann Lee', ['Swift', 'Cleo Park', 30.5, true, true]], ['x7', null, ['Unsaved network', 'Ann Lee', 40, false, true]]]);
  assert.equal(road.tnn.id, saved.id);                                                         // the saved network's own id
});
