# Threadline delivery, operations and acceptance plan

**MVP authority — 15 October 2026:** [Development blueprint](track2-development-blueprint.md) controls release scope: two contributors, one logical Builder and fresh successor, a protected service checker, eleven tools and no automatic model summaries. This document retains broader target/reference contracts; model Verifier, polling, native adapters and fixed four-day schedules are not MVP commitments.

**Proposed plan, 13 October 2026.** The selected product is an owned TypeScript harness, local npm/TUI delivery, PostgreSQL operations/history and FalkorDB memory/coordination. [Harness scope](track2-harness-scope.md) takes precedence over older native-wrapper-first notes. The [first vertical slice](track2-first-vertical-slice.md) controls deadline scope. Nothing here is a measured runtime result.

## 1. Release contents

Ship public source, one user-facing npm package or equivalent tested tarball, a lockfile, exact supported-version manifest, pinned Compose database configuration, setup/doctor commands, schema migrations, graph queries, authored fixture repository, evidence export, recovery/isolation/load scripts and a recorded demonstration. Include the chosen Track 2 declaration and AI-assistance disclosure required by the [official rules](https://www.wemakedevs.org/hackathons/falkordb/rules).

The package includes the TypeScript runtime, controlled tools, coordinator, TUI, provider driver and diagnostics. Native adapters and child spawning are post-hackathon milestones. Only passing versions/routes appear under “supported”; documented candidates are listed separately. A disabled feature has no working-looking menu action that merely returns a simulated success.

No npm name is reserved or package published by this plan. Installation examples use placeholders until release artifacts exist. No deployment is required to prepare these documents; local installation and video are the intended delivery path.

## 2. First-run flow

1. User runs `doctor`; show Node version, Docker availability or configured endpoints, storage paths, disk and project permissions.
2. User selects a repository and data-service mode: local Compose or existing authenticated endpoints.
3. `init` registers stable tenant/project/workspace IDs, creates protected local bootstrap credentials and a human app session, then initializes SQL/graph schema readiness.
4. User selects the one supported owned-runtime API profile and supplies their own credential through protected secret entry/reference. Future native compatibility will use the official installed client's sign-in; it is not part of the hackathon onboarding.
5. Show selected billing route, model/profile capabilities, tool/workspace permissions and default run budget. No silent fallback between subscription and paid API.
6. Run a small explicit readiness turn only when the user starts it; record its usage and result. Configuration discovery alone must not secretly incur inference charges.
7. Open the TUI, load the authored fixture or registered project, and start the first goal.

Usability target: 5–15 minutes after prerequisites and selected provider authentication. Measure both “warm prerequisites” and clean-machine installation; do not hide Docker/image/native downloads in a claimed one-command setup time.

## 3. Local topology

| Process/service | Runs where | Persistent data |
|---|---|---|
| CLI/TUI | Host, user account | Preferences only; backend owns durable work |
| Coordinator/model broker | Host, authenticated loopback/socket | Discovery/lock, redacted logs, request/capture journal; no offline spool promise |
| Owned runtime workers | Logical sessions in the single backend | SQL session/capture; graph task state |
| Tool command sandbox | Restricted container on demand | Registered worktree/snapshot and explicit scratch mounts |
| PostgreSQL 18 | Pinned Compose service | Named SQL volume + verified backups |
| FalkorDB | Pinned Compose service | Explicit AOF/RDB data volume + verified backups |
| Artifact storage | Host data directory | Project-scoped immutable content and manifests |
| Native compatibility, post-hackathon | Official host binary | Native client manages its own authentication/history |

Database ports bind loopback only when host access requires them. Tool containers do not inherit coordinator environment secrets or database networks. Grant only necessary network access to tests; the provider broker performs inference outside their execution environment. The first supported command sandbox targets Linux containers on one declared macOS/Docker reference machine. Linux and Windows/WSL2 host support each require later verification.

Use a service lock with a verified PID/start identity and authenticated discovery endpoint. Two simultaneous starts must attach to the same valid service or fail with an actionable conflict. A stale PID file is not proof that no process exists; reconcile process identity before replacing it.

## 4. Two-person execution plan

Follow the [code-first master checklist](track2-implementation-checklist.md), split into [Agent A](track2-agent-a-checklist.md) and [Agent B](track2-agent-b-checklist.md). Start with running service/TUI code; protected checker and release-version freezing follow the working path. Each completed A+B milestone feeds one combined branch/commit, push and merge under repository policy.

The user owns Memory/Coordinator (authority, capture, graph retrieval and evidence). The teammate owns Harness/Delivery (provider loop, tools, checker, TUI and packaging). Both pair on fixture/protocol/containment integration. No deadline was supplied; the [blueprint's ordered functional gates](track2-development-blueprint.md#10-two-person-build-sequence-and-release-gates) replace the prior four-person/four-day schedule.

## 5. Fixture and demonstration script

Use an authored inventory-export repository, synthetic data and independent assertions. The feature combines serializer correctness and a changing freshness constraint so memory applicability matters.

1. Record the human goal, exact acceptance criteria, allowed repository and command profile.
2. Run the disclosed authored imperfect seed through the protected checker and store its real failure. The model need not make an intentional mistake.
3. Builder checkpoints a candidate; The trusted service checker runs the current declared checks on a separate snapshot.
4. Human changes the freshness requirement. Persist the original source, superseding version and impacted work; show the old receipt as historical/stale.
5. Actually interrupt Builder. Record partial/unknown actions; inspect its workspace and confirm termination or quarantine.
6. Start a fresh runtime session with only the current packet and ordinary permitted repository context. Do not replay the entire old conversation or provide a manual recap.
7. Show the packet preserving the current constraint and applicable failed attempt, with original source links.
8. Successor completes the candidate. The trusted service checker checks the exact candidate/environment/criteria; graph accepts only current evidence.
9. Restart the service and inspect original conversation/evidence. Run a held-out compatible task reusing the procedure.
10. Show a separate cross-tenant denial and stale-owner/duplicate request rejection.

Post-hackathon investigation demonstration: launch two bounded read-only children, publish a relevant finding, crash one, replace it under the same lifetime budget and reject a late stale result.

## 6. Mandatory correctness tests

| ID | Stimulus | Required assertion |
|---|---|---|
| C01 | Identical command sent twice | One graph transition; identical receipt returned |
| C02 | Same operation ID, different payload | Idempotency mismatch; no second mutation |
| C03 | Two workers claim same ready task | One current owner/fence; loser gets conflict |
| C04 | Old worker submits after handoff | Stale fence rejected |
| C05 | Requirement changes during check | Old receipt cannot complete current task |
| C06 | Candidate bytes change after passing check | Candidate mismatch rejects completion |
| C07 | Native/owned runtime says “done” | Task remains incomplete until mandatory checks pass |
| C08 | Required context exceeds packet budget | Explicit overflow; no model turn with silently dropped constraints |
| C09 | A private source is semantically relevant | Excluded from unauthorized packet and citation |
| C10 | User input arrives before worker launch | Original goal/change survives launch failure |
| C11 | Model requests denied path/command | Tool never executes; refusal recorded |
| C12 | Partial streamed tool JSON | No execution before full validated call |
| C13 | Event persistence fails before tool preflight | No external effect occurs |
| C14 | Tool ends but result capture fails | Outcome marked unknown; reconcile before replay |
| C15 | Provider usage unavailable | Display unknown; no invented zero usage or precise budget claim |
| C16 | Incompatible provider tool semantics | Profile rejected before work; no silent downgrade |
| C17 | Builder marks all checklist steps completed | Task remains incomplete without current verification; current sourced checklist survives fresh recovery |
| C18 | TUI disconnects or requirement changes while clarification waits | Durable pending question; no inferred answer; stale/conflicting answer rejected; answer cannot grant tool permission |
| C19 | Long-running check is polled twice, then supervisor restarts | One execution identity; ordered captured output; scoped handles; unknown termination blocks conflicting work |
| C20 | Routine log noise and an essential current error compete for context | Exact current authority/essential diagnostic retained; optional noise omitted with sourced metadata |
| C21 | Repeated refresh and many on-demand reads | One current memory block; deduplicated sources; packet and full-request ceilings hold; mandatory overflow blocks inference |
| C22 | Summary source is private, superseded, contradicted or removed | Visibility/applicability retained; no invented root cause/truth promotion; unavailable evidence cannot support current verification |
| C23 | Run the complete interruption/recovery demo with model summarization disabled | Durable intents/results, current constraints, checkpoint and source-backed fresh recovery still work |
| C24, optional later | Many turns/repeated handoffs and source changes occur | No per-turn condensation; source-digest reuse, coalescing, budget/global reservation limits and stale/private output rejection |

Run deterministic protocol cases without paid model calls. Keep model-based behavior tests separate and report sample sizes and failures. Do not fake model reasoning in a protocol simulator and call it an agent-quality result.

## 7. Fault and restore cases

| ID | Failure point | Recovery evidence |
|---|---|---|
| F01 | After SQL capture before graph admission | Pending outbox replay; one source anchor |
| F02 | After graph commit before SQL outbox ACK | Original graph receipt recognized; no duplicate |
| F03 | Mid SQL projection transaction | Rows and cursor roll back/replay together |
| F04 | Missed notification/SSE disconnect | Scoped replay converges from durable cursor |
| F05 | Expired delivery retention | Current authorized snapshot/packet rebuild |
| F06 | Supervisor dies during launch | Stable LaunchIntent/PID-start identity reconciled |
| F07 | Process refuses cancellation/child persists | Slot retained; worktree quarantined; no writer overlap |
| F08 | SQL unavailable during runtime capture | Bounded fsynced spool; pause on bound; visible gap if unrecoverable |
| F09 | FalkorDB write timeout/reply loss | RequestReceipt lookup; no assumed rollback |
| F10 | Missing object bytes | Evidence unavailable; no false verified completion |
| F11 | Restore older graph with newer SQL view | Epoch mismatch detected; projection rebuilt |
| F12 | Whole stack crash/restart | Task/source/history/claim reconciliation passes declared durability objective |
| F13, post-hackathon | Child budget/full slots with waiting parents | Queue/reject/suspend safely; no deadlock or extra unreserved workers |

## 8. Isolation tests

Use two synthetic users in one project, two projects in one tenant and two tenants with colliding display names and fabricated target IDs. Test API reads/writes, graph selection, SQL references, message search, source resolution, artifact access, SSE replay, exports and worker enrollment. A tenant property or authenticated TUI selector is insufficient.

Test actual database roles: normal application role is not owner/superuser/BYPASSRLS; missing tenant context denies access; pooled connections cannot inherit the previous request's tenant. Test source-private records within the same tenant because tenant RLS does not solve that case.

For execution, attempt path escape, symlink escape, background process escape, environment-secret access and network access from command sandboxes. Keep all fixtures synthetic. An allowlisted test command still runs repository code; prove the sandbox rather than only testing command-name matching.

## 9. Memory and agent evaluation

For the hackathon, run the one authored and one held-out scenario plus structured-checkpoint comparison specified in [the release cut](track2-first-vertical-slice.md). The broader research campaign below is deferred; its absence must not become a claim of measured superiority.

For that later campaign, compare identical authored cases, model/profile, tools, criteria, source facts and aggregate budgets across: fresh agent without durable memory; native or owned transcript/history baseline; structured checkpoint JSON/files; the same graph closure algorithm over locked/versioned adjacency files; and FalkorDB-backed closure/coordination. Optional vector recall is a separate ablation.

Include changed requirements, misleading similar failures, an obsolete decision, a corrected procedure, missing capture and a useful rejection whose conditions later stop applying. Do not remove relation facts from a file baseline and attribute the resulting difference to the database.

Measure completed correct artifacts, constraint violations, stale-evidence acceptance, repeated invalid attempts, unsupported claims, restore tokens, tool/model calls, total usage/cost where known, latency and manual recovery effort. A packet insertion ACK measures delivery only; executable outcomes measure useful behavior.

For the later research campaign, predeclare at least twelve task/interruption variants and repeat selected cases within budget. Publish denominators and individual failures. Keep held-out procedure/recovery variants separate from tuning fixtures. If files with equivalent closure perform equally well, report that result and frame FalkorDB's contribution around coordination/query/operational behavior that was actually demonstrated.

## 10. Load test design

A broader protocol smoke-test claim requires declared inputs, duration and failures. MVP stale/duplicate contention guards remain required; four-client capacity is not promised. No high-concurrency capacity result is implied. After the hackathon, run 4, 8 and 16 **protocol clients** against one graph, then distribute the same workload across project graphs. Label real model workers separately. Use three mixes: read-heavy, balanced and simultaneous-write burst. Declare fixture graph size, payload/packet limits, index state, hardware, versions, persistence policy and test duration.

Collect successful reads/commits per second, request p50/p95/p99, admission queue delay, graph request wall time, context construction time, commit-to-insertion latency, conflicts, retries, queue depth, outbox/projection lag and invariant failures. Same-graph write serialization is expected; conflicts are distinct from infrastructure errors. Don't infer pure query CPU time by subtracting unrelated clocks.

Provisional targets, to revise after first measurements: bounded exact-context reads should usually complete within 200 ms p95 on the declared local fixture; ordinary domain commits within 250 ms p95; graph commit to available refresh within 1 second p95 at the declared non-overloaded mix. These are engineering targets, not claims or organizer thresholds. Correctness gates remain mandatory if latency misses.

Report queue saturation explicitly and return overload rather than allocating unbounded memory. Do not call 16 simulated clients “16 autonomous agents.” Do not claim more projects scale linearly; CPU/RAM/disk remain shared.

## 11. Backup, restore and retention

Quiesce new admission, finish/cancel current boundaries, drain spool/capture outbox, commit current graph checkpoints and record SQL/graph watermarks. Back up PostgreSQL, FalkorDB configured persistence and required artifact bytes. Manifest includes project/epoch, graph event sequence, capture/projection positions, schema versions, source/executable/image versions and digests. Native credential caches are excluded.

Restore into an isolated target. Verify manifest/object hashes, SQL FKs, graph invariants, epoch, source availability and cursor compatibility. Reconcile native/owned processes and external worktrees before admitting tools. Restore is not complete when both containers merely start.

Use AOF/RDB settings selected from actual persistence tests. Evaluate AOF `appendfsync always` first for the small correctness-focused demo, then measure its cost. Document recovery-point and recovery-time observations for graceful restart and abrupt failure separately; no zero-loss guarantee follows from one restart.

## 12. Release checklist

- Freeze npm lockfile, application schema versions, container digests and provider/native compatibility manifest.
- Run clean installation on declared OS/architecture targets; verify no archive checkout or developer-only absolute path is needed.
- Verify owned runtime, selected provider, tools, permissions, fresh recovery and current verification through the same packaged entry point.
- Run required protocol/isolation/restore cases and attach actual results; label skipped extensions.
- Check redaction and project/source authorization on exported evidence.
- Include full graph model, consequential Cypher queries, setup and troubleshooting in release docs.
- Record a working video with current requirement, original source, interruption, fresh session, graph context and accepted current receipts.
- Show optional features only if they pass their own gate; disclose limitations and unknown capture/accounting behavior.

## 13. Architecture-document validation record

This planning deliverable is checked for consistent scope, complete schema fields, resolvable local links, balanced fences, diagram syntax/rendering where available and a clear distinction between design and runtime evidence. The final verification report is [validation.md](validation.md). Figma publication is separate and currently restricted to read-only by the user's later instruction; see [Figma status](figma/README.md).

## 14. Adversarial review acceptance additions

These `RV` cases correspond to findings `C01–C14` in the [review register](review/track2-review-resolutions.md); they are distinct from the older correctness-case IDs above. All are unexecuted. Required core cases are release gates; future features have separate gates.

| Case | Required core behavior |
|---|---|
| RV01 command journal | Crash after human SQL commit and after graph commit/before ACK; recover the exact immutable command and one receipt, with pending distinct from accepted |
| RV02 live privacy revocation | Load a private canary, revoke its scope, deny old session/descendant admissions, retire continuation and start a sanitized fresh session; do not claim previously sent data was recalled |
| RV03 stable constraints | Supersede a constraint without updating historical version edges; current closure includes new exact rule. Missing/duplicate required current versions block work |
| RV04 model journal | Crash at prepared/dispatched/streaming/completed boundaries; retain unknown outcomes and possible charges; no premature or repeated tool mutation |
| RV05 check integrity | Builder replaces package script/helper/config with unconditional success; protected assertions outside the candidate process still detect incorrect behavior; monkey-patching, forged output and exit-zero without a trusted result fail |
| RV06 billing owner | Another active project member selects someone else's provider profile; reject before provider dispatch or native launch |
| RV07 permission race | Test tenant-wide/provider-account revocation across projects, both installation-wide gate orderings and coordinator restart: revocation-before-admission denies; admitted-before-revocation effects are cancelled/reconciled without an undo claim |
| RV08 checker isolation | Builder retains its claim; trusted service checks immutable candidate and cannot accept stale evidence. A future model Verifier needs separate assignment tests |
| RV09 packet occurrences | Same packet in two turns creates two submission records; transport retry of one occurrence deduplicates without overwriting either |
| RV10 scope manifest | Packaged core runs on one declared OS/provider with max two roles and no optional modules; every broader claim is explicitly untested/deferred |
| RV11 restored epoch | Delayed old command with coincidentally matching revision/fence is rejected by epoch; historical receipt cannot authorize fresh work |
| RV12 semantic consistency | Canonical graph edge names, allowed cancellations and provider/runtime ownership agree across current diagrams/contracts |
| RV13 derived privacy | Private canary/paraphrase and sensitive source metadata cannot enter shared checkpoint/Event/Receipt/SSE/export; authorized redacted Publication is a separate record |
| RV14 release inventory | Install, migrations, tools, UI and complete recovery trace match the declared typed-tool architecture and schema inventory |
