# klag interfaces (inputs and outputs)

Rules and rationale live in [SPEC.md](SPEC.md); this file is the contract that contract tests check.

## Binaries
| Binary | Runs | Talks to |
|---|---|---|
| `klag` | inside a sandbox (agent) | the daemon URL (`KLAG_URL`, host loopback) through the sandbox proxy |
| `klag serve` | on the host | loopback HTTP, the operator socket, AWS |
| `klag op …` | on the host, outside sandboxes | the operator socket (group `klag-op`) |

## Agent CLI
`NAME` matches `^(?!\.{1,2}$)[A-Za-z0-9_.-]{1,128}$`. Every command accepts `--json`.

| Command | Input | stdout | Exit codes |
|---|---|---|---|
| `klag list [--prefix P]` | optional prefix | one name per line, or `{"names":[{"name","scope"}]}` | 0, 3, 4, 5 |
| `klag get NAME [--scope auto\|task\|project]` | name | the raw value, or `{"name","value","version","scope"}` | 0, 1, 2, 3, 4, 5 |
| `klag set NAME [--scope project\|task]` | name; value from stdin or a no-echo prompt | nothing, or `{"name","version","scope"}` | 0, 1, 3, 4, 5 |
| `klag doctor` | none | JSON list of checks `{id, ok, detail}`: daemon reachable, placeholder replaced, version | 0, 6 |

Exit codes: `0` ok, `1` usage or invalid name, `2` not found, `3` denied, `4` rate limited, `5` daemon or AWS unavailable, `6` doctor check failed. stderr carries a human message and never a value. `get --scope auto` resolves shared, then task, then project (SPEC §5). Optional `KLAG_TASK_ID` is sent as an advisory label.

## Protocol (agent ↔ daemon)
HTTP/JSON on host loopback, one object per request, UTF-8. The agent sends `auth`, a placeholder that the sandbox proxy replaces with the per-instance token, in the body or a header, never in the query string.

Request: `{"v":1,"auth":"<placeholder>","op":"list|get|set","name":"…","scope":"auto|task|project","taskId":"…","value":"…"}` (`value` only for `set`).
Response ok: `{"v":1,"ok":true,"names":[…]}` or `{"v":1,"ok":true,"value":"…","version":3,"scope":"project"}`.
Response error: `{"v":1,"ok":false,"code":"INVALID|NOT_FOUND|DENIED|RATE_LIMITED|UNAVAILABLE"}`.
A request carrying `project` or `env` returns `INVALID` (exit 1) and is audited as an anomaly. An unreplaced placeholder or an unknown token returns `DENIED` and is audited with `decision: alert`.

## Operator CLI
| Command | Input | Output |
|---|---|---|
| `klag op list\|get\|set <project> <env> NAME` | project, env, name (value for set from stdin) | as the agent CLI |
| `klag op promote <project> NAME` | agent value to promote | new shared name and version |
| `klag op delete <project> <env> NAME` | name | confirmation |
| `klag op sandbox add <sandboxId> <project> <env>` | ids | the per-instance token, printed once (pipe it into the runtime secret store); only its hash is stored |
| `klag op revoke <sandboxId>` | sandbox id | confirmation; the next request is denied |
| `klag op doctor <project>` | project | JSON checks: policy shape, prod unreachable |
| `klag op gc <project> <taskId>` | task id | number of task-scope parameters removed |
| `klag op audit verify` | none | `ok`, or the first broken line number |

## Daemon configuration
JSON file at `KLAG_CONFIG` (default `~/.config/klag/config.json`). It holds no secrets.
`awsRegion`; `auth` `{type: "profile"|"webIdentity", profile or tokenFile (a path)}`; `projects[]` with `{project, env, roleArn, kmsKeyAlias}`; `listen` (loopback only); `operatorSocket`; `policy.get` (`value` or `deny`); `rateLimit` `{perMinute, burst}`; `audit.path`. The sandbox registry (hashes) lives in the `klag` user's state, not in this file.

## Daemon → AWS
| Operation | Call | Notes |
|---|---|---|
| list | `ssm:GetParametersByPath` (no decryption) | values never decrypted for `list` (to validate) |
| get | `ssm:GetParameter` with decryption | version returned to the caller |
| set | `ssm:PutParameter` `Type=SecureString`, project key | path forced to `/{project}/dev/agent/…` |
| auth | STS `AssumeRoleWithWebIdentity` (tailnet issuer, or GitHub OIDC in CI); `AssumeRole` only in the profile fallback; always with a session policy | role from the project entry |

## Files written
Audit log, JSONL: `{ts, sandboxId, taskId, op, name, version, decision, prevHash, hash}`. `decision` is `allow`, `deny` or `alert`. The daemon writes no file that contains a value.
