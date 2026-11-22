// Turns a downloaded car model (glTF binary or FBX) into the sim's model format
// (public/sim/models/<key>.glb.gz, see MODELS in engine.js):
//   +z forward, +y up, +x left, metres, the tires on y = 0;
//   nodes body, spin{L,R}{F,B} (what turns with the wheel, centred on the hub), stat{L,R}{F,B}
//   (callipers: steer but do not spin), steer (the steering wheel, its column along local +y),
//   part_<kind>_<side> (pieces that can be knocked off), each centred on its own origin.
// Prints what engine.js needs about it (MODELS entry, roadSpec dimensions) and writes the body's
// profiles to .cache/models/<key>.json. Zipped sources are unpacked into .cache/models/<key>/.
//   node scripts/models/build-car.mjs <key> [--out dir] [--keep (the .glb too)] [--list [regex]] [--probe box] [--verbose (what simplifying did to each mesh)]   (cars in ./cars.mjs)
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { CARS } from './cars.mjs';

const key = process.argv[2], C = CARS[key];
if (!C) { console.error(`usage: build-car.mjs <${Object.keys(CARS).join('|')}>`); process.exit(1); }
const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const ROOT = path.resolve(arg('--root') || path.join(path.dirname(new URL(import.meta.url).pathname), '../..'));
const OUT = path.resolve(arg('--out') || path.join(ROOT, 'public/sim/models'));
const CACHE = path.join(ROOT, '.cache/models');

// a zip's files into dir (stored or deflated entries; names with '..' or a leading '/' are skipped)
function unzip(file, dir) {
  const b = fs.readFileSync(file);
  let e = b.length - 22; while (e >= 0 && b.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error(`${file}: not a zip`);
  let at = b.readUInt32LE(e + 16);
  for (let i = 0, n = b.readUInt16LE(e + 10); i < n; i++) {
    if (b.readUInt32LE(at) !== 0x02014b50) throw new Error(`${file}: bad central directory`);
    const method = b.readUInt16LE(at + 10), csize = b.readUInt32LE(at + 20), nl = b.readUInt16LE(at + 28), xl = b.readUInt16LE(at + 30), cl = b.readUInt16LE(at + 32);
    const local = b.readUInt32LE(at + 42), name = b.subarray(at + 46, at + 46 + nl).toString('utf8');
    at += 46 + nl + xl + cl;
    if (name.endsWith('/') || name.split(/[\\/]/).includes('..') || path.isAbsolute(name)) continue;
    const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28), data = b.subarray(start, start + csize);
    const to = path.join(dir, name); fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, method === 0 ? data : method === 8 ? zlib.inflateRawSync(data) : (() => { throw new Error(`${name}: compression ${method}`); })());
  }
}
// the source file: as it is, or out of its zip (and a zip in that zip)
function source() {
  if (!C.zip) return path.resolve(ROOT, C.file);
  let dir = path.join(CACHE, key), from = path.resolve(ROOT, C.zip[0]);
  for (let i = 0; i < C.zip.length; i++) {
    const to = path.join(dir, String(i));
    if (!fs.existsSync(to)) { console.log(`unzipping ${path.relative(ROOT, from)}`); unzip(from, to); }
    from = path.join(to, C.zip[i + 1] || ''); dir = to;
  }
  return path.join(dir, C.file);
}
const SRC = source();

/* ---------------------------------------------------------------- reading: parts, materials, images */
// part: { name, pos, nrm, uv (Float32Array), idx (Uint32Array), mat }, in the source's space
const parts = [], mats = new Map(), imgs = new Map();
let nImg = 0;
const addImg = (bytes, mime) => { const id = 'i' + nImg++; imgs.set(id, { bytes: Buffer.from(bytes), mime }); return id; };

async function readGlb(file) {
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(file);
  const R = doc.getRoot(), imgOf = new Map(), matOf = new Map();
  const tex = t => { if (!t) return null; if (!imgOf.has(t)) imgOf.set(t, addImg(t.getImage(), t.getMimeType())); return imgOf.get(t); };
  const mat = m => {
    if (!m) return 'none';
    if (matOf.has(m)) return matOf.get(m);
    const id = 'm' + matOf.size, c = m.getBaseColorFactor();
    mats.set(id, { name: m.getName(), color: c.slice(0, 3), alpha: c[3], blend: m.getAlphaMode() === 'BLEND', metal: m.getMetallicFactor(), rough: m.getRoughnessFactor(),
      emissive: m.getEmissiveFactor(), map: tex(m.getBaseColorTexture()), normalMap: tex(m.getNormalTexture()), emissiveMap: tex(m.getEmissiveTexture()), doubleSided: m.getDoubleSided() });
    matOf.set(m, id); return id;
  };
  const M = new THREE.Matrix4(), N = new THREE.Matrix3(), v = new THREE.Vector3();
  const visit = (node, inside, trail) => {
    inside ||= !C.root || C.root.test(node.getName());
    trail = trail + '/' + node.getName();
    const mesh = node.getMesh();
    if (mesh && inside) {
      M.fromArray(node.getWorldMatrix()); N.getNormalMatrix(M);
      for (const p of mesh.listPrimitives()) {
        if (p.getMode() !== 4) continue;
        const P = p.getAttribute('POSITION').getArray(), Nn = p.getAttribute('NORMAL')?.getArray(), U = p.getAttribute('TEXCOORD_0')?.getArray(), n = P.length / 3;
        const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          v.fromArray(P, i * 3).applyMatrix4(M).toArray(pos, i * 3);
          if (Nn) v.fromArray(Nn, i * 3).applyMatrix3(N).normalize().toArray(nrm, i * 3);
        }
        const I = p.getIndices()?.getArray();
        parts.push({ name: node.getName(), path: trail, pos, nrm: Nn ? nrm : null, uv: U ? Float32Array.from(U) : null, idx: I ? Uint32Array.from(I) : Uint32Array.from({ length: n }, (_, i) => i), mat: mat(p.getMaterial()) });
      }
    }
    for (const c of node.listChildren()) visit(c, inside, trail);
  };
  for (const sc of R.listScenes()) for (const n of sc.listChildren()) visit(n, false, '');
}

