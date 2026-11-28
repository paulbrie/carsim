// The arm sim's scenarios of one's own (#365): the objects on the table (cubes, boxes, balls, cylinders: their sizes and
// colours), the trays (where, how big, their colours) and the rules that say which object goes in which tray, written
// as plain lines ("red → A", "ball → B", "anything else → stays"). A scenario is a small file (`kind: 'armsim-scenario'`);
// `checkScenario` says what is wrong with one and what each object will do, `compileScenario` turns it into what core's
// TASKS entries are (its jobs: each object a rule sends somewhere, in the order they are listed, `{ cube, to: tray }`),
// with each object's own figures (the heights and widths core's book-keeping uses for a cube) and its trays.
// Like core: no page, no clock, no Math.random, and only the Math that is exact everywhere (sin, cos, hypot: ./math.mjs),
// so a scenario's placements and drives are the same in every browser and in Node. Sizes in the file are centimetres
// and degrees (what a person types); compiled, metres and radians in MuJoCo's axes (z up).
import { cos, hypot, sin } from './math.mjs';

export const SCENARIO_KIND = 'armsim-scenario';
/** The colours an object or a tray may have, by the names the rules use. Not orange or cyan: the site's colours for people and networks. */
export const PALETTE = {
  red: 0xe5484d, yellow: 0xf2d544, green: 0x46a758, blue: 0x3e63dd, purple: 0x8e4ec6,
  pink: 0xe25fb0, white: 0xeeeef0, black: 0x2b2d31, grey: 0x8b8d98, brown: 0xa07553,
};
/** The shapes: the sizes each is given (cm) and what they mean. */
export const SHAPES = {
  cube: { name: 'Cube', sizes: ['side'] },
  box: { name: 'Box', sizes: ['length', 'width', 'height'] },
  ball: { name: 'Ball', sizes: ['diameter'] },
  cylinder: { name: 'Cylinder', sizes: ['diameter', 'height'] },
};
export const SCENARIO_LIMITS = { objects: 8, trays: 4, size: [2, 10], grip: 6.8, limit: [5, 120], exam: [5, 20], name: 60, rules: 2000, trayAt: { r: [18, 40], a: 150 }, traySize: [6, 30] };
const OBJ_R = [0.2, 0.42], OBJ_A = 1;                          // where objects are put: as the built-in scenarios' cubes (m, rad)
const DENSITY = 800;                                            // kg/m³: the built-in cube's (5 cm, 100 g)
const D2R = Math.PI / 180;

// ---------------------------------------------------------------- the rules
const WORDS = {
  shape: { cube: 'cube', cubes: 'cube', box: 'box', boxes: 'box', brick: 'box', bricks: 'box', block: 'box', blocks: 'box', rectangle: 'box', rectangles: 'box',
    ball: 'ball', balls: 'ball', sphere: 'ball', spheres: 'ball', cylinder: 'cylinder', cylinders: 'cylinder', can: 'cylinder', cans: 'cylinder' },
  any: new Set(['anything', 'everything', 'else', 'rest', 'other', 'others', 'all', 'any', '*']),
  skip: new Set(['the', 'a', 'an', 'every', 'each', 'and', 'object', 'objects', 'thing', 'things', 'one', 'ones', 'that', 'are', 'is', 'which']),
  stay: new Set(['stays', 'stay', 'nowhere', 'leave', 'table', 'none', 'nothing', '-']),
  small: new Set(['small', 'little', 'tiny', 'smaller']), big: new Set(['big', 'large', 'huge', 'bigger', 'larger']),
  measure: { wider: ['w', 1], narrower: ['w', -1], taller: ['h', 1], higher: ['h', 1], shorter: ['h', -1], lower: ['h', -1], longer: ['l', 1], bigger: ['l', 1], larger: ['l', 1], smaller: ['l', -1], heavier: ['m', 1], lighter: ['m', -1] },
};
/** An object's measures for the rules: w its width (the narrower side across the table), l its largest side, h its height (cm), m grams. */
const measures = o => ({ w: o.dims[0] * 100, l: Math.max(o.dims[0], o.dims[1], o.dims[2]) * 100, h: o.dims[2] * 100, m: o.mass * 1000 });

