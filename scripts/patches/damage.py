# Car damage (ticket #291): the bodywork crumples harder (crumple zones at the ends, a stiffer
# cabin, a roof that caves in, a nose that folds), a hard hit bends the frame (that axle out of
# line, so the car pulls; that corner lower), the bots' cars crumple too, and every hit is a small
# deterministic record (bodyHit) that the multiplayer block sends to the room so the others see
# our car crumple as we do (carHitHook, carRepairHook: scripts/patches/mp-block.js).
# Applies to public/sim after the other patches (mp-hooks, track-shape, gates, cameras, maps, road-level):
#   python3 scripts/patches/damage.py <dir with engine.js>
import sys, os
d = sys.argv[1]
ep = os.path.join(d, 'engine.js')
s = open(ep).read()

def rep(a, b):
    global s
    n = s.count(a)
    assert n == 1, (n, a[:140])
    s = s.replace(a, b)

def span(a, b, new):
    """replace from the line starting with a up to (not including) the line starting with b"""
    global s
    assert s.count(a) == 1 and s.count(b) == 1, (s.count(a), s.count(b), a[:80], b[:80])
    i, j = s.index(a), s.index(b)
    assert i < j
    s = s[:i] + new + s[j:]

# ---------------------------------------------------------------- the damage section
span("// --- buggy damage ---\n", "// damage read-out: a small top-down buggy", r"""// --- car damage ---
const ZONES = ['front', 'rear', 'left', 'right', 'roof', 'under'];
function damageCar(cx, cz, nlx, nlz, vn, g) {
  const zone = Math.abs(nlz) >= Math.abs(nlx) ? (nlz > 0 ? 'front' : 'rear') : (nlx > 0 ? 'left' : 'right');
  addDamage(zone, vn * vn * 0.0035);
  // nearest wheel gets knocked out of alignment
  let bw = null, bd = 0.9;
  for (const W of car.wheels) { const d = Math.hypot(W.hp.x - cx, W.hp.z - cz); if (d < bd) { bd = d; bw = W; } }
  if (bw) {
    const s = Math.sign(bw.hp.x);
    bw.toe = clamp(bw.toe + (nlz !== 0 ? -nlz * s : nlx * 0.5) * vn * 0.006, -0.1, 0.1);
    bw.camber = clamp(bw.camber + vn * 0.012 * s * (nlx * s > 0 ? 1 : 0.4), -0.25, 0.25);
  }
  carHit(dP.set(cx, 0.4, cz), dD.set(-nlx, 0, -nlz), vn, HIT.post);
  if (hitCooldown <= 0 && !car.wrecked) {
    hitCooldown = 0.6;
    const idx = TRACK.gates.indexOf(g);
    flash(`Hit the ${gateName(idx)} gate · ${zone} damage ${Math.round(car.dmg[zone] * 100)}%`, '#ff9a6a', 2.2);
  }
}
/* Bodywork, for any car: ours (VEH), a bot's, another player's. V.vis is the body, V.box its extent
   ([half width, front z, rear z]), body axes +z forward, +y up, +x left.
   A hit is h = [cx, cy, cz, dx, dy, dz, vn, kind] in body space: where it struck, which way it pushes
   (into the body), how hard (m/s), and what struck: HIT.post a gate post (a vertical crease),
   HIT.ball something round (another car's corner), HIT.wall a flat face (the ground: landings,
   nose-dives, rollovers). The same hits give the same crumple on any copy of the body, so the
   multiplayer block sends ours to the room (carHitHook) and replays the others' (bodyHit). */
const HIT = { post: 0, ball: 1, wall: 2 };
let carHitHook = null, carRepairHook = null;
const rd2 = x => Math.round(x * 100) / 100, rd3 = x => Math.round(x * 1000) / 1000;
const dM = new THREE.Matrix4(), dInv = new THREE.Matrix4(), dV = new THREE.Vector3(), dS = new THREE.Vector3(), dW = new THREE.Vector3(), dP = new THREE.Vector3(), dD = new THREE.Vector3();
const hC = new THREE.Vector3(), hD = new THREE.Vector3();
// our car hit: its body, the frame if hard enough, and the others told
function carHit(c, dir, vn, kind) {
  const n = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const h = [rd2(c.x), rd2(c.y), rd2(c.z), rd3(dir.x / n), rd3(dir.y / n), rd3(dir.z / n), rd2(Math.min(vn, 60)), kind];
  bodyHit(VEH, h, car.vel);
  if (vn > FRAME_VN) bendFrame(hC.set(h[0], h[1], h[2]), hD.set(h[3], h[4], h[5]), vn);
  carHitHook?.(h);
}
function bodyHit(V, h, vel) {
  const c = hC.set(h[0], h[1], h[2]), dir = hD.set(h[3], h[4], h[5]), vn = h[6], kind = h[7];
  if (dir.lengthSq() < 1e-6) return; dir.normalize();
  dentBody(V, c, dir, vn, kind);
  hitParts(V, c, dir, vn, vel);
  if (vn > 5) shedParts(V, c, dir, vn, vel);
}
// the meshes that dent: the body, not the wheels, springs, links, flag pole or flames
function dentablesOf(V) {
  if (V.dentables) return V.dentables;
  const list = [];
  if (V.key === 'buggy' && V !== BUGGY) {               // a copy of the buggy (another player's): the meshes marked on ours
    V.vis.traverse(o => { if (o.isMesh && o.userData.sbDent) list.push(o); });
    return V.dentables = list;
  }
  const ex = new Set(V === BUGGY ? [...BUGGY.wheels.map(w => w.holder), ...BUGGY.wheels.map(w => w.vis.sus.coil.g), ...rig.links.map(l => l.m), rig.pole.g, rig.fan, rig.flame, rig.head?.parent, rig.steeringWheel?.parent]
    : [...V.wheels.map(w => w.holder), ...(V.built?.flames || [])]);
  V.vis.traverse(o => { if (!o.isMesh || !o.visible) return; for (let p = o; p && p !== V.vis; p = p.parent) if (ex.has(p)) return; list.push(o); });
  if (V === BUGGY) for (const m of list) m.userData.sbDent = 1;
  return V.dentables = list;
}
const localIn = (m, root, out) => { out.identity(); for (let o = m; o && o !== root; o = o.parent) { o.updateMatrix(); out.premultiply(o.matrix); } return out; };
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// how readily the body gives at p (body space): the ends are crumple zones (1), the cabin holds (0.4), the roof caves in (0.8)
function bodySoft(V, p) {
  const t = (p.z - V.box[2]) / (V.box[1] - V.box[2]);
  let k = 0.4 + 0.6 * Math.max(1 - sstep(0.12, 0.32, t), sstep(0.68, 0.88, t));
  if (V.roofY != null && p.y > V.roofY - 0.25) k = Math.max(k, 0.8);
  return k;
}
// Crumple the bodywork around c, pushing vertices along dir; deeper with speed, deepest at the ends.
// A wall folds what is near its face (the nose shortens, the roof comes down) and buckles the panels
// behind it outward; no vertex moves more than its zone allows from where it was built.
// A hit's point comes from the car's box (the buggy's spans its wheels, its tubes are well inside): slide it
// along dir onto the bodywork, so the dent is where the body is. (Moves c; the same on every copy of the car.)
function contactOn(V, c, dir, R, post) {
  const reach = R * 0.6;                        // body this close to the hit's line counts
  let best = Infinity;
  for (const m of dentablesOf(V)) {
    if (m.userData.loose) continue;
    localIn(m, V.vis, dM);
    const g = m.geometry; if (!g.boundingSphere) g.computeBoundingSphere();
    dS.copy(g.boundingSphere.center).applyMatrix4(dM).sub(c);
    const along = dS.dot(dir), rad = g.boundingSphere.radius * dM.getMaxScaleOnAxis();
    if (along + rad < -0.05 || along - rad >= best) continue;
    const latC = post ? Math.hypot(dS.x - along * dir.x, dS.z - along * dir.z) : dW.copy(dS).addScaledVector(dir, -along).length();
    if (latC > rad + reach) continue;
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      dV.fromBufferAttribute(pos, i).applyMatrix4(dM).sub(c);
      if (post && (dV.y + c.y < -0.45 || dV.y + c.y > 1.45)) continue;
      const sd = dV.dot(dir); if (sd < -0.05 || sd >= best) continue;
      const lat = post ? Math.hypot(dV.x - sd * dir.x, dV.z - sd * dir.z) : dW.copy(dV).addScaledVector(dir, -sd).length();
      if (lat <= reach) best = sd;
    }
  }
  if (best > 0 && best < 2) c.addScaledVector(dir, best);
}
function dentBody(V, c, dir, vn, kind) {
  const post = kind === HIT.post, wall = kind === HIT.wall;
  const depth = Math.min(0.03 + vn * 0.02, 0.45);
  const R = wall ? Math.min(0.3 + vn * 0.05, 1.2) : Math.min(0.25 + vn * 0.035, 0.85), RL = wall ? Math.min(0.6 + vn * 0.06, 1.5) : R;
  const along = Math.abs(dir.z);
  if (!wall) contactOn(V, c, dir, R, post);
  for (const m of dentablesOf(V)) {
    if (m.userData.loose) continue;
    localIn(m, V.vis, dM);
    const g0 = m.geometry; if (!g0.boundingSphere) g0.computeBoundingSphere();
    dS.copy(g0.boundingSphere.center).applyMatrix4(dM);
    const reach = g0.boundingSphere.radius * dM.getMaxScaleOnAxis() + (wall ? R + RL : R);
    if ((post ? Math.hypot(dS.x - c.x, dS.z - c.z) : dS.distanceTo(c)) > reach) continue;
    if (!m.userData.orig) {                 // own copy of the geometry, remembering the undamaged shape
      m.geometry = g0.clone();
      m.userData.orig = { geo: g0 };
    }
    const pos = m.geometry.attributes.position, p0 = m.userData.orig.geo.attributes.position; dInv.copy(dM).invert();
    let moved = false;
    for (let i = 0; i < pos.count; i++) {
      dV.fromBufferAttribute(pos, i).applyMatrix4(dM);
      let f, buckle = 0;
      if (post) {
        if (dV.y < -0.45 || dV.y > 1.45) continue;
        const d = Math.hypot(dV.x - c.x, dV.z - c.z); if (d >= R) continue;
        f = (1 - d / R) ** 2;
      } else if (wall) {
        dS.subVectors(dV, c); const sd = Math.max(0, dS.dot(dir)); if (sd >= R) continue;
        const lat = dS.addScaledVector(dir, -dS.dot(dir)).length(); if (lat >= RL) continue;
        f = (1 - sd / R) ** 1.5 * (1 - (lat / RL) ** 2);
        buckle = Math.sin(Math.PI * sd / R) * along;     // a nose or tail folding: the panels behind the face bow up
      } else {
        const d = dV.distanceTo(c); if (d >= R) continue;
        f = (1 - d / R) ** 2;
      }
      const k = bodySoft(V, dV), wob = 1 + 0.35 * Math.sin(dV.x * 37 + dV.y * 23 + dV.z * 29);   // uneven crumple
      f *= depth * k * wob;
      dV.addScaledVector(dir, f);
      if (buckle) dV.y += f * 0.3 * buckle; else dV.y -= f * 0.1;
      // no further than the zone allows from the built shape
      dW.fromBufferAttribute(p0, i).applyMatrix4(dM);
      const off = dS.subVectors(dV, dW), lim = 0.15 + 0.5 * k, ol = off.length();
      if (ol > lim) dV.copy(dW).addScaledVector(off, lim / ol);
      dV.applyMatrix4(dInv); pos.setXYZ(i, dV.x, dV.y, dV.z); moved = true;
    }
    if (moved) { pos.needsUpdate = true; if (m.geometry.index) m.geometry.computeVertexNormals(); m.geometry.computeBoundingSphere(); }
  }
}
// Detailed models: panels near the hit lose health with the square of the impact speed. Damaged panels sag and gape; at zero they fly off.
function hitParts(V, c, dir, vn, vel) {
  if (!V.parts || vn < 1.5) return;
  for (const P of V.parts) {
    if (P.hp <= 0) continue;
    const d = dS.copy(P.c).sub(c); d.y *= 0.4; const dist = d.length(), reach = P.r + 0.35; if (dist > reach) continue;
    P.hp -= (vn / P.tough) ** 2 * (1 - 0.6 * dist / reach);
    if (P.hp <= 0) {
      if (debris.length > 60) { P.hp = 0.05; continue; }
      const m = P.o, parent = m.parent, p0 = P.p0.clone(), q0 = P.q0.clone(), s0 = m.scale.clone();
      V.vis.updateMatrixWorld(true); const mw = m.matrixWorld.clone();
      parent.remove(m); scene.add(m); mw.decompose(m.position, m.quaternion, m.scale); m.traverse(o => { o.userData.loose = true; });
      const out = v1.copy(dir).negate().applyQuaternion(V.vis.quaternion), k = Math.min(1, vn / 14);
      debris.push({ V, m, parent, p0, q0, s0, vel: new THREE.Vector3().copy(vel).multiplyScalar(0.75).addScaledVector(out, 1 + 3 * k * Math.random()).add(v2.set((Math.random() - 0.5) * 2, 1 + 3 * k * Math.random(), (Math.random() - 0.5) * 2)),
        spin: new THREE.Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9), rest: false });
    } else {
      const sag = 1 - P.hp, m = P.o;                                // hanging loose: pushed in, dropped and twisted a little
      m.position.copy(P.p0).addScaledVector(dir, 0.05 * sag); m.position.y -= 0.035 * sag;
      m.quaternion.copy(P.q0).multiply(dq.setFromEuler(dE.set(0.05 * sag, 0.07 * sag * P.sgn, 0.06 * sag * P.sgn)));
    }
  }
}
const dE = new THREE.Euler();
// Small parts near a big hit break off and fly (which ones: a hash of the hit, so every copy of the car loses the same)
const debris = [];
const hash01 = (i, c, vn) => { const x = Math.sin(i * 12.9898 + c.x * 78.233 + c.y * 3.71 + c.z * 37.719 + vn * 4.13) * 43758.5453; return x - Math.floor(x); };
function shedParts(V, c, dir, vn, vel) {
  const chance = clamp((vn - 5) / 8, 0.1, 0.8), R = 0.5 + vn * 0.03, list = dentablesOf(V);
  V.vis.updateMatrixWorld(true);
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    if (m.userData.loose || debris.length > 40) continue;
    const g0 = m.geometry; if (!g0.boundingSphere) g0.computeBoundingSphere();
    const r = g0.boundingSphere.radius * localIn(m, V.vis, dM).getMaxScaleOnAxis();
    if (r > 0.45 || r < 0.03) continue;
    dS.copy(g0.boundingSphere.center).applyMatrix4(dM);
    if (dS.distanceTo(c) > R || hash01(i, c, vn) > chance) continue;
    const parent = m.parent, p0 = m.position.clone(), q0 = m.quaternion.clone(), s0 = m.scale.clone();
    m.updateMatrixWorld(true); const mw = m.matrixWorld.clone();
    parent.remove(m); scene.add(m); m.userData.loose = true; mw.decompose(m.position, m.quaternion, m.scale);
    const out = v1.copy(dir).negate().applyQuaternion(V.vis.quaternion);
    debris.push({ V, m, parent, p0, q0, s0, vel: new THREE.Vector3().copy(vel).multiplyScalar(0.7).addScaledVector(out, 2 + Math.random() * 3).add(v2.set((Math.random() - 0.5) * 2, 2 + Math.random() * 3, (Math.random() - 0.5) * 2)),
      spin: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14), rest: false });
  }
}
const dq = new THREE.Quaternion();
function updateDebris(dt) {
  for (const d of debris) {
    if (d.rest) continue;
    d.vel.y -= 9.81 * dt; d.m.position.addScaledVector(d.vel, dt);
    const s = d.spin.length(); if (s > 1e-3) d.m.quaternion.premultiply(dq.setFromAxisAngle(v1.copy(d.spin).divideScalar(s), s * dt));
    const gy = surfaceAt(d.m.position.x, d.m.position.z, d.m.position.y) + 0.04;
    if (d.m.position.y < gy) {
      d.m.position.y = gy; d.vel.y = Math.abs(d.vel.y) * 0.3; d.vel.x *= 0.6; d.vel.z *= 0.6; d.spin.multiplyScalar(0.6);
      if (d.vel.lengthSq() < 0.2) d.rest = true;
    }
  }
}
// a body as built: thrown parts back on, panels straight, dents out
function repairBody(V) {
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i]; if (d.V !== V) continue;
    scene.remove(d.m); d.parent.add(d.m); d.m.position.copy(d.p0); d.m.quaternion.copy(d.q0); d.m.scale.copy(d.s0); d.m.traverse(o => { o.userData.loose = false; });
    debris.splice(i, 1);
  }
  if (V.parts) for (const P of V.parts) { P.hp = 1; P.o.position.copy(P.p0); P.o.quaternion.copy(P.q0); }
  if (V.dentables) for (const m of V.dentables) {
    const o = m.userData.orig; if (!o) continue;
    m.geometry.dispose(); m.geometry = o.geo; m.userData.orig = null;
  }
}
/* The frame. A hit over FRAME_VN m/s bends it: the axle nearest the hit is knocked out of line, both
   wheels the same way (a thrust angle: the car pulls to one side with the wheel straight), and the
   corner it hit sits lower (W.sag lifts that wheel's mount, W.hp, so the body rides lower there).
   Both pull toward the corner hit's side as the physics reacts: a low front-left or rear-right corner pulls
   right, so its axle swings to pull right too. From below or above (landings, rollovers) the whole
   axle drops, evenly. Repairs put it back. */
const FRAME_VN = 6;
function sagCorner(W, amt) {
  if (!W.hp0) W.hp0 = W.hp.clone();
  W.sag = Math.min((W.sag || 0) + amt, 0.3 * car.REST);
  W.hp.y = W.hp0.y + W.sag;
}
function bendFrame(c, dir, vn) {
  const sev = Math.min(vn - FRAME_VN, 14), front = c.z > (CAR_ZF + CAR_ZR) / 2, axle = car.wheels.filter(W => W.front === front);
  let near = axle[0]; for (const W of axle) if (Math.abs(W.hp.x - c.x) < Math.abs(near.hp.x - c.x)) near = W;
  // pushed sideways the axle swings, pushed along the car off its centre line it yaws: either way out of
  // line toward the corner hit, which (with that corner lower, which pulls the same way) is where the car pulls
  const off = clamp(c.x / Math.max(0.3, CAR_HW), -1, 1), side = Math.sign(near.hp.x) || 1;
  const swing = -side * (Math.abs(dir.x) * 0.8 + Math.abs(off * dir.z) * 0.6) * sev * 0.0022;
  const pull0 = framePull(), vert = Math.abs(dir.y) > 0.7;
  if (!vert) for (const W of axle) W.toe = clamp(W.toe + swing, -0.1, 0.1);
  for (const W of vert ? axle : [near]) sagCorner(W, sev * 0.005);
  const pull = framePull();
  if (Math.abs(pull) > 0.006 && (Math.abs(pull0) <= 0.006 || Math.sign(pull) !== Math.sign(pull0))) flash(`Frame bent · it pulls ${pull > 0 ? 'left' : 'right'}`, '#ffb36a', 2.4);
}
// which way a bent frame steers the car: front wheels pointing left turn it left, rear ones turn it right (+ = left, rad)
function framePull() { let f = 0, r = 0, nf = 0, nr = 0; for (const W of car.wheels) if (W.front) { f += W.toe; nf++; } else { r += W.toe; nr++; } return f / (nf || 1) - r / (nr || 1); }
const frameSag = () => Math.max(0, ...car.wheels.map(W => W.sag || 0));
// Impacts of the frame / roll cage on the ground (falls, rollovers, nose-dives)
function crashImpact(hpt, vn, tn) {
  if (car.grace > 0) return;
  const zone = hpt.y > VEH.roofY ? 'roof' : hpt.z > CAR_ZF - 0.9 ? 'front' : hpt.z < CAR_ZR + 0.8 ? 'rear' : hpt.y < VEH.underY ? 'under' : hpt.x > 0 ? 'left' : 'right';
  if (window.__crashlog) window.__crashlog.push({ t: +simTime.toFixed(2), zone, vn: +vn.toFixed(2), p: [+car.pos.x.toFixed(1), +car.pos.z.toFixed(1)], up: +(1 - 2 * (car.q.x ** 2 + car.q.z ** 2)).toFixed(2), v: +car.vel.length().toFixed(1) });
  const amt = (vn - 2.5) ** 2 * 0.02;
  addDamage(zone, amt);
  audio?.node.port.postMessage({ crash: Math.min(1.2, (vn - 2) * 0.12) });
  gcV.qi.copy(car.q).invert();
  dD.copy(tn).applyQuaternion(gcV.qi);                    // push direction in body space
  carHit(dP.copy(hpt), dD, vn, HIT.wall);
  if (vn > 4 && hitCooldown <= 0 && !car.wrecked) { hitCooldown = 0.6; flash(`${zone === 'roof' ? 'Rolled it' : zone === 'under' ? 'Hard landing' : 'Crash'} · ${zone} damage ${Math.round(car.dmg[zone] * 100)}%`, '#ff9a6a', 2); }
}
// Suspension bottoming out on a big landing bends that corner (and a very big one drops it)
function wheelImpact(W, v) {
  if (car.grace > 0) return;
  const amt = (v - 3.2) ** 2 * 0.012, s = Math.sign(W.hp.x);
  audio?.node.port.postMessage({ thump: Math.min(1, v * 0.12) });
  if (window.__crashlog) window.__crashlog.push({ t: +simTime.toFixed(2), wheel: W.name, v: +v.toFixed(2), p: [+car.pos.x.toFixed(1), +car.pos.z.toFixed(1)] });
  addDamage(W.front ? 'front' : 'rear', amt * 0.6); addDamage('under', amt * 0.4);
  W.camber = clamp(W.camber + s * amt * 0.5, -0.3, 0.3); W.toe = clamp(W.toe + (Math.random() - 0.5) * amt * 0.3, -0.12, 0.12);
  if (v > 7) sagCorner(W, (v - 7) * 0.004);
}
function addDamage(zone, amt) {
  if (car.wrecked || amt <= 0) return;
  car.dmg[zone] = Math.min(1, car.dmg[zone] + amt);
  if (carCondition() <= 0) wreck();
}
// 1 = perfect, 0 = wrecked. Any zone at 100 % or a lot of damage overall wrecks the buggy.
function carCondition() { const d = car.dmg; let sum = 0, mx = 0; for (const z of ZONES) { sum += d[z]; mx = Math.max(mx, d[z]); } return clamp(1 - Math.max(sum / 2.4, mx >= 1 ? 1 : 0), 0, 1); }
function wreck() {
  car.wrecked = true;
  document.getElementById('wreck').style.display = 'flex';
  flash('WRECKED', '#ff5040', 3);
}
function repairCar() {
  for (const z of ZONES) car.dmg[z] = 0;
  for (const W of car.wheels) { W.toe = 0; W.camber = 0; if (W.hp0) W.hp.copy(W.hp0); W.sag = 0; }
  repairBody(VEH);
  car.wrecked = false; document.getElementById('wreck').style.display = 'none';
  carRepairHook?.();
}
function repairAll() { repairCar(); repairGates(); for (const b of BOTS.list) repairBody(b.V); }

""")

