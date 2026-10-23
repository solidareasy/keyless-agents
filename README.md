# keyless-agents (`klag`)

Zero-trust secrets for AI coding agents. Agents run in per-project sandboxes and read or write secrets only inside an AWS Parameter Store keyspace. No static cloud keys on the machine or in the repo.

```sh
klag list                 # names only, always safe
klag get  DATABASE_URL    # value, only if the keyspace policy allows it
klag set  API_TOKEN       # value from stdin or prompt, never from argv
```

Status: draft, under active design. See [SPEC.md](SPEC.md). License: MIT.
