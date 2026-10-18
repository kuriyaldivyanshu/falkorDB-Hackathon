# Agent A: supported project reader credentials

## Contract

Follow AGENTS.md and [the parallel work rulebook](../parallel-work-rulebook.md).
Read this tracked assignment before source edits. One checkpoint, worktree,
branch and PR; the coordinator merges and retires resources.

- ID: `a-reader-access-04`; owner: Agent A.
- Outcome: project owners issue, inspect and revoke project reader credentials
  without sharing installation owner credentials or manually provisioning SQL.
- Checkpoint: backend issuance/enforcement/revocation API, operator guide and
  real issued-credential authorization verification. N03 remains incomplete.
- Base: `origin/main`, verified after fetch at literal
  `78e1960b1844e20af23b05bb6bfca8f960a1316f`.
- Branch: `threadline/a-reader-access-04`; canonical worktree:
  `/private/tmp/threadline-a-reader-access-04` (requested `/tmp/...`).
- Remote: `git@github-personal:kuriyaldivyanshu/falkorDB-Hackathon.git`;
  PR base `main`. Normal commit/push and one PR authorized; no merge/force push.
- Dependency: existing v5 backend/context contracts on base; independent of B's
  client work. Integration only after complete verification and coordinator review.

## Ownership

Writable: `packages/backend/src/**` only for this checkpoint;
`packages/shared/src/identity.ts`, new `access.ts`, `protocol.ts`,
`capabilities.ts`, `index.ts`; `CONTEXT.md`; new `docs/access.md`; this record.
All other paths are read-only, especially CLI, existing memory/task authoring
contracts, shared context wire contracts, manifests/lock/build/compose files,
README/existing guides, checklist/rulebook, fixtures and other worktrees.
Report the smallest necessary crossing before making it. Migration 6 is reserved
here if necessary; preserve migrations 1–5 exactly. No graph schema change.

## Resources

- HTTP `127.0.0.1:47852`; PostgreSQL host `55462`; FalkorDB host `56462`.
- Container/volume prefix `threadline-a-reader-access-04-`.
- Data `/tmp/threadline-a-reader-access-data-04`; explicit installation
  `/tmp/threadline-a-reader-access-data-04/home`.
- Temporary checks `/tmp/threadline-a-reader-access-04-checks`.
- Check availability/ownership before use; assert absolute home, source root,
  database and ports before mutation. Fresh synthetic stores/generated secrets.
- No real native configuration, inference, shared stores or peer resources.
  Keep resources for coordinator review/retirement.

## Acceptance

Implement shared access routes and strict bounded request/metadata contracts.
Only active human administrators with current project owner grants administer
credentials, rechecked in mutation transactions. Generate opaque bearer/hash
with existing primitives; dedicated service principal, reader grant and distinct
project-bound reader kind. Default absolute lifetime 24h, maximum 7d; document
idle expiry. Explicit actor/project scoped issuance key: exact retry returns
metadata without bearer, mismatch refuses; never revive/recreate/extend on retry.
No plaintext/hash in metadata/logs/errors; initial response uses no-store.

One permission policy must enforce every served route: project metadata and
memory/task/source/history reads, context preparation and own occurrence reports
only. Deny source append, memory/episode/task/project/access/native mutations and
cross-project/tenant use. Internal metadata audit publication must reuse source
storage through trusted service code, without an HTTP internal flag loophole.
Preserve context wire, selection/privacy/replay/expiry/rendering guarantees.
Final release uses advancing time and current credential/grant/project checks;
revocation committed before that check blocks release. No recall of delivered bytes.
Preserve forced RLS, restricted application role and narrow privileged lookup.

Write authoritative `docs/access.md` with safe authenticated Node workflow:
owner credential read locally, reader written exclusively with mode 0600,
metadata/path printed without secret, explicit token-file MCP usage, one-time
secret/lost-response recovery, expiry and revocation consistency.

Run own `npm ci`, workspace build, temporary checks outside repository, no
permanent tests. Exercise owner issue/list; issued-reader reads/MCP; every denied
mutation category over HTTP; wrong project/tenant; no native identity; retries,
lost response, repeat revocation, idle/absolute expiry, in-flight expiry/revocation,
audit versus public append, occurrence token isolation, secret hygiene, RLS and
v5 populated upgrade if v6 added; regress owner/memory/episode/context paths.
Check docs structure/links and full diff/scope; stage explicit paths. Record exact
results and limits. Push assigned feature ref, confirm remote SHA, open/verify
one real PR base/head. No auth tool installation/credential borrowing/probe issues.

## Result

