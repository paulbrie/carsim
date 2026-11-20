'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSubject } from 'subjecto/react';
import { toast } from 'sonner';
import { Check, ChevronLeft, Crown, Flag, Link2, LogOut, PanelLeftClose, PanelLeftOpen, Timer, Trophy, Wifi, WifiOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DriverAvatar } from '@/components/user-menu';
import { SimFrame, type SimHandle } from '@/components/sim-frame';
import { PHASE_LABEL } from '@/components/lobby';
import { GroundControl, LapsControl, MapControl, PaintPicker, StatusBadge, VehiclePicker, fmtTime, groundName, paintOf, vehicleName } from '@/components/race-controls';
import { cn } from '@/lib/utils';
import { withBase } from '@/lib/base-path';
import { LIMITS } from '@/lib/race/shared.mjs';
import { useMaps, useRoomCourse } from '@/lib/client/maps';
import { connect, joinRoom, leaveRoom, leaveRoomSoon, me$, onError, reclaim, room$, send, standings$, status$ } from '@/lib/client/net';
import type { PlayerView, RoomView, Standing } from '@/lib/race/types';

export function RaceRoom({ roomId }: { roomId: string; user: { name: string; image: string | null } }) {
  const router = useRouter();
  const [status] = useSubject(status$);
  const [me] = useSubject(me$);
  const [room] = useSubject(room$);
  const [panel, setPanel] = useState(true);
  const [simReady, setSimReady] = useState(false);
  const sim = useRef<SimHandle>(null);

  useEffect(() => {
    connect(); joinRoom(roomId);
    return () => { leaveRoomSoon(); };
  }, [roomId]);
  useEffect(() => onError(e => {
    toast.error(e.msg);
    if (e.code === 'no-room' || e.code === 'full') router.replace('/lobby');
  }), [router]);

  const phase = room?.phase;
  const mine = room?.players.find(p => p.id === me?.id);
  const isHost = !!room && room.hostId === me?.id;

  // the panel steps aside for the race and comes back for the results; the keys go to the car
  const lastPhase = useRef(phase);
  useEffect(() => {
    if (phase === lastPhase.current) return;
    lastPhase.current = phase;
    if (phase === 'countdown') { setPanel(false); sim.current?.focus(); }
    if (phase === 'lobby') setPanel(true);
  }, [phase]);

  const course = useRoomCourse(room?.id === roomId ? room.map : undefined, msg => toast.error(msg));
  const maps = useMaps(isHost);

  const onSimReady = useCallback(() => setSimReady(true), []);
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(`${location.origin}${withBase(`/race/${roomId}`)}`); toast.success('Invite link copied'); }
    catch { toast.message(`Room code: ${roomId}`); }
  };
  const leave = () => { leaveRoom(); router.push('/lobby'); };

  if (status === 'replaced') return (
    <Blocker title="This race is open in another tab" body="You can only drive one car at a time.">
      <Button onClick={() => { reclaim(); joinRoom(roomId); }}>Race in this tab</Button>
      <Button variant="outline" asChild><Link href="/lobby">Lobby</Link></Button>
    </Blocker>
  );
  if (status === 'unauthorized') return (
    <Blocker title="Signed out" body="Sign in again to race."><Button asChild><Link href={`/?next=/race/${roomId}`}>Sign in</Link></Button></Blocker>
  );
  if (!room || !me || room.id !== roomId) return (
    <Blocker title={`Joining room ${roomId}…`} body={status === 'open' ? 'Taking a seat.' : 'Connecting to the race server.'}>
      <Button variant="outline" asChild><Link href="/lobby"><ChevronLeft /> Lobby</Link></Button>
    </Blocker>
  );

  return (
    <div className="fixed inset-0 overflow-hidden bg-black">
      {course && <SimFrame ref={sim} room={room} meId={me.id} course={course} onReady={onSimReady} />}

      {(phase === 'racing' || phase === 'countdown') && <StandingsPanel room={room} meId={me.id} />}

      {panel ? (
        <aside aria-label="Race room" className="absolute top-3 bottom-3 left-3 flex w-[min(380px,calc(100vw-24px))] flex-col overflow-hidden rounded-xl border bg-card/90 shadow-2xl backdrop-blur-md">
          <div className="flex items-start gap-2 border-b p-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-lg font-semibold">{room.name}</h1>
                <Badge variant={phase === 'lobby' ? 'secondary' : 'default'}>{PHASE_LABEL[room.phase]}</Badge>
              </div>
              <button type="button" onClick={copyLink} className="mt-1 inline-flex items-center gap-1.5 rounded font-mono text-sm tracking-widest text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" title="Copy the invite link">
                {room.id} <Link2 className="size-3.5" />
              </button>
            </div>
            <Button size="icon" variant="ghost" aria-label="Hide the panel" title="Hide the panel and drive" onClick={() => { setPanel(false); sim.current?.focus(); }}>
              <PanelLeftClose />
            </Button>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-5 p-4">
              <Players room={room} meId={me.id} />
              <Separator />
              <section className="space-y-3" aria-labelledby="race-settings">
                <h2 id="race-settings" className="text-sm font-medium">Race {isHost ? '' : <span className="font-normal text-muted-foreground">· set by the host</span>}</h2>
                <MapControl value={room.map} maps={maps} disabled={!isHost || phase !== 'lobby'} onChange={id => send({ t: 'settings', map: id })} />
                <div className="flex flex-wrap items-center gap-3">
                  <GroundControl value={room.ground} disabled={!isHost || phase !== 'lobby'} onChange={g => send({ t: 'settings', ground: g })} />
                  <LapsControl value={room.laps} disabled={!isHost || phase !== 'lobby'} onChange={n => send({ t: 'settings', laps: n })} />
                  <span className="text-xs text-muted-foreground">laps</span>
                </div>
              </section>
              {mine && !mine.spectator && (phase === 'lobby' || phase === 'results') && (
                <>
                  <Separator />
                  <section className="space-y-3" aria-labelledby="your-car">
                    <h2 id="your-car" className="text-sm font-medium">Your car</h2>
                    <VehiclePicker value={mine.vehicle} paint={mine.paint} onChange={v => send({ t: 'car', vehicle: v })} />
                    <PaintPicker value={paintOf(mine.vehicle, mine.paint)} onCommit={hex => send({ t: 'car', paint: hex })} />
                  </section>
                </>
              )}
              {mine?.spectator && (
                <p className="rounded-lg border bg-muted/50 p-3 text-sm text-muted-foreground">A race is running: you are watching it, and race in the next one.</p>
              )}
            </div>
          </ScrollArea>

          <div className="space-y-2 border-t p-4">
            <RoomActions room={room} mine={mine} isHost={isHost} />
            <div className="flex items-center justify-between gap-2">
              <StatusBadge status={status} />
              <Button variant="ghost" size="sm" onClick={leave}><LogOut /> Leave</Button>
            </div>
            {!simReady && <p className="text-xs text-muted-foreground">Loading the track…</p>}
          </div>
        </aside>
      ) : (
        <div className="absolute top-[300px] right-3 flex flex-col items-end gap-2">
          <Button variant="secondary" className="shadow-lg" onClick={() => setPanel(true)}>
            <PanelLeftOpen /> Room {room.id}
          </Button>
          {status !== 'open' && <Badge variant="destructive" className="gap-1"><WifiOff className="size-3" /> Reconnecting</Badge>}
        </div>
      )}

      <Results room={room} meId={me.id} isHost={isHost} onLeave={leave} />
    </div>
  );
}

