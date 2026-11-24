export interface CurvePoint { rpm: number; torque: number; power: number }
export interface EngineSpec {
  idle: number; limiter: number; curve: [number, number][]; gears: number[]; finalDrive: number; reverse: number; efficiency: number;
  stall: number; shiftUp: [number, number]; shiftDown: [number, number];
  peakPower: number; peakPowerRpm: number; peakTorque: number; peakTorqueRpm: [number, number]; points: CurvePoint[];
}
export interface CarSpec {
  key: string; name: string; short: string; blurb: string;
  mass: number; frontWeight: number; wheelbase: number; trackF: number; trackR: number; length: number; width: number; height: number | null;
  inertia: { pitch: number; yaw: number; roll: number };
  drive: 'awd' | 'rwd'; awdSwitchable: boolean; split: number;
  engine: EngineSpec; powerToWeight: number;
  brakeTorque: number; steerLock: number; cda: number;
  suspension: { spring: number; travel: number; bump: number; rebound: number };
  tire: { radius: number; width: number; rim: number | null; wheelInertia: number };
  pressures: { psi: number; kpa: number; width: number; deflection: number }[];
  aids: boolean; sound: string;
}
export interface GroundSpec {
  key: string; name: string; stiffness: number; packedStiffness: number; friction: number; packedFriction: number;
  cohesion: number; dig: number; compaction: number; rigid: boolean; slipPeak: number; slipAngle: number; slide: number; rut: number;
}
export interface TechSpecs { hz: number; splits: number[]; cars: CarSpec[]; grounds: GroundSpec[] }
export { torqueAt } from './curve.mjs';
export function techSpecs(file?: string): TechSpecs;
