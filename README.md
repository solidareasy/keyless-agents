# keyless-agents (`klag`)

Zero-trust secrets for AI coding agents. Agents run in per-project sandboxes and read or write secrets only inside an AWS Parameter Store keyspace. No static cloud keys on the machine or in the repo.

```sh
klag list                 # names only (no values)
klag get  DATABASE_URL    # value, only if the keyspace policy allows it
klag set  API_TOKEN       # value from stdin or prompt, never from argv
```

Setup (prerequisites: a tailnet with an OIDC issuer, an AWS administrator, Docker or Podman with compose, a sandbox runtime):

```sh
npx klag op setup --check   # lists what is missing, changes nothing
npx klag op setup           # daemon container, tailnet node, AWS template, config
```

Status: draft v4. Design: [SPEC.md](SPEC.md). Requirements and tests: [REQUIREMENTS.md](REQUIREMENTS.md). Inputs and outputs: [INTERFACES.md](INTERFACES.md). License: MIT.

## Development

Use Node 22+ and pnpm 10.28.0.

```sh
pnpm install
pnpm check
```

## Tests

`pnpm test` runs the unit, contract and integration tests with coverage.
The process e2e suite runs separately. Build first with
`pnpm build`, then run `pnpm test:e2e` to run only the process e2e suite without
coverage. It starts a real daemon with the in-memory store and invokes the built
CLI over HTTP; it needs no AWS account, Docker or sandbox runtime.

## Releasing

A tag `vX.Y.Z` triggers `cd.yml`, which validates the package, checks that the tag
matches `package.json`, and runs
`npm publish --provenance --access public --dry-run --ignore-scripts`.
The publish job uses GitHub OIDC trusted publishing and the `npm-publish`
environment. npm is pinned to 11.5.1, the minimum version required for trusted
publishing.

Real publication requires the owner to configure the trusted publisher on npmjs
for repository `solidareasy/keyless-agents`, workflow `cd.yml`, environment
`npm-publish`, then remove `--dry-run` through a PR. If npm requires an existing
package to configure trusted publishing, the owner must publish the first version
manually. Until then, the workflow runs only the dry run.

## Try it locally with the in-memory store

Build with `pnpm build` and use `klag` from the built `dist/cli/main.js` entrypoint.
Create a `local` directory and save this as `local/config.json`:

```json
{
  "awsRegion": "canary-region",
  "auth": { "issuerUrl": "https://issuer.example.invalid", "audience": "sts.amazonaws.com" },
  "projects": [
    { "project": "alpha", "env": "dev", "roleArn": "canary-role", "kmsKeyAlias": "alias/alpha-dev" }
  ],
  "listen": "127.0.0.1:7777",
  "operatorSocket": "./local/op.sock",
  "policy": { "get": "value" },
  "rateLimit": { "perMinute": 60, "burst": 10 },
  "audit": { "path": "./local/audit.jsonl" },
  "store": "memory"
}
```

The daemon derives `local/registry.json` from the audit directory. Save the following
fixture there with file permissions `0600`; its hash is SHA-256 of the public test
token `canary-local-auth`. This fixture replaces sandbox registration only for this
local demonstration; the operator CLI is not implemented in this wave.

```json
[
  {
    "sandboxId": "canary-local",
    "project": "alpha",
    "env": "dev",
    "createdAt": "2026-01-01T00:00:00.000Z",
    "tokenHash": "262712a6484f95530b477733729b0956d5a8e89a7a5035edae8d47e4903e6a7d"
  }
]
```

Run the first command in one terminal, then the other two in another terminal:

```sh
KLAG_CONFIG=./local/config.json klag serve
printf '%s' 'canary-local-value' | KLAG_URL=http://127.0.0.1:7777 KLAG_AUTH=canary-local-auth klag set DEMO
KLAG_URL=http://127.0.0.1:7777 KLAG_AUTH=canary-local-auth klag get DEMO
```

`set` prints nothing; `get` prints exactly `canary-local-value`. Values disappear
when the daemon stops; the registry and audit remain on disk. The explicit
`store: "memory"` configuration selects the fake adapter; without it startup fails
with `AWS adapter not available yet`.
