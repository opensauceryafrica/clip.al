/**
 * User-agent bot detection for ad bot-defense (spec §14.7).
 *
 * A deliberately broad, low-false-negative regex over the User-Agent string.
 * Used by the ad gate to suppress rendering (and never count impressions) for
 * crawlers, link-preview fetchers, headless browsers, HTTP libraries and
 * monitoring probes. We optimise for *not serving ads to bots* — the cost of a
 * false positive (a real human classified as a bot) is one missed ad, while a
 * false negative risks invalid traffic against AdSense. When in doubt, treat as
 * a bot.
 *
 * NOTE: an empty or missing UA is ALSO bot-like (real browsers always send one),
 * but we return that signal separately via `userAgentLooksBot('')` → true so the
 * caller doesn't need a special case.
 *
 * TODO(@owner): this list overlaps with — and could later be merged into — a
 * shared crawler list if one is introduced for the click pipeline.
 */
const BOT_UA_RE =
  /bot\b|spider|crawl|crawler|slurp|mediapartners|adsbot|apis-google|feedfetcher|bingpreview|facebookexternalhit|facebookcatalog|whatsapp|telegrambot|discordbot|slackbot|twitterbot|linkedinbot|pinterest|redditbot|embedly|quora link preview|skypeuripreview|nuzzel|bitlybot|vkshare|w3c_validator|google-?(?:read-aloud|site-verification|favicon|inspectiontool|other|safety)|chrome-lighthouse|headlesschrome|phantomjs|electron|puppeteer|playwright|selenium|webdriver|cypress|httpclient|python-requests|aiohttp|httpx\b|go-http-client|java\/|okhttp|axios\/|node-fetch|got \(|curl\/|wget\/|libwww-perl|scrapy|apache-httpclient|guzzlehttp|postmanruntime|insomnia|restsharp|httpie|powershell|winhttp|dataprovider|semrush|ahrefs|mj12bot|dotbot|petalbot|bytespider|gptbot|ccbot|claudebot|anthropic-ai|perplexitybot|amazonbot|applebot|yandex|baiduspider|sogou|exabot|seznambot|uptime|pingdom|statuscake|monitis|site24x7|datadog|newrelic|prometheus|nagios|zabbix|checkly|headless|lighthouse|google web preview|googleother|cloud mapping|bubing|nutch|heritrix|archive\.org_bot|ia_archiver/i;

/**
 * True when the User-Agent looks automated (a bot, crawler, headless browser, or
 * HTTP client) OR is empty/missing. Pure; never throws.
 */
export function userAgentLooksBot(ua: string | null | undefined): boolean {
  if (ua == null) return true;
  const s = ua.trim();
  if (s === '') return true;
  // An implausibly short UA (real browsers are long) is bot-like.
  if (s.length < 12) return true;
  return BOT_UA_RE.test(s);
}
