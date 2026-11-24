// Circuit generator (#315): a closed course for the sim from a seed, a length and a style, the same
// circuit for the same three every time, in the browser (the course editor's GENERATE, loaded on
// demand by engine.js) and in node (scripts/maps/generate.mjs). No dependencies: plain numbers in,
// the course's waypoints out ([x, z], as COURSE.wp).
//
// How: the outline of a random blob of cells. A grid of cells (about 2.3 to 4.5 times the min. corner
// radius on a side, turned by a random angle, only the cells inside the world) grows a blob a cell at
// a time, never with a hole or two cells touching by a corner only, so its outline is one closed line
// that never touches itself; fingers of the blob are hairpins, its sides straights. The outline is
// bent by a gentle warp of the plane (a smooth one: neighbouring corners move together, so the
// hairpins keep their width), every corner rounded with an arc of at least the min. radius (as wide
// as its legs leave room for), and the result laid out as waypoints that the sim's Catmull-Rom
// curve follows. Then it is checked on that very curve (a centripetal Catmull-Rom, as THREE's): no
// corner under the min. radius (measured over ±8 m and rounded, as the editor does), no two parts of the road
// closer than SEP m, everything inside the world. Up to TRIES blobs a seed; the first one within
// 6 % of the length asked wins, or else the nearest that passed.

export const CIRCUIT_STYLES = {
  // cell: side of a cell / min. radius; radius: a corner's radius / min. radius (as wide as the room
  // allows); branch: how much the blob prefers to grow fingers (+) over filling in (−); warp: the
  // plane's bend, as a share of a cell
  flowing: { label: 'Flowing', cell: [3.4, 4.6], radius: [1.6, 3.2], branch: [-0.6, 0.8], warp: 0.32, finger: 0.5, cut: 0.5 },
  mixed: { label: 'Mixed', cell: [2.7, 3.5], radius: [1.1, 2.2], branch: [0.2, 1.4], warp: 0.26, finger: 0.85, cut: 0.35 },
  twisty: { label: 'Twisty', cell: [2.2, 2.65], radius: [1.05, 1.35], branch: [0.9, 2.4], warp: 0.2, finger: 1, cut: 0.15 },
};
export const CIRCUIT_LIMITS = { kmMin: 0.5, kmMax: 3.5, rMin: 10, rMax: 60 };
const HALF = 162;            // the lattice stays inside ±HALF m; the warp may take the road a few m further
const EDGE = 168;            // the sim's (and the maps') last waypoint position: ±168 m
const SEP = 28;              // the least distance between two parts of the road that aren't the same stretch (less with
                             // tighter corners: 1.85 min. radii, at least 22 m: a 12 m road and a gap)
const TRIES = 360;

