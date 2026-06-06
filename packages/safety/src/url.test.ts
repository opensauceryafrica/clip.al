import { describe, expect, it } from 'vitest';
import { isUnsafeHost } from './ssrf';
import { validateDestination } from './url';

describe('isUnsafeHost', () => {
  it.each([
    'localhost',
    '127.0.0.1',
    '10.0.0.5',
    '172.16.4.4',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata endpoint
    '0.0.0.0',
    '8.8.8.8', // public IP literals are rejected too
    '::1',
    'fe80::1',
    'router', // single-label / internal-looking
    'db.local',
    'service.internal',
  ])('rejects %s', (host) => {
    expect(isUnsafeHost(host)).toBe(true);
  });

  it.each(['example.com', 'sub.example.co.uk', 'a.b.c.example.org'])('allows %s', (host) => {
    expect(isUnsafeHost(host)).toBe(false);
  });
});

describe('validateDestination', () => {
  it('accepts a normal https URL', () => {
    const r = validateDestination('https://example.com/path?q=1');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.etld1).toBe('example.com');
      expect(r.value.sld).toBe('example');
    }
  });

  it('accepts http', () => {
    expect(validateDestination('http://example.com').ok).toBe(true);
  });

  it.each([
    ['empty string', '', 'empty'],
    ['non-URL', 'not a url', 'invalid'],
    ['ftp scheme', 'ftp://example.com', 'bad_scheme'],
    ['javascript scheme', 'javascript:alert(1)', 'bad_scheme'],
    ['embedded credentials', 'https://user:pass@example.com', 'has_credentials'],
    ['localhost', 'http://localhost:3000', 'private_host'],
    ['loopback IP', 'http://127.0.0.1/admin', 'private_host'],
    ['private CIDR', 'http://10.1.2.3', 'private_host'],
    ['link-local', 'http://169.254.169.254/latest/meta-data', 'private_host'],
    ['ipv6 loopback', 'http://[::1]/', 'private_host'],
    ['known shortener', 'https://bit.ly/abc', 'known_shortener'],
  ])('rejects %s', (_label, input, reason) => {
    const r = validateDestination(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(reason);
  });

  it('rejects URLs longer than 2048 chars', () => {
    const long = `https://example.com/${'a'.repeat(2100)}`;
    const r = validateDestination(long);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('too_long');
  });
});
