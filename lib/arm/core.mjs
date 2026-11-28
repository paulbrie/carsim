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
//
// Two arms (#361, `ARMS`), driven alike (the same orders, the same inputs, the same scenarios and placements): `desk`, the
// first, of round figures, and `b601`, Seeed Studio's reBot Arm B601-RS as its makers publish it. Each says how its
// joints stand for the four above (`q`), and how those four are ordered of its own motors (`aim`). A network is for one
// arm (`net.arm`, the desk's when it doesn't say), and so is its exam.
//
// The same in every engine: sin, cos, tanh, atan2, acos, log and hypot are ./math.mjs's, not Math's (JavaScript leaves those to
// each engine, and Chrome's and Node's differ in the last digit: an exam came out 0.05 s apart). Math's that may be used here:
// abs, min, max, round, floor, sqrt, imul, PI (exact everywhere).
import { acos, atan2, cos, hypot, log, sin, tanh } from './math.mjs';
export const HZ = 60, STEP = 1 / 360, SUB = 6;             // decisions a second; the physics' step; steps a decision (at 240 Hz a carried cube slid 5 mm at each start, at 360 Hz 1 mm)
export const OPEN = 0.045, TRAVEL = 0.039, GRIP_N = 20;    // the desk arm's: a finger's place from the grip's centre when open; its travel; its motor's force
export const CUBE = 0.05, LIFT = 0.15;
export const OVER = 0.26;                                  // the notes' travel height: above a stack of four with a cube in the fingers
export const TRAY = { r: 0.3, a: 1.7, half: 0.07 };
const HC = CUBE / 2;
const PI = Math.PI;

const DESK = {
  key: 'desk', name: 'Desk arm', maker: null,
  about: 'The first one, of round figures: 52 cm from the shoulder to the wrist, the hand at up to 50 cm a second, fingers of 20 N.',
  S: 0.12, R0: 0, L1: 0.26, L2: 0.26, TL: 0.10,            // shoulder's height, its distance out from the base's axis, upper arm, forearm, wrist to the grip
  speed: [2.5, 2.5, 2.5, 4],                               // the joints' top speeds, rad/s: base, shoulder, elbow, tool
  hand: 0.5,                                               // m/s: the hand's speed at a full output, when the hand is driven
  lim: { q0: [-2.7, 2.7], a1: [-0.3, 1.9], e: [0.35, 2.75] },
  home: [0, 1.35, 1.7, 0],
  floor: 0.022,                                            // the grip's centre is never ordered lower (the fingertips: 2 mm)
  gripN: GRIP_N, gap: [0.002, 0.08],                       // the fingers' force (N); the gap between them, shut and open (m)
  nq: 7,                                                   // its joints in qpos (and qvel): base, shoulder, elbow, wrist, roll, the two fingers
  q: qp => [qp[0], qp[1], qp[2], qp[0] + qp[4]],
  yaw: qp => qp[0] + qp[4],                                // the way the fingers close, seen from above
  width: qp => 2 * OPEN - 0.01 - qp[5] - qp[6],            // between the fingers' inner faces
  aim(c, qt, shut, v0, v1, v2, v3) { c[0] = qt[0]; c[1] = qt[1]; c[2] = qt[2]; c[3] = qt[1] - qt[2]; c[4] = qt[3] - qt[0]; c[5] = c[6] = shut ? TRAVEL : 0; c[7] = v0; c[8] = v1; c[9] = v2; c[10] = v1 - v2; c[11] = v3 - v0; },
  put(qp, qt) { qp[0] = qt[0]; qp[1] = qt[1]; qp[2] = qt[2]; qp[3] = qt[1] - qt[2]; qp[4] = qt[3] - qt[0]; qp[5] = qp[6] = 0; },
  pose: qp => ({ q: [qp[0], qp[1], qp[2], qp[4]], wrist: qp[3], half: (DESK.width(qp) + 0.01) / 2 }),
  body() {
    const { S, L1, L2, TL, lim } = DESK, f = n => n.toFixed(4);
    const finger = (name, s) => `<body name="${name}" pos="${f(s * OPEN)} 0 ${f(-TL)}" gravcomp="1"><joint name="${name}" type="slide" axis="${-s} 0 0" range="0 ${TRAVEL}" damping="4" armature="0.002"/><geom class="pad" type="box" size="0.005 0.012 0.03" pos="0 0 0.01" mass="0.05"/></body>`;
    return `<body name="turret" gravcomp="1">
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
    </body>`;
  },
  tail: () => `<equality><joint joint1="f1" joint2="f2" polycoef="0 1 0 0 0"/></equality>
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
  </actuator>`,
};

