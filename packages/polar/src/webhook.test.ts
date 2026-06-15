import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { env } from '@clipal/config';
import {
  isPolarConfigured,
  verifyWebhookSignature,
  isPolarWebhookConfigured,
} from './index';

// A real-looking `whsec_<base64>` secret (does not match the placeholder regex).
const SECRET_KEY_BYTES = Buffer.from('clipal-polar-webhook-test-key-0123456789', 'utf8');
const WEBHOOK_SECRET = `whsec_${SECRET_KEY_BYTES.toString('base64')}`;

const RAW_BODY = JSON.stringify({ type: 'subscription.created', data: { id: 'sub_123' } });
const ID = 'msg_2abc';

/** Produce a valid Standard Webhooks signature header for the given inputs. */
function sign(id: string, timestamp: number, body: string, keyBytes = SECRET_KEY_BYTES): string {
  const sig = createHmac('sha256', keyBytes).update(`${id}.${timestamp}.${body}`, 'utf8').digest('base64');
  return `v1,${sig}`;
}

function headers(timestamp: number, signature: string): Record<string, string> {
  return {
    'webhook-id': ID,
    'webhook-timestamp': String(timestamp),
    'webhook-signature': signature,
  };
}

describe('isPolarConfigured / isPolarWebhookConfigured', () => {
  let origToken: string;
  let origSecret: string;

  beforeEach(() => {
    origToken = env.POLAR_ACCESS_TOKEN;
    origSecret = env.POLAR_WEBHOOK_SECRET;
  });
  afterEach(() => {
    env.POLAR_ACCESS_TOKEN = origToken;
    env.POLAR_WEBHOOK_SECRET = origSecret;
  });

  it('is false when the access token is empty', () => {
    env.POLAR_ACCESS_TOKEN = '';
    expect(isPolarConfigured()).toBe(false);
  });

  it('is false for placeholder tokens', () => {
    env.POLAR_ACCESS_TOKEN = 'your-access-token';
    expect(isPolarConfigured()).toBe(false);
    env.POLAR_ACCESS_TOKEN = 'changeme';
    expect(isPolarConfigured()).toBe(false);
  });

  it('is true for a real-looking access token', () => {
    env.POLAR_ACCESS_TOKEN = 'polar_oat_aBcDeF0123456789xyz';
    expect(isPolarConfigured()).toBe(true);
  });

  it('webhook config is false when the secret is empty or placeholder', () => {
    env.POLAR_WEBHOOK_SECRET = '';
    expect(isPolarWebhookConfigured()).toBe(false);
    env.POLAR_WEBHOOK_SECRET = 'whsec_placeholder';
    expect(isPolarWebhookConfigured()).toBe(false);
  });

  it('webhook config is true for a real-looking secret', () => {
    env.POLAR_WEBHOOK_SECRET = WEBHOOK_SECRET;
    expect(isPolarWebhookConfigured()).toBe(true);
  });
});

describe('verifyWebhookSignature (Standard Webhooks)', () => {
  let origSecret: string;
  const NOW = 1_700_000_000;

  beforeEach(() => {
    origSecret = env.POLAR_WEBHOOK_SECRET;
    env.POLAR_WEBHOOK_SECRET = WEBHOOK_SECRET;
  });
  afterEach(() => {
    env.POLAR_WEBHOOK_SECRET = origSecret;
  });

  it('accepts a correctly signed payload', () => {
    const sig = sign(ID, NOW, RAW_BODY);
    expect(verifyWebhookSignature(RAW_BODY, headers(NOW, sig), { now: NOW })).toBe(true);
  });

  it('accepts when the header carries multiple version tokens and one matches', () => {
    const valid = sign(ID, NOW, RAW_BODY);
    const combined = `v1,deadbeefnotreal ${valid}`;
    expect(verifyWebhookSignature(RAW_BODY, headers(NOW, combined), { now: NOW })).toBe(true);
  });

  it('works with a Headers instance, not just a plain record', () => {
    const sig = sign(ID, NOW, RAW_BODY);
    const h = new Headers({
      'webhook-id': ID,
      'webhook-timestamp': String(NOW),
      'webhook-signature': sig,
    });
    expect(verifyWebhookSignature(RAW_BODY, h, { now: NOW })).toBe(true);
  });

  it('rejects a tampered body', () => {
    const sig = sign(ID, NOW, RAW_BODY);
    expect(verifyWebhookSignature(RAW_BODY + 'x', headers(NOW, sig), { now: NOW })).toBe(false);
  });

  it('rejects a signature made with the wrong secret', () => {
    const wrongKey = Buffer.from('a-totally-different-secret-key-value', 'utf8');
    const sig = sign(ID, NOW, RAW_BODY, wrongKey);
    expect(verifyWebhookSignature(RAW_BODY, headers(NOW, sig), { now: NOW })).toBe(false);
  });

  it('rejects when the signed id differs from the header id (replay across messages)', () => {
    const sig = sign('msg_other', NOW, RAW_BODY);
    expect(verifyWebhookSignature(RAW_BODY, headers(NOW, sig), { now: NOW })).toBe(false);
  });

  it('rejects a stale timestamp outside tolerance', () => {
    const old = NOW - 60 * 60; // one hour ago
    const sig = sign(ID, old, RAW_BODY);
    expect(verifyWebhookSignature(RAW_BODY, headers(old, sig), { now: NOW })).toBe(false);
  });

  it('rejects a future timestamp outside tolerance', () => {
    const future = NOW + 60 * 60;
    const sig = sign(ID, future, RAW_BODY);
    expect(verifyWebhookSignature(RAW_BODY, headers(future, sig), { now: NOW })).toBe(false);
  });

  it('accepts a timestamp within the default tolerance window', () => {
    const slightlyOld = NOW - 60; // within 5 min
    const sig = sign(ID, slightlyOld, RAW_BODY);
    expect(verifyWebhookSignature(RAW_BODY, headers(slightlyOld, sig), { now: NOW })).toBe(true);
  });

  it('rejects when required headers are missing', () => {
    const sig = sign(ID, NOW, RAW_BODY);
    expect(verifyWebhookSignature(RAW_BODY, { 'webhook-id': ID, 'webhook-signature': sig }, { now: NOW })).toBe(false);
    expect(verifyWebhookSignature(RAW_BODY, headers(NOW, ''), { now: NOW })).toBe(false);
  });

  it('rejects a non-numeric timestamp without throwing', () => {
    const sig = sign(ID, NOW, RAW_BODY);
    const h = { 'webhook-id': ID, 'webhook-timestamp': 'not-a-number', 'webhook-signature': sig };
    expect(verifyWebhookSignature(RAW_BODY, h, { now: NOW })).toBe(false);
  });

  it('returns false (no throw) when the webhook secret is unconfigured', () => {
    env.POLAR_WEBHOOK_SECRET = '';
    const sig = sign(ID, NOW, RAW_BODY);
    expect(verifyWebhookSignature(RAW_BODY, headers(NOW, sig), { now: NOW })).toBe(false);
  });

  it('tolerates a raw (unprefixed base64) secret', () => {
    env.POLAR_WEBHOOK_SECRET = SECRET_KEY_BYTES.toString('base64');
    const sig = sign(ID, NOW, RAW_BODY);
    expect(verifyWebhookSignature(RAW_BODY, headers(NOW, sig), { now: NOW })).toBe(true);
  });
});
