import { expect, it } from 'vitest';
import { Registry } from '../../core/registry/registry.js';
import { InMemoryRegistryStore } from './memory-store.js';

it('starts empty and copies saved and loaded entries defensively', () => {
  const store = new InMemoryRegistryStore();
  expect(store.load()).toEqual([]);
  const entries = [
    {
      sandboxId: 'canary-sandbox',
      project: 'canary-project',
      env: 'dev',
      createdAt: '2026-01-01T00:00:00.000Z',
      tokenHash: 'a'.repeat(64),
    },
  ];
  store.save(entries);
  entries[0]!.env = 'prod';
  expect(store.load()[0]?.env).toBe('dev');
  const loaded = store.load();
  loaded[0]!.env = 'prod';
  loaded.pop();
  expect(store.load()).toHaveLength(1);
  expect(store.load()[0]?.env).toBe('dev');
});

it('integrates with registration and revocation without retaining plaintext', () => {
  const store = new InMemoryRegistryStore();
  const registry = new Registry(
    store,
    () => new Date('2026-01-01T00:00:00.000Z'),
    () => 'canary-memory-token',
  );
  const result = registry.add('canary-sandbox', 'canary-project', 'dev');
  expect(result.ok).toBe(true);
  expect(registry.lookup('canary-memory-token')?.sandboxId).toBe('canary-sandbox');
  expect(JSON.stringify(store.load())).not.toContain('canary-memory-token');
  registry.revoke('canary-sandbox');
  expect(registry.lookup('canary-memory-token')).toBeNull();
});
