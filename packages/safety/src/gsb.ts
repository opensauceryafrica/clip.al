import { env } from '@clipal/config';

/**
 * Google Safe Browsing API v4 (`threatMatches:find`). Free API key. The endpoint
 * accepts up to 500 URLs per request — used both at submission (single URL) and
 * by the rolling re-scan worker (batches of up to 500).
 *
 * GSB is OPTIONAL and NON-BLOCKING: if the key is missing/placeholder, or the API
 * call fails (outage, quota, non-2xx), scanning returns `unchecked` rather than
 * throwing. The rolling re-scan worker re-checks unchecked links later. The
 * synchronous safety gates (scheme, SSRF/IP-literal, known-shortener, blocklist,
 * reserved slugs) are unaffected and remain blocking. We map any GSB match to
 * `malicious`; `suspicious` is reserved for our own signals (reports, brand flags).
 */
export type SafetyState = 'unchecked' | 'clean' | 'suspicious' | 'malicious';

export interface ScanResult {
  state: SafetyState;
  threats: string[];
}

const THREAT_TYPES = [
  'MALWARE',
  'SOCIAL_ENGINEERING',
  'UNWANTED_SOFTWARE',
  'POTENTIALLY_HARMFUL_APPLICATION',
];

interface GsbMatch {
  threatType?: string;
  threat?: { url?: string };
}
interface GsbResponse {
  matches?: GsbMatch[];
}

const MAX_BATCH = 500;

// Common placeholder/dummy values used in .env.example, CI, and Docker build args.
// Real Google API keys never match these, so this only ever skips fake keys.
const GSB_PLACEHOLDER = /placeholder|changeme|change-me|example|dummy|your[-_]?(api[-_]?)?key|^x+$/i;

/** True only when a real-looking GSB key is configured (non-empty, non-placeholder). */
export function isGsbConfigured(): boolean {
  const key = env.GSB_API_KEY.trim();
  return key.length > 0 && !GSB_PLACEHOLDER.test(key);
}

/**
 * Scan many URLs at once. Returns a map of url → threat types on success (only
 * entries with threats are present), or `null` when scanning did not run — i.e.
 * GSB isn't configured, or the request failed. `null` is distinct from an empty
 * map ("ran, nothing found") so callers can treat it as "unchecked" instead of
 * "clean". Never throws.
 */
export async function scanUrls(urls: readonly string[]): Promise<Map<string, string[]> | null> {
  if (!isGsbConfigured()) return null;

  const unique = Array.from(new Set(urls)).slice(0, MAX_BATCH);
  if (unique.length === 0) return new Map();

  const endpoint = `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(env.GSB_API_KEY)}`;
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client: { clientId: 'clip.al', clientVersion: '1.0.0' },
        threatInfo: {
          threatTypes: THREAT_TYPES,
          platformTypes: ['ANY_PLATFORM'],
          threatEntryTypes: ['URL'],
          threatEntries: unique.map((url) => ({ url })),
        },
      }),
    });

    if (!res.ok) {
      console.warn(
        `[safety] Google Safe Browsing returned ${res.status} — treating URL(s) as unchecked`,
      );
      return null;
    }

    const data = (await res.json()) as GsbResponse;
    const result = new Map<string, string[]>();
    for (const match of data.matches ?? []) {
      const url = match.threat?.url;
      const type = match.threatType;
      if (!url || !type) continue;
      const existing = result.get(url) ?? [];
      if (!existing.includes(type)) existing.push(type);
      result.set(url, existing);
    }
    return result;
  } catch (err) {
    console.warn(
      `[safety] Google Safe Browsing request failed (${err instanceof Error ? err.message : 'error'}) — treating URL(s) as unchecked`,
    );
    return null;
  }
}

/**
 * Scan a single URL at submission time. Never throws — returns `unchecked` when
 * GSB is unconfigured or the call fails (so a GSB outage can't 500 a shorten),
 * `malicious` on a match, `clean` otherwise.
 */
export async function scanUrl(url: string): Promise<ScanResult> {
  const matches = await scanUrls([url]);
  if (matches === null) return { state: 'unchecked', threats: [] };
  const threats = matches.get(url) ?? [];
  return threats.length > 0 ? { state: 'malicious', threats } : { state: 'clean', threats: [] };
}
