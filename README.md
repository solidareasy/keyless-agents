# keyless-agents (`klag`)

Zero-trust secrets for AI coding agents. Agents run in per-project sandboxes and read or write secrets only inside an AWS Parameter Store keyspace. No static cloud keys on the machine or in the repo.

```sh
klag list                 # names only (no values)
klag get  DATABASE_URL    # value, only if the keyspace policy allows it
klag set  API_TOKEN       # value from stdin or prompt, never from argv
```

Setup on a fresh host (prerequisites: a tailnet with an OIDC issuer, an AWS administrator, a sandbox runtime):

```sh
klag setup   # user, socket, tailnet tag, AWS template, config; ends with a health check
```

Status: draft v3. Design: [SPEC.md](SPEC.md). Requirements and tests: [REQUIREMENTS.md](REQUIREMENTS.md). Inputs and outputs: [INTERFACES.md](INTERFACES.md). License: MIT.
