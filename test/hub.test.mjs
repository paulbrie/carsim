import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RaceHub } from '../lib/race/hub.mjs';
import { LIMITS } from '../lib/race/shared.mjs';

function setup() {
  let t = 1_000_000;
  const hub = new RaceHub({ now: () => t, random: () => 0.5 });
  const connect = (id, name = id) => {
    const inbox = [];
    const h = hub.connect({ id, name }, m => inbox.push(m));
    return { ...h, inbox, last: type => inbox.filter(m => m.t === type).at(-1), all: type => inbox.filter(m => m.t === type) };
  };
  return { hub, connect, advance: ms => { t += ms; hub.tick(); }, now: () => t };
}

test('create, join, ready and the room list', () => {
  const { hub, connect } = setup();
  const a = connect('a', 'Ann'), b = connect('b', 'Bob');
  assert.equal(a.last('hello').me.name, 'Ann');
  a.message({ t: 'create', name: 'Dunes', ground: 'earth', laps: 2 });
  const room = a.last('room').room;
  assert.equal(room.name, 'Dunes'); assert.equal(room.ground, 'earth'); assert.equal(room.laps, 2); assert.equal(room.hostId, 'a');
  hub.tick();
  assert.equal(b.last('rooms').rooms[0].id, room.id);          // the lobby hears of it
  b.message({ t: 'join', room: room.id.toLowerCase() });
  const r2 = b.last('room').room;
  assert.equal(r2.players.length, 2);
  assert.notEqual(r2.players[0].vehicle, r2.players[1].vehicle);   // a free car each
  b.message({ t: 'car', vehicle: 'rs6', paint: '#4A90C8' });
  const bp = a.last('room').room.players.find(p => p.id === 'b');
  assert.equal(bp.vehicle, 'rs6'); assert.equal(bp.paint, '#4a90c8');
  b.message({ t: 'car', vehicle: 'tank', paint: 'red' });             // refused, and told so
  assert.equal(a.last('room').room.players.find(p => p.id === 'b').vehicle, 'rs6');
  assert.equal(b.last('error').code, 'no-car');
  b.message({ t: 'car', paint: '#101010' });                          // a colour alone is no refused car
  assert.equal(b.all('error').length, 1);
  assert.equal(a.last('room').room.players.find(p => p.id === 'b').paint, '#101010');
  b.message({ t: 'join', room: 'NOPE1' });
  assert.equal(b.last('error').code, 'no-room');
});

test('a car added while the server runs can be picked (setLists)', () => {
  const { hub, connect } = setup();
  const a = connect('a', 'Ann');
  a.message({ t: 'create' });
  const car = () => a.last('room').room.players[0].vehicle, first = car();
  a.message({ t: 'car', vehicle: 'tank' });
  assert.equal(car(), first); assert.equal(a.last('error').code, 'no-car');
  hub.setLists({ vehicles: [...hub.lists.vehicles, 'tank'], grounds: [], weathers: 'storm' });   // bad lists are left alone
  a.message({ t: 'car', vehicle: 'tank' });
  assert.equal(car(), 'tank'); assert.equal(a.all('error').length, 1);
  a.message({ t: 'settings', ground: 'earth', weather: 'clear' });
  assert.equal(a.last('room').room.ground, 'earth');
  assert.equal(new RaceHub().lists.vehicles.includes('tank'), false);   // another hub's lists are its own
});

test('only the host starts, once the others are ready', () => {
  const { connect } = setup();
  const a = connect('a'), b = connect('b');
  a.message({ t: 'create' }); const id = a.last('room').room.id;
  b.message({ t: 'join', room: id });
  b.message({ t: 'start' });
  assert.equal(a.last('room').room.phase, 'lobby');
  a.message({ t: 'start' });
  assert.equal(a.last('error').code, 'not-ready');
  b.message({ t: 'ready', ready: true });
  a.message({ t: 'start' });
  const room = a.last('room').room;
  assert.equal(room.phase, 'countdown'); assert.equal(room.startsIn, LIMITS.countdownMs);
  assert.deepEqual(room.players.map(p => p.slot), [0, 1]);
});

