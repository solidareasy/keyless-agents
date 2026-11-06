import { afterEach, expect, it, vi } from 'vitest';
import { loadCliConfig } from './config.js';
afterEach(() => vi.unstubAllEnvs());
it('requires a plain HTTP KLAG_URL and uses the provisional placeholder', () => {
  vi.stubEnv('KLAG_URL', undefined);
  expect(loadCliConfig()).toEqual({ ok: false, code: 'UNAVAILABLE' });
  for (const url of [
    'bad',
    'https://example.invalid',
    'http://user:canary@example.invalid',
    'http://example.invalid/?auth=canary',
    'http://example.invalid/#canary',
  ]) {
    vi.stubEnv('KLAG_URL', url);
    expect(loadCliConfig()).toEqual({ ok: false, code: 'UNAVAILABLE' });
  }
  vi.stubEnv('KLAG_URL', 'http://127.0.0.1:7777');
  vi.stubEnv('KLAG_AUTH', undefined);
  expect(loadCliConfig()).toEqual({
    ok: true,
    config: { url: 'http://127.0.0.1:7777', auth: '__KLAG_AUTH__' },
  });
  vi.stubEnv('KLAG_AUTH', 'canary-placeholder');
  expect(loadCliConfig()).toEqual({
    ok: true,
    config: { url: 'http://127.0.0.1:7777', auth: 'canary-placeholder' },
  });
});
