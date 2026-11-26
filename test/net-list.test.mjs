// The networks page's list: a network saved twice shows once, and "fastest" is one per car and track.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { netList } from '../lib/net-list.mjs';

const net = (id, o = {}) => ({ id, name: `net ${id}`, savedAt: 1000, vehicle: 'x7', course: 'c8', track: 'figure-8', ground: 'road', bestLap: 50, w: [1, 2, 3], h: 0, inputs: ['speed'], handbrake: false, ...o });

test('the same weights saved twice show once, under the name that is not the lab\'s, and say so', () => {
  const list = netList([net('a', { name: 'X7 · 194 weights · gen 1802 · lap 0:45.970', savedAt: 2000 }), net('b', { name: 'X7 #348 P2 best setup', savedAt: 1000 }), net('c', { w: [1, 2, 4] })]);
  assert.equal(list.length, 2);
  const x = list.find(n => n.id === 'b');
  assert.deepEqual(x.also.map(a => a.id), ['a']);
  assert.ok(!list.some(n => n.id === 'a'));
  // both auto-named: the newest stays
  const two = netList([net('a', { name: 'X7 · 3 weights · gen 1', savedAt: 1 }), net('b', { name: 'X7 · 3 weights · gen 1', savedAt: 2 })]);
  assert.deepEqual(two.map(n => n.id), ['b']);
});

test('identity is the driving, not the name: another car, course, size, inputs or handbrake is another network', () => {
  const base = net('a');
  for (const o of [{ vehicle: 'rs6' }, { course: 'other' }, { h: 8 }, { inputs: ['line6'] }, { handbrake: true }, { w: null }])
    assert.equal(netList([base, net('b', o)]).length, 2, JSON.stringify(o));
  assert.equal(netList([net('a', { w: null }), net('b', { w: null })]).length, 2);   // no weights: nothing to compare
  assert.equal(netList([base, net('b', { name: 'other', ownerName: 'someone', savedAt: 5 })]).length, 1);
});

test('fastest is one per car and track, not one per car', () => {
  const list = netList([
    net('a', { vehicle: 'arteon', track: 'bridges', course: 'cb', bestLap: 57.08, w: [1] }),
    net('b', { vehicle: 'arteon', track: 'figure-8', course: 'c8', bestLap: 45.23, w: [2] }),
    net('c', { vehicle: 'arteon', track: 'figure-8', course: 'c8', bestLap: 46, w: [3] }),
    net('d', { vehicle: 'x7', track: null, course: 'mine', bestLap: null, w: [4] }),
    net('e', { vehicle: 'x7', track: null, course: 'mine', bestLap: 70, w: [5] }),
  ]);
  assert.deepEqual(list.filter(n => n.fastest).map(n => n.id).sort(), ['a', 'b', 'e']);
});

test('the list stays newest first', () => {
  const list = netList([net('a', { savedAt: 1 }), net('b', { savedAt: 3, w: [9] }), net('c', { savedAt: 2, w: [8], bestLap: 49 })]);
  assert.deepEqual(list.map(n => n.id), ['b', 'c', 'a']);
  assert.deepEqual(list.filter(n => n.fastest).map(n => n.id), ['c']);
});
