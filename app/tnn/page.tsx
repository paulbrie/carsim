import Link from 'next/link';
import { ArrowRight, Brain, Cpu, Eye, Gauge, Lightbulb, Play, Repeat, ShieldCheck, Sparkles, TriangleAlert, Zap } from 'lucide-react';
import { auth } from '@/auth';
import { Button } from '@/components/ui/button';
import { SiteNav } from '@/components/site-nav';
import { SiteFooter } from '@/components/site-footer';
import { NetDiagram, WeightGrid } from '@/components/net-diagram';
import { EvolutionDemo, NeuronPlayground } from '@/components/tnn-explainer';
import { carName, groundLabel } from '@/components/showcase';
import { withBase } from '@/lib/base-path';
import { fmtGap, fmtLap, publicName } from '@/lib/format';
import { INPUT_HINTS, netShape } from '@/lib/tnn';
import { showcase, type Network, type Scoreboard } from '@/lib/showcase/store.mjs';

export const metadata = {
  title: 'What is a tiny neural network?',
  description: 'A tiny neural network is an artificial brain of a few dozen numbers. Here is how one learns to drive a car round a track, explained without the scary maths.',
};
export const dynamic = 'force-dynamic';

// the network every training starts as (scripts/patches/autopilot.py: AI_DEFAULT_INPUTS), and one with a hidden layer of 8
const STARTER = { inputs: ['speed', 'line6', 'line15', 'line30', 'offset', 'yaw', 'pace'], handbrake: false, h: 0, w: null };
const HIDDEN8 = { ...STARTER, h: 8 };

// Measured on 24 Nov 2026 (#334), on the project's server while it was busy with other work: a home computer is
// likely faster. A decision: aiNet in Node, millions of calls. Training: aiTrainSync in headless Chrome, one core,
// the dune buggy on the sim's first track (771 m of road through the countryside).
const PERF = {
  decision: [['16 weights (the starter)', '0.13'], ['82 weights (a hidden layer of 8)', '0.44'], ['642 weights (a hidden layer of 64, the lab’s biggest)', '3.4']],
  realTime: '220 to 340',            // times faster than real time, training on one core
  perGen: 'about a second',          // 16 tries of 15 s and an exam: some 270 s of driving
  decisionsPerGen: '16,000',
  firstLap16: { gen: 10, seconds: 5, simMin: 23 },
  firstLap82: { gen: 58, seconds: 41 },
};

