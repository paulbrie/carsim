# One-off: hooks the multiplayer bridge (public/sim/mp.js, the MP block) into engine.js.
import sys
p = sys.argv[1]
s = open(p).read()
def rep(a, b):
    global s
    n = s.count(a)
    assert n == 1, (n, a[:120])
    s = s.replace(a, b)

# --- multiplayer flag and state, before anything reads the course or localStorage
rep("""import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
""", """import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/* Multiplayer: the race app loads this page in an iframe as /sim/index.html?mp=1&ground=…&vehicle=…&paint=…
   and talks to it with postMessage (see the MULTIPLAYER section near the end). Without ?mp=1 it is the
   single-player sim as it was. */
const MPQ = new URLSearchParams(location.search);
const MP = { on: MPQ.get('mp') === '1', hold: false, phase: 'free', race: 0, laps: 3, slot: -1, goAt: 0, greenSim: 0, missed: 0, finished: false,
  peers: new Map(), myId: null, sendT: 0, pIdx: -1, spectator: false };
""")

# --- course: in a race everyone drives the default figure-8 on the room's ground, nothing saved
rep("""SURF = SURFACES[COURSE.base]; ROAD = !!COURSE.road;
function saveCourse() {
""", """if (MP.on) {
  const g = MPQ.get('ground');
  COURSE = { wp: DEFAULT_WP.map(p => p.slice()), ops: [], base: g === 'earth' ? 'earth' : 'sand', road: g === 'road', bridges: [], noBridge: [] };
}
SURF = SURFACES[COURSE.base]; ROAD = !!COURSE.road;
function saveCourse() {
  if (MP.on) return true;
""")
rep("""  try { localStorage.setItem('sandbuggy.surface', road ? 'road' : COURSE.base); } catch (e) { }""",
    """  if (!MP.on) try { localStorage.setItem('sandbuggy.surface', road ? 'road' : COURSE.base); } catch (e) { }""")

# --- paint: tag the buggy's body paint so clones (other players' buggies) can be repainted
rep("""  rig.M = M;
""", """  rig.M = M; M.paint.userData.sbPaint = true;
""")
rep("""    w.holder = holder; w.spinner = spinner; w.vis = { s, wid };""",
    """    w.holder = holder; w.spinner = spinner; w.vis = { s, wid };
    holder.userData.sbWheel = car.wheels.indexOf(w); spinner.userData.sbSpin = car.wheels.indexOf(w);""")
rep("""let savedPaint = {}; try { savedPaint = JSON.parse(localStorage.getItem('sandbuggy.paint') || '{}') || {}; } catch (e) { }""",
    """let savedPaint = {}; if (!MP.on) try { savedPaint = JSON.parse(localStorage.getItem('sandbuggy.paint') || '{}') || {}; } catch (e) { }""")
rep("""  if (save) { savedPaint[V.key] = hex; try { localStorage.setItem('sandbuggy.paint', JSON.stringify(savedPaint)); } catch (e) { } }""",
    """  if (save) { savedPaint[V.key] = hex; if (!MP.on) try { localStorage.setItem('sandbuggy.paint', JSON.stringify(savedPaint)); } catch (e) { } }""")
rep("""  try { localStorage.setItem('sandbuggy.vehicle', V.key); } catch (e) { }""",
    """  if (!MP.on) try { localStorage.setItem('sandbuggy.vehicle', V.key); } catch (e) { }""")
rep("""try { BOTS.n = clamp(+(localStorage.getItem('sandbuggy.bots') || 0) | 0, 0, 4); } catch (e) { }""",
    """if (!MP.on) try { BOTS.n = clamp(+(localStorage.getItem('sandbuggy.bots') || 0) | 0, 0, 4); } catch (e) { }""")

# --- input: held on the grid until green
rep("""  const thr = o ? o.throttle : BOTS.hold > 0.4 ? 0 : (keys.KeyW || keys.ArrowUp ? 1 : 0);   // no jump starts in a race""",
    """  const thr = o ? o.throttle : BOTS.hold > 0.4 || MP.hold ? 0 : (keys.KeyW || keys.ArrowUp ? 1 : 0);   // no jump starts in a race""")
rep("""  input.throttle = thr; input.brake = brk; input.handbrake = o ? !!o.handbrake : !!keys.Space;""",
    """  input.throttle = thr; input.brake = brk; input.handbrake = o ? !!o.handbrake : !!keys.Space || MP.hold;""")

# --- keys: the room decides the course, the ground, the car and the bots
rep("""  if (e.code === 'KeyE') { if (rp.on) stopReplay(); toggleEditor(!ed.on); return; }""",
    """  if (MP.on && mpKeyBlocked(e)) return;
  if (e.code === 'KeyE') { if (rp.on) stopReplay(); toggleEditor(!ed.on); return; }""")

