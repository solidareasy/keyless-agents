import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function generateToken(): string {
  return `klag_${randomBytes(32).toString('base64url')}`;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function tokensEqual(aHex: string, bHex: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(aHex) || !/^[0-9a-f]{64}$/.test(bHex)) return false;
  const a = Buffer.from(aHex, 'hex');
  const b = Buffer.from(bHex, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
