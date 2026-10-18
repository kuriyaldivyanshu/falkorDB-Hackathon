# Audited context clients

The CLI and explicitly enabled MCP context tool call the same authenticated
[backend context API](context.md). The backend selects and renders current
FalkorDB authority, checks provenance and authorization, and records preparation.
Clients validate its complete response before presenting it. An outage never
reconstructs memory from SQL or files.

## Prepare from a file or standard input

Use a running service and an authorized project/task from the
[human memory workflow](cli-memory-and-mcp.md). These Bash examples use `jq`,
`PROJECT` and `TASK` containing real returned UUIDs, and an explicitly selected
absolute `INSTALL`. Omit taskId to request project context without task authority.

```bash
umask 077
jq -n --arg p "$PROJECT" --arg t "$TASK" \
  '{projectId:$p,taskId:$t,idempotencyKey:"human-context-1",focus:"UTC",
    maxBodyBytes:4096,conditions:{selectionHints:[
      {key:"contract_version",values:["csv-v1"]}]}}' > /tmp/context-input.json
threadline context:prepare --home "$INSTALL" --input /tmp/context-input.json \
  --project "$PROJECT" --json > /tmp/context-result.json
# Identical retry, using the same credential and key:
threadline context:prepare --home "$INSTALL" --input - --json \
  < /tmp/context-input.json
```

Every request requires its own caller-chosen `idempotencyKey`. Inputs are bounded
to 256 KiB before JSON parsing, for both files and stdin. Unknown fields refuse.
Only `--home`, `--input`, `--project`, `--token-file`, `--json` and help flags
are accepted by context commands; repeated options refuse. If `--project` is
supplied it must equal the document's projectId. Conditions are selection hints,
never authenticated runtime facts; task family comes from the stored task.
The clients do not create or infer native sessions. A human may name an existing
nativeSessionId in a preparation document, but only the backend can qualify its
active ownership and credential binding; an arbitrary supplied UUID grants nothing.

JSON mode returns exactly one validated ContextResult on a context outcome:
`kind: "packet"` exits 0; `kind: "refused"` exits 1 with the exact reason and
detail. Typed transport/authentication errors exit 1 with a diagnostic on stderr
and no successful JSON result. Usage/schema errors exit 2. Human mode labels
packet versus refusal and prints the server's exact body plus audit identifiers,
digest, byte count and task/graph/privacy snapshot.

The packet contains exact mandatory authority and separately qualified optional
evidence. Full applicability and historical observedUnder remain separate.
Clients never recalculate selection, excerpt mandatory authority or silently
remove its qualifications. Refusal reasons such as `mandatory_overflow`,
`missing_current_authority` and `stale_preparation` are preserved.

## Preparation, admission and explicit occurrence reports

Preparation durably records a metadata-only manifest Source and a `prepared`
occurrence. No rendered body, applicability/observed conditions or standalone
focus digest is retained in the manifest. A packet does not certify its manifest
operation has committed to the graph: inspect packet.manifestOperationId through
`operation:inspect` for the actual receipt. Preparing does not report delivery.

Only report emission after the operator or adapter actually attempted that
boundary. This example explicitly reports an operator's assertion; the command
itself does not deliver anything into Codex:

```bash
jq --arg p "$PROJECT" '{projectId:$p,
  occurrenceId:.packet.occurrenceId,idempotencyKey:"human-context-report-1",
  expectedState:"prepared",state:"emitted",boundary:"operator_report"}' \
  /tmp/context-result.json > /tmp/context-report.json
threadline context:occurrence --home "$INSTALL" --input /tmp/context-report.json --json
threadline context:occurrence --home "$INSTALL" --input - --json < /tmp/context-report.json
```

Use `state: "unknown"` when delivery is uncertain, or `state: "refused"` with
`refusalReason: "delivery_failed"`, `"cancelled"` or `"unknown"`. The expected
state is explicitly `prepared`. Guarded changes, identical replays and conflicting
requests keep backend semantics. `native_observed` is refused as unsupported.
Emitted is self-reported; it proves no native observation, comprehension or
following. No automatic prepare→emit sequence or occurrence MCP tool exists.
A transport failure is a failed/uncertain report, never successful emission.

## Credential binding and lost responses

`--token-file /absolute/path/token.txt` selects a file containing the raw token
with optional surrounding whitespace, exactly the existing MCP token-file
format. It is distinct from installation credential.json. With no flag,
`THREADLINE_MCP_TOKEN_FILE` is used if set; otherwise the installation's local
owner credential is used. Credentials never enter generated configuration,
argv, output or diagnostics. Prefer a scoped reader issued through the supported
[owner access API](access.md). That workflow saves the one-time bearer privately;
issuance/listing/revocation have no administrative CLI commands. Readers can
prepare context and report their own occurrences but cannot append sources,
mutate memory/tasks, administer credentials or access another project.

