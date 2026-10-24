export const NAME_RE = /^(?!\.{1,2}$)[A-Za-z0-9_.-]{1,128}$/;

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
