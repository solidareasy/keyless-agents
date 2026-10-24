import { validateEnv, validateProject } from '../core/names/names.js';
import type { RateLimitConfig } from '../core/rate-limit/token-bucket.js';
import { validateRateLimitConfig } from '../core/rate-limit/token-bucket.js';
import type { PolicyConfig } from '../core/policy/policy.js';

export type DaemonConfig = {
  awsRegion: string;
  auth: { issuerUrl: string; audience: string };
  projects: Array<{ project: string; env: string; roleArn: string; kmsKeyAlias: string }>;
  listen: string;
  operatorSocket: string;
  policy: PolicyConfig;
  rateLimit: RateLimitConfig;
  audit: { path: string };
  store?: 'memory';
};

type ConfigResult = { ok: true; config: DaemonConfig } | { ok: false; code: string };

function object(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function text(input: unknown): input is string {
  return typeof input === 'string' && input.trim().length > 0;
}

function hasCredentials(input: unknown): boolean {
  if (Array.isArray(input)) return input.some(hasCredentials);
  if (!object(input)) return false;
  return Object.entries(input).some(
    ([key, value]) =>
      ['accesskeyid', 'secretaccesskey', 'profile', 'awsprofile'].includes(key.toLowerCase()) ||
      hasCredentials(value),
  );
}

export function loadConfig(json: unknown): ConfigResult {
  const invalid = (field: string): ConfigResult => ({ ok: false, code: `INVALID_${field}` });
  if (!object(json)) return invalid('CONFIG');
  if (hasCredentials(json)) return { ok: false, code: 'CREDENTIAL_IN_CONFIG' };
  if (!text(json.awsRegion)) return invalid('AWS_REGION');
  if (!object(json.auth)) return invalid('AUTH');
  if (
    !text(json.auth.issuerUrl) ||
    !URL.canParse(json.auth.issuerUrl) ||
    !/^https?:\/\//.test(json.auth.issuerUrl)
  )
    return invalid('AUTH_ISSUER_URL');
  if (!text(json.auth.audience)) return invalid('AUTH_AUDIENCE');
  if (!Array.isArray(json.projects) || json.projects.length === 0) return invalid('PROJECTS');
  const keyspaces = new Set<string>();
  for (const entry of json.projects as unknown[]) {
    if (!object(entry) || !validateProject(entry.project).ok) return invalid('PROJECT');
    if (entry.env === 'prod') return { ok: false, code: 'PROD_FORBIDDEN' };
    if (!validateEnv(entry.env).ok) return invalid('ENV');
    if (!text(entry.roleArn)) return invalid('ROLE_ARN');
    if (!text(entry.kmsKeyAlias)) return invalid('KMS_KEY_ALIAS');
    const key = `${String(entry.project)}/${String(entry.env)}`;
    if (keyspaces.has(key)) return { ok: false, code: 'DUPLICATE_KEYSPACE' };
    keyspaces.add(key);
  }
  if (
    !text(json.listen) ||
    !/^(?:\[[0-9a-fA-F:]+\]|[^:\s/]+):\d{1,5}$/.test(json.listen) ||
    Number(json.listen.split(':').at(-1)) > 65535
  )
    return invalid('LISTEN');
  if (!text(json.operatorSocket)) return invalid('OPERATOR_SOCKET');
  if (!object(json.policy)) return invalid('POLICY');
  if (json.policy.get !== 'value' && json.policy.get !== 'deny') return invalid('POLICY_GET');
  if (!object(json.rateLimit)) return invalid('RATE_LIMIT');
  const { perMinute, burst } = json.rateLimit;
  if (typeof perMinute !== 'number' || !Number.isInteger(perMinute) || perMinute <= 0)
    return invalid('RATE_LIMIT_PER_MINUTE');
  if (typeof burst !== 'number' || !validateRateLimitConfig({ perMinute, burst }).ok)
    return invalid('RATE_LIMIT_BURST');
  if (!object(json.audit)) return invalid('AUDIT');
  if (!text(json.audit.path)) return invalid('AUDIT_PATH');
  if (json.store !== undefined && json.store !== 'memory') return invalid('STORE');
  return { ok: true, config: json as DaemonConfig };
}

export function configPath(): string {
  return process.env.KLAG_CONFIG ?? '/etc/klag/config.json';
}
