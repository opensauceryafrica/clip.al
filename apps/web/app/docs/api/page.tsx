import type { Metadata } from 'next';
import Link from 'next/link';
import { ApiDocsReader } from './api-docs-reader';

export const metadata: Metadata = {
  title: 'API reference',
  description: 'The clip.al public REST API — endpoints, authentication, and code samples.',
};

/**
 * Self-hosted API reference. The interactive reader is a client component that
 * fetches `/api/v1/openapi.json` and renders it — no external CDN and no inline
 * scripts, so the page passes the app's strict nonce-based CSP unchanged.
 *
 * Lives outside the `(app)` route group, so it ships its own page chrome rather
 * than the authenticated dashboard shell.
 */
export default function ApiDocsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-12 sm:py-16">
        <header className="mb-10 border-b border-border pb-8">
          <p className="mb-2 font-mono text-xs uppercase tracking-widest text-muted-foreground">
            clip.al
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">API reference</h1>
          <p className="mt-2 max-w-prose text-sm text-muted-foreground">
            A small, predictable REST API for managing links and reading analytics. Authenticate
            with an API key, send JSON, get JSON back. The machine-readable spec is at{' '}
            <Link
              href="/api/v1/openapi.json"
              className="font-mono text-foreground underline underline-offset-4 hover:text-muted-foreground"
            >
              /api/v1/openapi.json
            </Link>
            .
          </p>
        </header>

        <ApiDocsReader />
      </div>
    </div>
  );
}
