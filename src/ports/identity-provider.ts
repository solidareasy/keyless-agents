export type Credentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiresAt: Date;
};

export interface IdentityProvider {
  credentialsFor(keyspace: { project: string; env: string }): Promise<Credentials>;
}
