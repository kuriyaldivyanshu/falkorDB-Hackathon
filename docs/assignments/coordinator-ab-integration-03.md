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
  development-checklist, current implementation-status sentences in AGENTS.md,
  and this assignment. Context documentation may receive
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

Main was clean and fast-forwarded; the new worktree was created from the literal
merged base. Read-only standards/spec reviewers inspected the same pinned code
while the coordinator owned all edits and runtime verification.

### Review and changes

- Standards: one actionable finding, stale product statements contradicted
  implemented context capabilities and AGENTS.md's documentation consistency rule.
- Spec: one actionable finding, B's required post-A documentation reconciliation
  was skipped when PR #14 merged first. Both axes identified the same issue.
- No actionable episode CLI/transport compatibility defect was found. No source,
  dependency, lockfile, migration or fixture specification changed in this PR.
- README, local development, CLI/MCP guide, demo and native integration guide
  distinguish implemented authenticated context HTTP services from absent
  context CLI/MCP/native adapters. Context HTTP credential-isolation evidence
  is distinguished from still-missing supported scoped credential issuance.
- The coordinator checklist and AGENTS implementation-status sentences now
  reflect merged memory/task, episode CLI, read-only MCP and N02C work. N03–N07
  remain open. Historical worker reports remain unchanged.

### Verification on the combined implementation

`npm ci` and `npm run build` passed. The documented six Bash blocks in
`docs/memory-demo.md` were extracted to the external checks root and run twice
with fresh synthetic projects and dynamically returned IDs. Both complete
walkthroughs passed, including the authored exporter failure, observed-precision
eligibility, 600→60 correction, candidate procedure, ordinary service restart and
fresh authored MCP recall. This is not actual Codex runtime evidence.

Adapted temporary B checks were copied read-only to the new checks root; only
worktree/data/check paths and the isolated graph container name were changed.
No old credential, environment file or database was borrowed.

- Episode CLI: **25 passed**. File/stdin, authored versus observed precision,
  unknown uncertainty, invalid/oversized inputs, scoped retries, explicit
  acceptance guards, exit/output behavior and retained task/procedure state.
- Authored transport: **6 passed**. Shared schema/route, preserved caller key
  and requested precision, stripped server-owned fields, operation-state follower
  and invalid-input refusal. Simulated responses are not lost-reply evidence.
- Retained graph: **4 passed**. Both fresh projects retain the superseded exact
  600-second version and its source edges, inspected read-only.
- Context compatibility: **7 passed**. A's authenticated context service uses
  B's corrected task authority, retains qualifications and UTF-8 body/digest,
  persists no focus or qualification plaintext in the metadata manifest, replays
  the same audit identity and records operator-reported emission. Capability
  and health schemas agree; the fresh SQL store is version 5.
- MCP/outage: **22 passed**. All six read-only tools, scoped refusal and actual
  backend reads; a live connection preceded stopping only the assignment graph.
  Service PID **70491** and the same MCP process survived, SQL history remained
  usable, graph-dependent reads refused, and pending episode work committed
  with receipts after graph recovery without a service restart. Retry retained
  the original identity and one candidate.

Total: **64 focused checks plus two complete demo walkthroughs**, all final
runs passed. All eight changed Markdown files passed H1, heading hierarchy,
labelled-fence and local-link checks; generated verification credentials were
absent from changed files, source/dependency diffs were empty, and
`git diff --check` passed. Six final transcript digests are preserved in the
external checks root's `SHA256SUMS.txt`.

One initial episode run started immediately after launching a
detached service and failed before the listener bound; a bounded readiness
preflight corrected the verifier ordering. The documented shell's background
service ended when its shell exited, so later checks used a configuration-asserted
detached service at the same explicit assigned home. No product source fix or
restart-based outage workaround was needed.
An initial Markdown verifier counted Bash comments inside fenced code as H1s;
the verifier now checks headings outside fences, and all eight files pass.

### Limits and recovery

No native installation/inference, model consumption, strong native identity,
validated procedure reuse or later coordination/privacy behavior was exercised.
The integration run does not repeat all of A's controlled expiry/race, isolation,
upgrade and provenance-bound checks; their merged record remains their evidence.
Declared contradiction-edge storage was not exercised in this run and stays an
explicit current-build verification follow-up. No complete load/concurrency proof
or deliberately lost real submitted graph reply is claimed.

Fresh resources: `threadline-coord-ab-integration-03-postgres` (55454) and
`threadline-coord-ab-integration-03-graph` (56454), named `-pg-data`/`-graph-data`
volumes, HTTP service 47844. Data/credentials remain owner-only under
`/tmp/threadline-coord-ab-integration-data-03`; safe transcripts and temporary
scripts remain under `/tmp/threadline-coord-ab-integration-03-checks`. Keep these
for review and coordinator retirement. Peer worktrees/services were not changed.

Delivery: normal commit/push of this branch, one PR to main, no merge or main
push. Final SHA and actual PR URL are reported after remote confirmation.
