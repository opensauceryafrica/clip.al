import type { ErrorEvent } from '@sentry/node';
import { describe, expect, it } from 'vitest';
import { redactPii, scrubEvent } from './index';

describe('redactPii', () => {
  it('redacts emails, JWTs, IPs, and 6-digit codes', () => {
    const out = redactPii(
      'user me@example.com code 481920 ip 203.0.113.7 token eyJabc.def123_-.ghi456',
    );
    expect(out).not.toContain('me@example.com');
    expect(out).not.toContain('481920');
    expect(out).not.toContain('203.0.113.7');
    expect(out).not.toContain('eyJabc');
    expect(out).toContain('[redacted-email]');
    expect(out).toContain('[redacted-code]');
    expect(out).toContain('[redacted-ip]');
    expect(out).toContain('[redacted-token]');
  });
});

describe('scrubEvent', () => {
  it('drops identity/cookies/headers/body and redacts url, query, message, exceptions', () => {
    const event = {
      user: { email: 'me@example.com', ip_address: '203.0.113.7' },
      message: 'failed for me@example.com',
      request: {
        url: 'https://clip.al/verify?email=me@example.com',
        query_string: 'email=me@example.com',
        cookies: { clipal_session: 'eyJh.payload.sig' },
        headers: { cookie: 'clipal_session=eyJh.payload.sig' },
        data: { email: 'me@example.com', code: '481920' },
      },
      exception: { values: [{ type: 'Error', value: 'bad email me@example.com' }] },
      extra: { note: 'code 481920 for me@example.com' },
    } as unknown as ErrorEvent;

    const out = scrubEvent(event);
    const serialized = JSON.stringify(out);

    expect(out.user).toBeUndefined();
    expect(out.request?.cookies).toBeUndefined();
    expect(out.request?.headers).toBeUndefined();
    expect(out.request?.data).toBeUndefined();
    expect(serialized).not.toContain('me@example.com');
    expect(serialized).not.toContain('481920');
    expect(serialized).not.toContain('eyJh.payload.sig');
  });
});
