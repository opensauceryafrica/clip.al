import type { Feature, PlanName } from '@clipal/config';

/**
 * Thrown by `requireFeature` when the active plan lacks a capability. Callers at
 * the API/UI boundary catch this and map it to a 403 with a `plan_required`
 * code, surfacing the gating `feature` and the caller's current `plan`.
 */
export class PlanRequiredError extends Error {
  /** Stable discriminator so callers can `err.code === 'plan_required'` without `instanceof`. */
  readonly code = 'plan_required' as const;
  /** The capability the caller attempted to use. */
  readonly feature: Feature;
  /** The plan the caller is currently on. */
  readonly plan: PlanName;

  constructor(plan: PlanName, feature: Feature) {
    super(`Feature "${feature}" is not available on the "${plan}" plan.`);
    this.name = 'PlanRequiredError';
    this.plan = plan;
    this.feature = feature;
    // Restore the prototype chain across the TS `extends Error` downlevel.
    Object.setPrototypeOf(this, PlanRequiredError.prototype);
  }
}

/** Narrowing helper for callers that prefer a guard over `instanceof`. */
export function isPlanRequiredError(err: unknown): err is PlanRequiredError {
  return err instanceof PlanRequiredError;
}
