import type { Request } from './messages.js';

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

export function validateRequest(input: unknown): RequestResult {
  try {
    if (typeof input !== 'object' || input === null) return invalid('NOT_OBJECT');
    if ('project' in input || 'env' in input) return invalid('FOREIGN_KEYSPACE_FIELD');
    if (Array.isArray(input)) return invalid('NOT_OBJECT');
    const data = input as Record<string, unknown>;
    if (data.v !== 1) return invalid('BAD_VERSION');
    if (!('auth' in data) || data.auth === '') return invalid('MISSING_AUTH');
    if (typeof data.auth !== 'string') return invalid('BAD_TYPE');
    if (data.op !== 'list' && data.op !== 'get' && data.op !== 'set') return invalid('BAD_OP');
    const fields = ['v', 'auth', 'op'];
    if (data.op === 'list') fields.push('prefix');
    else fields.push('name');
    if (data.op === 'set') fields.push('value');
    if (Reflect.ownKeys(data).some((key) => typeof key !== 'string' || !fields.includes(key))) {
      return invalid('UNKNOWN_FIELD');
    }
    if (data.op === 'list') {
      if ('prefix' in data && typeof data.prefix !== 'string') return invalid('BAD_TYPE');
    } else {
      if (!('name' in data)) return invalid('MISSING_NAME');
      if (typeof data.name !== 'string') return invalid('BAD_TYPE');
      if (data.op === 'set') {
        if (!('value' in data)) return invalid('MISSING_VALUE');
        if (typeof data.value !== 'string') return invalid('BAD_TYPE');
      }
    }
    return { ok: true, request: input as Request };
  } catch {
    return invalid('BAD_TYPE');
  }
}
