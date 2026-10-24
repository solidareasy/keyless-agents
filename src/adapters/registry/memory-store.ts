import type { RegistryStore, StoredEntry } from '../../core/registry/registry.js';

export class InMemoryRegistryStore implements RegistryStore {
  private entries: StoredEntry[] = [];

  load(): StoredEntry[] {
    return this.entries.map((entry) => ({ ...entry }));
  }

  save(entries: StoredEntry[]): void {
    this.entries = entries.map((entry) => ({ ...entry }));
  }
}
