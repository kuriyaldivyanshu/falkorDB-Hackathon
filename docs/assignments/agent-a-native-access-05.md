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

Reserved, not started. Record resolved worker base SHA, worktree/branch/clean
state, behavior, files, migrations, exact verification, limits, final head/remote,
real PR URL and retained resources here before claiming completion. N03 remains
open after this assignment: visible capture and native runtime qualification
still require their own integration and authorization.
