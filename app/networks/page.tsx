import { Brain, Play } from 'lucide-react';
import { auth } from '@/auth';
import { Button } from '@/components/ui/button';
import { SiteNav } from '@/components/site-nav';
import { SiteFooter } from '@/components/site-footer';
import { NetDiagram } from '@/components/net-diagram';
import { carName, groundLabel } from '@/components/showcase';
import { withBase } from '@/lib/base-path';
import { ago, fmtGap, fmtLap, publicName } from '@/lib/format';
import { netShape } from '@/lib/tnn';
import { showcase, type Network, type Scoreboard } from '@/lib/showcase/store.mjs';

export const metadata = { title: 'Networks', description: 'Every tiny neural network trained on Carsim and saved: its wiring, its weights, its best lap.' };
export const dynamic = 'force-dynamic';

export default async function Networks() {
  const session = await auth();
  const user = session?.user ? { name: session.user.name ?? 'Driver', image: session.user.image ?? null, admin: session.user.admin } : null;
  let data: Scoreboard | null = null;
  try { data = await showcase().board(); } catch (e) { console.error('[networks]', e); }
  const nets = data?.networks ?? [];
  const trackName = (id: string | null) => data?.tracks.find(t => t.id === id)?.name ?? null;
  // the human lap a network is up against: the same car on the same track and ground
  const rival = (n: Network) => data?.boards.find(b => b.track === n.track && b.ground === n.ground)?.rows.find(r => r.vehicle === n.vehicle)?.human ?? null;
  const fastest = new Set((data?.boards ?? []).flatMap(b => b.rows.map(r => r.tnn?.id)).filter(Boolean));

  return (
    <div className="relative overflow-x-clip">
      <div aria-hidden className="grid-fade pointer-events-none absolute inset-0 h-[700px]" />
      <SiteNav user={user} active="networks" />
      <main className="relative mx-auto max-w-7xl px-4 pt-12 sm:px-6 sm:pt-16">
        <p className="eyebrow text-tnn">Networks</p>
        <h1 className="display mt-3 text-4xl text-balance sm:text-6xl">Every driver that was <span className="text-tnn">trained</span>, not born.</h1>
        <p className="mt-4 max-w-3xl text-lg text-pretty text-muted-foreground">
          The networks people trained and saved, newest first. Each drawing is the network itself: a line for every weight, orange where it pulls toward
          left or gas, blue toward right or brake. Watch any of them drive its lap, or load it in the lab and train it further.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild size="lg" variant="tnn" className="px-4"><a href={withBase('/lab')}><Brain /> Train your own</a></Button>
        </div>

        {nets.length ? (
          <ul className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {nets.map(n => {
              const shape = netShape(n), h = rival(n), gap = h && n.bestLap != null ? n.bestLap - h.time : null, track = trackName(n.track);
              return (
                <li key={n.id} className="panel flex flex-col p-5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="eyebrow text-tnn">{shape.weights} weights{n.h ? ` · ${n.h} hidden` : ''}</p>
                    {fastest.has(n.id) && <span className="eyebrow shrink-0 rounded-full border border-tnn/30 bg-tnn/10 px-2 py-1 text-[0.62rem] text-tnn">fastest for its car</span>}
                  </div>
                  <h2 className="mt-2 line-clamp-2 font-semibold text-pretty" title={n.name}>{n.name}</h2>
                  <p className="mt-1 truncate text-sm text-muted-foreground">{carName(n.vehicle)} · {track ? `${track}, ${groundLabel(n.ground)}` : 'a course of its maker’s own'}</p>
                  <div className="my-4 rounded-xl border border-white/6 bg-black/20 p-3">
                    <NetDiagram net={n} className="max-h-64" />
                  </div>
                  <dl className="mt-auto grid grid-cols-3 gap-2 text-sm">
                    <div><dt className="eyebrow text-[0.6rem] text-muted-foreground/70">Best lap</dt><dd className="num mt-1 font-medium">{n.bestLap != null ? fmtLap(n.bestLap) : 'no lap yet'}</dd></div>
                    <div><dt className="eyebrow text-[0.6rem] text-muted-foreground/70">vs human</dt><dd className={`num mt-1 font-medium ${gap == null ? 'text-muted-foreground/60' : gap < 0 ? 'text-tnn' : 'text-human'}`}>{gap == null ? '—' : fmtGap(gap)}</dd></div>
                    <div><dt className="eyebrow text-[0.6rem] text-muted-foreground/70">Generations</dt><dd className="num mt-1 font-medium">{n.gen.toLocaleString('en-US')}</dd></div>
                  </dl>
                  <Button asChild variant="tnn" className="mt-4 w-full"><a href={withBase(`/sim/index.html?net=${encodeURIComponent(n.id)}`)} title={track ? `It drives its car on ${track}` : 'Trained on a course of its maker’s own: it drives on the figure-8'}><Play /> Watch it drive</a></Button>
                  <p className="mt-4 border-t border-white/6 pt-3 text-xs text-muted-foreground">
                    Saved by {publicName(n.ownerName, !!user)}, {ago(n.savedAt)}
                    {(n.handbrake || n.noBrake || n.keyPedals || n.keySteering) && <> · {[n.handbrake && 'handbrake', n.noBrake && 'no brake', n.keyPedals && 'on/off pedals', n.keySteering && 'on/off steering'].filter(Boolean).join(', ')}</>}
                  </p>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="panel mt-10 p-10 text-center">
            <h2 className="heading text-2xl">{data ? 'No network saved yet' : 'The networks are not available right now'}</h2>
            <p className="mx-auto mt-2 max-w-md text-muted-foreground">{data ? 'Train one in the lab and press Save to server: it shows here.' : 'Try again in a moment.'}</p>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
