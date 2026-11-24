import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCircuit, curvePoints, tightest, separation, CIRCUIT_STYLES } from '../public/sim/circuit-gen.js';
import { cleanCourse } from '../lib/maps/store.mjs';

test('the same seed, length, style and radius give the same circuit; another seed another', () => {
  const a = generateCircuit({ seed: 42, km: 1.2, style: 'mixed', rMin: 25 }), b = generateCircuit({ seed: '42', km: 1.2, style: 'mixed', rMin: 25 });
  assert.deepEqual(a.wp, b.wp);
  assert.notDeepEqual(generateCircuit({ seed: 43, km: 1.2, style: 'mixed', rMin: 25 }).wp, a.wp);
  assert.notDeepEqual(generateCircuit({ seed: 'forty-two', km: 1.2, style: 'mixed', rMin: 25 }).wp, a.wp);
});

test('every style gives closed circuits that fit the world, keep their corners and never touch themselves', () => {
  for (const style of Object.keys(CIRCUIT_STYLES)) for (const [km, rMin] of [[0.8, 25], [1.2, 25], [1.8, 18], [1, 40]]) for (let seed = 1; seed <= 4; seed++) {
    const c = generateCircuit({ seed, km, style, rMin }), at = `${style} ${km} km r${rMin} #${seed}`;
    assert.ok(c, at);
    assert.ok(c.wp.length >= 4 && c.wp.length <= 400, at);
    assert.ok(c.wp.every(([x, z]) => Math.abs(x) <= 168 && Math.abs(z) <= 168), at);
    const P = curvePoints(c.wp, 2), ds = P.len / P.length;
    assert.ok(Math.round(tightest(P, ds)) >= rMin, `${at}: tightest ${tightest(P, ds)}`);
    assert.ok(separation(P, ds, 22) >= 22, `${at}: two parts of the road ${separation(P, ds, 22)} m apart`);
    assert.ok(Math.abs(P.len - c.len) < 1, at);
    if (c.exact) assert.ok(Math.abs(c.len - km * 1000) <= km * 1000 * 0.06, `${at}: ${c.len} m`);
    // a map can be made of it
    assert.deepEqual(cleanCourse({ wp: c.wp, bank: 8, level: 100, grade: 6, base: 'earth', road: true }).wp, c.wp);
  }
});

test('the length asked is met where it fits', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const c = generateCircuit({ seed, km: 1, style: 'mixed', rMin: 25 });
    assert.ok(c.exact && Math.abs(c.len - 1000) <= 60, `#${seed}: ${c.len}`);
  }
  // far too long for 25 m corners in a 400 m world: the longest found, said so
  const c = generateCircuit({ seed: 1, km: 3.5, style: 'flowing', rMin: 25 });
  assert.ok(c && !c.exact && c.len < 3000);
});
