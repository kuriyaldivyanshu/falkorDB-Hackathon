# Track 2: unified core architecture contract

**2026-10-13 — proposed design, not implemented or benchmarked.** One product: a browser workspace plus thin Node package/CLI, one existing agent SDK/runtime and a reusable FalkorDB memory core. Railway hosting is a deployment option to validate; it does not change these contracts. This note supersedes conflicting earlier scope proposals without editing the master report.

## Six module boundaries

| Module | Owns | Must not own |
| --- | --- | --- |
| Identity/routing | Authenticated actor, tenant/project membership, workspace registration, source visibility and backend-derived graph selection | Model-provided identity or unrestricted graph names. |
| Graph ledger | Typed memory, history, immutable revisions, evidence links, event sequence, request receipts and guarded mutations | Agent execution or arbitrary generated Cypher. |
| Context selector | Current mandatory constraints, bounded dependency/evidence closure, applicability checks and inclusion explanations | Promoting uncertain assertions to accepted facts. |
| Deterministic coordinator | Claims/fences, handoffs, readiness, refresh delivery, completion gates, budgets and bounded child approval | A third model deciding authority or unbounded recursive spawning. |
| Runtime/tool adapter | Existing SDK execution, Builder/Verifier sessions, observed-message/tool capture and scoped repository tools | Database credentials or bypassing coordinator guards. |
| Browser/package delivery | Goal/requirement controls, history/evidence view, launch/configuration/diagnostics and event subscription | A separate task database, editor or second execution engine. |

One TypeScript backend can contain the first four modules and serve the browser. Modules are logical contracts, not six services. FalkorDB plus immutable evidence files/blobs is enough; a broker or second database is unnecessary for this MVP.

## Graph and tenant boundary

**Choose one graph per `(tenant, project)`**, rather than one global graph or one graph spanning every project in a tenant. This keeps each project's task state, event stream and receipts in one atomic mutation domain; different projects do not intentionally share that domain. Separate projects may still contend for machine resources, so no linear-scaling claim follows.

The authenticated backend resolves an opaque project ID to a graph key; the agent cannot supply a tenant or graph override. Register worktrees under that project deliberately. Use scoped service credentials/key permissions plus membership checks. A `tenant_id` label/property is not access control; command/key ACLs cannot enforce node-level user visibility. [ACL reference](https://docs.falkordb.com/commands/acl)

Within a shared project, private messages/findings require application authorization before retrieval, source/blob access and citation. Cross-project knowledge sharing is deferred; later publication would be an explicit copied/imported record with provenance, not an assumed cross-graph atomic transaction. Two synthetic tenants with colliding task IDs provide the isolation proof.

## Authoritative memory and state

Persist `Goal`, `Constraint`, `Decision`, `Task`, `TaskState`, `ArtifactVersion`, `Attempt/Event`, `Procedure`, `Session`, `Message`, source references and delivery cursors. Application revisions, supersession links, artifact digests, visibility and producer/source identity distinguish historical observations from current accepted authority.

- **Episodic:** captured attempts, tool outcomes, failures, checkpoints and handoff events.
- **Semantic:** accepted goals/constraints, scoped facts and decisions; proposals remain proposals.
- **Procedural:** one candidate workflow with steps, prerequisites and source evidence; validate reuse on a held-out compatible task before marking it verified.
- **History:** ordered observed messages and tool receipts survive sessions; summaries supplement them. Capture gaps remain visible. Do not store hidden reasoning.

The runtime records observations automatically even if an agent never invokes a memory tool. An agent may propose a decision or annotate an attempt; its assertion cannot rewrite a human constraint. Repository artifacts remain external truth that must be reconciled, not recreated from hashes.

## Critical transitions and delivery

One guarded mutation commits the state delta, immutable revision, Event and request receipt together. Check expected revision, owner/fence, applicability and request ID; repeat requests return the original receipt. Define these application guards explicitly: the query command's `version` parameter concerns schema caching. [Query command](https://docs.falkordb.com/commands/graph.query/)

Use committed Events as the outbox. Notify clients, then reconcile by scoped cursor-based pulls; persist context-insertion ACKs and deduplicate event IDs. Notifications alone are not reliable delivery, and an ACK is not proof of model understanding. Keep bounded queues/retries and typed conflict, stale-artifact, unavailable-memory and overflow errors.

FalkorDB's audited MVCC implementation publishes committed snapshots with one writer per graph. Concurrent requests therefore do not imply parallel same-graph writes. [Pinned MVCC source](https://github.com/FalkorDB/FalkorDB/blob/v6.0.2/graph/src/graph/mvcc_graph.rs)

## Execution versus data

Use **one editable Builder**, a Verifier without editing tools, deterministic tests and optional bounded read-only children. “One Builder writer” means one coding editor; Verifier/history clients still submit memory writes through the service. Verifier receives an immutable artifact snapshot matching its receipts. Completion is a guarded service transition; a favorable model verdict alone cannot complete work.

The graph selects applicable lessons, dependent tasks and workers needing refresh. Agents choose investigations, patches and checks. The coordinator enforces permissions and readiness. Children require a recorded purpose, scoped packet, budget and claim; use one child level and a global four-worker ceiling. Deeper recursion is deferred.

A hosted control/data plane may serve the browser/API and FalkorDB while a registered local package worker executes against its authorized repository. Keep execution/model credentials on that worker where possible; keep database credentials server-side. Authenticate both browser and worker connections. The package does not grant a hosted server unrestricted access to a laptop. A hosted demo worker may run only the fixed authored repository if separately isolated and tested. Live updates support the same cursor/reconciliation protocol.

Fresh continuation starts a genuinely new session, restores the current graph packet, reconciles files/unknown outcomes and obtains a new claim. A changed requirement supersedes old authority, traverses affected evidence/task/context links and blocks stale completion. Neither graph atomicity nor a fence makes external filesystem/process effects exactly once.

## Unified scope and proof

One controlled SDK/runtime is required. Codex/Claude adapters are gated secondary work; two adapters are not a launch prerequisite. Two core roles are required; optional children must not jeopardize recovery. Use **4/8/16 protocol clients** for the declared load test; label simulations separately from 2–4 actual agents. The older 32-client proposal is optional, not another acceptance threshold.

Prove fresh recovery after interruption/requirement change, current verification evidence, held-out procedure reuse, history restart, stale-owner/duplicate handling, missed-notification recovery and two-tenant denial. Report queue p95, request/delivery latency, throughput and correctness under pinned settings. Compare equal-information graph and versioned-file baselines. Declare/test persistence; a mounted volume alone is not crash-durability evidence. [Durability](https://docs.falkordb.com/operations/durability/)

For four humans including two DevOps members: one owns ledger/context, one runtime/tools/browser; DevOps one owns deployment/auth/secrets/persistence and DevOps two owns package/worker lifecycle, load/recovery checks and reproducible release. Share integration tests daily. Day 1 freezes contracts and one real agent round trip; Day 2 proves continuity/verification; Day 3 validates procedure, isolation and load; Day 4 fixes, packages and records evidence.
