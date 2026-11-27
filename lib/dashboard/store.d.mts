import type { AutopilotSummary } from '../autopilots/store.mjs';

export const ADMIN_LIMITS: { seenEveryMs: number; runs: number; laps: number; nameMax: number; errorMax: number };

/** provider: google, guest (or unknown for someone known only by what they left); kept: they signed in since #357 (email, sign-ins) */
export interface Person {
  id: string; provider: string; name: string; email: string | null; image: string | null; firstAt: number | null; lastAt: number | null; signIns: number; kept: boolean;
  laps: number; networks: number; chat: number; agents: number;
}
export interface AgentRow {
  id: string; uid: string; name: string; createdAt: number; seenAt: number | null; keyAt: number | null; owner: string | null; ownerName: string | null; claimedAt: number | null;
  networks: number; exams: number; timed: number;
}
export type NetworkRow = AutopilotSummary & { agent: boolean; trackName: string | null };
/** exam: a network an agent sent in; lap: a person's best lap; netLap: a network's best lap */
export interface Run {
  kind: 'exam' | 'lap' | 'netLap'; at: number; who: string; whoId: string; agent: boolean; name: string | null; track: string; trackName: string; ground: string; vehicle: string;
  time: number | null; why?: string | null; seconds?: number | null; error?: string | null; status?: number; ms?: number; autopilot: string | null; build?: string | null;
}
export interface Dashboard {
  at: number;
  counts: { people: number; peopleDay: number; google: number; agents: number; claimed: number; agentsDay: number; networks: number; agentNetworks: number; exams: number; examsTimed: number; examsDay: number };
  people: Person[]; agents: AgentRow[]; networks: NetworkRow[]; runs: Run[];
}
export interface ExamNote {
  agent: string; agentName: string; name: string; track: string; ground: string; vehicle: string; status: number; ms: number;
  exam?: { time?: number | null; why?: string; seconds?: number } | null; error?: string | null; autopilot?: string | null; build?: string | null;
}
export class AdminStore {
  constructor(db: unknown, opts?: { now?: () => number });
  signIn(u: { id: string; provider: string; name?: string | null; email?: string | null; image?: string | null }): Promise<void>;
  seen(u: { id: string; name?: string | null; email?: string | null; image?: string | null }): Promise<void>;
  exam(r: ExamNote): Promise<void>;
  dashboard(): Promise<Dashboard>;
}
export function adminStore(): AdminStore;
export function noteSignIn(u: { id: string; provider: string; name?: string | null; email?: string | null; image?: string | null }): void;
export function noteSeen(u: { id: string; name?: string | null; email?: string | null; image?: string | null }): void;
export function noteExam(r: ExamNote): void;
