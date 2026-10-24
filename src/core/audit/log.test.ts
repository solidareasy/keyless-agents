import { expect, it, vi } from 'vitest';
import * as auditFields from './fields.js';
import { appendEntry, GENESIS_HASH } from './chain.js';
import type { AuditFields } from './chain.js';
import { AuditChainBroken, AuditLog } from './log.js';
import type { AuditSink } from './log.js';

const fields: AuditFields = {
  ts: 'canary-ts',
  sandboxId: 'canary-sandbox',
  op: 'list',
  name: null,
  version: null,
  decision: 'allow',
};
function sink(lines: string[] = []): AuditSink {
  return {
    append: (line) => {
      lines.push(line);
    },
    readAll: () => [...lines],
  };
}

it('records an empty chain and verifies the written entries', () => {
  const target = sink();
  const log = new AuditLog(target);
  expect(log.verify()).toEqual({ ok: true, count: 0, lastHash: GENESIS_HASH });
  const hash = log.record(fields);
  expect(target.readAll()).toEqual([appendEntry(GENESIS_HASH, fields).line]);
  expect(log.verify()).toEqual({ ok: true, count: 1, lastHash: hash });
});

it('resumes the persisted hash and continues the existing chain', () => {
  const target = sink();
  const hash = new AuditLog(target).record(fields);
  const resumed = new AuditLog(target);
  const next = resumed.record({ ...fields, decision: 'alert' });
  expect(target.readAll()[1]).toBe(appendEntry(hash, { ...fields, decision: 'alert' }).line);
  expect(resumed.verify()).toEqual({ ok: true, count: 2, lastHash: next });
});

it('refuses recording when constructed with a corrupt chain', () => {
  const target = sink(['{']);
  const log = new AuditLog(target);
  expect(log.verify()).toEqual({ ok: false, line: 1, reason: 'PARSE' });
  expect(() => log.record(fields)).toThrow(AuditChainBroken);
  expect(() => log.record(fields)).toThrow('Audit chain is broken');
  expect(target.readAll()).toEqual(['{']);
});

it.each([false, true])(
  'latches a failed append and refuses subsequent writes (partial=%s)',
  (partial) => {
    const target = sink();
    const failure = new Error('Canary write failure');
    const log = new AuditLog({
      readAll: () => target.readAll(),
      append: (line) => {
        if (partial) target.append(line.slice(0, 10));
        throw failure;
      },
    });
    expect(() => log.record(fields)).toThrow(failure);
    const persisted = target.readAll();
    expect(() => log.record(fields)).toThrow(AuditChainBroken);
    expect(target.readAll()).toEqual(persisted);
    expect(log.verify()).toEqual(
      partial
        ? { ok: false, line: 1, reason: 'PARSE' }
        : { ok: true, count: 0, lastHash: GENESIS_HASH },
    );
  },
);

it('verifies current storage rather than a cached verification result', () => {
  const lines: string[] = [];
  const log = new AuditLog(sink(lines));
  log.record(fields);
  lines.push('{');
  expect(log.verify()).toEqual({ ok: false, line: 2, reason: 'PARSE' });
});

it('records only the eight audit keys from a request with a canary value', () => {
  const target = sink();
  const log = new AuditLog(target);
  const request = { ...fields, op: 'set' as const, value: 'canary-value-request' };
  log.record(request);
  const line = target.readAll()[0]!;
  expect(line).not.toContain(request.value);
  expect(Object.keys(JSON.parse(line) as object)).toEqual([
    'ts',
    'sandboxId',
    'op',
    'name',
    'version',
    'decision',
    'prevHash',
    'hash',
  ]);
});

it.each(['ts', 'sandboxId', 'op', 'name', 'version', 'decision'])(
  'rejects missing %s without persisting or breaking the instance',
  (key) => {
    const target = sink();
    const log = new AuditLog(target);
    const invalid: Record<string, unknown> = { ...fields };
    delete invalid[key];
    expect(() => log.record(invalid as AuditFields)).toThrow('Invalid audit fields');
    expect(target.readAll()).toEqual([]);
    const hash = log.record(fields);
    expect(log.verify()).toEqual({ ok: true, count: 1, lastHash: hash });
  },
);

it.each([
  { ...fields, op: 'unknown' },
  { ...fields, decision: 'unknown' },
  { ...fields, ts: 42 },
  { ...fields, sandboxId: 42 },
])('rejects invalid field types and enums without poisoning storage %#', (invalid) => {
  const target = sink();
  const log = new AuditLog(target);
  expect(() => log.record(invalid as AuditFields)).toThrow('Invalid audit fields');
  expect(target.readAll()).toEqual([]);
  const hash = log.record(fields);
  expect(log.verify()).toEqual({ ok: true, count: 1, lastHash: hash });
});

it('shares the shape and enum validator between recording and chain verification', () => {
  const validation = vi.spyOn(auditFields, 'validateAuditFields');
  try {
    const log = new AuditLog(sink());
    log.record(fields);
    expect(validation).toHaveBeenCalledWith(fields, 'shape');
    expect(validation).toHaveBeenCalledWith(fields, 'enums');
    validation.mockClear();
    expect(log.verify().ok).toBe(true);
    expect(validation).toHaveBeenCalledWith(expect.objectContaining(fields), 'shape');
    expect(validation).toHaveBeenCalledWith(expect.objectContaining(fields), 'enums');
  } finally {
    validation.mockRestore();
  }
});

it.each([NaN, Infinity, -Infinity])(
  'rejects a non-finite version without persisting or breaking the instance %#',
  (version) => {
    const target = sink();
    const log = new AuditLog(target);
    expect(() => log.record({ ...fields, version })).toThrow(new TypeError('Invalid audit fields'));
    expect(target.readAll()).toEqual([]);
    const hash = log.record({ ...fields, version: 1 });
    expect(target.readAll()).toEqual([appendEntry(GENESIS_HASH, { ...fields, version: 1 }).line]);
    expect(log.verify()).toEqual({ ok: true, count: 1, lastHash: hash });
  },
);
