import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Self-hosted single-binary image (apps/web/Dockerfile copies .next/standalone).
  output: 'standalone',
  // Trace from the monorepo root so the standalone bundle includes workspace deps.
  outputFileTracingRoot: repoRoot,
  // @node-rs/argon2 ships a native .node binary — never bundle it; require() it at
  // runtime on the server (auth is server-only). serverExternalPackages alone
  // isn't enough because argon2 is reached through a transpiled workspace package
  // (@clipal/auth), so we also force it external in the server webpack config.
  serverExternalPackages: ['@node-rs/argon2'],
  webpack(config: { externals: unknown[] }, { isServer }: { isServer: boolean }) {
    if (isServer) config.externals.push('@node-rs/argon2');
    return config;
  },
  // Internal packages export TypeScript source; Next transpiles them in-place.
  transpilePackages: [
    '@clipal/config',
    '@clipal/db',
    '@clipal/cache',
    '@clipal/ch',
    '@clipal/auth',
    '@clipal/safety',
    '@clipal/shorten',
    '@clipal/ui',
    '@clipal/email',
  ],
  // Clean public short links are `clip.al/CODE`. This `afterFiles` rewrite maps
  // a bare single-segment path to the redirect handler — and because afterFiles
  // runs only after real routes (/, /pricing, /signin, …) fail to match, those
  // pages still win. The redirect handler itself lives at /r/[code] (§9), which
  // Caddy proxies with X-Real-IP and the middleware matcher excludes. Generated
  // slugs never collide with real routes thanks to the reserved-slug list.
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [{ source: '/:code', destination: '/r/:code' }],
      fallback: [],
    };
  },
  // Lint is run separately (root `pnpm lint`); don't double-run during build.
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  // Static, uniform security headers. CSP (with per-request nonce) and
  // Referrer-Policy are set in middleware so the redirect hot path can override
  // Referrer-Policy to no-referrer per response.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
          {
            key: 'Permissions-Policy',
            value:
              'accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), usb=()',
          },
        ],
      },
    ];
  },
};

export default config;
