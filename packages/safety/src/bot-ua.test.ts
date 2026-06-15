import { describe, expect, it } from 'vitest';
import { userAgentLooksBot } from './bot-ua';

const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const SAFARI_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

describe('userAgentLooksBot', () => {
  it('treats real browsers as human', () => {
    expect(userAgentLooksBot(CHROME)).toBe(false);
    expect(userAgentLooksBot(SAFARI_IOS)).toBe(false);
  });

  it('flags empty / missing / tiny UAs as bots', () => {
    expect(userAgentLooksBot('')).toBe(true);
    expect(userAgentLooksBot('   ')).toBe(true);
    expect(userAgentLooksBot(null)).toBe(true);
    expect(userAgentLooksBot(undefined)).toBe(true);
    expect(userAgentLooksBot('short')).toBe(true);
  });

  it('flags crawlers and link-preview fetchers', () => {
    expect(userAgentLooksBot('Googlebot/2.1 (+http://www.google.com/bot.html)')).toBe(true);
    expect(userAgentLooksBot('Mozilla/5.0 (compatible; bingbot/2.0; +http://x)')).toBe(true);
    expect(
      userAgentLooksBot('facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'),
    ).toBe(true);
    expect(userAgentLooksBot('TelegramBot (like TwitterBot)')).toBe(true);
    expect(userAgentLooksBot('Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)')).toBe(
      true,
    );
  });

  it('flags HTTP clients, headless browsers and scrapers', () => {
    expect(userAgentLooksBot('curl/8.4.0')).toBe(true);
    expect(userAgentLooksBot('python-requests/2.31.0')).toBe(true);
    expect(userAgentLooksBot('Go-http-client/2.0')).toBe(true);
    expect(userAgentLooksBot('axios/1.6.0')).toBe(true);
    expect(
      userAgentLooksBot(
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/124.0.0.0 Safari/537.36',
      ),
    ).toBe(true);
    expect(userAgentLooksBot('PostmanRuntime/7.36.0')).toBe(true);
  });

  it('flags monitoring and AI crawlers', () => {
    expect(userAgentLooksBot('Mozilla/5.0 (compatible; GPTBot/1.0; +https://openai.com/gptbot)')).toBe(
      true,
    );
    expect(userAgentLooksBot('Pingdom.com_bot_version_1.4_(http://www.pingdom.com/)')).toBe(true);
  });
});
