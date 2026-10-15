# Threadline development blueprint

**Controlling MVP draft — 15 October 2026. Two full-time contributors; deadline unknown. All behavior below is proposed until its acceptance gate passes.** This document supersedes broader release commitments in the architecture references. Historical investigations remain evidence, not a backlog to implement.

## 1. Product promise and release boundary

Threadline is a small local coding harness that preserves relevant task state across an interrupted session. A fresh Builder receives current accepted requirements, the current candidate, applicable failures, a structured checkpoint and sourced advice without receiving the previous conversation wholesale. FalkorDB connects these records and controls claims and revisions; a protected deterministic checker establishes whether output satisfies accepted criteria.

The demonstration is one authored inventory-export task, one Builder at a time, and a genuinely fresh successor. This demonstrates multi-session continuity and coordination through shared state. It does not establish concurrent multi-model collaboration or general repository competence.

Ship TypeScript on Node 24, an npm CLI with Ink TUI, one local backend, PostgreSQL, FalkorDB and immutable local artifacts. Builder sessions are logical sessions inside the backend. Commands and checks are actual isolated executions. Do not invent one process identifier per logical session.

Exclude RLM, automatic model summaries, a second model Verifier, investigator spawning, arbitrary MCP ingestion, remote hosting, subscription adapters, custom OAuth and multiple inference providers from this release. Use one user-owned OpenAI Responses API route. Codex/pi remain inspiration for tool ergonomics and lifecycle handling; they are not copied runtimes or evidence that our containment works.

## 2. Frozen contracts and unresolved prerequisites

The implementation inputs are [fixture manifest](contracts/fixture-manifest.json), [development policy](contracts/development-profile.json), [checkpoint schema](contracts/memory-checkpoint.schema.json) and [episode schema](contracts/memory-episode.schema.json). These are design artifacts, not implemented validators or passing experiments. Domain names are defined in [CONTEXT.md](../../CONTEXT.md).

The fixture fixes CSV formatting, UTC normalization, freshness, invalid-input handling and exact expected outputs. The reference clock is fixed; changing freshness from 600 to 60 seconds is an explicit human-accepted requirement revision. Free-text changes remain pending until normalized and accepted. The agent cannot silently alter acceptance criteria.

The [code-first checklist](track2-implementation-checklist.md) starts with a runnable backend/TUI, creates the authored candidate alongside read-only model tools, and implements protected assertions later. The verification milestone hashes the declared seed, protected cases, launcher and environment. The seed's timestamp-format defect is authored and disclosed; observe its real protected-check failure before the checked repair demonstration, rather than requiring the model to invent a mistake. A generic repaired exporter may already satisfy the changed threshold. Its old receipt still becomes stale; a new code diff is not required.

Exact Node patch, database/container digests, lockfile, model identifier and effective model context limits remain unfilled compatibility/release values. Install dependencies normally while scaffolding and retain the generated lockfile; no separate lockfile/checker project blocks initial code. Select and test compatible values as their runtime paths are implemented, and freeze actual release versions at packaging. Neither an API account nor a subscription proves a route works. Doctor verifies configuration without automatically spending money; an explicitly initiated development run verifies the selected paid route. API credentials stay in the coordinator environment and are removed from command environments. No application certificate or Threadline OAuth flow is required for this BYOK route. Future subscription routes must use documented official runtime integrations, subject to their own evidence and tests.

## 3. Small module boundaries and ownership

The user owns Memory/Coordinator: accepted requirements, graph authority, claims, capture admission, checkpointing, retrieval, procedure lifecycle and evidence acceptance. The teammate owns Harness/Delivery: provider loop, typed tool dispatcher, isolated execution, trusted-checker supervisor, TUI, packaging and doctor. Both pair on protocol contracts, fixture creation and fault gates.

Use seven modules with narrow public operations:

- `coordinator`: accept goal/change, start/retire session, acquire claim, request completion. Owns revision/fence guards.
- `capture`: append intent/result, store immutable source, replay admission. Owns stable IDs, sequence positions and gap status.
- `memory`: build checkpoint, retrieve packet, admit episode, trial/validate procedure. Owns source applicability and budgets.
- `harness`: run one provider attempt and dispatch validated calls. Owns request journaling, usage reservation and terminal outcomes.
- `execution`: inspect/apply candidate and run registered commands. Owns workspace containment and candidate identity.
- `checker`: run protected assertions and produce a service-authored receipt. Owns trusted criteria and verification identity.
- `interface`: render stream and submit explicit human commands. Owns interaction, not graph truth.

