import { describe, expect, it } from 'vitest';
import { generateSlug, rollPreviousCodes, validateCustomSlug } from './slug';

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

describe('rollPreviousCodes', () => {
  it('keeps the retired back-half', () => {
    expect(rollPreviousCodes([], 'old1', 'new1', 5)).toEqual(['old1']);
  });

  it('drops the claimed code (reclaiming an old alias)', () => {
    expect(rollPreviousCodes(['promo', 'sale'], 'current', 'promo', 5)).toEqual([
      'sale',
      'current',
    ]);
  });

  it('dedupes (retired already present)', () => {
    expect(rollPreviousCodes(['a', 'b'], 'a', 'x', 5)).toEqual(['a', 'b']);
  });

  it('caps to the most recent N', () => {
    expect(rollPreviousCodes(['c1', 'c2', 'c3', 'c4', 'c5'], 'c6', 'x', 5)).toEqual([
      'c2',
      'c3',
      'c4',
      'c5',
      'c6',
    ]);
  });
});
