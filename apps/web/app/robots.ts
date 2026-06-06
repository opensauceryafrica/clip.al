import type { MetadataRoute } from 'next';
import { env } from '@clipal/config';

/**
 * §14.14 — keep redirect/interstitial/admin/api out of crawler indexes; allow
 * the marketing surface.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/r/', '/p/', '/admin/', '/api/', '/dashboard', '/links', '/settings'],
    },
    sitemap: `${env.APP_URL}/sitemap.xml`,
  };
}
