import { cn } from '@/lib/utils';

export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-semibold tracking-tight', className)}>
      <svg aria-hidden viewBox="0 0 32 32" className="size-[1.4em]">
        <path d="M2 24c5-7 9-9 14-9s9 2 14 9" fill="none" stroke="var(--color-primary)" strokeWidth="3" strokeLinecap="round" />
        <circle cx="10" cy="25" r="3.2" fill="currentColor" />
        <circle cx="22" cy="25" r="3.2" fill="currentColor" />
      </svg>
      Sand Buggy Rally
    </span>
  );
}
