import { Card, CardContent } from '@clipal/ui';
import type { Metadata } from 'next';
import { ShortenForm } from '@/components/shorten-form';
import { PageHeader } from '@/components/page-header';
import { requireUser } from '@/lib/auth';

export const metadata: Metadata = { title: 'New link' };
export const dynamic = 'force-dynamic';

export default async function NewLinkPage() {
  await requireUser();
  // Authed shortening: the action skips Turnstile and owns the link, so no
  // captcha widget here (no siteKey passed).
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="New link" description="Paste a long URL to shorten it." />
      <Card>
        <CardContent className="p-6">
          <ShortenForm />
        </CardContent>
      </Card>
    </div>
  );
}
