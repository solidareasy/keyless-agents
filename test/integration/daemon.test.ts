import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { daemonFixture, post, putOptions, type DaemonFixture } from '../support/daemon.js';

describe('daemon HTTP integration', { concurrent: false }, () => {
  let f: DaemonFixture;
  beforeAll(async () => {
    f = await daemonFixture();
    for (const [path, value] of [
      ['/alpha/dev/SHARED_ONE', 'canary-shared'],
      ['/alpha/dev/agent/AGENT_ONE', 'canary-agent'],
      ['/alpha/dev/agent/SHARED_ONE', 'canary-shadow'],
      ['/beta/dev/OTHER', 'canary-beta'],
    ])
      await f.store.put(path!, value!, putOptions);
  });
  beforeEach(() => {
    f.rateLimiter.forget('canary-alpha');
    f.rateLimiter.forget('canary-beta');
  });
  afterAll(async () => {
    try {
      expect(f.audit.verify()).toMatchObject({ ok: true, count: 26 });
      expect(f.sink.readAll()).toHaveLength(26);
    } finally {
      await f.close();
    }
  });
  const request = (op: string, fields = {}, auth?: string) =>
    post(f.url, { v: 1, auth: auth ?? f.alpha, op, ...fields });
  const audit = (decision: string, sandboxId: string, name: string | null) => {
    expect(JSON.parse(f.sink.readAll().at(-1)!)).toMatchObject({ decision, sandboxId, name });
  };

  it('list returns only alpha names and scopes, shared wins, in K3 lexical order', async () => {
    expect((await request('list')).body).toEqual({
      v: 1,
      ok: true,
      names: [
        { name: 'AGENT_ONE', scope: 'agent' },
        { name: 'SHARED_ONE', scope: 'shared' },
      ],
    });
    audit('allow', 'canary-alpha', null);
  });
  it('get SHARED_ONE returns shared and never the agent shadow (M2)', async () => {
    expect((await request('get', { name: 'SHARED_ONE' })).body).toEqual({
      v: 1,
      ok: true,
      value: 'canary-shared',
      version: 1,
      scope: 'shared',
    });
    audit('allow', 'canary-alpha', 'SHARED_ONE');
  });
  it('set NEW forces the alpha agent path, SecureString and alpha keyId', async () => {
    const put = vi.spyOn(f.store, 'put');
    expect((await request('set', { name: 'NEW', value: 'canary-new' })).body).toEqual({
      v: 1,
      ok: true,
      version: 1,
      scope: 'agent',
    });
    expect(put).toHaveBeenCalledWith('/alpha/dev/agent/NEW', 'canary-new', putOptions);
    put.mockRestore();
    audit('allow', 'canary-alpha', 'NEW');
  });
  it('beta never reads alpha and receives NOT_FOUND rather than DENIED', async () => {
    expect(await request('get', { name: 'SHARED_ONE' }, f.beta)).toMatchObject({
      status: 404,
      body: { v: 1, ok: false, code: 'NOT_FOUND' },
    });
    audit('deny', 'canary-beta', 'SHARED_ONE');
  });
  it('an unreplaced placeholder is DENIED with an unknown-sandbox alert', async () => {
    expect(await request('list', {}, '__KLAG_AUTH__')).toMatchObject({
      status: 403,
      body: { v: 1, ok: false, code: 'DENIED' },
    });
    audit('alert', 'unknown', null);
  });
  it('a foreign project field is INVALID with an unknown-sandbox alert', async () => {
    expect(await request('get', { name: 'SHARED_ONE', project: 'beta' })).toMatchObject({
      status: 400,
      body: { v: 1, ok: false, code: 'INVALID' },
    });
    audit('alert', 'unknown', null);
  });
  it('the eleventh burst request is RATE_LIMITED with a sandbox deny', async () => {
    for (let i = 0; i < 10; i++) expect((await request('list')).status).toBe(200);
    expect(await request('list')).toMatchObject({
      status: 429,
      body: { v: 1, ok: false, code: 'RATE_LIMITED' },
    });
    audit('deny', 'canary-alpha', null);
  });
  it('revoke makes the next beta request DENIED with an unknown-sandbox alert', async () => {
    expect(f.registry.revoke('canary-beta')).toEqual({ ok: true });
    expect((await request('list', {}, f.beta)).body).toEqual({ v: 1, ok: false, code: 'DENIED' });
    audit('alert', 'unknown', null);
  });
  it('a list followed by get of every name appends exactly one extra sweep alert', async () => {
    const before = f.sink.readAll().length;
    await request('list');
    for (const name of ['AGENT_ONE', 'NEW', 'SHARED_ONE']) await request('get', { name });
    const lines = f.sink
      .readAll()
      .slice(before)
      .map((line) => JSON.parse(line) as { decision: string });
    expect(lines.map(({ decision }) => decision)).toEqual([
      'allow',
      'allow',
      'allow',
      'allow',
      'alert',
    ]);
    audit('alert', 'canary-alpha', 'SHARED_ONE');
  });
  it('query-string authentication is INVALID without entering the handler', async () => {
    const before = f.sink.readAll().length;
    expect((await post(f.url + '/?auth=canary', '{}')).status).toBe(400);
    expect(f.sink.readAll()).toHaveLength(before);
  });
  it('a 65 KiB value in valid JSON is INVALID without store writes or audit entries', async () => {
    const before = f.sink.readAll().length;
    const put = vi.spyOn(f.store, 'put');
    try {
      expect(
        await request('set', { name: 'OVERSIZED', value: 'a'.repeat(65 * 1024) }),
      ).toMatchObject({
        status: 400,
        body: { v: 1, ok: false, code: 'INVALID' },
      });
      expect(put).not.toHaveBeenCalled();
      expect(f.sink.readAll()).toHaveLength(before);
    } finally {
      put.mockRestore();
    }
  });
  it('failNext UNAVAILABLE returns HTTP 503 and audits a sandbox deny', async () => {
    f.store.failNext('UNAVAILABLE');
    expect(await request('list')).toMatchObject({
      status: 503,
      body: { v: 1, ok: false, code: 'UNAVAILABLE' },
    });
    audit('deny', 'canary-alpha', null);
  });
  it('the x-klag-auth header overrides an unreplaced placeholder in the body', async () => {
    expect(
      (await post(f.url, { v: 1, auth: '__KLAG_AUTH__', op: 'list' }, { 'x-klag-auth': f.alpha }))
        .status,
    ).toBe(200);
    audit('allow', 'canary-alpha', null);
  });
  it('an invalid name is INVALID with a known-sandbox deny and no raw name in audit', async () => {
    expect((await request('get', { name: '../' })).body).toEqual({
      v: 1,
      ok: false,
      code: 'INVALID',
    });
    audit('deny', 'canary-alpha', null);
  });
});
