# Course editor: "Level the road" and "Optimise the road" (ticket #290). The road's height profile is
# smoothed along the course (cut through the dune crests, filled across the troughs, the same height
# where the course crosses itself), flat across but for the banking, with the cut and fill sloping
# back into the dunes; "Optimise the road" levels it fully and banks every bend for its speed.
# Applies to public/sim/engine.js and index.html after the other patches (and mp-block.js's
# mpCourseFrom keeps `level` too):
#   python3 scripts/patches/road-level.py <dir with engine.js and index.html>
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

# ---------------------------------------------------------------- the course keeps a levelling (0-100 %)
rep("""const bankOf = v => clamp(Math.round(+v || 0), 0, BANK_MAX);""",
    """const bankOf = v => clamp(Math.round(+v || 0), 0, BANK_MAX);
const levelOf = v => clamp(Math.round(+v || 0), 0, 100);       // %, the editor's Level the road slider""")
rep("""COURSE = { wp: c.wp, bank: bankOf(c.bank), ops:""", """COURSE = { wp: c.wp, bank: bankOf(c.bank), level: levelOf(c.level), ops:""")
rep("""    COURSE = { wp: c.wp.map(([x, z]) => [+x, +z]), bank: bankOf(c.bank), ops:""",
    """    COURSE = { wp: c.wp.map(([x, z]) => [+x, +z]), bank: bankOf(c.bank), level: levelOf(c.level), ops:""")
# levelling changes lap times: its own best laps
rep("""(COURSE.bank ? 'b' + COURSE.bank : '') + """, """(COURSE.bank ? 'b' + COURSE.bank : '') + (COURSE.level ? 'l' + COURSE.level : '') + """)

# ---------------------------------------------------------------- the levelled profile
rep("""function trackBank() {""", """// Levelling: the height of the course's centre line (hc, one per TRACK.pts) smoothed along the course,
// three passes of a ±32 m moving average (half a dune's wavelength each side: the crests go, the
// long slopes of the land stay), blended with hc by s (0-1). Where the course crosses itself, both
// branches are brought to the same height, eased in over 40 m either side.
function levelProfile(hc, s) {
  const n = hc.length - 1, ds = TRACK.len / n, w = Math.max(1, Math.round(32 / ds));
  let cur = Float32Array.from(hc.subarray(0, n));
  for (let pass = 0; pass < 3; pass++) {
    const nx = new Float32Array(n); let sum = 0;
    for (let j = -w; j <= w; j++) sum += cur[(j + n) % n];
    for (let i = 0; i < n; i++) { nx[i] = sum / (2 * w + 1); sum += cur[(i + w + 1) % n] - cur[(i - w + n) % n]; }
    cur = nx;
  }
  for (let i = 0; i < n; i++) cur[i] = lerp(hc[i], cur[i], s);
  const K = Math.max(2, Math.round(40 / ds));
  for (const q of TRACK.crossings) {
    const ia = Math.round(q.uA * n) % n, ib = Math.round(q.uB * n) % n, hm = (cur[ia] + cur[ib]) / 2, da = hm - cur[ia], db = hm - cur[ib];
    for (let j = -K; j <= K; j++) { const f = 1 - smooth(Math.abs(j) / K); cur[(ia + j + n) % n] += da * f; cur[(ib + j + n) % n] += db * f; }
  }
  const out = new Float32Array(n + 1); out.set(cur); out[n] = out[0];
  return out;
}
// steepest grade of a height profile along the course, in %, over 10 m, leaving out the bridges' ramps
function steepestGrade(prof) {
  const n = prof.length - 1, ds = TRACK.len / n, hw = Math.max(1, Math.round(5 / ds)); let g = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    if (TRACK.bridges.some(b => Math.abs(arcDist(u, b.uOver)) < b.reach || (b.uUnder != null && Math.abs(arcDist(u, b.uUnder)) < 30))) continue;
    g = Math.max(g, Math.abs(prof[(i + hw) % n] - prof[(i - hw + n) % n]) / (2 * hw * ds));
  }
  return g * 100;
}

function trackBank() {""")

# ---------------------------------------------------------------- grooming: level, flat across, banked
rep("""  const D = new Float32Array(V * V).fill(99), I = new Int32Array(V * V), RAD = 10, BANK_RAD = 16, rc = Math.ceil((COURSE.bank ? BANK_RAD : RAD) / CELL);""",
    """  // (out to 24 m when levelling: its cut and fill slopes reach further)
  const D = new Float32Array(V * V).fill(99), I = new Int32Array(V * V), RAD = 10, BANK_RAD = 16, LEVEL_RAD = 24, LEVEL_W = 8, rc = Math.ceil((COURSE.level ? LEVEL_RAD : COURSE.bank ? BANK_RAD : RAD) / CELL);""")
rep("""  // banking: across the course the ground rises toward the outside of each bend, level with the
  // groomed centre line, full width to 9 m out, then back into the dunes by 16 m
  TRACK.bank = trackBank();
  if (COURSE.bank) {""", """  // banking: across the course the ground rises toward the outside of each bend, level with the
  // groomed centre line, full width to 9 m out, then back into the dunes by 16 m.
  // Levelling (COURSE.level): the centre line follows levelProfile instead, the road is that height
  // across (plus the banking) to 8 m out, and the cut or fill slopes back into the dunes at about
  // 1 in 2.5 (4 to 16 m wide).
  TRACK.bank = trackBank(); TRACK.grade = null;
  if (COURSE.bank || COURSE.level) {""")
