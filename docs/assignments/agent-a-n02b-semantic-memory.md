# Agent A prompt: sourced semantic memory and task authority

Follow AGENTS.md and [the parallel work rulebook](../parallel-work-rulebook.md) in full. Read this assignment before editing. Use only its reserved worktree/branch, writable paths and resources. Complete this checkpoint, verify it, commit/push its feature branch and open one PR. Review fixes stay with that PR; the coordinator handles merge and retirement. The next milestone gets a fresh worktree.

## Assignment contract

- **ID/owner:** `a-n02b-semantic-01`, Agent A.
- **Outcome:** an authorized human can create a task, propose/accept sourced semantic memory, bind a requirement, inspect current authority and correct it under expected-version guards.
- **Checkpoint:** the complete semantic/task slice with observed acceptance below. This is part of N02B; episodes, procedures, bounded context and native integration are later assignments.
- **Baseline:** freshly fetched `origin/main` after this rulebook/assignment PR is merged. Record the resolved full SHA in the result record before editing. Never start from the old M05 or pre-review memory-foundation commit.
- **Branch:** `threadline/a-n02b-semantic-01`.
- **Worktree:** `/tmp/threadline-a-n02b-semantic-01`.
- **PR:** feature branch → `main` in this repository's `origin`; one PR for this assignment.
- **Authority:** implementation, isolated synthetic verification, commit/push of this feature branch and PR creation. No merge, main push, release, shared-data reset, native configuration changes or inference.

The coordinator reserves this branch/path and delegates their creation to you if absent. Verify unused names, clean correct starting state and the rulebook on the fetched baseline. Create from its full SHA, verify branch/path/HEAD, then work exclusively there. If an existing branch/path is found, report it rather than recycling it. Do not edit the original checkout.

## Read and preserve

Read README.md, CONTEXT.md, docs/development-checklist.md and relevant backend/shared code. The current source contains the reviewed N00–N02A foundation and additive SQL migrations through version 3; inspect actual versions before extending it.

Completed behavior includes durable Sources/history, restricted-role/RLS checks, explicit privileged-function ownership checks, source-anchor admission, leased graph operations/receipts, reconnect/reconciliation and honest readiness. Preserve the review fixes: decimal-string counters, private-parent visibility, valid lifecycle states, narrow claim results and authenticated detailed status.

Optional original local references are under `/Users/dkuriyal/Desktop/falkorDB-Hackathon/docs/plans/`. They are ignored/read-only. Do not depend on ignored evidence as the sole review record.

## Writable paths and frozen boundaries

You own:

- `packages/backend/src/**`
- `packages/shared/src/**`
- `README.md`, `CONTEXT.md`, `docs/local-development.md`, only for actual behavior/domain changes in this checkpoint
- This assignment file's result/status record

Everything else is read-only. In particular, keep `packages/cli/**`, `assets/codex/**`, Agent B's document, `docs/development-checklist.md`, the rulebook, manifests, lockfiles, build/Compose configuration and `.gitignore` unchanged.

Use existing dependencies. Send the coordinator the smallest requested frozen-file change if necessary. Do not build CLI commands or a native adapter to exercise this slice. Use authorized HTTP/core interfaces and temporary verification outside the repository.

Agent B has no database/backend work and will not consume your evolving interface. Do not wait for B or merge/cherry-pick its branch.

## Isolated runtime allocation

- HTTP port: `47831`.
- Data/config root: `/tmp/threadline-a-n02b-semantic-data-01`.
- Verification PostgreSQL host port: `55441`.
- Verification FalkorDB host port: `56441`.
- New container/volume names must begin `threadline-a-n02b-semantic-01-` and have assignment ownership recorded.

Use newly created assignment-owned verification containers/volumes with the qualified image versions/digests from the existing development setup, generated temporary test credentials and synthetic data. Check name/port availability first. This contract permits this isolated setup; it does not permit changing the existing database, baseline service on 47822, shared containers/volumes, existing credentials or native state.

Apply additive migrations only to the isolated verification database for this task. Preserve applied migration checksums. Root Compose files stay unchanged. If an isolated prerequisite is unavailable, continue independent source work and report verification blocked; do not substitute a shared live store or claim acceptance.

