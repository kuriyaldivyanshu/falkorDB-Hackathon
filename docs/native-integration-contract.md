# Native integration contract (Codex)

This document is the tracked handoff from the Codex qualification checkpoint
(`b-codex-qualification-01`). It records the installed native surface Threadline
may use, how each boundary was established, what remains unqualified, and the
exact checks required before a later assignment may enable more.

Status: **qualification and preparation, plus a reachable read-only MCP server.**
The native adapter stays unavailable in public capabilities, and N03
(session-to-session memory) is not complete. Human-run `memory:propose`,
`memory:accept` and `memory:correct` commands can write memory. No Threadline
command installs native configuration or starts inference, and the MCP server
cannot write memory on a model's behalf.

Updated by `b-mcp-read-02`: the stdio MCP server and the MCP-only configuration
preview are now implemented and reachable (`threadline mcp`,
`threadline codex:preview`). The three unqualified native runtime gates below are
unchanged; nothing in this checkpoint promotes them.

Unchanged by `b-mcp-read-02` after merging `a-n02b-evidence-02`: episode
admission and procedural candidates with human review now exist in the backend,
and they change nothing here. `memory:propose`/`memory:accept` carry a procedure
through the human-reviewed path and stop at `procedureState: "candidate"`;
validated reuse, native capture and strong native identity remained unavailable
at that checkpoint, and this server stays read-only. Since the later N02C merge,
[backend context preparation and occurrence reporting](context.md) are implemented.
The context CLI and explicitly enabled audited MCP tool are now implemented;
qualified native context delivery remains unavailable. Client/backend support
does not qualify a native boundary. See [context clients](context-client.md).

## Context client boundary

`b-context-client-04` adds human `context:prepare` and explicit guarded
`context:occurrence`, plus `mcp --context-tools` and a matching opt-in
`codex:preview --context-tools`. The default remains six read-only tools. The
added context tool records preparation audit metadata; it neither changes
accepted knowledge nor reports emission/native observation. Body limits remain
4/8 KiB; the serialized context tool result has a separate 64 KiB cap and never
silently truncates mandatory authority. Token-file configuration remains outside
the rendered profile. No hook or native session identity is inferred.

The context-enabled preview is labelled `context-read` and renders the real
startup flag, no hook or bearer. Preview-only ownership/collision behavior is
unchanged. Authored protocol checks establish client transport only; no actual
model consumption is claimed. Hook runtime/additionalContext delivery/spilling,
host metadata proving a conversation, and fork/subagent correlation remain
unqualified. No native configuration, trust or credentials are modified.

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

**Observed again on `b-mcp-read-02` (installed 0.163.0, isolated `CODEX_HOME`):**
the MCP-only preview produced by `threadline codex:preview` — which points at the
real implemented entry point, `packages/cli/dist/index.js mcp --home <home>
--project <uuid>` — was accepted by `codex -p threadline mcp list --json`, which
reported `transport.type: "stdio"`, the exact node executable and argument
vector, `required` absent (optional), and `env` containing only
`THREADLINE_HOME`. No credential appeared in the listing or in the rendered file.
This confirms the configuration route for a *reachable* server; it says nothing
about a model using it.

### The read-only stdio server

**Implemented:** `threadline mcp --project <uuid>` (see
[cli-memory-and-mcp.md](cli-memory-and-mcp.md)) binds one explicitly configured
project and credential at startup and serves six read-only tools over stdio,
using the official `@modelcontextprotocol/server` SDK. Project, tenant, service
destination and credential are configuration, never tool arguments; a strict
input schema refuses unknown routing fields, and every backend request is
re-authorized by the service.

**Observed on the protocol (authored client, not Codex):** `initialize`
negotiated `2025-06-18`, followed by `notifications/initialized`, `tools/list`
and `tools/call`. A mutation-shaped tool name is refused as an unknown tool. A
tool call during a backend outage answers with a bounded `service_unavailable`
error and one during a graph outage with `storage_unavailable`; neither falls
back to reading SQL or source files. Standard output carried protocol messages
only, with every diagnostic on stderr.

**Observed negative, recorded precisely:** in this isolated `CODEX_HOME`,
`codex -p threadline debug prompt-input` completed offline but did **not** start
the optional (`required = false`) MCP server. The earlier qualification
observed a spawn on that command with a profile that also carried hook entries.
The difference is not isolated here, so the installed binary's MCP startup
timing on 0.163.0 remains an open observation rather than a qualified fact.

