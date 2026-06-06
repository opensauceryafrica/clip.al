'use client';

import { TableCell, TableRow } from '@clipal/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { MouseEvent } from 'react';
import { LinkStatusBadge } from '@/components/link-status-badge';
import { formatNumber, timeAgo, truncateMiddle } from '@/lib/format';

export interface LinkRowData {
  id: string;
  code: string;
  destinationUrl: string;
  status: string;
  clicksTotal: number;
  createdAt: Date;
}

/**
 * A links-table row where clicking anywhere opens the single-link view. The code
 * stays a real <Link> so keyboard, screen readers and ⌘/Ctrl-click (open in new
 * tab) keep working; the row onClick only handles plain left-clicks on the
 * non-interactive areas, deferring to any real anchor/button it contains.
 */
export function LinkRow({ link }: { link: LinkRowData }) {
  const router = useRouter();
  const href = `/links/${link.id}`;

  function handleClick(event: MouseEvent<HTMLTableRowElement>) {
    if (event.defaultPrevented) return;
    // Leave new-tab / modified clicks to the browser; don't hijack them.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    // Real links/buttons inside the row handle their own clicks.
    if ((event.target as HTMLElement).closest('a, button')) return;
    router.push(href);
  }

  return (
    <TableRow onClick={handleClick} className="cursor-pointer">
      <TableCell>
        <Link href={href} className="font-mono text-foreground hover:underline">
          {link.code}
        </Link>
      </TableCell>
      <TableCell className="max-w-sm">
        <span className="font-mono text-xs text-muted-foreground">
          {truncateMiddle(link.destinationUrl, 56)}
        </span>
      </TableCell>
      <TableCell>
        <LinkStatusBadge status={link.status} />
      </TableCell>
      <TableCell className="text-right tabular-nums">{formatNumber(link.clicksTotal)}</TableCell>
      <TableCell className="text-right text-xs text-muted-foreground">
        {timeAgo(link.createdAt)}
      </TableCell>
    </TableRow>
  );
}
