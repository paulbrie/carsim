import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AutopilotStore, AutopilotError, AUTOPILOT_LIMITS, AUTOPILOT_SIZES } from '../lib/autopilots/store.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'carsim-autopilots-'));
const training = (extra = {}) => ({ kind: 'carsim-autopilot', version: 2, vehicle: 'buggy', vehicleName: 'Dune buggy', course: 'abc', ground: 'Sand', h: 0,
  inputs: ['speed', 'line6', 'line15', 'line30', 'offset', 'yaw', 'pace'], handbrake: false, keyPedals: false, keySteering: false,
  w: Array.from({ length: 16 }, (_, i) => i / 10), best: Array.from({ length: 16 }, () => 0.5), gen: 12, bestFit: 1150, bestLap: 63.2,
  hist: [[50, 40, null], [1150, 90, 63.2]], adam: { m: Array(16).fill(0), v: Array(16).fill(0), k: 12 }, ...extra });

test('autopilots: saved with a name and an owner, listed without weights, loaded, deleted by their owner', () => {
  let t = 1000;
  const s = new AutopilotStore(tmp(), { now: () => t });
  assert.deepEqual(s.list(), []);
  const a = s.create({ name: '  Buggy   gen 12 ', training: training(), owner: 'google:1', ownerName: 'Ann' });
  assert.equal(a.name, 'Buggy gen 12'); assert.equal(a.ownerName, 'Ann'); assert.equal(a.weights, 16); assert.equal(a.bestLap, 63.2);
  assert.equal(a.w, undefined);                                         // a summary
  t = 2000;
  const b = s.create({ name: 'Bigger', training: training({ h: 8, w: Array(82).fill(0.1), best: null, adam: null }), owner: 'google:2', ownerName: 'Bob' });
  assert.deepEqual(s.list().map(x => x.name), ['Bigger', 'Buggy gen 12']);   // newest first
  const full = s.get(a.id);
  assert.equal(full.w.length, 16); assert.equal(full.adam.k, 12); assert.deepEqual(full.inputs, training().inputs);
  assert.equal(s.get(b.id).best, null);
  assert.throws(() => s.delete(a.id, { owner: 'google:2' }), e => e instanceof AutopilotError && e.status === 403);
  s.delete(a.id, { owner: 'google:1' });
  s.delete(b.id, { owner: 'google:9', admin: true });
  assert.deepEqual(s.list(), []);
  assert.throws(() => s.delete(a.id, { owner: 'google:1' }), e => e.status === 404);
  assert.equal(s.get('../../etc/passwd'), null);
});

test('autopilots: what isn\'t a training, or is too much, is refused', () => {
  const s = new AutopilotStore(tmp());
  const no = (o, status = 400) => assert.throws(() => s.create({ name: 'x', owner: 'o', ...o }), e => e instanceof AutopilotError && e.status === status);
  no({ name: '  ', training: training() });
  no({ training: { kind: 'other' } });
  no({ training: training({ h: 3 }) });
  no({ training: training({ h: 65 }) });
  no({ training: training({ w: [1, 'a', 3] }) });
  no({ training: training({ w: Array(AUTOPILOT_LIMITS.weightsMax + 1).fill(0) }) });
  no({ training: training({ best: [1, 2] }) });
  no({ training: training({ inputs: [] }) });
  no({ training: training({ inputs: ['<script>'] }) });
  const c = s.create({ name: 'x', training: training({ hist: Array(1000).fill([1, 2, null]), extra: 'dropped' }), owner: 'o' });
  assert.equal(s.get(c.id).hist.length, AUTOPILOT_LIMITS.histMax); assert.equal(s.get(c.id).extra, undefined);
  for (let i = 1; i < AUTOPILOT_LIMITS.perOwner; i++) s.create({ name: 'x' + i, training: training(), owner: 'o' });
  no({ training: training() }, 409);
  assert.ok(s.create({ name: 'other owner', training: training(), owner: 'p' }).id);
});

test('autopilots: every hidden layer the sim offers fits, the biggest with every input', () => {
  const sim = fs.readFileSync(new URL('../scripts/patches/autopilot.py', import.meta.url), 'utf8').match(/const AI_SIZES = (\[[\d, ]+\])/);
  assert.deepEqual(JSON.parse(sim[1]), AUTOPILOT_SIZES);              // (#316: the sim's list and the server's)
  const s = new AutopilotStore(tmp()), h = AUTOPILOT_SIZES.at(-1), I = 22, n = I * h + h + h * 3 + 3;   // (22: the sim's inputs, all of them; 3 outputs)
  const r = () => Array.from({ length: n }, () => Math.fround(Math.random() * 4 - 2));
  const a = s.create({ name: 'big', owner: 'o', training: training({ h, handbrake: true, w: r(), best: r(), adam: { m: r(), v: r(), k: 99999 }, hist: Array(AUTOPILOT_LIMITS.histMax).fill([123456.789, 1234.5678, 123.456]) }) });
  assert.equal(s.get(a.id).w.length, n);
});
