import Link from 'next/link';
import { Brain } from 'lucide-react';
import { auth } from '@/auth';
import { Button } from '@/components/ui/button';
import { SiteNav } from '@/components/site-nav';
import { SiteFooter } from '@/components/site-footer';
import { NetDiagram } from '@/components/net-diagram';
import { carName, groundLabel } from '@/components/showcase';
import { ago, fmtGap, fmtLap, publicName } from '@/lib/format';
import { netShape } from '@/lib/tnn';
import { netList, trackOf } from '@/lib/net-list.mjs';
import { showcase, type Network, type Scoreboard } from '@/lib/showcase/store.mjs';
import { withBase } from '@/lib/base-path';

export const metadata = { title: 'Networks', description: 'Every tiny neural network trained on Carsim and saved: its wiring, its weights, its best lap.', alternates: { canonical: withBase('/networks') } };
export const dynamic = 'force-dynamic';

const SHOWN = 8;   // the cards that draw their network; the rest are a line each (a drawing is ~45 KB of HTML)
type Q = { car?: string; track?: string; all?: string };

export default async function Networks({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams, one = (k: string) => { const v = sp[k]; return typeof v === 'string' ? v : undefined; };
  const q: Q = { car: one('car'), track: one('track'), all: one('all') };
  const href = (o: Q) => { const u = new URLSearchParams(Object.entries({ ...q, ...o }).filter(([, v]) => v) as [string, string][]).toString(); return `/networks${u ? `?${u}` : ''}`; };
  const session = await auth();
  const user = session?.user ? { name: session.user.name ?? 'Driver', image: session.user.image ?? null, admin: session.user.admin } : null;
  let data: Scoreboard | null = null;
  try { data = await showcase().board(); } catch (e) { console.error('[networks]', e); }
  const all = netList(data?.networks ?? []);
  const trackName = (id: string | null) => data?.tracks.find(t => t.id === id)?.name ?? null;
  // the human lap a network is up against: the same car on the same track and ground
  const rival = (n: Network) => data?.boards.find(b => b.track === n.track && b.ground === n.ground)?.rows.find(r => r.vehicle === n.vehicle)?.human ?? null;
  const trackLabel = (n: Network) => trackName(n.track) ?? 'a course of its maker’s own';
  const count = (key: (n: Network) => string, label: (n: Network) => string) => [...all.reduce((m, n) => m.set(key(n), { label: label(n), n: (m.get(key(n))?.n ?? 0) + 1 }), new Map<string, { label: string; n: number }>())].sort((a, b) => b[1].n - a[1].n);
  const cars = count(n => n.vehicle, n => carName(n.vehicle)), tracks = count(trackOf, trackLabel);
  const nets = all.filter(n => (!q.car || n.vehicle === q.car) && (!q.track || trackOf(n) === q.track));
  const drawn = q.all ? nets.length : SHOWN;
  const chip = (on: boolean) => `rounded-full border px-3 py-1 text-xs ${on ? 'border-tnn/40 bg-tnn/10 text-tnn' : 'border-white/10 text-muted-foreground hover:text-foreground'}`;

  return (
    <div className="relative overflow-x-clip">
      <div aria-hidden className="grid-fade pointer-events-none absolute inset-0 h-[700px]" />
      <SiteNav user={user} active="networks" />
      <main className="relative mx-auto max-w-7xl px-4 pt-12 sm:px-6 sm:pt-16">
        <p className="eyebrow text-tnn">Networks</p>
        <h1 className="display mt-3 text-4xl text-balance sm:text-6xl">Every driver that was <span className="text-tnn">trained</span>, not born.</h1>
        <p className="mt-4 max-w-3xl text-lg text-pretty text-muted-foreground">
          The networks people trained and saved, newest first. Each drawing is the network itself: a line for every weight, orange where it pulls toward
          left or gas, blue toward right or brake. In a race room’s lab, From server loads one (yours or anyone’s) to train it further.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild size="lg" variant="tnn" className="px-4"><Link href="/lobby"><Brain /> Train your own</Link></Button>
        </div>

        {all.length > 0 && (
          <div className="mt-8 space-y-2">
            <div className="flex flex-wrap items-center gap-2"><span className="eyebrow w-12 text-[0.62rem] text-muted-foreground/70">Car</span>
              <Link href={href({ car: undefined })} className={chip(!q.car)}>All · {all.length}</Link>
              {cars.map(([id, c]) => <Link key={id} href={href({ car: id })} className={chip(q.car === id)}>{c.label} · {c.n}</Link>)}</div>
            <div className="flex flex-wrap items-center gap-2"><span className="eyebrow w-12 text-[0.62rem] text-muted-foreground/70">Track</span>
              <Link href={href({ track: undefined })} className={chip(!q.track)}>All</Link>
              {tracks.map(([id, c]) => <Link key={id} href={href({ track: id })} className={chip(q.track === id)}>{c.label} · {c.n}</Link>)}</div>
          </div>
        )}

        {nets.length ? (<>
          <ul className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {nets.slice(0, drawn).map(n => {
              const shape = netShape(n), h = rival(n), gap = h && n.bestLap != null ? n.bestLap - h.time : null, track = trackName(n.track);
              return (
                <li key={n.id} className="panel flex flex-col p-5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="eyebrow text-tnn">{shape.weights} weights{n.h ? ` · ${n.h} hidden` : ''}</p>
                    {n.fastest && <span className="eyebrow shrink-0 rounded-full border border-tnn/30 bg-tnn/10 px-2 py-1 text-[0.62rem] text-tnn">fastest for its car on this track</span>}
                  </div>
                  <h2 className="mt-2 line-clamp-2 font-semibold text-pretty" title={n.name}>{n.name}</h2>
                  <p className="mt-1 truncate text-sm text-muted-foreground">{carName(n.vehicle)} · {track ? `${track}, ${groundLabel(n.ground)}` : 'a course of its maker’s own'}</p>
                  {n.past.length > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground/80" title="The circuits it was trained on before the one it was saved on, and its generations on each">
                      Trained before on {n.past.map(p => `${trackName(p.track ?? null) ?? p.trackName ?? 'a course of its maker’s own'} (${groundLabel(p.ground)}${p.vehicle !== n.vehicle ? `, ${carName(p.vehicle)}` : ''}, gen. ${p.from.toLocaleString('en-US')}–${p.to.toLocaleString('en-US')})`).join(' · ')}
                    </p>
                  )}
                  <div className="my-4 rounded-xl border border-white/6 bg-black/20 p-3">
                    <NetDiagram net={n} className="max-h-64" />
                  </div>
                  <dl className="mt-auto grid grid-cols-3 gap-2 text-sm">
                    <div><dt className="eyebrow text-[0.6rem] text-muted-foreground/70">Best lap</dt><dd className="num mt-1 font-medium">{n.bestLap != null ? fmtLap(n.bestLap) : 'no lap yet'}</dd></div>
                    <div><dt className="eyebrow text-[0.6rem] text-muted-foreground/70">vs human</dt><dd className={`num mt-1 font-medium ${gap == null ? 'text-muted-foreground/60' : gap < 0 ? 'text-tnn' : 'text-human'}`}>{gap == null ? '—' : fmtGap(gap)}</dd></div>
                    <div><dt className="eyebrow text-[0.6rem] text-muted-foreground/70">Generations</dt><dd className="num mt-1 font-medium">{n.gen.toLocaleString('en-US')}</dd></div>
                  </dl>
                  <p className="mt-4 border-t border-white/6 pt-3 text-xs text-muted-foreground">
                    Saved by {publicName(n.ownerName, !!user)}, {ago(n.savedAt)}
                    {n.also.length > 0 && <> · saved {n.also.length === 1 ? 'twice' : `${n.also.length + 1} times`}, also as “{n.also.map(a => a.name).join('”, “')}”</>}
                    {(n.handbrake || n.noBrake || n.keyPedals || n.keySteering) && <> · {[n.handbrake && 'handbrake', n.noBrake && 'no brake', n.keyPedals && 'on/off pedals', n.keySteering && 'on/off steering'].filter(Boolean).join(', ')}</>}
                  </p>
                </li>
              );
            })}
          </ul>
          {nets.length > drawn && (
            <>
              <ul className="mt-5 divide-y divide-white/6 rounded-xl border border-white/6 text-sm">
                {nets.slice(drawn).map(n => (
                  <li key={n.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3">
                    <span className="min-w-0 flex-1 truncate font-medium" title={n.name}>{n.name}</span>
                    <span className="text-muted-foreground">{carName(n.vehicle)} · {trackLabel(n)}</span>
                    <span className="num">{n.bestLap != null ? fmtLap(n.bestLap) : 'no lap yet'}</span>
                    {n.fastest && <span className="eyebrow rounded-full border border-tnn/30 bg-tnn/10 px-2 py-0.5 text-[0.6rem] text-tnn">fastest for its car on this track</span>}
                    <span className="text-xs text-muted-foreground">{netShape(n).weights} weights · {ago(n.savedAt)}{n.also.length > 0 && ' · saved twice'}</span>
                  </li>
                ))}
              </ul>
              {!q.all && <p className="mt-4"><Link href={href({ all: '1' })} className="text-sm text-tnn hover:underline">Draw all {nets.length} →</Link></p>}
            </>
          )}
        </>) : (
          <div className="panel mt-10 p-10 text-center">
            <h2 className="heading text-2xl">{data ? (all.length ? 'No network matches' : 'No network saved yet') : 'The networks are not available right now'}</h2>
            <p className="mx-auto mt-2 max-w-md text-muted-foreground">{data ? (all.length ? 'Try another car or track.' : 'Train one in the lab and press Save to server: it shows here.') : 'Try again in a moment.'}</p>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