/**
 * The rules, read: one a line, `condition → tray` (or ->, =>, :, "to", "goes in"). A condition is words that must all be
 * true (a shape, a colour, small / big, "wider than 5 cm"...; `not` turns the next one round), alternatives joined by
 * "or"; "anything" is always true. The tray is one of the trays' names, or "stays" (left where it is). Lines starting
 * with # are notes. → { rules: [{ line, any: [[term]], to: tray index | null }], errors: [{ line, msg }] }
 */
export function parseRules(text, trays) {
  const rules = [], errors = [], names = trays.map(t => String(t.name).trim().toLowerCase());
  String(text ?? '').split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1, src = raw.replace(/#.*$/, '').trim();
    if (!src) return;
    const m = /^(.*?)\s*(?:->|→|=>|⇒|:|\bgoes? (?:in|into|to)\b|\bin(?:to)?\b|\bto\b)\s*(.+)$/i.exec(src);
    if (!m) { errors.push({ line, msg: 'write it as "what → tray", e.g. "red → A"' }); return; }
    const dest = m[2].trim().toLowerCase().replace(/^(?:tray|the tray)\s+/, '').replace(/\.$/, '');
    let to;
    if (WORDS.stay.has(dest) || dest === 'stays where it is' || dest === 'stay where they are') to = null;
    else { to = names.indexOf(dest); if (to < 0) { errors.push({ line, msg: `no tray called "${m[2].trim()}" (there are: ${trays.map(t => t.name).join(', ')}; or "stays")` }); return; } }
    const any = [];
    for (const alt of m[1].toLowerCase().split(/\bor\b|,/)) {
      const words = alt.split(/\s+/).filter(Boolean), terms = [];
      for (let k = 0; k < words.length; k++) {
        let w = words[k], not = false;
        if (w === 'not' || w === 'no' || w === 'non') { not = true; w = words[++k]; if (w === undefined) { errors.push({ line, msg: '"not" what?' }); return; } }
        if (WORDS.skip.has(w)) { if (not) { errors.push({ line, msg: `"not ${w}"?` }); return; } continue; }
        let t;
        if (WORDS.any.has(w)) t = { any: true };
        else if (WORDS.shape[w]) t = { shape: WORDS.shape[w] };
        else if (Object.hasOwn(PALETTE, w) || w === 'gray') t = { color: w === 'gray' ? 'grey' : w };
        else if (WORDS.measure[w] && words[k + 1] === 'than') {
          const n = parseFloat(words[k + 2]), unit = (words[k + 2] ?? '').replace(/^[\d.]+/, '') || words[k + 3] || 'cm';
          if (!Number.isFinite(n)) { errors.push({ line, msg: `"${w} than" how much? (e.g. ${w} than 5 cm)` }); return; }
          const [what, sign] = WORDS.measure[w], u = what === 'm' ? (/^kg/.test(unit) ? 1000 : 1) : /^mm/.test(unit) ? 0.1 : 1;
          t = { what, sign, n: n * u };
          k += words[k + 2].replace(/^[\d.]+/, '') ? 2 : /^(cm|mm|g|kg|grams?)$/.test(words[k + 3] ?? '') ? 3 : 2;
        }
        else if (WORDS.small.has(w)) t = { size: -1 };
        else if (WORDS.big.has(w)) t = { size: 1 };
        else { errors.push({ line, msg: `"${w}": not a shape (cube, box, ball, cylinder), a colour (${Object.keys(PALETTE).join(', ')}), small / big, or "wider than 5 cm"` }); return; }
        terms.push(not ? { ...t, not } : t);
      }
      if (terms.length) any.push(terms);
    }
    if (!any.length) { errors.push({ line, msg: 'which objects? (e.g. "red", "ball", "anything")' }); return; }
    rules.push({ line, any, to });
  });
  return { rules, errors };
}
// is a term true of an object (mid: between the smallest and the largest object's largest side: small below it, big above)
function holds(t, o, mid) {
  let v;
  if (t.any) v = true;
  else if (t.shape) v = o.shape === t.shape;
  else if (t.color) v = o.color === t.color;
  else if (t.size) v = mid != null && (t.size > 0 ? measures(o).l > mid : measures(o).l < mid);
  else v = t.sign > 0 ? measures(o)[t.what] > t.n : measures(o)[t.what] < t.n;
  return t.not ? !v : v;
}

