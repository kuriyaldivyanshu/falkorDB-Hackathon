# Threadline Agent B checklist — Harness and Frontend

**15 October 2026. Proposed implementation work; all tasks initially unexecuted.** This is one lane of the [master code-first checklist](track2-implementation-checklist.md), not a separate product or branch. Read master sections 1–4 before editing. Use the same task IDs in your handoff. Master status is authoritative; reconcile this lane view at each milestone.

Work beside [Agent A](track2-agent-a-checklist.md) from the same recorded base and integration checkout. Do not create branches, commit, push, reset or merge during parallel coding. The integration owner creates one combined branch/commit only after both lanes and joint checks are ready.

## Ownership and first action

Own provider/harness, workspace/executor/checker, CLI/TUI, fixture and root dependency/package configuration. Your first task is the plain CLI/TUI and normal workspace setup; no fancy UI, provider library fleet or manual lockfile project. Agent A owns authority/storage and shared contract definitions.

Coordinate startup/API edits and shared types with one editor per file. Ask for needed contract/dependency changes instead of racing ownership. Preserve current dirty README/plans files. Temporary fixtures are labelled development-only and never a production fallback.

## Detailed tasks

### M00 — Small running scaffold

**Depends on:** None; start here. **Combined milestone result:** A running TypeScript backend and plain terminal frontend with an actual command/event exchange. No database or checker prerequisite.

- [x] **M00B01** Own root `package.json`, workspace configuration, `tsconfig` and dependency edits. Use three packages only: shared, backend and cli; no browser app or microservice fleet.
  Root `package.json` (workspaces `packages/*`), `tsconfig.base.json`, `tsconfig.json` (solution referencing all three packages). Manifests and `tsconfig.json` for `shared` and `backend` were also written by this lane because both lanes block on them; their `src/` remains Agent A's. Build: `npm run build` (`tsc -b`), clean: `npm run clean`.
- [x] **M00B02** Create `packages/cli/src` with a plain command entry point using `util.parseArgs`, then a minimal React/Ink view that connects to the backend.
  `src/index.ts` + `src/options.ts` (three commands: `tui`, `health`, `echo`); transport isolated in `src/transport/`; view in `src/ui/` and `src/tui.tsx`.
- [x] **M00B03** Display service connection state, a text activity stream and a simple input/action. Avoid graph widgets, themes, animations and settings screens at scaffold time.
  `ConnectionStatus`, `ActivityLog` (buffer capped at 200 entries, dropped count shown), `CommandBar` (single `TextInput`). No themes, animations, extra screens or dashboard.
- [x] **M00B04** Wire one real development command through the backend and show its actual acknowledgement/event; label this mode as development-only and non-durable.
  `development.echo` only. Verified against a running backend: acknowledgement and the matching `development.echo.accepted` event share one `commandId`/`echoId`, both labelled `durability=development-only`. The event is often published before the command answer arrives, so the one-shot subscribes first and buffers, because the backend has no replay.
- [x] **M00B05** Add only scripts needed to run/build the current code. Install actual dependencies normally; retain the automatically generated dependency lockfile without turning it into a separate preparatory project.
  Root `build`/`clean`; per-package `build`/`clean`/`start` (+ `test` for backend). One generated root `package-lock.json`, no hand-authored lockfile and no second lockfile project.
- [x] **M00B06** Add standard ignores for dependencies, generated build output, OS files, local data and credential files; preserve existing plans and archives.
  The initial `.gitignore` extended the pre-existing `archive/` and `.DS_Store` entries with `node_modules/`, `dist/`, `*.tsbuildinfo`, `.threadline/`, logs and credential files. Verified with `git check-ignore`.
- [x] **M00B07** Keep TUI input/render state local, while task status comes from the backend. No frontend direct SQL/FalkorDB access or provider calls.
  All render state lives in `ui/` refs/reducers; every status string is rendered from a backend answer. `packages/cli/src` imports only `node:util` — no `pg`, `falkordb`, `fastify`, provider SDK, `node:fs`, `node:child_process` or `process.env`.

