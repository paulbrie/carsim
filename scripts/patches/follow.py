# A lap to follow (#340): giving the network a driver's lap as its example, and reviewing its drive against it.
# The engine already took a recorded lap in place of the racing line and the pace notes (aiDemo, from the console);
# this is what was missing around it:
#   - the driver's own best lap on a course with a car is kept in this browser with its recording (a ghost's trace:
#     carsim.lap.<course>.<car> = { time, trace, at }): a clean flying lap only (over the start line about as fast
#     as over the finish, no respawn, never stopped), not the network's laps;
#   - the lab's "lap to follow" (left column): none, my best lap, or the ghost the room shows; the lap followed keeps
#     whose it is and its time (who, time, src beside e, v, m), and is part of the exam's kind by its time;
#   - a ghost's lap from the grid: its slow first metres are not what a flying lap should copy, so from the start
#     line its speed is the one it ends at until it gets there, eased down to its own as the notes brake;
#   - the review map (pedals around the course) against that lap, or against my best lap when none is followed: the
#     lap's line in gold dashes, its speed in the tooltip, and under the map the time lost and the three stretches
#     where the network loses the most (shaded red, numbered), with the speeds and how much of each it brakes.
# Applies to public/sim/engine.js after the other patches (last in the chain):
#   python3 scripts/patches/follow.py <dir with engine.js>
import sys, os
ep = os.path.join(sys.argv[1], 'engine.js')
s = open(ep, encoding='utf-8').read()

def rep(a, b):
    global s
    n = s.count(a)
    assert n == 1, (n, a[:140])
    s = s.replace(a, b)

# ---- the driver's laps: kept as they are finished
rep("""function finishLap(t, valid) {
  mpLap(t, valid);
""", """function finishLap(t, valid) {
  mpLap(t, valid);
  if (valid) aiKeepLap(t);                                            // (the driver's best lap, for the lab to follow, #340)
""")

# ---- the room's ghost: whose it is and its recording, for the lab
rep("""  Object.assign(mpGhost, { key: m.key, dv: new DataView(u8.buffer), n, course: m.course, ground: m.ground,""",
    """  Object.assign(mpGhost, { key: m.key, dv: new DataView(u8.buffer), n, course: m.course, ground: m.ground, name: m.name, time: m.time, veh: m.vehicle, trace: m.trace,""")
rep("""  const G = mpGhost; G.key = null;
""", """  const G = mpGhost; G.key = null; G.trace = null;
""")

# ---- a recorded lap as the line and the notes: its profile apart (the review uses it too), whose it is kept
rep("""function aiDemo(trace) {
  const key = `sandbuggy.ai.demo.${courseKey()}.${VEH.key}`;
  AI.demoKey = AI.demoCk = null; AI.lineFor = AI.paceFor = null;
  if (trace === null) { try { localStorage.removeItem(key); } catch (e) { } return { demo: false }; }
  let b;""", """function aiDemo(trace, meta) {
  const key = `sandbuggy.ai.demo.${courseKey()}.${VEH.key}`;
  AI.demoKey = AI.demoCk = null; AI.lineFor = AI.paceFor = null;
  if (trace === null) { try { localStorage.removeItem(key); } catch (e) { } return { demo: false }; }
  const d = aiLapProfile(trace);
  if (meta && typeof meta === 'object') Object.assign(d, { who: String(meta.who || '').slice(0, 40), time: Number.isFinite(+meta.time) ? +meta.time : null, src: String(meta.src || '') });
  try { localStorage.setItem(key, JSON.stringify(d)); } catch (err) { }
  return { demo: true, samples: d.m, seconds: +((d.m - 1) * GH_DT).toFixed(1), points: d.e.length, maxOffset: +Math.max(...d.e.map(Math.abs)).toFixed(1) };
}
// a trace along this course: at each metre of its line, how far left of it the lap was (e) and how fast (v)
function aiLapProfile(trace) {
  let b;""")
