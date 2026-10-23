# klag requirements

Design: [SPEC.md](SPEC.md) (§ points there). Inputs and outputs: [INTERFACES.md](INTERFACES.md). Each requirement has one ID and one test level.

## Premises
- **P1** Agents are untrusted and may be prompt-injected.
- **P2** Dev and prod live in separate AWS accounts.
- **P3** The sandbox runtime scopes a secret to one sandbox and its proxy substitutes it into requests; one sandbox serves one project-env with many worktrees (to validate, SPEC §10).
- **P4** No static AWS keys: the daemon's node authenticates through a tailnet OIDC issuer. There is no fallback.
- **P5** Dev secrets are burnable: scoped, revocable, rotated after a suspected leak.
- **P6** Agents see dev values; prod is never visible to agents.
- **P7** Node 22+, pnpm, TypeScript strict, TDD (red, green, refactor).
- **P8** The daemon serves only a registered sandbox of the real runtime. No transition mode; until agents run in sandboxes, dev uses the current flow. Host processes are outside the trust model.
- **P9** A human provides once: a tailnet with an OIDC issuer reachable by AWS, an AWS administrator who applies the template with their own access, Docker or Podman with compose, and an installed sandbox runtime. `klag op setup --check` lists what is missing; installing is opt-in.

## Must have (MVP)
| ID | Requirement | SPEC | Test level |
|---|---|---|---|
| M1 | Keyspace comes from the registry; `project`/`env` in a payload is `INVALID` and audited | §4 | unit, property |
| M2 | Project-env A cannot read or write project-env B; an agent value never shadows a shared one | §4,§5 | integration, e2e (two real sandboxes) |
| M3 | Prod unreachable from dev: separate account, trust without any dev principal, explicit Deny on prod paths | §5,§6 | template assertions, IAM simulator |
| M4 | `list` returns names and scopes only | §5 | unit, canary |
| M5 | `get` returns the value only when the policy allows; otherwise deny | §5 | unit |
| M6 | `set` writes only under `/{project}/dev/agent/*`, `SecureString` enforced by the daemon, value from stdin or prompt, no delete | §5,§6 | unit, IAM simulator |
| M7 | No value in argv, logs, errors, stack traces, process title or audit | §8 | canary secret test |
| M8 | Name normalization: reject `..`, `/`, `*`, empty, oversized, unexpected characters; `aws*` and `ssm*` reserved | §5 | property/fuzz |
| M9 | Audit log hash-chained, written only by the daemon (0600), never contains values; `op audit verify` works through the operator socket | §7 | unit, tamper test |
| M10 | Rate limit per sandbox; `op sandbox revoke` denies the next request | §7 | integration |
| M11 | The infra template creates role, boundary, KMS key per project-env and the issuer trust with exact `aud`/`sub` | §6 | template assertions, simulator |
| M12 | `klag op doctor` fails if a role reaches prod, a policy deviates, the issuer is unreachable, the issuer is reachable from inside a sandbox, or the STS exchange fails; `klag doctor` checks reachability and placeholder replacement | §4,§6 | integration |
| M13 | The daemon container is non-root with read-only filesystem, no capabilities, `no-new-privileges`, no core dumps and no Docker socket; it binds only the bridge interface and publishes on host loopback; the operator socket is 0600 in an operator-owned directory | §4,§8 | integration, compose assertions |
| M14 | Release by npm trusted publishing with provenance; lockfile, exact deps, SHA-pinned Actions | §9 | CI check |
| M15 | Written threat model and a dev-leak runbook | §2 | review |
| M16 | CLI, protocol and config follow INTERFACES.md: exit codes, JSON shapes, error codes | INTERFACES | contract tests |
| M17 | `op sandbox add` prints the token once and stores only its hash; an unreplaced placeholder or unknown token is `DENIED` with `decision: alert` | §4 | integration, canary |
| M18 | AWS access only by `AssumeRoleWithWebIdentity` with the tailnet-issued JWT and a session policy; no static key or profile path exists in the code | §6 | contract test on config, integration |
| M19 | Spike report before the daemon work: issuer reachable by STS, role trust pinned to the daemon node, sidecar login and bind validated; a failure goes back to the owner | §6,§10 | documented spike |
| M20 | `klag op setup` is idempotent, needs no `sudo`, never builds a shell command from input (argument arrays; project matches `^[a-z][a-z0-9-]{1,31}$`), never asks for or stores a credential, supports `--check`, `--dry-run` and `--non-interactive`, and exits `7` with the doctor command when the stack is not applied | §3.2 | integration on a clean host (see Test strategy), dry-run snapshot |
| M21 | Setup defaults follow INTERFACES.md; exactly three prompts (region, project name, AWS account ID); a missing issuer fails the preflight, it is never a fourth prompt | §3.2 | contract test with a scripted stdin |
| M22 | `klag op remove-all` prints every effect first, needs the typed hostname (or `--yes --confirm HOST`; `--yes` alone is refused), supports `--dry-run`, removes only manifest entries and resumes after a failure, exports the audit log unless `--purge-audit`, is idempotent and never touches AWS, Tailscale or the sandbox runtime | §3.3 | integration on a clean host, negative test: no confirmation removes nothing |

