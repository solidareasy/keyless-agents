import { request as httpRequest, type Server } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { AuditChainBroken } from '../core/audit/log.js';
import { createServer, serve } from './server.js';
import type { Handler } from './handler.js';

const servers: Server[] = [];
const originalExitCode = process.exitCode;
afterEach(async () => {
  process.exitCode = originalExitCode;
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
  servers.length = 0;
});

async function start(handler: Handler, maxBodyBytes = 64 * 1024) {
  const server = createServer(handler, { maxBodyBytes });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Test server unavailable');
  return { server, port: address.port };
}

function post(
  port: number,
  body: string,
  options: { path?: string; method?: string; headers?: Record<string, string> } = {},
) {
  return new Promise<{ status: number; type: string | undefined; text: string }>(
    (resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port,
          path: options.path ?? '/',
          method: options.method ?? 'POST',
          headers: { 'content-type': 'application/json', ...options.headers },
        },
        (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            text += chunk;
          });
          res.on('end', () =>
            resolve({ status: res.statusCode!, type: res.headers['content-type'], text }),
          );
        },
      );
      req.on('error', reject);
      req.end(body);
    },
  );
}

const ok = { status: 200, body: { v: 1, ok: true, names: [] } } as const;

it('serves exactly one JSON object and gives the auth header precedence', async () => {
  const handler = vi.fn<Handler>().mockResolvedValue({ ...ok, body: { ...ok.body, names: [] } });
  const { port } = await start(handler);
  const response = await post(port, '{"v":1,"op":"list","auth":"canary-body"}', {
    headers: { 'x-klag-auth': 'canary-header', 'content-type': 'application/json; charset=utf-8' },
  });
  expect(response).toEqual({
    status: 200,
    type: 'application/json',
    text: '{"v":1,"ok":true,"names":[]}\n',
  });
  expect(handler).toHaveBeenCalledWith({ v: 1, op: 'list', auth: 'canary-header' });
  await post(port, '{"v":1,"op":"list","auth":"canary-body"}');
  expect(handler).toHaveBeenLastCalledWith({ v: 1, op: 'list', auth: 'canary-body' });
});

it.each([
  { path: '/?auth=canary-token' },
  { path: '/?' },
  { path: '/elsewhere' },
  { method: 'GET' },
  { headers: { 'content-type': 'text/plain' } },
])('rejects unsupported HTTP input before invoking the handler %#', async (options) => {
  const handler = vi.fn<Handler>();
  const { port } = await start(handler);
  expect(await post(port, 'not-json', options)).toMatchObject({
    status: 400,
    text: '{"v":1,"ok":false,"code":"INVALID"}\n',
  });
  expect(handler).not.toHaveBeenCalled();
});

it('rejects a query without waiting for a body', async () => {
  const handler = vi.fn<Handler>();
  const { port } = await start(handler);
  await new Promise<void>((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path: '/?auth=canary-token',
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': '65000' },
      },
      (res) => {
        expect(res.statusCode).toBe(400);
        res.resume();
        res.on('end', resolve);
      },
    );
    req.on('error', reject);
    req.flushHeaders();
  });
  expect(handler).not.toHaveBeenCalled();
});

it('rejects malformed JSON and oversized bodies including chunked bodies', async () => {
  const handler = vi.fn<Handler>();
  const { port } = await start(handler, 32);
  expect((await post(port, '{')).status).toBe(400);
  expect((await post(port, 'a'.repeat(33))).status).toBe(400);
  await new Promise<void>((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, method: 'POST', headers: { 'content-type': 'application/json' } },
      (res) => {
        expect(res.statusCode).toBe(400);
        res.resume();
        res.on('end', resolve);
      },
    );
    req.on('error', reject);
    req.write('a'.repeat(20));
    req.end('a'.repeat(20));
  });
  expect(handler).not.toHaveBeenCalled();
});

it('does not turn primitive or array JSON into valid objects through a header', async () => {
  const handler = vi
    .fn<Handler>()
    .mockResolvedValue({ status: 400, body: { v: 1, ok: false, code: 'INVALID' } });
  const { port } = await start(handler);
  for (const text of ['null', '[]', '1', '"canary"'])
    await post(port, text, { headers: { 'x-klag-auth': 'canary-header' } });
  expect(handler.mock.calls.map(([input]) => input)).toEqual([null, [], 1, 'canary']);
});

it('sanitizes unexpected handler exceptions without exposing an error', async () => {
  const { port } = await start(() => Promise.reject(new Error('canary-private')));
  expect(await post(port, '{}')).toEqual({
    status: 503,
    type: 'application/json',
    text: '{"v":1,"ok":false,"code":"UNAVAILABLE"}\n',
  });
});

it('returns UNAVAILABLE, closes the server and sets a nonzero exit on audit failure', async () => {
  const { port, server } = await start(() => Promise.reject(new AuditChainBroken()));
  const closed = new Promise<void>((resolve) => server.once('close', resolve));
  expect((await post(port, '{}')).text).toBe('{"v":1,"ok":false,"code":"UNAVAILABLE"}\n');
  await closed;
  expect(server.listening).toBe(false);
  expect(process.exitCode).toBe(1);
});

it('serve binds to the configured host and port', async () => {
  const server = serve(
    { listen: '127.0.0.1:0' },
    {
      registry: { lookup: () => null },
      policyConfig: { get: 'value' },
      rateLimiter: { take: () => ({ allowed: true }) },
      sweep: { onList: () => {}, onGet: () => ({ alert: false }) },
      audit: { record: () => '' },
      store: {
        listByPath: () => Promise.resolve([]),
        get: () => Promise.resolve(null),
        put: () => Promise.resolve({ version: 1 }),
      },
      kmsKeyAliasFor: () => 'alias/canary-dev',
      now: () => new Date(),
    },
  );
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  expect(server.address()).toMatchObject({ address: '127.0.0.1' });
});
