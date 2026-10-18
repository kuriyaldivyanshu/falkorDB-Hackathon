# Agent A: N02C bounded context

## Contract

Follow AGENTS.md and docs/parallel-work-rulebook.md in full. Read this tracked
assignment before editing source. Use only this assignment's worktree, branch,
writable paths and resources. Complete and verify the declared checkpoint,
commit/push the feature branch and open one PR. Later features are excluded;
review fixes stay here. The coordinator owns merges and retirement.

- ID: `a-n02c-context-03`; owner: Agent A.
- Outcome: one backend bounded-context service over canonical memory/tasks.
- Checkpoint: authenticated preparation, durable metadata-only manifests,
  truthful occurrences, bounded selection and explicit refusals.
- Base: `main`, literal SHA `106985866429689faf2e166eb89c5d225fbac6d3`.
- Repository: existing origin `git@github-personal:kuriyaldivyanshu/falkorDB-Hackathon.git`.
- Branch: `threadline/a-n02c-context-03`; PR base: `main`.
- Worktree: `/tmp/threadline-a-n02c-context-03` (canonical
  `/private/tmp/threadline-a-n02c-context-03`).
- Dependencies: merged SQL source/graph delivery, semantic/task services,
  evidence precision, candidate procedures, socket/installation safety,
  human CLI/read-only MCP and PR #13 acceptance/input guards. Do not redo them.
- Integration: after this checkpoint's verification and coordinator review;
  do not mark N03, N04 or the product complete.

## Ownership

Writable: `packages/backend/src/**` only as necessary for context;
`packages/shared/src/context.ts`; context exports in
`packages/shared/src/index.ts`; context routes in
`packages/shared/src/protocol.ts`; context contracts in
`packages/shared/src/capabilities.ts`; context terminology in `CONTEXT.md`;
new `docs/context.md`; context eligibility in `docs/memory-kinds.md`; this record.
Everything else is read-only, especially CLI, existing memory/task contracts,
root/package manifests, lockfile, build/Compose configuration, fixtures,
README, local-development, cli-memory-and-mcp, native-integration-contract,
development-checklist, rulebook and Agent B's files/worktree.
Report a necessary crossing with the smallest required change; continue
independent work. The coordinator owns shared checklist/product-doc updates.
Agent B's episode CLI/demo depends on existing contracts, which remain stable.

## Creation and resources

Inspect clean coordinator checkout, fetch origin, require exact expected main,
unused branch/path, then create from the literal SHA. Verify canonical path,
branch, HEAD, clean state and no main upstream. Commit this bootstrap before
source edits; install isolated dependencies with `npm ci` and existing lockfile.
Preserve unrelated state. Do not reuse or retire the previous
`/tmp/threadline-a-n02b-evidence-02` or its resources.

Assigned resources (check ownership/availability first): HTTP 127.0.0.1:47842;
PostgreSQL 55452; FalkorDB 56452; container/volume prefix
`threadline-a-n02c-context-03-`; data root
`/tmp/threadline-a-n02c-context-data-03`; installation root
`/tmp/threadline-a-n02c-context-data-03/home`; temporary checks
`/tmp/threadline-a-n02c-context-03-checks`.
Use fresh synthetic stores and generated credentials. Every setup names the
absolute `--home`; assert installation/source/database/ports before mutations.
Never borrow shared stores, credentials or native configuration. No native
inference, installation, resource deletion, merge, force push or retirement.

## Required reading

AGENTS.md, parallel-work-rulebook, development-checklist (N02C), CONTEXT, README,
memory-kinds, storage-recovery, native-integration-contract and assignments
agent-a-n02b-semantic-memory, agent-a-n02b-evidence-02, agent-b-mcp-read-02.
Inspect shared context/memory/sources/protocol; backend auth/memory/tasks/sources/
semanticSupport/evidence/operations; storage memoryGraph/schema/pg/files;
api/server, index and capabilities.

## Acceptance criteria

One context selector behind existing routes/composition: exact current mandatory
task requirements, bounded applicable optional semantic/episode material,
source references, understandable omissions/refusals and honest graph/task/
privacy snapshots. FalkorDB is canonical; graph outage must not fall back to SQL
or files. Retrieval is deterministic and bounded in queries, candidates and
retries, with stable tie-breaking, no inference/embeddings/raw caller Cypher.
Resolve every required stable identity: missing, proposed, ambiguous, retracted
or unreadable authority refuses. Mandatory content stays exact, never excerpted.

