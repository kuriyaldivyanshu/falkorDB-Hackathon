# Human memory CLI and project-bound MCP

This document is the operator's guide to the two client surfaces this build
actually implements: the human-run commands that create, accept and correct
project memory, and the project-bound stdio MCP server that lets an
MCP client retrieve current memory and its provenance.

Codex owns inference, tools, authentication, approvals and execution.
Threadline supplies memory. Neither surface launches or supervises a coding
session, and neither writes memory on a model's behalf.

## What exists now

| Surface | What it does | What it deliberately does not do |
| --- | --- | --- |
| CLI commands | Human mutations and bounded reads over the loopback API | No inference, no session control, no native configuration writes |
| `threadline mcp` | Six read-only tools; explicit --context-tools adds preparation audit writes | No accepted-knowledge mutation, acceptance or HTTP/SQL/shell/filesystem tool |
| `threadline codex:preview` | Renders MCP and explicit --context-hooks handlers | Writes no native configuration or bearer |
| `threadline codex-hook` | Explicit context-only SessionStart/UserPromptSubmit retrieval | No capture, enrollment, accepted-knowledge write or qualified native identity |

Semantic memory, episodes and procedural candidates are implemented (see
[docs/memory-kinds.md](memory-kinds.md) for the memory-kind contracts and
`POST /v2/memories/episodes`). Authenticated backend context preparation and
occurrence reporting are also implemented; see [the context API](context.md).
[Context clients](context-client.md) expose `context:prepare`, explicit
`context:occurrence`, and an opt-in `threadline_context_prepare` MCP tool.
Preparation writes metadata, never delivery or accepted knowledge. Validated procedural reuse,
coordination claims, handoffs, native capture and native session enrollment
remain unavailable; strong native identity remains unqualified. The MCP tool-call
identity path is still unqualified; accepted-knowledge mutations stay human-only.

## One complete workflow

Everything below uses the local owner credential from the installation root. Run
it against a service you started yourself; it is a real workflow, not a fixture.

The shell examples use `jq` to capture returned identifiers. Set the project once:

```sh
export THREADLINE_HOME="$HOME/.threadline"
PROJECT=$(threadline project:add --root "$PWD" --label "inventory-export" --json \
  | jq -er '.project.projectId')
```

### 1. Capture the evidence first

Memory cites retained evidence, so the authored note comes first.

```sh
cat > /tmp/freshness-600.md <<'EOF'
Inventory exporter freshness requirement, reviewed 2026-10-18.

The exporter must refresh stale inventory within 600 seconds of the last
successful poll.
EOF

SOURCE=$(threadline source:append --project "$PROJECT" --kind human_note \
  --file /tmp/freshness-600.md --origin authored:freshness-600 --json \
  | jq -er '.outcomes[0].sourceId')
```

`source:append` derives its delivery identity from the file content, so
repeating the same file is an idempotent retry and changing the bytes under one
identity refuses.

### 2. Create a task and read its revision

```sh
TASK_RESULT=$(threadline task:create --project "$PROJECT" \
  --title "Inventory exporter freshness" --family inventory-export \
  --idempotency-key cli-task-1 --wait --json)
TASK=$(printf '%s\n' "$TASK_RESULT" | jq -er '.taskId')

REVISION=$(threadline task:inspect --project "$PROJECT" "$TASK" --json \
  | jq -er '.revision')
```

The task carries an opaque `revision`. It is an equality guard, not a counter:
you cannot compute one, and a binding must present the revision it last read.

### 3. Propose a requirement (this governs nothing yet)

A proposal is content-bearing, so it arrives as one bounded JSON document that
is validated by the shared `proposeMemoryInput` contract. It is read from a
file or from standard input with `--input -`, and it must be at most 256 KiB.

```sh
cat > /tmp/propose.json <<EOF
{"projectId":"$PROJECT","taskId":"$TASK",
 "content":{"kind":"semantic","subtype":"requirement",
            "statement":"The inventory exporter must refresh stale inventory within 600 seconds."},
 "applicability":{"predicates":[]},
 "observedUnder":{"taskFamily":"inventory-export","contractVersion":null,"runtime":null,
                  "tool":null,"paths":[],"parameters":{}},
 "sourceIds":["$SOURCE"],"idempotencyKey":"cli-propose-1"}
EOF

PROPOSAL=$(threadline memory:propose --input /tmp/propose.json --wait --json)
MEMORY=$(printf '%s\n' "$PROPOSAL" | jq -er '.memoryId')
VERSION=$(printf '%s\n' "$PROPOSAL" | jq -er '.versionId')
```

The result is `state: "committed"` — committed to the *graph as a candidate*.
Check that nothing governs yet:

