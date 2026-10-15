# FalkorDB Track 2 architecture notes

Snapshot: 15 October 2026. M01 now adds real PostgreSQL/FalkorDB storage, local human sessions, durable goal admission and authenticated CLI/TUI inspection. Model/tool execution, memory continuity and protected completion remain unimplemented.

## Run the local backend and client

```sh
npm run build
npm test
npm run start --workspace @threadline/backend
# In another terminal:
node packages/cli/dist/index.js tui
# Scriptable checks:
node packages/cli/dist/index.js health
node packages/cli/dist/index.js echo "hello"
```

The default endpoint is `http://127.0.0.1:47821`; `--backend <url>` selects another configured local endpoint. For durable M01 work, follow [local setup](docs/local-development.md): configure `.env`, start Compose, run `npm run db:setup`, then start the backend. The backend loads root `.env`; the CLI does not.

```sh
node packages/cli/dist/index.js init
node packages/cli/dist/index.js fixture
node packages/cli/dist/index.js admit
node packages/cli/dist/index.js inspect
```

`admit` requires explicit consent and retains a durable request record for retries. The TUI shows current accepted task/criteria/source authority. Echo and SSE remain process-local (`replayable=false`). See [M01 integration evidence](archive/plans/review/m01-integration-verification.md), [the implemented contract](docs/m01-contract-agreement.md) and [the master checklist](archive/plans/track2-implementation-checklist.md). Verification used Node v23.11.0; Node 24 remains untested.

## Hackathon and selected track

