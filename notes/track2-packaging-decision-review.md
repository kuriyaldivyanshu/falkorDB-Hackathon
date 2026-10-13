# Track 2 packaging decision: an attachable continuity layer

Review date: **2026-10-11**. Assumes four team members using AI assistance, four event days, and access to both native coding clients. This is a product/scope review, not implemented software. Read the existing [product scope](track2-investigation-and-product-scope.md), [architecture](track2-continuity-architecture.md) and [alternatives](track2-harness-and-alternatives.md); their API and database constraints remain applicable.

**Recommendation:** build an attachable FalkorDB continuity service, an installable CLI/MCP package and two thin adapters for Codex and Claude Code. Use a small controller to demonstrate actual fresh-session takeover. Four members justify making a real cross-harness continuation part of the core demonstration; they do not justify rebuilding a general coding harness.

The intended outcome is: **a different coding agent continues the same changing project, receives only its relevant current memory, and proves completion against current evidence.** The valuable distinction is conditional applicability and affected-worker recovery, not portable summaries or an `npx` command.

## Why this packaging

| Choice | Advantage | Strongest objection | Judgment |
|---|---|---|---|
| Own complete harness | Full control of sessions, tools, state and workflow | Most work becomes tool execution, permissions, process control, UI and provider integration already supplied by native harnesses; weak evidence that our memory makes an existing agent better | Use only a minimal demo controller, not the product platform |
| Attach memory through one generic MCP interface | Small, portable core; familiar clients remain usable | Tool availability does not ensure capture, invocation before compaction, or delivery to a fresh worker | Necessary core, insufficient alone |
| Core service plus two thin lifecycle adapters | Shared semantics with real provider-specific capture/recovery; inspectable portability limits | Adapters can break with client versions and missed events; cross-provider credentials and permissions remain separate | Best four-person scope, with pinned clients and a Day-1 integration gate |

An `npx`-style entry point is distribution. FalkorDB startup, native-client configuration and credentials still need a documented setup path. Do not promise that one package silently configures every harness. A recorded successful clean install is stronger evidence than a proposed command. Publishing to npm is optional for the submission; reproducible installation from the public repository is adequate to investigate.

## The objection we must answer

**“This is Handover's record plus Beads' task graph, backed by another database.”** That is a serious objection.

