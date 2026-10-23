# klag interfaces (inputs and outputs)

Rules and rationale live in [SPEC.md](SPEC.md); this file is the contract that contract tests check.

## Binaries
| Binary | Runs | Talks to |
|---|---|---|
| `klag` | inside a sandbox (agent) | the sandbox channel (`KLAG_CHANNEL`: socket path or vsock address) |
| `klag serve` | on the host | the sandbox channels, the operator channel, AWS |
| `klag op …` | on the host, outside sandboxes | the operator channel |

## Agent CLI
`NAME` matches `^[A-Za-z0-9_.-]{1,128}$`. Every command accepts `--json`.

| Command | Input | stdout | Exit codes |
|---|---|---|---|
| `klag list [--prefix P]` | optional prefix | one name per line, or `{"names":[…]}` | 0, 3, 4, 5 |
| `klag get NAME [--scope auto\|task\|project]` | name | the raw value, or `{"name","value","version","scope"}` | 0, 2, 3, 4, 5 |
| `klag set NAME [--scope project\|task]` | name; value from stdin or a no-echo prompt | nothing, or `{"name","version","scope"}` | 0, 1, 3, 4, 5 |
| `klag doctor` | none | JSON list of checks `{id, ok, detail}` | 0, 6 |

Exit codes: `0` ok, `1` usage or invalid name, `2` not found, `3` denied, `4` rate limited, `5` daemon or AWS unavailable, `6` doctor check failed. stderr carries a human message and never a value. `get --scope auto` resolves shared, then task, then project (SPEC §5). Optional `KLAG_TASK_ID` is sent as an advisory label.

## Channel protocol (agent ↔ daemon)
One JSON object per line, UTF-8.

Request: `{"v":1,"op":"list|get|set","name":"…","scope":"auto|task|project","taskId":"…","value":"…"}` (`value` only for `set`).
Response ok: `{"v":1,"ok":true,"names":[…]}` or `{"v":1,"ok":true,"value":"…","version":3,"scope":"project"}`.
Response error: `{"v":1,"ok":false,"code":"INVALID_NAME|NOT_FOUND|DENIED|RATE_LIMITED|UNAVAILABLE"}`.
Any `project` or `env` field in a request is ignored and logged as an anomaly. `--env prod` maps to `NOT_FOUND`.

## Operator CLI
| Command | Input | Output |
|---|---|---|
| `klag op list\|get\|set <project> <env> NAME` | project, env, name (value for set from stdin) | as the agent CLI |
| `klag op promote <project> NAME` | agent value to promote | new shared name and version |
| `klag op delete <project> <env> NAME` | name | confirmation |
| `klag op revoke <sandboxId>` | sandbox id | confirmation; the channel closes at once |
| `klag op gc <project> <taskId>` | task id | number of task-scope parameters removed |
| `klag op audit verify` | none | `ok`, or the first broken line number |

## Daemon configuration
JSON file at `KLAG_CONFIG` (default `~/.config/klag/config.json`). It holds no secrets.
`awsRegion`; `oidc.tokenFile` (a path); `projects[]` with `{project, env, roleArn, kmsKeyAlias}`; `sandboxes[]` with `{sandboxId, project, env, channel}`; `policy.get` (`value` or `deny`); `rateLimit` `{perMinute, burst}`; `audit.path`.

## Daemon → AWS
| Operation | Call | Notes |
|---|---|---|
| list | `ssm:GetParametersByPath` (no decryption) | values never decrypted for `list` (to validate) |
| get | `ssm:GetParameter` with decryption | version returned to the caller |
| set | `ssm:PutParameter` `Type=SecureString`, project key | path forced to `/p/dev/agent/…` |
| auth | STS `AssumeRoleWithWebIdentity` with a session policy | role from the project entry |

## Files written
Audit log, JSONL: `{ts, sandboxId, taskId, op, name, version, decision, prevHash, hash}`. The daemon writes no file that contains a value.
