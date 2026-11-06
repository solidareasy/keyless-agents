import fc from 'fast-check';
import { expect, it } from 'vitest';
import { validateResponse } from './validate.js';

const valid = [
  {
    v: 1,
    ok: true,
    names: [
      { name: '', scope: 'shared' },
      { name: 'canary-name', scope: 'agent' },
    ],
  },
  { v: 1, ok: true, names: [] },
  { v: 1, ok: true, value: 'canary-value', version: 3, scope: 'agent' },
  { v: 1, ok: true, value: '', version: -0.5, scope: 'shared' },
  { v: 1, ok: true, version: 0, scope: 'agent' },
  ...['INVALID', 'NOT_FOUND', 'DENIED', 'RATE_LIMITED', 'UNAVAILABLE'].map((code) => ({
    v: 1,
    ok: false,
    code,
  })),
];
it.each(valid)('accepts a documented response shape %#', (response) => {
  expect(validateResponse(response)).toEqual({ ok: true, response });
});

const get = { v: 1, ok: true, value: 'canary-value', version: 3, scope: 'agent' };
const invalid: unknown[] = [
  null,
  [],
  1,
  {},
  { ...get, v: 2 },
  { ...get, ok: 'true' },
  { v: 1, ok: false, code: 'OTHER' },
  { v: 1, ok: false },
  { v: 1, ok: false, code: 'DENIED', message: 'canary-value' },
  { ...get, extra: null },
  { ...get, scope: 'other' },
  { ...get, value: null },
  ...[NaN, Infinity, -Infinity, '3', null, undefined].map((version) => ({ ...get, version })),
  { v: 1, ok: true, scope: 'shared', version: 3 },
  { v: 1, ok: true, scope: 'agent' },
  { v: 1, ok: true, version: 3, scope: 'agent', name: '' },
  { v: 1, ok: true, names: null },
  { v: 1, ok: true, names: {} },
  { v: 1, ok: true, names: [null] },
  { v: 1, ok: true, names: [{ name: '', scope: 'shared', value: 'canary-value' }] },
  { v: 1, ok: true, names: [{ name: 1, scope: 'agent' }] },
  { v: 1, ok: true, names: [{ name: '' }] },
  { v: 1, ok: true, names: [{ name: '', scope: 'other' }] },
  { v: 1, ok: true, names: [], version: 3 },
];
it.each(invalid)('rejects malformed response case %# with a fixed reason', (input) => {
  expect(validateResponse(input)).toEqual({ ok: false, reason: 'INVALID_RESPONSE' });
});

it('rejects required fields that would disappear in JSON', () => {
  const inherited: unknown = Object.create(get);
  const hidden = { ...get };
  Object.defineProperty(hidden, 'value', { enumerable: false });
  expect(validateResponse(inherited)).toEqual({ ok: false, reason: 'INVALID_RESPONSE' });
  expect(validateResponse(hidden)).toEqual({ ok: false, reason: 'INVALID_RESPONSE' });
});

it('returns a fixed failure when a property accessor throws', () => {
  expect(
    validateResponse({
      get v() {
        throw new Error('canary-accessor');
      },
    }),
  ).toEqual({ ok: false, reason: 'INVALID_RESPONSE' });
});

it('never throws for arbitrary response input', () => {
  fc.assert(
    fc.property(fc.anything(), (input) => {
      expect(() => validateResponse(input)).not.toThrow();
    }),
    { numRuns: 300 },
  );
});

it('rejects response accessors that can change after validation', () => {
  let value: unknown = 'canary-value';
  const input = {
    v: 1,
    ok: true,
    version: 3,
    scope: 'agent',
    get value() {
      return value;
    },
  };
  const result = validateResponse(input);
  value = null;
  expect(result).toEqual({ ok: false, reason: 'INVALID_RESPONSE' });
});

it('checks indexed list entries even when a custom iterator yields nothing', () => {
  const names = [{ name: 1, scope: 'agent' }];
  Object.defineProperty(names, Symbol.iterator, { value: () => [][Symbol.iterator]() });
  expect(validateResponse({ v: 1, ok: true, names })).toEqual({
    ok: false,
    reason: 'INVALID_RESPONSE',
  });
});

it('rejects sparse names arrays', () => {
  expect(validateResponse({ v: 1, ok: true, names: new Array<unknown>(1) })).toEqual({
    ok: false,
    reason: 'INVALID_RESPONSE',
  });
});

it('rejects accessor entries and accessor fields in list responses', () => {
  const indexed: unknown[] = [];
  Object.defineProperty(indexed, '0', {
    enumerable: true,
    get: () => ({ name: '', scope: 'agent' }),
  });
  const nested = [
    {
      get name() {
        return '';
      },
      scope: 'agent',
    },
  ];
  for (const names of [indexed, nested]) {
    expect(validateResponse({ v: 1, ok: true, names })).toEqual({
      ok: false,
      reason: 'INVALID_RESPONSE',
    });
  }
});
