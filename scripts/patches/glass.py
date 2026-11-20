# Glass (ticket #295): every car's glass is found (by name, and by what it is: transmission or a
# see-through blend), split into panes and typed by where each sits: the windscreen (laminated: it
# cracks in a web round the hit and stays), side, rear and roof glass (tempered: it bursts into small
# cubes and leaves the frame empty), head and tail lamp lenses (they shatter), mirrors and the buggy's
# deflector (they crack). A pane breaks from the load of a hit near it, or when the body around it
# bends; it rides on bodyHit, so the same hits break the same panes on every copy of a car (ours,
# the bots', the other players'), and repairBody mends them. Glass breaking has its own sound.
# Applies to public/sim/engine.js after the other patches (... damage, freelook):
#   python3 scripts/patches/glass.py <dir with engine.js>
import sys, os
d = sys.argv[1]
ep = os.path.join(d, 'engine.js')
s = open(ep).read()

def rep(a, b):
    global s
    n = s.count(a)
    assert n == 1, (n, a[:140])
    s = s.replace(a, b)

# ---------------------------------------------------------------- finding the glass of the detailed models
rep("""      const n = m.name;
      if ('transmission' in m) m.transmission = 0;""", """      const n = m.name, glassy = isGlassMat(m);        // before transmission and opacity are touched
      if ('transmission' in m) m.transmission = 0;""")
rep("""      if (!/glass|lens|window/i.test(n)) { m.transparent = false;""", """      if (!glassy) { m.transparent = false;""")
rep("""      else if (/glass|lens|window/i.test(n)) {
        const lamp = /head|rear|tail|lens|projector|subglass|glass_light/i.test(n);""", """      else if (glassy) {
        const lamp = /head|rear|tail|lens|projector|subglass|glass_light/i.test(n);
        m.userData.sbGlass = /tail|rear_?light|red_glass|brake/i.test(n) ? 'tail' : /mirror/i.test(n) ? 'mirror' : /head|lens|projector|glass_light|lamp|subglass/i.test(n) ? 'lamp' : 'window';""")
rep("""  V.dentables = null;
  V.paintMats = pm;""", """  V.dentables = null; V.glass = null;
  V.paintMats = pm;""")
rep("""  const sw = root.getObjectByName('steer'); if (sw) V.steerNode = { o: sw, q0: sw.quaternion.clone() };
}""", """  const sw = root.getObjectByName('steer'); if (sw) V.steerNode = { o: sw, q0: sw.quaternion.clone() };
  glassOf(V);                                  // its panes now, not at the first hit
}""")
# the built-in bodies' glass and the buggy's deflector, by name
rep("""    glass: new THREE.MeshPhysicalMaterial({ color: 0x0a0d11, roughness: 0.04,""", """    glass: new THREE.MeshPhysicalMaterial({ name: 'glass', color: 0x0a0d11, roughness: 0.04,""")
rep("""  const glass = new THREE.MeshPhysicalMaterial({ color: 0x223040,""", """  const glass = new THREE.MeshPhysicalMaterial({ name: 'deflector glass', color: 0x223040,""")

# ---------------------------------------------------------------- hits break it, repairs mend it
rep("""  if (dir.lengthSq() < 1e-6) return; dir.normalize();
  dentBody(V, c, dir, vn, kind);
  hitParts(V, c, dir, vn, vel);""", """  if (dir.lengthSq() < 1e-6) return; dir.normalize();
  glassOf(V);
  dentBody(V, c, dir, vn, kind);
  glassHit(V, c, dir, vn, kind, vel);
  hitParts(V, c, dir, vn, vel);""")
rep("""    m.geometry.dispose(); m.geometry = o.geo; m.userData.orig = null;
  }
}""", """    m.geometry.dispose(); m.geometry = o.geo; m.userData.orig = null;
  }
  repairGlass(V);
}""")
rep("""function updateDebris(dt) {
""", """function updateDebris(dt) {
  updateGlass(dt);
""")

