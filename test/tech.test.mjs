// The /tech page's figures are read out of public/sim/engine.js (#335): every car must come out, whole and sane.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { techSpecs, torqueAt } from '../lib/tech/specs.mjs';
import { VEHICLES } from '../lib/race/shared.mjs';

const S = techSpecs();

test('every car of the race list is on the page, in its order', () => {
  assert.deepEqual(S.cars.map(c => c.key), VEHICLES.map(v => v.key));
  for (const v of VEHICLES) assert.equal(S.cars.find(c => c.key === v.key).name, v.name);
});

test('every car has its figures, finite and in range', () => {
  const nums = (o, at = '') => Object.entries(o).flatMap(([k, v]) => typeof v === 'number' ? [[at + k, v]] : v && typeof v === 'object' && !Array.isArray(v) ? nums(v, `${at}${k}.`) : []);
  for (const c of S.cars) {
    for (const [k, v] of nums(c)) assert.ok(Number.isFinite(v), `${c.key} ${k} = ${v}`);
    assert.ok(c.mass > 500 && c.mass < 4000, c.key);
    assert.ok(c.frontWeight > 0.3 && c.frontWeight < 0.7, c.key);
    assert.ok(c.engine.gears.length >= 4 && c.engine.peakPower > 50 && c.engine.peakTorque > 100, c.key);
    assert.equal(c.pressures.length, 3, c.key);
    assert.ok(c.engine.points.at(-1).rpm === c.engine.limiter, c.key);
  }
});

test("the torque curves give the makers' power (the blurb's kW) within 3 %", () => {
  for (const c of S.cars) {
    const kw = +/(\d+) kW/.exec(VEHICLES.find(v => v.key === c.key).blurb)[1];
    assert.ok(Math.abs(c.engine.peakPower - kw) / kw < 0.03, `${c.key}: ${c.engine.peakPower} kW from the curve, ${kw} kW in the blurb`);
  }
});

test('the grounds and the step', () => {
  assert.equal(S.hz, 240);
  assert.deepEqual(S.grounds.map(g => g.key), ['sand', 'earth', 'asphalt']);
  assert.ok(S.grounds.find(g => g.key === 'asphalt').rigid);
  assert.equal(torqueAt([[1000, 100], [3000, 300]], 2000), 200);
  assert.equal(torqueAt([[1000, 100], [3000, 300]], 9000), 300);
});
