# Claude subscription: local adapter viability

**Checked 2026-10-13. Research only:** no installation, login, execution, account inspection or credential-file access. Current official documentation, not February-era summaries, governs this assessment.

## Decision

**A local TUI/package driving the official, unmodified Claude Code CLI is technically viable.** Native subscription login and programmatic operation are documented. Product distribution follows the conditions below. [Authentication](https://code.claude.com/docs/en/authentication), [Programmatic operation](https://code.claude.com/docs/en/headless)

The current product policy permits running/preinstalling unmodified Claude Code under Commercial Terms: preserve its authentication methods; each user authenticates and pays directly. It explicitly preserves end-user subscription sign-in to that binary, including hosted platforms. It separately prohibits third-party Claude-login offerings, credential/token collection or intermediation, and routing user subscription credentials through another application's inference path. [Current product/authentication conditions](https://code.claude.com/docs/en/legal-and-compliance)

**SDK distinction:** the Agent SDK overview still says third-party developers need prior approval to offer claude.ai login/rate limits through their products; it directs developers to API authentication. Do not infer permission to use SDK subscription authentication merely because it works locally. [SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)

## What the native adapter can do

Official `claude -p` runs non-interactively. `--output-format stream-json --verbose` exposes events; `--include-partial-messages` adds token deltas. Capture final messages/tool evidence rather than persisting every token. `system/init` identifies tools, MCP/plugin status and optional protocol capabilities; check failed integrations instead of assuming a successful process means memory connected. [Headless guide](https://code.claude.com/docs/en/headless)

The CLI documents streamed input, user-message acknowledgements, explicit session IDs, worktrees, MCP configuration, plugin loading and a permission-prompt MCP tool. These support a custom TUI controlling local child processes without replacing Claude's agent loop. `--tools` restricts built-in tools; `--strict-mcp-config` limits MCP discovery. `--allowedTools` approves calls rather than constituting a strict tool whitelist. [CLI reference](https://code.claude.com/docs/en/cli-reference)

Users sign in through the native flow. `claude auth status` reports the selected authentication method; a present `ANTHROPIC_API_KEY` takes precedence in print mode and can change billing. **`--bare` skips subscription OAuth/keychain login** and needs API/provider authentication, so it cannot be the default for this subscription adapter. [Authentication precedence](https://code.claude.com/docs/en/authentication), [Bare mode](https://code.claude.com/docs/en/headless)

Plugins package hooks, agents, skills and MCP configuration. An officially installed plugin/MCP extension inside the user's native Claude workflow is another delivery option; it does not require the product to own inference credentials. [Plugins](https://code.claude.com/docs/en/plugins)

## Capture, compaction and fresh recovery

Hooks expose SessionStart, user prompts, per-tool inputs/results/failures, compaction and worker lifecycle. SessionStart can add the graph context packet. PostToolUse runs after effects already happened; use PreToolUse for per-call policy and reconcile artifacts separately. Current PermissionRequest hooks also run in non-interactive cases, with unresolved requests denied—older claims that they never fire there are outdated. [Hooks reference](https://code.claude.com/docs/en/hooks)

**Proposed adapter:** tee observable submitted/assistant/tool events into the typed ledger, attach session/tool IDs and artifact evidence, then checkpoint at meaningful boundaries. Filter thinking blocks. Record incomplete capture and unknown interrupted outcomes rather than inventing a transcript.

For a clean successor, launch a new CLI session without resume/continue/fork, supply a bounded graph packet and reconcile the workspace. Native resume/fork carries earlier conversation; a new session ID alone does not prove clean context when resuming. Worktree isolation is available but does not perform guarded integration. [CLI session/worktree options](https://code.claude.com/docs/en/cli-reference)

Partial subagent transcripts and hook lifecycle output vary by version/options. Streaming supports parent tool IDs and optional nested subagent text; these must be tested on the pinned binary. SIGTERM can leave a turn without a final result, so absence of `result` requires reconciliation. [Subagent streaming and interruption](https://code.claude.com/docs/en/headless)

## Existing wrappers: evidence, not authorization

Happy's original CLI wraps native harnesses; its Claude implementation handles sessions, hooks, MCP and streamed messages. CloudCLI's provider selects a Claude executable and maps runtime/session/tool settings. These show integration mechanisms exist; their authentication choices or reliability do not establish permission for ours. [Happy implementation](https://github.com/slopus/happy/blob/main/packages/happy-cli/src/claude/claudeRemote.ts), [CloudCLI implementation](https://github.com/siteboon/claudecodeui/blob/main/server/modules/providers/list/claude/claude-runtime.provider.js)

## Event-time gate and fallback

Root's read-only executable check found no installed `claude` on this host; compatibility remains untested. After the event starts, prove one native-CLI round trip, observable capture, graph-restored clean successor, tool-guard refusal and current-worktree verification. Then add Builder/Verifier concurrency and interruption tests. The proposed hosted memory receives project events; Claude credentials remain in the official authentication path.

If native integration fails, retain the controlled runtime using documented API/provider authentication. Eligible Max/Team plans now include claimable Console API credits covering Agent SDK usage; those credits use the API route and do not convert subscription OAuth into an API credential. Do not assume eligibility for Pro or every account. [Current subscriber API credits](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers)
