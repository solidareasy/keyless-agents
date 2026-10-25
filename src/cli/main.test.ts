import { PassThrough } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
import type { ErrorCode, OkResponse } from '../protocol/messages.js';
import { main, readValue, type CliIO } from './main.js';

const originalTitle = process.title;
afterEach(() => {
  process.title = originalTitle;
  vi.restoreAllMocks();
});
function harness(response: OkResponse = { v: 1, ok: true, names: [] }) {
  let stdout = '';
  let stderr = '';
  const io: CliIO = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    config: () => ({
      ok: true,
      config: { url: 'http://127.0.0.1:7777', auth: 'canary-placeholder' },
    }),
    request: vi.fn<CliIO['request']>().mockResolvedValue(response),
    readValue: () => Promise.resolve('canary-input'),
    serve: () => Promise.resolve({ ok: false, message: 'Daemon startup failed.' }),
  };
  return { io, output: () => ({ stdout, stderr }) };
}

it.each([[], ['--help'], ['get', '--help']].map((args) => [args]))(
  'prints usage without contacting the daemon %#',
  async (args) => {
    const h = harness();
    expect(await main(args, h.io)).toBe(0);
    expect(h.output()).toEqual({
      stdout: 'Usage: klag list [--prefix P] | get NAME | set NAME | doctor | serve\n',
      stderr: '',
    });
    expect(h.io.request).not.toHaveBeenCalled();
    expect(process.title).toBe('klag');
  },
);

it.each(
  [
    ['bogus'],
    ['get'],
    ['get', '../'],
    ['get', 'awsNAME'],
    ['set', 'A', 'canary-argv-value'],
    ['list', 'A'],
    ['list', '--prefix'],
    ['list', '--prefix', '../'],
    ['doctor', 'A'],
    ['get', 'A', '--prefix', 'B'],
    ['list', '--unknown'],
    ['list', '--json', '--json'],
    ['list', '--prefix', 'A', '--prefix', 'B'],
  ].map((args) => [args]),
)('rejects usage or invalid names before I/O %#', async (args) => {
  const h = harness();
  const read = vi.spyOn(h.io, 'readValue');
  expect(await main(args, h.io)).toBe(1);
  expect(h.output()).toEqual({ stdout: '', stderr: 'Invalid request.\n' });
  expect(h.io.request).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
});

it('lists names only, with the documented JSON shape', async () => {
  const h = harness({
    v: 1,
    ok: true,
    names: [
      { name: 'A', scope: 'shared' },
      { name: 'B', scope: 'agent' },
    ],
  });
  expect(await main(['list', '--prefix', 'A'], h.io)).toBe(0);
  expect(h.output()).toEqual({ stdout: 'A\nB\n', stderr: '' });
  expect(h.io.request).toHaveBeenCalledWith('http://127.0.0.1:7777', {
    v: 1,
    auth: 'canary-placeholder',
    op: 'list',
    prefix: 'A',
  });
  const json = harness({ v: 1, ok: true, names: [{ name: 'A', scope: 'shared' }] });
  expect(await main(['list', '--json'], json.io)).toBe(0);
  expect(json.output().stdout).toBe('{"names":[{"name":"A","scope":"shared"}]}\n');
});

it('prints get value raw without any added newline or with exact JSON metadata', async () => {
  const response = {
    v: 1,
    ok: true,
    value: 'canary-output\n',
    version: 3,
    scope: 'shared',
  } as const;
  const h = harness(response);
  expect(await main(['get', 'A'], h.io)).toBe(0);
  expect(h.output()).toEqual({ stdout: 'canary-output\n', stderr: '' });
  const json = harness(response);
  expect(await main(['get', 'A', '--json'], json.io)).toBe(0);
  expect(JSON.parse(json.output().stdout)).toEqual({
    name: 'A',
    value: 'canary-output\n',
    version: 3,
    scope: 'shared',
  });
});

it('sets from the local input variable and emits no value in text or JSON output', async () => {
  const h = harness({ v: 1, ok: true, version: 3, scope: 'agent' });
  expect(await main(['set', 'A'], h.io)).toBe(0);
  expect(h.output()).toEqual({ stdout: '', stderr: '' });
  expect(h.io.request).toHaveBeenCalledWith('http://127.0.0.1:7777', {
    v: 1,
    auth: 'canary-placeholder',
    op: 'set',
    name: 'A',
    value: 'canary-input',
  });
  const json = harness({ v: 1, ok: true, version: 3, scope: 'agent' });
  expect(await main(['set', 'A', '--json'], json.io)).toBe(0);
  expect(JSON.parse(json.output().stdout)).toEqual({ name: 'A', version: 3, scope: 'agent' });
});

