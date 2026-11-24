import { cn } from '@/lib/utils';

// The mark: a lap, open like a C, from a human (orange) to a tiny neural network (cyan).
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 32 32" className={cn('size-[1.5em] shrink-0', className)}>
      <defs>
        <linearGradient id="carsim-lap" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.1" stopColor="var(--human)" />
          <stop offset="0.9" stopColor="var(--tnn)" />
        </linearGradient>
      </defs>
      <path d="M22.4 8.3A10 10 0 1 0 22.4 23.7" fill="none" stroke="url(#carsim-lap)" strokeWidth="4.2" strokeLinecap="round" />
      <circle cx="22.4" cy="8.3" r="3.4" fill="var(--human)" />
      <circle cx="22.4" cy="23.7" r="3.4" fill="var(--tnn)" />
    </svg>
  );
}

export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <BrandMark />
      <span className="heading text-[1.15em] tracking-tight">Carsim</span>
    </span>
  );
}
