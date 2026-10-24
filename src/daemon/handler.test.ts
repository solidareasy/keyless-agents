import { beforeEach, expect, it, vi } from 'vitest';
import { InMemoryParameterStore } from '../adapters/fake/in-memory-parameter-store.js';
import { InMemoryAuditSink } from '../adapters/audit/memory-sink.js';
import { InMemoryRegistryStore } from '../adapters/registry/memory-store.js';
import { AuditChainBroken, AuditLog } from '../core/audit/log.js';
import { Registry } from '../core/registry/registry.js';
import { RateLimiter } from '../core/rate-limit/limiter.js';
import { SweepDetector } from '../core/rate-limit/sweep.js';
import { createHandler, type HandlerDeps } from './handler.js';

let deps: HandlerDeps;
let sink: InMemoryAuditSink;
let store: InMemoryParameterStore;
let auth: string;
const now = () => new Date('2026-01-01T00:00:00Z');

beforeEach(() => {
  sink = new InMemoryAuditSink();
  store = new InMemoryParameterStore();
  const registry = new Registry(new InMemoryRegistryStore(), now);
  const added = registry.add('canary-alpha', 'alpha', 'dev');
  if (!added.ok) throw new Error('Fixture registration failed');
  auth = added.token;
  deps = {
    registry,
    store,
    audit: new AuditLog(sink),
    policyConfig: { get: 'value' },
    rateLimiter: new RateLimiter({ perMinute: 60, burst: 10 }, () => 0),
    sweep: new SweepDetector(300000, () => 0),
    kmsKeyAliasFor: () => 'alias/alpha-dev',
    now,
  };
});

function lastAudit() {
  return JSON.parse(sink.readAll().at(-1)!) as unknown;
}
const put = { type: 'SecureString', keyId: 'alias/alpha-dev', overwrite: true } as const;

it('validates the protocol before registry lookup', async () => {
  const lookup = vi.spyOn(deps.registry, 'lookup');
  expect(await createHandler(deps)({ v: 2, op: 'list' })).toEqual({
    status: 400,
    body: { v: 1, ok: false, code: 'INVALID' },
  });
  expect(lookup).not.toHaveBeenCalled();
  expect(lastAudit()).toMatchObject({ sandboxId: 'unknown', decision: 'deny', name: null });
});

it('audits foreign keyspace fields as an alert before authentication', async () => {
  expect(
    (await createHandler(deps)({ v: 1, auth, op: 'get', name: 'A', project: 'beta' })).body,
  ).toEqual({ v: 1, ok: false, code: 'INVALID' });
  expect(lastAudit()).toMatchObject({
    sandboxId: 'unknown',
    op: 'get',
    decision: 'alert',
    name: null,
  });
});

it('denies the unknown placeholder before name validation', async () => {
  expect(
    (await createHandler(deps)({ v: 1, auth: '__KLAG_AUTH__', op: 'get', name: '../' })).body,
  ).toEqual({ v: 1, ok: false, code: 'DENIED' });
  expect(lastAudit()).toMatchObject({ sandboxId: 'unknown', decision: 'alert', name: null });
});

it('validates names before taking rate budget', async () => {
  const take = vi.spyOn(deps.rateLimiter, 'take');
  expect((await createHandler(deps)({ v: 1, auth, op: 'get', name: '../' })).body).toEqual({
    v: 1,
    ok: false,
    code: 'INVALID',
  });
  expect(take).not.toHaveBeenCalled();
  expect(lastAudit()).toMatchObject({ sandboxId: 'canary-alpha', decision: 'deny', name: null });
});

it('validates a list prefix before store access', async () => {
  expect((await createHandler(deps)({ v: 1, auth, op: 'list', prefix: '../' })).body).toEqual({
    v: 1,
    ok: false,
    code: 'INVALID',
  });
  expect(store.calls).toEqual([]);
});

it('rate limits before policy or store access', async () => {
  vi.spyOn(deps.rateLimiter, 'take').mockReturnValue({ allowed: false, retryAfterMs: 1 });
  expect((await createHandler(deps)({ v: 1, auth, op: 'get', name: 'A' })).body).toEqual({
    v: 1,
    ok: false,
    code: 'RATE_LIMITED',
  });
  expect(store.calls).toEqual([]);
  expect(lastAudit()).toMatchObject({ sandboxId: 'canary-alpha', decision: 'deny', name: 'A' });
});

it('denies get by policy before accessing stored values', async () => {
  deps.policyConfig = { get: 'deny' };
  expect((await createHandler(deps)({ v: 1, auth, op: 'get', name: 'A' })).body).toEqual({
    v: 1,
    ok: false,
    code: 'DENIED',
  });
  expect(store.calls).toEqual([]);
  expect(lastAudit()).toMatchObject({ sandboxId: 'canary-alpha', decision: 'deny', name: 'A' });
});

