# FalkorDB Track 2 architecture notes

Snapshot: 13 October 2026. These are research and planning documents; no product, login test, runtime integration or benchmark has been completed.

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

**Threadline (working name)** is a local npm package with a TUI and a FalkorDB-backed memory/coordination service. It orchestrates existing Codex or Claude Code sessions through tested native-client adapters. The native clients retain their model execution, coding tools, authentication and permissions.

FalkorDB stores connected goals, constraints, decisions, tasks, attempts, procedures, conversation history and verification evidence. The coordinator selects current task context for a fresh session, shares sourced findings with affected workers, coordinates handoffs and rejects completion evidence tied to obsolete requirements. Native authentication routes and actual capture/recovery behaviour must be tested; documented support is not an implemented integration.

The first intended demonstration uses Builder and Verifier: record actual work, change a requirement, interrupt Builder, restore a genuinely fresh successor with current graph context, and finish with applicable verification evidence. Bounded child investigations are an optional extension after that path works.

This is a lightweight memory/coordination harness built around existing coding agents. The architecture notes below explain its implementation boundaries and proposed acceptance tests.

**Current recommendation:** a local npm/TUI package, one coordinator, persistent FalkorDB and tested native Codex/Claude Code adapters. Start with one working adapter. The earlier web-first and independent SDK proposals are retained as alternatives; they are not the current launch prerequisites.

Read the four files under Start here first. Older technical notes retain their own evidence dates and may contain superseded delivery assumptions. The native-authentication notes distinguish supported provider routes rather than claiming universal OAuth compatibility.

This collection contains **22 architecture notes** and **1 linked supporting file**. Original note contents and filenames are preserved.

## Start here: current recommendation

- [track2-package-and-requirements-decision.md](notes/track2-package-and-requirements-decision.md) — Consolidated local TUI architecture, memory model, coordination and Track 2 coverage.
- [track2-local-tui-delivery-decision.md](notes/track2-local-tui-delivery-decision.md) — Local package/TUI delivery, interaction, integration gates and team ownership.
- [track2-codex-subscription-local-adapter.md](notes/track2-codex-subscription-local-adapter.md) — Codex subscription authentication, app-server integration and capture/recovery seams.
- [track2-claude-subscription-local-adapter.md](notes/track2-claude-subscription-local-adapter.md) — Native Claude Code subscription route, SDK distinction and adapter requirements.

## Core architecture and technical references

- [track2-architecture-core-contract.md](notes/track2-architecture-core-contract.md) — Logical module boundaries, identity routing, graph authority and state transitions.
- [track2-continuity-architecture.md](notes/track2-continuity-architecture.md) — Context selection, applicability, handoffs, evidence revisions and tenant separation.
- [falkordb-technical-dossier.md](notes/falkordb-technical-dossier.md) — Database design, Cypher, indexes, concurrency, persistence and version caveats.
- [agentic-rag-memory-evaluation.md](notes/agentic-rag-memory-evaluation.md) — Agent memory, graph retrieval, coordination frameworks and evaluation methods.
- [falkordb-agent-capability-map.md](notes/falkordb-agent-capability-map.md) — How graph capabilities influence actual agent decisions and actions.
- [track2-agent-tools-and-execution-plan.md](notes/track2-agent-tools-and-execution-plan.md) — Proposed typed memory/tool operations, authority boundaries and evidence checks; includes an earlier SDK option.
- [track2-portable-core-and-team-plan.md](notes/track2-portable-core-and-team-plan.md) — Reusable core, adapter contracts, packaging and team split; earlier delivery assumptions are historical.
- [track2-portability-adapters.md](notes/track2-portability-adapters.md) — Host integration surfaces and limits of automatic capture, restoration and lifecycle control.

## Problem scope and alternatives

- [track2-investigation-and-product-scope.md](notes/track2-investigation-and-product-scope.md) — Continuity problem, proposed graph mechanism, bounded scope and validation.
- [track2-harness-and-alternatives.md](notes/track2-harness-and-alternatives.md) — Existing memory/handoff tools and native harness capabilities to compare against.

## Optional spawning and swarm extensions

- [track2-bounded-swarm-product-extension.md](notes/track2-bounded-swarm-product-extension.md) — Child investigations, scoped findings, resource limits and adoption gates.
- [track2-swarm-memory-reliability.md](notes/track2-swarm-memory-reliability.md) — Atomic publication, cursors, acknowledgements, recovery and sharing/load probes.
- [track2-recursive-language-models-and-swarms.md](notes/track2-recursive-language-models-and-swarms.md) — RLM principles, current primary evidence and relation to durable worker sessions.

## Earlier options: reference rather than current delivery

- [track2-packaging-decision-review.md](notes/track2-packaging-decision-review.md) — Earlier attachable-service assessment, competitors and decision gates.
- [track2-delivery-feasibility-check.md](notes/track2-delivery-feasibility-check.md) — Earlier controlled SDK/browser application feasibility.
- [track2-user-experience-and-delivery.md](notes/track2-user-experience-and-delivery.md) — Earlier browser journey; useful controls and evidence views for adaptation to the TUI.
- [track2-presentation-and-team-decision.md](notes/track2-presentation-and-team-decision.md) — Earlier web-first presentation and four-person ownership.
- [track2-railway-deployment-plan.md](notes/track2-railway-deployment-plan.md) — Optional future hosting topology, persistence and deployment probes.

## Linked supporting files

These are included to preserve the notes’ existing relative links:

- [track2-context-social-signals.md](notes/track2-context-social-signals.md)

The Desktop export has this index as README.md and the copied documents in notes/. Originals remain in the chat workspace.
