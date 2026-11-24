# The course editor shows every change as it will be driven (#326): the world (road, ground, banking, levelling, grades,
# bridges and their earthworks, gates) is rebuilt while the editor stays open, a moment after each change (not while a
# waypoint is dragged or a brush paints), instead of when it closes; closing it then has nothing left to build.
# Also a faster nearest-point search in the bridges' earthworks (buildEmbankments, the most of a rebuild's time): the same ground.
# Applies to public/sim/engine.js and index.html last in the chain (after ui.py):
#   python3 scripts/patches/live.py <dir with engine.js and index.html>
import sys, os
ep = os.path.join(sys.argv[1], 'engine.js'); hp = os.path.join(sys.argv[1], 'index.html')
s = open(ep).read()

def rep(a, b):
    global s
    n = s.count(a)
    assert n == 1, (n, a[:140])
    s = s.replace(a, b)

# --- the earthworks' nearest course point (most of a rebuild's time: a scan of every point for every cell around a bridge):
# a field of them made once per list instead, the same points found, so the same ground
rep("""  const nearest = (list, x, z, u0) => { let bd = 1e9, bi = -1; for (const [px, pz, i] of list) { const d = (px - x) ** 2 + (pz - z) ** 2; if (d < bd) { bd = d; bi = i; } }
    if (bi < 0) return [1e5, 0];""", """  // (#326) each list's nearest point for every cell, found as groomTrack finds its own: each point's square in turn, in list
  // order (a tie goes to the first, as a scan of the list does), out to just past the farthest the earthworks look (the
  // cutting: CW + 12, the ramp's side slope: FT + 6): beyond that a cell is left as it is, whichever point is nearest
  let WIN = null;
  const field = (list, R) => {
    const w = WIN ||= { i0: Math.max(1, ci0 - rc), i1: Math.min(N - 1, ci0 + rc), j0: Math.max(1, cj0 - rc), j1: Math.min(N - 1, cj0 + rc) }, W = w.i1 - w.i0 + 1;
    const D = new Float64Array(W * (w.j1 - w.j0 + 1)).fill(Infinity), I = new Int32Array(D.length).fill(-1), nr = Math.ceil(R / CELL);
    for (const [px, pz, pi] of list) {
      const pci = Math.round((px + HALF) / CELL), pcj = Math.round((pz + HALF) / CELL);
      for (let j = Math.max(w.j0, pcj - nr), jm = Math.min(w.j1, pcj + nr); j <= jm; j++) for (let i = Math.max(w.i0, pci - nr), im = Math.min(w.i1, pci + nr); i <= im; i++) {
        const x = -HALF + i * CELL, z = -HALF + j * CELL, d = (px - x) ** 2 + (pz - z) ** 2, k = (j - w.j0) * W + i - w.i0;
        if (d < D[k]) { D[k] = d; I[k] = pi; }
      }
    }
    return I;
  };
  const nearest = (list, x, z, u0) => {
    const F = list.field ||= field(list, list === under ? CW + 14 : FT + 8), w = WIN;
    const bi = F[(Math.round((z + HALF) / CELL) - w.j0) * (w.i1 - w.i0 + 1) + Math.round((x + HALF) / CELL) - w.i0];
    if (bi < 0) return [1e5, 0];""")

# --- groomTrack's distance to the course (the most of what is left): its distances from a table, not Math.hypot for each cell
# of each course point's square (the same values, the same order: the same ground)
rep("""  TRACK.pts.forEach((p, pi) => {
    const ci = Math.round((p.x + HALF) / CELL), cj = Math.round((p.z + HALF) / CELL);
    for (let dj = -rc; dj <= rc; dj++) for (let di = -rc; di <= rc; di++) {
      const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i > N || j > N) continue;
      const d = Math.hypot(di, dj) * CELL, k = j * V + i;
      if (d < D[k]) { D[k] = d; I[k] = pi; }
    }
  });""", """  // (#326: the distances from a table, the same Math.hypot values; the rows clipped to the world once, not each cell)
  const span = 2 * rc + 1, DT = new Float64Array(span * span);
  for (let dj = -rc; dj <= rc; dj++) for (let di = -rc; di <= rc; di++) DT[(dj + rc) * span + di + rc] = Math.hypot(di, dj) * CELL;
  TRACK.pts.forEach((p, pi) => {
    const ci = Math.round((p.x + HALF) / CELL), cj = Math.round((p.z + HALF) / CELL), di0 = Math.max(-rc, -ci), di1 = Math.min(rc, N - ci);
    for (let dj = Math.max(-rc, -cj), dj1 = Math.min(rc, N - cj); dj <= dj1; dj++) {
      const row = (dj + rc) * span + rc, kr = (cj + dj) * V + ci;
      for (let di = di0; di <= di1; di++) { const d = DT[row + di], k = kr + di; if (d < D[k]) { D[k] = d; I[k] = pi; } }
    }
  });""")

