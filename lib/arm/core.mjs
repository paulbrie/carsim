// The arm sim's world (#359): a desk arm with a two-finger gripper, a table, cubes, and what each scenario asks. No
// page in here and no drawing (components/arm-sim.tsx draws what `pose()` says): it runs the same in a tab, in a worker
// and in Node, and the same drive gives the same numbers to the last digit. The physics is MuJoCo (the official
// WebAssembly build, @mujoco/mujoco), given as M (what `await loadMujoco()` returns).
// Outside, metres, seconds and radians with y up (the picture's axes), the table's top at y = 0 and the arm's base at
// 0, 0; inside, MuJoCo's own axes (z up): `out3` / `in3` turn one into the other.
//
// The arm: a base that turns (q0), a shoulder (a1, the upper arm's angle above the horizontal), an elbow (e, the angle
// the forearm is folded down from the upper arm), a wrist that keeps the tool hanging straight down, and the tool's own
// turn (q3: as seen from above, so the fingers keep their direction on the table while the base turns). Every joint is a real one with a motor (a position servo of limited force): what is ordered is where the
// joints should be (`qt`, moved at their top speeds within their limits and above the table) and how fast they should
// be moving, and the arm follows as its motors and its weight let it. Nothing is glued: a cube is held by the fingers' friction. Two things that took
// measuring (#359): the two fingers are geared together (an equality), or a cube held by two motors of equal force
// drifts along their travel; and the fingers' pads and the cubes touch as stiffly as the step allows (`pad`), or the
// cube slides 16 mm across the pads each time the arm starts or stops (MuJoCo's contacts give way a little, friction
// included).
export const ARM = {
  S: 0.12, L1: 0.26, L2: 0.26, TL: 0.10,                    // shoulder's height, upper arm, forearm, wrist to the grip
  speed: [2.5, 2.5, 2.5, 4],                               // the joints' top speeds, rad/s: base, shoulder, elbow, tool
  hand: 0.5,                                               // m/s: the hand's speed at a full output, when the hand is driven
  lim: { q0: [-2.7, 2.7], a1: [-0.3, 1.9], e: [0.35, 2.75] },
  home: [0, 1.35, 1.7, 0],
  floor: 0.022,                                            // the grip's centre is never ordered lower (the fingertips: 2 mm)
};
export const HZ = 60, STEP = 1 / 360, SUB = 6;             // decisions a second; the physics' step; steps a decision (at 240 Hz a carried cube slid 5 mm at each start, at 360 Hz 1 mm)
export const OPEN = 0.045, TRAVEL = 0.039, GRIP_N = 20;    // a finger's place from the grip's centre when open; its travel; its motor's force
export const CUBE = 0.05, LIFT = 0.15;
export const TRAY = { r: 0.3, a: 1.7, half: 0.07 };
const HC = CUBE / 2;

/** What a network can be shown: id → how many numbers and what they are. All in the arm's own frame: away from the
 *  base, up, and sideways (the way the base turns), so a cube to the left is the cube to the right turned. "The cube"
 *  is the one the scenario wants moved now. */
export const INPUTS = {
  cube: { n: 3, parts: ['cube: out', 'cube: up', 'cube: side'], name: 'The cube from the grip', about: 'how far the cube to move now is from the middle of the fingers: outwards, upwards, sideways (1 = 20 cm)' },
  gap: { n: 1, parts: ['fingers'], name: 'Fingers', about: 'how far apart the fingers are: −1 shut, 1 wide open' },
  height: { n: 1, parts: ['height'], name: 'Height', about: 'how high the grip is above the table' },
  beam: { n: 1, parts: ['between'], name: 'Something between the fingers', about: '1 while that cube is between the fingers (a gripper’s light beam), else 0' },
  touch: { n: 1, parts: ['squeezing'], name: 'Squeezing', about: '1 while the fingers are closed on that cube, else 0' },
  goal: { n: 3, parts: ['goal: out', 'goal: up', 'goal: side'], name: 'Where it goes, from the cube', about: 'how far the cube is from where it has to go (the tray, the top of the stack): outwards, upwards, sideways (1 = 30 cm)' },
  there: { n: 1, parts: ['in place'], name: 'It is in place', about: '1 while that cube is where it has to go (in the tray, on the cube below), still held or not; else 0' },
  turn: { n: 2, parts: ['angle: sin', 'angle: cos'], name: 'The cube’s angle', about: 'how the cube is turned against the fingers (two numbers, the same every quarter turn)' },
  joints: { n: 3, parts: ['shoulder', 'elbow', 'reach'], name: 'Its own joints', about: 'the shoulder, the elbow and how far the grip is from the base' },
};
/**
 * The scenarios. cubes: how many are on the table; jobs: what has to be done, in order (lift: hold the cube 15 cm up;
 * to 'tray': put it in the tray; on: put it on that other cube); limit: seconds for the whole of it; exam: how many
 * placements the exam has.
 */
