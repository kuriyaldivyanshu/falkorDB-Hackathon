# Local development during the memory migration

The target is a local Codex memory package: Codex owns inference, tools and execution; Threadline owns project association, permitted evidence capture, durable history, accepted memory, bounded context and coordination. Follow [the development checklist](development-checklist.md) for implementation order and current status.

## Build

Use Node.js >=22 and npm from the repository root:

```sh
npm ci
npm run build
```

The existing PostgreSQL driver, FalkorDB client and TypeScript workspace are reused. New dependencies are added in their assigned migration batches, with exact versions locked during qualification.

## Configuration

Threadline configuration resolves from an installation root, never from a coding repository's `.env`:

1. `--home <dir>`,
2. `THREADLINE_HOME`,
3. `~/.threadline`.

The root holds `config.json` (non-secret settings), `secrets.json` (owner-only 0600 database passwords), `credential.json` (owner-only local admin token), `sources/` (immutable captured bytes) and `spool/`. Recognised environment keys include `THREADLINE_HOST`, `THREADLINE_PORT`, `THREADLINE_PG_HOST`, `THREADLINE_PG_PORT`, `THREADLINE_PG_DATABASE`, `THREADLINE_PG_USER`, `THREADLINE_PG_PASSWORD`, `THREADLINE_PG_MIGRATION_USER`, `THREADLINE_PG_MIGRATION_PASSWORD`, `THREADLINE_PG_APPLICATION_ROLE`, `THREADLINE_FALKORDB_HOST` and `THREADLINE_FALKORDB_PORT`.

## Data services

Existing Compose services and volumes remain available for development. Source cleanup does not reset databases, change existing passwords or remove source data. The memory service uses the new `threadline_memory` SQL schema, its own restricted application role and fresh project graphs; the retired `threadline` schema is neither read nor migrated.

## Implemented commands

`threadline init` (or `npm run setup`) applies the new schema through the configured migration user, verifies that the application role cannot bypass row-level security, verifies the cross-tenant function owners, creates the local owner identity and records configuration. It never resets a database and never writes native configuration.

```sh
threadline status                     # health, component readiness, storage state
threadline capabilities               # supported vs unavailable operations, with reasons
threadline project:add --root <path>  # associate a workspace root with a project
threadline project:list
threadline project:grants --project <uuid>
threadline source:append --project <uuid> --kind user_message --file <path>
threadline source:inspect --project <uuid> <sourceId>
threadline source:read --project <uuid> <sourceId> [--offset <n>] [--max-bytes <n>]
threadline history --project <uuid> [--limit <n>] [--cursor <cursor>]
threadline version                    # client, protocol and service versions
threadline help                       # the authoritative command surface
```

Tasks and memory:

```sh
threadline task:create --project <uuid> --title <text> --idempotency-key <key>
threadline task:inspect --project <uuid> <taskId>
threadline task:require --project <uuid> <taskId> --memory <id> \
        --expect-revision <token> --idempotency-key <key>
threadline task:requirements --project <uuid> <taskId>

threadline memory:episode:record --input <file|-> [--wait]
threadline memory:propose --input <file|-> [--wait]
threadline memory:accept --project <uuid> <memoryId> --version <versionId> \
        --idempotency-key <key> --expect-current <versionId|none> [--reason <text>]
threadline memory:correct --input <file|-> [--wait]
threadline memory:inspect --project <uuid> <memoryId>
threadline memory:query --project <uuid> [--task <id>] [--kind <kind>] [--focus <text>] [--limit <n>]

threadline operation:inspect --project <uuid> <operationId>
```

Human mutation idempotency keys are always supplied by the caller. Mutations
with a head or revision to guard also require the caller's expected version or revision. For
`memory:accept`, use `--expect-current none` for the first acceptance and
`--expect-current <versionId>` for a guarded update. The CLI never derives an
expected head, invents a key or retries a guarded mutation on its own. Content-bearing
input (`memory:episode:record`, `memory:propose`, `memory:correct`) arrives as one bounded JSON document
of at most 256 KiB, read from a file or from standard input, and is validated by
the shared input contract rather than by a wide set of flags. If `--project` is
also supplied, it must match the document's `projectId` before any request is sent.

`memory:propose` and `memory:correct` accept semantic and procedural content.
An episodic proposal is refused, because an episode is recorded through
`POST /v2/memories/episodes` where the service resolves its evidence precision;
a procedure cannot write its own `procedureState` or `reviewRef`. A human-accepted
procedure stays `candidate`: acceptance is not validated reuse, and
`memory.procedure.validate` remains unavailable.

Exit status is `0` for a successful read or a committed operation, `1` for a
refusal or failure, `2` for a usage error, and `3` when the operation still has
no durable outcome. `--json` prints exactly one machine-readable result;
`--wait` follows an operation to a settled state and still reports a refusal as a
refusal. A refusal names the offending field of the input document.