async function readFbx(file) {
  const blobs = new Map();
  globalThis.window = { URL: { createObjectURL: b => { const id = 'blob:' + blobs.size; blobs.set(id, b); return id; } } };
  THREE.TextureLoader.prototype.load = function (url) { const t = new THREE.Texture(); t.userData.src = url; return t; };
  const buf = fs.readFileSync(file);
  const root = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), path.dirname(file) + '/');
  root.updateMatrixWorld(true);
  const imgOf = new Map(), matOf = new Map();
  const tex = async t => {
    const src = t?.userData.src; if (!src) return null;
    if (!imgOf.has(src)) {
      let bytes, mime;
      if (blobs.has(src)) { const b = blobs.get(src); bytes = Buffer.from(await b.arrayBuffer()); mime = b.type; }
      else { const f = path.resolve(path.dirname(file), src); if (!fs.existsSync(f)) return null; bytes = fs.readFileSync(f); }
      mime = !mime || mime === 'application/octet-stream' ? (bytes[0] === 0x89 ? 'image/png' : 'image/jpeg') : mime;
      imgOf.set(src, addImg(bytes, mime));
    }
    return imgOf.get(src);
  };
  const mat = async m => {
    if (matOf.has(m)) return matOf.get(m);
    const id = 'm' + matOf.size;
    matOf.set(m, id);
    mats.set(id, { name: m.name, color: m.color.toArray(), alpha: m.opacity, blend: m.transparent, metal: 0, rough: m.shininess ? clamp(1 - Math.sqrt(m.shininess / 100), 0.05, 0.9) : 0.8,
      emissive: m.emissive?.toArray() || [0, 0, 0], map: await tex(m.map), normalMap: await tex(m.normalMap || m.bumpMap), emissiveMap: await tex(m.emissiveMap), doubleSided: false });
    return id;
  };
  const meshes = []; root.traverse(o => { if (o.isMesh) meshes.push(o); });
  const N = new THREE.Matrix3(), v = new THREE.Vector3();
  for (const o of meshes) {
    let trail = ''; for (let p = o; p && p !== root; p = p.parent) trail = '/' + p.name + trail;
    const g = o.geometry, P = g.attributes.position.array, Nn = g.attributes.normal?.array, U = g.attributes.uv?.array, n = P.length / 3;
    N.getNormalMatrix(o.matrixWorld);
    const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      v.fromArray(P, i * 3).applyMatrix4(o.matrixWorld).toArray(pos, i * 3);
      if (Nn) v.fromArray(Nn, i * 3).applyMatrix3(N).normalize().toArray(nrm, i * 3);
    }
    const ml = [].concat(o.material), I = g.index?.array;
    const groups = g.groups.length ? g.groups : [{ start: 0, count: I ? I.length : n, materialIndex: 0 }];
    for (const gr of groups) {
      const idx = new Uint32Array(gr.count);
      for (let k = 0; k < gr.count; k++) idx[k] = I ? I[gr.start + k] : gr.start + k;
      parts.push({ name: o.name, path: trail, pos, nrm: Nn ? nrm : null, uv: U ? Float32Array.from(U) : null, idx, mat: await mat(ml[gr.materialIndex] || ml[0]) });
    }
  }
}

