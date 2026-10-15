# M01 launch prompt — Agent A: persistence and task authority

You are Agent A for Threadline. Implement your M01 lane in `/Users/dkuriyal/Desktop/falkorDB-Hackathon`. Agent B works concurrently in the same checkout on Compose, dependencies and the CLI/TUI. Complete real code and meaningful verification; do not stop after proposing an implementation.

## 1. Milestone and baseline

The user has merged M00 and its review resolutions. The checkout inspected when this prompt was written was clean `main`, merge commit `ed18168`, with implementation commit `13b17a2`. These hashes are observations, not instructions to reset to them. Read actual current status/history and preserve newer changes.

M01's outcome is: **an explicitly accepted human fixture goal is durably recorded in SQL, admitted through guarded FalkorDB authority, and readable through the CLI after restarting the backend.** This is task admission, not model execution or accepted code completion.

Do not create/switch branches, stage, commit, push, merge, reset, stash or discard work. Both agents develop one combined batch; the integration owner handles one branch/commit after both lanes and joint verification are ready. Do not spawn additional agents. Record the same base commit as B and disclose any pre-existing dirty files, including newly authored prompt documents.

Start by reading:

- `AGENTS.md`, `README.md`, and `CONTEXT.md`.
- `archive/plans/track2-implementation-checklist.md`: sections 1–4, M01 and its joint tasks; then your M01 block in `track2-agent-a-checklist.md`.
- `archive/plans/track2-development-blueprint.md` and `track2-first-vertical-slice.md` for current scope.
- `archive/plans/track2-data-model.md`, relevant storage evidence, and runtime protocol sections on command envelopes, human-command admission, authorization and epochs.
- `archive/plans/schema/postgresql-core-reference.sql`, both field dictionaries, graph model/query sketches and constraint readiness commands.
- `archive/plans/contracts/fixture-manifest.json` and the local-auth/reconciliation limits in `development-profile.json`.
- Current merged source and tests in `packages/shared`, backend composition/config/domain/API, and the client-facing contracts B consumes.

The four historical background files linked from README remain required reading before changing architecture/delivery guidance. They are background; they do not override current owned-harness scope.

Run the existing baseline build/tests once and share the actual result with B. Coordinate this short baseline window before B changes dependencies so the run is against a stable install. Preserve the merged start/stop synchronization, nested health validation, terminal readiness, nonfatal `onFrameError` distinction and first-stream-failure retention. If the merged baseline fails, identify the exact pre-existing failure; fix a narrow prerequisite when appropriate, but do not claim an unobserved green baseline or revert review resolutions.

## 2. File ownership and immediate coordination

You own:

- Shared protocol/schema/identifier/error definitions in `packages/shared/src`.
- Backend identity, task coordinator, SQL/graph storage, human command admission/reconciliation and migration/query code.
- Minimal backend routes/configuration/composition needed to connect those operations.
- Your lane checklist and master-checklist status reconciliation.

B owns root manifests, dependency installs/lockfile, Compose/setup files, `packages/cli`, and its lane checklist. Ask B to add necessary PostgreSQL/FalkorDB dependencies; do not race package edits or `npm install`. If B needs an API/composition change, coordinate one file editor rather than overlapping edits.

Your first implementation deliverable is a small compiling contract handoff to B. Agree and publish:

1. Local bootstrap/init, authenticated session handling and read/inspect operations.
2. Goal-admission command name/route, request-ID rules, explicit acceptance payload and accepted/pending/rejected/unknown outcomes.
3. Current project/task/requirement/source/receipt response shapes.
4. How the CLI obtains the local application credential safely; no token in a URL, log or activity event.
5. Persistence configuration/environment variable names, endpoint modes, readiness and migration startup order.
6. Whether a planned Run exists at admission and when a provider-bound execution Run is created.

Keep definitions in the shared package, validate real network input/output, and separate M00 transport `commandId` from a stable durable idempotency `request_id`. SQL UUID columns must receive valid UUID identities; do not insert branded `cmd_...` strings into them. Do not silently change existing routes to `/v1`; use actual merged routes or coordinate any intentional versioned change with B and regression tests.

## 3. Implement M01A01–M01A08

