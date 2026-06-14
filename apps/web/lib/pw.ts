import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '@clipal/config';

/**
 * Short-lived signed proof that a visitor entered the correct password for a
 * given link code (§8 / spec §5). Stored as the httpOnly cookie `clipal_pw_{code}`
 * for 1h. Value = `${expEpochSec}.${hmac}` where hmac = HMAC-SHA256 over
 * `${code}.${expEpochSec}` keyed by SESSION_SECRET. Verification is O(1) and used
 * on the hot path, so it must not touch any datastore.
 *
 * Rotating the link's password should invalidate outstanding proofs — callers do
 * that by mixing a per-link salt (the new password_hash prefix) into `code` when
 * they adopt that; for now the 1h TTL bounds exposure.
 */
const PW_TTL_SECONDS = 60 * 60;

export function pwCookieName(code: string): string {
  return `clipal_pw_${code}`;
}

function sign(payload: string): string {
  return createHmac('sha256', env.SESSION_SECRET).update(payload).digest('hex');
}

export function issuePwCookieValue(code: string, nowMs: number): { value: string; maxAge: number } {
  const exp = Math.floor(nowMs / 1000) + PW_TTL_SECONDS;
  const payload = `${code}.${exp}`;
  return { value: `${exp}.${sign(payload)}`, maxAge: PW_TTL_SECONDS };
}

export function verifyPwCookie(code: string, cookieValue: string | undefined, nowMs: number): boolean {
  if (!cookieValue) return false;
  const dot = cookieValue.indexOf('.');
  if (dot < 0) return false;
  const expStr = cookieValue.slice(0, dot);
  const mac = cookieValue.slice(dot + 1);
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp * 1000 < nowMs) return false;
  const expected = sign(`${code}.${exp}`);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
