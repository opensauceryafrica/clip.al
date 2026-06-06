import Link from 'next/link';
import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 py-12">
      <Link
        href="/"
        className="mb-8 font-mono text-sm font-medium tracking-tight text-zinc-950 dark:text-zinc-50"
      >
        clip.al
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
