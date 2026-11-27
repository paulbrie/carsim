'use client';
import Link from 'next/link';
import { Menu, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Brand } from '@/components/brand';
import { UserMenu } from '@/components/user-menu';
import { cn } from '@/lib/utils';

export type NavKey = 'home' | 'leaderboard' | 'networks' | 'tnn' | 'tech' | 'developers' | 'agents' | 'race' | 'maps' | 'signin';
export interface NavUser { name: string; image: string | null; admin?: boolean }

const LINKS: { key: NavKey; href: string; label: string }[] = [
  { key: 'race', href: '/lobby', label: 'Race' },
  { key: 'leaderboard', href: '/leaderboard', label: 'Leaderboard' },
  { key: 'networks', href: '/networks', label: 'Networks' },
  { key: 'tnn', href: '/tnn', label: 'What is a TNN?' },
  { key: 'tech', href: '/tech', label: 'Tech' },
  { key: 'developers', href: '/developers', label: 'Developers' },
  { key: 'agents', href: '/agents', label: 'Agents' },
];

/**
 * The bar at the top of every page: the logo, where to go, Drive, and who you are. The links are in the bar from `lg`
 * (under it, in the menu button's list), closer together and without "How it works" until `xl`: eight of them, Drive
 * and a signed-in driver's name don't fit a 1024 px window otherwise (they wrapped, then pushed Drive off the screen).
 */
export function SiteNav({ user, active, children, className }: { user: NavUser | null; active?: NavKey; children?: React.ReactNode; className?: string }) {
  return (
    <header className={cn('sticky top-0 z-30 border-b border-white/6 bg-background/75 backdrop-blur-xl', className)}>
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 sm:px-6">
        <Link href="/" className="-ml-1 rounded-lg px-1 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Carsim, home">
          <Brand className="text-base" />
        </Link>
        <nav aria-label="Main" className="ml-3 hidden items-center gap-1 lg:flex xl:ml-6">
          {LINKS.map(l => (
            <Link key={l.key} href={l.href} aria-current={active === l.key ? 'page' : undefined}
              className={cn('rounded-lg px-2 py-2 text-sm font-medium whitespace-nowrap text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring xl:px-3', active === l.key && 'bg-white/6 text-foreground')}>
              {l.label}
            </Link>
          ))}
          <Link href="/#how" className="hidden rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring xl:block">How it works</Link>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {children}
          <Button asChild size="lg" className="hidden px-3.5 font-semibold sm:inline-flex">
            <Link href="/lobby"><Play className="fill-current" /> Drive</Link>
          </Button>
          {user ? <UserMenu user={user} /> : active !== 'signin' && <Button asChild variant="glass" size="lg" className="px-3.5"><Link href="/signin">Sign in</Link></Button>}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-lg" className="lg:hidden" aria-label="Menu"><Menu /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {LINKS.map(l => <DropdownMenuItem key={l.key} asChild><Link href={l.href}>{l.label}</Link></DropdownMenuItem>)}
              <DropdownMenuItem asChild><Link href="/#how">How it works</Link></DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