// how many weights (parameters) some well-known networks have, to put ours next to
const SIZES: { name: string; note: string; n: number; ours?: boolean }[] = [
  { name: 'The smallest Carsim driver that laps', note: '5 inputs, 2 outputs', n: 12, ours: true },
  { name: 'A Carsim driver as training starts it', note: '7 inputs, 2 outputs', n: 16, ours: true },
  { name: 'The biggest the Carsim lab can train', note: 'a hidden layer of 64', n: 642, ours: true },
  { name: 'LeNet-5, reads handwritten digits', note: '1998', n: 60_000 },
  { name: 'ResNet-50, tells what is in a photo', note: '2015', n: 25_600_000 },
  { name: 'GPT-3, writes text', note: '2020', n: 175_000_000_000 },
];
const words = (n: number) => n >= 1e9 ? `${n / 1e9} billion` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} million` : n.toLocaleString('en-US');

async function load(): Promise<Scoreboard | null> {
  try { return await showcase().board(); } catch (e) { console.error('[tnn] the scoreboard could not be read:', e); return null; }
}

export default async function TinyNeuralNetworks() {
  const [session, data] = await Promise.all([auth(), load()]);
  const user = session?.user ? { name: session.user.name ?? 'Driver', image: session.user.image ?? null, admin: session.user.admin } : null;
  const full = !!user;
  const starter = netShape(STARTER), hidden = netShape(HIDDEN8);

  // a real driver to look at: the smallest saved network that laps without a hidden layer (its weights read as a table)
  const lapped = (data?.networks ?? []).filter(n => n.bestLap != null && n.w && n.w.length === n.weights);
  const flat = lapped.filter(n => !n.h);
  const real: Network | null = (flat.length ? flat : lapped).reduce<Network | null>((a, b) => (!a || b.weights < a.weights ? b : a), null);
  const trackName = (id: string | null) => data?.tracks.find(t => t.id === id)?.name ?? null;
  const duels = (data?.boards ?? []).flatMap(b => b.duels.map(d => ({ b, d })));
  const netWins = duels.filter(x => x.d.gap < 0).length;
  const closest = [...duels].sort((p, q) => Math.abs(p.d.gap) - Math.abs(q.d.gap))[0] ?? null;

  return (
    <div className="relative overflow-x-clip">
      <div aria-hidden className="grid-fade pointer-events-none absolute inset-0 h-[700px]" />
      <SiteNav user={user} active="tnn" />
      <main className="relative">
        {/* ------------------------------------------------------------ the opening */}
        <header className="mx-auto max-w-7xl px-4 pt-12 sm:px-6 sm:pt-16">
          <p className="eyebrow text-tnn">Explained</p>
          <h1 className="display mt-3 max-w-4xl text-4xl text-balance sm:text-6xl">What is a <span className="text-tnn">tiny neural network</span>?</h1>
          <p className="mt-5 max-w-3xl text-lg text-pretty text-muted-foreground">
            A tiny neural network, or TNN, is a very small artificial brain. It is nothing more than a short list of numbers and a rule for
            using them. On Carsim, a network of just {starter.weights} numbers learns to drive a car round a track by itself, with nobody
            showing it how. This page explains how it works and how it learns. If you can multiply and add, you can follow all of it.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button asChild size="lg" variant="tnn" className="px-4"><a href={withBase('/lab')}><Brain /> Train one now</a></Button>
            <Button asChild size="lg" variant="glass" className="px-4"><a href="#neuron">Start reading <ArrowRight /></a></Button>
          </div>
          <dl className="mt-12 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/8 bg-white/8 lg:grid-cols-4">
            {[
              [String(starter.weights), 'numbers: the whole driver as a training starts it'],
              ['60', 'decisions a second, each one a steering angle and a pedal'],
              [`${PERF.decision[0][1]} µs`, 'to make one decision: nearly eight million fit in a second'],
              ['0', 'things to install: it learns in your browser, on your computer'],
            ].map(([v, l]) => (
              <div key={l} className="bg-background/90 p-5">
                <dt className="sr-only">{l}</dt>
                <dd className="num text-3xl font-semibold text-tnn sm:text-4xl">{v}</dd>
                <dd className="mt-1.5 text-sm text-pretty text-muted-foreground">{l}</dd>
              </div>
            ))}
          </dl>
        </header>

        {/* ------------------------------------------------------------ one neuron */}
        <Section id="neuron" eyebrow="Step 1" title="Start with one neuron."
          lead="The building block of every neural network, tiny or huge, is the neuron. It is a very simple machine: numbers go in, one number comes out.">
          <div className="mb-8 grid gap-5 lg:grid-cols-3">
            <Card icon={<Lightbulb />} title="An everyday example">
              Say you are deciding whether to go out tonight. Your friends are going (a big yes), you have homework (a no), and it is raining
              (a small no). You give each reason more or less importance, add it all up, and decide. A neuron does exactly that, with numbers.
            </Card>
            <Card icon={<Sparkles />} title="Weights: how much each input matters">
              Each input is multiplied by its own number, its <b className="text-foreground">weight</b>. A big weight means “this matters a lot”.
              A negative weight means “this pushes the other way”. A weight near zero means “ignore this”. Then everything is added up, plus
              one extra number of its own, the <b className="text-foreground">bias</b>.
            </Card>
            <Card icon={<Gauge />} title="The squash">
              The total can be any size, but a pedal only goes from fully off to fully down. So the total goes through a curve called
              <span className="num text-foreground"> tanh</span>, which squashes any number into the range from −1 to +1. For the pedal, −1 is
              full brake and +1 is full gas.
            </Card>
          </div>
          <NeuronPlayground />
          <p className="mt-4 max-w-3xl text-sm text-pretty text-muted-foreground">
            Try it: give the pace a negative value, as when a sharp bend is coming. The neuron brakes. Turn the weight on pace ahead down to
            zero and it stops caring about bends at all, which is how an untrained driver flies off the road. A network’s weights are its
            knowledge. Training is just finding good values for them.
          </p>
        </Section>

        {/* ------------------------------------------------------------ the network */}
        <Section id="network" eyebrow="Step 2" title="Put a few neurons together and you have a network."
          lead="One neuron for the steering and one for the pedal, both reading the same inputs: that is the whole driver a training starts with. Each line in the drawing is one weight.">
          <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-2">
            <div className="panel min-w-0 p-5 sm:p-7">
              <p className="eyebrow text-tnn">The starter: no hidden layer</p>
              <h3 className="heading mt-1.5 text-xl">{starter.inputs.length} inputs × {starter.outputs.length} outputs + {starter.outputs.length} biases = {starter.weights} weights</h3>
              <NetDiagram net={STARTER} className="mt-4" />
              <p className="mt-4 text-sm text-pretty text-muted-foreground">Every input is wired straight to both outputs. It is about as simple as a network gets, and it can still learn to lap.</p>
            </div>
            <div className="panel min-w-0 p-5 sm:p-7">
              <p className="eyebrow text-tnn">Bigger: a hidden layer of 8</p>
              <h3 className="heading mt-1.5 text-xl">{hidden.weights} weights</h3>
              <NetDiagram net={HIDDEN8} className="mt-4" />
              <p className="mt-4 text-sm text-pretty text-muted-foreground">
                The dots in the middle are neurons too. Each one adds up the inputs its own way and passes the result on. Neurons in a hidden
                layer can learn ideas that no single input says, such as “fast, <i>and</i> a bend coming”. The lab offers up to 64 of them.
              </p>
            </div>
          </div>
          <div className="panel mt-5 p-5 sm:p-7">
            <p className="eyebrow text-tnn">What it sees: the {starter.inputs.length} inputs</p>
            <p className="mt-2 max-w-3xl text-sm text-pretty text-muted-foreground">
              It has no eyes. It doesn’t see the screen you see. Instead the sim hands it a few numbers about the car and the road, 60 times a
              second. In the lab you can choose others, such as feelers that measure how far the road goes, or how much the wheels are sliding.
            </p>
            <ul className="mt-4 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
              {starter.inputs.map(n => (
                <li key={n} className="flex gap-3 text-sm"><Eye className="mt-0.5 size-4 shrink-0 text-tnn" aria-hidden /><span><span className="num text-foreground">{n}</span><span className="text-muted-foreground">: {INPUT_HINTS[n]}</span></span></li>
              ))}
            </ul>
          </div>
        </Section>

        {/* ------------------------------------------------------------ driving */}
        <Section id="driving" eyebrow="Step 3" title="How it drives a lap."
          lead="Sixty times a second, the same four steps. There is no plan and no memory of the last bend: just the numbers right now, and the weights.">
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              [<Eye key="i" />, 'Look', 'The sim measures the inputs: speed, where the racing line goes, how fast it turns, how fast this part of the track can be taken.'],
              [<Brain key="i" />, 'Think', `Multiply each input by its weights, add them up, squash. With ${starter.weights} weights, that is a few dozen sums.`],
              [<Gauge key="i" />, 'Act', 'The two outputs become the steering wheel and the pedal: above zero is gas, below is brake.'],
              [<Repeat key="i" />, 'Move', 'The physics moves the car, the same physics that moves yours, tyres, grip and all. Then back to Look.'],
            ].map(([icon, t, b], i) => (
              <li key={t as string} className="panel p-5">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-tnn/12 text-tnn [&_svg]:size-4.5" aria-hidden>{icon}</div>
                  <p className="num text-xs text-muted-foreground/70">{String(i + 1).padStart(2, '0')}</p>
                </div>
                <h3 className="heading mt-3 text-lg">{t}</h3>
                <p className="mt-1.5 text-sm text-pretty text-muted-foreground">{b}</p>
              </li>
            ))}
          </ol>
          {real && <RealDriver net={real} track={trackName(real.track)} full={full} />}
        </Section>

        {/* ------------------------------------------------------------ learning */}
        <Section id="learning" eyebrow="Step 4" title="How it learns: evolution, not a teacher."
          lead="Nobody tells the network how to drive, and it never watches a person do it. It learns the way living things evolve: try small changes, keep what works.">
          <div className="mb-8 grid gap-5 lg:grid-cols-3">
            <Card icon={<Sparkles />} title="It starts knowing nothing">
              The first weights are random and close to zero, with a little gas so the car moves at all. This first driver rolls forward
              and leaves the road at the first bend.
            </Card>
            <Card icon={<Repeat />} title="Then, a generation at a time">
              Make 16 copies of the driver, each with its weights nudged at random. Each copy drives for 15 seconds from the same spot. The
              score is the metres it covers along the track, with points taken off for leaving the road, damaging the car or crashing. Then the
              weights move toward the nudges that scored best.
            </Card>
            <Card icon={<ShieldCheck />} title="And an exam">
              After each generation the new driver takes an exam: a lap from the start line. If it is the best exam so far, these are the
              weights that are kept. They drive when you press Drive it, and they go on the leaderboard.
            </Card>
          </div>
          <EvolutionDemo />
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <div className="panel p-5 sm:p-6">
              <h3 className="heading text-lg">Why not learn the way big AIs do?</h3>
              <p className="mt-2 text-sm text-pretty text-muted-foreground">
                Big networks learn by <b className="text-foreground">backpropagation</b>: they compare their answer with the right one and work out,
                with calculus, which way to turn each weight. That needs two things we don’t have: a right answer for every moment (nobody
                knows the perfect steering angle at every point of a lap), and maths that runs back through everything that happens to the car.
                Tyres, bumps and crashes don’t work backwards like that. Evolution only needs a score, so it works with any simulator.
              </p>
            </div>
            <div className="panel p-5 sm:p-6">
              <h3 className="heading text-lg">Why does tiny make this possible?</h3>
              <p className="mt-2 text-sm text-pretty text-muted-foreground">
                Trial and error is slow when there are many weights to get right: the more there are, the more random nudges it takes to find a
                good direction. With 16 weights, a few hundred tries are enough. With the billions of a chatbot, trial and error would never
                get anywhere. That is a trade-off you can see in the lab: a bigger network can learn more, but it takes longer to train.
              </p>
            </div>
          </div>
        </Section>

        {/* ------------------------------------------------------------ tiny vs huge */}
        <Section id="sizes" eyebrow="Tiny vs huge" title="How tiny is tiny?"
          lead="A network’s size is how many weights it has. Here is ours next to some famous ones. Each step on the scale is ten times bigger than the one before, or the chatbot’s bar would be billions of times longer than ours.">
          <SizeChart />
          <p className="mt-3 max-w-3xl text-xs text-pretty text-muted-foreground">
            For comparison, a human brain has about 86 billion neurons with something like 100 trillion connections between them. A Carsim
            driver has 2 neurons. It is not clever. It is good at one job.
          </p>
        </Section>

        {/* ------------------------------------------------------------ good and bad */}
        <Section id="benefits" eyebrow="The good and the bad" title="What tiny is good at, and what it can’t do.">
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="panel p-5 sm:p-7">
              <p className="eyebrow text-tnn">Good at</p>
              <ul className="mt-4 space-y-4">
                <Point icon={<Zap />} title="Fast">One decision takes about a tenth of a millionth of a second. Thinking is never what holds it back.</Point>
                <Point icon={<Cpu />} title="Cheap">No graphics card, no data centre, no electricity bill. It trains on the computer you are reading this on.</Point>
                <Point icon={<Eye />} title="You can see all of it">Every weight is on the screen. If the weight from “pace ahead” to the pedal is big and positive, you know it speeds up when the road allows. You can’t do that with billions.</Point>
                <Point icon={<ShieldCheck />} title="Fair and repeatable">It drives the same car as you, through the same physics. Its exam starts with a car as new on fresh ground, so the same weights always drive exactly the same lap.</Point>
                <Point icon={<Repeat />} title="Small enough to share">A whole driver is a few dozen numbers: it would fit in a text message. Save it, share it, load someone else’s.</Point>
              </ul>
            </div>
            <div className="panel p-5 sm:p-7">
              <p className="eyebrow text-muted-foreground">Can’t do</p>
              <ul className="mt-4 space-y-4">
                <Point icon={<TriangleAlert />} tone="plain" title="Only knows what it’s told">It only gets the inputs you give it. Without a pace note telling it how fast the road ahead can be taken, no network we tried got past the first sharp bend.</Point>
                <Point icon={<TriangleAlert />} tone="plain" title="No memory, no plan">It reacts to now. It doesn’t remember the last lap or plan an overtake. Everything it does comes from the last few numbers it was given.</Point>
                <Point icon={<TriangleAlert />} tone="plain" title="One trick">A driver trained on one track and one car may struggle with another. It can’t read, talk or recognise a cat. It does one thing.</Point>
                <Point icon={<TriangleAlert />} tone="plain" title="Luck plays a part">The nudges are random, so two trainings of the same network can end differently, and one can get stuck on a “good enough” driver that is not the best.</Point>
              </ul>
            </div>
          </div>
        </Section>

        {/* ------------------------------------------------------------ performance */}
        <Section id="performance" eyebrow="Performance" title="How fast is it? We timed it."
          lead="These numbers are measured, not guessed. We ran the sim’s own code on our server while it was busy with other work, so your computer may well be faster.">
          <div className="grid gap-5 lg:grid-cols-3">
            <div className="panel p-5 sm:p-6">
              <p className="eyebrow text-tnn">One decision</p>
              <table className="mt-3 w-full text-sm">
                <caption className="sr-only">Time for one decision, by network size</caption>
                <tbody>
                  {PERF.decision.map(([k, v]) => (
                    <tr key={k} className="border-b border-white/6 last:border-0">
                      <th scope="row" className="py-2 pr-3 text-left font-normal text-muted-foreground">{k}</th>
                      <td className="num py-2 text-right whitespace-nowrap text-foreground">{v} µs</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-pretty text-muted-foreground">A µs is a millionth of a second. A blink takes about 100,000 µs.</p>
            </div>
            <div className="panel p-5 sm:p-6">
              <p className="eyebrow text-tnn">Training</p>
              <p className="num mt-3 text-3xl font-semibold">{PERF.realTime}×</p>
              <p className="mt-1 text-sm text-pretty text-muted-foreground">
                faster than real time, on a single processor core. The sim drives without drawing anything, so a 15-second try takes a few hundredths
                of a second. A whole generation (16 tries and an exam, some {PERF.decisionsPerGen} decisions) takes {PERF.perGen}. The lab can use several cores at once.
              </p>
            </div>
            <div className="panel p-5 sm:p-6">
              <p className="eyebrow text-tnn">Where the time goes</p>
              <p className="num mt-3 text-3xl font-semibold">&lt; 1 %</p>
              <p className="mt-1 text-sm text-pretty text-muted-foreground">
                of training is the network thinking. The rest is the physics: every tyre on every bump, 240 times a simulated second. The network
                is so small it is almost free. The world it drives in is what costs.
              </p>
            </div>
          </div>
          <div className="panel mt-5 p-5 sm:p-6">
            <h3 className="heading text-lg">From nothing to a lap</h3>
            <p className="mt-2 max-w-4xl text-sm text-pretty text-muted-foreground">
              We trained the dune buggy on the sim’s first track (771 m of road through the countryside), starting from nothing, on one core. With
              the starter’s {starter.weights} weights, the first full lap came at generation {PERF.firstLap16.gen}: {PERF.firstLap16.seconds} seconds of
              real time, or about {PERF.firstLap16.simMin} minutes of driving for the network. A second try of exactly the same thing still hadn’t
              lapped after 60 generations: that’s the luck. With a hidden layer of 8 ({hidden.weights} weights), the first lap came at generation{' '}
              {PERF.firstLap82.gen}, after {PERF.firstLap82.seconds} seconds. After that, training goes on shaving tenths off the lap for as long as you let it.
            </p>
          </div>
          {duels.length > 0 && (
            <div className="panel mt-5 flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
              <div className="max-w-3xl">
                <h3 className="heading text-lg">And against people?</h3>
                <p className="mt-2 text-sm text-pretty text-muted-foreground">
                  On the leaderboard, where a person and a network have both lapped the same track in the same car, the networks are ahead in{' '}
                  <span className="num text-tnn">{netWins}</span> of <span className="num text-foreground">{duels.length}</span>.
                  {closest && <> The closest fight: {carName(closest.d.vehicle)} on {trackName(closest.b.track) ?? 'a track'}, {groundLabel(closest.b.ground)},{' '}
                    {publicName(closest.d.human.name, full)} at <span className="num text-human">{fmtLap(closest.d.human.time)}</span> against a network of{' '}
                    {closest.d.tnn.weights} weights at <span className="num text-tnn">{fmtLap(closest.d.tnn.time)}</span> ({fmtGap(closest.d.gap)} for the network).</>}
                </p>
              </div>
              <Button asChild variant="glass" size="lg" className="px-4"><Link href="/leaderboard">The leaderboard <ArrowRight /></Link></Button>
            </div>
          )}
        </Section>

        {/* ------------------------------------------------------------ words */}
        <Section id="words" eyebrow="Words to know" title="A pocket dictionary.">
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ['Neural network', 'A program built out of many small “neurons” that each add up weighted numbers. Loosely inspired by brain cells.'],
              ['Neuron', 'One unit: multiply each input by a weight, add them up with a bias, squash the result.'],
              ['Weight', 'A number that says how much an input matters, and which way it pushes. Training changes the weights, and nothing else.'],
              ['Bias', 'A neuron’s own extra number, added whatever the inputs. Like a habit: “a little gas, unless told otherwise”.'],
              ['Input / output', 'What goes in (speed, where the road goes) and what comes out (steering, pedal).'],
              ['Hidden layer', 'Neurons between the inputs and the outputs, which combine inputs into ideas of their own.'],
              ['tanh', 'The squashing curve: any number in, a number between −1 and +1 out.'],
              ['Generation', 'One round of training: 16 nudged copies drive, are scored, and the weights move toward the better ones.'],
              ['Evolution strategies', 'Learning by trying random changes and keeping what scores better. No calculus, no right answers needed.'],
            ].map(([t, b]) => (
              <div key={t} className="rounded-2xl border border-white/8 bg-white/3 p-5">
                <dt className="font-semibold">{t}</dt>
                <dd className="mt-1.5 text-sm text-pretty text-muted-foreground">{b}</dd>
              </div>
            ))}
          </dl>
        </Section>

        {/* ------------------------------------------------------------ your turn */}
        <section className="relative mx-auto mt-24 max-w-7xl px-4 sm:px-6">
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-card px-6 py-14 text-center sm:px-12 sm:py-20">
            <div aria-hidden className="pointer-events-none absolute -top-40 right-1/4 size-96 translate-x-1/2 rounded-full bg-tnn/18 blur-[100px]" />
            <h2 className="display relative mx-auto max-w-3xl text-4xl text-balance sm:text-6xl">Now train your own.</h2>
            <p className="relative mx-auto mt-4 max-w-xl text-lg text-pretty text-muted-foreground">
              Pick a car and a track, choose what your network sees and how big it is, and press Train. Then see if you can beat it yourself.
            </p>
            <div className="relative mt-8 flex flex-wrap justify-center gap-3">
              <Button asChild size="xl" variant="tnn"><a href={withBase('/lab')}><Brain /> Open the lab</a></Button>
              <Button asChild size="xl" className="glow-human"><a href={withBase('/drive')}><Play className="fill-current" /> Drive it yourself</a></Button>
              <Button asChild size="xl" variant="glass"><Link href="/networks">See trained networks <ArrowRight /></Link></Button>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

/** A saved network that laps, every weight in a table: input by output. */
function RealDriver({ net, track, full }: { net: Network; track: string | null; full: boolean }) {
  const shape = netShape(net), I = shape.inputs.length, O = shape.outputs.length, w = net.w!;
  const at = (k: number, i: number) => w[k * I + i];
  const pedal = shape.outputs.indexOf('pedal'), ahead = shape.inputs.findIndex(n => n === 'pace ahead' || n === 'pace note');
  const pull = !net.h && pedal >= 0 && ahead >= 0 ? at(pedal, ahead) : null;
  return (
    <div className="panel mt-5 grid grid-cols-[minmax(0,1fr)] gap-6 p-5 sm:p-7 lg:grid-cols-2">
      <div className="min-w-0">
        <p className="eyebrow text-tnn">A real driver, all of it</p>
        <h3 className="heading mt-1.5 text-xl">{shape.weights} numbers that lap {track ?? 'a track'} in <span className="num text-tnn">{fmtLap(net.bestLap)}</span></h3>
        <p className="mt-1 text-sm text-muted-foreground">{carName(net.vehicle)}{track ? ` · ${track}, ${groundLabel(net.ground)}` : ''} · {net.gen.toLocaleString('en-US')} generations · trained by {publicName(net.ownerName, full)}</p>
        <NetDiagram net={net} className="mt-4" />
        <p className="num mt-2 text-xs text-muted-foreground"><span style={{ color: '#ff8a3d' }}>━</span> positive: pulls left / gas <span className="ml-2" style={{ color: '#4aa8ff' }}>━</span> negative: pulls right / brake</p>
      </div>
      <div className="min-w-0">
        {!net.h ? (
          <table className="w-full text-sm">
            <caption className="mb-2 text-left text-sm text-muted-foreground">Its weights: one per input for each output, then the biases.</caption>
            <thead>
              <tr className="border-b border-white/10 text-left">
                <th scope="col" className="py-2 pr-3 font-medium text-muted-foreground">input</th>
                {shape.outputs.map(o => <th key={o} scope="col" className="num py-2 text-right font-medium">{o}</th>)}
              </tr>
            </thead>
            <tbody>
              {shape.inputs.map((n, i) => (
                <tr key={n + i} className="border-b border-white/6">
                  <th scope="row" className="num py-1.5 pr-3 text-left font-normal">{n}</th>
                  {shape.outputs.map((o, k) => <td key={o} className="num py-1.5 text-right">{fmtW(at(k, i))}</td>)}
                </tr>
              ))}
              <tr>
                <th scope="row" className="py-1.5 pr-3 text-left font-normal text-muted-foreground">bias</th>
                {shape.outputs.map((o, k) => <td key={o} className="num py-1.5 text-right">{fmtW(w[I * O + k])}</td>)}
              </tr>
            </tbody>
          </table>
        ) : <WeightGrid w={w} />}
        <p className="mt-4 text-sm text-pretty text-muted-foreground">
          That’s it. There is no other code that knows how to drive: change these numbers and you change the driver.
          {pull != null && <> Look at the pedal’s weight on <span className="num text-foreground">{shape.inputs[ahead]}</span>: {fmtW(pull)}.{' '}
            {pull > 0 ? 'Big and positive: when the road ahead can be taken faster than it is going, it presses the gas. When a bend needs less speed, that input goes negative, and so does the pedal: it brakes. Nobody wrote that rule. It was found by evolution.' : 'Its sign says which way that input pushes the pedal: nobody chose it, evolution did.'}</>}
        </p>
      </div>
    </div>
  );
}
const fmtW = (v: number) => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(2)}`;

