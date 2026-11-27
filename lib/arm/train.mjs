// The arm lab's trainer (#359): the car lab's own method (public/sim/engine.js, aiNewGen / aiEndGen), written on its
// own so it can run anywhere. Evolution: each generation tries 16 variations of the network (8 nudges, each one way and
// the opposite), ranks them, and moves the network towards the better ones (Adam). Every variation gets the same few
// placements, new ones each generation, so a lucky placement can't pass for a better network.
//
// Not every training gets there (measured with the first physics, Rapier, on Pick up, 8 hidden units, 150 generations,
// 2026-11-27): 5 of 10 learned to grab 19 or 20 times of 20; the others reach the cube and squeeze it but never lift: by
// then "down" is an output pinned at full, which nudges of 0.3 no longer move. Two settings tried against that, both off:
// - ES.half: that many of a generation's placements start half-way, with the open fingers already round the cube (as
//   the car's tries start along the track). With 2, all 7 trainings grabbed something by generation 90, but only 1
//   reached 20 of 20 in 150 generations (the reach from home is learned more slowly).
// - ES.decay: the weights pulled back towards zero each generation (0.2, 0.4): slower, and none grabbed in 80.
// Who does the driving is the caller's: `evaluate(net header, [{ w, at }])` → [{ ok, time, fit }] (here, in workers...).
import { attempt, blank, dice, examPlacements, INPUTS, placement, shape, TASKS } from './core.mjs';

export const ES = { pop: 16, sigma: 0.3, lr: 0.2, fine: 0.3, fineSigma: 0.5, back: 8, places: 4, half: 0, decay: 0 };

/**
 * A network for another scenario or of another size that does what `from` does: the inputs and hidden units they share
 * keep their weights, the new ones start at zero (so it is shown more, and does nothing with it yet). How a network
 * that picks a cube up becomes the start of one that carries it somewhere: grow(grab, { task: 'tray', h: 12 }).
 */
export function grow(from, { task = from.task, h = from.h } = {}) {
  const net = blank(task, { h: Math.max(h, from.h), control: from.control, roll: from.roll, arm: from.arm }), a = shape(from), b = shape(net);
  const cols = id => { let k = 0; for (const x of from.inputs) { if (x === id) return k; k += INPUTS[x].n; } return -1; };
  const map = [];                                           // for each input number of the new one: its place in the old one (-1: new)
  for (const id of net.inputs) { const c = cols(id); for (let i = 0; i < INPUTS[id].n; i++) map.push(c < 0 ? -1 : c + i); }
  if (!a.h || !b.h) { if (a.h || b.h) throw new Error('grow: with or without a hidden layer, both alike'); for (let o = 0; o < a.nout; o++) { map.forEach((m, i) => { if (m >= 0) net.w[o * b.nin + i] = from.w[o * a.nin + m]; }); net.w[b.nout * b.nin + o] = from.w[a.nout * a.nin + o]; } return net; }
  for (let j = 0; j < a.h; j++) {
    map.forEach((m, i) => { if (m >= 0) net.w[j * b.nin + i] = from.w[j * a.nin + m]; });
    net.w[b.nin * b.h + j] = from.w[a.nin * a.h + j];
    for (let o = 0; o < a.nout; o++) net.w[b.nin * b.h + b.h + j * b.nout + o] = from.w[a.nin * a.h + a.h + j * a.nout + o];
  }
  for (let o = 0; o < a.nout; o++) net.w[b.nin * b.h + b.h + b.h * b.nout + o] = from.w[a.nin * a.h + a.h + a.h * a.nout + o];
  return net;
}

/** A training from nothing, or carried on from a network's weights, in small steps (full-size ones undo in a few
 *  generations what the network could do: tried). `anew`: it is a network grown out of another scenario, which does
 *  not manage this one yet: the exam waits for a first success, as from nothing. */
export function startTraining({ task = 'grab', h = 8, control = 'hand', roll = false, seed = 1, from = null, anew = false, arm = 'desk' } = {}) {
  const net = from ? { ...from, w: [...from.w] } : blank(task, { h, control, roll, arm }), n = shape(net).weights;
  return { net, seed, gen: 0, k: 0, m: new Array(n).fill(0), v: new Array(n).fill(0), best: null, hist: [], rnd: dice(seed), grabbed: !!from && !anew, fine: !!from, since: 0 };
}
const header = net => ({ kind: net.kind, ...(net.arm && { arm: net.arm }), task: net.task, control: net.control, roll: net.roll, inputs: net.inputs, h: net.h });

/**
 * An `evaluate` that shares goes out over n drivers (workers): `run(i, head, goes)` → Promise of their results is
 * driver i's. Each takes a few goes and comes back for more, so a driver whose goes end early (a grab takes a second
 * and a half, a failure the whole five) is not left waiting for the others, as it was with one equal slice each.
 */
export function shareOut(n, run, chunk = 2) {
  return (head, goes) => new Promise((yes, no) => {
    const out = new Array(goes.length); let next = 0, open = 0;
    const feed = i => {
      if (next >= goes.length) { if (!open) yes(out); return; }
      const from = next, part = goes.slice(from, next += chunk);
      open++;
      run(i, head, part).then(res => { for (let k = 0; k < res.length; k++) out[from + k] = res[k]; open--; feed(i); }, no);
    };
    if (!goes.length) yes(out);
    else for (let i = 0; i < n && next < goes.length; i++) feed(i);
  });
}

