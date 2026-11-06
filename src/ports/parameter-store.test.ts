import { describe, expect, expectTypeOf, it } from 'vitest';
import { ParameterStoreError, type ParameterStore, type ParameterType } from './parameter-store.js';

describe('ParameterStore port', () => {
  it('exposes metadata-only listing and nullable reads', () => {
    expectTypeOf<ParameterType>().toEqualTypeOf<'SecureString'>();
    expectTypeOf<ReturnType<ParameterStore['listByPath']>>().toEqualTypeOf<
      Promise<Array<{ name: string; version: number }>>
    >();
    expectTypeOf<ReturnType<ParameterStore['get']>>().toEqualTypeOf<
      Promise<{ value: string; version: number } | null>
    >();
    expectTypeOf<Parameters<ParameterStore['put']>>().toEqualTypeOf<
      [string, string, { type: 'SecureString'; keyId: string; overwrite: true }]
    >();
    expectTypeOf<ReturnType<ParameterStore['put']>>().toEqualTypeOf<Promise<{ version: number }>>();
  });

  it.each([
    ['UNAVAILABLE', 'Parameter store unavailable'],
    ['ACCESS_DENIED', 'Parameter store access denied'],
    ['THROTTLED', 'Parameter store throttled'],
  ] as const)('uses a fixed message for %s', (kind, message) => {
    const error = new ParameterStoreError(kind);
    expect(error).toBeInstanceOf(Error);
    expect(error.kind).toBe(kind);
    expect(error.message).toBe(message);
    expect(Object.keys(error).sort()).toEqual(['kind']);
  });
});