/** Our networks against famous ones, on a scale of powers of ten: a bar list, the value written by each bar. */
function SizeChart() {
  const top = Math.log10(SIZES[SIZES.length - 1].n);
  return (
    <figure className="panel p-5 sm:p-7">
      <ul className="space-y-4">
        {SIZES.map(s => {
          const pct = Math.max(1.5, (Math.log10(s.n) / top) * 100);
          return (
            <li key={s.name} title={`${s.name}: ${s.n.toLocaleString('en-US')} weights`}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 text-sm">
                <span className={s.ours ? 'font-medium text-foreground' : 'text-foreground/85'}>{s.name} <span className="text-muted-foreground">· {s.note}</span></span>
                <span className="num text-foreground">{words(s.n)}</span>
              </div>
              <div className="mt-1.5 h-2 rounded-full bg-white/5">
                <div className="h-2 rounded-r-[4px]" style={{ width: `${pct}%`, background: s.ours ? 'var(--tnn)' : 'color-mix(in oklab, var(--foreground) 35%, transparent)' }} />
              </div>
            </li>
          );
        })}
      </ul>
      <div className="num relative mt-4 h-4 text-[11px] text-muted-foreground/70" aria-hidden>
        {([[1, '1'], [1e3, '1,000'], [1e6, '1 million'], [1e9, '1 billion']] as const).map(([v, t]) => (
          <span key={t} className="absolute top-0 border-l border-white/15 pl-1" style={{ left: `${(Math.log10(v) / top) * 100}%` }}>{t}</span>
        ))}
      </div>
      <figcaption className="mt-3 text-xs text-muted-foreground">
        Weights (also called parameters), on a scale where every step to the right is ten times more (a log scale). <span className="text-tnn">Cyan</span>: Carsim’s.
      </figcaption>
    </figure>
  );
}

