// A core of the arm lab's training (#359): the page sends goes (a network's weights and a placement each), this drives
// them and sends back how each went. The page keeps the trainer (lib/arm/train.mjs); a worker only drives.
import { loadMujoco } from './load.mjs';
import { runGoes } from './train.mjs';

const ready = loadMujoco();
self.onmessage = async e => {
  const M = await ready, { id, head, goes } = e.data;
  self.postMessage({ id, res: runGoes(M, head, goes) });
};
