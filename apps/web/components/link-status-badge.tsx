import { Badge } from '@clipal/ui';

type BadgeVariant = 'neutral' | 'active' | 'disabled' | 'pending' | 'danger';

const STATUS: Record<string, { label: string; variant: BadgeVariant }> = {
  active: { label: 'Active', variant: 'active' },
  disabled_by_user: { label: 'Disabled', variant: 'disabled' },
  disabled_by_admin: { label: 'Disabled by admin', variant: 'disabled' },
  disabled_by_safety: { label: 'Blocked (safety)', variant: 'danger' },
  pending_review: { label: 'Pending review', variant: 'pending' },
};

const SAFETY: Record<string, { label: string; variant: BadgeVariant }> = {
  unchecked: { label: 'Unchecked', variant: 'neutral' },
  clean: { label: 'Clean', variant: 'active' },
  suspicious: { label: 'Suspicious', variant: 'pending' },
  malicious: { label: 'Malicious', variant: 'danger' },
};

export function LinkStatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, variant: 'neutral' as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

export function SafetyBadge({ state }: { state: string }) {
  const s = SAFETY[state] ?? { label: state, variant: 'neutral' as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}
