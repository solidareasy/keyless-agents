import { expect, expectTypeOf, it } from 'vitest';
import { PROTOCOL_VERSION } from './messages.js';
import type { ErrorCode, ErrorResponse, OkResponse, Op, Request } from './messages.js';

it('models the versioned request and response shapes', () => {
  expect(PROTOCOL_VERSION).toBe(1);
  expectTypeOf<typeof PROTOCOL_VERSION>().toEqualTypeOf<1>();
  expectTypeOf<Op>().toEqualTypeOf<'list' | 'get' | 'set'>();
  expectTypeOf<Request>().toEqualTypeOf<
    | { v: 1; auth: string; op: 'list'; prefix?: string }
    | { v: 1; auth: string; op: 'get'; name: string }
    | { v: 1; auth: string; op: 'set'; name: string; value: string }
  >();
  expectTypeOf<OkResponse>().toEqualTypeOf<
    | { v: 1; ok: true; names: Array<{ name: string; scope: 'shared' | 'agent' }> }
    | { v: 1; ok: true; value: string; version: number; scope: 'shared' | 'agent' }
    | { v: 1; ok: true; version: number; scope: 'agent' }
  >();
  expectTypeOf<ErrorResponse>().toEqualTypeOf<{ v: 1; ok: false; code: ErrorCode }>();
  expectTypeOf<ErrorCode>().toEqualTypeOf<
    'INVALID' | 'NOT_FOUND' | 'DENIED' | 'RATE_LIMITED' | 'UNAVAILABLE'
  >();
});
