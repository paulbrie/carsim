'use client';
// The ghost car (#310): which best lap's path the sim races us against, a choice kept in this browser.
import { Subject } from 'subjecto';
import type { BestLap, Records } from '@/lib/race/types';

export type GhostMode = 'off' | 'track' | 'car' | 'mine';
export const GHOST_MODES: { key: GhostMode; name: string; blurb: string }[] = [
  { key: 'off', name: 'Off', blurb: 'No ghost' },
  { key: 'track', name: 'Track record', blurb: 'The fastest lap on this map and ground, with any car' },
  { key: 'car', name: 'Car record', blurb: 'The fastest lap with your car' },
  { key: 'mine', name: 'My best', blurb: 'Your own best lap with your car' },
];
const KEY = 'carsim.ghost';
const saved = (): GhostMode => {
  try { const v = localStorage.getItem(KEY); if (GHOST_MODES.some(m => m.key === v)) return v as GhostMode; } catch { }
  return 'off';
};
export const ghostMode$ = new Subject<GhostMode>(typeof window === 'undefined' ? 'off' : saved());
export function setGhostMode(m: GhostMode) {
  ghostMode$.next(m);
  try { localStorage.setItem(KEY, m); } catch { }
}

/** the best lap to race: the fastest of those with a path (only laps on the map as it is now have one) */
export function pickGhost(records: Records | null, mode: GhostMode, meId: string, vehicle: string | undefined): BestLap | null {
  if (!records || mode === 'off') return null;
  return records.list.find(e => e.ghost && (mode === 'track' || (e.vehicle === vehicle && (mode === 'car' || e.id === meId)))) ?? null;
}
