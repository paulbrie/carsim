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
const AI_CFG = { pop: 16, sigma: 0.3, lr: 0.2, bearing: 2, off: 8, window: 15, crash: 100, pace: 1, gCorner: 0.84, gBrake: 0.76, gAccel: 0, racingLine: false, lineW: 0, lookTime: false, rolling: false, flying: false, examLaps: 1, rival: 'off', rivalShare: 0.5, rivalEvery: 10, rivalCar: '' };
// the rival (#311): another of this car on the course, near enough to matter within AI_RV_NEAR m along the line
const AI_RV_NEAR = 30, AI_RV_MODES = ['off', 'replay', 'car'];
const AI_LOOK_T = [0.3, 0.7, 1.4];                                     // the look-ahead in seconds, if by time (at least AI_LOOK_MIN m)
const AI_LOOK_MIN = [3, 6, 12];
const AI_AHEAD_T = 0.5, AI_AHEAD_MIN = 5;                                // the pace note ahead: so far ahead
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
  { id: 'ahead', names: ['pace note ahead'], tip: `the pace note's speed ${AI_AHEAD_T} s ahead (at its speed, at least ${AI_AHEAD_MIN} m) less its own: what's coming, to brake for it in time`, show: v => (v > 0 ? '+' : '') + Math.round(v * 36) + ' km/h' },
  { id: 'edges', names: ['left edge', 'right edge'], tip: "how far the course's edges are, left and right (the tarmac's on road, the gate posts' off it)", show: v => (v * 10).toFixed(1) + ' m' },
  { id: 'rays', names: AI_RAYS.map(a => a ? `ray ${Math.abs(a)}° ${a > 0 ? 'L' : 'R'}` : 'ray ahead'), tip: `5 feelers, 60° and 30° to either side and straight ahead: how far each goes before it leaves the course (up to ${AI_RAY_MAX} m)`, show: v => Math.round(v * AI_RAY_MAX) + ' m' },
  { id: 'slide', names: ['sideways'], tip: 'how fast it slides sideways (+ to the left)', show: v => (v * 10).toFixed(1) + ' m/s' },
  { id: 'wslip', names: ['front slip', 'rear slip'], tip: "the wheels' slip, the front pair's and the rear pair's (on the ground): + spinning faster than the car goes (too much gas), − turning slower, locking (braking, the handbrake)", show: v => (v > 0 ? '+' : '') + Math.round(v * 100) + ' %' },
  { id: 'sink', names: ['sinkage'], tip: 'how deep its wheels sink into the ground (the deepest one): digging itself in, on sand', show: v => Math.round(v * 20) + ' cm' },
  { id: 'g', names: ['g forward', 'g sideways'], tip: 'its acceleration in g, forward (+ speeding up, − braking) and sideways (+ turning left: pulled to the left, so you would feel pushed right), smoothed over 0.1 s', show: v => v.toFixed(2) + ' g' },
  { id: 'rival', names: ['rival ahead', 'rival behind', 'rival side', 'rival closing'], tip: `the rival car, when within ${AI_RV_NEAR} m along the line: how near it is ahead and behind (1: touching; alongside, half each), how far to the left (+) or right of us, and how much faster we go than it (all 0 when it is further, or there is none). Train with a rival (below) for it to learn what to do with them`,
    show: [v => v > 0 ? Math.round(v * 100) + ' %' : '—', v => v > 0 ? Math.round(v * 100) + ' %' : '—', v => (v * 5).toFixed(1) + ' m', v => (v > 0 ? '+' : '') + Math.round(v * 36) + ' km/h'] },
  { id: 'tilt', names: ['roll', 'pitch'], tip: 'how far it leans to the side (+ left side up) and noses up or down (+ up): about to roll over?', show: v => Math.round(v * 30) + '°' },
];
const AI_DEFAULT_INPUTS = ['speed', 'line6', 'line15', 'line30', 'offset', 'yaw', 'pace'];
// rewards and penalties, in metres on or off a drive's score: per metre driven off the road (the course: the tarmac on road,
// between the gate posts off it), for damage (a wreck's worth: the car's condition from 100 % to 0), for wrecking it; per
// full swing of the steering or pedal output (jerky driving: their changes, added up; lock to lock is 2); and a reward
// per km/h of its average speed along the line; per metre of extra path (driven beyond its progress along the line: running
// wide, weaving)
const AI_PEN = { offRoad: 1, damage: 150, wreck: 100, smooth: 0, speed: 0, path: 0, contact: 20, gain: 0 };
// (with a rival: per m/s of each impact with it, the car behind taking 3/4 of the blame, alongside half; and a reward per
// metre gained on it over the drive)
// the weights' count for these inputs and outputs, with h hidden units (0: none)
const aiShape = (inputs, hb, h) => {
  const nIn = AI_INPUTS.filter(d => inputs.includes(d.id)).reduce((a, d) => a + d.names.length, 0), nOut = hb ? 3 : 2;
  return { nIn, nOut, np: h ? nIn * h + h + h * nOut + nOut : nIn * nOut + nOut };
};
const AI = { gens: 0, genEnd: 0, stopAfter: 30, sinceBest: 0, h: 0, np: 0, inputs: AI_DEFAULT_INPUTS, hb: false, kp: false, ks: false, nb: false, applied: [0, 0], nIn: 7, nOut: 2, names: [], shows: [], look: [], rayEnds: [], viewW: null, nAct: 0, nSim: 0, rateT: 0, rate: '', open: false, training: false, drive: false, key: '', w: null, m: null, v: null, k: 0, gen: 0, best: null, bestFit: -1, bestLap: null,
  hist: [], cands: null, eps: null, fits: null, ci: 0, ep: null, ctl: null, snapH: null, snapC: null, acc: 0, dst: null, el: null };
