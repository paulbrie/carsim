# Skid marks (ticket #306): rubber left on asphalt and on bridge decks by a tire that slides or spins, from its real
# sliding speed (wheel spin and sideways slide together, past a gripping tire's creep), darker the harder it slides
# and the more load it carries; a soft-edged texture with the tread's streaks. In a race the other players' cars leave them too: each player's
# 20 Hz state carries the four wheels' marks ('s' sk, scripts/patches/mp-block.js), the others draw them.
# Applies to public/sim after the other patches (last in the chain):
#   python3 scripts/patches/skids.py <dir with engine.js and index.html>
import sys, os
d = sys.argv[1]
ep = os.path.join(d, 'engine.js')
s = open(ep).read()

def rep(a, b):
    global s
    n = s.count(a)
    assert n == 1, (n, a[:140])
    s = s.replace(a, b)

def span(a, b, new):
    """replace from a up to (not including) b"""
    global s
    assert s.count(a) == 1 and s.count(b) == 1, (s.count(a), s.count(b), a[:80], b[:80])
    i, j = s.index(a), s.index(b)
    assert i < j
    s = s[:i] + new + s[j:]

# the tire's sliding speed: how fast its contact patch rubs over the ground, past the creep a gripping tire has anyway
# (a driven wheel under full power turns 2-3 m/s faster than the road goes by, a cornering one drifts ~10% sideways)
rep("""      W.contact = false; W.load = 0; W.slipSpeed = 0; W.sink = 0; W.slip = 0; W.sx = 0;""",
    """      W.contact = false; W.load = 0; W.slipSpeed = 0; W.sink = 0; W.slip = 0; W.sx = 0; W.slide = 0;""")
rep("""    W.slipSpeed = Math.abs(W.omega * R - vLong) + 0.6 * Math.abs(vLat);""",
    """    W.slipSpeed = Math.abs(W.omega * R - vLong) + 0.6 * Math.abs(vLat);
    W.slide = Math.max(0, Math.hypot(W.omega * R - vLong, vLat) - 1 - 0.1 * Math.abs(vLong));   // past the creep of a gripping tire""")

