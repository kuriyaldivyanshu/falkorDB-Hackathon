# Local development setup

Verified 15 October 2026. M01 implements durable accepted-goal admission and inspection; model execution and continuity are later milestones. See [the transport contract](m01-contract-agreement.md) and [combined verification evidence](../archive/plans/review/m01-integration-verification.md).

## Observed environment

Verification used Node v23.11.0, npm 11.4.1, TypeScript 7.0.2, Docker 28.0.4 and Compose v2.34.0-desktop.1 on macOS. Node 24 compatibility is unverified. The repository permits Node >=22; that declaration is not a tested support matrix. Owner bootstrap currently requires POSIX ownership/mode checks.

PostgreSQL reported 18.6 from `postgres:18-alpine`. FalkorDB used `falkordb/falkordb:6.0.2`, graph module 60002 on Redis 8.10.2. These are observed development images; release digest pinning remains M13.

The FalkorDB tag has no `v` prefix. Its real persistence directory is `/var/lib/falkordb/data` (`/data` is a symlink); Compose mounts the real directory. PostgreSQL 18 mounts `/var/lib/postgresql` with `PGDATA=/var/lib/postgresql/18/docker`. FalkorDB AOF uses `appendonly yes` and `appendfsync always`.

The tested clients are `pg@8.23.1` and `falkordb@6.8.0`. FalkorDB requires the named import and `await FalkorDB.connect(...)`, not `new FalkorDB(...)`. Replies expose `data`, not `rows`. On the observed server, new-node relationships must share one CREATE clause; the executable admission template handles this. Later checkpoint sketches remain unimplemented.

## Start from a new checkout

Run commands from the repository root:

```sh
npm install
cp .env.example .env
# Edit both app and migration passwords in .env before starting services.
docker compose up -d --wait
npm run db:setup
npm run start --workspace @threadline/backend
```

Use distinct passwords for `THREADLINE_PG_PASSWORD` and `THREADLINE_PG_MIGRATION_PASSWORD`. Compose creates the schema-owner identity from `THREADLINE_PG_MIGRATION_USER/PASSWORD`. `db:setup` provisions `THREADLINE_PG_USER` as a separate NOSUPERUSER/NOBYPASSRLS application role and verifies its connection. It never resets an existing role's password. Set `THREADLINE_PG_APPLICATION_ROLE` to that same app-role name.

The backend entry point finds the workspace root, parses its `.env` and overlays explicit process environment values. Paths such as `.threadline` resolve from that root even when `npm start --workspace` changes the process working directory. Programmatic `createBackend` still uses explicitly supplied configuration. The CLI does not load `.env` or database/provider credentials.

`THREADLINE_STORAGE_MODE=required` is the example's default. Required storage must connect, migrate, enforce tenant fencing and reconcile pending admission before serving. Explicit `unconfigured` mode retains the M00 development surface; durable commands return a typed refusal.

## Existing volumes and credentials

PostgreSQL initialization variables only apply to a new data directory. Changing `.env` does not change a running database's stored password or owner. For existing volumes, use their existing owner/database/password as the migration identity, choose a distinct restricted application identity/password, then run `npm run db:setup`. Do not delete volumes to solve a credential mismatch.

The integration run aligned this workspace's private `.env` with its existing local Compose owner and provisioned a separate restricted app role. It preserved all existing volumes and provider settings. Both app and migration passwords remain private; neither belongs in Git or the terminal client.

Schema bootstrap version 1 remains checksummed and immutable. Additive migration 2 hardens session lookup; an incompatible recorded checksum stops startup. App-role grants are reapplied on normal startup, but app writes to migration bookkeeping are revoked.

The owner token file is `.threadline/session.json`, mode 0600, inside a private 0700 directory. Preserve it with the database. Existing missing/mismatched credentials fail closed; there is no automatic reissue or enrollment UI. A revoked/expired session remains rejected after restart.

## Use the client

In a second terminal:

```sh
node packages/cli/dist/index.js health --show-store-readiness
node packages/cli/dist/index.js init
node packages/cli/dist/index.js fixture
node packages/cli/dist/index.js admit
node packages/cli/dist/index.js inspect
node packages/cli/dist/index.js tui
```