// ---------------------------------------------------------------- the file, checked
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clip = (v, [a, b]) => Math.min(b, Math.max(a, v));
const r1 = v => Math.round(v * 10) / 10;

/** A scenario as a file: what the page and the server keep. Anything missing or out of range is put right (and said so in `checkScenario`'s warnings). */
export function cleanScenario(d) {
  const s = d && typeof d === 'object' ? d : {};
  const objects = (Array.isArray(s.objects) ? s.objects : []).slice(0, SCENARIO_LIMITS.objects).map(o => {
    const shape = Object.hasOwn(SHAPES, o?.shape) ? o.shape : 'cube', want = SHAPES[shape].sizes.length;
    const size = Array.from({ length: want }, (_, i) => r1(clip(num(o?.size?.[i], 5), SCENARIO_LIMITS.size)));
    return { shape, size, color: Object.hasOwn(PALETTE, o?.color) ? o.color : 'white', n: Math.round(clip(num(o?.n, 1), [1, SCENARIO_LIMITS.objects])) };
  });
  const used = new Set();
  const trays = (Array.isArray(s.trays) ? s.trays : []).slice(0, SCENARIO_LIMITS.trays).map((t, i) => {
    let name = String(t?.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 12) || String.fromCharCode(65 + i);
    while (used.has(name.toLowerCase())) name += "'";
    used.add(name.toLowerCase());
    return { name, color: Object.hasOwn(PALETTE, t?.color) ? t.color : 'green',
      at: [Math.round(clip(num(t?.at?.[0], 100), [-SCENARIO_LIMITS.trayAt.a, SCENARIO_LIMITS.trayAt.a])), r1(clip(num(t?.at?.[1], 30), SCENARIO_LIMITS.trayAt.r))],
      size: [0, 1].map(k => r1(clip(num(t?.size?.[k], 14), SCENARIO_LIMITS.traySize))) };
  });
  return {
    kind: SCENARIO_KIND, name: String(s.name ?? '').trim().replace(/\s+/g, ' ').slice(0, SCENARIO_LIMITS.name) || 'My scenario',
    objects, trays, rules: String(s.rules ?? '').slice(0, SCENARIO_LIMITS.rules),
    limit: Math.round(clip(num(s.limit, 8 * Math.max(1, objects.reduce((n, o) => n + o.n, 0))), SCENARIO_LIMITS.limit)),
    exam: Math.round(clip(num(s.exam, 10), SCENARIO_LIMITS.exam)),
  };
}

// one object as core needs it: its full sizes (MuJoCo's x across the fingers, y along, z up: a box lies with its narrower
// side across them), its mass, and the figures core's book-keeping uses for a cube
function item(o) {
  const c = o.size.map(v => v / 100);
  let dims;                                                   // x, y, z (m): x is the side the fingers close across
  if (o.shape === 'cube') dims = [c[0], c[0], c[0]];
  else if (o.shape === 'box') { const [a, b] = c[0] <= c[1] ? [c[0], c[1]] : [c[1], c[0]]; dims = [a, b, c[2]]; }
  else if (o.shape === 'ball') dims = [c[0], c[0], c[0]];
  else dims = [c[0], c[0], c[1]];
  const vol = o.shape === 'ball' ? Math.PI / 6 * c[0] * c[0] * c[0] : o.shape === 'cylinder' ? Math.PI / 4 * c[0] * c[0] * c[1] : dims[0] * dims[1] * dims[2];
  const mass = Math.round(clip(DENSITY * vol, [0.02, 0.4]) * 1000) / 1000;
  const hz = dims[2] / 2, foot = dims[0] / 2, bound = o.shape === 'box' || o.shape === 'cube' ? hypot(dims[0], dims[1]) / 2 : dims[0] / 2;
  return {
    shape: o.shape, color: o.color, hex: PALETTE[o.color], dims, mass,
    hz,                                                       // its middle's height when it stands on the table
    foot,                                                     // how far in from a tray's edge its middle must be (half its narrower side)
    wide: dims[0],                                            // across the fingers: they must open wider than this (and 12 mm) to have let go of it
    inn: Math.max(0.03, bound + 0.005),                      // "between the fingers": the grip's centre this near its middle across the table,
    innZ: Math.min(0.03, hz + 0.01),                          // and up or down (no more than a cube's 3 cm: a network shuts the fingers once it is between them, and higher up they hold a tall one by its top edge, and drop it)
    touchGap: Math.min(0.022, 0.6 * dims[0]),                 // the fingers shut on it: still this far apart
    bound,                                                    // its radius seen from above
  };
}
/** The built-in scenarios' cube, as an item (core's constants, so their drives stay what they were). */
export const CUBE_ITEM = Object.freeze({ shape: 'cube', color: null, hex: null, dims: [0.05, 0.05, 0.05], mass: 0.1, hz: 0.025, foot: 0.025, wide: 0.05, inn: 0.03, innZ: 0.03, touchGap: 0.022, bound: 0.05 * Math.sqrt(0.5) });

