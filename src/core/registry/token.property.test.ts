import fc from 'fast-check';
import { expect, it } from 'vitest';
import { generateToken, hashToken, tokensEqual } from './token.js';

it('compares hashes exactly when generated strings are equal', () => {
  fc.assert(
    fc.property(fc.string(), fc.string(), (a, b) => {
      expect(tokensEqual(hashToken(a), hashToken(b))).toBe(a === b);
      expect(tokensEqual(hashToken(a), hashToken(a))).toBe(true);
    }),
    { numRuns: 500 },
  );
});

it('rejects a single changed token character and unequal hash lengths', () => {
  fc.assert(
    fc.property(fc.integer({ min: 5, max: 47 }), (index) => {
      const token = generateToken();
      const changed = token.slice(0, index) + (token[index] === 'a' ? 'b' : 'a') + token.slice(index + 1);
      const hash = hashToken(token);
      expect(tokensEqual(hash, hashToken(changed))).toBe(false);
      expect(tokensEqual(hash, hash.slice(2))).toBe(false);
    }),
    { numRuns: 500 },
  );
});
