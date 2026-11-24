'use client';
import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { CarSpec, CurvePoint } from '@/lib/tech/specs.mjs';
import { torqueAt } from '@/lib/tech/curve.mjs';
import { cn } from '@/lib/utils';

const n0 = (x: number) => x.toLocaleString('en-US', { maximumFractionDigits: 0 });
const n1 = (x: number) => x.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const n2 = (x: number) => x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n3 = (x: number) => x.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const pct = (x: number) => `${Math.round(x * 100)} %`;
const deg = (rad: number) => `${n1(rad * 180 / Math.PI)}°`;
const kmh = (ms: number) => ms * 3.6;
const ord = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

/** What a car's drive is: RWD, AWD with its front/rear split, or the buggy's switchable 4WD. */
export function driveLabel(c: CarSpec) {
  if (c.awdSwitchable) return 'RWD, 4WD on 4';
  if (c.drive === 'rwd') return 'RWD';
  return `AWD ${Math.round(c.split * 100)}/${Math.round((1 - c.split) * 100)}`;
}
const dragAt = (c: CarSpec, kph: number) => 0.5 * 1.2 * c.cda * (kph / 3.6) ** 2;
/** The most each gear reaches (km/h) on a flat road: the limiter, or sooner where full throttle no longer beats the
 *  drag and the rolling resistance (2 % of the weight on asphalt), at the rolling radius of the car's own pressure. */
const gearSpeeds = (c: CarSpec) => c.engine.gears.map(g => {
  const ratio = g * c.engine.finalDrive, R = c.tire.radius, vMax = c.engine.limiter * 2 * Math.PI / 60 / ratio * R;
  let v = 0;
  for (let u = 1; u <= vMax; u += 0.05) {
    const rpm = Math.max(u / R * ratio * 60 / (2 * Math.PI), c.engine.idle);
    if (torqueAt(c.engine.curve, rpm) * ratio * c.engine.efficiency / R < 0.5 * 1.2 * c.cda * u * u + 0.02 * c.mass * 9.81) break;
    v = u;
  }
  return { v: kmh(v), limited: v < vMax - 0.1 };
});

// ---------------------------------------------------------------- the comparison table
type Col = { key: string; label: string; unit?: string; get: (c: CarSpec) => number | string; fmt?: (c: CarSpec) => string; desc: string };
const COLS: Col[] = [
  { key: 'drive', label: 'Drive', get: c => driveLabel(c), desc: 'Which wheels the engine drives, and the front/rear split of an all-wheel drive' },
  { key: 'mass', label: 'Mass', unit: 'kg', get: c => c.mass, fmt: c => n0(c.mass), desc: 'Kerb mass' },
  { key: 'power', label: 'Power', unit: 'kW', get: c => c.engine.peakPower, fmt: c => n0(c.engine.peakPower), desc: 'Peak power, from the torque curve' },
  { key: 'torque', label: 'Torque', unit: 'N·m', get: c => c.engine.peakTorque, fmt: c => n0(c.engine.peakTorque), desc: 'Peak engine torque' },
  { key: 'ptw', label: 'Power/mass', unit: 'kW/t', get: c => c.powerToWeight, fmt: c => n0(c.powerToWeight), desc: 'Peak power per tonne' },
  { key: 'front', label: 'Front', unit: '%', get: c => c.frontWeight, fmt: c => n0(c.frontWeight * 100), desc: 'Share of the weight on the front axle' },
  { key: 'wb', label: 'Wheelbase', unit: 'm', get: c => c.wheelbase, fmt: c => n2(c.wheelbase), desc: 'Distance between the axles' },
  { key: 'redline', label: 'Limiter', unit: 'rpm', get: c => c.engine.limiter, fmt: c => n0(c.engine.limiter), desc: 'Where the rev limiter cuts in' },
  { key: 'gears', label: 'Gears', get: c => c.engine.gears.length, fmt: c => String(c.engine.gears.length), desc: 'Forward gears of the automatic gearbox' },
  { key: 'cda', label: 'CdA', unit: 'm²', get: c => c.cda, fmt: c => n2(c.cda), desc: 'Drag coefficient times frontal area' },
  { key: 'brake', label: 'Brakes', unit: 'N·m', get: c => c.brakeTorque, fmt: c => n0(c.brakeTorque), desc: 'Brake torque at full pedal (before the 60/40 front/rear share)' },
  { key: 'spring', label: 'Springs', unit: 'kN/m', get: c => c.suspension.spring, fmt: c => n1(c.suspension.spring / 1000), desc: 'Spring rate at each wheel' },
  { key: 'tire', label: 'Tire radius', unit: 'm', get: c => c.tire.radius, fmt: c => n3(c.tire.radius), desc: 'Rolling radius at the car’s own pressure' },
];

