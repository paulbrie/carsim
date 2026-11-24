import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCircuit, curvePoints, tightest, separation, crossings, bridgesFit, bridgesOf, CIRCUIT_STYLES } from '../public/sim/circuit-gen.js';
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

// Bridges (#326): the road crossing itself, a bridge at each crossing as the sim builds them
test('0 bridges: the circuits as before (never crossing); none asked is 0', () => {
  for (const style of Object.keys(CIRCUIT_STYLES)) for (let seed = 1; seed <= 3; seed++) {
    const a = generateCircuit({ seed, km: 1.2, style, rMin: 25 }), b = generateCircuit({ seed, km: 1.2, style, rMin: 25, bridges: 0 });
    assert.deepEqual(a.wp, b.wp);
    assert.equal(a.bridges, 0);
    assert.equal(crossings(curvePoints(a.wp, 2)).length, 0);
  }
});

test('n bridges: as many crossings as it says (no more than asked), each one bridged as the sim does', () => {
  const got = {};
  for (const style of Object.keys(CIRCUIT_STYLES)) for (const [km, rMin] of [[1, 25], [1.4, 25], [1.4, 20], [1.8, 15]]) for (const n of [1, 2, 3]) for (let seed = 1; seed <= 3; seed++) {
    const c = generateCircuit({ seed, km, style, rMin, bridges: n }), at = `${style} ${km} km r${rMin} b${n} #${seed}`;
    assert.ok(c && c.bridges <= n && c.bridgesAsked === n, at);
    const P = curvePoints(c.wp, 2), ds = P.len / P.length, X = crossings(P);
    assert.equal(X.length, c.bridges, `${at}: ${X.length} crossings`);
    assert.ok(bridgesFit(X, P.len), `${at}: a bridge would not fit`);
    assert.ok(X.every(q => q.sin >= Math.sin(55 * Math.PI / 180) - 1e-9), `${at}: a shallow crossing`);
    assert.ok(Math.round(tightest(P, ds)) >= rMin, `${at}: tightest ${tightest(P, ds)}`);
    assert.ok(c.wp.every(([x, z]) => Math.abs(x) <= 168 && Math.abs(z) <= 168), at);
    // apart everywhere else
    const sepMin = Math.max(22, Math.min(28, 1.85 * rMin)), skip = X.map(q => ({ ia: Math.round(q.uA * P.length), ib: Math.round(q.uB * P.length), r: sepMin / q.sin + 12 }));
    assert.ok(separation(P, ds, sepMin, skip) >= sepMin, `${at}: two parts of the road too close`);
    const k = `${km}/${rMin}/${n}`; got[k] = (got[k] || 0) + (c.bridges === n);
  }
  // as many as asked where the world has room: one at 1 km, three at 1.4 km with 20 m corners
  assert.equal(got['1/25/1'], 9);
  assert.ok(got['1.4/25/2'] >= 7, JSON.stringify(got));
  assert.ok(got['1.4/20/3'] >= 6, JSON.stringify(got));
});

test('random bridges: a number from 0 to 3 drawn from the seed, the same circuit for the same seed', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 40; seed++) { const n = bridgesOf('random', seed); assert.ok(n >= 0 && n <= 3); assert.equal(n, bridgesOf('random', String(seed))); seen.add(n); }
  assert.equal(seen.size, 4);
  const a = generateCircuit({ seed: 'x9', km: 1.4, style: 'mixed', bridges: 'random' }), b = generateCircuit({ seed: 'x9', km: 1.4, style: 'mixed', bridges: 'random' });
  assert.deepEqual(a.wp, b.wp);
  assert.equal(a.bridgesAsked, bridgesOf('random', 'x9'));
});
