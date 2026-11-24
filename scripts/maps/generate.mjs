// Generated circuits as course files (#315): the course editor's GENERATE (public/sim/circuit-gen.js), from node.
//   node scripts/maps/generate.mjs [--seed 42] [--km 1.6] [--style flowing|mixed|twisty] [--r 25]
//        [--ground road|earth|sand] [--count 1] [--out <dir or file.json>]
// Writes each circuit as the editor's Export course does (a course file: Import course, or a map with
// `node scripts/maps/add.mjs <file>`), named after its style and seed (mixed-42.json), and says how long it is.
// --count n: the seeds from --seed on (42, 43, …). Without --out: in the current directory.
// The same seed, length, style and radius give the same circuit as the editor's.
import fs from 'node:fs';
import path from 'node:path';
import { generateCircuit, CIRCUIT_STYLES } from '../../public/sim/circuit-gen.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };
if (args.includes('--help') || args.includes('-h')) { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(0, 7).join('\n')); process.exit(0); }
const seed0 = opt('seed', String(1 + Math.floor(Math.random() * 999999))), km = +opt('km', 1.6), style = opt('style', 'mixed'), rMin = +opt('r', 25);
const ground = opt('ground', 'road'), count = Math.max(1, Math.min(500, Math.round(+opt('count', 1)) || 1)), out = opt('out', '.');
if (!CIRCUIT_STYLES[style]) { console.error(`--style: one of ${Object.keys(CIRCUIT_STYLES).join(', ')}`); process.exit(1); }
if (!['road', 'earth', 'sand'].includes(ground)) { console.error('--ground: road, earth or sand'); process.exit(1); }
const toFile = out.endsWith('.json');
if (toFile && count > 1) { console.error('--out file.json takes one circuit: give a directory for --count'); process.exit(1); }
if (!toFile) fs.mkdirSync(out, { recursive: true });
for (let k = 0; k < count; k++) {
  const seed = /^\d+$/.test(seed0) ? String(+seed0 + k) : count > 1 ? `${seed0}-${k + 1}` : seed0;
  const c = generateCircuit({ seed, km, style, rMin });
  if (!c) { console.error(`seed ${seed}: no circuit fits with ${rMin} m corners`); process.exitCode = 1; continue; }
  // as the editor sets a generated course: levelled, no grade over 6 %, banked up to 8°, on the ground asked
  const course = { wp: c.wp, bank: 8, level: 100, even: [], grade: 6, ops: [], base: ground === 'sand' ? 'sand' : 'earth', road: ground === 'road', bridges: [], noBridge: [] };
  const file = toFile ? out : path.join(out, `${style}-${String(seed).replace(/[^\w-]+/g, '_')}.json`);
  fs.writeFileSync(file, JSON.stringify(course));
  console.log(`${file}: ${(c.len / 1000).toFixed(2)} km, ${c.wp.length} waypoints, tightest corner ${Math.round(c.tightest)} m, longest straight ${Math.round(c.straight)} m${c.exact ? '' : ` (${km} km asked: the longest this seed fits)`}`);
}
