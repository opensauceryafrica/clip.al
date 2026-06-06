import { describe, expect, it } from 'vitest';
import { generateCode, hashCode, verifyCode } from './code';

describe('generateCode', () => {
  it('is always a 6-digit zero-padded string', () => {
    for (let i = 0; i < 500; i++) {
      expect(generateCode()).toMatch(/^\d{6}$/);
    }
  });
});

describe('hashCode / verifyCode', () => {
  it('verifies the correct code and rejects an incorrect one', async () => {
    const code = generateCode();
    const hash = await hashCode(code);
    expect(hash).not.toContain(code); // never store plaintext
    expect(await verifyCode(hash, code)).toBe(true);
    expect(await verifyCode(hash, '000000')).toBe(false);
  }, 20_000);
});
