# Track 2: reliable shared memory for bounded agent swarms

**2026-10-13; research and proposed contract only.** Official documentation was rechecked; previously captured v6.0.2 source was reinspected. No implementation, installation or benchmark was performed. Pin the engine/client versions and verify this contract after the event begins.

## Answer and guarantee boundary

FalkorDB is a plausible authoritative memory store for a small swarm. The coordinator must implement delivery, spawning and conflict handling. “Fast” remains a measurement, and a graph cannot guarantee that agents understand or correctly use a finding.

**Verified:** the audited engine uses committed snapshots and one copy-on-write writer per graph. Ordinary writes pass through a serialized queue; certain contention paths return retryable errors. [MVCC source](https://github.com/FalkorDB/FalkorDB/blob/v6.0.2/graph/src/graph/mvcc_graph.rs), [Execution source](https://github.com/FalkorDB/FalkorDB/blob/v6.0.2/src/graph_core.rs), [Writer-abort source](https://github.com/FalkorDB/FalkorDB/blob/v6.0.2/src/query_session.rs)

Consequently, more agents can issue concurrent requests, but adding writers cannot create unlimited same-graph write throughput. Atomic database publication, network delivery, model use and filesystem effects are separate guarantees.

## Narrow architecture

Use the planned local browser app and existing runtime with **one deterministic coordination service**. All workers use its scoped domain API; only the service owns database credentials. The graph is the durable authority. Browser/runtime notifications are hints to fetch committed changes, not a second source of truth.

Persist this application schema:

| Record | Required information and relationships |
| --- | --- |
| Task / ChildTask | Goal, accepted constraint revision, parent, dependencies, depth, status, owner/fence, budget and workspace. |
| Finding | Typed assertion/observation/proposal, producer, source references, visibility and applicability: branch/worktree plus artifact digests. |
| Source / ArtifactVersion | Message or tool receipt, content digest, locator, observed revision and provenance. |
| TaskState | Immutable application revision, checkpoint and current accepted decisions; explicit supersession. |
| Event / DeliveryCursor | Application sequence, request ID, committed change references; recipient's acknowledged/injected position. |

A finding from an experimental branch is not automatically valid on the integration branch. Preserve conflicting assertions; do not resolve them by last writer wins. A verifier's verdict is evidence, while the service checks whether required current evidence permits completion.

## Atomic sharing protocol

1. A worker submits a small typed finding/checkpoint with source references, expected task revision, ownership fence and application request ID. Never publish every streaming token as a separate graph write.
2. The service validates scope, evidence, size and allowed transition. Uploaded evidence blobs must exist and match their digests before graph references are committed; blob storage is not magically part of the graph transaction.
3. **One guarded graph mutation** creates the Finding, source/applicability relationships, immutable state revision and Event, increments the application sequence, and advances the current-state pointer. A conflict yields no successful transition. Duplicate request IDs resolve to the original receipt.
4. After commit, notify relevant runtimes with event sequence and changed IDs. If the service crashes before notification, the committed Event remains discoverable.
5. Each runtime calls scoped `pull_updates(cursor, task, budget)`, applies the resulting context changes at a safe model/tool boundary, and acknowledges the injected position. Reconnect and periodic reconciliation pull everything since the cursor, deduplicate by event ID, and rebuild current context if retention has expired.

This is **at-least-once delivery with idempotent application** as a proposed design, not an exactly-once claim. An ACK proves receipt/context insertion, not understanding. A relevant revision change invalidates old evidence and makes subsequent guarded edits/completion fail until refreshed.

Keep project sequence, Event and state change in the same graph; separate graph writes cannot form this atomic unit. Redis transaction grouping does not supply rollback for execution-time command errors. [Redis transaction semantics](https://redis.io/docs/latest/develop/using-commands/transactions/)

Use application revisions: the `GRAPH.QUERY version` argument concerns cached schema mappings, not task concurrency. [Query command](https://docs.falkordb.com/commands/graph.query/)

## Graph-governed spawning and targeted dissemination

An agent may **propose** a child task with a purpose, expected output, parent and evidence. The service permits it only when accepted scope, dependency readiness, ancestry/deduplication and depth/concurrency/budget limits pass. Suggested core defaults are depth one and four live model workers globally, counting Builder, Verifier and waiting parents. Depth two is a separately gated stretch experiment. These are product limits, not engine limits.

Atomically record the approved child and launch intent, then let the runtime start it. Launching a process is outside the graph transaction. Reconcile uncertain launch outcomes by stable child/launch IDs and worker registration; do not claim exactly-once process creation. A child must obtain its current claim before doing guarded work.

The child receives a bounded packet: governing goal/constraints, its parent checkpoint, dependency closure, applicable findings, artifact versions and relevant source messages. Private parent scratch is excluded unless explicitly published. The graph persists who spawned whom and why; the runtime actually runs agents.

When a helper changes, traverse its linked dependent tasks and owners. Notify the API and CLI workers whose work depends on it; unrelated workers need no context injection. Relationship paths explain the recipients. Notifications can miss a changing recipient set, so regular task-closure refresh remains necessary. Urgent constraint/ownership changes are checked before subsequent guarded actions.

Children publish sourced results and completion evidence; readiness derives from current accepted dependency states, not a child's confident prose. Parent Builder can inspect contradicting findings or request verification. Use isolated Builder workspaces and guarded integration; database ownership fences cannot retract an already-running external command or block unrestricted native filesystem tools.

## Keeping the sharing path small

Start retrieval from task/artifact IDs, restrict edge types/hops, and return bounded projections. Use exact identity/sequence indexes and confirm plans; range indexes support equality/range predicates. [Range indexes](https://docs.falkordb.com/cypher/indexing/range-index)

Keep model extraction and embeddings outside the critical commit/delivery path. Batch related observations, while retaining per-operation IDs. Bound application queues and report overload rather than accumulating unlimited work. Separate project graphs reduce one shared hotspot, but do not imply linear scaling: CPU, memory, I/O and engine locking remain shared resources.

**Version caveat:** audited v6.0.2 code ignores the per-query timeout for writes. Client timeout/disconnect therefore means an unknown outcome until receipt/state reconciliation, not proof of rollback. [Timeout implementation](https://github.com/FalkorDB/FalkorDB/blob/v6.0.2/src/graph_core.rs)

Declare RDB/AOF and disk configuration, test restart/restore, and distinguish graceful restart from crash durability. [Persistence](https://docs.falkordb.com/operations/durability/)

## Falsifiable speed and reliability measurement

After the event starts, run **4, 8 and 16 clients** against one shared graph, then independent project graphs. Label clients as real runtime workers or simulated protocol clients. Simulators establish contention/delivery behavior, not coding competence. Test read-heavy and balanced mixes plus a simultaneous write burst; disclose request mix, graph size, payload size, hardware, engine/client versions and persistence settings.

Report separately:

- Admission/queue delay p50/p95, database request wall time, bounded retrieval time and commit-to-context-injection p50/p95.
- Committed writes/second, successful reads/second, queue depth, expected revision conflicts, retries/timeouts and unexpected errors.
- Missing/duplicate applied events, stale-owner acceptance, cross-tenant leakage, wrong-branch finding use and stale completion evidence.

Instrument application enqueue/dequeue timestamps. Database wall time includes unobserved internal queuing; do not label it pure execution time or infer internal queue p95 by subtraction. Keep model generation and external test time separate. For remote workers, avoid subtracting unsynchronized host clocks.

Inject duplicate requests, dropped notifications, lost commit acknowledgments, worker/service restarts, revoked claims and requirement changes. Assert convergence to committed state after reconnect, no double-applied finding and rejection of stale completion. Compare graph closure against matched-input JSON/files and broadcasts under the same context budget. The decisive proof is a dependent worker changing its plan/checks correctly after a sourced update, alongside measured dissemination delay—not an animated swarm or an unmeasured “instant memory” claim.