```sh
threadline memory:inspect --project "$PROJECT" "$MEMORY" --json
```

`current` is `null` and the version appears under `candidates`. A proposal is
never authority, and no CLI command changes that automatically.

You may bind the requirement now; it will simply be unsatisfied:

```sh
threadline task:require --project "$PROJECT" "$TASK" \
  --memory "$MEMORY" --expect-revision "$REVISION" \
  --idempotency-key cli-require-1 --wait --json

threadline task:requirements --project "$PROJECT" "$TASK" --json
```

The requirement reports `"state": "missing_current"`.

### 4. Accept it as a human

Acceptance is the only step that makes a proposal authoritative, and the service
resolves human authority from the credential, never from the request body.

```sh
threadline memory:accept --project "$PROJECT" "$MEMORY" \
  --version "$VERSION" --expect-current none \
  --reason "Approved as the current requirement" \
  --idempotency-key cli-accept-1 --wait --json
```

`--expect-current` names the head the acceptance expects. Use `none` when the
memory has no head yet; a real version id guards against a concurrent change
and refuses with `expected_head_conflict`. The CLI never guesses it for you.

The task requirement now resolves to the accepted version.

### 5. Correct the requirement under the expected-head guard

Capture the correction evidence as a second source before citing it:

```sh
cat > /tmp/freshness-60.md <<'EOF'
Inventory exporter correction, reviewed 2026-10-18.

The regional pilot shortened the freshness window: the exporter must refresh
stale inventory within 60 seconds of the last successful poll.
EOF

SOURCE_2=$(threadline source:append --project "$PROJECT" --kind human_note \
  --file /tmp/freshness-60.md --origin authored:freshness-60 --json \
  | jq -er '.outcomes[0].sourceId')

cat > /tmp/correct.json <<EOF
{"projectId":"$PROJECT","memoryId":"$MEMORY","expectedCurrentVersionId":"$VERSION",
 "content":{"kind":"semantic","subtype":"requirement",
            "statement":"The inventory exporter must refresh stale inventory within 60 seconds."},
 "applicability":{"predicates":[]},
 "observedUnder":{"taskFamily":"inventory-export","contractVersion":null,"runtime":null,
                  "tool":null,"paths":[],"parameters":{}},
 "sourceIds":["$SOURCE_2"],"reason":"Regional pilot shortened the window",
 "idempotencyKey":"cli-correct-1"}
EOF

CORRECTION=$(threadline memory:correct --input /tmp/correct.json --wait --json)
OPERATION=$(printf '%s\n' "$CORRECTION" | jq -er '.operationId')
```

The current pointer moves to the new version. `memory:inspect` shows
`current.supersedesVersionId`, the new `sourceIds`, and the human principal that
accepted it. The earlier 600-second version, its acceptance record and its
evidence all stay intact: a correction supersedes, it does not rewrite.

Repeating the same `--idempotency-key` with the same payload returns the first
admission. Reusing it with a different payload refuses with
`idempotency_mismatch`.

### 6. Observe operation state explicitly

```sh
threadline operation:inspect --project "$PROJECT" "$OPERATION" --json
```

`pending`, `leased` and `ambiguous` mean the guarded mutation has no durable
outcome yet. `committed` and `rejected` are settled, and the committed one
carries the graph receipt with its event sequence as a decimal string.

## Record an episode

```sh
threadline memory:episode:record --input episode.json --wait --json
threadline memory:episode:record --input - --wait --json < episode.json
```

The file/stdin document is bounded to 256 KiB during reading and validated with
`recordEpisodeInputSchema`. It supplies `projectId`, optional `taskId`, `action`,
`outcome`, `observation`, optional `uncertainty`, `sourceIds`, `applicability`,
`observedUnder`, optional requested `evidencePrecision` and an explicit
`idempotencyKey`. No key is invented, and retries keep the same document/key.
If `--project` accompanies any structured command, it must equal the document's
`projectId`; a mismatch refuses before sending.

```json
{"projectId":"<returned-project-uuid>","taskId":"<returned-task-uuid>",
 "action":"Compare the public seed output with the mixed-offset CSV specification",
 "outcome":"failed","observation":"Exit 0, but stdout differed from required UTC-normalized CSV.",
 "uncertainty":"Only one public case was checked; the wider task is not complete.",
 "sourceIds":["<returned-actual-outcome-source-uuid>"],
 "applicability":{"predicates":[]},
 "observedUnder":{"taskFamily":"inventory-export","contractVersion":"csv-v1","runtime":"node",
                  "tool":"human-command","paths":["src/exporter.mjs"],"parameters":{"maxAgeSeconds":"600"}},
 "evidencePrecision":"observed","idempotencyKey":"human-public-check-1"}
```

