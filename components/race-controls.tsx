'use client';
// Room settings and car choice: ui-sdk's SegmentedControl and ColorPicker (shadcn has none
// of them here), styled in app/globals.css (.seg*, .cp-*); the track picker's cards.
import { useEffect, useState } from 'react';
import { SegmentedControl, SegmentedControlIndicator, SegmentedControlItem } from '@ui-sdk/react/segmented-control';
import {
  ColorPicker, ColorPickerArea, ColorPickerAreaThumb, ColorPickerSlider, ColorPickerSliderThumb, ColorPickerSwatches, ColorPickerSwatchItem,
} from '@ui-sdk/react/color-picker';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { GROUNDS, PAINTS, VEHICLES, WEATHERS } from '@/lib/race/shared.mjs';
import type { NetStatus } from '@/lib/client/net';
import type { MapSummary } from '@/lib/maps/store.mjs';
import { TrackOutline } from '@/components/track-outline';

export const LAP_CHOICES = [1, 2, 3, 5, 10];
export const vehicleName = (key: string) => VEHICLES.find(v => v.key === key)?.name ?? key;
export const groundName = (key: string) => GROUNDS.find(g => g.key === key)?.name ?? key;
/** the colour a car shows when its driver has not painted it: the sim's factory colours */
export const DEFAULT_PAINT: Record<string, string> = {
  buggy: '#d9360b', supra: '#b3121b', x7: '#1d4032', rs6: '#a3070c', bmw7: '#14181e', navigator: '#eeeeea', cayenne: '#2c4f46', quattroporte: '#12307a',
  xjr: '#0f3b26', sl63: '#0d1b3a', p911: '#9a9da1', cayennets: '#4a3a2c', gt500: '#12407c', x5m: '#1c4f91', gle63: '#7a1218',
};
export const paintOf = (vehicle: string, paint: string | null) => paint || DEFAULT_PAINT[vehicle] || '#888888';

export function GroundControl({ value, onChange, disabled, id }: { value: string; onChange: (v: string) => void; disabled?: boolean; id?: string }) {
  return (
    <SegmentedControl id={id} aria-label="Ground" className="seg" value={value} disabled={disabled} onValueChange={v => v && onChange(v)}>
      <SegmentedControlIndicator className="seg-indicator" />
      {GROUNDS.map(g => (
        <SegmentedControlItem key={g.key} value={g.key} className="seg-item" title={g.blurb}>{g.name}</SegmentedControlItem>
      ))}
    </SegmentedControl>
  );
}

