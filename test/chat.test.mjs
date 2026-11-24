// The chat (#325): the rooms' side in the race server (lib/race/hub.mjs), the main room and the mutes in Postgres
// (lib/race/chat.mjs).
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { RaceHub } from '../lib/race/hub.mjs';
import { CHAT_LIMITS, ChatStore, cleanText } from '../lib/race/chat.mjs';
import { testDb } from './db.mjs';

const T = await testDb();
beforeEach(() => T.reset());
after(() => T.drop());

function setup(chat) {
  let t = 1_000_000;
  const hub = new RaceHub({ now: () => t, random: () => 0.5, chat });
  const connect = (id, name = id, admin = false) => {
    const inbox = [];
    const h = hub.connect({ id, name, admin }, m => inbox.push(m));
    return { ...h, inbox, last: type => inbox.filter(m => m.t === type).at(-1), all: type => inbox.filter(m => m.t === type) };
  };
  return { hub, connect, advance: ms => { t += ms; hub.tick(); } };
}

test('a message: no control characters, one line, at most maxChars characters', () => {
  assert.equal(cleanText('  hi\n\tthere\u0007 '), 'hi there');
  assert.equal(cleanText(' \n '), null);
  assert.equal(cleanText(42), null);
  assert.equal(cleanText('👍'.repeat(CHAT_LIMITS.maxChars + 3)), '👍'.repeat(CHAT_LIMITS.maxChars));   // characters, not UTF-16 units
  assert.equal(cleanText('a‮b'), 'ab');                                                       // no text direction tricks
});

test('the main room is everyone connected; a race room is its drivers', () => {
  const { connect } = setup();
  const a = connect('a', 'Ann'), b = connect('b', 'Bob'), c = connect('c', 'Cy');
  a.message({ t: 'chat', ch: 'main', text: 'hello all' });
  for (const x of [a, b, c]) assert.deepEqual(x.last('chat').msgs.map(m => [m.name, m.text]), [['Ann', 'hello all']]);
  // a newcomer gets the main room so far
  const d = connect('d');
  assert.deepEqual(d.last('chat'), { t: 'chat', ch: 'main', all: true, msgs: [a.last('chat').msgs[0]] });
  // a race room's chat
  a.message({ t: 'create', name: 'R' }); const id = a.last('room').room.id;
  assert.deepEqual(a.last('chat'), { t: 'chat', ch: 'room', all: true, msgs: [] });
  b.message({ t: 'join', room: id });
  b.message({ t: 'chat', ch: 'room', text: 'gl hf' });
  assert.equal(a.last('chat').ch, 'room'); assert.equal(a.last('chat').msgs[0].text, 'gl hf');
  assert.equal(c.last('chat').ch, 'main');                          // not in the room: doesn't hear it
  c.message({ t: 'chat', ch: 'room', text: 'let me in' });           // not in a room: nothing
  assert.equal(a.last('chat').msgs[0].text, 'gl hf');
  // a late joiner reads the room's chat so far; the main room still reaches the drivers in rooms
  c.message({ t: 'join', room: id });
  assert.deepEqual(c.last('chat').msgs.map(m => m.text), ['gl hf']);
  d.message({ t: 'chat', ch: 'main', text: 'anyone racing?' });
  assert.equal(b.last('chat').msgs[0].text, 'anyone racing?');
  // the room's chat goes with the room
  for (const x of [a, b, c]) x.message({ t: 'leave' });
  a.message({ t: 'create', name: 'R2' });
  assert.deepEqual(a.last('chat').msgs, []);
});

