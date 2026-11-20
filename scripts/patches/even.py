# Even grade (ticket #300): sections of the course, from one waypoint to another (forward along the
# course), where the road rises or falls at one constant grade, from the height at the first to the
# height at the last: cut and filled like "Level the road", banking on top. COURSE.even = [[a, b], …]
# (waypoint indices, kept through waypoint inserts and deletes), saved with the course and in maps.
# Applies to public/sim after the other patches (… glass, weather, cars):
#   python3 scripts/patches/even.py <dir with engine.js and index.html>
import sys, os
d = sys.argv[1]
ep, hp = os.path.join(d, 'engine.js'), os.path.join(d, 'index.html')
s = open(ep).read()

def rep(a, b, n=1):
    global s
    c = s.count(a)
    assert c == n, (c, n, a[:140])
    s = s.replace(a, b)

# ---------------------------------------------------------------- the field: read wherever a course is read, in its key
rep("""const levelOf = v => clamp(Math.round(+v || 0), 0, 100);""", """const levelOf = v => clamp(Math.round(+v || 0), 0, 100);
// even-grade sections: [first, last] waypoint indices (the road between them at one grade), at most 40
const evenOf = v => Array.isArray(v) ? v.filter(r => Array.isArray(r) && r.length === 2 && r.every(i => Number.isInteger(i) && i >= 0) && r[0] !== r[1]).slice(0, 40).map(r => [r[0], r[1]]) : [];""")
rep("""level: levelOf(c.level), ops:""", """level: levelOf(c.level), even: evenOf(c.even), ops:""", 3)
rep("""(COURSE.level ? 'l' + COURSE.level : '') +""", """(COURSE.level ? 'l' + COURSE.level : '') + (COURSE.even?.length ? 'e' + JSON.stringify(COURSE.even) : '') +""")

# ---------------------------------------------------------------- the profile
rep("""// steepest grade of a height profile along the course""", """// Where each waypoint lies on TRACK.pts (an index): the nearest course point near its share of the
// waypoint polygon's length, so a crossing of the course can't pull it onto the other branch.
function wpPtIndex(wp, pts) {
  const n = pts.length - 1, m = wp.length, cum = [0];
  for (let i = 1; i <= m; i++) { const [ax, az] = wp[i - 1], [bx, bz] = wp[i % m]; cum.push(cum[i - 1] + Math.hypot(bx - ax, bz - az)); }
  const w = Math.ceil(n * 0.08);
  return wp.map(([x, z], i) => {
    const c = Math.round(cum[i] / cum[m] * n); let bi = (c % n + n) % n, bd = Infinity;
    for (let j = c - w; j <= c + w; j++) { const k = ((j % n) + n) % n, e = (pts[k].x - x) ** 2 + (pts[k].z - z) ** 2; if (e < bd) { bd = e; bi = k; } }
    return bi;
  });
}
// Even grade: in each section of COURSE.even the profile goes in a straight line from its height at the first
// waypoint to its height at the last (in place); returns how much each course point is graded (1 inside a
// section, eased to 0 over 8 m past its ends) and each section's grade (%), or null without sections.
// A crossing with one branch in a section and the other not: the other is brought to the section's height.
function evenGrade(prof) {
  const P = TRACK.pts, n = P.length - 1, ds = TRACK.len / n, m = COURSE.wp.length;
  const list = (COURSE.even || []).filter(([a, b]) => a < m && b < m && a !== b);
  if (!list.length) return null;
  const idx = wpPtIndex(COURSE.wp, P), G = new Float32Array(n + 1), grades = [], E = Math.max(1, Math.round(8 / ds));
  for (const [a, b] of list) {
    const ia = idx[a], ib = idx[b], span = (ib - ia + n) % n; if (span < 3) continue;
    const h0 = prof[ia], h1 = prof[ib];
    for (let j = 0; j <= span; j++) { const k = (ia + j) % n; prof[k] = lerp(h0, h1, j / span); G[k] = 1; }
    for (let j = 1; j <= E; j++) { const f = 1 - smooth(j / (E + 1)), k0 = (ia - j + n) % n, k1 = (ib + j) % n; G[k0] = Math.max(G[k0], f); G[k1] = Math.max(G[k1], f); }
    grades.push({ a, b, pct: (h1 - h0) / (span * ds) * 100, len: span * ds });
  }
  const K = Math.max(2, Math.round(40 / ds));
  for (const q of TRACK.crossings) {
    const ia = Math.round(q.uA * n) % n, ib = Math.round(q.uB * n) % n;
    if ((G[ia] >= 1) === (G[ib] >= 1)) continue;
    const [fix, keep] = G[ia] >= 1 ? [ib, ia] : [ia, ib], dh = prof[keep] - prof[fix];
    for (let j = -K; j <= K; j++) { const k = (fix + j + n) % n, f = 1 - smooth(Math.abs(j) / K); prof[k] += dh * f; G[k] = Math.max(G[k], f); }
  }
  prof[n] = prof[0]; G[n] = G[0];
  return { G, grades };
}
// steepest grade of a height profile along the course""")

