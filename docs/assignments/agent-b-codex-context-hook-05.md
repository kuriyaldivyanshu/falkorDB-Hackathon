# Agent B: bounded context-only Codex hook

## Mandatory workflow

Follow AGENTS.md and docs/parallel-work-rulebook.md in full. Read the assigned
tracked task file before editing. Use only its named worktree/branch, writable
paths and resources. Finish the declared checkpoint, verify it, commit/push that
feature branch and open one PR. Keep later features out of that worktree; review
fixes stay with the same PR. The coordinator handles merges and retirement.

## Identity, base and creation gate

- Assignment: `b-codex-context-hook-05`; owner B; milestone N03, round 05.
- Outcome: implemented, explicitly enabled context-only command hook using the
  already merged reader/context APIs. Backend enrollment is not a dependency.
- Feature baseline: `8a83b57ac9cc003e5c86331dcdc9a3d9b14193d4` (PR #17/#18).
  Wait for this preparation PR to merge. Fetch origin, fast-forward clean main,
  resolve the literal SHA containing this contract and record it before edits.
  Inspect unexpected later feature changes rather than silently expanding scope.
- Branch `threadline/b-codex-context-hook-05`; fresh worktree
  `/tmp/threadline-b-codex-context-hook-05` (canonical `/private/tmp/...`). Check
  unused path/branch and create from the resolved literal main SHA, no main upstream.
- Remote `git@github-personal:kuriyaldivyanshu/falkorDB-Hackathon.git`; PR base main.
  Own npm ci, normal commit/push/one PR authorized. No merge/main push/force push,
  resource retirement, later feature or public package publication.

## Read first and reference hierarchy

Read README, CONTEXT, checklist, rulebook, docs/access.md, docs/context.md,
docs/context-client.md, docs/native-integration-contract.md, docs/local-development.md
and both round-04 records. Inspect CLI argument/credential/input/client handling,
context surface, MCP, pure codex/events.ts, hook-output.ts, config-preview.ts and
the public mcp-preview.ts, plus the shared context/identity contracts read-only.

Use `/Users/dkuriyal/Desktop/falkorDB-Hackathon/archive/codex` as a read-only
implementation reference, especially codex-rs/hooks and MCP request metadata
construction. Search targeted files. It is not installed-binary proof and must
not become Threadline's execution engine. Official hooks documentation:
https://learn.chatgpt.com/docs/hooks (recheck when implementing). Documentation,
snapshot code, installed offline metadata, authored checks and live observations
must remain separately labelled; preserve prior qualification artifacts.

## Ownership and isolated resources

Writable:

- `packages/cli/src/**` only for this checkpoint.
- README.md, docs/local-development.md, docs/context-client.md,
  docs/cli-memory-and-mcp.md, docs/native-integration-contract.md (client facts).
- New docs/codex-context-hook.md, assets/codex/README.md and new preview assets
  under assets/codex/preview/context-hook/; this assignment record.

Frozen: all backend/shared source and migrations, CONTEXT.md, docs/access.md and
docs/native-access.md, checklist/rulebook/AGENTS, dependencies/manifests/lockfile,
build/Compose config, fixtures, archive, existing qualification/schema digests
and A's worktree. Use the current merged context API; no speculative A endpoints,
SQL-seeded enrollment or direct SQL/file memory fallback.

Resources: HTTP 47863, PostgreSQL 55473, FalkorDB 56473, all loopback; prefix
`threadline-b-codex-context-hook-05-`; data `/tmp/threadline-b-codex-context-hook-data-05`;
explicit installation `<data>/home`; checks `/tmp/threadline-b-codex-context-hook-05-checks`.
Verify unused names/ports. Create fresh synthetic stores/generated credentials.
Assert explicit home/source root/database/ports before setup mutations. Use
the real supported owner API to issue reader credentials. No peer/shared stores.

## Product decisions for the hook

### 1. Two implemented context events, explicit configuration

Implement `threadline codex-hook SessionStart` and
`threadline codex-hook UserPromptSubmit`. These are context-only: they neither
capture prompts/tool results nor register/enroll sessions. Other events withhold
output and explain the unsupported boundary with bounded diagnostics.

Require an explicit --project UUID and absolute paths for --home, --token-file,
--workspace-root and --context-input. The input file holds configured optional taskId/focus/
conditions/maxBodyBytes selectors, using a strict projection of existing shared
prepare input validation. It cannot set project, key, credential or native ID.
Bound this file before parsing (64 KiB); configuration contains paths, not bearer
or prompt text. Empty selectors are permitted for project context.

Require the reader file; never fall back to the owner credential. Existing APIs
cannot independently introspect credential kind: make the operational reader
requirement explicit and verify with actually issued readers, without inventing
a client-side authority claim. Do not add credential issuance CLI commands.

Read hook stdin asynchronously with a hard byte bound (reuse the current hook
input maximum) and validate that command event equals hook_event_name. Reuse
normalization where it helps, but do not persist/log the raw envelope, prompt,
tool payloads, transcripts or identifiers. Never open transcript_path or scan
native history. Hook text supplies no focus, conditions, project or task.

Use cwd only as an additional withhold guard: realpath the configured workspace
root and reported cwd and require exact root/contained directory using path
components, rejecting siblings, prefix tricks and symlink escape. This guard
does not authenticate a native session or server workspace binding. All routing
still comes from explicit configuration and the stored reader's backend scope.

Prepare with nativeSessionId null. The hook session_id, native thread/turn IDs,
timestamps, process IDs, latest event and MCP arguments cannot create native
binding or strong identity. B must work without A's new enrollment schema.

### 2. One bounded invocation and truthful keys

Use one random invocation UUID; derive prepare/report keys within this process
and retain them for any same-process retry. Never deduplicate by just event +
session/turn or invent stable occurrence identity from missing hook references.
Document that separately launched hook processes can create separate preparation
audits. This is an adapter-generated key exception; human CLI keys remain explicit.

Default total wall deadline 2,000 ms, configurable through --hook-timeout-ms
from 250 to 5,000 ms. It covers stdin, configured file/token reads, backend
preparation, stdout and best-effort reporting. Reserve time for reporting/cleanup;
bound all network attempts by remaining budget and cancel pending work on expiry.
Withhold even a completed preparation if the deadline expires before output
begins; a report reservation never extends the total deadline.
Avoid the ordinary synchronous stdin reader and independent 10-second request
timeouts. A hanging stdin/backend must not hold the hook until the host's much
longer default timeout. Bound credential/config file reads too; named pipes or
unexpected non-regular files must not turn them into unbounded reads.

For this recognized hook command, ordinary usage/validation/auth/storage/timeout
failures before output begins exit 0 with no context. Partial-output uncertainty
is handled separately below. Handle this boundary before the ordinary CLI's
exit-2 usage behavior can accidentally block Codex. Scope signal/error handling
to this invocation; no global uncaught-exception suppression. Clean timers,
streams and requests. State limits for external termination or OS failure.

### 3. Exact output and precise occurrence reporting

Use the existing context transport and validate its complete result. A refusal
emits no context. Preserve the backend's exact body, full qualifications and
UTF-8 bound; render one hook JSON line with overflow always refuse. Never use
the renderer's optional truncation path for governing authority. Default rendered
body remains 4 KiB, hard limit 8 KiB. Stdout contains only that JSON or nothing;
all diagnostics are bounded codes/messages on stderr with no raw input or bearer.

Only after stdout's write callback succeeds, best-effort report emitted with
boundary adapter_report using the same reader credential and expected prepared
state. It means local stdout write was reported, not Codex consumption or model
use. Before writing, never report emission. EPIPE, partial/ambiguous delivery or
deadline exhaustion must not produce an unhandled error or false emitted report.
Where time and backend availability permit, report unknown/refused accurately.
If reporting fails after output, keep its audit uncertainty visible on stderr;
do not emit a second JSON object or claim delivered bytes were rolled back.
native_observed remains unsupported. No occurrence MCP tool is added.

### 4. Explicit preview only; public defaults preserved

Add --context-hooks to codex:preview with the required reader/workspace/selector
paths and hook budget. Render only SessionStart/UserPromptSubmit command handlers
using exact executable/entry paths, safe TOML/shell quoting, additionalContextLimit
0 (the handler enforces its own byte cap) and host timeout longer than the bounded
handler deadline. Include owned event names in the ownership manifest.

Use the selected reader token-file path for the preview's MCP process too when
hook mode is requested; put no bearer in arguments, TOML, manifest or diagnostics.
Default preview remains six-tool MCP-only; --context-tools remains independent
and explicitly opts into the seventh tool. Preserve existing ownership, edited/
foreign collision and project/home/path checks. Update only new hook assets and
current documentation; historical digest evidence remains immutable.

Preview writes nothing. No real native installation, trust edits or inference
is authorized here. Prepare an exact minimal synthetic live-probe procedure
and its expected evidence, with a per-action authorization gate, rather than
claiming authored stdin proves Codex behavior. Historical profile qualification
must not become a qualified-version claim for the new hook path.

## Verification and delivery

Run own npm ci/build and focused temporary checks outside Git against your real
isolated service and API-issued reader:

1. Valid authored SessionStart/UserPromptSubmit envelopes produce exactly one
   valid JSON line with exact current task authority and qualified optional
   evidence selected by configured hints; no dynamic prompt capture/routing.
2. Unsupported/mismatched/malformed/oversized events, unknown flags, invalid
   selectors, missing reader, foreign project/cwd, prefix/symlink escape and
   native identity attempts withhold context and exit 0.
3. Stalled stdin, non-regular config/token files, slow service and reporting
   terminate within the declared overall budget, with no open handles/retries
   extending it. Normal human CLI error behavior remains unchanged.
4. Expired/revoked issued reader, graph outage, missing authority and mandatory
   overflow fail open. Established graph outage/recovery preserves the service;
   SQL history stays usable and recovered hooks still work.
5. SQL/source observations confirm audit writes only, no captured prompt/raw
   event or accepted-knowledge mutation, no persisted rendered body/focus digest.
6. Exact byte bounds and qualifications survive serialization. Verify normal
   stdout emission precedes adapter-report state, broken pipe/partial failure
   never falsely reports emitted, and post-output report failure stays honest.
7. Default six and explicit seventh MCP tools remain unchanged. Preview modes,
   quoting/path guards, owned/edited/foreign classification and secret absence
   pass without real native writes or model use.

Document the command/config examples, total deadline, adapter-generated key
semantics, reader use, withhold behavior, local-write precision and unqualified
native boundaries in docs/codex-context-hook.md and affected guides. Record
actual outcomes, not a target check count. Distinguish injected failures from
real-store evidence and controlled stream tests from Codex runtime proof.

Review complete base diff, frozen paths, credentials, Markdown and whitespace.
Commit/push the feature ref normally and open one PR with exact head/base/limits.
Keep worktree/resources for coordinator review. Merge order is chosen by the
coordinator; after the first PR merges, normally merge current main and repeat
affected reader/context/hook checks before the second PR is merged. Consume
no A enrollment APIs in this checkpoint even if A merges first.

## Result record

Reserved, not started. Record the literal worker base, branch/worktree/clean
baseline, implementation, changed paths, exact checks/limits, final head/remote,
real PR URL and retained resources. N03 remains incomplete: connecting permitted
capture to enrollment and separately authorized native runtime qualification
are later integration work. The command is a context adapter, not a harness.