const aiX = new Float32Array(32), aiY = new Float32Array(3), aiHid = new Float32Array(8);
// what the network takes in and gives out (kept in this browser; each set is a training of its own)
function aiConfig(inputs, hb) {
  inputs = AI_INPUTS.map(d => d.id).filter(id => inputs.includes(id));
  if (!inputs.length) inputs = AI_DEFAULT_INPUTS;
  Object.assign(AI, { inputs, hb: !!hb }, aiShape(inputs, hb, AI.h));
  AI.names = []; AI.shows = []; AI.groups = [];
  for (const d of AI_INPUTS) if (inputs.includes(d.id)) d.names.forEach((nm, k) => { AI.names.push(nm); AI.shows.push(Array.isArray(d.show) ? d.show[k] : d.show); AI.groups.push(d); });
}
try {
  const c = JSON.parse(localStorage.getItem('sandbuggy.ai.config') || 'null');
  aiConfig(c?.inputs || AI_DEFAULT_INPUTS, c?.hb); AI.kp = !!c?.kp; AI.ks = !!c?.ks; AI.nb = !!c?.nb;
  if (Number.isInteger(c?.stopAfter) && c.stopAfter >= 0) AI.stopAfter = c.stopAfter;
  if (Number.isInteger(c?.gens) && c.gens >= 0) AI.gens = c.gens;
  if (Number.isFinite(c?.off) && c.off >= 3 && c.off <= 30) AI_CFG.off = c.off;
  if (Number.isFinite(c?.pace) && c.pace >= 0.5 && c.pace <= 2) AI_CFG.pace = c.pace;
  if (Number.isFinite(c?.gCorner) && c.gCorner >= 0.2 && c.gCorner <= 2) AI_CFG.gCorner = c.gCorner;
  if (Number.isFinite(c?.gBrake) && c.gBrake >= 0.2 && c.gBrake <= 2) AI_CFG.gBrake = c.gBrake;
  if (Number.isFinite(c?.gAccel) && c.gAccel >= 0 && c.gAccel <= 2) AI_CFG.gAccel = c.gAccel;
  AI_CFG.racingLine = !!c?.racingLine;
  if (Number.isFinite(c?.lineW) && c.lineW >= 0 && c.lineW <= 15) AI_CFG.lineW = c.lineW;
  AI_CFG.lookTime = !!c?.lookTime; AI_CFG.rolling = !!c?.rolling; AI_CFG.flying = !!c?.flying;
  if (Number.isInteger(c?.examLaps) && c.examLaps >= 1 && c.examLaps <= 5) AI_CFG.examLaps = c.examLaps;
  if (AI_RV_MODES.includes(c?.rival)) AI_CFG.rival = c.rival;
  if (Number.isFinite(c?.rivalShare) && c.rivalShare >= 0 && c.rivalShare <= 1) AI_CFG.rivalShare = c.rivalShare;
  if (typeof c?.rivalCar === 'string' && (!c.rivalCar || ROAD_CARS[c.rivalCar])) AI_CFG.rivalCar = c.rivalCar;
  for (const k in AI_PEN) if (Number.isFinite(c?.pen?.[k]) && c.pen[k] >= 0) AI_PEN[k] = c.pen[k];
} catch (e) { aiConfig(AI_DEFAULT_INPUTS, false); }
const aiKeepConfig = () => { try { localStorage.setItem('sandbuggy.ai.config', JSON.stringify({ rival: AI_CFG.rival, rivalShare: AI_CFG.rivalShare, rivalCar: AI_CFG.rivalCar, examLaps: AI_CFG.examLaps, flying: AI_CFG.flying, rolling: AI_CFG.rolling, lookTime: AI_CFG.lookTime, lineW: AI_CFG.lineW, racingLine: AI_CFG.racingLine, gAccel: AI_CFG.gAccel, gCorner: AI_CFG.gCorner, gBrake: AI_CFG.gBrake, pace: AI_CFG.pace, off: AI_CFG.off, gens: AI.gens, stopAfter: AI.stopAfter, inputs: AI.inputs, hb: AI.hb, kp: AI.kp, ks: AI.ks, nb: AI.nb, pen: AI_PEN })); } catch (e) { } };
// another set of inputs or outputs (or pedals / steering like the keyboard's, or no brake): another training (this one stays, under its own key);
// one not trained yet starts from this one's weights, the new inputs' (and outputs') at nothing: it drives as this one did
function aiSetInputs(inputs, hb, quiet, kp = AI.kp, ks = AI.ks, nb = AI.nb) {
  if (AI.training) aiTrain(false);
  AI.drive = false;
  const was = AI.w && (AI.gen || AI.best) ? { names: AI.names.slice(), nIn: AI.nIn, nOut: AI.nOut, h: AI.h, w: AI.best || AI.w } : null;
  aiConfig(inputs, hb); AI.kp = !!kp; AI.ks = !!ks; AI.nb = !!nb; aiKeepConfig();
  if (quiet) return;
  aiLoad();
  if (was && !AI.gen && !AI.best && was.h === AI.h) { aiCarry(was); flash('Carried over: the new inputs start at nothing', '#9fd4ff', 2); }
  aiShow();
}
function aiCarry(o) {
  const I = AI.nIn, O = AI.nOut, h = AI.h, n = AI.np, w = new Float32Array(n), on = o.w.length, oo = Math.min(O, o.nOut);
  const from = AI.names.map(nm => o.names.indexOf(nm));                 // each input's place in the old network, or -1
  for (let r = 0; r < (h || oo); r++) for (let i = 0; i < I; i++) if (from[i] >= 0) w[r * I + i] = o.w[r * o.nIn + from[i]];   // W (linear) or W1
  if (h) for (let j = 0; j < h; j++) {
    w[I * h + j] = o.w[o.nIn * h + j];                                  // b1
    for (let k = 0; k < oo; k++) w[I * h + h + j * O + k] = o.w[o.nIn * h + h + j * o.nOut + k];   // W2
  }
  for (let k = 0; k < oo; k++) w[n - O + k] = o.w[on - o.nOut + k];   // b (b2)
  if (O > 2 && o.nOut <= 2) w[n - O + 2] = -1;                          // a new handbrake: off
  AI.w = w; AI.m = new Float32Array(n); AI.v = new Float32Array(n); AI.k = 0;
  AI.best = Float32Array.from(w); AI.examKind = '';                    // its best so far: where it starts, examined as training starts
  aiSave();
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
// the pace notes: the speed each metre of the racing line can be taken at, for a car with so much grip cornering
// (AI_CFG.gCorner, on tarmac; the other grounds in proportion, as the bots') and braking (AI_CFG.gBrake): the bend's
// own speed from its curvature (and banking), then braking back from every bend. With the bots' 0.84 g and 0.76 g, theirs.
// Optionally (AI_CFG.gAccel > 0) no faster than the car can speed up to from the bend before, either.
function aiPace() {
  const Pt = botPath(), L = aiLine(), D = aiDemoNow(), key = `${AI_CFG.gCorner}|${AI_CFG.gBrake}|${AI_CFG.gAccel}|${L ? AI.lineKey : 'centre'}`;
  if (AI.paceFor === Pt && AI.paceKey === key) return AI.paceV;
  if (D) { AI.paceFor = Pt; AI.paceKey = key; return AI.paceV = Float32Array.from(D.v); }   // the recorded lap's own speeds
  const P = Pt.P, n = Pt.n, v = new Float32Array(n), kc = AI_CFG.gCorner * 9.81 / 8.2, kb = AI_CFG.gBrake * 9.81 / 7.5, ds = L ? L.ds : Pt.ds;
  for (let i = 0; i < n; i++) {
    const q = P[i], lat = q.brk >= 7 ? 8.2 : q.brk >= 5 ? 5.2 : 3.8;               // the ground's (as botPath: tarmac, earth, sand)
    const bank = Math.abs(TRACK.bank?.[Math.round(i / n * (TRACK.pts.length - 1))] || 0);
    v[i] = Math.min(q.top, Math.sqrt((lat * kc + 9.81 * bank) / Math.max(Math.abs(L ? L.k[i] : q.k), 1e-4)));
  }
  for (let pass = 0; pass < 2; pass++) {
    if (AI_CFG.gAccel > 0) for (let i = 0; i < n; i++) v[(i + 1) % n] = Math.min(v[(i + 1) % n], Math.sqrt(v[i] ** 2 + 2 * AI_CFG.gAccel * 9.81 * ds));
    for (let i = n - 1; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[(i + 1) % n] ** 2 + 2 * P[i].brk * kb * ds));
  }
  AI.paceFor = Pt; AI.paceKey = key;
  return AI.paceV = v;
}
// A recorded lap to follow (aiDemo: a ghost's trace, e.g. a driver's best lap): its line across the road and its speed
// at each metre of the course take the place of the racing line and the pace notes while it is set (per course and car,
// in this browser; aiDemo(null) drops it). Learning from a demonstration: the network still has to learn to drive it.
function aiDemo(trace) {
  const key = `sandbuggy.ai.demo.${courseKey()}.${VEH.key}`;
  AI.demoKey = null; AI.lineFor = AI.paceFor = null;
  if (trace === null) { try { localStorage.removeItem(key); } catch (e) { } return { demo: false }; }
  let b; try { const s = atob(String(trace)); b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); } catch (e) { throw new Error('Not a trace'); }
  const dv = new DataView(b.buffer), m = Math.floor(b.length / (GH_F * 2));
  if (m < 20) throw new Error('Too short a trace');
  const X = new Float32Array(m), Z = new Float32Array(m);
  for (let k = 0; k < m; k++) { X[k] = dv.getInt16(k * GH_F * 2, true) * GH_POS; Z[k] = dv.getInt16((k * GH_F + 2) * 2, true) * GH_POS; }
  const Pt = botPath(), P = Pt.P, n = Pt.n, e = new Float32Array(n), v = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let bk = 0, bd = Infinity;
    for (let k = 0; k < m; k++) { const d = (X[k] - P[i].x) ** 2 + (Z[k] - P[i].z) ** 2; if (d < bd) { bd = d; bk = k; } }
    e[i] = (X[bk] - P[i].x) * P[i].tz - (Z[bk] - P[i].z) * P[i].tx;
    const a = Math.max(0, bk - 1), c = Math.min(m - 1, bk + 1);
    v[i] = Math.hypot(X[c] - X[a], Z[c] - Z[a]) / ((c - a) * GH_DT || GH_DT);
  }
  const sm = (arr, r) => { const o = new Float32Array(n); for (let i = 0; i < n; i++) { let t = 0; for (let j = -r; j <= r; j++) t += arr[(i + j + n) % n]; o[i] = t / (2 * r + 1); } return o; };
  const d = { e: [...sm(e, 4)], v: [...sm(v, 3)], m };
  try { localStorage.setItem(key, JSON.stringify(d)); } catch (err) { }
  return { demo: true, samples: m, seconds: +((m - 1) * GH_DT).toFixed(1), points: n, maxOffset: +Math.max(...d.e.map(Math.abs)).toFixed(1) };
}
function aiDemoNow() {
  const key = `sandbuggy.ai.demo.${courseKey()}.${VEH.key}`;
  if (AI.demoKey !== key) {
    AI.demoKey = key; AI.demo = null; AI.lineFor = AI.paceFor = null;
    try { const d = JSON.parse(localStorage.getItem(key) || 'null'); if (d?.e) AI.demo = { e: Float32Array.from(d.e), v: Float32Array.from(d.v), m: d.m }; } catch (e) { }
  }
  return AI.demo;
}
// A racing line (AI_CFG.racingLine), instead of the course's centre: the smoothest path within the road, kept 1.6 m
// inside its edges (the tarmac's on road, the gate posts' off it): each point slid across the road toward the middle of
// its neighbours some way off, again and again, from far ones (the shape of a bend) to near ones (its detail). Its
// points match the centre's one for one (e: how far left of it); its own direction and curvature for the bearings
// and the pace notes.
function aiLine() {
  const D = aiDemoNow();
  if (!AI_CFG.racingLine && !D) return null;
  const Pt = botPath(), W = AI_CFG.lineW > 0 ? AI_CFG.lineW : Math.max(0.5, aiHalfW() - 1.6), key = D ? `demo${D.m}` : `${W}`;   // (or as much room as set)
  if (AI.lineFor === Pt && AI.lineKey === key) return AI.line;
  const P = Pt.P, n = Pt.n, e = D ? Float32Array.from(D.e) : new Float32Array(n), x = new Float32Array(n), z = new Float32Array(n);
  const at = i => { x[i] = P[i].x + P[i].tz * e[i]; z[i] = P[i].z - P[i].tx * e[i]; };
  for (let i = 0; i < n; i++) at(i);
  if (!D) for (const span of [24, 16, 10, 6, 3]) for (let it = 0; it < 250; it++) for (let i = 0; i < n; i++) {
    const a = (i - span + n) % n, b = (i + span) % n, mx = (x[a] + x[b]) / 2, mz = (z[a] + z[b]) / 2;
    const want = (mx - P[i].x) * P[i].tz - (mz - P[i].z) * P[i].tx;              // the middle's offset across the road here
    e[i] = clamp(e[i] + (want - e[i]) * 0.5, -W, W); at(i);
  }
  const L = { e, x, z, tx: new Float32Array(n), tz: new Float32Array(n), k: new Float32Array(n), ds: 0 };
  let len = 0;
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n, b = (i + 1) % n, dx = x[b] - x[a], dz = z[b] - z[a], l = Math.hypot(dx, dz) || 1;
    L.tx[i] = dx / l; L.tz[i] = dz / l; len += Math.hypot(x[b] - x[i], z[b] - z[i]);
  }
  L.ds = len / n;
  const kr = new Float32Array(n);
  for (let i = 0; i < n; i++) { const a = (i - 3 + n) % n, b = (i + 3) % n; kr[i] = Math.asin(clamp(L.tx[a] * L.tz[b] - L.tz[a] * L.tx[b], -1, 1)) / (6 * L.ds); }
  for (let i = 0; i < n; i++) { let sm = 0; for (let j = -4; j <= 4; j++) sm += kr[(i + j + n) % n]; L.k[i] = -sm / 9; }
  L.len = len;
  AI.lineFor = Pt; AI.lineKey = key;
  return AI.line = L;
}
// st follows a car (at x, z) along the line: {i: the nearest point (-1: look everywhere), dist: metres along, lat: + left of it}
function aiTrack(st, x, z) {
  const Pt = botPath(), P = Pt.P, n = Pt.n;
  let bi = st.i, bd = Infinity;
  const look = j => { j = ((j % n) + n) % n; const q = P[j], d = (q.x - x) ** 2 + (q.z - z) ** 2; if (d < bd) { bd = d; bi = j; } };
  if (st.i >= 0) for (let k = -6; k <= 14; k++) look(st.i + k);
  if (st.i < 0 || bd > 400) { bd = Infinity; for (let j = 0; j < n; j++) look(j); st.i = bi; }
  let di = bi - st.i; if (di > n / 2) di -= n; else if (di < -n / 2) di += n;
  st.dist += di * Pt.ds; st.i = bi;
  const p = P[bi]; st.lat = (x - p.x) * p.tz - (z - p.z) * p.tx;
  return bi;
}
// what the car sees (AI.other: the rival's st and velocity, or null)
function aiObserve(st, dt = AI_DT) {
  const Pt = botPath(), P = Pt.P, n = Pt.n, bi = aiTrack(st, car.pos.x, car.pos.z);
  const q = car.q, fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y), fl = Math.hypot(fx, fz) || 1, cx = fx / fl, cz = fz / fl;
  const p = P[bi], v = car.vel.x * cx + car.vel.z * cz;
  const brg = [], RL = aiLine(), off = RL ? st.lat - RL.e[bi] : st.lat;   // off: from the line followed (the racing line, or the centre)
  for (let k = 0; k < AI_LOOK.length; k++) {
    const ahead = AI_CFG.lookTime ? Math.max(AI_LOOK_MIN[k], Math.abs(v) * AI_LOOK_T[k]) : AI_LOOK[k];   // metres; by time: as far as it goes in so long
    const m = (bi + Math.round(ahead / Pt.ds)) % n, a = AI.look[k] = RL ? { x: RL.x[m], z: RL.z[m] } : P[m], dx = a.x - car.pos.x, dz = a.z - car.pos.z;
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
    case 'offset': aiX[j++] = off / 5; break;
    case 'yaw': aiX[j++] = car.w.y / 2; break;
    case 'pace': aiX[j++] = (aiPace()[bi] * AI_CFG.pace - v) / 10; break;   // (the notes for the grip set: aiPace)                    // the course's pace note: how much faster it could go here
    case 'ahead': aiX[j++] = (aiPace()[(bi + Math.round(Math.max(AI_AHEAD_MIN, Math.abs(v) * AI_AHEAD_T) / Pt.ds)) % n] * AI_CFG.pace - v) / 10; break;
    case 'edges': { const W = aiHalfW(); aiX[j++] = (W - st.lat) / 10; aiX[j++] = (W + st.lat) / 10; break; }
    case 'rays': AI_RAYS.forEach((a, k) => { aiX[j++] = aiRay(cx, cz, a, k) / AI_RAY_MAX; }); break;
    case 'slide': aiX[j++] = (car.vel.x * cz - car.vel.z * cx) / 10; break;
    case 'wslip': for (const fr of [true, false]) { let t = 0, k = 0; for (const W of car.wheels) if (W.front === fr && W.contact) { t += W.slip || 0; k++; } aiX[j++] = k ? clamp(t / k, -1, 1) : 0; } break;
    case 'rival': {                                                    // (smoothly from ahead to behind over 4 m: no jump alongside)
      const o = AI.other; let a = 0, b = 0, sd = 0, cl = 0;
      if (o && o.st.i >= 0) {
        const g = aiGap(o.st.i - bi), near = Math.max(0, 1 - Math.abs(g) / AI_RV_NEAR), f = clamp(0.5 + g / 4, 0, 1), q2 = P[o.st.i];
        a = near * f; b = near * (1 - f); sd = clamp((o.st.lat - st.lat) / 5, -2, 2) * near;
        cl = clamp(((car.vel.x * p.tx + car.vel.z * p.tz) - (o.vel.x * q2.tx + o.vel.z * q2.tz)) / 10, -2, 2) * near;
      }
      aiX[j++] = a; aiX[j++] = b; aiX[j++] = sd; aiX[j++] = cl; break;
    }
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
// without the brake (AI.nb): the pedal is gas or nothing (its − half: off); it slows by lifting off, or with the handbrake
function aiAct(w, st, dt) {
  aiObserve(st, dt); aiNet(w, aiX, aiY); AI.viewW = w; AI.nAct++;
  const steer = AI.applied[0] = AI.ks ? aiKey3(aiY[0]) : aiY[0], pedal = AI.applied[1] = Math.max(AI.nb ? 0 : -1, AI.kp ? aiKey3(aiY[1]) : aiY[1]);
  return AI.lastCtl = { throttle: Math.max(0, pedal), brake: Math.max(0, -pedal), steer, handbrake: AI.nOut > 2 && aiY[2] > 0 };
}
// readInput's controls while training or driving (null: the player's)
function aiInput(dt) {
  if (AI.training) return AI.ctl;
  if (!AI.drive) return null;
  if (keys.KeyW || keys.KeyS || keys.KeyA || keys.KeyD || keys.ArrowUp || keys.ArrowDown || keys.ArrowLeft || keys.ArrowRight) {
    AI.drive = false; flash('You have the wheel', '#fff', 1.5); aiShow(); return null;
  }
  // as it was trained and examined: a decision every AI_DT, held between (one a frame, at 120 Hz or more, drives otherwise)
  AI.dAcc = (AI.dAcc || 0) + dt;
  if (!AI.dCtl || AI.dAcc >= AI_DT) { AI.dAcc = Math.min(AI.dAcc - AI_DT, AI_DT); AI.dCtl = aiAct(AI.best || AI.w, AI.dst, AI_DT); }
  return AI.dCtl;
}

// ---------- training ----------
// a training per course, car, size and inputs (the original 7 without the handbrake: no suffix)
const aiSig = () => AI.hb || AI.kp || AI.ks || AI.nb || AI.inputs.join() !== AI_DEFAULT_INPUTS.join() ? '.' + AI.inputs.join('+') + (AI.hb ? '+hb' : '') + (AI.kp ? '+kp' : '') + (AI.ks ? '+ks' : '') + (AI.nb ? '+nobrake' : '') : '';
const aiKey = () => `sandbuggy.ai.${courseKey()}.${VEH.key}.${AI.h}${aiSig()}`;
const aiGauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
function aiFresh() {
  const n = AI.np = aiShape(AI.inputs, AI.hb, AI.h).np, b = n - AI.nOut;
  Object.assign(AI, { w: new Float32Array(n), m: new Float32Array(n), v: new Float32Array(n), k: 0, gen: 0, best: null, bestFit: -1, bestLap: null, sinceBest: 0, hist: [], cands: null, ep: null, examKind: aiExamKind(), rvPool: [], bestSolo: null });
  for (let i = 0; i < n; i++) AI.w[i] = aiGauss() * 0.1;
  AI.w[b + 1] = 0.5;                                                  // a little throttle to begin with, or nothing moves
  if (AI.nOut > 2) AI.w[b + 2] = -1;                                  // the handbrake off, until it learns better
}
function aiLoad() {
  AI.key = aiKey(); aiFresh();
  try {
    const d = JSON.parse(localStorage.getItem(AI.key) || 'null');
    if (d && d.w?.length === AI.np) Object.assign(AI, { w: Float32Array.from(d.w), m: Float32Array.from(d.m || AI.m), v: Float32Array.from(d.v || AI.v), k: d.k || 0, gen: d.gen || 0,
      best: d.best?.length === AI.np ? Float32Array.from(d.best) : null, bestFit: d.bestFit ?? -1, bestLap: d.bestLap ?? null, hist: d.hist || [], sinceBest: d.sinceBest | 0, examKind: d.exam || 'line', bestSolo: d.bestSolo ?? null });
  } catch (e) { }
}
function aiSave() {
  try { localStorage.setItem(AI.key, JSON.stringify({ w: [...AI.w], m: [...AI.m], v: [...AI.v], k: AI.k, gen: AI.gen, best: AI.best && [...AI.best], bestFit: AI.bestFit, bestLap: AI.bestLap, sinceBest: AI.sinceBest, hist: AI.hist.slice(-300), exam: AI.examKind, bestSolo: AI.bestSolo })); } catch (e) { }
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
  const b1 = 1 - 0.9 ** AI.k, b2 = 1 - 0.999 ** AI.k, lr = AI_CFG.lr * (AI.bestLap != null || AI.hist.some(h => h[2] != null) ? 0.3 : 1);   // smaller steps once it laps (or did, under an exam since made harder): refine, don't wander off
  for (let i = 0; i < AI.np; i++) {
    AI.m[i] = 0.9 * AI.m[i] + 0.1 * g[i]; AI.v[i] = 0.999 * AI.v[i] + 0.001 * g[i] * g[i];
    AI.w[i] += lr * (AI.m[i] / b1) / (Math.sqrt(AI.v[i] / b2) + 1e-8);
  }
  let sum = 0, mx = -Infinity; for (const f of AI.fits) { sum += f; mx = Math.max(mx, f); }
  AI.tryAvg = sum / AI_CFG.pop;
  AI.cands = null; AI.exam = true;                                     // next: the new weights, from the start line
}
// a drive: w from d metres along the racing line (0: the start line, behind it as a lap starts), at most limit s;
// lead: so many metres driven before the lap that counts starts (a flying lap: a whole lap first); laps: so many timed
// sc: with the rival (a scenario: aiScenario, aiRaceScen), else alone
function aiStartEpisode(w, d, limit, lead = 0, laps = 1, sc = null) {
  const R = sc ? aiRival() : null;
  if (R) {
    R.mode = AI_CFG.rival === 'replay' ? 'replay' : 'car'; R.w = R.brain ? R.brain.w : sc.w; R.skill = sc.skill;
    if (R.mode === 'replay' && !sc.tape) sc.tape = aiRvRecord(R, (d || -8) + sc.gap, sc.lat, !!d && AI_CFG.rolling, limit, lead + laps * botPath().len + 40);   // (before the ground is put back)
    R.tape = sc.tape;
  }
  if (AI.freshC) { H.set(B); C.set(AI.freshC); } else { H.set(AI.snapH); C.set(AI.snapC); }
  repairAll(); AI.acc = 0;
  aiPlaceCar(d, sc ? sc.myLat : 0, !d && !sc, true, !!d && AI_CFG.rolling);
  if (R) {
    aiRvSwap(R); repairCar(); aiPlaceCar((d || -8) + sc.gap, sc.lat, false, false, !!d && AI_CFG.rolling); aiRvSwap(R);
    aiRvReady(R);
  }
  if (AI.rv) AI.rv.on = !!R;
  AI.ep = { w, st: { i: -1, dist: 0, lat: 0 }, t: 0, max: 0, chk: 0, chkDist: 0, limit, offM: 0, swing: 0, pc: null, driven: 0, lead, laps, t0: lead ? null : 0, mark: 0, times: [], hb: 0,
    rv: !!R, sc, contact: 0, touches: 0, touching: false, k: 0 };
}
// the car in `car` (ours, or the rival swapped in) d m along the line (0: behind the start line), lat m to the left of it;
// gate: at the start gate, as a lap starts; mine: our car (the lap's timing follows it); roll: rolling (AI_CFG.rolling)
function aiPlaceCar(d, lat, gate, mine, roll) {
  if (gate) placeAtGate(0, -8);
  else { const q = aiLineAt(d || -8); resetCar(q.x + q.tz * lat, q.z - q.tx * lat, Math.atan2(q.tx, q.tz)); if (mine) lap.prev.copy(car.pos); }
  // as a fresh car: nothing carried over from the last drive (gear, revs, wheel spin, steering), or no two drives compare
  for (const W of car.wheels) Object.assign(W, { omega: 0, spin: 0, t: car.REST, comp: 0, contact: false, sink: 0, slip: 0, slipSpeed: 0 });
  Object.assign(car.eng, { gear: 1, rpm: ENG.idle, cut: false, shiftT: 0, reverse: false, load: 0, liftT: 9, tc: 1, sinceShift: 0, lastPower: 0, popT: 0 });
  car.throttle = 0; car.steer = 0;
  // rolling (AI_CFG.rolling): a try away from the start line begins at most of the pace note's speed there, in a gear that
  // suits it, as the car would arrive in a lap (from a standstill, most of a try is spent getting up to speed)
  if (roll) {
    const Pt = botPath(), i = ((AI.s0 + Math.round(d / Pt.ds)) % Pt.n + Pt.n) % Pt.n, v0 = Math.min(aiPace()[i] * 0.85, 45);
    const f = 2 * (car.q.x * car.q.z + car.q.w * car.q.y), g = 1 - 2 * (car.q.x ** 2 + car.q.y ** 2), fl = Math.hypot(f, g) || 1;
    car.vel.set(f / fl * v0, 0, g / fl * v0);
    const om = v0 / car.R; for (const W of car.wheels) W.omega = om;
    let gear = 1; while (gear < ENG.gears.length && om * ENG.gears[gear - 1] * ENG.fd * 60 / (2 * Math.PI) > ENG.limiter * 0.8) gear++;
    Object.assign(car.eng, { gear, rpm: Math.max(ENG.idle, om * ENG.gears[gear - 1] * ENG.fd * 60 / (2 * Math.PI)) });
    car.throttle = 1;
  }
}
// one physics step of the episode under way: its score when it ends, else null
function aiStep() {
  const E = AI.ep, len = botPath().len, R = E.rv ? AI.rv : null;
  AI.other = R ? { st: R.st, vel: R.c.vel } : null;                   // what ours sees of the rival
  AI.ctl = aiAct(E.w, E.st, AI_DT);
  if (E.pc) E.swing += Math.abs(AI.applied[0] - E.pc[0]) + Math.abs(AI.applied[1] - E.pc[1]);   // how much the controls moved
  E.pc = [AI.applied[0], AI.applied[1]];
  if (AI.ctl.handbrake) E.hb += AI_DT;                                   // how long it pulls the handbrake
  if (R && R.mode === 'car') aiRvDecide(R, E.st);
  readInput(AI_DT);
  if (R && R.mode === 'car') { aiRvSwap(R); readInput(AI_DT); aiRvSwap(R); }
  AI.acc += AI_DT;
  while (AI.acc >= DT) { stepCar(DT); collideGates(DT); if (R) aiRvSub(R, E, E.st, DT); AI.acc -= DT; }
  car.grace = Math.max(0, car.grace - AI_DT); hitCooldown = 1;   // (no crash messages for each try)
  if (R) aiRvLate(R, ++E.k, AI_DT);
  E.t += AI_DT; E.max = Math.max(E.max, E.st.dist); AI.nSim += AI_DT;
  const sp = Math.hypot(car.vel.x, car.vel.z) * AI_DT; E.driven += sp;
  if (Math.abs(E.st.lat) > aiHalfW()) E.offM += sp;                    // off the road
  if (E.t0 == null && E.st.dist >= E.lead) E.t0 = E.mark = E.t;        // a flying lap: the clock starts at the line, a lap on
  if (E.t0 != null && E.st.dist >= E.lead + (E.times.length + 1) * len) { E.times.push(E.t - E.mark); E.mark = E.t; }   // a timed lap done
  const why = E.times.length >= E.laps ? 'lap' : Math.abs(E.st.lat) > AI_CFG.off ? 'off' : E.st.dist < E.max - 15 ? 'back' : car.wrecked ? 'wreck' : up.y < 0.3 ? 'over'
    : E.t >= E.limit ? 'time' : E.t >= E.chk + 4 && E.st.dist - E.chkDist < 4 ? 'stuck' : null;
  if (E.t >= E.chk + 4) { E.chk = E.t; E.chkDist = E.st.dist; }
  if (!why) return null;
  // (from the line, the second time on a flying lap); timed laps: the slowest counts, so a network has to keep it up
  const timed = E.t - (E.t0 ?? E.t), run = E.times.length ? Math.max(...E.times) : timed, prog = E.max - E.lead;
  const dmg = 1 - carCondition(), kmh = Math.max(0, prog) / Math.max(timed, 1) * 3.6, extra = Math.max(0, E.driven - E.max);
  const gain = R ? E.st.dist - R.st.dist : 0, cpen = R ? AI_PEN.contact * E.contact - AI_PEN.gain * gain : 0;   // the rival: its impacts, the metres gained on it
  const pen = AI_PEN.offRoad * E.offM + AI_PEN.damage * dmg + (car.wrecked ? AI_PEN.wreck : 0) + AI_PEN.smooth * E.swing + AI_PEN.path * extra - AI_PEN.speed * kmh + cpen;
  const fit = (why === 'lap' ? len + AI_LAP_BONUS * Math.max(0, AI_T - run) : prog / E.laps) - pen;   // (not all the laps: below any that did them)
  AI.last = { why, at: Math.round(prog), t: +E.t.toFixed(1), lap: why === 'lap' ? +run.toFixed(2) : null, laps: E.times.map(x => +x.toFixed(2)), hb: +E.hb.toFixed(1), x: Math.round(car.pos.x), z: Math.round(car.pos.z), offM: Math.round(E.offM), dmg: Math.round(dmg * 100), wrecked: car.wrecked, pen: Math.round(pen), kmh: Math.round(kmh), swing: +E.swing.toFixed(1), extra: Math.round(extra),
    rival: R ? { kind: E.sc.kind, contact: +E.contact.toFixed(1), touches: E.touches, gain: Math.round(gain), cpen: Math.round(cpen), dmgF: dmg } : null };
  return fit;
}
// The ground as the world was built (the heights are B's, the editor's strokes in both; how packed it is, C, is kept
// here): tries and exams start on it, not on whatever the driving before them wore into it (ruts, loosened sand, a
// lap's worth of an exam at 31.48 s ran 31.68 after a few laps of Drive it)
function aiFreshGround() { AI.freshC = C.slice(); }
// the exam: a lap from the start line; a flying one (AI_CFG.flying), the second of two in a row, as Drive it's after the
// first (on the ground the first has worn and with its knocks: nothing put back between them)
// what an exam's score depends on besides the weights (the exam, what the network is shown, what it's scored on): when
// it changes, the best's score is another exam's
function aiExamKind() {
  return [AI_CFG.flying ? (AI_CFG.examLaps > 1 ? 'flying2x' + AI_CFG.examLaps : 'flying2') : 'line', AI_CFG.pace, AI_CFG.gCorner, AI_CFG.gBrake, AI_CFG.gAccel, AI_CFG.racingLine ? AI_CFG.lineW : '-',
    AI_CFG.lookTime ? 't' : 'm', AI_CFG.off, aiDemoNow() ? 'demo' : '', JSON.stringify(AI_PEN), ...(aiRaceExam() ? ['race:' + AI_CFG.rival + (aiRivalKey() !== VEH.key ? ':' + aiRivalKey() + ':' + (AI.rv?.brain?.lap ?? '') : '')] : [])].join(' ');
}
// with a rival (AI_CFG.rival), each exam is also a race: a lap from the grid alongside it (the latest of the rivals, at its
// best), whose impacts, damage and not finishing cost (aiRaceCost)
const aiRaceExam = () => AI_CFG.rival !== 'off' && !!aiRival();
const aiRaceScen = () => { const g = Math.min(2.2, aiHalfW() * 0.4); return { kind: 'race', gap: 0, lat: g, myLat: -g, skill: 1, w: AI.rvPool[AI.rvPool.length - 1] || AI.best || AI.w }; };
const aiRaceCost = L => (L.why === 'lap' ? 0 : AI_CFG.crash) + (L.rival ? L.rival.cpen + AI_PEN.damage * L.rival.dmgF : 0) + (L.wrecked ? AI_PEN.wreck : 0);
// an exam now: {fit, solo: the lap's score without the race}; AI.last is the lap's, AI.lastRace the race's
function aiExamRun(w) {
  aiExamStart(w); let fit; while ((fit = aiStep()) == null) { }
  AI.ep = null; AI.lastRace = null;
  if (!aiRaceExam()) return { fit, solo: fit };
  const solo = AI.last; aiStartEpisode(w, 0, AI_T, 0, 1, aiRaceScen()); while (aiStep() == null) { }
  AI.ep = null; AI.lastRace = AI.last; AI.last = solo;
  return { fit: fit - aiRaceCost(AI.lastRace), solo: fit };
}
const aiExamStart = w => AI_CFG.flying ? aiStartEpisode(w, 0, AI_T * (1 + AI_CFG.examLaps) / 2, botPath().len, AI_CFG.examLaps) : aiStartEpisode(w, 0, AI_T);
// the racing line's point d metres on from the start line (botPath's start, s0, is elsewhere)
function aiLineAt(d) {
  const Pt = botPath();
  if (AI.s0path !== Pt) { const g = TRACK.gates[0]; let bi = 0, bd = Infinity; Pt.P.forEach((q, j) => { const e = (q.x - g.p.x) ** 2 + (q.z - g.p.z) ** 2; if (e < bd) { bd = e; bi = j; } }); AI.s0path = Pt; AI.s0 = bi; }
  return Pt.P[((AI.s0 + Math.round(d / Pt.ds)) % Pt.n + Pt.n) % Pt.n];
}
// a step of the training; false when the frame's work should stop (a generation done)
function aiTick() {
  if (!AI.cands && !AI.exam) { aiNewGen(); AI.from = AI.fail != null && Math.random() < 0.5 ? Math.max(1, AI.fail - 100) : 1 + Math.random() * (botPath().len - 1); AI.scen = aiScenario(); }
  if (!AI.ep) AI.exam ? aiExamStart(AI.w) : aiStartEpisode(AI.cands[AI.ci], AI.from, AI_CFG.window, 0, 1, AI.scen);
  const E = AI.ep, len = botPath().len;
  let fit = aiStep();
  if (fit == null) return true;
  AI.ep = null;
  if (AI.exam) {                                                       // the generation's result
    if (aiRaceExam() && !AI.examSolo) {                                // the lap done: now the race
      AI.examSolo = { fit, last: AI.last, dist: E.st.dist };
      aiStartEpisode(E.w, 0, AI_T, 0, 1, aiRaceScen()); return true;
    }
    let solo = fit, dist = E.st.dist; AI.lastRace = null;
    if (AI.examSolo) { AI.lastRace = AI.last; AI.last = AI.examSolo.last; solo = AI.examSolo.fit; dist = AI.examSolo.dist; fit = solo - aiRaceCost(AI.lastRace); AI.examSolo = null; }
    AI.exam = false;
    AI.fail = AI.last.why !== 'lap' ? dist % len : null;                 // half the next tries start 100 m before: practise where it goes wrong
    const lapT = AI.last.lap;
    if (fit > AI.bestFit) { AI.bestFit = fit; AI.bestSolo = solo; AI.best = Float32Array.from(E.w); AI.bestLap = lapT; AI.sinceBest = 0; }
    else if (AI.bestLap != null) AI.sinceBest++;                        // it laps: how long since a better one
    if (AI.stopAfter && AI.bestLap != null && AI.sinceBest >= AI.stopAfter) AI.autoStop = `no better lap in ${AI.stopAfter} generation${AI.stopAfter > 1 ? 's' : ''}`;
    if (AI.gens && AI.gen + 1 >= AI.genEnd) AI.autoStop = `${AI.gens} generation${AI.gens > 1 ? 's' : ''} done`;   // (gen counts this one just below)
    AI.hist.push([Math.round(fit), Math.round(AI.tryAvg), lapT]); AI.lastExam = AI.last; AI.lastExamRace = AI.lastRace;
    AI.gen++; aiRvKeep(); aiSave();
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
    AI.snapH = H.slice(); AI.snapC = C.slice(); AI.ep = null; AI.cands = null; AI.exam = false; AI.examSolo = null;
    if (AI.rv) AI.rv.ck = null;                                        // (the rival car's training looked up again)
    AI.training = true; AI.mute = audio; audio = null;                   // the tries are silent (no engine, no crashes)
    if (AI.mute) AI.mute.node.port.postMessage({ on: 0 });
    if (AI.examKind !== aiExamKind()) aiReexam();
  } else {
    AI.training = false; AI.ep = null; AI.cands = null; AI.exam = false; AI.ctl = null; AI.examSolo = null; if (AI.rv) AI.rv.on = false;
    if (AI.snapH) { H.set(AI.snapH); C.set(AI.snapC); AI.snapH = AI.snapC = null; for (const ch of chunks.values()) ch.update(); updateFar(); }
    if (AI.mute) { audio = AI.mute; AI.mute = null; }
    AI.watch = false;
    restartRun();
  }
  aiShow();
}
// the exams changed (flying laps or from the line, the pace notes, the line, the penalties...): the best's score was
// another exam's, so it takes the new one
function aiReexam() {
  AI.examKind = aiExamKind();
  if (!AI.best) return;
  const x = aiExamRun(AI.best);
  AI.bestFit = x.fit; AI.bestSolo = x.solo; AI.bestLap = AI.last.lap; AI.sinceBest = 0; aiSave();
}
// training carries on from the best weights (after wandering off from them), not from where it got to
function aiBackToBest() {
  if (!AI.best) return;
  AI.w = Float32Array.from(AI.best); AI.m.fill(0); AI.sinceBest = 0;
  AI.cands = null; AI.exam = false; AI.ep = null;
  aiSave(); aiShow(); flash('Training carries on from the best', '#9fd4ff', 1.5);
}
function aiDrive(on, race = false) {
  if (on && !(AI.best || AI.w)) return;
  if (on && !aiAllowed()) { flash('Not during a race', '#ffd88a', 1.5); return; }
  if (on && race && AI.rv) AI.rv.ck = null;
  if (on && race && !aiRival()) { flash(aiRivalWhyNot(), '#ffd88a', 2.5); return; }
  if (AI.training) aiTrain(false);
  AI.drive = on; AI.race = null; AI.other = null; if (AI.rv) AI.rv.on = false;
  if (on) {
    restartRun(); AI.dst = { i: -1, dist: 0, lat: 0 }; AI.dCtl = null; AI.dAcc = 0;
    if (race) aiRaceStart();
    flash(race ? 'Autopilot against the rival (any driving key takes over)' : 'Autopilot: hands off (any driving key takes over)', '#9fd4ff', 2.5);
  }
  aiShow();
}
const aiRivalWhyNot = () => !ROAD_CARS[aiRivalKey()] ? 'A rival needs a road car' : `No autopilot trained for the ${ROAD_CARS[aiRivalKey()].name} on this course: train one with it first`;
// Race it: on the grid alongside the rival, another of this car driven by the best network (Train's kind of rival: a
// replay of its own laps, or a car that reacts)
function aiRaceStart() {
  const R = aiRival(), sc = aiRaceScen(); sc.w = AI.best || AI.w;
  R.mode = AI_CFG.rival === 'replay' ? 'replay' : 'car'; R.w = R.brain ? R.brain.w : sc.w; R.skill = 1; R.tape = null;
  if (R.mode === 'replay') { const h = H.slice(), c = C.slice(); R.tape = aiRvRecord(R, -8, sc.lat, false, (AI.bestLap || 60) * 4 + 20, 3 * botPath().len + 40); H.set(h); C.set(c); }
  aiPlaceCar(0, sc.myLat, false, true, false);
  aiRvSwap(R); repairCar(); aiPlaceCar(0, sc.lat, false, false, false); aiRvSwap(R);
  aiRvReady(R); R.on = true;
  AI.race = { contact: 0, touches: 0, touching: false, t: 0, infoT: 0 };
  AI.other = { st: R.st, vel: R.c.vel };
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
// the pedals in 3D (a little renderer of their own, drawn into the 2D overlay): the brake hung from above, the gas hinged
// on the floor, each pressed as far as the network presses it, and a see-through foot that moves between them
let aiPed = null;
function aiPedals() {
  if (aiPed !== null) return aiPed;
  try {
    const cv = document.createElement('canvas'); cv.width = 300; cv.height = 190;
    const r = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: true });
    r.setClearColor(0x000000, 0);
    const sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, cv.width / cv.height, 0.05, 5);
    cam.position.set(0.5, 0.56, 0.86); cam.lookAt(0.03, 0.15, 0.06);
    sc.add(new THREE.HemisphereLight(0xffffff, 0x302820, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8); sun.position.set(-0.5, 1.2, 1); sc.add(sun);
    const metal = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.5, roughness: 0.4 }), rubber = new THREE.MeshStandardMaterial({ color: 0x1c1c1f, roughness: 0.9 });
    const well = new THREE.MeshStandardMaterial({ color: 0x18181c, roughness: 1, transparent: true, opacity: 0.4, depthWrite: false });   // the footwell, faint
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.34), well); floor.rotation.x = -Math.PI / 2; floor.position.set(0.035, 0, 0.1); sc.add(floor);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), well); wall.position.set(0.035, 0.2, -0.13); wall.rotation.x = -0.35; sc.add(wall);
    const pad = (w, h, col) => {
      const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: 0x5c5f66, roughness: 0.7, emissive: col, emissiveIntensity: 0 });
      g.add(new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.016), m));
      for (let k = 1; k < 5; k++) { const rib = new THREE.Mesh(new THREE.BoxGeometry(w * 0.8, 0.005, 0.006), rubber); rib.position.set(0, -h / 2 + k * h / 5, 0.009); g.add(rib); }
      g.mat = m; return g;
    };
    // the gas: an organ pedal hinged at the floor, leaning back
    const gas = new THREE.Group(); gas.position.set(0.13, 0.015, 0); sc.add(gas);
    const gp = pad(0.065, 0.2, 0x2fbf4a); gp.position.set(0, 0.1, 0); gas.add(gp);
    // the brake: a wide pad on an arm from a pivot under the dash
    const brake = new THREE.Group(); brake.position.set(-0.06, 0.44, -0.08); sc.add(brake);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 8), metal); arm.position.set(0, -0.15, 0); brake.add(arm);
    const bp = pad(0.11, 0.075, 0xe0352b); bp.position.set(0, -0.3, 0.01); bp.rotation.x = 0.5; brake.add(bp);
    // the foot: the ball of it at the origin, the heel along +z, its top +y; see-through
    const skin = new THREE.MeshStandardMaterial({ color: 0xe9e3d6, roughness: 0.6, transparent: true, opacity: 0.5, depthWrite: false });
    const foot = new THREE.Group(); foot.rotation.order = 'YXZ'; sc.add(foot);
    const blob = (x, y, z, sx, sy, sz) => { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), skin); m.position.set(x, y, z); m.scale.set(sx, sy, sz); foot.add(m); };
    blob(0, 0.03, 0.1, 0.048, 0.034, 0.14); blob(0, 0.026, -0.015, 0.044, 0.026, 0.05); blob(0, 0.04, 0.215, 0.038, 0.045, 0.045);
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.034, 0.16, 16), skin); foot.add(shin);   // (up and back to the knee, whatever the foot's angle)
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.008, 0.29), new THREE.MeshStandardMaterial({ color: 0x1b1b1b, transparent: true, opacity: 0.45, depthWrite: false }));
    sole.position.set(0, 0.002, 0.1); foot.add(sole);
    aiPed = { cv, r, sc, cam, gas, gp, brake, bp, foot, shin, a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), up: new THREE.Vector3(0, 0.04, 0.07) };
  } catch (e) { aiPed = false; }                                      // (no WebGL for it: the flat drawing)
  return aiPed;
}
// pressed this far (0..1), the foot over the gas (1), the brake (-1) or between: the picture
function aiPedalsDraw(brk, gas, foot) {
  const P = aiPedals(); if (!P) return null;
  P.gas.rotation.x = 0.55 - gas * 0.3;                                 // (leaning back 32°; pressed, towards the firewall)
  P.brake.rotation.x = -0.5 + brk * 0.38;
  P.gp.mat.emissiveIntensity = gas * 0.9; P.bp.mat.emissiveIntensity = brk * 0.9;
  P.sc.updateMatrixWorld(true);
  // the ball of the foot on the pad's face, or resting between them, a little back
  const onGas = P.gp.localToWorld(P.a.set(0, 0.02, 0.012)), onBrake = P.bp.localToWorld(P.b.set(0, 0, 0.012));
  const k = Math.abs(foot), rest = P.c.copy(onGas).lerp(onBrake, 0.5).add(P.up);
  P.foot.position.copy(rest).lerp(foot > 0 ? onGas : onBrake, k);
  P.foot.rotation.x = lerp(0.62, foot > 0 ? 0.95 - gas * 0.3 : 0.45 - brk * 0.1, k);   // the sole along the pad
  P.foot.rotation.y = lerp(0, foot > 0 ? -0.12 : 0.1, k);
  const sa = 0.55 - P.foot.rotation.x; P.shin.rotation.x = sa; P.shin.position.set(0, 0.06 + 0.08 * Math.cos(sa), 0.2 + 0.08 * Math.sin(sa));
  P.r.render(P.sc, P.cam);
  return P.cv;
}
function aiCtlDraw(dt, live) {

  const show = live && !rp.on && !!AI.lastCtl;
  if ((aiCtlCv.style.display !== 'none') !== show) aiCtlCv.style.display = show ? 'block' : 'none';
  if (AI.ctlBox && AI.ctlBox.classList.contains('live') !== show) AI.ctlBox.classList.toggle('live', show);   // (and in the panel's full-screen view)
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
  // the foot: over the gas, over the brake, or resting between, eased so it moves as a foot would
  const want = gas > 0.01 ? 1 : brk > 0.01 ? -1 : 0; aiCtlFoot += (want - aiCtlFoot) * Math.min(1, (dt + 1 / 30) * 6);
  const ped = aiPedalsDraw(brk, gas, aiCtlFoot);
  if (ped) {                                                           // in 3D: the pedals, the foot; under them how far each is pressed
    g.drawImage(ped, 250, 4, 300, 190);
    for (const [x, v, col, label] of [[272, brk, '#e0352b', 'BRAKE'], [432, gas, '#2fbf4a', 'GAS']]) {
      g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x, 200, 96, 9); g.fillStyle = col; g.fillRect(x, 200, 96 * v, 9);
      g.fillStyle = '#fff'; g.font = '600 18px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText(`${label} ${Math.round(v * 100)}%`, x + 48, 228);
    }
  } else {
  const bp = pedal(290, 84, brk, '#e0352b', 'BRAKE'), gp = pedal(430, 64, gas, '#2fbf4a', 'GAS');
  const fx = lerp(lerp(bp.x, gp.x, 0.5), aiCtlFoot > 0 ? gp.x : bp.x, Math.abs(aiCtlFoot)), fy = lerp(60, aiCtlFoot > 0 ? gp.y : bp.y, Math.abs(aiCtlFoot)) - 8;
  g.save(); g.translate(fx, fy); g.rotate(-0.25);
  g.fillStyle = '#d9d2c5'; g.strokeStyle = '#1b1b1b'; g.lineWidth = 3;
  g.beginPath(); g.roundRect(-26, -44, 52, 70, 22); g.fill(); g.stroke();                       // the shoe, from above
  g.fillStyle = '#b5ada0'; g.beginPath(); g.ellipse(0, -48, 18, 10, 0, 0, 7); g.fill(); g.stroke();   // the ankle
  g.restore();
  }
  // the handbrake, if it has one
  if (AI.nOut > 2) {
    g.fillStyle = c.handbrake ? '#ff3b2f' : 'rgba(255,255,255,.15)'; g.beginPath(); g.roundRect(W - 92, 8, 80, 28, 14); g.fill();
    g.fillStyle = '#fff'; g.font = '700 16px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('H-BRAKE', W - 52, 23);
  }
  if (AI.big && AI.ctlBig) { const bg = AI.ctlBig.getContext('2d'); bg.clearRect(0, 0, W, Hc); bg.drawImage(aiCtlCv, 0, 0); }   // the full-screen view's copy
}
function aiViz(dt) {
  const live = (AI.training || AI.drive) && !!AI.viewW;
  aiCtlDraw(dt, live);
  // decisions a second (the network runs on the main thread, in readInput: once every AI_DT of simulated time, driving
  // or training, as many as fit in AI_BUDGET ms a frame)
  const now = performance.now(), el = (now - (AI.rateT || now)) / 1000;     // real seconds (a frame's dt is capped)
  if (!AI.rateT) AI.rateT = now;
  else if (el >= 1) {
    const n = AI.nAct / el, x = AI.nSim / el;
    const f = v => v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString('en');
    AI.rate = !live ? '' : AI.training ? `${f(n)} decisions/s on the main thread · ${AI.watch ? 'at real speed (watching)' : `driving at ${f(x)}× real time`}`
      : `${f(n)} decisions/s on the main thread (as trained: one every ${Math.round(AI_DT * 1000)} ms)`;
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
  aiNetDraw(live); aiIoLive(live);
}
// what each input and output is for, in a line (the panel's full-screen view; the inputs' tips say more)
const AI_ABOUT = {
  speed: 'How fast it is going: what it can brake for, and how much grip it has left.',
  line6: 'Which way the racing line goes 6 m ahead: the near cue for the steering.',
  line15: 'The line 15 m ahead: the bend it is turning into.',
  line30: 'The line 30 m ahead: the next bend, early enough to set up for it.',
  offset: 'How far it is to the side of the racing line: steer back to it.',
  yaw: 'How fast the car is turning: steadies the steering, so it doesn’t weave.',
  pace: 'The speed this bit of line can be taken at, less its own: below 0, too fast here.',
  ahead: 'The same a moment ahead: the bend coming, in time to brake for it.',
  edges: 'How much room is left to the course’s edge, left and right.',
  rays: 'Five feelers: how far it can go each way before it leaves the course.',
  slide: 'How fast it slides sideways: to catch a slide early.',
  wslip: 'The front and rear wheels’ slip: spinning (too much gas) or locking (braking).',
  sink: 'How deep the wheels sink: digging itself in, on sand.',
  g: 'The g it pulls, forward and sideways: how hard it accelerates, brakes and corners.',
  rival: 'Where the rival car is: ahead, behind, to the side, and how fast we close on it.',
  tilt: 'How far it leans and pitches: about to roll over?',
};
const AI_OUTS = [
  { name: 'steer', about: 'Turns the wheel: + left, − right, ±1 full lock.', fmt: v => Math.abs(v) < 0.05 ? 'straight' : (v > 0 ? '◀ left ' : 'right ▶ ') + Math.round(Math.abs(v) * 100) + '%' },
  { name: 'pedal', about: 'One pedal for both feet: + the gas, − the brake (with no brake, below 0 is off).', fmt: v => v > 0 ? 'gas ' + Math.round(v * 100) + '%' : v < 0 && !AI.nb ? 'brake ' + Math.round(-v * 100) + '%' : 'off' },
  { name: 'handbrake', about: 'Pulls the handbrake when above 0: hairpins, and slides on purpose.', fmt: v => v > 0 ? 'ON' : 'off' },
];
// text in lines no wider than mw (canvas)
function aiWrap(g, text, mw) {
  const out = []; let line = '';
  for (const wd of String(text).split(' ')) { const t = line ? line + ' ' + wd : wd; if (line && g.measureText(t).width > mw) { out.push(line); line = wd; } else line = t; }
  if (line) out.push(line);
  return out;
}
// a tooltip box at (x, y) in a canvas of css size W x H: [text, style][] rows
function aiTipBox(g, x, y, W, H, rows, fs) {
  const pad = 8, lh = fs * 1.4, mw = Math.min(280, W - 24);
  const lines = rows.flatMap(([t, st]) => { g.font = st; return aiWrap(g, t, mw).map(l => [l, st]); });
  let bw = 0; for (const [l, st] of lines) { g.font = st; bw = Math.max(bw, g.measureText(l).width); }
  bw += pad * 2; const bh = lines.length * lh + pad * 2 - (lh - fs);
  let bx = x + 14, by = y + 14; if (bx + bw > W - 4) bx = x - 14 - bw; if (bx < 4) bx = 4; if (by + bh > H - 4) by = Math.max(4, H - 4 - bh);
  g.fillStyle = 'rgba(12,9,6,.94)'; g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 1;
  g.beginPath(); g.roundRect(bx, by, bw, bh, 6); g.fill(); g.stroke();
  g.textAlign = 'left'; g.textBaseline = 'top';
  lines.forEach(([l, st], k) => { g.font = st; g.fillStyle = k ? 'rgba(255,255,255,.78)' : '#fff'; g.fillText(l, bx + pad, by + pad + k * lh); });
}
// a canvas drawn at the screen's resolution, in css pixels: its context, width and height (null: not shown)
function aiCanvas(cv) {
  const r = devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  if (!W || !H) return null;
  if (cv.width !== Math.round(W * r) || cv.height !== Math.round(H * r)) { cv.width = Math.round(W * r); cv.height = Math.round(H * r); }
  const g = cv.getContext('2d'); g.setTransform(r, 0, 0, r, 0, 0); g.clearRect(0, 0, W, H);
  return { g, W, H };
}
// the diagram: what it sees (left) and does (right), live while it trains or drives; hover a dot for what it is
function aiNetDraw(live) {
  const cv = AI.el.querySelector('#aiNet'), w = AI.viewW || AI.best || AI.w, I = AI.nIn, O = AI.nOut, big = AI.big;
  if (!big) { const hh = Math.max(165, 22 + I * 20) + 'px'; if (cv.style.height !== hh) cv.style.height = hh; }   // as tall as its inputs need
  else if (cv.style.height) cv.style.height = '';
  const c = aiCanvas(cv); if (!c) return;
  const { g, W, H: Hc } = c;
  if (!w || w.length !== AI.np) return;
  const gap = I > 1 ? (Hc - (big ? 32 : 22)) / (I - 1) : 99;             // (big: the names shrink to fit their rows)
  const x = live ? aiX : null, h = AI.h, fb = big ? clamp(gap - 3, 9, 13) : 9.5, fsm = big ? clamp(gap - 4, 8.5, 11.5) : 8, nr = big ? clamp(gap / 2.4, 4, 7) : 6;
  const big1 = `600 ${fb}px system-ui, sans-serif`, small = `${fsm}px system-ui, sans-serif`;
  const xi = big ? Math.min(250, W * 0.3) : 75, xo = W - (big ? 150 : 65), xh = (xi + xo) / 2, pad = big ? 16 : 11;
  const pb = pad + (big && !x ? 16 : 0);                               // (room for the line under it, idle)
  const yi = i => I > 1 ? pad + i * (Hc - pad - pb) / (I - 1) : Hc / 2, yo = k => Hc * (k + 0.5) / O, yh = j => h > 1 ? pad + j * (Hc - 2 * pad) / (h - 1) : Hc / 2;
  // the dot under the pointer: ['i' | 'h' | 'o', index]
  let hov = null;
  if (cv._hx != null) {
    let bd = (big ? 14 : 10) ** 2;
    const near = (kind, n, px, py) => { for (let k = 0; k < n; k++) { const d = (cv._hx - px) ** 2 + (cv._hy - py(k)) ** 2; if (d < bd) { bd = d; hov = [kind, k]; } } };
    near('i', I, xi, yi); near('o', O, xo, yo); if (h) near('h', h, xh, yh);
    if (!hov && cv._hx < xi - 8) { const k = Math.round(I > 1 ? (cv._hy - pad) / ((Hc - pad - pb) / (I - 1)) : 0); if (k >= 0 && k < I) hov = ['i', k]; }   // or its name
  }
  const lit = (a, ka, b, kb) => !hov || (hov[0] === a && hov[1] === ka) || (hov[0] === b && hov[1] === kb);
  const edge = (x0, y0, x1, y1, v, on) => { const m = Math.min(1, Math.abs(v) / 1.5); g.strokeStyle = aiCol(v, (0.12 + 0.88 * m) * (on ? 1 : 0.12)); g.lineWidth = (big ? 0.6 : 0.5) + (big ? 4.5 : 3.5) * m; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
  // the pulls: live, value x weight; idle, the weights themselves
  if (!h) for (let i = 0; i < I; i++) for (let k = 0; k < O; k++) edge(xi, yi(i), xo, yo(k), w[k * I + i] * (x ? x[i] : 1), lit('i', i, 'o', k));
  else {
    for (let j = 0; j < h; j++) for (let i = 0; i < I; i++) edge(xi, yi(i), xh, yh(j), w[j * I + i] * (x ? x[i] : 1) * 0.7, lit('i', i, 'h', j));
    const w2 = I * h + h;
    for (let j = 0; j < h; j++) for (let k = 0; k < O; k++) edge(xh, yh(j), xo, yo(k), w[w2 + j * O + k] * (x ? aiHid[j] : 1), lit('h', j, 'o', k));
  }
  const node = (cx, cy, v, on) => { g.fillStyle = aiCol(v, 0.25 + 0.75 * Math.min(1, Math.abs(v))); g.beginPath(); g.arc(cx, cy, nr * (on ? 1.25 : 1), 0, 7); g.fill(); g.strokeStyle = on ? '#fff' : 'rgba(255,255,255,.6)'; g.lineWidth = on ? 2 : 1; g.stroke(); };
  const isHov = (a, k) => !!hov && hov[0] === a && hov[1] === k;
  for (let j = 0; j < h; j++) node(xh, yh(j), x ? aiHid[j] : 0, isHov('h', j));
  g.textBaseline = 'middle';
  // inputs, in real units: big, a table (name left, value by its dot); small, the value under the name
  const two = !big && I > 1 && (Hc - 2 * pad) / (I - 1) >= 18;
  for (let i = 0; i < I; i++) {
    const on = isHov('i', i), y = yi(i);
    node(xi, y, x ? clamp(x[i], -1, 1) : 0, on);
    g.font = big1; g.fillStyle = on ? '#fff' : 'rgba(255,255,255,.85)';
    if (big) {
      g.textAlign = 'left'; g.fillText(AI.names[i], 4, y);
      if (x) { g.font = small; g.textAlign = 'right'; g.fillStyle = 'rgba(255,255,255,.65)'; g.fillText(AI.shows[i](x[i]), xi - 14, y); }
    } else {
      g.textAlign = 'right'; g.fillText(AI.names[i], xi - 10, y - (x && two ? 4.5 : 0));
      if (x && two) { g.fillStyle = 'rgba(255,255,255,.6)'; g.font = small; g.fillText(AI.shows[i](x[i]), xi - 10, y + 5); }
    }
  }
  // outputs: what it does (like the keyboard, or no brake: what it applies, not what it computed)
  for (let k = 0; k < O; k++) {
    const v = x ? aiY[k] : 0, keyed = k < 2 && (k ? AI.kp : AI.ks), applied = keyed || (k === 1 && AI.nb), on = isHov('o', k);
    node(xo, yo(k), v, on);
    g.textAlign = 'left'; g.fillStyle = '#fff'; g.font = big1; g.fillText(AI_OUTS[k].name + (keyed ? ' ⌨' : ''), xo + nr + 8, yo(k) - (x ? fb * 0.6 : 0));
    if (x) { g.font = small; g.fillStyle = 'rgba(255,255,255,.75)'; g.fillText(AI_OUTS[k].fmt(applied ? AI.applied[k] : v), xo + nr + 8, yo(k) + fsm * 0.75); }
  }
  if (!x && !hov) { g.textAlign = 'center'; g.textBaseline = 'bottom'; g.font = small; g.fillStyle = 'rgba(255,255,255,.6)'; g.fillText(big ? 'its weights (orange +, blue −): Train or Drive it to see it think, live' : 'its weights: Train or Drive it to see it think', W / 2, Hc - 1); }
  if (!hov) return;
  // what the dot is: its explanation, its value, and its pulls on the outputs now
  const [kind, k] = hov, tb = `600 ${big ? 13 : 10}px system-ui, sans-serif`, tn = `${big ? 12 : 9.5}px system-ui, sans-serif`, rows = [];
  const sgn = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2);
  if (kind === 'i') {
    const d = AI.groups[k];
    rows.push([AI.names[k], tb], [AI_ABOUT[d.id] || d.tip, tn]);
    if (x) rows.push([`now: ${AI.shows[k](x[k])} (${sgn(x[k])} to the network)`, tn]);
    if (!h) rows.push([(x ? 'its pull now: ' : 'its weights: ') + AI_OUTS.slice(0, O).map((o, j) => `${o.name} ${sgn(w[j * I + k] * (x ? x[k] : 1))}`).join(', '), tn]);
  } else if (kind === 'o') {
    rows.push([AI_OUTS[k].name, tb], [AI_OUTS[k].about, tn]);
    if (x) rows.push([`now: ${AI_OUTS[k].fmt(aiY[k])} (${sgn(aiY[k])})`, tn]);
  } else {
    rows.push([`hidden unit ${k + 1} of ${h}`, tb], ['A feature of its own: a mix of the inputs it learned to look for, which the outputs then use.', tn]);
    if (x) rows.push([`now: ${sgn(aiHid[k])}`, tn]);
  }
  aiTipBox(g, cv._hx, cv._hy, W, Hc, rows, big ? 12 : 9.5);
}
// the full-screen view's lists: each input's value, each output's, live
function aiIoLive(live) {
  if (!AI.big) return;
  const x = live ? aiX : null, vals = {};
  for (let i = 0; i < AI.nIn; i++) { const id = AI.groups[i]?.id; if (id) (vals[id] = vals[id] || []).push(x ? AI.shows[i](x[i]) : ''); }
  AI.el.querySelectorAll('#aiIns .v').forEach(s => { const v = vals[s.dataset.v]; s.textContent = v && x ? v.join(' · ') : v ? 'on' : ''; });
  AI.el.querySelectorAll('#aiOuts .orow').forEach((r, k) => {
    const has = k < AI.nOut, keyed = k < 2 && (k ? AI.kp : AI.ks), v = !x || !has ? 0 : keyed || (k === 1 && AI.nb) ? AI.applied[k] : aiY[k];
    r.classList.toggle('off', !has);
    const b = r.querySelector('.bar i'), a = Math.min(1, Math.abs(v));
    b.style.left = (v >= 0 ? 50 : 50 - a * 50) + '%'; b.style.width = a * 50 + '%'; b.style.background = v >= 0 ? '#ff8a3d' : '#4aa8ff';
    r.querySelector('.v').textContent = !has ? 'not an output' : x ? AI_OUTS[k].fmt(v) : '';
  });
}

// before the world changes under it (called from regenerateWorld, also at boot, before AI exists)
function aiHalt(drive) { try { if (AI.training) aiTrain(false); if (drive && AI.drive) { AI.drive = false; aiShow(); } } catch (e) { } }
// in a race room: not on the grid or in a race (before our finish); there the others see none of it (mpFrame, mpSendHit)
const aiAllowed = () => !MP.on || !(MP.hold || ((MP.phase === 'countdown' || MP.phase === 'racing') && !MP.finished && !MP.spectator));
// for tests (the headless browser draws a frame a second): whole generations, now
function aiTrainSync(gens = 1, cfg) {
  if (cfg) {
    if (cfg.h != null && cfg.h !== AI.h) { AI.h = cfg.h; AI.key = ''; }
    if (cfg.inputs || cfg.hb != null || cfg.kp != null || cfg.ks != null || cfg.nb != null) { aiSetInputs(cfg.inputs || AI.inputs, cfg.hb ?? AI.hb, true, cfg.kp ?? AI.kp, cfg.ks ?? AI.ks, cfg.nb ?? AI.nb); AI.key = ''; }
    Object.assign(AI_CFG, cfg);
  }
  aiTrain(true);
  const g = AI.gen + gens;
  while (AI.gen < g) aiTick();
  aiTrain(false);
  return { gen: AI.gen, bestFit: AI.bestFit, bestLap: AI.bestLap, len: botPath().len, hist: AI.hist.slice(-gens) };
}
// one try with these weights (the best so far), as training drives it: how it ended
function aiTry(w, log = 0, race = false) {
  aiTrain(true);
  w = w || AI.best || AI.w;                                           // (after aiTrain: a change of exam re-examines the best first)
  if (race && aiRival()) aiStartEpisode(w, 0, AI_T, 0, 1, aiRaceScen()); else aiExamStart(w);   // race: the exam's race with the rival
  const trace = []; let fit = null, n = 0;
  while ((fit = aiStep()) == null) if (log && ++n % log === 0) trace.push([+AI.ep.t.toFixed(1), Math.round(AI.ep.st.dist), +AI.ep.st.lat.toFixed(1), +car.vel.length().toFixed(1), +car.steer.toFixed(2), +AI.ctl.throttle.toFixed(2), +AI.ctl.brake.toFixed(2), AI.ctl.handbrake ? 1 : 0]);
  const r = { ...AI.last, fit, trace };
  aiTrain(false);
  return r;
}

// ---------- the rival (#311): a second car of the same kind, with physics of its own ----------
// The physics drives one car (`car`, with VEH, ENG, PRESSURES, CAR_HW.., input and the frame vectors): the rival is a
// whole car's state kept aside and swapped in for its own steps (aiRvSwap twice puts things back), so it drives, hits and
// is dented by the same code as ours. A replay rival isn't driven: it follows a tape of its own drive, alone (aiRvRecord).
const AI_RV_KINDS = { catch: 'ahead, slower', side: 'alongside', behind: 'close behind', race: 'the race' };
// the rival's car: another of ours, or the one chosen (AI_CFG.rivalCar), which drives with its own best training on this
// course (aiBrainOf: none, no rival)
const aiRivalKey = () => AI_CFG.rivalCar && ROAD_CARS[AI_CFG.rivalCar] ? AI_CFG.rivalCar : VEH.key;
function aiRival() {
  const key = aiRivalKey();
  if (!ROAD_CARS[key]) return null;                                  // (the buggy: no second one to build)
  const own = key === VEH.key, ck = courseKey();
  if (AI.rv && AI.rv.key === key && AI.rv.ck === ck) return own || AI.rv.brain ? AI.rv : null;
  const brain = own ? null : aiBrainOf(key);
  if (!own && !brain) return null;
  if (AI.rv && AI.rv.key === key) { AI.rv.ck = ck; AI.rv.brain = brain; return AI.rv; }
  if (AI.rv) { if (AI.rv.in) aiRvSwap(AI.rv); scene.remove(AI.rv.V.vis); }
  const V = makeRoadVehicle(key); V.mpPaint = 0x1f6fff;            // blue: told apart from ours (and kept when its model loads)
  setPaint(V, V.mpPaint, false); if (MODELS[V.key]) loadModel(V); V.vis.visible = false;
  const c = { mass: V.mass, I: V.I.clone(), pos: new THREE.Vector3(), vel: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), steer: 0, throttle: 0, awd: V.awd, pIdx: V.pIdx, aids: car.aids,
    R: V.R, REST: V.REST, K: V.K, CB: V.CB, CR: V.CR, Iw: V.Iw, wheels: V.wheels, hull: V.hull, eng: { rpm: V.eng.idle, gear: 1, shiftT: 0, load: 0, cut: false, reverse: false, liftT: 9, lastPower: 0, popT: 0, tc: 1, sinceShift: 0 },
    dmg: { front: 0, rear: 0, left: 0, right: 0, roof: 0, under: 0 }, hullC: new Uint8Array(V.hull.length), grace: 0, wrecked: false, isRival: true, rivalCtl: { throttle: 0, brake: 0, steer: 0, handbrake: false } };
  return AI.rv = { key, ck, brain, V, c, keys: [...new Set([...Object.keys(car), ...Object.keys(c)])], VIS: V.vis, ENG: V.eng, P: V.pressures, box: V.box.slice(),
    inp: { throttle: 0, brake: 0, steer: 0, handbrake: false }, f: [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0)], hc: 1, hook: null, rhook: null,
    in: false, on: false, st: { i: -1, dist: 0, lat: 0 }, w: null, skill: 1, mode: 'car', tape: null, dAcc: 0 };
}
const aiRvTmp = new THREE.Vector3();
// another car's driver: its best training on this course in this browser (the fastest lap), as trained: its inputs, size
// and outputs (from the training's key), what it was shown (pace notes, line, look-ahead: from its exam's settings) and
// its own record lap as the demo (aiDemoNow, by the car in VEH); null if it has none
const AI_BRAIN = ['inputs', 'h', 'hb', 'kp', 'ks', 'nb', 'nIn', 'nOut', 'np', 'names', 'shows', 'demoKey', 'demo', 'lineFor', 'lineKey', 'line', 'paceFor', 'paceKey', 'paceV'];
const AI_BRAIN_CFG = ['pace', 'gCorner', 'gBrake', 'gAccel', 'racingLine', 'lineW', 'lookTime'];
function aiBrainOf(key) {
  const pre = `sandbuggy.ai.${courseKey()}.${key}.`; let best = null;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i); if (!k || !k.startsWith(pre)) continue;
    const m = k.slice(pre.length).match(/^(\d+)(?:\.(.+))?$/); if (!m || !AI_SIZES.includes(+m[1])) continue;
    const tok = m[2] ? m[2].split('+') : [], flags = ['hb', 'kp', 'ks', 'nobrake'];
    const inputs = m[2] ? tok.filter(t => !flags.includes(t)) : AI_DEFAULT_INPUTS;
    if (!inputs.length || !inputs.every(id => AI_INPUTS.some(d => d.id === id))) continue;
    let d; try { d = JSON.parse(localStorage.getItem(k)); } catch (e) { continue; }
    const hb = tok.includes('hb'), h = +m[1], sh = aiShape(inputs, hb, h);
    if (!d?.best || d.best.length !== sh.np || !(d.bestFit >= 0)) continue;
    if (best && (d.bestLap ?? Infinity) >= (best.lap ?? Infinity) && !(best.lap == null && d.bestFit > best.fit)) continue;
    const names = [], shows = [];
    for (const q of AI_INPUTS) if (inputs.includes(q.id)) q.names.forEach((nm, j) => { names.push(nm); shows.push(Array.isArray(q.show) ? q.show[j] : q.show); });
    const ex = String(d.exam || '').split(' '), cfg = {};
    for (const c of AI_BRAIN_CFG) cfg[c] = AI_CFG[c];
    if (ex.length >= 9 && Number.isFinite(+ex[1])) Object.assign(cfg, { pace: +ex[1], gCorner: +ex[2], gBrake: +ex[3], gAccel: +ex[4], racingLine: ex[5] !== '-', lineW: ex[5] === '-' ? AI_CFG.lineW : +ex[5], lookTime: ex[6] === 't' });
    best = { key: k, lap: d.bestLap ?? null, fit: d.bestFit, w: Float32Array.from(d.best), ai: { inputs, h, hb, kp: tok.includes('kp'), ks: tok.includes('ks'), nb: tok.includes('nobrake'), ...sh, names, shows, demoKey: null }, cfg };
  }
  return best;
}
// its driver in place of ours (twice: ours back)
function aiBrainSwap(b) {
  for (const k of AI_BRAIN) { const t = AI[k]; AI[k] = b.ai[k]; b.ai[k] = t; }
  for (const k of AI_BRAIN_CFG) { const t = AI_CFG[k]; AI_CFG[k] = b.cfg[k]; b.cfg[k] = t; }
}
function aiRvSwap(R) {
  if (!R.in) R.hc = 1;                                                 // (no messages for the rival's knocks)
  for (const k of R.keys) { const t = car[k]; car[k] = R.c[k]; R.c[k] = t; }
  let t = VEH; VEH = R.V; R.V = t; t = VIS; VIS = R.VIS; R.VIS = t; t = ENG; ENG = R.ENG; R.ENG = t; t = PRESSURES; PRESSURES = R.P; R.P = t;
  t = [CAR_HW, CAR_ZF, CAR_ZR]; [CAR_HW, CAR_ZF, CAR_ZR] = R.box; R.box = t;
  for (const k of ['throttle', 'brake', 'steer', 'handbrake']) { t = input[k]; input[k] = R.inp[k]; R.inp[k] = t; }
  [up, fwd, down].forEach((v, i) => { aiRvTmp.copy(v); v.copy(R.f[i]); R.f[i].copy(aiRvTmp); });
  t = hitCooldown; hitCooldown = R.hc; R.hc = t;
  t = carHitHook; carHitHook = R.hook; R.hook = t; t = carRepairHook; carRepairHook = R.rhook; R.rhook = t;   // (the room hears nothing of it)
  R.in = !R.in;
}
// placed (aiPlaceCar): its tracking and controls from scratch, on its tape's first pose if a replay
function aiRvReady(R) {
  R.st = { i: -1, dist: 0, lat: 0 }; R.c.rivalCtl = { throttle: 0, brake: 0, steer: 0, handbrake: false }; R.dAcc = 0;
  if (R.mode === 'replay') aiRvPose(R, 0);
  aiTrack(R.st, R.c.pos.x, R.c.pos.z);
}
// the rival's decision, with it in `car` (and the network view left as ours had it)
function aiRvAct(R, st) {
  const kx = aiX.slice(), ky = aiY.slice(), kh = aiHid.slice(), ka = AI.applied.slice(), kl = AI.lastCtl, kw = AI.viewW, kn = AI.nAct, kk = AI.look.slice(), kr = AI.rayEnds.slice();
  if (R.brain) aiBrainSwap(R.brain);
  const c = aiAct(R.w, st, AI_DT);
  if (R.brain) aiBrainSwap(R.brain);
  aiX.set(kx); aiY.set(ky); aiHid.set(kh); AI.applied[0] = ka[0]; AI.applied[1] = ka[1]; AI.lastCtl = kl; AI.viewW = kw; AI.nAct = kn; AI.look = kk; AI.rayEnds = kr;
  return { throttle: c.throttle * R.skill, brake: c.brake, steer: c.steer, handbrake: c.handbrake };   // (skill < 1: a slower one)
}
// its decision in a drive with ours (mySt: ours), seeing ours as ours sees it
function aiRvDecide(R, mySt) {
  aiRvSwap(R); AI.other = { st: mySt, vel: R.c.vel };                  // (ours is the one kept aside now)
  car.rivalCtl = aiRvAct(R, R.st);
  aiRvSwap(R); AI.other = { st: R.st, vel: R.c.vel };
}
// one physics step of it (a car), and the two cars' contact; E counts the impacts, each by the blame of ours
function aiRvSub(R, E, mySt, dt) {
  if (R.mode === 'car') { aiRvSwap(R); stepCar(dt); collideGates(dt); aiRvSwap(R); }
  const vn = aiCarContact(R);
  if (vn == null) { E.touching = false; return; }
  if (vn > 0.3) {
    const g = aiGap(R.st.i - mySt.i);
    E.contact += vn * (g > 1.5 ? 0.75 : g < -1.5 ? 0.25 : 0.5);       // behind it: mostly ours; ahead: a little (no braking in its way)
    if (!E.touching) E.touches++;
  }
  E.touching = true;
}
// after a step (k: steps so far): its grace runs down; a replay moves on along its tape
function aiRvLate(R, k, dt) {
  R.c.grace = Math.max(0, R.c.grace - dt);
  if (R.mode === 'replay') { aiRvPose(R, k); aiTrack(R.st, R.c.pos.x, R.c.pos.z); }
}
// metres along the line, wrapped to the nearer way round (from path indices apart)
function aiGap(di) { const Pt = botPath(), L = Pt.len, g = di * Pt.ds; return ((g % L) + L * 1.5) % L - L / 2; }
// the tape of a replay rival: its own drive, alone (it sees no other), from d m along the line, lat m to the left; a pose
// (position, rotation, velocity) every AI_DT for limit s, or until it has gone upto m
function aiRvRecord(R, d, lat, roll, limit, upto = Infinity) {
  if (AI.freshC) { H.set(B); C.set(AI.freshC); } else if (AI.snapH) { H.set(AI.snapH); C.set(AI.snapC); }
  const keep = AI.other, n = Math.ceil(limit / AI_DT) + 1, T = new Float32Array(n * 10), st = { i: -1, dist: 0, lat: 0 };
  AI.other = null; aiRvSwap(R); repairCar(); aiPlaceCar(d, lat, false, false, roll);
  let acc = 0, k = 0;
  for (; k < n; k++) {
    const p = car.pos, q = car.q, v = car.vel; T.set([p.x, p.y, p.z, q.x, q.y, q.z, q.w, v.x, v.y, v.z], k * 10);
    if (st.dist > upto) break;
    car.rivalCtl = aiRvAct(R, st); readInput(AI_DT);
    acc += AI_DT; while (acc >= DT) { stepCar(DT); collideGates(DT); acc -= DT; }
    car.grace = Math.max(0, car.grace - AI_DT);
  }
  aiRvSwap(R); AI.other = keep;
  return T.slice(0, Math.min(k + 1, n) * 10);
}
function aiRvPose(R, k) {
  const T = R.tape; if (!T) return;
  const m = Math.min(k, T.length / 10 - 1) * 10, c = R.c;
  c.pos.set(T[m], T[m + 1], T[m + 2]); c.q.set(T[m + 3], T[m + 4], T[m + 5], T[m + 6]); c.vel.set(T[m + 7], T[m + 8], T[m + 9]); c.w.set(0, 0, 0);
}
// Car against car, as the bots' contact (two circles along each car), but both pushed, by their masses (a replay: only
// ours, it doesn't give); dents on both (aiCarDent). The impact speed (m/s), or null when they don't touch
const aiCQ = new THREE.Quaternion(), aiCN = new THREE.Vector3(), aiCV = new THREE.Vector3();
function aiCarContact(R) {
  const b = R.c, kin = R.mode === 'replay';
  if (Math.abs(car.pos.y - b.pos.y) > 1.6) return null;
  const fl = Math.hypot(fwd.x, fwd.z) || 1, fax = fwd.x / fl, faz = fwd.z / fl, qb = b.q;
  const bx = 2 * (qb.x * qb.z + qb.w * qb.y), bz = 1 - 2 * (qb.x * qb.x + qb.y * qb.y), bl = Math.hypot(bx, bz) || 1, fbx = bx / bl, fbz = bz / bl;
  const [hwB, zfB, zrB] = R.box;
  const hlA = Math.max(0.6, (CAR_ZF - CAR_ZR) / 2 - 0.9), pcA = (CAR_ZF + CAR_ZR) / 2, hlB = Math.max(0.6, (zfB - zrB) / 2 - 0.9), pcB = (zfB + zrB) / 2;
  const lim = Math.max(0.9, CAR_HW) + Math.max(0.9, hwB) - 0.15;
  let best = null;
  for (const sa of [-1, 1]) for (const sb of [-1, 1]) {
    const la = pcA + sa * hlA, lb = pcB + sb * hlB, dx = car.pos.x + fax * la - (b.pos.x + fbx * lb), dz = car.pos.z + faz * la - (b.pos.z + fbz * lb), dd = Math.hypot(dx, dz);
    if (dd < lim && (!best || dd < best.dd)) best = { dd, dx, dz, la, lb };
  }
  if (!best) return null;
  const nl = best.dd || 1e-3, nx = best.dx / nl, nz = best.dz / nl, pen = lim - best.dd, ma = car.mass, mb = b.mass, sa = kin ? 1 : mb / (ma + mb);
  car.pos.x += nx * pen * sa; car.pos.z += nz * pen * sa;
  if (!kin) { b.pos.x -= nx * pen * (1 - sa); b.pos.z -= nz * pen * (1 - sa); }
  const vn = -((car.vel.x - b.vel.x) * nx + (car.vel.z - b.vel.z) * nz);
  if (vn <= 0) return vn;
  const J = vn * 1.25 * (kin ? ma : ma * mb / (ma + mb)), ja = J / ma;   // the impulse (a little bounce)
  car.vel.x += nx * ja; car.vel.z += nz * ja;
  car.w.y += (fax * best.la * nz - faz * best.la * nx) * -ja * 0.12;
  if (!kin) { const jb = J / mb; b.vel.x -= nx * jb; b.vel.z -= nz * jb; b.w.y += (fbx * best.lb * -nz - fbz * best.lb * -nx) * -jb * 0.12; }
  if (vn > 1.5) { aiCarDent(nx, nz, best.la, vn); if (!kin) { aiRvSwap(R); aiCarDent(-nx, -nz, best.lb, vn); aiRvSwap(R); } }
  return vn;
}
// the car in `car` struck at l m along its axis, from where n points (from the other car to it)
function aiCarDent(nx, nz, l, vn) {
  if (car.grace > 0) return;
  aiCQ.copy(car.q).invert(); aiCN.set(nx, 0, nz).applyQuaternion(aiCQ); aiCV.set(-aiCN.x * CAR_HW, 0.45, l - aiCN.z * 0.9);
  const zone = Math.abs(aiCN.z) >= Math.abs(aiCN.x) ? (aiCN.z < 0 ? 'front' : 'rear') : (aiCN.x < 0 ? 'left' : 'right');
  addDamage(zone, (vn - 1.5) ** 2 * 0.012); carHit(aiCV, aiCN, vn, HIT.ball);
  audio?.node.port.postMessage({ crash: Math.min(1, vn * 0.1) });
  if (hitCooldown <= 0 && !car.wrecked) { hitCooldown = 0.6; flash(`Contact with the rival · ${zone} damage ${Math.round(car.dmg[zone] * 100)}%`, '#ff9a6a', 1.8); }
}
// a generation's meeting with the rival (AI_CFG.rivalShare of them): ahead and slower (to catch and pass), alongside, or
// close behind (no braking in front of it); against one of the earlier bests (AI.rvPool), or the best
function aiScenario() {
  if (AI_CFG.rival === 'off' || !aiRival() || Math.random() >= AI_CFG.rivalShare) return null;
  const k = Math.floor(Math.random() * 3), rnd = Math.random, sd = rnd() < 0.5 ? 1 : -1, g = Math.min(2.2, aiHalfW() * 0.4);
  const sc = k === 0 ? { kind: 'catch', gap: 6 + rnd() * 19, lat: (rnd() - 0.5) * 3, myLat: 0, skill: 0.8 + rnd() * 0.13 }
    : k === 1 ? { kind: 'side', gap: (rnd() - 0.5) * 4, lat: g * sd, myLat: -g * sd, skill: 0.93 + rnd() * 0.07 }
    : { kind: 'behind', gap: -(6 + rnd() * 12), lat: (rnd() - 0.5) * 3, myLat: 0, skill: 1 };
  const P = AI.rvPool; sc.w = P.length ? (rnd() < 0.5 ? P[P.length - 1] : P[Math.floor(rnd() * P.length)]) : AI.best || AI.w;
  return sc;
}
// the rivals: a copy of the best every AI_CFG.rivalEvery generations (the last 4 kept); the newest is the exams' race,
// so the best races it at once (its score was against an older one)
function aiRvKeep() {
  if (AI_CFG.rival === 'off' || !AI.best || !aiRival() || AI.rv.brain) return;   // (another car: its own driver, not ours)
  if (AI.rvPool.length && AI.gen % AI_CFG.rivalEvery) return;
  AI.rvPool.push(Float32Array.from(AI.best)); if (AI.rvPool.length > 4) AI.rvPool.shift();
  const keep = AI.last, kr = AI.lastRace;
  if (AI.bestSolo == null) { const x = aiExamRun(AI.best); AI.bestFit = x.fit; AI.bestSolo = x.solo; }
  else { aiStartEpisode(AI.best, 0, AI_T, 0, 1, aiRaceScen()); while (aiStep() == null) { } AI.ep = null; AI.bestFit = AI.bestSolo - aiRaceCost(AI.last); }
  AI.last = keep; AI.lastRace = kr;
}
// Race it, each frame: (after ours decided, from simulate) the rival decides every AI_DT as trained, and takes its controls
function aiRvFrame(dt) {
  const R = AI.rv, E = AI.race; if (!E || !R) return;
  if (!AI.drive) { AI.race = null; AI.other = null; R.on = false; aiShow(); return; }
  if (R.mode === 'replay') { E.t += dt; return; }
  R.dAcc += dt;
  if (R.dAcc >= AI_DT) { R.dAcc = Math.min(R.dAcc - AI_DT, AI_DT); aiRvDecide(R, AI.dst); }
  aiRvSwap(R); readInput(dt); aiRvSwap(R);
}
function aiRvFrameLate(dt) {
  const R = AI.rv, E = AI.race; if (!E || !R) return;
  aiRvLate(R, Math.round(E.t / AI_DT), dt);
  AI.other = { st: R.st, vel: R.c.vel };
}
// the rival's body where its state is (a frame, before ours: the sun follows ours)
function aiRvSync() {
  const R = AI.rv; if (!R) return;
  const show = R.on && !ed.on && !rp.on && (AI.training ? !!AI.ep?.rv : !!AI.race);
  R.V.vis.visible = show;
  if (show) { aiRvSwap(R); syncVisual(); aiRvSwap(R); }
  const el = AI.el.querySelector('#aiRaceInfo');
  if (AI.race && AI.dst && (AI.race.infoT = (AI.race.infoT || 0) + 1) % 10 === 0) {
    const g = Math.round(AI.dst.dist - R.st.dist), n = AI.race.touches;
    el.textContent = `Race against the ${ROAD_CARS[R.key].short || ROAD_CARS[R.key].name}: ${g >= 0 ? 'ahead by' : 'behind by'} ${Math.abs(g)} m · ${n ? `${n} contact${n > 1 ? 's' : ''}` : 'no contact'}`;
  } else if (!AI.race && el.textContent) el.textContent = '';
}
// the last exam's race, for the panel
const aiRaceLine = L => !L ? '' : `<br>Race: ${L.why === 'lap' ? 'finished' : L.at + ' m'}${L.rival ? ` · ${L.rival.touches ? `${L.rival.touches} contact${L.rival.touches > 1 ? 's' : ''} (−${L.rival.cpen})` : 'clean'} · ${L.rival.gain >= 0 ? 'ahead by' : 'behind by'} ${Math.abs(L.rival.gain)} m` : ''}`;

