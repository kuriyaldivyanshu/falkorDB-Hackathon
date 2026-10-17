# Native integration contract (Codex)

This document is the tracked handoff from the Codex qualification checkpoint
(`b-codex-qualification-01`). It records the installed native surface Threadline
may use, how each boundary was established, what remains unqualified, and the
exact checks required before a later assignment may enable more.

Status: **qualification and preparation only.** The native adapter stays
unavailable in public capabilities, and N03 (session-to-session memory) is not
complete. No Threadline command installs native configuration, starts inference
or writes memory in this build.

## Evidence classes

Every finding below is labelled with one of:

- **documented** — stated by current official OpenAI documentation, with the
  source URL;
- **observed** — produced by the installed binary in this checkpoint, with the
  exact safe command;
- **unsupported** — the installed binary or documentation explicitly rejects it;
- **unverified** — plausible but not proven on the installed binary.

An authored payload establishes parser behavior, never native runtime behavior;
`observed` therefore names the surface it was observed on (for example the
app-server stdio surface).

## Qualified environment

- Installed binary: `codex-cli 0.163.0`, `/opt/homebrew/bin/codex`
  (observed: `codex --version`), macOS arm64, Node.js v23.11.0.
- Protocol schema bundle (observed): `codex app-server generate-json-schema
  --out <dir>`. Digests of the cited files are recorded in
  `assets/codex/compatibility.json`.
- All probes ran with an isolated `CODEX_HOME` under the assignment's temporary
  root and authored inputs. No real native configuration, credential or history
  was read or written, no login was performed and no model inference was
  started.

## Selected route and fallback

The selected route is the documented profile file:

```toml
# $CODEX_HOME/threadline.config.toml
[mcp_servers.threadline]
...
```

selected with `codex --profile threadline`. Reasons:

- **Observed:** the profile file layers on the base user config; with an
  isolated `CODEX_HOME`, `codex -p threadline mcp list --json` listed the
  profile's stdio server while the base config listed none.
- **Observed:** the legacy `profile = "..."` config key is refused:
  `Error: legacy \`profile = "..."\` config is no longer supported; use
  \`--profile ...\` with \`....config.toml\` instead`.
- **Observed:** `--profile` applies only to runtime commands and `codex mcp`
  (the binary lists: `codex`, `codex exec`, `codex review`, `codex resume`,
  `codex queue`, `codex archive`, `codex delete`, `codex unarchive`,
  `codex fork`, `codex mcp`, `codex sandbox`, `codex debug prompt-input`).
  `codex app-server` refuses it, so app-server-based automation cannot select
  the profile.
- The profile keeps the footprint explicit: sessions started without the
  profile load nothing from Threadline, and no user-global `hooks.json` (which
  would affect unrelated projects) is involved.

Documented fallback (not used): project-local `<repo>/.codex/hooks.json` or
`<repo>/.codex/config.toml`, which loads only when the project `.codex` layer is
trusted. It is the documented route if per-project files are preferred, but it
installs native files into the user's repository.

## Hook boundary

### Discovery and layers

