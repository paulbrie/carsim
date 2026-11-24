import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, Brain, Cpu, Dna, Eye, FlaskConical, Gauge, Mountain, Play, Repeat, Swords, Timer, Users, Wrench } from 'lucide-react';
import { auth } from '@/auth';
import { Button } from '@/components/ui/button';
import { SiteNav } from '@/components/site-nav';
import { SiteFooter } from '@/components/site-footer';
import { NetDiagram, WeightGrid } from '@/components/net-diagram';
import { TrackOutline } from '@/components/track-outline';
import { BoardCard, GapBadge, SideTag, carName, groundLabel } from '@/components/showcase';
import { withBase } from '@/lib/base-path';
import { fmtLap, fmtLength, publicName } from '@/lib/format';
import { INPUT_HINTS, netShape } from '@/lib/tnn';
import { VEHICLES } from '@/lib/race/shared.mjs';
import { showcase, type Board, type Duel, type Network, type Scoreboard, type Track } from '@/lib/showcase/store.mjs';

export const dynamic = 'force-dynamic';

// the network every training starts as (scripts/patches/autopilot.py: AI_DEFAULT_INPUTS), drawn when none is saved yet
const STARTER = { inputs: ['speed', 'line6', 'line15', 'line30', 'offset', 'yaw', 'pace'], handbrake: false, h: 0, w: null };

async function load(): Promise<Scoreboard> {
  try { return await showcase().board(); }
  catch (e) { console.error('[home] the scoreboard could not be read:', e); return { tracks: [], boards: [], networks: [], at: Date.now() }; }
}

