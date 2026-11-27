import type { ArmNet, Exam, Go, Placement, TaskKey } from './core.mjs';
export const ES: { pop: number; sigma: number; lr: number; fine: number; fineSigma: number; back: number; places: number; half: number; decay: number };
export type Head = Omit<ArmNet, 'w'>;
export type Evaluate = (head: Head, goes: { w: number[]; at: Placement }[]) => Promise<Go[]>;
export interface Training { net: ArmNet; seed: number; gen: number; best: { w: number[]; exam: Exam; gen: number } | null; hist: [number, number, number, number][]; grabbed: boolean; fine: boolean; since: number }
export function grow(from: ArmNet, o?: { task?: TaskKey; h?: number }): ArmNet;
export function startTraining(o?: { task?: TaskKey; h?: number; control?: 'hand' | 'joints'; roll?: boolean; seed?: number; from?: ArmNet | null; anew?: boolean }): Training;
export function shareOut(n: number, run: (i: number, head: Head, goes: { w: number[]; at: Placement }[]) => Promise<Go[]>, chunk?: number): Evaluate;
export function runGoes(M: unknown, head: Head, goes: { w: number[]; at: Placement }[]): Go[];
export function examBy(evaluate: Evaluate, net: ArmNet): Promise<Exam>;
export function better(a: Exam, b?: Exam | null): boolean;
export function generation(tr: Training, evaluate: Evaluate): Promise<Exam & { skipped?: boolean }>;
export function trained(tr: Training, name?: string): ArmNet;