### M01A01 — Real storage adapters

Implement small adapters for `pg` and the chosen official FalkorDB JavaScript client. Use explicit dependency injection/lifecycle, parameterized operations, bounded connection/retry behavior, and clean startup/shutdown. No import-time connections, domain-to-Fastify dependency or pretend graph/SQL transaction.

Resolve tenant/project/graph keys through authenticated membership and trusted registration. A caller-supplied project ID is a requested target, never sufficient authority to choose a graph. Keep database credentials in backend configuration; safe errors must not echo connection URLs/passwords.

### M01A02 — Validated core bootstrap

Turn the 31-table FK-closed reference into one reviewed, versioned bootstrap migration and apply it to the actual chosen PostgreSQL service. Validate real syntax, dependency ordering, scope FKs, uniqueness and transaction behavior. Preserve two native/OAuth extension tables as deferred, not startup requirements.

Use checksum/version readiness to distinguish unapplied, applied and incompatible schema. A fresh bootstrap and an ordinary restart are different operations; startup must not rerun destructive CREATE/DROP logic. Do not create 31 repositories/services/screens or a generic migration framework before this flow works.

### M01A03 — Only the current workflow operations

Implement the smallest coherent operations for local tenant/user/membership, project, human session, original project message, durable command inbox and graph project/goal/constraint/task/criteria identities. Persist/read actual authoritative state; no frontend truth or in-memory substitute.

Resolve the existing schema seam explicitly before B implements admission: `runs.initial_profile_id` currently requires a provider profile, but M01 has no provider credentials or inference. Do not invent a working account/model or fake FK IDs. Separate task acceptance from provider-bound execution. If an M01 planned Run is retained, define an explicit FK-valid non-executing representation; make any necessary small schema/contract adjustment visible, documented and tested. Do not silently defer a checklist obligation or mark a nonexistent Run operation complete.

Do not launch an AgentSession, claim a Builder execution slot or populate provider usage as part of accepting a human goal. Those are M02 execution concerns.

### M01A04 — Local owner identity and application sessions

Implement OS-owner-protected bootstrap and a cryptographically random opaque application session token. Store its hash in SQL; deliver/store the raw secret only through the agreed owner-protected local mechanism. Check file/directory permissions and avoid unsafe symlink handling.

Authenticate protected operations and verify current tenant/project memberships. Implement token lookup, revocation and the profile's 12-hour idle/seven-day absolute expiry with a controllable clock; sliding idle expiry cannot extend absolute lifetime. Do not treat loopback reachability or a supplied user name as authentication.

No registration UI, remote OIDC, subscription OAuth, provider login or application password system. The CLI may hold its own local Threadline application credential; it must not receive database/provider credentials.

### M01A05 — Durable human command admission

Persist the original permitted goal/source and complete canonical human-command envelope atomically in PostgreSQL before graph admission. Preserve exact versus canonical payload/digest semantics deliberately. Include explicit authenticated fixture/criteria acceptance, not an agent-invented interpretation of arbitrary prose.

Model the SQL inbox's actual pending/leased/committed/rejected/quarantined states separately from client outcomes such as accepted or unknown. An SQL-persisted pending command is not graph-accepted authority.

Implement the minimal human-inbox reconciliation path needed after restart/lost acknowledgement now; do not wait until M03's generalized runtime capture outbox. Reuse stable identity, scope, epoch and digest. No offline-spool promise or distributed transaction.

### M01A06 — Graph readiness and atomic authority

Implement the actual required indexes/constraints and wait for verified readiness before admitting commands. Confirm chosen client/server syntax against the version in use. Sketches in the archive are inputs to review, not production-ready commands.

Use one guarded mutation for state/current pointers, project revision/event sequence, Event and RequestReceipt. Bind scope, epoch, request digest and authenticated actor. Zero rows is not successful acceptance. Preserve integer precision at SQL/graph/JSON boundaries.

On an uncertain graph write, resolve the original receipt before deciding whether replay is safe. If no outcome can be established, expose pending/unknown and block dependent admission; do not assume a timeout means rollback.

### M01A07 — Stable current governing versions

