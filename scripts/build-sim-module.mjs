#!/usr/bin/env node
// carsim.mjs, the simulator as a module (#355, lib/sim-module), written to a file: what the site serves at /carsim.mjs.
//   node scripts/build-sim-module.mjs [out.mjs]      (default: ./carsim.mjs)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { simModule } from '../lib/sim-module/serve.mjs';

const out = path.resolve(process.argv[2] || 'carsim.mjs'), m = simModule(fileURLToPath(new URL('..', import.meta.url)));
fs.writeFileSync(out, m.source);
console.log(`${out}: build ${m.build}, ${(m.bytes / 1e6).toFixed(2)} MB`);