test('a race: countdown, positions, laps, finish, results, again', () => {
  const { connect, advance } = setup();
  const a = connect('a'), b = connect('b');
  a.message({ t: 'create', laps: 2 }); const id = a.last('room').room.id;
  b.message({ t: 'join', room: id }); b.message({ t: 'ready', ready: true });
  a.message({ t: 'start' });
  advance(LIMITS.countdownMs);
  assert.equal(a.last('room').room.phase, 'racing');

  a.message({ t: 's', p: [1, 2, 3], q: [0, 0, 0, 1], v: 10, st: 0.1, sp: 4, prog: 50, lap: 1 });
  b.message({ t: 's', p: [4, 5, 6], q: [0, 0, 0, 1], v: 9, st: 0, sp: 3, prog: 80, lap: 1, sk: 0x0f30 });
  advance(LIMITS.tickMs);
  const snap = a.last('snap');
  assert.deepEqual(snap.cars.map(c => c[0]).sort(), ['a', 'b']);
  assert.deepEqual(snap.cars.find(c => c[0] === 'b').slice(1, 4), [4, 5, 6]);
  assert.equal(snap.cars.find(c => c[0] === 'b')[11], 0x0f30);            // the skid marks (#306) go round as sent
  assert.equal(snap.cars.find(c => c[0] === 'a')[11], 0);                 // none sent: none
  for (let i = 0; i < 5; i++) advance(LIMITS.tickMs);
  assert.deepEqual(a.last('standings').standings.map(s => s.id), ['b', 'a']);   // b is further on

  b.message({ t: 'lap', lap: 1, time: 30.5, valid: true });
  advance(60_000);
  // 60.3 s since green on the server's clock
  b.message({ t: 'finish', time: 55, missed: 1 });          // too far from the server's: the server's counts
  const bres = a.last('room').room.players.find(p => p.id === 'b');
  assert.equal(bres.finish, 60.3); assert.equal(bres.missed, 1);
  a.message({ t: 'finish', time: 61.5, missed: 0 });        // close enough: its own clock counts
  const room = a.last('room').room;
  assert.equal(room.phase, 'results');
  // b: 60.3 + 5 s penalty = 65.3; a: 61.5
  assert.deepEqual(room.results.map(r => [r.id, r.pos, r.total]), [['a', 1, 61.5], ['b', 2, 65.3]]);
  assert.equal(room.results[1].gap, 3.8);

  b.message({ t: 'again' });                                // not the host
  assert.equal(a.last('room').room.phase, 'results');
  a.message({ t: 'again' });
  assert.equal(a.last('room').room.phase, 'lobby');
});

test('the finish window closes the race; leaving retires', () => {
  const { connect, advance } = setup();
  const a = connect('a'), b = connect('b'), c = connect('c');
  a.message({ t: 'create' }); const id = a.last('room').room.id;
  for (const x of [b, c]) { x.message({ t: 'join', room: id }); x.message({ t: 'ready', ready: true }); }
  a.message({ t: 'start' }); advance(LIMITS.countdownMs);
  c.message({ t: 'leave' });
  assert.equal(c.last('left').t, 'left');
  a.message({ t: 'finish', time: 0.1 });
  assert.equal(a.last('room').room.phase, 'racing');        // b is still out there
  advance(LIMITS.finishWindowMs);
  const room = a.last('room').room;
  assert.equal(room.phase, 'results');
  assert.deepEqual(room.results.map(r => [r.id, r.dnf, r.left]), [['a', false, false], ['b', true, false], ['c', true, true]]);
});

test('a dropped connection keeps its seat for a while; the host passes on', () => {
  const { hub, connect, advance } = setup();
  const a = connect('a'), b = connect('b');
  a.message({ t: 'create' }); const id = a.last('room').room.id;
  b.message({ t: 'join', room: id });
  a.close();
  assert.equal(b.last('room').room.players.find(p => p.id === 'a').connected, false);
  const a2 = connect('a');                                  // back within the grace period
  a2.message({ t: 'join', room: id });
  assert.equal(a2.last('room').room.hostId, 'a');
  a2.close();
  advance(LIMITS.seatGraceMs);
  const room = b.last('room').room;
  assert.deepEqual(room.players.map(p => p.id), ['b']); assert.equal(room.hostId, 'b');
  b.message({ t: 'leave' });
  assert.equal(hub.rooms.size, 0);
});

