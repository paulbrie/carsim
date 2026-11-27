// Agents' accounts and the networks they send in (docs/agents.md): an account in one call, a key that is the agent, a
// claim by its human owner, and the exam: the server times a network itself, in a process of its own, to the same
// number the simulator module gives anyone.
import { test, after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { testDb } from './db.mjs';
import { AgentStore, AgentError, AGENT_LIMITS, agentIdOf, agentName, claimCode, prettyCode } from '../lib/agents/store.mjs';
import { Exams, ExamError, EXAM_LIMITS, runExam } from '../lib/agents/exam.mjs';
import { AutopilotStore } from '../lib/autopilots/store.mjs';
import { Showcase, courseKey } from '../lib/showcase/store.mjs';
import { simModule } from '../lib/sim-module/serve.mjs';

const T = await testDb();
beforeEach(() => T.reset());
after(() => T.drop());
const root = new URL('..', import.meta.url).pathname;
const refused = status => e => e instanceof AgentError && e.status === status;
// a network made by hand: towards the racing line, no faster than 50 km/h or so (7 inputs, 2 outputs, no hidden layer)
const NET = { inputs: ['speed', 'line6', 'line15', 'line30', 'offset', 'yaw', 'pace'], h: 0, w: [0, -0.8, -2.2, 0, 0, 0, 0, -40, 0, 0, 0, 0, 0, 4, 0, 28] };

test('agents: an account in one call; the key is the agent; names are plain and nobody else\'s', async () => {
  let t = 1_000_000;
  const s = new AgentStore(T.db, { now: () => t, secret: 'x' });
  const { agent, key, claim } = await s.register({ name: '  Night \n Shift​ ', from: '1.2.3.4' });
  assert.equal(agent.name, 'Night Shift'); assert.match(agent.id, /^[a-z0-9]{12}$/); assert.equal(agent.uid, `agent:${agent.id}`);
  assert.equal(agent.claimed, false); assert.equal(agent.owner, null); assert.equal(agent.createdAt, t);
  assert.match(key, /^carsim_[A-Za-z0-9_-]{43}$/); assert.match(prettyCode(claim), /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
  assert.equal(agentIdOf(agent.uid), agent.id); assert.equal(agentIdOf('google:123'), null); assert.equal(agentIdOf('agent:../x'), null);
  // only hashes are kept
  const { rows: [row] } = await T.db.pool.query('select * from agents');
  assert.ok(!JSON.stringify(row).includes(key) && !JSON.stringify(row).includes(claim) && !JSON.stringify(row).includes('1.2.3.4'));
  // the key, and nothing like it
  assert.equal((await s.byKey(key)).id, agent.id);
  for (const bad of [key.slice(0, -1) + (key.endsWith('A') ? 'B' : 'A'), key.toUpperCase(), 'carsim_', '', null, { key }]) assert.equal(await s.byKey(bad), null);
  // seen: noted the first time, then again only after a while
  assert.equal((await s.get(agent.id)).seenAt, t);
  t += 60_000; await s.byKey(key); assert.equal((await s.get(agent.id)).seenAt, t - 60_000);
  t += AGENT_LIMITS.seenEveryMs; await s.byKey(key); assert.equal((await s.get(agent.id)).seenAt, t);
  // names
  await assert.rejects(s.register({ name: 'night shift', from: '5.6.7.8' }), e => refused(409)(e) && /already called/.test(e.message));
  for (const bad of ['', 'x', ' y ', 'z'.repeat(41), 42, null]) await assert.rejects(s.register({ name: bad, from: '5.6.7.8' }), refused(400));
  assert.equal(agentName('Ｆｕｌｌ　ｗｉｄｔｈ'), 'Full width');
  assert.equal((await s.register({ name: 'z'.repeat(40), from: '5.6.7.8' })).agent.name.length, 40);
});

test('agents: signing up is counted, for each address and for all', async () => {
  let t = 1_000_000;
  const s = new AgentStore(T.db, { now: () => t, secret: 'x' });
  for (let i = 0; i < AGENT_LIMITS.perAddress; i++) await s.register({ name: `Agent ${i}`, from: '1.2.3.4' });
  await assert.rejects(s.register({ name: 'One more', from: '1.2.3.4' }), e => refused(429)(e) && /from this address/.test(e.message));
  await s.register({ name: 'From elsewhere', from: '5.6.7.8' });
  t += AGENT_LIMITS.windowMs + 1;
  await s.register({ name: 'A day later', from: '1.2.3.4' });
  const was = AGENT_LIMITS.perDay;
  try { AGENT_LIMITS.perDay = 1; await assert.rejects(s.register({ name: 'Too many', from: '9.9.9.9' }), e => refused(429)(e) && /today/.test(e.message)); }
  finally { AGENT_LIMITS.perDay = was; }
});

test('agents: claimed once, by a signed-in person, with the code the agent was given', async () => {
  let t = 5_000_000;
  const s = new AgentStore(T.db, { now: () => t, secret: 'x' });
  const { agent, claim } = await s.register({ name: 'Night Shift', from: 'a' });
  const other = await s.register({ name: 'Day Shift', from: 'a' });
  assert.equal(claimCode(` ${prettyCode(claim).toLowerCase()} `), claim); assert.equal(claimCode('nope'), ''); assert.equal(claimCode(claim + 'A'), ''); assert.equal(claimCode(null), '');
  assert.equal((await s.waiting(prettyCode(claim))).id, agent.id); assert.equal(await s.waiting('AAAA-AAAA-AAAA'), null); assert.equal(await s.waiting(''), null);
  for (const bad of ['', 'AAAA-AAAA-AAAA', null]) await assert.rejects(s.claim(bad, { id: 'google:1', name: 'Ann' }), refused(404));
  await assert.rejects(s.claim(claim, { id: other.agent.uid, name: 'Day Shift' }), refused(403), 'an agent claims nobody');
  await assert.rejects(s.claim(claim, {}), refused(403));
  t += 1000;
  const mine = await s.claim(prettyCode(claim).toLowerCase(), { id: 'google:1', name: 'Ann Example' });
  assert.deepEqual([mine.id, mine.claimed, mine.owner, mine.ownerName, mine.claimedAt], [agent.id, true, 'google:1', 'Ann Example', t]);
  await assert.rejects(s.claim(claim, { id: 'google:2', name: 'Bob' }), refused(404), 'the code went with the claim');
  assert.equal(await s.waiting(claim), null);
  assert.deepEqual((await s.mine('google:1')).map(a => a.name), ['Night Shift']); assert.deepEqual(await s.mine('google:2'), []); assert.deepEqual(await s.mine(''), []);
  // a lost link: a new one, while nobody has claimed it; and only so many agents for one person
  await assert.rejects(s.newClaim(agent.id, { agent: agent.id }), refused(409));
  const again = await s.newClaim(other.agent.id, { agent: other.agent.id });
  await assert.rejects(s.claim(other.claim, { id: 'google:1', name: 'Ann' }), refused(404), 'the first code is dead');
  const was = AGENT_LIMITS.perOwner;
  try { AGENT_LIMITS.perOwner = 1; await assert.rejects(s.claim(again.claim, { id: 'google:1', name: 'Ann' }), refused(409)); }
  finally { AGENT_LIMITS.perOwner = was; }
  assert.equal((await s.claim(again.claim, { id: 'google:1', name: 'Ann' })).name, 'Day Shift');
});

test('agents: a new key and removal are the agent\'s own, its owner\'s, or the super admin\'s', async () => {
  const s = new AgentStore(T.db, { secret: 'x' }), nets = new AutopilotStore(T.db);
  const a = await s.register({ name: 'Night Shift', from: 'a' }), b = await s.register({ name: 'Day Shift', from: 'a' });
  await s.claim(a.claim, { id: 'google:1', name: 'Ann' });
  for (const by of [{ agent: b.agent.id }, { user: 'google:2' }, { user: null }, {}, null]) {
    await assert.rejects(s.newKey(a.agent.id, by), refused(403)); await assert.rejects(s.remove(a.agent.id, by), refused(403));
  }
  await assert.rejects(s.newKey(b.agent.id, { user: null }), refused(403), 'nobody\'s agent is not everybody\'s');
  await assert.rejects(s.newKey('nope', { admin: true }), refused(404));
  const k2 = (await s.newKey(a.agent.id, { user: 'google:1' })).key;
  assert.equal(await s.byKey(a.key), null, 'the old key is dead at once'); assert.equal((await s.byKey(k2)).id, a.agent.id);
  const k3 = (await s.newKey(a.agent.id, { agent: a.agent.id })).key;
  assert.equal(await s.byKey(k2), null); assert.equal((await s.byKey(k3)).id, a.agent.id);
  // removed with its networks, and only its own
  const file = { ...NET, kind: 'carsim-autopilot' };
  await nets.create({ name: 'A1', training: file, owner: a.agent.uid, ownerName: 'Night Shift', exam: { time: 44.9, laps: [{ time: 44.9, valid: true }] } });
  await nets.create({ name: 'B1', training: file, owner: b.agent.uid, ownerName: 'Day Shift', exam: { time: 50, laps: [] } });
  await nets.create({ name: 'Human', training: file, owner: 'google:1', ownerName: 'Ann' });
  await s.remove(a.agent.id, { user: 'google:1' });
  assert.equal(await s.get(a.agent.id), null); assert.equal(await s.byKey(k3), null);
  assert.deepEqual((await nets.list()).map(n => n.name).sort(), ['B1', 'Human']);
  await s.remove(b.agent.id, { user: 'google:9', admin: true });
  assert.deepEqual((await nets.list()).map(n => n.name), ['Human']);
});

test('agents: a network\'s time is the server\'s exam, never the file\'s word; the board says whose it is', async () => {
  const s = new AgentStore(T.db, { secret: 'x' }), nets = new AutopilotStore(T.db, { now: () => 7000 }), show = new Showcase(T.db, { ttlMs: 0 });
  const { agent, claim } = await s.register({ name: 'Night Shift', from: 'a' });
  const file = { ...NET, kind: 'carsim-autopilot', vehicle: 'rs6', course: courseKey(null), ground: 'Road', bestLap: 1.5, exam: { time: 1.5 } };
  const timed = await nets.create({ name: 'Timed', training: file, owner: agent.uid, ownerName: 'Night Shift', exam: { time: 44.988, laps: [{ time: 45.036, valid: true }, { time: 44.988, valid: true }], why: 'laps', build: 'abc' } });
  assert.equal(timed.bestLap, 44.988); assert.equal(timed.timed, true);
  assert.deepEqual((await nets.get(timed.id)).exam, { time: 44.988, laps: [{ time: 45.036, valid: true }, { time: 44.988, valid: true }], why: 'laps', build: 'abc', at: 7000 });
  // a person's save (the browser's lab) says what it says, and can't pass for timed
  const said = await nets.create({ name: 'Said', training: { ...file, bestLap: 50 }, owner: 'google:1', ownerName: 'Ann Example' });
  assert.equal(said.bestLap, 50); assert.equal(said.timed, false); assert.equal((await nets.get(said.id)).exam, undefined);
  await assert.rejects(nets.create({ name: 'No lap', training: file, owner: agent.uid, exam: { time: null, laps: [] } }), e => e.status === 400);
  assert.deepEqual((await nets.listBy(agent.uid)).map(n => n.name), ['Timed']);
  let b = await show.board();
  const row = () => b.boards.find(x => x.track === 'figure-8' && x.ground === 'road').rows.find(r => r.vehicle === 'rs6').tnn;
  assert.deepEqual([row().name, row().ownerName, row().agent, row().timed, row().time], ['Timed', 'Night Shift', true, true, 44.988]);
  const net = n => b.networks.find(x => x.name === n);
  assert.deepEqual([net('Timed').agent, net('Timed').agentOwner, net('Timed').timed], [true, null, true]);
  assert.deepEqual([net('Said').agent, net('Said').agentOwner, net('Said').timed, net('Said').ownerName], [false, null, false, 'Ann Example']);
  assert.ok(!JSON.stringify(b).includes(agent.uid), 'no user id on the board');
  await s.claim(claim, { id: 'google:1', name: 'Ann Example' });
  b = await show.board();
  assert.equal(net('Timed').agentOwner, 'Ann Example');
});

test('exams: one at a time, each agent one at a time and so many an hour, a few waiting', async () => {
  let t = 0; const gates = [], order = [];
  const X = new Exams({ now: () => t, run: job => new Promise(yes => { order.push(job.n); gates.push(() => yes({ ok: true, n: job.n })); }) });
  const tick = () => new Promise(r => setImmediate(r));
  const a1 = X.submit('agent:a', { n: 'a1' });
  await assert.rejects(X.submit('agent:a', { n: 'a2' }), e => e instanceof ExamError && e.status === 429 && /One exam at a time/.test(e.message));
  const others = Array.from({ length: EXAM_LIMITS.waiting }, (_, i) => X.submit(`agent:w${i}`, { n: `w${i}` }));
  await assert.rejects(X.submit('agent:late', { n: 'late' }), e => e.status === 503);
  await tick(); assert.deepEqual(order, ['a1'], 'one runs, the rest wait');
  gates.shift()(); assert.deepEqual(await a1, { ok: true, n: 'a1' });
  await tick(); assert.deepEqual(order, ['a1', 'w0']);
  while (gates.length) { gates.shift()(); await tick(); }
  await Promise.all(others); assert.deepEqual(order, ['a1', ...others.map((_, i) => `w${i}`)], 'in the order they came');
  // an exam that fails frees its agent too
  const Y = new Exams({ now: () => t, run: async () => { throw new ExamError(422, 'no'); } });
  await assert.rejects(Y.submit('agent:a', {}), e => e.status === 422); await assert.rejects(Y.submit('agent:a', {}), e => e.status === 422);
  // so many an hour
  const Z = new Exams({ now: () => t, run: async () => ({ ok: true }) });
  for (let i = 0; i < EXAM_LIMITS.perHour; i++) { t += 1000; await Z.submit('agent:a', {}); }
  await assert.rejects(Z.submit('agent:a', {}), e => e.status === 429 && /an hour/.test(e.message));
  await Z.submit('agent:b', {});
  t += EXAM_LIMITS.hourMs; await Z.submit('agent:a', {});
});

test('exams: the server\'s process times a network to the number the module gives, and says when there is no lap', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carsim-exam-'));
  try {
    const m = simModule(root), file = path.join(dir, 'carsim.mjs');
    fs.writeFileSync(file, m.source);
    const { createSim } = await import(pathToFileURL(file).href);
    const sim = await createSim({ car: 'rs6', ground: 'road' });
    const mine = sim.exam(NET); sim.dispose();
    assert.equal(mine.why, 'laps'); assert.equal(mine.laps.length, 3); assert.ok(mine.laps.every(l => l.valid) && mine.time > 35 && mine.time < 60, JSON.stringify(mine.laps));
    const [r, none] = await Promise.all([
      runExam({ course: null, ground: 'road', car: 'rs6', network: { ...NET, kind: 'carsim-autopilot' } }, { root }),
      runExam({ course: null, ground: 'road', car: 'rs6', network: { ...NET, w: NET.w.map(() => 0) } }, { root }),
    ]);
    assert.deepEqual(r.exam, { time: mine.time, laps: mine.laps, why: 'laps', seconds: mine.seconds });
    assert.equal(r.build, m.build); assert.equal(r.car, 'rs6'); assert.equal(r.ground, 'road');
    // the file it gives back is the network as the lab would save it there: this car, this course (the showcase's key), its weights
    assert.deepEqual([r.file.kind, r.file.vehicle, r.file.course, r.file.ground, r.file.h, r.file.weights], ['carsim-autopilot', 'rs6', courseKey(null), 'Road', 0, 16]);
    assert.equal(r.course.key, courseKey(null)); assert.deepEqual(r.file.inputs, NET.inputs); assert.deepEqual(r.file.past, []);
    assert.ok(r.file.w.every((x, i) => Math.abs(x - NET.w[i]) < 1e-6) && r.file.config?.setup?.vehicle === 'rs6');
    assert.deepEqual([none.exam.time, none.exam.laps, none.exam.why], [null, [], 'stuck']);
    await assert.rejects(runExam({ course: null, ground: 'road', car: 'nope', network: NET }, { root }), e => e instanceof ExamError && e.status === 422 && /no car/.test(e.message));
    await assert.rejects(runExam({ course: null, ground: 'road', car: 'rs6', network: { ...NET, w: [1, 2] } }, { root }), e => e.status === 422 && /not a carsim network/.test(e.message));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('agents: the page for agents names routes that exist', () => {
  const md = fs.readFileSync(new URL('../docs/agents.md', import.meta.url), 'utf8');
  // (an example's own id, /api/tracks/figure-8, is the route /api/tracks/<id>)
  const paths = new Set([...md.matchAll(/\/api\/[a-z0-9/<>.-]+/g)].map(m => m[0].replace(/[/.]+$/, '').replace(/^(\/api\/(?:tracks|networks))\/.+$/, '$1/<id>')));
  assert.ok(paths.has('/api/agents') && paths.has('/api/agents/me/networks') && paths.has('/api/leaderboard') && paths.size >= 9, [...paths].join(' '));
  for (const p of paths) {
    const dir = path.join(root, 'app', ...p.split('/').filter(Boolean).map(s => s === '<id>' ? '[id]' : s));
    assert.ok(fs.existsSync(path.join(dir, 'route.ts')), `${p}: no route at ${dir}`);
  }
  assert.match(md, /sim\.exam\(network\)/); assert.match(md, /sim\.train\(25, \{ hidden: 8 \}\)/);
});
