# Agent A prompt: episodes and procedural memory

Follow AGENTS.md and [the parallel work rulebook](../parallel-work-rulebook.md) in full. Read this assignment before editing. Use only its reserved worktree/branch, writable paths and resources. Complete this checkpoint, verify it, commit/push its feature branch and open one PR. Review fixes stay with that PR; the coordinator handles merge and retirement. The next milestone gets a fresh worktree.

## Assignment contract

- **ID/owner:** `a-n02b-evidence-02`, Agent A.
- **Outcome:** source-backed episodic and procedural memory with honest evidence classification, immutable versions, provenance, authorization, guarded writes and operation receipts.
- **Checkpoint:** episode admission plus procedural candidates and human review. Bounded context, coordination claims, handoffs, native enrollment/capture, retention, erasure and package publication are explicitly out of scope. Validated procedural reuse stays an N04 gate and is **not** delivered here.
- **Baseline:** `f1b168f65fd5e0e44f3f78e290ed68e3038a3490` — fetched `origin/main` after PR #9 (`ff9787c`, Codex qualification) and PR #10 (`f1b168f`, sourced semantic memory and tasks) merged. Created from that literal SHA, not from the previous feature branch.
- **Branch:** `threadline/a-n02b-evidence-02`.
- **Worktree:** `/tmp/threadline-a-n02b-evidence-02` (canonical `/private/tmp/threadline-a-n02b-evidence-02`).
- **PR:** feature branch → `main` in `origin` (`git@github-personal:kuriyaldivyanshu/falkorDB-Hackathon.git`); one PR for this assignment.
- **Authority:** implementation, isolated synthetic verification, commit/push of this feature branch and PR creation. No merge, main push, release, shared-data reset, native configuration change or inference.

### Dependency status