/* ---------------------------------------------------------------- helpers */
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
// a part with only the triangles keep(i0, i1, i2) passes, its vertices compacted
function subset(p, keep, name = p.name) {
  const remap = new Int32Array(p.pos.length / 3).fill(-1), idx = [];
  let n = 0;
  for (let t = 0; t < p.idx.length; t += 3) {
    const a = p.idx[t], b = p.idx[t + 1], c = p.idx[t + 2];
    if (!keep(a, b, c)) continue;
    for (const k of [a, b, c]) { if (remap[k] < 0) remap[k] = n++; idx.push(remap[k]); }
  }
  if (!idx.length) return null;
  const pos = new Float32Array(n * 3), nrm = p.nrm && new Float32Array(n * 3), uv = p.uv && new Float32Array(n * 2);
  remap.forEach((r, k) => { if (r < 0) return; pos.set(p.pos.subarray(k * 3, k * 3 + 3), r * 3); nrm?.set(p.nrm.subarray(k * 3, k * 3 + 3), r * 3); uv?.set(p.uv.subarray(k * 2, k * 2 + 2), r * 2); });
  return { ...p, name, pos, nrm, uv, idx: Uint32Array.from(idx) };
}
const triCentre = (p, a, b, c, out) => { for (let j = 0; j < 3; j++) out[j] = (p.pos[a * 3 + j] + p.pos[b * 3 + j] + p.pos[c * 3 + j]) / 3; return out; };
function bounds(list) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const p of list) for (const k of p.idx) for (let j = 0; j < 3; j++) { const x = p.pos[k * 3 + j]; if (x < mn[j]) mn[j] = x; if (x > mx[j]) mx[j] = x; }
  return { mn, mx, c: mn.map((x, j) => (x + mx[j]) / 2), s: mn.map((x, j) => mx[j] - x) };
}
// connected pieces of a part (sharing a vertex position): of(vertex) → piece, boxes: piece → bounds
function components(p) {
  const n = p.pos.length / 3, key = new Map(), par = Int32Array.from({ length: n }, (_, i) => i);
  const find = i => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; };
  for (let i = 0; i < n; i++) { const k = `${Math.round(p.pos[i * 3] * 1e5)},${Math.round(p.pos[i * 3 + 1] * 1e5)},${Math.round(p.pos[i * 3 + 2] * 1e5)}`; const j = key.get(k); if (j === undefined) key.set(k, i); else par[find(i)] = find(j); }
  for (let t = 0; t < p.idx.length; t += 3) { const a = find(p.idx[t]); par[find(p.idx[t + 1])] = a; par[find(p.idx[t + 2])] = a; }
  const boxes = new Map();
  for (const k of p.idx) {
    const r = find(k); let b = boxes.get(r); if (!b) boxes.set(r, b = { mn: [Infinity, Infinity, Infinity], mx: [-Infinity, -Infinity, -Infinity] });
    for (let j = 0; j < 3; j++) { const x = p.pos[k * 3 + j]; if (x < b.mn[j]) b.mn[j] = x; if (x > b.mx[j]) b.mx[j] = x; }
  }
  return { of: find, boxes };
}
// weld identical vertices (FBX gives three per triangle), so the simplifier sees a connected surface
function weld(p) {
  const n = p.pos.length / 3, map = new Map(), remap = new Uint32Array(n), keep = [];
  const q = (x, s) => Math.round(x * s);
  for (let i = 0; i < n; i++) {
    let k = `${q(p.pos[i * 3], 1e5)},${q(p.pos[i * 3 + 1], 1e5)},${q(p.pos[i * 3 + 2], 1e5)}`;
    if (p.nrm) k += `|${q(p.nrm[i * 3], 500)},${q(p.nrm[i * 3 + 1], 500)},${q(p.nrm[i * 3 + 2], 500)}`;
    if (p.uv) k += `|${q(p.uv[i * 2], 1e5)},${q(p.uv[i * 2 + 1], 1e5)}`;
    let r = map.get(k); if (r === undefined) { r = keep.length; map.set(k, r); keep.push(i); }
    remap[i] = r;
  }
  const pos = new Float32Array(keep.length * 3), nrm = p.nrm && new Float32Array(keep.length * 3), uv = p.uv && new Float32Array(keep.length * 2);
  keep.forEach((i, r) => { pos.set(p.pos.subarray(i * 3, i * 3 + 3), r * 3); nrm?.set(p.nrm.subarray(i * 3, i * 3 + 3), r * 3); uv?.set(p.uv.subarray(i * 2, i * 2 + 2), r * 2); });
  return { ...p, pos, nrm, uv, idx: p.idx.map(i => remap[i]) };
}
function simplify(p, ratio, err, loose) {
  const tris = p.idx.length / 3;
  if (ratio >= 1 || tris < 300) return p;
  const w = weld(p), target = Math.max(3, Math.floor(w.idx.length * ratio / 3) * 3);
  // panels keep their borders (no cracks between them); loose: a mesh of many small pieces (a grille, lamp
  // internals) may lose its borders and its smallest pieces, or it would not get any lighter
  const flags = loose ? ['Prune'] : ['LockBorder'];
  // the normals count too, so curved panels keep enough triangles to shade smoothly
  const [idx] = w.nrm && !loose ? MeshoptSimplifier.simplifyWithAttributes(w.idx, w.pos, 3, w.nrm, 3, [0.6, 0.6, 0.6], null, target, err, flags)
    : MeshoptSimplifier.simplify(w.idx, w.pos, 3, target, err, flags);
  const s = subset({ ...w, idx }, () => true);
  if (process.argv.includes('--verbose')) console.log(`  ${label(p).slice(-60).padEnd(60)} ${String(tris).padStart(7)} → ${String(idx.length / 3).padStart(7)}  (welded ${p.pos.length / 3} → ${w.pos.length / 3} vertices${loose ? ', loose' : ''})`);
  return s || w;
}
function computeNormals(p) {
  const n = p.pos.length / 3, nrm = new Float32Array(n * 3), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < p.idx.length; t += 3) {
    const [i, j, k] = [p.idx[t], p.idx[t + 1], p.idx[t + 2]];
    a.fromArray(p.pos, i * 3); b.fromArray(p.pos, j * 3).sub(a); c.fromArray(p.pos, k * 3).sub(a); b.cross(c);
    for (const m of [i, j, k]) { nrm[m * 3] += b.x; nrm[m * 3 + 1] += b.y; nrm[m * 3 + 2] += b.z; }
  }
  for (let i = 0; i < n; i++) { a.fromArray(nrm, i * 3).normalize().toArray(nrm, i * 3); }
  p.nrm = nrm;
}

