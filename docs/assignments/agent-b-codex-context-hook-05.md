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

### Baseline and scope

Checkpoint implemented and verified; delivery details follow below. N03 remains
incomplete. PR #19 merged as literal base
`e5b2e73598eaf6eb52abb01d26d35f772c8d7712`. The worker fetched origin, verified
the clean main checkpoint containing this tracked contract and recorded that
full SHA in its transcript before source edits. The reserved path/local branch
were absent; the fresh branch/worktree started clean at that literal SHA with
no upstream. The remote feature name was confirmed absent before delivery.

Branch: `threadline/b-codex-context-hook-05`; canonical worktree:
`/private/tmp/threadline-b-codex-context-hook-05`. Remote:
`git@github-personal:kuriyaldivyanshu/falkorDB-Hackathon.git`; PR base main.
Own npm ci succeeded without changing dependencies/lockfile. Workspace build
passed after each source correction, including the final command-recognition
change. Node v22.16.0/npm 10.9.2 were used for workspace install/build; authorized
external check processes use Node v23.11.0. Both satisfy the Node >=22 requirement.

Changed only allowed CLI source, README/current client guides, assets README,
new `docs/codex-context-hook.md`, new context-hook preview assets and this record.
Backend/shared source, domain contracts, migrations, dependency/build files,
fixtures, historical qualification assets and the shared checklist are unchanged.
No unpublished A APIs, SQL-seeded readers or peer runtime data were used.

### Implemented behavior

- Dedicated fail-open command recognition precedes normal human parsing,
  including malformed later flags when --home precedes the hook command.
  SessionStart/UserPromptSubmit alone retrieve context; ordinary failures exit
  zero with one bounded safe diagnostic and no context before output.
- Explicit project UUID and absolute home/reader/workspace/selector paths;
  strict shared-selector projection with a 64 KiB bound. Asynchronous stdin
  uses the existing 8 MiB hook cap. Only event name and canonical cwd guard are
  consumed from envelopes. No prompt/tool/transcript capture or native-history
  read occurs. All preparation nativeSessionId values are null.
- Descriptor-checked nonblocking regular-file reads, final-component symlink
  refusal, canonical directory containment and no owner credential fallback.
  The hook reads only the non-secret client host/port projection from the
  selected installation config (existing host/port environment overrides
  apply); it avoids the synchronous backend config/secrets loader.
- One random invocation UUID derives stable in-process prepare/report keys;
  separate hook processes can create separate audits. Human keys/exit behavior
  remain unchanged. No automatic retries were added.
- One 2,000 ms default deadline (250–5,000 configurable) covers input, files,
  preparation, stdout/reporting, with cancellation and a 150 ms report reserve.
  HTTP reply consumption is also cancelled and capped at 1 MiB. A completed
  packet is withheld if time expired before output. OS/runtime startup and
  uninterruptible filesystem failure limits are explicit in the guide.
- Shared response validation plus project/task/body-budget/UTF-8/digest checks;
  exact backend body and qualifications, one JSON line, overflow refusal only.
  A successful stdout callback alone permits same-reader/expected-prepared
  adapter_report emission. Partial/broken output cannot report emitted; unknown
  is reported when possible. Failed post-output reporting remains explicitly
  uncertain. native_observed stays unsupported.
- Explicit --context-hooks preview owns only the two implemented events,
  quotes the actual command/flags, uses additionalContextLimit zero and a longer
  host timeout, and selects the same reader file for MCP. Default six tools and
  independent --context-tools seventh tool remain unchanged. Ownership/collision
  guards remain; the new hook route is labelled unqualified. Preview writes no
  native files/trust. The guide includes an exact later synthetic probe with
  separate installation, trust and inference authorization gates.

### Observed verification

Temporary scripts and safe logs are retained under
`/tmp/threadline-b-codex-context-hook-05-checks`; no permanent tests were added.
Final relevant runs passed, with evidence classes separated:

