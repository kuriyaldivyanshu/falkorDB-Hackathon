# Agent B prompt: Codex qualification and native boundary modules

Follow AGENTS.md and [the parallel work rulebook](../parallel-work-rulebook.md) in full. Read this assignment before editing. Use only its reserved worktree/branch, writable paths and resources. Complete this checkpoint, verify it, commit/push its feature branch and open one PR. Review fixes stay with that PR; the coordinator handles merge and retirement. The next milestone gets a fresh worktree.

## Assignment contract

- **ID/owner:** `b-codex-qualification-01`, Agent B.
- **Outcome:** establish the supported/unsupported/unqualified installed Codex integration boundaries and deliver verified pure native-edge preparation without backend integration.
- **Checkpoint:** an observed qualification report, native integration contract and bounded adapter modules justified by those findings. This is not the N03 end-to-end memory milestone.
- **Baseline:** freshly fetched `origin/main` after this rulebook/assignment PR is merged. Record the full SHA before editing.
- **Branch:** `threadline/b-codex-qualification-01`.
- **Worktree:** `/tmp/threadline-b-codex-qualification-01`.
- **PR:** feature branch → `main` in this repository's `origin`; one PR for this assignment.
- **Authority:** native read-only inspection, temporary authored protocol/module checks, implementation within the allowlist, commit/push of this feature branch and PR creation. No merge, main push, native account/configuration mutation or inference.

The coordinator reserves this branch/path and delegates their creation to you if absent. Verify unused names, correct clean starting state and the rulebook on fetched main. Create from the resolved full SHA. If the branch/path already exists, report rather than recycle it. Do not edit the original checkout or depend on Agent A's branch.

## Read and preserve

Read README.md, CONTEXT.md and docs/development-checklist.md. Codex keeps authentication, inference, tools, permissions and execution; Threadline supplies memory.

Optional read-only references in the original checkout:

- `/Users/dkuriyal/Desktop/falkorDB-Hackathon/docs/plans/track2-codex-first-adapter-contract.md`
- Narrow sections of `/Users/dkuriyal/Desktop/falkorDB-Hackathon/archive/codex`

Use current official OpenAI documentation and installed CLI help/protocol/schema output as primary research. An archived/moving source snapshot is a hypothesis, not proof of installed behavior. Do not read archived credentials or copy whole reference implementations.

## Writable paths and frozen boundaries

You own:

- `packages/cli/src/codex/**` — new native-edge modules only
- `assets/codex/**` — clearly labelled preview templates/compatibility metadata only
- `docs/native-integration-contract.md` — tracked findings and integration handoff
- This assignment file's result/status record

Everything else is read-only. Keep backend/shared code, existing CLI entry/options/client, root/product docs, the shared checklist, rulebook, manifests/lockfiles, build/Compose configuration and `.gitignore` unchanged.

Use existing dependencies and Node built-ins. Do not install an SDK or wire new public commands in this checkpoint. Disposable protocol probes can live outside the repository; a raw probe server is not a production MCP implementation.

Agent A owns backend memory. You must not call its evolving endpoints, change shared contracts or implement a replacement memory service. Record exact future SDK/entry-point/backend requests for the later integration assignment.

## Runtime and privacy boundary

- Temporary probe root: `/tmp/threadline-b-codex-qualification-data-01`.
- No Threadline service, database, Docker or shared ports are allocated to you.
- Protocol probes use stdio or explicitly ephemeral temporary listeners only, never another assignment's service.
- No existing user Codex profile/config/authentication files are writable.

Do not read/copy auth.json, keychains, provider tokens, private native history or full environments. Do not install configuration in the real native home, change approvals/sandbox, initiate login, start model inference or borrow credentials.

Native CLI help, version and supported schema inspection are permitted. If proving a runtime boundary requires inference/account data/configuration mutation outside this scope, document the smallest required authorized probe and leave that capability unqualified. Continue independent in-scope preparation.

## B1. Qualify the native surface

Establish the installed version and investigate:

1. Profile/configuration discovery and explicitly scoped project-local fallback.
2. Hook schema, trust, supported event types and event payloads.
3. Supported context output boundaries and spill/size behavior.
4. Local stdio MCP startup and request envelopes.
5. Thread/root/session/turn/item/tool identifiers and fork/subagent ambiguity.
6. Safe ownership, collision and removal behavior for future native installation.

For each finding record one of: documented; observed on installed binary; unsupported; unverified. Include exact version, source/command and relevant limitations. Do not turn authored input into native runtime evidence.

