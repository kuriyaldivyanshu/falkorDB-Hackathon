# Agent A: native enrollment and session access foundation

## Mandatory workflow

Follow AGENTS.md and docs/parallel-work-rulebook.md in full. Read the assigned
tracked task file before editing. Use only its named worktree/branch, writable
paths and resources. Finish the declared checkpoint, verify it, commit/push that
feature branch and open one PR. Keep later features out of that worktree; review
fixes stay with the same PR. The coordinator handles merges and retirement.

## Identity, base and creation gate

- Assignment: `a-native-access-05`; owner A; milestone N03, assignment round 05.
- Outcome: safe owner-approved native enrollment plus provisional session
  registration/pinning over authenticated HTTP, ready for a later capture adapter.
- Baseline feature main: `8a83b57ac9cc003e5c86331dcdc9a3d9b14193d4` (PR #17/#18).
  This preparation PR must merge first. Fetch origin, fast-forward a clean main,
  resolve its literal SHA and verify it includes this contract. Record that SHA
  in the result before source work; do not substitute an unmerged peer branch.
  If an unexpected feature/migration has landed, report the changed prerequisite.
- Reserved branch: `threadline/a-native-access-05`; worktree:
  `/tmp/threadline-a-native-access-05` (canonical `/private/tmp/...`). Create fresh
  from that literal main SHA, verify names unused and no main upstream.
- Remote: `git@github-personal:kuriyaldivyanshu/falkorDB-Hackathon.git`; PR base
  main. Own npm ci, normal commit/push/one PR authorized. Merge, main push,
  force push, cleanup, new milestone and public package publication remain out.

## Read first

Read README, CONTEXT, development checklist, rulebook, docs/access.md,
docs/context.md, docs/native-integration-contract.md, docs/storage-recovery.md
and the completed A/B round-04 records. Inspect shared identity/access/source/
context contracts and backend auth, permissions, projects, sources, context,
access, API composition, SQL schema/migrations and privilege checks.

`/Users/dkuriyal/Desktop/falkorDB-Hackathon/archive/codex` is optional read-only
source reference. Search focused native identity/hook/MCP implementation files;
do not copy its runtime, dependencies or execution architecture into Threadline.
It is a snapshot, not evidence about the installed binary. Compare relevant
claims with current official docs and existing qualification records. No real
native inference, configuration, trust, account or transcript access is authorized.

## Ownership and isolated resources

Writable:

- `packages/backend/src/**`, narrowly for enrollment/auth/session enforcement.
- `packages/shared/src/identity.ts`, optional new `native-access.ts`, protocol,
  capabilities and index exports. Preserve existing context/source/memory/task
  wire behavior; add only the required native access contracts.
- CONTEXT.md, new docs/native-access.md and this assignment record.

Frozen: all CLI source, README and existing operator/native guides, checklist,
rulebook, fixtures, archive, dependencies/manifests/lockfile, build/Compose config,
native qualification/schema assets and B's worktree. Report the smallest needed
ownership crossing; do not change it silently. Coordinator reconciles shared
status; B owns its client documentation.

Resources: HTTP 47862, PostgreSQL 55472, FalkorDB 56472, all loopback; prefix
`threadline-a-native-access-05-`; data `/tmp/threadline-a-native-access-data-05`;
installation `<data>/home`; checks `/tmp/threadline-a-native-access-05-checks`.
Verify unused names/ports before creation. Use fresh synthetic stores, generated
credentials and explicit absolute --home for every init/serve/CLI invocation.
Assert resolved home/source root/database/ports before mutations. Preserve
resources after delivery; existing volumes/data are not reusable scratch space.

## Product decisions for this checkpoint

### 1. Stable enrollment is separate from its bearer

Implement owner-only issue/list/revoke for an enrollment tied to one existing
active project workspace binding. Recommended routes:

```text
POST /v2/projects/:projectId/enrollments
GET  /v2/projects/:projectId/enrollments?limit=50
GET  /v2/projects/:projectId/enrollments/:enrollmentId
POST /v2/projects/:projectId/enrollments/:enrollmentId/revocation
POST /v2/native-sessions
GET  /v2/projects/:projectId/sessions
```

Use one shared route definition per served endpoint. Owner administration needs
human_admin plus a stored current owner grant rechecked in the transaction,
following the access service's authority locking and expiry pattern. An issue
request names only bindingId, bounded label, explicit idempotencyKey and optional
lifetime. Server derives tenant/principal/project/role/token kind/permissions.
The binding must belong to that project and be active; a supplied path grants
nothing and no caller chooses graph routing or private filesystem access.

Collection listing, issuance and revocation are owner-only. The single-enrollment
GET permits either that human project owner or the authenticated producer bound
to exactly that stored enrollment, returning only bounded authorized metadata.
This is the pre-pin self-inspection path; it does not widen collection access.

Create a dedicated service principal with a reader grant and a producer token.
Producer-specific policy grants only the registration/read/audit actions below;
neither a member grant nor token kind may create a knowledge-write bypass.
Define these explicit producer permissions before applying the generic reader
grant guard; the registration exception authorizes no other write.
Use fixed expiry: 24-hour default, seven-day maximum, one-second minimum,
idle deadline equal to absolute and never sliding. No renewal or silent refresh.

Store only a hash of the random opaque bearer. First issue returns it once with
no-store; exact actor/project/key retries recover original metadata without
redisclosure, and changed requests refuse. Concurrent retries create one effect.
Lost-secret recovery is revoke plus fresh issuance key. Metadata never returns
bearers/hashes and is bounded (default 50, max 100, explicit hasMore).

### 2. Pin once; replacement is explicit

The owner-issued enrollment starts at server-defined generation 1 and unbound.
Generation is immutable in this checkpoint. One producer bearer may register
one session for that generation; require expectedBindingGeneration and an
explicit request key. Registration/pinning is one fenced SQL transaction with
locked enrollment/token state and a uniqueness/CAS guard. Identical retries
return the same identity; competing different instances have one winner and
an explicit refusal. Never silently replace the binding or infer a fork.

Derive enrollment/binding/principal from authentication. A bounded adapter
instance nonce may identify the requested instance; derive its stored scoped
fingerprint on the server. Native thread/parent references remain reported
hints. Store server-granted identityPrecision provisional and captureCoverage
unknown. Refuse caller requests for strong identity or supported coverage.
Capture is not implemented, so registration proves no observed conversation.

There is no rebind/rotation endpoint here. To replace an instance, the owner
revokes its enrollment and issues a fresh enrollment/credential. This avoids
claiming old-process exclusion from merely changing a row under a shared bearer.
Document the fixed generation and current integer range honestly; preserve
decimal-string handling for actual int64 counters. An expected generation
mismatch always refuses.

### 3. Narrow producer authorization end to end

Before pinning, allow only self-enrollment inspection and self-registration;
other reads/context refuse. After pinning, permit authorized project reads and
the producer's own context audits. Owner may list project sessions; producers
see only their own enrollment/session. Readers do not administer native access.

Keep source append, memory/episode/task mutations, grants, access administration,
claims/handoffs and caller-created strong identity unavailable to producers.
The permission boundary must apply to direct HTTP and core service entry points.
Capture admission is a later bounded service, not a broad knowledge.write grant.

Authentication and final context release/replay must validate active token,
principal, project grant, enrollment, workspace binding, pinned session and
matching generation. Expiry/revocation committed before the final authorization
statement prevents release, consistent with the existing SQL boundary. Closing
a session cannot leave its producer usable. Preserve the reader path unchanged.
Reported native IDs, cwd, timestamps, process IDs and MCP arguments never supply
identity proof. Preserve native_observed refusal and model-mutation disablement.

Prevent existing human/source code from attaching a foreign principal's session
to an append or audit. Validate ownership/state/binding/generation for any
accepted nativeSessionId. Do not claim native capture ordering from the currently
null source session_seq column.

### 4. Additive SQL migration 7; no graph reset

Introduce explicit enrollment storage and correct native_sessions.enrollment_id,
which currently references client_tokens.id. Prefer named constraints, scoped
foreign keys, fixed generation/pinning uniqueness and forced RLS. Preserve the
three narrow privileged functions and restricted app role. Keep migrations 1–6
byte-identical; no new broad definer privilege or RLS weakening.

Inspect legacy rows before adding constraints. For supported consistent rows,
perform an explicit deterministic backfill. Unexpected producer/session rows
must cause an actionable refusal with atomic rollback rather than deletion,
invented enrollment authority or partial schema publication. Verify both cases.
All active token-to-enrollment/session checks must use the new identity.
No FalkorDB schema or accepted-memory shape changes are required for SQL-owned
access metadata. Do not fabricate graph receipts for enrollment operations.

## Documentation and verification

Write docs/native-access.md with complete owner HTTP issue/list/revoke and
producer registration examples, safe exclusive 0600 bearer-file handling,
one-time delivery/recovery, fixed generation/replace semantics, permission matrix
and precise provisional/unknown limitations. Add accurate API capability entries
without claiming capture or a qualified Codex adapter. Update domain terminology.
Name the integration work needed later; create no credential CLI in this PR.

Use temporary checks outside Git against your real isolated SQL/FalkorDB:

1. Owner issue/list/revoke, no-store/one-time secrets, identical/changed/concurrent
   retries, output hygiene and lost-response recovery.
2. Reader/member/producer administration denial, cross-project/tenant/principal
   refusal, no arbitrary binding/generation/strong/coverage privilege escalation.
3. Pre-pin restrictions; concurrent different first registrations have one
   winner; same registration retry stable; second identity refuses.
4. Bound producer reads and own context audit; direct source/knowledge/task/admin
   writes denied; foreign session attribution denied; no native-observed upgrade.
5. Expired/revoked enrollment, binding, grant, session and token refuse including
   controlled final context release/replay. Record statement-boundary limitations.
6. Existing API-issued reader context/occurrence and human memory/task/episode
   workflows remain usable. Graph outage preserves SQL access metadata and
   history while graph-dependent context fails closed and recovers.
7. Populated v6→v7 upgrade, prior checksums/data preserved, legacy native-row
   handling/refusal, forced RLS under the actual restricted role.

Run own npm ci and npm run build, scope/diff/secret and Markdown checks. No
permanent tests or real native turn. Record actual pass/fail counts and limits,
commit/push the feature ref normally, verify remote SHA and open one PR. Keep
resources/worktree for review. Coordinator merges serially; B has no dependency
on this API for its context-only checkpoint. After the other PR merges, merge
current main normally and rerun affected build/auth/CLI compatibility checks.

## Result record

### Creation gate and scope

Checkpoint implemented and verified. Base is merged PR #19 at full SHA
`e5b2e73598eaf6eb52abb01d26d35f772c8d7712`. Clean main was fetched and
fast-forwarded; local/remote branch names and the reserved worktree path were
unused. Created `threadline/a-native-access-05` at canonical
`/private/tmp/threadline-a-native-access-05` from that literal SHA, verified
clean HEAD and no upstream. Reserved ports, container/volume prefix, data and
checks roots were unused before resource creation. Origin main still resolves
to that same checkpoint at final pre-delivery fetch.

Changed 24 allowed paths: backend API/composition/capabilities, authentication,
permissions, existing access-owner helper, source/session attribution,
memory/task/project/operation read guards, new nativeAccess/nativeAuthority
services, SQL schema and safe migration refusal classification; shared identity,
new native-access contracts, exports/routes/capabilities; CONTEXT.md, new
[operator guide](../native-access.md) and this record. CLI, README, existing
operator/native guides, checklist, fixtures, archive, manifests, lockfile,
build/Compose configuration and B's worktree remain outside this diff.
No dependency, permanent tests, graph schema or native configuration was added.

### Implemented behavior

- Stable SQL enrollment identity is distinct from its bearer identity. Owner
  issuance selects an existing active project workspace binding and creates a
  dedicated service principal, reader grant and restricted producer token.
  Caller tenant/principal/project routing, role, token kind and paths cannot
  supply authority. Owner issuance/list/revoke and project-session listing
  recheck current human administrator plus owner authority transactionally,
  reusing the existing access service's row-lock and expiry pattern.
- Metadata lists default to 50, maximum 100, newest first with hasMore.
  Single-enrollment inspection permits only its project owner or exact producer.
  Bearer is delivered once with no-store; only its hash is retained. Scoped
  exact/normalized retries recover metadata without secret; changed requests
  refuse, and eight concurrent exact requests had one effect/one secret.
  Lost-secret recovery is revoke then fresh issuance/key.
- Fixed 24-hour default, seven-day maximum, one-second minimum. Idle equals
  absolute expiry, with no authentication-side sliding, refresh or renewal.
  Generation is fixed at 1; the expected-generation wire guard uses the SQL
  integer range, while actual int64 counters retain decimal strings.
- One fenced pin transaction locks the enrollment and current access rows,
  derives the scoped nonce fingerprint, checks explicit key/generation, inserts
  one provisional/unknown session and conditionally pins enrollment/token.
  Six competing different registrations had exactly one winner; six identical
  retries returned the same session. Changed hints under the same key refuse.
  Strong identity/coverage and caller identity/routing overrides refuse.
- Before pinning a producer can only inspect its enrollment and register.
  After pinning it can perform project reads and its own context audits, naming
  its pinned session. Producer public source/memory/episode/task/admin writes
  are denied through HTTP and core services. Human source append validates
  principal, session, enrollment, binding, generation and access state even
  before duplicate return; a foreign session cannot be attached to an append
  or context audit. Existing source session_seq remains null.
- Authentication and final context preparation/replay use one shared producer
  authority predicate. Current token/principal/grant/project/enrollment/binding/
  session/generation and advancing expiry are rechecked in the final release
  statement. Occurrence updates and their retries also recheck before commit.
  Closing a session invalidates its producer. Revocation closes its pin and
  revokes its token/grant/dedicated principal without taking the context lock.
  Replacement always requires fresh enrollment; shared bearer replay does not
  prove exclusion of another process.

### Migration 7 and legacy decision

Additive migration 7 creates forced-RLS native_enrollments and scoped enrollment,
credential and session foreign keys, including the corrected session enrollment
FK formerly targeting client_tokens. A unique generation pin and conditional
update guard registration. Migrations 1–6 are byte-identical to base and their
ledger checksums/rows remain unchanged. The restricted application role and
exactly three existing narrow definer functions remain; no new definer privilege
or graph reset exists.

No released v6 API could approve native enrollment. Supported populated human,
reader and source rows need no native backfill. Every legacy producer/session
or token carrying native identity is therefore explicitly unsupported and causes
an actionable schema_incompatible refusal with atomic migration rollback.
The verifier retained an internally linked legacy producer/session fixture and
confirmed all rows/ledger/old FK survived and no new enrollment table appeared.
No invented owner authority, deletion or automatic legacy reauthorization occurs.
An operator must review such a preserved database before retrying migration.

### Actual verification

Own npm ci and npm run build passed using the unchanged lockfile. Build was
repeated after the last source edit. Ordinary shell used Node v22.16.0;
approved runtime verification shells resolved Node v23.11.0 (both satisfy >=22).
All focused programs are outside Git in
`/tmp/threadline-a-native-access-05-checks`; generated credentials and identities
are private under `/tmp/threadline-a-native-access-data-05`.

Final relevant runs: **205 grouped assertions passed**, plus builds, initial
explicit-home upgrade and final static/documentation audits:

- `node .../verify.mjs` → `verify-final.log`: **144 passed** over actual HTTP
  and core services. Owner issue/list/inspect/revoke, no-store/hash-only metadata,
  exact/changed/concurrent retries, fixed deadlines, bounds/strict overrides,
  owner/member/reader/producer/foreign tenant/project/principal denials,
  pre-pin core/HTTP read restrictions, six-way pin competition/stable retries,
  scoped reads/audits/occurrences, foreign and duplicate source attribution
  refusal, native_observed refusal, human source/task/proposal/accept/requirements/
  episode workflows, reader context regression, lost-secret/fresh replacement,
  actual short expiry, forced RLS/restricted role and only three definer functions.
- `node .../release.mjs` → `release-final.log`: **22 passed** using real SQL/
  FalkorDB with controlled graph-read pauses in a temporary core composition.
  Fresh preparation and replay both refused enrollment/binding/grant/grant-role/
  principal/session/token changes and advancing real expiry at the final graph
  read; no additional manifest/occurrence committed. Actual owner HTTP revoke
  committed during pre-publication selection in both paths and prevented
  release. Stale authenticated generation and SQL generation mutation refused;
  valid reader and owner context still worked. Individual state changes after
  audit insertion were synthetic SQL controls, distinguished from owner API
  revocation. No claim of an uncontrolled production race.
- `node .../migrations.mjs` and `node .../migration-refusal.mjs`:
  **9 passed** (five populated-upgrade assertions, four final legacy assertions).
  Populated v6 owner/project/binding/API-issued reader/source/operation rows and
  prior checksums survived v7 byte-for-byte; reader history/bytes and issuance
  retry stayed usable. Actual restricted-role reads without tenant context
  returned nothing. Legacy failure and repeated failure preserved all rows,
  ledger and old FK atomically. Fixture databases remain available for review.
- `node .../outage.mjs` → `outage-final.log`: **9 passed**. An established graph
  read preceded stopping only the assigned graph container. Context failed
  closed with no body; SQL enrollment inspection, history and even new native
  issuance/registration remained usable. Restarting that graph recovered current
  reads/context with the same final service PID **97527**, without service restart.
- `node .../operator.mjs` → `operator.log`: **12 passed** by extracting and
  executing the exact JavaScript in the guide: issue/list/inspect/self/register,
  stable retry, owner/own sessions, revoke, exclusive overwrite refusal, actual
  0600 raw bearer file, metadata-only output and lost-secret retry refusal.
- `node .../clients.mjs` → `clients.log`: **9 passed**. Existing CLI prepare,
  stable replay and explicit occurrence worked with an API-issued reader.
  Authored stdio MCP initialization retained six default tools/seven opt-in,
  current memory reads, exact context authority and stable audit retry. Every
  CLI launch used explicit absolute --home; this proves transport compatibility,
  not installed Codex model use.
- `python3 .../final-audit.py`: full-base allowlist including untracked files,
  unchanged migration 1–6 bytes, three Markdown files' one-H1/hierarchy/balanced
  labelled fences/local links, generated-credential/log hygiene and
  git diff --check passed. External SHA256SUMS.txt records scripts/log digests.

Initial verification/setup issues were corrected transparently: the first v6
fixture omitted the restricted app login before init's preflight (no v7 change
had occurred); an occurrence report omitted its required reporting boundary;
a legacy FK assertion expected a schema-qualified regclass display despite an
active search_path. These were temporary checker inputs/assertions, not product
successes. A user-rejected final service restart was retried after explicit
user correction, reidentifying the owned process first. Network/Docker/Git
sandbox refusals were retried through the supported approval route. Review also
moved native attribution validation ahead of duplicate source returns and reran
the affected final build/access/release checks. No failing product check remains.

