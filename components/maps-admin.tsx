'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ChevronLeft, Copy, FileUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Brand } from '@/components/brand';
import { UserMenu } from '@/components/user-menu';
import { MapControl } from '@/components/race-controls';
import { api, fetchMaps } from '@/lib/client/maps';
import type { MapSummary } from '@/lib/maps/store.mjs';

const fmtDate = (t: number) => t ? new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'as shipped';

export function MapsAdmin({ initial, user }: { initial: MapSummary[]; user: { name: string; image: string | null; admin: boolean } }) {
  const router = useRouter();
  const [maps, setMaps] = useState(initial);
  const [name, setName] = useState('');
  const [from, setFrom] = useState('figure-8');
  const [busy, setBusy] = useState(false);
  const [doomed, setDoomed] = useState<MapSummary | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const reload = () => fetchMaps().then(setMaps).catch(() => {});

  const create = async (body: { name: string; from?: string; course?: unknown }) => {
    setBusy(true);
    try {
      const { map } = await api<{ map: { id: string } }>('/api/maps', { method: 'POST', json: body });
      router.push(`/maps/${map.id}`);
    } catch (e) { toast.error((e as Error).message); setBusy(false); }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) create({ name: name.trim(), from });
  };

  // an editor Export (sand-buggy-course.json) as a new map
  const onImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    let course: unknown;
    try { course = JSON.parse(await f.text()); } catch { toast.error('That file is not a course (JSON).'); return; }
    create({ name: name.trim() || f.name.replace(/\.json$/i, '').replace(/[-_]+/g, ' '), course });
  };

  const copy = (m: MapSummary) => create({ name: `${m.name} (copy)`.slice(0, 40), from: m.id });

  const remove = async () => {
    if (!doomed) return;
    try { await api(`/api/maps/${encodeURIComponent(doomed.id)}`, { method: 'DELETE' }); toast.success(`${doomed.name} deleted`); await reload(); }
    catch (e) { toast.error((e as Error).message); }
    setDoomed(null);
  };

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild><Link href="/lobby"><ChevronLeft /> Lobby</Link></Button>
            <Brand />
          </div>
          <UserMenu user={user} />
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-8 lg:grid-cols-[360px_1fr]">
        <Card className="self-start">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Plus className="size-4" /> New map</CardTitle>
            <CardDescription>Starts as a copy of another map; then shape it in the editor. Hosts pick it for their rooms.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="map-name">Name</Label>
                <Input id="map-name" value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder="Canyon run" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="map-from">Start from</Label>
                <MapControl id="map-from" value={{ id: from, name: maps.find(m => m.id === from)?.name ?? 'Figure-8' }} maps={maps} onChange={setFrom} />
              </div>
              <Button type="submit" className="w-full" disabled={busy || !name.trim()}><Pencil /> Create and edit</Button>
              <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={() => file.current?.click()}>
                <FileUp /> Import a course file
              </Button>
              <input ref={file} type="file" accept=".json,application/json" hidden onChange={onImport} />
              <p className="text-xs text-muted-foreground">A course file is what the editor&apos;s Export course saves (also from the single-player sim).</p>
            </form>
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Maps</CardTitle>
            <CardDescription>Saved on the server. An edit reaches a room when its next race starts.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Map</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Waypoints</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Banking</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Terrain strokes</TableHead>
                  <TableHead className="hidden lg:table-cell">Saved</TableHead>
                  <TableHead><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {maps.map(m => (
                  <TableRow key={m.id}>
                    <TableCell className="max-w-56">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{m.name}</span>
                        {m.builtin && <Badge variant="secondary">built in</Badge>}
                      </div>
                      <div className="font-mono text-xs text-muted-foreground">{m.id}</div>
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">{m.waypoints}</TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">{m.bank ? `${m.bank}°` : 'off'}</TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">{m.strokes}</TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">{fmtDate(m.updatedAt)}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button size="sm" asChild><Link href={`/maps/${m.id}`}><Pencil /> Edit</Link></Button>
                        <Button size="icon" variant="ghost" aria-label={`Copy ${m.name}`} title="Copy" disabled={busy} onClick={() => copy(m)}><Copy /></Button>
                        <Button size="icon" variant="ghost" aria-label={`Delete ${m.name}`} title={m.builtin ? 'The figure-8 is built in' : 'Delete'} disabled={m.builtin} onClick={() => setDoomed(m)}><Trash2 /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </main>

      <Dialog open={!!doomed} onOpenChange={o => { if (!o) setDoomed(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {doomed?.name}?</DialogTitle>
            <DialogDescription>Rooms racing it go back to the figure-8 at their next race. This can&apos;t be undone (Export it from the editor first to keep a copy).</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDoomed(null)}>Keep it</Button>
            <Button variant="destructive" onClick={remove}><Trash2 /> Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
