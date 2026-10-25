import fc from 'fast-check';
import { expect, it } from 'vitest';
import { appendEntry, GENESIS_HASH, verifyChain } from './chain.js';
import type { AuditFields } from './chain.js';

const fields: fc.Arbitrary<AuditFields> = fc.record({
  ts: fc.string(),
  sandboxId: fc
    .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'), {
      minLength: 1,
      maxLength: 40,
    })
    .map((chars) => chars.join('')),
  op: fc.constantFrom('list', 'get', 'set', 'promote', 'delete'),
  name: fc.option(fc.string(), { nil: null }),
  version: fc.option(fc.integer(), { nil: null }),
  decision: fc.constantFrom('allow', 'deny', 'alert'),
});

it('detects an ASCII content byte mutation at the selected line or earlier', () => {
  fc.assert(
    fc.property(
      fc.array(fields, { minLength: 1, maxLength: 30 }),
      fc.nat(),
      fc.nat(),
      (entries, selected, offset) => {
        let prevHash = GENESIS_HASH;
        const lines = entries.map((entry) => {
          const appended = appendEntry(prevHash, entry);
          prevHash = appended.hash;
          return appended.line;
        });
        expect(verifyChain(lines)).toEqual({ ok: true, count: entries.length, lastHash: prevHash });
        const k = selected % entries.length;
        const line = lines[k]!;
        const start = line.indexOf('"sandboxId":"') + '"sandboxId":"'.length;
        const position = start + (offset % entries[k]!.sandboxId.length);
        const replacement = line[position] === 'x' ? 'y' : 'x';
        lines[k] = line.slice(0, position) + replacement + line.slice(position + 1);
        const result = verifyChain(lines);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.line).toBeLessThanOrEqual(k + 1);
      },
    ),
    { numRuns: 300 },
  );
});
