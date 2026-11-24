import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MapStore, MapError, cleanCourse, DEFAULT_MAP_ID } from '../lib/maps/store.mjs';
import { MapIndex } from '../lib/maps/live.mjs';
import { testDb } from './db.mjs';
import { RaceHub } from '../lib/race/hub.mjs';
import { LIMITS } from '../lib/race/shared.mjs';

const T = await testDb();
beforeEach(() => T.reset());
after(() => T.drop());
const course = (n = 5) => ({ wp: Array.from({ length: n }, (_, i) => [Math.cos(i) * 80, Math.sin(i) * 80]), bank: 12, ops: [{ t: 'raise', x: 1, z: 2, r: 8, s: 0.05 }], base: 'earth', road: false, bridges: [{ x: 3, z: 4 }], noBridge: [] });

test('the figure-8 is there from the start, built in, and can be edited but not deleted', async () => {
  let t = 1000;
  const s = new MapStore(T.db, { now: () => t });
  assert.deepEqual((await s.list()).map(m => [m.id, m.builtin, m.waypoints]), [[DEFAULT_MAP_ID, true, 16]]);
  assert.equal((await s.get(DEFAULT_MAP_ID)).course, null);
  assert.deepEqual(await s.info(DEFAULT_MAP_ID), { id: DEFAULT_MAP_ID, name: 'Figure-8', v: 0 });
  assert.deepEqual(await s.infos(), []);                                // no row until it is edited
  t = 2000;
  await s.update(DEFAULT_MAP_ID, { course: course() });
  assert.equal((await s.get(DEFAULT_MAP_ID)).course.wp.length, 5);
  assert.equal((await s.info(DEFAULT_MAP_ID)).v, 2000);
  assert.deepEqual((await s.list()).map(m => [m.id, m.builtin, m.waypoints, m.strokes, m.bank, m.bridges, m.createdAt, m.updatedAt]), [[DEFAULT_MAP_ID, true, 5, 1, 12, 1, 0, 2000]]);
  await s.update(DEFAULT_MAP_ID, { course: null });                     // back to the sim's own, still a version on
  assert.deepEqual([(await s.get(DEFAULT_MAP_ID)).course, (await s.info(DEFAULT_MAP_ID)).v, (await s.list())[0].waypoints], [null, 2001, 16]);
  await assert.rejects(s.delete(DEFAULT_MAP_ID), MapError);
});

test('create from a copy or a course, rename, save, delete', async () => {
  let t = 1000;
  const s = new MapStore(T.db, { now: () => t });
  const a = await s.create({ name: '  Canyon   run ', by: 'x@y' });
  assert.equal(a.id, 'canyon-run'); assert.equal(a.name, 'Canyon run'); assert.equal(a.course, null);   // a copy of the figure-8
  const b = await s.create({ name: 'Canyon run', course: course(7) });
  assert.match(b.id, /^canyon-run-[0-9a-f]{6}$/);                                                         // a free id
  const c = await s.create({ name: 'Copy', from: b.id });
  assert.deepEqual(c.course, (await s.get(b.id)).course);
  assert.deepEqual((await s.get(b.id)).course, cleanCourse(course(7)));                                    // as it went in
  assert.deepEqual([(await s.get(a.id)).updatedBy, (await s.get(a.id)).createdAt, (await s.get(b.id)).updatedBy], ['x@y', 1000, null]);
  assert.match((await s.create({ name: 'Figure 8' })).id, /^figure-8-[0-9a-f]{6}$/);                      // never the built-in's id
  await assert.rejects(s.create({ name: 'X', from: 'nope' }), e => e.status === 404);
  await assert.rejects(s.create({ name: '   ' }), e => e.status === 400);
  t = 1000;                                                                                                 // same clock: v still moves
  const u = await s.update(a.id, { name: 'Canyon', course: course(4) });
  assert.equal(u.name, 'Canyon'); assert.equal(u.course.wp.length, 4); assert.equal(u.updatedAt, 1001);
  assert.equal((await s.get(a.id)).updatedAt, 1001); assert.equal((await s.get(a.id)).createdAt, 1000);
  assert.deepEqual((await s.list()).map(m => m.name), ['Figure-8', 'Canyon', 'Canyon run', 'Copy', 'Figure 8']);
  await assert.rejects(s.update('nope', { name: 'X' }), e => e.status === 404);
  await s.delete(c.id);
  assert.equal(await s.get(c.id), null);
  await assert.rejects(s.delete(c.id), e => e.status === 404);
  assert.equal(await s.get('../etc/passwd'), null);                                                              // ids are slugs, nothing else
});

