// Copies the parts of three.js the sim imports (see the importmap in public/sim/index.html) from
// node_modules into public/sim/vendor, so the game loads three from this app instead of a CDN.
// Runs on postinstall; the copy is not committed.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules/three'), to = join(root, 'public/sim/vendor/three');
if (!existsSync(from)) { console.warn('vendor-three: three is not installed, skipped'); process.exit(0); }
rmSync(to, { recursive: true, force: true });
cpSync(join(from, 'build/three.module.js'), join(to, 'build/three.module.js'));
for (const f of ['controls/OrbitControls.js', 'geometries/RoundedBoxGeometry.js', 'utils/BufferGeometryUtils.js', 'loaders/GLTFLoader.js'])
  cpSync(join(from, 'examples/jsm', f), join(to, 'examples/jsm', f));
cpSync(join(from, 'LICENSE'), join(to, 'LICENSE'));
console.log('vendor-three: copied to public/sim/vendor/three');
