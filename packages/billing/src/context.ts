import type { Currency } from '@clipal/config';

export type Processor = 'paystack' | 'polar';

export interface BillingContext {
  currency: Currency;
  processor: Processor;
}

/**
 * Geo-routes a buyer to a currency + processor from their ISO-2 country.
 * Nigeria (`NG`) pays in NGN through Paystack; everyone else pays in USD
 * through Polar.sh. Matching is case-insensitive so callers can pass raw
 * `lookupCountry` output ('NG', 'ng', or the 'ZZ' unknown sentinel).
 */
export function billingContext(country: string): BillingContext {
  return country.toUpperCase() === 'NG'
    ? { currency: 'NGN', processor: 'paystack' }
    : { currency: 'USD', processor: 'polar' };
}
