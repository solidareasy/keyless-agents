import { describe, expect, it } from 'vitest';
import { appendEntry, canonical, GENESIS_HASH, hashLine, verifyChain } from './chain.js';
import type { AuditFields } from './chain.js';

const fields: AuditFields = {
  ts: '2026-01-01T00:00:00.000Z',
  sandboxId: 'canary-sandbox',
  op: 'get',
  name: 'CANARY_NAME',
  version: 1,
  decision: 'allow',
};
const vector = 'ca44b1d53ebc6cc9b8d656916786991a00eef42e2ff17ccd43b91da1090fedfd';
const keys = ['ts', 'sandboxId', 'op', 'name', 'version', 'decision', 'prevHash', 'hash'];

function chain(): string[] {
  let previous = GENESIS_HASH;
  return Array.from({ length: 5 }, () => {
    const entry = appendEntry(previous, fields);
    previous = entry.hash;
    return entry.line;
  });
}

describe('audit chain', () => {
  it('matches the independently calculated SHA-256 vector and fixed key order', () => {
    expect(GENESIS_HASH).toBe('0'.repeat(64));
    expect(hashLine(fields, GENESIS_HASH)).toBe(vector);
    expect(
      canonical(
        {
          decision: 'allow',
          version: 1,
          name: 'CANARY_NAME',
          op: 'get',
          sandboxId: 'canary-sandbox',
          ts: fields.ts,
        },
        GENESIS_HASH,
      ),
    ).toBe(
      '{"ts":"2026-01-01T00:00:00.000Z","sandboxId":"canary-sandbox","op":"get","name":"CANARY_NAME","version":1,"decision":"allow","prevHash":"' +
        '0'.repeat(64) +
        '"}',
    );
    const entry = appendEntry(GENESIS_HASH, fields);
    expect(entry.hash).toBe(vector);
    expect(Object.keys(JSON.parse(entry.line) as object)).toEqual(keys);
    expect(verifyChain([entry.line])).toEqual({ ok: true, count: 1, lastHash: vector });
  });

  it('accepts empty chains and one final empty line, but rejects interior empties', () => {
    expect(verifyChain([])).toEqual({ ok: true, count: 0, lastHash: GENESIS_HASH });
    expect(verifyChain([''])).toEqual({ ok: true, count: 0, lastHash: GENESIS_HASH });
    expect(verifyChain([...chain(), ''])).toMatchObject({ ok: true, count: 5 });
    expect(verifyChain(['', ...chain()])).toEqual({ ok: false, line: 1, reason: 'PARSE' });
    expect(verifyChain([...chain(), '', ''])).toEqual({ ok: false, line: 6, reason: 'PARSE' });
  });

  it('detects decision content tampering on the first broken line', () => {
    const lines = chain();
    lines[2] = lines[2]!.replace('allow', 'allox');
    lines[3] = '{';
    expect(verifyChain(lines)).toEqual({ ok: false, line: 3, reason: 'HASH_MISMATCH' });
  });

  it('detects removal, swapping, hash and previous hash byte changes', () => {
    const lines = chain();
    expect(verifyChain([...lines.slice(0, 2), ...lines.slice(3)])).toEqual({
      ok: false,
      line: 3,
      reason: 'PREV_MISMATCH',
    });
    expect(verifyChain([lines[0]!, lines[2]!, lines[1]!])).toEqual({
      ok: false,
      line: 2,
      reason: 'PREV_MISMATCH',
    });
    expect(verifyChain([lines[0]!.replace('"hash":"c', '"hash":"d')])).toEqual({
      ok: false,
      line: 1,
      reason: 'HASH_MISMATCH',
    });
    expect(verifyChain([lines[0]!.replace('"prevHash":"0', '"prevHash":"1')])).toEqual({
      ok: false,
      line: 1,
      reason: 'PREV_MISMATCH',
    });
    expect(verifyChain([lines[0]!.slice(0, -1)])).toEqual({ ok: false, line: 1, reason: 'PARSE' });
  });

  it.each([
    null,
    [],
    42,
    {},
    { ...fields, prevHash: GENESIS_HASH },
    { ...fields, prevHash: GENESIS_HASH, hash: vector, value: 'canary-extra' },
    ...['ts', 'sandboxId', 'op', 'decision', 'prevHash', 'hash'].map((key) => ({
      ...fields,
      prevHash: GENESIS_HASH,
      hash: vector,
      [key]: 42,
    })),
    { ...fields, name: 42, prevHash: GENESIS_HASH, hash: vector },
    { ...fields, version: '1', prevHash: GENESIS_HASH, hash: vector },
    { ...fields, prevHash: 'x', hash: vector },
    { ...fields, prevHash: GENESIS_HASH, hash: 'x' },
  ])('rejects malformed shapes %#', (input) => {
    expect(verifyChain([JSON.stringify(input)])).toEqual({ ok: false, line: 1, reason: 'SHAPE' });
  });

  it.each([
    { ...fields, op: 'unknown' },
    { ...fields, decision: 'unknown' },
  ])('rejects invalid enums even when correctly hashed %#', (invalid) => {
    const entry = appendEntry(GENESIS_HASH, invalid as AuditFields);
    expect(verifyChain([entry.line])).toEqual({ ok: false, line: 1, reason: 'SHAPE' });
  });

  it('serializes only audit fields from a request containing a canary', () => {
    const request = {
      ...fields,
      name: null,
      version: null,
      op: 'list' as const,
      value: 'canary-value-audit',
    };
    const entry = appendEntry(GENESIS_HASH, request);
    expect(entry.line).not.toContain(request.value);
    expect(Object.keys(JSON.parse(entry.line) as object)).toEqual(keys);
    expect(verifyChain([entry.line])).toEqual({ ok: true, count: 1, lastHash: entry.hash });
    expect(appendEntry(GENESIS_HASH, { ...fields, name: 'canary-\n-name' }).line).not.toContain(
      '\n',
    );
    // @ts-expect-error audit fields exclude request values
    const invalid: AuditFields = { ...fields, value: 'canary-type' };
    expect(invalid).toBeDefined();
  });
});

it('rejects a missing required key even when an extra key preserves the key count', () => {
  expect(
    verifyChain([
      JSON.stringify({
        sandboxId: 'canary-sandbox',
        op: 'get',
        name: null,
        version: null,
        decision: 'allow',
        prevHash: GENESIS_HASH,
        hash: vector,
        extra: 'canary-extra',
      }),
    ]),
  ).toEqual({ ok: false, line: 1, reason: 'SHAPE' });
});