rep("""      hc[i] = Bat(P[i].x, P[i].z); nx[i] = -(c.z - a.z) / tl; nz[i] = (c.x - a.x) / tl;
    }
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const k = j * V + i; if (D[k] >= BANK_RAD) continue;
      const pi = I[k], sl = TRACK.bank[pi]; if (!sl) continue;
      const p = P[pi], l = (-HALF + i * CELL - p.x) * nx[pi] + (-HALF + j * CELL - p.z) * nz[pi];
      B[k] = lerp(B[k], hc[pi] + l * sl, 1 - smooth(clamp((D[k] - 9) / 7, 0, 1)));
    }""", """      hc[i] = Bat(P[i].x, P[i].z); nx[i] = -(c.z - a.z) / tl; nz[i] = (c.x - a.x) / tl;
    }
    const lv = COURSE.level, prof = lv ? levelProfile(hc, lv / 100) : hc;
    if (lv) TRACK.grade = { before: steepestGrade(hc), after: steepestGrade(prof) };
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const k = j * V + i; if (D[k] >= (lv ? LEVEL_RAD : BANK_RAD)) continue;
      const pi = I[k], sl = TRACK.bank[pi]; if (!sl && !lv) continue;
      const p = P[pi], l = (-HALF + i * CELL - p.x) * nx[pi] + (-HALF + j * CELL - p.z) * nz[pi], tgt = prof[pi] + l * sl;
      if (!lv) { B[k] = lerp(B[k], tgt, 1 - smooth(clamp((D[k] - 9) / 7, 0, 1))); continue; }
      const w = 1 - smooth(clamp((D[k] - LEVEL_W) / clamp(2.5 * Math.abs(tgt - B[k]), 4, LEVEL_RAD - LEVEL_W), 0, 1));
      B[k] = lerp(B[k], tgt, w);
      if (D[k] < RAD) C[k] = Math.max(C[k], 0.3 * w);     // packed ground across the graded width
    }""")

# ---------------------------------------------------------------- the editor
rep("""  <label title="Tilt the ground under each bend toward its inside, steeper in tighter bends, up to this angle">Banking <input id="bankDeg" type="range" min="0" max="25" step="1" value="0"> <span id="bankV" class="val">off</span></label>""",
    """  <label title="Tilt the ground under each bend toward its inside, steeper in tighter bends, up to this angle">Banking <input id="bankDeg" type="range" min="0" max="25" step="1" value="0"> <span id="bankV" class="val">off</span></label>
  <label title="Smooth the road's rise and fall along the course: cut through the dune crests, fill the troughs, and keep it flat across (but for the banking)">Level the road <input id="levelPct" type="range" min="0" max="100" step="5" value="0"> <span id="levelV" class="val">off</span></label>
  <div class="tools"><button id="eOptimise" title="Level the road fully and bank every bend for the speed it can be taken at">Optimise the road</button></div>""", 'h')
rep("""const sRadEl = document.getElementById('sRad'), bankEl = document.getElementById('bankDeg');""",
    """const sRadEl = document.getElementById('sRad'), bankEl = document.getElementById('bankDeg'), levelEl = document.getElementById('levelPct');""")
rep("""  document.getElementById('bankV').textContent = COURSE.bank ? `${COURSE.bank}°` : 'off';""",
    """  document.getElementById('bankV').textContent = COURSE.bank ? `${COURSE.bank}°` : 'off';
  document.getElementById('levelV').textContent = COURSE.level ? `${COURSE.level}%` : 'off';""")
rep("""document.getElementById('eSmooth').addEventListener('click', () => {""", """levelEl.addEventListener('input', e => { COURSE.level = levelOf(e.target.value); ed.wpDirty = true; showShape(); });
levelEl.addEventListener('change', () => flash(COURSE.level ? `Road levelled ${COURSE.level}% (built when you close the editor)` : 'Levelling off', '#fff', 2.2));
// the road as smooth as it gets: fully levelled, and every bend banked at the angle its speed needs (up to the most there is)
document.getElementById('eOptimise').addEventListener('click', () => {
  if (COURSE.level === 100 && COURSE.bank === BANK_MAX) { flash('The road is already optimised: levelled 100%, bends banked up to 25°', '#ffd88a', 2.4); return; }
  COURSE.level = 100; COURSE.bank = BANK_MAX; levelEl.value = 100; bankEl.value = BANK_MAX; ed.wpDirty = true; showShape();
  flash(`Road optimised: levelled along the course, flat across, bends banked for their speed (up to ${BANK_MAX}°) · built when you close the editor`, '#7dff9a', 3.5);
});
document.getElementById('eSmooth').addEventListener('click', () => {""")
rep("""    ed.undoWp = null; bankEl.value = COURSE.bank || 0; showShape();""",
    """    ed.undoWp = null; bankEl.value = COURSE.bank || 0; levelEl.value = COURSE.level || 0; showShape();""")
# how much flatter it got
rep("""      setTimeout(() => { regenerateWorld(); showBusy(''); flash('Course ready', '#7dff9a', 2); }, 30);""",
    """      setTimeout(() => { regenerateWorld(); showBusy(''); const g = TRACK.grade; flash(g ? `Course ready · steepest grade ${Math.round(g.before)}% → ${Math.round(g.after)}%` : 'Course ready', '#7dff9a', g ? 3.5 : 2); }, 30);""")

open(ep, 'w').write(s)
open(hp, 'w').write(h)
print('road-level patched')
