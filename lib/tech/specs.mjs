// The sim's technical figures for the public /tech page (#335), read from the sim itself (public/sim/engine.js):
// the cars' specs (ROAD_CARS, the buggy's `car` / ENG / PRESSURES / BUGGY), the grounds (SURFACES) and the physics
// step (DT). The engine's top-level literals are cut out by name and evaluated on their own, with stand-ins for the
// little they touch (THREE.Vector3, spokeFace), so the page never disagrees with what the sim drives.
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { torqueAt } from './curve.mjs';

export { torqueAt };

const ENGINE = path.join(process.cwd(), 'public/sim/engine.js');

/** The text of a top-level statement, from `head` to the end of the bracketed literal that follows it. */
function cut(src, head) {
  const at = src.indexOf(head);
  if (at < 0) throw new Error(`tech specs: "${head}" not found in engine.js`);
  let i = at + head.length;
  while (i < src.length && !'{[('.includes(src[i])) i++;
  let depth = 0, q = '';
  for (; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = ''; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if ('{[('.includes(c)) depth++;
    else if ('}])'.includes(c) && --depth === 0) return src.slice(at, i + 1) + ';';
  }
  throw new Error(`tech specs: "${head}" never closes`);
}

class Vec { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } clone() { return new Vec(this.x, this.y, this.z); } }

function evaluate(src) {
  const parts = [
    'const DT = ' + /const DT = ([^;]+);/.exec(src)[1] + ';',
    cut(src, 'const SURFACES ='),
    cut(src, 'let PRESSURES ='),
    cut(src, 'const car ='),
    cut(src, 'let ENG ='),
    cut(src, 'function roadSpec(o)').slice(0, -1),
    cut(src, 'const ROAD_CARS ='),
    cut(src, 'const BUGGY ='),
    cut(src, 'const VEHICLE_LIST ='),
    'const SPLITS = ' + /const SPLITS = (\[[^\]]*\]);/.exec(src)[1] + ';',
    '({ DT, SURFACES, PRESSURES, car, ENG, ROAD_CARS, BUGGY, VEHICLE_LIST, SPLITS })',
  ];
  const ctx = vm.createContext({ THREE: new Proxy({}, { get: () => Vec }), spokeFace: () => null, buggy: {}, Math });
  return vm.runInContext(parts.join('\n'), ctx, { timeout: 1000 });
}

