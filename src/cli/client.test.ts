import { createServer, type Server } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { request } from './client.js';
const servers: Server[] = [];
afterEach(async () => {
  vi.useRealTimers();
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
async function endpoint(body: string) {
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => res.end(body));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture unavailable');
  return `http://127.0.0.1:${address.port}`;
}
const req = { v: 1, auth: 'canary-placeholder', op: 'list' } as const;
const unavailable = { v: 1, ok: false, code: 'UNAVAILABLE' };
it('validates a strict protocol response', async () => {
  expect(await request(await endpoint('{"v":1,"ok":true,"names":[]}'), req)).toEqual({
    v: 1,
    ok: true,
    names: [],
  });
  expect(await request(await endpoint('{"v":1,"ok":false,"code":"DENIED"}'), req)).toEqual({
    v: 1,
    ok: false,
    code: 'DENIED',
  });
});
it.each(['not-json', '{"v":1,"ok":true,"names":[],"extra":1}', '{}'])(
  'sanitizes malformed daemon responses %#',
  async (body) => {
    expect(await request(await endpoint(body), req)).toEqual(unavailable);
  },
);
it('sanitizes invalid URLs, refused connections and unsupported URL schemes', async () => {
  expect(await request('bad-url', req)).toEqual(unavailable);
  expect(await request('https://example.invalid', req)).toEqual(unavailable);
  const url = await endpoint('{}');
  await new Promise<void>((resolve) => servers[0]!.close(() => resolve()));
  expect(await request(url, req)).toEqual(unavailable);
});
it('times out a daemon request after five seconds', async () => {
  const server = createServer((incoming) => {
    incoming.resume();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture unavailable');
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const result = request(`http://127.0.0.1:${address.port}`, req);
  await vi.advanceTimersByTimeAsync(5000);
  expect(await result).toEqual(unavailable);
});
it('sanitizes truncated and oversized responses', async () => {
  const server = createServer((incoming, res) => {
    incoming.resume();
    res.writeHead(200, { 'content-length': '100' });
    res.write('{');
    res.socket?.destroy();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture unavailable');
  expect(await request(`http://127.0.0.1:${address.port}`, req)).toEqual(unavailable);
  expect(await request(await endpoint('a'.repeat(1024 * 1024 + 1)), req)).toEqual(unavailable);
});
