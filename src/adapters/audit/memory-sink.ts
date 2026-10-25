import type { AuditSink } from '../../core/audit/log.js';

export class InMemoryAuditSink implements AuditSink {
  private readonly lines: string[] = [];

  append(line: string): void {
    this.lines.push(line);
  }

  readAll(): string[] {
    return [...this.lines];
  }
}
