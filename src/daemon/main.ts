import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Server } from 'node:http';
import { FileAuditSink } from '../adapters/audit/file-sink.js';
import { FileRegistryStore } from '../adapters/registry/file-store.js';
import { InMemoryParameterStore } from '../adapters/fake/in-memory-parameter-store.js';
import { AuditChainBroken, AuditLog } from '../core/audit/log.js';
import { Registry } from '../core/registry/registry.js';
import { RateLimiter } from '../core/rate-limit/limiter.js';
import { DEFAULT_SWEEP_WINDOW_MS, SweepDetector } from '../core/rate-limit/sweep.js';
import { decodeJson } from '../protocol/codec.js';
import { configPath, loadConfig } from './config.js';
import { serve } from './server.js';

export type StartResult = { ok: true; server: Server } | { ok: false; message: string };

export async function startDaemon(path: string = configPath()): Promise<StartResult> {
  try {
    const decoded = decodeJson(readFileSync(path, 'utf8'));
    if (!decoded.ok) return { ok: false, message: 'Invalid configuration JSON.' };
    const loaded = loadConfig(decoded.value);
    if (!loaded.ok) return { ok: false, message: loaded.code };
    const config = loaded.config;
    if (config.store !== 'memory') return { ok: false, message: 'AWS adapter not available yet' };
    const audit = new AuditLog(new FileAuditSink(config.audit.path));
    if (!audit.verify().ok) throw new AuditChainBroken();
    const registry = new Registry(
      new FileRegistryStore(join(dirname(config.audit.path), 'registry.json')),
      () => new Date(),
    );
    // loadConfig validated the rate limit; both consumers receive a monotonic clock.
    const monotonic = () => performance.now();
    const server = serve(config, {
      registry,
      audit,
      store: new InMemoryParameterStore(),
      policyConfig: config.policy,
      rateLimiter: new RateLimiter(config.rateLimit, monotonic),
      sweep: new SweepDetector(DEFAULT_SWEEP_WINDOW_MS, monotonic),
      now: () => new Date(),
      kmsKeyAliasFor: (ks) => {
        const project = config.projects.find(
          (entry) => entry.project === ks.project && entry.env === ks.env,
        );
        if (project === undefined) throw new Error('Keyspace not configured');
        return project.kmsKeyAlias;
      },
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.once('listening', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    return { ok: true, server };
  } catch {
    return { ok: false, message: 'Daemon startup failed.' };
  }
}
