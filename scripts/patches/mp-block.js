/* =====================================================================
   MULTIPLAYER (?mp=1): the race app around this iframe sends the room's phase and the other
   players' cars; this page drives its own car as always and reports where it is, its laps and
   its finish. Messages, both ways, by postMessage on this origin:
     in:  init {me} · car {vehicle, paint} · ground {ground} · roster {players} · snap {cars} · gone {id}
          phase {phase, race, startsIn, slot, laps, spectator, elapsed} · course {key, course}
          weather {weather} (also ?weather= at load: scripts/patches/weather.py)
          hit {id, h} · repair {id} · hits {all: {id: [h, …]}} (the others' damage: every hit so far, then each new one)
          records {map, v, ground, list} (the best laps on the room's map and ground, #304)
          ghost {key, course, ground, vehicle, name, time, trace} (a best lap's path to race against; key null: none, #310)
     out: ready · s {p, q, v, st, sp, prog, lap, sk, ts} (20 Hz; sk: the four wheels' skid marks, 4 bits each, #306; ts: when, on
          this page's clock, ms: the others draw us on it, #345)
          lap {lap, time, valid, splits, trace?} (every lap, raced or not: the server keeps the best valid ones; trace: the
          path of a lap better than our best, for its ghost) · finish {time, missed}
          hit {h} (our car struck: carHit's record, see bodyHit) · repair (our car as built again)
   The course is the room's map: the page sets window.__simCourse = {key, course} before it loads
   this iframe (course null: the default figure-8), and sends a new one with course.
   With ?edit=1 (the super admin's map editor, app/maps/[id]) the page opens on the course editor,
   with the map from window.__simCourse, nothing saved in this browser:
     in:  get {id}            out: ready · course {id, course, sig} (the answer to get) · sig {sig} (when the course changes) · save (Ctrl/Cmd+S)
   Other cars are interpolated 120 ms behind their latest position, on their own clock (#345: the states come in bunched
   by the server's 50 ms ticks and the network), along a curve through them (mpSpline), carried on from there to where
   they are now (by their speed and turn, over that and the trip here: MP.lag) and pushed against like the bots
   (ccSolve; each side moves only its own car).
   ===================================================================== */
const PEER_DELAY = 120, PEER_STALE = 3000;
Object.assign(MP, { lag: 60, sent: [] });           // lag: ms from our state sent to it back in a snap (the others' states are as old)
function mpPost(msg) { if ((MP.on || MP.edit) && parent !== window) parent.postMessage(msg, location.origin); }
const hexOf = s => typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s) ? parseInt(s.slice(1), 16) : null;

function mpKeyBlocked(e) {
  if (['KeyE', 'KeyN', 'KeyG', 'KeyV', 'KeyK', 'KeyB', 'KeyO'].includes(e.code)) return true;     // course, bots, ground, car, paint and weather are the room's
  const race = MP.phase === 'countdown' || MP.phase === 'racing';
  if (race && !MP.finished && (e.code === 'KeyT' || e.code === 'KeyY')) return true;      // no lap restarts or replays mid-race
  if (MP.hold && (e.code === 'KeyR' || e.code === 'Enter')) return true;
  return false;
}

// grid slot n: two columns, staggered, behind the start line along the course
function mpGrid(slot) {
  if (rp.on) stopReplay();
  restartRun();
  lap.lapNo = 0; lap.last = null; lap.laps = []; lap.valid = []; lap.history = [];   // lap 1 of the race, whatever was driven before
  const Pt = botPath(), row = slot >> 1, side = slot % 2 ? 1 : -1, back = 9 + row * 8 + (slot % 2) * 3;
  const s = ((Pt.s0 - back) % Pt.len + Pt.len) % Pt.len, u = s / Pt.len;
  const p = TRACK.curve.getPointAt(u), t = TRACK.curve.getTangentAt(u).setY(0).normalize();
  const lat = side * Math.min(2.2, TRACK.gates[0].half * 0.4);
  resetCar(p.x - t.z * lat, p.z + t.x * lat, Math.atan2(t.x, t.z));
  lap.prev.copy(car.pos); MP.pIdx = -1;
}

// metres raced: laps done and the distance along the course from the start line
function mpProgress() {
  const Pt = botPath(), P = Pt.P, n = Pt.n, len = Pt.len; let bi = MP.pIdx, bd = Infinity;
  const scan = (i) => { const k = ((i % n) + n) % n, q = P[k], e = (q.x - car.pos.x) ** 2 + (q.z - car.pos.z) ** 2; if (e < bd) { bd = e; bi = k; } };
  if (MP.pIdx < 0) for (let i = 0; i < n; i++) scan(i); else { for (let i = MP.pIdx - 12; i <= MP.pIdx + 30; i++) scan(i); if (bd > 900) { bd = Infinity; for (let i = 0; i < n; i++) scan(i); } }
  MP.pIdx = bi;
  let rel = ((bi * Pt.ds - Pt.s0) % len + len) % len;
  if (!lap.started) return rel > len / 2 ? rel - len : 0;          // on the grid, behind the line
  if (lap.next === 0 && rel < len * 0.25) rel += len;               // nearly round, not over the line yet
  else if (lap.next === 1 && rel > len * 0.75) rel -= len;          // just over the line
  return (lap.lapNo - 1) * len + rel;
}

// called by finishLap, before it moves on: lap lap.lapNo is done (a best lap, maybe; in a race, one of its laps)
function mpLap(t, valid) {
  if (!MP.on || MP.spectator || lap.lapNo < 1) return;
  const time = t - lap.lapStart, trace = valid && (lap.best == null || time < lap.best) ? mpTrace(lap.lapStart, t) : null;   // lap.best: still the one before
  mpPost({ t: 'lap', lap: lap.lapNo, time, valid, splits: lap.splits, ...(trace ? { trace } : {}) });
  if (MP.phase !== 'racing' || MP.finished) return;
  if (lap.lapNo >= MP.laps) {
    MP.finished = true;
    const time = t - MP.greenSim;
    mpPost({ t: 'finish', time, missed: MP.missed });
    MP.finishFlash = `FINISHED  ${fmt(time)}${MP.missed ? `  +${MP.missed * 5} s` : ''}`;
  }
}

function mpBootVehicle() {
  const key = MPQ.get('vehicle'), hex = hexOf(MPQ.get('paint'));
  if (key && key !== 'buggy' && VEHICLE_LIST[key]) switchVehicle(key);
  if (hex != null) setPaint(VEH, hex, true);
  const spawn = +MPQ.get('spawn');
  if (Number.isFinite(spawn) && spawn >= 0) mpGrid(spawn % 8);
}

