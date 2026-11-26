// The networks page's list (app/networks/page.tsx): one card per network, whatever it was saved as, and the fastest of each car on each track.

/** A name the lab gives a save when the maker typed none ("X7 · 194 weights · gen 1802 · lap 0:45.970"). */
const AUTO_NAME = /· \d+ weights · gen \d+/;

/** What drives: same car, course, size, inputs and weights. The name and the owner don't count. Null when the weights aren't there. */
export const driving = n => n.w ? [n.vehicle, n.course, n.h, n.inputs.join(','), n.handbrake ? 1 : 0, n.w.join(',')].join('|') : null;

/** The track a network is filed under: its map when it is one's, else its course's key. */
export const trackOf = n => n.track ?? n.course;

/**
 * The same network saved twice shows once: the one with a name of its own, else the newest; `also` lists the other saves.
 * `fastest` is the one of a car and track (and ground) with the best lap: one per pair, not one per car.
 * @template {{ id: string, name: string, savedAt: number, vehicle: string, course: string, track: string | null, ground: string, bestLap: number | null, w: number[] | null, h: number, inputs: string[], handbrake: boolean }} N
 * @param {N[]} nets
 * @returns {(N & { also: { id: string, name: string, savedAt: number }[], fastest: boolean })[]}
 */
export function netList(nets) {
  const kept = new Map(), out = [];
  const named = m => !AUTO_NAME.test(m.name);
  for (const n of nets) {
    const k = driving(n), at = k && kept.get(k);
    if (!at) { const e = { ...n, also: [], fastest: false }; out.push(e); if (k) kept.set(k, e); continue; }
    const better = named(n) !== named(at) ? named(n) : n.savedAt > at.savedAt;
    const old = { id: at.id, name: at.name, savedAt: at.savedAt };
    if (better) Object.assign(at, n, { also: [...at.also, old] }); else at.also.push({ id: n.id, name: n.name, savedAt: n.savedAt });
  }
  const best = new Map();
  for (const e of out) {
    if (e.bestLap == null) continue;
    const k = [e.vehicle, trackOf(e), e.ground].join('|'), b = best.get(k);
    if (!b || e.bestLap < b.bestLap) best.set(k, e);
  }
  for (const e of best.values()) e.fastest = true;
  return out.sort((a, b) => b.savedAt - a.savedAt);
}
