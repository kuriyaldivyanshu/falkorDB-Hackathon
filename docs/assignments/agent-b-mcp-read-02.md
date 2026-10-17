# Agent B prompt: human memory CLI and read-only stdio MCP

Follow AGENTS.md and [the parallel work rulebook](../parallel-work-rulebook.md) in full. Read this assignment before editing. Use only its reserved worktree/branch, writable paths and resources. Complete this checkpoint, verify it, commit/push its feature branch and open one PR. Review fixes stay with that PR; the coordinator handles merge and retirement. The next milestone gets a fresh worktree.

## Assignment contract

- **ID/owner:** `b-mcp-read-02`, Agent B.
- **Outcome:** the already merged semantic-memory/task services become usable by a human through plain CLI commands, by an authored client through a project-bound read-only stdio MCP server, and previewable as an executable native configuration.
- **Checkpoint:** the human memory/task workflow over the CLI, a reachable read-only stdio MCP server, and an executable configuration-preview command, each verified against a real isolated baseline backend. This is not the N03 end-to-end slice.
- **Baseline:** freshly fetched `origin/main` after PR #9 (native qualification) and PR #10 (semantic memory) are merged. Record the resolved full SHA in the result record before editing.
- **Branch:** `threadline/b-mcp-read-02`.
- **Worktree:** `/tmp/threadline-b-mcp-read-02`.
- **PR:** feature branch → `main` in this repository's `origin`; one PR for this assignment.
- **Authority:** implementation within the allowlist, isolated synthetic verification, commit/push of this feature branch and PR creation. No merge, main push, release, shared-data reset, real native configuration installation, native trust change, login or model inference.

The coordinator reserves this branch/path and delegates their creation to you. Verify unused names, clean correct starting state and the rulebook on the fetched baseline. Create from the resolved full SHA, verify branch/path/HEAD, then work exclusively there. If an existing branch/path is found, report it rather than recycling it. Do not edit the coordinator checkout or Agent A's worktree.

## Read and preserve

Read AGENTS.md, [docs/development-checklist.md](../development-checklist.md), [docs/native-integration-contract.md](../native-integration-contract.md), [the Agent A semantic-memory record](agent-a-n02b-semantic-memory.md), [the Agent B qualification record](agent-b-codex-qualification.md), CONTEXT.md, README.md and [docs/local-development.md](../local-development.md).

The baseline semantic/task slice, the operation ledger, receipt semantics and the pure Codex native-edge modules are merged and must keep working. This assignment adds a client surface only: it must not add a second memory implementation, a second protocol stack, or a new core contract.

## Retiring the previous assignment

For this phase only, act as the coordinator's delegated retirement operator for `/tmp/threadline-b-codex-qualification-01` (canonical `/private/tmp/threadline-b-codex-qualification-01`) and `/tmp/threadline-b-codex-qualification-data-01`.

Before cleanup: confirm the actual final head is contained in `main`; inspect tracked, untracked and ignored state plus local-only commits; confirm no probe process or caller still uses the old paths; confirm findings, digests, compatibility assets and module results remain reviewable in tracked files and PR #9; preserve useful authored probes or sanitized evidence; then remove the disposable probe root and, only if necessary, disposable generated dependencies and build outputs in the old worktree. Remove the worktree with `git worktree remove` from another checkout, without `--force`.

No blanket clean, forced removal or deletion of unexplained files. A failed gate preserves the affected resource and produces a a specific report. Old Git branches stay recoverable; remote deletion is a separate coordinator decision. This delegation does not authorize retiring the new worktree.

## Writable paths and frozen boundaries

You own:

- `packages/cli/src/**`
- `packages/cli/package.json`, only for a justified transport dependency and its metadata
- `package-lock.json`, only as the result of that scoped dependency change
- `assets/codex/**`
- `README.md`
- `docs/local-development.md`
- `docs/native-integration-contract.md`
- `docs/cli-memory-and-mcp.md`
- This assignment file's result/status record

Everything else is read-only. In particular `packages/backend/**`, `packages/shared/**`, `CONTEXT.md`, Agent A's documents, `docs/development-checklist.md`, `docs/parallel-work-rulebook.md`, the root `package.json`, build/Compose configuration, `.gitignore` and `fixtures/` are frozen.

Agent A owns core/shared contracts and SQL migration sequencing. Work against the merged baseline semantic/task APIs; do not depend on Agent A's unfinished operation kinds and do not modify backend code to make a client check pass. Report narrowly scoped backend/shared defects to the coordinator and continue independent work.

## Isolated runtime allocation

### Coordinator review correction (18 October 2026)

The user requested resolution of the remaining status-wording defect while
PR #13 is under review. The coordinator owns the narrow correction to
`packages/backend/src/index.ts` (the durable Guarantees note and adjacent
comment), plus this result record, on this existing branch. Agent B's broader
backend exclusion remains in effect. This is a review fix for the same
checkpoint; no new feature, contract, migration or dependency is assigned.

Verification may use a temporary loopback listener on reserved port 47834 with
the existing B synthetic stores and explicit B installation root. Stop that
listener afterwards; preserve B's existing service, containers and evidence.

### Reserved assignment resources