/** The course, as cards: each track drawn (the room's own shows by name even before the list has loaded). */
export function TrackPicker({ value, maps, onChange, disabled, compact }: { value: { id: string; name: string }; maps: MapSummary[]; onChange: (id: string) => void; disabled?: boolean; compact?: boolean }) {
  const items: { id: string; name: string; wp?: [number, number][] }[] = maps.some(m => m.id === value.id) ? maps : [{ id: value.id, name: value.name }, ...maps];
  return (
    <div role="radiogroup" aria-label="Track" className={cn('grid gap-2', compact ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3')}>
      {items.map(m => {
        const on = m.id === value.id;
        return (
          <button key={m.id} type="button" role="radio" aria-checked={on} disabled={disabled} onClick={() => { if (!on) onChange(m.id); }}
            className={cn('group flex flex-col items-center gap-1 rounded-xl border px-2 pt-2 pb-2.5 text-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed',
              on ? 'border-primary/70 bg-primary/10 text-foreground' : 'border-white/8 bg-white/3 text-muted-foreground hover:border-white/20 hover:text-foreground disabled:opacity-50 disabled:hover:border-white/8')}>
            {m.wp ? <TrackOutline wp={m.wp} width={96} height={compact ? 48 : 60} stroke={2.6} className={cn('w-full', compact ? 'h-12' : 'h-15')} /> : <span className={compact ? 'h-12' : 'h-15'} />}
            <span className="w-full truncate text-sm font-medium">{m.name}</span>
          </button>
        );
      })}
    </div>
  );
}

export function WeatherControl({ value, onChange, disabled, id }: { value: string; onChange: (v: string) => void; disabled?: boolean; id?: string }) {
  return (
    <SegmentedControl id={id} aria-label="Weather" className="seg" value={value} disabled={disabled} onValueChange={v => v && onChange(v)}>
      <SegmentedControlIndicator className="seg-indicator" />
      {WEATHERS.map(w => (
        <SegmentedControlItem key={w.key} value={w.key} className="seg-item" title={w.blurb}>{w.name}</SegmentedControlItem>
      ))}
    </SegmentedControl>
  );
}

export function LapsControl({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <SegmentedControl aria-label="Laps" className="seg" value={String(value)} disabled={disabled} onValueChange={v => v && onChange(Number(v))}>
      <SegmentedControlIndicator className="seg-indicator" />
      {LAP_CHOICES.map(n => (
        <SegmentedControlItem key={n} value={String(n)} className="seg-item tabular-nums">{n}</SegmentedControlItem>
      ))}
    </SegmentedControl>
  );
}

/** Paint: the sim's presets, or any colour from the area and hue slider; committed on release. */
export function PaintPicker({ value, onCommit, disabled }: { value: string; onCommit: (hex: string) => void; disabled?: boolean }) {
  const [live, setLive] = useState(value);
  useEffect(() => setLive(value), [value]);
  return (
    <ColorPicker aria-label="Paint colour" className="space-y-3" value={live} format="hex" disabled={disabled}
      onValueChange={v => setLive(v)} onValueCommit={v => onCommit(v.toLowerCase())}>
      <ColorPickerSwatches aria-label="Factory colours" className="flex flex-wrap gap-2">
        {PAINTS.map(([name, hex]) => <ColorPickerSwatchItem key={hex} value={hex} title={name} className="cp-swatch" />)}
      </ColorPickerSwatches>
      <ColorPickerArea className="cp-area"><ColorPickerAreaThumb className="cp-thumb" /></ColorPickerArea>
      <ColorPickerSlider channel="hue" className="cp-slider"><ColorPickerSliderThumb className="cp-thumb" /></ColorPickerSlider>
    </ColorPicker>
  );
}

export function VehiclePicker({ value, onChange, disabled, paint }: { value: string; onChange: (key: string) => void; disabled?: boolean; paint: string | null }) {
  return (
    <div role="radiogroup" aria-label="Car" className="grid grid-cols-2 gap-2">
      {VEHICLES.map(v => {
        const on = v.key === value;
        return (
          <button key={v.key} type="button" role="radio" aria-checked={on} disabled={disabled} onClick={() => onChange(v.key)}
            className={cn('group flex items-start gap-2 rounded-lg border p-2 text-left text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
              on ? 'border-primary bg-primary/10' : 'hover:bg-accent')}>
            <span aria-hidden className="mt-1 size-3 shrink-0 rounded-full border border-white/30" style={{ background: on ? paintOf(v.key, paint) : DEFAULT_PAINT[v.key] }} />
            <span className="min-w-0">
              <span className="block truncate font-medium">{v.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{v.blurb}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function StatusBadge({ status }: { status: NetStatus }) {
  const map: Record<NetStatus, [string, string]> = {
    idle: ['Offline', 'bg-muted-foreground'], connecting: ['Connecting…', 'bg-amber-400 animate-pulse'], open: ['Online', 'bg-emerald-400'],
    closed: ['Reconnecting…', 'bg-amber-400 animate-pulse'], replaced: ['Open in another tab', 'bg-red-400'], unauthorized: ['Signed out', 'bg-red-400'],
  };
  const [label, dot] = map[status];
  return (
    <Badge variant="outline" className="h-7 gap-1.5 border-white/10 bg-white/4 px-2.5 font-normal text-muted-foreground" aria-live="polite">
      <span aria-hidden className={cn('size-2 rounded-full', dot)} /> {label}
    </Badge>
  );
}

export const fmtTime = (t: number | null | undefined) => {
  if (t == null || !Number.isFinite(t)) return '–:––.–––';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
};
