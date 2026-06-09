import { describe, expect, it } from 'vitest';
import type { BlockPolicy } from './blocklist';
import { matchKeyword } from './blocklist';

const FLAG: { value: string; policy: BlockPolicy }[] = [
  { value: 'paypal', policy: 'flag' },
  { value: 'netflix', policy: 'flag' },
];

describe('matchKeyword', () => {
  it('flags a lookalike (keyword in host, sld not the genuine site)', () => {
    expect(matchKeyword('paypal-login.com', 'paypal-login', FLAG)).toEqual({
      matched: true,
      value: 'paypal',
      policy: 'flag',
    });
  });

  it('does NOT match the genuine domain (sld === keyword)', () => {
    expect(matchKeyword('www.paypal.com', 'paypal', FLAG)).toEqual({ matched: false });
  });

  it('does NOT match a subdomain of the genuine site (sld === keyword)', () => {
    expect(matchKeyword('help.netflix.com', 'netflix', FLAG)).toEqual({ matched: false });
  });

  it('does NOT match an unrelated host', () => {
    expect(matchKeyword('example.com', 'example', FLAG)).toEqual({ matched: false });
  });

  it('returns matched:false with no keywords', () => {
    expect(matchKeyword('paypal-login.com', 'paypal-login', [])).toEqual({ matched: false });
  });

  it("a 'reject' keyword wins over a later flag", () => {
    const entries: { value: string; policy: BlockPolicy }[] = [
      { value: 'paypal', policy: 'flag' },
      { value: 'login', policy: 'reject' },
    ];
    expect(matchKeyword('paypal-login.com', 'paypal-login', entries)).toEqual({
      matched: true,
      value: 'login',
      policy: 'reject',
    });
  });

  it('lowercases the keyword before matching', () => {
    expect(
      matchKeyword('paypal-login.com', 'paypal-login', [{ value: 'PayPal', policy: 'flag' }]),
    ).toEqual({ matched: true, value: 'paypal', policy: 'flag' });
  });
});
