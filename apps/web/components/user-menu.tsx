'use client';

import type { SessionUser } from '@clipal/auth';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@clipal/ui';
import { ChevronDown, CreditCard, LogOut, Settings, Shield } from 'lucide-react';
import Link from 'next/link';
import { useRef } from 'react';

export function UserMenu({ user }: { user: SessionUser }) {
  const isAdmin = user.role === 'admin' || user.role === 'moderator';
  const initial = (user.displayName ?? user.email).charAt(0).toUpperCase();
  const logoutFormRef = useRef<HTMLFormElement>(null);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-zinc-700 transition-colors hover:bg-zinc-100 focus-visible:outline-none dark:text-zinc-300 dark:hover:bg-zinc-800">
        <span className="flex size-6 items-center justify-center rounded-full bg-zinc-200 text-xs font-medium text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
          {initial}
        </span>
        <span className="hidden max-w-40 truncate sm:inline">{user.email}</span>
        <ChevronDown className="size-4 text-zinc-400" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuLabel className="truncate">{user.email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings className="size-4" /> Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/billing">
            <CreditCard className="size-4" /> Billing
          </Link>
        </DropdownMenuItem>
        {isAdmin ? (
          <DropdownMenuItem asChild>
            <Link href="/admin">
              <Shield className="size-4" /> Admin
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <form ref={logoutFormRef} action="/logout" method="post">
          <DropdownMenuItem
            // Radix closes (and unmounts) the menu on select, which would tear
            // this form down before the browser submits it — so the click looked
            // dead. Keep the menu mounted, then fire the POST ourselves.
            onSelect={(event) => {
              event.preventDefault();
              logoutFormRef.current?.requestSubmit();
            }}
          >
            <LogOut className="size-4" /> Sign out
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
