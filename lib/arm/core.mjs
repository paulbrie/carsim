// The arm sim's world (#359): a desk arm with a two-finger gripper, a table, a cube, and what a grab is. No page in
// here and no drawing (components/arm-sim.tsx draws what `pose()` says): it runs the same in a tab, in a worker and in
// Node, and the same drive gives the same numbers to the last digit (the physics is Rapier's deterministic build, given
// as R: `await R.init()` first). Metres, seconds, radians; y is up, the table's top is y = 0, the arm's base at 0, 0.
//
// The arm: a base that turns (q0), a shoulder (a1, the upper arm's angle above the horizontal), an elbow (e, the angle
// the forearm is folded down from the upper arm), and a tool that always hangs straight down and turns about itself
// (q3). Its joints are moved by us, within their speeds and limits (the links can't be pushed back); the two fingers
// are bodies of their own on sliding joints with a motor of limited force. Nothing is glued: a cube is held by
// friction, and slips when it is squeezed badly or swung too hard.
export const ARM = {
  S: 0.12, L1: 0.26, L2: 0.26, TL: 0.10,                    // shoulder's height, upper arm, forearm, wrist to the grip
  speed: [2.5, 2.5, 2.5, 4],                               // the joints' top speeds, rad/s: base, shoulder, elbow, tool
  lag: 0.06,                                               // s: a motor takes this long to follow an order
  hand: 0.5,                                               // m/s: the hand's speed at a full output, when the hand is driven
  lim: { q0: [-2.7, 2.7], a1: [-0.3, 1.9], e: [0.35, 2.75] },
  home: [0, 1.35, 1.7, 0],
  floor: 0.022,                                            // the grip's centre never goes lower (the fingertips: 2 mm)
};
export const HZ = 60, DT = 1 / 120, SUB = 2;               // decisions a second; the physics' step; steps a decision
export const OPEN = 0.045, SHUT = 0.006, GRIP_N = 12;      // a finger's travel from the grip's centre; its motor's force
const GAP = [2 * SHUT - 0.01, 2 * OPEN - 0.01];              // between the fingers' inner faces: shut, open
export const CUBE = 0.05, LIFT = 0.15;
export const TRAY = { r: 0.3, a: 1.7, half: 0.07 };

/** What a network can be shown: id → how many numbers and what they are. All in the arm's own frame: away from the
 *  base, up, and sideways (the way the base turns), so a cube to the left is the cube to the right turned. */
export const INPUTS = {
  cube: { n: 3, name: 'The cube from the grip', about: 'how far the cube is from the middle of the fingers: outwards, upwards, sideways (1 = 20 cm)' },
  gap: { n: 1, name: 'Fingers', about: 'how far apart the fingers are: −1 shut, 1 wide open' },
  height: { n: 1, name: 'Height', about: 'how high the grip is above the table' },
  beam: { n: 1, name: 'Something between the fingers', about: '1 while the cube is between the fingers (a gripper’s light beam), else 0' },
  touch: { n: 1, name: 'Squeezing', about: '1 while the fingers are closed on the cube, else 0' },
  goal: { n: 3, name: 'The tray from the cube', about: 'how far the tray is from the cube, outwards and sideways (1 = 30 cm), and how high the cube is' },
  turn: { n: 2, name: 'The cube’s angle', about: 'how the cube is turned against the fingers (two numbers, the same every quarter turn)' },
  joints: { n: 3, name: 'Its own joints', about: 'the shoulder, the elbow and how far the grip is from the base' },
};
export const TASKS = {
  grab: { name: 'Pick up', about: 'Lift the cube 15 cm off the table and hold it for half a second.', limit: 5, inputs: ['cube', 'gap', 'height', 'beam', 'touch'] },
  tray: { name: 'Into the tray', about: 'Pick the cube up and put it down in the tray.', limit: 8, inputs: ['cube', 'gap', 'height', 'beam', 'touch', 'goal'] },
};
export const SIZES = [0, 2, 4, 6, 8, 12, 16, 24, 32];

const cl = (v, a, b) => v < a ? a : v > b ? b : v;
const yq = a => ({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });

/** A seeded dice (mulberry32): the same placements for everyone. */
export function dice(seed) {
  let s = seed >>> 0;
  const f = () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  f.gauss = () => Math.sqrt(-2 * Math.log(1 - f())) * Math.cos(2 * Math.PI * f());
  return f;
}
/** Where a cube is put: r from the base, a round it (as q0), yaw its own turn.
 *  start: 'cube' begins with the open fingers already round the cube (a training's half-way start; the exam's are all from home). */
