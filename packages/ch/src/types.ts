/** A row in clipal.clicks. Mirrors infra/clickhouse/init.sql exactly. */
export interface ClickRow {
  ts: string; // ClickHouse DateTime64(3) literal, UTC (see toChDateTime)
  link_code: string;
  link_id: string;
  owner_id: string | null;
  ip_hash: string; // 64 hex chars (sha256)
  country: string; // ISO-3166 alpha-2, or 'ZZ' when unknown
  region: string;
  city: string;
  ua_family: string;
  ua_os: string;
  device: string; // 'mobile' | 'tablet' | 'desktop' | 'bot' | 'unknown'
  referrer_host: string;
  is_bot: 0 | 1;
  is_interstitial: 0 | 1;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
}

export interface DailyClicks {
  day: string;
  clicks: number;
  uniques: number;
}

export interface NamedCount {
  name: string;
  clicks: number;
}

export interface RecentClick {
  ts: string;
  country: string;
  city: string;
  device: string;
  ua_family: string;
  ua_os: string;
  referrer_host: string;
  is_bot: 0 | 1;
  is_interstitial: 0 | 1;
}