Revocation and fixed absolute/idle expiry are enforced on every authenticated
request and at the backend's final context authorization statement. Revocation
committed before that statement prevents release; later changes cannot recall
returned bytes. Revoke a lost credential and issue a new one with a fresh key;
an issuance retry never reconstructs its secret or extends its deadline.

Preparation and reporting must use the same credential, not merely the same
principal/project. A caller-supplied project or session identity cannot widen
server authorization. MCP verifies its configured project at startup and the
backend reauthorizes every call. There is no client policy fallback.

After a lost HTTP/MCP response, retry the identical document/selectors and key
under the same credential. The first preparation may already exist. Reusing a
key with changed content refuses; do not invent a replacement key to hide an
uncertain outcome. Replay rechecks current authorization, provenance, task and
renderer compatibility; stale packets can refuse. An occurrence report has its
own explicit key and expected state. The client never retries or weakens a
request automatically.

## Default MCP and explicit audited retrieval

```bash
# Exactly six existing read-only tools:
threadline mcp --home "$INSTALL" --project "$PROJECT"
# Adds only threadline_context_prepare:
threadline mcp --home "$INSTALL" --project "$PROJECT" --context-tools \
  --token-file /absolute/path/token.txt
```

The added tool accepts idempotencyKey, optional taskId, focus, conditions and
maxBodyBytes. It accepts no tenant/project override, URL, graph route, bearer,
principal, enrollment or native session identity. For an authored MCP client,
the tools/call parameters are:

```json
{"name":"threadline_context_prepare","arguments":{
  "idempotencyKey":"authored-context-call-1","focus":"UTC","maxBodyBytes":4096,
  "conditions":{"selectionHints":[{"key":"contract_version","values":["csv-v1"]}]}
}}
```

The tool is an explicit audit write: readOnlyHint false, destructiveHint false,
openWorldHint false. Its idempotentHint describes keyed backend retries with
identical selectors, not unrestricted repeated creation. It records preparation
metadata and changes no accepted project knowledge. No proposal, acceptance,
source/task mutation, credential administration or generic execution tool exists.

A successful result contains the exact body once as a text content block, an
untrusted-data/precision notice, and structuredContent with kind plus metadata:
manifest/operation/occurrence IDs, deliveryEvidence `preparation_only`, release time and
the validated metadata-only manifest. That manifest includes task revision,
graph epoch/head, privacy revision, renderer/policy versions, digest, bytes,
selected item/source identities and omissions. Replay does not report the current
occurrence state; a prior explicit report may already have changed it. Refusals set isError and retain
kind/reason/detail. Transport, authorization and service failures are bounded
explicit tool errors. Stdout is protocol-only; diagnostics use stderr. Existing
timeout and concurrency controls apply; no replacement backend is started.

## Body and envelope limits

The backend rendered body defaults to 4 KiB and has an 8 KiB hard limit,
including all rendered qualifications. Independently, the complete serialized
context tools/call result is bounded to **64 KiB UTF-8**, counting JSON escaping,
content and structured metadata. The full HTTP response is validated before
projection. Clients preserve decimal-string graph/privacy counters.

An envelope that cannot fit returns `context_payload_too_large` and no partial
body. Preparation may already be recorded; reconcile with the same key/request.
Invalid selectors and errors are bounded too. The limit covers the tool result,
not the host's outer JSON-RPC ID/envelope. It never authorizes removing mandatory
authority or treating a received packet as emitted/native_observed.

## Preview and native evidence

```bash
threadline codex:preview --home "$INSTALL" --project "$PROJECT" \
  --codex-home /absolute/isolated/codex-home
threadline codex:preview --home "$INSTALL" --project "$PROJECT" \
  --codex-home /absolute/isolated/codex-home --context-tools
```

Default preview stays the six-tool MCP-only profile. Explicit context preview
is labelled `context-read` and adds the real `--context-tools` startup flag.
Both write nothing, render no bearer or unimplemented hook, and preserve the
existing ownership/collision checks. Review targets before any separately
authorized installation; no real Codex configuration, trust or credential is
changed here.

Authored protocol checks and offline isolated profile inspection establish
transport/configuration only. They do not establish actual model use. Hook
runtime/additionalContext delivery and spilling, host metadata proving a native
conversation, and fork/subagent correlation remain unqualified. N03 remains
incomplete. See [the native boundary](native-integration-contract.md).
