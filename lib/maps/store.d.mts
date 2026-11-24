export const DEFAULT_MAP_ID: 'figure-8';
export const DEFAULT_MAP_NAME: string;
export const MAP_LIMITS: { nameMax: number; wpMin: number; wpMax: number; opsMax: number; bridgesMax: number; bankMax: number; worldMax: number; bytesMax: number };

export interface TerrainOp { t: 'raise' | 'lower' | 'flatten' | 'smooth' | 'sand' | 'earth' | 'road' | 'erase'; x: number; z: number; r: number; s?: number; h?: number; v?: number }
export interface Course { wp: [number, number][]; bank: number; level: number; even: [number, number][]; grade: number; ops: TerrainOp[]; base: 'sand' | 'earth'; road: boolean; bridges: { x: number; z: number }[]; noBridge: { x: number; z: number }[] }
export interface RaceMap { id: string; name: string; course: Course | null; createdAt: number; updatedAt: number; updatedBy: string | null; builtin: boolean }
export interface MapSummary { id: string; name: string; builtin: boolean; createdAt: number; updatedAt: number; updatedBy: string | null; waypoints: number; strokes: number; bank: number; bridges: number }
export interface MapInfo { id: string; name: string; v: number }

export class MapError extends Error { status: number; constructor(status: number, message: string) }
export function cleanName(name: unknown): string;
export function cleanCourse(c: unknown): Course;

export class MapStore {
  constructor(db: unknown, opts?: { now?: () => number });
  get(id: string): Promise<RaceMap | null>;
  info(id: unknown): Promise<MapInfo | null>;
  infos(): Promise<MapInfo[]>;
  list(): Promise<MapSummary[]>;
  create(o: { name: unknown; from?: string | null; course?: unknown; by?: string | null }): Promise<RaceMap>;
  update(id: string, o: { name?: unknown; course?: unknown; by?: string | null }): Promise<RaceMap>;
  delete(id: string): Promise<void>;
}
export const MAPS_CHANNEL: string;
export function mapStore(): MapStore;
