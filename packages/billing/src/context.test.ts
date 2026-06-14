import { describe, expect, it } from 'vitest';
import { billingContext } from './context';

describe('billingContext() — geo-routed currency + processor', () => {
  it('NG routes to NGN via Paystack', () => {
    expect(billingContext('NG')).toEqual({ currency: 'NGN', processor: 'paystack' });
  });

  it('is case-insensitive for NG', () => {
    expect(billingContext('ng')).toEqual({ currency: 'NGN', processor: 'paystack' });
  });

  it('US routes to USD via Polar', () => {
    expect(billingContext('US')).toEqual({ currency: 'USD', processor: 'polar' });
  });

  it('any non-NG country routes to USD via Polar', () => {
    for (const c of ['GB', 'gh', 'KE', 'IN', 'DE', '']) {
      expect(billingContext(c)).toEqual({ currency: 'USD', processor: 'polar' });
    }
  });

  it('the unknown-country sentinel ZZ routes to USD via Polar', () => {
    expect(billingContext('ZZ')).toEqual({ currency: 'USD', processor: 'polar' });
  });
});
