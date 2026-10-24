import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Keyspace } from '../names/keyspace.js';
import type { Env, Name, Project } from '../names/names.js';
import { decide, listView, resolveGet, writePath } from './policy.js';
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

  it('always selects shared when both entries are non-null', () => {
    const present = fc.anything().filter((entry) => entry !== null);
    fc.assert(
      fc.property(present, present, (shared, agent) => {
        const resolved = resolveGet(shared, agent);
        expect(resolved?.scope).toBe('shared');
        expect(resolved?.value).toBe(shared);
      }),
      { numRuns: 500 },
    );
  });
});

describe('listView', () => {
  it('returns an empty list for no entries', () => {
    expect(listView([])).toEqual([]);
  });

  it('projects names and scopes, sorting names and shared before agent without mutating input', () => {
    const entries = Object.freeze([
      Object.freeze({
        name: 'canary-z' as Name,
        scope: 'agent' as const,
        version: 3,
        value: 'canary-hidden',
      }),
      Object.freeze({ name: 'canary-a' as Name, scope: 'agent' as const, version: 2 }),
      Object.freeze({
        name: 'canary-a' as Name,
        scope: 'shared' as const,
        version: 1,
        value: 'canary-hidden',
      }),
      Object.freeze({ name: 'canary-z' as Name, scope: 'agent' as const, version: 4 }),
      Object.freeze({ name: 'canary-z' as Name, scope: 'shared' as const, version: 5 }),
    ]);
    expect(listView(entries)).toEqual([
      { name: 'canary-a', scope: 'shared' },
      { name: 'canary-a', scope: 'agent' },
      { name: 'canary-z', scope: 'shared' },
      { name: 'canary-z', scope: 'agent' },
      { name: 'canary-z', scope: 'agent' },
    ]);
    expect(entries[0]?.name).toBe('canary-z');
  });
});

describe('writePath', () => {
  const name = 'canary-name' as Name;

  it('forces agent scope when an agent explicitly requests shared', () => {
    expect(writePath(agent, name, 'shared')).toBe('/canary-app/dev/agent/canary-name');
  });

  it('defaults agents to agent scope', () => {
    expect(writePath(agent, name)).toBe('/canary-app/dev/agent/canary-name');
  });

  it('defaults operators to shared scope', () => {
    expect(writePath(operator, name)).toBe('/canary-app/dev/canary-name');
  });

  it('uses the scope requested by an operator', () => {
    expect(writePath(operator, name, 'agent')).toBe('/canary-app/dev/agent/canary-name');
    expect(writePath(operator, name, 'shared')).toBe('/canary-app/dev/canary-name');
  });
});
