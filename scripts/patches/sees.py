# What the network sees, on the track (#360): watching a duel (watch.py), each of its inputs drawn in the 3D view where it
# is, with its value as the card beside the sim shows it: the racing line it follows (a ribbon ahead, as far as it looks),
# the points it looks at on it with a line from the car, its offset from the line, the pace notes (here, and the one ahead
# with a post), its speed (an arrow along its velocity: sliding shows as the arrow off the car's nose), its turn rate (an arc
# around it), the course's edges and the feelers; the rest (g, slip, sinkage, tilt, the rival) in a label over the car.
# + left / gas in orange, − right / brake in blue, as the card's bars. The page turns it on and off (`sees`).
# Applies to public/sim/engine.js, last in the chain (after hud.py):
#   python3 scripts/patches/sees.py <dir with engine.js>
import sys, os
ep = os.path.join(sys.argv[1], 'engine.js')
s = open(ep, encoding='utf-8').read()

def rep(a, b):
    global s
    n = s.count(a)
    assert n == 1, (n, a[:140])
    s = s.replace(a, b)

rep("""    case 'watch': mpWatch(m.network); break;
""", """    case 'watch': mpWatch(m.network); break;
    case 'sees': SEE.on = !!m.on; break;
""")

rep("""  if (!AI.open || (aiVizT += dt) < 0.1) return; aiVizT = 0;""", """  seeFrame();                                                          // (#360: watching a duel, what it sees on the track)
  if (!AI.open || (aiVizT += dt) < 0.1) return; aiVizT = 0;""")