/* ---------- other players' cars ---------- */
function mpMakeVehicle(key) {
  if (key !== 'buggy' && ROAD_CARS[key]) {
    const V = makeRoadVehicle(key); V.vis.visible = true;
    if (MODELS[key]) loadModel(V);
    return V;
  }
  // the buggy is built once, so copy it (as built: MP.buggyTpl, taken before ours could be dented), with its own paint
  const vis = (MP.buggyTpl || buggy).clone(true), copies = new Map(), cl = m => copies.get(m) || (copies.set(m, m.clone()), copies.get(m));
  const wheels = BUGGY.wheels.map(W => ({ hp: (W.hp0 || W.hp).clone(), front: W.front, holder: null, spinner: null }));
  vis.traverse(o => {
    if (o.isMesh && [].concat(o.material).some(m => m.userData.sbPaint)) o.material = Array.isArray(o.material) ? o.material.map(cl) : cl(o.material);
    if (o.userData.sbWheel != null) wheels[o.userData.sbWheel].holder = o;
    if (o.userData.sbSpin != null) wheels[o.userData.sbSpin].spinner = o;
  });
  vis.visible = true; scene.add(vis);
  return { key: 'buggy', vis, wheels, R: BUGGY.R, REST: BUGGY.REST, K: BUGGY.K, mass: BUGGY.mass, I: BUGGY.I, box: BUGGY.box, roofY: BUGGY.roofY, paintMats: [...copies.values()], ownMats: [...copies.values()] };
}

function mpLabel(text, col) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 96;
  const x = cv.getContext('2d'); x.font = '600 44px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  const w = Math.min(500, x.measureText(text).width + 74), x0 = 256 - w / 2;
  x.fillStyle = 'rgba(15,12,8,.62)'; x.beginPath(); x.roundRect(x0, 14, w, 68, 34); x.fill();
  x.fillStyle = col; x.beginPath(); x.arc(x0 + 34, 48, 12, 0, TAU); x.fill(); x.strokeStyle = '#fff'; x.lineWidth = 3; x.stroke();
  x.fillStyle = '#fff'; x.textBaseline = 'middle'; x.fillText(text, x0 + 56, 50, w - 66);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(4.2, 0.79, 1); sp.renderOrder = 10; scene.add(sp);
  return sp;
}

function mpDropPeer(pe) {
  MP.peers.delete(pe.id); mpPeerSkids(pe, 0);
  repairBody(pe.V);                                                   // its thrown parts back on it, out of the scene with it
  scene.remove(pe.V.vis); scene.remove(pe.label);
  pe.label.material.map.dispose(); pe.label.material.dispose();
  if (pe.V.ownMats) pe.V.ownMats.forEach(m => m.dispose());          // a buggy copy shares its meshes with ours
  else pe.V.vis.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach(m => m.dispose()); });
}

function mpRoster(players) {
  const seen = new Set();
  for (const pl of players) {
    if (pl.id === MP.myId) { MP.spectator = !!pl.spectator; continue; }
    seen.add(pl.id);
    let pe = MP.peers.get(pl.id);
    if (pe && pe.key !== pl.vehicle) { mpDropPeer(pe); pe = null; }
    if (!pe) {
      const V = mpMakeVehicle(pl.vehicle); V.vis.visible = false;
      pe = { id: pl.id, key: V.key === 'buggy' ? 'buggy' : pl.vehicle, V, buf: [], pos: new THREE.Vector3(), q: new THREE.Quaternion(), fx: 0, fz: 1, v: 0, spin: 0, steer: 0,
        sx: 0, sz: 0, wy: 0, vx: 0, vz: 0, kicks: [], shown: false, label: null, name: '', paint: undefined, col: '#fff' };
      if (pe.key !== pl.vehicle) pe.key = pl.vehicle;
      MP.peers.set(pl.id, pe);
      const p0 = pe; V.onModel = () => mpReplayHits(p0);              // a detailed model arriving: the hits so far go onto it
      mpReplayHits(pe);
    }
    if (pe.paint !== pl.paint) {
      pe.paint = pl.paint; const hex = hexOf(pl.paint);
      if (hex != null) { pe.V.mpPaint = hex; setPaint(pe.V, hex, false); }
    }
    const col = pl.col || pl.paint || (pl.vehicle === 'buggy' ? '#d9360b' : '#' + new THREE.Color(ROAD_CARS[pl.vehicle]?.color ?? 0xffffff).getHexString());
    if (!pe.label || pe.name !== pl.name || pe.col !== col) {
      if (pe.label) { scene.remove(pe.label); pe.label.material.map.dispose(); pe.label.material.dispose(); }
      pe.name = pl.name; pe.col = col; pe.label = mpLabel(pl.name, col); pe.label.visible = false;
    }
    pe.spectator = !!pl.spectator;
  }
  for (const pe of [...MP.peers.values()]) if (!seen.has(pe.id)) mpDropPeer(pe);
}

function mpSnap(cars) {
  const now = performance.now();
  for (const c of cars) {
    if (c[0] === MP.myId) { mpLagEcho(c, now); continue; }
    const pe = MP.peers.get(c[0]); if (!pe) continue;
    // each state on its sender's clock (#345: c[12], ms; from a server without it, ours as it comes in, as before), and how
    // far behind ours that clock is: the shortest trip seen lately (offT: down fast, up slowly; mpFrame eases pe.off to it)
    const ts = c[12] > 0 ? c[12] : now, o = now - ts, B = pe.buf; pe.clk = c[12] > 0;
    if (pe.off == null || Math.abs(o - pe.offT) > 1500) { pe.off = pe.offT = o; B.length = 0; }   // the first, or its page reloaded
    else pe.offT += (o - pe.offT) * (o < pe.offT ? 0.25 : 0.01);
    if (B.length && ts <= B[B.length - 1].t) continue;
    pe.rx = now;
    B.push({ t: ts, p: [c[1], c[2], c[3]], q: [c[4], c[5], c[6], c[7]], v: c[8], st: c[9], w: c[10], sk: c[11] || 0 });
    if (B.length > 40) B.splice(0, B.length - 40);
  }
}

// our own state back from the server: the time since we sent it (the last of the same sends: not while standing still)
function mpLagEcho(c, now) {
  const S = MP.sent;
  for (let i = S.length - 1; i > 0; i--) {
    if (S[i].x !== c[1] || S[i].y !== c[2] || S[i].z !== c[3]) continue;
    if (S[i - 1].x === c[1] && S[i - 1].y === c[2] && S[i - 1].z === c[3]) return;
    MP.lag = lerp(MP.lag, clamp(now - S[i].t, 0, 500), 0.1); return;
  }
}

