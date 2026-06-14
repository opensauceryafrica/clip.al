import { hasCapability, PLANS, type Feature, type PlanLimits, type PlanName } from '@clipal/config';
import { PlanRequiredError } from './errors';

/**
 * Pure capability check. Returns whether `plan` may use `feature`. Thin wrapper
 * over `hasCapability` from the config plan table so billing is the single
 * import surface for enforcement.
 */
export function can(plan: PlanName, feature: Feature): boolean {
  return hasCapability(plan, feature);
}

/**
 * Enforcing variant: throws {@link PlanRequiredError} when `plan` lacks
 * `feature`. Callers map the error to a 403 / `plan_required` response.
 */
export function requireFeature(plan: PlanName, feature: Feature): void {
  if (!can(plan, feature)) throw new PlanRequiredError(plan, feature);
}

/** The numeric/boolean quota object for `plan` (see config `PlanLimits`). */
export function planLimits(plan: PlanName): PlanLimits {
  return PLANS[plan].limits;
}
