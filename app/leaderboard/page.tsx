import Link from 'next/link';
import { Brain, Play } from 'lucide-react';
import { auth } from '@/auth';
import { Button } from '@/components/ui/button';
import { SiteNav } from '@/components/site-nav';
import { SiteFooter } from '@/components/site-footer';
import { BoardCard, GapBadge, carName, groundLabel } from '@/components/showcase';
import { TrackOutline } from '@/components/track-outline';
import { fmtLap, netLabel, publicName } from '@/lib/format';
import { showcase, type Scoreboard } from '@/lib/showcase/store.mjs';

export const metadata = { title: 'Leaderboard', description: 'Humans against tiny neural networks: the best lap of each, car by car, on every track.' };
export const dynamic = 'force-dynamic';

export default async function Leaderboard() {
  const session = await auth();
  const user = session?.user ? { name: session.user.name ?? 'Driver', image: session.user.image ?? null, admin: session.user.admin } : null;
  let data: Scoreboard | null = null;
  try { data = await showcase().board(); } catch (e) { console.error('[leaderboard]', e); }
  const boards = data?.boards ?? [], track = (id: string) => data!.tracks.find(t => t.id === id)!;
  const duels = boards.flatMap(b => b.duels.map(d => ({ b, d }))).sort((x, y) => Math.abs(x.d.gap) - Math.abs(y.d.gap));
  const tnn = duels.filter(x => x.d.gap < 0).length;

  return (
    <div className="relative overflow-x-clip">
      <div aria-hidden className="grid-fade pointer-events-none absolute inset-0 h-[700px]" />
      <SiteNav user={user} active="leaderboard" />
      <main className="relative mx-auto max-w-7xl px-4 pt-12 sm:px-6 sm:pt-16">
        <p className="eyebrow text-primary">Leaderboard</p>
        <h1 className="display mt-3 text-4xl text-balance sm:text-6xl"><span className="text-human">Humans</span> <span className="text-muted-foreground/60">vs.</span> <span className="text-tnn">networks</span></h1>
        <p className="mt-4 max-w-3xl text-lg text-pretty text-muted-foreground">
          One row for each car on each track: the best lap a person has driven in a race room, and the best lap a saved network has driven in its exam.
          Same simulator, same timing. Laps count on a track as it is laid out now.
        </p>

        {duels.length > 0 && (
          <section aria-label="Duels" className="mt-10">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="heading text-2xl">The duels</h2>
              <p className="num text-sm text-muted-foreground">same car, same track · networks lead <span className="text-tnn">{tnn}</span>, humans <span className="text-human">{duels.length - tnn}</span></p>
            </div>
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {duels.map(({ b, d }) => {
                const t = track(b.track), tnnAhead = d.gap < 0;
                return (
                  <li key={`${b.track}-${b.ground}-${d.vehicle}`} className="panel flex items-center gap-4 p-4">
                    <TrackOutline wp={t.wp} width={64} height={48} stroke={2.2} className="h-12 w-16 shrink-0 text-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{carName(d.vehicle)}</p>
                      <p className="num truncate text-xs text-muted-foreground">{t.name} · {groundLabel(b.ground)}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <GapBadge gap={d.gap} />
                        {d.human.ghost && d.tnn.saved && (
                          <Link href={`/duel/${encodeURIComponent(b.track)}/${b.ground}/${encodeURIComponent(d.vehicle)}`}
                            className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2.5 py-1 text-xs font-medium text-muted-foreground outline-none transition-colors hover:border-white/25 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                            <Play className="size-3 fill-current" aria-hidden /> Watch the duel
                          </Link>
                        )}
                      </div>
                    </div>
                    <div className="num text-right text-sm">
                      <p className={tnnAhead ? 'text-muted-foreground' : 'font-semibold text-human'} title={`Human: ${publicName(d.human.name, !!user)}`}>{fmtLap(d.human.time)}</p>
                      <p className={tnnAhead ? 'font-semibold text-tnn' : 'text-muted-foreground'} title={`Network: ${netLabel(d.tnn, !!user)}, ${d.tnn.weights} weights`}>{fmtLap(d.tnn.time)}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {boards.length ? (
          <section aria-label="Tracks" className="mt-12 gap-5 lg:columns-2">
            {boards.map(b => <div key={`${b.track}-${b.ground}`} id={`${b.track}-${b.ground}`} className="mb-5 scroll-mt-24 break-inside-avoid"><BoardCard board={b} track={track(b.track)} full={!!user} /></div>)}
          </section>
        ) : (
          <div className="panel mt-10 p-10 text-center">
            <h2 className="heading text-2xl">{data ? 'No lap on the board yet' : 'The leaderboard is not available right now'}</h2>
            <p className="mx-auto mt-2 max-w-md text-muted-foreground">{data ? 'Laps driven in race rooms and networks saved to the server show here.' : 'Try again in a moment.'}</p>
          </div>
        )}

        <section className="mt-12 grid gap-5 md:grid-cols-2">
          <div className="panel p-6">
            <h2 className="heading text-xl text-human">Put a human lap on it</h2>
            <p className="mt-2 text-pretty text-muted-foreground">Open a race room, alone or with others, pick a track and a car and drive. Every valid lap, through every gate, counts, raced or not.</p>
            <Button asChild size="lg" className="mt-5 px-4"><Link href="/lobby"><Play className="fill-current" /> Open a race room</Link></Button>
          </div>
          <div className="panel p-6">
            <h2 className="heading text-xl text-tnn">Put a network’s lap on it</h2>
            <p className="mt-2 text-pretty text-muted-foreground">Train a network on one of these tracks in a race room’s lab and press Save to server. Its best exam lap goes on the board under its car. AI agents send theirs in on their own: <Link href="/agents" className="font-medium text-foreground underline underline-offset-2">how agents compete</Link>.</p>
            <Button asChild size="lg" variant="tnn" className="mt-5 px-4"><Link href="/lobby"><Brain /> Train in a race room</Link></Button>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
