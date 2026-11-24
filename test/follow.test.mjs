// A lap to follow (ticket #340): which of the driver's laps are worth copying, and the review of a drive against a lap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../public/sim/engine.js', import.meta.url), 'utf8');
const body = name => { const m = src.match(new RegExp(`\\nfunction ${name}\\([^\\n]*\\) \\{\\n[\\s\\S]*?\\n\\}\\n`)); assert.ok(m, `${name} has moved in engine.js`); return m[0]; };

// a tape as the replay's: a frame every 1/30 s, along x at the speeds v(t) gives
function tape(seconds, v, jumpAt) {
  const buf = []; let x = 0;
  for (let i = 0; i <= seconds * 30; i++) { const t = i / 30, s = v(t); x += s / 30; if (jumpAt != null && Math.abs(t - jumpAt) < 1e-6) x -= 30; buf.push({ t, p: [x, 0, 0], v: [s, 0, 0] }); }
  return buf;
}
const clean = buf => Function('rp', `${body('aiLapClean')}; return aiLapClean;`)({ buf });

test('only a clean flying lap is kept as the driver\'s example', () => {
  const flying = tape(30, t => 40 + 10 * Math.sin(t / 3));
  assert.equal(clean(flying)(0, 30), true);
  assert.equal(clean(tape(30, t => Math.min(45, 4 + 6 * t)))(0, 30), false, 'from the line: slow over the start');
  assert.equal(clean(tape(30, t => 40, 12))(0, 30), false, 'a respawn: a jump on the tape');
  assert.equal(clean(tape(30, t => Math.abs(t - 15) < 1 ? 0.5 : 40))(0, 30), false, 'stopped on the way');
  assert.equal(clean(flying)(40, 50), false, 'not on the tape');
});

test('the review finds where a drive loses time to the lap', () => {
  const n = 400, ds = 1, kmh = new Float32Array(n).fill(108), brk = new Float32Array(n), set = new Uint8Array(n).fill(1), v = new Float32Array(n).fill(30);
  for (let i = 100; i < 160; i++) { kmh[i] = 72; brk[i] = i < 130 ? 0.8 : 0; }        // 60 m at 20 m/s where the lap does 30: 1 s lost, braking half of it
  for (let i = 300; i < 320; i++) kmh[i] = 90;                                       // 20 m at 25 m/s: 0.13 s
  for (let i = 200; i < 230; i++) kmh[i] = 126;                                      // 30 m faster than the lap
  const AI = { map: { cnt: n, n, Pt: { ds }, kmh, brk, set }, s0: 0, drive: false };
  const R = { e: new Float32Array(n), v, who: 'you', time: 31.5, followed: true };
  const cmp = Function('AI', 'aiRefLap', 'aiLineAt', 'performance', `${body('aiMapCmp')}; return aiMapCmp;`)(AI, () => R, () => { }, { now: () => 0 })();
  assert.equal(cmp.top.length, 2);
  assert.deepEqual([cmp.top[0].a, cmp.top[0].b], [100, 159]);
  assert.ok(Math.abs(cmp.top[0].dt - 1) < 0.01 && Math.abs(cmp.top[0].brk - 0.5) < 0.01);
  assert.equal(Math.round(cmp.top[0].kmh), 72); assert.equal(Math.round(cmp.top[0].ref), 108);
  assert.deepEqual([cmp.top[1].a, cmp.top[1].b], [300, 319]);
  assert.ok(Math.abs(cmp.lost - (1 + 20 * (1 / 25 - 1 / 30))) < 0.01);
  assert.ok(Math.abs(cmp.gained - 30 * (1 / 30 - 1 / 35)) < 0.01);
  assert.equal(cmp.cover, 1);
});
