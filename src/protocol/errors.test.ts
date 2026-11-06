import { expect, expectTypeOf, it } from 'vitest';
import { EXIT_CODES, exitCodeFor, httpStatusFor, humanMessage } from './errors.js';
import type { ErrorCode } from './messages.js';

it('exposes all CLI exit codes', () => {
  expect(EXIT_CODES).toEqual({
    ok: 0,
    usage: 1,
    notFound: 2,
    denied: 3,
    rateLimited: 4,
    unavailable: 5,
    doctorFailed: 6,
  });
  expectTypeOf<ReturnType<typeof exitCodeFor>>().toEqualTypeOf<1 | 2 | 3 | 4 | 5>();
});

const cases: Array<[ErrorCode, number, number, string]> = [
  ['INVALID', 1, 400, 'Invalid request.'],
  ['NOT_FOUND', 2, 404, 'Not found.'],
  ['DENIED', 3, 403, 'Access denied.'],
  ['RATE_LIMITED', 4, 429, 'Rate limit exceeded.'],
  ['UNAVAILABLE', 5, 503, 'Service unavailable.'],
];

it.each(cases)('maps %s to fixed public errors', (code, exit, status, message) => {
  expect(exitCodeFor(code)).toBe(exit);
  expect(httpStatusFor(code)).toBe(status);
  expect(humanMessage(code)).toBe(message);
});

it.each(cases)('does not interpolate request context for %s', (code) => {
  const contexts = [
    { code, name: 'canary-name-a', value: 'canary-value-a' },
    { code, name: 'canary-name-b', value: 'canary-value-b' },
  ];
  const messages = contexts.map((context) => humanMessage(context.code));
  expect(messages[0]).toBe(messages[1]);
  for (const context of contexts) {
    expect(messages[0]).not.toContain(context.name);
    expect(messages[0]).not.toContain(context.value);
  }
  expectTypeOf<Parameters<typeof humanMessage>>().toEqualTypeOf<[code: ErrorCode]>();
});