export const TASKS = {
  grab: { name: 'Pick up', about: 'Lift the cube 15 cm off the table and hold it for half a second.', cubes: 1, limit: 5, exam: 20, jobs: [{ cube: 0, lift: true }], inputs: ['cube', 'gap', 'height', 'beam', 'touch'] },
  tray: { name: 'Into the tray', about: 'Pick the cube up and put it down in the tray.', cubes: 1, limit: 8, exam: 20, jobs: [{ cube: 0, to: 'tray' }], inputs: ['cube', 'gap', 'height', 'beam', 'touch', 'goal', 'there'] },
  stack: { name: 'Stack four', about: 'Put the four cubes on top of each other: the second on the first, the third on the second, the fourth on top.', cubes: 4, limit: 30, exam: 10, jobs: [{ cube: 1, on: 0 }, { cube: 2, on: 1 }, { cube: 3, on: 2 }], inputs: ['cube', 'gap', 'height', 'beam', 'touch', 'goal', 'there'] },
};
export const SIZES = [0, 2, 4, 6, 8, 12, 16, 24, 32];

const cl = (v, a, b) => v < a ? a : v > b ? b : v;
/** MuJoCo's x, y, z (z up) as the picture's (y up), and back. */
const out3 = (x, y, z) => [x, z, -y], in3 = v => [v[0], -v[2], v[1]];

/** A seeded dice (mulberry32): the same placements for everyone. */
export function dice(seed) {
  let s = seed >>> 0;
  const f = () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  f.gauss = () => Math.sqrt(-2 * Math.log(1 - f())) * Math.cos(2 * Math.PI * f());
  return f;
}
/**
 * Where a scenario's cubes are put: { cubes: [{ r from the base, a round it (as q0), yaw its own turn }] }, each at
 * least 13 cm from the others. For a training: start 'cube' begins with the open fingers already round the first
 * cube to move; stacked: n begins with that many jobs already done (cubes on the stack).
 */
export function placement(rnd, task = 'grab', turned = false) {
  const cubes = [];
  for (let n = 0; cubes.length < TASKS[task].cubes && n < 400; n++) {
    const c = { r: 0.2 + rnd() * 0.22, a: -1 + rnd() * 2, yaw: turned ? (rnd() - 0.5) * Math.PI / 2 : 0 };
    if (cubes.every(o => Math.hypot(c.r * Math.cos(c.a) - o.r * Math.cos(o.a), c.r * Math.sin(c.a) - o.r * Math.sin(o.a)) >= 0.13)) cubes.push(c);
  }
  return { cubes };
}
/** The exam's placements: the same for everyone (per scenario). */
export function examPlacements(task = 'grab', n = TASKS[task].exam) { const rnd = dice({ grab: 3359, tray: 7402, stack: 9154 }[task]); return Array.from({ length: n }, () => placement(rnd, task)); }

