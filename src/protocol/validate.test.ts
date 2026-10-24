import { describe, expect, it } from 'vitest';
import { validateRequest } from './validate.js';
import type { RequestReason } from './validate.js';

const base = { v: 1, auth: '<placeholder>', op: 'get', name: 'canary-name' };

describe('request validation', () => {
  it.each([
    { v: 1, auth: '<placeholder>', op: 'list' },
    { v: 1, auth: '<placeholder>', op: 'get', name: 'canary-name' },
    { v: 1, auth: '<placeholder>', op: 'set', name: 'canary-name', value: 'canary-value' },
    { v: 1, auth: 'x', op: 'list', prefix: '' },
    { v: 1, auth: ' ', op: 'get', name: '' },
    { v: 1, auth: 'x', op: 'set', name: '..', value: '' },
  ])('accepts a documented request shape', (request) => {
    expect(validateRequest(request)).toEqual({ ok: true, request });
  });

  const failures: Array<[unknown, RequestReason]> = [
    [null, 'NOT_OBJECT'],
    [[], 'NOT_OBJECT'],
    [true, 'NOT_OBJECT'],
    [{ ...base, v: 2 }, 'BAD_VERSION'],
    [{ ...base, v: '1' }, 'BAD_VERSION'],
    [{ v: 1, op: 'list' }, 'MISSING_AUTH'],
    [{ ...base, auth: '' }, 'MISSING_AUTH'],
    [{ ...base, op: 'delete' }, 'BAD_OP'],
    [{ ...base, op: 1 }, 'BAD_OP'],
    [{ v: 1, auth: 'x', op: 'get' }, 'MISSING_NAME'],
    [{ v: 1, auth: 'x', op: 'set' }, 'MISSING_NAME'],
    [{ ...base, op: 'set' }, 'MISSING_VALUE'],
    [{ ...base, project: '' }, 'FOREIGN_KEYSPACE_FIELD'],
    [{ ...base, env: null }, 'FOREIGN_KEYSPACE_FIELD'],
    [{ ...base, extra: true }, 'UNKNOWN_FIELD'],
    [{ ...base, value: '' }, 'UNKNOWN_FIELD'],
    [{ v: 1, auth: 'x', op: 'list', name: '' }, 'UNKNOWN_FIELD'],
    [{ ...base, prefix: '' }, 'UNKNOWN_FIELD'],
    [{ ...base, auth: null }, 'BAD_TYPE'],
    [{ ...base, name: null }, 'BAD_TYPE'],
    [{ ...base, op: 'set', value: 1 }, 'BAD_TYPE'],
    [{ v: 1, auth: 'x', op: 'list', prefix: null }, 'BAD_TYPE'],
    [{ v: 1, auth: 'x', op: 'list', prefix: undefined }, 'BAD_TYPE'],
    [{ ...base, name: undefined }, 'BAD_TYPE'],
  ];
  it.each(failures)('rejects invalid request case %#', (input, reason) => {
    expect(validateRequest(input)).toEqual({ ok: false, code: 'INVALID', reason });
  });

  it.each(['project', 'env'])('prioritizes a foreign keyspace field', (field) => {
    for (const value of [null, '', undefined]) {
      expect(validateRequest({ [field]: value })).toEqual({
        ok: false,
        code: 'INVALID',
        reason: 'FOREIGN_KEYSPACE_FIELD',
      });
    }
  });

  it('does not throw for a throwing property accessor', () => {
    const input: unknown = {
      get v() {
        throw new Error('canary-accessor');
      },
    };
    expect(validateRequest(input)).toEqual({ ok: false, code: 'INVALID', reason: 'BAD_TYPE' });
  });
});
