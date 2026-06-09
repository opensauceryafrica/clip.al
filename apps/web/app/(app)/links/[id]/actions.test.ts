import { beforeEach, describe, expect, it, vi } from 'vitest';

// Capture sink for the mocked DB layer. vi.hoisted runs before the vi.mock
// factories so they can close over it safely.
const cap = vi.hoisted(() => ({
  set: null as Record<string, unknown> | null,
  audits: [] as Array<{ action: string; targetId: string }>,
}));

vi.mock('@/lib/auth', () => ({
  requireUser: () => Promise.resolve({ id: 'user-1', email: 'u@example.com', role: 'user' }),
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/navigation', () => ({ redirect: () => undefined }));

// @clipal/cache is mocked so the (real) @clipal/safety checkBlocklist reads our
// seeded keyword and the domain check is a no-op. 'paypal' keyword, policy 'flag'.
vi.mock('@clipal/cache', () => ({
  keys: { hotLink: (c: string) => `link:hot:${c}` },
  redis: { del: () => Promise.resolve(1) },
  isReservedSlug: () => Promise.resolve(false),
  blockedDomainPolicy: () => Promise.resolve(null),
  getBlockKeywords: () =>
    Promise.resolve([{ value: 'paypal', match: 'keyword', policy: 'flag' }]),
}));

vi.mock('@clipal/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve([
              {
                id: 'link-1',
                code: 'abc1234',
                status: 'active',
                destinationUrl: 'https://example.com/',
              },
            ]),
        }),
      }),
    }),
    update: () => ({
      set: (payload: Record<string, unknown>) => {
        cap.set = payload;
        return { where: () => Promise.resolve() };
      },
    }),
  },
  recordAudit: (_db: unknown, entry: { action: string; targetId: string }) => {
    cap.audits.push(entry);
    return Promise.resolve();
  },
  and: (...a: unknown[]) => a,
  eq: (...a: unknown[]) => a,
  links: {},
}));

import { editDestinationAction } from './actions';

describe('editDestinationAction brand check', () => {
  beforeEach(() => {
    cap.set = null;
    cap.audits = [];
  });

  it('flags an edit from example.com to a paypal lookalike (suspicious + audit)', async () => {
    const fd = new FormData();
    fd.set('linkId', 'link-1');
    fd.set('destination', 'https://paypal-phishing.com/login');

    const res = await editDestinationAction({}, fd);

    expect(res).toEqual({ ok: true });
    expect(cap.set?.['destinationUrl']).toBe('https://paypal-phishing.com/login');
    expect(cap.set?.['safetyState']).toBe('suspicious');
    expect(
      cap.audits.some((a) => a.action === 'link.flagged_brand' && a.targetId === 'link-1'),
    ).toBe(true);
  });
});
