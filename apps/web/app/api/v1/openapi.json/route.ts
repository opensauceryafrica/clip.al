import { buildOpenApiSpec } from '@/lib/openapi';

/**
 * GET /api/v1/openapi.json — serves the OpenAPI 3.1 spec for the public API.
 *
 * Unauthenticated by design (the spec is public documentation). The server URL
 * is resolved from APP_URL at build time, never the request Host. The hand-rolled
 * `/docs/api` reader fetches this same JSON.
 */
export const runtime = 'nodejs';

export function GET(): Response {
  return new Response(JSON.stringify(buildOpenApiSpec()), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
