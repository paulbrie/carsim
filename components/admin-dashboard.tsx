'use client';
// The super admin's dashboard (#357, /admin): the counts, then the people, the agents, the networks and the runs, each a
// table; one filter for all four (a name, an email, an id, a track, a car...).
import { useDeferredValue, useState } from 'react';
import { Bot, Brain, Search, User } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { DriverAvatar } from '@/components/user-menu';
import { carName, groundLabel } from '@/components/showcase';
import { ago, fmtLap } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { AgentRow, Dashboard, NetworkRow, Person, Run } from '@/lib/dashboard/store.mjs';

// (in UTC: the server draws it first, the browser again, and the two must agree)
const fmtWhen = (t: number | null) => t ? `${new Date(t).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC` : '';
const n = (x: number) => x.toLocaleString('en-US');
const WHY: Record<string, string> = { wrecked: 'wrecked', stuck: 'stuck', slow: 'too slow', gates: 'missed gates', laps: 'missed gates' };

function When({ t, now }: { t: number | null; now: number }) {
  if (!t) return <span className="text-muted-foreground">–</span>;
  return <time dateTime={new Date(t).toISOString()} title={fmtWhen(t)} className="whitespace-nowrap">{ago(t, now)}</time>;
}

function Stat({ label, value, sub, className }: { label: string; value: number; sub: string; className?: string }) {
  return (
    <div className="panel p-5">
      <p className="eyebrow text-muted-foreground">{label}</p>
      <p className={cn('num mt-2 text-3xl font-semibold', className)}>{n(value)}</p>
      <p className="mt-1 text-sm text-muted-foreground">{sub}</p>
    </div>
  );
}

function Section({ id, title, count, shown, children, tools }: { id: string; title: string; count: number; shown: number; children: React.ReactNode; tools?: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="mt-12 scroll-mt-36">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id={`${id}-h`} className="heading text-2xl">{title} <span className="num text-base font-normal text-muted-foreground">{shown === count ? n(count) : `${n(shown)} of ${n(count)}`}</span></h2>
        {tools}
      </div>
      <div className="panel mt-4 overflow-x-auto">{shown ? children : <p className="p-6 text-sm text-muted-foreground">Nothing here{count ? ' matches the filter' : ' yet'}.</p>}</div>
    </section>
  );
}

const TH = 'px-3 py-2.5 text-left font-medium whitespace-nowrap text-muted-foreground first:pl-5 last:pr-5';
const TD = 'px-3 py-2.5 align-top first:pl-5 last:pr-5';
const TR = 'border-t border-white/6 hover:bg-white/3';
function Head({ cols }: { cols: (string | [string, string])[] }) {
  return <thead><tr>{cols.map(c => typeof c === 'string' ? <th key={c} scope="col" className={TH}>{c}</th> : <th key={c[0]} scope="col" className={cn(TH, c[1])}>{c[0]}</th>)}</tr></thead>;
}

