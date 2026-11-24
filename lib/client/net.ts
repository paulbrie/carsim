'use client';
// The browser's side of the race server: one WebSocket for the tab, reconnecting on its own,
// with what it hears kept in subjecto Subjects the React UI subscribes to (useSubject).
// Car positions ('snap') skip the Subjects: they go straight to the sim (onSnap); so does the cars'
// damage (onDamage), kept here too (damageLog) for a sim that loads after it came.
import { Subject } from 'subjecto';
import { withBase } from '@/lib/base-path';
import type { CarHit, CarSnap, ChatChannel, ChatMsg, ChatMute, GhostLap, Me, Records, RoomSummary, RoomView, ServerMsg, Standing } from '@/lib/race/types';

export type NetStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'replaced' | 'unauthorized';

export const status$ = new Subject<NetStatus>('idle');
export const me$ = new Subject<Me | null>(null);
export const rooms$ = new Subject<RoomSummary[]>([]);
export const room$ = new Subject<RoomView | null>(null);
export const standings$ = new Subject<{ list: Standing[]; elapsed: number; finishWindowLeft: number | null } | null>(null);
/** the room's map and ground's best laps */
export const records$ = new Subject<Records | null>(null);
/** the last best lap's path we asked for (lib/client/ghost.ts) */
export const ghost$ = new Subject<GhostLap | null>(null);
export const errors$ = new Subject<{ code: string; msg: string; at: number } | null>(null);
/** the chat (#325): the main room's messages and the race room's, oldest first; the mutes (the super admin's) */
export const chat$: Record<ChatChannel, Subject<ChatMsg[]>> = { main: new Subject<ChatMsg[]>([]), room: new Subject<ChatMsg[]>([]) };
export const chatMutes$ = new Subject<ChatMute[]>([]);
const CHAT_KEEP = 200;

type SnapListener = (cars: CarSnap[]) => void;
const snapListeners = new Set<SnapListener>();
export function onSnap(fn: SnapListener) { snapListeners.add(fn); return () => { snapListeners.delete(fn); }; }
const goneListeners = new Set<(id: string) => void>();
export function onGone(fn: (id: string) => void) { goneListeners.add(fn); return () => { goneListeners.delete(fn); }; }

/** every player's hits since their last repair, as the server keeps them; the room's */
const damage = new Map<string, CarHit[]>();
export const damageLog = () => Object.fromEntries(damage);
export type DamageMsg = { t: 'hit'; id: string; h: CarHit } | { t: 'repair'; id: string } | { t: 'hits'; all: Record<string, CarHit[]> };
const damageListeners = new Set<(m: DamageMsg) => void>();
export function onDamage(fn: (m: DamageMsg) => void) { damageListeners.add(fn); return () => { damageListeners.delete(fn); }; }
function onDamageMsg(m: DamageMsg) {
  if (m.t === 'hits') { damage.clear(); for (const [id, list] of Object.entries(m.all)) damage.set(id, [...list]); }
  else if (m.t === 'hit') damage.set(m.id, [...(damage.get(m.id) || []), m.h]);
  else damage.delete(m.id);
  for (const fn of damageListeners) fn(m);
}

let ws: WebSocket | null = null;
let wanted = false, opening = false, retry = 0, retryTimer: ReturnType<typeof setTimeout> | null = null;
// the room to be in: re-joined after a reconnect
let wantedRoom: string | null = null;

export function connect() {
  wanted = true;
  if (opening || (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING))) return;
  open();
}

async function open() {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  status$.next('connecting');
  opening = true;
  let ticket: string;
  try {
    const r = await fetch(withBase('/api/ws-ticket'), { cache: 'no-store' });
    if (r.status === 401) { opening = false; status$.next('unauthorized'); return; }
    ticket = (await r.json()).ticket;
  } catch { opening = false; scheduleRetry(); return; }
  opening = false;
  if (!wanted) return;
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${withBase('/ws')}?ticket=${encodeURIComponent(ticket)}`;
  const sock = new WebSocket(url);
  ws = sock;
  sock.onopen = () => {
    retry = 0; status$.next('open');
    if (wantedRoom) send({ t: 'join', room: wantedRoom });
  };
  sock.onmessage = ev => {
    let m: ServerMsg; try { m = JSON.parse(ev.data); } catch { return; }
    handle(m);
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null;
    if (status$.getValue() === 'replaced') return;
    status$.next('closed');
    if (wanted) scheduleRetry();
  };
}

function scheduleRetry() {
  const delay = Math.min(10_000, 500 * 2 ** retry++) * (0.75 + Math.random() * 0.5);
  retryTimer = setTimeout(() => { if (wanted) open(); }, delay);
}

function handle(m: ServerMsg) {
  switch (m.t) {
    case 'hello': me$.next(m.me); break;
    case 'rooms': rooms$.next(m.rooms); break;
    case 'room':
      room$.next(m.room);
      if (m.room.phase !== 'racing') standings$.next(null);
      break;
    case 'snap': for (const fn of snapListeners) fn(m.cars); break;
    case 'standings': standings$.next({ list: m.standings, elapsed: m.elapsed, finishWindowLeft: m.finishWindowLeft }); break;
    case 'gone': damage.delete(m.id); for (const fn of goneListeners) fn(m.id); break;
    case 'hit': case 'repair': case 'hits': onDamageMsg(m); break;
    case 'records': { const { t: _, ...r } = m; records$.next(r); break; }
    case 'ghost': { const { t: _, ...g } = m; ghost$.next(g); break; }
    case 'chat': { const s = chat$[m.ch]; if (!s) break; const list = m.all ? m.msgs : [...s.getValue(), ...m.msgs]; s.next(list.slice(-CHAT_KEEP)); break; }
    case 'chatDel': { const s = chat$[m.ch]; if (s) s.next(s.getValue().filter(x => x.id !== m.id)); break; }
    case 'chatMutes': chatMutes$.next(m.list); break;
    case 'left': damage.clear(); room$.next(null); records$.next(null); chat$.room.next([]); break;
    case 'replaced': status$.next('replaced'); wanted = false; ws?.close(); break;
    case 'error': errors$.next({ code: m.code, msg: m.msg, at: Date.now() }); break;
  }
}

export function send(msg: { t: string;[k: string]: unknown }) {
  if (ws?.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(msg)); return true; }
  return false;
}

let leaveTimer: ReturnType<typeof setTimeout> | null = null;
export function joinRoom(id: string) {
  if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; }
  wantedRoom = id.toUpperCase(); connect(); send({ t: 'join', room: wantedRoom });
}
export function leaveRoom() {
  if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; }
  wantedRoom = null; send({ t: 'leave' }); room$.next(null); records$.next(null); chat$.room.next([]);
}
/** leave unless the same page mounts again at once (React's dev double effects), which re-joins */
export function leaveRoomSoon() {
  if (leaveTimer) clearTimeout(leaveTimer);
  leaveTimer = setTimeout(() => { leaveTimer = null; leaveRoom(); }, 150);
}
/** after the server put us in a room we created */
export function setWantedRoom(id: string | null) { wantedRoom = id; }
/** a 'replaced' tab taking its seat back */
export function reclaim() { status$.next('idle'); connect(); }

/** a chat message to the main room or our race room; false if not connected */
export const sendChat = (ch: ChatChannel, text: string) => send({ t: 'chat', ch, text });

/** errors from now on (a Subject hands a new subscriber its current value, here the last error) */
export function onError(fn: (e: { code: string; msg: string }) => void) {
  let first = true;
  const s = errors$.subscribe(e => { if (first) { first = false; return; } if (e) fn(e); });
  return () => s.unsubscribe();
}
