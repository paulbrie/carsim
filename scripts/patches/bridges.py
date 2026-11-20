# Bridges (ticket #301): what a bridge does to the course around it.
# - Even ramps: each over-pass ramp is one even grade, rounded off over its first and last few metres,
#   from the road's own height RAMP m out up to the deck (no S-curve, no step at the deck).
# - A cutting: at a crossing the under-pass runs CUT m below the ground at the crossing, on even grades
#   in and out, between banks of 1 in 1.5; the deck stands CLEAR m over the cutting's bed, so it sits
#   lower and the ramps up to it are gentler. The levelling no longer brings a bridged crossing's two
#   branches to one height (a hump before each ramp).
# - Straight: the deck follows the road's chord across it; in the editor, adding a bridge (or the
#   COURSE section's "Straighten at bridges") puts the waypoints near it on the deck's line, so the road
#   runs straight over it and into its approaches.
# - Tidy: the abutments reach down to the cutting's bed; beyond their width the embankment starts a
#   few metres past the deck's end (a sloped end, not a cliff).
# Applies to public/sim after the other patches (… cars, even):
#   python3 scripts/patches/bridges.py <dir with engine.js and index.html>
import sys, os
d = sys.argv[1]
ep, hp = os.path.join(d, 'engine.js'), os.path.join(d, 'index.html')
s = open(ep).read()

def rep(a, b, n=1):
    global s
    c = s.count(a)
    assert c == n, (c, n, a[:140])
    s = s.replace(a, b)

def span(a, b, new):
    global s
    assert s.count(a) == 1 and s.count(b) == 1, (s.count(a), s.count(b), a[:80], b[:80])
    i, j = s.index(a), s.index(b)
    assert i < j
    s = s[:i] + new + s[j:]

# ---------------------------------------------------------------- the deck along the road's chord, not its tangent at the crossing
rep("""    const sinA = Math.abs(to.x * tu.z - to.z * tu.x), halfL = clamp(9.5 / Math.max(sinA, 0.3) + 1, 10.5, 33);
    return { kind: 'cross', x: q.x, z: q.z, uOver, uUnder, halfL, tx: to.x, tz: to.z, deckH: DECK_H, ramp: RAMP, auto, reach: halfL + RAMP + 6 };""",
"""    const sinA = Math.abs(to.x * tu.z - to.z * tu.x), halfL = clamp(9.5 / Math.max(sinA, 0.3) + 1, 10.5, 33);
    // the deck is straight: along the chord of the road across it (on a bend the tangent at the crossing points off it)
    const c0 = curve.getPointAt(((uOver - halfL / len) % 1 + 1) % 1), c1 = curve.getPointAt((uOver + halfL / len) % 1), cl = Math.hypot(c1.x - c0.x, c1.z - c0.z) || 1;
    return { kind: 'cross', x: q.x, z: q.z, uOver, uUnder, halfL, tx: (c1.x - c0.x) / cl, tz: (c1.z - c0.z) / cl, deckH: DECK_H, ramp: RAMP, auto, reach: halfL + RAMP + 6 };""")

# ---------------------------------------------------------------- a bridged crossing keeps its two levels
rep("""  for (const q of TRACK.crossings) {
    const ia = Math.round(q.uA * n) % n, ib = Math.round(q.uB * n) % n, hm = (cur[ia] + cur[ib]) / 2, da = hm - cur[ia], db = hm - cur[ib];""",
"""  for (const q of TRACK.crossings) {
    if (bridgedCrossing(q)) continue;                 // a bridge keeps the two branches apart: no common height (#301)
    const ia = Math.round(q.uA * n) % n, ib = Math.round(q.uB * n) % n, hm = (cur[ia] + cur[ib]) / 2, da = hm - cur[ia], db = hm - cur[ib];""")
rep("""  for (const q of TRACK.crossings) {
    const ia = Math.round(q.uA * n) % n, ib = Math.round(q.uB * n) % n;
    if ((G[ia] >= 1) === (G[ib] >= 1)) continue;""", """  for (const q of TRACK.crossings) {
    const ia = Math.round(q.uA * n) % n, ib = Math.round(q.uB * n) % n;
    if (bridgedCrossing(q) || (G[ia] >= 1) === (G[ib] >= 1)) continue;""")
rep("""function levelProfile(hc, s) {""", """const bridgedCrossing = q => TRACK.bridges.some(b => b.kind === 'cross' && Math.hypot(b.x - q.x, b.z - q.z) < 14);
function levelProfile(hc, s) {""")