// ---------- the panel (I): a column on the left, or the whole screen (⤢) ----------
document.head.insertAdjacentHTML('beforeend', `<style>
  #aiPanel{display:none;left:12px;top:250px;width:270px;overflow:auto;pointer-events:auto;z-index:3}
  #aiPanel .aiHd{display:flex;align-items:flex-start;gap:8px} #aiPanel .aiHd>div{flex:1;min-width:0}
  #aiPanel .lt{font-size:12px;letter-spacing:2px;opacity:.85}
  #aiPanel .sub{font-size:11px;opacity:.7;margin-bottom:6px}
  #aiPanel .st{font-variant-numeric:tabular-nums;margin:4px 0;font-size:12px}
  #aiPanel canvas{display:block;width:100%;height:64px;margin:4px 0}
  #aiPanel button{font:inherit;font-size:12px;font-weight:700;border:0;border-radius:6px;padding:6px 10px;margin:0;cursor:pointer;color:#fff;background:#ffffff26}
  #aiPanel button:hover{background:#ffffff40} #aiPanel button.on{background:#ff5a00} #aiPanel button:disabled{opacity:.4;cursor:default;background:#ffffff1a}
  #aiPanel #aiTrain{background:#ff5a0099} #aiPanel #aiTrain:hover,#aiPanel #aiTrain.on{background:#ff5a00}
  #aiPanel button.ic{padding:2px 8px;font-size:15px;line-height:1.3;background:#ffffff1a}
  #aiPanel .grp{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px} #aiPanel .gh{display:none}
  #aiPanel .aiKpi{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;margin:6px 0}
  #aiPanel .aiKpi>div{background:#ffffff12;border-radius:6px;padding:3px 6px;min-width:0}
  #aiPanel .aiKpi .k{font-size:9px;letter-spacing:.6px;text-transform:uppercase;opacity:.65;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #aiPanel .aiKpi .v{font-size:15px;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #aiPanel .aiKpi .u{font-size:.6em;font-weight:600;opacity:.7;margin-left:2px} #aiPanel .aiKpi .s{font-size:10px;opacity:.65;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #aiPanel .aiBigOnly,#aiPanel .h2,#aiPanel .hint,#aiPanel .io .v,#aiPanel #aiOuts,#aiPanel .aiCtlBox{display:none}
  #aiPanel details{margin-top:8px} #aiPanel summary{cursor:pointer;font-weight:700;font-size:12px}
  #aiPanel .h3{font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;opacity:.75;margin:8px 0 2px}
  #aiPanel .note{font-size:11px;opacity:.65}
  #aiPanel label{display:flex;align-items:center;gap:6px;font-size:12px;margin:3px 0;cursor:pointer}
  #aiPanel .pen{font-size:12px} #aiPanel .pen label,#aiPanel label.num{justify-content:space-between}
  #aiPanel input[type=number],#aiPanel select{font:inherit;font-size:12px;background:#ffffff1f;color:#fff;border:1px solid #ffffff40;border-radius:4px;padding:1px 4px}
  #aiPanel input[type=number]{width:58px} #aiPanel select option{color:#000}
  #aiPanel #aiServer{margin-top:6px;max-height:220px;overflow:auto;border-top:1px solid #ffffff30}
  #aiPanel .srv{display:flex;align-items:center;gap:4px;padding:4px 0;border-bottom:1px solid #ffffff1a} #aiPanel .srv .si{flex:1;min-width:0;font-size:12px}
  #aiPanel .srv b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap} #aiPanel .srv .sub{margin:0}
  #aiPanel .srv button{margin:0;padding:4px 8px}
  #aiPanel small{display:block;opacity:.7;margin-top:6px;font-size:11px;line-height:1.35}
  /* the whole screen */
  #aiPanel.big{display:flex!important;flex-direction:column;inset:12px;width:auto;max-height:none;padding:14px 18px 12px;z-index:20;overflow:hidden;
    background:rgba(14,11,8,.94);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border-radius:12px;font-size:14px;text-shadow:none;box-shadow:0 10px 40px #0009}
  #aiPanel.big .aiHd{align-items:center;margin-bottom:10px} #aiPanel.big .lt{font-size:15px;font-weight:700}
  #aiPanel.big .sub{font-size:12.5px;margin-bottom:4px} #aiPanel.big .aiHd .sub{margin:2px 0 0}
  #aiPanel.big button.ic{font-size:13px;padding:7px 12px}
  #aiPanel.big .aiBody{flex:1;min-height:0;display:grid;grid-template-columns:minmax(300px,340px) minmax(0,1fr) minmax(330px,410px);gap:14px}
  #aiPanel.big .aiLeft,#aiPanel.big #aiCfg{min-height:0;overflow:auto;margin:0;padding-right:4px}
  #aiPanel.big #aiCfg>summary{display:none}
  #aiPanel.big .aiMid{min-height:0;display:grid;grid-template-rows:minmax(0,1.6fr) minmax(0,1fr);gap:14px}
  #aiPanel.big .aiBox{background:#ffffff09;border:1px solid #ffffff14;border-radius:10px;padding:10px 12px;min-height:0;display:flex;flex-direction:column}
  #aiPanel.big .aiChartBox{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  #aiPanel.big .aiCv{position:relative;flex:1;min-height:0} #aiPanel.big .aiCv canvas{position:absolute;inset:0;width:100%;height:100%;margin:0}
  #aiPanel.big .aiBigOnly{display:block} #aiPanel.big .h2{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px;font-weight:700;font-size:13px;margin-bottom:6px}
  #aiPanel.big .h2 span{font-weight:400;font-size:12px;opacity:.7} #aiPanel.big .h2 i{display:inline-block;width:14px;height:3px;border-radius:2px;vertical-align:middle;margin-right:4px}
  #aiPanel.big .aiKpi{gap:8px;margin:0 0 10px} #aiPanel.big .aiKpi>div{padding:8px 10px;border-radius:8px}
  #aiPanel.big .aiKpi .k{font-size:10.5px} #aiPanel.big .aiKpi .v{font-size:21px;line-height:1.3} #aiPanel.big .aiKpi .s{font-size:11.5px}
  #aiPanel.big .st{font-size:13px} #aiPanel.big .gh{display:block;flex-basis:100%;font-size:10.5px;letter-spacing:1px;text-transform:uppercase;opacity:.55;margin-top:8px}
  #aiPanel.big .grp{gap:6px} #aiPanel.big .grp button{font-size:13px;padding:8px 12px}
  #aiPanel.big .aiCtlBox.live{display:block;margin:10px 0 0;background:#ffffff09;border-radius:10px} #aiPanel.big .aiCtlBox canvas{height:auto;aspect-ratio:560/250;margin:0}
  #aiPanel.big .card{background:#ffffff09;border:1px solid #ffffff14;border-radius:10px;padding:8px 12px 10px;margin:0 0 10px}
  #aiPanel.big .h3{font-size:11px;margin:2px 0 6px;opacity:.85}
  #aiPanel.big label{font-size:13px;flex-wrap:wrap;margin:6px 0}
  #aiPanel.big .hint{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;flex-basis:100%;font-size:11.5px;line-height:1.35;opacity:.58;margin-top:-2px}
  #aiPanel.big label:has(input[type=checkbox]) .hint{padding-left:22px} #aiPanel.big label:hover .hint{-webkit-line-clamp:unset;opacity:.75}
  #aiPanel.big .io .nm{font-weight:600} #aiPanel.big .io .v{display:block;margin-left:auto;font-size:12px;opacity:.8;font-variant-numeric:tabular-nums;max-width:55%;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #aiPanel.big #aiOuts{display:block}
  #aiPanel.big .orow{display:grid;grid-template-columns:76px 1fr 92px;align-items:center;gap:4px 10px;margin:6px 0}
  #aiPanel.big .orow .nm{font-weight:600;font-size:13px} #aiPanel.big .orow .v{font-size:12px;opacity:.8;text-align:right;font-variant-numeric:tabular-nums}
  #aiPanel.big .orow .hint{grid-column:1/-1;padding:0} #aiPanel.big .orow.off{opacity:.45}
  #aiPanel.big .bar{position:relative;height:8px;background:#ffffff18;border-radius:4px} #aiPanel.big .bar::after{content:'';position:absolute;left:50%;top:-2px;bottom:-2px;width:1px;background:#ffffff70}
  #aiPanel.big .bar i{position:absolute;top:0;bottom:0;border-radius:4px}
  #aiPanel.big small{font-size:11.5px} #aiPanel.big .aiHelp{display:none}
</style>`);
AI.el = document.createElement('div'); AI.el.id = 'aiPanel'; AI.el.className = 'panel';
AI.el.innerHTML = `<div class="aiHd"><div><div class="lt">AUTOPILOT</div><div class="sub" id="aiSize"></div></div>
  <button id="aiBig" class="ic" title="Full screen: the network, the charts and every setting, explained (Esc: back)">⤢</button></div>
  <div class="aiBody">
  <section class="aiLeft">
    <div class="aiKpi" id="aiKpi"></div>
    <div class="st" id="aiStat"></div><div class="sub" id="aiRate"></div><div class="sub" id="aiRaceInfo"></div>
    <div class="grp"><div class="gh">Training</div><button id="aiTrain">Train</button><button id="aiWatch" title="Run the training at real speed, with the sound, to watch every try (it learns no differently, only slower)">Watch at 1×</button><button id="aiBack" title="Carry on training from the best weights so far (the exam's best lap), not from where training wandered to">Back to the best</button><button id="aiH" title="The network's size: inputs straight to the outputs, or a hidden layer of 8 between">Size</button><button id="aiReset">Start over</button></div>
    <div class="grp"><div class="gh">Its best, at the wheel</div><button id="aiDrive">Drive it</button><button id="aiRace" title="Drive it against a rival: another of this car alongside on the grid, driven by the best network too (as Train's rival below: a replay of its own laps, or a car that reacts; a car if none is set)">Race it</button></div>
    <div class="grp"><div class="gh">Keep it</div><button id="aiSaveF" title="Download this training (the weights, the generations, the chart) as a file">Save to file</button><button id="aiLoadF" title="Load a training saved to a file">Load file</button><button id="aiSaveS" title="Save this training on the server, under a name: you, or anyone, can load it there">Save to server</button><button id="aiLoadS" title="The autopilots saved on the server: load one (yours or anyone's), delete yours">From server</button></div>
    <div id="aiServer" style="display:none"></div>
    <input type="file" id="aiFile" accept=".json,application/json" style="display:none">
    <div class="aiCtlBox"><canvas id="aiCtlBig" width="560" height="250"></canvas></div>
  </section>
  <section class="aiMid">
    <div class="aiBox aiNetBox"><div class="h2">What it sees → what it does <span><i style="background:#ff8a3d"></i>pushes + (left, gas)</span><span><i style="background:#4aa8ff"></i>pushes − (right, brake)</span><span>thicker: stronger · hover a dot</span></div>
      <div class="aiCv"><canvas id="aiNet" title="Each line: an input's pull on an output right now (its value × its weight). Orange pushes + (steer left, throttle), blue − (steer right, brake); thicker, stronger. Hover a dot for what it is"></canvas></div></div>
    <div class="aiBox aiChartBox"><div class="aiCv"><canvas id="aiChart"></canvas></div><div class="aiCv aiBigOnly"><canvas id="aiChart2"></canvas></div></div>
  </section>
  <details id="aiCfg"><summary>Inputs, outputs and penalties</summary>
    <div class="card"><div class="h3">Inputs: what it sees</div><div id="aiIns"></div></div>
    <div class="card"><div class="h3">Outputs: what it does</div><div id="aiOuts">${AI_OUTS.map(o => `<div class="orow"><span class="nm">${o.name}</span><span class="bar"><i></i></span><span class="v"></span><span class="hint">${o.about}</span></div>`).join('')}</div>
    <label title="A third output: on above 0 (it starts off, and learns when, if ever)"><input type="checkbox" id="aiHb"> handbrake (a 3rd output)</label>
    <label title="Unticked: the pedal output is gas or nothing (below 0, off). No brake pedal: it slows by lifting off, or with the handbrake if it has one (a training of its own, starting from this one)"><input type="checkbox" id="aiBrk"> brake (unticked: gas or nothing)</label>
    <label title="The pedal output snapped to what W and S give: full throttle above +⅓, nothing between, full brake below −⅓"><input type="checkbox" id="aiKp"> pedals like the keyboard: full gas, off or full brake</label>
    <label title="The steering output snapped to what A and D give: full left above +⅓, straight between, full right below −⅓"><input type="checkbox" id="aiKs"> steering like the keyboard: full left, straight or full right</label></div>
    <div class="card pen"><div class="h3">Rewards and penalties</div><div class="note">metres added to or taken off a drive's score</div>
      <label title="Added for each km/h of its average speed along the line (speed already pays: more metres in a try's 15 s, and 5 m a second saved on an exam lap)">+ speed, a km/h on average <input type="number" id="aiPen_speed" min="0" max="50" step="0.5"></label>
      <label title="Off for each metre driven beyond its progress along the racing line: running wide and weaving cost, a tight line doesn't">− extra path, a metre <input type="number" id="aiPen_path" min="0" max="20" step="0.1"></label>
      <label title="Off for each full swing of the steering or pedal output (their changes added up: lock to lock is 2): jerky driving costs">− jerky, a full swing <input type="number" id="aiPen_smooth" min="0" max="100" step="0.5"></label>
      <label title="Off for each metre it drives off the course (the tarmac on road, between the gate posts off it)">− off the road, a metre <input type="number" id="aiPen_offRoad" min="0" max="20" step="0.5"></label>
      <label title="Off for the damage it takes: from 100 % to a wreck is this much">− damage, a wreck's worth <input type="number" id="aiPen_damage" min="0" max="1000" step="10"></label>
      <label title="Off for wrecking the car (on top of the damage), and the try ends there">− wrecked <input type="number" id="aiPen_wreck" min="0" max="1000" step="10"></label></div>
    <div class="card pen"><div class="h3">A rival car</div>
      <label title="None: it drives alone. A replay: the rival drives its own lap (as if alone) and doesn't react; ours learns to keep off it, follow and pass. A car: both drive at once and see each other, the rival reacts, and they push and dent each other. With one, part of the tries start beside it, catching it (a slower one), or with it close behind, and every exam is also a race of a lap alongside it, scored on its impacts, damage and finishing. Give the network the rival inputs, so it can see it"><select id="aiRival"><option value="off">none</option><option value="replay">a replay (doesn't react)</option><option value="car">a car (reacts, pushes)</option></select></label>
      <label style="justify-content:space-between" title="The same car as ours, driven by earlier bests of this network; or another, driven by its own best training on this course in this browser (train one with it first), as it was trained (its inputs, its pace notes and line, its record lap)">rival car <select id="aiRivalCar"><option value="">the same as mine</option>${Object.keys(ROAD_CARS).map(k => `<option value="${k}">${ROAD_CARS[k].name}</option>`).join('')}</select></label>
      <label title="The share of generations whose tries meet the rival (the others drive alone, for the pace)">share of generations with it <input type="number" id="aiRivalShare" min="0" max="1" step="0.1"></label>
      <label title="Off for each m/s of every impact with the rival: the car behind takes 3/4 of the blame, alongside half each (so braking in front of it costs too)">− contact, an m/s of impact <input type="number" id="aiPen_contact" min="0" max="500" step="1"></label>
      <label title="Added for each metre gained on the rival over a try or the race (lost: taken off). 0: it races only the clock">+ a metre gained on it <input type="number" id="aiPen_gain" min="0" max="10" step="0.1"></label></div>
    <div class="card"><div class="h3">Racing line and pace notes</div>
      <label title="Steer by, and take the pace notes from, the smoothest line within the road (out, clip the inside, out again) instead of the course's centre"><input type="checkbox" id="aiRL"> follow a racing line, not the centre</label>
      <label title="Where the line is looked at: 6, 15 and 30 m ahead, or 0.3, 0.7 and 1.4 s ahead at its speed (at least 3, 6, 12 m): one steering for every speed"><input type="checkbox" id="aiLT"> look ahead by time, not metres</label>
      <label style="justify-content:space-between" title="How far either side of the centre the racing line may go (0: the road's edge less 1.6 m, so the car stays on it; more: onto the verge, as drivers do)">racing line: room either side, m <input type="number" id="aiLW" min="0" max="15" step="0.5"></label>
      <label style="justify-content:space-between" title="How hard the car can speed up, for the pace notes (0: as fast as the bends allow at once)">pace notes: acceleration g <input type="number" id="aiGa" min="0" max="2" step="0.05"></label>
      <label style="justify-content:space-between" title="The grip the pace notes count on in bends, on tarmac (the bots': 0.84 g; sand and earth in proportion). Bends go with its square root">pace notes: cornering g <input type="number" id="aiGc" min="0.2" max="2" step="0.02"></label>
      <label style="justify-content:space-between" title="The grip the pace notes count on braking for a bend, on tarmac (the bots': 0.76 g)">pace notes: braking g <input type="number" id="aiGb" min="0.2" max="2" step="0.02"></label>
      <label style="justify-content:space-between" title="The pace note's speeds (the bots': 0.84 g of cornering grip on tarmac, 0.39 on sand) times this: a grippier car can take the line faster. Bends go with the square root of grip: ×1.15 for 1.1 g">pace note × <input type="number" id="aiPace" min="0.5" max="2" step="0.05"></label></div>
    <div class="card"><div class="h3">Tries, exams and when to stop</div>
      <label title="Tries away from the start line begin at 85% of the pace note's speed there, not from a standstill: more practice at speed"><input type="checkbox" id="aiRoll"> tries start rolling</label>
      <label title="Each generation's exam (the lap that picks the best) is a flying lap: two laps in a row from the start line, the second timed, as Drive it's laps after the first (and a driver's best lap) are: at speed across the line, on the ground the first lap wore, with its knocks. Not one lap from a standstill"><input type="checkbox" id="aiFly"> exams are flying laps</label>
      <label style="justify-content:space-between" title="Flying exams: so many timed laps in a row after the first, the slowest counting (and the knocks of each carried into the next): a network that is quick for a lap and then loses it scores its bad lap">flying laps an exam times <input type="number" id="aiExamLaps" min="1" max="5" step="1"></label>
      <label style="justify-content:space-between" title="A try ends (and loses the 100 m for ending badly) this far from the racing line. Wider gives it room for its own line, and to go astray">end a try this far from the line, m <input type="number" id="aiOff" min="3" max="30" step="1"></label>
      <label style="justify-content:space-between" title="Each Train (or Train more) runs this many generations, then stops (0: until you pause it)">train this many generations at a time <input type="number" id="aiGens" min="0" max="10000" step="10"></label>
      <label style="justify-content:space-between" title="Once it laps: stop training when that many generations in a row bring no better lap (0: never stop)">stop after generations without a better lap <input type="number" id="aiStopAfter" min="0" max="1000" step="5"></label></div>
    <small>Each set of inputs and outputs is a network, and a training, of its own (the others are kept). Penalties apply from the next try.</small>
  </details>
  <small class="aiHelp">Watch at 1× runs the training at real speed (with sound) to follow each try. The diagram: what it sees (left) and does (right), live while it trains or drives; each line is an input's pull on
  an output, orange + (left, throttle), blue − (right, brake), thicker stronger; hover a dot for what it is. On the track, the 3 points it looks at.
  Learns on this course with this car, ${AI_CFG.pop} tries a generation, and remembers it in this browser. Charts: each generation's exam score
  (orange) and its tries' average (blue), dashed a lap; once it laps, its lap times (faster higher), dashed the best. Hover them for the values.
  ⤢ shows it all on the whole screen, with every setting explained. <b>I</b> hides this.</small>
  </div>`;
