// carsim.mjs's own API (#355), around the sim's engine. Not a module by itself: build.mjs puts the engine's source
// at the ENGINE mark, inside __engine, so that what follows the mark is in the engine's scope and reads its functions
// and state by name (simulate, car, lap, TRACK, botPath, aiObserve...). Documented in docs/simulator.md: a change
// here is a change there. test/sim-module.test.mjs builds the module and uses every part of it.

// a stand-in for anything of the page's: any property, call or `new` gives it back; '' as a string, 0 as a number
const __stub = new Proxy(function () { }, {
  get: (t, k) => k === Symbol.toPrimitive ? (h => h === 'number' ? 0 : '') : k === Symbol.iterator ? function* () { } : k === Symbol.hasInstance ? () => false : k === 'then' ? undefined : k === 'length' ? 0 : __stub,
  apply: () => __stub, construct: () => __stub, set: () => true, deleteProperty: () => true });

// the page the engine thinks it is in: a storage of its own, no screen, no network, timers that hold nothing up
function __page(store) {
  const mem = new Map(Object.entries(store)), timers = new Set(), real = globalThis, make = function () { return __stub; };
  const ls = { getItem: k => mem.has(k) ? mem.get(k) : null, setItem: (k, v) => { mem.set(k, String(v)); }, removeItem: k => { mem.delete(k); }, clear: () => mem.clear(), key: i => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
  const timer = start => (f, ms, ...a) => { const t = start(f, ms, ...a); t?.unref?.(); timers.add(t); return t; };
  const own = { __aiWorker: true, __aiwStub: make, __timers: timers, document: __stub, localStorage: ls, sessionStorage: ls, innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
    location: { search: '', hash: '', href: 'http://carsim.invalid/sim/index.html', origin: 'http://carsim.invalid', pathname: '/sim/index.html', protocol: 'http:', host: 'carsim.invalid', hostname: 'carsim.invalid', assign() { }, replace() { }, reload() { } },
    navigator: { hardwareConcurrency: 1, userAgent: 'carsim-module', language: 'en', maxTouchPoints: 0, clipboard: __stub, getGamepads: () => [] },
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => { },
    setTimeout: timer(real.setTimeout.bind(real)), setInterval: timer(real.setInterval.bind(real)),
    fetch: () => Promise.reject(new Error('carsim.mjs does not use the network')),
    __aiwAddons: { OrbitControls: make, GLTFLoader: make, RoundedBoxGeometry: class extends THREE.BoxGeometry { constructor(w, h, d) { super(w, h, d); } }, mergeGeometries: () => new THREE.BufferGeometry() } };
  for (const k of __PAGE) if (!(k in own)) own[k] = __stub;
  // (what the engine asks its window for and isn't the page's: the real thing, Math, performance...; else nothing)
  const env = new Proxy(own, { get: (t, k) => k in t ? t[k] : real[k], has: (t, k) => k in t || k in real });
  own.window = own.self = own.globalThis = own.parent = own.top = env;
  return env;
}

export const GROUNDS = ['sand', 'earth', 'road'];

/**
 * A simulator: one car on one course, stepped by you. Each call makes a world of its own (about 200 MB, a few seconds).
 * options: { car = 'buggy', ground = the course's own or 'sand', course = the built-in figure of eight,
 *            setup = { pressure, awd, split, aids } }
 */
export async function createSim(options = {}) {
  const o = options || {}, store = {};
  if (o.ground != null && !GROUNDS.includes(o.ground)) throw new Error(`createSim: ground is one of ${GROUNDS.join(', ')}`);
  // a course, or the site's answer around one (/api/tracks/<id>: { track: { course } }, null for the figure of eight)
  const w = o.course?.track ?? o.course, c = w && typeof w === 'object' && 'course' in w ? w.course : w;
  if (c != null) {
    if (!Array.isArray(c.wp) || c.wp.length < 3 || !c.wp.every(p => Array.isArray(p) && Number.isFinite(+p[0]) && Number.isFinite(+p[1]))) throw new Error('createSim: course needs wp, at least 3 waypoints [x, z]');
    const ground = o.ground || (c.road ? 'road' : c.base === 'earth' ? 'earth' : 'sand');
    store['sandbuggy.course'] = JSON.stringify({ ...c, base: ground === 'sand' ? 'sand' : 'earth', road: ground === 'road' });   // (the road is always on earth)
  } else if (o.ground) store['sandbuggy.surface'] = o.ground;
  if (o.car != null) store['sandbuggy.vehicle'] = String(o.car);
  const env = __page(store), make = await __engine(env, ...__PAGE.map(k => env[k]));
  for (let t0 = Date.now(); !env.__sim;) {                             // (the engine finishes starting in a timer of its own)
    if (Date.now() - t0 > 120000) throw new Error('createSim: the sim did not start');
    await new Promise(r => setTimeout(r, 10));
  }
  const sim = make(env);
  if (o.car != null && sim.car !== String(o.car)) { sim.dispose(); throw new Error(`createSim: no car "${o.car}" (${sim.cars.map(c => c.key).join(', ')})`); }
  if (o.setup) sim.setup(o.setup);
  sim.reset();
  return sim;
}

function __engine(ENV, /*__PARAMS__*/) {
  const { OrbitControls, RoundedBoxGeometry, mergeGeometries, GLTFLoader } = ENV.__aiwAddons, __aiwStub = ENV.__aiwStub;
  return (async () => {
/*__ENGINE__*/
    // ------------------------------------------------------------------ the API, in the engine's scope
    return function __api(env) {
      const STEP = 1 / 60;                                             // a step: 4 of the physics' own (DT, 1/240 s)
      const ctl = { steer: 0, throttle: 0, brake: 0, handbrake: false };
      const st = { i: -1, dist: 0, lat: 0 };                           // where the car is along the course (aiTrack's)
      let ticks = 0, gone = false, pilot = null;                      // ticks: steps driven since the last reset
      const num = (v, lo, hi, was) => Number.isFinite(+v) ? clamp(+v, lo, hi) : was;
      const alive = () => { if (gone) throw new Error('this sim was disposed of'); };
      // the nose's direction on the ground, from the body itself (the engine's `fwd` is the last step's)
      const nose = () => { const q = car.q, x = 2 * (q.x * q.z + q.w * q.y), z = 1 - 2 * (q.x * q.x + q.y * q.y), l = Math.hypot(x, z) || 1; return { x: x / l, z: z / l }; };
      const ground = () => ROAD ? 'road' : COURSE.base;
      const inputsOf = () => AI_INPUTS.map(d => ({ id: d.id, names: [...d.names], about: d.tip }));
      function follow() { return aiTrack(st, car.pos.x, car.pos.z); }
      // what is wrong with a network aiImport refused, for whoever made it by hand
      function notNet(d) {
        if (!d || typeof d !== 'object' || Array.isArray(d)) return ' (an object: { inputs, h, w })';
        const known = AI_INPUTS.map(q => q.id), ins = Array.isArray(d.inputs) ? d.inputs : null, bad = ins?.find(id => !known.includes(id));
        if (bad !== undefined) return `: no input "${bad}" (${known.join(', ')})`;
        if (!AI_SIZES.includes(d.h)) return `: h, the hidden layer's units, is one of ${AI_SIZES.join(', ')}`;
        const np = aiShape(ins || AI_DEFAULT_INPUTS, !!d.handbrake, d.h).np, bare = a => Array.isArray(a) && a.length === np && a.every(Number.isFinite);
        if (!bare(d.w)) return `: w is ${np} numbers for these inputs and this size${Array.isArray(d.w) && d.w.length !== np ? ` (it has ${d.w.length})` : ''}`;
        if (d.best != null && !bare(d.best)) return `: best, when given, is ${np} numbers as w`;
        return ' (kind "carsim-autopilot", its weights for its inputs and size)';
      }
      const sim = {
        version: VERSION, dt: STEP,
        /** every car: { key, name, about } */
        get cars() { return Object.entries(VEHICLE_LIST).map(([key, v]) => ({ key, name: v.name, about: v.blurb })); },
        get grounds() { return [...GROUNDS]; },
        get car() { return VEH.key; },
        get ground() { return ground(); },
        /** every input a network can be given (observe): { id, names, about } */
        get inputs() { return inputsOf(); },
        /** seconds driven since the last reset */
        get time() { return ticks / 60; },

        /** the car back before the start line, repaired and standing; the ground as built; no lap yet */
        reset() {
          alive();
          if (pilot) { AI.drive = false; pilot = null; }
          if (!AI.freshC) aiFreshGround();
          aiGroundBack();                                              // (the ruts and the packing of the driving before: gone)
          restartRun(); aiPlaceCar(0, 0, true, true, false);           // (as a fresh car: gear, revs, wheel spin)
          env.__sim.override = { steer: 0, throttle: 0, brake: 1, handbrake: true };
          for (let i = 0; i < 45; i++) simulate(STEP);                 // (it is put down from 0.3 m up: on its wheels before the clock starts)
          car.throttle = 0; car.steer = 0;
          Object.assign(lap, { lapNo: 0, last: null, lastValid: true, best: null, bestSplits: [], laps: [], valid: [], time: 0 });
          Object.assign(ctl, { steer: 0, throttle: 0, brake: 0, handbrake: false });
          Object.assign(st, { i: -1, dist: 0, lat: 0, pv: null, gf: 0, gs: 0 });
          acc = 0; ticks = 0; env.__sim.override = ctl;
          follow(); st.dist = 0;
          return sim.state();
        },
        /**
         * Drive: controls { steer: -1..1 (+ left), throttle: 0..1, brake: 0..1, handbrake: bool } (what is left out stays
         * as it was), held for `steps` steps of 1/60 s. With a network driving (autopilot), the controls are its own.
         */
        step(controls, steps = 1) {
          alive();
          if (typeof controls === 'number') { steps = controls; controls = null; }
          if (controls) {
            ctl.steer = num(controls.steer, -1, 1, ctl.steer); ctl.throttle = num(controls.throttle, 0, 1, ctl.throttle); ctl.brake = num(controls.brake, 0, 1, ctl.brake);
            if (controls.handbrake !== undefined) ctl.handbrake = !!controls.handbrake;
          }
          env.__sim.override = ctl;
          const n = Math.max(1, Math.min(60 * 3600, Math.round(steps)));
          for (let i = 0; i < n; i++) { simulate(STEP); follow(); }    // (followed every step: aiTrack looks 14 m ahead of where it last was)
          ticks += n;
          return sim.state();
        },
        /** where everything is now, as plain numbers (metres, seconds, radians, m/s) */
        state() {
          alive();
          const bi = follow(), Pt = botPath(), p = Pt.P[bi], half = aiHalfW(), f = nose(), yaw = Math.atan2(f.x, f.z), E = car.eng, q = car.q, v = car.vel.x * f.x + car.vel.z * f.z;
          if (AI.s0path !== Pt) aiLineAt(0);                           // (where the start line is along the centre line)
          const along = (((bi - AI.s0) % Pt.n) + Pt.n) % Pt.n * Pt.ds;
          return {
            time: ticks / 60,
            car: {
              x: car.pos.x, y: car.pos.y, z: car.pos.z, heading: yaw,
              speed: v, kmh: Math.abs(v) * 3.6, vx: car.vel.x, vy: car.vel.y, vz: car.vel.z, yawRate: car.w.y,
              roll: Math.asin(clamp(2 * (q.x * q.y + q.w * q.z), -1, 1)), pitch: Math.asin(clamp(2 * (q.y * q.z - q.w * q.x), -1, 1)),
              rpm: E.rpm, gear: E.reverse ? -1 : E.gear, steer: car.steer, condition: carCondition(), wrecked: !!car.wrecked,
            },
            controls: pilot && AI.lastCtl ? { steer: AI.lastCtl.steer, throttle: AI.lastCtl.throttle, brake: AI.lastCtl.brake, handbrake: !!AI.lastCtl.handbrake } : { ...ctl },
            wheels: car.wheels.map(w => ({ name: w.name, contact: !!w.contact, slip: w.contact ? w.slip || 0 : 0, sink: w.contact && !w.deck ? w.sink || 0 : 0, load: w.contact ? w.load || 0 : 0,
              ground: w.contact ? (w.deck ? 'bridge' : w.surf?.name?.toLowerCase() || '') : '' })),
            lap: { number: lap.lapNo, started: lap.started, time: lap.started ? lap.time : 0, last: lap.last, lastValid: lap.lastValid !== false, best: lap.best, nextGate: lap.next, gates: TRACK.gates.length, missed: [...(lap.missed || [])] },
            track: { along, driven: st.dist, offset: st.lat, halfWidth: half, on: Math.abs(st.lat) <= half, headingError: wrapPi(yaw - Math.atan2(p.tx, p.tz)), length: Pt.len },
          };
        },
        /**
         * What a network of the lab is shown, for these inputs (ids; the lab's first seven by default): { names, values },
         * each value scaled as the network gets it (inputs says what each is).
         */
        observe(ids) {
          alive();
          if (pilot && ids) throw new Error('observe: a network is driving, with its own inputs (observe() gives those)');
          if (ids) {
            const known = AI_INPUTS.map(d => d.id), bad = ids.filter(id => !known.includes(id));
            if (bad.length) throw new Error(`observe: no input "${bad[0]}" (${known.join(', ')})`);
            if (ids.join() !== AI.inputs.join()) aiConfig(ids, AI.hb);
          } else if (!pilot && AI.inputs.join() !== AI_DEFAULT_INPUTS.join()) aiConfig(AI_DEFAULT_INPUTS, AI.hb);
          aiObserve(st, STEP);
          return { names: [...AI.names], values: Array.from(aiX.subarray(0, AI.nIn)) };
        },
        /** the course: its centre line every metre or so and its gates (the first is the start line) */
        course() {
          alive();
          const Pt = botPath();
          return { key: courseKey(), ground: ground(), length: Pt.len, halfWidth: aiHalfW(), spacing: Pt.ds,
            line: Pt.P.map(p => ({ x: p.x, z: p.z, heading: Math.atan2(p.tx, p.tz), curvature: p.k, pace: p.v })),
            gates: TRACK.gates.map(g => ({ x: g.p.x, z: g.p.z, heading: Math.atan2(g.t.x, g.t.z), halfWidth: g.half })),
            waypoints: COURSE.wp.map(p => [p[0], p[1]]) };
        },
        heightAt(x, z) { alive(); return heightAt(+x, +z); },
        groundAt(x, z) { alive(); return surfAtCell(cellIndex(+x, +z)).name.toLowerCase(); },
        /** the car's setup: { pressure (index), awd, split (the front's share, 0..1), aids }; what is left out stays */
        setup(s = {}) {
          alive();
          if (s.awd !== undefined && !SETUP.drive(!!s.awd)) throw new Error(`setup: the ${VEH.name} is built one way`);
          if (s.pressure !== undefined && !SETUP.pressure(s.pressure | 0)) throw new Error(`setup: pressure is an index, 0 to ${PRESSURES.length - 1}`);
          if (s.split !== undefined && !SETUP.split(+s.split)) throw new Error('setup: split is the front\'s share, 0 to 1, on a car driving all four wheels');
          if (s.aids !== undefined) { if (!VEH.aids && s.aids) throw new Error(`setup: the ${VEH.name} has no driver aids`); car.aids = !!s.aids; }
          const g = SETUP.get();
          return { car: g.key, awd: g.awd, awdFixed: g.awdFixed, split: g.split, pressure: g.p, pressures: g.pressures, aids: !!(VEH.aids && car.aids), mass: g.mass, power: g.power };
        },
        /** another car, on the same course (then reset) */
        setCar(key) {
          alive();
          if (!VEHICLE_LIST[key]) throw new Error(`setCar: no car "${key}" (${Object.keys(VEHICLE_LIST).join(', ')})`);
          if (VEH.key !== key) switchVehicle(key);
          return sim.reset();
        },
        repair() { alive(); repairCar(); return sim.state(); },
        /**
         * A network of the lab at the wheel (its file: Save to file in the lab, or the site's /api/networks export), as in
         * the game: its decisions every 1/60 s, with its own inputs. Then step() needs no controls. false: yours again.
         */
        autopilot(net) {
          alive();
          if (!net) { AI.drive = false; pilot = null; return null; }
          // a network's file (the lab's Save to file), or the site's answer around one (/api/networks/<id>: { network })
          const got = typeof net === 'string' ? JSON.parse(net) : net, n0 = got?.network ?? got?.autopilot?.training ?? got;
          // (one that doesn't say where it was made, a network of your own making: it is this car's and this course's)
          const d = n0 && typeof n0 === 'object' && !Array.isArray(n0) ? { ...n0, kind: n0.kind || 'carsim-autopilot', vehicle: n0.vehicle || VEH.key, vehicleName: n0.vehicleName || (n0.vehicle ? '' : VEH.name), course: n0.course || courseKey() } : n0;
          // (the lab takes its usual inputs in place of ones it doesn't know: here that is a mistake to hear about)
          const strange = !!d && typeof d === 'object' && Array.isArray(d.inputs) && d.inputs.some(id => !AI_INPUTS.some(q => q.id === id));
          if (strange || !aiImport(d, 'Network')) throw new Error(`autopilot: not a carsim network${notNet(d)}`);
          sim.reset();
          AI.drive = true; AI.race = null; AI.other = null; AI.dst = st; AI.dCtl = null; AI.dAcc = 0; AI.map = null;
          pilot = { vehicle: d.vehicle || null, course: d.course || null, weights: AI.np, hidden: AI.h, inputs: [...AI.inputs], handbrake: !!AI.hb,
            sameCar: d.vehicle === VEH.key, sameCourse: d.course === courseKey(), bestLap: d.bestLap ?? null };
          return { ...pilot };
        },
        /**
         * The lab's own training, here: `generations` more for this car on this course (each tries a population of
         * variations of the network and moves towards the better ones), from where the last call left it, or from the
         * network last put at the wheel. options: { hidden (0, 2, 4... 64), inputs (ids), handbrake }: the network's shape
         * (another shape is another training, from nothing); settings: the lab's own (sim.raw.aiCfg's: pop, sigma, lr...).
         * → { generation, bestLap (the lab's exam, a lap from the start line; null: none finished yet), fitness, network }
         */
        train(generations = 1, options = {}) {
          alive();
          if (pilot) { AI.drive = false; pilot = null; }
          const o = options || {}, cfg = {};
          for (const k in (o.settings || {})) { if (!(k in AI_CFG)) throw new Error(`train: no setting "${k}" (${Object.keys(AI_CFG).join(', ')})`); cfg[k] = o.settings[k]; }
          if (o.hidden != null) { if (!AI_SIZES.includes(o.hidden)) throw new Error(`train: hidden is one of ${AI_SIZES.join(', ')}`); cfg.h = o.hidden; }
          if (o.inputs != null) {
            const known = AI_INPUTS.map(d => d.id), bad = Array.isArray(o.inputs) && o.inputs.length ? o.inputs.find(id => !known.includes(id)) : '';
            if (bad !== undefined) throw new Error(`train: no input "${bad}" (${known.join(', ')})`);
            cfg.inputs = [...o.inputs];
          }
          if (o.handbrake != null) cfg.hb = !!o.handbrake;
          const r = aiTrainSync(clamp(Math.round(+generations) || 1, 1, 10000), cfg);
          const network = JSON.parse(JSON.stringify(aiExport()));
          sim.reset();
          return { generation: r.gen, bestLap: r.bestLap ?? null, fitness: r.bestFit, network };
        },
        /**
         * The network at the wheel as a file: its weights, and the lab's settings and the car's setup it drives with here.
         * What the lab's Load from file takes, and what the site takes from an agent (docs/agents.md).
         */
        network() {
          alive();
          if (!pilot) throw new Error('network: no network is driving (autopilot(net) first)');
          return JSON.parse(JSON.stringify(aiExport()));
        },
        /**
         * A network's exam, as the site times the networks agents send in: at the wheel from the start, `laps` laps in a row
         * (3; nothing mended or put back between them), its time the best lap through every gate. It ends early when the
         * car is wrecked, makes no headway for 20 s, or averages under 5 m/s. → { time (null: no valid lap), laps: [{ time,
         * valid }], why: 'laps' | 'wrecked' | 'stuck' | 'slow', seconds, network }. The same network in a new sim: the same time.
         */
        exam(net, opts = {}) {
          const network = sim.autopilot(net);
          if (!network) throw new Error('exam: a network to examine');
          const want = clamp(Math.round(Number.isFinite(+opts.laps) ? +opts.laps : 3), 1, 5), limit = want * Math.max(60, botPath().len / 5) + 10;
          let why = 'laps', far = 0, farAt = 0;
          while (lap.laps.length < want) {
            sim.step(30);
            const t = ticks / 60;
            if (st.dist > far + 5) { far = st.dist; farAt = t; }
            if (lap.laps.length >= want) break;
            if (car.wrecked) { why = 'wrecked'; break; }
            if (t - farAt > 20) { why = 'stuck'; break; }
            if (t > limit) { why = 'slow'; break; }
          }
          const laps = lap.laps.slice(0, want).map((time, i) => ({ time: Math.round(time * 1000) / 1000, valid: lap.valid[i] !== false }));
          const ok = laps.filter(l => l.valid).map(l => l.time);
          return { time: ok.length ? Math.min(...ok) : null, laps, why, seconds: ticks / 60, network };
        },
        /** the engine's own handle (what the game's page has as window.__sim): everything, and nothing promised */
        get raw() { return env.__sim; },
        /** stop its timers and let go of the world */
        dispose() { if (gone) return; gone = true; for (const t of env.__timers) { clearTimeout(t); clearInterval(t); } env.__timers.clear(); },
      };
      return sim;
    };
  })();
}