`admit` previews the manifest, rules and initial criteria, then requires an explicit affirmative response in an interactive terminal. For a script, first review `fixture`, then explicitly pass its exact digest:

```sh
node packages/cli/dist/index.js admit --accept-fixture <reviewed-manifest-sha256>
```

There is no placeholder default consent. A wrong digest or noninteractive invocation without consent submits nothing. The seven declared fixture cases include one changed-only case; initial admission binds six initial/both cases at `max_age_seconds=600`, not the later changed value 60. The full public rules and manifest digest are retained with the accepted original goal.

The durable retry file defaults to `.threadline/admission.json`. Retry with the same file; a timeout or pending outcome is not permission to create a new request ID. Use a different `--request-record <path>` only for a deliberate new admission. Changed content behind an existing record is refused. Use `inspect --request <uuid>` to resolve the original receipt. `--project <uuid>` is needed when the authenticated user has multiple projects; membership is always checked server-side.

`--backend <url>` selects the local backend endpoint, not a database address. `--credential <path>` selects its private session file. `--fixture-manifest <path>` selects authored development data; its current default is `archive/plans/contracts/fixture-manifest.json`. Packaged fixture assets remain later delivery work.

The TUI displays backend connection/component state and the current goal, freshness constraint, criteria, task and source IDs. Its text input remains explicitly development-only echo. Admission/receipt detail lives in the simple CLI commands. Esc/Ctrl+C disconnects the TUI and restores the terminal. Stop the backend with Ctrl+C in its own terminal. Neither action deletes data; `docker compose stop` preserves services' named volumes.

## Verification

```sh
npm test
```

This builds sources before tests, avoiding stale `dist` evidence. Live-store cases are explicitly skipped unless opted in. To run them, provision dedicated PostgreSQL/FalkorDB stores and a restricted app role, then set the following environment variables through your private shell/configuration:

```text
THREADLINE_LIVE=1
THREADLINE_LIVE_PGPORT=<isolated-host-port>
THREADLINE_LIVE_PGDATABASE=<isolated-database>
THREADLINE_LIVE_PGUSER=<restricted-app-role>
THREADLINE_LIVE_PGPASSWORD=<private-app-password>
THREADLINE_LIVE_PGMIGRATIONUSER=<schema-owner>
THREADLINE_LIVE_PGMIGRATIONPASSWORD=<private-owner-password>
THREADLINE_LIVE_GRAPHPORT=<isolated-host-port>
THREADLINE_LIVE_DATA_DIR=<private-persistent-test-directory>
THREADLINE_LIVE_TENANT_SLUG=<unique-test-tenant>
```

Then run `npm test`. These tests create real identities/projects/admissions; never point them at a production database. Keep tenant slug and credential directory paired across retries. The CLI live case creates its own isolated tenant/directory and launches child CLIs without database/provider credentials.

M01 evidence includes actual fresh Compose volumes, SIGKILL/restart persistence, authenticated CLI admission, source access denial, current-version corruption denial, same-request concurrency, session expiry/revocation and simulated lost-ACK/pre-graph-crash recovery against real stores. No model request was made.

## Limits and troubleshooting

A healthy container proves process liveness; the backend separately checks schema, roles, graph constraints and pending intents. `FORCE ROW LEVEL SECURITY` does not constrain superusers, so the backend refuses application roles with SUPERUSER or BYPASSRLS.

`durable=true` describes implemented admission storage. SSE and `development.echo` remain process-local; `replayable=false` stays explicit. Provider/checker components are absent at M01 and do not make the two data stores unavailable. A pending or failed response must never be displayed as task acceptance.

Missing/unreachable backend: start it or correct `--backend`. Loose credential permissions: restore the private directory/file modes. Missing source or current graph version: inspection fails closed; do not infer a current rule from a historical receipt. Malformed legacy lane-test envelopes/topology are preserved and rejected, not silently upgraded into authority. Operator repair/reissue and broad recovery tooling remain later work.
