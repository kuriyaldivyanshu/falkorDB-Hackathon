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

_Filled at the end of the checkpoint: retirement outcomes, baseline and resources, implemented operations and migrations, evidence/state policy, verification results and limits, proposed checklist updates, final head, remote confirmation and the real PR link._