// a seed (a number, or any string) as 32 bits
export function seedHash(seed) {
  const s = String(seed ?? '').trim();
  if (/^\d{1,9}$/.test(s)) return +s >>> 0;
  let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const TAU = Math.PI * 2;

/**
 * A circuit: { wp, len, tightest, sep, corners, straight, seed, km, style, rMin, tries, exact }.
 * len (m) and tightest (m) are measured on the sim's curve; exact: within 6 % of the length asked.
 * null only if no blob at all passed (not seen in practice: a short one always fits).
 */
export function generateCircuit({ seed = 1, km = 1.6, style = 'mixed', rMin = 25 } = {}) {
  const S = CIRCUIT_STYLES[style] || CIRCUIT_STYLES.mixed;
  km = clamp(+km || 1.6, CIRCUIT_LIMITS.kmMin, CIRCUIT_LIMITS.kmMax); rMin = clamp(+rMin || 25, CIRCUIT_LIMITS.rMin, CIRCUIT_LIMITS.rMax);
  const target = km * 1000, h0 = seedHash(seed);
  let best = null;
  for (let a = 0; a < TRIES; a++) {
    const r = attempt(mulberry32((h0 ^ Math.imul(a + 1, 0x9E3779B1)) >>> 0), S, target, rMin);
    if (!r) continue;
    r.err = Math.abs(r.len - target) / target;
    if (!best || r.err < best.err) best = r;
    if (r.err <= 0.06) break;
  }
  // nothing passed: asked far more than fits (the blobs with the most outline don't round), a shorter one; at the
  // shortest, the world too small for such cells at this radius: the twisty style's smaller cells
  if (!best) {
    const t = km > CIRCUIT_LIMITS.kmMin ? generateCircuit({ seed, km: Math.max(CIRCUIT_LIMITS.kmMin, km * 0.8), style, rMin })
      : S !== CIRCUIT_STYLES.twisty ? generateCircuit({ seed, km, style: 'twisty', rMin }) : null;
    return t ? { ...t, km, style: CIRCUIT_STYLES[style] ? style : 'mixed', exact: false } : null;
  }
  return { wp: best.wp, len: best.len, tightest: best.tightest, sep: best.sep, corners: best.corners, straight: best.straight,
    seed: String(seed), km, style: CIRCUIT_STYLES[style] ? style : 'mixed', rMin, exact: best.err <= 0.06 };
}

// one blob: grown until its rounded outline is about as long as asked, then laid out and checked
function attempt(rnd, S, target, rMin) {
  const U = (a, b) => a + (b - a) * rnd();
  const c = clamp(rMin * U(S.cell[0], S.cell[1]), rMin * 2.05, HALF * 0.9), asp = U(0.85, 1.18), cx = c * asp, cz = c / asp;
  const ang = rnd() < 0.6 ? (rnd() - 0.5) * 0.42 : rnd() * Math.PI / 2, ca = Math.cos(ang), sa = Math.sin(ang);
  // the grid, turned by ang about the middle of the world, big enough to cover it; a cell is usable when its four corners are inside
  const reach = HALF * Math.SQRT2, nx = Math.ceil(2 * reach / cx), nz = Math.ceil(2 * reach / cz), x0 = -nx * cx / 2, z0 = -nz * cz / 2;
  const lat = (i, j) => { const u = x0 + i * cx, v = z0 + j * cz; return [u * ca - v * sa, u * sa + v * ca]; };
  const inW = ([x, z]) => Math.abs(x) <= HALF && Math.abs(z) <= HALF;
  const ok = new Uint8Array(nx * nz);
  let nOk = 0;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) if (inW(lat(i, j)) && inW(lat(i + 1, j)) && inW(lat(i, j + 1)) && inW(lat(i + 1, j + 1))) { ok[j * nx + i] = 1; nOk++; }
  if (nOk < 4) return null;
  const inR = new Uint8Array(nx * nz), at = (i, j) => i >= 0 && j >= 0 && i < nx && j < nz && inR[j * nx + i] === 1;
  const branch = U(S.branch[0], S.branch[1]);
  // the first cell: a random usable one, nearer the middle more likely
  const okList = []; for (let k = 0; k < nx * nz; k++) if (ok[k]) okList.push(k);
  let k0 = okList[Math.floor(rnd() * okList.length)];
  { const k1 = okList[Math.floor(rnd() * okList.length)], d = k => { const [x, z] = lat((k % nx) + 0.5, Math.floor(k / nx) + 0.5); return x * x + z * z; }; if (d(k1) < d(k0)) k0 = k1; }
  inR[k0] = 1;
  let perim = 4, cells = 1, warp = null, most = { perim: 4, inR: inR.slice() };
  for (let step = 0; step < nOk; step++) {
    // rounded length once the raw outline is long enough to be near it
    if (perim * c >= target * 0.98) {
      warp ||= makeWarp(rnd, c, S.warp);
      const lay = layout(trace(inR, nx, nz), lat, warp, rnd, S, rMin, c, false);
      if (lay && lay.len >= target * 0.97) { most = null; break; }
    }
    // the cells that can join: next to the blob, usable, no corner-only contact, no hole; when the cells
    // left are few for the length still to come, only those that add outline (a finger's next cell) if any
    const need = target * 1.15 / c - perim, room = nOk - cells, tight = need > room * 0.8 && rnd() < S.finger;
    const cand = [], wts = [], sha = [];
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i; if (inR[k] || !ok[k]) continue;
      const sh = at(i - 1, j) + at(i + 1, j) + at(i, j - 1) + at(i, j + 1); if (!sh) continue;
      if (pinch(at, i, j)) continue;
      if (closes(at, i, j)) continue;
      cand.push(k); sha.push(sh); wts.push(Math.exp(-branch * (sh - 1)) * (0.25 + rnd()));
    }
    if (!cand.length) break;
    if (tight && sha.includes(1)) for (let q = 0; q < cand.length; q++) if (sha[q] > 1) wts[q] = 0;
    let t = rnd() * wts.reduce((s, w) => s + w, 0), pick = cand[cand.length - 1];
    for (let q = 0; q < cand.length; q++) { t -= wts[q]; if (t <= 0) { pick = cand[q]; break; } }
    const pi = pick % nx, pj = Math.floor(pick / nx), sh = at(pi - 1, pj) + at(pi + 1, pj) + at(pi, pj - 1) + at(pi, pj + 1);
    inR[pick] = 1; cells++; perim += 4 - 2 * sh;
    if (most && perim > most.perim) most = { perim, inR: inR.slice() };
  }
  // the blob ran out of room before the length: the one with the most outline on the way
  if (most) { if (most.perim < 8) return null; inR.set(most.inR); }
  warp ||= makeWarp(rnd, c, S.warp);
  // the final layout uses its own random draws (radii, start, direction) after the blob's: replayable from the seed
  return layout(trace(inR, nx, nz), lat, warp, rnd, S, rMin, c, true);
}