const r = (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d;
const TAU = 2 * Math.PI;

/** Full-throttle torque and power from idle to the limiter, every 100 rpm (and the limiter itself). */
function curves(eng) {
  const pts = [];
  for (let rpm = Math.ceil(eng.idle / 100) * 100; rpm < eng.limiter; rpm += 100) pts.push(rpm);
  pts.push(eng.limiter);
  return pts.map(rpm => { const t = torqueAt(eng.curve, rpm); return { rpm, torque: r(t, 1), power: r(t * rpm * TAU / 60 / 1000, 1) }; });
}

function engineOf(eng) {
  const pts = curves(eng);
  const pk = pts.reduce((a, b) => (b.power > a.power ? b : a)), tq = pts.reduce((a, b) => (b.torque > a.torque ? b : a));
  const flat = pts.filter(p => p.torque >= tq.torque - 0.5);
  return {
    idle: eng.idle, limiter: eng.limiter, curve: eng.curve, gears: eng.gears, finalDrive: eng.fd, reverse: eng.rev, efficiency: eng.eff,
    stall: eng.stall, shiftUp: [eng.upLo, eng.upHi], shiftDown: [eng.dnLo, eng.dnHi],
    peakPower: pk.power, peakPowerRpm: pk.rpm, peakTorque: tq.torque, peakTorqueRpm: [flat[0].rpm, flat[flat.length - 1].rpm], points: pts,
  };
}

/** Everything a car is in the physics, in SI units (and psi / kPa for the tires). */
function carOf(key, V, list) {
  const road = key !== 'buggy', eng = engineOf(V.engine ?? V.eng), m = V.mass, P = V.pressures;
  let wb, trackF, trackR, front, length, width, height, R, tireW, rim, Iw, K, REST, CB, CR, I;
  if (road) {
    wb = V.wb; trackF = V.trackF; trackR = V.trackR; front = V.frontWeight; length = V.L; height = V.H;
    width = 2 * Math.max(...V.halfW.map(p => p[1])); R = V.tireR; tireW = V.tireW; rim = V.rimR;
    Iw = V.Iw || (key === 'supra' ? 1.4 : key === 'x7' ? 2.1 : 1.8);                   // makeRoadVehicle's defaults
    K = V.K; REST = V.REST; CB = 2 * 0.3 * Math.sqrt(K * m / 4); CR = 2 * 0.45 * Math.sqrt(K * m / 4);
    I = { pitch: m * (length ** 2 + height ** 2) / 12 * 0.75, yaw: m * (length ** 2 + width ** 2) / 12 * 0.75, roll: m * (width ** 2 + height ** 2) / 12 * 0.7 };
  } else {
    const w = V.wheels.map(x => x.hp), zf = w[0].z, zr = w[2].z;
    wb = zf - zr; trackF = 2 * Math.abs(w[0].x); trackR = 2 * Math.abs(w[2].x); front = -zr / wb;
    length = V.box[1] - V.box[2]; width = 2 * V.box[0]; height = null;
    R = V.R - P[1].defl; tireW = P[1].w; rim = null; Iw = V.Iw; K = V.K; REST = V.REST; CB = V.CB; CR = V.CR;
    I = { pitch: V.I.x, yaw: V.I.y, roll: V.I.z };
  }
  const own = V.split ?? 0.5;
  return {
    key, name: V.name, short: V.short, blurb: list?.blurb ?? V.blurb ?? '',
    mass: m, frontWeight: r(front), wheelbase: r(wb), trackF: r(trackF), trackR: r(trackR), length: r(length, 2), width: r(width, 2), height: height == null ? null : r(height, 2),
    inertia: { pitch: Math.round(I.pitch), yaw: Math.round(I.yaw), roll: Math.round(I.roll) },
    drive: V.awd ? 'awd' : 'rwd', awdSwitchable: !V.awdFixed, split: own,
    engine: eng, powerToWeight: r(eng.peakPower / m * 1000, 0),
    brakeTorque: V.brake, steerLock: V.steerLock, cda: V.cda,
    suspension: { spring: K, travel: REST, bump: Math.round(CB), rebound: Math.round(CR) },
    tire: { radius: r(R), width: r(tireW), rim: rim == null ? null : r(rim), wheelInertia: Iw },
    pressures: P.map(p => ({ psi: p.psi, kpa: p.kpa, width: p.w, deflection: p.defl })),
    aids: road, sound: V.sound,
  };
}

function build(src) {
  const E = evaluate(src);
  const B = { ...E.BUGGY, eng: E.ENG, pressures: E.PRESSURES, Iw: E.car.Iw, wheels: E.car.wheels, REST: E.car.REST, K: E.car.K, CB: E.car.CB, CR: E.car.CR, R: E.car.R, I: E.car.I, mass: E.car.mass };
  const cars = Object.keys(E.VEHICLE_LIST).map(k => carOf(k, k === 'buggy' ? B : E.ROAD_CARS[k], E.VEHICLE_LIST[k]));
  const grounds = Object.entries(E.SURFACES).map(([key, s]) => ({
    key, name: s.name, stiffness: s.k, packedStiffness: s.k * (1 + s.kComp), friction: s.tanPhi, packedFriction: s.tanPhi + s.tanPhiComp,
    cohesion: s.coh, dig: s.dig, compaction: s.rc, rigid: !!s.rigid, slipPeak: s.s0 ?? 0.13, slipAngle: s.a0 ?? 0.11, slide: s.slide ?? 0, rut: s.rut,
  }));
  return { hz: Math.round(1 / E.DT), splits: E.SPLITS, cars, grounds };
}

let cache = null;
/** The sim's figures, read again when engine.js changes. */
export function techSpecs(file = ENGINE) {
  const t = statSync(file).mtimeMs;
  if (cache?.file !== file || cache.t !== t) cache = { file, t, specs: build(readFileSync(file, 'utf8')) };
  return cache.specs;
}
