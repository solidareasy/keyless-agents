# Threat model

This document implements the documentation requirement M15 and follows SPEC §2. The current wave
ships the agent CLI (`klag list`, `get`, `set`, `doctor`, `serve`), the daemon with the in-memory
store, and development quality gates; the operator CLI (`klag op ...`) and the AWS adapter are not
implemented yet. Runtime controls below are requirements, not claims that every one of them is
already enforced; the agent CLI already handles sandbox tokens and secret values and is in scope.

## Actors and trust

| Actor              | Trust and authority                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| Agent              | Untrusted and potentially prompt-injected; runs inside one project-environment sandbox.        |
| Operator           | Trusted and outside sandboxes; owns infrastructure, registers sandboxes, and promotes values.  |
| Production runtime | Trusted service role in a separate AWS account; reads production directly and never uses klag. |

A sandbox holds no AWS identity and never joins the tailnet. Its agent can see development values
returned by an allowed `get`; development credentials must therefore be scoped, revocable, and
rotatable. A sandbox serves one project-environment keyspace, including its worktrees.

## Assets and boundaries

Assets include development secret values, registry token hashes and their keyspace bindings, the
daemon's OIDC identity and temporary AWS credentials, operator socket access, and audit integrity.
Production values belong to a separate account and must remain unreachable from development.

1. **Sandbox → host proxy:** the agent supplies an auth placeholder. The proxy substitutes a token
   specific to that sandbox; the agent never sees the token. Sandbox network policy denies the issuer
   and tailnet ranges.
2. **Proxy → daemon:** the registry alone determines project, environment, and sandbox identity.
   The HTTP hop is confined to the sandbox network; daemon publishing is host-loopback only.
3. **Operator → daemon:** a mode-0600 socket in an operator-owned directory authenticates local
   operator access. Docker-group membership grants operator-equivalent access.
4. **Daemon → issuer → AWS:** the daemon container has its own tailnet node. Its JWT is exchanged
   with STS using exact subject/audience trust and a restrictive session policy. Temporary credentials
   access only the registered development keyspace.
5. **Daemon → storage:** the daemon alone appends value-free audit records to its volume. Registry
   storage contains token hashes; SSM stores values as SecureString under the project KMS key.

## Threats and required controls

| Threat                                                                 | Required control                                                                                                                                                          | Requirements           |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Injected agent chooses another keyspace or tampers with a payload      | Derive identity only from registry; reject and audit supplied project/env; normalize names.                                                                               | M1, M2, M8, M16        |
| Agent overwrites shared values, deletes secrets, or reaches production | Write only agent scope; resolve shared first; IAM boundary and explicit denies; separate production account.                                                              | M2, M3, M6, M11        |
| Agent enumerates or exfiltrates secrets                                | List only names/scopes; get policy; per-sandbox limits and sweep alerts; values never logged.                                                                             | M4, M5, M7, M10        |
| Agent forges identity, replays a revoked token, or reaches the issuer  | Random token printed once, store hash only, revoke immediately, fail closed on unknown/placeholder auth; sandbox network checks.                                          | M10, M12, M17, M18     |
| Careless operator exposes a value or weakens infrastructure            | Stdin/no-echo input, sanitized errors, doctor checks, credential-free setup, confirmed manifest-only removal.                                                             | M7, M12, M20, M21, M22 |
| Compromised host steals operator authority or daemon identity          | Host operators remain trusted; container hardening and a separate daemon node limit exposure but cannot defend against a hostile operator or host root.                   | M13, M18; premise P8   |
| Attacker alters local audit records or hides activity                  | Mode-0600 hash-chained audit with verification; correlate independently with AWS CloudTrail. Off-host anchoring remains future work.                                      | M9; good-to-have G4    |
| Compromised build dependency or workflow changes shipped code          | Exact dev dependencies, lockfile, no runtime dependencies, SHA-pinned Actions, typed lint and tested coverage gates. Trusted publishing is required for a future release. | M14                    |

No fallback to static AWS keys or profiles is permitted. The real issuer/STS/sidecar spike (M19) must
succeed before daemon implementation. Until real sandboxes are registered, the daemon must serve
nobody (P8).

## Scope and residual risks

Sandbox egress control belongs to the sandbox runtime: an agent allowed to read a development value
can send it wherever that network permits. Restricting such egress is outside klag's scope.
Production access and credential management belong to the production runtime and administrators;
klag has no production code path. Development roles must still be tested to deny production access.

A compromised operator, host root, or Docker administrator can control the daemon and is outside the
agent isolation guarantee. Burnable development credentials require revocation and rotation after a
suspected leak; the [runbook](runbook-dev-leak.md) describes that response. Hash chaining alone cannot
detect a fully rewritten log without an independent anchor; CloudTrail provides a separate record.