// a tray as core needs it: its middle (m), half its width and depth, and its turn (it faces the arm's base)
function trayOf(t) {
  const a = t.at[0] * D2R, r = t.at[1] / 100;
  return { name: t.name, color: t.color, hex: PALETTE[t.color], x: r * cos(a), y: r * sin(a), hx: t.size[1] / 200, hy: t.size[0] / 200, c: cos(a), s: sin(a), turn: a };
}
// do two trays overlap (rectangles, each turned): by their sides as separating axes
function overlap(p, q) {
  const axes = [[p.c, p.s], [-p.s, p.c], [q.c, q.s], [-q.s, q.c]], dx = q.x - p.x, dy = q.y - p.y;
  const ext = (t, [ax, ay]) => t.hx * Math.abs(t.c * ax + t.s * ay) + t.hy * Math.abs(-t.s * ax + t.c * ay);
  return axes.every(ax => Math.abs(dx * ax[0] + dy * ax[1]) < ext(p, ax) + ext(q, ax) + 0.01);
}
// how far a point is outside a tray (0 inside)
function outside(t, x, y) {
  const dx = x - t.x, dy = y - t.y, u = Math.abs(dx * t.c + dy * t.s) - t.hx, v = Math.abs(-dx * t.s + dy * t.c) - t.hy;
  return hypot(Math.max(0, u), Math.max(0, v));
}

/** A seeded dice (mulberry32, as core's). */
function dice(seed) {
  let s = seed >>> 0;
  return () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
/** FNV-1a of a string: a scenario's exam dice and its world's name. */
function hash(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193); return h >>> 0; }
/** What decides a scenario's drives (not its name): its exam's placements are seeded by it, and two files with the same are the same scenario. */
export const scenarioKey = spec => { const s = cleanScenario(spec); return hash(JSON.stringify([s.objects, s.trays, s.rules, s.limit, s.exam])).toString(36); };

// where a scenario's objects are put: within the cubes' band, apart from each other and from the trays (null: no room this time)
function placeAll(items, trays, rnd, turned) {
  const cubes = [];
  for (let n = 0; cubes.length < items.length && n < 2000; n++) {
    const it = items[cubes.length], c = { r: OBJ_R[0] + rnd() * (OBJ_R[1] - OBJ_R[0]), a: -OBJ_A + rnd() * 2 * OBJ_A, yaw: turned ? (rnd() - 0.5) * Math.PI / 2 : 0 };
    const x = c.r * cos(c.a), y = c.r * sin(c.a);
    if (!trays.every(t => outside(t, x, y) > it.bound + 0.03)) continue;
    if (cubes.every((o, i) => hypot(x - o.r * cos(o.a), y - o.r * sin(o.a)) >= Math.max(0.11, it.bound + items[i].bound + 0.05))) cubes.push(c);
  }
  return cubes.length === items.length ? { cubes } : null;
}

// where in its tray each object goes (u outwards from the base, v across, from the tray's middle): a grid of places as
// far apart as the largest of them needs, filled in the objects' order, so the second one for a tray is not set down on
// the first. null: the tray is too small for them.
function slots(trays, items, dest) {
  const out = items.map(() => null), bad = [];
  trays.forEach((t, k) => {
    const mine = dest.map((d, i) => (d === k ? i : -1)).filter(i => i >= 0);
    if (!mine.length) return;
    const p = Math.max(...mine.map(i => Math.max(items[i].dims[0], items[i].dims[1]))) + 0.025, across = Math.floor(2 * t.hy / p), along = Math.floor(2 * t.hx / p);
    if (!across || !along || across * along < mine.length) { bad.push({ msg: `Tray ${t.name} is too small for ${mine.length === 1 ? 'its object' : `its ${mine.length} objects`}: make it bigger, or send some elsewhere.` }); return; }
    const cols = Math.min(mine.length, across), rows = Math.ceil(mine.length / cols);
    mine.forEach((i, n) => { const r = Math.floor(n / cols), c = n % cols; out[i] = [((rows - 1) / 2 - r) * p, (c - (cols - 1) / 2) * p]; });
  });
  return { at: out, bad };
}

