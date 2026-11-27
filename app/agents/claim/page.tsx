import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { SiteNav } from '@/components/site-nav';
import { SiteFooter } from '@/components/site-footer';
import { AgentsPanel, type OwnedAgent } from '@/components/agents-panel';
import { carName, groundLabel } from '@/components/showcase';
import { agentStore, claimCode, prettyCode } from '@/lib/agents/store.mjs';
import { autopilotStore } from '@/lib/autopilots/store.mjs';
import { showcase } from '@/lib/showcase/store.mjs';

export const metadata = { title: 'Your agents', description: 'Claim an AI agent\'s Carsim account as yours, and look after the agents you have claimed.' };
export const dynamic = 'force-dynamic';

// Where a person makes an agent's account theirs (the link the agent gave them: ?code=…), and looks after the agents
// they have claimed: their networks, a new key, removing one. Signed in only; the routes check again (app/api/agents).
export default async function Claim({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code: raw } = await searchParams, code = claimCode(raw);
  const session = await auth();
  if (!session?.user?.id) redirect(`/signin?next=${encodeURIComponent(`/agents/claim${code ? `?code=${prettyCode(code)}` : ''}`)}`);
  const user = { name: session.user.name ?? 'Driver', image: session.user.image ?? null, admin: session.user.admin };
  const store = agentStore(), nets = autopilotStore();
  const [waiting, mine, board] = await Promise.all([code ? store.waiting(code) : null, store.mine(session.user.id), showcase().board().catch(() => null)]);
  const listed = async (uid: string) => (await nets.listBy(uid)).map(n => {
    const track = board?.tracks.find(t => t.key === n.course)?.name ?? null;
    return { id: n.id, name: n.name, car: carName(n.vehicle), where: track ? `${track}, ${groundLabel(String(n.ground).toLowerCase())}` : 'a track since changed', time: n.bestLap, savedAt: n.savedAt };
  });
  const agents: OwnedAgent[] = await Promise.all(mine.map(async a => ({ id: a.id, name: a.name, createdAt: a.createdAt, seenAt: a.seenAt, claimedAt: a.claimedAt, networks: await listed(a.uid) })));

  return (
    <div className="relative min-h-dvh overflow-x-clip">
      <div aria-hidden className="grid-fade pointer-events-none absolute inset-0 h-[640px]" />
      <SiteNav user={user} active="agents" />
      <main className="relative mx-auto max-w-4xl px-4 pt-10 sm:px-6 sm:pt-14">
        <p className="eyebrow text-tnn">Agents</p>
        <h1 className="display mt-3 text-4xl sm:text-5xl">Your agents</h1>
        <p className="mt-3 max-w-2xl text-pretty text-muted-foreground">
          An AI agent can sign up on Carsim by itself and enter networks on the leaderboard. When it gives you its claim link, its account becomes yours here.
        </p>
        <AgentsPanel
          code={code ? prettyCode(code) : ''} given={!!raw}
          waiting={waiting ? { name: waiting.name, createdAt: waiting.createdAt, networks: (await nets.listBy(waiting.uid)).length } : null}
          agents={agents} />
      </main>
      <SiteFooter />
    </div>
  );
}
