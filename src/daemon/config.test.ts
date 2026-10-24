import { afterEach, expect, it, vi } from 'vitest';
import { configPath, loadConfig } from './config.js';

export const exampleConfig = {
  awsRegion: 'canary-region',
  auth: { issuerUrl: 'https://issuer.example.invalid', audience: 'sts.amazonaws.com' },
  projects: [
    { project: 'alpha', env: 'dev', roleArn: 'canary-role', kmsKeyAlias: 'alias/alpha-dev' },
  ],
  listen: '127.0.0.1:7777',
  operatorSocket: '/tmp/klag/op.sock',
  policy: { get: 'value' },
  rateLimit: { perMinute: 60, burst: 10 },
  audit: { path: '/tmp/klag/audit.jsonl' },
  store: 'memory',
};

afterEach(() => vi.unstubAllEnvs());

it('loads the complete documented local configuration', () => {
  expect(loadConfig(exampleConfig)).toEqual({ ok: true, config: exampleConfig });
  const { store: _store, ...productionShape } = exampleConfig;
  expect(loadConfig(productionShape).ok).toBe(true);
});

it.each([
  ['awsRegion', 'AWS_REGION'],
  ['auth', 'AUTH'],
  ['auth.issuerUrl', 'AUTH_ISSUER_URL'],
  ['auth.audience', 'AUTH_AUDIENCE'],
  ['projects', 'PROJECTS'],
  ['projects.0.project', 'PROJECT'],
  ['projects.0.env', 'ENV'],
  ['projects.0.roleArn', 'ROLE_ARN'],
  ['projects.0.kmsKeyAlias', 'KMS_KEY_ALIAS'],
  ['listen', 'LISTEN'],
  ['operatorSocket', 'OPERATOR_SOCKET'],
  ['policy', 'POLICY'],
  ['policy.get', 'POLICY_GET'],
  ['rateLimit', 'RATE_LIMIT'],
  ['rateLimit.perMinute', 'RATE_LIMIT_PER_MINUTE'],
  ['rateLimit.burst', 'RATE_LIMIT_BURST'],
  ['audit', 'AUDIT'],
  ['audit.path', 'AUDIT_PATH'],
])('rejects missing %s with its own code', (path, field) => {
  const input = structuredClone(exampleConfig);
  const parts = path.split('.');
  let target = input as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) target = target[part] as Record<string, unknown>;
  delete target[parts.at(-1)!];
  expect(loadConfig(input)).toEqual({ ok: false, code: `INVALID_${field}` });
});

it.each(['accessKeyId', 'secretAccessKey', 'profile', 'awsProfile'])(
  'rejects credential key %s recursively without exposing its contents',
  (key) => {
    expect(loadConfig({ ...exampleConfig, [key]: 'canary-credential' })).toEqual({
      ok: false,
      code: 'CREDENTIAL_IN_CONFIG',
    });
    expect(
      loadConfig({ ...exampleConfig, auth: { ...exampleConfig.auth, [key]: 'canary-credential' } }),
    ).toEqual({ ok: false, code: 'CREDENTIAL_IN_CONFIG' });
    expect(
      loadConfig({
        ...exampleConfig,
        projects: [{ ...exampleConfig.projects[0], [key]: 'canary-credential' }],
      }),
    ).toEqual({ ok: false, code: 'CREDENTIAL_IN_CONFIG' });
  },
);

it('refuses prod, invalid fields, duplicate projects and invalid store', () => {
  expect(
    loadConfig({ ...exampleConfig, projects: [{ ...exampleConfig.projects[0], env: 'prod' }] }),
  ).toEqual({ ok: false, code: 'PROD_FORBIDDEN' });
  for (const input of [null, [], 'canary', 1])
    expect(loadConfig(input)).toEqual({ ok: false, code: 'INVALID_CONFIG' });
  expect(loadConfig({ ...exampleConfig, projects: [] })).toEqual({
    ok: false,
    code: 'INVALID_PROJECTS',
  });
  expect(loadConfig({ ...exampleConfig, projects: [null] })).toEqual({
    ok: false,
    code: 'INVALID_PROJECT',
  });
  expect(
    loadConfig({
      ...exampleConfig,
      projects: [exampleConfig.projects[0], exampleConfig.projects[0]],
    }),
  ).toEqual({ ok: false, code: 'DUPLICATE_KEYSPACE' });
  expect(loadConfig({ ...exampleConfig, store: 'aws' })).toEqual({
    ok: false,
    code: 'INVALID_STORE',
  });
});

it.each([
  ['awsRegion', ''],
  ['listen', 'bad'],
  ['operatorSocket', 1],
  ['auth.issuerUrl', 'not-url'],
  ['auth.audience', ''],
  ['projects.0.project', 'a/..'],
  ['projects.0.env', 'a/..'],
  ['projects.0.roleArn', ''],
  ['projects.0.kmsKeyAlias', ''],
  ['policy.get', 'invalid'],
  ['rateLimit.perMinute', 0],
  ['rateLimit.burst', -1],
  ['audit.path', ''],
])('rejects invalid %s', (path, value) => {
  const input = structuredClone(exampleConfig);
  const parts = path.split('.');
  let target = input as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) target = target[part] as Record<string, unknown>;
  target[parts.at(-1)!] = value;
  expect(loadConfig(input).ok).toBe(false);
});

it('reads only KLAG_CONFIG with the documented default', () => {
  vi.stubEnv('KLAG_CONFIG', undefined);
  expect(configPath()).toBe('/etc/klag/config.json');
  vi.stubEnv('KLAG_CONFIG', '/tmp/canary-config.json');
  expect(configPath()).toBe('/tmp/canary-config.json');
});