- `npm ci` and `npm run build`: passed. Final build followed the last source
  change. Build outputs/dependencies stay ignored and worktree-local.
- `demo.sh`: documented memory-demo sections 2–5 passed against fresh isolated
  stores: human proposal/acceptance/binding, actually executed public fixture
  check and qualified episode, 600→60 correction, preserved old provenance and
  accepted procedural candidate. No service restart/native inference was
  included in that script.
- `verify.mjs` (`verify-delivery.log`): **13 grouped checks passed** on the final
  hook source. Both authored events returned one exact JSON line containing
  current 60-second authority and distinct historical 600-second/applicability
  qualifications. Real SQL audits showed null native identity and adapter_report
  emission. Separate processes had different invocation keys. Malformed/8 MiB
  overflow/mismatched/unsupported events, unknown/repeated/native flags, malformed
  flags after a prefixed home, invalid timeout ranges, missing/relative/foreign
  configuration, sibling/prefix/symlink escape and strict selector overrides
  withheld context. FIFO/directory inputs, stalled stdin, injected stalled
  preparation/reporting, real child EPIPE and post-output reporting failure
  behaved safely. Actually API-issued expired/revoked readers refused. Every SQL
  table and reader-produced source was inspected for authored raw markers;
  only context_manifest sources/audits were added, with no rendered text,
  qualifications, native refs or standalone focus digest. Human usage still
  exited 2. Simulated fetch stalls are labelled injected, not network proof.
- `remaining.mjs` (`remaining.log`): **8 additional groups passed**. Real
  unaccepted required authority and mandatory multibyte overflow withheld.
  After an established graph read, stopping only B's graph container withheld
  context while SQL history stayed readable; the same backend PID **83371**
  survived and hooks recovered after that container restarted. Controlled
  Writable callbacks confirmed SQL stayed prepared before callback success and
  emission was requested afterward. Partial writes requested unknown, stalled
  stdout was destroyed at the deadline, completed preparation past deadline
  emitted nothing, broken stderr stayed handled, and exact 4/8 KiB multibyte
  renderer boundaries plus one-byte overflow passed. Controlled streams are
  adapter evidence, not Codex behavior.
- `preview-mcp.mjs` (`preview-mcp.log`): **4 groups passed**, including all four
  hook/tool opt-in combinations, exact flags/events/timeouts, TOML parsing,
  deterministic output, no bearer, absent/owned/edited/foreign classification,
  shell/TOML metacharacter path roundtrips and invalid path/project/budget guards.
  The real preview left foreign targets byte-identical and wrote no manifest.
  Actual reader-bound authored stdio MCP initialization/list/call retained six
  default read-only tools and only the explicit seventh preparation tool, with
  real current authority/qualified history and preparation-only metadata.
- `network.mjs` (`network.log`): **4 actual HTTP fault groups passed** on B's
  reserved HTTP port. The reidentified normal B service was stopped only for
  this separate transport experiment. Temporary HTTP responses stalled headers
  or body, exceeded 1 MiB, violated the result contract, failed a report, or
  stalled a post-output report. Processes exited within the 500 ms handler
  budget plus measured startup tolerance, with exact output or no output and
  truthful uncertainty. This uses simulated HTTP replies, not fabricated
  persistence evidence. Duplicate home refused. The normal service was restored
  afterward as PID **95356**; this restart was separate from the earlier
  same-PID graph recovery evidence.
- `files.mjs` (`files.log`): **4 groups passed**. Installation config FIFO,
  directory, oversize, final symlink and malformed JSON refused promptly.
  Empty selectors padded to exactly 64 KiB succeeded with the default budget.
  Empty/whitespace/oversize/symlink credentials and invalid UTF-8 stdin withheld.
  Backend logs contained no authored private input marker.

Full-base review passed for all 15 changed/new paths: allowlist/frozen-path
checks, generated-bearer/database-secret scan, one-H1/heading/fence/local-link
checks, exact new preview asset reproduction and git diff --check. Six external
verification log digests are retained in SHA256SUMS.txt.

