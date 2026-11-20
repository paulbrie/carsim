# Course editor: "Smooth curves" (a minimum corner radius for the waypoints) and "Banking"
# (the ground under each bend tilted toward its inside), ticket #282.
# Applies to public/sim/engine.js and index.html after mp-hooks.py:
#   python3 scripts/patches/track-shape.py <dir with engine.js and index.html>
import sys, os
d = sys.argv[1]
ep, hp = os.path.join(d, 'engine.js'), os.path.join(d, 'index.html')
s = open(ep).read()
h = open(hp).read()

def rep(a, b, which='s'):
    global s, h
    src = s if which == 's' else h
    n = src.count(a)
    assert n == 1, (which, n, a[:140])
    if which == 's': s = src.replace(a, b)
    else: h = src.replace(a, b)

# ---------------------------------------------------------------- the course keeps a banking angle
rep("""  if (c && Array.isArray(c.wp) && c.wp.length >= 3) COURSE = { wp: c.wp, ops: Array.isArray(c.ops) ? c.ops : [], """,
    """  if (c && Array.isArray(c.wp) && c.wp.length >= 3) COURSE = { wp: c.wp, bank: bankOf(c.bank), ops: Array.isArray(c.ops) ? c.ops : [], """)
rep("""    COURSE = { wp: c.wp.map(([x, z]) => [+x, +z]), ops: Array.isArray(c.ops) ? c.ops : [], """,
    """    COURSE = { wp: c.wp.map(([x, z]) => [+x, +z]), bank: bankOf(c.bank), ops: Array.isArray(c.ops) ? c.ops : [], """)
rep("""const DEFAULT_WP = (() =>""", """const BANK_MAX = 25;                                         // degrees, the editor's Banking slider
const bankOf = v => clamp(Math.round(+v || 0), 0, BANK_MAX);
const DEFAULT_WP = (() =>""")
# banking changes lap times: its own best laps
rep("""const courseKey = () => { let h = 2166136261; for (const ch of JSON.stringify(COURSE.wp) + """,
    """const courseKey = () => { let h = 2166136261; for (const ch of JSON.stringify(COURSE.wp) + (COURSE.bank ? 'b' + COURSE.bank : '') + """)