it.each<[ErrorCode, number, string]>([
  ['INVALID', 1, 'Invalid request.'],
  ['NOT_FOUND', 2, 'Not found.'],
  ['DENIED', 3, 'Access denied.'],
  ['RATE_LIMITED', 4, 'Rate limit exceeded.'],
  ['UNAVAILABLE', 5, 'Service unavailable.'],
])('maps %s to the documented exit code and fixed human message', async (code, exit, message) => {
  const h = harness();
  vi.mocked(h.io.request).mockResolvedValue({ v: 1, ok: false, code });
  expect(await main(['get', 'A'], h.io)).toBe(exit);
  expect(h.output()).toEqual({ stdout: '', stderr: message + '\n' });
});

it('sanitizes unavailable configuration and input failures', async () => {
  const h = harness();
  h.io.config = () => ({ ok: false, code: 'UNAVAILABLE' });
  expect(await main(['list'], h.io)).toBe(5);
  expect(h.io.request).not.toHaveBeenCalled();
  const input = harness();
  input.io.readValue = () => Promise.reject(new Error('canary-private'));
  expect(await main(['set', 'A'], input.io)).toBe(5);
  expect(input.output()).toEqual({ stdout: '', stderr: 'Service unavailable.\n' });
});

it.each([
  ['list', { v: 1, ok: true, value: 'canary-hidden', version: 1, scope: 'shared' }],
  ['get', { v: 1, ok: true, names: [] }],
  ['set', { v: 1, ok: true, names: [] }],
])('rejects a mismatched success response for %s', async (op, response) => {
  const h = harness(response as OkResponse);
  expect(await main(op === 'list' ? [op] : [op, 'A'], h.io)).toBe(5);
  expect(h.output()).toEqual({ stdout: '', stderr: 'Service unavailable.\n' });
});

it('reads a terminal value with raw mode and no echo, then restores the terminal', async () => {
  const input = Object.assign(new PassThrough(), {
    isTTY: true,
    isRaw: false,
    setRawMode: vi.fn(),
  });
  const output = vi.fn();
  const value = readValue(input, output);
  input.write('canary-terminal\n');
  expect(await value).toBe('canary-terminal');
  expect(output).toHaveBeenCalledExactlyOnceWith('Value: ');
  expect(input.setRawMode.mock.calls).toEqual([[true], [false]]);
});

it.each(['interrupt', 'end', 'error'])(
  'restores raw mode on terminal %s without leaking input',
  async (mode) => {
    const input = Object.assign(new PassThrough(), {
      isTTY: true,
      isRaw: false,
      setRawMode: vi.fn(),
    });
    const value = readValue(input, () => {});
    const assertion = expect(value).rejects.toThrow('Input unavailable');
    if (mode === 'interrupt') input.write('\u0003');
    if (mode === 'end') input.end();
    if (mode === 'error') input.emit('error', new Error('canary-hidden'));
    await assertion;
    expect(input.setRawMode.mock.calls).toEqual([[true], [false]]);
  },
);

it.each([
  [undefined, [true, true], 0],
  ['DENIED', [true, false], 6],
  ['UNAVAILABLE', [false, false], 6],
  ['INVALID', [true, true], 0],
  ['RATE_LIMITED', [true, true], 0],
] as const)('doctor checks reachability and replacement for %s', async (code, oks, exit) => {
  const h = harness();
  if (code !== undefined) vi.mocked(h.io.request).mockResolvedValue({ v: 1, ok: false, code });
  expect(await main(['doctor', '--json'], h.io)).toBe(exit);
  expect(JSON.parse(h.output().stdout)).toEqual([
    {
      id: 'daemon-reachable',
      ok: oks[0],
      detail: oks[0] ? 'Daemon reachable.' : 'Daemon unavailable.',
    },
    {
      id: 'placeholder-replaced',
      ok: oks[1],
      detail: oks[1] ? 'Placeholder replaced.' : 'Placeholder not confirmed.',
    },
  ]);
});

it('doctor emits one text line per check and handles missing configuration', async () => {
  const h = harness();
  h.io.config = () => ({ ok: false, code: 'UNAVAILABLE' });
  expect(await main(['doctor'], h.io)).toBe(6);
  expect(h.output()).toEqual({
    stdout:
      'daemon-reachable: failed - Daemon unavailable.\nplaceholder-replaced: failed - Placeholder not confirmed.\n',
    stderr: '',
  });
  expect(h.io.request).not.toHaveBeenCalled();
});
