# Agent A prompt: sourced semantic memory and task authority

Follow AGENTS.md and [the parallel work rulebook](../parallel-work-rulebook.md) in full. Read this assignment before editing. Use only its reserved worktree/branch, writable paths and resources. Complete this checkpoint, verify it, commit/push its feature branch and open one PR. Review fixes stay with that PR; the coordinator handles merge and retirement. The next milestone gets a fresh worktree.

## Assignment contract

- **ID/owner:** `a-n02b-semantic-01`, Agent A.
- **Outcome:** an authorized human can create a task, propose/accept sourced semantic memory, bind a requirement, inspect current authority and correct it under expected-version guards.
- **Checkpoint:** the complete semantic/task slice with observed acceptance below. This is part of N02B; episodes, procedures, bounded context and native integration are later assignments.
- **Baseline:** freshly fetched `origin/main` after this rulebook/assignment PR is merged. Record the resolved full SHA in the result record before editing. Never start from the old M05 or pre-review memory-foundation commit.
- **Branch:** `threadline/a-n02b-semantic-01`.
- **Worktree:** `/tmp/threadline-a-n02b-semantic-01`.
- **PR:** feature branch → `main` in this repository's `origin`; one PR for this assignment.
- **Authority:** implementation, isolated synthetic verification, commit/push of this feature branch and PR creation. No merge, main push, release, shared-data reset, native configuration changes or inference.

The coordinator reserves this branch/path and delegates their creation to you if absent. Verify unused names, clean correct starting state and the rulebook on the fetched baseline. Create from its full SHA, verify branch/path/HEAD, then work exclusively there. If an existing branch/path is found, report it rather than recycling it. Do not edit the original checkout.

## Read and preserve

Read README.md, CONTEXT.md, docs/development-checklist.md and relevant backend/shared code. The current source contains the reviewed N00–N02A foundation and additive SQL migrations through version 3; inspect actual versions before extending it.

Completed behavior includes durable Sources/history, restricted-role/RLS checks, explicit privileged-function ownership checks, source-anchor admission, leased graph operations/receipts, reconnect/reconciliation and honest readiness. Preserve the review fixes: decimal-string counters, private-parent visibility, valid lifecycle states, narrow claim results and authenticated detailed status.

Optional original local references are under `/Users/dkuriyal/Desktop/falkorDB-Hackathon/docs/plans/`. They are ignored/read-only. Do not depend on ignored evidence as the sole review record.

## Writable paths and frozen boundaries

You own:

- `packages/backend/src/**`
- `packages/shared/src/**`
- `README.md`, `CONTEXT.md`, `docs/local-development.md`, only for actual behavior/domain changes in this checkpoint
- This assignment file's result/status record

Everything else is read-only. In particular, keep `packages/cli/**`, `assets/codex/**`, Agent B's document, `docs/development-checklist.md`, the rulebook, manifests, lockfiles, build/Compose configuration and `.gitignore` unchanged.

Use existing dependencies. Send the coordinator the smallest requested frozen-file change if necessary. Do not build CLI commands or a native adapter to exercise this slice. Use authorized HTTP/core interfaces and temporary verification outside the repository.

Agent B has no database/backend work and will not consume your evolving interface. Do not wait for B or merge/cherry-pick its branch.

## Isolated runtime allocation

- HTTP port: `47831`.
- Data/config root: `/tmp/threadline-a-n02b-semantic-data-01`.
- Verification PostgreSQL host port: `55441`.
- Verification FalkorDB host port: `56441`.
- New container/volume names must begin `threadline-a-n02b-semantic-01-` and have assignment ownership recorded.

Use newly created assignment-owned verification containers/volumes with the qualified image versions/digests from the existing development setup, generated temporary test credentials and synthetic data. Check name/port availability first. This contract permits this isolated setup; it does not permit changing the existing database, baseline service on 47822, shared containers/volumes, existing credentials or native state.

Apply additive migrations only to the isolated verification database for this task. Preserve applied migration checksums. Root Compose files stay unchanged. If an isolated prerequisite is unavailable, continue independent source work and report verification blocked; do not substitute a shared live store or claim acceptance.

Keep credentials owner-only under the assigned root and out of output/Git. Report created resources for coordinator retirement. Do not remove another assignment's resources.

## Implementation sequence

### A1. Agree the actual neutral interfaces in source