Implement workflow queries, not a generic repository/service/UI per table. The 31-table core DDL is a reviewed bootstrap reference; execute it only after database syntax/constraint validation. The two additional adapter/auth tables remain target extensions. PostgreSQL holds identities, human sessions, request/capture journals and projections. FalkorDB holds task authority, memory links, claims and graph events. Artifacts hold exact logs, manifests, packets and snapshots. These stores have independent commits; reconciliation is mandatory, not an assumed distributed transaction.

## 4. One run from admission to checked completion

Human admission records the fixture/version, project, accepted requirements and checker bundle identity. The backend creates Task/Run and service identity, initializes structured state and obtains one Builder claim. The broker reserves budget and persists a model-request intent before submission. Every tool invocation passes schema, size, role, revision, fence and workspace policy checks before an effect.

Persist critical intent before dispatch and terminal outcome before reporting success. Artifact writes use immutable content identity and verified availability; SQL capture/outbox is replayable into guarded graph mutations. A deterministic ingester creates Source and Observation and an Attempt episode for registered command/check outcomes, diagnostic failures and unknown effects. It records the observed diagnostic and affected paths; a guessed root cause remains a hypothesis. Duplicate delivery produces one episode, not another remembered failure.

A mutating tool changes the candidate digest and invalidates proof tied to the old candidate. A human change increments requirement revision even if code is unchanged. `task.request_completion` invokes the protected checker, or reuses only a receipt matching candidate, requirements, environment and checker identities. Completion is a guarded coordinator mutation; the Builder's assertion of success is insufficient.

## 5. Tools supplied to the Builder

The MVP exposes exactly eleven tools. All inputs are bounded and validated; principal, project, run, session, claim and fence are server-owned envelope fields. Models cannot choose an arbitrary tenant, graph name, actor or shell command. Results include execution/source IDs, observed outcome, current revisions and explicit truncation or gap markers. Permission denial and unknown execution are distinct from successful empty output.

- `workspace.read`: relative path and bounded offset/length; returns bytes/text and digest. Reject escaping paths and symlinks.
- `workspace.search`: bounded query and allowed relative paths; returns at most 30 matches with file/line references.
- `workspace.inspect`: bounded relative paths; returns metadata, candidate digest and changed paths.
- `workspace.apply_patch`: typed patch against the expected candidate digest, at most eight paths/64 KiB; validates all paths before mutation and reports the new digest.
- `workspace.run`: registered command ID and its typed arguments. MVP commands are `diagnose(case_id)` using one published input and the registered exporter argv/current accepted parameters, `build()` using fixed `node --check /candidate/src/exporter.mjs`, and `verify()` dispatching the protected supervisor. The service selects stdin/argv; no model-selected arbitrary shell. Noninteractive, synchronous, at most 60 seconds. TUI streams capture while the call awaits its terminal result.
- `memory.retrieve`: `mode=search` takes a bounded task-relevant query and returns sourced advice. `mode=source` takes `source_id`, byte `offset` and `max_bytes` (at most 32 KiB), rechecks access and returns an exact artifact range with digest/total/truncation markers. No unrestricted Cypher or raw artifact path access.
- `memory.refresh`: requests a current authority/context packet; reports stale or blocked state explicitly.
- `memory.checkpoint`: optional progress, next action and tactical-plan patch validated against the checkpoint schema. The service supplies coverage, authoritative bindings and source identities; this prose cannot promote facts.
- `task.update_plan`: bounded checklist patch, at most eight steps and one in-progress step. Merge preserves checkpoint progress and evidence rather than replacing the entire state.
- `interaction.ask_user`: at most three concise questions, one pending interaction. Execution waits only where the answer is required; pending answers are durable.
- `task.request_completion`: expected candidate/revisions; returns checked acceptance, rejection with receipt, or a blocked result.

The 14-tool broader registry additionally describes `workspace.poll`, `memory.propose_decision` and `review.submit`. They are deferred and not advertised to the MVP model. Later general shell support needs its own authorization/containment contract. `verify` is a service dispatch, not access to editable assertion code.

## 6. Checkpoints and capture without a summarization API

There is no summarizing API or background model call. Capture critical boundaries as they occur; checkpoint structure deterministically after admission, accepted changes, mutating/registered-command terminal outcomes, diagnostic failure, unknown effects, explicit plan/checkpoint updates and safe handoff. A fallback checkpoint runs after five meaningful uncheckpointed events. Checkpoint publication itself does not trigger another checkpoint.

TaskState points to the immutable checkpoint Source through `checkpoint_source_id` and `CHECKPOINT_SOURCE`. Its producer session/covered position are explicit. The manifest binds candidate/environment identities and records coverage separately for every session stream; one session's sequence cannot be compared with another's. Coverage advances only after required Sources are available and graph admission is reconciled. Validate unique session entries, covered cursor no greater than admitted cursor, and the four-stream bound (initial session plus three replacements). A checkpoint containing an active unresolved effect retains its identity/status, never fabricates completion.

