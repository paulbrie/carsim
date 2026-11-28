// Train an arm network from the command line (#359): node scripts/arm/train.mjs [task=grab] [h=8] [control=hand]
// [seed=1] [generations=200] [out.json] [roll=0] [from.json: a network to carry on from, of this scenario or another
// (grown: what it is not shown yet starts at zero); or `hand`: the start written by hand for the tray and the stack]. On every core but one, 16 at most (CORES=n; worker threads).
// ARM=b601: for the reBot Arm B601-RS (#361; a network carried on from keeps its own arm). A scenario of one's own (#365): its
// file (a .json with kind armsim-scenario, as the page's editor writes it) in place of the task.
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { readFileSync, writeFileSync } from 'node:fs';
import { generation, grow, handStart, runGoes, shareOut, startTraining, trained } from '../../lib/arm/train.mjs';

const M = await (await import('@mujoco/mujoco')).default();
if (!isMainThread) parentPort.on('message', ({ id, head, goes }) => parentPort.postMessage({ id, res: runGoes(M, head, goes) }));
else {
  const [key = 'grab', h = '8', control = 'hand', seed = '1', gens = '200', out = '', roll = '0', from = ''] = process.argv.slice(2);
  const task = key.endsWith('.json') ? JSON.parse(readFileSync(key, 'utf8')) : key;
  const cores = Math.max(1, Math.min(+process.env.CORES || 16, availableParallelism() - 1)), wait = new Map(); let next = 0;
  const pool = Array.from({ length: cores }, () => { const w = new Worker(new URL(import.meta.url)); w.on('message', m => { wait.get(m.id)(m.res); wait.delete(m.id); }); return w; });
  const evaluate = shareOut(cores, (i, head, goes) => new Promise(yes => { const id = next++; wait.set(id, yes); pool[i].postMessage({ id, head, goes }); }));
  const base = from === 'hand' ? handStart(task, process.env.ARM || 'desk') : from ? JSON.parse(readFileSync(from, 'utf8')) : null;
  const tr = startTraining({ task, h: +h, control, seed: +seed, roll: roll === '1', arm: process.env.ARM || 'desk', from: base && grow(base, { task, h: +h }), anew: !!base && (base.task !== (typeof task === 'string' ? task : 'custom') || process.env.ANEW === '1') }), t0 = Date.now();
  console.log(`${tr.net.arm ?? 'desk'}, ${typeof task === 'string' ? task : task.name}, ${control}, h ${h}, ${tr.net.w.length} weights, seed ${seed}, ${cores} cores`);
  for (let g = 1; g <= +gens; g++) {
    const x = await generation(tr, evaluate);
    if (g % 10 === 0 || g === +gens) console.log(`gen ${g}: ${x.skipped ? 'no grab yet (tries ' + tr.hist.at(-1)[3] + ')' : `${x.done}/${x.of} in ${x.time} s`} | best ${tr.best ? `${tr.best.exam.done}/${tr.best.exam.of} in ${tr.best.exam.time} s at gen ${tr.best.gen}` : 'none'} | ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    if (out && (g % 10 === 0 || g === +gens)) writeFileSync(out, JSON.stringify(trained(tr)));
  }
  for (const w of pool) w.terminate();
}
