# Grounds (ticket #308): each ground has its own landscape. Sand: the dunes, as ever. Earth and Road: a firm-earth
# countryside (broad rolling hills, no slip faces), patched with dry grass away from the course (worn off where
# cars drive); the Road's tarmac runs through it with earth verges, not sand. The tarmac is 12 m wide (two 4.5 m
# lanes, 1.5 m shoulders), and the bridges in road mode as wide as it.
# Applies to public/sim after the other patches (last in the chain):
#   python3 scripts/patches/grounds.py <dir with engine.js and index.html>
import sys, os
d = sys.argv[1]
ep, hp = os.path.join(d, 'engine.js'), os.path.join(d, 'index.html')
s = open(ep).read()

def rep(a, b):
    global s
    n = s.count(a)
    assert n == 1, (n, a[:140])
    s = s.replace(a, b)

# ---- the countryside: its heights, and where its grass grows ----
rep("""function generateTerrain() {
  for (let j = 0; j < V; j++) {
    const z = -HALF + j * CELL;
    for (let i = 0; i < V; i++) B[j * V + i] = duneHeight(-HALF + i * CELL, z);
  }
""", """// Earth and Road (#308): rolling countryside instead of dunes: broad hills and swales, no slip faces
function countryHeight(x, z) {
  let h = 4 + 6.5 * n1(x / 170 + 3.1, z / 170 - 1.7) + 2.6 * n2(x / 74 - 5, z / 74 + 2) + 0.6 * n3(x / 26 + 1, z / 26 - 3)
    + 0.12 * n1(x / 6.5, z / 6.5) + 0.03 * n2(x / 1.9, z / 1.9);
  const d = Math.hypot(x, z), t = smooth(clamp((d - 12) / 32, 0, 1));
  h = lerp(4 + 0.25 * (h - 4), h, t);                        // calmer spawn area
  const e = Math.max(Math.abs(x), Math.abs(z));
  if (e > 172) h += ((e - 172) / 28) ** 2 * 16;               // world rim
  return h;
}
// the countryside's dry grass, 0-255 a cell (patches of it, thicker in places), drawn where the ground is earth
const GRASS = new Uint8Array(V * V);
let COUNTRY = false;                                         // the world was built as countryside (Earth, Road)
function generateTerrain() {
  const was = COUNTRY; COUNTRY = ROAD || COURSE.base === 'earth';
  if (COUNTRY !== was) setWeather(weatherKey, false);        // its haze and the light off the ground
  const hf = COUNTRY ? countryHeight : duneHeight;
  for (let j = 0; j < V; j++) {
    const z = -HALF + j * CELL;
    for (let i = 0; i < V; i++) B[j * V + i] = hf(-HALF + i * CELL, z);
  }
  if (COUNTRY) for (let j = 0; j < V; j++) {
    const z = -HALF + j * CELL;
    for (let i = 0; i < V; i++) { const x = -HALF + i * CELL;
      GRASS[j * V + i] = 255 * clamp(0.6 + 0.8 * n2(x / 31 + 9, z / 31 - 4) + 0.35 * n3(x / 8.5, z / 8.5 + 6) + 0.15 * n1(x / 2.3 + 4, z / 2.3), 0, 1); }
  }
""")

# the countryside's air: a cooler haze than the desert's dust, and the light off the ground from grass and earth
rep("""  U.zenith.value.setRGB(...W.zenith); HAZE.setRGB(...W.haze); U.sunCol.value.setRGB(...W.sunCol); U.sunGlow.value = W.glow;""",
    """  U.zenith.value.setRGB(...W.zenith); HAZE.setRGB(...W.haze); U.sunCol.value.setRGB(...W.sunCol); U.sunGlow.value = W.glow;
  if (COUNTRY) HAZE.lerp(COUNTRY_HAZE, 0.45);""")
rep("""  hemi.color.setHex(W.hemi[0]); hemi.groundColor.setHex(W.hemi[1]); hemi.intensity = W.hemi[2];""",
    """  hemi.color.setHex(W.hemi[0]); hemi.groundColor.setHex(W.hemi[1]); hemi.intensity = W.hemi[2];
  if (COUNTRY) hemi.groundColor.lerp(COUNTRY_BOUNCE, 0.6);""")