On restart, reconcile effects first, then scan the ordered post-checkpoint capture tail in batches of 100, up to 1,000 events. Convert relevant terminal evidence into episodes, preserve accepted changes and unresolved effects, and publish a new structured checkpoint when safe. If critical coverage exceeds this bound or a gap remains unresolved, block new inference and reconcile; do not silently take the last N records. Captured stdout can have an explicit partial/gap status after a crash; the 250 ms flush is not zero-loss logging.

Memory priority is current authority and unresolved effects first, current proof/failure evidence second, applicable procedures and decisions third, and optional orientation last. Tool-call identities and selected diagnostic excerpts accompany Sources. Full logs/diffs/transcripts remain inspectable artifacts; they are not automatically injected. Private reasoning is neither stored as cross-session memory nor requested from a provider. Ordinary agent-written explanations remain attributed proposals.

## 7. Retrieval, advice and procedural reuse

Default packet budget is 6,000 tokens, hard cap 8,000. Admission also checks the chosen model's real context capacity. Select mandatory current authority, candidate/checkpoint bindings and critical tail first. Optional traversal is at most three hops/64 records, with four failure episodes and two procedures. Mandatory context may be deduplicated or encoded compactly without dropping or paraphrasing governing obligations. If it still exceeds the cap, block admission, narrow the task through explicit human acceptance or explicitly raise a model-compatible budget. Optional records are dropped with omission counts. No vector database or semantic-search API is required for the fixture.

Exact proof requires identical candidate, requirement revision, environment, checker bundle and launcher identity. Advice has declared compatibility predicates and can survive a candidate/global revision change; it is clearly labelled conditional and never satisfies completion. Failure reuse matches task family, relevant paths and normalized failure signature, with Source availability/scope checks. Inspecting a Source is still a normal bounded tool operation.

A new task discovers procedures through project-scoped `ProjectRoot-HAS_PROCEDURE`, filtered by fixture family, input/output schema, runtime/tool-policy version and declared preconditions. This seed avoids needing a pre-existing task edge. Incompatible `inventory-json-v2` is excluded.

After an actual successful trusted receipt, a guarded service operation instantiates one authored `inventory-export-check-v1` procedure template from observed execution Sources. It records candidate status, originating receipt and prerequisites. Human fixture admission explicitly authorizes a bounded compatible trial; a candidate is still only advice. A distinct held-out task/run's matching successful receipt validates that version. Reusing the same receipt is idempotent. Failure records evidence and narrows/invalidates applicability without deleting history. Freshness parameters come from current accepted requirements, not copied literals from the old task. Disclose the authored template and held-out specification; this is not an independent scientific benchmark or autonomous lesson-learning claim.

Accepted human requirements supply semantic memory. Agent decisions stay proposed in checkpoint notes; no general decision-promotion UI is needed for the MVP.

## 8. Fresh-session recovery and claim ordering

A fresh successor starts with an empty provider conversation and no inherited hidden provider thread. Retire the old writer, cancel/reconcile commands, prove actual execution termination or quarantine its workspace, and reconcile unknown provider attempts. Stage a packet locally. Atomically assign the successor claim and new fence under current revisions. Rebuild/validate the packet against the post-claim authority, then journal/reserve/submit its first provider request. Record submission acknowledgement only after actual dispatch evidence. Local staging is not evidence the model received context.

Crash before claim leaves a staged proposal. Crash after claim but before send leaves a recoverable claimed session. Unknown send remains unknown; pause for explicit reconciliation rather than automatically duplicating a possibly billed attempt. Late old-session tool calls fail their fence check. A lease expiry alone never proves a command stopped writing.

## 9. Protected execution and numeric limits

The first executable-tool gate proves containment on one declared Docker/OS target. Coordinator/provider credentials, database access, protected assertions, fixtures and receipt writer are outside Builder-writable files. Candidate code runs with read-only snapshot plus bounded scratch, no network, filtered environment and resource/time limits. The trusted supervisor supplies immutable inputs and accepted arguments, captures real stdout/exit status, and compares output outside candidate execution. Never trust a candidate-generated JSON claim that tests passed.

The receipt binds candidate/environment/criteria/revision/bundle/launcher digests, `check_run_id` and a service `verified_by_actor_id`. `verifier_session_id` is optional for a future model review; do not fabricate an AI Verifier. The selected profile fixes one CPU, 512 MiB RAM, 64 PIDs, non-root UID/GID 10001, read-only root/candidate, 200 MiB scratch, network none, all capabilities dropped and no-new-privileges. Kill grace is two seconds; uncertain termination quarantines the candidate. Prove child/container termination, write containment and receipt integrity before advertising safe tools.