function mpPhase(m) {
  const was = MP.phase;
  MP.laps = m.laps || MP.laps; MP.spectator = !!m.spectator; MP.slot = m.slot ?? -1;
  if ((m.phase === 'countdown' || m.phase === 'racing') && m.race !== MP.race) {
    // a new race: to the grid, held until green (or, joining one already running, straight off)
    MP.race = m.race; MP.finished = false; MP.missed = 0; MP.finishFlash = null; MP.cd = -1;
    if (ed.on) toggleEditor(false);
    if (!MP.spectator && m.slot >= 0) {
      mpGrid(m.slot);
      if (m.phase === 'countdown') { MP.hold = true; MP.goAt = performance.now() + (m.startsIn || 0); }
      else { MP.hold = false; MP.greenSim = simTime - (m.elapsed || 0); }
    }
  }
  if (m.phase !== 'countdown' && m.phase !== 'racing') MP.hold = false;
  MP.phase = m.phase === 'countdown' && !MP.hold ? 'racing' : m.phase;
  if (MP.phase === 'racing' && was === 'countdown' && MP.hold && performance.now() >= MP.goAt - 50) mpGreen();
}

function mpGreen() { MP.hold = false; MP.phase = 'racing'; MP.greenSim = simTime; flash('GO!', '#7dff9a', 1.2); }

function mpMessage(m) {
  if (!m || typeof m !== 'object') return;
  switch (m.t) {
    case 'init': MP.myId = m.me; break;
    case 'car': {
      if (VEHICLE_LIST[m.vehicle] && m.vehicle !== VEH.key) { switchVehicle(m.vehicle); flash(VEH.name, '#fff', 1.5); mpApplyBest(); }
      const hex = hexOf(m.paint); if (hex != null) setPaint(VEH, hex, true);
      break;
    }
    case 'ground': mpGround(m.ground); break;
    case 'roster': mpRoster(m.players || []); break;
    case 'snap': mpSnap(m.cars || []); break;
    case 'gone': { const pe = MP.peers.get(m.id); if (pe) mpDropPeer(pe); break; }
    case 'phase': mpPhase(m); break;
    case 'course': mpSetCourse(m.key, m.course); break;
    case 'weather': if (m.weather !== weatherKey && setWeather(m.weather, false)) flash(WEATHERS[m.weather].name, '#fff', 1.5); break;
    case 'hit': mpPeerHit(m.id, m.h); break;
    case 'repair': mpPeerRepair(m.id); break;
    case 'hits': mpPeerHits(m.all); break;
    case 'records': MP.records = m; mpApplyBest(); break;
    case 'ghost': mpGhostMsg(m); break;
    case 'focus': try { window.focus(); } catch (e) { } break;
  }
}

/* ---------- best laps (#304): the server keeps them, per map, ground, car and driver ---------- */
// MP.records: the room's map and ground's, fastest first ({id, name, vehicle, time, splits, mv}). They are the
// timer's BEST and its checkpoint deltas (splits: only if set on this version of the map), and under it the best
// lap with each car and who drove it (MP.recs, fastest first); right of the timer every driver's with our car
// (MP.carRecs, #309). Called when they come, and when the course (loadBest), the ground or the car changes.
function mpApplyBest() {
  const R = MP.records;
  if (!R || !Array.isArray(R.list)) return;
  MP.recs = []; MP.carRecs = []; lap.best = null; lap.bestSplits = [];
  if (`${R.map}@${R.v}` !== MP.courseKey || R.ground !== mpGroundNow()) return;      // not this course's (yet)
  const mine = R.list.find(e => e.id === MP.myId && e.vehicle === VEH.key);
  if (mine) { lap.best = mine.time; lap.bestSplits = mine.mv === R.v && Array.isArray(mine.splits) ? mine.splits : []; }
  const seen = new Set();
  for (const e of R.list) if ((e.vehicle === 'buggy' || ROAD_CARS[e.vehicle]) && !seen.has(e.vehicle)) { seen.add(e.vehicle); MP.recs.push(e); }
  MP.carRecs = R.list.filter(e => e.vehicle === VEH.key);
}
const mpEsc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// the best laps' lists fold away (a click on their title): the timer's ('cars') and the one beside it ('room'), kept in
// this browser; their titles take the pointer (the panels let it through to the drive). So do the timer's lap details
// ('laps': segTable's checkpoint times, #317), in the single-player sim too
const MP_FOLD = (() => { try { return JSON.parse(localStorage.getItem('sandbuggy.foldBest') || '{}') || {}; } catch (e) { return {}; } })();
const mpFoldHead = (k, tag, cls, what = 'BEST LAPS') => `<${tag} class="${cls} fold" data-fold="${k}" title="${MP_FOLD[k] ? 'Show' : 'Hide'} the ${what.toLowerCase()}">${MP_FOLD[k] ? '▸' : '▾'} ${what}</${tag}>`;
function mpFoldClick(e) {
  const f = e.target.closest('[data-fold]'); if (!f) return;
  e.preventDefault(); e.stopPropagation();
  MP_FOLD[f.dataset.fold] = !MP_FOLD[f.dataset.fold]; mpBestT = 1;
  try { localStorage.setItem('sandbuggy.foldBest', JSON.stringify(MP_FOLD)); } catch (err) { }
}
document.head.insertAdjacentHTML('beforeend', `<style>
  #timer .fold,#bestLaps .fold{pointer-events:auto;cursor:pointer;user-select:none} #timer th.fold{text-align:left} #timer .fold:hover,#bestLaps .fold:hover{opacity:1;text-decoration:underline}
</style>`);
timerEl.addEventListener('pointerdown', mpFoldClick);
// in the timer, all the time: the best lap with each car (at most MP_REC_ROWS, ours always), the driver's name
const MP_REC_ROWS = 6;
function mpRecRow() {
  if (!MP.on || !MP.records) return '';
  if (MP_FOLD.cars) return `<table class="seg"><tr>${mpFoldHead('cars', 'th', '')}</tr></table>`;
  const all = MP.recs || [], ours = all.findIndex(e => e.vehicle === VEH.key);
  const rows = all.slice(0, MP_REC_ROWS).map(e => [e, e.vehicle === VEH.key]);
  if (ours >= MP_REC_ROWS) rows.push([all[ours], true]);
  if (ours < 0) rows.push([null, true]);
  const row = ([e, our]) => `<tr style="${our ? 'color:#ffd27d;font-weight:700' : ''}"><td>${mpEsc(e ? (ROAD_CARS[e.vehicle] || BUGGY).short : VEH.short)}</td>`
    + `<td>${e ? fmt(e.time) : '–'}</td><td style="text-align:left;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e ? mpEsc(e.name) : 'no lap yet'}</td></tr>`;
  return `<table class="seg"><tr>${mpFoldHead('cars', 'th', '')}<th></th><th></th></tr>${rows.map(row).join('')}</table>`;
}

