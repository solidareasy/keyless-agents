export type CliConfig = { url: string; auth: string };

export function loadCliConfig():
  { ok: true; config: CliConfig } | { ok: false; code: 'UNAVAILABLE' } {
  const url = process.env.KLAG_URL;
  if (url === undefined || !URL.canParse(url)) return { ok: false, code: 'UNAVAILABLE' };
  const parsed = new URL(url);
  if (
    parsed.protocol !== 'http:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  )
    return { ok: false, code: 'UNAVAILABLE' };
  return { ok: true, config: { url, auth: process.env.KLAG_AUTH ?? '__KLAG_AUTH__' } };
}
