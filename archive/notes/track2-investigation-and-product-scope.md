# Track 2: coding-agent continuity, shared memory and product scope

Research accessed **11 October 2026, IST**. The user has selected **Agent Memory and Coordination only**. This report replaces the earlier cross-track product ranking. It is research and a proposed graph sketch: no product implementation, harness integration, model evaluation or performance benchmark has been completed.

**Latest scope update:** the user has confirmed four members and requested coverage of every Track 2 focus area. Recommend a portable npm CLI/MCP service with Codex and Claude adapters, explicit persisted message history, and one evidenced procedure with tested reuse. See [the packaging and requirements decision](track2-package-and-requirements-decision.md) for the current support boundaries, coverage matrix and ownership sketch.

## Recommendation

Investigate **Threadline**, a working name for shared, verified project memory that lets a fresh coding-agent session continue unfinished work. Its distinctive candidate mechanism is **task-specific graph retrieval with conditional decision memory and selective invalidation when requirements or artifacts change**.

The user-facing promise to test is: **“Start a fresh session. Continue the right task, with the current goal, the reasons behind earlier decisions, and evidence of what still needs doing.”** A worker should receive the relevant portion of that memory, with an explicit task and revision, rather than the entire conversation.

A generic session messenger, persistent goal, or structured handoff would have substantial existing coverage. Originality is unproven; the proposed advantage needs a direct comparison with current harness features and an equally informative file-based record.

## 1. What is the actual problem?

The user's experience combines several failures. They should be measured separately.

| Failure | Example | Required remedy |
|---|---|---|
| Relevant information is buried in long context | A small scope constraint competes with pages of logs | Selective context construction |
| A compaction omits a continuation-critical detail | The summary says “export built” but loses a rejected approach | Durable decision record with its reason and source |
| A fresh session lacks the working state | It must reconstruct the task from code and a manual summary | Recover a current, task-specific continuation packet |
| Memory becomes stale | A test passed before a requirement or relevant file changed | Versioned evidence and explicit applicability |
| Workers use inconsistent state | A paused worker reports completion against an old requirement | Guarded state transitions and revision checks |
| Memory was stored but not useful to the receiver | A hook succeeded, but essential context was not consumed | Inspect delivery and measure subsequent behaviour |

