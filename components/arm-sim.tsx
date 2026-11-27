'use client';
// The arm sim's page (#359, a preview): the 3D view (lib/arm/scene.mjs draws what lib/arm/core.mjs simulates), and
// three ways to use it: watch a network do the exam's placements, do them by hand, train a network here (the trainer
// is lib/arm/train.mjs, the driving is done in workers: lib/arm/worker.mjs). Networks are saved on the server, loaded
// back and shared through ArmSaved (#362).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Download, Hand, Pause, Play, RotateCcw, SkipForward, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ArmNetDiagram, type NetLive } from '@/components/arm-net';
import { ArmSaved } from '@/components/arm-saved';
import { cn } from '@/lib/utils';
import { ARMS, SIZES, TASKS } from '@/lib/arm/core.mjs';
import type { ArmKey, ArmNet, ArmSim, Go, Placement, TaskKey } from '@/lib/arm/core.mjs';
import type { ArmScene } from '@/lib/arm/scene.mjs';
import type { Evaluate, Training } from '@/lib/arm/train.mjs';
import grabNet from '@/lib/arm/networks/grab.json';
import trayNet from '@/lib/arm/networks/tray.json';
import stackNet from '@/lib/arm/networks/stack.json';
import b601GrabNet from '@/lib/arm/networks/b601-grab.json';
import b601TrayNet from '@/lib/arm/networks/b601-tray.json';
import b601StackNet from '@/lib/arm/networks/b601-stack.json';

type Mode = 'watch' | 'hand' | 'train';
type Core = typeof import('@/lib/arm/core.mjs');
type Trainer = typeof import('@/lib/arm/train.mjs');
interface Engine {
  M: unknown; C: Core; T: Trainer; view: ArmScene; sim: ArmSim | null; places: Placement[];
  mode: Mode; arm: ArmKey; task: TaskKey; net: ArmNet | null; idx: number; speed: number; paused: boolean; rest: number; started: boolean;
  keys: Set<string>; shut: boolean; acc: number; last: number; raf: number;
  pool: Worker[]; wait: Map<number, (r: Go[]) => void>; nextId: number;
  training: Training | null; run: number;
}
// the networks that come with the sim, per arm (#361: a network is for the arm it was trained on)
const SHIPPED: Record<ArmKey, Partial<Record<TaskKey, ArmNet>>> = { desk: { grab: grabNet as unknown as ArmNet, tray: trayNet as unknown as ArmNet, stack: stackNet as unknown as ArmNet }, b601: { grab: b601GrabNet as unknown as ArmNet, tray: b601TrayNet as unknown as ArmNet, stack: b601StackNet as unknown as ArmNet } };
// what a training of a scenario starts from unless told otherwise: Pick up from nothing; the tray and the stack (which are
// shown the two notes) from the network written by hand for them (lib/arm/train.mjs handStart): from nothing they don't start
const startFor = (_a: ArmKey, t: TaskKey): 'none' | 'hand' | TaskKey => TASKS[t].inputs.includes('go') ? 'hand' : 'none';
// the hidden layer a training of a scenario starts with: the tray and the stack are shown the two notes, and need none
const sizeFor = (t: TaskKey) => t === 'grab' ? 8 : 0;
const KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'r', 'f', ' '];
const KBD = 'rounded-md border border-white/15 bg-white/8 px-1.5 py-0.5 font-mono text-[0.7rem] text-foreground';
const secs = (t: number | null | undefined) => t == null ? '—' : `${t.toFixed(2)} s`;

