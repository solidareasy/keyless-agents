import { describe, expect, it } from 'vitest';
import type { IdentityProvider } from '../../ports/identity-provider.js';
import { FakeIdentityProvider } from './fake-identity-provider.js';

describe('FakeIdentityProvider', () => {
  it('provides obvious fake credentials with an injected expiry through the port', async () => {
    const expiresAt = new Date('2100-01-01T00:00:00.000Z');
    const fake = new FakeIdentityProvider(expiresAt);
    const provider: IdentityProvider = fake;
    expect(fake.calls).toBe(0);
    expect(fake.lastKeyspace).toBeUndefined();
    const credentials = await provider.credentialsFor({ project: 'p', env: 'dev' });
    expect(credentials.accessKeyId).toBe('FAKE-ACCESS-KEY-ID');
    expect(credentials.secretAccessKey).toBe('FAKE-SECRET-ACCESS-KEY');
    expect(credentials.sessionToken).toBe('FAKE-SESSION-TOKEN');
    expect(credentials.expiresAt).toEqual(expiresAt);
    expect(fake.calls).toBe(1);
    expect(fake.lastKeyspace).toEqual({ project: 'p', env: 'dev' });
    await provider.credentialsFor({ project: 'q', env: 'dev' });
    expect(fake.calls).toBe(2);
    expect(fake.lastKeyspace).toEqual({ project: 'q', env: 'dev' });
  });

  it('redacts credentials in strings and JSON while preserving direct access', async () => {
    const provider = new FakeIdentityProvider();
    const credentials = await provider.credentialsFor({ project: 'p', env: 'dev' });
    expect(credentials.expiresAt).toBeInstanceOf(Date);
    expect(String(credentials)).toBe('[redacted]');
    expect(JSON.stringify(credentials)).toBe('"[redacted]"');
    for (const secret of [
      credentials.accessKeyId,
      credentials.secretAccessKey,
      credentials.sessionToken,
      'secretAccessKey',
    ]) {
      expect(JSON.stringify({ credentials })).not.toContain(secret);
      expect(String(credentials)).not.toContain(secret);
    }
  });
});
