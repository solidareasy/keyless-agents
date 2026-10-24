import { describe, expect, it } from 'vitest';
import { ENV_RE, NAME_RE, PROJECT_RE, validateEnv, validateName, validateProject } from './names.js';

describe('validateName', () => {
  it('exports the exact interface regex', () => {
    expect(NAME_RE.source).toBe('^(?!\\.{1,2}$)[A-Za-z0-9_.-]{1,128}$');
    expect(NAME_RE.flags).toBe('');
  });

  it.each(['DATABASE_URL', 'API_TOKEN', 'a..b', 'agent', 'A', '_', '-', 'a'.repeat(128)])(
    'accepts an unchanged valid name %#',
    (name) => {
      expect(validateName(name)).toEqual({ ok: true, name });
    },
  );

  it.each([
    [undefined, 'NOT_A_STRING'],
    [null, 'NOT_A_STRING'],
    [42, 'NOT_A_STRING'],
    [{}, 'NOT_A_STRING'],
    ['', 'EMPTY'],
    ['a'.repeat(129), 'TOO_LONG'],
    ['.', 'DOT_SEGMENT'],
    ['..', 'DOT_SEGMENT'],
    ['a/b', 'INVALID_CHAR'],
    ['*', 'INVALID_CHAR'],
    [' ', 'INVALID_CHAR'],
    [' canary-name ', 'INVALID_CHAR'],
    ['a\n', 'INVALID_CHAR'],
    ['a\r', 'INVALID_CHAR'],
    ['a\t', 'INVALID_CHAR'],
    ['а', 'INVALID_CHAR'],
    ['é', 'INVALID_CHAR'],
    ['e\u0301', 'INVALID_CHAR'],
    ['\u0000', 'INVALID_CHAR'],
    ['AWS_REGION', 'RESERVED_PREFIX'],
    ['SsmX', 'RESERVED_PREFIX'],
    ['aws', 'RESERVED_PREFIX'],
    ['ssm', 'RESERVED_PREFIX'],
  ])('rejects invalid input %# with its specific code', (input, code) => {
    expect(validateName(input)).toEqual({ ok: false, code });
  });
});

describe('validateProject', () => {
  it('exports the exact project regex', () => {
    expect(PROJECT_RE.source).toBe('^[a-z][a-z0-9-]{1,31}$');
    expect(PROJECT_RE.flags).toBe('');
  });

  it.each(['app', 'app-two', 'ab', 'a'.repeat(32)])('accepts a project %#', (project) => {
    expect(validateProject(project)).toEqual({ ok: true, project });
  });

  it.each([
    [null, 'NOT_A_STRING'],
    ['', 'EMPTY'],
    ['a'.repeat(33), 'TOO_LONG'],
    ['a', 'INVALID_CHAR'],
    ['app;other', 'INVALID_CHAR'],
    ['app two', 'INVALID_CHAR'],
    ['App', 'INVALID_CHAR'],
    ['1app', 'INVALID_CHAR'],
    ['app\n', 'INVALID_CHAR'],
    ['a_b', 'INVALID_CHAR'],
  ])('rejects an invalid project %# with its specific code', (input, code) => {
    expect(validateProject(input)).toEqual({ ok: false, code });
  });
});

describe('validateEnv', () => {
  it('exports the exact environment regex', () => {
    expect(ENV_RE.source).toBe('^[a-z][a-z0-9-]{1,15}$');
    expect(ENV_RE.flags).toBe('');
  });

  it.each(['dev', 'staging', 'ab', 'a'.repeat(16), 'prod-two'])(
    'accepts an environment %#',
    (env) => {
      expect(validateEnv(env)).toEqual({ ok: true, env });
    },
  );

  it.each([
    [undefined, 'NOT_A_STRING'],
    ['', 'EMPTY'],
    ['a'.repeat(17), 'TOO_LONG'],
    ['a', 'INVALID_CHAR'],
    ['dev;other', 'INVALID_CHAR'],
    ['dev two', 'INVALID_CHAR'],
    ['Dev', 'INVALID_CHAR'],
    ['1dev', 'INVALID_CHAR'],
    ['dev\n', 'INVALID_CHAR'],
    ['dev/agent', 'INVALID_CHAR'],
    ['prod', 'RESERVED_ENV'],
  ])('rejects an invalid environment %# with its specific code', (input, code) => {
    expect(validateEnv(input)).toEqual({ ok: false, code });
  });
});
