# keyless-agents specification (draft)

Package `keyless-agents`, command `kla`, TypeScript, MIT.

## Goal
Let coding agents work with the credentials a project needs without trusting the agent with more than its keyspace, and without static AWS or provider keys on disk, in git, or in CI secrets.

## Model
- **Keyspace**: `/<project>/<env>/*` in AWS SSM Parameter Store (SecureString, one KMS key per project). `env` is `dev` or `prod`.
- **Three operations**: `list` (names only), `get` (value), `set` (write). All go through one policy engine.
- **Policy per keyspace and caller**:
  - `list`: `allow` | `deny`
  - `get`: `value` (agent receives the value) | `inject` (value reaches the process or network proxy, never the agent) | `deny`
  - `set`: `allow` | `deny`
  Defaults for agents: `dev` = list allow, get value, set allow; `prod` = everything deny. Prod values are read only by the production runtime role.
- **Honest limit**: with `get: value` the agent sees the value. Use it only for scoped dev credentials. Third-party API keys go through `inject` (sandbox network proxy), so the agent sees a placeholder.

## Architecture
1. **Host daemon** (`kla serve`) holds the AWS session (OIDC web identity or a local profile). It never enters the sandbox.
2. **Sandbox** (per project-env, microVM or container) gets a short-lived token scoped to one keyspace and talks to the daemon over a local socket.
3. **Daemon** enforces the policy, calls Parameter Store with a role limited to that keyspace, and writes an audit log with names and decisions, never values.
4. **Infra as code**: an AWS CDK construct creates the OIDC provider, one role per project-env (`ssm:GetParameter*`, `PutParameter`, `DescribeParameters` on the keyspace path; `kms:Decrypt` and `GenerateDataKey` on the project key), and the KMS key. Machine setup (sandbox runtime, network identity, profile) is done with Ansible. No secrets in either.

## Rules
- Values never appear in argv, logs, error messages, the workspace, or the audit log.
- `set` reads the value from stdin or a prompt.
- Every request is checked against the keyspace, not against the caller's claim.
- TDD, 100% coverage on the policy engine, no `process.env` reads outside the config module.

## CLI
`kla list [--env dev|prod] [--json]`, `kla get NAME [--env] [--reveal]`, `kla set NAME [--env]`, `kla serve`, `kla run -- <cmd>` (loads env for one command without writing a file).

## Milestones
M0 scaffold and CI. M1 policy engine. M2 SSM adapter. M3 CLI `get/set/list`. M4 daemon and sandbox integration. M5 CDK construct. M6 docs and npm release with provenance.

## Open questions
Sandbox runtime integration, how the token is bound to one sandbox, Linux support level of the chosen sandbox runtime, and the npm trusted-publishing setup.