# ---------------------------------------------------------------- groomTrack: sections graded like the levelled road
rep("""rc = Math.ceil((COURSE.level ? LEVEL_RAD : COURSE.bank ? BANK_RAD : RAD) / CELL);""",
    """rc = Math.ceil((COURSE.level || COURSE.even?.length ? LEVEL_RAD : COURSE.bank ? BANK_RAD : RAD) / CELL);""")
rep("""  TRACK.bank = trackBank(); TRACK.grade = null;
  if (COURSE.bank || COURSE.level) {""", """  TRACK.bank = trackBank(); TRACK.grade = null; TRACK.even = null;
  if (COURSE.bank || COURSE.level || COURSE.even?.length) {""")
rep("""    const lv = COURSE.level, prof = lv ? levelProfile(hc, lv / 100) : hc, bk = TRACK.bank;
    if (lv) TRACK.grade = { before: steepestGrade(hc), after: steepestGrade(prof) };""",
    """    const lv = COURSE.level, prof = lv ? levelProfile(hc, lv / 100) : Float32Array.from(hc), bk = TRACK.bank;
    const EV = evenGrade(prof), G = EV?.G; TRACK.even = EV?.grades || null;     // even-grade sections, on top of the levelling
    if (lv) TRACK.grade = { before: steepestGrade(hc), after: steepestGrade(prof) };""")
rep("""      const k = j * V + i; if (D[k] >= (lv ? LEVEL_RAD : BANK_RAD)) continue;""",
    """      const k = j * V + i; if (D[k] >= (lv || G ? LEVEL_RAD : BANK_RAD)) continue;""")
rep("""      if (!lv && !bk[a] && !bk[b]) continue;""", """      const gr = lv ? 1 : G ? at(G) : 0;                 // how much this is graded road (levelled, or an even-grade section)
      if (!gr && !bk[a] && !bk[b]) continue;""")
rep("""      if (!lv) { B[k] = lerp(B[k], tgt, 1 - smooth(clamp((D[k] - 9) / 7, 0, 1))); continue; }""",
    """      if (!gr) { B[k] = lerp(B[k], tgt, 1 - smooth(clamp((D[k] - 9) / 7, 0, 1))); continue; }""")
rep("""      B[k] = lerp(B[k], tgt, w);
      if (D[k] < RAD) C[k] = Math.max(C[k], 0.3 * w);""", """      B[k] = lerp(B[k], tgt, w * gr);
      if (D[k] < RAD) C[k] = Math.max(C[k], 0.3 * w * gr);""")

