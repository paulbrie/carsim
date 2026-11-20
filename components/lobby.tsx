'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSubject } from 'subjecto/react';
import { toast } from 'sonner';
import { Flag, LogIn, Plus, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Brand } from '@/components/brand';
import { UserMenu } from '@/components/user-menu';
import { GroundControl, LapsControl, MapControl, StatusBadge, WeatherControl, groundName } from '@/components/race-controls';
import { useMaps } from '@/lib/client/maps';
import { connect, onError, room$, rooms$, send, setWantedRoom, status$ } from '@/lib/client/net';
import type { Phase } from '@/lib/race/types';

export const PHASE_LABEL: Record<Phase, string> = { lobby: 'Waiting', countdown: 'Starting', racing: 'Racing', results: 'Results' };

export function Lobby({ user }: { user: { name: string; image: string | null; admin?: boolean } }) {
  const router = useRouter();
  const [status] = useSubject(status$);
  const [rooms] = useSubject(rooms$);
  const [room] = useSubject(room$);
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

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
          <Brand />
          <div className="flex items-center gap-3">
            <StatusBadge status={status} />
            <UserMenu user={user} />
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-8 lg:grid-cols-[360px_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Plus className="size-4" /> New race</CardTitle>
              <CardDescription>You host it: you pick the map, the ground, the weather and the laps, and start it when everyone is ready.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={create} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="room-name">Name</Label>
                  <Input id="room-name" value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder={`${user.name}'s race`} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="room-map">Map</Label>
                  <MapControl id="room-map" value={{ id: map, name: maps.find(m => m.id === map)?.name ?? 'Figure-8' }} maps={maps} onChange={setMap} />
                </div>
                <div className="space-y-2">
                  <Label id="ground-label">Ground</Label>
                  <div><GroundControl value={ground} onChange={setGround} /></div>
                </div>
                <div className="space-y-2">
                  <Label id="weather-label">Weather</Label>
                  <div><WeatherControl value={weather} onChange={setWeather} /></div>
                </div>
                <div className="space-y-2">
                  <Label>Laps</Label>
                  <div><LapsControl value={laps} onChange={setLaps} /></div>
                </div>
                <Button type="submit" className="w-full" disabled={status !== 'open'}>
                  <Flag /> Create race
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><LogIn className="size-4" /> Join with a code</CardTitle>
              <CardDescription>A friend's room code, or the link they sent you.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={join} className="flex gap-2">
                <Input aria-label="Room code" value={code} onChange={e => setCode(e.target.value)} maxLength={8} placeholder="ABCDE"
                  className="font-mono tracking-widest uppercase" autoComplete="off" spellCheck={false} />
                <Button type="submit" variant="secondary" disabled={code.trim().length < 4}>Join</Button>
              </form>
            </CardContent>
          </Card>
        </div>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Users className="size-4" /> Open rooms</CardTitle>
            <CardDescription>Rooms on this server. A race already running can be watched, and you race in the next one.</CardDescription>
          </CardHeader>
          <CardContent>
            {rooms.length === 0 ? (
              <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
                {status === 'open' ? 'No rooms yet. Create one and send your friends the link.' : 'Connecting to the race server…'}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Room</TableHead>
                    <TableHead className="hidden sm:table-cell">Host</TableHead>
                    <TableHead>Course</TableHead>
                    <TableHead className="text-right">Laps</TableHead>
                    <TableHead className="text-right">Drivers</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead><span className="sr-only">Join</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rooms.map(r => (
                    <TableRow key={r.id}>
                      <TableCell className="max-w-48">
                        <div className="truncate font-medium">{r.name}</div>
                        <div className="font-mono text-xs text-muted-foreground">{r.id}</div>
                      </TableCell>
                      <TableCell className="hidden max-w-32 truncate sm:table-cell">{r.host}</TableCell>
                      <TableCell className="max-w-40">
                        <div className="truncate">{r.map}</div>
                        <div className="text-xs text-muted-foreground">{groundName(r.ground)}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.laps}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.players}/{r.max}</TableCell>
                      <TableCell><Badge variant={r.phase === 'lobby' ? 'secondary' : 'outline'}>{PHASE_LABEL[r.phase]}</Badge></TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant={r.phase === 'lobby' ? 'default' : 'outline'} disabled={r.players >= r.max} onClick={() => router.push(`/race/${r.id}`)}>
                          {r.phase === 'lobby' ? 'Join' : 'Watch'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
