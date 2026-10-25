import { validateName } from './names.js';
import type { Env, Name, Project } from './names.js';

export type Scope = 'shared' | 'agent';
export type Keyspace = { project: Project; env: Env };

export function keyspacePrefix(ks: Keyspace): string {
  return `/${ks.project}/${ks.env}/`;
}

export function parameterPath(ks: Keyspace, scope: Scope, name: Name): string {
  return `${keyspacePrefix(ks)}${scope === 'agent' ? 'agent/' : ''}${name}`;
}

export function parseParameterPath(
  ks: Keyspace,
  path: string,
):
  | { ok: true; scope: Scope; name: Name }
  | { ok: false; code: 'OUTSIDE_KEYSPACE' | 'BAD_DEPTH' | 'BAD_NAME' } {
  if (!path.startsWith(keyspacePrefix(ks))) return { ok: false, code: 'OUTSIDE_KEYSPACE' };

  const segments = path.split('/').slice(1);
  if (segments.length > 15) return { ok: false, code: 'BAD_DEPTH' };

  let scope: Scope;
  if (segments.length === 3 && segments[2] !== 'agent') {
    scope = 'shared';
  } else if (segments.length === 4 && segments[2] === 'agent') {
    scope = 'agent';
  } else {
    return { ok: false, code: 'BAD_DEPTH' };
  }

  const result = validateName(segments.at(-1));
  if (!result.ok) return { ok: false, code: 'BAD_NAME' };
  return { ok: true, scope, name: result.name };
}