test('a second tab takes over the seat', () => {
  const { connect } = setup();
  const a = connect('a');
  a.message({ t: 'create' }); const id = a.last('room').room.id;
  const a2 = connect('a');
  assert.equal(a.last('replaced').t, 'replaced');
  a2.message({ t: 'join', room: id });
  assert.equal(a2.last('room').room.players.length, 1);
  a.message({ t: 'start' });                                // the old tab is dead
  assert.equal(a2.last('room').room.phase, 'lobby');
});

test('car damage: hits relayed and kept, checked, rate-limited, cleared by a repair, given to a late joiner', () => {
  const { connect, advance } = setup();
  const a = connect('a'), b = connect('b');
  a.message({ t: 'create' }); const id = a.last('room').room.id;
  b.message({ t: 'join', room: id });
  assert.deepEqual(b.last('hits').all, {});                         // nobody dented yet
  const h = [1.2345, 0.5, 2.01, 0, 0, -1, 8.456, 2];
  a.message({ t: 'hit', h });
  const got = b.last('hit');
  assert.equal(got.id, 'a'); assert.deepEqual(got.h, [1.23, 0.5, 2.01, 0, 0, -1, 8.46, 2]);   // rounded as the sims do
  assert.equal(a.all('hit').length, 1);                              // the sender hears it too (its sim skips its own)
  for (const bad of [[1, 2, 3], [0, 0, 0, 0, 0, 0, 5, 1], [0, 0, 0, 1, 0, 0, 5, 7], [0, 0, 0, 1, 0, 0, NaN, 1], 'x', null]) a.message({ t: 'hit', h: bad });
  assert.equal(b.all('hit').length, 1);                              // none of those
  a.message({ t: 'hit', h: [99, -99, 0, 1, 0, 0, 500, 1] });
  assert.deepEqual(b.last('hit').h, [4, -2, 0, 1, 0, 0, 60, 1]);      // clamped to a car's size and a sane speed
  // a burst is cut off, then it refills
  for (let i = 0; i < 100; i++) a.message({ t: 'hit', h });
  const afterBurst = b.all('hit').length;
  assert.ok(afterBurst <= 2 + 40, `burst capped (${afterBurst})`);
  advance(1000);
  a.message({ t: 'hit', h });
  assert.equal(b.all('hit').length, afterBurst + 1);
  // a late joiner gets everyone's hits so far
  const c = connect('c');
  c.message({ t: 'join', room: id });
  assert.equal(c.last('hits').all.a.length, afterBurst + 1); assert.equal(c.last('hits').all.b, undefined);
  // a repair clears them, for everyone
  a.message({ t: 'repair' });
  assert.equal(b.last('repair').id, 'a'); assert.equal(c.last('repair').id, 'a');
  const n = c.all('repair').length; a.message({ t: 'repair' }); assert.equal(c.all('repair').length, n);   // nothing to clear: no message
  const d = connect('d'); d.message({ t: 'join', room: id });
  assert.deepEqual(d.last('hits').all, {});
  // not in a room: nothing
  const e = connect('e'); e.message({ t: 'hit', h }); assert.equal(e.all('hit').length, 0);
});

test('car damage: a player keeps at most HIT_LIMITS.perPlayer hits', async () => {
  const { HIT_LIMITS } = await import('../lib/race/hub.mjs');
  const { connect, advance } = setup();
  const a = connect('a'), b = connect('b');
  a.message({ t: 'create' }); b.message({ t: 'join', room: a.last('room').room.id });
  for (let i = 0; i < HIT_LIMITS.perPlayer + 50; i++) { a.message({ t: 'hit', h: [0, 0, 1, 0, 0, -1, 3, 1] }); advance(100); }
  assert.equal(b.all('hit').length, HIT_LIMITS.perPlayer);
});

