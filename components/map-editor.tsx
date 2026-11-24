'use client';
// The super admin's map editor: the sim in edit mode (/sim/index.html?edit=1, which opens on its
// course editor) with the map's course, and a bar to rename and save it. The sim posts a
// signature of its course as it changes (sig), which tells the bar when there is something to save;
// Save asks it for the course (get → course) and PUTs it.
// "Test on" tries the course on each ground a race can be on (the sim tells it when G switches the
// ground too); in a race the room's ground applies, so it is not a change to save.
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, ChevronLeft, Loader2, Save } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { withBase } from '@/lib/base-path';
import { api, fetchMap } from '@/lib/client/maps';
import { GroundControl } from '@/components/race-controls';
import type { Course } from '@/lib/maps/store.mjs';

type Reply = { course: Course; sig: string };

export function MapEditor({ id, name: initialName, builtin }: { id: string; name: string; builtin: boolean }) {
  const router = useRouter();
  const frame = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [ready, setReady] = useState(false);
  const [name, setName] = useState(initialName);
  const [savedName, setSavedName] = useState(initialName);
  const [sig, setSig] = useState<string | null>(null);
  const [savedSig, setSavedSig] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [ground, setGround] = useState<string | null>(null);
  const pending = useRef(new Map<number, (r: Reply) => void>());
  const seq = useRef(0);

  // the course first, for the sim to read as it boots
  useEffect(() => {
    let live = true;
    fetchMap(id).then(m => {
      if (!live) return;
      window.__simCourse = { key: `${m.id}@${m.updatedAt}`, course: m.course };
      setLoaded(true);
    }).catch((e: Error) => toast.error(`Could not load the map: ${e.message}`));
    return () => { live = false; };
  }, [id]);

  const dirty = (sig != null && savedSig != null && sig !== savedSig) || name.trim() !== savedName;

  const save = useCallback(async () => {
    const win = frame.current?.contentWindow;
    if (!win || !ready || saving) return;
    const n = name.trim();
    if (!n) { toast.error('A map needs a name.'); return; }
    setSaving(true);
    try {
      const k = ++seq.current;
      const reply = await new Promise<Reply>((resolve, reject) => {
        pending.current.set(k, resolve);
        win.postMessage({ t: 'get', id: k }, location.origin);
        setTimeout(() => { if (pending.current.delete(k)) reject(new Error('The sim did not answer.')); }, 5000);
      });
      await api(`/api/maps/${encodeURIComponent(id)}`, { method: 'PUT', json: { name: n, course: reply.course } });
      setSavedSig(reply.sig); setSavedName(n); setName(n);
      toast.success('Map saved');
    } catch (e) { toast.error(`Not saved: ${(e as Error).message}`); }
    finally { setSaving(false); }
  }, [id, name, ready, saving]);

  // from the sim
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; }, [save]);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.source !== frame.current?.contentWindow) return;
      const m = e.data;
      if (!m || typeof m !== 'object') return;
      if (m.t === 'ready') setReady(true);
      else if (m.t === 'sig' && typeof m.sig === 'string') { setSig(m.sig); setSavedSig(s => s ?? m.sig); }   // the first one is the map as loaded
      else if (m.t === 'course') { const done = pending.current.get(m.id); if (done) { pending.current.delete(m.id); done({ course: m.course, sig: m.sig }); } }
      else if (m.t === 'ground' && typeof m.ground === 'string') setGround(m.ground);
      else if (m.t === 'save') void saveRef.current();
    };
    addEventListener('message', onMessage);
    return () => removeEventListener('message', onMessage);
  }, []);

  // Ctrl/Cmd+S outside the sim too; and no closing the tab on unsaved work
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') { e.preventDefault(); void saveRef.current(); } };
    const onUnload = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    addEventListener('keydown', onKey); addEventListener('beforeunload', onUnload);
    return () => { removeEventListener('keydown', onKey); removeEventListener('beforeunload', onUnload); };
  }, [dirty]);

  const tryOn = (g: string) => {
    const win = frame.current?.contentWindow;
    if (!win) return;
    setGround(g);
    win.postMessage({ t: 'ground', ground: g }, location.origin);
    frame.current?.focus(); win.postMessage({ t: 'focus' }, location.origin);   // the keys back to the sim
  };

  const back = (e: React.MouseEvent) => { if (dirty) { e.preventDefault(); setLeaving(true); } };

  return (
    <div className="fixed inset-0 flex flex-col bg-black">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background px-3">
        <Button variant="ghost" size="sm" asChild><Link href="/maps" onClick={back}><ChevronLeft /> Maps</Link></Button>
        <form className="flex min-w-0 flex-1 items-center gap-3" onSubmit={e => { e.preventDefault(); void save(); }}>
          <Input aria-label="Map name" value={name} onChange={e => setName(e.target.value)} maxLength={40} className="h-9 max-w-72 font-medium" />
          {builtin && <Badge variant="secondary" className="hidden sm:inline-flex">built in</Badge>}
          <span className="hidden text-sm text-muted-foreground md:inline" aria-live="polite">
            {!ready ? 'Loading the sim…' : dirty ? 'Unsaved changes' : <span className="inline-flex items-center gap-1"><Check className="size-4" /> Saved</span>}
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-2" title="Try the course on each ground: in a race, the host picks it">
            <span className="hidden text-xs text-muted-foreground sm:inline">Test on</span>
            <GroundControl value={ground ?? 'sand'} disabled={!ready || ground == null} onChange={tryOn} />
          </div>
          <span className="hidden text-xs text-muted-foreground 2xl:inline">E: drive / back to the editor · G: ground · Ctrl+S: save</span>
          <Button type="submit" disabled={!ready || saving || !dirty} className="shrink-0">
            {saving ? <Loader2 className="animate-spin" /> : <Save />} Save
          </Button>
        </form>
      </header>
      <div className="relative min-h-0 flex-1">
        {loaded && (
          <iframe ref={frame} src={withBase('/sim/index.html?edit=1')} title="Map editor: the sim's course editor"
            className="absolute inset-0 size-full border-0 bg-background" allow="autoplay; fullscreen" />
        )}
      </div>

      <Dialog open={leaving} onOpenChange={setLeaving}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leave without saving?</DialogTitle>
            <DialogDescription>The changes to {savedName} since the last save will be lost.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLeaving(false)}>Stay</Button>
            <Button variant="destructive" onClick={() => { setLeaving(false); router.push('/maps'); }}>Leave</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