Inspect existing shared semantic-memory, task, operation and source contracts. Keep one definition per contract. Narrow/refine actual defects while preserving existing source/history interfaces. Document semantic-only support accurately so a generic capability does not imply working episode/procedure/handoff services.

### A2. Extend the existing operation path

Implement typed semantic/task admission through the current operations ledger and worker. Add a new migration for claim-function/kind changes; versions 1–3 are already applied in the baseline and remain immutable. Keep operation names consistent.

Use the existing lease/reconcile/commit/settle protocol. Content-bearing intent must be source-backed. Handle dependencies on pending source anchors or proposals explicitly; temporary pending dependencies are not false permanent invalidity. Ambiguous delivery retains its original identity.

### A3. Implement the vertical slice

Provide:

1. Task create and bounded task inspection.
2. Source-backed semantic proposals, including proposed versions of existing memory.
3. Explicit human acceptance with expected current version.
4. Task requirement binding to a stable Memory identity with expected task revision.
5. Current-memory and current-task-requirement reads.
6. Human correction creating a new version and superseding the governing head.
7. Source/version provenance and inspectable operation receipts.

Keep one canonical CURRENT edge. Caller input cannot assign human authority, accepted state, actor identity or arbitrary routing. Reject foreign/private/unavailable evidence. Preserve observed-under conditions separately from applicability. Record declared contradictions where the accepted contract requires them; do not infer resolution from recency or repetition.

Use bounded parameterized graph templates and RO_QUERY for reads. Preserve exact counters across SQL/Node/Cypher; opaque memory/task version tokens are equality guards. Events/receipts remain content-free metadata.

Expose proper capability/error states and authorized human inspection. Native enrollment is not required to exercise a human memory workflow; never insert fabricated native sessions or weaken authorization to get a check through.

## Acceptance criteria

Verify against the real isolated SQL/files/FalkorDB:

- Task → authored Source → proposal → human acceptance → requirement binding → current read works.
- Correct freshness from 600 to 60 seconds. The current head changes; the original Source/version remains intact.
- Proposals do not govern before acceptance, and a producer cannot grant itself human authority.
- Two acceptance/correction operations at the same expected head yield one winner and an explicit conflict.
- Exact retry has one logical effect/receipt; changed payload under the same identity refuses.
- Pending/ambiguous operations are distinguishable from committed memory; restart preserves current authority.
- Foreign scope and unreadable/private/missing evidence are refused without revealing content or inaccessible source identities.
- Inherited counter-precision/reconciliation behavior is preserved.
- Other memory kinds/context/native/handoff capabilities remain explicitly unavailable unless already independently implemented on the baseline.

Use two isolated identities/credentials for service-level authorization checks where feasible through the actual supported path. Never present constructed-scope checks as HTTP credential proof; record the outstanding gap if no safe credential path exists.

Run `npm run build`, diff/ownership checks and authorized focused temporary/manual checks. Do not create a permanent package test suite. Keep expected fixture outputs separate from actual evidence.

## Completion and PR

Stop feature implementation at this checkpoint. Do not continue into N02C, procedures or native integration in this worktree. Complete the rulebook's commit/push/PR gates and open the PR. Use draft status if acceptance is incomplete.

Update your result record and PR with actual endpoint/input/output examples, new operation/migration names, verification outcomes, compatibility limits and remaining checklist task IDs. The coordinator updates the shared checklist after integration; you must not mark it independently.

## Result record — filled by Agent A for a-n02b-semantic-01

- **Status:** COMPLETE. The semantic/task vertical slice is implemented, verified against isolated PostgreSQL/FalkorDB and documented. Episodes, procedures, bounded context, coordination and native integration were not started and stay explicitly unavailable in capability output.

### Base ref/full SHA

- Branch point: `origin/main` at `38435dfa3273be21cf75525dc23b6a8b7973ba01` (fetched; the worktree was verified clean at that commit before editing).
- Feature branch `threadline/a-n02b-semantic-01`, worktree `/tmp/threadline-a-n02b-semantic-01` (canonical `/private/tmp/threadline-a-n02b-semantic-01`). The original checkout was not edited.

### Verification resources and processes created

Assignment-owned, all outside the repository:

- Containers: `threadline-a-n02b-semantic-01-postgres` (`postgres:18-alpine`, host port `55441`) and `threadline-a-n02b-semantic-01-falkordb` (`falkordb/falkordb:6.0.2`, host port `56441`, append-only with `appendfsync always`).
- Volumes: `threadline-a-n02b-semantic-01-pg-data`, `threadline-a-n02b-semantic-01-falkordb-data`.
- Config/data root `/tmp/threadline-a-n02b-semantic-data-01` (mode `0700`) holding `home/` (`THREADLINE_HOME`), `logs/`, `checks/` and two bound workspace roots. Generated throwaway database passwords live in `env.sh`/`secrets.json` and the local owner token in `credential.json`, all mode `0600`; none were printed, logged into the repository, or copied elsewhere.
- Service: `threadline serve` on `127.0.0.1:47831`, using the built workspace output.
- Credentials exercised over real HTTP: the generated local owner credential (`human_admin`), a `producer` credential with a `member` grant, and a second `producer` credential with a `reader` grant.
- Temporary check scripts (outside the repository): `/tmp/threadline-a-n02b-semantic-01-checks/` — `bootstrap.sh`, `fixtures.sh`, `ids.sh`, `verify.sh`, `slice.mjs`, `phase2.mjs`, `phase3.mjs`, `phase4.mjs`, `graphq.cjs`.
- Untouched: the baseline service on `47822`, the `threadline-local-*` containers and volumes, all pre-existing assignment containers, shared stores and native state.

### Implemented behavior and changed paths

New operation kinds in the existing ledger: `memory.propose`, `memory.accept`, `memory.correct`, `task.create`, `task.require`. New **migration 4 `memory_task_operation_identities`** (additive: `intent_memory_id`, `intent_version_id`, `intent_task_id` columns with partial indexes, plus a re-created `claim_operations` that also returns `expected_head_token` and `expected_task_revision`; migrations 1–3 untouched, checksums preserved).

Routes now served:

```text
POST /v2/tasks
GET  /v2/tasks/:taskId
POST /v2/tasks/:taskId/requirements
GET  /v2/tasks/:taskId/requirements
POST /v2/memories/proposals
POST /v2/memories/:memoryId/acceptance
POST /v2/memories/:memoryId/corrections
GET  /v2/memories/:memoryId
GET  /v2/memories
```

Behavior:

1. **Task create and bounded view.** A task stores title, optional family, `open` state and an opaque random revision; the view lists its required memory identities.
2. **Source-backed proposals.** A proposal's content is captured as one canonical intent document (`MEMORY_DOCUMENT_VERSION = 1`, codec in `packages/shared/src/memory.ts`), published as immutable bytes, catalogued as a `memory_proposal` Source, anchored by its own `source.append` operation, and referenced by the memory operation instead of restating content. The worker re-derives the request digest from durable facts plus the document and refuses `intent_integrity_mismatch` on mismatch. Candidates are capped at 8 per memory and evidence closure is bounded.
3. **Explicit human acceptance.** Acceptance requires a server-resolved `principalKind === 'human'` and `tokenKind === 'human_admin'`; request input cannot grant authority. The commit moves the single `CURRENT` edge, records the accepting principal and marks the previous version `superseded`.
4. **Requirement binding.** `task.require` binds a memory identity under an expected task revision; the guarded commit refuses `task_revision_conflict` or `requirement_already_bound`. Reads resolve each requirement to its exact current version, or report `missing_current` / `duplicate_current`.
5. **Current reads.** The memory view and list resolve current versions under a root/epoch/privacy guard with one bounded consistency retry. Two current versions for one memory fail closed: `authority_conflict` from the memory view and project list, `duplicate_current` in the requirement view while other requirements still resolve.
6. **Human correction.** A correction creates a new accepted version that supersedes the named head (`SUPERSEDES`, `supersedes_version_id`, previous version `superseded_by_version_id`). The earlier version, its acceptance record and its `SOURCED_FROM` evidence stay intact.
7. **Evidence, receipts and idempotency.** Every cited source must be visible in project scope and available; foreign, private and unknown sources produce one indistinguishable `not_found`, while a visible source whose bytes are unavailable reports `source_unavailable`. Admission is one SQL transaction under the project write lock; the leased worker commits each guarded mutation with its Event and receipt in a single statement and reconciles an existing receipt before any graph precheck.