# ---------------------------------------------------------------- smoothing and measuring the course
rep("""function groomTrack() {""", r"""/* ------------------------- course shape: corner radius, smoothing, banking ------------------------- */
// radius of the circle through three points (Infinity on a straight)
const circR = (a, b, c) => {
  const abx = b[0] - a[0], abz = b[1] - a[1], bcx = c[0] - b[0], bcz = c[1] - b[1], cax = a[0] - c[0], caz = a[1] - c[1];
  const cr = Math.abs(abx * bcz - abz * bcx); return cr < 1e-9 ? Infinity : Math.hypot(abx, abz) * Math.hypot(bcx, bcz) * Math.hypot(cax, caz) / (2 * cr);
};
// the course as a closed polyline every ~ds metres
function coursePoly(wp, ds = 2) {
  const curve = new THREE.CatmullRomCurve3(wp.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
  const n = Math.max(40, Math.round(curve.getLength() / ds));
  return curve.getSpacedPoints(n).slice(0, n).map(v => [v.x, v.z]);
}
// tightest corner, measured over ±8 m so waypoint wiggles don't count as corners
function tightestCorner(P, ds = 2) {
  const n = P.length, h = Math.max(1, Math.round(8 / ds)); let r = Infinity;
  for (let i = 0; i < n; i++) r = Math.min(r, circR(P[(i - h + n) % n], P[i], P[(i + h) % n]));
  return r;
}
// Open every bend tighter than rMin, the way a racing line cuts it: points on a too-tight bend (and a
// run-in either side) move toward their neighbours' midpoint, round after round, until no corner is
// tighter than rMin; straights stay put, and no point goes further than ~rMin from where it was (a
// hairpin between close straights can't open without moving them: it opens as far as that allows).
// Back to waypoints every ~10-16 m, the first one where it was.
function smoothCourse(wp, rWant) {
  const rMin = rWant * 1.12;                 // aim past it: refitting waypoints to the smoothed line loses a little
  const ds = 2, P0 = coursePoly(wp, ds), n = P0.length, h = Math.round(8 / ds), spread = Math.round(16 / ds), reach = rMin * 1.2;
  let P = P0.map(p => p.slice());
  const before = tightestCorner(P0, ds), w = new Float32Array(n);
  let best = { P: P.map(p => p.slice()), r: before }, still = 0;
  for (let it = 0; it < 3000; it++) {
    w.fill(0); let worst = Infinity;
    for (let i = 0; i < n; i++) {
      const r = circR(P[(i - h + n) % n], P[i], P[(i + h) % n]); worst = Math.min(worst, r);
      if (r < rMin) { const f = Math.min(1, (rMin - r) / rMin + 0.3); for (let j = -spread; j <= spread; j++) { const k = (i + j + n) % n; w[k] = Math.max(w[k], f * (1 - Math.abs(j) / (spread + 1))); } }
    }
    if (worst > best.r + 0.05) { best = { P: P.map(p => p.slice()), r: worst }; still = 0; } else if (++still > 300) break;
    if (worst >= rMin * 0.995) break;
    const Q = P.map((p, i) => {
      const a = P[(i - 1 + n) % n], c = P[(i + 1) % n], k = w[i] * 0.5;
      let x = p[0] + ((a[0] + c[0]) / 2 - p[0]) * k, z = p[1] + ((a[1] + c[1]) / 2 - p[1]) * k;
      const o = P0[i], dx = x - o[0], dz = z - o[1], dd = Math.hypot(dx, dz);
      if (dd > reach) { x = o[0] + dx * reach / dd; z = o[1] + dz * reach / dd; }        // tethered
      return [clamp(x, -168, 168), clamp(z, -168, 168)];
    });
    // keep the points evenly spaced (or they bunch up on the bends), each still tied to its original
    P = it % 10 === 9 ? respace(Q, n) : Q;
  }
  P = best.P;
  let len = 0; for (let i = 0; i < n; i++) len += Math.hypot(P[(i + 1) % n][0] - P[i][0], P[(i + 1) % n][1] - P[i][1]);
  const m = clamp(Math.round(len / clamp(rWant * 0.45, 9, 16)), 8, 96), out = [];
  // start at the point nearest the old first waypoint, so the start line stays put
  let i0 = 0, bd = Infinity; P.forEach((p, i) => { const e = (p[0] - wp[0][0]) ** 2 + (p[1] - wp[0][1]) ** 2; if (e < bd) { bd = e; i0 = i; } });
  const R = respace([...P.slice(i0), ...P.slice(0, i0)], m);
  for (const p of R) out.push([+p[0].toFixed(1), +p[1].toFixed(1)]);
  return { wp: out, before, after: tightestCorner(coursePoly(out, ds), ds) };
}
// a closed polyline as m points evenly spaced along it, the first one kept
function respace(P, m) {
  const n = P.length, cum = [0];
  for (let i = 0; i < n; i++) cum.push(cum[i] + Math.hypot(P[(i + 1) % n][0] - P[i][0], P[(i + 1) % n][1] - P[i][1]));
  const L = cum[n], out = []; let j = 0;
  for (let k = 0; k < m; k++) {
    const s = k * L / m; while (cum[j + 1] < s) j++;
    const a = P[j], b = P[(j + 1) % n], t = (s - cum[j]) / ((cum[j + 1] - cum[j]) || 1);
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

// Banking: the cross-slope (rise per metre toward the outside of the bend) for every point of
// TRACK.pts. The angle a car needs at this ground's cornering speed, tan = v^2 / (g R), capped by the
// course's banking angle, eased in and out along the course, and none near bridges and crossings.
function trackBank() {
  const P = TRACK.pts, n = P.length - 1, out = new Float32Array(n + 1);
  if (!COURSE.bank) return out;
  const cap = Math.tan(COURSE.bank * Math.PI / 180), ds = TRACK.len / n, h = Math.max(2, Math.round(6 / ds));
  const tar = ROAD, v = tar ? 24 : COURSE.base === 'earth' ? 18 : 14;     // m/s through a bend on asphalt / earth / sand
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = P[(i - h + n) % n], b = P[i], c = P[(i + h) % n];
    const R = circR([a.x, a.z], [b.x, b.z], [c.x, c.z]); if (!isFinite(R)) continue;
    // which way it bends: + when the course turns toward its normal (-t.z, t.x)
    const tx = c.x - a.x, tz = c.z - a.z, side = Math.sign((c.x - b.x) * (-tz) + (c.z - b.z) * tx - ((b.x - a.x) * (-tz) + (b.z - a.z) * tx));
    raw[i] = -side * Math.min(cap, v * v / (9.81 * R));   // the outside of the bend is the high side
  }
  // ease in and out: two passes of a ±12 m moving average
  const w = Math.max(1, Math.round(12 / ds)); let cur = raw;
  for (let pass = 0; pass < 2; pass++) { const nx = new Float32Array(n); for (let i = 0; i < n; i++) { let sum = 0; for (let j = -w; j <= w; j++) sum += cur[(i + j + n) % n]; nx[i] = sum / (2 * w + 1); } cur = nx; }
  for (let i = 0; i < n; i++) {
    const u = i / n; let f = 1;
    for (const b of TRACK.bridges) {
      f = Math.min(f, smooth(clamp((Math.abs(arcDist(u, b.uOver)) - b.reach) / 25, 0, 1)));
      if (b.uUnder != null) f = Math.min(f, smooth(clamp((Math.abs(arcDist(u, b.uUnder)) - 30) / 25, 0, 1)));
    }
    for (const q of TRACK.crossings) f = Math.min(f, smooth(clamp((Math.hypot(P[i].x - q.x, P[i].z - q.z) - 20) / 25, 0, 1)));
    out[i] = clamp(cur[i], -cap, cap) * f;
  }
  out[n] = out[0];
  return out;
}

function groomTrack() {""")

