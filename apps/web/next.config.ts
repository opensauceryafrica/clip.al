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
  // @node-rs/argon2 (native .node binary, server-only auth) and @sentry/node
  // (heavy server-only SDK pulling in OpenTelemetry) must be require()d at runtime,
  // never webpack-bundled. Two things are needed, and BOTH are load-bearing:
  //
  //  1. serverExternalPackages — includes them in the node-file-trace so they land
  //     in .next/standalone/node_modules. This only works because both are listed
  //     as DIRECT dependencies of this app (not just transitive via @clipal/auth /
  //     @clipal/observability); otherwise the tracer can't resolve them from the
  //     app dir and the standalone server crashes at boot with "Cannot find module".
  //
  //  2. The webpack `commonjs` external below — serverExternalPackages alone does
  //     NOT stop webpack from bundling them, because they're reached through
  //     transpilePackages workspace packages (@clipal/auth, @clipal/observability),
  //     whose code IS compiled by webpack. Bundling @sentry/node pulls in OTel
  //     modules that require() Node builtins (diagnostics_channel, path, …) and the
  //     build fails. Forcing them external as `commonjs <name>` emits require()
  //     instead. (A bare-string external would default to webpack's `var` type —
  //     `const x = @sentry/node` — which is invalid JS, so the commonjs form is
  //     required.)
  serverExternalPackages: ['@node-rs/argon2', '@sentry/node'],
  webpack(config: { externals: unknown[] }, { isServer }: { isServer: boolean }) {
    if (isServer)
      config.externals.push({
        '@node-rs/argon2': 'commonjs @node-rs/argon2',
        '@sentry/node': 'commonjs @sentry/node',
      });
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
    '@clipal/observability',
    '@clipal/geo',
    '@clipal/s3',
    '@clipal/billing',
    '@clipal/paystack',
    '@clipal/polar',
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
