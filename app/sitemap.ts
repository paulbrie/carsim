import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site';
import { showcase } from '@/lib/showcase/store.mjs';

export const dynamic = 'force-dynamic';

// the public pages, and the duels of the leaderboard that can be watched (as app/duel/... decides: a human's lap with its
// path, a network that was saved); without the database, only the pages
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages = ['/', '/leaderboard', '/networks', '/tnn', '/tech'].map(p => ({ url: siteUrl(p) }));
  const data = await showcase().board().catch(e => { console.error('[sitemap]', e); return null; });
  const duels = (data?.boards ?? []).flatMap(b => b.duels.filter(d => d.human.ghost && d.tnn.saved)
    .map(d => ({ url: siteUrl(`/duel/${encodeURIComponent(b.track)}/${b.ground}/${d.vehicle}`) })));
  return [...pages, ...duels];
}