export function ArmSimView({ signedIn = false }: { signedIn?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null), eng = useRef<Engine | null>(null);
  const [ready, setReady] = useState<'loading' | 'ok' | string>('loading');
  const [mode, setMode] = useState<Mode>('watch');
  const [task, setTask] = useState<TaskKey>('grab');
  const [arm, setArm] = useState<ArmKey>('desk');
  const [hud, setHud] = useState({ idx: 0, t: 0, done: null as number | null, shut: false, started: false, paused: false, stage: 0, of: 1 });
  const [speed, setSpeed] = useState(1);
  const [netInfo, setNetInfo] = useState<{ name: string; weights: number; h: number; exam: ArmNet['exam'] } | null>(null);
  const [netGoes, setNetGoes] = useState<(number | null)[]>([]);
  const [shown, setShown] = useState<ArmNet | null>(null);          // the network drawn under the picture, and what it holds now
  const [live, setLive] = useState<NetLive | null>(null);
  const [mine, setMine] = useState<(number | null)[]>([]);
  // base: what a training starts from: 'none', 'net' (the network on the left) or the scenario whose network comes with the sim
  const [cfg, setCfg] = useState({ h: 8, control: 'hand' as 'hand' | 'joints', base: 'none' as 'none' | 'hand' | 'net' | TaskKey });
  const cfgNow = useRef(cfg); cfgNow.current = cfg;
  const [tr, setTr] = useState<{ on: boolean; gen: number; best: { done: number; of: number; time: number; gen: number } | null; hist: [number, number, number, number][]; cores: number; perGen: number | null }>({ on: false, gen: 0, best: null, hist: [], cores: 0, perGen: null });

  // ---- the driving, all on refs: React only hears of it ten times a second
  const place = useCallback((i: number) => {
    const e = eng.current; if (!e) return;
    e.sim?.free();
    e.idx = (i + e.places.length) % e.places.length;
    e.sim = e.C.createArm(e.M, { at: e.places[e.idx], task: e.task, arm: e.arm });
    e.rest = 0; e.acc = 0; e.started = e.mode !== 'hand'; e.shut = false;
  }, []);
  const putNet = useCallback((net: ArmNet | null, name?: string) => {
    const e = eng.current; if (!e) return;
    e.net = net; setShown(net); setLive(null);
    setNetInfo(net ? { name: name ?? net.name ?? 'A network', weights: net.w.length, h: net.h, exam: net.exam ?? null } : null);
    setNetGoes([]);
    if (net) void evaluate(e)(header(net), e.places.map(at => ({ w: net.w, at }))).then(res => { if (eng.current?.net === net) setNetGoes(res.map(g => g.ok ? g.time : null)); });
  }, []);

  useEffect(() => {
    let dead = false, cleanup = () => {}; const cv = canvas.current!;
    (async () => {
      const [THREE, M, C, S, T] = await Promise.all([import('three'), import('@/lib/arm/load.mjs').then(l => l.loadMujoco()), import('@/lib/arm/core.mjs'), import('@/lib/arm/scene.mjs'), import('@/lib/arm/train.mjs')]);
      if (dead) return;
      const view = S.createScene(THREE, cv);
      const e: Engine = { M, C, T, view, sim: null, places: C.examPlacements('grab'), mode: 'watch', arm: 'desk', task: 'grab', net: null, idx: 0, speed: 1, paused: false, rest: 0, started: true, keys: new Set(), shut: false, acc: 0, last: performance.now(), raf: 0, pool: [], wait: new Map(), nextId: 0, training: null, run: 0 };
      eng.current = e;
      const cores = Math.max(1, Math.min(16, (navigator.hardwareConcurrency || 4) - 1));   // every core but one: the page's own
      try {
        for (let i = 0; i < cores; i++) {
          const w = new Worker(new URL('../lib/arm/worker.mjs', import.meta.url), { type: 'module' });
          w.onmessage = m => { e.wait.get(m.data.id)?.(m.data.res); e.wait.delete(m.data.id); };
          e.pool.push(w);
        }
      } catch { e.pool = []; }
      setTr(t => ({ ...t, cores: e.pool.length || 1 }));
      const fit = () => { const r = cv.getBoundingClientRect(); if (r.width > 0) view.size(Math.round(r.width), Math.round(r.height)); };
      const ro = new ResizeObserver(fit); ro.observe(cv); fit();
      place(0); putNet(SHIPPED.desk.grab ?? null, 'The network that comes with it');
      let n = 0;
      const frame = (now: number) => {
        e.raf = requestAnimationFrame(frame);
        const dt = Math.min(0.1, (now - e.last) / 1000); e.last = now;
        const sim = e.sim; if (!sim) return;
        const limit = C.TASKS[e.task].limit * (e.mode === 'hand' ? 4 : 1), over = sim.done != null || sim.lost || sim.t >= limit;
        if (over) { e.rest += dt; if (e.rest > (e.mode === 'hand' ? 1.2 : 0.7)) { if (e.mode === 'hand') setMine(m => { const c = [...m]; c[e.idx] = sim.done; return c; }); place(e.idx + 1); } }
        else if (!e.paused) {
          e.acc += dt * C.HZ * (e.mode === 'hand' ? 1 : e.speed);
          for (let k = 0; e.acc >= 1 && k < 12 && sim.done == null; k++, e.acc--) {
            if (e.mode === 'hand') {
              const kd = (a: string, b: string) => (e.keys.has(a) || e.keys.has(b) ? 1 : 0), fwd = kd('w', 'arrowup') - kd('s', 'arrowdown'), right = kd('d', 'arrowright') - kd('a', 'arrowleft'), up = kd('r', 'r') - kd('f', 'f');
              if (!e.started && (fwd || right || up || e.shut)) e.started = true;
              if (!e.started) { e.acc = 0; break; }
              // away from the camera is forwards; the camera looks along −(cos az, sin az)
              const ca = Math.cos(view.view.az), sa = Math.sin(view.view.az);
              sim.act({ world: [-ca * fwd - sa * right, up, -sa * fwd + ca * right], shut: e.shut });
            } else if (e.net) sim.act(C.orders(e.net, C.forward(e.net, sim.observe(e.net.inputs))));
            else { e.acc = 0; break; }
          }
          if (e.acc > 12) e.acc = 0;
        }
        const p = e.sim!.pose();                                     // not `sim`: a new placement has freed it
        view.draw(p, e.mode === 'hand' ? 'human' : e.net ? 'net' : 'none');
        if (++n % 6 === 0) {
          setHud({ idx: e.idx, t: p.t, done: p.done, shut: p.shut, started: e.started, paused: e.paused, stage: p.stage, of: p.of });
          // what the network holds now (by hand: what it would do in your place)
          const net = e.net;
          if (net) { const x = e.sim!.observe(net.inputs), l = C.layers(net, x); setLive({ x, h: l.h, y: l.y }); }
        }
      };
      e.raf = requestAnimationFrame(frame);
      // turn the view: drag; nearer or further: the wheel
      let drag: { x: number; y: number } | null = null;
      cv.onpointerdown = ev => { drag = { x: ev.clientX, y: ev.clientY }; cv.setPointerCapture(ev.pointerId); };
      cv.onpointermove = ev => { if (!drag) return; view.orbit((ev.clientX - drag.x) * 0.008, (ev.clientY - drag.y) * 0.006); drag = { x: ev.clientX, y: ev.clientY }; };
      cv.onpointerup = () => { drag = null; };
      cv.onwheel = ev => { ev.preventDefault(); view.orbit(0, 0, ev.deltaY > 0 ? 1.08 : 0.93); };
      const down = (ev: KeyboardEvent) => {
        if (e.mode !== 'hand' || ev.ctrlKey || ev.metaKey || ev.altKey || (ev.target as HTMLElement)?.closest?.('input, textarea, select')) return;
        const k = ev.key.toLowerCase(); if (!KEYS.includes(k)) return;
        ev.preventDefault();
        if (k === ' ') { if (!ev.repeat) e.shut = !e.shut; } else e.keys.add(k);
      };
      const upk = (ev: KeyboardEvent) => { e.keys.delete(ev.key.toLowerCase()); };
      addEventListener('keydown', down); addEventListener('keyup', upk);
      (window as unknown as { __arm?: Engine }).__arm = e;
      setReady('ok');
      cleanup = () => { ro.disconnect(); removeEventListener('keydown', down); removeEventListener('keyup', upk); };
    })().catch(err => { if (!dead) setReady(String((err as Error)?.message || err)); });
    return () => { dead = true; cleanup(); const e = eng.current; if (e) { cancelAnimationFrame(e.raf); e.run++; e.pool.forEach(w => w.terminate()); e.sim?.free(); e.view.dispose(); eng.current = null; } };
  }, [place, putNet]);

  // ---- the controls
  const changeMode = (m: Mode) => {
    const e = eng.current; if (!e) return;
    e.mode = m; e.paused = false; e.keys.clear(); setMode(m);
    if (m === 'hand') setMine([]);
    place(m === 'hand' ? 0 : e.idx);
  };
  const changeTask = (t: TaskKey) => {
    const e = eng.current; if (!e || e.task === t) return;
    stop();
    e.task = t; e.places = e.C.examPlacements(t); e.training = null; setTask(t); setMine([]);
    setCfg(c => ({ ...c, base: startFor(e.arm, t), h: sizeFor(t) }));
    setTr(s => ({ ...s, gen: 0, best: null, hist: [], perGen: null }));
    putNet(SHIPPED[e.arm][t] ?? null, 'The network that comes with it'); place(0);
  };
  // another arm: the same scenario and placements, its own networks (one trained on the other arm does not drive this one)
  const changeArm = (a: ArmKey) => {
    const e = eng.current; if (!e || e.arm === a) return;
    stop();
    e.arm = a; e.training = null; setArm(a); setMine([]);
    setCfg(c => ({ ...c, base: startFor(a, e.task) }));
    setTr(s => ({ ...s, gen: 0, best: null, hist: [], perGen: null }));
    putNet(SHIPPED[a][e.task] ?? null, 'The network that comes with it'); place(0);
  };
  const stop = () => { const e = eng.current; if (e) e.run++; setTr(t => ({ ...t, on: false })); };
  // over: settings for this training other than the panel's (the agent bridge's train, #363; kept in the panel too)
  const train = async (fresh: boolean, over: Partial<typeof cfg> = {}) => {
    const e = eng.current; if (!e) return;
    const cfg = { ...cfgNow.current, ...over };
    if (Object.keys(over).length) setCfg(cfg);
    if (fresh || !e.training || e.training.net.task !== e.task || (e.training.net.arm ?? 'desk') !== e.arm) {
      // from a network (of this scenario or another: grown, what it is not shown yet starts at zero), or from nothing
      const base = cfg.base === 'none' ? null : cfg.base === 'hand' ? (TASKS[e.task].inputs.includes('go') ? e.T.handStart(e.task, e.arm) : null) : cfg.base === 'net' ? e.net : SHIPPED[e.arm][cfg.base] ?? null, usable = base && base.control === cfg.control && (base.arm ?? 'desk') === e.arm ? base : null;
      e.training = e.T.startTraining({ task: e.task, arm: e.arm, h: cfg.h, control: cfg.control, seed: 1 + Math.floor(Math.random() * 1e6), from: usable && e.T.grow(usable, { task: e.task, h: usable.h ? cfg.h : 0 }), anew: !!usable && usable.task !== e.task });   // a network without a hidden layer stays without
      setTr(t => ({ ...t, gen: 0, best: null, hist: [], perGen: null }));
    }
    const run = ++e.run, t = e.training, ev = evaluate(e);
    setTr(s => ({ ...s, on: true }));
    while (eng.current === e && e.run === run) {
      const t0 = performance.now(), before = t.best;
      await e.T.generation(t, ev);
      if (e.run !== run) break;
      // on the left: the best examined network, and until one has grabbed the network as it stands (to watch it learn)
      if (t.best ? t.best !== before : true) {
        const net = t.best ? e.T.trained(t, `Trained here, generation ${t.best.gen}`) : { ...t.net, w: [...t.net.w], name: `In training, generation ${t.gen}`, exam: null };
        e.net = net; setShown(net); setNetInfo({ name: net.name!, weights: net.w.length, h: net.h, exam: net.exam ?? null }); setNetGoes([]);
      }
      setTr(s => ({ ...s, gen: t.gen, hist: [...t.hist], best: t.best && { done: t.best.exam.done, of: t.best.exam.of, time: t.best.exam.time, gen: t.best.gen }, perGen: (performance.now() - t0) / 1000 }));
    }
  };
  const download = () => {
    const e = eng.current; if (!e?.net) return;
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(e.net)], { type: 'application/json' })); a.download = `arm-${e.arm === 'desk' ? '' : `${e.arm}-`}${e.task}-${e.net.w.length}w.json`; a.click(); URL.revokeObjectURL(a.href);
  };
  const setSp = (s: number) => { if (eng.current) eng.current.speed = s; setSpeed(s); };
  const pause = () => { const e = eng.current; if (e) { e.paused = !e.paused; setHud(h => ({ ...h, paused: e.paused })); } };

  // ---- the agent bridge (#363): what public/sim/bridge.js may do on this page (its `arm` command, its state and
  // screenshot): the same things as the controls here, through them, so the person watching sees each one happen.
  const now = useRef({ changeArm, changeTask, changeMode, train, stop, place, setSp, pause, putNet, cfg, tr, netInfo, netGoes, hud, speed, mode });
  now.current = { changeArm, changeTask, changeMode, train, stop, place, setSp, pause, putNet, cfg, tr, netInfo, netGoes, hud, speed, mode };
  useEffect(() => {
    if (ready !== 'ok') return;
    const w = window as unknown as { __armBridge?: ArmBridge };
    w.__armBridge = armBridge(() => eng.current, () => now.current);
    return () => { delete w.__armBridge; };
  }, [ready]);

  const T = TASKS, KEYS_OF = Object.keys(TASKS) as TaskKey[];
  // the exam of the network on show, as this page ran it (every placement's time, or null), else as it came
  const ran = netGoes.length === T[task].exam && netGoes.every(g => g !== undefined) ? { done: netGoes.filter(g => g != null).length, of: netGoes.length, time: netGoes.reduce<number>((s, g) => s + (g ?? T[task].limit), 0) } : null;
  const examNow = ran ?? (shown?.exam ? { done: shown.exam.done, of: shown.exam.of, time: shown.exam.time } : null);
  const their = netGoes[hud.idx], my = mine.filter(v => v != null) as number[];
  const tab = (m: Mode, label: string, Icon: typeof Bot) => (
    <button type="button" role="tab" aria-selected={mode === m} onClick={() => changeMode(m)}
      className={cn('flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring', mode === m ? 'bg-white/10 text-foreground' : 'text-muted-foreground hover:text-foreground')}>
      <Icon className="size-4" aria-hidden /> {label}
    </button>
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-5">
      <div className="panel relative overflow-hidden p-0">
        <canvas ref={canvas} className="block aspect-[16/10] w-full cursor-grab touch-none active:cursor-grabbing" aria-label="The arm, the table and the cube in 3D. Drag to turn the view." />
        {ready !== 'ok' && <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">{ready === 'loading' ? 'Loading the simulator…' : `The simulator did not start: ${ready}`}</p>}
        {ready === 'ok' && (
          <>
            <div className="pointer-events-none absolute top-4 left-5">
              <p className="eyebrow text-[0.65rem] text-muted-foreground">{T[task].name} · placement {hud.idx + 1} of {T[task].exam}{hud.of > 1 && ` · ${Math.min(hud.stage, hud.of)} of ${hud.of} placed`}</p>
              <p className={cn('num mt-1 text-4xl font-semibold', mode === 'hand' ? 'text-human' : 'text-tnn')}>{hud.t.toFixed(2)} <span className="text-xl">s</span></p>
              <p className="mt-1 text-xs text-muted-foreground">
                {hud.done != null ? 'Done.' : mode === 'hand' && !hud.started ? 'The clock starts at your first key.' : hud.paused ? 'Paused.' : mode !== 'hand' && !netInfo ? 'No network yet: train one.' : hud.shut ? 'Fingers shut.' : 'Fingers open.'}
              </p>
            </div>
            {mode === 'hand' && their !== undefined && <p className="pointer-events-none absolute top-4 right-5 text-right text-xs text-muted-foreground">the network here<br /><span className="num text-base font-medium text-tnn">{their == null ? 'failed' : secs(their)}</span></p>}
            <p className="pointer-events-none absolute right-5 bottom-3 text-[0.7rem] text-muted-foreground/70">drag to turn · wheel to zoom</p>
          </>
        )}
      </div>
      <section aria-labelledby="arm-net-title" className="panel p-5">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 id="arm-net-title" className="heading text-lg">The network, live</h2>
          <p className="num text-xs text-muted-foreground">{shown ? `${shown.w.length} weights${shown.h ? `, ${shown.h} hidden units` : ', no hidden layer'}` : ''}</p>
          <p className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><span aria-hidden className="inline-block h-0.5 w-5 rounded bg-[#ff8a3d]" /> pulls up (+)</span>
            <span className="flex items-center gap-1.5"><span aria-hidden className="inline-block h-0.5 w-5 rounded bg-[#4aa8ff]" /> pulls down (−)</span>
          </p>
        </div>
        {shown ? <ArmNetDiagram net={shown} live={live} className="mt-3 w-full" /> : <p className="mt-3 text-sm text-muted-foreground">No network for this scenario yet: train one, and it is drawn here as it learns.</p>}
        <p className="mt-2 text-xs text-muted-foreground">
          Every line is one weight: thicker, the more it pulls; brighter, the more is flowing through it now. A neuron fills with what it holds, from −1 to 1.
          {mode === 'hand' && shown && ' With your hands on the keys, the right-hand column is what the network would do in your place.'}
        </p>
      </section>
      </div>

      <div className="flex flex-col gap-4">
        <div className="panel p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="eyebrow text-[0.62rem] text-muted-foreground">Arm</p>
            {/* the agent bridge's button goes here (public/sim/bridge.js, for whoever is signed in, #363) */}
            <div id="armBridge" />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {(Object.keys(ARMS) as ArmKey[]).map(k => <Button key={k} size="sm" variant={arm === k ? 'default' : 'glass'} aria-pressed={arm === k} disabled={ready !== 'ok'} onClick={() => changeArm(k)}>{ARMS[k].name}</Button>)}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{ARMS[arm].about}</p>
          <p className="eyebrow mt-4 text-[0.62rem] text-muted-foreground">Scenario</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {KEYS_OF.map(k => <Button key={k} size="sm" variant={task === k ? 'default' : 'glass'} disabled={ready !== 'ok'} onClick={() => changeTask(k)}>{T[k].name}</Button>)}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{T[task].about}</p>
        </div>

        <div className="panel p-4">
          <div role="tablist" aria-label="What to do" className="flex gap-1 rounded-xl bg-black/25 p-1">
            {tab('watch', 'Watch', Bot)}{tab('hand', 'By hand', Hand)}{tab('train', 'Train', Sparkles)}
          </div>

          {mode !== 'hand' && (
            <div className="mt-4">
              <p className="text-sm font-medium">{netInfo ? netInfo.name : 'No network for this scenario yet'}</p>
              <p className="num mt-0.5 text-xs text-muted-foreground">
                {netInfo ? <>{netInfo.weights} weights{netInfo.h ? `, ${netInfo.h} hidden units` : ', no hidden layer'}{netInfo.exam && <span className="block">exam: <span className="text-tnn">{netInfo.exam.done} of {netInfo.exam.of}</span>{netInfo.exam.done > 0 && <> in {netInfo.exam.time.toFixed(1)} s</>}</span>}</> : 'Train one here: it takes a few minutes.'}
              </p>
            </div>
          )}

          {mode === 'watch' && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="glass" disabled={!netInfo} onClick={pause}>{hud.paused ? <><Play /> Go on</> : <><Pause /> Pause</>}</Button>
              <Button size="sm" variant="glass" disabled={!netInfo} onClick={() => place((eng.current?.idx ?? 0) + 1)}><SkipForward /> Next</Button>
              <span className="ml-auto flex gap-1">{[1, 2, 4].map(s => <Button key={s} size="sm" variant={speed === s ? 'default' : 'ghost'} onClick={() => setSp(s)} aria-pressed={speed === s}>{s}×</Button>)}</span>
            </div>
          )}

          {mode === 'hand' && (
            <div className="mt-4 text-sm">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-muted-foreground">
                <dt><kbd className={KBD}>W A S D</kbd></dt><dd>move the hand over the table (or the arrows)</dd>
                <dt><kbd className={KBD}>R</kbd> <kbd className={KBD}>F</kbd></dt><dd>up, down</dd>
                <dt><kbd className={KBD}>Space</kbd></dt><dd>shut or open the fingers</dd>
              </dl>
              <p className="num mt-3 text-muted-foreground">You: <span className="font-medium text-human">{my.length}</span> done{my.length > 0 && <> in <span className="font-medium text-human">{my.reduce((a, b) => a + b, 0).toFixed(1)} s</span></>}</p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="glass" onClick={() => place(eng.current?.idx ?? 0)}><RotateCcw /> Again</Button>
                <Button size="sm" variant="glass" onClick={() => place((eng.current?.idx ?? 0) + 1)}><SkipForward /> Skip</Button>
              </div>
            </div>
          )}

          {mode === 'train' && (
            <div className="mt-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <label className="block"><span className="text-xs text-muted-foreground">Hidden units</span>
                  <select className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5" value={cfg.h} disabled={tr.on} onChange={ev => setCfg(c => ({ ...c, h: +ev.target.value }))}>{[0, 4, 8, 16].map(h => <option key={h} value={h}>{h || 'none'}</option>)}</select>
                </label>
                <label className="col-span-2 block"><span className="text-xs text-muted-foreground">It starts from</span>
                  <select className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5" value={cfg.base} disabled={tr.on} onChange={ev => setCfg(c => ({ ...c, base: ev.target.value as typeof cfg.base }))}>
                    <option value="none">nothing</option>
                    {T[task].inputs.includes('go') && <option value="hand">a start written by hand (7 weights)</option>}
                    {KEYS_OF.filter(k => SHIPPED[arm][k]).map(k => <option key={k} value={k}>the network that comes with {T[k].name}</option>)}
                    {shown && <option value="net">the network on the left</option>}
                  </select>
                </label>
                <label className="block"><span className="text-xs text-muted-foreground">It drives</span>
                  <select className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5" value={cfg.control} disabled={tr.on} onChange={ev => setCfg(c => ({ ...c, control: ev.target.value as 'hand' | 'joints' }))}><option value="hand">the hand</option><option value="joints">each motor</option></select>
                </label>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {tr.on ? <Button size="sm" variant="tnn" onClick={stop}><Pause /> Pause</Button> : <Button size="sm" variant="tnn" disabled={ready !== 'ok'} onClick={() => train(false)}><Sparkles /> {tr.gen ? 'Train on' : 'Train'}</Button>}
                {(tr.gen > 0 || cfg.base !== 'none') && !tr.on && <Button size="sm" variant="glass" onClick={() => train(true)}><RotateCcw /> Start over</Button>}
                <Button size="sm" variant="ghost" disabled={!netInfo} onClick={download}><Download /> File</Button>
              </div>
              <p className="num mt-3 text-muted-foreground">
                Generation <span className="font-medium text-foreground">{tr.gen}</span>
                {tr.best ? <> · best <span className="font-medium text-tnn">{tr.best.done} of {tr.best.of}</span>{tr.best.done > 0 && <> in {tr.best.time.toFixed(1)} s</>}</> : tr.gen > 0 && <> · not managed yet</>}
                {tr.perGen != null && <> · {tr.perGen.toFixed(1)} s a generation on {tr.cores} {tr.cores === 1 ? 'core' : 'cores'}</>}
              </p>
              <Chart hist={tr.hist} of={T[task].exam} />
              <p className="mt-2 text-xs text-muted-foreground">Each generation tries 16 variations of the network on four placements. Once one of them has managed the scenario, each generation also takes the exam: the same placements as everyone. The arm on the left is the network as it stands, then the best one examined. Not every training gets there: if nothing has come of it by generation 150, start over.</p>
            </div>
          )}
        </div>

        <ArmSaved arm={arm} task={task} signedIn={signedIn} net={shown} exam={examNow} defaultName={netInfo?.name ?? ''}
          onLoad={(net, name) => { stop(); putNet(net, name); }} />
      </div>
    </div>
  );
}