/**
 * What is wrong with a scenario (errors: it can't be run; warnings: it can, but), and what each object will do:
 * objects: [{ shape, color, size, to: tray name | null, rule: line | null }], one per object on the table.
 */
export function checkScenario(spec) {
  const s = cleanScenario(spec), errors = [], warnings = [];
  if (!s.objects.length) errors.push({ msg: 'Put at least one object on the table.' });
  if (!s.trays.length) errors.push({ msg: 'Put at least one tray on the table.' });
  const list = s.objects.flatMap(o => Array.from({ length: o.n }, () => o));
  if (list.length > SCENARIO_LIMITS.objects) errors.push({ msg: `At most ${SCENARIO_LIMITS.objects} objects on the table (this has ${list.length}).` });
  const items = list.map(item), trays = s.trays.map(trayOf);
  for (const o of s.objects) {
    const w = item(o).wide * 100;
    if (w > SCENARIO_LIMITS.grip) errors.push({ msg: `A ${SHAPES[o.shape].name.toLowerCase()} ${w.toFixed(1)} cm across is too wide for the fingers (${SCENARIO_LIMITS.grip} cm at most${o.shape === 'box' ? ': its narrower side is the one gripped' : ''}).` });
    else if (w > 5.8) warnings.push({ msg: `A ${SHAPES[o.shape].name.toLowerCase()} ${w.toFixed(1)} cm across is too wide for the reBot Arm's fingers (5.8 cm); the desk arm's take it.` });
  }
  for (let i = 0; i < trays.length; i++) for (let j = i + 1; j < trays.length; j++) if (overlap(trays[i], trays[j])) errors.push({ msg: `Trays ${trays[i].name} and ${trays[j].name} overlap.` });
  const { rules, errors: bad } = parseRules(s.rules, s.trays);
  for (const e of bad) errors.push({ line: e.line, msg: `Rule ${e.line}: ${e.msg}.` });
  const ls = items.map(it => measures(it).l), mid = ls.length && Math.max(...ls) - Math.min(...ls) > 0.25 ? (Math.max(...ls) + Math.min(...ls)) / 2 : null;
  const objects = list.map((o, i) => {
    const r = rules.find(r => r.any.some(terms => terms.every(t => holds(t, items[i], mid))));
    return { shape: o.shape, color: o.color, size: o.size, to: r && r.to != null ? s.trays[r.to].name : null, rule: r ? r.line : null };
  });
  if (!errors.length) errors.push(...slots(trays, items, objects.map(o => s.trays.findIndex(t => t.name === o.to))).bad);
  if (!bad.length && list.length && !objects.some(o => o.to)) errors.push({ msg: s.rules.trim() ? 'No rule sends any object to a tray.' : 'Write a rule for where the objects go, e.g. "anything → A".' });
  if (!errors.length) {
    const rnd = dice(hash(JSON.stringify(s))), fails = Array.from({ length: 40 }, () => placeAll(items, trays, rnd, false)).filter(p => !p).length;
    if (fails) errors.push({ msg: 'There is not room enough on the table for these objects with the trays where they are: fewer or smaller objects, or the trays further round (the objects are put between 20 and 42 cm out, up to 57° either side of straight ahead).' });
  }
  return { spec: s, errors, warnings, objects };
}

const compiled = new Map();
/**
 * A scenario as one of core's TASKS: { name, about, cubes, limit, exam, jobs, inputs, items, trays, place(rnd, turned),
 * seed, sig }. Throws when it can't be run (checkScenario's first error). Kept: the same file gives the same object.
 */
