'use client';
import Link from 'next/link';
import { Bot, LogOut, Map as MapIcon } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { signOutAction } from '@/app/actions';

export function DriverAvatar({ name, image, className }: { name: string; image: string | null; className?: string }) {
  return (
    <Avatar className={className}>
      {image && <AvatarImage src={image} alt="" referrerPolicy="no-referrer" />}
      <AvatarFallback className="text-xs font-semibold">{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

export const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?';

export function UserMenu({ user }: { user: { name: string; image: string | null; admin?: boolean } }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 gap-2 px-2">
          <DriverAvatar name={user.name} image={user.image} className="size-7" />
          <span className="hidden max-w-40 truncate sm:inline lg:hidden xl:inline">{user.name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="truncate">{user.name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {user.admin && (
          <>
            <DropdownMenuItem asChild><Link href="/maps"><MapIcon /> Maps</Link></DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem asChild><Link href="/agents/claim"><Bot /> Your agents</Link></DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => signOutAction()}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
