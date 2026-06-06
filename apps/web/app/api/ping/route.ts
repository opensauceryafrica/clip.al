/**
 * Dependency-free liveness probe. Used as the web container's Docker
 * healthcheck — returns 200 as long as the process can serve a request. The
 * rich /api/health endpoint (which can return 503 when a backing service is
 * down) is unsuitable for that purpose.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return new Response('ok', {
    status: 200,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain' },
  });
}
