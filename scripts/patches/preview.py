# A saved network's preview (#336): the networks page's "Watch it drive" opens /sim/index.html?net=<id> (no sign-in).
# The sim fetches it (/api/networks/<id>: what it takes to drive, the maker's name as the page shows it), takes its
# ground, car and track (the race rooms' map whose course it was trained on; the figure-8 if it was a course of its
# maker's own), and lets it drive (Drive it), with a bar saying whose it is. The visitor's own lab is untouched: the
# preview's network is not saved (aiSave does nothing while AI.preview), the lab's settings are put back as they were
# in this browser, and pressing Train (or the bar's ✕) goes back to the visitor's own training.
# Applies to public/sim/engine.js after tracks.py:
#   python3 scripts/patches/preview.py <dir with engine.js>
import sys, os
ep = os.path.join(sys.argv[1], 'engine.js')
s = open(ep, encoding='utf-8').read()

def rep(a, b):
    global s
    n = s.count(a)
    assert n == 1, (n, a[:140])
    s = s.replace(a, b)

# nothing of a preview is kept
rep("""function aiSave() {
""", """function aiSave() {
  if (AI.preview) return;                                             // (a network previewed, #336: not this browser's)
""")
# Train: the visitor's own training again
rep("""function aiTrain(on) {
  if (on === AI.training) return;
""", """function aiTrain(on) {
  if (on === AI.training) return;
  if (on && AI.preview) aiPreviewEnd();                               // (#336: train their own, not the one previewed)
""")