# --- laps and gates feed the race
rep("""function finishLap(t, valid) {
""", """function finishLap(t, valid) {
  mpLap(t, valid);
""")
rep("""function gateMissed(t, j) {
  const G = TRACK.gates.length;
""", """function gateMissed(t, j) {
  const G = TRACK.gates.length;
  if (MP.phase === 'racing' && !MP.finished && lap.started) MP.missed++;
""")
rep("""  timerEl.innerHTML = `<div class="lt">${lap.started ? `LAP ${lap.lapNo}` : 'CROSS START'}""",
    """  timerEl.innerHTML = `<div class="lt">${lap.started ? `LAP ${lap.lapNo}${MP.phase === 'racing' && !MP.finished ? ' / ' + MP.laps : ''}` : MP.hold ? 'ON THE GRID' : 'CROSS START'}""")
# other players on the minimap
rep("""  for (const b of BOTS.list) { const [x, y] = mapXY(b.pos.x, b.pos.z); c.fillStyle = b.col;""",
    """  for (const pe of MP.peers.values()) { if (!pe.shown) continue; const [x, y] = mapXY(pe.pos.x, pe.pos.z); c.fillStyle = pe.col; c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.beginPath(); c.arc(x, y, 4.5, 0, TAU); c.fill(); c.stroke(); }
  for (const b of BOTS.list) { const [x, y] = mapXY(b.pos.x, b.pos.z); c.fillStyle = b.col;""")

# --- loop: contact with the other cars, their poses, reporting ours
rep("""  updateBots(dt);
  if (n >= 10) acc = 0;""", """  updateBots(dt);
  mpContacts(dt);
  if (n >= 10) acc = 0;""")
rep("""  syncVisual(); syncBots();
""", """  syncVisual(); syncBots(); mpFrame(dt);
""")

# --- the bridge itself, then boot with the room's car
mp = open(sys.argv[2]).read()
rep("""// boot
setTimeout(() => {""", mp + """
// boot
setTimeout(() => {""")
rep("""  try { const sv = localStorage.getItem('sandbuggy.vehicle'); if (sv && sv !== 'buggy' && VEHICLE_LIST[sv]) switchVehicle(sv); } catch (e) { console.warn(e); }""",
    """  if (MP.on) mpBootVehicle();
  else try { const sv = localStorage.getItem('sandbuggy.vehicle'); if (sv && sv !== 'buggy' && VEHICLE_LIST[sv]) switchVehicle(sv); } catch (e) { console.warn(e); }""")
rep("""  requestAnimationFrame(t => { last = t; frame(t); });
}, 30);""", """  requestAnimationFrame(t => { last = t; frame(t); });
  mpPost({ t: 'ready' });
}, 30);""")
rep("""  if (BOTS.n) setBots(BOTS.n);
  requestAnimationFrame(t => { last = t; frame(t); });""", """  // for tests and the console: step the physics without drawing (headless browsers draw at a frame a second)
  Object.assign(window.__sim, { MP, placeAtGate, resetCar, step(n = 60, dt = 1 / 60) { for (let i = 0; i < n; i++) { simulate(dt); mpFrame(dt); } } });
  if (BOTS.n) setBots(BOTS.n);
  requestAnimationFrame(t => { last = t; frame(t); });""")
# --- another player's car with the same model keeps its own paint when its model arrives
rep("""function applySavedPaint(V) { if (savedPaint[V.key] != null) setPaint(V, savedPaint[V.key], false); }""",
    """function applySavedPaint(V) { if (V.mpPaint != null) setPaint(V, V.mpPaint, false); else if (savedPaint[V.key] != null) setPaint(V, savedPaint[V.key], false); }""")

# --- models: fetched from models/<key>.glb.gz (once per model, however many cars use it)
a = s.index("function loadModel(V) {"); b = s.index("function attachModel(V, root, D) {")
s = s[:a] + """const MODEL_GZ = {};
const modelGz = key => MODEL_GZ[key] ??= fetch(`models/${key}.glb.gz`).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); });
function loadModel(V) {
  const D = MODELS[V.key]; if (!D || V.modelState) return; V.modelState = 'loading';
  (async () => {
    try {
      if (typeof DecompressionStream === 'undefined') throw new Error('this browser cannot unpack the model (needs Chrome 80+, Firefox 113+ or Safari 16.4+)');
      const gz = await modelGz(V.key);
      const buf = await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      const ld = new GLTFLoader();
      ld.register(parser => { parser.textureLoader = new THREE.TextureLoader(parser.options.manager); return { name: 'SB_plain_images' }; });   // <img> + data: URIs: blob URLs fail in some embedded browsers
      const gltf = await ld.parseAsync(inlineGlbImages(buf), '');
      attachModel(V, gltf.scene, D); V.modelState = 'ok';
    } catch (err) { console.warn('model', V.key, err); V.modelState = 'failed'; if (V === VEH) flash(`Detailed ${V.short} model could not load (${err.message}): using the built-in body`, '#ffd88a', 4); }
  })();
}
""" + s[b:]
s = s.replace("/* ---------- detailed 3D models: a script in models/ holds a gzipped glTF (script tags also load from file://) ---------- */",
              "/* ---------- detailed 3D models: models/<key>.glb.gz, a gzipped glTF binary ---------- */")

open(p, 'w').write(s)
print('patched')