// two cells of the blob touching by a corner only (the outline would touch itself there), with (i, j) added
function pinch(at, i, j) {
  for (const [di, dj] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) if (at(i + di, j + dj) && !at(i + di, j) && !at(i, j + dj)) return true;
  return false;
}
// (i, j) joining the blob in two places (two runs of blob cells in the ring of its 8 neighbours): it would close a
// loop around some outside cells, a hole. Local, as the blob is one piece without holes or corner-only contacts.
const RING = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
function closes(at, i, j) {
  let runs = 0;
  for (let q = 0; q < 8; q++) if (at(i + RING[q][0], j + RING[q][1]) && !at(i + RING[(q + 7) % 8][0], j + RING[(q + 7) % 8][1])) runs++;
  return runs > 1;
}
// the blob's outline: lattice corners [i, j] in order, counter-clockwise, only where it turns
function trace(inR, nx, nz) {
  const at = (i, j) => i >= 0 && j >= 0 && i < nx && j < nz && inR[j * nx + i] === 1;
  const V = nx + 1, next = new Map();
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    if (!at(i, j)) continue;
    if (!at(i, j - 1)) next.set(j * V + i, j * V + i + 1);
    if (!at(i + 1, j)) next.set(j * V + i + 1, (j + 1) * V + i + 1);
    if (!at(i, j + 1)) next.set((j + 1) * V + i + 1, (j + 1) * V + i);
    if (!at(i - 1, j)) next.set((j + 1) * V + i, j * V + i);
  }
  const k0 = Math.min(...next.keys()), loop = [];
  let k = k0; do { loop.push([k % V, Math.floor(k / V)]); k = next.get(k); } while (k !== k0 && loop.length <= next.size);
  const n = loop.length, out = [];
  for (let q = 0; q < n; q++) {
    const a = loop[(q - 1 + n) % n], b = loop[q], d = loop[(q + 1) % n];
    if ((b[0] - a[0]) * (d[1] - b[1]) - (b[1] - a[1]) * (d[0] - b[0]) !== 0) out.push(b);
  }
  return out;
}
// a smooth bend of the plane: three waves each way, wavelengths of 3 to 7 cells, together up to `share` of a cell,
// and a long one (8 to 12 cells) twice as high
function makeWarp(rnd, c, share) {
  const waves = [];
  for (let q = 0; q < 4; q++) for (const ax of [0, 1]) {
    const lam = c * (q ? 3 + 4 * rnd() : 8 + 4 * rnd()), th = rnd() * TAU;
    waves.push({ ax, a: c * share * (0.5 + 0.5 * rnd()) / 3 * (q ? 1 : 2.2), kx: Math.cos(th) * TAU / lam, kz: Math.sin(th) * TAU / lam, ph: rnd() * TAU });
  }
  return ([x, z]) => { let dx = 0, dz = 0; for (const w of waves) { const s = w.a * Math.sin(w.kx * x + w.kz * z + w.ph); if (w.ax) dz += s; else dx += s; } return [x + dx, z + dz]; };
}

