// Copies the parts of three.js the sim imports (see the importmap in public/sim/index.html) from
// node_modules into public/sim/vendor, so the game loads three from this app instead of a CDN; and MuJoCo (the arm
// sim's physics, #359: its loader and its 11 MB of WebAssembly, which the page and its workers load as they are, not
// through the bundler) into public/arm/vendor. Runs on postinstall; the copies are not committed.
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

const mj = join(root, 'node_modules/@mujoco/mujoco'), mjTo = join(root, 'public/arm/vendor/mujoco');
if (!existsSync(mj)) console.warn('vendor-three: @mujoco/mujoco is not installed, skipped');
else {
  rmSync(mjTo, { recursive: true, force: true });
  for (const f of ['mujoco.js', 'mujoco.wasm']) cpSync(join(mj, f), join(mjTo, f));
  console.log('vendor-three: MuJoCo copied to public/arm/vendor/mujoco');
}