rep("""function setWeather(key, save = true) {""", """const COUNTRY_HAZE = new THREE.Color(0.70, 0.75, 0.80), COUNTRY_BOUNCE = new THREE.Color(0x7d7a52);
function setWeather(key, save = true) {""")

# ---- the tarmac: 12 m ----
rep("""const ROAD_HALF = 4.6;                              // half-width of the paved road (two lanes plus a narrow shoulder)""",
    """const ROAD_HALF = 6;                                // half-width of the paved road: two 4.5 m lanes and 1.5 m shoulders (#308)""")

# the grass on the countryside's earth: none on the course and its verges (C, the packed ground), none in ruts or
# where wheels have packed it since; a straw colour, olive where it grows thick
rep("""  const S0 = sf.color; col[o] = S0[0] * f; col[o + 1] = S0[1] * f * (1 - 0.03 * dist); col[o + 2] = S0[2] * f * (1 - 0.06 * dist);""",
    """  const S0 = sf.color; let r0 = S0[0], g0 = S0[1], b0 = S0[2];
  if (COUNTRY && sf === SURFACES.earth && GRASS[k]) {
    const gr = GRASS[k] / 255, w = smooth(clamp(gr * 1.6, 0, 1)) * (1 - clamp(C[k] * 3.5, 0, 1)) * (1 - dist), ol = clamp((gr - 0.55) * 2.2, 0, 1);
    r0 = lerp(r0, lerp(0.55, 0.38, ol), w); g0 = lerp(g0, lerp(0.47, 0.40, ol), w); b0 = lerp(b0, lerp(0.24, 0.17, ol), w);
  }
  col[o] = r0 * f; col[o + 1] = g0 * f * (1 - 0.03 * dist); col[o + 2] = b0 * f * (1 - 0.06 * dist);""")

# the road bed's long blur fades out ROAD_HALF + 1 to + 5 m from the centre: groom that far
rep("""  const D = new Float32Array(V * V).fill(99), I = new Int32Array(V * V), RAD = 10, BANK_RAD""",
    """  const D = new Float32Array(V * V).fill(99), I = new Int32Array(V * V), RAD = ROAD ? 12 : 10, BANK_RAD""")

# the edge lines bound two 4.5 m lanes, the shoulders outside them
rep("""    line(ROAD_HALF - 0.45, 0, 0, 0.15, '#f2f0e8'); line(-(ROAD_HALF - 0.45), 0, 0, 0.15, '#f2f0e8');""",
    """    line(ROAD_HALF - 1.5, 0, 0, 0.15, '#f2f0e8'); line(-(ROAD_HALF - 1.5), 0, 0, 0.15, '#f2f0e8');""")

# ---- bridges as wide as the road: the deck, the ramps' flat top, the cutting's bed ----
rep("""  BRIDGES.push({ cx: X.x, cz: X.z, tx: X.tx, tz: X.tz, halfL: X.halfL, halfW: 3.6, top, abut: top - bed + 0.6, kind: X.kind });""",
    """  const hw = ROAD ? ROAD_HALF + 0.6 : 3.6, FT = hw + 1.4, CW = hw + 1.9;   // deck, ramp top, cutting bed (half-widths)
  BRIDGES.push({ cx: X.x, cz: X.z, tx: X.tx, tz: X.tz, halfL: X.halfL, halfW: hw, top, abut: top - bed + 0.6, kind: X.kind });""")
rep("""      if (as < Lc[sd] && du < 5.5 + 12) {""", """      if (as < Lc[sd] && du < CW + 12) {""")
rep("""        if (du < 5.5) { B[k] = t; C[k] = Math.max(C[k], 0.35); }
        else B[k] = Math.min(B[k], t + (du - 5.5) / 1.5);""",
    """        if (du < CW) { B[k] = t; C[k] = Math.max(C[k], 0.35); }
        else B[k] = Math.min(B[k], t + (du - CW) / 1.5);""")