/* ---------- the ghost car (#310): a best lap's path, driven by a see-through car that sets off with our lap ---------- */
// A trace (lib/race/records.mjs GHOST): a sample every GH_DT s of x, y, z (GH_POS m), the orientation's quaternion
// (× 32767) and the steering (× 10000), little-endian int16s, in base64.
const GH_DT = 0.1, GH_F = 8, GH_POS = 0.02, GH_MAX = 2800, GH_OPACITY = 0.35;
// our lap from t0 to t1, from the replay tape (the last 6 minutes at 30 Hz), or null if it isn't all on it
function mpTrace(t0, t1) {
  const B = rp.buf;
  if (B.length < 2 || B[0].t > t0 + 0.05 || B[B.length - 1].t < t1 - 0.1) return null;
  const n = Math.floor((t1 - t0) / GH_DT + 1e-6) + 1; if (n > GH_MAX) return null;
  const dv = new DataView(new ArrayBuffer(n * GH_F * 2));
  for (let i = 0, j = 0; i < n; i++) {
    const t = t0 + i * GH_DT; while (j < B.length - 2 && B[j + 1].t <= t) j++;
    const A = B[j], C = B[j + 1], f = C.t > A.t ? clamp((t - A.t) / (C.t - A.t), 0, 1) : 0;
    mpQa.fromArray(A.q).slerp(mpQb.fromArray(C.q), f);
    [lerp(A.p[0], C.p[0], f) / GH_POS, lerp(A.p[1], C.p[1], f) / GH_POS, lerp(A.p[2], C.p[2], f) / GH_POS, mpQa.x * 32767, mpQa.y * 32767, mpQa.z * 32767, mpQa.w * 32767,
      lerp(A.steer, C.steer, f) * 10000].forEach((v, k) => dv.setInt16((i * GH_F + k) * 2, clamp(Math.round(v), -32768, 32767), true));
  }
  const u8 = new Uint8Array(dv.buffer); let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
const mpGhost = { key: null, V: null, label: null, dv: null, n: 0, course: null, ground: null, spin: 0, lookT: 0, old: [], pre: null, preN: 0, preW: [] };
// its depth, drawn after everything solid: of its see-through surfaces only the nearest show, not the cabin through the body
const mpGhostDepth = new THREE.MeshBasicMaterial({ colorWrite: false });
function mpGhostMsg(m) {
  if ((m.key || null) === mpGhost.key) return;
  mpDropGhost();
  if (!m.key || typeof m.trace !== 'string' || !(m.vehicle === 'buggy' || ROAD_CARS[m.vehicle])) return;
  let u8; try { const s = atob(m.trace); u8 = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i); } catch (e) { return; }
  const n = Math.floor(u8.length / (GH_F * 2)); if (n < 2) return;
  Object.assign(mpGhost, { key: m.key, dv: new DataView(u8.buffer), n, course: m.course, ground: m.ground, spin: 0, lookT: 0, old: [], pre: null, preN: 0, preW: [] });
  const V = mpGhost.V = mpMakeVehicle(m.vehicle);
  V.onModel = () => { if (mpGhost.V === V) mpGhostLook(); };          // the detailed model, see-through before it is drawn
  mpGhostLook();
  mpGhost.label = mpLabel(`Ghost · ${m.name} · ${fmt(m.time)}`, '#9fd4ff');
}
// see-through: its own copy of every material (the detailed model comes later, so again now and then)
function mpGhostLook() {
  const G = mpGhost, own = !!G.V.ownMats;                            // a buggy copy shares its materials with ours
  G.V.vis.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = false;
    const one = m => { if (m.userData.ghost) return m; if (!own) G.old.push(m); const c = m.clone(); c.userData = { ghost: true }; c.transparent = true; c.opacity = GH_OPACITY * (m.transparent ? m.opacity : 1); c.depthWrite = false; return c; };
    o.material = Array.isArray(o.material) ? o.material.map(one) : one(o.material);
  });
  let n = 0; G.V.vis.traverse(o => { if (o.isMesh) n++; });
  if (n === G.preN) return;
  if (G.pre) scene.remove(G.pre);                                    // (its geometry is the ghost's)
  G.pre = G.V.vis.clone(true); G.preN = n; G.preW = [];
  const a = [], b = []; G.V.vis.traverse(o => a.push(o)); G.pre.traverse(o => b.push(o));
  const twin = new Map(a.map((o, i) => [o, b[i]]));
  for (const W of G.V.wheels) for (const o of [W.holder, W.spinner]) if (o && twin.get(o)) G.preW.push([o, twin.get(o)]);
  G.pre.traverse(o => { if (o.isMesh) { o.material = mpGhostDepth; o.castShadow = o.receiveShadow = false; o.renderOrder = 1e6; } });
  scene.add(G.pre);
}
function mpDropGhost() {
  const G = mpGhost; G.key = null;
  if (!G.V) return;
  scene.remove(G.V.vis); scene.remove(G.label); if (G.pre) scene.remove(G.pre);
  G.label.material.map.dispose(); G.label.material.dispose();
  G.V.vis.traverse(o => { if (o.material) [].concat(o.material).forEach(m => m.userData.ghost && m.dispose()); if (!G.V.ownMats && o.geometry) o.geometry.dispose(); });
  G.old.forEach(m => m.dispose()); if (G.V.ownMats) G.V.ownMats.forEach(m => m.dispose());
  G.V = null; G.label = null; G.dv = null; G.old = []; G.pre = null; G.preN = 0; G.preW = [];
}
// on the start line until our lap starts, then where it was that far into its lap; gone a little after it finished
function mpGhostFrame(dt) {
  const G = mpGhost, V = G.V; if (!V) return;
  const t = lap.started ? simTime - lap.lapStart : 0, dur = (G.n - 1) * GH_DT;
  const show = G.course === MP.courseKey && G.ground === mpGroundNow() && !rp.on && !ed.on && t <= dur + 1.5;
  V.vis.visible = show; G.label.visible = show; if (G.pre) G.pre.visible = show;
  if (!show) return;
  if ((G.lookT += dt) > 0.5) { G.lookT = 0; mpGhostLook(); }
  const x = clamp(t / GH_DT, 0, G.n - 1), i = Math.min(Math.floor(x), G.n - 2), f = x - i, g = (s, k) => G.dv.getInt16((s * GH_F + k) * 2, true);
  const P = k => lerp(g(i, k), g(i + 1, k), f) * GH_POS;
  V.vis.position.set(P(0), P(1), P(2));
  V.vis.quaternion.copy(mpQa.set(g(i, 3), g(i, 4), g(i, 5), g(i, 6)).normalize()).slerp(mpQb.set(g(i + 1, 3), g(i + 1, 4), g(i + 1, 5), g(i + 1, 6)).normalize(), f);
  const steer = lerp(g(i, 7), g(i + 1, 7), f) / 10000, v = Math.hypot(g(i + 1, 0) - g(i, 0), g(i + 1, 2) - g(i, 2)) * GH_POS / GH_DT;
  if (lap.started && t < dur) G.spin += v / (V.R || 0.35) * dt;
  const tRest = V.REST - V.mass * 9.81 / 4 / V.K;
  for (const W of V.wheels) {
    if (!W.holder) continue;
    W.holder.position.set(W.hp.x, W.hp.y - tRest, W.hp.z); W.holder.rotation.set(0, W.front ? steer : 0, 0);
    if (W.spinner) W.spinner.rotation.x = G.spin;
  }
  G.label.position.set(V.vis.position.x, V.vis.position.y + 2.4, V.vis.position.z);
  if (G.pre) { G.pre.position.copy(V.vis.position); G.pre.quaternion.copy(V.vis.quaternion); for (const [o, c] of G.preW) { c.position.copy(o.position); c.quaternion.copy(o.quaternion); } }
}