/* ---------------------------------------------------------------- 1. read, into the sim's axes and metres */
if (C.kind === 'glb') await readGlb(SRC); else await readFbx(SRC);
// each part its own compact arrays (FBX material groups share their mesh's)
parts.splice(0, parts.length, ...parts.map(p => subset(p, () => true)).filter(Boolean));
console.log(`read ${parts.length} parts, ${parts.reduce((a, p) => a + p.idx.length / 3, 0) | 0} triangles, ${mats.size} materials, ${imgs.size} images`);
{
  const ax = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] };
  const L = ax[C.axes.left], U = ax[C.axes.up || '+y'], F = ax[C.axes.fwd], s = C.scale || 1;
  const R = new THREE.Matrix3().set(...L, ...U, ...F), flip = R.determinant() < 0;     // rows: source → (x left, y up, z forward)
  const v = new THREE.Vector3();
  for (const p of parts) {
    if (p.done) continue; p.done = true;
    const P = p.pos; p.pos = new Float32Array(P.length); for (let i = 0; i < P.length; i += 3) v.fromArray(P, i).applyMatrix3(R).multiplyScalar(s).toArray(p.pos, i);
    if (p.nrm) { const Nn = p.nrm; p.nrm = new Float32Array(Nn.length); for (let i = 0; i < Nn.length; i += 3) v.fromArray(Nn, i).applyMatrix3(R).toArray(p.nrm, i); }
    if (flip) for (let t = 0; t < p.idx.length; t += 3) { const x = p.idx[t + 1]; p.idx[t + 1] = p.idx[t + 2]; p.idx[t + 2] = x; }
    // parts sharing arrays (FBX groups) would be transformed twice: share the result
    for (const q of parts) if (q !== p && !q.done && q.pos === P) { q.pos = p.pos; q.nrm = p.nrm; q.done = true; if (flip) for (let t = 0; t < q.idx.length; t += 3) { const x = q.idx[t + 1]; q.idx[t + 1] = q.idx[t + 2]; q.idx[t + 2] = x; } }
  }
}
const label = p => `${p.path} ${mats.get(p.mat)?.name || ''}`;
// --list: every part (its path and material: what the recipe's patterns match), its triangles, centre and size
// in the sim's axes, before centring; --list <regex> only those matching. To write a new car's recipe from.
if (process.argv.includes('--list')) {
  const re = arg('--list') && !arg('--list').startsWith('--') ? new RegExp(arg('--list')) : null, by = new Map();
  for (const p of parts) { const l = label(p); if (re && !re.test(l)) continue; if (!by.has(l)) by.set(l, []); by.get(l).push(p); }
  for (const [l, ps] of by) { const b = bounds(ps); console.log(l.padEnd(78), String(ps.reduce((a, p) => a + p.idx.length / 3, 0)).padStart(7), 'tris  c', b.c.map(x => x.toFixed(2)).join(','), ' size', b.s.map(x => x.toFixed(2)).join(',')); }
  const b = bounds(parts); console.log('all: centre', b.c.map(x => x.toFixed(3)).join(','), ' size', b.s.map(x => x.toFixed(3)).join(','));
  console.log('materials:'); for (const m of mats.values()) console.log(' ', (m.name || '(none)').padEnd(44), 'rgb', m.color.map(x => (+x).toFixed(2)).join(','), 'a', (+m.alpha).toFixed(2), m.blend ? 'blend' : '', m.map ? 'map' : '', m.normalMap ? 'normal' : '', m.emissiveMap ? 'emissive' : '');
  process.exit(0);
}
// drop what is never seen (engine internals under a shut bonnet, duplicate shells, a scene's floor)
let list = parts.filter(p => !(C.drop || []).some(re => re.test(label(p))));
// copy one side's part onto the other (e.g. a door the source has open: mirror the shut one)
for (const m of C.mirror || []) {
  list = list.filter(p => !m.replace.test(label(p)));
  for (const p of list.filter(p => m.from.test(label(p)))) {
    const q = { ...p, path: p.path.replace(m.renameFrom, m.renameTo), pos: p.pos.slice(), nrm: p.nrm?.slice(), idx: p.idx.slice() };
    for (let i = 0; i < q.pos.length; i += 3) { q.pos[i] = 2 * (m.x || 0) - q.pos[i]; if (q.nrm) q.nrm[i] = -q.nrm[i]; }
    for (let t = 0; t < q.idx.length; t += 3) { const x = q.idx[t + 1]; q.idx[t + 1] = q.idx[t + 2]; q.idx[t + 2] = x; }
    list.push(q);
  }
}
// centre: x on the car's middle, the axles' midpoint at z = 0, the lowest tire point on y = 0
{
  const all = bounds(list), wl = list.filter(p => C.spin.test(label(p))), wb = bounds(wl);
  const fr = wl.map(p => subset(p, (a, b, c) => triCentre(p, a, b, c, [0, 0, 0])[2] > wb.c[2])).filter(Boolean), rr = wl.map(p => subset(p, (a, b, c) => triCentre(p, a, b, c, [0, 0, 0])[2] <= wb.c[2])).filter(Boolean);
  const zF = bounds(fr).c[2], zR = bounds(rr).c[2], off = [-all.c[0], -wb.mn[1], -(zF + zR) / 2];
  for (const p of new Set(list.map(p => p.pos))) for (let i = 0; i < p.length; i += 3) { p[i] += off[0]; p[i + 1] += off[1]; p[i + 2] += off[2]; }
}

// --probe minx,miny,minz,maxx,maxy,maxz: the connected pieces inside that box (to find a steering wheel)
if (arg('--probe')) {
  const v = arg('--probe').split(',').map(Number), mn = v.slice(0, 3), mx = v.slice(3);
  const inBox = (p, a, b, c) => { triCentre(p, a, b, c, tc0); return tc0.every((x, j) => x >= mn[j] && x <= mx[j]); }, tc0 = [0, 0, 0];
  for (const p of list) {
    const s = subset(p, (a, b, c) => inBox(p, a, b, c)); if (!s) continue;
    const w = weld({ ...s, nrm: null, uv: null }), n = w.pos.length / 3, par = Int32Array.from({ length: n }, (_, i) => i);
    const find = i => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; };
    for (let t = 0; t < w.idx.length; t += 3) { const a = find(w.idx[t]); par[find(w.idx[t + 1])] = a; par[find(w.idx[t + 2])] = a; }
    const comps = new Map();
    for (let t = 0; t < w.idx.length; t += 3) { const r = find(w.idx[t]); if (!comps.has(r)) comps.set(r, []); comps.get(r).push(t); }
    for (const [r, ts] of comps) {
      const sub = subset(w, (a, b, c) => find(a) === r), b = bounds([sub]);
      if (ts.length < 20) continue;
      console.log(label(p).padEnd(70), String(ts.length).padStart(6), 'tris  c', b.c.map(x => x.toFixed(3)).join(','), ' size', b.s.map(x => x.toFixed(3)).join(','));
    }
  }
  process.exit(0);
}

