'use client';
// Watching a duel (/duel/<track>/<ground>/<car>): the sim in a frame as its room (?mp=1&watch=1, scripts/patches/watch.py).
// It gets the track's course (window.__simCourse, from /api/tracks), the ground and the car, the human's best lap as the
// ghost, and the saved network (/api/networks), which drives; the ghost sets off with each of its laps.
import { useEffect, useRef, useState } from 'react';
import { api, type SimCourse } from '@/lib/client/maps';
import { withBase } from '@/lib/base-path';
import type { Course } from '@/lib/maps/store.mjs';

export interface DuelGhost { name: string; time: number; trace: string }

export function DuelView({ track, v, ground, vehicle, networkId, ghost, title }: { track: string; v: number; ground: string; vehicle: string; networkId: string; ghost: DuelGhost; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [course, setCourse] = useState<SimCourse | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    api<{ track: { id: string; v: number; course: Course | null } }>(`/api/tracks/${encodeURIComponent(track)}?v=${v}`)
      .then(r => {
        if (!live) return;
        if (r.track.v !== v) { setError('The track has changed since this duel: reload the page.'); return; }
        const c = { key: `${r.track.id}@${r.track.v}`, course: r.track.course };
        window.__simCourse = c; setCourse(c);
      })
      .catch(e => { if (live) setError(`The track could not load: ${e.message}`); });
    return () => { live = false; };
  }, [track, v]);

  useEffect(() => {
    if (!course) return;
    const post = (m: object) => frame.current?.contentWindow?.postMessage(m, location.origin);
    const onMessage = async (e: MessageEvent) => {
      if (e.origin !== location.origin || e.source !== frame.current?.contentWindow) return;
      const m = e.data;
      if (m?.t === 'watch' && m.ok === false) setError('This network does not fit the sim any more.');
      if (m?.t !== 'ready') return;
      post({ t: 'init', me: 'watch' });
      post({ t: 'ground', ground });
      post({ t: 'weather', weather: 'clear' });
      post({ t: 'car', vehicle });
      post({ t: 'ghost', key: `duel:${course.key}:${vehicle}`, course: course.key, ground, vehicle, name: ghost.name, time: ghost.time, trace: ghost.trace });
      try {
        const r = await api<{ network: object }>(`/api/networks/${encodeURIComponent(networkId)}`);
        post({ t: 'watch', network: r.network });
      } catch (err) { setError(`The network could not load: ${(err as Error).message}`); }
    };
    addEventListener('message', onMessage);
    return () => removeEventListener('message', onMessage);
  }, [course, ground, vehicle, networkId, ghost]);

  const src = withBase(`/sim/index.html?${new URLSearchParams({ mp: '1', watch: '1', ground, weather: 'clear', vehicle, spawn: '0' })}`);
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-black">
      {course && <iframe ref={frame} src={src} title={title} className="absolute inset-0 size-full" allow="autoplay" />}
      {(error || !course) && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">
          {error || 'Loading the track…'}
        </div>
      )}
    </div>
  );
}
