import type { ArmKey, ArmNet, TaskArg } from './core.mjs';
export const ARM_NET_LIMITS: { nameMax: number; perOwner: number; bytesMax: number; list: number };
export class ArmNetError extends Error { status: number; constructor(status: number, message: string) }
export interface ArmExam { done: number; of: number; time: number }
/** A saved arm network without its weights. */
export interface ArmNetSummary { id: string; name: string; owner: string; ownerName: string; savedAt: number; arm: ArmKey; /** a key of TASKS, or custom:<its scenario's key> (#365) */ task: string; weights: number; h: number; control: 'hand' | 'joints'; exam: ArmExam | null }
export function cleanNet(d: unknown): ArmNet;
export function cleanExam(e: unknown, task: TaskArg): ArmExam | null;
export class ArmNetStore {
  constructor(db: unknown, opts?: { now?: () => number });
  get(id: string): Promise<(ArmNetSummary & { net: ArmNet }) | null>;
  list(o?: { arm?: string; task?: string; owner?: string }): Promise<ArmNetSummary[]>;
  create(o: { name: unknown; net: unknown; exam?: unknown; owner: string; ownerName?: string | null }): Promise<ArmNetSummary>;
  delete(id: string, o: { owner: string; admin?: boolean }): Promise<void>;
}
export function armNetStore(): ArmNetStore;
