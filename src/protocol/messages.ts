export const PROTOCOL_VERSION = 1;

export type Op = 'list' | 'get' | 'set';

export type Request =
  | { v: 1; auth: string; op: 'list'; prefix?: string }
  | { v: 1; auth: string; op: 'get'; name: string }
  | { v: 1; auth: string; op: 'set'; name: string; value: string };

export type OkResponse =
  | { v: 1; ok: true; names: Array<{ name: string; scope: 'shared' | 'agent' }> }
  | { v: 1; ok: true; value: string; version: number; scope: 'shared' | 'agent' }
  | { v: 1; ok: true; version: number; scope: 'agent' };

export type ErrorCode = 'INVALID' | 'NOT_FOUND' | 'DENIED' | 'RATE_LIMITED' | 'UNAVAILABLE';

export type ErrorResponse = { v: 1; ok: false; code: ErrorCode };
