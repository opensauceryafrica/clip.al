'use client';

import { cn } from '@clipal/ui';
import {
  Ban,
  CreditCard,
  Flag,
  KeyRound,
  LayoutDashboard,
  Megaphone,
  Link2,
  Receipt,
  ScrollText,
  Tag,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const ITEMS: NavItem[] = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard },
  { href: '/admin/links', label: 'Links', icon: Link2 },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/reports', label: 'Reports', icon: Flag },
  { href: '/admin/subscriptions', label: 'Subscriptions', icon: CreditCard },
  { href: '/admin/invoices', label: 'Invoices', icon: Receipt },
  { href: '/admin/pricing', label: 'Pricing', icon: Tag },
  { href: '/admin/ads', label: 'Ads', icon: Megaphone },
  { href: '/admin/api-keys', label: 'API keys', icon: KeyRound },
  { href: '/admin/blocklist', label: 'Blocklist', icon: Ban },
  { href: '/admin/audit', label: 'Audit log', icon: ScrollText },
];

export function AdminSidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden w-60 shrink-0 border-r border-zinc-200 dark:border-zinc-800 md:block">
      <nav className="sticky top-14 flex flex-col gap-1 p-3">
        <p className="px-3 pb-2 text-xs font-medium uppercase tracking-wide text-zinc-400">Admin</p>
        {ITEMS.map(({ href, label, icon: Icon }) => {
          const active = href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                active
                  ? 'bg-zinc-100 font-medium text-zinc-950 dark:bg-zinc-800 dark:text-zinc-50'
                  : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50',
              )}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
