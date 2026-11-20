// What the server, the lobby UI and the sim agree on.

/** The sim's vehicles (VEHICLE_LIST in public/sim/engine.js), the first is the default. */
export const VEHICLES = [
  { key: 'buggy', name: 'Dune buggy', blurb: 'flat-four · 120 kW · 820 kg · long-travel' },
  { key: 'supra', name: 'Toyota GR Supra', blurb: '3.0 turbo I6 · 285 kW · RWD · 1,540 kg' },
  { key: 'x7', name: 'BMW X7 M60i', blurb: '4.4 twin-turbo V8 · 390 kW · AWD · 2,600 kg' },
  { key: 'rs6', name: 'Audi RS 6 Avant', blurb: '4.0 twin-turbo V8 · 441 kW · quattro · 2,075 kg' },
  { key: 'bmw7', name: 'BMW 760i xDrive', blurb: '4.4 twin-turbo V8 · 400 kW · xDrive · 2,345 kg' },
  { key: 'navigator', name: 'Lincoln Navigator', blurb: '3.5 twin-turbo V6 · 328 kW · 4x4 · 2,690 kg' },
  { key: 'cayenne', name: 'Porsche Cayenne S', blurb: '4.0 twin-turbo V8 · 349 kW · AWD · 2,160 kg' },
  { key: 'quattroporte', name: 'Maserati Quattroporte Trofeo', blurb: '3.8 twin-turbo V8 · 427 kW · RWD · 2,127 kg' },
];
export const VEHICLE_KEYS = VEHICLES.map(v => v.key);

/** The sim's paint presets (PAINTS in engine.js). */
export const PAINTS = [
  ['Red', '#b3090f'], ['Orange', '#d9360b'], ['Yellow', '#e0b010'], ['Green', '#1d4032'], ['Lime', '#6fae1c'], ['Blue', '#12307a'],
  ['Sky blue', '#4a90c8'], ['Purple', '#4b1f6f'], ['White', '#eeeeea'], ['Silver', '#9a9da1'], ['Grey', '#3a3d42'], ['Black', '#0c0c0e'],
];

export const GROUNDS = [
  { key: 'sand', name: 'Sand', blurb: 'soft, deep ruts' },
  { key: 'earth', name: 'Earth', blurb: 'firm and grippy' },
  { key: 'road', name: 'Road', blurb: 'asphalt through the dunes' },
];
export const GROUND_KEYS = GROUNDS.map(g => g.key);

export const LIMITS = {
  maxPlayers: 8,
  minLaps: 1,
  maxLaps: 10,
  defaultLaps: 3,
  /** ms from Start to green */
  countdownMs: 5000,
  /** after the first car finishes, the others have this long */
  finishWindowMs: 60_000,
  /** a race that runs this long ends anyway */
  maxRaceMs: 20 * 60_000,
  /** seconds added per gate missed */
  missedGatePenalty: 5,
  /** a dropped connection keeps its seat this long */
  seatGraceMs: 20_000,
  /** position broadcast period */
  tickMs: 50,
};

export const isHex = s => typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s);
