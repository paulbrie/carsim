import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MapStore, MapError, cleanCourse, DEFAULT_MAP_ID } from '../lib/maps/store.mjs';
import { RaceHub } from '../lib/race/hub.mjs';
import { LIMITS } from '../lib/race/shared.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'carsim-maps-'));
const course = (n = 5) => ({ wp: Array.from({ length: n }, (_, i) => [Math.cos(i) * 80, Math.sin(i) * 80]), bank: 12, ops: [{ t: 'raise', x: 1, z: 2, r: 8, s: 0.05 }], base: 'earth', road: false, bridges: [{ x: 3, z: 4 }], noBridge: [] });

test('the figure-8 is there from the start, built in, and can be edited but not deleted', () => {
  let t = 1000;
  const s = new MapStore(tmp(), { now: () => t });
  assert.deepEqual(s.list().map(m => [m.id, m.builtin]), [[DEFAULT_MAP_ID, true]]);
  assert.equal(s.get(DEFAULT_MAP_ID).course, null);
  assert.deepEqual(s.info(DEFAULT_MAP_ID), { id: DEFAULT_MAP_ID, name: 'Figure-8', v: 0 });
  t = 2000;
  s.update(DEFAULT_MAP_ID, { course: course() });
  assert.equal(s.get(DEFAULT_MAP_ID).course.wp.length, 5);
  assert.equal(s.info(DEFAULT_MAP_ID).v, 2000);
  assert.equal(s.list().length, 1);
  assert.throws(() => s.delete(DEFAULT_MAP_ID), MapError);
});

test('create from a copy or a course, rename, save, delete', () => {
  let t = 1000;
  const s = new MapStore(tmp(), { now: () => t });
  const a = s.create({ name: '  Canyon   run ', by: 'x@y' });
  assert.equal(a.id, 'canyon-run'); assert.equal(a.name, 'Canyon run'); assert.equal(a.course, null);   // a copy of the figure-8
  const b = s.create({ name: 'Canyon run', course: course(7) });
  assert.match(b.id, /^canyon-run-[0-9a-f]{6}$/);                                                         // a free id
  const c = s.create({ name: 'Copy', from: b.id });
  assert.deepEqual(c.course, s.get(b.id).course);
  assert.throws(() => s.create({ name: 'X', from: 'nope' }), e => e.status === 404);
  assert.throws(() => s.create({ name: '   ' }), e => e.status === 400);
  t = 1000;                                                                                                 // same clock: v still moves
  const u = s.update(a.id, { name: 'Canyon', course: course(4) });
  assert.equal(u.name, 'Canyon'); assert.equal(u.course.wp.length, 4); assert.equal(u.updatedAt, 1001);
  assert.deepEqual(s.list().map(m => m.name), ['Figure-8', 'Canyon', 'Canyon run', 'Copy']);
  s.delete(c.id);
  assert.equal(s.get(c.id), null);
  assert.throws(() => s.delete(c.id), e => e.status === 404);
  assert.equal(s.get('../etc/passwd'), null);                                                              // ids are slugs, nothing else
});

test('a course is checked and trimmed like the sim reads it', () => {
  const c = cleanCourse({ ...course(), wp: [[1000, -1000], [1.234, 2], [3, 4]], bank: 99, level: 140, base: 'mud', ops: [{ t: 'nuke', x: 0, z: 0, r: 5 }, { t: 'smooth', x: 1, z: 1, r: 6, s: 0.1, v: 2, extra: 'x' }], bridges: [{ x: 'a' }, { x: 1, z: 2 }] });
  assert.deepEqual(c.wp, [[168, -168], [1.2, 2], [3, 4]]);
  assert.equal(c.bank, 25); assert.equal(c.level, 100); assert.equal(c.base, 'sand');
  assert.equal(cleanCourse(course()).level, 0);                        // courses from before levelling
  assert.deepEqual(c.ops, [{ t: 'smooth', x: 1, z: 1, r: 6, s: 0.1, v: 2 }]);
  assert.deepEqual(c.bridges, [{ x: 1, z: 2 }]);
  assert.throws(() => cleanCourse({ wp: [[0, 0], [1, 1]] }), e => e.status === 400);
  assert.throws(() => cleanCourse({ wp: [[0, 0], [1, 1], ['a', 1]] }), e => e.status === 400);
  assert.throws(() => cleanCourse([]), e => e.status === 400);
});

test('a room races a map: picked by the host, refreshed when a race starts, back to the figure-8 if deleted', () => {
  let t = 1_000_000;
  const store = new MapStore(tmp(), { now: () => t });
  const dunes = store.create({ name: 'Dunes', course: course() });
  const hub = new RaceHub({ now: () => t, random: () => 0.5, maps: store });
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
  t += 5000; store.update(dunes.id, { course: course(6) });
  a.message({ t: 'start', force: true });
  assert.equal(a.last('room').room.map.v, t);
  // deleted: the next race is on the figure-8
  store.delete(dunes.id);
  t += LIMITS.countdownMs; hub.tick();
  assert.equal(a.last('room').room.phase, 'racing');
  a.message({ t: 'dnf' }); b.message({ t: 'dnf' });
  assert.equal(a.last('room').room.phase, 'results');
  a.message({ t: 'again' });
  room = a.last('room').room;
  assert.equal(room.phase, 'lobby');
  assert.equal(room.map.id, DEFAULT_MAP_ID);
});
