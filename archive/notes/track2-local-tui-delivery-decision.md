# Threadline: local TUI delivery decision

**Revised proposal, 2026-10-13; no implementation, TUI mockup or authentication test.** This recommends replacing the web-first delivery plan, subject to the native-client integration gates below. Parent documents are updated separately.

## Decision

**Build a local npm package with a TUI, one local coordinator, persistent FalkorDB and native coding-client adapters.** Codex CLI/Claude Code execute the actual Builder and Verifier work; Threadline supplies connected memory, coordination and recovery. Do not add an independent SDK/API runtime or hosted code executor as another critical architecture.

Web helps judge access and evidence comparison but is not essential to Track 2. The product's first job happens in the developer's terminal and filesystem. Local delivery avoids cloud execution infrastructure and aligns with the user's preferred workflow. The tradeoff: native capture, context delivery and fresh-session control become the critical path rather than an optional portability feature.

The official overview prefers live deployment but expressly accepts complete local setup and a working demo video. The rules permit any frontend; neither web nor TUI is prescribed. A locally running working agent/team can meet the brief. [Overview](https://www.wemakedevs.org/hackathons/falkordb), [rules](https://www.wemakedevs.org/hackathons/falkordb/rules)

## Architecture and authentication boundary

The **TUI** sends explicit user intentions to a local **coordinator**. The coordinator controls tasks, worker lifecycle, typed graph operations and guarded integration. One pinned **FalkorDB Docker service** persists graph data on a configured volume; actual restart recovery must be tested. Local artifact storage preserves the patches/logs that graph digests reference.

Two **thin native-client adapters** translate supported host events and normalize session/task identities. They capture the declared message/tool surface, supply graph-selected task context and launch genuinely fresh successor sessions. MCP can expose scoped memory tools to clients, but MCP registration alone does not provide lifecycle capture or guarantee the host calls restore. [Adapter constraints](track2-portability-adapters.md)

The native client retains its own login and permissions. Threadline must not extract subscription tokens, treat OAuth as a universal API credential, or promise every plan permits every automated invocation. Verify each selected client's official supported local automation/authentication route and installed version. Current source checks establish documented Codex and native Claude Code routes; actual subscription access remains an integration condition to test. [Codex findings](track2-codex-subscription-local-adapter.md), [Claude findings](track2-claude-subscription-local-adapter.md). No login secrets enter FalkorDB.

Use one authenticated installed client first. Aim for both Codex and Claude adapters, but require working capture/restore before advertising either. If the second fails, demonstrate fresh-session recovery within the supported client and disclose that cross-provider handoff is unverified. Do not build a replacement harness to hide an adapter failure.

## TUI interaction

The user runs setup/readiness checks, selects a permitted public/toy repository, states a goal and exact acceptance criteria, then starts Builder and Verifier. The native agents inspect files, investigate, edit and run actual checks using their host's execution facilities.

The TUI provides current goal/criteria, task/worker status, ordered captured activity/history and an inspectable evidence view. Show requirement revision, loaded-context acknowledgement, source decision and tested artifact revision. Actions are start, pause at supported boundaries, change a requirement, answer an ambiguity, continue a selected task fresh and review the patch/receipts. No full editor or graph-design console is needed.

The decisive flow is: a recorded attempt fails; the requirement changes; affected work is marked for refresh; the original session stops; a fresh successor retrieves current constraints and the applicable rejection, reconciles actual files and finishes with current verification. The user supplies no manual recap. Preserve old history and show where capture began or missed events.

## Coverage remains concrete

| Track 2 focus | Required local proof |
|---|---|
| Episodic, semantic, procedural memory | Source-linked attempts/outcomes; accepted current facts/constraints/decisions; one verification routine with conditions and receipts, reused on a held-out compatible task and reassessed when inapplicable. |
| Persistent conversation history | Persist ordered `Session`/`Message` content and tool references through adapters. Inspect original sources after restart; summaries alone are insufficient. |
| Shared state and handoffs | Both workers use the same current graph authority. A genuine fresh successor advances interrupted work; affected workers acknowledge refresh; stale results cannot complete revised tasks. |
| Concurrent reads/writes | Run declared 4/8/16-client mixed memory-service probes separately from live agents. Report correctness, conflicts/retries, throughput and latency. Same-graph writes remain serialized; client concurrency is not parallel write execution. |
| Tenant isolation | Trusted service principals map to separate graphs. Two synthetic identities with colliding IDs cannot read/write each other's memory or evidence sources. A TUI profile selector is not authentication. |

Automatic runtime capture must not depend solely on an agent voluntarily writing a good summary. Test actual interrupted events and reveal gaps. Missing recorded context remains unknown; no adapter can recover unrecorded reasoning. Use authored/public/synthetic demonstration conversations, not prior private native chat histories.

Native filesystem actions are outside a graph transaction. Use separate worker worktrees and revision-checked integration; a service refusal cannot undo an old client's file edit. Confirm termination before reassigning uncertain work and inspect observable effects before retrying. Provider quotas still apply. Core has two working roles; bounded spawning remains optional, capped at four total workers and depth 1 if added.

## Four-person use and delivery gates

| Member | Responsibility |
|---|---|
| DevOps 1 | Pinned Docker/database setup, persistence, local service packaging, diagnostics and clean-install/restart checks |
| DevOps 2 | Native process/worktree lifecycle, adapter installation, interruption/race/load probes and reproducible terminal demonstration |
| Engineer 3 | Graph schema, applicability/retrieval, guarded state, procedure evidence and adapter normalization |
| Engineer 4 | TUI interaction, history/evidence inspection, authored fixtures and equal-fact file/JSON baselines |

Day 1 must prove one real native client records a tool outcome and a fresh session uses current graph context. Day 2 completes Builder/Verifier requirement-change recovery; second-client claims depend on its own probe. Day 3 verifies procedure reuse, persistence, isolation and concurrent access. Day 4 fixes failures, checks a clean install and records the working demo.

Railway can host an optional read-only explanation/results page after the local core works. Two DevOps teammates are valuable for reproducibility and recovery; cloud deployment is not their mandatory deliverable. Ship public source, setup, graph model/queries and video. Main coding/interface design remains event-time work; this document is written preparation.