// right of the timer (#309): every driver's best lap with the car we drive, on this map and ground, fastest first
// (the first MP_BEST_ROWS, and ours wherever it is), with the gap to the fastest. Where the window is too narrow
// for it between the timer and the minimap, it goes under the minimap with fewer rows (as many as fit above the
// speed dial), and the Replay button under it.
const MP_BEST_ROWS = 10, MP_BEST_ROWS_NARROW = 5;
const mpBestEl = document.createElement('div');
mpBestEl.id = 'bestLaps'; mpBestEl.className = 'panel'; mpBestEl.style.cssText = 'display:none;top:12px;min-width:190px;max-width:270px';
document.head.insertAdjacentHTML('beforeend', `<style>
  #bestLaps .lt{font-size:12px;letter-spacing:2px;opacity:.85;text-align:center;white-space:nowrap}
  #bestLaps .sub{font-size:11px;opacity:.7;text-align:center;margin-bottom:4px;white-space:nowrap}
  #bestLaps table{border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums;width:100%}
  #bestLaps td{padding:1px 4px;text-align:right;white-space:nowrap}
  #bestLaps td.n{text-align:left;max-width:120px;overflow:hidden;text-overflow:ellipsis}
  #bestLaps td.p,#bestLaps td.g{opacity:.7} #bestLaps td.g{font-size:11px}
  #bestLaps tr.me td{color:#ffd27d;font-weight:700;opacity:1}
  #bestLaps .none{font-size:12px;opacity:.75;text-align:center;max-width:200px;white-space:normal}
</style>`);
document.body.appendChild(mpBestEl);
mpBestEl.addEventListener('pointerdown', mpFoldClick);
let mpBestT = 0, mpBestHtml = '';
function mpBestFrame(dt) {
  if ((mpBestT += dt) < 0.1) return; mpBestT = 0;
  const show = MP.on && !!MP.records && !ed.on && timerEl.offsetWidth > 0, replayBtn = document.getElementById('replayBtn');
  mpBestEl.style.display = show ? '' : 'none';
  if (!show) { if (replayBtn) replayBtn.style.top = ''; return; }
  const t = timerEl.getBoundingClientRect(), m = document.getElementById('mapWrap').getBoundingClientRect();
  const wide = t.right + 10 + Math.max(mpBestEl.offsetWidth, 214) <= m.left - 10;
  let n = wide ? MP_BEST_ROWS : MP_BEST_ROWS_NARROW;
  const all = MP.carRecs || [], here = MP.records && `${MP.records.map}@${MP.records.v}` === MP.courseKey && MP.records.ground === mpGroundNow();
  const me = all.findIndex(e => e.id === MP.myId);
  if (!wide) {                                                         // under the minimap: no lower than the speed dial
    const g = document.getElementById('gauge'), gr = g && g.offsetWidth ? g.getBoundingClientRect() : null;
    const bottom = gr && gr.right > innerWidth - 12 - mpBestEl.offsetWidth ? gr.top - 10 : innerHeight - 12;
    const trs = mpBestEl.querySelectorAll('tr'), rowH = trs[0]?.offsetHeight || 20, rest = trs.length ? mpBestEl.offsetHeight - trs.length * rowH : 76;
    const room = Math.floor((bottom - m.bottom - 10 - rest) / rowH);
    n = Math.max(1, Math.min(n, room - (me >= n ? 1 : 0)));
  }
  const rows = all.slice(0, n).map((e, i) => [e, i]);
  if (me >= n) rows.push([all[me], me]);
  const lead = all[0]?.time, old = e => e.mv != null && e.mv !== MP.records.v;
  const row = ([e, i]) => `<tr class="${e.id === MP.myId ? 'me' : ''}"><td class="p">${i + 1}</td><td class="n">${mpEsc(e.name)}${e.id === MP.myId ? ' (you)' : ''}${old(e) ? ' *' : ''}</td>`
    + `<td>${fmt(e.time)}</td><td class="g">${i ? '+' + (e.time - lead).toFixed(3) : ''}</td></tr>`;
  const html = MP_FOLD.room ? mpFoldHead('room', 'div', 'lt') : `${mpFoldHead('room', 'div', 'lt')}<div class="sub">${mpEsc(VEH.short)} · ${mpEsc(groundName())}</div>`
    + (!here ? '<div class="none">Loading…</div>' : !all.length ? `<div class="none">No lap yet with the ${mpEsc(VEH.short)} here. A lap counts when it passes every gate.</div>`
      : `<table>${rows.map(row).join('')}</table>${rows.some(([e]) => old(e)) ? '<div class="sub" style="margin:4px 0 0">* on an earlier layout of the map</div>' : ''}`);
  if (html !== mpBestHtml) { mpBestHtml = html; mpBestEl.innerHTML = html; }
  // right of the timer, or under the minimap (and the Replay button under it)
  if (wide) { mpBestEl.style.left = (t.right + 10) + 'px'; mpBestEl.style.right = ''; mpBestEl.style.top = '12px'; }
  else { mpBestEl.style.left = ''; mpBestEl.style.right = '12px'; mpBestEl.style.top = (m.bottom + 10) + 'px'; }
  if (replayBtn) replayBtn.style.top = wide ? '' : (m.bottom + 20 + mpBestEl.offsetHeight) + 'px';
}

