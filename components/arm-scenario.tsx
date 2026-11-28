'use client';
// One's own arm scenario (#365), under the arm sim's picture: the objects on the table (shape, size, colour, how many),
// the trays (name, colour, where, size), the rules that sort them, the time and the exam. lib/arm/scenario.mjs checks
// it (`checkScenario`: what is wrong, what each object will do) and makes it a scenario the sim runs; the page puts it on
// the table as soon as it can be run. Kept in this browser (the one being edited, and copies under their names).
import { useId, useMemo } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { EXAMPLES, PALETTE, SCENARIO_LIMITS, SHAPES, checkScenario, cleanScenario } from '@/lib/arm/scenario.mjs';
import type { ColorName, Scenario, ScenarioCheck, ScenarioObject, ScenarioTray, ShapeKey } from '@/lib/arm/scenario.mjs';

const KEEP = 'carsim.arm.scenario', MINE = 'carsim.arm.scenarios';
const COLORS = Object.keys(PALETTE) as ColorName[];
const css = (c: ColorName) => `#${PALETTE[c].toString(16).padStart(6, '0')}`;
const FIELD = 'rounded-md border border-white/10 bg-black/30 px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** The scenario being edited, as this browser kept it (else the first example). */
export function keptScenario(): Scenario {
  try { const s = localStorage.getItem(KEEP); if (s) return cleanScenario(JSON.parse(s)); } catch { /* none, or not one */ }
  return EXAMPLES[0];
}
export function keepScenario(s: Scenario) { try { localStorage.setItem(KEEP, JSON.stringify(s)); } catch { /* full or off */ } }
function mine(): Scenario[] { try { const l = JSON.parse(localStorage.getItem(MINE) || '[]'); return Array.isArray(l) ? l.map(cleanScenario) : []; } catch { return []; } }
function setMine(l: Scenario[]) { try { localStorage.setItem(MINE, JSON.stringify(l)); } catch { /* full or off */ } }

function Num({ label, value, onChange, min, max, step = 0.5, unit, className }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number; unit?: string; className?: string }) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn('flex flex-col gap-0.5', className)}>
      <span className="text-[0.68rem] text-muted-foreground">{label}{unit && <span className="sr-only"> ({unit})</span>}</span>
      <span className="flex items-center gap-1">
        <input id={id} type="number" inputMode="decimal" className={cn(FIELD, 'num w-[3.7rem]')} value={value} min={min} max={max} step={step}
          onChange={ev => { const v = ev.target.valueAsNumber; if (Number.isFinite(v)) onChange(v); }} />
        {unit && <span aria-hidden className="text-xs text-muted-foreground">{unit}</span>}
      </span>
    </label>
  );
}