const header = (net: ArmNet) => ({ kind: net.kind, ...(net.arm && { arm: net.arm }), task: net.task, control: net.control, roll: net.roll, inputs: net.inputs, h: net.h });
/** The goes shared out over the workers a few at a time (lib/arm/train.mjs shareOut); here, on the page, when there are none. */
function evaluate(e: Engine): Evaluate {
  if (!e.pool.length) return async (head, goes) => e.T.runGoes(e.M, head, goes);
  return e.T.shareOut(e.pool.length, (i, head, goes) => new Promise<Go[]>(yes => { const id = e.nextId++; e.wait.set(id, yes); e.pool[i].postMessage({ id, head, goes }); }));
}

/** How many of the exam's placements the network of each generation managed (cyan), and, fainter, how its tries scored: that moves long before the first grab. */
function Chart({ hist, of }: { hist: [number, number, number, number][]; of: number }) {
  const W = 320, H = 70, n = Math.max(20, hist.length), top = Math.max(4, ...hist.map(h => h[3]));
  const line = (v: (h: [number, number, number, number]) => number) => hist.map(h => `${((h[0] - 1) / (n - 1)) * W},${H - 4 - Math.max(0, Math.min(1, v(h))) * (H - 8)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full rounded-lg bg-black/25" role="img" aria-label={hist.length ? `After generation ${hist.length}: ${hist[hist.length - 1][1]} of ${of} in the exam, the tries scoring ${hist[hist.length - 1][3]} on average` : 'The exam after each generation: nothing yet'}>
      <line x1="0" x2={W} y1="4" y2="4" stroke="currentColor" strokeOpacity="0.12" strokeDasharray="3 4" />
      <text x="4" y="14" fontSize="9" fill="currentColor" fillOpacity="0.45">{of} of {of}</text>
      <text x={W - 4} y="14" fontSize="9" textAnchor="end" fill="currentColor" fillOpacity="0.45">faint: the tries’ score</text>
      {hist.length > 1 && <polyline points={line(h => h[3] / top)} fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.1" strokeLinejoin="round" />}
      {hist.length > 1 && <polyline points={line(h => h[1] / of)} fill="none" stroke="var(--tnn)" strokeWidth="1.6" strokeLinejoin="round" />}
    </svg>
  );
}

// ---- the agent bridge's view of this page (#363)
type Now = { changeArm(a: ArmKey): void; changeTask(t: TaskKey): void; changeMode(m: Mode): void; train(fresh: boolean, over?: Record<string, unknown>): Promise<void>; stop(): void; place(i: number): void; setSp(s: number): void; pause(): void; putNet(net: ArmNet | null, name?: string): void;
  cfg: { h: number; control: 'hand' | 'joints'; base: string }; tr: { on: boolean; gen: number; best: unknown; hist: [number, number, number, number][]; cores: number; perGen: number | null };
  netInfo: { name: string } | null; netGoes: (number | null)[]; hud: { idx: number; t: number; done: number | null; stage: number; of: number; paused: boolean; shut: boolean }; speed: number; mode: Mode };
export interface ArmBridge { state(): unknown; shot(o: { maxWidth?: number; quality?: number }): { dataUrl: string; width: number; height: number }; call(fn: string, args?: Record<string, unknown>): Promise<unknown> }
const MODES: Mode[] = ['watch', 'hand', 'train'];
const pick = <K extends string>(v: unknown, keys: readonly K[], what: string): K => { if (!keys.includes(v as K)) throw new Error(`${what}: one of ${keys.join(', ')}`); return v as K; };
const netOf = (n: ArmNet | null) => n && { name: n.name ?? null, arm: n.arm ?? 'desk', task: n.task, control: n.control, h: n.h, inputs: n.inputs, weights: n.w.length, exam: n.exam ?? null };
/**
 * What the bridge's `arm { fn, args }` can do here:
 *   arm { key }            the arm: desk or b601 (its networks come with it)
 *   task { key }           the scenario: grab, tray or stack
 *   mode { mode }          watch, hand or train (the tabs)
 *   config { h?, control?, base? }  the training's settings, as the Train tab has them (base: none, hand, net or a scenario)
 *   train { fresh?, h?, control?, base? }  start (or carry on) a training here, in the browser's workers; it runs until stop
 *   stop {}                pause the training
 *   history { from? }      the training's generations: [generation, done, time, the tries' average score]
 *   exam {}                the network on the left takes the scenario's exam (its placements, the same for everyone)
 *   net {}                 the network on the left, whole (its file: weights to the last digit)
 *   load { net, name? }    a network (a file's JSON) put on the left: the arm and scenario switch to its own
 *   place { i }            go to the exam's placement i (watching)
 *   speed { x }            1, 2 or 4 (watching)
 *   pause {}               pause or go on (watching)
 */
function armBridge(eng: () => Engine | null, now: () => Now): ArmBridge {
  const E = () => { const e = eng(); if (!e) throw new Error('The arm sim is not ready'); return e; };
  const state = () => {
    const e = E(), n = now(), tr = n.tr;
    return {
      page: 'arm', arm: e.arm, arms: Object.keys(ARMS), task: e.task, tasks: Object.keys(TASKS), mode: e.mode,
      placement: { i: e.idx, of: e.places.length, t: +n.hud.t.toFixed(2), done: n.hud.done, placed: n.hud.of > 1 ? `${Math.min(n.hud.stage, n.hud.of)} of ${n.hud.of}` : null, paused: e.paused, speed: e.speed },
      net: e.net && { ...netOf(e.net), shownAs: n.netInfo?.name ?? null, here: n.netGoes.length ? { done: n.netGoes.filter(g => g != null).length, of: n.netGoes.length } : null },
      training: { on: tr.on, gen: tr.gen, best: tr.best, perGen: tr.perGen && +tr.perGen.toFixed(2), cores: tr.cores, config: n.cfg, last: tr.hist.slice(-8) },
    };
  };
  const fns: Record<string, (a: Record<string, unknown>) => unknown> = {
    arm: a => { now().changeArm(pick(a.key, Object.keys(ARMS) as ArmKey[], 'key')); return { arm: E().arm }; },
    task: a => { now().changeTask(pick(a.key, Object.keys(TASKS) as TaskKey[], 'key')); return { task: E().task }; },
    mode: a => { now().changeMode(pick(a.mode, MODES, 'mode')); return { mode: E().mode }; },
    config: a => ({ config: { ...now().cfg, ...settings(a) } }),
    train: a => {
      const n = now(), over = settings(a);
      if (n.tr.on) throw new Error('Already training: stop first');
      if (E().mode !== 'train') n.changeMode('train');
      void n.train(!!a.fresh, over);
      return { training: true, task: E().task, arm: E().arm, config: { ...n.cfg, ...over } };
    },
    stop: () => { now().stop(); return { training: false }; },
    history: a => ({ hist: now().tr.hist.slice(Math.max(0, Number(a.from) | 0)) }),
    exam: async () => {
      const e = E(); if (!e.net) throw new Error('No network on the left');
      const net = e.net, x = await e.T.examBy(evaluate(e), net);
      return { net: net.name ?? null, arm: net.arm ?? 'desk', task: net.task, done: x.done, of: x.of, time: x.time, mean: x.mean };
    },
    net: () => { const e = E(); if (!e.net) throw new Error('No network on the left'); return JSON.parse(JSON.stringify(e.net)); },
    load: a => {
      const e = E(), net = a.net as ArmNet, why = e.C.notNet(net);
      if (why) throw new Error(`Not a network: ${why}`);
      if (!Object.hasOwn(TASKS, net.task)) throw new Error(`task: one of ${Object.keys(TASKS).join(', ')}`);
      const n = now();
      if (n.tr.on) n.stop();
      n.changeArm(net.arm ?? 'desk'); n.changeTask(net.task);
      const mine = { ...net, w: [...net.w] };
      n.putNet(mine, typeof a.name === 'string' && a.name ? a.name.slice(0, 80) : 'From the agent');
      return { loaded: netOf(mine) };
    },
    place: a => { now().place(Number(a.i) | 0); return { placement: E().idx }; },
    speed: a => { const x = Number(a.x); if (![1, 2, 4].includes(x)) throw new Error('x: 1, 2 or 4'); now().setSp(x); return { speed: x }; },
    pause: () => { now().pause(); return { paused: E().paused }; },
  };
  // the settings a training may be given, checked as the panel's selects would have them
  const settings = (a: Record<string, unknown>) => {
    const o: Record<string, unknown> = {};
    if (a.h !== undefined) { const h = Number(a.h); if (!SIZES.includes(h)) throw new Error(`h: one of ${SIZES.join(', ')}`); o.h = h; }
    if (a.control !== undefined) o.control = pick(a.control, ['hand', 'joints'] as const, 'control');
    if (a.base !== undefined) o.base = pick(a.base, ['none', 'hand', 'net', ...Object.keys(TASKS)] as string[], 'base');
    return o;
  };
  return {
    state,
    shot({ maxWidth = 960, quality = 0.8 }) {
      const src = E().view.renderer.domElement as HTMLCanvasElement, k = Math.min(1, maxWidth / src.width), cv = document.createElement('canvas');
      cv.width = Math.round(src.width * k); cv.height = Math.round(src.height * k);
      cv.getContext('2d')!.drawImage(src, 0, 0, cv.width, cv.height);
      return { dataUrl: cv.toDataURL('image/jpeg', quality), width: cv.width, height: cv.height };
    },
    async call(fn, args = {}) {
      if (!Object.hasOwn(fns, fn)) throw new Error(`No ${fn}: one of ${Object.keys(fns).join(', ')}`);
      return (await fns[fn](args && typeof args === 'object' ? args : {})) ?? {};
    },
  };
}
