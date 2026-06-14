import { describe, expect, it } from 'vitest';
import { env } from '@clipal/config';
import { publicUrl } from './objects';

describe('publicUrl', () => {
  it('joins the public base with a simple key', () => {
    env.S3_PUBLIC_URL = 'http://localhost:9000/clipal';
    expect(publicUrl('qr/abc.png')).toBe('http://localhost:9000/clipal/qr/abc.png');
  });

  it('strips a trailing slash on the base and a leading slash on the key', () => {
    env.S3_PUBLIC_URL = 'https://cdn.clip.al/';
    expect(publicUrl('/creatives/banner.jpg')).toBe(
      'https://cdn.clip.al/creatives/banner.jpg',
    );
  });

  it('url-encodes each path segment but preserves separators', () => {
    env.S3_PUBLIC_URL = 'https://cdn.clip.al';
    expect(publicUrl('ad creatives/my file.png')).toBe(
      'https://cdn.clip.al/ad%20creatives/my%20file.png',
    );
  });
});