Timebox the primary configuration investigation to two hours; use the documented project-local fallback for the remaining one-hour seam budget if necessary. A bounded negative finding is acceptable investigation output. It is not a passing native integration milestone.

## B2. Establish the MCP identity conclusion

Static enrollment is project scope, not proof of which conversation called a tool. Investigate whether the installed host supplies identity metadata correlatable with hook/thread identity, including missing/stale/overridden/fork cases.

Do not infer the actor from the latest hook, timestamps, a PID or model-supplied arguments. Archived `_meta` implementation details must be qualified on the supported binary before model writes are enabled.

If the strong identity path cannot be observed under this assignment's authorization, recommend a precisely labelled read-tool/human-mutation surface. Mark model-written memory/handoff support unqualified; do not silently weaken its gate.

## B3. Implement justified pure native-edge modules

Create only modules supported by the investigation and useful to the next integration:

- **Event normalization:** allowlisted visible event kinds, known native correlation, explicit completeness/gaps/exclusions, bounded input and safe unknown-event behavior.
- **Hook output rendering:** native protocol shape, stdout purity, UTF-8 byte bounds, bounded refusal/degradation and no silent mandatory truncation.
- **Configuration preview:** deterministic rendering from trusted executable/argument/enrollment values, non-secret placeholders, collision/ownership-manifest design and safe quoting. Preview only; no real configuration writes.

Use injected delivery/context callbacks for the future seam. These are adapter dependencies, not duplicate Source/Memory/Operation/Context contracts. Reuse existing shared types read-only where useful; request changes rather than editing them.

Use temporary authored event/output fixtures and callers to verify pure functions. Record that this establishes module/protocol handling only. Keep the native adapter unavailable in public capabilities until a later integrated runtime gate passes.

Do not add a custom coding frontend, launch supervisor, extraction model or memory database to fill the missing backend connection.

## B4. Deliver the tracked integration contract

Write docs/native-integration-contract.md with:

- Exact observed native version and selected route/fallback.
- Documented versus runtime-observed hook/context/MCP boundaries.
- Supported event shapes and payload/output bounds.
- Identifier precision, missing/ambiguous identity policy and write gate.
- Threadline-output capture-recursion exclusions.
- Install/disconnect ownership, collision and edited-file behavior.
- Required future backend operations and CLI/SDK/dependency requests.
- Exact remaining authorized runtime checks and limits.
- Verification results safe to review without local ignored/temp files.

Do not redefine core wire schemas or declare N03 complete. The next integration assignment consumes this contract only after the needed backend work is merged.

## Acceptance and PR

The investigation is complete when findings/limits and the next required probe are precise, useful modules build and pass their authorized focused checks, the tracked handoff is self-contained, and scope has not crossed into backend/native account mutation.

Run `npm run build`, documentation/diff/ownership checks and relevant authorized temporary/manual checks. Do not recreate a permanent package test suite.

Finish the rulebook checkpoint/push/PR gates and open one PR. Use draft status for incomplete assignment acceptance. Documented native unknowns can remain explicit in a completed qualification/preparation checkpoint; the corresponding product capability stays unchecked/unqualified.

Stop at this checkpoint. Production MCP dependency installation, CLI dispatch, enrollment persistence and actual memory injection are a new assignment/worktree after prerequisites merge. The coordinator handles shared checklist changes and retirement.

## Result record — owner fills during the assignment

- Status: COMPLETE for this qualification/preparation checkpoint. Native
  runtime hook execution, MCP tool-call identity and the N03 slice remain
  unqualified and are listed below with their required probes. N03 is not
  marked complete.
