# Autopilot (ticket #311): the smallest neural network that learns to drive a lap, trained in the browser on the
# sim's own physics (I, or the Autopilot button, opens its panel; in a race room too, but not in a race). 6 inputs -> 8 tanh units -> steer and pedal: 74 weights,
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
   second it was quicker than AI_T); the best exam's weights are the autopilot's. Every drive's score loses AI_PEN:
   so much a metre driven off the road, for the damage done, and for a wreck. A drive ends AI_CFG.off m
   off the line, going backwards or nowhere, upside down or wrecked. Physics only (no lap timing, skids, dust,
   sound), at AI_DT steps, within AI_BUDGET ms a frame; the ground is put back after every drive (the wheels
   dig ruts in sand).
   The best weights so far drive the car (Drive it), as a player would, with lap timing.
   Saved per course and car in this browser. window.__sim.ai: AI, aiTrainSync(gens) for tests.
   ===================================================================== */
const AI_SIZES = [0, 8];
const AI_T = 150, AI_DT = 1 / 60, AI_BUDGET = 12, AI_LAP_BONUS = 5;
// the training's settings (aiTrainSync may try others): tries a generation, noise, step size, the bearings' scale
const AI_CFG = { pop: 16, sigma: 0.3, lr: 0.2, bearing: 2, off: 8, window: 15, crash: 100 };
const AI_LOOK = [6, 15, 30], AI_RAYS = [60, 30, 0, -30, -60], AI_RAY_MAX = 40;
const aiDeg = v => Math.round(Math.asin(clamp(v / AI_CFG.bearing, -1, 1)) * 180 / Math.PI) + '°';
// the inputs to choose from (Inputs & outputs, in the panel): each gives one number or a few, roughly -1..1, shown in real units
const AI_INPUTS = [
  { id: 'speed', names: ['speed'], tip: 'its forward speed', show: v => Math.round(v * 72) + ' km/h' },
  { id: 'line6', names: ['line 6 m'], tip: 'where the racing line is 6 m ahead (the sine of its bearing, + to the left)', show: aiDeg },
  { id: 'line15', names: ['line 15 m'], tip: 'where the racing line is 15 m ahead', show: aiDeg },
  { id: 'line30', names: ['line 30 m'], tip: 'where the racing line is 30 m ahead', show: aiDeg },
  { id: 'offset', names: ['offset'], tip: 'how far it is to the side of the racing line (+ left)', show: v => (v * 5).toFixed(1) + ' m' },
  { id: 'yaw', names: ['yaw rate'], tip: 'how fast it is turning', show: v => Math.round(v * 115) + '°/s' },
  { id: 'pace', names: ['pace note'], tip: "the speed the line can be taken at here (from its bends and the ground's grip) less its own", show: v => (v > 0 ? '+' : '') + Math.round(v * 36) + ' km/h' },
  { id: 'edges', names: ['left edge', 'right edge'], tip: "how far the course's edges are, left and right (the tarmac's on road, the gate posts' off it)", show: v => (v * 10).toFixed(1) + ' m' },
  { id: 'rays', names: AI_RAYS.map(a => a ? `ray ${Math.abs(a)}° ${a > 0 ? 'L' : 'R'}` : 'ray ahead'), tip: `5 feelers, 60° and 30° to either side and straight ahead: how far each goes before it leaves the course (up to ${AI_RAY_MAX} m)`, show: v => Math.round(v * AI_RAY_MAX) + ' m' },
  { id: 'slide', names: ['sideways'], tip: 'how fast it slides sideways (+ to the left)', show: v => (v * 10).toFixed(1) + ' m/s' },
  { id: 'sink', names: ['sinkage'], tip: 'how deep its wheels sink into the ground (the deepest one): digging itself in, on sand', show: v => Math.round(v * 20) + ' cm' },
  { id: 'g', names: ['g forward', 'g sideways'], tip: 'its acceleration in g, forward (+ speeding up, − braking) and sideways (+ turning left: pulled to the left, so you would feel pushed right), smoothed over 0.1 s', show: v => v.toFixed(2) + ' g' },
  { id: 'tilt', names: ['roll', 'pitch'], tip: 'how far it leans to the side (+ left side up) and noses up or down (+ up): about to roll over?', show: v => Math.round(v * 30) + '°' },
];
const AI_DEFAULT_INPUTS = ['speed', 'line6', 'line15', 'line30', 'offset', 'yaw', 'pace'];
// rewards and penalties, in metres on or off a drive's score: per metre driven off the road (the course: the tarmac on road,
// between the gate posts off it), for damage (a wreck's worth: the car's condition from 100 % to 0), for wrecking it; per
// full swing of the steering or pedal output (jerky driving: their changes, added up; lock to lock is 2); and a reward
// per km/h of its average speed along the line; per metre of extra path (driven beyond its progress along the line: running
// wide, weaving)
const AI_PEN = { offRoad: 1, damage: 150, wreck: 100, smooth: 0, speed: 0, path: 0 };
// the weights' count for these inputs and outputs, with h hidden units (0: none)
const aiShape = (inputs, hb, h) => {
  const nIn = AI_INPUTS.filter(d => inputs.includes(d.id)).reduce((a, d) => a + d.names.length, 0), nOut = hb ? 3 : 2;
  return { nIn, nOut, np: h ? nIn * h + h + h * nOut + nOut : nIn * nOut + nOut };
};
const AI = { gens: 0, genEnd: 0, stopAfter: 30, sinceBest: 0, h: 0, np: 0, inputs: AI_DEFAULT_INPUTS, hb: false, kp: false, ks: false, applied: [0, 0], nIn: 7, nOut: 2, names: [], shows: [], look: [], rayEnds: [], viewW: null, nAct: 0, nSim: 0, rateT: 0, rate: '', open: false, training: false, drive: false, key: '', w: null, m: null, v: null, k: 0, gen: 0, best: null, bestFit: -1, bestLap: null,
  hist: [], cands: null, eps: null, fits: null, ci: 0, ep: null, ctl: null, snapH: null, snapC: null, acc: 0, dst: null, el: null };
const aiX = new Float32Array(32), aiY = new Float32Array(3), aiHid = new Float32Array(8);
// what the network takes in and gives out (kept in this browser; each set is a training of its own)
function aiConfig(inputs, hb) {
  inputs = AI_INPUTS.map(d => d.id).filter(id => inputs.includes(id));
  if (!inputs.length) inputs = AI_DEFAULT_INPUTS;
  Object.assign(AI, { inputs, hb: !!hb }, aiShape(inputs, hb, AI.h));
  AI.names = []; AI.shows = [];
  for (const d of AI_INPUTS) if (inputs.includes(d.id)) for (const nm of d.names) { AI.names.push(nm); AI.shows.push(d.show); }
}
try {
  const c = JSON.parse(localStorage.getItem('sandbuggy.ai.config') || 'null');
  aiConfig(c?.inputs || AI_DEFAULT_INPUTS, c?.hb); AI.kp = !!c?.kp; AI.ks = !!c?.ks;
  if (Number.isInteger(c?.stopAfter) && c.stopAfter >= 0) AI.stopAfter = c.stopAfter;
  if (Number.isInteger(c?.gens) && c.gens >= 0) AI.gens = c.gens;
  if (Number.isFinite(c?.off) && c.off >= 3 && c.off <= 30) AI_CFG.off = c.off;
  for (const k in AI_PEN) if (Number.isFinite(c?.pen?.[k]) && c.pen[k] >= 0) AI_PEN[k] = c.pen[k];
} catch (e) { aiConfig(AI_DEFAULT_INPUTS, false); }
const aiKeepConfig = () => { try { localStorage.setItem('sandbuggy.ai.config', JSON.stringify({ off: AI_CFG.off, gens: AI.gens, stopAfter: AI.stopAfter, inputs: AI.inputs, hb: AI.hb, kp: AI.kp, ks: AI.ks, pen: AI_PEN })); } catch (e) { } };
// another set of inputs or outputs (or pedals / steering like the keyboard's): another training (this one stays, under its own key)
function aiSetInputs(inputs, hb, quiet, kp = AI.kp, ks = AI.ks) {
  if (AI.training) aiTrain(false);
  AI.drive = false;
  aiConfig(inputs, hb); AI.kp = !!kp; AI.ks = !!ks; aiKeepConfig();
  if (!quiet) { aiLoad(); aiShow(); }
}