Changed paths, all inside the writable set: `packages/shared/src/memory.ts`, `packages/shared/src/index.ts`, `packages/backend/src/storage/schema.ts`, `packages/backend/src/storage/memoryGraph.ts`, `packages/backend/src/service/operations.ts`, `packages/backend/src/service/memory.ts` (new), `packages/backend/src/service/tasks.ts` (new), `packages/backend/src/service/semanticSupport.ts` (new), `packages/backend/src/api/server.ts`, `packages/backend/src/capabilities.ts`, `packages/backend/src/index.ts`, `README.md`, `CONTEXT.md`, `docs/local-development.md`, and this record.

### Observed request and response examples

Identifiers are from the final verification run: project `572334d4-370c-4810-90e0-c44bfc840d72`, task `882f0c85-4dd5-4752-b9c0-c10905b3c62f`, memory `c9f86e55-8eff-4fc4-a4ff-3cc5bb7fd629`, evidence `54f33569-…` and `fed9223c-…`.

```text
POST /v2/memories/proposals          (producer credential)
{"projectId":"572334d4-370c-4810-90e0-c44bfc840d72","taskId":"882f0c85-4dd5-4752-b9c0-c10905b3c62f",
 "content":{"kind":"semantic","subtype":"requirement","statement":"The deployment rollout window is 600 seconds."},
 "applicability":{"predicates":[]},
 "observedUnder":{"taskFamily":null,"contractVersion":null,"runtime":null,"tool":null,"paths":[],"parameters":{}},
 "sourceIds":["54f33569-3470-43e8-b63d-326e266fee19"],"idempotencyKey":"k-prop-1"}
```

```json
{"ok":true,"data":{"operationId":"ba433223-a17d-45fb-95f2-4aa6adc4bb43","state":"committed",
 "memoryId":"c9f86e55-8eff-4fc4-a4ff-3cc5bb7fd629","versionId":"c39356c2-e9f4-4ff6-a943-a3e63f7d2c24",
 "committedAtMs":1792261328296,"errorCode":null,"errorDetail":null}}
```

```text
POST /v2/memories/c9f86e55-8eff-4fc4-a4ff-3cc5bb7fd629/acceptance     (human credential)
{"projectId":"…","memoryId":"c9f86e55-…","versionId":"c39356c2-…","expectedCurrentVersionId":null,
 "reason":"Approved as current requirement","idempotencyKey":"k-acc-1"}
→ {"ok":true,"data":{"operationId":"0810ed4d-276c-4278-9225-75f8c55c6b27","state":"committed",
   "memoryId":"c9f86e55-…","versionId":"c39356c2-…","committedAtMs":1792261329060,"errorCode":null,"errorDetail":null}}

POST /v2/memories/c9f86e55-8eff-4fc4-a4ff-3cc5bb7fd629/corrections    (human credential)
{"projectId":"…","memoryId":"c9f86e55-…","expectedCurrentVersionId":"c39356c2-…",
 "content":{"kind":"semantic","subtype":"requirement","statement":"The deployment rollout window is 60 seconds."},
 "applicability":{"predicates":[]},"observedUnder":{…},"sourceIds":["fed9223c-8dcd-48e2-94d9-ab7f1a4dc17f"],
 "reason":"Shortened window approved","idempotencyKey":"k-corr-1"}
→ {"ok":true,"data":{"operationId":"94f262e8-95d2-45fb-b674-ecb642f8d179","state":"committed",
   "memoryId":"c9f86e55-…","versionId":"f276b27d-0f77-4d5a-96b9-f1f24b7c66bb","committedAtMs":1792261329606,…}}
```

After the correction, `GET /v2/memories/c9f86e55-…` reports `current.versionId = f276b27d-…` (60 seconds, `acceptance: accepted`, `acceptedByPrincipalId` set to the acting human principal, `sourceIds: [fed9223c-…]`, `supersedesVersionId: c39356c2-…`) and `candidates: []`. `GET /v2/tasks/882f0c85-…/requirements` resolves that same version for the bound requirement. The acceptance operation reports `{"graphEpoch":"…","eventSeq":"9","outcome":"committed"}` with decimal-string counters.

### Exact verification and results

`npm run build` passes (`tsc -b`, no errors). One focused temporary suite ran against the isolated stack on the final build: **96 checks, 96 passed, 0 failed**, transcript at `/tmp/threadline-a-n02b-semantic-data-01/logs/verification.txt` (sha256 `985c325f313e7f60e8fa386d45a95049ef63f3d82398c2e86a7ae83cc97d9248`).

