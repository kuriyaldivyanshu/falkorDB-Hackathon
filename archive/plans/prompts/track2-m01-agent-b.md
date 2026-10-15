# M01 launch prompt — Agent B: local services and durable CLI flow

You are Agent B for Threadline. Implement your M01 lane in `/Users/dkuriyal/Desktop/falkorDB-Hackathon`. Agent A works concurrently in the same checkout on identity, schemas, PostgreSQL/FalkorDB operations and authority. Complete real code and meaningful verification; do not stop after proposing an implementation.

## 1. Milestone and baseline

The user has merged M00 and its review resolutions. The checkout inspected when this prompt was written was clean `main`, merge commit `ed18168`, with implementation commit `13b17a2`. Verify actual current status/history and preserve newer changes; do not reset to these hashes.

M01's outcome is: **a user initializes a local project, explicitly accepts the authored fixture goal/criteria, sees the actual durable admission result and can inspect the same accepted task after backend restart.** No coding model, execution sandbox or protected checker is required in M01.

Do not create/switch branches, stage, commit, push, merge, reset, stash or discard work. Both agents develop one combined batch; the integration owner handles one branch/commit after both lanes and joint verification. Do not spawn additional agents. Record the same base as A and preserve pre-existing dirty files, including these new prompt documents.

Read:

- `AGENTS.md`, `README.md` and `CONTEXT.md`.
- `archive/plans/track2-implementation-checklist.md`: sections 1–4, M01 and joint tasks; your M01 block in `track2-agent-b-checklist.md`.
- `archive/plans/track2-development-blueprint.md`, `track2-first-vertical-slice.md`, and selected technology/local-delivery guidance.
- `archive/plans/contracts/fixture-manifest.json` and relevant local-auth/configuration limits in `development-profile.json`.
- Current shared contracts, backend health/routes/lifecycle and CLI options/transport/TUI/tests.
- Relevant data-model/storage evidence and the M00 verification report, distinguishing historical limitations from the merged resolution code.

Before architecture/delivery changes, read the four historical background documents linked by README. They do not override the current owned-harness scope. Agent A owns the initial combined baseline build/test run; share its observed result rather than racing root changes. Wait for that short baseline run to finish before changing dependencies or running an install. You can implement independent Compose/CLI scaffolding while A publishes contracts.

Preserve merged M00 improvements: explicit event-stream readiness, correct fragmented SSE parsing, capacity handling, nested health checks, concurrent lifecycle synchronization, nonfatal malformed-frame reporting through `onFrameError`, first-failure retention and TUI startup/stopping behavior. Do not restore pre-review event handler shapes from an old prompt or archive.

## 2. Ownership and contract handoff

You own:

- Root package/workspace/build metadata, dependency installs and the generated lockfile.
- Minimal Docker Compose/development service configuration and setup documentation/helpers.
- `packages/cli`: options, transport client, local application-credential access and plain terminal views.
- Your lane checklist and concise M01 setup/run documentation.

A owns shared public contracts, backend config/composition/routes, identity/coordinator/storage, SQL migrations/Cypher and master status. Do not independently edit these files or invent duplicate domain types. Request contract/backend changes through available agent messaging or the integration coordinator, with one agreed editor per shared file. Do not run concurrent package installs; you are the dependency-file owner.

Agree with A before wiring the live durable flow:

1. Bootstrap/init, authenticated read and admission operation names/routes.
2. Application credential acquisition/storage and HTTP authentication headers.
3. Stable request-ID persistence/retry semantics, fixture acceptance fields and result/status/receipt shapes.
4. Backend-only SQL/FalkorDB variable names, local Compose versus external endpoints and persistence readiness.
5. Project/task/criteria/source inspection operations and what a planned versus executing Run means.
6. What remains M00 process-local, especially echo and SSE. Do not present all events/history as durable merely because task admission is durable.

A must resolve the schema's required `runs.initial_profile_id` versus no-provider M01 seam. Do not insert fabricated profile/account/model IDs or start M02 to work around it. You may display the legitimate accepted task identity while A establishes the tested non-executing representation.

## 3. Implement M01B01–M01B07

### M01B01 — Minimal actual local data services

