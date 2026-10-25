import { request as httpRequest } from 'node:http';
import { InMemoryParameterStore } from '../../src/adapters/fake/in-memory-parameter-store.js';
import { InMemoryAuditSink } from '../../src/adapters/audit/memory-sink.js';
import { InMemoryRegistryStore } from '../../src/adapters/registry/memory-store.js';
import { AuditLog } from '../../src/core/audit/log.js';
import { Registry } from '../../src/core/registry/registry.js';
import { RateLimiter } from '../../src/core/rate-limit/limiter.js';
import { validateRateLimitConfig } from '../../src/core/rate-limit/token-bucket.js';
import { SweepDetector } from '../../src/core/rate-limit/sweep.js';
import { createHandler } from '../../src/daemon/handler.js';
import { createServer } from '../../src/daemon/server.js';
import type { HandlerDeps } from '../../src/daemon/handler.js';

export const putOptions = {
  type: 'SecureString',
  keyId: 'alias/alpha-dev',
  overwrite: true,
} as const;
export async function daemonFixture() {
  const store = new InMemoryParameterStore();
  const sink = new InMemoryAuditSink();
  const audit = new AuditLog(sink);
  const registry = new Registry(
    new InMemoryRegistryStore(),
    () => new Date('2026-01-01T00:00:00Z'),
  );
  const alpha = registry.add('canary-alpha', 'alpha', 'dev');
  const beta = registry.add('canary-beta', 'beta', 'dev');
  if (!alpha.ok || !beta.ok) throw new Error('Fixture registration failed');
  const rateConfig = { perMinute: 60, burst: 10 };
  if (!validateRateLimitConfig(rateConfig).ok) throw new Error('Invalid fixture configuration');
  const rateLimiter = new RateLimiter(rateConfig, () => 0);
  const deps: HandlerDeps = {
    store,
    audit,
    registry,
    rateLimiter,
    policyConfig: { get: 'value' },
    sweep: new SweepDetector(300000, () => 0),
    now: () => new Date('2026-01-01T00:00:00Z'),
    kmsKeyAliasFor: (ks) => `alias/${ks.project}-${ks.env}`,
  };
  const server = createServer(createHandler(deps));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Fixture server unavailable');
  const url = `http://127.0.0.1:${address.port}`;
  const close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return {
    store,
    sink,
    audit,
    registry,
    rateLimiter,
    deps,
    server,
    url,
    alpha: alpha.token,
    beta: beta.token,
    close,
  };
}
export type DaemonFixture = Awaited<ReturnType<typeof daemonFixture>>;

export function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: unknown; text: string }>((resolve, reject) => {
    const req = httpRequest(
      url,
      { method: 'POST', headers: { 'content-type': 'application/json', ...headers } },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          text += chunk;
        });
        res.on('end', () =>
          resolve({ status: res.statusCode!, body: JSON.parse(text) as unknown, text }),
        );
      },
    );
    req.on('error', reject);
    req.end(typeof body === 'string' ? body : JSON.stringify(body));
  });
}