# ---------------------------------------------------------------- the editor: pick a section, show them, keep them through waypoint edits
rep("""const ed = { on: false, tool: 'wp',""", """const ed = { even: null, undoEven: null, on: false, tool: 'wp',""")
rep("""const wpSelMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false });""",
    """const wpSelMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }), wpEvenMat = new THREE.MeshBasicMaterial({ color: 0x3fd0ff, depthTest: false });
// waypoints in an even-grade section (its ends included), for their colour
function evenWps() {
  const m = COURSE.wp.length, on = new Set();
  for (const [a, b] of COURSE.even || []) { if (a >= m || b >= m) continue; for (let i = a; ; i = (i + 1) % m) { on.add(i); if (i === b) break; } }
  return on;
}
// the waypoints' indices after one is inserted at i (+1) or removed from i (-1): a section keeps its stretch of road
function shiftEven(i, dir) {
  const m = COURSE.wp.length;                         // after the change
  COURSE.even = (COURSE.even || []).map(([a, b]) => dir > 0 ? [a >= i ? a + 1 : a, b >= i ? b + 1 : b]
    : [a > i ? a - 1 : a === i ? i % m : a, b > i ? b - 1 : b === i ? (i - 1 + m) % m : b]).filter(([a, b]) => a !== b && a < m && b < m);
}
// a section's grade as it stands (the ground under the waypoints, along their polygon)
function evenEstimate(a, b) {
  const W = COURSE.wp, m = W.length; let len = 0;
  for (let i = a; i !== b; i = (i + 1) % m) { const [x0, z0] = W[i], [x1, z1] = W[(i + 1) % m]; len += Math.hypot(x1 - x0, z1 - z0); }
  return { len, pct: (heightAt(W[b][0], W[b][1]) - heightAt(W[a][0], W[a][1])) / Math.max(len, 1) * 100 };
}""")
rep("""i === ed.sel ? wpSelMat : i === 0 ? wpStartMat : wpMat""", """i === ed.sel ? wpSelMat : i === 0 ? wpStartMat : evenSet.has(i) ? wpEvenMat : wpMat""")
rep("""  for (const m of wpMeshes) edGroup.remove(m);
  wpMeshes = COURSE.wp.map(""", """  for (const m of wpMeshes) edGroup.remove(m);
  const evenSet = evenWps();
  wpMeshes = COURSE.wp.map(""")
rep("""  COURSE.wp.splice(i, 1); ed.sel = -1; ed.drag = -1; ed.wpDirty = true; updatePreview();""",
    """  COURSE.wp.splice(i, 1); shiftEven(i, -1); ed.sel = -1; ed.drag = -1; ed.wpDirty = true; updatePreview(); showShape();""")
rep("""    W.splice(best + 1, 0, [+clamp(p.x, -168, 168).toFixed(1), +clamp(p.z, -168, 168).toFixed(1)]);""",
    """    W.splice(best + 1, 0, [+clamp(p.x, -168, 168).toFixed(1), +clamp(p.z, -168, 168).toFixed(1)]); shiftEven(best + 1, 1);""")
# picking: the tool's two clicks, before anything else a click does
rep("""renderer.domElement.addEventListener('pointerdown', ev => {
  if (!ed.on || ev.button !== 0) return;""", """renderer.domElement.addEventListener('pointerdown', ev => {
  if (!ed.on || ev.button !== 0) return;
  if (ed.even) {                                      // Even grade: the section's first waypoint, then its last
    let bi = -1, bd = 26;
    COURSE.wp.forEach(([x, z], i) => { const d = screenDist(ev, x, heightAt(x, z) + 1.6, z); if (d < bd) { bd = d; bi = i; } });
    if (bi < 0) { flash('Click a waypoint', '#ffd88a', 1.5); return; }
    if (ed.even.a == null) { ed.even.a = bi; ed.sel = bi; updatePreview(); flash('Now click the last waypoint of the section (forward along the course)', '#fff', 2.6); return; }
    const a = ed.even.a; endEvenPick();
    if (bi === a) { flash('Pick two different waypoints', '#ffd88a', 1.8); return; }
    COURSE.even = [...(COURSE.even || []), [a, bi]].slice(-40); ed.wpDirty = true; ed.sel = -1; updatePreview(); showShape();
    const e = evenEstimate(a, bi);
    flash(`Even grade ${a + 1}→${bi + 1}: ${Math.round(e.len)} m at ${e.pct >= 0 ? '+' : ''}${e.pct.toFixed(1)}% · built on closing`, '#7dff9a', 3.2);
    return;
  }""")
