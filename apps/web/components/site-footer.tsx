import Link from 'next/link';
import pkg from '../package.json';

const LEGAL = [
  { href: '/tos', label: 'Terms' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/aup', label: 'Acceptable use' },
  { href: '/dmca', label: 'DMCA' },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-8 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {LEGAL.map((l) => (
            <Link key={l.href} href={l.href} className="transition-colors hover:text-zinc-950 dark:hover:text-zinc-50">
              {l.label}
            </Link>
          ))}
          <a
            href="https://github.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-zinc-950 dark:hover:text-zinc-50"
          >
            GitHub
          </a>
          <Link href="/help" className="transition-colors hover:text-zinc-950 dark:hover:text-zinc-50">
            Status
          </Link>
        </div>
        <div className="flex items-center gap-3 font-mono text-xs text-zinc-500">
          <span>clip.al</span>
          <span aria-hidden>·</span>
          <span>v{pkg.version}</span>
        </div>
      </div>
    </footer>
  );
}