const tc = [0, 0, 0];
// a window the source left out: a pane of an existing material. half: its outline up one side, [x, y, z] in the sim's
// axes from the bottom to the top (x > 0), mirrored for the other side and filled from its middle
for (const f of C.panes || []) {
  const mat = [...mats].find(([, m]) => f.like.test(m.name))?.[0]; if (!mat) throw new Error(`panes: no material like ${f.like}`);
  const pts = [...f.half, ...f.half.slice().reverse().map(([x, y, z]) => [-x, y, z])], n = pts.length;
  const c = [0, 1, 2].map(j => pts.reduce((a, q) => a + q[j], 0) / n), pos = new Float32Array((n + 1) * 3), idx = new Uint32Array(n * 3);
  pts.forEach((q, i) => pos.set(q, i * 3)); pos.set(c, n * 3);
  for (let i = 0; i < n; i++) idx.set([i, (i + 1) % n, n], i * 3);
  list.push({ name: 'pane', path: '/pane', pos, nrm: null, uv: null, idx, mat });
}
// one material for several things (all the glass: windows, lamp covers): the triangles in a box get a copy under another name
for (const r of C.split || []) {
  const [mn, mx] = r.box || [[-99, -99, -99], [99, 99, 99]], inBox = (p, a, b, c) => { triCentre(p, a, b, c, tc); if (r.sym) tc[0] = Math.abs(tc[0]); return tc.every((x, j) => x >= mn[j] && x <= mx[j]); };
  for (const p of list.slice()) {
    const m = mats.get(p.mat); if (!m || !r.mat.test(m.name) || (r.path && !r.path.test(p.path))) continue;
    const id = p.mat + ':' + r.name; if (!mats.has(id)) mats.set(id, { ...m, name: r.name });
    const inside = subset(p, (a, b, c) => inBox(p, a, b, c)), rest = subset(p, (a, b, c) => !inBox(p, a, b, c));
    list.splice(list.indexOf(p), 1, ...[rest, inside && { ...inside, mat: id }].filter(Boolean));
  }
}
// a body whose colour is painted into its texture (one atlas: paint, lamps, grilles): the triangles whose texels all pass
// the test become a plain material of that name (the paint, which the sim can then recolour), the rest keep the texture
for (const r of C.texSplit || []) {
  const px = new Map();
  for (const p of list.slice()) {
    const m = mats.get(p.mat); if (!m || !r.mat.test(m.name) || !m.map || !p.uv) continue;
    if (!px.has(m.map)) px.set(m.map, await sharp(imgs.get(m.map).bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true }));
    const { data, info } = px.get(m.map), W = info.width, H = info.height, wrap = x => x - Math.floor(x);
    const at = (u, v) => { const o = (Math.min(H - 1, wrap(C.kind === 'fbx' ? 1 - v : v) * H | 0) * W + Math.min(W - 1, wrap(u) * W | 0)) * 3; return r.test(data[o], data[o + 1], data[o + 2]); };
    const BARY = [[1 / 3, 1 / 3, 1 / 3], [0.7, 0.15, 0.15], [0.15, 0.7, 0.15], [0.15, 0.15, 0.7], [0.45, 0.45, 0.1], [0.1, 0.45, 0.45], [0.45, 0.1, 0.45]];
    const plain = (a, b, c) => BARY.every(([x, y, z]) => at(p.uv[a * 2] * x + p.uv[b * 2] * y + p.uv[c * 2] * z, p.uv[a * 2 + 1] * x + p.uv[b * 2 + 1] * y + p.uv[c * 2 + 1] * z));
    const id = p.mat + ':' + r.name; if (!mats.has(id)) mats.set(id, { ...m, name: r.name, map: null, normalMap: null });
    const yes = subset(p, plain), no = subset(p, (a, b, c) => !plain(a, b, c));
    list.splice(list.indexOf(p), 1, ...[no, yes && { ...yes, mat: id, uv: null }].filter(Boolean));
  }
}
// a material used front and back (one lights texture): its rear half becomes a material of its own (the brake lights)
for (const r of C.rearMat || []) {
  for (const p of list.slice()) {
    const m = mats.get(p.mat); if (!m || !r.match.test(m.name)) continue;
    const id = p.mat + 'r'; if (!mats.has(id)) mats.set(id, { ...m, name: r.name });
    const back = subset(p, (a, b, c) => triCentre(p, a, b, c, tc)[2] < 0), front = subset(p, (a, b, c) => triCentre(p, a, b, c, tc)[2] >= 0);
    list.splice(list.indexOf(p), 1, ...[front, back && { ...back, mat: id }].filter(Boolean));
  }
}

/* ---------------------------------------------------------------- 2. sort into the sim's nodes */
const nodes = new Map();      // name → { parts: [], pivot: [x, y, z], axis?: [x, y, z] }
const put = (name, p) => { if (!nodes.has(name)) nodes.set(name, { parts: [] }); nodes.get(name).parts.push(p); };
const wheelOf = (x, z) => (x > 0 ? 'L' : 'R') + (z > 0 ? 'F' : 'B');
for (const p of list) {
  const l = label(p);
  if (C.spin.test(l) || C.stat?.test(l)) {          // split by wheel: which corner each triangle is in
    const pre = C.stat?.test(l) ? 'stat' : 'spin';
    for (const w of ['LF', 'RF', 'LB', 'RB']) { const s = subset(p, (a, b, c) => { triCentre(p, a, b, c, tc); return wheelOf(tc[0], tc[2]) === w; }); if (s) put(pre + w, s); }
    continue;
  }
  const part = (C.parts || []).find(([re]) => re.test(l));
  let rest = p;
  if (C.steer && (C.steer.match ? C.steer.match.test(l) : true) && C.steer.box) {    // the steering wheel: the connected pieces wholly inside its box
    const [mn, mx] = C.steer.box, comp = components(p), inside = new Set();
    for (const [r, b] of comp.boxes) if (b.mn.every((x, j) => x >= mn[j]) && b.mx.every((x, j) => x <= mx[j])) inside.add(r);
    const inBox = (a, b, c) => inside.has(comp.of(a));
    const s = inside.size && subset(p, inBox); if (s) { put('steer', s); rest = subset(p, (a, b, c) => !inBox(a, b, c)); if (!rest) continue; }
  } else if (C.steer?.match && C.steer.match.test(l)) { put('steer', p); continue; }
  if (part && part[1].endsWith('_*')) {      // one mesh for both sides (the two mirrors): a part each
    for (const side of ['l', 'r']) { const h = subset(rest, (a, b, c) => (triCentre(rest, a, b, c, tc)[0] > 0) === (side === 'l')); if (h) put('part_' + part[1].slice(0, -1) + side, h); }
    continue;
  }
  put(part ? 'part_' + part[1] : 'body', rest);
}
// pivots: the wheels' hubs; a part's middle; the steering wheel's hub and column
const hubs = {};
for (const w of ['LF', 'RF', 'LB', 'RB']) {
  const b = bounds(nodes.get('spin' + w).parts);
  hubs[w] = [b.c[0], b.c[1], b.c[2]];
  nodes.get('spin' + w).pivot = hubs[w];
  if (nodes.has('stat' + w)) nodes.get('stat' + w).pivot = hubs[w];
}
for (const [n, N] of nodes) if (!N.pivot) N.pivot = n === 'body' ? [0, 0, 0] : bounds(N.parts).c;
if (nodes.has('steer')) {
  const N = nodes.get('steer'), b = bounds(N.parts);
  N.pivot = C.steer.centre || b.c;
  // the column: the steering wheel's rim lies in a plane, its normal is the axis (towards the driver = up the column)
  N.axis = C.steer.axis || (() => {
    let cov = new Array(9).fill(0), n = 0; const c = N.pivot;
    for (const p of N.parts) for (const k of p.idx) { const d = [p.pos[k * 3] - c[0], p.pos[k * 3 + 1] - c[1], p.pos[k * 3 + 2] - c[2]]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i * 3 + j] += d[i] * d[j]; n++; }
    // smallest-variance direction by inverse power iteration
    const M = new THREE.Matrix3().fromArray(cov).invert(); let v = new THREE.Vector3(0, 0.6, -0.8);
    for (let i = 0; i < 50; i++) v.applyMatrix3(M).normalize();
    if (v.y < 0) v.negate();
    return v.toArray();
  })();
}

