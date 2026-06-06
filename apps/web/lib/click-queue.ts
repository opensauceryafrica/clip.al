import { keys, redis } from '@clipal/cache';

/**
 * Click event enqueue. The redirect/interstitial paths only ever ENQUEUE — they
 * never write to Postgres or ClickHouse directly (§10). A worker drains the
 * stream, parses UA/geo, hashes the IP, and batch-inserts to ClickHouse.
 *
 * The stream is length-capped (~5M, approximate trimming) so a stalled worker
 * can't grow Redis unbounded.
 */
export interface ClickEvent {
  code: string;
  linkId: string;
  ownerId: string | null;
  ip: string;
  ua: string;
  referrer: string;
  isInterstitial: 0 | 1;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  ts: number; // epoch ms
}

const STREAM_MAXLEN = 5_000_000;
const UA_MAX = 512;

export function enqueueClick(e: ClickEvent): Promise<string | null> {
  return redis.xadd(
    keys.clickStream,
    'MAXLEN',
    '~',
    STREAM_MAXLEN,
    '*',
    'code',
    e.code,
    'link_id',
    e.linkId,
    'owner_id',
    e.ownerId ?? '',
    'ts',
    new Date(e.ts).toISOString(),
    'ip',
    e.ip,
    'ua',
    e.ua.slice(0, UA_MAX),
    'referrer',
    e.referrer,
    'is_interstitial',
    String(e.isInterstitial),
    'utm_source',
    e.utmSource,
    'utm_medium',
    e.utmMedium,
    'utm_campaign',
    e.utmCampaign,
  );
}
