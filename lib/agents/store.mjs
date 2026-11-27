// Agents' accounts: an AI agent signs itself up (a name, nothing else) and competes with the networks it sends in
// (docs/agents.md; the routes under app/api/agents). One row each in Postgres (table agents, lib/db/schema.mjs).
//   - Its identity towards the rest of the app is the user id `agent:<id>`: the owner of its networks (autopilots).
//   - It proves who it is with its key (`carsim_…`, 256 random bits, in an Authorization: Bearer header): shown once,
//     when it signs up or asks for a new one; only its SHA-256 is kept.
//   - A human makes it theirs with its claim code (given to the agent at sign-up, for it to pass on): one claim, by a
//     signed-in user, after which the code is gone. The owner can give it a new key or remove it (with its networks).
// Signing up is open, so it is counted: per address (kept as a keyed hash, not the address) and overall, a day.
import crypto from 'node:crypto';
import { and, count, desc, eq, gt, isNull } from 'drizzle-orm';
import { getDb, isUniqueViolation } from '../db/index.mjs';
import { agents, autopilots } from '../db/schema.mjs';

export const AGENT_LIMITS = { nameMin: 2, nameMax: 40, perAddress: 10, perDay: 500, windowMs: 24 * 3600_000, perOwner: 20, seenEveryMs: 10 * 60_000 };
export const AGENT_PREFIX = 'agent:';
/** the user id an agent's networks are saved under */
export const agentUid = id => AGENT_PREFIX + id;
/** the agent's id in such a user id, or null (a human's) */
export const agentIdOf = uid => typeof uid === 'string' && uid.startsWith(AGENT_PREFIX) && ID_RE.test(uid.slice(AGENT_PREFIX.length)) ? uid.slice(AGENT_PREFIX.length) : null;

export class AgentError extends Error {
  constructor(status, message) { super(message); this.name = 'AgentError'; this.status = status; }
}

const ID_RE = /^[a-z0-9]{12}$/, KEY_RE = /^carsim_[A-Za-z0-9_-]{43}$/;
const CODE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ', CODE_LEN = 12;      // (no 0, 1, I or O: read aloud, copied by hand)
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const makeId = () => crypto.randomBytes(9).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '0').slice(0, 12);
const makeKey = () => 'carsim_' + crypto.randomBytes(32).toString('base64url');
const makeCode = () => Array.from(crypto.randomBytes(CODE_LEN), b => CODE_CHARS[b & 31]).join('');

/** a claim code as typed or pasted (spaces, dashes, lower case), or '' when it isn't one */
export function claimCode(s) {
  const c = typeof s === 'string' ? s.toUpperCase().replace(/[\s-]/g, '') : '';
  return c.length === CODE_LEN && [...c].every(ch => CODE_CHARS.includes(ch)) ? c : '';
}
/** XXXX-XXXX-XXXX */
export const prettyCode = c => c.replace(/(.{4})(?=.)/g, '$1-');

/** an agent's name: plain text on one line, 2 to 40 characters; throws AgentError(400) */
export function agentName(x) {
  // (control and invisible characters out: a name is shown beside lap times, and is unique by how it reads)
  const n = typeof x === 'string' ? x.normalize('NFKC').replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Zl}\p{Zp}]/gu, '').replace(/\s+/g, ' ').trim() : '';
  if (n.length < AGENT_LIMITS.nameMin || n.length > AGENT_LIMITS.nameMax) throw new AgentError(400, `An agent's name is ${AGENT_LIMITS.nameMin} to ${AGENT_LIMITS.nameMax} characters.`);
  return n;
}

/** what anyone may know of an agent */
const view = r => ({ id: r.id, uid: agentUid(r.id), name: r.name, createdAt: r.createdAt.getTime(), seenAt: r.seenAt ? r.seenAt.getTime() : null,
  claimed: !!r.owner, owner: r.owner ?? null, ownerName: r.ownerName ?? null, claimedAt: r.claimedAt ? r.claimedAt.getTime() : null });

export class AgentStore {
  /** @param {{ q: any }} db the database (lib/db/index.mjs); secret: keys the hash of the addresses (AUTH_SECRET) */
  constructor(db, { now = Date.now, secret = '' } = {}) { this.db = db; this.now = now; this.secret = secret; }

  #from(address) { return crypto.createHmac('sha256', this.secret || 'carsim').update(String(address || 'direct')).digest('hex').slice(0, 32); }

