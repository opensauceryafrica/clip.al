import { join } from 'node:path';
import { env } from '@clipal/config';
import { open, type CountryResponse, type Reader } from 'maxmind';

/**
 * Request-time country lookup over MaxMind GeoLite2. Shared by the web app, the
 * billing currency router, and the worker. Best-effort: if no .mmdb is mounted
 * the reader stays null and every lookup returns 'ZZ' — lookups NEVER throw.
 *
 * A GeoLite2-Country.mmdb is preferred (tiny), but a GeoLite2-City.mmdb works
 * too since it carries the same `country.iso_code` field. The web container must
 * mount one of these into env.GEOIP_DIR via the geoipdata volume.
 */
let reader: Reader<CountryResponse> | null = null;
let opened = false;

const CANDIDATES = ['GeoLite2-Country.mmdb', 'GeoLite2-City.mmdb'] as const;

/**
 * Opens a country reader from env.GEOIP_DIR, caching the singleton. Idempotent:
 * subsequent calls return the cached reader (or null) without re-opening.
 * Graceful when no .mmdb is present — resolves with the reader left null.
 */
export async function openCountryReader(): Promise<Reader<CountryResponse> | null> {
  if (opened) return reader;
  opened = true;
  for (const name of CANDIDATES) {
    try {
      reader = await open<CountryResponse>(join(env.GEOIP_DIR, name));
      return reader;
    } catch {
      // try next candidate
    }
  }
  reader = null;
  return reader;
}

/**
 * Synchronous, microsecond-level ISO-2 country lookup. Returns 'ZZ' when the
 * reader is absent, the record has no country, or the IP is invalid. Call
 * openCountryReader() once at startup first; NEVER throws.
 */
export function lookupCountry(ip: string): string {
  if (!reader) return 'ZZ';
  try {
    const rec = reader.get(ip);
    return rec?.country?.iso_code ?? 'ZZ';
  } catch {
    return 'ZZ';
  }
}