// The outline's corners in the world, rounded, as waypoints; checked on the sim's curve when full
function layout(corners, lat, warp, rnd, S, rMin, c, full) {
  let Q = corners.map(([i, j]) => warp(lat(i, j)));
  // some corners between two long legs cut across (two half turns: the blob's right angles less square),
  // and every corner nudged a little on its own (no two straights quite parallel)
  const cut = [];
  for (let i = 0, n = Q.length; i < n; i++) {
    const a = Q[(i - 1 + n) % n], b = Q[i], d = Q[(i + 1) % n], la = Math.hypot(b[0] - a[0], b[1] - a[1]), lb = Math.hypot(d[0] - b[0], d[1] - b[1]);
    if (Math.min(la, lb) > 1.8 * c && rnd() < S.cut) {
      const k = (0.22 + 0.25 * rnd()) * Math.min(la, lb);
      cut.push([b[0] + (a[0] - b[0]) * k / la, b[1] + (a[1] - b[1]) * k / la], [b[0] + (d[0] - b[0]) * k / lb, b[1] + (d[1] - b[1]) * k / lb]);
    } else cut.push(b);
  }
  Q = cut.map(([x, z]) => [x + (rnd() - 0.5) * 0.2 * c, z + (rnd() - 0.5) * 0.2 * c]);
  const m = Q.length; if (m < 3) return null;
  // each corner's turn and the radius it wants; the tangent lengths shared out along each leg
  const leg = [], phi = [], t = [], tn = [];
  for (let i = 0; i < m; i++) leg.push(Math.hypot(Q[(i + 1) % m][0] - Q[i][0], Q[(i + 1) % m][1] - Q[i][1]));
  for (let i = 0; i < m; i++) {
    const a = Q[(i - 1 + m) % m], b = Q[i], d = Q[(i + 1) % m];
    const a1 = Math.atan2(b[1] - a[1], b[0] - a[0]), a2 = Math.atan2(d[1] - b[1], d[0] - b[0]);
    let f = a2 - a1; while (f > Math.PI) f -= TAU; while (f < -Math.PI) f += TAU;
    phi.push(f); tn.push(Math.tan(Math.abs(f) / 2));
    t.push(rMin * (S.radius[0] + (S.radius[1] - S.radius[0]) * rnd()) * tn[i]);
  }
  for (let it = 0; it < 12; it++) for (let i = 0; i < m; i++) {
    const j = (i + 1) % m, s = t[i] + t[j];
    if (s > leg[i]) { const k = leg[i] / s; t[i] *= k; t[j] *= k; }
  }
  let rLow = Infinity;
  for (let i = 0; i < m; i++) if (Math.abs(phi[i]) > 0.05) rLow = Math.min(rLow, t[i] / tn[i]);
  if (rLow < rMin * 1.01) return null;
  // the rounded line: per corner, its arc (from the tangent point on the leg in to the one on the leg out)
  const unit = (p, q) => { const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1; return [(q[0] - p[0]) / L, (q[1] - p[1]) / L]; };
  const arcs = [];
  for (let i = 0; i < m; i++) {
    const b = Q[i], ui = unit(Q[(i - 1 + m) % m], b), uo = unit(b, Q[(i + 1) % m]);
    const pin = [b[0] - ui[0] * t[i], b[1] - ui[1] * t[i]], pout = [b[0] + uo[0] * t[i], b[1] + uo[1] * t[i]];
    const r = Math.abs(phi[i]) > 1e-6 ? t[i] / tn[i] : Infinity, sg = Math.sign(phi[i]);
    arcs.push({ pin, pout, r, f: phi[i], ctr: r < Infinity ? [pin[0] - ui[1] * r * sg, pin[1] + ui[0] * r * sg] : null });
  }
  let len = 0; for (let i = 0; i < m; i++) { const A = arcs[i], B = arcs[(i + 1) % m]; len += Math.hypot(B.pin[0] - A.pout[0], B.pin[1] - A.pout[1]) + (A.r < Infinity ? A.r * Math.abs(A.f) : 0); }
  if (!full) return { len };
  // the start: 30 % along the longest straight, the course run either way round
  let ls = 0, li = 0; for (let i = 0; i < m; i++) { const A = arcs[i], B = arcs[(i + 1) % m], d = Math.hypot(B.pin[0] - A.pout[0], B.pin[1] - A.pout[1]); if (d > ls) { ls = d; li = i; } }
  const rev = rnd() < 0.5;
  // waypoints: along each straight at most 30 m apart, along each arc every ~0.45 r (6 to 14 m)
  const wp = [];
  const push = p => { const q = [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10], l = wp[wp.length - 1]; if (!l || Math.hypot(q[0] - l[0], q[1] - l[1]) > 2) wp.push(q); };
  for (let s = 0; s < m; s++) {
    const i = (li + s) % m, A = arcs[i], B = arcs[(i + 1) % m];
    const d = Math.hypot(B.pin[0] - A.pout[0], B.pin[1] - A.pout[1]), f0 = s === 0 ? 0.3 : 0, k = Math.max(1, Math.ceil(d * (1 - f0) / 30));
    for (let q = 0; q < k; q++) { const f = f0 + (1 - f0) * q / k; push([A.pout[0] + (B.pin[0] - A.pout[0]) * f, A.pout[1] + (B.pin[1] - A.pout[1]) * f]); }
    if (B.r < Infinity) {
      const al = B.r * Math.abs(B.f), na = Math.max(2, Math.ceil(al / clamp(B.r * 0.45, 6, 14)));
      const a0 = Math.atan2(B.pin[1] - B.ctr[1], B.pin[0] - B.ctr[0]);
      for (let q = 0; q < na; q++) { const a = a0 + B.f * q / na; push([B.ctr[0] + Math.cos(a) * B.r, B.ctr[1] + Math.sin(a) * B.r]); }
    }
    if (s === m - 1) { const f = 0.3, k2 = Math.max(1, Math.ceil(ls * f / 30)); for (let q = 0; q < k2; q++) { const g = f * q / k2; const C = arcs[li], D = arcs[(li + 1) % m]; push([C.pout[0] + (D.pin[0] - C.pout[0]) * g, C.pout[1] + (D.pin[1] - C.pout[1]) * g]); } }
  }
  // the loop closes on wp[0]: drop a last point on top of it
  while (wp.length > 3 && Math.hypot(wp[wp.length - 1][0] - wp[0][0], wp[wp.length - 1][1] - wp[0][1]) < 2) wp.pop();
  if (rev) { const w0 = wp[0]; wp.reverse(); wp.pop(); wp.unshift(w0); }
  if (wp.length < 4 || wp.length > 400) return null;
  if (wp.some(([x, z]) => Math.abs(x) > EDGE || Math.abs(z) > EDGE)) return null;
  // the check, on the curve the sim builds through these waypoints
  const P = curvePoints(wp, 2), n = P.length, ds = P.len / n;
  if (P.some(([x, z]) => Math.abs(x) > EDGE + 4 || Math.abs(z) > EDGE + 4)) return null;
  const tight = tightest(P, ds); if (tight < rMin - 0.25) return null;    // as the editor shows it (rounded, its curve sampled a little differently): not under the min.
  const sepMin = clamp(1.85 * rMin, 22, SEP), sep = separation(P, ds, sepMin); if (sep < sepMin) return null;
  let straight = 0; for (let i = 0; i < m; i++) straight = Math.max(straight, Math.hypot(arcs[(i + 1) % m].pin[0] - arcs[i].pout[0], arcs[(i + 1) % m].pin[1] - arcs[i].pout[1]));
  return { wp, len: P.len, tightest: tight, sep, corners: phi.filter(f => Math.abs(f) > 0.35).length, straight };
}