- HTTP: `127.0.0.1:47833`.
- Verification PostgreSQL host port: `55443`.
- Verification FalkorDB host port: `56443`.
- Data/config root: `/tmp/threadline-b-mcp-read-data-02`.
- Temporary checks: `/tmp/threadline-b-mcp-read-02-checks`.
- Container/volume prefix: `threadline-b-mcp-read-02-`.

Use freshly created synthetic stores and generated credentials. Run the unchanged merged backend from this worktree. Check ownership and availability first. Apply only the baseline migrations through the normal setup path to this isolated store. Do not use Agent A's service, stores or credentials, and do not modify shared containers or baseline services. Record every created resource. Keep secrets owner-only and out of argv where avoidable, protocol responses, logs, examples and Git.

## Product and authorization boundary

Codex owns inference, tools, authentication, approvals and execution. Threadline supplies memory. The previous qualification did not prove runtime hook stdin/stdout and `additionalContext` delivery, `tools/call` host metadata identifying a conversation, or fork/subagent identity correlation. Those three remain unqualified.

A model using a read tool does not need to be represented as a proven native session. A fixed, explicitly configured project credential authorizes the read; the caller is recorded as an MCP client with unqualified native identity, and no session registration is fabricated. Model-issued writes stay disabled. Human CLI mutations use the backend's existing server-enforced human authorization. This assignment authorizes authored MCP clients and offline installed-binary inspection only.

## Implementation sequence

### B1. Inspect existing client and contracts

Read `packages/cli/src/index.ts`, `options.ts`, `client.ts`, `codex/{events,hook-output,config-preview}.ts`, `packages/shared/src/protocol.ts`, `packages/shared/src/memory.ts`, the existing capability/error/source/operation schemas, and the actual backend routes and authorization, read-only. Reuse route constants, shared validators and the existing transport. Keep behavior in one core implementation shared by CLI and MCP callers. If an MCP dependency is needed, use a maintained official SDK after checking its current primary documentation and package compatibility; do not add a second custom general-purpose protocol stack.

### B2. Human CLI workflow

Add a small, consistent command surface for the implemented baseline operations: task create and inspect; task requirement bind and current requirement inspection; memory propose, accept and correct; memory inspect and bounded query. Reuse the existing source/history/operation commands. Use a bounded validated JSON file/stdin input for structured content rather than a large collection of loosely related flags.

Requirements: validate through shared schemas; keep expected versions and idempotency keys explicit; reuse one idempotency key for retries of the same request; never automatically accept a proposal or correct an expected-head conflict; preserve pending/ambiguous/rejected/committed distinctions; emit one machine-readable result and a meaningful exit status in JSON mode; make human mode clearly identify proposals versus current authority; keep owner tokens and sensitive request bodies out of diagnostics; leave backend authorization authoritative. This CLI is an operator/transport surface for memory; it does not launch or supervise coding sessions.

### B3. Read-only stdio MCP

Implement a reachable `threadline mcp` command using stdio transport only, with a narrow first tool surface: bounded memory query, memory inspection, task inspection, current task requirements, source metadata inspection, and explicitly requested bounded source content read. Map them to existing backend routes.

Bind the server to one explicitly configured project and credential at startup. Tenant, project routing, service destination and credential are configuration, not model-controlled tool arguments. Tool inputs carry only permitted selectors such as memory/task/source ids, focus and bounded read parameters. Reject arbitrary extra routing/identity fields and validate outputs with the shared contracts.

Enforce: no memory/source/task writes or human-acceptance tools; no arbitrary HTTP proxy, SQL, Cypher, shell or filesystem-read tool; no hidden endpoint selection through arguments; no inferred native session from timestamps, latest hooks or model input; server-side grants checked for every backend request; a clear distinction between absent, unavailable and conflicting current authority; bounded responses with explicit truncation/`hasMore`/refusal semantics; required obligations never silently truncated into an apparently complete set; memory and source content treated as untrusted data, never executable instructions; request timeouts, bounded concurrent requests and controlled shutdown; protocol messages on stdout only, diagnostics on stderr.

The server must not start another backend automatically or fall back to reading the database or files directly during an outage. Use a reader credential for the MCP path where the actual credential mechanism allows it; if only an owner bootstrap exists, document the credential limitation and keep the reachable surface read-only. Synthetic SQL seeding for an isolated verification identity is labelled verification setup, not a supported user command.

### B4. Configuration preview

Expose the existing pure configuration-preview renderer through a CLI command. It must render a command that reaches the implemented stdio MCP entry point, use safe executable and argument quoting, contain no embedded bearer token, show the selected project/home boundary, retain ownership and collision classifications, and write nothing into the real Codex configuration. Emit an MCP-only usable preview for this checkpoint; do not install hook entries that invoke an unimplemented `codex-hook` command. Preserve the previous renderer's qualified behavior where possible and record unsupported or unverified combinations precisely. Offline startup/handshake checks may use an isolated `CODEX_HOME`.

### B5. Documentation and capability precision

