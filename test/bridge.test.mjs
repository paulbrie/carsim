import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Bridge, BridgeError, BRIDGE_LIMITS } from '../lib/bridge/store.mjs';

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
