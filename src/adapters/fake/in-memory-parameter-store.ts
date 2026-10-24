import {
  ParameterStoreError,
  type ParameterStore,
  type ParameterType,
} from '../../ports/parameter-store.js';

export class InMemoryParameterStore implements ParameterStore {
  private readonly parameters = new Map<
    string,
    { value: string; version: number; type: ParameterType; keyId: string }
  >();
  private nextFailure: ParameterStoreError['kind'] | undefined;
  readonly calls: Array<{ method: 'listByPath' | 'get' | 'put'; path: string }> = [];

  failNext(kind: ParameterStoreError['kind']): void {
    this.nextFailure = kind;
  }

  async listByPath(prefix: string): Promise<Array<{ name: string; version: number }>> {
    await this.recordCall('listByPath', prefix);
    const segmentPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`;
    return [...this.parameters]
      .filter(([name]) => name.startsWith(segmentPrefix))
      .map(([name, { version }]) => ({ name, version }))
      .sort((left, right) => (left.name < right.name ? -1 : 1));
  }

  async get(path: string): Promise<{ value: string; version: number } | null> {
    await this.recordCall('get', path);
    const parameter = this.parameters.get(path);
    return parameter ? { value: parameter.value, version: parameter.version } : null;
  }

  async put(
    path: string,
    value: string,
    opts: { type: ParameterType; keyId: string; overwrite: true },
  ): Promise<{ version: number }> {
    await this.recordCall('put', path);
    if (opts.type !== 'SecureString') {
      throw new TypeError('Parameter type must be SecureString');
    }
    const version = (this.parameters.get(path)?.version ?? 0) + 1;
    this.parameters.set(path, { value, version, type: opts.type, keyId: opts.keyId });
    return { version };
  }

  private recordCall(method: 'listByPath' | 'get' | 'put', path: string): Promise<void> {
    this.calls.push({ method, path });
    const kind = this.nextFailure;
    this.nextFailure = undefined;
    return kind === undefined ? Promise.resolve() : Promise.reject(new ParameterStoreError(kind));
  }
}