- **Documented**
  (https://learn.chatgpt.com/docs/hooks): hooks are discovered next to active
  config layers as `hooks.json` or inline `[hooks]` tables. All matching hooks
  load; higher-precedence layers do not replace lower ones. A single layer
  should use one representation, because mixing them merges with a startup
  warning.
- **Observed:** the installed binary discovers and lists hooks through
  `hooks/list` on the app-server stdio surface with sources `user` (from
  `$CODEX_HOME/hooks.json`), `project` (from `<repo>/.codex/hooks.json`),
  and `sessionFlags` (from `-c 'hooks.<Event>=[...]'` overrides). Discovery
  reports `eventName`, `handlerType`, `command`, `matcher`, `timeoutSec`,
  `additionalContextLimit`, `sourcePath`, `currentHash` and `trustStatus` per
  handler. The inline TOML shape (`[[hooks.SessionStart]]` /
  `[[hooks.SessionStart.hooks]]`) is accepted by the installed config parser.
- **Observed:** project-local hooks are disabled until the project is trusted.
  With an untrusted project the binary emits: "Project-local config, hooks, and
  exec policies are disabled in the following folders until the project is
  trusted…", and `hooks/list` returns no project hooks. Trust is granted in
  `config.toml`:

  ```toml
  [projects."/absolute/project/root"]
  trust_level = "trusted"
  ```

- **Unverified:** hooks declared in a profile layer (`threadline.config.toml`)
  load only when the profile is selected; the layer behavior is documented, the
  inline shape is observed, but the profile-layer combination was not observed
  because `codex app-server` cannot select a profile.

### Trust

- **Documented:** non-managed hooks must be reviewed and trusted before they
  run; trust is recorded against the hook's current hash, so a changed hook is
  marked for review and skipped. `/hooks` reviews, trusts or disables hooks.
  `--dangerously-bypass-hook-trust` exists for vetted automation.
- **Observed:** every newly discovered non-managed hook reports
  `trustStatus: "untrusted"`. Writing the trust state into an isolated config
  layer (`[hooks.state."<key>"] trusted_hash = "<currentHash>"`) flipped the
  matching handler to `trusted` and left the others `untrusted`.
- **Observed:** hook state keys embed the source path, and canonicalization is
  not normalized consistently between layers (the same file appeared as
  `/private/tmp/...` in the user layer and `/tmp/...` in the project layer on
  macOS). A future installer must never synthesize trust state keys itself.
- Consequence: Threadline installation cannot self-trust hooks. The human
  reviews and trusts them once through `/hooks`, or explicitly passes the
  bypass flag for a vetted one-off automation.

### Event allowlist

**Observed** (installed schema `v2/HooksListResponse.json`, `HookEventName`):
`preToolUse`, `permissionRequest`, `postToolUse`, `preCompact`, `postCompact`,
`sessionStart`, `sessionEnd`, `userPromptSubmit`, `subagentStart`,
`subagentStop`, `stop`, `interrupt`.

**Documented** timing and per-event behavior (hooks page, "Hooks" section):
`SessionStart` matcher filters `source` (`startup`, `resume`, `clear`,
`compact`, `fork`); `SessionEnd` runs for the main thread when a session closes,
is archived/deleted or idle for 30 minutes, never for subagents, with a
1–3 second timeout; `SubagentStart`/`SubagentStop` matcher filters `agent_type`;
`Interrupt` carries the interrupted turn id; `Stop`/`SubagentStop` expect JSON on
stdout (plain text is invalid) and `decision: "block"` means "continue with this
reason"; `UserPromptSubmit` has no matcher.

### Input payloads

**Documented** common fields for every command hook: `session_id`,
`transcript_path`, `cwd`, `hook_event_name`, `model`; turn-scoped events add
`turn_id`; `permission_mode` appears on `SessionStart`, `PreToolUse`,
`PermissionRequest`, `PostToolUse`, `UserPromptSubmit`, `SubagentStart`,
`SubagentStop`, `Stop` and `Interrupt`. `SubagentStart`/`SubagentStop` add
`agent_id` and `agent_type`. Tool events add `tool_name`, `tool_use_id` and
`tool_input`/`tool_response`. `Stop`/`SubagentStop` add `stop_hook_active` and
`last_assistant_message`.

**Documented:** subagent hooks report the **parent** `session_id`, and
`transcript_path` points at a transcript whose format "isn't a stable interface
for hooks and may change over time".

**Unverified:** the exact stdin object the installed binary writes for each
event. The smallest probe that establishes it is listed below.

### Output contract and stdout purity

**Documented:** a hook's stdout is protocol output. Exit `0` with no output is
success. `PreToolUse` and `PermissionRequest` accept only `systemMessage` (and
the hook-specific decision shapes); returning `continue`, `stopReason` or
`suppressOutput` there marks the hook run failed while the tool call continues.
`additionalContext` is documented only for `SessionStart`, `UserPromptSubmit`,
`SubagentStart`, `PreToolUse` and `PostToolUse`. `PostToolUse` additionally
accepts `continue: false` and `stopReason`.

**Implemented:** `packages/cli/src/codex/hook-output.ts` renders exactly one JSON
line for supported context events and otherwise emits nothing (the documented
success path), so a Threadline failure can never block a native run. It refuses
to use `additionalContext` on events that do not support it.

### Context bounds and spilling

- **Documented:** context and other model-visible hook output is limited to
  roughly 2,500 tokens by default; larger output is **spilled** to
  `<temp_dir>/hook_outputs/<session_id>/<uuid>.txt` and replaced with a
  head-and-tail preview plus the saved path. `additionalContextLimit` sets that
  threshold per handler: omit for the default, a positive integer for a custom
  threshold, and `0` to pass the handler's text through unchanged.
- **Observed** (installed schema description): "Configured `additionalContext`
  spill threshold. `null` uses 2,500 tokens; `0` disables spilling." The value
  survives discovery per handler, including `0`.
- Policy: the profile preview sets `additionalContextLimit = 0` only on the
  four installed context events and additionally enforces a hard UTF-8 byte
  bound in the adapter (4 KiB default, 8 KiB maximum), because the documented
  guidance is to use `0` only when the hook itself enforces a strict cap.
- Overflow behavior: refusal by default (no partial authority), or an
  explicitly marked truncation when the caller chooses it; neither path is
  silent, and both are reported on stderr. This matches the released context
  contract, where mandatory overflow refuses rather than degrading.

## MCP boundary

### Local stdio configuration

**Documented** (https://learn.chatgpt.com/docs/config-file/config-reference):
`mcp_servers.<id>` with `command` (required), `args`, `env`, `env_vars`, `cwd`,
`required`, `startup_timeout_sec` (default 10) and `tool_timeout_sec` (default
60). **Observed:** the rendered preview profile was parsed by the installed
binary and `codex -p threadline mcp list --json` reported the server with the
exact rendered `command`, `args` and `env`.

### Startup handshake

**Observed** (installed binary spawning an authored stdio server during
`codex -p threadline debug prompt-input <text>`; no inference occurred):

```json
{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{"experimental":{"codex/auth-change":{}},"elicitation":{"form":{},"url":{}}},"clientInfo":{"name":"codex-mcp-client","title":"Codex","version":"0.163.0"}}}
```

followed by `notifications/initialized` and `tools/list` with
`params._meta = {"progressToken":0}`. Tool definitions are fetched at startup;
the model-visible prompt input produced by `debug prompt-input` did not include
the MCP tool definitions in this offline mode, so that path is not evidence
about tool schemas reaching the model.

### Tool-call envelopes and identity

**Unverified on the installed binary.** A `tools/call` only happens inside a
model turn, which requires authorized inference. The archived source snapshot
(the `archive/codex` research copy) computes host-owned request `_meta` for MCP
tool calls containing `threadId`, `sessionId` and optional `windowId`/`itemId`;
this remains a hypothesis and must be qualified before any model-written memory
path depends on it. The smallest probe that would qualify it is listed below.

## Identity conclusion and write gate

- `session_id` is the only identity the hook envelope supplies, and subagent
  hooks report the parent session id. `SessionStart` distinguishes a fork
  through `source: "fork"`, but the hook alone still cannot prove which thread
  produced an arbitrary event. Hook capture therefore records
  `identityPrecision: "provisional"` and an explicit correlation gap when the
  identifier is present but unusable.
- A project-scoped enrollment is not proof of which conversation called a tool.
  Timestamps, process ids, the latest hook and model-supplied arguments are
  never correlation evidence.
- **Write gate:** model-issued memory mutation stays disabled until the MCP
  tool-call identity path is observed on a supported binary and a single
  conversation can be proven. Until then the integration contract requires the
  interim surface: a read-only MCP tool plus human-driven mutation
  (for example a human-run CLI command) — never an implicit write.

## Capture-recursion exclusions

- Threadline's own MCP tool calls (`mcp__threadline*` tool names) are excluded
  from capture; capturing them would make memory about memory.
- Hook-injected `additionalContext` is not captured as evidence; it is a
  delivery, recorded separately as a context occurrence.
- Threadline hook and MCP processes write protocol output only to stdout; every
  diagnostic goes to stderr. A hook process never triggers further capture.
- Transcript files referenced by `transcript_path`/`agent_transcript_path` are
  never opened by the adapter; the documented instability of that format plus
  the capture policy both require a separate decision.

## Install and disconnect ownership

- The preview writes nothing. When a later assignment implements installation,
  only `owned` files may be replaced: the ownership marker line must be present
  **and** the file bytes must match the manifest digest exactly.
- `checkPreviewOwnership` classifies a target as `absent`, `owned`, `edited` or
  `foreign`. `edited` (marker present, bytes differ) always requires human
  resolution; `foreign` (file exists without the marker) is never modified or
  removed, including foreign `[mcp_servers.threadline]` entries.
- Disconnect removes only owned blocks in owned files, then reports what was
  left in place. Hook trust state entries are human-owned; Threadline reports
  them instead of editing them.
- Every managed block is delimited by `# threadline:begin <id>` /
  `# threadline:end <id>` lines so ownership survives manual review and can be
  detected without a TOML parser.

## Delivered modules

- `packages/cli/src/codex/events.ts` — normalizes one hook stdin payload into a
  bounded capture event. Unknown events are ignored with a reason, malformed or
  over-1 MiB input is refused, text fields are cut at 64 KiB with
  `completeness: "partial"` and a gap reason, and unusable identifiers become
  explicit gaps rather than truncated values.
- `packages/cli/src/codex/hook-output.ts` — renders the single-line hook stdout
  for the five context-capable events, or emits nothing with a stderr
  explanation; enforces the UTF-8 byte bound, refusal-by-default and marked
  truncation.
- `packages/cli/src/codex/config-preview.ts` — deterministic, non-secret
  profile and ownership-manifest rendering with TOML/shell-safe quoting and
  ownership classification.

None of these modules perform I/O, call the backend or read credentials. They
are not reachable from any public command in this build.

## Future integration requests

Backend (owner A, later assignment):

- session registration and binding-generation pinning for a hook-observed
  session with `identityPrecision: "provisional"`;
- batched source append for normalized captures (the adapter's origin keys and
  completeness values already match `sourceAppendRecordSchema`);
- context preparation plus occurrence recording at the `UserPromptSubmit` and
  `SessionStart` boundaries;
- a decision on whether a provisional-identity session may read memory.

CLI/adapter (later assignment):

- `threadline codex-hook <Event> --home <path>` — stdin normalization, context
  rendering, exit `0` always;
- `threadline mcp --home <path>` — the stdio MCP server (local stdio process,
  stdio-only transport);
- `threadline codex config-preview` — prints the preview without writing.

Dependencies: no MCP SDK is installed. The stdio server can start with
Node built-ins; adopting an official SDK is a separate, justified dependency
request, not a silent addition. No shared-contract changes are requested; the
adapter maps onto the existing source, identity and context contracts.

## Remaining authorized runtime checks

1. **Hook runtime behavior** — one human-authorized interactive session with
   the profile and trusted hooks, with an authored hook that logs its stdin and
   exits `0`: establishes the exact stdin fields per event, whether
   `additionalContext` is delivered, the spill path, and whether `SessionStart`
   runs at session start (a `thread/start` on the app-server surface did not run
   it, and `debug prompt-input` never runs hooks).
2. **MCP `_meta` identity** — one authorized turn against an authored stdio
   server that logs raw requests: establishes whether `tools/call` carries
   host-owned `threadId`/`sessionId`, and in which form.
3. **Fork and subagent identity** — fork a thread and run one turn with the
   logging MCP server: establishes whether parent/fork correlation is available
   and whether subagent tool calls carry the parent or their own id.

Each check requires explicit authorization for that action. None is implied by
this document or by this checkpoint's probes.

## Verification performed

- `npm run build` (`tsc -b`) passes on the checkpoint worktree.
- 91 authored module checks pass (temporary script outside the repository):
  event normalization for known, unknown, malformed, oversized and long-payload
  inputs; UTF-8 code-point-safe truncation with no lone surrogates; correlation
  gaps; hook output purity, byte bounds, refusal and marked truncation;
  deterministic preview bytes and digests; TOML and shell quoting; ownership
  classification.
- The rendered preview profile was parsed by Python `tomllib` and by the
  installed binary (`codex -p threadline mcp list --json`); `debug prompt-input`
  with the rendered profile spawned the rendered stdio server, which completed
  the MCP handshake shown above.
- These checks establish module and protocol handling only. They do not prove
  native runtime hook execution, identity correlation, memory injection or
  model comprehension.