# ---------------------------------------------------------------- the earthworks
span("// Bridge earthworks: ramps up to the abutments on the over-pass, a flat cut for the under-pass\n",
     "/* ------------------------- terrain edit ops", r"""// Bridge earthworks (#301). Over-pass: ramps of one even grade (rounded off over their ends) from the
// road's own height RAMP m out (up to 1.5 x RAMP, for 8%) to the deck. Under-pass of a crossing: a cutting, CUT m below the ground at
// the crossing under the deck, on even grades of at most 7% in and out, banks of 1 in 1.5; the deck stands
// CLEAR m above its bed (4 m under the girders). A gully bridge digs its wash and ramps up the same way.
const CUT = 2.4, CLEAR = 5.0;
// 0 → 1 at one even grade, rounded off over the first and last e (zero slope at both ends)
const evenRamp = (t, e) => {
  t = clamp(t, 0, 1); const v = 1 / (1 - e);
  if (t < e) return v * t * t / (2 * e);
  if (t > 1 - e) { const r = 1 - t; return 1 - v * r * r / (2 * e); }
  return v * (t - e / 2);
};
function buildEmbankments(X) {
  const P = TRACK.pts, n = P.length - 1, ds = TRACK.len / n, a0 = X.halfL - 0.5, RAMP = X.ramp, gully = X.kind === 'gully';
  const ci0 = Math.round((X.x + HALF) / CELL), cj0 = Math.round((X.z + HALF) / CELL);
  const g0 = B[cj0 * V + ci0], bed = g0 - (gully ? GULLY.depth : CUT), top = gully ? g0 + X.deckH : bed + CLEAR;
  BRIDGES.push({ cx: X.x, cz: X.z, tx: X.tx, tz: X.tz, halfL: X.halfL, halfW: 3.6, top, abut: top - bed + 0.6, kind: X.kind });
  // the ground as it is before any of this, along the course s metres from u0
  const Bat = (x, z) => { const fx = clamp((x + HALF) / CELL, 0, N - 1e-4), fz = clamp((z + HALF) / CELL, 0, N - 1e-4), i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, k = j * V + i;
    return (B[k] * (1 - tx) + B[k + 1] * tx) * (1 - tz) + (B[k + V] * (1 - tx) + B[k + V + 1] * tx) * tz; };
  const hAlong = (u0, s) => { const p = P[((Math.round(u0 * n + s / ds)) % n + n) % n]; return Bat(p.x, p.z); };
  // each ramp: long enough for 8% if it can be (up to 1.5 x RAMP), from the road's own height where it starts
  const foot = [0, 0], RL = [RAMP, RAMP];
  for (const [i, sg] of [[0, -1], [1, 1]]) for (let it = 0; it < 2; it++) { foot[i] = hAlong(X.uOver, sg * (a0 + RL[i])); RL[i] = clamp(Math.abs(top - foot[i]) / 0.08, RAMP, RAMP * 1.5); }
  // the cutting: flat under the deck (±F), then up at ≤ 7% to the road's own height at ±Lc
  const F = 9, Lc = [0, 0], hu = [0, 0];
  if (!gully) for (const [i, sg] of [[0, -1], [1, 1]]) {
    let h = hAlong(X.uUnder, sg * 45); Lc[i] = clamp(F + Math.max(0, h - bed) / 0.07, 24, 45);
    h = hAlong(X.uUnder, sg * Lc[i]); hu[i] = h; Lc[i] = clamp(F + Math.max(0, h - bed) / 0.07, 24, 45);
  }
  const over = [], under = [];
  P.forEach((p, i) => { const u = i / n, so = arcDist(u, X.uOver), su = gully ? 99 : arcDist(u, X.uUnder);
    if (Math.abs(so) < a0 + RAMP * 1.5 + 6) over.push([p.x, p.z, i]); if (Math.abs(su) < 52) under.push([p.x, p.z, i]); });
  // [distance to the course, arc distance from u0 along it], measured between course points (alongCourse)
  const nearest = (list, x, z, u0) => { let bd = 1e9, bi = -1; for (const [px, pz, i] of list) { const d = (px - x) ** 2 + (pz - z) ** 2; if (d < bd) { bd = d; bi = i; } }
    if (bi < 0) return [1e5, 0];
    const [a, b, t] = alongCourse(bi, x, z); return [Math.hypot(x - lerp(P[a].x, P[b].x, t), z - lerp(P[a].z, P[b].z, t)), arcDist((a + t) / n, u0)]; };
  const R0 = Math.max(a0 + RAMP * 1.5 + 14, gully ? 0 : 45 + 16), rc = Math.ceil(R0 / CELL);
  for (let j = Math.max(1, cj0 - rc); j <= Math.min(N - 1, cj0 + rc); j++) for (let i = Math.max(1, ci0 - rc); i <= Math.min(N - 1, ci0 + rc); i++) {
    const x = -HALF + i * CELL, z = -HALF + j * CELL, k = j * V + i;
    if (gully) {         // a dry wash dug across the course under the deck, with sloping banks
      const la = Math.abs((x - X.x) * X.tx + (z - X.z) * X.tz), lb = Math.abs((z - X.z) * X.tx - (x - X.x) * X.tz);
      const wd = (1 - smooth(clamp((la - (a0 - 4.5)) / 4, 0, 1))) * (1 - smooth(clamp((lb - 20) / 14, 0, 1)));
      if (wd > 0) { B[k] = Math.min(B[k], lerp(B[k], bed, wd)); C[k] = Math.max(C[k], 0.25 * wd); if (wd > 0.15) RM[k] = 0; }   // the wash bed is never paved
    } else {
      const [du, su] = nearest(under, x, z, X.uUnder), as = Math.abs(su), sd = su < 0 ? 0 : 1;
      if (as < Lc[sd] && du < 5.5 + 12) {          // the cutting: the road at its grade, banks of 1 in 1.5 up to the ground
        const t = as <= F ? bed : bed + (hu[sd] - bed) * evenRamp((as - F) / (Lc[sd] - F), 0.25);
        if (du < 5.5) { B[k] = t; C[k] = Math.max(C[k], 0.35); }
        else B[k] = Math.min(B[k], t + (du - 5.5) / 1.5);
      }
    }
    const [dov, so] = nearest(over, x, z, X.uOver);
    const a = Math.abs(so);
    const sd = so < 0 ? 0 : 1;
    if (a < a0 || a > a0 + RL[sd] || dov > 11) continue;
    const prof = top - (top - foot[sd]) * evenRamp((a - a0) / RL[sd], 0.2);           // even grade, down from the deck
    const wl = 1 - smooth(clamp((dov - 5) / 6, 0, 1));                               // flat top 5 m each side, then a side slope
    const we = dov <= 4.8 ? 1 : smooth(clamp((a - a0) / 4, 0, 1));                    // past the abutment's width: a sloped end, not a cliff
    B[k] = lerp(B[k], prof, wl * we); C[k] = Math.max(C[k], 0.5 * wl * we);
  }
}

""")

