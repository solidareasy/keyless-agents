import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { format } from 'node:util';
import { afterEach, expect, it, vi } from 'vitest';
import { cli } from '../support/cli.js';
import { daemonFixture } from '../support/daemon.js';

const CANARY = 'canary-7f3a9c2e-value-must-never-leak';

afterEach(() => vi.restoreAllMocks());

it('M7 permits the value only in successful get stdout across CLI and daemon surfaces', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'klag-canary-'));
  const preload = join(directory, 'capture.mjs');
  // This preload exists only in the test directory and runs inside each CLI subprocess.
  // Production entrypoints contain no inspection hook or test environment variable.
  writeFileSync(
    preload,
    `import { writeFileSync } from 'node:fs';
const errors = [];
process.on('uncaughtExceptionMonitor', err => errors.push(String(err), err.stack ?? ''));
process.on('beforeExit', () => {
  if (process.env.KLAG_TEST_CAPTURE) writeFileSync(process.env.KLAG_TEST_CAPTURE,
    JSON.stringify({ argv: process.argv.join(' '), title: process.title, errors }));
});
`,
  );
  const surfaces: Array<{ label: string; text: string }> = [];
  const captureError = (error: unknown) => {
    surfaces.push({ label: 'String(err)', text: String(error) });
    surfaces.push({ label: 'err.stack', text: error instanceof Error ? (error.stack ?? '') : '' });
  };
  const f = await daemonFixture();
  const originalGet = f.store.get.bind(f.store);
  vi.spyOn(f.store, 'get').mockImplementation(async (path) => {
    try {
      return await originalGet(path);
    } catch (error) {
      captureError(error);
      throw error;
    }
  });
  const originalPut = f.store.put.bind(f.store);
  vi.spyOn(f.store, 'put').mockImplementation(async (...args) => {
    try {
      return await originalPut(...args);
    } catch (error) {
      captureError(error);
      throw error;
    }
  });
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    surfaces.push({ label: 'daemon stdout', text: String(chunk) });
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    surfaces.push({ label: 'daemon stderr', text: String(chunk) });
    return true;
  });
  // Vitest replaces console's streams, so capture its methods as well as raw writes.
  for (const method of ['log', 'info', 'debug', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      surfaces.push({ label: `daemon console.${method}`, text: format(...args) });
    });
  }
  let sequence = 0;
  async function run(args: string[], code: number, stdin = '', allowValue = false, auth = f.alpha) {
    const path = join(directory, `process-${sequence++}.json`);
    const result = await cli(f.url, auth, args, stdin, [preload], { KLAG_TEST_CAPTURE: path });
    expect(result.code).toBe(code);
    if (allowValue) expect(result.stdout).toBe(CANARY);
    else surfaces.push({ label: 'CLI stdout', text: result.stdout });
    surfaces.push({ label: 'CLI stderr', text: result.stderr });
    for (const text of result.errors) surfaces.push({ label: 'CLI error', text });
    const snapshot = JSON.parse(readFileSync(path, 'utf8')) as {
      argv: string;
      title: string;
      errors: string[];
    };
    expect(snapshot.title).toBe('klag');
    expect(snapshot.argv).toContain(args.join(' '));
    surfaces.push({ label: 'CLI argv', text: snapshot.argv });
    surfaces.push({ label: 'CLI process.title', text: snapshot.title });
    for (const text of snapshot.errors) surfaces.push({ label: 'CLI thrown error', text });
  }
  try {
    await run(['set', 'SECRET'], 0, CANARY);
    expect(await f.store.get('/alpha/dev/agent/SECRET')).toEqual({ value: CANARY, version: 1 });
    await run(['get', 'SECRET'], 0, '', true);
    await run(['set', '../'], 1, CANARY);
    await run(['get', 'SECRET'], 3, '', false, '__KLAG_AUTH__');
    await run(['get', 'MISSING'], 2);
    for (const kind of ['ACCESS_DENIED', 'THROTTLED', 'UNAVAILABLE'] as const) {
      f.store.failNext(kind);
      await run(['get', 'SECRET'], 5);
    }
    f.store.failNext('UNAVAILABLE');
    await run(['set', 'SECRET'], 5, CANARY);
    expect(await f.store.get('/alpha/dev/agent/SECRET')).toEqual({ value: CANARY, version: 1 });
    expect(surfaces.filter(({ label }) => label === 'String(err)')).toHaveLength(4);
    expect(f.audit.verify()).toMatchObject({ ok: true, count: 8 });
    for (const text of f.sink.readAll()) surfaces.push({ label: 'audit line', text });
    await f.close();
    await run(['get', 'SECRET'], 5);
    for (const { label, text } of surfaces) expect(text.includes(CANARY), label).toBe(false);
  } catch (error) {
    captureError(error);
    throw error;
  } finally {
    await f.close();
    rmSync(directory, { recursive: true, force: true });
  }
}, 30000);