rep("""  const d = { e: [...sm(e, 4)], v: [...sm(v, 3)], m };
  try { localStorage.setItem(key, JSON.stringify(d)); } catch (err) { }
  return { demo: true, samples: m, seconds: +((m - 1) * GH_DT).toFixed(1), points: n, maxOffset: +Math.max(...d.e.map(Math.abs)).toFixed(1) };
}
""", """  const d = { e: [...sm(e, 4)], v: [...sm(v, 3)], m };
  // a lap from the grid is slow off the line, where a flying lap (an exam's, Drive it's) is at speed: from the start
  // line on, the speed the lap ends at, until it has got there or slows for a bend; then eased down to its own
  aiLineAt(0);
  const i0 = AI.s0, vEnd = d.v[(i0 - 3 + n) % n];
  if (d.v[(i0 + 3) % n] < 0.7 * vEnd) {
    let k = 0;
    for (; k < n / 2; k++) { const i = (i0 + k) % n; if (d.v[i] >= vEnd || (k > 20 && d.v[(i + 5) % n] < d.v[i] - 0.3)) break; d.v[i] = vEnd; }
    for (let j = k - 1; j >= 0; j--) { const i = (i0 + j) % n; d.v[i] = Math.min(d.v[i], Math.sqrt(d.v[(i + 1) % n] ** 2 + 2 * P[i].brk * AI_CFG.gBrake * 9.81 / 7.5 * Pt.ds)); }
    d.grid = true;
  }
  return d;
}
""")
rep("""if (d?.e) AI.demo = { e: Float32Array.from(d.e), v: Float32Array.from(d.v), m: d.m }; } catch (e) { }""",
    """if (d?.e) AI.demo = { e: Float32Array.from(d.e), v: Float32Array.from(d.v), m: d.m, who: d.who || '', time: d.time ?? null, src: d.src || '' }; } catch (e) { }""")
# another lap followed is another exam (the best is examined again)
rep("""aiDemoNow() ? 'demo' : '', JSON.stringify(AI_PEN),""", """(D => D ? 'demo' + (D.time ? Math.round(D.time * 1000) : '') : '')(aiDemoNow()), JSON.stringify(AI_PEN),""")

# ---- the lab: the lap to follow (left column), the review under the map
rep("""Race it</button></div>
""", """Race it</button></div>
    <div class="grp aiFol"><div class="gh">A lap as its example</div><label class="qc" title="A recorded lap as the network's example: where that lap went and how fast, metre by metre, take the place of the computed racing line and pace notes (what it steers by, and the speed it is told each spot can be taken at). It then brakes where that lap brakes. Your best lap here is kept as you drive: a clean flying lap (not the first from the line, no respawn). In a race room, also the ghost you picked in Best laps. A training of this network carries on with the new example; its best lap is driven again">lap to follow <select id="aiFollow"></select></label><div class="sub" id="aiFollowSay"></div></div>
""")
rep("""Hover for the values"></canvas></div></div>
  </section>""", """Hover for the values"></canvas></div><div id="aiMapCmp"></div></div>
  </section>""")
rep("""  AI.el.querySelector('#aiRL').checked = AI_CFG.racingLine;""", """  aiFollowShow();
  AI.el.querySelector('#aiRL').checked = AI_CFG.racingLine;""")

# ---- the map: the lap's line, the stretches where the most is lost, the lap's speed under the pointer
rep("""  // where it drove, a colour a step of the pedals""", """  // against a lap (#340): the stretches where it loses the most, shaded; that lap's line, in gold dashes
  const cmp = aiMapCmp();
  if (cmp) {
    g.strokeStyle = 'rgba(255,90,77,.34)'; g.lineWidth = Math.max(9, 2 * half * s + 4);
    for (const r of cmp.top) { g.beginPath(); for (let k = r.a; k <= r.b; k++) { const q = P[(cmp.s0 + k) % n]; k === r.a ? g.moveTo(X(q.x), Y(q.z)) : g.lineTo(X(q.x), Y(q.z)); } g.stroke(); }
    const R = cmp.R; g.strokeStyle = 'rgba(242,193,78,.85)'; g.lineWidth = 1.25; g.setLineDash([4, 4]); g.beginPath();
    for (let i = 0; i <= n; i++) { const q = P[i % n], e = R.e[i % n], x = X(q.x + q.tz * e), y = Y(q.z - q.tx * e); i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke(); g.setLineDash([]);
  }
  // where it drove, a colour a step of the pedals""")
rep("""  // the car, while it drives
  if (AI.drive) { g.fillStyle = '#fff';""", """  // the stretches' numbers, as under the map
  if (cmp) cmp.top.forEach((r, j) => {
    const q = P[(cmp.s0 + Math.round((r.a + r.b) / 2)) % n], x = X(q.x - q.tz * (half + 4 / s)), y = Y(q.z + q.tx * (half + 4 / s)), rr = big ? 8 : 6.5;
    g.fillStyle = '#ff5a4d'; g.beginPath(); g.arc(x, y, rr, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.font = f(700); g.textAlign = 'center'; g.fillText(String(j + 1), x, y + 0.5); g.textAlign = 'left';
  });
  // the car, while it drives
  if (AI.drive) { g.fillStyle = '#fff';""")