test('a course is checked and trimmed like the sim reads it', () => {
  const c = cleanCourse({ ...course(), wp: [[1000, -1000], [1.234, 2], [3, 4]], bank: 99, level: 140, base: 'mud', ops: [{ t: 'nuke', x: 0, z: 0, r: 5 }, { t: 'smooth', x: 1, z: 1, r: 6, s: 0.1, v: 2, extra: 'x' }], bridges: [{ x: 'a' }, { x: 1, z: 2 }] });
  assert.deepEqual(c.wp, [[168, -168], [1.2, 2], [3, 4]]);
  assert.equal(c.bank, 25); assert.equal(c.level, 100); assert.equal(c.base, 'sand');
  assert.equal(cleanCourse(course()).level, 0);                        // courses from before levelling
  // even-grade sections: pairs of distinct waypoints of this course, at most 40
  assert.deepEqual(cleanCourse({ ...course(), even: [[0, 2], [1, 1], [0, 9], [2, 'x'], [1.5, 2], 'no', [2, 0, 1], [2, 1]] }).even, [[0, 2], [2, 1]]);
  assert.deepEqual(cleanCourse(course()).even, []);
  assert.equal(cleanCourse({ ...course(), even: Array.from({ length: 60 }, () => [0, 1]) }).even.length, 40);
  // max. grade: 0 (none) or 3-15 %
  assert.deepEqual([undefined, 0, -4, 'x', 1, 6, 6.4, 40].map(grade => cleanCourse({ ...course(), grade }).grade), [0, 0, 0, 0, 3, 6, 6, 15]);
  assert.deepEqual(c.ops, [{ t: 'smooth', x: 1, z: 1, r: 6, s: 0.1, v: 2 }]);
  assert.deepEqual(c.bridges, [{ x: 1, z: 2 }]);
  assert.throws(() => cleanCourse({ wp: [[0, 0], [1, 1]] }), e => e.status === 400);
  assert.throws(() => cleanCourse({ wp: [[0, 0], [1, 1], ['a', 1]] }), e => e.status === 400);
  assert.throws(() => cleanCourse([]), e => e.status === 400);
});

test('a room races a map: picked by the host, refreshed when a race starts, back to the figure-8 if deleted', async () => {
  let t = 1_000_000;
  const store = new MapStore(T.db, { now: () => t });
  const dunes = await store.create({ name: 'Dunes', course: course() });
  // the race server's list of the maps: read again after each change (here by hand; live, on the store's NOTIFY)
  const maps = new MapIndex(store); await maps.load();
  const hub = new RaceHub({ now: () => t, random: () => 0.5, maps });
  const connect = id => { const inbox = []; const h = hub.connect({ id, name: id }, m => inbox.push(m)); return { ...h, last: k => inbox.filter(m => m.t === k).at(-1) }; };
  const a = connect('a'), b = connect('b');
  a.message({ t: 'create', map: 'nope' });
  let room = a.last('room').room;
  assert.equal(room.map.id, DEFAULT_MAP_ID);                     // an unknown map: the figure-8
  hub.tick(); assert.equal(b.last('rooms').rooms[0].map, 'Figure-8');
  b.message({ t: 'join', room: room.id });
  b.message({ t: 'settings', map: dunes.id });                    // not the host
  assert.equal(a.last('room').room.map.id, DEFAULT_MAP_ID);
  a.message({ t: 'settings', map: 'gone' });
  assert.equal(a.last('error').code, 'no-map');
  a.message({ t: 'settings', map: dunes.id });
  room = a.last('room').room;
  assert.deepEqual(room.map, { id: dunes.id, name: 'Dunes', v: dunes.updatedAt });
  // saved again while the room waits: the race starts on the new version
  t += 5000; await store.update(dunes.id, { course: course(6) }); await maps.load();
  a.message({ t: 'start', force: true });
  assert.equal(a.last('room').room.map.v, t);
  // deleted: the next race is on the figure-8
  await store.delete(dunes.id); await maps.load();
  t += LIMITS.countdownMs; hub.tick();
  assert.equal(a.last('room').room.phase, 'racing');
  a.message({ t: 'dnf' }); b.message({ t: 'dnf' });
  assert.equal(a.last('room').room.phase, 'results');
  a.message({ t: 'again' });
  room = a.last('room').room;
  assert.equal(room.phase, 'lobby');
  assert.equal(room.map.id, DEFAULT_MAP_ID);
});

test('the race server hears of a map saved elsewhere (NOTIFY), without being told', async () => {
  let t = 5000;
  const store = new MapStore(T.db, { now: () => t });
  const maps = await new MapIndex(store).watch({ everyMs: 3_600_000 });
  try {
    const until = async ok => { for (let i = 0; i < 100 && !ok(); i++) await new Promise(r => setTimeout(r, 20)); assert.ok(ok()); };
    assert.equal(maps.info('lake'), null);
    assert.deepEqual(maps.info(DEFAULT_MAP_ID), { id: DEFAULT_MAP_ID, name: 'Figure-8', v: 0 });
    const other = new MapStore(T.db, { now: () => t });                // another writer: a route, a script
    const lake = await other.create({ name: 'Lake', course: course() });
    await until(() => maps.info('lake'));
    assert.deepEqual(maps.info('lake'), { id: 'lake', name: 'Lake', v: 5000 });
    t = 9000; await other.update(lake.id, { name: 'Big lake' });
    await until(() => maps.info('lake').v === 9000);
    assert.equal(maps.info('lake').name, 'Big lake');
    await other.delete(lake.id);
    await until(() => !maps.info('lake'));
    assert.equal(maps.info(42), null);
  } finally { await maps.stop(); }
});
