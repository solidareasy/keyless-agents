import type { Credentials, IdentityProvider } from '../../ports/identity-provider.js';

interface FakeCredentials extends Credentials {
  toString(): string;
  toJSON(): string;
}

export class FakeIdentityProvider implements IdentityProvider {
  calls = 0;
  lastKeyspace: { project: string; env: string } | undefined;

  constructor(private readonly expiresAt = new Date('2100-01-01T00:00:00.000Z')) {}

  credentialsFor(keyspace: { project: string; env: string }): Promise<FakeCredentials> {
    this.calls += 1;
    this.lastKeyspace = { ...keyspace };
    return Promise.resolve({
      accessKeyId: 'FAKE-ACCESS-KEY-ID',
      secretAccessKey: 'FAKE-SECRET-ACCESS-KEY',
      sessionToken: 'FAKE-SESSION-TOKEN',
      expiresAt: new Date(this.expiresAt),
      toString: () => '[redacted]',
      toJSON: () => '[redacted]',
    });
  }
}
