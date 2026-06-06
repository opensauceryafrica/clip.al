import type { DeviceClass } from '@clipal/config/constants';
import { UAParser } from 'ua-parser-js';

/**
 * UA → browser family, OS, device class, and a bot flag. Bots are tagged, not
 * dropped (they still get redirected; analytics excludes them) — §9.
 */
const BOT_RE =
  /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|preview|monitor|curl|wget|python-requests|go-http|node-fetch|axios|headless|phantomjs|pingdom|uptime|lighthouse|gtmetrix/i;

export interface ParsedUa {
  family: string;
  os: string;
  device: DeviceClass;
  isBot: boolean;
}

export function parseUa(ua: string): ParsedUa {
  const isBot = ua.length > 0 && BOT_RE.test(ua);
  const result = new UAParser(ua).getResult();
  const family = result.browser.name ?? 'unknown';
  const os = result.os.name ?? 'unknown';

  let device: DeviceClass;
  if (isBot) {
    device = 'bot';
  } else {
    const type = result.device.type; // 'mobile' | 'tablet' | 'console' | ... | undefined(desktop)
    if (type === 'mobile') device = 'mobile';
    else if (type === 'tablet') device = 'tablet';
    else if (type === undefined && ua.length > 0) device = 'desktop';
    else device = 'unknown';
  }

  return { family, os, device, isBot };
}