/* ---------- damage: ours to the others, theirs onto their cars ---------- */
// MP.hits: every player's hits since their last repair, as the server keeps them; a car made later (or its detailed
// model loaded later) gets them all. Ours go out at most MP_HIT_RATE a second (a long scrape is many small hits).
const MP_HIT_RATE = 15, MP_HIT_MAX = 400;
const mpHitOk = h => Array.isArray(h) && h.length === 8 && h.every(x => typeof x === 'number' && isFinite(x));
const mpPeerVel = pe => mpV.set(pe.fx * pe.v, 0, pe.fz * pe.v);
function mpPeerHit(id, h) {
  if (!id || id === MP.myId || !mpHitOk(h)) return;
  const log = MP.hits.get(id) || []; if (log.length >= MP_HIT_MAX) return;
  log.push(h); MP.hits.set(id, log);
  const pe = MP.peers.get(id); if (pe) bodyHit(pe.V, h, mpPeerVel(pe));
}
function mpPeerRepair(id) {
  MP.hits.delete(id);
  const pe = MP.peers.get(id); if (pe) repairBody(pe.V);
}
function mpPeerHits(all) {
  MP.hits = new Map();
  if (all && typeof all === 'object') for (const [id, list] of Object.entries(all)) if (id !== MP.myId && Array.isArray(list)) MP.hits.set(id, list.filter(mpHitOk).slice(0, MP_HIT_MAX));
  for (const pe of MP.peers.values()) mpReplayHits(pe);
}
function mpReplayHits(pe) {
  repairBody(pe.V);
  for (const h of MP.hits.get(pe.id) || []) bodyHit(pe.V, h, mpPeerVel(pe));
}
function mpSendHit(h) {
  const now = performance.now();
  MP.hitBudget = Math.min(MP_HIT_RATE, (MP.hitBudget ?? MP_HIT_RATE) + (now - (MP.hitT || now)) / 1000 * MP_HIT_RATE); MP.hitT = now;
  if (MP.hitBudget < 1) return;
  MP.hitBudget--; mpPost({ t: 'hit', h });
}

/* ---------- the course ---------- */
function mpParentCourse() { try { return (parent !== window && parent.__simCourse) || null; } catch (e) { return null; } }

// a map's course as COURSE (checked as the editor's Import does), on the room's ground if given
function mpCourseFrom(c, ground) {
  const pts = a => Array.isArray(a) ? a.filter(b => b && isFinite(b.x) && isFinite(b.z)).map(b => ({ x: +b.x, z: +b.z })) : [];
  const C = c && Array.isArray(c.wp) && c.wp.length >= 3
    ? { wp: c.wp.map(([x, z]) => [+x, +z]), bank: bankOf(c.bank), level: levelOf(c.level), ops: Array.isArray(c.ops) ? c.ops : [], base: BASES.includes(c.base) ? c.base : 'sand', road: !!c.road, bridges: pts(c.bridges), noBridge: pts(c.noBridge) }
    : { wp: DEFAULT_WP.map(p => p.slice()), ops: [], base: 'sand', road: false, bridges: [], noBridge: [] };
  if (ground) { C.base = ground === 'earth' ? 'earth' : 'sand'; C.road = ground === 'road'; }
  return C;
}

// the host picked another map, or it was saved since: rebuild the world on it (back on the grid if held there)
function mpSetCourse(key, course) {
  if (!key || key === MP.courseKey) return;
  MP.courseKey = key;
  COURSE = mpCourseFrom(course, ROAD ? 'road' : COURSE.base);
  SURF = SURFACES[COURSE.base]; ROAD = COURSE.road;
  showBusy('Loading the course…');
  setTimeout(() => {
    clearSkids(); regenerateWorld(); showBusy('');
    if (MP.hold && MP.slot >= 0 && !MP.spectator) mpGrid(MP.slot);
  }, 30);
}

// the ground a race is on (the room's), or the map editor tries the course on (#297)
const mpGroundNow = () => ROAD ? 'road' : COURSE.base;
function mpGround(g) {
  if (!['sand', 'earth', 'road'].includes(g) || g === mpGroundNow()) return;
  const road = ROAD;
  setSurface(g);                                                     // sand / earth <-> road rebuilds the world itself
  if (COURSE.bank && road === ROAD) { clearSkids(); regenerateWorld(); }   // the banking is set for the ground's cornering speed
  MP.ground = g; mpApplyBest();
  flash(`Ground: ${groundName()}`, '#fff', 1.5);
}

// the map editor: what the page asks for, and a signature of the course so it knows when there is something to save.
// The ground is not in it: it is the room's in a race, so here it is only what the course is tried on (the bar's
// switch, or G); the map is saved with the last one, for the editor to open on.
function mpEditMessage(m) {
  if (!m || typeof m !== 'object') return;
  if (m.t === 'get') mpPost({ t: 'course', id: m.id, course: COURSE, sig: mpEditSig() });
  else if (m.t === 'ground') mpGround(m.ground);
  else if (m.t === 'focus') try { window.focus(); } catch (e) { }
}
const mpEditSig = () => `${courseKey()}.${COURSE.ops.length}`;
function mpEditFrame(dt) {
  if ((MP.sendT += dt) < 0.5) return;
  MP.sendT = 0;
  const sig = mpEditSig();
  if (sig !== MP.sig) { MP.sig = sig; mpPost({ t: 'sig', sig }); }
  const g = mpGroundNow();
  if (g !== MP.ground) {                                             // G while driving, or an imported course
    if (MP.ground && COURSE.bank && (g === 'road') === (MP.ground === 'road')) { clearSkids(); regenerateWorld(); }
    MP.ground = g; mpPost({ t: 'ground', ground: g });
  }
}

// skid marks (#306): ours as 4 bits a wheel (0-15, how dark: the darkest since the last state sent), theirs drawn
// under their wheels from the same
const mpSkMax = [0, 0, 0, 0];
function mpSkidsOut() {
  const n = mpSkMax.reduce((n, a, i) => n + Math.round(clamp(a / 0.85, 0, 1) * 15) * 16 ** i, 0);
  mpSkMax.fill(0); return n;
}
const mpSk = new THREE.Vector3(), mpSkF = new THREE.Vector3();
function mpPeerSkids(pe, sk) {
  const V = pe.V, hw = (V.pressures?.[V.pIdx ?? 1]?.w ?? 0.33) * 0.45, tRest = V.REST - V.mass * 9.81 / 4 / V.K;
  V.wheels.forEach((W, i) => {
    const key = `${pe.id}:${i}`, a = i < 4 ? (Math.floor(sk / 16 ** i) % 16) / 15 * 0.85 : 0;
    if (!a) { skidPoint(key, 0, 0, 0, 0, 1, hw, 0); return; }
    mpSk.set(W.hp.x, W.hp.y - tRest, W.hp.z).applyQuaternion(pe.q).add(pe.pos);
    const yHub = mpSk.y; mpSk.set(W.hp.x, W.hp.y - tRest - V.R, W.hp.z).applyQuaternion(pe.q).add(pe.pos);
    const st = W.front ? pe.steer : 0; mpSkF.set(Math.sin(st), 0, Math.cos(st)).applyQuaternion(pe.q);
    skidPoint(key, mpSk.x, surfaceAt(mpSk.x, mpSk.z, yHub) + 0.012, mpSk.z, mpSkF.x, mpSkF.z, hw, a);
  });
}

