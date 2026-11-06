export type ParameterType = 'SecureString';

export interface ParameterStore {
  listByPath(prefix: string): Promise<Array<{ name: string; version: number }>>;
  get(path: string): Promise<{ value: string; version: number } | null>;
  put(
    path: string,
    value: string,
    opts: { type: ParameterType; keyId: string; overwrite: true },
  ): Promise<{ version: number }>;
}

const messages = {
  UNAVAILABLE: 'Parameter store unavailable',
  ACCESS_DENIED: 'Parameter store access denied',
  THROTTLED: 'Parameter store throttled',
};

export class ParameterStoreError extends Error {
  constructor(public readonly kind: 'UNAVAILABLE' | 'ACCESS_DENIED' | 'THROTTLED') {
    super(messages[kind]);
  }
}