// The closed centripetal Catmull-Rom through the waypoints (THREE.CatmullRomCurve3(…, true, 'centripetal')),
// as points every ~ds m along it (P.len: its length)
export function curvePoints(wp, ds = 2) {
  const m = wp.length, dense = [];
  for (let i = 0; i < m; i++) {
    const p0 = wp[(i - 1 + m) % m], p1 = wp[i], p2 = wp[(i + 1) % m], p3 = wp[(i + 2) % m];
    const d = (a, b) => Math.max(Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])), 1e-4);
    let dt0 = d(p0, p1), dt1 = d(p1, p2), dt2 = d(p2, p3);
    if (dt1 < 1e-4) dt1 = 1.0; if (dt0 < 1e-4) dt0 = dt1; if (dt2 < 1e-4) dt2 = dt1;
    const co = (x0, x1, x2, x3) => {
      let t1 = (x1 - x0) / dt0 - (x2 - x0) / (dt0 + dt1) + (x2 - x1) / dt1, t2 = (x2 - x1) / dt1 - (x3 - x1) / (dt1 + dt2) + (x3 - x2) / dt2;
      t1 *= dt1; t2 *= dt1;
      return [x1, t1, -3 * x1 + 3 * x2 - 2 * t1 - t2, 2 * x1 - 2 * x2 + t1 + t2];
    };
    const cX = co(p0[0], p1[0], p2[0], p3[0]), cZ = co(p0[1], p1[1], p2[1], p3[1]);
    const seg = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), k = Math.max(8, Math.ceil(seg / 0.5));
    for (let q = 0; q < k; q++) { const u = q / k, u2 = u * u, u3 = u2 * u; dense.push([cX[0] + cX[1] * u + cX[2] * u2 + cX[3] * u3, cZ[0] + cZ[1] * u + cZ[2] * u2 + cZ[3] * u3]); }
  }
  const N = dense.length, cum = [0];
  for (let i = 0; i < N; i++) cum.push(cum[i] + Math.hypot(dense[(i + 1) % N][0] - dense[i][0], dense[(i + 1) % N][1] - dense[i][1]));
  const L = cum[N], n = Math.max(40, Math.round(L / ds)), out = [];
  let j = 0;
  for (let q = 0; q < n; q++) {
    const s = q * L / n; while (cum[j + 1] < s) j++;
    const a = dense[j], b = dense[(j + 1) % N], f = (s - cum[j]) / ((cum[j + 1] - cum[j]) || 1);
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  out.len = L;
  return out;
}
// radius of the circle through three points
const circR = (a, b, c) => {
  const abx = b[0] - a[0], abz = b[1] - a[1], bcx = c[0] - b[0], bcz = c[1] - b[1], cax = a[0] - c[0], caz = a[1] - c[1];
  const cr = Math.abs(abx * bcz - abz * bcx); return cr < 1e-9 ? Infinity : Math.hypot(abx, abz) * Math.hypot(bcx, bcz) * Math.hypot(cax, caz) / (2 * cr);
};
// the tightest corner, over ±8 m (the editor's measure)
export function tightest(P, ds) {
  const n = P.length, h = Math.max(1, Math.round(8 / ds)); let r = Infinity;
  for (let i = 0; i < n; i++) r = Math.min(r, circR(P[(i - h + n) % n], P[i], P[(i + h) % n]));
  return r;
}
// the least distance (up to B: farther is Infinity) between two points of the road more than 3 B apart along it (a bucket grid)
export function separation(P, ds, B = SEP) {
  const n = P.length, grid = new Map(), key = (a, b) => a * 4099 + b, skip = Math.ceil(3 * B / ds);
  P.forEach(([x, z], i) => { const k = key(Math.floor(x / B), Math.floor(z / B)); (grid.get(k) || grid.set(k, []).get(k)).push(i); });
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const [x, z] = P[i], gx = Math.floor(x / B), gz = Math.floor(z / B);
    for (let a = gx - 1; a <= gx + 1; a++) for (let b = gz - 1; b <= gz + 1; b++) for (const j of grid.get(key(a, b)) || []) {
      if (j <= i) continue; const di = Math.min(j - i, n - (j - i)); if (di < skip) continue;
      best = Math.min(best, Math.hypot(P[j][0] - x, P[j][1] - z));
    }
  }
  return best;
}
