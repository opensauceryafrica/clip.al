import { revokeSession, verifySession } from '@clipal/auth';
import { SESSION_COOKIE_NAME } from '@clipal/config/constants';
import { cookies } from 'next/headers';
import { isSameOrigin } from '@/lib/csrf';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) {
    return new Response('Forbidden', { status: 403 });
  }
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    const claims = await verifySession(token);
    if (claims) await revokeSession(claims.sid);
  }
  store.delete(SESSION_COOKIE_NAME);
  // 303 so the POST becomes a GET. RELATIVE Location so it resolves against the
  // origin the browser used, not the request Host (a container hostname in Docker).
  return new Response(null, { status: 303, headers: { Location: '/' } });
}
