// The super admin's dashboard (#357, lib/dashboard/store.mjs): the people who signed in and those known only by what they
// left, the agents, the networks, the runs (the exams the server drove, the best laps).
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { testDb } from './db.mjs';
import { AdminStore } from '../lib/dashboard/store.mjs';
import { AgentStore } from '../lib/agents/store.mjs';
import { AutopilotStore } from '../lib/autopilots/store.mjs';

const T = await testDb();
beforeEach(() => T.reset());
after(() => T.drop());
const NET = { kind: 'carsim-autopilot', inputs: ['speed', 'line6'], h: 0, w: [0, 1, 2, 3, 4, 5] };

test('dashboard: sign-ins kept, sign-ins counted, seen without a sign-in, agents never as people', async () => {
  let t = 1_000_000;
  const s = new AdminStore(T.db, { now: () => t });
  await s.signIn({ id: 'google:1', provider: 'google', name: 'Ada Lovelace', email: 'ada@example.com', image: 'https://x/a.png' });
  t += 5000;
  await s.signIn({ id: 'google:1', provider: 'google', name: 'Ada L.', email: 'ada@example.com', image: null });
  await s.seen({ id: 'guest:abc', name: 'Visitor', email: null });                  // (signed in before the table: kept now)
  t += 5000;
  await s.seen({ id: 'google:1', name: 'ignored' });
  await s.signIn({ id: 'agent:abcdefabcdef', provider: 'agent', name: 'Bot' });     // (an agent's: not a person)
  const { rows } = await T.db.pool.query('select id, provider, name, email, sign_ins, first_at, last_at from users order by id');
  assert.deepEqual(rows.map(r => [r.id, r.provider, r.name, r.email, r.sign_ins, r.first_at.getTime(), r.last_at.getTime()]), [
    ['google:1', 'google', 'Ada L.', 'ada@example.com', 2, 1_000_000, 1_010_000],
    ['guest:abc', 'guest', 'Visitor', null, 0, 1_005_000, 1_005_000],
  ]);
});

test('dashboard: everyone, including people from before (by their laps, networks, chat, agents), the agents, the networks, the runs', async () => {
  let t = Date.UTC(2026, 10, 27, 12);
  const s = new AdminStore(T.db, { now: () => t }), agents = new AgentStore(T.db, { now: () => t, secret: 'x' }), nets = new AutopilotStore(T.db, { now: () => t });
  await s.signIn({ id: 'google:1', provider: 'google', name: 'Ada', email: 'ada@example.com' });
  // someone from before: a lap, a network, a message
  const P = T.db.pool;
  await P.query(`insert into records (map, ground, vehicle, driver_id, driver_name, driver_image, map_version, time_s, splits, set_at)
                 values ('figure-8', 'sand', 'buggy', 'google:2', 'Grace', 'https://x/g.png', 0, 61.5, '[]', $1)`, [new Date(t - 86_400_000)]);
  await P.query(`insert into records (map, ground, vehicle, driver_id, driver_name, map_version, time_s, splits, set_at, net)
                 values ('figure-8', 'sand', 'buggy', 'tnn:xyz', 'Netty', 0, 60.1, '[]', $1, '{"name":"Netty","creator":"Grace","autopilot":null}')`, [new Date(t - 3600_000)]);
  await P.query(`insert into chat_messages (id, user_id, user_name, text, at) values ('m1', 'google:2', 'Grace', 'hi', $1)`, [new Date(t - 2 * 86_400_000)]);
  await nets.create({ name: 'Grace 1', training: NET, owner: 'google:2', ownerName: 'Grace' });
  // an agent, claimed by Ada, with one exam timed and saved, one with no lap, one that went wrong
  const { agent, claim } = await agents.register({ name: 'Night Shift', from: '1.2.3.4' });
  await agents.claim(claim, { id: 'google:1', name: 'Ada' });
  const saved = await nets.create({ name: 'Shift 1', training: NET, owner: agent.uid, ownerName: agent.name, exam: { time: 70.25, laps: [], why: 'lap', build: 'b1' } });
  const run = { agent: agent.uid, agentName: agent.name, name: 'Shift 1', track: 'figure-8', ground: 'sand', vehicle: 'buggy' };
  await s.exam({ ...run, status: 201, ms: 5200, exam: { time: 70.25, why: 'lap', seconds: 220 }, autopilot: saved.id, build: 'b1' });
  t += 1000;
  await s.exam({ ...run, name: 'Shift 2', status: 422, ms: 3100, exam: { time: null, why: 'wrecked', seconds: 12 } });
  t += 1000;
  await s.exam({ ...run, name: 'Shift 3', status: 504, ms: 60_000, error: 'The exam took too long and was stopped.' });

  const d = await s.dashboard();
  assert.deepEqual(d.people.map(p => [p.id, p.name, p.email, p.kept, p.laps, p.networks, p.chat, p.agents]), [
    ['google:1', 'Ada', 'ada@example.com', true, 0, 0, 0, 1],
    ['google:2', 'Grace', null, false, 1, 1, 1, 0],
  ]);
  const grace = d.people[1];
  assert.equal(grace.firstAt, t - 2000 - 2 * 86_400_000);                           // (her first trace: the chat message)
  assert.equal(grace.image, 'https://x/g.png');
  assert.deepEqual(d.agents.map(a => [a.name, a.ownerName, a.networks, a.exams, a.timed]), [['Night Shift', 'Ada', 1, 3, 1]]);
  assert.deepEqual(d.networks.map(n => [n.name, n.agent, n.trackName]).sort(), [['Grace 1', false, null], ['Shift 1', true, null]]);
  assert.deepEqual(d.runs.map(r => [r.kind, r.name, r.time, r.why ?? null, r.status ?? null]), [
    ['exam', 'Shift 3', null, null, 504],
    ['exam', 'Shift 2', null, 'wrecked', 422],
    ['exam', 'Shift 1', 70.25, 'lap', 201],
    ['netLap', 'Netty', 60.1, null, null],
    ['lap', null, 61.5, null, null],
  ]);
  assert.equal(d.runs[3].who, 'Grace');                                             // (a network's lap: by its maker)
  assert.equal(d.runs[0].trackName, 'Figure-8');
  assert.deepEqual({ ...d.counts }, { people: 2, peopleDay: 2, google: 2, agents: 1, claimed: 1, agentsDay: 1, networks: 2, agentNetworks: 1, exams: 3, examsTimed: 1, examsDay: 3 });
});
