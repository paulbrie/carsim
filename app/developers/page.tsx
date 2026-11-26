import { headers } from 'next/headers';
import { Bot, Download, FileText } from 'lucide-react';
import { auth } from '@/auth';
import { SiteNav } from '@/components/site-nav';
import { SiteFooter } from '@/components/site-footer';
import { Markdown } from '@/components/markdown';
import { Button } from '@/components/ui/button';
import { devDocs } from '@/lib/dev-docs';
import { siteUrl } from '@/lib/site-url';
import { simModule } from '@/lib/sim-module/serve.mjs';

export const metadata = {
  title: 'Developers',
  description: 'The Carsim simulator as one module to download and step from your own code, and the agent bridge: an AI agent at work in your simulator page, over MCP.',
};
export const dynamic = 'force-dynamic';

// The simulator for code and for agents (#355). The text is docs/simulator.md, which /developers.md serves as it is
// (for agents): one text, so the page and the markdown can't disagree. Seen without signing in.
export default async function Developers() {
  const session = await auth();
  const user = session?.user ? { name: session.user.name ?? 'Driver', image: session.user.image ?? null, admin: session.user.admin } : null;
  const site = siteUrl(await headers()), text = devDocs(site);
  let build = '', mb = '';
  try { const m = simModule(); build = m.build; mb = (m.bytes / 1e6).toFixed(1); } catch (e) { console.error('[developers]', e); }
  const [intro, ...rest] = text.split(/\n(?=## )/);

  return (
    <div className="relative overflow-x-clip">
      <div aria-hidden className="grid-fade pointer-events-none absolute inset-0 h-[700px]" />
      <SiteNav user={user} active="developers" />
      <main className="relative mx-auto max-w-5xl px-4 pt-12 sm:px-6 sm:pt-16">
        <p className="eyebrow text-primary">Developers</p>
        <h1 className="display mt-3 text-4xl text-balance sm:text-6xl">The simulator, for your code and your agents.</h1>
        <p className="mt-4 max-w-3xl text-lg text-pretty text-muted-foreground">
          Download the game’s physics as one file and step it yourself, or let an AI agent work in your own simulator page while you watch.
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Button asChild size="lg" className="px-4 font-semibold">
            <a href={`${site}/carsim.mjs`} download="carsim.mjs"><Download /> carsim.mjs{mb && <span className="num font-normal opacity-80">{mb} MB</span>}</a>
          </Button>
          <Button asChild variant="glass" size="lg" className="px-4"><a href="#2-the-agent-bridge"><Bot /> Connect an agent</a></Button>
          <Button asChild variant="ghost" size="lg" className="px-4"><a href={`${site}/developers.md`}><FileText /> This page as markdown</a></Button>
        </div>
        {build && <p className="mt-3 text-sm text-muted-foreground">Build <span className="num">{build}</span>: the engine the site runs now.</p>}
        <dl className="mt-8 grid max-w-4xl gap-3 sm:grid-cols-2">
          {[['The module', `${site}/carsim.mjs`], ['The MCP server', `${site}/api/mcp`]].map(([k, v]) => (
            <div key={k} className="panel px-4 py-3.5">
              <dt className="text-sm text-muted-foreground">{k}</dt>
              <dd className="mt-1 font-mono text-sm break-all select-all">{v}</dd>
            </div>
          ))}
        </dl>
        <article className="mt-10">
          <Markdown text={intro} skipTitle />
          {rest.map((s, i) => <Markdown key={i} text={s} />)}
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}
