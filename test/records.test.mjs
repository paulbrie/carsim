// The best laps and the files of before the database, in Postgres (ticket #318). The rooms' side: test/hub.test.mjs.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { RecordStore, GHOST } from '../lib/race/records.mjs';
import { MapStore } from '../lib/maps/store.mjs';
import { AutopilotStore } from '../lib/autopilots/store.mjs';
import { importFiles } from '../lib/db/import-files.mjs';
import { migrate } from '../lib/db/migrate.mjs';
import { testDb } from './db.mjs';

const T = await testDb();
beforeEach(() => T.reset());
after(() => T.drop());

const trace = time => Buffer.alloc((Math.floor(time / GHOST.dt + 1e-6) + 1) * GHOST.fields * 2, 7).toString('base64');
const lap = (o = {}) => ({ map: 'm', mv: 2, ground: 'sand', vehicle: 'x7', user: { id: 'u', name: 'U', image: 'https://x/u.png' }, time: 40.1234, splits: [null, 20, 31.00049], ...o });
const rows = async (sql = 'select * from records order by time_s') => (await T.db.pool.query(sql)).rows;

test('best laps: written as they are set, read back by a server that starts', async () => {
  let t = 1_700_000_000_123;
  const s1 = await new RecordStore(T.db, { now: () => t }).load();
  assert.equal(s1.submit(lap({ time: 3 })), null);                       // too short to be a lap
  assert.equal(s1.submit(lap()).time, 40.123);
  assert.equal(s1.submit(lap({ time: 41 })), null);                      // not a best
  t += 1000; s1.submit(lap({ user: { id: 'w', name: 'W' }, time: 39, mv: 1_795_200_192_578 }));   // a map's version is its save time, in ms
  t += 1000; s1.submit(lap({ ground: 'road', time: 50 }));
  await s1.flush();
  const s2 = await new RecordStore(T.db).load();
  assert.deepEqual(s2.list('m', 'sand'), s1.list('m', 'sand'));          // every field as it was: names, splits, times, when
  assert.deepEqual(s2.list('m', 'sand').map(r => [r.id, r.name, r.image, r.vehicle, r.time, r.mv, r.splits, r.at, r.ghost]),
    [['w', 'W', null, 'x7', 39, 1_795_200_192_578, [null, 20, 31], t - 1000, undefined], ['u', 'U', 'https://x/u.png', 'x7', 40.123, 2, [null, 20, 31], t - 2000, undefined]]);
  assert.deepEqual(s2.list('m', 'road').map(r => r.time), [50]);
  assert.deepEqual(s2.list('other', 'sand'), []);
  // a better lap replaces the row
  t += 1000; assert.equal(s2.submit(lap({ time: 38.5, splits: [] })).time, 38.5);
  await s2.flush();
  assert.deepEqual((await rows()).map(r => [r.driver_id, r.ground, r.time_s]), [['u', 'sand', 38.5], ['w', 'sand', 39], ['u', 'road', 50]]);
});

test('best laps: the database only ever takes a faster time', async () => {
  const a = await new RecordStore(T.db, { now: () => 1000 }).load(), b = await new RecordStore(T.db, { now: () => 2000 }).load();
  a.submit(lap({ time: 30, trace: trace(30) })); await a.flush();
  // b read the records before a's lap: it believes 31 is a best
  assert.equal(b.submit(lap({ time: 31 })).time, 31); await b.flush();
  assert.deepEqual((await rows()).map(r => [r.time_s, r.set_at.getTime(), r.trace === trace(30)]), [[30, 1000, true]]);
  assert.deepEqual((await new RecordStore(T.db).load()).list('m', 'sand').map(r => [r.time, r.ghost]), [[30, true]]);
});

