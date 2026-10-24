import { expect, it } from 'vitest';
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

it('keeps the previous hash when the sink fails before appending', () => {
  const target = sink();
  let fail = true;
  const log = new AuditLog({
    readAll: target.readAll,
    append: (line) => {
      if (fail) throw new Error('Canary write failure');
      target.append(line);
    },
  });
  expect(() => log.record(fields)).toThrow('Canary write failure');
  fail = false;
  const hash = log.record(fields);
  expect(log.verify()).toEqual({ ok: true, count: 1, lastHash: hash });
});

it('verifies current storage rather than a cached verification result', () => {
  const lines: string[] = [];
  const log = new AuditLog(sink(lines));
  log.record(fields);
  lines.push('{');
  expect(log.verify()).toEqual({ ok: false, line: 2, reason: 'PARSE' });
});