function Section({ id, eyebrow, title, lead, children }: { id: string; eyebrow: string; title: string; lead?: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mx-auto mt-24 max-w-7xl scroll-mt-20 px-4 sm:mt-28 sm:px-6">
      <p className="eyebrow text-primary">{eyebrow}</p>
      <h2 id={`${id}-title`} className="display mt-3 max-w-4xl text-3xl text-balance sm:text-5xl">{title}</h2>
      {lead && <p className="mt-4 max-w-3xl text-lg text-pretty text-muted-foreground">{lead}</p>}
      <div className="mt-10">{children}</div>
    </section>
  );
}

function Card({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="panel p-5 sm:p-6">
      <div className="flex size-9 items-center justify-center rounded-lg bg-tnn/12 text-tnn [&_svg]:size-4.5" aria-hidden>{icon}</div>
      <h3 className="heading mt-3 text-lg">{title}</h3>
      <p className="mt-1.5 text-sm text-pretty text-muted-foreground">{children}</p>
    </div>
  );
}

function Point({ icon, title, tone = 'tnn', children }: { icon: React.ReactNode; title: string; tone?: 'tnn' | 'plain'; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <div className={`flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4 ${tone === 'tnn' ? 'bg-tnn/12 text-tnn' : 'bg-white/6 text-foreground/80'}`} aria-hidden>{icon}</div>
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-0.5 text-sm text-pretty text-muted-foreground">{children}</p>
      </div>
    </li>
  );
}