An authored `tools/call` proves Threadline's transport. It is **not** evidence
that Codex generates `tools/call` metadata, that a model reads or uses the
result, or that any conversation identity is correlatable.

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
- An origin key is occurrence identity only when every reference it encodes is
  usable. Two tool events in one turn whose `tool_use_id` is unusable share an
  origin key and are both `completeness: "partial"`; a future uploader must not
  deduplicate such captures by origin key alone.
- A project-scoped enrollment is not proof of which conversation called a tool.
  Timestamps, process ids, the latest hook and model-supplied arguments are
  never correlation evidence.
- **Write gate:** model-issued memory mutation stays disabled until the MCP
  tool-call identity path is observed on a supported binary and a single
  conversation can be proven. Until then the integration contract requires
  read-only knowledge tools plus human-driven knowledge mutation. Explicit
  `--context-tools` additionally permits preparation audit writes, with
  readOnlyHint false, without accepted-knowledge changes or delivery claims.

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
  only `owned` files may be replaced: either the file bytes match the previewed
  bytes exactly, or the file's role-appropriate ownership marker is present and
  its bytes match the digest the installed manifest recorded at installation
  time. The second rule keeps an unchanged installation replaceable after
  preview inputs change. The manifest cannot record its own digest, so its entry
  is classified from the preview bytes and marker alone.
- `checkPreviewOwnership` classifies a target as `absent`, `owned`, `edited` or
  `foreign`. `edited` (marker present, but neither the preview bytes nor a
  recorded digest) always requires human resolution; `foreign` (file exists
  without the marker) is never modified or removed, including foreign
  `[mcp_servers.threadline]` entries. The profile marker is a single marker
  line; the JSON manifest is recognized by its `kind` and `marker` fields.
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
  explicit gaps rather than truncated values — session, turn, tool and agent
  references included.
- `packages/cli/src/codex/hook-output.ts` — renders the single-line hook stdout
  for the five context-capable events, or emits nothing with a stderr
  explanation; enforces the UTF-8 byte bound, refusal-by-default and marked
  truncation.
- `packages/cli/src/codex/config-preview.ts` — deterministic, non-secret
  profile and ownership-manifest rendering with TOML/shell-safe quoting and
  ownership classification.
- `packages/cli/src/codex/mcp-preview.ts` (`b-mcp-read-02`) — the same route
  rendered with the stdio MCP server alone and **no** hook entries, reusing the
  markers, digests and `checkPreviewOwnership` classification above. Pure: it
  writes nothing and renders no credential.
- `packages/cli/src/memory-surface.ts` (`b-mcp-read-02`) — one implementation of
  the memory/task/source routes and their shared validators, shared by the human
  CLI and the MCP server so the two cannot drift.
- `packages/cli/src/mcp/server.ts` (`b-mcp-read-02`) — the project-bound,
  read-only stdio MCP server. Reachable as `threadline mcp`.

`events.ts`, `hook-output.ts` and `config-preview.ts` still perform no I/O, call
no backend and read no credential. The first two remain unreachable from any
public command, because `threadline codex-hook` does not exist in this build and
the shipped preview installs no hook entry that would call it.

## Future integration requests

Backend (owner A, later assignment):

- session registration and binding-generation pinning for a hook-observed
  session with `identityPrecision: "provisional"`;
- batched source append for normalized captures (the adapter's origin keys and
  completeness values already match `sourceAppendRecordSchema`);
- context preparation plus occurrence recording at the `UserPromptSubmit` and
  `SessionStart` boundaries;
- a decision on whether a provisional-identity session may read memory;

Scoped reader issuance, listing and revocation are implemented through the
[owner access API](access.md). Its dedicated service principal is project-bound;
it establishes no native conversation identity. Use the saved reader token file
for default read-only MCP or explicitly enabled audited context preparation.

CLI/adapter (later assignment):

- `threadline codex-hook <Event> --home <path>` — stdin normalization, context
  rendering, exit `0` always. Delivered as modules; the command is still
  missing, which is why the shipped preview installs no hook entry.
- `threadline codex:preview` — delivered by `b-mcp-read-02` (spelling chosen to
  match the `noun:verb` convention of the existing CLI; it replaced the
  provisional `threadline codex config-preview` form recorded above).
- `threadline mcp` — delivered by `b-mcp-read-02`, read-only and project-bound.

Dependencies: `@modelcontextprotocol/server` 2.3.1 (Apache-2.0, official SDK,
current stable v2 line) is the only added dependency. No shared-contract changes
were requested or made; the adapter maps onto the existing source, memory and
task contracts.

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

