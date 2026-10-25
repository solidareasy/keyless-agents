#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { startDaemon } from '../daemon/main.js';
import { validateName } from '../core/names/names.js';
import { exitCodeFor, humanMessage } from '../protocol/errors.js';
import type { Request } from '../protocol/messages.js';
import { request } from './client.js';
import { loadCliConfig } from './config.js';

type SecretInput = Readable & {
  isTTY?: boolean;
  isRaw?: boolean;
  setRawMode?: (mode: boolean) => unknown;
};

export function readValue(
  input: SecretInput = process.stdin,
  output: (text: string) => void = (text) => {
    process.stderr.write(text);
  },
): Promise<string> {
  if (!input.isTTY) return Promise.resolve(readFileSync(0, 'utf8'));
  return new Promise((resolve, reject) => {
    const wasRaw = input.isRaw === true;
    input.setRawMode!(true);
    output('Value: ');
    const reader = createInterface({ input, terminal: false });
    let done = false;
    const finish = (value?: string) => {
      if (done) return;
      done = true;
      input.removeListener('data', interrupt);
      reader.close();
      input.setRawMode!(wasRaw);
      input.pause();
      if (value === undefined) reject(new Error('Input unavailable'));
      else resolve(value);
    };
    const interrupt = (chunk: Buffer) => {
      if (chunk.includes(3) || chunk.includes(4)) finish();
    };
    input.on('data', interrupt);
    reader.once('line', (value) => finish(value));
    reader.once('close', () => finish());
    reader.once('error', () => finish());
  });
}

export type CliIO = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  config: typeof loadCliConfig;
  request: typeof request;
  readValue: () => Promise<string>;
  serve: typeof startDaemon;
};
const usage = 'Usage: klag list [--prefix P] | get NAME | set NAME | doctor | serve [--json]\n';

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  overrides: Partial<CliIO> = {},
): Promise<number> {
  process.title = 'klag';
  const io: CliIO = {
    stdout: (text) => {
      process.stdout.write(text);
    },
    stderr: (text) => {
      process.stderr.write(text);
    },
    serve: startDaemon,
    config: loadCliConfig,
    request,
    readValue,
    ...overrides,
  };
  const error = (code: Parameters<typeof humanMessage>[0]) => {
    io.stderr(humanMessage(code) + '\n');
    return exitCodeFor(code);
  };
  if (argv.length === 0 || argv.includes('--help')) {
    io.stdout(usage);
    return 0;
  }
  const [op, ...args] = argv;
  if (op === 'serve') {
    if (args.length !== 0) return error('INVALID');
    const started = await io.serve();
    if (started.ok) return 0;
    io.stderr(started.message + '\n');
    return 5;
  }
  if (op !== 'list' && op !== 'get' && op !== 'set' && op !== 'doctor') return error('INVALID');
  let json = false;
  let prefix: string | undefined;
  let name: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === '--json' && !json) {
      json = true;
    } else if (arg === '--prefix' && op === 'list' && prefix === undefined) {
      prefix = args[++index];
      if (!validateName(prefix).ok) return error('INVALID');
    } else if (!arg.startsWith('-') && (op === 'get' || op === 'set') && name === undefined) {
      if (!validateName(arg).ok) return error('INVALID');
      name = arg;
    } else return error('INVALID');
  }
  if ((op === 'get' || op === 'set') && name === undefined) return error('INVALID');
  const cfg = io.config();
  if (!cfg.ok && op !== 'doctor') return error(cfg.code);
  try {
    const response = !cfg.ok
      ? { v: 1 as const, ok: false as const, code: 'UNAVAILABLE' as const }
      : await io.request(cfg.config.url, await buildRequest());
    async function buildRequest(): Promise<Request> {
      // Only a validated configuration enters this function.
      const auth = cfg.ok ? cfg.config.auth : '';
      if (op === 'set') {
        const value = await io.readValue();
        return { v: 1, auth, op, name: name!, value };
      }
      if (op === 'get') return { v: 1, auth, op, name: name! };
      return { v: 1, auth, op: 'list', ...(prefix === undefined ? {} : { prefix }) };
    }
    if (op === 'doctor') {
      const reachable = response.ok || response.code !== 'UNAVAILABLE';
      const replaced = reachable && (response.ok || response.code !== 'DENIED');
      const checks = [
        {
          id: 'daemon-reachable',
          ok: reachable,
          detail: reachable ? 'Daemon reachable.' : 'Daemon unavailable.',
        },
        {
          id: 'placeholder-replaced',
          ok: replaced,
          detail: replaced ? 'Placeholder replaced.' : 'Placeholder not confirmed.',
        },
      ];
      io.stdout(
        json
          ? JSON.stringify(checks) + '\n'
          : checks
              .map(({ id, ok, detail }) => `${id}: ${ok ? 'ok' : 'failed'} - ${detail}\n`)
              .join(''),
      );
      return checks.every(({ ok }) => ok) ? 0 : 6;
    }
    if (!response.ok) return error(response.code);
    if (op === 'list' && 'names' in response) {
      io.stdout(
        json
          ? JSON.stringify({ names: response.names }) + '\n'
          : response.names.map(({ name }) => name + '\n').join(''),
      );
    } else if (op === 'get' && 'value' in response) {
      io.stdout(
        json
          ? JSON.stringify({
              name,
              value: response.value,
              version: response.version,
              scope: response.scope,
            }) + '\n'
          : response.value,
      );
    } else if (op === 'set' && 'version' in response && !('value' in response)) {
      if (json)
        io.stdout(
          JSON.stringify({ name, version: response.version, scope: response.scope }) + '\n',
        );
    } else return error('UNAVAILABLE');
    return 0;
  } catch {
    return error('UNAVAILABLE');
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  process.exitCode = await main();
}
