import {
  appendFileSync,
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { AuditChainBroken, AuditLog } from '../../core/audit/log.js';
import { FileAuditSink } from './file-sink.js';

const directories: string[] = [];
function temporaryPath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'canary-audit-'));
  directories.push(directory);
  return join(directory, 'audit.jsonl');
}
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

it('creates with 0600 and appends exactly one newline per line', () => {
  const path = temporaryPath();
  const sink = new FileAuditSink(path);
  expect(statSync(path).mode & 0o777).toBe(0o600);
  expect(sink.readAll()).toEqual(['']);
  sink.append('canary-one');
  sink.append('canary-two');
  expect(readFileSync(path, 'utf8')).toBe('canary-one\ncanary-two\n');
  expect(sink.readAll()).toEqual(['canary-one', 'canary-two', '']);
  expect(statSync(path).mode & 0o777).toBe(0o600);
});

it.each([0o644, 0o660, 0o700, 0o666])(
  'refuses permissive mode %i without repairing or changing existing contents',
  (mode) => {
    const path = temporaryPath();
    writeFileSync(path, 'canary-existing', { mode: 0o600 });
    chmodSync(path, mode);
    expect(() => new FileAuditSink(path)).toThrow('Audit file permissions are too permissive');
    expect(statSync(path).mode & 0o777).toBe(mode);
    expect(readFileSync(path, 'utf8')).toBe('canary-existing');
  },
);

it('preserves an existing private file and resumes its chain', () => {
  const path = temporaryPath();
  const fields = {
    ts: 'canary-ts',
    sandboxId: 'canary-sandbox',
    op: 'list' as const,
    name: null,
    version: null,
    decision: 'allow' as const,
  };
  const first = new AuditLog(new FileAuditSink(path));
  first.record(fields);
  const previous = readFileSync(path, 'utf8');
  const resumed = new AuditLog(new FileAuditSink(path));
  const hash = resumed.record(fields);
  expect(readFileSync(path, 'utf8').startsWith(previous)).toBe(true);
  expect(resumed.verify()).toEqual({ ok: true, count: 2, lastHash: hash });
});

it('detects a truncated final append and refuses recording on restart', () => {
  const path = temporaryPath();
  const fields = {
    ts: 'canary-ts',
    sandboxId: 'canary-sandbox',
    op: 'list' as const,
    name: null,
    version: null,
    decision: 'deny' as const,
  };
  new AuditLog(new FileAuditSink(path)).record(fields);
  appendFileSync(path, '{"ts":');
  const log = new AuditLog(new FileAuditSink(path));
  expect(log.verify()).toEqual({ ok: false, line: 2, reason: 'PARSE' });
  expect(() => log.record(fields)).toThrow(AuditChainBroken);
});
