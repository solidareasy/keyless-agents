import fc from 'fast-check';
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

const segment = (maxLength: number) =>
  fc
    .tuple(
      fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'),
      fc.array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'), {
        minLength: 1,
        maxLength: maxLength - 1,
      }),
    )
    .map(([first, rest]) => first + rest.join(''));
const project = segment(32).map((input) => input as Project);
const env = segment(16)
  .filter((input) => input !== 'prod')
  .map((input) => input as Env);
const keyspace = fc.record({ project, env });
const scope = fc.constantFrom('shared' as const, 'agent' as const);
const name = fc
  .array(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.-'), {
    minLength: 1,
    maxLength: 128,
  })
  .map((characters) => characters.join(''))
  .filter((input) => input !== '.' && input !== '..' && !/^(aws|ssm)/i.test(input))
  .map((input) => input as Name);

describe('keyspace properties', () => {
  it('round-trips names in both scopes except the reserved shared agent path', () => {
    fc.assert(
      fc.property(keyspace, scope, name, (ks, scope, name) => {
        // EXT-774 advisor decision: /project/env/agent fails closed with BAD_DEPTH.
        fc.pre(scope !== 'shared' || name !== 'agent');
        expect(parseParameterPath(ks, parameterPath(ks, scope, name))).toEqual({
          ok: true,
          scope,
          name,
        });
      }),
      { numRuns: 500 },
    );
  });

  it('rejects paths from any distinct generated project', () => {
    fc.assert(
      fc.property(
        fc.tuple(project, project).filter(([first, second]) => first !== second),
        env,
        scope,
        name,
        ([first, second], env, scope, name) => {
          expect(
            parseParameterPath(
              { project: first, env },
              parameterPath({ project: second, env }, scope, name),
            ),
          ).toEqual({ ok: false, code: 'OUTSIDE_KEYSPACE' });
        },
      ),
      { numRuns: 500 },
    );
  });

  it('isolates projects even when either is a prefix of the other', () => {
    fc.assert(
      fc.property(segment(28), env, scope, name, (input, env, scope, name) => {
        const first = { project: input as Project, env };
        const second = { project: `${input}-two` as Project, env };
        expect(parseParameterPath(first, parameterPath(second, scope, name))).toEqual({
          ok: false,
          code: 'OUTSIDE_KEYSPACE',
        });
        expect(parseParameterPath(second, parameterPath(first, scope, name))).toEqual({
          ok: false,
          code: 'OUTSIDE_KEYSPACE',
        });
      }),
      { numRuns: 500 },
    );
  });

  it('isolates distinct environments in the same project', () => {
    fc.assert(
      fc.property(
        project,
        fc.tuple(env, env).filter(([first, second]) => first !== second),
        scope,
        name,
        (project, [first, second], scope, name) => {
          expect(
            parseParameterPath(
              { project, env: first },
              parameterPath({ project, env: second }, scope, name),
            ),
          ).toEqual({ ok: false, code: 'OUTSIDE_KEYSPACE' });
        },
      ),
      { numRuns: 500 },
    );
  });

  it('rejects every generated depth of 16 or more segments', () => {
    fc.assert(
      fc.property(keyspace, fc.integer({ min: 16, max: 64 }), (ks, depth) => {
        const path =
          keyspacePrefix(ks) +
          Array<string>(depth - 2)
            .fill('a')
            .join('/');
        expect(parseParameterPath(ks, path)).toEqual({ ok: false, code: 'BAD_DEPTH' });
      }),
      { numRuns: 500 },
    );
  });
});
