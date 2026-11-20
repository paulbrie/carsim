'use client';
// The sim (public/sim, the original single-file engine) in an iframe, and the bridge between it
// and the race server: the room, the phase and the other cars go in by postMessage; our car's
// position, laps and finish come out and go to the server as they are.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { onGone, onSnap, send } from '@/lib/client/net';
import { paintOf } from '@/components/race-controls';
import type { RoomView } from '@/lib/race/types';

export interface SimHandle { focus(): void }

export const SimFrame = forwardRef<SimHandle, { room: RoomView; meId: string; onReady?: () => void }>(function SimFrame({ room, meId, onReady }, handle) {
  const frame = useRef<HTMLIFrameElement>(null);
  const live = useRef(false);
  const [ready, setReady] = useState(false);
  const mine = room.players.find(p => p.id === meId);

  // the page loads once, with the car and ground of the moment; later changes go by message
  const [src] = useState(() => {
    const q = new URLSearchParams({ mp: '1', ground: room.ground, vehicle: mine?.vehicle ?? 'buggy', spawn: String(Math.max(0, room.players.findIndex(p => p.id === meId))) });
    if (mine?.paint) q.set('paint', mine.paint);
    return `/sim/index.html?${q}`;
  });

  const post = useCallback((m: object) => {
    if (live.current) frame.current?.contentWindow?.postMessage(m, location.origin);
  }, []);

  useImperativeHandle(handle, () => ({
    focus() { frame.current?.focus(); post({ t: 'focus' }); },
  }), [post]);

  // from the sim
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.source !== frame.current?.contentWindow) return;
      const m = e.data;
      if (!m || typeof m !== 'object') return;
      if (m.t === 'ready') { live.current = true; setReady(true); onReady?.(); }
      else if (m.t === 's' || m.t === 'lap' || m.t === 'finish') send(m);
    };
    addEventListener('message', onMessage);
    return () => removeEventListener('message', onMessage);
  }, [onReady]);

  // the other cars, straight from the socket
  useEffect(() => {
    const a = onSnap(cars => post({ t: 'snap', cars }));
    const b = onGone(id => post({ t: 'gone', id }));
    return () => { a(); b(); };
  }, [post]);

  // the room, whenever it changes (the sim ignores what it already has)
  useEffect(() => {
    if (!ready) return;
    post({ t: 'init', me: meId });
    post({ t: 'roster', players: room.players.map(p => ({ id: p.id, name: p.name, vehicle: p.vehicle, paint: p.paint, col: paintOf(p.vehicle, p.paint), spectator: p.spectator })) });
    post({ t: 'ground', ground: room.ground });
    if (mine && (room.phase === 'lobby' || room.phase === 'results')) post({ t: 'car', vehicle: mine.vehicle, paint: mine.paint });
    post({ t: 'phase', phase: room.phase, race: room.race, startsIn: room.startsIn, slot: mine?.slot ?? -1, laps: room.laps, spectator: mine?.spectator ?? false, elapsed: room.elapsed });
  }, [ready, room, meId, mine, post]);

  return (
    <iframe ref={frame} src={src} title="Race simulation: click here, then drive with W A S D or the arrow keys"
      className="absolute inset-0 size-full border-0 bg-[#e7d3ad]" allow="autoplay; fullscreen" />
  );
});
