/**
 * @clipal/billing — pure plan/billing logic over Postgres + Redis. NO provider
 * SDK calls live here (Paystack/Polar integrations are separate packages); this
 * package answers "what plan is this user on, what may they do, what do they
 * pay, and how much have they used" deterministically.
 */

export { can, requireFeature, planLimits } from './capabilities';
export { PlanRequiredError, isPlanRequiredError } from './errors';
export { resolvePlan, bustPlanCache } from './plan';
export { effectivePrice } from './pricing';
export {
  billingContext,
  type BillingContext,
  type Processor,
} from './context';
export { incrementLinkUsage, getLinkUsage, usagePeriod } from './usage';
export {
  applyBillingEvent,
  startCheckout,
  verifyAndActivate,
  degradeUserToFree,
  restoreUserPlan,
  normalizePaystackEvent,
  normalizePolarEvent,
  paystackEventId,
  parseWebhookEvent,
  type NormalizedEvent,
  type NormalizedEventType,
  type NormalizedEventData,
  type ApplyResult,
  type StartCheckoutResult,
} from './subscription';