export const placement = (rnd, turned = false) => ({ r: 0.2 + rnd() * 0.22, a: -1 + rnd() * 2, yaw: turned ? (rnd() - 0.5) * Math.PI / 2 : 0 });
/** The exam's placements: the same 20 for everyone (per task). */
export function examPlacements(task = 'grab', n = 20) { const rnd = dice(task === 'tray' ? 7402 : 3359); return Array.from({ length: n }, () => placement(rnd)); }

/** Where the joints put the wrist and the grip. */
export function reach(q) {
  const a2 = q[1] - q[2], r = ARM.L1 * Math.cos(q[1]) + ARM.L2 * Math.cos(a2), y = ARM.S + ARM.L1 * Math.sin(q[1]) + ARM.L2 * Math.sin(a2);
  return { r, wrist: y, y: y - ARM.TL, x: r * Math.cos(q[0]), z: -r * Math.sin(q[0]), yaw: q[0] + q[3] };
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
/** A network of nothing but zeros for a task: where a training starts. */
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

// ---------------------------------------------------------------- the world
/**
 * A table, the arm at home and one cube where `at` says. `free()` it when done (the physics' memory is not the
 * garbage collector's).
 */
export function createArm(R, { at = { r: 0.3, a: 0, yaw: 0 }, task = 'grab', mass = 0.1, grip = 1.0 } = {}) {
  const world = new R.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT; world.numSolverIterations = 8;
  const table = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, -0.05, 0));
  world.createCollider(R.ColliderDesc.cuboid(1, 0.05, 1).setFriction(0.8), table);
  const hc = CUBE / 2;
  const cube = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(at.r * Math.cos(at.a), hc, -at.r * Math.sin(at.a)).setRotation(yq(at.yaw || 0)).setCanSleep(false));
  world.createCollider(R.ColliderDesc.cuboid(hc, hc, hc).setMass(mass).setFriction(grip), cube);
  const q = at.start === 'cube' ? joints(at.r, hc, at.a) : [...ARM.home], qd = [0, 0, 0, 0], p0 = reach(q);
  const hand = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(p0.x, p0.y, p0.z).setRotation(yq(p0.yaw)));
  world.createCollider(R.ColliderDesc.cuboid(0.06, 0.01, 0.02).setTranslation(0, 0.055, 0).setFriction(0.5), hand);
  const fingers = [1, -1].map(s => {
    const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(p0.x + s * OPEN * Math.cos(p0.yaw), p0.y, p0.z - s * OPEN * Math.sin(p0.yaw)).setRotation(yq(p0.yaw)).setCanSleep(false));
    world.createCollider(R.ColliderDesc.cuboid(0.005, 0.03, 0.012).setTranslation(0, 0.01, 0).setMass(0.05).setFriction(grip), body);
    const joint = world.createImpulseJoint(R.JointData.prismatic({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: s, y: 0, z: 0 }), hand, body, true);
    joint.setLimits(SHUT, OPEN); joint.setContactsEnabled(false);
    joint.configureMotorPosition(OPEN, 4000, 60); joint.setMotorMaxForce(GRIP_N);
    return { body, joint };
  });
  const tray = { x: TRAY.r * Math.cos(TRAY.a), z: -TRAY.r * Math.sin(TRAY.a) };
  const sim = {
    task, q, qd, t: 0, ticks: 0, shut: false, at,
    // what the drive has done so far: the grip's nearest to the cube, the cube's highest in the fingers, the cube's
    // nearest to the tray once lifted, decisions spent squeezing it, held up for (decisions), done at (s; null: not yet),
    // decisions spent pushing against the table or a joint's end (jammed)
    near: Infinity, lift: 0, carry: Infinity, squeezed: 0, held: 0, done: null, lost: false, jammed: 0,

    gap() { const a = fingers[0].body.translation(), b = fingers[1].body.translation(); return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) - 0.01; },
    /** The cube as the hand has it: from the grip's centre along the fingers' travel, up and across; is it between them. */
    grasp() {
      const p = reach(q), c = cube.translation(), dx = c.x - p.x, dy = c.y - p.y, dz = c.z - p.z, cs = Math.cos(p.yaw), sn = Math.sin(p.yaw);
      const along = dx * cs - dz * sn, across = dx * sn + dz * cs, between = Math.abs(along) < 0.03 && Math.abs(dy) < 0.03 && Math.abs(across) < 0.03;
      return { p, c, dx, dy, dz, between, dist: Math.hypot(dx, dy, dz), touch: between && sim.shut && sim.gap() > SHUT * 2 + 0.01 };
    },
    /** What a network with these inputs is shown now. */
    observe(inputs) {
      const g = sim.grasp(), { p, c } = g, cs = Math.cos(q[0]), sn = Math.sin(q[0]), x = [];
      const out = (dx, dz) => dx * cs - dz * sn, side = (dx, dz) => -dx * sn - dz * cs;       // away from the base; the way q0 turns
      for (const id of inputs) {
        if (id === 'cube') x.push(cl(out(g.dx, g.dz) / 0.2, -2, 2), cl(g.dy / 0.2, -2, 2), cl(side(g.dx, g.dz) / 0.2, -2, 2));
        else if (id === 'gap') x.push(cl((sim.gap() - GAP[0]) / (GAP[1] - GAP[0]) * 2 - 1, -1, 1));
        else if (id === 'height') x.push(p.y / 0.3 - 0.5);
        else if (id === 'beam') x.push(g.between ? 1 : 0);
        else if (id === 'touch') x.push(g.touch ? 1 : 0);
        else if (id === 'goal') x.push(cl(out(tray.x - c.x, tray.z - c.z) / 0.3, -2, 2), cl(side(tray.x - c.x, tray.z - c.z) / 0.3, -2, 2), cl((c.y - hc) / LIFT, 0, 2));
        else if (id === 'turn') { const r = cube.rotation(), a = 4 * (2 * Math.atan2(r.y, r.w) - p.yaw); x.push(Math.sin(a), Math.cos(a)); }
        else if (id === 'joints') x.push(q[1] - 0.8, q[2] - 1.55, p.r / 0.3 - 1);
      }
      return x;
    },
    /**
     * One decision (1/60 s). What is asked: `joints` [base, shoulder, elbow] each −1..1 of its top speed, or `hand`
     * [outwards, up, sideways] each −1..1 of ARM.hand (the joints follow as fast as they can, all slowed alike when one
     * can't keep up), or `world` [x, y, z] the same along the table's axes (a person's keys); `roll` −1..1; `shut`.
     */
    act({ joints, hand: hv, world: wv, roll = 0, shut = false } = {}) {
      let want = [0, 0, 0, cl(+roll || 0, -1, 1) * ARM.speed[3]];
      if (joints) for (let i = 0; i < 3; i++) want[i] = cl(+joints[i] || 0, -1, 1) * ARM.speed[i];
      else if (hv || wv) {
        let vr, vy, vt;
        if (hv) [vr, vy, vt] = hv.map(v => cl(+v || 0, -1, 1) * ARM.hand);
        else { const cs = Math.cos(q[0]), sn = Math.sin(q[0]), vx = cl(+wv[0] || 0, -1, 1) * ARM.hand, vz = cl(+wv[2] || 0, -1, 1) * ARM.hand; vr = vx * cs - vz * sn; vt = -vx * sn - vz * cs; vy = cl(+wv[1] || 0, -1, 1) * ARM.hand; }
        const a2 = q[1] - q[2], s1 = Math.sin(q[1]), c1 = Math.cos(q[1]), s2 = Math.sin(a2), c2 = Math.cos(a2), det = -ARM.L1 * ARM.L2 * Math.sin(q[2]);
        const d1 = (ARM.L2 * c2 * vr + ARM.L2 * s2 * vy) / det, d2 = (-ARM.L1 * c1 * vr - ARM.L1 * s1 * vy) / det;
        want[0] = vt / Math.max(0.08, reach(q).r); want[1] = d1; want[2] = d1 - d2;
        const over = Math.max(1, ...[0, 1, 2].map(i => Math.abs(want[i]) / ARM.speed[i]));
        for (let i = 0; i < 3; i++) want[i] /= over;
      }
      sim.shut = !!shut;
      for (const f of fingers) f.joint.configureMotorPosition(sim.shut ? SHUT : OPEN, 4000, 60);
      const k = Math.min(1, DT / ARM.lag);
      let jam = false;
      for (let s = 0; s < SUB; s++) {
        for (let i = 0; i < 4; i++) qd[i] += (want[i] - qd[i]) * k;
        const n = [q[0] + qd[0] * DT, q[1] + qd[1] * DT, q[2] + qd[2] * DT, q[3] + qd[3] * DT];
        if (n[0] < ARM.lim.q0[0] || n[0] > ARM.lim.q0[1]) { n[0] = q[0]; qd[0] = 0; jam = true; }
        const ok = v => v[1] >= ARM.lim.a1[0] && v[1] <= ARM.lim.a1[1] && v[2] >= ARM.lim.e[0] && v[2] <= ARM.lim.e[1] && reach(v).y >= ARM.floor && reach(v).r >= 0.1;
        // the shoulder and the elbow together, else the one that still can, else neither: the arm stops at its limits and at the table
        if (!ok(n)) { jam = true; const a = [n[0], n[1], q[2], n[3]], b = [n[0], q[1], n[2], n[3]]; if (ok(a)) { n[2] = q[2]; qd[2] = 0; } else if (ok(b)) { n[1] = q[1]; qd[1] = 0; } else { n[1] = q[1]; n[2] = q[2]; qd[1] = qd[2] = 0; } }
        for (let i = 0; i < 4; i++) q[i] = n[i];
        const p = reach(q);
        hand.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z }); hand.setNextKinematicRotation(yq(p.yaw));
        world.step(); sim.t += DT;
      }
      sim.ticks++; if (jam) sim.jammed++;
    },
    /** The joints, the fingers and the cube, for whoever draws them. */
    pose() {
      const p = reach(q), c = cube.translation(), r = cube.rotation(), half = (sim.gap() + 0.01) / 2;
      return { q: [...q], grip: [p.x, p.y, p.z], yaw: p.yaw, wrist: p.wrist, half, shut: sim.shut, cube: { p: [c.x, c.y, c.z], q: [r.x, r.y, r.z, r.w] }, tray: task === 'tray' ? tray : null, t: sim.t, done: sim.done };
    },
    free() { world.free(); },
  };
  // the task's book-keeping after each decision
  const score = () => {
    const g = sim.grasp(), up = g.c.y - hc, inHand = g.dist < 0.03;
    sim.near = Math.min(sim.near, g.dist);
    if (g.touch) sim.squeezed++;
    if (inHand) sim.lift = Math.max(sim.lift, Math.min(up, LIFT));
    if (g.c.y < -0.2 || Math.hypot(g.c.x, g.c.z) > 0.9) sim.lost = true;
    if (sim.done != null) return;
    if (task === 'grab') { sim.held = inHand && up >= LIFT ? sim.held + 1 : 0; if (sim.held >= HZ / 2) sim.done = sim.t; }
    else {
      const bx = g.c.x - tray.x, bz = g.c.z - tray.z, v = cube.linvel();
      if (sim.lift > 0.03) sim.carry = Math.min(sim.carry, Math.hypot(bx, bz));
      if (Math.max(Math.abs(bx), Math.abs(bz)) < TRAY.half - hc && up < 0.01 && Math.hypot(v.x, v.y, v.z) < 0.02 && g.dist > 0.06 && sim.lift > 0.03) sim.done = sim.t;
    }
  };
  const act = sim.act; sim.act = o => { act(o); score(); };
  sim.near = sim.grasp().dist; sim.d0 = Math.max(0.1, sim.near); sim.b0 = Math.hypot(cube.translation().x - tray.x, cube.translation().z - tray.z);
  return sim;
}

