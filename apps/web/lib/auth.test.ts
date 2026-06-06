import { afterEach, describe, expect, it, vi } from 'vitest';

// Shared, hoisted state: `appUrl` is read by the mocked getPublicBaseUrl, `opts`
// captures what setSessionCookie passes to the cookie store.
const ctx = vi.hoisted(() => ({
  appUrl: 'http://localhost:3000',
  name: '',
  opts: null as Record<string, unknown> | null,
}));

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ redirect: () => undefined }));
vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      set: (name: string, _value: string, opts: Record<string, unknown>) => {
        ctx.name = name;
        ctx.opts = opts;
      },
      get: () => undefined,
      delete: () => undefined,
    }),
}));
vi.mock('@clipal/auth', () => ({ validateSession: () => Promise.resolve(null) }));
vi.mock('@clipal/config', () => ({
  env: { COOKIE_DOMAIN: 'clip.al' },
  getPublicBaseUrl: () => ctx.appUrl,
}));
vi.mock('@clipal/config/constants', () => ({
  SESSION_COOKIE_NAME: 'clipal_session',
  SESSION_TTL_SECONDS: 2_592_000,
}));

import { setSessionCookie } from './auth';

describe('setSessionCookie scope (the logout-on-navigation fix)', () => {
  afterEach(() => {
    ctx.opts = null;
  });

  it('local prod-image on http://localhost: host-only + not secure (browser stores it)', async () => {
    ctx.appUrl = 'http://localhost:3000';
    await setSessionCookie('tok');
    expect(ctx.name).toBe('clipal_session');
    expect(ctx.opts?.['httpOnly']).toBe(true);
    expect(ctx.opts?.['secure']).toBe(false);
    // No Domain attribute -> a host-only localhost cookie the browser keeps.
    expect(ctx.opts?.['domain']).toBeUndefined();
  });

  it('production apex https://clip.al: secure + Domain=clip.al (shares *.clip.al)', async () => {
    ctx.appUrl = 'https://clip.al';
    await setSessionCookie('tok');
    expect(ctx.opts?.['secure']).toBe(true);
    expect(ctx.opts?.['domain']).toBe('clip.al');
  });

  it('production subdomain https://app.clip.al: still Domain=clip.al', async () => {
    ctx.appUrl = 'https://app.clip.al';
    await setSessionCookie('tok');
    expect(ctx.opts?.['secure']).toBe(true);
    expect(ctx.opts?.['domain']).toBe('clip.al');
  });

  it('unrelated host https://example.preview.dev: host-only (no cross-domain leak)', async () => {
    ctx.appUrl = 'https://example.preview.dev';
    await setSessionCookie('tok');
    expect(ctx.opts?.['secure']).toBe(true);
    expect(ctx.opts?.['domain']).toBeUndefined();
  });
});
