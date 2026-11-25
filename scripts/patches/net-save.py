# A saved network keeps its whole configuration and its training history, on every circuit it was trained on (#351).
#   - its configuration (config): the lab's settings it was trained with (AI_CFG's, but for this machine's own: the
#     cores, the drawing, the watching speed), the penalties (AI_PEN), when the training stops (gens, stopAfter), the
#     exam's kind, the car's setup (drive, split, pressure) and the lap it followed (whose, its time: not the
#     recording). Loading it (a file, the server) puts those settings back in the lab, and the setup on the car when
#     it is the same car: Train more goes on as it was trained;
#   - its history: a network loaded on another circuit (or ground, or car) and trained on there used to start a new
#     chart and forget the old one. Now each circuit it was trained on before is a stint (past: the course and the
#     track's name, ground, car, generations from-to, best lap, the settings then) with its chart (pastHist, thinned
#     to 300 points: { step, h }); from (AI.fromGen: AI.from is where a try starts): the generation this stint started at. Kept in this browser with the
#     training, saved in files and on the server; the lab says it under the chart.
#   - the server keeps 2000 generations of the current chart (was 300).
# Applies to public/sim/engine.js after the other patches (last in the chain):
#   python3 scripts/patches/net-save.py <dir with engine.js>
import sys, os
ep = os.path.join(sys.argv[1], 'engine.js')
s = open(ep, encoding='utf-8').read()

def rep(a, b):
    global s
    n = s.count(a)
    assert n == 1, (n, a[:140])
    s = s.replace(a, b)

# ---- the settings' reader: from this browser's storage at start, and from a network being loaded
rep("""try {
  const c = JSON.parse(localStorage.getItem('sandbuggy.ai.config') || 'null');
  if (AI_SIZES.includes(c?.h)) AI.h = c.h;""", """// the lab's settings from c (this browser's, kept by aiKeepConfig; or a network's being loaded, #351): what isn't in c,
// or isn't valid, stays as it is (the switches: off)
function aiConfigRead(c) {
  if (AI_SIZES.includes(c?.h)) AI.h = c.h;""")
rep("""  for (const k in AI_PEN) if (Number.isFinite(c?.pen?.[k]) && c.pen[k] >= 0) AI_PEN[k] = c.pen[k];
} catch (e) { aiConfig(AI_DEFAULT_INPUTS, false); }""", """  for (const k in AI_PEN) if (Number.isFinite(c?.pen?.[k]) && c.pen[k] >= 0) AI_PEN[k] = c.pen[k];
}
try { aiConfigRead(JSON.parse(localStorage.getItem('sandbuggy.ai.config') || 'null')); } catch (e) { aiConfig(AI_DEFAULT_INPUTS, false); }""")

# ---- a network's history: fresh, kept in this browser, read back
rep("""examKind: aiExamKind(), rvPool: [], bestSolo: null, bestAt: null, ident: null });""",
    """examKind: aiExamKind(), rvPool: [], bestSolo: null, bestAt: null, ident: null, past: [], pastHist: [], fromGen: 0 });""")
rep("""bestAt: d.bestAt || null, ident: d.ident && typeof d.ident.id === 'string' ? d.ident : null });""",
    """bestAt: d.bestAt || null, ident: d.ident && typeof d.ident.id === 'string' ? d.ident : null });
    if (d && d.w?.length === AI.np) aiPastRead(d);                     // (#351: the circuits it was trained on before)""")
rep("""    last: AI.lastExam || null, rv: AI.rvPool.map(w => [...w]) };""",
    """    last: AI.lastExam || null, rv: AI.rvPool.map(w => [...w]), past: AI.past, pastHist: AI.pastHist, from: AI.fromGen };""")

