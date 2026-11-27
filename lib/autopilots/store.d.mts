export const AUTOPILOT_SIZES: number[];
export const AUTOPILOT_LIMITS: { nameMax: number; weightsMax: number; inputsMax: number; histMax: number; perOwner: number; bytesMax: number; pastMax: number; pastHistMax: number };
/** a circuit a network was trained on before the one it was saved on (#351) */
export interface AutopilotStint { course: string; track: string | null; ground: string; vehicle: string; vehicleName: string; from: number; to: number; bestLap: number | null }
export class AutopilotError extends Error { status: number; constructor(status: number, message: string) }
export interface AutopilotSummary {
  id: string; name: string; owner: string; ownerName: string; savedAt: number; vehicle: string; vehicleName: string; course: string; ground: string;
  h: number; inputs: string[]; handbrake: boolean; keyPedals: boolean; keySteering: boolean; weights: number; gen: number; bestLap: number | null; bestFit: number;
  track: string | null; past: AutopilotStint[];
  /** its best lap was timed by the server (an agent's network) */
  timed: boolean;
}
/** the server's timing of a network (lib/agents/exam.mjs) */
export interface AutopilotExam { time: number; laps: { time: number | null; valid: boolean }[]; why?: string; build?: string }
export function cleanTraining(t: unknown): Record<string, unknown>;
export class AutopilotStore {
  constructor(db: unknown, opts?: { now?: () => number });
  get(id: unknown): Promise<(AutopilotSummary & Record<string, unknown>) | null>;
  list(): Promise<AutopilotSummary[]>;
  listBy(owner: string): Promise<AutopilotSummary[]>;
  room(owner: string): Promise<void>;
  create(o: { name: unknown; training: unknown; owner: string; ownerName?: string | null; exam?: AutopilotExam | null }): Promise<AutopilotSummary>;
  delete(id: string, o: { owner: string; admin?: boolean }): Promise<void>;
}
export function autopilotStore(): AutopilotStore;
