// A core of the arm lab's training (#359): the page sends goes (a network's weights and a placement each), this drives
// them and sends back how each went. The page keeps the trainer (lib/arm/train.mjs); a worker only drives.
import RAPIER from '@dimforge/rapier3d-deterministic-compat';
import { runGoes } from './train.mjs';

const ready = RAPIER.init();
self.onmessage = async e => {
  await ready;
  const { id, head, goes } = e.data;
  self.postMessage({ id, res: runGoes(RAPIER, head, goes) });
};
