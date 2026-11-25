import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { testDb } from './db.mjs';
import { AutopilotStore, AutopilotError, AUTOPILOT_LIMITS, AUTOPILOT_SIZES } from '../lib/autopilots/store.mjs';

const T = await testDb();
beforeEach(() => T.reset());
after(() => T.drop());
const training = (extra = {}) => ({ kind: 'carsim-autopilot', version: 2, vehicle: 'buggy', vehicleName: 'Dune buggy', course: 'abc', ground: 'Sand', h: 0,
  inputs: ['speed', 'line6', 'line15', 'line30', 'offset', 'yaw', 'pace'], handbrake: false, keyPedals: false, keySteering: false,
  w: Array.from({ length: 16 }, (_, i) => i / 10), best: Array.from({ length: 16 }, () => 0.5), gen: 12, bestFit: 1150, bestLap: 63.2,
  hist: [[50, 40, null], [1150, 90, 63.2]], adam: { m: Array(16).fill(0), v: Array(16).fill(0), k: 12 }, ...extra });

test('autopilots: saved with a name and an owner, listed without weights, loaded, deleted by their owner', async () => {
  let t = 1000;
  const s = new AutopilotStore(T.db, { now: () => t });
  assert.deepEqual(await s.list(), []);
  const a = await s.create({ name: '  Buggy   gen 12 ', training: training(), owner: 'google:1', ownerName: 'Ann' });
  assert.equal(a.name, 'Buggy gen 12'); assert.equal(a.ownerName, 'Ann'); assert.equal(a.weights, 16); assert.equal(a.bestLap, 63.2);
  assert.equal(a.w, undefined);                                         // a summary
  t = 2000;
  const b = await s.create({ name: 'Bigger', training: training({ h: 8, w: Array(82).fill(0.1), best: null, adam: null }), owner: 'google:2', ownerName: 'Bob' });
  assert.deepEqual((await s.list()).map(x => x.name), ['Bigger', 'Buggy gen 12']);   // newest first
  const listed = (await s.list())[1];
  assert.deepEqual(listed, a); assert.equal(listed.savedAt, 1000); assert.equal(listed.owner, 'google:1');   // the summary, as when it was saved
  assert.deepEqual(Object.keys(listed).filter(k => ['w', 'best', 'adam', 'hist'].includes(k)), []);
  const full = await s.get(a.id);
  assert.equal(full.w.length, 16); assert.equal(full.adam.k, 12); assert.deepEqual(full.inputs, training().inputs);
  assert.deepEqual(full.w, training().w); assert.equal(full.savedAt, 1000); assert.equal(full.name, 'Buggy gen 12');
  assert.equal((await s.get(b.id)).best, null);
  await assert.rejects(s.delete(a.id, { owner: 'google:2' }), e => e instanceof AutopilotError && e.status === 403);
  await s.delete(a.id, { owner: 'google:1' });
  await s.delete(b.id, { owner: 'google:9', admin: true });
  assert.deepEqual(await s.list(), []);
  await assert.rejects(s.delete(a.id, { owner: 'google:1' }), e => e.status === 404);
  assert.equal(await s.get('../../etc/passwd'), null);
});

test('autopilots: what isn\'t a training, or is too much, is refused', async () => {
  const s = new AutopilotStore(T.db);
  const no = (o, status = 400) => assert.rejects(s.create({ name: 'x', owner: 'o', ...o }), e => e instanceof AutopilotError && e.status === status);
  await no({ name: '  ', training: training() });
  await no({ training: { kind: 'other' } });
  await no({ training: training({ h: 3 }) });
  await no({ training: training({ h: 65 }) });
  await no({ training: training({ w: [1, 'a', 3] }) });
  await no({ training: training({ w: Array(AUTOPILOT_LIMITS.weightsMax + 1).fill(0) }) });
  await no({ training: training({ best: [1, 2] }) });
  await no({ training: training({ inputs: [] }) });
  await no({ training: training({ inputs: ['<script>'] }) });
  const c = await s.create({ name: 'x', training: training({ hist: Array(AUTOPILOT_LIMITS.histMax + 500).fill([1, 2, null]), extra: 'dropped' }), owner: 'o' });
  assert.equal((await s.get(c.id)).hist.length, AUTOPILOT_LIMITS.histMax); assert.equal((await s.get(c.id)).extra, undefined);
  for (let i = 1; i < AUTOPILOT_LIMITS.perOwner; i++) await s.create({ name: 'x' + i, training: training(), owner: 'o' });
  await no({ training: training() }, 409);
  assert.ok((await s.create({ name: 'other owner', training: training(), owner: 'p' })).id);
});

