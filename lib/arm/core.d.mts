import type { CompiledScenario, Item, Scenario } from './scenario.mjs';
export type ArmKey = 'desk' | 'b601';
/** An arm (#361): its figures; q, yaw, width, aim, put, pose, body and tail are its own ways of standing and being driven (see core.mjs). */
export interface ArmSpec {
  key: ArmKey; name: string; maker: string | null; about: string; S: number; R0: number; L1: number; L2: number; TL: number; speed: number[]; hand: number;
  lim: Record<'q0' | 'a1' | 'e', [number, number]> & { a2?: [number, number]; roll?: number }; home: number[]; floor: number; gripN: number; gap: [number, number]; nq: number;
  q(qpos: ArrayLike<number>): number[]; yaw(qpos: ArrayLike<number>): number; width(qpos: ArrayLike<number>): number;
}
export const ARMS: Record<ArmKey, ArmSpec>;
export const ARM: ArmSpec;
export const HZ: number; export const STEP: number; export const SUB: number; export const GRIP_N: number;
export const CUBE: number; export const LIFT: number; export const OVER: number;
export const TRAY: { r: number; a: number; half: number };
export const INPUTS: Record<string, { n: number; parts: string[]; name: string; about: string }>;
export type TaskKey = 'grab' | 'tray' | 'stack';
export interface Job { cube: number; lift?: boolean; to?: 'tray' | number; on?: number; slot?: [number, number] }
/** A scenario: a key of TASKS, or one's own (#365): its file or compiled. */
export type TaskArg = TaskKey | Scenario | CompiledScenario;
export interface TaskSpec { name: string; about: string; cubes: number; limit: number; exam: number; jobs: Job[]; inputs: string[]; custom?: true; items?: Item[] }
export const TASKS: Record<TaskKey, { name: string; about: string; cubes: number; limit: number; exam: number; jobs: Job[]; inputs: string[] }>;
export const SIZES: number[];
export interface Placement { cubes: { r: number; a: number; yaw: number }[]; start?: 'cube'; stacked?: number }
export interface ArmNet { kind?: string; name?: string; arm?: ArmKey; task: TaskKey | 'custom'; scenario?: Scenario; control: 'hand' | 'joints'; roll: boolean; inputs: string[]; h: number; w: number[]; generation?: number; generations?: number; exam?: { done: number; of: number; time: number } | null }
/** q: the joints as the drawing turns them (the desk arm: base, shoulder, elbow, roll; wrist and half its own); the B601: j, its six joints, and open, a finger's travel. */
export interface Pose { arm: ArmKey; q: number[]; grip: number[]; yaw: number; wrist?: number; half?: number; j?: number[]; open?: number; shut: boolean; cubes: { p: number[]; q: number[] }[]; now: number; tray: { x: number; z: number } | null; goal: number[] | null; stage: number; of: number; t: number; done: number | null;
  items?: Item[]; trays?: { name: string; hex: number; x: number; z: number; w: number; d: number; turn: number }[]; into?: number | 'tray' | null }
export interface Orders { joints?: number[]; hand?: number[]; world?: number[]; roll?: number; shut?: boolean }
export interface ArmSim {
  task: TaskArg; arm: ArmKey; readonly q: number[]; qt: number[]; t: number; ticks: number; shut: boolean; at: Placement;
  stage: number; still: number; done: number | null; lost: boolean; offNote: number;
  note(): { rise: number; x: number; y: number; free: number };
  jobs: { near: number; d0: number; squeezed: number; lift: number; carry: number; c0: number; z0: number; set: boolean; held?: boolean; fresh: boolean }[];
  gap(): number; job(): Job; observe(inputs: string[]): number[]; act(o?: Orders): void; pose(): Pose; free(): void;
}
export interface Go { ok: boolean; time: number | null; fit: number; stage: number }
export interface Exam { task: TaskKey | 'custom'; done: number; of: number; time: number; mean: number | null; fit: number; goes?: (number | null)[] }
export function dice(seed: number): (() => number) & { gauss(): number };
export function taskOf(t?: TaskArg): TaskSpec;
export function netTask(net: Pick<ArmNet, 'task' | 'scenario'>): TaskKey | Scenario;
export function netKey(net: Pick<ArmNet, 'task' | 'scenario'>): string;
export function taskName(net: Pick<ArmNet, 'task' | 'scenario'>): string;
export function placement(rnd: () => number, task?: TaskArg, turned?: boolean): Placement;
export function sceneXml(cubes?: number, arm?: ArmKey, items?: Item[] | null): string;
export function examPlacements(task?: TaskArg, n?: number): Placement[];
export function reach(q: number[], A?: ArmSpec): { r: number; wrist: number; y: number; x: number; z: number; yaw: number };
export function joints(r: number, y: number, a?: number, A?: ArmSpec): number[];
export function shape(net: Pick<ArmNet, 'inputs' | 'h' | 'roll'>): { nin: number; nout: number; h: number; weights: number };
export function blank(task?: TaskArg, o?: { h?: number; control?: 'hand' | 'joints'; roll?: boolean; inputs?: string[]; arm?: ArmKey }): ArmNet;
export function notNet(d: unknown): string | null;
export function forward(net: ArmNet, x: number[], sh?: ReturnType<typeof shape>): number[];
export function names(net: Pick<ArmNet, 'inputs' | 'control' | 'roll'>): { inputs: string[]; outputs: string[] };
export function layers(net: ArmNet, x: number[], sh?: ReturnType<typeof shape>): { h: number[]; y: number[] };
export function createArm(M: unknown, o?: { at?: Placement; task?: TaskArg; arm?: ArmKey }): ArmSim;
export function orders(net: ArmNet, y: number[]): Orders;
export function attempt(M: unknown, net: ArmNet, at: Placement, o?: { task?: TaskArg; limit?: number; arm?: ArmKey }): Go;
export function exam(M: unknown, net: ArmNet, o?: { task?: TaskArg }): Exam;
