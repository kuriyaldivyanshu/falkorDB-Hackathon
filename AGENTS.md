# Repository guidelines

## Current direction and first action

Threadline is a Codex-first local memory and coordination package for FalkorDB Track 2. Codex owns inference, tools, authentication and execution. Owned execution has been removed. Source storage, graph delivery, accepted-memory/task services, episode CLI, scoped reader access, context CLI and opt-in audited context MCP are implemented. Native enrollment/capture/Codex qualification and later coordination/privacy work remain incomplete.

Before source work, read [docs/development-checklist.md](docs/development-checklist.md), select the next incomplete batch and use its file ownership and completion criteria. Before parallel work, branch/PR operations or worktree cleanup, follow [docs/parallel-work-rulebook.md](docs/parallel-work-rulebook.md) and the tracked assignment contract. Read [CONTEXT.md](CONTEXT.md) when changing domain contracts. The root README describes the product and actual supported commands; the development checklist records implementation status.

Local archive source is optional historical reference. `docs/plans/`, `docs/migration.md` and `docs/evidence/` are ignored working material and may be absent in a fresh checkout; required instructions and acceptance criteria must live in tracked files. The previous execution roadmap is cancelled.

## Module ownership

- `packages/shared/`: neutral identity, source, memory, coordination, context and protocol contracts.
- `packages/backend/`: memory-only composition, authorization, evidence, graph operations, context and privacy.
- `packages/cli/`: plain CLI, transport, Codex hooks/history adapter and stdio MCP.
- `fixtures/`: explicitly selected authored demo data. The memory service must start without fixtures.

Extract useful digest, file-safety, authorization, lease, receipt and bounded-selection logic into those responsibilities. Remove old call sites before deleting their dependencies. Keep one definition per target contract and one core implementation.

## Storage and native boundaries

New data uses SQL schema `threadline_memory`, fresh versioned project graphs, new credentials and a separate source root. Existing data/volumes are outside source cleanup. Database resets and native configuration installation require their own explicit instruction.

Use scoped source/operation identities, decimal-string 64-bit counters, expected-version guards and graph receipts. FalkorDB is canonical for accepted memory; SQL owns access and source history. Native observation is not provider-wire proof or protected completion.

Capture only permitted visible records. Use authored/synthetic verification data. Keep credentials, private transcripts and hidden reasoning out of source, logs and examples. Native inference requires explicit authorization for that action; previous live acceptance is not ongoing permission.

## Development and verification

Use Node.js >=22 and npm. Read actual package scripts before running them. `npm run build` is the workspace build; run it after source/build-configuration changes. Current setup/start scripts target the memory service; capabilities distinguish implemented source, memory, task and backend context services from unavailable native integration and later features.

Use focused manual or temporary checks outside the repository for authorized implementation verification. Permanent package test suites were removed at the user's request. For documentation changes, check local links, headings, fences and consistency. Report exactly what ran, passed, failed and remains unverified.

## Documentation and integration

Use one descriptive H1 per Markdown file, hierarchical headings, short paragraphs and language-labelled fences. Update product instructions and the migration status in the same batch as behavioral changes. Keep proposed commands distinct from implemented ones; publish evidence only for observed behavior.

The coordinator reserves shared-file ownership and owns the execution checklist during parallel work. Each worker uses one bounded assignment/worktree/branch/PR and reports results in its owned assignment record. Review fixes stay with that PR; the coordinator integrates serially and retires verified worktrees. Start each later checkpoint from fresh updated main. Integrate dependent contract/entry-point changes together and leave a buildable result. Preserve unrelated dirty changes. Use concise imperative commit subjects and describe behavior, affected modules and validation in review summaries.
