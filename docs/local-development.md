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

## Unavailable until their batch

Accepted memory, bounded context, tasks, claims and handoffs, native enrollment and capture, history import, deletion jobs and export are reported unavailable by `threadline capabilities` with the batch that delivers them. There is no hidden legacy command path.

## Native qualification

Readiness checks inspect the installed Codex version without reading native authentication or starting inference. Installation writes only explicitly approved, manifest-owned native configuration. Authored live inference is a separately authorized acceptance step.

Qualify hooks, bounded context output and MCP identity before claiming compatible capture or model mutations. No native GUI/cloud support is inferred from CLI behavior.

## Demo assets

`fixtures/inventory-export-v1/` contains public authored data and a deliberately imperfect seed. Its schema-v2 manifest specifies expected outputs; it does not supply protected execution or successful check evidence. Native agents or a human use a separate demo worktree. The package resolves installed assets independently of the repository working directory.

## Verification

Run the workspace build after source/configuration changes. Keep temporary behavior checks outside the repository, use synthetic data and report observed outcomes. No permanent package test suite is currently provided. Native compatibility, erasure, concurrency and clean tarball installation remain explicit migration gates.
