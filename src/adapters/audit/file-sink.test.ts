import {
  appendFileSync,
  chmodSync,
  closeSync,
  existsSync,
  fstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { AuditChainBroken, AuditLog } from '../../core/audit/log.js';
import { FileAuditSink } from './file-sink.js';

vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>();
  return {
    ...fs,
    closeSync: vi.fn(fs.closeSync),
    existsSync: vi.fn(fs.existsSync),
    fstatSync: vi.fn(fs.fstatSync),
    openSync: vi.fn(fs.openSync),
    readFileSync: vi.fn(fs.readFileSync),
    readSync: vi.fn(fs.readSync),
    statSync: vi.fn(fs.statSync),
  };
});

const directories: string[] = [];
function temporaryPath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'canary-audit-'));
  directories.push(directory);
  return join(directory, 'audit.jsonl');
}
afterEach(() => {
  vi.clearAllMocks();
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
  const sink = new FileAuditSink(path);
  new AuditLog(sink).record(fields);
  appendFileSync(path, '{"ts":');
  const log = new AuditLog(sink);
  expect(log.verify()).toEqual({ ok: false, line: 2, reason: 'PARSE' });
  expect(() => log.record(fields)).toThrow(AuditChainBroken);
});

it('refuses an otherwise valid existing record without a final newline, preserving its bytes', () => {
  const path = temporaryPath();
  const fields = {
    ts: 'canary-ts',
    sandboxId: 'canary-sandbox',
    op: 'list' as const,
    name: null,
    version: null,
    decision: 'allow' as const,
  };
  new AuditLog(new FileAuditSink(path)).record(fields);
  const unterminated = readFileSync(path, 'utf8').slice(0, -1);
  writeFileSync(path, unterminated);
  expect(() => new FileAuditSink(path)).toThrow('Audit file must end with a newline');
  expect(readFileSync(path, 'utf8')).toBe(unterminated);
});

function openedFd(path: string): number {
  const opened = vi
    .mocked(openSync)
    .mock.calls.flatMap(([target], index) =>
      target === path ? [vi.mocked(openSync).mock.results[index]?.value as number] : [],
    );
  expect(opened).toHaveLength(1);
  return opened[0] as number;
}

it('checks mode and trailing newline through the one fd it opened, never by path (TOCTOU)', () => {
  const path = temporaryPath();
  writeFileSync(path, 'canary-existing\n', { mode: 0o600 });
  vi.clearAllMocks();
  new FileAuditSink(path);
  const fd = openedFd(path);
  expect(fstatSync).toHaveBeenCalledWith(fd);
  expect(readSync).toHaveBeenCalled();
  for (const [readFd] of vi.mocked(readSync).mock.calls) expect(readFd).toBe(fd);
  for (const spy of [statSync, existsSync, readFileSync]) {
    expect(vi.mocked(spy).mock.calls.filter(([target]) => target === path)).toEqual([]);
  }
});

it('closes its fd after a successful construction', () => {
  const path = temporaryPath();
  new FileAuditSink(path);
  expect(closeSync).toHaveBeenCalledTimes(1);
  expect(closeSync).toHaveBeenCalledWith(openedFd(path));
});

it.each([
  ['permissive mode', 0o644, 'canary-existing\n', 'Audit file permissions are too permissive'],
  ['missing final newline', 0o600, 'canary-existing', 'Audit file must end with a newline'],
])('closes its fd when it refuses a file with %s', (_name, mode, contents, message) => {
  const path = temporaryPath();
  writeFileSync(path, contents, { mode: 0o600 });
  chmodSync(path, mode);
  vi.clearAllMocks();
  expect(() => new FileAuditSink(path)).toThrow(message);
  expect(closeSync).toHaveBeenCalledTimes(1);
  expect(closeSync).toHaveBeenCalledWith(openedFd(path));
});

it('judges the inode it opened even if the path becomes a permissive symlink mid-constructor', () => {
  const path = temporaryPath();
  const decoy = `${path}.decoy`;
  writeFileSync(path, 'canary-existing\n', { mode: 0o600 });
  writeFileSync(decoy, 'canary-decoy', { mode: 0o666 });
  chmodSync(decoy, 0o666);
  const realFstat = vi.mocked(fstatSync).getMockImplementation() as typeof fstatSync;
  vi.mocked(fstatSync).mockImplementationOnce((fd: number) => {
    rmSync(path);
    symlinkSync(decoy, path);
    return realFstat(fd);
  });
  expect(() => new FileAuditSink(path)).not.toThrow();
  expect(fstatSync).toHaveBeenCalledTimes(1);
  expect(readFileSync(decoy, 'utf8')).toBe('canary-decoy');
});
