import { describe, expect, it } from 'vitest';
import { NAME_RE, validateName } from './names.js';

describe('validateName', () => {
  it('exports the exact interface regex', () => {
    expect(NAME_RE.source).toBe('^(?!\\.{1,2}$)[A-Za-z0-9_.-]{1,128}$');
    expect(NAME_RE.flags).toBe('');
  });

  it.each(['DATABASE_URL', 'API_TOKEN', 'a..b', 'agent', 'A', '_', '-', 'a'.repeat(128)])(
    'accepts an unchanged valid name %#',
    (name) => {
      expect(validateName(name)).toEqual({ ok: true, name });
    },
  );

  it.each([
    [undefined, 'NOT_A_STRING'],
    [null, 'NOT_A_STRING'],
    [42, 'NOT_A_STRING'],
    [{}, 'NOT_A_STRING'],
    ['', 'EMPTY'],
    ['a'.repeat(129), 'TOO_LONG'],
    ['.', 'DOT_SEGMENT'],
    ['..', 'DOT_SEGMENT'],
    ['a/b', 'INVALID_CHAR'],
    ['*', 'INVALID_CHAR'],
    [' ', 'INVALID_CHAR'],
    [' canary-name ', 'INVALID_CHAR'],
    ['a\n', 'INVALID_CHAR'],
    ['a\r', 'INVALID_CHAR'],
    ['a\t', 'INVALID_CHAR'],
    ['а', 'INVALID_CHAR'],
    ['é', 'INVALID_CHAR'],
    ['e\u0301', 'INVALID_CHAR'],
    ['\u0000', 'INVALID_CHAR'],
    ['AWS_REGION', 'RESERVED_PREFIX'],
    ['SsmX', 'RESERVED_PREFIX'],
    ['aws', 'RESERVED_PREFIX'],
    ['ssm', 'RESERVED_PREFIX'],
  ])('rejects invalid input %# with its specific code', (input, code) => {
    expect(validateName(input)).toEqual({ ok: false, code });
  });
});
