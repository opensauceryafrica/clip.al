import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '@clipal/config';
import { isGsbConfigured, scanUrl } from './gsb';

// A real-looking key so isGsbConfigured() is true (does not match the placeholder
// regex). We never hit the network — fetch is stubbed in each test.
const REAL_KEY = 'AIzaSyTestKeyForUnitTests0123456789';
const MALWARE_URL = 'http://malware.testing.google.test/testing/malware/';

function mockGsb(body: unknown, ok = true, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok, status, json: async () => body }) as unknown as Response),
  );
}

describe('scanUrl (Google Safe Browsing)', () => {
  let originalKey: string;

  beforeEach(() => {
    originalKey = env.GSB_API_KEY;
    env.GSB_API_KEY = REAL_KEY;
  });

  afterEach(() => {
    env.GSB_API_KEY = originalKey;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('rejects a URL GSB flags as malicious (the submission-time hard-reject branch)', async () => {
    mockGsb({
      matches: [{ threatType: 'MALWARE', threat: { url: MALWARE_URL } }],
    });

    const result = await scanUrl(MALWARE_URL);

    expect(result.state).toBe('malicious');
    expect(result.threats).toContain('MALWARE');
  });

  it('maps SOCIAL_ENGINEERING (phishing) matches to malicious too', async () => {
    mockGsb({
      matches: [{ threatType: 'SOCIAL_ENGINEERING', threat: { url: MALWARE_URL } }],
    });

    const result = await scanUrl(MALWARE_URL);

    expect(result.state).toBe('malicious');
    expect(result.threats).toContain('SOCIAL_ENGINEERING');
  });

  it('returns clean when GSB responds with no matches', async () => {
    mockGsb({});

    const result = await scanUrl('https://example.com/safe');

    expect(result.state).toBe('clean');
    expect(result.threats).toEqual([]);
  });

  it('is non-blocking: GSB unconfigured → unchecked, and no network call', async () => {
    env.GSB_API_KEY = '';
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    expect(isGsbConfigured()).toBe(false);
    const result = await scanUrl(MALWARE_URL);

    expect(result.state).toBe('unchecked');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('is non-blocking: a GSB error response → unchecked (cannot 500 a shorten)', async () => {
    mockGsb('upstream error', false, 503);

    const result = await scanUrl(MALWARE_URL);

    expect(result.state).toBe('unchecked');
  });

  it('is non-blocking: a thrown fetch (outage) → unchecked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );

    const result = await scanUrl(MALWARE_URL);

    expect(result.state).toBe('unchecked');
  });
});