/** Do these goes here and now (a worker's whole job, and the fallback without workers). M: MuJoCo, loaded. */
export function runGoes(M, head, goes) { return goes.map(g => attempt(M, { ...head, w: g.w }, g.at)); }

/** A network's exam through `evaluate`: see core's exam(). */
export async function examBy(evaluate, net) {
  const limit = TASKS[net.task].limit, goes = await evaluate(header(net), examPlacements(net.task).map(at => ({ w: net.w, at })));
  const done = goes.filter(g => g.ok).length, round = v => Math.round(v * 1000) / 1000;
  return { task: net.task, done, of: goes.length, time: round(goes.reduce((s, g) => s + (g.ok ? g.time : limit), 0)), mean: done ? round(goes.reduce((s, g) => s + (g.ok ? g.time : 0), 0) / done) : null, fit: goes.reduce((s, g) => s + g.fit, 0) / goes.length };
}
export const better = (a, b) => !b || a.done > b.done || (a.done === b.done && (a.time < b.time || (a.time === b.time && a.fit > b.fit)));

/**
 * One generation, then the exam of what came out of it. tr.best is the best network examined so far ({ w, exam, gen };
 * null until one is examined); tr.hist one line a generation: [generation, done, time, the tries' average fit].
 */
export async function generation(tr, evaluate) {
  const { net, rnd } = tr, n = net.w.length, jobs = TASKS[net.task].jobs.length;
  // a scenario of several jobs: half the placements start with some of them already done, so the later ones are practised
  // from the first generation (as the car's tries start along the track), not only once the first is managed
  const places = Array.from({ length: ES.places }, (_, i) => ({ ...placement(rnd, net.task, net.roll), ...(i < ES.half ? { start: 'cube' } : null), ...(jobs > 1 && i % 2 ? { stacked: 1 + Math.floor(rnd() * (jobs - 1)) } : null) })), eps = [], goes = [];
  // once it manages the scenario (or carries on from a network): smaller nudges and smaller steps, to refine and not wander off
  const fine = !!(tr.best?.exam.done || tr.fine), sigma = ES.sigma * (fine ? ES.fineSigma : 1);
  for (let p = 0; p < ES.pop / 2; p++) {
    const e = new Array(n); for (let i = 0; i < n; i++) e[i] = rnd.gauss();
    eps.push(e);
    for (const sg of [1, -1]) { const w = net.w.map((x, i) => x + sg * sigma * e[i]); for (const at of places) goes.push({ w, at }); }
  }
  const res = await evaluate(header(net), goes), fits = new Array(ES.pop).fill(0);
  res.forEach((r, i) => { fits[Math.floor(i / ES.places)] += r.fit / ES.places; });
  // ranks, −0.5 .. 0.5, so one lucky go doesn't run away with it
  const order = [...fits.keys()].sort((a, b) => fits[a] - fits[b] || a - b), u = new Array(ES.pop);
  order.forEach((c, r) => { u[c] = r / (ES.pop - 1) - 0.5; });
  const g = new Array(n).fill(0);
  eps.forEach((e, p) => { const d = u[2 * p] - u[2 * p + 1]; for (let i = 0; i < n; i++) g[i] += d * e[i] / (ES.pop * sigma); });
  tr.k++;
  const b1 = 1 - 0.9 ** tr.k, b2 = 1 - 0.999 ** tr.k, lr = ES.lr * (fine ? ES.fine : 1);
  for (let i = 0; i < n; i++) {
    tr.m[i] = 0.9 * tr.m[i] + 0.1 * g[i]; tr.v[i] = 0.999 * tr.v[i] + 0.001 * g[i] * g[i];
    net.w[i] += lr * (tr.m[i] / b1) / (Math.sqrt(tr.v[i] / b2) + 1e-8) - lr * ES.decay * net.w[i];
  }
  tr.gen++;
  // The exam costs a quarter of a generation while nothing is grabbed (20 goes that last their whole limit), so it waits
  // until a variation has managed the task once (or the training carries on from a network): before that the network
  // is put down as 0 of 20 unexamined (`skipped`), which it very nearly always is.
  tr.grabbed ||= res.some(r => r.ok);
  const exam = tr.grabbed ? await examBy(evaluate, net) : { task: net.task, done: 0, of: TASKS[net.task].exam, time: TASKS[net.task].exam * TASKS[net.task].limit, mean: null, fit: 0, skipped: true };
  if (!exam.skipped && better(exam, tr.best?.exam)) { tr.best = { w: [...net.w], exam, gen: tr.gen }; tr.since = 0; }
  // wandered off: ES.back generations without a new best, and worse than it now: start again from the best
  else if (tr.best?.exam.done && ++tr.since >= ES.back && exam.done < tr.best.exam.done) { net.w = [...tr.best.w]; tr.m.fill(0); tr.v.fill(0); tr.k = 0; tr.since = 0; }
  tr.hist.push([tr.gen, exam.done, exam.time, Math.round(fits.reduce((a, b) => a + b, 0) / ES.pop * 100) / 100]);
  return exam;
}

/** The best network of a training, as a file. Its weights to the last digit: the exam is theirs, and a rounded weight grabs otherwise. */
export function trained(tr, name = '') {
  const b = tr.best ?? { w: tr.net.w, exam: null, gen: tr.gen };
  return { ...header(tr.net), name, w: [...b.w], generation: b.gen, generations: tr.gen, exam: b.exam && { done: b.exam.done, of: b.exam.of, time: b.exam.time } };
}
