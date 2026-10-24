import { beforeEach, expect, expectTypeOf, it, vi } from 'vitest';
import { Registry, type RegistryStore, type SandboxEntry, type StoredEntry } from './registry.js';
import * as tokens from './token.js';

const canary = 'canary-registry-token';
const now = () => new Date('2026-01-01T00:00:00.000Z');
const entry = {
  sandboxId: 'canary-sandbox',
  project: 'canary-project',
  env: 'dev',
  createdAt: '2026-01-01T00:00:00.000Z',
};
let entries: StoredEntry[];
let store: RegistryStore;
let registry: Registry;

beforeEach(() => {
  vi.restoreAllMocks();
  entries = [];
  store = {
    load: () => structuredClone(entries),
    save: (next) => {
      entries = structuredClone(next);
    },
  };
  registry = new Registry(store, now, () => canary);
});

it('adds, looks up, lists and revokes without persisting the token', () => {
  expect(registry.add('canary-sandbox', 'canary-project', 'dev')).toEqual({
    ok: true,
    token: canary,
    entry,
  });
  expect(registry.lookup(canary)).toEqual(entry);
  expect(registry.list()).toEqual([entry]);
  expect(Object.keys(registry.list()[0] ?? {}).sort()).toEqual([
    'createdAt',
    'env',
    'project',
    'sandboxId',
  ]);
  expectTypeOf<ReturnType<Registry['list']>>().toEqualTypeOf<SandboxEntry[]>();
  expectTypeOf<keyof SandboxEntry>().toEqualTypeOf<'sandboxId' | 'project' | 'env' | 'createdAt'>();
  expect(JSON.stringify(store.load())).not.toContain(canary);
  expect(JSON.stringify(registry.list())).not.toContain(canary);
  expect(JSON.stringify(registry)).not.toContain(canary);
  expect(entries[0]?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  expect(Object.keys(entries[0] ?? {}).sort()).toEqual([
    'createdAt',
    'env',
    'project',
    'sandboxId',
    'tokenHash',
  ]);
  expect(registry.revoke('canary-sandbox')).toEqual({ ok: true });
  expect(registry.lookup(canary)).toBeNull();
  expect(registry.list()).toEqual([]);
  expect(registry.revoke('canary-sandbox')).toEqual({ ok: false, code: 'NOT_FOUND' });
});

it.each(['canary-unknown', '__KLAG_TOKEN__', ''])(
  'denies unknown or unreplaced credentials %#',
  (token) => {
    registry.add('canary-sandbox', 'canary-project', 'dev');
    expect(registry.lookup(token)).toBeNull();
  },
);

it('rejects duplicate sandboxes without generating another token or saving', () => {
  const random = vi.fn(() => canary);
  const save = vi.spyOn(store, 'save');
  registry = new Registry(store, now, random);
  registry.add('canary-sandbox', 'canary-project', 'dev');
  expect(registry.add('canary-sandbox', 'canary-project', 'dev')).toEqual({
    ok: false,
    code: 'DUPLICATE_SANDBOX',
  });
  expect(random).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledTimes(1);
});

it.each([
  ['', 'canary-project', 'dev', 'BAD_SANDBOX_ID'],
  ['a'.repeat(65), 'canary-project', 'dev', 'BAD_SANDBOX_ID'],
  ['canary/other', 'canary-project', 'dev', 'BAD_SANDBOX_ID'],
  ['canary\n', 'canary-project', 'dev', 'BAD_SANDBOX_ID'],
  ['canary', 'a', 'dev', 'BAD_PROJECT'],
  ['canary', 'canary project', 'dev', 'BAD_PROJECT'],
  ['canary', 'canary-project', 'a', 'BAD_ENV'],
  ['canary', 'canary-project', 'dev/other', 'BAD_ENV'],
  ['canary', 'canary-project', 'prod', 'PROD_FORBIDDEN'],
])('returns validation code without saving %#', (sandbox, project, env, code) => {
  expect(registry.add(sandbox, project, env)).toEqual({ ok: false, code });
  expect(store.load()).toEqual([]);
});

it('accepts boundary sandbox IDs and the default secure generator', () => {
  const normal = new Registry(store, now);
  for (const sandboxId of ['A', 'A_.-0', 'a'.repeat(64)]) {
    const result = normal.add(sandboxId, 'ab', 'ab');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.token).toMatch(/^klag_[A-Za-z0-9_-]{43}$/);
      expect(normal.lookup(result.token)?.sandboxId).toBe(sandboxId);
    }
  }
});