function Players({ room, meId }: { room: RoomView; meId: string }) {
  const sorted = useMemo(() => [...room.players].sort((a, b) => (a.slot < 0 ? 99 : a.slot) - (b.slot < 0 ? 99 : b.slot)), [room.players]);
  return (
    <section aria-labelledby="drivers" className="space-y-2">
      <h2 id="drivers" className="text-sm font-medium">Drivers <span className="font-normal text-muted-foreground">{room.players.length}/{LIMITS.maxPlayers}</span></h2>
      <ul className="space-y-1.5">
        {sorted.map(p => (
          <li key={p.id} className={cn('flex items-center gap-2.5 rounded-lg p-1.5', p.id === meId && 'bg-primary/10')}>
            <span className="relative">
              <DriverAvatar name={p.name} image={p.image} className="size-8" />
              <span aria-hidden className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-card" style={{ background: paintOf(p.vehicle, p.paint) }} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1 truncate text-sm font-medium">
                {p.name}{p.id === meId && <span className="text-muted-foreground">(you)</span>}
                {p.id === room.hostId && <Crown aria-label="host" className="size-3.5 text-amber-400" />}
              </span>
              <span className="block truncate text-xs text-muted-foreground">{vehicleName(p.vehicle)}</span>
            </span>
            {!p.connected ? <Badge variant="outline" className="gap-1 text-muted-foreground"><WifiOff className="size-3" /> away</Badge>
              : p.spectator ? <Badge variant="outline">watching</Badge>
                : room.phase === 'lobby' && (p.id === room.hostId ? <Badge variant="outline">host</Badge>
                  : p.ready ? <Badge className="gap-1 bg-emerald-500/20 text-emerald-300"><Check className="size-3" /> ready</Badge> : <Badge variant="secondary">not ready</Badge>)}
            {(room.phase === 'racing' || room.phase === 'countdown') && !p.spectator && (
              p.finish != null ? <Badge className="gap-1"><Flag className="size-3" /> {fmtTime(p.finish)}</Badge> : p.dnf ? <Badge variant="destructive">out</Badge> : <Badge variant="secondary">lap {Math.max(1, p.lap)}/{room.laps}</Badge>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function RoomActions({ room, mine, isHost }: { room: RoomView; mine?: PlayerView; isHost: boolean }) {
  if (room.phase === 'lobby') {
    if (isHost) {
      const waiting = room.players.filter(p => p.id !== room.hostId && !p.ready);
      return (
        <div className="space-y-1.5">
          <Button size="lg" className="w-full" onClick={() => send({ t: 'start', force: waiting.length > 0 })}>
            <Flag /> {waiting.length ? `Start without ${waiting.length === 1 ? waiting[0]!.name : `${waiting.length} drivers`}` : 'Start the race'}
          </Button>
          {waiting.length > 0 && <p className="text-center text-xs text-muted-foreground">Not ready yet: {waiting.map(p => p.name).join(', ')}</p>}
        </div>
      );
    }
    return mine ? (
      <Button size="lg" variant={mine.ready ? 'secondary' : 'default'} className="w-full" onClick={() => send({ t: 'ready', ready: !mine.ready })}>
        {mine.ready ? <><Check /> Ready, waiting for the host</> : 'I’m ready'}
      </Button>
    ) : null;
  }
  if (room.phase === 'results') return isHost
    ? <Button size="lg" className="w-full" onClick={() => send({ t: 'again' })}>Back to the grid</Button>
    : <p className="text-center text-sm text-muted-foreground">The host takes everyone back to the grid.</p>;
  return <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground"><Timer className="size-4" /> {room.phase === 'countdown' ? 'On the grid…' : 'Race on'}</p>;
}

function useRaceClock(room: RoomView) {
  const [standings] = useSubject(standings$);
  const base = useRef<{ at: number; elapsed: number } | null>(null);
  const [, force] = useState(0);
  const elapsedSrc = standings?.elapsed ?? room.elapsed;
  useEffect(() => { if (elapsedSrc != null) base.current = { at: performance.now(), elapsed: elapsedSrc }; }, [elapsedSrc]);
  useEffect(() => { const id = setInterval(() => force(n => n + 1), 100); return () => clearInterval(id); }, []);
  const elapsed = room.phase === 'racing' && base.current ? base.current.elapsed + (performance.now() - base.current.at) / 1000 : null;
  return { list: standings?.list ?? room.standings ?? [], elapsed, finishWindowLeft: standings?.finishWindowLeft ?? room.finishWindowLeft };
}

function StandingsPanel({ room, meId }: { room: RoomView; meId: string }) {
  const { list, elapsed, finishWindowLeft } = useRaceClock(room);
  return (
    <section aria-label="Standings" className="pointer-events-none absolute top-[240px] left-3 w-60 rounded-lg bg-black/55 p-3 text-sm text-white shadow-lg [text-shadow:0_1px_1px_#0008]">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-xs tracking-widest opacity-80">{room.phase === 'countdown' ? 'GRID' : 'RACE'}</span>
        <span className="font-mono tabular-nums">{elapsed != null ? fmtTime(elapsed) : '0:00.000'}</span>
      </div>
      <ol className="space-y-0.5">
        {list.map(s => (
          <li key={s.id} className={cn('flex items-center gap-2', s.id === meId && 'font-semibold')}>
            <span className="w-5 text-right tabular-nums opacity-80">{s.pos}</span>
            <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: paintOf(s.vehicle, s.paint) }} />
            <span className="min-w-0 flex-1 truncate">{s.name}</span>
            <span className="font-mono text-xs tabular-nums opacity-85">{gapText(s, room.laps)}</span>
          </li>
        ))}
      </ol>
      {finishWindowLeft != null && room.phase === 'racing' && (
        <p className="mt-2 text-xs text-amber-200">Race closes in {Math.ceil(finishWindowLeft / 1000)} s</p>
      )}
    </section>
  );
}

function gapText(s: Standing, laps: number) {
  if (s.dnf) return s.left ? 'left' : 'out';
  if (s.total != null) return s.pos === 1 ? fmtTime(s.total) : `+${(s.gap ?? 0).toFixed(1)} s`;
  if (s.pos === 1 || s.gap == null) return `lap ${Math.max(1, Math.min(laps, s.lap))}/${laps}`;
  return `+${s.gap} m`;
}

function Results({ room, meId, isHost, onLeave }: { room: RoomView; meId: string; isHost: boolean; onLeave: () => void }) {
  const [dismissed, setDismissed] = useState<number | null>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const open = room.phase === 'results' && !!room.results && dismissed !== room.race;
  const best = (id: string) => {
    const p = room.players.find(q => q.id === id);
    const t = p?.laps.filter(l => l && l.valid).map(l => l!.time) ?? [];
    return t.length ? Math.min(...t) : null;
  };
  const myPos = room.results?.find(r => r.id === meId)?.pos;
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) setDismissed(room.race); }}>
      <DialogContent className="sm:max-w-xl" onOpenAutoFocus={e => { e.preventDefault(); primary.current?.focus(); }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Trophy className="size-5 text-amber-400" /> Results</DialogTitle>
          <DialogDescription>
            {myPos ? `You finished P${myPos} of ${room.results!.length}.` : 'The race is over.'} {LIMITS.missedGatePenalty} s added for each gate missed.
          </DialogDescription>
        </DialogHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">Pos</TableHead>
              <TableHead>Driver</TableHead>
              <TableHead className="text-right">Time</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Best lap</TableHead>
              <TableHead className="text-right">Gap</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {room.results?.map(r => (
              <TableRow key={r.id} className={cn(r.id === meId && 'bg-primary/10')}>
                <TableCell className="font-semibold tabular-nums">{r.dnf ? '–' : r.pos}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <DriverAvatar name={r.name} image={r.image} className="size-6" />
                    <div className="min-w-0">
                      <div className="truncate font-medium">{r.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{vehicleName(r.vehicle)}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {r.dnf ? <span className="text-muted-foreground">{r.left ? 'left' : 'DNF'}</span> : fmtTime(r.total)}
                  {!r.dnf && r.missed > 0 && <div className="text-xs text-amber-300">+{r.missed * LIMITS.missedGatePenalty} s penalty</div>}
                </TableCell>
                <TableCell className="hidden text-right font-mono tabular-nums sm:table-cell">{fmtTime(best(r.id))}</TableCell>
                <TableCell className="text-right font-mono tabular-nums text-muted-foreground">{r.pos === 1 || r.dnf || r.gap == null ? '' : `+${r.gap.toFixed(3)}`}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={onLeave}><LogOut /> Leave room</Button>
          <div className="flex gap-2">
            <Button ref={isHost ? undefined : primary} variant="outline" onClick={() => setDismissed(room.race)}>Drive around</Button>
            {isHost && <Button ref={primary} onClick={() => send({ t: 'again' })}><Flag /> Back to the grid</Button>}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Blocker({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-4 rounded-xl border bg-card p-6 text-center">
        <Wifi className="mx-auto size-6 text-muted-foreground" aria-hidden />
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{body}</p>
        <div className="flex justify-center gap-2">{children}</div>
      </div>
    </main>
  );
}
