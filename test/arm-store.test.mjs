import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { testDb } from './db.mjs';
import { ArmNetStore, ArmNetError, ARM_NET_LIMITS, cleanNet } from '../lib/arm/store.mjs';
import { blank } from '../lib/arm/core.mjs';

const T = await testDb();
beforeEach(() => T.reset());
after(() => T.drop());
const shipped = f => JSON.parse(fs.readFileSync(new URL(`../lib/arm/networks/${f}.json`, import.meta.url), 'utf8'));

test('arm networks (#362): saved and loaded to the last digit, per arm and scenario, the best exams first', async () => {
  let t = 1000;
  const s = new ArmNetStore(T.db, { now: () => t++ });
  for (const f of ['grab', 'tray', 'stack', 'b601-grab', 'b601-tray', 'b601-stack']) {
    const net = shipped(f);
    const a = await s.create({ name: ` ${f}  net `, net, exam: net.exam, owner: 'google:1', ownerName: 'Ann Lee' });
    assert.equal(a.name, `${f} net`); assert.equal(a.arm, net.arm ?? 'desk'); assert.equal(a.task, net.task); assert.equal(a.weights, net.w.length);
    const back = await s.get(a.id);
    assert.deepEqual(back.net.w, net.w);                               // to the last digit: a rounded network takes another exam
    assert.deepEqual(back.net.inputs, net.inputs); assert.equal(back.net.h, net.h); assert.equal(back.net.arm, net.arm);
    assert.deepEqual(back.exam, { done: net.exam.done, of: net.exam.of, time: Math.round(net.exam.time * 1000) / 1000 });
  }
  assert.deepEqual((await s.list({ arm: 'b601', task: 'stack' })).map(n => n.name), ['b601-stack net']);
  assert.equal((await s.list({ arm: 'desk' })).length, 3);
  // the best exam first, then the faster, then a network without an exam
  const g = shipped('grab'), { exam: _e, ...bare } = g;
  await s.create({ name: 'worse', net: bare, exam: { done: 12, of: 20, time: 70 }, owner: 'google:2', ownerName: 'Bob' });
  await s.create({ name: 'unexamined', net: bare, owner: 'google:2', ownerName: 'Bob' });
  await s.create({ name: 'slower', net: bare, exam: { done: g.exam.done, of: 20, time: g.exam.time + 5 }, owner: 'google:2', ownerName: 'Bob' });
  assert.deepEqual((await s.list({ arm: 'desk', task: 'grab' })).map(n => n.name), ['grab net', 'slower', 'worse', 'unexamined']);
  assert.equal((await s.list({ owner: 'google:2' })).length, 3);
});

test('arm networks: only networks the sim can drive, with an exam of their scenario', async () => {
  const s = new ArmNetStore(T.db), base = { owner: 'google:1', ownerName: 'Ann' };
  const net = blank('tray', { h: 0 });
  const no = async (o, re) => { const e = await s.create({ name: 'x', net, ...base, ...o }).then(() => null, x => x); assert.ok(e instanceof ArmNetError && e.status === 400 && re.test(e.message), `${e?.message}`); };
  await no({ name: '  ' }, /name/);
  await no({ net: { ...net, w: net.w.slice(1) } }, /w is/);
  await no({ net: { ...net, inputs: ['nose'] } }, /no input/);
  await no({ net: { ...net, task: 'juggle' } }, /scenario/);
  await no({ net: { ...net, arm: 'ur5' } }, /arm is one of/);
  await no({ net: { ...net, w: net.w.map(() => NaN) } }, /w is/);
  await no({ exam: { done: 21, of: 20, time: 10 } }, /exam/);
  await no({ exam: { done: 3, of: 10, time: 10 } }, /exam/);              // the tray's exam is of 20
  await no({ exam: { done: 3, of: 20, time: 1e6 } }, /exam/);
  // what is kept: what drives it, nothing else that came with it
  const c = cleanNet({ ...net, name: 'mine', extra: 'x'.repeat(10), exam: { done: 1 } });
  assert.deepEqual(Object.keys(c).sort(), ['control', 'h', 'inputs', 'kind', 'roll', 'task', 'w']);
  assert.equal(cleanNet({ ...net, arm: 'desk' }).arm, undefined);        // the desk arm is the one without `arm`, as in its files
});

test('arm networks: deleted by whoever saved them or the super admin; so many each', async () => {
  const s = new ArmNetStore(T.db), net = blank('grab', { h: 0 });
  const a = await s.create({ name: 'a', net, owner: 'google:1', ownerName: 'Ann' });
  await assert.rejects(s.delete(a.id, { owner: 'google:2' }), e => e.status === 403);
  await s.delete(a.id, { owner: 'google:2', admin: true });
  await assert.rejects(s.delete(a.id, { owner: 'google:1' }), e => e.status === 404);
  for (let i = 0; i < ARM_NET_LIMITS.perOwner; i++) await s.create({ name: `n${i}`, net, owner: 'google:3', ownerName: 'Cy' });
  await assert.rejects(s.create({ name: 'one more', net, owner: 'google:3', ownerName: 'Cy' }), e => e.status === 409);
  assert.equal(await s.get('nope'), null);
});

test('arm networks for one\'s own scenario (#365): saved with it, listed under its key, its exam checked against it', async () => {
  const { EXAMPLES, scenarioKey } = await import('../lib/arm/scenario.mjs');
  const s = new ArmNetStore(T.db), sc = EXAMPLES[0], net = blank(sc, { h: 0 }), base = { owner: 'google:1', ownerName: 'Ann' };
  const a = await s.create({ name: 'sorter', net, exam: { done: 3, of: sc.exam, time: 200 }, ...base });
  assert.equal(a.task, `custom:${scenarioKey(sc)}`);
  const back = await s.get(a.id);
  assert.equal(back.net.task, 'custom'); assert.deepEqual(back.net.scenario, sc);
  assert.deepEqual((await s.list({ task: a.task })).map(n => n.name), ['sorter']);
  assert.deepEqual(await s.list({ task: `custom:${scenarioKey({ ...sc, limit: 41 })}` }), []);     // another scenario, another list
  await assert.rejects(s.create({ name: 'x', net, exam: { done: 3, of: 20, time: 10 }, ...base }), e => e.status === 400 && /of: 10/.test(e.message));
  await assert.rejects(s.create({ name: 'x', net: { ...net, scenario: undefined }, ...base }), e => e.status === 400 && /scenario/.test(e.message));
  await assert.rejects(s.create({ name: 'x', net: { ...net, scenario: { ...sc, rules: 'red → Z' } }, ...base }), e => e.status === 400 && /Rule 1/.test(e.message));
});