[Handover](https://github.com/44-pixels/handover-mcp) already explicitly supports alternating Claude Code and Codex, receiver evidence checks, versioned continuity and stale-revision paths. Its [protocol](https://handover.sh/protocol) includes objectives, decisions, evidence, constraints, ownership and next action, and can live in local files. Cross-harness handoff is therefore existing behavior, not our invention.

[Beads](https://github.com/gastownhall/beads) is persistent dependency-aware work memory; the companion audit checks its pinned stable release. A ready-work graph or surviving compaction alone would be weak differentiation. [Ruflo](https://github.com/ruvnet/ruflo) documents native-client integration, orchestration, persistent memory, hybrid retrieval with graph hops and graph plugins. Its breadth is advertised prior coverage, not an independently tested guarantee.

Our **candidate distinction**, requiring proof, is a live chain:

`changed human requirement / evidence → applicable decision or rejection → affected tasks and receipts → workers who loaded that context → targeted refresh → checked continuation`

The inspected descriptions do not establish whether every competitor implements this exact workflow; absence from a README is not proof of absence. A well-maintained structured record with dependency links could also implement it. Test against that strong version.

## Advanced core, with clear boundaries

1. **Real cross-harness takeover.** Codex checkpoints unfinished work; a genuinely fresh Claude session retrieves its FalkorDB packet, inspects referenced artifacts and continues. No transcript paste or simulated persona switch. Shared project identity does not require two workers to edit the same checkout; use isolated copies and guarded integration. Provider permissions are established independently.
2. **Conditional decision memory.** Preserve accepted and rejected approaches with reasons, source revisions and applicability. A still-true reason prevents a bad route from returning after reset; changed evidence requests reassessment rather than silently erasing the memory or automatically approving the old route. Store attempts as episodes, accepted source-bound facts as semantic memory, and one tested reusable verification routine as procedural memory. Its later reuse must check applicability and produce a new receipt.
3. **Selective worker refresh.** Record which context revision each worker received. An application-owned subscription/delivery mechanism uses graph impact traversal to mark affected workers for refresh at supported boundaries. Acknowledgement and revision checks decide whether they may submit current results. This is not a claim of native FalkorDB subscriptions or instantaneous interruption of arbitrary commands.
4. **Evidence-bound recovery.** Old passing receipts become outdated when their relevant requirement/artifact revision changes. The successor investigates and reruns the needed check. A changed hash does not prove broken code; a stored memory does not prove it was delivered or obeyed.
5. **Coordination and isolation.** Demonstrate two real clients competing for one guarded claim, stale completion rejection, duplicate-event handling and two synthetic tenants. Scope comes from trusted service identity. The service can refuse its own state transitions; it cannot prevent every native filesystem write, so stale work stays isolated from integration.

FalkorDB must own the relationships used to select memory, determine applicability, route refresh and validate continuation. The agent's value is interpreting an ambiguous decision, choosing missing evidence and adapting the next patch/test; deterministic code handles scope, revision and claim checks. An all-purpose autonomous swarm is unnecessary.

**Stretch only:** bidirectional automatic takeover, more than two native coding clients, remote teams, arbitrary transcript import, automatic quality-based reset prediction, broad automatic procedure learning, speculative branches and merges, Graphiti ingestion, semantic search tuning, and a visual graph editor. One small tested routine is core. Keep the graph view as explanatory inspection, not a second product.

## Coverage of the five Track 2 focus areas

**The revised scope covers all five in design; none is verified implementation yet.** The earlier packaging scope left conversation history, procedural reuse and concurrent-load evidence underspecified. These are small explicit core additions, not optional labels. The [official Track 2 focus areas](https://www.wemakedevs.org/hackathons/falkordb) are the coverage reference.

| Focus area | Required core behavior and evidence |
|---|---|
| Episodic, semantic and procedural memory | Episodes record attempts, outcomes and their conditions. Semantic memory records accepted goals, constraints and decisions with sources/revisions. Persist one short CSV verification routine with steps, format/environment preconditions and an execution receipt. A fresh agent retrieves and reuses it on a held-out export task with different quoted/multiline content, checks current applicability and records a new receipt. A changed format/environment must trigger reassessment or refusal. Merely storing a procedure title is insufficient; broad automatic learning remains stretch. |
| Persistent conversation history | FalkorDB owns durable `Session` and ordered `Message` records, including permitted message text, role, origin/event ID and tenant/project scope. Capture the declared user/assistant message surface through the two adapters; expose omissions rather than claiming every native event is captured. After a service/database restart, retrieve the same authored conversation in order. Summaries are a retrieval aid, not the only surviving record. Use event-created authored/public demonstration history; do not import private prior chats or hidden reasoning. |
| Shared state and handoffs | Both real native clients operate against the same accepted task/constraint revisions, claims, decisions and receipts. The receiving fresh session checks the current artifacts and advances the interrupted job. Demonstrate a stale-worker refresh and acknowledgement, not just a stored handoff document. |
| Concurrent reads and writes | Add a reproducible mixed-load probe at 1, 8 and 32 concurrent **memory API clients**, separate from the two live coding agents. Publish machine/version, workload, completed operations, failures/conflicts/retries, throughput and latency, alongside correctness checks. A two-worker claim race alone does not establish load handling. Parallel client requests do not imply parallel same-graph write execution: FalkorDB serializes those writes. [Concurrency design](https://docs.falkordb.com/design/concurrency) |
| Separate memory per user/tenant | Trusted service identity selects separate tenant graphs. Create colliding synthetic task/message IDs in two tenants and attempt cross-tenant reads and mutations. Verify that history, memory packets and service responses remain scoped; an LLM-provided graph name cannot authorize access. |

The procedure and history use the existing memory schema and adapters; the load probe uses inexpensive API clients, not dozens of paid LLM sessions. That keeps the four-person scope bounded. The graph-removal comparison must give the file/JSON baseline the same history, procedure, facts and revisions.

## One compelling controlled demonstration

Use the proposed authored inventory-export fixture; make the disruption and recovery the memorable part. No fixture application has been implemented during this research.

1. Codex works toward exact feature criteria, records a failed approach with its scoped reason and produces one verification receipt. A Claude worker handles an independent task.
2. Pause Codex and change one accepted export requirement. Show the graph identifying the affected decision, serializer work, test receipt and loaded worker context. The independent task remains current.
3. Start a fresh Claude takeover using the scoped packet. It recovers the goal and reason, inspects current evidence, avoids the still-inapplicable shortcut and performs the required next patch/check. On a separate held-out export variant, it checks and reuses the stored verification routine, producing a new receipt.
4. An older worker submits against its old revision. The service rejects that completion; the worker refreshes. Two clients race a new claim and exactly one is granted it in the tested case.
5. The current acceptance tests pass. Show a second synthetic tenant's denied retrieval and mutation, the exact source/receipt trail for the accepted result, and persisted authored message history surviving restart. Present the concurrent-load probe as measured supporting evidence, not simulated live agents.

This is a planned demo, not a result. Use real client activity and actual feature tests, not canned “agent messages.” The demo can include a replay for race/error cases, clearly labelled. Demonstrated scope must match what ran. No placement probability follows from a good demo.

## Four-person ownership and decision gates

| Owner | Primary deliverable | Event checkpoint |
|---|---|---|
| A — memory core | Typed FalkorDB state, durable session/message records, one procedure with applicability/receipts, bounded task packets, affected-context traversal and guarded claims | Day 1: vertical recovery path; Day 3: race/revision/isolation and history-restart checks |
| B — Codex adapter | Capture the declared permitted conversation surface, explicit goal/decision claims and real receipts; bootstrap recovery; controlled clean-session handoff | Day 1: actual native client consumes and records a packet |
| C — Claude adapter | Receive same project/task contract, capture its declared messages, reconcile artifacts, continue, acknowledge refreshed context | Day 2: real Codex→Claude completion; Day 3: affected-worker refresh and procedure reuse |
| D — product/evaluation | CLI setup/diagnostics, focused timeline UI, authored fixtures, strong file baseline, held-out procedure variant, mixed-load probe and submission evidence | Day 1: inspectable story and baseline outline; Day 4: reproducible setup and measured report |

Agree one small event/operation contract during the event and designate one integration owner. AI assistance accelerates implementation, but compatibility, merge coordination and behavior verification remain on the critical path.

**Gate 1 — end of Day 1:** both clients can consume the same scoped packet and return a sourced observation. If only one works, drop cross-harness claims or switch the blocked adapter route; do not respond by building a replacement harness.

**Gate 2 — Day 2:** a fresh second-client worker completes the interrupted job with the current constraints. If recording requires a user-written recap, revise capture before adding subscriptions.

**Gate 3 — Day 3:** changing one requirement refreshes the correct worker set; stale results, duplicate events, competing claims and cross-tenant requests behave as declared. Message history survives restart, the small procedure succeeds on a held-out applicable task and declines/reassesses an inapplicable variant, and the mixed-load probe reports correctness and actual performance. Missing dependency coverage must remain explicit uncertainty.

**Gate 4 — Day 4:** equal-fact file/JSON and graph conditions run on hidden variants with the same tools/model where applicable. Report accepted outcomes, stale actions, irrelevant packet tokens, latency and user repair effort. Reject a superiority claim if the graph wins only through weakened baselines or fixture-specific answer edges. Freeze features and finish the working repo, model/query documentation, setup and demo.

## Preparation boundary

Timing covers main work, not Git history: uncommitted implementation still counts. Planning notes and graph sketches remain allowed. [Official rules](https://www.wemakedevs.org/hackathons/falkordb/rules)

This review is legitimate preparation. Main adapter, service, UI and evaluation implementation belongs in the event window. Keep the existing research and graph sketches; an early uncommitted product does not solve the timing requirement.
