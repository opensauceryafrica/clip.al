import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { env } from '@clipal/config';
import { isPaystackConfigured } from './config';
import { parseWebhookEvent, verifyWebhookSignature } from './webhook';

// A real-looking secret key so isPaystackConfigured() is true (does not match
// the placeholder regex). No network is ever touched in these tests.
const SECRET = 'sk_test_paystackUnitTestSecret0123456789';

// Fixture: the exact raw body below, HMAC-SHA512'd with SECRET, yields SIG.
// Recomputed independently with node:crypto, NOT by calling our own code.
const RAW_BODY = '{"event":"charge.success","data":{"reference":"ref_123","amount":500000}}';
const SIG =
  '906ccfaf1be43bd02f68886d5492af2bcfe5b31d1700da2fa81463a87f9846c859922122461d6014d0f38c931d33e46f5432a4d2b22464759a8e3c2f3e933129';

describe('isPaystackConfigured', () => {
  let original: string;
  beforeEach(() => {
    original = env.PAYSTACK_SECRET_KEY;
  });
  afterEach(() => {
    env.PAYSTACK_SECRET_KEY = original;
  });

  it('true for a real-looking secret key', () => {
    env.PAYSTACK_SECRET_KEY = SECRET;
    expect(isPaystackConfigured()).toBe(true);
  });

  it('false when empty', () => {
    env.PAYSTACK_SECRET_KEY = '';
    expect(isPaystackConfigured()).toBe(false);
  });

  it('false for placeholder values', () => {
    for (const v of ['changeme', 'your-secret-key', 'placeholder', 'xxxxxxxx', 'dummy']) {
      env.PAYSTACK_SECRET_KEY = v;
      expect(isPaystackConfigured(), v).toBe(false);
    }
  });

  it('tolerates surrounding whitespace', () => {
    env.PAYSTACK_SECRET_KEY = `  ${SECRET}  `;
    expect(isPaystackConfigured()).toBe(true);
  });
});

describe('verifyWebhookSignature', () => {
  let original: string;
  beforeEach(() => {
    original = env.PAYSTACK_SECRET_KEY;
    env.PAYSTACK_SECRET_KEY = SECRET;
  });
  afterEach(() => {
    env.PAYSTACK_SECRET_KEY = original;
  });

  it('accepts the known body + secret → known HMAC-SHA512 digest', () => {
    expect(verifyWebhookSignature(RAW_BODY, SIG)).toBe(true);
  });

  it('is case-insensitive on the hex header', () => {
    expect(verifyWebhookSignature(RAW_BODY, SIG.toUpperCase())).toBe(true);
  });

  it('rejects a tampered body (signature no longer matches)', () => {
    const tampered = RAW_BODY.replace('500000', '999999');
    expect(verifyWebhookSignature(tampered, SIG)).toBe(false);
  });

  it('rejects a wrong / malformed signature without throwing', () => {
    expect(verifyWebhookSignature(RAW_BODY, 'deadbeef')).toBe(false);
    expect(verifyWebhookSignature(RAW_BODY, null)).toBe(false);
    expect(verifyWebhookSignature(RAW_BODY, undefined)).toBe(false);
    expect(verifyWebhookSignature(RAW_BODY, '')).toBe(false);
  });

  it('rejects a digest made with a different secret', () => {
    // Same body, signed with the wrong key, must not validate against SECRET.
    env.PAYSTACK_SECRET_KEY = SECRET;
    const wrong = 'a'.repeat(128); // valid length, wrong value
    expect(verifyWebhookSignature(RAW_BODY, wrong)).toBe(false);
  });

  it('returns false when Paystack is not configured (no key)', () => {
    env.PAYSTACK_SECRET_KEY = '';
    expect(verifyWebhookSignature(RAW_BODY, SIG)).toBe(false);
  });
});

describe('parseWebhookEvent', () => {
  it('parses a well-formed envelope', () => {
    const ev = parseWebhookEvent(RAW_BODY);
    expect(ev?.event).toBe('charge.success');
    expect(ev?.data['reference']).toBe('ref_123');
  });

  it('returns null for non-JSON or wrong shape', () => {
    expect(parseWebhookEvent('not json')).toBeNull();
    expect(parseWebhookEvent('{"data":{}}')).toBeNull();
    expect(parseWebhookEvent('[]')).toBeNull();
  });

  it('defaults data to an empty object when absent', () => {
    const ev = parseWebhookEvent('{"event":"subscription.create"}');
    expect(ev?.event).toBe('subscription.create');
    expect(ev?.data).toEqual({});
  });
});
