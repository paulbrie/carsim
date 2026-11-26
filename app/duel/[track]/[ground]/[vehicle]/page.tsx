import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { auth } from '@/auth';
import { Button } from '@/components/ui/button';
import { SiteNav } from '@/components/site-nav';
import { SiteFooter } from '@/components/site-footer';
import { GapBadge, carName, groundLabel } from '@/components/showcase';
import { DuelView } from '@/components/duel-view';
import { fmtLap, netLabel, publicName } from '@/lib/format';
import { withBase } from '@/lib/base-path';
import { showcase } from '@/lib/showcase/store.mjs';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ track: string; ground: string; vehicle: string }> };

/** A duel of the leaderboard, to watch (public): the network drives live, the human's best lap is the ghost. */
export async function generateMetadata({ params }: Ctx) {
  const { track, ground, vehicle } = await params;
  return { title: `Duel: ${carName(vehicle)} on ${track} (${ground})`, alternates: { canonical: withBase(`/duel/${encodeURIComponent(track)}/${ground}/${vehicle}`) } };
}

export default async function DuelPage({ params }: Ctx) {
  const { track: trackId, ground, vehicle } = await params;
  const session = await auth();
  const user = session?.user ? { name: session.user.name ?? 'Driver', image: session.user.image ?? null, admin: session.user.admin } : null;
  const full = !!user;
  const data = await showcase().board().catch(e => { console.error('[duel]', e); return null; });
  const t = data?.tracks.find(x => x.id === trackId);
  const d = data?.boards.find(b => b.track === trackId && b.ground === ground)?.duels.find(x => x.vehicle === vehicle);
  if (!data || !t || !d) notFound();
  const trace = d.human.ghost && d.tnn.saved ? await showcase().trace(trackId, ground, vehicle, d.human.id, t.v).catch(() => null) : null;
  const human = publicName(d.human.name, full), net = netLabel(d.tnn, full), tnnAhead = d.gap < 0;

  return (
    <div className="relative overflow-x-clip">
      <div aria-hidden className="grid-fade pointer-events-none absolute inset-0 h-[700px]" />
      <SiteNav user={user} active="leaderboard" />
      <main className="relative mx-auto max-w-7xl px-4 pt-10 sm:px-6 sm:pt-14">
        <Button asChild variant="ghost" className="-ml-3 mb-4 text-muted-foreground"><Link href="/leaderboard"><ArrowLeft /> Leaderboard</Link></Button>
        <p className="eyebrow text-primary">The duel</p>
        <h1 className="display mt-3 text-3xl text-balance sm:text-5xl">{carName(vehicle)} on {t.name} <span className="text-muted-foreground/60">· {groundLabel(ground)}</span></h1>

        <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
          <div className="panel p-4">
            <p className="eyebrow text-human">Human · the see-through car</p>
            <p className="mt-1 truncate font-semibold">{human}</p>
            <p className={`num mt-1 text-2xl ${tnnAhead ? '' : 'text-human'}`}>{fmtLap(d.human.time)}</p>
          </div>
          <div className="panel p-4">
            <p className="eyebrow text-tnn">Network · driving now</p>
            <p className="mt-1 truncate font-semibold">{net}</p>
            <p className={`num mt-1 text-2xl ${tnnAhead ? 'text-tnn' : ''}`}>{fmtLap(d.tnn.time)}</p>
          </div>
          <GapBadge gap={d.gap} />
        </div>

        <div className="mt-6">
          {trace ? (
            <DuelView track={t.id} v={t.v} ground={ground} vehicle={vehicle} networkId={d.tnn.id} ghost={{ name: human, time: d.human.time, trace }}
              title={`The duel: ${net} against ${human}'s lap, ${carName(vehicle)} on ${t.name}`} />
          ) : (
            <div className="panel p-10 text-center text-muted-foreground">
              {d.tnn.saved ? 'This human lap was kept without its path: there is nothing to replay.' : 'This network was not saved: there is nothing to drive.'}
            </div>
          )}
        </div>
        <p className="mt-4 max-w-3xl text-sm text-pretty text-muted-foreground">
          The network drives live, here in your browser, with the weights it was saved with. Its laps vary by a few tenths around its best.
          The see-through car is {human}&rsquo;s best lap as it was driven. It sets off each time the network crosses the line,
          so from the network&rsquo;s second lap on, both start at speed. C changes the camera, M turns the sound on or off.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
