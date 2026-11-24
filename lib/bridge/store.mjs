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
import crypto from 'node:crypto';

export const BRIDGE_LIMITS = { codeMs: 10 * 60_000, idleMs: 8 * 3600_000, commandMs: 30_000, events: 200, waitMs: 25_000, misses: 10 };

const tok = () => crypto.randomBytes(24).toString('base64url');
const eq = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export class BridgeError extends Error {
  constructor(status, message) { super(message); this.name = 'BridgeError'; this.status = status; }
}

export class Bridge {
  constructor({ now = Date.now } = {}) {
    this.now = now;
    /** @type {Map<string, any>} */ this.pages = new Map();
    /** when wrong codes were tried (the claim route is open to anyone: #346, on in production) */ this.misses = [];
  }

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
  /** a new pairing for this user: the page shows the code */
  pair(user) {
    this.#sweep();
    const pageId = crypto.randomBytes(8).toString('hex'), code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
    const p = { pageId, pageToken: tok(), user, code, codeUntil: this.now() + BRIDGE_LIMITS.codeMs, agentToken: null, agent: null, pairedAt: null,
      lastSeen: this.now(), agentSeen: null, send: null, url: '', title: '', seq: 0, cmdSeq: 0, waiting: new Map(), events: [], eventWaiters: new Set() };
    this.pages.set(pageId, p);
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
      return { agentToken: p.agentToken, pageId: p.pageId };
    }
    this.misses.push(this.now());
    throw new BridgeError(404, 'No page shows that code.');
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
  return globalThis.__carsimBridge ??= new Bridge();
}
