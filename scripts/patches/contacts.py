# Car against car (#322): one contact for every pair of cars (the bots and ours here; the other players' in mp-block.js,
# the autopilot's rival in autopilot.py): ccBody / ccSolve. Each car a capsule on the ground, the impulse at the contact
# point with both cars' masses and yaw inertias (a hit off the centre turns them), a little bounce (less the harder the
# hit) and the bodies' scrape along each other. The bots, on rails before (we bounced off them as off a wall, and one hit
# from behind slowed down), are knocked along and across their line and turned, and catch it.
# Applies to public/sim/engine.js after circuits.py:
#   python3 scripts/patches/contacts.py <dir with engine.js>
import sys, os
ep = os.path.join(sys.argv[1], 'engine.js')
s = open(ep).read()

def rep(a, b):
    global s
    n = s.count(a)
    assert n == 1, (n, a[:140])
    s = s.replace(a, b)

# ---------- the contact ----------
rep("""const bV = new THREE.Vector3(), bN = new THREE.Vector3(), bQi = new THREE.Quaternion();
""", """/* Car against car (#322), for the bots, the other players' cars and the autopilot's rival alike. Each car is a capsule on
   the ground: a segment along its axis (its box's length less its half width at each end) with its half width round it.
   One contact a pair, in the middle of where the capsules overlap: the impulse there from both cars' masses and yaw
   inertias (a hit off the centre turns them), a little bounce (less the harder the hit: the bodies crumple) and the
   bodies' scrape along each other (friction, up to CC_MU of the push); and the overlap pushed out by their masses.
   ccBody fills in a car (a mass of 0: it doesn't move, the replayed rival); ccSolve changes both bodies' velocities and
   yaw rates, and their moves out of the overlap (dx, dz), and returns the contact (CC.hit: where, which way it pushes
   A (n, from B to A), the closing speed vn at that point, the impulse J) or null when they don't touch. */
const CC = { a: {}, b: {}, hit: {} }, CC_E = [0.35, 0.08], CC_MU = 0.3;
function ccBody(o, x, z, fx, fz, hw, zF, zR, vx, vz, wy, m, Iy) {
  const r = Math.max(0.9, hw), pc = (zF + zR) / 2, fl = Math.hypot(fx, fz) || 1;
  o.x = x; o.z = z; o.fx = fx / fl; o.fz = fz / fl; o.r = r; o.hl = Math.max(0.3, (zF - zR) / 2 - r);
  o.cx = x + o.fx * pc; o.cz = z + o.fz * pc;
  o.vx = vx; o.vz = vz; o.wy = wy; o.im = m > 0 ? 1 / m : 0; o.iI = m > 0 && Iy > 0 ? 1 / Iy : 0; o.dx = 0; o.dz = 0;
  return o;
}
// the parameter (-1..1) of the point of B's axis nearest to (px, pz), and how far A's axis point s is from B's axis
const ccOn = (B, px, pz) => clamp(((px - B.cx) * B.fx + (pz - B.cz) * B.fz) / B.hl, -1, 1);
function ccGap(A, B, s) { const px = A.cx + A.fx * A.hl * s, pz = A.cz + A.fz * A.hl * s, t = ccOn(B, px, pz); return Math.hypot(px - B.cx - B.fx * B.hl * t, pz - B.cz - B.fz * B.hl * t); }
function ccSolve(A, B) {
  const reach = A.r + B.r - 0.1;
  if (Math.hypot(A.cx - B.cx, A.cz - B.cz) > A.hl + B.hl + reach) return null;
  // the nearest points of the two axes (segment against segment, parameters -1..1)
  const ax = A.fx * A.hl, az = A.fz * A.hl, bx = B.fx * B.hl, bz = B.fz * B.hl, rx = A.cx - B.cx, rz = A.cz - B.cz;
  const a = ax * ax + az * az, e = bx * bx + bz * bz, b = ax * bx + az * bz, c = ax * rx + az * rz, f = bx * rx + bz * rz, den = a * e - b * b;
  let s = den > 1e-9 * a * e ? clamp((b * f - c * e) / den, -1, 1) : 0, t = (b * s + f) / e;
  if (t < -1) { t = -1; s = clamp((-b - c) / a, -1, 1); } else if (t > 1) { t = 1; s = clamp((b - c) / a, -1, 1); }
  let dx = rx + ax * s - bx * t, dz = rz + az * s - bz * t, d = Math.hypot(dx, dz);
  if (d >= reach) return null;
  let nx, nz;
  if (d > 1e-4) { nx = dx / d; nz = dz / d; }
  else { const l = Math.hypot(rx, rz); if (l > 1e-4) { nx = rx / l; nz = rz / l; } else { nx = -B.fz; nz = B.fx; } }
  // where along A they touch: the middle of the stretch of A's axis within reach of B's (side by side: their overlap)
  let lo = s, hi = s;
  if (ccGap(A, B, -1) < reach) lo = -1; else { let u = -1; for (let k = 0; k < 8; k++) { const m = (u + lo) / 2; if (ccGap(A, B, m) < reach) lo = m; else u = m; } }
  if (ccGap(A, B, 1) < reach) hi = 1; else { let u = 1; for (let k = 0; k < 8; k++) { const m = (u + hi) / 2; if (ccGap(A, B, m) < reach) hi = m; else u = m; } }
  const sm = (lo + hi) / 2, pax = A.cx + ax * sm, paz = A.cz + az * sm, tm = ccOn(B, pax, paz), pbx = B.cx + bx * tm, pbz = B.cz + bz * tm;
  const cx = (pax - nx * A.r + pbx + nx * B.r) / 2, cz = (paz - nz * A.r + pbz + nz * B.r) / 2;
  const rax = cx - A.x, raz = cz - A.z, rbx = cx - B.x, rbz = cz - B.z, ims = A.im + B.im;
  const H = CC.hit; H.nx = nx; H.nz = nz; H.cx = cx; H.cz = cz; H.pen = reach - d; H.J = 0; H.Jt = 0;
  // out of the overlap, by the masses (a little at a time: the impulse below parts them)
  if (ims > 0) { const p = Math.min(Math.max(0, H.pen - 0.02) * 0.8, 0.25) / ims; A.dx = nx * p * A.im; A.dz = nz * p * A.im; B.dx = -nx * p * B.im; B.dz = -nz * p * B.im; }
  const vn = H.vn = -((A.vx + A.wy * raz - B.vx - B.wy * rbz) * nx + (A.vz - A.wy * rax - B.vz + B.wy * rbx) * nz);
  if (vn <= 0 || ims <= 0) return H;
  const rna = raz * nx - rax * nz, rnb = rbz * nx - rbx * nz;
  const kn = ims + rna * rna * A.iI + rnb * rnb * B.iI, J = H.J = (1 + lerp(CC_E[0], CC_E[1], sstep(1, 8, vn))) * vn / kn;
  ccPush(A, nx * J, nz * J, rax, raz); ccPush(B, -nx * J, -nz * J, rbx, rbz);
  // the scrape: what is left of their sliding along each other, slowed by friction
  const tx = -nz, tz = nx, vt = (A.vx + A.wy * raz - B.vx - B.wy * rbz) * tx + (A.vz - A.wy * rax - B.vz + B.wy * rbx) * tz;
  const rta = raz * tx - rax * tz, rtb = rbz * tx - rbx * tz;
  const Jt = H.Jt = clamp(-vt / (ims + rta * rta * A.iI + rtb * rtb * B.iI), -CC_MU * J, CC_MU * J);
  ccPush(A, tx * Jt, tz * Jt, rax, raz); ccPush(B, -tx * Jt, -tz * Jt, rbx, rbz);
  // the scrape's turn can close them again: no more than to stop that
  const v2 = -((A.vx + A.wy * raz - B.vx - B.wy * rbz) * nx + (A.vz - A.wy * rax - B.vz + B.wy * rbx) * nz);
  if (v2 > 0) { const J2 = v2 / kn; ccPush(A, nx * J2, nz * J2, rax, raz); ccPush(B, -nx * J2, -nz * J2, rbx, rbz); H.J += J2; }
  return H;
}
// an impulse (jx, jz) at r from a body's centre: its velocity and its yaw rate
function ccPush(o, jx, jz, rx, rz) { o.vx += jx * o.im; o.vz += jz * o.im; o.wy += (rz * jx - rx * jz) * o.iI; }
// our car as a body, and the solved one put back on it
const ccOurs = o => ccBody(o, car.pos.x, car.pos.z, fwd.x, fwd.z, CAR_HW, CAR_ZF, CAR_ZR, car.vel.x, car.vel.z, car.w.y, car.mass, car.I.y);
function ccOursBack(o) { car.vel.x = o.vx; car.vel.z = o.vz; car.w.y = o.wy; car.pos.x += o.dx; car.pos.z += o.dz; }
// our car struck at the contact H: its dents, the damage, the crash's sound and a note; the zone, or null if not hard enough
const ccQi = new THREE.Quaternion(), ccN = new THREE.Vector3(), ccPt = new THREE.Vector3();
function ccOurHit(H, who) {
  if (H.vn <= 1.5 || car.grace > 0) return null;
  ccQi.copy(car.q).invert(); ccN.set(H.nx, 0, H.nz).applyQuaternion(ccQi); ccPt.set(H.cx - car.pos.x, 0, H.cz - car.pos.z).applyQuaternion(ccQi); ccPt.y = 0.45;
  const zone = Math.abs(ccN.z) >= Math.abs(ccN.x) ? (ccN.z < 0 ? 'front' : 'rear') : (ccN.x < 0 ? 'left' : 'right');
  addDamage(zone, (H.vn - 1.5) ** 2 * 0.012); carHit(ccPt, ccN, H.vn, HIT.ball);
  audio?.node.port.postMessage({ crash: Math.min(1, H.vn * 0.1) });
  if (hitCooldown <= 0 && !car.wrecked) { hitCooldown = 0.6; flash(`Contact with ${who} · ${zone} damage ${Math.round(car.dmg[zone] * 100)}%`, '#ff9a6a', 1.8); }
  return zone;
}
const bV = new THREE.Vector3(), bN = new THREE.Vector3(), bQi = new THREE.Quaternion();
""")