/* ---------------------------------------------------------------- 3. materials the sim understands (by name) */
for (const [id, m] of mats) {
  const rule = (C.mats || []).find(([re]) => re.test(m.name));
  if (rule) {
    const o = rule[1];
    if (o.name) m.name = typeof o.name === 'function' ? o.name(m.name) : o.name;
    if (o.color != null) m.color = new THREE.Color(o.color).toArray();
    for (const k of ['metal', 'rough', 'alpha', 'blend', 'mask', 'doubleSided']) if (o[k] != null) m[k] = o[k];
    if (o.emissive != null) m.emissive = new THREE.Color(o.emissive).toArray();
    if (o.map === false) m.map = null;
    if (o.normalMap === false) m.normalMap = null;
    for (const k of ['map', 'normalMap', 'emissiveMap']) if (typeof o[k] === 'string') { const f = path.resolve(path.dirname(SRC), o[k]); m[k] = addImg(fs.readFileSync(f), /\.png$/i.test(f) ? 'image/png' : 'image/jpeg'); }
  }
}

/* ---------------------------------------------------------------- 4. lighter: simplify, merge by material */
await MeshoptSimplifier.ready;
const before = [...nodes.values()].reduce((a, N) => a + N.parts.reduce((b, p) => b + p.idx.length / 3, 0), 0);
for (const [n, N] of nodes) {
  const r = (C.ratio && (C.ratio[n] ?? C.ratio[n.replace(/[LR][FB]$/, '')] ?? C.ratio.all)) ?? 1;
  const looseOf = p => (C.loose || []).find(([re]) => re.test(label(p)));
  if (C.merge) {      // a model in hundreds of small meshes: one per material (and kind of simplifying), or none is big enough to simplify
    const by = new Map(); for (const p of N.parts) { const k = p.mat + '|' + (C.loose || []).indexOf(looseOf(p)); if (!by.has(k)) by.set(k, []); by.get(k).push(p); }
    N.parts = [...by.values()].map(ps => {
      if (ps.length === 1) return ps[0];
      const nv = ps.reduce((a, p) => a + p.pos.length / 3, 0), pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), uv = ps.some(p => p.uv) ? new Float32Array(nv * 2) : null, idx = [];
      let o = 0; for (const p of ps) { if (!p.nrm) computeNormals(p); pos.set(p.pos, o * 3); nrm.set(p.nrm, o * 3); if (p.uv) uv.set(p.uv, o * 2); for (const k of p.idx) idx.push(k + o); o += p.pos.length / 3; }
      return { ...ps[0], pos, nrm, uv, idx: Uint32Array.from(idx) };
    });
  }
  N.parts = N.parts.map(p => { const l = looseOf(p); return l ? simplify(p, l[1], l[2] ?? 0.01, true) : simplify(p, r, C.error ?? 0.002); });
}
const after = [...nodes.values()].reduce((a, N) => a + N.parts.reduce((b, p) => b + p.idx.length / 3, 0), 0);
console.log(`triangles ${before | 0} → ${after | 0}`);

