// The race server's list of the maps (ticket #318): which exist, their names and versions, kept in memory so a
// room can be answered at once (lib/race/hub.mjs asks info() while it handles a message). It is read from the
// database when the server starts and again whenever a map changes: the store announces every change on a
// Postgres channel (NOTIFY, lib/maps/store.mjs), whoever made it (a route, scripts/maps/add.mjs, another
// process). And once a minute anyway, in case an announcement was missed while the connection was down.
import pg from 'pg';
import { DEFAULT_MAP_ID, DEFAULT_MAP_NAME, MAPS_CHANNEL } from './store.mjs';

export class MapIndex {
  /** @param {{ infos(): Promise<{ id: string, name: string, v: number }[]>, db: { pool: import('pg').Pool } }} store */
  constructor(store) {
    this.store = store;
    /** @type {Map<string, { id: string, name: string, v: number }>} */ this.byId = new Map();
    this.again = false; this.loading = null; this.stopped = false; this.client = null; this.timer = null; this.retry = null;
  }

  /** What a room needs to know about a map (id, name, v: its version), or null. */
  info(id) {
    if (typeof id !== 'string') return null;
    const m = this.byId.get(id);
    return m ? { ...m } : id === DEFAULT_MAP_ID ? { id, name: DEFAULT_MAP_NAME, v: 0 } : null;
  }

  /** Read the list again; calls made meanwhile wait for one more read after this one. */
  load() {
    if (this.loading) { this.again = true; return this.loading; }
    this.loading = (async () => {
      try {
        do { this.again = false; const rows = await this.store.infos(); this.byId = new Map(rows.map(m => [m.id, m])); } while (this.again);
      } finally { this.loading = null; }
    })();
    return this.loading;
  }

  /** Load, then follow the changes until stop(). */
  async watch({ everyMs = 60_000, retryMs = 2000 } = {}) {
    await this.load();
    const quiet = p => p.catch(e => console.warn(`[maps] could not read the maps again: ${e.message}`));
    const listen = async () => {
      if (this.stopped) return;
      const c = new pg.Client(this.store.db.pool.options);
      const lost = () => { if (this.client !== c) return; this.client = null; c.end().catch(() => { }); if (!this.stopped) this.retry = setTimeout(listen, retryMs); };
      c.on('error', lost); c.on('end', lost);
      c.on('notification', () => quiet(this.load()));
      try {
        await c.connect(); this.client = c;
        await c.query(`listen ${MAPS_CHANNEL}`);
        await quiet(this.load());                                    // whatever changed while we were not listening
      } catch (e) { console.warn(`[maps] not listening for changes: ${e.message}`); this.client = c; lost(); }
    };
    await listen();
    this.timer = setInterval(() => quiet(this.load()), everyMs); this.timer.unref?.();
    return this;
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.timer); clearTimeout(this.retry);
    const c = this.client; this.client = null;
    if (c) await c.end().catch(() => { });
  }
}
