import { cn } from '@/lib/utils';
import { netLinks, netShape, type NetShape } from '@/lib/tnn';

const POS = '#ff8a3d', NEG = '#4aa8ff';   // the sim's own: orange pulls + (left, gas), blue − (right, brake)

/**
 * A network drawn whole: every input, every output, and a line for every weight, thicker and brighter the more it
 * pulls. With a hidden layer, its units in a column between. Without weights (or weights of another shape), the
 * wiring alone.
 */
export function NetDiagram({ net, className, labels = true, pulse = false, title }: {
  net: { inputs: string[]; handbrake: boolean; h: number; w?: number[] | null }; className?: string; labels?: boolean; pulse?: boolean; title?: string;
}) {
  const shape = netShape(net), links = netLinks(shape, net.w ?? null);
  const I = shape.inputs.length, O = shape.outputs.length, H = shape.hidden;
  const row = labels ? 22 : 14, top = 12, height = top * 2 + Math.max(I, O * 2, Math.min(H, 16)) * row - (row - 8);
  const lx = labels ? 96 : 10, rx = labels ? 264 : 110, width = labels ? 360 : 120, mx = (lx + rx) / 2;
  const y = (i: number, n: number) => n === 1 ? height / 2 : top + 4 + i * (height - 2 * top - 8) / (n - 1);
  const yOut = (k: number) => height / 2 + (k - (O - 1) / 2) * Math.min(row * 3, (height - 2 * top) / Math.max(1, O));
  const line = (x1: number, y1: number, x2: number, y2: number, v: number, max: number, key: string) => {
    const a = Math.min(1, Math.abs(v) / max);
    return <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} stroke={v >= 0 ? POS : NEG} strokeWidth={labels ? 0.4 + 2.6 * a : 0.3 + 1.5 * a} strokeOpacity={0.12 + 0.8 * a} strokeLinecap="round"
      className={pulse && a > 0.45 ? 'net-pulse' : undefined} />;
  };
  const wires: React.ReactNode[] = [];
  if (links?.io) links.io.forEach((ws, k) => ws.forEach((v, i) => wires.push(line(lx, y(i, I), rx, yOut(k), v, links.max, `${k}-${i}`))));
  else if (links?.ih && links.ho) {
    links.ih.forEach((ws, j) => ws.forEach((v, i) => wires.push(line(lx, y(i, I), mx, y(j, H), v, links.max, `h${j}-${i}`))));
    links.ho.forEach((ws, j) => ws.forEach((v, k) => wires.push(line(mx, y(j, H), rx, yOut(k), v, links.max, `o${j}-${k}`))));
  } else if (!H) for (let k = 0; k < O; k++) for (let i = 0; i < I; i++) wires.push(<line key={`${k}-${i}`} x1={lx} y1={y(i, I)} x2={rx} y2={yOut(k)} stroke="currentColor" strokeOpacity="0.14" strokeWidth="0.6" />);
  else for (let j = 0; j < H; j++) {
    for (let i = 0; i < I; i++) wires.push(<line key={`h${j}-${i}`} x1={lx} y1={y(i, I)} x2={mx} y2={y(j, H)} stroke="currentColor" strokeOpacity="0.08" strokeWidth="0.5" />);
    for (let k = 0; k < O; k++) wires.push(<line key={`o${j}-${k}`} x1={mx} y1={y(j, H)} x2={rx} y2={yOut(k)} stroke="currentColor" strokeOpacity="0.08" strokeWidth="0.5" />);
  }
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={cn('w-full', className)} role="img" aria-label={title ?? describe(shape)}>
      {wires}
      {shape.inputs.map((name, i) => (
        <g key={name + i}>
          <circle cx={lx} cy={y(i, I)} r={labels ? 3.4 : 2.2} fill="var(--background)" stroke="currentColor" strokeOpacity="0.7" strokeWidth="1.1" />
          {labels && <text x={lx - 10} y={y(i, I) + 3.5} textAnchor="end" fontSize="10" className="fill-muted-foreground" fontFamily="var(--font-mono)">{name}</text>}
        </g>
      ))}
      {Array.from({ length: H }, (_, j) => <circle key={j} cx={mx} cy={y(j, H)} r={H > 24 ? 1.4 : 2.6} fill="var(--background)" stroke="currentColor" strokeOpacity="0.6" strokeWidth="1" />)}
      {shape.outputs.map((name, k) => (
        <g key={name}>
          <circle cx={rx} cy={yOut(k)} r={labels ? 5 : 3} fill="var(--tnn)" />
          {labels && <text x={rx + 12} y={yOut(k) + 4} fontSize="11.5" fontWeight="600" className="fill-foreground" fontFamily="var(--font-mono)">{name}</text>}
        </g>
      ))}
    </svg>
  );
}

const describe = (s: NetShape) => `A neural network: ${s.inputs.length} inputs (${s.inputs.join(', ')})${s.hidden ? `, ${s.hidden} hidden units` : ''}, ${s.outputs.length} outputs (${s.outputs.join(', ')}), ${s.weights} weights.`;

/** Every weight of a network, written out: the whole driver. */
export function WeightGrid({ w, className, max = 64 }: { w: number[]; className?: string; max?: number }) {
  const top = Math.max(1e-9, ...w.map(Math.abs)), shown = w.slice(0, max);
  return (
    <div className={cn('num flex flex-wrap gap-x-2.5 gap-y-1 text-[11px] leading-4', className)} aria-label={`Its ${w.length} weights`}>
      {shown.map((v, i) => <span key={i} style={{ color: v >= 0 ? POS : NEG, opacity: 0.45 + 0.55 * Math.abs(v) / top }}>{v >= 0 ? '+' : '−'}{Math.abs(v).toFixed(2)}</span>)}
      {w.length > max && <span className="text-muted-foreground">+{w.length - max} more</span>}
    </div>
  );
}
