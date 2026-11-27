'use client';
// Watching a duel (/duel/<track>/<ground>/<car>): the sim in a frame as its room (?mp=1&watch=1, scripts/patches/watch.py).
// It gets the track's course (window.__simCourse, from /api/tracks), the ground and the car, the human's best lap as the
// ghost, and the saved network (/api/networks), which drives; the ghost sets off with each of its laps. Beside it, the
// network's decisions as the sim sends them (DecisionCard), and in the 3D view what it sees, drawn where it is (`sees`, #360:
// scripts/patches/sees.py), on unless turned off here (remembered in this browser).
import { useEffect, useRef, useState } from 'react';
import { api, type SimCourse } from '@/lib/client/maps';
import { withBase } from '@/lib/base-path';
import type { Course } from '@/lib/maps/store.mjs';
import { DecisionCard, type Decision } from '@/components/decision-card';
import { Button } from '@/components/ui/button';
import { Eye, EyeOff } from 'lucide-react';

const SEES_KEY = 'carsim.duel.sees';

export interface DuelGhost { name: string; time: number; trace: string }

export function DuelView({ track, v, ground, vehicle, networkId, ghost, title }: { track: string; v: number; ground: string; vehicle: string; networkId: string; ghost: DuelGhost; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [course, setCourse] = useState<SimCourse | null>(null);
  const [error, setError] = useState('');
  const [decision, setDecision] = useState<Decision | null>(null);
  const [sees, setSees] = useState(true);
  const seesRef = useRef(true);

  useEffect(() => { try { if (localStorage.getItem(SEES_KEY) === 'off') { setSees(false); seesRef.current = false; } } catch { /* storage off */ } }, []);
  const toggleSees = () => {
    const on = !sees; setSees(on); seesRef.current = on;
    try { localStorage.setItem(SEES_KEY, on ? 'on' : 'off'); } catch { /* storage off */ }
    frame.current?.contentWindow?.postMessage({ t: 'sees', on }, location.origin);
  };

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
      if (m?.t === 'decision') { setDecision(m as Decision); return; }
      if (m?.t === 'watch' && m.ok === false) setError('This network does not fit the sim any more.');
      if (m?.t !== 'ready') return;
      post({ t: 'init', me: 'watch' });
      post({ t: 'sees', on: seesRef.current });
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
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div>
        <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-black">
          {course && <iframe ref={frame} src={src} title={title} className="absolute inset-0 size-full" allow="autoplay" />}
          {(error || !course) && (
            <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">
              {error || 'Loading the track…'}
            </div>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <Button variant="outline" size="sm" aria-pressed={sees} onClick={toggleSees}>
            {sees ? <Eye /> : <EyeOff />} What it sees: {sees ? 'on' : 'off'}
          </Button>
          <span className="text-pretty">
            {sees ? 'On the track: the racing line it follows, the points it looks at, its offset, speed and turn, the pace notes. Orange: + (left), blue: − (right).' : 'Its inputs drawn on the track, where they are.'}
          </span>
        </div>
      </div>
      <DecisionCard d={decision} />
    </div>
  );
}
