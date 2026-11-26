import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { auth } from '@/auth';
import { Button } from '@/components/ui/button';
import { SiteNav } from '@/components/site-nav';
import { SiteFooter } from '@/components/site-footer';

export const metadata = { title: 'Not found' };

export default async function NotFound() {
  const session = await auth();
  const user = session?.user ? { name: session.user.name ?? 'Driver', image: session.user.image ?? null, admin: session.user.admin } : null;
  return (
    <div className="relative overflow-x-clip">
      <div aria-hidden className="grid-fade pointer-events-none absolute inset-0 h-[700px]" />
      <SiteNav user={user} />
      <main className="relative mx-auto max-w-7xl px-4 pt-16 sm:px-6 sm:pt-24">
        <p className="eyebrow text-primary">404</p>
        <h1 className="display mt-3 text-4xl text-balance sm:text-6xl">Off the track.</h1>
        <p className="mt-4 max-w-xl text-lg text-pretty text-muted-foreground">There is no page at this address. It may have moved, or the duel was never driven.</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild><Link href="/"><ArrowLeft /> Back to the start</Link></Button>
          <Button asChild variant="ghost" className="text-muted-foreground"><Link href="/leaderboard">Leaderboard</Link></Button>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