function Swatches({ label, value, onChange }: { label: string; value: ColorName; onChange: (c: ColorName) => void }) {
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-0.5">
      <legend className="mb-0.5 text-[0.68rem] text-muted-foreground">{label}</legend>
      <div className="flex flex-wrap gap-1">
        {COLORS.map(c => (
          <label key={c} className="relative cursor-pointer" title={c}>
            <input type="radio" name={name} value={c} checked={value === c} onChange={() => onChange(c)} className="peer sr-only" />
            <span className="sr-only">{c}</span>
            <span aria-hidden className="block size-[18px] rounded-full border border-white/25 ring-offset-2 ring-offset-[#11141b] peer-checked:ring-2 peer-checked:ring-white peer-focus-visible:ring-2 peer-focus-visible:ring-ring" style={{ background: css(c) }} />
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function ArmScenarioEditor({ spec, onChange, applied }: {
  /** the scenario being edited (clean: lib/arm/scenario.mjs cleanScenario) */
  spec: Scenario; onChange: (s: Scenario) => void;
  /** whether what the sim runs is this very scenario (false: it waits for it to be put right) */
  applied: boolean;
}) {
  const check: ScenarioCheck = useMemo(() => checkScenario(spec), [spec]);
  const saved = useMemo(() => (typeof window === 'undefined' ? [] : mine()), [spec]);   // read again after each change (Keep, Delete)
  const rulesId = useId(), rulesHelp = useId(), errId = useId();
  // as typed (a number half typed is not put in range yet: that is done on leaving the field, and by the check)
  const set = (o: Partial<Scenario>) => onChange({ ...spec, ...o });
  const tidy = () => { const c = cleanScenario(spec); if (JSON.stringify(c) !== JSON.stringify(spec)) onChange(c); };
  const setObj = (i: number, o: Partial<ScenarioObject>) => set({ objects: spec.objects.map((x, k) => (k === i ? { ...x, ...o } : x)) });
  const setTray = (i: number, o: Partial<ScenarioTray>) => {
    const old = spec.trays[i], trays = spec.trays.map((x, k) => (k === i ? { ...x, ...o } : x));
    // a tray renamed: the rules that named it follow
    const rules = o.name !== undefined && o.name.trim() && old.name !== o.name ? spec.rules.replace(new RegExp(`(→|->|=>|:|\\bto|\\bin)(\\s*)${old.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'gmi'), `$1$2${o.name.trim()}`) : spec.rules;
    set({ trays, rules });
  };
  const count = spec.objects.reduce((n, o) => n + o.n, 0);
  const lineErrors = check.errors.filter(e => e.line), otherErrors = check.errors.filter(e => !e.line);
  const keep = () => { const c = cleanScenario(spec), l = mine().filter(s => s.name !== c.name); setMine([...l, c].slice(-20)); onChange(c); };
  const forget = () => { setMine(mine().filter(s => s.name !== spec.name)); onChange({ ...spec }); };
  const isMine = saved.some(s => s.name === spec.name);

  return (
    <section aria-labelledby="arm-scen-title" className="panel p-5" onBlur={tidy}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 id="arm-scen-title" className="heading text-lg">Your scenario</h2>
        <p className={cn('text-xs', check.errors.length ? 'text-destructive' : 'text-muted-foreground')} aria-live="polite">
          {check.errors.length ? `${check.errors.length === 1 ? 'One thing' : `${check.errors.length} things`} to put right before it runs` : applied ? 'On the table now' : 'Putting it on the table…'}
        </p>
        <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">Start from
          <select className={FIELD} value="" onChange={ev => { const v = ev.target.value; if (!v) return; const [k, i] = v.split(':'); const src = k === 'ex' ? EXAMPLES[+i] : k === 'mine' ? saved[+i] : { ...EXAMPLES[0], name: 'My scenario', objects: [{ shape: 'cube', size: [5], color: 'white', n: 1 }], trays: [{ name: 'A', color: 'green', at: [100, 30], size: [14, 14] }], rules: 'anything → A' }; if (src) onChange(cleanScenario(src)); }}>
            <option value="">choose…</option>
            <optgroup label="Variants">{EXAMPLES.map((x, i) => <option key={x.name} value={`ex:${i}`}>{x.name}</option>)}<option value="new">One cube, one tray</option></optgroup>
            {saved.length > 0 && <optgroup label="Kept in this browser">{saved.map((x, i) => <option key={x.name} value={`mine:${i}`}>{x.name}</option>)}</optgroup>}
          </select>
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex min-w-48 flex-1 flex-col gap-0.5"><span className="text-[0.68rem] text-muted-foreground">Name</span>
          <input className={FIELD} value={spec.name} maxLength={SCENARIO_LIMITS.name} onChange={ev => set({ name: ev.target.value })} />
        </label>
        <Num label="Time for all of it" unit="s" value={spec.limit} min={SCENARIO_LIMITS.limit[0]} max={SCENARIO_LIMITS.limit[1]} step={1} onChange={v => set({ limit: v })} />
        <Num label="Exam placements" value={spec.exam} min={SCENARIO_LIMITS.exam[0]} max={SCENARIO_LIMITS.exam[1]} step={1} onChange={v => set({ exam: v })} />
        <Button size="sm" variant="glass" onClick={keep} title="Keep a copy of it under its name in this browser, to start from again"><Save /> Keep</Button>
        {isMine && <Button size="sm" variant="ghost" onClick={forget} title="Forget the copy kept under this name"><Trash2 /> Forget</Button>}
      </div>

      <fieldset className="mt-5">
        <legend className="eyebrow text-[0.62rem] text-muted-foreground">On the table · {count} of {SCENARIO_LIMITS.objects}</legend>
        <ul className="mt-2 space-y-2">
          {spec.objects.map((o, i) => (
            <li key={i} className="flex flex-wrap items-end gap-x-3 gap-y-2 rounded-lg bg-white/3 px-3 py-2">
              <label className="flex flex-col gap-0.5"><span className="text-[0.68rem] text-muted-foreground">Shape</span>
                <select className={FIELD} value={o.shape} onChange={ev => { const shape = ev.target.value as ShapeKey; setObj(i, { shape, size: SHAPES[shape].sizes.map((_, k) => o.size[k] ?? o.size[0]) }); }}>
                  {(Object.keys(SHAPES) as ShapeKey[]).map(k => <option key={k} value={k}>{SHAPES[k].name}</option>)}
                </select>
              </label>
              {SHAPES[o.shape].sizes.map((s, k) => <Num key={s} label={s[0].toUpperCase() + s.slice(1)} unit="cm" value={o.size[k]} min={SCENARIO_LIMITS.size[0]} max={SCENARIO_LIMITS.size[1]} onChange={v => setObj(i, { size: o.size.map((x, j) => (j === k ? v : x)) })} />)}
              <Swatches label="Colour" value={o.color} onChange={color => setObj(i, { color })} />
              <Num label="How many" value={o.n} min={1} max={SCENARIO_LIMITS.objects} step={1} onChange={n => setObj(i, { n })} />
              <Button size="icon" variant="ghost" className="ml-auto size-8" aria-label={`Take the ${o.color} ${SHAPES[o.shape].name.toLowerCase()}s off the table`} onClick={() => set({ objects: spec.objects.filter((_, k) => k !== i) })}><Trash2 /></Button>
            </li>
          ))}
        </ul>
        <Button size="sm" variant="glass" className="mt-2" disabled={count >= SCENARIO_LIMITS.objects} onClick={() => set({ objects: [...spec.objects, { shape: 'cube', size: [5], color: COLORS[spec.objects.length % COLORS.length], n: 1 }] })}><Plus /> An object</Button>
      </fieldset>

      <fieldset className="mt-5">
        <legend className="eyebrow text-[0.62rem] text-muted-foreground">Trays · {spec.trays.length} of {SCENARIO_LIMITS.trays}</legend>
        <ul className="mt-2 space-y-2">
          {spec.trays.map((t, i) => (
            <li key={i} className="flex flex-wrap items-end gap-x-3 gap-y-2 rounded-lg bg-white/3 px-3 py-2">
              <label className="flex flex-col gap-0.5"><span className="text-[0.68rem] text-muted-foreground">Name</span>
                <input className={cn(FIELD, 'w-24')} value={t.name} maxLength={12} onChange={ev => setTray(i, { name: ev.target.value })} />
              </label>
              <Swatches label="Colour" value={t.color} onChange={color => setTray(i, { color })} />
              <Num label="Round from ahead" unit="°" value={t.at[0]} min={-SCENARIO_LIMITS.trayAt.a} max={SCENARIO_LIMITS.trayAt.a} step={5} onChange={v => setTray(i, { at: [v, t.at[1]] })} />
              <Num label="Out from the arm" unit="cm" value={t.at[1]} min={SCENARIO_LIMITS.trayAt.r[0]} max={SCENARIO_LIMITS.trayAt.r[1]} step={1} onChange={v => setTray(i, { at: [t.at[0], v] })} />
              <Num label="Width" unit="cm" value={t.size[0]} min={SCENARIO_LIMITS.traySize[0]} max={SCENARIO_LIMITS.traySize[1]} step={1} onChange={v => setTray(i, { size: [v, t.size[1]] })} />
              <Num label="Depth" unit="cm" value={t.size[1]} min={SCENARIO_LIMITS.traySize[0]} max={SCENARIO_LIMITS.traySize[1]} step={1} onChange={v => setTray(i, { size: [t.size[0], v] })} />
              <Button size="icon" variant="ghost" className="ml-auto size-8" aria-label={`Take tray ${t.name} away`} onClick={() => set({ trays: spec.trays.filter((_, k) => k !== i) })}><Trash2 /></Button>
            </li>
          ))}
        </ul>
        <Button size="sm" variant="glass" className="mt-2" disabled={spec.trays.length >= SCENARIO_LIMITS.trays} onClick={() => {
          const n = spec.trays.length, at: [number, number] = [[100, 30], [-100, 30], [140, 28], [-140, 28]][n] as [number, number] ?? [120, 30];
          set({ trays: [...spec.trays, { name: String.fromCharCode(65 + n), color: (['green', 'blue', 'yellow', 'purple'] as ColorName[])[n] ?? 'grey', at, size: [14, 14] }] });
        }}><Plus /> A tray</Button>
        <p className="mt-2 text-xs text-muted-foreground">Round from ahead: 0° is straight ahead of the arm, positive to its left. The objects are put between 20 and 42 cm out, up to 57° either side of ahead; keep the trays out of their way.</p>
      </fieldset>

      <div className="mt-5">
        <label htmlFor={rulesId} className="eyebrow text-[0.62rem] text-muted-foreground">Rules: where each goes</label>
        <textarea id={rulesId} rows={Math.max(3, spec.rules.split('\n').length + 1)} spellCheck={false} maxLength={SCENARIO_LIMITS.rules}
          aria-describedby={`${rulesHelp}${lineErrors.length ? ` ${errId}` : ''}`} aria-invalid={lineErrors.length > 0}
          className={cn(FIELD, 'mt-2 block w-full resize-y font-mono leading-6', lineErrors.length && 'border-destructive/70')}
          value={spec.rules} onChange={ev => set({ rules: ev.target.value })} placeholder={'red → A\nball → B\nanything else → stays'} />
        <p id={rulesHelp} className="mt-1.5 text-xs text-muted-foreground">
          One a line, <span className="font-mono text-foreground">what → tray</span> (or <span className="font-mono">-&gt;</span>, <span className="font-mono">to</span>); the first line that fits an object says where it goes, and <span className="font-mono">stays</span> leaves it where it is.
          What: a shape (cube, box, ball, cylinder), a colour, <span className="font-mono">small</span> / <span className="font-mono">big</span> (against the others here), <span className="font-mono">wider than 5 cm</span>, <span className="font-mono">taller than</span>, <span className="font-mono">heavier than 100 g</span>; several words must all fit, <span className="font-mono">or</span> gives a choice, <span className="font-mono">not</span> turns one round, <span className="font-mono">anything</span> fits all. The objects are moved in the order they are listed.
        </p>
        {lineErrors.length > 0 && <ul id={errId} className="mt-2 space-y-0.5 text-xs text-destructive">{lineErrors.map((e, i) => <li key={i}>{e.msg}</li>)}</ul>}
      </div>

      <div className="mt-4">
        <p className="eyebrow text-[0.62rem] text-muted-foreground">What happens to each</p>
        <ul className="mt-2 flex flex-wrap gap-1.5 text-xs">
          {check.objects.map((o, i) => (
            <li key={i} className="flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1">
              <span aria-hidden className={cn('inline-block size-2.5', o.shape === 'ball' || o.shape === 'cylinder' ? 'rounded-full' : 'rounded-[2px]')} style={{ background: css(o.color) }} />
              <span>{o.color} {SHAPES[o.shape].name.toLowerCase()} {o.size.join(' × ')} cm</span>
              <span className="text-muted-foreground">→ {o.to ? <span className="font-medium text-foreground">{o.to}</span> : 'stays'}{o.rule ? ` (line ${o.rule})` : ' (no rule fits)'}</span>
            </li>
          ))}
        </ul>
        {(otherErrors.length > 0 || check.warnings.length > 0) && (
          <ul className="mt-3 space-y-1 text-xs" aria-live="polite">
            {otherErrors.map((e, i) => <li key={`e${i}`} className="text-destructive">{e.msg}</li>)}
            {check.warnings.map((w, i) => <li key={`w${i}`} className="text-muted-foreground">Note: {w.msg}</li>)}
          </ul>
        )}
      </div>
    </section>
  );
}