# ---------------------------------------------------------------- the glass itself
rep("""// a body as built: thrown parts back on, panels straight, dents out
""", r"""/* GLASS. isGlassMat finds it on any model: by name, or by what it is (glTF transmission, a see-through
   blend), not the dashboard's screens. glassOf(V) splits it into panes: its pieces (connected
   triangles) are typed by where they sit and face, low at the ends: lamps; above: windscreen, rear
   window, roof, side windows (one pane per big piece and the small ones nearest it); and grouped, so
   the inner and outer skins of a window are one pane. glassHit breaks them, from the load of the hit
   (its speed, fading to nothing 60 cm from the pane's nearest point) or the bending of the body around them (how unevenly
   the dents moved the pane). */
function isGlassMat(m) {
  const n = m.name || '';
  if (/display|dash|navscreen|gauge|decal/i.test(n)) return false;
  if (/glass|lens|window|windscreen|windshield/i.test(n)) return true;
  if ((m.transmission || 0) > 0.2) return true;
  return !!m.transparent && m.opacity < 0.9 && m.opacity > 0.02 && !/^INT_|paint|chrome|plastic|fabric|leather|carbon|rubber|metal|flame/i.test(n);
}
// how each kind of glass fails: laminated and plastic crack, tempered and lamp lenses burst; e: load (m/s), s: bending (m)
const GLASS_T = {
  screen: { crack: true, e: 5, s: 0.04, name: 'Windscreen cracked' }, mirror: { crack: true, e: 3.5, s: 0.03, name: 'mirror cracked' },
  side: { e: 7.5, s: 0.06, name: 'window smashed' }, rear: { e: 7.5, s: 0.06, name: 'Rear window smashed' }, roof: { e: 7.5, s: 0.06, name: 'Glass roof smashed' },
  lamp: { e: 4, s: 0.03, name: 'headlight broken' }, tail: { e: 4, s: 0.03, name: 'tail light broken' },
};
const gM = new THREE.Matrix4(), gA = new THREE.Vector3(), gB = new THREE.Vector3(), gC = new THREE.Vector3(), gD = new THREE.Vector3(), gN = new THREE.Vector3(), gQ = new THREE.Quaternion();
// triangles of a geometry → connected pieces (vertices welded at 1 mm: glTF splits them at seams)
function glassPieces(geo) {
  const pos = geo.attributes.position, idx = geo.index, nt = (idx ? idx.count : pos.count) / 3 | 0;
  const weld = new Int32Array(pos.count), seen = new Map();
  for (let i = 0; i < pos.count; i++) { const k = `${Math.round(pos.getX(i) * 1000)},${Math.round(pos.getY(i) * 1000)},${Math.round(pos.getZ(i) * 1000)}`; let w = seen.get(k); if (w === undefined) { w = seen.size; seen.set(k, w); } weld[i] = w; }
  const up = new Int32Array(seen.size); for (let i = 0; i < up.length; i++) up[i] = i;
  const find = a => { while (up[a] !== a) { up[a] = up[up[a]]; a = up[a]; } return a; };
  const vi = (t, k) => idx ? idx.getX(t * 3 + k) : t * 3 + k;
  for (let t = 0; t < nt; t++) { const a = find(weld[vi(t, 0)]), b = find(weld[vi(t, 1)]), c = find(weld[vi(t, 2)]); up[b] = a; up[find(c)] = a; }
  const comp = new Int32Array(nt), ids = new Map();
  for (let t = 0; t < nt; t++) { const r = find(weld[vi(t, 0)]); let id = ids.get(r); if (id === undefined) { id = ids.size; ids.set(r, id); } comp[t] = id; }
  return { comp, n: ids.size, nt, vi };
}
// a geometry with some of the triangles of another (attributes copied, unpacked to floats)
function subGeometry(geo, tris, vi) {
  const map = new Map(), order = [], index = [];
  for (const t of tris) for (let k = 0; k < 3; k++) { const v = vi(t, k); let m = map.get(v); if (m === undefined) { m = order.length; map.set(v, m); order.push(v); } index.push(m); }
  const out = new THREE.BufferGeometry(), get = ['getX', 'getY', 'getZ', 'getW'];
  for (const [name, a] of Object.entries(geo.attributes)) {
    const arr = new Float32Array(order.length * a.itemSize);
    for (let i = 0; i < order.length; i++) for (let c = 0; c < a.itemSize; c++) arr[i * a.itemSize + c] = a[get[c]](order[i]);
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  out.setIndex(index);
  return out;
}
// the shown meshes of a car (whether or not the car itself is shown: a model can load while it is hidden)
const shownIn = (root, cb) => { for (const ch of root.children) if (ch.visible) { cb(ch); shownIn(ch, cb); } };
function glassOf(V) {
  if (V.glass) return V.glass;
  const G = V.glass = [], meshes = [];
  shownIn(V.vis, o => { if (o.isMesh && !o.isInstancedMesh && !o.userData.sbCrack && !Array.isArray(o.material) && (o.material.userData.sbGlass || isGlassMat(o.material))) meshes.push(o); });
  if (!meshes.length) return G;
  // the body's height, from every mesh's box
  let y0 = Infinity, y1 = -Infinity; const bx = new THREE.Box3();
  shownIn(V.vis, o => { if (!o.isMesh || o.userData.sbCrack) return; if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); bx.copy(o.geometry.boundingBox).applyMatrix4(localIn(o, V.vis, gM)); y0 = Math.min(y0, bx.min.y); y1 = Math.max(y1, bx.max.y); });
  const H = y1 - y0, zF = V.box[1], zR = V.box[2], mid = (zF + zR) / 2, centre = new THREE.Vector3(0, y0 + H / 2, mid);
  const partObjs = new Set((V.parts || []).map(P => P.o));
  // its pieces: area, centre and facing in body space
  const pieces = [];
  for (const m of meshes) {
    localIn(m, V.vis, gM);
    const geo = m.geometry, pc = glassPieces(geo), pos = geo.attributes.position;
    const P = Array.from({ length: pc.n }, () => ({ m, tris: [], area: 0, c: new THREE.Vector3(), nsum: new THREE.Vector3(), big: 0, ref: null }));
    for (let t = 0; t < pc.nt; t++) {
      const p = P[pc.comp[t]];
      gA.fromBufferAttribute(pos, pc.vi(t, 0)).applyMatrix4(gM); gB.fromBufferAttribute(pos, pc.vi(t, 1)).applyMatrix4(gM); gC.fromBufferAttribute(pos, pc.vi(t, 2)).applyMatrix4(gM);
      gN.subVectors(gB, gA).cross(gD.subVectors(gC, gA)); const a2 = gN.length(); if (a2 < 1e-12) { p.tris.push(t); continue; }
      if (a2 > p.big) { p.big = a2; p.ref = gN.clone().divideScalar(a2); }
      gN.multiplyScalar(p.ref && gN.dot(p.ref) < 0 ? -1 : 1);       // a glass slab's two faces: one way
      p.tris.push(t); p.area += a2 / 2; p.nsum.add(gN); p.c.addScaledVector(gD.copy(gA).add(gB).add(gC), a2 / 6);
    }
    const hint = m.material.userData.sbGlass, inMirror = (() => { for (let o = m; o && o !== V.vis; o = o.parent) if (/mirror/i.test(o.name)) return true; return false; })();
    for (const p of P) {
      if (!p.tris.length) continue;
      if (p.area > 0) p.c.divideScalar(p.area); else { gA.fromBufferAttribute(pos, pc.vi(p.tris[0], 0)).applyMatrix4(gM); p.c.copy(gA); }
      const n = p.nsum.lengthSq() > 0 ? p.nsum.normalize() : gN.set(0, 1, 0).clone();
      if (n.dot(gA.subVectors(p.c, centre)) < 0) n.negate();
      p.n = n;
      const low = p.c.y < y0 + 0.66 * H, nearEnd = p.c.z > zF - 0.9 || p.c.z < zR + 0.9;
      p.type = /deflector/i.test(m.material.name) ? 'screen' : inMirror || hint === 'mirror' ? 'mirror'
        : hint === 'lamp' || hint === 'tail' ? (hint === 'tail' || p.c.z < mid ? 'tail' : 'lamp')
        : low && (nearEnd || p.c.y < y0 + 0.45 * H) ? (p.c.z > mid ? 'lamp' : 'tail')
        : Math.abs(n.x) > 0.55 ? 'side' : n.y > 0.85 && Math.abs(n.z) < 0.35 ? 'roof' : n.z > 0 ? 'screen' : 'rear';
      pieces.push(p);
    }
  }
  // panes: the windscreen, rear and roof one each; side windows one per big piece (inner and outer skins
  // together) and the small ones nearest it; lamps and mirrors one per side
  const sideOf = p => Math.abs(p.c.x) < 0.2 ? 'C' : p.c.x > 0 ? 'L' : 'R';
  const anchors = [];
  for (const p of pieces.filter(p => p.type === 'side' && p.area > 0.05).sort((a, b) => b.area - a.area)) {
    const a = anchors.find(q => sideOf(q) === sideOf(p) && q.c.distanceTo(p.c) < 0.2);
    p.slot = a ? a.slot : `side${anchors.push(p) - 1}`;
  }
  for (const p of pieces) {
    if (p.slot) continue;
    if (p.type === 'side') {
      let best = null, bd = 1.2; for (const a of anchors) if (sideOf(a) === sideOf(p)) { const dd = a.c.distanceTo(p.c); if (dd < bd) { bd = dd; best = a; } }
      p.slot = best ? best.slot : `side${sideOf(p)}${Math.round(p.c.z * 2)}`;
    } else p.slot = p.type === 'mirror' ? p.type + sideOf(p) : p.type === 'lamp' || p.type === 'tail' ? `${p.type}${sideOf(p)}${Math.round(p.c.z / 0.8)}` : p.type;
  }
  // a part's mesh (a door, a bumper) stays whole: it is one pane, of its biggest piece's kind
  for (const m of meshes) {
    if (!partObjs.has(m) && !/^part_/.test(m.name)) continue;
    const ps = pieces.filter(p => p.m === m); const top = ps.reduce((a, b) => (b.area > a.area ? b : a), ps[0]);
    for (const p of ps) { p.slot = top.slot + '@' + m.uuid; p.type = top.type; }
  }
  const panes = new Map();
  for (const p of pieces) { let P = panes.get(p.slot); if (!P) panes.set(p.slot, P = { slot: p.slot, type: p.type, pieces: [], meshes: [], area: 0, c: new THREE.Vector3(), n: new THREE.Vector3() }); P.pieces.push(p); P.area += p.area; P.c.addScaledVector(p.c, p.area); P.n.addScaledVector(p.n, p.area); }
  // one mesh per pane: a mesh holding several panes is split, one holding one is kept
  let split = false;
  for (const m of meshes) {
    const mine = [...panes.values()].filter(P => P.pieces.some(p => p.m === m));
    if (!mine.length) continue;
    if (mine.length === 1) { mine[0].meshes.push(m); m.userData.sbPane = true; continue; }
    const pc = glassPieces(m.geometry);
    for (const P of mine) {
      const tris = P.pieces.filter(p => p.m === m).flatMap(p => p.tris);
      const pm = new THREE.Mesh(subGeometry(m.geometry, tris, pc.vi), m.material);
      pm.name = `${m.name}_${P.slot}`; pm.position.copy(m.position); pm.quaternion.copy(m.quaternion); pm.scale.copy(m.scale);
      pm.castShadow = m.castShadow; pm.receiveShadow = m.receiveShadow; pm.renderOrder = m.renderOrder; pm.userData.sbPane = true;
      m.parent.add(pm); P.meshes.push(pm);
    }
    m.parent.remove(m); split = true;
  }
  if (split) V.dentables = null;
  // each pane's frame (for the cracks' texture: uv1 is the pane flattened onto its plane)
  for (const P of panes.values()) {
    if (P.area > 0) P.c.divideScalar(P.area); P.n.normalize(); if (P.n.lengthSq() < 0.5) P.n.set(0, 0, 1);
    P.t1 = new THREE.Vector3().crossVectors(Math.abs(P.n.y) > 0.9 ? gA.set(0, 0, 1) : gA.set(0, 1, 0), P.n).normalize(); P.t2 = new THREE.Vector3().crossVectors(P.n, P.t1);
    let R = 0.05;
    for (const m of P.meshes) { localIn(m, V.vis, gM); const pos = m.geometry.attributes.position; for (let i = 0; i < pos.count; i++) R = Math.max(R, gA.fromBufferAttribute(pos, i).applyMatrix4(gM).distanceTo(P.c)); }
    for (const m of P.meshes) {
      localIn(m, V.vis, gM); const pos = m.geometry.attributes.position, uv = new Float32Array(pos.count * 2);
      for (let i = 0; i < pos.count; i++) { gA.fromBufferAttribute(pos, i).applyMatrix4(gM).sub(P.c); uv[i * 2] = gA.dot(P.t1) / (2 * R) + 0.5; uv[i * 2 + 1] = gA.dot(P.t2) / (2 * R) + 0.5; }
      m.geometry.setAttribute('uv1', new THREE.BufferAttribute(uv, 2));
    }
    Object.assign(P, { R, state: 0, cracks: 0, crack: null, overlays: [] });
    delete P.pieces;
    G.push(P);
  }
  return G;
}
// how far a hit was from a pane (m): its nearest vertex as built (the dent this hit made has already pushed it away), a post: across the ground only
function paneDist(V, P, c, post) {
  gD.subVectors(P.c, c); if (post) gD.y = 0;
  if (gD.length() - P.R > 0.7) return 1;
  let best = Infinity;
  for (const m of P.meshes) {
    localIn(m, V.vis, gM); const pos = (m.userData.orig?.geo ?? m.geometry).attributes.position;
    for (let i = 0; i < pos.count; i++) { gA.fromBufferAttribute(pos, i).applyMatrix4(gM).sub(c); if (post) gA.y = 0; best = Math.min(best, gA.lengthSq()); }
  }
  return Math.sqrt(best);
}
// how unevenly the dents have moved a pane (m): its vertices' moves less their mean move
function paneStrain(V, P) {
  let worst = 0;
  for (const m of P.meshes) {
    const o = m.userData.orig; if (!o) continue;
    localIn(m, V.vis, gM);
    const pos = m.geometry.attributes.position, p0 = o.geo.attributes.position, n = pos.count, mean = gC.set(0, 0, 0);
    for (let i = 0; i < n; i++) mean.add(gA.fromBufferAttribute(pos, i).applyMatrix4(gM).sub(gB.fromBufferAttribute(p0, i).applyMatrix4(gM)));
    mean.divideScalar(Math.max(1, n));
    for (let i = 0; i < n; i++) worst = Math.max(worst, gA.fromBufferAttribute(pos, i).applyMatrix4(gM).sub(gB.fromBufferAttribute(p0, i).applyMatrix4(gM)).sub(mean).length());
  }
  return worst;
}
function glassHit(V, c, dir, vn, kind, vel) {
  const G = glassOf(V); if (!G.length || vn < 1.5) return;
  const said = []; let noise = 0;
  for (const P of G) {
    if (P.state === 2 || P.meshes.every(m => m.userData.loose)) continue;      // smashed, or gone with its door
    const d = paneDist(V, P, c, kind === HIT.post), e = vn * (1 - sstep(0.05, 0.6, d)), T = GLASS_T[P.type];
    for (const ov of P.overlays) ov.geometry = ov.parent.geometry;             // cracks follow the dents
    if (e <= T.e && paneStrain(V, P) <= T.s) continue;
    const side = P.c.x > 0 ? 'Left' : 'Right';
    if (T.crack) { if (P.cracks >= 6) continue; crackPane(P, c, e / T.e); noise += 0.25; if (P.cracks === 1) said.push(P.type === 'screen' ? T.name : `${side} ${T.name}`); }
    else { shatterPane(V, P, dir, vel, e); noise += P.type === 'lamp' || P.type === 'tail' ? 0.3 : 0.7; said.push(P.type === 'side' || P.type === 'lamp' || P.type === 'tail' ? `${side} ${T.name}` : T.name); }
  }
  if (!noise) return;
  const near = V === VEH ? 1 : 1 / (1 + V.vis.position.distanceTo(car.pos) / 8);
  if (near > 0.05) audio?.node.port.postMessage({ glass: Math.min(1.2, noise * near) });
  if (V === VEH && said.length) flash(said.join(' · '), '#cfe8ff', 2.4);
}
// a web of cracks round where it was hit: radial cracks, rings across them, a crushed core
let glassSeed = 1;
const glassRnd = () => { glassSeed = (glassSeed + 0x6D2B79F5) | 0; let t = glassSeed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
function crackPane(P, c, load) {
  const W = 512;
  if (!P.crack) {
    const cv = document.createElement('canvas'); cv.width = cv.height = W;
    const tex = new THREE.CanvasTexture(cv); tex.channel = 1; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    P.crack = { cv, ctx: cv.getContext('2d'), tex, mat };
    for (const m of P.meshes) { const ov = new THREE.Mesh(m.geometry, mat); ov.userData.sbCrack = true; ov.renderOrder = (m.renderOrder || 0) + 1; m.add(ov); P.overlays.push(ov); }
  }
  // where on the pane (the nearest point of it if the hit was off it), and how far the web runs
  gA.subVectors(c, P.c);
  const u = clamp(gA.dot(P.t1) / (2 * P.R) + 0.5, 0.08, 0.92), v = clamp(gA.dot(P.t2) / (2 * P.R) + 0.5, 0.08, 0.92);
  glassSeed = Math.floor(hash01(P.cracks + 1, c, load) * 2 ** 31);        // the same web on every copy of the car
  const x = P.crack.ctx, cx = u * W, cy = (1 - v) * W, R = W * clamp(0.18 + 0.22 * load, 0.2, 0.75);
  x.lineCap = 'round'; x.lineJoin = 'round';
  const nr = 9 + Math.floor(glassRnd() * 8), rays = [];
  for (let i = 0; i < nr; i++) {
    let a = (i + glassRnd() * 0.7) / nr * Math.PI * 2, px = cx, py = cy; const len = R * (0.5 + glassRnd() * 0.7), seg = 7 + Math.floor(glassRnd() * 4), pts = [[px, py]];
    for (let k = 0; k < seg; k++) { a += (glassRnd() - 0.5) * 0.45; const l = len / seg; px += Math.cos(a) * l; py += Math.sin(a) * l; pts.push([px, py]); }
    rays.push(pts);
    for (let k = 1; k < pts.length; k++) { x.strokeStyle = `rgba(232,242,248,${0.95 - 0.5 * k / pts.length})`; x.lineWidth = 2.2 - 1.5 * k / pts.length; x.beginPath(); x.moveTo(...pts[k - 1]); x.lineTo(...pts[k]); x.stroke(); }
  }
  for (let ring = 1; ring <= 3; ring++) {                                   // rings: from ray to ray, a little way out
    const f = (0.16 + 0.17 * ring) * (0.85 + glassRnd() * 0.3);
    x.strokeStyle = 'rgba(225,238,245,0.7)'; x.lineWidth = 1; x.beginPath();
    rays.forEach((pts, i) => { const q = pts[Math.min(pts.length - 1, Math.round(f * (pts.length - 1)))], j = (glassRnd() - 0.5) * 6; if (i === 0) x.moveTo(q[0] + j, q[1] + j); else x.lineTo(q[0] + j, q[1] + j); });
    x.closePath(); x.stroke();
  }
  x.fillStyle = 'rgba(230,240,246,0.55)'; x.beginPath(); x.arc(cx, cy, R * 0.06, 0, Math.PI * 2); x.fill();
  P.crack.tex.needsUpdate = true; P.state = 1; P.cracks++;
}
// Shards: tempered glass in small cubes, lamp lenses in flakes; they fly, bounce, settle, and go after half a minute
const SHARD_MAX = 1600, SHARD_LIFE = 30;
const shardMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.85, depthWrite: false }), SHARD_MAX);
shardMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); shardMesh.frustumCulled = false; shardMesh.castShadow = false;
const SH = { p: new Float32Array(SHARD_MAX * 3), v: new Float32Array(SHARD_MAX * 3), q: Array.from({ length: SHARD_MAX }, () => new THREE.Quaternion()), w: new Float32Array(SHARD_MAX * 3), s: new Float32Array(SHARD_MAX * 3),
  age: new Float32Array(SHARD_MAX).fill(-1), rest: new Uint8Array(SHARD_MAX), owner: new Array(SHARD_MAX).fill(null), next: 0, live: 0 };
{ const zero = new THREE.Matrix4().makeScale(0, 0, 0), white = new THREE.Color(1, 1, 1); for (let i = 0; i < SHARD_MAX; i++) { shardMesh.setMatrixAt(i, zero); shardMesh.setColorAt(i, white); } }
scene.add(shardMesh);
const SHARD_COL = { side: 0xb7d2cc, rear: 0xb7d2cc, roof: 0xb7d2cc, lamp: 0xe6eef4, tail: 0xc8141c };
const shColor = new THREE.Color(), shM = new THREE.Matrix4(), shP = new THREE.Vector3(), shS = new THREE.Vector3(), shQ = new THREE.Quaternion();
function shatterPane(V, P, dir, vel, e) {
  P.state = 2;
  for (const m of P.meshes) m.visible = false;
  V.vis.updateMatrixWorld(true); V.vis.getWorldQuaternion(gQ);
  const into = gN.copy(dir).applyQuaternion(gQ), lamp = P.type === 'lamp' || P.type === 'tail';
  shColor.setHex(SHARD_COL[P.type] ?? 0xb7d2cc);
  // points on the pane, by area
  const tris = [];
  let total = 0;
  for (const m of P.meshes) {
    const pos = m.geometry.attributes.position, idx = m.geometry.index, nt = (idx ? idx.count : pos.count) / 3 | 0;
    for (let t = 0; t < nt; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      const a = new THREE.Vector3().fromBufferAttribute(pos, i0).applyMatrix4(m.matrixWorld), b = new THREE.Vector3().fromBufferAttribute(pos, i1).applyMatrix4(m.matrixWorld), cc = new THREE.Vector3().fromBufferAttribute(pos, i2).applyMatrix4(m.matrixWorld);
      const ar = gA.subVectors(b, a).cross(gB.subVectors(cc, a)).length() / 2; if (ar < 1e-7) continue;
      total += ar; tris.push([a, b, cc, total]);
    }
  }
  if (!tris.length) return;
  const count = Math.round(clamp(P.area * (lamp ? 140 : 170), lamp ? 6 : 14, lamp ? 50 : 110)), k = Math.min(1, e / 15);
  for (let n = 0; n < count; n++) {
    const r = Math.random() * total; let lo = 0; while (tris[lo][3] < r) lo++;
    const [a, b, cc] = tris[lo]; let r1 = Math.random(), r2 = Math.random(); if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; }
    const i = SH.next; SH.next = (SH.next + 1) % SHARD_MAX;
    shP.copy(a).addScaledVector(gA.subVectors(b, a), r1).addScaledVector(gB.subVectors(cc, a), r2);
    SH.p.set([shP.x, shP.y, shP.z], i * 3);
    // with the car, and on through the frame (tempered glass falls into the cabin), scattered
    const push = lamp ? 0.4 + Math.random() : 0.8 + Math.random() * 2.2 * (0.5 + k);
    SH.v.set([vel.x * 0.85 + into.x * push + (Math.random() - 0.5) * 2.4 * (0.4 + k), vel.y * 0.85 + into.y * push + 0.3 + Math.random() * 1.8 * (0.4 + k), vel.z * 0.85 + into.z * push + (Math.random() - 0.5) * 2.4 * (0.4 + k)], i * 3);
    SH.w.set([(Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30], i * 3);
    SH.q[i].random();
    if (lamp) SH.s.set([0.015 + Math.random() * 0.03, 0.003, 0.012 + Math.random() * 0.025], i * 3);
    else { const z = 0.009 + Math.random() * 0.012; SH.s.set([z * (0.8 + Math.random() * 0.5), 0.005, z * (0.8 + Math.random() * 0.5)], i * 3); }
    SH.age[i] = 0; SH.rest[i] = 0; SH.owner[i] = V;
    shardMesh.setColorAt(i, shColor);
  }
  shardMesh.instanceColor.needsUpdate = true;
}
const shW = new THREE.Vector3(), shZero = new THREE.Matrix4().makeScale(0, 0, 0);
function updateGlass(dt) {
  let dirty = false;
  for (let i = 0; i < SHARD_MAX; i++) {
    if (SH.age[i] < 0) continue;
    const a = (SH.age[i] += dt), o = i * 3;
    if (a > SHARD_LIFE) { SH.age[i] = -1; SH.owner[i] = null; shardMesh.setMatrixAt(i, shZero); dirty = true; continue; }
    const fade = a > SHARD_LIFE - 2 ? (SHARD_LIFE - a) / 2 : 1;
    if (!SH.rest[i]) {
      SH.v[o + 1] -= 9.81 * dt;
      SH.p[o] += SH.v[o] * dt; SH.p[o + 1] += SH.v[o + 1] * dt; SH.p[o + 2] += SH.v[o + 2] * dt;
      shW.set(SH.w[o], SH.w[o + 1], SH.w[o + 2]); const ws = shW.length(); if (ws > 1e-3) SH.q[i].premultiply(shQ.setFromAxisAngle(shW.divideScalar(ws), ws * dt));
      const gy = surfaceAt(SH.p[o], SH.p[o + 2], SH.p[o + 1]) + SH.s[o + 1] / 2;
      if (SH.p[o + 1] < gy) {
        SH.p[o + 1] = gy; SH.v[o + 1] = Math.abs(SH.v[o + 1]) * 0.25; SH.v[o] *= 0.5; SH.v[o + 2] *= 0.5; SH.w[o] *= 0.4; SH.w[o + 1] *= 0.4; SH.w[o + 2] *= 0.4;
        if (SH.v[o] ** 2 + SH.v[o + 1] ** 2 + SH.v[o + 2] ** 2 < 0.25) SH.rest[i] = 1;
      }
    } else if (fade === 1) continue;
    shM.compose(shP.set(SH.p[o], SH.p[o + 1], SH.p[o + 2]), SH.q[i], shS.set(SH.s[o] * fade, SH.s[o + 1] * fade, SH.s[o + 2] * fade));
    shardMesh.setMatrixAt(i, shM); dirty = true;
  }
  if (dirty) shardMesh.instanceMatrix.needsUpdate = true;
}
// as built: panes back in, cracks gone, its shards swept up
function repairGlass(V) {
  if (V.glass) for (const P of V.glass) {
    for (const m of P.meshes) m.visible = true;
    for (const ov of P.overlays) ov.parent?.remove(ov);
    if (P.crack) { P.crack.tex.dispose(); P.crack.mat.dispose(); }
    Object.assign(P, { state: 0, cracks: 0, crack: null, overlays: [] });
  }
  let any = false;
  for (let i = 0; i < SHARD_MAX; i++) if (SH.owner[i] === V) { SH.age[i] = -1; SH.owner[i] = null; shardMesh.setMatrixAt(i, shZero); any = true; }
  if (any) shardMesh.instanceMatrix.needsUpdate = true;
}

// a body as built: thrown parts back on, panels straight, dents out
""")

