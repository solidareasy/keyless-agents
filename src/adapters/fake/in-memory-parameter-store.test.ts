import { describe, expect, it } from 'vitest';
import {
  ParameterStoreError,
  type ParameterStore,
  type ParameterType,
} from '../../ports/parameter-store.js';
import { InMemoryParameterStore } from './in-memory-parameter-store.js';

const options = { type: 'SecureString', keyId: 'FAKE-KEY-ID', overwrite: true } as const;

describe('InMemoryParameterStore contract', () => {
  it('returns null for a missing parameter', async () => {
    const store: ParameterStore = new InMemoryParameterStore();
    expect(await store.get('/p/dev/MISSING')).toBeNull();
  });

  it('increments versions 1, 2, 3 independently for each path', async () => {
    const store: ParameterStore = new InMemoryParameterStore();
    expect(await store.put('/p/dev/A', 'canary-first', options)).toEqual({ version: 1 });
    expect(await store.get('/p/dev/A')).toEqual({ value: 'canary-first', version: 1 });
    expect(await store.put('/p/dev/A', 'canary-second', options)).toEqual({ version: 2 });
    expect(await store.get('/p/dev/A')).toEqual({ value: 'canary-second', version: 2 });
    expect(await store.put('/p/dev/B', 'canary-other', options)).toEqual({ version: 1 });
    expect(await store.put('/p/dev/A', 'canary-third', options)).toEqual({ version: 3 });
    expect(await store.get('/p/dev/A')).toEqual({ value: 'canary-third', version: 3 });
    expect(await store.get('/p/dev/B')).toEqual({ value: 'canary-other', version: 1 });
  });

  it.each(['/p/dev', '/p/dev/'])('lists sorted metadata by segment for %s', async (prefix) => {
    const store: ParameterStore = new InMemoryParameterStore();
    await store.put('/p/dev/Z', 'canary-z', options);
    await store.put('/p/dev/B', 'canary-b', options);
    await store.put('/p/dev2/X', 'canary-neighbor', options);
    await store.put('/p/developer/Y', 'canary-neighbor', options);
    await store.put('/q/dev/X', 'canary-other', options);
    await store.put('/p/dev/agent/A', 'canary-a', options);
    await store.put('/p/dev/Z', 'canary-z-next', options);
    const listing = await store.listByPath(prefix);
    expect(listing).toEqual([
      { name: '/p/dev/B', version: 1 },
      { name: '/p/dev/Z', version: 2 },
      { name: '/p/dev/agent/A', version: 1 },
    ]);
    for (const entry of listing) {
      expect(Object.keys(entry).sort()).toEqual(['name', 'version']);
    }
    expect(await store.listByPath('/missing')).toEqual([]);
  });

  it('returns copies of reads and listing metadata', async () => {
    const store: ParameterStore = new InMemoryParameterStore();
    await store.put('/p/dev/A', 'canary-original', options);
    const read = await store.get('/p/dev/A');
    expect(read).not.toBeNull();
    if (read === null) throw new Error('Expected a stored parameter');
    read.value = 'canary-mutated';
    read.version = 99;
    const listing = await store.listByPath('/p/dev');
    expect(listing).toHaveLength(1);
    const entry = listing[0];
    if (entry === undefined) throw new Error('Expected metadata');
    entry.name = '/q/dev/A';
    entry.version = 99;
    expect(await store.get('/p/dev/A')).toEqual({ value: 'canary-original', version: 1 });
    expect(await store.listByPath('/p/dev')).toEqual([{ name: '/p/dev/A', version: 1 }]);
    expect(await store.get('/q/dev/A')).toBeNull();
  });

  it.each(['String', 'StringList'])('rejects %s without changing stored data', async (type) => {
    const fake = new InMemoryParameterStore();
    const store: ParameterStore = fake;
    await store.put('/p/dev/A', 'canary-original', options);
    await expect(
      store.put('/p/dev/A', 'canary-rejected', { ...options, type: type as ParameterType }),
    ).rejects.toThrow(new TypeError('Parameter type must be SecureString'));
    expect(await store.get('/p/dev/A')).toEqual({ value: 'canary-original', version: 1 });
    await expect(
      store.put('/p/dev/B', 'canary-rejected', { ...options, type: type as ParameterType }),
    ).rejects.toBeInstanceOf(TypeError);
    expect(await store.get('/p/dev/B')).toBeNull();
    expect(await store.put('/p/dev/A', 'canary-next', options)).toEqual({ version: 2 });
  });

  it('records method and path only, including reads and lists', async () => {
    const fake = new InMemoryParameterStore();
    expect(fake.calls).toEqual([]);
    await fake.put('/p/dev/A', 'canary-recorded', options);
    await fake.get('/p/dev/A');
    await fake.listByPath('/p/dev/');
    expect(fake.calls).toEqual([
      { method: 'put', path: '/p/dev/A' },
      { method: 'get', path: '/p/dev/A' },
      { method: 'listByPath', path: '/p/dev/' },
    ]);
    expect(JSON.stringify(fake.calls)).not.toContain('canary-recorded');
  });

  describe.each([
    ['UNAVAILABLE', 'Parameter store unavailable'],
    ['ACCESS_DENIED', 'Parameter store access denied'],
    ['THROTTLED', 'Parameter store throttled'],
  ] as const)('injected %s', (kind, message) => {
    it.each(['get', 'put', 'listByPath'] as const)(
      'fails %s once, records it, preserves data and hides values',
      async (method) => {
        const fake = new InMemoryParameterStore();
        const canary = 'canary-private-value';
        await fake.put('/p/dev/A', canary, options);
        fake.failNext(kind);
        const operation =
          method === 'put'
            ? fake.put('/p/dev/A', 'canary-rejected-value', options)
            : fake[method]('/p/dev/A');
        const error: unknown = await operation.catch((failure: unknown) => failure);
        expect(error).toBeInstanceOf(ParameterStoreError);
        expect(error).toMatchObject({ kind, message });
        expect(String(error)).toBe(`Error: ${message}`);
        expect(String(error)).not.toContain(canary);
        expect(String(error)).not.toContain('canary-rejected-value');
        expect(JSON.stringify(error)).not.toContain(canary);
        expect(fake.calls).toEqual([
          { method: 'put', path: '/p/dev/A' },
          { method, path: '/p/dev/A' },
        ]);
        expect(await fake.get('/p/dev/A')).toEqual({ value: canary, version: 1 });
        expect(await fake.listByPath('/p/dev')).toEqual([{ name: '/p/dev/A', version: 1 }]);
        expect(await fake.put('/p/dev/A', canary, options)).toEqual({ version: 2 });
        expect(JSON.stringify(fake.calls)).not.toContain(canary);
        expect(JSON.stringify(await fake.listByPath('/p/dev'))).not.toContain(canary);
      },
    );
  });
});