it('lists only parsed metadata with shared winning duplicates and a lexical order', async () => {
  for (const path of [
    '/alpha/dev/SHARED_ONE',
    '/alpha/dev/agent/SHARED_ONE',
    '/alpha/dev/agent/AGENT_ONE',
    '/alpha/dev/agent',
    '/alpha/dev/bad/name',
    '/alpha/dev/awsBAD',
    '/beta/dev/OTHER',
  ])
    await store.put(path, 'canary-hidden', put);
  const handle = createHandler(deps);
  expect((await handle({ v: 1, auth, op: 'list' })).body).toEqual({
    v: 1,
    ok: true,
    names: [
      { name: 'AGENT_ONE', scope: 'agent' },
      { name: 'SHARED_ONE', scope: 'shared' },
    ],
  });
  expect((await handle({ v: 1, auth, op: 'list', prefix: 'SHARED' })).body).toEqual({
    v: 1,
    ok: true,
    names: [{ name: 'SHARED_ONE', scope: 'shared' }],
  });
});

it('resolves shared before agent and audits the returned version', async () => {
  await store.put('/alpha/dev/A', 'canary-shared', put);
  await store.put('/alpha/dev/agent/A', 'canary-agent', put);
  expect((await createHandler(deps)({ v: 1, auth, op: 'get', name: 'A' })).body).toEqual({
    v: 1,
    ok: true,
    value: 'canary-shared',
    version: 1,
    scope: 'shared',
  });
  expect(lastAudit()).toMatchObject({
    sandboxId: 'canary-alpha',
    decision: 'allow',
    name: 'A',
    version: 1,
  });
});

it('falls back to agent scope and emits one extra alert for a complete sweep', async () => {
  await store.put('/alpha/dev/agent/A', 'canary-agent', put);
  const handle = createHandler(deps);
  await handle({ v: 1, auth, op: 'list' });
  expect((await handle({ v: 1, auth, op: 'get', name: 'A' })).body).toEqual({
    v: 1,
    ok: true,
    value: 'canary-agent',
    version: 1,
    scope: 'agent',
  });
  expect(sink.readAll().map((line) => (JSON.parse(line) as { decision: string }).decision)).toEqual(
    ['allow', 'allow', 'alert'],
  );
});

it('returns NOT_FOUND and audits a deny in the registered keyspace', async () => {
  expect((await createHandler(deps)({ v: 1, auth, op: 'get', name: 'MISSING' })).body).toEqual({
    v: 1,
    ok: false,
    code: 'NOT_FOUND',
  });
  expect(lastAudit()).toMatchObject({
    sandboxId: 'canary-alpha',
    decision: 'deny',
    name: 'MISSING',
  });
});

it('sets only the registered agent path with SecureString and project key', async () => {
  const spy = vi.spyOn(store, 'put');
  expect(
    (await createHandler(deps)({ v: 1, auth, op: 'set', name: 'NEW', value: 'canary-input' })).body,
  ).toEqual({ v: 1, ok: true, version: 1, scope: 'agent' });
  expect(spy).toHaveBeenCalledWith('/alpha/dev/agent/NEW', 'canary-input', put);
  expect(lastAudit()).toMatchObject({ sandboxId: 'canary-alpha', decision: 'allow', version: 1 });
});

it.each(['UNAVAILABLE', 'ACCESS_DENIED', 'THROTTLED'] as const)(
  'sanitizes store %s and audits deny',
  async (kind) => {
    store.failNext(kind);
    expect(await createHandler(deps)({ v: 1, auth, op: 'list' })).toEqual({
      status: 503,
      body: { v: 1, ok: false, code: 'UNAVAILABLE' },
    });
    expect(lastAudit()).toMatchObject({ sandboxId: 'canary-alpha', decision: 'deny' });
  },
);

it('sanitizes unexpected store and registry exceptions', async () => {
  vi.spyOn(store, 'get').mockRejectedValue(new Error('canary-sensitive'));
  expect((await createHandler(deps)({ v: 1, auth, op: 'get', name: 'A' })).body).toEqual({
    v: 1,
    ok: false,
    code: 'UNAVAILABLE',
  });
  vi.spyOn(deps.registry, 'lookup').mockImplementation(() => {
    throw new Error('canary-sensitive');
  });
  expect((await createHandler(deps)({ v: 1, auth, op: 'list' })).body).toEqual({
    v: 1,
    ok: false,
    code: 'UNAVAILABLE',
  });
  expect(lastAudit()).toMatchObject({ sandboxId: 'unknown', decision: 'deny' });
});

it('denies malformed persisted identities including prod', async () => {
  vi.spyOn(deps.registry, 'lookup').mockReturnValue({
    sandboxId: 'canary-alpha',
    project: 'alpha',
    env: 'prod',
    createdAt: now().toISOString(),
  });
  expect((await createHandler(deps)({ v: 1, auth, op: 'list' })).body).toEqual({
    v: 1,
    ok: false,
    code: 'DENIED',
  });
  expect(lastAudit()).toMatchObject({ sandboxId: 'unknown', decision: 'alert' });
});

it('propagates only a fixed audit failure and never returns a value', async () => {
  await store.put('/alpha/dev/A', 'canary-hidden', put);
  vi.spyOn(sink, 'append').mockImplementation(() => {
    throw new Error('canary-sensitive');
  });
  await expect(createHandler(deps)({ v: 1, auth, op: 'get', name: 'A' })).rejects.toThrow(
    AuditChainBroken,
  );
  await expect(createHandler(deps)({ v: 1, auth, op: 'list' })).rejects.toThrow(
    'Audit chain is broken',
  );
});
