'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Copy, FileUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SiteNav } from '@/components/site-nav';
import { TrackPicker } from '@/components/race-controls';
import { TrackOutline } from '@/components/track-outline';
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
    <div className="relative min-h-dvh overflow-x-clip">
      <div aria-hidden className="grid-fade pointer-events-none absolute inset-0 h-[640px]" />
      <SiteNav user={user} active="maps" />

      <div className="relative mx-auto max-w-7xl px-4 pt-10 sm:px-6 sm:pt-14">
        <p className="eyebrow text-primary">Super admin</p>
        <h1 className="display mt-3 text-4xl sm:text-5xl">Maps</h1>
        <p className="mt-3 max-w-xl text-pretty text-muted-foreground">The tracks every room races and every network trains on. An edit reaches the rooms at once (a race under way: when it ends).</p>
      </div>
      <main className="relative mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[380px_1fr]">
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
                <Label>Start from</Label>
                <TrackPicker compact value={{ id: from, name: maps.find(m => m.id === from)?.name ?? 'Figure-8' }} maps={maps} onChange={setFrom} />
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
            <CardDescription>Saved on the server. An edit reaches the rooms at once (a race under way: when it ends).</CardDescription>
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
                      <div className="flex items-center gap-3">
                        <TrackOutline wp={m.wp} width={56} height={40} stroke={2} className="h-10 w-14 shrink-0 text-foreground" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-medium">{m.name}</span>
                            {m.builtin && <Badge variant="secondary">built in</Badge>}
                          </div>
                          <div className="num text-xs text-muted-foreground">{m.id}</div>
                        </div>
                      </div>
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
            <DialogDescription>Rooms on it go back to the figure-8 (a race under way: when it ends). This can&apos;t be undone (Export it from the editor first to keep a copy).</DialogDescription>
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