rep("""// ---------- the tracks (#329): the race rooms' maps, to drive alone (the start menu's first row) ----------""",
    """// ---------- a saved network's preview (#336): /sim/index.html?net=<id>, the networks page's Watch it drive ----------
// AI.preview: { id, name, by, cfg } while it shows (cfg: the lab's settings before, to put back); PV: its bar
const PV = { el: null, id: !MP.on && !MP.edit && !AI_WK ? MPQ.get('net') : null };
const PV_API = location.pathname.replace(/\\/sim\\/[^/]*$/, '') + '/api/networks';
async function aiPreviewStart(id) {
  const menu = document.getElementById('menu'); menu.style.display = 'none';
  pvBar('Loading the network…');
  try {
    const r = await fetch(`${PV_API}/${encodeURIComponent(id)}`), b = await r.json().catch(() => ({}));
    if (!r.ok || !b.network) throw new Error(b.error || `${r.status} ${r.statusText}`);
    const n = b.network;
    // its ground and car, then its track (the room map with its course; it learnt nothing else)
    if (['sand', 'earth', 'road'].includes(n.ground) && n.ground !== (ROAD ? 'road' : COURSE.base)) setSurface(n.ground);
    if (VEHICLE_LIST[n.vehicle] && n.vehicle !== VEH.key) switchVehicle(n.vehicle);
    for (let k = 0; !TRK.list && k < 100; k++) await new Promise(res => setTimeout(res, 100));
    const t = TRK.list?.find(x => x.key === n.course) || null, own = !t, at = t || TRK.list?.find(x => x.id === 'figure-8');
    if (at && trkNow() !== at.id) { TRK.fresh = false; await trkPick(at.id); }
    if (!aiPreviewLoad(n)) throw new Error('it does not fit this sim');
    menu.style.display = 'none';
    aiDrive(true);
    pvBar(null, n, own ? (at ? `trained on a course of its maker's own: here on ${at.name}` : 'trained on a course of its maker\\'s own') : at.name);
  } catch (e) { console.warn('preview:', e); pvBar(`That network could not load: ${e.message}`); }
}
// its weights in place of the lab's, for now: nothing saved, the lab's settings in this browser as they were
function aiPreviewLoad(d) {
  const arr = (a, n) => Array.isArray(a) && a.length === n && a.every(Number.isFinite);
  const ins = Array.isArray(d?.inputs) && d.inputs.every(id => AI_INPUTS.some(q => q.id === id)) ? d.inputs : null;
  if (!ins || !AI_SIZES.includes(d.h) || !arr(d.w, aiShape(ins, !!d.handbrake, d.h).np)) return false;
  let kept = null; try { kept = localStorage.getItem('sandbuggy.ai.config'); } catch (e) { }
  const cfg = AI.preview?.cfg || { h: AI.h, inputs: AI.inputs.slice(), hb: AI.hb, kp: AI.kp, ks: AI.ks, nb: AI.nb, kept };
  if (AI.training) aiTrain(false);
  AI.preview = { id: d.id, name: d.name, by: d.by, cfg };
  AI.drive = false; AI.h = d.h; aiSetInputs(ins, !!d.handbrake, true, !!d.keyPedals, !!d.keySteering, !!d.noBrake); aiLoad();
  try { if (cfg.kept == null) localStorage.removeItem('sandbuggy.ai.config'); else localStorage.setItem('sandbuggy.ai.config', cfg.kept); } catch (e) { }
  const w = Float32Array.from(d.w);
  Object.assign(AI, { w, best: Float32Array.from(w), gen: d.gen | 0, bestFit: 0, bestLap: d.bestLap ?? null, hist: [], sinceBest: 0 });
  AI.ident = { id: d.id, name: String(d.name), creator: String(d.by || 'Driver'), sig: aiNetSig(w) };
  aiShow();
  return true;
}
// a network can get stuck (against a post, off the road, facing the wrong way): in a preview, still for 4 s, it starts
// again from the grid, so the preview never just stands there
setInterval(() => {
  if (!AI.preview || !AI.drive || window.__sim?.paused || document.hidden) { PV.still = 0; return; }
  PV.still = car.vel.length() < 1 ? (PV.still || 0) + 1 : 0;
  if (PV.still >= 4) { PV.still = 0; aiDrive(true); flash('Stuck: from the start again', '#9fd4ff', 1.8); }
}, 1000);
// back to this browser's own training, with its own settings
function aiPreviewEnd() {
  const P = AI.preview; if (!P) return;
  if (AI.drive) aiDrive(false);
  AI.preview = null; AI.ident = null;
  const c = P.cfg; AI.h = c.h; aiConfig(c.inputs, c.hb); AI.kp = c.kp; AI.ks = c.ks; AI.nb = c.nb; aiLoad(); aiShow();
  pvBar(null); flash('Your own training again', '#9fd4ff', 1.8);
}
// the bar: whose network drives, on what; or a message; or nothing
function pvBar(msg, n, where) {
  if (!PV.el) {
    PV.el = document.createElement('div'); PV.el.id = 'pvBar'; PV.el.className = 'panel';
    PV.el.style.cssText = 'left:50%;bottom:16px;transform:translateX(-50%);max-width:min(640px,calc(100vw - 32px));pointer-events:auto;display:none;z-index:6';
    document.body.appendChild(PV.el);
  }
  const el = PV.el, mk = (tag, text, css) => { const x = document.createElement(tag); if (text != null) x.textContent = text; if (css) x.style.cssText = css; return x; };
  if (!msg && !n) { el.style.display = 'none'; el.replaceChildren(); return; }
  el.style.display = 'block';
  if (msg) { el.replaceChildren(mk('span', msg)); return; }
  const close = mk('button', '✕', 'float:right;margin:0 0 0 12px;font:inherit;border:0;border-radius:6px;padding:3px 8px;cursor:pointer;color:#fff;background:#ffffff26');
  close.title = 'Stop the preview: your own car and training'; close.addEventListener('click', e => { e.currentTarget.blur(); aiPreviewEnd(); });
  const car = ROAD_CARS[n.vehicle]?.name || (n.vehicle === 'buggy' ? 'Dune buggy' : n.vehicle);
  el.replaceChildren(close, mk('b', `Watching “${n.name}” drive`), mk('div', `by ${n.by || 'a driver'} · ${car} on ${where}, ${groundName().toLowerCase()} · ${n.weights} weights${n.h ? `, ${n.h} hidden` : ''} · ${n.bestLap != null ? 'its best lap ' + fmt(n.bestLap) : 'no lap yet'}`, 'opacity:.8;font-size:12px;margin-top:2px'),
    mk('div', 'Any driving key takes the wheel · I opens the lab', 'opacity:.6;font-size:11px;margin-top:4px'));
}

// ---------- the tracks (#329): the race rooms' maps, to drive alone (the start menu's first row) ----------""")
# once the tracks' list is asked for (it waits for it)
rep("""  new MutationObserver(() => { const d = menu.style.display; if (d !== 'none' && was === 'none') trkLoad(); was = d; }).observe(menu, { attributes: true, attributeFilter: ['style'] });
}
""", """  new MutationObserver(() => { const d = menu.style.display; if (d !== 'none' && was === 'none') trkLoad(); was = d; }).observe(menu, { attributes: true, attributeFilter: ['style'] });
}
if (PV.id && /^[a-z0-9]{12}$/.test(PV.id)) aiPreviewStart(PV.id);      // (#336)
""")
open(ep, 'w', encoding='utf-8').write(s)
print('preview patched')
