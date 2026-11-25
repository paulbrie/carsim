'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSubject } from 'subjecto/react';
import { toast } from 'sonner';
import { Flag, LogIn, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SiteNav } from '@/components/site-nav';
import { GroundControl, LapsControl, StatusBadge, TrackPicker, WeatherControl, groundName } from '@/components/race-controls';
import { cn } from '@/lib/utils';
import { useMaps } from '@/lib/client/maps';
import { connect, me$, onError, room$, rooms$, send, setWantedRoom, status$ } from '@/lib/client/net';
import { ChatBox } from '@/components/chat';
import type { Phase } from '@/lib/race/types';

export const PHASE_LABEL: Record<Phase, string> = { lobby: 'Waiting', countdown: 'Starting', racing: 'Racing', results: 'Results' };

export function Lobby({ user }: { user: { name: string; image: string | null; admin?: boolean } }) {
  const router = useRouter();
  const [status] = useSubject(status$);
  const [rooms] = useSubject(rooms$);
  const [room] = useSubject(room$);
  const [me] = useSubject(me$);
  const [name, setName] = useState('');
  const [ground, setGround] = useState('sand');
  const [weather, setWeather] = useState('clear');
  const [laps, setLaps] = useState(3);
  const [map, setMap] = useState('figure-8');
  const maps = useMaps();
  const [code, setCode] = useState('');
  const creating = useRef(false);

  useEffect(() => { connect(); }, []);
  useEffect(() => onError(e => toast.error(e.msg)), []);
  // the server put us in the room we created: go there
  useEffect(() => {
    if (room && creating.current) { creating.current = false; setWantedRoom(room.id); router.push(`/race/${room.id}`); }
  }, [room, router]);

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    creating.current = true;
    if (!send({ t: 'create', name: name.trim() || `${user.name}'s race`, ground, weather, laps, map })) { creating.current = false; toast.error('Not connected to the race server yet.'); }
  };
  const join = (e: React.FormEvent) => {
    e.preventDefault();
    const id = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (id.length >= 4) router.push(`/race/${id}`);
  };

  const field = 'space-y-2.5';
  return (
    <div className="relative min-h-dvh overflow-x-clip">
      <div aria-hidden className="grid-fade pointer-events-none absolute inset-0 h-[640px]" />
      <SiteNav user={user} active="race"><StatusBadge status={status} /></SiteNav>

      <main className="relative mx-auto max-w-7xl px-4 pt-10 pb-20 sm:px-6 sm:pt-14">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="eyebrow text-primary">Race</p>
            <h1 className="display mt-3 text-4xl sm:text-5xl">Race rooms</h1>
            <p className="mt-3 max-w-xl text-pretty text-muted-foreground">Up to eight drivers on a grid, live. Open a room alone to set laps for the leaderboard, or send the link and race.</p>
          </div>
          <form onSubmit={join} className="flex items-end gap-2" aria-label="Join with a code">
            <div className="space-y-1.5">
              <Label htmlFor="room-code" className="text-xs text-muted-foreground">Have a room code?</Label>
              <Input id="room-code" value={code} onChange={e => setCode(e.target.value)} maxLength={8} placeholder="ABCDE"
                className="num h-11 w-36 text-base tracking-[0.3em] uppercase" autoComplete="off" spellCheck={false} />
            </div>
            <Button type="submit" variant="glass" size="xl" className="h-11" disabled={code.trim().length < 4}><LogIn /> Join</Button>
          </form>
        </div>

        <div className="mt-10 grid items-start gap-6 lg:grid-cols-[minmax(0,440px)_1fr]">
          <div className="space-y-6">
          <form onSubmit={create} className="panel space-y-6 p-5 sm:p-6" aria-labelledby="new-race">
            <div>
              <h2 id="new-race" className="heading text-xl">Start a race</h2>
              <p className="mt-1 text-sm text-muted-foreground">You host: you pick the track and start when everyone is ready. All of it can still change in the room.</p>
            </div>
            <div className={field}>
              <Label>Track</Label>
              <TrackPicker value={{ id: map, name: maps.find(m => m.id === map)?.name ?? 'Figure-8' }} maps={maps} onChange={setMap} />
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className={field}><Label id="ground-label">Ground</Label><div><GroundControl value={ground} onChange={setGround} /></div></div>
              <div className={field}><Label>Laps</Label><div><LapsControl value={laps} onChange={setLaps} /></div></div>
            </div>
            <div className={field}><Label id="weather-label">Weather</Label><div><WeatherControl value={weather} onChange={setWeather} /></div></div>
            <div className={field}>
              <Label htmlFor="room-name">Room name <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Input id="room-name" value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder={`${user.name}'s race`} className="h-10" />
            </div>
            <Button type="submit" size="xl" className="w-full" disabled={status !== 'open'}>
              <Flag /> {status === 'open' ? 'Open the room' : 'Connecting…'}
            </Button>
          </form>

          {/* the main chat room (#325): everyone on the race server, in the lobby and in the race rooms */}
          <section className="panel flex h-[440px] flex-col p-4 sm:p-5" aria-labelledby="chat-heading">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 id="chat-heading" className="heading text-xl">Chat</h2>
              <p className="text-xs text-muted-foreground">Everyone, in the lobby and the races</p>
            </div>
            <ChatBox channels={['main']} meId={me?.id} admin={me?.admin} className="flex-1" />
          </section>
          </div>

          <section className="min-w-0 space-y-4" aria-labelledby="open-rooms">
            <div className="flex items-baseline justify-between">
              <h2 id="open-rooms" className="heading text-xl">Open rooms</h2>
              <p className="num text-sm text-muted-foreground">{rooms.length ? `${rooms.length} open` : ''}</p>
            </div>
            {rooms.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/12 px-6 py-14 text-center">
                <Users className="mx-auto size-7 text-muted-foreground/60" aria-hidden />
                <p className="mt-3 font-medium">{status === 'open' ? 'No room is open right now' : 'Connecting to the race server…'}</p>
                {status === 'open' && <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">Open one and send the link. A room with only you in it is also how you put your laps on the leaderboard.</p>}
              </div>
            ) : (
              <ul className="space-y-3">
                {rooms.map(r => {
                  const waiting = r.phase === 'lobby', full = r.players >= r.max;
                  return (
                    <li key={r.id} className="panel flex flex-wrap items-center gap-x-5 gap-y-3 p-4 sm:p-5">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2.5">
                          <span aria-hidden className={cn('size-2 shrink-0 rounded-full', waiting ? 'bg-win' : 'animate-pulse bg-primary')} />
                          <h3 className="truncate font-semibold">{r.name}</h3>
                          <span className="num shrink-0 text-xs tracking-widest text-muted-foreground">{r.id}</span>
                        </div>
                        <p className="mt-1 truncate text-sm text-muted-foreground">{r.map} · {groundName(r.ground)} · {r.laps} {r.laps === 1 ? 'lap' : 'laps'} · hosted by {r.host}</p>
                      </div>
                      <div className="text-right">
                        <p className="num text-sm font-medium">{r.players}/{r.max}</p>
                        <p className="text-xs text-muted-foreground">{PHASE_LABEL[r.phase]}</p>
                      </div>
                      <Button size="lg" variant={waiting ? 'default' : 'glass'} className="px-4" disabled={full} onClick={() => router.push(`/race/${r.id}`)}>
                        {full ? 'Full' : waiting ? 'Join' : 'Watch'}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}

          </section>
        </div>
      </main>
    </div>
  );
}
