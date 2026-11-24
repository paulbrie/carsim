export type Ground = 'road' | 'earth' | 'sand';
export interface Track { id: string; name: string; v: number; key: string; wp: [number, number][]; bridges: number; length: number }
export interface Network {
  id: string; name: string; ownerName: string; savedAt: number; vehicle: string; course: string; ground: string; track: string | null;
  h: number; inputs: string[]; handbrake: boolean; noBrake: boolean; keyPedals: boolean; keySteering: boolean;
  weights: number; gen: number; bestLap: number | null; w: number[] | null;
}
export interface HumanLap { id: string; name: string; image: string | null; time: number; at: number }
/** A network's best lap: its exam lap (room: false) or one it drove in a race room (#333). saved: id is a saved network's. */
export interface NetworkLap { id: string; name: string; ownerName: string; time: number; weights: number; h: number; gen: number | null; saved: boolean; room: boolean }
export interface BoardRow { vehicle: string; human: HumanLap | null; tnn: NetworkLap | null }
export interface Duel { vehicle: string; human: HumanLap; tnn: NetworkLap; gap: number }
export interface Board {
  track: string; ground: Ground; rows: BoardRow[];
  human: (HumanLap & { vehicle: string }) | null; tnn: (NetworkLap & { vehicle: string }) | null; duels: Duel[];
}
export interface Scoreboard { tracks: Track[]; boards: Board[]; networks: Network[]; at: number }
export const DEFAULT_TRACK: { id: string; name: string };
export function courseKey(course: unknown): string;
export function courseLength(wp: [number, number][]): number;
export class Showcase {
  constructor(db: unknown, opts?: { now?: () => number; ttlMs?: number });
  tracks(): Promise<Track[]>;
  networks(opts?: { weights?: boolean }): Promise<Network[]>;
  board(): Promise<Scoreboard>;
}
export function showcase(): Showcase;