# ---------------------------------------------------------------- the ground under the bends
rep("""  const D = new Float32Array(V * V).fill(99), RAD = 10, rc = Math.ceil(RAD / CELL);
  for (const p of TRACK.pts) {
    const ci = Math.round((p.x + HALF) / CELL), cj = Math.round((p.z + HALF) / CELL);
    for (let dj = -rc; dj <= rc; dj++) for (let di = -rc; di <= rc; di++) {
      const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i > N || j > N) continue;
      const d = Math.hypot(di, dj) * CELL, k = j * V + i;
      if (d < D[k]) D[k] = d;
    }
  }""", """  // D: distance to the course; I: the nearest course point (TRACK.pts), out to 16 m for the banking
  const D = new Float32Array(V * V).fill(99), I = new Int32Array(V * V), RAD = 10, BANK_RAD = 16, rc = Math.ceil((COURSE.bank ? BANK_RAD : RAD) / CELL);
  TRACK.pts.forEach((p, pi) => {
    const ci = Math.round((p.x + HALF) / CELL), cj = Math.round((p.z + HALF) / CELL);
    for (let dj = -rc; dj <= rc; dj++) for (let di = -rc; di <= rc; di++) {
      const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i > N || j > N) continue;
      const d = Math.hypot(di, dj) * CELL, k = j * V + i;
      if (d < D[k]) { D[k] = d; I[k] = pi; }
    }
  });""")