### Limits, resources and coordinator handoff

The final SQL statement snapshot remains the access consistency boundary.
Revocation committed before it prevents release; later changes/expiry, commit
latency and network transit remain outside the guarantee. Ordinary row locks
may delay revocation; blocked is not committed. Already released bytes cannot
be recalled. Rolled-back source publication may leave immutable metadata orphan
files under the existing storage model; no sweep was added.

No live Codex inference, native account/transcript access, native configuration,
capture, strong identity, model memory mutation, claims/handoffs or later
privacy feature was implemented or qualified. Reported version/thread/parent
values and nonce replay do not identify an exclusive process. The
[official hook documentation](https://learn.chatgpt.com/docs/hooks) was searched,
opened and checked on 18 October 2026: parent IDs for subagent hooks and unstable
transcript format are consistent with retaining the existing qualification gates.
The archive was not needed for this SQL access foundation and was not modified.

Retained resources: `threadline-a-native-access-05-postgres` (55472) and
`threadline-a-native-access-05-graph` (56472), corresponding `-pg-data` and
`-graph-data` named volumes, service PID **97527** on 47862. Reidentify before
later control; `/tmp/threadline-a-native-access-data-05/service-pid` records the
current service. Database names: threadline_a_native_05, its _upgrade fixture
(on v7), and _legacy fixture (intentionally still v6 after atomic refusal).
Installation/source root is the explicit absolute
`/tmp/threadline-a-native-access-data-05/home` and its sources child.
Credential-bearing fixtures remain private in that data root; temporary checks,
safe logs and evidence digests remain in the assigned checks root. Temporary
verifier pools and MCP processes exited. Peer/shared resources were untouched.

Implementation commit `bcd735e448fc59091be1575242670cd2183dbe36` was pushed
normally to the exact assigned feature ref, and git ls-remote confirmed the same
SHA. One [review-ready PR #21](https://github.com/kuriyaldivyanshu/falkorDB-Hackathon/pull/21)
was created through the existing authenticated GitHub browser (gh is unavailable),
with visible base main, head threadline/a-native-access-05 and Open status.
This delivery-only record update changes no tested source/configuration. Final
HEAD and remote confirmation belong in the PR/handoff, avoiding a
self-referential commit hash here. Retain worktree/resources for review. Coordinator owns serial
integration, any shared-guide/checklist reconciliation and eventual retirement.
If B merges first, normally merge fresh main here and rerun affected build/auth/
CLI compatibility before integration. No dependency on B's unpublished work was
introduced. N03 remains open for permitted capture and native runtime qualification.
