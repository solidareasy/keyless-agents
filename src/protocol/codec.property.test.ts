import fc from 'fast-check';
import { expect, it } from 'vitest';
import { decodeJson, encode } from './codec.js';
import type { ErrorResponse, OkResponse } from './messages.js';

const scope = fc.constantFrom('shared' as const, 'agent' as const);
const response: fc.Arbitrary<OkResponse | ErrorResponse> = fc.oneof(
  fc.record({
    v: fc.constant(1 as const),
    ok: fc.constant(true as const),
    names: fc.array(fc.record({ name: fc.string(), scope })),
  }),
  fc.record({
    v: fc.constant(1 as const),
    ok: fc.constant(true as const),
    value: fc.string(),
    version: fc.integer({ min: 1 }),
    scope,
  }),
  fc.record({
    v: fc.constant(1 as const),
    ok: fc.constant(true as const),
    version: fc.integer({ min: 1 }),
    scope: fc.constant('agent' as const),
  }),
  fc.record({
    v: fc.constant(1 as const),
    ok: fc.constant(false as const),
    code: fc.constantFrom(
      'INVALID' as const,
      'NOT_FOUND' as const,
      'DENIED' as const,
      'RATE_LIMITED' as const,
      'UNAVAILABLE' as const,
    ),
  }),
);

it('roundtrips all valid response shapes through JSON', () => {
  fc.assert(
    fc.property(response, (input) => {
      const text = encode(input);
      expect(text).not.toMatch(/[\r\n]/);
      expect(decodeJson(text)).toEqual({ ok: true, value: input });
    }),
    { numRuns: 300 },
  );
});
