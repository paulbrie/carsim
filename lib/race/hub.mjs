// Rooms and races, in memory: one Node process holds every room (run a single replica).
// Transport-free: the WebSocket server (server.mjs) hands each connection to connect() with a
// send function, passes its messages to client.message(), and calls tick() every LIMITS.tickMs.
//
// A race: lobby → countdown (host pressed Start; cars on the grid, held) → racing (green) →
// results (everyone finished, left, or the finish window ran out) → lobby (host, or anyone
// once the host has gone). Each client runs its own physics and reports where its car is
// (positions, relayed to the others), its laps and its finish; the server keeps the order.
// The course is a map (lib/maps/store.mjs): the host picks it in the lobby; a room that waits (lobby, results)
// follows its saves within a second, and it is read again when a race starts, so every car races the map as last saved.
// Best laps (lib/race/records.mjs): every valid lap, raced or driven around the room, goes to the
// records; the room gets its map and ground's ('records') when it joins, changes them, or one improves.
// Both stores answer from memory here (maps: lib/maps/live.mjs; records: read at start); only a ghost's path is fetched.
// A best lap may bring its path (trace), which a player asks for ('ghost') to race against it.
// The chat (#325, lib/race/chat.mjs): the main room ('main') is everyone connected, its last messages kept in the
// database; a race room's ('room') is the room's drivers, and goes with the room. The super admin deletes and mutes.
import { GROUND_KEYS, LIMITS, VEHICLE_KEYS, WEATHER_KEYS, isHex } from './shared.mjs';
import { RECORD_LIMITS, RecordStore } from './records.mjs';
import { CHAT_LIMITS, ChatStore, cleanText } from './chat.mjs';

const DEFAULT_MAP = { id: 'figure-8', name: 'Figure-8', v: 0 };
// a network's lap (#333): a saved autopilot's id (lib/autopilots/store.mjs), and the name of one that isn't saved
const AUTOPILOT_ID = /^[a-z0-9]{6,24}$/;
// a network's lap may be driven faster than real time (the lab's Drive it at 2× or 4×, AI_CFG.speed: #353): its lap time is
// up to this many times the time since the player's previous lap
const NET_SPEED_MAX = 4;
export const UNSAVED_NET = 'Unsaved network';
// how often (ticks) a waiting room looks for a newer version of its map: about a second
const MAP_CHECK_TICKS = Math.max(1, Math.round(1000 / LIMITS.tickMs));
// Car damage: each hit a client's car takes is [cx, cy, cz, dx, dy, dz, vn, kind] in its body space (the sim's
// carHit); the server keeps a player's hits since their last repair, so a late joiner sees the cars as they are.
export const HIT_LIMITS = { perPlayer: 400, ratePerSec: 20, burst: 40 };
function cleanHit(h) {
  if (!Array.isArray(h) || h.length !== 8 || !h.every(x => typeof x === 'number' && Number.isFinite(x))) return null;
  const [cx, cy, cz, dx, dy, dz, vn, kind] = h;
  if (!(kind === 0 || kind === 1 || kind === 2) || Math.hypot(dx, dy, dz) < 0.5) return null;
  const r = (x, d) => Math.round(x * d) / d;
  return [r(clampN(cx, -4, 4), 100), r(clampN(cy, -2, 3), 100), r(clampN(cz, -4, 4), 100), r(clampN(dx, -1, 1), 1000), r(clampN(dy, -1, 1), 1000), r(clampN(dz, -1, 1), 1000), r(clampN(vn, 0, 60), 100), kind];
}

