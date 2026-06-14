import type { Feature, PlanName } from '@clipal/config';
import { describe, expect, it } from 'vitest';
import { can, planLimits, requireFeature } from './capabilities';
import { PlanRequiredError, isPlanRequiredError } from './errors';

// Expected capability matrix per §3 / config PLANS. Kept here as an independent
// copy so a regression in plans.ts is caught rather than mirrored.
const MATRIX: Record<PlanName, Record<Feature, boolean>> = {
  free: {
    customSlugs: false,
    password: false,
    expiry: false,
    qr: false,
    geoRouting: false,
    deviceRouting: false,
    abTesting: false,
  },
  pro: {
    customSlugs: true,
    password: true,
    expiry: true,
    qr: true,
    geoRouting: false,
    deviceRouting: false,
    abTesting: true,
  },
  business: {
    customSlugs: true,
    password: true,
    expiry: true,
    qr: true,
    geoRouting: true,
    deviceRouting: true,
    abTesting: true,
  },
};

const PLANS: PlanName[] = ['free', 'pro', 'business'];
const FEATURES = Object.keys(MATRIX.free) as Feature[];

describe('can() — capability matrix across all plans', () => {
  for (const plan of PLANS) {
    for (const feature of FEATURES) {
      const expected = MATRIX[plan][feature];
      it(`${plan} ${expected ? 'can' : 'cannot'} use ${feature}`, () => {
        expect(can(plan, feature)).toBe(expected);
      });
    }
  }
});

describe('requireFeature() — throws PlanRequiredError exactly when not allowed', () => {
  for (const plan of PLANS) {
    for (const feature of FEATURES) {
      const allowed = MATRIX[plan][feature];
      if (allowed) {
        it(`${plan} + ${feature}: does not throw`, () => {
          expect(() => requireFeature(plan, feature)).not.toThrow();
        });
      } else {
        it(`${plan} + ${feature}: throws PlanRequiredError carrying plan+feature`, () => {
          try {
            requireFeature(plan, feature);
            throw new Error('expected requireFeature to throw');
          } catch (err) {
            expect(isPlanRequiredError(err)).toBe(true);
            const e = err as PlanRequiredError;
            expect(e).toBeInstanceOf(PlanRequiredError);
            expect(e.code).toBe('plan_required');
            expect(e.plan).toBe(plan);
            expect(e.feature).toBe(feature);
          }
        });
      }
    }
  }
});

describe('planLimits()', () => {
  it('free caps links at 100/mo and disables the API', () => {
    const l = planLimits('free');
    expect(l.linksPerMonth).toBe(100);
    expect(l.apiRequestsPerMonth).toBe(0);
  });

  it('pro and business have unlimited links', () => {
    expect(planLimits('pro').linksPerMonth).toBeNull();
    expect(planLimits('business').linksPerMonth).toBeNull();
  });
});