rep("""document.getElementById('eUndoSmooth').addEventListener('click', () => {
  if (!ed.undoWp) return;
  COURSE.wp = ed.undoWp; ed.undoWp = null;""", """document.getElementById('eUndoSmooth').addEventListener('click', () => {
  if (!ed.undoWp) return;
  if (ed.undoEven) { COURSE.even = ed.undoEven; ed.undoEven = null; }
  COURSE.wp = ed.undoWp; ed.undoWp = null;""")
rep("""  ed.undoWp = COURSE.wp; COURSE.wp = r.wp; ed.sel = -1; ed.wpDirty = true; updatePreview(); showShape();""",
    """  ed.undoEven = null;
  if (COURSE.even?.length && r.wp.length !== COURSE.wp.length) { ed.undoEven = COURSE.even; COURSE.even = []; }   // refitted waypoints: the sections' ends are gone (Undo brings them back)
  ed.undoWp = COURSE.wp; COURSE.wp = r.wp; ed.sel = -1; ed.wpDirty = true; updatePreview(); showShape();""")
rep("""  flash(`Curves smoothed: tightest corner ${was} m → ${now} m${short}""", """  flash(`Curves smoothed: tightest corner ${was} m → ${now} m${ed.undoEven ? ' · even-grade sections cleared (Undo smoothing restores them)' : ''}${short}""")
rep("""  document.getElementById('eUndoSmooth').disabled = !ed.undoWp;
};""", """  document.getElementById('eUndoSmooth').disabled = !ed.undoWp;
  const nE = COURSE.even?.length || 0;
  document.getElementById('eEvenClear').disabled = !nE;
  document.getElementById('eEvenClear').textContent = nE ? `Clear even grades (${nE})` : 'Clear even grades';
  document.getElementById('eEven').classList.toggle('on', !!ed.even);
};
function endEvenPick() { ed.even = null; document.getElementById('eEven').classList.remove('on'); }
document.getElementById('eEven').addEventListener('click', e => {
  e.currentTarget.blur();
  if (ed.even) { endEvenPick(); ed.sel = -1; updatePreview(); flash('Even grade: cancelled', '#fff', 1.2); return; }
  ed.even = { a: null }; e.currentTarget.classList.add('on');
  flash('Even grade: click the first waypoint of the section', '#fff', 2.4);
});
document.getElementById('eEvenClear').addEventListener('click', e => {
  e.currentTarget.blur(); if (!COURSE.even?.length) return;
  COURSE.even = []; ed.wpDirty = true; updatePreview(); showShape(); flash('Even-grade sections cleared (built when you close the editor)', '#fff', 2.2);
});""")
# the info line: the sections and their grades as built
rep(""" · ${COURSE.ops.length} terrain strokes`;""", """ · ${COURSE.ops.length} terrain strokes`
    + (COURSE.even?.length ? ` · even grade: ${COURSE.even.map(([a, b]) => { const g = TRACK?.even?.find(q => q.a === a && q.b === b); return `${a + 1}→${b + 1}${g ? ` ${g.pct >= 0 ? '+' : ''}${g.pct.toFixed(1)}%` : ''}`; }).join(', ')}` : '');""")

open(ep, 'w').write(s)
h = open(hp).read()
a = """  <div class="tools"><button id="eOptimise\""""
assert h.count(a) == 1
h = h.replace(a, """  <div class="tools"><button id="eEven" title="Click it, then the first and the last waypoint of a section: the road between them rises or falls at one even grade">Even grade</button><button id="eEvenClear" disabled title="Remove every even-grade section">Clear even grades</button></div>
""" + a)
open(hp, 'w').write(h)
print('even patched')
