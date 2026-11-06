import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import type { RegistryStore, StoredEntry } from '../../core/registry/registry.js';

export class FileRegistryStore implements RegistryStore {
  constructor(private readonly path: string) {
    this.checkPermissions();
  }

  load(): StoredEntry[] {
    this.checkPermissions();
    if (!existsSync(this.path)) return [];
    return JSON.parse(readFileSync(this.path, 'utf8')) as StoredEntry[];
  }

  save(entries: StoredEntry[]): void {
    this.checkPermissions();
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(entries), { mode: 0o600, flag: 'wx' });
      renameSync(temporary, this.path);
    } finally {
      rmSync(temporary, { force: true });
    }
  }

  private checkPermissions(): void {
    if (existsSync(this.path) && (statSync(this.path).mode & 0o177) !== 0) {
      throw new Error('Registry file permissions must be 0600 or stricter');
    }
  }
}