- [Hackathon overview](https://www.wemakedevs.org/hackathons/falkordb)
- [Tracks](https://www.wemakedevs.org/hackathons/falkordb#tracks)
- [Official rules](https://www.wemakedevs.org/hackathons/falkordb/rules)
- [FalkorDB source repository](https://github.com/FalkorDB/FalkorDB)

**Selected track: Track 2 — Agent Memory and Coordination.** The statement shared in this conversation is:

> Build agents that remember across sessions and share state with each other. Memory should persist, update over time, and be available to every agent that needs it.

Its focus areas are:

- Episodic, semantic, and procedural memory.
- Persistent conversation history.
- Shared state and handoffs between agents.
- High-concurrency reads and writes.
- Separate memory per user or tenant.

## The problem we want to address

The user identified loss of working context during long coding sessions, compaction and replacement with a fresh session: the main goal, current constraints, earlier decisions and failed attempts may need to be reconstructed manually. Multiple workers also need to share applicable findings without copying every conversation into every context window.

## Our basic product idea

**Threadline (working name)** is a proposed local npm package with a TUI, a compact TypeScript model/tool harness, and FalkorDB-backed memory and coordination. The latest user direction is to build our own small harness, using the archived Codex, Pi and Prime Agent projects for inspiration. One explicit API provider exercises our own loop first. Optional Codex/Claude native adapters preserve the official clients' authentication and execution routes after their integration gates pass.

FalkorDB stores connected goals, constraints, decisions, tasks, attempts, procedures, conversation history and verification evidence. The coordinator selects current task context for a fresh session, shares sourced findings with affected workers, coordinates handoffs and rejects completion evidence tied to obsolete requirements. Native authentication routes and actual capture/recovery behaviour must be tested; documented support is not an implemented integration.

The [development blueprint](archive/plans/track2-development-blueprint.md) selects a two-person MVP: one BYOK provider, one declared OS/Docker target, one logical Builder and a protected deterministic service checker. Interrupt Builder, restore a genuinely fresh successor with current graph context and finish with applicable checked evidence. No RLM or summarization API is included. Child investigations and model reviewers are deferred.

The MVP harness owns eleven bounded tools, lifecycle, durable capture, context preparation and coordination. The broader catalog contains fourteen tools, with polling, decision proposal and model-review submission deferred. See the [domain glossary](CONTEXT.md) and [fresh critique/resolutions](archive/plans/review/track2-development-readiness-resolutions.md).

Start implementation with the [code-first master checklist](archive/plans/track2-implementation-checklist.md), split into [Agent A: Memory/Coordinator](archive/plans/track2-agent-a-checklist.md) and [Agent B: Harness/Frontend](archive/plans/track2-agent-b-checklist.md). Write the small runnable backend/TUI first; each milestone combines both lanes into one reviewed branch/commit after integration. Verification, fault evidence and packaging follow the working flow.

M00 was merged with review resolutions. M01 is now combined and independently verified; its merge workflow remains pending. The original launch instructions are the detailed [M01 Agent A prompt](archive/plans/prompts/track2-m01-agent-a.md) and [M01 Agent B prompt](archive/plans/prompts/track2-m01-agent-b.md). Both agents work on M01 from the same merged base and can consult the reference archives when stuck.

**Current recommendation:** TypeScript/Node for the owned harness and local TUI/backend, PostgreSQL for identity and session operations, FalkorDB for connected memory and coordination. Native subscription adapters and investigator spawning are post-hackathon milestones. See [the complete plan](archive/plans/README.md), [harness scope](archive/plans/track2-harness-scope.md).

Read the four background files below to understand the earlier local delivery/authentication decisions, then use the plans for the current implementation direction. The owned-loop proposal supersedes their native-wrapper-first scope. Historical notes retain their evidence dates. Provider authentication is route-specific, not universal OAuth compatibility.

The original collection contains **22 architecture notes** and **1 linked supporting file**. Their contents and filenames are preserved. The detailed plans, reference schemas and diagrams are indexed separately in [plans/README.md](archive/plans/README.md). All three archive folders remain reference material.

## Start here: four background decisions

- [track2-package-and-requirements-decision.md](archive/notes/track2-package-and-requirements-decision.md) — Consolidated local TUI architecture, memory model, coordination and Track 2 coverage.
- [track2-local-tui-delivery-decision.md](archive/notes/track2-local-tui-delivery-decision.md) — Local package/TUI delivery, interaction, integration gates and team ownership.
- [track2-codex-subscription-local-adapter.md](archive/notes/track2-codex-subscription-local-adapter.md) — Codex subscription authentication, app-server integration and capture/recovery seams.
- [track2-claude-subscription-local-adapter.md](archive/notes/track2-claude-subscription-local-adapter.md) — Native Claude Code subscription route, SDK distinction and adapter requirements.

## Core architecture and technical references

- [track2-architecture-core-contract.md](archive/notes/track2-architecture-core-contract.md) — Logical module boundaries, identity routing, graph authority and state transitions.
- [track2-continuity-architecture.md](archive/notes/track2-continuity-architecture.md) — Context selection, applicability, handoffs, evidence revisions and tenant separation.
- [falkordb-technical-dossier.md](archive/notes/falkordb-technical-dossier.md) — Database design, Cypher, indexes, concurrency, persistence and version caveats.
- [agentic-rag-memory-evaluation.md](archive/notes/agentic-rag-memory-evaluation.md) — Agent memory, graph retrieval, coordination frameworks and evaluation methods.
- [falkordb-agent-capability-map.md](archive/notes/falkordb-agent-capability-map.md) — How graph capabilities influence actual agent decisions and actions.
- [track2-agent-tools-and-execution-plan.md](archive/notes/track2-agent-tools-and-execution-plan.md) — Proposed typed memory/tool operations, authority boundaries and evidence checks; includes an earlier SDK option.
- [track2-portable-core-and-team-plan.md](archive/notes/track2-portable-core-and-team-plan.md) — Reusable core, adapter contracts, packaging and team split; earlier delivery assumptions are historical.
- [track2-portability-adapters.md](archive/notes/track2-portability-adapters.md) — Host integration surfaces and limits of automatic capture, restoration and lifecycle control.

## Problem scope and alternatives

- [track2-investigation-and-product-scope.md](archive/notes/track2-investigation-and-product-scope.md) — Continuity problem, proposed graph mechanism, bounded scope and validation.
- [track2-harness-and-alternatives.md](archive/notes/track2-harness-and-alternatives.md) — Existing memory/handoff tools and native harness capabilities to compare against.

## Optional spawning and swarm extensions

- [track2-bounded-swarm-product-extension.md](archive/notes/track2-bounded-swarm-product-extension.md) — Child investigations, scoped findings, resource limits and adoption gates.
- [track2-swarm-memory-reliability.md](archive/notes/track2-swarm-memory-reliability.md) — Atomic publication, cursors, acknowledgements, recovery and sharing/load probes.

## Earlier options: reference rather than current delivery

- [Original recursive-model research](archive/notes/track2-recursive-language-models-and-swarms.md) — historical investigation; removed from the current architecture and schemas.

- [track2-packaging-decision-review.md](archive/notes/track2-packaging-decision-review.md) — Earlier attachable-service assessment, competitors and decision gates.
- [track2-delivery-feasibility-check.md](archive/notes/track2-delivery-feasibility-check.md) — Earlier controlled SDK/browser application feasibility.
- [track2-user-experience-and-delivery.md](archive/notes/track2-user-experience-and-delivery.md) — Earlier browser journey; useful controls and evidence views for adaptation to the TUI.
- [track2-presentation-and-team-decision.md](archive/notes/track2-presentation-and-team-decision.md) — Earlier web-first presentation and four-person ownership.
- [track2-railway-deployment-plan.md](archive/notes/track2-railway-deployment-plan.md) — Optional future hosting topology, persistence and deployment probes.

## Linked supporting files

These are included to preserve the notes’ existing relative links:

- [track2-context-social-signals.md](archive/notes/track2-context-social-signals.md)

Historical research lives in archive/notes/; active architecture and checklists live in archive/plans/. Reference source-code archives remain ignored.

## Adversarial architecture review

- [Critic report](archive/plans/review/track2-critic-report.md): 14 findings against the baseline.
- [Independent evaluation](archive/plans/review/track2-critic-evaluation.md): accepted and qualified findings.
- [Resolution register](archive/plans/review/track2-review-resolutions.md): corrected design contracts and unexecuted implementation gates.
