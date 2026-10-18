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

Observed baseline: root main and all five target
worktrees clean; every target head is an ancestor of origin/main. Remote
feature refs remain recoverable; A's context branch contains later merged
review commits than its retained worktree head, and main contains both.
Each target's ignored files are only node_modules, package dist and build
metadata. Ten exact target containers use named volumes. No database data is
inside a worktree scheduled for removal.

### Retirement completed

All five worktrees were clean and ancestor checks passed. Main and retained
remote feature refs preserve their work. A's earlier context worktree head
`fe7e5bb` and remote's later `4456ff8` are both merged; no review fix was lost.
Removed only the inventoried generated dependencies/build artifacts before
normal git worktree removal. Four reidentified service PIDs (50630, 70491,
17384, 39380) exited with SIGTERM. B's episode-demo service was already absent.

Stopped and removed exactly the ten assignment containers named in the five
records; all ten named data volumes still exist. Data/credential roots and
external check directories remain in their original private locations, along
with local/remote branches. Shared threadline-local PostgreSQL/FalkorDB containers
were not modified. The older unrelated stopped/created integration containers
were not this assignment's targets and remain unchanged.

Recovery inventory and retirement transcript:
`/tmp/threadline-coord-n03-round05-checks/retirement-preflight.json`,
`retirement-result.json` and `retirement.log`. Paths, heads, volumes and retained
roots are recorded without token or database-secret contents.

### Next work decisions

A owns stable enrollment storage, additive migration 7, producer authorization
and provisional one-session pinning. A explicitly preserves the reader API;
capture/strong identity/model writes remain unavailable. Replace a pinned
instance through owner revocation and fresh enrollment, rather than promising
safe rebind with the same bearer.

B implements context-only SessionStart/UserPromptSubmit hooks using merged
reader/context APIs. It uses no A enrollment or capture contract. Exact bounded
output, total deadline, explicit workspace/reader/selectors and honest local
stdout-write reporting are required. Config installation and actual native
inference require later specific authorization; prepared probe steps are part
of B's handoff, not implied permission.

Local archive/codex is an optional read-only snapshot in both contracts. The
official hooks page was searched and opened on 18 October 2026:
[OpenAI hooks documentation](https://learn.chatgpt.com/docs/hooks). It documents
the two context boundaries and distinguishes parent session IDs and output
spilling, but does not qualify this installed Threadline hook. No native probe
or product implementation was run in this preparation assignment.

Resources reserved, not created: A HTTP/PG/graph 47862/55472/56472; B
47863/55473/56473, with separate data/check roots and fresh worker worktrees.
Both workers start after this documentation PR merges, resolving the actual
new main SHA into their result records before source edits. Either feature PR
can be reviewed first; integrate one at a time and rerun the second against
combined main. A-before-B is a preference, not an artificial dependency.

The checklist now records PR #17/#18 and their real integration evidence while
keeping N03–N07 incomplete. AGENTS.md no longer describes context clients as
missing. No product source/dependency, native configuration or stored data was
changed. Final documentation and retirement gates are recorded in the PR handoff.

### Verification and handoff

All five changed/new Markdown files passed one-H1/hierarchical-heading,
language-labelled balanced-fence, local-link, whitespace and credential-pattern
checks. Complete diff scope is restricted to the five owned documents; product
source/dependencies/fixtures/archive are unchanged. git diff --check passed.
No source build or tests were added/run for this documentation-only checkpoint;
the feature-main build and combined 70 checks are prior recorded evidence.

Final inspection found only root main and this active coordinator worktree.
The ten retired containers and five old listener ports are absent, all ten data
volumes still exist, and shared local containers remain healthy. Both reserved
worker branch/path names and all six new loopback ports were unused at inspection;
workers must check again at creation. Local branches and remote branches remain.
The retirement JSON/transcript SHA-256 manifest is retained in the checks root.

Two read-only planning reviewers checked the separate contracts; clarified
producer single-enrollment self-inspection versus owner collection listing,
project UUID versus absolute path flags, and deadline/partial-output limits.
No worker feature source was implemented by those reviewers.

One initial inventory command used the zsh-special path variable and lost PATH
inside that fresh subprocess; it made no mutations and was replaced by explicit
Python subprocess calls. A reserved-port inspection needed approved sandbox
network access and then passed. Neither issue changed product or stored data.

Normal push and one preparation PR follow this record. Workers must wait for
that PR to merge, then record the resolved main SHA in their fresh branches.
The user/coordinator retains merge authority; no worker starts from this unmerged
documentation branch. Evidence roots are retained and no further cleanup is
implied. Next features are N03 round 05, not milestone N05.
