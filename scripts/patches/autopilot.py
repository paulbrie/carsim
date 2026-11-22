# Autopilot (ticket #311): the smallest neural network that learns to drive a lap, trained in the browser on the
# sim's own physics (single player; I opens its panel). 6 inputs -> 8 tanh units -> steer and pedal: 74 weights,
# trained by evolution strategies (no gradients through the physics needed). See the block's header below.
# Applies to public/sim after the other patches (last in the chain):
#   python3 scripts/patches/autopilot.py <dir with engine.js and index.html>
import sys, os
d = sys.argv[1]
ep, hp = os.path.join(d, 'engine.js'), os.path.join(d, 'index.html')
s = open(ep).read()

def rep(a, b):
    global s
    n = s.count(a)
    assert n == 1, (n, a[:140])
    s = s.replace(a, b)

BLOCK = r"""
/* =====================================================================
   AUTOPILOT (#311): the smallest neural network that drives a lap, trained here in the browser.
   The policy: AI_IN inputs -> 2 outputs, steer (-1..1, + = A) and pedal (+ throttle, - brake), each the tanh of a
   weighted sum of the inputs: 16 weights, the smallest there is (AI.h = 0); or with a hidden layer of 8 tanh units
   between (AI.h = 8, 82 weights), the next size up. Its inputs, from the car and the course's racing line (botPath, a point a metre):
     forward speed / 20 m/s; where the line is 6, 15 and 30 m ahead (the sine of its bearing from the car's heading);
     how far the car is to the side of the line / 5 m; how fast it is turning (yaw rate / 2); and a pace note:
     the speed the line can be taken at here (botPath's, from its bends and the ground's grip, braking for those
     ahead included) less ours, / 10 m/s. Without it, braking for a bend is a product of speed and curvature that
     a net this small, trained this way, doesn't find (it learns to go fast, and flies off the first sharp bend).
   Training: evolution strategies. Each generation drives AI_CFG.pop copies of the weights with Gaussian noise
   (+e and -e pairs) for AI_CFG.window s each, all from the same place on the racing line: a random one (from the
   start line only, it would never practise the far bends), or half the time 100 m before where the last exam went
   wrong (arriving there about as fast); a try scores the metres it covers along the line,
   less AI_CFG.crash if it ends off the course, stuck or wrecked rather than in time (or no braking is learnt).
   The weights move toward the noise of the better tries (by rank, with Adam). Then an exam: the new weights
   from the start line, for a lap (its score: metres, or for a lap the course's length and AI_LAP_BONUS a
   second it was quicker than AI_T); the best exam's weights are the autopilot's. A drive ends AI_CFG.off m
   off the line, going backwards or nowhere, upside down or wrecked. Physics only (no lap timing, skids, dust,
   sound), at AI_DT steps, within AI_BUDGET ms a frame; the ground is put back after every drive (the wheels
   dig ruts in sand).
   The best weights so far drive the car (Drive it), as a player would, with lap timing.
   Saved per course and car in this browser. window.__sim.ai: AI, aiTrainSync(gens) for tests.
   ===================================================================== */
const AI_IN = 7, AI_SIZES = [0, 8];
const aiNP = h => h ? AI_IN * h + h + h * 2 + 2 : AI_IN * 2 + 2;
const AI_T = 150, AI_DT = 1 / 60, AI_BUDGET = 12, AI_LAP_BONUS = 5;
// the training's settings (aiTrainSync may try others): tries a generation, noise, step size, the bearings' scale
const AI_CFG = { pop: 16, sigma: 0.3, lr: 0.2, bearing: 2, off: 8, window: 15, crash: 100 };
const AI_LOOK = [6, 15, 30];
const AI = { h: 0, np: aiNP(0), open: false, training: false, drive: false, key: '', w: null, m: null, v: null, k: 0, gen: 0, best: null, bestFit: -1, bestLap: null,
  hist: [], cands: null, eps: null, fits: null, ci: 0, ep: null, ctl: null, snapH: null, snapC: null, acc: 0, dst: null, el: null };
const aiX = new Float32Array(AI_IN), aiY = new Float32Array(2);

// the network: linear [W (2 x AI_IN), b (2)]; with h hidden units [W1 (h x AI_IN), b1 (h), W2 (h x 2), b2 (2)]
function aiNet(w, x, y) {
  const h = AI.h, n = w.length;
  let o0 = w[n - 2], o1 = w[n - 1];
  if (!h) for (let i = 0; i < AI_IN; i++) { o0 += w[i] * x[i]; o1 += w[AI_IN + i] * x[i]; }
  const b1 = AI_IN * h, w2 = b1 + h;
  for (let j = 0; j < h; j++) {
    let a = w[b1 + j];
    for (let i = 0; i < AI_IN; i++) a += w[j * AI_IN + i] * x[i];
    const h = Math.tanh(a);
    o0 += w[w2 + j * 2] * h; o1 += w[w2 + j * 2 + 1] * h;
  }
  y[0] = Math.tanh(o0); y[1] = Math.tanh(o1);
}
// what the car sees; st follows it along the line: {i: the nearest point (-1: look everywhere), dist: metres along, lat}
function aiObserve(st) {
  const Pt = botPath(), P = Pt.P, n = Pt.n;
  let bi = st.i, bd = Infinity;
  const look = j => { j = ((j % n) + n) % n; const q = P[j], d = (q.x - car.pos.x) ** 2 + (q.z - car.pos.z) ** 2; if (d < bd) { bd = d; bi = j; } };
  if (st.i >= 0) for (let k = -6; k <= 14; k++) look(st.i + k);
  if (st.i < 0 || bd > 400) { bd = Infinity; for (let j = 0; j < n; j++) look(j); st.i = bi; }
  let di = bi - st.i; if (di > n / 2) di -= n; else if (di < -n / 2) di += n;
  st.dist += di * Pt.ds; st.i = bi;
  const q = car.q, fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y), fl = Math.hypot(fx, fz) || 1, cx = fx / fl, cz = fz / fl;
  const p = P[bi];
  st.lat = (car.pos.x - p.x) * p.tz - (car.pos.z - p.z) * p.tx;
  aiX[0] = (car.vel.x * cx + car.vel.z * cz) / 20;
  for (let k = 0; k < AI_LOOK.length; k++) {
    const a = P[(bi + Math.round(AI_LOOK[k] / Pt.ds)) % n], dx = a.x - car.pos.x, dz = a.z - car.pos.z;
    aiX[1 + k] = (cx * dz - cz * dx) / (Math.hypot(dx, dz) || 1) * AI_CFG.bearing;   // the sine of its bearing: no jump from +180° to -180° in a hairpin
  }
  aiX[4] = st.lat / 5; aiX[5] = car.w.y / 2;
  aiX[6] = (p.v - aiX[0] * 20) / 10;                                  // the course's pace note: how much faster it could go here
}
function aiAct(w, st) {
  aiObserve(st); aiNet(w, aiX, aiY);
  return { throttle: Math.max(0, aiY[1]), brake: Math.max(0, -aiY[1]), steer: aiY[0], handbrake: false };
}
// readInput's controls while training or driving (null: the player's)
function aiInput() {
  if (AI.training) return AI.ctl;
  if (!AI.drive) return null;
  if (keys.KeyW || keys.KeyS || keys.KeyA || keys.KeyD || keys.ArrowUp || keys.ArrowDown || keys.ArrowLeft || keys.ArrowRight) {
    AI.drive = false; flash('You have the wheel', '#fff', 1.5); aiShow(); return null;
  }
  return aiAct(AI.best || AI.w, AI.dst);
}

// ---------- training ----------
const aiKey = () => `sandbuggy.ai.${courseKey()}.${VEH.key}.${AI.h}`;
const aiGauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
function aiFresh() {
  const n = AI.np = aiNP(AI.h);
  Object.assign(AI, { w: new Float32Array(n), m: new Float32Array(n), v: new Float32Array(n), k: 0, gen: 0, best: null, bestFit: -1, bestLap: null, hist: [], cands: null, ep: null });
  for (let i = 0; i < n; i++) AI.w[i] = aiGauss() * 0.1;
  AI.w[n - 1] = 0.5;                                              // a little throttle to begin with, or nothing moves
}
function aiLoad() {
  AI.key = aiKey(); aiFresh();
  try {
    const d = JSON.parse(localStorage.getItem(AI.key) || 'null');
    if (d && d.w?.length === AI.np) Object.assign(AI, { w: Float32Array.from(d.w), m: Float32Array.from(d.m || AI.m), v: Float32Array.from(d.v || AI.v), k: d.k || 0, gen: d.gen || 0,
      best: d.best?.length === AI.np ? Float32Array.from(d.best) : null, bestFit: d.bestFit ?? -1, bestLap: d.bestLap ?? null, hist: d.hist || [] });
  } catch (e) { }
}
function aiSave() {
  try { localStorage.setItem(AI.key, JSON.stringify({ w: [...AI.w], m: [...AI.m], v: [...AI.v], k: AI.k, gen: AI.gen, best: AI.best && [...AI.best], bestFit: AI.bestFit, bestLap: AI.bestLap, hist: AI.hist.slice(-300) })); } catch (e) { }
}
function aiNewGen() {
  AI.eps = []; AI.cands = []; AI.fits = new Float32Array(AI_CFG.pop); AI.ci = 0;
  for (let p = 0; p < AI_CFG.pop / 2; p++) {
    const e = new Float32Array(AI.np); for (let i = 0; i < AI.np; i++) e[i] = aiGauss();
    AI.eps.push(e);
    for (const sg of [1, -1]) { const c = new Float32Array(AI.np); for (let i = 0; i < AI.np; i++) c[i] = AI.w[i] + sg * AI_CFG.sigma * e[i]; AI.cands.push(c); }
  }
}
function aiEndGen() {
  // ranks, -0.5 .. 0.5, so one lucky episode doesn't run away with it
  const order = [...AI.fits.keys()].sort((a, b) => AI.fits[a] - AI.fits[b]), u = new Float32Array(AI_CFG.pop);
  order.forEach((c, r) => { u[c] = r / (AI_CFG.pop - 1) - 0.5; });
  const g = new Float32Array(AI.np);
  AI.eps.forEach((e, p) => { const d = u[2 * p] - u[2 * p + 1]; for (let i = 0; i < AI.np; i++) g[i] += d * e[i] / (AI_CFG.pop * AI_CFG.sigma); });
  AI.k++;
  const b1 = 1 - 0.9 ** AI.k, b2 = 1 - 0.999 ** AI.k, lr = AI_CFG.lr * (AI.bestLap != null ? 0.3 : 1);   // smaller steps once it laps: refine, don't wander off
  for (let i = 0; i < AI.np; i++) {
    AI.m[i] = 0.9 * AI.m[i] + 0.1 * g[i]; AI.v[i] = 0.999 * AI.v[i] + 0.001 * g[i] * g[i];
    AI.w[i] += lr * (AI.m[i] / b1) / (Math.sqrt(AI.v[i] / b2) + 1e-8);
  }
  let sum = 0, mx = -Infinity; for (const f of AI.fits) { sum += f; mx = Math.max(mx, f); }
  AI.tryAvg = sum / AI_CFG.pop;
  AI.cands = null; AI.exam = true;                                     // next: the new weights, from the start line
}
// a drive: w from d metres along the racing line (0: the start line, behind it as a lap starts), at most limit s
function aiStartEpisode(w, d, limit) {
  H.set(AI.snapH); C.set(AI.snapC);
  repairAll(); AI.acc = 0;
  if (!d) placeAtGate(0, -8);
  else { const q = aiLineAt(d); resetCar(q.x, q.z, Math.atan2(q.tx, q.tz)); lap.prev.copy(car.pos); }
  // as a fresh car: nothing carried over from the last drive (gear, revs, wheel spin, steering), or no two drives compare
  for (const W of car.wheels) Object.assign(W, { omega: 0, spin: 0, t: car.REST, comp: 0, contact: false, sink: 0, slip: 0, slipSpeed: 0 });
  Object.assign(car.eng, { gear: 1, rpm: ENG.idle, cut: false, shiftT: 0, reverse: false, load: 0, liftT: 9 });
  car.throttle = 0; car.steer = 0;
  AI.ep = { w, st: { i: -1, dist: 0, lat: 0 }, t: 0, max: 0, chk: 0, chkDist: 0, limit };
}
// one physics step of the episode under way: its score when it ends, else null
function aiStep() {
  const E = AI.ep, len = botPath().len;
  AI.ctl = aiAct(E.w, E.st);
  readInput(AI_DT);
  AI.acc += AI_DT;
  while (AI.acc >= DT) { stepCar(DT); collideGates(DT); AI.acc -= DT; }
  car.grace = Math.max(0, car.grace - AI_DT); hitCooldown = 1;   // (no crash messages for each try)
  E.t += AI_DT; E.max = Math.max(E.max, E.st.dist);
  const why = E.st.dist >= len ? 'lap' : Math.abs(E.st.lat) > AI_CFG.off ? 'off' : E.st.dist < E.max - 15 ? 'back' : car.wrecked ? 'wreck' : up.y < 0.3 ? 'over'
    : E.t >= E.limit ? 'time' : E.t >= E.chk + 4 && E.st.dist - E.chkDist < 4 ? 'stuck' : null;
  if (E.t >= E.chk + 4) { E.chk = E.t; E.chkDist = E.st.dist; }
  if (!why) return null;
  const fit = why === 'lap' ? len + AI_LAP_BONUS * Math.max(0, AI_T - E.t) : E.max;
  AI.last = { why, at: Math.round(E.max), t: +E.t.toFixed(1), x: Math.round(car.pos.x), z: Math.round(car.pos.z) };
  return fit;
}
// the racing line's point d metres on from the start line (botPath's start, s0, is elsewhere)
function aiLineAt(d) {
  const Pt = botPath();
  if (AI.s0path !== Pt) { const g = TRACK.gates[0]; let bi = 0, bd = Infinity; Pt.P.forEach((q, j) => { const e = (q.x - g.p.x) ** 2 + (q.z - g.p.z) ** 2; if (e < bd) { bd = e; bi = j; } }); AI.s0path = Pt; AI.s0 = bi; }
  return Pt.P[((AI.s0 + Math.round(d / Pt.ds)) % Pt.n + Pt.n) % Pt.n];
}
// a step of the training; false when the frame's work should stop (a generation done)
function aiTick() {
  if (!AI.cands && !AI.exam) { aiNewGen(); AI.from = AI.fail != null && Math.random() < 0.5 ? Math.max(1, AI.fail - 100) : 1 + Math.random() * (botPath().len - 1); }
  if (!AI.ep) AI.exam ? aiStartEpisode(AI.w, 0, AI_T) : aiStartEpisode(AI.cands[AI.ci], AI.from, AI_CFG.window);
  const E = AI.ep, len = botPath().len, fit = aiStep();
  if (fit == null) return true;
  AI.ep = null;
  if (AI.exam) {                                                       // the generation's result
    AI.exam = false;
    AI.fail = E.st.dist < len ? E.st.dist : null;                       // half the next tries start 100 m before: practise where it goes wrong
    if (fit > AI.bestFit) { AI.bestFit = fit; AI.best = Float32Array.from(E.w); AI.bestLap = E.st.dist >= len ? E.t : null; }
    AI.hist.push([Math.round(fit), Math.round(AI.tryAvg)]);
    AI.gen++; aiSave();
    return false;
  }
  AI.fits[AI.ci] = fit - (AI.last.why === 'time' || AI.last.why === 'lap' ? 0 : AI_CFG.crash);   // ending it badly costs: braking for a bend beats flying off it
  if (++AI.ci >= AI_CFG.pop) aiEndGen();
  return true;
}
function aiTrainFrame() {
  if (aiKey() !== AI.key) { aiTrain(false); return; }                 // another course or car
  const t0 = performance.now();
  while (performance.now() - t0 < AI_BUDGET && aiTick()) { }
  refreshChunks(car.pos.x, car.pos.z, 6);
  if ((AI.hudT = (AI.hudT || 0) + 1) % 6 === 0) aiShow();
}
function aiTrain(on) {
  if (on === AI.training) return;
  if (on) {
    if (rp.on) stopReplay();
    if (ed.on) toggleEditor(false);
    AI.drive = false;
    if (aiKey() !== AI.key) aiLoad();
    AI.snapH = H.slice(); AI.snapC = C.slice(); AI.ep = null; AI.cands = null; AI.exam = false;
    AI.training = true; AI.mute = audio; audio = null;                   // the tries are silent (no engine, no crashes)
    if (AI.mute) AI.mute.node.port.postMessage({ on: 0 });
  } else {
    AI.training = false; AI.ep = null; AI.cands = null; AI.exam = false; AI.ctl = null;
    if (AI.snapH) { H.set(AI.snapH); C.set(AI.snapC); AI.snapH = AI.snapC = null; for (const ch of chunks.values()) ch.update(); updateFar(); }
    if (AI.mute) { audio = AI.mute; AI.mute = null; }
    restartRun();
  }
  aiShow();
}
function aiDrive(on) {
  if (on && !(AI.best || AI.w)) return;
  if (AI.training) aiTrain(false);
  AI.drive = on;
  if (on) { restartRun(); AI.dst = { i: -1, dist: 0, lat: 0 }; flash('Autopilot: hands off (any driving key takes over)', '#9fd4ff', 2.5); }
  aiShow();
}
// before the world changes under it (called from regenerateWorld, also at boot, before AI exists)
function aiHalt() { try { if (AI.training) aiTrain(false); } catch (e) { } }
// for tests (the headless browser draws a frame a second): whole generations, now
function aiTrainSync(gens = 1, cfg) {
  if (cfg) { if (cfg.h != null && cfg.h !== AI.h) { AI.h = cfg.h; AI.key = ''; } Object.assign(AI_CFG, cfg); }
  aiTrain(true);
  const g = AI.gen + gens;
  while (AI.gen < g) aiTick();
  aiTrain(false);
  return { gen: AI.gen, bestFit: AI.bestFit, bestLap: AI.bestLap, len: botPath().len, hist: AI.hist.slice(-gens) };
}
// one try with these weights (the best so far), as training drives it: how it ended
function aiTry(w = AI.best || AI.w, log = 0) {
  aiTrain(true);
  aiStartEpisode(w, 0, AI_T);
  const trace = []; let fit = null, n = 0;
  while ((fit = aiStep()) == null) if (log && ++n % log === 0) trace.push([+AI.ep.t.toFixed(1), Math.round(AI.ep.st.dist), +AI.ep.st.lat.toFixed(1), +car.vel.length().toFixed(1), +car.steer.toFixed(2), +AI.ctl.throttle.toFixed(2), +AI.ctl.brake.toFixed(2)]);
  const r = { ...AI.last, fit, trace };
  aiTrain(false);
  return r;
}

// ---------- the panel (I) ----------
document.head.insertAdjacentHTML('beforeend', `<style>
  #aiPanel{display:none;left:12px;top:250px;width:270px;overflow:auto;pointer-events:auto;z-index:3}
  #aiPanel .lt{font-size:12px;letter-spacing:2px;opacity:.85}
  #aiPanel .sub{font-size:11px;opacity:.7;margin-bottom:6px}
  #aiPanel .st{font-variant-numeric:tabular-nums;margin:4px 0}
  #aiPanel canvas{display:block;width:270px;height:54px;margin:4px 0}
  #aiPanel button{font:inherit;font-size:12px;font-weight:700;border:0;border-radius:6px;padding:6px 10px;margin:4px 4px 0 0;cursor:pointer;color:#fff;background:#ffffff26}
  #aiPanel button:hover{background:#ffffff40} #aiPanel button.on{background:#ff5a00}
  #aiPanel small{display:block;opacity:.7;margin-top:6px;font-size:11px;line-height:1.35}
</style>`);
AI.el = document.createElement('div'); AI.el.id = 'aiPanel'; AI.el.className = 'panel';
AI.el.innerHTML = `<div class="lt">AUTOPILOT</div><div class="sub" id="aiSize"></div>
  <div class="st" id="aiStat"></div><canvas id="aiChart" width="540" height="108"></canvas>
  <button id="aiTrain">Train</button><button id="aiDrive">Drive it</button><button id="aiReset">Start over</button><button id="aiH" title="The network's size: inputs straight to the outputs, or a hidden layer of 8 between">Size</button>
  <small>Learns on this course with this car, ${AI_CFG.pop} tries a generation, and remembers it in this browser. Chart: how far
  each generation gets from the start (orange) and its tries' average (white); dashed, a lap. <b>I</b> hides this.</small>`;
document.body.appendChild(AI.el);
AI.el.querySelector('#aiTrain').addEventListener('click', e => { e.currentTarget.blur(); aiTrain(!AI.training); });
AI.el.querySelector('#aiDrive').addEventListener('click', e => { e.currentTarget.blur(); aiDrive(!AI.drive); });
AI.el.querySelector('#aiH').addEventListener('click', e => {
  e.currentTarget.blur();
  const was = AI.training; if (was) aiTrain(false);
  AI.drive = false; AI.h = AI_SIZES[(AI_SIZES.indexOf(AI.h) + 1) % AI_SIZES.length]; aiLoad(); aiShow();
});
AI.el.querySelector('#aiReset').addEventListener('click', e => {
  e.currentTarget.blur();
  if (!confirm(`Forget what the autopilot learnt with the ${VEH.name} on this course?`)) return;
  const was = AI.training; if (was) aiTrain(false);
  AI.drive = false; try { localStorage.removeItem(aiKey()); } catch (err) { } aiLoad(); if (was) aiTrain(true); aiShow();
});
function aiToggle() {
  AI.open = !AI.open;
  if (AI.open && aiKey() !== AI.key && !AI.training) aiLoad();
  AI.el.style.display = AI.open ? 'block' : 'none';
  aiShow();
}
function aiShow() {
  if (!AI.open) return;
  const y0 = document.getElementById('hud').getBoundingClientRect().bottom + 10, help = document.getElementById('help');   // under the car's read-out, over the help
  AI.el.style.top = y0 + 'px'; AI.el.style.maxHeight = ((help.offsetHeight ? help.getBoundingClientRect().top - 10 : innerHeight - 12) - y0) + 'px';
  const len = botPath().len, pct = f => Math.min(100, Math.round(f / len * 100));
  const best = AI.bestFit < 0 ? 'nothing yet' : AI.bestLap != null ? `a full lap in ${fmt(AI.bestLap)}` : `${Math.round(AI.bestFit)} m of ${Math.round(len)} m (${pct(AI.bestFit)} %)`;
  AI.el.querySelector('#aiSize').textContent = AI.h ? `a tiny neural network: ${AI_IN} inputs → ${AI.h} hidden → 2 outputs, ${AI.np} weights`
    : `the smallest network: ${AI_IN} inputs straight to 2 outputs, ${AI.np} weights`;
  AI.el.querySelector('#aiH').textContent = AI.h ? 'Smaller net' : 'Bigger net';
  AI.el.querySelector('#aiStat').innerHTML = `Generation ${AI.gen}${AI.training ? ` · ${AI.exam ? 'exam: a lap from the start' : `try ${AI.ci + 1}/${AI_CFG.pop} from ${Math.round(AI.from)} m`}` : ''}<br>Best: ${best}`;
  AI.el.querySelector('#aiTrain').textContent = AI.training ? 'Pause' : AI.gen ? 'Train more' : 'Train';
  AI.el.querySelector('#aiTrain').classList.toggle('on', AI.training);
  AI.el.querySelector('#aiDrive').textContent = AI.drive ? 'Stop driving' : 'Drive it';
  AI.el.querySelector('#aiDrive').classList.toggle('on', AI.drive);
  AI.el.querySelector('#aiDrive').disabled = AI.bestFit < 0;
  const cv = AI.el.querySelector('#aiChart'), g = cv.getContext('2d'), W = cv.width, Hc = cv.height, Hs = AI.hist.slice(-120), top = len * 1.1;
  g.clearRect(0, 0, W, Hc);
  g.strokeStyle = 'rgba(255,255,255,.35)'; g.setLineDash([6, 6]); g.beginPath(); g.moveTo(0, Hc - len / top * Hc); g.lineTo(W, Hc - len / top * Hc); g.stroke(); g.setLineDash([]);
  for (const [k, col] of [[1, 'rgba(255,255,255,.6)'], [0, '#ff7a1a']]) {
    g.strokeStyle = col; g.lineWidth = 3; g.beginPath();
    Hs.forEach((h, i) => { const x = Hs.length > 1 ? i / (Hs.length - 1) * W : 0, y = Hc - Math.max(0, Math.min(h[k], len)) / top * Hc; i ? g.lineTo(x, y) : g.moveTo(x, y); });   // a lap: on the dashed line
    g.stroke();
  }
}
"""