# ---------- the bots: knocked across their line (lv, m/s) and turned off it (yo, rad; wy, rad/s) ----------
rep("""skill: BOT_SKILL[i] * (0.99 + Math.random() * 0.02),
      pos: new THREE.Vector3(), q: new THREE.Quaternion(), fx: 0, fz: 1, bump: 0,""",
    """skill: BOT_SKILL[i] * (0.99 + Math.random() * 0.02),
      pos: new THREE.Vector3(), q: new THREE.Quaternion(), fx: 0, fz: 1, hx: 0, hz: 1, lv: 0, yo: 0, wy: 0, bump: 0,""")
rep("""b.v = 0; b.bump = 0; b.y = 0; poseBot(b, Pt, 0, true); });""",
    """b.v = 0; b.bump = 0; b.y = 0; b.lv = b.yo = b.wy = 0; poseBot(b, Pt, 0, true); });""")
rep("""  b.yaw = Math.atan2(fx, fz);
""", """  b.yaw = Math.atan2(fx, fz) + b.yo; b.hx = Math.sin(b.yaw); b.hz = Math.cos(b.yaw);     // (yo: knocked off its line's heading)
""")
rep("""    b.lat += clamp(b.latT - b.lat, -(0.5 + b.v * 0.08) * dt, (0.5 + b.v * 0.08) * dt);
""", """    b.lat += clamp(b.latT - b.lat, -(0.5 + b.v * 0.08) * dt, (0.5 + b.v * 0.08) * dt);
    // knocked (#322): sliding across its line till the tires stop it, turned till it catches it
    if (b.lv || b.yo || b.wy) {
      b.lat = clamp(b.lat + b.lv * dt, -BOT_LW - 2, BOT_LW + 2); b.lv -= Math.sign(b.lv) * Math.min(Math.abs(b.lv), 7 * dt);
      b.wy += (-b.yo * 9 - b.wy * 5) * dt; b.yo = clamp(b.yo + b.wy * dt, -0.9, 0.9);
      if (Math.abs(b.lv) + Math.abs(b.yo) + Math.abs(b.wy) < 1e-3) b.lv = b.yo = b.wy = 0;
    }
""")
rep("""    // contact with the player's car: two circles per car
    const pf = fwd, hlP = Math.max(0.6, (CAR_ZF - CAR_ZR) / 2 - 0.9), hlB = Math.max(0.6, ROAD_CARS[b.V.key].L / 2 - 0.9), pc = (CAR_ZF + CAR_ZR) / 2, rr = Math.max(0.9, CAR_HW);
    let best = null;
    for (const sp of [-1, 1]) for (const sb of [-1, 1]) {
      const dx = car.pos.x + pf.x * (pc + sp * hlP) - (b.pos.x + b.fx * sb * hlB), dz = car.pos.z + pf.z * (pc + sp * hlP) - (b.pos.z + b.fz * sb * hlB), dd = Math.hypot(dx, dz);
      if (dd < rr * 2 - 0.15 && (!best || dd < best.dd)) best = { dd, dx, dz, sp, sb };
    }
    if (best && Math.abs(car.pos.y - b.pos.y) < 1.6 && !rp.on) {
      const nl = best.dd || 1e-3, nx = best.dx / nl, nz = best.dz / nl, pen = rr * 2 - 0.15 - best.dd;
      const vn = -((car.vel.x - b.fx * b.v) * nx + (car.vel.z - b.fz * b.v) * nz);
      car.pos.x += nx * pen * 0.7; car.pos.z += nz * pen * 0.7; b.lat = clamp(b.lat - (nx * -b.fz + nz * b.fx) * pen * 0.3, -BOT_LW - 1, BOT_LW + 1);
      if (vn > 0) {
        const mp = VEH.mass, mb = b.V.mass, j = vn * 1.25 * mb / (mp + mb);
        car.vel.x += nx * j; car.vel.z += nz * j;
        car.w.y += ((pf.x * (pc + best.sp * hlP)) * nz - (pf.z * (pc + best.sp * hlP)) * nx) * -j * 0.12;
        b.v = Math.max(0, b.v - (nx * b.fx + nz * b.fz) * -vn * 1.25 * mp / (mp + mb)); b.bump = 0.5;
        if (vn > 1.5 && car.grace <= 0) {
          bQi.copy(car.q).invert(); bN.set(nx, 0, nz).applyQuaternion(bQi); bV.set(-bN.x * CAR_HW, 0.45, pc + best.sp * hlP - bN.z * 0.9);
          const zone = Math.abs(bN.z) >= Math.abs(bN.x) ? (bN.z < 0 ? 'front' : 'rear') : (bN.x < 0 ? 'left' : 'right');
          addDamage(zone, (vn - 1.5) ** 2 * 0.012); carHit(bV, bN, vn, HIT.ball);
          // and the bot's: the same contact seen from its side (where our car met it, pushing into it)
          bQi.copy(b.q).invert();
          bV.set(b.pos.x + b.fx * best.sb * hlB + nx * rr, b.pos.y, b.pos.z + b.fz * best.sb * hlB + nz * rr).sub(b.pos).applyQuaternion(bQi); bV.y = 0.5;
          bN.set(-nx, 0, -nz).applyQuaternion(bQi);
          bodyHit(b.V, [rd2(bV.x), rd2(bV.y), rd2(bV.z), rd3(bN.x), rd3(bN.y), rd3(bN.z), rd2(vn), HIT.ball], v3.set(b.fx * b.v, 0, b.fz * b.v));
          audio?.node.port.postMessage({ crash: Math.min(1, vn * 0.1) });
          if (hitCooldown <= 0 && !car.wrecked) { hitCooldown = 0.6; flash(`Contact with the ${b.name} · ${zone} damage ${Math.round(car.dmg[zone] * 100)}%`, '#ff9a6a', 1.8); }
        }
      }
    }
""", """    // contact with our car (#322: ccSolve): the bot's push along its line goes to its speed, across it to lv, its turn to wy
    if (Math.abs(car.pos.y - b.pos.y) < 1.6 && !rp.on) {
      const S = b.V, npx = -b.fz, npz = b.fx, vx0 = b.fx * b.v + npx * b.lv, vz0 = b.fz * b.v + npz * b.lv;
      const A = ccOurs(CC.a), O = ccBody(CC.b, b.pos.x, b.pos.z, b.hx, b.hz, S.box[0], S.box[1], S.box[2], vx0, vz0, b.wy, S.mass, S.I.y), H = ccSolve(A, O);
      if (H) {
        ccOursBack(A);
        const dvx = O.vx - vx0, dvz = O.vz - vz0;
        b.v = Math.max(0, b.v + dvx * b.fx + dvz * b.fz); b.lv += dvx * npx + dvz * npz; b.wy = O.wy;
        b.s = ((b.s + O.dx * b.fx + O.dz * b.fz) % len + len) % len; b.lat = clamp(b.lat + O.dx * npx + O.dz * npz, -BOT_LW - 2, BOT_LW + 2);
        if (H.J > 0) b.bump = 0.5;
        if (ccOurHit(H, `the ${b.name}`)) {
          // and the bot's dent: the same contact seen from its side (pushing into it)
          bQi.copy(b.q).invert();
          bV.set(H.cx - b.pos.x, 0, H.cz - b.pos.z).applyQuaternion(bQi); bV.y = 0.5;
          bN.set(-H.nx, 0, -H.nz).applyQuaternion(bQi);
          bodyHit(b.V, [rd2(bV.x), rd2(bV.y), rd2(bV.z), rd3(bN.x), rd3(bN.y), rd3(bN.z), rd2(H.vn), HIT.ball], v3.set(O.vx, 0, O.vz));
        }
      }
    }
""")

open(ep, 'w').write(s)
print('contacts: ok')
