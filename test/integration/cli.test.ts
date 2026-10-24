import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { buildCli, cli } from '../support/cli.js';
import { daemonFixture, putOptions, type DaemonFixture } from '../support/daemon.js';
let f: DaemonFixture;
beforeAll(buildCli, 30000);
beforeEach(async () => {
  f = await daemonFixture();
  await f.store.put('/alpha/dev/A', 'canary-shared', putOptions);
});
afterEach(async () => {
  await f.close();
});

it.each([0, 1, 2, 3, 4, 5, 6])('CLI subprocess proves documented exit code %s', async (exit) => {
  const args =
    exit === 1 ? ['set', '../'] : exit === 6 ? ['doctor'] : ['get', exit === 2 ? 'MISSING' : 'A'];
  if (exit === 4) for (let i = 0; i < 10; i++) f.rateLimiter.take('canary-alpha');
  if (exit === 5) f.store.failNext('UNAVAILABLE');
  const result = await cli(
    f.url,
    exit === 3 || exit === 6 ? '__KLAG_AUTH__' : f.alpha,
    args,
    'canary-stdin',
  );
  expect(result.code).toBe(exit);
  if (exit === 0) expect(result.stdout).toBe('canary-shared');
  else if (exit !== 6) expect(result.stdout).toBe('');
  if (exit !== 0 && exit !== 6) expect(result.stderr).not.toBe('');
});

it('CLI --json uses the exact list/get/set shapes and reads set only from stdin', async () => {
  expect(JSON.parse((await cli(f.url, f.alpha, ['list', '--json'])).stdout)).toEqual({
    names: [{ name: 'A', scope: 'shared' }],
  });
  expect(JSON.parse((await cli(f.url, f.alpha, ['get', 'A', '--json'])).stdout)).toEqual({
    name: 'A',
    value: 'canary-shared',
    version: 1,
    scope: 'shared',
  });
  expect(
    JSON.parse((await cli(f.url, f.alpha, ['set', 'B', '--json'], 'canary-stdin')).stdout),
  ).toEqual({ name: 'B', version: 1, scope: 'agent' });
  expect(await f.store.get('/alpha/dev/agent/B')).toEqual({ value: 'canary-stdin', version: 1 });
  expect((await cli(f.url, f.alpha, ['set', 'B'], 'canary-input')).stdout).toBe('');
  expect((await cli(f.url, f.alpha, ['get', 'B'])).stdout).toBe('canary-input');
});

it('CLI doctor emits the confirmed check array and succeeds with a registered token', async () => {
  const result = await cli(f.url, f.alpha, ['doctor', '--json']);
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual([
    { id: 'daemon-reachable', ok: true, detail: 'Daemon reachable.' },
    { id: 'placeholder-replaced', ok: true, detail: 'Placeholder replaced.' },
  ]);
});
