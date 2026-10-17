# Storage recovery and installation safety

This describes the socket-loss and setup fixes added to the episodic/procedural memory checkpoint. It does not qualify native Codex integration.

## Graph connection ownership

Threadline creates its Redis connection and attaches its error listener before opening a socket. It retains one client per store and shares concurrent connection attempts. Closing a store destroys its socket and settles any pending connection attempt; a late connection cannot reopen a closed store.

FalkorDB 6.8.0's asynchronous factory creates an internal emitter before returning it. Attaching a listener after that factory resolves leaves a construction-time error window. The store avoids that factory and reuses the same pinned FalkorDB command codec, standalone adapter and public Graph implementation over an explicitly declared `@redis/client` 5.12.1 dependency. Neither query parsing nor receipt semantics is duplicated.

The bridge uses internal FalkorDB command/standalone modules. FalkorDB is pinned to 6.8.0 for that reason; an upgrade requires checking those imports and rerunning connection, graph-codec and receipt verification. Only a standalone local server is supported by this bridge. Cluster and Sentinel routing are not qualified.

## Bounded waits and honest readiness

Disconnected commands are refused rather than placed in an offline queue. The connection queue is capped at 128 commands. Connection establishment uses the configured connect deadline; graph operations and probes have a five-second complete-reply deadline. Node-redis's queue timeout alone is insufficient because its timer is removed once a command is sent.

A complete-reply timeout destroys the socket to reject outstanding work and prevent late replies from corrupting subsequent request/response ordering. A write may already have committed when its reply is lost. Such a timeout is ambiguous, and the worker reconciles the original operation receipt before retrying. A socket closing during a write is also ambiguous; it is not evidence that nothing was submitted.

Worker graph readiness starts false. It requires a successful completed probe, a ready transport and a sufficiently recent result. A cached success cannot keep reporting readiness indefinitely while graph I/O is stalled. SQL-backed source/history operations continue independently, and pending/leased/ambiguous counts retain their distinct meanings. Counts are sampled, not an instantaneous transaction with a particular HTTP request.

## Installation target guard

Use an explicit absolute installation root for development commands:

```sh
node packages/cli/dist/index.js init --home /absolute/isolated/installation
node packages/cli/dist/index.js serve --home /absolute/isolated/installation
```

Root precedence remains `--home`, then `THREADLINE_HOME`, then the default user installation. `TL_HOME` is not a supported configuration variable.

Initialization validates configuration and incoming SQL access, then compares the persisted storage target before migrations, source probes or owner bootstrap. PostgreSQL host/port/database/roles/SSL and graph host/port/user identify the target; the HTTP port does not identify a database. A mismatched, malformed or unreadable existing configuration refuses replacement. Only a missing file is treated as absent.

An intended replacement requires the explicit `THREADLINE_REPLACE_INSTALLATION=true` signal for that invocation. Prefer a separate installation root when connecting to another database. The replacement signal does not delete old database records or source files, and does not migrate existing memory between stores.

Configuration and secrets are written after database validation/migrations and bootstrap succeed. Guard refusals and checked credential failures preserve the existing installation files. Setup is not an atomic transaction across SQL and filesystem storage: a later migration/bootstrap/file-write failure can leave partial database/source changes. There is no claim of universal zero-write rollback.

## Verification records

The tracked [assignment result](assignments/agent-a-n02b-evidence-02.md) records the exact observed checks, temporary evidence paths and remaining limitations. No permanent package test suite was added. Coordinator configuration/credential files are not verification targets; installation checks use synthetic roots only.