MCP and preview commands (context retrieval requires explicit opt-in):

```sh
threadline context:prepare --input <file|-> [--project <uuid>] [--token-file <path>] [--json]
threadline context:occurrence --input <file|-> [--project <uuid>] [--token-file <path>] [--json]
threadline mcp --project <uuid> [--token-file <path>] [--timeout-ms <n>] [--concurrency <n>] [--context-tools]
threadline codex:preview --project <uuid> [--codex-home <path>] [--executable <path>] [--entry <path>] [--context-tools]
```

`mcp` serves six read-only tools by default. Explicit `--context-tools` adds only
audited context preparation, which writes metadata but changes no accepted
knowledge. It exposes no acceptance or generic proxy tool and refuses to start if the credential cannot see
the configured project, and never falls back to reading SQL or source files
during an outage. `codex:preview` renders the Codex profile that starts `mcp`,
writes nothing and contains no credential. Episodes and procedures are readable
through `memory:query --kind episodic|procedural` and `memory:inspect`. See
[docs/cli-memory-and-mcp.md](cli-memory-and-mcp.md) for the full workflow and
[docs/memory-kinds.md](memory-kinds.md) for the memory-kind contracts.
[Context clients](context-client.md) document strict inputs, credential binding,
occurrence reports and body/envelope limits. Preparation is not emission or proof
of committed manifest graph admission. Human context commands have no --wait or
automatic emission step. The explicitly configured [context-only hook](codex-context-hook.md) retrieves on SessionStart
and UserPromptSubmit with a total deadline, captures nothing and reports only
a successful local stdout callback. It requires absolute --home, --token-file,
--workspace-root and --context-input paths plus a project UUID. The hook creates
one invocation UUID for its audit keys; human key semantics remain unchanged.
Use codex:preview --context-hooks with those same explicit inputs to preview
the handlers; it writes nothing and uses the selected reader file for MCP too.

### Privilege model

Forced row-level security applies to a table's owner as well as to other roles, so the three `SECURITY DEFINER` functions that must cross the tenant fence — `token_lookup`, `claim_operations` and `operation_backlog` — only see rows when their owner can bypass that fence. A definer function whose owner cannot bypass it matches nothing, which would make authentication, claiming and the backlog count fail silently.

Setup and service start therefore **verify the actual owners** of those functions instead of assuming them, and both refuse an unsupported configuration with the offending function and owner named. The supported layout is:

- `THREADLINE_PG_MIGRATION_USER` is a superuser or a role holding `BYPASSRLS`; it owns the schema and the three functions;
- `THREADLINE_PG_USER` / `THREADLINE_PG_APPLICATION_ROLE` is a restricted login role that **cannot** bypass the fence, and is granted `EXECUTE` on those functions only.

Forced row-level security stays on: the privilege is confined to those named functions rather than removed from the tables. `threadline status` reports the result as the `privilegedSql` component, and durable graph admission is not claimed while that component is blocked.

`threadline serve` (or `npm run serve`) runs the loopback service.

```sh
GET /health          # unauthenticated liveness only: build, protocol, state, uptime
GET /v2/status       # requires a bearer credential: readiness, storage, backlog counts
GET /v2/capabilities # requires a bearer credential: supported vs unavailable operations
```

Liveness is deliberately minimal because it is served to an unauthenticated caller. Component readiness and the cross-tenant backlog count are operational detail and need a credential. When no usable store is reachable the service cannot verify a credential, so `status` and `capabilities` answer a typed `storage_unavailable` naming the reason; every durable operation refuses the same way rather than falling back to process memory.

Appending the same file twice is an idempotent retry; changing the bytes under the same delivery identity is refused. `history` cursors are opaque and re-authorize each page.

## Semantic memory and tasks

The loopback API also serves semantic memory and task coordination. Every route needs a project-bound bearer credential; the body may never widen that scope.

```text
POST /v2/tasks                                    create a task (title, optional family)
GET  /v2/tasks/:taskId                            task view, requirement ids and revision
POST /v2/tasks/:taskId/requirements               bind a required memory to the task
GET  /v2/tasks/:taskId/requirements               resolve exact current requirement versions
POST /v2/memories/proposals                       propose a sourced candidate version
POST /v2/memories/:memoryId/acceptance            human acceptance of one candidate
POST /v2/memories/:memoryId/corrections           human correction that supersedes the head
GET  /v2/memories/:memoryId                       current version plus remaining candidates
GET  /v2/memories                                 current memory, optionally task-scoped or focused
```

How the pieces relate:

