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

## Result record — owner fills during the assignment

_Filled at the end of this assignment; see the record below the prompt._