test('autopilots: a network keeps its configuration and the circuits it was trained on before, with their charts (#351)', async () => {
  const s = new AutopilotStore(T.db);
  const config = { cfg: { crash: 300, flying: true, rival: 'car', rivalCar: 'gt500', '<bad key>': 1, list: [1, 2] }, pen: { offRoad: 2, damage: 150 }, gens: 0, stopAfter: 40,
    exam: 'flying2 1 0.84', setup: { vehicle: 'buggy', awd: true, split: 0.35, p: 2, psi: 18 }, follow: { who: 'Ann', time: 61.2, src: 'mine', deep: { x: 1 } }, fn: () => 1 };
  const stint = (course, from, to) => ({ course, track: 'Serpentine', ground: 'Road', vehicle: 'gt500', vehicleName: 'Mustang GT500', from, to, bestLap: 70.5, bestFit: 1500, config, savedAt: '2026-11-25T10:00:00Z' });
  const past = Array.from({ length: AUTOPILOT_LIMITS.pastMax + 2 }, (_, i) => stint('c' + i, i * 10, i * 10 + 10));
  const pastHist = past.map((_, i) => i === past.length - 1 ? { step: 3, h: Array(AUTOPILOT_LIMITS.pastHistMax + 50).fill([1, 2, 60]) } : i === past.length - 2 ? 'junk' : { step: 1, h: [[5, 4, null]] });
  const a = await s.create({ name: 'travelled', owner: 'o', training: training({ track: 'Trefoil', config, from: 170, past, pastHist }) });
  const full = await s.get(a.id);
  assert.deepEqual(full.config.cfg, { crash: 300, flying: true, rival: 'car', rivalCar: 'gt500' });      // plain values only
  assert.deepEqual(full.config.pen, { offRoad: 2, damage: 150 }); assert.equal(full.config.stopAfter, 40);
  assert.deepEqual(full.config.setup, config.setup); assert.deepEqual(full.config.follow, { who: 'Ann', time: 61.2, src: 'mine' });   // (one level down)
  assert.equal(full.from, 170); assert.equal(full.track, 'Trefoil');
  assert.equal(full.past.length, AUTOPILOT_LIMITS.pastMax); assert.equal(full.past[0].course, 'c2');           // the latest kept
  assert.equal(full.past.at(-1).to, 180); assert.deepEqual(full.past.at(-1).config.setup, config.setup);
  assert.equal(full.pastHist.length, full.past.length);                                                        // lined up
  assert.equal(full.pastHist.at(-1).step, 3); assert.equal(full.pastHist.at(-1).h.length, AUTOPILOT_LIMITS.pastHistMax);
  assert.equal(full.pastHist.at(-2), null); assert.deepEqual(full.pastHist[0].h, [[5, 4, null]]);
  const [listed] = await s.list();                                                                               // the list: no charts, no settings
  assert.equal(listed.past.length, AUTOPILOT_LIMITS.pastMax); assert.equal(listed.past[0].config, undefined); assert.equal(listed.pastHist, undefined);
  assert.deepEqual(listed.past.at(-1), { course: 'c17', track: 'Serpentine', ground: 'Road', vehicle: 'gt500', vehicleName: 'Mustang GT500', from: 170, to: 180, bestLap: 70.5 });
  const old = await s.create({ name: 'before #351', owner: 'o', training: training() });                       // one saved before: none of it
  const o = await s.get(old.id);
  assert.equal(o.config, null); assert.deepEqual(o.past, []); assert.deepEqual(o.pastHist, []); assert.equal(o.from, 0);
});

test('autopilots: every hidden layer the sim offers fits, the biggest with every input', async () => {
  const sim = fs.readFileSync(new URL('../scripts/patches/autopilot.py', import.meta.url), 'utf8').match(/const AI_SIZES = (\[[\d, ]+\])/);
  assert.deepEqual(JSON.parse(sim[1]), AUTOPILOT_SIZES);              // (#316: the sim's list and the server's)
  const s = new AutopilotStore(T.db), h = AUTOPILOT_SIZES.at(-1), I = 22, n = I * h + h + h * 3 + 3;   // (22: the sim's inputs, all of them; 3 outputs)
  const r = () => Array.from({ length: n }, () => Math.fround(Math.random() * 4 - 2));
  const w = r();
  const a = await s.create({ name: 'big', owner: 'o', training: training({ h, handbrake: true, w, best: r(), adam: { m: r(), v: r(), k: 99999 }, hist: Array(AUTOPILOT_LIMITS.histMax).fill([123456.789, 1234.5678, 123.456]) }) });
  assert.deepEqual((await s.get(a.id)).w, w);                          // every weight back exactly
});
