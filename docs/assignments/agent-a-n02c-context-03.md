# Agent A: N02C bounded context

## Contract

Follow AGENTS.md and docs/parallel-work-rulebook.md in full. Read this tracked
assignment before editing source. Use only this assignment's worktree, branch,
writable paths and resources. Complete and verify the declared checkpoint,
commit/push the feature branch and open one PR. Later features are excluded;
review fixes stay here. The coordinator owns merges and retirement.

- ID: `a-n02c-context-03`; owner: Agent A.
- Outcome: one backend bounded-context service over canonical memory/tasks.
- Checkpoint: authenticated preparation, durable metadata-only manifests,
  truthful occurrences, bounded selection and explicit refusals.
- Base: `main`, literal SHA `106985866429689faf2e166eb89c5d225fbac6d3`.
- Repository: existing origin `git@github-personal:kuriyaldivyanshu/falkorDB-Hackathon.git`.
- Branch: `threadline/a-n02c-context-03`; PR base: `main`.
- Worktree: `/tmp/threadline-a-n02c-context-03` (canonical
  `/private/tmp/threadline-a-n02c-context-03`).
- Dependencies: merged SQL source/graph delivery, semantic/task services,
  evidence precision, candidate procedures, socket/installation safety,
  human CLI/read-only MCP and PR #13 acceptance/input guards. Do not redo them.
- Integration: after this checkpoint's verification and coordinator review;
  do not mark N03, N04 or the product complete.

## Ownership

Writable: `packages/backend/src/**` only as necessary for context;
`packages/shared/src/context.ts`; context exports in
`packages/shared/src/index.ts`; context routes in
`packages/shared/src/protocol.ts`; context contracts in
`packages/shared/src/capabilities.ts`; context terminology in `CONTEXT.md`;
new `docs/context.md`; context eligibility in `docs/memory-kinds.md`; this record.
Everything else is read-only, especially CLI, existing memory/task contracts,
root/package manifests, lockfile, build/Compose configuration, fixtures,
README, local-development, cli-memory-and-mcp, native-integration-contract,
development-checklist, rulebook and Agent B's files/worktree.
Report a necessary crossing with the smallest required change; continue
independent work. The coordinator owns shared checklist/product-doc updates.
Agent B's episode CLI/demo depends on existing contracts, which remain stable.

## Creation and resources

Inspect clean coordinator checkout, fetch origin, require exact expected main,
unused branch/path, then create from the literal SHA. Verify canonical path,
branch, HEAD, clean state and no main upstream. Commit this bootstrap before
source edits; install isolated dependencies with `npm ci` and existing lockfile.
Preserve unrelated state. Do not reuse or retire the previous
`/tmp/threadline-a-n02b-evidence-02` or its resources.

Assigned resources (check ownership/availability first): HTTP 127.0.0.1:47842;
PostgreSQL 55452; FalkorDB 56452; container/volume prefix
`threadline-a-n02c-context-03-`; data root
`/tmp/threadline-a-n02c-context-data-03`; installation root
`/tmp/threadline-a-n02c-context-data-03/home`; temporary checks
`/tmp/threadline-a-n02c-context-03-checks`.
Use fresh synthetic stores and generated credentials. Every setup names the
absolute `--home`; assert installation/source/database/ports before mutations.
Never borrow shared stores, credentials or native configuration. No native
inference, installation, resource deletion, merge, force push or retirement.

## Required reading

AGENTS.md, parallel-work-rulebook, development-checklist (N02C), CONTEXT, README,
memory-kinds, storage-recovery, native-integration-contract and assignments
agent-a-n02b-semantic-memory, agent-a-n02b-evidence-02, agent-b-mcp-read-02.
Inspect shared context/memory/sources/protocol; backend auth/memory/tasks/sources/
semanticSupport/evidence/operations; storage memoryGraph/schema/pg/files;
api/server, index and capabilities.

## Acceptance criteria

