import { parse as parseDomain } from 'tldts';

/**
 * Normalize admin blocklist input to an eTLD+1 (registrable domain). Accepts a
 * bare host, a host with path, or a full URL; returns null if unparseable.
 */
export function registrableDomain(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  let host: string;
  try {
    host = new URL(withScheme).hostname;
  } catch {
    return null;
  }
  if (!host) return null;
  const parsed = parseDomain(host);
  return parsed.domain ?? host;
}
