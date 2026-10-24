import { appendEntry, GENESIS_HASH, verifyChain } from './chain.js';
import type { AuditFields } from './chain.js';

export interface AuditSink {
  append(line: string): void;
  readAll(): string[];
}

export class AuditChainBroken extends Error {
  constructor() {
    super('Audit chain is broken');
    this.name = 'AuditChainBroken';
  }
}

export class AuditLog {
  private lastHash: string;
  private broken: boolean;

  constructor(private readonly sink: AuditSink) {
    const result = this.verify();
    this.broken = !result.ok;
    this.lastHash = result.ok ? result.lastHash : GENESIS_HASH;
  }

  record(fields: AuditFields): string {
    if (this.broken) throw new AuditChainBroken();
    const entry = appendEntry(this.lastHash, fields);
    try {
      this.sink.append(entry.line);
    } catch (error) {
      this.broken = true;
      throw error;
    }
    this.lastHash = entry.hash;
    return entry.hash;
  }

  verify(): ReturnType<typeof verifyChain> {
    return verifyChain(this.sink.readAll());
  }
}
