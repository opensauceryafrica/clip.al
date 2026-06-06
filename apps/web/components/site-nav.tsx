import { Button } from '@clipal/ui';
import Link from 'next/link';
import { getSessionUser } from '@/lib/auth';

const NAV_LINKS = [
  { href: '/pricing', label: 'Pricing' },
  { href: '/help', label: 'Help' },
  { href: '/changelog', label: 'Changelog' },
];

export async function SiteNav() {
  const user = await getSessionUser();
  return (
    <header className="sticky top-0 z-40 h-14 border-b border-zinc-200 bg-zinc-50/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="font-mono text-sm font-medium tracking-tight text-zinc-950 dark:text-zinc-50">
          clip.al
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-zinc-600 dark:text-zinc-400 sm:flex">
          {NAV_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="transition-colors hover:text-zinc-950 dark:hover:text-zinc-50">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          {user ? (
            <Button asChild size="sm" variant="secondary">
              <Link href="/dashboard">Dashboard</Link>
            </Button>
          ) : (
            <>
              <Button asChild size="sm" variant="ghost">
                <Link href="/signin">Sign in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/signin">Get started</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
