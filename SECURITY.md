# Security policy

## Supported versions

Security fixes target `main`. This project is currently a scaffold; no released version is supported.
The agent CLI (`klag list`, `get`, `set`, `doctor`, `serve`) is implemented and handles sandbox
tokens and secret values; reports about that surface are in scope. The operator CLI (`klag op ...`)
is not implemented yet.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/solidareasy/keyless-agents/security/advisories/new).
Do not open a public issue containing sensitive details. Include the affected commit, expected and
observed behavior, and reproduction steps using synthetic data only. Never include real credentials,
tokens, secret values, account identifiers, or private audit records.

We aim to acknowledge reports within five business days and provide an initial assessment within ten
business days. We will coordinate remediation and public disclosure with the reporter through the
private advisory.

## What counts as a vulnerability

- A secret value reaches command arguments, logs, errors, stack traces, process titles, or audit data.
- A sandbox reads or writes another project or environment's keyspace, or reaches production values.
- A request bypasses the sandbox registry, uses a revoked token, or accepts an unreplaced placeholder.
- An untrusted process obtains operator access or the daemon's cloud identity.
- A supply chain change bypasses the project's required security checks.

The trust boundaries and required controls are described in [the threat model](docs/threat-model.md).
For a suspected development secret leak, follow [the response runbook](docs/runbook-dev-leak.md).
