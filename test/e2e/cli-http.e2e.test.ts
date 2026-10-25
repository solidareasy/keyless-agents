import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, it } from 'vitest';

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
  if (address === null || typeof address === 'string') throw new Error('Port unavailable');
  return address.port;
}

async function portInUse(port: number): Promise<boolean> {
  const server = createServer();
  return new Promise<boolean>((resolveProbe, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') resolveProbe(true);
      else reject(error);
    });
    server.listen(port, '127.0.0.1', () => {
      server.close((error) => (error ? reject(error) : resolveProbe(false)));
    });
  });
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, 'close');
  const force = setTimeout(() => child.kill('SIGKILL'), 1000);
  child.kill('SIGTERM');
  try {
    await closed;
  } finally {
    clearTimeout(force);
  }
}

async function ready(url: string, child: ChildProcess): Promise<void> {
  const deadline = performance.now() + 10000;
  while (performance.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error('Daemon exited before readiness');
    try {
      const response = await fetch(url, {
        method: 'POST',
        body: JSON.stringify({ v: 1, auth: '__KLAG_AUTH__', op: 'list' }),
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(300),
      });
      const body = (await response.json()) as { ok?: boolean; code?: string };
      if (body.ok === false && body.code === 'DENIED') return;
    } catch {
      /* Connection failures are retried until the bounded POST readiness deadline. */
    }
    await delay(25);
  }
  throw new Error('Daemon POST readiness timed out after 10 seconds');
}

async function cli(url: string, auth: string | undefined, args: string[], input = '') {
  const child = spawn(process.execPath, [resolve('dist/cli/main.js'), ...args], {
    env: { KLAG_URL: url, ...(auth === undefined ? {} : { KLAG_AUTH: auth }) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk;
  });
  const closed = once(child, 'close');
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
  child.stdin.on('error', () => {
    /* A failed child may close stdin before consuming it. */
  });
  child.stdin.end(input);
  try {
    const [code] = (await closed) as [number | null];
    return { code, stdout, stderr };
  } finally {
    clearTimeout(timeout);
    await stop(child);
  }
}

it('round-trips stdin through real daemon and CLI processes without leaking the canary', async () => {
  const { Registry } = (await import(
    resolve('dist/core/registry/registry.js')
  )) as typeof import('../../src/core/registry/registry.js');
  const { FileRegistryStore } = (await import(
    resolve('dist/adapters/registry/file-store.js')
  )) as typeof import('../../src/adapters/registry/file-store.js');
  const { AuditLog } = (await import(
    resolve('dist/core/audit/log.js')
  )) as typeof import('../../src/core/audit/log.js');
  const { FileAuditSink } = (await import(
    resolve('dist/adapters/audit/file-sink.js')
  )) as typeof import('../../src/adapters/audit/file-sink.js');
  const directory = mkdtempSync(join(tmpdir(), 'klag-e2e-'));
  const auditPath = join(directory, 'audit.jsonl');
  const configPath = join(directory, 'config.json');
  let daemon: ChildProcess | undefined;
  let daemonStdout = '';
  let daemonStderr = '';
  const canary = 'canary-e2e-5c1d-value';
  try {
    const registration = new Registry(
      new FileRegistryStore(join(directory, 'registry.json')),
      () => new Date(),
    ).add('canary-e2e', 'alpha', 'dev');
    if (!registration.ok) throw new Error('Sandbox registration failed');
    const token = registration.token;
    let url = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const port = await freePort();
      url = `http://127.0.0.1:${port}`;
      writeFileSync(
        configPath,
        JSON.stringify({
          awsRegion: 'canary-region',
          auth: { issuerUrl: 'https://issuer.example.invalid', audience: 'sts.amazonaws.com' },
          projects: [
            {
              project: 'alpha',
              env: 'dev',
              roleArn: 'canary-role',
              kmsKeyAlias: 'alias/alpha-dev',
            },
          ],
          listen: `127.0.0.1:${port}`,
          operatorSocket: join(directory, 'op.sock'),
          policy: { get: 'value' },
          rateLimit: { perMinute: 60, burst: 10 },
          audit: { path: auditPath },
          store: 'memory',
        }),
        { mode: 0o600 },
      );
      daemon = spawn(process.execPath, [resolve('dist/cli/main.js'), 'serve'], {
        env: { KLAG_CONFIG: configPath },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      daemon.stdout!.setEncoding('utf8').on('data', (chunk: string) => {
        daemonStdout += chunk;
      });
      daemon.stderr!.setEncoding('utf8').on('data', (chunk: string) => {
        daemonStderr += chunk;
      });
      try {
        await ready(url, daemon);
        break;
      } catch (error) {
        // The daemon sanitizes bind errors, so confirm a port collision before retrying once.
        if (attempt === 1 || daemon.exitCode === null || !(await portInUse(port))) throw error;
        await stop(daemon);
      }
    }
    if (daemon === undefined) throw new Error('Daemon did not start');
    const set = await cli(url, token, ['set', 'E2E_ONE'], canary);
    expect(set).toMatchObject({ code: 0, stdout: '' });
    const get = await cli(url, token, ['get', 'E2E_ONE']);
    expect(get).toMatchObject({ code: 0, stdout: canary });
    const list = await cli(url, token, ['list']);
    expect(list.code).toBe(0);
    expect(list.stdout.split('\n')).toContain('E2E_ONE');
    const missing = await cli(url, token, ['get', 'E2E_MISSING']);
    expect(missing).toMatchObject({ code: 2, stdout: '' });
    const denied = await cli(url, undefined, ['get', 'E2E_ONE']);
    expect(denied).toMatchObject({ code: 3, stdout: '' });
    await stop(daemon);
    expect(daemonStdout, 'canary absent from daemon stdout').not.toContain(canary);
    expect(daemonStderr, 'canary absent from daemon stderr').not.toContain(canary);
    for (const result of [set, get, list, missing, denied]) {
      expect(result.stderr, 'canary absent from CLI stderr').not.toContain(canary);
    }
    const auditLines = readFileSync(auditPath, 'utf8').trim().split('\n');
    expect(auditLines.length).toBeGreaterThanOrEqual(5);
    for (const line of auditLines)
      expect(line, 'canary absent from each audit line').not.toContain(canary);
    expect(
      new AuditLog(new FileAuditSink(auditPath)).verify().ok,
      'audit hash chain verifies',
    ).toBe(true);
  } finally {
    if (daemon !== undefined) await stop(daemon);
    rmSync(directory, { recursive: true, force: true });
  }
}, 20000);