test('ghosts: a lap\'s path in its record\'s row, read when asked for, gone with a lap that has none', async () => {
  let t = 5000;
  const s1 = await new RecordStore(T.db, { now: () => t }).load();
  assert.equal(s1.submit(lap({ time: 30, trace: trace(30) })).ghost, true);
  assert.equal(await s1.ghost('m', 'sand', 'x7', 'u'), trace(30));       // its own: before the write is through
  await s1.flush();
  const s2 = await new RecordStore(T.db).load();                         // a restarted server
  assert.equal(s2.list('m', 'sand')[0].ghost, true);
  assert.equal(s2.ghosts.size, 0);                                       // the paths are not read at start
  assert.equal(await s2.ghost('m', 'sand', 'x7', 'u'), trace(30));
  assert.equal(s2.ghosts.size, 1);
  assert.equal(await s2.ghost('m', 'sand', 'x7', 'nobody'), null);
  assert.equal(await s2.ghost('m', 'road', 'x7', 'u'), null);
  // a faster lap whose path doesn't cover it: the record, no ghost, and the old path is gone from the row
  assert.equal(s2.submit(lap({ time: 29, trace: trace(20) })).ghost, undefined);
  assert.equal(await s2.ghost('m', 'sand', 'x7', 'u'), null);
  await s2.flush();
  assert.deepEqual((await rows()).map(r => [r.time_s, r.trace]), [[29, null]]);
  // no more than GHOST.cacheMax paths stay in memory
  for (let i = 0; i < GHOST.cacheMax + 5; i++) s2.submit(lap({ user: { id: 'd' + i, name: 'D' }, time: 30, trace: trace(30) }));
  assert.equal(s2.ghosts.size, GHOST.cacheMax);
  await s2.flush();
  assert.equal(await s2.ghost('m', 'sand', 'x7', 'd0'), trace(30));      // dropped from memory, read from its row
});

test('best laps: a write that fails is tried again; the laps stay in order', async () => {
  let fails = 2;
  const flaky = { q: { select: (...a) => T.db.q.select(...a), insert: (...a) => { if (fails-- > 0) throw new Error('connection lost'); return T.db.q.insert(...a); } } };
  const s = await new RecordStore(flaky, { now: () => 1000, retryMs: 5 }).load();
  const warn = console.warn, said = []; console.warn = m => said.push(m);
  try {
    s.submit(lap({ time: 40 })); s.submit(lap({ time: 39 })); s.submit(lap({ time: 38 }));
    await s.flush();
  } finally { console.warn = warn; }
  assert.equal(said.length, 2);
  assert.deepEqual((await rows()).map(r => r.time_s), [38]);
});