# ---------------------------------------------------------------- the editor: straighten the road at bridges
rep("""// remove a waypoint (Shift/Alt/Ctrl+click, double-click, or select it and press Delete / Backspace)""",
"""// Straighten the upper road at each bridge (or at the one nearest `near`): the waypoints over the deck and 14 m
// past its ends give way to four on the deck's line (2 m and 14 m past each end), so the road runs straight
// over the deck and into its approaches. Even-grade sections keep their stretch. Returns the number straightened.
function straightenBridges(near) {
  let done = 0;
  const todo = buildTrack(COURSE.wp).bridges.filter(b => !near || Math.hypot(b.x - near.x, b.z - near.z) < 20).map(b => ({ x: b.x, z: b.z }));
  for (const at of todo) {
    const T = buildTrack(COURSE.wp), b = T.bridges.find(q => Math.hypot(q.x - at.x, q.z - at.z) < 20); if (!b) continue;
    const P = T.pts, n = P.length - 1, ds = T.len / n, W = COURSE.wp, m = W.length, idx = wpPtIndex(W, P), i0 = Math.round(b.uOver * n) % n;
    const S = b.halfL + 14, off = i => { let d = idx[i] - i0; if (d > n / 2) d -= n; if (d < -n / 2) d += n; return d * ds; };
    // its direction along the course
    const tq = P[(i0 + 1) % n], tp = P[(i0 - 1 + n) % n], sg = Math.sign((tq.x - tp.x) * b.tx + (tq.z - tp.z) * b.tz) || 1, dx = b.tx * sg, dz = b.tz * sg;
    const zone = []; for (let i = 0; i < m; i++) if (Math.abs(off(i)) < S + 4) zone.push(i);
    if (zone.includes(0) || m - zone.length + 4 < 4) continue;               // the start waypoint is there: leave it
    let at0 = zone.length ? Math.min(...zone) : -1;
    if (at0 < 0) for (let i = 1; i < m; i++) if (off(i - 1) < 0 && off(i) >= 0) { at0 = i; break; }   // none there: between its neighbours
    if (at0 < 1) continue;                                                     // (never before the start waypoint)
    for (const i of [...zone].sort((p, q) => q - p)) { W.splice(i, 1); shiftEven(i, -1); }
    const put = [-S, -(b.halfL + 2), b.halfL + 2, S].map(sd => [+clamp(b.x + dx * sd, -168, 168).toFixed(1), +clamp(b.z + dz * sd, -168, 168).toFixed(1)]);
    put.forEach((p, k) => { W.splice(at0 + k, 0, p); shiftEven(at0 + k, 1); });
    done++;
  }
  return done;
}
// remove a waypoint (Shift/Alt/Ctrl+click, double-click, or select it and press Delete / Backspace)""")
rep("""  const nb = t2.bridges.find(b => b.src === pb);
  if (nb.kind === 'cross') COURSE.noBridge = COURSE.noBridge.filter(r => Math.hypot(r.x - nb.x, r.z - nb.z) >= 14);
  ed.wpDirty = true; updatePreview(); flash(nb.kind === 'cross' ? 'Bridge added: this branch goes over' : 'Bridge added over a dug wash', '#7dff9a', 1.8);""",
"""  const nb = t2.bridges.find(b => b.src === pb);
  if (nb.kind === 'cross') COURSE.noBridge = COURSE.noBridge.filter(r => Math.hypot(r.x - nb.x, r.z - nb.z) >= 14);
  const wp0 = COURSE.wp.map(p => p.slice()), ev0 = COURSE.even?.map(r => r.slice());
  const st = straightenBridges(nb) > 0 && buildTrack(COURSE.wp).bridges.some(b => Math.hypot(b.x - nb.x, b.z - nb.z) < 20);
  if (st) { ed.undoWp = wp0; ed.undoEven = ev0 ?? null; } else { COURSE.wp = wp0; if (ev0) COURSE.even = ev0; }
  ed.wpDirty = true; updatePreview(); showShape(); flash((nb.kind === 'cross' ? 'Bridge added: this branch goes over' : 'Bridge added over a dug wash') + (st ? ' · the road straightened across it (Undo puts it back)' : ''), '#7dff9a', 2.4);""")
