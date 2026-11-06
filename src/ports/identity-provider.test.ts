import { expectTypeOf, it } from 'vitest';
import type { Credentials, IdentityProvider } from './identity-provider.js';

it('defines keyspace-scoped credentials with an expiry', () => {
  expectTypeOf<Credentials>().toEqualTypeOf<{
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
    expiresAt: Date;
  }>();
  expectTypeOf<Parameters<IdentityProvider['credentialsFor']>>().toEqualTypeOf<
    [{ project: string; env: string }]
  >();
  expectTypeOf<ReturnType<IdentityProvider['credentialsFor']>>().toEqualTypeOf<
    Promise<Credentials>
  >();
});