- A proposal records a candidate version. It has **no governing effect** until a human accepts it; before acceptance the task requirement reports `missing_current`.
- Acceptance and correction require the local human administration credential. A producer credential cannot grant itself human authority and is refused with `scope_denied`.
- A correction creates a new accepted version that supersedes the named head. The earlier version, its evidence and its source links stay in place; only the current pointer moves.
- Every cited source must be visible in the project scope and available. A source from another project, a private source and an unknown source produce one indistinguishable refusal; a visible source whose bytes are unavailable reports `source_unavailable`.
- Writes are admitted to the SQL ledger under the caller's idempotency key and committed to the project graph by the leased worker. An exact retry reads the first admission back; the same key with a changed payload, or a different actor, is refused with `idempotency_mismatch`.
- Reads fail closed. If the graph holds two current versions for one memory, the memory view and the project list answer `authority_conflict`; a task requirement reports `duplicate_current` while its other requirements still resolve.

Operation progress is observable through `GET /v2/operations/:operationId?projectId=<uuid>`. `pending`, `committed` and `rejected` are distinct, and the refusal code names the reason (`version_not_proposed`, `expected_head_conflict`, `task_revision_conflict`, `requirement_already_bound`, `source_unavailable`, …). `threadline status` reports the backlog counts and whether durable memory is currently claimed.

## Backend context and remaining gaps

Episode admission and procedural candidates with human review are implemented;
see [docs/memory-kinds.md](memory-kinds.md). Authenticated bounded context
preparation and occurrence reporting are now supported by the backend:

```text
POST /v2/context
POST /v2/context/occurrences
```

[The context API guide](context.md) documents scoped idempotency, selection hints,
exact mandatory authority, byte limits, metadata-only manifests and guarded
self-reported occurrences. Use `context:prepare`, `context:occurrence` or the
explicit `--context-tools` MCP option described in [context clients](context-client.md).
Owners issue, list and revoke project readers through the [access API](access.md);
use the saved raw token file with these clients. Reader audit writes do not
permit knowledge mutations. Migration 6 adds this access model without changing
the graph schema; apply it only to your explicitly selected installation.
`native_observed` remains unsupported. Still reported unavailable by
`threadline capabilities`: validated procedural reuse, claims and handoffs, native
enrollment and capture, history import, deletion jobs and export. There is no hidden legacy command path.

`threadline memory:episode:record --input <file|-> [--wait]` records the
existing episode contract, including a caller-provided idempotency key and an
optional requested `evidencePrecision`. The server alone grants `observed` when
all evidence eligibility conditions hold. Unsupported observation requests
refuse without downgrade, authored reports remain proposals, and unknown
outcomes require uncertainty. A committed episode operation does not by itself
mean accepted authority, successful completion of the wider task or validated
procedure reuse. Inspect the returned memory in JSON mode for server-resolved
precision and acceptance. There is still no procedure-validation command.

Follow [the reproducible memory demo](memory-demo.md) for a public authored
600 → 60 second correction, an actually executed fixture check, episode
provenance, an accepted procedural candidate and restart/MCP recall. It uses
implemented memory APIs without a Codex inference call. The walkthrough does
not claim native context delivery. Its separate optional context-client section
exercises preparation through the same backend API.

## Native qualification

Readiness checks inspect the installed Codex version without reading native authentication or starting inference. Installation writes only explicitly approved, manifest-owned native configuration. Authored live inference is a separately authorized acceptance step.

Qualify hooks, bounded context output and MCP identity before claiming compatible capture or model mutations. No native GUI/cloud support is inferred from CLI behavior.

One step is now reachable: `threadline codex:preview` renders the MCP-only
profile, and the installed `codex-cli 0.163.0` binary parses it and reports the
exact rendered command, args and env through `codex -p threadline mcp list
--json`. That is evidence about the configuration route and stdio registration
only. Hook runtime execution, `additionalContext` delivery and MCP `tools/call`
identity remain unqualified — see
[docs/native-integration-contract.md](native-integration-contract.md).

## Demo assets

`fixtures/inventory-export-v1/` contains public authored data and a deliberately imperfect seed. Its schema-v2 manifest specifies expected outputs; it does not supply protected execution or successful check evidence. Native agents or a human use a separate demo worktree. The package resolves installed assets independently of the repository working directory.

## Verification

Run the workspace build after source/configuration changes. Keep temporary behavior checks outside the repository, use synthetic data and report observed outcomes. No permanent package test suite is currently provided. Native compatibility, erasure, concurrency and clean tarball installation remain explicit migration gates.

## Parallel development

Use [the parallel work rulebook](parallel-work-rulebook.md) and a coordinator-assigned task contract before creating a worktree. Each worktree has its own dependency installation, generated output and explicitly isolated verification resources. Required assignment results belong in tracked summaries or the PR; ignored local logs alone cannot establish completion.
