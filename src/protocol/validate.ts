import type { ErrorResponse, OkResponse, Request } from './messages.js';

export type RequestReason =
  | 'NOT_OBJECT'
  | 'BAD_VERSION'
  | 'MISSING_AUTH'
  | 'BAD_OP'
  | 'MISSING_NAME'
  | 'MISSING_VALUE'
  | 'FOREIGN_KEYSPACE_FIELD'
  | 'UNKNOWN_FIELD'
  | 'BAD_TYPE';

type RequestResult =
  { ok: true; request: Request } | { ok: false; code: 'INVALID'; reason: RequestReason };

function invalid(reason: RequestReason): RequestResult {
  return { ok: false, code: 'INVALID', reason };
}

function hasEnumerableOwn(target: object, key: string): boolean {
  return Object.prototype.propertyIsEnumerable.call(target, key);
}

export function validateRequest(input: unknown): RequestResult {
  try {
    if (typeof input !== 'object' || input === null) return invalid('NOT_OBJECT');
    if ('project' in input || 'env' in input) return invalid('FOREIGN_KEYSPACE_FIELD');
    if (Array.isArray(input)) return invalid('NOT_OBJECT');
    const data = input as Record<string, unknown>;
    if (!hasEnumerableOwn(data, 'v') || data.v !== 1) return invalid('BAD_VERSION');
    if (!hasEnumerableOwn(data, 'auth') || data.auth === '') return invalid('MISSING_AUTH');
    if (typeof data.auth !== 'string') return invalid('BAD_TYPE');
    if (
      !hasEnumerableOwn(data, 'op') ||
      (data.op !== 'list' && data.op !== 'get' && data.op !== 'set')
    )
      return invalid('BAD_OP');
    const fields = ['v', 'auth', 'op'];
    if (data.op === 'list') fields.push('prefix');
    else fields.push('name');
    if (data.op === 'set') fields.push('value');
    if (Reflect.ownKeys(data).some((key) => typeof key !== 'string' || !fields.includes(key))) {
      return invalid('UNKNOWN_FIELD');
    }
    if (data.op === 'list') {
      if ('prefix' in data) {
        if (!hasEnumerableOwn(data, 'prefix')) return invalid('UNKNOWN_FIELD');
        if (typeof data.prefix !== 'string') return invalid('BAD_TYPE');
      }
    } else {
      if (!hasEnumerableOwn(data, 'name')) return invalid('MISSING_NAME');
      if (typeof data.name !== 'string') return invalid('BAD_TYPE');
      if (data.op === 'set') {
        if (!hasEnumerableOwn(data, 'value')) return invalid('MISSING_VALUE');
        if (typeof data.value !== 'string') return invalid('BAD_TYPE');
      }
    }
    return { ok: true, request: input as Request };
  } catch {
    return invalid('BAD_TYPE');
  }
}

function hasShape(input: unknown, fields: string[]): input is Record<string, unknown> {
  return (
    typeof input === 'object' &&
    input !== null &&
    !Array.isArray(input) &&
    Reflect.ownKeys(input).length === fields.length &&
    fields.every((field) => hasEnumerableOwn(input, field))
  );
}

function isResponse(input: unknown): input is OkResponse | ErrorResponse {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  const data = input as Record<string, unknown>;
  if (data.v !== 1) return false;
  if (data.ok === false) {
    return (
      hasShape(data, ['v', 'ok', 'code']) &&
      typeof data.code === 'string' &&
      ['INVALID', 'NOT_FOUND', 'DENIED', 'RATE_LIMITED', 'UNAVAILABLE'].includes(data.code)
    );
  }
  if (data.ok !== true) return false;
  if ('names' in data) {
    return (
      hasShape(data, ['v', 'ok', 'names']) &&
      Array.isArray(data.names) &&
      Array.from(data.names).every(
        (item: unknown) =>
          hasShape(item, ['name', 'scope']) &&
          typeof item.name === 'string' &&
          (item.scope === 'shared' || item.scope === 'agent'),
      )
    );
  }
  const get = 'value' in data;
  return (
    hasShape(
      data,
      get ? ['v', 'ok', 'value', 'version', 'scope'] : ['v', 'ok', 'version', 'scope'],
    ) &&
    typeof data.version === 'number' &&
    Number.isFinite(data.version) &&
    (data.scope === 'agent' || (get && data.scope === 'shared')) &&
    (!get || typeof data.value === 'string')
  );
}

export function validateResponse(
  input: unknown,
): { ok: true; response: OkResponse | ErrorResponse } | { ok: false; reason: string } {
  try {
    if (isResponse(input)) return { ok: true, response: input };
  } catch {
    return { ok: false, reason: 'INVALID_RESPONSE' };
  }
  return { ok: false, reason: 'INVALID_RESPONSE' };
}