Checkpoint implemented and verified on the assigned feature branch. N03 stays
incomplete. Bootstrap commit `0b32245` preceded implementation. The coordinator
checkout was clean; fetch confirmed the literal expected origin/main SHA. The
reserved local/remote branch and canonical path were absent. Worktree branch,
HEAD, clean state and absence of a main upstream were verified before edits.
Own `npm ci` passed with the existing lockfile (Node v22.16.0); no dependencies,
CLI, manifests, build configuration, fixtures or frozen operator guides changed.
No ownership crossing was needed.

### Implementation and contracts

- Added strict shared reader issuance/metadata/result contracts, one route
  definition per endpoint and three supported access capability operations.
- Owner API issues a dedicated service principal, reader grant and distinct
  `reader` token, lists newest bounded metadata (default 50, maximum 100,
  `hasMore`, no cursor) and revokes the named token/dedicated grant/principal.
  Human administrator plus current owner authority is checked in each SQL
  transaction; shared locks preserve stored administration authority through
  mutation commit. Caller identity/routing/scopes are never accepted as input.
- Actor-principal/project/key digest serializes issuance. Exact retries return
  original metadata with `secretDelivery: not_repeated`; changed requests
  refuse. Only first issuance returns the random opaque bearer, with no-store;
  SQL retains its hash only. No operation or recoverable secret job is created.
- Fixed 24-hour default, seven-day maximum, one-second minimum lifetime. Idle
  equals absolute expiry, never slides, and no refresh/renewal exists. Revoked
  or expired retries retain state/identity/deadline and cannot recreate access.
- One permission policy denies reader tokens AND reader grants knowledge and
  administration writes. It is used at HTTP and service mutation boundaries.
  Project listing filters project-bound tokens to their stored project even if
  another grant exists. Readers cannot inspect installation status/backlog;
  global build capabilities remain readable.
- Source publication uses one common implementation. Public append requires
  knowledge-write permission. A separate trusted method validates metadata-only
  context manifests and creates the standard source/intent inside the existing
  transaction. Public `kind=context_manifest`/`internal` inputs cannot bypass
  source-write authorization. No context wire contract changed.
- Context release retains the final advancing-clock query and now explicitly
  rechecks reader role/service-principal/project binding. Occurrences stay
  isolated by exact principal AND token and remain self-reported. Native
  observation, enrollment and session registration are still unavailable.
- Added authoritative [access guide](../access.md) with complete authenticated
  Node issuance/list/revocation workflow, exclusive 0600 output, explicit home,
  one-time-secret recovery and existing MCP token-file inputs. Updated domain
  terminology in CONTEXT.md. Raw internal error messages are omitted from HTTP
  diagnostics to prevent accidental secret-bearing messages reaching logs.

### Schema decision

Migration 6 is additive: it adds the reader kind/checks (project required,
no enrollment/session/MCP identity/wider scopes, idle deadline capped), a scoped
issuance catalog with tenant/project/token/principal/grant foreign keys and
actor/project/key uniqueness, and forced RLS on that catalog. Request/key
values are digests; plaintext bearer is absent. Applied migrations 1–5 match
the pinned base byte for byte and their existing ledger checksums passed during
upgrade. The restricted role and original three privileged functions remain;
there is no new definer function, graph schema change, reset or graph receipt.

### Verification

All final runs passed. Scripts/logs are external under
`/tmp/threadline-a-reader-access-04-checks`; no permanent tests were added.

- `npm ci`; `npm run build` (`tsc -b`, repeated after the last source edit):
  passed. Last edits only made shared exports explicit and clarified a comment;
  the exported API is unchanged from the runtime matrix.
- `node .../upgrade.mjs`: guarded explicit-home setup first constructed and
  populated a fresh v5 ledger with real owner/project/source services, then
  applied v6 through installation setup. Existing tenant, owner, two projects,
  source and migrations 1–5 checksums survived; restricted role verified.
- `node .../http.mjs` (`http-final.log`): **84 passed**. Real API issuance and
  concurrent exact retries, one-time delivery/no-store, normalized request
  mismatch, strict override refusal, bounded list, real issued reader
  project/history/source/memory/task/requirement reads, and direct HTTP denial
  of source append, proposal, acceptance, correction, episode, task creation,
  requirement binding, project association, grant listing and all access admin
  operations. Unsupported native session/enrollment routes refused (501),
  without creating native identity. Wrong project/tenant and scoped revocation
  refused; a human member could not issue. Owner task/proposal/acceptance/
  requirement/correction/episode/context paths committed against real stores.
  Reader preparation created a metadata-only manifest, replay retained identity,
  own occurrence reported emission, another token for the same principal was
  denied report/replay, and native_observed refused. Lost-response recovery,
  repeated revocation, no resurrection, absolute/idle expiry, no sliding expiry,
  forced RLS/restricted-role reads and no plaintext bearer/hash in normal
  responses, metadata, operation inspection or service logs passed.
