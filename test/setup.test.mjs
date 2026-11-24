// The car's setup (ticket #332): the figures the Car setup drawer shows for a tire pressure are the tire model's own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../public/sim/engine.js', import.meta.url), 'utf8');
const body = (name) => { const m = src.match(new RegExp(`\\nfunction ${name}\\([^\\n]*\\) \\{\\n[\\s\\S]*?\\n\\}\\n`)); assert.ok(m, `${name} has moved in engine.js`); return m[0]; };

test('tireFigures repeats stepCar\'s sums for the tire on the ground', () => {
  const step = body('stepCar'), fig = body('tireFigures');
  // the model's terms, as stepCar writes them: a change to one of them there must be made in tireFigures too
  for (const term of ['P.kpa * 1000 * 0.8 + 12000', 'Math.min(load / pg / b, 0.3)', 'load / (b * Math.max(len, 0.05))', '0.02 * load', 'load * 0.6 * (', '* b * Math.max(len, 0.15)']) {
    assert.ok(step.includes(term), `stepCar no longer has "${term}": bring tireFigures (scripts/patches/setup.py) in step, and this list`);
    assert.ok(fig.includes(term), `tireFigures no longer has "${term}"`);
  }
});

test('a softer tire sinks less and rolls easier on sand; on asphalt only its radius changes', () => {
  const SAND = { name: 'Sand', k: 1.2e6, kComp: 7, tanPhi: 0.58, tanPhiComp: 0.15, coh: 900, rc: 0.25 };
  const ASPHALT = { name: 'Asphalt', k: 4e8, kComp: 0, tanPhi: 1.15, tanPhiComp: 0, coh: 0, rc: 0, rigid: true };
  const PRESSURES = [{ psi: 8, kpa: 55, w: 0.36, defl: 0.035 }, { psi: 14, kpa: 97, w: 0.33, defl: 0.02 }, { psi: 24, kpa: 165, w: 0.30, defl: 0.006 }];
  const car = { pIdx: 1, mass: 820, R: 0.42, wheels: [1, 2, 3, 4], pos: { x: 0, z: 0 } };
  const figures = SF => Function('car', 'PRESSURES', 'G', 'surfAtCell', 'cellIndex', `${body('tireFigures')}; return tireFigures;`)(car, PRESSURES, 9.81, () => SF, () => 0);
  const sand = [0, 1, 2].map(i => figures(SAND)(i));
  assert.ok(sand[0].sink < sand[1].sink && sand[1].sink < sand[2].sink);
  assert.ok(Math.abs(sand[0].sink - 0.0467) < 0.001, `the buggy at 8 psi sinks ${sand[0].sink} m in fresh sand`);   // 56 kPa on 1.2 MPa/m
  assert.ok(sand[2].drag > 3 * sand[0].drag);
  assert.ok(sand[0].length > sand[2].length && sand[0].grip > sand[2].grip);
  assert.equal(sand[1].ground, 'Sand');
  assert.ok(figures(SAND)(0, 1).sink < sand[0].sink);                      // packed sand carries more
  const road = [0, 1, 2].map(i => figures(ASPHALT)(i));
  assert.ok(road.every(f => f.sink === 0 && f.rigid && f.grip === road[0].grip && f.drag === road[0].drag));
  assert.ok(road[0].radius < road[2].radius);
});
