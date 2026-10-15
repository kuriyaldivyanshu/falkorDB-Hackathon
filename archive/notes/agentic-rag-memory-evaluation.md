# Agentic GraphRAG, memory, coordination, and evaluation on FalkorDB

Research snapshot: **9 October 2026, India time**. This is research and a proposed design, not an implemented or tested system. Primary documentation, release metadata, and source files were inspected. Source code inspection establishes that an interface exists; it does not establish compatibility or performance on our eventual deployment.

## Decision that matters most

Use **one product story and one explicit domain model** across the three tracks. Connected-data reasoning, persistent memory, and a company knowledge system can be three demonstrations of the same system. Combining several graph frameworks is not itself an advantage. The likely strongest route is a small application whose critical decisions require FalkorDB traversal, whose memory changes later decisions, and whose outputs expose verifiable evidence.

Treat the architecture as four separate responsibilities:

| Responsibility | What we need | Possible owner |
|---|---|---|
| Database | Graph relationships, indexes, queries, persistence | FalkorDB |
| Knowledge ingestion and retrieval | Parse sources, preserve provenance, find evidence | GraphRAG-SDK or a small custom pipeline |
| Temporal memory | Preserve events, revisions, past decisions, validity | Graphiti or application-owned graph model |
| Agent execution | Select tools, retry, hand off, validate, act | Small typed orchestrator or LangGraph |

An ingestion SDK is not an autonomous agent. A conversation history argument is not durable memory. Several agent personas are not coordination unless a handoff changes execution and survives restart. These are design distinctions, not claims about the hackathon’s unpublished judging preferences.

## 1. GraphRAG-SDK: useful accelerator, moving documentation

### Verified package and API state

