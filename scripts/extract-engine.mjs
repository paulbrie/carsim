// One-off: split the single-file "Sand Buggy" sim (index.html: markup + engine module + four
// gzipped glTF models as base64 <script type="text/plain">) into the files the app serves:
//   public/sim/index.html          markup and CSS, loads engine.js
//   public/sim/engine.js           the engine module
//   public/sim/models/<key>.glb.gz the models, still gzipped (the engine unpacks them itself)
// Usage: node scripts/extract-engine.mjs <path to index.html> [out dir, default public/sim]
// Then the multiplayer hooks: python3 scripts/patches/mp-hooks.py <out>/engine.js scripts/patches/mp-block.js
// (the hooks also hide the single-player buttons: see body.mp in public/sim/index.html, kept by hand).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2];
if (!src) { console.error('usage: node scripts/extract-engine.mjs <index.html>'); process.exit(1); }
const html = readFileSync(src, 'utf8');
const out = process.argv[3] || join(root, 'public/sim');
mkdirSync(join(out, 'models'), { recursive: true });

// models
const modelRe = /<script type="text\/plain" id="sbmodel-([a-z0-9]+)">([^<]+)<\/script>/g;
let m, n = 0;
while ((m = modelRe.exec(html))) {
  const buf = Buffer.from(m[2].trim(), 'base64');
  writeFileSync(join(out, 'models', `${m[1]}.glb.gz`), buf);
  console.log(`models/${m[1]}.glb.gz ${(buf.length / 1e6).toFixed(1)} MB`);
  n++;
}
const page = html.replace(modelRe, '').replace(/\n*<!--[^>]*gzipped glTF[^>]*-->\n*/g, '\n');

// engine module
const start = page.indexOf('<script type="module">'), end = page.indexOf('</script>', start);
if (start < 0 || end < 0) throw new Error('engine <script type="module"> not found');
writeFileSync(join(out, 'engine.js'), page.slice(start + '<script type="module">'.length, end).replace(/^\n/, ''));

// page: three from the vendored copy (scripts/vendor-three.mjs), the engine from engine.js
const shell = page.slice(0, start) + '<script type="module" src="engine.js"></script>' + page.slice(end + '</script>'.length);
writeFileSync(join(out, 'index.html'), shell
  .replace('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js', './vendor/three/build/three.module.js')
  .replace('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/', './vendor/three/examples/jsm/'));
console.log(`engine.js, index.html, ${n} models`);
