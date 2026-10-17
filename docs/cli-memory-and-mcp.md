# Human memory CLI and the read-only MCP server

This document is the operator's guide to the two client surfaces this build
actually implements: the human-run commands that create, accept and correct
project memory, and the project-bound read-only stdio MCP server that lets an
MCP client retrieve current memory and its provenance.

Codex owns inference, tools, authentication, approvals and execution.
Threadline supplies memory. Neither surface launches or supervises a coding
session, and neither writes memory on a model's behalf.

## What exists now

| Surface | What it does | What it deliberately does not do |
| --- | --- | --- |
| CLI commands | Human mutations and bounded reads over the loopback API | No inference, no session control, no native configuration writes |
| `threadline mcp` | Read-only stdio MCP server bound to one project | No write tool, no acceptance tool, no HTTP/SQL/shell/filesystem tool |
| `threadline codex:preview` | Renders the Codex profile that starts `mcp` | Writes nothing; renders no hook entry and no credential |

Not implemented in this build: native capture, session enrollment, context
preparation, model-written memory, coordination claims and handoffs. The MCP
tool-call identity path is still unqualified, which is one reason writes stay
human-only.

## One complete workflow

Everything below uses the local owner credential from the installation root. Run
it against a service you started yourself; it is a real workflow, not a fixture.

Set the project once:

```sh
export THREADLINE_HOME="$HOME/.threadline"
threadline project:add --root "$PWD" --label "inventory-export" --json
```

### 1. Capture the evidence first

Memory cites retained evidence, so the authored note comes first.

```sh
cat > /tmp/freshness-600.md <<'EOF'
Inventory exporter freshness requirement, reviewed 2026-10-18.

The exporter must refresh stale inventory within 600 seconds of the last
successful poll.
EOF

threadline source:append --project "$PROJECT" --kind human_note \
  --file /tmp/freshness-600.md --origin authored:freshness-600 --json
```

`source:append` derives its delivery identity from the file content, so
repeating the same file is an idempotent retry and changing the bytes under one
identity refuses.

### 2. Create a task and read its revision

```sh
threadline task:create --project "$PROJECT" \
  --title "Inventory exporter freshness" --family inventory-export \
  --idempotency-key cli-task-1 --wait --json

threadline task:inspect --project "$PROJECT" "$TASK" --json
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

threadline memory:propose --input /tmp/propose.json --wait --json
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

```sh
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

threadline memory:correct --input /tmp/correct.json --wait --json
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

## Exit status

| Status | Meaning |
| --- | --- |
| `0` | The read succeeded, or the operation committed |
| `1` | Refused, rejected or failed |
| `2` | Usage error |
| `3` | The operation still has no durable outcome (`pending` or `leased`) |

In `--json` mode each command prints exactly one machine-readable result. A
pending outcome is never printed as a success, and `--wait` never converts a
refusal into a pass.

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

What the server guarantees:

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
only the token, so a narrower credential can be used once one exists.

**Known limitation:** this build has no command that issues a non-owner project
grant, so a reader-grant credential has to be created outside the product
surface. The server prefers a reader credential wherever the mechanism allows
it; it does not invent a credential-issuance path in client code.

## Previewing the Codex configuration

```sh
threadline codex:preview --project "$PROJECT" --codex-home "$CODEX_HOME"
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
  observed, model-issued writes stay disabled and this server stays read-only.
- Context preparation, occurrence recording and session enrollment are not
  implemented; there is no `context.prepare` tool or command here.
- Claims, handoffs, episodes and procedures remain unavailable operations.
- A verified second-credential path over HTTP is still a follow-up for the
  backend owner; this checkpoint does not close it.