Create stable Goal/Constraint identities and immutable accepted versions with original source provenance, current pointers and the task's applicable bindings. Accept the manifest's initial requirement/criteria without implementing its exporter or protected checks.

Read current authority through stable IDs. Missing/duplicate current versions, epoch mismatch or unavailable required source must block a usable authority response. Do not implement M07's full requirement-change/handoff pipeline prematurely; preserve the schema seam for it.

### M01A08 — Exact idempotency and conflict behavior

Same authorized scope/epoch/request ID plus same canonical payload returns the original exact accepted receipt, not another state/event increment. Same identity plus different payload returns a typed mismatch with no mutation or source overwrite. Recheck authorization before returning a cached receipt.

Cover retry after SQL commit, after graph commit before SQL settlement, duplicate concurrent admission and backend restart. Persist/inspect sources and receipts so B can show the original evidence rather than local optimistic state.

## 4. Archive assistance when stuck

You are explicitly encouraged to consult `/Users/dkuriyal/Desktop/falkorDB-Hackathon/archive` whenever a related implementation detail blocks progress. Use targeted searches, not a wholesale archive scan or reimplementation.

- `archive/plans`: controlling checklist, schemas, architecture and review dispositions.
- `archive/notes`: historical storage/identity/coordination research; check dates and superseded assumptions.
- `archive/FalkorDB-main`: relevant graph/index/constraint/query/persistence source and examples when actual server behavior is unclear.
- `archive/codex`: relevant request identity, durable lifecycle, error and cancellation patterns; Rust source is design reference, not a reason to add Rust.
- `archive/pi-main`: small TypeScript module, event and lifecycle patterns.
- `archive/prime-agent-main`: optional general architecture inspiration; its recursive-model machinery is outside Threadline scope.

Use `rg --files --no-ignore <specific archive directory>` and targeted `rg -n --no-ignore '<symbol/topic>' <specific subtree>` when Git ignore rules hide reference code. Check the reference's version and meaning against the installed dependency/current primary documentation. Record useful file/symbol references and what was adapted. Do not copy credentials/transcripts, import archived reference implementations at runtime, modify those reference projects, bypass licensing review, or resurrect RLM/native/OAuth/swarm features to solve an M01 problem.

## 5. Quality, verification and completion

Use strict TypeScript, explicit runtime boundary validation, small operation-oriented repositories, deterministic typed errors and minimal dependencies. Avoid unjustified `any`, blanket casts, swallowed failures, unbounded retries, database logic in HTTP handlers and speculative abstractions. Keep secrets out of logs, SQL command payloads, graph state, SSE and exports.

Use focused deterministic unit tests for normalization, authorization/expiry and state decisions. Prove SQL/Cypher/migrations and idempotency with actual stores; mocks alone cannot close those tasks. Use separate synthetic test projects/databases/graph keys, not destructive resets of personal data. Do not run `docker compose down -v`, drop user databases/graphs or overwrite existing local credentials as routine setup.

Before completion:

- Run the existing workspace build/tests and preserve M00 echo/TUI behavior.
- Validate the core schema on real PostgreSQL and graph readiness on real FalkorDB.
- Prove SQL message/inbox precedes acceptance and exact receipt/current versions survive backend restart.
- Prove duplicate and conflicting request behavior, an unauthorized project/source denial, session expiry/revocation and at least one lost-ACK reconciliation.
- Report actual versions and commands. If Docker/network/credentials are unavailable, continue independent code, leave affected live-verification items unchecked and name the blocker; never mark them verified from source inspection.
- Keep only your own M01A01–A08 checkboxes eligible for lane completion. Update the master A items only from actual evidence. Do not check B items or joint items merely because code compiles.
- Coordinate with B for M01J01–J05. Master B status needs B's evidence plus combined integration; M01J05's merge portion remains pending until the integration owner actually completes it.
- Do not start M02 provider execution or make paid model calls.

Deliver a handoff containing: recorded base, completed/unchecked task IDs, owned paths, exact commands/results and store versions, shared exports/routes/auth/config, Run/profile seam decision, archive references consulted, schema changes, remaining blockers and whether the combined tree is ready for independent integration. Finish your assigned code and verification, not just this handoff format.