export default async function Home({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  // links from before the home page was public: sign-in was here
  if (next || error) redirect(`/signin?${new URLSearchParams({ ...(next ? { next } : {}), ...(error ? { error } : {}) })}`);
  const [session, data] = await Promise.all([auth(), load()]);
  const user = session?.user ? { name: session.user.name ?? 'Driver', image: session.user.image ?? null, admin: session.user.admin } : null;
  const full = !!user;

  const track = (id: string) => data.tracks.find(t => t.id === id)!;
  // the closest fight on the board: the one to open with
  const fights = data.boards.flatMap(b => b.duels.map(d => ({ board: b, duel: d }))).sort((a, b) => Math.abs(a.duel.gap) - Math.abs(b.duel.gap));
  const lead = fights[0] ?? null;
  const lapped = data.networks.filter(n => n.bestLap != null && n.track);
  const star: Network | null = (lead && data.networks.find(n => n.id === lead.duel.tnn.id)) || lapped[0] || null;
  const smallest = lapped.length ? lapped.reduce((a, b) => (b.weights < a.weights ? b : a)) : null;
  const humanLaps = data.boards.reduce((n, b) => n + b.rows.filter(r => r.human).length, 0);
  const tnnWins = fights.filter(f => f.duel.gap < 0).length;
  const net = star ?? STARTER, shape = netShape(net);

  return (
    <div className="relative overflow-x-clip">
      <SiteNav user={user} active="home" />

      {/* ------------------------------------------------------------ the opening */}
      <section className="relative">
        <div aria-hidden className="grid-fade pointer-events-none absolute inset-0 h-[900px]" />
        <div aria-hidden className="pointer-events-none absolute top-[-220px] left-[-160px] size-[620px] rounded-full bg-human/14 blur-[110px]" />
        <div aria-hidden className="pointer-events-none absolute top-[-120px] right-[-200px] size-[640px] rounded-full bg-tnn/12 blur-[120px]" />
        <div className="relative mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)] items-center gap-12 px-4 pt-10 pb-16 sm:px-6 sm:pt-14 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)] lg:gap-10 lg:pt-20 lg:pb-24">
          <div className="min-w-0 space-y-7">
            <p className="rise eyebrow inline-flex max-w-full items-center gap-2 rounded-full border border-white/10 bg-white/4 px-3 py-1.5 text-[0.62rem] text-muted-foreground sm:text-[0.72rem]">
              <FlaskConical className="size-3.5 shrink-0 text-tnn" aria-hidden /> <span className="truncate">Research on tiny neural networks</span>
            </p>
            <h1 className="rise rise-1 display text-[clamp(2.7rem,7vw,5.4rem)] text-balance">
              <span className="text-human">Humans</span> <span className="text-muted-foreground/60">vs.</span><br />
              <span className="text-tnn">tiny neural</span> networks.
            </h1>
            <p className="rise rise-2 max-w-xl text-lg text-pretty text-muted-foreground sm:text-xl">
              Same cars, same physics, same tracks. You drive with your hands. They drive with a few dozen numbers,
              learned from nothing in a browser tab. Take them on, or train your own.
            </p>
            <div className="rise rise-3 flex flex-wrap items-center gap-3">
              <Button asChild size="xl" className="glow-human">
                <a href={withBase('/drive')}><Play className="fill-current" /> Drive now</a>
              </Button>
              <Button asChild size="xl" variant="tnn">
                <a href={withBase('/lab')}><Brain /> Train a network</a>
              </Button>
              <Button asChild size="xl" variant="glass">
                <Link href="/lobby"><Users /> Race others</Link>
              </Button>
            </div>
            <p className="rise rise-4 text-sm text-muted-foreground">No account needed to drive or train. Keyboard, in a desktop browser.</p>
          </div>

          <div className="rise rise-2 min-w-0">
            {lead ? <Headline board={lead.board} duel={lead.duel} track={track(lead.board.track)} net={star} full={full} />
              : <StarterCard />}
          </div>
        </div>

        {/* the numbers, as they stand */}
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6">
          <dl className="grid grid-cols-2 overflow-hidden rounded-2xl border border-white/8 bg-white/3 md:grid-cols-4">
            {[
              [smallest ? String(smallest.weights) : '16', smallest ? 'weights in the smallest network to finish a lap' : 'weights in the network a training starts with'],
              [String(data.networks.length), `${data.networks.length === 1 ? 'network' : 'networks'} trained and saved`],
              [fights.length ? `${tnnWins} / ${fights.length}` : String(humanLaps), fights.length ? 'duels the networks lead, same car and track' : 'human best laps on the board'],
              [String(VEHICLES.length), `cars on ${data.tracks.length || 1} ${data.tracks.length === 1 ? 'track' : 'tracks'}, three grounds`],
            ].map(([n, l], i) => (
              <div key={l} className={`p-5 sm:p-6 ${i ? 'border-white/8 max-md:odd:border-l md:border-l' : ''} ${i > 1 ? 'max-md:border-t' : ''}`}>
                <dt className="sr-only">{l}</dt>
                <dd className="display text-3xl sm:text-4xl">{n}</dd>
                <dd className="mt-1.5 text-sm text-pretty text-muted-foreground">{l}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ------------------------------------------------------------ three ways in */}
      <Section id="play" eyebrow="Three ways in" title="Drive. Build. Or both.">
        <div className="grid gap-5 lg:grid-cols-3">
          <Way tone="human" icon={<Gauge />} kicker="Just drive" title="Take the wheel"
            body="Pick one of fifteen cars, from a dune buggy to a 567 kW Mustang, and a ground: sand that ruts under your tyres, firm earth, or tarmac. Every gate, as fast as you can."
            points={['No account, no setup', 'Bots to race against, and replays', 'Race rooms for up to eight drivers']}>
            <Button asChild size="lg" className="px-4"><a href={withBase('/drive')}><Play className="fill-current" /> Drive now</a></Button>
          </Way>
          <Way tone="both" icon={<Swords />} kicker="Drive and build" title="Race your own creation"
            body="Set a lap, then train a network on the same track with the same car and find out which of you is quicker. Your best laps and your networks' sit side by side on the leaderboard."
            points={['One physics engine for both', 'Watch it drive your car, pedals and all', 'The gap between you, to the thousandth']}>
            <Button asChild size="lg" variant="glass" className="px-4"><Link href="/leaderboard">See the leaderboard <ArrowRight /></Link></Button>
          </Way>
          <Way tone="tnn" icon={<Brain />} kicker="Just build" title="Never touch the wheel"
            body="Choose what the network sees, how big it is and what it is punished for. Press Train and watch it go from leaving the road at the first bend to lapping, in minutes, on every core you give it."
            points={['Runs in your browser, nothing to install', 'See every weight pull, live', 'Save it, share it, load anyone’s']}>
            <Button asChild size="lg" variant="tnn" className="px-4"><a href={withBase('/lab')}><Brain /> Open the lab</a></Button>
          </Way>
        </div>
        <Shot src="/showcase/drive.webp" w={1440} h={900} alt="The drive: a red Audi RS 6 Avant on the start line seen from behind, the lap timer at the top, the minimap and the controls on the right, the speedometer at the bottom."
          caption="The drive: the lap timer, the arrow to the next gate, the minimap, and every control with its key." className="mt-5" />
      </Section>

      {/* ------------------------------------------------------------ the scoreboard */}
      {data.boards.length > 0 && (
        <Section id="scoreboard" eyebrow="The scoreboard" title="Where it stands, car by car."
          lead="Each row is one car on one track: the best lap a person has driven in a race room, and the best lap a saved network has driven in its exam. Same sim, same timing.">
          <div className="grid gap-5 lg:grid-cols-2">
            {data.boards.filter(b => b.duels.length).concat(data.boards.filter(b => !b.duels.length)).slice(0, 4)
              .map(b => <BoardCard key={`${b.track}-${b.ground}`} board={b} track={track(b.track)} full={full} limit={5} />)}
          </div>
          <div className="mt-6">
            <Button asChild variant="glass" size="lg" className="px-4"><Link href="/leaderboard">The full leaderboard <ArrowRight /></Link></Button>
          </div>
        </Section>
      )}

      {/* ------------------------------------------------------------ how a network drives */}
      <Section id="how" eyebrow="How a network drives" title={`This is the whole driver: ${shape.weights} numbers.`}
        lead="No camera, no memory, no plan. Sixty times a second it reads a handful of numbers about the car and the road ahead, multiplies them by its weights, and that is the steering and the pedal.">
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div className="panel min-w-0 p-5 sm:p-7">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="eyebrow text-tnn">{star ? 'A saved network, as it drives' : 'The network a training starts with'}</p>
                <p className="mt-1 text-sm text-muted-foreground">{star ? `${carName(star.vehicle)}${star.track ? ` · ${track(star.track).name}` : ''}${star.bestLap != null ? ` · ${fmtLap(star.bestLap)}` : ''}` : 'Seven inputs straight to two outputs'}</p>
              </div>
              <p className="num text-xs text-muted-foreground"><span style={{ color: '#ff8a3d' }}>━</span> pulls left / gas <span className="ml-2" style={{ color: '#4aa8ff' }}>━</span> pulls right / brake</p>
            </div>
            <NetDiagram net={net} pulse />
            {star?.w && (
              <div className="mt-5 border-t border-white/6 pt-4">
                <p className="eyebrow mb-2 text-muted-foreground/80">Every weight it has</p>
                <WeightGrid w={star.w} />
              </div>
            )}
          </div>
          <ol className="space-y-5">
            <Step n="1" icon={<Eye />} title="What it sees">
              <p>{shape.inputs.length} numbers, such as its speed, where the racing line is a few metres ahead, and how fast it is turning.</p>
              <ul className="mt-3 grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
                {shape.inputs.slice(0, 8).map(n => <li key={n} className="flex gap-2"><span className="num shrink-0 text-foreground">{n}</span><span className="truncate text-muted-foreground/80">{INPUT_HINTS[n] ?? ''}</span></li>)}
              </ul>
            </Step>
            <Step n="2" icon={<Gauge />} title="What it does">
              <p>{shape.outputs.length === 3 ? 'Three' : 'Two'} outputs: the steering, one pedal that is gas above zero and brake below{shape.outputs.length === 3 ? ', and the handbrake' : ''}. Each is a weighted sum of the inputs, squashed between −1 and 1.</p>
            </Step>
            <Step n="3" icon={<Dna />} title="How it learns">
              <p>Evolution, not backpropagation. Each generation, sixteen noisy copies of the weights drive for fifteen seconds on the real physics; the weights then move toward the copies that got further. An exam lap from the start line decides whether the new driver is the best so far.</p>
            </Step>
            <Step n="4" icon={<Cpu />} title="Where it learns">
              <p>In your browser. The sim runs without drawing, far faster than real time, and in a Web Worker on each core you allow. A dune buggy on sand first completes a lap after about a dozen generations.</p>
            </Step>
          </ol>
        </div>
        <Shot src="/showcase/lab.webp" w={1440} h={900} alt="The TNN lab, full screen: the network drawn with its inputs and outputs, the training's charts, and the settings for what it sees."
          caption="The lab, in the sim: the network live, its exam scores and lap times generation by generation, and every input you can give it." className="mt-5" />
      </Section>

      {/* ------------------------------------------------------------ the simulator */}
      <Section id="sim" eyebrow="One simulator for both" title="The same car, whoever drives it."
        lead="A network gets no shortcuts: it turns the same wheel and presses the same pedals, through the same tyres, as you do. The same weights always drive the same lap.">
        <div className="mb-5 grid gap-5 lg:grid-cols-2">
          <Shot src="/showcase/road.webp" w={1440} h={780} alt="A red Audi RS 6 Avant on the tarmac of the figure-8 track, a bridge and two checkpoint gates behind it." caption="Tarmac: an Audi RS 6 Avant on the figure-8, the bridge behind." />
          <Shot src="/showcase/sand.webp" w={1440} h={780} alt="A dune buggy on rippled sand, dust behind its rear wheels." caption="Sand: the dune buggy, digging in." />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            [<Mountain key="i" />, 'Ground that gives way', 'Tyres sink into sand, dig ruts and throw roost; earth is firm; tarmac grips. The ruts a lap leaves are there on the next one.'],
            [<Wrench key="i" />, 'Cars with their real numbers', 'Fifteen cars with their engines’ torque curves, gearboxes, weight and drivetrains, and synthesised engine sounds from a flat-four to a supercharged V8.'],
            [<Gauge key="i" />, 'Suspension and drivetrain', 'Sprung wheels on uneven ground, rear or all-wheel drive with a front-to-rear split you can move, traction control and ABS you can switch off.'],
            [<Repeat key="i" />, 'Damage that stays', 'Hit a gate post and the body crumples, glass cracks and breaks, parts come off, and the car drives worse for it.'],
            [<Timer key="i" />, 'Laps to the thousandth', 'Every gate in order or the lap does not count. Checkpoint splits, replays, and in race rooms a ghost car of the best lap.'],
            [<Users key="i" />, 'Tracks you can make', 'A course editor with banking, bridges and grading, a circuit generator, and weather from clear sky to rain.'],
          ].map(([icon, t, b]) => (
            <div key={t as string} className="rounded-2xl border border-white/8 bg-white/3 p-5">
              <div className="mb-3 flex size-9 items-center justify-center rounded-lg bg-white/6 text-foreground [&_svg]:size-4.5">{icon}</div>
              <h3 className="font-semibold">{t}</h3>
              <p className="mt-1.5 text-sm text-pretty text-muted-foreground">{b}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ------------------------------------------------------------ what the work found */}
      <Section id="findings" eyebrow="Notes from the lab" title="What the networks taught us so far.">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[
            ['Small is enough', 'Seven inputs wired straight to two outputs, sixteen weights and no hidden layer, learn to lap the figure-8. A hidden layer can learn more but takes longer to tune.'],
            ['A pace note changes everything', 'Without an input saying how fast the road ahead can be taken, no network got past the first sharp bend. With it, a first lap came within a dozen generations.'],
            ['Analogue beats on/off', 'Given a pedal that is only full gas, nothing or full brake, as a keyboard gives a person, a network was still stuck at the first hard bend after eighty generations.'],
            ['One fast lap is not a driver', 'A network judged on a single lap can be quick and then lose the car on the next. Timing several flying laps in a row, the slowest counting, produced drivers that hold their pace.'],
            ['Where you start matters', 'Networks whose tries always began at the start line never got past the first sharp bend. Starting from random places on the track, and often just before the last mistake, fixed it.'],
            ['Same weights, same lap', 'Exams start from a car as new on ground as built, so a network’s lap time is a property of its weights, repeatable to the thousandth, and comparable with yours.'],
          ].map(([t, b], i) => (
            <article key={t} className="panel p-6">
              <p className="num text-xs text-muted-foreground/70">{String(i + 1).padStart(2, '0')}</p>
              <h3 className="heading mt-2 text-lg">{t}</h3>
              <p className="mt-2 text-sm text-pretty text-muted-foreground">{b}</p>
            </article>
          ))}
        </div>
      </Section>

      {/* ------------------------------------------------------------ your turn */}
      <section className="relative mx-auto mt-24 max-w-7xl px-4 sm:px-6">
        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-card px-6 py-14 text-center sm:px-12 sm:py-20">
          <div aria-hidden className="pointer-events-none absolute -bottom-40 left-1/4 size-96 -translate-x-1/2 rounded-full bg-human/20 blur-[100px]" />
          <div aria-hidden className="pointer-events-none absolute -top-40 right-1/4 size-96 translate-x-1/2 rounded-full bg-tnn/18 blur-[100px]" />
          <h2 className="display relative mx-auto max-w-3xl text-4xl text-balance sm:text-6xl">Your turn.</h2>
          <p className="relative mx-auto mt-4 max-w-xl text-lg text-pretty text-muted-foreground">
            {lead ? <>The lap to beat on {track(lead.board.track).name} is <span className="num text-foreground">{fmtLap(Math.min(lead.duel.human.time, lead.duel.tnn.time))}</span>, set by a {lead.duel.gap < 0 ? `network of ${lead.duel.tnn.weights} weights` : 'person'}.</> : 'Set the first lap, or train the first network.'}
          </p>
          <div className="relative mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild size="xl" className="glow-human"><a href={withBase('/drive')}><Play className="fill-current" /> Drive now</a></Button>
            <Button asChild size="xl" variant="tnn"><a href={withBase('/lab')}><Brain /> Train a network</a></Button>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}

/** The opening card: the closest duel on the board, on its track, and the network that drove it. */
function Headline({ board, duel, track, net, full }: { board: Board; duel: Duel; track: Track; net: Network | null; full: boolean }) {
  const tnnAhead = duel.gap < 0;
  return (
    <div className="panel relative overflow-hidden p-5 sm:p-7">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow text-muted-foreground">The closest duel right now</p>
          <h2 className="heading mt-1.5 text-2xl">{track.name}</h2>
          <p className="num mt-1 text-xs text-muted-foreground">{carName(duel.vehicle)} · {groundLabel(board.ground)} · {fmtLength(track.length)}</p>
        </div>
        <TrackOutline wp={track.wp} width={150} height={96} stroke={3} animate className="h-16 w-[100px] shrink-0 text-foreground sm:h-24 sm:w-[150px]" label={`The ${track.name} track`} />
      </div>

      <div className="mt-6 space-y-2.5">
        <Lap side="human" win={!tnnAhead} who={publicName(duel.human.name, full)} time={duel.human.time} />
        <Lap side="tnn" win={tnnAhead} who={`${duel.tnn.weights} weights${duel.tnn.h ? `, hidden layer of ${duel.tnn.h}` : ', no hidden layer'}`} time={duel.tnn.time} />
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <GapBadge gap={duel.gap} />
        <a href={withBase('/drive')} className="text-sm font-medium text-muted-foreground hover:text-foreground">Think you can beat both? →</a>
      </div>

      {net && (
        <div className="mt-6 grid items-center gap-4 border-t border-white/6 pt-5 sm:grid-cols-[150px_1fr]">
          <NetDiagram net={net} labels={false} pulse className="mx-auto max-w-[150px]" />
          <div>
            <p className="eyebrow mb-2 text-tnn">The entire network</p>
            {net.w && <WeightGrid w={net.w} max={45} />}
            <p className="mt-2.5 text-xs text-muted-foreground">Trained for {net.gen.toLocaleString('en-US')} generations in a browser tab.</p>
          </div>
        </div>
      )}
    </div>
  );
}

function Lap({ side, win, who, time }: { side: 'human' | 'tnn'; win: boolean; who: string; time: number }) {
  return (
    <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${win ? (side === 'human' ? 'border-human/40 bg-human/8' : 'border-tnn/40 bg-tnn/8') : 'border-white/8 bg-white/3'}`}>
      <SideTag side={side} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{who}</span>
      <span className={`num shrink-0 text-xl font-semibold sm:text-3xl ${win ? (side === 'human' ? 'text-human' : 'text-tnn') : 'text-foreground/80'}`}>{fmtLap(time)}</span>
    </div>
  );
}

function StarterCard() {
  return (
    <div className="panel p-5 sm:p-7">
      <p className="eyebrow text-tnn">The network a training starts with</p>
      <h2 className="heading mt-1.5 text-2xl">Seven inputs, two outputs, sixteen weights.</h2>
      <NetDiagram net={STARTER} className="mt-4" />
      <p className="mt-4 text-sm text-muted-foreground">No lap is on the board yet. Set the first one, or train the first network.</p>
    </div>
  );
}

/** A picture of the sim, framed. */
function Shot({ src, w, h, alt, caption, className }: { src: string; w: number; h: number; alt: string; caption: string; className?: string }) {
  return (
    <figure className={`overflow-hidden rounded-2xl border border-white/10 bg-card ${className ?? ''}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={withBase(src)} width={w} height={h} alt={alt} loading="lazy" decoding="async" className="block h-auto w-full" />
      <figcaption className="border-t border-white/8 px-4 py-2.5 text-sm text-muted-foreground">{caption}</figcaption>
    </figure>
  );
}

function Section({ id, eyebrow, title, lead, children }: { id: string; eyebrow: string; title: string; lead?: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mx-auto mt-24 max-w-7xl px-4 sm:mt-32 sm:px-6">
      <p className="eyebrow text-primary">{eyebrow}</p>
      <h2 id={`${id}-title`} className="display mt-3 max-w-4xl text-3xl text-balance sm:text-5xl">{title}</h2>
      {lead && <p className="mt-4 max-w-3xl text-lg text-pretty text-muted-foreground">{lead}</p>}
      <div className="mt-10">{children}</div>
    </section>
  );
}

function Way({ tone, icon, kicker, title, body, points, children }: { tone: 'human' | 'tnn' | 'both'; icon: React.ReactNode; kicker: string; title: string; body: string; points: string[]; children: React.ReactNode }) {
  const bar = tone === 'human' ? 'bg-human' : tone === 'tnn' ? 'bg-tnn' : 'bg-linear-to-r from-human to-tnn';
  const ink = tone === 'human' ? 'text-human' : tone === 'tnn' ? 'text-tnn' : 'text-foreground';
  return (
    <article className="panel group relative flex flex-col overflow-hidden p-6 sm:p-7">
      <div aria-hidden className={`absolute inset-x-0 top-0 h-1 ${bar}`} />
      <div className={`mb-5 flex size-11 items-center justify-center rounded-xl bg-white/6 ${ink} [&_svg]:size-5`}>{icon}</div>
      <p className={`eyebrow ${ink}`}>{kicker}</p>
      <h3 className="heading mt-2 text-2xl">{title}</h3>
      <p className="mt-3 text-pretty text-muted-foreground">{body}</p>
      <ul className="mt-5 mb-7 space-y-2 text-sm">
        {points.map(p => <li key={p} className="flex gap-2.5"><span aria-hidden className={`mt-2 size-1.5 shrink-0 rounded-full ${bar}`} />{p}</li>)}
      </ul>
      <div className="mt-auto">{children}</div>
    </article>
  );
}

function Step({ n, icon, title, children }: { n: string; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4 rounded-2xl border border-white/8 bg-white/3 p-5">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-tnn/12 text-tnn [&_svg]:size-4.5" aria-hidden>{icon}</div>
      <div className="min-w-0 text-pretty text-muted-foreground">
        <h3 className="mb-1 font-semibold text-foreground"><span className="num mr-2 text-muted-foreground/60">{n}</span>{title}</h3>
        {children}
      </div>
    </li>
  );
}