One context selector behind existing routes/composition: exact current mandatory
task requirements, bounded applicable optional semantic/episode material,
source references, understandable omissions/refusals and honest graph/task/
privacy snapshots. FalkorDB is canonical; graph outage must not fall back to SQL
or files. Retrieval is deterministic and bounded in queries, candidates and
retries, with stable tie-breaking, no inference/embeddings/raw caller Cypher.
Resolve every required stable identity: missing, proposed, ambiguous, retracted
or unreadable authority refuses. Mandatory content stays exact, never excerpted.

Keep observedUnder separate from applicability. Freshness correction 600→60
replaces authority while a still-applicable UTC lesson survives. Unknown facts
never satisfy predicates; incompatible output/prerequisites exclude advice.
Focus ranks only. If needed add typed conditions in context.ts, distinguishing
selection hints from authenticated/stored facts and deriving task facts from
the task. Validate all inputs; hints prove no native identity or execution.
Candidates remain candidates; procedure validation/handoff selection unavailable.

Limits: default complete rendered body 4096 UTF-8 bytes, hard maximum 8192;
≤8 optional memories, ≤64 source references and existing mandatory-item bound.
Count headings/separators/rendered references. UTF-8 excerpts identify their
representation. Recheck authorization, source availability and full required
provenance before release; reconcile per-item and closure bounds deliberately.
Refusals/omissions expose no inaccessible content, source IDs or private paths.
Detect relevant graph/task/privacy changes using bounded retry/refusal and
name the consistency point. Distinguish selection head from manifest admission.

Durably record a context_manifest Source, selected identity/version metadata,
render digest, graph epoch/head, privacy revision and truthful prepared
occurrence. Persist no rendered plaintext in manifest bytes/items, operation
payloads, occurrence SQL, logs or diagnostics; do not persist focus/free text.
Separate metadata item schema from released text-bearing packet items. Reuse
source/file safety and authorization. Scoped idempotency must handle lost
responses predictably, reject changed requests and avoid duplicate audits.
Graph admission is committed only with an actual receipt.

Preparation proves no emission; reported emission proves no comprehension.
No self-granted native_observed; native observation unavailable without qualified
evidence. Reject unknown/foreign/unauthorized session references; never invent
sessions. Guard scoped transitions and reject unsupported precision.

Inspect existing context_occurrences before schema edits. If necessary add
migration 5 after the immutable v4 ledger; upgrade a populated synthetic v4
baseline without resetting, preserving restricted role/forced RLS. No casual
graph reset/schema change. Enable only implemented context capabilities and
update backend status wording. Keep native integration, validated procedures,
claims, handoffs, import, erasure/export unavailable.

## Verification and delivery

Run `npm run build` after source changes. Use focused temporary checks outside
the repository, no permanent package suite. Exercise current/proposed/corrected
requirements; UTC lesson; incompatible/unknown applicability; candidate wording;
missing/ambiguous/overflow authority; optional and UTF-8 body limits; reference/
candidate bounds; source privacy/availability; snapshot change retry/refusal;
metadata-only persistence; scoped honest occurrences/native refusal; idempotency;
bounded graph outage, SQL history survival and service recovery without restart;
existing semantic/task/episode paths. Use real HTTP credentials for authorization;
synthetic SQL identity setup is verification only. Report actual observations,
including untriggered races and remaining uncertainty.

Write docs/context.md covering selection/applicability, mandatory/optional bounds,
refusals, snapshots, persistence/release, occurrences, routes/examples/limits.
Record base/head/paths/design/schema/check results/uncertainty, proposed shared
doc corrections and resources. Check docs links/headings/fences, full scope diff,
secrets, `git diff --check`, explicit staging and clean final state. Push normal
commits to the assigned branch, confirm remote SHA, inspect existing PRs and open
one PR to main. Use a multiline body with evidence/limits/integration requests.
If PR creation is unavailable, report exact blocker and compare link/body.
Keep worktree/resources for coordinator review and retirement.

## Result

Bootstrap: clean coordinator main and fetched origin/main both matched the base;
branch/path/data/check roots absent, reserved ports available and no Docker
prefix collision. Worktree verified clean at the base, without upstream.
Implementation and verification pending.