/* ---------------------------------------------------------------- 5. write the glTF */
const doc = new Document(), buf = doc.createBuffer(), scene = doc.createScene();
const texOf = new Map(), matOut = new Map();
async function texture(id, kind) {
  if (!id) return null;
  const k = id + kind; if (texOf.has(k)) return texOf.get(k);
  const im = imgs.get(id), max = C.texMax?.[kind] ?? C.texMax?.all ?? 512;
  let s = sharp(im.bytes); const meta = await s.metadata();
  const size = Math.min(max, Math.max(meta.width, meta.height));
  s = s.resize(size, size, { fit: 'fill' });
  const alpha = kind === 'map' && meta.hasAlpha && (await sharp(im.bytes).stats()).channels[3]?.min < 250;
  const bytes = alpha ? await s.png({ compressionLevel: 9, palette: false }).toBuffer() : await s.jpeg({ quality: kind === 'normalMap' ? 90 : 84 }).toBuffer();
  const t = doc.createTexture(id + kind).setImage(bytes).setMimeType(alpha ? 'image/png' : 'image/jpeg');
  texOf.set(k, t); return t;
}
async function material(id) {
  if (matOut.has(id)) return matOut.get(id);
  const m = mats.get(id) || { name: 'none', color: [0.5, 0.5, 0.5], alpha: 1, metal: 0, rough: 0.8, emissive: [0, 0, 0] };
  const o = doc.createMaterial(m.name).setBaseColorFactor([...m.color, m.alpha ?? 1]).setMetallicFactor(m.metal ?? 0).setRoughnessFactor(m.rough ?? 0.8)
    .setEmissiveFactor(m.emissive || [0, 0, 0]).setDoubleSided(!!m.doubleSided).setAlphaMode(m.mask ? 'MASK' : m.blend || (m.alpha ?? 1) < 1 ? 'BLEND' : 'OPAQUE');
  const bt = await texture(m.map, 'map'); if (bt) o.setBaseColorTexture(bt);
  const nt = await texture(m.normalMap, 'normalMap'); if (nt) o.setNormalTexture(nt);
  const et = await texture(m.emissiveMap, 'emissiveMap'); if (et) o.setEmissiveTexture(et);
  matOut.set(id, o); return o;
}
const acc = (arr, type) => doc.createAccessor().setArray(arr).setType(type).setBuffer(buf);
const out = { hubs, nodes: {} };
for (const [n, N] of [...nodes].sort(([a], [b]) => a < b ? -1 : 1)) {
  const node = doc.createNode(n).setTranslation(N.pivot), mesh = doc.createMesh(n), c = N.pivot;
  let rot = null;
  if (N.axis) {     // local +y along the column
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...N.axis));
    node.setRotation(q.toArray()); rot = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q.invert()));
  }
  const byMat = new Map(); for (const p of N.parts) { if (!byMat.has(p.mat)) byMat.set(p.mat, []); byMat.get(p.mat).push(p); }
  const v = new THREE.Vector3();
  for (const [mid, ps] of byMat) {
    const nv = ps.reduce((a, p) => a + p.pos.length / 3, 0), ni = ps.reduce((a, p) => a + p.idx.length, 0), hasUv = ps.some(p => p.uv);
    const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), uv = hasUv ? new Float32Array(nv * 2) : null, idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let o = 0, oi = 0;
    for (const p of ps) {
      if (!p.nrm) computeNormals(p);
      const k = p.pos.length / 3;
      for (let i = 0; i < k; i++) {
        v.set(p.pos[i * 3] - c[0], p.pos[i * 3 + 1] - c[1], p.pos[i * 3 + 2] - c[2]); if (rot) v.applyMatrix3(rot); v.toArray(pos, (o + i) * 3);
        v.fromArray(p.nrm, i * 3); if (rot) v.applyMatrix3(rot); v.toArray(nrm, (o + i) * 3);
      }
      if (uv) { if (p.uv) uv.set(p.uv, o * 2); }
      for (let t = 0; t < p.idx.length; t++) idx[oi + t] = p.idx[t] + o;
      o += k; oi += p.idx.length;
    }
    // glTF UVs: v flipped from the FBX convention
    if (uv && C.kind === 'fbx') for (let i = 1; i < uv.length; i += 2) uv[i] = 1 - uv[i];
    const prim = doc.createPrimitive().setAttribute('POSITION', acc(pos, 'VEC3')).setAttribute('NORMAL', acc(nrm, 'VEC3')).setIndices(acc(idx, 'SCALAR')).setMaterial(await material(mid));
    if (uv) prim.setAttribute('TEXCOORD_0', acc(uv, 'VEC2'));
    mesh.addPrimitive(prim);
  }
  node.setMesh(mesh); scene.addChild(node);
  const b = bounds(N.parts); out.nodes[n] = { tris: N.parts.reduce((a, p) => a + p.idx.length / 3, 0), min: b.mn.map(x => +x.toFixed(3)), max: b.mx.map(x => +x.toFixed(3)) };
}
const glb = Buffer.from(await new NodeIO().registerExtensions(ALL_EXTENSIONS).writeBinary(doc));
fs.mkdirSync(OUT, { recursive: true });
const gz = zlib.gzipSync(glb, { level: 9 });
fs.writeFileSync(path.join(OUT, key + '.glb.gz'), gz);
if (process.argv.includes('--keep')) fs.writeFileSync(path.join(OUT, key + '.glb'), glb);
console.log(`wrote ${path.join(OUT, key + '.glb.gz')}: ${(glb.length / 1e6).toFixed(1)} MB, ${(gz.length / 1e6).toFixed(1)} MB gzipped`);