# --- the live rebuild: watched from the editor's frame
rep("""function updateEditor(dt) {
""", """// ---------- live rebuild (#326) ----------
// A change (anything that sets ed.wpDirty or ed.opsDirty) is built once the course has stayed the same for LIVE_WAIT s and no
// waypoint is held or brush painting: the whole world for the course's own changes (regenerateWorld), the road over the
// ground for terrain strokes alone (as closing the editor did). The note under the editor's numbers says which.
const LIVE_WAIT = 0.35, LIVE = { key: null, t: 0, busy: false };
const liveEl = document.getElementById('eLive');
const liveNote = (msg, busy) => { liveEl.textContent = msg; liveEl.classList.toggle('busy', !!busy); };
function liveFrame(dt) {
  if (!ed.wpDirty && !ed.opsDirty) { LIVE.key = null; return; }
  const k = courseKey() + '|' + COURSE.ops.length;
  if (k !== LIVE.key) { LIVE.key = k; LIVE.t = 0; liveNote('Changed: building it in a moment…', true); }
  if (ed.drag >= 0 || ed.painting || LIVE.busy || (LIVE.t += dt) < LIVE_WAIT) return;
  LIVE.busy = true; liveNote('Building the course…', true);
  // two frames: the note is on the screen before the page is busy
  requestAnimationFrame(() => requestAnimationFrame(() => {
    try {
      if (!ed.on) return;                                       // closed meanwhile: closing built it
      const regen = ed.wpDirty;
      if (regen) regenerateWorld(); else { buildCircuit(); highlightGate(); resetCar(car.pos.x, car.pos.z); updateFar(); }
      ed.wpDirty = false; ed.opsDirty = false; LIVE.key = null;
      updatePreview();                                          // the markers on the ground as built
      const g = regen && TRACK.grade;
      liveNote(g ? `Built: steepest grade ${Math.round(g.before)}% → ${Math.round(g.after)}%${g.crest ? ` · crests and dips ${g.crest > 999 ? 'over 1 km in radius' : `R ${Math.round(g.crest / 10) * 10} m or more`}` : ''}` : 'Built: what you see is what you will drive');
    } catch (err) { console.warn('live rebuild:', err); liveNote('Could not build this course: see the console', true); }
    finally { LIVE.busy = false; }
  }));
}
function updateEditor(dt) {
  liveFrame(dt);
""")
# opening the editor: nothing changed yet
rep("""    ed.wpDirty = false; ed.opsDirty = false;
    camMode = 3; orbit.enabled = true;""", """    ed.wpDirty = false; ed.opsDirty = false; LIVE.key = null; liveNote('Every change is built as you make it');
    camMode = 3; orbit.enabled = true;""")

# --- the messages that said a change waits for the editor to close
rep("""flash('Terrain edits cleared (applied when you close the editor)', '#fff', 2.5);""", """flash('Terrain edits cleared', '#fff', 2);""")
rep("""flash('Even-grade sections cleared (built when you close the editor)', '#fff', 2.2);""", """flash('Even-grade sections cleared', '#fff', 2);""")
rep("""flash(COURSE.bank ? `Bends banked up to ${COURSE.bank}° (built when you close the editor)` : 'Banking off', '#fff', 2.2)""", """flash(COURSE.bank ? `Bends banked up to ${COURSE.bank}°` : 'Banking off', '#fff', 2)""")
rep("""flash(COURSE.level ? `Road levelled ${COURSE.level}% (built when you close the editor)` : 'Levelling off', '#fff', 2.2)""", """flash(COURSE.level ? `Road levelled ${COURSE.level}%` : 'Levelling off', '#fff', 2)""")
rep("""flash(COURSE.grade ? `No grade over ${COURSE.grade}% (built when you close the editor)` : 'Max. grade off', '#fff', 2.2)""", """flash(COURSE.grade ? `No grade over ${COURSE.grade}%` : 'Max. grade off', '#fff', 2)""")
rep("""bends banked for their speed (up to ${BANK_MAX}°) · built when you close the editor`""", """bends banked for their speed (up to ${BANK_MAX}°)`""")
rep("""% · built on closing`""", """%`""")
rep("""// A generated course replaces the editor's (the one before it: Back, up to 20); built when the editor closes, as any edit.""",
    """// A generated course replaces the editor's (the one before it: Back, up to 20); built at once, as any edit (live.py).""")
open(ep, 'w').write(s)

h = open(hp).read()
def hrep(a, b):
    global h
    n = h.count(a)
    assert n == 1, (n, a[:140])
    h = h.replace(a, b)
hrep("""  <div class="info" id="eInfo"></div>""", """  <div class="info" id="eInfo"></div>
  <div class="hint" id="eLive"></div>""")
hrep("""  #editor .info{font-size:12px;color:#ffd88a;margin:4px 0 8px}""", """  #editor .info{font-size:12px;color:#ffd88a;margin:4px 0 8px}
  #editor #eLive{margin:-4px 0 8px;color:#9fe0b0;min-height:1.3em}
  #editor #eLive.busy{color:#ffd88a}""")
open(hp, 'w').write(h)
print('live patched')