// Seeed Studio's reBot Arm B601-RS (#361), from its makers' description (github.com/Seeed-Projects/reBot-DevArm,
// Rebot_Arm_description/RS: the MuJoCo model mjcf/rs_arm.xml and urdf/ReBot_Arm_RS.urdf, as of 2026-11-23; CERN-OHL-W-2.0):
// every link where it is on the one before (`pos`, `quat`), its measured mass, centre of mass and inertia, the joints'
// axes and ranges, and the motors' peak torques (RobStride RS-06, 36 N·m, at the waist, the shoulder and the elbow;
// RS-00, 14 N·m, at the three wrist joints). Simple shapes stand in for its meshes (60 MB) where it touches things.
// Ours, not theirs: the motors' stiffness (theirs is the controller's, in their Python), the top speeds (1.5 rad/s: the
// top of the speed Seeed's web console lets the real arm move at), the fingers' force (40 N: the real one's is its
// motor's current limit, set in software; no figure is published), how far the fingers open here (7 cm of their 10),
// the rotors' inertia (`armature`, as the desk arm's: not published) and that the motors carry the arm's weight
// (`actuatorgravcomp`: within their peak torques, as their controller does).
// Its six joints: j1 the waist, j2 the shoulder, j3 the elbow, j4 the wrist's bend, j5 its turn sideways (kept at 0:
// the hand hangs straight down) and j6 the hand's own turn. The wrist (j4) is 26.5 cm above the grip when it hangs down,
// the shoulder 2 cm out from the waist's axis, and the forearm is set 0.31 rad up from its line (`B6.beta`).
// With the hand straight down, the wrist's bend (±90°) keeps the forearm from pointing more than 18° up: on the table
// itself the grip could not go higher than 13 cm at 40 cm out, too low to stack four cubes there. So it stands on a
// 12 cm riser (`B6.riser`; Seeed's own grasp scene has the arm's base 10 cm below the table instead: for small blocks).
const B6 = { beta: atan2(0.072746, 0.228), open: 0.035, gripN: 40, riser: 0.12 };
const B601 = {
  key: 'b601', name: 'reBot Arm B601-RS', maker: 'Seeed Studio',
  about: 'Seeed Studio’s open-source arm (about $1,900), from its makers’ own model: its links’ lengths and weights, its six motors’ strength. Slower (30 cm a second) and heavier, its hand straight down; on a 12 cm riser.',
  S: 0.145 + B6.riser, R0: 0.020343, L1: 0.236, L2: hypot(0.228, 0.072746), TL: 0.28971 - 0.025,
  speed: [1.5, 1.5, 1.5, 3],
  hand: 0.3,
  // q0: the waist's ±2.8 rad; a1 = π − j2 (j2: 0 .. 3.14); e = π − beta − j3 (elbow up); a1 − e (the forearm's angle): the wrist's bend, j4, is ±1.57
  lim: { q0: [-2.7, 2.7], a1: [0.15, 3.0], e: [0.35, 2.75], a2: [-2.8, 0.28], roll: 3.1 },     // roll: the hand's turn on the arm (j6: ±3.14)
  home: [0, 1.38, 1.58, 0],
  floor: 0.027,                                            // the fingertips 2.5 cm below the grip's centre: 2 mm above the table
  gripN: B6.gripN, gap: [0, 2 * B6.open],
  nq: 8,                                                   // j1..j6, the two fingers
  q: qp => [-qp[0], PI - qp[1], PI - B6.beta - qp[2], -qp[0] + qp[5]],
  yaw: qp => -qp[0] + qp[5] + PI / 2,                      // its fingers close across the hand's turn
  width: qp => qp[6] + qp[7],
  aim(c, qt, shut, v0, v1, v2, v3) {
    c[0] = -qt[0]; c[1] = PI - qt[1]; c[2] = PI - B6.beta - qt[2]; c[3] = B6.beta - PI / 2 - qt[1] + qt[2]; c[4] = 0; c[5] = qt[3] - qt[0]; c[6] = c[7] = shut ? 0 : B6.open;
    c[8] = -v0; c[9] = -v1; c[10] = -v2; c[11] = v2 - v1; c[12] = 0; c[13] = v3 - v0;
  },
  put(qp, qt) { qp[0] = -qt[0]; qp[1] = PI - qt[1]; qp[2] = PI - B6.beta - qt[2]; qp[3] = B6.beta - PI / 2 - qt[1] + qt[2]; qp[4] = 0; qp[5] = qt[3] - qt[0]; qp[6] = qp[7] = B6.open; },
  pose: qp => ({ q: [-qp[0], PI - qp[1], PI - B6.beta - qp[2], qp[5]], j: Array.from(qp.subarray(0, 6)), open: qp[6] }),
  body() {
    const j = (name, range, n, more = '') => `<joint name="${name}" axis="0 0 ${name === 'j2' ? 1 : -1}" range="${range}" damping="${name === 'j6' ? 2 : 0.5}" actuatorfrcrange="-${n} ${n}" actuatorgravcomp="true"${more}/>`;
    const finger = (name, s) => `<body name="${name}" pos="0 ${s * 0.00635} 0" gravcomp="1"><joint name="${name}" type="slide" axis="0 ${s} 0" range="0 0.05" damping="4" armature="0.002"/><geom class="pad" type="box" size="0.0325 0.00635 0.0105" pos="-0.0325 0 0" mass="0.0559"/></body>`;
    return `<geom name="riser" class="link" type="box" size="0.075 0.075 ${B6.riser / 2}" pos="0 0 ${B6.riser / 2}"/>
    <body name="link1" pos="0 0 ${B6.riser + 0.075}" gravcomp="1">
      ${j('j1', '-2.8 2.8', 36)}
      <inertial pos="0.0081765 0.0012258 0.0331420" mass="0.4658" fullinertia="0.00025207 0.00015464 0.00023416 0 -0.00002832 0"/>
      <body name="link2" pos="0.020343 0.027237 0.07" quat="0.7071055 -0.7071081 0 0" gravcomp="1">
        ${j('j2', '0 3.14', 36)}
        <inertial pos="-0.0646343 0.0202916 -0.0271552" mass="1.9641" fullinertia="0.00073374 0.01255987 0.01281387 -0.00000043 0.00000851 0.00000128"/>
        <geom class="link" type="capsule" fromto="0 0 -0.027 -0.236 0 -0.027" size="0.03"/>
        <body name="link3" pos="-0.236 0 0" gravcomp="1">
          ${j('j3', '-0.2 3.14', 36)}
          <inertial pos="0.0865213 -0.0398287 -0.0271069" mass="1.0273" fullinertia="0.00046807 0.00632695 0.00648221 -0.00003456 -0.0000426 0.00000006"/>
          <geom class="link" type="capsule" fromto="0 0 -0.027 0.228 -0.072746 -0.027" size="0.026"/>
          <body name="link4" pos="0.228 -0.072746 0.0045" gravcomp="1">
            ${j('j4', '-1.57 1.57', 14)}
            <inertial pos="0.0379558 -0.0312452 -0.0314112" mass="0.6781" fullinertia="0.00045986 0.00075258 0.00066742 0.00024219 0 0"/>
            <geom class="link" type="capsule" fromto="0 0 -0.0315 0.087 -0.048 -0.0315" size="0.024"/>
            <body name="link5" pos="0.087 -0.048 -0.03075" quat="0.7071055 -0.7071081 0 0" gravcomp="1">
              ${j('j5', '-1.57 1.57', 14)}
              <inertial pos="-0.0061876 -0.0116402 0.0380487" mass="0.5341" fullinertia="0.0000734238 0.0000551539 0.0000529920 0.0000000136 -0.0000008581 -0.0000000133"/>
              <geom class="link" type="capsule" fromto="0 0 0 0.0365 0 0.048" size="0.024"/>
              <body name="link6" pos="0.0365 0 0.048" quat="0.7071055 0 0.7071081 0" gravcomp="1">
                ${j('j6', '-3.14 3.14', 14)}
                <inertial pos="0.0000180 0 0.0043481" mass="0.1" fullinertia="0.0000044227 0.0000043719 0.0000085430 0 0.0000000002 0"/>
                <geom class="link" type="cylinder" fromto="0 0 0 0 0 0.09" size="0.03"/>
                <body name="tool" pos="0 0 0.16621" quat="-0.0000026 0.7071055 0.0000026 0.7071081" gravcomp="1">
                  <inertial pos="-0.1075570 0.0054844 0.0073475" mass="0.4678" fullinertia="0.00037354 0.0001583 0.00045353 -0.00000011 0.0000005 0.00000348"/>
                  <geom name="palm" type="box" size="0.006 0.045 0.022" pos="-0.071 0 0" friction="0.5 0.005 0.0001"/>
                  <site name="grip" pos="-0.025 0 0"/>
                  ${finger('f1', 1)}
                  ${finger('f2', -1)}
                </body>
              </body>
            </body>
          </body>
        </body>
      </body>
    </body>`;
  },
  tail: () => `<equality><joint joint1="f1" joint2="f2" polycoef="0 1 0 0 0"/></equality>
  <contact><exclude body1="f1" body2="f2"/></contact>
  <actuator>
    <position joint="j1" kp="1500" forcerange="-36 36"/>
    <position joint="j2" kp="2000" forcerange="-36 36"/>
    <position joint="j3" kp="1500" forcerange="-36 36"/>
    <position joint="j4" kp="300" forcerange="-14 14"/>
    <position joint="j5" kp="300" forcerange="-14 14"/>
    <position joint="j6" kp="60" forcerange="-14 14"/>
    <position joint="f1" kp="3000" kv="30" forcerange="${-B6.gripN} ${B6.gripN}"/>
    <position joint="f2" kp="3000" kv="30" forcerange="${-B6.gripN} ${B6.gripN}"/>
    <velocity joint="j1" kv="60" forcerange="-36 36"/>
    <velocity joint="j2" kv="80" forcerange="-36 36"/>
    <velocity joint="j3" kv="60" forcerange="-36 36"/>
    <velocity joint="j4" kv="10" forcerange="-14 14"/>
    <velocity joint="j5" kv="10" forcerange="-14 14"/>
    <velocity joint="j6" kv="1.5" forcerange="-14 14"/>
  </actuator>`,
};
export const ARMS = { desk: DESK, b601: B601 };
/** The desk arm (the first one; what a network that doesn't say is for). */
export const ARM = DESK;
const armOf = k => ARMS[k ?? 'desk'] ?? DESK;

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
  // the two notes: a way over the table worked out for it, as a car's network is given the line and the pace (#359)
  go: { n: 2, parts: ['go: out', 'go: side'], name: 'Which way to go', about: 'the way over the table to the cube, or with the cube in the fingers to where it goes: outwards, sideways (1 = 30 cm). Nothing while the grip (or the cube it holds) is still too low to travel' },
  rise: { n: 1, parts: ['rise'], name: 'The height note', about: 'how far the grip (or the cube it holds) is below the height to be at now: high above everything on the way, down only once over the cube or over where it goes (1 = 10 cm)' },
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
  tray: { name: 'Into the tray', about: 'Pick the cube up and put it down in the tray.', cubes: 1, limit: 8, exam: 20, jobs: [{ cube: 0, to: 'tray' }], inputs: ['go', 'rise', 'gap', 'beam', 'touch', 'there'] },
  stack: { name: 'Stack four', about: 'Put the four cubes on top of each other: the second on the first, the third on the second, the fourth on top.', cubes: 4, limit: 30, exam: 10, jobs: [{ cube: 1, on: 0 }, { cube: 2, on: 1 }, { cube: 3, on: 2 }], inputs: ['go', 'rise', 'gap', 'beam', 'touch', 'there'] },
};
export const SIZES = [0, 2, 4, 6, 8, 12, 16, 24, 32];