Update `README.md` with the actual usable memory/MCP surface, `docs/local-development.md` with implemented commands, `docs/cli-memory-and-mcp.md` with one complete authored workflow, and `docs/native-integration-contract.md` with newly observed transport results while preserving the three unqualified native runtime gates. Describe how a human creates/accepts/corrects memory, how a read-only client retrieves current memory and provenance, explicit project binding and credential handling, protocol errors/bounds/operation states, and exact limitations. Do not declare context preparation, capture, native identity, model writes, handoffs or full N03 complete. The coordinator owns the shared checklist; provide proposed updates only.

## Acceptance

CLI: create a task and an authored Source; propose semantic memory; show it does not govern before acceptance; human accept and bind the requirement; inspect current authority; correct 600 seconds to 60 seconds under expected-head guards; verify the old evidence and version remain; observe duplicate/mismatched retry and stale-version refusal; observe meaningful JSON exit status.

MCP: initialize, initialized notification, `tools/list` and `tools/call` through an authored protocol client; actual backend reads through each exposed tool; no mutation tools and explicit refusal of unknown or mutation tool names; project/tenant override attempts cannot change the configured scope; invalid identifiers, excessive limits and unknown arguments refuse; source reads stay bounded; a backend outage or auth failure becomes a bounded protocol error; diagnostics do not corrupt stdout; restart/reconnect behavior is explicit; the same process handles concurrent reads without cross-request leakage.

Preview: the generated configuration points at the real MCP command; deterministic rendering and quoting; no credentials in output; no real native config writes; optional offline installed-binary handshake, accurately labelled.

Run `npm run build`. Use focused temporary/manual checks outside the repository. No permanent package test suite. An authored MCP `tools/call` proves Threadline's transport, not Codex-generated `tools/call` metadata or a model reading or using the result.

## Completion and PR

Stop feature implementation at this checkpoint. Do not begin hooks, native capture, session enrollment, context preparation, model-written memory, coordination claims or handoffs in this worktree. Complete the rulebook's commit/push/PR gates and open one PR; use draft status if acceptance is incomplete. Update the result record with cleanup outcomes, implementation, dependency and version decisions, exact commands and results, limits and resources. The coordinator updates the shared checklist after integration; do not mark it independently.

## Result record — filled by Agent B for b-mcp-read-02

- **Status:** COMPLETE for this checkpoint. The human memory/task CLI, the
  project-bound read-only stdio MCP server and the executable configuration
  preview are implemented, verified against a real isolated baseline backend and
  documented. Hooks, native capture, session enrollment, context preparation,
  model-written memory, coordination claims and handoffs were not started and
  stay unavailable. N03 is not complete.

### Retirement of the previous assignment (delegated)

All gates passed before cleanup; nothing unexplained was removed.

- Merge containment: PR #9 head `fa91da80268abcb525495482ea51a8efc33d045f` is
  an ancestor of `origin/main`, merged by `ff9787c` as a true merge (its second
  parent is that head, not a squash). PR #10 head
  `ac3ca865271cd59258b04977de46f26356847a2e` is likewise contained by `f1b168f`.
- Worktree state: no staged, unstaged or untracked tracked-source changes and no
  local commits ahead of `main`. The only ignored content was disposable
  generated output (`node_modules`, three `dist/` trees, two `tsbuildinfo`
  files).
- Processes: `ps` found no process referencing the old assignment paths and no
  owned probe still running.
- Evidence: findings, digests and module results remain reviewable in tracked
  `docs/native-integration-contract.md` and `assets/codex/compatibility.json`.
  The three schema digests recorded in `compatibility.json` were recomputed from
  the generated schema bundle and matched exactly (3 checked, 0 mismatches)
  before the bundle was deleted.
- Preserved before removal, into
  `/tmp/threadline-b-mcp-read-02-checks/preserved-from-b-codex-qualification-01/`:
  `verify-codex-modules.mjs`
  (`sha256:62f73a672d05232e3a900d9de5ac74a6e5b9a0408075fe7f049fbb70a61f4121`),
  `rendered-preview.json`
  (`sha256:b2b0d16d7895a6af6c4b75aaec4a9fef0cbfbcf59ff3abebfcee3e66715076a9`)
  and `rendered-profile-digest.txt`
  (`sha256:7501dd2846ef9f8601d6382c141193a4d4f9beb3bd4a16932c33398ec69ed017`).
  A token scan of the preserved preview found no token-like string.
- Removed: the disposable probe root
  `/tmp/threadline-b-codex-qualification-data-01` (an isolated `CODEX_HOME` with
  no auth/token/credential/key file, generated schemas, authored probes and
  logs), the disposable generated dependencies and build output in the old
  worktree, and then the worktree itself with `git worktree remove` from the
  coordinator checkout, **without** `--force`.
- **Retained:** local branch `threadline/b-codex-qualification-01` and remote
  branch `origin/threadline/b-codex-qualification-01`, both at `fa91da8`. Remote
  deletion is a separate coordinator decision.

### Baseline, branch and worktree

