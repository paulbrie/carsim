export const SCENARIO_KIND: 'armsim-scenario';
export type ColorName = 'red' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'white' | 'black' | 'grey' | 'brown';
export type ShapeKey = 'cube' | 'box' | 'ball' | 'cylinder';
export const PALETTE: Record<ColorName, number>;
export const SHAPES: Record<ShapeKey, { name: string; sizes: string[] }>;
export const SCENARIO_LIMITS: { objects: number; trays: number; size: [number, number]; grip: number; limit: [number, number]; exam: [number, number]; name: number; rules: number; trayAt: { r: [number, number]; a: number }; traySize: [number, number] };
/** One's own scenario (#365), as a file: sizes in cm, angles in degrees. */
export interface ScenarioObject { shape: ShapeKey; size: number[]; color: ColorName; n: number }
export interface ScenarioTray { name: string; color: ColorName; at: [number, number]; size: [number, number] }
export interface Scenario { kind: 'armsim-scenario'; name: string; objects: ScenarioObject[]; trays: ScenarioTray[]; rules: string; limit: number; exam: number }
export interface Item { shape: ShapeKey | 'cube'; color: ColorName | null; hex: number | null; dims: number[]; mass: number; hz: number; foot: number; wide: number; inn: number; innZ: number; touchGap: number; bound: number }
export interface CompiledTray { name: string; color: ColorName; hex: number; x: number; y: number; hx: number; hy: number; c: number; s: number; turn: number }
export interface CompiledScenario {
  key: 'custom'; custom: true; name: string; about: string; cubes: number; limit: number; exam: number;
  jobs: { cube: number; to: number; slot: [number, number] }[]; inputs: string[]; items: Item[]; trays: CompiledTray[]; seed: number; sig: string; spec: Scenario;
  place(rnd: () => number, turned?: boolean): { cubes: { r: number; a: number; yaw: number }[] };
}
export interface ScenarioCheck { spec: Scenario; errors: { line?: number; msg: string }[]; warnings: { msg: string }[]; objects: { shape: ShapeKey; color: ColorName; size: number[]; to: string | null; rule: number | null }[] }
export const CUBE_ITEM: Item;
export function parseRules(text: string, trays: { name: string }[]): { rules: { line: number; any: unknown[][]; to: number | null }[]; errors: { line: number; msg: string }[] };
export function cleanScenario(d: unknown): Scenario;
export function checkScenario(d: unknown): ScenarioCheck;
export function compileScenario(d: unknown, inputs?: string[]): CompiledScenario;
export function scenarioKey(d: unknown): string;
export function itemXml(it: Item, i: number): string;
export const EXAMPLES: Scenario[];
