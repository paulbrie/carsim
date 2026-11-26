import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/* Multiplayer: the race app loads this page in an iframe as /sim/index.html?mp=1&ground=…&vehicle=…&paint=…
   and talks to it with postMessage (see the MULTIPLAYER section near the end). Without ?mp=1 it is the
   single-player sim as it was. */
const MPQ = new URLSearchParams(location.search);
const AI_WK = !!globalThis.__aiWorker;                     // the autopilot's worker: this engine without a screen (autopilot.py)
const MP = { on: MPQ.get('mp') === '1', edit: MPQ.get('edit') === '1', courseKey: null, sig: null, hold: false, phase: 'free', race: 0, laps: 3, slot: -1, goAt: 0, greenSim: 0, missed: 0, finished: false,
  peers: new Map(), myId: null, sendT: 0, pIdx: -1, spectator: false };

/* =====================================================================
   WORLD / TERRAIN
   One heightfield H (current surface), B (original undisturbed surface)
   and C (compaction 0 = loose, 1 = packed) at 0.25 m resolution.
   ===================================================================== */
const WORLD = 400, CELL = 0.25, N = WORLD / CELL, V = N + 1, HALF = WORLD / 2;
const CH = 64, NCH = N / CH;           // 16 m render chunks
const NEAR_R = 76;                     // full-res chunks within this radius
const B = new Float32Array(V * V), H = new Float32Array(V * V), C = new Float32Array(V * V);
const M = new Uint8Array(V * V);       // painted ground type per cell: 0 = course base, 1 = sand, 2 = earth

const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);

function makeNoise(seed) {
  const p = new Uint8Array(512), perm = [...Array(256).keys()];
  let s = seed >>> 0;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const GX = [1, -1, 0, 0, .7071, -.7071, .7071, -.7071], GY = [0, 0, 1, -1, .7071, .7071, -.7071, -.7071];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const a = p[p[X] + Y] & 7, b = p[p[X + 1] + Y] & 7, c = p[p[X] + Y + 1] & 7, d = p[p[X + 1] + Y + 1] & 7;
    const x1 = lerp(GX[a] * xf + GY[a] * yf, GX[b] * (xf - 1) + GY[b] * yf, u);
    const x2 = lerp(GX[c] * xf + GY[c] * (yf - 1), GX[d] * (xf - 1) + GY[d] * (yf - 1), u);
    return lerp(x1, x2, v) * 1.41;
  };
}
const n1 = makeNoise(7), n2 = makeNoise(1337), n3 = makeNoise(4242);

// Transverse dunes: long gentle windward slope, short steep slip face, broken up by noise.
function duneHeight(x, z) {
  const warp = 20 * n1(x / 150, z / 150) + 7 * n2(x / 47 + 7, z / 47);
  const u = x * 0.94 + z * 0.34 + warp;
  const ph = u / 64, f = ph - Math.floor(ph), rise = 0.72;
  const prof = f < rise ? smooth(f / rise) : 1 - smooth((f - rise) / (1 - rise));
  const amp = 4.6 + 3.2 * n3(x / 190 + 3, z / 190 - 2);
  const cont = clamp(0.6 + 0.5 * n1(z / 75 + 11, x / 210), 0.12, 1);
  let h = prof * amp * cont;
  h += 1.5 * n2(x / 36, z / 36) + 0.45 * n3(x / 12 + 5, z / 12) + 0.06 * n1(x / 2.7, z / 2.7);
  const d = Math.hypot(x, z), t = smooth(clamp((d - 12) / 32, 0, 1));
  h = lerp(0.25 * h, h, t);                                  // calmer spawn area
  const e = Math.max(Math.abs(x), Math.abs(z));
  if (e > 172) h += ((e - 172) / 28) ** 2 * 16;               // world rim
  return h;
}

// Earth and Road (#308): rolling countryside instead of dunes: broad hills and swales, no slip faces
function countryHeight(x, z) {
  let h = 4 + 6.5 * n1(x / 170 + 3.1, z / 170 - 1.7) + 2.6 * n2(x / 74 - 5, z / 74 + 2) + 0.6 * n3(x / 26 + 1, z / 26 - 3)
    + 0.12 * n1(x / 6.5, z / 6.5) + 0.03 * n2(x / 1.9, z / 1.9);
  const d = Math.hypot(x, z), t = smooth(clamp((d - 12) / 32, 0, 1));
  h = lerp(4 + 0.25 * (h - 4), h, t);                        // calmer spawn area
  const e = Math.max(Math.abs(x), Math.abs(z));
  if (e > 172) h += ((e - 172) / 28) ** 2 * 16;               // world rim
  return h;
}
// the countryside's dry grass, 0-255 a cell (patches of it, thicker in places), drawn where the ground is earth
const GRASS = new Uint8Array(V * V);
let COUNTRY = false;                                         // the world was built as countryside (Earth, Road)
function generateTerrain() {
  const was = COUNTRY; COUNTRY = ROAD || COURSE.base === 'earth';
  if (COUNTRY !== was) setWeather(weatherKey, false);        // its haze and the light off the ground
  const hf = COUNTRY ? countryHeight : duneHeight;
  for (let j = 0; j < V; j++) {
    const z = -HALF + j * CELL;
    for (let i = 0; i < V; i++) B[j * V + i] = hf(-HALF + i * CELL, z);
  }
  if (COUNTRY) for (let j = 0; j < V; j++) {
    const z = -HALF + j * CELL;
    for (let i = 0; i < V; i++) { const x = -HALF + i * CELL;
      GRASS[j * V + i] = 255 * clamp(0.6 + 0.8 * n2(x / 31 + 9, z / 31 - 4) + 0.35 * n3(x / 8.5, z / 8.5 + 6) + 0.15 * n1(x / 2.3 + 4, z / 2.3), 0, 1); }
  }
  C.fill(0); M.fill(0);
  // a levelled road, or one with a max. grade, is graded over the editor's terrain strokes (the ones off
  // the road stay as they are); otherwise the strokes go on top, as ever
  const graded = COURSE.level || COURSE.grade;
  if (graded) { H.set(B); for (const op of COURSE.ops) applyOp(op, false); }
  groomTrack();
  H.set(B);
  if (!graded) for (const op of COURSE.ops) applyOp(op, false);
  H.set(B);
  aiFreshGround();
}

function heightAt(x, z) {
  let fx = clamp((x + HALF) / CELL, 0, N - 1e-4), fz = clamp((z + HALF) / CELL, 0, N - 1e-4);
  const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, k = j * V + i;
  return (H[k] * (1 - tx) + H[k + 1] * tx) * (1 - tz) + (H[k + V] * (1 - tx) + H[k + V + 1] * tx) * tz;
}
function normalAt(x, z, out) {
  const e = 0.3;
  return out.set(heightAt(x - e, z) - heightAt(x + e, z), 2 * e, heightAt(x, z - e) - heightAt(x, z + e)).normalize();
}
/* ------------------------- ground types ------------------------- */
const SURFACES = {
  sand:  { name: 'Sand',  k: 1.2e6, kComp: 7, tanPhi: 0.58, tanPhiComp: 0.15, coh: 900,  dig: 0.014, rc: 0.25, color: [0.70, 0.45, 0.21], dust: [0.80, 0.64, 0.45], dustK: 1, roostK: 1, bump: 0.45, rut: 9 },
  earth: { name: 'Earth', k: 1.4e7, kComp: 3, tanPhi: 0.78, tanPhiComp: 0.08, coh: 9000, dig: 0.0025, rc: 0.25, color: [0.40, 0.26, 0.15], dust: [0.52, 0.41, 0.31], dustK: 0.55, roostK: 0.3, bump: 0.12, rut: 14 },
  // dry asphalt: rigid (no sinkage, no ruts), peak grip ~1.0 at small slip, about 20 % less once the tire slides
  asphalt: { name: 'Asphalt', k: 4e8, kComp: 0, tanPhi: 1.15, tanPhiComp: 0, coh: 0, dig: 0, rc: 0, color: [0.17, 0.17, 0.18], dust: [0.45, 0.43, 0.41], dustK: 0.05, roostK: 0, bump: 0, rut: 0, rigid: true, s0: 0.05, a0: 0.075, slide: 0.15 },
};
const BASES = ['sand', 'earth'];
let SURF = SURFACES.sand;
let ROAD = false;                                   // road mode: the racing line is paved
const ROAD_HALF = 6;                                // half-width of the paved road: two 4.5 m lanes and 1.5 m shoulders (#308)
const RM = new Uint8Array(V * V);                   // 1 where the course is paved in road mode
const SURF_ID = [null, SURFACES.sand, SURFACES.earth, SURFACES.asphalt];
const surfAtCell = k => M[k] ? SURF_ID[M[k]] : ROAD && RM[k] ? SURFACES.asphalt : SURF;
const rigidCell = k => surfAtCell(k).rigid === true;

// Solid bridge deck (set up with the circuit). surfaceAt() = terrain, or the deck when the query point is at deck level.
const BRIDGES = [];                                 // { cx, cz, tx, tz, halfL, halfW, top, abut }
let surfDeck = false;
function deckAt(x, z, yRef) {
  let best = -Infinity;
  for (const D of BRIDGES) {
    const dx = x - D.cx, dz = z - D.cz, a = dx * D.tx + dz * D.tz, b = dz * D.tx - dx * D.tz;
    if (Math.abs(a) > D.halfL || Math.abs(b) > D.halfW || yRef < D.top - 1.3) continue;
    if (D.top > best) best = D.top;
  }
  return best;
}
function surfaceAt(x, z, yRef) {
  const h = heightAt(x, z), d = deckAt(x, z, yRef);
  surfDeck = d > h; return surfDeck ? d : h;
}
function surfNormal(x, z, yRef, out) {
  const e = 0.3;
  return out.set(surfaceAt(x - e, z, yRef) - surfaceAt(x + e, z, yRef), 2 * e, surfaceAt(x, z - e, yRef) - surfaceAt(x, z + e, yRef)).normalize();
}
const cellIndex = (x, z) => clamp(Math.round((z + HALF) / CELL), 0, N) * V + clamp(Math.round((x + HALF) / CELL), 0, N);

/* ------------------------- deformation ------------------------- */
const dirty = new Set(), aiGT = { all: true, set: new Set(), src: null };   // (aiGT: the chunks driving changed since the autopilot put the ground back)
function markDirty(i0, j0, i1, j1) {
  const a0 = Math.max(0, Math.floor((i0 - 2) / CH)), a1 = Math.min(NCH - 1, Math.floor((i1 + 2) / CH));
  const b0 = Math.max(0, Math.floor((j0 - 2) / CH)), b1 = Math.min(NCH - 1, Math.floor((j1 + 2) / CH));
  for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) { dirty.add(b * NCH + a); aiGT.set.add(b * NCH + a); }
}

// Spread `amount` (sum of cell heights, i.e. volume / cell area) as a cone around (x,z). Deposited sand is loose.
function deposit(x, z, amount, radius) {
  if (amount <= 0) return;
  const ci = (x + HALF) / CELL, cj = (z + HALF) / CELL, r = radius / CELL;
  const i0 = Math.max(1, Math.floor(ci - r)), i1 = Math.min(N - 1, Math.ceil(ci + r));
  const j0 = Math.max(1, Math.floor(cj - r)), j1 = Math.min(N - 1, Math.ceil(cj + r));
  let sum = 0;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) sum += Math.max(0, 1 - Math.hypot(i - ci, j - cj) / r);
  if (sum <= 0) return;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const w = Math.max(0, 1 - Math.hypot(i - ci, j - cj) / r);
    if (w > 0) { const k = j * V + i; if (rigidCell(k)) continue; H[k] += amount * w / sum; C[k] *= 0.5; }
  }
  markDirty(i0, j0, i1, j1);
}

// Press a tire footprint into the sand. Returns {displaced, dug} in height-sum units.
const fpOut = { displaced: 0, dug: 0 };
function pressFootprint(cx, cz, fx, fz, halfL, halfW, sink, dig) {
  const rad = Math.hypot(halfL, halfW) + CELL;
  const i0 = Math.max(1, Math.floor((cx - rad + HALF) / CELL)), i1 = Math.min(N - 1, Math.ceil((cx + rad + HALF) / CELL));
  const j0 = Math.max(1, Math.floor((cz - rad + HALF) / CELL)), j1 = Math.min(N - 1, Math.ceil((cz + rad + HALF) / CELL));
  let displaced = 0, dug = 0;
  for (let j = j0; j <= j1; j++) {
    const dz = -HALF + j * CELL - cz;
    for (let i = i0; i <= i1; i++) {
      const dx = -HALF + i * CELL - cx;
      const a = dx * fx + dz * fz, s = dz * fx - dx * fz;
      if (Math.abs(a) > halfL || Math.abs(s) > halfW) continue;
      const w = (1 - 0.35 * (a / halfL) ** 2) * (1 - 0.3 * (s / halfW) ** 2);
      const k = j * V + i;
      if (rigidCell(k)) continue;
      let h = H[k];
      const target = B[k] - sink * w;
      if (h > target) { displaced += h - target; h = target; C[k] += (1 - C[k]) * 0.3; }
      if (dig > 0) { const d = dig * w; h -= d; dug += d; C[k] *= 0.7; }
      H[k] = h;
    }
  }
  if (displaced || dug) markDirty(i0, j0, i1, j1);
  fpOut.displaced = displaced; fpOut.dug = dug;
  return fpOut;
}

// Angle of repose: let steep rut walls and berms slump.
const REPOSE = Math.tan(34 * Math.PI / 180) * CELL;
function relax(cx, cz, radius) {
  const ci = Math.round((cx + HALF) / CELL), cj = Math.round((cz + HALF) / CELL), r = Math.ceil(radius / CELL);
  const i0 = Math.max(1, ci - r), i1 = Math.min(N - 2, ci + r), j0 = Math.max(1, cj - r), j1 = Math.min(N - 2, cj + r);
  let moved = false;
  for (let it = 0; it < 2; it++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const k = j * V + i;
    if (rigidCell(k)) continue;
    for (const nk of [k + 1, k + V]) {
      if (rigidCell(nk)) continue;
      const d = H[k] - H[nk];
      if (d > REPOSE) { const m = (d - REPOSE) * 0.25; H[k] -= m; H[nk] += m; C[nk] *= 0.8; moved = true; }
      else if (d < -REPOSE) { const m = (-d - REPOSE) * 0.25; H[k] += m; H[nk] -= m; C[k] *= 0.8; moved = true; }
    }
  }
  if (moved) markDirty(i0, j0, i1, j1);
}

/* =====================================================================
   RENDERING SETUP
   ===================================================================== */
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const HAZE = new THREE.Color(0.78, 0.66, 0.52);
scene.fog = new THREE.Fog(HAZE, 70, 280);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 2000);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enabled = false;

const SUN_DIR = new THREE.Vector3(-0.55, 0.62, 0.35).normalize();
const hemi = new THREE.HemisphereLight(0xa9c8ff, 0xc89a62, 0.85);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d8, 2.8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 160 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);

// Sky dome, with a cloud layer: fbm noise on a plane above, seen through the dome; thin toward the sun
// side of each cloud (lit), thick away from it (shaded). The weather sets its colours and cover.
const SKY = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: {
    sunDir: { value: SUN_DIR }, haze: { value: HAZE }, zenith: { value: new THREE.Color(0.10, 0.24, 0.62) }, sunCol: { value: new THREE.Color(1, 0.85, 0.6) },
    sunGlow: { value: 1 }, cover: { value: 0 }, cloudLit: { value: new THREE.Color(1, 1, 1) }, cloudDark: { value: new THREE.Color(0.6, 0.64, 0.7) }, time: { value: 0 },
  },
  vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix*modelViewMatrix*vec4(position,1.); gl_Position = p.xyww; }`,
  fragmentShader: `uniform vec3 sunDir; uniform vec3 haze; uniform vec3 zenith; uniform vec3 sunCol; uniform float sunGlow; uniform float cover;
    uniform vec3 cloudLit; uniform vec3 cloudDark; uniform float time; varying vec3 vDir;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
      return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), f.x), f.y); }
    float fbm(vec2 p){ float a = .5, s = 0.; for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= .5; } return s; }
    void main(){ vec3 d = normalize(vDir); float h = clamp(d.y,0.,1.);
      vec3 col = mix(haze, zenith, pow(h,0.45));
      float s = max(dot(d, sunDir), 0.), dens = 0.;
      if (cover > 0.001 && d.y > 0.) {
        vec2 uv = d.xz / (d.y + 0.1) * 1.4 + vec2(time * 0.006, time * 0.0025);
        float n = fbm(uv), n2 = fbm(uv + normalize(sunDir.xz + 1e-4) * 0.09);
        dens = smoothstep(1. - cover, 1.25 - cover * 0.9, n) * smoothstep(0., 0.1, d.y);
        float lit = clamp(0.6 + (n - n2) * 3., 0., 1.);
        vec3 cc = mix(cloudDark, cloudLit, lit) + sunCol * pow(s, 5.) * 0.5 * sunGlow;
        col = mix(col, cc, dens);
      }
      col += sunCol * (pow(s,900.)*30. + pow(s,10.)*0.35) * sunGlow * (1. - dens);
      gl_FragColor = vec4(col,1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`
});
{
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), SKY);
  sky.frustumCulled = false; sky.renderOrder = -1;
  scene.add(sky);
  SKY.userData.envScene = new THREE.Scene(); SKY.userData.envScene.add(new THREE.Mesh(sky.geometry, SKY));
}
/* ---------- weather ---------- */
// sky: zenith / haze (horizon, fog) colours; sun: light colour, strength, height (rad; null = the usual 44 deg),
// sky's sun colour and glow; hemi: sky / ground colours, strength; clouds: cover 0-1, lit / shaded colour; rain 0-1
const WEATHERS = {
  clear: { name: 'Clear', icon: '☀', zenith: [0.10, 0.24, 0.62], haze: [0.78, 0.66, 0.52], sun: [0xfff0d8, 2.8, null], sunCol: [1, 0.85, 0.6], glow: 1, hemi: [0xa9c8ff, 0xc89a62, 0.85], cover: 0, lit: [1, 1, 1], dark: [0.6, 0.64, 0.7], fog: [70, 280], exposure: 1, rain: 0 },
  sunny: { name: 'Sunny, clouds', icon: '⛅', zenith: [0.12, 0.30, 0.70], haze: [0.80, 0.72, 0.62], sun: [0xfff2dc, 2.7, null], sunCol: [1, 0.88, 0.66], glow: 1, hemi: [0xb4cfff, 0xc89a62, 0.9], cover: 0.55, lit: [1, 0.99, 0.96], dark: [0.62, 0.66, 0.75], fog: [80, 320], exposure: 1, rain: 0 },
  grey: { name: 'Grey', icon: '☁', zenith: [0.46, 0.48, 0.52], haze: [0.66, 0.64, 0.61], sun: [0xe2e6ec, 0.55, 0.9], sunCol: [0.9, 0.9, 0.9], glow: 0.15, hemi: [0xc9cfd8, 0x8a7a66, 1.55], cover: 0.97, lit: [0.76, 0.77, 0.79], dark: [0.44, 0.46, 0.5], fog: [60, 250], exposure: 1.05, rain: 0 },
  rain: { name: 'Light rain', icon: '🌧', zenith: [0.32, 0.34, 0.38], haze: [0.50, 0.51, 0.52], sun: [0xd8e0ea, 0.35, 0.9], sunCol: [0.8, 0.8, 0.82], glow: 0, hemi: [0xaab4c4, 0x6a5e50, 1.4], cover: 1, lit: [0.56, 0.57, 0.61], dark: [0.26, 0.28, 0.32], fog: [35, 170], exposure: 1, rain: 1 },
  sunset: { name: 'Sunset', icon: '🌇', zenith: [0.14, 0.18, 0.40], haze: [0.98, 0.60, 0.38], sun: [0xffad73, 3.0, 0.16], sunCol: [1, 0.58, 0.3], glow: 1.3, hemi: [0x9c9cd4, 0xa87452, 0.95], cover: 0.5, lit: [1, 0.66, 0.5], dark: [0.40, 0.31, 0.38], fog: [70, 300], exposure: 1.15, rain: 0 },
};
const SUN_AZ = new THREE.Vector3(SUN_DIR.x, 0, SUN_DIR.z).normalize(), SUN_EL = Math.asin(SUN_DIR.y);
let WEATHER = WEATHERS.clear, weatherKey = 'clear', envTex = null;
// rain: streaks in a box that follows the camera
const RAIN_N = 1400, rainPos = new Float32Array(RAIN_N * 3), rainSeg = new Float32Array(RAIN_N * 6);
for (let i = 0; i < RAIN_N; i++) { rainPos[i * 3] = (Math.random() - 0.5) * 60; rainPos[i * 3 + 1] = (Math.random() - 0.5) * 30; rainPos[i * 3 + 2] = (Math.random() - 0.5) * 60; }
const rainGeo = new THREE.BufferGeometry(); rainGeo.setAttribute('position', new THREE.BufferAttribute(rainSeg, 3));
const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xc8d0da, transparent: true, opacity: 0.32, depthWrite: false }));
rain.frustumCulled = false; rain.visible = false; scene.add(rain);
const COUNTRY_HAZE = new THREE.Color(0.70, 0.75, 0.80), COUNTRY_BOUNCE = new THREE.Color(0x7d7a52);
function setWeather(key, save = true) {
  const W = WEATHERS[key]; if (!W) return false;
  WEATHER = W; weatherKey = key;
  const U = SKY.uniforms;
  U.zenith.value.setRGB(...W.zenith); HAZE.setRGB(...W.haze); U.sunCol.value.setRGB(...W.sunCol); U.sunGlow.value = W.glow;
  if (COUNTRY) HAZE.lerp(COUNTRY_HAZE, 0.45);
  U.cover.value = W.cover; U.cloudLit.value.setRGB(...W.lit); U.cloudDark.value.setRGB(...W.dark);
  const el = W.sun[2] ?? SUN_EL; SUN_DIR.copy(SUN_AZ).multiplyScalar(Math.cos(el)).setY(Math.sin(el));
  sun.color.setHex(W.sun[0]); sun.intensity = W.sun[1];
  hemi.color.setHex(W.hemi[0]); hemi.groundColor.setHex(W.hemi[1]); hemi.intensity = W.hemi[2];
  if (COUNTRY) hemi.groundColor.lerp(COUNTRY_BOUNCE, 0.6);
  scene.fog.color.copy(HAZE);
  let edOn = false; try { edOn = ed.on; } catch (e) { }        // (at boot the editor doesn't exist yet)
  if (!edOn) { scene.fog.near = W.fog[0]; scene.fog.far = W.fog[1]; }
  renderer.toneMappingExposure = W.exposure;
  rain.visible = W.rain > 0; rain.material.opacity = 0.32 * W.rain;
  // reflections from this sky
  const pm = new THREE.PMREMGenerator(renderer), rt = pm.fromScene(SKY.userData.envScene, 0, 1, 3000);
  envTex?.dispose(); envTex = rt; scene.environment = rt.texture; pm.dispose();
  const btn = document.getElementById('wxBtn'); if (btn) btn.textContent = `${W.icon} ${W.name}`;
  if (save) try { localStorage.setItem('sandbuggy.weather', key); } catch (e) { }
  return true;
}
function updateWeather(dt) {
  SKY.uniforms.time.value += dt;
  if (!rain.visible) return;
  const c = camera.position, fall = 7.5 * dt, wx = 0.9, wz = 0.4;     // light rain: ~7.5 m/s, a little wind
  for (let i = 0; i < RAIN_N; i++) {
    const k = i * 3;
    let x = rainPos[k] + wx * dt, y = rainPos[k + 1] - fall, z = rainPos[k + 2] + wz * dt;
    if (y < -15) y += 30;
    rainPos[k] = x; rainPos[k + 1] = y; rainPos[k + 2] = z;
    // around the camera: wrap into the box it is in
    const X = c.x + ((((x - c.x) % 60) + 90) % 60) - 30, Y = c.y + y, Z = c.z + ((((z - c.z) % 60) + 90) % 60) - 30, o = i * 6;
    rainSeg[o] = X; rainSeg[o + 1] = Y; rainSeg[o + 2] = Z; rainSeg[o + 3] = X - wx * 0.06; rainSeg[o + 4] = Y + 0.45; rainSeg[o + 5] = Z - wz * 0.06;
  }
  rainGeo.attributes.position.needsUpdate = true;
}
{
  let k = MP.on ? MPQ.get('weather') : null;
  if (!MP.on) try { k = localStorage.getItem('sandbuggy.weather'); } catch (e) { }
  setWeather(WEATHERS[k] ? k : 'clear', false);
}

// Procedural sand textures: fine grain (color) and wind ripples (bump)
function canvasTex(size, fn, srgb) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const v = fn(x / size, y / size), o = (y * size + x) * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = clamp(v * 255, 0, 255); img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const TAU = Math.PI * 2;
/* ------------------------- ground textures (procedural, tileable) ------------------------- */
function rng(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
// tileable value noise with integer period P, smooth-step interpolated, in [-1, 1]
function tileNoise(P, seed) {
  const r = rng(seed), g = new Float32Array(P * P); for (let i = 0; i < P * P; i++) g[i] = r() * 2 - 1;
  return (u, v) => {
    const x = u * P, y = v * P, xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % P) + P) % P, y0 = ((yi % P) + P) % P, x1 = (x0 + 1) % P, y1 = (y0 + 1) % P;
    return lerp(lerp(g[y0 * P + x0], g[y0 * P + x1], sx), lerp(g[y1 * P + x0], g[y1 * P + x1], sx), sy);
  };
}
function tileFbm(P, oct, seed) {
  const ns = []; for (let o = 0; o < oct; o++) ns.push(tileNoise(P << o, seed + o * 101));
  return (u, v) => { let s = 0, a = 1, n = 0; for (const f of ns) { s += f(u, v) * a; n += a; a *= 0.5; } return s / n; };
}
// tileable Voronoi: F1, F2 distances (in cell units), id of the nearest cell
function tileVoronoi(P, seed) {
  const r = rng(seed), px = new Float32Array(P * P), pz = new Float32Array(P * P), id = new Float32Array(P * P);
  for (let i = 0; i < P * P; i++) { px[i] = r(); pz[i] = r(); id[i] = r(); }
  const out = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  return (u, v) => {
    const x = u * P, y = v * P, xi = Math.floor(x), yi = Math.floor(y);
    let f1 = 9, f2 = 9, bid = 0, bdx = 0, bdy = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const cx = xi + i, cy = yi + j, k = (((cy % P) + P) % P) * P + (((cx % P) + P) % P);
      const dx = cx + px[k] - x, dy = cy + pz[k] - y, d = Math.hypot(dx, dy);
      if (d < f1) { f2 = f1; f1 = d; bid = id[k]; bdx = dx; bdy = dy; } else if (d < f2) f2 = d;
    }
    out.f1 = f1; out.f2 = f2; out.id = bid; out.dx = bdx; out.dy = bdy; return out;
  };
}
function genTex(size, srgb, fn) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), img = g.createImageData(size, size), o3 = [0, 0, 0];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    fn(x / size, y / size, o3); const o = (y * size + x) * 4;
    img.data[o] = clamp(o3[0] * 255, 0, 255); img.data[o + 1] = clamp(o3[1] * 255, 0, 255); img.data[o + 2] = clamp(o3[2] * 255, 0, 255); img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy(); if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const TEX = 512;
// SAND: fine quartz with dark mineral and bright grains, faint mottling; wind ripples with heavier, darker grains in the troughs
const sandRipple = (() => {
  const warp = tileFbm(3, 3, 41);
  return (u, v) => {
    const p = 11 * v + 0.6 * warp(u, v) + 0.12 * Math.sin(TAU * (2 * u + v));
    const f = p - Math.floor(p); return f < 0.7 ? smooth(f / 0.7) : 1 - smooth((f - 0.7) / 0.3);   // gentle stoss, short lee side
  };
})();
const sandTex = (() => {
  const r = rng(11), mott = tileFbm(4, 4, 21), rw = tileFbm(3, 3, 31);
  return genTex(TEX, true, (u, v, o) => {
    const rp = sandRipple(u, v), m = (0.93 + 0.06 * mott(u, v)) * (0.9 + 0.1 * rp), q = r() + (1 - rp) * 0.03;
    let k = 0.86 + 0.12 * r(), cr = 1, cg = 1, cb = 1;
    if (q < 0.035) { k = 0.5 + 0.2 * r(); cr = 1.02; cg = 0.95; cb = 0.9; }        // dark mineral grains
    else if (q < 0.05) { k = 0.62; cr = 1.1; cg = 0.85; cb = 0.7; }                 // iron-stained grains
    else if (q > 0.985) { k = 1.08; cr = 1; cg = 1; cb = 1.02; }                    // bright quartz
    const t = 0.98 + 0.04 * rw(u, v);
    o[0] = m * k * cr * t; o[1] = m * k * cg; o[2] = m * k * cb * (2 - t);
  });
})();
const sandBump = (() => {
  const r = rng(17), fine = tileFbm(16, 2, 43);
  return genTex(TEX, false, (u, v, o) => { o[0] = o[1] = o[2] = 0.15 + 0.7 * sandRipple(u, v) + 0.08 * fine(u, v) + 0.06 * r(); });
})();
// EARTH: packed dry soil, clods, dark organic patches, pebbles and a network of drying cracks
const earthTexs = (() => {
  const S = TEX, alb = new Float32Array(S * S * 3), hgt = new Float32Array(S * S);
  const r = rng(51), clod = tileFbm(8, 4, 61), patch = tileFbm(3, 3, 71), cracks = tileVoronoi(7, 81), pebs = tileVoronoi(26, 91), grit = tileVoronoi(70, 97);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, i = y * S + x;
    const c = clod(u, v), pa = patch(u, v);
    let k = 0.74 + 0.14 * c + 0.05 * r(), cr = 1, cg = 1, cb = 1, h = 0.45 + 0.18 * c;
    if (pa < -0.15) { const w = smooth(clamp((-0.15 - pa) / 0.25, 0, 1)); k *= 1 - 0.22 * w; cg *= 1 - 0.04 * w; }   // darker, damper patches
    if (pa > 0.25) { const w = smooth(clamp((pa - 0.25) / 0.3, 0, 1)); k *= 1 + 0.12 * w; cr *= 1 + 0.03 * w; }     // sun-bleached crust
    const cv = cracks(u + 0.02 * clod(v, u), v + 0.02 * clod(u + 0.5, v)), edge = cv.f2 - cv.f1;
    if (edge < 0.07) { const w = 1 - edge / 0.07; k *= 1 - 0.55 * w * w; h -= 0.35 * w * w; }                     // drying cracks
    const pv = pebs(u, v), pr = 0.18 + 0.2 * pv.id;
    if (pv.id > 0.55 && pv.f1 < pr) {                                                                               // pebbles
      const d = pv.f1 / pr, dome = Math.sqrt(1 - d * d), tone = 0.85 + 0.3 * ((pv.id * 7.3) % 1);
      k = (0.95 + 0.12 * dome) * tone; cr = 1.02 - 0.12 * ((pv.id * 13.1) % 1); cg = 1; cb = 0.96 + 0.1 * ((pv.id * 3.7) % 1);
      h = 0.6 + 0.4 * dome; if (d > 0.82) k *= 0.6;                                                               // dark rim where it sits in the soil
    }
    const gv = grit(u, v); if (gv.id > 0.7 && gv.f1 < 0.22) { k *= 1.12; h += 0.12; }                                  // grit
    alb[i * 3] = k * cr; alb[i * 3 + 1] = k * cg; alb[i * 3 + 2] = k * cb; hgt[i] = h;
  }
  const a = genTex(S, true, (u, v, o) => { const i = Math.round(v * S) * S + Math.round(u * S); o[0] = alb[i * 3]; o[1] = alb[i * 3 + 1]; o[2] = alb[i * 3 + 2]; });
  const b = genTex(S, false, (u, v, o) => { o[0] = o[1] = o[2] = hgt[Math.round(v * S) * S + Math.round(u * S)]; });
  return [a, b];
})();
// ASPHALT: dense-graded mix: dark bitumen with light and dark aggregate, fine sand, a faint wear sheen
const asphaltTexs = (() => {
  const S = TEX, alb = new Float32Array(S * S), hgt = new Float32Array(S * S);
  const r = rng(131), mott = tileFbm(4, 4, 141), stones = tileVoronoi(46, 151), fine = tileVoronoi(120, 161), wear = tileFbm(2, 3, 171);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, i = y * S + x;
    let k = 0.62 + 0.08 * mott(u, v) + 0.06 * r(), h = 0.35 + 0.1 * r();
    const sv = stones(u, v), rr = 0.3 + 0.25 * sv.id;
    if (sv.f1 < rr) { const d = sv.f1 / rr; k = sv.id > 0.5 ? 0.95 + 0.35 * ((sv.id * 7.1) % 1) : 0.55 + 0.2 * ((sv.id * 5.3) % 1); h = 0.55 + 0.4 * Math.sqrt(1 - d * d); if (d > 0.85) k *= 0.55; }
    else if (sv.f2 - sv.f1 < 0.06) { k *= 0.55; h = 0.1; }                 // voids between the stones
    const fv = fine(u, v); if (fv.id > 0.55 && fv.f1 < 0.25) { k = Math.max(k, 0.9 + 0.3 * fv.id); h += 0.1; }
    k *= 0.95 + 0.1 * wear(u, v);
    alb[i] = k; hgt[i] = h;
  }
  const a = genTex(S, true, (u, v, o) => { const i = Math.round(v * S) % S * S + Math.round(u * S) % S; o[0] = alb[i]; o[1] = alb[i] * 0.995; o[2] = alb[i] * 1.02; });
  const b = genTex(S, false, (u, v, o) => { o[0] = o[1] = o[2] = hgt[Math.round(v * S) % S * S + Math.round(u * S) % S]; });
  return [a, b];
})();
// large-scale variation, sampled in world space to break up visible tiling
const macroTex = (() => { const f = tileFbm(4, 5, 101); const t = genTex(256, false, (u, v, o) => { o[0] = o[1] = o[2] = 0.5 + 0.5 * f(u, v); }); return t; })();
const sandMat = new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.96, metalness: 0, envMapIntensity: 0, map: sandTex, bumpMap: sandBump, bumpScale: 0.45
});
const paintU = { value: null };   // world-space "chalk" layer painted onto the sand (course arrows)
sandMat.onBeforeCompile = sh => {   // sand and earth blend per vertex; disturbed ground loses its ripples and gets the chalk scuffed off
  sh.uniforms.paintMap = paintU; sh.uniforms.earthMap = { value: earthTexs[0] }; sh.uniforms.earthBump = { value: earthTexs[1] }; sh.uniforms.macroMap = { value: macroTex }; sh.uniforms.asphMap = { value: asphaltTexs[0] }; sh.uniforms.asphBump = { value: asphaltTexs[1] };
  sh.vertexShader = 'attribute float aDist;\nattribute float aSurf;\nvarying float vDist;\nvarying float vSurf;\nvarying vec2 vWXZ;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvDist = aDist;\nvSurf = aSurf;\nvWXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
  const bumpChunk = THREE.ShaderChunk.bumpmap_pars_fragment
    .replace('uniform float bumpScale;', `uniform float bumpScale;
      uniform sampler2D earthBump;
      uniform sampler2D asphBump;
      float bumpH(vec2 uv) {
        float s = texture2D(bumpMap, uv).x;
        float e = texture2D(earthBump, uv * 0.8).x;
        float a = texture2D(asphBump, uv * 1.6).x;
        float fA = clamp(vSurf - 1.0, 0.0, 1.0), fE = clamp(vSurf, 0.0, 1.0) - fA;
        return s * (1.0 - vDist) * (1.0 - fE - fA) + e * (1.0 - 0.6 * vDist) * 1.6 * fE + a * 0.22 * fA;
      }`)
    .replace(/texture2D\( bumpMap, ([^)]*?) \)\.x/g, 'bumpH( $1 )');
  sh.fragmentShader = 'varying float vDist;\nvarying float vSurf;\nvarying vec2 vWXZ;\nuniform sampler2D paintMap;\nuniform sampler2D earthMap;\nuniform sampler2D macroMap;\nuniform sampler2D asphMap;\n' + sh.fragmentShader
    .replace('#include <bumpmap_pars_fragment>', bumpChunk)
    .replace('#include <map_fragment>', `
      vec3 sA = texture2D(map, vMapUv).rgb, sB = texture2D(map, vMapUv * 0.37 + vec2(0.31, 0.17)).rgb;
      vec3 eA = texture2D(earthMap, vMapUv * 0.8).rgb, eB = texture2D(earthMap, vMapUv * 0.29 + vec2(0.53, 0.07)).rgb;
      vec3 aA = texture2D(asphMap, vMapUv * 1.6).rgb, aB = texture2D(asphMap, vMapUv * 0.21 + vec2(0.17, 0.61)).rgb;
      float fA = clamp(vSurf - 1.0, 0.0, 1.0), fE = clamp(vSurf, 0.0, 1.0) - fA;
      vec3 tx = mix(sA, sB, 0.25) * (1.0 - fE - fA) + mix(eA, eB, 0.3) * fE + mix(aA, aB, 0.35) * 1.25 * fA;
      float macro = texture2D(macroMap, vWXZ / 97.0).r * 0.6 + texture2D(macroMap, vWXZ / 23.0 + 0.4).r * 0.4;
      diffuseColor.rgb *= tx * (0.84 + 0.32 * macro);`)
    .replace('#include <color_fragment>', `#include <color_fragment>
      vec4 chalk = texture2D(paintMap, (vWXZ + ${HALF.toFixed(1)}) / ${WORLD.toFixed(1)});
      diffuseColor.rgb = mix(diffuseColor.rgb, chalk.rgb, chalk.a * (1.0 - 0.85 * vDist));`)
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n      float fA2 = clamp(vSurf - 1.0, 0.0, 1.0), fE2 = clamp(vSurf, 0.0, 1.0) - fA2;\n      roughnessFactor = 0.96 * (1.0 - fE2 - fA2) + (0.9 - 0.1 * vDist) * fE2 + 0.8 * fA2;');
};
const SAND = [0.70, 0.45, 0.21];

/* ------------------------- near chunks ------------------------- */
const S = CH + 1;
const chunkIndex = (() => {
  const idx = new Uint16Array(CH * CH * 6); let p = 0;
  for (let j = 0; j < CH; j++) for (let i = 0; i < CH; i++) {
    const a = j * S + i, b = a + 1, c = a + S, d = c + 1;
    idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d;
  }
  return new THREE.BufferAttribute(idx, 1);
})();

function writeVertex(k, gi, gj, pos, nrm, col, dis, bmp, o) {
  const h = H[k];
  pos[o + 1] = h;
  const hl = H[gi > 0 ? k - 1 : k], hr = H[gi < N ? k + 1 : k], hd = H[gj > 0 ? k - V : k], hu = H[gj < N ? k + V : k];
  let nx = hl - hr, ny = 2 * CELL, nz = hd - hu; const inv = 1 / Math.hypot(nx, ny, nz);
  nrm[o] = nx * inv; nrm[o + 1] = ny * inv; nrm[o + 2] = nz * inv;
  const sf = surfAtCell(k);
  const dist = sf.rigid ? 0 : clamp(Math.abs(B[k] - h) * sf.rut + C[k] * 0.8, 0, 1);
  dis[o / 3] = dist; bmp[o / 3] = sf === SURFACES.earth ? 1 : sf.rigid ? 2 : 0;
  const tint = 0.93 + 0.07 * clamp(B[k] / 8, 0, 1);
  const f = tint * (1 - 0.38 * dist);
  const S0 = sf.color; let r0 = S0[0], g0 = S0[1], b0 = S0[2];
  if (COUNTRY && sf === SURFACES.earth && GRASS[k]) {
    const gr = GRASS[k] / 255, w = smooth(clamp(gr * 1.6, 0, 1)) * (1 - clamp(C[k] * 3.5, 0, 1)) * (1 - dist), ol = clamp((gr - 0.55) * 2.2, 0, 1);
    r0 = lerp(r0, lerp(0.55, 0.38, ol), w); g0 = lerp(g0, lerp(0.47, 0.40, ol), w); b0 = lerp(b0, lerp(0.24, 0.17, ol), w);
  }
  col[o] = r0 * f; col[o + 1] = g0 * f * (1 - 0.03 * dist); col[o + 2] = b0 * f * (1 - 0.06 * dist);
  return h;
}

class Chunk {
  constructor(a, b) {
    this.a = a; this.b = b;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(S * S * 3), uv = new Float32Array(S * S * 2);
    for (let vj = 0; vj < S; vj++) for (let vi = 0; vi < S; vi++) {
      const o = vj * S + vi, x = -HALF + (a * CH + vi) * CELL, z = -HALF + (b * CH + vj) * CELL;
      pos[o * 3] = x; pos[o * 3 + 2] = z; uv[o * 2] = x / 2.2; uv[o * 2 + 1] = z / 2.2;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(S * S * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(S * S * 3), 3));
    g.setAttribute('aDist', new THREE.BufferAttribute(new Float32Array(S * S), 1));
    g.setAttribute('aSurf', new THREE.BufferAttribute(new Float32Array(S * S), 1));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(chunkIndex);
    this.mesh = new THREE.Mesh(g, sandMat);
    this.mesh.receiveShadow = true; this.mesh.castShadow = true;
    this.update();
    scene.add(this.mesh);
  }
  update() {
    const g = this.mesh.geometry, pos = g.attributes.position.array, nrm = g.attributes.normal.array, col = g.attributes.color.array, dis = g.attributes.aDist.array, bmp = g.attributes.aSurf.array;
    let lo = Infinity, hi = -Infinity;
    for (let vj = 0; vj < S; vj++) {
      const gj = this.b * CH + vj;
      for (let vi = 0; vi < S; vi++) {
        const gi = this.a * CH + vi, h = writeVertex(gj * V + gi, gi, gj, pos, nrm, col, dis, bmp, (vj * S + vi) * 3);
        if (h < lo) lo = h; if (h > hi) hi = h;
      }
    }
    g.attributes.position.needsUpdate = g.attributes.normal.needsUpdate = g.attributes.color.needsUpdate = g.attributes.aDist.needsUpdate = g.attributes.aSurf.needsUpdate = true;
    const cx = -HALF + (this.a + 0.5) * CH * CELL, cz = -HALF + (this.b + 0.5) * CH * CELL;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, (lo + hi) / 2, cz), Math.hypot(CH * CELL * 0.71, (hi - lo) / 2 + 0.5));
  }
  dispose() { scene.remove(this.mesh); this.mesh.geometry.dispose(); }
}
const chunks = new Map();
const active = new Uint8Array(NCH * NCH);

/* ------------------------- far terrain (2 m) ------------------------- */
const FS = 8, FV = N / FS + 1;
const farGeo = (() => {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(FV * FV * 3), uv = new Float32Array(FV * FV * 2), idx = new Uint32Array((FV - 1) ** 2 * 6);
  for (let j = 0; j < FV; j++) for (let i = 0; i < FV; i++) {
    const o = j * FV + i, x = -HALF + i * FS * CELL, z = -HALF + j * FS * CELL;
    pos[o * 3] = x; pos[o * 3 + 2] = z; uv[o * 2] = x / 2.2; uv[o * 2 + 1] = z / 2.2;
  }
  let p = 0;
  for (let j = 0; j < FV - 1; j++) for (let i = 0; i < FV - 1; i++) {
    const a = j * FV + i, b = a + 1, c = a + FV, d = c + 1;
    idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d;
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(FV * FV * 3), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(FV * FV * 3), 3));
  g.setAttribute('aDist', new THREE.BufferAttribute(new Float32Array(FV * FV), 1));
  g.setAttribute('aSurf', new THREE.BufferAttribute(new Float32Array(FV * FV), 1));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
})();
const farMesh = new THREE.Mesh(farGeo, sandMat);
farMesh.receiveShadow = true; farMesh.frustumCulled = false;
scene.add(farMesh);

function updateFar() {
  if (AI_WK) return;
  const pos = farGeo.attributes.position.array, nrm = farGeo.attributes.normal.array, col = farGeo.attributes.color.array, dis = farGeo.attributes.aDist.array, bmp = farGeo.attributes.aSurf.array;
  for (let j = 0; j < FV; j++) for (let i = 0; i < FV; i++) {
    const gi = i * FS, gj = j * FS, k = gj * V + gi, o = (j * FV + i) * 3;
    writeVertex(k, gi, gj, pos, nrm, col, dis, bmp, o);
    // hide under the high-res chunks: lower if every chunk touching this vertex is active
    const as = gi % CH === 0 ? [gi / CH - 1, gi / CH] : [Math.floor(gi / CH)];
    const bs = gj % CH === 0 ? [gj / CH - 1, gj / CH] : [Math.floor(gj / CH)];
    let all = true;
    for (const a of as) for (const b of bs) if (a < 0 || b < 0 || a >= NCH || b >= NCH || !active[b * NCH + a]) all = false;
    pos[o + 1] -= all ? 4 : 0.3;
  }
  farGeo.attributes.position.needsUpdate = farGeo.attributes.normal.needsUpdate = farGeo.attributes.color.needsUpdate = farGeo.attributes.aDist.needsUpdate = farGeo.attributes.aSurf.needsUpdate = true;
}

function refreshChunks(px, pz, budget = Infinity) {
  if (AI_WK) return;                                         // (nothing to draw in a worker)
  let changed = false;
  for (let b = 0; b < NCH; b++) for (let a = 0; a < NCH; a++) {
    const id = b * NCH + a;
    const cx = -HALF + (a + 0.5) * CH * CELL, cz = -HALF + (b + 0.5) * CH * CELL;
    const d = Math.hypot(cx - px, cz - pz);
    if (d < NEAR_R && !chunks.has(id) && budget > 0) { chunks.set(id, new Chunk(a, b)); active[id] = 1; budget--; changed = true; }
    else if (d > NEAR_R + 20 && chunks.has(id)) { chunks.get(id).dispose(); chunks.delete(id); active[id] = 0; changed = true; }
  }
  if (changed) updateFar();
}

/* =====================================================================
   BUGGY MODEL
   Body axes: +z forward, +y up, +x = left side.
   ===================================================================== */
const G = 9.81;
let PRESSURES = [{ psi: 8, kpa: 55, w: 0.36, defl: 0.035 }, { psi: 14, kpa: 97, w: 0.33, defl: 0.02 }, { psi: 24, kpa: 165, w: 0.30, defl: 0.006 }];
const car = {
  mass: 820, I: new THREE.Vector3(760, 920, 300),
  pos: new THREE.Vector3(), vel: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(),
  steer: 0, throttle: 0, awd: false, pIdx: 1, aids: true, split: 0.5,
  R: 0.42, REST: 0.52, K: 30000, CB: 2600, CR: 3600, Iw: 1.6,
  wheels: [
    { name: 'FL', hp: new THREE.Vector3(0.84, 0, 1.38), front: true },
    { name: 'FR', hp: new THREE.Vector3(-0.84, 0, 1.38), front: true },
    { name: 'RL', hp: new THREE.Vector3(0.88, 0, -1.30), front: false },
    { name: 'RR', hp: new THREE.Vector3(-0.88, 0, -1.30), front: false },
  ],
  hull: [[0.65, -0.28, 1.6], [-0.65, -0.28, 1.6], [0.65, -0.28, -1.5], [-0.65, -0.28, -1.5], [0, -0.2, 2.15], [0, -0.15, -2.0],
    [0, -0.32, 0], [0.62, 1.25, 0.25], [-0.62, 1.25, 0.25], [0.62, 1.2, -0.95], [-0.62, 1.2, -0.95],
    // rest of the roll cage: roof bars, A-pillars, rear hoop, side bars, so it rests on its roof or side like a real cage
    [0.62, 1.23, -0.35], [-0.62, 1.23, -0.35], [0, 1.27, 0.25], [0, 1.22, -0.95], [0.62, 0.8, 0.75], [-0.62, 0.8, 0.75],
    [0.64, 0.75, -1.2], [-0.64, 0.75, -1.2], [0.7, 0.4, -0.35], [-0.7, 0.4, -0.35], [0.6, 0.35, 1.2], [-0.6, 0.35, 1.2],
    // tire tops and outer sidewalls (the wheels stick out past the body)
    ...[[0.84, 1.38], [-0.84, 1.38], [0.88, -1.3], [-0.88, -1.3]].flatMap(([x, z]) => [[x, 0.0, z], [x + Math.sign(x) * 0.17, -0.42, z], [x + Math.sign(x) * 0.15, -0.15, z + 0.3], [x + Math.sign(x) * 0.15, -0.15, z - 0.3]])].map(a => new THREE.Vector3(...a)),
};
// engine + 5-speed automatic transaxle
let ENG = { idle: 950, limiter: 7600, gears: [3.2, 2.1, 1.55, 1.2, 0.95], fd: 4.6, rev: 3.3, eff: 0.88, stall: 3300, upLo: 6600, upHi: 6600, upGround: 4000, dnLo: 2300, dnHi: 2300,
  curve: [[800, 100], [2500, 148], [4500, 180], [5800, 186], [7000, 166], [7700, 130]] };
car.eng = { rpm: ENG.idle, gear: 1, shiftT: 0, load: 0, cut: false, reverse: false, liftT: 9, lastPower: 0, popT: 0 };
function engineTorque(rpm) {
  const c = ENG.curve; if (rpm <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) if (rpm < c[i][0]) return lerp(c[i - 1][1], c[i][1], (rpm - c[i - 1][0]) / (c[i][0] - c[i - 1][0]));
  return c[c.length - 1][1];
}
for (const w of car.wheels) Object.assign(w, { t: car.REST, comp: 0, omega: 0, spin: 0, contact: false, load: 0, sink: 0, slip: 0, slipSpeed: 0, cUnder: 0, P: new THREE.Vector3(), fwd: new THREE.Vector3(), dug: 0 });

// visual
const buggy = new THREE.Group();
scene.add(buggy);
const rig = { links: [], coils: [], pole: { ax: 0, az: 0, vx: 0, vz: 0 }, flameT: 0, time: 0, prevVel: new THREE.Vector3(), acc: new THREE.Vector3() };
{
  const M = {
    paint: new THREE.MeshPhysicalMaterial({ color: 0xd9360b, roughness: 0.34, metalness: 0.1, envMapIntensity: 0.6, clearcoat: 1, clearcoatRoughness: 0.12 }),
    paint2: new THREE.MeshPhysicalMaterial({ color: 0x17191c, roughness: 0.4, metalness: 0.2, clearcoat: 0.6 }),
    tube: new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.38, metalness: 0.75 }),
    alu: new THREE.MeshStandardMaterial({ color: 0xc9cdd2, roughness: 0.28, metalness: 0.9 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x8a9098, roughness: 0.42, metalness: 0.85 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.55, metalness: 0.7 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x1b1a19, roughness: 0.93, side: THREE.DoubleSide }),
    black: new THREE.MeshStandardMaterial({ color: 0x0e0e0f, roughness: 0.7 }),
    seat: new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.88 }),
    red: new THREE.MeshStandardMaterial({ color: 0xc81e24, roughness: 0.35, metalness: 0.4 }),
    suit: new THREE.MeshStandardMaterial({ color: 0x1d4ea6, roughness: 0.8 }),
    glove: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 }),
    helmet: new THREE.MeshPhysicalMaterial({ color: 0xf3f3f1, roughness: 0.25, clearcoat: 1 }),
    visor: new THREE.MeshPhysicalMaterial({ color: 0x0c1218, roughness: 0.05, metalness: 0.7, clearcoat: 1 }),
    lamp: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d0, emissiveIntensity: 0.8 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1500, emissiveIntensity: 0.3 }),
    exhaust: new THREE.MeshStandardMaterial({ color: 0x7a6250, roughness: 0.45, metalness: 0.85 }),
    flag: new THREE.MeshStandardMaterial({ color: 0xff5200, roughness: 0.85, side: THREE.DoubleSide }),
    flame: new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
  };
  rig.M = M; M.paint.userData.sbPaint = true;
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const add = (geo, mat, parent = buggy, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
  const tubePath = (pts, r = 0.028, mat = M.tube, parent = buggy) => {
    const curve = new THREE.CatmullRomCurve3(pts.map(p => V3(...p)), false, 'catmullrom', 0.2);
    return add(new THREE.TubeGeometry(curve, Math.max(6, (pts.length - 1) * 12), r, 10, false), mat, parent);
  };
  const mir = pts => pts.map(([x, y, z]) => [-x, y, z]);
  const both = (pts, r, mat) => { tubePath(pts, r, mat); tubePath(mir(pts), r, mat); };
  // extrude a side profile (z,y) across x
  const extrudeX = (prof, width, mat, x = 0, bevel = 0.02, parent = buggy) => {
    const sh = new THREE.Shape(prof.map(([z, y]) => new THREE.Vector2(z, y)));
    const g = new THREE.ExtrudeGeometry(sh, { depth: width, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 12 });
    g.rotateY(-Math.PI / 2); g.translate(x + width / 2, 0, 0);
    return add(g, mat, parent);
  };
  const rbox = (w, h, d, r, mat, x, y, z, parent = buggy) => add(new RoundedBoxGeometry(w, h, d, 3, r), mat, parent, x, y, z);

  /* ---------- space-frame chassis ---------- */
  both([[0.34, -0.3, 2.05], [0.5, -0.3, 1.55], [0.6, -0.3, 0.9], [0.62, -0.3, -0.75], [0.52, -0.28, -1.75]], 0.032);
  for (const [x, z] of [[0.34, 2.05], [0.6, 0.9], [0.62, -0.75], [0.52, -1.75]]) tubePath([[x, -0.3, z], [-x, -0.3, z]], 0.03);
  tubePath([[0.62, -0.3, -0.75], [0.6, 0.55, -0.78], [0.53, 1.08, -0.8], [0.3, 1.18, -0.8], [-0.3, 1.18, -0.8], [-0.53, 1.08, -0.8], [-0.6, 0.55, -0.78], [-0.62, -0.3, -0.75]], 0.036);
  tubePath([[0.6, -0.3, 0.9], [0.6, 0.2, 0.86], [0.55, 0.8, 0.45], [0.48, 1.12, 0.18], [0.25, 1.17, 0.12], [-0.25, 1.17, 0.12], [-0.48, 1.12, 0.18], [-0.55, 0.8, 0.45], [-0.6, 0.2, 0.86], [-0.6, -0.3, 0.9]], 0.034);
  both([[0.49, 1.13, 0.17], [0.53, 1.09, -0.8]], 0.03);
  tubePath([[0.49, 1.14, 0.16], [-0.53, 1.1, -0.79]], 0.024); tubePath([[-0.49, 1.14, 0.16], [0.53, 1.1, -0.79]], 0.024);
  tubePath([[0.6, -0.1, -0.77], [-0.5, 1.1, -0.8]], 0.026);
  both([[0.53, 1.07, -0.82], [0.5, 0.58, -1.4], [0.48, 0.18, -1.86]], 0.03);
  both([[0.48, 0.18, -1.86], [0.52, -0.28, -1.75]], 0.03);
  tubePath([[0.5, 0.58, -1.4], [-0.5, 0.58, -1.4]], 0.03);
  tubePath([[0.48, 0.18, -1.88], [0.32, 0.12, -2.03], [-0.32, 0.12, -2.03], [-0.48, 0.18, -1.88]], 0.032);
  both([[0.61, 0.24, 0.86], [0.67, 0.3, 0.1], [0.62, 0.28, -0.77]], 0.028);
  both([[0.62, -0.28, 0.6], [0.66, 0.29, 0.2]], 0.022);
  both([[0.6, 0.2, 0.86], [0.43, 0.43, 1.25], [0.36, 0.26, 1.85], [0.34, -0.3, 2.05]], 0.03);
  tubePath([[0.43, 0.43, 1.25], [-0.43, 0.43, 1.25]], 0.03);
  tubePath([[0.36, 0.16, 1.95], [0.52, -0.04, 2.12], [0.3, -0.2, 2.24], [-0.3, -0.2, 2.24], [-0.52, -0.04, 2.12], [-0.36, 0.16, 1.95]], 0.036);
  add(new THREE.BoxGeometry(1.12, 0.012, 2.7), M.alu, buggy, 0, -0.325, 0.15);              // floor pan
  extrudeX([[1.55, -0.32], [2.08, -0.3], [2.2, -0.2], [2.0, -0.26]], 0.6, M.alu, 0, 0.005);  // skid plate

  /* ---------- body panels: lofted fiberglass shapes ---------- */
  // each section is a superellipse ring {z, w (half width), top, bot, n (squareness), x (centre)}; sections go front-to-back in +z
  function loft(secs, mat, parent = buggy, RING = 24) {
    const pos = [], idx = [];
    for (const sc of secs) {
      const cy = (sc.top + sc.bot) / 2, h = (sc.top - sc.bot) / 2, n = sc.n || 4, x0 = sc.x || 0;
      for (let i = 0; i < RING; i++) {
        const a = i / RING * TAU, c = Math.cos(a), s = Math.sin(a);
        pos.push(x0 + sc.w * Math.sign(c) * Math.abs(c) ** (2 / n), cy + h * Math.sign(s) * Math.abs(s) ** (2 / n), sc.z);
      }
    }
    for (let k = 0; k < secs.length - 1; k++) for (let i = 0; i < RING; i++) {
      const a = k * RING + i, b = k * RING + (i + 1) % RING, c = a + RING, d = b + RING;
      idx.push(a, b, c, b, d, c);
    }
    for (const k of [0, secs.length - 1]) {
      const base = pos.length / 3, sc = secs[k];
      for (let i = 0; i < RING; i++) pos.push(pos[(k * RING + i) * 3], pos[(k * RING + i) * 3 + 1], sc.z);   // duplicate rim for a crisp cap edge
      pos.push(sc.x || 0, (sc.top + sc.bot) / 2, sc.z);
      for (let i = 0; i < RING; i++) { const a = base + i, b = base + (i + 1) % RING, c = base + RING; k === 0 ? idx.push(c, b, a) : idx.push(c, a, b); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    return add(g, mat, parent);
  }
  // nose / hood
  loft([{ z: 0.8, w: 0.43, top: 0.37, bot: -0.28, n: 5 }, { z: 1.12, w: 0.43, top: 0.45, bot: -0.28, n: 5 }, { z: 1.5, w: 0.4, top: 0.39, bot: -0.28, n: 4.5 },
    { z: 1.8, w: 0.35, top: 0.27, bot: -0.26, n: 4 }, { z: 2.0, w: 0.27, top: 0.12, bot: -0.22, n: 3.2 }, { z: 2.11, w: 0.15, top: 0.0, bot: -0.15, n: 2.4 }], M.paint);
  // black hood blade + intake slats
  loft([{ z: 0.86, w: 0.13, top: 0.445, bot: 0.3, n: 6 }, { z: 1.12, w: 0.13, top: 0.468, bot: 0.3, n: 6 }, { z: 1.5, w: 0.11, top: 0.405, bot: 0.3, n: 6 }, { z: 1.82, w: 0.08, top: 0.272, bot: 0.2, n: 6 }], M.paint2);
  for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.2, 0.012, 0.035), M.black, buggy, 0, 0.462 - i * 0.012, 1.0 + i * 0.09).rotation.x = 0.25;
  // wind deflector
  const glass = new THREE.MeshPhysicalMaterial({ name: 'deflector glass', color: 0x223040, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.38, side: THREE.DoubleSide });
  const defl = add(new THREE.CylinderGeometry(0.75, 0.75, 0.2, 24, 1, true, -0.55, 1.1), glass, buggy, 0, 0.45, 0.12); defl.rotation.x = -0.1; defl.castShadow = false;
  // number plate texture
  const numTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
    g.fillStyle = '#f6f4ee'; g.beginPath(); g.arc(128, 128, 122, 0, TAU); g.fill(); g.lineWidth = 10; g.strokeStyle = '#17191c'; g.stroke();
    g.fillStyle = '#17191c'; g.font = 'italic 900 150px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('27', 122, 136);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; })();
  const numMat = new THREE.MeshStandardMaterial({ map: numTex, transparent: true, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2 });
  const netTex = canvasTex(64, (x, y) => ((x * 8) % 1 < 0.16 || (y * 8) % 1 < 0.16) ? 1 : 0, false);
  netTex.repeat.set(1.5, 1.2);
  const netMat = new THREE.MeshStandardMaterial({ color: 0x111111, alphaMap: netTex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 });
  for (const s of [1, -1]) {
    // side pods / doors with a gentle bulge
    loft([{ z: -0.77, w: 0.035, top: 0.26, bot: -0.29, n: 3, x: s * 0.665 }, { z: -0.35, w: 0.075, top: 0.275, bot: -0.3, n: 3, x: s * 0.67 },
      { z: 0.35, w: 0.075, top: 0.27, bot: -0.3, n: 3, x: s * 0.67 }, { z: 0.87, w: 0.035, top: 0.21, bot: -0.29, n: 3, x: s * 0.655 }], M.paint);
    loft([{ z: -0.76, w: 0.04, top: -0.2, bot: -0.31, n: 3, x: s * 0.675 }, { z: 0.05, w: 0.085, top: -0.2, bot: -0.32, n: 3, x: s * 0.675 }, { z: 0.86, w: 0.04, top: -0.2, bot: -0.31, n: 3, x: s * 0.665 }], M.paint2); // rocker
    const plate = add(new THREE.PlaneGeometry(0.4, 0.4), numMat, buggy, s * 0.748, 0.03, 0.0); plate.rotation.y = s * Math.PI / 2;
    const net = add(new THREE.PlaneGeometry(0.85, 0.72), netMat, buggy, s * 0.61, 0.68, -0.3); net.rotation.y = s * Math.PI / 2; net.rotation.z = 0; net.castShadow = false;
    // rally lamps on the bumper hoop
    const pod = add(new THREE.CylinderGeometry(0.085, 0.07, 0.09, 20), M.black, buggy, s * 0.26, 0.24, 2.0); pod.rotation.x = Math.PI / 2;
    const lens = add(new THREE.CylinderGeometry(0.074, 0.074, 0.012, 20), M.lamp, buggy, s * 0.26, 0.24, 2.048); lens.rotation.x = Math.PI / 2;
    add(new THREE.CylinderGeometry(0.012, 0.012, 0.1, 6), M.steel, buggy, s * 0.26, 0.17, 1.99);
    rbox(0.1, 0.06, 0.03, 0.01, M.tail, s * 0.36, 0.2, -2.0);                                   // tail lights
    // mirrors
    tubePath([[s * 0.57, 0.72, 0.52], [s * 0.72, 0.76, 0.56]], 0.009, M.black);
    rbox(0.03, 0.09, 0.13, 0.012, M.black, s * 0.745, 0.77, 0.57);
    // mud flaps
    add(new THREE.BoxGeometry(0.34, 0.3, 0.012), M.black, buggy, s * 0.82, -0.2, -1.86);
    tubePath([[s * 0.5, -0.06, -1.84], [s * 0.98, -0.06, -1.86]], 0.012, M.tube);
  }
  // rear deck over the drivetrain, roof skin
  loft([{ z: -1.5, w: 0.4, top: 0.6, bot: 0.545, n: 5 }, { z: -1.2, w: 0.5, top: 0.7, bot: 0.61, n: 5 }, { z: -0.84, w: 0.52, top: 0.68, bot: 0.6, n: 5 }], M.paint);
  loft([{ z: -1.35, w: 0.13, top: 0.78, bot: 0.66, n: 3 }, { z: -1.0, w: 0.16, top: 0.8, bot: 0.66, n: 3 }, { z: -0.86, w: 0.17, top: 0.79, bot: 0.66, n: 3 }], M.paint2);   // air scoop
  const roof = rbox(1.0, 0.022, 0.96, 0.008, M.paint, 0, 1.205, -0.33); roof.rotation.x = 0.04;
  const roofNum = add(new THREE.PlaneGeometry(0.5, 0.5), numMat, buggy, 0, 1.222, -0.33); roofNum.rotation.x = -Math.PI / 2 + 0.04; roofNum.rotation.z = Math.PI;
  // fuel cell, fire extinguisher, shifter, pedals
  rbox(0.72, 0.3, 0.22, 0.03, M.alu, 0, -0.1, -0.93);
  add(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 14), M.red, buggy, -0.2, 0.065, -0.93);
  const ext = add(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 14), M.red, buggy, 0, -0.2, 0.25); ext.rotation.x = Math.PI / 2;
  add(new THREE.CylinderGeometry(0.02, 0.03, 0.05, 10), M.black, buggy, 0, -0.2, 0.42).rotation.x = Math.PI / 2;
  const shifter = add(new THREE.CylinderGeometry(0.009, 0.009, 0.3, 8), M.steel, buggy, 0.03, -0.08, -0.15); shifter.rotation.x = 0.25;
  add(new THREE.SphereGeometry(0.03, 12, 10), M.black, buggy, 0.03, 0.07, -0.11);
  for (const [x, hgt] of [[0.38, 0.12], [0.27, 0.12], [0.16, 0.16]]) { const pd = add(new THREE.BoxGeometry(0.06, hgt, 0.012), M.alu, buggy, x, -0.14, 0.98); pd.rotation.x = -0.5; }
  // dash + gauges
  rbox(1.05, 0.2, 0.1, 0.03, M.black, 0, 0.34, 0.66);
  const gaugeTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.fillStyle = '#0a0a0a'; g.fillRect(0, 0, 64, 64);
    g.strokeStyle = '#e8f0ff'; g.lineWidth = 2; for (let i = 0; i < 9; i++) { const a = 2.2 + i * 0.6; g.beginPath(); g.moveTo(32 + Math.cos(a) * 22, 32 + Math.sin(a) * 22); g.lineTo(32 + Math.cos(a) * 28, 32 + Math.sin(a) * 28); g.stroke(); }
    g.strokeStyle = '#ff5a00'; g.lineWidth = 3; g.beginPath(); g.moveTo(32, 32); g.lineTo(46, 18); g.stroke(); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const gaugeMat = new THREE.MeshStandardMaterial({ map: gaugeTex, emissive: 0xffffff, emissiveMap: gaugeTex, emissiveIntensity: 0.7 });
  for (const [x, r] of [[0.19, 0.045], [0.35, 0.045], [0.27, 0.03], [-0.2, 0.035]]) {
    const g = add(new THREE.CylinderGeometry(r, r, 0.012, 20), [M.black, gaugeMat, M.black], buggy, x, 0.37, 0.607); g.rotation.x = -Math.PI / 2;
    const bez = add(new THREE.TorusGeometry(r, 0.006, 6, 20), M.alu, buggy, x, 0.37, 0.6); bez.rotation.x = 0;
  }
  // seats (two racing buckets)
  for (const s of [1, -1]) {
    const back = rbox(0.44, 0.72, 0.09, 0.04, M.seat, s * 0.27, 0.22, -0.62); back.rotation.x = -0.18;
    rbox(0.44, 0.09, 0.48, 0.04, M.seat, s * 0.27, -0.2, -0.32);
    for (const b of [1, -1]) { const w = rbox(0.06, 0.55, 0.16, 0.03, M.seat, s * 0.27 + b * 0.22, 0.12, -0.55); w.rotation.x = -0.18; }
    const head = rbox(0.24, 0.16, 0.08, 0.04, M.seat, s * 0.27, 0.66, -0.71); head.rotation.x = -0.18;
  }
  // roof light bar
  rbox(0.92, 0.09, 0.1, 0.02, M.black, 0, 1.25, 0.13);
  for (const x of [-0.33, -0.11, 0.11, 0.33]) { const l = add(new THREE.CylinderGeometry(0.04, 0.04, 0.02, 16), M.lamp, buggy, x, 1.25, 0.19); l.rotation.x = Math.PI / 2; }

  /* ---------- engine bay (rear, exposed) ---------- */
  const eng = new THREE.Group(); eng.position.set(0, 0.02, -1.62); buggy.add(eng); rig.engine = eng;
  add(new RoundedBoxGeometry(0.42, 0.3, 0.42, 3, 0.04), M.alu, eng);
  for (const s of [1, -1]) {
    const head = add(new THREE.BoxGeometry(0.16, 0.22, 0.38), M.darkMetal, eng, s * 0.29, 0, 0);
    for (let i = 0; i < 5; i++) add(new THREE.BoxGeometry(0.012, 0.26, 0.4), M.darkMetal, eng, s * (0.23 + i * 0.03), 0, 0);
    add(new THREE.BoxGeometry(0.05, 0.16, 0.34), M.red, eng, s * 0.39, 0.01, 0);   // valve covers
  }
  add(new THREE.BoxGeometry(0.34, 0.24, 0.3), M.darkMetal, buggy, 0, -0.12, -1.3);   // transaxle
  const filt = add(new THREE.CylinderGeometry(0.11, 0.11, 0.16, 20), M.red, buggy, 0, 0.32, -1.55);
  add(new THREE.CylinderGeometry(0.115, 0.115, 0.02, 20), M.alu, buggy, 0, 0.41, -1.55);
  add(new THREE.CylinderGeometry(0.04, 0.04, 0.12, 12), M.alu, buggy, 0, 0.21, -1.58);
  add(new THREE.BoxGeometry(0.66, 0.36, 0.05), M.darkMetal, buggy, 0, 0.36, -0.9);              // radiator core
  add(new THREE.BoxGeometry(0.7, 0.03, 0.07), M.alu, buggy, 0, 0.55, -0.9); add(new THREE.BoxGeometry(0.7, 0.03, 0.07), M.alu, buggy, 0, 0.17, -0.9);
  const fan = add(new THREE.TorusGeometry(0.15, 0.014, 6, 22), M.black, buggy, 0, 0.36, -0.94);
  rig.fan = new THREE.Group(); rig.fan.position.set(0, 0.36, -0.945); buggy.add(rig.fan);
  for (let i = 0; i < 6; i++) { const bl = add(new THREE.BoxGeometry(0.05, 0.13, 0.006), M.black, rig.fan, Math.sin(i / 6 * TAU) * 0.075, Math.cos(i / 6 * TAU) * 0.075, 0); bl.rotation.z = -i / 6 * TAU; bl.rotation.y = 0.5; }
  // exhaust headers → muffler (left rear), with flame at the tip
  for (const s of [1, -1]) tubePath([[s * 0.36, -0.08, -1.55], [s * 0.4, -0.2, -1.75], [s * 0.25, -0.2, -1.9], [-0.18, 0.05, -1.92], [-0.28, 0.22, -1.86]], 0.022, M.exhaust);
  const muff = add(new THREE.CylinderGeometry(0.075, 0.075, 0.34, 20), M.steel, buggy, -0.3, 0.3, -1.95); muff.rotation.x = Math.PI / 2;
  const tip = add(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 14), M.darkMetal, buggy, -0.3, 0.3, -2.17); tip.rotation.x = Math.PI / 2;
  const flame = add(new THREE.ConeGeometry(0.07, 0.4, 12, 1, true), M.flame, buggy, -0.3, 0.3, -2.42); flame.rotation.x = -Math.PI / 2;
  rig.flame = flame;

  /* ---------- driver ---------- */
  const drv = new THREE.Group(); drv.position.set(0.27, 0, 0); buggy.add(drv);
  const torso = add(new THREE.CapsuleGeometry(0.16, 0.3, 6, 14), M.suit, drv, 0, 0.18, -0.5); torso.rotation.x = -0.18; torso.scale.set(1.1, 1, 0.75);
  add(new THREE.TorusGeometry(0.1, 0.035, 8, 16), M.black, drv, 0, 0.5, -0.52).rotation.x = Math.PI / 2;   // neck brace
  const headG = new THREE.Group(); headG.position.set(0, 0.6, -0.52); drv.add(headG); rig.head = headG;
  add(new THREE.SphereGeometry(0.145, 24, 18), M.helmet, headG, 0, 0.06, 0);
  const visor = add(new THREE.SphereGeometry(0.148, 24, 12, 0.67, 1.8, 1.0, 0.6), M.visor, headG, 0, 0.06, 0); visor.rotation.y = 0;
  rbox(0.2, 0.07, 0.12, 0.03, M.helmet, 0, -0.02, 0.1, headG);                          // chin bar
  const peak = rbox(0.2, 0.012, 0.14, 0.005, M.paint2, 0, 0.16, 0.14, headG); peak.rotation.x = 0.25;   // motocross peak
  add(new THREE.TorusGeometry(0.147, 0.012, 6, 28), M.black, headG, 0, 0.07, 0).rotation.x = Math.PI / 2;  // goggle strap
  const stripe = add(new THREE.TorusGeometry(0.146, 0.012, 6, 28, Math.PI), M.paint, headG, 0, 0.06, 0); stripe.rotation.y = Math.PI / 2;
  for (const s of [1, -1]) add(new THREE.SphereGeometry(0.075, 12, 10), M.suit, drv, s * 0.17, 0.4, -0.5);   // shoulders
  for (const s of [1, -1]) {
    tubePath([[s * 0.11, 0.38, -0.49], [s * 0.2, 0.22, -0.28], [s * 0.15, 0.4, 0.2]], 0.045, M.suit, drv);   // arms to wheel
    add(new THREE.SphereGeometry(0.045, 10, 8), M.glove, drv, s * 0.15, 0.4, 0.22);
    tubePath([[s * 0.1, -0.12, -0.3], [s * 0.12, 0.05, 0.25], [s * 0.1, -0.12, 0.85]], 0.06, M.suit, drv);  // legs
    add(new THREE.BoxGeometry(0.035, 0.5, 0.012), M.red, drv, s * 0.08, 0.2, -0.4).rotation.x = -0.18;     // harness
  }
  // steering column + wheel
  const col0 = V3(0.27, 0.12, 0.72), col1 = V3(0.27, 0.41, 0.3);
  tubePath([col0.toArray(), col1.toArray()], 0.02, M.steel);
  const sw = new THREE.Group(); sw.position.copy(col1); sw.quaternion.setFromUnitVectors(V3(0, 0, 1), col0.clone().sub(col1).normalize()); buggy.add(sw);
  const swSpin = new THREE.Group(); sw.add(swSpin); rig.steeringWheel = swSpin;
  add(new THREE.TorusGeometry(0.16, 0.018, 8, 28), M.black, swSpin);
  for (const a of [0, 2.1, -2.1]) { const sp = add(new THREE.BoxGeometry(0.02, 0.15, 0.01), M.alu, swSpin, Math.sin(a) * 0.075, Math.cos(a) * 0.075, 0); sp.rotation.z = -a; }

  /* ---------- whip flag ---------- */
  const pole = new THREE.Group(); pole.position.set(-0.5, 0.58, -1.42); buggy.add(pole); rig.pole.g = pole;
  add(new THREE.CylinderGeometry(0.006, 0.01, 2.3, 6), M.black, pole, 0, 1.15, 0);
  const flagG = new THREE.Group(); flagG.position.y = 2.22; pole.add(flagG); rig.flagG = flagG;
  const fg = new THREE.PlaneGeometry(0.5, 0.3, 10, 3); fg.translate(-0.25, -0.15, 0); fg.rotateY(-Math.PI / 2);   // extends toward -z
  const fp = fg.attributes.position;
  for (let i = 0; i < fp.count; i++) { const u = -fp.getZ(i) / 0.5; fp.setY(i, -0.15 + (fp.getY(i) + 0.15) * (1 - u)); }
  rig.flagBase = Float32Array.from(fp.array);
  rig.flag = add(fg, M.flag, flagG);

  /* ---------- wheels & suspension ---------- */
  function tireGeometry(R, w, rr) {
    const pts = [], h = w / 2;
    pts.push(new THREE.Vector2(rr, -h + 0.01));
    for (let i = 0; i <= 6; i++) { const a = i / 6 * Math.PI / 2; pts.push(new THREE.Vector2(R - 0.07 + Math.sin(a) * 0.07, -h + 0.07 - Math.cos(a) * 0.07 - 0.005)); }
    for (let i = 0; i <= 6; i++) { const a = i / 6 * Math.PI / 2; pts.push(new THREE.Vector2(R - 0.07 + Math.cos(a) * 0.07, h - 0.07 + Math.sin(a) * 0.07 + 0.005)); }
    pts.push(new THREE.Vector2(rr, h - 0.01));
    const g = new THREE.LatheGeometry(pts, 48);
    g.rotateZ(Math.PI / 2);
    return g;
  }
  const helix = (() => {   // unit-length spring along +y
    const pts = []; for (let i = 0; i <= 160; i++) { const a = i / 160 * 7 * TAU; pts.push(V3(Math.cos(a) * 0.05, i / 160, Math.sin(a) * 0.05)); }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 320, 0.009, 6, false);
  })();
  class Link {
    constructor(r, mat) { this.m = add(new THREE.CylinderGeometry(r, r, 1, 8), mat); rig.links.push(this); }
    set(a, b) { this.m.position.copy(a).add(b).multiplyScalar(0.5); this.m.quaternion.setFromUnitVectors(Y_AXIS, v1.subVectors(b, a).normalize()); this.m.scale.set(1, a.distanceTo(b), 1); }
  }
  class Coilover {
    constructor() {
      this.g = new THREE.Group(); buggy.add(this.g);
      this.spring = add(helix, M.red, this.g);
      this.body = add(new THREE.CylinderGeometry(0.03, 0.03, 0.24, 12), M.alu, this.g);
      this.shaft = add(new THREE.CylinderGeometry(0.012, 0.012, 1, 8), M.steel, this.g);
      this.res = add(new THREE.CylinderGeometry(0.025, 0.025, 0.14, 10), M.red, this.g);
    }
    set(bottom, top) {
      const len = bottom.distanceTo(top);
      this.g.position.copy(bottom); this.g.quaternion.setFromUnitVectors(Y_AXIS, v1.subVectors(top, bottom).normalize());
      this.spring.scale.set(1, len * 0.8, 1); this.spring.position.y = len * 0.12;
      this.body.position.y = len - 0.12; this.shaft.scale.y = len * 0.6; this.shaft.position.y = len * 0.3;
      this.res.position.set(0.05, len - 0.1, 0);
    }
  }
  const RR = 0.24;
  const rimGeo = (() => {     // five-spoke centre
    const sh = new THREE.Shape(); sh.absarc(0, 0, RR - 0.012, 0, TAU, false);
    for (let i = 0; i < 5; i++) {
      const a0 = i / 5 * TAU + 0.17, a1 = (i + 1) / 5 * TAU - 0.17, h = new THREE.Path();
      h.absarc(0, 0, 0.19, a0, a1, false); h.absarc(0, 0, 0.085, a1 - 0.16, a0 + 0.16, true); h.closePath(); sh.holes.push(h);
    }
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.02, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 1, curveSegments: 10 });
    g.translate(0, 0, -0.01); g.rotateY(Math.PI / 2); return g;
  })();
  const fenderMat = M.paint.clone(); fenderMat.side = THREE.DoubleSide;
  const placed = (g, x, y, z, rx = 0, ry = 0) => { g.rotateY(ry); g.rotateX(rx); g.translate(x, y, z); return g; };
  for (const w of car.wheels) {
    const s = Math.sign(w.hp.x), front = w.front;
    const R = front ? 0.405 : 0.395, wid = front ? 0.25 : 0.36, rr = RR;
    const holder = new THREE.Group(), spinner = new THREE.Group();
    const rubber = [tireGeometry(R, wid, rr)];
    if (front) {                      // ribbed sand front
      for (const x of [-0.07, 0, 0.07]) rubber.push(placed(new THREE.TorusGeometry(R + 0.002, 0.015, 6, 48), x, 0, 0, 0, Math.PI / 2));
    } else {                          // paddle rear: scooped paddles
      for (let i = 0; i < 12; i++) {
        const a = i / 12 * TAU;
        for (const [dx, yaw] of [[-wid * 0.23, 0.32], [wid * 0.23, -0.32]])
          rubber.push(placed(placed(new THREE.BoxGeometry(wid * 0.5, 0.06, 0.026), dx, R + 0.014, 0, 0, yaw), 0, 0, 0, a));
      }
    }
    for (let i = 0; i < 26; i++) {    // shoulder knobs on both sidewalls
      const a = (i + 0.5) / 26 * TAU;
      for (const sx of [1, -1]) rubber.push(placed(placed(new THREE.BoxGeometry(0.03, 0.05, 0.04), sx * (wid / 2 - 0.012), R - 0.05, 0), 0, 0, 0, a));
    }
    add(mergeGeometries(rubber.map(g => g.index ? g.toNonIndexed() : g)), M.rubber, spinner);
    // beadlock rim with five-spoke centre
    const barrel = add(new THREE.CylinderGeometry(rr, rr, wid - 0.02, 28, 1, true), M.darkMetal, spinner); barrel.rotation.z = Math.PI / 2; barrel.material = M.barrel || (M.barrel = Object.assign(M.darkMetal.clone(), { side: THREE.DoubleSide }));
    for (const sx of [1, -1]) { const ring = add(new THREE.TorusGeometry(rr + 0.012, 0.016, 8, 32), sx === s ? M.red : M.alu, spinner, sx * (wid / 2 - 0.005), 0, 0); ring.rotation.y = Math.PI / 2; }
    const bolts = []; for (let i = 0; i < 16; i++) { const a = i / 16 * TAU; bolts.push(placed(placed(new THREE.CylinderGeometry(0.008, 0.008, 0.02, 6).rotateZ(Math.PI / 2), s * (wid / 2 + 0.008), rr + 0.012, 0), 0, 0, 0, a)); }
    add(mergeGeometries(bolts), M.steel, spinner);
    add(rimGeo, M.alu, spinner, s * (wid / 2 - 0.055), 0, 0);
    const cap = add(new THREE.CylinderGeometry(0.045, 0.06, 0.05, 16), M.red, spinner, s * (wid / 2 - 0.03), 0, 0); cap.rotation.z = Math.PI / 2;
    const lugs = []; for (let i = 0; i < 5; i++) { const a = i / 5 * TAU; lugs.push(placed(placed(new THREE.CylinderGeometry(0.011, 0.011, 0.03, 6).rotateZ(Math.PI / 2), s * (wid / 2 - 0.035), 0.062, 0), 0, 0, 0, a)); }
    add(mergeGeometries(lugs), M.steel, spinner);
    // fender riding with the wheel
    const fg2 = new THREE.CylinderGeometry(R + 0.085, R + 0.085, wid + 0.07, 22, 1, true, 0.5, front ? 1.75 : 2.0); fg2.rotateZ(Math.PI / 2);
    add(fg2, fenderMat, holder);
    // non-spinning: brake disc, caliper, upright
    const rotor = add(new THREE.CylinderGeometry(0.15, 0.15, 0.012, 24), M.steel, holder, -s * 0.06, 0, 0); rotor.rotation.z = Math.PI / 2;
    add(new THREE.BoxGeometry(0.045, 0.1, 0.07), M.red, holder, -s * 0.07, 0.11, -0.08);
    add(new THREE.BoxGeometry(0.05, 0.3, 0.1), M.darkMetal, holder, -s * (wid / 2 + 0.035), 0, 0);
    holder.add(spinner); buggy.add(holder);
    w.holder = holder; w.spinner = spinner; w.vis = { s, wid };
    holder.userData.sbWheel = car.wheels.indexOf(w); spinner.userData.sbSpin = car.wheels.indexOf(w);
    // suspension links
    const sus = w.vis.sus = { coil: new Coilover() };
    if (front) {
      sus.upperA = new Link(0.017, M.tube); sus.upperB = new Link(0.017, M.tube);
      sus.lowerA = new Link(0.02, M.tube); sus.lowerB = new Link(0.02, M.tube);
      sus.tie = new Link(0.011, M.steel);
    } else {
      sus.trail = new Link(0.026, M.tube); sus.lower = new Link(0.018, M.tube); sus.axle = new Link(0.022, M.steel);
    }
  }
  buggy.traverse(o => { if (o.isMesh && o.material !== M.flame) { o.castShadow = true; o.receiveShadow = true; } });
}
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const sa = new THREE.Vector3(), sb = new THREE.Vector3(), sc = new THREE.Vector3(), hubV = new THREE.Vector3();

function updateRig(dt) {
  rig.time += dt;
  if (VEH !== BUGGY) { updateCarRig(dt); return; }
  for (const w of car.wheels) {
    const { s, wid, sus } = w.vis, hub = hubV.copy(w.holder.position), z = w.hp.z;
    const inX = hub.x - s * (wid / 2 + 0.035);
    if (w.front) {
      const ub = sc.set(inX, hub.y + 0.13, z);
      sus.upperA.set(sa.set(s * 0.4, 0.2, z + 0.17), ub); sus.upperB.set(sa.set(s * 0.4, 0.2, z - 0.15), ub);
      const lb = sc.set(inX, hub.y - 0.13, z);
      sus.lowerA.set(sa.set(s * 0.34, -0.27, z + 0.2), lb); sus.lowerB.set(sa.set(s * 0.34, -0.27, z - 0.2), lb);
      sb.set(lerp(s * 0.34, inX, 0.72), lerp(-0.27, hub.y - 0.13, 0.72), z);
      sus.coil.set(sb, sa.set(s * 0.42, 0.42, z - 0.02));
      sus.tie.set(sa.set(s * 0.22, -0.08, z + 0.14), sc.set(inX + Math.sin(car.steer) * 0.12, hub.y - 0.02, z + 0.14 * Math.cos(car.steer)));
    } else {
      sus.trail.set(sa.set(s * 0.6, -0.12, -0.55), sc.set(inX, hub.y + 0.02, z));
      sus.lower.set(sa.set(s * 0.42, -0.28, z - 0.05), sc.set(inX, hub.y - 0.12, z));
      sus.axle.set(sa.set(s * 0.17, -0.12, -1.3), sc.set(inX, hub.y, z));
      sus.coil.set(sb.set(inX + s * 0.01, hub.y + 0.06, z - 0.1), sa.set(s * 0.5, 0.58, -1.4));
    }
  }
  rig.steeringWheel.rotation.z = -car.steer * 6;
  rig.fan.rotation.z -= dt * 40;
  rig.M.tail.emissiveIntensity = input.brake > 0 && car.vel.dot(fwd) > 0.5 ? 3.5 : 0.35;
  // engine shake
  const e = car.eng;
  rig.engine.position.x = Math.sin(rig.time * e.rpm * 0.21) * 0.003 * (0.4 + e.load);
  rig.engine.rotation.z = Math.sin(rig.time * e.rpm * 0.105) * 0.006 * (0.4 + e.load);
  // exhaust flame from overrun pops
  rig.flameT = Math.max(0, rig.flameT - dt);
  rig.M.flame.opacity = rig.flameT > 0 ? 0.9 * rig.flameT / 0.09 : 0;
  rig.flame.scale.set(1, 0.6 + Math.random() * 0.8, 1);
  // body-frame acceleration for flag & driver
  if (dt > 0) { rig.acc.subVectors(car.vel, rig.prevVel).divideScalar(dt); rig.prevVel.copy(car.vel); }
  qInv.copy(car.q).invert();
  const aL = v2.copy(rig.acc).applyQuaternion(qInv);
  const P = rig.pole;
  const k = 40, c = 3.5;
  P.vx += (-k * P.ax - c * P.vx - clamp(aL.z, -30, 30) * 0.35) * dt; P.ax += P.vx * dt;   // fore/aft sway
  P.vz += (-k * P.az - c * P.vz + clamp(aL.x, -30, 30) * 0.35) * dt; P.az += P.vz * dt;   // side sway
  P.g.rotation.set(clamp(P.ax, -0.6, 0.6), 0, clamp(P.az, -0.6, 0.6));
  // flag trails in the apparent wind
  const aw = v3.copy(wind).sub(car.vel).applyQuaternion(qInv);
  if (aw.x * aw.x + aw.z * aw.z > 0.5) rig.flagG.rotation.y = Math.atan2(-aw.x, -aw.z);
  const sp = Math.hypot(aw.x, aw.z), fp = rig.flag.geometry.attributes.position, base = rig.flagBase;
  for (let i = 0; i < fp.count; i++) {
    const u = -base[i * 3 + 2] / 0.5;
    fp.array[i * 3] = base[i * 3] + Math.sin(u * 7 - rig.time * (6 + sp * 0.8)) * 0.045 * u * (0.4 + Math.min(sp, 20) / 20);
  }
  fp.needsUpdate = true; rig.flag.geometry.computeVertexNormals();
  rig.head.rotation.z = clamp(-aL.x * 0.012, -0.25, 0.25);
  rig.head.rotation.x = clamp(-aL.z * 0.01, -0.2, 0.2);
}

/* =====================================================================
   VEHICLE PHYSICS (fixed 240 Hz)
   Raycast suspension + multi-point wheel contact, Bekker-style sinkage,
   compaction resistance, Mohr-Coulomb traction with Janosi-style slip curve,
   slip-driven excavation.
   ===================================================================== */
const DT = 1 / 240;
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), v4 = new THREE.Vector3();
const up = new THREE.Vector3(), fwd = new THREE.Vector3(), down = new THREE.Vector3();
const F = new THREE.Vector3(), T = new THREE.Vector3(), hp = new THREE.Vector3(), cen = new THREE.Vector3();
const nrm = new THREE.Vector3(), tn = new THREE.Vector3(), wf = new THREE.Vector3(), side = new THREE.Vector3(), vp = new THREE.Vector3(), rel = new THREE.Vector3();
const qInv = new THREE.Quaternion(), qw = new THREE.Quaternion();
const SAMPLES = [-0.75, -0.4, 0, 0.4, 0.75];
const input = { throttle: 0, brake: 0, steer: 0, handbrake: false };

function addForceAt(force, point) { F.add(force); rel.subVectors(point, car.pos); T.add(v4.crossVectors(rel, force)); }

function stepCar(dt) {
  const q = car.q, P = PRESSURES[car.pIdx], R = car.R - P.defl;
  up.set(0, 1, 0).applyQuaternion(q); fwd.set(0, 0, 1).applyQuaternion(q); down.copy(up).negate();
  F.set(0, -G * car.mass, 0); T.set(0, 0, 0);

  // drivetrain
  const vLongBody = car.vel.dot(fwd);
  const driven = car.wheels.filter(w => car.awd || !w.front);
  // all-wheel drive split other than evenly (car.split: the front's share), as a centre differential's
  const nF = driven.filter(w => w.front).length, nR = driven.length - nF, fs = car.awd && car.split !== 0.5 && nF && nR ? car.split : null;
  const wAvg = fs == null ? driven.reduce((s, w) => s + w.omega, 0) / driven.length
    : fs * driven.reduce((s, w) => s + (w.front ? w.omega : 0), 0) / nF + (1 - fs) * driven.reduce((s, w) => s + (w.front ? 0 : w.omega), 0) / nR;
  let driveT = 0, brakeT = 0;
  const E = car.eng;
  E.reverse = input.brake > 0 && input.throttle === 0 && vLongBody < 1.2;
  if (input.brake > 0 && !E.reverse) brakeT = VEH.brake * input.brake;
  const power = E.reverse ? car.throttle * 0.7 : (input.throttle > 0 ? car.throttle : 0);
  const ratio = (E.reverse ? -ENG.rev : ENG.gears[E.gear - 1]) * ENG.fd;
  const wheelRpm = Math.max(0, wAvg * ratio * 60 / TAU);
  // centrifugal clutch / converter: engine can run above wheel speed while slipping
  const stall = lerp(ENG.idle, ENG.stall, power);
  const target = Math.max(wheelRpm, stall);
  E.rpm += (target - E.rpm) * Math.min(1, dt * (target > E.rpm ? 14 : 9));
  E.rpm = Math.min(E.rpm, ENG.limiter + 150);
  if (E.rpm > ENG.limiter) E.cut = true; else if (E.rpm < ENG.limiter - 250) E.cut = false;
  if (E.reverse && wheelRpm > 4800) E.cut = true;
  E.shiftT = Math.max(0, E.shiftT - dt);
  const on = !E.cut && E.shiftT <= 0;
  const slipMult = 1 + 0.3 * clamp(1 - wheelRpm / Math.max(E.rpm, 1), 0, 1);
  // road cars: traction control trims engine torque while the driven wheels spin up (X turns the aids off)
  let tc = 1;
  if (VEH.aids && car.aids) {
    let ms = 0, rig = false; for (const w of driven) if (w.contact) { ms = Math.max(ms, w.sx || 0); rig ||= !!w.surf?.rigid; }
    const thr = rig ? Math.max(0.12 * Math.abs(vLongBody), 0.6) : Math.max(0.15 * Math.abs(vLongBody), 0.9);   // allowed wheelspin (m/s)
    const want = clamp(1 - Math.max(0, ms - thr) * 0.5, 0.1, 1);
    E.tc = clamp((E.tc ?? 1) + (want - (E.tc ?? 1)) * Math.min(1, dt * (want < (E.tc ?? 1) ? 25 : 6)), 0.1, 1); tc = E.tc;
  } else E.tc = 1;
  const Te = on ? engineTorque(E.rpm) * power * damagePower() * tc : 0;
  E.load = on ? power * tc : 0;
  driveT = Te * ratio * ENG.eff * slipMult;
  if (power < 0.05 && wheelRpm > ENG.idle * 1.3) brakeT += (12 + E.rpm * 0.005) * Math.abs(ratio);   // engine braking
  // shift on ground speed (not wheel speed) so wheelspin doesn't make the box hunt
  E.sinceShift = (E.sinceShift || 0) + dt;
  const groundRpm = Math.max(0, vLongBody) / R * ratio * 60 / TAU;
  if (!E.reverse && E.sinceShift > 0.7) {
    const upAt = lerp(ENG.upLo, ENG.upHi, power), dnAt = lerp(ENG.dnLo, ENG.dnHi, power), fast = ENG.gears.length > 5;
    if (E.gear < ENG.gears.length && E.rpm > upAt && groundRpm > (ENG.upGround || upAt * 0.82)) { E.gear++; E.shiftT = fast ? 0.1 : 0.18; E.sinceShift = 0; }
    else if (E.gear > 1 && groundRpm < dnAt && E.rpm < ENG.upHi - 2000) { E.gear--; E.shiftT = fast ? 0.08 : 0.12; E.sinceShift = 0; }
  }

  for (const W of car.wheels) {
    hp.copy(W.hp).applyQuaternion(q).add(car.pos);
    const wAng = (W.front ? car.steer : 0) + W.toe;
    wf.set(Math.sin(wAng), 0, Math.cos(wAng)).applyQuaternion(q);
    // horizontal heading for ground sampling
    v1.set(wf.x, 0, wf.z); if (v1.lengthSq() < 1e-6) v1.set(0, 0, 1); v1.normalize();
    // solve suspension length so the wheel circle just touches the ground profile
    let t = car.REST, pen = 0, bestS = 0, bestG = 0, bestDeck = false;
    for (let it = 0; it < 4; it++) {
      cen.copy(hp).addScaledVector(down, t);
      pen = -Infinity;
      for (const s of SAMPLES) {
        const dx = s * R, g = surfaceAt(cen.x + v1.x * dx, cen.z + v1.z * dx, cen.y);
        const p = g - (cen.y - Math.sqrt(R * R - dx * dx));
        if (p > pen) { pen = p; bestS = dx; bestG = g; bestDeck = surfDeck; }
      }
      if (it === 0 && pen < 0) break;
      t = clamp(t + pen / Math.min(down.y, -0.3), 0, car.REST);
    }
    cen.copy(hp).addScaledVector(down, t);
    W.t = t;
    const comp = car.REST - t, compVel = clamp((comp - W.comp) / dt, -6, 6); W.comp = comp;   // clamped: surface steps (bridge edge) would spike the damper
    const Pc = W.P.set(cen.x + v1.x * bestS, bestG, cen.z + v1.z * bestS);
    // past ~70° of roll or pitch the suspension can't carry the car: the tire sidewall / body contacts take over
    const tiltW = clamp((-down.y - 0.3) / 0.3, 0, 1);
    const touching = pen > -0.005 && t < car.REST && tiltW > 0;

    // drive/brake torque for this wheel
    let Td = (car.awd || !W.front) ? (fs == null ? driveT / driven.length : driveT * (W.front ? fs / nF : (1 - fs) / nR)) : 0;
    let Tb = brakeT * (W.front ? 0.6 : 0.4) * 2;
    if (input.handbrake && !W.front) Tb = 4000;

    if (!touching) {
      W.contact = false; W.load = 0; W.slipSpeed = 0; W.sink = 0; W.slip = 0; W.sx = 0; W.slide = 0;
      W.omega += Td / car.Iw * dt;
      applyBrake(W, Tb, dt);
      continue;
    }
    W.contact = true;

    // suspension (along body up) + bump stop when wheel is fully up and still penetrating
    let Fs = Math.max(0, car.K * comp + (compVel > 0 ? car.CB : car.CR) * compVel) * tiltW;
    const residual = Math.max(0, surfaceAt(cen.x, cen.z, cen.y) - (cen.y - R));
    if (t <= 0.001) {
      Fs += 160000 * residual * tiltW;
      if (!W.bottomed) { rel.subVectors(hp, car.pos); const vHub = -vp.crossVectors(car.w, rel).add(car.vel).dot(up); if (vHub > 3.2) wheelImpact(W, vHub); else if (vHub > 1.2 && car.grace <= 0) audio?.node.port.postMessage({ thump: vHub * 0.08 }); }   // real hub speed, not the (jumpy) travel rate
      W.bottomed = true;
    } else if (t > 0.05) W.bottomed = false;
    surfNormal(Pc.x, Pc.z, cen.y, tn);
    W.deck = bestDeck;
    // contact normal: from contact point toward wheel center, blended with terrain normal (lets ruts/walls push back)
    nrm.subVectors(cen, Pc).normalize().add(tn).normalize();
    const load = Fs * Math.max(0.2, up.dot(nrm));
    W.load = load;
    addForceAt(v2.copy(up).multiplyScalar(Fs), Pc);

    // tire frame on the ground plane
    wf.addScaledVector(nrm, -wf.dot(nrm)).normalize();
    side.crossVectors(wf, nrm);           // points to the car's left
    W.fwd.copy(wf);
    rel.subVectors(Pc, car.pos);
    vp.crossVectors(car.w, rel).add(car.vel);
    const vLong = vp.dot(wf), vLat = vp.dot(side);

    // ---- sand model ----
    const k0 = cellIndex(Pc.x, Pc.z);
    const c = bestDeck ? 1 : C[k0]; W.cUnder = c;
    const SF = surfAtCell(k0); W.surf = SF;
    const kEff = SF.k * (1 + SF.kComp * c);              // Pa/m, packed ground is much stiffer
    const pg = P.kpa * 1000 * 0.8 + 12000;                  // ground pressure ≈ inflation + carcass
    const b = P.w;
    const len = Math.min(load / pg / b, 0.3);                // contact length (capped → pressure rises with load)
    const pEff = load / (b * Math.max(len, 0.05));
    const sink = Math.min(pEff / kEff, 0.28);
    // fresh sand ahead of the tire determines compaction (rolling) resistance
    const dir = vLong >= 0 ? 1 : -1;
    const ka = cellIndex(Pc.x + v1.x * dir * (len / 2 + 0.2), Pc.z + v1.z * dir * (len / 2 + 0.2));
    const kAhead = SF.k * (1 + SF.kComp * C[ka]);
    const zAhead = Math.min(pEff / kAhead, 0.28);
    const fresh = bestDeck ? 0 : clamp(H[ka] - (B[ka] - zAhead), 0, zAhead);
    W.sink = bestDeck ? 0 : Math.max(0, B[k0] - heightAt(Pc.x, Pc.z));
    const Rc = SF.rc * b * kAhead * fresh * fresh * 0.5 + 0.02 * load + load * 0.6 * (W.sink / R) ** 2;

    // traction: Mohr-Coulomb peak, Janosi-like build-up with slip
    const tanPhi = bestDeck ? 0.85 : SF.tanPhi + SF.tanPhiComp * c;
    const Fmax = load * tanPhi + (bestDeck ? 0 : SF.coh) * b * Math.max(len, 0.15);
    const S0 = bestDeck ? 0.13 : SF.s0 ?? 0.13;
    let den = Math.max(Math.abs(W.omega * R), Math.abs(vLong), 1.5);
    let s = (W.omega * R - vLong) / den;
    let Fx = Math.sign(s) * Fmax * (1 - Math.exp(-Math.abs(s) / S0));
    W.omega = wheelSpin(W.omega, Td, vLong, R, Fmax, S0, dt);
    if (VEH.aids && car.aids && Tb > 0 && !(input.handbrake && !W.front) && Math.abs(vLong) > 2.5) {   // ABS: ease off before the wheel locks (inactive at walking pace)
      const lim = Math.max((SF.rigid ? 0.16 : 0.25) * Math.abs(vLong), 0.4), skid = -(W.sx || 0) * Math.sign(vLong);
      W.absF = clamp((W.absF ?? 1) + (skid > lim ? -40 : 20) * dt, 0.15, 1); Tb *= W.absF;
    } else W.absF = 1;
    applyBrake(W, Tb, dt);
    den = Math.max(Math.abs(W.omega * R), Math.abs(vLong), 1.5);
    s = (W.omega * R - vLong) / den;
    Fx = Math.sign(s) * Fmax * (1 - Math.exp(-Math.abs(s) / S0));
    const alpha = Math.atan2(vLat, Math.max(Math.abs(vLong), 1.5));
    const FyMax = Fmax * 0.92;
    let Fy = -Math.sign(alpha) * FyMax * (1 - Math.exp(-Math.abs(alpha) / (bestDeck ? 0.11 : SF.a0 ?? 0.11)));
    if (SF.slide && !bestDeck) { const sl = SF.slide * smooth(clamp((Math.max(Math.abs(s), Math.abs(alpha)) - 0.12) / 0.5, 0, 1)); Fx *= 1 - sl; Fy *= 1 - sl; }   // sliding rubber grips less than rolling
    const mag = Math.hypot(Fx, Fy);
    if (mag > Fmax) { Fx *= Fmax / mag; Fy *= Fmax / mag; }
    const Fr = Rc * Math.tanh(vLong / 0.4);
    addForceAt(v2.copy(wf).multiplyScalar(Fx - Fr).addScaledVector(side, Fy), Pc);

    W.slip = s; W.sx = W.omega * R - vLong; W.fx = Fx; W.fy = Fy; W.fm = Fmax; W.td = Td;
    W.slipSpeed = Math.abs(W.omega * R - vLong) + 0.6 * Math.abs(vLat);
    W.slide = Math.max(0, Math.hypot(W.omega * R - vLong, vLat) - 1 - 0.1 * Math.abs(vLong));   // past the creep of a gripping tire

    // ---- deform the ground ----
    const excess = Math.max(0, Math.abs(s) - 0.25) * Math.abs(W.omega * R - vLong) + 0.6 * Math.max(0, Math.abs(vLat) - 0.8);
    if (bestDeck || SF.rigid) continue;           // bridge deck / asphalt: rigid, nothing to deform
    const dig = excess > 0 ? SF.dig * excess * dt * Math.min(load / 2000, 2) * (1 - 0.5 * c) : 0;
    const halfL = Math.max(len, 0.22) / 2 + 0.05, halfW = b / 2;
    const r = pressFootprint(Pc.x, Pc.z, v1.x, v1.z, halfL, halfW, sink, dig);
    if (r.displaced > 0) {           // part of the compressed sand is pushed sideways into berms
      const sx = -v1.z, sz = v1.x, off = halfW + 0.16, amt = r.displaced * 0.2;
      deposit(Pc.x + sx * off, Pc.z + sz * off, amt, 0.3);
      deposit(Pc.x - sx * off, Pc.z - sz * off, amt, 0.3);
    }
    if (r.dug > 0) {                 // excavated sand is thrown behind the spinning tire
      const thr = Math.sign(W.omega * R - vLong) || 1;
      W.dug += r.dug;
      const dist = 0.9 + Math.min(W.slipSpeed * 0.08, 1.2);
      deposit(Pc.x - v1.x * thr * dist, Pc.z - v1.z * thr * dist, r.dug * 0.75, 0.55);
    }
  }

  // hull / roll cage contacts (beaching, rollovers)
  let hullTouch = 0;
  for (let hi = 0; hi < car.hull.length; hi++) {
    const hpt = car.hull[hi];
    hp.copy(hpt).applyQuaternion(q).add(car.pos);
    const g = surfaceAt(hp.x, hp.z, hp.y + 0.6), d = g - hp.y;
    if (d <= 0) { if (d < -0.03) car.hullC[hi] = 0; continue; }
    surfNormal(hp.x, hp.z, hp.y + 0.6, tn);
    rel.subVectors(hp, car.pos); vp.crossVectors(car.w, rel).add(car.vel);
    const vn = vp.dot(tn);
    if (!car.hullC[hi]) { car.hullC[hi] = 1; if (-vn > 2.5) crashImpact(hpt, -vn, tn); }   // frame / cage strikes the ground
    const Fn = Math.max(0, 90000 * d - 5000 * vn);
    v2.copy(tn).multiplyScalar(Fn);
    v3.copy(vp).addScaledVector(tn, -vn);
    const vt = v3.length();
    if (vt > 1e-4) v2.addScaledVector(v3, -Math.min(0.55 * Fn, vt * 4000) / vt);
    addForceAt(v2, hp); hullTouch++;
  }
  if (hullTouch) car.w.multiplyScalar(Math.max(0, 1 - Math.min(hullTouch, 4) * 1.5 * dt));   // body scraping over the ground scrubs off spin

  // aero drag
  const sp = car.vel.length();
  F.addScaledVector(car.vel, -0.5 * 1.2 * VEH.cda * sp);

  // limited-slip differentials
  lsd(car.wheels[0], car.wheels[1], dt); lsd(car.wheels[2], car.wheels[3], dt);

  // integrate
  car.vel.addScaledVector(F, dt / car.mass);
  car.pos.addScaledVector(car.vel, dt);
  qInv.copy(q).invert();
  const wb = v1.copy(car.w).applyQuaternion(qInv), tb = v2.copy(T).applyQuaternion(qInv);
  const Iw = v3.set(car.I.x * wb.x, car.I.y * wb.y, car.I.z * wb.z), gyro = v4.crossVectors(wb, Iw);
  wb.x += (tb.x - gyro.x) / car.I.x * dt; wb.y += (tb.y - gyro.y) / car.I.y * dt; wb.z += (tb.z - gyro.z) / car.I.z * dt;
  car.w.copy(wb).applyQuaternion(q).multiplyScalar(1 - 0.15 * dt);
  qw.set(car.w.x, car.w.y, car.w.z, 0).multiply(q);
  q.set(q.x + 0.5 * dt * qw.x, q.y + 0.5 * dt * qw.y, q.z + 0.5 * dt * qw.z, q.w + 0.5 * dt * qw.w).normalize();

  // keep inside the world
  const lim = HALF - 8;
  if (Math.abs(car.pos.x) > lim) { car.pos.x = Math.sign(car.pos.x) * lim; car.vel.x *= -0.2; }
  if (Math.abs(car.pos.z) > lim) { car.pos.z = Math.sign(car.pos.z) * lim; car.vel.z *= -0.2; }
  for (const W of car.wheels) W.spin += W.omega * dt;
}

// The wheel's spin at the end of a step (#327): w where Iw (w - w0) = dt (Td - R Fx(w)), Fx the tire's force at that spin.
// Iw w + dt R Fx(w) only grows with w, and Fx stays within ±Fmax, so the answer lies in [lo, hi] below: Newton's
// method from the start's spin, bisecting whenever a step would leave what is left of that bracket.
function wheelSpin(w0, Td, vLong, R, Fmax, S0, dt) {
  const I = car.Iw;
  let lo = w0 + dt * (Td - R * Fmax) / I, hi = w0 + dt * (Td + R * Fmax) / I, w = clamp(w0, lo, hi);
  for (let it = 0; it < 12; it++) {
    const den = Math.max(Math.abs(w * R), Math.abs(vLong), 1.5), s = (w * R - vLong) / den, e = Math.exp(-Math.abs(s) / S0);
    const g = I * (w - w0) - dt * (Td - R * Math.sign(s) * Fmax * (1 - e));
    if (Math.abs(g) < 1e-6 * I) break;
    if (g > 0) hi = w; else lo = w;
    let n = w - g / (I + dt * R * Fmax / S0 * e * R / den);       // (the slope as if den held: exact below the 1.5 m/s floor)
    if (!(n > lo && n < hi)) n = 0.5 * (lo + hi);
    if (Math.abs(n - w) < 1e-7) { w = n; break; }
    w = n;
  }
  return w;
}
function applyBrake(W, Tb, dt) {
  if (Tb <= 0) return;
  const d = Tb * dt / car.Iw;
  W.omega = Math.abs(W.omega) <= d ? 0 : W.omega - Math.sign(W.omega) * d;
}
function lsd(a, b, dt) {
  const diff = a.omega - b.omega, max = 500 * dt / car.Iw;
  const m = clamp(diff * 0.25, -max, max);
  a.omega -= m; b.omega += m;
}

function resetCar(x = car.pos.x, z = car.pos.z, yaw = Math.atan2(fwd.x, fwd.z) || 0) {
  car.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  let top = -Infinity;
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) top = Math.max(top, surfaceAt(x + dx, z + dz, 1e9));
  car.pos.set(x, top + 0.3 + car.REST + car.R - car.wheels[0].hp.y, z); car.vel.set(0, 0, 0); car.w.set(0, 0, 0); car.grace = 1.2; car.hullC?.fill(1);
  for (const w of car.wheels) { w.omega = 0; w.comp = 0; }
}

/* =====================================================================
   DUST & ROOST PARTICLES
   ===================================================================== */
const MAXP = 5000;
const pPos = new Float32Array(MAXP * 3), pVel = new Float32Array(MAXP * 3), pAge = new Float32Array(MAXP), pLife = new Float32Array(MAXP).fill(0);
const pSize = new Float32Array(MAXP), pAlpha = new Float32Array(MAXP), pKind = new Uint8Array(MAXP), pBase = new Float32Array(MAXP);
let pNext = 0;
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
pGeo.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1));
pGeo.setAttribute('aAlpha', new THREE.BufferAttribute(pAlpha, 1));
const pMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  uniforms: { scale: { value: innerHeight / 2 }, dustCol: { value: new THREE.Color(0.80, 0.64, 0.45) }, fogCol: { value: HAZE } },
  vertexShader: `attribute float aSize; attribute float aAlpha; uniform float scale; varying float vA; varying float vD;
    void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); vA = aAlpha; vD = -mv.z; gl_PointSize = aSize*scale/max(-mv.z,0.1); gl_Position = projectionMatrix*mv; }`,
  fragmentShader: `uniform vec3 dustCol; uniform vec3 fogCol; varying float vA; varying float vD;
    void main(){ vec2 p = gl_PointCoord*2.-1.; float r = dot(p,p); if(r>1.) discard;
      float a = vA*(1.-r)*(1.-r); vec3 col = mix(dustCol, fogCol, clamp((vD-70.)/210.,0.,1.));
      gl_FragColor = vec4(col, a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`
});
const points = new THREE.Points(pGeo, pMat);
points.frustumCulled = false;
scene.add(points);

function emit(kind, x, y, z, vx, vy, vz, life, size, alpha) {
  const i = pNext; pNext = (pNext + 1) % MAXP;
  pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z;
  pVel[i * 3] = vx; pVel[i * 3 + 1] = vy; pVel[i * 3 + 2] = vz;
  pAge[i] = 0; pLife[i] = life; pBase[i] = size; pSize[i] = size; pAlpha[i] = alpha; pKind[i] = kind;
}
const wind = new THREE.Vector3(1.4, 0, 0.5);
function updateParticles(dt) {
  for (let i = 0; i < MAXP; i++) {
    if (pLife[i] <= 0) { pAlpha[i] = 0; continue; }
    pAge[i] += dt;
    const t = pAge[i] / pLife[i];
    if (t >= 1) { pLife[i] = 0; pAlpha[i] = 0; continue; }
    const o = i * 3;
    if (pKind[i] === 0) {            // fine dust: drag toward wind, slight lift, grows
      const k = Math.exp(-1.8 * dt);
      pVel[o] = wind.x + (pVel[o] - wind.x) * k; pVel[o + 1] = 0.25 + (pVel[o + 1] - 0.25) * k; pVel[o + 2] = wind.z + (pVel[o + 2] - wind.z) * k;
      pSize[i] = pBase[i] * (1 + 3.5 * t);
      pAlpha[i] = 0.32 * Math.sin(Math.PI * Math.min(1, t * 4)) * (1 - t);
    } else {                          // roost: ballistic sand clumps
      pVel[o + 1] -= G * dt;
      const k = Math.exp(-0.6 * dt); pVel[o] *= k; pVel[o + 2] *= k;
      pAlpha[i] = 0.85 * (1 - t * t);
    }
    pPos[o] += pVel[o] * dt; pPos[o + 1] += pVel[o + 1] * dt; pPos[o + 2] += pVel[o + 2] * dt;
    if (pKind[i] === 1 && pPos[o + 1] < heightAt(pPos[o], pPos[o + 2])) {
      // clump lands: puff of dust
      if (Math.random() < 0.3) emit(0, pPos[o], pPos[o + 1] + 0.05, pPos[o + 2], pVel[o] * 0.2, 0.4, pVel[o + 2] * 0.2, 1.5 + Math.random(), 0.5, 0.3);
      pLife[i] = 0; pAlpha[i] = 0;
    }
  }
  pGeo.attributes.position.needsUpdate = pGeo.attributes.aSize.needsUpdate = pGeo.attributes.aAlpha.needsUpdate = true;
}
const emitAcc = new Float32Array(8);
// skid marks (#306): rubber left on asphalt and bridge decks by a tire that slides or spins, ours and (in a race) the
// other players' cars'. A strip per wheel, made of quads joined end to end across the way the tire travels (as wide as
// its tread rolling, as long as its contact patch sliding sideways), in one ring for all the cars: the oldest go first.
const SKID_MAX = 12000, skidPos = new Float32Array(SKID_MAX * 18), skidCol = new Float32Array(SKID_MAX * 24), skidUv = new Float32Array(SKID_MAX * 12);
const skidGeo = new THREE.BufferGeometry();
skidGeo.setAttribute('position', new THREE.BufferAttribute(skidPos, 3).setUsage(THREE.DynamicDrawUsage));
skidGeo.setAttribute('color', new THREE.BufferAttribute(skidCol, 4).setUsage(THREE.DynamicDrawUsage));
skidGeo.setAttribute('uv', new THREE.BufferAttribute(skidUv, 2).setUsage(THREE.DynamicDrawUsage));
skidGeo.setDrawRange(0, 0);
// the mark's texture: soft edges, the tread's streaks along it, blotches where the rubber went down thicker
const skidTex = (() => {
  const W = 32, H = 128, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d'), im = g.createImageData(W, H);
  let seed = 306; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const col = Array.from({ length: W }, () => 0.62 + 0.38 * rnd());
  for (const c of [8, 15, 16, 23]) col[c] *= 0.45;                                  // the tread's grooves
  const wave = Array.from({ length: 6 }, (_, k) => [rnd() * 0.12, rnd() * 6.283, k + 1]);
  for (let y = 0; y < H; y++) {
    let b = 0.86; for (const [a, ph, k] of wave) b += a * Math.sin(ph + y / H * 6.283 * k);   // repeats along v
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W, e = smooth(clamp(u / 0.2, 0, 1)) * smooth(clamp((1 - u) / 0.2, 0, 1)), o = (y * W + x) * 4;
      im.data[o] = im.data[o + 1] = im.data[o + 2] = 255; im.data[o + 3] = Math.round(255 * clamp(e * col[x] * b, 0, 1));
    }
  }
  g.putImageData(im, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping; t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return t;
})();
const skidMesh = new THREE.Mesh(skidGeo, new THREE.MeshBasicMaterial({ color: 0x0c0b0a, map: skidTex, vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
skidMesh.frustumCulled = false; skidMesh.renderOrder = 1; scene.add(skidMesh);
let skidN = 0, skidCount = 0, skidLo = -1, skidHi = -1;
const skidLast = new Map();                         // a strip's last point, by wheel: 0-3 ours, `${id}:${i}` the others'
const SKID_V0 = 0.5, SKID_V1 = 6;                   // sliding speed (m/s, W.slide) where a mark starts, and where it is darkest
const skidAlpha = slide => slide > SKID_V0 ? 0.2 + 0.6 * smooth(clamp((slide - SKID_V0) / (SKID_V1 - SKID_V0), 0, 1)) : 0;
function clearSkids() { skidN = 0; skidCount = 0; skidLo = skidHi = -1; skidGeo.setDrawRange(0, 0); skidLast.clear(); }
// a strip's next point: the contact at (x, y, z), the tire heading (fx, fz), its tread's half-width, the mark's darkness
function skidPoint(key, x, y, z, fx, fz, hw, a) {
  const L = skidLast.get(key);
  if (!a) { if (L) skidLast.delete(key); return; }
  if (L && Math.hypot(x - L.x, z - L.z) < 0.3) return;
  const d = L ? Math.hypot(x - L.x, z - L.z) : 0;
  if (!L || d > 4 || Math.abs(y - L.y) > 0.6) {                // a new strip (or a jump: a respawn, a bridge's deck)
    skidLast.set(key, { x, y, z, a, v: 0, first: true }); return;
  }
  const mx = (x - L.x) / d, mz = (z - L.z) / d, fl = Math.hypot(fx, fz) || 1, c = Math.abs((fx * mx + fz * mz) / fl);
  const w = hw * c + 0.1 * Math.sqrt(1 - c * c), sx = -mz, sz = mx, v = L.v + d / 1.6;
  if (L.first) { L.sx = sx; L.sz = sz; L.hw = w; }                // the strip's start: across the way it goes too
  const q = [[L.x + L.sx * L.hw, L.y, L.z + L.sz * L.hw, L.a, 0, L.v], [L.x - L.sx * L.hw, L.y, L.z - L.sz * L.hw, L.a, 1, L.v],
    [x + sx * w, y, z + sz * w, a, 0, v], [x - sx * w, y, z - sz * w, a, 1, v]];
  const o = skidN * 18, oc = skidN * 24, ou = skidN * 12;
  [0, 2, 1, 1, 2, 3].forEach((k, n) => {                     // counter-clockwise seen from above (the original's faced down: culled)
    const p = q[k]; skidPos[o + n * 3] = p[0]; skidPos[o + n * 3 + 1] = p[1]; skidPos[o + n * 3 + 2] = p[2]; skidCol.set([1, 1, 1, p[3]], oc + n * 4); skidUv[ou + n * 2] = p[4]; skidUv[ou + n * 2 + 1] = p[5]; });
  if (skidLo < 0) skidLo = skidHi = skidN; else if (skidN === 0) skidLo = 0; skidHi = Math.max(skidHi, skidN);
  skidN = (skidN + 1) % SKID_MAX; skidCount = Math.min(skidCount + 1, SKID_MAX);
  skidLast.set(key, { x, y, z, sx, sz, hw: w, a, v: v % 64 });
}
// the quads written since the last call go to the GPU at the next render (only those; three clears the ranges once
// they are uploaded, and the physics may step several times between two renders: a range not yet sent grows)
function flushSkids() {
  if (skidLo < 0) return;
  const n = skidHi - skidLo + 1;
  for (const [name, k] of [['position', 18], ['color', 24], ['uv', 12]]) {
    const A = skidGeo.attributes[name], R = A.updateRanges, last = R[R.length - 1];
    if (last && last.start + last.count === skidLo * k) last.count += n * k; else A.addUpdateRange(skidLo * k, n * k);
    A.needsUpdate = true;
  }
  skidGeo.setDrawRange(0, skidCount * 6); skidLo = skidHi = -1;
}
function updateSkids() {
  const m = car.mass * G / (car.wheels.length || 4), hw = PRESSURES[car.pIdx].w * 0.45;
  car.wheels.forEach((W, i) => {
    const hard = W.contact && (W.deck || W.surf?.rigid);
    W.skid = hard ? skidAlpha(W.slide || 0) * clamp(0.35 + 0.65 * W.load / m, 0.35, 1.15) : 0;   // a light wheel leaves less
    skidPoint(i, W.P.x, W.P.y + 0.012, W.P.z, W.fwd.x, W.fwd.z, hw, Math.min(W.skid, 0.85));
  });
  flushSkids();
}
function emitFromWheels(dt) {
  const R = car.R;
  { const sf = car.wheels[2].surf || SURF, dc = pMat.uniforms.dustCol.value, a = Math.min(1, dt * 3); dc.r += (sf.dust[0] - dc.r) * a; dc.g += (sf.dust[1] - dc.g) * a; dc.b += (sf.dust[2] - dc.b) * a; }
  car.wheels.forEach((W, idx) => {
    if (!W.contact) return;
    const sp = car.vel.length();
    if (W.deck) return;
    const looseness = 1 - 0.6 * W.cUnder;
    const dustRate = (W.slipSpeed * 14 + sp * 1.4) * (W.load / 2000) * looseness * (W.surf || SURF).dustK;
    const roostRate = W.slipSpeed > 1.2 ? (W.slipSpeed - 1.2) * 22 * looseness * (W.surf || SURF).roostK : 0;
    emitAcc[idx * 2] += dustRate * dt; emitAcc[idx * 2 + 1] += roostRate * dt;
    const thr = Math.sign(W.omega * R - W.fwd.dot(car.vel)) || 1;
    while (emitAcc[idx * 2] >= 1) {
      emitAcc[idx * 2]--;
      const r = () => (Math.random() - 0.5);
      emit(0, W.P.x + r() * 0.4, W.P.y + 0.1, W.P.z + r() * 0.4,
        car.vel.x * 0.35 - W.fwd.x * thr * W.slipSpeed * 0.25 + r(), 0.5 + Math.random() * 1.2, car.vel.z * 0.35 - W.fwd.z * thr * W.slipSpeed * 0.25 + r(),
        2.2 + Math.random() * 2.5, 0.7 + Math.random() * 0.6, 0.3);
    }
    while (emitAcc[idx * 2 + 1] >= 1) {
      emitAcc[idx * 2 + 1]--;
      const r = () => (Math.random() - 0.5);
      const v = Math.min(W.slipSpeed, 18) * (0.25 + Math.random() * 0.4);
      emit(1, W.P.x + r() * 0.3, W.P.y + 0.15, W.P.z + r() * 0.3,
        -W.fwd.x * thr * v + r() * 1.5 + car.vel.x * 0.5, 1.2 + Math.random() * 3.2, -W.fwd.z * thr * v + r() * 1.5 + car.vel.z * 0.5,
        1.6, 0.07 + Math.random() * 0.06, 0.9);
    }
  });
}

/* =====================================================================
   INPUT, AUDIO, CAMERA, HUD
   ===================================================================== */
const keys = {};
let camMode = 0, audio = null, muted = false;
try { muted = localStorage.getItem('carsim.muted') === '1'; } catch (e) { }
// the sound on or off (M, the rail's Sound; #343): the synth told at once (a training's silence is its own: no audio
// then), said on screen, kept in this browser
function setMuted(on = !muted) {
  muted = !!on;
  try { if (muted) localStorage.setItem('carsim.muted', '1'); else localStorage.removeItem('carsim.muted'); } catch (e) { }
  audio?.node.port.postMessage({ on: muted || window.__sim?.paused ? 0 : 1 });
  flash(muted ? 'Sound off · M turns it on' : 'Sound on', '#fff', 1.4);
  return muted;
}
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.repeat) return;
  if (e.code === 'KeyM' && !e.ctrlKey && !e.metaKey && !e.altKey) { setMuted(); startAudio(); return; }   // (everywhere: the editor and a replay too)
  if (e.code === 'KeyP' && e.shiftKey) { setPressure((car.pIdx + 1) % PRESSURES.length); flash(`Tires: ${PRESSURES[car.pIdx].psi} psi${car.pIdx === VEH.pIdx ? ' (its own)' : ''} · Shift+P changes it`, '#fff', 1.8); }
  else if (e.code === 'KeyP') { simPause(); return; }
  if (e.code === 'Digit4') {
    if (VEH.awdFixed && car.awd) {                                      // permanent all-wheel drive: the next split
      setSplit(SPLITS[(SPLITS.indexOf(car.split) + 1) % SPLITS.length]);
      flash(`All-wheel drive: ${Math.round(car.split * 100)}/${Math.round((1 - car.split) * 100)} front/rear${car.split === (VEH.split ?? 0.5) ? ' (its own)' : ''} · 4 changes it`, '#fff', 1.8);
    } else if (VEH.awdFixed) flash('Rear-wheel drive only', '#fff', 1.5); else { setDrive(!car.awd); flash(car.awd ? 'Four-wheel drive' : 'Rear-wheel drive', '#fff', 1.5); }
  }
  if (MP.on && mpKeyBlocked(e)) return;
  if (e.code === 'KeyE') { if (rp.on) stopReplay(); toggleEditor(!ed.on); return; }
  if (ed.on) { if ((e.code === 'Delete' || e.code === 'Backspace') && ed.tool === 'wp' && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) { e.preventDefault(); deleteWaypoint(ed.sel); } return; }
  if (e.code === 'KeyI') { aiToggle(); return; }
  if (e.code === 'KeyY') { rp.on ? stopReplay() : startReplay(); return; }
  if (rp.on) { replayKey(e); if (e.code === 'KeyC') nextCam(); if (e.code === 'KeyH') document.getElementById('help').style.display = document.getElementById('help').style.display === 'none' ? '' : 'none'; return; }
  if (e.code === 'KeyK') { togglePaintPanel(); return; }
  if (e.code === 'KeyB') { resetBest(); return; }
  if (e.code === 'KeyN') { document.getElementById('botBtn').click(); return; }
  if (e.code === 'KeyO') { document.getElementById('wxBtn').click(); return; }
  if (e.code === 'KeyV') { const keys = Object.keys(VEHICLE_LIST), i = (keys.indexOf(VEH.key) + 1) % keys.length; switchVehicle(keys[i]); flash(VEH.name, '#fff', 1.8); }
  if (e.code === 'KeyX') { if (VEH.aids) { car.aids = !car.aids; flash(`Traction control and ABS ${car.aids ? 'on' : 'off'}`, '#fff', 1.6); } else flash('The buggy has no driver aids', '#fff', 1.5); }
  if (e.code === 'KeyR' || (e.code === 'Enter' && car.wrecked)) { if (car.wrecked) repairCar(); respawn(); }
  if (e.code === 'KeyT') restartRun();
  if (e.code === 'KeyG') { setSurface(ROAD ? 'sand' : SURF === SURFACES.sand ? 'earth' : 'road'); flash(`Ground: ${groundName()}`, '#fff', 1.5); }
  if (e.code === 'KeyC') nextCam();
  if (e.code === 'KeyH') document.getElementById('help').style.display = document.getElementById('help').style.display === 'none' ? '' : 'none';
  startAudio();
});
addEventListener('keyup', e => { keys[e.code] = false; });

/* ---------- engine audio: AudioWorklet synth driven by the engine model ---------- */
const ENGINE_WORKLET = `
class Biquad {
  constructor() { this.b0 = 1; this.b1 = this.b2 = this.a1 = this.a2 = 0; this.x1 = this.x2 = this.y1 = this.y2 = 0; }
  set(type, f, q, gainDb) {
    const w = 2 * Math.PI * Math.min(f, sampleRate * 0.45) / sampleRate, sn = Math.sin(w), c = Math.cos(w), a = sn / (2 * q);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'bp') { b0 = a; b1 = 0; b2 = -a; a0 = 1 + a; a1 = -2 * c; a2 = 1 - a; }
    else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; a0 = 1 + a; a1 = -2 * c; a2 = 1 - a; }
    else if (type === 'peak') { const A = Math.pow(10, gainDb / 40); b0 = 1 + a * A; b1 = -2 * c; b2 = 1 - a * A; a0 = 1 + a / A; a1 = -2 * c; a2 = 1 - a / A; }
    else { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; a0 = 1 + a; a1 = -2 * c; a2 = 1 - a; }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0; return this;
  }
  run(x) { const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y; return y; }
}
// Pipe: delay line with a damped, inverting reflection at the open end (a simple digital waveguide)
class Pipe {
  constructor(seconds, fb, damp) { this.buf = new Float32Array(2048); this.i = 0; this.len = Math.max(2, Math.min(2040, Math.round(seconds * sampleRate))); this.fb = fb; this.damp = damp; this.lp = 0; }
  run(x) {
    const d = this.buf[(this.i - this.len + 2048) & 2047];
    this.lp += (d - this.lp) * this.damp;
    const y = x - this.lp * this.fb;
    this.buf[this.i] = y; this.i = (this.i + 1) & 2047;
    return y;
  }
}
class EngineSynth extends AudioWorkletProcessor {
  constructor() {
    super();
    this.p = { rpm: 900, load: 0, cut: 0, speed: 0, slip: 0, on: 1, surf: 0, shaft: 0, cab: 0, tar: 0, squeal: 0 };
    this.s = { rpm: 900, load: 0, speed: 0, slip: 0, surf: 0, cab: 0, tar: 0, squeal: 0 };
    this.sqF = new Biquad().set('bp', 1050, 9); this.sqF2 = new Biquad().set('bp', 2150, 12); this.sqT = 0; this.sqW = 0; this.roadF = new Biquad().set('bp', 380, 0.8);
    this.amp = new Float32Array(8).fill(0.3); this.rough = new Float32Array(8); this.lastTh = new Float32Array(8);
    this.phase = 0; this.pop = 0; this.jit = 0; this.jitT = 0;
    this.spool = 0; this.prevLoad = 0; this.bov = 0; this.whPh = 0; this.gwPh = 0; this.crash = 0; this.thump = 0; this.thPh = 0; this.crunch = 0;
    this.glass = 0; this.tink = 0; this.glHp = new Biquad().set('hp', 2400, 0.7); this.glF = [new Biquad().set('bp', 3100, 14), new Biquad().set('bp', 4700, 18), new Biquad().set('bp', 6900, 22), new Biquad().set('bp', 8800, 16)];
    this.muff = new Biquad(); this.body = new Biquad(); this.honk = new Biquad();
    this.exHp = new Biquad().set('hp', 28, 0.7); this.pres = new Biquad(); this.cabLp = new Biquad();
    this.inRes = new Biquad().set('bp', 430, 2.2); this.inRes2 = new Biquad().set('bp', 980, 3); this.inHiss = new Biquad().set('bp', 2600, 0.9);
    this.mech = new Biquad().set('bp', 3400, 1.6); this.popF = new Biquad().set('bp', 900, 0.8);
    this.sand = new Biquad().set('bp', 1400, 0.6); this.sand2 = new Biquad(); this.wind = new Biquad().set('lp', 300, 0.7);
    this.whoosh = new Biquad(); this.bovF = new Biquad().set('hp', 2200, 0.7); this.crunchF = new Biquad().set('bp', 2600, 1.3); this.crunchF2 = new Biquad().set('bp', 800, 1.1);
    this.met = [new Biquad().set('bp', 530, 14), new Biquad().set('bp', 1370, 16), new Biquad().set('bp', 2950, 18), new Biquad().set('bp', 4100, 10)];
    this.thLp = new Biquad().set('lp', 140, 0.7);
    this.erL = new Float32Array(4096); this.erR = new Float32Array(4096); this.ei = 0;
    this.dcL = 0; this.dcR = 0; this.inL = 0; this.inR = 0;
    this.config({ fire: [0, 0.25, 0.5, 0.75], bank: [0, 1, 0, 1], hdr: [0.0061, 0.0068], coll: 0.0029, tail: 0.0113, muff: [900, 4200, 1800], body: [120, 4], honk: [520, 4], pres: 1700,
      level: 1, turbo: 0, bov: 0, limiter: 7600, exW: 0.09, drive: [1.6, 3.2], intake: 0.5, mech: 1, whine: 0.22, burble: 0.3 });
    this.port.onmessage = e => {
      const d = e.data;
      if (d.cfg) this.config(d.cfg);
      else if (d.pop) this.pop = Math.max(this.pop, d.pop);
      else if (d.crash) this.crash = Math.min(1.5, this.crash + d.crash);
      else if (d.thump) this.thump = Math.min(1.2, this.thump + d.thump);
      else if (d.glass) { this.glass = Math.min(1.2, this.glass + d.glass); this.tink = Math.min(1, this.tink + d.glass * 0.8); }
      else Object.assign(this.p, d);
    };
  }
  config(c) {
    this.c = c; this.nc = c.fire.length;
    const hr = c.hdrRef || [0.62, 0.55];   // how much the manifolds' ends reflect, and how dully: a turbine reflects less
    this.hdrL = new Pipe(c.hdr[0], hr[0], hr[1]); this.hdrR = new Pipe(c.hdr[1], hr[0], hr[1]);
    this.coll = new Pipe(c.coll, 0.42, 0.7); this.tail = new Pipe(c.tail, 0.3, 0.4);
    this.body.set('peak', c.body[0], 0.9, c.body[1]); this.honk.set('peak', c.honk[0], 1.4, c.honk[1]);
    // optional: a second pipe per bank (dual exhaust: each bank keeps its own uneven pulse train, the V8 burble),
    // a chest resonance, an exhaust rasp band, and fixed cylinder-to-cylinder differences
    this.bpL = c.bankPipe ? new Pipe(c.bankPipe[0], 0.5, 0.45) : null; this.bpR = c.bankPipe ? new Pipe(c.bankPipe[1], 0.5, 0.45) : null;
    this.sub = new Biquad(); this.sub.set('peak', c.sub ? c.sub[0] : 100, 1.1, c.sub ? c.sub[1] : 0);
    this.raspF = new Biquad().set('bp', c.raspF || 2600, 1.2); this.raspHp = new Biquad().set('hp', 900, 0.7);
    this.cyl = c.fire.map((_, i) => 1 + (c.cylVar || 0) * Math.sin(i * 2.4 + 0.7));
    // optional: the rush of air and gas through the turbos under boost, breathing with the firing pulses
    this.rushF = new Biquad(); this.rushLp = new Biquad().set('lp', 2600, 0.6); this.rushE = 0;
  }
  process(_, outputs) {
    const oL = outputs[0][0], oR = outputs[0][1] || oL; if (!oL) return true;
    const p = this.p, s = this.s, c = this.c, sr = sampleRate, blk = oL.length / sr;
    const k = 1 - Math.exp(-blk * 28);
    s.rpm += (p.rpm - s.rpm) * k; s.speed += (p.speed - s.speed) * k; s.slip += (p.slip - s.slip) * (1 - Math.exp(-blk * 8));
    s.surf += (p.surf - s.surf) * (1 - Math.exp(-blk * 4)); s.tar += (p.tar - s.tar) * (1 - Math.exp(-blk * 4)); s.squeal += (p.squeal - s.squeal) * (1 - Math.exp(-blk * 14)); s.cab += (p.cab - s.cab) * (1 - Math.exp(-blk * 10));
    s.load += ((p.cut ? 0 : p.load) - s.load) * (1 - Math.exp(-blk * (p.cut ? 90 : 35)));
    const load = s.load, rn = Math.min(s.rpm / c.limiter, 1), nc = this.nc;
    if ((this.jitT -= blk) <= 0) { this.jitT = 0.05 + Math.random() * 0.1; this.jitTarget = (Math.random() - 0.5) * 0.035 * (1 - rn) * (1 - 0.6 * load) * (nc > 4 ? 0.5 : 1); }
    this.jit += ((this.jitTarget || 0) - this.jit) * 0.08;
    const cycleHz = s.rpm * (1 + this.jit) / 120;
    // turbo: spool follows boost demand with lag; lifting off with boost up dumps it through the blow-off valve
    const spT = c.turbo ? Math.max(0, Math.min(1, load * (s.rpm - 1400) / 2600)) : 0;
    this.spool += (spT - this.spool) * (1 - Math.exp(-blk * (spT > this.spool ? 2.4 : 4)));
    if (c.bov && this.prevLoad > 0.5 && load < 0.2 && this.spool > 0.35) this.bov = Math.max(this.bov, this.spool);
    this.prevLoad = load;
    const tb = c.turbo ? 1 - 0.35 * this.spool : 1;              // the turbine muffles the exhaust under boost
    this.muff.set('lp', (c.muff[0] + c.muff[1] * load + c.muff[2] * rn) * tb, 0.7);
    this.pres.set('peak', c.pres, 0.7, 3 + 8 * load);
    this.cabLp.set('lp', 2400 - 1500 * s.cab, 0.7);
    this.whoosh.set('bp', 1600 + 2600 * this.spool, 1.1);
    const rushA = c.rush ? c.rush * this.spool * (0.25 + 0.75 * load) * (0.5 + 0.5 * rn) : 0;
    if (rushA) this.rushF.set('bp', 480 + 700 * this.spool * rn, 0.45);
    this.sand2.set('lp', 500 + Math.min(s.slip, 14) * 160, 0.7);
    const overrun = load < 0.06 && s.rpm > 2200;
    const exW = c.exW + 0.04 * load, inW = 0.2 * 4 / Math.max(nc, 4) + 0.05;
    const drive = c.drive[0] + c.drive[1] * load;
    const sandAmp = Math.min(s.slip * 0.012 + s.speed * 0.0025, 0.13) * (1 - 0.7 * s.surf) * (1 - 0.85 * s.tar), windAmp = Math.min(s.speed * s.speed * 0.00018, 0.16);
    const crunchRate = s.surf * (1 - s.tar) * (s.speed * 26 + s.slip * 40);
    const sqA = s.squeal * s.tar * 0.11, roadA = Math.min(s.speed * 0.0016, 0.05) * s.tar;   // gravel / dry clods under the tyres
    const er1 = Math.round(sr * 0.019), er2 = Math.round(sr * 0.031);
    const whF = 2600 + 7400 * this.spool, gwF = Math.min(p.shaft / 60 * 23, 6000), gwA = c.whine * (0.25 + load) * Math.min(1, gwF / 500) * 0.02;
    const thF = 52;
    for (let i = 0; i < oL.length; i++) {
      this.phase += cycleHz / sr; if (this.phase >= 1) this.phase -= 1;
      let exL = 0, exR = 0, intake = 0, tick = 0;
      for (let ci = 0; ci < nc; ci++) {
        let th = this.phase - c.fire[ci]; if (th < 0) th += 1;
        if (th < this.lastTh[ci]) {
          let a = 0.42 + 0.58 * load;
          a *= 1 + (Math.random() - 0.5) * (0.45 - 0.3 * load) * (nc > 4 ? 0.6 : 1);
          if (overrun) a = Math.random() < c.burble ? 0.55 + Math.random() * 0.5 : 0.1;
          if (p.cut && load < 0.3) a *= Math.random() < 0.5 ? 0.15 : 1;
          this.amp[ci] = a * this.cyl[ci]; this.rough[ci] = 0.5 + Math.random();
        }
        this.lastTh[ci] = th;
        let e = 0;
        if (th < exW) { const u = th / exW; e = Math.sin(Math.PI * Math.pow(u, 0.3)); e *= e; }
        else if (th < exW * 2.4) { const u = (th - exW) / (exW * 1.4); e = -0.32 * Math.sin(Math.PI * u); }
        e *= this.amp[ci] * (1 + (Math.random() * 2 - 1) * (0.25 + 0.3 * load) * this.rough[ci] * (th < exW ? 1 : 0));
        if (c.bank[ci]) exR += e; else exL += e;
        let ti = th - 0.5; if (ti < 0) ti += 1;
        if (ti < inW) { const u = Math.sin(Math.PI * ti / inW); intake -= u * u; }
        if (th < 0.012) tick += 1 - th / 0.012;
      }
      const norm = 2 / Math.sqrt(nc);
      exL *= norm; exR *= norm; intake *= norm;
      let popN = 0;
      if (this.pop > 0.003) { popN = this.popF.run(Math.random() * 2 - 1) * this.pop * 9; this.pop *= 0.9991; } else this.pop = 0;
      let hL = this.hdrL.run(exL + popN), hR = this.hdrR.run(exR + popN * 0.7);
      if (this.bpL) { hL = this.bpL.run(hL); hR = this.bpR.run(hR); }
      let ex = this.tail.run(this.coll.run(hL + hR));
      const raw = ex;
      ex = this.sub.run(this.pres.run(this.honk.run(this.body.run(this.muff.run(ex)))));
      ex = Math.tanh(ex * drive * 0.55) / Math.tanh(drive * 0.55 + 0.35);
      if (c.rasp) ex += this.raspF.run(Math.tanh(this.raspHp.run(raw) * (2 + 6 * load))) * c.rasp * (0.15 + 0.85 * load) * (0.2 + 0.8 * rn) * 0.5;   // hard-edged bark at high revs
      ex = this.exHp.run(ex);
      ex = ex * (1 - s.cab) + this.cabLp.run(ex) * s.cab * 0.8;   // from inside the car the exhaust is duller
      const n = Math.random() * 2 - 1;
      const inT = 0.12 + 0.88 * load;
      const ind = ((this.inRes.run(intake) * 1.5 + this.inRes2.run(intake) * 0.7) * inT * (0.25 + 0.5 * rn) + this.inHiss.run(n) * load * (0.03 + 0.1 * rn)) * c.intake * 2 * (1 + 0.6 * s.cab);
      const mech = this.mech.run(tick * (Math.random() * 2 - 1)) * (0.05 + 0.2 * rn) * c.mech;
      // turbo whistle + whoosh, blow-off valve
      let turbo = 0;
      if (c.turbo) {
        this.whPh += whF / sr; if (this.whPh > 1) this.whPh -= 1;
        turbo = Math.sin(this.whPh * 6.2832) * this.spool * this.spool * (0.2 + load) * 0.016 * c.turbo
          + this.whoosh.run(n) * this.spool * (0.25 + load) * 0.09 * c.turbo;
        if (rushA > 0.0004) { this.rushE += (Math.min(Math.abs(raw), 1.5) - this.rushE) * 0.012; turbo += this.rushLp.run(this.rushF.run(n)) * rushA * (1.4 + 3.2 * this.rushE); }
        if (this.bov > 0.01) { const fl = c.bov > 0.5 ? 1 : (Math.sin(this.whPh * 6.2832 * 0.004) > 0 ? 1 : 0.25); turbo += this.bovF.run(Math.random() * 2 - 1) * this.bov * 0.2 * fl; this.bov *= 0.99982; }
      }
      // transmission whine
      this.gwPh += gwF / sr; if (this.gwPh > 1) this.gwPh -= 1;
      const whine = Math.sin(this.gwPh * 6.2832) * gwA;
      // tyres: sand hiss, gravel crunch on earth
      const sand = this.sand2.run(this.sand.run(n)) * sandAmp * 6;
      if (Math.random() < crunchRate / sr) this.crunch = 0.4 + Math.random() * 0.8;
      const cr = this.crunch > 0.002 ? (this.crunchF.run(n) * 0.7 + this.crunchF2.run(n)) * this.crunch * 0.35 : 0; this.crunch *= 0.996;
      const wind = this.wind.run(n) * windAmp * 3;
      // impacts: metallic crunch + low thump; suspension thumps
      let hit = 0;
      if (this.crash > 0.002) { const x = n * this.crash; hit = (this.met[0].run(x) * 1.2 + this.met[1].run(x) + this.met[2].run(x) * 0.8 + this.met[3].run(x) * 0.5) * 1.6 + this.thLp.run(x) * 3; this.crash *= 0.99965; }
      if (this.glass > 0.002 || this.tink > 0.002) {
        const imp = Math.random() < this.tink * 90 / sr ? (Math.random() * 2 - 1) * this.tink : 0;
        hit += this.glHp.run(n) * this.glass * 1.3 + (this.glF[0].run(imp) + this.glF[1].run(imp) + this.glF[2].run(imp) * 0.8 + this.glF[3].run(imp) * 0.6) * 9;
        this.glass *= 0.9996; this.tink *= 0.99993;
      }
      if (this.thump > 0.002) { this.thPh += thF / sr; hit += Math.sin(this.thPh * 6.2832) * this.thump * 0.5; this.thump *= 0.9993; }
      const level = (0.72 + 0.28 * load) * c.level;
      const side = (hL - hR) * (0.12 + 0.3 * (c.dual || 0)) * level;
      let sq = 0;
      if (sqA > 0.001) {           // tire squeal: narrow-band noise with a wandering pitch, like rubber stick-slip
        if ((this.sqT -= 1 / sr) <= 0) { this.sqT = 0.03 + Math.random() * 0.05; this.sqW = 0.85 + Math.random() * 0.3; }
        sq = (this.sqF.run(n * this.sqW) + this.sqF2.run(n) * 0.5) * sqA * 16;
      }
      const rr = this.roadF.run(n) * roadA;
      let l = ex * 0.62 * level + ind * 0.5 + mech + sand + cr + wind + side + turbo + whine + hit + sq + rr;
      let r = ex * 0.62 * level + ind * 0.5 + mech + sand * 0.9 + cr * 0.9 + wind - side + turbo + whine + hit + sq * 0.9 + rr;
      const dl = this.erL[(this.ei - er1 + 4096) & 4095], dr = this.erR[(this.ei - er2 + 4096) & 4095];
      this.erL[this.ei] = l; this.erR[this.ei] = r; this.ei = (this.ei + 1) & 4095;
      l += dr * 0.16; r += dl * 0.16;
      this.dcL = l - this.inL + 0.996 * this.dcL; this.inL = l; this.dcR = r - this.inR + 0.996 * this.dcR; this.inR = r;
      oL[i] = Math.tanh(this.dcL * 0.9) * p.on;
      if (oR !== oL) oR[i] = Math.tanh(this.dcR * 0.9) * p.on;
    }
    return true;
  }
}
registerProcessor('engine-synth', EngineSynth);
`;

let audioStarting = false;
async function startAudio() {
  if (audio || audioStarting) return;
  audioStarting = true;
  try {
    const ctx = new AudioContext();
    let node;
    try {
      await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([ENGINE_WORKLET], { type: 'application/javascript' })));
      node = new AudioWorkletNode(ctx, 'engine-synth', { outputChannelCount: [2] });
    } catch (err) {
      // file:// pages can't load worklets: run the same synth on the main thread
      let Proc;
      new Function('sampleRate', 'AudioWorkletProcessor', 'registerProcessor', ENGINE_WORKLET)(
        ctx.sampleRate, class { constructor() { this.port = {}; } }, (n, c) => { Proc = c; });
      const proc = new Proc();
      node = ctx.createScriptProcessor(1024, 0, 2);
      node.port = { postMessage: d => proc.port.onmessage({ data: d }) };
      const blocks = [[new Float32Array(128), new Float32Array(128)]];
      node.onaudioprocess = e => {
        const L = e.outputBuffer.getChannelData(0), Rr = e.outputBuffer.getChannelData(1);
        for (let o = 0; o < L.length; o += 128) { proc.process([], blocks); L.set(blocks[0][0], o); Rr.set(blocks[0][1], o); }
      };
    }
    const gain = ctx.createGain(); gain.gain.value = 0.55;
    node.connect(gain).connect(ctx.destination);
    audio = { ctx, node, gain };
    node.port.postMessage({ cfg: SOUNDS[VEH.sound] });
  } catch (e) { console.warn('engine audio unavailable', e); }
}
function updateAudio() {
  if (!audio) return;
  const E = car.eng;
  let slip = 0; for (const w of car.wheels) if (w.contact) slip = Math.max(slip, w.slipSpeed);
  let earth = 0, n = 0, tar = 0, sq = 0; for (const w of car.wheels) if (w.contact) { n++; if (w.surf === SURFACES.earth && !w.deck) earth++; if (w.surf?.rigid && !w.deck) { tar++; sq = Math.max(sq, clamp((w.slipSpeed - 1.5) / 6, 0, 1)); } }
  audio.node.port.postMessage({ rpm: E.rpm, load: E.load, cut: E.cut ? 1 : 0, speed: car.vel.length(), slip, on: muted || window.__sim?.paused ? 0 : 1, surf: n ? earth / n : 0, tar: n ? tar / n : 0, squeal: sq, shaft: E.reverse ? 0 : E.rpm, cab: camMode === 1 ? 1 : 0 });
}
// overrun pops: lifting off at high rpm makes the exhaust crackle (sound + flame)
function updatePops(dt) {
  const E = car.eng;
  if (E.load > 0.5) { E.lastPower = E.rpm; E.liftT = 0; } else E.liftT += dt;
  if (E.load < 0.05 && E.liftT < 1.0 && E.lastPower > 4200 && E.rpm > 3000 && Math.random() < dt * 9 * VEH.pops) {
    const strength = 0.25 + Math.random() * 0.6;
    audio?.node.port.postMessage({ pop: strength });
    rig.flameT = 0.09 * strength + 0.03;
  }
}

function readInput(dt) {
  const o = car.isRival ? car.rivalCtl : aiInput(dt) || window.__sim?.override;   // (the rival's, swapped in: aiRvSwap)
  const thr = o ? o.throttle : BOTS.hold > 0.4 || MP.hold ? 0 : (keys.KeyW || keys.ArrowUp ? 1 : 0);   // no jump starts in a race
  const brk = o ? o.brake : (keys.KeyS || keys.ArrowDown ? 1 : 0);
  const st = o ? o.steer : ((keys.KeyA || keys.ArrowLeft ? 1 : 0) - (keys.KeyD || keys.ArrowRight ? 1 : 0));
  input.throttle = thr; input.brake = brk; input.handbrake = o ? !!o.handbrake : !!keys.Space || MP.hold;
  // throttle ramps so taps give partial power (needed to avoid digging in)
  const target = thr || brk ? 1 : 0;
  car.throttle += clamp(target - car.throttle, -dt * 4, dt * 2.2);
  const sp = Math.abs(car.vel.dot(fwd));
  const maxSteer = lerp(VEH.steerLock, VEH.steerLock * 0.33, clamp(sp / 24, 0, 1));
  car.steer += clamp(st * maxSteer - car.steer, -2.2 * dt, 2.2 * dt);
}

const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), camFwd = new THREE.Vector3(0, 0, 1);
// 0 chase, 1 bonnet/cockpit, 2 orbit, 3 editor, 4 beside the front wheel, 5 under the car, 6 trackside TV (replays)
const CAM_NAMES = { 0: 'Chase camera', 1: VEH => VEH.key === 'buggy' ? 'Cockpit camera' : VEH.cam.driver ? "Driver's seat camera" : 'Bonnet camera', 2: 'Orbit camera (drag to look around)', 4: 'Side camera: front wheel', 5: 'Under-car camera', 6: 'Trackside TV camera' };
function nextCam() {
  const order = rp.on ? [6, 0, 1, 4, 5, 2] : [0, 1, 4, 5, 2], i = order.indexOf(camMode);
  setCamMode(order[(i + 1) % order.length]);
}
/* Look around: Shift+drag or right-drag in the chase or cockpit view. look.yaw / look.pitch offset the
   view (drag right: the view turns right, as with the orbit camera; drag down: from higher up / looking
   down); released, it waits a moment and eases back. */
const look = { yaw: 0, pitch: 0, drag: null, idle: 0 };
const lookable = () => !ed.on && (camMode === 0 || camMode === 1);
const wrapPi = a => a - Math.round(a / TAU) * TAU;
renderer.domElement.addEventListener('pointerdown', ev => {
  if (!lookable() || !(ev.button === 2 || (ev.button === 0 && ev.shiftKey))) return;
  look.drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY };
  try { renderer.domElement.setPointerCapture(ev.pointerId); } catch (e) { }
  ev.preventDefault();
});
renderer.domElement.addEventListener('pointermove', ev => {
  const g = look.drag; if (!g || ev.pointerId !== g.id) return;
  look.yaw = wrapPi(look.yaw - (ev.clientX - g.x) * 0.006);
  look.pitch = clamp(look.pitch + (ev.clientY - g.y) * 0.004, -0.35, 1.0);
  g.x = ev.clientX; g.y = ev.clientY; look.idle = 0;
});
const lookEnd = ev => { if (look.drag && ev.pointerId === look.drag.id) look.drag = null; };
renderer.domElement.addEventListener('pointerup', lookEnd);
renderer.domElement.addEventListener('pointercancel', lookEnd);
renderer.domElement.addEventListener('contextmenu', ev => { if (!ed.on) ev.preventDefault(); });   // right-drag looks; no menu
function easeLook(dt) {
  if (look.drag || (!look.yaw && !look.pitch)) return;
  if ((look.idle += dt) < 0.7) return;                       // a moment to take it in, then back behind the car
  const k = Math.exp(-4 * dt); look.yaw *= k; look.pitch *= k;
  if (Math.abs(look.yaw) < 0.002 && Math.abs(look.pitch) < 0.002) look.yaw = look.pitch = 0;
}
// where the chase camera sits: behind the car, swung round it by look.yaw and up or down by look.pitch
function chaseSpot(out) {
  const back = VEH.cam.back, up = VEH.cam.up;
  if (!look.yaw && !look.pitch) { out.copy(car.pos).addScaledVector(camFwd, -back); out.y += up; return out; }
  const r = Math.hypot(back, up), e = clamp(Math.atan2(up, back) + look.pitch, -0.05, 1.45), c = Math.cos(look.yaw), sn = Math.sin(look.yaw);
  const ox = -camFwd.x, oz = -camFwd.z, h = r * Math.cos(e);
  return out.set(car.pos.x + (ox * c + oz * sn) * h, car.pos.y + r * Math.sin(e), car.pos.z + (oz * c - ox * sn) * h);
}
function setCamMode(m) {
  look.yaw = look.pitch = 0; look.drag = null;
  camMode = m; orbit.enabled = m === 2; if (orbit.enabled) orbit.target.copy(car.pos);
  camera.fov = m === 4 || m === 5 ? 78 : m === 6 ? camera.fov : 62; camera.updateProjectionMatrix();
  const n = CAM_NAMES[m]; flash(typeof n === 'function' ? n(VEH) : n, '#fff', 1.2);
}
// cameras fixed to the body: beside the left front wheel looking along the car, or under the floor looking forward at both front wheels
const ccP = new THREE.Vector3(), ccL = new THREE.Vector3(), ccUp = new THREE.Vector3();
function carCam(m) {
  const F = car.wheels[0], Rr = car.wheels[2], hubF = F.hp.y - F.t, hubR = Rr.hp.y - Rr.t;
  const gF = hubF - car.R, gR = hubR - car.R;                     // ground under the axles, in body space
  if (m === 4) {
    // outboard of the left front wheel, looking straight ahead along the car (parallel to the driving direction)
    const x = Math.max(Math.abs(F.hp.x) + 0.95, CAR_HW + 0.6);
    ccP.set(x, hubF + 0.25, F.hp.z - 2.5);
    ccL.set(x, hubF + 0.12, F.hp.z + 10);
  } else {
    const under = VEH.underY ?? -0.25, zr = Rr.hp.z + 0.15;
    ccP.set(0, gR + Math.max(0.12, 0.8 * (under - gR)), zr);
    ccL.set(0, gF + 0.55 * (under - gF), F.hp.z + 0.4);
  }
  ccP.applyQuaternion(car.q).add(car.pos); ccL.applyQuaternion(car.q).add(car.pos);
  const gy = surfaceAt(ccP.x, ccP.z, ccP.y + 0.3) + 0.06; if (ccP.y < gy) ccP.y = gy;   // don't dig the lens into the sand
  camera.position.copy(ccP);
  camera.up.copy(ccUp.set(0, 1, 0).applyQuaternion(car.q)); camera.lookAt(ccL); camera.up.set(0, 1, 0);
}
// trackside cameras: stand beside the course ahead of the car, follow it past, then jump to the next spot
const tv = { p: new THREE.Vector3(), u: -1, look: new THREE.Vector3() };
function tvCam(dt) {
  const d = tv.u < 0 ? Infinity : tv.p.distanceTo(car.pos);
  if (d > 55 || tv.u < 0) {
    let bi = 0, bd = Infinity; TRACK.pts.forEach((q, i) => { const e = (q.x - car.pos.x) ** 2 + (q.z - car.pos.z) ** 2; if (e < bd) { bd = e; bi = i; } });
    const n = TRACK.pts.length - 1, ahead = (bi / n + 38 / TRACK.len) % 1, p = TRACK.curve.getPointAt(ahead), t = TRACK.curve.getTangentAt(ahead).setY(0).normalize();
    const side = ((Math.floor(ahead * 37) % 2) ? 1 : -1) * (12 + (ahead * 97 % 1) * 6);
    tv.p.set(p.x - t.z * side, 0, p.z + t.x * side); tv.p.y = surfaceAt(tv.p.x, tv.p.z, 1e9) + 1.8 + (ahead * 53 % 1) * 2.5; tv.u = ahead;
    tv.look.copy(car.pos);
  }
  tv.look.lerp(car.pos, 1 - Math.exp(-12 * dt));
  camera.position.copy(tv.p); camera.lookAt(tv.look);
  camera.fov = clamp(2 * Math.atan(9 / Math.max(tv.p.distanceTo(car.pos), 1)) * 180 / Math.PI, 14, 70); camera.updateProjectionMatrix();
}
function updateCamera(dt) {
  if (VEH.steerNode) { const k = clamp(car.steer / (VEH.steerLock || 0.6) * 3.2, -2.5, 2.5) * (MODELS[VEH.key].steerSign || 1); VEH.steerNode.o.quaternion.copy(VEH.steerNode.q0).multiply(qw.setFromAxisAngle(v2.set(0, 1, 0), k)); }   // steering wheel: 120 degrees each way
  const inside = camMode === 1 && !!VEH.cam.driver;                 // sitting in a detailed model: clear the tinted windows
  if (VEH.winGlass && VEH.glassIn !== inside) { VEH.glassIn = inside; for (const m of VEH.winGlass) m.opacity = inside ? 0.1 : 0.9; }
  if (camera.fov !== 74 && inside) { camera.fov = 74; camera.updateProjectionMatrix(); }
  if (camMode === 3) { orbit.update(); return; }
  if (camMode === 2) { orbit.target.lerp(car.pos, 1 - Math.exp(-8 * dt)); orbit.update(); return; }
  easeLook(dt);
  if (camMode === 1) {
    camera.position.copy(v1.set(...(VEH.cam.driver || VEH.cam.cockpit)).applyQuaternion(car.q).add(car.pos));
    camera.quaternion.copy(car.q).multiply(qw.setFromAxisAngle(v2.set(0, 1, 0), Math.PI));
    if (look.yaw) camera.rotateY(clamp(look.yaw, -2.3, 2.3));     // turning your head, not all the way round
    camera.rotateX((inside ? DRIVER_CAM.pitch : -0.08) - look.pitch * 0.7);
    return;
  }
  if (camMode === 4 || camMode === 5) { carCam(camMode); return; }
  if (camMode === 6) { tvCam(dt); return; }
  v1.set(fwd.x, 0, fwd.z);
  if (v1.lengthSq() > 0.01) camFwd.lerp(v1.normalize(), 1 - Math.exp(-3 * dt)).normalize();
  const target = chaseSpot(v2);
  target.y = Math.max(target.y, heightAt(target.x, target.z) + 1.2);
  camPos.lerp(target, 1 - Math.exp(-(look.drag ? 20 : 6) * dt));   // dragging: the camera keeps up with the hand
  camera.position.copy(camPos);
  camLook.lerp(v3.copy(car.pos).addScaledVector(camFwd, 2 * Math.max(0, Math.cos(look.yaw))).add(v4.set(0, 0.8, 0)), 1 - Math.exp(-10 * dt));
  camera.lookAt(camLook);
}

const hud = document.getElementById('hud');
let hudT = 0, fps = 60;
// Dial for the in-car view: rev counter around the rim, speed and gear in the middle
const gaugeEl = document.getElementById('gauge'), gctx = gaugeEl.getContext('2d'); let gaugeRpm = 0;
function drawGauge(dt) {
  const show = !ed.on && (MP.on || document.getElementById('menu').style.display === 'none');
  if ((gaugeEl.style.display !== 'none') !== show) gaugeEl.style.display = show ? 'block' : 'none';
  if (!show) return;
  const helpUp = document.getElementById('help').style.display !== 'none'; gaugeEl.style.bottom = (rp.on ? 200 : helpUp ? 124 : 14) + 'px';
  const g = gctx, E = car.eng, lim = ENG.limiter, top = Math.ceil((lim + 400) / 1000) * 1000, A0 = Math.PI * 0.75, A1 = Math.PI * 2.25;
  gaugeRpm += (E.rpm - gaugeRpm) * Math.min(1, dt * 14);
  const ang = r => A0 + (A1 - A0) * clamp(r / top, 0, 1), kmh = Math.abs(car.vel.dot(fwd)) * 3.6;
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, 440, 440); g.translate(220, 220);
  const bg = g.createRadialGradient(0, -40, 20, 0, 0, 212); bg.addColorStop(0, 'rgba(34,36,42,.94)'); bg.addColorStop(1, 'rgba(8,9,11,.94)');
  g.beginPath(); g.arc(0, 0, 212, 0, 7); g.fillStyle = bg; g.fill(); g.lineWidth = 5; g.strokeStyle = 'rgba(210,214,222,.55)'; g.stroke();
  g.lineCap = 'butt'; g.lineWidth = 12;
  g.beginPath(); g.arc(0, 0, 186, A0, A1); g.strokeStyle = 'rgba(255,255,255,.13)'; g.stroke();
  g.beginPath(); g.arc(0, 0, 186, ang(lim - 300), A1); g.strokeStyle = '#e0352b'; g.stroke();
  const hot = gaugeRpm > lim - 500;
  g.beginPath(); g.arc(0, 0, 186, A0, ang(gaugeRpm)); g.strokeStyle = hot ? '#ff5a3c' : '#ffcf6b'; g.stroke();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let r = 0; r <= top; r += 500) {
    const a = ang(r), major = r % 1000 === 0, c = Math.cos(a), sn = Math.sin(a);
    g.beginPath(); g.moveTo(c * 178, sn * 178); g.lineTo(c * (major ? 156 : 167), sn * (major ? 156 : 167)); g.lineWidth = major ? 4 : 2; g.strokeStyle = r >= lim - 300 ? '#ff7a6a' : '#e8eaee'; g.stroke();
    if (major) { g.font = '600 24px system-ui, sans-serif'; g.fillStyle = r >= lim - 300 ? '#ff7a6a' : '#e8eaee'; g.fillText(r / 1000, c * 134, sn * 134); }
  }
  const a = ang(gaugeRpm); g.save(); g.rotate(a); g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 6;
  g.beginPath(); g.moveTo(-26, -5); g.lineTo(172, -1.5); g.lineTo(172, 1.5); g.lineTo(-26, 5); g.closePath(); g.fillStyle = '#ff4a30'; g.fill(); g.restore();
  g.beginPath(); g.arc(0, 0, 96, 0, 7); g.fillStyle = 'rgba(10,11,14,.96)'; g.fill(); g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,.18)'; g.stroke();
  g.fillStyle = '#fff'; g.font = '700 76px system-ui, sans-serif'; g.fillText(kmh.toFixed(0), 0, -14);
  g.fillStyle = '#aab0ba'; g.font = '600 20px system-ui, sans-serif'; g.fillText('km/h', 0, 36);
  g.fillStyle = '#8f96a0'; g.font = '600 17px system-ui, sans-serif'; g.fillText('rpm × 1000', 0, 66);
  // gear, in a box at the bottom opening of the dial
  const gear = E.reverse ? 'R' : String(E.gear ?? 'N');
  g.beginPath(); g.roundRect(-36, 112, 72, 72, 12); g.fillStyle = hot ? '#e0352b' : 'rgba(255,255,255,.1)'; g.fill(); g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,.3)'; g.stroke();
  g.fillStyle = '#fff'; g.font = '700 52px system-ui, sans-serif'; g.fillText(gear, 0, 151);
}
const HUD = { w: null, a: null, b: null, sa: '', sb: '', soft: false };
function hudBuild() {
  hud.innerHTML = `<div class="hw">${car.wheels.map(() => '<i><b></b><u></u></i>').join('')}</div><div class="ht"><div></div><div></div></div>`;
  HUD.w = [...hud.querySelectorAll('.hw i')].map(el => ({ el, slip: el.firstChild, sink: el.lastChild, cls: '', hs: -1, hk: -1 }));
  [HUD.a, HUD.b] = hud.querySelectorAll('.ht div'); HUD.sa = HUD.sb = '';
}
function updateHud(dt) {
  drawGauge(dt);
  fps = lerp(fps, 1 / Math.max(dt, 1e-3), 0.05);
  if ((hudT += dt) < 0.1) return; hudT = 0;
  // (#350) the dial has the speed, the revs and the gear: here the four tires from above (each fills with its slip, the
  // mark beside it is how deep it sinks) and two lines, built once and then only updated
  if (!HUD.w || HUD.w.length !== car.wheels.length) hudBuild();
  const P = PRESSURES[car.pIdx];
  let slipMax = 0, sinkMax = 0, soft = false, touch = false;
  car.wheels.forEach((w, i) => {
    const slip = w.contact ? Math.min(Math.abs(w.slip), 1) : 0, sink = w.contact && !w.deck && !w.surf?.rigid ? w.sink * 100 : 0, e = HUD.w[i];
    if (w.contact) { touch = true; if (!w.deck && !w.surf?.rigid) soft = true; }
    slipMax = Math.max(slipMax, slip); sinkMax = Math.max(sinkMax, sink);
    const cls = !w.contact ? 'air' : slip >= 0.5 ? 'hot' : ''; if (e.cls !== cls) e.el.className = e.cls = cls;
    // (the square root: a slip of a few per cent, where the grip is, already shows; under 1 %, or 1 mm, nothing)
    const hs = slip < 0.01 ? 0 : Math.round(Math.sqrt(slip) * 100), hk = sink < 0.1 ? 0 : Math.round(Math.sqrt(Math.min(sink / 20, 1)) * 100);
    if (e.hs !== hs) e.slip.style.height = (e.hs = hs) + '%';
    if (e.hk !== hk) e.sink.style.height = (e.hk = hk) + '%';
  });
  if (touch) HUD.soft = soft; else soft = HUD.soft;                    // (in the air: as where it last stood)
  const a = `<b>${VEH.short}</b> · ${car.awd ? (VEH === BUGGY ? '4WD' : 'AWD') + (car.split !== 0.5 ? ` ${Math.round(car.split * 100)}/${Math.round((1 - car.split) * 100)}` : '') : (VEH === BUGGY ? '2WD rear' : 'RWD')} · ${P.psi} psi${VEH.aids ? car.aids ? ' · TC/ABS' : ' · <span class="off">TC/ABS off</span>' : ''}`;
  const b = `<span class="s">slip</span> ${String(Math.round(slipMax * 100)).padStart(2)}%${soft ? ` · <span class="k">sinks</span> ${sinkMax.toFixed(1)} cm` : ''} · ${fps.toFixed(0)} fps`;
  if (a !== HUD.sa) HUD.a.innerHTML = HUD.sa = a;
  if (b !== HUD.sb) HUD.b.innerHTML = HUD.sb = b;
}

/* =====================================================================
   CIRCUIT: a closed course through user-editable waypoints. Groomed racing
   line, automatic bridge where the course crosses itself, gates, lap timing.
   ===================================================================== */
const BANK_MAX = 25;                                         // degrees, the editor's Banking slider
const bankOf = v => clamp(Math.round(+v || 0), 0, BANK_MAX);
const levelOf = v => clamp(Math.round(+v || 0), 0, 100);
// the road's steepest grade, % (0: no limit), the editor's Max. grade slider; Optimise sets OPT_GRADE.
// With a limit the grade also changes gently: crests and dips of VCURVE_R or more
const GRADE_MAX = 15, OPT_GRADE = 6, VCURVE_R = 200;
const gradeOf = v => { const g = Math.round(+v || 0); return g > 0 ? clamp(g, 3, GRADE_MAX) : 0; };
// even-grade sections: [first, last] waypoint indices (the road between them at one grade), at most 40
const evenOf = v => Array.isArray(v) ? v.filter(r => Array.isArray(r) && r.length === 2 && r.every(i => Number.isInteger(i) && i >= 0) && r[0] !== r[1]).slice(0, 40).map(r => [r[0], r[1]]) : [];       // %, the editor's Level the road slider
const DEFAULT_WP = (() => { const a = []; for (let i = 0; i < 16; i++) { const t = (i + 0.5) / 16 * TAU; a.push([+(118 * Math.sin(t)).toFixed(1), +(62 * Math.sin(2 * t)).toFixed(1)]); } return a; })();
let COURSE = { wp: DEFAULT_WP.map(p => p.slice()), ops: [], base: 'sand', bridges: [], noBridge: [] };
try {
  const c = JSON.parse(localStorage.getItem('sandbuggy.course') || 'null');
  if (c && Array.isArray(c.wp) && c.wp.length >= 3) COURSE = { wp: c.wp, bank: bankOf(c.bank), level: levelOf(c.level), even: evenOf(c.even), grade: gradeOf(c.grade), ops: Array.isArray(c.ops) ? c.ops : [], base: BASES.includes(c.base) ? c.base : 'sand', road: !!c.road, bridges: Array.isArray(c.bridges) ? c.bridges.filter(b => b && isFinite(b.x) && isFinite(b.z)).map(b => ({ x: +b.x, z: +b.z })) : [], noBridge: Array.isArray(c.noBridge) ? c.noBridge.filter(b => b && isFinite(b.x) && isFinite(b.z)).map(b => ({ x: +b.x, z: +b.z })) : [] };
  else { const sv = localStorage.getItem('sandbuggy.surface'); if (BASES.includes(sv)) COURSE.base = sv; if (sv === 'road') COURSE.road = true; }
} catch (e) { }
if (MP.on || MP.edit) {
  const pc = mpParentCourse();
  MP.courseKey = pc?.key ?? null;
  COURSE = mpCourseFrom(pc?.course, MP.on ? MPQ.get('ground') || 'sand' : null);
}
if (COURSE.road) COURSE.base = 'earth';                      // the road runs through the countryside (#308)
SURF = SURFACES[COURSE.base]; ROAD = !!COURSE.road;
function saveCourse() {
  if (MP.on || MP.edit) return true;
  try { localStorage.setItem('sandbuggy.course', JSON.stringify(COURSE)); return true; }
  catch (e) { flash('Course too big for browser storage: use Export', '#ff8a7a', 3); return false; }
}
const courseKey = () => { let h = 2166136261; for (const ch of JSON.stringify(COURSE.wp) + (COURSE.bank ? 'b' + COURSE.bank : '') + (COURSE.level ? 'l' + COURSE.level : '') + (COURSE.grade ? 'g' + COURSE.grade : '') + (COURSE.even?.length ? 'e' + JSON.stringify(COURSE.even) : '') + (COURSE.bridges?.length || COURSE.noBridge?.length ? JSON.stringify([COURSE.bridges, COURSE.noBridge]) : '')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return (h >>> 0).toString(36); };

const RAMP = 40, DECK_H = 4.4, POST_H = 6, BANNER_Y = POST_H - 0.4;   // gate posts and the banner's centre, above the ground
const GULLY = { ramp: 16, deck: 1.1, depth: 2.6, halfL: 8.5 };   // bridge over a dug wash where the course doesn't cross itself
function buildTrack(wp, spec = COURSE) {
  const curve = new THREE.CatmullRomCurve3(wp.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
  const len = curve.getLength();
  const pts = curve.getSpacedPoints(Math.max(60, Math.ceil(len)));
  const n = pts.length - 1, half = 8;
  const ad = (u, u0) => { let d = u - u0; if (d > 0.5) d -= 1; if (d < -0.5) d += 1; return d * len; };
  // every self-crossing of the course
  const crossings = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[i + 1];
    for (let j = i + 30; j < n; j++) {
      if (i < 30 && j > n - 30 + i) continue;
      const c = pts[j], d = pts[j + 1];
      const den = (b.x - a.x) * (d.z - c.z) - (b.z - a.z) * (d.x - c.x); if (Math.abs(den) < 1e-9) continue;
      const s = ((c.x - a.x) * (d.z - c.z) - (c.z - a.z) * (d.x - c.x)) / den, t = ((c.x - a.x) * (b.z - a.z) - (c.z - a.z) * (b.x - a.x)) / den;
      if (s >= 0 && s <= 1 && t >= 0 && t <= 1) {
        const x = a.x + (b.x - a.x) * s, z = a.z + (b.z - a.z) * s;
        if (!crossings.some(q => Math.hypot(q.x - x, q.z - z) < 20)) crossings.push({ x, z, uA: (i + s) / n, uB: (j + t) / n });
      }
    }
  }
  const nearestU = (x, z) => { let bd = Infinity, bi = 0; for (let i = 0; i < n; i++) { const d = (pts[i].x - x) ** 2 + (pts[i].z - z) ** 2; if (d < bd) { bd = d; bi = i; } } return [bi / n, Math.sqrt(bd)]; };
  const crossBridge = (q, uOver, uUnder, auto) => {
    const to = curve.getTangentAt(uOver).setY(0).normalize(), tu = curve.getTangentAt(uUnder).setY(0).normalize();
    const sinA = Math.abs(to.x * tu.z - to.z * tu.x), halfL = clamp(9.5 / Math.max(sinA, 0.3) + 1, 10.5, 33);
    // the deck is straight: along the chord of the road across it (on a bend the tangent at the crossing points off it)
    const c0 = curve.getPointAt(((uOver - halfL / len) % 1 + 1) % 1), c1 = curve.getPointAt((uOver + halfL / len) % 1), cl = Math.hypot(c1.x - c0.x, c1.z - c0.z) || 1;
    return { kind: 'cross', x: q.x, z: q.z, uOver, uUnder, halfL, tx: (c1.x - c0.x) / cl, tz: (c1.z - c0.z) / cl, deckH: DECK_H, ramp: RAMP, auto, reach: halfL + RAMP + 6 };
  };
  // bridges: the ones placed in the editor, then one at every crossing that hasn't been removed
  const bridges = [], rejected = [], used = new Set();
  const fits = b => bridges.every(o => {
    const gap = (u0, r0, u1, r1) => Math.abs(ad(u0, u1)) > r0 + r1;
    const r = b.reach, ro = o.reach;
    return gap(b.uOver, r, o.uOver, ro) && (!o.uUnder || gap(b.uOver, r, o.uUnder, 32)) && (!b.uUnder || (gap(b.uUnder, 32, o.uOver, ro) && (!o.uUnder || gap(b.uUnder, 32, o.uUnder, 32))));
  });
  for (const pb of spec.bridges || []) {
    let [u, d] = nearestU(pb.x, pb.z); if (d > 16) { rejected.push(pb); continue; }
    const ci = crossings.findIndex(q => Math.abs(ad(u, q.uA)) < 14 || Math.abs(ad(u, q.uB)) < 14);
    let b;
    if (ci >= 0 && !used.has(ci)) { const q = crossings[ci], aOver = Math.abs(ad(u, q.uA)) < Math.abs(ad(u, q.uB)); b = crossBridge(q, aOver ? q.uA : q.uB, aOver ? q.uB : q.uA, false); }
    else if (ci >= 0) { rejected.push(pb); continue; }
    else {
      // a deck is straight: slide to the straightest spot within 30 m, and refuse tight bends
      const dev = u0 => { const p0 = curve.getPointAt(u0), t0 = curve.getTangentAt(u0).setY(0).normalize(); let m = 0;
        for (let sd = -(GULLY.halfL + 6); sd <= GULLY.halfL + 6; sd += 2) { const q = curve.getPointAt(((u0 + sd / len) % 1 + 1) % 1); m = Math.max(m, Math.abs((q.z - p0.z) * t0.x - (q.x - p0.x) * t0.z)); } return m; };
      let bu = u, bdv = dev(u);
      for (let sd = -30; sd <= 30; sd += 3) { const u1 = ((u + sd / len) % 1 + 1) % 1, dv = dev(u1) + Math.abs(sd) * 0.004; if (dv < bdv) { bdv = dv; bu = u1; } }
      if (bdv > 1.3) { rejected.push(pb); pb.why = 'bend'; continue; }
      u = bu;
      const p = curve.getPointAt(u), t = curve.getTangentAt(u).setY(0).normalize(); b = { kind: 'gully', x: p.x, z: p.z, uOver: u, halfL: GULLY.halfL, tx: t.x, tz: t.z, deckH: GULLY.deck, ramp: GULLY.ramp, auto: false, reach: GULLY.halfL + GULLY.ramp + 6 }; }
    if (!fits(b)) { rejected.push(pb); pb.why = 'room'; continue; }
    if (ci >= 0) used.add(ci);
    b.src = pb; bridges.push(b);
  }
  crossings.forEach((q, ci) => {
    if (used.has(ci) || (spec.noBridge || []).some(r => Math.hypot(r.x - q.x, r.z - q.z) < 14)) return;
    const b = crossBridge(q, q.uA, q.uB, true); if (fits(b)) bridges.push(b);
  });
  // gates spread evenly over the parts of the course that are clear of the bridges and their ramps, in lap order
  const okU = u => bridges.every(b => Math.abs(ad(u, b.uOver)) > b.reach + 2 && (!b.uUnder || Math.abs(ad(u, b.uUnder)) > 30));
  const allowed = [], MS = 2000;
  for (let k = 0; k < MS; k++) { const u = (0.08 + k / MS) % 1; if (okU(u)) allowed.push(u); }
  if (!allowed.length) allowed.push(0.08);
  const G = clamp(Math.round(len / 85), 4, 12), gates = [];
  // within each slot, prefer the straightest spot so the posts don't sit on the apex of a bend
  const tA = new THREE.Vector3(), tB = new THREE.Vector3();
  const bendAt = u => { curve.getTangentAt((u - 6 / len + 1) % 1, tA); curve.getTangentAt((u + 6 / len) % 1, tB); return 1 - (tA.x * tB.x + tA.z * tB.z) / (Math.hypot(tA.x, tA.z) * Math.hypot(tB.x, tB.z)); };
  const A = allowed.length, slot = A / G;
  for (let g = 0; g < G; g++) {
    const c0 = Math.floor(g * slot), w = Math.floor(slot * (g === 0 ? 0.15 : 0.3));
    let best = c0, bb = Infinity;
    for (let k = Math.max(0, c0 - w); k <= Math.min(A - 1, c0 + w); k += 2) { const b = bendAt(allowed[k]) + Math.abs(k - c0) / A * 0.02; if (b < bb) { bb = b; best = k; } }
    const u = allowed[best];
    const p = curve.getPointAt(u), t = curve.getTangentAt(u).setY(0).normalize();
    gates.push({ p, t, n: new THREE.Vector3(-t.z, 0, t.x), half: half + 1.5, u });
  }
  return { curve, len, pts, gates, half, crossings, bridges, rejected, cross: bridges.find(b => b.kind === 'cross') || null };
}
let TRACK = buildTrack(COURSE.wp);
// signed arc distance from u0 along the course (wraps)
const arcDist = (u, u0) => { let d = u - u0; if (d > 0.5) d -= 1; if (d < -0.5) d += 1; return d * TRACK.len; };

/* ------------------------- course shape: corner radius, smoothing, banking ------------------------- */
// radius of the circle through three points (Infinity on a straight)
const circR = (a, b, c) => {
  const abx = b[0] - a[0], abz = b[1] - a[1], bcx = c[0] - b[0], bcz = c[1] - b[1], cax = a[0] - c[0], caz = a[1] - c[1];
  const cr = Math.abs(abx * bcz - abz * bcx); return cr < 1e-9 ? Infinity : Math.hypot(abx, abz) * Math.hypot(bcx, bcz) * Math.hypot(cax, caz) / (2 * cr);
};
// the course as a closed polyline every ~ds metres
function coursePoly(wp, ds = 2) {
  const curve = new THREE.CatmullRomCurve3(wp.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
  const n = Math.max(40, Math.round(curve.getLength() / ds));
  return curve.getSpacedPoints(n).slice(0, n).map(v => [v.x, v.z]);
}
// tightest corner, measured over ±8 m so waypoint wiggles don't count as corners
function tightestCorner(P, ds = 2) {
  const n = P.length, h = Math.max(1, Math.round(8 / ds)); let r = Infinity;
  for (let i = 0; i < n; i++) r = Math.min(r, circR(P[(i - h + n) % n], P[i], P[(i + h) % n]));
  return r;
}
// Open every bend tighter than rMin, the way a racing line cuts it: points on a too-tight bend (and a
// run-in either side) move toward their neighbours' midpoint, round after round, until no corner is
// tighter than rMin; straights stay put, and no point goes further than ~rMin from where it was (a
// hairpin between close straights can't open without moving them: it opens as far as that allows).
// Back to waypoints every ~10-16 m, the first one where it was.
function smoothCourse(wp, rWant) {
  const rMin = rWant * 1.12;                 // aim past it: refitting waypoints to the smoothed line loses a little
  const ds = 2, P0 = coursePoly(wp, ds), n = P0.length, h = Math.round(8 / ds), spread = Math.round(16 / ds), reach = rMin * 1.2;
  let P = P0.map(p => p.slice());
  const before = tightestCorner(P0, ds), w = new Float32Array(n);
  let best = { P: P.map(p => p.slice()), r: before }, still = 0;
  for (let it = 0; it < 3000; it++) {
    w.fill(0); let worst = Infinity;
    for (let i = 0; i < n; i++) {
      const r = circR(P[(i - h + n) % n], P[i], P[(i + h) % n]); worst = Math.min(worst, r);
      if (r < rMin) { const f = Math.min(1, (rMin - r) / rMin + 0.3); for (let j = -spread; j <= spread; j++) { const k = (i + j + n) % n; w[k] = Math.max(w[k], f * (1 - Math.abs(j) / (spread + 1))); } }
    }
    if (worst > best.r + 0.05) { best = { P: P.map(p => p.slice()), r: worst }; still = 0; } else if (++still > 300) break;
    if (worst >= rMin * 0.995) break;
    const Q = P.map((p, i) => {
      const a = P[(i - 1 + n) % n], c = P[(i + 1) % n], k = w[i] * 0.5;
      let x = p[0] + ((a[0] + c[0]) / 2 - p[0]) * k, z = p[1] + ((a[1] + c[1]) / 2 - p[1]) * k;
      const o = P0[i], dx = x - o[0], dz = z - o[1], dd = Math.hypot(dx, dz);
      if (dd > reach) { x = o[0] + dx * reach / dd; z = o[1] + dz * reach / dd; }        // tethered
      return [clamp(x, -168, 168), clamp(z, -168, 168)];
    });
    // keep the points evenly spaced (or they bunch up on the bends), each still tied to its original
    P = it % 10 === 9 ? respace(Q, n) : Q;
  }
  P = best.P;
  let len = 0; for (let i = 0; i < n; i++) len += Math.hypot(P[(i + 1) % n][0] - P[i][0], P[(i + 1) % n][1] - P[i][1]);
  const m = clamp(Math.round(len / clamp(rWant * 0.45, 9, 16)), 8, 96), out = [];
  // start at the point nearest the old first waypoint, so the start line stays put
  let i0 = 0, bd = Infinity; P.forEach((p, i) => { const e = (p[0] - wp[0][0]) ** 2 + (p[1] - wp[0][1]) ** 2; if (e < bd) { bd = e; i0 = i; } });
  const R = respace([...P.slice(i0), ...P.slice(0, i0)], m);
  for (const p of R) out.push([+p[0].toFixed(1), +p[1].toFixed(1)]);
  return { wp: out, before, after: tightestCorner(coursePoly(out, ds), ds) };
}
// a closed polyline as m points evenly spaced along it, the first one kept
function respace(P, m) {
  const n = P.length, cum = [0];
  for (let i = 0; i < n; i++) cum.push(cum[i] + Math.hypot(P[(i + 1) % n][0] - P[i][0], P[(i + 1) % n][1] - P[i][1]));
  const L = cum[n], out = []; let j = 0;
  for (let k = 0; k < m; k++) {
    const s = k * L / m; while (cum[j + 1] < s) j++;
    const a = P[j], b = P[(j + 1) % n], t = (s - cum[j]) / ((cum[j + 1] - cum[j]) || 1);
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

// Banking: the cross-slope (rise per metre toward the outside of the bend) for every point of
// TRACK.pts. The angle a car needs at this ground's cornering speed, tan = v^2 / (g R), capped by the
// course's banking angle, eased in and out along the course, and none near bridges and crossings.
// Levelling: the height of the course's centre line (hc, one per TRACK.pts) smoothed along the course,
// three passes of a ±32 m moving average (half a dune's wavelength each side: the crests go, the
// long slopes of the land stay), blended with hc by s (0-1). Where the course crosses itself, both
// branches are brought to the same height, eased in over 40 m either side.
const bridgedCrossing = q => TRACK.bridges.some(b => b.kind === 'cross' && Math.hypot(b.x - q.x, b.z - q.z) < 14);
function levelProfile(hc, s) {
  const n = hc.length - 1, ds = TRACK.len / n, w = Math.max(1, Math.round(32 / ds));
  let cur = Float32Array.from(hc.subarray(0, n));
  for (let pass = 0; pass < 3; pass++) {
    const nx = new Float32Array(n); let sum = 0;
    for (let j = -w; j <= w; j++) sum += cur[(j + n) % n];
    for (let i = 0; i < n; i++) { nx[i] = sum / (2 * w + 1); sum += cur[(i + w + 1) % n] - cur[(i - w + n) % n]; }
    cur = nx;
  }
  for (let i = 0; i < n; i++) cur[i] = lerp(hc[i], cur[i], s);
  const K = Math.max(2, Math.round(40 / ds));
  for (const q of TRACK.crossings) {
    if (bridgedCrossing(q)) continue;                 // a bridge keeps the two branches apart: no common height (#301)
    const ia = Math.round(q.uA * n) % n, ib = Math.round(q.uB * n) % n, hm = (cur[ia] + cur[ib]) / 2, da = hm - cur[ia], db = hm - cur[ib];
    for (let j = -K; j <= K; j++) { const f = 1 - smooth(Math.abs(j) / K); cur[(ia + j + n) % n] += da * f; cur[(ib + j + n) % n] += db * f; }
  }
  const out = new Float32Array(n + 1); out.set(cur); out[n] = out[0];
  return out;
}
// Where each waypoint lies on TRACK.pts (an index): the nearest course point near its share of the
// waypoint polygon's length, so a crossing of the course can't pull it onto the other branch.
function wpPtIndex(wp, pts) {
  const n = pts.length - 1, m = wp.length, cum = [0];
  for (let i = 1; i <= m; i++) { const [ax, az] = wp[i - 1], [bx, bz] = wp[i % m]; cum.push(cum[i - 1] + Math.hypot(bx - ax, bz - az)); }
  const w = Math.ceil(n * 0.08);
  return wp.map(([x, z], i) => {
    const c = Math.round(cum[i] / cum[m] * n); let bi = (c % n + n) % n, bd = Infinity;
    for (let j = c - w; j <= c + w; j++) { const k = ((j % n) + n) % n, e = (pts[k].x - x) ** 2 + (pts[k].z - z) ** 2; if (e < bd) { bd = e; bi = k; } }
    return bi;
  });
}
// Even grade: in each section of COURSE.even the profile goes in a straight line from its height at the first
// waypoint to its height at the last (in place); returns how much each course point is graded (1 inside a
// section, eased to 0 over 8 m past its ends) and each section's grade (%), or null without sections.
// A crossing with one branch in a section and the other not: the other is brought to the section's height.
function evenGrade(prof) {
  const P = TRACK.pts, n = P.length - 1, ds = TRACK.len / n, m = COURSE.wp.length;
  const list = (COURSE.even || []).filter(([a, b]) => a < m && b < m && a !== b);
  if (!list.length) return null;
  const idx = wpPtIndex(COURSE.wp, P), G = new Float32Array(n + 1), grades = [], E = Math.max(1, Math.round(8 / ds));
  for (const [a, b] of list) {
    const ia = idx[a], ib = idx[b], span = (ib - ia + n) % n; if (span < 3) continue;
    const h0 = prof[ia], h1 = prof[ib];
    for (let j = 0; j <= span; j++) { const k = (ia + j) % n; prof[k] = lerp(h0, h1, j / span); G[k] = 1; }
    for (let j = 1; j <= E; j++) { const f = 1 - smooth(j / (E + 1)), k0 = (ia - j + n) % n, k1 = (ib + j) % n; G[k0] = Math.max(G[k0], f); G[k1] = Math.max(G[k1], f); }
    grades.push({ a, b, pct: (h1 - h0) / (span * ds) * 100, len: span * ds });
  }
  const K = Math.max(2, Math.round(40 / ds));
  for (const q of TRACK.crossings) {
    const ia = Math.round(q.uA * n) % n, ib = Math.round(q.uB * n) % n;
    if (bridgedCrossing(q) || (G[ia] >= 1) === (G[ib] >= 1)) continue;
    const [fix, keep] = G[ia] >= 1 ? [ib, ia] : [ia, ib], dh = prof[keep] - prof[fix];
    for (let j = -K; j <= K; j++) { const k = (fix + j + n) % n, f = 1 - smooth(Math.abs(j) / K); prof[k] += dh * f; G[k] = Math.max(G[k], f); }
  }
  prof[n] = prof[0]; G[n] = G[0];
  return { G, grades };
}
// Max. grade: prof (TRACK.pts heights, in place) brought to the nearest profile no steeper than g (0.06 = 6%):
// the mean of the highest one under it and the lowest one above it that keep that grade (each is
// within g of every other point over the distance between them along the course; a crossing counts as
// one point, so both branches keep one height), so the crests are cut and the troughs filled by as
// much as it takes and no more. Then two moving averages g x VCURVE_R each side: the grade stays under
// g, and changes by at most g over that, so crests and dips have a radius of VCURVE_R or more.
function gradeLimit(prof, g) {
  const n = prof.length - 1, ds = TRACK.len / n, step = g * ds;
  // a crossing counts as one point unless a bridge takes one branch over the other
  const X = TRACK.crossings.filter(q => !bridgedCrossing(q)).map(q => [Math.round(q.uA * n) % n, Math.round(q.uB * n) % n]);
  // sgn 1: the highest profile under p no steeper than g; -1: the lowest above it
  const cone = (p, sgn) => {
    const v = new Float64Array(n); for (let i = 0; i < n; i++) v[i] = sgn * p[i];
    for (let it = 0; it < 60; it++) {
      let ch = false;
      for (let r = 0; r < 2; r++) for (let i = 0; i < n; i++) { const k = (i + 1) % n; if (v[k] > v[i] + step + 1e-7) { v[k] = v[i] + step; ch = true; } }
      for (let r = 0; r < 2; r++) for (let i = n - 1; i >= 0; i--) { const k = (i + n - 1) % n; if (v[k] > v[i] + step + 1e-7) { v[k] = v[i] + step; ch = true; } }
      for (const [a, b] of X) { const m = Math.min(v[a], v[b]); if (v[a] > m || v[b] > m) { v[a] = v[b] = m; ch = true; } }
      if (!ch) break;
    }
    for (let i = 0; i < n; i++) v[i] *= sgn;
    return v;
  };
  const mid = p => { const U = cone(p, 1), L = cone(p, -1); return U.map((u, i) => (u + L[i]) / 2); };
  const box = (p, w) => { const o = new Float64Array(n); let sum = 0;
    for (let j = -w; j <= w; j++) sum += p[(j + n) % n];
    for (let i = 0; i < n; i++) { o[i] = sum / (2 * w + 1); sum += p[(i + w + 1) % n] - p[(i - w + n) % n]; }
    return o; };
  const w = Math.max(1, Math.round(clamp(g * VCURVE_R, 5, 40) / ds));
  let p = box(box(mid(prof), w), w);
  // the averages moved the crossings' branches apart a little: back together, eased over 40 m, and the grade once more
  const K = Math.max(2, Math.round(40 / ds));
  for (const [a, b] of X) { const hm = (p[a] + p[b]) / 2, da = hm - p[a], db = hm - p[b];
    for (let j = -K; j <= K; j++) { const f = 1 - smooth(Math.abs(j) / K); p[(a + j + n) % n] += da * f; p[(b + j + n) % n] += db * f; } }
  p = mid(p);
  for (let i = 0; i < n; i++) prof[i] = p[i];
  prof[n] = prof[0];
}
// the sharpest crest or dip of a height profile: its smallest radius (m) over 10 m either side, leaving out the bridges' ramps
function sharpestCrest(prof) {
  const n = prof.length - 1, ds = TRACK.len / n, b = Math.max(1, Math.round(10 / ds)); let k = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    if (TRACK.bridges.some(X => Math.abs(arcDist(u, X.uOver)) < X.reach || (X.uUnder != null && Math.abs(arcDist(u, X.uUnder)) < 30))) continue;
    k = Math.max(k, Math.abs(prof[(i + b) % n] - 2 * prof[i] + prof[(i - b + n) % n]) / (b * ds) ** 2);
  }
  return k ? 1 / k : Infinity;
}
// steepest grade of a height profile along the course, in %, over 10 m, leaving out the bridges' ramps
function steepestGrade(prof) {
  const n = prof.length - 1, ds = TRACK.len / n, hw = Math.max(1, Math.round(5 / ds)); let g = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    if (TRACK.bridges.some(b => Math.abs(arcDist(u, b.uOver)) < b.reach || (b.uUnder != null && Math.abs(arcDist(u, b.uUnder)) < 30))) continue;
    g = Math.max(g, Math.abs(prof[(i + hw) % n] - prof[(i - hw + n) % n]) / (2 * hw * ds));
  }
  return g * 100;
}
// Where (x, z) lies along the course, from its nearest course point pi: on the segment from point a
// to b = a + 1, t (0-1) of the way (ticket #292: heights taken at the nearest point alone came out
// as steps a point apart, about 1 m, ridges across the road on every slope)
function alongCourse(pi, x, z) {
  const P = TRACK.pts, n = P.length - 1, a = pi % n, p = P[a], q = P[a + 1];
  let dx = q.x - p.x, dz = q.z - p.z, t = ((x - p.x) * dx + (z - p.z) * dz) / (dx * dx + dz * dz || 1);
  if (t >= 0) return [a, a + 1, Math.min(t, 1)];
  const b = a || n, o = P[b - 1]; dx = p.x - o.x; dz = p.z - o.z;
  return [b - 1, b, clamp(((x - o.x) * dx + (z - o.z) * dz) / (dx * dx + dz * dz || 1), 0, 1)];
}

function trackBank() {
  const P = TRACK.pts, n = P.length - 1, out = new Float32Array(n + 1);
  if (!COURSE.bank) return out;
  const cap = Math.tan(COURSE.bank * Math.PI / 180), ds = TRACK.len / n, h = Math.max(2, Math.round(6 / ds));
  const tar = ROAD, v = tar ? 24 : COURSE.base === 'earth' ? 18 : 14;     // m/s through a bend on asphalt / earth / sand
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = P[(i - h + n) % n], b = P[i], c = P[(i + h) % n];
    const R = circR([a.x, a.z], [b.x, b.z], [c.x, c.z]); if (!isFinite(R)) continue;
    // which way it bends: + when the course turns toward its normal (-t.z, t.x)
    const tx = c.x - a.x, tz = c.z - a.z, side = Math.sign((c.x - b.x) * (-tz) + (c.z - b.z) * tx - ((b.x - a.x) * (-tz) + (b.z - a.z) * tx));
    raw[i] = -side * Math.min(cap, v * v / (9.81 * R));   // the outside of the bend is the high side
  }
  // ease in and out: two passes of a ±12 m moving average
  const w = Math.max(1, Math.round(12 / ds)); let cur = raw;
  for (let pass = 0; pass < 2; pass++) { const nx = new Float32Array(n); for (let i = 0; i < n; i++) { let sum = 0; for (let j = -w; j <= w; j++) sum += cur[(i + j + n) % n]; nx[i] = sum / (2 * w + 1); } cur = nx; }
  for (let i = 0; i < n; i++) {
    const u = i / n; let f = 1;
    for (const b of TRACK.bridges) {
      f = Math.min(f, smooth(clamp((Math.abs(arcDist(u, b.uOver)) - b.reach) / 25, 0, 1)));
      if (b.uUnder != null) f = Math.min(f, smooth(clamp((Math.abs(arcDist(u, b.uUnder)) - 30) / 25, 0, 1)));
    }
    for (const q of TRACK.crossings) f = Math.min(f, smooth(clamp((Math.hypot(P[i].x - q.x, P[i].z - q.z) - 20) / 25, 0, 1)));
    out[i] = clamp(cur[i], -cap, cap) * f;
  }
  out[n] = out[0];
  return out;
}

function groomTrack() {
  // D: distance to the course; I: the nearest course point (TRACK.pts), out to 16 m for the banking
  // (out to 24 m when levelling: its cut and fill slopes reach further)
  const D = new Float32Array(V * V).fill(99), I = new Int32Array(V * V), RAD = ROAD ? 12 : 10, BANK_RAD = 16, LEVEL_RAD = 24, LEVEL_W = 8, rc = Math.ceil((COURSE.level || COURSE.grade || COURSE.even?.length ? LEVEL_RAD : COURSE.bank ? BANK_RAD : RAD) / CELL);
  // (#326: the distances from a table, the same Math.hypot values; the rows clipped to the world once, not each cell)
  const span = 2 * rc + 1, DT = new Float64Array(span * span);
  for (let dj = -rc; dj <= rc; dj++) for (let di = -rc; di <= rc; di++) DT[(dj + rc) * span + di + rc] = Math.hypot(di, dj) * CELL;
  TRACK.pts.forEach((p, pi) => {
    const ci = Math.round((p.x + HALF) / CELL), cj = Math.round((p.z + HALF) / CELL), di0 = Math.max(-rc, -ci), di1 = Math.min(rc, N - ci);
    for (let dj = Math.max(-rc, -cj), dj1 = Math.min(rc, N - cj); dj <= dj1; dj++) {
      const row = (dj + rc) * span + rc, kr = (cj + dj) * V + ci;
      for (let di = di0; di <= di1; di++) { const d = DT[row + di], k = kr + di; if (d < D[k]) { D[k] = d; I[k] = pi; } }
    }
  });
  // separable box blur of the dunes (≈4 m) used to soften crests and slip faces on the racing line
  const r = 16, tmp = new Float32Array(V * V), bl = new Float32Array(V * V);
  for (let j = 0; j < V; j++) { let s = 0, n = 0; const o = j * V;
    for (let i = -r; i < V; i++) { if (i + r < V) { s += B[o + i + r]; n++; } if (i - r - 1 >= 0) { s -= B[o + i - r - 1]; n--; } if (i >= 0) tmp[o + i] = s / n; } }
  for (let i = 0; i < V; i++) { let s = 0, n = 0;
    for (let j = -r; j < V; j++) { if (j + r < V) { s += tmp[(j + r) * V + i]; n++; } if (j - r - 1 >= 0) { s -= tmp[(j - r - 1) * V + i]; n--; } if (j >= 0) bl[j * V + i] = s / n; } }
  for (let k = 0; k < V * V; k++) {
    RM[k] = D[k] < ROAD_HALF ? 1 : 0;
    if (D[k] >= RAD) continue;
    const w = 1 - smooth(clamp((D[k] - 6) / 4, 0, 1));
    B[k] = lerp(B[k], bl[k], 0.7 * w);
    C[k] = 0.3 * w;                       // traffic-packed ground on the course
  }
  if (ROAD) {                             // a road is graded: a longer blur (≈10 m) under the paved strip and its shoulders
    const r2 = 40, t2 = new Float32Array(V * V), b2 = new Float32Array(V * V);
    for (let j = 0; j < V; j++) { let s = 0, n = 0; const o = j * V;
      for (let i = -r2; i < V; i++) { if (i + r2 < V) { s += B[o + i + r2]; n++; } if (i - r2 - 1 >= 0) { s -= B[o + i - r2 - 1]; n--; } if (i >= 0) t2[o + i] = s / n; } }
    for (let i = 0; i < V; i++) { let s = 0, n = 0;
      for (let j = -r2; j < V; j++) { if (j + r2 < V) { s += t2[(j + r2) * V + i]; n++; } if (j - r2 - 1 >= 0) { s -= t2[(j - r2 - 1) * V + i]; n--; } if (j >= 0) b2[j * V + i] = s / n; } }
    for (let k = 0; k < V * V; k++) if (D[k] < RAD) B[k] = lerp(B[k], b2[k], 0.9 * (1 - smooth(clamp((D[k] - ROAD_HALF - 1) / 4, 0, 1))));
  }
  // banking: across the course the ground rises toward the outside of each bend, level with the
  // groomed centre line, full width to 9 m out, then back into the dunes by 16 m.
  // Levelling (COURSE.level): the centre line follows levelProfile instead, the road is that height
  // across (plus the banking) to 8 m out, and the cut or fill slopes back into the dunes at about
  // 1 in 2.5 (4 to 16 m wide).
  TRACK.bank = trackBank(); TRACK.grade = null; TRACK.even = null;
  if (COURSE.bank || COURSE.level || COURSE.grade || COURSE.even?.length) {
    const P = TRACK.pts, np = P.length - 1, hc = new Float32Array(np + 1), nx = new Float32Array(np + 1), nz = new Float32Array(np + 1);
    const Bat = (x, z) => { const fx = clamp((x + HALF) / CELL, 0, N - 1e-4), fz = clamp((z + HALF) / CELL, 0, N - 1e-4), i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, k = j * V + i;
      return (B[k] * (1 - tx) + B[k + 1] * tx) * (1 - tz) + (B[k + V] * (1 - tx) + B[k + V + 1] * tx) * tz; };
    for (let i = 0; i <= np; i++) {
      const a = P[(i - 1 + np) % np], c = P[(i + 1) % np], tl = Math.hypot(c.x - a.x, c.z - a.z) || 1;
      hc[i] = Bat(P[i].x, P[i].z); nx[i] = -(c.z - a.z) / tl; nz[i] = (c.x - a.x) / tl;
    }
    // lv: the road is graded all round (levelled, or held to a max. grade)
    const lv = COURSE.level || COURSE.grade, prof = COURSE.level ? levelProfile(hc, COURSE.level / 100) : Float32Array.from(hc), bk = TRACK.bank;
    if (COURSE.grade) gradeLimit(prof, COURSE.grade / 100);
    const EV = evenGrade(prof), G = EV?.G; TRACK.even = EV?.grades || null;     // even-grade sections, on top of the levelling
    if (lv) TRACK.grade = { before: steepestGrade(hc), after: steepestGrade(prof), crest: COURSE.grade ? sharpestCrest(prof) : null };
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const k = j * V + i; if (D[k] >= (lv || G ? LEVEL_RAD : BANK_RAD)) continue;
      // between the two course points the cell lies by, not at the nearest one (that made ~1 m steps)
      const x = -HALF + i * CELL, z = -HALF + j * CELL, [a, b, t] = alongCourse(I[k], x, z), at = A => lerp(A[a], A[b], t);
      const gr = lv ? 1 : G ? at(G) : 0;                 // how much this is graded road (levelled, or an even-grade section)
      if (!gr && !bk[a] && !bk[b]) continue;
      const sl = at(bk), l = (x - lerp(P[a].x, P[b].x, t)) * at(nx) + (z - lerp(P[a].z, P[b].z, t)) * at(nz), tgt = at(prof) + l * sl;
      if (!gr) { B[k] = lerp(B[k], tgt, 1 - smooth(clamp((D[k] - 9) / 7, 0, 1))); continue; }
      const w = 1 - smooth(clamp((D[k] - LEVEL_W) / clamp(2.5 * Math.abs(tgt - B[k]), 4, LEVEL_RAD - LEVEL_W), 0, 1));
      B[k] = lerp(B[k], tgt, w * gr);
      if (D[k] < RAD) C[k] = Math.max(C[k], 0.3 * w * gr);     // packed ground across the graded width
    }
  }
  BRIDGES.length = 0;
  for (const X of TRACK.bridges) buildEmbankments(X);
}

// Bridge earthworks (#301). Over-pass: ramps of one even grade (rounded off over their ends) from the
// road's own height RAMP m out (up to 1.5 x RAMP, for 8%) to the deck. Under-pass of a crossing: a cutting, CUT m below the ground at
// the crossing under the deck, on even grades of at most 7% in and out, banks of 1 in 1.5; the deck stands
// CLEAR m above its bed (4 m under the girders). A gully bridge digs its wash and ramps up the same way.
const CUT = 2.4, CLEAR = 5.0;
// 0 → 1 at one even grade, rounded off over the first and last e (zero slope at both ends)
const evenRamp = (t, e) => {
  t = clamp(t, 0, 1); const v = 1 / (1 - e);
  if (t < e) return v * t * t / (2 * e);
  if (t > 1 - e) { const r = 1 - t; return 1 - v * r * r / (2 * e); }
  return v * (t - e / 2);
};
function buildEmbankments(X) {
  const P = TRACK.pts, n = P.length - 1, ds = TRACK.len / n, a0 = X.halfL - 0.5, RAMP = X.ramp, gully = X.kind === 'gully';
  const ci0 = Math.round((X.x + HALF) / CELL), cj0 = Math.round((X.z + HALF) / CELL);
  const g0 = B[cj0 * V + ci0], bed = g0 - (gully ? GULLY.depth : CUT), top = gully ? g0 + X.deckH : bed + CLEAR;
  const hw = ROAD ? ROAD_HALF + 0.6 : 3.6, FT = hw + 1.4, CW = hw + 1.9;   // deck, ramp top, cutting bed (half-widths)
  BRIDGES.push({ cx: X.x, cz: X.z, tx: X.tx, tz: X.tz, halfL: X.halfL, halfW: hw, top, abut: top - bed + 0.6, kind: X.kind });
  // the ground as it is before any of this, along the course s metres from u0
  const Bat = (x, z) => { const fx = clamp((x + HALF) / CELL, 0, N - 1e-4), fz = clamp((z + HALF) / CELL, 0, N - 1e-4), i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, k = j * V + i;
    return (B[k] * (1 - tx) + B[k + 1] * tx) * (1 - tz) + (B[k + V] * (1 - tx) + B[k + V + 1] * tx) * tz; };
  const hAlong = (u0, s) => { const p = P[((Math.round(u0 * n + s / ds)) % n + n) % n]; return Bat(p.x, p.z); };
  // each ramp: long enough for 8% if it can be (up to 1.5 x RAMP), from the road's own height where it starts
  const foot = [0, 0], RL = [RAMP, RAMP];
  for (const [i, sg] of [[0, -1], [1, 1]]) for (let it = 0; it < 2; it++) { foot[i] = hAlong(X.uOver, sg * (a0 + RL[i])); RL[i] = clamp(Math.abs(top - foot[i]) / 0.08, RAMP, RAMP * 1.5); }
  // the cutting: flat under the deck (±F), then up at ≤ 7% to the road's own height at ±Lc
  const F = 9, Lc = [0, 0], hu = [0, 0];
  if (!gully) for (const [i, sg] of [[0, -1], [1, 1]]) {
    let h = hAlong(X.uUnder, sg * 45); Lc[i] = clamp(F + Math.max(0, h - bed) / 0.07, 24, 45);
    h = hAlong(X.uUnder, sg * Lc[i]); Lc[i] = clamp(F + Math.max(0, h - bed) / 0.07, 24, 45);
    hu[i] = hAlong(X.uUnder, sg * Lc[i]);          // the road's height where the cutting ends (not where it was measured from): no step there
  }
  const over = [], under = [];
  P.forEach((p, i) => { const u = i / n, so = arcDist(u, X.uOver), su = gully ? 99 : arcDist(u, X.uUnder);
    if (Math.abs(so) < a0 + RAMP * 1.5 + 6) over.push([p.x, p.z, i]); if (Math.abs(su) < 52) under.push([p.x, p.z, i]); });
  // [distance to the course, arc distance from u0 along it], measured between course points (alongCourse)
  // (#326) each list's nearest point for every cell, found as groomTrack finds its own: each point's square in turn, in list
  // order (a tie goes to the first, as a scan of the list does), out to just past the farthest the earthworks look (the
  // cutting: CW + 12, the ramp's side slope: FT + 6): beyond that a cell is left as it is, whichever point is nearest
  let WIN = null;
  const field = (list, R) => {
    const w = WIN ||= { i0: Math.max(1, ci0 - rc), i1: Math.min(N - 1, ci0 + rc), j0: Math.max(1, cj0 - rc), j1: Math.min(N - 1, cj0 + rc) }, W = w.i1 - w.i0 + 1;
    const D = new Float64Array(W * (w.j1 - w.j0 + 1)).fill(Infinity), I = new Int32Array(D.length).fill(-1), nr = Math.ceil(R / CELL);
    for (const [px, pz, pi] of list) {
      const pci = Math.round((px + HALF) / CELL), pcj = Math.round((pz + HALF) / CELL);
      for (let j = Math.max(w.j0, pcj - nr), jm = Math.min(w.j1, pcj + nr); j <= jm; j++) for (let i = Math.max(w.i0, pci - nr), im = Math.min(w.i1, pci + nr); i <= im; i++) {
        const x = -HALF + i * CELL, z = -HALF + j * CELL, d = (px - x) ** 2 + (pz - z) ** 2, k = (j - w.j0) * W + i - w.i0;
        if (d < D[k]) { D[k] = d; I[k] = pi; }
      }
    }
    return I;
  };
  const nearest = (list, x, z, u0) => {
    const F = list.field ||= field(list, list === under ? CW + 14 : FT + 8), w = WIN;
    const bi = F[(Math.round((z + HALF) / CELL) - w.j0) * (w.i1 - w.i0 + 1) + Math.round((x + HALF) / CELL) - w.i0];
    if (bi < 0) return [1e5, 0];
    const [a, b, t] = alongCourse(bi, x, z); return [Math.hypot(x - lerp(P[a].x, P[b].x, t), z - lerp(P[a].z, P[b].z, t)), arcDist((a + t) / n, u0)]; };
  const R0 = Math.max(a0 + RAMP * 1.5 + 14, gully ? 0 : 45 + 16), rc = Math.ceil(R0 / CELL);
  const hRoad = new Map(under.map(([x, z, i]) => [i, Bat(x, z)]));         // the road's own height along the under-road, before the cutting
  for (let j = Math.max(1, cj0 - rc); j <= Math.min(N - 1, cj0 + rc); j++) for (let i = Math.max(1, ci0 - rc); i <= Math.min(N - 1, ci0 + rc); i++) {
    const x = -HALF + i * CELL, z = -HALF + j * CELL, k = j * V + i;
    if (gully) {         // a dry wash dug across the course under the deck, with sloping banks
      const la = Math.abs((x - X.x) * X.tx + (z - X.z) * X.tz), lb = Math.abs((z - X.z) * X.tx - (x - X.x) * X.tz);
      const wd = (1 - smooth(clamp((la - (a0 - 4.5)) / 4, 0, 1))) * (1 - smooth(clamp((lb - 20) / 14, 0, 1)));
      if (wd > 0) { B[k] = Math.min(B[k], lerp(B[k], bed, wd)); C[k] = Math.max(C[k], 0.25 * wd); if (wd > 0.15) RM[k] = 0; }   // the wash bed is never paved
    } else {
      const [du, su] = nearest(under, x, z, X.uUnder), as = Math.abs(su), sd = su < 0 ? 0 : 1;
      if (as < Lc[sd] && du < CW + 12) {          // the cutting: the road at its grade, banks of 1 in 1.5 up to the ground
        // the cutting's bed at its grade, and over its last 10 m the road's own cross-fall (banking) coming back in, so it meets the road beyond it
        const cross = (B[k] - (hRoad.get(((Math.round(X.uUnder * n + su / ds)) % n + n) % n) ?? B[k])) * (1 - smooth(clamp((Lc[sd] - as) / 10, 0, 1)));
        const t = (as <= F ? bed : bed + (hu[sd] - bed) * evenRamp((as - F) / (Lc[sd] - F), 0.25)) + cross;
        if (du < CW) { B[k] = t; C[k] = Math.max(C[k], 0.35); }
        else B[k] = Math.min(B[k], t + (du - CW) / 1.5);
      }
    }
    const [dov, so] = nearest(over, x, z, X.uOver);
    const a = Math.abs(so);
    const sd = so < 0 ? 0 : 1;
    if (a < a0 || a > a0 + RL[sd] || dov > FT + 6) continue;
    const prof = top - (top - foot[sd]) * evenRamp((a - a0) / RL[sd], 0.2);           // even grade, down from the deck
    const wl = 1 - smooth(clamp((dov - FT) / 6, 0, 1));                              // flat top FT m each side, then a side slope
    const we = dov <= hw + 1.2 ? 1 : smooth(clamp((a - a0) / 4, 0, 1));               // past the abutment's width: a sloped end, not a cliff
    B[k] = lerp(B[k], prof, wl * we); C[k] = Math.max(C[k], 0.5 * wl * we);
  }
}

/* ------------------------- terrain edit ops (raise / lower / flatten / smooth / paint) ------------------------- */
function applyOp(op, live) {
  const ci = (op.x + HALF) / CELL, cj = (op.z + HALF) / CELL, rc = op.r / CELL;
  const i0 = Math.max(1, Math.floor(ci - rc)), i1 = Math.min(N - 1, Math.ceil(ci + rc));
  const j0 = Math.max(1, Math.floor(cj - rc)), j1 = Math.min(N - 1, Math.ceil(cj + rc));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const d = Math.hypot(i - ci, j - cj) / rc; if (d >= 1) continue;
    const w = smooth(1 - d), k = j * V + i;
    let dh = 0;
    switch (op.t) {
      case 'raise': dh = op.s * w; break;
      case 'lower': dh = -op.s * w; break;
      case 'flatten': dh = (op.h - B[k]) * Math.min(1, op.s * w); break;
      case 'smooth':
        if (op.v === 2) {                                           // wide kernel: averages over half the brush, so it levels dunes and ruts, not just ripples
          const n = Math.max(1, Math.round(rc * 0.55)), ia = Math.max(0, i - n), ib = Math.min(N, i + n), ja = Math.max(0, j - n) * V, jb = Math.min(N, j + n) * V, jc = j * V;
          const m = Math.max(1, n >> 1), ic = Math.max(0, i - m), id = Math.min(N, i + m), je = Math.max(0, j - m) * V, jf = Math.min(N, j + m) * V;
          const avg = (B[jc + ia] + B[jc + ib] + B[ja + i] + B[jb + i] + B[ja + ia] + B[ja + ib] + B[jb + ia] + B[jb + ib] + B[jc + ic] + B[jc + id] + B[je + i] + B[jf + i]) / 12;
          dh = (avg - B[k]) * Math.min(1, op.s * w * 6);
        } else dh = ((B[k - 1] + B[k + 1] + B[k - V] + B[k + V]) / 4 - B[k]) * Math.min(1, op.s * w * 4);
        break;
      case 'sand': if (w > 0.25) M[k] = 1; break;
      case 'earth': if (w > 0.25) M[k] = 2; break;
      case 'road': if (w > 0.25) M[k] = 3; break;
      case 'erase': if (w > 0.25) M[k] = 0; break;
    }
    if (dh) { B[k] += dh; H[k] += dh; }
  }
  if (live) markDirty(i0, j0, i1, j1);
}

function labelTex(text, checker) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 64;
  const g = c.getContext('2d');
  if (checker) { for (let x = 0; x < 64; x++) for (let y = 0; y < 4; y++) { g.fillStyle = (x + y) % 2 ? '#111' : '#fff'; g.fillRect(x * 16, y * 16, 16, 16); } }
  else { g.fillStyle = '#f5f2ea'; g.fillRect(0, 0, 1024, 64); g.fillStyle = '#ff5a00'; g.fillRect(0, 0, 1024, 8); g.fillRect(0, 56, 1024, 8); }
  g.font = 'bold 40px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  if (checker) { g.fillStyle = '#ff5a00'; g.fillRect(352, 8, 320, 48); }
  g.fillStyle = checker ? '#fff' : '#222'; g.fillText(text, 512, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
const nearBridge = (x, z, extra) => TRACK.bridges.some(b => Math.hypot(x - b.x, z - b.z) < b.halfL + extra);

// Paint direction chevrons (and a checkered start line) along the course into a world-space texture
const paintCanvas = document.createElement('canvas'); paintCanvas.width = paintCanvas.height = 4096;
function paintCourse() {
  const S = 4096, c = paintCanvas, g = c.getContext('2d'), k = S / WORLD;
  g.clearRect(0, 0, S, S);
  const P = (x, z) => [(x + HALF) * k, (1 - (z + HALF) / WORLD) * S];
  if (ROAD) {                     // road markings: solid edge lines, dashed centre line
    const line = (off, dash, gap, wid, col) => {
      g.strokeStyle = col; g.lineWidth = wid * k; g.globalAlpha = 0.9; g.lineCap = 'butt';
      let on = true, run = 0; g.beginPath(); let started = false;
      for (let d = 0; d <= TRACK.len; d += 0.5) {
        const u = Math.min(d / TRACK.len, 1), p = TRACK.curve.getPointAt(u), t = TRACK.curve.getTangentAt(u).setY(0).normalize();
        const [x, y] = P(p.x - t.z * off, p.z + t.x * off);
        if (TRACK.bridges.some(b => b.kind === 'gully' && Math.abs(arcDist(u, b.uOver)) < b.halfL)) { if (started) { g.stroke(); g.beginPath(); started = false; } run += 0.5; continue; }
        if (on) { started ? g.lineTo(x, y) : g.moveTo(x, y); started = true; }
        run += 0.5;
        if (dash && run >= (on ? dash : gap)) { run = 0; if (on) { g.stroke(); g.beginPath(); started = false; } on = !on; }
      }
      g.stroke();
    };
    line(ROAD_HALF - 1.5, 0, 0, 0.15, '#f2f0e8'); line(-(ROAD_HALF - 1.5), 0, 0, 0.15, '#f2f0e8');
    line(0, 3, 6, 0.13, '#f2f0e8');
  } else
  for (let d = 6; d < TRACK.len - 4; d += 9) {
    const u = d / TRACK.len, p = TRACK.curve.getPointAt(u), t = TRACK.curve.getTangentAt(u).setY(0).normalize();
    if (TRACK.gates.some(gt => Math.hypot(gt.p.x - p.x, gt.p.z - p.z) < 4) || nearBridge(p.x, p.z, 3)) continue;
    const r = { x: -t.z, z: t.x };
    const pt = (a, b) => P(p.x + t.x * a + r.x * b, p.z + t.z * a + r.z * b);   // a: along course, b: across
    g.globalAlpha = 0.82; g.fillStyle = '#f7f3e8';
    for (const off of [-0.9, 1.0]) {                       // double chevron ">>"
      g.beginPath();
      [[1.6 + off, 0], [-0.4 + off, 2.6], [-1.4 + off, 2.6], [0.6 + off, 0], [-1.4 + off, -2.6], [-0.4 + off, -2.6]]
        .forEach(([a, b], i) => { const [x, y] = pt(a, b); i ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.closePath(); g.fill();
    }
  }
  const g0 = TRACK.gates[0], r0 = { x: -g0.t.z, z: g0.t.x }, sq = 1.0;
  for (let i = -8; i < 8; i++) for (let j = 0; j < 2; j++) {
    g.globalAlpha = 0.9; g.fillStyle = (i + j) % 2 ? '#111' : '#f7f3e8';
    const q = [[j, i], [j + 1, i], [j + 1, i + 1], [j, i + 1]].map(([a, b]) => P(g0.p.x + g0.t.x * (a - 1) * sq + r0.x * b * sq, g0.p.z + g0.t.z * (a - 1) * sq + r0.z * b * sq));
    g.beginPath(); q.forEach(([x, y], n) => n ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.fill();
  }
  if (!paintU.value) {
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    paintU.value = tex;
  }
  paintU.value.needsUpdate = true;
}

let circuitGroup = null;
function buildBridge(parent, BRIDGE) {
  const g = new THREE.Group(); parent.add(g);
  g.position.set(BRIDGE.cx, 0, BRIDGE.cz); g.rotation.y = Math.atan2(BRIDGE.tx, BRIDGE.tz);
  const plankTex = canvasTex(256, (x, y) => { const pl = Math.floor(y * 16); const v = 0.55 + 0.2 * Math.sin(pl * 12.9) + 0.045 * Math.sin(x * 60 + pl * 3); return (y * 16) % 1 < 0.06 ? 0.2 : v + Math.random() * 0.06; }, true);
  plankTex.repeat.set(1, BRIDGE.halfL / 3.5);
  const wood = new THREE.MeshStandardMaterial({ color: 0xb08a62, map: plankTex, roughness: 0.85 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x5b6470, roughness: 0.45, metalness: 0.8 });
  const conc = new THREE.MeshStandardMaterial({ color: 0xb9b1a4, roughness: 0.95 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xff5a00, roughness: 0.7 });
  const L = BRIDGE.halfL * 2, W = BRIDGE.halfW * 2, top = BRIDGE.top;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(W, 0.18, L), wood); deck.position.y = top - 0.09; g.add(deck);
  for (const s of [1, -1]) {
    const gi = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.8, L), steel); gi.position.set(s * (W / 2 - 0.4), top - 0.58, 0); g.add(gi);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, L), steel); rail.position.set(s * (W / 2 - 0.05), top + 0.9, 0); g.add(rail);
    const kerb = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.22, L), orange); kerb.position.set(s * (W / 2 - 0.12), top + 0.11, 0); g.add(kerb);
    for (let z = -L / 2 + 0.3; z <= L / 2; z += 1.6) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 0.08), steel); post.position.set(s * (W / 2 - 0.05), top + 0.45, z); g.add(post); }
    for (let z = -L / 2 + 1; z < L / 2; z += 3.2) { const x = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 1.5), steel); x.position.set(s * (W / 2 - 0.4), top - 0.58, z); x.rotation.x = 0.9; g.add(x); }
    const ab = new THREE.Mesh(new THREE.BoxGeometry(W + 2.4, BRIDGE.abut, 1.2), conc); ab.position.set(0, top - BRIDGE.abut / 2 - 0.1, s * (L / 2 - 0.4)); g.add(ab);
  }
}

function buildCircuit() {
  if (circuitGroup) { scene.remove(circuitGroup); circuitGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
  circuitGroup = new THREE.Group(); scene.add(circuitGroup);
  for (const D of BRIDGES) buildBridge(circuitGroup, D);
  paintCourse();
  const stripe = canvasTex(64, (x, y) => (Math.floor(y * 8) % 2 ? 1 : 0.0), true);
  const postMat = new THREE.MeshStandardMaterial({ color: 0xff6a10, map: stripe, roughness: 0.6 });
  const postGeo = new THREE.CylinderGeometry(0.11, 0.14, POST_H, 10);
  for (const [i, g] of TRACK.gates.entries()) {
    g.posts = [];
    for (const s of [1, -1]) {
      const x = g.p.x + g.n.x * g.half * s, z = g.p.z + g.n.z * g.half * s, h = heightAt(x, z);
      const pivot = new THREE.Group(); pivot.position.set(x, h - 0.2, z); circuitGroup.add(pivot);
      const post = new THREE.Mesh(postGeo, g.postMat ||= postMat.clone()); post.position.y = POST_H / 2; pivot.add(post);
      g.posts.push({ x, z, y: h, pivot, tilt: 0, bend: 0, tv: 0, axis: new THREE.Vector3(1, 0, 0), down: false, hits: 0 });
    }
    const mat = new THREE.MeshStandardMaterial({ map: labelTex(i === 0 ? 'START / FINISH' : `CHECKPOINT ${i}`, i === 0), side: THREE.DoubleSide, roughness: 0.8, emissive: 0x000000 });
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(g.half * 2, 1.0), mat);
    banner.position.set(g.p.x, (g.posts[0].y + g.posts[1].y) / 2 + BANNER_Y, g.p.z);
    banner.lookAt(banner.position.clone().sub(g.t));   // readable when approaching
    circuitGroup.add(banner);
    g.mat = mat; g.fadeMats = [mat, g.postMat]; g.fade = 1; g.banner = banner; g.bannerQ0 = banner.quaternion.clone(); g.bannerP0 = banner.position.clone(); g.fall = null;
  }
  // course-edge marker flags every 12 m
  const every = 12, n = Math.floor(TRACK.len / every) * 2 + 2;
  const poleI = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.018, 0.018, 1.5, 5), new THREE.MeshStandardMaterial({ color: 0x222222 }), n);
  const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.7, 0, 0, 0.42, 0, 0, 0.56, -0.42], 3)); fg.computeVertexNormals();
  const flagI = new THREE.InstancedMesh(fg, new THREE.MeshStandardMaterial({ color: 0xff5a00, side: THREE.DoubleSide }), n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  let k = 0;
  for (let d = 0; d + every / 2 < TRACK.len && k < n - 1; d += every) {
    const u = d / TRACK.len, p = TRACK.curve.getPointAt(u), t = TRACK.curve.getTangentAt(u).setY(0).normalize();
    if (TRACK.bridges.some(b => Math.abs(arcDist(u, b.uOver)) < b.halfL + b.ramp) || nearBridge(p.x, p.z, 4)) continue;
    for (const s of [1, -1]) {
      const x = p.x - t.z * (TRACK.half + 1) * s, z = p.z + t.x * (TRACK.half + 1) * s, h = heightAt(x, z);
      q.setFromAxisAngle(Y_AXIS, Math.atan2(t.x, t.z));
      m.compose(new THREE.Vector3(x, h + 0.75, z), q, one); poleI.setMatrixAt(k, m); flagI.setMatrixAt(k, m);
      k++;
    }
  }
  poleI.count = flagI.count = k;
  circuitGroup.add(poleI, flagI);
  circuitGroup.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  computeMapBounds();
}

/* ------------------------- lap timing ------------------------- */
// A lap only counts if the buggy drives through every gate, in order, between the posts.
const lap = { next: 0, started: false, lapStart: 0, lapNo: 0, time: 0, last: null, lastValid: true, best: null, splits: [], bestSplits: [], lastGate: -1, msg: '', msgCol: '#fff', msgT: 0, prev: new THREE.Vector3(), laps: [], valid: [], invalid: false, missed: [], history: [] };
function loadBest() {
  lap.best = null; lap.bestSplits = []; lap.bestNet = null; lap.last = null; lap.laps = []; lap.valid = []; lap.lapNo = 0; lap.history = [];
  if (MP.on) mpApplyBest();
  else try { const b = JSON.parse(localStorage.getItem('sandbuggy.best.' + courseKey()) || 'null'); if (b) { lap.best = b.time; lap.bestSplits = b.splits; lap.bestNet = b.net?.name ? b.net : null; } } catch (e) { }
}
loadBest();
const fmt = t => t == null ? '–:––.–––' : `${Math.floor(t / 60)}:${(t % 60).toFixed(3).padStart(6, '0')}`;
const gateName = i => i === 0 ? 'START' : 'CP' + i;
function flash(msg, col = '#fff', dur = 2.5) { lap.msg = msg; lap.msgCol = col; lap.msgT = dur; }

function highlightGate() { TRACK.gates.forEach((g, i) => { if (!g.mat) return; g.mat.emissive.setHex(i === lap.next ? 0x2fbf4a : 0x000000); g.mat.emissiveIntensity = i === lap.next ? 0.7 : 0; }); }

function updateLap(dt) {
  const now = simTime, prev = lap.prev, cur = car.pos, G = TRACK.gates.length;
  const sp = Math.hypot(car.vel.x, car.vel.z);
  for (let j = 0; j < G; j++) {
    const g = TRACK.gates[j];
    const a = (prev.x - g.p.x) * g.t.x + (prev.z - g.p.z) * g.t.z, b = (cur.x - g.p.x) * g.t.x + (cur.z - g.p.z) * g.t.z;
    if (!(a < 0 && b >= 0)) continue;
    const f = -a / (b - a), cx = prev.x + (cur.x - prev.x) * f, cz = prev.z + (cur.z - prev.z) * f;
    const lat = (cx - g.p.x) * g.n.x + (cz - g.p.z) * g.n.z, tc = now - dt + dt * f;
    if (Math.abs(lat) < g.half + 0.3) {                      // between the posts
      if (j === lap.next) gatePassed(tc);
      else if (lap.started) {
        const ahead = (j - lap.next + G) % G;
        if (ahead <= G / 2) { while (lap.next !== j) gateMissed(tc, lap.next); gatePassed(tc); }   // cut across to a later gate
      }
    } else if (j === lap.next && lap.started && Math.abs(lat) < g.half + 14 && (car.vel.x * g.t.x + car.vel.z * g.t.z) > 0.5 * sp) {
      gateMissed(tc, j);                                       // drove past the gate, outside the posts
    }
  }
  prev.copy(cur);
  lap.time = lap.started ? now - lap.lapStart : 0;
  lap.msgT = Math.max(0, lap.msgT - dt);
}
function finishLap(t, valid) {
  mpLap(t, valid);
  if (valid) aiKeepLap(t);                                            // (the driver's best lap, for the lab to follow, #340)
  const lt = t - lap.lapStart; lap.last = lt; if (lap.lapNo > 0) rp.lastLap = { a: simTime - lt, b: simTime, time: lt, no: lap.lapNo }; lap.lastValid = valid; lap.laps.push(lt); lap.valid.push(valid);
  if (lap.lapNo > 0) { lap.history.push({ no: lap.lapNo, time: lt, valid, splits: lap.splits.slice() }); if (lap.history.length > 2) lap.history.shift(); }
  if (!valid) flash(`Lap ${lap.lapNo} invalid: missed ${lap.missed.map(gateName).join(', ')}`, '#ff6a5a', 3.5);
  else if (MP.on && AI.drive) flash(`The network's lap ${lap.lapNo}  ${fmt(lt)}`, '#58d6e6', 3.5);
  else if (lap.best == null || lt < lap.best) {
    lap.best = lt; lap.bestSplits = lap.splits.slice();
    if (AI.drive) { const m = aiNetMark(); lap.bestNet = { name: m.name, creator: m.creator }; } else lap.bestNet = null;
    if (!MP.on) try { localStorage.setItem('sandbuggy.best.' + courseKey(), JSON.stringify({ time: lt, splits: lap.bestSplits, ...(lap.bestNet ? { net: lap.bestNet } : {}) })); } catch (e) { }
    flash(`New best lap  ${fmt(lt)}`, '#7dff9a', 3.5);
  } else flash(`Lap ${lap.lapNo}  ${fmt(lt)}  (+${(lt - lap.best).toFixed(3)})`, '#ffd27d', 3.5);
}
function newLap(t) { lap.started = true; lap.lapStart = t; lap.lapNo++; lap.splits = []; lap.invalid = false; lap.missed = []; }
function gatePassed(t) {
  const i = lap.next, G = TRACK.gates.length;
  if (i === 0) {
    if (lap.started) finishLap(t, !lap.invalid); else flash('Go!', '#7dff9a', 1.5);
    newLap(t);
  } else if (lap.started) {
    const st = t - lap.lapStart; lap.splits[i] = st;
    const ref = lap.bestSplits?.[i];
    if (lap.invalid) flash(`CP${i}  (lap invalid)`, '#ff8a7a', 1.5);
    else if (ref != null) { const d = st - ref; flash(`CP${i}  ${d < 0 ? '−' : '+'}${Math.abs(d).toFixed(2)}`, d < 0 ? '#7dff9a' : '#ff8a7a', 2); }
    else flash(`CP${i}  ${fmt(st)}`, '#fff', 2);
  }
  lap.lastGate = i; lap.next = (i + 1) % G;
  highlightGate();
}
function gateMissed(t, j) {
  const G = TRACK.gates.length;
  if (MP.phase === 'racing' && !MP.finished && lap.started) MP.missed++;
  lap.invalid = true; if (!lap.missed.includes(j)) lap.missed.push(j);
  if (j === 0) { finishLap(t, false); newLap(t); lap.invalid = true; lap.missed = [0]; }
  else flash(`Missed ${gateName(j)}: lap invalid`, '#ff6a5a', 2.5);
  lap.next = (j + 1) % G;
  highlightGate();
}
function placeAtGate(i, back) {
  const g = TRACK.gates[i];
  const x = g.p.x + g.t.x * back, z = g.p.z + g.t.z * back;
  resetCar(x, z, Math.atan2(g.t.x, g.t.z));
  lap.prev.copy(car.pos);
}
function restartRun() { lap.started = false; lap.next = 0; lap.lastGate = -1; lap.splits = []; lap.invalid = false; lap.missed = []; repairAll(); placeAtGate(0, -14); highlightGate(); gridBots(); }
function respawn() { if (lap.lastGate < 0) restartRun(); else placeAtGate(lap.lastGate, 4); }

// HUD: timing, direction arrow, minimap
const timerEl = document.getElementById('timer'), arrowEl = document.getElementById('arrow'), toastEl = document.getElementById('toast');
const mapCv = document.getElementById('map'), mapCtx = mapCv.getContext('2d');
let mapB = null;
function computeMapBounds() {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of TRACK.pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
  const s = (mapCv.width - 24) / Math.max(x1 - x0, z1 - z0, 1);
  mapB = { x0, z0, s, ox: 12 + (mapCv.width - 24 - (x1 - x0) * s) / 2, oz: 12 + (mapCv.height - 24 - (z1 - z0) * s) / 2 };
}
// world +x is drawn to the left so the map matches the chase view when heading +z (map "up" = +z)
const mapXY = (x, z) => [mapCv.width - (mapB.ox + (x - mapB.x0) * mapB.s), mapCv.height - (mapB.oz + (z - mapB.z0) * mapB.s)];
function resetBest() {
  if (lap.best == null) { flash('No best lap to reset', '#ffd88a', 1.5); return; }
  const old = lap.best; lap.best = null; lap.bestSplits = []; lap.bestNet = null;
  try { localStorage.removeItem('sandbuggy.best.' + courseKey()); } catch (e) { }
  flash(`Best lap ${fmt(old)} cleared`, '#ffd88a', 2);
}
document.getElementById('bestBtn').addEventListener('click', e => { e.currentTarget.blur(); resetBest(); });
// segment times (start to CP1, CP1 to CP2, ..., last CP to finish) from cumulative splits; null where a gate was missed
function segTimes(splits, total) {
  const G = TRACK.gates.length, out = []; let prev = 0;
  for (let i = 1; i <= G; i++) { const c = i < G ? splits[i] : total; out.push(c != null && prev != null ? c - prev : null); prev = c; }
  return out;
}
function segTable() {
  const Hs = lap.history; if (!Hs.length) return '';
  if (MP_FOLD.laps) return `<table class="seg"><tr>${mpFoldHead('laps', 'th', '', 'LAP DETAILS')}</tr></table>`;
  const G = TRACK.gates.length, cols = Hs.map(h => segTimes(h.splits, h.time)), cur = lap.started ? segTimes(lap.splits, null) : null;
  const f = v => v == null ? '–' : v.toFixed(2);
  let h = `<table class="seg"><tr>${mpFoldHead('laps', 'th', '', 'LAP DETAILS')}${Hs.map(x => `<th style="${x.valid ? '' : 'color:#ff8a7a'}">Lap ${x.no}</th>`).join('')}${cur ? '<th style="opacity:.7">now</th>' : ''}</tr>`;
  for (let i = 0; i < G; i++) {
    const vals = cols.map(c => c[i]), best = vals.length > 1 && vals.every(v => v != null) ? Math.min(...vals) : null;
    h += `<tr><td>${i === 0 ? 'Start' : 'CP' + i} → ${i === G - 1 ? 'Finish' : 'CP' + (i + 1)}</td>${vals.map(v => `<td style="${best != null && v === best && vals[0] !== vals[1] ? 'color:#7dff9a' : ''}">${f(v)}</td>`).join('')}${cur ? `<td style="opacity:.7">${f(cur[i])}</td>` : ''}</tr>`;
  }
  return h + `<tr class="tot"><td>Lap</td>${Hs.map(x => `<td>${fmt(x.time)}</td>`).join('')}${cur ? '<td></td>' : ''}</tr></table>`;
}
let lapHudT = 0;
function updateLapHud(dt) {
  if ((lapHudT += dt) < 0.05) return; lapHudT = 0;
  timerEl.innerHTML = `<div class="lt">${lap.started ? `LAP ${lap.lapNo}${MP.phase === 'racing' && !MP.finished ? ' / ' + MP.laps : ''}` : MP.hold ? 'ON THE GRID' : 'CROSS START'}${lap.invalid ? ' <span style="color:#ff6a5a">· INVALID</span>' : ''}</div><div class="cur" style="${lap.invalid ? 'color:#ffb0a6' : ''}">${fmt(lap.started ? lap.time : 0)}</div>
    <div class="row"><span style="${lap.lastValid ? '' : 'color:#ff8a7a;text-decoration:line-through'}">LAST ${fmt(lap.last)}</span><span>BEST ${fmt(lap.best)}</span></div>${lap.bestNet ? `<div style="color:#58d6e6;font-size:11px;text-align:right;max-width:240px;margin-left:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="Set by the network ${mpEsc(lap.bestNet.name)}, made by ${mpEsc(lap.bestNet.creator)}">by the network ${mpEsc(lap.bestNet.name)} (${mpEsc(lap.bestNet.creator)})</div>` : ''}${mpRecRow()}${segTable()}`;
  document.getElementById('nav').style.top = (timerEl.offsetHeight + 24) + 'px';
  drawDamage();
  toastEl.textContent = lap.msgT > 0 ? lap.msg : ''; toastEl.style.color = lap.msgCol; toastEl.style.opacity = lap.msgT > 0 ? Math.min(1, lap.msgT * 2) : 0;
  const g = TRACK.gates[lap.next], dx = g.p.x - car.pos.x, dz = g.p.z - car.pos.z;
  const ang = Math.atan2(dx, dz) - Math.atan2(fwd.x, fwd.z);
  arrowEl.style.transform = `rotate(${-ang}rad)`;
  document.getElementById('dist').textContent = `${Math.hypot(dx, dz).toFixed(0)} m to ${lap.next === 0 ? 'finish' : 'CP' + lap.next}`;
  const c = mapCtx; c.clearRect(0, 0, mapCv.width, mapCv.height);
  c.lineWidth = 6; c.strokeStyle = 'rgba(255,230,190,.55)'; c.lineJoin = 'round'; c.beginPath();
  TRACK.pts.forEach((p, i) => { const [x, y] = mapXY(p.x, p.z); i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.closePath(); c.stroke();
  c.fillStyle = '#9fb3c8'; for (const b of TRACK.bridges) { const [x, y] = mapXY(b.x, b.z); c.fillRect(x - 4, y - 4, 8, 8); }
  TRACK.gates.forEach((g, i) => { const [x, y] = mapXY(g.p.x, g.p.z); c.fillStyle = i === lap.next ? '#3dff6a' : lap.missed.includes(i) ? '#ff2020' : i === 0 ? '#fff' : '#ff7a2a'; c.beginPath(); c.arc(x, y, i === lap.next ? 5 : 3.5, 0, TAU); c.fill(); });
  for (const pe of MP.peers.values()) { if (!pe.shown) continue; const [x, y] = mapXY(pe.pos.x, pe.pos.z); c.fillStyle = pe.col; c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.beginPath(); c.arc(x, y, 4.5, 0, TAU); c.fill(); c.stroke(); }
  for (const b of BOTS.list) { const [x, y] = mapXY(b.pos.x, b.pos.z); c.fillStyle = b.col; c.strokeStyle = '#000'; c.lineWidth = 1; c.beginPath(); c.arc(x, y, 4, 0, TAU); c.fill(); c.stroke(); }
  const [cx, cy] = mapXY(car.pos.x, car.pos.z), h = Math.atan2(fwd.x, fwd.z);
  c.save(); c.translate(cx, cy); c.rotate(-h); c.fillStyle = '#ff3b30'; c.beginPath(); c.moveTo(0, -8); c.lineTo(5, 5); c.lineTo(-5, 5); c.closePath(); c.fill(); c.restore();
}

/* =====================================================================
   COURSE EDITOR (E): waypoints, terrain brushes, surface paint
   ===================================================================== */
const ed = { even: null, undoEven: null, on: false, tool: 'wp', size: 8, str: 4, rMin: 25, undoWp: null, drag: -1, sel: -1, painting: false, lastOp: 0, hit: null, wpDirty: false, opsDirty: false, farT: 0, flatH: 0 };
const edEl = document.getElementById('editor'), edHint = document.getElementById('eHint');
const edGroup = new THREE.Group(); edGroup.visible = false; scene.add(edGroup);
const wpMat = new THREE.MeshBasicMaterial({ color: 0xff3b30, depthTest: false, transparent: true });
const wpStartMat = new THREE.MeshBasicMaterial({ color: 0x3dff6a, depthTest: false, transparent: true });
const wpGeo = new THREE.SphereGeometry(1.4, 16, 12);
let wpMeshes = [], previewLine = null, brMeshes = [];
const brGeo = new THREE.BoxGeometry(7.2, 0.6, 8), brMat = new THREE.MeshBasicMaterial({ color: 0x4da3ff, depthTest: false, transparent: true, opacity: 0.85 });
const brOffMat = new THREE.MeshBasicMaterial({ color: 0x9aa4ae, depthTest: false, transparent: true, opacity: 0.8 });
const brushRing = new THREE.LineLoop(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(64 * 3), 3)), new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }));
brushRing.renderOrder = 10; edGroup.add(brushRing);
const HINTS = {
  wp: 'Click to add a waypoint (it joins the nearest segment). Drag a waypoint to move it. To delete one, click it (it turns white) and press Delete or Backspace, or double-click it, or Shift+click it. The green one is near the start.',
  raise: 'Hold the left button to raise the ground.', lower: 'Hold the left button to dig the ground down.',
  flatten: 'Hold to level the ground to the height where you first clicked.', smooth: 'Hold to soften bumps and ridges.',
  bridge: 'Click the course to add a bridge. Where the course crosses itself, click the branch that should go over; anywhere else you get a low bridge over a dug wash. Click a bridge (blue marker) to remove it; a crossing without a bridge is a flat junction.',
  sand: 'Paint soft sand.', earth: 'Paint firm earth.', road: 'Paint asphalt (rigid, high grip). Flatten the ground first for a smooth road.', erase: 'Paint back to the base ground (Sand / Earth / Road from G).',
};
function setTool(t) { ed.tool = t; edEl.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t)); edHint.textContent = HINTS[t] + '  Right-drag to rotate the view, Shift+right-drag to pan, wheel to zoom.'; brushRing.visible = t !== 'wp' && t !== 'bridge'; }
edEl.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
document.getElementById('bsize').addEventListener('input', e => ed.size = +e.target.value);
document.getElementById('bstr').addEventListener('input', e => ed.str = +e.target.value);
document.getElementById('eDone').addEventListener('click', () => toggleEditor(false));
document.getElementById('eReset').addEventListener('click', () => { COURSE.wp = DEFAULT_WP.map(p => p.slice()); COURSE.bridges = []; COURSE.noBridge = []; ed.undoWp = null; showShape(); ed.wpDirty = true; updatePreview(); flash('Figure-8 restored', '#fff', 1.5); });
document.getElementById('eClear').addEventListener('click', () => { COURSE.ops = []; ed.wpDirty = true; flash('Terrain edits cleared', '#fff', 2); });
document.getElementById('eExport').addEventListener('click', () => {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(COURSE)], { type: 'application/json' }));
  a.download = 'sand-buggy-course.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
document.getElementById('eImport').addEventListener('click', () => document.getElementById('eFile').click());
document.getElementById('eFile').addEventListener('change', async e => {
  try {
    const c = JSON.parse(await e.target.files[0].text());
    if (!Array.isArray(c.wp) || c.wp.length < 3) throw new Error('no waypoints');
    COURSE = { wp: c.wp.map(([x, z]) => [+x, +z]), bank: bankOf(c.bank), level: levelOf(c.level), even: evenOf(c.even), grade: gradeOf(c.grade), ops: Array.isArray(c.ops) ? c.ops : [], base: BASES.includes(c.base) ? c.base : 'sand', road: !!c.road, bridges: Array.isArray(c.bridges) ? c.bridges.filter(b => b && isFinite(b.x) && isFinite(b.z)).map(b => ({ x: +b.x, z: +b.z })) : [], noBridge: Array.isArray(c.noBridge) ? c.noBridge.filter(b => b && isFinite(b.x) && isFinite(b.z)).map(b => ({ x: +b.x, z: +b.z })) : [] }; ROAD = COURSE.road;
    if (ROAD) COURSE.base = 'earth'; SURF = SURFACES[COURSE.base];
    ed.wpDirty = true; updatePreview(); flash('Course imported', '#7dff9a', 2);
  } catch (err) { flash('Could not read that course file', '#ff8a7a', 2.5); }
  e.target.value = '';
});
document.getElementById('editBtn').addEventListener('click', () => toggleEditor(!ed.on));
// SHAPE: smooth the curves to a minimum radius (undoable), and bank them
const sRadEl = document.getElementById('sRad'), bankEl = document.getElementById('bankDeg'), levelEl = document.getElementById('levelPct'), gradeEl = document.getElementById('gradePct');
const showShape = () => {
  document.getElementById('sRadV').textContent = `${ed.rMin} m`;
  document.getElementById('bankV').textContent = COURSE.bank ? `${COURSE.bank}°` : 'off';
  document.getElementById('levelV').textContent = COURSE.level ? `${COURSE.level}%` : 'off';
  document.getElementById('gradeV').textContent = COURSE.grade ? `${COURSE.grade}%` : 'off';
  document.getElementById('eUndoSmooth').disabled = !ed.undoWp;
  const nE = COURSE.even?.length || 0;
  document.getElementById('eEvenClear').disabled = !nE;
  document.getElementById('eEvenClear').textContent = nE ? `Clear even grades (${nE})` : 'Clear even grades';
  document.getElementById('eEven').classList.toggle('on', !!ed.even);
};
function endEvenPick() { ed.even = null; document.getElementById('eEven').classList.remove('on'); }
document.getElementById('eEven').addEventListener('click', e => {
  e.currentTarget.blur();
  if (ed.even) { endEvenPick(); ed.sel = -1; updatePreview(); flash('Even grade: cancelled', '#fff', 1.2); return; }
  ed.even = { a: null }; e.currentTarget.classList.add('on');
  flash('Even grade: click the first waypoint of the section', '#fff', 2.4);
});
document.getElementById('eEvenClear').addEventListener('click', e => {
  e.currentTarget.blur(); if (!COURSE.even?.length) return;
  COURSE.even = []; ed.wpDirty = true; updatePreview(); showShape(); flash('Even-grade sections cleared', '#fff', 2);
});
sRadEl.addEventListener('input', e => { ed.rMin = +e.target.value; showShape(); });
bankEl.addEventListener('input', e => { COURSE.bank = bankOf(e.target.value); ed.wpDirty = true; showShape(); });
bankEl.addEventListener('change', () => flash(COURSE.bank ? `Bends banked up to ${COURSE.bank}°` : 'Banking off', '#fff', 2));
levelEl.addEventListener('input', e => { COURSE.level = levelOf(e.target.value); ed.wpDirty = true; showShape(); });
levelEl.addEventListener('change', () => flash(COURSE.level ? `Road levelled ${COURSE.level}%` : 'Levelling off', '#fff', 2));
gradeEl.addEventListener('input', e => { COURSE.grade = +e.target.value <= 2 ? 0 : gradeOf(e.target.value); ed.wpDirty = true; showShape(); });
gradeEl.addEventListener('change', () => flash(COURSE.grade ? `No grade over ${COURSE.grade}%` : 'Max. grade off', '#fff', 2));
// the road as smooth as it gets: no corner under the min. radius, fully levelled with no grade over
// OPT_GRADE (or the max. grade if lower) and gentle crests and dips, every bend banked at the angle its speed needs
document.getElementById('eOptimise').addEventListener('click', e => {
  e.currentTarget.blur();
  const sm = smoothCurves(), grade = COURSE.grade ? Math.min(COURSE.grade, OPT_GRADE) : OPT_GRADE;
  if (!sm.changed && COURSE.level === 100 && COURSE.bank === BANK_MAX && COURSE.grade === grade) { flash(`The road is already optimised: no corner under ${ed.rMin} m, levelled, no grade over ${grade}%, bends banked up to ${BANK_MAX}°`, '#ffd88a', 3); return; }
  COURSE.level = 100; COURSE.bank = BANK_MAX; COURSE.grade = grade; levelEl.value = 100; bankEl.value = BANK_MAX; gradeEl.value = grade; ed.wpDirty = true; showShape();
  flash(`Road optimised: ${sm.changed ? sm.msg : `no corner under ${ed.rMin} m`} · levelled, no grade over ${grade}%, gentle crests and dips · bends banked for their speed (up to ${BANK_MAX}°)`, sm.lost || sm.short ? '#ffd88a' : '#7dff9a', 5);
});
// ---------- GENERATE a circuit and MY CIRCUITS (#315) ----------
// A generated course replaces the editor's (the one before it: Back, up to 20); built at once, as any edit (live.py).
// It keeps the ground (Sand / Earth / Road) and has no terrain strokes or even grades of its own; its bridges (#326, Bridges:
// 0 to 3 or Random) are where it crosses itself, one branch over the other.
const GEN = { style: localStorage.getItem('carsim.gen.style') || 'mixed', bridges: localStorage.getItem('carsim.gen.bridges') || '0', back: [], mod: null, busy: false, last: null, short: '' };
const CIRCUITS_KEY = 'carsim.circuits';                    // [{ name, course, len, at, gen? }] (not 'sandbuggy.': the autopilot's workers boot with those)
const gKm = document.getElementById('gKm'), gSeed = document.getElementById('gSeed'), cList = document.getElementById('cList');
const courseCopy = c => JSON.parse(JSON.stringify(c));
const wpSig = wp => JSON.stringify(wp);
function genShow() {
  document.getElementById('gKmV').textContent = `${(+gKm.value).toFixed(1)} km`;
  edEl.querySelectorAll('[data-gs]').forEach(b => b.classList.toggle('on', b.dataset.gs === GEN.style));
  edEl.querySelectorAll('[data-gb]').forEach(b => b.classList.toggle('on', b.dataset.gb === GEN.bridges));
  document.getElementById('gBack').disabled = !GEN.back.length;
  document.getElementById('gNote').textContent = GEN.short && GEN.last?.sig === wpSig(COURSE.wp) ? GEN.short : `Corners no tighter than ${ed.rMin} m (Min. corner radius, under SHAPE)`;
  libShow();
}
// the editor's course becomes c (back: it goes on the Back list)
function genSet(c, back = true) {
  if (back) { GEN.back.push(courseCopy(COURSE)); if (GEN.back.length > 20) GEN.back.shift(); }
  COURSE = c;
  ed.undoWp = null; ed.undoEven = null; ed.sel = -1; ed.drag = -1; endEvenPick(); ed.wpDirty = true;
  bankEl.value = COURSE.bank || 0; levelEl.value = COURSE.level || 0; gradeEl.value = COURSE.grade || 2;
  showShape(); updatePreview(); genShow();
}
const genLoad = async () => GEN.mod ||= await import(new URL('circuit-gen.js', import.meta.url).href);
async function genMake(seed) {
  if (GEN.busy) return;
  GEN.busy = true; gSeed.value = seed;
  try {
    await genLoad();
    const km = +gKm.value, style = GEN.style, rMin = ed.rMin, bridges = GEN.bridges === 'random' ? 'random' : +GEN.bridges;
    const c = GEN.mod.generateCircuit({ seed, km, style, rMin, bridges });
    if (!c) { flash(`No circuit fits with ${rMin} m corners: lower the Min. corner radius (SHAPE)`, '#ff8a7a', 3); return; }
    GEN.last = { seed: c.seed, km, style, rMin, bridges, len: Math.round(c.len), sig: wpSig(c.wp) };
    const nb = n => `${n} bridge${n === 1 ? '' : 's'}`;
    GEN.short = [c.len < km * 1000 * 0.94 ? `${(c.len / 1000).toFixed(2)} km: the longest this seed fits in the world with ${rMin} m corners (a lower Min. corner radius makes room for more)` : '',
      c.bridges < c.bridgesAsked ? `${nb(c.bridgesAsked)}${bridges === 'random' ? ' (drawn)' : ''} don't fit at this length with ${rMin} m corners: ${c.bridges} (longer, or a lower Min. corner radius, makes room)` : ''].filter(Boolean).join(' · ');
    genSet({ wp: c.wp, bank: 8, level: 100, even: [], grade: OPT_GRADE, ops: [], base: COURSE.base, road: !!COURSE.road, bridges: [], noBridge: [] });
    flash(`Circuit ${c.seed}: ${(c.len / 1000).toFixed(2)} km${c.bridges ? ` · ${nb(c.bridges)}` : ''}${bridges === 'random' ? ' (random)' : ''}`, GEN.short ? '#ffd88a' : '#7dff9a', 3);
  } catch (err) { console.warn('circuit generator:', err); flash('The circuit generator could not load', '#ff8a7a', 3); }
  finally { GEN.busy = false; }
}
document.getElementById('gNew').addEventListener('click', e => { e.currentTarget.blur(); genMake(String(1 + Math.floor(Math.random() * 999999))); });
document.getElementById('gMake').addEventListener('click', e => { e.currentTarget.blur(); genMake(gSeed.value.trim() || '1'); });
document.getElementById('gBack').addEventListener('click', e => { e.currentTarget.blur(); if (!GEN.back.length) return; genSet(GEN.back.pop(), false); flash('The course before', '#fff', 1.5); });
gSeed.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); genMake(gSeed.value.trim() || '1'); } });
gKm.addEventListener('input', genShow);
edEl.querySelectorAll('[data-gs]').forEach(b => b.addEventListener('click', () => { b.blur(); GEN.style = b.dataset.gs; try { localStorage.setItem('carsim.gen.style', GEN.style); } catch (err) { } genShow(); }));
edEl.querySelectorAll('[data-gb]').forEach(b => b.addEventListener('click', () => { b.blur(); GEN.bridges = b.dataset.gb; try { localStorage.setItem('carsim.gen.bridges', GEN.bridges); } catch (err) { } genShow(); }));
sRadEl.addEventListener('input', genShow);
edEl.addEventListener('keydown', e => { if (e.target.matches('input[type=text], select')) e.stopPropagation(); });   // typing a seed or a name: not the sim's keys
// MY CIRCUITS: in this browser's storage
const libRead = () => { try { const a = JSON.parse(localStorage.getItem(CIRCUITS_KEY) || '[]'); return Array.isArray(a) ? a.filter(x => x && typeof x.name === 'string' && x.course && Array.isArray(x.course.wp) && x.course.wp.length >= 3) : []; } catch (err) { return []; } };
const libWrite = a => { try { localStorage.setItem(CIRCUITS_KEY, JSON.stringify(a)); return true; } catch (err) { flash('Browser storage is full: delete a circuit, or Export this one', '#ff8a7a', 3); return false; } };
function libShow() {
  const a = libRead(), sel = cList.value, cur = wpSig(COURSE.wp);
  cList.innerHTML = a.length ? '' : '<option value="">(none yet)</option>';
  for (const x of a) { const o = document.createElement('option'); o.value = x.name; o.textContent = `${wpSig(x.course.wp) === cur ? '● ' : ''}${x.name}${x.len ? ` · ${(x.len / 1000).toFixed(2)} km` : ''}`; cList.appendChild(o); }
  const on = a.find(x => wpSig(x.course.wp) === cur);
  cList.value = a.some(x => x.name === sel) ? sel : on ? on.name : a[0]?.name ?? '';
  document.getElementById('cLoad').disabled = document.getElementById('cDel').disabled = !a.length;
}
document.getElementById('cSave').addEventListener('click', e => {
  e.currentTarget.blur();
  const a = libRead(), g = GEN.last && GEN.last.sig === wpSig(COURSE.wp) ? GEN.last : null;
  const cur = a.find(x => wpSig(x.course.wp) === wpSig(COURSE.wp));
  const def = cur ? cur.name : g ? `${g.style[0].toUpperCase() + g.style.slice(1)} ${g.seed}${g.rMin !== 25 ? ` r${g.rMin}` : ''}${g.bridges ? ` b${g.bridges === 'random' ? '?' : g.bridges}` : ''}` : `Course ${a.length + 1}`;
  const name = (prompt('Save this course in My circuits as:', def) || '').trim().replace(/\s+/g, ' ').slice(0, 48);
  if (!name) return;
  const i = a.findIndex(x => x.name === name);
  if (i >= 0 && !confirm(`Replace "${name}" with this course?`)) return;
  const x = { name, course: courseCopy(COURSE), len: Math.round((ed.track || buildTrack(COURSE.wp)).len), at: Date.now(), ...(g ? { gen: { seed: g.seed, km: g.km, style: g.style, rMin: g.rMin, ...(g.bridges ? { bridges: g.bridges } : {}) } } : {}) };
  if (i >= 0) a[i] = x; else a.push(x);
  if (libWrite(a)) { cList.value = name; libShow(); flash(`Saved in My circuits: ${name}`, '#7dff9a', 2); }
});
document.getElementById('cLoad').addEventListener('click', e => {
  e.currentTarget.blur();
  const x = libRead().find(y => y.name === cList.value); if (!x) return;
  const c = x.course;
  genSet({ wp: c.wp.map(([px, pz]) => [+px, +pz]), bank: bankOf(c.bank), level: levelOf(c.level), even: evenOf(c.even), grade: gradeOf(c.grade), ops: Array.isArray(c.ops) ? c.ops : [], base: COURSE.base, road: !!COURSE.road,
    bridges: Array.isArray(c.bridges) ? c.bridges.filter(b => b && isFinite(b.x) && isFinite(b.z)).map(b => ({ x: +b.x, z: +b.z })) : [], noBridge: Array.isArray(c.noBridge) ? c.noBridge.filter(b => b && isFinite(b.x) && isFinite(b.z)).map(b => ({ x: +b.x, z: +b.z })) : [] });
  GEN.last = x.gen ? { ...x.gen, len: x.len, sig: wpSig(c.wp) } : null;
  flash(x.name, '#7dff9a', 2);
});
document.getElementById('cDel').addEventListener('click', e => {
  e.currentTarget.blur();
  const a = libRead(), i = a.findIndex(y => y.name === cList.value); if (i < 0 || !confirm(`Delete "${a[i].name}" from My circuits?`)) return;
  a.splice(i, 1); if (libWrite(a)) { libShow(); flash('Deleted', '#fff', 1.5); }
});
genShow();
document.getElementById('eSmooth').addEventListener('click', e => { e.currentTarget.blur(); const r = smoothCurves(); flash(r.msg, r.col, r.dur); });
// Smooth curves (and Optimise): the waypoints reshaped so no corner is tighter than the min. radius (undoable)
function smoothCurves() {
  const r = smoothCourse(COURSE.wp, ed.rMin), was = Math.round(r.before), now = Math.round(r.after);
  if (r.before >= ed.rMin * 0.97) return { changed: false, msg: `No corner is tighter than ${ed.rMin} m (tightest: ${was} m)`, col: '#ffd88a', dur: 2.4 };
  const lost = buildTrack(r.wp, { ...COURSE, wp: r.wp }).rejected.length - (ed.track?.rejected.length || 0);
  ed.undoEven = null;
  if (COURSE.even?.length && r.wp.length !== COURSE.wp.length) { ed.undoEven = COURSE.even; COURSE.even = []; }   // refitted waypoints: the sections' ends are gone (Undo brings them back)
  ed.undoWp = COURSE.wp; COURSE.wp = r.wp; ed.sel = -1; ed.wpDirty = true; updatePreview(); showShape();
  const short = r.after < ed.rMin * 0.85 ? ' · a hairpin this tight opens only so far: move its straights apart for more' : '';
  return { changed: true, short: !!short, lost: lost > 0, col: '#7dff9a', dur: short ? 5 : 3,
    msg: `Curves smoothed: tightest corner ${was} m → ${now} m${ed.undoEven ? ' · even-grade sections cleared (Undo smoothing restores them)' : ''}${short}${lost > 0 ? ` · ${lost} bridge${lost > 1 ? 's' : ''} no longer fit` : ''}` };
}
document.getElementById('eStraight').addEventListener('click', e => {
  e.currentTarget.blur();
  const wp0 = COURSE.wp.map(p => p.slice()), ev0 = COURSE.even?.map(r => r.slice()), before = buildTrack(COURSE.wp).bridges.length;
  const k = straightenBridges();
  if (!k) { flash(before ? 'Nothing to straighten (a bridge by the start waypoint is left as it is)' : 'No bridges on this course', '#ffd88a', 2.2); return; }
  if (buildTrack(COURSE.wp).bridges.length < before) { COURSE.wp = wp0; if (ev0) COURSE.even = ev0; flash('Straightening would lose a bridge: left as it was', '#ff8a7a', 2.4); return; }
  ed.undoWp = wp0; ed.undoEven = ev0 ?? null; ed.sel = -1; ed.wpDirty = true; updatePreview(); showShape();
  flash(`The road straightened at ${k} bridge${k > 1 ? 's' : ''} (Undo puts it back)`, '#7dff9a', 2.4);
});
document.getElementById('eUndoSmooth').addEventListener('click', () => {
  if (!ed.undoWp) return;
  if (ed.undoEven) { COURSE.even = ed.undoEven; ed.undoEven = null; }
  COURSE.wp = ed.undoWp; ed.undoWp = null; ed.sel = -1; ed.wpDirty = true; updatePreview(); showShape(); flash('Undone', '#fff', 1.5);
});

// add a bridge where the course is clicked, or remove the bridge that was clicked
function toggleBridgeAt(p) {
  const t = ed.track || buildTrack(COURSE.wp);
  COURSE.bridges ||= []; COURSE.noBridge ||= [];
  const hit = t.bridges.find(b => { const dx = p.x - b.x, dz = p.z - b.z, a = Math.abs(dx * b.tx + dz * b.tz), c = Math.abs(dz * b.tx - dx * b.tz); return a < b.halfL + 4 && c < 8; });
  if (hit) {
    if (hit.src) COURSE.bridges.splice(COURSE.bridges.indexOf(hit.src), 1);
    if (hit.kind === 'cross') COURSE.noBridge.push({ x: +hit.x.toFixed(1), z: +hit.z.toFixed(1) });
    ed.wpDirty = true; updatePreview(); flash(hit.kind === 'cross' ? 'Bridge removed: flat junction at the crossing' : 'Bridge removed', '#fff', 1.8); return;
  }
  const near = t.pts.reduce((m, q) => Math.min(m, Math.hypot(q.x - p.x, q.z - p.z)), Infinity);
  if (near > 14) { flash('Click on the course to place a bridge', '#ffd88a', 1.8); return; }
  const pb = { x: +p.x.toFixed(1), z: +p.z.toFixed(1) };
  COURSE.bridges.push(pb);
  const t2 = buildTrack(COURSE.wp);
  if (t2.rejected.includes(pb) || !t2.bridges.some(b => b.src === pb)) {
    COURSE.bridges.pop(); flash(pb.why === 'bend' ? 'Too curvy here: a bridge needs a fairly straight stretch' : 'No room: too close to another bridge or its ramps', '#ff8a7a', 2.4); delete pb.why; return;
  }
  const nb = t2.bridges.find(b => b.src === pb);
  if (nb.kind === 'cross') COURSE.noBridge = COURSE.noBridge.filter(r => Math.hypot(r.x - nb.x, r.z - nb.z) >= 14);
  const wp0 = COURSE.wp.map(p => p.slice()), ev0 = COURSE.even?.map(r => r.slice());
  const st = straightenBridges(nb) > 0 && buildTrack(COURSE.wp).bridges.some(b => Math.hypot(b.x - nb.x, b.z - nb.z) < 20);
  if (st) { ed.undoWp = wp0; ed.undoEven = ev0 ?? null; } else { COURSE.wp = wp0; if (ev0) COURSE.even = ev0; }
  ed.wpDirty = true; updatePreview(); showShape(); flash((nb.kind === 'cross' ? 'Bridge added: this branch goes over' : 'Bridge added over a dug wash') + (st ? ' · the road straightened across it (Undo puts it back)' : ''), '#7dff9a', 2.4);
}

// Straighten the upper road at each bridge (or at the one nearest `near`): the waypoints over the deck and 14 m
// past its ends give way to four on the deck's line (2 m and 14 m past each end), so the road runs straight
// over the deck and into its approaches. Even-grade sections keep their stretch. Returns the number straightened.
function straightenBridges(near) {
  let done = 0;
  const todo = buildTrack(COURSE.wp).bridges.filter(b => !near || Math.hypot(b.x - near.x, b.z - near.z) < 20).map(b => ({ x: b.x, z: b.z }));
  for (const at of todo) {
    const T = buildTrack(COURSE.wp), b = T.bridges.find(q => Math.hypot(q.x - at.x, q.z - at.z) < 20); if (!b) continue;
    const P = T.pts, n = P.length - 1, ds = T.len / n, W = COURSE.wp, m = W.length, idx = wpPtIndex(W, P), i0 = Math.round(b.uOver * n) % n;
    const S = b.halfL + 14, off = i => { let d = idx[i] - i0; if (d > n / 2) d -= n; if (d < -n / 2) d += n; return d * ds; };
    // its direction along the course
    const tq = P[(i0 + 1) % n], tp = P[(i0 - 1 + n) % n], sg = Math.sign((tq.x - tp.x) * b.tx + (tq.z - tp.z) * b.tz) || 1, dx = b.tx * sg, dz = b.tz * sg;
    const zone = []; for (let i = 0; i < m; i++) if (Math.abs(off(i)) < S + 4) zone.push(i);
    if (zone.includes(0) || m - zone.length + 4 < 4) continue;               // the start waypoint is there: leave it
    let at0 = zone.length ? Math.min(...zone) : -1;
    if (at0 < 0) for (let i = 1; i < m; i++) if (off(i - 1) < 0 && off(i) >= 0) { at0 = i; break; }   // none there: between its neighbours
    if (at0 < 1) continue;                                                     // (never before the start waypoint)
    for (const i of [...zone].sort((p, q) => q - p)) { W.splice(i, 1); shiftEven(i, -1); }
    const put = [-S, -(b.halfL + 2), b.halfL + 2, S].map(sd => [+clamp(b.x + dx * sd, -168, 168).toFixed(1), +clamp(b.z + dz * sd, -168, 168).toFixed(1)]);
    put.forEach((p, k) => { W.splice(at0 + k, 0, p); shiftEven(at0 + k, 1); });
    done++;
  }
  return done;
}
// remove a waypoint (Shift/Alt/Ctrl+click, double-click, or select it and press Delete / Backspace)
function deleteWaypoint(i) {
  if (i == null || i < 0 || i >= COURSE.wp.length) { flash('Click a waypoint first', '#ffd88a', 1.5); return; }
  if (COURSE.wp.length <= 4) { flash('A course needs at least 4 waypoints', '#ff8a7a', 2); return; }
  COURSE.wp.splice(i, 1); shiftEven(i, -1); ed.sel = -1; ed.drag = -1; ed.wpDirty = true; updatePreview(); showShape();
}
const wpSelMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }), wpEvenMat = new THREE.MeshBasicMaterial({ color: 0x3fd0ff, depthTest: false });
// waypoints in an even-grade section (its ends included), for their colour
function evenWps() {
  const m = COURSE.wp.length, on = new Set();
  for (const [a, b] of COURSE.even || []) { if (a >= m || b >= m) continue; for (let i = a; ; i = (i + 1) % m) { on.add(i); if (i === b) break; } }
  return on;
}
// the waypoints' indices after one is inserted at i (+1) or removed from i (-1): a section keeps its stretch of road
function shiftEven(i, dir) {
  const m = COURSE.wp.length;                         // after the change
  COURSE.even = (COURSE.even || []).map(([a, b]) => dir > 0 ? [a >= i ? a + 1 : a, b >= i ? b + 1 : b]
    : [a > i ? a - 1 : a === i ? i % m : a, b > i ? b - 1 : b === i ? (i - 1 + m) % m : b]).filter(([a, b]) => a !== b && a < m && b < m);
}
// a section's grade as it stands (the ground under the waypoints, along their polygon)
function evenEstimate(a, b) {
  const W = COURSE.wp, m = W.length; let len = 0;
  for (let i = a; i !== b; i = (i + 1) % m) { const [x0, z0] = W[i], [x1, z1] = W[(i + 1) % m]; len += Math.hypot(x1 - x0, z1 - z0); }
  return { len, pct: (heightAt(W[b][0], W[b][1]) - heightAt(W[a][0], W[a][1])) / Math.max(len, 1) * 100 };
}
function updatePreview() {
  for (const m of wpMeshes) edGroup.remove(m);
  const evenSet = evenWps();
  wpMeshes = COURSE.wp.map(([x, z], i) => { const m = new THREE.Mesh(wpGeo, i === ed.sel ? wpSelMat : i === 0 ? wpStartMat : evenSet.has(i) ? wpEvenMat : wpMat); m.position.set(x, heightAt(x, z) + 1.6, z); m.renderOrder = 11; edGroup.add(m); return m; });
  if (previewLine) { edGroup.remove(previewLine); previewLine.geometry.dispose(); }
  const t = buildTrack(COURSE.wp), arr = [];
  ed.track = t;
  for (const m of brMeshes) edGroup.remove(m);
  brMeshes = [];
  for (const b of t.bridges) {
    const m = new THREE.Mesh(brGeo, brMat), y = heightAt(b.x, b.z) + 2.4; m.position.set(b.x, y, b.z); m.rotation.y = Math.atan2(b.tx, b.tz); m.scale.z = b.halfL / 4; m.renderOrder = 11; edGroup.add(m); brMeshes.push(m);
  }
  for (const q of t.crossings) if (!t.bridges.some(b => Math.hypot(b.x - q.x, b.z - q.z) < 14)) { const m = new THREE.Mesh(wpGeo, brOffMat); m.position.set(q.x, heightAt(q.x, q.z) + 1.6, q.z); m.scale.setScalar(0.8); m.renderOrder = 11; edGroup.add(m); brMeshes.push(m); }
  for (const p of t.pts) arr.push(p.x, heightAt(p.x, p.z) + 0.6, p.z);
  previewLine = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)), new THREE.LineBasicMaterial({ color: 0xffe14d, depthTest: false, transparent: true }));
  previewLine.renderOrder = 9; edGroup.add(previewLine);
  edEl.querySelector('#eInfo').textContent = `${COURSE.wp.length} waypoints · ${(t.len / 1000).toFixed(2)} km · tightest corner ${Math.round(tightestCorner(t.pts.slice(0, -1).map(p => [p.x, p.z]), t.len / (t.pts.length - 1)))} m · ${t.gates.length} gates · ${t.bridges.length} bridge${t.bridges.length === 1 ? '' : 's'}${t.crossings.length ? ` · ${t.crossings.length} crossing${t.crossings.length === 1 ? '' : 's'}` : ''} · ${COURSE.ops.length} terrain strokes`
    + (COURSE.even?.length ? ` · even grade: ${COURSE.even.map(([a, b]) => { const g = TRACK?.even?.find(q => q.a === a && q.b === b); return `${a + 1}→${b + 1}${g ? ` ${g.pct >= 0 ? '+' : ''}${g.pct.toFixed(1)}%` : ''}`; }).join(', ')}` : '');
}

const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function pickGround(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set((ev.clientX - r.left) / r.width * 2 - 1, -(ev.clientY - r.top) / r.height * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const o = ray.ray.origin, d = ray.ray.direction;
  let t = 0, prevT = 0;
  for (let i = 0; i < 4000 && t < 2000; i++) {
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
    if (Math.abs(x) > HALF || Math.abs(z) > HALF) { if (t > 50) return null; }
    else if (y < heightAt(x, z)) {
      let a = prevT, b = t;
      for (let k = 0; k < 20; k++) { const m = (a + b) / 2; if (o.y + d.y * m < heightAt(o.x + d.x * m, o.z + d.z * m)) b = m; else a = m; }
      return new THREE.Vector3(o.x + d.x * b, 0, o.z + d.z * b);
    }
    prevT = t; t += Math.max(0.25, (y - (Math.abs(x) <= HALF && Math.abs(z) <= HALF ? heightAt(x, z) : 0)) * 0.4);
  }
  return null;
}
function screenDist(ev, x, y, z) {
  const r = renderer.domElement.getBoundingClientRect(), v = new THREE.Vector3(x, y, z).project(camera);
  return Math.hypot((v.x + 1) / 2 * r.width + r.left - ev.clientX, (1 - v.y) / 2 * r.height + r.top - ev.clientY);
}
function terrainOp(p) {
  const op = { t: ed.tool, x: +p.x.toFixed(2), z: +p.z.toFixed(2), r: ed.size };
  if (ed.tool === 'raise' || ed.tool === 'lower') op.s = +(0.012 * ed.str).toFixed(3);
  if (ed.tool === 'flatten') { op.s = +(0.05 * ed.str).toFixed(3); op.h = +ed.flatH.toFixed(2); }
  if (ed.tool === 'smooth') { op.s = +(0.04 * ed.str).toFixed(3); op.v = 2; }
  applyOp(op, true); COURSE.ops.push(op); ed.opsDirty = true;
}
renderer.domElement.addEventListener('pointerdown', ev => {
  if (!ed.on || ev.button !== 0) return;
  if (ed.even) {                                      // Even grade: the section's first waypoint, then its last
    let bi = -1, bd = 26;
    COURSE.wp.forEach(([x, z], i) => { const d = screenDist(ev, x, heightAt(x, z) + 1.6, z); if (d < bd) { bd = d; bi = i; } });
    if (bi < 0) { flash('Click a waypoint', '#ffd88a', 1.5); return; }
    if (ed.even.a == null) { ed.even.a = bi; ed.sel = bi; updatePreview(); flash('Now click the last waypoint of the section (forward along the course)', '#fff', 2.6); return; }
    const a = ed.even.a; endEvenPick();
    if (bi === a) { flash('Pick two different waypoints', '#ffd88a', 1.8); return; }
    COURSE.even = [...(COURSE.even || []), [a, bi]].slice(-40); ed.wpDirty = true; ed.sel = -1; updatePreview(); showShape();
    const e = evenEstimate(a, bi);
    flash(`Even grade ${a + 1}→${bi + 1}: ${Math.round(e.len)} m at ${e.pct >= 0 ? '+' : ''}${e.pct.toFixed(1)}%`, '#7dff9a', 3.2);
    return;
  }
  if (ed.tool === 'wp') {
    let bi = -1, bd = 26;
    COURSE.wp.forEach(([x, z], i) => { const d = screenDist(ev, x, heightAt(x, z) + 1.6, z); if (d < bd) { bd = d; bi = i; } });
    if (bi >= 0) {
      if (ev.shiftKey || ev.ctrlKey || ev.metaKey || ev.altKey) deleteWaypoint(bi);
      else { ed.drag = bi; ed.sel = bi; updatePreview(); }
      return;
    }
  }
  const p = pickGround(ev); if (!p) return;
  if (ed.tool === 'bridge') { toggleBridgeAt(p); return; }
  if (ed.tool === 'wp') {
    // insert into the nearest segment
    let best = 0, bdist = Infinity; const W = COURSE.wp;
    for (let i = 0; i < W.length; i++) {
      const [ax, az] = W[i], [bx, bz] = W[(i + 1) % W.length], vx = bx - ax, vz = bz - az;
      const t = clamp(((p.x - ax) * vx + (p.z - az) * vz) / (vx * vx + vz * vz || 1), 0, 1), d = Math.hypot(ax + vx * t - p.x, az + vz * t - p.z);
      if (d < bdist) { bdist = d; best = i; }
    }
    W.splice(best + 1, 0, [+clamp(p.x, -168, 168).toFixed(1), +clamp(p.z, -168, 168).toFixed(1)]); shiftEven(best + 1, 1);
    ed.wpDirty = true; ed.drag = best + 1; updatePreview();
  } else {
    ed.painting = true; ed.flatH = heightAt(p.x, p.z); ed.lastOp = 0; ed.hit = p;
  }
});
addEventListener('pointermove', ev => {
  if (!ed.on) return;
  const p = pickGround(ev); ed.hit = p;
  if (ed.drag >= 0 && p) { COURSE.wp[ed.drag] = [+clamp(p.x, -168, 168).toFixed(1), +clamp(p.z, -168, 168).toFixed(1)]; ed.wpDirty = true; updatePreview(); }
});
addEventListener('pointerup', () => { ed.drag = -1; ed.painting = false; });
renderer.domElement.addEventListener('dblclick', ev => {
  if (!ed.on || ed.tool !== 'wp') return;
  let bi = -1, bd = 26;
  COURSE.wp.forEach(([x, z], i) => { const d = screenDist(ev, x, heightAt(x, z) + 1.6, z); if (d < bd) { bd = d; bi = i; } });
  if (bi >= 0) deleteWaypoint(bi);
});

// ---------- live rebuild (#326) ----------
// A change (anything that sets ed.wpDirty or ed.opsDirty) is built once the course has stayed the same for LIVE_WAIT s and no
// waypoint is held or brush painting: the whole world for the course's own changes (regenerateWorld), the road over the
// ground for terrain strokes alone (as closing the editor did). The note under the editor's numbers says which.
const LIVE_WAIT = 0.35, LIVE = { key: null, t: 0, busy: false };
const liveEl = document.getElementById('eLive');
const liveNote = (msg, busy) => { liveEl.textContent = msg; liveEl.classList.toggle('busy', !!busy); };
function liveFrame(dt) {
  if (!ed.wpDirty && !ed.opsDirty) { LIVE.key = null; return; }
  const k = courseKey() + '|' + COURSE.ops.length;
  if (k !== LIVE.key) { LIVE.key = k; LIVE.t = 0; liveNote('Changed: building it in a moment…', true); }
  if (ed.drag >= 0 || ed.painting || LIVE.busy || (LIVE.t += dt) < LIVE_WAIT) return;
  LIVE.busy = true; liveNote('Building the course…', true);
  // two frames: the note is on the screen before the page is busy
  requestAnimationFrame(() => requestAnimationFrame(() => {
    try {
      if (!ed.on) return;                                       // closed meanwhile: closing built it
      const regen = ed.wpDirty;
      if (regen) regenerateWorld(); else { buildCircuit(); highlightGate(); resetCar(car.pos.x, car.pos.z); updateFar(); }
      ed.wpDirty = false; ed.opsDirty = false; LIVE.key = null;
      updatePreview();                                          // the markers on the ground as built
      const g = regen && TRACK.grade;
      liveNote(g ? `Built: steepest grade ${Math.round(g.before)}% → ${Math.round(g.after)}%${g.crest ? ` · crests and dips ${g.crest > 999 ? 'over 1 km in radius' : `R ${Math.round(g.crest / 10) * 10} m or more`}` : ''}` : 'Built: what you see is what you will drive');
    } catch (err) { console.warn('live rebuild:', err); liveNote('Could not build this course: see the console', true); }
    finally { LIVE.busy = false; }
  }));
}
function updateEditor(dt) {
  liveFrame(dt);
  if (ed.painting && ed.hit && (ed.lastOp -= dt) <= 0) { ed.lastOp = 0.05; terrainOp(ed.hit); }
  if (ed.opsDirty && (ed.farT += dt) > 0.4) { ed.farT = 0; updateFar(); for (let i = 0; i < wpMeshes.length; i++) { const [x, z] = COURSE.wp[i]; wpMeshes[i].position.y = heightAt(x, z) + 1.6; } }
  if (ed.hit && ed.tool !== 'wp') {
    const a = brushRing.geometry.attributes.position;
    for (let i = 0; i < 64; i++) { const t = i / 64 * TAU, x = ed.hit.x + Math.cos(t) * ed.size, z = ed.hit.z + Math.sin(t) * ed.size; a.setXYZ(i, x, heightAt(x, z) + 0.3, z); }
    a.needsUpdate = true; brushRing.visible = true;
  } else brushRing.visible = false;
}

function showBusy(msg) { const el = document.getElementById('busy'); el.textContent = msg; el.style.display = msg ? 'flex' : 'none'; }
function regenerateWorld() {
  aiHalt(false, 'the world was rebuilt (another course, ground or map)');
  TRACK = buildTrack(COURSE.wp);
  generateTerrain();
  for (const ch of chunks.values()) ch.dispose(); chunks.clear(); active.fill(0);
  buildCircuit();
  loadBest(); restartRun();
  refreshChunks(car.pos.x, car.pos.z); updateFar();
}
function toggleEditor(on) {
  if (on === ed.on) return;
  if (on) aiHalt(false, 'the course editor opened');
  ed.on = on;
  edEl.style.display = on ? 'block' : 'none';
  for (const id of ['timer', 'nav', 'hud']) document.getElementById(id).style.visibility = on ? 'hidden' : '';
  edGroup.visible = on;
  if (on) {
    ed.wpDirty = false; ed.opsDirty = false; LIVE.key = null; liveNote('Every change is built as you make it');
    camMode = 3; orbit.enabled = true;
    orbit.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    orbit.target.set(car.pos.x, car.pos.y, car.pos.z);
    camera.position.set(car.pos.x - 40, car.pos.y + 140, car.pos.z - 90);
    orbit.update();
    scene.fog.near = 400; scene.fog.far = 1400;
    ed.undoWp = null; bankEl.value = COURSE.bank || 0; levelEl.value = COURSE.level || 0; gradeEl.value = COURSE.grade || 2; showShape();
    setTool(ed.tool); updatePreview(); genShow(); genLoad().catch(() => { });
  } else {
    orbit.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    camMode = 0; orbit.enabled = false;
    scene.fog.near = WEATHER.fog[0]; scene.fog.far = WEATHER.fog[1];
    const regen = ed.wpDirty, ops = ed.opsDirty;
    saveCourse();
    if (regen) {
      showBusy('Rebuilding the course…');
      setTimeout(() => { regenerateWorld(); showBusy(''); const g = TRACK.grade; flash(g ? `Course ready · steepest grade ${Math.round(g.before)}% → ${Math.round(g.after)}%${g.crest ? ` · crests and dips ${g.crest > 999 ? 'over 1 km in radius' : `R ${Math.round(g.crest / 10) * 10} m or more`}` : ''}` : 'Course ready', '#7dff9a', g ? 3.5 : 2); }, 30);
    } else if (ops) { buildCircuit(); highlightGate(); resetCar(car.pos.x, car.pos.z); updateFar(); }
  }
}

/* =====================================================================
   GATE COLLISIONS AND DAMAGE
   Gate posts are solid. A hit pushes the buggy back, bends or snaps the
   post (and drops the banner), dents the bodywork around the impact,
   knocks the nearest wheel out of alignment and costs engine power.
   ===================================================================== */
const POST_R = 0.13; let CAR_HW = 1.02, CAR_ZF = 2.12, CAR_ZR = -1.98;
car.dmg = { front: 0, rear: 0, left: 0, right: 0, roof: 0, under: 0 };
car.hullC = new Uint8Array(car.hull.length); car.grace = 0; car.wrecked = false;
for (const W of car.wheels) { W.toe = 0; W.camber = 0; }
// hits at the engine end hurt power most (buggy: engine at the back, road cars: at the front)
function damagePower() { const d = car.dmg, eF = VEH.engineFront; return car.wrecked ? 0 : Math.max(0.25, 1 - 0.5 * (eF ? d.front : d.rear) - 0.15 * (eF ? d.rear : d.front) - 0.06 * (d.left + d.right) - 0.25 * d.under); }
const gcV = { rel: new THREE.Vector3(), L: new THREE.Vector3(), qi: new THREE.Quaternion() };
let hitCooldown = 0;
function collideGates(dt) {
  hitCooldown = Math.max(0, hitCooldown - dt);
  let ax = fwd.x, az = fwd.z; const fl = Math.hypot(ax, az); if (fl < 0.2) return; ax /= fl; az /= fl;
  const lx_ = az, lz_ = -ax;                                    // body +x (left side) on the ground
  for (const g of TRACK.gates) {
    if (!g.posts) continue;
    for (const P of g.posts) {
      if (P.down) continue;
      const dx = P.x - car.pos.x, dz = P.z - car.pos.z;
      if (dx * dx + dz * dz > 10 || car.pos.y - P.y > POST_H + 0.4) continue;
      const lx = dx * lx_ + dz * lz_, lz = dx * ax + dz * az;
      const cx = clamp(lx, -CAR_HW, CAR_HW), cz = clamp(lz, CAR_ZR, CAR_ZF);
      let ox = lx - cx, oz = lz - cz, d = Math.hypot(ox, oz), pen, nlx, nlz;
      if (d > 1e-6) { if (d >= POST_R) continue; pen = POST_R - d; nlx = ox / d; nlz = oz / d; }
      else {                                                     // post centre inside the box: shallowest way out
        const px = CAR_HW - Math.abs(lx), pf = CAR_ZF - lz, pr = lz - CAR_ZR, m = Math.min(px, pf, pr);
        if (m === px) { nlx = Math.sign(lx) || 1; nlz = 0; } else if (m === pf) { nlx = 0; nlz = 1; } else { nlx = 0; nlz = -1; }
        pen = m + POST_R;
      }
      const nx = nlx * lx_ + nlz * ax, nz = nlx * lz_ + nlz * az;   // world, car → post
      const rel = gcV.rel.set(cx * lx_ + cz * ax, 0.15, cx * lz_ + cz * az);
      const vpx = car.vel.x + car.w.y * rel.z - car.w.z * rel.y, vpz = car.vel.z + car.w.x * rel.y - car.w.y * rel.x;
      const vn = vpx * nx + vpz * nz;
      car.pos.x -= nx * pen; car.pos.z -= nz * pen;
      if (vn <= 0) continue;
      const rxn = rel.z * nx - rel.x * nz;
      const mEff = 1 / (1 / car.mass + rxn * rxn / car.I.y);
      const snaps = vn > 6.5 || P.bend + vn * 0.05 > 0.6;
      const J = mEff * vn * (snaps ? 0.4 : 1.2);                 // a snapping post absorbs only part of the momentum
      car.vel.x -= nx * J / car.mass; car.vel.z -= nz * J / car.mass;
      const L = gcV.L.set(rel.y * -nz * J - 0, rel.z * -nx * J - rel.x * -nz * J, 0 - rel.y * -nx * J);   // rel × (−n J)
      gcV.qi.copy(car.q).invert(); L.applyQuaternion(gcV.qi);
      L.x /= car.I.x; L.y /= car.I.y; L.z /= car.I.z; L.applyQuaternion(car.q); car.w.add(L);
      if (window.__hitlog) window.__hitlog.push({ vn: +vn.toFixed(2), lx: +lx.toFixed(2), lz: +lz.toFixed(2), nlx, nlz, pen: +pen.toFixed(3), snaps });
      if (vn > 0.8) { hitPost(g, P, vn, nx, nz, snaps); audio?.node.port.postMessage({ crash: Math.min(1, vn * 0.09) }); }
      if (vn > 1.5) damageCar(cx, cz, nlx, nlz, vn, g);
    }
  }
}
function hitPost(g, P, vn, nx, nz, snaps) {
  P.axis.set(nz, 0, -nx);                    // Y × push: tips the post away from the buggy
  P.hits++;
  P.bend = Math.min(P.bend + vn * 0.05, 0.6);
  P.tv += vn * 0.8;
  if (snaps) { P.down = true; if (!g.fall) g.fall = { vy: 0, k: 0 }; }
}
function updateGates(dt) {
  for (const g of TRACK.gates) {
    if (!g.posts) continue;
    for (const P of g.posts) {
      if (!P.hits) continue;
      if (P.down) {                           // topple under gravity until it lies on the ground
        P.tv += 3.9 * Math.sin(Math.max(P.tilt, 0.05)) * dt; P.tilt += P.tv * dt;
        if (P.tilt > 1.5) { P.tilt = 1.5; P.tv = Math.abs(P.tv) > 0.6 ? -P.tv * 0.25 : 0; }
      } else {                                // bent: wobbles and settles at its new lean
        P.tv += (-(P.tilt - P.bend) * 140 - P.tv * 7) * dt; P.tilt += P.tv * dt;
      }
      P.pivot.quaternion.setFromAxisAngle(P.axis, P.tilt);
    }
    const B0 = g.banner; if (!B0) continue;
    if (g.fall) {                             // banner tears loose and drops flat on the ground
      const f = g.fall, gy = heightAt(B0.position.x, B0.position.z) + 0.05;
      f.vy -= 9.81 * dt; B0.position.y = Math.max(gy, B0.position.y + f.vy * dt);
      f.k = Math.min(1, f.k + dt * 1.6);
      B0.quaternion.copy(g.bannerQ0).multiply(gcV.qi.setFromAxisAngle(v1.set(1, 0, 0), -Math.PI / 2 * f.k));
    } else if (g.posts[0].hits || g.posts[1].hits) {   // follow the bent post tops
      let x = 0, y = 0, z = 0;
      for (const P of g.posts) { v1.set(0, POST_H - 0.2, 0).applyQuaternion(P.pivot.quaternion).add(P.pivot.position); x += v1.x / 2; y += v1.y / 2; z += v1.z / 2; }
      B0.position.set(x, y - 0.2, z);
    }
  }
}
// A gate the camera comes near fades to 25% (75% transparent): fully from 6 m to its frame (the
// box between its posts, ground to banner), back to solid by 15 m.
const GATE_FADE = { near: 6, far: 15, min: 0.25 };
function fadeGates() {
  const c = camera.position;
  for (const g of TRACK.gates) {
    if (!g.fadeMats) continue;
    const a = (c.x - g.p.x) * g.t.x + (c.z - g.p.z) * g.t.z, l = Math.abs((c.x - g.p.x) * g.n.x + (c.z - g.p.z) * g.n.z) - g.half;
    const y0 = Math.min(g.posts[0].y, g.posts[1].y) - 0.2, y1 = Math.max(g.posts[0].y, g.posts[1].y) + POST_H;
    const d = Math.hypot(a, Math.max(0, l), c.y < y0 ? y0 - c.y : Math.max(0, c.y - y1));
    const o = lerp(GATE_FADE.min, 1, smooth(clamp((d - GATE_FADE.near) / (GATE_FADE.far - GATE_FADE.near), 0, 1)));
    if (Math.abs(o - g.fade) < 0.004 && (o === 1) === (g.fade === 1)) continue;
    g.fade = o;
    for (const m of g.fadeMats) {
      const see = o < 0.999;
      if (m.transparent !== see) { m.transparent = see; m.depthWrite = !see; m.needsUpdate = true; }
      m.opacity = see ? o : 1;
    }
  }
}
function repairGates() {
  for (const g of TRACK.gates) {
    if (!g.posts) continue;
    for (const P of g.posts) { Object.assign(P, { tilt: 0, bend: 0, tv: 0, down: false, hits: 0 }); P.pivot.quaternion.identity(); }
    g.fall = null; g.banner.position.copy(g.bannerP0); g.banner.quaternion.copy(g.bannerQ0);
  }
}

// --- car damage ---
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
  glassOf(V);
  dentBody(V, c, dir, vn, kind);
  glassHit(V, c, dir, vn, kind, vel);
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
  updateGlass(dt);
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
/* GLASS. isGlassMat finds it on any model: by name, or by what it is (glTF transmission, a see-through
   blend), not the dashboard's screens. glassOf(V) splits it into panes: its pieces (connected
   triangles) are typed by where they sit and face, low at the ends: lamps; above: windscreen, rear
   window, roof, side windows (one pane per big piece and the small ones nearest it); and grouped, so
   the inner and outer skins of a window are one pane. glassHit breaks them, from the load of the hit
   (its speed, fading to nothing 60 cm from the pane's nearest point) or the bending of the body around them (how unevenly
   the dents moved the pane). */
function isGlassMat(m) {
  const n = m.name || '';
  if (/display|dash|navscreen|gauge|decal/i.test(n)) return false;
  if (/glass|lens|window|windscreen|windshield/i.test(n)) return true;
  if ((m.transmission || 0) > 0.2) return true;
  return !!m.transparent && m.opacity < 0.9 && m.opacity > 0.02 && !/^INT_|paint|chrome|plastic|fabric|leather|carbon|rubber|metal|flame/i.test(n);
}
// how each kind of glass fails: laminated and plastic crack, tempered and lamp lenses burst; e: load (m/s), s: bending (m)
const GLASS_T = {
  screen: { crack: true, e: 5, s: 0.04, name: 'Windscreen cracked' }, mirror: { crack: true, e: 3.5, s: 0.03, name: 'mirror cracked' },
  side: { e: 7.5, s: 0.06, name: 'window smashed' }, rear: { e: 7.5, s: 0.06, name: 'Rear window smashed' }, roof: { e: 7.5, s: 0.06, name: 'Glass roof smashed' },
  lamp: { e: 4, s: 0.03, name: 'headlight broken' }, tail: { e: 4, s: 0.03, name: 'tail light broken' },
};
const gM = new THREE.Matrix4(), gA = new THREE.Vector3(), gB = new THREE.Vector3(), gC = new THREE.Vector3(), gD = new THREE.Vector3(), gN = new THREE.Vector3(), gQ = new THREE.Quaternion();
// triangles of a geometry → connected pieces (vertices welded at 1 mm: glTF splits them at seams)
function glassPieces(geo) {
  const pos = geo.attributes.position, idx = geo.index, nt = (idx ? idx.count : pos.count) / 3 | 0;
  const weld = new Int32Array(pos.count), seen = new Map();
  for (let i = 0; i < pos.count; i++) { const k = `${Math.round(pos.getX(i) * 1000)},${Math.round(pos.getY(i) * 1000)},${Math.round(pos.getZ(i) * 1000)}`; let w = seen.get(k); if (w === undefined) { w = seen.size; seen.set(k, w); } weld[i] = w; }
  const up = new Int32Array(seen.size); for (let i = 0; i < up.length; i++) up[i] = i;
  const find = a => { while (up[a] !== a) { up[a] = up[up[a]]; a = up[a]; } return a; };
  const vi = (t, k) => idx ? idx.getX(t * 3 + k) : t * 3 + k;
  for (let t = 0; t < nt; t++) { const a = find(weld[vi(t, 0)]), b = find(weld[vi(t, 1)]), c = find(weld[vi(t, 2)]); up[b] = a; up[find(c)] = a; }
  const comp = new Int32Array(nt), ids = new Map();
  for (let t = 0; t < nt; t++) { const r = find(weld[vi(t, 0)]); let id = ids.get(r); if (id === undefined) { id = ids.size; ids.set(r, id); } comp[t] = id; }
  return { comp, n: ids.size, nt, vi };
}
// a geometry with some of the triangles of another (attributes copied, unpacked to floats)
function subGeometry(geo, tris, vi) {
  const map = new Map(), order = [], index = [];
  for (const t of tris) for (let k = 0; k < 3; k++) { const v = vi(t, k); let m = map.get(v); if (m === undefined) { m = order.length; map.set(v, m); order.push(v); } index.push(m); }
  const out = new THREE.BufferGeometry(), get = ['getX', 'getY', 'getZ', 'getW'];
  for (const [name, a] of Object.entries(geo.attributes)) {
    const arr = new Float32Array(order.length * a.itemSize);
    for (let i = 0; i < order.length; i++) for (let c = 0; c < a.itemSize; c++) arr[i * a.itemSize + c] = a[get[c]](order[i]);
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  out.setIndex(index);
  return out;
}
// the shown meshes of a car (whether or not the car itself is shown: a model can load while it is hidden)
const shownIn = (root, cb) => { for (const ch of root.children) if (ch.visible) { cb(ch); shownIn(ch, cb); } };
function glassOf(V) {
  if (V.glass) return V.glass;
  const G = V.glass = [], meshes = [];
  shownIn(V.vis, o => { if (o.isMesh && !o.isInstancedMesh && !o.userData.sbCrack && !Array.isArray(o.material) && (o.material.userData.sbGlass || isGlassMat(o.material))) meshes.push(o); });
  if (!meshes.length) return G;
  // the body's height, from every mesh's box
  let y0 = Infinity, y1 = -Infinity; const bx = new THREE.Box3();
  shownIn(V.vis, o => { if (!o.isMesh || o.userData.sbCrack) return; if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); bx.copy(o.geometry.boundingBox).applyMatrix4(localIn(o, V.vis, gM)); y0 = Math.min(y0, bx.min.y); y1 = Math.max(y1, bx.max.y); });
  const H = y1 - y0, zF = V.box[1], zR = V.box[2], mid = (zF + zR) / 2, centre = new THREE.Vector3(0, y0 + H / 2, mid);
  const partObjs = new Set((V.parts || []).map(P => P.o));
  // its pieces: area, centre and facing in body space
  const pieces = [];
  for (const m of meshes) {
    localIn(m, V.vis, gM);
    const geo = m.geometry, pc = glassPieces(geo), pos = geo.attributes.position;
    const P = Array.from({ length: pc.n }, () => ({ m, tris: [], area: 0, c: new THREE.Vector3(), nsum: new THREE.Vector3(), big: 0, ref: null }));
    for (let t = 0; t < pc.nt; t++) {
      const p = P[pc.comp[t]];
      gA.fromBufferAttribute(pos, pc.vi(t, 0)).applyMatrix4(gM); gB.fromBufferAttribute(pos, pc.vi(t, 1)).applyMatrix4(gM); gC.fromBufferAttribute(pos, pc.vi(t, 2)).applyMatrix4(gM);
      gN.subVectors(gB, gA).cross(gD.subVectors(gC, gA)); const a2 = gN.length(); if (a2 < 1e-12) { p.tris.push(t); continue; }
      if (a2 > p.big) { p.big = a2; p.ref = gN.clone().divideScalar(a2); }
      gN.multiplyScalar(p.ref && gN.dot(p.ref) < 0 ? -1 : 1);       // a glass slab's two faces: one way
      p.tris.push(t); p.area += a2 / 2; p.nsum.add(gN); p.c.addScaledVector(gD.copy(gA).add(gB).add(gC), a2 / 6);
    }
    const hint = m.material.userData.sbGlass, inMirror = (() => { for (let o = m; o && o !== V.vis; o = o.parent) if (/mirror/i.test(o.name)) return true; return false; })();
    for (const p of P) {
      if (!p.tris.length) continue;
      if (p.area > 0) p.c.divideScalar(p.area); else { gA.fromBufferAttribute(pos, pc.vi(p.tris[0], 0)).applyMatrix4(gM); p.c.copy(gA); }
      const n = p.nsum.lengthSq() > 0 ? p.nsum.normalize() : gN.set(0, 1, 0).clone();
      if (n.dot(gA.subVectors(p.c, centre)) < 0) n.negate();
      p.n = n;
      const low = p.c.y < y0 + 0.66 * H, nearEnd = p.c.z > zF - 0.9 || p.c.z < zR + 0.9;
      p.type = /deflector/i.test(m.material.name) ? 'screen' : inMirror || hint === 'mirror' ? 'mirror'
        : hint === 'lamp' || hint === 'tail' ? (hint === 'tail' || p.c.z < mid ? 'tail' : 'lamp')
        : low && (nearEnd || p.c.y < y0 + 0.45 * H) ? (p.c.z > mid ? 'lamp' : 'tail')
        : Math.abs(n.x) > 0.55 ? 'side' : n.y > 0.85 && Math.abs(n.z) < 0.35 ? 'roof' : n.z > 0 ? 'screen' : 'rear';
      pieces.push(p);
    }
  }
  // panes: the windscreen, rear and roof one each; side windows one per big piece (inner and outer skins
  // together) and the small ones nearest it; lamps and mirrors one per side
  const sideOf = p => Math.abs(p.c.x) < 0.2 ? 'C' : p.c.x > 0 ? 'L' : 'R';
  const anchors = [];
  for (const p of pieces.filter(p => p.type === 'side' && p.area > 0.05).sort((a, b) => b.area - a.area)) {
    const a = anchors.find(q => sideOf(q) === sideOf(p) && q.c.distanceTo(p.c) < 0.2);
    p.slot = a ? a.slot : `side${anchors.push(p) - 1}`;
  }
  for (const p of pieces) {
    if (p.slot) continue;
    if (p.type === 'side') {
      let best = null, bd = 1.2; for (const a of anchors) if (sideOf(a) === sideOf(p)) { const dd = a.c.distanceTo(p.c); if (dd < bd) { bd = dd; best = a; } }
      p.slot = best ? best.slot : `side${sideOf(p)}${Math.round(p.c.z * 2)}`;
    } else p.slot = p.type === 'mirror' ? p.type + sideOf(p) : p.type === 'lamp' || p.type === 'tail' ? `${p.type}${sideOf(p)}${Math.round(p.c.z / 0.8)}` : p.type;
  }
  // a part's mesh (a door, a bumper) stays whole: it is one pane, of its biggest piece's kind
  for (const m of meshes) {
    if (!partObjs.has(m) && !/^part_/.test(m.name)) continue;
    const ps = pieces.filter(p => p.m === m); const top = ps.reduce((a, b) => (b.area > a.area ? b : a), ps[0]);
    for (const p of ps) { p.slot = top.slot + '@' + m.uuid; p.type = top.type; }
  }
  const panes = new Map();
  for (const p of pieces) { let P = panes.get(p.slot); if (!P) panes.set(p.slot, P = { slot: p.slot, type: p.type, pieces: [], meshes: [], area: 0, c: new THREE.Vector3(), n: new THREE.Vector3() }); P.pieces.push(p); P.area += p.area; P.c.addScaledVector(p.c, p.area); P.n.addScaledVector(p.n, p.area); }
  // one mesh per pane: a mesh holding several panes is split, one holding one is kept
  let split = false;
  for (const m of meshes) {
    const mine = [...panes.values()].filter(P => P.pieces.some(p => p.m === m));
    if (!mine.length) continue;
    if (mine.length === 1) { mine[0].meshes.push(m); m.userData.sbPane = true; continue; }
    const pc = glassPieces(m.geometry);
    for (const P of mine) {
      const tris = P.pieces.filter(p => p.m === m).flatMap(p => p.tris);
      const pm = new THREE.Mesh(subGeometry(m.geometry, tris, pc.vi), m.material);
      pm.name = `${m.name}_${P.slot}`; pm.position.copy(m.position); pm.quaternion.copy(m.quaternion); pm.scale.copy(m.scale);
      pm.castShadow = m.castShadow; pm.receiveShadow = m.receiveShadow; pm.renderOrder = m.renderOrder; pm.userData.sbPane = true;
      m.parent.add(pm); P.meshes.push(pm);
    }
    m.parent.remove(m); split = true;
  }
  if (split) V.dentables = null;
  // each pane's frame (for the cracks' texture: uv1 is the pane flattened onto its plane)
  for (const P of panes.values()) {
    if (P.area > 0) P.c.divideScalar(P.area); P.n.normalize(); if (P.n.lengthSq() < 0.5) P.n.set(0, 0, 1);
    P.t1 = new THREE.Vector3().crossVectors(Math.abs(P.n.y) > 0.9 ? gA.set(0, 0, 1) : gA.set(0, 1, 0), P.n).normalize(); P.t2 = new THREE.Vector3().crossVectors(P.n, P.t1);
    let R = 0.05;
    for (const m of P.meshes) { localIn(m, V.vis, gM); const pos = m.geometry.attributes.position; for (let i = 0; i < pos.count; i++) R = Math.max(R, gA.fromBufferAttribute(pos, i).applyMatrix4(gM).distanceTo(P.c)); }
    for (const m of P.meshes) {
      localIn(m, V.vis, gM); const pos = m.geometry.attributes.position, uv = new Float32Array(pos.count * 2);
      for (let i = 0; i < pos.count; i++) { gA.fromBufferAttribute(pos, i).applyMatrix4(gM).sub(P.c); uv[i * 2] = gA.dot(P.t1) / (2 * R) + 0.5; uv[i * 2 + 1] = gA.dot(P.t2) / (2 * R) + 0.5; }
      m.geometry.setAttribute('uv1', new THREE.BufferAttribute(uv, 2));
    }
    Object.assign(P, { R, state: 0, cracks: 0, crack: null, overlays: [] });
    delete P.pieces;
    G.push(P);
  }
  return G;
}
// how far a hit was from a pane (m): its nearest vertex as built (the dent this hit made has already pushed it away), a post: across the ground only
function paneDist(V, P, c, post) {
  gD.subVectors(P.c, c); if (post) gD.y = 0;
  if (gD.length() - P.R > 0.7) return 1;
  let best = Infinity;
  for (const m of P.meshes) {
    localIn(m, V.vis, gM); const pos = (m.userData.orig?.geo ?? m.geometry).attributes.position;
    for (let i = 0; i < pos.count; i++) { gA.fromBufferAttribute(pos, i).applyMatrix4(gM).sub(c); if (post) gA.y = 0; best = Math.min(best, gA.lengthSq()); }
  }
  return Math.sqrt(best);
}
// how unevenly the dents have moved a pane (m): its vertices' moves less their mean move
function paneStrain(V, P) {
  let worst = 0;
  for (const m of P.meshes) {
    const o = m.userData.orig; if (!o) continue;
    localIn(m, V.vis, gM);
    const pos = m.geometry.attributes.position, p0 = o.geo.attributes.position, n = pos.count, mean = gC.set(0, 0, 0);
    for (let i = 0; i < n; i++) mean.add(gA.fromBufferAttribute(pos, i).applyMatrix4(gM).sub(gB.fromBufferAttribute(p0, i).applyMatrix4(gM)));
    mean.divideScalar(Math.max(1, n));
    for (let i = 0; i < n; i++) worst = Math.max(worst, gA.fromBufferAttribute(pos, i).applyMatrix4(gM).sub(gB.fromBufferAttribute(p0, i).applyMatrix4(gM)).sub(mean).length());
  }
  return worst;
}
function glassHit(V, c, dir, vn, kind, vel) {
  const G = glassOf(V); if (!G.length || vn < 1.5) return;
  const said = []; let noise = 0;
  for (const P of G) {
    if (P.state === 2 || P.meshes.every(m => m.userData.loose)) continue;      // smashed, or gone with its door
    const d = paneDist(V, P, c, kind === HIT.post), e = vn * (1 - sstep(0.05, 0.6, d)), T = GLASS_T[P.type];
    for (const ov of P.overlays) ov.geometry = ov.parent.geometry;             // cracks follow the dents
    if (e <= T.e && paneStrain(V, P) <= T.s) continue;
    const side = P.c.x > 0 ? 'Left' : 'Right';
    if (T.crack) { if (P.cracks >= 6) continue; crackPane(P, c, e / T.e); noise += 0.25; if (P.cracks === 1) said.push(P.type === 'screen' ? T.name : `${side} ${T.name}`); }
    else { shatterPane(V, P, dir, vel, e); noise += P.type === 'lamp' || P.type === 'tail' ? 0.3 : 0.7; said.push(P.type === 'side' || P.type === 'lamp' || P.type === 'tail' ? `${side} ${T.name}` : T.name); }
  }
  if (!noise) return;
  const near = V === VEH ? 1 : 1 / (1 + V.vis.position.distanceTo(car.pos) / 8);
  if (near > 0.05) audio?.node.port.postMessage({ glass: Math.min(1.2, noise * near) });
  if (V === VEH && said.length) flash(said.join(' · '), '#cfe8ff', 2.4);
}
// a web of cracks round where it was hit: radial cracks, rings across them, a crushed core
let glassSeed = 1;
const glassRnd = () => { glassSeed = (glassSeed + 0x6D2B79F5) | 0; let t = glassSeed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
function crackPane(P, c, load) {
  const W = 512;
  if (!P.crack) {
    const cv = document.createElement('canvas'); cv.width = cv.height = W;
    const tex = new THREE.CanvasTexture(cv); tex.channel = 1; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    P.crack = { cv, ctx: cv.getContext('2d'), tex, mat };
    for (const m of P.meshes) { const ov = new THREE.Mesh(m.geometry, mat); ov.userData.sbCrack = true; ov.renderOrder = (m.renderOrder || 0) + 1; m.add(ov); P.overlays.push(ov); }
  }
  // where on the pane (the nearest point of it if the hit was off it), and how far the web runs
  gA.subVectors(c, P.c);
  const u = clamp(gA.dot(P.t1) / (2 * P.R) + 0.5, 0.08, 0.92), v = clamp(gA.dot(P.t2) / (2 * P.R) + 0.5, 0.08, 0.92);
  glassSeed = Math.floor(hash01(P.cracks + 1, c, load) * 2 ** 31);        // the same web on every copy of the car
  const x = P.crack.ctx, cx = u * W, cy = (1 - v) * W, R = W * clamp(0.18 + 0.22 * load, 0.2, 0.75);
  x.lineCap = 'round'; x.lineJoin = 'round';
  const nr = 9 + Math.floor(glassRnd() * 8), rays = [];
  for (let i = 0; i < nr; i++) {
    let a = (i + glassRnd() * 0.7) / nr * Math.PI * 2, px = cx, py = cy; const len = R * (0.5 + glassRnd() * 0.7), seg = 7 + Math.floor(glassRnd() * 4), pts = [[px, py]];
    for (let k = 0; k < seg; k++) { a += (glassRnd() - 0.5) * 0.45; const l = len / seg; px += Math.cos(a) * l; py += Math.sin(a) * l; pts.push([px, py]); }
    rays.push(pts);
    for (let k = 1; k < pts.length; k++) { x.strokeStyle = `rgba(232,242,248,${0.95 - 0.5 * k / pts.length})`; x.lineWidth = 2.2 - 1.5 * k / pts.length; x.beginPath(); x.moveTo(...pts[k - 1]); x.lineTo(...pts[k]); x.stroke(); }
  }
  for (let ring = 1; ring <= 3; ring++) {                                   // rings: from ray to ray, a little way out
    const f = (0.16 + 0.17 * ring) * (0.85 + glassRnd() * 0.3);
    x.strokeStyle = 'rgba(225,238,245,0.7)'; x.lineWidth = 1; x.beginPath();
    rays.forEach((pts, i) => { const q = pts[Math.min(pts.length - 1, Math.round(f * (pts.length - 1)))], j = (glassRnd() - 0.5) * 6; if (i === 0) x.moveTo(q[0] + j, q[1] + j); else x.lineTo(q[0] + j, q[1] + j); });
    x.closePath(); x.stroke();
  }
  x.fillStyle = 'rgba(230,240,246,0.55)'; x.beginPath(); x.arc(cx, cy, R * 0.06, 0, Math.PI * 2); x.fill();
  P.crack.tex.needsUpdate = true; P.state = 1; P.cracks++;
}
// Shards: tempered glass in small cubes, lamp lenses in flakes; they fly, bounce, settle, and go after half a minute
const SHARD_MAX = 1600, SHARD_LIFE = 30;
const shardMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.85, depthWrite: false }), SHARD_MAX);
shardMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); shardMesh.frustumCulled = false; shardMesh.castShadow = false;
const SH = { p: new Float32Array(SHARD_MAX * 3), v: new Float32Array(SHARD_MAX * 3), q: Array.from({ length: SHARD_MAX }, () => new THREE.Quaternion()), w: new Float32Array(SHARD_MAX * 3), s: new Float32Array(SHARD_MAX * 3),
  age: new Float32Array(SHARD_MAX).fill(-1), rest: new Uint8Array(SHARD_MAX), owner: new Array(SHARD_MAX).fill(null), next: 0, live: 0 };
{ const zero = new THREE.Matrix4().makeScale(0, 0, 0), white = new THREE.Color(1, 1, 1); for (let i = 0; i < SHARD_MAX; i++) { shardMesh.setMatrixAt(i, zero); shardMesh.setColorAt(i, white); } }
scene.add(shardMesh);
const SHARD_COL = { side: 0xb7d2cc, rear: 0xb7d2cc, roof: 0xb7d2cc, lamp: 0xe6eef4, tail: 0xc8141c };
const shColor = new THREE.Color(), shM = new THREE.Matrix4(), shP = new THREE.Vector3(), shS = new THREE.Vector3(), shQ = new THREE.Quaternion();
function shatterPane(V, P, dir, vel, e) {
  P.state = 2;
  for (const m of P.meshes) m.visible = false;
  V.vis.updateMatrixWorld(true); V.vis.getWorldQuaternion(gQ);
  const into = gN.copy(dir).applyQuaternion(gQ), lamp = P.type === 'lamp' || P.type === 'tail';
  shColor.setHex(SHARD_COL[P.type] ?? 0xb7d2cc);
  // points on the pane, by area
  const tris = [];
  let total = 0;
  for (const m of P.meshes) {
    const pos = m.geometry.attributes.position, idx = m.geometry.index, nt = (idx ? idx.count : pos.count) / 3 | 0;
    for (let t = 0; t < nt; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      const a = new THREE.Vector3().fromBufferAttribute(pos, i0).applyMatrix4(m.matrixWorld), b = new THREE.Vector3().fromBufferAttribute(pos, i1).applyMatrix4(m.matrixWorld), cc = new THREE.Vector3().fromBufferAttribute(pos, i2).applyMatrix4(m.matrixWorld);
      const ar = gA.subVectors(b, a).cross(gB.subVectors(cc, a)).length() / 2; if (ar < 1e-7) continue;
      total += ar; tris.push([a, b, cc, total]);
    }
  }
  if (!tris.length) return;
  const count = Math.round(clamp(P.area * (lamp ? 140 : 170), lamp ? 6 : 14, lamp ? 50 : 110)), k = Math.min(1, e / 15);
  for (let n = 0; n < count; n++) {
    const r = Math.random() * total; let lo = 0; while (tris[lo][3] < r) lo++;
    const [a, b, cc] = tris[lo]; let r1 = Math.random(), r2 = Math.random(); if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; }
    const i = SH.next; SH.next = (SH.next + 1) % SHARD_MAX;
    shP.copy(a).addScaledVector(gA.subVectors(b, a), r1).addScaledVector(gB.subVectors(cc, a), r2);
    SH.p.set([shP.x, shP.y, shP.z], i * 3);
    // with the car, and on through the frame (tempered glass falls into the cabin), scattered
    const push = lamp ? 0.4 + Math.random() : 0.8 + Math.random() * 2.2 * (0.5 + k);
    SH.v.set([vel.x * 0.85 + into.x * push + (Math.random() - 0.5) * 2.4 * (0.4 + k), vel.y * 0.85 + into.y * push + 0.3 + Math.random() * 1.8 * (0.4 + k), vel.z * 0.85 + into.z * push + (Math.random() - 0.5) * 2.4 * (0.4 + k)], i * 3);
    SH.w.set([(Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30], i * 3);
    SH.q[i].random();
    if (lamp) SH.s.set([0.015 + Math.random() * 0.03, 0.003, 0.012 + Math.random() * 0.025], i * 3);
    else { const z = 0.009 + Math.random() * 0.012; SH.s.set([z * (0.8 + Math.random() * 0.5), 0.005, z * (0.8 + Math.random() * 0.5)], i * 3); }
    SH.age[i] = 0; SH.rest[i] = 0; SH.owner[i] = V;
    shardMesh.setColorAt(i, shColor);
  }
  shardMesh.instanceColor.needsUpdate = true;
}
const shW = new THREE.Vector3(), shZero = new THREE.Matrix4().makeScale(0, 0, 0);
function updateGlass(dt) {
  let dirty = false;
  for (let i = 0; i < SHARD_MAX; i++) {
    if (SH.age[i] < 0) continue;
    const a = (SH.age[i] += dt), o = i * 3;
    if (a > SHARD_LIFE) { SH.age[i] = -1; SH.owner[i] = null; shardMesh.setMatrixAt(i, shZero); dirty = true; continue; }
    const fade = a > SHARD_LIFE - 2 ? (SHARD_LIFE - a) / 2 : 1;
    if (!SH.rest[i]) {
      SH.v[o + 1] -= 9.81 * dt;
      SH.p[o] += SH.v[o] * dt; SH.p[o + 1] += SH.v[o + 1] * dt; SH.p[o + 2] += SH.v[o + 2] * dt;
      shW.set(SH.w[o], SH.w[o + 1], SH.w[o + 2]); const ws = shW.length(); if (ws > 1e-3) SH.q[i].premultiply(shQ.setFromAxisAngle(shW.divideScalar(ws), ws * dt));
      const gy = surfaceAt(SH.p[o], SH.p[o + 2], SH.p[o + 1]) + SH.s[o + 1] / 2;
      if (SH.p[o + 1] < gy) {
        SH.p[o + 1] = gy; SH.v[o + 1] = Math.abs(SH.v[o + 1]) * 0.25; SH.v[o] *= 0.5; SH.v[o + 2] *= 0.5; SH.w[o] *= 0.4; SH.w[o + 1] *= 0.4; SH.w[o + 2] *= 0.4;
        if (SH.v[o] ** 2 + SH.v[o + 1] ** 2 + SH.v[o + 2] ** 2 < 0.25) SH.rest[i] = 1;
      }
    } else if (fade === 1) continue;
    shM.compose(shP.set(SH.p[o], SH.p[o + 1], SH.p[o + 2]), SH.q[i], shS.set(SH.s[o] * fade, SH.s[o + 1] * fade, SH.s[o + 2] * fade));
    shardMesh.setMatrixAt(i, shM); dirty = true;
  }
  if (dirty) shardMesh.instanceMatrix.needsUpdate = true;
}
// as built: panes back in, cracks gone, its shards swept up
function repairGlass(V) {
  if (V.glass) for (const P of V.glass) {
    for (const m of P.meshes) m.visible = true;
    for (const ov of P.overlays) ov.parent?.remove(ov);
    if (P.crack) { P.crack.tex.dispose(); P.crack.mat.dispose(); }
    Object.assign(P, { state: 0, cracks: 0, crack: null, overlays: [] });
  }
  let any = false;
  for (let i = 0; i < SHARD_MAX; i++) if (SH.owner[i] === V) { SH.age[i] = -1; SH.owner[i] = null; shardMesh.setMatrixAt(i, shZero); any = true; }
  if (any) shardMesh.instanceMatrix.needsUpdate = true;
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
  repairGlass(V);
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
  if (car.isRival) return;
  document.getElementById('wreck').style.display = 'flex';
  flash('WRECKED', '#ff5040', 3);
}
function repairCar() {
  for (const z of ZONES) car.dmg[z] = 0;
  for (const W of car.wheels) { W.toe = 0; W.camber = 0; if (W.hp0) W.hp.copy(W.hp0); W.sag = 0; }
  repairBody(VEH);
  car.wrecked = false; if (!car.isRival) document.getElementById('wreck').style.display = 'none';
  carRepairHook?.();
}
function repairAll() { repairCar(); repairGates(); for (const b of BOTS.list) repairBody(b.V); }

// damage read-out: a small top-down buggy with the four zones coloured
const dmgCv = document.getElementById('dmg'), dmgCtx = dmgCv.getContext('2d');
let dmgKey = '';
function drawDamage() {
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

/* =====================================================================
   VEHICLES: the buggy plus three road cars on the same physics
   ===================================================================== */
/* =====================================================================
   ROAD CARS: bodies lofted from side / plan profiles at real dimensions,
   with lights, grilles, glass and trim projected onto the body surface.
   Body axes as for the buggy: +z forward, +y up, +x = left side.
   ===================================================================== */
// monotone cubic interpolation through [s, value] knots (no overshoot)
function mono(tbl) {
  const n = tbl.length, xs = tbl.map(p => p[0]), ys = tbl.map(p => p[1]), d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return s => {
    if (s <= xs[0]) return ys[0]; if (s >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (s > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (s - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}
const ML = 5, MU = 3.4;   // superellipse exponents: boxy lower body, rounder greenhouse
function makeBodyShape(S) {
  const top = mono(S.top), bot = mono(S.bot), belt = mono(S.belt), hw = mono(S.halfW);
  const c = S.cab, cabF = s => smooth(clamp((s - c.ws + 0.01) / 0.06, 0, 1)) * (1 - smooth(clamp((s - c.bk + 0.03) / 0.05, 0, 1)));
  // section at s (0 = front bumper, 1 = rear): heights above ground
  function sec(s) {
    const yb = bot(s), yt = Math.max(top(s), yb + 0.004), w = hw(s);
    const ys = clamp(Math.min(belt(s), yt - 0.035 + (S.fenderRise || 0)), yb + 0.002, yt - 0.002 + (S.fenderRise || 0));
    return { yb, yt, ys, w, wg: w * lerp(1, S.greenW, cabF(s)) };
  }
  // right-side point for ring parameter a: 0 = bottom centre, 0.5 = shoulder, 1 = top centre
  function pt(q, a) {
    if (a <= 0.5) {
      const ph = (0.5 - a) / 0.5 * Math.PI / 2, sn = Math.sin(ph), cs = Math.cos(ph);
      return [q.w * Math.pow(cs, 2 / ML) * (1 - 0.035 * sn), q.ys - (q.ys - q.yb) * Math.pow(sn, 2 / ML), -1];
    }
    const th = (a - 0.5) / 0.5 * Math.PI / 2, sn = Math.sin(th), cs = Math.cos(th), tt = Math.pow(sn, 2 / MU);
    return [lerp(q.w, q.wg, Math.pow(tt, 0.8)) * Math.pow(cs, 2 / MU), q.ys + (q.yt - q.ys) * tt, tt];
  }
  // half-width of the body at height h in section s
  function xAt(s, h) {
    const q = sec(s);
    if (h < q.yb || h > Math.max(q.yt, q.ys)) return -1;
    if (h <= q.ys) { const sn = Math.pow(clamp((q.ys - h) / Math.max(q.ys - q.yb, 1e-4), 0, 1), ML / 2), cs = Math.sqrt(1 - sn * sn); return q.w * Math.pow(cs, 2 / ML) * (1 - 0.035 * sn); }
    const tt = Math.abs(q.yt - q.ys) < 1e-4 ? 0 : clamp((h - q.ys) / (q.yt - q.ys), 0, 1), sn = Math.pow(tt, MU / 2), cs = Math.sqrt(Math.max(0, 1 - sn * sn));
    return lerp(q.w, q.wg, Math.pow(tt, 0.8)) * Math.pow(cs, 2 / MU);
  }
  // height of the upper surface at lateral offset x in section s
  function yTop(s, x) {
    const q = sec(s); x = Math.abs(x);
    let lo = 0.5, hi = 1;
    for (let i = 0; i < 26; i++) { const m = (lo + hi) / 2; if (pt(q, m)[0] > x) lo = m; else hi = m; }
    return pt(q, (lo + hi) / 2)[1];
  }
  // first section (from the front, or from the rear) that contains (x, h): projects a front / rear view onto the body
  function sAt(x, h, fromRear) {
    const inside = s => xAt(s, h) >= Math.abs(x);
    let a = fromRear ? 1 : 0, b = fromRear ? 0.62 : 0.38;
    if (!inside(b)) return null;
    for (let i = 0; i < 24; i++) { const m = (a + b) / 2; if (inside(m)) b = m; else a = m; }
    return b;
  }
  return { sec, pt, xAt, yTop, sAt, cabF };
}

function buildRoadCar(S) {
  const g = new THREE.Group();
  const B = makeBodyShape(S), L = S.L, zF = S.zF, yG = S.yG;
  const Z = s => zF - s * L, Sz = z => (zF - z) / L;     // s ↔ body z
  const M = {
    paint: new THREE.MeshPhysicalMaterial({ color: S.color, roughness: S.paintRough ?? 0.32, metalness: S.metallic ?? 0.55, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.1 }),
    glass: new THREE.MeshPhysicalMaterial({ name: 'glass', color: 0x0a0d11, roughness: 0.04, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6, side: THREE.DoubleSide }),
    trim: new THREE.MeshPhysicalMaterial({ color: 0x0b0b0c, roughness: 0.18, metalness: 0.1, clearcoat: 1, side: THREE.DoubleSide }),
    plastic: new THREE.MeshStandardMaterial({ color: 0x141516, roughness: 0.72, side: THREE.DoubleSide }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xe8ebee, roughness: 0.08, metalness: 1, envMapIntensity: 1.4, side: THREE.DoubleSide }),
    satin: new THREE.MeshStandardMaterial({ color: 0xb9bdc2, roughness: 0.35, metalness: 0.9, side: THREE.DoubleSide }),
    well: new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.9, side: THREE.DoubleSide }),
    lens: new THREE.MeshPhysicalMaterial({ color: 0x23272c, roughness: 0.08, metalness: 0.9, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6, side: THREE.DoubleSide }),
    drl: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xeaf4ff, emissiveIntensity: 2.2, side: THREE.DoubleSide }),
    tail: new THREE.MeshPhysicalMaterial({ color: 0x5a0606, roughness: 0.12, clearcoat: 1, emissive: 0xff1208, emissiveIntensity: 0.5, side: THREE.DoubleSide }),
    rev: new THREE.MeshStandardMaterial({ color: 0xdedede, roughness: 0.1, emissive: 0xffffff, emissiveIntensity: 0, side: THREE.DoubleSide }),
    plate: new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.5, side: THREE.DoubleSide }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.9 }),
    rim: new THREE.MeshPhysicalMaterial({ color: S.rimColor ?? 0x9aa0a6, roughness: S.rimRough ?? 0.25, metalness: 0.9, clearcoat: 0.6, envMapIntensity: 1.2 }),
    disc: new THREE.MeshStandardMaterial({ color: 0x6d6f72, roughness: 0.45, metalness: 0.85 }),
    caliper: new THREE.MeshPhysicalMaterial({ color: S.caliper ?? 0x2a2c30, roughness: 0.3, clearcoat: 1 }),
    flame: new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
  };
  const honey = (() => {     // honeycomb / mesh grille texture
    const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
    x.fillStyle = '#0d0d0e'; x.fillRect(0, 0, 128, 128); x.strokeStyle = S.grilleMesh || '#3a3c40'; x.lineWidth = 5;
    for (let j = -1; j < 5; j++) for (let i = -1; i < 5; i++) { const cx = i * 32 + (j % 2 ? 16 : 0), cy = j * 28; x.beginPath(); for (let k = 0; k < 6; k++) { const a = k / 6 * TAU + Math.PI / 6; x.lineTo(cx + Math.cos(a) * 15, cy + Math.sin(a) * 15); } x.closePath(); x.stroke(); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  M.grille = new THREE.MeshStandardMaterial({ map: honey, roughness: 0.55, metalness: 0.3, side: THREE.DoubleSide });

  /* ---------- body shell ---------- */
  const NS = 170, NA = 30;   // sections along the car, points per half ring
  const sOf = i => { const u = i / (NS - 1); return 0.5 - 0.5 * Math.cos(Math.PI * u) * 0.985 - 0.0075 * Math.sign(0.5 - u) * 0 ; };
  const ringA = []; for (let k = 0; k <= NA; k++) { const u = k / NA; ringA.push(u < 0.5 ? 0.5 * smooth(u * 2) ** 0.9 : u); }
  const RING = 2 * NA;       // right side bottom→top (NA+1 pts) + left side top→bottom without the shared centre points
  const pos = [], tag = [];  // tag: 0 body, 1 under, 2 well
  const wheelsZ = S.axles;   // [{z, R, xIn}]
  for (let i = 0; i < NS; i++) {
    const s = clamp(sOf(i), 0, 1), q = B.sec(s), z = Z(s);
    const right = ringA.map(a => B.pt(q, a));
    const ringPts = right.concat(right.slice(1, NA).reverse().map(p => [-p[0], p[1], p[2]]));
    for (const [x0, h0, tt] of ringPts) {
      let x = x0, h = h0, zz = z, t = (h - q.yb) < 0.02 && Math.abs(x) < q.w * 0.9 ? 1 : 0;
      for (const A of wheelsZ) {   // wheel arch: the side is pushed in around each wheel; vertices just outside snap onto the arch circle
        const dz = z - A.z, dh = h - A.R, d = Math.hypot(dz, dh), r = A.arch;
        if (Math.abs(x) <= A.xIn || h > q.ys + 0.03) continue;
        if (d < r) { x = Math.sign(x) * A.xIn; t = 2; }
      }
      pos.push(x, yG + h, zz); tag.push(t);
    }
  }
  const idx = { body: [], under: [], well: [] };
  for (let i = 0; i < NS - 1; i++) for (let j = 0; j < RING; j++) {
    const a = i * RING + j, b = i * RING + (j + 1) % RING, c2 = (i + 1) * RING + j, d = (i + 1) * RING + (j + 1) % RING;
    const tg = [tag[a], tag[b], tag[c2], tag[d]];
    const k = tg.every(t => t === 2) ? 'well' : tg.every(t => t === 1) ? 'under' : 'body';
    idx[k].push(a, c2, b, b, c2, d);
  }
  // end caps
  for (const [i, flip] of [[0, false], [NS - 1, true]]) {
    let cx = 0, cy = 0, cz = 0; for (let j = 0; j < RING; j++) { cx += pos[(i * RING + j) * 3]; cy += pos[(i * RING + j) * 3 + 1]; cz += pos[(i * RING + j) * 3 + 2]; }
    const ci = pos.length / 3; pos.push(cx / RING, cy / RING, cz / RING); tag.push(0);
    for (let j = 0; j < RING; j++) { const a = i * RING + j, b = i * RING + (j + 1) % RING; if (flip) idx.body.push(ci, b, a); else idx.body.push(ci, a, b); }   // outward-facing: +z at the front, -z at the rear
  }
  const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const all = []; let off = 0; const groups = [];
  for (const [k, mi] of [['body', 0], ['under', 1], ['well', 2]]) { all.push(...idx[k]); groups.push([off, idx[k].length, mi]); off += idx[k].length; }
  bg.setIndex(all); for (const [st, n, mi] of groups) bg.addGroup(st, n, mi);
  bg.computeVertexNormals();
  const body = new THREE.Mesh(bg, [M.paint, M.plastic, M.well]); g.add(body);
  // wheel-arch lips: a ribbon that follows the arch on the body side and curls into the well (hides the cut)
  for (const A of wheelsZ) for (const sg of [1, -1]) {
    const lp = [], li = [], NSEG = 48, rows = [[0.035, 0.004, 0], [0.0, 0.012, 0], [-0.012, 0, 1], [-0.012, 0, 2]];
    for (let k = 0; k <= NSEG; k++) {
      const ph = lerp(-0.12, Math.PI + 0.12, k / NSEG), cz = Math.cos(ph), ch = Math.sin(ph);
      for (const [dr, lift, mode] of rows) {
        const r = A.arch + dr, z = A.z + cz * r, h = Math.max(A.R + ch * r, 0.02), s = clamp(Sz(z), 0, 1);
        let x = B.xAt(s, h); if (x < 0) x = B.sec(s).w;
        if (mode === 1) x = lerp(x, A.xIn, 0.35); else if (mode === 2) x = A.xIn - 0.01; else x += lift;
        lp.push(x * sg, yG + h, z);
      }
    }
    const R4 = rows.length;
    for (let k = 0; k < NSEG; k++) for (let j = 0; j < R4 - 1; j++) { const a = k * R4 + j, b = a + 1, c = a + R4, d = c + 1; li.push(a, c, b, b, c, d); }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3)); lg.setIndex(li); lg.computeVertexNormals();
    const lip = new THREE.Mesh(lg, S.archMat === 'plastic' ? M.plastic : M.paint.clone()); lip.material.side = THREE.DoubleSide; g.add(lip);
  }

  /* ---------- projected parts (glass, lamps, grilles, trim) ---------- */
  function subdivide(geo, levels) {
    let p = geo.index ? geo.toNonIndexed().attributes.position.array : geo.attributes.position.array;
    for (let l = 0; l < levels; l++) {
      const o = [];
      for (let i = 0; i < p.length; i += 9) {
        const A = [p[i], p[i + 1]], Bv = [p[i + 3], p[i + 4]], C = [p[i + 6], p[i + 7]];
        const ab = [(A[0] + Bv[0]) / 2, (A[1] + Bv[1]) / 2], bc = [(Bv[0] + C[0]) / 2, (Bv[1] + C[1]) / 2], ca = [(C[0] + A[0]) / 2, (C[1] + A[1]) / 2];
        for (const [u, v, w] of [[A, ab, ca], [ab, Bv, bc], [ca, bc, C], [ab, bc, ca]]) o.push(u[0], u[1], 0, v[0], v[1], 0, w[0], w[1], 0);
      }
      p = o;
    }
    return p;
  }
  // view: 'side' (pts = [distance from front, height]), 'front' / 'rear' ([x, height]), 'top' ([x, distance from front])
  function project(view, pts, mat, lift = 0.006, opts = {}) {
    const shape = new THREE.Shape(pts.map(([a, b]) => new THREE.Vector2(a, b)));
    for (const hole of opts.holes || []) shape.holes.push(new THREE.Path(hole.map(([a, b]) => new THREE.Vector2(a, b))));
    const flat = subdivide(new THREE.ShapeGeometry(shape, 6), opts.sub ?? 3);
    const out = [], uv = [];
    for (let i = 0; i < flat.length; i += 3) {
      const a = flat[i], b = flat[i + 1]; let x, y, z;
      if (view === 'side') { const s = a / L; x = B.xAt(s, b); if (x < 0) return null; x = (x + lift) * (opts.sign || 1); y = yG + b; z = Z(s); }
      else if (view === 'top') { const s = b / L; x = a; y = yG + B.yTop(s, a) + lift; z = Z(s); }
      else {
        let s = null, xa = a;
        for (let k = 0; k < 14 && s == null; k++) { xa = a * (1 - k * 0.04); s = B.sAt(xa, b, view === 'rear'); }
        x = a; y = yG + b; z = s == null ? (view === 'rear' ? Z(1) - lift : Z(0) + lift) : Z(s) + (view === 'rear' ? -lift : lift);
      }
      out.push(x, y, z); uv.push(a * (opts.uvk || 6), b * (opts.uvk || 6));
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(out, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat); g.add(m); return m;
  }
  const mirrorX = pts => pts.map(([x, y]) => [-x, y]);
  const both = (view, pts, mat, lift, opts) => { project(view, pts, mat, lift, opts); project(view, mirrorX(pts), mat, lift, opts); };
  const sides = (pts, mat, lift, opts = {}) => { project('side', pts, mat, lift, { ...opts, sign: 1 }); project('side', pts, mat, lift, { ...opts, sign: -1 }); };
  // offset a closed polygon outward (approximate, by vertex normals)
  const grow = (pts, d) => pts.map((p, i) => {
    const a = pts[(i - 1 + pts.length) % pts.length], b = pts[(i + 1) % pts.length];
    const n1 = [p[1] - a[1], a[0] - p[0]], n2 = [b[1] - p[1], p[0] - b[0]], l1 = Math.hypot(...n1) || 1, l2 = Math.hypot(...n2) || 1;
    let nx = n1[0] / l1 + n2[0] / l2, ny = n1[1] / l1 + n2[1] / l2; const l = Math.hypot(nx, ny) || 1;
    const area = pts.reduce((s, q, k) => s + q[0] * pts[(k + 1) % pts.length][1] - pts[(k + 1) % pts.length][0] * q[1], 0);
    const sg = area > 0 ? -1 : 1; return [p[0] + sg * nx / l * d, p[1] + sg * ny / l * d];
  });
  const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const roundRect = (x0, y0, x1, y1, r, n = 5) => {
    const p = [];
    for (const [cx, cy, a0] of [[x1 - r, y0 + r, -Math.PI / 2], [x1 - r, y1 - r, 0], [x0 + r, y1 - r, Math.PI / 2], [x0 + r, y0 + r, Math.PI]])
      for (let k = 0; k <= n; k++) { const a = a0 + k / n * Math.PI / 2; p.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
    return p;
  };
  const ctx = { g, M, B, S, L, zF, yG, Z, Sz, project, both, sides, grow, rect, roundRect, mirrorX };

  // windows: chrome / black surround, then the glass panes
  if (S.dlo) {
    if (S.dloChrome) sides(grow(S.dlo, 0.028), M.chrome, 0.004);
    sides(grow(S.dlo, 0.008), M.trim, 0.007);
    for (const pane of S.panes) sides(pane, M.glass, 0.011);
  }
  if (S.windshield) project('top', S.windshield, M.glass, 0.008, { sub: 4 });
  if (S.backlight) {
    if (S.backlightView === 'rear') project('rear', S.backlight, M.glass, 0.008, { sub: 4 }); else project('top', S.backlight, M.glass, 0.008, { sub: 4 });
  }
  S.details(ctx);

  /* ---------- mirrors ---------- */
  for (const sg of [1, -1]) {
    const mz = Z(S.mirror.d / L), my = yG + S.mirror.h, mx = B.xAt(S.mirror.d / L, S.mirror.h) * sg;
    const mg = new THREE.Group(); mg.position.set(mx, my, mz); g.add(mg);
    const shell = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.11, 0.1, 3, 0.04), S.mirror.mat === 'trim' ? M.trim : M.paint); shell.position.set(sg * 0.13, 0.02, -0.02); mg.add(shell);
    const glassM = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.08), M.chrome); glassM.position.set(sg * 0.13, 0.02, -0.071); glassM.rotation.y = Math.PI; mg.add(glassM);
    const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.035, 0.07), M.trim); stalk.position.set(sg * 0.03, -0.02, 0); mg.add(stalk);
    const rep = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.012, 0.02), M.tail); rep.material = M.drl; rep.position.set(sg * 0.2, -0.025, 0.02); mg.add(rep);
  }
  /* ---------- exhaust tips ---------- */
  const flames = [];
  for (const ex of S.exhausts) for (const sg of ex.both === false ? [1] : [1, -1]) {
    const z = Z(1) + 0.02, x = ex.x * sg;
    let tip;
    if (ex.shape === 'oval') { tip = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.12, 28, 1, true), ex.mat === 'black' ? M.trim : M.chrome); tip.scale.set(ex.w / 2, 1, ex.h / 2); }
    else if (ex.shape === 'trap') { tip = new THREE.Mesh(new RoundedBoxGeometry(ex.w, 0.12, ex.h, 2, 0.02), M.chrome); }
    else tip = new THREE.Mesh(new THREE.CylinderGeometry(ex.r, ex.r * 0.95, 0.12, 24, 1, true), M.chrome);
    tip.rotation.x = Math.PI / 2; tip.position.set(x, yG + ex.y, z); g.add(tip);
    const inner = new THREE.Mesh(new THREE.CircleGeometry(1, 20), M.well); inner.scale.set(ex.w ? ex.w / 2 * 0.85 : ex.r * 0.85, ex.h ? ex.h / 2 * 0.85 : ex.r * 0.85, 1); inner.position.set(x, yG + ex.y, z - 0.03); inner.rotation.y = Math.PI; g.add(inner);
    const fl = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.35, 12, 1, true), M.flame); fl.rotation.x = -Math.PI / 2; fl.position.set(x, yG + ex.y, z - 0.22); g.add(fl); flames.push(fl);
  }
  /* ---------- roof rails ---------- */
  if (S.rails) for (const sg of [1, -1]) {
    const pts = [];
    for (let k = 0; k <= 16; k++) { const d = lerp(S.rails.d0, S.rails.d1, k / 16), s = d / L; const x = S.rails.x * sg; pts.push(new THREE.Vector3(x, yG + B.yTop(s, x) + (k === 0 || k === 16 ? 0.0 : 0.045), Z(s))); }
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.016, 8), S.rails.mat === 'black' ? M.trim : M.satin); tube.scale.y = 1; g.add(tube);
  }
  /* ---------- wheels ---------- */
  const wheels = [];
  for (const w of S.wheels) {
    const holder = new THREE.Group(), spinner = new THREE.Group(); holder.add(spinner); g.add(holder);
    const sgn = Math.sign(w.x), R = S.tireR, tw = w.tw ?? S.tireW, rr = S.rimR;
    // tyre: lathe of the cross-section (bead → bulging sidewall → shoulder → tread)
    const prof = [];
    const sw = (R - rr);
    const half = tw / 2;
    const P = [[rr + 0.005, -half + 0.012], [rr + sw * 0.25, -half - 0.004], [rr + sw * 0.6, -half - 0.01], [R - 0.03, -half + 0.002], [R - 0.008, -half + 0.02], [R, -half + 0.045], [R, half - 0.045], [R - 0.008, half - 0.02], [R - 0.03, half - 0.002], [rr + sw * 0.6, half + 0.01], [rr + sw * 0.25, half + 0.004], [rr + 0.005, half - 0.012]];
    for (const [r, y] of P) prof.push(new THREE.Vector2(r, y));
    const tg = new THREE.LatheGeometry(prof, 56); tg.rotateZ(Math.PI / 2);
    spinner.add(new THREE.Mesh(tg, M.rubber));
    // rim: barrel + spoke face
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr, tw - 0.03, 40, 1, true), M.disc); barrel.rotation.z = Math.PI / 2; spinner.add(barrel);
    const face = S.rimFace(rr);
    face.translate(0, 0, 0); face.rotateY(sgn > 0 ? Math.PI / 2 : -Math.PI / 2);
    const fm = new THREE.Mesh(face, M.rim); fm.position.x = sgn * (half - 0.035); spinner.add(fm);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(rr - 0.004, 0.009, 8, 48), M.rim); lip.rotation.y = Math.PI / 2; lip.position.x = sgn * (half - 0.012); spinner.add(lip);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.02, 20), M.trim); cap.rotation.z = Math.PI / 2; cap.position.x = sgn * (half - 0.02); spinner.add(cap);
    // brake disc & caliper (do not spin)
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(rr - 0.035, rr - 0.035, 0.03, 36), M.disc); disc.rotation.z = Math.PI / 2; disc.position.x = sgn * (half - 0.11); holder.add(disc);
    const cal = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.2, 0.11, 2, 0.02), M.caliper); cal.position.set(sgn * (half - 0.085), 0.02, w.front ? -(rr - 0.075) : (rr - 0.075)); cal.rotation.x = w.front ? 0.5 : -0.5; holder.add(cal);
    wheels.push({ holder, spinner });
  }
  g.traverse(o => { if (o.isMesh && o.material !== M.flame) { o.castShadow = true; o.receiveShadow = true; } });
  return { group: g, wheels, M, flames, B };
}

// spoke faces
function spokeFace(rr, n, spoke, opts = {}) {
  const ro = rr - 0.012, rh = opts.hub ?? 0.07;
  const sh = new THREE.Shape(); sh.absarc(0, 0, ro, 0, TAU, false);
  const gap = TAU / n;
  for (let i = 0; i < n; i++) {
    const a0 = i * gap + spoke / 2, a1 = (i + 1) * gap - spoke / 2;
    if (opts.split) {          // Y-spokes: each window is split by a thin arm near the rim
      const am = (a0 + a1) / 2, sw = opts.split / 2;
      for (const [b0, b1] of [[a0, am - sw], [am + sw, a1]]) {
        const h = new THREE.Path(); h.absarc(0, 0, ro - 0.018, b0, b1, false);
        h.lineTo(Math.cos((b0 + b1) / 2) * (rh + 0.09), Math.sin((b0 + b1) / 2) * (rh + 0.09)); h.closePath(); sh.holes.push(h);
      }
      const h2 = new THREE.Path(); h2.absarc(0, 0, rh + 0.05, a0 + 0.06, a1 - 0.06, false); h2.lineTo(Math.cos(am) * (rh + 0.012), Math.sin(am) * (rh + 0.012)); h2.closePath(); sh.holes.push(h2);
    } else {
      const h = new THREE.Path(); h.absarc(0, 0, ro - 0.018, a0, a1, false);
      const inner = rh + 0.015, ai0 = a0 + spoke * (opts.taper ?? 0.6), ai1 = a1 - spoke * (opts.taper ?? 0.6);
      h.absarc(0, 0, inner, ai1, ai0, true); h.closePath(); sh.holes.push(h);
    }
  }
  for (let i = 0; i < 5; i++) { const a = i / 5 * TAU, h = new THREE.Path(); h.absarc(Math.cos(a) * 0.05, Math.sin(a) * 0.05, 0.007, 0, TAU, true); sh.holes.push(h); }
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.025, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.008, bevelSegments: 2, curveSegments: 12 });
  g.translate(0, 0, -0.012);
  return g;
}

/* ---------- the three cars (dimensions from manufacturer data) ---------- */
function roadSpec(o) {
  // derived geometry: wheel positions, ground height in body space, front bumper z
  const ff = o.frontWeight, a = o.wb * (1 - ff), b = o.wb * ff;
  const t0 = o.REST - o.mass * 9.81 / 4 / o.K;               // static suspension length
  o.yG = o.hpY - t0 - o.tireR;
  o.zF = a + o.fo; o.L = o.fo + o.wb + o.ro;
  o.wheels = [
    { name: 'FL', x: o.trackF / 2, z: a, front: true }, { name: 'FR', x: -o.trackF / 2, z: a, front: true },
    { name: 'RL', x: o.trackR / 2, z: -b, front: false }, { name: 'RR', x: -o.trackR / 2, z: -b, front: false },
  ];
  o.axles = [{ z: a, R: o.tireR, arch: o.tireR + (o.archGap ?? 0.07), xIn: o.trackF / 2 - o.tireW / 2 - 0.035 }, { z: -b, R: o.tireR, arch: o.tireR + (o.archGap ?? 0.07), xIn: o.trackR / 2 - o.tireW / 2 - 0.035 }];
  return o;
}

const ROAD_CARS = {
  supra: roadSpec({
    name: 'Toyota GR Supra', short: 'Supra', blurb: '3.0 turbo I6 · 285 kW · 500 Nm · RWD · 1,540 kg',
    mass: 1540, frontWeight: 0.5, wb: 2.47, fo: 0.95, ro: 0.959, trackF: 1.594, trackR: 1.589, hpY: 0.0,
    REST: 0.22, K: 49000, tireR: 0.33, tireW: 0.265, rimR: 0.241, H: 1.292, color: 0xb3121b, metallic: 0.35,
    rimColor: 0x2a2c2f, rimRough: 0.45, caliper: 0xc8161d,
    top: [[0, 0.33], [0.004, 0.47], [0.018, 0.56], [0.06, 0.635], [0.13, 0.69], [0.22, 0.74], [0.3, 0.785], [0.37, 0.835], [0.45, 1.06], [0.53, 1.245], [0.6, 1.292], [0.665, 1.282], [0.72, 1.2], [0.79, 1.06], [0.86, 0.995], [0.93, 0.985], [0.955, 1.005], [0.972, 0.975], [0.985, 0.925], [0.995, 0.85], [1, 0.77]],
    bot: [[0, 0.26], [0.008, 0.16], [0.05, 0.12], [0.95, 0.13], [0.975, 0.22], [0.99, 0.29], [1, 0.31]],
    belt: [[0, 0.46], [0.08, 0.6], [0.2, 0.7], [0.37, 0.805], [0.45, 0.86], [0.62, 0.905], [0.75, 0.94], [0.85, 0.95], [1, 0.86]],
    halfW: [[0, 0.6], [0.018, 0.79], [0.07, 0.885], [0.2, 0.925], [0.33, 0.9], [0.45, 0.885], [0.62, 0.905], [0.76, 0.928], [0.9, 0.9], [0.975, 0.84], [1, 0.7]],
    greenW: 0.66, cab: { ws: 0.37, bk: 0.84 },
    dlo: [[1.78, 0.875], [2.33, 1.215], [2.78, 1.24], [3.05, 1.12], [3.17, 0.97], [2.6, 0.915]],
    panes: [[[1.82, 0.885], [2.33, 1.205], [2.76, 1.228], [3.0, 1.12], [3.11, 0.975], [2.6, 0.925]]],
    windshield: [[-0.6, 1.62], [0.6, 1.62], [0.53, 2.3], [-0.53, 2.3]],
    backlight: [[-0.5, 3.03], [0.5, 3.03], [0.62, 3.6], [-0.62, 3.6]],
    mirror: { d: 1.92, h: 0.97, mat: 'paint' },
    exhausts: [{ x: 0.2, y: 0.25, r: 0.05 }],
    rimFace: rr => spokeFace(rr, 10, 0.11, { taper: 0.4 }),
    details({ project, both, sides, rect, roundRect, M }) {
      // headlights: long swept units on top of the front wings
      both('front', [[0.4, 0.655], [0.47, 0.705], [0.8, 0.735], [0.875, 0.705], [0.86, 0.655], [0.56, 0.625]], M.lens, 0.006);
      for (const x of [0.52, 0.61, 0.7]) both('front', roundRect(x, 0.655, x + 0.06, 0.69, 0.012), M.drl, 0.011, { sub: 1 });
      both('front', [[0.64, 0.5], [0.82, 0.555], [0.83, 0.54], [0.66, 0.485]], M.drl, 0.008, { sub: 2 });
      // big centre intake + outer vertical intakes, splitter
      project('front', [[-0.3, 0.45], [0.3, 0.45], [0.47, 0.34], [0.41, 0.2], [-0.41, 0.2], [-0.47, 0.34]], M.grille, 0.007);
      both('front', [[0.6, 0.22], [0.78, 0.24], [0.81, 0.46], [0.7, 0.48], [0.6, 0.36]], M.grille, 0.007);
      project('front', rect(-0.78, 0.15, 0.78, 0.18), M.trim, 0.009, { sub: 3 });
      project('front', [[-0.06, 0.5], [0.06, 0.5], [0.09, 0.6], [-0.09, 0.6]], M.trim, 0.008);
      // tail lights, diffuser, plate
      both('rear', [[0.33, 0.865], [0.79, 0.885], [0.875, 0.85], [0.85, 0.8], [0.46, 0.81]], M.tail, 0.006);
      both('rear', rect(0.6, 0.83, 0.7, 0.845), M.rev, 0.01, { sub: 1 });
      project('rear', [[-0.62, 0.14], [0.62, 0.14], [0.66, 0.34], [-0.66, 0.34]], M.plastic, 0.007);
      project('rear', rect(-0.05, 0.2, 0.05, 0.3), M.tail, 0.011, { sub: 1 });
      project('rear', rect(-0.26, 0.48, 0.26, 0.6), M.plate, 0.008, { sub: 2 });
      project('rear', rect(-0.85, 0.955, 0.85, 0.975), M.trim, 0.008);      // ducktail lip
      // door shut lines and side vents
      sides([[1.74, 0.24], [1.752, 0.24], [1.752, 0.87], [1.74, 0.87]], M.trim, 0.004, { sub: 2 });
      sides([[2.94, 0.3], [2.952, 0.3], [2.952, 0.915], [2.94, 0.915]], M.trim, 0.004, { sub: 2 });
      sides([[1.36, 0.56], [1.55, 0.6], [1.55, 0.64], [1.38, 0.62]], M.grille, 0.006);
      sides([[1.85, 0.22], [2.95, 0.22], [2.95, 0.26], [1.85, 0.26]], M.trim, 0.005);
    },
    engine: { idle: 750, limiter: 7000, curve: [[700, 280], [1600, 470], [1800, 500], [5000, 500], [6000, 460], [6500, 420], [7100, 350]], gears: [5.25, 3.36, 2.17, 1.72, 1.31, 1.0, 0.82, 0.64], fd: 3.15, rev: 3.71, eff: 0.9, stall: 2300, upLo: 2100, upHi: 6600, upGround: 0, dnLo: 1250, dnHi: 3300 },
    cda: 0.6, brake: 3600, steerLock: 0.56, awd: false, awdFixed: true,
    pressures: [{ psi: 18, kpa: 124, w: 0.29, defl: 0.03 }, { psi: 26, kpa: 180, w: 0.27, defl: 0.016 }, { psi: 36, kpa: 248, w: 0.255, defl: 0.007 }],
    sound: 'i6', cam: { back: 6.2, up: 2.2, hood: [0, 0.98, 0.35] },
  }),
  x7: roadSpec({
    name: 'BMW X7 M60i', short: 'X7', blurb: '4.4 twin-turbo V8 · 390 kW · 750 Nm · AWD · 2,600 kg',
    split: 0.4,                                                         // the front's share of the drive (40/60)
    mass: 2600, frontWeight: 0.49, wb: 3.105, fo: 0.93, ro: 1.146, trackF: 1.686, trackR: 1.698, hpY: -0.15,
    REST: 0.26, K: 50000, tireR: 0.39, tireW: 0.285, rimR: 0.279, H: 1.835, color: 0x1d2a4d, metallic: 0.7,
    rimColor: 0xb8bcc2, rimRough: 0.2, caliper: 0x1d4fd6,
    top: [[0, 0.52], [0.004, 0.8], [0.016, 0.96], [0.045, 1.05], [0.1, 1.1], [0.2, 1.135], [0.27, 1.165], [0.33, 1.45], [0.4, 1.72], [0.52, 1.77], [0.75, 1.765], [0.9, 1.735], [0.925, 1.71], [0.945, 1.5], [0.965, 1.25], [0.985, 1.1], [0.995, 1.02], [1, 0.93]],
    bot: [[0, 0.44], [0.012, 0.32], [0.06, 0.24], [0.9, 0.25], [0.95, 0.3], [0.975, 0.41], [0.99, 0.45], [1, 0.47]],
    belt: [[0, 0.9], [0.15, 1.06], [0.27, 1.14], [0.35, 1.16], [0.6, 1.185], [0.9, 1.21], [1, 1.02]],
    halfW: [[0, 0.82], [0.016, 0.935], [0.05, 0.975], [0.15, 0.995], [0.5, 0.99], [0.85, 0.99], [0.95, 0.975], [0.99, 0.91], [1, 0.84]],
    greenW: 0.84, cab: { ws: 0.27, bk: 0.97 },
    dlo: [[1.5, 1.165], [2.1, 1.64], [4.62, 1.68], [4.81, 1.5], [4.87, 1.22], [3.2, 1.19]],
    dloChrome: true,
    panes: [[[1.58, 1.18], [2.12, 1.625], [2.86, 1.645], [2.86, 1.19]], [[2.96, 1.19], [2.96, 1.648], [3.88, 1.66], [3.88, 1.2]], [[3.98, 1.205], [3.98, 1.66], [4.6, 1.665], [4.77, 1.5], [4.81, 1.23]]],
    windshield: [[-0.74, 1.42], [0.74, 1.42], [0.7, 2.06], [-0.7, 2.06]],
    backlight: [[-0.7, 1.62], [0.7, 1.62], [0.66, 1.27], [-0.66, 1.27]], backlightView: 'rear',
    mirror: { d: 1.72, h: 1.2, mat: 'paint' },
    rails: { d0: 2.25, d1: 4.62, x: 0.66, mat: 'satin' },
    exhausts: [{ x: 0.52, y: 0.36, shape: 'trap', w: 0.11, h: 0.07 }, { x: 0.68, y: 0.36, shape: 'trap', w: 0.11, h: 0.07 }],
    rimFace: rr => spokeFace(rr, 7, 0.085, { split: 0.05, hub: 0.075 }),
    details({ project, both, sides, rect, roundRect, grow, M }) {
      // kidney grille: chrome surround, dark slats, illuminated contour
      const kid = [[0.035, 0.58], [0.4, 0.56], [0.42, 0.62], [0.4, 1.0], [0.36, 1.03], [0.06, 1.03], [0.035, 1.0]];
      both('front', grow(kid, 0.03), M.chrome, 0.006);
      both('front', kid, M.trim, 0.009);
      both('front', grow(kid, 0.012), M.drl, 0.0075, { sub: 2 });
      for (let x = 0.07; x < 0.39; x += 0.045) both('front', rect(x, 0.6, x + 0.012, 1.0), M.chrome, 0.012, { sub: 2 });
      // slim LED strips on top, main lights in the dark band below
      both('front', [[0.47, 0.98], [0.86, 1.0], [0.93, 0.975], [0.92, 0.955], [0.86, 0.975], [0.48, 0.955]], M.drl, 0.008);
      both('front', [[0.5, 0.72], [0.88, 0.74], [0.92, 0.84], [0.52, 0.83]], M.trim, 0.007);
      for (const x of [0.6, 0.71, 0.82]) both('front', roundRect(x, 0.75, x + 0.07, 0.81, 0.02), M.lens, 0.011, { sub: 1 });
      // lower bumper intakes
      both('front', [[0.62, 0.36], [0.92, 0.42], [0.9, 0.62], [0.66, 0.6]], M.grille, 0.007);
      project('front', [[-0.48, 0.32], [0.48, 0.32], [0.5, 0.46], [-0.5, 0.46]], M.grille, 0.007);
      project('front', rect(-0.3, 0.47, 0.3, 0.55), M.plate, 0.008, { sub: 2 });
      // tail lights joined by a chrome bar, rear bumper
      both('rear', [[0.42, 1.2], [0.94, 1.22], [0.97, 1.15], [0.93, 1.08], [0.47, 1.08]], M.tail, 0.006);
      project('rear', rect(-0.42, 1.12, 0.42, 1.14), M.chrome, 0.008, { sub: 2 });
      project('rear', rect(-0.28, 0.82, 0.28, 0.94), M.plate, 0.008, { sub: 2 });
      project('rear', [[-0.82, 0.27], [0.82, 0.27], [0.86, 0.46], [-0.86, 0.46]], M.trim, 0.007);
      both('rear', rect(0.6, 1.1, 0.7, 1.12), M.rev, 0.011, { sub: 1 });
      // door shut lines, handles, side air breather, chrome sill
      for (const d of [1.55, 2.9, 3.92]) sides([[d, 0.35], [d + 0.012, 0.35], [d + 0.012, 1.17], [d, 1.17]], M.trim, 0.004, { sub: 2 });
      for (const d of [2.55, 3.6]) sides(roundRect(d, 1.06, d + 0.2, 1.1, 0.015), M.chrome, 0.008, { sub: 1 });
      sides([[1.3, 0.78], [1.47, 0.8], [1.47, 0.84], [1.3, 0.82]], M.chrome, 0.006, { sub: 2 });
      sides([[1.55, 0.33], [3.95, 0.33], [3.95, 0.37], [1.55, 0.37]], M.chrome, 0.005);
    },
    engine: { idle: 650, limiter: 6800, curve: [[600, 420], [1500, 700], [1800, 750], [4600, 750], [5500, 680], [6000, 620], [6900, 500]], gears: [5.0, 3.2, 2.143, 1.72, 1.314, 1.0, 0.822, 0.64], fd: 3.385, rev: 3.46, eff: 0.88, stall: 2100, upLo: 1900, upHi: 6400, upGround: 0, dnLo: 1150, dnHi: 3200 },
    cda: 0.98, brake: 5200, steerLock: 0.52, awd: true, awdFixed: true,
    pressures: [{ psi: 20, kpa: 138, w: 0.31, defl: 0.032 }, { psi: 29, kpa: 200, w: 0.295, defl: 0.018 }, { psi: 38, kpa: 262, w: 0.285, defl: 0.008 }],
    sound: 'v8lux', cam: { back: 8.4, up: 3.0, hood: [0, 1.42, 0.5] },
  }),
  rs6: roadSpec({
    name: 'Audi RS 6 Avant', short: 'RS 6', blurb: '4.0 twin-turbo V8 · 441 kW · 800 Nm · quattro · 2,075 kg',
    mass: 2075, frontWeight: 0.57, wb: 2.928, fo: 0.98, ro: 1.087, trackF: 1.668, trackR: 1.651, hpY: -0.03,
    REST: 0.22, K: 52500, tireR: 0.365, tireW: 0.285, rimR: 0.279, H: 1.46, color: 0x5d6265, metallic: 0.05, paintRough: 0.42,
    rimColor: 0x3a3d41, rimRough: 0.3, caliper: 0xc1121c, grilleMesh: '#2a2c30',
    top: [[0, 0.42], [0.004, 0.63], [0.02, 0.735], [0.06, 0.785], [0.12, 0.815], [0.25, 0.885], [0.31, 0.915], [0.38, 1.16], [0.46, 1.395], [0.56, 1.45], [0.75, 1.43], [0.88, 1.38], [0.93, 1.33], [0.945, 1.24], [0.962, 1.08], [0.985, 1.0], [0.995, 0.94], [1, 0.86]],
    bot: [[0, 0.32], [0.01, 0.18], [0.05, 0.13], [0.92, 0.15], [0.96, 0.24], [0.985, 0.33], [1, 0.36]],
    belt: [[0, 0.64], [0.2, 0.84], [0.31, 0.9], [0.5, 0.96], [0.8, 0.995], [0.93, 1.0], [1, 0.9]],
    halfW: [[0, 0.8], [0.02, 0.915], [0.07, 0.96], [0.2, 0.975], [0.45, 0.952], [0.7, 0.975], [0.85, 0.962], [0.97, 0.915], [1, 0.84]],
    greenW: 0.77, cab: { ws: 0.31, bk: 0.965 },
    dlo: [[1.66, 0.93], [2.3, 1.355], [4.45, 1.37], [4.64, 1.18], [4.62, 1.03], [3.1, 0.97]],
    panes: [[[1.73, 0.945], [2.32, 1.34], [2.92, 1.35], [2.92, 0.965]], [[3.02, 0.966], [3.02, 1.352], [3.86, 1.36], [3.86, 0.99]], [[3.95, 0.993], [3.95, 1.36], [4.43, 1.36], [4.58, 1.18], [4.57, 1.04]]],
    windshield: [[-0.72, 1.6], [0.72, 1.6], [0.66, 2.28], [-0.66, 2.28]],
    backlight: [[-0.62, 1.3], [0.62, 1.3], [0.6, 1.06], [-0.6, 1.06]], backlightView: 'rear',
    mirror: { d: 1.86, h: 0.99, mat: 'paint' },
    rails: { d0: 2.45, d1: 4.42, x: 0.62, mat: 'black' },
    exhausts: [{ x: 0.66, y: 0.3, shape: 'oval', w: 0.17, h: 0.095, mat: 'black' }],
    rimFace: rr => spokeFace(rr, 5, 0.16, { split: 0.06, hub: 0.075 }),
    details({ project, both, sides, rect, roundRect, grow, M }) {
      // singleframe grille, gloss black frame + honeycomb
      const sf = [[-0.42, 0.72], [0.42, 0.72], [0.5, 0.56], [0.42, 0.25], [-0.42, 0.25], [-0.5, 0.56]];
      project('front', grow(sf, 0.025), M.trim, 0.006);
      project('front', sf, M.grille, 0.009, { uvk: 9 });
      // matrix LED headlights with the light blade below
      both('front', [[0.44, 0.745], [0.86, 0.8], [0.93, 0.745], [0.9, 0.685], [0.52, 0.675]], M.lens, 0.006);
      for (let i = 0; i < 5; i++) { const x = 0.56 + i * 0.065; both('front', rect(x, 0.69, x + 0.045, 0.7), M.drl, 0.011, { sub: 1 }); }
      both('front', [[0.6, 0.755], [0.86, 0.79], [0.87, 0.775], [0.61, 0.742]], M.drl, 0.011, { sub: 1 });
      // big side intakes, lip
      both('front', [[0.56, 0.24], [0.9, 0.3], [0.93, 0.56], [0.64, 0.6], [0.55, 0.46]], M.grille, 0.007, { uvk: 9 });
      project('front', rect(-0.85, 0.15, 0.85, 0.2), M.trim, 0.009, { sub: 3 });
      project('front', rect(-0.26, 0.29, 0.26, 0.4), M.plate, 0.011, { sub: 2 });
      // tail lights, diffuser
      both('rear', [[0.38, 1.0], [0.9, 1.02], [0.955, 0.95], [0.92, 0.9], [0.42, 0.9]], M.tail, 0.006);
      both('rear', rect(0.46, 0.94, 0.8, 0.952), M.drl, 0.01, { sub: 1 });
      project('rear', [[-0.88, 0.16], [0.88, 0.16], [0.9, 0.42], [-0.9, 0.42]], M.trim, 0.007);
      project('rear', rect(-0.26, 0.62, 0.26, 0.73), M.plate, 0.008, { sub: 2 });
      both('rear', rect(0.5, 0.91, 0.6, 0.925), M.rev, 0.011, { sub: 1 });
      // shut lines, handles, black side blades
      for (const d of [1.7, 2.97, 3.92]) sides([[d, 0.28], [d + 0.012, 0.28], [d + 0.012, 0.95], [d, 0.95]], M.trim, 0.004, { sub: 2 });
      for (const d of [2.62, 3.62]) sides(roundRect(d, 0.86, d + 0.19, 0.9, 0.015), M.paint, 0.008, { sub: 1 });
      sides([[1.72, 0.26], [3.9, 0.26], [3.9, 0.31], [1.72, 0.31]], M.trim, 0.005);
    },
    engine: { idle: 680, limiter: 6800, curve: [[600, 450], [1500, 700], [2050, 800], [4500, 800], [6000, 700], [6250, 675], [6900, 560]], gears: [4.71, 3.14, 2.11, 1.67, 1.29, 1.0, 0.84, 0.67], fd: 3.204, rev: 3.32, eff: 0.88, stall: 2200, upLo: 2000, upHi: 6500, upGround: 0, dnLo: 1200, dnHi: 3400 },
    cda: 0.76, brake: 4800, steerLock: 0.55, awd: true, awdFixed: true,
    pressures: [{ psi: 20, kpa: 138, w: 0.31, defl: 0.03 }, { psi: 29, kpa: 200, w: 0.295, defl: 0.017 }, { psi: 38, kpa: 262, w: 0.285, defl: 0.007 }],
    sound: 'v8rs', cam: { back: 7.6, up: 2.6, hood: [0, 1.08, 0.5] },
  }),  bmw7: roadSpec({
    name: 'BMW 760i xDrive', short: '7 Series', blurb: '4.4 twin-turbo V8 · 400 kW · 750 Nm · xDrive · 2,345 kg',
    mass: 2345, frontWeight: 0.5, wb: 3.215, fo: 0.95, ro: 1.226, trackF: 1.714, trackR: 1.736, hpY: -0.06,
    REST: 0.22, K: 52000, tireR: 0.368, tireW: 0.27, rimR: 0.254, H: 1.544, color: 0x14181e, metallic: 0.75, Iw: 1.9,
    rimColor: 0xc4c8cc, rimRough: 0.18, caliper: 0x1d4fd6,
    top: [[0, 0.5], [0.004, 0.78], [0.015, 0.92], [0.04, 0.99], [0.1, 1.02], [0.2, 1.05], [0.29, 1.08], [0.35, 1.28], [0.42, 1.48], [0.5, 1.544], [0.62, 1.54], [0.7, 1.49], [0.78, 1.3], [0.84, 1.13], [0.9, 1.095], [0.95, 1.085], [0.975, 1.06], [0.99, 0.98], [1, 0.88]],
    bot: [[0, 0.4], [0.012, 0.26], [0.05, 0.16], [0.93, 0.17], [0.965, 0.26], [0.99, 0.36], [1, 0.4]],
    belt: [[0, 0.82], [0.15, 0.98], [0.29, 1.04], [0.5, 1.06], [0.8, 1.08], [0.93, 1.06], [1, 0.92]],
    halfW: [[0, 0.8], [0.016, 0.92], [0.05, 0.96], [0.15, 0.975], [0.5, 0.962], [0.8, 0.975], [0.95, 0.95], [0.99, 0.88], [1, 0.8]],
    greenW: 0.78, cab: { ws: 0.29, bk: 0.84 },
    dlo: [[1.72, 1.06], [2.3, 1.45], [3.85, 1.48], [4.32, 1.2], [4.42, 1.09], [3.0, 1.07]],
    dloChrome: true,
    panes: [[[1.8, 1.075], [2.33, 1.435], [3.0, 1.455], [3.0, 1.075]], [[3.1, 1.075], [3.1, 1.46], [3.8, 1.47], [4.05, 1.32], [4.05, 1.08]], [[4.14, 1.085], [4.14, 1.27], [4.33, 1.12], [4.35, 1.09]]],
    windshield: [[-0.74, 1.62], [0.74, 1.62], [0.66, 2.32], [-0.66, 2.32]],
    backlight: [[-0.62, 3.88], [0.62, 3.88], [0.7, 4.5], [-0.7, 4.5]],
    mirror: { d: 1.86, h: 1.08, mat: 'paint' },
    exhausts: [{ x: 0.56, y: 0.27, shape: 'trap', w: 0.13, h: 0.05 }],
    rimFace: rr => spokeFace(rr, 10, 0.075, { taper: 0.35 }),
    details({ project, both, sides, rect, roundRect, grow, M }) {
      // tall illuminated kidney grille
      const kid = [[0.03, 0.46], [0.36, 0.44], [0.4, 0.5], [0.38, 0.96], [0.34, 0.99], [0.05, 0.99], [0.03, 0.96]];
      both('front', grow(kid, 0.028), M.chrome, 0.006);
      both('front', kid, M.trim, 0.009);
      both('front', grow(kid, 0.011), M.drl, 0.0075, { sub: 2 });
      for (let x = 0.065; x < 0.37; x += 0.05) both('front', rect(x, 0.48, x + 0.014, 0.96), M.chrome, 0.012, { sub: 2 });
      // split lights: slim daytime strip on top, main lamps low in the bumper
      both('front', [[0.45, 0.93], [0.86, 0.955], [0.92, 0.925], [0.87, 0.905], [0.46, 0.9]], M.drl, 0.008);
      both('front', [[0.55, 0.56], [0.88, 0.58], [0.9, 0.71], [0.57, 0.7]], M.trim, 0.007);
      for (const x of [0.62, 0.74]) both('front', roundRect(x, 0.6, x + 0.09, 0.67, 0.02), M.lens, 0.011, { sub: 1 });
      project('front', [[-0.5, 0.2], [0.5, 0.2], [0.55, 0.36], [-0.55, 0.36]], M.grille, 0.007);
      project('front', rect(-0.3, 0.37, 0.3, 0.44), M.plate, 0.008, { sub: 2 });
      // thin tail lights joined by chrome, plate, diffuser
      both('rear', [[0.42, 1.03], [0.93, 1.04], [0.955, 0.98], [0.9, 0.94], [0.47, 0.95]], M.tail, 0.006);
      project('rear', rect(-0.42, 0.985, 0.42, 1.0), M.chrome, 0.008, { sub: 2 });
      both('rear', rect(0.55, 0.96, 0.66, 0.975), M.rev, 0.011, { sub: 1 });
      project('rear', rect(-0.28, 0.7, 0.28, 0.82), M.plate, 0.008, { sub: 2 });
      project('rear', [[-0.85, 0.17], [0.85, 0.17], [0.88, 0.34], [-0.88, 0.34]], M.trim, 0.007);
      // shut lines, flush handles, chrome sill
      for (const d of [1.68, 3.05, 4.1]) sides([[d, 0.3], [d + 0.012, 0.3], [d + 0.012, 1.06], [d, 1.06]], M.trim, 0.004, { sub: 2 });
      for (const d of [2.7, 3.7]) sides(roundRect(d, 0.98, d + 0.2, 1.01, 0.012), M.chrome, 0.008, { sub: 1 });
      sides([[1.7, 0.3], [4.1, 0.3], [4.1, 0.335], [1.7, 0.335]], M.chrome, 0.005);
    },
    engine: { idle: 620, limiter: 6800, curve: [[600, 420], [1500, 690], [1800, 750], [5000, 750], [5500, 695], [6000, 630], [6900, 520]], gears: [5.25, 3.36, 2.17, 1.72, 1.31, 1.0, 0.82, 0.64], fd: 2.81, rev: 3.71, eff: 0.88, stall: 2100, upLo: 1900, upHi: 6400, upGround: 0, dnLo: 1150, dnHi: 3200 },
    cda: 0.62, brake: 5000, steerLock: 0.52, awd: true, awdFixed: true,
    pressures: [{ psi: 20, kpa: 138, w: 0.29, defl: 0.03 }, { psi: 30, kpa: 207, w: 0.275, defl: 0.016 }, { psi: 38, kpa: 262, w: 0.265, defl: 0.007 }],
    sound: 'v8lux', cam: { back: 7.9, up: 2.6, hood: [0, 1.12, 0.5] },
  }),
  navigator: roadSpec({
    name: 'Lincoln Navigator', short: 'Navigator', blurb: '3.5 twin-turbo V6 · 328 kW · 692 Nm · 4x4 · 2,690 kg',
    mass: 2690, frontWeight: 0.52, wb: 3.112, fo: 0.97, ro: 1.252, trackF: 1.73, trackR: 1.722, hpY: -0.2,
    REST: 0.3, K: 52000, tireR: 0.417, tireW: 0.275, rimR: 0.279, H: 1.981, color: 0xdedbd3, metallic: 0.3, Iw: 2.5,
    rimColor: 0xd0d3d6, rimRough: 0.12, caliper: 0x3a3d42, grilleMesh: '#c9ccd0', archGap: 0.09,
    top: [[0, 0.62], [0.004, 0.95], [0.015, 1.12], [0.04, 1.2], [0.12, 1.25], [0.22, 1.29], [0.27, 1.32], [0.33, 1.62], [0.38, 1.88], [0.45, 1.94], [0.8, 1.94], [0.95, 1.92], [0.975, 1.86], [0.985, 1.6], [0.993, 1.3], [1, 1.15]],
    bot: [[0, 0.5], [0.012, 0.38], [0.06, 0.32], [0.9, 0.32], [0.95, 0.38], [0.98, 0.48], [1, 0.55]],
    belt: [[0, 1.1], [0.15, 1.22], [0.27, 1.3], [0.4, 1.32], [0.9, 1.34], [1, 1.22]],
    halfW: [[0, 0.9], [0.015, 0.98], [0.05, 1.005], [0.15, 1.016], [0.85, 1.016], [0.97, 1.0], [1, 0.94]],
    greenW: 0.86, cab: { ws: 0.27, bk: 0.985 },
    dlo: [[1.55, 1.31], [2.0, 1.85], [5.0, 1.86], [5.16, 1.7], [5.2, 1.36], [3.3, 1.33]],
    dloChrome: true,
    panes: [[[1.62, 1.32], [2.03, 1.83], [2.85, 1.84], [2.85, 1.33]], [[2.95, 1.33], [2.95, 1.845], [3.95, 1.85], [3.95, 1.34]], [[4.05, 1.34], [4.05, 1.85], [4.98, 1.85], [5.13, 1.7], [5.15, 1.36]]],
    windshield: [[-0.8, 1.44], [0.8, 1.44], [0.76, 2.0], [-0.76, 2.0]],
    backlight: [[-0.78, 1.84], [0.78, 1.84], [0.76, 1.42], [-0.76, 1.42]], backlightView: 'rear',
    mirror: { d: 1.72, h: 1.4, mat: 'paint' },
    rails: { d0: 2.2, d1: 4.9, x: 0.72, mat: 'satin' },
    exhausts: [{ x: 0.64, y: 0.44, shape: 'trap', w: 0.15, h: 0.08 }],
    rimFace: rr => spokeFace(rr, 6, 0.1, { split: 0.05, hub: 0.08 }),
    details({ project, both, sides, rect, roundRect, grow, M }) {
      // big chrome-framed mesh grille, slim headlamps joined by a light bar
      const gr = [[-0.6, 0.66], [0.6, 0.66], [0.64, 0.72], [0.64, 1.1], [0.6, 1.13], [-0.6, 1.13], [-0.64, 1.1], [-0.64, 0.72]];
      project('front', grow(gr, 0.035), M.chrome, 0.006);
      project('front', gr, M.grille, 0.009, { uvk: 7 });
      both('front', [[0.68, 1.1], [0.97, 1.13], [0.99, 1.04], [0.94, 1.0], [0.69, 1.02]], M.lens, 0.006);
      for (let i = 0; i < 4; i++) { const x = 0.72 + i * 0.06; both('front', rect(x, 1.04, x + 0.04, 1.07), M.drl, 0.011, { sub: 1 }); }
      project('front', rect(-0.97, 1.155, 0.97, 1.17), M.drl, 0.009, { sub: 2 });
      project('front', [[-0.7, 0.38], [0.7, 0.38], [0.74, 0.56], [-0.74, 0.56]], M.grille, 0.007);
      project('front', rect(-0.3, 0.58, 0.3, 0.65), M.plate, 0.008, { sub: 2 });
      both('front', rect(0.78, 0.42, 0.94, 0.46), M.drl, 0.008, { sub: 1 });
      // full-width tail light bar, tall tail lamps, chrome strip, plate
      project('rear', rect(-0.95, 1.33, 0.95, 1.37), M.tail, 0.008, { sub: 1 });
      both('rear', [[0.82, 1.37], [0.98, 1.37], [0.99, 1.0], [0.86, 0.98]], M.tail, 0.006);
      both('rear', rect(0.88, 1.08, 0.95, 1.12), M.rev, 0.011, { sub: 1 });
      project('rear', rect(-0.6, 1.0, 0.6, 1.02), M.chrome, 0.008, { sub: 2 });
      project('rear', rect(-0.28, 1.08, 0.28, 1.2), M.plate, 0.008, { sub: 2 });
      project('rear', [[-0.92, 0.36], [0.92, 0.36], [0.95, 0.6], [-0.95, 0.6]], M.plastic, 0.007);
      // shut lines, chrome handles and lower trim, running boards
      for (const d of [1.6, 2.9, 4.0]) sides([[d, 0.42], [d + 0.012, 0.42], [d + 0.012, 1.33], [d, 1.33]], M.trim, 0.004, { sub: 2 });
      for (const d of [2.55, 3.65]) sides(roundRect(d, 1.2, d + 0.22, 1.24, 0.015), M.chrome, 0.008, { sub: 1 });
      sides([[1.6, 0.5], [4.05, 0.5], [4.05, 0.55], [1.6, 0.55]], M.chrome, 0.005);
      sides([[1.65, 0.36], [4.0, 0.36], [4.0, 0.42], [1.65, 0.42]], M.trim, 0.03, { sub: 1 });
    },
    engine: { idle: 600, limiter: 6300, curve: [[600, 400], [1500, 600], [2250, 670], [3000, 692], [4250, 670], [5000, 600], [5850, 535], [6400, 470]], gears: [4.70, 2.98, 2.15, 1.77, 1.52, 1.27, 1.0, 0.85, 0.69, 0.64], fd: 3.73, rev: 4.87, eff: 0.86, stall: 2000, upLo: 1800, upHi: 5900, upGround: 0, dnLo: 1100, dnHi: 3000 },
    cda: 1.3, brake: 5400, steerLock: 0.5, awd: true, awdFixed: true,
    pressures: [{ psi: 22, kpa: 152, w: 0.3, defl: 0.035 }, { psi: 30, kpa: 207, w: 0.285, defl: 0.02 }, { psi: 38, kpa: 262, w: 0.275, defl: 0.01 }],
    sound: 'v6tt', cam: { back: 8.8, up: 3.2, hood: [0, 1.5, 0.5] },
  }),
  cayenne: roadSpec({
    name: 'Porsche Cayenne S', short: 'Cayenne', blurb: '4.0 twin-turbo V8 · 349 kW · 600 Nm · AWD · 2,160 kg',
    mass: 2160, frontWeight: 0.55, wb: 2.895, fo: 0.98, ro: 1.055, trackF: 1.676, trackR: 1.653, hpY: -0.1,
    REST: 0.24, K: 52000, tireR: 0.39, tireW: 0.28, rimR: 0.254, H: 1.697, color: 0x2c4f46, metallic: 0.6, Iw: 2.0,
    rimColor: 0x8c9196, rimRough: 0.22, caliper: 0xc1121c,
    top: [[0, 0.52], [0.004, 0.78], [0.018, 0.9], [0.05, 0.96], [0.12, 1.0], [0.22, 1.06], [0.3, 1.1], [0.37, 1.36], [0.45, 1.62], [0.55, 1.69], [0.72, 1.68], [0.85, 1.6], [0.92, 1.48], [0.955, 1.3], [0.975, 1.15], [0.99, 1.06], [1, 0.95]],
    bot: [[0, 0.38], [0.012, 0.26], [0.06, 0.21], [0.92, 0.22], [0.96, 0.3], [0.985, 0.4], [1, 0.44]],
    belt: [[0, 0.84], [0.15, 0.98], [0.3, 1.08], [0.5, 1.12], [0.8, 1.14], [0.92, 1.12], [1, 0.98]],
    halfW: [[0, 0.82], [0.018, 0.94], [0.06, 0.98], [0.16, 0.99], [0.45, 0.965], [0.75, 0.99], [0.9, 0.975], [0.98, 0.92], [1, 0.84]],
    greenW: 0.76, cab: { ws: 0.3, bk: 0.94 }, fenderRise: 0.03,
    dlo: [[1.6, 1.09], [2.2, 1.58], [3.9, 1.62], [4.35, 1.4], [4.45, 1.16], [3.2, 1.12]],
    panes: [[[1.67, 1.1], [2.22, 1.56], [2.82, 1.58], [2.82, 1.11]], [[2.92, 1.11], [2.92, 1.585], [3.75, 1.6], [3.75, 1.13]], [[3.84, 1.13], [3.84, 1.6], [3.9, 1.6], [4.32, 1.4], [4.38, 1.16]]],
    windshield: [[-0.72, 1.6], [0.72, 1.6], [0.66, 2.25], [-0.66, 2.25]],
    backlight: [[-0.6, 1.55], [0.6, 1.55], [0.64, 1.22], [-0.64, 1.22]], backlightView: 'rear',
    mirror: { d: 1.72, h: 1.14, mat: 'paint' },
    exhausts: [{ x: 0.5, y: 0.3, r: 0.045 }, { x: 0.62, y: 0.3, r: 0.045 }],
    rimFace: rr => spokeFace(rr, 5, 0.15, { split: 0.06, hub: 0.07 }),
    details({ project, both, sides, rect, roundRect, grow, M }) {
      // four-point LED headlights on the raised wings
      both('front', [[0.5, 0.86], [0.66, 0.925], [0.86, 0.905], [0.93, 0.83], [0.84, 0.775], [0.57, 0.78]], M.lens, 0.006);
      for (const [x, y] of [[0.62, 0.86], [0.7, 0.86], [0.62, 0.81], [0.7, 0.81]]) both('front', roundRect(x, y, x + 0.055, y + 0.035, 0.008), M.drl, 0.011, { sub: 1 });
      // three big intakes, no grille above the bumper
      project('front', [[-0.42, 0.3], [0.42, 0.3], [0.46, 0.56], [-0.46, 0.56]], M.grille, 0.007);
      both('front', [[0.55, 0.28], [0.92, 0.34], [0.93, 0.62], [0.62, 0.62], [0.52, 0.48]], M.grille, 0.007);
      both('front', rect(0.62, 0.64, 0.86, 0.66), M.drl, 0.009, { sub: 1 });
      project('front', rect(-0.85, 0.2, 0.85, 0.24), M.trim, 0.009, { sub: 3 });
      project('front', rect(-0.26, 0.57, 0.26, 0.65), M.plate, 0.008, { sub: 2 });
      // full-width light strip, tail lamps, plate, diffuser
      project('rear', rect(-0.9, 1.135, 0.9, 1.15), M.tail, 0.008, { sub: 1 });
      both('rear', [[0.5, 1.16], [0.92, 1.16], [0.96, 1.08], [0.9, 1.04], [0.55, 1.07]], M.tail, 0.006);
      both('rear', rect(0.66, 1.08, 0.78, 1.095), M.rev, 0.011, { sub: 1 });
      project('rear', rect(-0.28, 0.66, 0.28, 0.78), M.plate, 0.008, { sub: 2 });
      project('rear', [[-0.86, 0.22], [0.86, 0.22], [0.9, 0.42], [-0.9, 0.42]], M.trim, 0.007);
      // shut lines, handles, black lower side trim
      for (const d of [1.62, 2.87, 3.8]) sides([[d, 0.3], [d + 0.012, 0.3], [d + 0.012, 1.12], [d, 1.12]], M.trim, 0.004, { sub: 2 });
      for (const d of [2.55, 3.5]) sides(roundRect(d, 1.02, d + 0.19, 1.06, 0.015), M.paint, 0.008, { sub: 1 });
      sides([[1.62, 0.26], [3.85, 0.26], [3.85, 0.33], [1.62, 0.33]], M.trim, 0.005);
    },
    engine: { idle: 650, limiter: 6800, curve: [[600, 350], [1500, 540], [2000, 600], [5000, 600], [6000, 555], [6500, 500], [6900, 440]], gears: [5.0, 3.2, 2.14, 1.72, 1.31, 1.0, 0.82, 0.64], fd: 3.21, rev: 3.48, eff: 0.88, stall: 2200, upLo: 2000, upHi: 6500, upGround: 0, dnLo: 1200, dnHi: 3400 },
    cda: 0.98, brake: 5000, steerLock: 0.54, awd: true, awdFixed: true,
    pressures: [{ psi: 20, kpa: 138, w: 0.305, defl: 0.032 }, { psi: 30, kpa: 207, w: 0.29, defl: 0.018 }, { psi: 38, kpa: 262, w: 0.28, defl: 0.008 }],
    sound: 'v8p', cam: { back: 7.9, up: 2.8, hood: [0, 1.2, 0.5] },
  }),
  quattroporte: roadSpec({
    name: 'Maserati Quattroporte Trofeo', short: 'Quattroporte', blurb: '3.8 twin-turbo V8 · 427 kW · 730 Nm · RWD · 2,127 kg',
    mass: 2127, frontWeight: 0.5, wb: 3.171, fo: 0.95, ro: 1.141, trackF: 1.634, trackR: 1.647, hpY: -0.04,
    REST: 0.21, K: 52000, tireR: 0.352, tireW: 0.275, rimR: 0.267, H: 1.481, color: 0x7a0d12, metallic: 0.6, Iw: 1.7,
    rimColor: 0x45484c, rimRough: 0.25, caliper: 0xc1121c,
    top: [[0, 0.46], [0.004, 0.7], [0.015, 0.82], [0.04, 0.88], [0.1, 0.92], [0.2, 0.96], [0.31, 1.0], [0.37, 1.2], [0.44, 1.42], [0.52, 1.481], [0.62, 1.47], [0.72, 1.38], [0.8, 1.2], [0.86, 1.06], [0.92, 1.03], [0.955, 1.025], [0.975, 1.0], [0.99, 0.92], [1, 0.82]],
    bot: [[0, 0.34], [0.012, 0.2], [0.05, 0.14], [0.93, 0.15], [0.965, 0.24], [0.99, 0.34], [1, 0.38]],
    belt: [[0, 0.74], [0.15, 0.9], [0.31, 0.97], [0.5, 1.0], [0.8, 1.02], [0.92, 1.0], [1, 0.86]],
    halfW: [[0, 0.78], [0.018, 0.9], [0.06, 0.95], [0.16, 0.974], [0.45, 0.95], [0.75, 0.974], [0.9, 0.955], [0.98, 0.89], [1, 0.8]],
    greenW: 0.74, cab: { ws: 0.31, bk: 0.86 }, fenderRise: 0.02,
    dlo: [[1.8, 1.0], [2.35, 1.4], [3.6, 1.43], [4.25, 1.12], [4.32, 1.03], [3.0, 1.01]],
    dloChrome: true,
    panes: [[[1.88, 1.01], [2.38, 1.39], [3.0, 1.41], [3.0, 1.015]], [[3.1, 1.015], [3.1, 1.415], [3.6, 1.42], [4.0, 1.22], [4.05, 1.02]], [[4.12, 1.025], [4.12, 1.18], [4.25, 1.1], [4.27, 1.03]]],
    windshield: [[-0.72, 1.72], [0.72, 1.72], [0.64, 2.42], [-0.64, 2.42]],
    backlight: [[-0.6, 3.68], [0.6, 3.68], [0.68, 4.45], [-0.68, 4.45]],
    mirror: { d: 1.92, h: 1.0, mat: 'paint' },
    exhausts: [{ x: 0.47, y: 0.26, r: 0.045 }, { x: 0.59, y: 0.26, r: 0.045 }],
    rimFace: rr => spokeFace(rr, 5, 0.13, { split: 0.05, hub: 0.07 }),
    details({ project, both, sides, rect, roundRect, grow, M }) {
      // concave shark-nose grille with vertical chrome bars
      const gr = [[-0.36, 0.38], [0.36, 0.38], [0.44, 0.52], [0.4, 0.7], [-0.4, 0.7], [-0.44, 0.52]];
      project('front', grow(gr, 0.025), M.chrome, 0.006);
      project('front', gr, M.trim, 0.009);
      for (let x = -0.36; x <= 0.36; x += 0.06) project('front', rect(x, 0.4, x + 0.014, 0.68), M.chrome, 0.012, { sub: 2 });
      // slim swept headlights with a light strip, side intakes
      both('front', [[0.5, 0.78], [0.88, 0.8], [0.95, 0.72], [0.9, 0.68], [0.58, 0.69]], M.lens, 0.006);
      both('front', [[0.56, 0.71], [0.88, 0.73], [0.9, 0.715], [0.57, 0.695]], M.drl, 0.011, { sub: 1 });
      for (const x of [0.66, 0.76]) both('front', roundRect(x, 0.735, x + 0.07, 0.775, 0.015), M.lens, 0.011, { sub: 1 });
      both('front', [[0.56, 0.22], [0.9, 0.28], [0.92, 0.46], [0.62, 0.48], [0.52, 0.36]], M.grille, 0.007);
      project('front', rect(-0.8, 0.16, 0.8, 0.2), M.trim, 0.009, { sub: 3 });
      project('front', rect(-0.26, 0.24, 0.26, 0.34), M.plate, 0.008, { sub: 2 });
      // boomerang tail lights, chrome strip, plate, diffuser
      both('rear', [[0.42, 1.0], [0.92, 1.01], [0.965, 0.93], [0.9, 0.88], [0.52, 0.94]], M.tail, 0.006);
      both('rear', rect(0.6, 0.94, 0.72, 0.955), M.rev, 0.011, { sub: 1 });
      project('rear', rect(-0.4, 0.86, 0.4, 0.875), M.chrome, 0.008, { sub: 2 });
      project('rear', rect(-0.28, 0.66, 0.28, 0.78), M.plate, 0.008, { sub: 2 });
      project('rear', [[-0.84, 0.16], [0.84, 0.16], [0.88, 0.36], [-0.88, 0.36]], M.trim, 0.007);
      // three vents behind the front wheel, shut lines, handles, sill
      for (let i = 0; i < 3; i++) sides(roundRect(1.22 + i * 0.1, 0.74, 1.29 + i * 0.1, 0.86, 0.02), M.chrome, 0.006, { sub: 1 });
      for (const d of [1.82, 3.05, 4.08]) sides([[d, 0.28], [d + 0.012, 0.28], [d + 0.012, 1.0], [d, 1.0]], M.trim, 0.004, { sub: 2 });
      for (const d of [2.75, 3.75]) sides(roundRect(d, 0.92, d + 0.18, 0.955, 0.012), M.chrome, 0.008, { sub: 1 });
      sides([[1.85, 0.28], [4.05, 0.28], [4.05, 0.31], [1.85, 0.31]], M.chrome, 0.005);
    },
    engine: { idle: 700, limiter: 7300, curve: [[700, 420], [1600, 620], [2250, 730], [5250, 730], [6000, 665], [6750, 604], [7300, 520]], gears: [4.71, 3.14, 2.11, 1.67, 1.29, 1.0, 0.84, 0.67], fd: 2.85, rev: 3.32, eff: 0.88, stall: 2300, upLo: 2100, upHi: 7000, upGround: 0, dnLo: 1250, dnHi: 3600 },
    cda: 0.66, brake: 4600, steerLock: 0.53, awd: false, awdFixed: true,
    pressures: [{ psi: 20, kpa: 138, w: 0.29, defl: 0.028 }, { psi: 32, kpa: 221, w: 0.275, defl: 0.015 }, { psi: 40, kpa: 276, w: 0.265, defl: 0.007 }],
    sound: 'v8m', cam: { back: 7.8, up: 2.5, hood: [0, 1.05, 0.5] },
  }),
  // ---- from the models in models/ (scripts/models/build-car.mjs measures the body's profiles off them) ----
  xjr: roadSpec({
    name: 'Jaguar XJR', short: 'XJR', blurb: '4.0 supercharged V8 · 276 kW · 525 Nm · RWD · 1,775 kg',
    mass: 1775, frontWeight: 0.53, wb: 2.894, fo: 0.919, ro: 1.209, trackF: 1.494, trackR: 1.494, hpY: -0.04,
    REST: 0.22, K: 47000, tireR: 0.335, tireW: 0.236, rimR: 0.229, H: 1.434, color: 0x0f3b26, metallic: 0.6, Iw: 1.6,
    rimColor: 0xb9bdc2, rimRough: 0.25, caliper: 0x2a2c30,
    top: [[0, 0.677], [0.05, 0.807], [0.1, 0.858], [0.15, 0.892], [0.2, 0.914], [0.25, 0.93], [0.3, 0.973], [0.35, 1.128], [0.4, 1.29], [0.45, 1.366], [0.5, 1.382], [0.55, 1.39], [0.6, 1.391], [0.65, 1.383], [0.7, 1.362], [0.75, 1.256], [0.8, 1.092], [0.85, 0.982], [0.9, 0.95], [0.95, 0.912], [1, 0.542]],
    bot: [[0, 0.341], [0.05, 0.227], [0.1, 0.216], [0.15, 0.216], [0.2, 0.216], [0.25, 0.216], [0.3, 0.217], [0.35, 0.218], [0.4, 0.219], [0.45, 0.22], [0.5, 0.221], [0.55, 0.22], [0.6, 0.219], [0.65, 0.217], [0.7, 0.216], [0.75, 0.216], [0.8, 0.232], [0.85, 0.259], [0.9, 0.285], [0.95, 0.311], [1, 0.353]],
    belt: [[0, 0.677], [0.1, 0.858], [0.2, 0.914], [0.3, 0.915], [0.4, 0.943], [0.5, 0.949], [0.6, 0.948], [0.7, 0.964], [0.8, 0.987], [0.9, 0.95], [1, 0.542]],
    halfW: [[0, 0.499], [0.05, 0.838], [0.1, 0.861], [0.15, 0.886], [0.2, 0.899], [0.25, 0.898], [0.3, 0.906], [0.35, 0.909], [0.4, 0.911], [0.45, 0.911], [0.5, 0.911], [0.55, 0.91], [0.6, 0.908], [0.65, 0.905], [0.7, 0.899], [0.75, 0.908], [0.8, 0.898], [0.85, 0.865], [0.9, 0.842], [0.95, 0.809], [1, 0.678]],
    greenW: 0.69, cab: { ws: 0.3, bk: 0.8 },
    dlo: [[1.557, 0.907], [1.582, 0.887], [3.536, 0.965], [3.979, 0.987], [3.878, 1.052], [3.498, 1.195], [2.118, 1.216]],
    panes: [[[1.557, 0.907], [1.582, 0.887], [3.536, 0.965], [3.979, 0.987], [3.878, 1.052], [3.498, 1.195], [2.118, 1.216]]],
    windshield: [[-0.602, 1.471], [0.602, 1.471], [0.643, 2.739], [-0.643, 2.739]],
    backlight: [[-0.641, 2.891], [0.641, 2.891], [0.514, 4.098], [-0.514, 4.098]],
    mirror: { d: 1.707, h: 0.999, mat: 'paint' },
    exhausts: [{ x: 0.55, y: 0.27, r: 0.04 }],
    rimFace: rr => spokeFace(rr, 5, 0.12, { split: 0.05, hub: 0.07 }),
    details({ project, both, rect, roundRect, M }) {
      // four round headlamps, a mesh grille; slim tail lamps, plate
      for (const x of [0.5, 0.66]) both('front', roundRect(x, 0.6, x + 0.13, 0.72, 0.06), M.lens, 0.006);
      project('front', [[-0.3, 0.52], [0.3, 0.52], [0.34, 0.66], [-0.34, 0.66]], M.grille, 0.007);
      project('front', rect(-0.26, 0.36, 0.26, 0.47), M.plate, 0.008, { sub: 2 });
      both('rear', [[0.45, 0.78], [0.86, 0.8], [0.88, 0.9], [0.5, 0.9]], M.tail, 0.006);
      project('rear', rect(-0.26, 0.6, 0.26, 0.72), M.plate, 0.008, { sub: 2 });
    },
    engine: { idle: 650, limiter: 6250, curve: [[650, 330], [1500, 430], [2500, 500], [3600, 525], [4500, 515], [5000, 505], [5500, 478], [6150, 429], [6300, 390]], gears: [3.59, 2.19, 1.41, 1.0, 0.83], fd: 3.06, rev: 3.16, eff: 0.86, stall: 2000, upLo: 1900, upHi: 6000, upGround: 0, dnLo: 1200, dnHi: 3200 },
    cda: 0.78, brake: 4300, steerLock: 0.54, awd: false, awdFixed: true,
    pressures: [{ psi: 20, kpa: 138, w: 0.255, defl: 0.03 }, { psi: 32, kpa: 221, w: 0.24, defl: 0.016 }, { psi: 40, kpa: 276, w: 0.232, defl: 0.008 }],
    sound: 'v8sc', cam: { back: 8.2, up: 2.6, hood: [0, 1.05, 0.5] },
  }),
  sl63: roadSpec({
    name: 'Mercedes-AMG SL 63', short: 'SL 63', blurb: '4.0 twin-turbo V8 · 430 kW · 800 Nm · 4MATIC+ · 1,970 kg',
    mass: 1970, frontWeight: 0.53, wb: 2.701, fo: 0.971, ro: 1.045, trackF: 1.611, trackR: 1.602, hpY: -0.03,
    REST: 0.2, K: 56000, tireR: 0.379, tireW: 0.267, rimR: 0.267, H: 1.403, color: 0x3a3d42, metallic: 0.6, Iw: 1.7,
    rimColor: 0x2a2c2f, rimRough: 0.3, caliper: 0xd9a21b,
    top: [[0, 0.723], [0.05, 0.831], [0.1, 0.896], [0.15, 0.937], [0.2, 0.965], [0.25, 0.98], [0.3, 0.991], [0.35, 0.973], [0.4, 0.961], [0.45, 1.113], [0.5, 1.245], [0.55, 1.396], [0.6, 1.401], [0.65, 1.393], [0.7, 1.364], [0.75, 1.312], [0.8, 1.212], [0.85, 1.084], [0.9, 1.04], [0.95, 0.98], [1, 0.823]],
    bot: [[0, 0.216], [0.05, 0.152], [0.1, 0.143], [0.3, 0.166], [0.35, 0.173], [0.4, 0.177], [0.45, 0.18], [0.5, 0.182], [0.55, 0.183], [0.6, 0.183], [0.65, 0.182], [0.9, 0.189], [0.95, 0.248], [1, 0.339]],
    belt: [[0, 0.723], [0.1, 0.896], [0.2, 0.965], [0.3, 0.966], [0.4, 0.961], [0.5, 0.984], [0.6, 1.007], [0.7, 1.033], [0.8, 1.157], [0.9, 1.04], [1, 0.823]],
    halfW: [[0, 0.279], [0.05, 0.825], [0.1, 0.941], [0.15, 0.957], [0.2, 0.957], [0.25, 0.958], [0.3, 0.943], [0.35, 0.932], [0.4, 0.93], [0.45, 0.929], [0.5, 0.929], [0.55, 0.928], [0.6, 0.926], [0.65, 0.928], [0.7, 0.949], [0.75, 0.957], [0.8, 0.957], [0.85, 0.959], [0.9, 0.907], [0.95, 0.806], [1, 0.423]],
    greenW: 0.586, cab: { ws: 0.425, bk: 0.825 },
    dlo: [[2.001, 0.966], [3.022, 1.016], [3.362, 1.039], [3.241, 1.062], [2.29, 1.109], [2.106, 1.098], [2.014, 1.033]],
    panes: [[[2.001, 0.966], [3.022, 1.016], [3.362, 1.039], [3.241, 1.062], [2.29, 1.109], [2.106, 1.098], [2.014, 1.033]]],
    windshield: [[-0.721, 2.15], [0.721, 2.15], [0.641, 2.91], [-0.641, 2.91]],
    backlight: [[-0.641, 2.951], [0.641, 2.951], [0.467, 3.928], [-0.467, 3.928]],
    mirror: { d: 2.099, h: 1.017, mat: 'paint' },
    exhausts: [{ x: 0.55, y: 0.33, r: 0.045 }, { x: 0.67, y: 0.33, r: 0.045 }],
    rimFace: rr => spokeFace(rr, 10, 0.08, { taper: 0.4 }),
    details({ project, both, rect, M }) {
      // slim headlights, the vertical-slat Panamericana grille; full-width tail lights
      both('front', [[0.5, 0.62], [0.84, 0.66], [0.9, 0.6], [0.56, 0.57]], M.lens, 0.006);
      project('front', [[-0.3, 0.36], [0.3, 0.36], [0.34, 0.64], [-0.34, 0.64]], M.grille, 0.007);
      both('rear', [[0.3, 0.8], [0.86, 0.82], [0.88, 0.88], [0.32, 0.86]], M.tail, 0.006);
      project('rear', rect(-0.26, 0.5, 0.26, 0.62), M.plate, 0.008, { sub: 2 });
    },
    engine: { idle: 750, limiter: 7000, curve: [[700, 450], [1500, 650], [2500, 800], [4500, 800], [5500, 745], [6500, 632], [7000, 540]], gears: [5.35, 3.24, 2.25, 1.64, 1.21, 1.0, 0.87, 0.72, 0.6], fd: 3.07, rev: 4.8, eff: 0.88, stall: 2400, upLo: 2200, upHi: 6800, upGround: 0, dnLo: 1300, dnHi: 3600 },
    cda: 0.64, brake: 5200, steerLock: 0.53, awd: true, awdFixed: true,
    pressures: [{ psi: 20, kpa: 138, w: 0.285, defl: 0.028 }, { psi: 33, kpa: 228, w: 0.27, defl: 0.014 }, { psi: 41, kpa: 283, w: 0.262, defl: 0.007 }],
    sound: 'v8rs', cam: { back: 7.8, up: 2.5, hood: [0, 1.05, 0.5] },
  }),
  p911: roadSpec({
    name: 'Porsche 911 Turbo', short: '911 Turbo', blurb: '3.7 twin-turbo flat-six · 427 kW · 750 Nm · AWD · 1,640 kg',
    mass: 1640, frontWeight: 0.39, wb: 2.451, fo: 1.015, ro: 1.068, trackF: 1.557, trackR: 1.57, hpY: -0.03,
    REST: 0.19, K: 54000, tireR: 0.351, tireW: 0.276, rimR: 0.27, H: 1.308, color: 0x9a9da1, metallic: 0.6, Iw: 1.5,
    rimColor: 0x2a2c2f, rimRough: 0.3, caliper: 0xb3121b,
    top: [[0, 0.548], [0.05, 0.662], [0.1, 0.758], [0.15, 0.848], [0.2, 0.868], [0.25, 0.902], [0.3, 0.921], [0.35, 1.041], [0.4, 1.148], [0.45, 1.246], [0.5, 1.296], [0.55, 1.306], [0.6, 1.294], [0.65, 1.274], [0.7, 1.232], [0.75, 1.177], [0.8, 1.114], [0.85, 1.043], [0.9, 0.97], [0.95, 0.962], [1, 0.718]],
    bot: [[0, 0.212], [0.05, 0.177], [0.1, 0.166], [0.15, 0.166], [0.2, 0.13], [0.25, 0.159], [0.3, 0.16], [0.35, 0.151], [0.4, 0.15], [0.45, 0.149], [0.5, 0.147], [0.55, 0.146], [0.6, 0.145], [0.65, 0.144], [0.7, 0.16], [0.75, 0.14], [0.8, 0.159], [0.85, 0.163], [0.9, 0.176], [0.95, 0.2], [1, 0.273]],
    belt: [[0, 0.548], [0.1, 0.758], [0.2, 0.86], [0.3, 0.86], [0.4, 1.017], [0.5, 0.869], [0.6, 0.879], [0.7, 0.937], [0.8, 1.061], [0.9, 0.97], [1, 0.718]],
    halfW: [[0, 0.391], [0.05, 0.752], [0.1, 0.889], [0.15, 0.917], [0.2, 0.919], [0.25, 0.919], [0.3, 0.913], [0.35, 0.879], [0.4, 0.906], [0.45, 0.872], [0.5, 0.867], [0.55, 0.861], [0.6, 0.871], [0.65, 0.897], [0.7, 0.949], [0.75, 0.95], [0.8, 0.95], [0.85, 0.946], [0.9, 0.88], [0.95, 0.776], [1, 0.5]],
    greenW: 0.593, cab: { ws: 0.3, bk: 0.85 },
    dlo: [[1.609, 0.87], [1.922, 0.859], [2.479, 0.873], [2.731, 0.882], [2.277, 0.953], [1.854, 0.935], [1.622, 0.881]],
    panes: [[[1.609, 0.87], [1.922, 0.859], [2.479, 0.873], [2.731, 0.882], [2.277, 0.953], [1.854, 0.935], [1.622, 0.881]]],
    windshield: [[-0.369, 1.286], [0.369, 1.286], [0.707, 2.589], [-0.707, 2.589]],
    backlight: [[-0.704, 2.608], [0.704, 2.608], [0.49, 3.891], [-0.49, 3.891]],
    mirror: { d: 1.541, h: 0.928, mat: 'paint' },
    exhausts: [{ x: 0.42, y: 0.31, r: 0.05 }],
    rimFace: rr => spokeFace(rr, 10, 0.08, { taper: 0.4 }),
    details({ project, both, rect, roundRect, M }) {
      // round headlights on the wings, a black intake; the light bar across the tail
      both('front', roundRect(0.5, 0.6, 0.72, 0.74, 0.07), M.lens, 0.006);
      project('front', [[-0.6, 0.22], [0.6, 0.22], [0.64, 0.4], [-0.64, 0.4]], M.grille, 0.007);
      project('rear', rect(-0.8, 0.82, 0.8, 0.85), M.tail, 0.008, { sub: 1 });
      project('rear', rect(-0.26, 0.46, 0.26, 0.58), M.plate, 0.008, { sub: 2 });
    },
    engine: { idle: 800, limiter: 7200, curve: [[700, 400], [1500, 600], [2250, 750], [4500, 750], [5500, 700], [6500, 627], [7200, 540]], gears: [4.89, 3.17, 2.15, 1.56, 1.18, 0.94, 0.76, 0.61], fd: 3.39, rev: 4.55, eff: 0.88, stall: 2500, upLo: 2300, upHi: 7000, upGround: 0, dnLo: 1300, dnHi: 3800 },
    cda: 0.66, brake: 5400, steerLock: 0.52, awd: true, awdFixed: true,
    pressures: [{ psi: 22, kpa: 152, w: 0.3, defl: 0.03 }, { psi: 33, kpa: 228, w: 0.285, defl: 0.016 }, { psi: 40, kpa: 276, w: 0.275, defl: 0.008 }],
    sound: 'f6tt', cam: { back: 7.6, up: 2.4, hood: [0, 1.0, 0.5] },
  }),
  cayennets: roadSpec({
    name: 'Porsche Cayenne Turbo S', short: 'Cayenne Turbo S', blurb: '4.8 twin-turbo V8 · 404 kW · 750 Nm · AWD · 2,355 kg',
    mass: 2355, frontWeight: 0.56, wb: 2.85, fo: 0.94, ro: 1.004, trackF: 1.7, trackR: 1.7, hpY: -0.1,
    REST: 0.24, K: 54000, tireR: 0.37, tireW: 0.298, rimR: 0.267, H: 1.672, color: 0x4a3a2c, metallic: 0.6, Iw: 2.1,
    rimColor: 0xb9bdc2, rimRough: 0.22, caliper: 0xd9a21b,
    top: [[0, 0.784], [0.05, 0.942], [0.1, 1.02], [0.15, 1.077], [0.2, 1.115], [0.25, 1.159], [0.3, 1.224], [0.35, 1.368], [0.4, 1.502], [0.45, 1.611], [0.5, 1.646], [0.55, 1.661], [0.6, 1.669], [0.65, 1.671], [0.7, 1.669], [0.75, 1.664], [0.8, 1.655], [0.85, 1.633], [0.9, 1.604], [0.95, 1.318], [1, 0.606]],
    bot: [[0, 0.4], [0.05, 0.257], [0.1, 0.183], [0.15, 0.183], [0.2, 0.163], [0.25, 0.12], [0.3, 0.129], [0.35, 0.167], [0.4, 0.179], [0.45, 0.179], [0.5, 0.173], [0.55, 0.169], [0.6, 0.167], [0.65, 0.164], [0.7, 0.171], [0.75, 0.159], [0.8, 0.13], [0.85, 0.167], [0.9, 0.209], [0.95, 0.268], [1, 0.39]],
    belt: [[0, 0.784], [0.1, 1.02], [0.2, 1.061], [0.3, 1.085], [0.4, 1.094], [0.5, 1.11], [0.6, 1.122], [0.7, 1.136], [0.8, 1.154], [0.9, 1.445], [1, 0.606]],
    halfW: [[0, 0.38], [0.05, 0.89], [0.1, 0.97], [0.15, 0.988], [0.2, 0.994], [0.25, 0.998], [0.3, 0.956], [0.35, 0.947], [0.4, 0.949], [0.45, 0.953], [0.5, 0.954], [0.55, 0.955], [0.6, 0.956], [0.65, 0.955], [0.7, 0.975], [0.75, 0.989], [0.8, 0.989], [0.85, 0.994], [0.9, 0.977], [0.95, 0.924], [1, 0.662]],
    greenW: 0.669, cab: { ws: 0.275, bk: 0.95 },
    dlo: [[1.427, 1.064], [3.488, 1.141], [3.976, 1.169], [4.077, 1.253], [3.522, 1.373], [2.032, 1.415], [1.601, 1.201]],
    panes: [[[1.427, 1.064], [3.488, 1.141], [3.976, 1.169], [4.077, 1.253], [3.522, 1.373], [2.032, 1.415], [1.601, 1.201]]],
    windshield: [[-0.484, 1.234], [0.484, 1.234], [0.732, 2.852], [-0.732, 2.852]],
    backlight: [[-0.723, 3.139], [0.723, 3.139], [0.558, 4.595], [-0.558, 4.595]],
    mirror: { d: 1.51, h: 1.239, mat: 'paint' },
    exhausts: [{ x: 0.5, y: 0.3, r: 0.045 }, { x: 0.62, y: 0.3, r: 0.045 }],
    rimFace: rr => spokeFace(rr, 5, 0.15, { split: 0.06, hub: 0.07 }),
    details({ project, both, rect, roundRect, M }) {
      // teardrop headlights, the wide lower intakes of the Turbo; tall tail lights at the corners
      both('front', roundRect(0.5, 0.8, 0.86, 0.98, 0.07), M.lens, 0.006);
      project('front', [[-0.62, 0.36], [0.62, 0.36], [0.66, 0.66], [-0.66, 0.66]], M.grille, 0.007);
      both('rear', rect(0.6, 0.84, 0.92, 1.04), M.tail, 0.006);
      project('rear', rect(-0.26, 0.66, 0.26, 0.78), M.plate, 0.008, { sub: 2 });
    },
    engine: { idle: 650, limiter: 6700, curve: [[600, 400], [1500, 620], [2250, 750], [4500, 750], [5500, 700], [6000, 643], [6700, 540]], gears: [4.15, 2.37, 1.56, 1.16, 0.86, 0.69], fd: 3.55, rev: 3.39, eff: 0.87, stall: 2200, upLo: 2000, upHi: 6400, upGround: 0, dnLo: 1200, dnHi: 3400 },
    cda: 1.0, brake: 5200, steerLock: 0.54, awd: true, awdFixed: true,
    pressures: [{ psi: 20, kpa: 138, w: 0.32, defl: 0.032 }, { psi: 30, kpa: 207, w: 0.305, defl: 0.018 }, { psi: 38, kpa: 262, w: 0.295, defl: 0.008 }],
    sound: 'v8p', cam: { back: 7.9, up: 2.8, hood: [0, 1.2, 0.5] },
  }),
  gt500: roadSpec({
    name: 'Ford Mustang Shelby GT500', short: 'GT500', blurb: '5.2 supercharged V8 · 567 kW · 847 Nm · RWD · 1,916 kg',
    mass: 1916, frontWeight: 0.56, wb: 2.732, fo: 0.975, ro: 1.122, trackF: 1.662, trackR: 1.662, hpY: -0.03,
    REST: 0.2, K: 56000, tireR: 0.354, tireW: 0.271, rimR: 0.26, H: 1.36, color: 0x12407c, metallic: 0.6, Iw: 1.8,
    rimColor: 0x1c1d1f, rimRough: 0.35, caliper: 0xb3121b,
    top: [[0, 0.182], [0.05, 0.841], [0.1, 0.924], [0.15, 0.961], [0.2, 0.981], [0.25, 0.987], [0.3, 1.004], [0.35, 1.037], [0.4, 1.16], [0.45, 1.268], [0.5, 1.34], [0.55, 1.36], [0.6, 1.354], [0.65, 1.331], [0.7, 1.289], [0.75, 1.231], [0.8, 1.163], [0.85, 1.091], [0.9, 1.119], [0.95, 1.127], [1, 0.696]],
    bot: [[0, 0.145], [0.05, 0.137], [0.1, 0.127], [0.15, 0.128], [0.2, 0.132], [0.25, 0.135], [0.3, 0.134], [0.35, 0.135], [0.4, 0.136], [0.45, 0.136], [0.5, 0.137], [0.55, 0.136], [0.6, 0.136], [0.65, 0.136], [0.7, 0.138], [0.75, 0.144], [0.8, 0.15], [0.85, 0.156], [0.9, 0.161], [0.95, 0.175], [1, 0.268]],
    belt: [[0, 0.182], [0.1, 0.919], [0.2, 0.919], [0.3, 0.919], [0.4, 1.063], [0.5, 0.957], [0.6, 0.965], [0.7, 0.995], [0.8, 1.102], [0.9, 1.023], [1, 0.696]],
    halfW: [[0, 0.468], [0.05, 0.899], [0.1, 0.961], [0.15, 0.96], [0.2, 0.972], [0.25, 0.972], [0.3, 0.945], [0.35, 0.948], [0.4, 0.951], [0.45, 0.915], [0.5, 0.913], [0.55, 0.909], [0.6, 0.926], [0.65, 0.91], [0.7, 0.946], [0.75, 0.956], [0.8, 0.957], [0.85, 0.954], [0.9, 0.882], [0.95, 0.818], [1, 0.451]],
    greenW: 0.612, cab: { ws: 0.325, bk: 0.875 },
    dlo: [[1.699, 0.915], [3.018, 0.967], [3.406, 1.002], [3.046, 1.059], [2.487, 1.051], [2.01, 1.037], [1.866, 1.026]],
    panes: [[[1.699, 0.915], [3.018, 0.967], [3.406, 1.002], [3.046, 1.059], [2.487, 1.051], [2.01, 1.037], [1.866, 1.026]]],
    windshield: [[-0.464, 1.521], [0.464, 1.521], [0.695, 2.863], [-0.695, 2.863]],
    backlight: [[-0.695, 2.938], [0.695, 2.938], [0.402, 4.243], [-0.402, 4.243]],
    mirror: { d: 2.019, h: 0.972, mat: 'paint' },
    exhausts: [{ x: 0.5, y: 0.27, r: 0.05 }, { x: 0.63, y: 0.27, r: 0.05 }],
    rimFace: rr => spokeFace(rr, 10, 0.09, { taper: 0.4 }),
    details({ project, both, rect, M }) {
      // slanted headlights either side of the big black grille; three-bar tail lights
      both('front', [[0.52, 0.62], [0.86, 0.66], [0.88, 0.74], [0.56, 0.72]], M.lens, 0.006);
      project('front', [[-0.56, 0.3], [0.56, 0.3], [0.5, 0.68], [-0.5, 0.68]], M.grille, 0.007);
      both('rear', rect(0.42, 0.72, 0.78, 0.9), M.tail, 0.006);
      project('rear', rect(-0.26, 0.42, 0.26, 0.54), M.plate, 0.008, { sub: 2 });
    },
    engine: { idle: 750, limiter: 7500, curve: [[700, 520], [1500, 640], [2500, 750], [4000, 820], [5000, 847], [6000, 830], [7300, 742], [7600, 690]], gears: [3.25, 2.23, 1.61, 1.24, 1.0, 0.79, 0.63], fd: 3.73, rev: 2.96, eff: 0.9, stall: 2500, upLo: 2300, upHi: 7300, upGround: 0, dnLo: 1300, dnHi: 3900 },
    cda: 0.8, brake: 5200, steerLock: 0.54, awd: false, awdFixed: true,
    pressures: [{ psi: 20, kpa: 138, w: 0.295, defl: 0.028 }, { psi: 32, kpa: 221, w: 0.28, defl: 0.014 }, { psi: 40, kpa: 276, w: 0.27, defl: 0.007 }],
    sound: 'v8gt', cam: { back: 7.4, up: 2.4, hood: [0, 1.02, 0.45] },
  }),
  x5m: roadSpec({
    name: 'BMW X5 M Competition', short: 'X5 M', blurb: '4.4 twin-turbo V8 · 460 kW · 750 Nm · M xDrive · 2,310 kg',
    mass: 2310, frontWeight: 0.53, wb: 2.971, fo: 0.899, ro: 1.077, trackF: 1.728, trackR: 1.728, hpY: -0.12,
    REST: 0.24, K: 56000, tireR: 0.374, tireW: 0.324, rimR: 0.27, H: 1.779, color: 0x1c4f91, metallic: 0.6, Iw: 2.2,
    rimColor: 0x8c9196, rimRough: 0.25, caliper: 0xa0731a,
    top: [[0, 0.911], [0.05, 1.04], [0.1, 1.099], [0.15, 1.143], [0.2, 1.174], [0.25, 1.199], [0.3, 1.283], [0.35, 1.45], [0.4, 1.594], [0.45, 1.684], [0.5, 1.718], [0.55, 1.736], [0.6, 1.747], [0.65, 1.749], [0.7, 1.746], [0.75, 1.737], [0.8, 1.758], [0.85, 1.702], [0.9, 1.665], [0.95, 1.328], [1, 0.621]],
    bot: [[0, 0.243], [0.05, 0.177], [0.1, 0.198], [0.15, 0.185], [0.2, 0.223], [0.25, 0.225], [0.3, 0.226], [0.35, 0.23], [0.4, 0.233], [0.45, 0.236], [0.5, 0.239], [0.55, 0.242], [0.6, 0.246], [0.65, 0.249], [0.7, 0.253], [0.75, 0.271], [0.8, 0.288], [0.85, 0.306], [0.9, 0.303], [0.95, 0.357], [1, 0.386]],
    belt: [[0, 0.911], [0.1, 1.099], [0.2, 1.145], [0.3, 1.158], [0.4, 1.134], [0.5, 1.165], [0.6, 1.193], [0.7, 1.224], [0.8, 1.273], [0.9, 1.562], [1, 0.621]],
    halfW: [[0, 0.509], [0.05, 0.941], [0.1, 1.008], [0.15, 1.019], [0.2, 1.02], [0.25, 1.014], [0.3, 1.003], [0.35, 1.006], [0.4, 0.996], [0.45, 0.997], [0.5, 0.997], [0.55, 0.996], [0.6, 0.995], [0.65, 0.994], [0.7, 1.007], [0.75, 1.031], [0.8, 1.028], [0.85, 1.018], [0.9, 0.972], [0.95, 0.903], [1, 0.534]],
    greenW: 0.632, cab: { ws: 0.275, bk: 0.95 },
    dlo: [[1.495, 1.158], [1.796, 1.121], [3.76, 1.25], [4.096, 1.321], [3.843, 1.365], [2.845, 1.431], [2.162, 1.409]],
    panes: [[[1.495, 1.158], [1.796, 1.121], [3.76, 1.25], [4.096, 1.321], [3.843, 1.365], [2.845, 1.431], [2.162, 1.409]]],
    windshield: [[-0.584, 1.324], [0.584, 1.324], [0.477, 3.022], [-0.477, 3.022]],
    backlight: [[-0.721, 3.19], [0.721, 3.19], [0.685, 4.715], [-0.685, 4.715]],
    mirror: { d: 1.558, h: 1.304, mat: 'paint' },
    rails: { d0: 2.2, d1: 4.2, x: 0.64, mat: 'black' },
    exhausts: [{ x: 0.5, y: 0.3, r: 0.05 }, { x: 0.63, y: 0.3, r: 0.05 }],
    rimFace: rr => spokeFace(rr, 7, 0.085, { split: 0.05, hub: 0.075 }),
    details({ project, both, rect, M }) {
      // slim headlights and the twin kidneys; L-shaped tail lights
      both('front', [[0.5, 0.84], [0.88, 0.88], [0.9, 0.96], [0.52, 0.94]], M.lens, 0.006);
      both('front', [[0.04, 0.62], [0.38, 0.62], [0.4, 0.92], [0.04, 0.92]], M.grille, 0.007);
      both('rear', [[0.34, 1.0], [0.9, 1.02], [0.92, 1.1], [0.36, 1.08]], M.tail, 0.006);
      project('rear', rect(-0.26, 0.74, 0.26, 0.86), M.plate, 0.008, { sub: 2 });
    },
    engine: { idle: 650, limiter: 7200, curve: [[600, 450], [1500, 700], [1800, 750], [5800, 750], [6000, 732], [6600, 650], [7300, 550]], gears: [5.0, 3.2, 2.143, 1.72, 1.313, 1.0, 0.823, 0.64], fd: 3.154, rev: 3.478, eff: 0.88, stall: 2200, upLo: 2000, upHi: 6900, upGround: 0, dnLo: 1200, dnHi: 3500 },
    cda: 1.05, brake: 5600, steerLock: 0.53, awd: true, awdFixed: true,
    pressures: [{ psi: 20, kpa: 138, w: 0.345, defl: 0.032 }, { psi: 32, kpa: 221, w: 0.33, defl: 0.017 }, { psi: 40, kpa: 276, w: 0.32, defl: 0.008 }],
    sound: 'v8bm', cam: { back: 8.2, up: 2.9, hood: [0, 1.3, 0.5] },
  }),
  gle63: roadSpec({
    name: 'Mercedes-AMG GLE 63 S Coupé', short: 'GLE 63', blurb: '4.0 twin-turbo V8 · 450 kW · 850 Nm · 4MATIC+ · 2,445 kg',
    mass: 2445, frontWeight: 0.55, wb: 2.919, fo: 0.912, ro: 1.07, trackF: 1.669, trackR: 1.669, hpY: -0.12,
    REST: 0.24, K: 57000, tireR: 0.406, tireW: 0.336, rimR: 0.279, H: 1.735, color: 0x7a1218, metallic: 0.6, Iw: 2.4,
    rimColor: 0x1c1d1f, rimRough: 0.3, caliper: 0x9a1616,
    top: [[0, 0.987], [0.05, 1.11], [0.1, 1.165], [0.15, 1.209], [0.2, 1.247], [0.25, 1.266], [0.3, 1.364], [0.35, 1.51], [0.4, 1.625], [0.45, 1.699], [0.5, 1.727], [0.55, 1.734], [0.6, 1.732], [0.65, 1.723], [0.7, 1.704], [0.75, 1.673], [0.8, 1.616], [0.85, 1.52], [0.9, 1.44], [0.95, 1.361], [1, 1.051]],
    bot: [[0, 0.288], [0.05, 0.278], [0.1, 0.28], [0.15, 0.28], [0.2, 0.281], [0.25, 0.281], [0.3, 0.278], [0.35, 0.282], [0.4, 0.286], [0.45, 0.29], [0.5, 0.293], [0.55, 0.297], [0.6, 0.301], [0.65, 0.305], [0.7, 0.314], [0.75, 0.329], [0.8, 0.344], [0.85, 0.36], [0.9, 0.374], [0.95, 0.396], [1, 0.427]],
    belt: [[0, 0.987], [0.1, 1.135], [0.2, 1.135], [0.3, 1.285], [0.4, 1.21], [0.5, 1.239], [0.6, 1.257], [0.7, 1.265], [0.8, 1.288], [0.9, 1.348], [1, 1.051]],
    halfW: [[0, 0.43], [0.05, 0.882], [0.1, 0.958], [0.15, 0.974], [0.2, 0.978], [0.25, 0.974], [0.3, 0.951], [0.35, 0.979], [0.4, 0.979], [0.45, 0.979], [0.5, 0.978], [0.55, 0.977], [0.6, 0.976], [0.65, 0.953], [0.7, 0.963], [0.75, 0.991], [0.8, 0.994], [0.85, 0.994], [0.9, 0.963], [0.95, 0.884], [1, 0.529]],
    greenW: 0.585, cab: { ws: 0.25, bk: 0.95 },
    dlo: [[1.235, 1.126], [3.703, 1.272], [4.027, 1.303], [3.981, 1.338], [3.106, 1.422], [2.69, 1.435], [1.832, 1.424]],
    panes: [[[1.235, 1.126], [3.703, 1.272], [4.027, 1.303], [3.981, 1.338], [3.106, 1.422], [2.69, 1.435], [1.832, 1.424]]],
    windshield: [[-0.741, 1.16], [0.741, 1.16], [0.653, 2.818], [-0.653, 2.818]],
    backlight: [[-0.656, 3.019], [0.656, 3.019], [0.349, 4.668], [-0.349, 4.668]],
    mirror: { d: 1.741, h: 1.285, mat: 'paint' },
    exhausts: [{ x: 0.52, y: 0.32, shape: 'trap', w: 0.11, h: 0.07 }, { x: 0.68, y: 0.32, shape: 'trap', w: 0.11, h: 0.07 }],
    rimFace: rr => spokeFace(rr, 10, 0.08, { taper: 0.4 }),
    details({ project, both, rect, M }) {
      // slim headlights, the vertical-slat Panamericana grille; narrow tail lights under the sloping tailgate
      both('front', [[0.52, 0.84], [0.88, 0.88], [0.9, 0.96], [0.56, 0.94]], M.lens, 0.006);
      project('front', [[-0.44, 0.6], [0.44, 0.6], [0.5, 0.94], [-0.5, 0.94]], M.grille, 0.007);
      both('rear', [[0.34, 1.06], [0.9, 1.08], [0.92, 1.15], [0.36, 1.13]], M.tail, 0.006);
      project('rear', rect(-0.26, 0.58, 0.26, 0.7), M.plate, 0.008, { sub: 2 });
    },
    engine: { idle: 700, limiter: 7000, curve: [[700, 480], [1500, 700], [2250, 850], [5000, 850], [5750, 747], [6500, 661], [7100, 560]], gears: [5.35, 3.24, 2.25, 1.64, 1.21, 1.0, 0.87, 0.72, 0.6], fd: 3.27, rev: 4.8, eff: 0.88, stall: 2300, upLo: 2100, upHi: 6700, upGround: 0, dnLo: 1250, dnHi: 3500 },
    cda: 1.02, brake: 5600, steerLock: 0.52, awd: true, awdFixed: true,
    pressures: [{ psi: 20, kpa: 138, w: 0.355, defl: 0.034 }, { psi: 32, kpa: 221, w: 0.34, defl: 0.018 }, { psi: 40, kpa: 276, w: 0.33, defl: 0.008 }],
    sound: 'v8rs', cam: { back: 8.2, up: 2.9, hood: [0, 1.3, 0.5] },
  }),
  arteonr: roadSpec({
    name: 'Volkswagen Arteon R', short: 'Arteon R', blurb: '2.0 turbo four · 235 kW · 420 Nm · 4MOTION · 1,725 kg',
    mass: 1725, frontWeight: 0.59, wb: 2.841, fo: 0.913, ro: 1.11, trackF: 1.57, trackR: 1.57, hpY: -0.05,
    REST: 0.2, K: 50000, tireR: 0.33, tireW: 0.245, rimR: 0.254, H: 1.429, color: 0x1b3a8c, metallic: 0.6, Iw: 1.6,
    rimColor: 0x2a2c2f, rimRough: 0.3, caliper: 0x1f3f9e,
    top: [[0, 0.641], [0.05, 0.792], [0.1, 0.871], [0.15, 0.919], [0.2, 0.956], [0.25, 0.976], [0.3, 1.113], [0.35, 1.235], [0.4, 1.335], [0.45, 1.387], [0.5, 1.409], [0.55, 1.417], [0.6, 1.409], [0.65, 1.397], [0.7, 1.392], [0.75, 1.332], [0.8, 1.266], [0.85, 1.195], [0.9, 1.118], [0.95, 1.037], [1, 0.65]],
    bot: [[0, 0.198], [0.05, 0.157], [0.1, 0.113], [0.15, 0.163], [0.2, 0.167], [0.25, 0.171], [0.3, 0.174], [0.35, 0.177], [0.4, 0.18], [0.45, 0.184], [0.5, 0.187], [0.55, 0.19], [0.6, 0.193], [0.65, 0.197], [0.7, 0.2], [0.75, 0.208], [0.8, 0.216], [0.85, 0.223], [0.9, 0.204], [0.95, 0.259], [1, 0.345]],
    belt: [[0, 0.641], [0.1, 0.871], [0.2, 0.931], [0.3, 1.013], [0.4, 0.909], [0.5, 0.927], [0.6, 0.947], [0.7, 0.974], [0.8, 1.183], [0.9, 1.037], [1, 0.65]],
    halfW: [[0, 0.463], [0.05, 0.807], [0.1, 0.909], [0.15, 0.918], [0.2, 0.922], [0.25, 0.924], [0.3, 0.92], [0.35, 0.922], [0.4, 0.921], [0.45, 0.919], [0.5, 0.916], [0.55, 0.91], [0.6, 0.903], [0.65, 0.9], [0.7, 0.916], [0.75, 0.918], [0.8, 0.914], [0.85, 0.905], [0.9, 0.858], [0.95, 0.791], [1, 0.514]],
    greenW: 0.646, cab: { ws: 0.25, bk: 0.925 },
    dlo: [[1.328, 0.939], [1.595, 0.891], [3.157, 0.958], [3.703, 1.043], [3.381, 1.116], [2.651, 1.179], [1.842, 1.164]],
    panes: [[[1.328, 0.939], [1.595, 0.891], [3.157, 0.958], [3.703, 1.043], [3.381, 1.116], [2.651, 1.179], [1.842, 1.164]]],
    windshield: [[-0.56, 1.177], [0.56, 1.177], [0.697, 2.833], [-0.697, 2.833]],
    backlight: [[-0.697, 2.896], [0.697, 2.896], [0.401, 4.519], [-0.401, 4.519]],
    mirror: { d: 1.411, h: 1.073, mat: 'paint' },
    exhausts: [{ x: 0.5, y: 0.27, r: 0.045 }, { x: 0.61, y: 0.27, r: 0.045 }],
    rimFace: rr => spokeFace(rr, 5, 0.12, { split: 0.05, hub: 0.07 }),
    details({ project, both, rect, M }) {
      // slim headlights joined by the light strip across the grille; tail lights across the hatch
      both('front', [[0.42, 0.6], [0.88, 0.62], [0.9, 0.7], [0.44, 0.68]], M.lens, 0.006);
      project('front', [[-0.5, 0.26], [0.5, 0.26], [0.56, 0.44], [-0.56, 0.44]], M.grille, 0.007);
      both('rear', [[0.12, 0.8], [0.84, 0.8], [0.86, 0.9], [0.12, 0.9]], M.tail, 0.006);
      project('rear', rect(-0.26, 0.48, 0.26, 0.6), M.plate, 0.008, { sub: 2 });
    },
    engine: { idle: 750, limiter: 6800, curve: [[700, 250], [1500, 340], [2100, 420], [5350, 420], [6000, 380], [6500, 345], [6800, 300]], gears: [3.19, 2.19, 1.52, 1.06, 0.84, 0.69, 0.58], fd: 4.47, rev: 2.7, eff: 0.88, stall: 2000, upLo: 1900, upHi: 6500, upGround: 0, dnLo: 1200, dnHi: 3300 },
    cda: 0.72, brake: 4800, steerLock: 0.55, awd: true, awdFixed: true,
    pressures: [{ psi: 22, kpa: 152, w: 0.26, defl: 0.026 }, { psi: 36, kpa: 248, w: 0.245, defl: 0.012 }, { psi: 42, kpa: 290, w: 0.24, defl: 0.007 }],
    sound: 'i4t', cam: { back: 7.4, up: 2.4, hood: [0, 1.0, 0.5] },
  }),
};


/* ---------- engine sound presets (cylinder count, firing order, exhaust plumbing) ---------- */
// fire: firing slots over one 720° cycle; bank: which header each slot feeds (crossplane V8: 1-5-4-8-6-3-7-2)
const SOUNDS = {
  flat4: { fire: [0, 0.25, 0.5, 0.75], bank: [0, 1, 0, 1], hdr: [0.0061, 0.0068], coll: 0.0029, tail: 0.0113, muff: [900, 4200, 1800], body: [120, 4], honk: [520, 4], pres: 1700,
    level: 1, turbo: 0, bov: 0, limiter: 7600, exW: 0.09, drive: [1.6, 3.2], intake: 0.5, mech: 1, whine: 0.22, burble: 0.3 },
  i6: { fire: [0, 1, 2, 3, 4, 5].map(k => k / 6), bank: [0, 1, 0, 1, 0, 1], hdr: [0.0045, 0.0049], coll: 0.0022, tail: 0.016, muff: [500, 2600, 1400], body: [95, 4], honk: [700, 3], pres: 2000,
    level: 0.85, turbo: 1, bov: 0.6, limiter: 7000, exW: 0.07, drive: [1.2, 2.6], intake: 0.35, mech: 0.5, whine: 0.1, burble: 0.35 },
  // BMW 4.4 hot-V V8 in a big luxury car: deep, even-tempered crossplane burble, mostly exhaust boom, little top end
  v8lux: { fire: [0, 1, 2, 3, 4, 5, 6, 7].map(k => k / 8), bank: [0, 1, 0, 1, 1, 0, 0, 1], hdr: [0.005, 0.0056], bankPipe: [0.0102, 0.0117], coll: 0.0027, tail: 0.021, muff: [340, 1900, 1000], body: [74, 6], honk: [360, 3], pres: 1500,
    sub: [118, 4], dual: 0.5, cylVar: 0.12, rasp: 0.08, raspF: 2200,
    level: 0.74, turbo: 0.6, bov: 0, limiter: 6800, exW: 0.085, drive: [1.1, 2.5], intake: 0.28, mech: 0.3, whine: 0.06, burble: 0.22 },
  v8rs: { fire: [0, 1, 2, 3, 4, 5, 6, 7].map(k => k / 8), bank: [0, 1, 0, 1, 1, 0, 0, 1], hdr: [0.0052, 0.0058], coll: 0.0026, tail: 0.018, muff: [550, 3400, 1500], body: [80, 5], honk: [420, 4], pres: 1600,
    level: 1.0, turbo: 0.8, bov: 0.4, limiter: 6800, exW: 0.085, drive: [1.5, 3.4], intake: 0.35, mech: 0.4, whine: 0.08, burble: 0.6 },
  // 60° V6, even firing 1-4-2-5-3-6 alternating banks: smoother, deeper, heavily muffled
  v6tt: { fire: [0, 1, 2, 3, 4, 5].map(k => k / 6), bank: [0, 1, 0, 1, 0, 1], hdr: [0.0058, 0.0062], coll: 0.0028, tail: 0.022, muff: [280, 1400, 800], body: [62, 5], honk: [330, 3], pres: 1500,
    level: 0.62, turbo: 0.9, bov: 0.25, limiter: 6300, exW: 0.08, drive: [1.0, 2.0], intake: 0.3, mech: 0.35, whine: 0.07, burble: 0.12 },
  // Porsche 4.0 V8: hot-V twin turbo, sharper and higher pitched than the luxury V8s
  // Maserati 3.8 V8 (built by Ferrari): crossplane, short pipes, loud and hard-edged, bark at high revs, lots of overrun crackle
  v8m: { fire: [0, 1, 2, 3, 4, 5, 6, 7].map(k => k / 8), bank: [0, 1, 0, 1, 1, 0, 0, 1], hdr: [0.0042, 0.0048], bankPipe: [0.0071, 0.0083], coll: 0.0021, tail: 0.0145, muff: [800, 5200, 2600], body: [98, 5], honk: [610, 5], pres: 2100,
    sub: [150, 3], dual: 0.9, cylVar: 0.18, rasp: 0.6, raspF: 2900,
    level: 1.1, turbo: 0.5, bov: 0.3, limiter: 7300, exW: 0.095, drive: [1.9, 4.2], intake: 0.5, mech: 0.5, whine: 0.06, burble: 0.85 },
  // Jaguar 4.0 V8 with an Eaton supercharger: the luxury V8's burble, no turbo hush, the blower's whine on top
  v8sc: { fire: [0, 1, 2, 3, 4, 5, 6, 7].map(k => k / 8), bank: [0, 1, 0, 1, 1, 0, 0, 1], hdr: [0.0049, 0.0055], bankPipe: [0.0098, 0.0112], coll: 0.0026, tail: 0.019, muff: [420, 2400, 1200], body: [80, 5], honk: [400, 3], pres: 1600,
    sub: [125, 4], dual: 0.6, cylVar: 0.12, rasp: 0.2, raspF: 2400,
    level: 0.86, turbo: 0, bov: 0, limiter: 6250, exW: 0.085, drive: [1.2, 2.8], intake: 0.4, mech: 0.35, whine: 0.3, burble: 0.35 },
  // Porsche 3.7 flat-six, twin turbo: three cylinders a side, each bank through its own short manifold, turbo and
  // pipe, never quite alike (the boxer's half-order growl, wide in stereo); the firing note leads all the way up
  // the revs (pipes too short to cancel it), deep rather than buzzy, with the turbos' rush over it under boost
  f6tt: { fire: [0, 1, 2, 3, 4, 5].map(k => k / 6), bank: [0, 1, 0, 1, 0, 1], hdr: [0.00105, 0.0012], hdrRef: [0.4, 0.25], bankPipe: [0.0023, 0.0026], coll: 0.0019, tail: 0.0125, muff: [500, 3000, 1600], body: [75, 5], honk: [900, 3], pres: 1500,
    sub: [110, 4], dual: 0.5, cylVar: 0.12, rasp: 0.2, raspF: 1900, rush: 0.5,
    level: 0.95, turbo: 0.8, bov: 0.3, limiter: 7200, exW: 0.11, drive: [1.3, 2.7], intake: 0.35, mech: 0.7, whine: 0.05, burble: 0.3 },
  // Ford 5.2 "Predator" V8 with a big Eaton supercharger: a loud cross-plane V8 that revs to 7500, hard-edged, the blower's whine over it
  v8gt: { fire: [0, 1, 2, 3, 4, 5, 6, 7].map(k => k / 8), bank: [0, 1, 0, 1, 1, 0, 0, 1], hdr: [0.0045, 0.0051], bankPipe: [0.0082, 0.0095], coll: 0.0023, tail: 0.016, muff: [700, 4600, 2200], body: [88, 6], honk: [520, 4], pres: 1900,
    sub: [135, 4], dual: 0.9, cylVar: 0.16, rasp: 0.45, raspF: 2600,
    level: 1.1, turbo: 0, bov: 0, limiter: 7500, exW: 0.095, drive: [1.8, 4.0], intake: 0.5, mech: 0.45, whine: 0.32, burble: 0.7 },
  // BMW M's 4.4 hot-V V8 (S63) behind a sports exhaust: the luxury V8's deep burble, louder and sharper, revving to 7200
  v8bm: { fire: [0, 1, 2, 3, 4, 5, 6, 7].map(k => k / 8), bank: [0, 1, 0, 1, 1, 0, 0, 1], hdr: [0.005, 0.0056], bankPipe: [0.0098, 0.0112], coll: 0.0026, tail: 0.019, muff: [460, 2900, 1400], body: [78, 6], honk: [400, 3], pres: 1600,
    sub: [120, 4], dual: 0.6, cylVar: 0.13, rasp: 0.22, raspF: 2400,
    level: 0.92, turbo: 0.7, bov: 0.3, limiter: 7200, exW: 0.085, drive: [1.4, 3.2], intake: 0.33, mech: 0.35, whine: 0.06, burble: 0.5 },
  // VW's EA888 2.0 turbo four in the R: an even four-beat through a 4-2-1 manifold, buzzier than the sixes and eights,
  // the turbo's whistle and the dump valve between shifts, the sports exhaust's crackle on the overrun
  i4t: { fire: [0, 0.25, 0.5, 0.75], bank: [0, 1, 0, 1], hdr: [0.0052, 0.0056], coll: 0.0024, tail: 0.015, muff: [600, 3600, 1700], body: [100, 4], honk: [640, 4], pres: 1900,
    sub: [140, 3], dual: 0.7, cylVar: 0.08, rasp: 0.35, raspF: 2700,
    level: 0.95, turbo: 1, bov: 0.5, limiter: 6800, exW: 0.085, drive: [1.4, 3.0], intake: 0.45, mech: 0.5, whine: 0.06, burble: 0.55 },
  v8p: { fire: [0, 1, 2, 3, 4, 5, 6, 7].map(k => k / 8), bank: [0, 1, 0, 1, 1, 0, 0, 1], hdr: [0.0046, 0.0051], coll: 0.0023, tail: 0.016, muff: [650, 3800, 1700], body: [90, 5], honk: [480, 4], pres: 1700,
    level: 0.95, turbo: 0.7, bov: 0.2, limiter: 6800, exW: 0.08, drive: [1.4, 3.1], intake: 0.4, mech: 0.45, whine: 0.07, burble: 0.45 },
};

/* ---------- vehicle registry: the buggy plus the road cars, all on the same tire / sand physics ---------- */
const BUGGY = {
  key: 'buggy', name: 'Dune buggy', short: 'Buggy', mass: car.mass, I: car.I.clone(), R: car.R, REST: car.REST, K: car.K, CB: car.CB, CR: car.CR, Iw: car.Iw,
  wheels: car.wheels, hull: car.hull, eng: ENG, pressures: PRESSURES, cda: 0.9, brake: 1700, steerLock: 0.6, awd: false, awdFixed: false,
  box: [1.02, 2.12, -1.98], roofY: 0.9, underY: -0.25, sound: 'flat4', engineFront: false, pops: 1,
  cam: { back: 7.5, up: 2.8, cockpit: [0.27, 0.95, -0.35] }, vis: buggy, pIdx: 1,
};
const VEHICLE_LIST = {
  buggy: { name: 'Dune buggy', blurb: 'flat-four · 120 kW · 820 kg · long-travel' },
  supra: { name: ROAD_CARS.supra.name, blurb: ROAD_CARS.supra.blurb },
  x7: { name: ROAD_CARS.x7.name, blurb: ROAD_CARS.x7.blurb },
  rs6: { name: ROAD_CARS.rs6.name, blurb: ROAD_CARS.rs6.blurb },
  bmw7: { name: ROAD_CARS.bmw7.name, blurb: ROAD_CARS.bmw7.blurb },
  navigator: { name: ROAD_CARS.navigator.name, blurb: ROAD_CARS.navigator.blurb },
  cayenne: { name: ROAD_CARS.cayenne.name, blurb: ROAD_CARS.cayenne.blurb },
  quattroporte: { name: ROAD_CARS.quattroporte.name, blurb: ROAD_CARS.quattroporte.blurb },
  xjr: { name: ROAD_CARS.xjr.name, blurb: ROAD_CARS.xjr.blurb },
  sl63: { name: ROAD_CARS.sl63.name, blurb: ROAD_CARS.sl63.blurb },
  p911: { name: ROAD_CARS.p911.name, blurb: ROAD_CARS.p911.blurb },
  cayennets: { name: ROAD_CARS.cayennets.name, blurb: ROAD_CARS.cayennets.blurb },
  gt500: { name: ROAD_CARS.gt500.name, blurb: ROAD_CARS.gt500.blurb },
  x5m: { name: ROAD_CARS.x5m.name, blurb: ROAD_CARS.x5m.blurb },
  gle63: { name: ROAD_CARS.gle63.name, blurb: ROAD_CARS.gle63.blurb },
  arteonr: { name: ROAD_CARS.arteonr.name, blurb: ROAD_CARS.arteonr.blurb },
};
const VEHICLES = { buggy: BUGGY };
let VEH = BUGGY, VIS = buggy;

function makeRoadVehicle(key) {
  const S = ROAD_CARS[key], built = buildRoadCar(S), Bs = built.B, Z = s => S.zF - s * S.L;
  built.group.visible = false; scene.add(built.group);
  const wheels = S.wheels.map((w, i) => ({
    name: w.name, hp: new THREE.Vector3(w.x, S.hpY, w.z), front: w.front, holder: built.wheels[i].holder, spinner: built.wheels[i].spinner,
    t: S.REST, comp: 0, omega: 0, spin: 0, contact: false, load: 0, sink: 0, slip: 0, slipSpeed: 0, cUnder: 0, P: new THREE.Vector3(), fwd: new THREE.Vector3(), dug: 0, toe: 0, camber: 0,
  }));
  const m = S.mass, L = S.L, H = S.H, hw = Math.max(...S.halfW.map(p => p[1])), Wd = 2 * hw;
  // hull contact points: underbody corners (clear of the wheels), sills, roof, bumpers
  const hull = [], yG = S.yG, P3 = (x, y, z) => hull.push(new THREE.Vector3(x, y, z));
  for (const s of [0.02, 0.36, 0.64, 0.98]) { const q = Bs.sec(s); for (const sg of [1, -1]) P3(sg * q.w * 0.78, yG + q.yb + 0.01, Z(s)); }
  { const q = Bs.sec(0.5); P3(0, yG + q.yb, Z(0.5)); }
  for (const s of [0.1, 0.5, 0.9]) { const q = Bs.sec(s); for (const sg of [1, -1]) P3(sg * q.w, yG + q.ys, Z(s)); }
  for (const f of [0.15, 0.4, 0.65, 0.9]) { const s = lerp(S.cab.ws, S.cab.bk, f), q = Bs.sec(s); for (const sg of [1, -1]) P3(sg * q.wg * 0.85, yG + q.yt - 0.04, Z(s)); P3(0, yG + q.yt, Z(s)); }
  for (const s of [0.25, 0.75]) { const q = Bs.sec(s); for (const sg of [1, -1]) P3(sg * q.w, yG + (q.ys + q.yt) / 2, Z(s)); }   // shoulders, so it can rest on its side
  for (const s of [0, 1]) { const q = Bs.sec(s); P3(0, yG + (q.yb + q.ys) / 2, Z(s)); }
  const clear = Math.min(...S.bot.map(p => p[1]));
  // bonnet camera: just above the bonnet, ahead of the windscreen
  const sh = S.cab.ws - 0.035, camY = yG + Bs.sec(sh).yt + 0.17;
  return {
    key, name: S.name, short: S.short, mass: m, R: S.tireR + S.pressures[1].defl, REST: S.REST, K: S.K,
    CB: 2 * 0.3 * Math.sqrt(S.K * m / 4), CR: 2 * 0.45 * Math.sqrt(S.K * m / 4), Iw: S.Iw || (key === 'supra' ? 1.4 : key === 'x7' ? 2.1 : 1.8),
    I: new THREE.Vector3(m * (L * L + H * H) / 12 * 0.75, m * (L * L + Wd * Wd) / 12 * 0.75, m * (Wd * Wd + H * H) / 12 * 0.7),
    wheels, hull, eng: S.engine, pressures: S.pressures, cda: S.cda, brake: S.brake, steerLock: S.steerLock, awd: S.awd, awdFixed: S.awdFixed, split: S.split ?? 0.5,
    box: [hw, S.zF, S.zF - L], roofY: yG + 0.75 * H, underY: yG + clear + 0.06, sound: S.sound, engineFront: true, pops: key === 'x7' || key === 'bmw7' || key === 'navigator' ? 0.25 : 1, aids: true,
    cam: { back: S.cam.back, up: S.cam.up, cockpit: [0, camY, Z(sh)] }, vis: built.group, built, pIdx: 1,
  };
}

/* ---------- detailed 3D models: models/<key>.glb.gz, a gzipped glTF binary ---------- */
// fit: model hub height and axle z (glTF axes: +z forward, +y up, +x left); 'spin*' / 'stat*' nodes are the wheels (L/R, F/B)
const MODELS = {
  x7: { src: 'models/x7.js', hubY: 0.406, zF: 1.579, zR: -1.527, paint: 0x1d4032, paintRe: /_body$/ },
  quattroporte: { src: 'models/quattroporte.js', hubY: 0.355, zF: 1.666, zR: -1.495, paint: 0x12307a },
  rs6: { hubY: 0.366, zF: 1.538, zR: -1.391, paint: 0xa3070c },
  navigator: { hubY: 0.395, zF: 1.558, zR: -1.554, paint: 0xeeeeea, eye: [0.46, 1.43, -0.05] },
  // built by scripts/models/build-car.mjs (the numbers are what it prints); the XJR is right-hand drive
  xjr: { hubY: 0.335, zF: 1.447, zR: -1.447, paint: 0x0f3b26, eye: [-0.37, 1.05, -0.2] },
  sl63: { hubY: 0.379, zF: 1.35, zR: -1.35, paint: 0x0d1b3a, eye: [0.38, 1.17, -0.42] },
  p911: { hubY: 0.351, zF: 1.226, zR: -1.226, paint: 0x9a9da1, eye: [0.34, 1.08, -0.27] },
  cayennets: { hubY: 0.37, zF: 1.425, zR: -1.425, paint: 0x4a3a2c, eye: [0.42, 1.36, -0.2] },
  gt500: { hubY: 0.354, zF: 1.366, zR: -1.366, paint: 0x12407c, eye: [0.38, 1.1, -0.34] },
  x5m: { hubY: 0.374, zF: 1.486, zR: -1.486, paint: 0x1c4f91, eye: [0.41, 1.4, -0.18] },
  gle63: { hubY: 0.406, zF: 1.459, zR: -1.459, paint: 0x7a1218, eye: [0.45, 1.42, -0.07] },
  arteonr: { hubY: 0.33, zF: 1.421, zR: -1.421, paint: 0x1b3a8c, eye: [0.36, 1.12, -0.2] },
};
// Rewrite a GLB so its textures are data: URIs in the JSON instead of buffer views (which the loader would turn into blob: URLs).
function inlineGlbImages(buf) {
  try {
    const dv = new DataView(buf), jl = dv.getUint32(12, true), u8 = new Uint8Array(buf);
    const json = JSON.parse(new TextDecoder().decode(u8.subarray(20, 20 + jl)));
    if (!json.images?.some(i => i.bufferView != null)) return buf;
    const binAt = 20 + jl + 8, bin = u8.subarray(binAt, binAt + dv.getUint32(20 + jl, true));
    for (const im of json.images) {
      if (im.bufferView == null) continue;
      const bv = json.bufferViews[im.bufferView], b = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
      let str = ''; for (let i = 0; i < b.length; i += 0x8000) str += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
      im.uri = `data:${im.mimeType || 'image/png'};base64,` + btoa(str); delete im.bufferView;
    }
    let js = new TextEncoder().encode(JSON.stringify(json)); const pad = (4 - js.length % 4) % 4;
    const out = new Uint8Array(12 + 8 + js.length + pad + 8 + bin.length), ov = new DataView(out.buffer);
    ov.setUint32(0, 0x46546C67, true); ov.setUint32(4, 2, true); ov.setUint32(8, out.length, true);
    ov.setUint32(12, js.length + pad, true); ov.setUint32(16, 0x4E4F534A, true); out.set(js, 20); out.fill(0x20, 20 + js.length, 20 + js.length + pad);
    const o = 20 + js.length + pad; ov.setUint32(o, bin.length, true); ov.setUint32(o + 4, 0x004E4942, true); out.set(bin, o + 8);
    return out.buffer;
  } catch (e) { console.warn('inlineGlbImages', e); return buf; }
}
const MODEL_GZ = {};
const modelGz = key => MODEL_GZ[key] ??= fetch(`models/${key}.glb.gz`).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); });
function loadModel(V) {
  const D = MODELS[V.key]; if (!D || V.modelState || AI_WK) return; V.modelState = 'loading';
  (async () => {
    try {
      if (typeof DecompressionStream === 'undefined') throw new Error('this browser cannot unpack the model (needs Chrome 80+, Firefox 113+ or Safari 16.4+)');
      const gz = await modelGz(V.key);
      const buf = await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      const ld = new GLTFLoader();
      ld.register(parser => { parser.textureLoader = new THREE.TextureLoader(parser.options.manager); return { name: 'SB_plain_images' }; });   // <img> + data: URIs: blob URLs fail in some embedded browsers
      const gltf = await ld.parseAsync(inlineGlbImages(buf), '');
      attachModel(V, gltf.scene, D); V.modelState = 'ok'; V.onModel?.();
    } catch (err) { console.warn('model', V.key, err); V.modelState = 'failed'; if (V === VEH) flash(`Detailed ${V.short} model could not load (${err.message}): using the built-in body`, '#ffd88a', 4); }
  })();
}
const DRIVER_CAM = { fwd: 0.3, up: 0.05, pitch: -0.065 };   // from the driver's eyes: metres forward / up, radians down
function attachModel(V, root, D) {
  const S = ROAD_CARS[V.key], b = V.built, a = S.wheels[0].z, hubY = S.yG + S.tireR;
  const dz = (a - D.zF + (S.wheels[2].z - D.zR)) / 2, dy = hubY - D.hubY;
  // hide the lofted body and wheels; keep exhaust flames
  b.group.traverse(o => { if (o.isMesh && !b.flames.includes(o)) o.visible = false; });
  const parts = {}; root.traverse(o => { if (/^(spin|stat)[LR][FB]/.test(o.name)) parts[o.name.slice(0, 6)] ??= o; });   // the first: a wheel of several materials loads as a group spinLF of meshes spinLF_1… (#299)
  for (const o of Object.values(parts)) o.parent.remove(o);
  const bb = new THREE.Box3().setFromObject(root), wbm = D.zF - D.zR;
  const eye = D.eye || [0.38, bb.max.y - 0.37, (D.zF + D.zR) / 2 - 0.09 * wbm];      // driver's eyes, in model space (left-hand drive)
  V.cam.driver = [eye[0], eye[1] + dy + DRIVER_CAM.up, eye[2] + dz + DRIVER_CAM.fwd]; V.winGlass = [];
  root.position.set(0, dy, dz); b.group.add(root);
  const keyOf = ['LF', 'RF', 'LB', 'RB'];                          // wheel order FL, FR, RL, RR
  V.wheels.forEach((W, i) => {
    for (const [pre, host] of [['spin', W.spinner], ['stat', W.holder]]) {
      const n = parts[pre + keyOf[i]]; if (!n) continue;
      n.position.set(0, 0, 0); host.add(n);
    }
  });
  // keep the model's own materials; make glass see-through, lights glow, and hook the brake lights up
  const tails = [], pm = [];
  [root, ...Object.values(parts)].forEach(r => r.traverse(o => {
    if (!o.isMesh) return; o.castShadow = true; o.receiveShadow = true;
    for (const m of [].concat(o.material)) {
      if (m.userData.sbDone) continue; m.userData.sbDone = true;
      const n = m.name, glassy = isGlassMat(m);        // before transmission and opacity are touched
      if ('transmission' in m) m.transmission = 0;
      if (/tire|tyre/i.test(n)) { m.map = null; m.color.set(0x121212); m.roughness = 0.92; m.metalness = 0; }
      if (!glassy) { m.transparent = false; m.opacity = 1; m.alphaTest = /^decal_/.test(n) && m.map ? 0.5 : 0; m.depthWrite = true; m.side = THREE.DoubleSide; }   // game models often carry a stray alpha channel
      if (/taill|tail_?led|rearlight(?!_glass|_chrome)|brakelight/i.test(n)) { m.emissive.set(0xff1208); m.emissiveMap = m.map; m.emissiveIntensity = 0.6; tails.push(m); }
      else if (/drl|laser|running_[lr]/i.test(n)) { m.emissive.set(0xeaf4ff); m.emissiveIntensity = 2; }
      else if (glassy) {
        const lamp = /head|rear|tail|lens|projector|subglass|glass_light/i.test(n);
        m.userData.sbGlass = /tail|rear_?light|red_glass|brake/i.test(n) ? 'tail' : /mirror/i.test(n) ? 'mirror' : /head|lens|projector|glass_light|lamp|subglass/i.test(n) ? 'lamp' : 'window';
        m.transparent = true; m.depthWrite = false; m.side = THREE.DoubleSide; m.roughness = Math.min(m.roughness, 0.08); m.metalness = Math.min(m.metalness, 0.2);
        if (/tail|rear|red_glass/i.test(n)) { m.color.set(0x8a0808); m.opacity = 0.5; } else if (lamp) m.opacity = Math.min(m.opacity, 0.25); else if (!/mirror/i.test(n)) { m.color.set(0x0a0d11); m.opacity = 0.9; m.map = null; m.alphaMap = null; V.winGlass.push(m); } else m.transparent = false;
      }
      else if ((D.paintRe || /paint/i).test(n) && !/^INT_/.test(n)) { m.metalness = Math.max(m.metalness, 0.5); m.roughness = Math.min(m.roughness, 0.35); m.envMapIntensity = 1.3; if (D.paint != null) { m.color.set(D.paint); m.map = null; } pm.push(m); }
      else if (/chrome/i.test(n)) { m.metalness = 1; m.roughness = Math.min(m.roughness, 0.15); }
    }
  }));
  if (tails.length) { const M0 = b.M.tail = { get emissiveIntensity() { return tails[0].emissiveIntensity; }, set emissiveIntensity(v) { for (const t of tails) t.emissiveIntensity = v * 0.6; } }; }
  V.dentables = null; V.glass = null;
  V.paintMats = pm; applySavedPaint(V);
  // breakable parts of the model: each has a health; hits near it loosen it, then knock it off
  const TOUGH = { mirror: 5, bumper: 8, fender: 10, hood: 11, tailgate: 11, door: 12 };
  V.parts = []; b.group.updateMatrixWorld(true); const gInv = new THREE.Matrix4().copy(b.group.matrixWorld).invert();
  for (const o of root.children.slice()) {
    if (!/^part_/.test(o.name)) continue;
    const pb = new THREE.Box3().setFromObject(o), c = pb.getCenter(new THREE.Vector3()).applyMatrix4(gInv), kind = o.name.slice(5).split('_')[0];
    V.parts.push({ o, name: o.name.slice(5), c, r: pb.getSize(new THREE.Vector3()).length() / 2, tough: TOUGH[kind] || 9, hp: 1, p0: o.position.clone(), q0: o.quaternion.clone(), sgn: Math.sign(c.x) || (V.parts.length % 2 ? 1 : -1) });
  }
  const sw = root.getObjectByName('steer'); if (sw) V.steerNode = { o: sw, q0: sw.quaternion.clone() };
  glassOf(V);                                  // its panes now, not at the first hit
}

// ---- paint colour: per vehicle, remembered in this browser ----
const PAINTS = [['Red', 0xb3090f], ['Orange', 0xd9360b], ['Yellow', 0xe0b010], ['Green', 0x1d4032], ['Lime', 0x6fae1c], ['Blue', 0x12307a], ['Sky blue', 0x4a90c8], ['Purple', 0x4b1f6f], ['White', 0xeeeeea], ['Silver', 0x9a9da1], ['Grey', 0x3a3d42], ['Black', 0x0c0c0e]];
let savedPaint = {}; if (!MP.on) try { savedPaint = JSON.parse(localStorage.getItem('sandbuggy.paint') || '{}') || {}; } catch (e) { }
function paintMatsOf(V) {
  if (V.paintMats) return V.paintMats;
  const base = new THREE.Color(V.key === 'buggy' ? 0xd9360b : ROAD_CARS[V.key].color).getHex(), set = new Set();
  V.vis.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) if (m.color && m.color.getHex() === base && (m.clearcoat > 0 || m.metalness > 0.05)) set.add(m); });
  return V.paintMats = [...set];
}
function setPaint(V, hex, save = true) {
  for (const m of paintMatsOf(V)) m.color.setHex(hex);
  if (save) { savedPaint[V.key] = hex; if (!MP.on) try { localStorage.setItem('sandbuggy.paint', JSON.stringify(savedPaint)); } catch (e) { } }
}
function applySavedPaint(V) { if (V.mpPaint != null) setPaint(V, V.mpPaint, false); else if (savedPaint[V.key] != null) setPaint(V, savedPaint[V.key], false); }
function togglePaintPanel(show) {
  const el = document.getElementById('paintPanel'); if (show == null) show = el.style.display !== 'block';
  if (show && !el.firstChild) {
    el.innerHTML = '<div style="margin-bottom:6px;font-weight:700">Paint colour</div>' + PAINTS.map(([n, h]) => `<button class="sw" title="${n}" data-hex="${h}" style="background:#${h.toString(16).padStart(6, '0')}"></button>`).join('') + '<label>Any colour <input type="color" value="#b3090f"></label>';
    el.addEventListener('click', e => { const h = e.target.dataset?.hex; if (h != null) { setPaint(VEH, +h); e.target.blur(); } });
    el.querySelector('input').addEventListener('input', e => setPaint(VEH, parseInt(e.target.value.slice(1), 16)));
  }
  el.style.display = show ? 'block' : 'none';
}
document.getElementById('paintBtn').addEventListener('click', e => { e.currentTarget.blur(); togglePaintPanel(); });
// all-wheel drive's split (the front's share) for a vehicle: this browser's choice for it (4), else its own
const SPLITS = [0.5, 0.4, 0.3, 0.2];                                 // (the 4 key's round; the Car setup drawer sets any 5 %)
function carSplit(V) {
  try { const v = JSON.parse(localStorage.getItem('sandbuggy.split') || '{}')[V.key]; if (typeof v === 'number' && v >= 0 && v <= 1) return v; } catch (e) { }
  return V.split ?? 0.5;
}
// ---------- the car's setup (#332): the drive, the split, the tires' pressure; this browser's choice for each car ----------
const setupOf = V => { try { return (JSON.parse(localStorage.getItem('sandbuggy.setup') || '{}') || {})[V.key] || {}; } catch (e) { return {}; } };
const carPressure = V => { const p = setupOf(V).p; return Number.isInteger(p) && V.pressures[p] ? p : V.pIdx; };
const carDrive = V => V.awdFixed ? V.awd : !!(setupOf(V).awd ?? V.awd);
function setupKeep(store, fn) { try { const m = JSON.parse(localStorage.getItem(store) || '{}') || {}; fn(m); localStorage.setItem(store, JSON.stringify(m)); } catch (e) { } }
function setupKeepOwn(k, v, own) { setupKeep('sandbuggy.setup', m => { const o = m[VEH.key] || {}; if (v === own) delete o[k]; else o[k] = v; if (Object.keys(o).length) m[VEH.key] = o; else delete m[VEH.key]; }); }
// a training under way has the car as it was (its workers too): it starts again with the car as it is
const setupChanged = () => { if (AI.training) { aiTrain(false); aiTrain(true); } return true; };
function setSplit(v) {                                               // the front's share of the torque, 0 to 1 in steps of 5 %
  if (!car.awd || !(v >= 0 && v <= 1)) return false;
  v = Math.round(v * 20) / 20; if (v === car.split) return true;
  car.split = v; setupKeep('sandbuggy.split', m => { if (v === (VEH.split ?? 0.5)) delete m[VEH.key]; else m[VEH.key] = v; });
  return setupChanged();
}
function setDrive(awd) {                                             // the front axle driven or not (not on the cars built one way)
  awd = !!awd; if (VEH.awdFixed) return false; if (awd === car.awd) return true;
  car.awd = awd; setupKeepOwn('awd', awd, !!VEH.awd);
  return setupChanged();
}
function setPressure(i) {                                            // one of the car's pressures
  if (!PRESSURES[i]) return false; if (i === car.pIdx) return true;
  car.pIdx = i; setupKeepOwn('p', i, VEH.pIdx);
  return setupChanged();
}
// what the tire model makes of a pressure: one wheel carrying its share of the car at rest, on the ground under the
// car as built (c: how packed, 0 fresh). The same sums as stepCar's: change them there, change them here.
function tireFigures(i = car.pIdx, c = 0) {
  const P = PRESSURES[i], n = car.wheels.length || 4, load = car.mass * G / n, R = car.R - P.defl;
  const SF = surfAtCell(cellIndex(car.pos.x, car.pos.z)), kEff = SF.k * (1 + SF.kComp * c);
  const pg = P.kpa * 1000 * 0.8 + 12000, b = P.w, len = Math.min(load / pg / b, 0.3), pEff = load / (b * Math.max(len, 0.05));
  const sink = SF.rigid ? 0 : Math.min(pEff / kEff, 0.28);
  const drag = SF.rc * b * kEff * sink * sink * 0.5 + 0.02 * load + load * 0.6 * (sink / R) ** 2;      // (rolling through it, per wheel)
  const grip = load * (SF.tanPhi + SF.tanPhiComp * c) + SF.coh * b * Math.max(len, 0.15);
  return { psi: P.psi, kpa: P.kpa, width: b, length: len, sink, drag: drag * n, grip: grip / load, radius: R, squash: P.defl, load, ground: SF.name, rigid: !!SF.rigid };
}
const SETUP = {
  get() {
    const zs = car.wheels.map(w => w.hp.z), zf = Math.max(...zs), zr = Math.min(...zs);
    let kw = 0; for (let r = ENG.idle; r <= ENG.limiter; r += 100) kw = Math.max(kw, engineTorque(r) * r * TAU / 60000);
    return { key: VEH.key, name: VEH.name, awd: car.awd, awdFixed: !!VEH.awdFixed, split: car.split, ownSplit: VEH.split ?? 0.5, ownAwd: !!VEH.awd,
      p: car.pIdx, ownP: VEH.pIdx, pressures: PRESSURES.map(P => ({ psi: P.psi, kpa: P.kpa })), frontWeight: zf > zr ? -zr / (zf - zr) : 0.5, power: kw, mass: car.mass };
  },
  split: setSplit, drive: setDrive, pressure: setPressure, figures: tireFigures,
};
car.pIdx = carPressure(VEH); car.awd = carDrive(VEH); car.split = carSplit(VEH);     // (the car the sim starts on)
function switchVehicle(key) {
  if (!VEHICLE_LIST[key]) return;
  const V = VEHICLES[key] || (VEHICLES[key] = makeRoadVehicle(key));
  if (MODELS[key]) loadModel(V);
  applySavedPaint(V);
  if (V === VEH) return;
  const yaw = Math.atan2(fwd.x, fwd.z) || 0;
  repairCar();                                  // puts back thrown parts and dents of the vehicle we leave
  VIS.visible = false;
  VEH = V; VIS = V.vis; VIS.visible = true;
  Object.assign(car, { mass: V.mass, R: V.R, REST: V.REST, K: V.K, CB: V.CB, CR: V.CR, Iw: V.Iw, wheels: V.wheels, hull: V.hull });
  car.I.copy(V.I);
  ENG = V.eng; PRESSURES = V.pressures; car.pIdx = carPressure(V); car.awd = carDrive(V); car.split = carSplit(V);
  [CAR_HW, CAR_ZF, CAR_ZR] = V.box;
  car.hullC = new Uint8Array(car.hull.length);
  for (const W of car.wheels) { W.toe = 0; W.camber = 0; W.omega = 0; W.t = car.REST; W.comp = 0; W.contact = false; }
  Object.assign(car.eng, { gear: 1, rpm: ENG.idle, cut: false, shiftT: 0, reverse: false });
  car.throttle = 0;
  audio?.node.port.postMessage({ cfg: SOUNDS[V.sound] });
  if (!MP.on) try { localStorage.setItem('sandbuggy.vehicle', V.key); } catch (e) { }
  if (TRACK) resetCar(car.pos.x, car.pos.z, yaw);
  dmgKey = '';
  markVehicle();
}

// lights and exhaust flames of the road cars
function updateCarRig(dt) {
  const b = VEH.built, braking = input.brake > 0 && !car.eng.reverse && car.vel.dot(fwd) > 0.5;
  b.M.tail.emissiveIntensity = braking ? 3.2 : 0.6;
  b.M.rev.emissiveIntensity = car.eng.reverse ? 2.6 : 0;
  rig.flameT = Math.max(0, rig.flameT - dt);
  b.M.flame.opacity = rig.flameT > 0 ? 0.85 * rig.flameT / 0.09 : 0;
  for (const f of b.flames) f.scale.set(1, 0.6 + Math.random() * 0.8, 1);
}

// vehicle picker in the start menu
function markVehicle() { for (const b of document.querySelectorAll('#vehBtns button')) b.classList.toggle('on', b.dataset.v === VEH.key); }
{
  const box = document.getElementById('vehBtns');
  for (const [k, v] of Object.entries(VEHICLE_LIST)) {
    const b = document.createElement('button'); b.dataset.v = k; b.innerHTML = `${v.name}<small>${v.blurb}</small>`;
    b.addEventListener('click', () => { switchVehicle(k); markVehicle(); startAudio(); });
    box.appendChild(b);
  }
  markVehicle();
}


/* =====================================================================
   MAIN LOOP
   ===================================================================== */
/* =====================================================================
   BOTS: up to 4 computer-driven cars racing the course (N key)
   They follow the racing line on rails with a speed profile from the corner radii and the surface grip,
   keep to lanes, pull out to pass, and bump the player's car physically.
   ===================================================================== */
const BOT_CARS = ['rs6', 'supra', 'cayenne', 'bmw7', 'quattroporte', 'x7', 'navigator', 'p911', 'sl63', 'xjr', 'gt500', 'x5m', 'gle63', 'cayennets', 'arteonr'], BOT_PAINT = [0xe0b010, 0x4a90c8, 0x6fae1c, 0x4b1f6f];
const BOT_SKILL = [0.93, 0.97, 0.9, 1.0], BOT_LW = 2.5;
const BOTS = { n: 0, list: [], hold: 0, path: null, pIdx: 0, order: [], el: null, T: 0 };
if (!MP.on) try { BOTS.n = clamp(+(localStorage.getItem('sandbuggy.bots') || 0) | 0, 0, 4); } catch (e) { }
function botPath() {
  const key = TRACK; if (BOTS.path && BOTS.path.key === key && BOTS.path.road === ROAD && BOTS.path.base === COURSE.base && BOTS.path.bank === TRACK.bank) return BOTS.path;
  const len = TRACK.len, n = Math.max(8, Math.round(len)), ds = len / n, P = [];
  for (let i = 0; i < n; i++) { const u = i / n, p = TRACK.curve.getPointAt(u), t = TRACK.curve.getTangentAt(u).setY(0).normalize(); P.push({ x: p.x, z: p.z, tx: t.x, tz: t.z, k: 0, v: 0, acc: 3, brk: 5 }); }
  const kr = [];
  for (let i = 0; i < n; i++) { const a = P[(i - 3 + n) % n], b = P[(i + 3) % n]; kr.push(Math.asin(clamp(a.tx * b.tz - a.tz * b.tx, -1, 1)) / (6 * ds)); }   // signed curvature, + = turning right of the tangent
  for (let i = 0; i < n; i++) { let s = 0; for (let j = -4; j <= 4; j++) s += kr[(i + j + n) % n]; P[i].k = -s / 9; }
  for (let i = 0; i < n; i++) {
    const q = P[i], gi = clamp(Math.round((q.x + HALF) / CELL), 0, N), gj = clamp(Math.round((q.z + HALF) / CELL), 0, N), m = M[gj * V + gi];
    const tar = m === 3 || (ROAD && RM[gj * V + gi]), earth = !tar && (m === 2 || (m !== 1 && COURSE.base === 'earth'));
    const [lat, brk, acc, top] = tar ? [8.2, 7.5, 4.2, 50] : earth ? [5.2, 5.2, 3.0, 34] : [3.8, 4.2, 2.2, 25];
    const bank = Math.abs(TRACK.bank?.[Math.round(i / n * (TRACK.pts.length - 1))] || 0);   // tan of the banking: the ground helps turn
    q.acc = acc; q.brk = brk; q.top = top; q.v = Math.min(top, Math.sqrt((lat + 9.81 * bank) / Math.max(Math.abs(q.k), 1e-4)));
  }
  for (let pass = 0; pass < 2; pass++) for (let i = n - 1; i >= 0; i--) { const q = P[i], nx = P[(i + 1) % n]; q.v = Math.min(q.v, Math.sqrt(nx.v * nx.v + 2 * q.brk * ds)); }
  const g0 = TRACK.gates[0]; let s0 = 0, bd = Infinity; P.forEach((q, i) => { const e = (q.x - g0.p.x) ** 2 + (q.z - g0.p.z) ** 2; if (e < bd) { bd = e; s0 = i; } });
  return BOTS.path = { key, road: ROAD, base: COURSE.base, bank: TRACK.bank, P, n, ds, len, s0: s0 * ds };
}
function clearBots() { for (const b of BOTS.list) { scene.remove(b.V.vis); } BOTS.list.length = 0; }
function setBots(n) {
  BOTS.n = clamp(n | 0, 0, 4); try { localStorage.setItem('sandbuggy.bots', BOTS.n); } catch (e) { }
  document.getElementById('botBtn').textContent = '🏁 Bots: ' + BOTS.n;
  clearBots();
  const pool = BOT_CARS.filter(k => k !== VEH.key);
  for (let i = 0; i < BOTS.n; i++) {
    const key = pool[i % pool.length], Vb = makeRoadVehicle(key); Vb.vis.visible = true; setPaint(Vb, BOT_PAINT[i], false);
    BOTS.list.push({ V: Vb, i, name: ROAD_CARS[key].short || ROAD_CARS[key].name, s: 0, dist: 0, lat: 0, home: 0, latT: 0, v: 0, y: 0, yaw: 0, pitch: 0, roll: 0, spin: 0, steer: 0, skill: BOT_SKILL[i] * (0.99 + Math.random() * 0.02),
      pos: new THREE.Vector3(), q: new THREE.Quaternion(), fx: 0, fz: 1, hx: 0, hz: 1, lv: 0, yo: 0, wy: 0, bump: 0, col: '#' + BOT_PAINT[i].toString(16).padStart(6, '0') });
  }
  restartRun();
}
// starting grid: two bots ahead of the player, two behind, in two columns
function gridBots() {
  BOTS.pIdx = -1; BOTS.order = [];
  if (!BOTS.list.length) { BOTS.hold = 0; return; }
  const Pt = botPath(); BOTS.hold = 3.4; BOTS.cd = -1; BOTS.lap0 = lap.lapNo;
  BOTS.list.forEach((b, i) => { const back = i < 2 ? -6 : -22; b.home = (i % 2 ? 1 : -1) * 1.9; b.lat = b.latT = b.home; b.dist = back; b.s = ((Pt.s0 + back) % Pt.len + Pt.len) % Pt.len; b.v = 0; b.bump = 0; b.y = 0; b.lv = b.yo = b.wy = 0; poseBot(b, Pt, 0, true); });
}
const bE = new THREE.Euler(0, 0, 0, 'YXZ');
function poseBot(b, Pt, dt, snap) {
  const f = b.s / Pt.ds, i = Math.floor(f) % Pt.n, a = Pt.P[i], c = Pt.P[(i + 1) % Pt.n], t = f - Math.floor(f);
  const tx = lerp(a.tx, c.tx, t), tz = lerp(a.tz, c.tz, t), tl = Math.hypot(tx, tz) || 1, fx = tx / tl, fz = tz / tl, nx = -fz, nz = fx;
  const x = lerp(a.x, c.x, t) + nx * b.lat, z = lerp(a.z, c.z, t) + nz * b.lat, k = lerp(a.k, c.k, t);
  b.fx = fx; b.fz = fz; b.k = k;
  const S = ROAD_CARS[b.V.key], yRef = snap ? 1e3 : b.y + 0.8, hl = S.L * 0.3, hw = 0.75;
  const gF = surfaceAt(x + fx * hl, z + fz * hl, yRef), gR = surfaceAt(x - fx * hl, z - fz * hl, yRef), gL = surfaceAt(x + nx * hw, z + nz * hw, yRef), gRt = surfaceAt(x - nx * hw, z - nz * hw, yRef);
  const g = (gF + gR + gL + gRt) / 4, e = snap ? 1 : 1 - Math.exp(-10 * dt);
  b.y = snap ? g : lerp(b.y, g, 1 - Math.exp(-14 * dt));
  const W0 = b.V.wheels[0], tRest = b.V.REST - b.V.mass * 9.81 / 4 / b.V.K, lift = b.V.R - W0.hp.y + tRest;
  b.pitch = lerp(b.pitch, Math.atan2(gR - gF, 2 * hl), e); b.roll = lerp(b.roll, Math.atan2(gL - gRt, 2 * hw) + clamp(k * b.v * b.v * 0.004, -0.06, 0.06), e);
  b.yaw = Math.atan2(fx, fz) + b.yo; b.hx = Math.sin(b.yaw); b.hz = Math.cos(b.yaw);     // (yo: knocked off its line's heading)
  b.pos.set(x, b.y + lift, z); b.q.setFromEuler(bE.set(b.pitch, b.yaw, b.roll));
  b.steer = lerp(b.steer, clamp(Math.atan(S.L * 0.6 * k), -0.5, 0.5), e); b.spin += b.v / b.V.R * dt; b.tRest = tRest;
}
function drawBot(b) {
  const G = b.V.vis; G.position.copy(b.pos); G.quaternion.copy(b.q);
  for (const W of b.V.wheels) { W.holder.position.set(W.hp.x, W.hp.y - (b.tRest ?? b.V.REST), W.hp.z); W.holder.rotation.set(0, W.front ? b.steer : 0, 0); W.spinner.rotation.x = b.spin; }
}
/* Car against car (#322), for the bots, the other players' cars and the autopilot's rival alike. Each car is a capsule on
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
function playerOnPath(Pt) {
  // nearest path sample to the player, searched near the last one so crossings of the course do not confuse it
  const P = Pt.P, n = Pt.n; let bi = BOTS.pIdx, bd = Infinity;
  const scan = (i) => { const q = P[((i % n) + n) % n], e = (q.x - car.pos.x) ** 2 + (q.z - car.pos.z) ** 2; if (e < bd) { bd = e; bi = ((i % n) + n) % n; } };
  if (BOTS.pIdx < 0) for (let i = 0; i < n; i++) scan(i); else { const c = BOTS.pIdx; for (let i = c - 12; i <= c + 30; i++) scan(i); if (bd > 900) { bd = Infinity; for (let i = 0; i < n; i++) scan(i); } }
  BOTS.pIdx = bi; const q = P[bi];
  return { s: bi * Pt.ds, lat: (car.pos.x - q.x) * -q.tz + (car.pos.z - q.z) * q.tx, v: car.vel.x * q.tx + car.vel.z * q.tz };
}
function updateBots(dt) {
  if (!BOTS.list.length) return;
  const Pt = botPath(), len = Pt.len, wrap = d => { d %= len; if (d > len / 2) d -= len; if (d < -len / 2) d += len; return d; };
  if (BOTS.hold > 0) {
    BOTS.hold -= dt; const now = BOTS.hold <= 0.4 ? 0 : Math.ceil(BOTS.hold - 0.4);
    if (now !== BOTS.cd) { BOTS.cd = now; flash(now ? String(now) : 'GO!', now ? '#fff' : '#7dff9a', 0.9); }
  }
  const me = playerOnPath(Pt), go = BOTS.hold <= 0.4;
  const ents = [{ s: me.s, lat: me.lat, v: Math.max(0, me.v), me: true }, ...BOTS.list];
  for (const b of BOTS.list) {
    const f = b.s / Pt.ds, q = Pt.P[Math.floor(f) % Pt.n], qa = Pt.P[(Math.floor(f) + Math.round(clamp(b.v * 0.25, 1, 12))) % Pt.n];
    let vt = go ? Math.min(q.v, qa.v + 1.5) * b.skill : 0, latT = b.home;
    for (const E of ents) {
      if (E === b) continue;
      const gap = wrap(E.s - b.s), dl = E.lat - b.lat;
      if (gap > 0 && gap < 7 + 0.7 * b.v && Math.abs(dl) < 2.3 && E.v < b.v + 3) {
        let side = dl <= 0 ? 1 : -1, tgt = E.lat + side * 2.5;
        if (Math.abs(tgt) > BOT_LW) { side = -side; tgt = E.lat + side * 2.5; }
        if (Math.abs(tgt) <= BOT_LW + 0.3) latT = clamp(tgt, -BOT_LW, BOT_LW);
        if (Math.abs(dl) < 2.0 && gap < 5.4 + 0.25 * b.v) vt = Math.min(vt, Math.max(0, E.v - (gap < 5 ? 2 : 0.3)));
      }
      if (!E.me && Math.abs(gap) < 4.8 && Math.abs(dl) < 1.9 && gap > 0) b.v = Math.min(b.v, Math.max(0, E.v - 0.5));   // never drive through another bot
    }
    b.latT = latT;
    if (b.bump > 0) { b.bump -= dt; vt = Math.min(vt, b.v); }
    const acc = q.acc * (1 - 0.75 * b.v / q.top) * (0.9 + 0.1 * b.skill);
    b.v += clamp(vt - b.v, -q.brk * 1.15 * dt, acc * dt); if (b.v < 0) b.v = 0;
    b.lat += clamp(b.latT - b.lat, -(0.5 + b.v * 0.08) * dt, (0.5 + b.v * 0.08) * dt);
    // knocked (#322): sliding across its line till the tires stop it, turned till it catches it
    if (b.lv || b.yo || b.wy) {
      b.lat = clamp(b.lat + b.lv * dt, -BOT_LW - 2, BOT_LW + 2); b.lv -= Math.sign(b.lv) * Math.min(Math.abs(b.lv), 7 * dt);
      b.wy += (-b.yo * 9 - b.wy * 5) * dt; b.yo = clamp(b.yo + b.wy * dt, -0.9, 0.9);
      if (Math.abs(b.lv) + Math.abs(b.yo) + Math.abs(b.wy) < 1e-3) b.lv = b.yo = b.wy = 0;
    }
    const d = b.v * dt; b.s = (b.s + d) % len; b.dist += d;
    poseBot(b, Pt, dt, false);
    // contact with our car (#322: ccSolve): the bot's push along its line goes to its speed, across it to lv, its turn to wy
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
  }
  // race order
  if ((BOTS.T += dt) > 0.2) {
    BOTS.T = 0;
    const rel = ((me.s - Pt.s0) % len + len) % len, mine = lap.started ? (lap.lapNo - (BOTS.lap0 || 0) - 1) * len + rel : wrap(me.s - Pt.s0);
    BOTS.order = [{ name: 'You', d: mine, me: true, col: '#ff3b30' }, ...BOTS.list.map(b => ({ name: b.name, d: b.dist, col: b.col }))].sort((a, b) => b.d - a.d);
    const pos = BOTS.order.findIndex(o => o.me), my = BOTS.order[pos].d;
    BOTS.el.innerHTML = `<div style="font-size:22px;font-weight:700">P${pos + 1} <span style="font-size:13px;font-weight:400;opacity:.8">of ${BOTS.order.length}</span></div>` +
      BOTS.order.map((o, i) => `<div style="${o.me ? 'font-weight:700' : ''}"><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${o.col};margin-right:6px"></span>${i + 1}. ${o.name}${o.me ? '' : ` <span style="opacity:.75">${o.d > my ? '+' : '−'}${Math.abs(o.d - my).toFixed(0)} m</span>`}</div>`).join('');
  }
}
function syncBots() {
  const show = BOTS.list.length > 0 && !ed.on;
  if ((BOTS.el.style.display !== 'none') !== show) BOTS.el.style.display = show ? 'block' : 'none';
  if (show) BOTS.el.style.top = (hud.offsetHeight + 24) + 'px';
  for (const b of BOTS.list) drawBot(b);
}
BOTS.el = document.createElement('div'); BOTS.el.className = 'panel'; BOTS.el.style.cssText = 'left:12px;top:240px;display:none;min-width:150px'; document.body.appendChild(BOTS.el);
{
  const b = document.createElement('button'); b.id = 'wxBtn'; b.title = 'Weather: clear, sunny with clouds, grey, light rain, sunset (O)';
  b.textContent = `${WEATHER.icon} ${WEATHER.name}`;
  document.getElementById('botBtn').after(b);
  b.addEventListener('click', e => {
    e.currentTarget.blur(); const keys = Object.keys(WEATHERS), k = keys[(keys.indexOf(weatherKey) + 1) % keys.length];
    setWeather(k); flash(WEATHERS[k].name, '#fff', 1.5);
  });
}
document.getElementById('botBtn').addEventListener('click', e => { e.currentTarget.blur(); if (ed.on || rp.on) return; setBots((BOTS.n + 1) % 5); flash(BOTS.n ? `${BOTS.n} bot${BOTS.n > 1 ? 's' : ''}: race starts in 3` : 'Bots off', '#fff', 1.5); });

function syncVisual() {
  VIS.position.copy(car.pos); VIS.quaternion.copy(car.q);
  const R = car.R - PRESSURES[car.pIdx].defl;
  for (const W of car.wheels) {
    W.holder.position.set(W.hp.x, W.hp.y - W.t, W.hp.z);
    W.holder.rotation.set(0, (W.front ? car.steer : 0) + W.toe, W.camber);
    W.spinner.rotation.x = W.spin;
  }
  const fwdL = v1.set(0, 0, 1).applyQuaternion(car.q);
  if (ed.on) sun.target.position.copy(orbit.target); else sun.target.position.copy(car.pos).addScaledVector(fwdL, 6);
  sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 80);
}

// 'sand' / 'earth' = off-road course on that ground (the dunes / the countryside); 'road' = the course is paved,
// through the countryside. Another landscape or road bed rebuilds the world: true when it did.
function setSurface(name) {
  const road = name === 'road';
  SURF = road ? SURFACES.earth : SURFACES[name] || SURFACES.sand;
  const changed = road !== ROAD || (road || SURF === SURFACES.earth) !== COUNTRY;
  ROAD = road; COURSE.road = road;
  COURSE.base = SURF === SURFACES.earth ? 'earth' : 'sand'; saveCourse();
  if (!MP.on && !MP.edit) try { localStorage.setItem('sandbuggy.surface', road ? 'road' : COURSE.base); } catch (e) { }
  pMat.uniforms.dustCol.value.setRGB(...SURF.dust);
  if (changed && TRACK.gates[0].posts) { clearSkids(); regenerateWorld(); return true; }   // other hills, or the road bed graded differently
  for (const ch of chunks.values()) ch.update();
  updateFar();
  return false;
}
const groundName = () => ROAD ? 'Road' : SURF.name;
document.querySelectorAll('#menu button[data-s]').forEach(bt => bt.addEventListener('click', () => {
  setSurface(bt.dataset.s); document.getElementById('menu').style.display = 'none'; startAudio();
}));

// ---------- a saved network's preview (#336): /sim/index.html?net=<id>, the networks page's Watch it drive ----------
// AI.preview: { id, name, by, cfg } while it shows (cfg: the lab's settings before, to put back); PV: its bar
const PV = { el: null, id: !MP.on && !MP.edit && !AI_WK ? MPQ.get('net') : null };
const PV_API = location.pathname.replace(/\/sim\/[^/]*$/, '') + '/api/networks';
async function aiPreviewStart(id) {
  const menu = document.getElementById('menu'); menu.style.display = 'none';
  pvBar('Loading the network…');
  try {
    const r = await fetch(`${PV_API}/${encodeURIComponent(id)}`), b = await r.json().catch(() => ({}));
    if (!r.ok || !b.network) throw new Error(b.error || `${r.status} ${r.statusText}`);
    const n = b.network;
    // its ground and car, then its track (the room map with its course; it learnt nothing else)
    if (['sand', 'earth', 'road'].includes(n.ground) && n.ground !== (ROAD ? 'road' : COURSE.base)) setSurface(n.ground);
    if (VEHICLE_LIST[n.vehicle] && n.vehicle !== VEH.key) switchVehicle(n.vehicle);
    for (let k = 0; !TRK.list && k < 100; k++) await new Promise(res => setTimeout(res, 100));
    const t = TRK.list?.find(x => x.key === n.course) || null, own = !t, at = t || TRK.list?.find(x => x.id === 'figure-8');
    if (at && trkNow() !== at.id) { TRK.fresh = false; await trkPick(at.id); }
    if (!aiPreviewLoad(n)) throw new Error('it does not fit this sim');
    menu.style.display = 'none';
    aiDrive(true);
    pvBar(null, n, own ? (at ? `trained on a course of its maker's own: here on ${at.name}` : 'trained on a course of its maker\'s own') : at.name);
  } catch (e) { console.warn('preview:', e); pvBar(`That network could not load: ${e.message}`); }
}
// its settings (#351: saved with it, the server's d.config) while it drives: the lab's and the car's setup as in the exam
// that timed it, or it drives another lap than its best. The visitor's own go back at the end (cfg.lab) and nothing of it
// is kept: the lab's not by aiKeepConfig, the setup set on the car (not by setupKeep). false: it has none (saved before #351)
function aiPreviewConfig(c, cfg) {
  const L = cfg.lab || (cfg.lab = { ai: { ...AI_CFG }, pen: { ...AI_PEN }, gens: AI.gens, stopAfter: AI.stopAfter });
  Object.assign(AI_CFG, L.ai); Object.assign(AI_PEN, L.pen);          // (another network before it: none of its settings)
  car.pIdx = carPressure(VEH); car.awd = carDrive(VEH); car.split = carSplit(VEH);
  if (!c || typeof c !== 'object' || !c.cfg || typeof c.cfg !== 'object') return false;
  aiConfigRead({ ...c.cfg, pen: c.pen, gens: AI.gens, stopAfter: AI.stopAfter, h: AI.h, inputs: AI.inputs, hb: AI.hb, kp: AI.kp, ks: AI.ks, nb: AI.nb });
  for (const k of AI_CFG_LOCAL) AI_CFG[k] = L.ai[k];                   // (this machine's: the visitor's)
  const S = c.setup;
  if (S && S.vehicle === VEH.key) {
    if (typeof S.awd === 'boolean' && !VEH.awdFixed) car.awd = S.awd;
    if (car.awd && Number.isFinite(S.split) && S.split >= 0 && S.split <= 1) car.split = Math.round(S.split * 20) / 20;
    if (Number.isInteger(S.p) && PRESSURES[S.p]) car.pIdx = S.p;
  }
  return true;
}
// its weights in place of the lab's, for now: nothing saved, the lab's settings in this browser as they were
function aiPreviewLoad(d) {
  const arr = (a, n) => Array.isArray(a) && a.length === n && a.every(Number.isFinite);
  const ins = Array.isArray(d?.inputs) && d.inputs.every(id => AI_INPUTS.some(q => q.id === id)) ? d.inputs : null;
  if (!ins || !AI_SIZES.includes(d.h) || !arr(d.w, aiShape(ins, !!d.handbrake, d.h).np)) return false;
  let kept = null; try { kept = localStorage.getItem('sandbuggy.ai.config'); } catch (e) { }
  const cfg = AI.preview?.cfg || { h: AI.h, inputs: AI.inputs.slice(), hb: AI.hb, kp: AI.kp, ks: AI.ks, nb: AI.nb, kept };
  if (AI.training) aiTrain(false);
  AI.preview = { id: d.id, name: d.name, by: d.by, cfg };
  AI.drive = false; AI.h = d.h; aiSetInputs(ins, !!d.handbrake, true, !!d.keyPedals, !!d.keySteering, !!d.noBrake); aiLoad();
  AI.preview.withCfg = aiPreviewConfig(d.config, cfg);
  try { if (cfg.kept == null) localStorage.removeItem('sandbuggy.ai.config'); else localStorage.setItem('sandbuggy.ai.config', cfg.kept); } catch (e) { }
  const w = Float32Array.from(d.w);
  Object.assign(AI, { w, best: Float32Array.from(w), gen: d.gen | 0, bestFit: 0, bestLap: d.bestLap ?? null, hist: [], sinceBest: 0 });
  AI.ident = { id: d.id, name: String(d.name), creator: String(d.by || 'Driver'), sig: aiNetSig(w) };
  aiShow();
  return true;
}
// a network can get stuck (against a post, off the road, facing the wrong way): in a preview, still for 4 s, it starts
// again from the grid, so the preview never just stands there
setInterval(() => {
  if (!AI.preview || !AI.drive || window.__sim?.paused || document.hidden) { PV.still = 0; return; }
  PV.still = car.vel.length() < 1 ? (PV.still || 0) + 1 : 0;
  if (PV.still >= 4) { PV.still = 0; aiDrive(true); flash('Stuck: from the start again', '#9fd4ff', 1.8); }
}, 1000);
// ---------- watching a duel: ?mp=1&watch=1 in the page /duel/<track>/<ground>/<car> ----------
// The page is the room: course, ground, car, the human's lap as the ghost, then the network to drive ('watch'). Only the
// camera (C) and the sound (M) answer; the rest of the keys never reach the sim (no driving, no lab: nothing to take over).
MP.watch = MP.on && MPQ.get('watch') === '1';
if (MP.watch) {
  document.body.classList.add('watch');
  document.head.insertAdjacentHTML('beforeend', '<style>body.watch #uiRail,body.watch #aiPanel{display:none!important}</style>');
  const pass = e => e.ctrlKey || e.metaKey || e.altKey || e.code === 'KeyC' || e.code === 'KeyM';
  addEventListener('keydown', e => { if (!pass(e)) e.stopImmediatePropagation(); }, true);
  addEventListener('keyup', e => { if (!pass(e)) e.stopImmediatePropagation(); }, true);
}
function mpWatch(n) {
  if (!MP.watch) return;
  if (!aiPreviewLoad(n)) { flash('That network does not fit this sim', '#ffd88a', 6); mpPost({ t: 'watch', ok: false }); return; }
  aiDrive(true); mpPost({ t: 'watch', ok: true });
}
// its decisions, for the page's card (10 a second): what it sees (each input, raw and as the lab shows it), its hidden
// layer, its outputs and what was applied (the handbrake: asked, and let through by the rules)
setInterval(() => {
  if (!MP.watch || !AI.drive || !AI.lastCtl || document.hidden) return;
  const ins = AI.names.map((name, i) => [name, AI.shows[i] ? AI.shows[i](aiX[i]) : aiX[i].toFixed(2), aiX[i]]);   // (as the lab lists them)
  const c = AI.lastCtl;
  mpPost({ t: 'decision', dt: AI_DT, ins, hid: Array.from(aiHid.subarray(0, AI.h)), out: Array.from(aiY.subarray(0, AI.nOut)),
    ctl: { steer: c.steer, throttle: c.throttle, brake: c.brake, handbrake: !!c.handbrake, hbHeld: !!AI.hbHeld }, kmh: Math.round(car.vel.length() * 3.6) });
}, 100);
// it keeps driving (stuck: the preview's own restart from the grid, above)
setInterval(() => { if (MP.watch && AI.preview && !AI.drive && !AI.training && !window.__sim?.paused) aiDrive(true); }, 1000);
// back to this browser's own training, with its own settings
function aiPreviewEnd() {
  const P = AI.preview; if (!P) return;
  if (AI.drive) aiDrive(false);
  AI.preview = null; AI.ident = null;
  const c = P.cfg, L = c.lab;
  if (L) { Object.assign(AI_CFG, L.ai); Object.assign(AI_PEN, L.pen); AI.gens = L.gens; AI.stopAfter = L.stopAfter; car.pIdx = carPressure(VEH); car.awd = carDrive(VEH); car.split = carSplit(VEH); }
  AI.h = c.h; aiConfig(c.inputs, c.hb); AI.kp = c.kp; AI.ks = c.ks; AI.nb = c.nb; aiLoad(); aiShow();
  pvBar(null); flash('Your own training again', '#9fd4ff', 1.8);
}
// the bar: whose network drives, on what; or a message; or nothing
function pvBar(msg, n, where) {
  if (!PV.el) {
    PV.el = document.createElement('div'); PV.el.id = 'pvBar'; PV.el.className = 'panel';
    PV.el.style.cssText = 'left:50%;bottom:16px;transform:translateX(-50%);max-width:min(640px,calc(100vw - 32px));pointer-events:auto;display:none;z-index:6';
    document.body.appendChild(PV.el);
  }
  const el = PV.el, mk = (tag, text, css) => { const x = document.createElement(tag); if (text != null) x.textContent = text; if (css) x.style.cssText = css; return x; };
  if (!msg && !n) { el.style.display = 'none'; el.replaceChildren(); return; }
  el.style.display = 'block';
  if (msg) { el.replaceChildren(mk('span', msg)); return; }
  const close = mk('button', '✕', 'float:right;margin:0 0 0 12px;font:inherit;border:0;border-radius:6px;padding:3px 8px;cursor:pointer;color:#fff;background:#ffffff26');
  close.title = 'Stop the preview: your own car and training'; close.addEventListener('click', e => { e.currentTarget.blur(); aiPreviewEnd(); });
  const car = ROAD_CARS[n.vehicle]?.name || (n.vehicle === 'buggy' ? 'Dune buggy' : n.vehicle);
  el.replaceChildren(close, mk('b', `Watching “${n.name}” drive`), mk('div', `by ${n.by || 'a driver'} · ${car} on ${where}, ${groundName().toLowerCase()} · ${n.weights} weights${n.h ? `, ${n.h} hidden` : ''} · ${n.bestLap != null ? 'its best lap ' + fmt(n.bestLap) : 'no lap yet'}${AI.preview?.withCfg ? ', with the settings it was timed with' : ' · saved without its settings: it drives with this browser\'s'}`, 'opacity:.8;font-size:12px;margin-top:2px'),
    mk('div', 'Any driving key takes the wheel · I opens the lab', 'opacity:.6;font-size:11px;margin-top:4px'));
}

// ---------- the tracks (#329): the race rooms' maps, to drive alone (the start menu's first row) ----------
// TRK.list: the server's ([{ id, name, v, key, wp, length, bridges }]; null until it answers, [] if it can't);
// carsim.track: { id, key } the track last loaded (key: courseKey() then); carsim.course.mine: this browser's own
// course, kept while it drives a track. (Not 'sandbuggy.': the autopilot's workers boot with a copy of those.)
const TRK = { list: null, busy: '', el: null, fresh: false };
const TRK_API = location.pathname.replace(/\/sim\/[^/]*$/, '') + '/api/tracks';
const trkGet = (k, d = null) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch (e) { return d; } };
const trkSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
// the track the sim is on ('': its own course)
function trkNow() {
  const k = courseKey(), st = trkGet('carsim.track');
  if (st && st.key === k && (!TRK.list || TRK.list.some(t => t.id === st.id))) return st.id;
  return TRK.list?.find(t => t.key === k)?.id ?? '';
}
// this browser's own course: the sim's, if it is on no track; else the one kept aside
const trkMine = () => !trkNow() ? COURSE : trkGet('carsim.course.mine');
// a course as COURSE (checked as the editor's Import does), on the ground the sim is on
function trkCourse(c) {
  const pts = a => Array.isArray(a) ? a.filter(b => b && isFinite(b.x) && isFinite(b.z)).map(b => ({ x: +b.x, z: +b.z })) : [];
  const C = c && Array.isArray(c.wp) && c.wp.length >= 3
    ? { wp: c.wp.map(([x, z]) => [+x, +z]), bank: bankOf(c.bank), level: levelOf(c.level), even: evenOf(c.even), grade: gradeOf(c.grade), ops: Array.isArray(c.ops) ? c.ops : [], bridges: pts(c.bridges), noBridge: pts(c.noBridge) }
    : { wp: DEFAULT_WP.map(p => p.slice()), ops: [], bridges: [], noBridge: [] };
  C.base = ROAD || SURF === SURFACES.earth ? 'earth' : 'sand'; C.road = ROAD;
  return C;
}
// drive track id ('': this browser's own course), built now
async function trkPick(id) {
  if (TRK.busy || ed.on || id === trkNow()) return;
  const t = TRK.list?.find(x => x.id === id);
  if (id && !t) return;
  TRK.busy = id || 'mine'; trkShow();
  try {
    let c;
    if (id) {
      const r = await fetch(`${TRK_API}/${encodeURIComponent(id)}?v=${t.v}`);
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.error || `${r.status} ${r.statusText}`);
      c = b.track.course;
    } else if (!(c = trkGet('carsim.course.mine'))) return;
    if (ed.on) return;
    if (id && !trkNow() && !TRK.fresh && !trkSet('carsim.course.mine', COURSE)) { flash('Browser storage is full: Export your course first (course editor)', '#ff8a7a', 3); return; }
    COURSE = trkCourse(c); SURF = SURFACES[COURSE.base];
    saveCourse(); trkSet('carsim.track', id ? { id, key: courseKey() } : null);
    await new Promise(r => setTimeout(r, 20));                         // (the card says so before the build holds the page)
    clearSkids(); regenerateWorld();
    if (document.getElementById('menu').style.display === 'none') flash(id ? t.name : 'Your course', '#7dff9a', 1.8);   // (in the menu: its card says so)
  } catch (e) { console.warn('tracks:', e); flash(`That track could not load: ${e.message}`, '#ff8a7a', 3); }
  finally { TRK.busy = ''; TRK.fresh = false; trkShow(); }
}
// a course's outline, as the minimap draws it (+x to the left, +z up): a closed curve through its waypoints
function trkSvg(wp) {
  const W = 120, H = 72, pad = 7, P0 = wp.map(([x, z]) => [-x, -z]);
  const xs = P0.map(p => p[0]), ys = P0.map(p => p[1]), x0 = Math.min(...xs), y0 = Math.min(...ys);
  const k = Math.min((W - 2 * pad) / Math.max(1, Math.max(...xs) - x0), (H - 2 * pad) / Math.max(1, Math.max(...ys) - y0));
  const ox = (W - (Math.max(...xs) - x0) * k) / 2, oy = (H - (Math.max(...ys) - y0) * k) / 2;
  const P = P0.map(([x, y]) => [ox + (x - x0) * k, oy + (y - y0) * k]), n = P.length, f = v => v.toFixed(1);
  let d = `M${f(P[0][0])} ${f(P[0][1])}`;
  for (let i = 0; i < n; i++) {
    const a = P[(i - 1 + n) % n], b = P[i], c = P[(i + 1) % n], e = P[(i + 2) % n];
    d += `C${f(b[0] + (c[0] - a[0]) / 6)} ${f(b[1] + (c[1] - a[1]) / 6)} ${f(c[0] - (e[0] - b[0]) / 6)} ${f(c[1] - (e[1] - b[1]) / 6)} ${f(c[0])} ${f(c[1])}`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${d}Z" class="bed"/><path d="${d}Z" class="ln"/><circle cx="${f(P[0][0])}" cy="${f(P[0][1])}" r="3.2" class="st"/></svg>`;
}
const trkLen = wp => wp.reduce((d, p, i) => d + Math.hypot(wp[(i + 1) % wp.length][0] - p[0], wp[(i + 1) % wp.length][1] - p[1]), 0);
const trkKm = m => `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
// the menu's row: the tracks, then this browser's own course (if it has one apart from them)
function trkShow() {
  if (!TRK.el) return;
  const grid = TRK.el.querySelector('.trkGrid'), now = trkNow(), mine = trkMine(), note = TRK.el.querySelector('p');
  if (!TRK.list) { grid.innerHTML = '<span class="trkWait">Loading the tracks…</span>'; return; }
  const cards = TRK.list.map(t => ({ id: t.id, name: t.name, wp: t.wp, sub: `${trkKm(t.length)}${t.bridges ? ` · ${t.bridges} bridge${t.bridges > 1 ? 's' : ''}` : ''}` }));
  if (mine?.wp?.length >= 3) cards.push({ id: '', name: 'Your course', wp: mine.wp, sub: `${trkKm(trkLen(mine.wp))} · the course editor's`, own: true });
  grid.innerHTML = cards.map(c => `<button type="button" class="trk${c.id === now ? ' on' : ''}${c.own ? ' own' : ''}" data-t="${c.id}"${TRK.busy ? ' disabled' : ''}>${trkSvg(c.wp)}<b></b><small>${TRK.busy === (c.id || 'mine') ? 'Building the track…' : c.sub}</small></button>`).join('');
  grid.querySelectorAll('button').forEach((b, i) => { b.querySelector('b').textContent = cards[i].name; b.addEventListener('click', () => { b.blur(); trkPick(b.dataset.t); }); });
  note.textContent = TRK.list.length ? 'The race rooms\' tracks, and yours from the course editor. Each keeps its own best laps and trainings.' : 'The tracks could not be loaded: this is the course in this browser (E edits it).';
}
async function trkLoad() {
  try {
    const r = await fetch(TRK_API), b = await r.json();
    if (!r.ok || !Array.isArray(b.tracks)) throw new Error(b.error || r.status);
    TRK.list = b.tracks;
  } catch (e) { console.warn('tracks:', e); TRK.list = TRK.list || []; }
  trkShow();
  // never a course of its own: the rooms' figure-8, as the leaderboard has it (while the menu is still up)
  if (TRK.fresh && document.getElementById('menu').style.display !== 'none' && TRK.list.some(t => t.id === 'figure-8') && !trkNow()) trkPick('figure-8');
  else TRK.fresh = false;
}
if (!MP.on && !MP.edit && !AI_WK) {                                // (not the autopilot's workers: no page, their course is the tab's)
  const menu = document.getElementById('menu'), card = menu.querySelector('.card');
  TRK.el = document.createElement('div'); TRK.el.id = 'trkSec';
  TRK.el.innerHTML = `<h2>${MPQ.get('lab') === '1' ? 'Choose the track it learns' : 'Choose the track'}</h2><p></p><div class="trkGrid"></div>`;
  card.querySelector('h2')?.before(TRK.el);
  TRK.fresh = !localStorage.getItem('sandbuggy.course') && !trkGet('carsim.track');
  trkLoad();
  // the menu again (the rail's Track, car and ground): the list as it is now
  let was = menu.style.display;
  new MutationObserver(() => { const d = menu.style.display; if (d !== 'none' && was === 'none') trkLoad(); was = d; }).observe(menu, { attributes: true, attributeFilter: ['style'] });
}
if (PV.id && /^[a-z0-9]{12}$/.test(PV.id)) aiPreviewStart(PV.id);      // (#336)

/* ---------- replays: the last 90 s of driving, recorded at 30 Hz ---------- */
const RP_MAX = 10800, rp = { buf: [], on: false, t: 0, speed: 1, paused: false, save: null, lastRec: -1, el: null, cam: 0 };
function recordFrame() {
  if (simTime - rp.lastRec < 1 / 30 - 1e-6) return; rp.lastRec = simTime;
  const E = car.eng;
  rp.buf.push({ t: simTime, bots: BOTS.list.length ? BOTS.list.map(b => [b.pos.x, b.pos.y, b.pos.z, b.q.x, b.q.y, b.q.z, b.q.w, b.spin, b.steer]) : null, veh: VEH.key, p: car.pos.toArray(), q: car.q.toArray(), v: car.vel.toArray(), steer: car.steer, rpm: E.rpm, gear: E.gear, rev: E.reverse, load: E.load, cut: E.cut, thr: car.throttle,
    w: car.wheels.map(W => [W.t, W.spin, W.contact ? 1 : 0, W.slipSpeed || 0, W.sink || 0, W.slip || 0, W.surf, W.deck, W.toe, W.camber]) });
  if (rp.buf.length > RP_MAX) rp.buf.splice(0, rp.buf.length - RP_MAX);
}
function startReplay() {
  if (rp.buf.length < 30) { flash('Nothing to replay yet: drive first', '#ffd88a', 1.8); return; }
  const E = car.eng;
  rp.save = { veh: VEH.key, pos: car.pos.clone(), q: car.q.clone(), vel: car.vel.clone(), w: car.w.clone(), steer: car.steer, throttle: car.throttle,
    eng: { ...E }, wheels: car.wheels.map(W => ({ t: W.t, spin: W.spin, omega: W.omega, contact: W.contact, slipSpeed: W.slipSpeed, sink: W.sink, slip: W.slip, surf: W.surf, deck: W.deck, comp: W.comp, toe: W.toe, camber: W.camber })), cam: camMode, fov: camera.fov };
  rp.on = true; rp.paused = false; rp.speed = 1; rp.t = Math.max(rp.buf[0].t, rp.buf[rp.buf.length - 1].t - 30); rp.stopAt = null;
  const LL = rp.lastLap; if (LL && LL.a >= rp.buf[0].t - 0.5) { rp.t = Math.max(rp.buf[0].t, LL.a - 1); rp.stopAt = LL.b + 1.5; }   // a whole lap is on tape: show it
  tv.u = -1; setCamMode(camMode === 3 ? 6 : camMode);              // keep the camera you were using; C changes it
  rp.el.style.display = 'block';
}
function stopReplay() {
  if (!rp.on) return;
  const S = rp.save; rp.on = false; rp.el.style.display = 'none';
  if (VEH.key !== S.veh) showVehicle(S.veh);
  car.pos.copy(S.pos); car.q.copy(S.q); car.vel.copy(S.vel); car.w.copy(S.w); car.steer = S.steer; car.throttle = S.throttle; Object.assign(car.eng, S.eng);
  car.wheels.forEach((W, i) => Object.assign(W, S.wheels[i]));
  setCamMode(S.cam === 6 || S.cam === 3 ? 0 : S.cam); camera.fov = 62; camera.updateProjectionMatrix();
  acc = 0;
}
// only the look of another vehicle (a replay that crosses a vehicle switch)
function showVehicle(key) { const V = VEHICLES[key]; if (!V) return; VIS.visible = false; VEH = V; VIS = V.vis; VIS.visible = true; car.wheels = V.wheels; car.R = V.R; car.REST = V.REST; ENG = V.eng; PRESSURES = V.pressures; }
function replayKey(e) {
  const t0 = rp.buf[0].t, t1 = rp.buf[rp.buf.length - 1].t;
  if (e.code === 'Space') { rp.paused = !rp.paused; e.preventDefault(); }
  if (e.code === 'ArrowLeft') rp.t = Math.max(t0, rp.t - 5);
  if (e.code === 'ArrowRight') rp.t = Math.min(t1, rp.t + 5);
  if (e.code === 'ArrowUp') rp.speed = Math.min(2, rp.speed * 2);
  if (e.code === 'ArrowDown') rp.speed = Math.max(0.125, rp.speed / 2);
  if (e.code === 'Home') { rp.t = t0; rp.stopAt = null; }
  if (e.code === 'KeyL' && rp.lastLap && rp.lastLap.a >= t0 - 0.5) { rp.t = Math.max(t0, rp.lastLap.a - 1); rp.stopAt = rp.lastLap.b + 1.5; rp.paused = false; }
  if (e.code === 'Escape') stopReplay();
}
const rqA = new THREE.Quaternion(), rqB = new THREE.Quaternion();
function playReplay(dt) {
  const B = rp.buf, t0 = B[0].t, t1 = B[B.length - 1].t;
  if (!rp.paused) rp.t += dt * rp.speed;
  if (rp.stopAt != null && !rp.paused && rp.t >= rp.stopAt) { rp.t = rp.stopAt; rp.paused = true; rp.stopAt = null; }
  if (rp.t >= t1) { rp.t = t1; rp.paused = true; }
  let lo = 0, hi = B.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (B[m].t <= rp.t) lo = m; else hi = m; }
  const A = B[lo], C = B[hi], f = C.t > A.t ? clamp((rp.t - A.t) / (C.t - A.t), 0, 1) : 0;
  if (A.veh !== VEH.key) showVehicle(A.veh);
  car.pos.fromArray(A.p).lerp(v1.fromArray(C.p), f);
  car.q.copy(rqA.fromArray(A.q)).slerp(rqB.fromArray(C.q), f);
  car.vel.fromArray(A.v).lerp(v1.fromArray(C.v), f);
  car.steer = lerp(A.steer, C.steer, f); car.throttle = A.thr;
  Object.assign(car.eng, { rpm: lerp(A.rpm, C.rpm, f), gear: A.gear, reverse: A.rev, load: A.load, cut: A.cut });
  car.wheels.forEach((W, i) => { const a = A.w[i], c = C.w[i] || a; if (!a) return;
    W.t = lerp(a[0], c[0], f); W.spin = lerp(a[1], c[1], f); W.contact = !!a[2]; W.slipSpeed = a[3]; W.sink = a[4]; W.slip = a[5]; W.surf = a[6]; W.deck = a[7]; W.toe = a[8]; W.camber = a[9]; });
  if (A.bots) BOTS.list.forEach((b, i) => { const a = A.bots[i], c = C.bots?.[i] || a; if (!a) return; b.pos.set(lerp(a[0], c[0], f), lerp(a[1], c[1], f), lerp(a[2], c[2], f)); b.q.set(a[3], a[4], a[5], a[6]).slerp(rqB.set(c[3], c[4], c[5], c[6]), f); b.spin = lerp(a[7], c[7], f); b.steer = a[8]; });
  up.set(0, 1, 0).applyQuaternion(car.q); fwd.set(0, 0, 1).applyQuaternion(car.q); down.copy(up).negate();
  if ((rp.hudT = (rp.hudT || 0) + dt) > 0.1) {
    rp.hudT = 0;
    rp.el.innerHTML = `<b>REPLAY</b> ${fmt(rp.t - t0).replace(/\.\d+$/, '')} / ${fmt(t1 - t0).replace(/\.\d+$/, '')} · ${rp.paused ? 'paused' : rp.speed + '×'}<div class="bar"><i style="width:${((rp.t - t0) / Math.max(t1 - t0, 1e-3) * 100).toFixed(1)}%"></i></div><small>${rp.lastLap && rp.lastLap.a >= t0 - 0.5 ? `Lap ${rp.lastLap.no} (${fmt(rp.lastLap.time)}) is on tape: L plays it · ` : ''}Space pause · ← → 5 s · Home start · ↑ ↓ speed · C camera · Y or Esc back to driving</small>`;
  }
}
document.getElementById('replayBtn').addEventListener('click', e => { e.currentTarget.blur(); if (ed.on) return; rp.on ? stopReplay() : startReplay(); });
rp.el = document.createElement('div'); rp.el.id = 'replay'; rp.el.className = 'panel'; document.body.appendChild(rp.el);

let acc = 0, last = performance.now(), chunkTimer = 0, simTime = 0;
function simulate(dt) {
  readInput(dt);
  aiRvFrame(dt);
  acc += dt;
  let n = 0;
  while (acc >= DT && n < 10) { stepCar(DT); collideGates(DT); if (AI.race) aiRvSub(AI.rv, AI.race, AI.dst, DT); acc -= DT; n++; }
  aiRvFrameLate(dt);
  updateBots(dt);
  mpContacts(dt);
  if (n >= 10) acc = 0;
  for (const W of car.wheels) if (W.contact) relax(W.P.x, W.P.z, 1.1);
  emitFromWheels(dt);
  updateSkids();
  updateParticles(dt);
  if ((chunkTimer += dt) > 0.25) { chunkTimer = 0; refreshChunks(car.pos.x, car.pos.z, 6); }
  simTime += dt;
  updateLap(dt);
  updateGates(dt);
  updateDebris(dt);
  car.grace = Math.max(0, car.grace - dt);
  recordFrame();
}
// ---------- pausing the drive (P, the Pause button) ----------
document.head.insertAdjacentHTML('beforeend', `<style>
  #pauseBtn{position:fixed;top:252px;right:120px;font:inherit;font-size:13px;font-weight:700;border:0;border-radius:8px;padding:8px 12px;cursor:pointer;color:#fff;background:rgba(20,14,6,.65);min-width:92px}
  #pauseBtn.on{background:rgba(255,210,125,.9);color:#1a1208}
  #pauseNote{display:none;top:36%;left:50%;transform:translateX(-50%);text-align:center;padding:12px 22px}
  #pauseNote b{display:block;font-size:30px;letter-spacing:6px} #pauseNote small{opacity:.8}
</style>`);
const pauseBtn = document.createElement('button'); pauseBtn.id = 'pauseBtn'; pauseBtn.style.display = 'none';
pauseBtn.addEventListener('click', e => { e.currentTarget.blur(); simPause(); });
const pauseNote = document.createElement('div'); pauseNote.id = 'pauseNote'; pauseNote.className = 'panel';
pauseNote.innerHTML = '<b>PAUSED</b><small>P or ▶ Resume to drive on</small>';
document.body.append(pauseBtn, pauseNote);
// why the drive can't be paused now ('' : it can)
const simPauseWhyNot = () => MP.on && (MP.phase === 'countdown' || MP.phase === 'racing') && !MP.finished ? 'No pause in a race'
  : AI.training ? 'The autopilot is training: Stop stops it' : ed.on || rp.on ? 'Nothing to pause here' : '';
function simPause(on = !window.__sim.paused) {
  const why = on && simPauseWhyNot();
  if (why) { flash(why, '#ffd88a', 1.5); return; }
  window.__sim.paused = on; pauseShowT = 0;
}
// each frame: a race or a training starting ends the pause; every 0.1 s the button (left of Replay, as it is shown) and the note
let pauseShowT = 0;
function pauseFrame(dt) {
  if (window.__sim.paused && (AI.training || (MP.on && (MP.phase === 'countdown' || MP.phase === 'racing') && !MP.finished))) window.__sim.paused = false;
  if ((pauseShowT -= dt) > 0) return; pauseShowT = 0.1;
  // (in a room the Autopilot button is left of Replay: then left of it)
  const p = !!window.__sim.paused, rb = document.getElementById('replayBtn'), r = (MP.on && rb.offsetWidth && AI.btn.offsetWidth ? AI.btn : rb).getBoundingClientRect();
  pauseNote.style.display = p && !ed.on && !rp.on ? 'block' : 'none';
  pauseBtn.style.display = r.width ? '' : 'none';
  if (!r.width) return;
  pauseBtn.style.top = r.top + 'px'; pauseBtn.style.right = (innerWidth - r.left + 8) + 'px';
  const label = p ? '▶ Resume' : '⏸ Pause';
  if (pauseBtn.textContent !== label) { pauseBtn.textContent = label; pauseBtn.classList.toggle('on', p); pauseBtn.title = p ? 'Drive on (P)' : 'Pause the drive (P)'; }
}
function frame(now) {
  const aiF0 = performance.now(); aiLoadGap(now);                   // (how busy this tab is: the autopilot's panel)
  const dt = Math.min((now - last) / 1000, 0.05); last = now;
  if (ed.on) {
    updateEditor(dt);
    if ((chunkTimer += dt) > 0.25) { chunkTimer = 0; refreshChunks(orbit.target.x, orbit.target.z, 4); }
    lap.msgT = Math.max(0, lap.msgT - dt);
  } else if (rp.on) { playReplay(dt); updateParticles(dt); lap.msgT = Math.max(0, lap.msgT - dt); if ((chunkTimer += dt) > 0.25) { chunkTimer = 0; refreshChunks(car.pos.x, car.pos.z, 6); } }
  else if (AI.training) { try { aiTrainFrame(dt); } catch (e) { aiTrainFail(e); } }   // (a failure stops the training, not the sim)
  else if (!window.__sim.paused) { simulate(dt); if (AI.drive) for (let k = 1; k < AI_CFG.speed; k++) simulate(dt); }   // (Drive it at 2x, 4x: more steps a frame)
  for (const id of dirty) { const ch = chunks.get(id); if (ch) ch.update(); }
  dirty.clear();
  aiRvSync(); syncVisual(); syncBots(); mpFrame(dt);
  updateRig(dt);
  updatePops(dt);
  updateCamera(dt);
  updateWeather(dt);
  fadeGates();
  updateAudio(); pauseFrame(dt);
  updateHud(dt);
  updateLapHud(dt);
  aiViz(dt);
  if (!AI.big && (!AI.training || AI_CFG.draw || AI.watch)) renderer.render(scene, camera);   // (training, maybe not drawn: more time for it; the lab full screen hides it)
  AI_LOAD.busy += performance.now() - aiF0;
  requestAnimationFrame(frame);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); pMat.uniforms.scale.value = innerHeight / 2;
});

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
  aiHalt(true, 'a race started');
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
  if (AI.drive) {                                                     // the network's (#333): a best lap of its own, never a race lap
    if (MP.phase === 'countdown' || MP.phase === 'racing') return;
    const m = aiNetMark();
    mpPost({ t: 'lap', lap: lap.lapNo, time: t - lap.lapStart, valid, splits: lap.splits, net: { id: m.id, weights: m.weights, h: m.h }, ...(valid ? { trace: mpTrace(lap.lapStart, t) } : {}) });
    return;
  }
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
    case 'watch': mpWatch(m.network); break;
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
  MP.recs = []; MP.carRecs = []; lap.best = null; lap.bestSplits = []; lap.bestNet = null;
  if (`${R.map}@${R.v}` !== MP.courseKey || R.ground !== mpGroundNow()) return;      // not this course's (yet)
  const mine = R.list.find(e => e.id === MP.myId && e.vehicle === VEH.key);
  if (mine) { lap.best = mine.time; lap.bestSplits = mine.mv === R.v && Array.isArray(mine.splits) ? mine.splits : []; }
  const seen = new Set();
  for (const e of R.list) if ((e.vehicle === 'buggy' || ROAD_CARS[e.vehicle]) && !seen.has(e.vehicle)) { seen.add(e.vehicle); MP.recs.push(e); }
  MP.carRecs = R.list.filter(e => e.vehicle === VEH.key);
}
// a best lap's driver as the lists show it: a network's (#333) in cyan, its maker in the tooltip
const mpWho = e => e.net ? `<span style="color:#58d6e6" title="A network's lap: ${mpEsc(e.net.name)}, made by ${mpEsc(e.net.creator)}">${mpEsc(e.name)}</span>` : mpEsc(e.name);
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
    + `<td>${e ? fmt(e.time) : '–'}</td><td style="text-align:left;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e ? mpWho(e) : 'no lap yet'}</td></tr>`;
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
  Object.assign(mpGhost, { key: m.key, dv: new DataView(u8.buffer), n, course: m.course, ground: m.ground, name: m.name, time: m.time, veh: m.vehicle, trace: m.trace, spin: 0, lookT: 0, old: [], pre: null, preN: 0, preW: [] });
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
  const G = mpGhost; G.key = null; G.trace = null;
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
  const row = ([e, i]) => `<tr class="${e.id === MP.myId ? 'me' : ''}"><td class="p">${i + 1}</td><td class="n">${mpWho(e)}${e.id === MP.myId ? ' (you)' : ''}${old(e) ? ' *' : ''}</td>`
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
  if (AI.training) return;
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
    ? { wp: c.wp.map(([x, z]) => [+x, +z]), bank: bankOf(c.bank), level: levelOf(c.level), even: evenOf(c.even), grade: gradeOf(c.grade), ops: Array.isArray(c.ops) ? c.ops : [], base: BASES.includes(c.base) ? c.base : 'sand', road: !!c.road, bridges: pts(c.bridges), noBridge: pts(c.noBridge) }
    : { wp: DEFAULT_WP.map(p => p.slice()), ops: [], base: 'sand', road: false, bridges: [], noBridge: [] };
  if (ground) { C.base = ground === 'earth' || ground === 'road' ? 'earth' : 'sand'; C.road = ground === 'road'; }
  else if (C.road) C.base = 'earth';
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
  if (!setSurface(g) && COURSE.bank) { clearSkids(); regenerateWorld(); }   // another ground rebuilds the world itself; the banking is set for its cornering speed
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
  if ((MP.sendT += dt) >= 0.05 && !rp.on && !ed.on && !AI.training) {
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
  carHitHook = mpSendHit; carRepairHook = () => { if (!AI.training) mpPost({ t: 'repair' }); };
  // the chat (#325): Enter opens the race page's line to write on (a wrecked car's Enter still repairs it); the keys
  // held let go, as whenever the page loses the focus (the keyups go to the page, not to us)
  const keysUp = () => { for (const k in keys) keys[k] = false; };
  addEventListener('keydown', e => { if (e.code === 'Enter' && !e.repeat && !car.wrecked && !ed.on) { e.stopImmediatePropagation(); e.preventDefault(); keysUp(); mpPost({ t: 'chatKey' }); } }, true);
  addEventListener('blur', keysUp);
  const help = document.getElementById('help');
  help.innerHTML = '<b>W/↑</b> throttle &nbsp; <b>S/↓</b> brake / reverse &nbsp; <b>A D/← →</b> steer &nbsp; <b>Space</b> handbrake &nbsp; <b>R</b> back to last gate<br><b>C</b> camera &nbsp; <b>Shift/right-drag</b> look around &nbsp; <b>P</b> pause &nbsp; <b>Shift+P</b> tire pressure &nbsp; <b>4</b> 2WD/4WD (AWD cars: front/rear split) &nbsp; <b>U</b> car setup (drive, tires) &nbsp; <b>X</b> driver aids &nbsp; <b>Y</b> replay (not in a race) &nbsp; <b>I</b> TNN lab (not in a race) &nbsp; <b>M</b> mute &nbsp; <b>Enter</b> chat &nbsp; <b>H</b> hide this';
  addEventListener('message', e => { if (e.origin === location.origin && e.source === parent) mpMessage(e.data); });
}
if (MP.edit) {
  BOTS.n = 0;
  addEventListener('message', e => { if (e.origin === location.origin && e.source === parent) mpEditMessage(e.data); });
  addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') { e.preventDefault(); e.stopImmediatePropagation(); mpPost({ t: 'save' }); } }, true);
}

/* =====================================================================
   AUTOPILOT (#311): the smallest neural network that drives a lap, trained here in the browser.
   The policy: AI_IN inputs -> 2 outputs, steer (-1..1, + = A) and pedal (+ throttle, - brake), each the tanh of a
   weighted sum of the inputs: 16 weights, the smallest there is (AI.h = 0); or with a hidden layer of tanh units
   between, as many as AI_SIZES offers (AI.h = 8: 82 weights). Its inputs, from the car and the course's racing line (botPath, a point a metre):
     forward speed / 20 m/s; where the line is 6, 15 and 30 m ahead (the sine of its bearing from the car's heading);
     how far the car is to the side of the line / 5 m; how fast it is turning (yaw rate / 2); and a pace note:
     the speed the line can be taken at here (botPath's, from its bends and the ground's grip, braking for those
     ahead included) less ours, / 10 m/s. Without it, braking for a bend is a product of speed and curvature that
     a net this small, trained this way, doesn't find (it learns to go fast, and flies off the first sharp bend).
   Training: evolution strategies. Each generation drives AI_CFG.pop copies of the weights with Gaussian noise
   (+e and -e pairs) for AI_CFG.window s each, all from the same place on the racing line: a random one (from the
   start line only, it would never practise the far bends), or half the time 100 m before where the last exam went
   wrong (arriving there about as fast); a try scores the metres it covers along the line,
   less AI_CFG.crash if it ends off the course, stuck or wrecked rather than in time (or no braking is learnt).
   The weights move toward the noise of the better tries (by rank, with Adam). Then an exam: the new weights
   from the start line, for a lap (its score: metres, or for a lap the course's length and AI_LAP_BONUS a
   second it was quicker than AI_T); the best exam's weights are the autopilot's. Every drive's score loses AI_PEN:
   so much a metre driven off the road, for the damage done, and for a wreck. A drive ends AI_CFG.off m
   off the line, going backwards or nowhere, upside down or wrecked. Physics only (no lap timing, skids, dust,
   sound), at AI_DT steps, within AI_BUDGET ms a frame; the ground is put back after every drive (the wheels
   dig ruts in sand).
   The best weights so far drive the car (Drive it), as a player would, with lap timing.
   Saved per course and car in this browser. window.__sim.ai: AI, aiTrainSync(gens) for tests.
   ===================================================================== */
const AI_SIZES = [0, 2, 4, 6, 8, 12, 16, 24, 32, 48, 64];          // the hidden layer's units (0: none), each size a training of its own
const AI_T = 150, AI_DT = 1 / 60, AI_BUDGET = 12, AI_BUDGET_BLIND = 15, AI_LAP_BONUS = 5;
// the time a lap has, in an exam (and what its bonus counts down from): AI_T, or a long course's length at 10 m/s (#348:
// a flying exam on a 2.1 km course, two laps in 150 s, ran out of time before its timed lap, however fast)
const aiLapT = () => Math.max(AI_T, botPath().len / 10);
// the training's settings (aiTrainSync may try others): tries a generation, noise, step size, the bearings' scale
const AI_CFG = { pop: 16, sigma: 0.3, lr: 0.2, bearing: 2, off: 8, window: 15, crash: 100, crashKmh: 0, lostAfter: 20, pace: 1, gCorner: 0.84, gBrake: 0.76, gAccel: 0, racingLine: false, lineW: 0, lookTime: false, rolling: false, flying: false, examLaps: 1, rival: 'off', rivalShare: 0.5, rivalEvery: 10, rivalCar: '', cores: 1, draw: true, ped3d: true, speed: 1, onRoad: false, hbTurn: false, hbNoBrake: false, hbLock: 0.3 };
// the rival (#311): another of this car on the course, near enough to matter within AI_RV_NEAR m along the line
const AI_RV_NEAR = 30, AI_RV_MODES = ['off', 'replay', 'car'];
const AI_LOOK_T = [0.3, 0.7, 1.4, 2.4, 4.8];                           // the look-ahead in seconds, if by time (at least AI_LOOK_MIN m)
const AI_LOOK_MIN = [3, 6, 12, 20, 40];
const AI_AHEAD_T = 0.5, AI_AHEAD_MIN = 5;                                // the pace note ahead: so far ahead
const AI_LOOK = [6, 15, 30, 50, 100], AI_LOOK_IDS = ['line6', 'line15', 'line30', 'line50', 'line100'], AI_RAYS = [60, 30, 0, -30, -60], AI_RAY_MAX = 40;
const aiDeg = v => Math.round(Math.asin(clamp(v / AI_CFG.bearing, -1, 1)) * 180 / Math.PI) + '°';
// the inputs to choose from (Inputs & outputs, in the panel): each gives one number or a few, roughly -1..1, shown in real units
const AI_INPUTS = [
  { id: 'speed', names: ['speed'], tip: 'its forward speed', show: v => Math.round(v * 72) + ' km/h' },
  { id: 'line6', names: ['line 6 m'], tip: 'where the racing line is 6 m ahead (the sine of its bearing, + to the left)', show: aiDeg },
  { id: 'line15', names: ['line 15 m'], tip: 'where the racing line is 15 m ahead', show: aiDeg },
  { id: 'line30', names: ['line 30 m'], tip: 'where the racing line is 30 m ahead', show: aiDeg },
  { id: 'line50', names: ['line 50 m'], tip: 'where the racing line is 50 m ahead: a bend still a few seconds off', show: aiDeg },
  { id: 'line100', names: ['line 100 m'], tip: 'where the racing line is 100 m ahead: the shape of what is coming, from far off', show: aiDeg },
  { id: 'offset', names: ['offset'], tip: 'how far it is to the side of the racing line (+ left)', show: v => (v * 5).toFixed(1) + ' m' },
  { id: 'yaw', names: ['yaw rate'], tip: 'how fast it is turning', show: v => Math.round(v * 115) + '°/s' },
  { id: 'pace', names: ['pace note'], tip: "the speed the line can be taken at here (from its bends and the ground's grip) less its own", show: v => (v > 0 ? '+' : '') + Math.round(v * 36) + ' km/h' },
  { id: 'ahead', names: ['pace note ahead'], tip: `the pace note's speed ${AI_AHEAD_T} s ahead (at its speed, at least ${AI_AHEAD_MIN} m) less its own: what's coming, to brake for it in time`, show: v => (v > 0 ? '+' : '') + Math.round(v * 36) + ' km/h' },
  { id: 'edges', names: ['left edge', 'right edge'], tip: "how far the course's edges are, left and right (the tarmac's on road, the gate posts' off it)", show: v => (v * 10).toFixed(1) + ' m' },
  { id: 'rays', names: AI_RAYS.map(a => a ? `ray ${Math.abs(a)}° ${a > 0 ? 'L' : 'R'}` : 'ray ahead'), tip: `5 feelers, 60° and 30° to either side and straight ahead: how far each goes before it leaves the course (up to ${AI_RAY_MAX} m)`, show: v => Math.round(v * AI_RAY_MAX) + ' m' },
  { id: 'slide', names: ['sideways'], tip: 'how fast it slides sideways (+ to the left)', show: v => (v * 10).toFixed(1) + ' m/s' },
  { id: 'wslip', names: ['front slip', 'rear slip'], tip: "the wheels' slip, the front pair's and the rear pair's (on the ground): + spinning faster than the car goes (too much gas), − turning slower, locking (braking, the handbrake)", show: v => (v > 0 ? '+' : '') + Math.round(v * 100) + ' %' },
  { id: 'sink', names: ['sinkage'], tip: 'how deep its wheels sink into the ground (the deepest one): digging itself in, on sand', show: v => Math.round(v * 20) + ' cm' },
  { id: 'g', names: ['g forward', 'g sideways'], tip: 'its acceleration in g, forward (+ speeding up, − braking) and sideways (+ turning left: pulled to the left, so you would feel pushed right), smoothed over 0.1 s', show: v => v.toFixed(2) + ' g' },
  { id: 'rival', names: ['rival ahead', 'rival behind', 'rival side', 'rival closing'], tip: `the rival car, when within ${AI_RV_NEAR} m along the line: how near it is ahead and behind (1: touching; alongside, half each), how far to the left (+) or right of us, and how much faster we go than it (all 0 when it is further, or there is none). Train with a rival (below) for it to learn what to do with them`,
    show: [v => v > 0 ? Math.round(v * 100) + ' %' : '—', v => v > 0 ? Math.round(v * 100) + ' %' : '—', v => (v * 5).toFixed(1) + ' m', v => (v > 0 ? '+' : '') + Math.round(v * 36) + ' km/h'] },
  { id: 'tilt', names: ['roll', 'pitch'], tip: 'how far it leans to the side (+ left side up) and noses up or down (+ up): about to roll over?', show: v => Math.round(v * 30) + '°' },
];
const AI_DEFAULT_INPUTS = ['speed', 'line6', 'line15', 'line30', 'offset', 'yaw', 'pace'];
// rewards and penalties, in metres on or off a drive's score: per metre driven off the road (the course: the tarmac on road,
// between the gate posts off it), for damage (a wreck's worth: the car's condition from 100 % to 0), for wrecking it; per
// full swing of the steering or pedal output (jerky driving: their changes, added up; lock to lock is 2); and a reward
// per km/h of its average speed along the line; per metre of extra path (driven beyond its progress along the line: running
// wide, weaving)
const AI_PEN = { offRoad: 1, damage: 150, wreck: 100, smooth: 0, speed: 0, path: 0, contact: 20, gain: 0 };
// (with a rival: per m/s of each impact with it, the car behind taking 3/4 of the blame, alongside half; and a reward per
// metre gained on it over the drive)
// the weights' count for these inputs and outputs, with h hidden units (0: none)
const aiShape = (inputs, hb, h) => {
  const nIn = AI_INPUTS.filter(d => inputs.includes(d.id)).reduce((a, d) => a + d.names.length, 0), nOut = hb ? 3 : 2;
  return { nIn, nOut, np: h ? nIn * h + h + h * nOut + nOut : nIn * nOut + nOut };
};
const AI = { gens: 0, genEnd: 0, stopAfter: 30, sinceBest: 0, dry: 0, h: 0, np: 0, inputs: AI_DEFAULT_INPUTS, hb: false, kp: false, ks: false, nb: false, applied: [0, 0], nIn: 7, nOut: 2, names: [], shows: [], look: [], rayEnds: [], viewW: null, nAct: 0, nSim: 0, rateT: 0, rate: '', open: false, training: false, drive: false, key: '', w: null, m: null, v: null, k: 0, gen: 0, best: null, bestFit: -1, bestLap: null,
  hist: [], cands: null, eps: null, fits: null, ci: 0, ep: null, ctl: null, snapH: null, snapC: null, acc: 0, dst: null, el: null };
const aiX = new Float32Array(32), aiY = new Float32Array(3), aiHid = new Float32Array(AI_SIZES[AI_SIZES.length - 1]);
// what the network takes in and gives out (kept in this browser; each set is a training of its own)
function aiConfig(inputs, hb) {
  inputs = AI_INPUTS.map(d => d.id).filter(id => inputs.includes(id));
  if (!inputs.length) inputs = AI_DEFAULT_INPUTS;
  Object.assign(AI, { inputs, hb: !!hb }, aiShape(inputs, hb, AI.h));
  AI.names = []; AI.shows = []; AI.groups = [];
  for (const d of AI_INPUTS) if (inputs.includes(d.id)) d.names.forEach((nm, k) => { AI.names.push(nm); AI.shows.push(Array.isArray(d.show) ? d.show[k] : d.show); AI.groups.push(d); });
}
// the lab's settings from c (this browser's, kept by aiKeepConfig; or a network's being loaded, #351): what isn't in c,
// or isn't valid, stays as it is (the switches: off)
function aiConfigRead(c) {
  if (AI_SIZES.includes(c?.h)) AI.h = c.h;
  aiConfig(c?.inputs || AI_DEFAULT_INPUTS, c?.hb); AI.kp = !!c?.kp; AI.ks = !!c?.ks; AI.nb = !!c?.nb;
  if (Number.isInteger(c?.stopAfter) && c.stopAfter >= 0) AI.stopAfter = c.stopAfter;
  if (Number.isInteger(c?.gens) && c.gens >= 0) AI.gens = c.gens;
  if (Number.isFinite(c?.off) && c.off >= 3 && c.off <= 30) AI_CFG.off = c.off;
  if (Number.isFinite(c?.crash) && c.crash >= 0 && c.crash <= 2000) AI_CFG.crash = c.crash;                      // (#348)
  if (Number.isFinite(c?.crashKmh) && c.crashKmh >= 0 && c.crashKmh <= 50) AI_CFG.crashKmh = c.crashKmh;
  if (Number.isFinite(c?.window) && c.window >= 5 && c.window <= 60) AI_CFG.window = c.window;
  if (Number.isInteger(c?.lostAfter) && c.lostAfter >= 0 && c.lostAfter <= 1000) AI_CFG.lostAfter = c.lostAfter;
  if (Number.isFinite(c?.pace) && c.pace >= 0.5 && c.pace <= 2) AI_CFG.pace = c.pace;
  if (Number.isFinite(c?.gCorner) && c.gCorner >= 0.2 && c.gCorner <= 2) AI_CFG.gCorner = c.gCorner;
  if (Number.isFinite(c?.gBrake) && c.gBrake >= 0.2 && c.gBrake <= 2) AI_CFG.gBrake = c.gBrake;
  if (Number.isFinite(c?.gAccel) && c.gAccel >= 0 && c.gAccel <= 2) AI_CFG.gAccel = c.gAccel;
  AI_CFG.racingLine = !!c?.racingLine;
  if (Number.isFinite(c?.lineW) && c.lineW >= 0 && c.lineW <= 15) AI_CFG.lineW = c.lineW;
  AI_CFG.lookTime = !!c?.lookTime; AI_CFG.rolling = !!c?.rolling; AI_CFG.flying = !!c?.flying;
  if (Number.isInteger(c?.examLaps) && c.examLaps >= 1 && c.examLaps <= 5) AI_CFG.examLaps = c.examLaps;
  if (AI_RV_MODES.includes(c?.rival)) AI_CFG.rival = c.rival;
  if (Number.isFinite(c?.rivalShare) && c.rivalShare >= 0 && c.rivalShare <= 1) AI_CFG.rivalShare = c.rivalShare;
  if (typeof c?.rivalCar === 'string' && (!c.rivalCar || ROAD_CARS[c.rivalCar])) AI_CFG.rivalCar = c.rivalCar;
  if (Number.isInteger(c?.cores) && c.cores >= 1 && c.cores <= 16) AI_CFG.cores = c.cores;
  if ([1, 2, 4].includes(c?.speed)) AI_CFG.speed = c.speed;
  AI_CFG.onRoad = !!c?.onRoad; AI_CFG.hbTurn = !!c?.hbTurn; AI_CFG.hbNoBrake = !!c?.hbNoBrake;
  if (Number.isFinite(c?.hbLock) && c.hbLock >= 0.05 && c.hbLock <= 1) AI_CFG.hbLock = c.hbLock;
  if (c?.draw === false) AI_CFG.draw = false; if (c?.ped3d === false) AI_CFG.ped3d = false;
  for (const k in AI_PEN) if (Number.isFinite(c?.pen?.[k]) && c.pen[k] >= 0) AI_PEN[k] = c.pen[k];
}
try { aiConfigRead(JSON.parse(localStorage.getItem('sandbuggy.ai.config') || 'null')); } catch (e) { aiConfig(AI_DEFAULT_INPUTS, false); }
const aiKeepConfig = () => { try { localStorage.setItem('sandbuggy.ai.config', JSON.stringify({ crash: AI_CFG.crash, crashKmh: AI_CFG.crashKmh, window: AI_CFG.window, lostAfter: AI_CFG.lostAfter, rival: AI_CFG.rival, rivalShare: AI_CFG.rivalShare, rivalCar: AI_CFG.rivalCar, cores: AI_CFG.cores, speed: AI_CFG.speed, onRoad: AI_CFG.onRoad, hbTurn: AI_CFG.hbTurn, hbNoBrake: AI_CFG.hbNoBrake, hbLock: AI_CFG.hbLock, draw: AI_CFG.draw, ped3d: AI_CFG.ped3d, examLaps: AI_CFG.examLaps, flying: AI_CFG.flying, rolling: AI_CFG.rolling, lookTime: AI_CFG.lookTime, lineW: AI_CFG.lineW, racingLine: AI_CFG.racingLine, gAccel: AI_CFG.gAccel, gCorner: AI_CFG.gCorner, gBrake: AI_CFG.gBrake, pace: AI_CFG.pace, off: AI_CFG.off, gens: AI.gens, stopAfter: AI.stopAfter, h: AI.h, inputs: AI.inputs, hb: AI.hb, kp: AI.kp, ks: AI.ks, nb: AI.nb, pen: AI_PEN })); } catch (e) { } };
// another set of inputs or outputs (or pedals / steering like the keyboard's, or no brake): another training (this one stays, under its own key);
// one not trained yet starts from this one's weights, the new inputs' (and outputs') at nothing: it drives as this one did
function aiSetInputs(inputs, hb, quiet, kp = AI.kp, ks = AI.ks, nb = AI.nb) {
  if (AI.training) aiTrain(false);
  AI.drive = false;
  const was = aiWas();
  aiConfig(inputs, hb); AI.kp = !!kp; AI.ks = !!ks; AI.nb = !!nb; aiKeepConfig();
  if (quiet) return;
  aiLoad();
  if (was && !AI.gen && !AI.best && !was.h === !AI.h) { aiCarry(was); flash('Carried over: the new inputs start at nothing', '#9fd4ff', 2); }
  aiShow();
}
// another size of hidden layer (#316): another training too; one not trained yet starts from this one's if both have a
// hidden layer: its units kept (the first ones, if fewer), the new ones looking at the inputs but not yet heard (it drives as before)
function aiSetSize(h) {
  if (!AI_SIZES.includes(h) || h === AI.h) return;
  if (AI.training) aiTrain(false);
  const was = aiWas();
  AI.drive = false; AI.h = h; aiConfig(AI.inputs, AI.hb); aiKeepConfig(); aiLoad();
  if (was && !AI.gen && !AI.best && was.h && h) { aiCarry(was); flash(h > was.h ? `Carried over: ${was.h} units, ${h - was.h} new ones not heard yet` : `Carried over: its first ${h} units of ${was.h}`, '#9fd4ff', 2.5); }
  aiShow();
}
// this training, to carry over to another (null if it hasn't learnt anything)
function aiWas() { return AI.w && (AI.gen || AI.best) ? { names: AI.names.slice(), nIn: AI.nIn, nOut: AI.nOut, h: AI.h, w: AI.best || AI.w } : null; }
// (both with a hidden layer, or neither)
function aiCarry(o) {
  const I = AI.nIn, O = AI.nOut, h = AI.h, oh = o.h, n = AI.np, w = new Float32Array(n), on = o.w.length, oo = Math.min(O, o.nOut);
  const from = AI.names.map(nm => o.names.indexOf(nm));                 // each input's place in the old network, or -1
  if (!h) for (let r = 0; r < oo; r++) for (let i = 0; i < I; i++) if (from[i] >= 0) w[r * I + i] = o.w[r * o.nIn + from[i]];   // W
  for (let j = 0; j < h; j++) {
    if (j >= oh) { for (let i = 0; i < I; i++) w[j * I + i] = aiGauss() * 0.1; continue; }   // a new unit: W1 as a fresh one's, b1 and W2 nothing
    for (let i = 0; i < I; i++) if (from[i] >= 0) w[j * I + i] = o.w[j * o.nIn + from[i]];   // W1
    w[I * h + j] = o.w[o.nIn * oh + j];                                  // b1
    for (let k = 0; k < oo; k++) w[I * h + h + j * O + k] = o.w[o.nIn * oh + oh + j * o.nOut + k];   // W2
  }
  for (let k = 0; k < oo; k++) w[n - O + k] = o.w[on - o.nOut + k];   // b (b2)
  if (O > 2 && o.nOut <= 2) w[n - O + 2] = -1;                          // a new handbrake: off
  AI.w = w; AI.m = new Float32Array(n); AI.v = new Float32Array(n); AI.k = 0;
  AI.best = Float32Array.from(w); AI.examKind = '';                    // its best so far: where it starts, examined as training starts
  aiSave();
}

// the network: linear [W (outputs x inputs), b (outputs)]; with h hidden units [W1 (h x inputs), b1 (h), W2 (h x outputs), b2 (outputs)];
// outputs: steer, pedal, and with the handbrake, the handbrake (on above 0)
function aiNet(w, x, y) {
  const h = AI.h, n = w.length, I = AI.nIn, O = AI.nOut, b2 = n - O;
  for (let k = 0; k < O; k++) y[k] = w[b2 + k];
  if (!h) for (let k = 0; k < O; k++) for (let i = 0; i < I; i++) y[k] += w[k * I + i] * x[i];
  const b1 = I * h, w2 = b1 + h;
  for (let j = 0; j < h; j++) {
    let a = w[b1 + j];
    for (let i = 0; i < I; i++) a += w[j * I + i] * x[i];
    const hv = aiHid[j] = Math.tanh(a);
    for (let k = 0; k < O; k++) y[k] += w[w2 + j * O + k] * hv;
  }
  for (let k = 0; k < O; k++) y[k] = Math.tanh(y[k]);
}
// the course's edges: a grid (1 m) of the distance to the racing line, made once a course, and its half-width
const AF_N = WORLD + 1;
function aiField() {
  const Pt = botPath(); if (AI.fieldPt === Pt) return AI.field;
  const F = new Float32Array(AF_N * AF_N).fill(99), R = AI_RAY_MAX + 12;
  for (const q of Pt.P) {
    const ci = Math.round(q.x + HALF), cj = Math.round(q.z + HALF);
    for (let j = Math.max(0, cj - R); j <= Math.min(AF_N - 1, cj + R); j++) for (let i = Math.max(0, ci - R); i <= Math.min(AF_N - 1, ci + R); i++) {
      const d = Math.hypot(i - HALF - q.x, j - HALF - q.z), k = j * AF_N + i; if (d < F[k]) F[k] = d;
    }
  }
  AI.fieldPt = Pt; return AI.field = F;
}
const aiHalfW = () => ROAD ? ROAD_HALF : (TRACK.gates[0]?.half ?? 9.5);
// a feeler from the car, deg to the left of its heading: metres until it leaves the course (AI_RAY_MAX if it doesn't)
function aiRay(cx, cz, deg, k) {
  const F = aiField(), W = aiHalfW(), a = deg * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
  const dx = c * cx + sn * cz, dz = c * cz - sn * cx;
  let s = 1;
  for (; s <= AI_RAY_MAX; s++) {
    const i = Math.round(car.pos.x + dx * s + HALF), j = Math.round(car.pos.z + dz * s + HALF);
    if (i < 0 || j < 0 || i >= AF_N || j >= AF_N || F[j * AF_N + i] > W) break;
  }
  s = Math.min(s, AI_RAY_MAX);
  AI.rayEnds[k] = [car.pos.x + dx * s, car.pos.z + dz * s];
  return s;
}
// the pace notes: the speed each metre of the racing line can be taken at, for a car with so much grip cornering
// (AI_CFG.gCorner, on tarmac; the other grounds in proportion, as the bots') and braking (AI_CFG.gBrake): the bend's
// own speed from its curvature (and banking), then braking back from every bend. With the bots' 0.84 g and 0.76 g, theirs.
// Optionally (AI_CFG.gAccel > 0) no faster than the car can speed up to from the bend before, either.
function aiPace() {
  const Pt = botPath(), L = aiLine(), D = aiDemoNow(), key = `${AI_CFG.gCorner}|${AI_CFG.gBrake}|${AI_CFG.gAccel}|${L ? AI.lineKey : 'centre'}`;
  if (AI.paceFor === Pt && AI.paceKey === key) return AI.paceV;
  if (D) { AI.paceFor = Pt; AI.paceKey = key; return AI.paceV = Float32Array.from(D.v); }   // the recorded lap's own speeds
  const P = Pt.P, n = Pt.n, v = new Float32Array(n), kc = AI_CFG.gCorner * 9.81 / 8.2, kb = AI_CFG.gBrake * 9.81 / 7.5, ds = L ? L.ds : Pt.ds;
  for (let i = 0; i < n; i++) {
    const q = P[i], lat = q.brk >= 7 ? 8.2 : q.brk >= 5 ? 5.2 : 3.8;               // the ground's (as botPath: tarmac, earth, sand)
    const bank = Math.abs(TRACK.bank?.[Math.round(i / n * (TRACK.pts.length - 1))] || 0);
    v[i] = Math.min(q.top, Math.sqrt((lat * kc + 9.81 * bank) / Math.max(Math.abs(L ? L.k[i] : q.k), 1e-4)));
  }
  for (let pass = 0; pass < 2; pass++) {
    if (AI_CFG.gAccel > 0) for (let i = 0; i < n; i++) v[(i + 1) % n] = Math.min(v[(i + 1) % n], Math.sqrt(v[i] ** 2 + 2 * AI_CFG.gAccel * 9.81 * ds));
    for (let i = n - 1; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[(i + 1) % n] ** 2 + 2 * P[i].brk * kb * ds));
  }
  AI.paceFor = Pt; AI.paceKey = key;
  return AI.paceV = v;
}
// A recorded lap to follow (aiDemo: a ghost's trace, e.g. a driver's best lap): its line across the road and its speed
// at each metre of the course take the place of the racing line and the pace notes while it is set (per course and car,
// in this browser; aiDemo(null) drops it). Learning from a demonstration: the network still has to learn to drive it.
function aiDemo(trace, meta) {
  const key = `sandbuggy.ai.demo.${courseKey()}.${VEH.key}`;
  AI.demoKey = AI.demoCk = null; AI.lineFor = AI.paceFor = null;
  if (trace === null) { try { localStorage.removeItem(key); } catch (e) { } return { demo: false }; }
  const d = aiLapProfile(trace);
  if (meta && typeof meta === 'object') Object.assign(d, { who: String(meta.who || '').slice(0, 40), time: Number.isFinite(+meta.time) ? +meta.time : null, src: String(meta.src || '') });
  try { localStorage.setItem(key, JSON.stringify(d)); } catch (err) { }
  return { demo: true, samples: d.m, seconds: +((d.m - 1) * GH_DT).toFixed(1), points: d.e.length, maxOffset: +Math.max(...d.e.map(Math.abs)).toFixed(1) };
}
// a trace along this course: at each metre of its line, how far left of it the lap was (e) and how fast (v)
function aiLapProfile(trace) {
  let b; try { const s = atob(String(trace)); b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); } catch (e) { throw new Error('Not a trace'); }
  const dv = new DataView(b.buffer), m = Math.floor(b.length / (GH_F * 2));
  if (m < 20) throw new Error('Too short a trace');
  const X = new Float32Array(m), Z = new Float32Array(m);
  for (let k = 0; k < m; k++) { X[k] = dv.getInt16(k * GH_F * 2, true) * GH_POS; Z[k] = dv.getInt16((k * GH_F + 2) * 2, true) * GH_POS; }
  const Pt = botPath(), P = Pt.P, n = Pt.n, e = new Float32Array(n), v = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let bk = 0, bd = Infinity;
    for (let k = 0; k < m; k++) { const d = (X[k] - P[i].x) ** 2 + (Z[k] - P[i].z) ** 2; if (d < bd) { bd = d; bk = k; } }
    e[i] = (X[bk] - P[i].x) * P[i].tz - (Z[bk] - P[i].z) * P[i].tx;
    const a = Math.max(0, bk - 1), c = Math.min(m - 1, bk + 1);
    v[i] = Math.hypot(X[c] - X[a], Z[c] - Z[a]) / ((c - a) * GH_DT || GH_DT);
  }
  const sm = (arr, r) => { const o = new Float32Array(n); for (let i = 0; i < n; i++) { let t = 0; for (let j = -r; j <= r; j++) t += arr[(i + j + n) % n]; o[i] = t / (2 * r + 1); } return o; };
  const d = { e: [...sm(e, 4)], v: [...sm(v, 3)], m };
  // a lap from the grid is slow off the line, where a flying lap (an exam's, Drive it's) is at speed: from the start
  // line on, the speed the lap ends at, until it has got there or slows for a bend; then eased down to its own
  aiLineAt(0);
  const i0 = AI.s0, vEnd = d.v[(i0 - 3 + n) % n];
  if (d.v[(i0 + 3) % n] < 0.7 * vEnd) {
    let k = 0;
    for (; k < n / 2; k++) { const i = (i0 + k) % n; if (d.v[i] >= vEnd || (k > 20 && d.v[(i + 5) % n] < d.v[i] - 0.3)) break; d.v[i] = vEnd; }
    for (let j = k - 1; j >= 0; j--) { const i = (i0 + j) % n; d.v[i] = Math.min(d.v[i], Math.sqrt(d.v[(i + 1) % n] ** 2 + 2 * P[i].brk * AI_CFG.gBrake * 9.81 / 7.5 * Pt.ds)); }
    d.grid = true;
  }
  return d;
}
// (asked at every decision, by the pace notes and the racing line: courseKey hashes the whole course, so it is looked at
// again only when the track or the car changes, or a second on; a third of a try's time went on it)
function aiDemoNow() {
  const now = performance.now(), ck = AI.demoCk;
  if (ck && ck.T === TRACK && ck.v === VEH.key && now - ck.t < 1000) return AI.demo;
  const key = `sandbuggy.ai.demo.${courseKey()}.${VEH.key}`;
  if (AI.demoKey !== key) {
    AI.demoKey = key; AI.demo = null; AI.lineFor = AI.paceFor = null;
    try { const d = JSON.parse(localStorage.getItem(key) || 'null'); if (d?.e) AI.demo = { e: Float32Array.from(d.e), v: Float32Array.from(d.v), m: d.m, who: d.who || '', time: d.time ?? null, src: d.src || '' }; } catch (e) { }
  }
  AI.demoCk = { T: TRACK, v: VEH.key, t: now };
  return AI.demo;
}
// A racing line (AI_CFG.racingLine), instead of the course's centre: the smoothest path within the road, kept 1.6 m
// inside its edges (the tarmac's on road, the gate posts' off it): each point slid across the road toward the middle of
// its neighbours some way off, again and again, from far ones (the shape of a bend) to near ones (its detail). Its
// points match the centre's one for one (e: how far left of it); its own direction and curvature for the bearings
// and the pace notes.
function aiLine() {
  const D = aiDemoNow();
  if (!AI_CFG.racingLine && !D) return null;
  const Pt = botPath(), W = AI_CFG.lineW > 0 ? AI_CFG.lineW : Math.max(0.5, aiHalfW() - 1.6), key = (D ? `demo${D.m}` : `${W}`) + (AI_CFG.onRoad ? 'road' : '');   // (or as much room as set)
  if (AI.lineFor === Pt && AI.lineKey === key) return AI.line;
  const P = Pt.P, n = Pt.n, e = D ? Float32Array.from(D.e) : new Float32Array(n), x = new Float32Array(n), z = new Float32Array(n);
  if (AI_CFG.onRoad) { const m = Math.max(0, aiHalfW() - CAR_HW - 0.3); for (let i = 0; i < n; i++) e[i] = clamp(e[i], -m, m); }   // (staying on the road: a demo's corners cut back inside it)
  const at = i => { x[i] = P[i].x + P[i].tz * e[i]; z[i] = P[i].z - P[i].tx * e[i]; };
  for (let i = 0; i < n; i++) at(i);
  if (!D) for (const span of [24, 16, 10, 6, 3]) for (let it = 0; it < 250; it++) for (let i = 0; i < n; i++) {
    const a = (i - span + n) % n, b = (i + span) % n, mx = (x[a] + x[b]) / 2, mz = (z[a] + z[b]) / 2;
    const want = (mx - P[i].x) * P[i].tz - (mz - P[i].z) * P[i].tx;              // the middle's offset across the road here
    e[i] = clamp(e[i] + (want - e[i]) * 0.5, -W, W); at(i);
  }
  const L = { e, x, z, tx: new Float32Array(n), tz: new Float32Array(n), k: new Float32Array(n), ds: 0 };
  let len = 0;
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n, b = (i + 1) % n, dx = x[b] - x[a], dz = z[b] - z[a], l = Math.hypot(dx, dz) || 1;
    L.tx[i] = dx / l; L.tz[i] = dz / l; len += Math.hypot(x[b] - x[i], z[b] - z[i]);
  }
  L.ds = len / n;
  const kr = new Float32Array(n);
  for (let i = 0; i < n; i++) { const a = (i - 3 + n) % n, b = (i + 3) % n; kr[i] = Math.asin(clamp(L.tx[a] * L.tz[b] - L.tz[a] * L.tx[b], -1, 1)) / (6 * L.ds); }
  for (let i = 0; i < n; i++) { let sm = 0; for (let j = -4; j <= 4; j++) sm += kr[(i + j + n) % n]; L.k[i] = -sm / 9; }
  L.len = len;
  AI.lineFor = Pt; AI.lineKey = key;
  return AI.line = L;
}
// st follows a car (at x, z) along the line: {i: the nearest point (-1: look everywhere), dist: metres along, lat: + left of it}
function aiTrack(st, x, z) {
  const Pt = botPath(), P = Pt.P, n = Pt.n;
  let bi = st.i, bd = Infinity;
  const look = j => { j = ((j % n) + n) % n; const q = P[j], d = (q.x - x) ** 2 + (q.z - z) ** 2; if (d < bd) { bd = d; bi = j; } };
  if (st.i >= 0) for (let k = -6; k <= 14; k++) look(st.i + k);
  if (st.i < 0 || bd > 400) { bd = Infinity; for (let j = 0; j < n; j++) look(j); st.i = bi; }
  let di = bi - st.i; if (di > n / 2) di -= n; else if (di < -n / 2) di += n;
  st.dist += di * Pt.ds; st.i = bi;
  const p = P[bi]; st.lat = (x - p.x) * p.tz - (z - p.z) * p.tx;
  return bi;
}
// what the car sees (AI.other: the rival's st and velocity, or null)
function aiObserve(st, dt = AI_DT) {
  const Pt = botPath(), P = Pt.P, n = Pt.n, bi = aiTrack(st, car.pos.x, car.pos.z);
  const q = car.q, fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y), fl = Math.hypot(fx, fz) || 1, cx = fx / fl, cz = fz / fl;
  const p = P[bi], v = car.vel.x * cx + car.vel.z * cz;
  const brg = [], RL = aiLine(), off = RL ? st.lat - RL.e[bi] : st.lat;   // off: from the line followed (the racing line, or the centre)
  for (let k = 0; k < AI_LOOK.length; k++) {
    const ahead = AI_CFG.lookTime ? Math.max(AI_LOOK_MIN[k], Math.abs(v) * AI_LOOK_T[k]) : AI_LOOK[k];   // metres; by time: as far as it goes in so long
    const m = (bi + Math.round(ahead / Pt.ds)) % n, a = AI.look[k] = RL ? { x: RL.x[m], z: RL.z[m] } : P[m], dx = a.x - car.pos.x, dz = a.z - car.pos.z;
    brg.push((cx * dz - cz * dx) / (Math.hypot(dx, dz) || 1) * AI_CFG.bearing);   // the sine of its bearing: no jump from +180° to -180° in a hairpin
  }
  let j = 0;
  AI.rayEnds.length = 0;
  // the g, from the change of velocity since the last decision, smoothed
  if (st.pv) {
    const ax = (car.vel.x - st.pv[0]) / Math.max(dt, 1e-3), az = (car.vel.z - st.pv[1]) / Math.max(dt, 1e-3), kf = Math.min(1, dt / 0.1);
    st.gf = (st.gf || 0) + ((ax * cx + az * cz) / 9.81 - (st.gf || 0)) * kf;
    st.gs = (st.gs || 0) + ((ax * cz - az * cx) / 9.81 - (st.gs || 0)) * kf;
  }
  st.pv = [car.vel.x, car.vel.z];
  for (const id of AI.inputs) switch (id) {
    case 'speed': aiX[j++] = v / 20; break;
    case 'line6': aiX[j++] = brg[0]; break;
    case 'line15': aiX[j++] = brg[1]; break;
    case 'line30': aiX[j++] = brg[2]; break;
    case 'line50': aiX[j++] = brg[3]; break;
    case 'line100': aiX[j++] = brg[4]; break;
    case 'offset': aiX[j++] = off / 5; break;
    case 'yaw': aiX[j++] = car.w.y / 2; break;
    case 'pace': aiX[j++] = (aiPace()[bi] * AI_CFG.pace - v) / 10; break;   // (the notes for the grip set: aiPace)                    // the course's pace note: how much faster it could go here
    case 'ahead': aiX[j++] = (aiPace()[(bi + Math.round(Math.max(AI_AHEAD_MIN, Math.abs(v) * AI_AHEAD_T) / Pt.ds)) % n] * AI_CFG.pace - v) / 10; break;
    case 'edges': { const W = aiHalfW(); aiX[j++] = (W - st.lat) / 10; aiX[j++] = (W + st.lat) / 10; break; }
    case 'rays': AI_RAYS.forEach((a, k) => { aiX[j++] = aiRay(cx, cz, a, k) / AI_RAY_MAX; }); break;
    case 'slide': aiX[j++] = (car.vel.x * cz - car.vel.z * cx) / 10; break;
    case 'wslip': for (const fr of [true, false]) { let t = 0, k = 0; for (const W of car.wheels) if (W.front === fr && W.contact) { t += W.slip || 0; k++; } aiX[j++] = k ? clamp(t / k, -1, 1) : 0; } break;
    case 'rival': {                                                    // (smoothly from ahead to behind over 4 m: no jump alongside)
      const o = AI.other; let a = 0, b = 0, sd = 0, cl = 0;
      if (o && o.st.i >= 0) {
        const g = aiGap(o.st.i - bi), near = Math.max(0, 1 - Math.abs(g) / AI_RV_NEAR), f = clamp(0.5 + g / 4, 0, 1), q2 = P[o.st.i];
        a = near * f; b = near * (1 - f); sd = clamp((o.st.lat - st.lat) / 5, -2, 2) * near;
        cl = clamp(((car.vel.x * p.tx + car.vel.z * p.tz) - (o.vel.x * q2.tx + o.vel.z * q2.tz)) / 10, -2, 2) * near;
      }
      aiX[j++] = a; aiX[j++] = b; aiX[j++] = sd; aiX[j++] = cl; break;
    }
    case 'sink': { let d = 0; for (const W of car.wheels) if (W.contact) d = Math.max(d, W.sink || 0); aiX[j++] = d / 0.2; break; }
    case 'g': aiX[j++] = st.gf || 0; aiX[j++] = st.gs || 0; break;
    case 'tilt': {                                                     // the body's +x (left) and +z (nose) axes: how high they point
      const r = Math.asin(clamp(2 * (q.x * q.y + q.w * q.z), -1, 1)), pt = Math.asin(clamp(2 * (q.y * q.z - q.w * q.x), -1, 1));
      aiX[j++] = r * 6 / Math.PI; aiX[j++] = pt * 6 / Math.PI; break;
    }
  }
}
// like the keyboard (an option for each): only full, nothing or full the other way, past a third either side
const aiKey3 = v => v > 1 / 3 ? 1 : v < -1 / 3 ? -1 : 0;
// without the brake (AI.nb): the pedal is gas or nothing (its − half: off); it slows by lifting off, or with the handbrake
function aiAct(w, st, dt, rules = true) {
  aiObserve(st, dt); aiNet(w, aiX, aiY); AI.viewW = w; AI.nAct++;
  const steer = AI.applied[0] = AI.ks ? aiKey3(aiY[0]) : aiY[0], pedal = AI.applied[1] = Math.max(AI.nb ? 0 : -1, AI.kp ? aiKey3(aiY[1]) : aiY[1]);
  const want = AI.nOut > 2 && aiY[2] > 0, hb = want && (!rules || aiHbOk(pedal));
  AI.hbHeld = want && !hb;                                            // (asked for, held back by the rules)
  return AI.lastCtl = { throttle: Math.max(0, pedal), brake: Math.max(0, -pedal), steer, handbrake: hb };
}
// the handbrake's rules (AI_CFG): only with the wheels turned (hbTurn: at least hbLock of the lock the car has at this
// speed, the wheels' angle, not the steering output: they turn at their own rate), never with the brake (hbNoBrake). In
// every try, exam and drive, so it learns where the handbrake still pays within them; the rival (its own brain) is free
function aiHbOk(pedal) {
  if (AI_CFG.hbNoBrake && pedal < 0) return false;
  if (AI_CFG.hbTurn) {
    const max = lerp(VEH.steerLock, VEH.steerLock * 0.33, clamp(Math.abs(car.vel.dot(fwd)) / 24, 0, 1));   // (readInput's)
    if (Math.abs(car.steer) < AI_CFG.hbLock * max) return false;
  }
  return true;
}
// readInput's controls while training or driving (null: the player's)
function aiInput(dt) {
  if (AI.training) return AI.ctl;
  if (!AI.drive) return null;
  if (keys.KeyW || keys.KeyS || keys.KeyA || keys.KeyD || keys.ArrowUp || keys.ArrowDown || keys.ArrowLeft || keys.ArrowRight) {
    AI.drive = false; flash('You have the wheel', '#fff', 1.5); aiShow(); return null;
  }
  // as it was trained and examined: a decision every AI_DT, held between (one a frame, at 120 Hz or more, drives otherwise)
  AI.dAcc = (AI.dAcc || 0) + dt;
  if (!AI.dCtl || AI.dAcc >= AI_DT) { AI.dAcc = Math.min(AI.dAcc - AI_DT, AI_DT); AI.dCtl = aiAct(AI.best || AI.w, AI.dst, AI_DT); aiMapRec(); }
  return AI.dCtl;
}

// ---------- training ----------
// a training per course, car, size and inputs (the original 7 without the handbrake: no suffix)
const aiSig = () => AI.hb || AI.kp || AI.ks || AI.nb || AI.inputs.join() !== AI_DEFAULT_INPUTS.join() ? '.' + AI.inputs.join('+') + (AI.hb ? '+hb' : '') + (AI.kp ? '+kp' : '') + (AI.ks ? '+ks' : '') + (AI.nb ? '+nobrake' : '') : '';
const aiKey = () => `sandbuggy.ai.${courseKey()}.${VEH.key}.${AI.h}${aiSig()}`;
const aiGauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
// the network that drives (Drive it: the best weights) as the server has it (#333): AI.ident { id, name, creator, sig } is
// the saved network it was loaded from or saved as, sig its driving weights' signature then; once training has changed
// them it is an unsaved network, its maker whoever drives it
function aiNetSig(w) { let h = 2166136261; for (const x of new Uint32Array(Float32Array.from(w).buffer)) h = Math.imul(h ^ x, 16777619); return (h >>> 0).toString(36); }
function aiNetMark() {
  const w = AI.best || AI.w, I = AI.ident, saved = !!(I && w && I.sig === aiNetSig(w));
  return { id: saved ? I.id : null, name: saved ? I.name : 'Unsaved network', creator: saved ? I.creator : 'you', weights: AI.np, h: AI.h };
}
function aiFresh() {
  const n = AI.np = aiShape(AI.inputs, AI.hb, AI.h).np, b = n - AI.nOut;
  Object.assign(AI, { w: new Float32Array(n), m: new Float32Array(n), v: new Float32Array(n), k: 0, gen: 0, best: null, bestFit: -1, bestLap: null, sinceBest: 0, hist: [], cands: null, ep: null, examKind: aiExamKind(), rvPool: [], bestSolo: null, bestAt: null, ident: null, past: [], pastHist: [], fromGen: 0 });
  for (let i = 0; i < n; i++) AI.w[i] = aiGauss() * 0.1;
  AI.w[b + 1] = 0.5;                                                  // a little throttle to begin with, or nothing moves
  if (AI.nOut > 2) AI.w[b + 2] = -1;                                  // the handbrake off, until it learns better
}
function aiLoad() {
  AI.key = aiKey(); aiFresh(); AI.lastExam = AI.lastExamRace = null;
  try {
    const d = JSON.parse(localStorage.getItem(AI.key) || 'null');
    if (d && d.w?.length === AI.np) {                                 // (#341) the last exam, the rivals
      if (d.last && typeof d.last === 'object') AI.lastExam = d.last;
      if (Array.isArray(d.rv)) AI.rvPool = d.rv.filter(w => Array.isArray(w) && w.length === AI.np).slice(-4).map(w => Float32Array.from(w));
    }
    if (d && d.w?.length === AI.np) Object.assign(AI, { w: Float32Array.from(d.w), m: Float32Array.from(d.m || AI.m), v: Float32Array.from(d.v || AI.v), k: d.k || 0, gen: d.gen || 0,
      best: d.best?.length === AI.np ? Float32Array.from(d.best) : null, bestFit: d.bestFit ?? -1, bestLap: d.bestLap ?? null, hist: d.hist || [], sinceBest: d.sinceBest | 0, examKind: d.exam || 'line', bestSolo: d.bestSolo ?? null, bestAt: d.bestAt || null, ident: d.ident && typeof d.ident.id === 'string' ? d.ident : null });
    if (d && d.w?.length === AI.np) aiPastRead(d);                     // (#351: the circuits it was trained on before)
  } catch (e) { }
}
function aiSave() {
  if (AI.preview) return;                                             // (a network previewed, #336: not this browser's)
  if (!AI.key || !AI.w) return false;                                 // (nothing loaded yet)
  const KEEP = 20000;                                                 // generations of chart kept (each ~20 bytes)
  const rec = { w: [...AI.w], m: [...AI.m], v: [...AI.v], k: AI.k, gen: AI.gen, best: AI.best && [...AI.best], bestFit: AI.bestFit, bestLap: AI.bestLap, sinceBest: AI.sinceBest, hist: AI.hist.slice(-KEEP), exam: AI.examKind, bestSolo: AI.bestSolo, bestAt: AI.bestAt || null, ident: AI.ident || null,
    last: AI.lastExam || null, rv: AI.rvPool.map(w => [...w]), past: AI.past, pastHist: AI.pastHist, from: AI.fromGen };   // (#341: the last exam and the rivals too, and the whole chart)
  for (const n of [KEEP, 2000, 300, 0]) {                    // storage short: the chart's oldest generations go first
    if (rec.hist.length > n) rec.hist = n ? rec.hist.slice(-n) : [];
    else if (n < KEEP) continue;
    try { localStorage.setItem(AI.key, JSON.stringify(rec)); AI.saveFail = false; return true; } catch (e) { }
  }
  if (!AI.saveFail && !AI_WK) flash('Browser storage is full: this training is no longer saved in this browser (Save to file keeps it)', '#ff8a7a', 5);
  AI.saveFail = true;
  return false;
}
if (!AI_WK) {
  addEventListener('pagehide', () => aiSave());
  document.addEventListener('visibilitychange', () => { if (document.hidden) aiSave(); });
}
function aiNewGen() {
  AI.eps = []; AI.cands = []; AI.fits = new Float32Array(AI_CFG.pop); AI.ci = 0;
  for (let p = 0; p < AI_CFG.pop / 2; p++) {
    const e = new Float32Array(AI.np); for (let i = 0; i < AI.np; i++) e[i] = aiGauss();
    AI.eps.push(e);
    for (const sg of [1, -1]) { const c = new Float32Array(AI.np); for (let i = 0; i < AI.np; i++) c[i] = AI.w[i] + sg * AI_CFG.sigma * e[i]; AI.cands.push(c); }
  }
}
function aiEndGen() {
  // ranks, -0.5 .. 0.5, so one lucky episode doesn't run away with it
  const order = [...AI.fits.keys()].sort((a, b) => AI.fits[a] - AI.fits[b]), u = new Float32Array(AI_CFG.pop);
  order.forEach((c, r) => { u[c] = r / (AI_CFG.pop - 1) - 0.5; });
  const g = new Float32Array(AI.np);
  AI.eps.forEach((e, p) => { const d = u[2 * p] - u[2 * p + 1]; for (let i = 0; i < AI.np; i++) g[i] += d * e[i] / (AI_CFG.pop * AI_CFG.sigma); });
  AI.k++;
  const b1 = 1 - 0.9 ** AI.k, b2 = 1 - 0.999 ** AI.k, lr = AI_CFG.lr * (AI.bestLap != null || AI.hist.some(h => h[2] != null) ? 0.3 : 1);   // smaller steps once it laps (or did, under an exam since made harder): refine, don't wander off
  for (let i = 0; i < AI.np; i++) {
    AI.m[i] = 0.9 * AI.m[i] + 0.1 * g[i]; AI.v[i] = 0.999 * AI.v[i] + 0.001 * g[i] * g[i];
    AI.w[i] += lr * (AI.m[i] / b1) / (Math.sqrt(AI.v[i] / b2) + 1e-8);
  }
  let sum = 0, mx = -Infinity; for (const f of AI.fits) { sum += f; mx = Math.max(mx, f); }
  AI.tryAvg = sum / AI_CFG.pop;
  AI.cands = null; AI.exam = true;                                     // next: the new weights, from the start line
}
// a drive: w from d metres along the racing line (0: the start line, behind it as a lap starts), at most limit s;
// lead: so many metres driven before the lap that counts starts (a flying lap: a whole lap first); laps: so many timed
// sc: with the rival (a scenario: aiScenario, aiRaceScen), else alone
function aiStartEpisode(w, d, limit, lead = 0, laps = 1, sc = null) {
  const R = sc ? aiRival() : null;
  if (R) {
    R.mode = AI_CFG.rival === 'replay' ? 'replay' : 'car'; R.w = R.brain ? R.brain.w : sc.w; R.skill = sc.skill;
    if (R.mode === 'replay' && !sc.tape) sc.tape = aiRvRecord(R, (d || -8) + sc.gap, sc.lat, !!d && AI_CFG.rolling, limit, lead + laps * botPath().len + 40);   // (before the ground is put back)
    R.tape = sc.tape;
  }
  aiGroundBack();
  repairAll(); AI.acc = 0;
  aiPlaceCar(d, sc ? sc.myLat : 0, !d && !sc, true, !!d && AI_CFG.rolling);
  if (R) {
    aiRvSwap(R); repairCar(); aiPlaceCar((d || -8) + sc.gap, sc.lat, false, false, !!d && AI_CFG.rolling); aiRvSwap(R);
    aiRvReady(R);
  }
  if (AI.rv) AI.rv.on = !!R;
  AI.ep = { w, st: { i: -1, dist: 0, lat: 0 }, t: 0, max: 0, chk: 0, chkDist: 0, limit, offM: 0, swing: 0, pc: null, driven: 0, lead, laps, t0: lead ? null : 0, mark: 0, times: [], hb: 0, hbHeld: 0,
    rv: !!R, sc, contact: 0, touches: 0, touching: false, k: 0 };
}
// the car in `car` (ours, or the rival swapped in) d m along the line (0: behind the start line), lat m to the left of it;
// gate: at the start gate, as a lap starts; mine: our car (the lap's timing follows it); roll: rolling (AI_CFG.rolling)
function aiPlaceCar(d, lat, gate, mine, roll) {
  if (gate) placeAtGate(0, -8);
  else { const q = aiLineAt(d || -8); resetCar(q.x + q.tz * lat, q.z - q.tx * lat, Math.atan2(q.tx, q.tz)); if (mine) lap.prev.copy(car.pos); }
  // as a fresh car: nothing carried over from the last drive (gear, revs, wheel spin, steering), or no two drives compare
  for (const W of car.wheels) Object.assign(W, { omega: 0, spin: 0, t: car.REST, comp: 0, contact: false, sink: 0, slip: 0, slipSpeed: 0 });
  Object.assign(car.eng, { gear: 1, rpm: ENG.idle, cut: false, shiftT: 0, reverse: false, load: 0, liftT: 9, tc: 1, sinceShift: 0, lastPower: 0, popT: 0 });
  car.throttle = 0; car.steer = 0;
  // rolling (AI_CFG.rolling): a try away from the start line begins at most of the pace note's speed there, in a gear that
  // suits it, as the car would arrive in a lap (from a standstill, most of a try is spent getting up to speed)
  if (roll) {
    const Pt = botPath(), i = ((AI.s0 + Math.round(d / Pt.ds)) % Pt.n + Pt.n) % Pt.n, v0 = Math.min(aiPace()[i] * 0.85, 45);
    const f = 2 * (car.q.x * car.q.z + car.q.w * car.q.y), g = 1 - 2 * (car.q.x ** 2 + car.q.y ** 2), fl = Math.hypot(f, g) || 1;
    car.vel.set(f / fl * v0, 0, g / fl * v0);
    const om = v0 / car.R; for (const W of car.wheels) W.omega = om;
    let gear = 1; while (gear < ENG.gears.length && om * ENG.gears[gear - 1] * ENG.fd * 60 / (2 * Math.PI) > ENG.limiter * 0.8) gear++;
    Object.assign(car.eng, { gear, rpm: Math.max(ENG.idle, om * ENG.gears[gear - 1] * ENG.fd * 60 / (2 * Math.PI)) });
    car.throttle = 1;
  }
}
// one physics step of the episode under way: its score when it ends, else null
function aiStep() {
  const E = AI.ep, len = botPath().len, R = E.rv ? AI.rv : null;
  AI.other = R ? { st: R.st, vel: R.c.vel } : null;                   // what ours sees of the rival
  AI.ctl = aiAct(E.w, E.st, AI_DT); if (AI.hbHeld) E.hbHeld += AI_DT;   // (how long the rules held the handbrake back)
  if (E.pc) E.swing += Math.abs(AI.applied[0] - E.pc[0]) + Math.abs(AI.applied[1] - E.pc[1]);   // how much the controls moved
  E.pc = [AI.applied[0], AI.applied[1]];
  if (AI.ctl.handbrake) E.hb += AI_DT;                                   // how long it pulls the handbrake
  if (R && R.mode === 'car') aiRvDecide(R, E.st);
  readInput(AI_DT);
  if (R && R.mode === 'car') { aiRvSwap(R); readInput(AI_DT); aiRvSwap(R); }
  AI.acc += AI_DT;
  while (AI.acc >= DT) { stepCar(DT); collideGates(DT); if (R) aiRvSub(R, E, E.st, DT); AI.acc -= DT; }
  car.grace = Math.max(0, car.grace - AI_DT); hitCooldown = 1;   // (no crash messages for each try)
  if (R) aiRvLate(R, ++E.k, AI_DT);
  E.t += AI_DT; E.max = Math.max(E.max, E.st.dist); AI.nSim += AI_DT;
  const sp = Math.hypot(car.vel.x, car.vel.z) * AI_DT; E.driven += sp;
  const offNow = Math.abs(E.st.lat) + (AI_CFG.onRoad ? CAR_HW : 0) > aiHalfW();   // off the road (staying on it: any of the car)
  if (offNow) E.offM += sp;
  if (E.t0 == null && E.st.dist >= E.lead) E.t0 = E.mark = E.t;        // a flying lap: the clock starts at the line, a lap on
  if (E.t0 != null && E.st.dist >= E.lead + (E.times.length + 1) * len) { E.times.push(E.t - E.mark); E.mark = E.t; }   // a timed lap done
  const why = E.times.length >= E.laps ? 'lap' : Math.abs(E.st.lat) > AI_CFG.off || (AI_CFG.onRoad && E.exam && offNow) ? 'off' : E.st.dist < E.max - 15 ? 'back' : car.wrecked ? 'wreck' : up.y < 0.3 ? 'over'
    : E.t >= E.limit ? 'time' : E.t >= E.chk + 4 && E.st.dist - E.chkDist < 4 ? 'stuck' : null;
  if (E.t >= E.chk + 4) { E.chk = E.t; E.chkDist = E.st.dist; }
  if (!why) return null;
  // (from the line, the second time on a flying lap); timed laps: the slowest counts, so a network has to keep it up
  const timed = E.t - (E.t0 ?? E.t), run = E.times.length ? Math.max(...E.times) : timed, prog = E.max - E.lead;
  const dmg = 1 - carCondition(), kmh = Math.max(0, prog) / Math.max(timed, 1) * 3.6, extra = Math.max(0, E.driven - E.max);
  const gain = R ? E.st.dist - R.st.dist : 0, cpen = R ? AI_PEN.contact * E.contact - AI_PEN.gain * gain : 0;   // the rival: its impacts, the metres gained on it
  const pen = AI_PEN.offRoad * E.offM + AI_PEN.damage * dmg + (car.wrecked ? AI_PEN.wreck : 0) + AI_PEN.smooth * E.swing + AI_PEN.path * extra - AI_PEN.speed * kmh + cpen;
  const fit = (why === 'lap' ? len + AI_LAP_BONUS * Math.max(0, aiLapT() - run) : prog / E.laps) - pen;   // (not all the laps: below any that did them)
  const vEnd = Math.round(Math.hypot(car.vel.x, car.vel.z) * 3.6);   // (km/h, as it ended: what ending badly costs, aiEndCost)
  AI.last = { why, at: Math.round(prog), vEnd, t: +E.t.toFixed(1), lap: why === 'lap' ? +run.toFixed(2) : null, laps: E.times.map(x => +x.toFixed(2)), hb: +E.hb.toFixed(1), hbHeld: +E.hbHeld.toFixed(1), x: Math.round(car.pos.x), z: Math.round(car.pos.z), offM: Math.round(E.offM), dmg: Math.round(dmg * 100), wrecked: car.wrecked, pen: Math.round(pen), kmh: Math.round(kmh), swing: +E.swing.toFixed(1), extra: Math.round(extra),
    rival: R ? { kind: E.sc.kind, contact: +E.contact.toFixed(1), touches: E.touches, gain: Math.round(gain), cpen: Math.round(cpen), dmgF: dmg } : null };
  return fit;
}
// The ground as the world was built (the heights are B's, the editor's strokes in both; how packed it is, C, is kept
// here): tries and exams start on it, not on whatever the driving before them wore into it (ruts, loosened sand, a
// lap's worth of an exam at 31.48 s ran 31.68 after a few laps of Drive it)
function aiFreshGround() { AI.freshC = C.slice(); aiGT.all = true; }
// the ground put back as built (or as it was when training began, AI.snapH/snapC) for a try or an exam: only the 16 m
// chunks driving changed since the last time (markDirty notes them in aiGT), not both 10 MB grids, a sixth of a
// training's time; all of it when anything else may have changed the ground (aiGT.all: a new ground, training
// starting or stopping, a worker set up, Race it's tape)
function aiGroundBack() {
  const h = AI.freshC ? B : AI.snapH, c = AI.freshC || AI.snapC;
  if (aiGT.all || aiGT.src !== c) { H.set(h); C.set(c); aiGT.all = false; aiGT.src = c; aiGT.set.clear(); return; }
  for (const id of aiGT.set) {
    const a = id % NCH, b = (id - a) / NCH, i0 = a * CH, i1 = Math.min(N, i0 + CH), j1 = Math.min(N, b * CH + CH);
    for (let j = b * CH; j <= j1; j++) { const k0 = j * V + i0, k1 = j * V + i1 + 1; H.set(h.subarray(k0, k1), k0); C.set(c.subarray(k0, k1), k0); }
  }
  aiGT.set.clear();
}
// the exam: a lap from the start line; a flying one (AI_CFG.flying), the second of two in a row, as Drive it's after the
// first (on the ground the first has worn and with its knocks: nothing put back between them)
// what an exam's score depends on besides the weights (the exam, what the network is shown, what it's scored on): when
// it changes, the best's score is another exam's
function aiExamKind() {
  return [AI_CFG.flying ? (AI_CFG.examLaps > 1 ? 'flying2x' + AI_CFG.examLaps : 'flying2') : 'line', AI_CFG.pace, AI_CFG.gCorner, AI_CFG.gBrake, AI_CFG.gAccel, AI_CFG.racingLine ? AI_CFG.lineW : '-',
    AI_CFG.lookTime ? 't' : 'm', AI_CFG.off + (AI_CFG.onRoad ? 'road' : ''), (D => D ? 'demo' + (D.time ? Math.round(D.time * 1000) : '') : '')(aiDemoNow()), JSON.stringify(AI_PEN), ...(aiRaceExam() ? ['race:' + AI_CFG.rival + (aiRivalKey() !== VEH.key ? ':' + aiRivalKey() + ':' + (AI.rv?.brain?.lap ?? '') : '')] : []),
    ...(aiLapT() > AI_T ? ['T' + Math.round(aiLapT())] : []),        // (a long course's lap time, #348)
    ...(car.awd && car.split !== 0.5 ? ['split' + car.split] : []),
    ...(car.pIdx !== VEH.pIdx ? ['psi' + PRESSURES[car.pIdx].psi] : []), ...(car.awd !== !!VEH.awd ? ['awd' + +car.awd] : []),   // (#332)
    ...(AI.nOut > 2 && (AI_CFG.hbTurn || AI_CFG.hbNoBrake) ? ['hb' + (AI_CFG.hbTurn ? 'turn' + AI_CFG.hbLock : '') + (AI_CFG.hbNoBrake ? 'nobrake' : '')] : [])].join(' ');   // (the handbrake's rules)   // (all-wheel drive split unevenly: another car to drive)
}
// with a rival (AI_CFG.rival), each exam is also a race: a lap from the grid alongside it (the latest of the rivals, at its
// best), whose impacts, damage and not finishing cost (aiRaceCost)
const aiRaceExam = () => AI_CFG.rival !== 'off' && !!aiRival();
const aiRaceScen = () => { const g = Math.min(2.2, aiHalfW() * 0.4); return { kind: 'race', gap: 0, lat: g, myLat: -g, skill: 1, w: AI.rvPool[AI.rvPool.length - 1] || AI.best || AI.w }; };
const aiRaceCost = L => (L.why === 'lap' ? 0 : AI_CFG.crash) + (L.rival ? L.rival.cpen + AI_PEN.damage * L.rival.dmgF : 0) + (L.wrecked ? AI_PEN.wreck : 0);
// an exam now: {fit, solo: the lap's score without the race}; AI.last is the lap's, AI.lastRace the race's
function aiExamRun(w) {
  aiExamStart(w); let fit; while ((fit = aiStep()) == null) { }
  AI.ep = null; AI.lastRace = null;
  if (!aiRaceExam()) return { fit, solo: fit };
  const solo = AI.last; aiStartEpisode(w, 0, aiLapT(), 0, 1, aiRaceScen()); while (aiStep() == null) { }
  AI.ep = null; AI.lastRace = AI.last; AI.last = solo;
  return { fit: fit - aiRaceCost(AI.lastRace), solo: fit };
}
const aiExamStart = w => { AI_CFG.flying ? aiStartEpisode(w, 0, aiLapT() * (1 + AI_CFG.examLaps) / 2, botPath().len, AI_CFG.examLaps) : aiStartEpisode(w, 0, aiLapT()); AI.ep.exam = true; };   // (an exam: staying on the road is a must)
// the racing line's point d metres on from the start line (botPath's start, s0, is elsewhere)
function aiLineAt(d) {
  const Pt = botPath();
  if (AI.s0path !== Pt) { const g = TRACK.gates[0]; let bi = 0, bd = Infinity; Pt.P.forEach((q, j) => { const e = (q.x - g.p.x) ** 2 + (q.z - g.p.z) ** 2; if (e < bd) { bd = e; bi = j; } }); AI.s0path = Pt; AI.s0 = bi; }
  return Pt.P[((AI.s0 + Math.round(d / Pt.ds)) % Pt.n + Pt.n) % Pt.n];
}
// What a try that ends badly (off the course, stuck, wrecked, backwards, over) costs, on top of the metres it didn't get
// (#348): AI_CFG.crash metres, and AI_CFG.crashKmh more for each km/h it was going as it ended: going off at 140 km/h
// costs more than at 60, so a try is told where it was too fast as well as that it failed.
const aiEndCost = L => L.why === 'time' || L.why === 'lap' ? 0 : AI_CFG.crash + AI_CFG.crashKmh * (L.vEnd || 0);
// A training that has lost the lap goes back to the best (#348). Its tries are 15 s stretches, one place on the lap a
// generation, and what pays on one stretch costs on another: after its first laps a training's weights wandered off
// them and its exams went off at one bend, for thousands of generations (on the X7's figure-8, laps in 100 of 600
// generations at best, in none after the first 100 at worst; the user's own: its best 4030 generations back). So once
// it has a lap, AI_LOST exams in a row without one take it back to the best weights (as Back to the best does), to look
// around them afresh. AI.backs: how many times in this training. AI_CFG.lostAfter (the lab's "back to the best after"):
// 1 keeps only the steps whose exam still laps; 0: never.
function aiLost(lap) {
  if (lap != null || AI.bestLap == null || !AI.best || !AI_CFG.lostAfter) { AI.lost = 0; return; }
  if (++AI.lost < AI_CFG.lostAfter || AI.best.length !== AI.w.length) return;
  AI.w.set(AI.best); AI.m.fill(0); AI.lost = 0; AI.backs = (AI.backs || 0) + 1;
}
// Where a generation's tries start (d metres on from the start line; 0: at the line, from a standstill as an exam starts):
// anywhere on the lap, or half the time 100 m before where the last exam went wrong, so that it practises there. Round
// the lap from the line (#348): a flying exam that goes off just after the line goes off arriving there at speed, and
// starting its tries at 1 m, from a standstill, never practised that. An exam that went wrong in its first 100 m, pulling
// away (AI.failStand): from the line, standing, the only place an exam starts from (with rolling starts no try did, and
// one from scratch learnt to keep going but never to get going: its exams stayed on the line).
function aiTryFrom() {
  const len = botPath().len;
  if (AI.fail == null || Math.random() >= 0.5) return 1 + Math.random() * (len - 1);
  if (AI.failStand) return 0;
  return ((AI.fail - 100) % len + len) % len || 1;
}
// a step of the training; false when the frame's work should stop (a generation done)
function aiTick() {
  if (!AI.cands && !AI.exam) { aiNewGen(); AI.from = aiTryFrom(); AI.scen = aiScenario(); }
  if (!AI.ep) AI.exam ? aiExamStart(AI.w) : aiStartEpisode(AI.cands[AI.ci], AI.from, AI_CFG.window, 0, 1, AI.scen);
  const E = AI.ep, len = botPath().len;
  let fit = aiStep();
  if (fit == null) return true;
  AI.ep = null;
  if (AI.exam) {                                                       // the generation's result
    if (aiRaceExam() && !AI.examSolo) {                                // the lap done: now the race
      AI.examSolo = { fit, last: AI.last, dist: E.st.dist };
      aiStartEpisode(E.w, 0, aiLapT(), 0, 1, aiRaceScen()); return true;
    }
    let solo = fit, dist = E.st.dist; AI.lastRace = null;
    if (AI.examSolo) { AI.lastRace = AI.last; AI.last = AI.examSolo.last; solo = AI.examSolo.fit; dist = AI.examSolo.dist; fit = solo - aiRaceCost(AI.lastRace); AI.examSolo = null; }
    AI.exam = false;
    AI.fail = AI.last.why !== 'lap' ? dist % len : null; AI.failStand = dist < 100;   // half the next tries start 100 m before: practise where it goes wrong
    const lapT = AI.last.lap;
    if (fit > AI.bestFit) { AI.bestFit = fit; AI.bestSolo = solo; AI.best = Float32Array.from(E.w); AI.bestLap = lapT; AI.sinceBest = AI.dry = 0; AI.bestAt = Date.now(); }
    else if (AI.bestLap != null) { AI.sinceBest++; AI.dry++; }          // it laps: how long since a better one (dry: in this training, #337)
    aiLost(lapT);
    if (AI.stopAfter && AI.bestLap != null && AI.dry >= AI.stopAfter) AI.autoStop = `no better lap in ${AI.stopAfter} generation${AI.stopAfter > 1 ? 's' : ''}`;
    if (AI.gens && AI.gen + 1 >= AI.genEnd) AI.autoStop = `${AI.gens} generation${AI.gens > 1 ? 's' : ''} done`;   // (gen counts this one just below)
    AI.hist.push([Math.round(fit), Math.round(AI.tryAvg), lapT]); AI.lastExam = AI.last; AI.lastExamRace = AI.lastRace;
    AI.gen++; aiRvKeep(); aiSave();
    return false;
  }
  AI.fits[AI.ci] = fit - aiEndCost(AI.last);                          // ending it badly costs: braking for a bend beats flying off it
  if (++AI.ci >= AI_CFG.pop) aiEndGen();
  return true;
}
// ---------- the best laps on this course: every training in this browser (a car, a network), the fastest first ----------
function aiBestLaps() {
  const pre = `sandbuggy.ai.${courseKey()}.`, flags = ['hb', 'kp', 'ks', 'nobrake'], rows = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i); if (!k || !k.startsWith(pre)) continue;
    const m = k.slice(pre.length).match(/^([^.]+)\.(\d+)(?:\.(.+))?$/); if (!m || !VEHICLE_LIST[m[1]]) continue;
    let d; try { d = JSON.parse(localStorage.getItem(k)); } catch (e) { continue; }
    if (d?.bestLap == null) continue;
    const tok = m[3] ? m[3].split('+') : [], inputs = m[3] ? tok.filter(t => !flags.includes(t)) : AI_DEFAULT_INPUTS, ex = String(d.exam || 'line').split(' ')[0];
    rows.push({ key: k, car: m[1], lap: d.bestLap, gen: d.gen | 0, at: d.bestAt || null, np: aiShape(inputs, tok.includes('hb'), +m[2]).np, h: +m[2],
      opts: [tok.includes('hb') && 'handbrake', tok.includes('nobrake') && 'no brake', tok.includes('kp') && '⌨ pedals', tok.includes('ks') && '⌨ steering', inputs.includes('rival') && 'rival inputs'].filter(Boolean),
      exam: ex === 'line' ? 'a lap from the line' : ex.startsWith('flying2x') ? `slowest of ${ex.slice(8)} flying laps` : 'a flying lap' });
  }
  return rows.sort((a, b) => a.lap - b.lap);
}
function aiLapsShow(force) {
  const box = AI.el.querySelector('#aiLaps'), now = performance.now();
  if (!force && now - (AI.lapsT || 0) < 3000 && AI.lapsBest === AI.bestLap) return;   // (it reads every training: now and then)
  AI.lapsT = now; AI.lapsBest = AI.bestLap;
  const rows = aiBestLaps(), ago = t => { const s = (Date.now() - t) / 1000; return s < 90 ? 'just now' : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`; };
  box.innerHTML = !rows.length ? '<div class="sub">No autopilot has lapped this course in this browser yet.</div>'
    : `<table><tr><th>Car</th><th>Best lap</th><th>Network</th><th>Gen.</th></tr>${rows.map((r, k) => `<tr class="${r.key === AI.key ? 'cur' : ''}" title="${r.exam}${r.opts.length ? ' · ' + r.opts.join(', ') : ''}${r.at ? ' · best set ' + ago(r.at) : ''}${r.key === AI.key ? ' · the one in training now' : ''}">`
      + `<td>${k === 0 ? '🏆 ' : ''}${VEHICLE_LIST[r.car].name}</td><td><b>${fmt(r.lap)}</b></td><td>${r.np} w${r.h ? ` · ${r.h} hidden` : ''}${r.opts.length ? ' · ' + r.opts.join(', ') : ''}</td><td>${r.gen}</td></tr>`).join('')}</table>`
      + '<div class="sub" style="margin-top:4px">Each its own exam (hover a row): compare laps of the same kind.</div>';
}
// ---------- how busy the cores are, and the memory (the panel, while it trains) ----------
// Browsers don't tell a page the CPU's load per core: measured instead, each second, is how much of it each of our
// threads spent working: this tab's frames (from the frame's start to its end: the training, the physics, drawing
// the scene), each worker's jobs (from being sent one to its answer). And the longest frame: the page freezing shows
// there. Memory: this tab's JavaScript heap (performance.memory, Chrome); a worker's isn't reported to the page.
const AI_LOAD = { t0: performance.now(), busy: 0, frames: 0, maxGap: 0, lastNow: 0, view: null, pressure: '', po: null };
function aiLoadGap(now) { if (AI_LOAD.lastNow) AI_LOAD.maxGap = Math.max(AI_LOAD.maxGap, now - AI_LOAD.lastNow); AI_LOAD.lastNow = now; AI_LOAD.frames++; }
function aiLoadTick() {
  const L = AI_LOAD, now = performance.now(), span = now - L.t0;
  if (span < 900) return;
  const pc = ms => Math.min(100, Math.round(ms / span * 100));
  L.view = { tab: pc(L.busy), fps: Math.round(L.frames * 1000 / span), maxGap: Math.round(L.maxGap),
    ws: AI_POOL.ws.map(x => ({ ok: x.ok, job: x.job ? x.job.kind : '', load: pc((x.acc || 0) + (x.job ? now - Math.max(x.jobT, L.t0) : 0)) })),
    heap: performance.memory ? { used: performance.memory.usedJSHeapSize, limit: performance.memory.jsHeapSizeLimit } : null };
  L.t0 = now; L.busy = 0; L.frames = 0; L.maxGap = 0;
  for (const x of AI_POOL.ws) x.acc = 0;
  if (!L.po && typeof PressureObserver === 'function') {              // the CPU's pressure, as Chrome tells it (nominal, fair, serious, critical)
    L.po = true;
    try { const o = new PressureObserver(r => { L.pressure = r[r.length - 1]?.state || ''; }); o.observe('cpu', { sampleInterval: 1000 }).catch(() => { }); } catch (e) { }
  }
  if (AI.open) aiLoadShow();
}
function aiLoadShow() {
  const el = AI.el.querySelector('#aiLoad'), V = AI_LOAD.view;
  if (!V || !(AI.training || AI_POOL.ws.length)) { el.style.display = 'none'; return; }
  el.style.display = '';
  const mb = b => Math.round(b / 1048576).toLocaleString('en') + ' MB';
  const bar = (name, load, what, tip) => `<div class="ld" title="${tip}"><span>${name}</span><i><b style="width:${load}%;background:${load > 85 ? '#d9621a' : '#3d97ee'}"></b></i><em>${load}%</em><small>${what}</small></div>`;
  el.innerHTML = `<div class="gh2">Cores, busy over the last second</div>`
    + bar('this tab', V.tab, AI.ep ? (AI.job ? AI.job.kind : 'try') : AI.training ? 'waiting' : '', 'This tab\'s main thread: its frames (the training\'s share of each, the physics, drawing), out of the time that went by')
    + V.ws.map((w, k) => bar(`worker ${k + 1}`, w.load, !w.ok ? 'starting' : w.job || 'idle', 'A copy of the sim in the background: the time it spent on its jobs (a try, an exam, a race)')).join('')
    + `<div class="lx" title="The longest time between two frames in the last second (above 100 ms the page stutters), the frames a second, and the CPU's pressure as Chrome reports it (nominal, fair, serious, critical)">Longest frame <b style="color:${V.maxGap > 100 ? '#ff8a7a' : 'inherit'}">${V.maxGap} ms</b> · ${V.fps} fps${AI_LOAD.pressure ? ` · CPU <b>${AI_LOAD.pressure}</b>` : ''}</div>`
    + `<div class="lx" title="This tab's JavaScript heap, and the most it may use (performance.memory). A worker's memory isn't reported to the page: about 70 MB each, measured once">Memory: tab ${V.heap ? `<b>${mb(V.heap.used)}</b> of ${mb(V.heap.limit)}` : '(not reported)'}${V.ws.length ? ` · workers ≈70 MB each` : ''}</div>`;
}
// ---------- training on several cores (AI_CFG.cores): the sim again, in Web Workers ----------
// Each worker runs this whole engine without a screen (AI_WK: its DOM a stub that takes anything, no frames, no render
// chunks), booted from a copy of this tab's localStorage with this course, ground and car, so it builds the same world
// (checked: the ground's hash) and drives a try or an exam with the same physics, as it is sent them. This tab plans the
// generations, drives its share of the tries (the ones on screen) and keeps the books; the workers take the other tries
// and the exams, which run while the next generation's tries do (whose start comes from the exam before: one late).
const AI_POOL = { log: [], ws: [], sig: '', src: null, jobs: [], exams: new Map(), seq: 0, next: 0, epoch: 0, gen: null, err: '' };
const aiCoresMax = () => Math.max(1, Math.min(16, navigator.hardwareConcurrency || 4));
const aiPoolOk = () => AI_POOL.ws.filter(x => x.ok).length;
// the job's drive, begun (in the tab: stepped a frame at a time; in a worker: all at once)
function aiParBegin(j) {
  if (j.kind === 'try') aiStartEpisode(j.w, j.from, AI_CFG.window, 0, 1, j.scen);
  else if (j.kind === 'race') aiStartEpisode(j.w, 0, aiLapT(), 0, 1, aiRaceScen());   // (the best against the newest rival: aiRvKeep)
  else { j.phase = 0; aiExamStart(j.w); }
}
// a drive of it ended with this score: the job's result (null: an exam's race, next)
function aiParEnd(j, fit) {
  const E = AI.ep; AI.ep = null;
  if (j.kind === 'try') return { fit: fit - aiEndCost(AI.last), why: AI.last.why, at: AI.last.at };   // (as aiTick)
  if (j.kind === 'race') { const cost = aiRaceCost(AI.last); return { fit: -cost, cost, why: AI.last.why }; }
  if (!j.phase) {
    j.lap = { fit, last: AI.last, dist: E.st.dist };
    if (aiRaceExam()) { j.phase = 1; aiStartEpisode(j.w, 0, aiLapT(), 0, 1, aiRaceScen()); return null; }
    return { fit, solo: fit, last: AI.last, race: null, dist: E.st.dist };
  }
  return { fit: j.lap.fit - aiRaceCost(AI.last), solo: j.lap.fit, last: j.lap.last, race: AI.last, dist: j.lap.dist };
}
// the next job for this tab (tries; the exams too while no worker is up) or a worker (exams first: the longest)
function aiParTake(tab) {
  const J = AI_POOL.jobs, ex = J.findIndex(j => j.kind !== 'try'), tr = J.findIndex(j => j.kind === 'try');
  const k = tab && aiPoolOk() ? tr : ex >= 0 ? ex : tr;
  return k < 0 ? null : J.splice(k, 1)[0];
}
// a generation's tries, when none are under way (and not too many exams behind)
function aiParPlan() {
  const P = AI_POOL;
  if (P.gen || P.exams.size > Math.max(1, aiPoolOk())) return;
  aiNewGen(); AI.from = aiTryFrom(); AI.scen = aiScenario();
  P.gen = { left: AI_CFG.pop };
  for (let i = 0; i < AI_CFG.pop; i++) P.jobs.push({ kind: 'try', i, w: AI.cands[i], from: AI.from, scen: AI.scen, epoch: P.epoch });
}
// a job's result (from this tab or a worker)
function aiParDone(j, r) {
  const P = AI_POOL;
  if (j.epoch !== P.epoch || j.done) return;                          // (training stopped since; or driven twice, and in already)
  j.done = true;
  P.log.push([j.kind, j.i ?? j.seq ?? 'keep', r.nAct ? 'w' : 'tab', Math.round(r.fit), r.why ?? r.last.why]); if (P.log.length > 300) P.log.shift();   // (what drove what: for a look from the console)
  if (r.nAct) { AI.nAct += r.nAct; AI.nSim += r.nSim; }
  if (j.keep) {                                                        // the best's race against the newest rival (aiRvKeep): its score, if still the best
    if (AI.best && j.w.length === AI.best.length && j.w.every((v, k) => v === AI.best[k])) { if (j.kind === 'race') AI.bestFit = AI.bestSolo - r.cost; else { AI.bestFit = r.fit; AI.bestSolo = r.solo; } }
    return;
  }
  if (j.kind === 'exam') { P.exams.get(j.seq).r = r; return; }          // (its books are kept in order, between drives: aiParExams)
  AI.fits[j.i] = r.fit;
  if (--P.gen.left > 0) return;
  aiEndGen(); AI.exam = false; P.gen = null;                            // the generation's step; its exam, first in line
  const ex = { kind: 'exam', w: Float32Array.from(AI.w), seq: P.seq++, tryAvg: AI.tryAvg, epoch: P.epoch };
  P.exams.set(ex.seq, { j: ex, r: null }); P.jobs.unshift(ex);
  aiPoolPump();
}
// the exams' results, in the generations' order (as aiTick's): the best, the history, the rivals
function aiParExams() {
  const P = AI_POOL, len = botPath().len;
  for (let x; AI.training && (x = P.exams.get(P.next)) && x.r; ) {
    P.exams.delete(P.next++);
    const { j, r } = x, lapT = r.last.lap;
    AI.last = r.last; AI.lastRace = r.race;
    AI.fail = r.last.why !== 'lap' ? r.dist % len : null; AI.failStand = r.dist < 100;
    if (r.fit > AI.bestFit) { AI.bestFit = r.fit; AI.bestSolo = r.solo; AI.best = Float32Array.from(j.w); AI.bestLap = lapT; AI.sinceBest = AI.dry = 0; AI.bestAt = Date.now(); }
    else if (AI.bestLap != null) { AI.sinceBest++; AI.dry++; }
    aiLost(lapT);
    if (AI.stopAfter && AI.bestLap != null && AI.dry >= AI.stopAfter) AI.autoStop = `no better lap in ${AI.stopAfter} generation${AI.stopAfter > 1 ? 's' : ''}`;
    if (AI.gens && AI.gen + 1 >= AI.genEnd) AI.autoStop = `${AI.gens} generation${AI.gens > 1 ? 's' : ''} done`;
    AI.hist.push([Math.round(r.fit), Math.round(j.tryAvg), lapT]); AI.lastExam = AI.last; AI.lastExamRace = AI.lastRace;
    AI.gen++; aiRvKeep(); aiSave();
    if (AI.autoStop) return;
  }
}
// a step of the training on several cores; false when this tab has nothing to drive now (the workers have it all)
function aiTickPar() {
  if (AI.job && AI.job.done) { AI.ep = null; AI.job = null; }          // a worker drove this one too, and was first
  if (!AI.ep) { aiParExams(); if (AI.autoStop) return false; aiParPlan(); aiPoolPump(); }
  if (!AI.ep) {
    const j = aiParTake(true); if (!j) return false;
    AI.job = j; aiParBegin(j);
  }
  const fit = aiStep(); if (fit == null) return true;
  const j = AI.job, r = aiParEnd(j, fit);
  if (r) { AI.job = null; aiParDone(j, r); }
  return true;
}
// what the workers are told: as training starts (the network's shape, the car's settings), and with every job (the rest)
// (this tab's localStorage as it is now: the demo, the other cars' trainings for a rival; the course is the worker's own)
const aiPoolStore = () => { const o = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('sandbuggy.ai.')) o.push([k, localStorage.getItem(k)]); } return o; };
const aiPoolSetup = () => ({ t: 'setup', store: aiPoolStore(), ai: { h: AI.h, inputs: AI.inputs, hb: AI.hb, kp: AI.kp, ks: AI.ks, nb: AI.nb }, car: { pIdx: car.pIdx, awd: car.awd, aids: car.aids, split: car.split } });
function aiPoolPump() {
  const P = AI_POOL;
  for (const x of P.ws) {
    if (!x.ok || x.job) continue;
    let j = aiParTake(false);
    if (!j && AI.job && !AI.job.done && !P.ws.some(y => y.job === AI.job)) j = AI.job;   // nothing else: this tab's drive too (the same result, sooner)
    if (!j) return;
    x.job = j; x.jobT = performance.now();
    x.port.postMessage({ t: 'run', job: { kind: j.kind, i: j.i, w: j.w, from: j.from, scen: j.scen }, ctx: { cfg: AI_CFG, pen: AI_PEN, pool: AI.rvPool, best: AI.best, w: AI.w } });
  }
}
// the workers for this training (as many more as the cores less this tab's), those of another course or car let go
async function aiPoolStart() {
  const P = AI_POOL, n = Math.min(AI_CFG.cores, aiCoresMax()) - 1, sig = JSON.stringify(COURSE) + '|' + VEH.key;
  if (P.sig !== sig) { for (const x of P.ws) x.w.terminate(); P.ws = []; P.sig = sig; P.err = ''; }
  while (P.ws.length > n) P.ws.pop().w.terminate();
  for (const x of P.ws) if (x.ok) x.port.postMessage(aiPoolSetup());
  if (P.ws.length >= n) return;
  try { P.src = P.src || await aiWorkerSrc(); } catch (e) { P.err = 'could not load the sim for them'; aiShow(); return; }
  while (P.ws.length < n && AI.training && P.sig === sig) aiPoolSpawn(P.src);
}
function aiPoolStop() { for (const x of AI_POOL.ws) x.w.terminate(); AI_POOL.ws = []; AI_POOL.sig = ''; }
// the engine as a worker's: this file without its imports (three from the import map; the add-ons only draw: stand-ins),
// and no WebGL renderer
async function aiWorkerSrc() {
  const map = JSON.parse(document.querySelector('script[type=importmap]').textContent).imports, three = new URL(map.three, location.href).href;
  let s = await (await fetch(import.meta.url)).text();
  s = s.replace(/^(import [^\n]*\n)+/, '').replace(/new THREE\.WebGLRenderer\(/g, 'new __aiwStub(');
  s = `import * as THREE from '${three}';\nconst { OrbitControls, RoundedBoxGeometry, mergeGeometries, GLTFLoader } = globalThis.__aiwAddons;\n` + s;
  const blob = t => URL.createObjectURL(new Blob([t], { type: 'text/javascript' }));
  return { three, engine: blob(s), entry: blob(`(${aiWorkerMain.toString()})();`) };
}
function aiPoolSpawn(src) {
  const P = AI_POOL, w = new Worker(src.entry, { type: 'module', name: 'autopilot' }), ch = new MessageChannel(), x = { w, port: ch.port1, ok: false, job: null };
  const store = [];
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('sandbuggy.')) store.push([k, localStorage.getItem(k)]); }
  store.push(['sandbuggy.course', JSON.stringify(COURSE)], ['sandbuggy.vehicle', VEH.key], ['sandbuggy.surface', ROAD ? 'road' : COURSE.base]);
  x.port.onmessage = e => aiPoolMsg(x, e.data);
  w.onerror = e => aiPoolMsg(x, { t: 'error', error: e.message || 'it failed to start' });
  w.postMessage({ t: 'boot', port: ch.port2, store, three: src.three, engine: src.engine }, [ch.port2]);
  P.ws.push(x);
}
function aiPoolMsg(x, m) {
  const P = AI_POOL;
  if (!P.ws.includes(x)) return;
  if (m.t === 'ready') {
    if (m.hash !== aiGroundHash()) { aiPoolDrop(x, 'its world came out different from this tab\'s'); return; }
    x.ok = true; x.port.postMessage(aiPoolSetup()); aiPoolPump(); aiShow();
  } else if (m.t === 'done') { const j = x.job; x.job = null; x.acc = (x.acc || 0) + performance.now() - Math.max(x.jobT, AI_LOAD.t0); if (j) aiParDone(j, m.r); aiPoolPump(); }
  else if (m.t === 'error') aiPoolDrop(x, m.error);
}
function aiPoolDrop(x, why) {
  const P = AI_POOL; P.ws.splice(P.ws.indexOf(x), 1); x.w.terminate();
  if (x.job && x.job.epoch === P.epoch) P.jobs.unshift(x.job);        // (another drives it)
  P.err = String(why).split('\n')[0].slice(0, 160); console.warn('Autopilot worker:', why); aiShow();
}
// the ground as built, and how packed it is: a worker's must be this tab's
const aiGroundHash = () => { let h = 2166136261; for (const a of [B, AI.freshC || C, M]) { const u = new Uint32Array(a.buffer, a.byteOffset, a.byteLength >> 2); for (let i = 0; i < u.length; i += 7) h = Math.imul(h ^ u[i], 16777619); } return h >>> 0; };
// (in a worker) its jobs: the network's shape and the car's settings, then drives, whole
function aiWorkerServe(m) {
  if (m.t === 'setup') {
    if (m.store) {                                                     // the autopilot's own storage, as the tab's now (a demo set or dropped since...)
      for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith('sandbuggy.ai.')) localStorage.removeItem(k); }
      for (const [k, v] of m.store) localStorage.setItem(k, v);
      AI.demoKey = AI.demoCk = null; AI.lineFor = AI.paceFor = null; if (AI.rv) AI.rv.ck = null;
    }
    AI.h = m.ai.h; aiConfig(m.ai.inputs, m.ai.hb); Object.assign(AI, { kp: m.ai.kp, ks: m.ai.ks, nb: m.ai.nb }); Object.assign(car, m.car); AI.training = true; aiGT.all = true; return { t: 'setup' }; }
  if (m.t !== 'run') return { t: 'error', error: 'what is ' + m.t };
  const c = m.ctx, j = m.job, n0 = AI.nAct, s0 = AI.nSim;
  Object.assign(AI_CFG, c.cfg); Object.assign(AI_PEN, c.pen); Object.assign(AI, { rvPool: c.pool, best: c.best, w: c.w, ep: null });
  aiParBegin(j);
  for (;;) { const f = aiStep(); if (f == null) continue; const r = aiParEnd(j, f); if (r) return { t: 'done', r: { ...r, nAct: AI.nAct - n0, nSim: AI.nSim - s0 } }; }
}
// a worker's own script (its source goes in a blob: nothing from outside it): the stand-ins for a page, then the engine
async function aiWorkerMain() {
  const stub = new Proxy(function () { }, {
    get: (t, k) => k === Symbol.toPrimitive ? (h => h === 'number' ? 0 : '') : k === Symbol.iterator ? function* () { } : k === Symbol.hasInstance ? () => false : k === 'then' ? undefined : k === 'length' ? 0 : stub,
    apply: () => stub, construct: () => stub, set: () => true, deleteProperty: () => true });
  const mem = new Map(), store = { getItem: k => mem.has(k) ? mem.get(k) : null, setItem: (k, v) => { mem.set(k, String(v)); }, removeItem: k => { mem.delete(k); }, clear: () => mem.clear(), key: i => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
  Object.assign(self, { __aiWorker: true, window: self, document: stub, localStorage: store, sessionStorage: store, innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1, requestAnimationFrame: () => 0, cancelAnimationFrame: () => { } });
  for (const k of ['history', 'screen', 'visualViewport', 'parent', 'top', 'opener', 'alert', 'confirm', 'prompt', 'getComputedStyle', 'matchMedia', 'AudioContext', 'webkitAudioContext', 'AudioWorkletNode', 'Audio', 'Image', 'HTMLElement', 'HTMLCanvasElement', 'HTMLImageElement', 'HTMLVideoElement', 'Element', 'Node', 'ResizeObserver', 'MutationObserver', 'IntersectionObserver', 'CSS', 'scrollTo', 'requestIdleCallback', 'speechSynthesis', 'SpeechSynthesisUtterance', 'DOMParser', 'XMLSerializer', 'getSelection', 'focus', 'blur', 'print', 'PointerEvent', 'KeyboardEvent', 'MouseEvent', 'TouchEvent'])
    if (!(k in self)) self[k] = stub;
  self.onmessage = async e => {
    const m = e.data; if (!m || m.t !== 'boot') return;
    self.onmessage = null;
    const port = m.port, fail = err => port.postMessage({ t: 'error', error: String(err && (err.stack || err.message) || err) });
    self.addEventListener('error', ev => fail(ev.error || ev.message));
    self.addEventListener('unhandledrejection', ev => console.warn('autopilot worker:', ev.reason));
    try {
      for (const [k, v] of m.store) mem.set(k, v);
      const THREE = await import(m.three), make = function () { return stub; };   // (constructible)
      self.__aiwAddons = { OrbitControls: make, GLTFLoader: make, RoundedBoxGeometry: class extends THREE.BoxGeometry { constructor(w, h, d) { super(w, h, d); } }, mergeGeometries: () => new THREE.BufferGeometry() };
      self.__aiwStub = make;
      await import(m.engine);
      for (let k = 0; k < 1200 && !self.__aiwServe; k++) await new Promise(r => setTimeout(r, 50));
      if (!self.__aiwServe) throw new Error('the sim did not start');
      port.onmessage = ev => { try { port.postMessage(self.__aiwServe(ev.data)); } catch (err) { fail(err); } };
      port.postMessage({ t: 'ready', hash: self.__aiwHash() });
    } catch (err) { fail(err); }
  };
}
// a training step failed: the rival's car put back if it was in ours, the training stopped, the error kept (AI.lastError)
function aiTrainFail(e) {
  AI.lastError = String(e && (e.stack || e.message) || e).slice(0, 2000); console.error('Autopilot training stopped:', e);
  try { if (car.isRival && AI.rv) aiRvSwap(AI.rv); } catch (e2) { }
  AI.stopWhy = { why: `an error: ${String(e && e.message || e).slice(0, 160)}`, gen: AI.gen, err: true };   // (before: aiTrain shows it)
  try { aiTrain(false); } catch (e2) { AI.training = false; }
  flash(`Training stopped: an error (${String(e && e.message || e).slice(0, 80)})`, '#ff8a7a', 5);
}
function aiTrainFrame(dt) {
  if (aiKey() !== AI.key) { aiStopped('another course or car'); return; }   // another course or car
  const tick = AI.par ? aiTickPar : aiTick;                            // (on several cores, or this tab's alone)
  if (AI.watch) {                                                      // at 1x: as much driving as time went by, with the sound
    audio = AI.mute;
    AI.wacc = Math.min((AI.wacc || 0) + dt * AI_CFG.speed, 4 * AI_DT * AI_CFG.speed);   // (at 2x or 4x: twice or four times that)
    while (AI.wacc >= AI_DT) { AI.wacc -= AI_DT; tick(); }
  } else {
    const t0 = performance.now(), budget = AI_CFG.draw ? AI_BUDGET : AI_BUDGET_BLIND;   // (not drawing the world: more of the frame)
    while (performance.now() - t0 < budget && tick()) { }
  }
  if (AI_CFG.draw || AI.watch) refreshChunks(car.pos.x, car.pos.z, 6);
  if (AI.autoStop) {                                                   // its generations done, or no better lap for a while
    AI.autoStopWhy = AI.autoStop; AI.autoStop = false; aiStopped(AI.autoStopWhy, true);
  }
  if ((AI.hudT = (AI.hudT || 0) + 1) % 6 === 0) aiShow();
}
// the training stopped by itself (#323): why, flashed and kept for the lab's status line until the next training
function aiStopped(why, auto) {
  aiTrain(false);
  AI.stopWhy = { why, gen: AI.gen, auto: !!auto };
  flash(`Training stopped: ${why}`, '#9fd4ff', 4); aiShow();
}
const aiEsc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function aiStopLine() {
  const S = AI.stopWhy;
  return `<b style="color:${S.err ? '#ff8a7a' : '#ffd88a'}">Training stopped at generation ${S.gen}: ${aiEsc(S.why)}</b>`
    + (S.auto && /no better lap/.test(S.why) ? ' · <span style="opacity:.8">the setting “stop after generations without a better lap” (0: never)</span>' : '')
    + ` · ${AI.gen ? `Train more goes on from here${S.auto && /no better lap/.test(S.why) && AI.stopAfter ? `, for up to ${AI.stopAfter} more generations without a better lap` : ''}` : 'Train to start again'}`;
}
function aiTrain(on) {
  if (on === AI.training) return;
  if (on && AI.preview) aiPreviewEnd();                               // (#336: train their own, not the one previewed)
  AI.autoStop = false;
  if (on) AI.stopWhy = null;
  if (on) { AI.genEnd = AI.gen + AI.gens; AI.dry = 0; AI.lost = 0; }   // so many more, from now; and as many without a better lap (#337), or a lap (#348)
  if (on && !aiAllowed()) { flash('Not during a race', '#ffd88a', 1.5); return; }
  if (on) {
    if (rp.on) stopReplay();
    if (ed.on) toggleEditor(false);
    AI.drive = false;
    if (aiKey() !== AI.key) aiLoad();
    AI.snapH = H.slice(); AI.snapC = C.slice(); aiGT.all = true; AI.ep = null; AI.cands = null; AI.exam = false; AI.examSolo = null;
    AI.par = AI_CFG.cores > 1 && !AI.sync; AI.job = null;                          // several cores: the workers, and the books kept afresh
    Object.assign(AI_POOL, { epoch: AI_POOL.epoch + 1, jobs: [], seq: 0, next: 0, gen: null }); AI_POOL.exams.clear();
    if (AI.rv) AI.rv.ck = null;                                        // (the rival car's training looked up again)
    AI.training = true; AI.mute = audio; audio = null;                   // the tries are silent (no engine, no crashes)
    if (AI.mute) AI.mute.node.port.postMessage({ on: 0 });
    if (AI.examKind !== aiExamKind()) aiReexam();
    if (AI.par) aiPoolStart();
    aiBgKick();
  } else {
    AI.training = false; AI.ep = null; AI.cands = null; AI.exam = false; AI.ctl = null; AI.examSolo = null; if (AI.rv) AI.rv.on = false;
    Object.assign(AI_POOL, { epoch: AI_POOL.epoch + 1, jobs: [], gen: null }); AI_POOL.exams.clear(); AI.job = null;   // (what the workers still drive is dropped)
    if (AI.snapH) { H.set(AI.snapH); C.set(AI.snapC); AI.snapH = AI.snapC = null; for (const ch of chunks.values()) ch.update(); updateFar(); }
    aiGT.all = true;
    if (AI.mute) { audio = AI.mute; AI.mute = null; }
    AI.watch = false;
    restartRun();
  }
  aiShow();
}
// the exams changed (flying laps or from the line, the pace notes, the line, the penalties...): the best's score was
// another exam's, so it takes the new one
function aiReexam() {
  AI.examKind = aiExamKind();
  if (!AI.best) return;
  const x = aiExamRun(AI.best);
  AI.bestFit = x.fit; AI.bestSolo = x.solo; AI.bestLap = AI.last.lap; AI.sinceBest = AI.dry = 0; aiSave();
}
// training carries on from the best weights (after wandering off from them), not from where it got to
function aiBackToBest() {
  if (!AI.best) return;
  AI.w = Float32Array.from(AI.best); AI.m.fill(0); AI.sinceBest = AI.dry = AI.lost = 0;
  AI.cands = null; AI.exam = false; AI.ep = null;
  aiSave(); aiShow(); flash('Training carries on from the best', '#9fd4ff', 1.5);
}
function aiDrive(on, race = false) {
  if (on && !(AI.best || AI.w)) return;
  if (on && !aiAllowed()) { flash('Not during a race', '#ffd88a', 1.5); return; }
  if (on && race && AI.rv) AI.rv.ck = null;
  if (on && race && !aiRival()) { flash(aiRivalWhyNot(), '#ffd88a', 2.5); return; }
  if (AI.training) aiTrain(false);
  AI.drive = on; AI.race = null; AI.other = null; if (AI.rv) AI.rv.on = false;
  if (on) {
    restartRun(); AI.dst = { i: -1, dist: 0, lat: 0 }; AI.dCtl = null; AI.dAcc = 0; AI.map = null;
    if (race) aiRaceStart();
    if (!MP.watch) flash(race ? 'Autopilot against the rival (any driving key takes over)' : 'Autopilot: hands off (any driving key takes over)', '#9fd4ff', 2.5);
  }
  aiShow();
}
const aiRivalWhyNot = () => !ROAD_CARS[aiRivalKey()] ? 'A rival needs a road car' : `No autopilot trained for the ${ROAD_CARS[aiRivalKey()].name} on this course: train one with it first`;
// Race it: on the grid alongside the rival, another of this car driven by the best network (Train's kind of rival: a
// replay of its own laps, or a car that reacts)
function aiRaceStart() {
  const R = aiRival(), sc = aiRaceScen(); sc.w = AI.best || AI.w;
  R.mode = AI_CFG.rival === 'replay' ? 'replay' : 'car'; R.w = R.brain ? R.brain.w : sc.w; R.skill = 1; R.tape = null;
  if (R.mode === 'replay') { const h = H.slice(), c = C.slice(); R.tape = aiRvRecord(R, -8, sc.lat, false, (AI.bestLap || 60) * 4 + 20, 3 * botPath().len + 40); H.set(h); C.set(c); aiGT.all = true; }
  aiPlaceCar(0, sc.myLat, false, true, false);
  aiRvSwap(R); repairCar(); aiPlaceCar(0, sc.lat, false, false, false); aiRvSwap(R);
  aiRvReady(R); R.on = true;
  AI.race = { contact: 0, touches: 0, touching: false, t: 0, infoT: 0 };
  AI.other = { st: R.st, vel: R.c.vel };
}
// ---------- watching it think: the network, live, and on the track the points it looks at ----------
const aiCol = (v, a = 1) => v >= 0 ? `rgba(255,138,61,${a})` : `rgba(74,168,255,${a})`;
const aiMarks = AI_LOOK.map((_, k) => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(k < 3 ? 0.45 - k * 0.08 : 0.45, 14, 10), new THREE.MeshBasicMaterial({ color: 0x5fe0ff, transparent: true, opacity: 0.85, depthTest: false }));
  m.renderOrder = 20; m.visible = false; scene.add(m); return m;
});
// the feelers (edge rays), when it has them: a line from the car to where each leaves the course
const aiRayLines = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(AI_RAYS.length * 6), 3)),
  new THREE.LineBasicMaterial({ color: 0x5fe0ff, transparent: true, opacity: 0.8, depthTest: false }));
aiRayLines.renderOrder = 20; aiRayLines.visible = false; aiRayLines.frustumCulled = false; scene.add(aiRayLines);
let aiVizT = 0;
// ---------- its hands and feet: the wheel and the pedals as it works them, top right, while it has the car ----------
const aiCtlCv = document.createElement('canvas'); aiCtlCv.id = 'aiCtl'; aiCtlCv.className = 'panel'; aiCtlCv.width = 560; aiCtlCv.height = 250;
aiCtlCv.style.cssText = 'display:none;position:fixed;top:12px;width:280px;height:125px;padding:0;pointer-events:none;z-index:2';
document.body.appendChild(aiCtlCv);
let aiCtlT = 0, aiCtlPlaceT = 0, aiCtlFoot = 0;
// the pedals in 3D (a little renderer of their own, drawn into the 2D overlay): the brake hung from above, the gas hinged
// on the floor, each pressed as far as the network presses it, and a see-through foot that moves between them
let aiPed = null;
function aiPedals() {
  if (aiPed !== null) return aiPed;
  try {
    const cv = document.createElement('canvas'); cv.width = 300; cv.height = 190;
    const r = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: true });
    r.setClearColor(0x000000, 0);
    const sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, cv.width / cv.height, 0.05, 5);
    cam.position.set(0.5, 0.56, 0.86); cam.lookAt(0.03, 0.15, 0.06);
    sc.add(new THREE.HemisphereLight(0xffffff, 0x302820, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8); sun.position.set(-0.5, 1.2, 1); sc.add(sun);
    const metal = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.5, roughness: 0.4 }), rubber = new THREE.MeshStandardMaterial({ color: 0x1c1c1f, roughness: 0.9 });
    const well = new THREE.MeshStandardMaterial({ color: 0x18181c, roughness: 1, transparent: true, opacity: 0.4, depthWrite: false });   // the footwell, faint
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.34), well); floor.rotation.x = -Math.PI / 2; floor.position.set(0.035, 0, 0.1); sc.add(floor);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), well); wall.position.set(0.035, 0.2, -0.13); wall.rotation.x = -0.35; sc.add(wall);
    const pad = (w, h, col) => {
      const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: 0x5c5f66, roughness: 0.7, emissive: col, emissiveIntensity: 0 });
      g.add(new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.016), m));
      for (let k = 1; k < 5; k++) { const rib = new THREE.Mesh(new THREE.BoxGeometry(w * 0.8, 0.005, 0.006), rubber); rib.position.set(0, -h / 2 + k * h / 5, 0.009); g.add(rib); }
      g.mat = m; return g;
    };
    // the gas: an organ pedal hinged at the floor, leaning back
    const gas = new THREE.Group(); gas.position.set(0.13, 0.015, 0); sc.add(gas);
    const gp = pad(0.065, 0.2, 0x2fbf4a); gp.position.set(0, 0.1, 0); gas.add(gp);
    // the brake: a wide pad on an arm from a pivot under the dash
    const brake = new THREE.Group(); brake.position.set(-0.06, 0.44, -0.08); sc.add(brake);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 8), metal); arm.position.set(0, -0.15, 0); brake.add(arm);
    const bp = pad(0.11, 0.075, 0xe0352b); bp.position.set(0, -0.3, 0.01); bp.rotation.x = 0.5; brake.add(bp);
    // the foot: the ball of it at the origin, the heel along +z, its top +y; see-through
    const skin = new THREE.MeshStandardMaterial({ color: 0xe9e3d6, roughness: 0.6, transparent: true, opacity: 0.5, depthWrite: false });
    const foot = new THREE.Group(); foot.rotation.order = 'YXZ'; sc.add(foot);
    const blob = (x, y, z, sx, sy, sz) => { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), skin); m.position.set(x, y, z); m.scale.set(sx, sy, sz); foot.add(m); };
    blob(0, 0.03, 0.1, 0.048, 0.034, 0.14); blob(0, 0.026, -0.015, 0.044, 0.026, 0.05); blob(0, 0.04, 0.215, 0.038, 0.045, 0.045);
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.034, 0.16, 16), skin); foot.add(shin);   // (up and back to the knee, whatever the foot's angle)
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.008, 0.29), new THREE.MeshStandardMaterial({ color: 0x1b1b1b, transparent: true, opacity: 0.45, depthWrite: false }));
    sole.position.set(0, 0.002, 0.1); foot.add(sole);
    aiPed = { cv, r, sc, cam, gas, gp, brake, bp, foot, shin, a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), up: new THREE.Vector3(0, 0.04, 0.07) };
  } catch (e) { aiPed = false; }                                      // (no WebGL for it: the flat drawing)
  return aiPed;
}
// pressed this far (0..1), the foot over the gas (1), the brake (-1) or between: the picture
function aiPedalsDraw(brk, gas, foot) {
  const P = aiPedals(); if (!P) return null;
  P.gas.rotation.x = 0.55 - gas * 0.3;                                 // (leaning back 32°; pressed, towards the firewall)
  P.brake.rotation.x = -0.5 + brk * 0.38;
  P.gp.mat.emissiveIntensity = gas * 0.9; P.bp.mat.emissiveIntensity = brk * 0.9;
  P.sc.updateMatrixWorld(true);
  // the ball of the foot on the pad's face, or resting between them, a little back
  const onGas = P.gp.localToWorld(P.a.set(0, 0.02, 0.012)), onBrake = P.bp.localToWorld(P.b.set(0, 0, 0.012));
  const k = Math.abs(foot), rest = P.c.copy(onGas).lerp(onBrake, 0.5).add(P.up);
  P.foot.position.copy(rest).lerp(foot > 0 ? onGas : onBrake, k);
  P.foot.rotation.x = lerp(0.62, foot > 0 ? 0.95 - gas * 0.3 : 0.45 - brk * 0.1, k);   // the sole along the pad
  P.foot.rotation.y = lerp(0, foot > 0 ? -0.12 : 0.1, k);
  const sa = 0.55 - P.foot.rotation.x; P.shin.rotation.x = sa; P.shin.position.set(0, 0.06 + 0.08 * Math.cos(sa), 0.2 + 0.08 * Math.sin(sa));
  P.r.render(P.sc, P.cam);
  return P.cv;
}
function aiCtlDraw(dt, live) {

  const show = live && !rp.on && !!AI.lastCtl;
  if ((aiCtlCv.style.display !== 'none') !== show) aiCtlCv.style.display = show ? 'block' : 'none';
  if (AI.ctlBox && AI.ctlBox.classList.contains('live') !== show) AI.ctlBox.classList.toggle('live', show);   // (and in the panel's full-screen view)
  if (!show) return;
  if ((aiCtlPlaceT -= dt) <= 0) {                                      // left of the minimap; under the best laps if they are there
    aiCtlPlaceT = 0.5;
    // between the timer and the minimap, as wide as fits (180 to 280 px); under the best laps if they are there; else under the minimap
    const m = document.getElementById('mapWrap').getBoundingClientRect(), t = timerEl.getBoundingClientRect(), bl = document.getElementById('bestLaps'), b = bl && bl.offsetWidth ? bl.getBoundingClientRect() : null;
    const right = innerWidth - m.left + 10, gap = m.left - 10 - (t.right + 10), w = Math.min(280, gap);
    const over = b && b.right > m.left - 10 - w && b.left < m.left - 10;
    if (w >= 180) { aiCtlCv.style.width = w + 'px'; aiCtlCv.style.height = w * 125 / 280 + 'px'; aiCtlCv.style.right = right + 'px'; aiCtlCv.style.top = (over ? b.bottom + 10 : 12) + 'px'; }
    else { aiCtlCv.style.width = '220px'; aiCtlCv.style.height = 220 * 125 / 280 + 'px'; aiCtlCv.style.right = right + 'px'; aiCtlCv.style.top = (m.bottom + 10) + 'px'; }
  }
  if ((aiCtlT += dt) < 1 / 30) return; aiCtlT = 0;
  const g = aiCtlCv.getContext('2d'), W = aiCtlCv.width, Hc = aiCtlCv.height, c = AI.lastCtl, steer = c.steer, gas = c.throttle, brk = c.brake;
  g.clearRect(0, 0, W, Hc);
  g.font = '600 20px system-ui, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillStyle = 'rgba(255,255,255,.7)';
  g.fillText(AI.training ? 'AUTOPILOT · TRAINING' : 'AUTOPILOT', 18, 22);
  // the wheel: full lock either way is three quarters of a turn
  const cx = 120, cy = 124, R = 70, a = -steer * Math.PI * 1.5;
  g.save(); g.translate(cx, cy); g.rotate(a);
  g.lineWidth = 16; g.strokeStyle = '#2a2a2e'; g.beginPath(); g.arc(0, 0, R, 0, 7); g.stroke();
  g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.arc(0, 0, R + 8, 0, 7); g.stroke();
  g.lineWidth = 16; g.strokeStyle = '#ff7a1a'; g.beginPath(); g.arc(0, 0, R, -Math.PI / 2 - 0.13, -Math.PI / 2 + 0.13); g.stroke();   // the top mark
  g.lineWidth = 12; g.strokeStyle = '#3a3a40';
  for (const s of [Math.PI, 0, Math.PI / 2]) { g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(s) * R, Math.sin(s) * R); g.stroke(); }
  g.fillStyle = '#4a4a52'; g.beginPath(); g.arc(0, 0, 22, 0, 7); g.fill();
  g.restore();
  g.textAlign = 'center'; g.fillStyle = '#fff'; g.font = '700 22px system-ui, sans-serif';
  g.fillText(Math.abs(steer) < 0.02 ? 'straight' : `${steer > 0 ? '◀ ' : ''}${Math.round(Math.abs(steer) * 100)}%${steer < 0 ? ' ▶' : ''}`, cx, cy + R + 32);
  // the pedals: brake and gas, each pushed down as far as it is pressed; the foot on the one it presses
  const pedal = (x, w, v, col, label) => {
    const top = 64, h = 110, dy = v * 34;
    g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(x - 4, top - 6, w + 8, h + 30);
    g.save(); g.translate(x + w / 2, top + dy);
    g.fillStyle = v > 0.01 ? col : '#3a3a40'; g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 2;
    g.beginPath(); g.roundRect(-w / 2, 0, w, h - dy * 0.4, 8); g.fill(); g.stroke();
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 3;
    for (let k = 1; k < 5; k++) { const yy = k * (h - dy * 0.4) / 5; g.beginPath(); g.moveTo(-w / 2 + 8, yy); g.lineTo(w / 2 - 8, yy); g.stroke(); }
    g.restore();
    g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x, top + h + 12, w, 10);
    g.fillStyle = col; g.fillRect(x, top + h + 12, w * v, 10);
    g.fillStyle = '#fff'; g.font = '600 18px system-ui, sans-serif'; g.textAlign = 'center';
    g.fillText(label, x + w / 2, top + h + 40); g.fillText(`${Math.round(v * 100)}%`, x + w / 2, top + h + 62);
    return { x: x + w / 2, y: top + dy };
  };
  // the foot: over the gas, over the brake, or resting between, eased so it moves as a foot would
  const want = gas > 0.01 ? 1 : brk > 0.01 ? -1 : 0; aiCtlFoot += (want - aiCtlFoot) * Math.min(1, (dt + 1 / 30) * 6);
  const ped = AI_CFG.ped3d ? aiPedalsDraw(brk, gas, aiCtlFoot) : null;
  if (ped) {                                                           // in 3D: the pedals, the foot; under them how far each is pressed
    g.drawImage(ped, 250, 4, 300, 190);
    for (const [x, v, col, label] of [[272, brk, '#e0352b', 'BRAKE'], [432, gas, '#2fbf4a', 'GAS']]) {
      g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x, 200, 96, 9); g.fillStyle = col; g.fillRect(x, 200, 96 * v, 9);
      g.fillStyle = '#fff'; g.font = '600 18px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText(`${label} ${Math.round(v * 100)}%`, x + 48, 228);
    }
  } else {
  const bp = pedal(290, 84, brk, '#e0352b', 'BRAKE'), gp = pedal(430, 64, gas, '#2fbf4a', 'GAS');
  const fx = lerp(lerp(bp.x, gp.x, 0.5), aiCtlFoot > 0 ? gp.x : bp.x, Math.abs(aiCtlFoot)), fy = lerp(60, aiCtlFoot > 0 ? gp.y : bp.y, Math.abs(aiCtlFoot)) - 8;
  g.save(); g.translate(fx, fy); g.rotate(-0.25);
  g.fillStyle = '#d9d2c5'; g.strokeStyle = '#1b1b1b'; g.lineWidth = 3;
  g.beginPath(); g.roundRect(-26, -44, 52, 70, 22); g.fill(); g.stroke();                       // the shoe, from above
  g.fillStyle = '#b5ada0'; g.beginPath(); g.ellipse(0, -48, 18, 10, 0, 0, 7); g.fill(); g.stroke();   // the ankle
  g.restore();
  }
  // the handbrake, if it has one
  if (AI.nOut > 2) {
    g.fillStyle = c.handbrake ? '#ff3b2f' : 'rgba(255,255,255,.15)'; g.beginPath(); g.roundRect(W - 92, 8, 80, 28, 14); g.fill();
    g.fillStyle = '#fff'; g.font = '700 16px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('H-BRAKE', W - 52, 23);
  }
  if (AI.big && AI.ctlBig) { const bg = AI.ctlBig.getContext('2d'); bg.clearRect(0, 0, W, Hc); bg.drawImage(aiCtlCv, 0, 0); }   // the full-screen view's copy
}
function aiViz(dt) {
  const live = (AI.training ? !AI.par || AI.watch : AI.drive) && !!AI.viewW;   // (training on several cores: no live pedals or network, unless watching)
  aiCtlDraw(dt, live);
  // decisions a second (the network runs on the main thread, in readInput: once every AI_DT of simulated time, driving
  // or training, as many as fit in AI_BUDGET ms a frame)
  const now = performance.now(), el = (now - (AI.rateT || now)) / 1000;     // real seconds (a frame's dt is capped)
  if (!AI.rateT) AI.rateT = now;
  else if (el >= 1) {
    const n = AI.nAct / el, x = AI.nSim / el;
    const f = v => v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString('en');
    AI.rate = !live ? '' : AI.training ? `${f(n)} decisions/s ${AI.par ? `on ${aiPoolOk() + 1} cores` : 'on the main thread'} · ${AI.watch ? 'at real speed (watching)' : `driving at ${f(x)}× real time`}`
      : `${f(n)} decisions/s on the main thread (as trained: one every ${Math.round(AI_DT * 1000)} ms)`;
    AI.nAct = 0; AI.nSim = 0; AI.rateT = now;
    aiLoadTick();
    if (AI.open) AI.el.querySelector('#aiRate').textContent = AI.rate;
  }
  for (let k = 0; k < aiMarks.length; k++) {
    const m = aiMarks[k], q = AI.look[k];
    m.visible = live && AI.open && !!q && !rp.on && (k < 3 || AI.inputs.includes(AI_LOOK_IDS[k]));   // (the far ones, #342: when it looks there)
    if (m.visible) m.position.set(q.x, surfaceAt(q.x, q.z, car.pos.y + 5) + 0.6, q.z);
  }
  aiRayLines.visible = live && AI.open && !rp.on && AI.rayEnds.length > 0;
  if (aiRayLines.visible) {
    const a = aiRayLines.geometry.attributes.position;
    AI.rayEnds.forEach(([x, z], k) => { a.setXYZ(2 * k, car.pos.x, car.pos.y + 0.6, car.pos.z); a.setXYZ(2 * k + 1, x, surfaceAt(x, z, car.pos.y + 5) + 0.6, z); });
    a.needsUpdate = true;
  }
  if (!AI.open || (aiVizT += dt) < 0.1) return; aiVizT = 0;
  const netLive = live && (!AI.training || !AI.par || AI_CFG.speed === 1);   // (the network: on several cores, only watching at 1x)
  aiNetDraw(netLive); aiIoLive(netLive);
  if (AI.drive) aiMapShow();
}
// what each input and output is for, in a line (the panel's full-screen view; the inputs' tips say more)
const AI_ABOUT = {
  speed: 'How fast it is going: what it can brake for, and how much grip it has left.',
  line6: 'Which way the racing line goes 6 m ahead: the near cue for the steering.',
  line15: 'The line 15 m ahead: the bend it is turning into.',
  line30: 'The line 30 m ahead: the next bend, early enough to set up for it.',
  line50: 'The line 50 m ahead: a bend still a few seconds off, at speed.',
  line100: 'The line 100 m ahead: the shape of the track coming, from far off (a fast car needs to know sooner).',
  offset: 'How far it is to the side of the racing line: steer back to it.',
  yaw: 'How fast the car is turning: steadies the steering, so it doesn’t weave.',
  pace: 'The speed this bit of line can be taken at, less its own: below 0, too fast here.',
  ahead: 'The same a moment ahead: the bend coming, in time to brake for it.',
  edges: 'How much room is left to the course’s edge, left and right.',
  rays: 'Five feelers: how far it can go each way before it leaves the course.',
  slide: 'How fast it slides sideways: to catch a slide early.',
  wslip: 'The front and rear wheels’ slip: spinning (too much gas) or locking (braking).',
  sink: 'How deep the wheels sink: digging itself in, on sand.',
  g: 'The g it pulls, forward and sideways: how hard it accelerates, brakes and corners.',
  rival: 'Where the rival car is: ahead, behind, to the side, and how fast we close on it.',
  tilt: 'How far it leans and pitches: about to roll over?',
};
const AI_OUTS = [
  { name: 'steer', about: 'Turns the wheel: + left, − right, ±1 full lock.', fmt: v => Math.abs(v) < 0.05 ? 'straight' : (v > 0 ? '◀ left ' : 'right ▶ ') + Math.round(Math.abs(v) * 100) + '%' },
  { name: 'pedal', about: 'One pedal for both feet: + the gas, − the brake (with no brake, below 0 is off).', fmt: v => v > 0 ? 'gas ' + Math.round(v * 100) + '%' : v < 0 && !AI.nb ? 'brake ' + Math.round(-v * 100) + '%' : 'off' },
  { name: 'handbrake', about: 'Pulls the handbrake when above 0: hairpins, and slides on purpose.', fmt: v => v > 0 ? 'ON' : 'off' },
];
// text in lines no wider than mw (canvas)
function aiWrap(g, text, mw) {
  const out = []; let line = '';
  for (const wd of String(text).split(' ')) { const t = line ? line + ' ' + wd : wd; if (line && g.measureText(t).width > mw) { out.push(line); line = wd; } else line = t; }
  if (line) out.push(line);
  return out;
}
// a tooltip box at (x, y) in a canvas of css size W x H: [text, style][] rows
function aiTipBox(g, x, y, W, H, rows, fs) {
  const pad = 8, lh = fs * 1.4, mw = Math.min(280, W - 24);
  const lines = rows.flatMap(([t, st]) => { g.font = st; return aiWrap(g, t, mw).map(l => [l, st]); });
  let bw = 0; for (const [l, st] of lines) { g.font = st; bw = Math.max(bw, g.measureText(l).width); }
  bw += pad * 2; const bh = lines.length * lh + pad * 2 - (lh - fs);
  let bx = x + 14, by = y + 14; if (bx + bw > W - 4) bx = x - 14 - bw; if (bx < 4) bx = 4; if (by + bh > H - 4) by = Math.max(4, H - 4 - bh);
  g.fillStyle = 'rgba(12,9,6,.94)'; g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 1;
  g.beginPath(); g.roundRect(bx, by, bw, bh, 6); g.fill(); g.stroke();
  g.textAlign = 'left'; g.textBaseline = 'top';
  lines.forEach(([l, st], k) => { g.font = st; g.fillStyle = k ? 'rgba(255,255,255,.78)' : '#fff'; g.fillText(l, bx + pad, by + pad + k * lh); });
}
// a canvas drawn at the screen's resolution, in css pixels: its context, width and height (null: not shown)
function aiCanvas(cv) {
  const r = devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  if (!W || !H) return null;
  if (cv.width !== Math.round(W * r) || cv.height !== Math.round(H * r)) { cv.width = Math.round(W * r); cv.height = Math.round(H * r); }
  const g = cv.getContext('2d'); g.setTransform(r, 0, 0, r, 0, 0); g.clearRect(0, 0, W, H);
  return { g, W, H };
}
// the diagram: what it sees (left) and does (right), live while it trains or drives; hover a dot for what it is
function aiNetDraw(live) {
  const cv = AI.el.querySelector('#aiNet'), w = AI.viewW || AI.best || AI.w, I = AI.nIn, O = AI.nOut, big = AI.big;
  if (!big) { const hh = Math.max(165, 22 + I * 20, 22 + AI.h * 5) + 'px'; if (cv.style.height !== hh) cv.style.height = hh; }   // as tall as its inputs need
  else if (cv.style.height) cv.style.height = '';
  const c = aiCanvas(cv); if (!c) return;
  const { g, W, H: Hc } = c;
  if (!w || w.length !== AI.np) return;
  const gap = I > 1 ? (Hc - (big ? 32 : 22)) / (I - 1) : 99;             // (big: the names shrink to fit their rows)
  const x = live ? aiX : null, h = AI.h, fb = big ? clamp(gap - 3, 9, 13) : 9.5, fsm = big ? clamp(gap - 4, 8.5, 11.5) : 8, nr = big ? clamp(gap / 2.4, 4, 7) : 6;
  const big1 = `600 ${fb}px system-ui, sans-serif`, small = `${fsm}px system-ui, sans-serif`;
  const xi = big ? Math.min(250, W * 0.3) : 75, xo = W - (big ? 150 : 65), xh = (xi + xo) / 2, pad = big ? 16 : 11;
  const pb = pad + (big && !x ? 16 : 0);                               // (room for the line under it, idle)
  const yi = i => I > 1 ? pad + i * (Hc - pad - pb) / (I - 1) : Hc / 2, yo = k => Hc * (k + 0.5) / O, yh = j => h > 1 ? pad + j * (Hc - 2 * pad) / (h - 1) : Hc / 2;
  const nrh = h > 1 ? clamp((Hc - 2 * pad) / (h - 1) / 2.4, 1.5, nr) : nr, thin = Math.min(1, Math.sqrt(8 / Math.max(1, h)));   // (many hidden units: smaller dots, fainter lines)
  // the dot under the pointer: ['i' | 'h' | 'o', index]
  let hov = null;
  if (cv._hx != null) {
    let bd = (big ? 14 : 10) ** 2;
    const near = (kind, n, px, py) => { for (let k = 0; k < n; k++) { const d = (cv._hx - px) ** 2 + (cv._hy - py(k)) ** 2; if (d < bd) { bd = d; hov = [kind, k]; } } };
    near('i', I, xi, yi); near('o', O, xo, yo); if (h) near('h', h, xh, yh);
    if (!hov && cv._hx < xi - 8) { const k = Math.round(I > 1 ? (cv._hy - pad) / ((Hc - pad - pb) / (I - 1)) : 0); if (k >= 0 && k < I) hov = ['i', k]; }   // or its name
  }
  const lit = (a, ka, b, kb) => !hov || (hov[0] === a && hov[1] === ka) || (hov[0] === b && hov[1] === kb);
  const edge = (x0, y0, x1, y1, v, on, f = 1) => { const m = Math.min(1, Math.abs(v) / 1.5); g.strokeStyle = aiCol(v, (0.12 + 0.88 * m) * (on ? 1 : 0.12) * (on && hov ? 1 : f)); g.lineWidth = (big ? 0.6 : 0.5) + (big ? 4.5 : 3.5) * m * f; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
  // the pulls: live, value x weight; idle, the weights themselves
  if (!h) for (let i = 0; i < I; i++) for (let k = 0; k < O; k++) edge(xi, yi(i), xo, yo(k), w[k * I + i] * (x ? x[i] : 1), lit('i', i, 'o', k));
  else {
    for (let j = 0; j < h; j++) for (let i = 0; i < I; i++) edge(xi, yi(i), xh, yh(j), w[j * I + i] * (x ? x[i] : 1) * 0.7, lit('i', i, 'h', j), thin);
    const w2 = I * h + h;
    for (let j = 0; j < h; j++) for (let k = 0; k < O; k++) edge(xh, yh(j), xo, yo(k), w[w2 + j * O + k] * (x ? aiHid[j] : 1), lit('h', j, 'o', k), thin);
  }
  const node = (cx, cy, v, on, r = nr) => { g.fillStyle = aiCol(v, 0.25 + 0.75 * Math.min(1, Math.abs(v))); g.beginPath(); g.arc(cx, cy, (on ? Math.max(r * 1.25, 4) : r), 0, 7); g.fill(); g.strokeStyle = on ? '#fff' : 'rgba(255,255,255,.6)'; g.lineWidth = on ? 2 : r < 3 ? 0.5 : 1; g.stroke(); };
  const isHov = (a, k) => !!hov && hov[0] === a && hov[1] === k;
  for (let j = 0; j < h; j++) node(xh, yh(j), x ? aiHid[j] : 0, isHov('h', j), nrh);
  g.textBaseline = 'middle';
  // inputs, in real units: big, a table (name left, value by its dot); small, the value under the name
  const two = !big && I > 1 && (Hc - 2 * pad) / (I - 1) >= 18;
  for (let i = 0; i < I; i++) {
    const on = isHov('i', i), y = yi(i);
    node(xi, y, x ? clamp(x[i], -1, 1) : 0, on);
    g.font = big1; g.fillStyle = on ? '#fff' : 'rgba(255,255,255,.85)';
    if (big) {
      g.textAlign = 'left'; g.fillText(AI.names[i], 4, y);
      if (x) { g.font = small; g.textAlign = 'right'; g.fillStyle = 'rgba(255,255,255,.65)'; g.fillText(AI.shows[i](x[i]), xi - 14, y); }
    } else {
      g.textAlign = 'right'; g.fillText(AI.names[i], xi - 10, y - (x && two ? 4.5 : 0));
      if (x && two) { g.fillStyle = 'rgba(255,255,255,.6)'; g.font = small; g.fillText(AI.shows[i](x[i]), xi - 10, y + 5); }
    }
  }
  // outputs: what it does (like the keyboard, or no brake: what it applies, not what it computed)
  for (let k = 0; k < O; k++) {
    const v = x ? aiY[k] : 0, keyed = k < 2 && (k ? AI.kp : AI.ks), applied = keyed || (k === 1 && AI.nb), on = isHov('o', k);
    node(xo, yo(k), v, on);
    g.textAlign = 'left'; g.fillStyle = '#fff'; g.font = big1; g.fillText(AI_OUTS[k].name + (keyed ? ' ⌨' : ''), xo + nr + 8, yo(k) - (x ? fb * 0.6 : 0));
    if (x) { g.font = small; g.fillStyle = 'rgba(255,255,255,.75)'; g.fillText(AI_OUTS[k].fmt(applied ? AI.applied[k] : v), xo + nr + 8, yo(k) + fsm * 0.75); }
  }
  if (!x && !hov) { g.textAlign = 'center'; g.textBaseline = 'bottom'; g.font = small; g.fillStyle = 'rgba(255,255,255,.6)'; g.fillText(AI.training && AI.par ? 'its weights: live only on 1 core, or watching at 1×' : big ? 'its weights (orange +, blue −): Train or Drive it to see it think, live' : 'its weights: Train or Drive it to see it think', W / 2, Hc - 1); }
  if (!hov) return;
  // what the dot is: its explanation, its value, and its pulls on the outputs now
  const [kind, k] = hov, tb = `600 ${big ? 13 : 10}px system-ui, sans-serif`, tn = `${big ? 12 : 9.5}px system-ui, sans-serif`, rows = [];
  const sgn = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2);
  if (kind === 'i') {
    const d = AI.groups[k];
    rows.push([AI.names[k], tb], [AI_ABOUT[d.id] || d.tip, tn]);
    if (x) rows.push([`now: ${AI.shows[k](x[k])} (${sgn(x[k])} to the network)`, tn]);
    if (!h) rows.push([(x ? 'its pull now: ' : 'its weights: ') + AI_OUTS.slice(0, O).map((o, j) => `${o.name} ${sgn(w[j * I + k] * (x ? x[k] : 1))}`).join(', '), tn]);
  } else if (kind === 'o') {
    rows.push([AI_OUTS[k].name, tb], [AI_OUTS[k].about, tn]);
    if (x) rows.push([`now: ${AI_OUTS[k].fmt(aiY[k])} (${sgn(aiY[k])})`, tn]);
  } else {
    rows.push([`hidden unit ${k + 1} of ${h}`, tb], ['A feature of its own: a mix of the inputs it learned to look for, which the outputs then use.', tn]);
    if (x) rows.push([`now: ${sgn(aiHid[k])}`, tn]);
  }
  aiTipBox(g, cv._hx, cv._hy, W, Hc, rows, big ? 12 : 9.5);
}
// the full-screen view's lists: each input's value, each output's, live
function aiIoLive(live) {
  if (!AI.big) return;
  const x = live ? aiX : null, vals = {};
  for (let i = 0; i < AI.nIn; i++) { const id = AI.groups[i]?.id; if (id) (vals[id] = vals[id] || []).push(x ? AI.shows[i](x[i]) : ''); }
  AI.el.querySelectorAll('#aiIns .v').forEach(s => { const v = vals[s.dataset.v]; s.textContent = v && x ? v.join(' · ') : v ? 'on' : ''; });
  AI.el.querySelectorAll('#aiOuts .orow').forEach((r, k) => {
    const has = k < AI.nOut, keyed = k < 2 && (k ? AI.kp : AI.ks), v = !x || !has ? 0 : keyed || (k === 1 && AI.nb) ? AI.applied[k] : aiY[k];
    r.classList.toggle('off', !has);
    const b = r.querySelector('.bar i'), a = Math.min(1, Math.abs(v));
    b.style.left = (v >= 0 ? 50 : 50 - a * 50) + '%'; b.style.width = a * 50 + '%'; b.style.background = v >= 0 ? '#ff8a3d' : '#4aa8ff';
    r.querySelector('.v').textContent = !has ? 'not an output' : x ? AI_OUTS[k].fmt(v) : '';
  });
}

// before the world changes under it (called from regenerateWorld, also at boot, before AI exists)
// A hidden tab (another tab in front, the window minimised) gets no animation frames, and the training waited for
// them (#323): while hidden it goes on from here, a frame's worth at a time, from a message to itself (not slowed down
// as a hidden tab's timers are); the workers' results come in between. Shown again, the frames take over.
const aiBg = { ch: null, on: false, t: 0 };
function aiBgKick() {
  if (AI_WK || aiBg.on || !AI.training || !document.hidden) return;
  if (!aiBg.ch) { aiBg.ch = new MessageChannel(); aiBg.ch.port1.onmessage = aiBgSlice; }
  aiBg.on = true; aiBg.ch.port2.postMessage(0);
}
function aiBgSlice() {
  aiBg.on = false;
  if (!AI.training || !document.hidden) return;
  const now = performance.now(), dt = Math.min((now - (aiBg.t || now)) / 1000, 0.05); aiBg.t = now;
  try { aiTrainFrame(dt); } catch (e) { aiTrainFail(e); }
  aiBgKick();
}
if (!AI_WK) document.addEventListener('visibilitychange', () => { aiBg.t = 0; aiBgKick(); });
function aiHalt(drive, why) { try { if (AI.training) { aiTrain(false); if (why) { AI.stopWhy = { why, gen: AI.gen }; aiShow(); } } if (drive && AI.drive) { AI.drive = false; aiShow(); } } catch (e) { } }
// in a race room: not on the grid or in a race (before our finish); there the others see none of it (mpFrame, mpSendHit)
const aiAllowed = () => !MP.on || !(MP.hold || ((MP.phase === 'countdown' || MP.phase === 'racing') && !MP.finished && !MP.spectator));
// for tests (the headless browser draws a frame a second): whole generations, now
function aiTrainSync(gens = 1, cfg) {
  if (cfg) {
    if (cfg.h != null && cfg.h !== AI.h) { AI.h = cfg.h; AI.key = ''; }
    if (cfg.inputs || cfg.hb != null || cfg.kp != null || cfg.ks != null || cfg.nb != null) { aiSetInputs(cfg.inputs || AI.inputs, cfg.hb ?? AI.hb, true, cfg.kp ?? AI.kp, cfg.ks ?? AI.ks, cfg.nb ?? AI.nb); AI.key = ''; }
    Object.assign(AI_CFG, cfg);
  }
  AI.sync = true; aiTrain(true);                                      // (this tab's alone: no workers)
  const g = AI.gen + gens;
  while (AI.gen < g) aiTick();
  aiTrain(false); AI.sync = false;
  return { gen: AI.gen, bestFit: AI.bestFit, bestLap: AI.bestLap, len: botPath().len, hist: AI.hist.slice(-gens) };
}
// one try with these weights (the best so far), as training drives it: how it ended
function aiTry(w, log = 0, race = false) {
  AI.sync = true; aiTrain(true);
  w = w || AI.best || AI.w;                                           // (after aiTrain: a change of exam re-examines the best first)
  if (race && aiRival()) aiStartEpisode(w, 0, aiLapT(), 0, 1, aiRaceScen()); else aiExamStart(w);   // race: the exam's race with the rival
  const trace = []; let fit = null, n = 0;
  while ((fit = aiStep()) == null) if (log && ++n % log === 0) trace.push([+AI.ep.t.toFixed(1), Math.round(AI.ep.st.dist), +AI.ep.st.lat.toFixed(1), +car.vel.length().toFixed(1), +car.steer.toFixed(2), +AI.ctl.throttle.toFixed(2), +AI.ctl.brake.toFixed(2), AI.ctl.handbrake ? 1 : 0]);
  const r = { ...AI.last, fit, trace };
  aiTrain(false); AI.sync = false;
  return r;
}

// ---------- the rival (#311): a second car of the same kind, with physics of its own ----------
// The physics drives one car (`car`, with VEH, ENG, PRESSURES, CAR_HW.., input and the frame vectors): the rival is a
// whole car's state kept aside and swapped in for its own steps (aiRvSwap twice puts things back), so it drives, hits and
// is dented by the same code as ours. A replay rival isn't driven: it follows a tape of its own drive, alone (aiRvRecord).
const AI_RV_KINDS = { catch: 'ahead, slower', side: 'alongside', behind: 'close behind', race: 'the race' };
// the rival's car: another of ours, or the one chosen (AI_CFG.rivalCar), which drives with its own best training on this
// course (aiBrainOf: none, no rival)
const aiRivalKey = () => AI_CFG.rivalCar && ROAD_CARS[AI_CFG.rivalCar] ? AI_CFG.rivalCar : VEH.key;
function aiRival() {
  const key = aiRivalKey();
  if (!ROAD_CARS[key]) return null;                                  // (the buggy: no second one to build)
  const own = key === VEH.key, ck = courseKey();
  if (AI.rv && AI.rv.key === key && AI.rv.ck === ck) return own || AI.rv.brain ? AI.rv : null;
  const brain = own ? null : aiBrainOf(key);
  if (!own && !brain) return null;
  if (AI.rv && AI.rv.key === key) { AI.rv.ck = ck; AI.rv.brain = brain; return AI.rv; }
  if (AI.rv) { if (AI.rv.in) aiRvSwap(AI.rv); scene.remove(AI.rv.V.vis); }
  const V = makeRoadVehicle(key); V.mpPaint = 0x1f6fff;            // blue: told apart from ours (and kept when its model loads)
  setPaint(V, V.mpPaint, false); if (MODELS[V.key]) loadModel(V); V.vis.visible = false;
  const c = { mass: V.mass, I: V.I.clone(), pos: new THREE.Vector3(), vel: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), steer: 0, throttle: 0, awd: V.awd, pIdx: V.pIdx, aids: car.aids, split: carSplit(V),
    R: V.R, REST: V.REST, K: V.K, CB: V.CB, CR: V.CR, Iw: V.Iw, wheels: V.wheels, hull: V.hull, eng: { rpm: V.eng.idle, gear: 1, shiftT: 0, load: 0, cut: false, reverse: false, liftT: 9, lastPower: 0, popT: 0, tc: 1, sinceShift: 0 },
    dmg: { front: 0, rear: 0, left: 0, right: 0, roof: 0, under: 0 }, hullC: new Uint8Array(V.hull.length), grace: 0, wrecked: false, isRival: true, rivalCtl: { throttle: 0, brake: 0, steer: 0, handbrake: false } };
  return AI.rv = { key, ck, brain, V, c, keys: [...new Set([...Object.keys(car), ...Object.keys(c)])], VIS: V.vis, ENG: V.eng, P: V.pressures, box: V.box.slice(),
    inp: { throttle: 0, brake: 0, steer: 0, handbrake: false }, f: [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0)], hc: 1, hook: null, rhook: null,
    in: false, on: false, st: { i: -1, dist: 0, lat: 0 }, w: null, skill: 1, mode: 'car', tape: null, dAcc: 0 };
}
const aiRvTmp = new THREE.Vector3();
// another car's driver: its best training on this course in this browser (the fastest lap), as trained: its inputs, size
// and outputs (from the training's key), what it was shown (pace notes, line, look-ahead: from its exam's settings) and
// its own record lap as the demo (aiDemoNow, by the car in VEH); null if it has none
const AI_BRAIN = ['inputs', 'h', 'hb', 'kp', 'ks', 'nb', 'nIn', 'nOut', 'np', 'names', 'shows', 'demoKey', 'demo', 'lineFor', 'lineKey', 'line', 'paceFor', 'paceKey', 'paceV'];
const AI_BRAIN_CFG = ['pace', 'gCorner', 'gBrake', 'gAccel', 'racingLine', 'lineW', 'lookTime'];
function aiBrainOf(key) {
  const pre = `sandbuggy.ai.${courseKey()}.${key}.`; let best = null;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i); if (!k || !k.startsWith(pre)) continue;
    const m = k.slice(pre.length).match(/^(\d+)(?:\.(.+))?$/); if (!m || !AI_SIZES.includes(+m[1])) continue;
    const tok = m[2] ? m[2].split('+') : [], flags = ['hb', 'kp', 'ks', 'nobrake'];
    const inputs = m[2] ? tok.filter(t => !flags.includes(t)) : AI_DEFAULT_INPUTS;
    if (!inputs.length || !inputs.every(id => AI_INPUTS.some(d => d.id === id))) continue;
    let d; try { d = JSON.parse(localStorage.getItem(k)); } catch (e) { continue; }
    const hb = tok.includes('hb'), h = +m[1], sh = aiShape(inputs, hb, h);
    if (!d?.best || d.best.length !== sh.np || !(d.bestFit >= 0)) continue;
    if (best && (d.bestLap ?? Infinity) >= (best.lap ?? Infinity) && !(best.lap == null && d.bestFit > best.fit)) continue;
    const names = [], shows = [];
    for (const q of AI_INPUTS) if (inputs.includes(q.id)) q.names.forEach((nm, j) => { names.push(nm); shows.push(Array.isArray(q.show) ? q.show[j] : q.show); });
    const ex = String(d.exam || '').split(' '), cfg = {};
    for (const c of AI_BRAIN_CFG) cfg[c] = AI_CFG[c];
    if (ex.length >= 9 && Number.isFinite(+ex[1])) Object.assign(cfg, { pace: +ex[1], gCorner: +ex[2], gBrake: +ex[3], gAccel: +ex[4], racingLine: ex[5] !== '-', lineW: ex[5] === '-' ? AI_CFG.lineW : +ex[5], lookTime: ex[6] === 't' });
    best = { key: k, lap: d.bestLap ?? null, fit: d.bestFit, w: Float32Array.from(d.best), ai: { inputs, h, hb, kp: tok.includes('kp'), ks: tok.includes('ks'), nb: tok.includes('nobrake'), ...sh, names, shows, demoKey: null }, cfg };
  }
  return best;
}
// its driver in place of ours (twice: ours back)
function aiBrainSwap(b) {
  for (const k of AI_BRAIN) { const t = AI[k]; AI[k] = b.ai[k]; b.ai[k] = t; }
  for (const k of AI_BRAIN_CFG) { const t = AI_CFG[k]; AI_CFG[k] = b.cfg[k]; b.cfg[k] = t; }
}
function aiRvSwap(R) {
  if (!R.in) R.hc = 1;                                                 // (no messages for the rival's knocks)
  for (const k of R.keys) { const t = car[k]; car[k] = R.c[k]; R.c[k] = t; }
  let t = VEH; VEH = R.V; R.V = t; t = VIS; VIS = R.VIS; R.VIS = t; t = ENG; ENG = R.ENG; R.ENG = t; t = PRESSURES; PRESSURES = R.P; R.P = t;
  t = [CAR_HW, CAR_ZF, CAR_ZR]; [CAR_HW, CAR_ZF, CAR_ZR] = R.box; R.box = t;
  for (const k of ['throttle', 'brake', 'steer', 'handbrake']) { t = input[k]; input[k] = R.inp[k]; R.inp[k] = t; }
  [up, fwd, down].forEach((v, i) => { aiRvTmp.copy(v); v.copy(R.f[i]); R.f[i].copy(aiRvTmp); });
  t = hitCooldown; hitCooldown = R.hc; R.hc = t;
  t = carHitHook; carHitHook = R.hook; R.hook = t; t = carRepairHook; carRepairHook = R.rhook; R.rhook = t;   // (the room hears nothing of it)
  R.in = !R.in;
}
// placed (aiPlaceCar): its tracking and controls from scratch, on its tape's first pose if a replay
function aiRvReady(R) {
  R.st = { i: -1, dist: 0, lat: 0 }; R.c.rivalCtl = { throttle: 0, brake: 0, steer: 0, handbrake: false }; R.dAcc = 0;
  if (R.mode === 'replay') aiRvPose(R, 0);
  aiTrack(R.st, R.c.pos.x, R.c.pos.z);
}
// the rival's decision, with it in `car` (and the network view left as ours had it)
function aiRvAct(R, st) {
  const kx = aiX.slice(), ky = aiY.slice(), kh = aiHid.slice(), ka = AI.applied.slice(), kl = AI.lastCtl, kw = AI.viewW, kn = AI.nAct, kk = AI.look.slice(), kr = AI.rayEnds.slice();
  if (R.brain) aiBrainSwap(R.brain);
  const c = aiAct(R.w, st, AI_DT, false);
  if (R.brain) aiBrainSwap(R.brain);
  aiX.set(kx); aiY.set(ky); aiHid.set(kh); AI.applied[0] = ka[0]; AI.applied[1] = ka[1]; AI.lastCtl = kl; AI.viewW = kw; AI.nAct = kn; AI.look = kk; AI.rayEnds = kr;
  return { throttle: c.throttle * R.skill, brake: c.brake, steer: c.steer, handbrake: c.handbrake };   // (skill < 1: a slower one)
}
// its decision in a drive with ours (mySt: ours), seeing ours as ours sees it
function aiRvDecide(R, mySt) {
  aiRvSwap(R); AI.other = { st: mySt, vel: R.c.vel };                  // (ours is the one kept aside now)
  car.rivalCtl = aiRvAct(R, R.st);
  aiRvSwap(R); AI.other = { st: R.st, vel: R.c.vel };
}
// one physics step of it (a car), and the two cars' contact; E counts the impacts, each by the blame of ours
function aiRvSub(R, E, mySt, dt) {
  if (R.mode === 'car') { aiRvSwap(R); stepCar(dt); collideGates(dt); aiRvSwap(R); }
  const vn = aiCarContact(R);
  if (vn == null) { E.touching = false; return; }
  if (vn > 0.3) {
    const g = aiGap(R.st.i - mySt.i);
    E.contact += vn * (g > 1.5 ? 0.75 : g < -1.5 ? 0.25 : 0.5);       // behind it: mostly ours; ahead: a little (no braking in its way)
    if (!E.touching) E.touches++;
  }
  E.touching = true;
}
// after a step (k: steps so far): its grace runs down; a replay moves on along its tape
function aiRvLate(R, k, dt) {
  R.c.grace = Math.max(0, R.c.grace - dt);
  if (R.mode === 'replay') { aiRvPose(R, k); aiTrack(R.st, R.c.pos.x, R.c.pos.z); }
}
// metres along the line, wrapped to the nearer way round (from path indices apart)
function aiGap(di) { const Pt = botPath(), L = Pt.len, g = di * Pt.ds; return ((g % L) + L * 1.5) % L - L / 2; }
// the tape of a replay rival: its own drive, alone (it sees no other), from d m along the line, lat m to the left; a pose
// (position, rotation, velocity) every AI_DT for limit s, or until it has gone upto m
function aiRvRecord(R, d, lat, roll, limit, upto = Infinity) {
  if (AI.freshC || AI.snapH) aiGroundBack();
  const keep = AI.other, n = Math.ceil(limit / AI_DT) + 1, T = new Float32Array(n * 10), st = { i: -1, dist: 0, lat: 0 };
  AI.other = null; aiRvSwap(R); repairCar(); aiPlaceCar(d, lat, false, false, roll);
  let acc = 0, k = 0;
  for (; k < n; k++) {
    const p = car.pos, q = car.q, v = car.vel; T.set([p.x, p.y, p.z, q.x, q.y, q.z, q.w, v.x, v.y, v.z], k * 10);
    if (st.dist > upto) break;
    car.rivalCtl = aiRvAct(R, st); readInput(AI_DT);
    acc += AI_DT; while (acc >= DT) { stepCar(DT); collideGates(DT); acc -= DT; }
    car.grace = Math.max(0, car.grace - AI_DT);
  }
  aiRvSwap(R); AI.other = keep;
  return T.slice(0, Math.min(k + 1, n) * 10);
}
function aiRvPose(R, k) {
  const T = R.tape; if (!T) return;
  const m = Math.min(k, T.length / 10 - 1) * 10, c = R.c;
  c.pos.set(T[m], T[m + 1], T[m + 2]); c.q.set(T[m + 3], T[m + 4], T[m + 5], T[m + 6]); c.vel.set(T[m + 7], T[m + 8], T[m + 9]); c.w.set(0, 0, 0);
}
// Car against car (ccSolve, as the bots' contact), both pushed, by their masses (a replay: only ours, it doesn't give);
// dents on both (aiCarDent). The impact speed (m/s), or null when they don't touch
const aiCQ = new THREE.Quaternion(), aiCN = new THREE.Vector3(), aiCV = new THREE.Vector3();
function aiCarContact(R) {
  const b = R.c, kin = R.mode === 'replay';
  if (Math.abs(car.pos.y - b.pos.y) > 1.6) return null;
  const qb = b.q, bx = 2 * (qb.x * qb.z + qb.w * qb.y), bz = 1 - 2 * (qb.x * qb.x + qb.y * qb.y), [hwB, zfB, zrB] = R.box;
  const A = ccOurs(CC.a), O = ccBody(CC.b, b.pos.x, b.pos.z, bx, bz, hwB, zfB, zrB, b.vel.x, b.vel.z, b.w.y, kin ? 0 : b.mass, b.I.y), H = ccSolve(A, O);
  if (!H) return null;
  ccOursBack(A);
  if (!kin) { b.vel.x = O.vx; b.vel.z = O.vz; b.w.y = O.wy; b.pos.x += O.dx; b.pos.z += O.dz; }
  const vn = H.vn, nx = H.nx, nz = H.nz;
  if (vn > 1.5) {
    const la = (H.cx - car.pos.x) * A.fx + (H.cz - car.pos.z) * A.fz, lb = (H.cx - b.pos.x) * O.fx + (H.cz - b.pos.z) * O.fz;
    aiCarDent(nx, nz, la, vn); if (!kin) { aiRvSwap(R); aiCarDent(-nx, -nz, lb, vn); aiRvSwap(R); }
  }
  return vn;
}
// the car in `car` struck at l m along its axis, from where n points (from the other car to it)
function aiCarDent(nx, nz, l, vn) {
  if (car.grace > 0) return;
  aiCQ.copy(car.q).invert(); aiCN.set(nx, 0, nz).applyQuaternion(aiCQ); aiCV.set(-aiCN.x * CAR_HW, 0.45, l - aiCN.z * 0.9);
  const zone = Math.abs(aiCN.z) >= Math.abs(aiCN.x) ? (aiCN.z < 0 ? 'front' : 'rear') : (aiCN.x < 0 ? 'left' : 'right');
  addDamage(zone, (vn - 1.5) ** 2 * 0.012); carHit(aiCV, aiCN, vn, HIT.ball);
  audio?.node.port.postMessage({ crash: Math.min(1, vn * 0.1) });
  if (hitCooldown <= 0 && !car.wrecked) { hitCooldown = 0.6; flash(`Contact with the rival · ${zone} damage ${Math.round(car.dmg[zone] * 100)}%`, '#ff9a6a', 1.8); }
}
// a generation's meeting with the rival (AI_CFG.rivalShare of them): ahead and slower (to catch and pass), alongside, or
// close behind (no braking in front of it); against one of the earlier bests (AI.rvPool), or the best
function aiScenario() {
  if (AI_CFG.rival === 'off' || !aiRival() || Math.random() >= AI_CFG.rivalShare) return null;
  const k = Math.floor(Math.random() * 3), rnd = Math.random, sd = rnd() < 0.5 ? 1 : -1, g = Math.min(2.2, aiHalfW() * 0.4);
  const sc = k === 0 ? { kind: 'catch', gap: 6 + rnd() * 19, lat: (rnd() - 0.5) * 3, myLat: 0, skill: 0.8 + rnd() * 0.13 }
    : k === 1 ? { kind: 'side', gap: (rnd() - 0.5) * 4, lat: g * sd, myLat: -g * sd, skill: 0.93 + rnd() * 0.07 }
    : { kind: 'behind', gap: -(6 + rnd() * 12), lat: (rnd() - 0.5) * 3, myLat: 0, skill: 1 };
  const P = AI.rvPool; sc.w = P.length ? (rnd() < 0.5 ? P[P.length - 1] : P[Math.floor(rnd() * P.length)]) : AI.best || AI.w;
  return sc;
}
// the rivals: a copy of the best every AI_CFG.rivalEvery generations (the last 4 kept); the newest is the exams' race,
// so the best races it at once (its score was against an older one)
function aiRvKeep() {
  if (AI_CFG.rival === 'off' || !AI.best || !aiRival() || AI.rv.brain) return;   // (another car: its own driver, not ours)
  if (AI.rvPool.length && AI.gen % AI_CFG.rivalEvery) return;
  AI.rvPool.push(Float32Array.from(AI.best)); if (AI.rvPool.length > 4) AI.rvPool.shift();
  if (AI.par && aiPoolOk()) {                                          // on several cores: a worker races it (here it froze the page for a second)
    AI_POOL.jobs.unshift({ kind: AI.bestSolo == null ? 'exam' : 'race', keep: true, w: Float32Array.from(AI.best), epoch: AI_POOL.epoch }); aiPoolPump(); return;
  }
  const keep = AI.last, kr = AI.lastRace;
  if (AI.bestSolo == null) { const x = aiExamRun(AI.best); AI.bestFit = x.fit; AI.bestSolo = x.solo; }
  else { aiStartEpisode(AI.best, 0, aiLapT(), 0, 1, aiRaceScen()); while (aiStep() == null) { } AI.ep = null; AI.bestFit = AI.bestSolo - aiRaceCost(AI.last); }
  AI.last = keep; AI.lastRace = kr;
}
// Race it, each frame: (after ours decided, from simulate) the rival decides every AI_DT as trained, and takes its controls
function aiRvFrame(dt) {
  const R = AI.rv, E = AI.race; if (!E || !R) return;
  if (!AI.drive) { AI.race = null; AI.other = null; R.on = false; aiShow(); return; }
  if (R.mode === 'replay') { E.t += dt; return; }
  R.dAcc += dt;
  if (R.dAcc >= AI_DT) { R.dAcc = Math.min(R.dAcc - AI_DT, AI_DT); aiRvDecide(R, AI.dst); }
  aiRvSwap(R); readInput(dt); aiRvSwap(R);
}
function aiRvFrameLate(dt) {
  const R = AI.rv, E = AI.race; if (!E || !R) return;
  aiRvLate(R, Math.round(E.t / AI_DT), dt);
  AI.other = { st: R.st, vel: R.c.vel };
}
// the rival's body where its state is (a frame, before ours: the sun follows ours)
function aiRvSync() {
  const R = AI.rv; if (!R) return;
  const show = R.on && !ed.on && !rp.on && (AI.training ? !!AI.ep?.rv : !!AI.race);
  R.V.vis.visible = show;
  if (show) { aiRvSwap(R); syncVisual(); aiRvSwap(R); }
  const el = AI.el.querySelector('#aiRaceInfo');
  if (AI.race && AI.dst && (AI.race.infoT = (AI.race.infoT || 0) + 1) % 10 === 0) {
    const g = Math.round(AI.dst.dist - R.st.dist), n = AI.race.touches;
    el.textContent = `Race against the ${ROAD_CARS[R.key].short || ROAD_CARS[R.key].name}: ${g >= 0 ? 'ahead by' : 'behind by'} ${Math.abs(g)} m · ${n ? `${n} contact${n > 1 ? 's' : ''}` : 'no contact'}`;
  } else if (!AI.race && el.textContent) el.textContent = '';
}
// the last exam's race, for the panel
const aiRaceLine = L => !L ? '' : `<br>Race: ${L.why === 'lap' ? 'finished' : L.at + ' m'}${L.rival ? ` · ${L.rival.touches ? `${L.rival.touches} contact${L.rival.touches > 1 ? 's' : ''} (−${L.rival.cpen})` : 'clean'} · ${L.rival.gain >= 0 ? 'ahead by' : 'behind by'} ${Math.abs(L.rival.gain)} m` : ''}`;

// ---------- the panel (I): a column on the left, or the whole screen (⤢) ----------
document.head.insertAdjacentHTML('beforeend', `<style>
  /* a drawer down the left side (#331), sliding in when the lab opens and out when it closes; ⤢ widens it to the whole
     window, which hides the drive (nor is it drawn then), ⤡ narrows it back. The sim shows and hides it with display:
     @starting-style and display's discrete transition let it slide both ways (without them it just shows and goes) */
  :root{--ai-w:min(360px,calc(100vw - 24px));--ai-ease:cubic-bezier(.2,.8,.2,1)}
  #aiPanel{display:none;left:0;top:0;bottom:0;width:var(--ai-w);max-height:none;box-sizing:border-box;border-radius:0 14px 14px 0;overflow:auto;pointer-events:auto;z-index:15;
    background:rgba(14,11,8,.96);box-shadow:8px 0 32px #0008;transform:none;
    transition:transform .32s var(--ai-ease),width .32s var(--ai-ease),border-radius .32s,display .32s allow-discrete}
  #aiPanel[style*="display: none"]{transform:translateX(-102%)}
  @starting-style{#aiPanel{transform:translateX(-102%)}}
  @media (prefers-reduced-motion: reduce){#aiPanel{transition:none}}
  #toast{z-index:30}
  #aiPanel .aiHd .ic+.ic{margin-left:-4px}
  /* the car's read-out moves out from under the drawer: beside it, at the bottom */
  body.ai-drawer #hud{left:calc(var(--ai-w) + 12px);top:auto;bottom:12px}
  #aiPanel .aiHd{display:flex;align-items:flex-start;gap:8px} #aiPanel .aiHd>div{flex:1;min-width:0}
  #aiPanel .lt{font-size:12px;letter-spacing:2px;opacity:.85}
  #aiPanel .sub{font-size:11px;opacity:.7;margin-bottom:6px}
  #aiPanel .st{font-variant-numeric:tabular-nums;margin:4px 0;font-size:12px}
  #aiPanel canvas{display:block;width:100%;height:64px;margin:4px 0}
  #aiPanel label.hbr{padding-left:14px} #aiPanel label.hbr input[type=number]{width:44px}
  #aiPanel .aiMapBox{display:none} #aiPanel .aiMapBox.on{display:block} #aiPanel #aiMap{cursor:crosshair} #aiPanel:not(.big) #aiMap{height:auto;aspect-ratio:1/1}
  #aiPanel button{font:inherit;font-size:12px;font-weight:700;border:0;border-radius:6px;padding:6px 10px;margin:0;cursor:pointer;color:#fff;background:#ffffff26}
  #aiPanel button:hover{background:#ffffff40} #aiPanel button.on{background:#ff5a00} #aiPanel button:disabled{opacity:.4;cursor:default;background:#ffffff1a}
  #aiPanel #aiTrain{background:#ff5a0099} #aiPanel #aiTrain:hover,#aiPanel #aiTrain.on{background:#ff5a00}
  #aiPanel button.ic{padding:2px 8px;font-size:15px;line-height:1.3;background:#ffffff1a}
  #aiPanel .grp{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px} #aiPanel .gh{display:none}
  #aiPanel #aiLoad{margin:6px 0;padding:6px 8px;border-radius:6px;background:#ffffff0d;font-size:11px}
  #aiPanel .gh2{font-size:9.5px;letter-spacing:1px;text-transform:uppercase;opacity:.6;margin-bottom:3px}
  #aiPanel .ld{display:grid;grid-template-columns:62px 1fr 34px 44px;align-items:center;gap:6px;margin:2px 0}
  #aiPanel .ld i{height:6px;background:#ffffff18;border-radius:3px;overflow:hidden} #aiPanel .ld i b{display:block;height:100%;border-radius:3px}
  #aiPanel .ld em{font-style:normal;text-align:right;font-variant-numeric:tabular-nums} #aiPanel .ld small{margin:0;opacity:.6;font-size:10px;white-space:nowrap;overflow:hidden}
  #aiPanel .lx{opacity:.75;margin-top:4px;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  /* text that changes as it trains: a line each, cut short, so nothing under it moves */
  #aiPanel .st .ln,#aiPanel #aiRate,#aiPanel #aiRaceInfo{white-space:nowrap;overflow:hidden;text-overflow:ellipsis} #aiPanel .st .dim{opacity:.75}
  #aiPanel .st{min-height:4.35em} #aiPanel #aiRate{min-height:1.45em}
  #aiPanel #aiTrain{min-width:7.4em} #aiPanel #aiWatch{min-width:7.8em} #aiPanel #aiDrive{min-width:7.6em} #aiPanel #aiRace{min-width:7.8em}
  /* scrollbars: thin, a light thumb on a see-through track, their room kept whether they show or not */
  #aiPanel,#aiPanel .aiLeft,#aiPanel #aiCfg,#aiPanel #aiServer{--sb-thumb:rgba(255,255,255,.4);--sb-track:transparent;scrollbar-width:thin;scrollbar-color:var(--sb-thumb) var(--sb-track);scrollbar-gutter:stable}
  @media (prefers-contrast: more){#aiPanel,#aiPanel .aiLeft,#aiPanel #aiCfg,#aiPanel #aiServer{--sb-thumb:#fff}}
  @supports not (scrollbar-color: auto){
    #aiPanel,#aiPanel .aiLeft,#aiPanel #aiCfg,#aiPanel #aiServer{scrollbar-width:auto}
    #aiPanel::-webkit-scrollbar,#aiPanel .aiLeft::-webkit-scrollbar,#aiPanel #aiCfg::-webkit-scrollbar,#aiPanel #aiServer::-webkit-scrollbar{width:8px;height:8px}
    #aiPanel ::-webkit-scrollbar-thumb,#aiPanel::-webkit-scrollbar-thumb{background:var(--sb-thumb);border-radius:4px}
    #aiPanel ::-webkit-scrollbar-track,#aiPanel::-webkit-scrollbar-track{background:var(--sb-track)}
  }
  #aiPanel.big #aiLoad{font-size:12.5px;padding:10px 12px;border-radius:10px} #aiPanel.big .ld{grid-template-columns:76px 1fr 40px 56px} #aiPanel.big .ld i{height:8px} #aiPanel.big .ld small{font-size:11.5px}
  #aiPanel #aiLaps table{width:100%;border-collapse:collapse;font-size:11px;margin-top:4px} #aiPanel #aiLaps th{text-align:left;font-weight:600;opacity:.6;padding:2px 4px}
  #aiPanel #aiLaps td{padding:3px 4px;border-top:1px solid #ffffff14;font-variant-numeric:tabular-nums} #aiPanel #aiLaps tr.cur td{background:#ff5a0026}
  #aiPanel.big #aiLapsBox{margin-top:10px;background:#ffffff09;border:1px solid #ffffff14;border-radius:10px;padding:8px 10px} #aiPanel.big #aiLaps table{font-size:12px}
  #aiPanel label.qc{margin:0 2px 0 0;padding:0 6px;border-radius:6px;background:#ffffff14;font-size:12px;font-weight:700;gap:4px} #aiPanel label.qc select{font-weight:700}
  #aiPanel .aiKpi{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;margin:6px 0}
  #aiPanel .aiKpi>div{background:#ffffff12;border-radius:6px;padding:3px 6px;min-width:0}
  #aiPanel .aiKpi .k{font-size:9px;letter-spacing:.6px;text-transform:uppercase;opacity:.65;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #aiPanel .aiKpi .v{font-size:15px;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #aiPanel .aiKpi .u{font-size:.6em;font-weight:600;opacity:.7;margin-left:2px} #aiPanel .aiKpi .s{font-size:10px;opacity:.65;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #aiPanel .aiBigOnly,#aiPanel .h2,#aiPanel .hint,#aiPanel .io .v,#aiPanel #aiOuts,#aiPanel .aiCtlBox{display:none}
  #aiPanel details{margin-top:8px} #aiPanel summary{cursor:pointer;font-weight:700;font-size:12px}
  #aiPanel .h3{font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;opacity:.75;margin:8px 0 2px}
  #aiPanel .note{font-size:11px;opacity:.65}
  #aiPanel label{display:flex;align-items:center;gap:6px;font-size:12px;margin:3px 0;cursor:pointer}
  #aiPanel .pen{font-size:12px} #aiPanel .pen label,#aiPanel label.num{justify-content:space-between}
  #aiPanel input[type=number],#aiPanel select{font:inherit;font-size:12px;background:#ffffff1f;color:#fff;border:1px solid #ffffff40;border-radius:4px;padding:1px 4px}
  #aiPanel input[type=number]{width:58px} #aiPanel select option{color:#000}
  #aiPanel #aiServer{margin-top:6px;max-height:220px;overflow:auto;border-top:1px solid #ffffff30}
  #aiPanel .srv{display:flex;align-items:center;gap:4px;padding:4px 0;border-bottom:1px solid #ffffff1a} #aiPanel .srv .si{flex:1;min-width:0;font-size:12px}
  #aiPanel .srv b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap} #aiPanel .srv .sub{margin:0}
  #aiPanel .srv button{margin:0;padding:4px 8px}
  #aiPanel small{display:block;opacity:.7;margin-top:6px;font-size:11px;line-height:1.35}
  /* the whole screen */
  #aiPanel.big{display:flex!important;flex-direction:column;inset:0 auto 0 0;width:100vw;max-height:none;padding:14px 18px 12px;z-index:20;overflow:hidden;
    background:#0e0b08;border-radius:0;font-size:14px;text-shadow:none;box-shadow:none}
  #aiPanel.big .aiHd{align-items:center;margin-bottom:10px} #aiPanel.big .lt{font-size:15px;font-weight:700}
  #aiPanel.big .sub{font-size:12.5px;margin-bottom:4px} #aiPanel.big .aiHd .sub{margin:2px 0 0}
  #aiPanel.big button.ic{font-size:13px;padding:7px 12px}
  #aiPanel.big .aiBody{flex:1;min-height:0;display:grid;grid-template-columns:minmax(300px,340px) minmax(0,1fr) minmax(330px,410px);gap:14px}
  #aiPanel.big .aiLeft,#aiPanel.big #aiCfg{min-height:0;overflow:auto;margin:0;padding-right:4px}
  #aiPanel.big #aiCfg>summary{display:none} #aiPanel.big{scrollbar-gutter:auto}
  #aiPanel.big .aiMid{min-height:0;display:grid;grid-template-rows:minmax(0,1.6fr) minmax(0,1fr);gap:14px}
  #aiPanel.big .aiBox{background:#ffffff09;border:1px solid #ffffff14;border-radius:10px;padding:10px 12px;min-height:0;display:flex;flex-direction:column}
  #aiPanel.big .aiChartBox{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  #aiPanel.big .aiMid.map{grid-template-columns:minmax(0,2fr) minmax(0,1fr)} #aiPanel.big .aiMid.map .aiNetBox{grid-column:1 / span 2}
  #aiPanel.big .aiMid.map .aiChartBox{grid-column:1;grid-row:2} #aiPanel.big .aiMid.map .aiMapBox.on{display:flex;grid-column:2;grid-row:2}
  #aiPanel.big .aiCv{position:relative;flex:1;min-height:0} #aiPanel.big .aiCv canvas{position:absolute;inset:0;width:100%;height:100%;margin:0}
  #aiPanel.big .aiBigOnly{display:block} #aiPanel.big .h2{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px;font-weight:700;font-size:13px;margin-bottom:6px}
  #aiPanel.big .h2 span{font-weight:400;font-size:12px;opacity:.7} #aiPanel.big .h2 i{display:inline-block;width:14px;height:3px;border-radius:2px;vertical-align:middle;margin-right:4px}
  #aiPanel.big .aiKpi{gap:8px;margin:0 0 10px} #aiPanel.big .aiKpi>div{padding:8px 10px;border-radius:8px}
  #aiPanel.big .aiKpi .k{font-size:10.5px} #aiPanel.big .aiKpi .v{font-size:21px;line-height:1.3} #aiPanel.big .aiKpi .s{font-size:11.5px}
  #aiPanel.big .st{font-size:13px} #aiPanel.big .gh{display:block;flex-basis:100%;font-size:10.5px;letter-spacing:1px;text-transform:uppercase;opacity:.55;margin-top:8px}
  #aiPanel.big .grp{gap:6px} #aiPanel.big .grp button{font-size:13px;padding:8px 12px}
  #aiPanel.big .aiCtlBox.live{display:block;margin:10px 0 0;background:#ffffff09;border-radius:10px} #aiPanel.big .aiCtlBox canvas{height:auto;aspect-ratio:560/250;margin:0}
  #aiPanel.big .card{background:#ffffff09;border:1px solid #ffffff14;border-radius:10px;padding:8px 12px 10px;margin:0 0 10px}
  #aiPanel.big .h3{font-size:11px;margin:2px 0 6px;opacity:.85}
  #aiPanel.big label{font-size:13px;flex-wrap:wrap;margin:6px 0}
  #aiPanel.big .hint{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;flex-basis:100%;font-size:11.5px;line-height:1.35;opacity:.58;margin-top:-2px}
  #aiPanel.big label:has(input[type=checkbox]) .hint{padding-left:22px} #aiPanel.big label:hover .hint{-webkit-line-clamp:unset;opacity:.75}
  #aiPanel.big .io .nm{font-weight:600} #aiPanel.big .io .v{display:block;margin-left:auto;font-size:12px;opacity:.8;font-variant-numeric:tabular-nums;max-width:55%;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #aiPanel.big #aiOuts{display:block}
  #aiPanel.big .orow{display:grid;grid-template-columns:76px 1fr 92px;align-items:center;gap:4px 10px;margin:6px 0}
  #aiPanel.big .orow .nm{font-weight:600;font-size:13px} #aiPanel.big .orow .v{font-size:12px;opacity:.8;text-align:right;font-variant-numeric:tabular-nums}
  #aiPanel.big .orow .hint{grid-column:1/-1;padding:0} #aiPanel.big .orow.off{opacity:.45}
  #aiPanel.big .bar{position:relative;height:8px;background:#ffffff18;border-radius:4px} #aiPanel.big .bar::after{content:'';position:absolute;left:50%;top:-2px;bottom:-2px;width:1px;background:#ffffff70}
  #aiPanel.big .bar i{position:absolute;top:0;bottom:0;border-radius:4px}
  #aiPanel.big small{font-size:11.5px} #aiPanel.big .aiHelp{display:none}
</style>`);
AI.el = document.createElement('div'); AI.el.id = 'aiPanel'; AI.el.className = 'panel';
AI.el.innerHTML = `<div class="aiHd"><div><div class="lt">TNN LAB</div><div class="sub" id="aiSize"></div></div>
  <button id="aiBig" class="ic" title="Full screen: the network, the charts and every setting, explained (Esc: back)">⤢ Full screen</button><button id="aiClose" class="ic" title="Close the lab (I)" aria-label="Close the lab">✕</button></div>
  <div class="aiBody">
  <section class="aiLeft">
    <div class="aiKpi" id="aiKpi"></div>
    <div class="st" id="aiStat"></div><div class="sub" id="aiRate"></div><div class="sub" id="aiRaceInfo"></div>
    <div id="aiLoad" style="display:none"></div>
    <div class="grp"><div class="gh">Training</div><label class="qc" title="How many of this computer's cores train at once (the rest of these settings: This computer, under Inputs, outputs and penalties)">cores <select id="aiCoresQ">${Array.from({ length: aiCoresMax() }, (_, k) => `<option value="${k + 1}">${k + 1}</option>`).join('')}</select></label><label class="qc" title="Train at most this many generations, then stop (empty or 0: until you pause it, or it stops improving). The same as Tries, exams and when to stop's">max gens <input type="number" id="aiGensQ" min="0" max="100000" step="10" placeholder="∞" style="width:52px"></label><label class="qc" title="Once it laps: stop training when this many generations in a row bring no better lap (0 or empty: never), counted afresh at each Train or Train more. The same as Tries, exams and when to stop's" style="white-space:nowrap">stop if no better lap in <input type="number" id="aiStopQ" min="0" max="1000" step="5" placeholder="never" style="width:52px"> gens</label><button id="aiTrain">Train</button><button id="aiWatch" title="Run the training at real speed, with the sound, to watch every try (it learns no differently, only slower)">Watch at 1×</button><label class="qc" title="How fast Watch plays the training, and Drive it and Race it drive: 1× real time, 2× or 4× (the same physics, more of it a frame)">speed <select id="aiSpeed"><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></label><button id="aiBack" title="Carry on training from the best weights so far (the exam's best lap), not from where training wandered to">Back to the best</button><label class="qc" title="The network's size: inputs straight to the outputs (none), or a hidden layer of so many units between. Each size is a training of its own; a new one starts from this one's when both have a hidden layer (Start over: from nothing)">hidden <select id="aiHQ">${AI_SIZES.map(h => `<option value="${h}">${h || 'none'}</option>`).join('')}</select></label><button id="aiReset">Start over</button></div>
    <div class="grp"><div class="gh">Its best, at the wheel</div><button id="aiDrive">Drive it</button><button id="aiRace" title="Drive it against a rival: another of this car alongside on the grid, driven by the best network too (as Train's rival below: a replay of its own laps, or a car that reacts; a car if none is set)">Race it</button></div>
    <div class="grp aiFol"><div class="gh">A lap as its example</div><label class="qc" title="A recorded lap as the network's example: where that lap went and how fast, metre by metre, take the place of the computed racing line and pace notes (what it steers by, and the speed it is told each spot can be taken at). It then brakes where that lap brakes. Your best lap here is kept as you drive: a clean flying lap (not the first from the line, no respawn). In a race room, also the ghost you picked in Best laps. A training of this network carries on with the new example; its best lap is driven again">lap to follow <select id="aiFollow"></select></label><div class="sub" id="aiFollowSay"></div></div>
    <div class="grp"><div class="gh">Keep it</div><button id="aiSaveF" title="Download this training (the weights, the generations, the chart) as a file">Save to file</button><button id="aiLoadF" title="Load a training saved to a file">Load file</button><button id="aiSaveS" title="Save this training on the server, under a name: you, or anyone, can load it there">Save to server</button><button id="aiLoadS" title="The autopilots saved on the server: load one (yours or anyone's), delete yours">From server</button></div>
    <div id="aiServer" style="display:none"></div>
    <input type="file" id="aiFile" accept=".json,application/json" style="display:none">
    <div class="aiCtlBox"><canvas id="aiCtlBig" width="560" height="250"></canvas></div>
    <details id="aiLapsBox"><summary>Best laps on this course</summary><div id="aiLaps"></div></details>
  </section>
  <section class="aiMid">
    <div class="aiBox aiNetBox"><div class="h2">What it sees → what it does <span><i style="background:#ff8a3d"></i>pushes + (left, gas)</span><span><i style="background:#4aa8ff"></i>pushes − (right, brake)</span><span>thicker: stronger · hover a dot</span></div>
      <div class="aiCv"><canvas id="aiNet" title="Each line: an input's pull on an output right now (its value × its weight). Orange pushes + (steer left, throttle), blue − (steer right, brake); thicker, stronger. Hover a dot for what it is"></canvas></div></div>
    <div class="aiBox aiChartBox"><div class="aiCv"><canvas id="aiChart"></canvas></div><div class="aiCv aiBigOnly"><canvas id="aiChart2"></canvas></div><div class="sub" id="aiPast" style="display:none;grid-column:1/-1"></div></div>
    <div class="aiBox aiMapBox"><div class="aiCv"><canvas id="aiMap" title="Drive it: where it accelerates, coasts and brakes around the course, and where it pulls the handbrake (the latest pass at each point). Hover for the values"></canvas></div><div id="aiMapCmp"></div></div>
  </section>
  <details id="aiCfg"><summary>Inputs, outputs and penalties</summary>
    <div class="card"><div class="h3">Inputs: what it sees</div><div id="aiIns"></div></div>
    <div class="card"><div class="h3">Outputs: what it does</div><div id="aiOuts">${AI_OUTS.map(o => `<div class="orow"><span class="nm">${o.name}</span><span class="bar"><i></i></span><span class="v"></span><span class="hint">${o.about}</span></div>`).join('')}</div>
    <label title="A third output: on above 0 (it starts off, and learns when, if ever)"><input type="checkbox" id="aiHb"> handbrake (a 3rd output)</label>
    <label class="hbr" title="The handbrake only when the front wheels are really turned (their angle, not the steering output): at least this much of the lock the car has at its speed (less at speed). Asked for otherwise, it is held back (the last exam says how long)"><input type="checkbox" id="aiHbTurn"> ↳ only with the wheels turned, at least <input type="number" id="aiHbLock" min="5" max="100" step="5"> % of the lock</label>
    <label class="hbr" title="Never the handbrake while the pedal output is braking: with the gas or coasting only"><input type="checkbox" id="aiHbNoBrake"> ↳ never with the brake</label>
    <label title="Unticked: the pedal output is gas or nothing (below 0, off). No brake pedal: it slows by lifting off, or with the handbrake if it has one (a training of its own, starting from this one)"><input type="checkbox" id="aiBrk"> brake (unticked: gas or nothing)</label>
    <label title="The pedal output snapped to what W and S give: full throttle above +⅓, nothing between, full brake below −⅓"><input type="checkbox" id="aiKp"> pedals like the keyboard: full gas, off or full brake</label>
    <label title="The steering output snapped to what A and D give: full left above +⅓, straight between, full right below −⅓"><input type="checkbox" id="aiKs"> steering like the keyboard: full left, straight or full right</label></div>
    <div class="card pen"><div class="h3">Rewards and penalties</div><div class="note">metres added to or taken off a drive's score</div>
      <label title="Added for each km/h of its average speed along the line (speed already pays: more metres in a try's 15 s, and 5 m a second saved on an exam lap)">+ speed, a km/h on average <input type="number" id="aiPen_speed" min="0" max="50" step="0.5"></label>
      <label title="Off for each metre driven beyond its progress along the racing line: running wide and weaving cost, a tight line doesn't">− extra path, a metre <input type="number" id="aiPen_path" min="0" max="20" step="0.1"></label>
      <label title="Off for each full swing of the steering or pedal output (their changes added up: lock to lock is 2): jerky driving costs">− jerky, a full swing <input type="number" id="aiPen_smooth" min="0" max="100" step="0.5"></label>
      <label title="Off for each metre it drives off the course (the tarmac on road, between the gate posts off it)">− off the road, a metre <input type="number" id="aiPen_offRoad" min="0" max="20" step="0.5"></label>
      <label title="Off for the damage it takes: from 100 % to a wreck is this much">− damage, a wreck's worth <input type="number" id="aiPen_damage" min="0" max="1000" step="10"></label>
      <label title="Off for wrecking the car (on top of the damage), and the try ends there">− wrecked <input type="number" id="aiPen_wreck" min="0" max="1000" step="10"></label></div>
    <div class="card pen"><div class="h3">A rival car</div>
      <label title="None: it drives alone. A replay: the rival drives its own lap (as if alone) and doesn't react; ours learns to keep off it, follow and pass. A car: both drive at once and see each other, the rival reacts, and they push and dent each other. With one, part of the tries start beside it, catching it (a slower one), or with it close behind, and every exam is also a race of a lap alongside it, scored on its impacts, damage and finishing. Give the network the rival inputs, so it can see it"><select id="aiRival"><option value="off">none</option><option value="replay">a replay (doesn't react)</option><option value="car">a car (reacts, pushes)</option></select></label>
      <label style="justify-content:space-between" title="The same car as ours, driven by earlier bests of this network; or another, driven by its own best training on this course in this browser (train one with it first), as it was trained (its inputs, its pace notes and line, its record lap)">rival car <select id="aiRivalCar"><option value="">the same as mine</option>${Object.keys(ROAD_CARS).map(k => `<option value="${k}">${ROAD_CARS[k].name}</option>`).join('')}</select></label>
      <label title="The share of generations whose tries meet the rival (the others drive alone, for the pace)">share of generations with it <input type="number" id="aiRivalShare" min="0" max="1" step="0.1"></label>
      <label title="Off for each m/s of every impact with the rival: the car behind takes 3/4 of the blame, alongside half each (so braking in front of it costs too)">− contact, an m/s of impact <input type="number" id="aiPen_contact" min="0" max="500" step="1"></label>
      <label title="Added for each metre gained on the rival over a try or the race (lost: taken off). 0: it races only the clock">+ a metre gained on it <input type="number" id="aiPen_gain" min="0" max="10" step="0.1"></label></div>
    <div class="card"><div class="h3">Racing line and pace notes</div>
      <label title="Steer by, and take the pace notes from, the smoothest line within the road (out, clip the inside, out again) instead of the course's centre"><input type="checkbox" id="aiRL"> follow a racing line, not the centre</label>
      <label title="Where the line is looked at: 6, 15, 30, 50 and 100 m ahead, or 0.3, 0.7, 1.4, 2.4 and 4.8 s ahead at its speed (at least 3, 6, 12, 20, 40 m): one steering for every speed"><input type="checkbox" id="aiLT"> look ahead by time, not metres</label>
      <label style="justify-content:space-between" title="How far either side of the centre the racing line may go (0: the road's edge less 1.6 m, so the car stays on it; more: onto the verge, as drivers do)">racing line: room either side, m <input type="number" id="aiLW" min="0" max="15" step="0.5"></label>
      <label style="justify-content:space-between" title="How hard the car can speed up, for the pace notes (0: as fast as the bends allow at once)">pace notes: acceleration g <input type="number" id="aiGa" min="0" max="2" step="0.05"></label>
      <label style="justify-content:space-between" title="The grip the pace notes count on in bends, on tarmac (the bots': 0.84 g; sand and earth in proportion). Bends go with its square root">pace notes: cornering g <input type="number" id="aiGc" min="0.2" max="2" step="0.02"></label>
      <label style="justify-content:space-between" title="The grip the pace notes count on braking for a bend, on tarmac (the bots': 0.76 g)">pace notes: braking g <input type="number" id="aiGb" min="0.2" max="2" step="0.02"></label>
      <label style="justify-content:space-between" title="The pace note's speeds (the bots': 0.84 g of cornering grip on tarmac, 0.39 on sand) times this: a grippier car can take the line faster. Bends go with the square root of grip: ×1.15 for 1.1 g">pace note × <input type="number" id="aiPace" min="0.5" max="2" step="0.05"></label></div>
    <div class="card"><div class="h3">Tries, exams and when to stop</div>
      <label title="The whole car (its middle and half its width) stays within the road's edges (on sand and earth, the gate posts'): an exam that leaves the road ends there (no lap), and in the tries every metre any of the car is off it costs the off-road penalty"><input type="checkbox" id="aiOnRoad"> the car stays on the road (an exam that leaves it is no lap)</label>
      <label title="Tries away from the start line begin at 85% of the pace note's speed there, not from a standstill: more practice at speed"><input type="checkbox" id="aiRoll"> tries start rolling</label>
      <label title="Each generation's exam (the lap that picks the best) is a flying lap: two laps in a row from the start line, the second timed, as Drive it's laps after the first (and a driver's best lap) are: at speed across the line, on the ground the first lap wore, with its knocks. Not one lap from a standstill"><input type="checkbox" id="aiFly"> exams are flying laps</label>
      <label style="justify-content:space-between" title="Flying exams: so many timed laps in a row after the first, the slowest counting (and the knocks of each carried into the next): a network that is quick for a lap and then loses it scores its bad lap">flying laps an exam times <input type="number" id="aiExamLaps" min="1" max="5" step="1"></label>
      <label style="justify-content:space-between" title="A try ends (and loses the 100 m for ending badly) this far from the racing line. Wider gives it room for its own line, and to go astray">end a try this far from the line, m <input type="number" id="aiOff" min="3" max="30" step="1"></label>
      <label style="justify-content:space-between" title="Each try drives this long at most, from its place on the line. Longer tries carry the cost of a risk taken near their end (a fast bend just after the window): with 15 s, going fast and then off late paid as well as going carefully">tries last, s <input type="number" id="aiWindow" min="5" max="60" step="1"></label>
      <label style="justify-content:space-between" title="What a try that ends badly (off the course, stuck, wrecked) loses, on top of the metres it didn't drive. More: risk costs more">a try that ends badly costs, m <input type="number" id="aiCrash" min="0" max="2000" step="10"></label>
      <label style="justify-content:space-between" title="And so much more for each km/h it was going as it ended badly: going off at 140 km/h costs more than at 60, which tells it where it was too fast (0: the same whatever the speed)">… and per km/h it ended at, m <input type="number" id="aiCrashKmh" min="0" max="50" step="0.5"></label>
      <label style="justify-content:space-between" title="Once it laps: after so many exams in a row without a lap, training goes back to the best weights (as Back to the best). 1: only steps whose exam still laps are kept; 0: never">back to the best after exams without a lap <input type="number" id="aiLostAfter" min="0" max="1000" step="1"></label>
      <label style="justify-content:space-between" title="Each Train (or Train more) runs this many generations, then stops (0: until you pause it)">train this many generations at a time <input type="number" id="aiGens" min="0" max="10000" step="10"></label>
      <label style="justify-content:space-between" title="Once it laps: stop training when that many generations in a row bring no better lap (0: never stop). Counted afresh at each Train or Train more">stop after generations without a better lap <input type="number" id="aiStopAfter" min="0" max="1000" step="5"></label></div>
    <div class="card"><div class="h3">This computer: cores and drawing</div>
      <label style="justify-content:space-between" title="Train on more of this computer's cores at once: this tab drives some of each generation's tries (the ones you see), and copies of the sim in the background (Web Workers, one a core) drive the others and the exams, at full speed each. The same physics and the same world (checked as each starts), so the same training, only faster. Each copy takes some memory (about 70 MB). Watch at 1× watches this tab's tries; the others go on at full speed">cores to train on <select id="aiCores">${Array.from({ length: aiCoresMax() }, (_, k) => `<option value="${k + 1}">${k + 1}${k ? '' : ' (this tab only)'}${k + 1 === aiCoresMax() ? ' (all)' : ''}</option>`).join('')}</select></label>
      <label title="Unticked: while it trains, the 3D world isn't drawn (the picture stops; the panel goes on), and the training gets that time: more tries a second in this tab. Watch at 1× always draws it"><input type="checkbox" id="aiDraw"> draw the 3D world while it trains</label>
      <label title="The pedals and the foot on them (top right, while it drives or trains) in 3D, with a renderer of their own; unticked, a flat drawing"><input type="checkbox" id="aiPed3d"> pedals and foot in 3D</label></div>
    <small>Each set of inputs and outputs is a network, and a training, of its own (the others are kept). Penalties apply from the next try.</small>
  </details>
  <small class="aiHelp">Watch runs the training at real speed, or 2× or 4× (speed), with sound, to follow each try; Drive it and Race it go at that speed too. The diagram: what it sees (left) and does (right), live while it trains or drives; each line is an input's pull on
  an output, orange + (left, throttle), blue − (right, brake), thicker stronger; hover a dot for what it is. On the track, the points of the line it looks at.
  Learns on this course with this car, ${AI_CFG.pop} tries a generation, and remembers it in this browser. Charts: each generation's exam score
  (orange) and its tries' average (blue), dashed a lap; once it laps, its lap times (faster higher), dashed the best. Hover them for the values.
  ⤢ shows it all on the whole screen, with every setting explained. <b>I</b> hides this.</small>
  </div>`;
document.body.appendChild(AI.el);
AI.el.querySelector('#aiTrain').addEventListener('click', e => { e.currentTarget.blur(); aiTrain(!AI.training); });
AI.el.querySelector('#aiDrive').addEventListener('click', e => { e.currentTarget.blur(); aiDrive(!(AI.drive && !AI.race)); });
AI.el.querySelector('#aiRace').addEventListener('click', e => { e.currentTarget.blur(); aiDrive(!(AI.drive && AI.race), true); });
// inputs, outputs and penalties (typing in the panel isn't driving: its keys stop here)
AI.el.addEventListener('keydown', e => { if (e.target.matches('input')) e.stopPropagation(); });
AI.el.querySelector('#aiIns').innerHTML = AI_INPUTS.map(d => `<label class="io" title="${d.tip}"><input type="checkbox" data-in="${d.id}"> <span class="nm">${d.names.length > 2 ? `${d.id === 'rays' ? 'edge rays' : d.id} (${d.names.length})` : d.names.join(', ')}</span><span class="v" data-v="${d.id}"></span><span class="hint">${AI_ABOUT[d.id] || ''}</span></label>`).join('');
// the full-screen view shows what each setting does (its tip), under it
AI.el.querySelectorAll('#aiCfg label[title]').forEach(l => { if (!l.querySelector('.hint')) l.insertAdjacentHTML('beforeend', `<span class="hint">${l.title}</span>`); });
AI.el.querySelector('#aiLapsBox').addEventListener('toggle', e => { if (e.target.open) aiLapsShow(true); });
AI.el.querySelector('#aiGensQ').addEventListener('change', e => { const f = AI.el.querySelector('#aiGens'); f.value = e.target.value === '' ? 0 : e.target.value; f.dispatchEvent(new Event('change', { bubbles: true })); aiShow(); });
AI.el.querySelector('#aiSpeed').addEventListener('change', e => { const v = +e.target.value; if ([1, 2, 4].includes(v)) { AI_CFG.speed = v; aiKeepConfig(); } e.target.blur(); aiShow(); });
AI.el.querySelector('#aiStopQ').addEventListener('change', e => { const f = AI.el.querySelector('#aiStopAfter'); f.value = e.target.value === '' ? 0 : e.target.value; f.dispatchEvent(new Event('change', { bubbles: true })); aiShow(); });   // (#330)
AI.el.querySelector('#aiCoresQ').addEventListener('change', e => { const f = AI.el.querySelector('#aiCores'); f.value = e.target.value; f.dispatchEvent(new Event('change', { bubbles: true })); e.target.blur(); });   // (the same as This computer's)
AI.el.querySelector('#aiBig').addEventListener('click', e => { e.currentTarget.blur(); aiBig(); });
AI.el.querySelector('#aiClose').addEventListener('click', e => { e.currentTarget.blur(); if (AI.open) aiToggle(); });
AI.el.addEventListener('transitionend', e => { if (e.target === AI.el && e.propertyName === 'width') { aiShow(); aiVizT = 1; } });   // (⤢/⤡ widen it over a moment: the canvases drawn again at their new size)
addEventListener('keydown', e => { if (e.code === 'Escape' && AI.big) { e.stopImmediatePropagation(); e.preventDefault(); aiBig(false); } }, true);
addEventListener('resize', () => { if (AI.big) aiShow(); });
AI.ctlBig = AI.el.querySelector('#aiCtlBig'); AI.ctlBox = AI.el.querySelector('.aiCtlBox');
// hovering the diagram and the charts: the dot or generation under the pointer
{ const cv = AI.el.querySelector('#aiMap');
  cv.addEventListener('mousemove', e => { cv._hx = e.offsetX; cv._hy = e.offsetY; aiMapDraw(); });
  cv.addEventListener('mouseleave', () => { cv._hx = cv._hy = null; aiMapDraw(); }); }
for (const id of ['#aiNet', '#aiChart', '#aiChart2']) {
  const cv = AI.el.querySelector(id), chart = id !== '#aiNet';
  cv.addEventListener('mousemove', e => { cv._hx = e.offsetX; cv._hy = e.offsetY; if (chart) aiChartsDraw(); });
  cv.addEventListener('mouseleave', () => { cv._hx = cv._hy = null; if (chart) aiChartsDraw(); });
}
// the whole screen, or the column
function aiBig(on = !AI.big) {
  if (on && !AI.open) aiToggle();
  if (on === !!AI.big) return;
  AI.big = on; AI.el.classList.toggle('big', on);
  for (const id of ['#aiNet', '#aiChart', '#aiChart2', '#aiMap']) { const cv = AI.el.querySelector(id); cv._hx = cv._hy = null; }   // (the pointer was over the other layout)
  const d = AI.el.querySelector('#aiCfg');
  if (on) { AI.cfgWas = d.open; d.open = true; } else d.open = !!AI.cfgWas;
  const b = AI.el.querySelector('#aiBig'); b.textContent = on ? '⤡ Back to the drawer' : '⤢ Full screen'; b.title = on ? 'Back to the drawer on the left, the drive beside it (Esc)' : 'Full screen: the network, the charts and every setting, explained (Esc: back)';
  document.body.classList.toggle('ai-drawer', AI.open && !on);
  aiShow(); aiVizT = 1;
}
AI.el.querySelector('#aiCfg').addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.in || t.id === 'aiHb' || t.id === 'aiKp' || t.id === 'aiKs' || t.id === 'aiBrk') {
    const ins = [...AI.el.querySelectorAll('[data-in]')].filter(c => c.checked).map(c => c.dataset.in);
    if (!ins.length) { t.checked = true; return; }
    aiSetInputs(ins, AI.el.querySelector('#aiHb').checked, false, AI.el.querySelector('#aiKp').checked, AI.el.querySelector('#aiKs').checked, !AI.el.querySelector('#aiBrk').checked);
  } else if (t.id === 'aiRival') {
    AI_CFG.rival = AI_RV_MODES.includes(t.value) ? t.value : 'off'; aiKeepConfig();
    if (AI_CFG.rival !== 'off' && !aiRival()) flash(aiRivalWhyNot(), '#ffd88a', 3);
    else if (AI_CFG.rival !== 'off' && !AI.inputs.includes('rival')) flash('Tick the rival inputs too, so it can see it', '#9fd4ff', 2.5);
  } else if (t.id === 'aiRivalCar') {
    AI_CFG.rivalCar = ROAD_CARS[t.value] ? t.value : ''; aiKeepConfig(); if (AI.rv) AI.rv.ck = null;
    if (!aiRival()) flash(aiRivalWhyNot(), '#ffd88a', 3);
    else if (AI.rv.brain) flash(`The ${ROAD_CARS[AI.rv.key].name}: its own autopilot${AI.rv.brain.lap != null ? `, a lap in ${fmt(AI.rv.brain.lap)}` : ''}`, '#9fd4ff', 2.5);
  } else if (t.id === 'aiRivalShare') {
    const v = +t.value; if (Number.isFinite(v) && v >= 0 && v <= 1) { AI_CFG.rivalShare = v; aiKeepConfig(); }
  } else if (t.id === 'aiCores') {
    const v = Math.round(+t.value); if (v >= 1 && v <= aiCoresMax()) { AI_CFG.cores = v; aiKeepConfig(); if (v === 1) aiPoolStop(); if (AI.training) { aiTrain(false); aiTrain(true); } }
  } else if (t.id === 'aiDraw') {
    AI_CFG.draw = t.checked; aiKeepConfig();
  } else if (t.id === 'aiPed3d') {
    AI_CFG.ped3d = t.checked; aiKeepConfig();
    if (!t.checked && aiPed) { aiPed.r.dispose(); aiPed.r.forceContextLoss(); aiPed = null; }   // (its WebGL context let go)
  } else if (t.id === 'aiOnRoad') {
    AI_CFG.onRoad = t.checked; aiKeepConfig();
  } else if (t.id === 'aiHbTurn' || t.id === 'aiHbNoBrake') {
    AI_CFG[t.id === 'aiHbTurn' ? 'hbTurn' : 'hbNoBrake'] = t.checked; aiKeepConfig(); aiShow();
  } else if (t.id === 'aiHbLock') {
    const v = +t.value; if (Number.isFinite(v) && v >= 5 && v <= 100) { AI_CFG.hbLock = Math.round(v) / 100; aiKeepConfig(); }
  } else if (t.id === 'aiRoll') {
    AI_CFG.rolling = t.checked; aiKeepConfig();
  } else if (t.id === 'aiFly') {
    AI_CFG.flying = t.checked; aiKeepConfig();
  } else if (t.id === 'aiLT') {
    AI_CFG.lookTime = t.checked; aiKeepConfig();
  } else if (t.id === 'aiRL') {
    AI_CFG.racingLine = t.checked; aiKeepConfig();
  } else if (t.id === 'aiLW') {
    const v = +t.value; if (Number.isFinite(v) && v >= 0 && v <= 15) { AI_CFG.lineW = v; aiKeepConfig(); }
  } else if (t.id === 'aiGa') {
    const v = +t.value; if (Number.isFinite(v) && v >= 0 && v <= 2) { AI_CFG.gAccel = v; aiKeepConfig(); }
  } else if (t.id === 'aiGc' || t.id === 'aiGb') {
    const v = +t.value; if (Number.isFinite(v) && v >= 0.2 && v <= 2) { AI_CFG[t.id === 'aiGc' ? 'gCorner' : 'gBrake'] = v; aiKeepConfig(); }
  } else if (t.id === 'aiPace') {
    const v = +t.value; if (Number.isFinite(v) && v >= 0.5 && v <= 2) { AI_CFG.pace = v; aiKeepConfig(); }
  } else if (t.id === 'aiExamLaps') {
    const v = Math.round(+t.value); if (v >= 1 && v <= 5) { AI_CFG.examLaps = v; aiKeepConfig(); }
  } else if (t.id === 'aiOff') {
    const v = +t.value; if (Number.isFinite(v) && v >= 3 && v <= 30) { AI_CFG.off = v; aiKeepConfig(); }
  } else if (t.id === 'aiWindow' || t.id === 'aiCrash' || t.id === 'aiCrashKmh' || t.id === 'aiLostAfter') {   // (#348)
    const k = { aiWindow: 'window', aiCrash: 'crash', aiCrashKmh: 'crashKmh', aiLostAfter: 'lostAfter' }[t.id], v = +t.value;
    const [lo, hi] = { window: [5, 60], crash: [0, 2000], crashKmh: [0, 50], lostAfter: [0, 1000] }[k];
    if (Number.isFinite(v) && v >= lo && v <= hi) { AI_CFG[k] = k === 'lostAfter' ? Math.round(v) : v; aiKeepConfig(); }
  } else if (t.id === 'aiGens') {
    const v = Math.round(+t.value); if (Number.isFinite(v) && v >= 0) { AI.gens = v; aiKeepConfig(); if (AI.training) AI.genEnd = AI.gen + v; }
  } else if (t.id === 'aiStopAfter') {
    const v = Math.round(+t.value); if (Number.isFinite(v) && v >= 0) { AI.stopAfter = v; aiKeepConfig(); aiShow(); }
  } else if (t.id.startsWith('aiPen_')) {
    const v = +t.value; if (Number.isFinite(v) && v >= 0) { AI_PEN[t.id.slice(6)] = v; aiKeepConfig(); }
  }
  if (AI.training && AI.examKind !== aiExamKind()) { aiTrain(false); aiTrain(true); }   // (the best takes the new exam)
});
AI.el.querySelector('#aiWatch').addEventListener('click', e => {
  e.currentTarget.blur();
  AI.watch = !AI.watch; AI.wacc = 0;
  if (!AI.watch && AI.mute) { AI.mute.node.port.postMessage({ on: 0 }); audio = null; }   // full speed: silent again
  if (AI.watch && !AI.training) aiTrain(true);
  aiShow();
});
AI.el.querySelector('#aiHQ').addEventListener('change', e => { e.target.blur(); aiSetSize(+e.target.value); });
// ---- a network's configuration and history (#351)
const AI_CFG_LOCAL = ['cores', 'draw', 'ped3d', 'speed'];             // this machine's, not the network's
const AI_PAST_MAX = 16, AI_PAST_PTS = 300;                             // circuits kept before this one; their charts' points
// the settings it is trained with: the lab's, the car's setup, the lap it follows (whose: the recording stays here)
function aiNetConfig() {
  const cfg = {}; for (const k in AI_CFG) if (!AI_CFG_LOCAL.includes(k)) cfg[k] = AI_CFG[k];
  const D = aiDemoNow();
  return { cfg, pen: { ...AI_PEN }, gens: AI.gens, stopAfter: AI.stopAfter, exam: aiExamKind(),
    setup: { vehicle: VEH.key, awd: !!car.awd, split: car.split, p: car.pIdx, psi: PRESSURES[car.pIdx]?.psi ?? null },
    follow: D ? { who: String(D.who || ''), time: D.time ?? null, src: String(D.src || '') } : null };
}
// a network's settings put back in the lab (and its setup on the car, if it is this car); false: it has none (saved before #351)
function aiNetConfigApply(c) {
  if (!c || typeof c !== 'object' || !c.cfg || typeof c.cfg !== 'object') return false;
  aiConfigRead({ ...c.cfg, pen: c.pen, gens: c.gens, stopAfter: c.stopAfter, h: AI.h, inputs: AI.inputs, hb: AI.hb, kp: AI.kp, ks: AI.ks, nb: AI.nb });
  const S = c.setup;
  if (S && S.vehicle === VEH.key) {
    if (typeof S.awd === 'boolean') setDrive(S.awd);
    if (Number.isFinite(S.split)) setSplit(S.split);
    if (Number.isInteger(S.p)) setPressure(S.p);
  }
  aiKeepConfig();
  return true;
}
const aiTrackName = () => (typeof TRK !== 'undefined' && TRK.list?.find(t => t.key === courseKey())?.name) || null;
// a chart of at most AI_PAST_PTS points: every step-th generation's
function aiThin(h) {
  h = Array.isArray(h) ? h : [];
  const step = Math.max(1, Math.ceil(h.length / AI_PAST_PTS));
  return { step, h: step > 1 ? h.filter((_, i) => i % step === 0) : h.slice() };
}
// where a training (a file's, the server's) was made: one stint of a network's history
function aiStintOf(d) {
  return { course: String(d.course || ''), track: d.track ? String(d.track) : null, ground: String(d.ground || ''), vehicle: String(d.vehicle || ''), vehicleName: String(d.vehicleName || ''),
    from: Math.max(0, d.from | 0), to: Math.max(0, d.gen | 0), bestLap: Number.isFinite(d.bestLap) ? d.bestLap : null, bestFit: Number.isFinite(d.bestFit) ? d.bestFit : -1,
    config: d.config && typeof d.config === 'object' ? d.config : null, savedAt: d.savedAt ? String(d.savedAt) : null };
}
function aiPastRead(d) {
  const P = Array.isArray(d.past) ? d.past.filter(p => p && typeof p === 'object') : [];
  const H = Array.isArray(d.pastHist) ? d.pastHist : [];
  AI.past = P.slice(-AI_PAST_MAX);
  AI.pastHist = AI.past.map((_, i) => { const x = H[H.length - AI.past.length + i]; return x && Array.isArray(x.h) ? x : null; });   // (the last ones: the charts line up with the stints)
  AI.fromGen = Number.isInteger(d.from) && d.from >= 0 ? d.from : 0;
}
// under the chart: the circuits it was trained on before this one
function aiPastShow() {
  const el = AI.el?.querySelector('#aiPast'); if (!el) return;
  const P = AI.past || [];
  el.style.display = P.length ? '' : 'none';
  if (!P.length) { el.replaceChildren(); return; }
  const line = p => `${p.track || (p.course ? 'a course of its own' : 'another course')} (${String(p.ground || '').toLowerCase()}${p.vehicle !== VEH.key ? ', ' + (p.vehicleName || p.vehicle) : ''}): generations ${p.from}–${p.to}${p.bestLap != null ? ', best lap ' + fmt(p.bestLap) : ''}`;
  el.textContent = `Trained before on ${P.map(line).join(' · ')} · here from generation ${AI.fromGen}`;
}
// a training as a file or on the server: to keep, share, or carry to another browser (the browser keeps it anyway, per course, car and size)
function aiExport() {
  if (aiKey() !== AI.key) aiLoad();
  return { kind: 'carsim-autopilot', version: 2, vehicle: VEH.key, vehicleName: VEH.name, course: courseKey(), ground: groundName(), h: AI.h, inputs: AI.inputs, handbrake: AI.hb, keyPedals: AI.kp, keySteering: AI.ks, noBrake: AI.nb, weights: AI.np,
    w: [...AI.w], best: AI.best && [...AI.best], gen: AI.gen, bestFit: AI.bestFit, bestLap: AI.bestLap, hist: AI.hist, adam: { m: [...AI.m], v: [...AI.v], k: AI.k }, savedAt: new Date().toISOString(),
    track: aiTrackName(), config: aiNetConfig(), from: AI.fromGen, past: AI.past, pastHist: AI.pastHist };   // (#351)
}
// a training (a file's, the server's) in place of this course and car's with its inputs; false if it isn't one
function aiImport(d, what = 'Training') {
  const arr = (a, n) => Array.isArray(a) && a.length === n && a.every(Number.isFinite);
  const ins = Array.isArray(d?.inputs) && d.inputs.every(id => AI_INPUTS.some(q => q.id === id)) ? d.inputs : AI_DEFAULT_INPUTS, np = d && aiShape(ins, !!d.handbrake, d.h).np;
  if (!d || d.kind !== 'carsim-autopilot' || !AI_SIZES.includes(d.h) || !arr(d.w, np) || (d.best != null && !arr(d.best, np))) { flash('Not an autopilot training', '#ff8a7a', 2.5); return false; }
  const other = [d.vehicle !== VEH.key && `the ${d.vehicleName || d.vehicle}`, d.course !== courseKey() && 'another course or ground'].filter(Boolean);
  if (other.length && !confirm(`This training was made with ${other.join(' and ')}. Load it for the ${VEH.name} here anyway? (It may drive worse, and Train more carries on from it.)`)) return false;
  if (AI.training) aiTrain(false);
  const withCfg = aiNetConfigApply(d.config);                         // (#351: its settings, as it was trained)
  AI.drive = false; AI.h = d.h; aiSetInputs(ins, !!d.handbrake, true, !!d.keyPedals, !!d.keySteering, !!d.noBrake); aiLoad();   // this course, car, size and inputs: replaced by it
  const n = AI.np, ad = d.adam && arr(d.adam.m, n) && arr(d.adam.v, n) ? d.adam : null;
  // made elsewhere: its record doesn't count here (Drive it uses its weights; the next exam sets the score)
  Object.assign(AI, { w: Float32Array.from(d.w), best: Float32Array.from(d.best || d.w), gen: d.gen | 0, bestFit: other.length ? 0 : Number.isFinite(d.bestFit) ? d.bestFit : 0,
    bestLap: other.length ? null : d.bestLap ?? null, hist: other.length ? [] : Array.isArray(d.hist) ? d.hist : [], sinceBest: 0,
    m: ad ? Float32Array.from(ad.m) : new Float32Array(n), v: ad ? Float32Array.from(ad.v) : new Float32Array(n), k: ad ? ad.k | 0 : 0 });
  // its history (#351): the circuits it was trained on before; made elsewhere, where it was made is one more, and this
  // circuit's chart starts at its generation
  aiPastRead(d);
  if (other.length) {
    AI.past.push(aiStintOf(d)); AI.pastHist.push(aiThin(d.hist)); AI.fromGen = Math.max(0, d.gen | 0);
    AI.past = AI.past.slice(-AI_PAST_MAX); AI.pastHist = AI.pastHist.slice(-AI_PAST_MAX);
  }
  AI.ident = typeof d.id === 'string' && d.name ? { id: d.id, name: String(d.name), creator: String(d.ownerName || 'Driver'), sig: aiNetSig(AI.best || AI.w) } : null;
  aiSave(); aiShow();
  flash(`${what} loaded: ${AI.np} weights, generation ${AI.gen}${withCfg ? ', with its settings' : ''}${AI.past.length ? `, trained on ${AI.past.length + 1} circuits` : ''}`, '#9fd4ff', 2.5);
  return true;
}
AI.el.querySelector('#aiSaveF').addEventListener('click', e => {
  e.currentTarget.blur();
  const d = aiExport(), a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(d)], { type: 'application/json' }));
  a.download = `autopilot-${VEH.key}-${AI.np}w-gen${AI.gen}.json`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  flash(`Training saved: ${a.download}`, '#9fd4ff', 2);
});
AI.el.querySelector('#aiLoadF').addEventListener('click', e => { e.currentTarget.blur(); AI.el.querySelector('#aiFile').click(); });
AI.el.querySelector('#aiFile').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  let d; try { d = JSON.parse(await f.text()); } catch (err) { d = null; }
  aiImport(d);
});
// on the server (the app's /api/autopilots, lib/autopilots/store.mjs): everyone's, to load; ours, to delete. Signed in to the app.
const AI_API = location.pathname.replace(/\/sim\/[^/]*$/, '') + '/api/autopilots';
async function aiApi(path, init) {
  const r = await fetch(AI_API + path, { credentials: 'same-origin', ...init, headers: init?.body ? { 'content-type': 'application/json' } : undefined });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(r.status === 401 ? 'Sign in to the app (its lobby) to use the server' : b.error || `${r.status} ${r.statusText}`);
  return b;
}
AI.el.querySelector('#aiSaveS').addEventListener('click', async e => {
  e.currentTarget.blur();
  const d = aiExport();
  const name = prompt('Save this autopilot on the server as:', `${VEH.short} · ${AI.np} weights · gen ${AI.gen}${AI.bestLap != null ? ' · lap ' + fmt(AI.bestLap) : ''}`);
  if (!name || !name.trim()) return;
  try { await aiSaveServer(name, d); } catch (err) { flash(err.message, '#ff8a7a', 3); }
});
// this training saved on the server under a name (the button asks for it; __sim.aiSaveServer, the Claude bridge's way)
async function aiSaveServer(name, d = aiExport()) {
  name = String(name || '').trim();
  if (!name) throw new Error('Give it a name');
  let t = { ...d, hist: (d.hist || []).slice(-2000) };
  if (JSON.stringify(t).length > 500000) t = { ...t, hist: t.hist.slice(-300), pastHist: (t.pastHist || []).map(x => { const k = x ? Math.ceil(x.h.length / 60) : 1; return k > 1 ? { step: x.step * k, h: x.h.filter((_, i) => i % k === 0) } : x; }) };
  const r = await aiApi('', { method: 'POST', body: JSON.stringify({ name, training: t }) });
  const a = r?.autopilot, sw = d.best || d.w;
  if (a?.id && sw && AI.np === sw.length && aiNetSig(AI.best || AI.w) === aiNetSig(sw)) { AI.ident = { id: a.id, name: a.name || name, creator: a.ownerName || 'Driver', sig: aiNetSig(sw) }; aiSave(); }
  flash(`Saved on the server: ${name}`, '#9fd4ff', 2); if (AI.listOpen) aiServerList();
  return r;
}
AI.el.querySelector('#aiLoadS').addEventListener('click', e => {
  e.currentTarget.blur();
  AI.listOpen = !AI.listOpen;
  AI.el.querySelector('#aiServer').style.display = AI.listOpen ? 'block' : 'none';
  if (AI.listOpen) aiServerList();
});
// the list: this car and course's first, then the newest; names as text (they are other people's)
async function aiServerList() {
  const box = AI.el.querySelector('#aiServer'), el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  box.replaceChildren(el('div', 'sub', 'Loading…'));
  let list;
  try { list = (await aiApi('')).autopilots; } catch (err) { box.replaceChildren(el('div', 'sub', err.message)); return; }
  const here = a => a.vehicle === VEH.key && a.course === courseKey();
  list.sort((a, b) => here(b) - here(a) || b.savedAt - a.savedAt);
  if (!list.length) { box.replaceChildren(el('div', 'sub', 'Nothing saved on the server yet.')); return; }
  box.replaceChildren(...list.slice(0, 40).map(a => {
    const row = el('div', 'srv'), info = el('div', 'si');
    info.append(el('b', null, a.name), el('div', 'sub', `${a.mine ? 'yours' : 'by ' + a.ownerName} · ${a.vehicleName || a.vehicle} · ${a.ground}${here(a) ? ' · this car and course' : ''} · ${a.bestLap != null ? 'lap ' + fmt(a.bestLap) : 'no lap yet'} · gen ${a.gen} · ${a.weights} weights${a.past?.length ? ` · trained on ${a.past.length + 1} circuits` : ''}`));
    const load = el('button', null, 'Load');
    load.addEventListener('click', async ev => {
      ev.currentTarget.blur();
      try { aiImport((await aiApi('/' + a.id)).autopilot, `“${a.name}”`); } catch (err) { flash(err.message, '#ff8a7a', 3); }
    });
    row.append(info, load);
    if (a.mine) {
      const del = el('button', null, '✕'); del.title = 'Delete it from the server';
      del.addEventListener('click', async ev => {
        ev.currentTarget.blur();
        if (!confirm(`Delete “${a.name}” from the server?`)) return;
        try { await aiApi('/' + a.id, { method: 'DELETE' }); aiServerList(); } catch (err) { flash(err.message, '#ff8a7a', 3); }
      });
      row.append(del);
    }
    return row;
  }));
}
AI.el.querySelector('#aiBack').addEventListener('click', e => { e.currentTarget.blur(); aiBackToBest(); });
AI.el.querySelector('#aiReset').addEventListener('click', e => {
  e.currentTarget.blur();
  if (!confirm(`Forget what the autopilot learnt with the ${VEH.name} on this course?`)) return;
  const was = AI.training; aiForget(); if (was) aiTrain(true);
});
// Start over without asking (__sim.aiForget, the Claude bridge's way): this course, car and inputs' training forgotten
function aiForget() {
  if (AI.training) aiTrain(false);
  AI.drive = false; try { localStorage.removeItem(aiKey()); } catch (err) { } aiLoad(); aiShow();
  return { key: AI.key, gen: AI.gen };
}
// the button, in the column on the right; in a race room left of Replay (that column is the room's), gone in a race
document.head.insertAdjacentHTML('beforeend', `<style>
  #aiBtn{position:fixed;top:452px;right:12px;font:inherit;font-size:13px;font-weight:700;border:0;border-radius:8px;padding:8px 12px;cursor:pointer;color:#fff;background:rgba(20,14,6,.65)}
  #aiBtn:hover,#aiBtn.on{background:rgba(255,90,0,.85)}
  body.mp-race #aiBtn{display:none!important}
</style>`);
AI.btn = document.createElement('button'); AI.btn.id = 'aiBtn'; AI.btn.textContent = '🧠 TNN lab';
AI.btn.title = 'A tiny neural network learns to drive a lap of this course, with this car (I)';
document.body.appendChild(AI.btn);
AI.btn.addEventListener('click', e => { e.currentTarget.blur(); aiToggle(); });
setInterval(() => {
  if (!MP.on) return;
  const r = document.getElementById('replayBtn').getBoundingClientRect();
  if (r.width) { AI.btn.style.top = r.top + 'px'; AI.btn.style.right = (innerWidth - r.left + 8) + 'px'; }
}, 250);
function aiToggle() {
  if (AI.open && AI.big) aiBig(false);
  AI.open = !AI.open;
  if (AI.open && aiKey() !== AI.key && !AI.training) aiLoad();
  AI.el.style.display = AI.open ? 'block' : 'none'; AI.btn.classList.toggle('on', AI.open);
  document.body.classList.toggle('ai-drawer', AI.open && !AI.big);
  aiShow();
}
function aiShow() {
  if (!AI.open) return;
  aiPastShow();
  if (AI.el.style.top) AI.el.style.top = AI.el.style.maxHeight = '';     // (the drawer: the window's height, its CSS)
  const len = botPath().len, pct = f => Math.min(100, Math.round(f / len * 100));
  const best = AI.bestFit < 0 ? 'nothing yet' : AI.bestLap != null ? `a full lap in ${fmt(AI.bestLap)}${AI.sinceBest ? ` <span style="opacity:.7">(${AI.sinceBest} generation${AI.sinceBest > 1 ? 's' : ''} ago${AI.stopAfter && AI.training ? `; stops after ${AI.stopAfter - AI.dry} more without one` : ''})</span>` : ''}` : `${Math.round(AI.bestFit)} m of ${Math.round(len)} m (${pct(AI.bestFit)} %)`;
  AI.el.querySelector('#aiSize').textContent = `${AI.h ? 'a tiny neural network' : 'the smallest network'}: ${AI.nIn} inputs ${AI.h ? `→ ${AI.h} hidden →` : 'straight to'} ${AI.nOut} outputs, ${AI.np} weights${AI.kp || AI.ks ? ` · ${[AI.kp && 'pedals', AI.ks && 'steering'].filter(Boolean).join(' and ')} like the keyboard` : ''}${AI.nb ? ' · no brake' : ''}`;
  AI.el.querySelector('#aiHQ').value = AI.h;
  AI.el.querySelectorAll('[data-in]').forEach(c => { c.checked = AI.inputs.includes(c.dataset.in); });
  AI.el.querySelector('#aiHb').checked = AI.hb; AI.el.querySelector('#aiKp').checked = AI.kp; AI.el.querySelector('#aiKs').checked = AI.ks; AI.el.querySelector('#aiBrk').checked = !AI.nb;
  for (const k in AI_PEN) { const f = AI.el.querySelector('#aiPen_' + k); if (document.activeElement !== f) f.value = AI_PEN[k]; }
  { const f = AI.el.querySelector('#aiStopAfter'); if (document.activeElement !== f) f.value = AI.stopAfter; }
  { const f = AI.el.querySelector('#aiGens'); if (document.activeElement !== f) f.value = AI.gens; }
  { const f = AI.el.querySelector('#aiGensQ'); if (document.activeElement !== f) f.value = AI.gens || ''; }
  { const f = AI.el.querySelector('#aiStopQ'); if (document.activeElement !== f) f.value = AI.stopAfter || ''; }
  { const f = AI.el.querySelector('#aiOff'); if (document.activeElement !== f) f.value = AI_CFG.off; }
  for (const [id, k] of [['aiWindow', 'window'], ['aiCrash', 'crash'], ['aiCrashKmh', 'crashKmh'], ['aiLostAfter', 'lostAfter']]) { const f = AI.el.querySelector('#' + id); if (document.activeElement !== f) f.value = AI_CFG[k]; }
  { const f = AI.el.querySelector('#aiExamLaps'); if (document.activeElement !== f) f.value = AI_CFG.examLaps; }
  { const f = AI.el.querySelector('#aiPace'); if (document.activeElement !== f) f.value = AI_CFG.pace; }
  { const f = AI.el.querySelector('#aiRivalShare'); if (document.activeElement !== f) f.value = AI_CFG.rivalShare; }
  AI.el.querySelector('#aiRival').value = AI_CFG.rival; AI.el.querySelector('#aiRivalCar').value = AI_CFG.rivalCar;
  AI.el.querySelector('#aiCores').value = AI.el.querySelector('#aiCoresQ').value = Math.min(AI_CFG.cores, aiCoresMax()); AI.el.querySelector('#aiDraw').checked = AI_CFG.draw; AI.el.querySelector('#aiPed3d').checked = AI_CFG.ped3d;
  AI.el.querySelector('#aiOnRoad').checked = AI_CFG.onRoad;
  AI.el.querySelector('#aiHbTurn').checked = AI_CFG.hbTurn; AI.el.querySelector('#aiHbNoBrake').checked = AI_CFG.hbNoBrake;
  for (const id of ['#aiHbTurn', '#aiHbNoBrake', '#aiHbLock']) AI.el.querySelector(id).disabled = !AI.hb;   // (no handbrake output: nothing to rule)
  { const f = AI.el.querySelector('#aiHbLock'); if (document.activeElement !== f) f.value = Math.round(AI_CFG.hbLock * 100); }
  aiFollowShow();
  AI.el.querySelector('#aiRL').checked = AI_CFG.racingLine; AI.el.querySelector('#aiLT').checked = AI_CFG.lookTime; AI.el.querySelector('#aiRoll').checked = AI_CFG.rolling; AI.el.querySelector('#aiFly').checked = AI_CFG.flying;
  for (const [id, k] of [['#aiGc', 'gCorner'], ['#aiGb', 'gBrake'], ['#aiGa', 'gAccel'], ['#aiLW', 'lineW']]) { const f = AI.el.querySelector(id); if (document.activeElement !== f) f.value = AI_CFG[k]; }
  const L = AI.lastExam;
  // the three numbers: the generation, the best so far, the last exam
  const sec = t => t < 60 ? `${t.toFixed(2)}<span class="u">s</span>` : fmt(t).slice(0, -1);
  const kpi = (k, v, sub, tip) => `<div title="${tip}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${sub || '&nbsp;'}</div></div>`;
  AI.el.querySelector('#aiKpi').innerHTML =
    kpi('Generation', AI.gen, AI.training ? (AI.gens ? `training, to ${AI.genEnd}` : 'training') : AI.stopWhy ? 'stopped' : AI.gen ? 'paused' : 'not trained', `${AI_CFG.pop} tries a generation, then an exam: a lap from the start`)
    + kpi('Best', AI.bestFit < 0 ? '—' : AI.bestLap != null ? sec(AI.bestLap) : `${pct(AI.bestFit)}<span class="u">%</span>`, AI.bestFit < 0 ? 'nothing yet' : AI.bestLap != null ? 'a full lap' : `${Math.round(AI.bestFit)} of ${Math.round(len)} m`, 'The best exam so far: its lap time, or how far round it got')
    + kpi('Last exam', !L ? '—' : L.why === 'lap' && L.lap != null ? sec(L.lap) : `${L.at}<span class="u">m</span>`, AI.bestLap != null && AI.sinceBest ? `${AI.sinceBest} since the best` : L ? (L.why === 'lap' ? 'a lap' : 'stopped there') : '', 'The latest generation\'s exam, and how long since the best got better');
  AI.el.querySelector('#aiStat').innerHTML = `<div class="ln">${AI.training ? `<b>${AI.exam ? `Exam: a ${AI_CFG.flying ? 'flying ' : ''}lap from the start` : AI.par ? `Tries ${AI_POOL.gen ? AI_CFG.pop - AI_POOL.gen.left : 0} of ${AI_CFG.pop}${AI.from != null ? ` from ${Math.round(AI.from)} m` : ''} · ${aiPoolOk() + 1} of ${Math.min(AI_CFG.cores, aiCoresMax())} cores${AI_POOL.exams.size ? ` · ${AI_POOL.exams.size} exam${AI_POOL.exams.size > 1 ? 's' : ''} under way` : ''}${AI_POOL.err ? ` · a core was dropped: ${AI_POOL.err}` : ''}` : `Try ${AI.ci + 1} of ${AI_CFG.pop}${AI.cands && AI.from != null ? ` from ${Math.round(AI.from)} m` : ''}${AI.cands && AI.scen ? ` · rival ${AI_RV_KINDS[AI.scen.kind]}` : ''}`}${AI.examSolo ? ' · the race with the rival' : ''}</b>` : AI.drive ? `<b>${AI.race ? 'Racing' : 'Driving'} its best</b>` : AI.stopWhy ? aiStopLine() : best === 'nothing yet' ? 'Train it: it starts knowing nothing' : AI.big ? `Best: ${AI.bestLap != null ? fmt(AI.bestLap) : best}${AI.sinceBest ? ` <span style="opacity:.7">(${AI.sinceBest} generation${AI.sinceBest > 1 ? 's' : ''} ago${AI.stopAfter ? `; training stops at ${AI.stopAfter}` : ''})</span>` : ''}` : `Best: ${best}`}</div>${L ? `<div class="ln dim">Last exam: ${L.why === 'lap' ? 'a lap' : L.at + ' m'}${L.offM ? ` · ${L.offM} m off the road` : ''}${L.dmg ? ` · damage ${L.dmg} %` : ''}${L.wrecked ? ' · wrecked' : ''}${L.kmh ? ` · ${L.kmh} km/h` : ''}${L.swing ? ` · ${L.swing} swings` : ''}${L.hb ? ` · handbrake ${L.hb} s` : ''}${L.hbHeld ? ` · handbrake held back ${L.hbHeld} s` : ''}${L.extra ? ` · ${L.extra} m extra path` : ''}${L.pen ? ` · ${L.pen > 0 ? '−' + L.pen : '+' + -L.pen}` : ''}</div>${AI.lastExamRace ? `<div class="ln dim">${aiRaceLine(AI.lastExamRace).slice(4)}</div>` : ''}` : ''}`;
  AI.el.querySelectorAll('#aiStat .ln').forEach(n => { n.title = n.textContent; });   // (each a line, cut short: all of it on hover)
  AI.el.querySelector('#aiTrain').textContent = AI.training ? 'Pause' : AI.gen ? 'Train more' : 'Train';
  AI.el.querySelector('#aiTrain').classList.toggle('on', AI.training);
  AI.el.querySelector('#aiDrive').textContent = AI.drive && !AI.race ? 'Stop driving' : 'Drive it';
  AI.el.querySelector('#aiRace').textContent = AI.drive && AI.race ? 'Stop the race' : 'Race it';
  AI.el.querySelector('#aiRace').classList.toggle('on', !!(AI.drive && AI.race));
  AI.el.querySelector('#aiRace').disabled = AI.bestFit < 0;
  AI.el.querySelector('#aiWatch').textContent = AI.watch ? 'Full speed' : `Watch at ${AI_CFG.speed}×`; AI.el.querySelector('#aiSpeed').value = AI_CFG.speed;
  AI.el.querySelector('#aiWatch').classList.toggle('on', !!AI.watch);
  AI.el.querySelector('#aiDrive').classList.toggle('on', AI.drive && !AI.race);
  AI.el.querySelector('#aiDrive').disabled = AI.bestFit < 0;
  AI.el.querySelector('#aiBack').disabled = !AI.best;
  AI.el.querySelector('#aiSaveF').disabled = AI.el.querySelector('#aiSaveS').disabled = !AI.gen;
  aiChartsDraw(); aiMapShow();
  { const lb = AI.el.querySelector('#aiLapsBox'); lb.style.display = AI.training ? 'none' : ''; if (!AI.training && lb.open) aiLapsShow(); }   // (not while it trains)
}
// the charts, over the generations: a line each, the value under the pointer
const AI_C1 = '#d9621a', AI_C2 = '#3d97ee';                           // (both read on the dark panel, and apart for colour-blind eyes)
function aiPlot(cv, o) {
  const c = aiCanvas(cv); if (!c) return;
  const { g, W, H } = c, big = AI.big, fs = big ? 12 : 9.5, f = wt => `${wt} ${fs}px system-ui, sans-serif`;
  const n = o.xs.length, L = big ? 52 : 34, R = big ? 10 : 4, T = big ? 26 : 15, Bm = big ? 22 : 13, pw = W - L - R, ph = H - T - Bm;
  g.textBaseline = 'middle'; g.textAlign = 'left'; g.font = f(600); g.fillStyle = 'rgba(255,255,255,.88)'; g.fillText(o.title, 0, T / 2 - 2);
  // the legend, right of the title when there is room
  { g.font = f(400); let lx = W - R; const tw = g.measureText(o.title).width + 16, items = [...o.series].reverse(), need = items.reduce((a, s) => a + g.measureText(s.name).width + 22, 0);
    if (o.series.length > 1 && lx - need > tw) for (const s of items) {
      g.textAlign = 'right'; g.fillStyle = 'rgba(255,255,255,.7)'; g.fillText(s.name, lx, T / 2 - 2); lx -= g.measureText(s.name).width + 5;
      g.strokeStyle = s.col; g.lineWidth = 2.5; g.setLineDash(s.dash || []); g.beginPath(); g.moveTo(lx - 12, T / 2 - 2); g.lineTo(lx, T / 2 - 2); g.stroke(); g.setLineDash([]); lx -= 22;
    } }
  const all = o.series.flatMap(s => s.vals).filter(v => v != null && Number.isFinite(v));
  if (!n || !all.length) { g.textAlign = 'center'; g.font = f(400); g.fillStyle = 'rgba(255,255,255,.5)'; g.fillText(o.empty, W / 2, T + ph / 2); return; }
  // the scale: round steps, a little room above and below
  const refs = [o.ref, ...(o.refs || [])].filter(Boolean);
  let lo = Math.min(...all, ...refs.map(r => r.v)), hi = Math.max(...all, ...refs.map(r => r.v));
  if (hi - lo < o.minSpan) { const m = (hi + lo) / 2; lo = m - o.minSpan / 2; hi = m + o.minSpan / 2; }
  const raw = (hi - lo) / (big ? 4 : 2), p10 = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map(m => m * p10).find(m => m >= raw);
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const y = v => T + (o.invert ? v - lo : hi - v) / (hi - lo) * ph, xs = i => L + (n > 1 ? i / (n - 1) * pw : pw / 2);
  g.font = f(400); g.lineWidth = 1;
  for (let v = lo; v <= hi + step / 2; v += step) {
    g.strokeStyle = 'rgba(255,255,255,.08)'; g.beginPath(); g.moveTo(L, Math.round(y(v)) + 0.5); g.lineTo(W - R, Math.round(y(v)) + 0.5); g.stroke();
    g.textAlign = 'right'; g.fillStyle = 'rgba(255,255,255,.5)'; g.fillText(o.tick(v), L - 6, y(v));
  }
  // the generations along the bottom
  g.textBaseline = 'top'; g.fillStyle = 'rgba(255,255,255,.5)';
  const gx = [0, n - 1]; if (big && n > 8) gx.splice(1, 0, Math.round((n - 1) / 3), Math.round((n - 1) * 2 / 3));
  [...new Set(gx)].forEach((i, k, a) => { g.textAlign = n === 1 ? 'center' : k === 0 ? 'left' : k === a.length - 1 ? 'right' : 'center'; g.fillText((big && k === 0 ? 'gen. ' : '') + o.xs[i], xs(i), H - Bm + 4); });
  g.textBaseline = 'middle';
  const labs = [];
  for (const r of refs) {                                              // the dashed lines: a lap, the best, a driver's and a network's best
    g.strokeStyle = r.col || 'rgba(255,255,255,.4)'; g.lineWidth = r.col ? 1.5 : 1; g.setLineDash([5, 5]); g.beginPath(); g.moveTo(L, y(r.v)); g.lineTo(W - R, y(r.v)); g.stroke(); g.setLineDash([]); g.lineWidth = 1;
    // its label: over the line (under it at the top), at the end asked for; (#352) not over another label: the line's other side,
    // then the other end, then beside the other on its row, then its short form (the time) so; cut to the chart's width
    const yl = y(r.v), dy = yl - T < fs + 2 ? fs * 0.8 : -fs * 0.8;
    const fit = s => { if (g.measureText(s).width > pw - 8) { while (s.length > 4 && g.measureText(s + '…').width > pw - 8) s = s.slice(0, -1); s += '…'; } return s; };
    const free = b => b.x0 >= L - 2 && b.ly > T - fs * 0.4 && b.ly < T + ph + fs * 0.4 && !labs.some(q => q.x0 < b.x1 + 6 && b.x0 < q.x1 + 6 && Math.abs(q.ly - b.ly) < fs + 1);
    const spots = s => { const lw = g.measureText(s).width, at = (rt, ly, xe) => { const x1 = xe ?? (rt ? W - R - 4 : L + 4 + lw); return { s, x0: x1 - lw, x1, ly }; };
      return [at(!!r.right, yl + dy), at(!!r.right, yl - dy), at(!r.right, yl + dy), at(!r.right, yl - dy), ...labs.filter(q => Math.abs(q.ly - yl - dy) < fs + 1).map(q => at(true, yl + dy, q.x0 - 10))]; };
    const all = [...spots(fit(r.label)), ...(r.short ? spots(r.short) : [])], lp = all.find(free) || all[0]; labs.push(lp);
    g.textAlign = 'left'; g.fillStyle = r.col || 'rgba(255,255,255,.6)';
    g.fillText(lp.s, lp.x0, lp.ly);
  }
  for (const s of o.series) {
    g.strokeStyle = s.col; g.fillStyle = s.col; g.lineWidth = big ? 2 : 1.5; g.setLineDash(s.dash || []); g.beginPath(); let on = false, py = 0;
    s.vals.forEach((v, i) => {
      if (v == null) { on = false; return; }
      if (!on) g.moveTo(xs(i), y(v)); else if (s.step) { g.lineTo(xs(i), py); g.lineTo(xs(i), y(v)); } else g.lineTo(xs(i), y(v));
      on = true; py = y(v);
    });
    g.stroke(); g.setLineDash([]);
    if (s.dots && n <= (big ? 90 : 40)) s.vals.forEach((v, i) => { if (v != null) { g.beginPath(); g.arc(xs(i), y(v), big ? 2.5 : 1.8, 0, 7); g.fill(); } });
  }
  // the generation under the pointer: a crosshair, its values
  if (cv._hx == null || cv._hx < L - 4 || cv._hx > W - R + 4) return;
  const i = n > 1 ? clamp(Math.round((cv._hx - L) / pw * (n - 1)), 0, n - 1) : 0, x = xs(i);
  g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(Math.round(x) + 0.5, T); g.lineTo(Math.round(x) + 0.5, T + ph); g.stroke();
  for (const s of o.series) { const v = s.vals[i]; if (v == null) continue; g.fillStyle = s.col; g.strokeStyle = 'rgba(14,11,8,1)'; g.lineWidth = 2; g.beginPath(); g.arc(x, y(v), big ? 4.5 : 3.5, 0, 7); g.fill(); g.stroke(); }
  const tb = f(600), tn = f(400);
  aiTipBox(g, x, cv._hy ?? T, W, H, [[`Generation ${o.xs[i]}`, tb], ...o.series.map(s => [`${s.name}: ${s.vals[i] == null ? '—' : o.fmt(s.vals[i])}`, tn]), ...(o.more ? [[o.more(i), tn]] : [])].filter(r => r[0]), fs);
}
// the best lap with this car on this course and ground (a race room's records) by a driver, and the best by a network: a
// network's laps are best laps too (with net), so the room's first may be a network's (#352); null outside a room, or none yet
function aiRoomBest(byNet) {
  let b = null;
  for (const e of MP.on && Array.isArray(MP.carRecs) ? MP.carRecs : []) if (!!e.net === byNet && Number.isFinite(e.time) && (!b || e.time < b.time)) b = e;
  return b;
}
function aiHumanBest() { const e = aiRoomBest(false); return e ? { t: e.time, name: e.name || 'a driver' } : null; }
function aiNetBest() { const e = aiRoomBest(true); return e ? { t: e.time, name: e.net.name || e.name || 'a network', creator: e.net.creator || '' } : null; }
// ---------- Drive it on the map: the pedals and the handbrake where it used them ----------
// at each point of the course's line, the latest pass's place, pedals and speed (a decision at a time: ~1 m apart at
// 200 km/h, as the line's points): AI.map, from Drive it's start until the next
function aiMapRec() {
  const Pt = botPath(), i = AI.dst.i, c = AI.dCtl; if (i < 0 || !c) return;
  let M = AI.map;
  if (!M || M.Pt !== Pt) M = AI.map = { Pt, n: Pt.n, x: new Float32Array(Pt.n), z: new Float32Array(Pt.n), gas: new Float32Array(Pt.n), brk: new Float32Array(Pt.n),
    hb: new Uint8Array(Pt.n), kmh: new Float32Array(Pt.n), set: new Uint8Array(Pt.n), cnt: 0 };
  if (!M.set[i]) { M.set[i] = 1; M.cnt++; }
  M.x[i] = car.pos.x; M.z[i] = car.pos.z; M.gas[i] = c.throttle; M.brk[i] = c.brake; M.hb[i] = c.handbrake ? 1 : 0; M.kmh[i] = car.vel.length() * 3.6;
}
// pedal colours: the panel's (orange: gas, blue: brake, as on the network's lines) from a neutral grey (coasting); 5 steps a side
const AI_MAP_GREY = [128, 126, 120], AI_MAP_GAS = [217, 98, 26], AI_MAP_BRK = [61, 151, 238];
const aiMapCol = q => { const t = Math.abs(q) / 5, e = q > 0 ? AI_MAP_GAS : AI_MAP_BRK; return `rgb(${AI_MAP_GREY.map((g, k) => Math.round(g + (e[k] - g) * t)).join(',')})`; };
const aiMapStep = (gas, brk) => Math.round(clamp(gas - brk, -1, 1) * 5);
// shown while it drives, and after (until a training or the next drive); in full screen, a column of its own
function aiMapShow() {
  const on = !!AI.map?.cnt && !AI.training, box = AI.el.querySelector('.aiMapBox');
  box.classList.toggle('on', on); AI.el.querySelector('.aiMid').classList.toggle('map', on);
  if (on) aiMapDraw();
  aiMapCmpShow(on);
}
function aiMapDraw() {
  const M = AI.map, cv = AI.el.querySelector('#aiMap'); if (!M?.cnt || !AI.open) return;
  const P = M.Pt.P, n = M.n, big = AI.big, half = aiHalfW();
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;      // the course's extent, and wherever the car went off it
  for (const q of P) { x0 = Math.min(x0, q.x - half); x1 = Math.max(x1, q.x + half); z0 = Math.min(z0, q.z - half); z1 = Math.max(z1, q.z + half); }
  for (let i = 0; i < n; i++) if (M.set[i]) { x0 = Math.min(x0, M.x[i] - 2); x1 = Math.max(x1, M.x[i] + 2); z0 = Math.min(z0, M.z[i] - 2); z1 = Math.max(z1, M.z[i] + 2); }
  const B = { x0, x1, z0, z1 }, ar = clamp((B.x1 - B.x0) / Math.max(B.z1 - B.z0, 1), 0.8, 1.8);
  if (!big && cv.style.aspectRatio !== String(+ar.toFixed(2))) cv.style.aspectRatio = String(+ar.toFixed(2));
  else if (big && cv.style.aspectRatio) cv.style.aspectRatio = '';
  const c = aiCanvas(cv); if (!c) return;
  const { g, W, H } = c, fs = big ? 12 : 9.5, f = wt => `${wt} ${fs}px system-ui, sans-serif`, T = big ? 26 : 16, pad = big ? 14 : 8;
  // the title, and under it the legend (in rows, as wide as there is room)
  g.textBaseline = 'middle'; g.textAlign = 'left'; g.font = f(600); g.fillStyle = 'rgba(255,255,255,.88)';
  let title = big ? 'Pedals around the course (its latest pass)' : 'pedals around the course';
  for (const t of big ? ['Pedals around the course', 'Pedals'] : ['pedals']) if (g.measureText(title).width > W) title = t;
  g.fillText(title, 0, T / 2 - 2);
  g.font = f(400); let lx = 0, ly = T + fs * 0.4;
  for (const [t, col] of [['gas', aiMapCol(5)], ['coasting', aiMapCol(0)], ['brake', aiMapCol(-5)], ['handbrake', null]]) {
    const w = 16 + g.measureText(t).width + 12;
    if (lx && lx + w > W) { lx = 0; ly += fs * 1.5; }
    if (col) { g.strokeStyle = col; g.lineWidth = 3; g.beginPath(); g.moveTo(lx, ly); g.lineTo(lx + 11, ly); g.stroke(); }
    else { g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.arc(lx + 5, ly, 3.5, 0, 7); g.stroke(); }
    g.fillStyle = 'rgba(255,255,255,.7)'; g.fillText(t, lx + 16, ly); lx += w;
  }
  const lh = ly - T + fs * 0.6;
  // the course, as the HUD's map draws it (world +x to the left, +z up: the chase view's heading +z)
  const top = T + lh + (big ? 4 : 2), aw = W - 2 * pad, ah = H - top - pad;
  const s = Math.min(aw / (B.x1 - B.x0), ah / (B.z1 - B.z0)), ox = pad + (aw - (B.x1 - B.x0) * s) / 2, oz = top + (ah - (B.z1 - B.z0) * s) / 2;
  const X = x => W - (ox + (x - B.x0) * s), Y = z => oz + (B.z1 - z) * s;
  g.lineJoin = g.lineCap = 'round';
  g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = Math.max(4, 2 * half * s); g.beginPath();
  P.forEach((q, i) => i ? g.lineTo(X(q.x), Y(q.z)) : g.moveTo(X(q.x), Y(q.z))); g.closePath(); g.stroke();
  // the start line
  { const q = P[AI.s0 ?? 0], hx = q.tz * half, hz = -q.tx * half; g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 2; g.lineCap = 'butt';
    g.beginPath(); g.moveTo(X(q.x + hx), Y(q.z + hz)); g.lineTo(X(q.x - hx), Y(q.z - hz)); g.stroke(); g.lineCap = 'round'; }
  // against a lap (#340): the stretches where it loses the most, shaded; that lap's line, in gold dashes
  const cmp = aiMapCmp();
  if (cmp) {
    g.strokeStyle = 'rgba(255,90,77,.34)'; g.lineWidth = Math.max(9, 2 * half * s + 4);
    for (const r of cmp.top) { g.beginPath(); for (let k = r.a; k <= r.b; k++) { const q = P[(cmp.s0 + k) % n]; k === r.a ? g.moveTo(X(q.x), Y(q.z)) : g.lineTo(X(q.x), Y(q.z)); } g.stroke(); }
    const R = cmp.R; g.strokeStyle = 'rgba(242,193,78,.85)'; g.lineWidth = 1.25; g.setLineDash([4, 4]); g.beginPath();
    for (let i = 0; i <= n; i++) { const q = P[i % n], e = R.e[i % n], x = X(q.x + q.tz * e), y = Y(q.z - q.tx * e); i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke(); g.setLineDash([]);
  }
  // where it drove, a colour a step of the pedals (a run of the same step: one path); points apart by up to 3 m are joined
  g.lineWidth = big ? 3.5 : 2.5;
  let run = null, prev = -1;
  const flush = () => { if (run) { g.strokeStyle = aiMapCol(run.q); g.stroke(); run = null; } };
  for (let k = 0; k <= n; k++) {
    const i = k % n; if (!M.set[i]) continue;
    if (prev >= 0 && (i - prev + n) % n <= 3 && Math.hypot(M.x[i] - M.x[prev], M.z[i] - M.z[prev]) < 8) {
      const q = aiMapStep(M.gas[prev], M.brk[prev]);
      if (!run || run.q !== q) { flush(); run = { q }; g.beginPath(); g.moveTo(X(M.x[prev]), Y(M.z[prev])); }
      g.lineTo(X(M.x[i]), Y(M.z[i]));
    } else flush();
    prev = i;
  }
  flush();
  // the handbrake: rings where it pulled it (one every 5 m)
  g.strokeStyle = '#fff'; g.lineWidth = 1.5;
  for (let i = 0, lastHb = -9; i < n; i++) if (M.set[i] && M.hb[i] && i - lastHb >= 5) { lastHb = i; g.beginPath(); g.arc(X(M.x[i]), Y(M.z[i]), big ? 4.5 : 3.5, 0, 7); g.stroke(); }
  // the stretches' numbers, as under the map
  if (cmp) cmp.top.forEach((r, j) => {
    const q = P[(cmp.s0 + Math.round((r.a + r.b) / 2)) % n], x = X(q.x - q.tz * (half + 4 / s)), y = Y(q.z + q.tx * (half + 4 / s)), rr = big ? 8 : 6.5;
    g.fillStyle = '#ff5a4d'; g.beginPath(); g.arc(x, y, rr, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.font = f(700); g.textAlign = 'center'; g.fillText(String(j + 1), x, y + 0.5); g.textAlign = 'left';
  });
  // the car, while it drives
  if (AI.drive) { g.fillStyle = '#fff'; g.strokeStyle = 'rgba(14,11,8,1)'; g.lineWidth = 2; g.beginPath(); g.arc(X(car.pos.x), Y(car.pos.z), big ? 5.5 : 4.5, 0, 7); g.fill(); g.stroke(); }
  // the point under the pointer: its values
  if (cv._hx == null) return;
  const hx = cv._hx, hy = cv._hy;
  let bi = -1, bd = (big ? 14 : 10) ** 2;
  for (let i = 0; i < n; i++) if (M.set[i]) { const d = (X(M.x[i]) - hx) ** 2 + (Y(M.z[i]) - hy) ** 2; if (d < bd) { bd = d; bi = i; } }
  if (bi < 0) return;
  const px = X(M.x[bi]), py = Y(M.z[bi]), from = ((bi - (AI.s0 ?? 0)) % n + n) % n * M.Pt.ds;
  g.fillStyle = aiMapCol(aiMapStep(M.gas[bi], M.brk[bi])); g.strokeStyle = 'rgba(14,11,8,1)'; g.lineWidth = 2; g.beginPath(); g.arc(px, py, big ? 5 : 4, 0, 7); g.fill(); g.stroke();
  const pc = v => Math.round(v * 100) + ' %';
  aiTipBox(g, px, py, W, H, [[`${Math.round(from)} m from the start line`, f(600)], [`${Math.round(M.kmh[bi])} km/h`, f(400)],
    [`gas ${pc(M.gas[bi])} · brake ${pc(M.brk[bi])}`, f(400)], [`handbrake ${M.hb[bi] ? 'on' : 'off'}`, f(400)],
    ...(cmp ? [[`${aiWhose(cmp.R.who, true)} lap: ${Math.round(cmp.R.v[bi] * 3.6)} km/h${Math.abs(cmp.R.v[bi] * 3.6 - M.kmh[bi]) >= 1 ? ` (it is ${Math.round(Math.abs(cmp.R.v[bi] * 3.6 - M.kmh[bi]))} ${cmp.R.v[bi] * 3.6 > M.kmh[bi] ? 'slower' : 'faster'})` : ''}`, f(400)]] : [])], fs);
}
// ---------- a lap to follow (#340): the driver's best lap kept, the lab's choice, the review against it ----------
document.head.insertAdjacentHTML('beforeend', `<style>
  #aiPanel .aiFol{align-items:center} #aiPanel .aiFol label.qc{flex:1;min-width:0;white-space:nowrap} #aiPanel #aiFollow{flex:1;min-width:0} #aiPanel #aiFollowSay{flex-basis:100%;margin:2px 0 0}
  #aiPanel #aiMapCmp{font-size:11px;line-height:1.4;margin-top:6px} #aiPanel #aiMapCmp:empty{display:none} #aiPanel #aiMapCmp div{margin-top:4px}
  #aiPanel #aiMapCmp .n{display:inline-block;min-width:15px;height:15px;line-height:15px;border-radius:8px;background:#ff5a4d;color:#fff;font-size:10px;font-weight:700;text-align:center;margin-right:5px}
  #aiPanel #aiMapCmp .k{opacity:.65} #aiPanel #aiMapCmp .gold{display:inline-block;width:14px;border-top:2px dashed #f2c14e;vertical-align:middle;margin-right:4px}
  #aiPanel.big #aiMapCmp{font-size:12.5px;flex-basis:100%;margin-top:8px;padding-top:8px;border-top:1px solid #ffffff1c}
</style>`);
const aiLapKey = () => `carsim.lap.${courseKey()}.${VEH.key}`;         // (not sandbuggy.ai.*: those go to every worker)
// the driver's best lap here with this car, as kept ({ time, trace, at }); looked up again when the track or the car
// changes, or a second on (courseKey hashes the whole course)
function aiMyLap() {
  const now = performance.now(), ck = AI.myCk;
  if (ck && ck.T === TRACK && ck.v === VEH.key && now - ck.t < 1000) return ck.lap;
  let lap = null;
  try { const d = JSON.parse(localStorage.getItem(aiLapKey()) || 'null'); if (d && Number.isFinite(d.time) && typeof d.trace === 'string') lap = d; } catch (e) { }
  AI.myCk = { T: TRACK, v: VEH.key, t: now, lap };
  return lap;
}
// a lap worth copying, on the replay's tape: no jump (a respawn), never stopped, and over the start line about as fast
// as over the finish (a flying lap: the first lap, from the line, would teach it to dawdle there)
function aiLapClean(t0, t1) {
  let a = null, b = null;
  const sp = f => Math.hypot(f.v[0], f.v[2]);
  for (const f of rp.buf) {
    if (f.t < t0 - 0.02) continue; if (f.t > t1 + 0.02) break;
    if (b && Math.hypot(f.p[0] - b.p[0], f.p[2] - b.p[2]) > 4 + 3 * (f.t - b.t) * sp(b)) return false;
    if (sp(f) < 1.5) return false;
    if (!a) a = f; b = f;
  }
  return !!a && b !== a && sp(a) >= 0.8 * sp(b);
}
function aiKeepLap(t) {
  if (AI.drive || AI.training || rp.on || MP.spectator) return;
  const time = t - lap.lapStart, was = aiMyLap();
  if ((was && was.time <= time) || !aiLapClean(lap.lapStart, t)) return;
  const trace = mpTrace(lap.lapStart, t); if (!trace) return;
  try { localStorage.setItem(aiLapKey(), JSON.stringify({ time, trace, at: Date.now() })); } catch (e) { return; }
  AI.myCk = AI.refCk = null;
}
const aiGhostLap = () => mpGhost.key && mpGhost.trace && mpGhost.veh === VEH.key && Number.isFinite(mpGhost.time) ? { name: String(mpGhost.name || 'a driver'), time: mpGhost.time, trace: mpGhost.trace } : null;
const aiWhose = (who, cap) => who === 'you' ? (cap ? 'Your' : 'your') : who ? `${who}’s` : (cap ? 'The' : 'the');
// which of the laps on offer is the one followed ('': none; 'kept': one that is neither, an earlier best or the console's)
function aiFollowing() {
  const D = aiDemoNow(); if (!D) return '';
  const same = o => o && D.time != null && Math.abs(D.time - o.time) < 1e-6;
  return D.src === 'mine' && same(aiMyLap()) ? 'mine' : D.src === 'ghost' && same(aiGhostLap()) ? 'ghost' : 'kept';
}
// follow a lap ('mine', 'ghost') or none (''): a training under way carries on with it, its best examined again
function aiFollow(id) {
  const mine = aiMyLap(), G = aiGhostLap();
  try {
    if (id === 'mine' && mine) aiDemo(mine.trace, { who: 'you', time: mine.time, src: 'mine' });
    else if (id === 'ghost' && G) aiDemo(G.trace, { who: G.name, time: G.time, src: 'ghost' });
    else if (id === '') aiDemo(null);
    else return false;
  } catch (e) { flash(`That lap can't be followed: ${e.message || e}`, '#ff8a7a', 3); return false; }
  AI.followSig = AI.cmpSig = null;
  if (AI.training && AI.examKind !== aiExamKind()) { aiTrain(false); aiTrain(true); }
  aiShow();
  return true;
}
function aiFollowShow() {
  const sel = AI.el.querySelector('#aiFollow'), say = AI.el.querySelector('#aiFollowSay'), D = aiDemoNow(), mine = aiMyLap(), G = aiGhostLap(), cur = aiFollowing();
  const sig = JSON.stringify([cur, D?.who, D?.time, mine?.time, G?.name, G?.time]);
  if (sig !== AI.followSig) {
    AI.followSig = sig;
    sel.innerHTML = `<option value="">none: the computed line and notes</option>`
      + (mine ? `<option value="mine">my best lap here · ${fmt(mine.time)}</option>` : `<option value="mine" disabled>my best lap here: none yet</option>`)
      + (G ? `<option value="ghost">the ghost: ${mpEsc(G.name)} · ${fmt(G.time)}</option>` : '')
      + (cur === 'kept' ? `<option value="kept">${mpEsc(aiWhose(D.who))} lap${D.time ? ` · ${fmt(D.time)}` : ''} (kept)</option>` : '');
    say.textContent = D ? `Its racing line and pace notes are ${aiWhose(D.who)} ${D.time ? fmt(D.time) + ' ' : ''}lap: where that lap went and how fast, metre by metre.`
      : mine ? `Your best lap here (${fmt(mine.time)}) can be its example: the network then steers by that lap's line and is told its speeds.`
      : 'Drive two laps yourself: your best clean lap after the first is kept, and can be its example.';
  }
  if (document.activeElement !== sel) sel.value = cur;
}
AI.el.querySelector('#aiFollow').addEventListener('change', e => { const v = e.target.value; e.target.blur(); if (v !== 'kept') aiFollow(v); });
// the lap a drive is reviewed against: the one followed, or else the driver's best here ({ e, v, who, time, followed })
function aiRefLap() {
  const D = aiDemoNow(); if (D) return { e: D.e, v: D.v, who: D.who, time: D.time, followed: true };
  const mine = aiMyLap(), Pt = botPath(); if (!mine) return null;
  if (AI.refCk?.Pt !== Pt || AI.refCk.time !== mine.time || AI.refCk.v !== VEH.key) {
    let p = null; try { p = aiLapProfile(mine.trace); } catch (e) { }
    AI.refCk = { Pt, time: mine.time, v: VEH.key, p };
  }
  const p = AI.refCk.p;
  return p && { e: p.e, v: p.v, who: 'you', time: mine.time, followed: false };
}
// Drive it's latest pass against that lap: the time lost and gained, and the stretches where it is more than 5 km/h
// slower (gaps under 10 m joined), the three that cost the most; from the start line on (s0)
function aiMapCmp() {
  const M = AI.map, R = M?.cnt ? aiRefLap() : null; if (!R || R.v.length !== M.n) return null;
  const sig = `${M.cnt}|${R.time}|${R.followed}|${AI.drive ? Math.floor(performance.now() / 500) : ''}`;
  if (AI.cmpSig === sig && AI.cmp?.M === M) return AI.cmp;
  aiLineAt(0);
  const n = M.n, ds = M.Pt.ds, s0 = AI.s0, dt = new Float32Array(n), gap = Math.ceil(10 / ds);
  let lost = 0, gained = 0, cnt = 0;
  for (let i = 0; i < n; i++) if (M.set[i]) {
    dt[i] = ds * (1 / Math.max(M.kmh[i] / 3.6, 2) - 1 / Math.max(R.v[i], 2));
    if (dt[i] > 0) lost += dt[i]; else gained -= dt[i];
    cnt++;
  }
  const runs = []; let cur = null;
  for (let k = 0; k < n; k++) {
    const i = (s0 + k) % n; if (!M.set[i] || R.v[i] * 3.6 - M.kmh[i] <= 5) continue;
    if (cur && k - cur.b <= gap) cur.b = k; else runs.push(cur = { a: k, b: k });
  }
  for (const r of runs) {
    let c = 0, br = 0, wd = 0; r.dt = 0; r.w = -1;
    for (let k = r.a; k <= r.b; k++) {
      const i = (s0 + k) % n; if (!M.set[i]) continue;
      r.dt += dt[i]; c++; if (M.brk[i] > 0.15) br++;
      const d = R.v[i] * 3.6 - M.kmh[i]; if (d > wd) { wd = d; r.w = i; }
    }
    r.brk = c ? br / c : 0;
  }
  const top = runs.filter(r => r.w >= 0 && r.dt >= 0.05).sort((a, b) => b.dt - a.dt).slice(0, 3)
    .map(r => ({ a: r.a, b: r.b, from: r.a * ds, to: r.b * ds, dt: r.dt, brk: r.brk, kmh: M.kmh[r.w], ref: R.v[r.w] * 3.6 }));
  AI.cmpSig = sig;
  return AI.cmp = { M, R, s0, lost, gained, cover: cnt / n, top };
}
// (under the map in the drawer; full screen, where the map's box is small, with the lap to follow in the left column)
function aiMapCmpShow(on) {
  const el = AI.el.querySelector('#aiMapCmp'), c = on ? aiMapCmp() : null, host = AI.el.querySelector(AI.big ? '.aiFol' : '.aiMapBox');
  if (el.parentNode !== host) host.append(el);
  let h = '';
  if (c) {
    const net = c.lost - c.gained, s = v => `${Math.abs(v).toFixed(Math.abs(v) < 10 ? 2 : 1)} s`, whose = aiWhose(c.R.who);
    h = `<span class="gold"></span>Against ${mpEsc(whose)} ${c.R.time ? fmt(c.R.time) + ' ' : ''}lap${c.R.followed ? ', the one it follows' : ''}: <b>${s(net)} ${net >= 0 ? 'slower' : 'faster'}</b>`
      + ` ${c.cover > 0.97 ? 'over the lap' : `over the ${Math.round(c.cover * 100)} % of the course driven so far`}`
      + `${c.lost > 0.05 && c.gained > 0.05 ? ` <span class="k">(loses ${s(c.lost)}, gains ${s(c.gained)})</span>` : ''}.`
      + c.top.map((r, j) => `<div><span class="n">${j + 1}</span>${Math.round(r.from)}–${Math.round(r.to)} m: <b>+${s(r.dt)}</b>, ${Math.round(r.kmh)} km/h where the lap does ${Math.round(r.ref)}`
        + `${r.brk >= 0.05 ? `, on the brake for ${Math.round(r.brk * 100)} % of it` : ', without braking'}</div>`).join('')
      + (c.top.length ? '' : `<div class="k">Nowhere more than 5 km/h slower than that lap.</div>`)
      + (!c.R.followed ? `<div class="k">It isn't following that lap: choose it under “lap to follow” and train on.</div>` : '');
  }
  if (el._h !== h) { el._h = h; el.innerHTML = h; }
}
function aiChartsDraw() {
  if (!AI.open) return;
  const len = botPath().len, Hs = AI.big ? AI.hist : AI.hist.slice(-120), g0 = AI.gen - Hs.length + 1, xs = Hs.map((h, i) => g0 + i);
  const laps = Hs.map(h => h[2] ?? null), m = v => `${Math.round(v).toLocaleString('en')} m`;
  const score = { xs, title: AI.big ? 'Exam score' : 'exam score', series: [{ name: 'exam', col: AI_C1, vals: Hs.map(h => h[0]) }, { name: 'tries’ average', col: AI_C2, vals: Hs.map(h => h[1]) }],
    ref: { v: len, label: `a lap: ${m(len)}` }, tick: v => Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v) + '', fmt: m, minSpan: 50, empty: 'Train it: each generation shows here',
    more: i => Hs[i][2] != null ? `lap: ${fmt(Hs[i][2])}` : '' };
  let best = Infinity; const bestSo = laps.map(t => t == null ? (best < Infinity ? best : null) : (best = Math.min(best, t)));
  const lapc = { xs, title: AI.big ? 'Exam lap time' : `lap times · best ${fmt(AI.bestLap)}`, series: [{ name: 'exam lap', col: AI_C1, vals: laps, dots: true }, { name: 'best so far', col: AI_C2, vals: bestSo, step: true }],
    invert: true, tick: t => t >= 60 ? fmt(t).slice(0, -2) : t.toFixed(t < 10 ? 2 : 1) + ' s', fmt, minSpan: 2, empty: 'No full lap yet: its lap times show here once it laps',
    ref: AI.bestLap != null && !AI.big ? { v: AI.bestLap, label: `best ${fmt(AI.bestLap)}` } : null };
  const hb = aiHumanBest(), nb = aiNetBest();
  lapc.refs = [hb && { v: hb.t, label: `${AI.big ? 'best by a driver: ' : ''}${fmt(hb.t)} ${hb.name.slice(0, 18)}`, col: '#f2c14e', right: true, short: fmt(hb.t) },   // (gold: the lap to beat)   // (full screen: the best so far is a line)
    nb && { v: nb.t, label: `${AI.big ? 'best by a network: ' : ''}${fmt(nb.t)} ${nb.name.slice(0, 18)}${AI.big && nb.creator ? ` (${nb.creator.slice(0, 14)})` : ''}`, col: '#58d6e6', right: true, short: fmt(nb.t) }].filter(Boolean);   // (#352: cyan, a network's)
  if (!AI.big) { const lapping = AI.bestLap != null && laps.some(t => t != null); if (lapping) lapc.series = lapc.series.slice(0, 1); aiPlot(AI.el.querySelector('#aiChart'), lapping ? lapc : score); return; }
  aiPlot(AI.el.querySelector('#aiChart'), score); aiPlot(AI.el.querySelector('#aiChart2'), lapc);
}


// boot
setTimeout(() => {
  const t0 = performance.now();
  generateTerrain();
  car.pos.set(0, 0, 0);
  buildCircuit();
  if (MP.on) mpBootVehicle();
  else try { const sv = localStorage.getItem('sandbuggy.vehicle'); if (sv && sv !== 'buggy' && VEHICLE_LIST[sv]) switchVehicle(sv); } catch (e) { console.warn(e); }
  restartRun();
  setSurface(ROAD ? 'road' : COURSE.base);
  refreshChunks(car.pos.x, car.pos.z);
  updateFar();
  syncVisual();
  camPos.copy(car.pos).addScaledVector(TRACK.gates[0].t, -8).add(v1.set(0, 3, 0)); camFwd.copy(TRACK.gates[0].t);
  camera.position.copy(camPos);
  document.getElementById('loading').remove();
  window.__sim = { car, H, B, C, M, carCondition, debris, get TRACK() { return TRACK; }, lap, ed, COURSE: () => COURSE, toggleEditor, regenerateWorld, applyOp, updatePreview, collideGates, repairAll, damagePower, get BRIDGE() { return BRIDGES[0] || { top: 0, cx: 0, cz: 0, tx: 1, tz: 0 }; }, BRIDGES, toggleBridgeAt, setSurface, surfaceAt, restartRun, respawn, camera, orbit, heightAt, override: null, get PRESSURES() { return PRESSURES; }, get VEH() { return VEH; }, switchVehicle, VEHICLES, ROAD_CARS, resetCar, bootMs: performance.now() - t0, paused: false, get simTime() { return simTime; }, run(sec) { for (let t = 0; t < sec; t += 1 / 60) simulate(1 / 60); }, setCam: m => { camMode = m; orbit.enabled = m === 2; }, rp, startReplay, stopReplay, resetBest, BOTS, setBots, setPaint, togglePaintPanel, get camMode() { return camMode; } };
  Object.assign(window.__sim, { HIT, carHit, bodyHit, repairBody, repairCar, dentablesOf, framePull, frameSag });
  Object.assign(window.__sim, { glassOf, glassHit, repairGlass, isGlassMat, SH });
  Object.assign(window.__sim, { skidMarks: () => ({ count: skidCount, strips: [...skidLast.keys()] }), clearSkids });
  // for tests and the console: step the physics without drawing (headless browsers draw at a frame a second)
  Object.assign(window.__sim, { MP, placeAtGate, resetCar, switchVehicle, setCamMode, step(n = 60, dt = 1 / 60) { for (let i = 0; i < n; i++) { simulate(dt); mpFrame(dt); } } });
  Object.assign(window.__sim, { ai: AI, aiTrainSync, aiTry, aiDrive });
  Object.assign(window.__sim, { aiExport, aiImport, aiNetConfig, aiCfg: AI_CFG, aiPen: AI_PEN });   // (#351)
  Object.assign(window.__sim, { sound: { muted: () => muted, set: setMuted } });   // (the rail's Sound, the room's page; #343)
  Object.assign(window.__sim, { aiFollow, aiFollowing, aiMyLap, aiKeepLap, aiLapClean, aiLapProfile, aiMapCmp });   // (a lap to follow, #340)
  Object.assign(window.__sim, { setup: SETUP });                                  // (the Car setup drawer, ui.js)
  Object.assign(window.__sim, { renderer });                                      // for the Claude bridge's screenshots (bridge.js)
  Object.assign(window.__sim, { aiDemo, aiSaveServer, aiForget, aiPool: AI_POOL, aiGT, aiGroundBack });   // (aiGT, aiGroundBack: tests)
  if (AI_WK) Object.assign(self, { __aiwServe: aiWorkerServe, __aiwHash: aiGroundHash });   // (a worker's engine: ready for its jobs)
  if (BOTS.n) setBots(BOTS.n);
  requestAnimationFrame(t => { last = t; frame(t); });
  mpPost({ t: 'ready' });
  if (MP.edit) { document.getElementById('menu').style.display = 'none'; toggleEditor(true); MP.sig = mpEditSig(); mpPost({ t: 'sig', sig: MP.sig }); }   // the map as loaded: nothing to save yet
}, 30);