rep("""
// boot
setTimeout(() => {""", BLOCK + """
// boot
setTimeout(() => {""")
# the controls: the policy's while it trains or drives
rep("""  const o = window.__sim?.override;""", """  const o = aiInput() || window.__sim?.override;""")
# the frame: training instead of the player's driving
rep("""  else if (!window.__sim.paused) simulate(dt);""", """  else if (AI.training) aiTrainFrame();
  else if (!window.__sim.paused) simulate(dt);""")
rep("""  if (e.code === 'KeyY') { rp.on ? stopReplay() : startReplay(); return; }""",
    """  if (e.code === 'KeyI' && !MP.on) { aiToggle(); return; }
  if (e.code === 'KeyY') { rp.on ? stopReplay() : startReplay(); return; }""")
# a new world, or the course editor: training stops first (it puts back the ground it saved when it began)
rep("""function regenerateWorld() {
""", """function regenerateWorld() {
  aiHalt();
""")
rep("""function toggleEditor(on) {
  if (on === ed.on) return;
""", """function toggleEditor(on) {
  if (on === ed.on) return;
  if (on) aiHalt();
""")
rep("""  if (BOTS.n) setBots(BOTS.n);""", """  Object.assign(window.__sim, { ai: AI, aiTrainSync, aiTry, aiDrive });
  if (BOTS.n) setBots(BOTS.n);""")
open(ep, 'w').write(s)

h = open(hp).read()
a = """<b>Y</b> replay &nbsp;"""
assert h.count(a) == 1
h = h.replace(a, """<b>Y</b> replay &nbsp; <b>I</b> autopilot (a tiny neural network learns to drive) &nbsp;""")
open(hp, 'w').write(h)
print('autopilot patched')
