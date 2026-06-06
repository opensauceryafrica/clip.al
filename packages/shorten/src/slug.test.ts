import { describe, expect, it } from 'vitest';
import { generateSlug } from './slug';

describe('generateSlug', () => {
  it('produces a 7-character base62 code', () => {
    expect(generateSlug()).toMatch(/^[A-Za-z0-9]{7}$/);
  });

  it('is collision-free across a large sample', () => {
    const set = new Set(Array.from({ length: 5000 }, () => generateSlug()));
    expect(set.size).toBe(5000);
  });
});
