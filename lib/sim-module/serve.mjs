// carsim.mjs as the site serves it (#355): built from the engine as it is on disk now (public/sim/engine.js, three.js
// from node_modules, api.template.js), once, and again when one of them changes. So the module people download is the
// physics the game runs, with no built file to keep in step.
import fs from 'node:fs';
import path from 'node:path';
import { buildSimModule } from './build.mjs';

const ROOT = process.cwd();
export const SIM_MODULE_FILES = { engine: 'public/sim/engine.js', three: 'node_modules/three/build/three.module.js', api: 'lib/sim-module/api.template.js' };
let made = null;

/** { source, build, bytes }: the module's text and its build id */
export function simModule(root = ROOT) {
  const files = Object.fromEntries(Object.entries(SIM_MODULE_FILES).map(([k, f]) => [k, path.join(root, f)]));
  const sig = Object.values(files).map(f => { const s = fs.statSync(f); return `${s.mtimeMs}:${s.size}`; }).join('|') + '|' + root;
  if (made?.sig === sig) return made;
  const read = k => fs.readFileSync(files[k], 'utf8');
  // (built: the engine's own date, so the same engine gives the same bytes on every server and after every restart)
  const source = buildSimModule({ engine: read('engine'), three: read('three'), api: read('api'), built: new Date(Math.max(fs.statSync(files.engine).mtimeMs, fs.statSync(files.api).mtimeMs)).toISOString() });
  return made = { sig, source, build: source.match(/"build":"([0-9a-f]+)"/)?.[1] || '', bytes: Buffer.byteLength(source) };
}