Add one small Compose definition for PostgreSQL and FalkorDB with explicit persistent volumes, health checks and host-local connectivity. Use actual compatible images/configuration; do not deploy Railway, Kubernetes, a public gateway or an application microservice fleet.

Choose a project/service naming scheme and configurable ports that avoid clobbering existing databases. Keep backend credentials outside committed files; commit a redacted example only where useful. Graph/SQL credentials belong to the backend, not the TUI or any future candidate container.

Coordinate with A on database names/users, readiness, graph client compatibility and migration ownership. Database process health does not establish that application schema/constraints are ready. Preserve data across ordinary stop/start; do not use volume deletion as normal restart.

### M01B02 — Observed compatibility and dependencies

Install the actual dependencies A needs through normal npm commands and keep one generated root lockfile. Add only currently used scripts/libraries; no ORM, general cloud provisioning, plugin framework or new frontend stack.

Select development Node/npm/client/image versions while using them and record observed values. The repository permits Node 22+ while the architecture previously targeted Node 24; do not claim Node 24 compatibility from an engine range or install unrelated runtime upgrades without need. Record the actual environment and any explicit compatibility decision.

Release digest freezing and polished doctor functionality belong later. M01 still needs reproducible stated image/configuration choices, not floating unspecified behavior or invented successful probes.

### M01B03 — Real init, admission and inspection from CLI

Extend the existing CLI with the smallest coherent init/admit/inspect interaction A's shared contract supports. Exact command spelling is agreed with A and documented; do not guess API paths from a target diagram.

Load/store the local Threadline application credential through a narrow module and A's agreed owner-protected mechanism. It is permissible to add scoped filesystem access for this local credential. This does not permit database/provider credentials, raw SQL access or domain authority in frontend code.

Authenticate requests without placing secrets in command arguments, URLs, logs or activity lines. Do not print raw bearer tokens into the TUI transcript. Never send arbitrary user/tenant/graph IDs as trusted principal identity.

Persist/retain the durable request ID for a retriable operation and bind it to the same accepted payload. Transport command IDs and durable idempotency keys are not interchangeable. A timeout or unknown result must not cause an automatic new request ID that silently duplicates admission.

Render pending, accepted, rejected and unknown explicitly. SQL receipt of input is not the same as graph acceptance. Show actual returned task/source/requirement/receipt identities and exact accepted criteria. Inspection/reconnection must read the backend, not reconstruct success from local state.

### M01B04 — Explicit authored fixture acceptance

Load the existing inventory-export-v1 manifest as versioned development data. Preview its accepted goal, initial freshness value 600, rule/criteria set and fixture/version identity. Obtain actual explicit user confirmation before submitting acceptance; elapsed time/default selection is not consent.

If manifest metadata is copied into a runtime fixture asset, retain version/digest/source and tests comparing intended acceptance fields; do not silently diverge. Reference implementation source archives must not become runtime dependencies. A configured development manifest path is different from importing an archived agent runtime.

Do not parse arbitrary prose into hidden acceptance tests. Do not implement the exporter, protected assertions, changed-requirement execution, held-out learning or a model to summarize the manifest. No later verification result may be claimed at admission.

### M01B05 — No provider credentials or inference

Keep provider credentials unset/unused for this stage. Setup/init/admission/health/inspection must work without an API key, subscription login or model selection that falsely implies a working provider.

Document/filter service configuration so database credentials are consumed only by the backend. Do not read another application's credential cache, load Codex/Claude tokens or expose database networks to future candidate execution merely because services exist in Compose.

### M01B06 — Plain connection and persistence UX

Keep the terminal simple: backend/store readiness, project/task status, accepted criteria, source/receipt text and a small action/input flow. No dashboard, graph editor, animations, theme framework or settings redesign.

Show real migration/store/configuration failures, retry guidance and pending versus accepted outcomes. Only enable persistent operations after A's readiness contract says they are available. Keep process lifecycle separate from storage readiness and task acceptance.

Closing/cancelling the TUI disconnects the view; it must not delete SQL/graph data or pretend a backend operation was undone. Clarify UI disconnect versus explicit service stop, and retain M00 shutdown/terminal cleanup behavior. Restart/reconnect loads the same stored project/task, rather than frontend cached fiction.