Total: **33 grouped focused checks**, plus the documented synthetic owner
workflow, own install/build and documentation/scope checks. Group counts do not
represent independent native sessions or model agents.

Two initial problems are recorded rather than hidden: PostgreSQL's temporary
first-start instance briefly passed readiness then restarted, interrupting role
creation; the resume script reasserted the same named ports/mounts and completed
setup without reset. The first real EPIPE check found a product listener-order
bug: write callbacks can precede the error event, and close can precede that
queued error after explicit destruction. Scoped listeners now survive through
close and the next event-loop boundary; the reproducer and full matrix passed.
The same ordering is handled for diagnostics. A temporary verifier was made
rerunnable with fresh reader output paths and preexisting directory checks.
No remaining product failure was observed.

### Reference evidence and limits

Official hooks documentation at https://learn.chatgpt.com/docs/hooks was fetched
on 18 October 2026. Read-only snapshot inspection covered hooks/schema.rs,
command dispatch/additional-context limits and the core MCP metadata constructor.
Snapshot metadata IDs were not promoted to native binding.

Installed offline evidence: `/opt/homebrew/bin/codex --version` reported
`codex-cli 0.163.0`; `codex app-server generate-json-schema --out <checks>/installed-schema`
with an isolated CODEX_HOME target produced HooksListResponse schema containing
sessionStart/userPromptSubmit and the description that zero disables spilling.
A PATH-alias warning stated that the isolated home did not exist; schema
emission succeeded. No auth, native configuration/trust installation, transcript
read, hooks/list execution or inference occurred. Historical qualification files
remain byte-identical to the base.

No actual Codex hook execution, additionalContext delivery/spilling, model
consumption, strong identity, fork/subagent correlation, enrollment or capture
was qualified. External termination/OS failure and unreadable/hung storage below
the OS interface remain process limits. Reader kind is an operational issuance
requirement because the existing API has no independent introspection endpoint.
A report lost after stdout may already have committed; diagnostics preserve
that uncertainty. No occurrence MCP or accepted-knowledge mutation was added.

### Retained resources and coordinator handoff

Fresh resources retained for review:

- Containers `threadline-b-codex-context-hook-05-postgres` (55473) and
  `threadline-b-codex-context-hook-05-graph` (56473), loopback only; volumes with
  the same prefix ending pg-data/graph-data.
- Database `threadline_b_hook_05`, schema threadline_memory, restricted role
  threadline_b_hook_app, fresh project graphs and sources under
  `/tmp/threadline-b-codex-context-hook-data-05/home`.
- Normal service HTTP 47863, restored PID 95356 (reidentify before control);
  private owner/database/issued-reader files remain only under the assigned
  data root. Temporary verifiers and the HTTP fault server have exited.
- Worktree and external scripts/logs/schema metadata retained. No peer stores,
  real native home, trust, authentication or inference resources were touched.

Coordinator next: review this PR, choose serial integration order, merge current
main normally into this branch if needed and rerun affected reader/hook/MCP
checks before integration. Agent B depends only on merged PR #19 and the prior
reader/context surface; no A enrollment dependency exists. The coordinator
alone updates the checklist and retires resources. Do not mark N03 complete.

### Delivery

Implementation commit `38f441d308cbbded56285372dcd4ffc2162f863a` was pushed
normally to the exact feature ref; git ls-remote confirmed the identical SHA.
One [open PR #20](https://github.com/kuriyaldivyanshu/falkorDB-Hackathon/pull/20)
was created through the existing authenticated GitHub browser because gh is
unavailable. Its visible base is main, head is threadline/b-codex-context-hook-05,
and implementation commit is 38f441d. It is review-ready, not merged.

This delivery-only follow-up records the real PR and remote confirmation; it
changes no tested source/configuration. The final delivery-record HEAD and
matching remote SHA are reported in the PR/handoff, avoiding a self-referential
commit hash. Source/configuration remains byte-identical to the verified
implementation commit. The worktree, service and isolated stores stay retained.
