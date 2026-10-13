# Track 2 portability: shared FalkorDB core, host adapters

**Research snapshot: 11 October 2026.** Primary documentation and selected tagged source were inspected. No package, hook, coding host, or database integration was installed or executed. Everything below distinguishes documented interfaces from proposed product behavior. Implementation and interface design remain for the permitted hackathon start on 15 October; commit dates do not establish when work began.

**Recommendation:** build an attachable memory/coordination package, with one FalkorDB service and thin adapters. For this four-person team, propose two deep integrations—Codex CLI and Claude Code—and a common MCP tool route for OpenCode and Hermes. Promote the latter to automatic lifecycle integration only after actual host-specific tests. A new full coding harness would add model transport, permissions, terminal/file tooling, session management and UI maintenance to a project whose differentiator should be evidence-linked recovery.

This updates the earlier one-adapter recommendation to reflect the user's four-member team. Codex contracts are covered by the parent research; they were not independently re-audited here. Existing competitors and fair baselines remain in [the harness report](track2-harness-and-alternatives.md), and the proposed graph/state rules in [the continuity proposal](track2-continuity-architecture.md).

## What portability actually means

Generic MCP supplies callable tools and their results. A server does not thereby receive every native file edit, observe host compaction, insert context after a reset, or acquire a native worker-spawning API. A host may expose those capabilities through an adapter, and a model may voluntarily invoke memory tools; neither follows merely from registering an MCP server. OpenCode and Hermes explicitly document MCP as external tools. [OpenCode MCP](https://opencode.ai/docs/mcp-servers/), [Hermes MCP](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp).

Use distinct support labels:

| Support level | Claim allowed after testing |
|---|---|
| MCP compatible | The host can call the scoped memory/coordination tools. Recording and recovery require explicit invocation. |
| Lifecycle integrated | A tested adapter captures selected events and injects a current recovery pointer/packet at specified boundaries. |
| Coordinated workers | Native delegation is linked to exact task IDs, and shared-state writes enforce revisions and authorized worker scope. |

None means perfect memory, automatic capture of unrecorded reasoning, or enforcement of every native shell/file action.

## Documented capability matrix

Each cell describes an available seam, **not runtime-tested compatibility**. The MCP-only column applies to our proposed ordinary server, without host-specific control tools.

| Capability | MCP tools alone | OpenCode adapter | Hermes adapter | Claude Code adapter |
|---|---|---|---|---|
| Selected tool capture | Only calls/results routed through our server | `tool.execute.before` / `tool.execute.after` | `pre_tool_call` / `post_tool_call` | Settings hooks or mod `tool.call` wrapping `next(e)` |
| Context injection | Tool result when called; instructions do not ensure invocation | Experimental pre-summary hook; SDK prompt with `noReply` adds context | `pre_llm_call` can return `{"context": ...}` once per turn | Settings `SessionStart` supports recovery; mod `prompt.submit` can add context |
| Compaction observation | No generic lifecycle feed | `experimental.session.compacting`, `session.compacted` | Gateway `session:compress`; auxiliary observers and native hooks have different contracts | Settings compact hooks; mod `session.compact` before compaction |
| Session/context control | No native guarantee | SDK `session.create`, `session.prompt`, `session.summarize`, `session.abort` | Native session commands; no automatic reset promised by this package | Mod `$.session.compact`; lifecycle semantics differ from settings hooks |
| Native worker control | No native guarantee | Native Task/subagents; SDK sessions are also available | Native `delegate_task`; subagent lifecycle hooks observe it | Native subagents/teams; mod `$.agent.spawn`, `$.agent.list`, `$.session.send` |
| Useful identity inputs | Configured connection identity, not necessarily host session/worker | Project, directory, worktree; session IDs through host interfaces | Hook session/parent/task/turn IDs; HTTP profile header optional | `$.session.id/cwd`; worker IDs; explicit assignment task ID still needed |
| Authorization | Our server must enforce it | Per-agent tool filters are not graph-row authorization | Profile/identity header is not proof of tenant authority | Agent/session IDs are routing facts, not a substitute for server authorization |

Matrix sources: [OpenCode plugins](https://opencode.ai/docs/plugins/), [OpenCode SDK](https://opencode.ai/docs/sdk/), [OpenCode agents](https://opencode.ai/docs/agents/), [Hermes hooks](https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks), [Hermes delegation](https://hermes-agent.nousresearch.com/docs/user-guide/features/delegation), [Claude settings hooks](https://code.claude.com/docs/en/hooks), [Claude mods reference](https://code.claude.com/docs/en/plugins/mods/reference). No host adapter was exercised.

## OpenCode: npm-friendly, but compaction injection is a prompt influence

OpenCode loads JavaScript/TypeScript plugins from local directories or the `plugin` array in configuration; npm dependencies are installed using Bun at startup. Plugins receive a SDK client and workspace information. Its experimental compaction callback may append `output.context` or replace `output.prompt`; this runs **before the model generates a continuation summary**. Setting the prompt replaces the default and ignores the context array. It does not guarantee that every supplied fact survives summarization. [Plugin contract and examples](https://opencode.ai/docs/plugins/).

The SDK also documents `event.subscribe()` and session creation, prompts, summarization and abortion. `session.prompt` with `body.noReply: true` injects a message without an AI response, providing a possible recovery seam whose timing still needs testing. Native subagents and Task permissions exist separately. Creating another session does not automatically produce a scoped worker contract or merge its edits. [SDK](https://opencode.ai/docs/sdk/), [Agents](https://opencode.ai/docs/agents/).

For the initial compatibility route, configure a local MCP process through `mcp.<name>.type = local` and a command array such as `npx -y <published-package>`, or a remote URL. `cwd` can bind the process to a workspace. The host supports per-agent tool selection. [MCP configuration](https://opencode.ai/docs/mcp-servers/).

**Unresolved:** the installed version, exact plugin types, event ordering, fresh-session injection and recovery from missed events. The live documentation was updated 10 October; source-file fetches for the plugin type definition failed in this research session. Do not describe the adapter as source-audited or working across all OpenCode versions.

## Hermes: real native hooks, different packaging and lifecycle

Hermes offers Python plugins with `plugin.yaml` and `register(ctx)`, plus shell hooks. These can inject dynamic per-turn context and observe tool/worker events. Gateway hooks in `HOOK.yaml` are a distinct gateway-only surface; do not use their `session:compress` name as if it were a shell-hook name. Successful-turn `post_llm_call` is absent on interruption, so it cannot be the sole checkpoint recorder. Hermes also documents a built-in stale-verification nudge and a `pre_verify` continuation gate: reminders to verify code are already native coverage. [Hook contracts](https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks).

Session observers distinguish a completed/interrupted run from final conversation teardown. `on_session_end` is run-scoped; `on_session_finalize` and `on_session_reset` have separate meanings. [Observer lifecycle](https://hermes-agent.nousresearch.com/docs/developer-guide/observer-hooks).

The tagged **v0.21.6** registration set confirms `pre_llm_call`, tool hooks, session start/end/finalize/reset and subagent start/stop. That establishes registered names, not the correctness of our future callbacks. This release is dated 8 October, while some packaged desktop/mobile distributions may lag. [Tagged plugin source](https://github.com/NousResearch/hermes-agent/blob/v0.21.6/hermes_cli/plugins.py), [Release](https://github.com/NousResearch/hermes-agent/releases/tag/v0.21.6).

Its portable Agent Plugins v1 subset supports skills and MCP components; it does not replace a native Python lifecycle plugin. Packages need enabling, and native distribution can use a plugin directory or Python entry point. [Plugin packaging](https://hermes-agent.nousresearch.com/docs/developer-guide/plugins).

MCP configuration is under `mcp_servers` in `config.yaml`, with executable/argument fields or remote URLs. An HTTP `identity_header` can send a configured identity or profile name; invalid blocks are ignored with a warning, and stdio does not use them. Treat that header as routing metadata and authenticate separately. [MCP contract](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp).

Native delegation creates isolated worker context and returns a result; children cannot use the native memory-write tool. Do not infer that inherited third-party MCP access should permit unrestricted shared writes. [Delegation](https://hermes-agent.nousresearch.com/docs/user-guide/features/delegation). Native memory files use a frozen session-start prompt snapshot, so cross-session writes do not automatically refresh already-running sessions. [Memory lifecycle](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory).

## Claude Code mods: an optional rich adapter, not a separate harness

Claude now documents mods as in-process JavaScript/TypeScript plugin handlers. They can add commands and UI panes. Hooks run in headless sessions, but panes appear only in supported terminal/Desktop surfaces; Desktop WSL sessions are excluded. This verifies the current product surface, not that it is the specific mod product the user previously saw. [Mods overview](https://code.claude.com/docs/en/plugins/mods/overview).

**Important trap:** mod `session.start` runs on load/reload, **not** after `/clear`, `/resume` or `/branch`. Do not base automatic recovery solely on it. The reference supplies `session.append`, `prompt.submit`, compaction and worker seams listed above. Settings `SessionStart` remains a different recovery surface. [Mods reference](https://code.claude.com/docs/en/plugins/mods/reference), [Settings hooks](https://code.claude.com/docs/en/hooks).

The mod can reach the shared core via `$.mcp.call` or `$.http.fetch`; session messages and native worker APIs avoid inventing a second orchestrator. `$.model.fork` is a model call with conversation context whose tools cannot be called; it is not an autonomous coding worker. [Mods API](https://code.claude.com/docs/en/plugins/mods/api).

Mods require Claude Code **v2.1.287 or later**. Loading with `--plugin-dir` emits installed-build declaration files into `.claude-plugin/types/`. Use those types, not assumptions from live docs. The module has restricted imports and no ordinary Node access; keep the FalkorDB client in the external core. [Create guide](https://code.claude.com/docs/en/plugins/mods/create).

For the two-adapter MVP, prefer ordinary Claude settings hooks plus MCP first. Add a mod pane only if it makes current goal, invalidated assumptions and worker receipts easier to inspect and the lifecycle probe passes.

## Proposed package boundary and four-member scope

**Shared core:** authenticated scope, typed graph records, guarded revisions/claims, evidence receipts, task context compilation and selective publication. Substantial logs stay outside the graph with permitted immutable references. Extraction proposes facts; it cannot independently authorize a goal change or mark work verified.

**Persistent conversation history is a separate obligation:** retain scoped `Session` and `Message` records, actual captured content or immutable content references, role, host message/tool IDs, sequence, parent session and capture status. Link these to tasks, attempts, decisions and receipts. Summaries support retrieval; they do not substitute for the captured history. This schema is proposed. Claude documents `$.session.messages()` for transcript rows; OpenCode exposes session messages through its SDK. These are feasible capture/reconciliation seams, not proof that every streaming/interrupted event is safely retained. [Claude API](https://code.claude.com/docs/en/plugins/mods/api), [OpenCode SDK](https://opencode.ai/docs/sdk/). Codex transcript formats are covered separately and may be unstable. A missed interval must remain explicitly unknown until reconciled; do not reconstruct an authoritative conversation from model recollection.

**Procedural-memory acceptance:** demonstrate one recorded workflow with applicability conditions, source attempts and verification receipts, then reuse it on a later held-out task and verify the result. Broad autonomous strategy learning is stretch scope. Session history, episodic attempts, semantic facts and a procedure each need explicit capture/retrieval evidence; one shared summary does not demonstrate all four.

**Adapters:** normalize host IDs/events, pass exact task and worktree IDs during native delegation, capture selected receipts, and inject a bounded current task packet or pointer. The coding host keeps its model, permissions, sessions and workers. Adapters must report unsupported capture/recovery boundaries visibly.

**Installer proposal:** a future `npx <package> init --host <host>` could inspect host/version, show the configuration changes, add only owned entries, preserve existing configuration, and provide doctor/uninstall operations. This command does not exist yet. npm execution does not itself provision FalkorDB, resolve Python plugin dependencies, obtain host credentials or bypass hook/plugin consent.

Suggested ownership after the event starts: one member owns graph protocol/context compilation; one Codex adapter; one Claude adapter; one evaluation fixtures, package setup and inspection UI. Integration is shared responsibility. OpenCode/Hermes receive documented MCP examples and smoke tests first; deep adapters are stretch work.

The decisive test is a fresh authorized worker receiving only a task ID, recovering its current constraint/decision closure, detecting changed evidence, and declining a stale worker's completion claim. Compare against the same captured facts in versioned files with deterministic freshness checks. Installation convenience and a graph view are useful product features; they are not evidence of better task outcomes.