document.body.appendChild(AI.el);
AI.el.querySelector('#aiTrain').addEventListener('click', e => { e.currentTarget.blur(); aiTrain(!AI.training); });
AI.el.querySelector('#aiDrive').addEventListener('click', e => { e.currentTarget.blur(); aiDrive(!(AI.drive && !AI.race)); });
AI.el.querySelector('#aiRace').addEventListener('click', e => { e.currentTarget.blur(); aiDrive(!(AI.drive && AI.race), true); });
// inputs, outputs and penalties (typing in the panel isn't driving: its keys stop here)
AI.el.addEventListener('keydown', e => { if (e.target.matches('input')) e.stopPropagation(); });
AI.el.querySelector('#aiIns').innerHTML = AI_INPUTS.map(d => `<label class="io" title="${d.tip}"><input type="checkbox" data-in="${d.id}"> <span class="nm">${d.names.length > 2 ? `${d.id === 'rays' ? 'edge rays' : d.id} (${d.names.length})` : d.names.join(', ')}</span><span class="v" data-v="${d.id}"></span><span class="hint">${AI_ABOUT[d.id] || ''}</span></label>`).join('');
// the full-screen view shows what each setting does (its tip), under it
AI.el.querySelectorAll('#aiCfg label[title]').forEach(l => { if (!l.querySelector('.hint')) l.insertAdjacentHTML('beforeend', `<span class="hint">${l.title}</span>`); });
AI.el.querySelector('#aiBig').addEventListener('click', e => { e.currentTarget.blur(); aiBig(); });
addEventListener('keydown', e => { if (e.code === 'Escape' && AI.big) { e.stopImmediatePropagation(); e.preventDefault(); aiBig(false); } }, true);
addEventListener('resize', () => { if (AI.big) aiShow(); });
AI.ctlBig = AI.el.querySelector('#aiCtlBig'); AI.ctlBox = AI.el.querySelector('.aiCtlBox');
// hovering the diagram and the charts: the dot or generation under the pointer
for (const id of ['#aiNet', '#aiChart', '#aiChart2']) {
  const cv = AI.el.querySelector(id), chart = id !== '#aiNet';
  cv.addEventListener('mousemove', e => { cv._hx = e.offsetX; cv._hy = e.offsetY; if (chart) aiChartsDraw(); });
  cv.addEventListener('mouseleave', () => { cv._hx = cv._hy = null; if (chart) aiChartsDraw(); });
}
// the whole screen, or the column
function aiBig(on = !AI.big) {
  if (on && !AI.open) aiToggle();
  if (on === !!AI.big) return;
  AI.big = on; AI.el.classList.toggle('big', on);
  for (const id of ['#aiNet', '#aiChart', '#aiChart2']) { const cv = AI.el.querySelector(id); cv._hx = cv._hy = null; }   // (the pointer was over the other layout)
  const d = AI.el.querySelector('#aiCfg');
  if (on) { AI.cfgWas = d.open; d.open = true; } else d.open = !!AI.cfgWas;
  const b = AI.el.querySelector('#aiBig'); b.textContent = on ? '⤡ Back to the column' : '⤢'; b.title = on ? 'Back to the column on the left (Esc)' : 'Full screen: the network, the charts and every setting, explained (Esc: back)';
  aiShow(); aiVizT = 1;
}
AI.el.querySelector('#aiCfg').addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.in || t.id === 'aiHb' || t.id === 'aiKp' || t.id === 'aiKs' || t.id === 'aiBrk') {
    const ins = [...AI.el.querySelectorAll('[data-in]')].filter(c => c.checked).map(c => c.dataset.in);
    if (!ins.length) { t.checked = true; return; }
    aiSetInputs(ins, AI.el.querySelector('#aiHb').checked, false, AI.el.querySelector('#aiKp').checked, AI.el.querySelector('#aiKs').checked, !AI.el.querySelector('#aiBrk').checked);
  } else if (t.id === 'aiRival') {
    AI_CFG.rival = AI_RV_MODES.includes(t.value) ? t.value : 'off'; aiKeepConfig();
    if (AI_CFG.rival !== 'off' && !aiRival()) flash(aiRivalWhyNot(), '#ffd88a', 3);
    else if (AI_CFG.rival !== 'off' && !AI.inputs.includes('rival')) flash('Tick the rival inputs too, so it can see it', '#9fd4ff', 2.5);
  } else if (t.id === 'aiRivalCar') {
    AI_CFG.rivalCar = ROAD_CARS[t.value] ? t.value : ''; aiKeepConfig(); if (AI.rv) AI.rv.ck = null;
    if (!aiRival()) flash(aiRivalWhyNot(), '#ffd88a', 3);
    else if (AI.rv.brain) flash(`The ${ROAD_CARS[AI.rv.key].name}: its own autopilot${AI.rv.brain.lap != null ? `, a lap in ${fmt(AI.rv.brain.lap)}` : ''}`, '#9fd4ff', 2.5);
  } else if (t.id === 'aiRivalShare') {
    const v = +t.value; if (Number.isFinite(v) && v >= 0 && v <= 1) { AI_CFG.rivalShare = v; aiKeepConfig(); }
  } else if (t.id === 'aiRoll') {
    AI_CFG.rolling = t.checked; aiKeepConfig();
  } else if (t.id === 'aiFly') {
    AI_CFG.flying = t.checked; aiKeepConfig();
  } else if (t.id === 'aiLT') {
    AI_CFG.lookTime = t.checked; aiKeepConfig();
  } else if (t.id === 'aiRL') {
    AI_CFG.racingLine = t.checked; aiKeepConfig();
  } else if (t.id === 'aiLW') {
    const v = +t.value; if (Number.isFinite(v) && v >= 0 && v <= 15) { AI_CFG.lineW = v; aiKeepConfig(); }
  } else if (t.id === 'aiGa') {
    const v = +t.value; if (Number.isFinite(v) && v >= 0 && v <= 2) { AI_CFG.gAccel = v; aiKeepConfig(); }
  } else if (t.id === 'aiGc' || t.id === 'aiGb') {
    const v = +t.value; if (Number.isFinite(v) && v >= 0.2 && v <= 2) { AI_CFG[t.id === 'aiGc' ? 'gCorner' : 'gBrake'] = v; aiKeepConfig(); }
  } else if (t.id === 'aiPace') {
    const v = +t.value; if (Number.isFinite(v) && v >= 0.5 && v <= 2) { AI_CFG.pace = v; aiKeepConfig(); }
  } else if (t.id === 'aiExamLaps') {
    const v = Math.round(+t.value); if (v >= 1 && v <= 5) { AI_CFG.examLaps = v; aiKeepConfig(); }
  } else if (t.id === 'aiOff') {
    const v = +t.value; if (Number.isFinite(v) && v >= 3 && v <= 30) { AI_CFG.off = v; aiKeepConfig(); }
  } else if (t.id === 'aiGens') {
    const v = Math.round(+t.value); if (Number.isFinite(v) && v >= 0) { AI.gens = v; aiKeepConfig(); if (AI.training) AI.genEnd = AI.gen + v; }
  } else if (t.id === 'aiStopAfter') {
    const v = Math.round(+t.value); if (Number.isFinite(v) && v >= 0) { AI.stopAfter = v; aiKeepConfig(); }
  } else if (t.id.startsWith('aiPen_')) {
    const v = +t.value; if (Number.isFinite(v) && v >= 0) { AI_PEN[t.id.slice(6)] = v; aiKeepConfig(); }
  }
  if (AI.training && AI.examKind !== aiExamKind()) { aiTrain(false); aiTrain(true); }   // (the best takes the new exam)
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
  return { kind: 'carsim-autopilot', version: 2, vehicle: VEH.key, vehicleName: VEH.name, course: courseKey(), ground: groundName(), h: AI.h, inputs: AI.inputs, handbrake: AI.hb, keyPedals: AI.kp, keySteering: AI.ks, noBrake: AI.nb, weights: AI.np,
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
  AI.drive = false; AI.h = d.h; aiSetInputs(ins, !!d.handbrake, true, !!d.keyPedals, !!d.keySteering, !!d.noBrake); aiLoad();   // this course, car, size and inputs: replaced by it
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
  try { await aiSaveServer(name, d); } catch (err) { flash(err.message, '#ff8a7a', 3); }
});
// this training saved on the server under a name (the button asks for it; __sim.aiSaveServer, the Claude bridge's way)
async function aiSaveServer(name, d = aiExport()) {
  name = String(name || '').trim();
  if (!name) throw new Error('Give it a name');
  const r = await aiApi('', { method: 'POST', body: JSON.stringify({ name, training: d }) });
  flash(`Saved on the server: ${name}`, '#9fd4ff', 2); if (AI.listOpen) aiServerList();
  return r;
}
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
AI.el.querySelector('#aiBack').addEventListener('click', e => { e.currentTarget.blur(); aiBackToBest(); });
AI.el.querySelector('#aiReset').addEventListener('click', e => {
  e.currentTarget.blur();
  if (!confirm(`Forget what the autopilot learnt with the ${VEH.name} on this course?`)) return;
  const was = AI.training; aiForget(); if (was) aiTrain(true);
});
// Start over without asking (__sim.aiForget, the Claude bridge's way): this course, car and inputs' training forgotten
function aiForget() {
  if (AI.training) aiTrain(false);
  AI.drive = false; try { localStorage.removeItem(aiKey()); } catch (err) { } aiLoad(); aiShow();
  return { key: AI.key, gen: AI.gen };
}
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
  if (AI.open && AI.big) aiBig(false);
  AI.open = !AI.open;
  if (AI.open && aiKey() !== AI.key && !AI.training) aiLoad();
  AI.el.style.display = AI.open ? 'block' : 'none'; AI.btn.classList.toggle('on', AI.open);
  aiShow();
}
function aiShow() {
  if (!AI.open) return;
  const y0 = document.getElementById('hud').getBoundingClientRect().bottom + 10, help = document.getElementById('help');   // under the car's read-out, over the help
  if (AI.big) { if (AI.el.style.top) AI.el.style.top = AI.el.style.maxHeight = ''; }
  else { AI.el.style.top = y0 + 'px'; AI.el.style.maxHeight = ((help.offsetHeight ? help.getBoundingClientRect().top - 10 : innerHeight - 12) - y0) + 'px'; }
  const len = botPath().len, pct = f => Math.min(100, Math.round(f / len * 100));
  const best = AI.bestFit < 0 ? 'nothing yet' : AI.bestLap != null ? `a full lap in ${fmt(AI.bestLap)}${AI.sinceBest ? ` <span style="opacity:.7">(${AI.sinceBest} generation${AI.sinceBest > 1 ? 's' : ''} ago${AI.stopAfter ? `; stops at ${AI.stopAfter}` : ''})</span>` : ''}` : `${Math.round(AI.bestFit)} m of ${Math.round(len)} m (${pct(AI.bestFit)} %)`;
  AI.el.querySelector('#aiSize').textContent = `${AI.h ? 'a tiny neural network' : 'the smallest network'}: ${AI.nIn} inputs ${AI.h ? `→ ${AI.h} hidden →` : 'straight to'} ${AI.nOut} outputs, ${AI.np} weights${AI.kp || AI.ks ? ` · ${[AI.kp && 'pedals', AI.ks && 'steering'].filter(Boolean).join(' and ')} like the keyboard` : ''}${AI.nb ? ' · no brake' : ''}`;
  AI.el.querySelector('#aiH').textContent = AI.h ? 'Smaller net' : 'Bigger net';
  AI.el.querySelectorAll('[data-in]').forEach(c => { c.checked = AI.inputs.includes(c.dataset.in); });
  AI.el.querySelector('#aiHb').checked = AI.hb; AI.el.querySelector('#aiKp').checked = AI.kp; AI.el.querySelector('#aiKs').checked = AI.ks; AI.el.querySelector('#aiBrk').checked = !AI.nb;
  for (const k in AI_PEN) { const f = AI.el.querySelector('#aiPen_' + k); if (document.activeElement !== f) f.value = AI_PEN[k]; }
  { const f = AI.el.querySelector('#aiStopAfter'); if (document.activeElement !== f) f.value = AI.stopAfter; }
  { const f = AI.el.querySelector('#aiGens'); if (document.activeElement !== f) f.value = AI.gens; }
  { const f = AI.el.querySelector('#aiOff'); if (document.activeElement !== f) f.value = AI_CFG.off; }
  { const f = AI.el.querySelector('#aiExamLaps'); if (document.activeElement !== f) f.value = AI_CFG.examLaps; }
  { const f = AI.el.querySelector('#aiPace'); if (document.activeElement !== f) f.value = AI_CFG.pace; }
  { const f = AI.el.querySelector('#aiRivalShare'); if (document.activeElement !== f) f.value = AI_CFG.rivalShare; }
  AI.el.querySelector('#aiRival').value = AI_CFG.rival; AI.el.querySelector('#aiRivalCar').value = AI_CFG.rivalCar;
  AI.el.querySelector('#aiRL').checked = AI_CFG.racingLine; AI.el.querySelector('#aiLT').checked = AI_CFG.lookTime; AI.el.querySelector('#aiRoll').checked = AI_CFG.rolling; AI.el.querySelector('#aiFly').checked = AI_CFG.flying;
  for (const [id, k] of [['#aiGc', 'gCorner'], ['#aiGb', 'gBrake'], ['#aiGa', 'gAccel'], ['#aiLW', 'lineW']]) { const f = AI.el.querySelector(id); if (document.activeElement !== f) f.value = AI_CFG[k]; }
  const L = AI.lastExam;
  // the three numbers: the generation, the best so far, the last exam
  const sec = t => t < 60 ? `${t.toFixed(2)}<span class="u">s</span>` : fmt(t).slice(0, -1);
  const kpi = (k, v, sub, tip) => `<div title="${tip}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${sub || '&nbsp;'}</div></div>`;
  AI.el.querySelector('#aiKpi').innerHTML =
    kpi('Generation', AI.gen, AI.training ? (AI.gens ? `training, to ${AI.genEnd}` : 'training') : AI.gen ? 'paused' : 'not trained', `${AI_CFG.pop} tries a generation, then an exam: a lap from the start`)
    + kpi('Best', AI.bestFit < 0 ? '—' : AI.bestLap != null ? sec(AI.bestLap) : `${pct(AI.bestFit)}<span class="u">%</span>`, AI.bestFit < 0 ? 'nothing yet' : AI.bestLap != null ? 'a full lap' : `${Math.round(AI.bestFit)} of ${Math.round(len)} m`, 'The best exam so far: its lap time, or how far round it got')
    + kpi('Last exam', !L ? '—' : L.why === 'lap' && L.lap != null ? sec(L.lap) : `${L.at}<span class="u">m</span>`, AI.bestLap != null && AI.sinceBest ? `${AI.sinceBest} since the best` : L ? (L.why === 'lap' ? 'a lap' : 'stopped there') : '', 'The latest generation\'s exam, and how long since the best got better');
  AI.el.querySelector('#aiStat').innerHTML = `${AI.training ? `<b>${AI.exam ? `Exam: a ${AI_CFG.flying ? 'flying ' : ''}lap from the start` : `Try ${AI.ci + 1} of ${AI_CFG.pop}${AI.cands && AI.from != null ? ` from ${Math.round(AI.from)} m` : ''}${AI.cands && AI.scen ? ` · rival ${AI_RV_KINDS[AI.scen.kind]}` : ''}`}${AI.examSolo ? ' · the race with the rival' : ''}</b>` : AI.drive ? `<b>${AI.race ? 'Racing' : 'Driving'} its best</b>` : best === 'nothing yet' ? 'Train it: it starts knowing nothing' : AI.big ? `Best: ${AI.bestLap != null ? fmt(AI.bestLap) : best}${AI.sinceBest ? ` <span style="opacity:.7">(${AI.sinceBest} generation${AI.sinceBest > 1 ? 's' : ''} ago${AI.stopAfter ? `; training stops at ${AI.stopAfter}` : ''})</span>` : ''}` : `Best: ${best}`}${L ? `<br><span style="opacity:.75">Last exam: ${L.why === 'lap' ? 'a lap' : L.at + ' m'}${L.offM ? ` · ${L.offM} m off the road` : ''}${L.dmg ? ` · damage ${L.dmg} %` : ''}${L.wrecked ? ' · wrecked' : ''}${L.kmh ? ` · ${L.kmh} km/h` : ''}${L.swing ? ` · ${L.swing} swings` : ''}${L.hb ? ` · handbrake ${L.hb} s` : ''}${L.extra ? ` · ${L.extra} m extra path` : ''}${L.pen ? ` · ${L.pen > 0 ? '−' + L.pen : '+' + -L.pen}` : ''}${aiRaceLine(AI.lastExamRace)}</span>` : ''}`;
  AI.el.querySelector('#aiTrain').textContent = AI.training ? 'Pause' : AI.gen ? 'Train more' : 'Train';
  AI.el.querySelector('#aiTrain').classList.toggle('on', AI.training);
  AI.el.querySelector('#aiDrive').textContent = AI.drive && !AI.race ? 'Stop driving' : 'Drive it';
  AI.el.querySelector('#aiRace').textContent = AI.drive && AI.race ? 'Stop the race' : 'Race it';
  AI.el.querySelector('#aiRace').classList.toggle('on', !!(AI.drive && AI.race));
  AI.el.querySelector('#aiRace').disabled = AI.bestFit < 0;
  AI.el.querySelector('#aiWatch').textContent = AI.watch ? 'Full speed' : 'Watch at 1×';
  AI.el.querySelector('#aiWatch').classList.toggle('on', !!AI.watch);
  AI.el.querySelector('#aiDrive').classList.toggle('on', AI.drive && !AI.race);
  AI.el.querySelector('#aiDrive').disabled = AI.bestFit < 0;
  AI.el.querySelector('#aiBack').disabled = !AI.best;
  AI.el.querySelector('#aiSaveF').disabled = AI.el.querySelector('#aiSaveS').disabled = !AI.gen;
  aiChartsDraw();
}
// the charts, over the generations: a line each, the value under the pointer
const AI_C1 = '#d9621a', AI_C2 = '#3d97ee';                           // (both read on the dark panel, and apart for colour-blind eyes)
function aiPlot(cv, o) {
  const c = aiCanvas(cv); if (!c) return;
  const { g, W, H } = c, big = AI.big, fs = big ? 12 : 9.5, f = wt => `${wt} ${fs}px system-ui, sans-serif`;
  const n = o.xs.length, L = big ? 52 : 34, R = big ? 10 : 4, T = big ? 26 : 15, Bm = big ? 22 : 13, pw = W - L - R, ph = H - T - Bm;
  g.textBaseline = 'middle'; g.textAlign = 'left'; g.font = f(600); g.fillStyle = 'rgba(255,255,255,.88)'; g.fillText(o.title, 0, T / 2 - 2);
  // the legend, right of the title when there is room
  { g.font = f(400); let lx = W - R; const tw = g.measureText(o.title).width + 16, items = [...o.series].reverse(), need = items.reduce((a, s) => a + g.measureText(s.name).width + 22, 0);
    if (o.series.length > 1 && lx - need > tw) for (const s of items) {
      g.textAlign = 'right'; g.fillStyle = 'rgba(255,255,255,.7)'; g.fillText(s.name, lx, T / 2 - 2); lx -= g.measureText(s.name).width + 5;
      g.strokeStyle = s.col; g.lineWidth = 2.5; g.setLineDash(s.dash || []); g.beginPath(); g.moveTo(lx - 12, T / 2 - 2); g.lineTo(lx, T / 2 - 2); g.stroke(); g.setLineDash([]); lx -= 22;
    } }
  const all = o.series.flatMap(s => s.vals).filter(v => v != null && Number.isFinite(v));
  if (!n || !all.length) { g.textAlign = 'center'; g.font = f(400); g.fillStyle = 'rgba(255,255,255,.5)'; g.fillText(o.empty, W / 2, T + ph / 2); return; }
  // the scale: round steps, a little room above and below
  let lo = Math.min(...all, o.ref ? o.ref.v : Infinity), hi = Math.max(...all, o.ref ? o.ref.v : -Infinity);
  if (hi - lo < o.minSpan) { const m = (hi + lo) / 2; lo = m - o.minSpan / 2; hi = m + o.minSpan / 2; }
  const raw = (hi - lo) / (big ? 4 : 2), p10 = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map(m => m * p10).find(m => m >= raw);
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const y = v => T + (o.invert ? v - lo : hi - v) / (hi - lo) * ph, xs = i => L + (n > 1 ? i / (n - 1) * pw : pw / 2);
  g.font = f(400); g.lineWidth = 1;
  for (let v = lo; v <= hi + step / 2; v += step) {
    g.strokeStyle = 'rgba(255,255,255,.08)'; g.beginPath(); g.moveTo(L, Math.round(y(v)) + 0.5); g.lineTo(W - R, Math.round(y(v)) + 0.5); g.stroke();
    g.textAlign = 'right'; g.fillStyle = 'rgba(255,255,255,.5)'; g.fillText(o.tick(v), L - 6, y(v));
  }
  // the generations along the bottom
  g.textBaseline = 'top'; g.fillStyle = 'rgba(255,255,255,.5)';
  const gx = [0, n - 1]; if (big && n > 8) gx.splice(1, 0, Math.round((n - 1) / 3), Math.round((n - 1) * 2 / 3));
  [...new Set(gx)].forEach((i, k, a) => { g.textAlign = n === 1 ? 'center' : k === 0 ? 'left' : k === a.length - 1 ? 'right' : 'center'; g.fillText((big && k === 0 ? 'gen. ' : '') + o.xs[i], xs(i), H - Bm + 4); });
  g.textBaseline = 'middle';
  if (o.ref) {                                                         // the dashed line: a lap, the best
    g.strokeStyle = 'rgba(255,255,255,.4)'; g.setLineDash([5, 5]); g.beginPath(); g.moveTo(L, y(o.ref.v)); g.lineTo(W - R, y(o.ref.v)); g.stroke(); g.setLineDash([]);
    g.textAlign = 'left'; g.fillStyle = 'rgba(255,255,255,.6)'; g.fillText(o.ref.label, L + 4, y(o.ref.v) + (y(o.ref.v) - T < fs + 2 ? fs * 0.8 : -fs * 0.8));
  }
  for (const s of o.series) {
    g.strokeStyle = s.col; g.fillStyle = s.col; g.lineWidth = big ? 2 : 1.5; g.setLineDash(s.dash || []); g.beginPath(); let on = false, py = 0;
    s.vals.forEach((v, i) => {
      if (v == null) { on = false; return; }
      if (!on) g.moveTo(xs(i), y(v)); else if (s.step) { g.lineTo(xs(i), py); g.lineTo(xs(i), y(v)); } else g.lineTo(xs(i), y(v));
      on = true; py = y(v);
    });
    g.stroke(); g.setLineDash([]);
    if (s.dots && n <= (big ? 90 : 40)) s.vals.forEach((v, i) => { if (v != null) { g.beginPath(); g.arc(xs(i), y(v), big ? 2.5 : 1.8, 0, 7); g.fill(); } });
  }
  // the generation under the pointer: a crosshair, its values
  if (cv._hx == null || cv._hx < L - 4 || cv._hx > W - R + 4) return;
  const i = n > 1 ? clamp(Math.round((cv._hx - L) / pw * (n - 1)), 0, n - 1) : 0, x = xs(i);
  g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(Math.round(x) + 0.5, T); g.lineTo(Math.round(x) + 0.5, T + ph); g.stroke();
  for (const s of o.series) { const v = s.vals[i]; if (v == null) continue; g.fillStyle = s.col; g.strokeStyle = 'rgba(14,11,8,1)'; g.lineWidth = 2; g.beginPath(); g.arc(x, y(v), big ? 4.5 : 3.5, 0, 7); g.fill(); g.stroke(); }
  const tb = f(600), tn = f(400);
  aiTipBox(g, x, cv._hy ?? T, W, H, [[`Generation ${o.xs[i]}`, tb], ...o.series.map(s => [`${s.name}: ${s.vals[i] == null ? '—' : o.fmt(s.vals[i])}`, tn]), ...(o.more ? [[o.more(i), tn]] : [])].filter(r => r[0]), fs);
}
function aiChartsDraw() {
  if (!AI.open) return;
  const len = botPath().len, Hs = AI.big ? AI.hist : AI.hist.slice(-120), g0 = AI.gen - Hs.length + 1, xs = Hs.map((h, i) => g0 + i);
  const laps = Hs.map(h => h[2] ?? null), m = v => `${Math.round(v).toLocaleString('en')} m`;
  const score = { xs, title: AI.big ? 'Exam score' : 'exam score', series: [{ name: 'exam', col: AI_C1, vals: Hs.map(h => h[0]) }, { name: 'tries’ average', col: AI_C2, vals: Hs.map(h => h[1]) }],
    ref: { v: len, label: `a lap: ${m(len)}` }, tick: v => Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v) + '', fmt: m, minSpan: 50, empty: 'Train it: each generation shows here',
    more: i => Hs[i][2] != null ? `lap: ${fmt(Hs[i][2])}` : '' };
  let best = Infinity; const bestSo = laps.map(t => t == null ? (best < Infinity ? best : null) : (best = Math.min(best, t)));
  const lapc = { xs, title: AI.big ? 'Exam lap time' : `lap times · best ${fmt(AI.bestLap)}`, series: [{ name: 'exam lap', col: AI_C1, vals: laps, dots: true }, { name: 'best so far', col: AI_C2, vals: bestSo, step: true }],
    invert: true, tick: t => t >= 60 ? fmt(t).slice(0, -2) : t.toFixed(t < 10 ? 2 : 1) + ' s', fmt, minSpan: 2, empty: 'No full lap yet: its lap times show here once it laps',
    ref: AI.bestLap != null && !AI.big ? { v: AI.bestLap, label: `best ${fmt(AI.bestLap)}` } : null };   // (full screen: the best so far is a line)
  if (!AI.big) { const lapping = AI.bestLap != null && laps.some(t => t != null); if (lapping) lapc.series = lapc.series.slice(0, 1); aiPlot(AI.el.querySelector('#aiChart'), lapping ? lapc : score); return; }
  aiPlot(AI.el.querySelector('#aiChart'), score); aiPlot(AI.el.querySelector('#aiChart2'), lapc);
}

