import type { Keyspace, Scope } from '../names/keyspace.js';

export type Actor = 'agent' | 'operator';
export type Operation = 'list' | 'get' | 'set' | 'promote' | 'delete';
export type PolicyConfig = { get: 'value' | 'deny' };
export type Subject =
  | { kind: 'agent'; sandboxId: string; keyspace: Keyspace }
  | { kind: 'operator'; keyspace: Keyspace };
export type PolicyRequest = {
  subject: Subject | null;
  op: Operation;
  hasForeignKeyspaceFields: boolean;
};
export type Decision =
  | { kind: 'allow'; audit: 'allow'; writeScope?: 'agent' }
  | { kind: 'deny'; code: 'DENIED' | 'INVALID'; audit: 'deny' | 'alert' };

export function decide(req: PolicyRequest, cfg: PolicyConfig): Decision {
  if (req.hasForeignKeyspaceFields) return { kind: 'deny', code: 'INVALID', audit: 'alert' };
  if (req.subject === null) return { kind: 'deny', code: 'DENIED', audit: 'alert' };
  if (req.subject.kind === 'operator') return { kind: 'allow', audit: 'allow' };
  switch (req.op) {
    case 'list':
      return { kind: 'allow', audit: 'allow' };
    case 'get':
      return cfg.get === 'value'
        ? { kind: 'allow', audit: 'allow' }
        : { kind: 'deny', code: 'DENIED', audit: 'deny' };
    case 'set':
      return { kind: 'allow', audit: 'allow', writeScope: 'agent' };
    case 'promote':
      return { kind: 'deny', code: 'DENIED', audit: 'deny' };
    case 'delete':
      return { kind: 'deny', code: 'DENIED', audit: 'deny' };
  }
}

export function resolveGet<V>(
  shared: V | null,
  agent: V | null,
): { scope: Scope; value: V } | null {
  if (shared !== null) return { scope: 'shared', value: shared };
  if (agent !== null) return { scope: 'agent', value: agent };
  return null;
}