test('too fast, and muted, is refused; the admin deletes and mutes', () => {
  const { connect, advance } = setup();
  const a = connect('a', 'Ann'), adm = connect('z', 'Admin', true);
  assert.deepEqual(adm.last('chatMutes').list, []);                 // the admin hears of the mutes, the others don't
  assert.equal(a.last('chatMutes'), undefined);
  assert.equal(a.last('hello').me.admin, undefined); assert.equal(adm.last('hello').me.admin, true);
  for (let i = 0; i < CHAT_LIMITS.burst + 2; i++) a.message({ t: 'chat', ch: 'main', text: `m${i}` });
  assert.equal(adm.all('chat').length - 1, CHAT_LIMITS.burst);      // (the first: the main room as it was)
  assert.equal(a.last('error').code, 'chat-rate');
  advance(1000 / CHAT_LIMITS.perSec);
  a.message({ t: 'chat', ch: 'main', text: 'again' });
  assert.equal(adm.last('chat').msgs[0].text, 'again');
  // only the admin deletes
  const id = adm.last('chat').msgs[0].id;
  a.message({ t: 'chatDel', ch: 'main', id });
  assert.equal(a.last('chatDel'), undefined);
  adm.message({ t: 'chatDel', ch: 'main', id });
  assert.deepEqual(a.last('chatDel'), { t: 'chatDel', ch: 'main', id });
  assert.ok(!connect('n').last('chat').msgs.some(m => m.id === id));
  // and mutes, for a day by default; a muted driver is told until when
  a.message({ t: 'chatMute', id: 'z', name: 'Admin' });                // (not the others)
  assert.deepEqual(adm.last('chatMutes').list, []);
  adm.message({ t: 'chatMute', id: 'a', name: 'Ann' });
  assert.deepEqual(adm.last('chatMutes').list.map(m => [m.id, m.name, m.until]), [['a', 'Ann', 1_000_000 + 1000 / CHAT_LIMITS.perSec + 24 * 3600_000]]);
  advance(60_000);
  a.message({ t: 'chat', ch: 'main', text: 'hey' });
  assert.equal(a.last('error').code, 'chat-muted');
  adm.message({ t: 'chatMute', id: 'a', hours: 0 });
  assert.deepEqual(adm.last('chatMutes').list, []);
  a.message({ t: 'chat', ch: 'main', text: 'thanks' });
  assert.equal(adm.last('chat').msgs[0].text, 'thanks');
  // in a race room: the admin deletes there
  a.message({ t: 'create' }); adm.message({ t: 'join', room: a.last('room').room.id });
  advance(10_000);
  a.message({ t: 'chat', ch: 'room', text: 'oops' });
  adm.message({ t: 'chatDel', ch: 'room', id: a.last('chat').msgs[0].id });
  assert.equal(a.last('chatDel').ch, 'room');
});

test('the main room and the mutes are kept in the database, for the next server', async () => {
  let t = 1_700_000_000_000;
  const s1 = await new ChatStore(T.db, { now: () => t }).load();
  const ms = [];
  for (let i = 0; i < CHAT_LIMITS.keep + 30; i++) { t += 10; ms.push(s1.addMain(s1.message({ id: `u${i % 3}`, name: `U${i % 3}`, image: i % 3 ? null : 'https://x/i.png' }, `#${i}`))); }
  s1.removeMain(ms.at(-1).id);
  s1.mute({ id: 'u1', name: 'U1' }, 2, 'admin');
  s1.mute({ id: 'u2', name: 'U2' }, 1, 'admin'); s1.mute({ id: 'u2', name: 'U2' }, 0, 'admin');
  await s1.flush();
  const s2 = await new ChatStore(T.db, { now: () => t }).load();
  // the last `keep` as they were, but the one deleted (so one older one comes back)
  assert.equal(s2.main.length, CHAT_LIMITS.keep);
  assert.deepEqual(s2.main.slice(1), s1.main);
  assert.deepEqual(s2.main.at(-1).text, `#${CHAT_LIMITS.keep + 28}`);
  assert.deepEqual(s2.muteList().map(m => [m.id, m.until]), [['u1', t + 2 * 3600_000]]);
  const { rows } = await T.db.pool.query('select count(*)::int as n from chat_messages');
  assert.ok(rows[0].n <= CHAT_LIMITS.keep + 25);                            // older ones pruned now and then
  // a mute that is over is no more
  t += 3 * 3600_000;
  const s3 = await new ChatStore(T.db, { now: () => t }).load();
  assert.deepEqual(s3.muteList(), []);
});
