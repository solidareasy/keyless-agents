import { describe, expect, it } from 'vitest';
import { keyspacePrefix, parameterPath, parseParameterPath } from './keyspace.js';
import type { Keyspace } from './keyspace.js';
import type { Env, Name, Project } from './names.js';

const ks: Keyspace = { project: 'app' as Project, env: 'dev' as Env };

describe('keyspace paths', () => {
  it('builds a prefix ending in a slash', () => {
    expect(keyspacePrefix(ks)).toBe('/app/dev/');
  });

  it('builds shared and agent parameter paths', () => {
    expect(parameterPath(ks, 'shared', 'DATABASE_URL' as Name)).toBe('/app/dev/DATABASE_URL');
    expect(parameterPath(ks, 'agent', 'API_TOKEN' as Name)).toBe('/app/dev/agent/API_TOKEN');
  });

  it.each([
    ['/app/dev/DATABASE_URL', 'shared', 'DATABASE_URL'],
    ['/app/dev/agent/API_TOKEN', 'agent', 'API_TOKEN'],
    ['/app/dev/a..b', 'shared', 'a..b'],
    ['/app/dev/agent/agent', 'agent', 'agent'],
  ])('parses a valid path %#', (path, scope, name) => {
    expect(parseParameterPath(ks, path)).toEqual({ ok: true, scope, name });
  });

  it('rejects the shared agent path instead of round-tripping it', () => {
    const path = parameterPath(ks, 'shared', 'agent' as Name);
    expect(path).toBe('/app/dev/agent');
    expect(parseParameterPath(ks, path)).toEqual({ ok: false, code: 'BAD_DEPTH' });
  });

  it.each([
    '',
    'app/dev/canary-name',
    '/app-two/dev/canary-name',
    '/other/dev/canary-name',
    '/app/staging/canary-name',
    '/app/dev-two/canary-name',
    '/app/prod/canary-name',
    '/app/dev',
    '//app/dev/canary-name',
  ])('rejects a path outside the exact keyspace %#', (path) => {
    expect(parseParameterPath(ks, path)).toEqual({ ok: false, code: 'OUTSIDE_KEYSPACE' });
  });

  it.each([
    '/app/dev/a/b/c',
    '/app/dev/a/b',
    '/app/dev/agent/a/b',
    '/app/dev//canary-name',
    '/app/dev/agent//canary-name',
    '/app/dev/agent/canary-name/',
    `/app/dev/${Array<string>(14).fill('a').join('/')}`,
    `/app/dev/${Array<string>(15).fill('a').join('/')}`,
  ])('rejects wrong depth including empty and 16+ segments %#', (path) => {
    expect(parseParameterPath(ks, path)).toEqual({ ok: false, code: 'BAD_DEPTH' });
  });

  it.each([
    '/app/dev/',
    '/app/dev/agent/',
    '/app/dev/.',
    '/app/dev/..',
    '/app/dev/*',
    '/app/dev/canary name',
    '/app/dev/canary-name\n',
    '/app/dev/а',
    '/app/dev/\u0000',
    '/app/dev/AWS_REGION',
    '/app/dev/agent/SsmX',
    `/app/dev/${'a'.repeat(129)}`,
  ])('rejects an invalid name %#', (path) => {
    expect(parseParameterPath(ks, path)).toEqual({ ok: false, code: 'BAD_NAME' });
  });
});
