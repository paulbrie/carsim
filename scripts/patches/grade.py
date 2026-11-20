# Max. grade and "Optimise the road" (ticket #302): no turn too sharp, no slope too steep, no crest or
# dip too sharp. COURSE.grade (%, 0 = off, 3-15) caps the road's grade: the height profile along the
# course is cut and filled to the nearest one no steeper than that (the mean of the highest profile
# under it and the lowest above it that keep the grade; where the course crosses itself both
# branches count as one point, so they stay at one height), then eased so the grade changes over at
# least g x 200 m either side (crests and dips of 200 m radius or more). Even-grade sections still win.
# A graded road (levelled or held to a max. grade) is graded over the terrain strokes: they are applied first.
# "Optimise the road" also smooths the curves to the min. corner radius, and sets the max. grade to 6%.
# Applies to public/sim after the other patches (... glass, weather, cars, even, bridges):
#   python3 scripts/patches/grade.py <dir with engine.js and index.html>
import sys, os
d = sys.argv[1]
ep, hp = os.path.join(d, 'engine.js'), os.path.join(d, 'index.html')
s = open(ep).read()
h = open(hp).read()

def rep(a, b, n=1, which='s'):
    global s, h
    src = s if which == 's' else h
    c = src.count(a)
    assert c == n, (which, c, n, a[:140])
    if which == 's': s = src.replace(a, b)
    else: h = src.replace(a, b)

# ---------------------------------------------------------------- the field: read wherever a course is read, in its key
rep("""const levelOf = v => clamp(Math.round(+v || 0), 0, 100);""", """const levelOf = v => clamp(Math.round(+v || 0), 0, 100);
// the road's steepest grade, % (0: no limit), the editor's Max. grade slider; Optimise sets OPT_GRADE.
// With a limit the grade also changes gently: crests and dips of VCURVE_R or more
const GRADE_MAX = 15, OPT_GRADE = 6, VCURVE_R = 200;
const gradeOf = v => { const g = Math.round(+v || 0); return g > 0 ? clamp(g, 3, GRADE_MAX) : 0; };""")
rep("""even: evenOf(c.even), ops:""", """even: evenOf(c.even), grade: gradeOf(c.grade), ops:""", 3)
rep("""(COURSE.level ? 'l' + COURSE.level : '') + """, """(COURSE.level ? 'l' + COURSE.level : '') + (COURSE.grade ? 'g' + COURSE.grade : '') + """)

# ---------------------------------------------------------------- the profile
rep("""// steepest grade of a height profile along the course""", """// Max. grade: prof (TRACK.pts heights, in place) brought to the nearest profile no steeper than g (0.06 = 6%):
// the mean of the highest one under it and the lowest one above it that keep that grade (each is
// within g of every other point over the distance between them along the course; a crossing counts as
// one point, so both branches keep one height), so the crests are cut and the troughs filled by as
// much as it takes and no more. Then two moving averages g x VCURVE_R each side: the grade stays under
// g, and changes by at most g over that, so crests and dips have a radius of VCURVE_R or more.
function gradeLimit(prof, g) {
  const n = prof.length - 1, ds = TRACK.len / n, step = g * ds;
  // a crossing counts as one point unless a bridge takes one branch over the other
  const X = TRACK.crossings.filter(q => !bridgedCrossing(q)).map(q => [Math.round(q.uA * n) % n, Math.round(q.uB * n) % n]);
  // sgn 1: the highest profile under p no steeper than g; -1: the lowest above it
  const cone = (p, sgn) => {
    const v = new Float64Array(n); for (let i = 0; i < n; i++) v[i] = sgn * p[i];
    for (let it = 0; it < 60; it++) {
      let ch = false;
      for (let r = 0; r < 2; r++) for (let i = 0; i < n; i++) { const k = (i + 1) % n; if (v[k] > v[i] + step + 1e-7) { v[k] = v[i] + step; ch = true; } }
      for (let r = 0; r < 2; r++) for (let i = n - 1; i >= 0; i--) { const k = (i + n - 1) % n; if (v[k] > v[i] + step + 1e-7) { v[k] = v[i] + step; ch = true; } }
      for (const [a, b] of X) { const m = Math.min(v[a], v[b]); if (v[a] > m || v[b] > m) { v[a] = v[b] = m; ch = true; } }
      if (!ch) break;
    }
    for (let i = 0; i < n; i++) v[i] *= sgn;
    return v;
  };
  const mid = p => { const U = cone(p, 1), L = cone(p, -1); return U.map((u, i) => (u + L[i]) / 2); };
  const box = (p, w) => { const o = new Float64Array(n); let sum = 0;
    for (let j = -w; j <= w; j++) sum += p[(j + n) % n];
    for (let i = 0; i < n; i++) { o[i] = sum / (2 * w + 1); sum += p[(i + w + 1) % n] - p[(i - w + n) % n]; }
    return o; };
  const w = Math.max(1, Math.round(clamp(g * VCURVE_R, 5, 40) / ds));
  let p = box(box(mid(prof), w), w);
  // the averages moved the crossings' branches apart a little: back together, eased over 40 m, and the grade once more
  const K = Math.max(2, Math.round(40 / ds));
  for (const [a, b] of X) { const hm = (p[a] + p[b]) / 2, da = hm - p[a], db = hm - p[b];
    for (let j = -K; j <= K; j++) { const f = 1 - smooth(Math.abs(j) / K); p[(a + j + n) % n] += da * f; p[(b + j + n) % n] += db * f; } }
  p = mid(p);
  for (let i = 0; i < n; i++) prof[i] = p[i];
  prof[n] = prof[0];
}
// the sharpest crest or dip of a height profile: its smallest radius (m) over 10 m either side, leaving out the bridges' ramps
function sharpestCrest(prof) {
  const n = prof.length - 1, ds = TRACK.len / n, b = Math.max(1, Math.round(10 / ds)); let k = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    if (TRACK.bridges.some(X => Math.abs(arcDist(u, X.uOver)) < X.reach || (X.uUnder != null && Math.abs(arcDist(u, X.uUnder)) < 30))) continue;
    k = Math.max(k, Math.abs(prof[(i + b) % n] - 2 * prof[i] + prof[(i - b + n) % n]) / (b * ds) ** 2);
  }
  return k ? 1 / k : Infinity;
}
// steepest grade of a height profile along the course""")

