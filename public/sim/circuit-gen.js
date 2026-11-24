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
//
// Bridges (#326): with 1 to 3 asked, the blob's outline is twisted across that many of its necks (a stretch of the
// blob one cell wide: a finger, or a waist between two parts): its two sides are cut there and joined crosswise
// (a 2-opt), so the road crosses itself in the neck and the part beyond it is run the other way round. The sim puts
// a bridge on every crossing (one branch over the other); the circuit is kept only if each one would get its bridge
// there: crossing at 55° or more, the bridges and their ramps apart along the road as the sim wants them, the
// start well away. 0: no crossing at all, the circuits as before.

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
export const BRIDGES_MAX = 3;
const X_SIN = Math.sin(55 * Math.PI / 180);   // the least crossing angle for a bridge
const RAMP = 40;                              // the sim's bridge ramps (engine.js: RAMP)

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

// how many bridges: 0 to 3, or 'random' (drawn from the seed: the same seed, the same number)
export function bridgesOf(bridges, seed) {
  if (bridges === 'random') return Math.floor(mulberry32((seedHash(seed) ^ 0xB71D6E5) >>> 0)() * (BRIDGES_MAX + 1));
  return clamp(Math.round(+bridges) || 0, 0, BRIDGES_MAX);
}

/**
 * A circuit: { wp, len, tightest, sep, corners, straight, seed, km, style, rMin, bridges, bridgesAsked, exact }.
 * len (m) and tightest (m) are measured on the sim's curve; exact: within 6 % of the length asked. bridges: how many it
 * has (crossings the sim bridges), fewer than bridgesAsked (a number: 'random' drawn) only when that many don't fit.
 * null only if no blob at all passed (not seen in practice: a short one always fits).
 */
export function generateCircuit({ seed = 1, km = 1.6, style = 'mixed', rMin = 25, bridges = 0 } = {}) {
  const S = CIRCUIT_STYLES[style] || CIRCUIT_STYLES.mixed;
  km = clamp(+km || 1.6, CIRCUIT_LIMITS.kmMin, CIRCUIT_LIMITS.kmMax); rMin = clamp(+rMin || 25, CIRCUIT_LIMITS.rMin, CIRCUIT_LIMITS.rMax);
  const target = km * 1000, h0 = seedHash(seed), asked = bridgesOf(bridges, seed);
  const pack = (b, n) => ({ wp: b.wp, len: b.len, tightest: b.tightest, sep: b.sep, corners: b.corners, straight: b.straight,
    seed: String(seed), km, style: CIRCUIT_STYLES[style] ? style : 'mixed', rMin, bridges: n, bridgesAsked: asked, exact: b.err <= 0.06 });
  // with bridges: as many as asked if a circuit of about the length fits them (or about as long as one without fits:
  // asked more than the world holds), or else fewer
  let best = null;
  for (let n = asked; n > 0; n--) {
    const b = search(h0, S, target, rMin, n);
    if (b && (b.err <= 0.15 || b.len < target && b.len >= (best ||= search(h0, S, target, rMin, 0) || { len: Infinity }).len * 0.9)) return pack(b, n);
  }
  if (!best || best.len === Infinity) best = search(h0, S, target, rMin, 0);
  // nothing passed: asked far more than fits (the blobs with the most outline don't round), a shorter one; at the
  // shortest, the world too small for such cells at this radius: the twisty style's smaller cells
  if (!best) {
    const t = km > CIRCUIT_LIMITS.kmMin ? generateCircuit({ seed, km: Math.max(CIRCUIT_LIMITS.kmMin, km * 0.8), style, rMin })
      : S !== CIRCUIT_STYLES.twisty ? generateCircuit({ seed, km, style: 'twisty', rMin }) : null;
    return t ? { ...t, km, style: CIRCUIT_STYLES[style] ? style : 'mixed', bridgesAsked: asked, exact: false } : null;
  }
  return pack(best, 0);
}
// up to TRIES blobs with `want` bridges: the first within 6 % of the length, or else the nearest
function search(h0, S, target, rMin, want) {
  let best = null;
  for (let a = 0; a < TRIES; a++) {
    const h = (h0 ^ Math.imul(a + 1, 0x9E3779B1) ^ Math.imul(want, 0x85EBCA6B)) >>> 0;
    const r = attempt(mulberry32(h), S, target, rMin, want);
    if (!r) continue;
    r.err = Math.abs(r.len - target) / target;
    if (!best || r.err < best.err) best = r;
    if (r.err <= 0.06) break;
  }
  return best;
}

