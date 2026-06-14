# @clipal/billing

Pure plan / billing logic over Postgres + Redis. **No provider SDK calls** live
here — Paystack (NGN) and Polar.sh (USD) integrations are separate packages.
This package answers four questions deterministically:

| Question | Export |
| --- | --- |
| What plan is this user on? | `resolvePlan(userId)` (60s Redis cache, `bustPlanCache(userId)` to invalidate) |
| What may this plan do? | `can(plan, feature)`, `requireFeature(plan, feature)` (throws `PlanRequiredError`), `planLimits(plan)` |
| What do they pay? | `effectivePrice(plan, currency, interval)` — `plan_prices` override ?? `DEFAULT_PRICES` |
| How much have they used? | `incrementLinkUsage(userId, at)` / `getLinkUsage(userId, at)` (monthly Redis buckets) |

Plus geo-routing: `billingContext(country)` → `{ currency, processor }` (NG →
NGN/Paystack, else USD/Polar). Pair with `lookupCountry` from `@clipal/geo` at
the call site.

## Notes

- **Deterministic usage buckets.** `incrementLinkUsage`/`getLinkUsage` derive the
  `YYYYMM` window from the **caller-supplied `Date`**, never the module clock, so
  attribution is testable. Key: `usage:links:{userId}:{YYYYMM}` (UTC).
- **`PlanRequiredError`** carries `{ code: 'plan_required', plan, feature }`;
  callers map it to a 403. Use `isPlanRequiredError(err)` to narrow.
- Capabilities/limits are code-only (`@clipal/config` `PLANS`); only **prices**
  are admin-overridable via the `plan_prices` table.