const mpQa = new THREE.Quaternion(), mpQb = new THREE.Quaternion(), mpV = new THREE.Vector3();
// where another car is between two of its states A and C (f: 0 to 1, a little more: carried on), on a curve through
// them and their neighbours P and D (Catmull-Rom on the states' times) that keeps its speed from one to the next, not
// straight lines that change it at each state (#345); a jump (R, back to a gate) is a jump, not a slide
const mpFar = (X, Y) => Math.hypot(Y.p[0] - X.p[0], Y.p[1] - X.p[1], Y.p[2] - X.p[2]) > 2 + 0.1 * Math.abs(Y.t - X.t);
function mpSpline(o, P, A, C, D, f) {
  if (C !== A && mpFar(A, C)) { const S = f < 0.5 ? A : C; o.set(S.p[0], S.p[1], S.p[2]); return; }
  const h = C.t - A.t, a = P !== A && C.t > P.t && !mpFar(P, A) ? h / (C.t - P.t) : 0, c = D !== C && D.t > A.t && !mpFar(C, D) ? h / (D.t - A.t) : 0;
  const f2 = f * f, f3 = f2 * f, h00 = 2 * f3 - 3 * f2 + 1, h10 = f3 - 2 * f2 + f, h01 = 3 * f2 - 2 * f3, h11 = f3 - f2;
  for (let x = 0; x < 3; x++) {
    const mA = a ? (C.p[x] - P.p[x]) * a : C.p[x] - A.p[x], mC = c ? (D.p[x] - A.p[x]) * c : C.p[x] - A.p[x];
    mpS[x] = f > 1 ? C.p[x] + mC * (f - 1) : h00 * A.p[x] + h10 * mA + h01 * C.p[x] + h11 * mC;
  }
  o.set(mpS[0], mpS[1], mpS[2]);
}
const mpS = [0, 0, 0];

function mpFrame(dt) {
  if (!MP.on) { if (MP.edit) mpEditFrame(dt); return; }
  const now = performance.now();
  mpBestFrame(dt); mpGhostFrame(dt);
  const racing = (MP.phase === 'countdown' || MP.phase === 'racing') && !MP.finished && !MP.spectator;
  if (racing !== MP.racingCls) { MP.racingCls = racing; document.body.classList.toggle('mp-race', racing); if (racing && rp.on) stopReplay(); }
  // countdown on the grid
  if (MP.hold) {
    const left = (MP.goAt - now) / 1000, cd = Math.ceil(left);
    if (left <= 0) mpGreen();
    else if (cd !== MP.cd && cd <= 3) { MP.cd = cd; flash(String(cd), '#fff', 0.9); }
  }
  if (MP.finishFlash) { flash(MP.finishFlash, '#7dff9a', 5); MP.finishFlash = null; }
  // the others, a little in the past, then carried on to now (#322): along their heading at their speed and turning at
  // their rate (its slide across that and the turn from their last states, smoothed), so they are drawn and touched
  // where they are, not where they were 0.2 s ago; and with the pushes we gave them (mpContacts: pe.kicks) till their own
  // reply to those comes back (lead after the push)
  const lead = (PEER_DELAY + MP.lag) / 1000, ks = 1 - Math.exp(-dt / 0.12);
  for (const pe of MP.peers.values()) {
    const B = pe.buf, V = pe.V;
    const show = B.length > 0 && now - pe.rx < PEER_STALE && !(pe.spectator && !MP.spectator && MP.phase !== 'lobby' && MP.phase !== 'results');
    if (show !== pe.shown) { pe.shown = show; V.vis.visible = show; if (pe.label) pe.label.visible = show; }
    if (!show) { mpPeerSkids(pe, 0); continue; }
    // the time drawn, on its clock (#345); the offset to ours eased, its time running 2% faster or slower at most, or set at once if it moved a lot
    const dOff = pe.offT - pe.off; pe.off += Math.abs(dOff) > 100 ? dOff : clamp(dOff, -20 * dt, 20 * dt);
    const rt = now - pe.off - PEER_DELAY;
    while (B.length > 3 && B[2].t <= rt) B.shift();                    // (one state kept before A: the curve's P)
    const k = B.length > 1 && B[1].t <= rt ? 1 : 0, A = B[k], C = B[k + 1] || A, f = C.t > A.t ? clamp((rt - A.t) / (C.t - A.t), 0, 1.25) : 0;
    if (pe.clk) mpSpline(pe.pos, B[k - 1] || A, A, C, B[k + 2] || C, f);
    else pe.pos.set(lerp(A.p[0], C.p[0], f), lerp(A.p[1], C.p[1], f), lerp(A.p[2], C.p[2], f));   // (times as they came: a curve would make it worse)
    pe.q.copy(mpQa.fromArray(A.q)).slerp(mpQb.fromArray(C.q), Math.min(f, 1));
    pe.v = lerp(A.v, C.v, Math.min(f, 1)); pe.steer = lerp(A.st, C.st, Math.min(f, 1)); pe.spin += (C.w || 0) * dt;
    if (C !== A && C.t - A.t > 0.025e3 && !mpFar(A, C)) {                 // (not across a jump: no slide of 2 km/s)
      const dts = (C.t - A.t) / 1000, qa = mpQa.fromArray(A.q), qc = mpQb.fromArray(C.q);
      mpV.set(0, 0, 1).applyQuaternion(qa); const ya = Math.atan2(mpV.x, mpV.z); mpV.set(0, 0, 1).applyQuaternion(qc); const yc = Math.atan2(mpV.x, mpV.z);
      const hl = Math.hypot(mpV.x, mpV.z) || 1, fx = mpV.x / hl, fz = mpV.z / hl, vx = (C.p[0] - A.p[0]) / dts, vz = (C.p[2] - A.p[2]) / dts, sl = vx * -fz + vz * fx;
      pe.sx = lerp(pe.sx, -fz * sl, ks); pe.sz = lerp(pe.sz, fx * sl, ks);
      pe.wy = lerp(pe.wy, clamp(Math.atan2(Math.sin(yc - ya), Math.cos(yc - ya)) / dts, -4, 4), ks);
    }
    let dYaw = pe.wy * lead, kx = 0, kz = 0, kvx = 0, kvz = 0, kw = 0;
    pe.kicks = pe.kicks.filter(k => {
      const age = (now - k.t) / 1000, w = 1 - sstep(lead, lead + 0.15, age), a = Math.min(age, lead);
      kx += (k.vx * a + k.dx) * w; kz += (k.vz * a + k.dz) * w; dYaw += k.wy * a * w; kvx += k.vx * w; kvz += k.vz * w; kw += k.wy * w;
      return w > 0;
    });
    mpV.set(0, 0, 1).applyQuaternion(pe.q).applyAxisAngle(THREE.Object3D.DEFAULT_UP, pe.wy * lead / 2);    // its heading half way on
    pe.pos.x += (mpV.x * pe.v + pe.sx) * lead + kx; pe.pos.y += mpV.y * pe.v * lead; pe.pos.z += (mpV.z * pe.v + pe.sz) * lead + kz;
    pe.q.premultiply(mpQa.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, dYaw));
    mpV.set(0, 0, 1).applyQuaternion(pe.q); const hl = Math.hypot(mpV.x, mpV.z) || 1; pe.fx = mpV.x / hl; pe.fz = mpV.z / hl;
    pe.vx = pe.fx * pe.v + pe.sx + kvx; pe.vz = pe.fz * pe.v + pe.sz + kvz; pe.wy0 = pe.wy + kw;   // now (mpContacts)
    V.vis.position.copy(pe.pos); V.vis.quaternion.copy(pe.q);
    const tRest = V.REST - V.mass * 9.81 / 4 / V.K;
    for (const W of V.wheels) {
      if (!W.holder) continue;
      W.holder.position.set(W.hp.x, W.hp.y - tRest, W.hp.z); W.holder.rotation.set(0, W.front ? pe.steer : 0, 0);
      if (W.spinner) W.spinner.rotation.x = pe.spin;
    }
    if (pe.label) pe.label.position.set(pe.pos.x, pe.pos.y + 2.4, pe.pos.z);
    mpPeerSkids(pe, (f < 0.5 ? A : C).sk);
  }
  flushSkids();
  // ours, to the others
  car.wheels.forEach((W, i) => { if (i < 4) mpSkMax[i] = Math.max(mpSkMax[i], W.skid || 0); });
  if ((MP.sendT += dt) >= 0.05 && !rp.on && !ed.on) {
    MP.sendT = 0;
    const R = car.wheels[2];
    mpPost({ t: 's', p: car.pos.toArray(), q: car.q.toArray(), v: car.vel.dot(fwd), st: car.steer, sp: R?.omega || 0, prog: mpProgress(), lap: lap.lapNo, sk: mpSkidsOut(), ts: Math.round(now) });
    MP.sent.push({ t: now, x: rd2(car.pos.x), y: rd2(car.pos.y), z: rd2(car.pos.z) }); if (MP.sent.length > 30) MP.sent.shift();   // (mpLagEcho: as the server rounds them)
  }
}

