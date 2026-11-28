'use client';
// The arm sim's saved networks (#362), beside the sim on /arm: save the network on show under a name (signed in), and the
// networks saved for this arm and scenario, the best exams first, to load (anyone) or delete (whoever saved it).
// The server: app/api/arm/networks, lib/arm/store.mjs. Each has a link, /arm/<id> (#364): Share gives it.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CloudUpload, FolderOpen, Share2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/client/maps';
import { withBase } from '@/lib/base-path';
import type { ArmKey, ArmNet, TaskKey } from '@/lib/arm/core.mjs';
import type { ArmExam, ArmNetSummary } from '@/lib/arm/store.mjs';

type Saved = Omit<ArmNetSummary, 'owner'> & { mine: boolean };
const examText = (e: ArmExam | null) => e ? `${e.done} of ${e.of}${e.done > 0 ? ` in ${e.time.toFixed(1)} s` : ''}` : 'not examined';

/** A saved network's link (#364): the share sheet where there is one to a finger (phones), else copied. */
export async function shareNet(id: string, name: string) {
  const url = `${location.origin}${withBase(`/arm/${id}`)}`;
  if (typeof navigator.share === 'function' && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ title: `${name} · an arm network`, url }); return; }
    catch (e) { if ((e as Error).name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); toast.success('Link copied', { description: url }); }
  catch { toast.error('Could not copy the link', { description: url }); }
}

export function ArmSaved({ arm, task, signedIn, net, exam, defaultName, onLoad, onSaved, savedOn }: {
  arm: ArmKey; task: TaskKey; signedIn: boolean;
  /** the network on show (null: none), and its exam as this page ran it (null: not yet) */
  net: ArmNet | null; exam: ArmExam | null; defaultName: string;
  /** a saved one put on show: the network, its line under the sim, its id and its own name */
  onLoad: (net: ArmNet, name: string, id: string, title: string) => void;
  /** the network on show was just saved as id */
  onSaved: (id: string, name: string, net: ArmNet) => void;
  /** the id of the saved network on show, if it is one */
  savedOn: string | null;
}) {
  const [list, setList] = useState<Saved[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try { setList((await api<{ networks: Saved[] }>(`/api/arm/networks?arm=${arm}&task=${task}`)).networks); }
    catch (e) { setList([]); setMsg({ ok: false, text: `The saved networks could not load: ${(e as Error).message}` }); }
  }, [arm, task]);
  useEffect(() => { setList(null); setMsg(null); void load(); }, [load]);
  useEffect(() => { setName(defaultName.slice(0, 60)); }, [defaultName]);

  const mineToSave = !!net && (net.arm ?? 'desk') === arm && net.task === task;
  const save = async () => {
    if (!net || !name.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const r = await api<{ network: Saved }>('/api/arm/networks', { method: 'POST', json: { name: name.trim(), net, exam } });
      onSaved(r.network.id, r.network.name, net);
      await load(); setMsg({ ok: true, text: `Saved as “${r.network.name}”: Share gives its link.` });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  };
  const open = async (n: Saved) => {
    setMsg(null);
    try { const r = await api<{ network: Saved & { net: ArmNet } }>(`/api/arm/networks/${n.id}`); onLoad({ ...r.network.net, exam: r.network.exam }, `${r.network.name} · by ${r.network.ownerName}`, r.network.id, r.network.name); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  const remove = async (n: Saved) => {
    if (!confirm(`Delete “${n.name}”?`)) return;
    try { await api(`/api/arm/networks/${n.id}`, { method: 'DELETE' }); await load(); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };

  return (
    <section aria-labelledby="arm-saved-title" className="panel p-4">
      <h2 id="arm-saved-title" className="eyebrow text-[0.62rem] text-muted-foreground">Saved networks</h2>
      {signedIn ? (
        mineToSave ? (
          <form className="mt-2 flex gap-2" onSubmit={ev => { ev.preventDefault(); void save(); }}>
            <label className="sr-only" htmlFor="arm-save-name">Its name</label>
            <input id="arm-save-name" value={name} maxLength={60} onChange={ev => setName(ev.target.value)} placeholder="Its name"
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm" />
            <Button type="submit" size="sm" variant="tnn" disabled={busy || !name.trim()}><CloudUpload /> Save</Button>
          </form>
        ) : <p className="mt-2 text-sm text-muted-foreground">Train or load a network to save it.</p>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground"><Link className="font-medium text-foreground underline underline-offset-4" href={`/signin?next=/arm${savedOn ? `/${savedOn}` : ''}`}>Sign in</Link> to save your networks here.</p>
      )}
      {signedIn && mineToSave && <p className="mt-1.5 text-xs text-muted-foreground">Saved with its exam as it ran here: {exam ? examText(exam) : 'still running…'}.</p>}
      {msg && <p role="status" className={`mt-2 text-xs ${msg.ok ? 'text-tnn' : 'text-destructive'}`}>{msg.text}</p>}

      <div className="mt-3">
        {list == null ? <p className="text-xs text-muted-foreground">Loading…</p>
          : !list.length ? <p className="text-xs text-muted-foreground">None saved for this arm and scenario yet.</p>
            : (
              <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                {list.map(n => (
                  <li key={n.id} className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 ${n.id === savedOn ? 'border-tnn/40 bg-tnn/5' : 'border-white/6 bg-white/3'}`}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium" title={n.name}>{n.name}</p>
                      <p className="num text-xs text-pretty text-muted-foreground">{n.mine ? 'yours' : n.ownerName} · {n.weights} weights · <span className={n.exam?.done ? 'text-tnn' : ''}>{examText(n.exam)}</span></p>
                    </div>
                    <Button size="sm" variant="glass" onClick={() => open(n)} aria-label={`Load ${n.name}`}><FolderOpen /> Load</Button>
                    <Button size="icon-sm" variant="ghost" onClick={() => shareNet(n.id, n.name)} aria-label={`Share ${n.name}`} title="Share its link"><Share2 /></Button>
                    {n.mine && <Button size="icon-sm" variant="ghost" onClick={() => remove(n)} aria-label={`Delete ${n.name}`}><Trash2 /></Button>}
                  </li>
                ))}
              </ul>
            )}
      </div>
    </section>
  );
}