Keep credentials owner-only under the assigned root and out of output/Git. Report created resources for coordinator retirement. Do not remove another assignment's resources.

## Implementation sequence

### A1. Agree the actual neutral interfaces in source

Inspect existing shared semantic-memory, task, operation and source contracts. Keep one definition per contract. Narrow/refine actual defects while preserving existing source/history interfaces. Document semantic-only support accurately so a generic capability does not imply working episode/procedure/handoff services.

### A2. Extend the existing operation path

Implement typed semantic/task admission through the current operations ledger and worker. Add a new migration for claim-function/kind changes; versions 1–3 are already applied in the baseline and remain immutable. Keep operation names consistent.

Use the existing lease/reconcile/commit/settle protocol. Content-bearing intent must be source-backed. Handle dependencies on pending source anchors or proposals explicitly; temporary pending dependencies are not false permanent invalidity. Ambiguous delivery retains its original identity.

### A3. Implement the vertical slice

Provide:

1. Task create and bounded task inspection.
2. Source-backed semantic proposals, including proposed versions of existing memory.
3. Explicit human acceptance with expected current version.
4. Task requirement binding to a stable Memory identity with expected task revision.
5. Current-memory and current-task-requirement reads.
6. Human correction creating a new version and superseding the governing head.
7. Source/version provenance and inspectable operation receipts.

Keep one canonical CURRENT edge. Caller input cannot assign human authority, accepted state, actor identity or arbitrary routing. Reject foreign/private/unavailable evidence. Preserve observed-under conditions separately from applicability. Record declared contradictions where the accepted contract requires them; do not infer resolution from recency or repetition.

Use bounded parameterized graph templates and RO_QUERY for reads. Preserve exact counters across SQL/Node/Cypher; opaque memory/task version tokens are equality guards. Events/receipts remain content-free metadata.

Expose proper capability/error states and authorized human inspection. Native enrollment is not required to exercise a human memory workflow; never insert fabricated native sessions or weaken authorization to get a check through.

## Acceptance criteria

Verify against the real isolated SQL/files/FalkorDB:

- Task → authored Source → proposal → human acceptance → requirement binding → current read works.
- Correct freshness from 600 to 60 seconds. The current head changes; the original Source/version remains intact.
- Proposals do not govern before acceptance, and a producer cannot grant itself human authority.
- Two acceptance/correction operations at the same expected head yield one winner and an explicit conflict.
- Exact retry has one logical effect/receipt; changed payload under the same identity refuses.
- Pending/ambiguous operations are distinguishable from committed memory; restart preserves current authority.
- Foreign scope and unreadable/private/missing evidence are refused without revealing content or inaccessible source identities.
- Inherited counter-precision/reconciliation behavior is preserved.
- Other memory kinds/context/native/handoff capabilities remain explicitly unavailable unless already independently implemented on the baseline.

Use two isolated identities/credentials for service-level authorization checks where feasible through the actual supported path. Never present constructed-scope checks as HTTP credential proof; record the outstanding gap if no safe credential path exists.

Run `npm run build`, diff/ownership checks and authorized focused temporary/manual checks. Do not create a permanent package test suite. Keep expected fixture outputs separate from actual evidence.

## Completion and PR

Stop feature implementation at this checkpoint. Do not continue into N02C, procedures or native integration in this worktree. Complete the rulebook's commit/push/PR gates and open the PR. Use draft status if acceptance is incomplete.

Update your result record and PR with actual endpoint/input/output examples, new operation/migration names, verification outcomes, compatibility limits and remaining checklist task IDs. The coordinator updates the shared checklist after integration; you must not mark it independently.

## Result record — owner fills during the assignment

- Status: PLANNED.
- Base ref/full SHA: pending creation gate.
- Actual worktree/branch: pending creation gate.
- Verification resources/processes created: none yet.
- Implemented behavior and changed paths: pending.
- Exact verification/results and limitations: pending.
- Proposed checklist updates: pending.
- Final commit/remote confirmation/PR URL: pending.
- Integration requirements and retirement handoff: pending.
