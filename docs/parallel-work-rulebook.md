# Parallel work rulebook

This is the operating contract for concurrent Threadline development. Every agent assignment must explicitly require this file. AGENTS.md and the latest user instructions govern authorization; this rulebook governs coordination within that authorization.

A rulebook provides checks and stop conditions, not a guarantee against every error. Branch protection and required remote checks are separate repository settings; do not assume they are configured. One coordinator remains responsible for integration.

## 1. The unit of work

**One bounded assignment → one worktree → one feature branch → one PR.**

Create the feature branch when creating the worktree. Commit the assignment on that branch. A worktree can contain several incremental commits within its assigned scope. When its declared checkpoint is complete, commit/push the final result and open a PR; subsequent work there is limited to review, base updates and verification of that same PR.

A committable checkpoint means the assignment's acceptance criteria are met, its result is buildable/reviewable, and its known limits are explicit. It does not mean every small safety commit ends the assignment.

Start the next feature/checkpoint in a fresh worktree and branch from updated `origin/main` after its dependencies merge. Never recycle a completed assignment's branch or worktree for another milestone. A worktree is not disposable until its recovery and retirement gates pass.

## 2. Roles and status ownership

- **Coordinator:** selects independent assignments, reserves file/resource ownership, records the base SHA, reviews scope changes, integrates PRs serially and retires worktrees. The main checkout is the coordinator's integration station.
- **Worker:** changes only its assigned paths, validates its result, commits/pushes its branch, opens its PR and handles review fixes. A worker never merges its own PR or changes another worktree.
- **Reviewer/integrator:** checks correctness, scope, verification and compatibility with current main. The coordinator can perform this role; independent review is preferred when available.

The coordinator alone updates the shared execution status in [development-checklist.md](development-checklist.md) while assignments run in parallel. Workers update their own assignment record and PR body. The coordinator marks checklist work complete only after merge and applicable acceptance verification.

Worker records and detailed reports must contain the facts needed for review in tracked files or the PR. `docs/plans/`, `docs/migration.md` and `docs/evidence/` are currently ignored; local logs there are optional supplements, not the sole evidence required by a fresh checkout.

## 3. Assignment contract: required before editing

Use one tracked file per active assignment under `docs/assignments/`. It contains the actual agent prompt plus a result record. Record:

- Stable assignment ID, outcome, owner and one reviewable checkpoint.
- Base ref and resolved full SHA; branch, worktree and remote repository.
- Dependency status and the earliest point at which integration is allowed.
- Exact writable paths and explicit exclusions; absence from the allowlist means read-only.
- Shared contract, migration, dependency and documentation ownership.
- Runtime resource permissions: ports, data roots, database/graph scope and native configuration scope, or explicitly none.
- Acceptance and verification requirements, unqualified cases and external authorization limits.
- Required PR base, commit/push/PR authority and retirement owner.

Do not dispatch two writers for the same path. Reserve root manifests/lockfiles, build configuration, shared contracts, SQL migration sequencing, product docs and the shared checklist to one owner or freeze them for the round.

An unexpected dependency does not silently expand an allowlist. The worker reports the smallest required change. The coordinator can approve a routine reassignment by updating the contract, or split an ordered prerequisite. New external/destructive permissions still come from the user.

## 4. Create a fresh worktree from a known checkpoint

The coordinator first checks that the main checkout is clean, fetches origin and fast-forwards main with `git pull --ff-only`. Record `git rev-parse origin/main` and inspect the resulting checklist. Resolve divergence instead of resetting or forcing it away.

Inspect `git worktree list --porcelain` and existing local/remote branch names before creating anything. Choose an unused assignment-specific branch/path; never repurpose or overwrite an existing one.

The coordinator may explicitly delegate creation of the already reserved branch/path to its worker; all creation gates still apply. From the coordinator checkout, substitute literal values:

```sh
git worktree add -b threadline/<assignment-id> /tmp/threadline-<assignment-id> <full-origin-main-sha>
```

Pass the resolved SHA rather than `origin/main` to avoid accidentally configuring the feature branch to track main. Verify the new branch has no main upstream; its eventual upstream must be its own remote feature branch.

Before editing, the worker verifies:

```sh
pwd
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --porcelain=v1 --untracked-files=all
git worktree list --porcelain
```

The canonical worktree path, branch and HEAD must match its contract, and the tree must be clean. An existing/different/dirty worktree is not permission to clean it. Preserve it and resolve the discrepancy with the coordinator.

Each worktree installs its own dependencies with `npm ci` from the existing lockfile. Do not symlink another worktree's `node_modules`, generated output, credential root or configuration into it. Fetching is allowed; repository-wide configuration/hooks and another branch's refs are not worker-owned resources.

**Creation gate:** identity, clean baseline, ownership and resources are established before source edits. If the rulebook/assignment is missing, fetch/update the correct baseline or obtain the contract before proceeding.

