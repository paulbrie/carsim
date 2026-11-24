/** A lap time: 68.35 → "1:08.350" (as the sim's timer writes it). */
export function fmtLap(t: number | null | undefined) {
  if (t == null || !Number.isFinite(t)) return '–:––.–––';
  const ms = Math.round(t * 1000), m = Math.floor(ms / 60000), s = Math.floor(ms % 60000 / 1000), r = ms % 1000;
  return `${m}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`;
}
/** A gap between two laps: -0.08 → "−0.080 s". */
export const fmtGap = (d: number) => `${d < 0 ? '−' : '+'}${Math.abs(d).toFixed(3)} s`;
/** A length: 1576 → "1.6 km", 767 → "770 m". */
export const fmtLength = (m: number) => m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`;
/** A name for a public page: in full for who is signed in, "Paul B." for a visitor. */
export function publicName(name: string, full: boolean) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (full || parts.length < 2) return name.trim() || 'Driver';
  return `${parts[0]} ${parts.at(-1)![0]!.toUpperCase()}.`;
}
/** How long ago, roughly: "3 hours ago", "2 days ago", then the date. */
export const ago = (t: number, now = Date.now()) => {
  const h = Math.max(0, now - t) / 3_600_000, n = (x: number, u: string) => `${x} ${u}${x === 1 ? '' : 's'} ago`;
  return h < 1 ? 'just now' : h < 24 ? n(Math.floor(h), 'hour') : h < 24 * 30 ? n(Math.floor(h / 24), 'day') : new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};