test('the files of before the database are read in once, and nothing already there is overwritten', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carsim-data-'));
  const write = (f, o) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), typeof o === 'string' ? o : JSON.stringify(o)); };
  const course = { wp: [[0, 0], [50, 0], [50, 50], [0, 50]], bank: 8, level: 0, even: [], grade: 0, ops: [{ t: 'raise', x: 1, z: 2, r: 8, s: 0.05 }], base: 'earth', road: true, bridges: [{ x: 3, z: 4 }], noBridge: [] };
  write('maps/figure-8.json', { id: 'figure-8', name: 'Figure-8', course, createdAt: 0, updatedAt: 1_795_200_192_578, updatedBy: 'a@b.c' });
  write('maps/serpentine.json', { id: 'serpentine', name: 'Serpentine', course: null, createdAt: 1_795_300_000_000, updatedAt: 1_795_300_000_001, updatedBy: null });
  write('maps/other-name.json', { id: 'not-its-file', name: 'X', course: null });       // not a map file
  write('maps/broken.json', '{ not json');
  const key = 'serpentine|road|rs6|google:1', sha = k => crypto.createHash('sha1').update(k).digest('hex');
  write('records.json', { records: [
    { map: 'serpentine', mv: 1_795_300_000_001, ground: 'road', vehicle: 'rs6', id: 'google:1', name: 'Paul', image: null, time: 31.659, splits: [null, 2.3, 4.6], at: 1_795_400_000_000, ghost: true },
    { map: 'figure-8', mv: 0, ground: 'sand', vehicle: 'buggy', id: 'google:1', name: 'Paul', image: 'https://x/p.png', time: 44.5, splits: [], at: 1_795_400_000_500, ghost: true },   // its ghost's file is gone
    { map: 'figure-8', ground: 'sand', vehicle: 'buggy', id: 'google:2', name: 'No time' },
  ] });
  write(`ghosts/${sha(key)}.json`, { key, trace: trace(31.6) });
  const training = { kind: 'carsim-autopilot', version: 2, vehicle: 'rs6', vehicleName: 'Audi RS 6', course: 'abc', ground: 'Road', h: 0, inputs: ['speed'], handbrake: false, keyPedals: false, keySteering: false, noBrake: false, weights: 3, w: [0.1, 0.2, 0.3], best: null, gen: 4, bestFit: 10, bestLap: null, hist: [[1, 2, null]], adam: null };
  write('autopilots/abcdefghij12.json', { id: 'abcdefghij12', name: 'First', owner: 'google:1', ownerName: 'Paul', savedAt: 1_795_500_000_000, ...training });
  write('autopilots/zzzzzzzzzzzz.json', { id: 'zzzzzzzzzzzz', name: 'Not one', owner: 'o', kind: 'other' });

  assert.equal(await importFiles(T.db, path.join(dir, 'nowhere')), null);      // no such directory: nothing done, nothing remembered
  assert.deepEqual(await importFiles(T.db, dir, { now: () => 7000 }), { maps: 2, records: 2, ghosts: 1, autopilots: 1 });

  const maps = new MapStore(T.db), fig = await maps.get('figure-8');
  assert.deepEqual([fig.course, fig.updatedAt, fig.updatedBy, fig.builtin], [course, 1_795_200_192_578, 'a@b.c', true]);
  assert.deepEqual(await maps.info('serpentine'), { id: 'serpentine', name: 'Serpentine', v: 1_795_300_000_001 });
  assert.deepEqual((await maps.list()).map(m => [m.id, m.waypoints, m.createdAt]), [['figure-8', 4, 0], ['serpentine', 16, 1_795_300_000_000]]);
  const recs = await new RecordStore(T.db).load();
  assert.deepEqual(recs.list('serpentine', 'road'), [{ map: 'serpentine', mv: 1_795_300_000_001, ground: 'road', vehicle: 'rs6', id: 'google:1', name: 'Paul', image: null, time: 31.659, splits: [null, 2.3, 4.6], at: 1_795_400_000_000, ghost: true }]);
  assert.equal(await recs.ghost('serpentine', 'road', 'rs6', 'google:1'), trace(31.6));
  assert.deepEqual(recs.list('figure-8', 'sand').map(r => [r.id, r.time, r.image, r.ghost]), [['google:1', 44.5, 'https://x/p.png', undefined]]);
  const pilots = new AutopilotStore(T.db);
  assert.deepEqual(await pilots.get('abcdefghij12'), { id: 'abcdefghij12', name: 'First', owner: 'google:1', ownerName: 'Paul', savedAt: 1_795_500_000_000, ...training });
  assert.deepEqual((await pilots.list()).map(a => [a.id, a.weights, a.gen]), [['abcdefghij12', 3, 4]]);

  // once only: a map deleted since does not come back from its file at the next start
  await maps.delete('serpentine');
  assert.equal(await importFiles(T.db, dir), null);
  assert.equal(await maps.get('serpentine'), null);
  // by hand (--force): what is missing comes back, what is there stays as it is
  await maps.update('figure-8', { name: 'Figure eight' });
  assert.deepEqual(await importFiles(T.db, dir, { force: true }), { maps: 1, records: 0, ghosts: 0, autopilots: 0 });
  assert.equal((await maps.get('figure-8')).name, 'Figure eight');
  assert.ok(await maps.get('serpentine'));
});

test('migrations: two servers starting together apply them once', async () => {
  const other = await testDb();
  try {
    await Promise.all([migrate(other.db), migrate(other.db), migrate(T.db)]);
    const n = async db => +(await db.pool.query('select count(*) from __drizzle_migrations')).rows[0].count;
    const files = fs.readdirSync(new URL('../migrations', import.meta.url)).filter(f => f.endsWith('.sql')).length;
    assert.equal(await n(other.db), files); assert.equal(await n(T.db), files);
  } finally { await other.drop(); }
});