# ---------------------------------------------------------------- the damage read-out: the wheels show the frame
span("function drawDamage() {\n", "/* =====================================================================\n   VEHICLES:", r"""function drawDamage() {
  const d = car.dmg, pull = framePull(), bent = Math.abs(pull) > 0.006, ws = car.wheels.map(W => [W.front, W.hp.x > 0, W.toe, W.sag || 0]);
  const key = ZONES.map(z => d[z].toFixed(2)).join() + car.wrecked + ws.map(w => w[2].toFixed(3) + w[3].toFixed(3)).join();
  if (key === dmgKey) return; dmgKey = key;
  const c = dmgCtx, W = dmgCv.width, H = dmgCv.height, col = v => `hsl(${120 - 120 * Math.min(v * 1.4, 1)},85%,${v > 0.01 ? 52 : 40}%)`;
  c.clearRect(0, 0, W, H);
  c.fillStyle = 'rgba(255,255,255,.12)'; c.beginPath(); c.roundRect(W / 2 - 16, 14, 32, H - 40, 8); c.fill();
  // the wheels, turned by their toe (x12) and orange when the frame is out of line or that corner sits low
  for (const [front, left, toe, sag] of ws) {
    c.save(); c.translate(W / 2 + (left ? -25 : 25), front ? 27 : H - 39); c.rotate(-toe * 12);
    c.fillStyle = Math.abs(toe) > 0.004 || sag > 0.005 ? '#ffb36a' : 'rgba(255,255,255,.3)';
    c.beginPath(); c.roundRect(-3, -8, 6, 16, 2); c.fill(); c.restore();
  }
  c.lineWidth = 6; c.lineCap = 'round';
  c.strokeStyle = col(d.front); c.beginPath(); c.moveTo(W / 2 - 12, 14); c.lineTo(W / 2 + 12, 14); c.stroke();
  c.strokeStyle = col(d.rear); c.beginPath(); c.moveTo(W / 2 - 12, H - 26); c.lineTo(W / 2 + 12, H - 26); c.stroke();
  c.strokeStyle = col(d.left); c.beginPath(); c.moveTo(W / 2 - 16, 22); c.lineTo(W / 2 - 16, H - 34); c.stroke();
  c.strokeStyle = col(d.right); c.beginPath(); c.moveTo(W / 2 + 16, 22); c.lineTo(W / 2 + 16, H - 34); c.stroke();
  c.fillStyle = col(d.roof); c.globalAlpha = 0.85; c.fillRect(W / 2 - 9, 40, 18, 26); c.globalAlpha = 1;
  c.strokeStyle = col(d.under); c.lineWidth = 3; c.setLineDash([3, 3]); c.strokeRect(W / 2 - 11, 74, 22, 12); c.setLineDash([]);
  c.fillStyle = '#fff'; c.font = 'bold 11px system-ui'; c.textAlign = 'center';
  if (car.wrecked) c.fillText('WRECKED', W / 2, H - 6);
  else if (bent) {                                  // "72% · pulls right", centred
    const a = `${Math.round(carCondition() * 100)}% · `, b = `pulls ${pull > 0 ? 'left' : 'right'}`, x = (W - c.measureText(a + b).width) / 2;
    c.textAlign = 'left'; c.fillText(a, x, H - 6); c.fillStyle = '#ffb36a'; c.fillText(b, x + c.measureText(a).width, H - 6);
  }
  else c.fillText(`condition ${Math.round(carCondition() * 100)}%`, W / 2, H - 6);
}

""")

