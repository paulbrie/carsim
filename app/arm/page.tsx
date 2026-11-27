import { Bot, Hand, Sparkles } from 'lucide-react';
import { auth } from '@/auth';
import { SiteNav } from '@/components/site-nav';
import { SiteFooter } from '@/components/site-footer';
import { ArmSimView } from '@/components/arm-sim';
import { ARM, INPUTS, TASKS } from '@/lib/arm/core.mjs';

export const metadata = {
  title: 'The arm (preview)',
  description: 'A second simulator, in preview: a desk arm with a two-finger gripper, and tiny neural networks that learn to pick a cube up. Watch one, try it by hand, train your own in the browser.',
};
export const dynamic = 'force-dynamic';

// The arm sim (#359) is a preview: one page, nothing saved on the server, not in the top bar yet. What it simulates is
// lib/arm/core.mjs, and the figures in the text below are read from it.
export default async function Arm() {
  const session = await auth();
  const user = session?.user ? { name: session.user.name ?? 'Driver', image: session.user.image ?? null, admin: session.user.admin } : null;
  const reachCm = Math.round((ARM.L1 + ARM.L2) * 100);

  return (
    <div className="relative overflow-x-clip">
      <div aria-hidden className="grid-fade pointer-events-none absolute inset-0 h-[700px]" />
      <SiteNav user={user} />
      <main className="relative mx-auto max-w-7xl px-4 pt-10 sm:px-6 sm:pt-14">
        <p className="eyebrow text-tnn">Preview · a second simulator</p>
        <h1 className="display mt-3 max-w-4xl text-4xl text-balance sm:text-6xl">An arm that learns to grab.</h1>
        <p className="mt-4 max-w-3xl text-lg text-pretty text-muted-foreground">
          The same idea as the cars, on a table: a network of about a hundred weights moves a desk arm, shuts its fingers on a cube and lifts it.
          Nothing is glued. The cube is held by friction, and it slips when it is squeezed badly.
        </p>

        <div className="mt-8"><ArmSimView /></div>

        <section aria-labelledby="ways" className="mt-14 grid gap-5 md:grid-cols-3">
          <h2 id="ways" className="sr-only">Three ways to use it</h2>
          {[
            { Icon: Bot, tone: 'text-tnn', title: 'Watch', text: 'A trained network takes the exam: the same 20 placements of the cube for everyone, one after the other.' },
            { Icon: Hand, tone: 'text-human', title: 'By hand', text: 'The same 20 placements with your keyboard. The corner of the picture shows what the network needed for the one you are on.' },
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
            <p className="mt-2 text-muted-foreground">Numbers, 60 times a second. No camera: it is told where the cube is, as a car’s network is told the line ahead.</p>
            <div className="panel mt-4 overflow-x-auto p-0">
              <table className="w-full text-left text-sm">
                <thead><tr className="eyebrow text-[0.62rem] text-muted-foreground/80"><th scope="col" className="px-4 py-2.5 font-medium">Input</th><th scope="col" className="px-4 py-2.5 font-medium">Numbers</th><th scope="col" className="px-4 py-2.5 font-medium">What it is</th></tr></thead>
                <tbody>
                  {TASKS.tray.inputs.map(id => (
                    <tr key={id} className="border-t border-white/6 align-top">
                      <th scope="row" className="px-4 py-2.5 font-medium whitespace-nowrap">{INPUTS[id].name}</th>
                      <td className="num px-4 py-2.5 text-muted-foreground">{INPUTS[id].n}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{INPUTS[id].about}{id === 'goal' && ' (only for Into the tray)'}</td>
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
              <li><span className="font-medium text-foreground">The arm.</span> A base that turns, a shoulder, an elbow and a hand that hangs straight down: {reachCm} cm from shoulder to wrist at full stretch. Each finger closes with at most 12 newtons.</li>
              <li><span className="font-medium text-foreground">The exam.</span> 20 placements, {TASKS.grab.limit} seconds each to pick the cube up ({TASKS.tray.limit} to put it in the tray). The score is how many it managed, then the time they took; a failed one counts its whole limit.</li>
              <li><span className="font-medium text-foreground">The same everywhere.</span> A network’s exam gives the same numbers in this browser and on a server, to the millisecond.</li>
            </ul>
            <p className="mt-5 rounded-xl border border-white/8 bg-white/3 px-4 py-3 text-sm text-muted-foreground">
              This is a preview. Networks are not saved and there is no leaderboard for the arm yet: a trained network can be downloaded as a file.
            </p>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
