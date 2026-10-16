# Threadline technology decisions: what we actually need

**16 October provider update:** the user authorized a narrow API-key provider extension after M02 integration. The existing Responses transport and a Chat Completions transport share the same guarded journal/tool loop. OpenCode Go and explicit custom endpoints are selectable; original one-provider statements below describe the earlier scope. See [current provider configuration](../../docs/provider-configuration.md). OAuth/native runtimes remain deferred.

**MVP authority — 15 October 2026:** [Development blueprint](track2-development-blueprint.md) controls release scope: two contributors, one logical Builder and fresh successor, a protected service checker, eleven tools and no automatic model summaries. This document retains broader target/reference contracts; model Verifier, polling, native adapters and fixed four-day schedules are not MVP commitments.

**Updated 14 October 2026. Proposed implementation baseline.** Build an owned harness; [scope](track2-harness-scope.md) and the [first vertical slice](track2-first-vertical-slice.md) govern. The release uses one bounded typed-tool loop and one Builder and service checker. Version compatibility and integrations remain acceptance gates; architecture recommendations are not measurements.

## 1. Selected stack

**Build the harness, backend, tools, CLI and TUI in TypeScript on Node.js 24 LTS. Use PostgreSQL 18 and FalkorDB. Ship one ordinary bounded model/tool loop with one API provider and Builder and protected service checker. Neither Python nor Rust is an application runtime requirement for the hackathon release.**

