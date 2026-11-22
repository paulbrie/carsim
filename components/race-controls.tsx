'use client';
// Room settings and car choice: ui-sdk's SegmentedControl, Select and ColorPicker (shadcn has none
// of them here), styled in app/globals.css (.seg*, .sel-*, .cp-*).
import { useEffect, useState } from 'react';
import { SegmentedControl, SegmentedControlIndicator, SegmentedControlItem } from '@ui-sdk/react/segmented-control';
import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectTrigger, SelectValue } from '@ui-sdk/react/select';
import { Check, ChevronDown } from 'lucide-react';
import {
  ColorPicker, ColorPickerArea, ColorPickerAreaThumb, ColorPickerSlider, ColorPickerSliderThumb, ColorPickerSwatches, ColorPickerSwatchItem,
} from '@ui-sdk/react/color-picker';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { GROUNDS, PAINTS, VEHICLES, WEATHERS } from '@/lib/race/shared.mjs';
import type { NetStatus } from '@/lib/client/net';
import type { MapSummary } from '@/lib/maps/store.mjs';

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

/** The course: the maps the super admin made (the room's own shows even before the list has loaded). */
export function MapControl({ value, maps, onChange, disabled, id }: { value: { id: string; name: string }; maps: MapSummary[]; onChange: (id: string) => void; disabled?: boolean; id?: string }) {
  const items = maps.map(m => ({ value: m.id, label: m.name }));
  if (!items.some(i => i.value === value.id)) items.unshift({ value: value.id, label: value.name });
  // the Select's hidden form field doesn't hydrate cleanly (its inline style is serialised differently
  // on the server), so it renders in the browser only, after a look-alike
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return (
    <button type="button" id={id} aria-label="Map" disabled className="sel-trigger">
      <span className="truncate">{value.name}</span>
      <ChevronDown aria-hidden className="ml-auto size-4 shrink-0 opacity-60" />
    </button>
  );
  return (
    <Select items={items} value={value.id} disabled={disabled} onValueChange={(v: string | null) => { if (v && v !== value.id) onChange(v); }}>
      <SelectTrigger id={id} aria-label="Map" className="sel-trigger">
        <SelectValue className="truncate" />
        <ChevronDown aria-hidden className="ml-auto size-4 shrink-0 opacity-60" />
      </SelectTrigger>
      <SelectContent className="sel-content">
        {items.map(i => (
          <SelectItem key={i.value} value={i.value} className="sel-item">
            <span className="truncate">{i.label}</span>
            <SelectItemIndicator className="ml-auto"><Check className="size-4" /></SelectItemIndicator>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
    <Badge variant="outline" className="gap-1.5 font-normal" aria-live="polite">
      <span aria-hidden className={cn('size-2 rounded-full', dot)} /> {label}
    </Badge>
  );
}

export const fmtTime = (t: number | null | undefined) => {
  if (t == null || !Number.isFinite(t)) return '–:––.–––';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
};