# ---------------------------------------------------------------- bots: their cars crumple where we hit them
rep("""          addDamage(zone, (vn - 1.5) ** 2 * 0.012); dentCar(bV, bN, vn, false); hitParts(bV, bN, vn);""",
    """          addDamage(zone, (vn - 1.5) ** 2 * 0.012); carHit(bV, bN, vn, HIT.ball);
          // and the bot's: the same contact seen from its side (where our car met it, pushing into it)
          bQi.copy(b.q).invert();
          bV.set(b.pos.x + b.fx * best.sb * hlB + nx * rr, b.pos.y, b.pos.z + b.fz * best.sb * hlB + nz * rr).sub(b.pos).applyQuaternion(bQi); bV.y = 0.5;
          bN.set(-nx, 0, -nz).applyQuaternion(bQi);
          bodyHit(b.V, [rd2(bV.x), rd2(bV.y), rd2(bV.z), rd3(bN.x), rd3(bN.y), rd3(bN.z), rd2(vn), HIT.ball], v3.set(b.fx * b.v, 0, b.fz * b.v));""")

# ---------------------------------------------------------------- a detailed model arriving (another player's car: its hits so far go onto it)
rep("""      attachModel(V, gltf.scene, D); V.modelState = 'ok';""",
    """      attachModel(V, gltf.scene, D); V.modelState = 'ok'; V.onModel?.();""")

# ---------------------------------------------------------------- for tests (step the physics, hit the car)
rep("""get camMode() { return camMode; } };""", """get camMode() { return camMode; } };
  Object.assign(window.__sim, { HIT, carHit, bodyHit, repairBody, repairCar, dentablesOf, framePull, frameSag });""")

open(ep, 'w').write(s)

print('damage patched')
