import { CODE_REGEX } from '@clipal/config/constants';
import { Badge, Card, CardContent } from '@clipal/ui';
import { ShieldCheck, ShieldQuestion } from 'lucide-react';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { InterstitialCountdown } from '@/components/interstitial-countdown';
import { ReportDialog } from '@/components/report-dialog';
import { pwCookieName, verifyPwCookie } from '@/lib/pw';
import { parseCookies } from '@/lib/request';
import { resolveHostDomain } from '@/lib/domain-context';
import { isExpired, resolveCachedLink } from '@/lib/resolve';
import { PasswordForm } from './password-form';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata: Metadata = { title: 'Redirecting…', robots: { index: false } };

function truncateMiddle(value: string, max = 72): string {
  if (value.length <= max) return value;
  const half = Math.floor((max - 1) / 2);
  return `${value.slice(0, half)}…${value.slice(value.length - half)}`;
}

export default async function InterstitialPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  if (!CODE_REGEX.test(code)) notFound();

  const domainId = await resolveHostDomain((await headers()).get('host'));
  const result = await resolveCachedLink(code, domainId);
  if (result.kind !== 'ok') notFound();
  const link = result.link;

  const now = Date.now();

  // 1. Expiry — same terminal page the hot path (`/r`) uses.
  if (isExpired(link, now)) redirect(`/p/${code}/expired`);

  // 2. Password gate. With no valid proof cookie we render the form and NEVER
  //    reveal the destination (resolveDestination is not even consulted here).
  if (link.hasPassword) {
    const hdrs = await headers();
    const cookies = parseCookies(hdrs);
    if (!verifyPwCookie(code, cookies.get(pwCookieName(code)), now)) {
      return <PasswordForm code={code} />;
    }
  }

  // 3. Cleared all gates — render the standard interstitial. The actual
  //    click-limit + routing is enforced on Continue (`/p/[code]/go`); here we
  //    only show the fallback destination, exactly as before.
  const safe = link.safety === 'clean';
  let host = link.url;
  try {
    host = new URL(link.url).host;
  } catch {
    /* keep the raw value */
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-between">
          <Link
            href="/"
            className="font-mono text-sm font-medium tracking-tight text-zinc-950 dark:text-zinc-50"
          >
            clip.al
          </Link>
          <span className="text-sm text-zinc-500">You’re being redirected</span>
        </div>

        <Card>
          <CardContent className="space-y-5 p-6">
            <div className="space-y-1">
              <p className="text-xs text-zinc-500">Destination</p>
              <p className="break-all font-mono text-sm text-zinc-950 dark:text-zinc-50">
                {truncateMiddle(link.url)}
              </p>
              <p className="text-xs text-zinc-500">{host}</p>
            </div>

            <div className="flex items-center justify-between">
              <Badge variant="neutral">
                {safe ? <ShieldCheck className="size-3.5" /> : <ShieldQuestion className="size-3.5" />}
                {safe ? 'Checked · Safe' : 'Unverified'}
              </Badge>
              <ReportDialog code={code} />
            </div>

            <InterstitialCountdown goHref={`/p/${code}/go`} />
          </CardContent>
        </Card>

        {/* Reserved 728×90 ad slot — Phase 2 fills this. Do not load AdSense yet. */}
        <div
          id="ad-slot"
          aria-hidden
          className="mx-auto mt-6 h-[90px] w-full max-w-[728px] rounded-md border border-dashed border-zinc-200 dark:border-zinc-800"
        />

        <p className="mt-6 text-center text-xs text-zinc-500">
          Why am I seeing this? clip.al checks destinations for safety. Premium users skip this
          page.{' '}
          <Link href="/help#interstitial" className="underline underline-offset-2">
            Learn more
          </Link>
        </p>
      </div>
    </div>
  );
}