const num = (x, d = 0) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const clampN = (x, a, b) => Math.min(b, Math.max(a, x));
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class RaceHub {
  /** @param {{ now?: () => number, random?: () => number, maps?: { info(id: unknown): { id: string, name: string, v: number } | null }, records?: RecordStore, chat?: ChatStore, nets?: { info(id: string): Promise<{ name: string, ownerName: string, weights?: number, h?: number } | null> } }} [opts] */
  constructor(opts = {}) {
    this.now = opts.now || Date.now;
    this.random = opts.random || Math.random;
    // which maps exist; without a store (tests) only the built-in figure-8
    this.maps = opts.maps || { info: id => id === DEFAULT_MAP.id ? { ...DEFAULT_MAP } : null };
    // best laps; without a store (tests) in memory
    this.records = opts.records || new RecordStore(null, { now: this.now });
    // the saved networks, to name and credit a network's lap (#333); without a store (tests) none
    this.nets = opts.nets || { info: async () => null };
    // the chat's main room and mutes; without a store (tests) in memory
    this.chat = opts.chat || new ChatStore(null, { now: this.now });
    /** @type {Map<string, { n: number, t: number }>} each driver's chat allowance (a token bucket), across reconnects */
    this.chatBudget = new Map();
    // what a room may be set to: shared.mjs's lists, which the dev server gives again when that file changes (setLists)
    this.lists = { vehicles: VEHICLE_KEYS, grounds: GROUND_KEYS, weathers: WEATHER_KEYS };
    /** @type {Map<string, any>} */ this.rooms = new Map();
    /** @type {Set<any>} */ this.clients = new Set();
    this.lobbyDirty = false;
  }

  /**
   * New lists of cars, grounds and weathers (a car added to shared.mjs while the server runs): a list that is
   * not a non-empty array of strings is left as it was. Players keep the car they have.
   * @param {{ vehicles?: unknown, grounds?: unknown, weathers?: unknown }} lists
   */
  setLists(lists) {
    for (const k of ['vehicles', 'grounds', 'weathers']) {
      const v = lists?.[k];
      if (Array.isArray(v) && v.length && v.every(x => typeof x === 'string' && x)) this.lists[k] = [...v];
    }
  }

  /**
   * @param {{ id: string, name: string, image?: string | null, admin?: boolean }} user  admin: the super admin (the chat's moderator)
   * @param {(msg: object) => void} send
   */
  connect(user, send) {
    const client = { user: { id: String(user.id), name: String(user.name || 'Driver').slice(0, 40), image: user.image || null, ...(user.admin === true ? { admin: true } : {}) }, send, room: null, closed: false };
    // one seat per account: a second tab takes over the first one's seat
    for (const c of this.clients) if (c.user.id === client.user.id && !c.closed) { c.send({ t: 'replaced' }); this.#detach(c, true); c.closed = true; this.clients.delete(c); }
    this.clients.add(client);
    send({ t: 'hello', me: client.user, limits: LIMITS });
    send({ t: 'rooms', rooms: this.roomList() });
    send({ t: 'chat', ch: 'main', all: true, msgs: this.chat.main });
    if (client.user.admin) send({ t: 'chatMutes', list: this.chat.muteList() });
    return {
      message: (msg) => this.#onMessage(client, msg),
      // a dropped connection keeps its seat for LIMITS.seatGraceMs, to come back to
      close: () => { if (client.closed) return; client.closed = true; this.#detach(client, true); this.clients.delete(client); },
    };
  }

  roomList() {
    return [...this.rooms.values()].map(r => ({
      id: r.id, name: r.name, host: r.players.get(r.hostId)?.name || '', players: r.players.size, max: LIMITS.maxPlayers,
      phase: r.phase, ground: r.ground, laps: r.laps, map: r.map.name,
    }));
  }

  // ---------------------------------------------------------------- messages
  #onMessage(c, msg) {
    if (c.closed || !msg || typeof msg !== 'object') return;
    const r = c.room;
    switch (msg.t) {
      case 'ping': c.send({ t: 'pong', c: msg.c, s: this.now() }); return;
      case 'create': {
        this.#detach(c, false);
        const room = this.#createRoom(c, msg);
        this.#join(c, room);
        return;
      }
      case 'join': {
        const room = this.rooms.get(String(msg.room || '').toUpperCase());
        if (!room) return c.send({ t: 'error', code: 'no-room', msg: 'That room does not exist (any more).' });
        if (room === r) return this.#sendRoom(room);
        if (room.players.size >= LIMITS.maxPlayers && !room.players.has(c.user.id)) return c.send({ t: 'error', code: 'full', msg: 'That room is full.' });
        this.#detach(c, false);
        this.#join(c, room);
        return;
      }
      case 'leave': this.#detach(c, false); c.send({ t: 'left' }); c.send({ t: 'rooms', rooms: this.roomList() }); return;
      case 'chat': this.#chat(c, msg); return;
      case 'chatDel': this.#chatDelete(c, msg); return;
      case 'chatMute': this.#chatMute(c, msg); return;
    }
    if (!r) return;
    const p = r.players.get(c.user.id);
    if (!p) return;
    switch (msg.t) {
      case 'car': {
        if (r.phase !== 'lobby' && r.phase !== 'results') return;
        if (this.lists.vehicles.includes(msg.vehicle)) { if (msg.vehicle !== p.vehicle) { p.vehicle = msg.vehicle; p.lapMark = this.now(); } }
        // a car the page offers and we don't have: say so, a pick that does nothing looks broken (#313)
        else if (msg.vehicle != null) c.send({ t: 'error', code: 'no-car', msg: 'The race server does not know that car: it is older than this page and needs a restart.' });
        if (isHex(msg.paint)) p.paint = msg.paint.toLowerCase();
        this.#sendRoom(r);
        return;
      }
      case 'ready': if (r.phase === 'lobby') { p.ready = !!msg.ready; this.#sendRoom(r); } return;
      case 'settings': {
        if (r.hostId !== p.id || r.phase !== 'lobby') return;
        const where = `${r.map.id}@${r.map.v}|${r.ground}`;
        if (this.lists.grounds.includes(msg.ground)) r.ground = msg.ground;
        if (this.lists.weathers.includes(msg.weather)) r.weather = msg.weather;
        if (msg.map != null) { const m = this.maps.info(msg.map); if (m) r.map = m; else return c.send({ t: 'error', code: 'no-map', msg: 'That map does not exist (any more).' }); }
        if (msg.laps != null) r.laps = clampN(Math.round(num(msg.laps, r.laps)), LIMITS.minLaps, LIMITS.maxLaps);
        if (typeof msg.name === 'string' && msg.name.trim()) r.name = msg.name.trim().slice(0, 40);
        this.#sendRoom(r); this.lobbyDirty = true;
        if (`${r.map.id}@${r.map.v}|${r.ground}` !== where) this.#newCourse(r);
        return;
      }
      case 'start': {
        if (r.hostId !== p.id || r.phase !== 'lobby') return;
        const waiting = [...r.players.values()].filter(q => q.id !== r.hostId && !q.ready);
        if (waiting.length && !msg.force) return c.send({ t: 'error', code: 'not-ready', msg: `Waiting for ${waiting.map(q => q.name).join(', ')} to be ready.` });
        this.#startCountdown(r);
        return;
      }
      case 'again': {
        if (r.phase !== 'results') return;
        if (r.hostId !== p.id && r.players.has(r.hostId)) return;
        this.#toLobby(r);
        return;
      }
      case 's': {
        // where my car is: [x, y, z], [qx, qy, qz, qw], speed m/s, steer, wheel spin, progress m, lap, skid marks (4 bits a wheel),
        // when (ts: ms on the sender's own clock, passed on as it is: the others draw the car on that clock, #345; 0: not sent)
        const s = msg;
        if (!Array.isArray(s.p) || s.p.length !== 3 || !Array.isArray(s.q) || s.q.length !== 4) return;
        p.state = [...s.p.map(v => Math.round(num(v) * 100) / 100), ...s.q.map(v => Math.round(num(v) * 1e4) / 1e4),
          Math.round(num(s.v) * 10) / 10, Math.round(num(s.st) * 100) / 100, Math.round(num(s.sp) * 100) / 100, clampN(Math.round(num(s.sk)), 0, 0xffff), Math.max(0, Math.round(num(s.ts)))];
        p.stateDirty = true;
        if (r.phase === 'racing' && p.finish == null && !p.dnf) { p.prog = num(s.prog, p.prog); p.lap = clampN(Math.round(num(s.lap, p.lap)), 0, r.laps); }
        return;
      }
      case 'lap': {
        if (msg.net != null) return this.#netLap(r, p, msg);           // the network drove it: a best lap, no race lap
        this.#bestLap(r, p, msg);
        if (r.phase !== 'racing' || p.finish != null || p.dnf) return;
        const lap = clampN(Math.round(num(msg.lap)), 1, r.laps);
        p.laps[lap - 1] = { time: Math.max(0, num(msg.time)), valid: !!msg.valid };
        p.lap = Math.max(p.lap, lap);
        this.#sendRoom(r);
        return;
      }
      case 'finish': {
        if (r.phase !== 'racing' || p.finish != null || p.dnf) return;
        // the client's own clock (lap timing in the sim), unless it is far from the server's
        const server = (this.now() - r.startAt) / 1000, own = num(msg.time, server);
        p.finish = Math.abs(own - server) <= 3 ? own : server;
        p.missed = clampN(Math.round(num(msg.missed)), 0, 999);
        p.lap = r.laps;
        if (r.firstFinishAt == null) r.firstFinishAt = this.now();
        this.#maybeEnd(r);
        this.#sendRoom(r);
        return;
      }
      case 'hit': {
        // our car struck: kept, and to everyone in the room (each sim skips its own)
        const now = this.now();
        p.hitBudget = Math.min(HIT_LIMITS.burst, (p.hitBudget ?? HIT_LIMITS.burst) + (now - (p.hitT ?? now)) / 1000 * HIT_LIMITS.ratePerSec); p.hitT = now;
        const h = cleanHit(msg.h);
        if (!h || p.hitBudget < 1 || p.hits.length >= HIT_LIMITS.perPlayer) return;
        p.hitBudget--; p.hits.push(h);
        this.#broadcast(r, { t: 'hit', id: p.id, h });
        return;
      }
      case 'repair': {
        if (!p.hits.length) return;
        p.hits = [];
        this.#broadcast(r, { t: 'repair', id: p.id });
        return;
      }
      case 'ghost': {
        // a record's lap path, to race against (#310): on the room's map and ground, as laid out now
        const vehicle = String(msg.vehicle), id = String(msg.id);
        const e = this.records.list(r.map.id, r.ground).find(q => q.vehicle === vehicle && q.id === id);
        const reply = { t: 'ghost', map: r.map.id, v: r.map.v, ground: r.ground, vehicle, id, name: e?.name ?? '', time: e?.time ?? null };
        // the path is read from the records' store: the answer follows when it has it
        Promise.resolve(e && e.mv === r.map.v ? this.records.ghost(r.map.id, r.ground, vehicle, id) : null)
          .then(trace => trace ?? null, err => { console.warn(`[hub] ghost: ${err?.message ?? err}`); return null; })
          .then(trace => { if (!c.closed) c.send({ ...reply, trace }); });
        return;
      }
      case 'dnf': {
        if (r.phase !== 'racing' || p.finish != null) return;
        p.dnf = true; this.#maybeEnd(r); this.#sendRoom(r);
        return;
      }
    }
  }

  // ---------------------------------------------------------------- rooms
  #createRoom(c, msg) {
    let id;
    do { id = Array.from({ length: 5 }, () => ROOM_ALPHABET[Math.floor(this.random() * ROOM_ALPHABET.length)]).join(''); } while (this.rooms.has(id));
    const room = {
      id, name: (typeof msg.name === 'string' && msg.name.trim() ? msg.name.trim() : `${c.user.name}'s race`).slice(0, 40),
      hostId: c.user.id, ground: this.lists.grounds.includes(msg.ground) ? msg.ground : 'sand', weather: this.lists.weathers.includes(msg.weather) ? msg.weather : 'clear',
      laps: clampN(Math.round(num(msg.laps, LIMITS.defaultLaps)), LIMITS.minLaps, LIMITS.maxLaps),
      map: (msg.map != null && this.maps.info(msg.map)) || this.#defaultMap(),
      phase: 'lobby', startAt: null, firstFinishAt: null, race: 0, results: null, left: [], players: new Map(), sockets: new Map(), createdAt: this.now(),
      chat: [],
    };
    this.rooms.set(id, room); this.lobbyDirty = true;
    return room;
  }

  #join(c, room) {
    const id = c.user.id;
    let p = room.players.get(id);
    if (!p) {
      const taken = new Set([...room.players.values()].map(q => q.vehicle));
      p = { id, name: c.user.name, image: c.user.image, vehicle: this.lists.vehicles.find(k => !taken.has(k)) || this.lists.vehicles[0], paint: null, ready: false, slot: -1, state: null, stateDirty: false, hits: [], ...this.#raceReset() };
      // late joiners watch the race in progress
      if (room.phase === 'countdown' || room.phase === 'racing') p.spectator = true;
      room.players.set(id, p);
    }
    p.goneAt = null; p.lapMark = this.now();
    room.sockets.set(id, c);
    c.room = room;
    this.lobbyDirty = true;
    this.#sendRoom(room);
    // the cars' damage so far (everyone's, ours included: a reloaded page starts with its car as built and says so)
    const all = {}; for (const q of room.players.values()) if (q.hits.length) all[q.id] = q.hits;
    c.send({ t: 'hits', all });
    c.send(this.#recordsMsg(room));
    c.send({ t: 'chat', ch: 'room', all: true, msgs: room.chat });
  }

  // leaving a room; with keepSeat (a dropped or replaced connection) the seat waits for the
  // player to come back, and tick() frees it after LIMITS.seatGraceMs
  #detach(c, keepSeat) {
    const room = c.room; if (!room) return;
    c.room = null;
    if (room.sockets.get(c.user.id) !== c) return;
    room.sockets.delete(c.user.id);
    const p = room.players.get(c.user.id);
    if (keepSeat && p) { p.goneAt = this.now(); this.#sendRoom(room); return; }
    this.#removePlayer(room, c.user.id);
  }

  // a racer still on track when they go is out of the race
  #removePlayer(room, id) {
    const p = room.players.get(id);
    room.sockets.get(id)?.send({ t: 'left' });
    room.sockets.delete(id);
    room.players.delete(id);
    if (p && room.phase === 'racing' && p.finish == null && !p.spectator) room.left.push({ ...p, dnf: true });
    if (!room.players.size) { this.rooms.delete(room.id); this.lobbyDirty = true; return; }
    if (room.hostId === id) room.hostId = room.players.keys().next().value;   // the longest-seated player takes over
    if (room.phase === 'racing') this.#maybeEnd(room);
    if (room.phase === 'countdown' && ![...room.players.values()].some(q => !q.spectator)) this.#toLobby(room);
    this.lobbyDirty = true;
    this.#broadcast(room, { t: 'gone', id });
    this.#sendRoom(room);
  }

  #raceReset() { return { lap: 0, prog: 0, laps: [], finish: null, missed: 0, dnf: false, spectator: false }; }

  #defaultMap() { return this.maps.info(DEFAULT_MAP.id) || { ...DEFAULT_MAP }; }

  // the map as last saved (an edit since it was picked gets a new v, and the sims load it on the grid),
  // or the figure-8 if it has been deleted
  #refreshMap(r) {
    const was = `${r.map.id}@${r.map.v}`;
    r.map = this.maps.info(r.map.id) || this.#defaultMap();
    if (`${r.map.id}@${r.map.v}` === was) return false;
    this.#newCourse(r);
    return true;
  }

  // another map, version or ground: the sims load it, so no lap under way counts; the room's records
  #newCourse(r) {
    for (const q of r.players.values()) q.lapMark = this.now();
    this.#broadcast(r, this.#recordsMsg(r));
  }

  // ---------------------------------------------------------------- chat
  // a message to the main room (anyone connected) or to the race room the sender is in
  #chat(c, msg) {
    const ch = msg.ch === 'room' ? 'room' : msg.ch === 'main' ? 'main' : null, room = c.room;
    if (!ch || (ch === 'room' && !room?.players.has(c.user.id))) return;
    const text = cleanText(msg.text);
    if (!text) return;
    const until = this.chat.mutedUntil(c.user.id);
    if (until) return c.send({ t: 'error', code: 'chat-muted', msg: `You can't write in the chat until ${new Date(until).toISOString().slice(0, 16).replace('T', ' ')} UTC.` });
    // a few at once, then one every 1 / perSec s
    const now = this.now(), b = this.chatBudget.get(c.user.id) ?? { n: CHAT_LIMITS.burst, t: now };
    b.n = Math.min(CHAT_LIMITS.burst, b.n + (now - b.t) / 1000 * CHAT_LIMITS.perSec); b.t = now;
    if (b.n < 1) { this.chatBudget.set(c.user.id, b); return c.send({ t: 'error', code: 'chat-rate', msg: 'Not so fast: wait a moment before the next message.' }); }
    b.n--; this.chatBudget.set(c.user.id, b);
    if (this.chatBudget.size > 5000) for (const [id, q] of this.chatBudget) if (now - q.t > 60_000) this.chatBudget.delete(id);
    const m = this.chat.message(c.user, text);
    if (ch === 'main') { this.chat.addMain(m); for (const q of this.clients) q.send({ t: 'chat', ch, msgs: [m] }); }
    else {
      room.chat.push(m); if (room.chat.length > CHAT_LIMITS.roomKeep) room.chat.splice(0, room.chat.length - CHAT_LIMITS.roomKeep);
      this.#broadcast(room, { t: 'chat', ch, msgs: [m] });
    }
  }

  // the super admin deletes a message: in the main room, or in the race room they are in
  #chatDelete(c, msg) {
    if (!c.user.admin) return;
    const id = String(msg.id ?? '');
    if (msg.ch === 'main') { if (this.chat.removeMain(id)) for (const q of this.clients) q.send({ t: 'chatDel', ch: 'main', id }); return; }
    const room = c.room, i = room ? room.chat.findIndex(m => m.id === id) : -1;
    if (i < 0) return;
    room.chat.splice(i, 1);
    this.#broadcast(room, { t: 'chatDel', ch: 'room', id });
  }

  // the super admin mutes a driver for `hours` (CHAT_LIMITS.muteHours by default), or lets them speak again (hours 0)
  #chatMute(c, msg) {
    if (!c.user.admin) return;
    const id = String(msg.id ?? ''), name = String(msg.name ?? '').slice(0, 40) || 'Driver';
    if (!id || id === c.user.id) return;
    const hours = msg.hours == null ? CHAT_LIMITS.muteHours : clampN(num(msg.hours), 0, CHAT_LIMITS.maxMuteHours);
    this.chat.mute({ id, name }, hours, c.user.id);
    const list = this.chat.muteList();
    for (const q of this.clients) if (q.user.admin) q.send({ t: 'chatMutes', list });
  }

  // ---------------------------------------------------------------- best laps
  // A lap the client timed. It can't be longer than the time since its previous lap (or since it joined,
  // changed car or course, or the race went green), give or take a second.
  #bestLap(r, p, msg) {
    if (!this.#lapCounts(r, p, msg)) return;
    this.#newRecord(this.records.submit({ map: r.map.id, mv: r.map.v, ground: r.ground, vehicle: p.vehicle, user: { id: p.id, name: p.name, image: p.image }, time: num(msg.time), splits: msg.splits, trace: msg.trace }));
  }

  // a lap's time no longer than since the player's previous one (or since they joined, changed car or course...)
  #lapCounts(r, p, msg, speed = 1) {
    const now = this.now(), since = (now - (p.lapMark ?? now)) / 1000, time = num(msg.time, -1);
    p.lapMark = now;                                                  // the next lap starts here
    return msg.valid === true && !p.spectator && r.phase !== 'countdown' && time <= since * speed + 1;
  }

  #newRecord(rec) {
    if (!rec) return;
    for (const room of this.rooms.values()) if (room.map.id === rec.map && room.ground === rec.ground) this.#broadcast(room, this.#recordsMsg(room));
  }

  // A lap the player's network drove (#333: the autopilot's Drive it, outside races): a best lap like a human's, of
  // the network as a driver of its own. A saved network (net.id) is named and credited as the server has it: `tnn:<id>`,
  // whoever drives it; any other is the player's unsaved network, `tnn:local:<player>`. Never a race lap.
  #netLap(r, p, msg) {
    if (r.phase === 'racing' || !this.#lapCounts(r, p, msg, NET_SPEED_MAX)) return;   // (sped up: #353)
    const n = msg.net && typeof msg.net === 'object' ? msg.net : {}, id = typeof n.id === 'string' && AUTOPILOT_ID.test(n.id) ? n.id : null;
    const at = { map: r.map.id, mv: r.map.v, ground: r.ground, vehicle: p.vehicle }, time = num(msg.time), splits = msg.splits, trace = msg.trace;
    const size = { weights: Math.round(num(n.weights)), h: Math.round(num(n.h)) };
    Promise.resolve(id ? this.nets.info(id) : null).catch(() => null).then(a => {
      const net = a ? { autopilot: id, name: a.name, creator: a.ownerName, weights: a.weights ?? size.weights, h: a.h ?? size.h }
        : { autopilot: null, name: UNSAVED_NET, creator: p.name, ...size };
      this.#newRecord(this.records.submit({ ...at, user: { id: a ? `tnn:${id}` : `tnn:local:${p.id}`, name: net.name, image: null }, time, splits, trace, net }));
    });
  }

  /** a room's map and ground's best laps: the fastest, and every one of its drivers' */
  #recordsMsg(r) {
    const all = this.records.list(r.map.id, r.ground);
    const list = all.filter((e, i) => i < RECORD_LIMITS.listMax || r.players.has(e.id))
      .map(e => ({ id: e.id, name: e.name, image: e.image, vehicle: e.vehicle, time: e.time, splits: e.mv === r.map.v ? e.splits : [], mv: e.mv, at: e.at, ghost: !!e.ghost && e.mv === r.map.v, ...(e.net ? { net: e.net } : {}) }));
    return { t: 'records', map: r.map.id, v: r.map.v, ground: r.ground, list };
  }

  #startCountdown(r) {
    this.#refreshMap(r);
    r.phase = 'countdown'; r.race++;
    r.startAt = this.now() + LIMITS.countdownMs; r.firstFinishAt = null; r.results = null; r.left = [];
    // grid: in the order they joined the room, the host first
    const order = [r.players.get(r.hostId), ...[...r.players.values()].filter(q => q.id !== r.hostId)];
    order.forEach((q, i) => { Object.assign(q, this.#raceReset()); q.slot = i; q.ready = false; q.lapMark = r.startAt; });
    this.lobbyDirty = true;
    this.#sendRoom(r);
  }

  #maybeEnd(r) {
    if (r.phase !== 'racing') return;
    const racers = [...r.players.values()].filter(q => !q.spectator);
    const now = this.now();
    const allDone = racers.every(q => q.finish != null || q.dnf);
    const windowOver = r.firstFinishAt != null && now - r.firstFinishAt >= LIMITS.finishWindowMs;
    const tooLong = now - r.startAt >= LIMITS.maxRaceMs;
    if (!allDone && !windowOver && !tooLong) return;
    r.phase = 'results';
    r.results = this.standings(r).map(s => ({ ...s, dnf: s.finish == null }));
    for (const q of r.players.values()) { q.ready = false; q.spectator = false; }
    this.lobbyDirty = true;
  }

  #toLobby(r) {
    this.#refreshMap(r);
    r.phase = 'lobby'; r.startAt = null; r.firstFinishAt = null;
    for (const q of r.players.values()) { Object.assign(q, this.#raceReset()); q.ready = false; q.slot = -1; }
    this.lobbyDirty = true;
    this.#sendRoom(r);
  }

  /** Race order: finishers by time (with penalties), then those running by laps and distance, then retired. */
  standings(r) {
    const pen = LIMITS.missedGatePenalty;
    const all = [...r.players.values(), ...(r.left || [])].filter(q => !q.spectator && q.slot >= 0);
    const total = q => q.finish != null ? q.finish + q.missed * pen : null;
    all.sort((a, b) => {
      const fa = total(a), fb = total(b);
      if (fa != null || fb != null) return fa == null ? 1 : fb == null ? -1 : fa - fb;
      if (a.dnf !== b.dnf) return a.dnf ? 1 : -1;
      return b.prog - a.prog;
    });
    const lead = all[0];
    return all.map((q, i) => ({
      id: q.id, name: q.name, image: q.image, vehicle: q.vehicle, paint: q.paint, pos: i + 1, lap: q.lap, prog: Math.round(q.prog),
      finish: q.finish, missed: q.missed, total: total(q), dnf: !!q.dnf, left: !r.players.has(q.id),
      gap: i === 0 || !lead ? null : total(q) != null && total(lead) != null ? +(total(q) - total(lead)).toFixed(3) : Math.round(lead.prog - q.prog),
      gapUnit: i === 0 ? null : total(q) != null ? 's' : 'm',
    }));
  }

  // ---------------------------------------------------------------- output
  roomView(r) {
    return {
      id: r.id, name: r.name, hostId: r.hostId, ground: r.ground, weather: r.weather, laps: r.laps, map: r.map, phase: r.phase, race: r.race,
      startsIn: r.phase === 'countdown' ? Math.max(0, r.startAt - this.now()) : null,
      elapsed: r.phase === 'racing' ? (this.now() - r.startAt) / 1000 : null,
      finishWindowLeft: r.phase === 'racing' && r.firstFinishAt != null ? Math.max(0, LIMITS.finishWindowMs - (this.now() - r.firstFinishAt)) : null,
      players: [...r.players.values()].map(q => ({
        id: q.id, name: q.name, image: q.image, vehicle: q.vehicle, paint: q.paint, ready: q.ready, slot: q.slot, spectator: q.spectator,
        lap: q.lap, laps: q.laps, finish: q.finish, missed: q.missed, dnf: q.dnf, connected: r.sockets.has(q.id),
      })),
      standings: r.phase === 'racing' || r.phase === 'countdown' ? this.standings(r) : null,
      results: r.results,
    };
  }

  #sendRoom(r) { this.#broadcast(r, { t: 'room', room: this.roomView(r) }); }
  #broadcast(r, msg) { for (const c of r.sockets.values()) c.send(msg); }

  /** Called every LIMITS.tickMs: phase timers, positions, standings, the lobby's room list. */
  tick() {
    const now = this.now();
    for (const r of [...this.rooms.values()]) {
      for (const q of [...r.players.values()]) if (q.goneAt != null && !r.sockets.has(q.id) && now - q.goneAt >= LIMITS.seatGraceMs) this.#removePlayer(r, q.id);
      if (!this.rooms.has(r.id)) continue;
      if (r.phase === 'countdown' && now >= r.startAt) { r.phase = 'racing'; this.lobbyDirty = true; this.#sendRoom(r); }
      if (r.phase === 'racing') { const before = r.phase; this.#maybeEnd(r); if (r.phase !== before) this.#sendRoom(r); }
      // a map saved (or deleted) while the room waits: the sims load it now, not at the next race's start (#324: a room
      // opened before the map was edited showed the old course). A race under way keeps the one it started on.
      if ((r.phase === 'lobby' || r.phase === 'results') && (r.mapT = (r.mapT || 0) + 1) % MAP_CHECK_TICKS === 0 && this.#refreshMap(r)) { this.lobbyDirty = true; this.#sendRoom(r); }
      // positions of every car that moved, to everyone in the room (each client skips its own)
      const cars = [];
      for (const q of r.players.values()) if (q.stateDirty && q.state) { cars.push([q.id, ...q.state]); q.stateDirty = false; }
      if (cars.length && r.sockets.size > 1) this.#broadcast(r, { t: 'snap', cars });
      if (r.phase === 'racing' && (r.standT = (r.standT || 0) + 1) % 5 === 0) this.#broadcast(r, { t: 'standings', standings: this.standings(r), elapsed: (now - r.startAt) / 1000, finishWindowLeft: r.firstFinishAt != null ? Math.max(0, LIMITS.finishWindowMs - (now - r.firstFinishAt)) : null });
    }
    if (this.lobbyDirty) {
      this.lobbyDirty = false;
      const rooms = this.roomList();
      for (const c of this.clients) if (!c.room) c.send({ t: 'rooms', rooms });
    }
  }
}
