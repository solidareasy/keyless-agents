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
  renameSync,
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

it('keeps the validated fd open after construction and closes it exactly once on close()', () => {
  const path = temporaryPath();
  const sink = new FileAuditSink(path);
  expect(closeSync).not.toHaveBeenCalled();
  sink.close();
  sink.close();
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

it('opens the path once for the whole constructor, append and readAll cycle', () => {
  const path = temporaryPath();
  const sink = new FileAuditSink(path);
  sink.append('canary-one');
  sink.readAll();
  sink.append('canary-two');
  sink.readAll();
  expect(vi.mocked(openSync).mock.calls.filter(([target]) => target === path)).toHaveLength(1);
  for (const spy of [statSync, existsSync, readFileSync]) {
    expect(vi.mocked(spy).mock.calls.filter(([target]) => target === path)).toEqual([]);
  }
  sink.close();
});

it('reads back what it appended from byte 0 even though O_APPEND leaves the offset at EOF', () => {
  const path = temporaryPath();
  writeFileSync(path, 'canary-existing\n', { mode: 0o600 });
  const sink = new FileAuditSink(path);
  expect(sink.readAll()).toEqual(['canary-existing', '']);
  sink.append('canary-one');
  expect(sink.readAll()).toEqual(['canary-existing', 'canary-one', '']);
  sink.append('canary-two');
  expect(sink.readAll()).toEqual(['canary-existing', 'canary-one', 'canary-two', '']);
  sink.close();
});

it('keeps appending to and reading the original inode after the path is renamed and replaced', () => {
  const path = temporaryPath();
  const moved = `${path}.moved`;
  writeFileSync(path, 'canary-original\n', { mode: 0o600 });
  const sink = new FileAuditSink(path);
  renameSync(path, moved);
  writeFileSync(path, 'canary-other\n', { mode: 0o600 });
  sink.append('canary-one');
  expect(readFileSync(moved, 'utf8')).toBe('canary-original\ncanary-one\n');
  expect(sink.readAll()).toEqual(['canary-original', 'canary-one', '']);
  expect(readFileSync(path, 'utf8')).toBe('canary-other\n');
  sink.close();
});

it('keeps appending to and reading the original inode after the path becomes a symlink', () => {
  const path = temporaryPath();
  const moved = `${path}.moved`;
  const decoy = `${path}.decoy`;
  writeFileSync(decoy, 'canary-decoy\n', { mode: 0o600 });
  const sink = new FileAuditSink(path);
  sink.append('canary-one');
  renameSync(path, moved);
  symlinkSync(decoy, path);
  sink.append('canary-two');
  expect(readFileSync(moved, 'utf8')).toBe('canary-one\ncanary-two\n');
  expect(sink.readAll()).toEqual(['canary-one', 'canary-two', '']);
  expect(readFileSync(decoy, 'utf8')).toBe('canary-decoy\n');
  sink.close();
});

it('reads positionally from byte 0 across short reads', () => {
  const path = temporaryPath();
  writeFileSync(path, 'canary-abc\ncanary-def\n', { mode: 0o600 });
  const sink = new FileAuditSink(path);
  vi.clearAllMocks();
  const realRead = vi.mocked(readSync).getMockImplementation() as typeof readSync;
  vi.mocked(readSync).mockImplementation(((
    fd: number,
    buffer: NodeJS.ArrayBufferView,
    offset: number,
    length: number,
    position: number,
  ) => realRead(fd, buffer, offset, Math.min(length, 4), position)) as typeof readSync);
  try {
    expect(sink.readAll()).toEqual(['canary-abc', 'canary-def', '']);
    const positions = vi.mocked(readSync).mock.calls.map((call) => (call as unknown[])[4]);
    expect(positions[0]).toBe(0);
    expect(positions.length).toBeGreaterThan(1);
  } finally {
    vi.mocked(readSync).mockImplementation(realRead);
    sink.close();
  }
});

it('fails closed when the file shrinks to nothing before the first read instead of looping', () => {
  const path = temporaryPath();
  writeFileSync(path, 'canary-abc\n', { mode: 0o600 });
  const sink = new FileAuditSink(path);
  vi.clearAllMocks();
  vi.mocked(readSync).mockImplementationOnce(() => 0);
  expect(() => sink.readAll()).toThrow(new Error('Audit file shrank while reading'));
  expect(vi.mocked(readSync)).toHaveBeenCalledTimes(1);
  sink.close();
});

it('fails closed when the file is cut in the middle of a readAll', () => {
  const path = temporaryPath();
  writeFileSync(path, 'canary-abc\ncanary-def\n', { mode: 0o600 });
  const sink = new FileAuditSink(path);
  vi.clearAllMocks();
  const realRead = vi.mocked(readSync).getMockImplementation() as typeof readSync;
  vi.mocked(readSync)
    .mockImplementationOnce(((
      fd: number,
      buffer: NodeJS.ArrayBufferView,
      offset: number,
      length: number,
      position: number,
    ) => realRead(fd, buffer, offset, Math.min(length, 11), position)) as typeof readSync)
    .mockImplementationOnce(() => 0);
  try {
    expect(() => sink.readAll()).toThrow(new Error('Audit file shrank while reading'));
    expect(vi.mocked(readSync)).toHaveBeenCalledTimes(2);
  } finally {
    vi.mocked(readSync).mockImplementation(realRead);
    sink.close();
  }
});

it('close() is idempotent and append/readAll throw a fixed error afterwards', () => {
  const path = temporaryPath();
  const sink = new FileAuditSink(path);
  sink.append('canary-one');
  sink.close();
  expect(() => sink.close()).not.toThrow();
  expect(() => sink.append('canary-two')).toThrow(new Error('Audit sink is closed'));
  expect(() => sink.readAll()).toThrow(new Error('Audit sink is closed'));
  expect(readFileSync(path, 'utf8')).toBe('canary-one\n');
  expect(closeSync).toHaveBeenCalledTimes(1);
});
