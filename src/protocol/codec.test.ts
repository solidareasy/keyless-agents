import { expect, it } from 'vitest';
import { encode, decodeJson } from './codec.js';
import type { ErrorResponse, OkResponse, Request } from './messages.js';

const messages: Array<Request | OkResponse | ErrorResponse> = [
  { v: 1, auth: 'x', op: 'list' },
  { v: 1, ok: true, names: [{ name: 'canary-name', scope: 'shared' }] },
  { v: 1, ok: true, value: 'canary-value\n\r"\\', version: 3, scope: 'agent' },
  { v: 1, ok: true, version: 3, scope: 'agent' },
  { v: 1, ok: false, code: 'DENIED' },
];
it.each(messages)('encodes a protocol message as one JSON line %#', (message) => {
  const text = encode(message);
  expect(text).not.toMatch(/[\r\n]/);
  expect(decodeJson(text)).toEqual({ ok: true, value: message });
});

it('uses compact JSON without a trailing newline', () => {
  expect(encode({ v: 1, ok: false, code: 'INVALID' })).toBe('{"v":1,"ok":false,"code":"INVALID"}');
});

it.each(['', '{', 'undefined', '{"v":1,}', 'null trailing', '\u0000'])(
  'handles malformed JSON case %# without throwing',
  (text) => {
    expect(decodeJson(text)).toEqual({ ok: false });
  },
);

it.each([
  ['null', null],
  ['1', 1],
  ['true', true],
  ['[]', []],
  ['"canary-text"', 'canary-text'],
])('decodes arbitrary JSON case %#', (text, value) => {
  expect(decodeJson(text as string)).toEqual({ ok: true, value });
});
