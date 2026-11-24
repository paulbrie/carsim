'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSubject } from 'subjecto/react';
import { toast } from 'sonner';
import { Brain, Check, ChevronLeft, Crown, Flag, Link2, LogOut, MessageSquare, PanelLeftClose, PanelLeftOpen, Timer, Trophy, WifiOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SegmentedControl, SegmentedControlIndicator, SegmentedControlItem } from '@ui-sdk/react/segmented-control';
import { DriverAvatar } from '@/components/user-menu';
import { SimFrame, type SimHandle } from '@/components/sim-frame';
import { PHASE_LABEL } from '@/components/lobby';
import { GroundControl, LapsControl, TrackPicker, WeatherControl, PaintPicker, StatusBadge, VehiclePicker, fmtTime, groundName, paintOf, vehicleName } from '@/components/race-controls';
import { BrandMark } from '@/components/brand';
import { ChatBox, ChatOverlay, useUnread, type ChatBoxHandle } from '@/components/chat';
import { cn } from '@/lib/utils';
import { withBase } from '@/lib/base-path';
import { LIMITS } from '@/lib/race/shared.mjs';
import { useMaps, useRoomCourse } from '@/lib/client/maps';
import { GHOST_MODES, ghostMode$, pickGhost, setGhostMode, type GhostMode } from '@/lib/client/ghost';
import { connect, joinRoom, leaveRoom, leaveRoomSoon, me$, onError, reclaim, records$, room$, send, standings$, status$ } from '@/lib/client/net';
import type { PlayerView, Records, RoomView, Standing } from '@/lib/race/types';