"""

rep("""
// boot
setTimeout(() => {""", BLOCK + """
// boot
setTimeout(() => {""")
# the controls: the policy's while it trains or drives
rep("""  const o = window.__sim?.override;""", """  const o = car.isRival ? car.rivalCtl : aiInput(dt) || window.__sim?.override;   // (the rival's, swapped in: aiRvSwap)""")
# the rival's car (swapped in): no wreck screen, no repair of ours
rep("""function wreck() {
  car.wrecked = true;
""", """function wreck() {
  car.wrecked = true;
  if (car.isRival) return;
""")
rep("""  car.wrecked = false; document.getElementById('wreck').style.display = 'none';""", """  car.wrecked = false; if (!car.isRival) document.getElementById('wreck').style.display = 'none';""")
# Race it: the rival drives along with ours
rep("""function simulate(dt) {
  readInput(dt);
  acc += dt;
  let n = 0;
  while (acc >= DT && n < 10) { stepCar(DT); collideGates(DT); acc -= DT; n++; }
  updateBots(dt);""", """function simulate(dt) {
  readInput(dt);
  aiRvFrame(dt);
  acc += dt;
  let n = 0;
  while (acc >= DT && n < 10) { stepCar(DT); collideGates(DT); if (AI.race) aiRvSub(AI.rv, AI.race, AI.dst, DT); acc -= DT; n++; }
  aiRvFrameLate(dt);
  updateBots(dt);""")
rep("""  syncVisual(); syncBots(); mpFrame(dt);""", """  aiRvSync(); syncVisual(); syncBots(); mpFrame(dt);""")
# the frame: training instead of the player's driving
rep("""  else if (!window.__sim.paused) simulate(dt);""", """  else if (AI.training) aiTrainFrame(dt);
  else if (!window.__sim.paused) simulate(dt);""")
rep("""  if (e.code === 'KeyY') { rp.on ? stopReplay() : startReplay(); return; }""",
    """  if (e.code === 'KeyI') { aiToggle(); return; }
  if (e.code === 'KeyY') { rp.on ? stopReplay() : startReplay(); return; }""")
# the ground as built, before any wheel wore it: every try starts on it
rep("""  if (!graded) for (const op of COURSE.ops) applyOp(op, false);
  H.set(B);
}""", """  if (!graded) for (const op of COURSE.ops) applyOp(op, false);
  H.set(B);
  aiFreshGround();
}""")
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
  Object.assign(window.__sim, { aiDemo, aiSaveServer, aiForget });
  if (BOTS.n) setBots(BOTS.n);""")
open(ep, 'w').write(s)

h = open(hp).read()
a = """<b>Y</b> replay &nbsp;"""
assert h.count(a) == 1
h = h.replace(a, """<b>Y</b> replay &nbsp; <b>I</b> autopilot (a tiny neural network learns to drive) &nbsp;""")
open(hp, 'w').write(h)
print('autopilot patched')