## 5. Isolate runtime state as well as files

Git worktrees isolate tracked files/indexes, not processes, ports, home directories, databases, Docker volumes, Redis/FalkorDB instances or native accounts.

Use assigned ports, explicit temporary Threadline data/config roots and synthetic project/tenant/graph identities. Reserve a database/schema fixture if a task applies migrations. Preserve applied migration checksums and serialize migration numbers under their designated owner.

A code assignment does not authorize applying migrations to shared live data. Use its explicitly assigned isolated verification database or obtain the applicable authorization. Never stop shared containers, reset volumes, kill unowned processes or alter the baseline service to run an outage check.

Native inspection must not read/copy credentials. Real native configuration installation and inference retain their separate authorization gates. Preview rendering and temporary authored protocol input do not qualify real native behavior.

If a port, schema, graph, profile or data root is already in use and its ownership is unclear, stop that operation. Do not choose someone else's resource or change another worker's setup.

Ignored files are not in a checkout/commit. Use explicit safe configuration; do not copy private `.env`, auth, runtime history or credentials from the main checkout. Preserve local diagnostic output with safe redaction and record only non-sensitive review evidence.

## 6. Work inside the contract

Work only on the assigned branch in the assigned worktree. Read other source as needed; edits outside the allowlist require coordination first. An urgent cross-boundary defect is reported with its impact; the coordinator assigns the fix explicitly.

Do not cherry-pick/merge a peer's unmerged branch or write against an unpublished contract. If the task genuinely requires that work, make it an ordered dependency and start/rebase the next assignment from the merged main checkpoint. Parallel development is appropriate for independently verifiable slices.

Use the existing Threadline core/contracts and preserve the retired-execution boundary. A native adapter must not grow a second memory service to avoid a dependency. A backend task must not build native integration or a new coding CLI.

Shared source/build/lockfile edits belong to their named owner. Within a worktree, avoid simultaneous dependency installs/build mutations by multiple sessions. Separate workers can build concurrently in their own correctly isolated worktrees.

Preserve unrelated changes. Never use blanket cleanup, hard reset, forced checkout, force push or worktree removal as a conflict-resolution technique.

## 7. Checkpoint gate: ready to commit and open a PR

Complete the assignment outcome or honestly record a blocked/incomplete draft. Check all of these:

1. Every changed/new/deleted path is allowed. Compare against the recorded base, including committed changes, unstaged changes and untracked files—not just the current unstaged diff.
2. The intended behavior is integrated within the assignment. Partial native/feature support remains labelled unavailable; expected fixture outputs and authored protocol packets are not live evidence.
3. Run `npm run build` after source/build changes, plus the authorized focused verification relevant to the acceptance criteria. For documentation-only work, check links, headings, fences and consistency. No permanent test suite is recreated.
4. Run `git diff --check`; inspect deleted files, new untracked files and sensitive data. Ignored docs, runtime data, secrets, build output and local-only archives are not force-added.
5. Update the owned assignment result with actual behavior, exact check results, limitations and integration requirements. Required evidence is available through tracked summaries or the PR, not an ignored/temp log alone.
6. Review the complete proposed diff against the recorded base; stage explicit intended paths and inspect `git diff --cached`/`git diff --cached --check`.
7. Commit on the assigned feature branch. Safety/WIP commits may exist during work; they do not establish acceptance or authorize a ready PR.
8. Record the final HEAD and verify that the checked source/config tree has not changed since verification. Any later change invalidates the relevant checks and needs re-verification.

Before claiming a clean result, inspect `git status --porcelain=v1 --untracked-files=all`. Explain any retained ignored task artifacts separately. Do not hide files with new ignore patterns to make status appear clean.

**Checkpoint gate:** acceptance is met, diff is in scope, relevant checks pass, required summaries exist and final commit is identified. Otherwise retain the branch/worktree with an explicit incomplete status; a draft PR can request feedback but is not merge-ready.

## 8. Push and open one PR

An assignment issued under this workflow authorizes committing/pushing its named feature branch and creating/updating its PR. It does not authorize merges, direct pushes to main, releases, public package publication or contacting unrelated people. Explicit user restrictions still take precedence.

Before push, verify branch and remote repository; never rely on an upstream that points at main. Push the explicit feature ref and establish that branch's upstream:

```sh
git push -u origin HEAD:refs/heads/threadline/<assignment-id>
```

Verify the remote feature ref matches the local final SHA. No force push. If a push fails or its result is ambiguous, inspect the remote ref before retrying or claiming success.

Open a PR with base `main` and exactly the assigned head branch/repository. Inspect existing PRs first so retries update the same PR instead of creating duplicates. Use an authenticated supported CLI/API or the GitHub UI; do not install tools or borrow credentials just to bypass an unavailable route.