[Development policy](contracts/development-profile.json) fixes initial limits: one run/one live model session; three successor replacements; 25 provider attempts, 80 tool calls, 30-minute run deadline; 120,000 reserved-plus-observed run tokens; 12,000 input/1,500 output limits subject to real model capacity. Commands have 1 MiB total logs and 32 KiB model-visible output; reads 32 KiB; snapshots 1,000 files/50 MiB; scratch 200 MiB; run artifacts 250 MiB. These are adjustable proposed defaults, not measurements. Exhaustion stops admission with a visible reason. Unknown usage retains its maximum reservation; local cancellation cannot guarantee provider compute stopped.

SQL unavailability stops new admission and triggers reconciliation. An offline spool is not an MVP durability promise. Graph replay uses bounded batches and stable operation IDs; ambiguous writes reconcile receipts before retry. Claim lease is 30 seconds with ten-second heartbeat; outbox lease is 30 seconds with 250 ms poll and replay-safe retry delays of 250/1,000/2,000 ms. Expiry revokes admission, never proves termination. Auth is one local OS-owner bootstrap with hashed local session tokens, 12-hour idle/seven-day absolute expiry. No remote multi-user onboarding or private-source publication flow is shipped; project-safe inputs plus synthetic scope/private-denial tests remain required.

## 10. Two-person build sequence and release gates

The user's code-first instruction supersedes the former preflight-first order. Follow the [master implementation checklist](track2-implementation-checklist.md), [Agent A lane](track2-agent-a-checklist.md) and [Agent B lane](track2-agent-b-checklist.md). Start small, then add consequential boundaries to working code. Each milestone joins both lanes into one reviewed branch/commit after integration; neither agent independently branches/pushes during coding.

1. **M00 — runnable scaffold:** small backend, shared types and plain CLI/Ink TUI with an actual command/event exchange. No checker, container digest, manual lockfile project or CI gate first.
2. **M01–M03 — real flow:** local identity and accepted task in PostgreSQL/FalkorDB, one guarded API-backed read-only tool loop, exact input/result capture and immutable Sources. Normal dependency setup accompanies the code.
3. **M04–M05 — memory:** structured checkpoint with per-session coverage, bounded graph retrieval, exact authority and whole-request budgeting. No summary API.
4. **M06 — effectful execution:** guarded patches, candidate snapshots and isolated registered commands. Prove containment before enabling those tools; coding the executor is not proof that it is safe.
5. **M07 — continuity:** accepted human change, durable clarification, actual interruption, reconciliation, fresh claim-before-send and empty-conversation successor. Failure capture must survive without a voluntary recap.
6. **M08–M09 — checked completion and reuse:** protected assertions/service receipts, stale-proof rejection, sourced candidate procedure and distinct compatible held-out validation. Do not manufacture an edit when existing code satisfies changed parameters.
7. **M10–M11 — complete plain UX and acceptance:** finish local API/TUI reconnection and scope/error behavior; consolidate actual protocol/provider/containment/recovery evidence. Important tests run as each boundary is implemented rather than waiting until this stage.
8. **M12–M13 — comparison and delivery:** equally informed structured-checkpoint comparison, packaged entry point, doctor/setup, actual supported versions/digests and clean installation. Full backup or capacity claims need their own executed evidence.

These are functional increments, not calendar promises. Estimate the next batch after actual integration. Runtime, SQL execution, sandbox, API, recovery, performance and memory-benefit gates remain **unexecuted** in this documentation repository. Development starts at M00; effectful tools and protected completion retain their respective release gates. Cuts reduce advertised behavior rather than waive integrity for behavior still claimed.

## 11. Review disposition and visual references

D01 fixture/admission, D02 exact checkpoint/tail, D03 sourced procedure lifecycle, D04 claim-before-send, D05 workflow scope, D06 two owners, D07 trusted supervisor, D08 fixed policy, D09 scoped advisory discovery and D10 single Builder/checker are addressed as design decisions here. Their experiments remain required. See [resolution register](review/track2-development-readiness-resolutions.md) and independent reread for residual issues.

Use [MVP architecture](diagrams/development-mvp.mmd), [checkpoint recovery](diagrams/checkpoint-recovery.mmd), [complete graph dictionary](schema/graph-field-dictionary.md) and [SQL reference](schema/postgresql-core-reference.sql). The full target contains 31 graph labels, 433 properties and 82 typed relationships, and 33 SQL tables including two deferred extensions. Its size is not the number of MVP features.
