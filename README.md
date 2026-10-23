# keyless-agents (`klag`)

Zero-trust secrets for AI coding agents. Agents run in per-project sandboxes and read or write secrets only inside an AWS Parameter Store keyspace. No static cloud keys on the machine or in the repo.

```sh
klag list                 # names only (no values)
klag get  DATABASE_URL    # value, only if the keyspace policy allows it
klag set  API_TOKEN       # value from stdin or prompt, never from argv
```

Setup (prerequisites: a tailnet with an OIDC issuer, an AWS administrator, Docker or Podman with compose, a sandbox runtime):

```sh
npx klag op setup --check   # lists what is missing, changes nothing
npx klag op setup           # daemon container, tailnet node, AWS template, config
```

Status: draft v4. Design: [SPEC.md](SPEC.md). Requirements and tests: [REQUIREMENTS.md](REQUIREMENTS.md). Inputs and outputs: [INTERFACES.md](INTERFACES.md). License: MIT.
