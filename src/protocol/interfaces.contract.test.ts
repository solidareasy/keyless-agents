import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, expectTypeOf, it } from 'vitest';
import { EXIT_CODES, exitCodeFor } from './errors.js';
import type { ErrorCode } from './messages.js';
import { validateRequest } from './validate.js';

const tracked = execFileSync('git', ['ls-files', '-z', '--', 'INTERFACES.md'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
expect(tracked).toEqual(['INTERFACES.md']);
const doc = readFileSync(tracked[0]!, 'utf8');
const codes = [
  'INVALID',
  'NOT_FOUND',
  'DENIED',
  'RATE_LIMITED',
  'UNAVAILABLE',
] as const satisfies readonly ErrorCode[];

it('keeps the exact documented protocol error set at runtime and in types', () => {
  const documented = doc.match(/"code":"([^"\n]+)"/)?.[1]?.split('|');
  expect(documented).toBeDefined();
  expect(documented).toHaveLength(codes.length);
  expect(new Set(documented)).toEqual(new Set(codes));
  expectTypeOf<ErrorCode>().toEqualTypeOf<(typeof codes)[number]>();
});

it('maps CLI exits and protocol errors to the numbers extracted from Agent CLI', () => {
  const cli = doc.match(/## Agent CLI\n([\s\S]*?)\n## Protocol/)?.[1] ?? '';
  const line = cli.match(/Exit codes: ([^\n]+)/)?.[1] ?? '';
  const extracted = [...line.matchAll(/`(\d+)` ([^,.]+)/g)];
  expect(extracted).toHaveLength(7);
  const documented = new Map(extracted.map((match) => [match[2], Number(match[1])]));
  const labels = {
    ok: 'ok',
    usage: 'usage or invalid name',
    notFound: 'not found',
    denied: 'denied',
    rateLimited: 'rate limited',
    unavailable: 'daemon or AWS unavailable',
    doctorFailed: 'doctor failed',
  };
  expect(EXIT_CODES).toEqual(
    Object.fromEntries(Object.entries(labels).map(([key, label]) => [key, documented.get(label)])),
  );
  const errors: Record<ErrorCode, string> = {
    INVALID: 'usage or invalid name',
    NOT_FOUND: 'not found',
    DENIED: 'denied',
    RATE_LIMITED: 'rate limited',
    UNAVAILABLE: 'daemon or AWS unavailable',
  };
  for (const code of codes) expect(exitCodeFor(code)).toBe(documented.get(errors[code]));
});

it('enforces the documented foreign-keyspace anomaly rule', () => {
  const rule = doc.match(/A request carrying `([^`]+)` or `([^`]+)` returns `([^`]+)`/);
  expect(rule?.slice(1)).toEqual(['project', 'env', 'INVALID']);
  for (const field of rule!.slice(1, 3)) {
    expect(
      validateRequest({ v: 1, auth: 'x', op: 'get', name: 'A', [field]: 'canary-project' }),
    ).toEqual({
      ok: false,
      code: rule![3],
      reason: 'FOREIGN_KEYSPACE_FIELD',
    });
  }
});