const cl = (v, a, b) => v < a ? a : v > b ? b : v;
/** MuJoCo's x, y, z (z up) as the picture's (y up), and back. */
const out3 = (x, y, z) => [x, z, -y], in3 = v => [v[0], -v[2], v[1]];

/** A seeded dice (mulberry32): the same placements for everyone. */
export function dice(seed) {
  let s = seed >>> 0;
  const f = () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  f.gauss = () => Math.sqrt(-2 * log(1 - f())) * cos(2 * Math.PI * f());
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
    if (cubes.every(o => hypot(c.r * cos(c.a) - o.r * cos(o.a), c.r * sin(c.a) - o.r * sin(o.a)) >= 0.13)) cubes.push(c);
  }
  return { cubes };
}
/** The exam's placements: the same for everyone (per scenario). */
export function examPlacements(task = 'grab', n = TASKS[task].exam) { const rnd = dice({ grab: 3359, tray: 7402, stack: 9154 }[task]); return Array.from({ length: n }, () => placement(rnd, task)); }

/** Where joints [q0, a1, e, q3] put the wrist and the grip (r from the base, y above the table; x, z the picture's; yaw: the fingers' direction, q3). A: the arm. */
export function reach(q, A = DESK) {
  const a2 = q[1] - q[2], r = A.R0 + A.L1 * cos(q[1]) + A.L2 * cos(a2), y = A.S + A.L1 * sin(q[1]) + A.L2 * sin(a2);
  return { r, wrist: y, y: y - A.TL, x: r * cos(q[0]), z: -r * sin(q[0]), yaw: q[3] };
}
/** The joints that put the grip r from the base, y above the table, a round it (the elbow up). A: the arm. */
export function joints(r, y, a = 0, A = DESK) {
  const h = y + A.TL - A.S, w = r - A.R0, d = Math.min(hypot(w, h), A.L1 + A.L2 - 1e-6), { L1, L2 } = A;
  const a1 = atan2(h, w) + acos(cl((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1)), e = Math.PI - acos(cl((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
  return [a, a1, e, 0];
}

// ---------------------------------------------------------------- the network
/** How many outputs a network has, and how many weights. */
export function shape(net) {
  const nin = net.inputs.reduce((n, id) => n + INPUTS[id].n, 0), nout = 4 + (net.roll ? 1 : 0), h = net.h | 0;
  return { nin, nout, h, weights: h ? nin * h + h + h * nout + nout : nin * nout + nout };
}
/** A network of nothing but zeros for a scenario: where a training starts. */
export function blank(task = 'grab', { h = 8, control = 'hand', roll = false, inputs, arm = 'desk' } = {}) {
  const net = { kind: 'armsim-network', ...(arm !== 'desk' && { arm }), task, control, roll: !!roll, inputs: inputs ?? [...TASKS[task].inputs, ...(control === 'joints' ? ['joints'] : []), ...(roll ? ['turn'] : [])], h };
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
  if (d.arm !== undefined && !Object.hasOwn(ARMS, d.arm)) return `arm is one of ${Object.keys(ARMS).join(', ')} (or not given: the desk arm)`;
  const n = shape(d).weights;
  if (d.w.length !== n || !d.w.every(Number.isFinite)) return `w is ${n} numbers for these inputs and this size (it has ${d.w.length})`;
  return null;
}
/** The network's outputs for what it is shown. Same layout as the car's: W1 (a row of inputs per unit), b1, W2 (a row of
 *  outputs per unit), b2; without a hidden layer W (a row per output) and the biases. Everything through tanh. */
export function forward(net, x, sh = shape(net)) {
  const { nin, nout, h } = sh, w = net.w, y = new Array(nout).fill(0); let k = 0;
  if (!h) { for (let o = 0; o < nout; o++) { let a = 0; for (let i = 0; i < nin; i++) a += w[k++] * x[i]; y[o] = a; } for (let o = 0; o < nout; o++) y[o] = tanh(y[o] + w[k++]); return y; }
  const u = new Array(h);
  for (let j = 0; j < h; j++) { let a = 0; for (let i = 0; i < nin; i++) a += w[k++] * x[i]; u[j] = a; }
  for (let j = 0; j < h; j++) u[j] = tanh(u[j] + w[k++]);
  for (let j = 0; j < h; j++) for (let o = 0; o < nout; o++) y[o] += w[k++] * u[j];
  for (let o = 0; o < nout; o++) y[o] = tanh(y[o] + w[k++]);
  return y;
}
/** Every number a network is shown and every output it has, by name, in their order (for a drawing of it). */
export function names(net) {
  return { inputs: net.inputs.flatMap(id => INPUTS[id].parts), outputs: [...(net.control === 'joints' ? ['base', 'shoulder', 'elbow'] : ['out', 'up', 'side']), ...(net.roll ? ['turn'] : []), 'grip'] };
}
/** forward() with the hidden layer's values kept: { h, y } (for a drawing; a test holds the two together). */
export function layers(net, x, sh = shape(net)) {
  const { nin, nout, h } = sh, w = net.w, u = new Array(h), y = new Array(nout).fill(0); let k = 0;
  if (!h) { for (let o = 0; o < nout; o++) { let a = 0; for (let i = 0; i < nin; i++) a += w[k++] * x[i]; y[o] = a; } for (let o = 0; o < nout; o++) y[o] = tanh(y[o] + w[k++]); return { h: [], y }; }
  for (let j = 0; j < h; j++) { let a = 0; for (let i = 0; i < nin; i++) a += w[k++] * x[i]; u[j] = a; }
  for (let j = 0; j < h; j++) u[j] = tanh(u[j] + w[k++]);
  for (let j = 0; j < h; j++) for (let o = 0; o < nout; o++) y[o] += w[k++] * u[j];
  for (let o = 0; o < nout; o++) y[o] = tanh(y[o] + w[k++]);
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
export function sceneXml(cubes = 1, arm = 'desk') {
  const A = armOf(arm);
  return `<mujoco model="${A === DESK ? 'desk arm' : A.key}">
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
    ${A.body()}
    ${Array.from({ length: cubes }, (_, i) => `<body name="cube${i}" pos="${i} 3 ${HC}"><freejoint/><geom name="cube${i}" type="box" size="${HC} ${HC} ${HC}" class="pad" mass="0.1" conaffinity="3"/></body>`).join('\n    ')}
  </worldbody>
  ${A.tail()}
</mujoco>`;
}
// One model for each number of cubes (a cube that is not there costs nothing), per MuJoCo module, and the datas handed
// back by free(), to be used again: making one costs far more than a go's first steps.
const worlds = new WeakMap();
function world(M, cubes, arm) {
  let all = worlds.get(M);
  if (!all) worlds.set(M, all = new Map());
  let w = all.get(`${arm}:${cubes}`);
  if (!w) {
    const model = M.MjModel.from_xml_string(sceneXml(cubes, arm)), site = M.mj_name2id(model, M.mjtObj.mjOBJ_SITE.value, 'grip');
    all.set(`${arm}:${cubes}`, w = { model, site, spare: [] });
  }
  return w;
}

/**
 * The arm at home and a scenario's cubes where `at` says. `free()` it when done (its memory is MuJoCo's, not the
 * garbage collector's) and don't use it after.
 */
export function createArm(M, { at = { cubes: [{ r: 0.3, a: 0, yaw: 0 }] }, task = 'grab', arm = 'desk' } = {}) {
  const A = armOf(arm), T = TASKS[task], jobs = T.jobs, W = world(M, T.cubes, A.key), { model } = W, data = W.spare.pop() ?? new M.MjData(model), NQ = A.nq;
  M.mj_resetData(model, data);
  // views straight into MuJoCo's memory: they go dead when that memory grows (another world made meanwhile), so act() looks
  let qpos = data.qpos, qvel = data.qvel, ctrl = data.ctrl, grip = data.site_xpos.subarray(3 * W.site, 3 * W.site + 3);
  const views = () => { qpos = data.qpos; qvel = data.qvel; ctrl = data.ctrl; grip = data.site_xpos.subarray(3 * W.site, 3 * W.site + 3); };
  const tray = { x: TRAY.r * cos(TRAY.a), y: TRAY.r * sin(TRAY.a) };
  const first = at.cubes[jobs[0].cube], stacked = Math.min(at.stacked | 0, jobs.length - 1);
  const qt = at.start === 'cube' ? joints(first.r, HC, first.a, A) : [...A.home];      // where the joints are ordered to be
  // each of the arm's motors is told where to be and how fast it should be moving there (so it does not lag behind a steady move)
  // The tool is turned against the base (qt[3] is its turn as seen from above, not at its joint): the fingers keep their
  // direction on the table whichever way the arm points, and close square on a cube that is not turned.
  const aim = (v0 = 0, v1 = 0, v2 = 0, v3 = 0) => A.aim(ctrl, qt, sim.shut, v0, v1, v2, v3);
  for (let i = 0; i < T.cubes; i++) {
    const c = at.cubes[i], k = NQ + 7 * i, yaw = c.yaw || 0;
    qpos[k] = c.r * cos(c.a); qpos[k + 1] = c.r * sin(c.a); qpos[k + 2] = HC; qpos[k + 3] = cos(yaw / 2); qpos[k + 4] = 0; qpos[k + 5] = 0; qpos[k + 6] = sin(yaw / 2);
  }
  // a training's later start: the first jobs already done (those cubes on the stack)
  for (let j = 0; j < stacked; j++) { const job = jobs[j], k = NQ + 7 * job.cube, o = NQ + 7 * job.on; qpos[k] = qpos[o]; qpos[k + 1] = qpos[o + 1]; qpos[k + 2] = qpos[o + 2] + CUBE; qpos[k + 3] = 1; qpos[k + 4] = qpos[k + 5] = qpos[k + 6] = 0; }
  const cube = i => NQ + 7 * i;
  const track = () => ({ near: Infinity, d0: 0, squeezed: 0, lift: 0, carry: Infinity, c0: 0, z0: 0, set: false, fresh: true });
  let off = 0;                                                 // how far from the noted height it was, summed over the decisions
  const sim = {
    task, arm: A.key, qt, t: 0, ticks: 0, shut: false, at,
    // how the scenario stands: stage (jobs done from the first: a stack knocked over goes back), done (s; null: not
    // yet), lost (a cube off the table), and for each job what the drive has done about it so far (jobs[k]: the grip's
    // nearest to its cube, decisions spent squeezing it, its highest in the fingers, how far it is from where it goes,
    // set: it was held in place)
    stage: 0, still: 0, done: null, lost: false, jobs: jobs.map(track), offNote: 0,

    /** The joints as they are: [q0, a1, e, q3]. */
    get q() { return A.q(qpos); },
    gap() { return A.width(qpos); },                                                   // between the fingers' inner faces
    /** The job to do now (the last one while the scenario waits to be called done). */
    job() { return jobs[Math.min(sim.stage, jobs.length - 1)]; },
    /** Where a job's cube has to go (MuJoCo's axes); null for a lift. */
    goal(job) { if (job.lift) return null; if (job.to === 'tray') return [tray.x, tray.y, HC]; const o = cube(job.on); return [qpos[o], qpos[o + 1], qpos[o + 2] + CUBE]; },
    /** The cube to move now as the hand has it: from the grip's centre along the fingers' travel, up and across; is it between them. */
    grasp() {
      if (seen) return seen;                                   // asked several times a decision (what it sees, the score): worked out once
      const k = cube(sim.job().cube), dx = qpos[k] - grip[0], dy = qpos[k + 1] - grip[1], dz = qpos[k + 2] - grip[2], between = inside(k);
      return seen = { k, dx, dy, dz, between, dist: hypot(dx, dy, dz), touch: between && sim.shut && sim.gap() > 0.022 };
    },
    /**
     * The notes (`go`, `rise`): a way worked out for it. Not holding: to the cube; holding: with it to where it goes (a
     * lift: straight up). The height to be at: OVER on the way, down in the last 7.5 cm over the table to the target's own
     * height. And no way to go (free: 0) until within 5 cm of that height: straight up first, the cube just set down or
     * the stack is in the way. rise: metres below the noted height; x, y: the way over the table (MuJoCo's axes).
     */
    note() {
      const g = sim.grasp(), to = sim.goal(sim.job()), z = g.touch ? qpos[g.k + 2] : grip[2];
      const x = g.touch ? (to ? to[0] - qpos[g.k] : 0) : g.dx, y = g.touch ? (to ? to[1] - qpos[g.k + 1] : 0) : g.dy, tz = g.touch ? (to ? to[2] : OVER) : qpos[g.k + 2];
      const rise = tz + (OVER - tz) * cl((hypot(x, y) - 0.015) / 0.06, 0, 1) - z;
      return { rise, x, y, free: cl(1 - rise / 0.05, 0, 1) };
    },
    /** What a network with these inputs is shown now. */
    observe(inputs) {
      const g = sim.grasp(), q = A.q(qpos), cs = cos(q[0]), sn = sin(q[0]), x = [];
      const away = (dx, dy) => dx * cs + dy * sn, side = (dx, dy) => -dx * sn + dy * cs;     // away from the base; the way q0 turns
      for (const id of inputs) {
        if (id === 'cube') x.push(cl(away(g.dx, g.dy) / 0.2, -2, 2), cl(g.dz / 0.2, -2, 2), cl(side(g.dx, g.dy) / 0.2, -2, 2));
        else if (id === 'gap') x.push(cl((sim.gap() - A.gap[0]) / (A.gap[1] - A.gap[0]) * 2 - 1, -1, 1));
        else if (id === 'height') x.push(grip[2] / 0.3 - 0.5);
        else if (id === 'beam') x.push(g.between ? 1 : 0);
        else if (id === 'touch') x.push(g.touch ? 1 : 0);
        else if (id === 'goal') { const to = sim.goal(sim.job()); if (!to) x.push(0, 0, 0); else { const dx = to[0] - qpos[g.k], dy = to[1] - qpos[g.k + 1]; x.push(cl(away(dx, dy) / 0.3, -2, 2), cl((to[2] - qpos[g.k + 2]) / 0.3, -2, 2), cl(side(dx, dy) / 0.3, -2, 2)); } }
        else if (id === 'rise') x.push(cl(sim.note().rise / 0.1, -2, 2));
        else if (id === 'go') { const n = sim.note(); x.push(cl(away(n.x, n.y) / 0.3 * n.free, -2, 2), cl(side(n.x, n.y) / 0.3 * n.free, -2, 2)); }
        else if (id === 'there') x.push(sim.goal(sim.job()) && there(sim.job()) ? 1 : 0);                 // the last cube's, once all are placed: or the fingers shut on it again while the scenario waits to be called done
        else if (id === 'turn') { const a = 4 * (2 * atan2(qpos[g.k + 6], qpos[g.k + 3]) - A.yaw(qpos)); x.push(sin(a), cos(a)); }
        else if (id === 'joints') x.push(q[1] - 0.8, q[2] - 1.55, hypot(grip[0], grip[1]) / 0.3 - 1);
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
      const want = [0, 0, 0, cl(+roll || 0, -1, 1) * A.speed[3]], dt = 1 / HZ;
      if (jv) for (let i = 0; i < 3; i++) want[i] = cl(+jv[i] || 0, -1, 1) * A.speed[i];
      else if (hv || wv) {
        let vr, vy, vt;
        if (hv) [vr, vy, vt] = hv.map(v => cl(+v || 0, -1, 1) * A.hand);
        else { const cs = cos(qt[0]), sn = sin(qt[0]), [vx, vz, vup] = in3(wv.map(v => cl(+v || 0, -1, 1) * A.hand)); vr = vx * cs + vz * sn; vt = -vx * sn + vz * cs; vy = vup; }
        const a2 = qt[1] - qt[2], s1 = sin(qt[1]), c1 = cos(qt[1]), s2 = sin(a2), c2 = cos(a2), det = -A.L1 * A.L2 * sin(qt[2]);
        const d1 = (A.L2 * c2 * vr + A.L2 * s2 * vy) / det, d2 = (-A.L1 * c1 * vr - A.L1 * s1 * vy) / det;
        want[0] = vt / Math.max(0.08, reach(qt, A).r); want[1] = d1; want[2] = d1 - d2;
        const over = Math.max(1, ...[0, 1, 2].map(i => Math.abs(want[i]) / A.speed[i]));
        for (let i = 0; i < 3; i++) want[i] /= over;
      }
      const n = [qt[0] + want[0] * dt, qt[1] + want[1] * dt, qt[2] + want[2] * dt, qt[3] + want[3] * dt];
      if (n[0] < A.lim.q0[0] || n[0] > A.lim.q0[1]) n[0] = qt[0];
      if (A.lim.roll) n[3] = cl(n[3], n[0] - A.lim.roll, n[0] + A.lim.roll);
      const { a1, e, a2 } = A.lim, ok = v => v[1] >= a1[0] && v[1] <= a1[1] && v[2] >= e[0] && v[2] <= e[1] && (!a2 || (v[1] - v[2] >= a2[0] && v[1] - v[2] <= a2[1])) && reach(v, A).y >= A.floor && reach(v, A).r >= 0.1;
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
      return { arm: A.key, ...A.pose(qpos), grip: out3(grip[0], grip[1], grip[2]), yaw: A.yaw(qpos), shut: sim.shut,
        cubes, now: sim.job().cube, tray: T.jobs[0].to === 'tray' ? { x: tray.x, z: -tray.y } : null, goal: to && out3(to[0], to[1], to[2]), stage: sim.stage, of: jobs.length, t: sim.t, done: sim.done };
    },
    free() { W.spare.push(data); },
  };
  let seen = null;                                             // grasp() as worked out since the last decision
  // is the cube at qpos[k] between the fingers (within 3 cm of the grip's centre along their travel, across it and up or down)
  const inside = k => {
    const dx = qpos[k] - grip[0], dy = qpos[k + 1] - grip[1], dz = qpos[k + 2] - grip[2], yaw = A.yaw(qpos), cs = cos(yaw), sn = sin(yaw);
    return Math.abs(dx * cs + dy * sn) < 0.03 && Math.abs(dz) < 0.03 && Math.abs(-dx * sn + dy * cs) < 0.03;
  };
  // is a job's cube where it goes (in the tray's square, or within 2 cm of the middle of the cube below; at its height)
  const there = job => {
    const k = cube(job.cube), to = sim.goal(job), dx = qpos[k] - to[0], dy = qpos[k + 1] - to[1];
    return (job.to === 'tray' ? Math.max(Math.abs(dx), Math.abs(dy)) < TRAY.half - HC : hypot(dx, dy) < 0.02) && Math.abs(qpos[k + 2] - to[2]) < 0.008;
  };
  // is a job done as things stand: its cube where it goes, at rest, and let go of. One already counted (`kept`) stays
  // done while its cube is where it goes: a stack shaken as the next cube is set on it is not knocked down (#361)
  const placed = (job, kept) => {
    const k = cube(job.cube), v = NQ - 1 + 6 * job.cube + 1;
    if (!there(job) || !sim.jobs[jobs.indexOf(job)].set) return false;                    // set: held in the fingers while in place. Pushed along the table, dropped or thrown does not count
    if (kept) return true;
    if (hypot(qvel[v], qvel[v + 1], qvel[v + 2]) > 0.03) return false;
    // let go of: not between the fingers, or they are open. (Not "6 cm from the grip": the cube below the one being put on
    // a stack is 5 cm under the grip, and the stack counted as knocked down while the top one was set on it, #361)
    return !inside(k) || (!sim.shut && sim.gap() > CUBE + 0.012);
  };
  // the scenario's book-keeping after each decision
  const score = () => {
    for (let i = 0; i < T.cubes; i++) { const k = cube(i); if (qpos[k + 2] < -0.2 || hypot(qpos[k], qpos[k + 1]) > 0.9) sim.lost = true; }
    if (sim.done != null) return;
    if (!jobs[0].lift) {
      let st = 0; while (st < jobs.length && placed(jobs[st], st < sim.stage)) st++;
      if (st !== sim.stage) { sim.stage = st; seen = null; }
      sim.still = st === jobs.length ? sim.still + 1 : 0;
      if (sim.still >= HZ / 4) { sim.done = sim.t; return; }
      if (st === jobs.length) return;
    }
    const job = sim.job(), tr = sim.jobs[sim.stage], g = sim.grasp(), to = sim.goal(job), z = qpos[g.k + 2];
    if (tr.fresh) { tr.fresh = false; tr.d0 = Math.max(0.1, g.dist); tr.z0 = z; tr.c0 = to ? Math.max(0.05, hypot(to[0] - qpos[g.k], to[1] - qpos[g.k + 1], to[2] - z)) : 0; }
    tr.near = Math.min(tr.near, g.dist);
    if (g.touch) tr.squeezed++;
    const inHand = g.dist < 0.03, up = z - tr.z0;
    if (inHand) tr.lift = Math.max(tr.lift, Math.min(up, LIFT));
    // put there: in place while squeezed, or squeezed a decision ago (a network that lets go the moment it is in place has put it there too)
    if (to && (g.touch || tr.held) && tr.lift > 0.02 && there(job)) tr.set = true;
    tr.held = g.touch;
    off += Math.min(0.2, Math.abs(sim.note().rise)); sim.offNote = off / sim.ticks;
    if (to && tr.lift > 0.02) tr.carry = hypot(to[0] - qpos[g.k], to[1] - qpos[g.k + 1], to[2] - z);       // how far it is now, not the nearest it came: dropped on the way is not carried
    if (job.lift) { sim.still = inHand && up >= LIFT ? sim.still + 1 : 0; if (sim.still >= HZ / 2) { sim.stage = 1; sim.done = sim.t; } }
  };
  // settle: the arm where it is ordered to be, the cubes on the table (or on each other), nothing moving
  A.put(qpos, qt);
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
export function attempt(M, net, at, { task = net.task || 'grab', limit = TASKS[task].limit, arm = net.arm || 'desk' } = {}) {
  const sim = createArm(M, { at, task, arm }), sh = shape(net), jobs = TASKS[task].jobs;
  for (let i = 0; i < limit * HZ && sim.done == null && !sim.lost; i++) sim.act(orders(net, forward(net, sim.observe(net.inputs), sh)));
  // 1 for keeping to the height note (less the further off it was on average, nothing from 10 cm): from nothing, going
  // up is what has to come first, and nothing else pays for it
  let fit = 12 * Math.min(sim.stage, jobs.length) + (net.inputs.includes('rise') ? Math.max(0, 1 - sim.offNote / 0.1) : 0);
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
