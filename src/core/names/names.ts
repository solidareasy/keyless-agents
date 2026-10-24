export const NAME_RE = /^(?!\.{1,2}$)[A-Za-z0-9_.-]{1,128}$/;
export const PROJECT_RE = /^[a-z][a-z0-9-]{1,31}$/;
export const ENV_RE = /^[a-z][a-z0-9-]{1,15}$/;

export type Name = string & { readonly __brand: 'Name' };
export type NameErrorCode =
  | 'NOT_A_STRING'
  | 'EMPTY'
  | 'TOO_LONG'
  | 'DOT_SEGMENT'
  | 'INVALID_CHAR'
  | 'RESERVED_PREFIX';

export function validateName(
  input: unknown,
): { ok: true; name: Name } | { ok: false; code: NameErrorCode } {
  if (typeof input !== 'string') return { ok: false, code: 'NOT_A_STRING' };
  if (input.length === 0) return { ok: false, code: 'EMPTY' };
  if (input.length > 128) return { ok: false, code: 'TOO_LONG' };
  if (input === '.' || input === '..') return { ok: false, code: 'DOT_SEGMENT' };
  // Compare the entire match: JavaScript's $ also matches before a final newline.
  if (NAME_RE.exec(input)?.[0] !== input) return { ok: false, code: 'INVALID_CHAR' };
  if (/^(aws|ssm)/i.test(input)) return { ok: false, code: 'RESERVED_PREFIX' };
  return { ok: true, name: input as Name };
}

export type Project = string & { readonly __brand: 'Project' };
export type Env = string & { readonly __brand: 'Env' };
export type ProjectErrorCode = 'NOT_A_STRING' | 'EMPTY' | 'TOO_LONG' | 'INVALID_CHAR';
export type EnvErrorCode = ProjectErrorCode | 'RESERVED_ENV';

export function validateProject(
  input: unknown,
): { ok: true; project: Project } | { ok: false; code: ProjectErrorCode } {
  if (typeof input !== 'string') return { ok: false, code: 'NOT_A_STRING' };
  if (input.length === 0) return { ok: false, code: 'EMPTY' };
  if (input.length > 32) return { ok: false, code: 'TOO_LONG' };
  if (PROJECT_RE.exec(input)?.[0] !== input) return { ok: false, code: 'INVALID_CHAR' };
  return { ok: true, project: input as Project };
}

export function validateEnv(
  input: unknown,
): { ok: true; env: Env } | { ok: false; code: EnvErrorCode } {
  if (typeof input !== 'string') return { ok: false, code: 'NOT_A_STRING' };
  if (input.length === 0) return { ok: false, code: 'EMPTY' };
  if (input.length > 16) return { ok: false, code: 'TOO_LONG' };
  if (ENV_RE.exec(input)?.[0] !== input) return { ok: false, code: 'INVALID_CHAR' };
  if (input === 'prod') return { ok: false, code: 'RESERVED_ENV' };
  return { ok: true, env: input as Env };
}
