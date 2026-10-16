# Threadline Agent A checklist — Memory and Coordinator

**Updated 16 October 2026. M00–M03 are merged; M04 is locally integrated and verified. M05 onward remain proposed.** This is one lane of the [master code-first checklist](track2-implementation-checklist.md), not a separate product or branch. Read master sections 1–4 before editing. Use the same task IDs in your handoff. Master status is authoritative; reconcile this lane view at each milestone.

Work beside [Agent B](track2-agent-b-checklist.md) from the same recorded base and integration checkout. Do not create branches, commit, push, reset or merge during parallel coding. The integration owner creates one combined branch/commit only after both lanes and joint checks are ready.

## Ownership and first action

Own backend authority/capture/memory/storage and shared contract definitions. Your first task is useful shared types plus a small actual backend operation; no schema/checker framework before running code. Agent B owns root dependency/manifests and CLI/harness/executor/checker files.

Coordinate startup/API edits and shared types with one editor per file. Ask for needed contract/dependency changes instead of racing ownership. Preserve current dirty README/plans files. Temporary fixtures are labelled development-only and never a production fallback.

## Detailed tasks

### M00 — Small running scaffold

**Depends on:** None; start here. **Combined milestone result:** A running TypeScript backend and plain terminal frontend with an actual command/event exchange. No database or checker prerequisite.

- [x] **M00A01** Create `packages/shared/src` for public IDs, command/result envelopes, event types and typed errors. Keep database clients and secrets out of this package.
- [x] **M00A02** Create `packages/backend/src/index.ts` and one `createBackend(deps)` composition entry point; separate startup/shutdown from import-time effects.
- [x] **M00A03** Implement a small Fastify local health endpoint and a real backend-owned development status event. Health reports which components exist; it does not pretend storage/model readiness.
- [x] **M00A04** Add configuration parsing for bind address, data directory and declared limits, with actionable errors and no credential values in output.
- [x] **M00A05** Implement a backend event publisher with bounded listeners and clean shutdown. Start with process-local development events; do not advertise replay or durability yet.
- [x] **M00A06** Define the first versioned command/result/event TypeScript shapes and give Agent B a compiling import/example. Do not design every future API before coding.
- [x] **M00A07** Keep API handlers thin and domain operations independent of HTTP. Create only directories needed by working code, rather than empty repositories for every table.

**Agent A M00 verification note (15 October 2026).** M00A01–M00A07 verified in the combined working tree with `npm run build` (TypeScript 7.0.2, `strict` plus `noUncheckedIndexedAccess`) and `npm test -w @threadline/backend` (47 passing). The lane touched only `packages/shared/src` and `packages/backend/src` plus `packages/backend/test`. Fastify is imported only by `api/server.ts` and `api/routes.ts`; `domain/`, `events/` and `config.ts` contain no transport imports, and `packages/shared/src` imports only local modules and `node:crypto`. This lane note records the original handoff; the independent integration status below supersedes its pending-task list. The redundant lane handoff was subsequently removed; [combined M00 evidence](review/m00-integration-verification.md) remains.

