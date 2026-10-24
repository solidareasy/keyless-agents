import { appendFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import type { AuditSink } from '../../core/audit/log.js';

export class FileAuditSink implements AuditSink {
  constructor(private readonly path: string) {
    if (existsSync(path) && (statSync(path).mode & 0o177) !== 0) {
      throw new Error('Audit file permissions are too permissive');
    }
    appendFileSync(path, '', { mode: 0o600, flag: 'a' });
  }

  append(line: string): void {
    // One O_APPEND write per line; an OS failure can leave a partial line.
    // Verification detects truncation and AuditLog refuses to resume it.
    appendFileSync(this.path, line + '\n', { mode: 0o600, flag: 'a' });
  }

  readAll(): string[] {
    return readFileSync(this.path, 'utf8').split('\n');
  }
}
