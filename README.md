# Threadline

**Persistent, sourced memory and coordination for coding agents. Codex first.**

Coding agents lose useful context between sessions: a requirement changed, a previous approach failed, a decision had a reason, or another agent already investigated the problem. Threadline keeps that knowledge available to the next session and the other agents working on the project.

Threadline is being built as a local npm package for **FalkorDB Track 2: Agent Memory and Coordination**. It connects to an existing coding agent, records permitted evidence, and supplies a small, current, source-backed memory packet when the agent needs it.

> **Development status:** the repository is migrating to this product. The storage foundation (SQL catalog, restricted-role row-level security, immutable source files), the source-backed graph admission worker, semantic memory (task creation, sourced proposals, explicit human acceptance, corrections and task requirements, with current-memory reads) and source-backed episodes and procedural candidates with human review are verified against local PostgreSQL and FalkorDB. A human CLI (including `memory:episode:record`) and a project-bound, read-only stdio MCP server now expose that memory, and the Codex profile that starts the MCP server can be rendered as a preview. Validated procedural reuse, bounded context, native capture, session enrollment, model-written memory, coordination claims and handoffs are not yet implemented; capability output reports each of them as unavailable. The retired owned-execution code has been removed.

## What we are building

Threadline provides six connected capabilities:

- **Episodic memory:** what was attempted, what actually happened, and the evidence behind it. Failed, denied, interrupted and unknown outcomes remain distinct.
- **Semantic memory:** accepted requirements, decisions and scoped facts. Corrections create new versions, so an obsolete requirement does not govern the next session.
- **Procedural memory:** reusable steps with explicit prerequisites and supporting outcomes. A workflow is applicable only when the new task meets its conditions.
- **Persistent history:** permitted visible conversation and tool evidence that survives session and service restarts, with capture gaps labelled.
- **Shared state and handoffs:** current task memory, coordination claims and source-backed handoffs between independently running agents.
- **Concurrent, isolated access:** several agents can read and append evidence while guarded updates protect accepted state; users and tenants have separate project access.

An agent's proposal remains a proposal until its acceptance policy is satisfied. Repeating a claim does not make it true. Every reusable memory points to available authorized sources.

## The first integration: native Codex CLI

Codex owns the coding experience: authentication, model selection, reasoning, filesystem tools, approvals and cancellation. Threadline supplies memory through supported native integration surfaces:

1. **Hooks** capture supported visible events and request current memory at qualified session/prompt boundaries.
2. **Local MCP tools** retrieve memory, inspect evidence, propose sourced updates and exchange handoffs.
3. **Selected history import** reads explicitly chosen stored sessions through a qualified read-only interface.

The intended MCP tools are `threadline_recall`, `threadline_source`, `threadline_record` and `threadline_handoff`. Native version, event coverage and session identity must pass qualification before those capabilities are advertised. Unqualified identity keeps model mutations unavailable.

What is reachable today is the read-only half: `threadline mcp` serves
`threadline_memory_query`, `threadline_memory_inspect`, `threadline_task_inspect`,
`threadline_task_requirements`, `threadline_source_inspect` and a bounded
`threadline_source_read`, bound to one explicitly configured project and
credential. There is no proposal, acceptance, correction or requirement-binding
tool; memory is changed by a human through the CLI. MCP tool-call identity is
still unqualified, which is one reason writes stay human-only.

Each simultaneous root agent uses its own project-bound enrollment. A coordination claim governs memory updates; it does not lock native files or stop another process from editing them.

## How the memory works

Consider an inventory exporter:

1. Session A encounters a timestamp-offset bug. Threadline retains the observed failure and its source.
2. The user changes the accepted freshness requirement from **600 seconds to 60 seconds**.
3. Session A ends. A new Codex session B starts without a manually written recap.
4. Threadline supplies the **current 60-second requirement** and the earlier UTC-normalization lesson, whose applicability is independent of the freshness change.
5. B can inspect the evidence, use a compatible procedure and publish a sourced handoff.

Expected outputs in a demo fixture are specification data. Only actually observed outputs and checks become evidence. A passing example does not establish that a procedure works for an incompatible schema or environment.

## Architecture

One local TypeScript service owns authorization, evidence, accepted memory, context selection and coordination. Thin CLI, hook and MCP adapters use that same core.

```text
Native Codex CLI
    │ supported hooks + local MCP
    ▼
Threadline CLI / adapter
    │ authenticated loopback API
    ▼
Threadline memory service
    ├── PostgreSQL: identity, grants, sessions, sources, operations, jobs
    ├── FalkorDB: memory versions, current authority, provenance, coordination
    └── Local source files: permitted immutable evidence bytes
```

**PostgreSQL** owns access, enrollment, source history and durable operation progress. **FalkorDB** owns accepted memory and its relationships. **Local files** hold retained evidence bytes. The graph stores short curated memory and source references rather than a second copy of every transcript.

FalkorDB does central work: resolving current requirements, finding applicable experiences and procedures, validating provenance, guarding concurrent memory changes, and accepting handoffs. Without it, connected current-memory and coordination operations are unavailable.

### Graph model

The target graph has nine node families: `ProjectRoot`, `Task`, `SessionAnchor`, `SourceAnchor`, `Memory`, `MemoryVersion`, `Claim`, `Event` and `OperationReceipt`.

The important relationships are:

```text
Task ──REQUIRES──► Memory ──CURRENT──► MemoryVersion
                                         │
                                    SOURCED_FROM
                                         ▼
                                    SourceAnchor

Procedure version ──SUPPORTED_BY──► Observed episode
New version ──SUPERSEDES──► Earlier version
Claim ──FOR_TASK──► Task
Handoff version ──FROM_SESSION / TO_SESSION──► SessionAnchor
```