// contact with the other players' cars (#322: ccSolve, as with the bots, where mpFrame put them: now): each side moves
// only its own car, and keeps the push it gave the other (pe.kicks) till the other's own reply to it comes back
function mpContacts(dt) {
  if (!MP.on || MP.spectator || rp.on || !MP.peers.size) return;
  const now = performance.now();
  for (const pe of MP.peers.values()) {
    if (!pe.shown || pe.spectator || Math.abs(car.pos.y - pe.pos.y) > 1.6) continue;
    const [hw, zF, zR] = pe.V.box, A = ccOurs(CC.a), O = ccBody(CC.b, pe.pos.x, pe.pos.z, pe.fx, pe.fz, hw, zF, zR, pe.vx, pe.vz, pe.wy0 || 0, pe.V.mass, pe.V.I?.y);
    const H = ccSolve(A, O); if (!H) continue;
    ccOursBack(A);
    pe.kicks.push({ t: now, vx: O.vx - pe.vx, vz: O.vz - pe.vz, wy: O.wy - (pe.wy0 || 0), dx: O.dx, dz: O.dz });
    if (pe.kicks.length > 60) pe.kicks.shift();
    pe.vx = O.vx; pe.vz = O.vz; pe.wy0 = O.wy; pe.pos.x += O.dx; pe.pos.z += O.dz;                  // (till mpFrame's next)
    ccOurHit(H, pe.name);
  }
}

if (MP.on) {
  document.body.classList.add('mp');
  BOTS.n = 0;
  MP.hits = new Map();
  dentablesOf(BUGGY); MP.buggyTpl = buggy.clone(true);       // the others' buggies: copies of ours as built (its body meshes marked to dent)
  carHitHook = mpSendHit; carRepairHook = () => mpPost({ t: 'repair' });
  // the chat (#325): Enter opens the race page's line to write on (a wrecked car's Enter still repairs it); the keys
  // held let go, as whenever the page loses the focus (the keyups go to the page, not to us)
  const keysUp = () => { for (const k in keys) keys[k] = false; };
  addEventListener('keydown', e => { if (e.code === 'Enter' && !e.repeat && !car.wrecked && !ed.on) { e.stopImmediatePropagation(); e.preventDefault(); keysUp(); mpPost({ t: 'chatKey' }); } }, true);
  addEventListener('blur', keysUp);
  const help = document.getElementById('help');
  help.innerHTML = '<b>W/↑</b> throttle &nbsp; <b>S/↓</b> brake / reverse &nbsp; <b>A D/← →</b> steer &nbsp; <b>Space</b> handbrake &nbsp; <b>R</b> back to last gate<br><b>C</b> camera &nbsp; <b>Shift/right-drag</b> look around &nbsp; <b>P</b> tire pressure &nbsp; <b>4</b> 2WD/4WD &nbsp; <b>X</b> driver aids &nbsp; <b>Y</b> replay (not in a race) &nbsp; <b>M</b> mute &nbsp; <b>Enter</b> chat &nbsp; <b>H</b> hide this';
  addEventListener('message', e => { if (e.origin === location.origin && e.source === parent) mpMessage(e.data); });
}
if (MP.edit) {
  BOTS.n = 0;
  addEventListener('message', e => { if (e.origin === location.origin && e.source === parent) mpEditMessage(e.data); });
  addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') { e.preventDefault(); e.stopImmediatePropagation(); mpPost({ t: 'save' }); } }, true);
}
