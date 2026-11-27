import { Bot, Hand, Sparkles } from 'lucide-react';
import { auth } from '@/auth';
import { SiteNav } from '@/components/site-nav';
import { SiteFooter } from '@/components/site-footer';
import { ArmSimView } from '@/components/arm-sim';
import { withBase } from '@/lib/base-path';
import { ARM, ARMS, GRIP_N, INPUTS, TASKS, type TaskKey } from '@/lib/arm/core.mjs';

export const metadata = {
  title: 'The arm (preview)',
  description: 'A second simulator, in preview: two arms with two-finger grippers (a desk arm, and Seeed Studio’s reBot Arm B601-RS), and tiny neural networks that learn to pick a cube up, put it in a tray, stack four. Watch one, try it by hand, train your own in the browser.',
};
export const dynamic = 'force-dynamic';

// The arm sim (#359) is a preview: one page, not in the top bar yet; its networks are saved on the server (#362). What it simulates is
// lib/arm/core.mjs, and the figures in the text below are read from it.
export default async function Arm() {
  const session = await auth();
  const user = session?.user ? { name: session.user.name ?? 'Driver', image: session.user.image ?? null, admin: session.user.admin } : null;
  const reachCm = Math.round((ARM.L1 + ARM.L2) * 100), B = ARMS.b601, bReachCm = Math.round((B.L1 + B.L2) * 100);

  return (
    <div className="relative overflow-x-clip">
      <div aria-hidden className="grid-fade pointer-events-none absolute inset-0 h-[700px]" />
      <SiteNav user={user} />
      <main className="relative mx-auto max-w-7xl px-4 pt-10 sm:px-6 sm:pt-14">
        <p className="eyebrow text-tnn">Preview · a second simulator</p>
        <h1 className="display mt-3 max-w-4xl text-4xl text-balance sm:text-6xl">An arm that learns to grab.</h1>
        <p className="mt-4 max-w-3xl text-lg text-pretty text-muted-foreground">
          The same idea as the cars, on a table: a network of about a hundred weights moves an arm, shuts its fingers on a cube and lifts it. Two arms: a desk arm, and a real one you can buy, Seeed Studio’s reBot Arm B601-RS.
          Nothing is glued. The cube is held by friction, and it slips when it is squeezed badly or swung too hard. The physics is MuJoCo, the simulator robot learning is done with.
        </p>

        <div className="mt-8"><ArmSimView signedIn={!!user} /></div>
        {/* the agent bridge (#363): an agent paired from the button in the right column trains here (public/sim/bridge.js) */}
        <script type="module" async src={withBase('/sim/bridge.js')} />

        <section aria-labelledby="ways" className="mt-14 grid gap-5 md:grid-cols-3">
          <h2 id="ways" className="sr-only">Three ways to use it</h2>
          {[
            { Icon: Bot, tone: 'text-tnn', title: 'Watch', text: 'A trained network takes the exam: the same placements of the cubes for everyone, one after the other.' },
            { Icon: Hand, tone: 'text-human', title: 'By hand', text: 'The same placements with your keyboard. The corner of the picture shows what the network needed for the one you are on.' },
            { Icon: Sparkles, tone: 'text-tnn', title: 'Train', text: 'A network from nothing, in this browser, on several cores. Evolution, as in the car lab: 16 variations a generation, the better ones show the way.' },
          ].map(({ Icon, tone, title, text }) => (
            <div key={title} className="panel p-5">
              <Icon className={`size-5 ${tone}`} aria-hidden />
              <h3 className="heading mt-3 text-lg">{title}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{text}</p>
            </div>
          ))}
        </section>

        <section aria-labelledby="sees" className="mt-14 grid gap-8 lg:grid-cols-2">
          <div>
            <h2 id="sees" className="heading text-2xl">What a network is shown</h2>
            <p className="mt-2 text-muted-foreground">Numbers, 60 times a second. No camera: it is told where the cube to move now is. For the tray and the stack it is given two notes, as a car’s network is given the line and the pace: which way to go over the table, and what height to be at. It still sets the speeds and decides when to shut and open the fingers.</p>
            <div className="panel mt-4 overflow-x-auto p-0">
              <table className="w-full text-left text-sm">
                <thead><tr className="eyebrow text-[0.62rem] text-muted-foreground/80"><th scope="col" className="px-4 py-2.5 font-medium">Input</th><th scope="col" className="px-4 py-2.5 font-medium">Numbers</th><th scope="col" className="px-4 py-2.5 font-medium">What it is</th></tr></thead>
                <tbody>
                  {[...new Set([...TASKS.grab.inputs, ...TASKS.tray.inputs])].map(id => (
                    <tr key={id} className="border-t border-white/6 align-top">
                      <th scope="row" className="px-4 py-2.5 font-medium whitespace-nowrap">{INPUTS[id].name}</th>
                      <td className="num px-4 py-2.5 text-muted-foreground">{INPUTS[id].n}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{INPUTS[id].about}{!TASKS.tray.inputs.includes(id) ? ' (Pick up)' : !TASKS.grab.inputs.includes(id) ? ' (Into the tray, Stack four)' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <h2 className="heading text-2xl">What it does, and how it is scored</h2>
            <ul className="mt-3 space-y-3 text-muted-foreground">
              <li><span className="font-medium text-foreground">Four outputs.</span> Move the hand outwards, upwards and sideways (up to {ARM.hand * 100} cm a second), and shut or open the fingers. The arm’s motors follow as fast as they can; a network can also be trained to drive each motor itself, which is harder.</li>
              <li><span className="font-medium text-foreground">The desk arm.</span> A base that turns, a shoulder, an elbow and a hand that hangs straight down: {reachCm} cm from shoulder to wrist at full stretch. Every joint has a motor that follows its order as its strength and the arm’s weight let it. The two fingers are geared together and close with at most {GRIP_N} newtons each.</li>
              <li>
                <span className="font-medium text-foreground">The reBot Arm B601-RS.</span> Built from the model its makers publish (<a className="underline underline-offset-2 hover:text-foreground" href="https://github.com/Seeed-Projects/reBot-DevArm" rel="noopener noreferrer" target="_blank">Seeed-Projects/reBot-DevArm</a>, CERN-OHL-W): every link’s length, measured mass and inertia, its joints’ ranges, its motors’ peak torques (36 N·m at the waist, shoulder and elbow, 14 at the wrist).
                {' '}{bReachCm} cm from shoulder to wrist, the hand at up to {B.hand * 100} cm a second (its joints at {B.speed[0]} rad/s, the top of Seeed’s own web console), fingers of {B.gripN} N.
                {' '}Its wrist bends at most 90°, so with the hand straight down the forearm can’t point up much: on a 12 cm riser, it reaches every cube and stacks four.
                {' '}A network is trained for one arm; the desk arm’s, put on this one as it is, still picks up 13 of 20.
              </li>
              <li><span className="font-medium text-foreground">The scenarios.</span> {(Object.keys(TASKS) as TaskKey[]).map((k, i) => <span key={k}>{i > 0 && ' '}<span className="text-foreground">{TASKS[k].name}</span>: {TASKS[k].about.replace(/\.$/, '')} ({TASKS[k].limit} s, {TASKS[k].exam} placements).</span>)}</li>
              <li><span className="font-medium text-foreground">The exam.</span> The score is how many placements it managed, then the time they took; a failed one counts its whole limit.</li>
              <li><span className="font-medium text-foreground">The same everywhere.</span> A network’s exam gives the same numbers in this browser and on a server, to the millisecond.</li>
            </ul>
            <p className="mt-5 rounded-xl border border-white/8 bg-white/3 px-4 py-3 text-sm text-muted-foreground">
              This is a preview. Signed in, you can save the networks you train and load anyone’s; there is no leaderboard for the arm yet, and a trained network can also be downloaded as a file. A network comes with Pick up, for each arm; the other scenarios wait for one to be trained.
            </p>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