## Good to have
- **G1** `inject`: the value reaches the process or the sandbox proxy without reaching the agent.
- **G2** `klag run -- <cmd>`: env for one command without a file (a child env is readable by the same uid; prefer a pipe).
- **G3** Operator tools `history`, `rollback`, `rotate`.
- **G4** Off-host anchor for the audit chain, CloudTrail correlation, external alert delivery.
- **G5** Egress allowlist helper for supported sandbox runtimes.
- **G6** Mutation testing on the policy engine.
- **G7** Secrets Manager adapter (rotation).
- **G8** A host-service mode (dedicated user and systemd) as an alternative to compose.

## Test strategy
| Level | Covers | Tooling |
|---|---|---|
| Unit | policy engine, normalization, audit chain, rate limiter, registry | vitest |
| Property/fuzz | names, keyspace mapping, payload tampering, project names with `;` and spaces | fast-check |
| IAM simulator | allowed and denied actions per role, prod unreachable | AWS policy simulator on the rendered template |
| Integration | two sandboxes, token birth and revoke, rate limit, hardening, socket permissions | local daemon with test tokens |
| Clean host | `op setup` and `op remove-all` | an ephemeral container with shims on `PATH` for `docker`, `sbx` and the package manager that log every call, a local OIDC issuer (JWKS and token) and STS simulated at the SDK; the real Docker, tailnet and sandbox only in the opt-in e2e |
| E2E (opt-in) | real sandbox runtime and a dev AWS account | scheduled CI, never on forks |
| Canary | a known fake secret must not appear in any output or file | harness scans stdout, stderr, logs, audit, argv |

Every Deny and every "not found" has a negative test. Concrete checks: M20 dry-run leaves an empty filesystem diff and the printed command list equals the shim's log; M21 counts exactly three prompts; M22 with a wrong hostname, no confirmation or `--yes` alone exits `1` with an empty diff, a pre-existing container survives, and a failure injected mid-removal is resumed by a rerun.

## Quality gates (CI, all required)
1. Lint, strict typecheck, formatting.
2. 100% unit coverage on the policy engine and the audit chain; no coverage ignores or `.skip`.
3. Property and canary tests green.
4. IAM simulator suite green on the rendered template.
5. Secret scanning and `npm audit` clean; Actions pinned by SHA.
6. Each gate proven to fail once (force the failure, require a non-zero exit) before it is trusted.
7. Release only from main through trusted publishing with provenance.

## MVP definition of done
All Must IDs green in CI, SPEC §10 resolved or marked best effort in the README, and one real dev keyspace served end to end to a sandboxed agent.