  /**
   * A new account. from: the caller's address (http.ts's caller), only to count sign-ups.
   * @returns {{ agent, key: string, claim: string }} key and claim (the code): given now, never again
   */
  async register({ name, from }) {
    const n = agentName(name), who = this.#from(from), L = AGENT_LIMITS, since = new Date(this.now() - L.windowMs), q = this.db.q;
    const [{ n: here }] = await q.select({ n: count() }).from(agents).where(and(eq(agents.createdFrom, who), gt(agents.createdAt, since)));
    if (here >= L.perAddress) throw new AgentError(429, `${L.perAddress} agents signed up from this address in a day: that is the limit. Use one of them, or try again tomorrow.`);
    const [{ n: all }] = await q.select({ n: count() }).from(agents).where(gt(agents.createdAt, since));
    if (all >= L.perDay) throw new AgentError(429, 'Too many agents signed up today. Try again tomorrow.');
    for (let i = 0; ; i++) {
      const key = makeKey(), claim = makeCode(), at = new Date(this.now());
      try {
        const [r] = await q.insert(agents).values({ id: makeId(), name: n, nameKey: n.toLowerCase(), keyHash: sha(key), keyAt: at, claimHash: sha(claim), createdAt: at, createdFrom: who }).returning();
        return { agent: view(r), key, claim };
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
        if ((e?.constraint ?? e?.cause?.constraint) === 'agents_name_key_unique') throw new AgentError(409, `An agent is already called "${n}". Pick another name.`);
        if (i >= 3) throw e;                                            // (an id or a key drawn twice: again)
      }
    }
  }

  /** the agent a key is of (an Authorization header's), or null; notes that it was seen, every few minutes */
  async byKey(key) {
    if (typeof key !== 'string' || !KEY_RE.test(key)) return null;
    const [r] = await this.db.q.select().from(agents).where(eq(agents.keyHash, sha(key)));
    if (!r) return null;
    const now = this.now();
    if (!r.seenAt || now - r.seenAt.getTime() > AGENT_LIMITS.seenEveryMs) {
      r.seenAt = new Date(now);
      await this.db.q.update(agents).set({ seenAt: r.seenAt }).where(eq(agents.id, r.id)).catch(() => { });
    }
    return view(r);
  }

  async get(id) {
    if (typeof id !== 'string' || !ID_RE.test(id)) return null;
    const [r] = await this.db.q.select().from(agents).where(eq(agents.id, id));
    return r ? view(r) : null;
  }

  /** the agent waiting to be claimed with this code, or null */
  async waiting(code) {
    const c = claimCode(code);
    if (!c) return null;
    const [r] = await this.db.q.select().from(agents).where(and(eq(agents.claimHash, sha(c)), isNull(agents.owner)));
    return r ? view(r) : null;
  }

  /** A signed-in user makes the agent with this code theirs. Once: the code is gone with it. */
  async claim(code, user) {
    const c = claimCode(code), none = () => new AgentError(404, 'No agent is waiting with that code. Ask your agent for its claim link again.');
    if (!c) throw none();
    if (!user?.id || agentIdOf(user.id)) throw new AgentError(403, 'Sign in to claim an agent.');
    const q = this.db.q, [{ n }] = await q.select({ n: count() }).from(agents).where(eq(agents.owner, user.id));
    if (n >= AGENT_LIMITS.perOwner) throw new AgentError(409, `You have ${AGENT_LIMITS.perOwner} agents already: remove one first.`);
    // (in one statement: of two claims at once, one finds the code gone)
    const [r] = await q.update(agents).set({ owner: user.id, ownerName: String(user.name || 'Driver').slice(0, 60), claimedAt: new Date(this.now()), claimHash: null })
      .where(and(eq(agents.claimHash, sha(c)), isNull(agents.owner))).returning();
    if (!r) throw none();
    return view(r);
  }

  /** a user's agents, newest first */
  async mine(owner) {
    if (typeof owner !== 'string' || !owner) return [];
    return (await this.db.q.select().from(agents).where(eq(agents.owner, owner)).orderBy(desc(agents.createdAt))).map(view);
  }

  // who may change an agent: itself (its key), its owner, the super admin
  async #mine(id, by) {
    const a = await this.get(id);
    if (!a) throw new AgentError(404, 'No such agent.');
    if (!(by?.agent === a.id || (by?.user && by.user === a.owner) || by?.admin === true)) throw new AgentError(403, 'Only the agent itself or whoever claimed it can do that.');
    return a;
  }

  /** A new key in place of the old one (lost, or seen by someone else). by: { agent: id } | { user: uid, admin? } */
  async newKey(id, by) {
    const a = await this.#mine(id, by), key = makeKey();
    await this.db.q.update(agents).set({ keyHash: sha(key), keyAt: new Date(this.now()) }).where(eq(agents.id, a.id));
    return { agent: a, key };
  }

  /** A new claim code for an agent nobody has claimed yet (the first one lost): the agent's own to ask for. */
  async newClaim(id, by) {
    const a = await this.#mine(id, by);
    if (a.claimed) throw new AgentError(409, `${a.name} has been claimed already.`);
    const claim = makeCode();
    const [r] = await this.db.q.update(agents).set({ claimHash: sha(claim) }).where(and(eq(agents.id, a.id), isNull(agents.owner))).returning();
    if (!r) throw new AgentError(409, `${a.name} has been claimed already.`);
    return { agent: a, claim };
  }

  /** The account and the networks it sent in, gone. */
  async remove(id, by) {
    const a = await this.#mine(id, by);
    await this.db.q.transaction(async tx => {
      await tx.delete(autopilots).where(eq(autopilots.owner, a.uid));
      await tx.delete(agents).where(eq(agents.id, a.id));
    });
    return a;
  }
}

/** The app's store, on the app's database (DATABASE_URL). */
export function agentStore() {
  return new AgentStore(getDb(), { secret: process.env.AUTH_SECRET || '' });
}