# ---- what a saved network carries, and what loading one puts back
rep("""// a training as a file or on the server: to keep, share, or carry to another browser (the browser keeps it anyway, per course, car and size)
function aiExport() {""", """// ---- a network's configuration and history (#351)
const AI_CFG_LOCAL = ['cores', 'draw', 'ped3d', 'speed'];             // this machine's, not the network's
const AI_PAST_MAX = 16, AI_PAST_PTS = 300;                             // circuits kept before this one; their charts' points
// the settings it is trained with: the lab's, the car's setup, the lap it follows (whose: the recording stays here)
function aiNetConfig() {
  const cfg = {}; for (const k in AI_CFG) if (!AI_CFG_LOCAL.includes(k)) cfg[k] = AI_CFG[k];
  const D = aiDemoNow();
  return { cfg, pen: { ...AI_PEN }, gens: AI.gens, stopAfter: AI.stopAfter, exam: aiExamKind(),
    setup: { vehicle: VEH.key, awd: !!car.awd, split: car.split, p: car.pIdx, psi: PRESSURES[car.pIdx]?.psi ?? null },
    follow: D ? { who: String(D.who || ''), time: D.time ?? null, src: String(D.src || '') } : null };
}
// a network's settings put back in the lab (and its setup on the car, if it is this car); false: it has none (saved before #351)
function aiNetConfigApply(c) {
  if (!c || typeof c !== 'object' || !c.cfg || typeof c.cfg !== 'object') return false;
  aiConfigRead({ ...c.cfg, pen: c.pen, gens: c.gens, stopAfter: c.stopAfter, h: AI.h, inputs: AI.inputs, hb: AI.hb, kp: AI.kp, ks: AI.ks, nb: AI.nb });
  const S = c.setup;
  if (S && S.vehicle === VEH.key) {
    if (typeof S.awd === 'boolean') setDrive(S.awd);
    if (Number.isFinite(S.split)) setSplit(S.split);
    if (Number.isInteger(S.p)) setPressure(S.p);
  }
  aiKeepConfig();
  return true;
}
const aiTrackName = () => (typeof TRK !== 'undefined' && TRK.list?.find(t => t.key === courseKey())?.name) || null;
// a chart of at most AI_PAST_PTS points: every step-th generation's
function aiThin(h) {
  h = Array.isArray(h) ? h : [];
  const step = Math.max(1, Math.ceil(h.length / AI_PAST_PTS));
  return { step, h: step > 1 ? h.filter((_, i) => i % step === 0) : h.slice() };
}
// where a training (a file's, the server's) was made: one stint of a network's history
function aiStintOf(d) {
  return { course: String(d.course || ''), track: d.track ? String(d.track) : null, ground: String(d.ground || ''), vehicle: String(d.vehicle || ''), vehicleName: String(d.vehicleName || ''),
    from: Math.max(0, d.from | 0), to: Math.max(0, d.gen | 0), bestLap: Number.isFinite(d.bestLap) ? d.bestLap : null, bestFit: Number.isFinite(d.bestFit) ? d.bestFit : -1,
    config: d.config && typeof d.config === 'object' ? d.config : null, savedAt: d.savedAt ? String(d.savedAt) : null };
}
function aiPastRead(d) {
  const P = Array.isArray(d.past) ? d.past.filter(p => p && typeof p === 'object') : [];
  const H = Array.isArray(d.pastHist) ? d.pastHist : [];
  AI.past = P.slice(-AI_PAST_MAX);
  AI.pastHist = AI.past.map((_, i) => { const x = H[H.length - AI.past.length + i]; return x && Array.isArray(x.h) ? x : null; });   // (the last ones: the charts line up with the stints)
  AI.fromGen = Number.isInteger(d.from) && d.from >= 0 ? d.from : 0;
}
// under the chart: the circuits it was trained on before this one
function aiPastShow() {
  const el = AI.el?.querySelector('#aiPast'); if (!el) return;
  const P = AI.past || [];
  el.style.display = P.length ? '' : 'none';
  if (!P.length) { el.replaceChildren(); return; }
  const line = p => `${p.track || (p.course ? 'a course of its own' : 'another course')} (${String(p.ground || '').toLowerCase()}${p.vehicle !== VEH.key ? ', ' + (p.vehicleName || p.vehicle) : ''}): generations ${p.from}–${p.to}${p.bestLap != null ? ', best lap ' + fmt(p.bestLap) : ''}`;
  el.textContent = `Trained before on ${P.map(line).join(' · ')} · here from generation ${AI.fromGen}`;
}
// a training as a file or on the server: to keep, share, or carry to another browser (the browser keeps it anyway, per course, car and size)
function aiExport() {""")
rep("""hist: AI.hist, adam: { m: [...AI.m], v: [...AI.v], k: AI.k }, savedAt: new Date().toISOString() };""",
    """hist: AI.hist, adam: { m: [...AI.m], v: [...AI.v], k: AI.k }, savedAt: new Date().toISOString(),
    track: aiTrackName(), config: aiNetConfig(), from: AI.fromGen, past: AI.past, pastHist: AI.pastHist };   // (#351)""")