rep("""let aiVizT = 0;
""", """let aiVizT = 0;
// ---------- what it sees, on the track (#360): watching a duel, each input drawn where it is, with its value ----------
const SEE = { on: true, el: null, labs: [], used: 0, boxes: [] }, SEE_RIB = 160, SEE_SEG = 96;
const SEE_POS = 0xff8a3d, SEE_NEG = 0x4aa8ff, SEE_LINE = 0x5fe0ff, SEE_INK = 0xe8eef2;
const seeRib = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: SEE_LINE, transparent: true, opacity: 0.45, depthWrite: false, depthTest: false, side: THREE.DoubleSide }));
{ const ix = []; for (let i = 0; i < SEE_RIB - 1; i++) ix.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
  seeRib.geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(SEE_RIB * 6), 3)).setIndex(ix); }
SEE.rib = seeRib; seeRib.renderOrder = 19; seeRib.visible = false; seeRib.frustumCulled = false; scene.add(seeRib);
const seeSegs = new THREE.LineSegments(new THREE.BufferGeometry()
  .setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(SEE_SEG * 6), 3)).setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(SEE_SEG * 6), 3)),
  new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, depthTest: false }));
seeSegs.renderOrder = 21; seeSegs.visible = false; seeSegs.frustumCulled = false; scene.add(seeSegs);
const seeV = new THREE.Vector3(), seeC = new THREE.Color();
function seeHide() {
  seeRib.visible = seeSegs.visible = false;
  if (SEE.el && SEE.el.style.display !== 'none') SEE.el.style.display = 'none';
}
// a label at a point of the world (null: behind the camera), kept off the ones before it; col: its mark's colour
function seeLab(x, y, z, html, col, side = false) {
  seeV.set(x, y, z).project(camera); if (seeV.z > 1 || Math.abs(seeV.x) > 1.2 || Math.abs(seeV.y) > 1.2) return;
  const r = SEE.rect, rows = html.split('<br>'), w = Math.min(260, 14 + 6.6 * Math.max(...rows.map(t => t.replace(/<[^>]+>/g, '').length))), h = 4 + 15 * rows.length;
  let px = (seeV.x + 1) / 2 * r.width, py = (1 - seeV.y) / 2 * r.height - 8;
  if (side) { px -= 70 + w / 2; py += h / 2; }                         // (beside the car: left of it, centred on it)
  for (let t = 0; t < 6; t++) {                                         // (over another: moved up, a line at a time)
    const hit = SEE.boxes.find(b => Math.abs(b.x - px) < (b.w + w) / 2 + 4 && b.y - b.h < py && py - h < b.y);
    if (!hit) break; py = hit.y - hit.h - 2;
  }
  SEE.boxes.push({ x: px, y: py, w, h });
  let e = SEE.labs[SEE.used];
  if (!e) { e = document.createElement('div'); e.className = 'seeLab'; SEE.el.appendChild(e); SEE.labs.push(e); e._h = ''; }
  SEE.used++;
  if (e._h !== html) e.innerHTML = e._h = html;
  const bc = '#' + col.toString(16).padStart(6, '0');
  if (e._c !== bc) e.style.borderLeftColor = e._c = bc;
  e.style.transform = `translate(${Math.round(px)}px, ${Math.round(py)}px) translate(-50%, -100%)`; e.style.display = '';
  return true;
}
function seeFrame() {
  const st = AI.dst;
  if (!(SEE.on && MP.watch && AI.drive && !rp.on && st && st.i >= 0 && AI.names.length)) { seeHide(); return; }
  if (!SEE.el) {
    SEE.el = document.createElement('div'); SEE.el.id = 'aiSees';
    SEE.el.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:1;overflow:hidden';
    document.head.insertAdjacentHTML('beforeend', `<style>#aiSees .seeLab{position:absolute;left:0;top:0;font:500 11px/15px ui-monospace,SFMono-Regular,Menlo,monospace;color:#e8eef2;
      background:rgba(12,14,18,.72);border-left:2px solid #5fe0ff;border-radius:3px;padding:1px 6px 1px 5px;white-space:nowrap}#aiSees .seeLab i{font-style:normal;color:#9aa4ad}</style>`);
    document.body.appendChild(SEE.el);
  }
  if (SEE.el.style.display === 'none') SEE.el.style.display = '';
  SEE.rect = renderer.domElement.getBoundingClientRect(); SEE.used = 0; SEE.boxes.length = 0;
  const Pt = botPath(), P = Pt.P, n = Pt.n, bi = st.i, RL = aiLine(), gy = (x, z) => surfaceAt(x, z, car.pos.y + 5);
  const q = car.q, fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y), fl = Math.hypot(fx, fz) || 1, cx = fx / fl, cz = fz / fl;
  const v = car.vel.x * cx + car.vel.z * cz, X = car.pos.x, Z = car.pos.z, Y = car.pos.y;
  // each input's first value in aiX, and its text as the card has it
  const at = {}; { let j = 0; for (const id of AI.inputs) { at[id] = j; j += AI_INPUTS.find(d => d.id === id).names.length; } }
  const has = id => at[id] != null, val = (id, k = 0) => aiX[at[id] + k];
  const txt = (id, k = 0) => { const j = at[id] + k; return `<i>${AI.names[j]}</i> ${AI.shows[j] ? AI.shows[j](aiX[j]) : aiX[j].toFixed(2)}`; };
  const sgn = x => x >= 0 ? SEE_POS : SEE_NEG;
  const lx = m => RL ? RL.x[m] : P[m].x, lz = m => RL ? RL.z[m] : P[m].z, ahead = d => (bi + Math.round(d / Pt.ds)) % n;
  // the lines: from the car's middle, a little over the ground
  const pa = seeSegs.geometry.attributes.position, ca = seeSegs.geometry.attributes.color; let ns = 0;
  const seg = (x1, y1, z1, x2, y2, z2, col) => {
    if (ns >= SEE_SEG) return; seeC.setHex(col);
    pa.setXYZ(2 * ns, x1, y1, z1); pa.setXYZ(2 * ns + 1, x2, y2, z2); ca.setXYZ(2 * ns, seeC.r, seeC.g, seeC.b); ca.setXYZ(2 * ns + 1, seeC.r, seeC.g, seeC.b); ns++;
  };
  const arrow = (x1, y1, z1, x2, y2, z2, col) => {                    // (a head of two strokes, a third of a metre or more)
    seg(x1, y1, z1, x2, y2, z2, col);
    const dx = x2 - x1, dz = z2 - z1, l = Math.hypot(dx, dz); if (l < 0.3) return;
    const h = Math.min(1, l * 0.3), ux = dx / l, uz = dz / l;
    for (const sd of [1, -1]) seg(x2, y2, z2, x2 - ux * h + uz * h * 0.5 * sd, y2, z2 - uz * h - ux * h * 0.5 * sd, col);
  };
  const cy = Y + 0.6, rows = [], dot = c => `<b style="color:#${c.toString(16).padStart(6, '0')}">■</b> `;
  // the car's own: one label beside it (placed first: the others keep off it), a row each in its mark's colour: its speed, offset,
  // turn rate, the pace note here, and what it feels (g, slip, sinkage, tilt, the rival)
  { if (has('speed')) rows.unshift(dot(SEE_INK) + txt('speed'));
    if (has('slide')) rows.push(dot(SEE_INK) + txt('slide'));
    if (has('offset')) rows.push(dot(sgn(val('offset'))) + txt('offset'));
    if (has('yaw')) rows.push(dot(sgn(val('yaw'))) + txt('yaw'));
    if (has('pace')) rows.push(dot(sgn(val('pace'))) + `${txt('pace')} <i>· ${Math.round(aiPace()[bi] * AI_CFG.pace * 3.6)} here</i>`);
    for (const id of ['g', 'wslip', 'sink', 'tilt', 'rival']) if (has(id)) AI_INPUTS.find(d => d.id === id).names.forEach((_, k) => rows.push(dot(0x6b7680) + txt(id, k)));
    if (rows.length) seeLab(X, Y + 1, Z, rows.join('<br>'), SEE_LINE, true); }
  // how far it looks: the farthest point it uses (the ribbon goes a little beyond)
  let far = 0;
  for (let k = 0; k < AI_LOOK.length; k++) if (has(AI_LOOK_IDS[k])) far = Math.max(far, AI_CFG.lookTime ? Math.max(AI_LOOK_MIN[k], Math.abs(v) * AI_LOOK_T[k]) : AI_LOOK[k]);
  const dAhead = Math.max(AI_AHEAD_MIN, Math.abs(v) * AI_AHEAD_T);
  if (has('ahead')) far = Math.max(far, dAhead);
  far = Math.max(far, 25) + 8;
  // the racing line ahead (the centre, when it follows that), a ribbon on the road from just past the car's nose: wide enough
  // to show from the chase camera (which sees it edge on), and over the world as the rest (the ground as drawn can be a
  // little above the heights here: its far chunks are coarser)
  { const c0 = Math.round(3 / Pt.ds), cnt = Math.max(c0 + 2, Math.round(far / Pt.ds)), step = Math.max(1, Math.ceil((cnt - c0) / (SEE_RIB - 1))), a = seeRib.geometry.attributes.position, hw = 0.5;
    for (let r = 0; r < SEE_RIB; r++) {
      const m = (bi + Math.min(cnt, c0 + r * step)) % n, tx = RL ? RL.tx[m] : P[m].tx, tz = RL ? RL.tz[m] : P[m].tz, x = lx(m), z = lz(m), y = gy(x, z) + 0.1;
      a.setXYZ(2 * r, x + tz * hw, y, z - tx * hw); a.setXYZ(2 * r + 1, x - tz * hw, y, z + tx * hw);
    }
    a.needsUpdate = true; seeRib.visible = true; }
  // the points it looks at: a line from the car to each, its bearing
  for (let k = 0; k < AI_LOOK.length; k++) {
    const m = aiMarks[k], p = AI.look[k], use = has(AI_LOOK_IDS[k]) && !!p; m.visible = use; if (!use) continue;
    const py = gy(p.x, p.z) + 0.6; m.position.set(p.x, py, p.z);
    seg(X, cy, Z, p.x, py, p.z, sgn(val(AI_LOOK_IDS[k])));
    seeLab(p.x, py + 0.5, p.z, txt(AI_LOOK_IDS[k]), sgn(val(AI_LOOK_IDS[k])));
  }
  // its offset: across to the line
  if (has('offset')) {
    const x = lx(bi), z = lz(bi), y = gy(x, z) + 0.3, c = sgn(val('offset'));
    seg(X, Y + 0.3, Z, x, y, z, c); seg(x, y - 0.25, z, x, y + 0.9, z, c);
  }
  // the pace note ahead: a post on the line, the speed it can be taken at there
  if (has('ahead')) {
    const m = ahead(dAhead), x = lx(m), z = lz(m), y = gy(x, z), c = sgn(val('ahead'));
    seg(x, y, z, x, y + 2.2, z, c); seg(x - 0.5, y + 2.2, z, x + 0.5, y + 2.2, z, c);
    seeLab(x, y + 2.4, z, `${txt('ahead')} <i>· ${Math.round(aiPace()[m] * AI_CFG.pace * 3.6)} there</i>`, c);
  }
  // its speed: an arrow along where it is going, half a second of it (off its nose: sliding)
  if (has('speed') || has('slide')) {
    const sx = car.vel.x * 0.5, sz = car.vel.z * 0.5;
    if (Math.hypot(sx, sz) > 0.5) {
      arrow(X, cy, Z, X + sx, cy, Z + sz, SEE_INK);
    }
  }
  // its turn rate: an arc around it, from its nose, as far as it turns in half a second
  if (has('yaw')) {
    const a = clamp(car.w.y * 0.5, -Math.PI, Math.PI), R = 3.2, c = sgn(val('yaw')), N = 14, yy = Y + 0.4;
    const pt = t => { const b = a * t, co = Math.cos(b), sn = Math.sin(b); return [X + (cx * co + cz * sn) * R, Z + (-cx * sn + cz * co) * R]; };
    if (Math.abs(a) > 0.02) {
      let [x0, z0] = pt(0);
      for (let i = 1; i <= N; i++) { const [x1, z1] = pt(i / N); if (i < N) seg(x0, yy, z0, x1, yy, z1, c); else arrow(x0, yy, z0, x1, yy, z1, c); x0 = x1; z0 = z1; }
    }
  }
  // the course's edges: across to each
  if (has('edges')) {
    const p = P[bi], W = aiHalfW();
    for (const [k, sd] of [[0, 1], [1, -1]]) {
      const x = p.x + p.tz * W * sd, z = p.z - p.tx * W * sd, y = gy(x, z) + 0.3;
      seg(X, Y + 0.3, Z, x, y, z, SEE_LINE); seeLab(x, y + 0.3, z, txt('edges', k), SEE_LINE);
    }
  }
  // the feelers: to where each leaves the course
  if (has('rays')) AI.rayEnds.forEach(([x, z], k) => { const y = gy(x, z) + 0.6; seg(X, cy, Z, x, y, z, SEE_LINE); seeLab(x, y + 0.3, z, txt('rays', k), SEE_LINE); });
  aiRayLines.visible = false;
  seeSegs.geometry.setDrawRange(0, 2 * ns); pa.needsUpdate = ca.needsUpdate = true; seeSegs.visible = ns > 0;
  for (let i = SEE.used; i < SEE.labs.length; i++) if (SEE.labs[i].style.display !== 'none') SEE.labs[i].style.display = 'none';
}
""")

rep("""  Object.assign(window.__sim, { setup: SETUP });""", """  Object.assign(window.__sim, { setup: SETUP });
  Object.assign(window.__sim, { see: SEE });                                      // (what it sees on the track, #360: for tests)""")

open(ep, 'w', encoding='utf-8').write(s)
print('sees: ok')
