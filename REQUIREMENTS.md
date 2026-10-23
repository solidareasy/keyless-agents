# klag requirements

Design lives in [SPEC.md](SPEC.md) (§ points there); inputs and outputs in [INTERFACES.md](INTERFACES.md). Each requirement has one ID, one test level and no duplicate in another section.

## Premises
- **P1** Agents are untrusted and may be prompt-injected.
- **P2** Dev and prod live in separate AWS accounts.
- **P3** The sandbox runtime gives each sandbox its own channel to the host, and one sandbox serves one project-env with many worktrees (to validate, SPEC §10).
- **P4** Machines authenticate to AWS with OIDC web identity or a local profile; CI uses GitHub OIDC. No static keys.
- **P5** Dev secrets are burnable: scoped, revocable, rotated after any suspected leak.
- **P6** The owner accepts that agents see dev values (`get: value`). Prod is never visible to agents.
- **P7** Node 22+, pnpm, TypeScript strict, TDD (red, green, refactor).

## Must have (MVP)
| ID | Requirement | SPEC | Test level |
|---|---|---|---|
| M1 | Keyspace comes from the registry; `project`/`env` in a payload are ignored and logged | §4 | unit, property |
| M2 | Project-env A cannot read or write project-env B; an agent value never shadows a shared value | §4,§5 | integration (two sandboxes), unit |
| M3 | Prod is unreachable from dev: separate account, explicit Deny, `--env prod` equals "not found" | §5,§6 | IAM policy simulator, e2e |
| M4 | `list` returns names only | §5 | unit, canary |
| M5 | `get` returns the value only when the policy allows; otherwise deny | §5 | unit |
| M6 | `set` writes only under `/p/dev/agent/*` or `/p/dev/agent/tasks/<taskId>/*`, as `SecureString`, value from stdin or prompt, no delete | §5,§6 | unit, IAM simulator |
| M7 | No value in argv, logs, errors, stack traces, process title or audit | §8 | canary secret test |
| M8 | Name normalization: reject `..`, `/`, `*`, empty, oversized, unexpected characters | §4 | property/fuzz |
| M9 | Audit log is hash-chained, daemon-owned 0600, never contains values | §7 | unit, tamper test |
| M10 | Rate limit per sandbox; `revoke` kills access immediately | §7 | integration |
| M11 | CDK construct creates role, boundary, KMS key per project-env and OIDC trust with exact `aud`/`sub` | §6 | CDK assertions, simulator |
| M12 | `klag doctor` fails if a role can reach prod or its policy deviates from the expected shape | §6 | integration |
| M13 | Daemon unprivileged, socket 0600, no core dumps | §8 | integration |
| M14 | Release via npm trusted publishing with provenance; lockfile, exact deps, SHA-pinned Actions | §9 | CI check |
| M15 | Written threat model and a dev-leak runbook | §2 | review |
| M16 | CLI, channel and config follow INTERFACES.md: exit codes, JSON shapes, error codes | INTERFACES | contract tests |

## Good to have
- **G1** `inject`: value reaches the process or the sandbox network proxy without reaching the agent.
- **G2** `klag run -- <cmd>` loads env for one command without writing a file (values in a child env are readable by the same uid; prefer a pipe).
- **G3** Operator tools: `promote`, `history`, `rollback`, `rotate`.
- **G4** Off-host anchor for the audit chain and CloudTrail correlation.
- **G5** Egress allowlist helper for supported sandbox runtimes.
- **G6** Mutation testing on the policy engine.
- **G7** Secrets Manager adapter (rotation).
- **G8** `klag op gc` and automatic expiry of task-scope parameters (SSM advanced-tier expiration policies, to validate).
- **G9** `isolate: task` per-worktree sandboxes.

## Test strategy
| Level | Covers | Tooling |
|---|---|---|
| Unit | policy engine, normalization, audit chain, rate limiter | vitest |
| Property/fuzz | names, keyspace mapping, payload tampering | fast-check |
| IAM simulator | allowed and denied actions per role, prod unreachable | AWS policy simulator on the synthesized template |
| Integration | two sandboxes, revoke, rate limit, daemon hardening | local daemon with test channels |
| E2E (opt-in) | real sandbox runtime and a dev AWS account | scheduled CI, never on forks |
| Canary | a known fake secret must not appear in any output or file | harness scans stdout, stderr, logs, audit, argv |

Negative tests are mandatory: every Deny and every "not found" has a test that proves it.

## Quality gates (CI, all required)
1. Lint, strict typecheck, formatting.
2. Unit coverage 100% on the policy engine and the audit chain; no coverage ignores or `.skip`.
3. Property tests and canary tests green.
4. IAM simulator suite green on the synthesized CDK template.
5. Secret scanning and `npm audit` clean; Actions pinned by SHA.
6. Each gate has been proven to fail once (force the failure, require a non-zero exit) before it is trusted.
7. Release only from the main branch through trusted publishing with provenance.

## MVP definition of done
All Must IDs green in CI, SPEC §10 items resolved or marked best effort in the README, and one real dev keyspace served end to end to a sandboxed agent.