test('the weather: picked when creating, changed by the host in the lobby only, checked', () => {
  const { connect } = setup();
  const a = connect('a'), b = connect('b');
  a.message({ t: 'create', weather: 'sunset' }); const id = a.last('room').room.id;
  assert.equal(a.last('room').room.weather, 'sunset');
  b.message({ t: 'join', room: id });
  b.message({ t: 'settings', weather: 'rain' });                      // not the host
  assert.equal(a.last('room').room.weather, 'sunset');
  a.message({ t: 'settings', weather: 'hail' });                      // no such weather
  assert.equal(a.last('room').room.weather, 'sunset');
  a.message({ t: 'settings', weather: 'rain' });
  assert.equal(b.last('room').room.weather, 'rain');
  const { connect: connect2 } = setup();                              // (a hub of its own: the test hub's room codes repeat)
  const c = connect2('c'); c.message({ t: 'create' }); assert.equal(c.last('room').room.weather, 'clear');
});

test('best laps: valid ones, per map, ground, car and driver, checked against the clock, to the room', async () => {
  const { connect, advance } = setup();
  const a = connect('a', 'Ann'), b = connect('b', 'Bob');
  a.message({ t: 'create', laps: 1 }); const id = a.last('room').room.id;
  assert.deepEqual(a.last('records'), { t: 'records', map: 'figure-8', v: 0, ground: 'sand', list: [] });   // on joining
  b.message({ t: 'join', room: id });
  a.message({ t: 'car', vehicle: 'rs6' });
  advance(40_000);
  a.message({ t: 'lap', lap: 1, time: 38.2, valid: false });            // invalid: no record
  assert.deepEqual(a.last('records').list, []);
  advance(37_000);
  a.message({ t: 'lap', lap: 2, time: 39, valid: true });                // longer than since the last lap: no
  assert.deepEqual(a.last('records').list, []);
  advance(36_000);
  a.message({ t: 'lap', lap: 3, time: 35.5, valid: true, splits: [null, 12.25, 99, 'x'] });   // driving around the room counts
  let rec = b.last('records').list;                                       // everyone in the room hears of it
  assert.deepEqual(rec.map(e => [e.id, e.name, e.vehicle, e.time]), [['a', 'Ann', 'rs6', 35.5]]);
  assert.deepEqual(rec[0].splits, [null, 12.25, null, null]);
  const n = b.all('records').length;
  advance(40_000);
  a.message({ t: 'lap', lap: 4, time: 36, valid: true });                // slower: kept as it was, nothing sent
  assert.equal(b.all('records').length, n);
  // another car is another record
  a.message({ t: 'car', vehicle: 'supra' });
  advance(34_000);
  a.message({ t: 'lap', lap: 5, time: 33, valid: true });
  assert.deepEqual(a.last('records').list.map(e => [e.vehicle, e.time]), [['supra', 33], ['rs6', 35.5]]);
  // a race lap counts, from green
  b.message({ t: 'ready', ready: true }); a.message({ t: 'start' });
  b.message({ t: 'lap', lap: 1, time: 1, valid: true });                 // on the grid: no
  advance(LIMITS.countdownMs + 31_000);
  b.message({ t: 'lap', lap: 1, time: 30.9, valid: true });
  assert.deepEqual(a.last('records').list.map(e => [e.id, e.time]), [['b', 30.9], ['a', 33], ['a', 35.5]]);
  // another ground has its own
  a.message({ t: 'finish', time: 31 }); b.message({ t: 'finish', time: 31 });
  a.message({ t: 'again' });
  a.message({ t: 'settings', ground: 'road' });
  assert.deepEqual(b.last('records'), { t: 'records', map: 'figure-8', v: 0, ground: 'road', list: [] });
  a.message({ t: 'settings', ground: 'sand' });
  assert.equal(b.last('records').list.length, 3);
});