Current authority is the accepted `CURRENT` version. `observed_under` records the conditions of an observation; `applies_when` records when its advice is reusable. An unrelated requirement change need not invalidate every earlier lesson.

### Retrieval and concurrency

Memory selection starts from an authorized task/project, retrieves exact current obligations, then adds a bounded set of applicable failures, procedures and handoffs. A packet explains its sources and omissions. The initial target is a 4 KiB body with an 8 KiB hard limit; mandatory overflow is explicit.

Reads use a small catalog of indexed, bounded graph queries. Writes use expected-version guards and stable operation IDs. A graph mutation commits its state change, Event and receipt atomically; retries reconcile the same operation instead of creating duplicate effects. SQL and graph changes have explicit pending states because they do not share a distributed transaction.

## Privacy and separation

Capture is opt-in and project-bound. Historical import selects exact sessions and categories; it does not scan all native history. Hidden reasoning, native credentials and unselected records are excluded.

Tenant/project grants, scoped tokens, SQL row-level security and separate project graphs enforce access. Retrieved memory cannot reveal text from an unreadable source. The first release supports project-safe shared memory; personal work uses a separately authorized private project.

Deletion first blocks future releases, then removes managed source copies and dependent memory. Diagnostics, persistence logs and backups have explicit retention status. Already supplied context may remain in the native client's history; Threadline cannot recall it.

The hackathon demo uses authored synthetic data. The intended seven-day raw-history default, pinned evidence policy and erasure protocol must be implemented and verified before personal-history import is enabled.

## Supported human workflow

With a configured local service, a human can associate a project, create a task,
append evidence, propose a requirement and explicitly accept it under an
expected-current guard. Task requirements resolve the accepted version; a
sourced correction changes current authority while retaining old provenance.

```sh
threadline memory:episode:record --input episode.json --wait --json
threadline memory:inspect --project <projectId> <memoryId> --json
threadline mcp --project <projectId>
```

The episode document supplies the action, outcome, observation, uncertainty,
source references, applicability, observed conditions, optional requested
precision and an explicit idempotency key. The service decides evidence
precision; authored reports are proposals until a human accepts them. Procedures
can be proposed and human-accepted but remain candidates. The six-tool MCP
surface retrieves memory read-only.

Follow [the reproducible memory demonstration](docs/memory-demo.md) for setup,
a public exporter check, the 600 → 60 second correction, an accepted procedural
candidate, service restart and fresh authored MCP recall. It demonstrates
persistent memory and transport recall without a Codex inference call. Distinct
Codex session consumption and model use remain unverified.

## Intended user workflow

After the package is built and qualified, a user will:

1. Initialize local storage and a Threadline identity.
2. Associate a repository/worktree with a project.
3. Review and install an opt-in Codex profile with Threadline hooks and MCP tools.
4. Launch native Codex and use the project across sessions.
5. Inspect history, sources, current memory and handoffs through the plain CLI.
6. Correct, export or delete retained memory explicitly.

The package will include a `threadline` command. It will not need a separate provider account setup or a Threadline coding UI. Package publication and exact supported native versions remain release gates.

## Developing this repository

Use **Node.js 22 or later** and npm from the repository root:

```sh
npm ci
npm run build
```

The workspace contains `packages/shared`, `packages/backend` and `packages/cli`. These packages are changed in place. The inventory fixture is authored demo data under `fixtures/inventory-export-v1/`; it is not a backend startup requirement.

The owned execution, provider integration and coding TUI have been removed. The current build serves source capture, project association, history and capability reporting, plus semantic memory, tasks, episodes and procedural candidates: `POST /v2/tasks`, `POST /v2/memories/proposals`, `POST /v2/memories/episodes`, `POST /v2/memories/:memoryId/acceptance`, `POST /v2/memories/:memoryId/corrections`, `POST /v2/tasks/:taskId/requirements`, and the `GET` reads that resolve current memory and current requirement versions. Validated procedural reuse, bounded context, coordination and native capture are reported as unavailable with their batch. Setup and status commands are:

```sh
npm run setup -- --home /absolute/isolated/installation
                 # applies threadline_memory, verifies privileges, creates the owner credential
npm run serve -- --home /absolute/isolated/installation
                 # runs the loopback memory service
npm run status -- --home /absolute/isolated/installation
                 # prints health, readiness and storage state
```

See [docs/local-development.md](docs/local-development.md) for configuration and the full command surface, and [docs/cli-memory-and-mcp.md](docs/cli-memory-and-mcp.md) for one complete human memory workflow and the read-only MCP server. The agent work sequence, current status and completion criteria are in [the development checklist](docs/development-checklist.md). Parallel assignments follow [the worktree and PR rulebook](docs/parallel-work-rulebook.md).

## Hackathon demonstration

The [implemented human demonstration](docs/memory-demo.md) covers the baseline
memory lifecycle. The target demonstration shows a failure remembered across two genuinely distinct Codex sessions, a changed requirement, a reusable procedure and a source-backed handoff. Supporting checks cover restart, stale-update rejection, concurrent protocol clients and two synthetic tenants. Measured client traffic is reported separately from live model agents.

Submission will include complete local setup, the consequential Cypher queries, graph model, working video, supported-version evidence and AI-assistance disclosure. Native integration and performance results will be recorded only after they are observed.

[Hackathon and Track 2](https://www.wemakedevs.org/hackathons/falkordb) · [Official resources](https://www.wemakedevs.org/hackathons/falkordb/resources) · [FalkorDB documentation](https://docs.falkordb.com/)
