import { describe, expect, it } from 'vitest';
import type { BrandTerm } from '@clipal/cache';
import { matchBrandTerm } from './brand';

const FLAG: BrandTerm[] = [
  { term: 'paypal', policy: 'flag' },
  { term: 'netflix', policy: 'flag' },
];

describe('matchBrandTerm', () => {
  it('flags a trademark lookalike (term in host, sld not the brand)', () => {
    const m = matchBrandTerm('paypal-login.com', 'paypal-login', FLAG);
    expect(m).toEqual({ matched: true, term: 'paypal', policy: 'flag' });
  });

  it('does NOT flag the genuine brand domain (sld === term)', () => {
    expect(matchBrandTerm('www.paypal.com', 'paypal', FLAG)).toEqual({ matched: false });
  });

  it('does NOT flag a subdomain of the genuine brand (sld === term)', () => {
    expect(matchBrandTerm('help.netflix.com', 'netflix', FLAG)).toEqual({ matched: false });
  });

  it('does NOT flag an unrelated host', () => {
    expect(matchBrandTerm('example.com', 'example', FLAG)).toEqual({ matched: false });
  });

  it('returns matched:false when there are no terms (empty cache)', () => {
    expect(matchBrandTerm('paypal-login.com', 'paypal-login', [])).toEqual({ matched: false });
  });

  it("a 'reject' policy match wins over a later flag match", () => {
    const terms: BrandTerm[] = [
      { term: 'paypal', policy: 'flag' },
      { term: 'login', policy: 'reject' },
    ];
    const m = matchBrandTerm('paypal-login.com', 'paypal-login', terms);
    expect(m).toEqual({ matched: true, term: 'login', policy: 'reject' });
  });

  it('lowercases the term before matching', () => {
    const m = matchBrandTerm('paypal-login.com', 'paypal-login', [
      { term: 'PayPal', policy: 'flag' },
    ]);
    expect(m).toEqual({ matched: true, term: 'paypal', policy: 'flag' });
  });
});