Merged and required: N00 source cut, N01 storage foundation, N02A graph delivery and reconciliation, and the N02B semantic-memory/task slice from `a-n02b-semantic-01` (PR #10). Nothing from Agent B's branch is required or consumed; its CLI work targets the already-merged semantic/task APIs. Integration is allowed as soon as this checkpoint's gates pass, since it changes only its own allowed paths.

## Retirement of `a-n02b-semantic-01` (delegated rt operator)

The coordinator delegated retirement of these exact previous-assignment resources after the rulebook gates passed. All gates were re-verified first.

Pre-deletion evidence: `git merge-base --is-ancestor ac3ca865271cd59258b04977de46f26356847a2e origin/main` succeeded; the GitHub API reports PR #10 `state: closed`, `merged: true`, `merge_commit_sha: f1b168f65fd5e0e44f3f78e290ed68e3038a3490`. The old worktree was clean at `ac3ca86` with no local-only commits and no untracked files; its only ignored content was `node_modules`, `packages/*/dist` and two `tsconfig.tsbuildinfo` files.

The old service was re-identified by port, command, working directory and data root rather than a remembered pid: `node packages/cli/dist/index.js serve`, listening on `127.0.0.1:47831`, cwd `/private/tmp/threadline-a-n02b-semantic-01`, `THREADLINE_HOME=/tmp/threadline-a-n02b-semantic-data-01/home`. It was stopped with `SIGTERM` and logged `Memory service stopped.`

Before stopping them, both containers were inspected: `threadline-a-n02b-semantic-01-postgres` (`postgres:18-alpine`, `127.0.0.1:55441`, mount `threadline-a-n02b-semantic-01-pg-data`) and `threadline-a-n02b-semantic-01-falkordb` (`falkordb/falkordb:6.0.2`, `127.0.0.1:56441`, mount `threadline-a-n02b-semantic-01-falkordb-data`) were stopped with `docker stop` and removed, then only `threadline-a-n02b-semantic-01-pg-data` and `threadline-a-n02b-semantic-01-falkordb-data` were removed. No prune was run and no unlisted container or volume was touched.

Useful verification material was preserved before disposal: the twelve check scripts and the 128-line `verification.txt` transcript (sha256 `985c325f313e7f60e8fa386d45a95049ef63f3d82398c2e86a7ae83cc97d9248`, matching the digest in the previous record) were copied to `/tmp/threadline-a-n02b-evidence-02-checks/carried-over/a-n02b-semantic-01/` with a `SHA256SUMS.txt` manifest. The transcript was scanned for credentials first and contains none. Removing the data root destroyed its generated throwaway passwords, `secrets.json`, `credential.json` and the temporary `tokens.env`/`credentials.sql`; nothing was copied out of it.

`git worktree remove /private/tmp/threadline-a-n02b-semantic-01` then succeeded without `--force`. Historical branches were deliberately retained: local `threadline/a-n02b-semantic-01` still exists and `refs/heads/threadline/a-n02b-semantic-01` remains on the remote at `ac3ca86`.

## Writable paths and frozen boundaries

Writable:

- `packages/backend/src/**`
- `packages/shared/src/**`
- `CONTEXT.md`, only for actual domain changes
- `docs/memory-kinds.md`, a new implementation/usage document
- this assignment record

Read-only. In particular keep unchanged: `packages/cli/**`, `assets/codex/**`, `README.md`, `docs/local-development.md`, `docs/native-integration-contract.md`, `docs/development-checklist.md`, `docs/parallel-work-rulebook.md`, root manifests, the lockfile, build/Compose configuration, `.gitignore` and `fixtures/`.

Use existing dependencies. The smallest required frozen-file change is reported instead of silently expanding scope. Do not build CLI commands or a native adapter to exercise this slice; verification uses the authorized HTTP/core interfaces and temporary scripts outside the repository.

Agent B implements CLI/MCP access against the already-merged semantic/task APIs. Do not depend on its branch, do not ask it to exercise these interfaces, and do not merge or cherry-pick unpublished peer changes.

## Isolated runtime allocation

- HTTP: `127.0.0.1:47832`
- PostgreSQL host port: `127.0.0.1:55442`
- FalkorDB host port: `127.0.0.1:56442`
- Data/config root: `/tmp/threadline-a-n02b-evidence-data-02`
- Temporary checks: `/tmp/threadline-a-n02b-evidence-02-checks`
- Container/volume prefix: `threadline-a-n02b-evidence-02-`

Fresh assignment-owned stores and credentials only. The previous database, credentials and native state are not reused. Qualified image versions/digests are recorded in the result. Root Compose configuration stays unchanged. Apply additive migrations only to this isolated database; migrations 1–4 and their checksums are preserved.

Credentials live owner-only under the assigned root and never enter output, logs or Git. Report created resources for coordinator retirement.

## Implementation sequence

1. **Inspect the merged implementation.** Preserve the shared intent-document codec and request-digest definitions; do not create a second admission/worker definition of the same content. Preserve the prior review fixes: same-base writes fail closed on duplicate current authority; dependency waits target only operations that can create the missing identity; accept-driven supersession retains `SUPERSEDES`; request digests exclude server-allocated identities; RLS, source visibility and exact decimal-string counters stay intact.
2. **Episodic memory.** Implement the existing episode operation through the current durable operation ledger, worker, source-backed intent and graph receipt machinery. An episode records the attempted action, the observed/reported outcome, observation and uncertainty, supporting Source closure, `observed_under`, independently declared applicability, and author/evidence precision. Enforce evidence classification: an authored assertion stays authored evidence; a caller-supplied outcome or Source kind never proves native execution; deterministic observed admission requires a supported, validated evidence path plus server-owned eligibility checks; unsupported evidence is explicitly refused or handled through a clearly human-reviewed authored path; unknown, denied, interrupted and failed outcomes remain distinct; exit status alone never establishes root cause or the success of a wider task. No native capture, transcript parsing, model extraction or provider execution loop.
3. **Procedural memory.** Source-backed proposals with goal, bounded ordered steps, prerequisites, parameters, supporting evidence, applicability, explicit state and review provenance. Human acceptance, corrections and reads integrate through the existing version/authority machinery. A human-accepted candidate is not automatically validated reuse: callers cannot self-assign validated state, a `reviewRef` string alone grants nothing, unsupported trial/validation transitions refuse explicitly, supporting observations retain their actual outcomes and conditions, corrections preserve old steps, evidence and supersession history, kind-changing corrections cannot corrupt an existing Memory identity, and requirements stay bound only to suitable obligation identities. If supporting reuse references need a neutral contract extension, define it once in shared source and persist/validate it through the worker. Do not build a general workflow engine or implement N04 claims/handoffs.
4. **Reads, capabilities and documentation.** Extend bounded memory reads to the new kinds. Preserve source availability/visibility rechecks, tenant/project scope, graph epoch/privacy guards and single-current-authority behavior. Update capabilities precisely: this checkpoint does not enable context, handoffs, native enrollment or validated reuse. Document operations, examples, evidence precision, state transitions, limits and remaining gates in `docs/memory-kinds.md`.
5. **Checklist.** The coordinator owns `docs/development-checklist.md`. Proposed updates are supplied in this record and that file is not edited.

## Acceptance criteria

Verify against the real isolated SQL/files/FalkorDB:

- A sourced episode can be admitted and inspected with honest evidence precision.
- Unknown, denied and interrupted outcomes are preserved as distinct.
- Unsupported "observed" claims cannot gain stronger authority.
- A procedural candidate can be proposed, human-reviewed/accepted and inspected.
- Arbitrary validated state or a bare `reviewRef` cannot bypass validation.
- A correction preserves prior versions and provenance.
- An exact retry has one effect; a changed payload under the same identity refuses.
- Same-base competing updates have one winner and an explicit conflict.
- Missing, foreign, private or unavailable evidence cannot support released memory.
- Pending prerequisites recover; rejected prerequisites do not produce hopeless mutual waits.
- Restart and graph outage/recovery preserve intents and receipts.
- The merged semantic/task workflow still functions.
- Relevant candidate/step/evidence bounds are exercised, including at least one limit/refusal boundary.

Run `npm run build` plus focused temporary/manual checks outside the repository. No permanent package test suite. Report exact commands, observed outcomes and unverified paths; do not claim forced ambiguous delivery unless it actually occurred.

## Completion and PR

Stop feature implementation at this checkpoint. Do not begin N02C, coordination, native integration, retention or erasure in this worktree. Complete the rulebook's commit/push/PR gates and open one PR. Use draft status if acceptance is incomplete. Review fixes stay on this branch; the coordinator integrates serially and retires the worktree afterwards. This worktree is **not** retired by the agent.

## Result record — filled by Agent A for a-n02b-evidence-02

- **Status:** COMPLETE. Episode admission and procedural candidates with human review are implemented, verified against an isolated PostgreSQL/FalkorDB stack and documented in [docs/memory-kinds.md](../memory-kinds.md). Validated procedural reuse, bounded context, coordination, handoffs, native enrollment/capture, retention, erasure and package publication were not started and stay explicitly unavailable in capability output.

### Baseline

- Branch point: `origin/main` at `f1b168f65fd5e0e44f3f78e290ed68e3038a3490`, fetched at the start of the assignment. It contains merge `f1b168f` (PR #10, `ac3ca86` "Add sourced semantic memory and task coordination") and `ff9787c` (PR #9, Codex qualification). The worktree was created from that literal SHA, not from the previous feature branch, and verified clean before editing.
- Branch `threadline/a-n02b-evidence-02`, worktree `/tmp/threadline-a-n02b-evidence-02` (canonical `/private/tmp/threadline-a-n02b-evidence-02`), no upstream at creation. The coordinator checkout was not edited.

### Retirement of `a-n02b-semantic-01` (delegated rt operator)

All rulebook gates were re-verified before anything was removed.

1. `git merge-base --is-ancestor ac3ca86 origin/main` succeeded, and the GitHub API reports PR #10 `state: closed`, `merged: true`, `merge_commit_sha: f1b168f65fd5e0e44f3f78e290ed68e3038a3490`.
2. The old worktree was clean at `ac3ca86`, with no local-only commits and no untracked files; its only ignored content was `node_modules`, `packages/*/dist` and two `tsconfig.tsbuildinfo` files.
3. The old service was re-identified by port, command, working directory and data root rather than a remembered pid: `node packages/cli/dist/index.js serve`, listening on `127.0.0.1:47831`, cwd `/private/tmp/threadline-a-n02b-semantic-01`, `THREADLINE_HOME=/tmp/threadline-a-n02b-semantic-data-01/home`. It was stopped with `SIGTERM` and logged `Operation worker stopped.` then `Memory service stopped.`
4. Both containers were inspected before stopping: `threadline-a-n02b-semantic-01-postgres` (`postgres:18-alpine`, `127.0.0.1:55441`, volume `threadline-a-n02b-semantic-01-pg-data`) and `threadline-a-n02b-semantic-01-falkordb` (`falkordb/falkordb:6.0.2`, `127.0.0.1:56441`, volume `threadline-a-n02b-semantic-01-falkordb-data`, append-only with `appendfsync always`). Only those two containers and those two named volumes were stopped, removed and deleted. No prune ran; the `threadline-local-*` containers and volumes and every other pre-existing store were verified untouched afterwards.
5. Useful verification material was preserved **before** disposal: the twelve check scripts and the 128-line transcript (sha256 `985c325f313e7f60e8fa386d45a95049ef63f3d82398c2e86a7ae83cc97d9248`, matching the digest in the previous record) are at `/tmp/threadline-a-n02b-evidence-02-checks/carried-over/a-n02b-semantic-01/` with a `SHA256SUMS.txt`. The transcript was scanned for credentials first and contains none.
6. The temporary roots `/tmp/threadline-a-n02b-semantic-data-01` and `/tmp/threadline-a-n02b-semantic-01-checks` were then removed, which destroyed the generated throwaway passwords, `secrets.json`, `credential.json`, `tokens.env` and `credentials.sql`. Nothing was copied out of them.
7. `git worktree remove /private/tmp/threadline-a-n02b-semantic-01` succeeded without `--force`, after the disposable generated output had been deleted explicitly.
8. Historical branches were kept recoverable: local `threadline/a-n02b-semantic-01` still exists and `refs/heads/threadline/a-n02b-semantic-01` remains on the remote at `ac3ca86`.

No retirement gate failed and no resource was preserved under protest.

### Resources created for this assignment

All assignment-owned and outside the repository:

- Containers: `threadline-a-n02b-evidence-02-postgres` (`postgres:18-alpine`, repo digest `sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873`, host port `55442`) and `threadline-a-n02b-evidence-02-falkordb` (`falkordb/falkordb:6.0.2`, repo digest `sha256:107455e862a824e45e8e9f5a7fbfdf5e00a08b14e13eae2577c72fd9e3f59ba6`, host port `56442`, append-only with `appendfsync always`).
- Volumes: `threadline-a-n02b-evidence-02-pg-data`, `threadline-a-n02b-evidence-02-falkordb-data`.
- Data/config root `/tmp/threadline-a-n02b-evidence-data-02` (mode `0700`) holding `home/` (`THREADLINE_HOME`), `logs/`, `checks/` and two bound workspace roots. Generated throwaway database passwords live in `env.sh` and the local owner token in `credential.json`, both mode `0600`; neither was printed into this record.
- Service: `threadline serve` on `127.0.0.1:47832` from this worktree's own `npm ci` install.
- Credentials exercised over real HTTP: the generated local owner credential (`human_admin`), a `producer` credential with a `member` grant, a second `producer` credential with a `reader` grant, and a third `producer` credential with a `member` grant whose principal kind is `service` — used to prove that evidence recorded by a non-human principal cannot establish an observed outcome.
- Temporary check scripts (outside the repository): `/tmp/threadline-a-n02b-evidence-02-checks/` — `bootstrap.sh`, `rebuild.sh`, `serve.sh`, `fixtures.sh`, `producer-source.sh`, `restore-user-home.mjs`, `verify-user-home.mjs`, `verify.mjs`, `phase2.mjs`, `phase3.mjs`, plus the `carried-over/` directory above.
- Untouched: the coordinator's `~/.threadline` installation, the `threadline-local-*` containers and volumes, every other pre-existing container and volume, and all native state.

### Migrations

**No new migration was added, and migrations 1–4 are unchanged.** Inspecting the actual baseline showed every stored fact this checkpoint needs already exists: `operations.kind` is a length-bounded free-text column and `claim_operations` is parameterised by `p_kinds`, so `memory.episode.record` needs no schema change; the evidence classification reads existing `sources` columns joined to `principals.kind` and to the source's own `source.append` operation; and supporting-episode references are graph edges, not SQL rows. Adding migration 5 would have been an unused sequence number. Verified over the existing v4 ledger in place: `threadline init` re-applied nothing and reported `schema version 4 (applied)`.

### Implemented behaviour

New operation kind: `memory.episode.record`, delivered through the existing leased worker, the source-backed intent document and the guarded graph commit. `memory.propose` now also admits procedural content, and `memory.correct` supersedes semantic and procedural heads.

New route:

```text
POST /v2/memories/episodes     record one attempted action and its outcome
```

Existing routes `POST /v2/memories/proposals`, `POST /v2/memories/:memoryId/acceptance`, `POST /v2/memories/:memoryId/corrections`, `GET /v2/memories/:memoryId`, `GET /v2/memories` and the task routes now serve the new kinds.

#### Evidence classification (server-resolved, never caller-granted)

`evidencePrecision` in a request is a request. `observed` is granted only when **every** cited source is (1) in project scope, project-visible and available, (2) catalogued as outcome evidence (`procedure_outcome`, `tool_result`, `permission_outcome`), (3) `complete`, (4) **recorded by the acting human principal**, and (5) itself admitted to project memory. `source.append` always stamps the acting principal, so a producer or model principal cannot mint observed-grade evidence by declaring a kind: its own records fail (4). A request for `observed` that does not qualify is **refused** with `unsupported`, never silently downgraded. An absent or `authored` request always resolves to `authored` and is admitted through the human-reviewed path.

The worker re-derives all five conditions at delivery, so a document cannot assert a precision its evidence no longer supports (`episode_evidence_unsupported`, `evidence_precision_conflict`).

An observed episode is admitted as current with `acceptedByPrincipalId: null` — that null is the honest signal that no human accepted it and its authority is an observation this service verified. An authored episode stays a candidate with `delegation: "authored"` until a human accepts it.

`succeeded`, `failed`, `denied`, `interrupted` and `unknown` are stored verbatim and never collapsed; `unknown` **requires** a non-null `uncertainty`. An outcome is recorded about the one action under the recorded `observedUnder`; `applicability` is a separate, independently declared structure and is stored in its own field.

#### Procedural memory

- The request contract is `procedureAuthoringSchema`, which is a **strict** object: `procedureState`, `reviewRef` and `supportedBy` resolution are not authorable, and sending one is an explicit `invalid_request` rather than a silently dropped field.
- The service resolves stored `procedureState` to `candidate` and `reviewRef` to `null`; the worker refuses any captured document that disagrees (`procedure_state_unavailable`).
- `supportedBy` is a **claim**, checked before commit: each reference must name a version that project memory holds, that is `episodic`, and that is `accepted` (`supporting_episode_missing`, `supporting_reference_not_episodic`, `supporting_episode_not_accepted`, `supporting_reference_self`). A support that is still being admitted is a real wait (`dependency_pending`), not an invalidity.
- Reads resolve each reference from project memory and report the outcome **it actually recorded** plus its own `observedUnder` (`memorySupportSchema`). A procedure supported by a failed episode reads as supported by a failure; a procedure cannot present a success its evidence never had. A reference that cannot be resolved is `authority_unavailable`, not a silent omission.
- Human acceptance makes a candidate current with the accepting principal and reason recorded. **Acceptance is not validation**: `procedureState` stays `candidate`, `memory.procedure.validate` is reported `unavailable`, and no transition reaches `validated`. This is an explicit N04 gate, not a limitation discovered late.
- A correction may not change a memory identity's kind, in the proposal precheck, the correction precheck and the commit statement (`memory_kind_change_refused`), so a task requirement cannot be silently repointed at a different kind of obligation.
- `task.require` binds a `semantic` obligation only; an episode or a procedure is refused `requirement_kind_unsuitable`, in the precheck, in the diagnose path and in the commit statement.

#### Read and graph changes

- Versions now store their whole `content_json` beside a bounded `statement` summary (the statement for a requirement, the goal for a procedure, the action for an episode). A superseded version therefore keeps its own steps, prerequisites, parameters and uncertainty. A row written before this column existed is reconstructed from its semantic summary, which is exact for the only kind that could be written then.
- Reads report `evidencePrecision`, `acceptReason` and resolved `supports`, and fail closed with `authority_conflict` when a memory identity's kind and its head's kind disagree.
- The propose and correct statements materialise their supporting nodes before creating `SUPPORTED_BY`, and enforce the support count, exactly as they already did for evidence anchors and contradictions.

Changed paths, all inside the writable set: `packages/shared/src/memory.ts`, `packages/shared/src/capabilities.ts`, `packages/shared/src/index.ts`, `packages/backend/src/service/evidence.ts` (new), `packages/backend/src/service/memory.ts`, `packages/backend/src/service/semanticSupport.ts`, `packages/backend/src/service/operations.ts`, `packages/backend/src/storage/memoryGraph.ts`, `packages/backend/src/api/server.ts`, `packages/backend/src/capabilities.ts`, `CONTEXT.md`, `docs/memory-kinds.md` (new) and this record.

### Exact verification and results

`npm run build` (`tsc -b`) passes with no errors.

Three focused suites ran against the isolated stack on the final build: **173 checks, 173 passed, 0 failed**. Transcript: `/tmp/threadline-a-n02b-evidence-data-02/logs/verification.txt`, 228 lines, sha256 `2e968c7d6c117cacd3000634096be3c3f9582cb938bd004a9fc7968ee804459e`.

```sh
sh /tmp/threadline-a-n02b-evidence-02-checks/rebuild.sh      # fresh stores, schema, service, fixtures
node .../verify.mjs      # 121 checks
node .../phase2.mjs      # 30 checks
node .../phase3.mjs      # 22 checks
```

1. **Episodes and evidence precision — 27 checks.** A sourced episode is admitted and inspected with `evidencePrecision: "observed"`, `delegation: "observed"`, `acceptance: "accepted"`, `acceptedByPrincipalId: null`, its outcome recorded verbatim, `observedUnder` and `applicability` stored in separate fields and its citation intact. `denied`, `interrupted` and `unknown` each survive as distinct records; `unknown` carries its uncertainty and `denied` is not collapsed into `failed`; a bare `unknown` is refused at admission. Four `observed` requests are refused — producer-recorded evidence, `partial` completeness, a non-outcome kind and a plain note — while the same producer-recorded source is admitted through the authored path and reads back `authored`/`proposed`.
2. **Evidence and idempotency — 13 checks.** Foreign, private and unknown sources produce one indistinguishable `not_found` naming no source identity; an exact retry returns the first admission with identical operation, memory and version ids; a changed payload and a replay by another actor are both refused `idempotency_mismatch`.
3. **Procedures — 40 checks.** A candidate preserves its steps, prerequisites, parameters and supporting reference; its state is `candidate` and its `reviewRef` null. A producer and a read-only grant are both refused `scope_denied`. Human acceptance commits with a receipt, records the accepting principal and the reason, clears the candidates, and still leaves the state at `candidate`. A self-assigned `procedureState: "validated"` is refused by the strict contract; a submitted review reference cannot appear in the stored candidate; `memory.procedure.validate` is reported unavailable with its reason.
4. **Support validation — 7 checks.** An unknown support, an unaccepted episode and a non-episodic version are each refused with their own code; a procedure that declares no support commits and its read shows no invented support.
5. **Corrections and history — 16 checks.** A procedure correction supersedes the head and moves current authority. Direct graph reads confirm the superseded version is still `acceptance: "superseded"`, names its successor, and keeps **its own** steps, prerequisites and `SUPPORTED_BY` edge, while the correction carries exactly one of each and exactly one `SUPERSEDES` edge. A procedure and an episode are both refused `requirement_kind_unsuitable` as task requirements, after a stale task revision is refused `task_revision_conflict`.
6. **Merged semantic workflow — 6 checks.** Proposal, human acceptance, requirement binding and requirement resolution still work end to end; a kind-changing correction against a semantic identity is refused and the identity is unchanged.
7. **Competing updates — 2 checks.** Two corrections at the same expected head: one commits, the loser is refused `expected_head_conflict`.
8. **Bounds — 7 checks.** Nine procedure steps, nine prerequisites and nine supporting references are each refused at the contract boundary. The candidate cap is exercised for real: after nine further proposals the memory holds exactly eight proposals and both refusals name `candidate_limit_reached`.
9. **Reads and capabilities — 14 checks.** Kind-filtered, task-scoped and focused reads return only what they claim; `memory.episode.record` is supported; `memory.procedure.validate`, `context.prepare`, `context.occurrence`, `claim.status`, `handoff.offer`, `session.register` and `job.delete` all stay unavailable.
10. **Authorization and receipts — 9 checks.** A read-only grant cannot record an episode; a cross-project write is refused; reading under a foreign project scope is refused `scope_denied`; receipts are inspectable with decimal-string event sequences.
11. **Durability, outage and prerequisites — 30 checks.** Evidence marked unavailable cannot support a new episode (`source_unavailable`, HTTP 410) while the released episode keeps its citation and the source still reports its own availability. With FalkorDB stopped, an episode and a procedure that depends on it both stay `pending` rather than being refused, and both commit exactly once when the graph returns; a support that can never be admitted refuses instead of waiting forever. After a PostgreSQL restart the service answers, `durableMemory` returns to `true`, current authority and receipts are unchanged and new work commits. During a graph outage reads fail closed, the backlog is visible, the `falkordb` component reports not ready and `durableMemory` is `false`.
12. **Replay, precision and fail-closed reads — 22 checks.** A committed operation forced back to `pending` reconciles its existing receipt: same event sequence, one more attempt, no second version, no second edge, and an event head that did not advance. With the head pushed past 2^53, an episode commits and both the receipt and the graph report the exact sequence as a decimal string, advancing by exactly the two graph events a content-bearing episode takes. A second **head** for one identity (injected directly) makes both the memory view and the project list refuse `authority_conflict`, and both recover once the graph is consistent again. A procedure supported by a *failed* episode reads as supported by a failure and its stored summary is the goal, never the episode's outcome text.

### Findings raised by the work and fixed

- **`SUPPORTED_BY` targeted a bare id string.** The first commit wrote `CREATE (v)-[:SUPPORTED_BY]->(supportVersionId)`, which FalkorDB refuses with `Invalid node id`; every procedural commit therefore retried into `ambiguous`. Fixed by materialising the supporting nodes and checking their count, exactly as the statement already did for evidence anchors and contradictions.
- **An observed episode had no `CURRENT` edge.** The commit set `acceptance: 'accepted'` but never adopted the version as current, so a deterministically observed episode was admitted yet unreadable as authority. Fixed with a conditional `CURRENT` edge that is unreachable on the proposal path.
- **The episode `diagnose` could not distinguish its own commit from a foreign identity.** It checked the *candidate* set, which an accepted observed version is not in, so a lost reply after a successful commit would have been reported as `memory_id_conflict`. Fixed by asking about the version first, mirroring the correction path.

### Limitations, stated plainly

- **No permanent test suite** was added, by instruction. The scripts live outside the repository, so a later batch that changes these paths must reproduce equivalent checks.
- **No episode can originate from a real Codex session.** There is no native capture, transcript parsing, model extraction or provider execution loop in this build, so the strongest episode it can record is one a human recorded as a complete outcome record. That is stated by the eligibility rule and by the capability report, not worked around.
- **Eligibility condition 4 is load-bearing and was exercised only against a service-principal producer.** A human principal that recorded evidence for itself is the intended observed path, and a `service` principal is refused. Other principal kinds do not exist yet (`principals.kind` is `human|service`).
- **The observed path was not exercised through a real native boundary**, because there is none in this build. Nothing here claims otherwise.
- **A support that is waiting on a still-admitting episode was exercised once**, with the graph stopped and then restored. It was not exercised across a longer chain of three or more waiting intents.
- **The `ambiguous` state was not forced by losing a real reply.** The equivalent path was verified by replaying a committed operation and observing receipt reconciliation, and `graph_reply_lost` was observed incidentally before the `SUPPORTED_BY` fix. No naturally occurring ambiguous delivery is claimed.
- **The two-head condition was created by a direct graph write**, not through the service. The service is proven to fail closed on it; it is not proven to be the only way such a state can arise.
- **There is still no attempt ceiling.** An intent waiting on a genuinely pending prerequisite waits indefinitely by design. The hopeless mutual-wait cycle is still fixed (a wait only targets an intent that can create the missing identity) and was re-verified for the new kinds, but a bounded wait with a terminal refusal remains a follow-up.
- **The 64-source closure bound was not exercised at its limit.** The candidate cap, the step, prerequisite and support bounds, and the requirement cap path were exercised; the closure bound was not.
- **Producer and reader credentials were inserted with SQL** because this build has no supported command for issuing non-owner grants. Authorization was still exercised over real HTTP with real bearer tokens, never with constructed scopes.
- **A service-principal credential was created the same way**, specifically to give the eligibility check a non-human producer to refuse.
- **N02C, N04 and N05 work — bounded context, coordination claims and handoffs, validated reuse, native enrollment/capture, history import, deletion and export — was deliberately not started.**

### Proposed checklist updates (coordinator applies after integration)

- Record this PR as the N02B episode and procedure slice: `memory.episode.record` with server-resolved evidence precision, source-backed procedural proposals through the existing propose/accept/correct path, server-resolved procedure state and review reference, checked supporting-episode references, obligations-only requirement binding, kind-change refusal, and `docs/memory-kinds.md`.
- In section 2B, the lines "Observed episodes with honest outcomes; procedures with prerequisites and supporting evidence; no inferred root cause" and "Observed episodes with honest outcomes" can be marked complete for *admission and review*. Keep open: validated procedural reuse (`memory.procedure.validate`, N04), incompatible-prerequisite exclusion in retrieval (needs N02C selection), and bounded applicable episodes/procedures (N02C).
- Keep open in section 2C and the roadmap: `context.prepare`, `context.occurrence`, `claim.status`, `claim.acquire`, `handoff.offer`, `handoff.accept`, `handoff.revoke`, `session.register`, `session.list`, `job.import`, `job.delete`, `job.export`.
- Note for later batches: the neutral contracts added here are `episodeAuthoring`-adjacent — `EPISODE_EVIDENCE_PRECISIONS`, `OBSERVED_EVIDENCE_SOURCE_KINDS`, `procedureAuthoringSchema`, `memoryAuthoringSchema`, `resolveMemoryContent`/`authorMemoryContent` and `memorySupportSchema` — all defined once in `packages/shared/src/memory.ts`. Admission and the delivery worker must keep sharing them; `memoryRequestDigest` and `episodeRequestDigest` are the only two request digests, and neither includes an identity or a decision this service allocated.
- README.md and `docs/local-development.md` still say observed episodes and reusable procedures are unimplemented. **Both are outside this assignment's writable set**, so they are left unchanged and must be updated by the coordinator or Agent B before or with this merge.

### Integration requirements and retirement handoff

- Merge serially on `main`. This PR touches `packages/backend/src/**`, `packages/shared/src/**`, `CONTEXT.md`, `docs/memory-kinds.md`, this record and the coordinator-authorized `packages/backend/package.json`, `package-lock.json` and `docs/storage-recovery.md`.
- The backend manifest and lockfile add the direct dependency `@redis/client` at `5.12.1`; integrate these edits serially with Agent B's lockfile changes. No build, Compose, `.gitignore`, `fixtures/` or CLI change is needed.
- The coordinator owns `docs/development-checklist.md`, `README.md` and `docs/local-development.md`.
### Final commits, remote confirmation and PR

- Two commits on `threadline/a-n02b-evidence-02`: `92c81cf` "Record the a-n02b-evidence-02 assignment contract" (the contract bootstrap, an incremental commit inside this assignment) and `38a20efb596c3b23d7a6fad819c63c05df6e84e4` "Add source-backed episodes and procedural memory" (the implementation, the documentation and this result record).
- The branch was pushed with `git push -u origin HEAD:refs/heads/threadline/a-n02b-evidence-02`. The remote ref was read back and is `38a20efb596c3b23d7a6fad819c63c05df6e84e4`, identical to the local head. Its upstream is its own remote feature branch; nothing was pushed to `main` and nothing was merged.
- The verification transcript digest is unchanged between the pre-commit run and the post-commit run on the committed tree, so the results above describe exactly the committed source.

**Committed and pushed; the PR was NOT created by this agent.** There is no GitHub CLI on this machine. The GitHub API token in the git credential store authenticates as `dkuriyalgrid`, which is not a collaborator on `kuriyaldivyanshu/falkorDB-Hackathon`; `POST /repos/…/pulls` is refused with HTTP 422 `{"resource":"Issue","code":"custom","message":"must be a collaborator"}` even though the repository's `pull_request_creation_policy` is `all`. The ssh remote identity is `kuriyaldivyanshu`, which can push but cannot authenticate the REST API. No PR was half-created: the repository has zero open PRs and no PR exists for this head.

To raise it, the repository owner can use the prepared body and this compare link:

```text
head: threadline/a-n02b-evidence-02   base: main
https://github.com/kuriyaldivyanshu/falkorDB-Hackathon/compare/main...threadline/a-n02b-evidence-02?expand=1
```

The full PR body is prepared at `/tmp/threadline-a-n02b-evidence-02-checks/pr-body.md`.

### An unintended repository artifact, reported rather than hidden

While establishing whether an API route existed for PR creation, a single probe `POST /repos/…/issues` was issued with the same token. It succeeded and created issue **#11**, titled `RETIRED probe artifact (delete me)`, now closed and containing nothing but a note that it has no project content. `DELETE /repos/…/issues/11` returned 404 for this token even though its scopes include `repo`, so the agent could not remove it. **The owner should delete issue #11.** No other repository write was made by this agent.

### Retirement handoff

- Retire when idle: containers `threadline-a-n02b-evidence-02-postgres` and `threadline-a-n02b-evidence-02-falkordb`, volumes `threadline-a-n02b-evidence-02-pg-data` and `threadline-a-n02b-evidence-02-falkordb-data`, directories `/tmp/threadline-a-n02b-evidence-data-02` and `/tmp/threadline-a-n02b-evidence-02-checks`, the `threadline serve` process on `127.0.0.1:47832`, and worktree `/tmp/threadline-a-n02b-evidence-02`. Removing the data root destroys the generated credentials. No resource outside those names is assignment-owned.
- **Do not retire this worktree until the PR is raised and reviewed.** Review fixes belong on this branch. The next checkpoint starts from a fresh worktree and branch after this PR merges.
- The `carried-over/a-n02b-semantic-01/` directory under the checks root holds the previous assignment's check scripts and transcript, preserved before its resources were disposed. A later batch may want them; the directory is inside the temporary root and is not tracked.

## Coordinator takeover: socket lifecycle and setup safety

The user assigned the unfinished pre-merge fixes to the coordinator on 18 October 2026. Agent A's source edits were preserved and completed in this same worktree. This is review work for the existing checkpoint, not a new feature milestone.

### Scope and dependency reservation

The coordinator extends this checkpoint's writable paths to `packages/backend/package.json`, the matching backend entries in `package-lock.json`, and [storage recovery documentation](../storage-recovery.md). Agent B still owns CLI changes; its lockfile additions must be integrated serially. There are no SQL migration or native configuration changes.

### Reproduction and corrections

- The isolated service reported `ready` and `graphReachable: true` after roughly 30 minutes with its FalkorDB container stopped. Graph I/O blocked the worker while stale success remained visible. The earlier one-client mitigation reduced factory calls but retained the factory's startup error window and unbounded reply waits.
- The final store owns its emitter before socket creation, reuses the pinned FalkorDB Graph/Single command implementation over a declared node-redis client, refuses offline queuing, and bounds both connection and complete-reply waits. Submitted writes with lost replies are ambiguous and retain receipt reconciliation. No global exception handler or dependency file patch is used.
- Readiness begins false and checks transport state and completed-probe freshness. Backlog counts represent pending, leased and ambiguous work separately.
- The installation guard originally compared API host/port instead of PostgreSQL host/port, and treated all file-read failures as absence. Those comparisons/refusals are corrected. Concise refusal messages retain the replacement instruction within the CLI's bounded error output. Comments no longer promise rollback of SQL/source mutations after setup passes the guard.
- Temporary verification defects were corrected: owner-token argument shape in status calls, unbounded HTTP waits, accepting a successful graph read during a confirmed outage, hard-coded retry keys across runs, and implicit root resolution in fixture commands. Every modifying fixture/setup command now pins this assignment's home. The coordinator's real installation/credentials were not read or modified during takeover verification.

### Verification and handoff

Final results are recorded below after all checks finish. Temporary focused checks and transcripts live under `/tmp/threadline-a-n02b-evidence-02-checks/takeover-*`. A failed queue-timeout-only silent-socket check preceded the complete-reply deadline fix; only final reruns establish acceptance. One initial outage run was interrupted and is not counted as a completed suite.


Final verification on the completed source:

- `npm run build`: PASS (`tsc -b`).
- Existing `verify.mjs`: **121/121 PASS**.
- Existing `phase2.mjs`: **30/30 PASS** (including PostgreSQL restart and graph outage/recovery).
- Existing `phase3.mjs`: **22/22 PASS** (receipt replay, exact counters, fail-closed duplicate authority and support provenance).
- Corrected `outage-acceptance.mjs 3`: **75/75 PASS**, three established-connection outage/recovery cycles, SQL source/history usable, graph reads 503, waiting operations visible, original receipts/idempotency preserved, clean shutdown.
- Expanded `install-safety.mjs`: **51/51 PASS**, synthetic roots only: explicit/environment/fallback root resolution, fresh/repeat setup, database and database-host mismatch, wrong SQL credentials, malformed/unreadable config, explicit replacement and an untouched synthetic sentinel installation.
- `takeover-lifecycle.mjs`: **28/28 PASS**, concurrent startup, twenty startup/flap/close rounds, 39 successful and 21 refused concurrent probes, silent initial handshake, established silent socket deadline, clean reply decoding after reconnect. The failed queue-timeout-only variant hung on the established silent socket before the full-reply deadline was added.
- `takeover-startup.mjs`: **6/6 PASS**, full service started with graph unavailable, truthful graph guarantees, SQL history available, graph read 503, recovery without service restart and clean exit.
- Total: **333 focused checks, zero failures in final reruns**. Three changed Markdown files passed headings/fences/local-link checks; `git diff --check` passed. No permanent tests were added.

Safe transcript digests are in `/tmp/threadline-a-n02b-evidence-02-checks/takeover-SHA256SUMS.txt`; the named `takeover-*.txt` files contain final outcomes. These temporary artifacts supplement this tracked summary. They are not required to learn the observed results from a fresh checkout.

Limits: no actual submitted graph commit reply was deliberately dropped in the final run; normal receipts and committed-operation replay were checked, and timeouts/socket loss remain conservatively ambiguous in the worker. This bridge qualifies standalone storage only. The earlier coordinator configuration restoration is not claimed to be byte-identical; no real user installation was a target of the takeover checks. No before/after performance benchmark is claimed.

The assignment HTTP service is stopped after verification. Its two original assignment-owned database containers remain running, and the worktree, source/data root, synthetic credentials and check artifacts remain for review. Nothing from B's stack or the baseline installation was stopped or modified. Retire these only after merge/recovery gates.

Integration: normal follow-up commit/push on `threadline/a-n02b-evidence-02`; no force push or merge. B must integrate the backend dependency/lockfile edits serially, rerun the combined build/CLI/MCP checks, and link the new storage-safety instructions from its owned setup docs. The coordinator updates the checklist after review/merge.
