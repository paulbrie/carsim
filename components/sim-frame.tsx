'use client';
// The sim (public/sim, the original single-file engine) in an iframe, and the bridge between it
// and the race server: the room, the phase, the other cars and the best laps go in by postMessage;
// our car's position, laps and finish come out and go to the server as they are.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useSubject } from 'subjecto/react';
import { damageLog, ghost$, onDamage, onGone, onSnap, records$, send } from '@/lib/client/net';
import { ghostMode$, pickGhost } from '@/lib/client/ghost';
import { withBase } from '@/lib/base-path';
import { paintOf } from '@/components/race-controls';
import type { RoomView } from '@/lib/race/types';
import type { SimCourse } from '@/lib/client/maps';

export interface SimHandle { focus(): void; closeDrawers(): void }

// onChatKey: Enter in the sim, to write in the chat (#325)
// onDrawer: one of the sim's drawers (the car's setup, the lab) opened down its left side, or the last one closed (#332)
export const SimFrame = forwardRef<SimHandle, { room: RoomView; meId: string; course: SimCourse; onReady?: () => void; onChatKey?: () => void; onDrawer?: (open: boolean) => void }>(function SimFrame({ room, meId, course, onReady, onChatKey, onDrawer }, handle) {
  const frame = useRef<HTMLIFrameElement>(null);
  const live = useRef(false);
  const [ready, setReady] = useState(false);
  const [records] = useSubject(records$);
  const [ghostMode] = useSubject(ghostMode$);
  const [ghost] = useSubject(ghost$);
  const mine = room.players.find(p => p.id === meId);

  // the page loads once, with the course, car and ground of the moment; later changes go by message.
  // The course is too big for the URL: the sim reads it from this window as it boots (same origin).
  const [src] = useState(() => {
    if (typeof window !== 'undefined') window.__simCourse = course;
    const q = new URLSearchParams({ mp: '1', ground: room.ground, weather: room.weather ?? 'clear', vehicle: mine?.vehicle ?? 'buggy', spawn: String(Math.max(0, room.players.findIndex(p => p.id === meId))) });
    if (mine?.paint) q.set('paint', mine.paint);
    return withBase(`/sim/index.html?${q}`);
  });

  const post = useCallback((m: object) => {
    if (live.current) frame.current?.contentWindow?.postMessage(m, location.origin);
  }, []);

  useImperativeHandle(handle, () => ({
    focus() { frame.current?.focus(); post({ t: 'focus' }); },
    closeDrawers() { post({ t: 'drawers', close: true }); },
  }), [post]);

  // from the sim
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.source !== frame.current?.contentWindow) return;
      const m = e.data;
      if (!m || typeof m !== 'object') return;
      if (m.t === 'ready') {
        live.current = true; setReady(true); onReady?.();
        send({ t: 'repair' });                         // our car starts as built (the server may remember it dented, from before a reload)
        post({ t: 'hits', all: damageLog() });          // and the others' as they are
      }
      else if (m.t === 's' || m.t === 'lap' || m.t === 'finish' || m.t === 'hit' || m.t === 'repair') send(m);
      else if (m.t === 'chatKey') onChatKey?.();
      else if (m.t === 'drawer') onDrawer?.(m.open === true);
    };
    addEventListener('message', onMessage);
    return () => removeEventListener('message', onMessage);
  }, [onReady, onChatKey, onDrawer, post]);

  // the other cars, straight from the socket
  useEffect(() => {
    const a = onSnap(cars => post({ t: 'snap', cars }));
    const b = onGone(id => post({ t: 'gone', id }));
    const c = onDamage(m => post(m));
    return () => { a(); b(); c(); };
  }, [post]);

  // the room, whenever it changes (the sim ignores what it already has)
  useEffect(() => {
    if (!ready) return;
    post({ t: 'init', me: meId });
    post({ t: 'roster', players: room.players.map(p => ({ id: p.id, name: p.name, vehicle: p.vehicle, paint: p.paint, col: paintOf(p.vehicle, p.paint), spectator: p.spectator })) });
    post({ t: 'ground', ground: room.ground });
    post({ t: 'weather', weather: room.weather ?? 'clear' });
    if (mine && (room.phase === 'lobby' || room.phase === 'results')) post({ t: 'car', vehicle: mine.vehicle, paint: mine.paint });
    post({ t: 'phase', phase: room.phase, race: room.race, startsIn: room.startsIn, slot: mine?.slot ?? -1, laps: room.laps, spectator: mine?.spectator ?? false, elapsed: room.elapsed });
  }, [ready, room, meId, mine, post]);

  // the best laps on the room's map and ground (the timer's BEST, its checkpoint deltas, the car's record)
  useEffect(() => {
    if (ready && records) post({ t: 'records', ...records });
  }, [ready, records, post]);

  // the ghost car (#310): the chosen best lap's path, asked of the server when the choice or the lap changes
  const want = useMemo(() => pickGhost(records, ghostMode, meId, mine?.vehicle), [records, ghostMode, meId, mine?.vehicle]);
  const wantKey = want && records ? `${records.map}@${records.v}|${records.ground}|${want.vehicle}|${want.id}|${want.time}` : null;
  useEffect(() => {
    if (want) send({ t: 'ghost', id: want.id, vehicle: want.vehicle });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantKey]);
  useEffect(() => {
    if (!ready) return;
    const g = ghost, ok = !!(want && records && g?.trace && g.id === want.id && g.vehicle === want.vehicle && g.time === want.time
      && g.map === records.map && g.v === records.v && g.ground === records.ground);
    post(ok ? { t: 'ghost', key: wantKey, course: `${g!.map}@${g!.v}`, ground: g!.ground, vehicle: g!.vehicle, name: g!.name, time: g!.time, trace: g!.trace } : { t: 'ghost', key: null });
  }, [ready, ghost, want, wantKey, records, post]);

  // the room's map: another one picked, or saved since (the sim skips the key it has)
  useEffect(() => {
    window.__simCourse = course;
    if (ready) post({ t: 'course', key: course.key, course: course.course });
  }, [ready, course, post]);

  return (
    <iframe ref={frame} src={src} title="Race simulation: click here, then drive with W A S D or the arrow keys"
      className="absolute inset-0 size-full border-0 bg-background" allow="autoplay; fullscreen" />
  );
});