test('best laps: an earlier layout\'s time shows without its splits', async () => {
  // (the records in memory here; kept in the database: test/records.test.mjs)
  const { RecordStore } = await import('../lib/race/records.mjs');
  const s = new RecordStore(null, { now: () => 5 });
  const lap = { map: 'm', mv: 2, ground: 'sand', vehicle: 'x7', user: { id: 'u', name: 'U' }, time: 40.1234, splits: [null, 20] };
  assert.equal(s.submit({ ...lap, time: 3 }), null);                     // too short to be a lap
  assert.equal(s.submit(lap).time, 40.123);
  assert.equal(s.submit({ ...lap, time: 41 }), null);
  assert.deepEqual(s.list('m', 'sand').map(r => [r.id, r.vehicle, r.time, r.mv]), [['u', 'x7', 40.123, 2]]);
  assert.deepEqual(s.list('m', 'road'), []);
  // in a room on version 3 of the map: the time, not its splits
  const { RaceHub } = await import('../lib/race/hub.mjs');
  const hub = new RaceHub({ records: s, maps: { info: id => id === 'm' || id === 'figure-8' ? { id, name: id, v: id === 'm' ? 3 : 0 } : null } });
  const inbox = []; const c = hub.connect({ id: 'u', name: 'U' }, m => inbox.push(m));
  c.message({ t: 'create', map: 'm' });
  const r = inbox.filter(m => m.t === 'records').at(-1);
  assert.equal(r.v, 3); assert.deepEqual(r.list.map(e => [e.time, e.mv, e.splits]), [[40.123, 2, []]]);
});

test('ghosts: a best lap\'s path kept with it, checked, given to who asks, only on the map as it is now', async () => {
  const { RecordStore, GHOST } = await import('../lib/race/records.mjs');
  const { RaceHub } = await import('../lib/race/hub.mjs');
  const trace = time => Buffer.alloc((Math.floor(time / GHOST.dt + 1e-6) + 1) * GHOST.fields * 2, 7).toString('base64');
  let t = 1_000_000, v = 1;
  const maps = { info: id => id === 'figure-8' ? { id, name: 'Figure-8', v } : null };
  const hub = new RaceHub({ now: () => t, records: new RecordStore(null, { now: () => t }), maps });
  const inbox = []; const c = hub.connect({ id: 'a', name: 'Ann' }, m => inbox.push(m));
  const last = type => inbox.filter(m => m.t === type).at(-1);
  // the path comes from the records' store: the answer follows the question
  const ghost = async vehicle => { const n = inbox.length; c.message({ t: 'ghost', id: 'a', vehicle }); await new Promise(r => setImmediate(r)); assert.equal(inbox.length, n + 1); return last('ghost'); };
  c.message({ t: 'create' });
  t += 31_000; c.message({ t: 'lap', lap: 1, time: 30, valid: true, trace: trace(30) });
  assert.equal(last('records').list[0].ghost, true);
  const vehicle = last('records').list[0].vehicle;
  let g = await ghost(vehicle);
  assert.equal(g.trace, trace(30)); assert.equal(g.name, 'Ann'); assert.equal(g.time, 30);
  // a path that doesn't cover the lap: the record, no ghost (and the old one goes)
  t += 30_000; c.message({ t: 'lap', lap: 2, time: 29, valid: true, trace: trace(20) });
  assert.deepEqual([last('records').list[0].time, last('records').list[0].ghost], [29, false]);
  assert.equal((await ghost(vehicle)).trace, null);
  t += 30_000; c.message({ t: 'lap', lap: 3, time: 28, valid: true, trace: 'not base64!' });
  assert.equal(last('records').list[0].ghost, false);
  t += 30_000; c.message({ t: 'lap', lap: 4, time: 27.5, valid: true, trace: trace(27.5) });
  assert.equal(last('records').list[0].ghost, true);
  assert.equal((await ghost('no-such-car')).trace, null);
  // the map edited: its old path doesn't fit any more
  v = 2; c.message({ t: 'start' }); t += LIMITS.countdownMs + 1000; hub.tick();
  assert.equal(last('records').v, 2); assert.equal(last('records').list[0].ghost, false);
  assert.equal((await ghost(vehicle)).trace, null);
  // a store that fails: no path, the room goes on
  hub.records.ghost = async () => { throw new Error('down'); };
  v = 1; c.message({ t: 'again' }); c.message({ t: 'start' });
  const warn = console.warn; console.warn = () => { };
  try { assert.equal((await ghost(vehicle)).trace, null); } finally { console.warn = warn; }
});
