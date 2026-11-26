import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Bridge, BridgeError, BRIDGE_LIMITS, bridgeAgentKey, bridgeCode, bridgeOn } from '../lib/bridge/store.mjs';
import { MCP_TOOLS, mcpHandle, mcpSession } from '../lib/bridge/mcp.mjs';
import fs from 'node:fs';

test('bridge: a page pairs, an agent claims its code, commands go down the stream and come back answered', async () => {
  let t = 1000;
  const b = new Bridge({ now: () => t });
  const { pageId, pageToken, code } = b.pair('google:admin');
  assert.match(code, /^[2-9A-HJ-NP-Z]{8}$/);                             // (#355: 40 bits, none of 0 1 I O)
  const sent = [];
  b.attach(pageId, pageToken, (event, data) => sent.push([event, data]));
  assert.equal(sent[0][0], 'status'); assert.equal(sent[0][1].code, code);
  assert.throws(() => b.claim('00000000', 'X'), BridgeError);                         // (never a code: no 0 in one)
  const { agentToken } = b.claim(`${code.slice(0, 4).toLowerCase()}-${code.slice(4)} `, 'Claude');   // (as shown, or typed in small letters)
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

test('bridge: on everywhere (for every signed-in driver, #355) unless CLAUDE_BRIDGE=off (#338, #346)', () => {
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
  const wrong = code.slice(1) + (code[0] === 'A' ? 'B' : 'A');
  for (let i = 0; i < BRIDGE_LIMITS.misses; i++) assert.throws(() => b.claim(wrong, 'x', '10.0.0.1'), e => e.status === 404);
  assert.throws(() => b.claim(code, 'x', '10.0.0.1'), e => e.status === 429);      // even the right one, while they last
  // (#355) ... from that caller: a stranger's guesses don't lock the driver's own agent out
  const mine = b.claim(code, 'Mine', '10.0.0.2');
  assert.ok(mine.agentToken);
  t += BRIDGE_LIMITS.codeMs + 1;
  const again = b.pair('google:admin');
  assert.ok(b.claim(again.code, 'Claude', '10.0.0.1').agentToken);
  // everyone's wrong codes together have a limit too
  const c = new Bridge({ now: () => t }), { code: c1 } = c.pair('u');
  for (let i = 0; i < BRIDGE_LIMITS.missesAll; i++) assert.throws(() => c.claim('ZZZZZZZZ', 'x', 'caller' + i), e => e.status === 404 || c1 === 'ZZZZZZZZ');
  assert.throws(() => c.claim(c1, 'x', 'someone else'), e => e.status === 429);
});

test('bridge: for every driver, each for their own pages (#355)', () => {
  let t = 1000;
  const key = 'k'.repeat(30), b = new Bridge({ now: () => t, key });
  assert.throws(() => b.pair(''), e => e.status === 403);                              // no session, no pairing
  const ann = b.pair('google:ann'), bob = b.pair('guest:bob');
  // a pairing is its user's: another signed-in driver with its id and token (somehow) still isn't let in
  assert.throws(() => b.attach(ann.pageId, ann.pageToken, () => {}, 'guest:bob'), e => e.status === 404);
  assert.throws(() => b.message(ann.pageId, ann.pageToken, 'hi', 'guest:bob'), e => e.status === 404);
  assert.throws(() => b.close(ann.pageId, ann.pageToken, 'guest:bob'), e => e.status === 404);
  b.attach(ann.pageId, ann.pageToken, () => {}, 'google:ann'); b.attach(bob.pageId, bob.pageToken, () => {}, 'guest:bob');
  // an agent has the page whose code it claimed, and only that one
  const a1 = b.claim(ann.code, 'A'), a2 = b.claim(bob.code, 'B');
  assert.equal(a1.pageId, ann.pageId); assert.equal(a2.pageId, bob.pageId);
  assert.notEqual(a1.agentToken, a2.agentToken);
  // the server's agent key is the super admin's: it never lists or takes another driver's page, standing or not
  assert.deepEqual(b.list(key), []);
  assert.throws(() => b.take(key, '', 'Claude'), e => e.status === 404);
  assert.throws(() => b.take(key, ann.pageId, 'Claude'), e => e.status === 404);
  const guest = b.pair('guest:eve', { standing: true });                              // (asked for by a page that isn't the admin's: not given)
  b.attach(guest.pageId, guest.pageToken, () => {}, 'guest:eve');
  assert.deepEqual(b.list(key), []);
  const adm = b.pair('google:admin', { standing: true, admin: true });
  b.attach(adm.pageId, adm.pageToken, () => {}, 'google:admin');
  assert.deepEqual(b.list(key).map(p => [p.pageId, p.standing]), [[adm.pageId, true]]);
  assert.equal(b.take(key, '', 'Claude').pageId, adm.pageId);
  // a driver has a few pairings: one more ends the one unused the longest (and its agent's token)
  const many = []; for (let i = 0; i < BRIDGE_LIMITS.perUser; i++) { t += 10; many.push(b.pair('google:zed')); }
  const z0 = b.claim(many[0].code, 'Z');
  t += 10; b.pair('google:zed');
  assert.throws(() => b.status(z0.agentToken), e => e.status === 401);
  assert.equal(b.status(a1.agentToken).page.connected, true);                         // (the others' are untouched)
  // (not the super admin's: their tabs pair by themselves, each with its own)
  const tabs = []; for (let i = 0; i < BRIDGE_LIMITS.perUser + 3; i++) tabs.push(b.pair('google:admin', { standing: true, admin: true }));
  assert.equal(b.list(key).filter(p => tabs.some(q => q.pageId === p.pageId)).length, tabs.length);
  // an agent's name is text
  const n = b.pair('u2'); b.attach(n.pageId, n.pageToken, () => {}, 'u2');
  const sent = []; b.attach(n.pageId, n.pageToken, (e, d) => sent.push(d), 'u2');
  b.claim(n.code, '<img src=x onerror=alert(1)>');
  assert.equal(sent.at(-1).agent, 'img srcx onerroralert(1)');
  assert.equal(bridgeCode(' k7qf-2m9x '), 'K7QF2M9X');
});

const rpc = (method, params, id = 1) => ({ jsonrpc: '2.0', id, method, params });
test('mcp: an agent initializes, pairs with a code and works in that page, over /api/mcp (#355)', async () => {
  globalThis.__carsimBridge = undefined;
  const env = { ...process.env }; delete process.env.DATABASE_URL; delete process.env.CLAUDE_BRIDGE; delete process.env.CLAUDE_BRIDGE_AGENT_KEY;
  try {
    const { bridge } = await import('../lib/bridge/store.mjs'), b = bridge();
    const init = await mcpHandle(rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } }));
    assert.equal(init.answer.result.protocolVersion, '2025-03-26'); assert.match(init.session, /^[A-Za-z0-9_-]{32}$/);
    assert.match(init.answer.result.instructions, /sim_pair/);
    assert.equal((await mcpHandle(rpc('initialize', { protocolVersion: '1999-01-01' }))).answer.result.protocolVersion, '2025-06-18');
    assert.equal((await mcpHandle({ jsonrpc: '2.0', method: 'notifications/initialized' })).answer, null);
    assert.equal((await mcpHandle(rpc('nope'))).answer.error.code, -32601);
    assert.equal((await mcpHandle('x')).answer.error.code, -32600);
    const tools = (await mcpHandle(rpc('tools/list'))).answer.result.tools;
    assert.deepEqual(tools.map(t => t.name), Object.keys(MCP_TOOLS));
    // the same tools as the stdio server's (scripts/bridge-mcp.mjs, which the site also serves for download)
    const stdio = fs.readFileSync(new URL('../scripts/bridge-mcp.mjs', import.meta.url), 'utf8');
    assert.deepEqual([...stdio.matchAll(/^  (sim_\w+): \{/gm)].map(m => m[1]).sort(), Object.keys(MCP_TOOLS).sort());
    const call = async (name, args, ctx) => (await mcpHandle(rpc('tools/call', { name, arguments: args }), ctx)).answer.result;
    const S = { session: init.session, who: '10.1.1.1' }, other = { session: mcpSession(), who: '10.1.1.2' };
    // not paired: told how; a wrong code: said so; no session: said so
    assert.match((await call('sim_state', {}, S)).content[0].text, /Not paired yet/);
    const page = b.pair('guest:driver'), sent = [];
    b.attach(page.pageId, page.pageToken, (e, d) => { sent.push([e, d]); if (e === 'command') queueMicrotask(() => b.result(page.pageId, page.pageToken, { id: d.id, ok: d.type !== 'bad', data: { did: d.type, args: d.args }, error: 'no such command' })); }, 'guest:driver');
    assert.equal((await call('sim_pair', { code: 'ZZZZ-ZZZZ' }, S)).isError, true);
    assert.equal((await call('sim_pair', { code: page.code }, { who: 'x' })).isError, true);
    const paired = await call('sim_pair', { code: page.code, name: 'Other agent' }, S);
    assert.match(paired.content[0].text, /Paired with page/); assert.equal(sent.at(-1)[1].agent, 'Other agent');
    // its session works in that page; another session doesn't
    assert.deepEqual(JSON.parse((await call('sim_command', { type: 'click', args: { text: 'Train' } }, S)).content[0].text), { did: 'click', args: { text: 'Train' } });
    assert.equal(JSON.parse((await call('sim_state', {}, S)).content[0].text).did, 'state');
    assert.equal((await call('sim_command', { type: 'bad' }, S)).isError, true);
    assert.match((await call('sim_state', {}, other)).content[0].text, /Not paired yet/);
    assert.equal((await call('sim_pair', { code: page.code }, other)).isError, true);           // a code works once
    // what the driver writes comes with the next answer, once; sim_events gives the rest
    b.message(page.pageId, page.pageToken, 'slow down', 'guest:driver');
    const st = await call('sim_status', {}, S);
    assert.match(st.content.at(-1).text, /slow down/);
    assert.equal((await call('sim_events', {}, S)).content[0].text, '(nothing new)');
    b.message(page.pageId, page.pageToken, 'again', 'guest:driver');
    assert.match((await call('sim_events', {}, S)).content[0].text, /again/);
    // a restart: the session is kept with the pairing
    assert.equal(b.kept().find(p => p.pageId === page.pageId).mcp, init.session);
    // the driver disconnects: the session has nothing
    b.close(page.pageId, page.pageToken, 'guest:driver');
    assert.match((await call('sim_state', {}, S)).content[0].text, /Not paired yet/);
  } finally { Object.assign(process.env, env); globalThis.__carsimBridge = undefined; }
});

test('bridge: an agent with the server\'s key takes a page without a code (#348)', () => {
  let t = 1000;
  const key = 'k'.repeat(30), b = new Bridge({ now: () => t, key });
  assert.throws(() => new Bridge({ now: () => t }).list(key), e => e.status === 404);   // no key on the server: no keyed agents
  assert.throws(() => b.list('wrong'), e => e.status === 403);
  assert.throws(() => b.take(key, '', 'Claude'), e => e.status === 404);              // no page open
  const one = b.pair('google:admin', { standing: true, admin: true }); t += 10;
  const two = b.pair('google:admin', { admin: true });
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
