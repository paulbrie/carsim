'use client';
// An arm network drawn whole (#359): every number it is shown, every hidden unit, every output, and a line for every
// weight. Live when `live` is given: a neuron fills with what it holds now, and a line brightens with what flows
// through it (its weight times what its source holds). Colours as the cars' diagram (components/net-diagram.tsx):
// orange pulls up (+), blue pulls down (−).
import { useMemo } from 'react';
import { names, shape } from '@/lib/arm/core.mjs';
import type { ArmNet } from '@/lib/arm/core.mjs';

const POS = '#ff8a3d', NEG = '#4aa8ff';
export interface NetLive { x: number[]; h: number[]; y: number[] }

/** What an output's value means for the arm, in words. */
function says(name: string, v: number) {
  const a = Math.abs(v), how = a < 0.08 ? '' : a < 0.5 ? 'slowly ' : '';
  if (name === 'grip') return v > 0 ? 'shut' : 'open';
  if (a < 0.08) return 'still';
  const dir: Record<string, [string, string]> = { out: ['outwards', 'inwards'], up: ['up', 'down'], side: ['left', 'right'], base: ['turns left', 'turns right'], shoulder: ['lifts', 'lowers'], elbow: ['folds', 'opens'], turn: ['turns left', 'turns right'] };
  return how + (dir[name]?.[v > 0 ? 0 : 1] ?? '');
}

export function ArmNetDiagram({ net, live, className }: { net: ArmNet; live: NetLive | null; className?: string }) {
  const sh = shape(net), nm = useMemo(() => names(net), [net]);
  const I = sh.nin, H = sh.h, O = sh.nout;
  const W = 720, row = 30, top = 22, height = top * 2 + (Math.max(I, O, Math.min(H, 14)) - 1) * row;
  const xi = 150, xh = 360, xo = 570;
  const y = (i: number, n: number, gap = row) => { const g = n > 1 ? Math.min(gap, (height - 2 * top) / (n - 1)) : 0; return height / 2 + (i - (n - 1) / 2) * g; };
  // the weights, cut as forward() reads them: W1 (a row of inputs per unit), b1, W2 (a row of outputs per unit), b2
  const links = useMemo(() => {
    const w = net.w, out: { a: number; b: number; v: number; layer: 0 | 1 }[] = [];
    if (!H) { for (let o = 0; o < O; o++) for (let i = 0; i < I; i++) out.push({ a: i, b: o, v: w[o * I + i], layer: 0 }); }
    else {
      for (let j = 0; j < H; j++) for (let i = 0; i < I; i++) out.push({ a: i, b: j, v: w[j * I + i], layer: 0 });
      const base = I * H + H;
      for (let j = 0; j < H; j++) for (let o = 0; o < O; o++) out.push({ a: j, b: o, v: w[base + j * O + o], layer: 1 });
    }
    return { out, max: Math.max(1e-9, ...out.map(l => Math.abs(l.v))) };
  }, [net, I, H, O]);

  const hold = (layer: 0 | 1, a: number) => !live ? 1 : Math.min(1, Math.abs(layer === 0 ? live.x[a] ?? 0 : live.h[a] ?? 0));
  const fill = (v: number | undefined) => v == null ? { fill: 'var(--background)', fillOpacity: 1 } : { fill: v >= 0 ? POS : NEG, fillOpacity: 0.12 + 0.88 * Math.min(1, Math.abs(v)) };
  const num = (v: number | undefined) => v == null ? '' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`;
  const label = `A neural network: ${I} inputs (${nm.inputs.join(', ')})${H ? `, ${H} hidden units` : ''}, ${O} outputs (${nm.outputs.join(', ')}), ${net.w.length} weights.`;

  return (
    <svg viewBox={`0 0 ${W} ${height}`} className={className} role="img" aria-label={label}>
      {links.out.map((l, k) => {
        const s = Math.abs(l.v) / links.max, flow = s * (0.2 + 0.8 * hold(l.layer, l.a));
        const x1 = l.layer === 0 ? xi : xh, x2 = l.layer === 0 ? (H ? xh : xo) : xo;
        const y1 = l.layer === 0 ? y(l.a, I) : y(l.a, H, 26), y2 = l.layer === 0 ? (H ? y(l.b, H, 26) : y(l.b, O, row * 1.6)) : y(l.b, O, row * 1.6);
        return <line key={k} x1={x1} y1={y1} x2={x2} y2={y2} stroke={l.v >= 0 ? POS : NEG} strokeWidth={0.4 + 3 * s} strokeOpacity={0.06 + 0.9 * flow} strokeLinecap="round" />;
      })}
      {nm.inputs.map((name, i) => (
        <g key={name}>
          <circle cx={xi} cy={y(i, I)} r="7" fill="var(--background)" />
          <circle cx={xi} cy={y(i, I)} r="7" {...fill(live?.x[i])} stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.2" />
          <text x={xi - 16} y={y(i, I) - 1} textAnchor="end" fontSize="12" className="fill-foreground" fontFamily="var(--font-mono)">{name}</text>
          <text x={xi - 16} y={y(i, I) + 11} textAnchor="end" fontSize="10" className="fill-muted-foreground" fontFamily="var(--font-mono)">{num(live?.x[i])}</text>
        </g>
      ))}
      {Array.from({ length: H }, (_, j) => (
        <g key={j}>
          <circle cx={xh} cy={y(j, H, 26)} r={H > 16 ? 4 : 6.5} fill="var(--background)" />
          <circle cx={xh} cy={y(j, H, 26)} r={H > 16 ? 4 : 6.5} {...fill(live?.h[j])} stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.1" />
        </g>
      ))}
      {nm.outputs.map((name, o) => (
        <g key={name}>
          <circle cx={xo} cy={y(o, O, row * 1.6)} r="9" fill="var(--background)" />
          <circle cx={xo} cy={y(o, O, row * 1.6)} r="9" {...fill(live?.y[o])} stroke="var(--tnn)" strokeWidth="1.6" />
          <text x={xo + 18} y={y(o, O, row * 1.6) - 1} fontSize="13" fontWeight="600" className="fill-foreground" fontFamily="var(--font-mono)">{name}</text>
          <text x={xo + 18} y={y(o, O, row * 1.6) + 12} fontSize="10.5" className="fill-muted-foreground" fontFamily="var(--font-mono)">{live ? `${num(live.y[o])} ${says(name, live.y[o])}` : ''}</text>
        </g>
      ))}
      <text x={xi} y="11" textAnchor="middle" fontSize="9.5" letterSpacing="1.2" className="fill-muted-foreground">WHAT IT IS SHOWN</text>
      {H > 0 && <text x={xh} y="11" textAnchor="middle" fontSize="9.5" letterSpacing="1.2" className="fill-muted-foreground">HIDDEN UNITS</text>}
      <text x={xo} y="11" textAnchor="middle" fontSize="9.5" letterSpacing="1.2" className="fill-muted-foreground">WHAT IT DOES</text>
    </svg>
  );
}