The Node release page currently lists 24 as LTS and recommends supported LTS lines for production. Pin the maintained patch when the implementation lockfile is created. [Node release policy](https://nodejs.org/en/about/previous-releases)

| Component | Choice | Why this component exists |
|---|---|---|
| Application language | TypeScript, strict mode, ESM | Shared validated contracts across UI, coordinator, adapters and storage |
| Runtime | Node.js 24 LTS, exact patch pinned in release | npm delivery; asynchronous streams, subprocesses and network/database I/O |
| CLI | Node `util.parseArgs` initially | Doctor/init/run/service commands; avoid a framework until command complexity requires it |
| TUI | React + Ink | Stateful terminal views and reusable interaction components in the same language |
| Local API | Fastify; JSON commands + SSE event stream | Schema-checked requests, authenticated local service, reconnectable UI updates |
| Runtime validation | Shared JSON Schema contracts compiled with the API's validator | TypeScript types alone do not validate native/model/network input |
| Worker/tool processes | Node `child_process.spawn`, explicit argument arrays, scoped IPC | Supervise core workers and contained command execution without shell interpolation |
| Memory tools | Shared in-process typed contracts | Apply the same policy at every call; MCP/native transports are post-hackathon |
| Coordination | Own deterministic TypeScript state machine | Claims, revisions, launch reservations, recovery and evidence checks |
| Graph database | FalkorDB, audited 6.0.2 candidate pending probes | Required relational memory and coordination authority |
| Graph driver | Official `falkordb` JavaScript client, pinned | Reviewed parameterized Cypher and proper graph wire decoding |
| SQL database | PostgreSQL 18, maintained patch/image pinned | Identity, human sessions, durable capture and projections |
| SQL access | `pg` / node-postgres + reviewed SQL migrations | Explicit transactions, composite scope keys and predictable repository operations |
| Large objects | Local project-scoped content-addressed files | Patches, logs, snapshots, context packets and backup evidence |
| Local services | Docker Compose | Reproducible PostgreSQL/FalkorDB volumes, configuration and health checks |
| Source/workspaces | Git worktrees + immutable candidate manifests | Isolate Builder edits and immutable checker input; identify exactly what was tested |
| Build/package | npm workspaces, `tsc`, lockfile, one user-facing npm package | Simple release chain and consistent dependency versions |
| Testing | Node test runner, protocol fixtures, live integration scripts | Check authority/recovery/isolation; no model call in ordinary unit tests |
| Logging | Structured JSON logs with correlation IDs and explicit redaction | Diagnose cross-process capture/commit/replay boundaries |
| Core execution runtime | Owned TypeScript loop, provider drivers and controlled tools | Primary product execution; first driver uses explicit OpenAI API credentials |

Ink is a React renderer for terminal interfaces. The official FalkorDB clients include JavaScript, and node-postgres documents parameterized query support. Those are available building blocks, not proof of our eventual integration. [Ink source](https://github.com/vadimdemedes/ink), [FalkorDB clients](https://docs.falkordb.com/getting-started/clients), [node-postgres queries](https://node-postgres.com/features/queries), [Fastify documentation](https://fastify.dev/docs/latest/)

Exact library patches belong in the implementation lockfile and release manifest after compatibility checks. The architecture selects the libraries and responsibilities now; it does not invent a tested version combination.

Native Codex/Claude adapters, direct ChatGPT OAuth, additional provider drivers and read-only spawning are post-hackathon candidates. They are not core dependencies or promised release features.

## 2. Why TypeScript for this harness

The coordinator mostly waits for model streams, tool processes and database requests; compatibility modes additionally consume native-client streams. It validates events, constructs bounded context and commits guarded state changes. The product is not a new tokenizer, inference engine or graph execution engine. FalkorDB and the native clients already run outside the coordinator process.

TypeScript keeps the TUI, process adapters, API, tool schemas and npm package in one application language. Native clients expose structured protocols rather than requiring us to link their implementation language. A Rust-written executable can be supervised from Node just as another executable can. Owning our loop also does not require writing it in the implementation language of a reference harness.

The main risks are incorrect state transitions, lost capture, stale evidence, private-source leaks and uncertain external effects. They need durable protocols, database guards and tests. Rust's ownership checking would improve some classes of implementation safety but would not make a graph write and a native shell command atomic or preserve an unobserved tool result.

| Candidate | Fit for our actual workload | Cost for this delivery | Decision |
|---|---|---|---|
| TypeScript / Node | Native protocol streams, MCP, npm packaging, React TUI, database I/O | Must bound queues, validate input and avoid blocking event loop | Selected core |
| Rust | Process supervisor, constrained helper, CPU-heavy indexing, standalone binary | Separate build/distribution and UI ecosystem; slower integration iteration for this scope | Add only after an identified requirement and measurement |
| Go | Static daemon, concurrent I/O and deployment tooling | Extra language without solving the critical integration problem | Not selected |

These are engineering judgments for Threadline, not universal language rankings or benchmark claims. If team expertise strongly favors Rust, that can change implementation cost, but no team skill preference has been supplied that justifies overriding the simpler integrated stack.

## 3. What “harness” means here

Our harness has six responsibilities:

1. Admit a goal with explicit scope, tools and budget.
2. Launch, observe, stop and reconcile runtime workers.
3. Persist visible observations and propose/accept memory through typed operations.
4. Restore current context and coordinate ownership/handoffs.
5. Bound Builder turns, tools, reservations and lifetime.
6. Accept completion only from current applicable evidence.

The owned runtime handles the model/tool loop, scoped patches/commands, provider requests and approval policy. Builder owns the writable task claim; the trusted service checker receives exact immutable inputs. A later model Verifier needs separate evidence authorization. Future native compatibility would delegate inner-loop responsibilities to the selected official client and remain an explicitly different runtime mode.

The baseline is a typed action-observation loop. ReAct describes interleaving reasoning and action; CodeAct chooses executable code as an action representation. Neither label supplies memory, durable recovery or authorization. A general code interpreter is not a prerequisite, and inspected Codex tool/code-mode support is not a reason to label the whole product pure CodeAct. [Harness tool-loop contract](track2-harness-scope.md)

Do not introduce LangGraph or a separate multi-agent framework into the core to obtain functionality already covered by the small owned loop. Framework adoption is justified only if a concrete missing capability outweighs its state/persistence integration cost. We need one authority model, not two schedulers competing to resume the same work.

## 4. Why both FalkorDB and PostgreSQL

FalkorDB answers relational authority questions: what governs this task now, which attempts still apply, what work depends on a changed source, who loaded obsolete context, and whether current verification permits completion. Removing FalkorDB disables those operations in the delivered system.

PostgreSQL serves a different access pattern: authenticate a human, revoke `user_sessions`, list projects, order messages, record runtime process observations, claim capture-delivery rows and rebuild pageable history views. It is not necessary merely because the word “sessions” exists; a graph-only prototype could store sessions. It is selected here because the requested full product includes identity/session operations and operational history with explicit relational constraints.

This choice adds a real cost: two data services and reconciliation between SQL capture and graph authority. The architecture includes that protocol. If event-time setup proves too large, a graph-only demonstration is a separately documented scope cut; it must not be quietly substituted while advertising the full relational/session design.

Choose PostgreSQL once. MySQL is a future driver with its own migrations and isolation tests. Do not implement both during the hackathon. Avoid an ORM abstraction that suggests graph and SQL can share one transaction; use small repositories with explicit operations instead.

The [core PostgreSQL reference DDL](schema/postgresql-core-reference.sql) excludes the two `extension` tables. The [complete target reference](schema/postgresql-reference.sql) preserves later designs for inspection; it is not the hackathon migration input. In particular, native bindings and OAuth registrations stay out of core migrations. Stage the required core tables with their owning vertical slices rather than treating the complete reference as a first-day implementation checklist.

## 5. Minimum first vertical slice

The [code-first checklist](track2-implementation-checklist.md) begins with a runnable service and plain TUI before database/checker preflight. It supplies exact two-agent task ownership and integration order; the table below summarizes product slices, not a requirement to finish every infrastructure artifact before coding.

The complete schema is a reference model, not a reason to implement every feature before a real agent turn. Build in this order:

| Slice | Implement | Stop condition |
|---|---|---|
| A | Node CLI/service, one local identity/project, FalkorDB guards, SQL capture, owned model/tool loop | Real controlled tool outcome captured and admitted to graph |
| B | Task packet, one Builder, interrupted action reconciliation, fresh session | Fresh runtime session continues current task without manual recap |
| C | Requirement revision, candidate snapshot, trusted checker and executable receipts | Obsolete receipt rejected; exact current candidate accepted |
| D | TUI history/evidence, procedure reuse, persistence, tenant tests, packaging | Core user journey works after clean install and restart |
| Post-hackathon | One justified native/auth/provider extension or bounded read-only children | Core has shipped; extension's independent conformance/value gate passes |

Use source-controlled schema versions and add core tables at the slice that needs them. The [first vertical slice](track2-first-vertical-slice.md) fixes one provider, one tested OS/container profile and an authored fixture. Remote OIDC enrollment and native/OAuth extension flows also remain outside this release.

## 6. Reasons to introduce Rust later

Introduce a narrow Rust helper only if profiling shows a measured CPU/memory problem that cannot be handled by bounded streaming or worker threads, or a clearly specified process-isolation/distribution requirement benefits from a separately reviewed binary. Candidate examples are large snapshot hashing or a hardened process supervisor. None has been demonstrated as a bottleneck.

Preserve the same versioned IPC contract and TypeScript coordinator authority if a helper is added. Do not rewrite the whole harness based on expected inference latency improvements: most inference time occurs at the provider or model runtime.

## 7. Things we do not currently need

No separate vector database, Kafka, RabbitMQ, Kubernetes, public API gateway, browser framework, distributed workflow engine or microservice fleet is required for the selected local workflow. No custom training or fine-tuning is required. Embeddings are optional; exact identifiers and bounded graph traversal implement mandatory context.

These exclusions follow the actual workload and delivery boundary. Revisit them only when a new requirement has a specific owner, failure model and acceptance test.

## 8. Summarization infrastructure

The release needs no separate summarization API/provider/service. Use deterministic extraction and the primary agent's ordinary checkpoint output first. Any later optional condensation call reuses the existing model broker, secret reference, journal and budget; it must pass the source/privacy/applicability and global-capacity gates. It is not an extra mandatory dependency or an automatic call after every turn. [Cadence contract](track2-runtime-and-protocols.md#21-capture-checkpoint-and-summarization-cadence).
