import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Bridge, BridgeError, BRIDGE_LIMITS, bridgeAgentKey, bridgeOn } from '../lib/bridge/store.mjs';

test('bridge: a page pairs, an agent claims its code, commands go down the stream and come back answered', async () => {
  let t = 1000;
  const b = new Bridge({ now: () => t });
  const { pageId, pageToken, code } = b.pair('google:admin');
  assert.match(code, /^\d{6}$/);
  const sent = [];
  b.attach(pageId, pageToken, (event, data) => sent.push([event, data]));
  assert.equal(sent[0][0], 'status'); assert.equal(sent[0][1].code, code);
  assert.throws(() => b.claim('000000', 'X'), BridgeError);                           // (unless that is the code: 1 in a million)
  const { agentToken } = b.claim(code, 'Claude');
  assert.equal(sent.at(-1)[1].agent, 'Claude');
  assert.throws(() => b.claim(code, 'Other'), e => e.status === 404);                  // a code works once
  assert.throws(() => b.command('nope', { type: 'state' }), e => e.status === 401);
  const p = b.command(agentToken, { type: 'state', args: { a: 1 } });
  const [ev, cmd] = sent.at(-1);
  assert.equal(ev, 'command'); assert.deepEqual(cmd.args, { a: 1 }); assert.equal(cmd.agent, 'Claude');
  assert.equal(b.result(pageId, pageToken, { id: cmd.id, ok: true, data: { x: 2 } }), true);
  assert.deepEqual(await p, { ok: true, data: { x: 2 } });
  assert.throws(() => b.result(pageId, 'wrong', { id: cmd.id, ok: true }), e => e.status === 404);
  // the user writes; the agent reads, waiting if need be
  b.message(pageId, pageToken, 'hello');
  const ev1 = await b.events(agentToken, 0, 0);
  assert.deepEqual(ev1.events.map(e => e.text), ['hello']);
  const later = b.events(agentToken, ev1.seq, 5000);
  b.message(pageId, pageToken, 'again');
  assert.deepEqual((await later).events.map(e => e.text), ['again']);
  // the page goes: commands are refused; the user disconnects: the agent's token ends
  const detach = b.attach(pageId, pageToken, () => {}); detach();
  assert.throws(() => b.command(agentToken, { type: 'state' }), e => e.status === 409);
  b.close(pageId, pageToken);
  assert.throws(() => b.status(agentToken), e => e.status === 401);
});

test('bridge: codes expire, bad commands are refused, idle pairings end', async () => {
  let t = 1000;
  const b = new Bridge({ now: () => t });
  const a = b.pair('u');
  t += BRIDGE_LIMITS.codeMs + 1;
  assert.throws(() => b.claim(a.code, 'C'), e => e.status === 410);
  const p = b.pair('u'); b.attach(p.pageId, p.pageToken, () => {});
  const { agentToken } = b.claim(p.code, 'C');
  assert.throws(() => b.command(agentToken, { type: 'Bad Type!' }), e => e.status === 400);
  t += BRIDGE_LIMITS.idleMs + 1;
  b.pair('u');                                                                           // (sweeps)
  assert.throws(() => b.status(agentToken), e => e.status === 401);
});

test('bridge: on everywhere (the super admin only) unless CLAUDE_BRIDGE=off (#338, #346)', () => {
  assert.equal(bridgeOn({ NODE_ENV: 'development' }), true);
  assert.equal(bridgeOn({}), true);
  assert.equal(bridgeOn({ NODE_ENV: 'production' }), true);             // #346: the super admin has it on the deployed site
  assert.equal(bridgeOn({ NODE_ENV: 'production', CLAUDE_BRIDGE: 'off' }), false);
  assert.equal(bridgeOn({ NODE_ENV: 'development', CLAUDE_BRIDGE: 'off' }), false);
});

test('bridge: wrong codes are limited, so a code can\'t be guessed', () => {
  let t = 1000;
  const b = new Bridge({ now: () => t });
  const { code } = b.pair('google:admin');
  const wrong = String((Number(code) + 1) % 1e6).padStart(6, '0');
  for (let i = 0; i < BRIDGE_LIMITS.misses; i++) assert.throws(() => b.claim(wrong, 'x'), e => e.status === 404);
  assert.throws(() => b.claim(code, 'x'), e => e.status === 429);      // even the right one, while they last
  t += BRIDGE_LIMITS.codeMs + 1;
  const again = b.pair('google:admin');
  assert.ok(b.claim(again.code, 'Claude').agentToken);
});

test('bridge: an agent with the server\'s key takes a page without a code (#348)', () => {
  let t = 1000;
  const key = 'k'.repeat(30), b = new Bridge({ now: () => t, key });
  assert.throws(() => new Bridge({ now: () => t }).list(key), e => e.status === 404);   // no key on the server: no keyed agents
  assert.throws(() => b.list('wrong'), e => e.status === 403);
  assert.throws(() => b.take(key, '', 'Claude'), e => e.status === 404);              // no page open
  const one = b.pair('google:admin', { standing: true }); t += 10;
  const two = b.pair('google:admin');
  b.attach(one.pageId, one.pageToken, () => {});                                     // only the first is connected
  const row = id => b.list(key).find(p => p.pageId === id);
  assert.deepEqual([row(one.pageId).connected, row(one.pageId).standing, row(two.pageId).connected, row(two.pageId).standing], [true, true, false, false]);
  const sent = [];
  b.attach(one.pageId, one.pageToken, (e, d) => sent.push([e, d]));
  const got = b.take(key, '', 'Claude');                                             // the newest connected one
  assert.equal(got.pageId, one.pageId);
  assert.equal(sent.at(-1)[1].agent, 'Claude'); assert.equal(sent.at(-1)[1].code, null);
  const again = b.take(key, one.pageId, 'Claude 2');                                 // taken again: the first token is dropped
  assert.throws(() => b.status(got.agentToken), e => e.status === 401);
  assert.equal(b.status(again.agentToken).page.connected, true);
  assert.equal(bridgeAgentKey({ CLAUDE_BRIDGE_AGENT_KEY: 'short' }), '');            // too short to count
  assert.equal(bridgeAgentKey({ CLAUDE_BRIDGE_AGENT_KEY: key }), key);
});

test('bridge: pairings are kept, and a new server (a restart, a deploy) carries on with them (#348)', async () => {
  let saved = [];
  const keeper = { load: async () => saved, save: async l => { saved = JSON.parse(JSON.stringify(l)); } };
  const a = new Bridge({ keeper }); await a.ready;
  const { pageId, pageToken, code } = a.pair('google:admin');
  const { agentToken } = a.claim(code, 'Claude');
  await new Promise(r => setTimeout(r, 300));                                         // (kept a moment later)
  assert.equal(saved.length, 1); assert.equal(saved[0].pageToken, pageToken); assert.equal('waiting' in saved[0], false);
  const b = new Bridge({ keeper }); await b.ready;                                    // the server again
  const sent = [];
  b.attach(pageId, pageToken, (e, d) => sent.push([e, d]));                          // the page's stream reconnects
  assert.equal(sent[0][1].agent, 'Claude');
  const p = b.command(agentToken, { type: 'state' });                                // and the agent's token still works
  b.result(pageId, pageToken, { id: sent.at(-1)[1].id, ok: true, data: 1 });
  assert.deepEqual(await p, { ok: true, data: 1 });
  b.close(pageId, pageToken);
  await new Promise(r => setTimeout(r, 300));
  assert.deepEqual(saved, []);
});
