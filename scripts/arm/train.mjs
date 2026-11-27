// Train an arm network from the command line (#359): node scripts/arm/train.mjs [task=grab] [h=8] [control=hand]
// [seed=1] [generations=200] [out.json] [roll=0]. On up to 8 cores (CORES=n; worker threads). The physics is Rapier's
// deterministic build: RAPIER=<path to its rapier.mjs> when it is not installed in this project.
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { writeFileSync } from 'node:fs';
import { generation, runGoes, startTraining, trained } from '../../lib/arm/train.mjs';

const RAPIER = (await import(process.env.RAPIER || '@dimforge/rapier3d-deterministic-compat')).default;
await RAPIER.init();
if (!isMainThread) parentPort.on('message', ({ id, head, goes }) => parentPort.postMessage({ id, res: runGoes(RAPIER, head, goes) }));
else {
  const [task = 'grab', h = '8', control = 'hand', seed = '1', gens = '200', out = '', roll = '0'] = process.argv.slice(2);
  const cores = Math.max(1, Math.min(+process.env.CORES || 8, availableParallelism() - 1)), wait = new Map(); let next = 0;
  const pool = Array.from({ length: cores }, () => { const w = new Worker(new URL(import.meta.url)); w.on('message', m => { wait.get(m.id)(m.res); wait.delete(m.id); }); return w; });
  const evaluate = async (head, goes) => {
    const size = Math.ceil(goes.length / cores), parts = [];
    for (let i = 0; i < cores && i * size < goes.length; i++) parts.push(new Promise(yes => { const id = next++; wait.set(id, yes); pool[i].postMessage({ id, head, goes: goes.slice(i * size, (i + 1) * size) }); }));
    return (await Promise.all(parts)).flat();
  };
  const tr = startTraining({ task, h: +h, control, seed: +seed, roll: roll === '1' }), t0 = Date.now();
  console.log(`${task}, ${control}, h ${h}, ${tr.net.w.length} weights, seed ${seed}, ${cores} cores`);
  for (let g = 1; g <= +gens; g++) {
    const x = await generation(tr, evaluate);
    if (g % 10 === 0 || g === +gens) console.log(`gen ${g}: ${x.done}/${x.of} in ${x.time} s (fit ${x.fit.toFixed(2)}) | best ${tr.best.exam.done}/${tr.best.exam.of} in ${tr.best.exam.time} s at gen ${tr.best.gen} | ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    if (out && (g % 10 === 0 || g === +gens)) writeFileSync(out, JSON.stringify(trained(tr)));
  }
  for (const w of pool) w.terminate();
}
