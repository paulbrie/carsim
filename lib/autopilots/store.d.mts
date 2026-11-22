export const AUTOPILOT_LIMITS: { nameMax: number; weightsMax: number; inputsMax: number; histMax: number; perOwner: number; bytesMax: number };
export class AutopilotError extends Error { status: number; constructor(status: number, message: string) }
export interface AutopilotSummary {
  id: string; name: string; owner: string; ownerName: string; savedAt: number; vehicle: string; vehicleName: string; course: string; ground: string;
  h: number; inputs: string[]; handbrake: boolean; keyPedals: boolean; keySteering: boolean; weights: number; gen: number; bestLap: number | null; bestFit: number;
}
export function cleanTraining(t: unknown): Record<string, unknown>;
export class AutopilotStore {
  constructor(dir: string, opts?: { now?: () => number });
  get(id: unknown): (AutopilotSummary & Record<string, unknown>) | null;
  list(): AutopilotSummary[];
  create(o: { name: unknown; training: unknown; owner: string; ownerName?: string | null }): AutopilotSummary;
  delete(id: string, o: { owner: string; admin?: boolean }): void;
}
export function autopilotStore(): AutopilotStore;