it('compares every stored hash even after an early match', () => {
  entries = [0, 1, 2].map((index) => ({
    ...entry,
    sandboxId: `canary-${index}`,
    tokenHash: tokens.hashToken(index === 0 ? canary : `canary-other-${index}`),
  }));
  const compare = vi.spyOn(tokens, 'tokensEqual');
  expect(registry.lookup(canary)?.sandboxId).toBe('canary-0');
  expect(compare).toHaveBeenCalledTimes(3);
  compare.mockClear();
  expect(registry.lookup('canary-unknown')).toBeNull();
  expect(compare).toHaveBeenCalledTimes(3);
});

it('denies ambiguous duplicate hash matches after comparing all entries', () => {
  entries = [0, 1].map((index) => ({
    ...entry,
    sandboxId: `canary-${index}`,
    tokenHash: tokens.hashToken(canary),
  }));
  const compare = vi.spyOn(tokens, 'tokensEqual');
  expect(registry.lookup(canary)).toBeNull();
  expect(compare).toHaveBeenCalledTimes(2);
});

it('does not expose mutable internal entry references', () => {
  const result = registry.add('canary-sandbox', 'canary-project', 'dev');
  if (!result.ok) throw new Error('Expected successful registration');
  result.entry.project = 'canary-changed';
  const listed = registry.list();
  listed[0]!.env = 'prod';
  expect(registry.lookup(canary)).toEqual(entry);
});

function expectSanitized(operation: () => unknown): void {
  let caught: unknown;
  try {
    operation();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  for (const output of [String(caught), JSON.stringify(caught), (caught as Error).stack]) {
    expect(output).not.toContain(canary);
  }
  expect((caught as Error).message).toBe('Registry operation failed');
  expect((caught as Error).cause).toBeUndefined();
}

it('sanitizes store load errors in every public operation', () => {
  store.load = () => {
    throw new Error(canary);
  };
  for (const operation of [
    () => registry.add('canary-sandbox', 'canary-project', 'dev'),
    () => registry.lookup(canary),
    () => registry.list(),
    () => registry.revoke('canary-sandbox'),
  ])
    expectSanitized(operation);
});

it('sanitizes save, random and clock failures', () => {
  store.save = () => {
    throw new Error(canary);
  };
  expectSanitized(() => registry.add('canary-sandbox', 'canary-project', 'dev'));
  entries = [{ ...entry, tokenHash: tokens.hashToken(canary) }];
  expectSanitized(() => registry.revoke('canary-sandbox'));
  entries = [];
  const fail = (): never => {
    throw new Error(canary);
  };
  expectSanitized(() =>
    new Registry(store, now, fail).add('canary-sandbox', 'canary-project', 'dev'),
  );
  expectSanitized(() =>
    new Registry(store, fail, () => canary).add('canary-sandbox', 'canary-project', 'dev'),
  );
});

it('keeps the plaintext canary out of persisted JSON independently of lookup', () => {
  registry.add('canary-sandbox', 'canary-project', 'dev');
  expect(JSON.stringify(store.load())).not.toContain(canary);
  expect(JSON.stringify(registry.list())).not.toContain(canary);
  expect(store.load()[0]?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
});

it('denies a stored hash with a non-hex suffix', () => {
  entries = [{ ...entry, tokenHash: tokens.hashToken(canary) + 'zz' }];
  expect(registry.lookup(canary)).toBeNull();
});
