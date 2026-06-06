import { getPublicBaseUrl } from '@clipal/config';

/**
 * §14.14 — sitemap for the PUBLIC MARKETING SURFACE ONLY. This list is
 * deliberately hardcoded and must stay in sync with the routes under
 * app/(marketing). Link codes and other user content are never emitted: short
 * links are private by default, high-churn, and must not enter a crawl index.
 *
 * Implemented as a route handler (not a metadata sitemap.ts) so we can set an
 * explicit Cache-Control header. `force-dynamic` keeps it rendered per request
 * from the runtime APP_URL — a statically-generated sitemap would bake the
 * build-time APP_URL default (localhost) into the image.
 */
export const dynamic = 'force-dynamic';

const MARKETING_PATHS = [
  '/',
  '/pricing',
  '/help',
  '/changelog',
  '/tos',
  '/privacy',
  '/aup',
  '/dmca',
] as const;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function GET(): Response {
  const base = getPublicBaseUrl(); // trailing slash already stripped

  const urls = MARKETING_PATHS.map((path) => {
    const loc = escapeXml(`${base}${path === '/' ? '' : path}`);
    const priority = path === '/' ? '1.0' : '0.7';
    return `  <url>\n    <loc>${loc}</loc>\n    <priority>${priority}</priority>\n  </url>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
