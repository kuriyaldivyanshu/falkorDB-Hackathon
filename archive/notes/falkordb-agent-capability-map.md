# FalkorDB: capabilities that enable new agent products

**Sources accessed: 2026-10-11.** This supplements [the technical dossier](falkordb-technical-dossier.md). **Verified** means documented or inspected source behavior; **design inference** means an application we could build; **hypothesis** means an unvalidated product opportunity. No database, SDK, or prototype was run for this report. Track assignments below are concept fits, subject to the organizer's final requirements.

## What the agent can actually use

| Capability | Verified foundation | Design inference and practical boundary |
| --- | --- | --- |
| Bounded relationship traversal | Cypher patterns and `algo.BFS` expose neighborhoods with relationship/depth restrictions. | Start from a retrieved entity, follow meaningful domain edges, then inspect the source behind each claim. An edge establishes a modeled relationship; it does not establish causality. Bound depth and output size. [BFS](https://docs.falkordb.com/algorithms/bfs) |
| Paths and components | `algo.SPpaths` accepts relationship types, direction, a weight, optional cost bound and maximum length. WCC groups weakly connected nodes. | Find a sequence of prerequisites or expose disconnected ownership islands. A shortest path is optimal only for its modeled weights; WCC ignores direction and cannot prove workflow feasibility. [Paths](https://docs.falkordb.com/algorithms/sppath), [WCC](https://docs.falkordb.com/algorithms/wcc) |
| Hybrid evidence retrieval | The current GraphRAG SDK combines fact search, entity discovery, relationship expansion, lexical/vector chunk retrieval and document mapping. Generated Cypher is optional and disabled by default. | Semantic search finds a seed; traversal finds cross-document obligations; document mapping supplies inspectable evidence. This retrieval pipeline supplies context, while the harness chooses and executes actions. [SDK retrieval](https://docs.falkordb.com/graphrag/retrieval) |
| Explicit rules | Engine constraints cover mandatory properties and uniqueness. | Store `REQUIRES`, `EXCLUDES`, `GRANTS`, and `SUPERSEDES` as application relations. Enforce their meaning with deterministic checks. They are not native business-rule enforcement or a general constraint solver. [Constraints](https://docs.falkordb.com/commands/graph.constraint-create) |
| Persistent execution memory | A property graph can represent runs, attempts, observations, artifacts and their relationships. The inspected engine provides atomic graph-version commits. | Store a typed action ledger separately from extracted factual memory. Include action ID, input digest, tool result, status and artifact reference. Recovery, retries and external-effect reconciliation remain harness responsibilities. [Tagged engine source](https://github.com/FalkorDB/FalkorDB/blob/v6.0.2/graph/src/graph/mvcc_graph.rs) |
| Temporal provenance | Graphiti's entity edges include episode references plus fact-validity and invalidation timestamps. Its search filters expose date predicates. | Retrieve the fact valid at the relevant time and show the supporting episode. Preserve conflicting claims and distinguish source assertion, extraction and verified tool observation. Extraction is fallible; timestamps alone do not resolve truth. [Tagged edges](https://github.com/getzep/graphiti/blob/v0.30.2/graphiti_core/edges.py), [Search filters](https://github.com/getzep/graphiti/blob/v0.30.2/graphiti_core/search/search_filters.py) |
| Separate graphs | Each FalkorDB graph is a key. Graphiti's Falkor driver selects graphs by database name; request scopes clone the driver for a specified group. | Separate organizations or simulated worlds and test cross-group retrieval explicitly. Graph selection must accompany authorization; an arbitrary user-supplied graph name is not an access policy. Cluster sharding distributes graphs, not one giant graph. [Cluster](https://docs.falkordb.com/operations/cluster), [Tagged driver](https://github.com/getzep/graphiti/blob/v0.30.2/graphiti_core/driver/falkordb_driver.py), [Request scope](https://github.com/getzep/graphiti/blob/v0.30.2/graphiti_core/graphiti.py) |

## Current APIs and version cautions

**Verified:** GraphRAG SDK's latest published release is **v1.4.0**, whereas Graphiti's is **v0.30.2**. Treat them as distinct libraries and pin one intended stack; examples from legacy SDK releases are not interchangeable with v1. [SDK release](https://github.com/FalkorDB/GraphRAG-SDK/releases/tag/v1.4.0), [Graphiti release](https://github.com/getzep/graphiti/releases/tag/v0.30.2)

**Verified:** SDK `update()`, `delete_document()` and `apply_changes()` support changing corpora. Call `finalize()` after the batch to deduplicate/backfill embeddings and ensure indexes. Keep modified-document concurrency at its default **1**: the documentation warns that concurrent updates can break shared-entity orphan cleanup. Batch results can contain per-file failures; inspect them. These are corpus-maintenance APIs, not temporal workflow memory. [Incremental updates](https://docs.falkordb.com/graphrag/incremental-updates)

**Verified source; runtime implication untested:** Graphiti v0.30.2 creates range indexes before full-text indexes. Current main comments explain this order as a FalkorDB 6.x compatibility workaround. Preserve that order, verify index-backed lookup on the chosen engine, and await initialization before ingestion/search. Latest Graphiti already uses request-scoped drivers for group isolation; avoid porting older snippets that mutate a shared driver. [Tagged driver](https://github.com/getzep/graphiti/blob/v0.30.2/graphiti_core/driver/falkordb_driver.py), [Current driver](https://github.com/getzep/graphiti/blob/964bb11d1e7020e3cc67fab244268b0736b6c219/graphiti_core/driver/falkordb_driver.py)

**Recommendation:** Expose named, parameterized graph tools to the agent. Use `GRAPH.RO_QUERY` for evidence retrieval and narrow mutation tools for ledgers. Allowlisted labels, bounded queries and explicit verification make the demo intelligible. [Read-only command](https://docs.falkordb.com/commands/graph.ro-query)

## Three fresh hypotheses

These are creative proposals, not findings of market demand or claims of originality. All proposed prototype data is authored or synthetic; external systems are simulated.

### 1. ScopePilot — an agent that earns only the authority its task needs

**Fit: Track 1.** A contractor asks for a support-retention analysis. The agent reads tool descriptions and policies, traverses `Task → Tool → Permission → Resource → Delegation`, and discovers that a redacted aggregate export can complete the task without raw-ticket access. It selects that route, runs the mock tools, checks completeness, and delivers the analysis plus a permission receipt. If an aggregate source is insufficient, it asks one concrete scope question and replans.

**Four-day boundary:** six tools, three policy types, two users, two routes, one report format. Store verified permissions directly; use RAG for source descriptions and explanations. The memorable demo is a graph exposing a redundant privilege request, followed by a completed report through the narrower route.

**Strongest objection:** [OPA already supports policies for agent tool calls](https://www.openpolicyagent.org/docs/agent-tool-calling). The contribution must be task-specific plan discovery and evidence for its authority budget. Compare against OPA/rule checks plus a deterministic tool planner; the enforcement itself must stay deterministic.

### 2. Misconception Map — memory that selects the next useful learning experiment

**Fit: Track 2.** An adult learner repeatedly misses Python aliasing questions despite remembering syntax. The agent connects concepts, prerequisite relations, attempted exercises, observed errors and previously successful interventions. On a later session, it retrieves that history, chooses a small distinguishing exercise, runs the learner's answer in a sandbox, and adapts the next exercise from the observed result. Completion is a passed transfer task with a visible reason for the chosen intervention.

**Four-day boundary:** one topic, eight authored exercises, four misconception hypotheses, three intervention styles. Record episode evidence and provisional interpretations rather than permanent learner labels. Demonstrate the same learner after a fresh-session reset, then show adaptation when the earlier hypothesis becomes wrong.

**Strongest objection:** AI tutoring already exists, including [Khanmigo](https://www.khanmigo.ai/). The experiment must show that structured longitudinal memory improves exercise selection beyond a full transcript, a simple error counter and a fixed lesson order. Graph complexity is unjustified if these baselines perform equally.

### 3. Coverage Forge — turn company expertise into tested backup capability

**Fit: Track 3.** Two key engineers request simultaneous leave. Company documents say who owns systems, but ownership is not demonstrated backup capability. Traverse `Service → Critical task → Prerequisite → Demonstration → Person`, combine availability with recent task evidence, and identify the smallest preparation plan. The agent creates a tailored transfer exercise, asks the prospective backup to perform it in a mock workspace, checks the resulting artifact, updates capability evidence, and produces an evidence-backed leave-coverage decision.

**Four-day boundary:** an authored organization of six people, three services and three executable mock tasks. Demo an apparent replacement failing one hidden prerequisite, then becoming a verified backup after a targeted exercise. The completed output is the coverage roster and task evidence.

**Strongest objection:** [CODEOWNERS](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners) already represents ownership; availability matching and set cover can produce a roster. The agent must contribute adaptive evidence gathering and verification. Keep staffing decisions explicit and explainable.

## Evaluation that can reject these ideas

**Recommendation:** Compare five conditions on identical tasks: deterministic rules/planner; agent with flat documents; agent with vector-only retrieval; agent with graph but no prior episodes; graph agent with memory. Match tool permissions, model, context/token budget and available facts.

Graph-removal tests should preserve every fact and source while removing relationship traversal. Add aliases, plausible irrelevant documents and questions requiring two or three edges. If the graph advantage disappears when the baseline receives equivalent structured joins, report that honestly.

For memory, reset the agent between episodes; hold out later tasks; include corrected facts and misleading earlier successes. Measure completed-task correctness, violated rules, unsupported claims, unnecessary privileges/questions, recovery behavior, tool calls and cost. Human-authored expected outcomes must precede implementation. A colorful graph and a successful scripted example cannot establish the graph's or agent's contribution.

**Unresolved:** dataset usefulness, extraction accuracy, pinned engine/SDK compatibility, operating cost and agent benefit over deterministic planning. Resolve these through bounded experiments after the permitted event start; no speed, novelty or winning guarantee follows from the documented capabilities.
