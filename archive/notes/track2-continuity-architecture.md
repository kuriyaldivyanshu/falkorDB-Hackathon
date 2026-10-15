# Track 2: coding-agent continuity with selective shared memory

**Research date: 2026-10-11. Status: architecture proposal, not an implemented or tested system.** Primary API/source checks supplement [the engine dossier](falkordb-technical-dossier.md) and [the capability map](falkordb-agent-capability-map.md). No prototype, database experiment, or submission code was run before the permitted event start.

**Resource/scope update:** four members are now confirmed. The older one-adapter schedule below is a fallback, superseded by [the portable product and requirements decision](track2-package-and-requirements-decision.md): Codex and Claude adapters, explicit persisted conversation history and one procedure with held-out reuse. The graph/revision/evidence constraints in this report remain applicable.

## The narrow promise

Build a memory service that lets a coding agent resume **a recorded task** after a fresh conversation, with the right constraints, decisions, dependencies, code evidence and useful attempts. Let another authorized agent receive a bounded handoff while retaining private scratch information outside shared memory.

The service restores a task's recorded working state and reconciles it against the repository. It cannot recover thoughts, instructions or tool outcomes that were never recorded. It cannot guarantee a host will invoke it before compaction; host integration and invocation reliability require separate verification. A convincing demo should say “fresh-session recovery from committed checkpoints,” unless an actual host compaction integration has been demonstrated.

**Recommendation:** use FalkorDB directly for the authoritative task ledger. Keep LLM-extracted recollections as proposed knowledge. Graphiti may enrich episodic recall later, but a model's interpretation of a conversation must not independently mark work complete, overwrite a hard constraint or transfer ownership.

## What is verified about the foundation

