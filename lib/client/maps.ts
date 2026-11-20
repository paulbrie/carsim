'use client';
// The maps, from the browser: the list for the pickers, and a room's course for the sim.
import { useEffect, useState } from 'react';
import { withBase } from '@/lib/base-path';
import type { Course, MapSummary, RaceMap } from '@/lib/maps/store.mjs';
import type { MapRef } from '@/lib/race/types';

/** What the sim gets: window.__simCourse before it loads, then `course` messages. key changes with the map or a save of it. */
export interface SimCourse { key: string; course: Course | null }

declare global {
  interface Window { __simCourse?: SimCourse }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(withBase(path), {
    ...init,
    headers: { ...(init?.json !== undefined ? { 'content-type': 'application/json' } : {}), ...init?.headers },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const body = await res.json().catch(() => ({})) as { error?: string };
  if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`);
  return body as T;
}

export const fetchMaps = () => api<{ maps: MapSummary[] }>('/api/maps').then(r => r.maps);
export const fetchMap = (id: string, v?: number) => api<{ map: RaceMap }>(`/api/maps/${encodeURIComponent(id)}${v != null ? `?v=${v}` : ''}`).then(r => r.map);

/** Every map, for a picker (empty until loaded, or if that fails). */
export function useMaps(enabled = true) {
  const [maps, setMaps] = useState<MapSummary[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetchMaps().then(m => { if (live) setMaps(m); }).catch(() => {});
    return () => { live = false; };
  }, [enabled]);
  return maps;
}

/** The course of a room's map; null until it has loaded. A map that can't be loaded falls back to the figure-8. */
export function useRoomCourse(map: MapRef | undefined, onError?: (msg: string) => void) {
  const [course, setCourse] = useState<SimCourse | null>(null);
  const key = map ? `${map.id}@${map.v}` : null;
  useEffect(() => {
    if (!map || !key) return;
    let live = true;
    fetchMap(map.id, map.v)
      .then(m => { if (live) setCourse({ key, course: m.course }); })
      .catch((e: Error) => { if (live) { onError?.(`Could not load the map ${map.name}: ${e.message}`); setCourse({ key, course: null }); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return course;
}