// one blob: grown until its rounded outline is about as long as asked, then laid out and checked
function attempt(rnd, S, target, rMin, want = 0) {
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
    if ((perim + want) * c >= target * 0.98) {
      warp ||= makeWarp(rnd, c, S.warp);
      // with bridges: the outline as twisted (each twist adds about a cell's length); not before it has necks enough
      const lp = trace(inR, nx, nz), tw = want ? twist(lp, want, rnd, rMin / c) : null;
      const lay = !want || tw ? layout(tw ? tw.loop : lp, lat, warp, rnd, S, rMin, c, false) : null;
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
      // bridges: a finger grown straight on (the cell beyond its one neighbour in the blob too) makes a neck
      const on = want && sh === 1 && (at(i - 1, j) && at(i - 2, j) || at(i + 1, j) && at(i + 2, j) || at(i, j - 1) && at(i, j - 2) || at(i, j + 1) && at(i, j + 2));
      cand.push(k); sha.push(sh); wts.push(Math.exp(-branch * (sh - 1)) * (0.25 + rnd()) * (on ? 30 : 1));
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
  const lp = trace(inR, nx, nz);
  if (!want) return layout(lp, lat, warp, rnd, S, rMin, c, true);
  const tw = twist(lp, want, rnd, rMin / c); if (!tw) return null;
  return layout(tw.loop, lat, warp, rnd, S, rMin, c, true, tw.X.map(p => warp(lat(p[0], p[1]))));
}

// The outline twisted across `want` necks of the blob: a leg of the outline and the opposite one a cell away (the blob's
// cells between them: a stretch one cell wide; or none: a slot one cell wide between two arms of it, the crossing then
// outside the blob, as good), long enough for a crossing with room left for the corners at
// both ends (1.6 min. radii: a corner's arc and the cut's), each side cut over a length L (0.55 to 1 cell: the crossing
// at 58° to 90°) and the four ends joined crosswise. Where the outline turns away from the neck at its end (a finger's
// base, both ends of a waist) no room is needed: the cut ends right on that corner (the corner becomes the cut's, a gentler
// turn), so a waist one cell long does. rc: the min. radius in cells.
// { loop: the corners (lattice units, fractions where cut), X: the crossings' centres } or null: too few necks.
const NECK_L = [0.55, 1];
function twist(loop, want, rnd, rc) {
  const NECK_M = Math.max(0.4, 1.6 * rc);
  const n = loop.length, legs = [];
  for (let k = 0; k < n; k++) {
    const a = loop[k], b = loop[(k + 1) % n], h = a[1] === b[1];                 // along i (h) or along j
    legs.push({ k, h, f: h ? a[1] : a[0], s0: h ? a[0] : a[1], s1: h ? b[0] : b[1] });
  }
  // an end of the overlap: 'free' (no corner of either leg there), 'snap' (the legs ending there turn away from the
  // neck) or 'margin' (one turns towards the other leg: a finger's top, a slot's bottom)
  const side = (leg, other, sEnd) => {
    const nb = sEnd === leg.s0 ? loop[(leg.k - 1 + n) % n] : loop[(leg.k + 2) % n], f = leg.h ? nb[1] : nb[0];
    return Math.sign(f - leg.f) === Math.sign(other.f - leg.f) ? 'margin' : 'snap';
  };
  const endKind = (p, q, sE) => {
    const ks = [[p, q], [q, p]].filter(([l]) => l.s0 === sE || l.s1 === sE).map(([l, o]) => side(l, o, sE));
    return !ks.length ? 'free' : ks.includes('margin') ? 'margin' : 'snap';
  };
  const necks = [];
  for (const p of legs) for (const q of legs) {
    if (p.k >= q.k || p.h !== q.h || q.f !== p.f + 1 && q.f !== p.f - 1) continue;
    const dp = Math.sign(p.s1 - p.s0), dq = Math.sign(q.s1 - q.s0); if (dp === dq) continue;
    const lo = Math.max(Math.min(p.s0, p.s1), Math.min(q.s0, q.s1)), hi = Math.min(Math.max(p.s0, p.s1), Math.max(q.s0, q.s1));
    const kLo = endKind(p, q, lo), kHi = endKind(p, q, hi);
    const a = lo + (kLo === 'margin' ? NECK_M : 0), b = hi - (kHi === 'margin' ? NECK_M : 0);
    if (b - a < NECK_L[0]) continue;
    necks.push({ p, q, a, b, kLo, kHi, dp });
  }
  if (necks.length < want) return null;
  // the necks: picked at random, their crossings at least 1.5 cells apart (along the road: bridgesFit)
  const picked = [], pool = necks.slice();
  while (picked.length < want && pool.length) {
    const N = pool.splice(Math.floor(rnd() * pool.length), 1)[0], room = N.b - N.a;
    // the cut [x0, x0 + L]: on a 'snap' end exactly, or NECK_M or more from it
    let L = NECK_L[0] + (Math.min(NECK_L[1], room) - NECK_L[0]) * rnd(), x0;
    const sLo = N.kLo === 'snap', sHi = N.kHi === 'snap';
    if (sLo && sHi && room <= NECK_L[1]) { x0 = N.a; L = room; }
    else if (sLo && (!sHi || rnd() < 0.5)) { x0 = N.a; if (sHi && N.b - (x0 + L) < NECK_M) L = N.b - NECK_M - x0; }
    else if (sHi) { x0 = N.b - L; if (sLo && x0 - N.a < NECK_M) { L = N.b - N.a - NECK_M; x0 = N.b - L; } }
    else x0 = N.a + (room - L) * rnd();
    if (L < NECK_L[0] - 1e-9) continue;
    const sc = x0 + L / 2;
    const mid = (N.p.f + N.q.f) / 2, ctr = N.p.h ? [sc, mid] : [mid, sc];
    if (picked.some(o => Math.hypot(o.ctr[0] - ctr[0], o.ctr[1] - ctr[1]) < 1.5)) continue;
    picked.push({ ...N, L, sc, ctr });
  }
  if (picked.length < want) return null;
  // the cut points on their legs (A, B on p in its direction; C, D on q in its), then the loop with them in order
  const pt = (leg, s) => leg.h ? [s, leg.f] : [leg.f, s];
  const cuts = new Map();                                                           // leg k → [{ s, id }]
  const put = (leg, s, id) => { (cuts.get(leg.k) || cuts.set(leg.k, []).get(leg.k)).push({ s, id }); };
  picked.forEach((N, x) => {
    const sA = N.sc - N.dp * N.L / 2, sB = N.sc + N.dp * N.L / 2;
    put(N.p, sA, `A${x}`); put(N.p, sB, `B${x}`); put(N.q, sB, `C${x}`); put(N.q, sA, `D${x}`);
  });
  // (a cut on a corner: that corner is the cut point)
  const tag = new Map();
  for (const [k, c] of cuts) for (const u of c) {
    const leg = legs[k];
    if (Math.abs(u.s - leg.s0) < 1e-9) { if (tag.has(k)) return null; tag.set(k, u.id); u.on = true; }
    else if (Math.abs(u.s - leg.s1) < 1e-9) { const k1 = (k + 1) % n; if (tag.has(k1)) return null; tag.set(k1, u.id); u.on = true; }
  }
  let L = [], id = [];
  for (let k = 0; k < n; k++) {
    L.push(loop[k]); id.push(tag.get(k) ?? null);
    const leg = legs[k], c = (cuts.get(k) || []).filter(u => !u.on).sort((u, v) => (u.s - v.s) * Math.sign(leg.s1 - leg.s0));
    for (const u of c) { L.push(pt(leg, u.s)); id.push(u.id); }
  }
  // each twist: edges A–B and C–D replaced by A–C and B–D (the loop between reversed: still one loop)
  for (let x = 0; x < picked.length; x++) {
    const m = L.length, ix = t => id.indexOf(t + x);
    const first = (u, v) => ((ix(v) - ix(u) + m) % m === 1 ? ix(u) : (ix(u) - ix(v) + m) % m === 1 ? ix(v) : -1);
    const i = first('A', 'B'), j0 = first('C', 'D'); if (i < 0 || j0 < 0) return null;
    L = L.slice(i).concat(L.slice(0, i)); id = id.slice(i).concat(id.slice(0, i));
    const j = (j0 - i + m) % m;
    const a = id[0], c = id[j];
    if (!(a[0] === 'A' && c[0] === 'C' || a[0] === 'B' && c[0] === 'D')) return null;   // would split it in two: not a neck after all
    L = [L[0], ...L.slice(1, j + 1).reverse(), ...L.slice(j + 1)]; id = [id[0], ...id.slice(1, j + 1).reverse(), ...id.slice(j + 1)];
  }
  return { loop: L, X: picked.map(N => N.ctr) };
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

// The outline's corners in the world, rounded, as waypoints; checked on the sim's curve when full (X: where it is
// to cross itself, in the world: there and only there, each crossing bridged as the sim would)
function layout(corners, lat, warp, rnd, S, rMin, c, full, X = null) {
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
  // the start: 30 % along the longest straight (with bridges: of those whose start is clear of the crossings), the course run either way round
  const clear = ([x, z]) => !X || X.every(q => Math.hypot(q[0] - x, q[1] - z) > 95);
  let ls = 0, li = -1; for (let i = 0; i < m; i++) { const A = arcs[i], B = arcs[(i + 1) % m], d = Math.hypot(B.pin[0] - A.pout[0], B.pin[1] - A.pout[1]);
    if (d > ls && clear([A.pout[0] + (B.pin[0] - A.pout[0]) * 0.3, A.pout[1] + (B.pin[1] - A.pout[1]) * 0.3])) { ls = d; li = i; } }
  if (li < 0) return null;
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
  const sepMin = clamp(1.85 * rMin, 22, SEP);
  // the crossings: as many as twisted, each where one was meant to be and bridged as the sim does (bridgesFit), the start clear
  const xs = crossings(P);
  if (xs.length !== (X ? X.length : 0)) return null;
  if (X && !xs.every(q => X.some(o => Math.hypot(o[0] - q.x, o[1] - q.z) < c * 0.6))) return null;
  if (xs.length && !bridgesFit(xs, P.len)) return null;
  // apart everywhere but where the two branches of a crossing meet
  const skip = xs.map(q => ({ ia: Math.round(q.uA * n), ib: Math.round(q.uB * n), r: sepMin / q.sin + 12 }));
  const sep = separation(P, ds, sepMin, skip); if (sep < sepMin) return null;
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
// Where the road crosses itself, as the sim's buildTrack finds it (its points 1 m apart, ours ~2 m: branches at least 30 m
// apart along it, crossings 20 m apart): [{ x, z, uA, uB (uA < uB: the sim's bridge takes the uA branch over), sin }]
export function crossings(P) {
  const n = P.length, ds = P.len / n, gap = Math.ceil(30 / ds), out = [];
  for (let i = 0; i < n; i++) {
    const a = P[i], b = P[(i + 1) % n];
    for (let j = i + gap; j < n; j++) {
      if (i < gap && j > n - gap + i) continue;
      const c = P[j], d = P[(j + 1) % n];
      const den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]); if (Math.abs(den) < 1e-9) continue;
      const s = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den, t = ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / den;
      if (s < 0 || s > 1 || t < 0 || t > 1) continue;
      const x = a[0] + (b[0] - a[0]) * s, z = a[1] + (b[1] - a[1]) * s;
      if (out.some(q => Math.hypot(q.x - x, q.z - z) < 20)) continue;
      const la = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, lc = Math.hypot(d[0] - c[0], d[1] - c[1]) || 1;
      const sin = Math.abs((b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0])) / (la * lc);
      out.push({ x, z, uA: (i + s) / n, uB: (j + t) / n, sin });
    }
  }
  return out;
}
// Would the sim bridge every one of these crossings (engine.js buildTrack: crossBridge, fits)? Each at X_SIN or more, its
// deck and ramps (and the road under it) clear of the others' along the road; and the start (u 0) clear of them all.
export function bridgesFit(xs, len) {
  const ad = (u, v) => { let d = u - v; if (d > 0.5) d -= 1; if (d < -0.5) d += 1; return Math.abs(d * len); };
  const B = [];
  for (const q of xs) {
    if (q.sin < X_SIN) return false;
    const halfL = clamp(9.5 / Math.max(q.sin, 0.3) + 1, 10.5, 33), b = { uOver: q.uA, uUnder: q.uB, reach: halfL + RAMP + 6 };
    if (!B.every(o => ad(b.uOver, o.uOver) > b.reach + o.reach && ad(b.uOver, o.uUnder) > b.reach + 32 && ad(b.uUnder, o.uOver) > 32 + o.reach && ad(b.uUnder, o.uUnder) > 64)) return false;
    // the start grid and the first gate (u 0.08 on): not on a ramp, nor right under a deck
    if (ad(0, b.uOver) < b.reach + 40 || ad(0, b.uUnder) < 70) return false;
    B.push(b);
  }
  return true;
}
// the least distance (up to B: farther is Infinity) between two points of the road more than 3 B apart along it (a bucket
// grid); skip: [{ ia, ib, r }] point indices of a crossing's two branches, the pairs within r m of both not counted
export function separation(P, ds, B = SEP, skip = []) {
  const n = P.length, grid = new Map(), key = (a, b) => a * 4099 + b, skip3 = Math.ceil(3 * B / ds);
  const along = (i, k) => { const d = Math.abs(i - k); return Math.min(d, n - d) * ds; };
  const skipped = (i, j) => skip.some(q => along(i, q.ia) < q.r && along(j, q.ib) < q.r || along(i, q.ib) < q.r && along(j, q.ia) < q.r);
  P.forEach(([x, z], i) => { const k = key(Math.floor(x / B), Math.floor(z / B)); (grid.get(k) || grid.set(k, []).get(k)).push(i); });
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const [x, z] = P[i], gx = Math.floor(x / B), gz = Math.floor(z / B);
    for (let a = gx - 1; a <= gx + 1; a++) for (let b = gz - 1; b <= gz + 1; b++) for (const j of grid.get(key(a, b)) || []) {
      if (j <= i) continue; const di = Math.min(j - i, n - (j - i)); if (di < skip3) continue;
      const d = Math.hypot(P[j][0] - x, P[j][1] - z); if (d < best && !(skip.length && skipped(i, j))) best = d;
    }
  }
  return best;
}