rep("""    for (let k = 0; k < V * V; k++) if (D[k] < RAD) B[k] = lerp(B[k], b2[k], 0.9 * (1 - smooth(clamp((D[k] - ROAD_HALF - 1) / 4, 0, 1))));
  }
""", """    for (let k = 0; k < V * V; k++) if (D[k] < RAD) B[k] = lerp(B[k], b2[k], 0.9 * (1 - smooth(clamp((D[k] - ROAD_HALF - 1) / 4, 0, 1))));
  }
  // banking: across the course the ground rises toward the outside of each bend, level with the
  // groomed centre line, full width to 9 m out, then back into the dunes by 16 m
  TRACK.bank = trackBank();
  if (COURSE.bank) {
    const P = TRACK.pts, np = P.length - 1, hc = new Float32Array(np + 1), nx = new Float32Array(np + 1), nz = new Float32Array(np + 1);
    const Bat = (x, z) => { const fx = clamp((x + HALF) / CELL, 0, N - 1e-4), fz = clamp((z + HALF) / CELL, 0, N - 1e-4), i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, k = j * V + i;
      return (B[k] * (1 - tx) + B[k + 1] * tx) * (1 - tz) + (B[k + V] * (1 - tx) + B[k + V + 1] * tx) * tz; };
    for (let i = 0; i <= np; i++) {
      const a = P[(i - 1 + np) % np], c = P[(i + 1) % np], tl = Math.hypot(c.x - a.x, c.z - a.z) || 1;
      hc[i] = Bat(P[i].x, P[i].z); nx[i] = -(c.z - a.z) / tl; nz[i] = (c.x - a.x) / tl;
    }
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const k = j * V + i; if (D[k] >= BANK_RAD) continue;
      const pi = I[k], sl = TRACK.bank[pi]; if (!sl) continue;
      const p = P[pi], l = (-HALF + i * CELL - p.x) * nx[pi] + (-HALF + j * CELL - p.z) * nz[pi];
      B[k] = lerp(B[k], hc[pi] + l * sl, 1 - smooth(clamp((D[k] - 9) / 7, 0, 1)));
    }
  }
""")

# ---------------------------------------------------------------- bots corner faster on a banked bend
rep("""    q.acc = acc; q.brk = brk; q.top = top; q.v = Math.min(top, Math.sqrt(lat / Math.max(Math.abs(q.k), 1e-4)));""",
    """    const bank = Math.abs(TRACK.bank?.[Math.round(i / n * (TRACK.pts.length - 1))] || 0);   // tan of the banking: the ground helps turn
    q.acc = acc; q.brk = brk; q.top = top; q.v = Math.min(top, Math.sqrt((lat + 9.81 * bank) / Math.max(Math.abs(q.k), 1e-4)));""")
rep("""  const key = TRACK; if (BOTS.path && BOTS.path.key === key && BOTS.path.road === ROAD && BOTS.path.base === COURSE.base) return BOTS.path;""",
    """  const key = TRACK; if (BOTS.path && BOTS.path.key === key && BOTS.path.road === ROAD && BOTS.path.base === COURSE.base && BOTS.path.bank === TRACK.bank) return BOTS.path;""")
rep("""  return BOTS.path = { key, road: ROAD, base: COURSE.base, P, n, ds, len, s0: s0 * ds };""",
    """  return BOTS.path = { key, road: ROAD, base: COURSE.base, bank: TRACK.bank, P, n, ds, len, s0: s0 * ds };""")

# ---------------------------------------------------------------- the editor's SHAPE section
rep("""const ed = { on: false, tool: 'wp', size: 8, str: 4, drag: -1, sel: -1,""",
    """const ed = { on: false, tool: 'wp', size: 8, str: 4, rMin: 25, undoWp: null, drag: -1, sel: -1,""")