/* ---------------------------------------------------------------- 6. what engine.js needs */
// MODELS entry, dimensions, and the built-in body's profiles (s = 0 at the front bumper, 1 at the
// back; heights above the ground): the sim's collision hull and its fallback body come from these
{
  const h = hubs, r3 = x => +x.toFixed(3), mname = p => mats.get(p.mat)?.name || '';
  const shell = [...nodes].filter(([n]) => n === 'body' || /^part_(bumper|hood|tailgate|door|fender|spoiler)/.test(n)).flatMap(([, N]) => N.parts);
  const outer = shell.filter(p => !/^int_|^INT_|Cabin|Dashboard|Leather|Suede|Belt|Carpet|seat/i.test(mname(p) + p.path));
  const glass = outer.filter(p => /glass|window/i.test(mname(p)) && !/light|lamp|mirror|lens/i.test(mname(p)));
  const B = bounds(outer), zF = (h.LF[2] + h.RF[2]) / 2, zR = (h.LB[2] + h.RB[2]) / 2, hubY = (h.LF[1] + h.RF[1] + h.LB[1] + h.RB[1]) / 4;
  const tire = bounds(nodes.get('spinLF').parts), zMax = B.mx[2], L = B.s[2];
  const verts = (list, f) => { for (const p of list) { const seen = new Uint8Array(p.pos.length / 3); for (const k of p.idx) { if (seen[k]) continue; seen[k] = 1; f(p.pos[k * 3], p.pos[k * 3 + 1], (zMax - p.pos[k * 3 + 2]) / L); } } };
  // cross-sections: where the triangles cut the plane z of each station (low-poly bodies have few vertices)
  const NS = 40, S = Array.from({ length: NS + 1 }, () => ({ t: 0, b: 9, g: 9, gt: 0, gw: 0, w: [] }));
  const cutAll = (list, f) => {
    for (const p of list) for (let t = 0; t < p.idx.length; t += 3) {
      const v = [0, 1, 2].map(j => p.idx[t + j]), z = v.map(k => p.pos[k * 3 + 2]), lo = Math.min(...z), hi = Math.max(...z);
      const i0 = Math.ceil(((zMax - hi) / L - 0.01) / 0.98 * NS), i1 = Math.floor(((zMax - lo) / L - 0.01) / 0.98 * NS);
      for (let i = Math.max(0, i0); i <= Math.min(NS, i1); i++) {
        const zc = zMax - (0.01 + 0.98 * i / NS) * L;     // just inside the bumpers at the ends
        for (let e = 0; e < 3; e++) {
          const a = v[e], b = v[(e + 1) % 3], za = p.pos[a * 3 + 2], zb = p.pos[b * 3 + 2];
          if ((za - zc) * (zb - zc) > 0 || za === zb) continue;
          const u = (zc - za) / (zb - za); f(i, p.pos[a * 3] + (p.pos[b * 3] - p.pos[a * 3]) * u, p.pos[a * 3 + 1] + (p.pos[b * 3 + 1] - p.pos[a * 3 + 1]) * u);
        }
      }
    }
  };
  cutAll(outer, (i, x, y) => { const c = S[i]; c.t = Math.max(c.t, y); c.b = Math.min(c.b, y); c.w.push([Math.abs(x), y]); });
  cutAll(glass, (i, x, y) => { const c = S[i]; c.g = Math.min(c.g, y); c.gt = Math.max(c.gt, y); c.gw = Math.max(c.gw, Math.abs(x)); });
  const withGlass = S.map((c, i) => c.g < 9 ? i : -1).filter(i => i >= 0), i0 = withGlass[0], i1 = withGlass[withGlass.length - 1];
  // the beltline: the glass's lower edge, carried flat to the ends (bonnet and boot lid height, if lower)
  const beltAt = i => S[clamp(i, i0, i1)].g;
  const prof = S.map((c, i) => {
    const s = i / NS, belt = Math.min(beltAt(i), c.t);
    const w = c.w.reduce((a, [x, y]) => y < belt - 0.03 ? Math.max(a, x) : a, 0) || c.w.reduce((a, [x]) => Math.max(a, x), 0);    // below the windows: no mirrors
    return { s: r3(s), top: r3(c.t), bot: r3(c.b), belt: r3(belt), w: r3(w) };
  });
  const mid = S[Math.round((i0 + i1) / 2)], roofW = mid.w.reduce((a, [x, y]) => y > mid.t - 0.06 ? Math.max(a, x) : a, 0);
  const wMax = Math.max(...prof.map(p => p.w));
  // the side windows' outline (distance from the front, height): the hull of the outer glass seen from the side
  const pts = []; verts(glass, (x, y, s) => { if (Math.abs(x) > 0.75 * wMax) pts.push([s * L, y]); });
  const hull = (P => { P.sort((a, b) => a[0] - b[0] || a[1] - b[1]); const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); const lo = [], up = [];
    for (const p of P) { while (lo.length > 1 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (const p of P.slice().reverse()) { while (up.length > 1 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    return lo.slice(0, -1).concat(up.slice(0, -1)); })(pts);
  const simp = (P, n) => { P = P.slice(); while (P.length > n) { let bi = 0, bv = Infinity; for (let i = 0; i < P.length; i++) { const a = P[(i - 1 + P.length) % P.length], b = P[i], c = P[(i + 1) % P.length], ar = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])); if (ar < bv) { bv = ar; bi = i; } } P.splice(bi, 1); } return P.map(p => p.map(r3)); };
  const dlo = hull.length > 3 ? simp(hull, 7) : null;
  // windscreen and rear window seen from above (x, distance from the front): the central glass at either end of the cabin
  const scr = (s0, s1) => { let d0 = Infinity, d1 = -Infinity, w0 = 0, w1 = 0; verts(glass, (x, y, s) => { if (Math.abs(x) < 0.75 * wMax && s >= s0 && s <= s1) { d0 = Math.min(d0, s * L); d1 = Math.max(d1, s * L); } });
    verts(glass, (x, y, s) => { if (Math.abs(x) < 0.75 * wMax) { if (Math.abs(s * L - d0) < 0.08) w0 = Math.max(w0, Math.abs(x)); if (Math.abs(s * L - d1) < 0.08) w1 = Math.max(w1, Math.abs(x)); } });
    return d0 < Infinity ? [[-w0, d0], [w0, d0], [w1, d1], [-w1, d1]].map(p => p.map(r3)) : null; };
  const sF = i0 / NS, sB = i1 / NS, cut = (sF + sB) / 2;
  const mirror = nodes.has('part_mirror_l') ? (b => ({ d: r3(zMax - b.c[2]), h: r3(b.c[1]) }))(bounds(nodes.get('part_mirror_l').parts)) : { d: r3((sF + 0.04) * L), h: r3(beltAt(i0 + 2) + 0.06) };
  const steer = nodes.get('steer');
  const pick = (k, every = 2) => prof.filter((_, i) => i % every === 0 || i === NS).map(p => [p.s, p[k]]);
  // the underside: through the wheel arches a section has no floor, leave those stations out
  const botT = pick('bot').filter(([, y], i, A) => i === 0 || i === A.length - 1 || y < Math.min(...A.map(q => q[1])) + 0.2);
  const print = {
    MODELS: { hubY: r3(hubY), zF: r3(zF), zR: r3(zR) },
    dims: { L: r3(L), fo: r3(zMax - zF), wb: r3(zF - zR), ro: r3(zR - B.mn[2]), trackF: r3(h.LF[0] - h.RF[0]), trackR: r3(h.LB[0] - h.RB[0]), tireR: r3(hubY), tireW: r3(tire.s[0]), H: r3(B.mx[1]), W: r3(2 * wMax) },
    steer: steer ? { centre: steer.pivot.map(r3), axis: steer.axis.map(r3) } : null,
    spec: { top: pick('top'), bot: botT, belt: pick('belt', 4), halfW: pick('w'), greenW: r3(roofW / wMax), cab: { ws: r3(sF), bk: r3(sB) },
      dlo, panes: dlo ? [dlo] : [], windshield: scr(sF - 0.02, cut), backlight: scr(cut, sB + 0.02), mirror },
    nodes: out.nodes,
  };
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(path.join(CACHE, `${key}.json`), JSON.stringify(print, null, 1));
  console.log(JSON.stringify({ MODELS: print.MODELS, dims: print.dims, steer: print.steer }));
}