* Individual graph mutations are atomic; reads observe committed snapshots; same-graph writes are serialized. The tagged dispatcher contains an explicit write queue. A sequence of client queries is not one graph transaction. [Concurrency docs](https://docs.falkordb.com/design/concurrency), [v6.0.2 graph execution](https://github.com/FalkorDB/FalkorDB/blob/v6.0.2/src/graph_core.rs)
* Tagged source also contains a retryable writer-slot contention path, including when an inline writer holds the MVCC slot. Handle transient contention with bounded retries; treat stale application revisions as conflicts requiring reconciliation. Neither single-query atomicity nor writer serialization supplies external-action exactly-once semantics. [Query-session source](https://github.com/FalkorDB/FalkorDB/blob/v6.0.2/src/query_session.rs), [Graph execution](https://github.com/FalkorDB/FalkorDB/blob/v6.0.2/src/graph_core.rs)
* `GRAPH.QUERY` supports parameters. Its optional **`version` is for schema-cache consistency**, not optimistic concurrency on a task's business state. We must define our own revisions and fencing tokens. `GRAPH.RO_QUERY` rejects writes. [Query command](https://docs.falkordb.com/commands/graph.query), [Read-only command](https://docs.falkordb.com/commands/graph.ro-query)
* Redis `MULTI/EXEC` does not undo successful commands when another command fails during execution. Use a single guarded graph mutation for coupled ledger changes. [Redis transaction errors](https://redis.io/docs/latest/develop/using-commands/transactions/)
* Graph-key ACL patterns and command permissions are available. They do not provide per-node authorization within a graph. Disk recovery depends on configured persistence; a successful graph write and a mounted volume alone do not prove crash durability. [ACL reference](https://docs.falkordb.com/commands/acl), [Durability](https://docs.falkordb.com/operations/durability/)

**Implementation acceptance gate:** pin the engine and client, then verify guarded-update semantics, duplicate IDs, stale claims, visibility and restart recovery. Source inspection is evidence for the design, not a substitute for those probes.

## Proposed graph model

These types and rules are application design. Every authoritative record has an opaque stable ID, scope, producer, schema version, event reference and evidence locator. Time orders observations; application sequence numbers order committed transitions. Preserve historical versions instead of silently replacing them.

| Type | Essential meaning and evidence | Important relations |
| --- | --- | --- |
| `Goal` | User-approved desired outcome and acceptance criteria; source message | `DECOMPOSES_INTO`, `GOVERNED_BY` |
| `Constraint` | Exact requirement/prohibition, scope and authority; explicit acceptance or supersession | `APPLIES_TO`, `SUPERSEDES` |
| `Decision` | Accepted approach, brief rationale and rejected alternative; approval/source reference | `IMPLEMENTS`, `REJECTS`, `SUPPORTED_BY`, `SUPERSEDES` |
| `Task` | Stable work unit; parent/dependencies and declared resource scope | `SUBTASK_OF`, `DEPENDS_ON`, `BLOCKED_BY`, `CURRENT_STATE` |
| `TaskState` | Immutable revision: status, owner, fence, lease, checkpoint and expected artifact versions | `PREVIOUS_STATE`, `DERIVED_FROM`, `HAS_ARTIFACT` |
| `Artifact` | File/diff/test receipt at an exact revision; content hash, commit/base and environment digest | `PRODUCED_BY`, `VERIFIES`, `INVALIDATED_BY` |
| `Attempt` | Hypothesis/action, inputs, outcome and useful failure; tool receipt, not invented success | `ATTEMPTS`, `USES`, `PRODUCES`, `RULED_OUT_BY` |
| `Event` | Append-only typed transition; request ID, actor and causal predecessor | `CHANGES`, `CAUSED_BY`, `EVIDENCED_BY` |
| `Procedure` | Reusable instruction with applicability conditions, examples and verification history | `VALIDATED_BY`, `APPLIES_TO`, `SUPERSEDES` |

A small `Workspace` control record holds the shared memory generation; session identity can be event metadata initially. Avoid building a repository-wide symbol graph in the MVP. Link only files, tests, tasks and explicit dependencies that the chosen feature needs.

Keep substantial tool logs and file contents in immutable content-addressed blobs or existing repository artifacts; put their digest, permitted locator and meaningful relationships in FalkorDB. A file path without a digest is not reproducible evidence. The graph stores scalar fields rather than arbitrary nested property maps; serialize an opaque payload only when traversal does not need its structure. [Property types](https://docs.falkordb.com/datatypes)

An accepted decision is distinct from an agent proposal. A successful test receipt is valid for its tested code/environment. A procedure remains provisional until a later execution verifies its stated applicability. A failed attempt may become useful after code or environment changes, so recall “failed under these conditions,” not “never try this.”

## Recording, revision and correction

**Proposed protocol:** the host/harness submits typed events at meaningful boundaries: a new requirement, an accepted decision, a useful attempt/result, a changed artifact, a task checkpoint, a handoff or verification. Capture brief user-visible rationales, observations and next-step contracts; do not claim to preserve private model reasoning.

Each state-changing request carries `request_id`, `task_id`, `expected_task_revision`, `owner_session`, `fence`, and evidence references. The service validates the transition and performs one parameterized mutation that checks the expected state, writes the event/new immutable state, updates the current pointer and advances the shared generation. An unmatched guard is a conflict, not successful completion. Repeated request IDs return the original receipt rather than creating another transition. The exact Cypher shape and response behavior remain a Day 1 test.

For the narrow MVP, one backend process coordinates mutations and is the only writer credential holder. This reduces orchestration complexity without replacing database guards. New goal/constraint versions explicitly supersede older ones. If a source or file revision changes, invalidate dependent evidence or mark it for re-verification; do not erase the historical observation.

Raw transcripts can be retained as evidence, but they are not automatically authoritative state. Missing capture must be visible: “last verified checkpoint at revision 17; workspace changed since then.” A summary that omits a constraint does not delete that constraint.

## Bounded task context closure

**Design inference:** start from an exact task ID, not an embedding query. Traverse approved relationship types to assemble:

1. Its active ancestor goal, governing constraints and acceptance checks.
2. Accepted decisions whose scope applies to this task, including relevant rejected approaches.
3. Dependency/blocker state and the responsible agents or artifacts.
4. Relevant artifact versions, the latest checkpoint and valid test receipts.
5. Useful prior attempts matching affected files, code/environment conditions or the same unresolved hypothesis.
6. Applicable verified procedures and explicit unresolved questions.

Use limited depth, relation allowlists, deduplication and per-type caps. Retrieve governing constraints deterministically before optional semantic matches. A provisional 3,000-token pack can prioritize required state, then evidence excerpts and optional recall. If required material exceeds the budget, report overflow and narrow the work or load another explicit section; silently dropping prohibitions is unacceptable.

Return IDs, source links, inclusion reasons, omitted optional counts, `task_revision`, shared generation, branch/base and file fingerprints. An optional vector search can seed related attempts/procedures; its matches still pass scope, validity and evidence checks. A text match does not make an unrelated private memory shareable.

A single read query provides a coherent graph snapshot. If packet assembly uses several queries, compare the shared generation before and after and retry on change; do not claim a multi-query snapshot. Before coding, inspect actual workspace status and fingerprints. Before publishing completion, re-check the task fence, governing state and tested artifacts. A changed generation can trigger closure recomputation; it need not prove every unrelated task change invalidated the work.

FalkorDB's documented eager-write `LIMIT` behavior means output limits are not a mutation safety boundary. Cap rows before mutations, and use explicit bounds in read tools. [Known limitations](https://docs.falkordb.com/cypher/known-limitations)

## Safe handoffs and selective sharing

**Proposed ownership protocol:** `claim_task` checks state/expected revision and issues a monotonically increasing fence plus a server-controlled lease. A handoff first records an offered recipient, immutable packet/evidence references and next-step contract while revoking the old fence. `accept_handoff` checks the offer revision, grants a new fence and acknowledges ownership. Expired or interrupted offers can be recovered through a defined transition. A stale worker cannot complete the task through the service.

Lease expiry does not stop a process or undo its file writes. Fencing protects only operations that check the token. Native agents with unrestricted shell/file tools remain outside that guarantee. For the MVP, workers edit isolated repository copies/worktrees and one integrator checks base revision, diff, overlaps and test evidence before adopting changes. Graph coordination does not merge conflicting code automatically.

Separate tenants by server-derived graph keys and restricted credentials. Never accept a graph name selected by the LLM as authorization. Shared project memory contains accepted goals/decisions, published observations, public task state and approved artifact evidence. Private scratch stays in a separate agent graph or local store. Give each worker only its authorized scope plus the common authoritative closure.

`publish_memory` copies an approved typed claim into shared memory with a publication ID and source-access policy; it does not expose the entire scratch transcript. If private and shared graphs are separate, publication is not a distributed atomic transaction. Make the shared receipt authoritative and retries idempotent; failure must not reveal a private source through a public citation. Test both retrieval and citation access.

## Graphiti and GraphRAG: exact role, exact cautions

**Verified:** Graphiti v0.30.2 exposes `add_episode(...)` with `reference_time`, `group_id` and optional custom entity/edge types. `search(...)` accepts group IDs, result limits, a center entity and filters; `search_(...)` exposes richer recipes. The Falkor driver chooses database graphs, builds range indexes before full-text indexes and clones drivers for scoped requests. [Tagged Graphiti API](https://github.com/getzep/graphiti/blob/v0.30.2/graphiti_core/graphiti.py), [Tagged Falkor driver](https://github.com/getzep/graphiti/blob/v0.30.2/graphiti_core/driver/falkordb_driver.py)

Its temporal edge fields and episode attribution can help recall what was asserted and when. They do not give a task state machine, file lock, schema-specific completion proof or automatic access policy. A `group_id` is routing/scoping, not a user authorization system. [Tagged edge model](https://github.com/getzep/graphiti/blob/v0.30.2/graphiti_core/edges.py)

**Recommendation:** leave Graphiti outside the critical MVP path. If added, serialize authoritative publication from recalled episodes and keep extraction failures from blocking checkpoint commits. Do not infer that per-query database serialization makes a multi-step extraction/merge pipeline atomic.

GraphRAG SDK document updates are a separate ingestion concern. Its documentation specifically warns to keep modified-document concurrency at **1** unless shared-entity safety is independently established. That restriction is not a general maximum number of coding agents. [Incremental update warning](https://docs.falkordb.com/graphrag/incremental-updates)

## Four-day MVP after the permitted start

**Keep:** one coding host/adapter, one authored small repository, two worker identities, one shared workspace graph, private scratch separation, typed checkpoint/attempt/handoff tools, a bounded restore pack, evidence verification and a visible trace. Support a single feature with two dependent subtasks and at least one useful failed attempt. All actions stay within the controlled development workspace.

**Defer:** universal agent adapters, automatic extraction of arbitrary transcripts, repository-wide symbol ingestion, every-shell-command tracking, learned memory policies, cross-tenant procedure sharing, production distributed locks and autonomous external deployment.

| Day | Concrete outcome |
| --- | --- |
| 1 | Pinned engine/client; schema and typed mutation/restore tools; passing guard, duplicate-event, tenant and persistence probes. Write expected benchmark outcomes before optimizing retrieval. |
| 2 | One agent records a feature task, constraint, decision, failure and checkpoint. A deliberately fresh conversation restores context, reconciles files and finishes against independent tests. |
| 3 | Add selective publication and two-worker handoff/claim races. Use isolated edits, reject old fences, and verify integration. Run memory-removal comparisons. |
| 4 | Repair failures, rerun affected cases, prepare a reproducible setup and short demo with source/evidence links and measured results. |

**Demo:** Agent A learns that one approach breaks a user constraint, records the failed attempt and proceeds to a checkpoint. End its conversation. Agent B starts with only the task ID and tool access; the graph restores the constraint, decision, failure and artifact dependency. B completes a dependent change. An old A claim is rejected. A private scratch note is absent from B's pack. Show independent tests and exact stored receipts. A separate deliberately unrecorded observation should remain unrecoverable, making the boundary visible.

## Falsifiable evaluation

Use authored tasks, known acceptance outcomes and declared interruption points. Test two capabilities separately: **selection quality** with the same canonical events, and **end-to-end capture/recovery** with real tool traces. Otherwise improvements may merely reflect unequal checkpoint content.

Compare the same model, tools, source facts and token budget across:

* Fresh agent without persistent memory.
* A concise checkpoint JSON/file plus recent transcript.
* Flat/vector retrieval over the same events, including relationship facts rendered as text.
* FalkorDB with typed task closure and shared-memory rules.
* Structured JSON adjacency files with the **same closure algorithm** and correct locking/atomic file replacement. This is the strongest test of whether a graph database helps beyond an equivalent graph representation in files.

Do not remove relationship facts from the flat baseline and call the result a fair graph-removal test. Separate the value of relational retrieval from the choice of storage backend. On a small single-agent task, a well-designed JSON checkpoint may match FalkorDB; the graph's proposed advantage is selective dependency closure and coordinated evolving state, not magical memory accuracy.

Predeclare at least twelve task/interruption cases and eight protocol cases. Include an obsolete decision, a changed file after a passing test, a corrected procedure, misleading similar attempts, lost acknowledgments, duplicate events, simultaneous claims, expired leases, interrupted handoffs, backend restart, cross-tenant collisions and private-source citation attempts. Run repeated model trials when cost allows; report sample size, individual failures and variability rather than percentages without denominators.

Measure completed-task correctness, constraint violations, stale-evidence use, repeated invalid attempts, unsupported completions, duplicate/conflicting ownership, private leakage, restore tokens, time, tool calls and cost. A procedure test must hold out a later task and change the code/environment when testing applicability. No extra training/context for the favored arm.

**Reject or simplify the design if:** JSON with equivalent selection matches its useful outcomes and coordination; context packs become bloated; capture omissions dominate recovery; or successful demos require agents to obey undocumented habits. A graph viewer alone is not proof of useful memory.

## Limits to state plainly

The service cannot recover uncaptured context, establish that an agent's claim is true without evidence, make deleted files reappear from hashes, guarantee the next host session calls restore, or make an external effect exactly once. It cannot safely infer a changed user intention from similarity alone. It cannot make yesterday's test validate today's code or turn a lease into a filesystem lock. Startup/recovery and integration behavior must be demonstrated on the selected host and pinned runtime.

The credible product claim is narrower and useful: **record task state with evidence, retrieve the bounded context needed to resume, and detect stale or conflicting handoffs before accepted state is changed.**