PyPI and GitHub releases identify **graphrag-sdk 1.4.0**, released 10 August 2026. The package requires Python 3.10+. The repository’s nested package metadata declares the Python FalkorDB client as `falkordb>=1.7,<2`; this is a **client package version**, not a minimum server-engine version. Record both separately in our lockfile and deployment notes. [PyPI package](https://pypi.org/project/graphrag-sdk/), [release history](https://github.com/FalkorDB/GraphRAG-SDK/releases), [package metadata](https://raw.githubusercontent.com/FalkorDB/GraphRAG-SDK/main/graphrag_sdk/pyproject.toml)

The pinned 1.4.0 package exports `GraphRAG`, `ConnectionConfig`, `Ontology`, `Entity`, `Relation`, and `Attribute`. Older names such as `GraphSchema`, `EntityType`, and `RelationType` remain deprecation aliases. The README still contains old-name examples; some architecture pages say “v2,” while the published package is 1.x. We should copy examples only after checking the exact release. [Pinned exports and aliases](https://raw.githubusercontent.com/FalkorDB/GraphRAG-SDK/v1.4.0/graphrag_sdk/src/graphrag_sdk/__init__.py)

The public interface is principally asynchronous: construct `GraphRAG` with connection/model/embedder configuration; ingest documents; call `finalize()`; retrieve context or generate a completion. `completion(..., return_context=True)` returns the retrieval result with the answer. `history=` supplies messages for that invocation. The raw `query()` executes supplied Cypher without read-only enforcement. A product must control which queries the model can submit. [API reference](https://docs.falkordb.com/graphrag/api-reference)

**Important release gap:** live structured-ingestion documentation uses `TableMapping`, but the pinned 1.4.0 facade does not contain that import or structured path. The current `main` facade does. Likewise, published 1.4.0 `finalize()` performs exact-name deduplication, embedding backfill, and index creation; current `main` adds resolver/judge passes and configuration. “Current docs say it exists” is therefore insufficient evidence that a PyPI installation provides it. [Pinned facade](https://raw.githubusercontent.com/FalkorDB/GraphRAG-SDK/v1.4.0/graphrag_sdk/src/graphrag_sdk/api/main.py), [current development facade](https://raw.githubusercontent.com/FalkorDB/GraphRAG-SDK/main/graphrag_sdk/src/graphrag_sdk/api/main.py)

### Extraction and evidence

The documented prose path combines local entity recognition, by default GLiNER, with LLM verification and relationship extraction. It stores entity types, source chunk identifiers, and spans. Relationships are physically `RELATES` edges, with the semantic type in `rel_type`; queries should not assume the SDK physically writes an edge named `WORKS_AT`. Schema constraints narrow extraction but cannot make inferred facts correct. [Extraction documentation](https://docs.falkordb.com/graphrag/extraction)

The graph retains `Document`, `Chunk`, and entity nodes, document/chunk links, chunk order, and entity mention links. This gives a path from retrieved entities to original passages. A mention is evidence that an entity appeared in a chunk; it does not establish that every associated relationship is true. Keep relation-specific evidence and original text visible. [Architecture](https://raw.githubusercontent.com/FalkorDB/GraphRAG-SDK/main/docs/architecture.md)

For the hackathon, extract only a small ontology relevant to the chosen workflow. Prefer deterministic ingestion for known IDs, dates, amounts, ownership assignments, statuses, and dependencies. Use the LLM for prose interpretation where structure is absent. Preserve raw records so corrections remain possible. Do not let a generated description overwrite an authoritative field.

### Retrieval behaviour

`MultiPathRetrieval` combines semantic fact search, entity discovery, graph expansion, and multiple passage paths. Documented expansion is one and two hops. Optional text-to-Cypher supports structural questions such as counts and connections. Generated query results enter the context without passage reranking; a fallback can still answer when Cypher fails. Therefore log whether a structural answer actually used a successful structural query. [Retrieval documentation](https://docs.falkordb.com/graphrag/retrieval)

This default is a useful baseline, but a three- or five-hop impact-analysis workflow needs explicit domain queries or custom retrieval. Do not assume a configuration called “multi-hop” explores all relevant paths. Depth bounds, fan-out caps, time filters, and visited-node limits should be part of a tool contract. The product should expose a path witness, source IDs, and truncation status.

The SDK offers replaceable loading, chunking, extraction, resolution, retrieval, and reranking strategies. Contextual chunking adds a model call for each chunk; structural chunking can retain heading breadcrumbs. Installing every optional backend increases setup and dependency risk without proving better retrieval. [Strategy reference](https://raw.githubusercontent.com/FalkorDB/GraphRAG-SDK/main/docs/strategies.md)

### Reliability limits we must implement around

The official documentation explicitly states that:

- `retrieve()` and `completion()` have no declarative metadata filter; scoping requires separate graphs or custom Cypher.
- Abstention is a prompt instruction, not an enforced confidence gate.
- The SDK does not detect unsupported claims for the application.
- Some default retrieval sections have no exposed per-item score; reranking whole sections is not equivalent to scoring individual passages.

Similarity is not probability of correctness. A low-scoring evidence set should trigger more investigation or abstention; a high score still requires entailment checks. [Reliability and grounding](https://docs.falkordb.com/graphrag/reliability-and-grounding)

The default prompt treats context as data and neutralizes a forged closing context tag. Custom templates disable those specific protections. This is a useful narrow safeguard, not a complete defence against malicious documents. Keep action authority outside retrieved prose. [Hallucination-reduction guide](https://docs.falkordb.com/graphrag/reducing-llm-hallucinations)

### Incremental updates

Published incremental APIs include `update`, `delete_document`, and `apply_changes`. Stable document IDs matter; updates hash content, replace old chunks, and remove stale facts and uniquely owned entities while preserving shared evidence. The documented process uses commit markers and retryable cleanup. `apply_changes` collects per-file errors and does not finalize automatically. Inspect every result. Keep overlapping document modifications serialized: the default `update_concurrency=1` protects orphan cleanup. [Incremental updates](https://docs.falkordb.com/graphrag/incremental-updates)

Call `finalize()` once per batch, and measure it separately. Global deduplication is a graph-sized operation, so an “incremental update” can still incur substantial finalization work. Deleting an outdated document and preserving a history of what was once true are different requirements. For Track 2, document replacement alone does not meet a temporal-memory design.

The development structured-ingestion design maps CSV rows deterministically using declared keys and typed columns; record chunks provide provenance alongside prose. This is promising for Company Brain, particularly mixed exports and documents, but we should treat it as a development feature until release compatibility is confirmed. A custom deterministic importer is an escape route. [Structured ingestion](https://docs.falkordb.com/graphrag/structured-ingestion)

## 2. Graphiti: temporal memory on FalkorDB

Graphiti is a separate open-source temporal graph framework, not a plugin inside GraphRAG-SDK. It supports FalkorDB through `FalkorDriver`, installed with the `falkordb` extra. Episode inputs can be text, conversations, or compact JSON, with a reference timestamp; bulk episode ingestion is available. [FalkorDB configuration](https://help.getzep.com/v3/graphiti/configuration/falkordb-configuration), [adding episodes](https://help.getzep.com/graphiti/core-concepts/adding-episodes)

Graphiti’s model stores episode provenance and fact validity. Source definitions distinguish `valid_at`, `invalid_at`, `created_at`, `expired_at`, and `reference_time`. These permit questions about when something was true and when the system learned or invalidated it. We must choose explicit semantics for a late-arriving event rather than sorting only by ingestion time. [Fact edge definitions](https://raw.githubusercontent.com/getzep/graphiti/main/graphiti_core/edges.py)

“Automatic contradiction handling” still depends on inference: the source includes an LLM prompt that identifies duplicate and contradicted facts, plus timestamp extraction and edge-resolution code. It is not a logically complete consistency solver. A newer assertion might be a rumour, a different scope, an exception, or a mistaken update. Preserve conflicting claims and source authority; confirm replacement only under defined rules. [Deduplication prompt](https://raw.githubusercontent.com/getzep/graphiti/main/graphiti_core/prompts/dedupe_edges.py), [edge maintenance](https://raw.githubusercontent.com/getzep/graphiti/main/graphiti_core/utils/maintenance/edge_operations.py)

Search supports hybrid retrieval and configurable recipes, including reciprocal rank fusion, maximal marginal relevance, graph distance, episode mentions, and cross-encoder reranking. More expensive reranking should be measured rather than enabled by default. A support workflow can retrieve recent facts near an affected service, then rerank by relevance and evidence quality. [Graphiti searching](https://help.getzep.com/graphiti/working-with-data/searching)

The latest inspected release is **0.30.2**, whose notes include fixes for request-scoped concurrent namespace isolation and FalkorDB search. Earlier release notes show group-routing and full-text fixes. These are practical reasons to avoid copying old tutorial pins. The current driver also orders range indexes before full-text indexes because its source comments identify a FalkorDB 6.x interaction. Validate the exact tag, server, and client together. [Graphiti releases](https://github.com/getzep/graphiti/releases), [FalkorDB driver](https://raw.githubusercontent.com/getzep/graphiti/main/graphiti_core/driver/falkordb_driver.py)

`group_id` supports namespacing, but documentation requires the application to authorize it from authenticated state. A model-supplied tenant ID is not authorization. Make tenant selection an application concern, and test simultaneous users with identical names and conflicting facts. Namespace tests must include search, deletion, episode lookup, and restart. [Graph namespacing](https://help.getzep.com/graphiti/core-concepts/graph-namespacing)

Graphiti’s MCP exposes memory ingestion, fact/node search, direct fact triples, sagas, communities, and maintenance. It is a higher-level memory interface than raw database MCP. An accepted ingestion request may still require waiting until searchable state is ready; our UI needs an explicit ingestion status. [Graphiti MCP](https://github.com/getzep/graphiti/blob/main/mcp_server/README.md)

Graphiti and hosted Zep are not interchangeable. The project describes current Zep as using a proprietary Context Graph Engine. A hosted memory API that stores essential state there would weaken the submission’s claim that FalkorDB is central. Use self-hosted Graphiti with its FalkorDB backend if choosing this route. [Graphiti package overview](https://pypi.org/project/graphiti-core/)

## 3. Cognee, LangChain, LlamaIndex, and MCP choices

### Cognee

Cognee’s community FalkorDB hybrid adapter can use FalkorDB for graph and vector storage. Its README requires a registration import and separate graph/vector configuration; it still configures a relational database such as SQLite. The stated Python support is 3.11–3.13 and the FalkorDB Python dependency is `<2`. It does not eliminate every storage component. [Community adapter](https://github.com/topoteretes/cognee-community/blob/main/packages/hybrid/falkordb/README.md)

FalkorDB publishes an integration recipe because wiring the adapter is non-obvious; it builds a custom image and checks registration. This is an ecosystem option, not evidence that an arbitrary Cognee deployment is already using FalkorDB. Use it only if Cognee’s ingestion and memory primitives match our core workflow. [FalkorDB/Cognee recipe](https://github.com/FalkorDB/falkordb-cognee)

### LangChain and LangGraph

LangChain’s integration presents `FalkorDBGraph` and `FalkorDBQAChain`, with the chain imported from `langchain_classic` in current docs. It is a natural-language-to-Cypher QA route. The reference warns that generated queries can mutate or expose data and requires acknowledging dangerous requests. That flag is an acknowledgement, not a permission boundary. [Integration docs](https://docs.langchain.com/oss/python/integrations/graphs/falkordb), [QA chain reference](https://reference.langchain.com/python/langchain-community/chains/graph_qa/falkordb/FalkorDBQAChain)

LangGraph can own execution state while FalkorDB owns relationship-aware long-term knowledge. Checkpointers preserve a run’s state; stores preserve cross-run information. In-memory checkpointers do not survive process restart. A durable checkpointer may introduce SQLite or PostgreSQL, which should be explained as runtime bookkeeping rather than replacing the central graph. [Persistence](https://docs.langchain.com/oss/python/langgraph/persistence)

Retryable execution is not exactly-once action delivery. LangGraph’s source documentation instructs placing side effects inside tasks and making them idempotent because unfinished work can run again. We need our own action IDs and external idempotency keys. [Functional API and idempotency](https://github.com/langchain-ai/docs/blob/main/src/oss/langgraph/functional-api.mdx)

### LlamaIndex

Current documentation lists `FalkorDBPropertyGraphStore` with native embeddings, server storage, and no async support in its support table. The integration source advertises structured and vector queries. This is more relevant than old `KnowledgeGraphIndex` tutorials. It can provide parsing/retrieval abstractions, but should not be stacked over GraphRAG-SDK unless a specific missing capability justifies it. [Property graph guide](https://developers.llamaindex.ai/python/framework/module_guides/indexing/lpg_index_guide/), [store source](https://raw.githubusercontent.com/run-llama/llama_index/main/llama-index-integrations/graph_stores/llama-index-graph-stores-falkordb/llama_index/graph_stores/falkordb/falkordb_property_graph.py)

### Two distinct FalkorDB MCP servers

The TypeScript **FalkorDB-MCPServer** supports graph queries, parameter objects, read-only queries, structure discovery, data management, and stdio/HTTP transports. HTTP authentication is enforced when the API key is configured. Its graph-schema topology is sampled, so omission of a connection from the returned schema is not proof the connection is absent. [TypeScript server](https://github.com/FalkorDB/FalkorDB-MCPServer)

The Rust **falkordb-mcp** is a separate stdio server. It exposes read-only queries through `GRAPH.RO_QUERY`, schema inspection, and query-plan explanation. Writes and profiling are opt-in; results are capped and marked truncated. It is comparatively new, and its README describes source compilation plus installation when published. Do not assume it is already distributed wherever the TypeScript server is available. [Rust server](https://github.com/FalkorDB/falkordb-mcp)

For our product, a domain MCP tool such as `trace_impact(service_id, as_of)` is usually more reliable than asking an agent to generate arbitrary Cypher for each step. Raw graph tools can remain an optional inspection surface. MCP is a transport and tool contract, not automatic tenancy, safe action selection, or agent memory. The protocol’s own guidance emphasizes server-side authorization and limiting scopes. [MCP security guidance](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices)

## 4. Proposed architecture across all three tracks

This section is our design recommendation. The example domain is a **change-and-incident investigation system**; another domain can reuse the same structure.

### Knowledge and provenance

Use explicit entity IDs for `Service`, `Team`, `Document`, `Change`, `Incident`, `Decision`, and `Procedure`. Represent assertions with source, scope, time, confidence, extraction method, and review state. Known dependency and owner records should create deterministic edges. Prose creates candidate assertions with supporting passages.

Keep three graph concerns distinct within the model:

1. **Domain relationships:** what depends on what; which team owns a service; which change touched a component.
2. **Evidence and claims:** who asserted a relationship, which document supports it, and whether it is current, disputed, or inferred.
3. **Execution and memory:** which agent investigated; the task handed off; its observations, tool receipts, and verified outcome.

These may use separate labels or separate tenant graphs, but the application must make joins intentional. Avoid letting two independent SDKs overwrite the same labels, embeddings, or identity scheme. If Graphiti and GraphRAG-SDK coexist, define an adapter boundary and source IDs; do not casually share their internal schemas.

### Agent workflow

The coordinator receives a concrete goal, resolves domain entities, and chooses a bounded tool. An investigator follows dependencies and retrieves evidence. A verifier checks whether the suggested cause and remediation are supported. An executor prepares an action in a local simulator. The application validates preconditions and commits the authorized action. Every step records input, evidence, chosen tool, output, and status in FalkorDB.

Two or three agents are enough if their roles are real: for example, one investigates while another verifies, and a later session resumes from the graph. More agents add calls, latency, and opportunities for disagreement. Handoffs should pass task IDs and evidence IDs, not just a lengthy generated summary. Each receiving agent can reconstruct the relevant state.

### The memory demonstration

After solving incident A, store an episode linked to the affected components, attempted actions, verified procedure, and outcome. In a later session, incident B retrieves that memory and avoids a failed action. Then revise a dependency or owner assignment. The system should distinguish “what we knew then,” “what is true now,” and “which previous procedure remains applicable.” A timeline and a before/after decision make memory observable.

Procedural memory should include conditions and counterexamples. “Restarting fixed an incident once” is not a universally valid procedure. Promote a procedure only after verification; expire or downgrade it when its preconditions change.

### Action reliability

Store an action ledger with unique action ID, request fingerprint, proposed parameters, graph version or freshness marker, status, and external receipt. Use a single writer or an atomic claim operation for overlapping tasks. A lease can permit recovery after a crashed agent; an idempotency key prevents duplicate execution. Re-check preconditions immediately before execution. Keep an explicit “outcome unknown” state if a network call succeeds remotely but the receipt is lost.

For the hackathon demo, a reversible local simulator can demonstrate meaningful actions without production credentials: assign an incident, quarantine a mocked component, schedule a mitigation, or update a task board. The action must change observable state and its result must feed memory.

### Uncertainty that belongs in the product

**No graph path does not mean no real-world dependency.** The source may be incomplete, the importer may have failed, permissions may hide evidence, extraction may miss a link, or retrieval may truncate. A safe response says “no path found in the indexed sources at this snapshot,” and names the uncovered sources. Negative conclusions require defined coverage, current authoritative inventories, and checked ingestion status.

Likewise, a graph path demonstrates a stored relationship chain, not causality. The verifier should distinguish “affected through this dependency” from “proved root cause.” Source contradictions should appear as separate claims until resolved under domain rules.

## 5. Evaluation that can support a credible winning demo

FalkorDB reports 71.48 overall versus 55.39 for vector RAG on GraphRAG-Bench. The reported overall is its own average of Novel and Medical category averages; the company did not rerun competitors, and judge failures excluded some samples. The run is SDK 1.3.0 with a specific model/configuration. Indexing is document-scoped. This is evidence about that benchmark, not a guarantee about our cross-document company workflow. [Accuracy benchmark and limitations](https://docs.falkordb.com/graphrag/graphrag-accuracy-benchmark)

GraphRAG-Bench evaluates construction, retrieval, and generation over fact retrieval, complex reasoning, summarization, and creative tasks. We can borrow its separation of stages without claiming leaderboard performance. [Benchmark project](https://graphrag-bench.github.io/)

LongMemEval’s five abilities—extraction, multi-session reasoning, temporal reasoning, updates, and abstention—are useful categories for Track 2. Its historical results do not establish that every 2026 long-context model fails. Zep’s memory paper reports improvements on memory benchmarks, but neither it nor hosted Zep performance proves our self-hosted FalkorDB setup will match. [LongMemEval](https://arxiv.org/abs/2410.10813), [Zep paper](https://arxiv.org/abs/2501.13956)

### Freeze a task set before tuning

Prepare approximately 40 held-out tasks and a smaller development set. Suggested held-out mix: 12 dependency/impact tasks, 8 ownership or decision-history tasks, 8 temporal-memory tasks, 6 action/handoff tasks, and 6 missing-evidence or conflicting-source tasks. Record expected entity IDs, necessary evidence, valid time, acceptable action, and abstention criteria. Use public or synthetic data with documented ground truth; do not put answer keys into indexed sources accidentally.

Evaluate these baselines with the same model and answer format:

| System | Purpose |
|---|---|
| Vector retrieval plus reranking | Standard RAG baseline |
| Full-text plus vector retrieval | Stronger hybrid baseline |
| Modern full-context model | Test whether the corpus simply fits in context |
| Graph queries plus prose evidence | Test graph retrieval itself |
| Agentic graph system | Test adaptive investigation beyond fixed retrieval |

When the corpus fits the chosen model’s context, provide all allowed documents to the full-context baseline and test multiple deterministic document orders. When it does not fit, label the baseline budget-limited and define the selection strategy. Do not deliberately truncate the answer-bearing source. A graph system can earn its value through freshness, actionability, traceability, or cost even when a strong full-context model answers correctly.

### Ablations and metrics

Remove graph traversal; remove temporal filtering; remove saved memory; replace live updates with a stale snapshot; remove verifier; replace extracted prose links with a manually checked graph. These isolate whether gains come from the graph, memory, agent loop, or better extraction. Compare equal context budgets and also operational cost, since equal tokens alone may hide expensive graph construction.

Measure source/evidence recall, supporting-path recall, entity-resolution errors, factual answer correctness, citation entailment, unsupported-claim rate, appropriate abstention, action completion, duplicate actions, handoff recovery, and cross-tenant leakage. Report p50/p95 latency, model calls, tokens, ingestion time, update time, graph size, and finalization time. Inspect failures by stage.

Use deterministic checking where IDs, counts, times, statuses, and expected actions exist. Use a rubric and blind human review for qualitative answers, with an LLM judge as supplemental evidence. Include every timeout and failed case in denominators. Publish all per-task results, configuration, and traces; avoid showing only successful examples.

### Demo acceptance cases

The live demo should cover a multi-hop question with a visible evidence chain; a source update that changes the answer; a new session that benefits from a verified prior resolution; a real handoff; recovery after an interrupted action; and an unanswerable task that abstains. Show a graph-disabled comparison on a held-out case. Proposed acceptance targets are zero duplicate simulated actions and zero tenant leakage in the selected adversarial set; they are engineering targets, not claims of production guarantees.

## 6. Cost and four-day build choice

Cost assumptions here are illustrative, not current vendor quotes. Let ingestion cost be extraction input/output tokens plus embedding tokens, parsing compute, and any identity-resolution calls. Query cost includes routing, keyword extraction, optional Cypher generation, reranking, final answer, and verification. Retrying malformed extraction can multiply cost. Record actual token usage from the first sample before scaling.

Example sizing assumption: 500 chunks at 700 tokens each yields 350,000 source tokens before prompt repetition. With 600 prompt tokens and 350 output tokens per extraction, 500 calls imply roughly 650,000 input and 175,000 output tokens. An eight-call investigation with 3,000 average input and 350 output tokens is approximately 24,000 input and 2,800 output tokens. Multiply these by the selected provider’s verified prices; repeated evaluations can exceed the live demo’s cost.

Assuming 4,000 embedded items at 1,024 float32 dimensions, raw vectors consume about 16.4 MB. This excludes index overhead, graph structures, strings, allocator overhead, model memory, snapshots, and duplicate versions. Treat storage calculations as lower bounds. Caching unchanged extraction and embeddings reduces repeated work, but verify that changed source meaning invalidates the cache appropriately.

| Route | Four-day advantage | Principal risk | Recommendation |
|---|---|---|---|
| Thin custom domain graph and tools | Explicit evidence, deterministic import, small dependencies | We own retrieval/memory logic | Preferred for a narrow operational domain |
| GraphRAG-SDK plus custom orchestrator | Fast prose ingestion and hybrid baseline | Release/doc drift and generic extraction errors | Good if documents dominate |
| Graphiti plus typed domain tools | Temporal episodes and retrieval already modelled | Inference cost, compatibility, integration seams | Good if evolving memory is the central feature |
| Cognee with hybrid adapter | Broad ingestion/memory platform | Registration and version complexity | Use only for a specific advantage |
| Several frameworks stacked | Many features available | Identity, schema, duplicate ingestion, debugging | Avoid as the default |

This is not a choice we should finalize from documentation alone. During the permitted build window, make a small compatibility trial: ingest two related sources, query a multi-hop fact, update/delete one source, preserve shared evidence, restart, and run concurrent tenant checks. Stop expanding the stack if that trial cannot be made dependable quickly.

## 7. Open questions and preparation

The immediate preparation deliverables are a domain ontology, source/license inventory, source-coverage map, task/evidence specification, paper action state machine, evaluation rubric, demo storyboard, and dependency/version matrix. These can be researched and sketched before project coding starts, subject to the organiser’s rules.

Before implementation, resolve:

- Which exact FalkorDB engine version will be used, and which client/SDK versions work with it?
- Is the organiser expecting newer 6.x APIs or accepting a stable prior server version?
- Which SDK features are released versus only on `main`?
- Can the selected extractor preserve direction, negation, IDs, and event dates on our actual sources?
- What source is authoritative when documents disagree?
- How much history must remain queryable after source deletion?
- Will a visible multi-agent handoff improve the product, or merely add latency?
- What is the smallest useful action with a verifiable receipt?
- Which full-context and hybrid baselines make the graph’s value honest?
- What data sources are complete enough to support negative conclusions, and which are explicitly partial?

No runtime compatibility, provider bill, model quality, or end-to-end accuracy was measured in this research phase. The final architecture should be chosen through those small, targeted trials rather than through headline benchmark claims.
