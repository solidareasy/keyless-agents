import { validateEnv, validateProject } from '../names/names.js';
import { generateToken, hashToken, tokensEqual } from './token.js';

export type SandboxEntry = { sandboxId: string; project: string; env: string; createdAt: string };
export type StoredEntry = SandboxEntry & { tokenHash: string };

export interface RegistryStore {
  load(): StoredEntry[];
  save(entries: StoredEntry[]): void;
}

type AddResult =
  | { ok: true; token: string; entry: SandboxEntry }
  | {
      ok: false;
      code: 'DUPLICATE_SANDBOX' | 'BAD_SANDBOX_ID' | 'BAD_PROJECT' | 'BAD_ENV' | 'PROD_FORBIDDEN';
    };

function publicEntry({ sandboxId, project, env, createdAt }: SandboxEntry): SandboxEntry {
  return { sandboxId, project, env, createdAt };
}

export class Registry {
  constructor(
    private readonly store: RegistryStore,
    private readonly now: () => Date,
    private readonly random: () => string = generateToken,
  ) {}

  add(sandboxId: string, project: string, env: string): AddResult {
    return this.sanitized(() => {
      if (!/^[A-Za-z0-9_.-]{1,64}$/.test(sandboxId)) return { ok: false, code: 'BAD_SANDBOX_ID' };
      if (!validateProject(project).ok) return { ok: false, code: 'BAD_PROJECT' };
      const environment = validateEnv(env);
      if (!environment.ok)
        return {
          ok: false,
          code: environment.code === 'RESERVED_ENV' ? 'PROD_FORBIDDEN' : 'BAD_ENV',
        };
      const entries = this.store.load();
      if (entries.some((entry) => entry.sandboxId === sandboxId))
        return { ok: false, code: 'DUPLICATE_SANDBOX' };
      const token = this.random();
      const entry = { sandboxId, project, env, createdAt: this.now().toISOString() };
      this.store.save([...entries, { ...entry, tokenHash: hashToken(token) }]);
      return { ok: true, token, entry };
    });
  }

  lookup(token: string): SandboxEntry | null {
    return this.sanitized(() => {
      const hash = hashToken(token);
      let match: SandboxEntry | null = null;
      let matches = 0;
      for (const entry of this.store.load()) {
        if (tokensEqual(hash, entry.tokenHash)) {
          match = publicEntry(entry);
          matches += 1;
        }
      }
      return matches === 1 ? match : null;
    });
  }

  revoke(sandboxId: string): { ok: true } | { ok: false; code: 'NOT_FOUND' } {
    return this.sanitized(() => {
      const entries = this.store.load();
      const remaining = entries.filter((entry) => entry.sandboxId !== sandboxId);
      if (remaining.length === entries.length) return { ok: false, code: 'NOT_FOUND' };
      this.store.save(remaining);
      return { ok: true };
    });
  }

  list(): SandboxEntry[] {
    return this.sanitized(() => this.store.load().map(publicEntry));
  }

  private sanitized<T>(operation: () => T): T {
    try {
      return operation();
    } catch {
      throw new Error('Registry operation failed');
    }
  }
}
