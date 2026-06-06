import type { SessionUser } from '@clipal/auth';
import Link from 'next/link';
import { UserMenu } from './user-menu';

export function AppHeader({ user }: { user: SessionUser }) {
  return (
    <header className="sticky top-0 z-40 h-14 border-b border-zinc-200 bg-zinc-50/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <Link
          href="/dashboard"
          className="font-mono text-sm font-medium tracking-tight text-zinc-950 dark:text-zinc-50"
        >
          clip.al
        </Link>
        <UserMenu user={user} />
      </div>
    </header>
  );
}