rep("""  if (AI.training) aiTrain(false);
  AI.drive = false; AI.h = d.h; aiSetInputs(ins,""", """  if (AI.training) aiTrain(false);
  const withCfg = aiNetConfigApply(d.config);                         // (#351: its settings, as it was trained)
  AI.drive = false; AI.h = d.h; aiSetInputs(ins,""")
rep("""  AI.ident = typeof d.id === 'string' && d.name ?""", """  // its history (#351): the circuits it was trained on before; made elsewhere, where it was made is one more, and this
  // circuit's chart starts at its generation
  aiPastRead(d);
  if (other.length) {
    AI.past.push(aiStintOf(d)); AI.pastHist.push(aiThin(d.hist)); AI.fromGen = Math.max(0, d.gen | 0);
    AI.past = AI.past.slice(-AI_PAST_MAX); AI.pastHist = AI.pastHist.slice(-AI_PAST_MAX);
  }
  AI.ident = typeof d.id === 'string' && d.name ?""")
rep("""  flash(`${what} loaded: ${AI.np} weights, generation ${AI.gen}`, '#9fd4ff', 2);""",
    """  flash(`${what} loaded: ${AI.np} weights, generation ${AI.gen}${withCfg ? ', with its settings' : ''}${AI.past.length ? `, trained on ${AI.past.length + 1} circuits` : ''}`, '#9fd4ff', 2.5);""")
# the server: 2000 generations of chart (AUTOPILOT_LIMITS.histMax), and less of it if the whole is too big for it
rep("""  const r = await aiApi('', { method: 'POST', body: JSON.stringify({ name, training: { ...d, hist: (d.hist || []).slice(-300) } }) });""",
    """  let t = { ...d, hist: (d.hist || []).slice(-2000) };
  if (JSON.stringify(t).length > 500000) t = { ...t, hist: t.hist.slice(-300), pastHist: (t.pastHist || []).map(x => { const k = x ? Math.ceil(x.h.length / 60) : 1; return k > 1 ? { step: x.step * k, h: x.h.filter((_, i) => i % k === 0) } : x; }) };
  const r = await aiApi('', { method: 'POST', body: JSON.stringify({ name, training: t }) });""")
# the server's list: how many circuits each was trained on
rep("""· gen ${a.gen} · ${a.weights} weights`""", """· gen ${a.gen} · ${a.weights} weights${a.past?.length ? ` · trained on ${a.past.length + 1} circuits` : ''}`""")

# ---- the lab: the history under the chart
rep("""<div class="aiCv aiBigOnly"><canvas id="aiChart2"></canvas></div></div>""",
    """<div class="aiCv aiBigOnly"><canvas id="aiChart2"></canvas></div><div class="sub" id="aiPast" style="display:none;grid-column:1/-1"></div></div>""")
rep("""function aiShow() {
  if (!AI.open) return;""", """function aiShow() {
  if (!AI.open) return;
  aiPastShow();""")

# for the tests and the Claude bridge: the training as saved, loading one, the settings
rep("""  Object.assign(window.__sim, { ai: AI, aiTrainSync, aiTry, aiDrive });""",
    """  Object.assign(window.__sim, { ai: AI, aiTrainSync, aiTry, aiDrive });
  Object.assign(window.__sim, { aiExport, aiImport, aiNetConfig, aiCfg: AI_CFG, aiPen: AI_PEN });   // (#351)""")

open(ep, 'w', encoding='utf-8').write(s)
print('net-save patched')