**Before branch readiness:** coordinate with Agent A, then complete this milestone’s joint checks in [master section 5](track2-implementation-checklist.md#5-milestone-sequence). Proposed single combined commit: `feat: scaffold local backend and terminal interface`.

**M00 lane verification (Agent B, base `91f8af4`, Node v23.11.0, TypeScript 7.0.2):**

| Check | Command | Observed |
| --- | --- | --- |
| Workspace build | `npm run build` | clean, exit 0, all three packages |
| Health | `node packages/cli/dist/index.js health` | `state=ready protocol=1 ... durable=false replayable=false` |
| Round trip | `node packages/cli/dist/index.js echo "final verification"` | acknowledgement + event, same `commandId`/`echoId`, exit 0 |
| Rejection | `node packages/cli/dist/index.js echo ""` | backend `invalid_request` rendered, exit 1 |
| Connection failure | `node packages/cli/dist/index.js --backend http://127.0.0.1:47899 health` | `ECONNREFUSED` reported, exit 1 |
| Cleanup / no listener leak | 25 sequential `echo` runs against a 16-listener cap | 25/25 round trips, backend still `ready` |
| Terminal round trip | TUI under a pty: type, Enter, Esc | command sent, event + ack rendered, exit code 0 |
| Disconnect | backend killed mid-session | `backend.status state=stopping` received, `disconnected`, retry hint, no stale `state ready` |
| Frontend isolation | grep over `packages/cli/src` | only `node:util` imported |

**Independent integration correction:** backend tests are included by `packages/backend/tsconfig.json` and the suite exits normally in the independent rerun. Client/server routes match. Per user decision, `archive/plans` remains active and is now eligible for Git staging. Node 24 compatibility is still unverified; see the integration evidence below.


**Independent M00 integration verification — 15 October 2026:** all fourteen A/B tasks verified in the combined tree; M00J01–M00J03 passed. Root `npm test` passed 49 backend + 5 CLI tests, including 25 real CLI exchanges and event-subscription cleanup. Real PTY echo/Esc, disconnect, terminal restoration and backend SIGTERM passed. Fragmented SSE, subscription readiness and capacity rejection defects were fixed with regression evidence. M00J04 remains pending the actual branch/commit workflow. [Full evidence and limitations](review/m00-integration-verification.md).

### M01 — Real stores, local identity and one accepted task

**Depends on:** M00. **Combined milestone result:** A human goal becomes durable SQL source/inbox and guarded graph authority, inspectable from the CLI.

- [ ] **M01B01** Add minimal Docker Compose PostgreSQL/FalkorDB services with explicit persistent volumes and host-local connectivity; do not begin with a deployment platform.
- [ ] **M01B02** Select compatible development runtime/client/image versions while using them; record observations. Immutable release digests and a polished doctor are later packaging work.
- [ ] **M01B03** Wire CLI `init` and task admission to the real backend; show pending versus accepted criteria and source IDs.
- [ ] **M01B04** Load the existing authored fixture manifest as data; let the user explicitly accept its bounded goal/criteria. Do not translate arbitrary prose into hidden tests.
- [ ] **M01B05** Keep model API credentials unset for this stage. Model and command containers must not receive database credentials later.
- [ ] **M01B06** Implement a simple backend connection/start/stop view with real errors, retry action and cancellation of UI connection; closing the TUI does not delete persisted work.
- [ ] **M01B07** Make configured endpoint versus local Compose behavior explicit; refuse an unreachable/misconfigured store instead of falling back to pretend memory.

**Before branch readiness:** coordinate with Agent A, then complete this milestone’s joint checks in [master section 5](track2-implementation-checklist.md#5-milestone-sequence). Proposed single combined commit: `feat: persist local identity and accepted task authority`.

### M02 — One owned provider turn with read-only tools

**Depends on:** M01; shared types from M00. **Combined milestone result:** One real API-backed model/tool round trip, with guarded admission and persisted request/result identity.

- [ ] **M02B01** Implement one OpenAI Responses driver behind a narrow provider interface, using the actual account-compatible chosen model; do not add a driver factory for every provider.
- [ ] **M02B02** Implement caller-owned conversation reconstruction, streaming frame/tool-call correlation, terminal response handling, usage reporting and cancellation/unknown behavior.
- [ ] **M02B03** Read `OPENAI_API_KEY` only in coordinator/provider code; redact it and avoid forwarding its environment to any execution helper.
- [ ] **M02B04** Implement the bounded sequential model → validated tool → result → next-turn loop, with an abort path and maximum attempts/tools/wall time.
- [ ] **M02B05** Create the actual small authored imperfect inventory-export candidate workspace from the manifest now, retaining its original seed template outside the mutable candidate and disclosing the UTC defect; protected assertions/receipt infrastructure come in M08. Implement `workspace.read`, `workspace.search` and `workspace.inspect` against those existing files with range/result limits, digests and explicit truncation.
- [ ] **M02B06** Validate path traversal, symlink escape and unsupported encodings; use argument arrays for any search helper, never an interpolated shell command.
- [ ] **M02B07** Display streamed visible text/tool activity in the plain TUI while retaining only allowed durable completed records. Mark partial/gapped outcomes honestly.
- [ ] **M02B08** Expose only the three implemented read-only tools initially; the final eleven-tool registry is added as real implementations become available.

**Before branch readiness:** coordinate with Agent A, then complete this milestone’s joint checks in [master section 5](track2-implementation-checklist.md#5-milestone-sequence). Proposed single combined commit: `feat: run journaled provider turns with read-only tools`.

### M03 — Durable capture, artifact Sources and graph admission

**Depends on:** M01; integrate with M02. **Combined milestone result:** Tool/model evidence has available original bytes and idempotent graph provenance.

- [ ] **M03B01** Wire provider and read-tool lifecycle events into the capture service: complete invocation, result and final visible response keep their original correlation IDs.
- [ ] **M03B02** Implement bounded stdout/message chunk capture plumbing for future commands, with declared ordering, 16 KiB chunks/250 ms flush and partial/gap behavior.
- [ ] **M03B03** Add backend history/source range transport and CLI inspection that rechecks source permission on every read; raw arbitrary artifact paths are unavailable.
- [ ] **M03B04** Implement `memory.retrieve(mode=source)` with source ID, byte offset and at most 32 KiB, returning digest/size/range/truncation/status.
- [ ] **M03B05** Implement SSE cursor reconnect using persisted projections once available; use bounded frontend event buffers and show gaps requiring refresh.
- [ ] **M03B06** Display capture pending/available/missing status separately from task truth and successful tool status.
- [ ] **M03B07** Do not add graph rendering, full transcript injection or token-by-token SQL/graph writes to this stage.

**Before branch readiness:** coordinate with Agent A, then complete this milestone’s joint checks in [master section 5](track2-implementation-checklist.md#5-milestone-sequence). Proposed single combined commit: `feat: capture sourced runtime evidence and reconcile graph admission`.

### M04 — Structured checkpoints and tactical state

**Depends on:** M03. **Combined milestone result:** Current progress/checklist is source-backed, with exact per-session coverage and automatic failure-safe persistence.

- [ ] **M04B01** Implement `memory.checkpoint` with bounded progress/next-action/plan patches; server-owned coverage/authority fields cannot be overridden by model input.
- [ ] **M04B02** Implement `task.update_plan`: at most eight steps, one in progress, stable step IDs and allowed transitions; all-completed checklist does not imply verified task completion.
- [ ] **M04B03** Implement `memory.refresh` to return a current binding/packet status and distinguish ready, stale, blocked and capture-pending.
- [ ] **M04B04** Add plain TUI current checklist, next action, blocker and checkpoint/source inspection; avoid duplicated frontend task-state mutation logic.
- [ ] **M04B05** Provide a durable source link for each accepted checklist update and display conflict/retry guidance without hiding stale revisions.
- [ ] **M04B06** Give Agent A actual tool result fields needed by deterministic episode/checkpoint generation; do not use hand-crafted success strings as observations.

**Before branch readiness:** coordinate with Agent A, then complete this milestone’s joint checks in [master section 5](track2-implementation-checklist.md#5-milestone-sequence). Proposed single combined commit: `feat: persist structured checkpoints with capture coverage`.

### M05 — Bounded graph retrieval and context construction

**Depends on:** M03 and M04; real model loop M02. **Combined milestone result:** The next request contains exact current authority plus relevant bounded sourced memory, without replaying the old transcript.

- [ ] **M05B01** Replace the single current memory block on request reconstruction instead of appending another copy per refresh.
- [ ] **M05B02** Keep valid tool-call/result pairs in bounded recent working history; prune an entire obsolete episode or replace it with an attributed record, not an orphaned tool response.
- [ ] **M05B03** Include instructions, tool schemas, current input, history and memory in whole-request budget accounting; use a compatible tokenizer or conservative labelled estimate.
- [ ] **M05B04** Wire search/refresh/source retrieval to the dispatcher with exact returned Sources and policy limits.
- [ ] **M05B05** Record context submission occurrence IDs tied to each model attempt; same packet in two turns has two delivery records, persistence retry of one occurrence deduplicates.
- [ ] **M05B06** Implement plain context-inspector text: current requirement/revision, included failure/advice reasons, Source ranges and omitted counts.
- [ ] **M05B07** Test request rendering with many individually small retrieval calls so cumulative growth cannot bypass the next input limit.

**Before branch readiness:** coordinate with Agent A, then complete this milestone’s joint checks in [master section 5](track2-implementation-checklist.md#5-milestone-sequence). Proposed single combined commit: `feat: assemble bounded task context from graph memory`.

### M06 — Guarded patches, snapshots and contained registered commands

**Depends on:** M02–M05; containment proof before effectful tool exposure. **Combined milestone result:** Actual bounded edits and command outcomes, with no credential/network/path escape and honest cancellation.

- [ ] **M06B01** Implement `workspace.apply_patch`: expected candidate digest, 64 KiB/eight-path bounds, validate all paths before mutation and reject traversal/symlink escapes.
- [ ] **M06B02** Implement actual command executor with explicit argument arrays, noninteractive IO, deadlines and process/container identity; no model-selected shell interpolation.
- [ ] **M06B03** Implement Docker restriction profile: one CPU, 512 MiB RAM, 64 PIDs, non-root 10001, read-only root/candidate, bounded scratch, network none, capabilities dropped and no-new-privileges.
- [ ] **M06B04** Exclude provider/DB credentials, host sockets and protected assertion directories from execution mounts/environment.
- [ ] **M06B05** Implement synchronous `workspace.run(diagnose)` using published case input/current accepted parameters and `build` using fixed node syntax argv; `verify` remains unavailable until M08.
- [ ] **M06B06** Keep candidate snapshot read-only in commands; code edits occur only through the guarded patch path. Scratch is separate and bounded.
- [ ] **M06B07** Implement real log capture with 1 MiB total bound/32 KiB model-visible result and explicit truncation; TUI streams captured chunks without model polling.
- [ ] **M06B08** Implement two-second termination grace, child/container reap, stopped-state proof and quarantine on uncertain termination.
- [ ] **M06B09** Add TUI stop/pause controls with stopped versus cancellation-requested versus unknown status; no fake success when a command outlives the UI.

**Before branch readiness:** coordinate with Agent A, then complete this milestone’s joint checks in [master section 5](track2-implementation-checklist.md#5-milestone-sequence). Proposed single combined commit: `feat: execute guarded patches and isolated registered commands`.

### M07 — Human changes, clarification and fresh successor

**Depends on:** M04–M06; provider/capture/request identities already integrated. **Combined milestone result:** Current human intent survives interruption and a fresh empty-conversation session resumes under new authority.

- [ ] **M07B01** Implement `interaction.ask_user` with at most three questions/one pending request, stable invocation ID, bounded choices and durable question Sources.
- [ ] **M07B02** Pause dependent work until an actual required answer/cancellation; elapsed time is not an answer or tool permission.
- [ ] **M07B03** Wire user requirement edit, question answer and continue-fresh to authenticated backend commands; TUI preview shows normalized accepted value/version.
- [ ] **M07B04** Create successor with empty caller-owned model history, new session identity and only current packet/ordinary repository context; never resume an old hidden provider thread.
- [ ] **M07B05** Show the old session retirement, unknown-effect reconciliation, new claim and exact submitted packet/source link as text events.
- [ ] **M07B06** Handle TUI disconnect and backend restart without losing pending questions or turning a requested cancellation into confirmed termination.
- [ ] **M07B07** Avoid forcing a new edit after freshness changes if the candidate already handles current parameters; stale proof still requires a new current check.

**Before branch readiness:** coordinate with Agent A, then complete this milestone’s joint checks in [master section 5](track2-implementation-checklist.md#5-milestone-sequence). Proposed single combined commit: `feat: recover fresh sessions under current requirements`.

### M08 — Protected checker and current-evidence completion

**Depends on:** M06–M07; deliberately after working application code. **Combined milestone result:** Only actual protected evidence for the current candidate/criteria/environment can complete the task.

- [ ] **M08B01** Use the actual authored seed created in M02 and implement protected assertion code from the manifest now; retain defect disclosure and verify fixed expected outputs independently.
- [ ] **M08B02** Implement trusted supervisor/assertions/receipt writer outside candidate-controlled execution. Candidate stdout/status are untrusted data consumed by this supervisor.
- [ ] **M08B03** Run candidate exporter in restricted read-only snapshot with service-selected args/inputs; never use editable candidate npm scripts as success authority.
- [ ] **M08B04** Implement registered `workspace.run(verify)` dispatch to this supervisor, returning real receipt/rejection/blocked/unknown, not candidate-generated pass JSON.
- [ ] **M08B05** Cover UTC offset normalization, age boundaries/future timestamps, sorted CSV/escaping/header, empty input and invalid/duplicate data. Fix executable RFC3339 grammar/error behavior before expanding inputs.
- [ ] **M08B06** Display actual per-criterion results, stale-receipt reason and accepted completion in a plain terminal view; show proposal versus proof explicitly.
- [ ] **M08B07** Keep check run process/log identity separate from logical Builder identity and do not create a fictitious second model session.

**Before branch readiness:** coordinate with Agent A, then complete this milestone’s joint checks in [master section 5](track2-implementation-checklist.md#5-milestone-sequence). Proposed single combined commit: `feat: accept completion from protected current verification`.

### M09 — Sourced procedural memory and semantic reuse

**Depends on:** M05 and M08. **Combined milestone result:** A procedure is created from real success, tried under explicit policy and validated from a distinct compatible run.

- [ ] **M09B01** Add a simple new held-out fixture task entry path reusing the same implementation harness and policy; no new screen or agent role required.
- [ ] **M09B02** Implement published held-out examples and incompatible inventory-json-v2 case without sending protected held-out inputs to the authoring model's initial run.
- [ ] **M09B03** Show procedure candidate/validated status, prerequisites, evidence and why it was selected in the context inspector.
- [ ] **M09B04** Parameterize freshness from current accepted criteria instead of storing literal 600/60 as a universal procedure rule.
- [ ] **M09B05** Run reuse with normal allowed tools, capture actual choice/result and avoid manually pre-seeding a fake learned success in the graph.
- [ ] **M09B06** Disclose that template and fixture family were authored and held-out specification is published, so this is not a statistically independent benchmark.

**Before branch readiness:** coordinate with Agent A, then complete this milestone’s joint checks in [master section 5](track2-implementation-checklist.md#5-milestone-sequence). Proposed single combined commit: `feat: validate sourced procedures through compatible reuse`.

### M10 — Simple complete TUI and local API behavior

**Depends on:** Incremental frontend work starts M00; final integration after M07–M09. **Combined milestone result:** A complete plain local user journey backed by authoritative persisted data.

- [ ] **M10B01** Consolidate the plain TUI into input/current task/checklist, live activity, and Source/context/receipt inspector views; keep business decisions out of render components.
- [ ] **M10B02** Support keyboard-only navigation, clear focus, Ctrl-C behavior, narrow terminals, non-color status and screen-reader-friendly text where feasible.
- [ ] **M10B03** Show billing route/model/run limits, current requirements, active session/fence, pending question, selected evidence and final accepted result in plain language.
- [ ] **M10B04** Support stop versus pause/fresh semantics with actual backend states; closing the view preserves backend/task/data and reconnect works.
- [ ] **M10B05** Display typed failures with useful next action, bounded logs and Source drill-down; no credential/private metadata in errors.
- [ ] **M10B06** Remove development fake adapters/actions from packaged normal paths; unavailable deferred features have no working-looking menu buttons.
- [ ] **M10B07** Ensure UI memory use stays bounded with long streams, invalid events and repeated reconnection; no need for an elaborate graph visualization.

**Before branch readiness:** coordinate with Agent A, then complete this milestone’s joint checks in [master section 5](track2-implementation-checklist.md#5-milestone-sequence). Proposed single combined commit: `feat: complete terminal task and evidence workflow`.

### M11 — Recovery, scope and resource acceptance suite

**Depends on:** Features under test must exist; execute individual cases earlier as they become available. **Combined milestone result:** Executed evidence for the MVP claims, with exact versions and failures retained.

- [ ] **M11B01** Implement focused provider protocol tests for streaming completion, malformed/partial tools, disconnects, rate limits, cancellation and distinct occurrence IDs.
- [ ] **M11B02** Execute containment/checker tampering and child-stop tests on the actual reference Docker/OS target, including timeout/stdout/scratch pressure.
- [ ] **M11B03** Use deterministic provider/clock fixtures for ordinary tests, with explicit paid integration runs separated from default commands.
- [ ] **M11B04** Execute CLI/TUI reconnect, pending questions, source-range truncation, log gaps, service conflict and shutdown cases using packaged or near-packaged code.
- [ ] **M11B05** Record actual selected model capability and input/output compatibility; do not infer support from a catalog entry or key presence.
- [ ] **M11B06** Collect structured per-case results with run/source/check IDs, versions, setup, expected versus actual outcome, known capture limitations and relevant redacted logs.
- [ ] **M11B07** Keep tests tied to consequential behavior; avoid coverage-percentage targets, implementation-mirroring tests and a bespoke general-purpose test framework.

**Before branch readiness:** coordinate with Agent A, then complete this milestone’s joint checks in [master section 5](track2-implementation-checklist.md#5-milestone-sequence). Proposed single combined commit: `test: verify continuity isolation and bounded execution`.

### M12 — Honest memory comparison and minimal operational evidence

**Depends on:** M08–M11. **Combined milestone result:** Measured authored-workload continuity outcomes, not assumed graph or multi-agent superiority.

- [ ] **M12B01** Build a small comparison runner using existing CLI/runtime paths, not a separate benchmark application or new agent architecture.
- [ ] **M12B02** Run both routes with the same model/profile and authored workload; report denominator, each failure, latency and aggregate budget, including unknown usage.
- [ ] **M12B03** Keep source permissions/redaction when exporting packets/log excerpts; no provider tokens, local credential caches or private conversation dump.
- [ ] **M12B04** Record a simple terminal demo showing accepted rule, real failure Source, interruption, fresh submitted context and current protected receipt.
- [ ] **M12B05** Write limitations: one authored family, one held-out compatible task, one declared platform/provider, small sample and published fixture template.
- [ ] **M12B06** Report equally good baseline performance honestly; describe graph coordination/query behavior only where actually demonstrated.

**Before branch readiness:** coordinate with Agent A, then complete this milestone’s joint checks in [master section 5](track2-implementation-checklist.md#5-milestone-sequence). Proposed single combined commit: `feat: export reproducible continuity comparison evidence`.

### M13 — Package, doctor and release readiness

**Depends on:** M00–M12 core path; packaging code can be developed earlier. **Combined milestone result:** One tested npm/tarball entry point usable without developer/archive dependencies.

- [ ] **M13B01** Build the one user-facing npm package or tested tarball with CLI entry, backend/TUI/shared runtime dependencies; inspect `npm pack` contents and install from it in a clean directory.
- [ ] **M13B02** Implement practical `doctor`: Node/Docker/store/storage/model-profile/config checks with actionable errors and no automatic paid inference.
- [ ] **M13B03** Provide minimal init/run/tui/service/setup instructions and troubleshooting, plus explicit local-Compose versus configured-endpoint guidance.
- [ ] **M13B04** Freeze the actual generated lockfile and selected patches/container digests/profile/schema versions for the tested release; this happens after running code exists.
- [ ] **M13B05** Verify package contains no archive checkout, local absolute developer path, secrets, test-only fake runtime or unused extension dependencies.
- [ ] **M13B06** Measure warm-prerequisite and clean-install setup separately if reporting time; one macOS/Docker target is supported only after actual installation checks.
- [ ] **M13B07** Provide uninstall/cleanup guidance that preserves user data by default and makes destructive volume deletion explicit.
- [ ] **M13B08** Recheck current official submission requirements at submission time; include actual repository/setup/video/evidence and assistance disclosure where required, without relying solely on historical notes.

**Before branch readiness:** coordinate with Agent A, then complete this milestone’s joint checks in [master section 5](track2-implementation-checklist.md#5-milestone-sequence). Proposed single combined commit: `feat: package local harness with setup diagnostics`.

## Full-plan obligations and final handoff

Your lane also participates in master [tool audit](track2-implementation-checklist.md#6-final-eleven-tool-completeness-audit), [artifact/schema coverage](track2-implementation-checklist.md#7-full-plan-and-schema-coverage), [acceptance mapping](track2-implementation-checklist.md#8-acceptance-case-disposition), and assigned parts of [deferred extensions](track2-implementation-checklist.md#9-deferred-work-covering-the-broader-target) only after explicit scope selection.

- [ ] Report completed IDs/paths, actual checks, shared-contract changes and open blockers using the [handoff template](track2-implementation-checklist.md#10-handoff-and-milestone-completion).
- [ ] Confirm your files integrate with the other lane; individual compilation is not the combined feature gate.
- [ ] Leave branch/staging/commit/push/merge to the integration owner after both handoffs and joint validation.
- [ ] Reconcile checkbox status into master after verified integration/merge; mark no runtime task done merely because it exists in a plan.