// the network: linear [W (outputs x inputs), b (outputs)]; with h hidden units [W1 (h x inputs), b1 (h), W2 (h x outputs), b2 (outputs)];
// outputs: steer, pedal, and with the handbrake, the handbrake (on above 0)
function aiNet(w, x, y) {
  const h = AI.h, n = w.length, I = AI.nIn, O = AI.nOut, b2 = n - O;
  for (let k = 0; k < O; k++) y[k] = w[b2 + k];
  if (!h) for (let k = 0; k < O; k++) for (let i = 0; i < I; i++) y[k] += w[k * I + i] * x[i];
  const b1 = I * h, w2 = b1 + h;
  for (let j = 0; j < h; j++) {
    let a = w[b1 + j];
    for (let i = 0; i < I; i++) a += w[j * I + i] * x[i];
    const hv = aiHid[j] = Math.tanh(a);
    for (let k = 0; k < O; k++) y[k] += w[w2 + j * O + k] * hv;
  }
  for (let k = 0; k < O; k++) y[k] = Math.tanh(y[k]);
}
// the course's edges: a grid (1 m) of the distance to the racing line, made once a course, and its half-width
const AF_N = WORLD + 1;
function aiField() {
  const Pt = botPath(); if (AI.fieldPt === Pt) return AI.field;
  const F = new Float32Array(AF_N * AF_N).fill(99), R = AI_RAY_MAX + 12;
  for (const q of Pt.P) {
    const ci = Math.round(q.x + HALF), cj = Math.round(q.z + HALF);
    for (let j = Math.max(0, cj - R); j <= Math.min(AF_N - 1, cj + R); j++) for (let i = Math.max(0, ci - R); i <= Math.min(AF_N - 1, ci + R); i++) {
      const d = Math.hypot(i - HALF - q.x, j - HALF - q.z), k = j * AF_N + i; if (d < F[k]) F[k] = d;
    }
  }
  AI.fieldPt = Pt; return AI.field = F;
}
const aiHalfW = () => ROAD ? ROAD_HALF : (TRACK.gates[0]?.half ?? 9.5);
// a feeler from the car, deg to the left of its heading: metres until it leaves the course (AI_RAY_MAX if it doesn't)
function aiRay(cx, cz, deg, k) {
  const F = aiField(), W = aiHalfW(), a = deg * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
  const dx = c * cx + sn * cz, dz = c * cz - sn * cx;
  let s = 1;
  for (; s <= AI_RAY_MAX; s++) {
    const i = Math.round(car.pos.x + dx * s + HALF), j = Math.round(car.pos.z + dz * s + HALF);
    if (i < 0 || j < 0 || i >= AF_N || j >= AF_N || F[j * AF_N + i] > W) break;
  }
  s = Math.min(s, AI_RAY_MAX);
  AI.rayEnds[k] = [car.pos.x + dx * s, car.pos.z + dz * s];
  return s;
}
// what the car sees; st follows it along the line: {i: the nearest point (-1: look everywhere), dist: metres along, lat}
function aiObserve(st, dt = AI_DT) {
  const Pt = botPath(), P = Pt.P, n = Pt.n;
  let bi = st.i, bd = Infinity;
  const look = j => { j = ((j % n) + n) % n; const q = P[j], d = (q.x - car.pos.x) ** 2 + (q.z - car.pos.z) ** 2; if (d < bd) { bd = d; bi = j; } };
  if (st.i >= 0) for (let k = -6; k <= 14; k++) look(st.i + k);
  if (st.i < 0 || bd > 400) { bd = Infinity; for (let j = 0; j < n; j++) look(j); st.i = bi; }
  let di = bi - st.i; if (di > n / 2) di -= n; else if (di < -n / 2) di += n;
  st.dist += di * Pt.ds; st.i = bi;
  const q = car.q, fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y), fl = Math.hypot(fx, fz) || 1, cx = fx / fl, cz = fz / fl;
  const p = P[bi], v = car.vel.x * cx + car.vel.z * cz;
  st.lat = (car.pos.x - p.x) * p.tz - (car.pos.z - p.z) * p.tx;      // + : left of the line
  const brg = [];
  for (let k = 0; k < AI_LOOK.length; k++) {
    const a = AI.look[k] = P[(bi + Math.round(AI_LOOK[k] / Pt.ds)) % n], dx = a.x - car.pos.x, dz = a.z - car.pos.z;
    brg.push((cx * dz - cz * dx) / (Math.hypot(dx, dz) || 1) * AI_CFG.bearing);   // the sine of its bearing: no jump from +180° to -180° in a hairpin
  }
  let j = 0;
  AI.rayEnds.length = 0;
  // the g, from the change of velocity since the last decision, smoothed
  if (st.pv) {
    const ax = (car.vel.x - st.pv[0]) / Math.max(dt, 1e-3), az = (car.vel.z - st.pv[1]) / Math.max(dt, 1e-3), kf = Math.min(1, dt / 0.1);
    st.gf = (st.gf || 0) + ((ax * cx + az * cz) / 9.81 - (st.gf || 0)) * kf;
    st.gs = (st.gs || 0) + ((ax * cz - az * cx) / 9.81 - (st.gs || 0)) * kf;
  }
  st.pv = [car.vel.x, car.vel.z];
  for (const id of AI.inputs) switch (id) {
    case 'speed': aiX[j++] = v / 20; break;
    case 'line6': aiX[j++] = brg[0]; break;
    case 'line15': aiX[j++] = brg[1]; break;
    case 'line30': aiX[j++] = brg[2]; break;
    case 'offset': aiX[j++] = st.lat / 5; break;
    case 'yaw': aiX[j++] = car.w.y / 2; break;
    case 'pace': aiX[j++] = (p.v - v) / 10; break;                    // the course's pace note: how much faster it could go here
    case 'edges': { const W = aiHalfW(); aiX[j++] = (W - st.lat) / 10; aiX[j++] = (W + st.lat) / 10; break; }
    case 'rays': AI_RAYS.forEach((a, k) => { aiX[j++] = aiRay(cx, cz, a, k) / AI_RAY_MAX; }); break;
    case 'slide': aiX[j++] = (car.vel.x * cz - car.vel.z * cx) / 10; break;
    case 'sink': { let d = 0; for (const W of car.wheels) if (W.contact) d = Math.max(d, W.sink || 0); aiX[j++] = d / 0.2; break; }
    case 'g': aiX[j++] = st.gf || 0; aiX[j++] = st.gs || 0; break;
    case 'tilt': {                                                     // the body's +x (left) and +z (nose) axes: how high they point
      const r = Math.asin(clamp(2 * (q.x * q.y + q.w * q.z), -1, 1)), pt = Math.asin(clamp(2 * (q.y * q.z - q.w * q.x), -1, 1));
      aiX[j++] = r * 6 / Math.PI; aiX[j++] = pt * 6 / Math.PI; break;
    }
  }
}
// like the keyboard (an option for each): only full, nothing or full the other way, past a third either side
const aiKey3 = v => v > 1 / 3 ? 1 : v < -1 / 3 ? -1 : 0;
function aiAct(w, st, dt) {
  aiObserve(st, dt); aiNet(w, aiX, aiY); AI.viewW = w; AI.nAct++;
  const steer = AI.applied[0] = AI.ks ? aiKey3(aiY[0]) : aiY[0], pedal = AI.applied[1] = AI.kp ? aiKey3(aiY[1]) : aiY[1];
  return AI.lastCtl = { throttle: Math.max(0, pedal), brake: Math.max(0, -pedal), steer, handbrake: AI.nOut > 2 && aiY[2] > 0 };
}
// readInput's controls while training or driving (null: the player's)
function aiInput(dt) {
  if (AI.training) return AI.ctl;
  if (!AI.drive) return null;
  if (keys.KeyW || keys.KeyS || keys.KeyA || keys.KeyD || keys.ArrowUp || keys.ArrowDown || keys.ArrowLeft || keys.ArrowRight) {
    AI.drive = false; flash('You have the wheel', '#fff', 1.5); aiShow(); return null;
  }
  return aiAct(AI.best || AI.w, AI.dst, dt);
}

