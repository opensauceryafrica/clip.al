import { join } from 'node:path';
import { env } from '@clipal/config';
import { open, type CityResponse, type Reader } from 'maxmind';

/**
 * MaxMind GeoLite2 City lookup. Best-effort: if the .mmdb isn't mounted, every
 * lookup returns country 'ZZ' and the worker keeps ingesting. The file is
 * refreshed monthly out-of-band (see the worker README / OPEN_QUESTIONS).
 */
let reader: Reader<CityResponse> | null = null;

export async function initGeo(): Promise<void> {
  try {
    reader = await open<CityResponse>(join(env.GEOIP_DIR, 'GeoLite2-City.mmdb'));
    console.log('[geo] GeoLite2-City loaded');
  } catch {
    reader = null;
    console.warn(`[geo] GeoLite2-City.mmdb not found in ${env.GEOIP_DIR} — geo disabled (country=ZZ)`);
  }
}

export interface GeoResult {
  country: string;
  region: string;
  city: string;
}

export function geoLookup(ip: string): GeoResult {
  if (!reader) return { country: 'ZZ', region: '', city: '' };
  try {
    const rec = reader.get(ip);
    return {
      country: rec?.country?.iso_code ?? 'ZZ',
      region: rec?.subdivisions?.[0]?.iso_code ?? '',
      city: rec?.city?.names?.en ?? '',
    };
  } catch {
    return { country: 'ZZ', region: '', city: '' };
  }
}