/** Where joints [q0, a1, e, q3] put the wrist and the grip (r from the base, y above the table; x, z the picture's; yaw: the fingers' direction, q3). */
export function reach(q) {
  const a2 = q[1] - q[2], r = ARM.L1 * Math.cos(q[1]) + ARM.L2 * Math.cos(a2), y = ARM.S + ARM.L1 * Math.sin(q[1]) + ARM.L2 * Math.sin(a2);
  return { r, wrist: y, y: y - ARM.TL, x: r * Math.cos(q[0]), z: -r * Math.sin(q[0]), yaw: q[3] };
}
/** The joints that put the grip r from the base, y above the table, a round it (the elbow up). */
export function joints(r, y, a = 0) {
  const h = y + ARM.TL - ARM.S, d = Math.min(Math.hypot(r, h), ARM.L1 + ARM.L2 - 1e-6), { L1, L2 } = ARM;
  const a1 = Math.atan2(h, r) + Math.acos(cl((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1)), e = Math.PI - Math.acos(cl((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
  return [a, a1, e, 0];
}

// ---------------------------------------------------------------- the network
/** How many outputs a network has, and how many weights. */
export function shape(net) {
  const nin = net.inputs.reduce((n, id) => n + INPUTS[id].n, 0), nout = 4 + (net.roll ? 1 : 0), h = net.h | 0;
  return { nin, nout, h, weights: h ? nin * h + h + h * nout + nout : nin * nout + nout };
}
/** A network of nothing but zeros for a scenario: where a training starts. */
export function blank(task = 'grab', { h = 8, control = 'hand', roll = false, inputs } = {}) {
  const net = { kind: 'armsim-network', task, control, roll: !!roll, inputs: inputs ?? [...TASKS[task].inputs, ...(control === 'joints' ? ['joints'] : []), ...(roll ? ['turn'] : [])], h };
  net.w = new Array(shape(net).weights).fill(0);
  return net;
}
/** Why this is not a network (null: it is one). */
export function notNet(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.inputs) || !Array.isArray(d.w)) return 'a network is { inputs, h, w }';
  const odd = d.inputs.find(id => !Object.hasOwn(INPUTS, id));
  if (odd !== undefined || !d.inputs.length || new Set(d.inputs).size !== d.inputs.length) return `no input "${odd ?? ''}" (there are: ${Object.keys(INPUTS).join(', ')}), each once`;
  if (!SIZES.includes(d.h)) return `h, the hidden layer's units, is one of ${SIZES.join(', ')}`;
  if (d.control !== 'hand' && d.control !== 'joints') return 'control is "hand" or "joints"';
  const n = shape(d).weights;
  if (d.w.length !== n || !d.w.every(Number.isFinite)) return `w is ${n} numbers for these inputs and this size (it has ${d.w.length})`;
  return null;
}
/** The network's outputs for what it is shown. Same layout as the car's: W1 (a row of inputs per unit), b1, W2 (a row of
 *  outputs per unit), b2; without a hidden layer W (a row per output) and the biases. Everything through tanh. */
export function forward(net, x, sh = shape(net)) {
  const { nin, nout, h } = sh, w = net.w, y = new Array(nout).fill(0); let k = 0;
  if (!h) { for (let o = 0; o < nout; o++) { let a = 0; for (let i = 0; i < nin; i++) a += w[k++] * x[i]; y[o] = a; } for (let o = 0; o < nout; o++) y[o] = Math.tanh(y[o] + w[k++]); return y; }
  const u = new Array(h);
  for (let j = 0; j < h; j++) { let a = 0; for (let i = 0; i < nin; i++) a += w[k++] * x[i]; u[j] = a; }
  for (let j = 0; j < h; j++) u[j] = Math.tanh(u[j] + w[k++]);
  for (let j = 0; j < h; j++) for (let o = 0; o < nout; o++) y[o] += w[k++] * u[j];
  for (let o = 0; o < nout; o++) y[o] = Math.tanh(y[o] + w[k++]);
  return y;
}
/** Every number a network is shown and every output it has, by name, in their order (for a drawing of it). */
export function names(net) {
  return { inputs: net.inputs.flatMap(id => INPUTS[id].parts), outputs: [...(net.control === 'joints' ? ['base', 'shoulder', 'elbow'] : ['out', 'up', 'side']), ...(net.roll ? ['turn'] : []), 'grip'] };
}
/** forward() with the hidden layer's values kept: { h, y } (for a drawing; a test holds the two together). */
export function layers(net, x, sh = shape(net)) {
  const { nin, nout, h } = sh, w = net.w, u = new Array(h), y = new Array(nout).fill(0); let k = 0;
  if (!h) { for (let o = 0; o < nout; o++) { let a = 0; for (let i = 0; i < nin; i++) a += w[k++] * x[i]; y[o] = a; } for (let o = 0; o < nout; o++) y[o] = Math.tanh(y[o] + w[k++]); return { h: [], y }; }
  for (let j = 0; j < h; j++) { let a = 0; for (let i = 0; i < nin; i++) a += w[k++] * x[i]; u[j] = a; }
  for (let j = 0; j < h; j++) u[j] = Math.tanh(u[j] + w[k++]);
  for (let j = 0; j < h; j++) for (let o = 0; o < nout; o++) y[o] += w[k++] * u[j];
  for (let o = 0; o < nout; o++) y[o] = Math.tanh(y[o] + w[k++]);
  return { h: u, y };
}
/** What a network's outputs ask of the arm. */
export function orders(net, y) {
  const o = net.control === 'joints' ? { joints: [y[0], y[1], y[2]] } : { hand: [y[0], y[1], y[2]] };
  if (net.roll) o.roll = y[3];
  o.shut = y[y.length - 1] > 0;
  return o;
}

// ---------------------------------------------------------------- the world
/** The scene as MuJoCo reads it: the table, the arm (its joints first: their numbers lead qpos and ctrl), then the cubes. */
export function sceneXml(cubes = 1) {
  const { S, L1, L2, TL, lim } = ARM, f = n => n.toFixed(4);
  const finger = (name, s) => `<body name="${name}" pos="${f(s * OPEN)} 0 ${f(-TL)}" gravcomp="1"><joint name="${name}" type="slide" axis="${-s} 0 0" range="0 ${TRAVEL}" damping="4" armature="0.002"/><geom class="pad" type="box" size="0.005 0.012 0.03" pos="0 0 0.01" mass="0.05"/></body>`;
  return `<mujoco model="desk arm">
  <compiler angle="radian" autolimits="true"/>
  <option timestep="${STEP}" integrator="implicitfast" cone="elliptic" impratio="10"/>
  <default>
    <geom friction="1 0.005 0.0001" condim="4" contype="1" conaffinity="1"/>
    <joint armature="0.02" damping="2"/>
    <default class="link"><geom contype="2" conaffinity="0" friction="0.5 0.005 0.0001"/></default>
    <default class="pad"><geom solref="${(2.02 * STEP).toFixed(5)} 1" solimp="0.99 0.999 0.001"/></default>
  </default>
  <worldbody>
    <geom name="table" type="plane" size="1.5 1.5 0.1" friction="0.8 0.005 0.0001"/>
    <body name="turret" gravcomp="1">
      <joint name="base" type="hinge" axis="0 0 1" range="${lim.q0[0]} ${lim.q0[1]}"/>
      <geom type="cylinder" size="0.055 0.045" pos="0 0 0.075" mass="1" contype="0" conaffinity="0"/>
      <body name="upper" pos="0 0 ${S}" gravcomp="1">
        <joint name="shoulder" type="hinge" axis="0 -1 0" range="${lim.a1[0] - 0.05} ${lim.a1[1] + 0.05}"/>
        <geom class="link" type="capsule" fromto="0 0 0 ${L1} 0 0" size="0.026" mass="0.6"/>
        <body name="fore" pos="${L1} 0 0" gravcomp="1">
          <joint name="elbow" type="hinge" axis="0 1 0" range="${lim.e[0] - 0.05} ${lim.e[1] + 0.05}"/>
          <geom class="link" type="capsule" fromto="0 0 0 ${L2} 0 0" size="0.026" mass="0.4"/>
          <body name="wrist" pos="${L2} 0 0" gravcomp="1">
            <joint name="wrist" type="hinge" axis="0 1 0" range="-3.3 3.3"/>
            <geom type="sphere" size="0.02" mass="0.1" contype="0" conaffinity="0"/>
            <body name="tool" gravcomp="1">
              <joint name="roll" type="hinge" axis="0 0 1" range="-9 9" armature="0.005" damping="0.5"/>
              <geom name="palm" type="box" size="0.06 0.02 0.01" pos="0 0 ${f(-TL + 0.055)}" mass="0.2" friction="0.5 0.005 0.0001"/>
              <site name="grip" pos="0 0 ${f(-TL)}"/>
              ${finger('f1', 1)}
              ${finger('f2', -1)}
            </body>
          </body>
        </body>
      </body>
    </body>
    ${Array.from({ length: cubes }, (_, i) => `<body name="cube${i}" pos="${i} 3 ${HC}"><freejoint/><geom name="cube${i}" type="box" size="${HC} ${HC} ${HC}" class="pad" mass="0.1" conaffinity="3"/></body>`).join('\n    ')}
  </worldbody>
  <equality><joint joint1="f1" joint2="f2" polycoef="0 1 0 0 0"/></equality>
  <actuator>
    <position joint="base" kp="1500" forcerange="-80 80"/>
    <position joint="shoulder" kp="2000" forcerange="-80 80"/>
    <position joint="elbow" kp="1500" forcerange="-60 60"/>
    <position joint="wrist" kp="300" forcerange="-20 20"/>
    <position joint="roll" kp="60" forcerange="-5 5"/>
    <position joint="f1" kp="3000" kv="30" forcerange="${-GRIP_N} ${GRIP_N}"/>
    <position joint="f2" kp="3000" kv="30" forcerange="${-GRIP_N} ${GRIP_N}"/>
    <velocity joint="base" kv="60" forcerange="-80 80"/>
    <velocity joint="shoulder" kv="80" forcerange="-80 80"/>
    <velocity joint="elbow" kv="60" forcerange="-60 60"/>
    <velocity joint="wrist" kv="10" forcerange="-20 20"/>
    <velocity joint="roll" kv="1.5" forcerange="-5 5"/>
  </actuator>
</mujoco>`;
}
// One model for each number of cubes (a cube that is not there costs nothing), per MuJoCo module, and the datas handed
// back by free(), to be used again: making one costs far more than a go's first steps.
const worlds = new WeakMap();
function world(M, cubes) {
  let all = worlds.get(M);
  if (!all) worlds.set(M, all = new Map());
  let w = all.get(cubes);
  if (!w) {
    const model = M.MjModel.from_xml_string(sceneXml(cubes)), site = M.mj_name2id(model, M.mjtObj.mjOBJ_SITE.value, 'grip');
    all.set(cubes, w = { model, site, spare: [] });
  }
  return w;
}

/**
 * The arm at home and a scenario's cubes where `at` says. `free()` it when done (its memory is MuJoCo's, not the
 * garbage collector's) and don't use it after.
 */
export function createArm(M, { at = { cubes: [{ r: 0.3, a: 0, yaw: 0 }] }, task = 'grab' } = {}) {
  const T = TASKS[task], jobs = T.jobs, W = world(M, T.cubes), { model } = W, data = W.spare.pop() ?? new M.MjData(model);
  M.mj_resetData(model, data);
  // views straight into MuJoCo's memory: they go dead when that memory grows (another world made meanwhile), so act() looks
  let qpos = data.qpos, qvel = data.qvel, ctrl = data.ctrl, grip = data.site_xpos.subarray(3 * W.site, 3 * W.site + 3);
  const views = () => { qpos = data.qpos; qvel = data.qvel; ctrl = data.ctrl; grip = data.site_xpos.subarray(3 * W.site, 3 * W.site + 3); };
  const tray = { x: TRAY.r * Math.cos(TRAY.a), y: TRAY.r * Math.sin(TRAY.a) };
  const first = at.cubes[jobs[0].cube], stacked = Math.min(at.stacked | 0, jobs.length - 1);
  const qt = at.start === 'cube' ? joints(first.r, HC, first.a) : [...ARM.home];        // where the joints are ordered to be
  // each of the arm's motors is told where to be and how fast it should be moving there (so it does not lag behind a steady move)
  // The tool is turned against the base (qt[3] is its turn as seen from above, not at its joint): the fingers keep their
  // direction on the table whichever way the arm points, and close square on a cube that is not turned.
  const aim = (v0 = 0, v1 = 0, v2 = 0, v3 = 0) => { ctrl[0] = qt[0]; ctrl[1] = qt[1]; ctrl[2] = qt[2]; ctrl[3] = qt[1] - qt[2]; ctrl[4] = qt[3] - qt[0]; ctrl[5] = ctrl[6] = sim.shut ? TRAVEL : 0; ctrl[7] = v0; ctrl[8] = v1; ctrl[9] = v2; ctrl[10] = v1 - v2; ctrl[11] = v3 - v0; };
  for (let i = 0; i < T.cubes; i++) {
    const c = at.cubes[i], k = 7 + 7 * i, yaw = c.yaw || 0;
    qpos[k] = c.r * Math.cos(c.a); qpos[k + 1] = c.r * Math.sin(c.a); qpos[k + 2] = HC; qpos[k + 3] = Math.cos(yaw / 2); qpos[k + 4] = 0; qpos[k + 5] = 0; qpos[k + 6] = Math.sin(yaw / 2);
  }
  // a training's later start: the first jobs already done (those cubes on the stack)
  for (let j = 0; j < stacked; j++) { const job = jobs[j], k = 7 + 7 * job.cube, o = 7 + 7 * job.on; qpos[k] = qpos[o]; qpos[k + 1] = qpos[o + 1]; qpos[k + 2] = qpos[o + 2] + CUBE; qpos[k + 3] = 1; qpos[k + 4] = qpos[k + 5] = qpos[k + 6] = 0; }
  const cube = i => 7 + 7 * i;
  const track = () => ({ near: Infinity, d0: 0, squeezed: 0, lift: 0, carry: Infinity, c0: 0, z0: 0, set: false, fresh: true });
  const sim = {
    task, qt, t: 0, ticks: 0, shut: false, at,
    // how the scenario stands: stage (jobs done from the first: a stack knocked over goes back), done (s; null: not
    // yet), lost (a cube off the table), and for each job what the drive has done about it so far (jobs[k]: the grip's
    // nearest to its cube, decisions spent squeezing it, its highest in the fingers, how far it is from where it goes,
    // set: it was held in place)
    stage: 0, still: 0, done: null, lost: false, jobs: jobs.map(track),

    /** The joints as they are: [q0, a1, e, q3]. */
    get q() { return [qpos[0], qpos[1], qpos[2], qpos[0] + qpos[4]]; },
    gap() { return 2 * OPEN - 0.01 - qpos[5] - qpos[6]; },                              // between the fingers' inner faces
    /** The job to do now (the last one while the scenario waits to be called done). */
    job() { return jobs[Math.min(sim.stage, jobs.length - 1)]; },
    /** Where a job's cube has to go (MuJoCo's axes); null for a lift. */
    goal(job) { if (job.lift) return null; if (job.to === 'tray') return [tray.x, tray.y, HC]; const o = cube(job.on); return [qpos[o], qpos[o + 1], qpos[o + 2] + CUBE]; },
    /** The cube to move now as the hand has it: from the grip's centre along the fingers' travel, up and across; is it between them. */
    grasp() {
      if (seen) return seen;                                   // asked several times a decision (what it sees, the score): worked out once
      const k = cube(sim.job().cube), dx = qpos[k] - grip[0], dy = qpos[k + 1] - grip[1], dz = qpos[k + 2] - grip[2], yaw = qpos[0] + qpos[4], cs = Math.cos(yaw), sn = Math.sin(yaw);
      const along = dx * cs + dy * sn, across = -dx * sn + dy * cs, between = Math.abs(along) < 0.03 && Math.abs(dz) < 0.03 && Math.abs(across) < 0.03;
      return seen = { k, dx, dy, dz, between, dist: Math.hypot(dx, dy, dz), touch: between && sim.shut && sim.gap() > 0.022 };
    },
    /** What a network with these inputs is shown now. */
    observe(inputs) {
      const g = sim.grasp(), cs = Math.cos(qpos[0]), sn = Math.sin(qpos[0]), x = [];
      const away = (dx, dy) => dx * cs + dy * sn, side = (dx, dy) => -dx * sn + dy * cs;     // away from the base; the way q0 turns
      for (const id of inputs) {
        if (id === 'cube') x.push(cl(away(g.dx, g.dy) / 0.2, -2, 2), cl(g.dz / 0.2, -2, 2), cl(side(g.dx, g.dy) / 0.2, -2, 2));
        else if (id === 'gap') x.push(cl((sim.gap() - 0.002) / (2 * TRAVEL) * 2 - 1, -1, 1));
        else if (id === 'height') x.push(grip[2] / 0.3 - 0.5);
        else if (id === 'beam') x.push(g.between ? 1 : 0);
        else if (id === 'touch') x.push(g.touch ? 1 : 0);
        else if (id === 'goal') { const to = sim.goal(sim.job()); if (!to) x.push(0, 0, 0); else { const dx = to[0] - qpos[g.k], dy = to[1] - qpos[g.k + 1]; x.push(cl(away(dx, dy) / 0.3, -2, 2), cl((to[2] - qpos[g.k + 2]) / 0.3, -2, 2), cl(side(dx, dy) / 0.3, -2, 2)); } }
        else if (id === 'there') x.push(sim.stage < jobs.length && sim.goal(sim.job()) && there(sim.job()) ? 1 : 0);
        else if (id === 'turn') { const a = 4 * (2 * Math.atan2(qpos[g.k + 6], qpos[g.k + 3]) - qpos[0] - qpos[4]); x.push(Math.sin(a), Math.cos(a)); }
        else if (id === 'joints') x.push(qpos[1] - 0.8, qpos[2] - 1.55, Math.hypot(grip[0], grip[1]) / 0.3 - 1);
      }
      return x;
    },
    /**
     * One decision (1/60 s). What is asked: `joints` [base, shoulder, elbow] each −1..1 of its top speed, or `hand`
     * [outwards, up, sideways] each −1..1 of ARM.hand (the joints follow as fast as they can, all slowed alike when one
     * can't keep up), or `world` [x, y, z] the same along the picture's axes (a person's keys); `roll` −1..1; `shut`.
     */
    act({ joints: jv, hand: hv, world: wv, roll = 0, shut = false } = {}) {
      if (!qpos.length) views();
      const want = [0, 0, 0, cl(+roll || 0, -1, 1) * ARM.speed[3]], dt = 1 / HZ;
      if (jv) for (let i = 0; i < 3; i++) want[i] = cl(+jv[i] || 0, -1, 1) * ARM.speed[i];
      else if (hv || wv) {
        let vr, vy, vt;
        if (hv) [vr, vy, vt] = hv.map(v => cl(+v || 0, -1, 1) * ARM.hand);
        else { const cs = Math.cos(qt[0]), sn = Math.sin(qt[0]), [vx, vz, vup] = in3(wv.map(v => cl(+v || 0, -1, 1) * ARM.hand)); vr = vx * cs + vz * sn; vt = -vx * sn + vz * cs; vy = vup; }
        const a2 = qt[1] - qt[2], s1 = Math.sin(qt[1]), c1 = Math.cos(qt[1]), s2 = Math.sin(a2), c2 = Math.cos(a2), det = -ARM.L1 * ARM.L2 * Math.sin(qt[2]);
        const d1 = (ARM.L2 * c2 * vr + ARM.L2 * s2 * vy) / det, d2 = (-ARM.L1 * c1 * vr - ARM.L1 * s1 * vy) / det;
        want[0] = vt / Math.max(0.08, reach(qt).r); want[1] = d1; want[2] = d1 - d2;
        const over = Math.max(1, ...[0, 1, 2].map(i => Math.abs(want[i]) / ARM.speed[i]));
        for (let i = 0; i < 3; i++) want[i] /= over;
      }
      const n = [qt[0] + want[0] * dt, qt[1] + want[1] * dt, qt[2] + want[2] * dt, qt[3] + want[3] * dt];
      if (n[0] < ARM.lim.q0[0] || n[0] > ARM.lim.q0[1]) n[0] = qt[0];
      const ok = v => v[1] >= ARM.lim.a1[0] && v[1] <= ARM.lim.a1[1] && v[2] >= ARM.lim.e[0] && v[2] <= ARM.lim.e[1] && reach(v).y >= ARM.floor && reach(v).r >= 0.1;
      // the shoulder and the elbow together, else the one that still can, else neither: the order stops at the limits and at the table
      if (!ok(n)) { const a = [n[0], n[1], qt[2], n[3]], b = [n[0], qt[1], n[2], n[3]]; if (ok(a)) n[2] = qt[2]; else if (ok(b)) n[1] = qt[1]; else { n[1] = qt[1]; n[2] = qt[2]; } }
      const v = [(n[0] - qt[0]) / dt, (n[1] - qt[1]) / dt, (n[2] - qt[2]) / dt, (n[3] - qt[3]) / dt];
      for (let i = 0; i < 4; i++) qt[i] = n[i];
      sim.shut = !!shut; seen = null;
      aim(v[0], v[1], v[2], v[3]);
      for (let s = 0; s < SUB; s++) M.mj_step(model, data);
      sim.t += 1 / HZ; sim.ticks++;
      score();
    },
    /** The joints, the fingers, the cubes and where the next one goes, in the picture's axes, for whoever draws them. */
    pose() {
      if (!qpos.length) views();
      const to = sim.done == null ? sim.goal(sim.job()) : null, cubes = [];
      for (let i = 0; i < T.cubes; i++) { const k = cube(i); cubes.push({ p: out3(qpos[k], qpos[k + 1], qpos[k + 2]), q: [qpos[k + 4], qpos[k + 6], -qpos[k + 5], qpos[k + 3]] }); }
      return { q: [qpos[0], qpos[1], qpos[2], qpos[4]], wrist: qpos[3], grip: out3(grip[0], grip[1], grip[2]), yaw: qpos[0] + qpos[4], half: (sim.gap() + 0.01) / 2, shut: sim.shut,
        cubes, now: sim.job().cube, tray: T.jobs[0].to === 'tray' ? { x: tray.x, z: -tray.y } : null, goal: to && out3(to[0], to[1], to[2]), stage: sim.stage, of: jobs.length, t: sim.t, done: sim.done };
    },
    free() { W.spare.push(data); },
  };
  let seen = null;                                             // grasp() as worked out since the last decision
  // is a job's cube where it goes (in the tray's square, or within 2 cm of the middle of the cube below; at its height)
  const there = job => {
    const k = cube(job.cube), to = sim.goal(job), dx = qpos[k] - to[0], dy = qpos[k + 1] - to[1];
    return (job.to === 'tray' ? Math.max(Math.abs(dx), Math.abs(dy)) < TRAY.half - HC : Math.hypot(dx, dy) < 0.02) && Math.abs(qpos[k + 2] - to[2]) < 0.008;
  };
  // is a job done as things stand: its cube where it goes, at rest, and let go of
  const placed = job => {
    const k = cube(job.cube), v = 6 + 6 * job.cube + 1;
    if (!there(job) || Math.hypot(qvel[v], qvel[v + 1], qvel[v + 2]) > 0.03) return false;
    if (!sim.jobs[jobs.indexOf(job)].set) return false;                                     // put there: held in the fingers while in place. Pushed along the table, dropped or thrown does not count
    return Math.hypot(qpos[k] - grip[0], qpos[k + 1] - grip[1], qpos[k + 2] - grip[2]) > 0.06 || (!sim.shut && sim.gap() > CUBE + 0.012);
  };
  // the scenario's book-keeping after each decision
  const score = () => {
    for (let i = 0; i < T.cubes; i++) { const k = cube(i); if (qpos[k + 2] < -0.2 || Math.hypot(qpos[k], qpos[k + 1]) > 0.9) sim.lost = true; }
    if (sim.done != null) return;
    if (!jobs[0].lift) {
      let st = 0; while (st < jobs.length && placed(jobs[st])) st++;
      if (st !== sim.stage) { sim.stage = st; seen = null; }
      sim.still = st === jobs.length ? sim.still + 1 : 0;
      if (sim.still >= HZ / 4) { sim.done = sim.t; return; }
      if (st === jobs.length) return;
    }
    const job = sim.job(), tr = sim.jobs[sim.stage], g = sim.grasp(), to = sim.goal(job), z = qpos[g.k + 2];
    if (tr.fresh) { tr.fresh = false; tr.d0 = Math.max(0.1, g.dist); tr.z0 = z; tr.c0 = to ? Math.max(0.05, Math.hypot(to[0] - qpos[g.k], to[1] - qpos[g.k + 1], to[2] - z)) : 0; }
    tr.near = Math.min(tr.near, g.dist);
    if (g.touch) tr.squeezed++;
    const inHand = g.dist < 0.03, up = z - tr.z0;
    if (inHand) tr.lift = Math.max(tr.lift, Math.min(up, LIFT));
    if (to && g.touch && tr.lift > 0.02 && there(job)) tr.set = true;
    if (to && tr.lift > 0.02) tr.carry = Math.hypot(to[0] - qpos[g.k], to[1] - qpos[g.k + 1], to[2] - z);       // how far it is now, not the nearest it came: dropped on the way is not carried
    if (job.lift) { sim.still = inHand && up >= LIFT ? sim.still + 1 : 0; if (sim.still >= HZ / 2) { sim.stage = 1; sim.done = sim.t; } }
  };
  // settle: the arm where it is ordered to be, the cubes on the table (or on each other), nothing moving
  qpos[0] = qt[0]; qpos[1] = qt[1]; qpos[2] = qt[2]; qpos[3] = qt[1] - qt[2]; qpos[4] = qt[3] - qt[0]; qpos[5] = qpos[6] = 0;
  aim();
  M.mj_forward(model, data);
  for (let j = 0; j < stacked; j++) sim.jobs[j].set = true;       // a later start's cubes count as put there
  if (!jobs[0].lift) { let st = 0; while (st < jobs.length && placed(jobs[st])) st++; sim.stage = st; }
  return sim;
}

/**
 * One go at a placement with a network at the controls: until the scenario is done, a cube is lost or its time is up.
 * fit is what a training climbs: 12 for every job done, and for the one under way getting the grip to its cube (0..1),
 * squeezing it (0..1), lifting it (0..5 for a lift, 0..2 on the way somewhere), how near where it goes the cube is at the
 * end, once it was lifted (0..5), 2 for having held it in place;
 * then 10 plus the seconds left once the whole scenario is done.
 */
export function attempt(M, net, at, { task = net.task || 'grab', limit = TASKS[task].limit } = {}) {
  const sim = createArm(M, { at, task }), sh = shape(net), jobs = TASKS[task].jobs;
  for (let i = 0; i < limit * HZ && sim.done == null && !sim.lost; i++) sim.act(orders(net, forward(net, sim.observe(net.inputs), sh)));
  let fit = 12 * Math.min(sim.stage, jobs.length);
  if (sim.stage < jobs.length) {
    const tr = sim.jobs[sim.stage], job = jobs[sim.stage];
    if (!tr.fresh) {
      fit += Math.max(0, 1 - tr.near / tr.d0) + Math.min(tr.squeezed, 30) / 30;
      if (job.lift) fit += 5 * tr.lift / LIFT;
      else { fit += 2 * Math.min(1, tr.lift / 0.06) + (tr.set ? 2 : 0); if (tr.carry < Infinity) fit += 5 * (1 - Math.min(tr.carry, tr.c0) / tr.c0); }
    }
  }
  if (sim.done != null) fit += 10 + (limit - sim.done);
  const r = { ok: sim.done != null, time: sim.done, fit, stage: sim.stage };
  sim.free();
  return r;
}

/**
 * The exam: the scenario's placements, one after the other. done: how many it managed; time: the seconds they took,
 * a failed one counting the scenario's whole limit (so a board sorts by done, then time).
 */
export function exam(M, net, { task = net.task || 'grab' } = {}) {
  const goes = examPlacements(task).map(at => attempt(M, net, at, { task })), limit = TASKS[task].limit;
  const done = goes.filter(g => g.ok).length, round = v => Math.round(v * 1000) / 1000;
  return { task, done, of: goes.length, time: round(goes.reduce((s, g) => s + (g.ok ? g.time : limit), 0)), mean: done ? round(goes.reduce((s, g) => s + (g.ok ? g.time : 0), 0) / done) : null, fit: goes.reduce((s, g) => s + g.fit, 0) / goes.length, goes: goes.map(g => g.ok ? round(g.time) : null) };
}
