import { can, resolvePlan } from '@clipal/billing';
import { getPublicBaseUrl } from '@clipal/config';
import { campaigns, db, desc, eq } from '@clipal/db';
import { Card, CardContent } from '@clipal/ui';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import {
  LinkBuilderForm,
  type BuilderCapabilities,
  type CampaignOption,
} from '@/components/link-builder-form';
import { requireUser } from '@/lib/auth';

export const metadata: Metadata = { title: 'New link' };
export const dynamic = 'force-dynamic';

export default async function NewLinkPage() {
  const user = await requireUser();
  const plan = await resolvePlan(user.id);

  // Capability snapshot drives the lock UI; the action re-enforces server-side.
  const caps: BuilderCapabilities = {
    customSlugs: can(plan, 'customSlugs'),
    password: can(plan, 'password'),
    expiry: can(plan, 'expiry'),
    geoRouting: can(plan, 'geoRouting'),
    deviceRouting: can(plan, 'deviceRouting'),
    abTesting: can(plan, 'abTesting'),
  };

  const rows = await db
    .select({ id: campaigns.id, name: campaigns.name })
    .from(campaigns)
    .where(eq(campaigns.userId, user.id))
    .orderBy(desc(campaigns.createdAt))
    .limit(100);
  const campaignOptions: CampaignOption[] = rows;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="New link"
        description="Build a short link with custom routing, protection, and expiry."
      />
      <Card>
        <CardContent className="p-6">
          <LinkBuilderForm baseUrl={getPublicBaseUrl()} caps={caps} campaigns={campaignOptions} />
        </CardContent>
      </Card>
    </div>
  );
}
