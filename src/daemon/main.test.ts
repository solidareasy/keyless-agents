import { closeSync, mkdtempSync, openSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { startDaemon } from './main.js';
import { main } from '../cli/main.js';

vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>();
  return { ...fs, closeSync: vi.fn(fs.closeSync), openSync: vi.fn(fs.openSync) };
});

function auditFds(auditPath: string): number[] {
  return vi
    .mocked(openSync)
    .mock.calls.flatMap(([target], index) =>
      target === auditPath ? [vi.mocked(openSync).mock.results[index]?.value as number] : [],
    );
}
function closedFds(): number[] {
  return vi.mocked(closeSync).mock.calls.map(([fd]) => fd);
}

const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(
    servers.map(
      (s) =>
        new Promise<void>((resolve) => {
          s.closeAllConnections();
          s.close(() => resolve());
        }),
    ),
  );
  servers.length = 0;
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'klag-start-'));
  roots.push(root);
  const path = join(root, 'config.json');
  const config = {
    awsRegion: 'canary-region',
    auth: { issuerUrl: 'https://issuer.example.invalid', audience: 'sts.amazonaws.com' },
    projects: [
      { project: 'alpha', env: 'dev', roleArn: 'canary-role', kmsKeyAlias: 'alias/alpha-dev' },
    ],
    listen: '127.0.0.1:0',
    operatorSocket: join(root, 'op.sock'),
    policy: { get: 'value' },
    rateLimit: { perMinute: 60, burst: 10 },
    audit: { path: join(root, 'audit.jsonl') },
    store: 'memory',
  };
  writeFileSync(path, JSON.stringify(config));
  return { root, path, config };
}

it('starts the memory-only daemon with persistent audit and derived registry', async () => {
  const { path, root } = fixture();
  const started = await startDaemon(path);
  expect(started.ok).toBe(true);
  if (!started.ok) throw new Error('Daemon fixture unavailable');
  servers.push(started.server);
  expect(started.server.listening).toBe(true);
  expect(readFileSync(join(root, 'audit.jsonl'), 'utf8')).toBe('');
});

it('keeps the audit fd open while serving and closes it when the server closes', async () => {
  const { path, config } = fixture();
  const started = await startDaemon(path);
  if (!started.ok) throw new Error('Daemon fixture unavailable');
  const fds = auditFds(config.audit.path);
  expect(fds).toHaveLength(1);
  expect(closedFds()).not.toContain(fds[0]);
  await new Promise<void>((resolve) => {
    started.server.closeAllConnections();
    started.server.close(() => resolve());
  });
  expect(closedFds().filter((fd) => fd === fds[0])).toHaveLength(1);
});

it('closes the audit fd when the audit chain fails to verify at startup', async () => {
  const { path, config } = fixture();
  writeFileSync(config.audit.path, '{}\n', { mode: 0o600 });
  expect(await startDaemon(path)).toEqual({ ok: false, message: 'Daemon startup failed.' });
  const fds = auditFds(config.audit.path);
  expect(fds).toHaveLength(1);
  expect(closedFds().filter((fd) => fd === fds[0])).toHaveLength(1);
});

it('closes the audit fd when listen fails after the sink was built', async () => {
  const { path, config, root } = fixture();
  const blocker = createServer();
  await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
  try {
    const address = blocker.address();
    if (address === null || typeof address === 'string') throw new Error('Blocker unavailable');
    writeFileSync(path, JSON.stringify({ ...config, listen: `127.0.0.1:${address.port}` }));
    expect(await startDaemon(path)).toEqual({ ok: false, message: 'Daemon startup failed.' });
    const fds = auditFds(join(root, 'audit.jsonl'));
    expect(fds).toHaveLength(1);
    expect(closedFds().filter((fd) => fd === fds[0])).toHaveLength(1);
  } finally {
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
  }
});

it('refuses startup without explicit memory mode before opening state files', async () => {
  const { path, config } = fixture();
  writeFileSync(path, JSON.stringify({ ...config, store: undefined }));
  expect(await startDaemon(path)).toEqual({ ok: false, message: 'AWS adapter not available yet' });
});

it('sanitizes bad JSON, invalid configuration, inaccessible state and a broken audit chain', async () => {
  const { path, config } = fixture();
  writeFileSync(path, '{');
  expect(await startDaemon(path)).toEqual({ ok: false, message: 'Invalid configuration JSON.' });
  writeFileSync(path, '{}');
  expect(await startDaemon(path)).toEqual({ ok: false, message: 'INVALID_AWS_REGION' });
  writeFileSync(
    path,
    JSON.stringify({ ...config, audit: { path: '/missing-canary-directory/audit.jsonl' } }),
  );
  expect(await startDaemon(path)).toEqual({ ok: false, message: 'Daemon startup failed.' });
  writeFileSync(path, JSON.stringify(config));
  writeFileSync(config.audit.path, '{}\n', { mode: 0o600 });
  expect(await startDaemon(path)).toEqual({ ok: false, message: 'Daemon startup failed.' });
});

it('routes klag serve without reading agent configuration and sanitizes startup failures', async () => {
  const h = fixture();
  vi.stubEnv('KLAG_CONFIG', h.path);
  let stderr = '';
  const server = await startDaemon(h.path);
  if (!server.ok) throw new Error('Fixture daemon unavailable');
  servers.push(server.server);
  const success = vi.fn(() => Promise.resolve(server));
  expect(
    await main(['serve'], {
      serve: success,
      config: () => {
        throw new Error('Agent config must not be read');
      },
    }),
  ).toBe(0);
  expect(success).toHaveBeenCalled();
  expect(
    await main(['serve', '--json'], {
      stderr: (text) => {
        stderr += text;
      },
    }),
  ).toBe(1);
  expect(stderr).toBe('Invalid request.\n');
  stderr = '';
  expect(
    await main(['serve'], {
      serve: () => Promise.resolve({ ok: false, message: 'AWS adapter not available yet' }),
      stderr: (text) => {
        stderr += text;
      },
    }),
  ).toBe(5);
  expect(stderr).toBe('AWS adapter not available yet\n');
});
