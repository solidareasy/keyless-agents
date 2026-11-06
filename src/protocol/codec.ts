import type { ErrorResponse, OkResponse, Request } from './messages.js';

export function encode(obj: Request | OkResponse | ErrorResponse): string {
  return JSON.stringify(obj);
}

export function decodeJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    const value: unknown = JSON.parse(text);
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}