rep("""    if (a < a0 || a > a0 + RL[sd] || dov > 11) continue;""", """    if (a < a0 || a > a0 + RL[sd] || dov > FT + 6) continue;""")
rep("""    const wl = 1 - smooth(clamp((dov - 5) / 6, 0, 1));                               // flat top 5 m each side, then a side slope
    const we = dov <= 4.8 ? 1 : smooth(clamp((a - a0) / 4, 0, 1));                    // past the abutment's width: a sloped end, not a cliff""",
    """    const wl = 1 - smooth(clamp((dov - FT) / 6, 0, 1));                              // flat top FT m each side, then a side slope
    const we = dov <= hw + 1.2 ? 1 : smooth(clamp((a - a0) / 4, 0, 1));               // past the abutment's width: a sloped end, not a cliff""")

# ---- the ground: Road is on earth; another landscape (or road bed) rebuilds the world ----
rep("""SURF = SURFACES[COURSE.base]; ROAD = !!COURSE.road;""", """if (COURSE.road) COURSE.base = 'earth';                      // the road runs through the countryside (#308)
SURF = SURFACES[COURSE.base]; ROAD = !!COURSE.road;""")
rep("""// 'sand' / 'earth' = off-road course on that ground; 'road' = the course is paved, with sand around it
function setSurface(name) {
  const road = name === 'road', changed = road !== ROAD;
  SURF = road ? SURFACES.sand : SURFACES[name] || SURFACES.sand;
  ROAD = road; COURSE.road = road;""",
    """// 'sand' / 'earth' = off-road course on that ground (the dunes / the countryside); 'road' = the course is paved,
// through the countryside. Another landscape or road bed rebuilds the world: true when it did.
function setSurface(name) {
  const road = name === 'road';
  SURF = road ? SURFACES.earth : SURFACES[name] || SURFACES.sand;
  const changed = road !== ROAD || (road || SURF === SURFACES.earth) !== COUNTRY;
  ROAD = road; COURSE.road = road;""")
rep("""  if (changed && TRACK.gates[0].posts) { clearSkids(); regenerateWorld(); return; }   // the road bed is graded differently
  for (const ch of chunks.values()) ch.update();
  updateFar();
}""", """  if (changed && TRACK.gates[0].posts) { clearSkids(); regenerateWorld(); return true; }   // other hills, or the road bed graded differently
  for (const ch of chunks.values()) ch.update();
  updateFar();
  return false;
}""")
# an imported course on the road: on earth too
rep("""noBridge: Array.isArray(c.noBridge) ? c.noBridge.filter(b => b && isFinite(b.x) && isFinite(b.z)).map(b => ({ x: +b.x, z: +b.z })) : [] }; ROAD = COURSE.road;""",
    """noBridge: Array.isArray(c.noBridge) ? c.noBridge.filter(b => b && isFinite(b.x) && isFinite(b.z)).map(b => ({ x: +b.x, z: +b.z })) : [] }; ROAD = COURSE.road;
    if (ROAD) COURSE.base = 'earth'; SURF = SURFACES[COURSE.base];""")
rep("""  if (ground) { C.base = ground === 'earth' ? 'earth' : 'sand'; C.road = ground === 'road'; }""",
    """  if (ground) { C.base = ground === 'earth' || ground === 'road' ? 'earth' : 'sand'; C.road = ground === 'road'; }
  else if (C.road) C.base = 'earth';""")
rep("""  const road = ROAD;
  setSurface(g);                                                     // sand / earth <-> road rebuilds the world itself
  if (COURSE.bank && road === ROAD) { clearSkids(); regenerateWorld(); }   // the banking is set for the ground's cornering speed""",
    """  if (!setSurface(g) && COURSE.bank) { clearSkids(); regenerateWorld(); }   // another ground rebuilds the world itself; the banking is set for its cornering speed""")
# G in the map editor: setSurface rebuilt the world already (every ground has its own landscape now)
rep("""    if (MP.ground && COURSE.bank && (g === 'road') === (MP.ground === 'road')) { clearSkids(); regenerateWorld(); }
""", "")
open(ep, 'w').write(s)

h = open(hp).read()
a = """Road<small>asphalt through the dunes</small>"""
assert h.count(a) == 1
h = h.replace(a, """Road<small>asphalt through the countryside</small>""")
open(hp, 'w').write(h)
print('grounds: ok')