/** What a network's outputs ask of the arm. */
export function orders(net, y) {
  const o = net.control === 'joints' ? { joints: [y[0], y[1], y[2]] } : { hand: [y[0], y[1], y[2]] };
  if (net.roll) o.roll = y[3];
  o.shut = y[y.length - 1] > 0;
  return o;
}

/**
 * One go at a placement with a network at the controls: until the task is done, the cube is lost or the task's time
 * is up. fit is what a training climbs: getting the grip to the cube (0..1), squeezing it (0..1), lifting it (0..5),
 * for the tray carrying it there (0..5), and 10 plus the seconds left once the task is done. (A point more for the
 * grip's last centimetres onto the cube was tried: it taught networks to ram the table, and fewer learned to lift.)
 */
export function attempt(R, net, at, { task = net.task || 'grab', limit = TASKS[task].limit } = {}) {
  const sim = createArm(R, { at, task }), sh = shape(net);
  for (let i = 0; i < limit * HZ && sim.done == null && !sim.lost; i++) sim.act(orders(net, forward(net, sim.observe(net.inputs), sh)));
  let fit = Math.max(0, 1 - sim.near / sim.d0) + Math.min(sim.squeezed, 30) / 30 + 5 * sim.lift / LIFT;
  if (task === 'tray' && sim.carry < Infinity) fit += 5 * (1 - Math.min(sim.carry, sim.b0) / sim.b0);
  if (sim.done != null) fit += 10 + (limit - sim.done);
  const r = { ok: sim.done != null, time: sim.done, fit };
  sim.free();
  return r;
}

/**
 * The exam: the task's 20 placements, one after the other. done: how many it managed; time: the seconds they took,
 * a failed one counting the task's whole limit (so a board sorts by done, then time).
 */
export function exam(R, net, { task = net.task || 'grab' } = {}) {
  const goes = examPlacements(task).map(at => attempt(R, net, at, { task })), limit = TASKS[task].limit;
  const done = goes.filter(g => g.ok).length, round = v => Math.round(v * 1000) / 1000;
  return { task, done, of: goes.length, time: round(goes.reduce((s, g) => s + (g.ok ? g.time : limit), 0)), mean: done ? round(goes.reduce((s, g) => s + (g.ok ? g.time : 0), 0) / done) : null, fit: goes.reduce((s, g) => s + g.fit, 0) / goes.length, goes: goes.map(g => g.ok ? round(g.time) : null) };
}
