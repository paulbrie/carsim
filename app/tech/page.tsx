import { Cog, Disc3, Gauge, Layers, Mountain, Shield, Wind, Waves, Activity, CircleDot, Car, Timer } from 'lucide-react';
import { auth } from '@/auth';
import { SiteNav } from '@/components/site-nav';
import { SiteFooter } from '@/components/site-footer';
import { CarCards, CarTable } from '@/components/tech-cars';
import { techSpecs, type GroundSpec } from '@/lib/tech/specs.mjs';
import { withBase } from '@/lib/base-path';

export const metadata = {
  title: 'Tech specs',
  description: 'What the Carsim physics takes into account, 240 times a second: engine, gearbox, tires on soft ground, suspension, drag, damage. And every car with its figures.',
  alternates: { canonical: withBase('/tech') },
};
export const dynamic = 'force-dynamic';

// The physics described here is stepCar and its helpers in public/sim/engine.js: the constants quoted in the text
// are that code's (AGENTS.md). The cars' and grounds' figures are read from engine.js itself (lib/tech/specs.mjs).

export default async function Tech() {
  const session = await auth();
  const user = session?.user ? { name: session.user.name ?? 'Driver', image: session.user.image ?? null, admin: session.user.admin } : null;
  const S = techSpecs();
  const sand = S.grounds.find(g => g.key === 'sand')!, asphalt = S.grounds.find(g => g.key === 'asphalt')!;

  return (
    <div className="relative overflow-x-clip">
      <div aria-hidden className="grid-fade pointer-events-none absolute inset-0 h-[700px]" />
      <SiteNav user={user} active="tech" />
      <main className="relative mx-auto max-w-7xl px-4 pt-12 sm:px-6 sm:pt-16">
        <p className="eyebrow text-primary">Tech specs</p>
        <h1 className="display mt-3 max-w-5xl text-4xl text-balance sm:text-6xl">Everything the sim takes into account.</h1>
        <p className="mt-4 max-w-3xl text-lg text-pretty text-muted-foreground">
          Carsim is not a game engine with a car on top. Every wheel sinks into the ground it is on, grips as that ground allows, and leaves it
          changed for the next lap. This page is the model: what it computes, the numbers it uses, and every car with its figures. They are read from
          the sim’s own code, so they are the ones you drive.
        </p>
        <dl className="mt-8 grid max-w-4xl grid-cols-2 gap-3 sm:grid-cols-4">
          {[[`${S.hz} Hz`, 'physics steps a second'], [String(S.cars.length), 'cars'], [String(S.grounds.length), 'kinds of ground'], ['0.25 m', 'ground grid, 400 m square']].map(([v, k]) => (
            <div key={k} className="panel flex flex-col-reverse px-4 py-3.5">
              <dt className="mt-0.5 text-sm text-muted-foreground">{k}</dt>
              <dd className="num text-2xl font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
        <nav aria-label="On this page" className="mt-8 flex flex-wrap gap-2 text-sm">
          {[['#physics', 'The physics'], ['#grounds', 'The grounds'], ['#cars', 'The cars'], ['#not', 'What it leaves out']].map(([h, l]) => (
            <a key={h} href={h} className="rounded-full border border-white/10 px-3 py-1.5 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">{l}</a>
          ))}
        </nav>
      </main>

      <Section id="physics" eyebrow="The physics" title={`What it computes, ${S.hz} times a second.`}
        lead={`The car is one rigid body with four wheels, stepped at a fixed ${S.hz} Hz (1/${S.hz} s), up to ten steps per drawn frame. Each step works out the parts below, adds up their forces and torques, and moves the car.`}>
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          <Part icon={<Activity />} title="The body" items={[
            'Six degrees of freedom: position, velocity, orientation (a quaternion) and spin, under gravity at 9.81 m/s².',
            'An inertia for each axis (pitch, yaw, roll), from the car’s length, width and height and its mass, so a long car is slow to turn and a tall one easy to roll.',
            'The gyroscopic term of a spinning body (ω × Iω) is in the equations; a little rotational damping (0.15 per second) stands in for what the model leaves out.',
          ]} />
          <Part icon={<Gauge />} title="The engine" items={[
            'A full-throttle torque curve for each engine (the charts below), read between its points. What you get is that torque times how far the pedal is down.',
            'The pedal ramps: it takes about 0.45 s to floor and 0.25 s to lift, so a tap gives part throttle (you need it on soft sand).',
            'Rev limiter: the fuel is cut at the limiter and comes back 250 rpm below. Lifting off brakes the car through the engine, more in low gears.',
            'Damage costs power: a hit at the engine’s end of the car most of all, down to a quarter of it.',
          ]} formula="T_wheels = T_engine(rpm) · throttle · gear · final drive · efficiency" />
          <Part icon={<Cog />} title="Converter and gearbox" items={[
            'Between engine and gearbox a torque converter (the buggy: a centrifugal clutch) slips: the engine can run above the wheels’ speed, up to the car’s stall speed at full throttle, and while it slips it multiplies the torque by up to 1.3.',
            'An automatic gearbox shifts on the car’s speed over the ground, not the wheels’, so wheelspin doesn’t make it hunt. Its shift points move with the throttle: early with a light foot, near the limiter flat out.',
            'A shift cuts the drive for 0.1 s (0.18 s with five gears or fewer), and it waits 0.7 s before the next. Hold the brake at a standstill and it goes into reverse.',
          ]} />
          <Part icon={<CircleDot />} title="Wheels and differentials" items={[
            'Each wheel has its own spin and inertia. Its new spin is solved together with the tire’s force at that spin (Newton’s method, bracketed), so a wheel can’t shake between slipping both ways at walking pace.',
            'Rear-wheel drive, or all-wheel drive through a centre differential with a front/rear split (4 changes it: 50/50, 40/60, 30/70, 20/80; the dune buggy switches between rear and four-wheel drive).',
            'Limited-slip differentials on both axles: a quarter of the two wheels’ difference in speed is shared out each step, up to 500 N·m.',
          ]} />
          <Part icon={<Disc3 />} title="Brakes and driver aids" items={[
            'Brake torque shared 60/40 front/rear. The handbrake locks the rear wheels with 4,000 N·m.',
            `ABS (road cars, above 9 km/h): it lets a wheel slip ${Math.round(0.16 * 100)} % on asphalt and 25 % off it before it eases the brake, down to 15 %.`,
            'Traction control (road cars): it trims the engine’s torque, down to a tenth, once a driven wheel spins faster than the car goes by more than 12 % of the speed on asphalt (15 % off it). X turns both aids off.',
          ]} />
          <Part icon={<Car />} title="Steering" items={[
            'Each car has its own steering lock. The lock you can use falls off with speed, to a third at 24 m/s (86 km/h), as a driver’s hands would.',
            'The front wheels turn at 2.2 rad/s at most: no instant flicks. A bent wheel (damage) keeps its toe and camber, and pulls.',
          ]} />
          <Part icon={<Waves />} title="Suspension" items={[
            'Each wheel finds where its tire circle touches the ground: five samples across the tire, four passes a step, against the ground or a bridge deck under it.',
            'A spring and a damper per wheel. The damping is set from the spring and the car’s mass: 30 % of critical in bump, 45 % in rebound.',
            'At the end of the travel a bump stop (160 kN/m) takes over; landing on it hard bends that corner. Past about 70° of roll or pitch the suspension can no longer carry the car.',
          ]} formula="F = k · compression + c · compression speed" />
          <Part icon={<Layers />} title="The tire on soft ground" wide items={[
            'The contact patch: the tire presses on the ground at about its inflation pressure (0.8 of it, plus 12 kPa for the carcass). Its width comes with the pressure; its length grows with the load, up to 0.3 m.',
            'Sinkage: the ground gives under that pressure as much as its stiffness allows, and packed ground (where cars have already been) is several times stiffer. Up to 0.28 m.',
            'Resistance: the tire has to compact the fresh ground ahead of it (more the deeper it sinks), plus 2 % of the load in rolling resistance, plus the bulldozing of a wheel deep in a rut.',
            'Grip: the most the ground can push back (Mohr–Coulomb): the load times the ground’s friction, plus its cohesion over the contact patch. Packed ground grips better than fresh.',
            'The driving force builds up with the slip (Janosi): F = F_max (1 − e^(−slip / s₀)). The side force the same way with the slip angle, up to 92 % of F_max. Both together never exceed F_max (the friction circle).',
            `On asphalt a sliding tire grips up to ${Math.round(asphalt.slide * 100)} % less than a rolling one, so a locked wheel or a spin costs grip.`,
          ]} formula="F_max = load · tan φ + cohesion · width · length" />
          <Part icon={<Timer />} title="Tire pressure" items={[
            'Three pressures per car (Shift+P): each has its own contact width and squash under load.',
            `Low: a wider, longer patch at a lower pressure, so the tire sinks less into ${sand.name.toLowerCase()} and floats, but it squashes more and its rolling radius shrinks. High: a narrow, firm tire, better where the ground is hard.`,
          ]} />
          <Part icon={<Mountain />} title="The ground remembers" wide items={[
            'The ground is a height grid of 0.25 m cells. Each tire presses its footprint into it and packs it (30 % of the way to fully packed with each pass), so a line driven over and over gets firm and fast.',
            'A spinning or sliding tire digs: the ground it takes out is thrown behind it, and some of what it presses down is pushed out to the sides as berms. Loose ground that lands is soft again.',
            'So ruts form, deepen and get in the way on later laps. Asphalt and bridge decks don’t deform.',
          ]} />
          <Part icon={<Wind />} title="Air" items={[
            'Aerodynamic drag on the whole car: half the air’s density (1.2 kg/m³) times the car’s CdA times the speed squared, against the way it is going.',
            'Against the engine’s power, it is what sets the top speed.',
          ]} formula="F_drag = ½ · ρ · CdA · v²" />
          <Part icon={<Shield />} title="Body, crashes, damage" wide items={[
            'Points over the body (underbody, sills, roof, bumpers, the buggy’s roll cage) touch the ground with a stiff spring, damping and friction: the car can beach, roll, and rest on its roof or side.',
            'A part that hits the ground at more than 2.5 m/s is damaged (front, rear, left, right, roof, underbody), more the harder it hit; the body dents where it was hit, glass cracks and breaks, wheels go out of line, and the engine loses power.',
            'Car against car: the two bodies, with their mass and inertia, bounce off with some friction (a solved contact), in a race as against the bots.',
          ]} />
        </div>
      </Section>

      <Section id="grounds" eyebrow="The grounds" title="Three kinds of ground, one model."
        lead="Sand, earth and asphalt are the same equations with different numbers. Packed figures are for ground cars have already driven on: it gets stiffer and grips better.">
        <GroundTable grounds={S.grounds} />
        <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
          Stiffness: how much pressure it takes to sink a tire one metre into it (Bekker’s k). Friction: tan φ, the ground’s internal friction. Slip at peak:
          how much the tire slips before it pulls with most of its grip (s₀ in the formula above). Dig: how much a spinning tire digs out.
        </p>
      </Section>

      <Section id="cars" eyebrow="The cars" title={`${S.cars.length} cars, every figure the physics uses.`}
        lead="Dimensions, masses, engines and gearing from the makers’ data; the rest tuned to drive like them. Sort the table by any column, or jump to a car.">
        <CarTable cars={S.cars} />
        <div className="mt-10"><CarCards cars={S.cars} /></div>
      </Section>

      <Section id="not" eyebrow="What it leaves out" title="And what it doesn’t.">
        <ul className="grid max-w-4xl gap-x-10 gap-y-3 text-pretty text-muted-foreground sm:grid-cols-2">
          {[
            'No downforce or lift: the air only drags.',
            'No tire temperature or wear, and no fuel load: the car is the same on the last lap as on the first.',
            'The weather is the sky only: rain and cloud change the light, not the grip.',
            'An automatic gearbox only: no clutch pedal, no manual shifts.',
            'The engine is a curve, not a thermodynamic model: no turbo lag, no heat soak.',
          ].map(t => <li key={t} className="flex gap-3"><span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-white/30" />{t}</li>)}
        </ul>
      </Section>

      <SiteFooter />
    </div>
  );
}

function Section({ id, eyebrow, title, lead, children }: { id: string; eyebrow: string; title: string; lead?: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mx-auto mt-20 max-w-7xl scroll-mt-20 px-4 sm:mt-28 sm:px-6">
      <p className="eyebrow text-primary">{eyebrow}</p>
      <h2 id={`${id}-title`} className="display mt-3 max-w-4xl text-3xl text-balance sm:text-5xl">{title}</h2>
      {lead && <p className="mt-4 max-w-3xl text-lg text-pretty text-muted-foreground">{lead}</p>}
      <div className="mt-10">{children}</div>
    </section>
  );
}

function Part({ icon, title, items, formula, wide }: { icon: React.ReactNode; title: string; items: string[]; formula?: string; wide?: boolean }) {
  return (
    <article className={`panel flex flex-col p-6 ${wide ? 'md:col-span-2' : ''}`}>
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-xl bg-white/6 text-foreground [&_svg]:size-5">{icon}</div>
        <h3 className="heading text-xl">{title}</h3>
      </div>
      <ul className={`mt-4 space-y-2.5 text-sm text-pretty text-muted-foreground ${wide ? 'md:columns-2 md:gap-8 md:space-y-0 [&>li]:md:mb-2.5 [&>li]:break-inside-avoid' : ''}`}>
        {items.map(t => <li key={t}>{t}</li>)}
      </ul>
      {formula && <div className="mt-auto pt-4"><p className="num rounded-lg bg-black/25 px-3 py-2 text-xs text-foreground/90">{formula}</p></div>}
    </article>
  );
}

function GroundTable({ grounds }: { grounds: GroundSpec[] }) {
  const f = (x: number, d = 2) => x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const mpa = (k: number) => `${(k / 1e6).toLocaleString('en-US', { maximumFractionDigits: k < 1e7 ? 1 : 0 })}`;
  const rows: [string, (g: GroundSpec) => string][] = [
    ['Stiffness, fresh / packed (MPa/m)', g => g.rigid ? `${mpa(g.stiffness)}, rigid` : `${mpa(g.stiffness)} / ${mpa(g.packedStiffness)}`],
    ['Friction tan φ, fresh / packed', g => g.rigid ? f(g.friction) : `${f(g.friction)} / ${f(g.packedFriction)}`],
    ['Cohesion (kPa)', g => f(g.cohesion / 1000, 1)],
    ['Slip at peak grip, s₀', g => f(g.slipPeak, 2)],
    ['Slip angle at peak, rad', g => f(g.slipAngle, 3)],
    ['Grip lost sliding', g => g.slide ? `${Math.round(g.slide * 100)} %` : 'none'],
    ['Digs and ruts', g => g.rigid ? 'no' : `yes (dig ${f(g.dig, 4)})`],
  ];
  return (
    <div className="panel overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-white/8 text-left">
            <th scope="col" className="px-4 py-3 font-medium text-muted-foreground">Figure</th>
            {grounds.map(g => <th key={g.key} scope="col" className="px-4 py-3 text-right font-medium">{g.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-b border-white/5 last:border-0">
              <th scope="row" className="px-4 py-2.5 text-left font-normal text-muted-foreground">{k}</th>
              {grounds.map(g => <td key={g.key} className="num px-4 py-2.5 text-right">{v(g)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
