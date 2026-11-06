import { request as httpRequest } from 'node:http';
import type { ErrorResponse, OkResponse, Request } from '../protocol/messages.js';
import { decodeJson } from '../protocol/codec.js';
import { validateResponse } from '../protocol/validate.js';

export function request(url: string, req: Request): Promise<OkResponse | ErrorResponse> {
  const unavailable: ErrorResponse = { v: 1, ok: false, code: 'UNAVAILABLE' };
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      outgoing.destroy();
      resolve(unavailable);
    }, 5000);
    const finish = (response: OkResponse | ErrorResponse) => {
      clearTimeout(timeout);
      resolve(response);
    };
    let outgoing: ReturnType<typeof httpRequest>;
    try {
      outgoing = httpRequest(
        url,
        { method: 'POST', headers: { 'content-type': 'application/json' } },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > 1024 * 1024) {
              res.destroy();
              finish(unavailable);
              return;
            }
            chunks.push(chunk);
          });
          res.on('error', () => finish(unavailable));
          res.on('aborted', () => finish(unavailable));
          res.on('end', () => {
            const decoded = decodeJson(Buffer.concat(chunks).toString('utf8'));
            const validated = decoded.ok ? validateResponse(decoded.value) : null;
            finish(validated?.ok === true ? validated.response : unavailable);
          });
        },
      );
      outgoing.on('error', () => finish(unavailable));
      outgoing.end(JSON.stringify(req));
    } catch {
      finish(unavailable);
    }
  });
}
