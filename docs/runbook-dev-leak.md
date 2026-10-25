# Suspected development secret leak

The trusted operator performs these steps outside the affected sandbox. The agent CLI (`klag list`,
`get`, `set`, `doctor`, `serve`) is implemented and handles sandbox tokens and secret values. The
operator CLI (`klag op ...`) is not: the operator commands below describe the required runtime
interface and become available with its implementation. Do not rely on the agent CLI for incident
containment.

1. **Contain and revoke.** Stop the affected agent and isolate its sandbox through the sandbox runtime.
   Run `klag op sandbox revoke <sandboxId>` from the operator host. Verify that the next sandbox request
   is denied. If revocation is unavailable, stop the daemon and keep the sandbox isolated until access
   can be removed. Record the sandbox ID, affected keyspace, and UTC incident times without values.
2. **Rotate the credential at its source and in Parameter Store.** Using the operator's authorized
   administrator access, invalidate the exposed development credential at the service that issued it.
   Write its replacement to the affected SSM Parameter Store SecureString path with the project's KMS
   key, and update legitimate consumers. Replace affected shared and agent-scope values as needed;
   changing an SSM version alone does not revoke an external service credential. Never put a value in
   argv, shell history, logs, chat, or the incident record. Production remains a separate administrator
   responsibility if there is evidence of a wider compromise.
3. **Preserve and verify audit evidence.** Preserve the original daemon audit log with restricted
   access and run `klag op audit verify`. Record the result or first broken line number. A failed
   verification is evidence to investigate; do not edit or rebuild the chain to make it pass. Keep
   audit data, registry metadata, timestamps, and software versions without copying secret values.
4. **Correlate independently with CloudTrail.** Compare the incident time window, daemon role
   sessions, affected parameter names and versions, and SSM/KMS activity. Look for unexpected STS
   exchanges, writes outside the intended scope, enumeration followed by reads, and access after
   revocation. Preserve CloudTrail evidence independently of the host; a valid local hash chain does
   not prove the absence of compromise.
5. **Recover with fresh access.** Correct the injection or isolation failure, recreate or clean the
   sandbox, and register fresh sandbox access only after validating the containment and rotation.
   Revoke the old token in the sandbox runtime's secret store as well. Run the operator and agent
   doctor checks and verify that revoked access stays denied before resuming work.
6. **Record and follow up.** Keep a restricted incident record with timeline, affected keyspaces and
   versions, revocation and rotation confirmations, audit/CloudTrail references, impact, and owners
   for corrective actions. Never attach leaked values or tokens. Report a product flaw through
   [private vulnerability reporting](../SECURITY.md), using synthetic reproduction data.
