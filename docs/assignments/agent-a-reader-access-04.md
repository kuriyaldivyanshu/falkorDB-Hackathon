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

Bootstrap: coordinator main clean, reserved path/local/remote branch absent;
fetch confirmed expected origin/main. Worktree identity/HEAD/clean state and no
upstream verified before edits. Implementation and verification pending.

## Proposed coordinator updates

After merge, link the access guide from README/operator docs and record supported
reader issuance/enforcement in the checklist; retain N03 as incomplete. Precise
wording and verification results will be supplied here at checkpoint completion.
