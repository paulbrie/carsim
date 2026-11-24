# A training's results kept whole in this browser (#341): what a reload used to lose comes back with it.
#   - the last exam (the lab's LAST EXAM, its lap or where it stopped), and the rivals (AI.rvPool, the bests kept every
#     rivalEvery generations to race against);
#   - every generation's chart (AI.hist), not the last 300;
#   - saved again when the page is hidden or left (pagehide, visibilitychange), not only at each generation's end.
# When the browser's storage is full the chart's oldest generations are dropped first (2000 kept, then 300, then
# none); if even that fails, the lab says so once, instead of failing quietly.
# Applies to public/sim/engine.js after preview.py (last in the chain):
#   python3 scripts/patches/keep.py <dir with engine.js>
import sys, os
ep = os.path.join(sys.argv[1], 'engine.js')
s = open(ep, encoding='utf-8').read()

def rep(a, b):
    global s
    n = s.count(a)
    assert n == 1, (n, a[:140])
    s = s.replace(a, b)

# saving: the whole chart, the last exam, the rivals; less of the chart when storage is short; a word when it fails
rep("""  try { localStorage.setItem(AI.key, JSON.stringify({ w: [...AI.w], m: [...AI.m], v: [...AI.v], k: AI.k, gen: AI.gen, best: AI.best && [...AI.best], bestFit: AI.bestFit, bestLap: AI.bestLap, sinceBest: AI.sinceBest, hist: AI.hist.slice(-300), exam: AI.examKind, bestSolo: AI.bestSolo, bestAt: AI.bestAt || null, ident: AI.ident || null })); } catch (e) { }
}""", """  if (!AI.key || !AI.w) return false;                                 // (nothing loaded yet)
  const KEEP = 20000;                                                 // generations of chart kept (each ~20 bytes)
  const rec = { w: [...AI.w], m: [...AI.m], v: [...AI.v], k: AI.k, gen: AI.gen, best: AI.best && [...AI.best], bestFit: AI.bestFit, bestLap: AI.bestLap, sinceBest: AI.sinceBest, hist: AI.hist.slice(-KEEP), exam: AI.examKind, bestSolo: AI.bestSolo, bestAt: AI.bestAt || null, ident: AI.ident || null,
    last: AI.lastExam || null, rv: AI.rvPool.map(w => [...w]) };   // (#341: the last exam and the rivals too, and the whole chart)
  for (const n of [KEEP, 2000, 300, 0]) {                    // storage short: the chart's oldest generations go first
    if (rec.hist.length > n) rec.hist = n ? rec.hist.slice(-n) : [];
    else if (n < KEEP) continue;
    try { localStorage.setItem(AI.key, JSON.stringify(rec)); AI.saveFail = false; return true; } catch (e) { }
  }
  if (!AI.saveFail && !AI_WK) flash('Browser storage is full: this training is no longer saved in this browser (Save to file keeps it)', '#ff8a7a', 5);
  AI.saveFail = true;
  return false;
}""")
# loading them back (and nothing of another training's last exam: aiFresh doesn't clear it)
rep("""function aiLoad() {
  AI.key = aiKey(); aiFresh();
  try {
    const d = JSON.parse(localStorage.getItem(AI.key) || 'null');""", """function aiLoad() {
  AI.key = aiKey(); aiFresh(); AI.lastExam = AI.lastExamRace = null;
  try {
    const d = JSON.parse(localStorage.getItem(AI.key) || 'null');
    if (d && d.w?.length === AI.np) {                                 // (#341) the last exam, the rivals
      if (d.last && typeof d.last === 'object') AI.lastExam = d.last;
      if (Array.isArray(d.rv)) AI.rvPool = d.rv.filter(w => Array.isArray(w) && w.length === AI.np).slice(-4).map(w => Float32Array.from(w));
    }""")
# the server keeps a chart of 300 generations (AUTOPILOT_LIMITS.histMax) and refuses a training over 256 KB: send it no more
rep("""  const r = await aiApi('', { method: 'POST', body: JSON.stringify({ name, training: d }) });""",
    """  const r = await aiApi('', { method: 'POST', body: JSON.stringify({ name, training: { ...d, hist: (d.hist || []).slice(-300) } }) });""")
# saved again as the page goes (a reload, a closed tab): whatever changed since the last generation's end
rep("""function aiNewGen() {""", """if (!AI_WK) {
  addEventListener('pagehide', () => aiSave());
  document.addEventListener('visibilitychange', () => { if (document.hidden) aiSave(); });
}
function aiNewGen() {""")
open(ep, 'w', encoding='utf-8').write(s)
print('keep patched')
