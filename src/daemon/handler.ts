import { AuditChainBroken } from '../core/audit/log.js';
import type { AuditLog } from '../core/audit/log.js';
import type { AuditFields } from '../core/audit/chain.js';
import { keyspacePrefix, parameterPath, parseParameterPath } from '../core/names/keyspace.js';
import type { Keyspace } from '../core/names/keyspace.js';
import { validateEnv, validateName, validateProject } from '../core/names/names.js';
import { decide, listView, resolveGet, writePath } from '../core/policy/policy.js';
import type { PolicyConfig, Subject } from '../core/policy/policy.js';
import type { Registry } from '../core/registry/registry.js';
import type { RateLimiter } from '../core/rate-limit/limiter.js';
import type { SweepDetector } from '../core/rate-limit/sweep.js';
import type { ParameterStore } from '../ports/parameter-store.js';
import { httpStatusFor } from '../protocol/errors.js';
import type { ErrorCode, ErrorResponse, OkResponse, Op } from '../protocol/messages.js';
import { validateRequest } from '../protocol/validate.js';

export type HandlerDeps = {
  registry: Pick<Registry, 'lookup'>;
  policyConfig: PolicyConfig;
  rateLimiter: Pick<RateLimiter, 'take'>;
  sweep: Pick<SweepDetector, 'onList' | 'onGet'>;
  audit: Pick<AuditLog, 'record'>;
  store: ParameterStore;
  kmsKeyAliasFor: (keyspace: Keyspace) => string;
  now: () => Date;
};
export type HandlerResult = { status: number; body: OkResponse | ErrorResponse };
export type Handler = (input: unknown) => Promise<HandlerResult>;

export function errorResult(code: ErrorCode): HandlerResult {
  return { status: httpStatusFor(code), body: { v: 1, ok: false, code } };
}

// Decoded HTTP objects have data properties; inspect only a known operation for invalid requests.
function operation(input: unknown): Op {
  if (typeof input !== 'object' || input === null) return 'list';
  const field = Object.getOwnPropertyDescriptor(input, 'op');
  const value: unknown = field?.value;
  return value === 'get' || value === 'set' ? value : 'list';
}

export function createHandler(deps: HandlerDeps): Handler {
  function record(
    sandboxId: string,
    op: Op,
    name: string | null,
    decision: AuditFields['decision'],
    version: number | null = null,
  ): void {
    try {
      deps.audit.record({ ts: deps.now().toISOString(), sandboxId, op, name, version, decision });
    } catch {
      // The first append failure is fatal too; never expose a sink error or release the response.
      throw new AuditChainBroken();
    }
  }

  return async (input) => {
    const validated = validateRequest(input);
    if (!validated.ok) {
      record(
        'unknown',
        operation(input),
        null,
        validated.reason === 'FOREIGN_KEYSPACE_FIELD' ? 'alert' : 'deny',
      );
      return errorResult('INVALID');
    }
    const req = validated.request;
    let entry;
    try {
      entry = deps.registry.lookup(req.auth);
    } catch {
      record('unknown', req.op, null, 'deny');
      return errorResult('UNAVAILABLE');
    }
    const project = validateProject(entry?.project);
    const env = validateEnv(entry?.env);
    if (entry === null || !project.ok || !env.ok || typeof entry.sandboxId !== 'string') {
      record('unknown', req.op, null, 'alert');
      return errorResult('DENIED');
    }
    const { sandboxId } = entry;
    const keyspace = { project: project.project, env: env.env };
    const subject: Subject = { kind: 'agent', sandboxId, keyspace };
    const named = req.op === 'list' ? req.prefix : req.name;
    const name = named === undefined ? undefined : validateName(named);
    if (name !== undefined && !name.ok) {
      record(sandboxId, req.op, null, 'deny');
      return errorResult('INVALID');
    }
    const auditName = req.op === 'list' ? null : req.name;
    const deny = (code: ErrorCode, decision: 'deny' | 'alert' = 'deny'): HandlerResult => {
      record(sandboxId, req.op, auditName, decision);
      return errorResult(code);
    };
    if (!deps.rateLimiter.take(sandboxId).allowed) return deny('RATE_LIMITED');
    const decision = decide(
      { subject, op: req.op, hasForeignKeyspaceFields: false },
      deps.policyConfig,
    );
    if (decision.kind === 'deny') return deny(decision.code, decision.audit);

    let body: OkResponse;
    let sweepAlert = false;
    try {
      if (req.op === 'list') {
        const parameters = await deps.store.listByPath(keyspacePrefix(keyspace));
        const entries = parameters.flatMap(({ name: path, version }) => {
          const parsed = parseParameterPath(keyspace, path);
          return parsed.ok ? [{ name: parsed.name, scope: parsed.scope, version }] : [];
        });
        const seen = new Set<string>();
        const names = listView(entries).filter(({ name }) => {
          if (seen.has(name) || (req.prefix !== undefined && !name.startsWith(req.prefix)))
            return false;
          seen.add(name);
          return true;
        });
        body = { v: 1, ok: true, names };
        deps.sweep.onList(
          sandboxId,
          names.map(({ name }) => name),
        );
      } else {
        // Non-list operations require a name and passed validation above.
        const validName = name!;
        if (req.op === 'get') {
          const shared = await deps.store.get(parameterPath(keyspace, 'shared', validName.name));
          const agent = await deps.store.get(parameterPath(keyspace, 'agent', validName.name));
          const resolved = resolveGet(shared, agent);
          if (resolved === null) return deny('NOT_FOUND');
          body = { v: 1, ok: true, ...resolved.value, scope: resolved.scope };
          sweepAlert = deps.sweep.onGet(sandboxId, req.name).alert;
        } else {
          const result = await deps.store.put(writePath(subject, validName.name), req.value, {
            type: 'SecureString',
            keyId: deps.kmsKeyAliasFor(keyspace),
            overwrite: true,
          });
          body = { v: 1, ok: true, version: result.version, scope: 'agent' };
        }
      }
    } catch (error) {
      if (error instanceof AuditChainBroken) throw error;
      return deny('UNAVAILABLE');
    }
    const version = 'version' in body ? body.version : null;
    record(sandboxId, req.op, auditName, 'allow', version);
    if (sweepAlert) record(sandboxId, req.op, auditName, 'alert', version);
    return { status: 200, body };
  };
}
