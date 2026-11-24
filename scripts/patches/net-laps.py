# A network's laps count as best laps, as a human's do, marked with the network's name and who made it (#333).
# In a race room (outside races) a lap the autopilot drives goes to the server as a lap with `net` (the saved network's
# id, if what drives is the network as saved: AI.ident, set when it is loaded from or saved to the server, and its
# weights' signature); the server names and credits it (lib/race/hub.mjs netLap). It never touches the timer's BEST
# there (that is our own record). Driving alone, its lap is the timer's BEST like ours, and says whose it is.
# The best laps' lists show a network's in cyan, its maker in the tooltip.
# Applies to public/sim/engine.js after the rest of the chain (last):
#   python3 scripts/patches/net-laps.py <dir with engine.js>
import sys, os
ep = os.path.join(sys.argv[1], 'engine.js')
s = open(ep).read()

def rep(a, b):
    global s
    n = s.count(a)
    assert n == 1, (n, a[:140])
    s = s.replace(a, b)

# ---- which network drives: AI.ident, kept with the training ----
rep("""function aiFresh() {""", """// the network that drives (Drive it: the best weights) as the server has it (#333): AI.ident { id, name, creator, sig } is
// the saved network it was loaded from or saved as, sig its driving weights' signature then; once training has changed
// them it is an unsaved network, its maker whoever drives it
function aiNetSig(w) { let h = 2166136261; for (const x of new Uint32Array(Float32Array.from(w).buffer)) h = Math.imul(h ^ x, 16777619); return (h >>> 0).toString(36); }
function aiNetMark() {
  const w = AI.best || AI.w, I = AI.ident, saved = !!(I && w && I.sig === aiNetSig(w));
  return { id: saved ? I.id : null, name: saved ? I.name : 'Unsaved network', creator: saved ? I.creator : 'you', weights: AI.np, h: AI.h };
}
function aiFresh() {""")
rep("""rvPool: [], bestSolo: null, bestAt: null });
  for (let i = 0; i < n; i++) AI.w[i] = aiGauss() * 0.1;""", """rvPool: [], bestSolo: null, bestAt: null, ident: null });
  for (let i = 0; i < n; i++) AI.w[i] = aiGauss() * 0.1;""")
rep("""examKind: d.exam || 'line', bestSolo: d.bestSolo ?? null, bestAt: d.bestAt || null });""",
    """examKind: d.exam || 'line', bestSolo: d.bestSolo ?? null, bestAt: d.bestAt || null, ident: d.ident && typeof d.ident.id === 'string' ? d.ident : null });""")
rep("""exam: AI.examKind, bestSolo: AI.bestSolo, bestAt: AI.bestAt || null })); } catch (e) { }""",
    """exam: AI.examKind, bestSolo: AI.bestSolo, bestAt: AI.bestAt || null, ident: AI.ident || null })); } catch (e) { }""")
# loaded from the server: that network; from a file: unsaved
rep("""  aiSave(); aiShow();
  flash(`${what} loaded: ${AI.np} weights, generation ${AI.gen}`, '#9fd4ff', 2);""",
    """  AI.ident = typeof d.id === 'string' && d.name ? { id: d.id, name: String(d.name), creator: String(d.ownerName || 'Driver'), sig: aiNetSig(AI.best || AI.w) } : null;
  aiSave(); aiShow();
  flash(`${what} loaded: ${AI.np} weights, generation ${AI.gen}`, '#9fd4ff', 2);""")
# saved to the server: this one, if what was saved is what drives
rep("""  const r = await aiApi('', { method: 'POST', body: JSON.stringify({ name, training: d }) });""",
    """  const r = await aiApi('', { method: 'POST', body: JSON.stringify({ name, training: d }) });
  const a = r?.autopilot, sw = d.best || d.w;
  if (a?.id && sw && AI.np === sw.length && aiNetSig(AI.best || AI.w) === aiNetSig(sw)) { AI.ident = { id: a.id, name: a.name || name, creator: a.ownerName || 'Driver', sig: aiNetSig(sw) }; aiSave(); }""")

