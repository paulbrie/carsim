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
  b.message({ t: 'car', vehicle: 'tank', paint: 'red' });             // ignored
  assert.equal(a.last('room').room.players.find(p => p.id === 'b').vehicle, 'rs6');
  b.message({ t: 'join', room: 'NOPE1' });
  assert.equal(b.last('error').code, 'no-room');
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
  b.message({ t: 's', p: [4, 5, 6], q: [0, 0, 0, 1], v: 9, st: 0, sp: 3, prog: 80, lap: 1 });
  advance(LIMITS.tickMs);
  const snap = a.last('snap');
  assert.deepEqual(snap.cars.map(c => c[0]).sort(), ['a', 'b']);
  assert.deepEqual(snap.cars.find(c => c[0] === 'b').slice(1, 4), [4, 5, 6]);
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
