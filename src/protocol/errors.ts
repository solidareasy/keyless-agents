import type { ErrorCode } from './messages.js';

export const EXIT_CODES = {
  ok: 0,
  usage: 1,
  notFound: 2,
  denied: 3,
  rateLimited: 4,
  unavailable: 5,
  doctorFailed: 6,
} as const;

const errors = {
  INVALID: { exit: EXIT_CODES.usage, status: 400, message: 'Invalid request.' },
  NOT_FOUND: { exit: EXIT_CODES.notFound, status: 404, message: 'Not found.' },
  DENIED: { exit: EXIT_CODES.denied, status: 403, message: 'Access denied.' },
  RATE_LIMITED: { exit: EXIT_CODES.rateLimited, status: 429, message: 'Rate limit exceeded.' },
  UNAVAILABLE: { exit: EXIT_CODES.unavailable, status: 503, message: 'Service unavailable.' },
} satisfies Record<ErrorCode, { exit: number; status: number; message: string }>;

export function exitCodeFor(code: ErrorCode): 1 | 2 | 3 | 4 | 5 {
  return errors[code].exit;
}

export function httpStatusFor(code: ErrorCode): number {
  return errors[code].status;
}

export function humanMessage(code: ErrorCode): string {
  return errors[code].message;
}
