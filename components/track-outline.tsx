import { cn } from '@/lib/utils';

/**
 * A track drawn from its waypoints, as the sim's minimap shows it (world +x to the left, +z up): a closed curve
 * through them. Returns the path and where the start line is.
 */
export function trackPath(wp: [number, number][], w = 100, h = 100, pad = 8) {
  const pts = wp.map(([x, z]) => [-x, -z] as const);
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const s = Math.min((w - 2 * pad) / Math.max(1, x1 - x0), (h - 2 * pad) / Math.max(1, y1 - y0));
  const ox = (w - (x1 - x0) * s) / 2, oy = (h - (y1 - y0) * s) / 2;
  const P = pts.map(([x, y]) => [ox + (x - x0) * s, oy + (y - y0) * s] as const), n = P.length;
  const f = (v: number) => v.toFixed(1);
  let d = `M${f(P[0]![0])} ${f(P[0]![1])}`;
  for (let i = 0; i < n; i++) {
    const a = P[(i - 1 + n) % n]!, b = P[i]!, c = P[(i + 1) % n]!, e = P[(i + 2) % n]!;
    d += `C${f(b[0] + (c[0] - a[0]) / 6)} ${f(b[1] + (c[1] - a[1]) / 6)} ${f(c[0] - (e[0] - b[0]) / 6)} ${f(c[1] - (e[1] - b[1]) / 6)} ${f(c[0])} ${f(c[1])}`;
  }
  return { d: d + 'Z', start: P[0]!, next: P[1]! };
}

export function TrackOutline({ wp, className, width = 100, height = 100, stroke = 3.2, animate = false, label }: {
  wp: [number, number][]; className?: string; width?: number; height?: number; stroke?: number; animate?: boolean; label?: string;
}) {
  const { d, start, next } = trackPath(wp, width, height, stroke * 2 + 4);
  const a = Math.atan2(next[1] - start[1], next[0] - start[0]) * 180 / Math.PI;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={cn('overflow-visible', className)} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <path d={d} fill="none" stroke="currentColor" strokeOpacity="0.16" strokeWidth={stroke * 2.4} strokeLinejoin="round" />
      <path d={d} fill="none" stroke="currentColor" strokeOpacity="0.85" strokeWidth={stroke * 0.5} strokeLinejoin="round" />
      {animate && (
        <>
          <circle r={stroke * 1.15} fill="var(--human)"><animateMotion dur="9s" repeatCount="indefinite" path={d} /></circle>
          <circle r={stroke * 1.15} fill="var(--tnn)"><animateMotion dur="8.6s" repeatCount="indefinite" path={d} begin="-0.5s" /></circle>
        </>
      )}
      <g transform={`translate(${start[0].toFixed(1)} ${start[1].toFixed(1)}) rotate(${a.toFixed(0)})`}>
        <rect x={-stroke * 0.35} y={-stroke * 1.9} width={stroke * 0.7} height={stroke * 3.8} rx={stroke * 0.2} fill="var(--foreground)" />
      </g>
    </svg>
  );
}