Use a real multiline body (for CLI tools, an exact temporary body file). Include:

- Assignment ID, purpose, base SHA, final head SHA and dependencies.
- Behavior/files changed and any contract/migration effects.
- Actual verification commands/results and important untested cases.
- Observed versus documented native capabilities, when applicable.
- Privacy/data/resource impact and explicit unavailable features.
- Integration order, requested shared-file changes and reviewer focus.

Use draft status for incomplete acceptance. A review-ready PR requires its checkpoint gate; requesting review is not approval or merge.

**PR gate:** push is confirmed, PR URL/number and base/head/SHA are verified, and result is reported. If tools/permissions prevent PR creation, report “committed/pushed; PR not created”, retain recoverable work and give the exact blocker/link. Never claim a PR exists from a compare URL alone.

After the checkpoint, freeze feature scope. Review fixes and required main updates stay in the same branch/PR. A new feature or milestone needs a new assignment/worktree.

## 9. Review and integration are serial

PR development/review can run concurrently. Only one integration action updates main at a time, under the coordinator/reviewer.

Before each merge:

1. Confirm acceptance, review findings and required checks for the exact current head.
2. Fetch current main. If it advanced, update the feature branch with main in its own clean worktree, resolve conflicts and rerun affected checks. Default to a normal merge commit instead of rewriting published history.
3. Verify semantic compatibility even when Git reports no conflicts: contracts, route registration, operation names, migrations, dependencies and authorization can diverge without touching the same lines.
4. Check the actual base/head again. A changed head requires the applicable checks/review again.
5. Merge only with explicit integration authorization or an established authorized merge policy. Stop on unresolved review findings or failed/unknown required checks. Do not bypass checks/admin controls.

After merge, fast-forward the coordinator's main checkout, record the merge SHA and run the relevant combined verification. Only then update the shared checklist and dispatch dependent work from that new checkpoint.

A merge queue is acceptable if configured to validate ordered integration results. Do not assume it exists. Independent PRs need not wait to be authored, but dependency-bearing integrations wait for their prerequisites to merge.

If main breaks after integration, pause new dependent work. Diagnose/fix on an isolated branch; rollback/revert is a deliberate coordinator decision, never an automatic destructive reset.

## 10. Retire safely; start fresh next time

Retirement belongs to the coordinator. Workers report readiness to retire; they do not remove their own worktree as part of finishing a PR.

Default retirement gate:

- The PR is merged and the merge is recorded, or the user explicitly cancelled it with a documented recovery decision.
- Final work is confirmed on a remote branch/merged main. Account for squash merges by PR merge records/patch content, not only ancestry.
- No local commits or staged/unstaged/untracked work remain unaccounted for.
- Owned processes are stopped and no caller still uses its paths.
- Ignored task artifacts are reviewed; useful safe evidence is preserved and credential-bearing artifacts follow their explicit retention policy.
- The coordinator and worker agree the assignment is complete. A branch merely being “committable” does not pass retirement.

Use `git worktree remove <exact-assigned-path>` from another checkout after these checks, without `--force`. If it refuses, investigate the remaining state; never replace it with `rm -rf` or forced removal.

Remote branch retention/deletion is a separate coordinator decision after recovery is established. No automatic force-delete of local branches or blanket pruning. A merged/closed worktree is never reused for the next feature; create a fresh one from updated main.

## 11. Fail-closed conditions and handoff

Stop the affected action and report a concrete recovery step when:

- Worktree/branch/base/remote does not match the contract or baseline is unexpectedly dirty.
- A write crosses ownership, needs an unmerged peer change or collides with a runtime resource.
- Verification fails, a secret appears, required permissions are missing or native evidence is unavailable.
- The remote SHA/PR identity cannot be confirmed, main diverges or a review remains unresolved.
- Cleanup would discard unexplained commits, files, logs or active processes.

Continue independent in-scope work where possible; do not convert these conditions into requests to approve routine implementation choices.

Every final worker report includes assignment ID; worktree/branch/base/head; scope changed; verification/limits; commit and remote confirmation; real PR URL/status; integration dependencies; owned resources still running; recovery/artifact paths; and the next coordinator action. Report “done” precisely as checkpoint-ready, PR-open, merged or retired.

## 12. Mandatory prompt opening

Every dispatched prompt begins with this requirement, followed by its specific contract:

```text
Follow AGENTS.md and docs/parallel-work-rulebook.md in full. Read the assigned tracked task file before editing. Use only its named worktree/branch, writable paths and resources. Finish the declared checkpoint, verify it, commit/push that feature branch and open one PR. Keep later features out of that worktree; review fixes stay with the same PR. The coordinator handles merges and retirement.
```

Prune completed assignment prompts when preparing a later round after their durable outcome is summarized in the checklist/PR. Git preserves old instructions; maintain current work rather than a new historical prompt archive.
