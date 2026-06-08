import { describe, expect, it } from 'vitest';
import { generateSlug, validateCustomSlug } from './slug';

describe('generateSlug', () => {
  it('produces a 7-character base62 code', () => {
    expect(generateSlug()).toMatch(/^[A-Za-z0-9]{7}$/);
  });

  it('is collision-free across a large sample', () => {
    const set = new Set(Array.from({ length: 5000 }, () => generateSlug()));
    expect(set.size).toBe(5000);
  });
});

describe('validateCustomSlug', () => {
  it.each(['promo', 'my-link', 'spring_sale', 'AbC123', 'q4-2026_launch'])(
    'accepts %s',
    (slug) => {
      const r = validateCustomSlug(slug);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toBe(slug);
    },
  );

  it('trims surrounding whitespace', () => {
    const r = validateCustomSlug('  promo  ');
    expect(r).toEqual({ ok: true, value: 'promo' });
  });

  it.each([
    ['empty', ''],
    ['too short', 'ab'],
    ['too long', 'a'.repeat(33)],
    ['leading hyphen', '-promo'],
    ['trailing underscore', 'promo_'],
    ['space inside', 'my link'],
    ['slash', 'a/b/c'],
    ['unicode', 'pãy'],
    ['dot', 'clip.al'],
  ])('rejects %s', (_label, slug) => {
    expect(validateCustomSlug(slug).ok).toBe(false);
  });
});