rep("""document.getElementById('eUndoSmooth').addEventListener('click', () => {""", """document.getElementById('eStraight').addEventListener('click', e => {
  e.currentTarget.blur();
  const wp0 = COURSE.wp.map(p => p.slice()), ev0 = COURSE.even?.map(r => r.slice()), before = buildTrack(COURSE.wp).bridges.length;
  const k = straightenBridges();
  if (!k) { flash(before ? 'Nothing to straighten (a bridge by the start waypoint is left as it is)' : 'No bridges on this course', '#ffd88a', 2.2); return; }
  if (buildTrack(COURSE.wp).bridges.length < before) { COURSE.wp = wp0; if (ev0) COURSE.even = ev0; flash('Straightening would lose a bridge: left as it was', '#ff8a7a', 2.4); return; }
  ed.undoWp = wp0; ed.undoEven = ev0 ?? null; ed.sel = -1; ed.wpDirty = true; updatePreview(); showShape();
  flash(`The road straightened at ${k} bridge${k > 1 ? 's' : ''} (Undo puts it back)`, '#7dff9a', 2.4);
});
document.getElementById('eUndoSmooth').addEventListener('click', () => {""")
rep("""updatePreview(); showShape(); flash('Smoothing undone', '#fff', 1.5);""", """updatePreview(); showShape(); flash('Undone', '#fff', 1.5);""")

open(ep, 'w').write(s)
h = open(hp).read()
for a, b in [("""<div class="tools"><button data-tool="wp">Waypoints</button><button data-tool="bridge">Bridges</button></div>""",
              """<div class="tools"><button data-tool="wp">Waypoints</button><button data-tool="bridge">Bridges</button><button id="eStraight" title="Put the waypoints near each bridge on its deck's line, so the road runs straight over it and its approaches">Straighten at bridges</button></div>"""),
             ("""<button id="eUndoSmooth" disabled>Undo smoothing</button>""", """<button id="eUndoSmooth" disabled title="Undo the last Smooth curves or Straighten at bridges">Undo</button>""")]:
    assert h.count(a) == 1, a
    h = h.replace(a, b)
open(hp, 'w').write(h)
print('bridges patched')