Long-context degradation has empirical support, but **context fill is not a universal quality meter**. Chroma's 14 July 2025 report studied 18 then-current models on controlled retrieval, distractor, conversation and repetition tasks. It found nonuniform reliability as input grew; it did not establish a safe percentage for today's coding harnesses or prove a graph remedy. [Chroma primary report](https://www.trychroma.com/research/context-rot)

A search-agent paper submitted 29 June 2026 and revised 4 August identifies premature termination under longer context in four flagship models on three benchmarks. That supports evaluating early stopping as well as forgotten facts, but its search setting should not be generalized directly to our coding workflow. [Primary paper](https://arxiv.org/abs/2606.29718)

Anthropic's 26 November 2025 harness report describes unclear unfinished work and later sessions prematurely declaring completion despite compaction. Its solution uses feature records, incremental progress, files and Git history. Those are serious baselines. [Long-running harness research](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)

The contrary evidence matters. Anthropic's 24 March 2026 follow-up says resets were useful for Sonnet 4.5, while Opus 4.5 largely removed the observed context-anxiety behaviour, allowing resets to be dropped. Opus 4.6 subsequently allowed further simplification. It also uses planner/generator/evaluator agents and file-based sprint contracts. Our product must earn its overhead on the current model and task. [Harness design research](https://www.anthropic.com/engineering/harness-design-long-running-apps)

**Inference:** the more durable problem is keeping goals, reasons, dependencies and completion evidence consistent across changing work and multiple actors. A larger window or better compaction can reduce some symptoms without making all those relationships explicit.

## 2. Social discovery: the useful nerve

The accompanying [X and Reddit source audit](track2-context-social-signals.md) distinguishes opened content from search-index snippets and records date uncertainty. These are qualitative leads, not evidence of market prevalence or measured product effectiveness.

One opened Reddit account describes a resumed Claude Code session retrying a previously rejected cache design: what was built survived better than why the alternative was rejected. The obvious proposed fix is `DECISIONS.md`. A useful response points out that a rejection should remain applicable while its reason remains true. [Firsthand thread](https://www.reddit.com/r/ClaudeCode/comments/1wgtm88/claude_codes_compaction_keeps_what_you_built_and/)

Another opened builder report audits what a memory hook actually delivered. A successful hook did not establish that the full intended content reached the model; the author also distinguishes delivery from correctness and usefulness. The installation-specific report is a reason to test the receiver, not proof that every harness behaves that way. [Delivery audit thread](https://www.reddit.com/r/ClaudeCode/comments/1wu2ch6/i_measured_what_actually_reaches_claude_codes/)

These suggest two worthwhile experiments: **preserve conditional reasons for rejected options**, and **verify continuation through observable behaviour rather than a “memory saved” notification**. X posts and additional cross-repository reports are detailed in the audit, including promotional overlap and weak access evidence.

## 3. Current harnesses already cover much of the proposal

### Codex

Current official documentation describes native subagents with separate contexts. It explicitly recommends moving noisy exploration and logs out of the main conversation and warns that subagents can increase total tokens and coordination overhead. [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)

Codex also has local memories. The documentation treats these as a recall layer and recommends keeping required guidance in checked-in instructions. Merely adding persistent recall would therefore be weak differentiation. [Memories](https://learn.chatgpt.com/docs/customization/memories)

The SDK can start, continue and resume local threads. Resuming an old thread and starting a clean thread with selected context are different operations; our fresh-session experiment needs the latter. [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk)

The documented app-server exposes start/resume/fork, item completion events, compaction lifecycle, usage updates, and persisted thread goals. A fork copies conversation history, so it is not automatically a clean-context handoff. These interfaces make an integration plausible; they do not prove our adapter works. [App-server](https://learn.chatgpt.com/docs/app-server)

Current hooks include prompt, tool, subagent and compaction lifecycle events. `SessionStart` with `source: compact` can inject additional context before the immediate continuation. There are output limits; MCP may not be ready at session start; transcript format is explicitly unstable. Use a small bootstrap and a service call for task context rather than treating arbitrary transcript parsing as a stable API. [Hooks](https://learn.chatgpt.com/docs/hooks)

A read-only local check found **codex-cli 0.161.0** on this machine. No event, injection, thread recovery or adapter compatibility test was run. Current documentation and this installed build must be checked together during implementation.

OpenAI's Responses compaction produces opaque continuation state. It is not an inspectable, portable project-memory schema. The API's current hosted multi-agent feature already offers bounded independent contexts and automatic compaction, so recreating orchestration would also overlap existing capabilities. [Compaction](https://developers.openai.com/api/docs/guides/compaction), [Responses multi-agent](https://developers.openai.com/api/docs/guides/responses-multi-agent)

### Claude Code and other alternatives

The [harness and alternatives audit](track2-harness-and-alternatives.md) checks primary documentation, releases and source, including several cases where indexed descriptions lag current code.

| Existing approach | Coverage relevant to us | Consequence for scope |
|---|---|---|
| Claude Code native features | Isolated/resumable workers, persistent worker memory, teams, shared tasks/messages, context reinjection | Do not present worker creation or communication as the invention |
| Ruflo / Claude Flow | Broad orchestration and memory infrastructure | Compare with its current package, not an old tutorial |
| claude-mem | Session observations and progressively retrieved memory | An archive plus search is already a product category |
| Beads | Persistent dependency-aware work records | A task graph alone is insufficient distinction |
| MCP Agent Mail | Coordination and file-reservation workflows | Messaging/leases alone are insufficient distinction |
| Handover | Platform-neutral continuity records and revisioned MCP handoffs | A polished summary schema is insufficient distinction |
| Git plus minimal task/decision files | Cheap, inspectable persistent state | Must be a strong baseline, not an intentionally incomplete summary |

Handover is especially close. Its v1.0 protocol, updated 5 August 2026, already contains acceptance criteria, verified/unverified state, active/superseded decisions with rationale, evidence references and optional hashes, constraints, ownership, next action and receiver verification. Its MCP uses an expected revision for continuation and authenticated authorship. The record can be stored in Git. [Protocol](https://handover.sh/protocol), [MCP documentation](https://handover.sh/docs/mcp-server)

Handover's August benchmark is a transparent but small authored pilot: three cases, two systems, one run per system, with differing information retained by the conditions. It measures state recovery, not completed coding work, and has no accepted independent replication listed. It is useful for experiment design; its reported scores are not evidence of our eventual advantage. [Pilot and limitations](https://handover.sh/benchmark)

### Research does not establish “more memory is always better”

Three 2026 studies report different effects from repository context files: a February study finds lower success and increased cost in its settings; a July two-agent study finds no measurable correctness movement within its reported bounds; a January efficiency study reports lower median runtime and output tokens with comparable completion behaviour. Their tasks, agents and methods differ. These are preprints, and none directly tests our project-continuity graph. The practical implication is to measure **content selection and task success**, not count memory features. [February study](https://arxiv.org/abs/2602.11988), [July study](https://arxiv.org/abs/2607.27250), [January study](https://arxiv.org/abs/2601.20404)

## 4. Creative mechanisms worth considering

These are materially different candidate mechanisms within the chosen problem. They are hypotheses, not claims of unprecedented invention.

| Mechanism | What makes the demo interesting | Main risk | Priority |
|---|---|---|---|
| **Conditional rejection memory** | A fresh agent avoids a known bad approach, but reopens it for investigation when its reason no longer applies | Turning old observations into permanent prohibitions | Core candidate |
| **Task context compiler** | Different workers receive different, bounded packets linked to the same current goal | Omitting a critical dependency or including too much | Core candidate |
| **Memory impact routing** | One changed requirement marks exactly the affected tasks/receipts and workers for refresh | Missing dependency edges; event delivery lag | One narrow path in MVP |
| **Verified session replacement** | A clean agent proves it has the right task revision and reconciles files before continuing | Certification of intent without actual execution | Core workflow |
| **Experiment branches with selective memory merge** | Parallel approaches preserve separate hypotheses; only evidence-backed findings are promoted | Code merge conflict and false agreement | Later, not four-day scope |
| **Procedure memory with applicability checks** | Reuse a successful repair/verification routine only for a compatible environment | Learning an unreliable routine from one success | One small demonstration |

“Saved → delivered → understood → acted on correctly” is a useful sequence of evaluation questions. Storage success alone is not the product outcome. We cannot directly observe understanding, so test whether the next action respects the recovered state and completes the observable acceptance criteria.

## 5. What FalkorDB would do at the centre

The proposed graph sketch links:

`Goal → Constraint/AcceptanceCriterion → Decision → Task → ArtifactVersion/TestReceipt`

`Decision → Reason/Assumption → EvidenceVersion`

`Session → AssignedTask / LoadedContextRevision / RecordedEvent`

`Procedure → Preconditions / Steps / ValidationReceipt`

A task packet is constructed by traversing its goal ancestors, applicable constraints and decisions, dependency/blocker state, relevant artifact revisions, and matching prior attempts. Semantic search may find candidate memories, but a similar sentence should not decide which goal or receipt is current.

**Conditional negative memory example, authored:** an export cache was rejected because the inventory changes between preview and export. Preserve the attempted design, the freshness requirement, the failing fixture and the scope of the rejection. A resumed serializer task receives that reason. A styling task does not. If a later user change explicitly removes the freshness requirement, mark applicability for reassessment; do not silently erase the rejection or assume the design is now correct.

**Selective invalidation example, authored:** an export contract changes from revision 1 to revision 2. Follow the contract's recorded dependencies to serializer and verification tasks and their receipts. Keep unaffected work intact. A result generated under revision 1 cannot mark the revision-2 task complete. A changed file hash makes its associated verification outdated; it does not prove the code is broken.

The graph must own the state used for retrieval, applicability, readiness and handoff. Raw source text and logs can be evidence artifacts, but cannot form an independent complete fallback task engine.

This makes FalkorDB central in this implementation. It does **not** mean another database or carefully indexed files could never implement the same logic. The honest test is whether relationship traversal improves the workload compared with equally informative alternatives, not whether unplugging the database crashes an app. [Central-graph rule](https://www.wemakedevs.org/hackathons/falkordb/rules)

The [architecture audit](track2-continuity-architecture.md) supplies technical constraints. Relevant design choices are application-owned typed state, explicit revisions, one guarded mutation, bounded retry, read-only retrieval, and trusted tenant-to-graph routing. FalkorDB allows snapshot reads and serializes same-graph writers; parallel clients are not proof of parallel writes. Its query `version` parameter is a schema-cache version, not our task-state revision. [Concurrency](https://docs.falkordb.com/design/concurrency), [Query command](https://docs.falkordb.com/commands/graph.query)

Graphiti could supply recalled factual episodes, but it should not be the authority deciding whether a task is done or a user changed the goal. Use typed updates and evidence for those transitions. Keep it optional until its retrieval benefit exceeds ingestion and integration costs. [Graphiti FalkorDB integration](https://help.getzep.com/v3/graphiti/configuration/falkordb-configuration)

## 6. Where the data comes from

For the hackathon: an authored, public toy coding project, synthetic technical conversations and explicit requirement changes, task-assignment events, actual tool results produced during the event, source versions, and verification receipts. Use invented inventory items rather than personal records. Labels in the fixture are controlled ground truth; generated agent behaviour is evaluated separately.

Capture the user's stated objective and revisions, explicit decision rationale, task checkpoints, artifact changes and test outcomes while work occurs. Link each item to its observable source. Do not attempt to store hidden reasoning. Model extraction may propose a decision record, but a proposal is not automatically an authoritative instruction. Preserve ambiguous items as unresolved, rather than inventing intent.

No manual handoff summary should be necessary once recording is active. That does not eliminate capture: the adapter and agent checkpoint tools must reliably collect continuation-critical facts during the original session. If the system starts after an uncaptured decision was lost, it cannot recover it by graph retrieval.

The event permits public, synthetic or owned data but also explicitly excludes private, login-protected, personal and restricted information. Therefore do not load actual private Codex/Claude chat histories into the submission graph. Authored synthetic sessions are the clear route; eligibility of any sanitized real logs would need an organiser interpretation before use. This report does not send such a request. [Data and timing rules](https://www.wemakedevs.org/hackathons/falkordb/rules)

## 7. Decisive four-day scope

**First user:** a developer using coding agents on one project across interruptions, clean sessions and two workers. **First workflow:** continue one unfinished feature correctly after a reset and a changed requirement. **Updated integration scope for four members:** a common FalkorDB-backed CLI/MCP service with Codex CLI and Claude Code lifecycle adapters. Make an actual fresh Codex-to-Claude continuation a core demonstration, subject to early compatibility gates. OpenCode/Hermes receive common-tool support only after smoke tests; deeper adapters are stretch scope. Current documentation makes these plausible, not verified.

Build these six boundaries:

1. **Current project memory:** goal, acceptance criteria, constraints, conditional decisions, task state and evidenced attempts. Preserve source revisions and explicit supersession.
2. **Bounded context retrieval:** always include the current goal and relevant mandatory constraints; expand the task's dependencies and evidence. Put logs behind references. If mandatory context exceeds the budget, report the overflow instead of silently dropping it.
3. **Fresh-session continuation:** request a task packet, inspect the actual workspace and verify revisions, then perform the recorded next check. Separate old-thread resume from a genuinely clean session.
4. **Two-worker coordination:** explicit task assignment, revision-guarded claims/results, disjoint worker copies and guarded integration. Refresh the affected worker at a supported boundary when relevant state changes.
5. **Two-user isolation plus one procedure:** separate graphs selected by trusted service identity; persist a small successful verification routine with preconditions and an evidence receipt.
6. **Persistent conversation history:** retain captured, ordered messages and tool-result references across sessions; link facts, decisions and attempts back to those sources. Demonstrate service/database recovery and visible capture gaps. Test procedure reuse on a later compatible task. Measure concurrent restore/append/claim requests under a declared workload; do not equate simultaneous clients with parallel same-graph writes.

Suggested conceptual service operations: retrieve task context, record an observation/decision proposal, checkpoint a task, claim/handoff work, and verify continuation. The model should not receive unrestricted graph administration tools. These are interface sketches, not implemented APIs.

Do not build a replacement IDE, general swarm scheduler, autonomous quality detector, every-provider migration layer, company knowledge connectors, or elaborate self-learning system. Automatic session replacement based solely on a “70% full” rule is particularly unjustified. Start with an explicit continue action and lifecycle-triggered recovery.

MVP safety and correctness boundaries must be honest: service-side fencing cannot prevent arbitrary native file writes; isolated copies and guarded integration make the demonstration meaningful. A memory receipt is not a filesystem transaction. Database commit is not a guarantee of disk survival under every persistence configuration. Memory missing from the graph remains unknown.

## 8. Proposed demonstration

This is an authored scenario to implement during the event, not a result already obtained.

1. Give the orchestrator an inventory CSV feature with exact acceptance criteria. Assign serializer and verifier work to separate workers.
2. Let an approach fail on quoted/multiline content. Record the attempt and the reason it was rejected. Preserve a tested verification procedure.
3. Change one export requirement. Trace the impact to the affected work and mark its previous receipts for revalidation. Show an unrelated task remains current.
4. Interrupt or reset the Codex session. Start a genuinely fresh Claude successor using only its bounded packet and referenced evidence.
5. Have it recover the current goal, avoid the applicable rejected approach, reconcile changed code, and choose the required next check.
6. Let an older worker submit a result against the previous revision. Reject that stale completion through the service and request fresh verification.
7. Complete the current acceptance criteria. Show each recovered decision and task state back to its source, and a second user's unrelated memory remaining inaccessible.

The visible win is the correct continuation after disruption and change. A graph animation or “remembered 1,000 messages” counter is secondary.

## 9. Tests that could reject this direction

Keep the model, tools, code snapshot, captured facts and task fixed across conditions. Compare native compaction/resume; a strong minimal file-based task/decision record; a structured continuity record; flat/vector memory; and graph-derived context. Use the same token budget where practical and disclose any truncation. Do not deliberately remove a crucial fact only from the baseline.

Evaluate separately:

- **Capture:** were required goals, constraints, reasons and receipts recorded correctly before interruption?
- **Retrieval:** does the packet contain the necessary current items without irrelevant material?
- **Delivery:** did the adapter actually present those items at the correct continuation boundary?
- **Behaviour:** did the resumed agent perform the right next action and meet the acceptance tests?
- **Coordination:** do stale claims/results fail, retries remain idempotent, and tenant isolation hold?
- **Cost:** packet tokens, total model tokens, latency, retrieval time, conflicts and user repair effort.

Author small held-out variants: changed constraint; still-valid rejection; expired reason; stale passing test; task completed but verification pending; delayed worker; duplicate event; missing checkpoint; disconnected dependency; second tenant. Shuffle distractors and run repetitions. Publish failures as well as successes. A missing dependency must yield uncertainty, not a claim of complete knowledge.

**Reject or shrink the concept if** a minimal versioned record gives the same correct continuation at lower cost; hooks do not deliver the essential packet reliably; extracting the state requires as much user work as a manual summary; or the graph introduces more stale/false authority than it removes. If graph benefits appear only when we weaken the alternatives, the hackathon story is not established.

## 10. What can happen before the event

The official build window is 15–18 October 2026. Main coding/design must start during it; notes, ideas, graph sketches and diagrams are allowed beforehand. The current preparation can therefore finalize the authored scenario, source inventory, competing baselines, capture fields and failure cases. Actual adapter, graph, UI and benchmark implementation should wait for the start. [Official rules](https://www.wemakedevs.org/hackathons/falkordb/rules)

The first implementation spike should answer one question: **can an actual fresh session consume a task packet from FalkorDB, recover an applicable rejected decision, and continue with current evidence?** Only after that succeeds should we add the second worker, changed-requirement routing and the isolation demonstration.

## Source companions

- [Track 2 X/Reddit signals](track2-context-social-signals.md): public evidence, access uncertainty, contrary reports and candidate mechanisms.
- [Current harnesses and alternatives](track2-harness-and-alternatives.md): native coverage, release/source drift, close competitors and integration seams.
- [Continuity architecture](track2-continuity-architecture.md): graph closure, revisions, concurrency, durability boundaries and validation plan.
- [FalkorDB technical dossier](falkordb-technical-dossier.md): broader engine details from the earlier investigation.

This is a plausible, focused Track 2 direction. Novelty, user benefit, graph advantage and competitive performance remain unmeasured.
