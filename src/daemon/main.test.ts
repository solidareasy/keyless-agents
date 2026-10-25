import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { startDaemon } from './main.js';
import { main } from '../cli/main.js';

const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
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
