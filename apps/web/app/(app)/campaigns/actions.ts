'use server';

import {
  isPlanRequiredError,
  planLimits,
  requireFeature,
  resolvePlan,
} from '@clipal/billing';
import {
  and,
  campaigns,
  count,
  db,
  eq,
  links,
  recordAudit,
} from '@clipal/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormActionState } from '@/lib/action-state';
import { requireUser } from '@/lib/auth';

const NAME_MAX = 120;
const NOTES_MAX = 2000;

/** Map a PlanRequiredError to a FormActionState; rethrow anything else. */
function planError(err: unknown): FormActionState {
  if (isPlanRequiredError(err)) return { error: err.message };
  throw err;
}

/** Load a campaign the current user owns, or null. */
async function ownedCampaign(campaignId: string, userId: string) {
  if (!campaignId) return null;
  const [row] = await db
    .select({ id: campaigns.id, name: campaigns.name })
    .from(campaigns)
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, userId)))
    .limit(1);
  return row ?? null;
}

/**
 * Create a campaign (A/B-test container). Gated behind `abTesting` — campaigns
 * exist to back A/B tests — and capped by the plan's `activeCampaigns` limit
 * (null = unlimited, 0 = unavailable). requireUser + recordAudit + revalidate.
 */
export async function createCampaignAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const user = await requireUser();
  const name = String(formData.get('name') ?? '').trim();
  const notes = String(formData.get('notes') ?? '').trim();

  if (!name) return { error: 'Enter a campaign name.' };
  if (name.length > NAME_MAX) return { error: `Name must be ${NAME_MAX} characters or fewer.` };
  if (notes.length > NOTES_MAX) return { error: `Notes must be ${NOTES_MAX} characters or fewer.` };

  const plan = await resolvePlan(user.id);
  try {
    requireFeature(plan, 'abTesting');
  } catch (err) {
    return planError(err);
  }

  // Enforce the active-campaign quota. `null` => unlimited; a number is a hard cap.
  const limit = planLimits(plan).activeCampaigns;
  if (limit !== null) {
    const [row] = await db
      .select({ c: count() })
      .from(campaigns)
      .where(eq(campaigns.userId, user.id));
    const current = row?.c ?? 0;
    if (current >= limit) {
      return {
        error:
          limit === 0
            ? 'Your plan does not include campaigns.'
            : `You have reached your plan limit of ${limit} active campaign${limit === 1 ? '' : 's'}.`,
      };
    }
  }

  const [created] = await db
    .insert(campaigns)
    .values({ userId: user.id, name, notes: notes || null })
    .returning({ id: campaigns.id });

  if (created) {
    await recordAudit(db, {
      actorId: user.id,
      action: 'campaign.created',
      targetType: 'campaign',
      targetId: created.id,
      metadata: { name },
    });
  }

  revalidatePath('/campaigns');
  return { ok: true };
}

/** Rename a campaign (and optionally edit its notes). Own-the-campaign guard. */
export async function renameCampaignAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const user = await requireUser();
  const campaignId = String(formData.get('campaignId') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  const notes = String(formData.get('notes') ?? '').trim();

  const campaign = await ownedCampaign(campaignId, user.id);
  if (!campaign) return { error: 'Campaign not found.' };

  if (!name) return { error: 'Enter a campaign name.' };
  if (name.length > NAME_MAX) return { error: `Name must be ${NAME_MAX} characters or fewer.` };
  if (notes.length > NOTES_MAX) return { error: `Notes must be ${NOTES_MAX} characters or fewer.` };

  await db
    .update(campaigns)
    .set({ name, notes: notes || null })
    .where(eq(campaigns.id, campaignId));

  await recordAudit(db, {
    actorId: user.id,
    action: 'campaign.renamed',
    targetType: 'campaign',
    targetId: campaignId,
    metadata: { name, previousName: campaign.name },
  });

  revalidatePath('/campaigns');
  revalidatePath(`/campaigns/${campaignId}`);
  return { ok: true };
}

/**
 * Delete a campaign. The FK on `links.campaign_id` is `ON DELETE SET NULL`, so a
 * delete would silently detach links. We make that explicit and opt-in:
 *  - `detach` (default): clear the campaign from any links first, then delete.
 *  - otherwise: BLOCK the delete while links are still assigned, so the user
 *    can't lose the grouping by accident.
 * Own-the-campaign guard + recordAudit. Redirects back to the list.
 */
export async function deleteCampaignAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const campaignId = String(formData.get('campaignId') ?? '');
  const mode = String(formData.get('mode') ?? '').trim(); // 'detach' to force

  const campaign = await ownedCampaign(campaignId, user.id);
  if (!campaign) redirect('/campaigns');

  // Count links still pointing at this campaign (scoped to the owner).
  const [linkCountRow] = await db
    .select({ c: count() })
    .from(links)
    .where(and(eq(links.campaignId, campaignId), eq(links.ownerId, user.id)));
  const linkCount = linkCountRow?.c ?? 0;

  if (linkCount > 0 && mode !== 'detach') {
    // Block: surface the dependency on the detail page rather than silently
    // orphaning links. The UI offers an explicit "detach & delete" path.
    redirect(`/campaigns/${campaignId}?error=has_links`);
  }

  await db.transaction(async (tx) => {
    if (linkCount > 0) {
      await tx
        .update(links)
        .set({ campaignId: null })
        .where(and(eq(links.campaignId, campaignId), eq(links.ownerId, user.id)));
    }
    await tx.delete(campaigns).where(eq(campaigns.id, campaignId));
  });

  await recordAudit(db, {
    actorId: user.id,
    action: 'campaign.deleted',
    targetType: 'campaign',
    targetId: campaignId,
    metadata: { name: campaign.name, detachedLinks: linkCount },
  });

  revalidatePath('/campaigns');
  redirect('/campaigns');
}
