import {
  appendFileSync,
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
} from 'node:fs';
import type { AuditSink } from '../../core/audit/log.js';

export class FileAuditSink implements AuditSink {
  constructor(private readonly path: string) {
    // One open, then fstat and the read on that same fd: the file that is
    // checked is the file that was opened, so the path cannot be swapped
    // between the mode check and the read (TOCTOU).
    const fd = openSync(path, constants.O_RDWR | constants.O_APPEND | constants.O_CREAT, 0o600);
    try {
      const { mode, size } = fstatSync(fd);
      if ((mode & 0o177) !== 0) {
        throw new Error('Audit file permissions are too permissive');
      }
      if (size > 0) {
        const last = Buffer.alloc(1);
        readSync(fd, last, 0, 1, size - 1);
        if (last[0] !== 0x0a) {
          throw new Error('Audit file must end with a newline');
        }
      }
    } finally {
      closeSync(fd);
    }
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