# ---------------------------------------------------------------- a graded road is graded over the terrain strokes: they go first
rep("""  C.fill(0); M.fill(0);
  groomTrack();
  H.set(B);
  for (const op of COURSE.ops) applyOp(op, false);
  H.set(B);""", """  C.fill(0); M.fill(0);
  // a levelled road, or one with a max. grade, is graded over the editor's terrain strokes (the ones off
  // the road stay as they are); otherwise the strokes go on top, as ever
  const graded = COURSE.level || COURSE.grade;
  if (graded) { H.set(B); for (const op of COURSE.ops) applyOp(op, false); }
  groomTrack();
  H.set(B);
  if (!graded) for (const op of COURSE.ops) applyOp(op, false);
  H.set(B);""")

# ---------------------------------------------------------------- grooming: a max. grade grades the road like levelling does
rep("""rc = Math.ceil((COURSE.level || COURSE.even?.length ? LEVEL_RAD""", """rc = Math.ceil((COURSE.level || COURSE.grade || COURSE.even?.length ? LEVEL_RAD""")
rep("""  if (COURSE.bank || COURSE.level || COURSE.even?.length) {""", """  if (COURSE.bank || COURSE.level || COURSE.grade || COURSE.even?.length) {""")
rep("""    const lv = COURSE.level, prof = lv ? levelProfile(hc, lv / 100) : Float32Array.from(hc), bk = TRACK.bank;""",
    """    // lv: the road is graded all round (levelled, or held to a max. grade)
    const lv = COURSE.level || COURSE.grade, prof = COURSE.level ? levelProfile(hc, COURSE.level / 100) : Float32Array.from(hc), bk = TRACK.bank;
    if (COURSE.grade) gradeLimit(prof, COURSE.grade / 100);""")
rep("""    if (lv) TRACK.grade = { before: steepestGrade(hc), after: steepestGrade(prof) };""",
    """    if (lv) TRACK.grade = { before: steepestGrade(hc), after: steepestGrade(prof), crest: COURSE.grade ? sharpestCrest(prof) : null };""")
rep("""const g = TRACK.grade; flash(g ? `Course ready · steepest grade ${Math.round(g.before)}% → ${Math.round(g.after)}%` : 'Course ready', '#7dff9a', g ? 3.5 : 2);""",
    """const g = TRACK.grade; flash(g ? `Course ready · steepest grade ${Math.round(g.before)}% → ${Math.round(g.after)}%${g.crest ? ` · crests and dips ${g.crest > 999 ? 'over 1 km in radius' : `R ${Math.round(g.crest / 10) * 10} m or more`}` : ''}` : 'Course ready', '#7dff9a', g ? 3.5 : 2);""")

# ---------------------------------------------------------------- the editor: Max. grade, and Optimise does it all
rep("""  <div class="tools"><button id="eOptimise" title="Level the road fully and bank every bend for the speed it can be taken at">Optimise the road</button></div>""",
    """  <label title="No stretch of the road steeper than this: cut through the crests and filled across the dips as far as it takes, the grade changing gently (crests and dips of 200 m radius or more)">Max. grade <input id="gradePct" type="range" min="2" max="15" step="1" value="2"> <span id="gradeV" class="val">off</span></label>
  <div class="tools"><button id="eOptimise" title="Smooth the curves to the min. corner radius, level the road fully with no grade over 6%, and bank every bend for the speed it can be taken at">Optimise the road</button></div>""", which='h')