A fourth, smaller item was added by `b-mcp-read-02` and is **not** yet
qualified: when the installed 0.163.0 binary starts a `required = false` stdio
MCP server. `codex -p threadline mcp list --json` registers the server, but
`debug prompt-input` did not start it in an isolated home. The smallest probe is
one authorized interactive session with the previewed profile, observing the
server's own startup line on stderr.

## Verification performed

Qualification checkpoint (`b-codex-qualification-01`):

- `npm run build` (`tsc -b`) passes on the checkpoint worktree.
- 109 authored module checks pass (temporary script outside the repository):
  event normalization for known, unknown, malformed, oversized and long-payload
  inputs; UTF-8 code-point-safe truncation with no lone surrogates; correlation
  gaps for session, turn, tool and agent references; hook output purity, byte
  bounds, refusal and marked truncation; deterministic preview bytes and
  digests; TOML and shell quoting; ownership classification including
  stale-but-owned files (recorded digest), embedded marker text and the
  JSON manifest marker.
- The rendered preview profile was parsed by Python `tomllib` and by the
  installed binary (`codex -p threadline mcp list --json`); `debug prompt-input`
  with the rendered profile spawned the rendered stdio server, which completed
  the MCP handshake shown above.
- These checks establish module and protocol handling only. They do not prove
  native runtime hook execution, identity correlation, memory injection or
  model comprehension.

Client-surface checkpoint (`b-mcp-read-02`), against a real isolated
PostgreSQL/FalkorDB stack. Re-run after merging Agent A's episode/procedure work
(`a-n02b-evidence-02`) into this branch, so these results describe the **combined**
code rather than the pre-merge baseline:

- `npm run build` (`tsc -b`) passes after the merge.
- 45 CLI checks: task and source creation, a proposal that does not govern,
  human acceptance under an expected-head guard, requirement binding, current
  reads, a 600 -> 60 second correction with the superseded version and its
  evidence retained, exact-retry and mismatched-retry behaviour, stale-head and
  stale-task-revision refusals, and the `0/1/2/3` exit statuses.
- 15 shared-schema compatibility checks against the **new** contracts: capability
  output reports `memory.episode.record` supported and
  `memory.procedure.validate` unavailable; `memory:propose` refuses episodic
  content with a bounded typed error naming the field; a procedure proposal and
  human acceptance commit; the accepted procedure is still `candidate`; a
  procedure that writes its own `procedureState` is refused; and the MCP tools
  parse the new stored shapes (`supportedBy`, server-resolved `procedureState`)
  and answer a kind-filtered procedural query.
- 24 MCP checks through an authored JSON-RPC client: handshake, the exact
  six-tool read-only surface, a real backend read through each tool, refusal of
  a mutation-shaped tool name, refusal of unknown/project/tenant override
  arguments, invalid-identifier and excessive-limit refusals, bounded source
  reads, an out-of-project memory refused, and 8 concurrent reads without
  cross-request leakage.
- Resilience: 5 mid-session HTTP-outage checks (`service_unavailable`, no
  fallback), 3 authorization-failure checks (no transport opened for an
  unauthorized binding) and 3 restart/reconnect checks.
- Established-connection graph outage, with **no restart between the outage and
  the recovery observation**: the service holds a live graph connection proven by
  a real read, the FalkorDB container is stopped, the same process answers two
  further reads and one MCP tool call with `storage_unavailable: FalkorDB is
  disconnected or reconnecting.`, serves no version content from SQL or files,
  stays alive, and — after the container is restored — answers reads again and
  reports `ready` on that same process. An earlier pre-merge run of this same
  sequence aborted the process; see the assignment record for that defect and its
  now-observed resolution.
- Preview: 21 checks covering determinism, the real entry point, no rendered
  hook entry, absence of any credential, `absent`/`owned`/`edited`/`foreign`
  ownership classification with a foreign file left byte-identical, safe
  quoting, JSON mode, and no write into the target Codex home.
- Installed-binary offline inspection: `codex -p threadline mcp list --json`
  reported the rendered stdio server with its exact command, args and env and no
  credential; `debug prompt-input` completed offline without starting the
  optional server. The real native home was neither read nor written.
- An authored MCP `tools/call` proves Threadline's transport only. It is not
  evidence that Codex generates tool-call metadata, that a model reads or uses
  the result, or that native runtime hook execution or identity correlation
  works. Those remain unqualified.