export function RaceRoom({ roomId }: { roomId: string; user: { name: string; image: string | null } }) {
  const router = useRouter();
  const [status] = useSubject(status$);
  const [me] = useSubject(me$);
  const [room] = useSubject(room$);
  const [panel, setPanel] = useState(true);
  const [tab, setTab] = useState<'race' | 'car' | 'laps' | 'chat'>('race');
  const [simReady, setSimReady] = useState(false);
  const sim = useRef<SimHandle>(null);
  // the chat (#325): a tab of the panel; over the track when the panel is away (Enter in the sim opens its line)
  const [chatOpen, setChatOpen] = useState(false);
  const chatBox = useRef<ChatBoxHandle>(null);
  const chatShown = panel && tab === 'chat';
  const unread = useUnread('room', chatShown, me?.id) + useUnread('main', chatShown, me?.id);

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

  // the sim's drawers (the car's setup, the lab) run down the left side, where this panel is: it steps aside for them
  // and comes back after them; opened over one, it closes it (#332)
  const panelNow = useRef(panel); panelNow.current = panel;
  const panelBack = useRef(false);
  const [drawer, setDrawer] = useState(false);
  const onDrawer = useCallback((open: boolean) => {
    setDrawer(open);
    if (open) { panelBack.current = panelNow.current; setPanel(false); }
    else { if (panelBack.current) setPanel(true); panelBack.current = false; }
  }, []);
  useEffect(() => { if (panel && drawer) { panelBack.current = false; sim.current?.closeDrawers(); } }, [panel, drawer]);

  const course = useRoomCourse(room?.id === roomId ? room.map : undefined, msg => toast.error(msg));
  const maps = useMaps(isHost);

  const onSimReady = useCallback(() => setSimReady(true), []);
  const panelRef = useRef(panel); panelRef.current = panel;
  const onChatKey = useCallback(() => {
    if (panelRef.current) { setTab('chat'); setTimeout(() => chatBox.current?.focus(), 0); } else setChatOpen(true);
  }, []);
  const backToCar = useCallback(() => { setChatOpen(false); sim.current?.focus(); }, []);
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
    <Blocker title="Signed out" body="Sign in again to race."><Button asChild><Link href={`/signin?next=/race/${roomId}`}>Sign in</Link></Button></Blocker>
  );
  if (!room || !me || room.id !== roomId) return (
    <Blocker title={`Joining room ${roomId}…`} body={status === 'open' ? 'Taking a seat.' : 'Connecting to the race server.'}>
      <Button variant="outline" asChild><Link href="/lobby"><ChevronLeft /> Lobby</Link></Button>
    </Blocker>
  );

  return (
    <div className="fixed inset-0 overflow-hidden bg-black">
      {course && <SimFrame ref={sim} room={room} meId={me.id} course={course} onReady={onSimReady} onChatKey={onChatKey} onDrawer={onDrawer} />}

      {(phase === 'racing' || phase === 'countdown') && <StandingsPanel room={room} meId={me.id} />}

      {panel ? (
        <aside aria-label="Race room" className="absolute top-3 bottom-3 left-3 flex w-[min(392px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border border-white/10 bg-background/88 shadow-2xl backdrop-blur-xl">
          <div className="flex items-start gap-3 border-b border-white/8 p-4">
            <Link href="/lobby" aria-label="Back to the race rooms" title="Back to the race rooms" className="mt-0.5 rounded-lg p-1 outline-none hover:bg-white/8 focus-visible:ring-2 focus-visible:ring-ring"><BrandMark className="size-6" /></Link>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h1 className="heading truncate text-lg">{room.name}</h1>
                <Badge variant={phase === 'lobby' ? 'secondary' : 'default'}>{PHASE_LABEL[room.phase]}</Badge>
              </div>
              <button type="button" onClick={copyLink} className="num mt-1 inline-flex items-center gap-1.5 rounded text-xs tracking-[0.25em] text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" title="Copy the invite link">
                {room.id} <Link2 className="size-3.5" /> <span className="tracking-normal">copy invite link</span>
              </button>
            </div>
            <Button size="icon" variant="ghost" aria-label="Hide the panel" title="Hide the panel and drive" onClick={() => { setPanel(false); sim.current?.focus(); }}>
              <PanelLeftClose />
            </Button>
          </div>

          <div className="border-b border-white/8 px-4 py-2.5">
            <SegmentedControl aria-label="Room panel" className="seg w-full" value={tab} onValueChange={v => v && setTab(v as typeof tab)}>
              <SegmentedControlIndicator className="seg-indicator" />
              <SegmentedControlItem value="race" className="seg-item flex-1 text-center">Race</SegmentedControlItem>
              <SegmentedControlItem value="car" className="seg-item flex-1 text-center">Your car</SegmentedControlItem>
              <SegmentedControlItem value="laps" className="seg-item flex-1 text-center">Best laps</SegmentedControlItem>
              <SegmentedControlItem value="chat" className="seg-item flex-1 text-center" aria-label={unread ? `Chat, ${unread} new` : 'Chat'}>
                Chat{unread > 0 && <span className="num ml-1 rounded-full bg-primary px-1.5 text-[0.7rem] text-primary-foreground">{unread}</span>}
              </SegmentedControlItem>
            </SegmentedControl>
          </div>

          {tab === 'chat' ? (
            <div className="flex min-h-0 flex-1 p-4">
              <ChatBox ref={chatBox} channels={['room', 'main']} meId={me.id} admin={me.admin} className="flex-1" onEscape={() => sim.current?.focus()} />
            </div>
          ) : (
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-5 p-4">
              {tab === 'race' && (
                <>
                  <Players room={room} meId={me.id} />
                  <Separator />
                  <section className="space-y-4" aria-labelledby="race-settings">
                    <h2 id="race-settings" className="eyebrow text-muted-foreground">The race {isHost ? '' : <span className="tracking-normal normal-case">· set by the host</span>}</h2>
                    <TrackPicker compact value={room.map} maps={maps.length ? maps : []} disabled={!isHost || phase !== 'lobby'} onChange={id => send({ t: 'settings', map: id })} />
                    <div className="flex flex-wrap items-center gap-3">
                      <GroundControl value={room.ground} disabled={!isHost || phase !== 'lobby'} onChange={g => send({ t: 'settings', ground: g })} />
                      <LapsControl value={room.laps} disabled={!isHost || phase !== 'lobby'} onChange={n => send({ t: 'settings', laps: n })} />
                      <span className="text-xs text-muted-foreground">laps</span>
                    </div>
                    <WeatherControl value={room.weather ?? 'clear'} disabled={!isHost || phase !== 'lobby'} onChange={w => send({ t: 'settings', weather: w })} />
                  </section>
                  {mine?.spectator && (
                    <p className="rounded-lg border bg-muted/50 p-3 text-sm text-muted-foreground">A race is running: you are watching it, and race in the next one.</p>
                  )}
                </>
              )}
              {tab === 'car' && (
                mine && !mine.spectator && (phase === 'lobby' || phase === 'results') ? (
                  <section className="space-y-4" aria-labelledby="your-car">
                    <h2 id="your-car" className="eyebrow text-muted-foreground">Your car</h2>
                    <VehiclePicker value={mine.vehicle} paint={mine.paint} onChange={v => send({ t: 'car', vehicle: v })} />
                    <h2 className="eyebrow pt-1 text-muted-foreground">Paint</h2>
                    <PaintPicker value={paintOf(mine.vehicle, mine.paint)} onCommit={hex => send({ t: 'car', paint: hex })} />
                  </section>
                ) : (
                  <p className="rounded-lg border bg-muted/50 p-3 text-sm text-muted-foreground">
                    {mine?.spectator ? 'You are watching this race: you pick a car for the next one.' : `You are in the ${mine ? vehicleName(mine.vehicle) : 'car'}. Cars change between races, on the grid.`}
                  </p>
                )
              )}
              {tab === 'laps' && <BestLaps room={room} meId={me.id} vehicle={mine?.vehicle} />}
            </div>
          </ScrollArea>
          )}

          <div className="space-y-2 border-t border-white/8 p-4">
            <RoomActions room={room} mine={mine} isHost={isHost} />
            <div className="flex items-center justify-between gap-2">
              <StatusBadge status={status} />
              {!simReady && <p className="text-xs text-muted-foreground">Loading the track…</p>}
              <Button variant="ghost" size="sm" onClick={leave}><LogOut /> Leave</Button>
            </div>
          </div>
        </aside>
      ) : (
        <div className="absolute bottom-3 left-3 flex flex-col-reverse items-start gap-2">
          <div className="flex gap-2">
            <Button variant="glass" size="lg" className="bg-background/70 px-3 shadow-lg" onClick={() => { setChatOpen(false); setPanel(true); }}>
              <PanelLeftOpen /> <span className="num tracking-widest">{room.id}</span> Room
            </Button>
            <Button variant="glass" size="lg" className="bg-background/70 px-3 shadow-lg" title="Chat (Enter)" aria-label={unread ? `Chat, ${unread} new` : 'Chat'} onClick={() => setChatOpen(o => !o)}>
              <MessageSquare />{unread > 0 && <span className="num rounded-full bg-primary px-1.5 text-[0.7rem] text-primary-foreground">{unread}</span>}
            </Button>
          </div>
          <ChatOverlay meId={me.id} open={chatOpen} onClose={backToCar} />
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
      <h2 id="drivers" className="eyebrow text-muted-foreground">Drivers <span className="num tracking-normal">{room.players.length}/{LIMITS.maxPlayers}</span></h2>
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

// The best laps on the room's map and ground (the server's records, #304): with your car, or any.
// A driver's lap with each car is one entry; a time set before the map was last edited says so.
function BestLaps({ room, meId, vehicle }: { room: RoomView; meId: string; vehicle?: string }) {
  const [records] = useSubject(records$);
  const [which, setWhich] = useState<'car' | 'all'>('car');
  const forCar = which === 'car' && !!vehicle;
  const here = records && records.map === room.map.id && records.ground === room.ground ? records : null;
  const ranked = (here?.list ?? []).filter(e => !forCar || e.vehicle === vehicle);
  const shown = ranked.slice(0, 10).map((e, i) => ({ e, pos: i + 1 }));
  const myPos = ranked.findIndex(e => e.id === meId);
  if (myPos >= 10) shown.push({ e: ranked[myPos]!, pos: myPos + 1 });
  const lead = ranked[0]?.time;
  return (
    <section aria-labelledby="best-laps" className="space-y-3">
      <h2 id="best-laps" className="eyebrow text-muted-foreground">Best laps <span className="tracking-normal normal-case">· {room.map.name}, {groundName(room.ground)}</span></h2>
      {vehicle && (
        <SegmentedControl aria-label="Best laps with" className="seg" value={forCar ? 'car' : 'all'} onValueChange={v => v && setWhich(v as 'car' | 'all')}>
          <SegmentedControlIndicator className="seg-indicator" />
          <SegmentedControlItem value="car" className="seg-item">{vehicleName(vehicle)}</SegmentedControlItem>
          <SegmentedControlItem value="all" className="seg-item">All cars</SegmentedControlItem>
        </SegmentedControl>
      )}
      {!here ? <p className="text-sm text-muted-foreground">Loading…</p> : !shown.length ? (
        <p className="text-sm text-muted-foreground">No lap yet{forCar ? ` with the ${vehicleName(vehicle!)}` : ''}. A lap counts when it passes every gate, in a race or driving around.</p>
      ) : (
        <ol className="space-y-1.5">
          {shown.map(({ e, pos }) => (
            <li key={`${e.id}|${e.vehicle}`} className={cn('flex items-center gap-2.5 rounded-lg p-1.5', e.id === meId && 'bg-primary/10')}>
              <span className="w-5 text-right text-sm tabular-nums text-muted-foreground">{pos}</span>
              {e.net ? <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-tnn/15 text-tnn"><Brain className="size-4" /></span>
                : <DriverAvatar name={e.name} image={e.image} className="size-7" />}
              <span className="min-w-0 flex-1">
                <span className={cn('block truncate text-sm font-medium', e.net && 'text-tnn')} title={e.net ? `A network's lap: ${e.net.name}, made by ${e.net.creator}${e.net.weights ? `, ${e.net.weights} weights` : ''}` : undefined}>
                  {e.name}{e.id === meId && <span className="text-muted-foreground"> (you)</span>}
                </span>
                {(!forCar || e.mv !== here.v || e.net) && (
                  <span className="block truncate text-xs text-muted-foreground">
                    {[e.net && `network by ${e.net.creator}`, !forCar && vehicleName(e.vehicle), e.mv !== here.v && 'earlier layout'].filter(Boolean).join(' · ')}
                  </span>
                )}
              </span>
              <span className="text-right font-mono text-sm tabular-nums">
                {fmtTime(e.time)}
                {pos > 1 && lead != null && <span className="block text-xs text-muted-foreground">+{(e.time - lead).toFixed(3)}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
      <GhostControl records={here} meId={meId} vehicle={vehicle} />
    </section>
  );
}

// The ghost car (#310): a see-through car on the chosen best lap's path, setting off when our lap starts.
function GhostControl({ records, meId, vehicle }: { records: Records | null; meId: string; vehicle?: string }) {
  const [mode] = useSubject(ghostMode$);
  const g = pickGhost(records, mode, meId, vehicle);
  return (
    <div className="space-y-2 pt-1">
      <h3 id="ghost-car" className="text-xs font-medium text-muted-foreground">Ghost car</h3>
      <SegmentedControl aria-labelledby="ghost-car" className="seg" value={mode} onValueChange={v => v && setGhostMode(v as GhostMode)}>
        <SegmentedControlIndicator className="seg-indicator" />
        {GHOST_MODES.map(m => <SegmentedControlItem key={m.key} value={m.key} className="seg-item" title={m.blurb}>{m.name}</SegmentedControlItem>)}
      </SegmentedControl>
      {mode !== 'off' && (
        <p className="text-xs text-muted-foreground">
          {g ? <>Racing {g.id === meId ? 'your' : g.net ? `the network ${g.name}’s (by ${g.net.creator})` : `${g.name}’s`} {fmtTime(g.time)} in the {vehicleName(g.vehicle)}: it sets off when your lap starts.</>
            : 'No lap to race yet: a best lap set from now on brings its ghost.'}
        </p>
      )}
    </div>
  );
}

function RoomActions({ room, mine, isHost }: { room: RoomView; mine?: PlayerView; isHost: boolean }) {
  if (room.phase === 'lobby') {
    if (isHost) {
      const waiting = room.players.filter(p => p.id !== room.hostId && !p.ready);
      return (
        <div className="space-y-1.5">
          <Button size="xl" className="w-full" onClick={() => send({ t: 'start', force: waiting.length > 0 })}>
            <Flag /> {waiting.length ? `Start without ${waiting.length === 1 ? waiting[0]!.name : `${waiting.length} drivers`}` : 'Start the race'}
          </Button>
          {waiting.length > 0 && <p className="text-center text-xs text-muted-foreground">Not ready yet: {waiting.map(p => p.name).join(', ')}</p>}
        </div>
      );
    }
    return mine ? (
      <Button size="xl" variant={mine.ready ? 'secondary' : 'default'} className="w-full" onClick={() => send({ t: 'ready', ready: !mine.ready })}>
        {mine.ready ? <><Check /> Ready, waiting for the host</> : 'I’m ready'}
      </Button>
    ) : null;
  }
  if (room.phase === 'results') return isHost
    ? <Button size="xl" className="w-full" onClick={() => send({ t: 'again' })}>Back to the grid</Button>
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
    <section aria-label="Standings" className="pointer-events-none absolute top-[236px] left-3 w-64 rounded-xl border border-white/10 bg-background/70 p-3 text-sm text-white shadow-lg backdrop-blur-md">
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
      <div className="panel w-full max-w-sm space-y-4 p-7 text-center">
        <BrandMark className="mx-auto size-8" />
        <h1 className="heading text-xl">{title}</h1>
        <p className="text-sm text-muted-foreground">{body}</p>
        <div className="flex justify-center gap-2">{children}</div>
      </div>
    </main>
  );
}