# ---- the lap ----
rep("""  if (!MP.on || MP.spectator || lap.lapNo < 1 || AI.drive) return;   // the autopilot's laps aren't ours""",
    """  if (!MP.on || MP.spectator || lap.lapNo < 1) return;
  if (AI.drive) {                                                     // the network's (#333): a best lap of its own, never a race lap
    if (MP.phase === 'countdown' || MP.phase === 'racing') return;
    const m = aiNetMark();
    mpPost({ t: 'lap', lap: lap.lapNo, time: t - lap.lapStart, valid, splits: lap.splits, net: { id: m.id, weights: m.weights, h: m.h }, ...(valid ? { trace: mpTrace(lap.lapStart, t) } : {}) });
    return;
  }""")
# the timer's BEST: in a room our own record (the network's goes to the server); alone, whoever set it, said
rep("""  else if (lap.best == null || lt < lap.best) {
    lap.best = lt; lap.bestSplits = lap.splits.slice();
    if (!MP.on) try { localStorage.setItem('sandbuggy.best.' + courseKey(), JSON.stringify({ time: lt, splits: lap.bestSplits })); } catch (e) { }""",
    """  else if (MP.on && AI.drive) flash(`The network's lap ${lap.lapNo}  ${fmt(lt)}`, '#58d6e6', 3.5);
  else if (lap.best == null || lt < lap.best) {
    lap.best = lt; lap.bestSplits = lap.splits.slice();
    if (AI.drive) { const m = aiNetMark(); lap.bestNet = { name: m.name, creator: m.creator }; } else lap.bestNet = null;
    if (!MP.on) try { localStorage.setItem('sandbuggy.best.' + courseKey(), JSON.stringify({ time: lt, splits: lap.bestSplits, ...(lap.bestNet ? { net: lap.bestNet } : {}) })); } catch (e) { }""")
rep("""  lap.best = null; lap.bestSplits = []; lap.last = null; lap.laps = []; lap.valid = []; lap.lapNo = 0; lap.history = [];""",
    """  lap.best = null; lap.bestSplits = []; lap.bestNet = null; lap.last = null; lap.laps = []; lap.valid = []; lap.lapNo = 0; lap.history = [];""")
rep("""if (b) { lap.best = b.time; lap.bestSplits = b.splits; } } catch (e) { }""",
    """if (b) { lap.best = b.time; lap.bestSplits = b.splits; lap.bestNet = b.net?.name ? b.net : null; } } catch (e) { }""")
rep("""  const old = lap.best; lap.best = null; lap.bestSplits = [];""", """  const old = lap.best; lap.best = null; lap.bestSplits = []; lap.bestNet = null;""")
rep("""  MP.recs = []; MP.carRecs = []; lap.best = null; lap.bestSplits = [];""", """  MP.recs = []; MP.carRecs = []; lap.best = null; lap.bestSplits = []; lap.bestNet = null;""")
rep("""<span>BEST ${fmt(lap.best)}</span></div>${mpRecRow()}""",
    """<span>BEST ${fmt(lap.best)}</span></div>${lap.bestNet ? `<div style="color:#58d6e6;font-size:11px;text-align:right;max-width:240px;margin-left:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="Set by the network ${mpEsc(lap.bestNet.name)}, made by ${mpEsc(lap.bestNet.creator)}">by the network ${mpEsc(lap.bestNet.name)} (${mpEsc(lap.bestNet.creator)})</div>` : ''}${mpRecRow()}""")

# ---- the best laps' lists: a network's in cyan, whose in the tooltip ----
rep("""const mpEsc = s =>""", """// a best lap's driver as the lists show it: a network's (#333) in cyan, its maker in the tooltip
const mpWho = e => e.net ? `<span style="color:#58d6e6" title="A network's lap: ${mpEsc(e.net.name)}, made by ${mpEsc(e.net.creator)}">${mpEsc(e.name)}</span>` : mpEsc(e.name);
const mpEsc = s =>""")
rep("""${e ? mpEsc(e.name) : 'no lap yet'}</td></tr>`;""", """${e ? mpWho(e) : 'no lap yet'}</td></tr>`;""")
rep("""<td class="n">${mpEsc(e.name)}${e.id === MP.myId ? ' (you)' : ''}""", """<td class="n">${mpWho(e)}${e.id === MP.myId ? ' (you)' : ''}""")

open(ep, 'w').write(s)
print('net-laps: a network\'s laps are best laps, marked')