export function compileScenario(spec, inputs) {
  const json = JSON.stringify(spec);
  let T = compiled.get(json);
  if (T) return T;
  const { spec: s, errors, objects } = checkScenario(spec);
  if (errors.length) throw new Error(`This scenario can't be run: ${errors[0].msg}`);
  const list = s.objects.flatMap(o => Array.from({ length: o.n }, () => o)), items = list.map(item), trays = s.trays.map(trayOf);
  const dest = objects.map(o => s.trays.findIndex(t => t.name === o.to)), at = slots(trays, items, dest).at;
  // a job: its object, its tray, and where in the tray it is set down (`slot`, metres in MuJoCo's axes from the table's middle)
  const jobs = objects.map((o, i) => (o.to ? { cube: i, to: dest[i], slot: (t => [t.x + at[i][0] * t.c - at[i][1] * t.s, t.y + at[i][0] * t.s + at[i][1] * t.c])(trays[dest[i]]) } : null)).filter(Boolean);
  const say = objects.map(o => `${o.color} ${SHAPES[o.shape].name.toLowerCase()} → ${o.to ?? 'stays'}`);
  T = {
    key: 'custom', custom: true, name: s.name, about: `${list.length} ${list.length === 1 ? 'object' : 'objects'}, ${trays.length} ${trays.length === 1 ? 'tray' : 'trays'}: ${say.join(', ')}.`,
    cubes: items.length, limit: s.limit, exam: s.exam, jobs, inputs: inputs ?? ['go', 'rise', 'gap', 'beam', 'touch', 'there'], items, trays,
    seed: hash(JSON.stringify([s.objects, s.trays, s.rules, s.limit, s.exam])),
    sig: items.map(it => `${it.shape}:${it.dims.join('x')}:${it.mass}`).join('|'),
    place(rnd, turned = false) { return placeAll(items, trays, rnd, turned) ?? placeAll(items, trays, dice(T.seed), false) ?? { cubes: items.map((_, i) => ({ r: 0.31, a: -0.9 + 1.8 * i / Math.max(1, items.length - 1), yaw: 0 })) }; },
    spec: s,
  };
  if (compiled.size > 50) compiled.clear();
  compiled.set(json, T);
  return T;
}

/** A scenario's geoms for MuJoCo's scene (core's sceneXml): one free body each, with its shape, size and mass. */
export function itemXml(it, i) {
  const f = v => v.toFixed(4), [x, y, z] = it.dims;
  const geom = it.shape === 'ball' ? `type="sphere" size="${f(x / 2)}" condim="6" friction="1 0.005 0.003"` : it.shape === 'cylinder' ? `type="cylinder" size="${f(x / 2)} ${f(z / 2)}"` : `type="box" size="${f(x / 2)} ${f(y / 2)} ${f(z / 2)}"`;
  return `<body name="cube${i}" pos="${i} 3 ${f(it.hz)}"><freejoint/><geom name="cube${i}" ${geom} class="pad" mass="${it.mass}" conaffinity="3"/></body>`;
}

/** The variants to start from (the editor's "Start from"). */
export const EXAMPLES = [
  { kind: SCENARIO_KIND, name: 'Sort by colour', objects: [{ shape: 'cube', size: [5], color: 'red', n: 2 }, { shape: 'cube', size: [5], color: 'blue', n: 2 }],
    trays: [{ name: 'A', color: 'red', at: [100, 30], size: [20, 12] }, { name: 'B', color: 'blue', at: [-100, 30], size: [20, 12] }], rules: 'red → A\nblue → B', limit: 40, exam: 10 },
  { kind: SCENARIO_KIND, name: 'Balls and boxes', objects: [{ shape: 'ball', size: [5], color: 'yellow', n: 2 }, { shape: 'box', size: [8, 4, 4], color: 'purple', n: 2 }],
    trays: [{ name: 'Balls', color: 'yellow', at: [105, 30], size: [20, 14] }, { name: 'Boxes', color: 'purple', at: [-105, 30], size: [24, 14] }], rules: 'ball → Balls\nanything else → Boxes', limit: 40, exam: 10 },
  { kind: SCENARIO_KIND, name: 'Big and small', objects: [{ shape: 'cube', size: [6], color: 'green', n: 1 }, { shape: 'cube', size: [3], color: 'green', n: 2 }, { shape: 'cylinder', size: [4, 6], color: 'grey', n: 1 }],
    trays: [{ name: 'Big', color: 'white', at: [110, 32], size: [18, 18] }, { name: 'Small', color: 'grey', at: [-110, 28], size: [16, 12] }], rules: 'cylinder → stays\nbig → Big\nsmall → Small', limit: 30, exam: 10 },
];
