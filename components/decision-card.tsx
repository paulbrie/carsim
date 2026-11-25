'use client';
// The network's decisions while it drives a duel (/duel): what it sees, its hidden layer, what it does. The sim sends
// them 10 times a second (`decision`, scripts/patches/watch.py). Colours as the network's drawings: orange pulls +
// (left, gas), blue − (right, brake); the pedals in the sim's own green and red.
import { cn } from '@/lib/utils';

export interface Decision {
  dt: number; kmh: number;
  ins: [string, string, number][];
  hid: number[]; out: number[];
  ctl: { steer: number; throttle: number; brake: number; handbrake: boolean; hbHeld: boolean };
}

const POS = '#ff8a3d', NEG = '#4aa8ff', GAS = '#2fbf4a', BRAKE = '#e0352b';
const pct = (v: number) => `${Math.round(Math.min(1, Math.abs(v)) * 100)}%`;

/** A bar from the middle: + to the left (as the sim's steering and the line's bearings), − to the right. */
function Centre({ v, className }: { v: number; className?: string }) {
  const a = Math.min(1, Math.abs(v)) * 50;
  return (
    <div className={cn('relative h-1.5 rounded-full bg-white/8', className)}>
      <div className="absolute inset-y-0 left-1/2 w-px bg-white/25" />
      <div className="absolute inset-y-0 rounded-full transition-all duration-100" style={{ background: v >= 0 ? POS : NEG, width: `${a}%`, left: v >= 0 ? `${50 - a}%` : '50%' }} />
    </div>
  );
}

function Pedal({ label, v, color }: { label: string; v: number; color: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs"><span className="text-muted-foreground">{label}</span><span className="num">{pct(v)}</span></div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/8"><div className="h-full rounded-full transition-all duration-100" style={{ width: pct(v), background: color }} /></div>
    </div>
  );
}

export function DecisionCard({ d, className }: { d: Decision | null; className?: string }) {
  const steer = d?.ctl.steer ?? 0;
  return (
    <section aria-label="The network's decisions" className={cn('panel flex flex-col gap-5 p-4', className)}>
      <div>
        <p className="eyebrow text-tnn">The network&rsquo;s decisions</p>
        <p className="num mt-1 text-xs text-muted-foreground">{d ? `one every ${Math.round(d.dt * 1000)} ms · ${d.kmh} km/h` : 'waiting for it to drive…'}</p>
      </div>

      <div className="space-y-3">
        <p className="eyebrow text-[0.62rem] text-muted-foreground/70">What it does</p>
        <div>
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-muted-foreground">Steering</span>
            <span className="num">{Math.abs(steer) < 0.02 ? 'straight' : `${pct(steer)} ${steer > 0 ? 'left' : 'right'}`}</span>
          </div>
          <Centre v={steer} className="mt-1 h-2" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Pedal label="Gas" v={d?.ctl.throttle ?? 0} color={GAS} />
          <Pedal label="Brake" v={d?.ctl.brake ?? 0} color={BRAKE} />
        </div>
        {d && d.out.length > 2 && (
          <p className="text-xs text-muted-foreground">
            Handbrake: <span className={d.ctl.handbrake ? 'font-semibold text-foreground' : ''}>{d.ctl.handbrake ? 'pulled' : d.ctl.hbHeld ? 'wanted, held back by the rules' : 'off'}</span>
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <p className="eyebrow mb-2 text-[0.62rem] text-muted-foreground/70">What it sees</p>
        {(d?.ins ?? []).map(([name, shown, v]) => (
          <div key={name} className="grid grid-cols-[minmax(0,1fr)_4.5rem_3.5rem] items-center gap-2 text-xs">
            <span className="truncate text-muted-foreground" title={name}>{name}</span>
            <span className="num text-right">{shown}</span>
            <Centre v={v} />
          </div>
        ))}
      </div>

      {d && d.hid.length > 0 && (
        <div>
          <p className="eyebrow mb-2 text-[0.62rem] text-muted-foreground/70">Its hidden layer · {d.hid.length} units</p>
          <div className="grid grid-cols-8 gap-1">
            {d.hid.map((v, i) => (
              <div key={i} className="aspect-square rounded-sm border border-white/6 transition-colors duration-100" title={`unit ${i + 1}: ${v.toFixed(2)}`}
                style={{ background: v >= 0 ? POS : NEG, opacity: 0.12 + 0.88 * Math.min(1, Math.abs(v)) }} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