This is an input template, not captured execution evidence. Replace identifiers
with real returned values and capture an actual outcome Source first. The
[complete executable demo](memory-demo.md) does both.

The requested precision is forwarded unchanged; the client implements no
parallel evidence policy and never retries with weaker precision. For every
cited source the server checks scope/visibility/availability, qualifying outcome
kind, completeness, recording by the acting human principal and committed
source admission. Source kind or a text assertion alone cannot grant observation.
These checks do not independently establish the truth of command output.

An omitted or `authored` precision stays authored and proposed. The episode
command does not accept it. `observed` requests either qualify or refuse
faithfully. `unknown` outcomes need uncertainty; failed, denied, interrupted and
unknown remain distinct. A successful action never establishes wider task
completion. Inspect `memory:inspect --json` to read **server-returned** precision
and acceptance; operation commitment alone is neither acceptance nor validation.
See [memory-kind contracts](memory-kinds.md) for the server boundary.

## Exit status

| Status | Meaning |
| --- | --- |
| `0` | The read succeeded, or the operation committed |
| `1` | Refused, rejected or failed |
| `2` | Usage error |
| `3` | The operation still has no durable outcome (`pending`, `leased` or `ambiguous`) |

In `--json` mode each command prints exactly one machine-readable result. A
pending outcome is never printed as a success, and `--wait` never converts a
refusal into a pass. A refused command names the offending field of the input
document on stderr, so a rejected proposal says which part of the document was
wrong without echoing the document back.

### Proposals now accept semantic and procedural content

The proposal and correction contracts are shared, and they narrow what a caller
may author. `memory:propose` and `memory:correct` accept **semantic** and
**procedural** content; an episodic proposal is refused, because an episode
arrives through its own operation where the service resolves its evidence
precision. A procedure proposal supplies its steps, prerequisites, parameters
and the episode versions it claims as support; it cannot write its own
`procedureState` or `reviewRef`, and an attempt to do so is an explicit refusal
rather than a silently dropped field.

## The read-only MCP server

```sh
threadline mcp --project "$PROJECT"
```

The server binds at startup and refuses to start at all if the configured
credential cannot see the configured project. It exposes six read-only tools:

| Tool | Backend route | Bound |
| --- | --- | --- |
| `threadline_memory_query` | `GET /v2/memories` | `taskId`, `kind`, `focus`, `limit` (1–50) |
| `threadline_memory_inspect` | `GET /v2/memories/:memoryId` | `memoryId` |
| `threadline_task_inspect` | `GET /v2/tasks/:taskId` | `taskId` |
| `threadline_task_requirements` | `GET /v2/tasks/:taskId/requirements` | `taskId` |
| `threadline_source_inspect` | `GET /v2/sources/:sourceId` | `sourceId` (metadata only) |
| `threadline_source_read` | `GET /v2/sources/:sourceId/range` | `sourceId`, `offset`, `maxBytes` (1–32768) |

`threadline_memory_query` accepts `kind: "episodic"` or `kind: "procedural"` to
narrow the bounded scan, and `threadline_memory_inspect` returns the stored
content of any kind — including the server-resolved `evidencePrecision` of an
episode and the `procedureState`, `reviewRef` and `supportedBy` of a procedure.

The default six-tool server guarantees:

- **No writes.** There is no proposal, acceptance, correction, requirement
  binding or source-append tool, and no generic escape hatch: no HTTP proxy, no
  SQL, no Cypher, no shell, no filesystem read. A mutation-shaped tool name is
  refused as an unknown tool.
- **No routing by argument.** Project, tenant, service destination and
  credential are configuration. Tool arguments are strict objects; an unknown
  field such as `projectId`, `tenantId` or `role` is refused rather than
  ignored. Every backend request is re-authorized by the service, so an
  argument can never widen scope.
- **No fabricated identity.** The caller is an MCP client with unqualified
  native identity. The server never infers a session from a timestamp, the most
  recent hook or anything a model supplies, and it never registers one.
- **No fallback storage.** It never starts a backend and never reads SQL or
  source files directly. During a backend or graph outage a tool call answers
  with a bounded `service_unavailable` or `storage_unavailable` error rather
  than a second, unauthorized read path.
- **Honest authority.** A requirement is reported as `current`,
  `missing_current` or `duplicate_current`. Two current versions are an
  explicit conflict, never a chosen winner.
- **Bounded responses.** `threadline_memory_query` reports `hasMore`;
  `threadline_source_read` reports `start`, `end`, `totalBytes` and `truncated`.
  The task requirement set is complete for the task and is never truncated.
- **Untrusted data.** Every result is prefixed with a notice that the content is
  project data, not instructions.
