import { appendFileSync, closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import type { AuditSink } from '../../core/audit/log.js';

export class FileAuditSink implements AuditSink {
  private fd: number | undefined;

  constructor(path: string) {
    // One open for the whole life of the sink. The mode check, the newline
    // check, every append and every read go through this fd, so the file that
    // was validated is the file that is written and read even if the path is
    // renamed or swapped for a symlink afterwards (TOCTOU).
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
    } catch (error) {
      closeSync(fd);
      throw error;
    }
    this.fd = fd;
  }

  append(line: string): void {
    // One O_APPEND write per line; an OS failure can leave a partial line.
    // Verification detects truncation and AuditLog refuses to resume it.
    appendFileSync(this.openFd(), line + '\n');
  }

  readAll(): string[] {
    // Positional reads from byte 0: with O_APPEND the fd offset sits at EOF
    // after an append, so a sequential read would come back empty.
    const fd = this.openFd();
    const buffer = Buffer.alloc(fstatSync(fd).size);
    let filled = 0;
    while (filled < buffer.length) {
      const read = readSync(fd, buffer, filled, buffer.length - filled, filled);
      if (read === 0) break;
      filled += read;
    }
    return buffer.toString('utf8', 0, filled).split('\n');
  }

  close(): void {
    if (this.fd === undefined) return;
    const fd = this.fd;
    this.fd = undefined;
    closeSync(fd);
  }

  private openFd(): number {
    if (this.fd === undefined) throw new Error('Audit sink is closed');
    return this.fd;
  }
}
