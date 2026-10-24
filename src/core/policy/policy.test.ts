import { describe, expect, it } from 'vitest';
import type { Keyspace } from '../names/keyspace.js';
import type { Env, Project } from '../names/names.js';
import { decide, resolveGet } from './policy.js';
import type { Actor, Decision, Operation, PolicyConfig, Subject } from './policy.js';

const keyspace: Keyspace = { project: 'canary-app' as Project, env: 'dev' as Env };
const agent: Subject = { kind: 'agent', sandboxId: 'canary-sandbox', keyspace };
const operator: Subject = { kind: 'operator', keyspace };

describe('decide', () => {
  const cases: Array<[Actor, Operation, PolicyConfig['get'], Decision]> = [
    ['agent', 'list', 'value', { kind: 'allow', audit: 'allow' }],
    ['agent', 'list', 'deny', { kind: 'allow', audit: 'allow' }],
    ['agent', 'get', 'value', { kind: 'allow', audit: 'allow' }],
    ['agent', 'get', 'deny', { kind: 'deny', code: 'DENIED', audit: 'deny' }],
    ['agent', 'set', 'value', { kind: 'allow', audit: 'allow', writeScope: 'agent' }],
    ['agent', 'set', 'deny', { kind: 'allow', audit: 'allow', writeScope: 'agent' }],
    ['agent', 'promote', 'value', { kind: 'deny', code: 'DENIED', audit: 'deny' }],
    ['agent', 'promote', 'deny', { kind: 'deny', code: 'DENIED', audit: 'deny' }],
    ['agent', 'delete', 'value', { kind: 'deny', code: 'DENIED', audit: 'deny' }],
    ['agent', 'delete', 'deny', { kind: 'deny', code: 'DENIED', audit: 'deny' }],
    ['operator', 'list', 'value', { kind: 'allow', audit: 'allow' }],
    ['operator', 'list', 'deny', { kind: 'allow', audit: 'allow' }],
    ['operator', 'get', 'value', { kind: 'allow', audit: 'allow' }],
    ['operator', 'get', 'deny', { kind: 'allow', audit: 'allow' }],
    ['operator', 'set', 'value', { kind: 'allow', audit: 'allow' }],
    ['operator', 'set', 'deny', { kind: 'allow', audit: 'allow' }],
    ['operator', 'promote', 'value', { kind: 'allow', audit: 'allow' }],
    ['operator', 'promote', 'deny', { kind: 'allow', audit: 'allow' }],
    ['operator', 'delete', 'value', { kind: 'allow', audit: 'allow' }],
    ['operator', 'delete', 'deny', { kind: 'allow', audit: 'allow' }],
  ];

  it.each(cases)('%s %s with policy.get=%s', (actor, op, get, expected) => {
    expect(
      decide(
        { subject: actor === 'agent' ? agent : operator, op, hasForeignKeyspaceFields: false },
        { get },
      ),
    ).toEqual(expected);
  });

  it.each([agent, operator, null])(
    'rejects foreign keyspace fields before identity and permissions %#',
    (subject) => {
      expect(
        decide({ subject, op: 'list', hasForeignKeyspaceFields: true }, { get: 'value' }),
      ).toEqual({ kind: 'deny', code: 'INVALID', audit: 'alert' });
    },
  );

  it('denies an absent subject before the operation table', () => {
    expect(
      decide({ subject: null, op: 'list', hasForeignKeyspaceFields: false }, { get: 'value' }),
    ).toEqual({ kind: 'deny', code: 'DENIED', audit: 'alert' });
  });
});

describe('resolveGet', () => {
  it.each([
    [null, null, null],
    ['canary-shared', null, { scope: 'shared', value: 'canary-shared' }],
    [null, 'canary-agent', { scope: 'agent', value: 'canary-agent' }],
    ['canary-shared', 'canary-agent', { scope: 'shared', value: 'canary-shared' }],
  ])('resolves presence combination %#', (shared, agent, expected) => {
    expect(resolveGet(shared, agent)).toEqual(expected);
  });

  it.each(['', 0, false, undefined])('preserves a present falsy entry %#', (value) => {
    expect(resolveGet<unknown>(value, 'canary-agent')).toEqual({ scope: 'shared', value });
    expect(resolveGet<unknown>(null, value)).toEqual({ scope: 'agent', value });
  });
});
