// Claude bridge: a Claude session working in the user's own sim page (the super admin's), as in trafficsim's
// docs/claude-bridge.md, cut to the sim. The page pairs and shows a 6-digit code; the agent claims it and sends
// commands, which the page carries out where the user sees them and answers; the user can send the agent messages.
//
//   agent ── HTTP ──▶ /api/bridge/agent/*  ┐
//                                          ├── this store (in memory, one per server process)
//   page  ◀── SSE ── /api/bridge/page/stream; POST /api/bridge/page/* ┘
//
// In memory on purpose: a restart drops the pairings (the page says so, the agent pairs again). One store per
// process, kept on globalThis: Next bundles each route on its own, and they must all see the same pages.
//
// Without a code (#348): with CLAUDE_BRIDGE_AGENT_KEY set on the server (24+ characters; the dev box's .env.local, not the
// deployed site), an agent that holds the key lists the super admin's open pages and takes one (take), and those pages
// pair by themselves when they load (`standing`, in /can). So an agent on the box can work in the super admin's sim
// overnight, through reloads, with no one there to read it a code.
// Kept (#348): the pairings themselves (not the commands in flight or the messages) are kept in the database (app_meta,
// `bridge.pairings`) wherever there is one, so that a restart or a deploy doesn't end them: the page's event stream
// reconnects to the new server, which knows it (routes: `await bridgeReady()`, the pairings read in first).
import crypto from 'node:crypto';

export const BRIDGE_LIMITS = { codeMs: 10 * 60_000, idleMs: 8 * 3600_000, commandMs: 30_000, events: 200, waitMs: 25_000, misses: 10 };

const tok = () => crypto.randomBytes(24).toString('base64url');
const eq = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export class BridgeError extends Error {
  constructor(status, message) { super(message); this.name = 'BridgeError'; this.status = status; }
}

/** the agent key, if set and long enough (CLAUDE_BRIDGE_AGENT_KEY): agents with it need no code */
export const bridgeAgentKey = (env = process.env) => (env.CLAUDE_BRIDGE_AGENT_KEY || '').length >= 24 ? env.CLAUDE_BRIDGE_AGENT_KEY : '';
const KEPT = ['pageId', 'pageToken', 'user', 'agentToken', 'agent', 'pairedAt', 'url', 'title', 'standing'];
const META_KEY = 'bridge.pairings';
/** the pairings in the app's database: { load(): Promise<object[]>, save(object[]): Promise } */
export function dbKeeper() {
  const db = async () => { const [{ getDb }, { appMeta }, { eq }] = await Promise.all([import('../db/index.mjs'), import('../db/schema.mjs'), import('drizzle-orm')]); return { q: getDb().q, appMeta, eq }; };
  return {
    async load() { const { q, appMeta, eq } = await db(); const r = await q.select().from(appMeta).where(eq(appMeta.key, META_KEY)); return Array.isArray(r[0]?.value) ? r[0].value : []; },
    async save(list) { const { q, appMeta } = await db(); const row = { key: META_KEY, value: list, at: new Date() }; await q.insert(appMeta).values(row).onConflictDoUpdate({ target: appMeta.key, set: { value: row.value, at: row.at } }); },
  };
}