rep("""levelEl = document.getElementById('levelPct');""", """levelEl = document.getElementById('levelPct'), gradeEl = document.getElementById('gradePct');""")
rep("""  document.getElementById('levelV').textContent = COURSE.level ? `${COURSE.level}%` : 'off';""",
    """  document.getElementById('levelV').textContent = COURSE.level ? `${COURSE.level}%` : 'off';
  document.getElementById('gradeV').textContent = COURSE.grade ? `${COURSE.grade}%` : 'off';""")
rep("""bankEl.value = COURSE.bank || 0; levelEl.value = COURSE.level || 0; showShape();""",
    """bankEl.value = COURSE.bank || 0; levelEl.value = COURSE.level || 0; gradeEl.value = COURSE.grade || 2; showShape();""")
rep("""// the road as smooth as it gets: fully levelled, and every bend banked at the angle its speed needs (up to the most there is)
document.getElementById('eOptimise').addEventListener('click', () => {
  if (COURSE.level === 100 && COURSE.bank === BANK_MAX) { flash('The road is already optimised: levelled 100%, bends banked up to 25°', '#ffd88a', 2.4); return; }
  COURSE.level = 100; COURSE.bank = BANK_MAX; levelEl.value = 100; bankEl.value = BANK_MAX; ed.wpDirty = true; showShape();
  flash(`Road optimised: levelled along the course, flat across, bends banked for their speed (up to ${BANK_MAX}°) · built when you close the editor`, '#7dff9a', 3.5);
});
document.getElementById('eSmooth').addEventListener('click', () => {
  const r = smoothCourse(COURSE.wp, ed.rMin), was = Math.round(r.before), now = Math.round(r.after);
  if (r.before >= ed.rMin * 0.97) { flash(`No corner is tighter than ${ed.rMin} m (tightest: ${was} m)`, '#ffd88a', 2.4); return; }""",
    """gradeEl.addEventListener('input', e => { COURSE.grade = +e.target.value <= 2 ? 0 : gradeOf(e.target.value); ed.wpDirty = true; showShape(); });
gradeEl.addEventListener('change', () => flash(COURSE.grade ? `No grade over ${COURSE.grade}% (built when you close the editor)` : 'Max. grade off', '#fff', 2.2));
// the road as smooth as it gets: no corner under the min. radius, fully levelled with no grade over
// OPT_GRADE (or the max. grade if lower) and gentle crests and dips, every bend banked at the angle its speed needs
document.getElementById('eOptimise').addEventListener('click', e => {
  e.currentTarget.blur();
  const sm = smoothCurves(), grade = COURSE.grade ? Math.min(COURSE.grade, OPT_GRADE) : OPT_GRADE;
  if (!sm.changed && COURSE.level === 100 && COURSE.bank === BANK_MAX && COURSE.grade === grade) { flash(`The road is already optimised: no corner under ${ed.rMin} m, levelled, no grade over ${grade}%, bends banked up to ${BANK_MAX}°`, '#ffd88a', 3); return; }
  COURSE.level = 100; COURSE.bank = BANK_MAX; COURSE.grade = grade; levelEl.value = 100; bankEl.value = BANK_MAX; gradeEl.value = grade; ed.wpDirty = true; showShape();
  flash(`Road optimised: ${sm.changed ? sm.msg : `no corner under ${ed.rMin} m`} · levelled, no grade over ${grade}%, gentle crests and dips · bends banked for their speed (up to ${BANK_MAX}°) · built when you close the editor`, sm.lost || sm.short ? '#ffd88a' : '#7dff9a', 5);
});
document.getElementById('eSmooth').addEventListener('click', e => { e.currentTarget.blur(); const r = smoothCurves(); flash(r.msg, r.col, r.dur); });
// Smooth curves (and Optimise): the waypoints reshaped so no corner is tighter than the min. radius (undoable)
function smoothCurves() {
  const r = smoothCourse(COURSE.wp, ed.rMin), was = Math.round(r.before), now = Math.round(r.after);
  if (r.before >= ed.rMin * 0.97) return { changed: false, msg: `No corner is tighter than ${ed.rMin} m (tightest: ${was} m)`, col: '#ffd88a', dur: 2.4 };""")
rep("""  flash(`Curves smoothed: tightest corner ${was} m → ${now} m${ed.undoEven ? ' · even-grade sections cleared (Undo smoothing restores them)' : ''}${short}${lost > 0 ? ` · ${lost} bridge${lost > 1 ? 's' : ''} no longer fit` : ''}`, '#7dff9a', short ? 5 : 3);
});""", """  return { changed: true, short: !!short, lost: lost > 0, col: '#7dff9a', dur: short ? 5 : 3,
    msg: `Curves smoothed: tightest corner ${was} m → ${now} m${ed.undoEven ? ' · even-grade sections cleared (Undo smoothing restores them)' : ''}${short}${lost > 0 ? ` · ${lost} bridge${lost > 1 ? 's' : ''} no longer fit` : ''}` };
}""")

open(ep, 'w').write(s)
open(hp, 'w').write(h)
print('grade patched')
