import fc from 'fast-check';
import { expect, it } from 'vitest';
import { validateRequest } from './validate.js';

it('never throws for arbitrary objects', () => {
  fc.assert(
    fc.property(fc.object(), (input) => {
      expect(() => validateRequest(input)).not.toThrow();
    }),
    { numRuns: 300 },
  );
});

it('never throws for arbitrary values', () => {
  fc.assert(
    fc.property(fc.anything(), (input) => {
      expect(() => validateRequest(input)).not.toThrow();
    }),
    { numRuns: 300 },
  );
});

const request = fc.oneof(
  fc.record({
    v: fc.constant(1),
    auth: fc.constant('x'),
    op: fc.constant('list'),
    prefix: fc.string(),
  }),
  fc.record({
    v: fc.constant(1),
    auth: fc.constant('x'),
    op: fc.constant('get'),
    name: fc.string(),
  }),
  fc.record({
    v: fc.constant(1),
    auth: fc.constant('x'),
    op: fc.constant('set'),
    name: fc.string(),
    value: fc.string(),
  }),
);

it('rejects either foreign keyspace field on every valid request', () => {
  fc.assert(
    fc.property(request, fc.anything(), (input, value) => {
      expect(validateRequest(input)).toEqual({ ok: true, request: input });
      for (const field of ['project', 'env']) {
        expect(validateRequest({ ...input, [field]: value })).toEqual({
          ok: false,
          code: 'INVALID',
          reason: 'FOREIGN_KEYSPACE_FIELD',
        });
      }
    }),
    { numRuns: 300 },
  );
});
