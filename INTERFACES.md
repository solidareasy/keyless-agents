# klag interfaces (inputs and outputs)

Rules live in [SPEC.md](SPEC.md); this file is the contract that contract tests check.

## Binaries
| Binary | Runs | Talks to |
|---|---|---|
| `klag` | in a sandbox (agent) | the daemon at `KLAG_URL` (host loopback) through the sandbox proxy |
| `klag setup` | on the host | the OS (`sudo`), `tailscale`, the tailnet issuer, STS |
| `klag serve` | on the host | loopback HTTP, the operator socket, the tailnet issuer, AWS |
| `klag op …` | on the host, outside sandboxes | the operator socket (group `klag-op`) |

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
HTTP/JSON on host loopback, one object per request. The agent sends `auth`, a placeholder that the sandbox proxy replaces with the per-instance token (body or header, never the query string).

- Request: `{"v":1,"auth":"<placeholder>","op":"list|get|set","name":"…","value":"…"}` (`value` only for `set`).
- Response ok: `{"v":1,"ok":true,"names":[…]}` or `{"v":1,"ok":true,"value":"…","version":3,"scope":"agent"}`.
- Response error: `{"v":1,"ok":false,"code":"INVALID|NOT_FOUND|DENIED|RATE_LIMITED|UNAVAILABLE"}`.

A request carrying `project` or `env` returns `INVALID` (exit 1) and is audited as an anomaly. An unreplaced placeholder or unknown token returns `DENIED` and is audited with `decision: alert`.

## Setup
`klag setup [--yes] [--dry-run] [--project P] [--region R] [--role-arn ARN] [--issuer-url URL] [--tag TAG] [--skip-system]`

Idempotent; run as the operator. It calls `sudo` only for the system step and prints each command first. `--dry-run` prints every step and writes nothing; `--yes` accepts the defaults and fails instead of asking. Exit codes: `0` ok, `1` usage, `6` preflight or doctor failed.

| Step | Does | Asks |
|---|---|---|
| preflight | checks OS, Node, `tailscale`, the sandbox runtime; stops with the list of what is missing | nothing |
| system | user `klag`, group `klag-op`, directories, operator socket, service unit | the `sudo` password, to the OS |
| tailnet | prints the ACL snippet for the tag, then runs `tailscale up --advertise-tags=<tag>`; Tailscale shows its own login URL | nothing (the tailnet admin creates the tag first) |
| issuer | finds the issuer, requests a JWT, reads `sub` and `aud` | the URL, only if not found |
| aws | writes `klag-aws.yaml`, a CloudFormation template filled with issuer, `aud`, `sub`, project and env, for the administrator to upload in the AWS console | the role ARN from the stack outputs, then tests STS |
| config | writes the config with the defaults below and runs `klag op doctor` | nothing |

Defaults, used without asking: tag `tag:klag-daemon`; issuer `https://idp.<tailnet>.ts.net` (the `tsidp` default hostname); `audience` `sts.amazonaws.com`; env `dev`; `listen` `127.0.0.1:7777`; `operatorSocket` `/run/klag/op.sock`; `audit.path` `/var/lib/klag/audit.jsonl`; `policy.get` `value`; `rateLimit` 60 per minute, burst 10; KMS alias `alias/{project}-dev`. Only the **region**, the **project name** (default: the current directory name) and the **pasted role ARN** are asked. Setup never asks for or stores a credential.

## Operator CLI
| Command | Input | Output |
|---|---|---|
| `klag op list\|get\|set <project> <env> NAME` | value for `set` from stdin | as the agent CLI |
| `klag op sandbox add <sandboxId> <project> <env>` | ids | the token, printed once (pipe it into the runtime secret store); only its hash is stored |
| `klag op revoke <sandboxId>` | sandbox id | confirmation; the next request is denied |
| `klag op promote <project> NAME` | agent value to promote | shared name and version |
| `klag op delete <project> <env> NAME` | name | confirmation |
| `klag op doctor <project>` | project | checks: policy shape, prod unreachable, issuer reachable, STS exchange works |
| `klag op audit verify` | none | `ok`, or the first broken line number |

## Environment and configuration
- Agent side: `KLAG_URL`. The variable that carries the `auth` placeholder depends on the sandbox runtime (to validate).
- Daemon side: `KLAG_CONFIG` (default `/etc/klag/config.json`, root-owned and readable by the `klag` user). No AWS or Tailscale variable and no secret: the file has `awsRegion`; `auth` `{issuerUrl, audience}`; `projects[]` of `{project, env, roleArn, kmsKeyAlias}`; `listen` (loopback only); `operatorSocket`; `policy.get` (`value` or `deny`); `rateLimit` `{perMinute, burst}`; `audit.path`. The registry (hashes) lives in the `klag` user's state, not in this file.
- The tailnet node (`tailscaled`, tag) is host setup, not klag configuration.

## Daemon → outside
| Operation | Call |
|---|---|
| identity | HTTP request to the tailnet issuer for a JWT (`sub` = daemon node) |
| auth | STS `AssumeRoleWithWebIdentity` with a session policy |
| list | `ssm:GetParametersByPath` without decryption (to validate) |
| get | `ssm:GetParameter` with decryption; version returned |
| set | `ssm:PutParameter` `Type=SecureString`, project key, path forced to `/{project}/dev/agent/…` |

## Files written
Audit log (JSONL): `{ts, sandboxId, op, name, version, decision, prevHash, hash}` with `decision` `allow`, `deny` or `alert`. The daemon writes no file with a value.
