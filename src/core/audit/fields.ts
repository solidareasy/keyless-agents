// Separate stages preserve verification's link/hash precedence over enum errors.
export function validateAuditFields(input: unknown, stage: 'shape' | 'enums'): boolean {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  const fields = input as Record<string, unknown>;
  if (stage === 'shape') {
    return (
      typeof fields.ts === 'string' &&
      typeof fields.sandboxId === 'string' &&
      typeof fields.op === 'string' &&
      (fields.name === null || typeof fields.name === 'string') &&
      (fields.version === null || typeof fields.version === 'number') &&
      typeof fields.decision === 'string'
    );
  }
  const operations: readonly unknown[] = ['list', 'get', 'set', 'promote', 'delete'];
  const decisions: readonly unknown[] = ['allow', 'deny', 'alert'];
  return operations.includes(fields.op) && decisions.includes(fields.decision);
}