// ---------- training ----------
// a training per course, car, size and inputs (the original 7 without the handbrake: no suffix)
const aiSig = () => AI.hb || AI.kp || AI.ks || AI.inputs.join() !== AI_DEFAULT_INPUTS.join() ? '.' + AI.inputs.join('+') + (AI.hb ? '+hb' : '') + (AI.kp ? '+kp' : '') + (AI.ks ? '+ks' : '') : '';
const aiKey = () => `sandbuggy.ai.${courseKey()}.${VEH.key}.${AI.h}${aiSig()}`;
const aiGauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
function aiFresh() {
  const n = AI.np = aiShape(AI.inputs, AI.hb, AI.h).np, b = n - AI.nOut;
  Object.assign(AI, { w: new Float32Array(n), m: new Float32Array(n), v: new Float32Array(n), k: 0, gen: 0, best: null, bestFit: -1, bestLap: null, sinceBest: 0, hist: [], cands: null, ep: null });
  for (let i = 0; i < n; i++) AI.w[i] = aiGauss() * 0.1;
  AI.w[b + 1] = 0.5;                                                  // a little throttle to begin with, or nothing moves
  if (AI.nOut > 2) AI.w[b + 2] = -1;                                  // the handbrake off, until it learns better
}
function aiLoad() {
  AI.key = aiKey(); aiFresh();
  try {
    const d = JSON.parse(localStorage.getItem(AI.key) || 'null');
    if (d && d.w?.length === AI.np) Object.assign(AI, { w: Float32Array.from(d.w), m: Float32Array.from(d.m || AI.m), v: Float32Array.from(d.v || AI.v), k: d.k || 0, gen: d.gen || 0,
      best: d.best?.length === AI.np ? Float32Array.from(d.best) : null, bestFit: d.bestFit ?? -1, bestLap: d.bestLap ?? null, hist: d.hist || [], sinceBest: d.sinceBest | 0 });
  } catch (e) { }
}
function aiSave() {
  try { localStorage.setItem(AI.key, JSON.stringify({ w: [...AI.w], m: [...AI.m], v: [...AI.v], k: AI.k, gen: AI.gen, best: AI.best && [...AI.best], bestFit: AI.bestFit, bestLap: AI.bestLap, sinceBest: AI.sinceBest, hist: AI.hist.slice(-300) })); } catch (e) { }
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
  AI.ep = { w, st: { i: -1, dist: 0, lat: 0 }, t: 0, max: 0, chk: 0, chkDist: 0, limit, offM: 0, swing: 0, pc: null, driven: 0 };
}
// one physics step of the episode under way: its score when it ends, else null
function aiStep() {
  const E = AI.ep, len = botPath().len;
  AI.ctl = aiAct(E.w, E.st, AI_DT);
  if (E.pc) E.swing += Math.abs(AI.applied[0] - E.pc[0]) + Math.abs(AI.applied[1] - E.pc[1]);   // how much the controls moved
  E.pc = [AI.applied[0], AI.applied[1]];
  readInput(AI_DT);
  AI.acc += AI_DT;
  while (AI.acc >= DT) { stepCar(DT); collideGates(DT); AI.acc -= DT; }
  car.grace = Math.max(0, car.grace - AI_DT); hitCooldown = 1;   // (no crash messages for each try)
  E.t += AI_DT; E.max = Math.max(E.max, E.st.dist); AI.nSim += AI_DT;
  const sp = Math.hypot(car.vel.x, car.vel.z) * AI_DT; E.driven += sp;
  if (Math.abs(E.st.lat) > aiHalfW()) E.offM += sp;                    // off the road
  const why = E.st.dist >= len ? 'lap' : Math.abs(E.st.lat) > AI_CFG.off ? 'off' : E.st.dist < E.max - 15 ? 'back' : car.wrecked ? 'wreck' : up.y < 0.3 ? 'over'
    : E.t >= E.limit ? 'time' : E.t >= E.chk + 4 && E.st.dist - E.chkDist < 4 ? 'stuck' : null;
  if (E.t >= E.chk + 4) { E.chk = E.t; E.chkDist = E.st.dist; }
  if (!why) return null;
  const dmg = 1 - carCondition(), kmh = E.max / Math.max(E.t, 1) * 3.6, extra = Math.max(0, E.driven - E.max);
  const pen = AI_PEN.offRoad * E.offM + AI_PEN.damage * dmg + (car.wrecked ? AI_PEN.wreck : 0) + AI_PEN.smooth * E.swing + AI_PEN.path * extra - AI_PEN.speed * kmh;
  const fit = (why === 'lap' ? len + AI_LAP_BONUS * Math.max(0, AI_T - E.t) : E.max) - pen;
  AI.last = { why, at: Math.round(E.max), t: +E.t.toFixed(1), x: Math.round(car.pos.x), z: Math.round(car.pos.z), offM: Math.round(E.offM), dmg: Math.round(dmg * 100), wrecked: car.wrecked, pen: Math.round(pen), kmh: Math.round(kmh), swing: +E.swing.toFixed(1), extra: Math.round(extra) };
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
    const lapT = E.st.dist >= len ? +E.t.toFixed(2) : null;
    if (fit > AI.bestFit) { AI.bestFit = fit; AI.best = Float32Array.from(E.w); AI.bestLap = lapT; AI.sinceBest = 0; }
    else if (AI.bestLap != null) AI.sinceBest++;                        // it laps: how long since a better one
    if (AI.stopAfter && AI.bestLap != null && AI.sinceBest >= AI.stopAfter) AI.autoStop = `no better lap in ${AI.stopAfter} generation${AI.stopAfter > 1 ? 's' : ''}`;
    if (AI.gens && AI.gen + 1 >= AI.genEnd) AI.autoStop = `${AI.gens} generation${AI.gens > 1 ? 's' : ''} done`;   // (gen counts this one just below)
    AI.hist.push([Math.round(fit), Math.round(AI.tryAvg), lapT]); AI.lastExam = AI.last;
    AI.gen++; aiSave();
    return false;
  }
  AI.fits[AI.ci] = fit - (AI.last.why === 'time' || AI.last.why === 'lap' ? 0 : AI_CFG.crash);   // ending it badly costs: braking for a bend beats flying off it
  if (++AI.ci >= AI_CFG.pop) aiEndGen();
  return true;
}
function aiTrainFrame(dt) {
  if (aiKey() !== AI.key) { aiTrain(false); return; }                 // another course or car
  if (AI.watch) {                                                      // at 1x: as much driving as time went by, with the sound
    audio = AI.mute;
    AI.wacc = Math.min((AI.wacc || 0) + dt, 4 * AI_DT);
    while (AI.wacc >= AI_DT) { AI.wacc -= AI_DT; aiTick(); }
  } else {
    const t0 = performance.now();
    while (performance.now() - t0 < AI_BUDGET && aiTick()) { }
  }
  refreshChunks(car.pos.x, car.pos.z, 6);
  if (AI.autoStop) {                                                   // its generations done, or no better lap for a while
    AI.autoStopWhy = AI.autoStop; AI.autoStop = false; aiTrain(false);
    flash(`Training stopped: ${AI.autoStopWhy}`, '#9fd4ff', 3);
  }
  if ((AI.hudT = (AI.hudT || 0) + 1) % 6 === 0) aiShow();
}
function aiTrain(on) {
  if (on === AI.training) return;
  AI.autoStop = false;
  if (on) AI.genEnd = AI.gen + AI.gens;                                // so many more, from now
  if (on && !aiAllowed()) { flash('Not during a race', '#ffd88a', 1.5); return; }
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
    AI.watch = false;
    restartRun();
  }
  aiShow();
}
function aiDrive(on) {
  if (on && !(AI.best || AI.w)) return;
  if (on && !aiAllowed()) { flash('Not during a race', '#ffd88a', 1.5); return; }
  if (AI.training) aiTrain(false);
  AI.drive = on;
  if (on) { restartRun(); AI.dst = { i: -1, dist: 0, lat: 0 }; flash('Autopilot: hands off (any driving key takes over)', '#9fd4ff', 2.5); }
  aiShow();
}
// ---------- watching it think: the network, live, and on the track the points it looks at ----------
const aiCol = (v, a = 1) => v >= 0 ? `rgba(255,138,61,${a})` : `rgba(74,168,255,${a})`;
const aiMarks = [0, 1, 2].map(k => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.45 - k * 0.08, 14, 10), new THREE.MeshBasicMaterial({ color: 0x5fe0ff, transparent: true, opacity: 0.85, depthTest: false }));
  m.renderOrder = 20; m.visible = false; scene.add(m); return m;
});
// the feelers (edge rays), when it has them: a line from the car to where each leaves the course
const aiRayLines = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(AI_RAYS.length * 6), 3)),
  new THREE.LineBasicMaterial({ color: 0x5fe0ff, transparent: true, opacity: 0.8, depthTest: false }));
