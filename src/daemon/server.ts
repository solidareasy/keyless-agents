import { createServer as httpServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { AuditChainBroken } from '../core/audit/log.js';
import { decodeJson } from '../protocol/codec.js';
import { createHandler, errorResult } from './handler.js';
import type { Handler, HandlerDeps, HandlerResult } from './handler.js';

export function createServer(
  handler: Handler,
  { maxBodyBytes = 64 * 1024 }: { maxBodyBytes?: number } = {},
): Server {
  let fatal = false;
  function send(res: ServerResponse, result: HandlerResult): void {
    res.writeHead(result.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(result.body) + '\n');
  }
  const server = httpServer((req, res) => {
    const invalid = () => {
      res.setHeader('connection', 'close');
      send(res, errorResult('INVALID'));
    };
    // Inspect routing before registering data listeners: query authentication is never consumed.
    if (
      req.method !== 'POST' ||
      req.url !== '/' ||
      req.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json'
    ) {
      invalid();
      return;
    }
    if (fatal) {
      send(res, errorResult('UNAVAILABLE'));
      return;
    }
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        req.pause();
        invalid();
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', () => {
      if (!res.writableEnded) send(res, errorResult('INVALID'));
    });
    req.on('end', () => {
      void dispatch(req, res, Buffer.concat(chunks).toString('utf8'));
    });
  });

  async function dispatch(req: IncomingMessage, res: ServerResponse, text: string): Promise<void> {
    const decoded = decodeJson(text);
    if (!decoded.ok) {
      send(res, errorResult('INVALID'));
      return;
    }
    let input = decoded.value;
    const auth = req.headers['x-klag-auth'];
    if (
      auth !== undefined &&
      typeof input === 'object' &&
      input !== null &&
      !Array.isArray(input)
    ) {
      input = { ...input, auth };
    }
    try {
      const result = await handler(input);
      send(res, fatal ? errorResult('UNAVAILABLE') : result);
    } catch (error) {
      if (error instanceof AuditChainBroken) {
        fatal = true;
        process.exitCode = 1;
        // Finish the fixed error response, then close every connection so no other value escapes.
        res.once('finish', () => server.closeAllConnections());
        server.close();
      }
      send(res, errorResult('UNAVAILABLE'));
    }
  }
  return server;
}

export function serve(config: { listen: string }, deps: HandlerDeps): Server {
  const separator = config.listen.lastIndexOf(':');
  const host = config.listen.slice(0, separator).replace(/^\[|\]$/g, '');
  const port = Number(config.listen.slice(separator + 1));
  return createServer(createHandler(deps)).listen(port, host);
}
