import { createHash } from 'node:crypto';

export type AuditFields = {
  ts: string;
  sandboxId: string;
  op: 'list' | 'get' | 'set' | 'promote' | 'delete';
  name: string | null;
  version: number | null;
  decision: 'allow' | 'deny' | 'alert';
};

export const GENESIS_HASH = '0'.repeat(64);

export function canonical(fields: AuditFields, prevHash: string): string {
  return JSON.stringify({
    ts: fields.ts,
    sandboxId: fields.sandboxId,
    op: fields.op,
    name: fields.name,
    version: fields.version,
    decision: fields.decision,
    prevHash,
  });
}

export function hashLine(fields: AuditFields, prevHash: string): string {
  return createHash('sha256').update(canonical(fields, prevHash)).digest('hex');
}

export function appendEntry(prevHash: string, fields: AuditFields): { line: string; hash: string } {
  const hash = hashLine(fields, prevHash);
  return { line: `${canonical(fields, prevHash).slice(0, -1)},"hash":"${hash}"}`, hash };
}

type AuditEntry = AuditFields & { prevHash: string; hash: string };
type Verification =
  | { ok: true; count: number; lastHash: string }
  | { ok: false; line: number; reason: 'PARSE' | 'SHAPE' | 'PREV_MISMATCH' | 'HASH_MISMATCH' };

function hasShape(input: unknown): input is AuditEntry {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  const entry = input as Record<string, unknown>;
  const keys = ['ts', 'sandboxId', 'op', 'name', 'version', 'decision', 'prevHash', 'hash'];
  return (
    Object.keys(entry).length === keys.length &&
    keys.every((key) => Object.hasOwn(entry, key)) &&
    typeof entry.ts === 'string' &&
    typeof entry.sandboxId === 'string' &&
    typeof entry.op === 'string' &&
    (entry.name === null || typeof entry.name === 'string') &&
    (entry.version === null || typeof entry.version === 'number') &&
    typeof entry.decision === 'string' &&
    typeof entry.prevHash === 'string' &&
    entry.prevHash.length === 64 &&
    /^[a-f0-9]{64}$/.test(entry.prevHash) &&
    typeof entry.hash === 'string' &&
    entry.hash.length === 64 &&
    /^[a-f0-9]{64}$/.test(entry.hash)
  );
}

export function verifyChain(lines: Iterable<string>): Verification {
  let lastHash = GENESIS_HASH;
  let count = 0;
  let pendingEmpty = false;
  for (const text of lines) {
    if (pendingEmpty) return { ok: false, line: count + 1, reason: 'PARSE' };
    if (text === '') {
      pendingEmpty = true;
      continue;
    }
    const line = count + 1;
    let entry: unknown;
    try {
      entry = JSON.parse(text) as unknown;
    } catch {
      return { ok: false, line, reason: 'PARSE' };
    }
    if (!hasShape(entry)) return { ok: false, line, reason: 'SHAPE' };
    if (entry.prevHash !== lastHash) return { ok: false, line, reason: 'PREV_MISMATCH' };
    if (hashLine(entry, entry.prevHash) !== entry.hash)
      return { ok: false, line, reason: 'HASH_MISMATCH' };
    if (
      !['list', 'get', 'set', 'promote', 'delete'].includes(entry.op) ||
      !['allow', 'deny', 'alert'].includes(entry.decision)
    ) {
      return { ok: false, line, reason: 'SHAPE' };
    }
    lastHash = entry.hash;
    count++;
  }
  return { ok: true, count, lastHash };
}
