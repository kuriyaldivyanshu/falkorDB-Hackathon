# Agent B: episode CLI and reproducible memory demo

## Assignment contract

Follow AGENTS.md and docs/parallel-work-rulebook.md in full. Read this tracked task file before editing. Use only this assignment's named worktree/branch, writable paths and resources. Finish the declared checkpoint, verify it, commit/push that feature branch and open one PR. Keep later features out of this worktree; review fixes stay with this PR. The coordinator handles merges and retirement.

- ID: `b-episode-demo-03`; owner: Agent B.
- Outcome/checkpoint: working human `memory:episode:record --input <file|-> [--wait]` command and a reproducible, honest baseline memory walkthrough covering semantic correction, episode provenance, procedural candidates, persistence and read-only MCP recall.
- Repository: existing origin `git@github-personal:kuriyaldivyanshu/falkorDB-Hackathon.git`; PR base `main`.
- Base: literal `106985866429689faf2e166eb89c5d225fbac6d3`, confirmed current origin/main on creation.
- Branch: `threadline/b-episode-demo-03`; worktree: `/tmp/threadline-b-episode-demo-03` (canonical `/private/tmp/threadline-b-episode-demo-03`). No main upstream.
- Independent of Agent A's unmerged N02C. Work against merged APIs only. Integration order A → B integration update → B. After coordinator confirms A merged, normally merge current origin/main into clean B branch, rebuild, verify affected episode/demo/MCP checks and shared-schema compatibility, reconcile owned product docs. No context CLI/MCP integration or edits to A's context docs.

## Ownership and exclusions

Writable: `packages/cli/src/index.ts`, `packages/cli/src/options.ts`, `packages/cli/src/memory-surface.ts`; other CLI source only directly necessary with explanation. Documentation: `README.md`, `docs/local-development.md`, `docs/cli-memory-and-mcp.md`, new `docs/memory-demo.md`, `fixtures/README.md`, `fixtures/inventory-export-v1/README.md`, optional small public authored templates under `fixtures/memory-demo-v1/**`, and this record.

Everything else is read-only, especially backend/shared source, CONTEXT.md, memory-kinds/native-integration/storage-recovery/context docs, development checklist/rulebook, manifests/lockfile/build/Compose/.gitignore, inventory manifest and seed, and Agent A's worktree/assignment. No new dependency, SQL migration, native configuration, inference, package publication, installer, permanent verification suite, executor or launcher. Shared checklist remains coordinator-owned; this assignment supersedes its old PLANNED B reservation. Do not mark N03/N06 complete.

## Required reading and implementation

Read AGENTS, rulebook, checklist, CONTEXT, README, local-development, cli-memory-and-mcp, memory-kinds, storage-recovery, native-integration-contract, previous B mcp-read-02 and A n02b-evidence-02 assignments, fixtures README, inventory README/manifest. Inspect CLI index/options/client/memory-surface/MCP server, shared memory/protocol, existing episode route and evidence eligibility read-only.

Reuse `recordEpisodeInputSchema`, `RecordEpisodeInput`, `ROUTES.memoryEpisodes`, `memoryOperationResultSchema`, bounded JSON reading, API client, operation following and bounded primitive error details. Add one core transport method. Validate before sending, enforce document/project consistency, preserve caller idempotency key and precision, never accept automatically or retry weaker precision, never author server fields. JSON emits exactly one result; human output identifies actual operation state. Exit 0 committed/read, 1 refusal/failure, 2 usage, 3 unresolved. Keep operation commitment, accepted/current authority, evidence precision and procedure validation separate. Preserve PR #13 explicit --expect-current and bounded reads.

Server alone decides observation: sources must be in-scope/project-visible/available, qualifying outcome kinds, complete, recorded by acting human, with committed source admissions. Requested kinds/assertions alone do not qualify; authored stays authored; unknown requires uncertainty. No backend weakening or independent-truth claims.

## Runtime reservations and safety

HTTP 127.0.0.1:47843; PostgreSQL host 55453; FalkorDB host 56453. Container/volume prefix `threadline-b-episode-demo-03-`. Data root `/tmp/threadline-b-episode-demo-data-03`; installation `/tmp/threadline-b-episode-demo-data-03/home`; temporary checks `/tmp/threadline-b-episode-demo-03-checks`; disposable exporter copies beneath data root. Verify ownership/availability before use. Fresh synthetic stores and generated credentials only; unchanged backend from own worktree. Every setup uses explicit absolute --home; assert home/source/database/ports before mutation. No ~/.threadline or coordinator credentials/.env. Previous worktrees/resources, including b-mcp-read-02, remain coordinator-owned. Synthetic reader/service SQL setup permitted only in assigned database and labelled unsupported credential provisioning.

## Walkthrough acceptance

Use retained inventory fixture without changing manifest/seed. Create disposable explicitly associated project/task; append public authored requirement Source; propose 600 seconds; show proposal does not govern; explicitly accept with expected-current and bind task requirement. Copy seed, execute selected public case with human/temporary command; capture actual stdout/stderr/exit as Source; record episode; disclose authored defect, not Codex mistake. Capture authored change to 60 seconds; guarded correction; show current task requirement 60 and retained old version/provenance. Propose and human-accept procedure supported by recorded episode; show procedureState candidate; validation/context selection separate. Restart service; inspect persisted project/task/memories from fresh CLI and authored MCP process; retrieve current requirement/episode/candidate; list six read-only tools with no mutation. Run full sequence twice with fresh projects/dynamic IDs. No A context, Codex call, hooks, enrollment, validation, claims/handoffs, production credentials or execution harness. This proves persistence/transport recall only, not model consumption.

Optional tracked assets are small public authored text/templates only. No credentials/tokens, required machine paths, transcripts, generated runtime bytes/dumps, prefilled successful outcomes or permanent checks. Fixture expectations remain specifications. Update README, local-development, CLI/MCP docs and new demo; accurately label bounded context unavailable on baseline.

## Verification and handoff gates

Install own npm ci from existing lockfile; inspect scripts and run npm run build. Temporary focused checks outside repo: valid authored file/stdin; eligible observed; unsupported observed refusal without downgrade; unknown without uncertainty; malformed IDs/missing key/oversize; identical replay one effect and changed-key-payload refusal; wait/non-wait output/exit; graph outage service survival/pending/unavailable and recovery without service restart; existing acceptance/task/memory guards. Demo twice, 60-second current authority/old provenance, precision, candidate state, service restart and fresh MCP recall. Verify no backend/shared/dependency change; docs links/headings/fences, git diff --check, sensitive-data/scope review. Record actual checks/fixed failures/untriggered limits; no unrelated broad suite.

Review full diff against baseline, stage explicit paths, inspect cached diff/check, commit normal commits, push explicit feature ref and confirm remote SHA. Inspect existing PRs, open one PR main ← assigned branch through supported authorized route. If route unavailable, report exact blocker, compare link and prepared multiline PR body; do not inspect credential stores/install auth/probe issues. No merge/force push/retirement/next milestone. Keep resources for coordinator review. Result must include base/head/path/branch, scope, checks/limits, evidence versus authored data, native/coordination/privacy gaps, proposed checklist updates, resource ownership, PR URL/status and remote confirmation; coordinator next action is A merge, B integration pass, then B review/merge and retirement.

## Result record

Status: contract bootstrap; implementation and verification pending.

Creation checks: coordinator main clean; fetched origin/main equals required baseline; branch/path unused; worktree canonical identity/HEAD/clean state verified; branch has no upstream. No existing runtime state borrowed.