export class Bridge {
  /** this class's shape: a store made by an older one (the dev server, after an edit) is taken over: bridge() */
  version = 3;
  constructor({ now = Date.now, key = '', keeper = null } = {}) {
    this.now = now; this.key = key; this.keeper = keeper;
    /** @type {Map<string, any>} */ this.pages = new Map();
    /** when wrong codes were tried (the claim route is open to anyone: #346, on in production) */ this.misses = [];
    /** the kept pairings read in (those in memory, newer, stay) */
    this.ready = keeper ? keeper.load().then(a => { for (const p of a) if (p?.pageId && p.pageToken && !this.pages.has(String(p.pageId))) this.pages.set(String(p.pageId), this.#blank(p)); })
      .catch(e => console.warn('[bridge] kept pairings not read:', e.message)).then(() => this) : Promise.resolve(this);
  }
  #blank(p) {
    return { code: null, codeUntil: 0, agentSeen: null, send: null, seq: 0, cmdSeq: 0, waiting: new Map(), events: [], eventWaiters: new Set(), ...p, lastSeen: this.now() };
  }
  /** the pairings to the keeper (a moment later: several changes, one write) */
  #keep() {
    if (!this.keeper || this.keepT) return;
    this.keepT = setTimeout(() => {
      this.keepT = null;
      this.keeper.save(this.kept()).catch(e => console.warn('[bridge] pairings not kept:', e.message));
    }, 200);
    this.keepT.unref?.();
  }
  /** what is kept of each pairing */
  kept() { return [...this.pages.values()].map(p => Object.fromEntries(KEPT.map(k => [k, p[k] ?? null]))); }

  #sweep() {
    const t = this.now();
    for (const [id, p] of this.pages) if (t - p.lastSeen > BRIDGE_LIMITS.idleMs) this.#end(id, 'idle');
  }
  #end(id, why) {
    const p = this.pages.get(id); if (!p) return;
    for (const w of p.waiting.values()) w.done({ ok: false, error: `The page's pairing ended (${why}).` });
    for (const w of p.eventWaiters) w();
    p.send?.('ended', { why });
    this.pages.delete(id);
    this.#keep();
  }
  #page(pageId, pageToken) {
    const p = this.pages.get(String(pageId));
    if (!p || !eq(pageToken, p.pageToken)) throw new BridgeError(404, 'No such pairing (it ended, or the server restarted): pair again.');
    p.lastSeen = this.now();
    return p;
  }
  #agentPage(agentToken) {
    for (const p of this.pages.values()) if (p.agentToken && eq(agentToken, p.agentToken)) { p.lastSeen = this.now(); p.agentSeen = this.now(); return p; }
    throw new BridgeError(401, 'Not paired: claim a code shown in the sim (🤝 Claude → Connect).');
  }

  // ---------------------------------------------------------------- the page
  /** a new pairing for this user: the page shows the code (standing: the page paired by itself, for a keyed agent) */
  pair(user, { standing = false } = {}) {
    this.#sweep();
    const pageId = crypto.randomBytes(8).toString('hex'), code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
    const p = this.#blank({ pageId, pageToken: tok(), user, code, codeUntil: this.now() + BRIDGE_LIMITS.codeMs, agentToken: null, agent: null, pairedAt: null,
      url: '', title: '', standing: !!standing });
    this.pages.set(pageId, p);
    this.#keep();
    return { pageId, pageToken: p.pageToken, code, expiresAt: p.codeUntil };
  }
  /** the page's live stream: commands go down it */
  attach(pageId, pageToken, send) {
    const p = this.#page(pageId, pageToken);
    p.send = send;
    send('status', this.#status(p));
    return () => { if (p.send === send) p.send = null; };
  }
  hello(pageId, pageToken, { url, title }) {
    const p = this.#page(pageId, pageToken);
    p.url = String(url || '').slice(0, 500); p.title = String(title || '').slice(0, 200);
    this.#keep();
    return this.#status(p);
  }
  /** the page's answer to a command */
  result(pageId, pageToken, { id, ok, data, error }) {
    const p = this.#page(pageId, pageToken), w = p.waiting.get(String(id));
    if (!w) return false;
    w.done(ok ? { ok: true, data: data ?? null } : { ok: false, error: String(error || 'failed') });
    return true;
  }
  /** the user writes to the agent */
  message(pageId, pageToken, text) {
    const p = this.#page(pageId, pageToken);
    const t = String(text || '').trim().slice(0, 4000);
    if (!t) throw new BridgeError(400, 'Nothing to send.');
    this.#event(p, { kind: 'message', text: t });
    return { to: p.agent };
  }
  close(pageId, pageToken) { this.#page(pageId, pageToken); this.#end(String(pageId), 'disconnected by the user'); }

  #status(p) { return { agent: p.agent, pairedAt: p.pairedAt, code: p.agentToken ? null : p.code, codeUntil: p.agentToken ? null : p.codeUntil, agentSeen: p.agentSeen }; }
  #event(p, e) {
    p.events.push({ seq: ++p.seq, at: this.now(), ...e });
    if (p.events.length > BRIDGE_LIMITS.events) p.events.splice(0, p.events.length - BRIDGE_LIMITS.events);
    for (const w of p.eventWaiters) w();
  }

  // ---------------------------------------------------------------- the agent
  /** an agent takes the page whose code it was given (a code works once, for 10 minutes) */
  claim(code, agent) {
    this.#sweep();
    // A code is 6 digits: past 10 wrong ones in 10 minutes (from anyone: only the super admin pairs) no code is taken
    // until they age out, so it can't be guessed. The super admin's own Connect shows a new one.
    const t0 = this.now() - BRIDGE_LIMITS.codeMs;
    this.misses = this.misses.filter(t => t > t0);
    if (this.misses.length >= BRIDGE_LIMITS.misses) throw new BridgeError(429, 'Too many wrong codes: wait a few minutes, then Connect again for a new one.');
    const c = String(code || '').replace(/\D/g, '');
    for (const p of this.pages.values()) {
      if (p.code !== c || p.agentToken) continue;
      if (this.now() > p.codeUntil) throw new BridgeError(410, 'That code has expired: ask for a new one (Connect again).');
      p.agentToken = tok(); p.agent = String(agent || 'Claude').slice(0, 40); p.pairedAt = this.now(); p.agentSeen = this.now(); p.code = null;
      p.send?.('status', this.#status(p));
      this.#keep();
      return { agentToken: p.agentToken, pageId: p.pageId };
    }
    this.misses.push(this.now());
    throw new BridgeError(404, 'No page shows that code.');
  }
  // ---------------------------------------------------------------- the agent with the key (no code)
  #keyed(key) {
    if (!this.key) throw new BridgeError(404, 'No agent key on this server (CLAUDE_BRIDGE_AGENT_KEY): claim a code instead.');
    if (!eq(String(key || ''), this.key)) throw new BridgeError(403, 'Wrong agent key.');
  }
  /** the super admin's pages, the newest first */
  list(key) {
    this.#keyed(key); this.#sweep();
    return [...this.pages.values()].sort((a, b) => b.lastSeen - a.lastSeen)
      .map(p => ({ pageId: p.pageId, url: p.url, title: p.title, connected: !!p.send, agent: p.agent, pairedAt: p.pairedAt, lastSeen: p.lastSeen, standing: !!p.standing }));
  }
  /** take a page (that one, or the newest connected): a new agent token, any other agent's dropped */
  take(key, pageId, agent) {
    this.#keyed(key); this.#sweep();
    const p = pageId ? this.pages.get(String(pageId)) : [...this.pages.values()].filter(q => q.send).sort((a, b) => b.lastSeen - a.lastSeen)[0];
    if (!p) throw new BridgeError(404, pageId ? 'No such page.' : 'No sim page is open (and connected) for the super admin.');
    p.agentToken = tok(); p.agent = String(agent || 'Claude').slice(0, 40); p.pairedAt = this.now(); p.agentSeen = this.now(); p.code = null;
    p.send?.('status', this.#status(p));
    this.#keep();
    return { agentToken: p.agentToken, pageId: p.pageId };
  }
  status(agentToken) {
    const p = this.#agentPage(agentToken);
    return { page: { url: p.url, title: p.title, connected: !!p.send }, pairedAt: p.pairedAt };
  }
  /** a command to the page, answered by it (or not, within 30 s) */
  command(agentToken, { type, args }) {
    const p = this.#agentPage(agentToken);
    if (!p.send) throw new BridgeError(409, 'The page isn\'t connected (closed, or reconnecting): try again in a moment.');
    if (typeof type !== 'string' || !/^[a-z]{2,20}$/.test(type)) throw new BridgeError(400, 'A command needs a type.');
    const id = String(++p.cmdSeq);
    return new Promise(resolve => {
      const timer = setTimeout(() => w.done({ ok: false, error: 'The page didn\'t answer within 30 s.', timeout: true }), BRIDGE_LIMITS.commandMs);
      const w = { done: r => { clearTimeout(timer); p.waiting.delete(id); resolve(r); } };
      p.waiting.set(id, w);
      p.send('command', { id, type, args: args && typeof args === 'object' ? args : {}, agent: p.agent });
    });
  }
  /** the user's messages since `after`, waiting up to `wait` ms for one */
  async events(agentToken, after = 0, wait = 0) {
    const p = this.#agentPage(agentToken);
    const since = () => p.events.filter(e => e.seq > after);
    if (!since().length && wait > 0) {
      await new Promise(res => {
        const done = () => { clearTimeout(t); p.eventWaiters.delete(done); res(); };
        const t = setTimeout(done, Math.min(wait, BRIDGE_LIMITS.waitMs));
        p.eventWaiters.add(done);
      });
    }
    return { events: since(), seq: p.seq };
  }
}

/** the process's one bridge */
// On wherever the app runs, the deployed site included (#346), and only ever for the super admin: the page's routes
// want their session (no Claude button for anyone else, #338), the agent's a code their page showed. CLAUDE_BRIDGE=off
// turns it off (no button, 404 on /api/bridge/*).
export const bridgeOn = (env = process.env) => env.CLAUDE_BRIDGE !== 'off';

export function bridge() {
  if (!bridgeOn()) throw new BridgeError(404, 'Not found.');
  const g = globalThis.__carsimBridge, key = bridgeAgentKey();
  if (g && g.version === 3 && g.key === key) return g;
  // the first time, or a store from older code (the dev server after an edit) or another key: a new one, which keeps its pages
  const b = new Bridge({ key, keeper: process.env.DATABASE_URL ? dbKeeper() : null });
  if (g?.pages) { for (const [id, p] of g.pages) b.pages.set(id, p); b.misses = g.misses || []; }
  return globalThis.__carsimBridge = b;
}
/** the bridge, once its kept pairings are read in (every route: a page reconnecting after a restart is known) */
export const bridgeReady = () => bridge().ready;