Keep observedUnder separate from applicability. Freshness correction 600→60
replaces authority while a still-applicable UTC lesson survives. Unknown facts
never satisfy predicates; incompatible output/prerequisites exclude advice.
Focus ranks only. If needed add typed conditions in context.ts, distinguishing
selection hints from authenticated/stored facts and deriving task facts from
the task. Validate all inputs; hints prove no native identity or execution.
Candidates remain candidates; procedure validation/handoff selection unavailable.

Limits: default complete rendered body 4096 UTF-8 bytes, hard maximum 8192;
≤8 optional memories, ≤64 source references and existing mandatory-item bound.
Count headings/separators/rendered references. UTF-8 excerpts identify their
representation. Recheck authorization, source availability and full required
provenance before release; reconcile per-item and closure bounds deliberately.
Refusals/omissions expose no inaccessible content, source IDs or private paths.
Detect relevant graph/task/privacy changes using bounded retry/refusal and
name the consistency point. Distinguish selection head from manifest admission.

Durably record a context_manifest Source, selected identity/version metadata,
render digest, graph epoch/head, privacy revision and truthful prepared
occurrence. Persist no rendered plaintext in manifest bytes/items, operation
payloads, occurrence SQL, logs or diagnostics; do not persist focus/free text.
Separate metadata item schema from released text-bearing packet items. Reuse
source/file safety and authorization. Scoped idempotency must handle lost
responses predictably, reject changed requests and avoid duplicate audits.
Graph admission is committed only with an actual receipt.

Preparation proves no emission; reported emission proves no comprehension.
No self-granted native_observed; native observation unavailable without qualified
evidence. Reject unknown/foreign/unauthorized session references; never invent
sessions. Guard scoped transitions and reject unsupported precision.

Inspect existing context_occurrences before schema edits. If necessary add
migration 5 after the immutable v4 ledger; upgrade a populated synthetic v4
baseline without resetting, preserving restricted role/forced RLS. No casual
graph reset/schema change. Enable only implemented context capabilities and
update backend status wording. Keep native integration, validated procedures,
claims, handoffs, import, erasure/export unavailable.

## Verification and delivery

Run `npm run build` after source changes. Use focused temporary checks outside
the repository, no permanent package suite. Exercise current/proposed/corrected
requirements; UTC lesson; incompatible/unknown applicability; candidate wording;
missing/ambiguous/overflow authority; optional and UTF-8 body limits; reference/
candidate bounds; source privacy/availability; snapshot change retry/refusal;
metadata-only persistence; scoped honest occurrences/native refusal; idempotency;
bounded graph outage, SQL history survival and service recovery without restart;
existing semantic/task/episode paths. Use real HTTP credentials for authorization;
synthetic SQL identity setup is verification only. Report actual observations,
including untriggered races and remaining uncertainty.

Write docs/context.md covering selection/applicability, mandatory/optional bounds,
refusals, snapshots, persistence/release, occurrences, routes/examples/limits.
Record base/head/paths/design/schema/check results/uncertainty, proposed shared
doc corrections and resources. Check docs links/headings/fences, full scope diff,
secrets, `git diff --check`, explicit staging and clean final state. Push normal
commits to the assigned branch, confirm remote SHA, inspect existing PRs and open
one PR to main. Use a multiline body with evidence/limits/integration requests.
If PR creation is unavailable, report exact blocker and compare link/body.
Keep worktree/resources for coordinator review and retirement.

## Result

Bootstrap: clean coordinator main and fetched origin/main both matched the base;
branch/path/data/check roots absent, reserved ports available and no Docker
prefix collision. Worktree verified clean at the base, without upstream.
Implementation and verification pending.

### Implemented checkpoint

