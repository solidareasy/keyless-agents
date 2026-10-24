import { expect, it } from 'vitest';
import { generateToken, hashToken, tokensEqual } from './token.js';

it('generates 1000 distinct tokens with 256-bit base64url payloads', () => {
  const tokens = Array.from({ length: 1000 }, () => generateToken());
  expect(new Set(tokens).size).toBe(1000);
  for (const token of tokens) expect(token).toMatch(/^klag_[A-Za-z0-9_-]{43}$/);
});

it('hashes a known SHA-256 vector', () => {
  expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

it('compares decoded hashes and rejects different sizes without throwing', () => {
  expect(tokensEqual('ab'.repeat(32), 'ab'.repeat(32))).toBe(true);
  expect(tokensEqual('ab'.repeat(32), 'cd'.repeat(32))).toBe(false);
  expect(tokensEqual('ab', 'abcd')).toBe(false);
});

it.each([
  ['', 'zz'],
  ['', ''],
  ['ab', 'ab'],
  ['a'.repeat(63), 'a'.repeat(63)],
  ['ab'.repeat(32).toUpperCase(), 'ab'.repeat(32)],
  ['ab'.repeat(32), 'ab'.repeat(32).toUpperCase()],
  ['ab'.repeat(32) + 'zz', 'ab'.repeat(32)],
  ['ab'.repeat(32), 'ab'.repeat(32) + 'zz'],
])('rejects non-canonical SHA-256 hex without throwing %#', (a, b) => {
  expect(tokensEqual(a, b)).toBe(false);
});
