# Development checklist: remaining Threadline work

Tracked execution checklist for the Codex-first memory product. It records what
is actually implemented and verified, not what is planned. Acceptance criteria
for remaining work live in this file; `docs/migration.md` and `docs/plans/` are
local working material (ignored) that may be absent in a fresh checkout and are
referenced only as background. Checked items require observed behavior recorded
here; detailed evidence paths below refer to local ignored logs, not files
shipped in a fresh checkout.

Legend: `[x]` verified with observed results, `[ ]` not done or not verified.
Owners: A = core/storage/contracts; B = client/native/package/CLI.
One editor owns shared files per parallel batch.

## 1. Completed baseline

- [x] **N00 source cut** — owned execution, provider and TUI removed; memory-only
  composition root and plain CLI; build passes.
  Local evidence: `docs/evidence/2026-10-17-n00-source-cut.md`.
- [x] **N01 storage foundation** — `threadline_memory` schema, forced RLS with a
  restricted role, owner bootstrap, project association, source append/dedupe/
  mismatch refusal, inspect/read/range, history paging, graph-outage history.
  Local evidence: `docs/evidence/2026-10-17-n01-storage-foundation.md`.
- [ ] **N00 native probe** — Codex version/configuration/hooks/MCP seam observed
  (N03, owner B).

## 2. N02 — graph memory and bounded context (current)

Dependency for every N02 batch: the verified N01 storage foundation (and, for
2B/2C, the verified 2A worker). Implement in N02A → N02B → N02C order, leaving a
buildable result at each boundary.

### 2A. Graph delivery and reconciliation (owner A)

- [x] SQL migration 2: `claim_operations` leased claim across tenants, executed
  by the restricted role, expiring leases reclaimable; `operation_backlog`.
- [x] Operations worker: bounded leasing with lease tokens and expiry, fair
  FIFO scheduling, bounded graph concurrency, per-project single in-flight
  write.
- [x] Trusted SQL-resolved graph routing (graph key/epoch from SQL only).
- [x] Project graph root initialization plus exact constraint/index readiness
  with explicit failed-constraint classification.
- [x] SourceAnchor registration for eligible `source.append` operations.
- [x] Atomic guarded commit: state + Event + OperationReceipt in one statement.
- [x] SQL settlement only after confirmed graph commitment.
- [x] Same-operation reconciliation after lost replies, lease loss and restart.
- [x] Graph-outage backoff with visible backlog; no settlement merely because
  FalkorDB is reachable (verified: operations stayed pending through an outage
  and settled only after a guarded commit).
- [x] Privacy/visibility guards: principal-private sources not admitted to
  project graph memory (verified live); epoch/privacy guard refusals are
  implemented but await their first real trigger (N05).
- [x] `operation.inspect` capability, route and bounded read.
- [x] Service robustness found during outage testing: a lost FalkorDB socket no
  longer aborts the process, and component readiness follows the live probe.
- Acceptance: eligible pending intents settle against real FalkorDB; duplicate
  delivery leaves one logical effect and receipt; ambiguous replies reconcile
  under the same identity; restart/outage preserve evidence.
  Local evidence: `docs/evidence/2026-10-17-n02a-graph-delivery.md`.

### 2B. Canonical memory and task services (owner A)

- [ ] Task create; task requirements bound to stable Memory identities.
- [ ] Semantic propose → explicit human accept → current query.
- [ ] Single accepted CURRENT version; correction supersedes without rewriting
  observation bytes; explicit contradictions.
- [ ] Observed episodes with honest outcomes; procedures with prerequisites and
  supporting evidence; no inferred root cause.
- [ ] Expected-version guards; inspectable operation receipts.
- [ ] `observed_under` kept separate from `applies_when`.
- Acceptance: source → proposal → explicit human acceptance → current query;
  correction replaces current authority without rewriting observation bytes;
  same-base conflicting updates have one winner; unavailable/unauthorized
  sources cannot support released memory; incompatible prerequisites exclude
  procedures and unknown outcomes remain unknown.

### 2C. Bounded context (owner A)

- [ ] One context-selection service shared by transports.
- [ ] Exact current task requirements; bounded applicable episodes/procedures/
  decisions; explicit applicability predicates.
- [ ] Current source visibility/availability rechecked; mandatory authority
  exact; explicit refusal on mandatory overflow.
- [ ] Metadata-only context manifest (a `context_manifest` Source) and truthful
  occurrence state; no persisted rendered plaintext.
- [ ] Limits: 4 KiB default / 8 KiB hard body, ≤8 optional memories, ≤64 source
  references.
- Acceptance: a packet contains exact current obligations and applicable
  sourced lessons within its bounds; changing freshness alone retains the UTC
  lesson; mandatory overflow/incomplete authority refuses; occurrence precision
  is honest; released context cannot reveal text from an unreadable source.

## 3. Readiness corrections (owner A)

- [x] `durableMemory` no longer derives from SQL/graph connectivity: it stays
  `false` until accepted-memory services exist, and `graphAdmission` reports the
  source-backed admission path (SQL + live graph probe + running worker).