aiRayLines.renderOrder = 20; aiRayLines.visible = false; aiRayLines.frustumCulled = false; scene.add(aiRayLines);
let aiVizT = 0;
// ---------- its hands and feet: the wheel and the pedals as it works them, top right, while it has the car ----------
const aiCtlCv = document.createElement('canvas'); aiCtlCv.id = 'aiCtl'; aiCtlCv.className = 'panel'; aiCtlCv.width = 560; aiCtlCv.height = 250;
aiCtlCv.style.cssText = 'display:none;position:fixed;top:12px;width:280px;height:125px;padding:0;pointer-events:none;z-index:2';
document.body.appendChild(aiCtlCv);
let aiCtlT = 0, aiCtlPlaceT = 0, aiCtlFoot = 0;
function aiCtlDraw(dt, live) {
  const show = live && !rp.on && !!AI.lastCtl;
  if ((aiCtlCv.style.display !== 'none') !== show) aiCtlCv.style.display = show ? 'block' : 'none';
  if (!show) return;
  if ((aiCtlPlaceT -= dt) <= 0) {                                      // left of the minimap; under the best laps if they are there
    aiCtlPlaceT = 0.5;
    // between the timer and the minimap, as wide as fits (180 to 280 px); under the best laps if they are there; else under the minimap
    const m = document.getElementById('mapWrap').getBoundingClientRect(), t = timerEl.getBoundingClientRect(), bl = document.getElementById('bestLaps'), b = bl && bl.offsetWidth ? bl.getBoundingClientRect() : null;
    const right = innerWidth - m.left + 10, gap = m.left - 10 - (t.right + 10), w = Math.min(280, gap);
    const over = b && b.right > m.left - 10 - w && b.left < m.left - 10;
    if (w >= 180) { aiCtlCv.style.width = w + 'px'; aiCtlCv.style.height = w * 125 / 280 + 'px'; aiCtlCv.style.right = right + 'px'; aiCtlCv.style.top = (over ? b.bottom + 10 : 12) + 'px'; }
    else { aiCtlCv.style.width = '220px'; aiCtlCv.style.height = 220 * 125 / 280 + 'px'; aiCtlCv.style.right = right + 'px'; aiCtlCv.style.top = (m.bottom + 10) + 'px'; }
  }
  if ((aiCtlT += dt) < 1 / 30) return; aiCtlT = 0;
  const g = aiCtlCv.getContext('2d'), W = aiCtlCv.width, Hc = aiCtlCv.height, c = AI.lastCtl, steer = c.steer, gas = c.throttle, brk = c.brake;
  g.clearRect(0, 0, W, Hc);
  g.font = '600 20px system-ui, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillStyle = 'rgba(255,255,255,.7)';
  g.fillText(AI.training ? 'AUTOPILOT · TRAINING' : 'AUTOPILOT', 18, 22);
  // the wheel: full lock either way is three quarters of a turn
  const cx = 120, cy = 124, R = 70, a = -steer * Math.PI * 1.5;
  g.save(); g.translate(cx, cy); g.rotate(a);
  g.lineWidth = 16; g.strokeStyle = '#2a2a2e'; g.beginPath(); g.arc(0, 0, R, 0, 7); g.stroke();
  g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.arc(0, 0, R + 8, 0, 7); g.stroke();
  g.lineWidth = 16; g.strokeStyle = '#ff7a1a'; g.beginPath(); g.arc(0, 0, R, -Math.PI / 2 - 0.13, -Math.PI / 2 + 0.13); g.stroke();   // the top mark
  g.lineWidth = 12; g.strokeStyle = '#3a3a40';
  for (const s of [Math.PI, 0, Math.PI / 2]) { g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(s) * R, Math.sin(s) * R); g.stroke(); }
  g.fillStyle = '#4a4a52'; g.beginPath(); g.arc(0, 0, 22, 0, 7); g.fill();
  g.restore();
  g.textAlign = 'center'; g.fillStyle = '#fff'; g.font = '700 22px system-ui, sans-serif';
  g.fillText(Math.abs(steer) < 0.02 ? 'straight' : `${steer > 0 ? '◀ ' : ''}${Math.round(Math.abs(steer) * 100)}%${steer < 0 ? ' ▶' : ''}`, cx, cy + R + 32);
  // the pedals: brake and gas, each pushed down as far as it is pressed; the foot on the one it presses
  const pedal = (x, w, v, col, label) => {
    const top = 64, h = 110, dy = v * 34;
    g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(x - 4, top - 6, w + 8, h + 30);
    g.save(); g.translate(x + w / 2, top + dy);
    g.fillStyle = v > 0.01 ? col : '#3a3a40'; g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 2;
    g.beginPath(); g.roundRect(-w / 2, 0, w, h - dy * 0.4, 8); g.fill(); g.stroke();
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 3;
    for (let k = 1; k < 5; k++) { const yy = k * (h - dy * 0.4) / 5; g.beginPath(); g.moveTo(-w / 2 + 8, yy); g.lineTo(w / 2 - 8, yy); g.stroke(); }
    g.restore();
    g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x, top + h + 12, w, 10);
    g.fillStyle = col; g.fillRect(x, top + h + 12, w * v, 10);
    g.fillStyle = '#fff'; g.font = '600 18px system-ui, sans-serif'; g.textAlign = 'center';
    g.fillText(label, x + w / 2, top + h + 40); g.fillText(`${Math.round(v * 100)}%`, x + w / 2, top + h + 62);
    return { x: x + w / 2, y: top + dy };
  };
  const bp = pedal(290, 84, brk, '#e0352b', 'BRAKE'), gp = pedal(430, 64, gas, '#2fbf4a', 'GAS');
  // the foot: over the gas, over the brake, or resting between, eased so it moves as a foot would
  const want = gas > 0.01 ? 1 : brk > 0.01 ? -1 : 0; aiCtlFoot += (want - aiCtlFoot) * Math.min(1, dt * 12);
  const fx = lerp(lerp(bp.x, gp.x, 0.5), aiCtlFoot > 0 ? gp.x : bp.x, Math.abs(aiCtlFoot)), fy = lerp(60, aiCtlFoot > 0 ? gp.y : bp.y, Math.abs(aiCtlFoot)) - 8;
  g.save(); g.translate(fx, fy); g.rotate(-0.25);
  g.fillStyle = '#d9d2c5'; g.strokeStyle = '#1b1b1b'; g.lineWidth = 3;
  g.beginPath(); g.roundRect(-26, -44, 52, 70, 22); g.fill(); g.stroke();                       // the shoe, from above
  g.fillStyle = '#b5ada0'; g.beginPath(); g.ellipse(0, -48, 18, 10, 0, 0, 7); g.fill(); g.stroke();   // the ankle
  g.restore();
  // the handbrake, if it has one
  if (AI.nOut > 2) {
    g.fillStyle = c.handbrake ? '#ff3b2f' : 'rgba(255,255,255,.15)'; g.beginPath(); g.roundRect(W - 92, 8, 80, 28, 14); g.fill();
    g.fillStyle = '#fff'; g.font = '700 16px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('H-BRAKE', W - 52, 23);
  }
}
function aiViz(dt) {
  const live = (AI.training || AI.drive) && !!AI.viewW;
  aiCtlDraw(dt, live);
  // decisions a second (the network runs on the main thread, in readInput: once a frame driving, once every
  // AI_DT of simulated time training, as many as fit in AI_BUDGET ms a frame)
  const now = performance.now(), el = (now - (AI.rateT || now)) / 1000;     // real seconds (a frame's dt is capped)
  if (!AI.rateT) AI.rateT = now;
  else if (el >= 1) {
    const n = AI.nAct / el, x = AI.nSim / el;
    const f = v => v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString('en');
    AI.rate = !live ? '' : AI.training ? `${f(n)} decisions/s on the main thread · ${AI.watch ? 'at real speed (watching)' : `driving at ${f(x)}× real time`}`
      : `${f(n)} decisions/s on the main thread (one a frame)`;
    AI.nAct = 0; AI.nSim = 0; AI.rateT = now;
    if (AI.open) AI.el.querySelector('#aiRate').textContent = AI.rate;
  }
  for (let k = 0; k < 3; k++) {
    const m = aiMarks[k], q = AI.look[k];
    m.visible = live && AI.open && !!q && !rp.on;
    if (m.visible) m.position.set(q.x, surfaceAt(q.x, q.z, car.pos.y + 5) + 0.6, q.z);
  }
  aiRayLines.visible = live && AI.open && !rp.on && AI.rayEnds.length > 0;
  if (aiRayLines.visible) {
    const a = aiRayLines.geometry.attributes.position;
    AI.rayEnds.forEach(([x, z], k) => { a.setXYZ(2 * k, car.pos.x, car.pos.y + 0.6, car.pos.z); a.setXYZ(2 * k + 1, x, surfaceAt(x, z, car.pos.y + 5) + 0.6, z); });
    a.needsUpdate = true;
  }
  if (!AI.open || (aiVizT += dt) < 0.1) return; aiVizT = 0;
  const cv = AI.el.querySelector('#aiNet'), w = AI.viewW || AI.best || AI.w, I = AI.nIn, O = AI.nOut;
  const want = Math.max(330, 44 + I * 40);                            // as tall as its inputs need
  if (cv.height !== want) { cv.height = want; cv.style.height = want / 2 + 'px'; }
  const g = cv.getContext('2d'), W = cv.width, Hc = cv.height;
  g.clearRect(0, 0, W, Hc);
  if (!w || w.length !== AI.np) return;
  const x = live ? aiX : null, h = AI.h, xi = 150, xo = W - 130, xh = (xi + xo) / 2;
  const yi = i => 22 + i * (Hc - 44) / Math.max(1, I - 1), yo = k => Hc * (k + 0.5) / O, yh = j => 22 + j * (Hc - 44) / Math.max(1, h - 1);
  const edge = (x0, y0, x1, y1, c) => { const m = Math.min(1, Math.abs(c) / 1.5); g.strokeStyle = aiCol(c, 0.12 + 0.88 * m); g.lineWidth = 1 + 7 * m; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
  // the pulls: live, value × weight; idle, the weights themselves
  if (!h) for (let i = 0; i < I; i++) for (let k = 0; k < O; k++) edge(xi, yi(i), xo, yo(k), w[k * I + i] * (x ? x[i] : 1));
  else {
    for (let j = 0; j < h; j++) for (let i = 0; i < I; i++) edge(xi, yi(i), xh, yh(j), w[j * I + i] * (x ? x[i] : 1) * 0.7);
    const w2 = I * h + h;
    for (let j = 0; j < h; j++) for (let k = 0; k < O; k++) edge(xh, yh(j), xo, yo(k), w[w2 + j * O + k] * (x ? aiHid[j] : 1));
    for (let j = 0; j < h; j++) { const v = x ? aiHid[j] : 0; g.fillStyle = aiCol(v, 0.25 + 0.75 * Math.abs(v)); g.beginPath(); g.arc(xh, yh(j), 9, 0, 7); g.fill(); g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 1.5; g.stroke(); }
  }
  const node = (cx, cy, v) => { g.fillStyle = aiCol(v, 0.25 + 0.75 * Math.min(1, Math.abs(v))); g.beginPath(); g.arc(cx, cy, 12, 0, 7); g.fill(); g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 2; g.stroke(); };
  const big = '600 19px system-ui, sans-serif', small = '16px system-ui, sans-serif';
  g.font = big; g.textBaseline = 'middle';
  // inputs, in real units
  for (let i = 0; i < I; i++) {
    node(xi, yi(i), x ? clamp(x[i], -1, 1) : 0);
    g.textAlign = 'right'; g.fillStyle = 'rgba(255,255,255,.85)'; g.fillText(AI.names[i], xi - 20, yi(i) - (x ? 9 : 0));
    if (x) { g.fillStyle = 'rgba(255,255,255,.6)'; g.font = small; g.fillText(AI.shows[i](x[i]), xi - 20, yi(i) + 10); g.font = big; }
  }
  // outputs: what it does
  const out = [['steer', v => Math.abs(v) < 0.05 ? 'straight' : (v > 0 ? '◀ left ' : 'right ▶ ') + Math.round(Math.abs(v) * 100) + '%'],
    ['pedal', v => v > 0 ? 'gas ' + Math.round(v * 100) + '%' : v < 0 ? 'brake ' + Math.round(-v * 100) + '%' : 'off'], ['handbrake', v => v > 0 ? 'ON' : 'off']];
  for (let k = 0; k < O; k++) {
    const v = x ? aiY[k] : 0, keyed = k < 2 && (k ? AI.kp : AI.ks);   // like the keyboard: what it applies, not what it computed
    node(xo, yo(k), v);
    g.textAlign = 'left'; g.fillStyle = '#fff'; g.font = big; g.fillText(out[k][0] + (keyed ? ' ⌨' : ''), xo + 20, yo(k) - 12);
    if (x) { g.font = small; g.fillStyle = 'rgba(255,255,255,.75)'; g.fillText(out[k][1](keyed ? AI.applied[k] : v), xo + 20, yo(k) + 12); }
  }
  if (!x) { g.textAlign = 'center'; g.font = small; g.fillStyle = 'rgba(255,255,255,.6)'; g.fillText('its weights: Train or Drive it to see it think', W / 2, Hc - 8); }
}

// before the world changes under it (called from regenerateWorld, also at boot, before AI exists)
function aiHalt(drive) { try { if (AI.training) aiTrain(false); if (drive && AI.drive) { AI.drive = false; aiShow(); } } catch (e) { } }
// in a race room: not on the grid or in a race (before our finish); there the others see none of it (mpFrame, mpSendHit)
const aiAllowed = () => !MP.on || !(MP.hold || ((MP.phase === 'countdown' || MP.phase === 'racing') && !MP.finished && !MP.spectator));
// for tests (the headless browser draws a frame a second): whole generations, now
function aiTrainSync(gens = 1, cfg) {
  if (cfg) {
    if (cfg.h != null && cfg.h !== AI.h) { AI.h = cfg.h; AI.key = ''; }
    if (cfg.inputs || cfg.hb != null || cfg.kp != null || cfg.ks != null) { aiSetInputs(cfg.inputs || AI.inputs, cfg.hb ?? AI.hb, true, cfg.kp ?? AI.kp, cfg.ks ?? AI.ks); AI.key = ''; }
    Object.assign(AI_CFG, cfg);
  }
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
  #aiPanel canvas{display:block;width:270px;height:54px;margin:4px 0} #aiPanel #aiNet{height:165px}
  #aiPanel button{font:inherit;font-size:12px;font-weight:700;border:0;border-radius:6px;padding:6px 10px;margin:4px 4px 0 0;cursor:pointer;color:#fff;background:#ffffff26}
  #aiPanel button:hover{background:#ffffff40} #aiPanel button.on{background:#ff5a00}
  #aiPanel details{margin-top:8px} #aiPanel summary{cursor:pointer;font-weight:700;font-size:12px}
  #aiPanel label{display:flex;align-items:center;gap:6px;font-size:12px;margin:3px 0;cursor:pointer}
  #aiPanel .pen{margin-top:6px;font-size:12px} #aiPanel .pen label{justify-content:space-between}
  #aiPanel input[type=number]{width:58px;font:inherit;font-size:12px;background:#ffffff1f;color:#fff;border:1px solid #ffffff40;border-radius:4px;padding:1px 4px}
  #aiPanel #aiServer{margin-top:6px;max-height:220px;overflow:auto;border-top:1px solid #ffffff30}
  #aiPanel .srv{display:flex;align-items:center;gap:4px;padding:4px 0;border-bottom:1px solid #ffffff1a} #aiPanel .srv .si{flex:1;min-width:0;font-size:12px}
  #aiPanel .srv b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap} #aiPanel .srv .sub{margin:0}
  #aiPanel .srv button{margin:0;padding:4px 8px}
  #aiPanel small{display:block;opacity:.7;margin-top:6px;font-size:11px;line-height:1.35}
</style>`);
AI.el = document.createElement('div'); AI.el.id = 'aiPanel'; AI.el.className = 'panel';
AI.el.innerHTML = `<div class="lt">AUTOPILOT</div><div class="sub" id="aiSize"></div>
  <div class="st" id="aiStat"></div><div class="sub" id="aiRate"></div>
  <canvas id="aiNet" width="540" height="330" title="Each line: an input's pull on an output right now (its value × its weight). Orange pushes + (steer left, throttle), blue − (steer right, brake); thicker, stronger."></canvas>
  <canvas id="aiChart" width="540" height="108"></canvas>
  <button id="aiTrain">Train</button><button id="aiDrive">Drive it</button><button id="aiWatch" title="Run the training at real speed, with the sound, to watch every try (it learns no differently, only slower)">Watch at 1×</button><button id="aiReset">Start over</button><button id="aiH" title="The network's size: inputs straight to the outputs, or a hidden layer of 8 between">Size</button>
  <button id="aiSaveF" title="Download this training (the weights, the generations, the chart) as a file">Save to file</button><button id="aiLoadF" title="Load a training saved to a file">Load file</button>
  <button id="aiSaveS" title="Save this training on the server, under a name: you, or anyone, can load it there">Save to server</button><button id="aiLoadS" title="The autopilots saved on the server: load one (yours or anyone's), delete yours">From server</button>
  <div id="aiServer" style="display:none"></div>
  <input type="file" id="aiFile" accept=".json,application/json" style="display:none">
  <details id="aiCfg"><summary>Inputs, outputs and penalties</summary>
    <div id="aiIns"></div>
    <label title="A third output: on above 0 (it starts off, and learns when, if ever)"><input type="checkbox" id="aiHb"> handbrake (a 3rd output)</label>
    <label title="The pedal output snapped to what W and S give: full throttle above +⅓, nothing between, full brake below −⅓"><input type="checkbox" id="aiKp"> pedals like the keyboard: full gas, off or full brake</label>
    <label title="The steering output snapped to what A and D give: full left above +⅓, straight between, full right below −⅓"><input type="checkbox" id="aiKs"> steering like the keyboard: full left, straight or full right</label>
    <div class="pen">Rewards and penalties (metres on or off the score):
      <label title="Added for each km/h of its average speed along the line (speed already pays: more metres in a try's 15 s, and 5 m a second saved on an exam lap)">+ speed, a km/h on average <input type="number" id="aiPen_speed" min="0" max="50" step="0.5"></label>
      <label title="Off for each metre driven beyond its progress along the racing line: running wide and weaving cost, a tight line doesn't">− extra path, a metre <input type="number" id="aiPen_path" min="0" max="20" step="0.1"></label>
      <label title="Off for each full swing of the steering or pedal output (their changes added up: lock to lock is 2): jerky driving costs">− jerky, a full swing <input type="number" id="aiPen_smooth" min="0" max="100" step="0.5"></label>
      <label>− off the road, a metre <input type="number" id="aiPen_offRoad" min="0" max="20" step="0.5"></label>
      <label>− damage, a wreck's worth <input type="number" id="aiPen_damage" min="0" max="1000" step="10"></label>
      <label>− wrecked <input type="number" id="aiPen_wreck" min="0" max="1000" step="10"></label></div>
    <label style="justify-content:space-between;margin-top:6px" title="A try ends (and loses the 100 m for ending badly) this far from the racing line. Wider gives it room for its own line, and to go astray">end a try this far from the line, m <input type="number" id="aiOff" min="3" max="30" step="1"></label>
    <label style="justify-content:space-between" title="Each Train (or Train more) runs this many generations, then stops (0: until you pause it)">train this many generations at a time <input type="number" id="aiGens" min="0" max="10000" step="10"></label>
    <label style="justify-content:space-between" title="Once it laps: stop training when that many generations in a row bring no better lap (0: never stop)">stop after generations without a better lap <input type="number" id="aiStopAfter" min="0" max="1000" step="5"></label>
    <small>Each set of inputs and outputs is a network, and a training, of its own (the others are kept). Penalties apply from the next try.</small>
  </details>
  <small>Watch at 1× runs the training at real speed (with sound) to follow each try. The diagram: what it sees (left) and does (right), live while it trains or drives; each line is an input's pull on
  an output, orange + (left, throttle), blue − (right, brake), thicker stronger. On the track, the 3 points it looks at.
  Learns on this course with this car, ${AI_CFG.pop} tries a generation, and remembers it in this browser. Chart: how far
  each generation gets from the start (orange) and its tries' average (white), dashed a lap; once it laps, each generation's
  lap time (faster higher), dashed the best. <b>I</b> hides this.</small>`;
document.body.appendChild(AI.el);
AI.el.querySelector('#aiTrain').addEventListener('click', e => { e.currentTarget.blur(); aiTrain(!AI.training); });
AI.el.querySelector('#aiDrive').addEventListener('click', e => { e.currentTarget.blur(); aiDrive(!AI.drive); });
// inputs, outputs and penalties (typing in the panel isn't driving: its keys stop here)
AI.el.addEventListener('keydown', e => { if (e.target.matches('input')) e.stopPropagation(); });
AI.el.querySelector('#aiIns').innerHTML = AI_INPUTS.map(d => `<label title="${d.tip}"><input type="checkbox" data-in="${d.id}"> ${d.names.length > 2 ? `${d.id === 'rays' ? 'edge rays' : d.id} (${d.names.length})` : d.names.join(', ')}</label>`).join('');
AI.el.querySelector('#aiCfg').addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.in || t.id === 'aiHb' || t.id === 'aiKp' || t.id === 'aiKs') {
    const ins = [...AI.el.querySelectorAll('[data-in]')].filter(c => c.checked).map(c => c.dataset.in);
    if (!ins.length) { t.checked = true; return; }
    aiSetInputs(ins, AI.el.querySelector('#aiHb').checked, false, AI.el.querySelector('#aiKp').checked, AI.el.querySelector('#aiKs').checked);
  } else if (t.id === 'aiOff') {
    const v = +t.value; if (Number.isFinite(v) && v >= 3 && v <= 30) { AI_CFG.off = v; aiKeepConfig(); }
  } else if (t.id === 'aiGens') {
    const v = Math.round(+t.value); if (Number.isFinite(v) && v >= 0) { AI.gens = v; aiKeepConfig(); if (AI.training) AI.genEnd = AI.gen + v; }
  } else if (t.id === 'aiStopAfter') {
    const v = Math.round(+t.value); if (Number.isFinite(v) && v >= 0) { AI.stopAfter = v; aiKeepConfig(); }
  } else if (t.id.startsWith('aiPen_')) {
    const v = +t.value; if (Number.isFinite(v) && v >= 0) { AI_PEN[t.id.slice(6)] = v; aiKeepConfig(); }
  }
});
AI.el.querySelector('#aiWatch').addEventListener('click', e => {
  e.currentTarget.blur();
  AI.watch = !AI.watch; AI.wacc = 0;
  if (!AI.watch && AI.mute) { AI.mute.node.port.postMessage({ on: 0 }); audio = null; }   // full speed: silent again
  if (AI.watch && !AI.training) aiTrain(true);
  aiShow();
});
AI.el.querySelector('#aiH').addEventListener('click', e => {
  e.currentTarget.blur();
  const was = AI.training; if (was) aiTrain(false);
  AI.drive = false; AI.h = AI_SIZES[(AI_SIZES.indexOf(AI.h) + 1) % AI_SIZES.length]; aiLoad(); aiShow();
});
// a training as a file or on the server: to keep, share, or carry to another browser (the browser keeps it anyway, per course, car and size)
function aiExport() {
  if (aiKey() !== AI.key) aiLoad();
  return { kind: 'carsim-autopilot', version: 2, vehicle: VEH.key, vehicleName: VEH.name, course: courseKey(), ground: groundName(), h: AI.h, inputs: AI.inputs, handbrake: AI.hb, keyPedals: AI.kp, keySteering: AI.ks, weights: AI.np,
    w: [...AI.w], best: AI.best && [...AI.best], gen: AI.gen, bestFit: AI.bestFit, bestLap: AI.bestLap, hist: AI.hist, adam: { m: [...AI.m], v: [...AI.v], k: AI.k }, savedAt: new Date().toISOString() };
}
// a training (a file's, the server's) in place of this course and car's with its inputs; false if it isn't one
function aiImport(d, what = 'Training') {
  const arr = (a, n) => Array.isArray(a) && a.length === n && a.every(Number.isFinite);
  const ins = Array.isArray(d?.inputs) && d.inputs.every(id => AI_INPUTS.some(q => q.id === id)) ? d.inputs : AI_DEFAULT_INPUTS, np = d && aiShape(ins, !!d.handbrake, d.h).np;
  if (!d || d.kind !== 'carsim-autopilot' || !AI_SIZES.includes(d.h) || !arr(d.w, np) || (d.best != null && !arr(d.best, np))) { flash('Not an autopilot training', '#ff8a7a', 2.5); return false; }
  const other = [d.vehicle !== VEH.key && `the ${d.vehicleName || d.vehicle}`, d.course !== courseKey() && 'another course or ground'].filter(Boolean);
  if (other.length && !confirm(`This training was made with ${other.join(' and ')}. Load it for the ${VEH.name} here anyway? (It may drive worse, and Train more carries on from it.)`)) return false;
  if (AI.training) aiTrain(false);
  AI.drive = false; AI.h = d.h; aiSetInputs(ins, !!d.handbrake, true, !!d.keyPedals, !!d.keySteering); aiLoad();   // this course, car, size and inputs: replaced by it
  const n = AI.np, ad = d.adam && arr(d.adam.m, n) && arr(d.adam.v, n) ? d.adam : null;
  // made elsewhere: its record doesn't count here (Drive it uses its weights; the next exam sets the score)
  Object.assign(AI, { w: Float32Array.from(d.w), best: Float32Array.from(d.best || d.w), gen: d.gen | 0, bestFit: other.length ? 0 : Number.isFinite(d.bestFit) ? d.bestFit : 0,
    bestLap: other.length ? null : d.bestLap ?? null, hist: other.length ? [] : Array.isArray(d.hist) ? d.hist : [], sinceBest: 0,
    m: ad ? Float32Array.from(ad.m) : new Float32Array(n), v: ad ? Float32Array.from(ad.v) : new Float32Array(n), k: ad ? ad.k | 0 : 0 });
  aiSave(); aiShow();
  flash(`${what} loaded: ${AI.np} weights, generation ${AI.gen}`, '#9fd4ff', 2);
  return true;
}
AI.el.querySelector('#aiSaveF').addEventListener('click', e => {
  e.currentTarget.blur();
  const d = aiExport(), a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(d)], { type: 'application/json' }));
  a.download = `autopilot-${VEH.key}-${AI.np}w-gen${AI.gen}.json`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  flash(`Training saved: ${a.download}`, '#9fd4ff', 2);
});
AI.el.querySelector('#aiLoadF').addEventListener('click', e => { e.currentTarget.blur(); AI.el.querySelector('#aiFile').click(); });
AI.el.querySelector('#aiFile').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  let d; try { d = JSON.parse(await f.text()); } catch (err) { d = null; }
  aiImport(d);
});
// on the server (the app's /api/autopilots, lib/autopilots/store.mjs): everyone's, to load; ours, to delete. Signed in to the app.
const AI_API = location.pathname.replace(/\/sim\/[^/]*$/, '') + '/api/autopilots';
async function aiApi(path, init) {
  const r = await fetch(AI_API + path, { credentials: 'same-origin', ...init, headers: init?.body ? { 'content-type': 'application/json' } : undefined });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(r.status === 401 ? 'Sign in to the app (its lobby) to use the server' : b.error || `${r.status} ${r.statusText}`);
  return b;
}
AI.el.querySelector('#aiSaveS').addEventListener('click', async e => {
  e.currentTarget.blur();
  const d = aiExport();
  const name = prompt('Save this autopilot on the server as:', `${VEH.short} · ${AI.np} weights · gen ${AI.gen}${AI.bestLap != null ? ' · lap ' + fmt(AI.bestLap) : ''}`);
  if (!name || !name.trim()) return;
  try { await aiApi('', { method: 'POST', body: JSON.stringify({ name, training: d }) }); flash(`Saved on the server: ${name.trim()}`, '#9fd4ff', 2); if (AI.listOpen) aiServerList(); }
  catch (err) { flash(err.message, '#ff8a7a', 3); }
});
AI.el.querySelector('#aiLoadS').addEventListener('click', e => {
  e.currentTarget.blur();
  AI.listOpen = !AI.listOpen;
  AI.el.querySelector('#aiServer').style.display = AI.listOpen ? 'block' : 'none';
  if (AI.listOpen) aiServerList();
});
// the list: this car and course's first, then the newest; names as text (they are other people's)
async function aiServerList() {
  const box = AI.el.querySelector('#aiServer'), el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  box.replaceChildren(el('div', 'sub', 'Loading…'));
  let list;
  try { list = (await aiApi('')).autopilots; } catch (err) { box.replaceChildren(el('div', 'sub', err.message)); return; }
  const here = a => a.vehicle === VEH.key && a.course === courseKey();
  list.sort((a, b) => here(b) - here(a) || b.savedAt - a.savedAt);
  if (!list.length) { box.replaceChildren(el('div', 'sub', 'Nothing saved on the server yet.')); return; }
  box.replaceChildren(...list.slice(0, 40).map(a => {
    const row = el('div', 'srv'), info = el('div', 'si');
    info.append(el('b', null, a.name), el('div', 'sub', `${a.mine ? 'yours' : 'by ' + a.ownerName} · ${a.vehicleName || a.vehicle} · ${a.ground}${here(a) ? ' · this car and course' : ''} · ${a.bestLap != null ? 'lap ' + fmt(a.bestLap) : 'no lap yet'} · gen ${a.gen} · ${a.weights} weights`));
    const load = el('button', null, 'Load');
    load.addEventListener('click', async ev => {
      ev.currentTarget.blur();
      try { aiImport((await aiApi('/' + a.id)).autopilot, `“${a.name}”`); } catch (err) { flash(err.message, '#ff8a7a', 3); }
    });
    row.append(info, load);
    if (a.mine) {
      const del = el('button', null, '✕'); del.title = 'Delete it from the server';
      del.addEventListener('click', async ev => {
        ev.currentTarget.blur();
        if (!confirm(`Delete “${a.name}” from the server?`)) return;
        try { await aiApi('/' + a.id, { method: 'DELETE' }); aiServerList(); } catch (err) { flash(err.message, '#ff8a7a', 3); }
      });
      row.append(del);
    }
    return row;
  }));
}
AI.el.querySelector('#aiReset').addEventListener('click', e => {
  e.currentTarget.blur();
  if (!confirm(`Forget what the autopilot learnt with the ${VEH.name} on this course?`)) return;
  const was = AI.training; if (was) aiTrain(false);
  AI.drive = false; try { localStorage.removeItem(aiKey()); } catch (err) { } aiLoad(); if (was) aiTrain(true); aiShow();
});
// the button, in the column on the right; in a race room left of Replay (that column is the room's), gone in a race
document.head.insertAdjacentHTML('beforeend', `<style>
  #aiBtn{position:fixed;top:452px;right:12px;font:inherit;font-size:13px;font-weight:700;border:0;border-radius:8px;padding:8px 12px;cursor:pointer;color:#fff;background:rgba(20,14,6,.65)}
  #aiBtn:hover,#aiBtn.on{background:rgba(255,90,0,.85)}
  body.mp-race #aiBtn{display:none!important}
</style>`);
AI.btn = document.createElement('button'); AI.btn.id = 'aiBtn'; AI.btn.textContent = '🧠 Autopilot';
AI.btn.title = 'A tiny neural network learns to drive a lap of this course, with this car (I)';
document.body.appendChild(AI.btn);
AI.btn.addEventListener('click', e => { e.currentTarget.blur(); aiToggle(); });
setInterval(() => {
  if (!MP.on) return;
  const r = document.getElementById('replayBtn').getBoundingClientRect();
  if (r.width) { AI.btn.style.top = r.top + 'px'; AI.btn.style.right = (innerWidth - r.left + 8) + 'px'; }
}, 250);
function aiToggle() {
  AI.open = !AI.open;
  if (AI.open && aiKey() !== AI.key && !AI.training) aiLoad();
  AI.el.style.display = AI.open ? 'block' : 'none'; AI.btn.classList.toggle('on', AI.open);
  aiShow();
}
function aiShow() {
  if (!AI.open) return;
  const y0 = document.getElementById('hud').getBoundingClientRect().bottom + 10, help = document.getElementById('help');   // under the car's read-out, over the help
  AI.el.style.top = y0 + 'px'; AI.el.style.maxHeight = ((help.offsetHeight ? help.getBoundingClientRect().top - 10 : innerHeight - 12) - y0) + 'px';
  const len = botPath().len, pct = f => Math.min(100, Math.round(f / len * 100));
  const best = AI.bestFit < 0 ? 'nothing yet' : AI.bestLap != null ? `a full lap in ${fmt(AI.bestLap)}${AI.sinceBest ? ` <span style="opacity:.7">(${AI.sinceBest} generation${AI.sinceBest > 1 ? 's' : ''} ago${AI.stopAfter ? `; stops at ${AI.stopAfter}` : ''})</span>` : ''}` : `${Math.round(AI.bestFit)} m of ${Math.round(len)} m (${pct(AI.bestFit)} %)`;
  AI.el.querySelector('#aiSize').textContent = `${AI.h ? 'a tiny neural network' : 'the smallest network'}: ${AI.nIn} inputs ${AI.h ? `→ ${AI.h} hidden →` : 'straight to'} ${AI.nOut} outputs, ${AI.np} weights${AI.kp || AI.ks ? ` · ${[AI.kp && 'pedals', AI.ks && 'steering'].filter(Boolean).join(' and ')} like the keyboard` : ''}`;
  AI.el.querySelector('#aiH').textContent = AI.h ? 'Smaller net' : 'Bigger net';
  AI.el.querySelectorAll('[data-in]').forEach(c => { c.checked = AI.inputs.includes(c.dataset.in); });
  AI.el.querySelector('#aiHb').checked = AI.hb; AI.el.querySelector('#aiKp').checked = AI.kp; AI.el.querySelector('#aiKs').checked = AI.ks;
  for (const k in AI_PEN) { const f = AI.el.querySelector('#aiPen_' + k); if (document.activeElement !== f) f.value = AI_PEN[k]; }
  { const f = AI.el.querySelector('#aiStopAfter'); if (document.activeElement !== f) f.value = AI.stopAfter; }
  { const f = AI.el.querySelector('#aiGens'); if (document.activeElement !== f) f.value = AI.gens; }
  { const f = AI.el.querySelector('#aiOff'); if (document.activeElement !== f) f.value = AI_CFG.off; }
  const L = AI.lastExam;
  AI.el.querySelector('#aiStat').innerHTML = `Generation ${AI.gen}${AI.training && AI.gens ? ` of ${AI.genEnd}` : ''}${AI.training ? ` · ${AI.exam ? 'exam: a lap from the start' : `try ${AI.ci + 1}/${AI_CFG.pop}${AI.cands && AI.from != null ? ` from ${Math.round(AI.from)} m` : ''}`}` : ''}<br>Best: ${best}${L ? `<br><span style="opacity:.75;font-size:12px">Last exam: ${L.why === 'lap' ? 'a lap' : L.at + ' m'}${L.offM ? ` · ${L.offM} m off the road` : ''}${L.dmg ? ` · damage ${L.dmg} %` : ''}${L.wrecked ? ' · wrecked' : ''}${L.kmh ? ` · ${L.kmh} km/h` : ''}${L.swing ? ` · ${L.swing} swings` : ''}${L.extra ? ` · ${L.extra} m extra path` : ''}${L.pen ? ` · ${L.pen > 0 ? '−' + L.pen : '+' + -L.pen}` : ''}</span>` : ''}`;
  AI.el.querySelector('#aiTrain').textContent = AI.training ? 'Pause' : AI.gen ? 'Train more' : 'Train';
  AI.el.querySelector('#aiTrain').classList.toggle('on', AI.training);
  AI.el.querySelector('#aiDrive').textContent = AI.drive ? 'Stop driving' : 'Drive it';
  AI.el.querySelector('#aiWatch').textContent = AI.watch ? 'Full speed' : 'Watch at 1×';
  AI.el.querySelector('#aiWatch').classList.toggle('on', !!AI.watch);
  AI.el.querySelector('#aiDrive').classList.toggle('on', AI.drive);
  AI.el.querySelector('#aiDrive').disabled = AI.bestFit < 0;
  AI.el.querySelector('#aiSaveF').disabled = AI.el.querySelector('#aiSaveS').disabled = !AI.gen;
  const cv = AI.el.querySelector('#aiChart'), g = cv.getContext('2d'), W = cv.width, Hc = cv.height, Hs = AI.hist.slice(-120), top = len * 1.1;
  g.clearRect(0, 0, W, Hc);
  const laps = Hs.map(h => h[2] ?? null), lt = laps.filter(t => t != null);
  if (AI.bestLap != null && lt.length) {                               // it laps: each generation's lap time, faster higher; dashed, the best
    let lo = Math.min(...lt, AI.bestLap), hi = Math.max(...lt); if (hi - lo < 2) hi = lo + 2;
    const y = t => 10 + (t - lo) / (hi - lo) * (Hc - 20), xs = i => Hs.length > 1 ? i / (Hs.length - 1) * W : W / 2;
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.setLineDash([6, 6]); g.beginPath(); g.moveTo(0, y(AI.bestLap)); g.lineTo(W, y(AI.bestLap)); g.stroke(); g.setLineDash([]);
    g.strokeStyle = '#ff7a1a'; g.fillStyle = '#ff7a1a'; g.lineWidth = 3; g.beginPath(); let on = false;
    laps.forEach((t, i) => { if (t == null) { on = false; return; } on ? g.lineTo(xs(i), y(t)) : g.moveTo(xs(i), y(t)); on = true; });
    g.stroke();
    laps.forEach((t, i) => { if (t != null) { g.beginPath(); g.arc(xs(i), y(t), 3.5, 0, 7); g.fill(); } });
    g.font = '600 20px system-ui, sans-serif'; g.textBaseline = 'top'; g.textAlign = 'left'; g.fillStyle = 'rgba(255,255,255,.8)';
    g.fillText(`lap times · best ${fmt(AI.bestLap)}`, 6, Hc - 26 > y(AI.bestLap) + 6 ? y(AI.bestLap) + 6 : 4);
    return;
  }
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
rep("""  const o = window.__sim?.override;""", """  const o = aiInput(dt) || window.__sim?.override;""")
# the frame: training instead of the player's driving
rep("""  else if (!window.__sim.paused) simulate(dt);""", """  else if (AI.training) aiTrainFrame(dt);
  else if (!window.__sim.paused) simulate(dt);""")
rep("""  if (e.code === 'KeyY') { rp.on ? stopReplay() : startReplay(); return; }""",
    """  if (e.code === 'KeyI') { aiToggle(); return; }
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
# in a race room: a race stops it; while it trains, the others see none of it (no position, dents, repairs); its laps aren't ours
rep("""function mpGrid(slot) {
  if (rp.on) stopReplay();""", """function mpGrid(slot) {
  aiHalt(true);
  if (rp.on) stopReplay();""")
rep("""  if ((MP.sendT += dt) >= 0.05 && !rp.on && !ed.on) {""", """  if ((MP.sendT += dt) >= 0.05 && !rp.on && !ed.on && !AI.training) {""")
rep("""function mpSendHit(h) {
""", """function mpSendHit(h) {
  if (AI.training) return;
""")
rep("""carRepairHook = () => mpPost({ t: 'repair' });""", """carRepairHook = () => { if (!AI.training) mpPost({ t: 'repair' }); };""")
rep("""  if (!MP.on || MP.spectator || lap.lapNo < 1) return;""", """  if (!MP.on || MP.spectator || lap.lapNo < 1 || AI.drive) return;   // the autopilot's laps aren't ours""")
rep("""<b>Y</b> replay (not in a race) &nbsp; <b>M</b> mute""", """<b>Y</b> replay (not in a race) &nbsp; <b>I</b> autopilot (not in a race) &nbsp; <b>M</b> mute""")
rep("""  updateLapHud(dt);
  renderer.render(scene, camera);""", """  updateLapHud(dt);
  aiViz(dt);
  renderer.render(scene, camera);""")
rep("""  if (BOTS.n) setBots(BOTS.n);""", """  Object.assign(window.__sim, { ai: AI, aiTrainSync, aiTry, aiDrive });
  if (BOTS.n) setBots(BOTS.n);""")
open(ep, 'w').write(s)

h = open(hp).read()
a = """<b>Y</b> replay &nbsp;"""
assert h.count(a) == 1
h = h.replace(a, """<b>Y</b> replay &nbsp; <b>I</b> autopilot (a tiny neural network learns to drive) &nbsp;""")
open(hp, 'w').write(h)
print('autopilot patched')
