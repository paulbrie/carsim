// The chat (ticket #325): the main room, for everyone connected to the race server, and one for each race room.
// The main room's last CHAT_LIMITS.keep messages are in Postgres (table chat_messages, lib/db/schema.mjs) and read
// once when the server starts (load); the race server (lib/race/hub.mjs) is the only writer and answers from memory.
// A race room's chat lives in the room (hub.mjs), and goes with it. The super admin can delete a message and mute
// a driver for a while (chat_mutes): a muted driver's messages are refused, in every room.
import { randomUUID } from 'node:crypto';
import { desc, eq, lt } from 'drizzle-orm';
import { getDb } from '../db/index.mjs';
import { chatMessages, chatMutes } from '../db/schema.mjs';

// maxChars: a message's length (in characters, not UTF-16 units); keep / roomKeep: the messages a room remembers;
// burst / perSec: how many a driver may send at once, and then a second; muteHours: the admin's mute
export const CHAT_LIMITS = { maxChars: 500, keep: 200, roomKeep: 100, burst: 5, perSec: 0.5, muteHours: 24, maxMuteHours: 24 * 30, saveTries: 4, saveRetryMs: 500 };

/** a message's text as it may be shown: no control characters, line breaks as spaces, trimmed, cut to maxChars; or null */
export function cleanText(t) {
  if (typeof t !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const s = t.replace(/[\r\n\t\u2028\u2029]+/g, ' ').replace(/[\u0000-\u001f\u007f-\u009f\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim();
  if (!s) return null;
  const cps = Array.from(s);
  return cps.length > CHAT_LIMITS.maxChars ? cps.slice(0, CHAT_LIMITS.maxChars).join('').trimEnd() : s;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

export class ChatStore {
  /** @param {{ q: any } | null} db the database (lib/db/index.mjs), or null: in memory only (tests) */
  constructor(db, { now = Date.now, retryMs = CHAT_LIMITS.saveRetryMs } = {}) {
    this.db = db; this.now = now; this.retryMs = retryMs;
    /** @type {{ id: string, at: number, uid: string, name: string, image: string | null, text: string }[]} the main room, oldest first */
    this.main = [];
    /** @type {Map<string, { id: string, name: string, until: number, by: string }>} */
    this.mutes = new Map();
    this.writes = Promise.resolve();
    this.added = 0;
  }

  /** Read the main room's last messages and the mutes under way: once, before the first client. */
  async load() {
    if (!this.db) return this;
    const rows = await this.db.q.select().from(chatMessages).orderBy(desc(chatMessages.at)).limit(CHAT_LIMITS.keep);
    this.main = rows.reverse().map(r => ({ id: r.id, at: r.at.getTime(), uid: r.userId, name: r.userName, image: r.userImage ?? null, text: r.text }));
    const now = this.now();
    this.mutes.clear();
    for (const m of await this.db.q.select().from(chatMutes)) if (m.until.getTime() > now) this.mutes.set(m.userId, { id: m.userId, name: m.userName, until: m.until.getTime(), by: m.by });
    return this;
  }

  /** a new message, as the room keeps it */
  message(user, text) {
    return { id: randomUUID(), at: this.now(), uid: user.id, name: user.name, image: user.image ?? null, text };
  }

  /** a message to the main room: kept (the last `keep`) and written */
  addMain(m) {
    this.main.push(m);
    if (this.main.length > CHAT_LIMITS.keep) this.main.splice(0, this.main.length - CHAT_LIMITS.keep);
    // older rows go now and then: whatever is older than the oldest kept
    const prune = ++this.added % 25 === 0 ? this.main[0]?.at : null;
    this.#write(`message ${m.id}`, async q => {
      await q.insert(chatMessages).values({ id: m.id, userId: m.uid, userName: m.name, userImage: m.image, text: m.text, at: new Date(m.at) }).onConflictDoNothing();
      if (prune != null) await q.delete(chatMessages).where(lt(chatMessages.at, new Date(prune)));
    });
    return m;
  }

  /** delete a main room message: true if there was one */
  removeMain(id) {
    const i = this.main.findIndex(m => m.id === id);
    if (i < 0) return false;
    this.main.splice(i, 1);
    this.#write(`delete ${id}`, q => q.delete(chatMessages).where(eq(chatMessages.id, id)));
    return true;
  }

  /** until when a driver is muted (ms), or 0 */
  mutedUntil(uid) {
    const m = this.mutes.get(uid);
    if (!m) return 0;
    if (m.until > this.now()) return m.until;
    this.mutes.delete(uid);
    return 0;
  }

  /** the mutes under way, soonest over first */
  muteList() {
    for (const id of [...this.mutes.keys()]) this.mutedUntil(id);
    return [...this.mutes.values()].sort((a, b) => a.until - b.until);
  }

  /** mute a driver for `hours` (0: unmute); returns the mute, or null */
  mute(user, hours, by) {
    if (!(hours > 0)) {
      if (!this.mutes.delete(user.id)) return null;
      this.#write(`unmute ${user.id}`, q => q.delete(chatMutes).where(eq(chatMutes.userId, user.id)));
      return null;
    }
    const m = { id: user.id, name: user.name, until: this.now() + Math.min(hours, CHAT_LIMITS.maxMuteHours) * 3600_000, by };
    this.mutes.set(m.id, m);
    const row = { userId: m.id, userName: m.name, until: new Date(m.until), by };
    this.#write(`mute ${m.id}`, q => q.insert(chatMutes).values(row).onConflictDoUpdate({ target: chatMutes.userId, set: { userName: row.userName, until: row.until, by } }));
    return m;
  }

  // one write after the other; a failed one is tried again a few times
  #write(what, fn) {
    if (!this.db) return;
    this.writes = this.writes.then(async () => {
      for (let i = 1; ; i++) {
        try { await fn(this.db.q); return; }
        catch (e) {
          if (i >= CHAT_LIMITS.saveTries) { console.error(`[chat] NOT SAVED: ${what}: ${e.message}`); return; }
          console.warn(`[chat] could not save ${what} (try ${i}): ${e.message}`);
          await sleep(this.retryMs * 2 ** (i - 1));
        }
      }
    });
  }

  /** wait for the writes under way (on shutdown, and in tests) */
  async flush() { await this.writes; }
}

/** The app's store, on the app's database (DATABASE_URL): load() it before use. */
export function chatStore() {
  return new ChatStore(getDb());
}