span("// skid marks: dark ribbons left on asphalt by sliding or spinning tires\n", "function emitFromWheels(dt) {", r"""// skid marks (#306): rubber left on asphalt and bridge decks by a tire that slides or spins, ours and (in a race) the
// other players' cars'. A strip per wheel, made of quads joined end to end across the way the tire travels (as wide as
// its tread rolling, as long as its contact patch sliding sideways), in one ring for all the cars: the oldest go first.
const SKID_MAX = 12000, skidPos = new Float32Array(SKID_MAX * 18), skidCol = new Float32Array(SKID_MAX * 24), skidUv = new Float32Array(SKID_MAX * 12);
const skidGeo = new THREE.BufferGeometry();
skidGeo.setAttribute('position', new THREE.BufferAttribute(skidPos, 3).setUsage(THREE.DynamicDrawUsage));
skidGeo.setAttribute('color', new THREE.BufferAttribute(skidCol, 4).setUsage(THREE.DynamicDrawUsage));
skidGeo.setAttribute('uv', new THREE.BufferAttribute(skidUv, 2).setUsage(THREE.DynamicDrawUsage));
skidGeo.setDrawRange(0, 0);
// the mark's texture: soft edges, the tread's streaks along it, blotches where the rubber went down thicker
const skidTex = (() => {
  const W = 32, H = 128, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d'), im = g.createImageData(W, H);
  let seed = 306; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const col = Array.from({ length: W }, () => 0.62 + 0.38 * rnd());
  for (const c of [8, 15, 16, 23]) col[c] *= 0.45;                                  // the tread's grooves
  const wave = Array.from({ length: 6 }, (_, k) => [rnd() * 0.12, rnd() * 6.283, k + 1]);
  for (let y = 0; y < H; y++) {
    let b = 0.86; for (const [a, ph, k] of wave) b += a * Math.sin(ph + y / H * 6.283 * k);   // repeats along v
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W, e = smooth(clamp(u / 0.2, 0, 1)) * smooth(clamp((1 - u) / 0.2, 0, 1)), o = (y * W + x) * 4;
      im.data[o] = im.data[o + 1] = im.data[o + 2] = 255; im.data[o + 3] = Math.round(255 * clamp(e * col[x] * b, 0, 1));
    }
  }
  g.putImageData(im, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping; t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return t;
})();
const skidMesh = new THREE.Mesh(skidGeo, new THREE.MeshBasicMaterial({ color: 0x0c0b0a, map: skidTex, vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
skidMesh.frustumCulled = false; skidMesh.renderOrder = 1; scene.add(skidMesh);
let skidN = 0, skidCount = 0, skidLo = -1, skidHi = -1;
const skidLast = new Map();                         // a strip's last point, by wheel: 0-3 ours, `${id}:${i}` the others'
const SKID_V0 = 0.5, SKID_V1 = 6;                   // sliding speed (m/s, W.slide) where a mark starts, and where it is darkest
const skidAlpha = slide => slide > SKID_V0 ? 0.2 + 0.6 * smooth(clamp((slide - SKID_V0) / (SKID_V1 - SKID_V0), 0, 1)) : 0;
function clearSkids() { skidN = 0; skidCount = 0; skidLo = skidHi = -1; skidGeo.setDrawRange(0, 0); skidLast.clear(); }
// a strip's next point: the contact at (x, y, z), the tire heading (fx, fz), its tread's half-width, the mark's darkness
function skidPoint(key, x, y, z, fx, fz, hw, a) {
  const L = skidLast.get(key);
  if (!a) { if (L) skidLast.delete(key); return; }
  if (L && Math.hypot(x - L.x, z - L.z) < 0.3) return;
  const d = L ? Math.hypot(x - L.x, z - L.z) : 0;
  if (!L || d > 4 || Math.abs(y - L.y) > 0.6) {                // a new strip (or a jump: a respawn, a bridge's deck)
    skidLast.set(key, { x, y, z, a, v: 0, first: true }); return;
  }
  const mx = (x - L.x) / d, mz = (z - L.z) / d, fl = Math.hypot(fx, fz) || 1, c = Math.abs((fx * mx + fz * mz) / fl);
  const w = hw * c + 0.1 * Math.sqrt(1 - c * c), sx = -mz, sz = mx, v = L.v + d / 1.6;
  if (L.first) { L.sx = sx; L.sz = sz; L.hw = w; }                // the strip's start: across the way it goes too
  const q = [[L.x + L.sx * L.hw, L.y, L.z + L.sz * L.hw, L.a, 0, L.v], [L.x - L.sx * L.hw, L.y, L.z - L.sz * L.hw, L.a, 1, L.v],
    [x + sx * w, y, z + sz * w, a, 0, v], [x - sx * w, y, z - sz * w, a, 1, v]];
  const o = skidN * 18, oc = skidN * 24, ou = skidN * 12;
  [0, 2, 1, 1, 2, 3].forEach((k, n) => {                     // counter-clockwise seen from above (the original's faced down: culled)
    const p = q[k]; skidPos[o + n * 3] = p[0]; skidPos[o + n * 3 + 1] = p[1]; skidPos[o + n * 3 + 2] = p[2]; skidCol.set([1, 1, 1, p[3]], oc + n * 4); skidUv[ou + n * 2] = p[4]; skidUv[ou + n * 2 + 1] = p[5]; });
  if (skidLo < 0) skidLo = skidHi = skidN; else if (skidN === 0) skidLo = 0; skidHi = Math.max(skidHi, skidN);
  skidN = (skidN + 1) % SKID_MAX; skidCount = Math.min(skidCount + 1, SKID_MAX);
  skidLast.set(key, { x, y, z, sx, sz, hw: w, a, v: v % 64 });
}
// the quads written since the last call go to the GPU at the next render (only those; three clears the ranges once
// they are uploaded, and the physics may step several times between two renders: a range not yet sent grows)
function flushSkids() {
  if (skidLo < 0) return;
  const n = skidHi - skidLo + 1;
  for (const [name, k] of [['position', 18], ['color', 24], ['uv', 12]]) {
    const A = skidGeo.attributes[name], R = A.updateRanges, last = R[R.length - 1];
    if (last && last.start + last.count === skidLo * k) last.count += n * k; else A.addUpdateRange(skidLo * k, n * k);
    A.needsUpdate = true;
  }
  skidGeo.setDrawRange(0, skidCount * 6); skidLo = skidHi = -1;
}
function updateSkids() {
  const m = car.mass * G / (car.wheels.length || 4), hw = PRESSURES[car.pIdx].w * 0.45;
  car.wheels.forEach((W, i) => {
    const hard = W.contact && (W.deck || W.surf?.rigid);
    W.skid = hard ? skidAlpha(W.slide || 0) * clamp(0.35 + 0.65 * W.load / m, 0.35, 1.15) : 0;   // a light wheel leaves less
    skidPoint(i, W.P.x, W.P.y + 0.012, W.P.z, W.fwd.x, W.fwd.z, hw, Math.min(W.skid, 0.85));
  });
  flushSkids();
}
""")

rep("""  Object.assign(window.__sim, { glassOf, glassHit, repairGlass, isGlassMat, SH });""",
    """  Object.assign(window.__sim, { glassOf, glassHit, repairGlass, isGlassMat, SH });
  Object.assign(window.__sim, { skidMarks: () => ({ count: skidCount, strips: [...skidLast.keys()] }), clearSkids });""")

open(ep, 'w').write(s)
