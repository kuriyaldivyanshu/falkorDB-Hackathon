# M03 shared implementation brief

Prepared 16 October 2026 against merged `main` at `d09f35e`. Read this before either lane prompt. M02 is merged, including provider setup and the run authorization/reconciliation review fixes. This brief assigns work; it does not claim M03 implementation or acceptance.

## Outcome and source of truth

Deliver original permitted model/tool evidence as immutable available bytes, durable ordered capture, idempotent FalkorDB provenance and authorized bounded source inspection. A disconnected TUI must recover persisted events or show an explicit gap. This prepares continuity; it does not implement successor sessions yet.

The [master M03 checklist](../track2-implementation-checklist.md#m03--durable-capture-artifact-sources-and-graph-admission) controls task IDs. The [blueprint](../track2-development-blueprint.md) controls product contracts. Read [current M02 seams](../../../docs/m02-development.md), [provider setup](../../../docs/provider-setup.md) and repository `AGENTS.md` before changing code. Consult [SQL reference](../schema/postgresql-core-reference.sql), [graph dictionary](../schema/graph-field-dictionary.md), [development profile](../contracts/development-profile.json) and [episode schema](../contracts/memory-episode.schema.json) for the specific feature being implemented. Executed migrations and tested graph queries determine what exists today; references contain future features.

## Working agreement

Both lanes work on M03 in this same checkout, feeding one combined branch/commit after joint verification. Record the actual starting SHA and dirty paths. Preserve other work. Neither lane creates branches, stages, commits, pushes, resets or stashes. Integration ownership stays with the coordinating user/root agent.

Start with the feature code and existing workspace conventions. Add dependencies or configuration only when implementation requires them. Keep backend logic out of CLI components and HTTP details out of domain/storage modules. Update each lane's own checklist only after observing the stated behavior; the integration owner updates the master and joint checks. Handoffs belong in chat with task IDs, changed paths, commands/results and remaining subgates.

## Ownership and first coordination gate

Agent A owns shared capture/source/replay protocol declarations, capture/artifact/outbox/projection storage, additive migrations, graph ingestion, permission services, `domain/execution.ts`, `storage/model-requests.ts`, `runtime/managed.ts` and backend composition/registration in `index.ts`, `api/server.ts`, `api/routes.ts`. Keep changes to the existing runtime narrowly tied to durable capture.

Agent B owns runtime/provider capture adapters, `runtime/loop.ts` and history consumption, bounded chunk buffering, new history/source/replay HTTP route modules, `api/events-stream.ts`, model-tool exposure and all CLI/TUI work. B may change provider drivers only where necessary to emit permitted visible evidence. A exposes ports; B does not add direct SQL/graph access to CLI code.

Before editing another lane's file, send the owner the required change and agree who applies it. A edits the public capture contract; B reviews it and implements consumers. Keep any registration edits in A's files with A. Test ownership follows implementation ownership; B owns the assembled M03 live test and A supplies service/fault-injection helpers.

First deliverable: A publishes compiling public types and service ports, with a small compiling consumer supplied by B. Record the agreement in a concise code comment or existing implementation documentation, rather than creating competing contracts. Agree on all of these before wiring the loop or transport:

1. Versioned capture kinds, stable source keys and correlation fields: tenant/project/run/task/session, logical request, physical attempt, call/execution ID, graph epoch and accepted revisions. Server resolves authority fields. Distinguish absent facts from known zero.
2. Artifact publication plus capture/outbox transaction boundary and idempotent return values. Same key and same content returns the original identity/position; changed content under that key is a conflict. Define ownership of existing M02 capture rows and new result events so one boundary has one record.
3. Source metadata/range and history services: permission checks, availability, digest, total bytes, exact returned range, truncation, typed errors and page limits. Choose a representation that preserves arbitrary byte ranges without UTF-8 corruption.
4. Replay cursor scope and encoding, endpoint paths, bounded page/frame limits, authorization and retention/gap behavior. Existing unversioned routes are real; historical `/v1` examples are proposals. Choose and document actual new routes before B builds a client.
5. Lifecycle start/stop, retry limits, capture-pending states and dependency injection for deterministic testing. Account for the existing run budget when adding a tool schema/result.

B can build the isolated buffer and UI state reducers while A builds the foundation. Contract-dependent integration waits for the compiling contract; it must not use guessed fields or stale `dist` files.

## Durable capture rules

Extend `storage/artifacts.ts`, the request journal and existing tool capture; do not create a second journal. Preserve exact submitted request bytes and complete permitted terminal output. Capture tool intent before execution, result before dependent inference, and complete tool batches before release. A capture/outbox SQL failure blocks dependent success/dispatch. Graph admission may remain pending with a durable outbox; it cannot be presented as available sourced memory before reconciliation. Existing graph authority checks continue to fail closed.

Atomic filesystem publication and a SQL transaction are separate commits. Define and exercise orphan, missing-file, mismatched-content and restart behavior. Content equality does not grant access: tenant/project/owner visibility remains on each Source even if physical bytes share content identity. Never return a filesystem locator to a client or model.

Exclude credentials, authentication headers, provider connection/validation payloads and hidden reasoning. The configured model request body and supported visible output remain evidence, with their original safe bytes and IDs. Do not claim a filtered/normalized object is an original wire transcript. Keep capture of provider setup completely outside this pipeline.

The four positions are distinct: session capture sequence, project graph Event sequence within an epoch, SQL projection consumer offset, and client replay cursor. A process-local SSE number is none of these. Allocate capture sequences safely under concurrency; a retry does not advance them. Project graph mutation, receipt and Event must commit atomically; graph-to-SQL projection rows and contiguous offset must commit in one SQL transaction. Notifications only wake readers.

Use stable operation IDs and digest-bound receipts to reconcile a graph commit whose acknowledgement was lost. Replay-safe capture ingestion is not permission to resend inference or re-execute a tool. Preserve unresolved M02 attempts/reservations and run ownership checks.

Use profile limits: bounded batches/timeouts, 30-second outbox lease, 250 ms polling and replay-safe retry delays of 250/1000/2000 ms where the development profile specifies them. Resolve the exact batch/retry ceiling from the profile, and test exhaustion/quarantine. Inject clock/scheduling in tests. Shutdown stops new work and bounds drain time.

## Scope boundaries

M03 adds only the source branch of `memory.retrieve`, alongside the three workspace tools. Search-based memory/context construction is M05. Registered-command/stdout support is capture plumbing with synthetic observations; an executable shell/command tool is M06. Partial chunks are never executable tool arguments or proof of a completed result.

Keep structured checkpoints/summarization out of M03 (M04 handles deterministic checkpoints); do not add RLM, spawning, OAuth, editing, a graph renderer or protected completion. An observed failure or unknown effect remains an observation; no guessed root cause, fabricated environment identity or model prose becomes authority.

## Verification and joint acceptance

Build after changed shared contracts and before running compiled tests. Run affected module/integration tests; broaden only for changes affecting shared contracts, migrations, lifecycle or composition. No repeated unrelated suite runs, paid inference, model validation calls or development-volume resets. Use an explicitly injected provider and isolated PostgreSQL/FalkorDB tenants/data directories. Preserve owner-only credentials and non-owner application-role/RLS enforcement.

Joint gates are [M03J01–J05](../track2-implementation-checklist.md#m03--durable-capture-artifact-sources-and-graph-admission):

- J01: replay identical captures/outbox operations, including concurrent duplicates. Inspect exact entity counts, artifact references and contiguous positions. Not every event needs every graph label; assert the correct entities for each kind.
- J02: interrupt after SQL capture commit and after graph commit before acknowledgement. Restart workers, recover receipts, finish projection and prove no duplicate Source/Observation/Attempt or skipped event. Also fail a projection transaction and prove its cursor did not advance alone.
- J03: remove a synthetic artifact; both model and CLI range reads report unavailable and cannot treat its digest as recovered content. Exercise digest mismatch and cross-scope denial.
- J04: actual CLI/TUI reconnect using an earlier durable cursor, ordered catch-up/live handoff without silent loss, revocation during delivery, epoch/invalid cursor handling and bounded slow-consumer behavior. Show refresh guidance for a real gap.
- J05: run a complete model → read tool → next model → final report using an injected provider and real stores. Compare actual stored input/result bytes and IDs, graph provenance and transport inspection; inspect for excluded secrets/reasoning. Simulate SQL outage and verify no dependent dispatch succeeds.

Module tests alone do not close assembled gates. Keep every unchecked subgate named. Report exact commands, versions, pass/fail/skipped counts and concrete database observations without secrets. When both lanes pass, the integration owner reconciles all three checklists and reviews the combined diff before the single branch/commit workflow.
