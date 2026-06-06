import { env } from '@clipal/config';
import { SESSION_TTL_SECONDS } from '@clipal/config/constants';
import { SignJWT, jwtVerify } from 'jose';

/** JWT carries sub=user_id, sid=session_id (JTI), iat, exp. HS256 per §14.4. */
const SECRET = new TextEncoder().encode(env.SESSION_SECRET);
const ALG = 'HS256';

export interface SessionClaims {
  sub: string; // user id
  sid: string; // session id (JTI)
}

export async function signSession(claims: SessionClaims): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({ sid: claims.sid })
    .setProtectedHeader({ alg: ALG })
    .setSubject(claims.sub)
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + SESSION_TTL_SECONDS)
    .sign(SECRET);
}

export async function verifySession(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET, { algorithms: [ALG] });
    if (typeof payload.sub === 'string' && typeof payload['sid'] === 'string') {
      return { sub: payload.sub, sid: payload['sid'] };
    }
    return null;
  } catch {
    return null;
  }
}
