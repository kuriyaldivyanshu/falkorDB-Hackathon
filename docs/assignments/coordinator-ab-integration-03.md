# Coordinator: verify the merged episode and context checkpoints

## Contract

Follow [the parallel work rulebook](../parallel-work-rulebook.md) and AGENTS.md.
The user requested review and necessary fixes to Agent B's episode CLI, demo
and product documentation after Agent A's context PR merged.

- ID/owner: `coord-ab-integration-03`, coordinator.
- Base: merged `main` at `924767aa2d409ef62c394c9edb9498c331757158`, containing
  B PR #14 and A PR #15, including A's expiry, qualifications and focus fixes.
- Branch: `threadline/coord-ab-integration-03`; PR base: `main` in existing origin.
- Worktree: `/tmp/threadline-coord-ab-integration-03`.
- Writable: B's CLI paths only for confirmed integration defects; README,
  local-development, cli-memory-and-mcp, memory-demo, native-integration-contract,
  development-checklist, and this assignment. Context documentation may receive
  a narrowly necessary consistency correction. Other source/contracts,
  migrations, dependencies, configuration and fixture specifications are frozen.
- Scope: review existing behavior and reconcile current capabilities. Context
  CLI/MCP integration, native inference/configuration and later features remain
  outside this checkpoint. Old agent worktrees stay available and unmodified.
- Runtime: fresh synthetic stores only; HTTP 47844, PostgreSQL 55454, FalkorDB
  56454, prefix `threadline-coord-ab-integration-03-`; data root
  `/tmp/threadline-coord-ab-integration-data-03`, explicit installation `home/`
  beneath that root; temporary checks `/tmp/threadline-coord-ab-integration-03-checks`.
- Authority: isolated setup, build and focused temporary verification;
  commit/push the named branch and open one PR. No merge, main push, publication,
  shared-data reset or retirement of peer resources.

## Acceptance

Review B's PR diff against its assignment and combined main, including output,
evidence precision, operation states and documentation. Build the workspace.
Re-run B's episode/demo/MCP paths against the combined backend in isolated
stores, including normal persistence and graph outage/recovery. Verify context
support remains separate from unimplemented context CLI/MCP/native integration.
Use temporary checks, preserve authored-versus-observed distinctions and report
exact outcomes and unverified cases. Reconcile the coordinator checklist using
merged records and new observations without promoting native or future work.
Check Markdown structure/links, scope and diff cleanliness. Commit/push normally
and verify the remote SHA and actual PR identity; preserve runtime recovery data.

## Result

In progress. Main was clean and fast-forwarded; the new worktree was created
from the literal merged base. Read-only standards/spec reviewers inspect the
same pinned code while the coordinator owns all edits and runtime verification.
