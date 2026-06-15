/**
 * Unit tests for the billing state machine (subscription.ts).
 *
 * subscription.ts talks to Postgres (drizzle), Redis, and the provider SDKs at
 * module load, none of which exist in unit tests — so we mock them. The DB mock
 * is a tiny in-memory store with just enough of drizzle's chained query-builder
 * to back the exact call shapes this module uses (select/insert/update with
 * where, onConflict, returning, innerJoin). The operators (`eq`, `and`,
 * `inArray`) compile to row predicates the store evaluates.
 *
 * Everything the hoisted `vi.mock` factories close over lives inside a single
 * `vi.hoisted` block (mock factories are hoisted above imports, so any value
 * they reference must be hoisted too).
 *
 * Coverage:
 *  - applyBillingEvent idempotency: the same charge.success twice records ONE
 *    invoice and extends the period ONCE (no doubled effect).
 *  - degrade/restore: a downgrade flips geo/device/ab links to single WITHOUT
 *    deleting link_destinations or password_hash; a re-upgrade restores the
 *    original routing_mode from the preserved destinations.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  type StoreKey = 'subscriptions' | 'invoices' | 'links' | 'link_destinations' | 'users' | 'audit';
  const store: Record<StoreKey, Row[]> = {
    subscriptions: [],
    invoices: [],
    links: [],
    link_destinations: [],
    users: [],
    audit: [],
  };
  const reset = (): void => {
    (Object.keys(store) as StoreKey[]).forEach((k) => {
      store[k] = [];
    });
  };

  const TABLE = '__table__';
  type Col = { col: string; [TABLE]: StoreKey };
  type Pred = (row: Row) => boolean;

  const makeTable = (key: StoreKey): Record<string, Col> =>
    new Proxy({} as Record<string, Col>, {
      get: (_t, prop: string) => ({ col: prop, [TABLE]: key }),
    });

  const subscriptions = makeTable('subscriptions');
  const invoices = makeTable('invoices');
  const links = makeTable('links');
  const linkDestinations = makeTable('link_destinations');
  const users = makeTable('users');

  const colName = (c: unknown): string => (c as Col).col;
  const tableKeyOf = (t: Record<string, Col>): StoreKey => (t['id'] as Col)[TABLE];

  const eq = (c: unknown, v: unknown): Pred => (row) => row[colName(c)] === v;
  const ne = (c: unknown, v: unknown): Pred => (row) => row[colName(c)] !== v;
  const and =
    (...ps: Pred[]): Pred =>
    (row) =>
      ps.every((p) => p(row));
  const isNull = (c: unknown): Pred => (row) => row[colName(c)] == null;
  const inArray =
    (c: unknown, vals: unknown[]): Pred =>
    (row) =>
      vals.includes(row[colName(c)]);

  function selectBuilder(fields?: Record<string, Col>) {
    let tableKey: StoreKey = 'subscriptions';
    let joined = false;
    let pred: Pred = () => true;
    let limitN = Infinity;

    const project = (row: Row): Row => {
      if (!fields) return { ...row };
      const out: Row = {};
      for (const [alias, col] of Object.entries(fields)) out[alias] = row[colName(col)];
      return out;
    };

    const exec = (): Row[] => {
      if (joined) {
        // links INNER JOIN link_destinations ON link_destinations.linkId = links.id.
        // Keep each side namespaced so identically-named columns (both have `id`)
        // don't collide; the predicate sees a flat merged view, projection reads
        // each column from its OWN table per the column's TABLE marker.
        type Pair = { links: Row; link_destinations: Row };
        const pairs: Pair[] = store.links.flatMap((l) =>
          store.link_destinations
            .filter((d) => d['linkId'] === l['id'])
            .map((d) => ({ links: l, link_destinations: d })),
        );
        return pairs
          .filter((p) => pred({ ...p.links, ...p.link_destinations }))
          .slice(0, limitN)
          .map((p) => {
            const out: Row = {};
            if (!fields) return { ...p.links, ...p.link_destinations };
            for (const [alias, col] of Object.entries(fields)) {
              const src = p[(col as Col)[TABLE] as 'links' | 'link_destinations'] ?? p.links;
              out[alias] = src[colName(col)];
            }
            return out;
          });
      }
      return store[tableKey].filter((r) => pred(r)).slice(0, limitN).map(project);
    };

    const builder = {
      from(table: Record<string, Col>) {
        tableKey = tableKeyOf(table);
        return builder;
      },
      innerJoin(_table: Record<string, Col>, _on: Pred) {
        joined = true;
        return builder;
      },
      where(p: Pred) {
        pred = p;
        return builder;
      },
      orderBy() {
        return builder;
      },
      limit(n: number) {
        limitN = n;
        return builder;
      },
      then(resolve: (rows: Row[]) => unknown) {
        return Promise.resolve(exec()).then(resolve);
      },
    };
    return builder;
  }

  function insertBuilder(tableKey: StoreKey) {
    let pending: Row = {};
    const builder = {
      values(v: Row) {
        pending = { ...v };
        return builder;
      },
      onConflictDoUpdate({ target, set }: { target: unknown; set: Row }) {
        const col = colName(target);
        const existing = store[tableKey].find((r) => r[col] === pending[col]);
        if (existing) Object.assign(existing, set);
        else store[tableKey].push({ ...pending });
        return Promise.resolve();
      },
      onConflictDoNothing({ target }: { target: unknown }) {
        const col = colName(target);
        const dup = store[tableKey].some((r) => r[col] === pending[col]);
        const row = { ...pending, id: `id-${store[tableKey].length}` };
        if (!dup) store[tableKey].push(row);
        return {
          returning() {
            return Promise.resolve(dup ? [] : [{ id: row['id'] }]);
          },
        };
      },
      then(resolve: (v: unknown) => unknown) {
        store[tableKey].push({ ...pending });
        return Promise.resolve(resolve(undefined));
      },
    };
    return builder;
  }

  function updateBuilder(tableKey: StoreKey) {
    let set: Row = {};
    const builder = {
      set(v: Row) {
        set = v;
        return builder;
      },
      where(p: Pred) {
        const matched = store[tableKey].filter((r) => p(r));
        for (const r of matched) Object.assign(r, set);
        return {
          returning(fields?: Record<string, Col>) {
            return Promise.resolve(
              matched.map((r) => {
                if (!fields) return { ...r };
                const out: Row = {};
                for (const [alias, col] of Object.entries(fields)) out[alias] = r[colName(col)];
                return out;
              }),
            );
          },
          then(resolve: (v: unknown) => unknown) {
            return Promise.resolve(resolve(undefined));
          },
        };
      },
    };
    return builder;
  }

  const db = {
    select: (fields?: Record<string, Col>) => selectBuilder(fields),
    insert: (table: Record<string, Col>) => insertBuilder(tableKeyOf(table)),
    update: (table: Record<string, Col>) => updateBuilder(tableKeyOf(table)),
  };

  const redisDel = vi.fn((..._args: unknown[]) => Promise.resolve(1));

  return {
    store,
    reset,
    redisDel,
    dbMock: {
      db,
      subscriptions,
      invoices,
      links,
      linkDestinations,
      users,
      eq,
      ne,
      and,
      isNull,
      inArray,
      sql: (s: unknown) => s,
      recordAudit: (_db: unknown, entry: Row) => {
        store.audit.push(entry);
        return Promise.resolve();
      },
    },
  };
});

vi.mock('@clipal/db', () => H.dbMock);
vi.mock('@clipal/cache', () => ({
  redis: {
    del: H.redisDel,
    set: vi.fn(() => Promise.resolve('OK')),
    get: vi.fn(() => Promise.resolve(null)),
  },
  keys: { hotLink: (code: string) => `link:hot:${code}` },
}));
vi.mock('@clipal/paystack', () => ({
  isPaystackConfigured: () => false,
  initializeTransaction: vi.fn(),
  verifyTransaction: vi.fn(),
  parseWebhookEvent: vi.fn(),
}));
vi.mock('@clipal/polar', () => ({
  isPolarConfigured: () => false,
  createCheckout: vi.fn(),
  getSubscription: vi.fn(),
}));

// Import AFTER mocks are registered.
import { applyBillingEvent, degradeUserToFree, restoreUserPlan } from './subscription';

const { store, reset, redisDel } = H;
const USER = 'user-1';

beforeEach(() => {
  reset();
  redisDel.mockClear();
});

// ── applyBillingEvent idempotency ───────────────────────────────────────────

describe('applyBillingEvent — charge.success idempotency', () => {
  const event = {
    processor: 'paystack' as const,
    type: 'charge.success' as const,
    data: {
      userId: USER,
      plan: 'pro' as const,
      interval: 'monthly' as const,
      currency: 'NGN' as const,
      amountMinor: 250000,
      providerReference: 'ref-abc',
      paidAt: '2026-06-01T00:00:00.000Z',
    },
  };

  it('records exactly one invoice and one subscription on first apply', async () => {
    const r1 = await applyBillingEvent(event);
    expect(r1.changed).toBe(true);
    expect(r1.plan).toBe('pro');
    expect(store.invoices).toHaveLength(1);
    expect(store.subscriptions).toHaveLength(1);
    expect(store.subscriptions[0]!['status']).toBe('active');
    expect(r1.paidInvoice?.amountMinor).toBe(250000);
  });

  it('applying the SAME event twice has one net effect (idempotent)', async () => {
    const r1 = await applyBillingEvent(event);
    const periodEnd1 = (store.subscriptions[0]!['currentPeriodEnd'] as Date).getTime();

    const r2 = await applyBillingEvent(event);

    // Second apply must not record a second invoice...
    expect(store.invoices).toHaveLength(1);
    // ...nor extend the period again (no doubled effect) — same provider_reference.
    const periodEnd2 = (store.subscriptions[0]!['currentPeriodEnd'] as Date).getTime();
    expect(periodEnd2).toBe(periodEnd1);
    // ...and the replay reports no material change + no receipt payload.
    expect(r1.changed).toBe(true);
    expect(r2.changed).toBe(false);
    expect(r2.paidInvoice).toBeUndefined();
    expect(store.subscriptions).toHaveLength(1);
  });

  it('a DIFFERENT reference does record a second invoice and extends again', async () => {
    await applyBillingEvent(event);
    const end1 = (store.subscriptions[0]!['currentPeriodEnd'] as Date).getTime();
    await applyBillingEvent({
      ...event,
      data: { ...event.data, providerReference: 'ref-xyz' },
    });
    expect(store.invoices).toHaveLength(2);
    const end2 = (store.subscriptions[0]!['currentPeriodEnd'] as Date).getTime();
    expect(end2).toBeGreaterThan(end1);
  });
});

// ── degrade / restore: no silent data destruction ───────────────────────────

describe('degradeUserToFree / restoreUserPlan — rules preserved, no destruction', () => {
  beforeEach(() => {
    store.links.push({
      id: 'link-1',
      code: 'geo01',
      ownerId: USER,
      routingMode: 'geo',
      passwordHash: 'argon2-hash',
    });
    store.link_destinations.push(
      { id: 'd1', linkId: 'link-1', match: { type: 'geo', countries: ['NG'] }, destinationUrl: 'https://ng' },
      { id: 'd2', linkId: 'link-1', match: { type: 'geo', countries: ['US'] }, destinationUrl: 'https://us' },
    );
    store.links.push({ id: 'link-2', code: 'abx02', ownerId: USER, routingMode: 'ab', passwordHash: null });
    store.link_destinations.push(
      { id: 'd3', linkId: 'link-2', match: { type: 'ab', weight: 50 }, destinationUrl: 'https://a' },
      { id: 'd4', linkId: 'link-2', match: { type: 'ab', weight: 50 }, destinationUrl: 'https://b' },
    );
    store.links.push({ id: 'link-3', code: 'sng03', ownerId: USER, routingMode: 'single', passwordHash: null });
    store.links.push({ id: 'link-x', code: 'other', ownerId: 'user-2', routingMode: 'geo', passwordHash: null });
  });

  it('downgrade flips paid routing to single but preserves destinations + password', async () => {
    await degradeUserToFree(USER);

    const l1 = store.links.find((l) => l['id'] === 'link-1')!;
    const l2 = store.links.find((l) => l['id'] === 'link-2')!;
    const l3 = store.links.find((l) => l['id'] === 'link-3')!;
    const lx = store.links.find((l) => l['id'] === 'link-x')!;

    expect(l1['routingMode']).toBe('single');
    expect(l2['routingMode']).toBe('single');
    expect(l3['routingMode']).toBe('single');
    expect(lx['routingMode']).toBe('geo'); // other user untouched

    // NO data destruction: destinations + password_hash intact.
    expect(store.link_destinations).toHaveLength(4);
    expect(l1['passwordHash']).toBe('argon2-hash');

    expect(redisDel).toHaveBeenCalledWith('link:hot:geo01');
    expect(redisDel).toHaveBeenCalledWith('link:hot:abx02');
  });

  it('restore re-derives the original routing_mode from preserved destinations', async () => {
    await degradeUserToFree(USER);
    await restoreUserPlan(USER);

    const l1 = store.links.find((l) => l['id'] === 'link-1')!;
    const l2 = store.links.find((l) => l['id'] === 'link-2')!;
    const l3 = store.links.find((l) => l['id'] === 'link-3')!;

    expect(l1['routingMode']).toBe('geo');
    expect(l2['routingMode']).toBe('ab');
    expect(l3['routingMode']).toBe('single');

    expect(store.link_destinations).toHaveLength(4);
  });
});
