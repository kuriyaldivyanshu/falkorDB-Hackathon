# Coordinator: retire merged checkpoints and prepare N03 round 05

## Contract

Follow AGENTS.md and [the parallel work rulebook](../parallel-work-rulebook.md).
The user confirmed PRs #17/#18 merged and authorized checklist reconciliation,
retirement of completed worktrees/resources and selection of the next A/B work.

- ID: `coord-n03-round05`; owner: coordinator; outcome: reviewable documentation
  checkpoint, verified retirement and independent next-worker contracts.
- Base main: `8a83b57ac9cc003e5c86331dcdc9a3d9b14193d4`.
- Branch: `threadline/coord-n03-round05`; worktree:
  `/private/tmp/threadline-coord-n03-round05`.
- Remote: `git@github-personal:kuriyaldivyanshu/falkorDB-Hackathon.git`;
  PR base main. Normal commit/push/one PR authorized; user owns merge.
- Writable: AGENTS.md, docs/development-checklist.md, this record, new
  docs/assignments/agent-a-native-access-05.md and
  docs/assignments/agent-b-codex-context-hook-05.md. No product code changes.
- Read-only planning references: current code/docs, installed non-inference
  Codex metadata, official documentation and local `archive/codex` snapshot.
- No new database, native configuration, inference or source capture.

## Retirement targets and retention policy

Five worktrees are authorized for retirement after clean/merge/recovery checks:

- `/private/tmp/threadline-a-n02c-context-03` (PR #15).
- `/private/tmp/threadline-b-episode-demo-03` (PR #14).
- `/private/tmp/threadline-coord-ab-integration-03` (PR #16).
- `/private/tmp/threadline-a-reader-access-04` (PR #18).
- `/private/tmp/threadline-b-context-client-04` (PR #17).

Stop only reidentified services whose command/home/cwd proves target ownership.
Stop and remove only those assignments' ten named PostgreSQL/FalkorDB containers,
after confirming their data uses named volumes. Preserve all named database
volumes, private data/credential roots, external checks/logs and local/remote
branches. Container retirement does not authorize database or credential erasure.
Remove only inventoried reproducible node_modules/dist/tsbuildinfo artifacts
inside clean target worktrees, then use git worktree remove without force.
Unexpected files or processes stop the affected retirement.

## Completion gates

- All retired heads are in main with a recoverable remote record; no dirty or
  unexplained local work is discarded. Shared local Docker resources untouched.
- Reconcile tracked status with PR #18 and PR #17's 70-check integration record;
  keep N03/native gates and N04–N07 open.
- Reserve disjoint A backend/shared versus B CLI/documentation paths, unique
  resources, additive migration ownership, explicit scope and acceptance.
- New workers start only after this preparation PR merges, from the freshly
  resolved main merge SHA; they create fresh worktrees/branches themselves.
- Verify Markdown headings/fences/local links, scope and whitespace, commit/push
  this branch and open one PR. No main push/merge or worker implementation.

## Result

Preparation in progress. Observed baseline: root main and all five target
worktrees clean; every target head is an ancestor of origin/main. Remote
feature refs remain recoverable; A's context branch contains later merged
review commits than its retained worktree head, and main contains both.
Each target's ignored files are only node_modules, package dist and build
metadata. Ten exact target containers use named volumes. No database data is
inside a worktree scheduled for removal.