1. **Vertical slice — 44 checks.** Task create → authored source → producer proposal → human acceptance → requirement binding → current reads → correction. The unaccepted proposal leaves the requirement `missing_current`; a producer credential and a reader-grant credential are both refused `scope_denied` at acceptance; after acceptance the requirement resolves the accepted version; the correction moves current authority to the 60-second version while preserving the superseded 600-second version and citing the new source; task-scoped, focused and project memory queries return the expected sets; capabilities report the six new operations as supported and keep `memory.episode.record` unavailable.
2. **Idempotency — 9 checks.** Exact retries of `task.create`, `memory.propose`, `memory.accept` and `memory.correct` return the first admission with identical operation, memory and version ids; the same key with a changed payload is refused `idempotency_mismatch` (HTTP 409). Replaying a producer key with the human credential was also refused (409) when re-checked after the suite.
3. **Concurrency — 2 checks.** Two `task.require` operations submitted against the same expected task revision: one committed, the loser rejected with `task_revision_conflict`.
4. **Evidence — 4 checks.** Foreign-project, unknown and principal-private sources produce identical `not_found` refusals; a project-visible source marked unavailable returns `source_unavailable` (HTTP 410); no source identity or content appears in any refusal.
5. **Graph preservation — 6 checks.** Direct graph reads confirm the superseded version still records `acceptance: superseded` and `superseded_by_version_id`, the correction records `supersedes_version_id`, exactly one `SUPERSEDES` edge and one `CURRENT` edge exist, every version keeps its own `SOURCED_FROM` anchor (three links after the 600→60 correction), and receipts exist for committed operations.
6. **Explicit refusals — 6 checks.** Accepting a superseded version (`version_not_proposed`), accepting the current version (`version_already_current`), a stale expected head (`expected_head_conflict`), re-binding an already-bound memory (`task_revision_conflict`/`requirement_already_bound`), a cross-project request with a project-bound credential (403/404) and a foreign memory read (404).
7. **Replay — 4 checks.** Resetting a committed acceptance to `pending` in SQL makes the worker reconcile the existing receipt: the operation settles `committed` with the original `eventSeq`, attempts increments, and the graph `event_head`, node count and edge count are unchanged — one logical effect, no second event.
8. **Restart durability — 6 checks.** After a PostgreSQL container restart the service reconnects, the owner credential still authenticates, `durableMemory` returns to `true`, and new proposal and acceptance commits succeed.
9. **Ambiguity — 7 checks.** After a second `CURRENT` edge is written directly into the isolated graph, the memory view and project list refuse with `authority_conflict`, while the requirement view reports `duplicate_current` for that memory and still resolves the others.
10. **Undeliverable work — 12 checks.** With FalkorDB stopped, memory reads fail closed with `storage_unavailable`, the falkordb component reports not ready, `durableMemory` is `false`, and an admitted proposal stays `pending` (status shows pending work and zero ambiguous). Once that proposal's evidence is marked unavailable and the graph returns, the waiting delivery refuses `source_unavailable`, no version node exists for it, previously accepted memory is still current, and `durableMemory` returns to `true`.

11. **Review fixes (10 checks).** Three review findings on the PR were reproduced, fixed and re-verified: repeated admissions of one content-bearing key store exactly one document object; intents naming an identity that nothing can create settle `rejected` instead of waiting on each other; and acceptance that replaces a head records the `SUPERSEDES` edge. Details below.

### Review findings addressed

1. **Stranded document bytes on retry.** `admitDocumentIntent` published the canonical document before checking the idempotency key. Because the document embeds an allocated memory and version id, every attempt hashed to a different digest, so each retry or mismatch refusal wrote a new unreferenced object that nothing reclaims. Admission now looks the key up under the project write lock before publishing and returns the classified existing record; the in-transaction lookup remains as the race guard. Verified: five admissions of one key (four retries plus a mismatch refusal) grow the source root by exactly one object.
2. **Mutual dependency waits (reproduced before fixing).** The memory-existence wait counted every pending intent naming that memory, including attach proposals, acceptances, corrections and other tasks' requirement bindings — none of which can create a `Memory` node. Against the isolated service, two requirement bindings plus two attach proposals naming an identity that can never exist stayed `pending` with `dependency_pending`, six attempts after 90 seconds, and never reached `rejected`, because each waited on the other and `claim_operations` has no attempt ceiling. The wait predicates are now `createsMemory`, `createsVersion` and `createsTask`: an intent waits only on one whose own commit creates the missing identity. The reviewer's narrower suggestion covered the memory branch only; the version-existence wait in `prepareMemoryAccept` needed the same treatment, because an acceptance can never create a version. Verified: all six probes now settle `rejected` (`memory_not_available` / `version_not_available`) and the backlog returns to zero pending.
3. **Missing supersession edge on acceptance.** `COMMIT_MEMORY_ACCEPT` marked the replaced head superseded and set `supersedes_version_id` but created no `SUPERSEDES` edge, while `COMMIT_MEMORY_CORRECT` did; a traversal would then miss accept-driven supersessions. The acceptance commit now creates the edge in the same statement, verified by direct graph reads after replacing a head by acceptance.

