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

Status: checkpoint verified, committed and pushed; [PR #14](https://github.com/kuriyaldivyanshu/falkorDB-Hackathon/pull/14) open against main. Final integration still waits for coordinator confirmation that A has merged.

Creation checks: coordinator main clean; fetched origin/main equals required baseline; branch/path unused; worktree canonical identity/HEAD/clean state verified; branch has no upstream. No existing runtime state borrowed.


### Implemented behavior and scope

- `packages/cli/src/options.ts`: registers/help-documents `memory:episode:record --input <file|-> [--wait]` and permits the existing wait/input flags.
- `packages/cli/src/memory-surface.ts`: one `recordEpisode(RecordEpisodeInput)` transport method, using the shared input/result schemas and `ROUTES.memoryEpisodes`. It decides no evidence policy, invents no key, accepts nothing and performs no downgrade/retry.
- `packages/cli/src/index.ts`: dispatches the episode through that method and the existing operation follower/reporter. Human output names operation/version and actual state; JSON remains one operation result. Shared structured-input handling now rejects conflicting flag/document projects before sending (also for propose/correct), handles non-object documents safely, and bounds file reads themselves as well as stdin. This closes the file-size-check/read race without adding a second reader.
- Product docs: README, local-development and CLI/MCP guide describe the actual command, evidence/acceptance/validation distinctions and current limits. New `docs/memory-demo.md` gives complete synthetic storage setup and an executable human workflow using returned identifiers, actual exporter output, correction, procedural support, normal restart and an authored MCP client. Fixture READMEs link it and disclose the authored defect.
- No other CLI source was necessary. Backend/shared source, contracts, migrations, dependencies/lockfile, build/Compose configuration, checklist/rulebook, native contract, inventory manifest and seed remain byte-identical to the base. No context command/tool, permanent tests, fixtures with fabricated observed output, executor or installer was added.

### Actual verification

Environment: local shell Node.js v23.11.0/npm 11.4.1; approved verification commands resolved Node.js v22.16.0, also within the declared >=22 engine. `npm ci` installed 84 packages in this worktree using the unchanged lockfile. `npm run build` (`tsc -b`) passed after source edits and again at the final source/document review. `git diff --check` passed.

Temporary scripts live only under `/tmp/threadline-b-episode-demo-03-checks`. They are disposable acceptance checks, not shipped package tests.

- `run-demo.sh` executes Bash blocks extracted from `docs/memory-demo.md` sections 2–6, after equivalent explicit setup using this assignment's database/role/resource names. **Two complete runs passed**, each using a fresh associated project and dynamically returned task/source/memory/version identities. Both proved proposed 600 seconds does not govern, explicit acceptance and binding, actual mixed-offset exporter output capture (exit 0, CSV mismatch), observed-grade episode admission, guarded 60-second correction, retained old intent/evidence and acceptance operation, a human-accepted procedural candidate supported by the real failed episode, normal service restart and fresh CLI/MCP recall. Transcript: `demo-transcript.txt`; safe run identifiers: `demo-run-1.json` / `demo-run-2.json` under the data root. Every setup invocation pinned the absolute assigned home; home/source root/database/ports were asserted before mutation.
- `episode-checks.mjs`: **25/25 passed**. Authored file/stdin inputs; omitted precision stays authored; unknown/denied/interrupted preserved; authored commit remains proposed; unknown without uncertainty refuses; eligible observed episode has server-returned observed precision/accepted state/no accepting principal; unsupported observation refuses with no downgrade; invalid project/task/source IDs and missing key refuse with bounded field details; file and stdin oversize refuse; matching project allowed and conflicting project refused before send for all three structured commands; explicit acceptance guard still required; stale expected head settles rejected with exit 1; exact retry preserves operation/memory/version and one candidate, changed payload refuses; human/JSON committed output; corrected task authority and procedure candidate remain intact.
- `outage-mcp.mjs`: **22/22 passed**. Authored handshake, exact six read-only tools and real backend reads through each, corrected requirement/observed episode/candidate recall, unknown mutation-tool refusal and project-override refusal. Established graph connection before stopping only the assignment graph container. Same service **PID 93804** and same MCP process stayed alive; CLI and MCP reads returned `storage_unavailable`; SQL history remained readable; graph readiness/durable-memory guarantee became false. Non-wait and bounded-wait episode admission reported unresolved states with exit 3 under the same identity. Restoring the graph committed that original intent and restored reads without restarting either service or MCP. A replay kept one authored candidate. Transcript: `outage-transcript.txt`.
- `transport-checks.mjs`: **6/6 passed**, explicitly authored transport responses. Verified exactly one shared-schema route call, unmodified precision/key and no server-owned author fields sent; invalid input never posts; ambiguous/rejected/committed responses stay distinct in the follower. This is parser/follower evidence, **not a deliberately lost real graph reply**. Transcript: `transport-transcript.txt`.
- `retained-graph.mjs`: **4/4 passed**, direct read-only store verification, separate from supported CLI commands. In both demo projects the old graph version is still `superseded` with its exact 600-second content and retained `SOURCED_FROM` edges. Graph key was resolved from the assigned SQL store under the local tenant fence. Transcript: `retained-graph-transcript.txt`.
- `docs-check.py`: all **seven changed Markdown files** passed single H1, hierarchical headings, labelled/closed fences and local-link resolution. Full committed/uncommitted/untracked scope inspection found only the **ten allowed paths**. Generated assignment credential values were absent from every changed file. No frozen source or dependency changed.

### Findings and corrected verification attempts

- First fetch/commit/Docker/loopback commands were refused by the workspace sandbox and were rerun through explicit approval. No permissions were bypassed.
- Initial verification setup used the wrong backend build-output path; corrected to the package export. Its following initialization attempt was sandbox-refused before database access; the approved attempt first asserted the target and initialized only the assigned schema/store.
- The installed FalkorDB image ignores positional server arguments. The first fresh container therefore ignored the config include and init accurately reported graph unavailable. Before demo mutations, inspected the image entry point and recreated **only this assignment's fresh container** using supported `REDIS_ARGS` via an owner-only env file and the correct `/var/lib/falkordb/data` volume. Graph authentication and append-only persistence were then active and service readiness passed. No backend policy changed.
- Temporary CLI verifier initially treated early-close `EPIPE` while feeding oversized stdin as a product failure; it now attaches the actual oversized file as stdin and asserts usage exit 2. A second verifier assumption expected a settled acceptance rejection on stderr; corrected to parse the operation's JSON `state: rejected` / `errorCode: expected_head_conflict`. Final CLI rerun passed all 25 checks. Neither failed attempt is counted as passed acceptance.

### Evidence and remaining limits

The requirement/change and proposed checking procedure are public human-authored data. The exporter actually ran on disposable copies; the complete recorded stdout/stderr/exit status and mismatched public specification support each observed episode. The fixture defect was deliberately authored and is not attributed to Codex. Threadline checks evidence eligibility, not output truth. Failed support remains failed in procedural recall. Runtime source bytes/results stay outside Git; fixture expectations remain specifications.

No actual native inference/capture/hook/session identity or distinct Codex-session consumption was exercised or claimed. No claims/handoffs, validated reuse, applicability-aware context selection, production credential issuance, retention/erasure or package publication is established. Bounded context remains unavailable on this baseline; A's unmerged branch was never consumed. No reader/service credential was needed for these checks; MCP used the synthetic local owner with only its read-only tool surface. Real submitted graph reply loss/ambiguity was not deliberately triggered; authored response checks do not replace that evidence. No broad unrelated suite was run.

### Created resources and ownership

All resources below belong to this assignment; retain for review and coordinator retirement:

- Containers `threadline-b-episode-demo-03-postgres` (`postgres:18-alpine`, 127.0.0.1:55453) and `threadline-b-episode-demo-03-falkordb` (`falkordb/falkordb:6.0.2`, 127.0.0.1:56453, generated password, appendonly/appendfsync always).
- Volumes `threadline-b-episode-demo-03-pg-data` and `threadline-b-episode-demo-03-falkordb-data`. PostgreSQL database `threadline_b03`, restricted role `threadline_b03_app`, normal unchanged migrations 1–4 under `threadline_memory`; fresh versioned project graphs only.
- `/tmp/threadline-b-episode-demo-data-03` (0700), installation `home/`, immutable `home/sources/`, generated 0600 env/bootstrap/password/credential files, service logs, two fresh disposable project/exporter copies and run identifiers. No credential was copied from another installation.
- `/tmp/threadline-b-episode-demo-03-checks` (0700): temporary scripts and safe transcripts. `service.pid` under the data root identifies the still-running assignment service on 127.0.0.1:47843. Two deliberate normal demo restarts preceded the separate no-restart outage check. Both containers and the final service remain running.
- Worktree `/tmp/threadline-b-episode-demo-03` (canonical `/private/tmp/threadline-b-episode-demo-03`), own node_modules/dist/build artifacts. Previous worktrees, stores, volumes and native state were not borrowed or retired.

### Coordinator checklist and integration handoff

Proposed checklist update after merge: record the human episode command and reproducible baseline lifecycle demo as delivered, with observed evidence eligibility, authored/proposed distinction, candidate-only procedures, persistence and authored MCP recall. Keep N03 and N06 unchecked; preserve native identity/capture, context/occurrence, procedure validation, coordination and privacy gates.

The next coordinator action is **merge/confirm A first**, then request B's integration update on this same branch: fetch, normally merge origin/main into a clean B branch, review shared-schema compatibility, reconcile only B-owned product docs with A's merged capabilities, rebuild and rerun affected episode/demo/MCP checks. Then review/merge B serially. Do not merge B before that integration pass. Do not force-push, retire this worktree or start another milestone here.

### Commit, remote and PR status

- Contract bootstrap: `510550d875e41bad93cd3d9a0e01403eff857f3c`.
- Verified implementation head: `d3c1e908277111929d125cdcdb9d2a6afa14092e` ("Add human episode recording and reproducible memory demo"). The complete checked source/config/document tree was clean at commit. Source verification above applies to this exact implementation commit.
- Pushed explicitly with `git push -u origin HEAD:refs/heads/threadline/b-episode-demo-03`; `git ls-remote --heads` returned exactly `d3c1e908277111929d125cdcdb9d2a6afa14092e`. Upstream is `refs/remotes/origin/threadline/b-episode-demo-03`, never main.
- Opened exactly one normal PR through the already-authenticated GitHub UI after inspecting existing PRs: [#14 — Add human episode recording and reproducible memory demo](https://github.com/kuriyaldivyanshu/falkorDB-Hackathon/pull/14). UI verified open state, base `main`, head `threadline/b-episode-demo-03` and the exact implementation commit. No credential store or authentication tool was inspected/installed; no probe issue or unrelated message was created.
- This PR-status update is a documentation-only follow-up; no source/config changed after verification. Its resulting final commit SHA is reported in the worker handoff and PR, and can be resolved from this branch's HEAD without embedding a self-referential hash in this file. Rechecked Markdown, frozen-path scope, generated-secret absence and diff cleanliness after the update. Retained ignored artifacts are only this worktree's own installed dependencies and generated build output; runtime data/checks remain in assigned external roots.
- No merge, force push, worktree retirement, context integration or later feature work was performed. The PR explicitly records A → B integration update → B as the merge order.