export function CarTable({ cars }: { cars: CarSpec[] }) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const rows = useMemo(() => {
    if (!sort) return cars;
    const col = COLS.find(c => c.key === sort.key)!;
    return [...cars].sort((a, b) => {
      const x = col.get(a), y = col.get(b);
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir;
    });
  }, [cars, sort]);
  const by = (key: string) => setSort(s => (s?.key !== key ? { key, dir: key === 'drive' ? 1 : -1 } : s.dir === -1 ? { key, dir: 1 } : null));

  return (
    <div className="panel overflow-x-auto">
      <table className="w-full min-w-[1080px] text-sm">
        <caption className="sr-only">Every car’s main figures. Sort by a column with its header button.</caption>
        <thead>
          <tr className="border-b border-white/8 text-left">
            <th scope="col" className="sticky left-0 z-10 bg-card px-4 py-3 font-medium">Car</th>
            {COLS.map(c => {
              const on = sort?.key === c.key;
              return (
                <th key={c.key} scope="col" aria-sort={on ? (sort!.dir === 1 ? 'ascending' : 'descending') : 'none'} className="px-2 py-2 font-medium">
                  <button type="button" onClick={() => by(c.key)} title={c.desc}
                    className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-left outline-none hover:bg-white/6 focus-visible:ring-2 focus-visible:ring-ring', c.key !== 'drive' && 'flex-row-reverse text-right', on ? 'text-foreground' : 'text-muted-foreground')}>
                    <span className="leading-tight">{c.label}{c.unit && <span className="block text-[0.68rem] font-normal text-muted-foreground/70">{c.unit}</span>}</span>
                    {on ? (sort!.dir === 1 ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />) : <span className="size-3.5" />}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map(c => (
            <tr key={c.key} className="border-b border-white/5 last:border-0 hover:bg-white/3">
              <th scope="row" className="sticky left-0 z-10 bg-card px-4 py-2.5 text-left font-medium">
                <a href={`#car-${c.key}`} className="rounded outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">{c.name}</a>
              </th>
              {COLS.map(col => (
                <td key={col.key} className={cn('px-3 py-2.5 whitespace-nowrap', col.key === 'drive' ? 'text-muted-foreground' : 'num text-right')}>{col.fmt ? col.fmt(c) : col.get(c)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- one car's torque and power, full throttle
const W = 320, H = 120, PAD = { l: 34, r: 8, t: 8, b: 20 };
const LINE = '#9085e9';   // one data hue for every chart (orange and cyan are the humans' and the networks')

function Curve({ pts, field, max, rpmMax, at, setAt, label, unit, step }: {
  pts: CurvePoint[]; field: 'torque' | 'power'; max: number; rpmMax: number; at: number | null; setAt: (i: number | null) => void; label: string; unit: string; step: number;
}) {
  const x = (rpm: number) => PAD.l + rpm / rpmMax * (W - PAD.l - PAD.r);
  const y = (v: number) => H - PAD.b - v / max * (H - PAD.t - PAD.b);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.rpm).toFixed(1)},${y(p[field]).toFixed(1)}`).join('');
  const ticks = Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step);
  const hit = (e: React.PointerEvent<SVGSVGElement>) => {
    const b = e.currentTarget.getBoundingClientRect(), rpm = ((e.clientX - b.left) / b.width * W - PAD.l) / (W - PAD.l - PAD.r) * rpmMax;
    let best = 0; for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i].rpm - rpm) < Math.abs(pts[best].rpm - rpm)) best = i;
    setAt(best);
  };
  const p = at == null ? null : pts[at];
  return (
    <figure className="min-w-0">
      <figcaption className="eyebrow mb-1 text-[0.6rem] text-muted-foreground/80">{label} <span className="normal-case tracking-normal">({unit})</span></figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full touch-none select-none" role="img" aria-label={`${label} from ${n0(pts[0].rpm)} to ${n0(pts[pts.length - 1].rpm)} rpm, up to ${n0(Math.max(...pts.map(q => q[field])))} ${unit}`}
        onPointerMove={hit} onPointerDown={hit} onPointerLeave={() => setAt(null)}>
        {ticks.map(t => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="currentColor" className="text-white/7" strokeWidth={1} />
            <text x={PAD.l - 5} y={y(t) + 3} textAnchor="end" className="num fill-muted-foreground/70 text-[9px]">{t}</text>
          </g>
        ))}
        {[0, 2000, 4000, 6000, 8000].filter(r => r <= rpmMax).map(r => (
          <text key={r} x={x(r)} y={H - 6} textAnchor={r === 0 ? 'start' : 'middle'} className="num fill-muted-foreground/70 text-[9px]">{r ? `${r / 1000}k` : '0'}</text>
        ))}
        <path d={d} fill="none" stroke={LINE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {p && (
          <g>
            <line x1={x(p.rpm)} x2={x(p.rpm)} y1={PAD.t} y2={H - PAD.b} stroke="currentColor" className="text-white/40" strokeWidth={1} />
            <circle cx={x(p.rpm)} cy={y(p[field])} r={4} fill={LINE} stroke="var(--card)" strokeWidth={2} />
          </g>
        )}
      </svg>
    </figure>
  );
}

function Curves({ c, maxT, maxP, rpmMax }: { c: CarSpec; maxT: number; maxP: number; rpmMax: number }) {
  const pts = c.engine.points, [at, setAt] = useState<number | null>(null), p = at == null ? null : pts[at];
  const key = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const i = at ?? pts.findIndex(q => q.power === c.engine.peakPower);
    setAt(Math.max(0, Math.min(pts.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 10 : 1))));
  };
  return (
    <div tabIndex={0} onKeyDown={key} onBlur={() => setAt(null)} aria-label={`${c.name}: torque and power curves. Left and right arrows read them.`}
      className="rounded-xl border border-white/6 bg-black/20 p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <p className="num mb-2 min-h-4 text-xs text-muted-foreground" aria-live="polite">
        {p ? <><span className="text-foreground">{n0(p.rpm)} rpm</span> · <span className="text-foreground">{n0(p.torque)}</span> N·m · <span className="text-foreground">{n0(p.power)}</span> kW</>
          : <>Full throttle. Hover, or use the arrows.</>}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Curve pts={pts} field="torque" max={maxT} rpmMax={rpmMax} at={at} setAt={setAt} label="Torque" unit="N·m" step={250} />
        <Curve pts={pts} field="power" max={maxP} rpmMax={rpmMax} at={at} setAt={setAt} label="Power" unit="kW" step={200} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- a car's card
function Group({ title, rows }: { title: string; rows: [string, React.ReactNode, string?][] }) {
  return (
    <div>
      <h4 className="eyebrow mb-2 text-[0.62rem] text-muted-foreground/80">{title}</h4>
      <dl className="space-y-1.5 text-sm">
        {rows.map(([k, v, hint]) => (
          <div key={k} className="flex items-baseline justify-between gap-3" title={hint}>
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="num text-right">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function CarCards({ cars }: { cars: CarSpec[] }) {
  // one scale for every car, so their curves compare at a glance
  const maxT = Math.ceil(Math.max(...cars.map(c => c.engine.peakTorque)) / 250) * 250;
  const maxP = Math.ceil(Math.max(...cars.map(c => c.engine.peakPower)) / 200) * 200;
  const rpmMax = Math.ceil(Math.max(...cars.map(c => c.engine.limiter)) / 1000) * 1000;
  return (
    <ul className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      {cars.map(c => {
        const e = c.engine, own = c.pressures[1], vs = gearSpeeds(c), top = Math.max(...vs.map(v => v.v)), topGear = vs.findIndex(v => v.v === top) + 1;
        return (
          <li key={c.key} id={`car-${c.key}`} className="panel min-w-0 scroll-mt-24 p-5 sm:p-6">
            <p className="eyebrow text-muted-foreground">{driveLabel(c)} · {n0(c.mass)} kg</p>
            <h3 className="heading mt-1.5 text-2xl">{c.name}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{c.blurb}</p>
            <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[['Peak power', `${n0(e.peakPower)} kW`, `at ${n0(e.peakPowerRpm)} rpm`], ['Peak torque', `${n0(e.peakTorque)} N·m`, e.peakTorqueRpm[0] === e.peakTorqueRpm[1] ? `at ${n0(e.peakTorqueRpm[0])} rpm` : `${n0(e.peakTorqueRpm[0])}–${n0(e.peakTorqueRpm[1])} rpm`],
                ['Power/mass', `${n0(c.powerToWeight)} kW/t`, `${n1(c.mass / e.peakPower)} kg per kW`],
                ['Top speed', `${n0(top)} km/h`, `about, in ${ord(topGear)} gear`]].map(([k, v, s]) => (
                <div key={k} className="rounded-xl bg-white/4 px-3 py-2.5">
                  <dt className="eyebrow text-[0.58rem] text-muted-foreground/70">{k}</dt>
                  <dd className="num mt-1 text-lg font-medium">{v}</dd>
                  <dd className="num text-xs text-muted-foreground">{s}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4"><Curves c={c} maxT={maxT} maxP={maxP} rpmMax={rpmMax} /></div>
            <div className="mt-5 grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
              <Group title="Body" rows={[
                ['Mass', `${n0(c.mass)} kg`],
                ['On the front axle', `${c.key === 'buggy' ? '≈ ' : ''}${pct(c.frontWeight)}`, 'Where the centre of mass sits between the axles'],
                ['Wheelbase', `${n3(c.wheelbase)} m`],
                ['Track front / rear', `${n3(c.trackF)} / ${n3(c.trackR)} m`],
                ['Length × width', `${n2(c.length)} × ${n2(c.width)} m`],
                ...(c.height != null ? [['Height', `${n2(c.height)} m`] as [string, string]] : []),
                ['Inertia pitch / yaw / roll', `${n0(c.inertia.pitch)} / ${n0(c.inertia.yaw)} / ${n0(c.inertia.roll)} kg·m²`, 'How hard the body is to rotate about each axis'],
              ]} />
              <Group title="Engine" rows={[
                ['Idle / limiter', `${n0(e.idle)} / ${n0(e.limiter)} rpm`],
                ['Converter stall', `${n0(e.stall)} rpm`, 'The engine speed the converter (the buggy: its centrifugal clutch) lets the engine reach at full throttle from rest'],
                ['Driveline efficiency', pct(e.efficiency)],
                ['Shifts up at', `${n0(e.shiftUp[0])}–${n0(e.shiftUp[1])} rpm`, 'From a light foot to full throttle'],
                ['Shifts down below', `${n0(e.shiftDown[0])}–${n0(e.shiftDown[1])} rpm`, 'From a light foot to full throttle'],
              ]} />
              <div className="sm:col-span-2">
                <h4 className="eyebrow mb-2 text-[0.62rem] text-muted-foreground/80">Gearbox · final drive {n2(e.finalDrive)} · reverse {n2(e.reverse)}</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-muted-foreground"><th scope="row" className="pr-3 text-left font-normal">Gear</th>{e.gears.map((_, i) => <th key={i} scope="col" className="num px-1 text-right font-normal">{i + 1}</th>)}</tr></thead>
                    <tbody>
                      <tr><th scope="row" className="pr-3 text-left font-normal text-muted-foreground">Ratio</th>{e.gears.map((g, i) => <td key={i} className="num px-1 text-right">{n2(g)}</td>)}</tr>
                      <tr><th scope="row" className="pr-3 text-left font-normal whitespace-nowrap text-muted-foreground">Max km/h</th>{vs.map((v, i) => (
                        <td key={i} className={cn('num px-1 text-right', v.limited && 'text-muted-foreground')} title={v.limited ? 'Held back by drag before the limiter' : 'At the limiter'}>{n0(v.v)}</td>
                      ))}</tr>
                    </tbody>
                  </table>
                </div>
              </div>
              <Group title="Drive, brakes, steering" rows={[
                ['Drive', driveLabel(c)],
                ['Brake torque', `${n0(c.brakeTorque)} N·m`, 'Shared 60/40 front/rear; the handbrake locks the rear wheels with 4,000 N·m'],
                ['Steering lock', deg(c.steerLock), 'A third of it is left at 86 km/h'],
                ['Traction control, ABS', c.aids ? 'yes' : 'no', c.aids ? 'X turns them off' : undefined],
                ['Drag CdA', `${n2(c.cda)} m²`],
                ['Drag at 100 / 200 km/h', `${n0(dragAt(c, 100))} / ${n0(dragAt(c, 200))} N`],
              ]} />
              <Group title="Suspension, wheels" rows={[
                ['Spring rate', `${n1(c.suspension.spring / 1000)} kN/m`],
                ['Travel', `${n0(c.suspension.travel * 1000)} mm`],
                ['Damping bump / rebound', `${n1(c.suspension.bump / 1000)} / ${n1(c.suspension.rebound / 1000)} kN·s/m`],
                ['Tire radius', `${n3(c.tire.radius)} m`, `Rolling radius at ${own.psi} psi`],
                ['Tire width', `${n0(c.tire.width * 1000)} mm`, c.key === 'buggy' ? `Its contact width at ${own.psi} psi` : undefined],
                ['Wheel inertia', `${n1(c.tire.wheelInertia)} kg·m²`],
              ]} />
              <div className="sm:col-span-2">
                <h4 className="eyebrow mb-2 text-[0.62rem] text-muted-foreground/80">Tire pressures (Shift+P)</h4>
                <table className="w-full text-sm">
                  <thead><tr className="text-muted-foreground"><th scope="col" className="text-left font-normal">Pressure</th><th scope="col" className="text-right font-normal">Contact width</th><th scope="col" className="text-right font-normal">Squash under load</th></tr></thead>
                  <tbody>
                    {c.pressures.map((p, i) => (
                      <tr key={p.psi}>
                        <td className="num py-0.5">{p.psi} psi <span className="text-muted-foreground">· {p.kpa} kPa{i === 1 ? ' · its own' : ''}</span></td>
                        <td className="num text-right">{n0(p.width * 1000)} mm</td>
                        <td className="num text-right">{n0(p.deflection * 1000)} mm</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
