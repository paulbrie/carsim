'use client';
// The two things to play with on /tnn (#334): one neuron (the pedal), and evolution finding two weights.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, StepForward } from 'lucide-react';
import { Button } from '@/components/ui/button';

const POS = '#ff8a3d', NEG = '#4aa8ff';   // the sim's own: orange gas (and left), blue brake (and right)
const sign = (v: number, d = 2) => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(d)}`;

function Slider({ label, value, min, max, step, onChange, show, hint }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; show: string; hint?: string;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="num text-foreground">{show}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(+e.target.value)}
        className="mt-2 w-full accent-[var(--tnn)]" />
      {hint && <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

/**
 * One neuron: the pedal. Two inputs as the sim scales them (pace ahead / 10 m/s, speed / 20 m/s), a weight each and a
 * bias, added up and squashed by tanh into −1 (full brake) .. +1 (full gas).
 */
export function NeuronPlayground() {
  const [pace, setPace] = useState(15);       // km/h the road ahead allows above our speed
  const [speed, setSpeed] = useState(80);     // km/h
  const [wPace, setWPace] = useState(4.1);
  const [wSpeed, setWSpeed] = useState(0);
  const [bias, setBias] = useState(-0.13);
  const x1 = pace / 36, x2 = speed / 72;      // (the sim's: m/s / 10 and / 20)
  const sum = wPace * x1 + wSpeed * x2 + bias, out = Math.tanh(sum);
  // the squash, drawn: tanh from −4 to 4
  const W = 260, Hh = 120, sx = (s: number) => ((s + 4) / 8) * W, sy = (v: number) => Hh / 2 - v * (Hh / 2 - 8);
  const curve = useMemo(() => Array.from({ length: 81 }, (_, i) => { const s = -4 + i / 10; return `${i ? 'L' : 'M'}${sx(s).toFixed(1)},${sy(Math.tanh(s)).toFixed(1)}`; }).join(''), []);
  const cs = Math.max(-4, Math.min(4, sum));
  return (
    <div className="panel grid gap-6 p-5 sm:p-7 lg:grid-cols-2">
      <div className="space-y-5">
        <p className="eyebrow text-tnn">Inputs: what the neuron is told</p>
        <Slider label="Pace ahead" value={pace} min={-36} max={36} step={1} onChange={setPace}
          show={`${pace > 0 ? '+' : pace < 0 ? '−' : ''}${Math.abs(pace)} km/h`} hint="How much faster than now the road a moment ahead can be taken. Negative: a bend is coming that needs less speed." />
        <Slider label="Speed" value={speed} min={0} max={144} step={1} onChange={setSpeed} show={`${speed} km/h`} hint="How fast the car is going." />
        <p className="eyebrow pt-2 text-tnn">Weights: what the neuron has learnt</p>
        <Slider label="Weight on pace ahead" value={wPace} min={-6} max={6} step={0.1} onChange={setWPace} show={sign(wPace, 1)}
          hint="+4.1 is what a real network that laps the figure-8 learnt by itself." />
        <Slider label="Weight on speed" value={wSpeed} min={-6} max={6} step={0.1} onChange={setWSpeed} show={sign(wSpeed, 1)} />
        <Slider label="Bias (a nudge of its own)" value={bias} min={-3} max={3} step={0.01} onChange={setBias} show={sign(bias)} />
      </div>
      <div className="flex flex-col gap-5">
        <div className="rounded-xl border border-white/8 bg-black/25 p-4">
          <p className="eyebrow text-muted-foreground/80">1 · Multiply and add</p>
          <p className="num mt-2 text-sm leading-6 break-words">
            {sign(wPace, 1)} × {x1.toFixed(2)} <span className="text-muted-foreground">(pace)</span><br />
            {sign(wSpeed, 1)} × {x2.toFixed(2)} <span className="text-muted-foreground">(speed)</span><br />
            {sign(bias)} <span className="text-muted-foreground">(bias)</span><br />
            = <span className="text-foreground font-semibold">{sign(sum)}</span>
          </p>
          <p className="mt-2 text-xs text-muted-foreground">The inputs are shrunk to small numbers first (pace ÷ 36 km/h, speed ÷ 72 km/h), as the sim does, so no input drowns out the others just by being big.</p>
        </div>
        <div className="rounded-xl border border-white/8 bg-black/25 p-4">
          <p className="eyebrow text-muted-foreground/80">2 · Squash it between −1 and +1</p>
          <svg viewBox={`0 0 ${W} ${Hh}`} className="mt-2 w-full max-w-sm" role="img" aria-label={`The tanh curve: a total of ${sum.toFixed(2)} becomes ${out.toFixed(2)}`}>
            <line x1={0} y1={Hh / 2} x2={W} y2={Hh / 2} stroke="currentColor" strokeOpacity="0.15" />
            <line x1={W / 2} y1={0} x2={W / 2} y2={Hh} stroke="currentColor" strokeOpacity="0.15" />
            <text x={4} y={12} fontSize="10" className="fill-muted-foreground" fontFamily="var(--font-mono)">+1 full gas</text>
            <text x={W - 4} y={Hh - 4} textAnchor="end" fontSize="10" className="fill-muted-foreground" fontFamily="var(--font-mono)">−1 full brake</text>
            <path d={curve} fill="none" stroke="var(--tnn)" strokeWidth="2" />
            <circle cx={sx(cs)} cy={sy(out)} r="5" fill={out >= 0 ? POS : NEG} stroke="var(--background)" strokeWidth="2" />
          </svg>
          <p className="mt-1 text-xs text-muted-foreground">This curve is called <span className="num text-foreground">tanh</span>. Whatever the total, big or small, what comes out stays between −1 and +1: a pedal can’t be pressed more than all the way.</p>
        </div>
        <div className="rounded-xl border border-white/8 bg-black/25 p-4" aria-live="polite">
          <p className="eyebrow text-muted-foreground/80">3 · The pedal</p>
          <div className="relative mt-3 h-3 rounded-full bg-white/8">
            <div className="absolute top-0 h-3 rounded-full" style={{ left: out < 0 ? `${50 + out * 50}%` : '50%', width: `${Math.abs(out) * 50}%`, background: out >= 0 ? POS : NEG }} />
            <div className="absolute top-[-3px] left-1/2 h-[18px] w-px bg-white/40" />
          </div>
          <div className="mt-1.5 flex justify-between text-xs text-muted-foreground"><span>brake</span><span>gas</span></div>
          <p className="mt-2 text-sm"><span className="num font-semibold">{sign(out)}</span>: {Math.abs(out) < 0.05 ? 'coasting, neither pedal' : out > 0 ? `${Math.round(out * 100)} % gas` : `${Math.round(-out * 100)} % brake`}</p>
        </div>
      </div>
    </div>
  );
}

// ---------- evolution, in two weights ----------
// The sim's training, the same steps (scripts/patches/autopilot.py: aiTick's generation): pairs of noisy copies (+e and −e),
// each scored, the scores turned into ranks (−0.5 .. 0.5), and the weights moved toward the noise of the better copies.
// Here a copy's "metres before it leaves the road" is a made-up hill with its top at TOP, and a smaller one to get stuck on.
const PAIRS = 8, SIGMA = 0.45, STEP = 0.3, SPAN = 3;
const TOP = [1.7, -1.3], DECOY = [-1.6, 1.5];
const metres = (a: number, b: number) =>
  Math.round(900 * Math.exp(-((a - TOP[0]) ** 2 + (b - TOP[1]) ** 2) / 3.2) + 260 * Math.exp(-((a - DECOY[0]) ** 2 + (b - DECOY[1]) ** 2) / 0.9) + 20);
function rng(seed: number) {
  let s = seed >>> 0;
  const u = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return () => { let a = 0; while (!a) a = u(); return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * u()); };
}
interface Copy { a: number; b: number; m: number }
interface Gen { w: [number, number]; m: number; copies: Copy[]; trail: [number, number][]; n: number }
const START: [number, number] = [-0.4, -2.2];

function generation(g: Gen, gauss: () => number): Gen {
  const eps: [number, number][] = Array.from({ length: PAIRS }, () => [gauss(), gauss()]);
  const copies: Copy[] = eps.flatMap(([ea, eb]) => [1, -1].map(sg => {
    const a = g.w[0] + sg * SIGMA * ea, b = g.w[1] + sg * SIGMA * eb;
    return { a, b, m: metres(a, b) };
  }));
  const order = copies.map((c, i) => i).sort((i, j) => copies[i].m - copies[j].m), rank = new Array<number>(copies.length);
  order.forEach((i, r) => { rank[i] = r / (copies.length - 1) - 0.5; });
  let ga = 0, gb = 0;
  eps.forEach(([ea, eb], p) => { const d = rank[2 * p] - rank[2 * p + 1]; ga += d * ea; gb += d * eb; });
  const k = STEP / (PAIRS * SIGMA) * 2;
  const clampW = (v: number) => Math.max(-SPAN, Math.min(SPAN, v));
  const w: [number, number] = [clampW(g.w[0] + k * ga), clampW(g.w[1] + k * gb)];
  return { w, m: metres(w[0], w[1]), copies, trail: [...g.trail, g.w], n: g.n + 1 };
}

export function EvolutionDemo() {
  const [seed, setSeed] = useState(7);
  const gauss = useRef(rng(seed));
  const [gen, setGen] = useState<Gen>(() => ({ w: START, m: metres(...START), copies: [], trail: [], n: 0 }));
  const [running, setRunning] = useState(false);
  const best = metres(TOP[0], TOP[1]);
  useEffect(() => {
    if (!running) return;
    if (gen.n >= 60) { setRunning(false); return; }
    const t = setTimeout(() => setGen(g => generation(g, gauss.current)), 650);
    return () => clearTimeout(t);
  }, [running, gen.n]);
  const restart = () => {
    const s = seed + 1, r = rng(s);
    const c = (v: number) => Math.max(-2.6, Math.min(2.6, v)), st: [number, number] = [c(r() * 1.4), c(r() * 1.4)];
    setSeed(s); gauss.current = r; setRunning(false);
    setGen({ w: st, m: metres(...st), copies: [], trail: [], n: 0 });
  };

  // the map: 24 × 24 cells shaded by the metres a copy there would drive
  const S = 300, N = 24, px = (v: number) => ((v + SPAN) / (2 * SPAN)) * S, py = (v: number) => S - ((v + SPAN) / (2 * SPAN)) * S;
  const cells = useMemo(() => {
    const out: { x: number; y: number; o: number }[] = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = -SPAN + (i + 0.5) * (2 * SPAN / N), b = SPAN - (j + 0.5) * (2 * SPAN / N);
      out.push({ x: i * S / N, y: j * S / N, o: metres(a, b) / 940 });
    }
    return out;
  }, []);
  const ranked = [...gen.copies].sort((p, q) => q.m - p.m);
  const goodCut = ranked[Math.floor(ranked.length / 2) - 1]?.m ?? Infinity;

  return (
    <div className="panel grid gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
      <figure>
        <svg viewBox={`0 0 ${S} ${S}`} className="w-full rounded-lg" role="img"
          aria-label={`A map of two weights: brighter is further driven. Generation ${gen.n}, the weights are at ${gen.w[0].toFixed(2)}, ${gen.w[1].toFixed(2)} and drive ${gen.m} m.`}>
          <rect width={S} height={S} fill="#06121a" />
          {cells.map((c, i) => <rect key={i} x={c.x} y={c.y} width={S / N + 0.5} height={S / N + 0.5} fill="var(--tnn)" fillOpacity={0.03 + 0.72 * c.o ** 1.4} />)}
          {gen.trail.length > 0 && <polyline points={[...gen.trail, gen.w].map(([a, b]) => `${px(a)},${py(b)}`).join(' ')} fill="none" stroke="#fff" strokeOpacity="0.55" strokeWidth="1.5" strokeDasharray="3 3" />}
          {gen.copies.map((c, i) => (
            <circle key={i} cx={px(c.a)} cy={py(c.b)} r="4" fill={c.m >= goodCut ? POS : NEG} fillOpacity="0.9" stroke="#06121a" strokeWidth="1.5">
              <title>{`A copy: ${c.m} m`}</title>
            </circle>
          ))}
          <circle cx={px(gen.w[0])} cy={py(gen.w[1])} r="7" fill="none" stroke="#fff" strokeWidth="2.5" />
          <text x={6} y={S - 6} fontSize="10" fill="#fff" fillOpacity="0.6" fontFamily="var(--font-mono)">weight 1 →</text>
          <text x={6} y={14} fontSize="10" fill="#fff" fillOpacity="0.6" fontFamily="var(--font-mono)">↑ weight 2</text>
        </svg>
        <figcaption className="mt-2 text-xs text-muted-foreground">
          Brighter ground: weights that drive further. White ring: the driver now. Dots: this generation’s 16 copies,{' '}
          <span style={{ color: POS }}>orange</span> the better half, <span style={{ color: NEG }}>blue</span> the worse.
        </figcaption>
      </figure>
      <div className="flex flex-col">
        <p className="eyebrow text-tnn">Try it: evolution with two weights</p>
        <p className="mt-2 text-sm text-pretty text-muted-foreground">
          A real driver has 16 weights or more, too many to draw. Here is the same method with only two, so it fits on a map. The driver
          can’t see the map. All it ever learns is how far each of its copies got.
        </p>
        <dl className="mt-5 grid grid-cols-3 gap-3 text-sm">
          <div className="rounded-xl border border-white/8 bg-black/25 p-3"><dt className="eyebrow text-[0.6rem] text-muted-foreground/80">Generation</dt><dd className="num mt-1 text-xl font-semibold">{gen.n}</dd></div>
          <div className="rounded-xl border border-white/8 bg-black/25 p-3"><dt className="eyebrow text-[0.6rem] text-muted-foreground/80">Drives</dt><dd className="num mt-1 text-xl font-semibold">{gen.m} m</dd></div>
          <div className="rounded-xl border border-white/8 bg-black/25 p-3"><dt className="eyebrow text-[0.6rem] text-muted-foreground/80">Of the best</dt><dd className="num mt-1 text-xl font-semibold">{Math.round((gen.m / best) * 100)} %</dd></div>
        </dl>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="tnn" size="lg" className="px-3.5" onClick={() => setGen(g => generation(g, gauss.current))} disabled={running}><StepForward /> Next generation</Button>
          <Button variant="glass" size="lg" className="px-3.5" onClick={() => setRunning(r => !r)}>{running ? <><Pause /> Pause</> : <><Play /> Run</>}</Button>
          <Button variant="ghost" size="lg" className="px-3.5" onClick={restart}><RotateCcw /> Start somewhere else</Button>
        </div>
        <ol className="mt-5 space-y-2 text-sm text-pretty text-muted-foreground">
          <li><span className="num text-foreground">1.</span> Make 8 random nudges to the weights, and try each one both ways (plus and minus): 16 copies.</li>
          <li><span className="num text-foreground">2.</span> Let every copy drive, and score it by how far it got.</li>
          <li><span className="num text-foreground">3.</span> Rank them, best to worst, and move the weights toward the nudges that did better and away from those that did worse.</li>
        </ol>
        <p className="mt-4 text-xs text-pretty text-muted-foreground">
          Press Start somewhere else a few times: it can get stuck on the small hill at the top left, a “good enough” driver that is not the best one.
          Real trainings get stuck like that too, which is why two trainings of the same network can end differently.
        </p>
      </div>
    </div>
  );
}
