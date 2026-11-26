export interface NetLike {
  id: string; name: string; savedAt: number; vehicle: string; course: string; track: string | null; ground: string; bestLap: number | null;
  w: number[] | null; h: number; inputs: string[]; handbrake: boolean;
}
export const driving: (n: NetLike) => string | null;
export const trackOf: (n: { track: string | null; course: string }) => string;
export function netList<N extends NetLike>(nets: N[]): (N & { also: { id: string; name: string; savedAt: number }[]; fastest: boolean })[];