Limitations and gaps, stated plainly:

- No permanent test suite was added, by instruction. The scripts live outside the repository, so a later batch that changes these paths must reproduce equivalent checks.
- The `ambiguous` state itself was never forced. It requires losing a response after a graph commit; the equivalent path was verified by replaying a committed operation and observing receipt reconciliation. No naturally occurring `ambiguous` operation is claimed.
- The two-current-version state was created by a direct graph write in the isolated database, not through the service. The service is proven to fail closed on it; it is not proven to be the only way such a state can arise.
- There is still no attempt ceiling: an intent that waits on a genuinely pending dependency waits indefinitely by design, because a pending source anchor or in-flight proposal is a real wait rather than an error. The mutual-wait cycle that made waiting hopeless is fixed; a future batch may still want a bounded wait with a terminal refusal.
- The candidate cap (8) and requirement cap (16) are enforced but were not exercised at their limits.
- Producer and reader credentials were inserted with SQL because this build has no supported command for issuing non-owner grants. Authorization was still exercised over real HTTP with real bearer tokens, never with constructed scopes.
- Contention was exercised with two concurrent operations on one project; the 8-candidate cap and larger writer counts were not measured at their limits.
- N02C work — episodes, procedures, context preparation, coordination claims, native enrollment and capture, deletion and export — was deliberately not started.

### Proposed checklist updates (coordinator applies after integration)

- Record this PR as the implementation of the N02B semantic-memory and task slice: task create and requirement binding, source-backed proposals, explicit human acceptance, corrections, current-memory and current-requirement reads, migration 4 and the semantic-only capability entries.
- Keep open: `memory.episode.record`, reusable procedures, `context.prepare`, `context.occurrence`, `claim.status`, `session.register`, `job.import`, native enrollment/capture, deletion and export jobs.
- Note for later batches: the intent-document codec (`packages/shared/src/memory.ts`) and `memoryRequestDigest` (`packages/backend/src/service/semanticSupport.ts`) are the single definitions that admission and the delivery worker must keep sharing; both refuse to include identities this service allocates, which is what makes an exact retry one logical effect.

### Final commit, remote confirmation and PR

- The branch carries a single squashed commit for this assignment, "Add sourced semantic memory and task coordination", containing the implementation, the three review fixes and this record. Its SHA is recorded in the PR body rather than here, because amending the branch to add the fixes invalidates any SHA written into the record itself.
- The branch was force-pushed with `--force-with-lease` at the owner's instruction to fold those fixes in; nothing was pushed to `main` and nothing was merged.
- One PR from `threadline/a-n02b-semantic-01` to `main` is raised by the repository owner: this machine has no GitHub CLI or token, so the agent pushed the branch and handed the PR over rather than creating it. The PR URL is added here by the owner.

### Integration requirements and retirement handoff

- Merge serially on `main`. This PR touches only `packages/backend/src/**`, `packages/shared/src/**`, `README.md`, `CONTEXT.md`, `docs/local-development.md` and this record, so no frozen-file change is required.
- The coordinator owns `docs/development-checklist.md` and the merge.
- Retire when idle: containers `threadline-a-n02b-semantic-01-postgres` and `threadline-a-n02b-semantic-01-falkordb`, volumes `threadline-a-n02b-semantic-01-pg-data` and `threadline-a-n02b-semantic-01-falkordb-data`, directories `/tmp/threadline-a-n02b-semantic-data-01` and `/tmp/threadline-a-n02b-semantic-01-checks`, and worktree `/tmp/threadline-a-n02b-semantic-01`. Removing the data root also destroys the generated credentials. No resource outside those names is assignment-owned.
