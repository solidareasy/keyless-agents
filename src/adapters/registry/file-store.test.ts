import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Registry } from '../../core/registry/registry.js';
import { FileRegistryStore } from './file-store.js';

vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>();
  return { ...fs, renameSync: vi.fn(fs.renameSync) };
});

let directory: string;
let path: string;
const entries = [
  {
    sandboxId: 'canary-sandbox',
    project: 'canary-project',
    env: 'dev',
    createdAt: '2026-01-01T00:00:00.000Z',
    tokenHash: 'a'.repeat(64),
  },
];

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'canary-registry-'));
  path = join(directory, 'registry.json');
});
afterEach(() => {
  vi.clearAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

it('loads an absent store as empty without writing', () => {
  expect(new FileRegistryStore(path).load()).toEqual([]);
  expect(readdirSync(directory)).toEqual([]);
});

it('writes 0600 JSON atomically through an exclusive temporary file', async () => {
  const real = await vi.importActual<typeof import('node:fs')>('node:fs');
  const store = new FileRegistryStore(path);
  store.save([]);
  vi.mocked(renameSync).mockImplementationOnce((source, destination) => {
    expect(source).not.toBe(path);
    expect(destination).toBe(path);
    expect(statSync(source).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(source, 'utf8'))).toEqual(entries);
    expect(readFileSync(path, 'utf8')).toBe('[]');
    real.renameSync(source, destination);
  });
  store.save(entries);
  expect(statSync(path).mode & 0o777).toBe(0o600);
  expect(new FileRegistryStore(path).load()).toEqual(entries);
  expect(readdirSync(directory)).toEqual(['registry.json']);
});

it.each([0o644, 0o640, 0o660, 0o700])(
  'rejects permissive existing files without repairing them %#',
  (mode) => {
    writeFileSync(path, '[]', { mode });
    chmodSync(path, mode);
    expect(() => new FileRegistryStore(path)).toThrow(
      'Registry file permissions must be 0600 or stricter',
    );
    expect(statSync(path).mode & 0o777).toBe(mode);
  },
);

it('rechecks permissions on both load and save', () => {
  const store = new FileRegistryStore(path);
  store.save(entries);
  chmodSync(path, 0o644);
  expect(() => store.load()).toThrow('Registry file permissions must be 0600 or stricter');
  expect(() => store.save([])).toThrow('Registry file permissions must be 0600 or stricter');
  expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(entries);
  expect(readdirSync(directory)).toEqual(['registry.json']);
});

it('accepts stricter permissions', () => {
  writeFileSync(path, '[]', { mode: 0o400 });
  expect(new FileRegistryStore(path).load()).toEqual([]);
});

it('preserves the previous store and removes the temporary file when rename fails', () => {
  const store = new FileRegistryStore(path);
  store.save(entries);
  vi.mocked(renameSync).mockImplementationOnce(() => {
    throw new Error('canary-write-failure');
  });
  expect(() => store.save([])).toThrow('canary-write-failure');
  expect(store.load()).toEqual(entries);
  expect(readdirSync(directory)).toEqual(['registry.json']);
});

it('persists only hashes and reloads revocation across registry instances', () => {
  const registry = new Registry(
    new FileRegistryStore(path),
    () => new Date('2026-01-01T00:00:00.000Z'),
    () => 'canary-file-token',
  );
  registry.add('canary-sandbox', 'canary-project', 'dev');
  const persisted = readFileSync(path, 'utf8');
  expect(persisted).not.toContain('canary-file-token');
  expect(new FileRegistryStore(path).load()[0]?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  const reloaded = new Registry(new FileRegistryStore(path), () => new Date());
  expect(reloaded.lookup('canary-file-token')?.sandboxId).toBe('canary-sandbox');
  reloaded.revoke('canary-sandbox');
  expect(registry.lookup('canary-file-token')).toBeNull();
});

it('sanitizes corrupt JSON errors at the registry boundary', () => {
  writeFileSync(path, 'canary-file-token', { mode: 0o600 });
  const registry = new Registry(new FileRegistryStore(path), () => new Date());
  expect(() => registry.lookup('canary-file-token')).toThrow('Registry operation failed');
  try {
    registry.lookup('canary-file-token');
  } catch (error) {
    expect(String(error)).not.toContain('canary-file-token');
    expect(JSON.stringify(error)).not.toContain('canary-file-token');
    expect((error as Error).stack).not.toContain('canary-file-token');
  }
});
