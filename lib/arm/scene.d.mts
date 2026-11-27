import type { Pose } from './core.mjs';
export const WHO: Record<'net' | 'human' | 'none', number>;
export interface ArmScene {
  view: { az: number; el: number; dist: number };
  size(w: number, h: number): void;
  orbit(daz: number, del?: number, zoom?: number): void;
  draw(p: Pose, who?: 'net' | 'human' | 'none'): void;
  dispose(): void;
}
export function createScene(THREE: unknown, canvas: HTMLCanvasElement, o?: { shadows?: boolean }): ArmScene;
