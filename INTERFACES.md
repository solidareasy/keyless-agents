# klag interfaces (inputs and outputs)

Rules live in [SPEC.md](SPEC.md); this file is the contract that contract tests check.

## Binaries
| Binary | Runs | Talks to |
|---|---|---|
| `klag` | in a sandbox (agent) | the daemon at `KLAG_URL` through the sandbox proxy |
| `klag serve` | in the daemon container (entrypoint) | its listen address, the operator socket, the tailnet issuer, AWS |
| `klag op setup`, `klag op remove-all` | on the host | `docker` (or `podman`) and files; they do not use the operator socket |
| `klag op …` (all others) | on the host, outside sandboxes | the operator socket (`KLAG_OP_SOCKET`) |

## Agent CLI
`NAME` matches `^(?!\.{1,2}$)[A-Za-z0-9_.-]{1,128}$`. Every command accepts `--json`.

| Command | Input | stdout | Exit codes |
|---|---|---|---|
| `klag list [--prefix P]` | optional prefix | one name per line, or `{"names":[{"name","scope"}]}` | 0, 3, 4, 5 |
| `klag get NAME` | name | the raw value, or `{"name","value","version","scope"}` | 0, 1, 2, 3, 4, 5 |
| `klag set NAME` | name; value from stdin or a no-echo prompt | nothing, or `{"name","version","scope"}` | 0, 1, 3, 4, 5 |
| `klag doctor` | none | checks `{id, ok, detail}`: daemon reachable, placeholder replaced | 0, 6 |

`scope` is `shared` or `agent`; `get` resolves shared first. Exit codes: `0` ok, `1` usage or invalid name, `2` not found, `3` denied, `4` rate limited, `5` daemon or AWS unavailable, `6` doctor failed. stderr carries a human message, never a value.

## Protocol (agent ↔ daemon)
HTTP/JSON, one object per request. The agent sends `auth`, a placeholder that the sandbox proxy replaces with the per-instance token (body or header, never the query string).

- Request: `{"v":1,"auth":"<placeholder>","op":"list|get|set","name":"…","value":"…"}` (`value` only for `set`).
- Response ok: `{"v":1,"ok":true,"names":[…]}` or `{"v":1,"ok":true,"value":"…","version":3,"scope":"agent"}`.
- Response error: `{"v":1,"ok":false,"code":"INVALID|NOT_FOUND|DENIED|RATE_LIMITED|UNAVAILABLE"}`.

A request carrying `project` or `env` returns `INVALID` (exit 1) and is audited as an anomaly. An unreplaced placeholder or unknown token returns `DENIED` and is audited with `decision: alert`.

## Setup
`klag op setup [--check] [--install-prereqs] [--non-interactive] [--dry-run] [--project P] [--region R] [--account-id ID] [--issuer-url URL] [--tag TAG]`

Idempotent; run as the operator, no `sudo` (only `--install-prereqs` may ask the OS package manager for it). Processes are spawned with argument arrays, never through a shell. `--check` runs only the preflight and changes nothing. `--dry-run` prints every step and writes nothing. `--non-interactive` accepts the defaults and fails instead of asking. Exit codes: `0` ok, `1` usage, `6` preflight failed, `7` waiting for the administrator (the stack is not applied yet).

| Step | Does | Asks |
|---|---|---|
| preflight | checks OS, Docker or Podman with compose, the sandbox runtime and Node; lists what is missing with the official command per OS; with `--install-prereqs` installs item by item, command shown first, never through `curl \| sh` | nothing |
| files | creates the state directory (`~/.local/share/klag`), `config.json`, `compose.yaml` and `manifest.json` | nothing |
| containers | starts the compose project (daemon and tailscale sidecar) | nothing |
| tailnet | prints the ACL snippet for the tag; the sidecar advertises the tag and setup prints the Tailscale login URL from its logs; the host's own node is never touched | nothing (the tailnet admin creates the tag first) |
| issuer | finds the issuer, requests a JWT, reads `sub` and `aud`; a missing issuer fails the preflight with the `--issuer-url` hint | nothing |
| aws | writes `klag-aws.yaml`, a CloudFormation template filled with issuer, `aud`, `sub`, project and env, for the administrator to upload in the AWS console | the 12-digit AWS account ID; setup derives the role ARN and tests STS once the stack exists |
| config | writes the final config with the defaults below; if STS fails because the stack is not applied, exits `7` and prints `klag op doctor <project>` | the region and the project name |

