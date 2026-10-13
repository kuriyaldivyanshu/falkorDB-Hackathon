# Track 2: coding-agent continuity, native harness coverage, and alternatives

Research snapshot: **11 October 2026**. Primary documentation and repositories only. This report proposes a build direction; no harness, plugin, database, hook, or competitor was installed or executed. The hackathon implementation remains scheduled for 15 October. Documentation is evidence of a documented interface, not evidence that it works reliably in our environment.

**Recommendation:** extend an existing coding harness with an evidence-bound intent ledger and selective recovery packets. Keep native worker spawning, tool permissions, session persistence, and messaging. Do not position the project as inventing persistent memory, compaction survival, agent teams, graph task dependencies, or structured handoffs: all have substantial existing coverage.

The parent research currently prefers **one Codex CLI adapter for the first MVP**. This report establishes Claude Code as a documented alternative if that first adapter's hook contracts prove unsuitable; it does not recommend implementing both harnesses in four days. OpenAI/Codex interfaces are covered by the parent research, not independently verified here.

## 1. What Claude Code already provides

| Area | Current documented coverage | Consequence for our project |
|---|---|---|
| Worker context and memory | Subagents normally start in isolated context; forks inherit history. Custom agents can have persistent `user`, `project`, or `local` memory. Non-fork workers do not inherit the parent's auto memory. Ordinary resumable workers retain conversation history; Explore/Plan are one-shot. [Subagent documentation](https://code.claude.com/docs/en/sub-agents). | A fresh worker does need task-specific context, but storing worker memory or resuming the same worker is already native. |
| Instructions across compaction | Root `CLAUDE.md` is re-read after compaction. Current Claude Code can also load `AGENTS.md`, with documented version/configuration differences. [Memory/instruction documentation](https://code.claude.com/docs/en/memory). | A task file plus reliable reinjection is a serious baseline, not an intentionally weak comparison. |
| What compaction restores | Root instructions, auto memory, plan files, bounded skill bodies, fresh git status, and some recently used files are restored. Background workers continue, and the harness reminds the model which remain active. Earlier hook context is summarized; `SessionStart` matching `compact` adds fresh context. [Context-window documentation](https://code.claude.com/docs/en/context-window). | “Compaction forgets everything” is false. Evaluate missed constraints, stale assumptions, or unnecessary replay after a real compact operation. |
| Teams | A lead can coordinate teammates with separate context, shared tasks, and direct messages. Teammates receive project context and their spawn prompt, not the lead's conversation history. Teams remain experimental: in-process teammates are not restored by session resumption; task status can lag; the lead can stop prematurely; leadership is fixed and teams cannot nest. [Agent-team documentation](https://code.claude.com/docs/en/agent-teams). | Fresh-worker recovery and verified completion remain useful targets. Native teams already cover much of the orchestrator/worker story. |
| Independent-session communication | `ListAgents`/`SendMessage` cover eligible local sessions as well as subagents/teammates; cross-machine discovery requires additional account/configuration conditions. Same-machine messaging uses local sockets. Availability has version/provider restrictions. [Cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging). | Cross-session messaging alone is also covered. Our memory layer should supply durable meaning and applicability, not a second mailbox. |
| Session continuation | Local conversations can be continued, selected, or forked; `/compact` replaces history with a summary and accepts focus instructions. [Session management](https://code.claude.com/docs/en/sessions). | Distinguish continuing a saved conversation from reconstructing useful state for a genuinely fresh worker. |

The latest Claude Code release observed was **v2.1.296**, released 9 October. It adds per-subagent `autoCompactWindow`; it also contains hook and MCP fixes. Pin a known version for the demonstration instead of assuming an older installation matches live docs. [Versioned release notes](https://github.com/anthropics/claude-code/releases/tag/v2.1.296).

### Hooks: a feasible extension seam, with boundaries

Current hooks document `SessionStart` sources including `startup`, `resume`, and `compact`, plus context injection. `SubagentStart` can inject context and receives agent ID/type, but its documented input does not include the assigned task prompt. `SubagentStop` exposes the worker's final text and transcript path. `UserPromptSubmit` supplies submitted text. `PreCompact` runs before summarization; `PostCompact` receives `compact_summary` but cannot change the compaction result. Do not rely on `PostCompact` as the reinjection point. [Hooks reference](https://code.claude.com/docs/en/hooks).

A worker-start hook therefore should not pretend to infer the exact assignment from agent type. Inject a small bootstrap and pass an explicit task ID in the delegation prompt; the worker can request its scoped packet through a typed tool. This is a proposed integration design, not a tested lifecycle guarantee.

## 2. Current alternatives and how much they already cover

### Claude Flow is now Ruflo

The canonical project is [ruvnet/ruflo](https://github.com/ruvnet/ruflo). Its current README documents coordination, persistent/adaptive memory, hybrid retrieval with graph hops, knowledge-graph plugins, hooks, and multi-harness integration. It separates plugin and CLI setup. Current `ruflo-core` registers its own namespaced MCP server; the fuller CLI route adds hooks, helpers, agent definitions, and workspace files. Older indexed/forked READMEs saying the plugin never registers MCP are outdated.

Latest observed release: **v3.56.5**, 11 October. Release notes identify the published umbrella names as `ruflo`, `claude-flow`, and `@claude-flow/cli`; the patch addresses a graph-writer file-descriptor operation dropping SQLite locks. [Pinned release](https://github.com/ruvnet/ruflo/releases/tag/v3.56.5). Registry tags were not independently queried or installed.

**Overlap:** orchestration, durable memory, retrieval, graph traversal, and integrated hooks are already advertised. Agent counts, self-learning descriptions, speed claims, and production reliability were not tested here. A tool called `agent_spawn` is not by itself proof of a real coding process being launched; that execution path would need an explicit audit. Ruflo's breadth makes it a comparator, not the lowest-risk dependency for a four-day narrow build.

### claude-mem: automatic capture plus progressive retrieval

[Current repository](https://github.com/thedotmack/claude-mem) documents lifecycle hooks, a local worker, SQLite observations/summaries, hybrid vector/keyword retrieval, configurable context injection, private-content exclusions, and observation references. Its README currently describes an older multi-tool progressive retrieval flow.

The newer **v13.35.0**, released 9 October, documents one progressive `mem_search` interface, explicit `save_memory`, a bridge supplementing native memory lookups, and an opt-in Markdown importer. Its local and hosted MCP search use the same engine according to the release notes. [Pinned release](https://github.com/thedotmack/claude-mem/releases/tag/v13.35.0). Do not use old interface counts to describe the latest release.

**Overlap:** session-spanning observation recall, selective retrieval, source IDs, and explicit notes. The features inspected do not prove reliable recognition of revised human intent, selective invalidation of dependent decisions, or worker completion verification. That is an evidence gap, not a claim those capabilities cannot exist. Compression can retain an incorrect observation as readily as a correct one; test evidence checking separately from recall quality.

### Beads: graph memory and task coordination are already a product

The old `steveyegge/beads` URL redirects to [gastownhall/beads](https://github.com/gastownhall/beads). Latest stable observed: **v1.3.1**, 30 September; **v1.3.2-rc.2**, 10 October, is a prerelease. [Stable release](https://github.com/gastownhall/beads/releases/tag/v1.3.1), [release list](https://github.com/gastownhall/beads/releases).

The [v1.3.1 README](https://github.com/gastownhall/beads/blob/v1.3.1/README.md) documents persistent graph issue tracking backed by Dolt, ready work, atomic task claiming, project memories through `bd remember`, workflow context through `bd prime`, Claude integration, threading, and `supersedes`/related links. Thus “graph task memory that survives compaction” is particularly weak differentiation. Release notes also describe behavior-changing fixes and a proxied-server default; main-branch storage explanations should not be mixed casually with a pinned stable release.

**Overlap:** durable task dependencies, blockers, ownership, supersession, recall, and integration. Our proposed delta needs links from a human acceptance condition to a decision's exact evidence and the affected tasks/tests—not merely a second task graph. A Beads-based workflow with explicit evidence fields is a strong practical competitor and may be adequate.

### MCP Agent Mail: durable coordination, separate from semantic memory

[MCP Agent Mail](https://github.com/Dicklesworthstone/mcp_agent_mail) documents registered identities, searchable threads, acknowledgement, Git-backed message artifacts, SQLite/FTS indexing, HTTP/stdio transports, and advisory file reservations with an optional commit guard. Latest observed tagged release: **v0.3.2**, 16 April. [Pinned release](https://github.com/Dicklesworthstone/mcp_agent_mail/releases/tag/v0.3.2). Main and that older tag are not automatically equivalent.

Reservations expose conflicts; they are not global enforcement of arbitrary file edits. A mailbox provides durable messages, not proof that a receiving worker understood them or finished the task. Its installer also documents shell/profile changes and replacing `bd` with [Beads Rust](https://github.com/Dicklesworthstone/beads_rust), so use deliberate manual integration if it becomes necessary.

An important documentation conflict: Agent Mail calls the original Go Beads inactive, while canonical Beads has current September/October releases. Beads Rust is a separate SQLite/JSONL implementation with different workflow/storage choices. Neither the replacement nor the maintenance claim should be adopted unquestioningly. Agent Mail is optional; native Claude messaging is enough for the first integration.

### Handover: a near-exact structured-continuity comparator

[Handover](https://handover.sh/docs) provides versioned shared context and artifact continuation. Its open [Handoff Continuity Record v1.0](https://handover.sh/protocol) includes objective/acceptance criteria, verified versus unverified state, active/superseded decisions with rationale, evidence with optional SHA-256, constraints, next verified action, ownership, and review. Producers preserve state; receivers verify evidence. The format can live in Git/local files without its service and is not an official MCP/A2A standard.

Its [MCP documentation](https://handover.sh/docs/mcp-server) describes attributed identities, scoped access, reading current revisions, and `expectedRevisionId` optimistic concurrency for continuation. No authenticated product flow was run here. A public pilot benchmark exists, but its results must not be reused as our performance evidence; root research assesses its methodology separately.

**Overlap:** almost the entire proposed handoff document. “We store goals, decisions, evidence, and the next step” is already covered. Use this schema as a serious baseline or interoperable output instead of claiming a novel handoff format. The testable proposed distinction is live applicability propagation and bounded task-specific recovery across changing evidence.

## 3. A narrow differentiation worth testing

**Proposed product job:** when a coding worker is compacted, replaced, or reopened, reconstruct the current human-authorized task contract and identify which previous decisions remain usable in the present branch/revision. Give that worker the minimum sufficient evidence for its next step, with reasons for inclusion and explicit unresolved questions.

FalkorDB would store a small typed graph, not indiscriminate transcripts:

- A **goal revision** with acceptance conditions and a reference to the human instruction establishing it.
- A **task** with scope, owner, current status, and links to the criteria it serves.
- A **decision** with concise rationale, rejected alternative, applicability assumptions, and supporting evidence.
- An **evidence artifact** bound to repository/worktree, path, content hash or commit, command/environment, and observation time.
- A **verification receipt** for a bounded action/test, plus the goal/code revision it actually verifies.

Worker outputs are claims until validated. A human goal change cannot be authorized merely because another worker asserts that the user changed it. Store private worker scratch separately; admit shared facts deliberately. The graph's absent path is not proof of irrelevance, safety, or completeness. Scope filtering must be enforced before retrieval, not after sensitive facts enter the prompt.

**Concrete discriminating fixture:** worker A decides to use a standard-library parser because a runtime assumption is true in the initial plan. Before a fresh worker takes over, the accepted compatibility target changes and CI evidence identifies an older runtime. The graph connects that criterion to parser choice, affected task, tests, and the previous receipt. Recovery flags the decision as needing reassessment, includes the relevant source/CI evidence, and asks worker B to inspect an existing compatible loader rather than repeat the stale plan. It also leaves an unrelated documentation task untouched.

This should be demonstrated on an authored small repository with explicit conditions, not represented as a measured result. A versioned JSON contract can solve the same fixture. SQL can model the same relationships. The graph must earn its complexity through better bounded retrieval, explicit propagation, or lower operator effort across a broader fixture family—not mathematical exclusivity.

Deterministic code should enforce revision freshness, permitted scopes, claims/leases, and receipt validity. Agent judgment belongs in identifying an ambiguous assumption, choosing what evidence to inspect, explaining a conditional decision, and proposing the next patch/test. More agents or automatic graph extraction do not inherently improve those choices.

## 4. Feasible Claude alternative, on or after 15 October

1. **If Claude becomes the first adapter, choose one pinned installation.** Record its version, provider, enabled native memory, agent configuration, and permissions. Begin with a main session plus two custom workers; use the native runtime for spawning/resumption.
2. **Expose a narrow local MCP service.** Proposed operations: retrieve scoped task context; append a sourced decision/evidence claim; record verification; review revision changes. Do not expose unrestricted database writes or a second general orchestrator. Exact tool names and schemas remain to be designed.
3. **Bootstrap explicitly.** Pass task ID and repository/worktree identity in delegation. A worker retrieves the bounded graph packet and acknowledges the goal revision. Hook output can supply a short recovery pointer; the typed tool supplies the substantive packet.
4. **Capture events without making summaries authoritative.** Use native hooks for session/compaction/worker boundaries. Prefer explicit typed claims and actual artifact/test receipts to parsing every transcript. Store raw excerpts only when needed as evidence. Reconcile missed events; a crash may bypass graceful stop hooks.
5. **Rehydrate and revalidate.** Materialize current goal, applicable decisions, pending verification, and evidence references at recovery. Refuse to label an old test run as proof for changed code. A failed evidence check yields an investigation step, not silent reuse.

This seam is documented, but the combined lifecycle is **untested**. Test real `/compact`, fresh session, resumed session, and fresh replacement worker separately. Do not assume hooks fire identically in native teams, ordinary subagents, and headless runs. A cached packet can remain readable for inspection when the database is unavailable, explicitly labelled as a previous snapshot. It cannot establish current applicability, ownership or completion; those operations require the authoritative graph. Avoid replacing the user's harness with a large plugin stack.

## 5. The comparison that could justify building it

Use the same model, repository state, goal changes, tools, and token budget. For a Claude adapter, compare native Claude recovery with: a carefully maintained versioned task/handoff file; the same structured record with deterministic freshness checks; and graph recovery. For the initial Codex adapter, use its equivalent native recovery baseline. Give the structured-file and graph routes the same captured facts. Add a pinned claude-mem or Beads route if time permits a fair configuration. Avoid requiring competitors to fail because they were not told to record the goal.

Evaluate completed patches and acceptance tests; retention of current constraints; rejection of superseded decisions; repeated investigation/duplicate action count; recognition of stale receipts; worker-scope leakage; recovery tokens/latency; and correct treatment of uncertain evidence. Test single-worker recovery before claiming multi-worker benefits. For concurrency, include two workers reporting conflicting outcomes and an interrupted action whose completion is unknown.

The result we need is not “the graph remembered more.” It is that a fresh worker reached the accepted outcome with less irrelevant context or fewer stale actions than serious simpler alternatives. No such advantage has been established yet. Native coverage and Handover/Beads make this a demanding but concrete validation target.
