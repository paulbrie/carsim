// The super admin's dashboard (/admin; ticket #357): everyone who made an account (people and agents), every network, and
// the runs (the exams the server drove for agents, the best laps set). Two tables of its own (lib/db/schema.mjs):
//   - users: who signed in, written at sign-in (noteSignIn, auth.ts's jwt callback) and when seen (noteSeen, every ten
//     minutes at most a person and process). People from before it are found by what they left (best laps, networks, chat,
//     agents claimed) and listed without an email until they come back.
//   - exam_runs: each network an agent sent in, whatever came of it (noteExam, app/api/agents/me/networks).
// Nothing here is for a public page: it has the people's emails.
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { getDb } from '../db/index.mjs';
import { examRuns, users } from '../db/schema.mjs';
import { AutopilotStore } from '../autopilots/store.mjs';
import { agentIdOf, AGENT_PREFIX } from '../agents/store.mjs';
import { Showcase } from '../showcase/store.mjs';

export const ADMIN_LIMITS = { seenEveryMs: 10 * 60_000, runs: 300, laps: 300, nameMax: 80, errorMax: 300 };

const str = (x, n) => typeof x === 'string' ? x.slice(0, n) : '';
const fin = x => typeof x === 'number' && Number.isFinite(x);
const ms = d => d instanceof Date ? d.getTime() : d == null ? null : new Date(d).getTime();
const newId = () => crypto.randomBytes(9).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '0').slice(0, 12);
/** google:… → google; an agent's → agent */
const providerOf = id => id.startsWith(AGENT_PREFIX) ? 'agent' : id.includes(':') ? id.slice(0, id.indexOf(':')) : 'unknown';

export class AdminStore {
  /** @param {{ q: any, pool: import('pg').Pool }} db the database (lib/db/index.mjs) */
  constructor(db, { now = Date.now } = {}) { this.db = db; this.now = now; }

  /** a sign-in: the person's row, new or brought up to date (name, picture, email as the provider has them now) */
  async signIn({ id, provider, name, email = null, image = null }) {
    if (typeof id !== 'string' || !id || id.startsWith(AGENT_PREFIX)) return;
    const at = new Date(this.now()), row = { provider: str(provider, 20) || providerOf(id), name: str(name, ADMIN_LIMITS.nameMax) || 'Driver', email: str(email, 200) || null, image: str(image, 500) || null };
    await this.db.q.insert(users).values({ id, ...row, firstAt: at, lastAt: at, signIns: 1 })
      .onConflictDoUpdate({ target: users.id, set: { ...row, lastAt: at, signIns: sql`${users.signIns} + 1` } });
  }

  /** seen (a page or a request with their session): last_at, and the row if they signed in before it was kept */
  async seen({ id, name, email = null, image = null }) {
    if (typeof id !== 'string' || !id || id.startsWith(AGENT_PREFIX)) return;
    const at = new Date(this.now()), row = { name: str(name, ADMIN_LIMITS.nameMax) || 'Driver', email: str(email, 200) || null, image: str(image, 500) || null };
    await this.db.q.insert(users).values({ id, provider: providerOf(id), ...row, firstAt: at, lastAt: at, signIns: 0 })
      .onConflictDoUpdate({ target: users.id, set: { lastAt: at } });
  }

  /** an exam an agent asked for: { agent, agentName, name, track, ground, vehicle, status, ms, exam?, error?, autopilot?, build? } */
  async exam(r) {
    const e = r.exam || {};
    await this.db.q.insert(examRuns).values({
      id: newId(), at: new Date(this.now()), agent: str(r.agent, 80), agentName: str(r.agentName, ADMIN_LIMITS.nameMax), name: str(r.name, 80) || '?',
      track: str(r.track, 80), ground: str(r.ground, 20), vehicle: str(r.vehicle, 40),
      time: fin(e.time) ? e.time : null, why: str(e.why, 20) || null, seconds: fin(e.seconds) ? e.seconds : null,
      error: str(r.error, ADMIN_LIMITS.errorMax) || null, status: Math.round(fin(r.status) ? r.status : 0), ms: Math.max(0, Math.round(fin(r.ms) ? r.ms : 0)),
      autopilot: str(r.autopilot, 20) || null, build: str(r.build, 40) || null,
    });
  }