rep("""document.getElementById('editBtn').addEventListener('click', () => toggleEditor(!ed.on));""",
    """document.getElementById('editBtn').addEventListener('click', () => toggleEditor(!ed.on));
// SHAPE: smooth the curves to a minimum radius (undoable), and bank them
const sRadEl = document.getElementById('sRad'), bankEl = document.getElementById('bankDeg');
const showShape = () => {
  document.getElementById('sRadV').textContent = `${ed.rMin} m`;
  document.getElementById('bankV').textContent = COURSE.bank ? `${COURSE.bank}°` : 'off';
  document.getElementById('eUndoSmooth').disabled = !ed.undoWp;
};
sRadEl.addEventListener('input', e => { ed.rMin = +e.target.value; showShape(); });
bankEl.addEventListener('input', e => { COURSE.bank = bankOf(e.target.value); ed.wpDirty = true; showShape(); });
bankEl.addEventListener('change', () => flash(COURSE.bank ? `Bends banked up to ${COURSE.bank}° (built when you close the editor)` : 'Banking off', '#fff', 2.2));
document.getElementById('eSmooth').addEventListener('click', () => {
  const r = smoothCourse(COURSE.wp, ed.rMin), was = Math.round(r.before), now = Math.round(r.after);
  if (r.before >= ed.rMin * 0.97) { flash(`No corner is tighter than ${ed.rMin} m (tightest: ${was} m)`, '#ffd88a', 2.4); return; }
  const lost = buildTrack(r.wp, { ...COURSE, wp: r.wp }).rejected.length - (ed.track?.rejected.length || 0);
  ed.undoWp = COURSE.wp; COURSE.wp = r.wp; ed.sel = -1; ed.wpDirty = true; updatePreview(); showShape();
  const short = r.after < ed.rMin * 0.85 ? ' · a hairpin this tight opens only so far: move its straights apart for more' : '';
  flash(`Curves smoothed: tightest corner ${was} m → ${now} m${short}${lost > 0 ? ` · ${lost} bridge${lost > 1 ? 's' : ''} no longer fit` : ''}`, '#7dff9a', short ? 5 : 3);
});
document.getElementById('eUndoSmooth').addEventListener('click', () => {
  if (!ed.undoWp) return;
  COURSE.wp = ed.undoWp; ed.undoWp = null; ed.sel = -1; ed.wpDirty = true; updatePreview(); showShape(); flash('Smoothing undone', '#fff', 1.5);
});""")
# the editor opens with the course's banking, and the info line names the tightest corner
rep("""    setTool(ed.tool); updatePreview();""", """    ed.undoWp = null; bankEl.value = COURSE.bank || 0; showShape();
    setTool(ed.tool); updatePreview();""")
rep("""  edEl.querySelector('#eInfo').textContent = `${COURSE.wp.length} waypoints · ${(t.len / 1000).toFixed(2)} km · """,
    """  edEl.querySelector('#eInfo').textContent = `${COURSE.wp.length} waypoints · ${(t.len / 1000).toFixed(2)} km · tightest corner ${Math.round(tightestCorner(t.pts.slice(0, -1).map(p => [p.x, p.z]), t.len / (t.pts.length - 1)))} m · """)
# reset brings back the plain figure-8
rep("""document.getElementById('eReset').addEventListener('click', () => { COURSE.wp = DEFAULT_WP.map(p => p.slice()); COURSE.bridges = []; COURSE.noBridge = [];""",
    """document.getElementById('eReset').addEventListener('click', () => { COURSE.wp = DEFAULT_WP.map(p => p.slice()); COURSE.bridges = []; COURSE.noBridge = []; ed.undoWp = null; showShape();""")

rep("""  <div class="sec">TERRAIN</div>""", """  <div class="sec">SHAPE</div>
  <label title="Smooth curves opens every bend tighter than this">Min. corner radius <input id="sRad" type="range" min="10" max="60" step="5" value="25"> <span id="sRadV" class="val">25 m</span></label>
  <div class="tools"><button id="eSmooth" title="Reshape the waypoints so no corner is tighter than the radius above">Smooth curves</button><button id="eUndoSmooth" disabled>Undo smoothing</button></div>
  <label title="Tilt the ground under each bend toward its inside, steeper in tighter bends, up to this angle">Banking <input id="bankDeg" type="range" min="0" max="25" step="1" value="0"> <span id="bankV" class="val">off</span></label>
  <div class="sec">TERRAIN</div>""", 'h')
rep("""  #editor .sec{font-size:11px;letter-spacing:1.5px;opacity:.7;margin-top:8px}""",
    """  #editor .sec{font-size:11px;letter-spacing:1.5px;opacity:.7;margin-top:8px}
  #editor .val{min-width:34px;text-align:right;font-variant-numeric:tabular-nums}
  #editor button:disabled{opacity:.45;cursor:default}""", 'h')

open(ep, 'w').write(s)
open(hp, 'w').write(h)
print('track-shape patched')
