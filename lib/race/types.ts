// Shapes of the race server's messages (lib/race/hub.mjs), for the client.

export type Phase = 'lobby' | 'countdown' | 'racing' | 'results';

/** admin: the super admin, who moderates the chat */
export interface Me { id: string; name: string; image: string | null; admin?: boolean }

/** the chat (#325): the main room, everyone connected; a race room's, its drivers */
export type ChatChannel = 'main' | 'room';
/** a chat message: uid, name, image: who wrote it; at: when (ms) */
export interface ChatMsg { id: string; at: number; uid: string; name: string; image: string | null; text: string }
/** a driver the super admin muted, until (ms) */
export interface ChatMute { id: string; name: string; until: number; by: string }

export interface RoomSummary {
  id: string; name: string; host: string; players: number; max: number; phase: Phase; ground: string; laps: number; map: string;
}

/** a room's map: v changes with every save of it (lib/maps/store.mjs) */
export interface MapRef { id: string; name: string; v: number }

export interface LapTime { time: number; valid: boolean }

export interface PlayerView {
  id: string; name: string; image: string | null; vehicle: string; paint: string | null; ready: boolean; slot: number;
  spectator: boolean; lap: number; laps: (LapTime | null)[]; finish: number | null; missed: number; dnf: boolean; connected: boolean;
}

export interface Standing {
  id: string; name: string; image: string | null; vehicle: string; paint: string | null; pos: number; lap: number; prog: number;
  finish: number | null; missed: number; total: number | null; dnf: boolean; left: boolean; gap: number | null; gapUnit: 's' | 'm' | null;
}

export interface RoomView {
  id: string; name: string; hostId: string; ground: string; weather: string; laps: number; map: MapRef; phase: Phase; race: number;
  startsIn: number | null; elapsed: number | null; finishWindowLeft: number | null;
  players: PlayerView[]; standings: Standing[] | null; results: Standing[] | null;
}

/** a driver's best lap with a car on a map and ground (lib/race/records.mjs); splits only if set on this version of the map */
export interface BestLap { id: string; name: string; image: string | null; vehicle: string; time: number; splits: (number | null)[]; mv: number; at: number; ghost?: boolean; net?: NetMark }
/** a network drove it (#333): the saved network's id (null: not saved), its name, who made it, its size */
export interface NetMark { autopilot: string | null; name: string; creator: string; weights: number; h: number }

/** a best lap's path, to race against (#310): trace as lib/race/records.mjs GHOST describes it, null if there is none */
export interface GhostLap { map: string; v: number; ground: string; vehicle: string; id: string; name: string; time: number | null; trace: string | null }

/** the room's map (version v) and ground's best laps, fastest first */
export interface Records { map: string; v: number; ground: string; list: BestLap[] }

/** a hit a car took, in its body space: [cx, cy, cz, dx, dy, dz, speed m/s, kind 0 post | 1 ball | 2 wall] (the sim's carHit) */
export type CarHit = [number, number, number, number, number, number, number, number];
/** one car in a 'snap': id, x, y, z, qx, qy, qz, qw, speed, steer, wheel spin, skid marks (4 bits a wheel, 0-15: how dark),
 *  when (ms on the sender's own clock, #345; 0: its sim didn't say) */
export type CarSnap = [string, number, number, number, number, number, number, number, number, number, number, number, number];

export type ServerMsg =
  | { t: 'hello'; me: Me; limits: Record<string, number> }
  | { t: 'rooms'; rooms: RoomSummary[] }
  | { t: 'room'; room: RoomView }
  | { t: 'snap'; cars: CarSnap[] }
  | { t: 'hit'; id: string; h: CarHit }
  | { t: 'repair'; id: string }
  | { t: 'hits'; all: Record<string, CarHit[]> }
  | ({ t: 'records' } & Records)
  | ({ t: 'ghost' } & GhostLap)
  | { t: 'standings'; standings: Standing[]; elapsed: number; finishWindowLeft: number | null }
  | { t: 'gone'; id: string }
  | { t: 'chat'; ch: ChatChannel; all?: boolean; msgs: ChatMsg[] }
  | { t: 'chatDel'; ch: ChatChannel; id: string }
  | { t: 'chatMutes'; list: ChatMute[] }
  | { t: 'left' }
  | { t: 'replaced' }
  | { t: 'pong'; c: number; s: number }
  | { t: 'error'; code: string; msg: string };