- Resolved `origin/main` after fetching:
  `f1b168f65fd5e0e44f3f78e290ed68e3038a3490` (merge of PR #10), equal to the
  coordinator's local `main`, and clean.
- Branch `threadline/b-mcp-read-02`, worktree `/tmp/threadline-b-mcp-read-02`
  (canonical `/private/tmp/threadline-b-mcp-read-02`), created from that literal
  SHA. Verified: `pwd`, toplevel, branch, HEAD, clean status, and no upstream
  before the first push. `npm ci` installed 101 packages into this worktree
  only. The coordinator checkout and Agent A's worktree were not edited.
- Node.js v23.11.0, npm 11.4.1.

### Verification resources created (all outside the repository)

- Containers: `threadline-b-mcp-read-02-postgres` (`postgres:18-alpine`, host
  port `55443`) and `threadline-b-mcp-read-02-falkordb`
  (`falkordb/falkordb:6.0.2`, host port `56443`, append-only with
  `appendfsync always`).
- Volumes: `threadline-b-mcp-read-02-pg-data` and
  `threadline-b-mcp-read-02-falkordb-data`.
- `/tmp/threadline-b-mcp-read-data-02` (mode `0700`): `home/`
  (`THREADLINE_HOME`), `logs/serve.log`, a generated `pg.env`, per-run
  `mcp-reader-*.token` files, an isolated `CODEX_HOME` for offline binary
  inspection, and authored probe roots. Generated throwaway database passwords
  live only in `pg.env`, the owner token only in `home/credential.json`; none
  were printed into the repository, into a log, or into argv.
- Service: `threadline serve` on `127.0.0.1:47833`, running the unchanged merged
  backend from this worktree.
- Migrations 1–4 applied through the normal setup path (`threadline init`):
  schema version 4 applied, restricted role verified, graph reachable, source
  root writable, local owner identity created.
- Two isolated project identities per acceptance run, in one tenant, so a project
  override attempt is provable.
- Restricted application role `threadline_b02_app` created as LOGIN /
  NOSUPERUSER / NOBYPASSRLS.
- Untouched: the baseline service on `47822`, the `threadline-local-*` containers
  and volumes, Agent A's `threadline-a-n02b-evidence-02-*` containers, and every
  pre-existing resource.

### Implemented behavior and changed paths

New CLI commands, all reusing one core implementation
(`packages/cli/src/memory-surface.ts`) that is also used by the MCP server:

- `task:create`, `task:inspect`, `task:require`, `task:requirements`
- `memory:propose`, `memory:accept`, `memory:correct`, `memory:inspect`,
  `memory:query`
- `operation:inspect`
- `mcp`, `codex:preview`

Two rules are enforced in code rather than by convention: an expected version
and an idempotency key are always supplied by the caller (the CLI never derives
an expected head, never invents a key, never auto-accepts a proposal and never
auto-corrects an expected-head conflict), and content-bearing input arrives as
one bounded JSON document (at most 256 KiB, from a file or `--input -`) validated
by the shared input contract. Exit status is `0` for a successful read or a
committed operation, `1` for a refusal or failure, `2` for a usage error and `3`
when the operation still has no durable outcome. `--json` emits exactly one
machine-readable result and `--wait` follows an operation to a settled state
without ever turning a refusal into a pass. Malformed input is reported as a
bounded typed error with a field path, never as a raw validator dump, and no
credential or submitted body reaches diagnostics.

`packages/cli/src/mcp/server.ts` — the read-only stdio MCP server, built on the
official `@modelcontextprotocol/server` SDK. Six tools
(`threadline_memory_query`, `threadline_memory_inspect`,
`threadline_task_inspect`, `threadline_task_requirements`,
`threadline_source_inspect`, `threadline_source_read`) map onto existing GET
routes. The server verifies its project binding against the credential before
opening the transport and refuses to start otherwise, uses strict input schemas
(`additionalProperties: false`), bounds concurrency and request time, shuts down
on stdin close / `SIGINT` / `SIGTERM`, writes protocol output to stdout only and
diagnostics to stderr, never starts a backend and never reads SQL or source files
directly.

`packages/cli/src/codex/mcp-preview.ts` — the MCP-only configuration renderer
behind `codex:preview`. It reuses the qualification's quoting, ownership marker
and `checkPreviewOwnership` classification, renders the same
`$CODEX_HOME/threadline.config.toml` profile selected with
`codex --profile threadline`, and renders **no** hook entry because
`threadline codex-hook` does not exist in this build. It writes nothing and
renders no credential.

Changed paths, all inside the writable set: `packages/cli/src/memory-surface.ts`
(new), `packages/cli/src/mcp/server.ts` (new),
`packages/cli/src/codex/mcp-preview.ts` (new), `packages/cli/src/index.ts`,
`packages/cli/src/options.ts`, `packages/cli/package.json`, `package-lock.json`,
`assets/codex/README.md`,
`assets/codex/preview/mcp-only/threadline.config.toml` and
`assets/codex/preview/mcp-only/threadline-codex.manifest.json` (new, generated
from the renderer), `README.md`, `docs/local-development.md`,
`docs/cli-memory-and-mcp.md` (new), `docs/native-integration-contract.md` and
this record. `packages/backend/**`, `packages/shared/**`, `CONTEXT.md`,
`docs/development-checklist.md`, `docs/parallel-work-rulebook.md`, the root
`package.json`, `compose.yaml` and `.gitignore` are unchanged.

### Dependency decision

One dependency added, pinned exactly: `@modelcontextprotocol/server@2.3.1`
(Apache-2.0, official Model Context Protocol TypeScript SDK, current stable v2
line, Node >=20, `zod ^4.2.0`). The legacy v1 line
`@modelcontextprotocol/sdk@1.32.1` was considered and rejected. The repository
already uses `zod 4.6.7` and Node >=22, so both are compatible;
`package-lock.json` gained 26 lines and nothing else. Adopting the official SDK
avoided a second custom general-purpose protocol stack.

### Exact verification and results

`npm run build` (`tsc -b`) passes with no errors on the final source.

- **CLI — 45 checks, 45 passed, 0 failed** (temporary script outside the
  repository). Authored Source -> task -> proposal -> it does not govern
  (`current: null`, the version appears under `candidates`) -> human acceptance
  with a graph receipt -> requirement binding reports `missing_current` before
  acceptance and `current` after -> current-authority reads -> correction from
  600 to 60 seconds with `supersedesVersionId` set and the new source cited ->
  the 600-second evidence still `available` and still in `history` -> an exact
  retry returns the same operation -> the same key with a changed payload refuses
  `idempotency_mismatch` (exit 1) -> a stale `expectedCurrentVersionId` refuses
  `expected_head_conflict` and current authority does not move -> re-binding
  refuses `requirement_already_bound` -> an unbound memory under a stale task
  revision refuses `task_revision_conflict` -> a bounded query with explicit
  `hasMore` -> an unknown memory exits 1, an unknown command and an excessive
  `--limit` exit 2, and a committed operation inspect exits 0.
- **MCP — 24 checks, 24 passed, 0 failed** (authored raw JSON-RPC client, not
  Codex). `initialize` negotiated `2025-06-18`, `notifications/initialized` was
  accepted, `tools/list` returned exactly the six read-only tools with no
  mutation or acceptance tool, a mutation-shaped tool name was refused as an
  unknown tool, and a real backend read succeeded through each tool. Refusals:
  invalid identifier, `limit: 5000`, an unknown `tenantId` argument, a project
  override argument, a tenant override argument, `maxBytes: 1000000`, and a
  memory that exists only in another project in the same tenant (answered
  `not_found` with no content). Eight concurrent reads over one process produced
  no cross-request leakage. Standard output carried JSON-RPC only (29,995 bytes)
  and both diagnostics went to stderr.
- **Resilience — 13 checks, 13 passed.** Mid-session backend outage (the
  service this assignment owns, stopped by pid while the session was live): the
  next `tools/call` answered `isError` with `service_unavailable`, without driver
  or stack detail and without falling back to another storage path. Graph
  outage (the assignment-owned FalkorDB container stopped): a memory read
  answered `storage_unavailable` and served no version content from SQL or
  files. **Superseded:** this pre-merge line used a harness that restarted the
  service while the graph was down, so it evidences a bounded MCP error, not
  outage survival. The post-merge established-connection run is the survival
  evidence. Authorization failure (a reader credential pointed at a project it
  cannot see): the server never opened a transport, no protocol message was
  written, and the refusal named `scope_denied`. Restart and reconnect: two
  fresh processes each completed the handshake and each re-verified its binding
  at startup. A consolidated run of every suite passed 113 checks with 0
  failures.
- **Preview — 21 checks, 21 passed.** Deterministic bytes across two runs; the
  target Codex home stayed empty; the rendered command is this worktree's real
  `dist/index.js mcp` with `--home` and `--project`; no `hooks.` entry is
  rendered; the ownership manifest is rendered; the reader token, the owner
  token and any bearer pattern are absent from the output; targets classify as
  `absent`, `owned` (identical bytes), `edited` and `foreign`, with a foreign
  file left byte-identical; an executable path containing a space is quoted; and
  `--json` reports `mcp-only`, the server command line and two file digests.
- **Installed-binary offline inspection — 10 checks, 10 passed.**
  `codex-cli 0.163.0` with an isolated `CODEX_HOME` accepted the rendered
  MCP-only profile: `codex -p threadline mcp list --json` reported the server
  with `transport.type: "stdio"`, the exact node executable and argument vector
  (`.../dist/index.js mcp --home ... --project ...`), `required` absent (so
  optional) and `env` carrying only `THREADLINE_HOME`, with no credential
  anywhere. The real native home was not modified (identical entry count before
  and after), no credential was written into the isolated home, and no login,
  trust change or inference was performed.

Two defects were found and fixed rather than left in place: the operation-poll
timer was `unref`'d, which let Node exit between polls with no output and a
success exit code, so an unfinished operation could be reported as a finished
one; and caller-supplied request documents were validated with a throwing
`parse`, which dumped a raw validator error to stderr instead of a bounded typed
error.

### Runtime observations versus authored checks, and what stays unqualified

- **Observed on the installed binary:** the profile route parses; `mcp list`
  reports the rendered stdio server with its exact command, args and env; the
  server is optional; no credential appears in the listing or the rendered file.
- **Observed negative, recorded precisely:** in this isolated home,
  `codex -p threadline debug prompt-input` completed offline but did **not**
  start the optional MCP server. The earlier qualification observed a spawn on
  that command with a profile that also carried hook entries. The difference is
  not isolated here, so the installed binary's optional-server startup timing on
  0.163.0 is an open observation and is now listed in the integration contract
  as a fourth, smaller qualified-pending item.
- **Authored checks establish** Threadline's transport only: the handshake, the
  tool surface, the refusals, the bounds and the concurrency behaviour.
- **Still unqualified and unchanged:** native hook stdin/stdout runtime
  execution; `additionalContext` delivery and spill; MCP `tools/call` host
  metadata identifying a conversation; fork and subagent identity correlation.
  An authored `tools/call` is **not** evidence that Codex generates tool-call
  metadata or that a model reads or uses the result. No native session was
  registered or fabricated, and no model-issued write path exists.

### Proposed checklist updates (coordinator applies after integration)

- Under N03, note that a project-bound read-only stdio MCP server and the human
  CLI memory workflow are implemented and verified, and that the shipped Codex
  preview is MCP-only because `threadline codex-hook` is unimplemented.
- Keep N03 unchecked and keep the three unqualified native runtime gates listed.
- Add the fourth, smaller pending item: a qualified-pending observation of when
  the installed 0.163.0 binary starts a `required = false` stdio MCP server.
- Record that a reader-grant credential has no supported issuance path in this
  build; a later assignment must add one before the MCP path can be operated
  without out-of-band setup.
- Leave open: `memory.episode.record`, procedures, `context.prepare`,
  `context.occurrence`, `claim.status`, `session.register`, `job.import`,
  deletion and export.

### Resources still running (for coordinator retirement)

Containers `threadline-b-mcp-read-02-postgres` and
`threadline-b-mcp-read-02-falkordb`, volumes
`threadline-b-mcp-read-02-pg-data` and
`threadline-b-mcp-read-02-falkordb-data`, the `threadline serve` process on
`127.0.0.1:47833`, and the directories `/tmp/threadline-b-mcp-read-data-02`
(removing it also destroys the generated credentials) and
`/tmp/threadline-b-mcp-read-02-checks`. Nothing outside those names is
assignment-owned.

### Backend defect reported to the coordinator (superseded — see below)

Reported before the merge; observed as fixed by Agent A's `a-n02b-evidence-02`.
The exact reproduction, the verbatim pre-merge stack and the limitations of the
original finding are in **Backend defect: exact reproduction, resolution and
limitations** below. The original text is kept here as the first report.

While running the graph-outage check, the unchanged merged backend **aborted
the whole process** when the assignment-owned FalkorDB container was stopped:

```text
node:events:485
      throw er; // Unhandled 'error' event
SocketClosedUnexpectedlyError: Socket closed unexpectedly
    at Socket.<anonymous> (node_modules/@redis/client/dist/lib/client/socket.js:250:33)
Emitted 'error' event on FalkorDB instance at:
    at node_modules/falkordb/dist/src/falkordb.js:49:42
```

Two "FalkorDB connection reported an error" warnings are logged first, so the
`live.on('error', …)` handler in `packages/backend/src/storage/graph.ts` does
fire for one emission path; a second path re-emits `'error'` on a FalkorDB
instance that has no listener, and Node then aborts.

Impact: a lost graph connection can take the memory service down, so a client
read in flight during a graph outage may get no answer at all instead of the
`storage_unavailable` this checkpoint verifies. The N02A claim that "a lost
FalkorDB socket no longer aborts the process" therefore holds only for the
emission path the single listener covers.

This is in `packages/backend/src/storage/graph.ts`, which is owner A's module
and read-only for this assignment, so it was reported rather than fixed.

Correction to the first report, recorded here rather than quietly edited away:
the line above originally said reproduction was reliable. It was not. Twelve
deliberate read attempts against a stopped container did **not** abort the
process; the abort reproduced reliably only with an MCP-driven read sequence in
flight. The harness's restart-while-graph-down workaround was then removed
entirely and replaced by the established-connection run below, so no result in
this record depends on it.

### Merge of Agent A's corrected work into this branch

`origin/main` advanced to `4bdf80145cd546e0e78dc2bf9375c4a40ec06359` (merge of
PR #12, `threadline/a-n02b-evidence-02`). This branch was updated with a normal
merge commit `147ed1068dfa7eed7e8ce55ea8313686c1a35a0a`; no file needed manual
resolution and no history was rewritten. Nothing on this branch was merged,
published or retired.

Compatibility was checked as **contract** compatibility, not only as a clean Git
merge. There is no new SQL migration (the applied schema is still version 4), and
the service was restarted against the **existing** isolated database — no reset,
no re-initialisation — where the migration ledger for versions 1-4 still verifies.
The new shared contracts changed the meaning of existing fields rather than
adding routes alone, and the client follows them:

- `proposeMemoryInputSchema.content` and `correctMemoryInputSchema.content` now
  use `memoryAuthoringSchema` (semantic or procedural only). The CLI passes the
  caller's JSON document through that shared schema, so it picked the narrowing
  up without a code change.
- `proceduralAuthoringSchema` is strict: `procedureState` and `reviewRef` are
  server-resolved and a caller that sends them is refused, not silently ignored.
- The stored form gained `episodicContentSchema.evidencePrecision` and
  `proceduralContentSchema.supportedBy`. The MCP tools validate responses with
  the shared `memoryViewSchema`/`memoryQueryResultSchema`, so they parse the new
  shapes; this was verified against a real procedure and not assumed.

One client change was needed. A refused proposal used to print only the error
code and message, hiding the field path the shared payload already carries. The
failure line now renders the payload's bounded primitive details, so a rejected
document says which field was wrong without echoing the document back.

### What the merge changed for this checkpoint's product surface

Implemented now: episode admission (`memory.episode.record`, route
`POST /v2/memories/episodes`) and procedural candidates with human review. A
procedure is proposed and accepted through the existing `memory:propose` /
`memory:accept` path and stays `procedureState: "candidate"`.

Unavailable and stated as such: validated procedural reuse
(`memory.procedure.validate`), bounded context preparation and occurrence
recording, claims, handoffs, native enrollment and capture, history import,
deletion and export. Strong native identity is still unqualified, so the MCP
server stays read-only and model-issued writes stay disabled.

Client-surface gaps this merge exposed, left for the next client batch rather
than expanded into here: episode recording has a served route but no CLI command
(`threadline memory:episode:record` would be the consistent spelling), and there
is nothing for a CLI command to call for procedure validation while the
capability is unavailable. `memory:propose` correctly refuses episodic content,
because an episode resolves its own evidence precision.

### Re-verification after the merge

`npm run build` passes. A consolidated run against the merged backend passed
**128 checks with 0 failures**: CLI 45, shared-schema compatibility 15, MCP 24,
authorization failure 2, mid-session HTTP outage 5, graph outage 3, restart and
reconnect 3, preview 21, installed-binary offline 10. Transcript:
`/tmp/threadline-b-mcp-read-data-02/logs/verification-merged.txt`.

**Established-connection graph outage and recovery, with no restart in between.**
The service holds a live graph connection proven by a real read; the
assignment-owned FalkorDB container is stopped; the *same* process (pid 68479)
answers two further reads and one MCP tool call with `storage_unavailable:
FalkorDB is disconnected or reconnecting.`, serves no version content from SQL
or files, and stays alive; the container is then restored and that same process
answers reads again and reports `ready`. Recorded verbatim in
`/tmp/threadline-b-mcp-read-data-02/logs/graph-outage-established.txt`.

This deliberately replaces the earlier harness. The pre-merge run obtained its
graph-outage result by restarting the service while the graph was down, which
made the MCP side look healthy but proved nothing about survival; it is not
cited as outage-survival evidence anywhere, and the earlier three-check
"graph outage" line in the pre-merge result above should be read as "the MCP
surface returns a bounded error when the backend is up and the graph is
unavailable", not as survival evidence.

**Authored verification versus installed runtime compatibility is unchanged.**
The MCP checks above are an authored JSON-RPC client speaking to Threadline's own
server; they prove Threadline's transport, tool surface, refusals and bounds.
They say nothing about Codex generating `tools/call` metadata, a model reading
the result, native hook runtime execution or identity correlation. The only
installed-binary evidence is the offline `codex -p threadline mcp list --json`
inspection, and `debug prompt-input` still did not start the optional server in
an isolated home.

### Backend defect: exact reproduction, resolution and limitations

Reported by this assignment before the merge; now observed as fixed by
`a-n02b-evidence-02` (`4c26199 Fix graph connection recovery and installation
target safety`). The exact pre-merge reproduction, kept here so Agent A can
re-run or refine it:

1. Start the service against the merged-at-the-time backend with FalkorDB **up**
   and perform at least one real read, so it holds an established connection.
2. `docker stop <assignment-owned falkordb container>`.
3. Issue reads from a second client.

Observed pre-merge result, verbatim from the service log:

```text
{"level":"warn","message":"FalkorDB connection reported an error; the store will reconnect on the next call.","errorName":"Error"}
{"level":"warn","message":"FalkorDB connection reported an error; the store will reconnect on the next call.","errorName":"Error"}
{"level":"warn","message":"FalkorDB connection reported an error; the store will reconnect on the next call.","errorName":"Error"}
node:events:485
      throw er; // Unhandled 'error' event
      ^
SocketClosedUnexpectedlyError: Socket closed unexpectedly
    at Socket.<anonymous> (node_modules/@redis/client/dist/lib/client/socket.js:250:33)
    at Object.onceWrapper (node:events:622:26)
    at Socket.emit (node:events:507:28)
    at TCP.<anonymous> (node:net:351:12)
Emitted 'error' event on FalkorDB instance at:
    at Class.<anonymous> (node_modules/falkordb/dist/src/falkordb.js:49:42)
```

Three warnings are logged and then the process aborts, so the single
`live.on('error', …)` listener covered the first emissions and a later emission
found no listener. The service is `packages/backend/src/storage/graph.ts`, which
this assignment may not edit, so it was reported rather than fixed.

Limitations of the original finding, stated so it is not over-read:

- It was **not** deterministic. Twelve consecutive CLI reads against a stopped
  container did not abort the process; the abort reproduced reliably only when an
  MCP-driven read sequence was in flight.
- The exact emission that escaped the listener was not isolated; the stack only
  shows that the error was re-emitted on a `FalkorDB` instance.
- The original three-check "graph outage" result was obtained with the service
  restarted while the graph was down. It is **not** survival evidence, and it is
  now superseded by the established-connection run above.

Post-merge, the same established-connection sequence does not abort the service
and the process recovers on its own. That is a client-observed result, not a
claim about every failover path.

### Backend Guarantees wording: resolved by the coordinator

Agent B reported that `threadline status` still described episodes and procedures
as unimplemented after their backend support merged. That observation was valid
at the B handoff head `c4f1806`; B correctly left backend source to its owner.

On 18 October 2026, the user requested resolution during PR #13 review. Under
the coordinator scope reservation above, this branch now corrects the durable
`guarantees.note` and adjacent comment in `packages/backend/src/index.ts`.
The note names episode admission and human-reviewed procedural candidates as
implemented, preserves acceptance versus validation, and states validated
procedural reuse, bounded context/occurrences, agent claims, handoffs and native
capture as unavailable. No contract, migration or capability changed.

Coordinator verification on this correction:

- `npm run build`: passed.
- Assignment H1, heading hierarchy, labelled fences and local links: passed;
  `git diff --check`: passed.
- Temporary verifier:
  `/tmp/threadline-b-mcp-read-02-checks/coordinator-status-wording.mjs`.
  It used the explicit B installation root and assigned synthetic stores, with
  a temporary listener on `127.0.0.1:47834`. Authenticated `/v2/status` returned
  `state: ready` and the corrected note; the full health report passed the
  shared schema. The note is 648 UTF-8 bytes, within the 1024-character limit.
- Authenticated `/v2/capabilities` passed its shared schema:
  `memory.episode.record` supported; `memory.procedure.validate`,
  `context.prepare`, `context.occurrence`, `claim.acquire`, `handoff.offer`
  and `session.register` unavailable.
- The temporary service stopped cleanly. B's existing service on 47833 was not
  restarted and retains its already-loaded wording until restart; this is
  validation of the corrected build on the temporary listener.
- Two initial verifier attempts failed before successful HTTP verification:
  an incorrect backend build-output import path, then a port-zero URL that
  this service address helper does not resolve to the assigned port. The
  verifier now uses the actual package entry point and reserved port 47834.
- The earlier 128 checks remain evidence for the integrated client/transport
  code at `13112cf`; they were not repeated for this note/comment-only source
  correction. Native runtime gates remain unqualified and N03 incomplete.

The correction is included in this PR rather than waiting for a separate main
change and another merge. Review and integration remain coordinator actions.

### Documentation consistency check (Agent B handoff, `13112cf`)

Checked that `README.md`, `docs/local-development.md`, `docs/cli-memory-and-mcp.md`,
`docs/native-integration-contract.md` and this record all say the same thing about
what is implemented, what is unavailable, and what is unqualified.

| Claim | README | local-development | cli-memory-and-mcp | native-integration-contract | this record |
| --- | --- | --- | --- | --- | --- |
| Semantic memory, tasks, episodes, procedural candidates implemented | yes | yes | yes | yes | yes |
| Validated procedural reuse unavailable | yes | yes | yes | yes | yes |
| Bounded context / occurrence recording unavailable | yes | yes | yes | yes | yes |
| Native capture and enrollment unavailable | yes | yes | yes | yes | yes |
| Strong native identity / `tools/call` unqualified | yes | yes | yes | yes | yes |
| N03 not complete | yes | yes | yes | yes | yes |
| Authored MCP checks are not installed-binary evidence | — | — | yes | yes | yes |

At Agent B's handoff, every local Markdown link in the four documents resolved;
every fence was language-labelled; each file had one H1 and hierarchical
headings. The backend Guarantees discrepancy identified then is resolved in the
coordinator correction above.

Before the coordinator correction, the commits after verified head `13112cf`
were documentation-only, so Agent B did not repeat its build or 128 checks. The
coordinator build and focused status verification are recorded above. The
original transcript at
`/tmp/threadline-b-mcp-read-data-02/logs/verification-merged.txt`
(`sha256:a93eaf6308764a69c568f964b8db0afefcc4c5307cd6a9d710276b732a97da84`)
records those earlier 128 checks, before the coordinator wording correction.

### Recovery and artifact paths

The complete assignment prompt and contract are in the first half of this file.
The verification scripts live outside the repository, in
`/tmp/threadline-b-mcp-read-02-checks/` (`run-all.sh`, `cli-acceptance.sh`,
`schema-compat.sh`, `mcp-acceptance.sh`, `mcp-client.mjs`, `mcp-resilience.mjs`,
`outage-driver.sh`, `graph-outage-established.sh`, `preview-checks.sh`,
`offline-binary.sh`). `run-all.sh` runs all of them and writes one transcript.
`graph-outage-established.sh` is the only graph-outage harness; the earlier
restart-based `graphoutage-driver.sh` was deleted so it cannot be mistaken for
the survival check. They are reproducible but disposable: no permanent package
test suite was added, by instruction, so a later batch that changes these paths
must reproduce equivalent checks.