Status: **checkpoint-ready and PR-open**. [PR #15](https://github.com/kuriyaldivyanshu/falkorDB-Hackathon/pull/15)
is open to main. The coordinator retains merge and retirement ownership. The baseline remains
`106985866429689faf2e166eb89c5d225fbac6d3`; bootstrap commit is `ab798c9`.
Implementation/source head and final remote/PR confirmation are recorded below
when those actions complete.

FalkorDB remains central: task requirements, stable/current authority, accepted
optional decision/fact/episode content, applicability and graph epoch/head are
read from the canonical project graph. SQL supplies authorization, source
metadata/history and context audits. A stopped graph refuses preparation while
SQL history continues; graph recovery is necessary for context release. There
is no accepted-memory reconstruction from SQL or source documents.

Changed implementation paths:

- New `packages/backend/src/service/context.ts`: one shared selector, scoped
  preparation/replay and guarded occurrence reporting.
- New `packages/backend/src/storage/contextGraph.ts`: bounded candidate,
  current-head, requirement-bound and task-revision queries.
- Backend `api/server.ts`, `index.ts`, `capabilities.ts`: authenticated existing
  context routes, composition and truthful support/status wording.
- Backend `service/sources.ts`: existing append/read/file policy can join the
  context transaction; no second catalog/file store. Joined appends do not log
  settlement before their outer transaction commits.
- Backend `storage/schema.ts`: additive migration 5 only.
- Shared `context.ts` and context exports in `index.ts`: metadata/packet
  separation, typed selection hints, scoped retry keys, safe report fields.
- `CONTEXT.md`, new `docs/context.md`, context eligibility in
  `docs/memory-kinds.md`, and this assignment record.

No CLI, memory/task authoring contract, manifest/lockfile, build/Compose, fixture,
shared checklist, README or native configuration was changed.

### Design and schema decisions

- Exact mandatory current statements resolve every stable required identity.
  Missing/proposed/ambiguous/retracted/unreadable authority refuses. Optional
  retrieval considers accepted decisions/facts and accepted episodes. Procedure
  candidates and handoffs are explicitly excluded categories; no validated reuse
  or satisfied procedural prerequisites are invented.
- Candidate identity window: newest 32 plus one sentinel, before version
  traversal; current-head lookup returns at most three rows. Within that window,
  unsuccessful/denied/interrupted/unknown episodes precede decisions, facts,
  then successful episodes. Focus ranks within a priority; stable identity
  breaks remaining time ties. Conditions match literal stored predicates;
  task family comes from the task and other values are labelled caller hints.
- Body limits remain 4096 default/8192 hard UTF-8 bytes, eight optional memories,
  16 mandatory items and 64 distinct refs. Full rendered headings/separators/refs
  count. Excerpts are optional-only code-point prefixes of at most 1024 bytes.
- Reconciled the prior unused eight-ref item bound to 64, matching canonical
  Memory provenance. Parent dependency closure is bounded and checked in full;
  a 65th source refuses, never truncates into false complete provenance.
- Manifest schema v2 omits text-bearing item fields and raw focus/hints. Released
  text stays in packet items/body; durable metadata contains only IDs, versions,
  representation/byte metadata, refs, digests, enum omissions and snapshots.
  Task revision reuses the existing opaque task-revision validator.
- A context transaction takes the existing project advisory barrier (two-second
  lock timeout, ten-second SQL statement timeout), reuses its SQL connection for
  source reads, and rechecks sources, task, token/grant/policy, graph epoch/head
  and privacy before release. Changed selection state rolls back and retries
  once, then refuses. This is an explained snapshot, not a distributed SQL/graph
  transaction or a promise that authority never changes after release.
- Source catalog/admission intent and prepared occurrence commit atomically.
  The manifest's later source-anchor Event/receipt is separate from its selection
  head. The packet names the actual operation to inspect; it does not claim its
  queued graph admission committed.
- Preparation deduplicates by tenant/project/principal/key digest, and requires
  the same token/request digest. Replays use graph versions and current source/
  task/privacy checks. Stale authority refuses under the old key; new selection
  needs a new key. Terminal occurrence reports require expected `prepared` and
  their own key; exact retry is stable, changes refuse. Emission is a report,
  never native observation or comprehension. Boundary/refusal values are enums;
  free native references and refusal text are not accepted.
- Migration 5 `context_retry_metadata` adds nullable `request_digest`,
  `update_key`, `update_digest` columns to the existing occurrence table. Existing
  v1–v4 statements/checksums, occurrence rows, restricted role and forced RLS are
  preserved. No new table/database or graph schema/reset is introduced.

### Verification actually exercised

All temporary scripts are outside the repository in
`/tmp/threadline-a-n02c-context-03-checks`; generated runtime/check state is under
`/tmp/threadline-a-n02c-context-data-03`. No permanent package tests were added.

Commands and observed outcomes:

- `npm ci`: passed with the existing lockfile in the fresh worktree.
- `npm run build`: passed after the final source changes (`tsc -b`, Node
  v22.16.0). An early build failed because an added `.min()` was applied to the
  existing generic byte-bounded validator; it was corrected before verification.
- `node --experimental-strip-types .../upgrade.mjs`: passed populated v4→v5
  upgrade without reset, unchanged v1–v4 ledger rows/checksums, retained prepared
  occurrence and forced RLS. The baseline was constructed from the literal base
  schema, with synthetic tenant/project/source/occurrence rows before upgrade.
- `node .../start.mjs`: passed explicit absolute `--home` initialization after
  assertions of installation/source roots, database and all assigned ports.
- `node .../http.mjs`, repeated as `.../final-http.mjs` on another fresh synthetic
  project: passed proposal non-authority, exact 600-second requirement,
  correction to 60 seconds, retained applicable UTC lesson, unknown/incompatible
  contract exclusion, accepted procedure remaining excluded candidate, body and
  multibyte/excerpt limits, exact/mismatched/stale retries, guarded emissions,
  native-observed refusal, unknown-session refusal and unauthenticated refusal.
- `node .../advanced.mjs`: passed metadata-only file/operation/occurrence checks,
  real reader credential preparation and foreign occurrence/project refusals,
  private/unavailable mandatory sources, unavailable optional evidence, ambiguous
  authority, 17-distinct-requirement refusal, private-parent closure exclusion,
  complete nine-ref item, 65-ref refusal, complete 64-ref item within 8192 bytes,
  eight-optional limit and 32-candidate window/explicit omissions.
- `node .../races.mjs`: repeated on the final compiled source; passed preparation
  retry across service restart with the same audit identity, concurrent same-key
  preparation, an actual graph-head change followed by successful retry, a task
  revision change followed by coherent selection, repeated graph churn refusing
  after two attempts without another occurrence, SQL privacy change refusing the
  stale call and a subsequent fresh authentication succeeding. These are authored
  controlled real-store mutations via a temporary graph-read wrapper, not an
  untriggered race or evidence of every production interleaving.
- That same final `races.mjs` process held an established connection, stopped only
  the assigned FalkorDB container, returned typed `store_unavailable` within the
  checked 6.5-second bound, served SQL history, restored that same container and
  released exact current authority again without restarting the service. It also
  verified capabilities and status wording. Graph recovery was actually observed.
- `node .../final-extra.mjs`: passed denied/interrupted precision, retracted
  mandatory refusal, real foreign-tenant HTTP credential isolation, initial
  prepared/unknown/refused states, safe report enums and free-text refusals,
  native-turn refusal, report prerequisites, hard byte cap, duplicate condition
  refusal and existing semantic/task/episode reads.
- `node .../final-smoke.mjs`: passed on final compiled source: exact authority/UTC,
  existing opaque task revision compatibility, closed-task preparation/replay
  refusal, final scoped report guard, unsupported native observation, shared
  response/status schemas, restricted SQL role and real manifest Source.
- `node .../scoped-extra.mjs`: passed same-principal/different-token retry and
  occurrence refusals, independent other-principal preparation, strict manifest
  item/omission plaintext rejection, total 64-ref optional exclusion with an
  explicit reason, and missing retained file bytes refusing release (the exact
  assigned file was renamed back in a `finally`).
- `python3 .../docs-check.py`: passed H1/heading hierarchy, labelled fences and
  local links for the four changed Markdown documents. `git diff --check` passed.

Preliminary harness failures were corrected and are not cited as passing checks:
incorrect compiled-package import paths, a missing project idempotency field,
starting a check before the listener bound, using duplicate requirement edges
instead of distinct identities, an incorrect expectation that 64 short rendered
refs necessarily overflow 8192 bytes, and a repeated sentinel matching older
fixture content. One implementation defect was found by HTTP: a custom refusal
was wrapped by SQL into a generic storage failure. It now inherits the existing
service error so rollback preserves its typed context reason; corrected runs pass.

### Remaining uncertainty and intentional limits

No real native session was registered or fabricated, and no native installation,
capture, inference, model comprehension, provider-wire proof or native-observed
precision was exercised or enabled. Unknown/unbound references and foreign
credential scopes were exercised; a qualified live session/enrollment path does
not exist to verify. Procedure prerequisites/validated reuse and handoff selection
stay excluded, with explicit reasons. No production load benchmark, complete
concurrency proof, physical lost HTTP response, or deliberately lost submitted
graph-commit reply is claimed. Retry checks simulate the caller repeating the
same identity after preparation and service restart. The bounded recent window
is not exhaustive recall. A failed SQL preparation may leave only an unreferenced
metadata object in the existing file store; cleanup is not added here.

### Coordinator updates requested before integration

- Reconcile stale N02B checkboxes with the already merged semantic/task/episode/
  candidate-procedure milestones; the old PLANNED reservations authorize no redo.
- Record this backend N02C checkpoint and its exact limits: current obligations,
  applicable accepted facts/decisions/episodes, metadata manifests, scoped
  occurrences, refusal/byte/provenance bounds and controlled race/outage evidence.
- Preserve the N04 procedure-validation/prerequisite-reuse and handoff gates.
  Do not mark N03/N04 or the product complete.
- README.md and docs/local-development.md should list the two existing context
  POST routes as implemented backend operations, require idempotency keys and
  link docs/context.md. They must keep CLI/MCP/native context wiring unavailable.
- docs/native-integration-contract.md should acknowledge backend context support
  while preserving all native qualification gates, read-only MCP and absent hooks.
  The root AGENTS.md current-status wording is also stale about accepted memory.
  These shared files are frozen here and were not silently edited.

### Resources retained for review

Owner: this assignment until coordinator retirement. Containers
`threadline-a-n02c-context-03-postgres` and
`threadline-a-n02c-context-03-falkordb`; volumes
`threadline-a-n02c-context-03-pg-data` and
`threadline-a-n02c-context-03-falkordb-data`. Ports 55452/56452 are loopback-only;
FalkorDB uses the documented 6.0.2 module arguments, AOF/always fsync and generated
assignment authentication; PostgreSQL uses postgres:18-alpine with a restricted
application role. Data/home/check roots are the allocations above. Generated
credentials stay mode 0600 under the mode-0700 data root, outside Git.

The final verified service is the temporary composition driver `races.mjs`, PID
8744, on 127.0.0.1:47842, using this worktree's final built backend and stores.
Its controlled mutation mode is disabled after checks; its SIGTERM handler closes
the service normally. It remains available for review. The worktree's ignored
node_modules/build output and all synthetic source/history/graph data remain.
Previous assignments, their databases/volumes and coordinator/native installations
were not borrowed or retired. No main merge, force push or cleanup is authorized.


### Commit, remote and PR confirmation

- Bootstrap: `ab798c9bdd5b392ca6d07e61e058af686e33f6d6`.
- Verified implementation/source head:
  `bab8653c439ad9ef53c493aa8592621df74c4bb3`
  (`Add graph-backed bounded context preparation`). The final source digests are
  retained at `/tmp/threadline-a-n02c-context-data-03/verified-source-digests.json`.
- Explicit push:
  `git push -u origin HEAD:refs/heads/threadline/a-n02c-context-03` succeeded.
  `git ls-remote` read back that exact implementation SHA. The upstream is
  `origin/threadline/a-n02c-context-03`, never main.
- Created exactly one PR through the authenticated GitHub browser session:
  [PR #15: Add bounded context over canonical FalkorDB memory](https://github.com/kuriyaldivyanshu/falkorDB-Hackathon/pull/15).
  GitHub visibly confirms open status, base `main`, head
  `threadline/a-n02c-context-03`, and the verified implementation commit. No
  GitHub CLI, borrowed API credential, probe issue or merge was used.
- The prepared multiline body and screenshot proof are outside the repository:
  `/tmp/threadline-a-n02c-context-03-checks/pr-body.md` and `pr-15.png` in that
  same directory. This final result-only handoff is committed/pushed on the
  same branch; it changes no verified source. The final branch tip is reported
  by the completion handoff and PR, rather than inserting a commit's own hash
  into its own content.
- Full-base ownership/frozen-path checks, generated-credential scans and
  plaintext-free diagnostic checks passed. The checked source did not change
  after final verification. Only this record changed after the implementation
  commit; document structure/link/fence and diff checks were repeated for it.

Next coordinator action: review PR #15, reconcile the explicitly requested frozen
shared documentation, integrate serially with other work, then retire only after
merge/recovery gates. Keep the assigned worktree, service and stores available
until that review is complete. This checkpoint is not merged or retired.

## PR 15 review follow-up

The coordinator assigned implementation and verification of the two P2 findings
at `dcb8702b225aa0c92b7d9399635d1097f4a42d91`, in this same worktree/branch/PR.
The existing ownership/resource restrictions still apply. No later milestone,
merge of this PR, force push or retirement is authorized.

### Main integration and changes

Fetched origin and verified the assignment branch clean, with its own feature
upstream. Normally merged current main
`26c5681c842da2f0d195d9b995b9a152c44b08f0` (merged B PR 14) in merge commit
`ce7c716888386f6b5d6f41d03575ca8f1eab00f9`. The merge was clean. B's CLI,
demonstration, fixtures and documentation are preserved byte-for-byte relative
to that main; those paths were not edited for these fixes.

Review changes are limited to backend `service/context.ts`, shared `context.ts`,
context terminology in `CONTEXT.md`, authoritative `docs/context.md` and this
record. FalkorDB still supplies current authority, task and selection snapshots;
there is no SQL/file fallback for accepted memory. No new migration, dependency,
SQL/graph reset, authoring-contract change or capability expansion was needed.

- All context release authorization queries now use advancing PostgreSQL
  `clock_timestamp()` for absolute and idle expiry. Fresh preparation's final
  authorization query follows the final graph/task checks and packet validation;
  replay also performs it as the last asynchronous work before SQL commit.
- Released items carry full `applicability` and `observedUnder` fields. Their
  rendered labels distinguish current selection predicates/caller hints from
  historical conditions. Both complete JSON representations count toward the
  rendered UTF-8 budget. Only optional body text can be excerpted; qualifications
  remain complete. If they cannot fit, optional advice is omitted and mandatory
  authority refuses rather than losing its qualifications.
- Replaced both the metadata schema's `omit(text)` and the projection's rest
  spread with explicit field allowlists. Statement text, applicability values,
  historical conditions and raw selection hints/focus are excluded from context
  manifest bytes/items, operation payloads and occurrence rows.
- Renderer version 2 includes qualification text in the render digest. Persisted
  metadata shape remains manifest schema 2. Replay refuses other renderer
  versions with `stale_preparation`, retaining immutable old audits; callers use
  a new scoped key for a new qualified preparation.

### Review verification actually exercised

Temporary checks remain outside Git under the assigned checks root. They use
only generated assignment credentials and the assigned SQL/graph/source stores.
Before mutations, the checks asserted the absolute installation/source roots,
`context03` database, HTTP 47842, PostgreSQL 55452 and FalkorDB 56452. Existing
container names and listener PID/command were checked before replacing the owned
service. Setup/init was not rerun and no prior data was reset.

- `npm run build`: passed on the combined main/feature source, and again after
  the final source comment adjustment. `git diff --check` passed.
- `node .../review-expiry.mjs`: all four real-HTTP cases passed: absolute and
  idle expiry during fresh preparation, and absolute and idle expiry during
  replay. A temporary store wrapper delayed the final real graph-root read
  until after the token deadline. Recorded SQL times proved the transaction
  timestamp was before expiry while the final advancing clock was after expiry.
  Final release returned `scope_denied` in every case; fresh work rolled back,
  replay added no occurrence, and restoring each generated test credential
  allowed a correct scoped retry. This actually triggered expiry inside the
  transaction, rather than testing an already expired request at route entry.
- `node .../review-http.mjs`: passed proposal non-authority; exact 600→60-second
  correction; still-applicable UTC lesson whose historical contract is distinct
  from its applicability; unknown/incompatible exclusion; candidate procedure
  omission; mandatory multibyte overflow; exact mandatory text; complete-body
  UTF-8 bounds and optional excerpt; exact/mismatched/stale retries; guarded
  terminal occurrence reports; unsupported native observation; unknown session,
  unauthenticated and forged task-family refusals. The excerpt fixture budget
  is 3072 bytes to include the newly required complete qualifications.
- `node .../review-qualifications.mjs`: passed separate packet fields and rendered
  labels; full qualification preservation in an excerpt; text-byte versus full
  body-byte measurements; SHA-256 digest of the complete qualified body; exact
  renderer-2 replay; strict manifest rejection of `text`, `applicability` and
  `observedUnder`; inspection of all then-retained context manifests in the new
  project plus their operation/occurrence rows, with no rendered/qualification
  sentinel plaintext; actual renderer-1 preparation refusal without a duplicate
  occurrence; optional omission when historical conditions alone exceed 8192
  bytes; and refusal of a short mandatory statement with oversized complete
  historical qualifications.
- `node .../review-demo.mjs`: passed all Bash blocks in merged B's
  `docs/memory-demo.md` sections 2–6, against this assignment's explicit home and
  existing synthetic stores. This used a new project, actual public exporter
  execution (exit 0 with expected CSV mismatch), human episode CLI with observed
  precision, exact guarded 600→60 correction, retained intent/source/operation
  reads, accepted candidate procedure, normal service restart, fresh CLI reads
  and the documented finite authored MCP client with all six read-only tools.
  No fixture, CLI or demonstration source was edited.
- `node .../review-final.mjs`: passed on the normal CLI-served process after
  restart: renderer-2 replay retained the same body, qualifications, audit IDs
  and digest; context over B's actual demo graph selected the exact 60-second
  obligation and the qualified observed UTC failure with historical freshness
  600, excluded the procedure candidate, stayed within 4096 bytes and replayed
  identically. Missing contract hints excluded that episode. Context support and
  unavailable procedure validation remained truthful.
- `python3 .../docs-check.py`: passed changed-document H1/heading hierarchy,
  labelled fences and local links. `python3 .../review-audit.py`: passed full
  feature diff ownership against the integrated main, frozen-path equality,
  generated-secret scan and plaintext-free service diagnostics. Source digests
  were captured outside Git for final commit verification.

Corrected preliminary attempts are not passing evidence: the first expiry
fixture had no admitted source and therefore no graph root; it correctly refused
before exercising expiry. It was initialized through normal source admission.
The first overflow episode omitted the existing required uncertainty for an
unknown outcome; the input was corrected. After the demonstration shell exited,
its background service exited too; an initial post-demo connection failed. A
configuration-asserted detached normal CLI service was then started and the
post-restart checks passed. No implementation failure was hidden by these fixes.

### Review limitations and retained resources

These are synthetic controlled expiry delays and authored protocol/demo checks,
not native evidence or proof of every scheduler/network interleaving. The final
clock check precedes commit and response transport; it cannot promise token
validity after that boundary. The earlier graph outage/recovery, populated v4→v5
upgrade and exhaustive provenance-bound checks were not rerun in this review
follow-up; their original observed outcomes above remain historical evidence.
No new native observation, validated procedure, CLI/MCP context adapter or later
feature is claimed. Renderer-1 retry identities deliberately refuse and need new
keys; their immutable audit history remains available.

Containers, volumes, stores and ports remain the same assignment-owned resources
listed above. New synthetic projects, generated short-lived test tokens, review
state/results/transcript and source-digest files are under the same data/check
roots. A detached normal CLI service uses the explicit absolute assigned home;
its current PID is recorded in `data-root/service.pid` (50630 at verification).
Everything remains available for coordinator review; no retirement was performed.

Coordinator documentation requests now also include reconciling B's merged
`docs/memory-demo.md` statements that context selection is unavailable: after
integration, backend bounded preparation is implemented while CLI/MCP/native
context adapters and validated procedural reuse remain unavailable. Preserve the
existing N03/N04/N06 gates and B's truthful authored demonstration limitations.
PR 15 remains the single delivery/review location; the next action is coordinator
review and serial integration, not another feature in this worktree.

### Review commit and remote confirmation

Verified review source/docs/result commit:
`795ee849e17ad043b96ca93a2c9979e8964f0540`
(`Enforce release expiry and retain context qualifications`). The checked source
hashes still match that committed source. Explicit normal push to
`refs/heads/threadline/a-n02c-context-03` succeeded; `git ls-remote --heads`
confirmed that exact remote SHA. The subsequent handoff commit only tightens the
glossary wording and records these commit/remote facts; implementation source is
unchanged. The final handoff SHA is confirmed in PR 15's updated body and the
worker response, avoiding a self-referential commit hash in this file.

The existing [PR 15](https://github.com/kuriyaldivyanshu/falkorDB-Hackathon/pull/15)
remains open to `main`, with head branch `threadline/a-n02c-context-03`. Its body
is updated with the review changes, actual passing checks, integrated B baseline,
renderer-1 replay limitation and retained review resources. No second PR, merge,
force push, worktree removal or resource retirement is part of this handoff.