- **Bounded concurrency and controlled shutdown.** `--concurrency` (default 8)
  caps in-flight backend reads; `--timeout-ms` bounds each request. Standard
  input closing, `SIGINT` or `SIGTERM` ends the session cleanly. Restarting the
  process re-verifies the project binding before it answers anything.
- **stdout is protocol only.** Diagnostics go to stderr.

### Credentials

`threadline mcp` reads the local owner credential from the installation root.
`--token-file <path>` (or `THREADLINE_MCP_TOKEN_FILE`) names a file containing
only the token. Prefer a project reader issued by the owner's supported
[access API workflow](access.md), which saves a one-time bearer in an exclusive
0600 file. Use that file with MCP or either context command; do not replace the
installation owner credential. Credential administration has no CLI command.
Readers can prepare context and report their own occurrence as audit writes,
but cannot mutate accepted knowledge, sources or tasks. Expiry and revocation
are enforced by the backend, including its final context release check.

## Explicit audited context retrieval

`threadline mcp --project "$PROJECT" --context-tools` adds only
`threadline_context_prepare`. It uses the configured project and credential,
accepts an explicit idempotency key and task/focus/condition/budget selectors,
and refuses identity/routing overrides. It records a metadata-only manifest and
prepared occurrence without changing accepted knowledge. Accordingly its
readOnlyHint is false; destructiveHint and openWorldHint are false. Keyed
identical retries reconcile the same backend preparation.

The tool returns exact body text once and compact validated audit/snapshot
metadata. Its complete serialized result has a 64 KiB hard limit, separate from
the backend's 4 KiB default / 8 KiB hard rendered body limit. Oversize explicitly
fails without partial mandatory authority. No occurrence tool is exposed;
preparation and MCP return never automatically report emission or native use.
See [the complete context client guide](context-client.md) for CLI examples,
credential binding, refusals, retry semantics and output shape.

## Previewing the Codex configuration

```sh
threadline codex:preview --project "$PROJECT" --codex-home "$CODEX_HOME"
# Explicit audited retrieval profile:
threadline codex:preview --project "$PROJECT" --codex-home "$CODEX_HOME" --context-tools
```

The command renders the profile file a human would install at
`$CODEX_HOME/threadline.config.toml`, selected with `codex --profile threadline`,
and prints its digests, the ownership classification of anything already at those
paths, and the exact command to run the server by hand.

- It writes nothing, into the real Codex home or anywhere else.
- It renders no credential: the server reads it from the Threadline home at
  startup.
- It renders no hook entry, because `threadline codex-hook` is not implemented
  in this build. Installing a hook that names a missing command would not be
  installable.
- Ownership is classified exactly as the qualification established: `absent`,
  `owned`, `edited` (marker present, needs a human) and `foreign` (never
  touched).

## Limits and next integration requirements

- Native runtime hook execution, `additionalContext` delivery and spill remain
  **unqualified**.
- MCP `tools/call` host metadata identifying a conversation remains
  **unqualified**, as does fork/subagent identity correlation. Until that is
  observed, model-issued knowledge mutations stay disabled; explicit context
  opt-in records only preparation metadata.
- Backend context preparation and occurrence reporting are implemented through
  authenticated HTTP routes described in [the context guide](context.md). There
  are also `context:prepare` / `context:occurrence` CLI commands and an explicit
  `--context-tools` MCP option; see [context clients](context-client.md). Native
  delivery remains unqualified. Session enrollment remains unavailable.
- Claims and handoffs remain unavailable operations.
- Supported scoped reader issuance, listing and revocation are available through
  [the owner API](access.md). Earlier synthetic SQL provisioning was verification
  setup, not the operator workflow. Isolation coverage for later native,
  coordination and privacy operations remains open.

### Procedure and recall limits

Procedures use `memory:propose` / `memory:accept` and stay
`procedureState: "candidate"` after human acceptance. `memory.procedure.validate`
is unavailable; there is no CLI validation command. Episodes and procedures
are readable through the existing query and inspect MCP tools, so no dedicated
mutation or episode tool is added.

## Explicit context-only hooks

The [hook guide](codex-context-hook.md) describes required project/absolute paths,
API-issued readers, strict configured selectors, the total 2,000 ms default
deadline and exit-0 withholding. Hook JSON preserves exact backend authority and
qualifications. Only successful local stdout acceptance permits best-effort
adapter_report; Codex consumption remains unqualified. Preview --context-hooks
adds just SessionStart/UserPromptSubmit and selects the same reader for MCP.
Default MCP remains six tools; --context-tools independently enables the seventh.
No native installation, trust changes or inference is performed by the preview.