  /** everything the dashboard shows */
  async dashboard() {
    const P = this.db.pool, q = (s, a) => P.query(s, a).then(r => r.rows);
    const [kept, laps, nets, chat, owned, agentRows, runs, recent, maps, networks] = await Promise.all([
      q(`select id, provider, name, email, image, first_at, last_at, sign_ins from users`),
      // a person's best laps (a network's are its own driver's: tnn:…)
      q(`select driver_id id, max(driver_name) name, max(driver_image) image, count(*)::int n, min(set_at) first, max(set_at) last
           from records where net is null group by driver_id`),
      q(`select owner id, max(owner_name) name, count(*)::int n, min(saved_at) first, max(saved_at) last
           from autopilots where owner not like 'agent:%' group by owner`),
      q(`select user_id id, max(user_name) name, max(user_image) image, count(*)::int n, min(at) first, max(at) last from chat_messages group by user_id`),
      q(`select owner id, max(owner_name) name, count(*)::int n, min(claimed_at) first, max(claimed_at) last from agents where owner is not null group by owner`),
      q(`select a.id, a.name, a.created_at, a.seen_at, a.key_at, a.owner, a.owner_name, a.claimed_at,
                (select count(*)::int from autopilots p where p.owner = 'agent:' || a.id) nets,
                (select count(*)::int from exam_runs e where e.agent = 'agent:' || a.id) exams,
                (select count(*)::int from exam_runs e where e.agent = 'agent:' || a.id and e.time_s is not null) timed
           from agents a order by a.created_at desc`),
      q(`select * from exam_runs order by at desc limit $1`, [ADMIN_LIMITS.runs]),
      q(`select map, ground, vehicle, driver_id, driver_name, time_s, set_at, net from records order by set_at desc limit $1`, [ADMIN_LIMITS.laps]),
      new Showcase(this.db).tracks(),                                  // (a network's track: the map whose course key is its course's)
      new AutopilotStore(this.db).list(),
    ]);
    const [{ n: examsAll, ok: examsOk, today: examsDay }] = await q(`select count(*)::int n, count(time_s)::int ok, count(*) filter (where at > $1)::int today from exam_runs`, [new Date(this.now() - 24 * 3600_000)]);

    // the people: the ones kept, then anyone else who left something
    const people = new Map();
    for (const u of kept) people.set(u.id, { id: u.id, provider: u.provider, name: u.name, email: u.email, image: u.image, firstAt: ms(u.first_at), lastAt: ms(u.last_at), signIns: u.sign_ins, kept: true, laps: 0, networks: 0, chat: 0, agents: 0 });
    const add = (rows, key) => {
      for (const r of rows) {
        if (!r.id || r.id.startsWith(AGENT_PREFIX) || r.id.startsWith('tnn:')) continue;
        let p = people.get(r.id);
        if (!p) people.set(r.id, p = { id: r.id, provider: providerOf(r.id), name: r.name || 'Driver', email: null, image: r.image ?? null, firstAt: ms(r.first), lastAt: ms(r.last), signIns: 0, kept: false, laps: 0, networks: 0, chat: 0, agents: 0 });
        p[key] = r.n;
        if (!p.image && r.image) p.image = r.image;
        if (!p.kept) { p.firstAt = Math.min(p.firstAt ?? Infinity, ms(r.first) ?? Infinity); p.lastAt = Math.max(p.lastAt ?? 0, ms(r.last) ?? 0); }
      }
    };
    add(laps, 'laps'); add(nets, 'networks'); add(chat, 'chat'); add(owned, 'agents');
    const peopleList = [...people.values()].map(p => ({ ...p, firstAt: Number.isFinite(p.firstAt) ? p.firstAt : null, lastAt: p.lastAt || null }))
      .sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0));

    const mapName = new Map(maps.map(m => [m.id, m.name])), byKey = new Map(maps.map(m => [m.key, m]));
    const name = (uid, fallback) => people.get(uid)?.name ?? fallback;

    const agentList = agentRows.map(a => ({
      id: a.id, uid: AGENT_PREFIX + a.id, name: a.name, createdAt: ms(a.created_at), seenAt: ms(a.seen_at), keyAt: ms(a.key_at),
      owner: a.owner, ownerName: a.owner ? name(a.owner, a.owner_name) : null, claimedAt: ms(a.claimed_at), networks: a.nets, exams: a.exams, timed: a.timed,
    }));

    const networkList = networks.map(n => ({ ...n, agent: !!agentIdOf(n.owner), trackName: byKey.get(n.course)?.name ?? null,
      past: n.past.map(p => ({ ...p, track: byKey.get(p.course)?.name ?? null })) }));

    // the runs: the exams and the best laps, newest first
    const runList = [
      ...runs.map(r => ({
        kind: 'exam', at: ms(r.at), who: r.agent_name, whoId: r.agent, agent: true, name: r.name, track: r.track, trackName: mapName.get(r.track) ?? r.track,
        ground: r.ground, vehicle: r.vehicle, time: r.time_s, why: r.why, seconds: r.seconds, error: r.error, status: r.status, ms: r.ms, autopilot: r.autopilot, build: r.build,
      })),
      ...recent.map(r => ({
        kind: r.net ? 'netLap' : 'lap', at: ms(r.set_at), who: r.net ? (r.net.creator ?? r.driver_name) : r.driver_name, whoId: r.driver_id, agent: false,
        name: r.net ? r.net.name ?? r.driver_name : null, track: r.map, trackName: mapName.get(r.map) ?? r.map, ground: r.ground, vehicle: r.vehicle, time: r.time_s,
        autopilot: r.net?.autopilot ?? null,
      })),
    ].sort((a, b) => b.at - a.at);

    const day = this.now() - 24 * 3600_000;
    return {
      at: this.now(),
      counts: {
        people: peopleList.length, peopleDay: peopleList.filter(p => (p.lastAt ?? 0) > day).length, google: peopleList.filter(p => p.provider === 'google').length,
        agents: agentList.length, claimed: agentList.filter(a => a.owner).length, agentsDay: agentList.filter(a => (a.seenAt ?? a.createdAt ?? 0) > day).length,
        networks: networkList.length, agentNetworks: networkList.filter(n => n.agent).length,
        exams: examsAll, examsTimed: examsOk, examsDay,
      },
      people: peopleList, agents: agentList, networks: networkList, runs: runList,
    };
  }
}


/** The app's, on the app's database. */
export function adminStore() {
  return new AdminStore(getDb());
}

// ---- what auth.ts calls: never in the way of a sign-in or a page (no database, an error: a warning, nothing more) ----
const seenAt = globalThis.__carsimSeen ??= new Map();
const quietly = (what, f) => { try { f().catch(e => console.warn(`[${what}] ${e.message}`)); } catch (e) { console.warn(`[${what}] ${e.message}`); } };
/** at sign-in */
export function noteSignIn(u) {
  seenAt.set(u.id, Date.now());
  quietly('users', () => adminStore().signIn(u));
}
/** a request with their session: written every ADMIN_LIMITS.seenEveryMs at most */
export function noteSeen(u) {
  const now = Date.now(), t = seenAt.get(u.id);
  if (t && now - t < ADMIN_LIMITS.seenEveryMs) return;
  seenAt.set(u.id, now);
  if (seenAt.size > 50_000) seenAt.clear();
  quietly('users', () => adminStore().seen(u));
}
/** an exam's outcome (the route that asked for it) */
export function noteExam(r) {
  quietly('exam_runs', () => adminStore().exam(r));
}