- Base ref/full SHA: `origin/main` at `38435dfa3273be21cf75525dc23b6a8b7973ba01`
  (merge of the parallel-work-rulebook PR #8), verified equal to local `main`
  before worktree creation.
- Actual worktree/branch: worktree `/tmp/threadline-b-codex-qualification-01`
  (canonical `/private/tmp/threadline-b-codex-qualification-01`), branch
  `threadline/b-codex-qualification-01`, created from the resolved SHA, no
  upstream configured before the first push. The original checkout was not
  edited; Agent A's worktree was not touched.
- Observed native version/route and identity conclusion: `codex-cli 0.163.0`
  (`/opt/homebrew/bin/codex`). Route: documented profile file
  `$CODEX_HOME/threadline.config.toml` selected with `codex --profile threadline`
  (observed layering through `codex -p threadline mcp list --json`); the legacy
  `profile = "..."` key is refused and `--profile` is refused for
  `codex app-server`. Identity conclusion: hook `session_id` plus parent-session
  semantics for subagents is `provisional` only; archived `_meta.threadId`/
  `sessionId` for MCP tool calls stays a hypothesis (unverified on 0.163.0).
  Model-issued memory writes stay gated; interim surface is a read-only MCP
  tool plus human-driven mutation.
- Temporary resources/processes: temporary probe root
  `/tmp/threadline-b-codex-qualification-data-01` holds generated app-server
  schemas, the isolated `CODEX_HOME`, authored probe scripts, downloaded doc
  copies and verification scripts. No probe process was left running; no
  Threadline service, database or shared port was used; the real native home
  was never modified.
- Modules and exact verification/results: new modules
  `packages/cli/src/codex/events.ts`, `hook-output.ts` and `config-preview.ts`,
  plus preview/evidence assets under `assets/codex/`. `npm run build` (`tsc -b`)
  passes. 109 authored module checks pass (temporary script outside the repo):
  event normalization (12 known events, unknown/malformed/oversized input,
  64 KiB text bounds with `partial` completeness and code-point-safe cut, no
  lone surrogates, correlation gaps for unusable session/turn/tool/agent
  references), hook output (single-line purity, 4 KiB/8 KiB bounds,
  refusal-by-default, marked truncation, unsupported events), config preview
  (deterministic bytes and digests, TOML/shell quoting, ownership states
  absent/owned/edited/foreign including stale-but-owned files recognized by the
  recorded manifest digest and the JSON manifest's `kind`/`marker` fields).
  The rendered profile parsed under Python `tomllib`, was accepted by the
  installed binary (`codex -p threadline mcp list --json`), and
  `debug prompt-input` with that profile spawned the rendered stdio server and
  completed the MCP handshake.
- Runtime observations versus authored checks and unqualified behavior:
  observed on the installed binary — hook discovery/sources/trust state,
  project-trust gating, `hooks/list` metadata, inline TOML hook shape via
  `sessionFlags`, MCP stdio startup handshake, profile layering, schema enums
  and `additionalContextLimit` semantics. Authored checks establish module and
  protocol handling only. Unqualified: native hook stdin/stdout execution,
  `additionalContext` delivery and spill at runtime, MCP `tools/call` `_meta`
  identity, fork/subagent correlation, profile-layer hook loading.
- Required integration/authorization and proposed checklist updates: three
  human-authorized probes are recorded in `docs/native-integration-contract.md`
  (live session with trusted hooks; authorized turn against a logging stdio
  server; fork/subagent turn). Backend requests: session registration with
  provisional precision, batched source append, context preparation and
  occurrence recording, and a decision on read access for provisional
  identity. CLI requests: `threadline codex-hook`, `threadline mcp`,
  `threadline codex config-preview`. Proposed checklist updates for the
  coordinator: mark the N00 native probe line satisfied by this bounded
  qualification (installed version, configuration route, hook discovery/trust,
  MCP startup, identity limits) while keeping N03 unchecked with the recorded
  unqualified list; optionally add a line under section 6/7 noting that the
  native adapter stays absent from public capabilities until the live probes
  and backend work land.
- Final commit/remote confirmation/PR URL: commit
  `2651d65c5127039e4625889166e14ff304ab807b` on
  `threadline/b-codex-qualification-01`, pushed with
  `git push -u origin HEAD:refs/heads/threadline/b-codex-qualification-01`;
  `git ls-remote origin refs/heads/threadline/b-codex-qualification-01` returned
  the same SHA (verified). **PR not created:** no supported authenticated
  GitHub route exists in this environment (`gh`, `hub` and `glab` are absent,
  and installing tools or borrowing credentials is outside this assignment).
  Existing PRs were inspected with `git ls-remote origin 'refs/pull/*'`
  (only refs/pull/1..8 exist, none matching this branch); the push output
  offered the create link, so no PR exists for this branch yet. Open it with
  base `main` and head `threadline/b-codex-qualification-01`:
  `https://github.com/kuriyaldivyanshu/falkorDB-Hackathon/pull/new/threadline/b-codex-qualification-01`
  (a create link, not a claim that a PR exists).
- Retirement handoff: the worktree may be retired after merge; the temporary
  probe root is disposable once the PR is reviewed, and `archive/codex` was used
  read-only as a hypothesis source.
