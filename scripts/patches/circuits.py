# Circuit generator (#315): the course editor's GENERATE (a closed circuit from a seed, a length and a style, its
# corners no tighter than SHAPE's Min. corner radius, levelled, graded and banked like the maps) and MY CIRCUITS
# (courses kept in this browser under a name, loaded in one click: each keeps its own best laps and autopilot
# trainings, which go by the course). The generator itself is public/sim/circuit-gen.js, loaded when first used
# (scripts/maps/generate.mjs runs the same one in node for map files).
# Applies to public/sim/engine.js and index.html after pause.py (before bridge.py):
#   python3 scripts/patches/circuits.py <dir with engine.js and index.html>
import sys, os
ep = os.path.join(sys.argv[1], 'engine.js'); hp = os.path.join(sys.argv[1], 'index.html')
s = open(ep).read()

def rep(a, b):
    global s
    n = s.count(a)
    assert n == 1, (n, a[:140])
    s = s.replace(a, b)

rep("""document.getElementById('eSmooth').addEventListener('click', e => {""", """// ---------- GENERATE a circuit and MY CIRCUITS (#315) ----------
// A generated course replaces the editor's (the one before it: Back, up to 20); built when the editor closes, as any edit.
// It keeps the ground (Sand / Earth / Road) and has no terrain strokes, bridges or even grades of its own.
const GEN = { style: localStorage.getItem('carsim.gen.style') || 'mixed', back: [], mod: null, busy: false, last: null, short: '' };
const CIRCUITS_KEY = 'carsim.circuits';                    // [{ name, course, len, at, gen? }] (not 'sandbuggy.': the autopilot's workers boot with those)
const gKm = document.getElementById('gKm'), gSeed = document.getElementById('gSeed'), cList = document.getElementById('cList');
const courseCopy = c => JSON.parse(JSON.stringify(c));
const wpSig = wp => JSON.stringify(wp);
function genShow() {
  document.getElementById('gKmV').textContent = `${(+gKm.value).toFixed(1)} km`;
  edEl.querySelectorAll('[data-gs]').forEach(b => b.classList.toggle('on', b.dataset.gs === GEN.style));
  document.getElementById('gBack').disabled = !GEN.back.length;
  document.getElementById('gNote').textContent = GEN.short && GEN.last?.sig === wpSig(COURSE.wp) ? GEN.short : `Corners no tighter than ${ed.rMin} m (Min. corner radius, under SHAPE)`;
  libShow();
}
// the editor's course becomes c (back: it goes on the Back list)
function genSet(c, back = true) {
  if (back) { GEN.back.push(courseCopy(COURSE)); if (GEN.back.length > 20) GEN.back.shift(); }
  COURSE = c;
  ed.undoWp = null; ed.undoEven = null; ed.sel = -1; ed.drag = -1; endEvenPick(); ed.wpDirty = true;
  bankEl.value = COURSE.bank || 0; levelEl.value = COURSE.level || 0; gradeEl.value = COURSE.grade || 2;
  showShape(); updatePreview(); genShow();
}
const genLoad = async () => GEN.mod ||= await import(new URL('circuit-gen.js', import.meta.url).href);
async function genMake(seed) {
  if (GEN.busy) return;
  GEN.busy = true; gSeed.value = seed;
  try {
    await genLoad();
    const km = +gKm.value, style = GEN.style, rMin = ed.rMin, c = GEN.mod.generateCircuit({ seed, km, style, rMin });
    if (!c) { flash(`No circuit fits with ${rMin} m corners: lower the Min. corner radius (SHAPE)`, '#ff8a7a', 3); return; }
    GEN.last = { seed: c.seed, km, style, rMin, len: Math.round(c.len), sig: wpSig(c.wp) };
    GEN.short = c.len < km * 1000 * 0.94 ? `${(c.len / 1000).toFixed(2)} km: the longest this seed fits in the world with ${rMin} m corners (a lower Min. corner radius makes room for more)` : '';
    genSet({ wp: c.wp, bank: 8, level: 100, even: [], grade: OPT_GRADE, ops: [], base: COURSE.base, road: !!COURSE.road, bridges: [], noBridge: [] });
    flash(`Circuit ${c.seed}: ${(c.len / 1000).toFixed(2)} km · built when you close the editor (E)`, GEN.short ? '#ffd88a' : '#7dff9a', 3);
  } catch (err) { console.warn('circuit generator:', err); flash('The circuit generator could not load', '#ff8a7a', 3); }
  finally { GEN.busy = false; }
}
document.getElementById('gNew').addEventListener('click', e => { e.currentTarget.blur(); genMake(String(1 + Math.floor(Math.random() * 999999))); });
document.getElementById('gMake').addEventListener('click', e => { e.currentTarget.blur(); genMake(gSeed.value.trim() || '1'); });
document.getElementById('gBack').addEventListener('click', e => { e.currentTarget.blur(); if (!GEN.back.length) return; genSet(GEN.back.pop(), false); flash('The course before', '#fff', 1.5); });
gSeed.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); genMake(gSeed.value.trim() || '1'); } });
gKm.addEventListener('input', genShow);
edEl.querySelectorAll('[data-gs]').forEach(b => b.addEventListener('click', () => { b.blur(); GEN.style = b.dataset.gs; try { localStorage.setItem('carsim.gen.style', GEN.style); } catch (err) { } genShow(); }));
sRadEl.addEventListener('input', genShow);
edEl.addEventListener('keydown', e => { if (e.target.matches('input[type=text], select')) e.stopPropagation(); });   // typing a seed or a name: not the sim's keys
// MY CIRCUITS: in this browser's storage
const libRead = () => { try { const a = JSON.parse(localStorage.getItem(CIRCUITS_KEY) || '[]'); return Array.isArray(a) ? a.filter(x => x && typeof x.name === 'string' && x.course && Array.isArray(x.course.wp) && x.course.wp.length >= 3) : []; } catch (err) { return []; } };
const libWrite = a => { try { localStorage.setItem(CIRCUITS_KEY, JSON.stringify(a)); return true; } catch (err) { flash('Browser storage is full: delete a circuit, or Export this one', '#ff8a7a', 3); return false; } };
function libShow() {
  const a = libRead(), sel = cList.value, cur = wpSig(COURSE.wp);
  cList.innerHTML = a.length ? '' : '<option value="">(none yet)</option>';
  for (const x of a) { const o = document.createElement('option'); o.value = x.name; o.textContent = `${wpSig(x.course.wp) === cur ? '● ' : ''}${x.name}${x.len ? ` · ${(x.len / 1000).toFixed(2)} km` : ''}`; cList.appendChild(o); }
  const on = a.find(x => wpSig(x.course.wp) === cur);
  cList.value = a.some(x => x.name === sel) ? sel : on ? on.name : a[0]?.name ?? '';
  document.getElementById('cLoad').disabled = document.getElementById('cDel').disabled = !a.length;
}
document.getElementById('cSave').addEventListener('click', e => {
  e.currentTarget.blur();
  const a = libRead(), g = GEN.last && GEN.last.sig === wpSig(COURSE.wp) ? GEN.last : null;
  const cur = a.find(x => wpSig(x.course.wp) === wpSig(COURSE.wp));
  const def = cur ? cur.name : g ? `${g.style[0].toUpperCase() + g.style.slice(1)} ${g.seed}${g.rMin !== 25 ? ` r${g.rMin}` : ''}` : `Course ${a.length + 1}`;
  const name = (prompt('Save this course in My circuits as:', def) || '').trim().replace(/\\s+/g, ' ').slice(0, 48);
  if (!name) return;
  const i = a.findIndex(x => x.name === name);
  if (i >= 0 && !confirm(`Replace "${name}" with this course?`)) return;
  const x = { name, course: courseCopy(COURSE), len: Math.round((ed.track || buildTrack(COURSE.wp)).len), at: Date.now(), ...(g ? { gen: { seed: g.seed, km: g.km, style: g.style, rMin: g.rMin } } : {}) };
  if (i >= 0) a[i] = x; else a.push(x);
  if (libWrite(a)) { cList.value = name; libShow(); flash(`Saved in My circuits: ${name}`, '#7dff9a', 2); }
});
document.getElementById('cLoad').addEventListener('click', e => {
  e.currentTarget.blur();
  const x = libRead().find(y => y.name === cList.value); if (!x) return;
  const c = x.course;
  genSet({ wp: c.wp.map(([px, pz]) => [+px, +pz]), bank: bankOf(c.bank), level: levelOf(c.level), even: evenOf(c.even), grade: gradeOf(c.grade), ops: Array.isArray(c.ops) ? c.ops : [], base: COURSE.base, road: !!COURSE.road,
    bridges: Array.isArray(c.bridges) ? c.bridges.filter(b => b && isFinite(b.x) && isFinite(b.z)).map(b => ({ x: +b.x, z: +b.z })) : [], noBridge: Array.isArray(c.noBridge) ? c.noBridge.filter(b => b && isFinite(b.x) && isFinite(b.z)).map(b => ({ x: +b.x, z: +b.z })) : [] });
  GEN.last = x.gen ? { ...x.gen, len: x.len, sig: wpSig(c.wp) } : null;
  flash(`${x.name} · built when you close the editor (E)`, '#7dff9a', 2.5);
});
document.getElementById('cDel').addEventListener('click', e => {
  e.currentTarget.blur();
  const a = libRead(), i = a.findIndex(y => y.name === cList.value); if (i < 0 || !confirm(`Delete "${a[i].name}" from My circuits?`)) return;
  a.splice(i, 1); if (libWrite(a)) { libShow(); flash('Deleted', '#fff', 1.5); }
});
genShow();
document.getElementById('eSmooth').addEventListener('click', e => {""")
# the panel shows the list as it is whenever it opens (another tab may have saved one); the generator fetched meanwhile
rep("""    setTool(ed.tool); updatePreview();""", """    setTool(ed.tool); updatePreview(); genShow(); genLoad().catch(() => { });""")
open(ep, 'w').write(s)