- [x] SQL connectivity, schema readiness, source-history availability, graph
  connectivity (live probe), worker/backlog state and implemented capabilities
  are reported separately; qualified native capabilities remain `blocked` with
  their reason.

## 4. Memory-foundation review corrections (owner A)

Review corrections for the memory-foundation change set, made before merge. One
editor (owner A) held `packages/shared`, `packages/backend`, `packages/cli` and
the two product documents for this batch, because the fixes cross package
boundaries; the CLI edit is small (a shared timeout constant and one status
field) and is listed in the review summary for owner B.

- [x] Privilege model made explicit and verified against the actual function
  owners rather than assumed: `pg_proc`→`pg_roles` reports whether each
  cross-tenant `SECURITY DEFINER` owner can bypass forced RLS, setup and service
  start refuse an unsupported configuration naming the function and owner, and
  `privilegedSql` is reported as its own component. Verified in both
  directions: a superuser owner is accepted and ready; a `NOBYPASSRLS` owner is
  refused with `storage_unavailable` and reported as blocked rather than healthy.
  Forced RLS is unchanged — the privilege stays confined to the three named
  functions.
- [x] 64-bit counters no longer pass through a JavaScript number: privacy
  revisions, graph event heads, event sequences, backlog counts and operation
  attempts are decimal strings from Cypher (`toString(...)`) and engine integers
  on write (`toInteger(...)`). Verified with values above 2^53, including a
  refused privacy-revision guard and a replayed receipt.
- [x] Parent-source visibility applies to parent resolution as well as the child
  row, in inspection, reads and history; a readable child no longer discloses an
  unreadable parent's identity, and a new link cannot be established to a parent
  the caller cannot read. Verified with two principals against one project row.
- [x] `'stopping' as ServiceState` removed; shutdown reports the states that
  exist.
- [x] Readiness for graph admission comes from the live worker probe (no
  startup-probe fallback), and an unusable privileged SQL path is detected as
  blocked rather than reported as healthy admission.
- [x] Unauthenticated liveness kept minimal (`/health`); `/v2/status` and
  `/v2/capabilities` require a credential. With no usable store the service
  cannot verify a credential and answers a typed `storage_unavailable` naming the
  reason, so operational detail is never served to an unauthenticated caller.
- [x] Decimal-string validation is a real int64 range check using `BigInt`
  (digit-count reduction is insufficient); the refinement is total, so a
  malformed value is rejected instead of throwing out of a schema parse.
- [x] Same-batch cleanups: inert config knobs removed (retry/quarantine stays
  recorded as an open follow-up below, unimplemented), operation-state schema
  reused, duplicate schema/helper removed, route constants reused in the
  transport (with its not-found behaviour documented as implemented), the claim
  function's returned columns narrowed to the facts the worker reads and its
  misleading payload comment corrected, command documentation corrected.
- [x] Additive migration 3 narrows `claim_operations` by dropping and recreating
  it; applied migrations 1 and 2 are not edited and their checksums still verify
  over an existing ledger (verified against a v2 database in place).
- [ ] Not verified in this batch: service-level second-principal isolation over
  HTTP with a real second credential (the visibility check drove the real service
  with constructed scopes; an isolated credential path remains the follow-up in
  section 5); the epoch/privacy graph guards still await their first real trigger
  (N05); retry/quarantine remains unimplemented.
  Local evidence: `verify-privilege-model.mjs`, `verify-counter-precision.mjs`,
  `verify-parent-visibility.mjs`, `verify-readiness.mjs`, `verify-routes.mjs`
  under `/private/var/folders/dy/9qvjrrmx3gx14gy0r67z1ygm0000gp/T/opencode/`, plus
  the applied v3 migration and privileged-model report from `npm run setup` and
  the live `/health`, `/v2/status`, `/v2/capabilities` responses.

## 5. Known follow-ups

- [ ] Service-level second-tenant and second-principal isolation over HTTP via an
  isolated authorized credential path (SQL-level RLS alone is not service
  evidence). Owner A, before N05.
- [ ] Bounded unreferenced-object sweep for source files left by rejected
  appends; only with reconciliation-aware references, never guessed-dangling
  deletion. Owner A, with N05.
- [ ] Operation retry/quarantine policy beyond capped backoff (current: retry
  with capped backoff; attempts cap not enforced as quarantine). Owner A, with
  N04 concurrent correctness.
- [ ] `projects.next_source_seq` is a last-allocated high-water mark despite its
  name; rename only if a schema revision requires it.
- [ ] Graph-reset repair: rejected epoch-mismatch source intents are explicit;
  re-admission after a privacy purge lands with N05.

## 6. Remaining roadmap (one line each; tracked status here)

- [ ] **N03** actual Codex session-to-session memory slice: native qualification,
  hooks, stdio MCP tools, enrollment/binding (owner B with A).
- [ ] **N04** handoffs, procedure reuse and concurrent correctness (claims,
  same-base CAS under concurrency, procedure validation).
- [ ] **N05** selected history, retention, erasure and export (deny-first
  deletion, privacy barrier, orphan sweep, export).
- [ ] **N06** package, clean installation and demo evidence.
- [ ] **N07** final consistency and release review.
