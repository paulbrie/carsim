export const ARM: { S: number; L1: number; L2: number; TL: number; speed: number[]; lag: number; hand: number; lim: Record<'q0' | 'a1' | 'e', [number, number]>; home: number[]; floor: number };
export const HZ: number; export const DT: number; export const SUB: number; export const ITERS: number;
export const CUBE: number; export const LIFT: number;
export const TRAY: { r: number; a: number; half: number };
export const INPUTS: Record<string, { n: number; parts: string[]; name: string; about: string }>;
export type TaskKey = 'grab' | 'tray';
export const TASKS: Record<TaskKey, { name: string; about: string; limit: number; inputs: string[] }>;
export const SIZES: number[];
export interface Placement { r: number; a: number; yaw: number; start?: 'cube' }
export interface ArmNet { kind?: string; name?: string; task: TaskKey; control: 'hand' | 'joints'; roll: boolean; inputs: string[]; h: number; w: number[]; generation?: number; generations?: number; exam?: { done: number; of: number; time: number } | null }
export interface Pose { q: number[]; grip: number[]; yaw: number; wrist: number; half: number; shut: boolean; cube: { p: number[]; q: number[] }; tray: { x: number; z: number } | null; t: number; done: number | null }
export interface Orders { joints?: number[]; hand?: number[]; world?: number[]; roll?: number; shut?: boolean }
export interface ArmSim {
  task: TaskKey; q: number[]; t: number; ticks: number; shut: boolean; at: Placement;
  near: number; lift: number; carry: number; squeezed: number; held: number; done: number | null; lost: boolean; jammed: number;
  gap(): number; observe(inputs: string[]): number[]; act(o?: Orders): void; pose(): Pose; free(): void;
}
export interface Go { ok: boolean; time: number | null; fit: number }
export interface Exam { task: TaskKey; done: number; of: number; time: number; mean: number | null; fit: number; goes?: (number | null)[] }
export function dice(seed: number): (() => number) & { gauss(): number };
export function placement(rnd: () => number, turned?: boolean): Placement;
export function examPlacements(task?: TaskKey, n?: number): Placement[];
export function reach(q: number[]): { r: number; wrist: number; y: number; x: number; z: number; yaw: number };
export function joints(r: number, y: number, a?: number): number[];
export function shape(net: Pick<ArmNet, 'inputs' | 'h' | 'roll'>): { nin: number; nout: number; h: number; weights: number };
export function blank(task?: TaskKey, o?: { h?: number; control?: 'hand' | 'joints'; roll?: boolean; inputs?: string[] }): ArmNet;
export function notNet(d: unknown): string | null;
export function forward(net: ArmNet, x: number[], sh?: ReturnType<typeof shape>): number[];
export function names(net: Pick<ArmNet, 'inputs' | 'control' | 'roll'>): { inputs: string[]; outputs: string[] };
export function layers(net: ArmNet, x: number[], sh?: ReturnType<typeof shape>): { h: number[]; y: number[] };
export function createArm(R: unknown, o?: { at?: Placement; task?: TaskKey; mass?: number; grip?: number }): ArmSim;
export function orders(net: ArmNet, y: number[]): Orders;
export function attempt(R: unknown, net: ArmNet, at: Placement, o?: { task?: TaskKey; limit?: number }): Go;
export function exam(R: unknown, net: ArmNet, o?: { task?: TaskKey }): Exam;