h = open(hp).read()
def hrep(a, b):
    global h
    n = h.count(a)
    assert n == 1, (n, a[:140])
    h = h.replace(a, b)
hrep("""  <div class="sec">SHAPE</div>""", """  <div class="sec">GENERATE A CIRCUIT</div>
  <label title="How long the circuit should be (as far as it fits in the world with corners no tighter than the min. radius)">Length <input id="gKm" type="range" min="0.5" max="3.5" step="0.1" value="1.2"> <span id="gKmV" class="val">1.2 km</span></label>
  <div class="tools"><button data-gs="flowing" title="Few, wide bends and long straights">Flowing</button><button data-gs="mixed" title="Straights, hairpins and sweepers">Mixed</button><button data-gs="twisty" title="Hairpin after hairpin, the corners near the min. radius">Twisty</button>
    <label title="The same seed, length, style and min. radius always give the same circuit">Seed <input id="gSeed" type="text" value="1" size="7" spellcheck="false" autocomplete="off"></label></div>
  <div class="tools"><button id="gNew" title="A circuit from a new random seed">&#127922; New circuit</button><button id="gMake" title="The circuit of this seed (Enter in the seed)">Generate</button><button id="gBack" disabled title="Back to the course before">Back</button></div>
  <div class="hint" id="gNote"></div>
  <div class="sec">MY CIRCUITS</div>
  <div class="tools"><select id="cList" title="Courses kept in this browser (&#9679;: the one in the editor)"></select></div>
  <div class="tools"><button id="cLoad">Load</button><button id="cDel">Delete</button><button id="cSave" title="Keep this course in this browser under a name">Save as&hellip;</button></div>
  <div class="sec">SHAPE</div>""")
hrep("""  #editor button:disabled{opacity:.45;cursor:default}""", """  #editor button:disabled{opacity:.45;cursor:default}
  #editor{max-height:calc(100vh - 24px);overflow-y:auto}
  #editor input[type=text]{font:inherit;font-size:12px;width:72px;border:0;border-radius:6px;padding:5px 7px;background:#ffffff22;color:#fff}
  #editor select{font:inherit;font-size:12px;flex:1;min-width:0;border:0;border-radius:6px;padding:5px 6px;background:#3a3a3a;color:#fff}
  #editor .tools label{margin:0 0 0 auto}""")
open(hp, 'w').write(h)
print('circuits patched')