### M01B07 — Explicit local Compose or configured endpoints

Support a documented local-Compose route and backend-configured existing endpoints through one coherent configuration contract. Do not build a complex setup wizard yet.

If a required endpoint/schema/constraint/credential is unavailable or incompatible, show the real failure and refuse persistent admission. Do not silently switch to an in-memory graph, sample success or M00 development echo. Existing M00 behavior can remain explicitly development-only; it is not a persistence fallback.

Do not trigger destructive data-service lifecycle actions from a generic reconnect/retry button. Never run `docker compose down -v`, drop existing user graphs/databases or overwrite local credentials merely to make a test green.

## 4. Archive assistance when stuck

You are explicitly encouraged to consult `/Users/dkuriyal/Desktop/falkorDB-Hackathon/archive` for related implementation obstacles. Use targeted searches and preserve the current MVP boundary:

- `archive/plans`: authoritative current contracts, fixture, diagrams, schema and checklist.
- `archive/notes`: delivery/portability/auth research; historical options can be superseded.
- `archive/pi-main`: TypeScript CLI/TUI structure, event/lifecycle handling and practical interaction patterns.
- `archive/codex`: process/event/cancellation/history UX and protocol patterns; study only relevant files, not the entire Rust project.
- `archive/FalkorDB-main`: relevant server examples/configuration/client/constraint behavior in coordination with A.
- `archive/prime-agent-main`: optional general module/orchestration ideas; do not introduce its RLM or spawning machinery.

Use `rg --files --no-ignore <specific archive directory>` and targeted `rg -n --no-ignore '<topic/symbol>' <specific subtree>` when ignored reference directories are hidden. Confirm a reference's version/API/license and the current installed dependency before adapting it. Cite useful paths/symbols in the handoff.

Do not modify/build the reference projects, copy their secrets/transcripts, import archived implementations into the product, or reintroduce OAuth/native adapters/RLM/swarm scope. Use current primary documentation when archive behavior is ambiguous or version-dependent. Archive ideas inform a small implementation; they do not justify rewriting the agreed architecture.

## 5. Quality and verification

Use idiomatic strict TypeScript, small components, shared validated wire types and a transport client separate from rendering. Validate response payloads and error states rather than relying on blanket casts or an HTTP 200 alone. Keep buffers/reconnect attempts bounded; await actual stream readiness. Render backend truth with useful errors and no optimistic accepted/complete labels.

Add focused behavior tests at real seams, not UI snapshots that simply mirror implementation. Reuse existing test commands; do not introduce a new checker/CI/coverage project. A missing local store may be simulated in a unit test, but real durability/restart/migration claims need actual services.

Verify:

- Existing M00 build/tests and echo/TUI still work under the declared mode/configuration.
- Compose configuration resolves without exposing secrets; actual services and volume persistence work under a dedicated test project.
- CLI init/admit/inspect uses A's real backend and explicit manifest acceptance.
- A real session credential is required, stored safely and absent from activity/error output.
- Goal/criteria/source/receipt IDs inspected after backend restart match the original stored task.
- Same request ID/same payload returns the same receipt; conflicting reuse and unauthorized project/source access are visibly denied.
- Missing/misconfigured SQL/FalkorDB produces an honest blocked/error state with no fake memory fallback.
- TUI connection failure/retry/disconnect/exit and terminal restoration still behave correctly; shutdown/reconnect does not delete stored state.
- Record actual commands, versions and limitations. If Docker/network/access is blocked, finish independent coding and leave live-verification tasks unchecked instead of declaring them passed from mocks.

Mark only M01B01–B07 in your lane after their actual acceptance behavior is verified. Do not edit the master checklist concurrently; send completed IDs and evidence to A/integration owner. Do not mark M01J01–J05 on your own or mark a merge before it exists. Do not start M02 inference/provider/tool execution.

Deliver a handoff containing: recorded base, completed/unchecked IDs, changed paths/dependencies/configuration, actual command lines and observed results, API/auth/config agreement with A, versions/volumes used, archive references consulted, limitations/blockers, and whether the combined tree is ready for independent M01 integration. Finish actual assigned implementation and verification rather than only writing the handoff.