**Before branch readiness:** coordinate with Agent B, then complete this milestone’s joint checks in [master section 5](track2-implementation-checklist.md#5-milestone-sequence). Proposed single combined commit: `feat: scaffold local backend and terminal interface`.


**Independent M00 integration verification — 15 October 2026:** all fourteen A/B tasks verified in the combined tree; M00J01–M00J03 passed. Root `npm test` passed 49 backend + 5 CLI tests, including 25 real CLI exchanges and event-subscription cleanup. Real PTY echo/Esc, disconnect, terminal restoration and backend SIGTERM passed. Fragmented SSE, subscription readiness and capacity rejection defects were fixed with regression evidence. M00J04 was pending at that verification snapshot; the user subsequently merged PR #1 with resolutions into `main` (`ed18168`), completing the Git integration step. [Full evidence and limitations](review/m00-integration-verification.md).

### M01 — Real stores, local identity and one accepted task

**Copyable launch instructions:** [M01 Agent A prompt](prompts/track2-m01-agent-a.md). Coordinate with [Agent B’s prompt](prompts/track2-m01-agent-b.md); use archive references selectively when stuck.

**Depends on:** M00. **Combined milestone result:** A human goal becomes durable SQL source/inbox and guarded graph authority, inspectable from the CLI.

- [x] **M01A01** Implement small `pg` and FalkorDB adapters with explicit connection lifecycle, parameterized operations and trusted project-to-graph routing.
- [x] **M01A02** Prepare the 31-table FK-closed core bootstrap from the reference DDL; validate real SQL syntax/constraints. Keep the two native/auth extension tables out of startup requirements.
- [x] **M01A03** Create only operations used by this trace: local tenant/user membership, project, human session, project message, command inbox, graph project/task and accepted criteria (execution Run starts at M02). Unused bootstrap tables need no services or screens.
- [x] **M01A04** Implement owner-only local bootstrap, random token hashing, session lookup, idle/absolute expiry and revocation. Do not add registration/login pages or remote enrollment.
- [x] **M01A05** Persist original human goal plus complete command envelope in one SQL transaction before graph admission; pending, accepted, rejected and unknown are distinct outcomes.
- [x] **M01A06** Implement graph readiness, reviewed unique constraints/indexes, epoch identity, request digest and idempotent state/event/receipt mutation. A query sketch is not a production mutation.
- [x] **M01A07** Create stable goal/constraint identities and immutable current versions. Missing/duplicate required current versions block authority resolution.
- [x] **M01A08** Guard same-request/same-payload retry versus same-request/different-payload conflict. Return exact committed receipt rather than an optimistic UI success.

**Before branch readiness:** coordinate with Agent B, then complete this milestone’s joint checks in [master section 5](track2-implementation-checklist.md#5-milestone-sequence). Proposed single combined commit: `feat: persist local identity and accepted task authority`.

### M01 — Combined verification update (15 October 2026)

The initial lane handoff left A04/A05 unverified. Combined integration reproduced and fixed revoked-session authentication, non-sliding idle expiry, incomplete graph topology, non-idempotent settlement and owner lookup after adding a second member. All eight A tasks now have executed real-store evidence, including session expiry/revocation, lost acknowledgement, pre-graph crash recovery, concurrent retries, original-source access and missing/duplicate current-version denial. See [the combined report](review/m01-integration-verification.md) and [implemented transport agreement](../../docs/m01-contract-agreement.md).

The redundant original Agent A handoff was removed after integration. Its fake `no-run-accepted-goal-only` marker was removed: graph Task.run_id is absent and SQL message.run_id is NULL until M02 creates a real execution Run. No provider credential is required for M01. M01J05 is complete after PR #2 merged into `067f842`.

### M02 — One owned provider turn with read-only tools

**Lane A: Memory/Coordinator.** M02 closed with real Space Bunny model/tool acceptance. [Final evidence and repairs](../../docs/m02-live-acceptance.md).

- [x] **M02A01** Implement Run/AgentSession admission with one active run, one live logical Builder, graph claim/fence, claim lease and budget reservation.
- [x] **M02A02** Implement provider-profile owner checks: run initiator, profile owner and account owner must match. Source/project grants are rechecked before release of inference.
- [x] **M02A03** Implement SQL model-request journal with logical request versus attempt IDs, prepared/dispatched/streaming/completed/unknown/failed states and observed usage; add the smallest immutable input/response artifact writer now, extending it into general Source/capture handling in M03.
- [x] **M02A04** Journal attempt intent and reserve budget before network dispatch. Persist read-tool invocation/results with stable IDs before the next turn; M03 extends them into general sourced capture/admission. Unknown sends retain reservation and possible-charge status; never automatically replay them.
- [x] **M02A05** Persist exact supported submitted input and complete visible assistant/tool-request batch. Do not persist hidden reasoning or execute partial streamed tool arguments.
- [x] **M02A06** Implement initial human-command versus worker-admission serialization gate and graph revision checks; one coordinator is the active installation authority.
- [x] **M02A07** Return typed errors for authorization, storage, context, budget and provider outcomes, with correlation IDs suitable for CLI display.

**Independent integration — 16 October 2026:** the combined tree supersedes the earlier lane handoff and blocked-state notes. See [full M02 evidence](review/m02-integration-verification.md) and the [current commands](../../docs/m02-development.md). All locally authorized gates in this lane are verified against real PostgreSQL/FalkorDB and the assembled loop. Ordinary tests: 212 passed; live tests: 33 passed, including real CLI/PTY, cancellation, private activity, receipt recovery and store-loss refusal. No paid inference or Git mutation.


### M03 — Durable capture, artifact Sources and graph admission

**Combined integration complete — 16 October 2026.** Both lanes and joint gates are verified against the assembled application. This final status supersedes intermediate M03 handoff failures and module-only evidence.

- [x] **M03A01** Implement immutable content-addressed artifact storage with safe project-relative locators, digest/size validation, atomic publication and availability states.
- [x] **M03A02** Implement capture append with stable per-session sequence positions and typed event versions; persist critical intent/result boundaries before dependent success.
- [x] **M03A03** Write capture/outbox rows transactionally and lease/replay them with the profile's polling, batch, timeout and retry limits.
- [x] **M03A04** Admit Source, Message, Observation and task-bound Attempt episodes deterministically; retain invocation/outcome/candidate/environment/revision identity.
- [x] **M03A05** Map registered-command failures, diagnostic nonzero exits and unknown effects into useful observed episodes without depending on model checkpoint text or inventing root cause.
- [x] **M03A06** Implement SQL-to-graph idempotency and ambiguous graph-write receipt reconciliation. Only known replay-safe operations get automatic retries.
- [x] **M03A07** Implement ordered graph Event projection into SQL views with cursor advancement in the same SQL projection transaction; notifications are wakeups, not delivery truth.
- [x] **M03A08** Record gaps, missing artifact bytes, ingestion lag and pending admission explicitly. Stop admission on SQL outage; do not promise an offline spool.

[Executed evidence](review/m03-integration-verification.md) records production provider capture, real artifact Sources, digest-bound graph admission/reconciliation, transactional projection, permission denial, restart recovery, cursor reconnect and actual PTY states. The affected ordinary set passed 155 checks; store/PTY acceptance covered 77 distinct cases across runs, with final focused recovery/cardinality checks. [Current commands and limitations](../../docs/m03-development.md). No M04 task or Git publication is claimed.

### M04 — Structured checkpoints and tactical state

**Integrated and verified — 16 October 2026, from `a2fe8a2`.** The earlier partial handoff and missing-composition blockers are resolved.

- [x] **M04A01** Implement runtime validation for `memory-checkpoint.schema.json` and `memory-episode.schema.json`; TypeScript declarations alone are insufficient at the boundary.
- [x] **M04A02** Build checkpoint manifests from trusted authority, candidate/environment identity, meaningful captured outcomes, unresolved effects and pending questions.
- [x] **M04A03** Maintain exact immutable checkpoint Source, TaskState pointer and CHECKPOINT_SOURCE edge atomically with state/event/receipt updates.
- [x] **M04A04** Track unique `(session_id, covered_capture_seq)` entries separately from graph-admission cursors; validate covered position never exceeds admitted/available evidence.
- [x] **M04A05** Implement automatic checkpoints for admission, accepted changes, mutating/registered-command terminal outcomes, failure, unknown effects and safe handoff; fallback after five meaningful uncheckpointed events.
- [x] **M04A06** Exclude checkpoint-publication events from their own checkpoint trigger; coalesce routine read/search activity without dropping its captured records.
- [x] **M04A07** Implement versioned plan/checkpoint patch merge that preserves unrelated progress, Sources and unresolved effects, and rejects conflicting stale updates.
- [x] **M04A08** Reconstruct structured state deterministically when the model provides no narrative recap. Model prose remains an attributed proposal, never accepted proof.

[M04 executed evidence and working commands](review/m04-integration-verification.md) record 94 focused cases and 26 real-store/terminal scenarios. This includes production seven-tool dispatch, guarded immutable TaskState/Source publication, receipt reconciliation, concurrent patch refusal/retry, automatic triggers, bounded recovery, unknown-effect preservation, authorization, four streams and actual PTY states. M06/M07 producers remain future work; their trigger seams were exercised with synthetic observations. No paid inference, permanent suites or Git publication.

### M05 — Bounded graph retrieval and context construction

**Depends on:** M03 and M04; real model loop M02. **Combined milestone result:** The next request contains exact current authority plus relevant bounded sourced memory, without replaying the old transcript.

- [ ] **M05A01** Implement indexed current-task closure from stable goals/constraints/criteria, TaskState, candidate and required Sources; do not rank mandatory authority by similarity.
- [ ] **M05A02** Resolve current governing versions, graph epoch/generation/revision and membership/source scope before selection; recheck version guards before admission.
- [ ] **M05A03** Implement P0 exact authority/unresolved effects, P1 current blockers/checklist/diagnostics, P2 compatible advice and P3 bulk references, with reasons and source/version bindings.
- [ ] **M05A04** Implement at most three hops/64 optional candidates, four advisory failures and two procedures, using declared compatibility rather than global recency.
- [ ] **M05A05** Differentiate exact proof from advice: proof requires current candidate/criteria/environment/revision; advice requires relevant paths/signature/task family/preconditions and never completes work.
- [ ] **M05A06** Implement immutable packet manifest with selected items, exact/excerpt/reference representations, template/policy version, token count precision, inclusion reasons and omission counts.
- [ ] **M05A07** Enforce 6,000 default/8,000 maximum packet and whole-request limits, preserving output/headroom. Exact mandatory overflow blocks or requires accepted narrower scope/compatible budget.
- [ ] **M05A08** Implement source deduplication by scope/version/digest; do not merge unrelated candidates/failures or treat repeat messages as corroboration.
- [ ] **M05A09** Implement task-relevant `memory.retrieve(mode=search)` with bounded output and cumulative next-request allocation; no unrestricted Cypher, vector database or classifier API.

**Before branch readiness:** coordinate with Agent B, then complete this milestone’s joint checks in [master section 5](track2-implementation-checklist.md#5-milestone-sequence). Proposed single combined commit: `feat: assemble bounded task context from graph memory`.


#### Incremental terminal contract — additional gates

See [command behavior, backend dependencies and Pi reuse](track2-terminal-command-contract.md). These new gates are proposed; prior completion marks do not cover them.

- [ ] **M05A10** Publish versioned authenticated operation-capability metadata and typed client bindings for the M05 command catalog; reuse existing routes and preserve per-call authorization.
- [ ] **M05A11** Implement authorized model/profile discovery and prospective immutable profile selection; prepare/start binds selected provider/model/billing/limits, denies stale selection and never changes an active run or probes paid inference automatically.
- [ ] **M05A12** Expose existing checkpoint/plan/recovery plus bounded refresh/context/compact/search through explicit typed human operations; define durable plain-text/follow-up admission, refusal while busy, and initial instruction Sources without silently accepting requirement changes.

### M06 — Guarded patches, snapshots and contained registered commands

**Depends on:** M02–M05; containment proof before effectful tool exposure. **Combined milestone result:** Actual bounded edits and command outcomes, with no credential/network/path escape and honest cancellation.

- [ ] **M06A01** Implement registered workspace identity, canonical paths, current candidate manifest and scope/fence/revision guards at each edit/command boundary.
- [ ] **M06A02** Persist stable tool intent/canonical arguments and admission before effects, then terminal or unknown result before returning success.
- [ ] **M06A03** Implement candidate manifest from tracked/approved untracked bytes, patch/base/dependency identities and relevant environment; a commit SHA alone is insufficient.
- [ ] **M06A04** Invalidate candidate-bound evidence when bytes change; register environment identity and preserve immutable before/after artifacts.
- [ ] **M06A05** Prevent conflicting edits/commands while an effect remains running or unknown; cancellation status alone does not release the writer.
- [ ] **M06A06** Implement budget reservations for tool count, command timeout/log/disk/snapshot limits and visible exhaustion outcomes from the development profile.
- [ ] **M06A07** Reconcile lost terminal persistence against actual command/workspace state before retry; never rerun an unknown command blindly.

**Before branch readiness:** coordinate with Agent B, then complete this milestone’s joint checks in [master section 5](track2-implementation-checklist.md#5-milestone-sequence). Proposed single combined commit: `feat: execute guarded patches and isolated registered commands`.


#### Incremental terminal contract — additional gates

See [command behavior, backend dependencies and Pi reuse](track2-terminal-command-contract.md). These new gates are proposed; prior completion marks do not cover them.

- [ ] **M06A09** Publish ordered stop/pause and authorized bounded candidate-diff/log operations for /stop, /pause, /diff and /logs; cancellation-requested, confirmed stopped and unknown remain distinct.

### M07 — Human changes, clarification and fresh successor

**Depends on:** M04–M06; provider/capture/request identities already integrated. **Combined milestone result:** Current human intent survives interruption and a fresh empty-conversation session resumes under new authority.

- [ ] **M07A01** Implement normalized human freshness change with explicit acceptance, original source/inbox, superseding requirement version and project revision barrier.
- [ ] **M07A02** Use stable task-to-constraint links to resolve new current rules without rewriting history; rebase affected task before further guarded admission.
- [ ] **M07A03** Implement durable human clarification/answer binding to question, session and requirement revision; late/conflicting/duplicate answers have explicit results.
- [ ] **M07A04** Implement retirement/handoff intent and revoke old admissions; drain required capture, reconcile unknown effects and retire/quarantine before replacing the writer.
- [ ] **M07A05** Scan ordered uncovered capture in batches of 100/max 1,000, admitting relevant episodes and publishing deterministic checkpoint when safe. Critical overflow/gaps block inference; never silently last-N the tail.
- [ ] **M07A06** Stage the successor packet locally, atomically grant new claim/fence, rebuild post-claim current context, then journal/reserve/submit first request and record actual ACK.
- [ ] **M07A07** Recover staged-but-unclaimed and claimed-but-unsent states distinctly from unknown provider dispatch; no circular ACK-before-claim dependency.
- [ ] **M07A08** Enforce initial-plus-three-replacements lifetime budget and one live model slot; logical Builder sessions receive new IDs but no fabricated operating-system PID.

**Before branch readiness:** coordinate with Agent B, then complete this milestone’s joint checks in [master section 5](track2-implementation-checklist.md#5-milestone-sequence). Proposed single combined commit: `feat: recover fresh sessions under current requirements`.


#### Incremental terminal contract — additional gates

See [command behavior, backend dependencies and Pi reuse](track2-terminal-command-contract.md). These new gates are proposed; prior completion marks do not cover them.

- [ ] **M07A09** Publish authorized session listing and explicit reattach/resume/fresh semantics plus change/answer operations; /new creates a guarded successor for the accepted task, /resume never revives retired authority or retries unknown dispatch.

### M08 — Protected checker and current-evidence completion

**Depends on:** M06–M07; deliberately after working application code. **Combined milestone result:** Only actual protected evidence for the current candidate/criteria/environment can complete the task.

- [ ] **M08A01** Implement immutable Criterion/check-bundle/launcher/environment identities and guarded receipt admission under current epoch/requirements/candidate.
- [ ] **M08A02** Bind VerificationReceipt to check_run_id and a trusted service actor through CHECKED_BY; optional model verifier session remains absent in MVP.
- [ ] **M08A03** Implement `task.request_completion`: invoke check or reuse an exact-current eligible receipt, then guard task transition against current evidence and unresolved effects.
- [ ] **M08A04** Reject stale candidate, changed requirement/environment/checker bundle, unavailable evidence and untrusted model success text.
- [ ] **M08A05** Link receipt observations, checked candidate/artifacts, criteria and exact available Sources; preserve failed/stale receipts as history rather than overwriting them.
- [ ] **M08A06** Validate permission to change accepted criteria/check bundle separately from candidate edits. A Builder cannot approve its own modified acceptance definition.

**Before branch readiness:** coordinate with Agent B, then complete this milestone’s joint checks in [master section 5](track2-implementation-checklist.md#5-milestone-sequence). Proposed single combined commit: `feat: accept completion from protected current verification`.


#### Incremental terminal contract — additional gates

See [command behavior, backend dependencies and Pi reuse](track2-terminal-command-contract.md). These new gates are proposed; prior completion marks do not cover them.

- [ ] **M08A09** Expose typed human verification/completion/evidence operations backed by the same protected checker and guarded acceptance used by model tools; preserve candidate/criteria/environment binding.

### M09 — Sourced procedural memory and semantic reuse

**Depends on:** M05 and M08. **Combined milestone result:** A procedure is created from real success, tried under explicit policy and validated from a distinct compatible run.

- [ ] **M09A01** Implement project-scoped HAS_PROCEDURE discovery with fixture/input/output/runtime/tool-policy/precondition filters for new tasks.
- [ ] **M09A02** Instantiate exactly one declared authored procedure template from actual successful execution Sources and matching trusted receipt; initial state is candidate, not universal learned truth.
- [ ] **M09A03** Record originating task/run/receipt, observed steps, Source IDs, template version, current-parameter references and applicability limitations.
- [ ] **M09A04** Permit labelled candidate advice only under the human-accepted bounded trial policy; accepted goals/constraints remain semantic authority.
- [ ] **M09A05** Validate that version only with a distinct compatible held-out task/run's exact successful receipt; repeated same receipt does not increment validation counts.
- [ ] **M09A06** Record failed reuse, narrow or invalidate applicability and preserve original evidence. Incompatible output schema/environment/private scope cannot auto-apply.
- [ ] **M09A07** Keep agent decision/rationale as proposal/checkpoint notes. Do not implement automatic lesson/decision promotion or an inference-based curator.

**Before branch readiness:** coordinate with Agent B, then complete this milestone’s joint checks in [master section 5](track2-implementation-checklist.md#5-milestone-sequence). Proposed single combined commit: `feat: validate sourced procedures through compatible reuse`.

### M10 — Simple complete TUI and local API behavior

**Depends on:** Incremental frontend work starts M00; final integration after M07–M09. **Combined milestone result:** A complete plain local user journey backed by authoritative persisted data.

- [ ] **M10A01** Finish typed local API commands used by init/admit/run/change/answer/stop/fresh/complete/history/source/context; expose only implemented operations.
- [ ] **M10A02** Authenticate loopback/socket commands, resolve trusted principal/project and validate size/schema on every boundary. No remote hosting, CORS workaround or direct DB query endpoint.
- [ ] **M10A03** Provide small pageable history/context/evidence views from projections with explicit current/pending/stale/gap states; event streams remain read-only views.
- [ ] **M10A04** Implement clean backend lifecycle, active-instance discovery/lock with PID/start identity and safe attach/conflict behavior; stale PID file alone proves nothing.
- [ ] **M10A05** Keep source grants, provider ownership and authorization-changing operations under the same coordinator ordering gate across projects.
- [ ] **M10A06** Implement backend backpressure, replay cursor/overload responses and bounded request/event payloads. No unbounded subscription/listener growth.

**Before branch readiness:** coordinate with Agent B, then complete this milestone’s joint checks in [master section 5](track2-implementation-checklist.md#5-milestone-sequence). Proposed single combined commit: `feat: complete terminal task and evidence workflow`.


#### Incremental terminal contract — additional gates

See [command behavior, backend dependencies and Pi reuse](track2-terminal-command-contract.md). These new gates are proposed; prior completion marks do not cover them.

- [ ] **M10A07** Audit command capability/transport coverage against the terminal contract and close remaining integration inconsistencies; core M05–M08 operations must already ship in their milestones.

### M11 — Recovery, scope and resource acceptance suite

**Depends on:** Features under test must exist; execute individual cases earlier as they become available. **Combined milestone result:** Executed evidence for the MVP claims, with exact versions and failures retained.

- [ ] **M11A01** Implement focused protocol/fault tests for duplicate/conflicting requests, claim competition, stale fence, changed requirements/candidates and missing current authority.
- [ ] **M11A02** Exercise SQL capture/inbox crash boundaries, graph ambiguous commit, duplicate outbox delivery, projection cursor and checkpoint merge/coverage invariants.
- [ ] **M11A03** Exercise private/source canaries across retrieval, checkpoint/Event/Receipt/SSE/history/export and sanitized fresh continuation. Unsupported private ingestion is rejected rather than pretending publication exists.
- [ ] **M11A04** Exercise tenant/project/source membership and provider-account revocation orderings before/after admission and across restart; already admitted effects are reconciled, not retroactively undone.
- [ ] **M11A05** Exercise restored graph epoch against delayed commands with coincidentally matching revision/fence; distinguish observation repair from authorizing old work.
- [ ] **M11A06** Exercise retained-source deletion/tombstone and evidence unavailability, cumulative packet/request limits, mandatory overflow and incompatible advice predicates.
- [ ] **M11A07** Verify one run/one live model session, replacement/lease/budget reservation bounds, unknown usage and no summarizer calls in the complete trace.

**Before branch readiness:** coordinate with Agent B, then complete this milestone’s joint checks in [master section 5](track2-implementation-checklist.md#5-milestone-sequence). Proposed single combined commit: `test: verify continuity isolation and bounded execution`.

### M12 — Honest memory comparison and minimal operational evidence

**Depends on:** M08–M11. **Combined milestone result:** Measured authored-workload continuity outcomes, not assumed graph or multi-agent superiority.

- [ ] **M12A01** Implement the equally informed structured-checkpoint baseline using the same accepted requirements, source facts, tools, checks and budget as graph retrieval.
- [ ] **M12A02** Define fixed authored/held-out interruption points and outcome measures before recording runs; do not remove relation facts from the baseline to manufacture graph advantage.
- [ ] **M12A03** Capture correctness/current-evidence outcomes, repeated invalid attempts, included/omitted sources, packet/input tokens, tool/model calls, usage/cost where known and recovery effort.
- [ ] **M12A04** Collect capture/outbox/projection lag and conflict/overload observations for the declared actual trace. Do not infer high concurrency from one model slot.
- [ ] **M12A05** Provide immutable redacted evidence manifest with schema/epoch/capture positions and versions, sufficient to understand what was actually observed.
- [ ] **M12A06** Keep runtime persistence/restart evidence separate from full backup/restore or high-concurrency claims; add those claims only after their explicit tests.

**Before branch readiness:** coordinate with Agent B, then complete this milestone’s joint checks in [master section 5](track2-implementation-checklist.md#5-milestone-sequence). Proposed single combined commit: `feat: export reproducible continuity comparison evidence`.

### M13 — Package, doctor and release readiness

**Depends on:** M00–M12 core path; packaging code can be developed earlier. **Combined milestone result:** One tested npm/tarball entry point usable without developer/archive dependencies.

- [ ] **M13A01** Finish versioned migration/readiness operations and startup refusal for schema mismatch, unavailable required Sources and incompatible graph epoch/state.
- [ ] **M13A02** Configure and test database persistence volumes/options on the selected target, including graceful restart and abrupt-failure limitations.
- [ ] **M13A03** Make data/artifact paths configurable and project-scoped; preserve accepted evidence while allowing bounded bulk-retention policy.
- [ ] **M13A04** If full backup is advertised, implement coordinated SQL/graph/artifact watermark manifest and isolated restore validation now; otherwise mark full backup/restore deferred and document basic persistence limits.
- [ ] **M13A05** Update source/schema/operation documentation to actual implementation and fix drift in backend invariants/graph field dictionaries.
- [ ] **M13A06** Keep secrets outside exported backups/evidence and fail restore/startup with unavailable evidence rather than fabricating repair.

**Before branch readiness:** coordinate with Agent B, then complete this milestone’s joint checks in [master section 5](track2-implementation-checklist.md#5-milestone-sequence). Proposed single combined commit: `feat: package local harness with setup diagnostics`.


#### Incremental terminal contract — additional gates

See [command behavior, backend dependencies and Pi reuse](track2-terminal-command-contract.md). These new gates are proposed; prior completion marks do not cover them.

- [ ] **M13A07** Expose packaged bounded doctor diagnostics using backend/provider-profile readiness without automatic paid probes.

## Full-plan obligations and final handoff

Your lane also participates in master [tool audit](track2-implementation-checklist.md#6-final-eleven-tool-completeness-audit), [artifact/schema coverage](track2-implementation-checklist.md#7-full-plan-and-schema-coverage), [acceptance mapping](track2-implementation-checklist.md#8-acceptance-case-disposition), and assigned parts of [deferred extensions](track2-implementation-checklist.md#9-deferred-work-covering-the-broader-target) only after explicit scope selection.

- [ ] Report completed IDs/paths, actual checks, shared-contract changes and open blockers using the [handoff template](track2-implementation-checklist.md#10-handoff-and-milestone-completion).
- [ ] Confirm your files integrate with the other lane; individual compilation is not the combined feature gate.
- [ ] Leave branch/staging/commit/push/merge to the integration owner after both handoffs and joint validation.
- [ ] Reconcile checkbox status into master after verified integration/merge; mark no runtime task done merely because it exists in a plan.