`--project` matches `^[a-z][a-z0-9-]{1,31}$`. Defaults, used without asking: tag `tag:klag-daemon`; issuer `https://idp.<tailnet>.ts.net` (the `tsidp` default hostname); `audience` `sts.amazonaws.com`; env `dev`; `listen` `0.0.0.0:7777` inside the container, published on host `127.0.0.1:7777`; operator socket `~/.local/share/klag/run/op.sock` (0600); `policy.get` `value`; `rateLimit` 60 per minute, burst 10; KMS alias `alias/{project}-dev`; role name `{project}-dev-agent`, so `roleArn` is `arn:aws:iam::<account id>:role/{project}-dev-agent`. Only the **region**, the **project name** (default: the current directory name) and the **AWS account ID** are asked. Setup never asks for or stores a credential.

## Remove
`klag op remove-all [--dry-run] [--purge-audit] [--yes --confirm HOST]`

Run as the operator. Idempotent. Exit codes: `0` ok, `1` usage or not confirmed (nothing removed), `6` a step failed.

1. **Warning:** lists the effects: the compose project (containers and volumes), the operator socket, the config and the manifest, the registry with its N sandbox tokens (all revoked), and whether the audit log is exported or purged.
2. **Confirmation:** the operator types the hostname, or passes `--yes --confirm HOST`. Anything else aborts and removes nothing. `--yes` alone is refused. `--dry-run` prints the warning and changes nothing.
3. **Removal:** exports the audit log from the volume to the state directory (unless `--purge-audit`), then removes each manifest entry after deleting its item; a rerun resumes.
4. **Not done, printed for the administrator:** delete the CloudFormation stack in the AWS console (it holds the role and the KMS key; deleting the stack schedules the key for deletion, after which the `SecureString` parameters written by `klag set` become unreadable; the parameters themselves stay until deleted); remove the node or the tag in the Tailscale admin console; run `sbx secret rm … --sandbox <id>` for each sandbox (commands printed).

## Operator CLI
`--env E` is optional and defaults to `dev`; it accepts only environments listed in the config. Prod is never configured: setup and the daemon refuse an environment named `prod`.

| Command | Input | Output |
|---|---|---|
| `klag op list\|get\|set <project> NAME [--env E]` | value for `set` from stdin | as the agent CLI |
| `klag op sandbox add <sandboxId> <project> [--env E]` | ids | the token, printed once (pipe it into the runtime secret store); only its hash is stored |
| `klag op sandbox revoke <sandboxId>` | sandbox id | confirmation; the next request is denied |
| `klag op sandbox list` | none | sandbox id, project, env, created at (never the token) |
| `klag op promote <project> NAME [--env E]` | agent value to promote | shared name and version |
| `klag op delete <project> NAME [--env E]` | name | confirmation |
| `klag op doctor <project>` | project | checks: policy shape, prod unreachable, issuer reachable, issuer unreachable from inside a sandbox, STS exchange works |
| `klag op audit verify` | none | `ok`, or the first broken line number (the daemon reads the log) |

## Environment and configuration
- Agent side: `KLAG_URL`, the name under which the sandbox sees the daemon through the proxy (to validate). The variable that carries the `auth` placeholder depends on the sandbox runtime (to validate).
- Operator side: `KLAG_OP_SOCKET` (default `~/.local/share/klag/run/op.sock`).
- Daemon side: `KLAG_CONFIG` (default `/etc/klag/config.json` inside the container, mounted read-only from the state directory). No AWS or Tailscale variable and no secret: the file has `awsRegion`; `auth` `{issuerUrl, audience}`; `projects[]` of `{project, env, roleArn, kmsKeyAlias}`; `listen` (the daemon's bind inside the container, never the tailnet interface); `operatorSocket`; `policy.get` (`value` or `deny`); `rateLimit` `{perMinute, burst}`; `audit.path`. The registry (hashes) and the audit log live in the daemon's volume.
- The tailnet node belongs to the tailscale sidecar, not to klag configuration.

## Daemon → outside
| Operation | Call |
|---|---|
| identity | HTTP request to the tailnet issuer for a JWT (`sub` = daemon node) |
| auth | STS `AssumeRoleWithWebIdentity` with a session policy |
| list | `ssm:GetParametersByPath` without decryption (to validate) |
| get | `ssm:GetParameter` with decryption; version returned |
| set | `ssm:PutParameter` `Type=SecureString`, project key, path forced to `/{project}/dev/agent/…` |

## Files written
Audit log (JSONL, in the daemon's volume): `{ts, sandboxId, op, name, version, decision, prevHash, hash}` with `decision` `allow`, `deny` or `alert`. The daemon writes no file with a value. Setup writes the state directory (`config.json`, `compose.yaml`, `klag-aws.yaml`, `manifest.json`).