- `node .../mcp.mjs` (`mcp-final.log`): **three scenarios passed**. Authored
  stdio initialization, exact six-tool listing and real memory/source reads
  using the API-issued replacement bearer file, with both `--token-file` and
  `THREADLINE_MCP_TOKEN_FILE`; wrong-project startup refused. Every launch used
  the explicit assignment home. This is transport evidence, not native Codex
  model use.
- `node .../races.mjs` (`races-final.log`): **17 passed** using actual HTTP and
  real SQL/graph stores with controlled graph-read pauses. Fresh preparation
  crossed absolute expiry, idle expiry, committed revocation, revoked grant and
  reader-role change; replay crossed idle expiry. Final authorization refused
  with no additional committed source/occurrence. Authenticated owner revocation
  committed during a paused selection. Additional isolated SQL updates placed
  token/grant/role changes exactly after audit insertion and before the final
  advancing-clock query. A stale preauthenticated owner call was denied inside
  the issuance transaction; valid reader context still released afterward.
- `node .../operator.mjs` (`operator.log`): **five scenarios passed** by
  extracting and executing the exact documented JavaScript. Initial issuance
  saved the actual bearer exclusively with 0600 and printed metadata/path only;
  accidental overwrite refused, exact retry refused secret reconstruction,
  list worked and revocation worked.
- `node .../storage.mjs` (`storage.log`): **13 passed**. Database constraints
  refused missing project, wider scopes, native session, enrollment, idle past
  absolute expiry and foreign-project catalog binding. Original privileged
  owners verified and exactly three definer functions remained. Explicit/default
  24-hour requests deduplicated, missing/empty key and zero lifetime refused,
  and restored normal service reported schema 6 with SQL/privilege readiness.
- Markdown H1/hierarchy, labelled balanced fences and local links passed for
  CONTEXT.md, access guide and this assignment. Full diff/scope and
  `git diff --check` passed; secret scan and staged review are delivery gates.

Initial verifier failures were corrected before final runs: generated module
paths needed backend `dist/src`; v5 setup omitted the app login role; history
uses `entries`; secret hygiene must exclude the initial issuance envelope; and
MCP verification initially extracted its bearer from the wrong wrapper. These
were temporary verifier/setup errors. No product failure remains from those
runs. Sandbox network/Docker/Git restrictions were rerun through approval.

### Limits and release boundary

The final SQL authorization statement snapshot is the access consistency
boundary; committed revocation before it prevents release. Revocation does not
acquire the context advisory project lock, but ordinary project-row locks can
serialize administration with audit publication. A waiting revocation is not a
committed revocation. Changes after the final statement begins, later expiry,
SQL commit latency and bytes already returned are outside recall guarantees.
The race verifier distinguishes authenticated HTTP revocation during selection
from synthetic SQL updates placed immediately before final release.

No native configuration/inference, capture, enrollment, strong session identity,
claims, handoffs, procedure validation, privacy lifecycle or general account
management was implemented or qualified. Existing context selection/privacy/
expiry/replay/rendering contracts stay unchanged; this checkpoint does not
repeat every earlier selector adversarial case or make a load proof. Metadata
listing is bounded without paging; keep returned credential IDs for later
revocation. Revocation targets its issued dedicated principal; the second token
used solely for occurrence isolation was explicit synthetic SQL verification
setup, not the supported issuance path.

### Resources and recovery

Owned running resources retained for coordinator review:
`threadline-a-reader-access-04-postgres` (127.0.0.1:55462),
`threadline-a-reader-access-04-graph` (127.0.0.1:56462), matching
`-pg-data`/`-graph-data` volumes, normal HTTP service 127.0.0.1:47852 (restored
PID 17384). The runtime PID file is authoritative if restarted for review.
Installation and generated secrets are private under
`/tmp/threadline-a-reader-access-data-04/home` and its owner-only parent;
`service.pid`, service logs, generated token files and verifier identity state
remain under that data root. Temporary scripts and safe final transcripts are
under the checks root. No peer resources were changed or retired.

Delivery is one normal feature PR to main. The remote SHA and actual PR identity
will be confirmed at delivery; no merge, force push or worktree retirement.

## Proposed coordinator updates

After merge, link `docs/access.md` from README, local-development and CLI/MCP
operator guides. Describe supported owner HTTP issuance/list/revocation and
project reader enforcement; remove the old unsupported-issuance limitation
from the CLI/MCP/native guide (including the CLI's stale explanatory comment
when that path is next owned by B). Record migration 6 and the checks above in
the checklist's scoped-access follow-up. Keep N03, native capture and distinct
session model consumption incomplete. Integrate using the preserved shared
context wire contracts; no dependency on B's unpublished client branch exists.
Coordinator owns shared-guide/checklist reconciliation, review, merge and
resource retirement. The next action is review this PR and authorize serial
integration after current-main compatibility checks.