function People({ rows, now }: { rows: Person[]; now: number }) {
  return (
    <table className="w-full min-w-[960px] text-sm">
      <Head cols={['Person', 'Email', 'Joined', 'Last seen', ['Sign-ins', 'text-right'], ['Best laps', 'text-right'], ['Networks', 'text-right'], ['Agents', 'text-right'], ['Chat', 'text-right']]} />
      <tbody>
        {rows.map(p => (
          <tr key={p.id} className={TR}>
            <td className={TD}>
              <div className="flex items-center gap-2.5">
                <DriverAvatar name={p.name} image={p.image} className="size-7" />
                <div className="min-w-0">
                  <p className="max-w-56 truncate font-medium text-human" title={p.name}>{p.name}</p>
                  <p className="num max-w-56 truncate text-xs text-muted-foreground" title={p.kept ? p.id : `${p.id}: known by what they left; email and sign-ins from their next sign-in`}>{p.provider}{p.kept ? '' : ' · not signed in since'}</p>
                </div>
              </div>
            </td>
            <td className={TD}>{p.email ? <a href={`mailto:${p.email}`} className="hover:underline">{p.email}</a> : <span className="text-muted-foreground">–</span>}</td>
            <td className={TD}><When t={p.firstAt} now={now} /></td>
            <td className={TD}><When t={p.lastAt} now={now} /></td>
            <td className={cn(TD, 'num text-right')}>{p.kept ? n(p.signIns) : '–'}</td>
            <td className={cn(TD, 'num text-right')}>{n(p.laps)}</td>
            <td className={cn(TD, 'num text-right')}>{n(p.networks)}</td>
            <td className={cn(TD, 'num text-right')}>{n(p.agents)}</td>
            <td className={cn(TD, 'num text-right')}>{n(p.chat)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Agents({ rows, now }: { rows: AgentRow[]; now: number }) {
  return (
    <table className="w-full min-w-[860px] text-sm">
      <Head cols={['Agent', 'Claimed by', 'Signed up', 'Last seen', ['Networks', 'text-right'], ['Exams', 'text-right'], ['Timed', 'text-right']]} />
      <tbody>
        {rows.map(a => (
          <tr key={a.id} className={TR}>
            <td className={TD}>
              <p className="flex max-w-64 items-center gap-1.5 truncate font-medium"><Bot className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />{a.name}</p>
              <p className="num text-xs text-muted-foreground">{a.uid}</p>
            </td>
            <td className={TD}>{a.owner ? <><p className="text-human">{a.ownerName}</p><p className="text-xs text-muted-foreground"><When t={a.claimedAt} now={now} /></p></> : <span className="text-muted-foreground">nobody yet</span>}</td>
            <td className={TD}><When t={a.createdAt} now={now} /></td>
            <td className={TD}><When t={a.seenAt} now={now} /></td>
            <td className={cn(TD, 'num text-right')}>{n(a.networks)}</td>
            <td className={cn(TD, 'num text-right')}>{n(a.exams)}</td>
            <td className={cn(TD, 'num text-right')}>{n(a.timed)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Networks({ rows, now }: { rows: NetworkRow[]; now: number }) {
  return (
    <table className="w-full min-w-[1000px] text-sm">
      <Head cols={['Network', 'By', 'Car', 'Track', 'Shape', ['Generations', 'text-right'], ['Best lap', 'text-right'], 'Saved']} />
      <tbody>
        {rows.map(x => (
          <tr key={x.id} className={TR}>
            <td className={TD}>
              <p className="max-w-52 truncate font-medium text-tnn" title={x.name}>{x.name}</p>
              <p className="num text-xs text-muted-foreground">{x.id}</p>
            </td>
            <td className={TD}><span className="flex items-center gap-1.5 whitespace-nowrap">{x.agent ? <Bot className="size-3.5 text-muted-foreground" aria-label="agent" /> : <User className="size-3.5 text-muted-foreground" aria-label="person" />}{x.ownerName}</span></td>
            <td className={TD}>{carName(x.vehicle)}</td>
            <td className={TD}>
              <p className="whitespace-nowrap">{x.trackName ?? <span className="text-muted-foreground">its maker’s own</span>}{x.ground ? ` · ${groundLabel(x.ground)}` : ''}</p>
              {x.past.length > 0 && <p className="text-xs text-muted-foreground" title={x.past.map(p => `${p.track ?? 'own course'} (${groundLabel(p.ground)}, ${carName(p.vehicle)}): gen. ${p.from}–${p.to}${p.bestLap != null ? `, ${fmtLap(p.bestLap)}` : ''}`).join('\n')}>and {x.past.length} circuit{x.past.length > 1 ? 's' : ''} before</p>}
            </td>
            <td className={cn(TD, 'num whitespace-nowrap text-muted-foreground')} title={x.inputs.join(', ')}>{x.inputs.length} in · {x.h ? `${x.h} hidden` : 'no hidden'} · {n(x.weights)} w</td>
            <td className={cn(TD, 'num text-right')}>{n(x.gen)}</td>
            <td className={cn(TD, 'num text-right whitespace-nowrap')}>{x.bestLap != null ? fmtLap(x.bestLap) : '–'}{x.timed && <span className="eyebrow ml-1.5 text-[0.6rem] text-tnn" title="Timed by the server">timed</span>}</td>
            <td className={TD}><When t={x.savedAt} now={now} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const KINDS = [{ k: 'all', label: 'All' }, { k: 'exam', label: 'Exams' }, { k: 'lap', label: 'People’s laps' }, { k: 'netLap', label: 'Networks’ laps' }] as const;
function result(r: Run) {
  if (r.time != null) return <span className="num">{fmtLap(r.time)}</span>;
  if (r.error) return <span className="text-destructive" title={r.error}>{r.status ? `${r.status} · ` : ''}{r.error.length > 60 ? r.error.slice(0, 58) + '…' : r.error}</span>;
  return <span className="text-muted-foreground">no lap: {WHY[r.why ?? ''] ?? r.why ?? '?'}{r.seconds != null ? ` after ${Math.round(r.seconds)} s` : ''}</span>;
}
function Runs({ rows, now }: { rows: Run[]; now: number }) {
  return (
    <table className="w-full min-w-[1000px] text-sm">
      <Head cols={['When', 'What', 'Who', 'Network', 'Track', 'Car', 'Result', ['Took', 'text-right']]} />
      <tbody>
        {rows.map((r, i) => (
          <tr key={`${r.kind}-${r.at}-${i}`} className={TR}>
            <td className={TD}><When t={r.at} now={now} /></td>
            <td className={cn(TD, 'whitespace-nowrap')}>{r.kind === 'exam' ? <span className="inline-flex items-center gap-1.5"><Bot className="size-3.5 text-muted-foreground" aria-hidden />Exam</span>
              : r.kind === 'netLap' ? <span className="inline-flex items-center gap-1.5"><Brain className="size-3.5 text-tnn" aria-hidden />Network’s best lap</span>
              : <span className="inline-flex items-center gap-1.5"><User className="size-3.5 text-human" aria-hidden />Best lap</span>}</td>
            <td className={TD}><span className={cn('block max-w-44 truncate', r.kind === 'lap' && 'text-human')} title={r.whoId}>{r.who}</span></td>
            <td className={TD}>{r.name ? <span className="block max-w-48 truncate text-tnn" title={r.autopilot ?? undefined}>{r.name}</span> : <span className="text-muted-foreground">–</span>}</td>
            <td className={cn(TD, 'whitespace-nowrap')}>{r.trackName} · {groundLabel(r.ground)}</td>
            <td className={cn(TD, 'whitespace-nowrap')}>{carName(r.vehicle)}</td>
            <td className={TD}>{result(r)}{r.kind === 'exam' && r.time != null && !r.autopilot && <span className="ml-1.5 text-xs text-muted-foreground">not saved</span>}</td>
            <td className={cn(TD, 'num text-right text-muted-foreground')}>{r.ms != null ? `${(r.ms / 1000).toFixed(1)} s` : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const has = (q: string, ...xs: (string | null | undefined)[]) => xs.some(x => x && x.toLowerCase().includes(q));

export function AdminDashboard({ data }: { data: Dashboard }) {
  const [filter, setFilter] = useState('');
  const [kind, setKind] = useState<(typeof KINDS)[number]['k']>('all');
  const q = useDeferredValue(filter.trim().toLowerCase()), c = data.counts, now = data.at;
  const people = q ? data.people.filter(p => has(q, p.name, p.email, p.id)) : data.people;
  const agents = q ? data.agents.filter(a => has(q, a.name, a.uid, a.ownerName, a.owner)) : data.agents;
  const nets = q ? data.networks.filter(x => has(q, x.name, x.id, x.ownerName, x.owner, x.trackName, carName(x.vehicle), x.vehicle)) : data.networks;
  const runs = data.runs.filter(r => (kind === 'all' || r.kind === kind) && (!q || has(q, r.who, r.whoId, r.name, r.trackName, carName(r.vehicle), r.vehicle, r.error)));
  const ofKind = kind === 'all' ? data.runs.length : data.runs.filter(r => r.kind === kind).length;

  return (
    <>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="People" value={c.people} sub={`${n(c.peopleDay)} seen today · ${n(c.google)} with Google`} className="text-human" />
        <Stat label="Agents" value={c.agents} sub={`${n(c.claimed)} claimed · ${n(c.agentsDay)} active today`} />
        <Stat label="Networks" value={c.networks} sub={`${n(c.agentNetworks)} sent in by agents`} className="text-tnn" />
        <Stat label="Exams" value={c.exams} sub={`${n(c.examsTimed)} timed · ${n(c.examsDay)} today`} />
      </div>

      <div className="sticky top-16 z-20 -mx-4 mt-8 flex flex-wrap items-center gap-3 border-b border-white/6 bg-background/85 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6">
        <nav aria-label="Sections" className="flex flex-wrap gap-1">
          {[['people', 'People'], ['agents', 'Agents'], ['networks', 'Networks'], ['runs', 'Runs']].map(([id, label]) => (
            <a key={id} href={`#${id}`} className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground outline-none hover:bg-white/6 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">{label}</a>
          ))}
        </nav>
        <label className="relative ml-auto w-full sm:w-72">
          <span className="sr-only">Filter everything</span>
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input type="search" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Name, email, id, track, car…" className="pl-8" />
        </label>
      </div>

      <Section id="people" title="People" count={data.people.length} shown={people.length}><People rows={people} now={now} /></Section>
      <Section id="agents" title="Agents" count={data.agents.length} shown={agents.length}><Agents rows={agents} now={now} /></Section>
      <Section id="networks" title="Networks" count={data.networks.length} shown={nets.length}><Networks rows={nets} now={now} /></Section>
      <Section id="runs" title="Runs" count={ofKind} shown={runs.length} tools={
        <div role="group" aria-label="Which runs" className="flex flex-wrap gap-1">
          {KINDS.map(k => (
            <button key={k.k} type="button" aria-pressed={kind === k.k} onClick={() => setKind(k.k)}
              className={cn('rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring', kind === k.k && 'bg-white/8 text-foreground')}>{k.label}</button>
          ))}
        </div>
      }>
        <Runs rows={runs} now={now} />
      </Section>
      <p className="mt-4 text-xs text-muted-foreground">
        Runs: the last {n(300)} exams the server drove for agents’ networks (each one sent in, timed or not), and the last {n(300)} best laps set.
        A person’s or network’s best lap replaces their earlier one on the same track, ground and car, so only the best is kept.
      </p>
    </>
  );
}
