import { describe, expect, it } from 'vitest';
import { lookupCountry, openCountryReader } from './index';

describe('geo lookup — no mmdb fallback', () => {
  it('opens gracefully (null reader) when no .mmdb is present', async () => {
    // env.GEOIP_DIR has no GeoLite2-*.mmdb in the test environment.
    const reader = await openCountryReader();
    expect(reader).toBeNull();
  });

  it('returns ZZ when no reader is loaded', () => {
    expect(lookupCountry('8.8.8.8')).toBe('ZZ');
  });

  it('never throws on invalid input, returns ZZ', () => {
    expect(lookupCountry('not-an-ip')).toBe('ZZ');
    expect(lookupCountry('')).toBe('ZZ');
  });
});