# ---------------------------------------------------------------- the sound of it: a bright burst, then bits falling
rep("""    this.spool = 0; this.prevLoad = 0; this.bov = 0; this.whPh = 0; this.gwPh = 0; this.crash = 0; this.thump = 0; this.thPh = 0; this.crunch = 0;""",
    """    this.spool = 0; this.prevLoad = 0; this.bov = 0; this.whPh = 0; this.gwPh = 0; this.crash = 0; this.thump = 0; this.thPh = 0; this.crunch = 0;
    this.glass = 0; this.tink = 0; this.glHp = new Biquad().set('hp', 2400, 0.7); this.glF = [new Biquad().set('bp', 3100, 14), new Biquad().set('bp', 4700, 18), new Biquad().set('bp', 6900, 22), new Biquad().set('bp', 8800, 16)];""")
rep("""      else if (d.thump) this.thump = Math.min(1.2, this.thump + d.thump);""", """      else if (d.thump) this.thump = Math.min(1.2, this.thump + d.thump);
      else if (d.glass) { this.glass = Math.min(1.2, this.glass + d.glass); this.tink = Math.min(1, this.tink + d.glass * 0.8); }""")
rep("""      if (this.thump > 0.002) { this.thPh += thF / sr;""", """      if (this.glass > 0.002 || this.tink > 0.002) {
        const imp = Math.random() < this.tink * 90 / sr ? (Math.random() * 2 - 1) * this.tink : 0;
        hit += this.glHp.run(n) * this.glass * 1.3 + (this.glF[0].run(imp) + this.glF[1].run(imp) + this.glF[2].run(imp) * 0.8 + this.glF[3].run(imp) * 0.6) * 9;
        this.glass *= 0.9996; this.tink *= 0.99993;
      }
      if (this.thump > 0.002) { this.thPh += thF / sr;""")

# ---------------------------------------------------------------- for tests and the console
rep("""  Object.assign(window.__sim, { HIT, carHit, bodyHit, repairBody, repairCar, dentablesOf, framePull, frameSag });""",
    """  Object.assign(window.__sim, { HIT, carHit, bodyHit, repairBody, repairCar, dentablesOf, framePull, frameSag });
  Object.assign(window.__sim, { glassOf, glassHit, repairGlass, isGlassMat, SH });""")

open(ep, 'w').write(s)
print('glass patched')