rep("""[`handbrake ${M.hb[bi] ? 'on' : 'off'}`, f(400)]], fs);""", """[`handbrake ${M.hb[bi] ? 'on' : 'off'}`, f(400)],
    ...(cmp ? [[`${aiWhose(cmp.R.who, true)} lap: ${Math.round(cmp.R.v[bi] * 3.6)} km/h${Math.abs(cmp.R.v[bi] * 3.6 - M.kmh[bi]) >= 1 ? ` (it is ${Math.round(Math.abs(cmp.R.v[bi] * 3.6 - M.kmh[bi]))} ${cmp.R.v[bi] * 3.6 > M.kmh[bi] ? 'slower' : 'faster'})` : ''}`, f(400)]] : [])], fs);""")
rep("""  box.classList.toggle('on', on); AI.el.querySelector('.aiMid').classList.toggle('map', on);
  if (on) aiMapDraw();
""", """  box.classList.toggle('on', on); AI.el.querySelector('.aiMid').classList.toggle('map', on);
  if (on) aiMapDraw();
  aiMapCmpShow(on);
""")

# ---- the code
rep("""function aiChartsDraw() {""", """// ---------- a lap to follow (#340): the driver's best lap kept, the lab's choice, the review against it ----------
document.head.insertAdjacentHTML('beforeend', `<style>
  #aiPanel .aiFol{align-items:center} #aiPanel .aiFol label.qc{flex:1;min-width:0;white-space:nowrap} #aiPanel #aiFollow{flex:1;min-width:0} #aiPanel #aiFollowSay{flex-basis:100%;margin:2px 0 0}
  #aiPanel #aiMapCmp{font-size:11px;line-height:1.4;margin-top:6px} #aiPanel #aiMapCmp:empty{display:none} #aiPanel #aiMapCmp div{margin-top:4px}
  #aiPanel #aiMapCmp .n{display:inline-block;min-width:15px;height:15px;line-height:15px;border-radius:8px;background:#ff5a4d;color:#fff;font-size:10px;font-weight:700;text-align:center;margin-right:5px}
  #aiPanel #aiMapCmp .k{opacity:.65} #aiPanel #aiMapCmp .gold{display:inline-block;width:14px;border-top:2px dashed #f2c14e;vertical-align:middle;margin-right:4px}
  #aiPanel.big #aiMapCmp{font-size:12.5px;flex-basis:100%;margin-top:8px;padding-top:8px;border-top:1px solid #ffffff1c}
</style>`);
const aiLapKey = () => `carsim.lap.${courseKey()}.${VEH.key}`;         // (not sandbuggy.ai.*: those go to every worker)
// the driver's best lap here with this car, as kept ({ time, trace, at }); looked up again when the track or the car
// changes, or a second on (courseKey hashes the whole course)
function aiMyLap() {
  const now = performance.now(), ck = AI.myCk;
  if (ck && ck.T === TRACK && ck.v === VEH.key && now - ck.t < 1000) return ck.lap;
  let lap = null;
  try { const d = JSON.parse(localStorage.getItem(aiLapKey()) || 'null'); if (d && Number.isFinite(d.time) && typeof d.trace === 'string') lap = d; } catch (e) { }
  AI.myCk = { T: TRACK, v: VEH.key, t: now, lap };
  return lap;
}
// a lap worth copying, on the replay's tape: no jump (a respawn), never stopped, and over the start line about as fast
// as over the finish (a flying lap: the first lap, from the line, would teach it to dawdle there)
function aiLapClean(t0, t1) {
  let a = null, b = null;
  const sp = f => Math.hypot(f.v[0], f.v[2]);
  for (const f of rp.buf) {
    if (f.t < t0 - 0.02) continue; if (f.t > t1 + 0.02) break;
    if (b && Math.hypot(f.p[0] - b.p[0], f.p[2] - b.p[2]) > 4 + 3 * (f.t - b.t) * sp(b)) return false;
    if (sp(f) < 1.5) return false;
    if (!a) a = f; b = f;
  }
  return !!a && b !== a && sp(a) >= 0.8 * sp(b);
}
function aiKeepLap(t) {
  if (AI.drive || AI.training || rp.on || MP.spectator) return;
  const time = t - lap.lapStart, was = aiMyLap();
  if ((was && was.time <= time) || !aiLapClean(lap.lapStart, t)) return;
  const trace = mpTrace(lap.lapStart, t); if (!trace) return;
  try { localStorage.setItem(aiLapKey(), JSON.stringify({ time, trace, at: Date.now() })); } catch (e) { return; }
  AI.myCk = AI.refCk = null;
}
const aiGhostLap = () => mpGhost.key && mpGhost.trace && mpGhost.veh === VEH.key && Number.isFinite(mpGhost.time) ? { name: String(mpGhost.name || 'a driver'), time: mpGhost.time, trace: mpGhost.trace } : null;
const aiWhose = (who, cap) => who === 'you' ? (cap ? 'Your' : 'your') : who ? `${who}’s` : (cap ? 'The' : 'the');
// which of the laps on offer is the one followed ('': none; 'kept': one that is neither, an earlier best or the console's)
function aiFollowing() {
  const D = aiDemoNow(); if (!D) return '';
  const same = o => o && D.time != null && Math.abs(D.time - o.time) < 1e-6;
  return D.src === 'mine' && same(aiMyLap()) ? 'mine' : D.src === 'ghost' && same(aiGhostLap()) ? 'ghost' : 'kept';
}
// follow a lap ('mine', 'ghost') or none (''): a training under way carries on with it, its best examined again
function aiFollow(id) {
  const mine = aiMyLap(), G = aiGhostLap();
  try {
    if (id === 'mine' && mine) aiDemo(mine.trace, { who: 'you', time: mine.time, src: 'mine' });
    else if (id === 'ghost' && G) aiDemo(G.trace, { who: G.name, time: G.time, src: 'ghost' });
    else if (id === '') aiDemo(null);
    else return false;
  } catch (e) { flash(`That lap can't be followed: ${e.message || e}`, '#ff8a7a', 3); return false; }
  AI.followSig = AI.cmpSig = null;
  if (AI.training && AI.examKind !== aiExamKind()) { aiTrain(false); aiTrain(true); }
  aiShow();
  return true;
}
function aiFollowShow() {
  const sel = AI.el.querySelector('#aiFollow'), say = AI.el.querySelector('#aiFollowSay'), D = aiDemoNow(), mine = aiMyLap(), G = aiGhostLap(), cur = aiFollowing();
  const sig = JSON.stringify([cur, D?.who, D?.time, mine?.time, G?.name, G?.time]);
  if (sig !== AI.followSig) {
    AI.followSig = sig;
    sel.innerHTML = `<option value="">none: the computed line and notes</option>`
      + (mine ? `<option value="mine">my best lap here · ${fmt(mine.time)}</option>` : `<option value="mine" disabled>my best lap here: none yet</option>`)
      + (G ? `<option value="ghost">the ghost: ${mpEsc(G.name)} · ${fmt(G.time)}</option>` : '')
      + (cur === 'kept' ? `<option value="kept">${mpEsc(aiWhose(D.who))} lap${D.time ? ` · ${fmt(D.time)}` : ''} (kept)</option>` : '');
    say.textContent = D ? `Its racing line and pace notes are ${aiWhose(D.who)} ${D.time ? fmt(D.time) + ' ' : ''}lap: where that lap went and how fast, metre by metre.`
      : mine ? `Your best lap here (${fmt(mine.time)}) can be its example: the network then steers by that lap's line and is told its speeds.`
      : 'Drive two laps yourself: your best clean lap after the first is kept, and can be its example.';
  }
  if (document.activeElement !== sel) sel.value = cur;
}
AI.el.querySelector('#aiFollow').addEventListener('change', e => { const v = e.target.value; e.target.blur(); if (v !== 'kept') aiFollow(v); });
// the lap a drive is reviewed against: the one followed, or else the driver's best here ({ e, v, who, time, followed })
function aiRefLap() {
  const D = aiDemoNow(); if (D) return { e: D.e, v: D.v, who: D.who, time: D.time, followed: true };
  const mine = aiMyLap(), Pt = botPath(); if (!mine) return null;
  if (AI.refCk?.Pt !== Pt || AI.refCk.time !== mine.time || AI.refCk.v !== VEH.key) {
    let p = null; try { p = aiLapProfile(mine.trace); } catch (e) { }
    AI.refCk = { Pt, time: mine.time, v: VEH.key, p };
  }
  const p = AI.refCk.p;
  return p && { e: p.e, v: p.v, who: 'you', time: mine.time, followed: false };
}
// Drive it's latest pass against that lap: the time lost and gained, and the stretches where it is more than 5 km/h
// slower (gaps under 10 m joined), the three that cost the most; from the start line on (s0)
function aiMapCmp() {
  const M = AI.map, R = M?.cnt ? aiRefLap() : null; if (!R || R.v.length !== M.n) return null;
  const sig = `${M.cnt}|${R.time}|${R.followed}|${AI.drive ? Math.floor(performance.now() / 500) : ''}`;
  if (AI.cmpSig === sig && AI.cmp?.M === M) return AI.cmp;
  aiLineAt(0);
  const n = M.n, ds = M.Pt.ds, s0 = AI.s0, dt = new Float32Array(n), gap = Math.ceil(10 / ds);
  let lost = 0, gained = 0, cnt = 0;
  for (let i = 0; i < n; i++) if (M.set[i]) {
    dt[i] = ds * (1 / Math.max(M.kmh[i] / 3.6, 2) - 1 / Math.max(R.v[i], 2));
    if (dt[i] > 0) lost += dt[i]; else gained -= dt[i];
    cnt++;
  }
  const runs = []; let cur = null;
  for (let k = 0; k < n; k++) {
    const i = (s0 + k) % n; if (!M.set[i] || R.v[i] * 3.6 - M.kmh[i] <= 5) continue;
    if (cur && k - cur.b <= gap) cur.b = k; else runs.push(cur = { a: k, b: k });
  }
  for (const r of runs) {
    let c = 0, br = 0, wd = 0; r.dt = 0; r.w = -1;
    for (let k = r.a; k <= r.b; k++) {
      const i = (s0 + k) % n; if (!M.set[i]) continue;
      r.dt += dt[i]; c++; if (M.brk[i] > 0.15) br++;
      const d = R.v[i] * 3.6 - M.kmh[i]; if (d > wd) { wd = d; r.w = i; }
    }
    r.brk = c ? br / c : 0;
  }
  const top = runs.filter(r => r.w >= 0 && r.dt >= 0.05).sort((a, b) => b.dt - a.dt).slice(0, 3)
    .map(r => ({ a: r.a, b: r.b, from: r.a * ds, to: r.b * ds, dt: r.dt, brk: r.brk, kmh: M.kmh[r.w], ref: R.v[r.w] * 3.6 }));
  AI.cmpSig = sig;
  return AI.cmp = { M, R, s0, lost, gained, cover: cnt / n, top };
}
// (under the map in the drawer; full screen, where the map's box is small, with the lap to follow in the left column)
function aiMapCmpShow(on) {
  const el = AI.el.querySelector('#aiMapCmp'), c = on ? aiMapCmp() : null, host = AI.el.querySelector(AI.big ? '.aiFol' : '.aiMapBox');
  if (el.parentNode !== host) host.append(el);
  let h = '';
  if (c) {
    const net = c.lost - c.gained, s = v => `${Math.abs(v).toFixed(Math.abs(v) < 10 ? 2 : 1)} s`, whose = aiWhose(c.R.who);
    h = `<span class="gold"></span>Against ${mpEsc(whose)} ${c.R.time ? fmt(c.R.time) + ' ' : ''}lap${c.R.followed ? ', the one it follows' : ''}: <b>${s(net)} ${net >= 0 ? 'slower' : 'faster'}</b>`
      + ` ${c.cover > 0.97 ? 'over the lap' : `over the ${Math.round(c.cover * 100)} % of the course driven so far`}`
      + `${c.lost > 0.05 && c.gained > 0.05 ? ` <span class="k">(loses ${s(c.lost)}, gains ${s(c.gained)})</span>` : ''}.`
      + c.top.map((r, j) => `<div><span class="n">${j + 1}</span>${Math.round(r.from)}–${Math.round(r.to)} m: <b>+${s(r.dt)}</b>, ${Math.round(r.kmh)} km/h where the lap does ${Math.round(r.ref)}`
        + `${r.brk >= 0.05 ? `, on the brake for ${Math.round(r.brk * 100)} % of it` : ', without braking'}</div>`).join('')
      + (c.top.length ? '' : `<div class="k">Nowhere more than 5 km/h slower than that lap.</div>`)
      + (!c.R.followed ? `<div class="k">It isn't following that lap: choose it under “lap to follow” and train on.</div>` : '');
  }
  if (el._h !== h) { el._h = h; el.innerHTML = h; }
}
function aiChartsDraw() {""")
rep("""  Object.assign(window.__sim, { ai: AI, aiTrainSync, aiTry, aiDrive });
""", """  Object.assign(window.__sim, { ai: AI, aiTrainSync, aiTry, aiDrive });
  Object.assign(window.__sim, { aiFollow, aiFollowing, aiMyLap, aiKeepLap, aiLapClean, aiLapProfile, aiMapCmp });   // (a lap to follow, #340)
""")
open(ep, 'w', encoding='utf-8').write(s)
