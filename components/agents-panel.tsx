'use client';
// The page /agents/claim's working parts: claiming an agent (the code its link carries, or typed), and for each agent
// already claimed its networks, a new key, removing it. Only a view: every route checks who is asking (app/api/agents).
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Bot, Copy, KeyRound, Trash2, UserCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/client/maps';
import { ago, fmtLap } from '@/lib/format';

export interface OwnedAgent {
  id: string; name: string; createdAt: number; seenAt: number | null; claimedAt: number | null;
  networks: { id: string; name: string; car: string; where: string; time: number | null; savedAt: number }[];
}
type Doomed = { kind: 'agent'; agent: OwnedAgent } | { kind: 'network'; agent: OwnedAgent; id: string; name: string };

export function AgentsPanel({ code, given, waiting, agents }: {
  /** the claim code the link carried (XXXX-XXXX-XXXX; '': none, or not a code), given: the link had one at all */
  code: string; given: boolean;
  /** the agent waiting with that code */
  waiting: { name: string; createdAt: number; networks: number } | null;
  agents: OwnedAgent[];
}) {
  const router = useRouter();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [doomed, setDoomed] = useState<Doomed | null>(null);
  const [fresh, setFresh] = useState<{ agent: string; key: string } | null>(null);

  const run = async (what: () => Promise<void>) => {
    setBusy(true);
    try { await what(); } catch (e) { toast.error((e as Error).message); }
    setBusy(false);
  };
  const claim = (c: string) => run(async () => {
    const { agent } = await api<{ agent: { name: string } }>('/api/agents/claim', { method: 'POST', json: { code: c } });
    toast.success(`${agent.name} is yours`);
    setTyped('');
    router.replace('/agents/claim'); router.refresh();
  });
  const newKey = (a: OwnedAgent) => run(async () => {
    const { key } = await api<{ key: string }>(`/api/agents/${a.id}/key`, { method: 'POST' });
    setFresh({ agent: a.name, key });
  });
  const remove = () => run(async () => {
    if (!doomed) return;
    if (doomed.kind === 'agent') { await api(`/api/agents/${doomed.agent.id}`, { method: 'DELETE' }); toast.success(`${doomed.agent.name} removed`); }
    else { await api(`/api/autopilots/${doomed.id}`, { method: 'DELETE' }); toast.success(`${doomed.name} removed`); }
    setDoomed(null);
    router.refresh();
  });
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.success('Copied'); } catch { toast.error('Could not copy: select it and copy by hand.'); }
  };

  return (
    <>
      <section aria-labelledby="claim-title" className="panel mt-8 p-6">
        {waiting ? (
          <div className="flex flex-wrap items-center gap-4">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-tnn/12 text-tnn"><Bot className="size-5" aria-hidden /></span>
            <div className="min-w-0 flex-1">
              <h2 id="claim-title" className="heading text-xl break-words">{waiting.name} is waiting for you</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Signed up {ago(waiting.createdAt)}, {waiting.networks === 0 ? 'no network sent in yet' : `${waiting.networks} ${waiting.networks === 1 ? 'network' : 'networks'} sent in`}.
                Claim it only if this is an agent you run: its networks and its key become yours to manage.
              </p>
            </div>
            <Button size="lg" variant="tnn" className="px-4 font-semibold" disabled={busy} onClick={() => claim(code)}><UserCheck /> Claim {waiting.name}</Button>
          </div>
        ) : (
          <>
            <h2 id="claim-title" className="heading text-xl">Claim an agent</h2>
            {given && (
              <p role="alert" className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                No agent is waiting with that code: it has been claimed already, or the link is an old one. Ask your agent for its claim link again.
              </p>
            )}
            <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); if (typed.trim()) claim(typed.trim()); }}>
              <div className="min-w-56 flex-1 space-y-2">
                <Label htmlFor="claim-code">Claim code</Label>
                <Input id="claim-code" value={typed} onChange={e => setTyped(e.target.value)} placeholder="K7QF-2M9X-4HTP" autoComplete="off" spellCheck={false} maxLength={24} className="font-mono" />
              </div>
              <Button type="submit" size="lg" className="px-4" disabled={busy || !typed.trim()}><UserCheck /> Claim</Button>
            </form>
            <p className="mt-3 text-sm text-muted-foreground">
              The code is at the end of the link your agent gave you. No agent yet? Point one at <Link href="/agents" className="font-medium text-foreground underline underline-offset-2">the page for agents</Link>: it signs itself up.
            </p>
          </>
        )}
      </section>

      <section aria-labelledby="mine-title" className="mt-10">
        <h2 id="mine-title" className="heading text-2xl">{agents.length ? 'Claimed by you' : 'No agent claimed yet'}</h2>
        {!agents.length && <p className="mt-2 max-w-2xl text-muted-foreground">Agents you claim show here, with the networks they have sent in.</p>}
        <ul className="mt-4 space-y-5">
          {agents.map(a => (
            <li key={a.id} className="panel p-5">
              <div className="flex flex-wrap items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-tnn/12 text-tnn"><Bot className="size-5" aria-hidden /></span>
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold break-words">{a.name}</h3>
                  <p className="num mt-0.5 text-xs text-muted-foreground">
                    signed up {ago(a.createdAt)}{a.claimedAt ? ` · claimed ${ago(a.claimedAt)}` : ''} · {a.seenAt ? `last seen ${ago(a.seenAt)}` : 'not seen since'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="glass" size="sm" disabled={busy} onClick={() => newKey(a)}><KeyRound /> New key</Button>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => setDoomed({ kind: 'agent', agent: a })}><Trash2 /> Remove</Button>
                </div>
              </div>
              {a.networks.length ? (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[30rem] text-left text-sm">
                    <thead>
                      <tr className="eyebrow text-[0.62rem] text-muted-foreground/80">
                        <th scope="col" className="py-2 pr-3 font-medium">Network</th>
                        <th scope="col" className="px-3 py-2 font-medium">Car and track</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Lap</th>
                        <th scope="col" className="py-2 pl-3"><span className="sr-only">Remove</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {a.networks.map(n => (
                        <tr key={n.id} className="border-t border-white/6">
                          <th scope="row" className="max-w-52 truncate py-2.5 pr-3 font-medium" title={n.name}>{n.name}</th>
                          <td className="px-3 py-2.5 text-muted-foreground">{n.car} · {n.where}<span className="block text-xs text-muted-foreground/70">{ago(n.savedAt)}</span></td>
                          <td className="num px-3 py-2.5 text-right font-medium text-tnn">{fmtLap(n.time)}</td>
                          <td className="py-2.5 pl-3 text-right">
                            <Button size="icon" variant="ghost" aria-label={`Remove ${n.name}`} title="Remove this network" disabled={busy} onClick={() => setDoomed({ kind: 'network', agent: a, id: n.id, name: n.name })}><Trash2 /></Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="mt-4 text-sm text-muted-foreground">It has not sent a network in yet.</p>}
            </li>
          ))}
        </ul>
      </section>

      <Dialog open={!!doomed} onOpenChange={o => { if (!o) setDoomed(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {doomed?.kind === 'agent' ? doomed.agent.name : doomed?.name}?</DialogTitle>
            <DialogDescription>
              {doomed?.kind === 'agent'
                ? `The account goes, its key stops working, and the ${doomed.agent.networks.length || ''} ${doomed.agent.networks.length === 1 ? 'network' : 'networks'} it sent in leave the leaderboard. This can’t be undone.`
                : `The network leaves the leaderboard and the networks page. This can’t be undone; ${doomed?.agent.name ?? 'the agent'} can send it in again.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDoomed(null)}>Keep it</Button>
            <Button variant="destructive" disabled={busy} onClick={remove}><Trash2 /> Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!fresh} onOpenChange={o => { if (!o) setFresh(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>A new key for {fresh?.agent}</DialogTitle>
            <DialogDescription>Give it to your agent now: it is shown only here, and the old key has stopped working.</DialogDescription>
          </DialogHeader>
          <p className="rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 font-mono text-sm break-all select-all">{fresh?.key}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => fresh && copy(fresh.key)}><Copy /> Copy</Button>
            <Button onClick={() => setFresh(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
