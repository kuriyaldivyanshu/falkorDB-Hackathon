# FalkorDB technical dossier for Graph Hacks

Research date: **9 October 2026, India time**. Scope: the database engine and its operational implications for an agent spanning connected-data actions, persistent memory, and a company knowledge graph. This is preparation, not a submission implementation. No database, downloaded project code, or sample queries were executed during this research.

Evidence labels used throughout:

- **Verified documentation**: a current official page explicitly describes the feature; this does not establish that every release behaves identically.
- **Verified source**: code at the fixed `v6.0.2` tag contains the implementation described; code inspection is not a successful runtime test.
- **Recommendation / inference**: an engineering choice or consequence drawn from the evidence.
- **Unknown / needs spike**: unresolved behavior that should not become a demo dependency before testing.

## 1. What the database does, and what we must supply

**Verified documentation.** FalkorDB is a Redis module exposing a property graph: entities, directed relationships, labels, and properties. Its query interface is OpenCypher with extensions. The engine combines graph traversal with range, full-text, and vector retrieval. The core database does not itself turn a problem statement into a trustworthy agent; the application must provide ingestion, ontology, tool contracts, state management, and evaluation. [Official database overview](https://docs.falkordb.com/)

**Recommendation.** Treat FalkorDB as the application's evidence and state substrate. A useful graph contains facts that allow an agent to discover a previously unstated consequence: dependencies, authority, ownership, provenance, eligibility, or an actionable chain of responsibility. Embedding document chunks and attaching decorative edges will underuse it.

The graph should answer questions that require joining sources, such as: “Which customers depend on the component described in this incident, which exception permits the proposed mitigation, and who has resolved this combination before?” The important output is an evidence-backed action or decision. A graph picture alone is insufficient engineering evidence.

Separate four products when reading material: **core FalkorDB**, **FalkorDB Cloud**, **Enterprise deployment**, and **GraphRAG SDK**. An SDK example, a managed-service feature, and a core command are different layers. A framework integration may simplify development, but a feature named in its README is not automatically available in the selected database version.

## 2. Version audit: the most immediate implementation risk

**Verified release evidence.** The release listing currently marks **v6.0.2, 8 October**, as latest. **v6.0.0, 29 September**, introduced a Rust engine; `latest` selects 6.x, while Alpine tags remain on the C engine. Mixed 4.x/6.x replication is incompatible. The 4.22 release includes A*/CCH additions that the 6.0 notes omit. [Release listing](https://github.com/FalkorDB/FalkorDB/releases), [6.0 transition notes](https://github.com/FalkorDB/FalkorDB/releases/tag/v6.0.0)

**Recommendation.** Pin an explicit image digest/version and client dependency on Day 1. Record engine version in every benchmark result. Choose a release because the essential queries pass, rather than because its tag sounds newest. Use a single-node deployment for the first demonstrable workflow. Do not mix tutorial snippets from 4.x and 6.x without a capability check.

The documentation has real drift:

| Topic | Conflicting evidence | Safe working position |
|---|---|---|
| Implementation language | Architecture page still describes C and Lex/Lemon; fixed release source is Rust | Use old architecture prose for the matrix idea; use tagged source for current mechanisms |
| Bolt | Home/configuration describe Bolt; documentation index describes RESP-only operation | Use official RESP clients; validate Bolt separately if essential |
| Regex | Compatibility page says unsupported; `v6.0.2` parser recognizes `=~` and invokes a regex implementation | Source-present, untested; do not promise Neo4j regex compatibility |
| UDFs | Compatibility body lists unsupported UDFs, while dedicated UDF docs explain them | Use dedicated/version-specific evidence and test chosen functions |
| Multi-query rollback | FalkorDB concurrency page recommends `MULTI/EXEC`; Redis explicitly lacks runtime rollback | Make critical graph changes one Cypher statement |

Sources for the discrepancies: [architecture](https://docs.falkordb.com/design/), [compatibility](https://docs.falkordb.com/cypher/cypher-support), [protocol index](https://docs.falkordb.com/llms.txt), [tagged parser](https://github.com/FalkorDB/FalkorDB/blob/v6.0.2/graph/src/parser/cypher.rs), [tagged regex implementation](https://github.com/FalkorDB/FalkorDB/blob/v6.0.2/graph/src/runtime/functions/internal.rs), [UDF reference](https://docs.falkordb.com/udfs/), [Redis transactions](https://redis.io/docs/latest/develop/using-commands/transactions/).

## 3. Storage and query execution

**Verified documentation.** Graph topology is represented through sparse adjacency matrices: a global connection matrix, matrices for relationship types, and diagonal matrices for labels. Traversal patterns become algebraic operations; changing multiplication order can reduce intermediate work. GraphBLAS performs the sparse computations. Data resides in RAM with disk persistence available. [Architecture and design](https://docs.falkordb.com/design/)

**Verified source.** The 6.0.2 MVCC coordinator holds a committed graph version. Readers acquire a reference to that version; one writer obtains a copy-on-write version, changes it, and publishes it on commit. A failed writer discards its work. Older versions remain referenced until their readers finish. [Tagged MVCC source](https://github.com/FalkorDB/FalkorDB/blob/v6.0.2/graph/src/graph/mvcc_graph.rs)

**Inference.** Sparse storage does not mean unlimited capacity. Long readers, writes, embeddings, indexes, and persistence can all contribute to peak memory. Capacity planning must measure the combined application workload. Neither “millions of nodes” nor a vendor latency claim establishes performance on our laptop or deployment.

**Recommendation.** Start retrieval at a selective indexed identity, constrain relationship types and hop counts, then project only the evidence needed. A small relevant subgraph is usually a better model context than a large collection of every reachable node. Measure database time separately from embedding, model, network, and presentation time.

## 4. Domain model and property types

**Verified documentation.** Nodes can have multiple labels; relationships have one type and direction. Stored scalars include strings, booleans, signed 64-bit integers, doubles, points, and temporals. Lists can be stored subject to serializable-element restrictions. Maps, graph entities, and null cannot be stored as property values. Null uses three-valued logic: equality with null is not a truth test. Use `IS NULL`/`IS NOT NULL`. [Type system](https://docs.falkordb.com/datatypes)

**Recommendation.** Create stable application identifiers; do not make database-generated entity IDs the external identity of documents, users, claims, or tasks. Model relationship-rich state as nodes and edges rather than opaque JSON. A conceptual vocabulary:

| Node | Useful properties | Relationships that make it useful |
|---|---|---|
| Document / Chunk | source URL, checksum, revision, time, text | `PART_OF`, `MENTIONS`, `SUPPORTS` |
| Entity | canonical ID, type, name, aliases | domain connections such as `DEPENDS_ON`, `OWNS`, `AFFECTS` |
| Claim | status, asserted time, validity interval, confidence | `SUBJECT`, `OBJECT`, `SUPPORTED_BY`, `CONTRADICTS`, `SUPERSEDES` |
| Episode | session ID, outcome, time | `USED_EVIDENCE`, `TRIED_ACTION`, `RESOLVED` |
| Procedure | version, applicability, success count | `APPLIES_TO`, `LEARNED_FROM`, `REQUIRES` |
| Task / Agent | state, version, owner, lease time | `ASSIGNED_TO`, `BLOCKED_BY`, `HANDOFF`, `PRODUCED` |

This is a planning schema, not a required SDK schema or implemented project. A claim should distinguish observed source content from an agent's interpretation. “Related to” is rarely specific enough to support a consequential action. Keep source revision and evidence location so that a cited statement can be inspected.

**Recommendation.** Represent contradictory and outdated knowledge explicitly. Do not overwrite “approved” with “revoked” and lose history. Connect the new claim to the previous claim, filter by validity for operational decisions, and preserve the provenance of both. Retrieval must be able to say “the record is conflicting” or “there is no adequate evidence.”

## 5. Cypher structure and reusable patterns

**Verified documentation.** FalkorDB implements a growing subset of OpenCypher v9. Standard reading, projecting, filtering, and writing clauses are documented, but Neo4j-specific syntax/procedures must not be assumed. [Compatibility reference](https://docs.falkordb.com/cypher/cypher-support)

`MATCH` binds patterns, `WHERE` filters, `WITH` carries selected variables into another stage, and `RETURN` projects results. Variables omitted from `WITH` leave scope. `OPTIONAL MATCH` preserves missing matches using null. These details matter when an owner or evidence link is absent. [MATCH](https://docs.falkordb.com/cypher/match), [WITH](https://docs.falkordb.com/cypher/with), [OPTIONAL MATCH](https://docs.falkordb.com/cypher/optional-match)

`MERGE` matches or creates its entire pattern. A partially present full path can therefore create duplicate endpoints. Bind or merge the endpoints independently, then merge the relationship. `ON CREATE SET` and `ON MATCH SET` allow separate initialization and update behavior. [MERGE reference](https://docs.falkordb.com/cypher/merge)

`CALL` invokes procedures and supports subqueries; subqueries explicitly import variables using `WITH`. Treat scoping as part of the query contract. [CALL reference](https://docs.falkordb.com/cypher/call)

### Conceptual documentation examples — not tested

These short examples adapt documented syntax to an imagined organization graph. They are learning notes, not production-ready submission code. Their schema, index readiness, values, permissions, and exact client invocation remain to be verified.

```cypher
// Select a bounded dependency chain and preserve its explanation.
MATCH p=(s:Service {id:$service_id})-[:DEPENDS_ON*1..4]->(d:Service)
RETURN d.id, [n IN nodes(p) | n.id] AS chain
LIMIT 20
```

The hop interval constrains traversal length; it does not prove that the first 20 results are the most important. Choose ranking separately. Named paths can be projected through path functions. [Path patterns](https://docs.falkordb.com/cypher/match), [Function reference](https://docs.falkordb.com/cypher/functions)

```cypher
// Upsert identities independently before joining them.
MERGE (d:Document {id:$document_id})
ON CREATE SET d.created_at=$now
SET d.revision=$revision
MERGE (e:Entity {id:$entity_id})
MERGE (d)-[:MENTIONS]->(e)
```

```cypher
// Make a conditional task claim a single statement.
MATCH (t:Task {id:$task_id})
WHERE t.state='READY' AND t.version=$expected_version
SET t.state='RUNNING', t.owner=$agent_id, t.version=t.version+1
RETURN t.id, t.version
```

**Inference.** Combined with serialized writers, the last pattern can support a task claim if a successful claim returns one row and stale claims return none. It is not an exactly-once external-action protocol; that needs an action ID, retries, and effect reconciliation. Use this as a Day 1 race-test hypothesis.

Pass data through client parameters rather than interpolating it into query text. Parameters are documented using `$name`, with language-specific client APIs. Labels, relationship types, and arbitrary query fragments require separate validation. [Parameter syntax](https://docs.falkordb.com/cypher/cypher-support), [Official clients](https://docs.falkordb.com/getting-started/clients)

**Verified documentation.** The compact wire format encodes typed values and schema identifiers; clients resolve label, relationship-type, and property names through metadata procedures and manage schema mappings. Prefer the official client rather than interpreting every Redis reply as JSON. Explicitly test graph entities, paths, temporal values, vectors, and large integer decoding in the chosen language. [Client protocol specification](https://docs.falkordb.com/design/client-spec)

## 6. Retrieval: exact, lexical, semantic, then relational

**Verified documentation.** Range indexes cover supported node-label/property and relationship-type/property lookups. They serve equality/range predicates; strings, numbers, points, and scalar arrays are documented. Complex nested collections and vector values are outside range-index support. Inspect the plan to confirm an index scan. [Range indexes](https://docs.falkordb.com/cypher/indexing/range-index)

```cypher
CREATE INDEX FOR (e:Entity) ON (e.id)
```

**Verified documentation.** Full-text indexes support lexical search with stemming/stopword and field options. Query procedures return entities and scores; results can feed graph traversal. This is useful for precise names, incident identifiers, and terms that an embedding may blur. [Full-text indexes](https://docs.falkordb.com/cypher/indexing/fulltext-index)

```cypher
CALL db.idx.fulltext.queryNodes('Chunk',$text)
YIELD node, score
RETURN node.id, score LIMIT 10
```

**Verified documentation.** Vector indexes support node or relationship properties, `vecf32`, dimensions 1–4096, and cosine/euclidean metrics. Required dimensions must match embeddings. Documented HNSW options trade recall against build/search cost. [Vector indexes](https://docs.falkordb.com/cypher/indexing/vector-index)

```cypher
CREATE VECTOR INDEX FOR (c:Chunk) ON (c.embedding)
OPTIONS {dimension:384, similarityFunction:'cosine'}

CALL db.idx.vector.queryNodes('Chunk','embedding',10,vecf32($embedding))
YIELD node, score
RETURN node.id, score
```

**Verified source / unresolved performance implication.** The tagged configuration defines `INDEX_WORKER_THREADS` as zero by default. Its comments say tiered vector insertions remain in a flat buffer when workers are disabled, while KNN remains correct. Determine the appropriate setting and actual index behavior before making scaling claims. [6.0.2 configuration source](https://github.com/FalkorDB/FalkorDB/blob/v6.0.2/src/config.rs)

**Verified fix history.** A merged change addresses wrong-dimension vectors removing an entity from other indexes on the label. The corrected behavior skips the mismatched vector field. Validate embedding dimensions at ingestion anyway. [Maintainer PR #3087](https://github.com/FalkorDB/FalkorDB/pull/3087)

**Recommendation.** Retrieve a modest seed set with exact or hybrid search, expand through approved domain relationships, rerank evidence, and return source references. Do not sum lexical and vector scores without calibrating their meanings. Test distance ordering rather than assuming “larger is better.” An unscoped global KNN search followed by tenant filtering can lose all useful results; isolating tenant graphs or using a verified scoped retrieval method avoids that candidate-starvation design.

## 7. Graph algorithms: choose by the question

| Capability | Verified evidence | Useful role / recommendation |
|---|---|---|
| BFS | Traverses from a node with depth and relationship filter, returns nodes/edges | Explore a bounded impact neighborhood; do not confuse a flat visitation list with one path |
| PageRank | Label/type-filtered importance scores | Prioritize structurally influential entities; popularity is not factual truth |
| WCC | Direction-insensitive connected components | Detect disconnected knowledge islands or connected fraud groups |
| Betweenness | Bridge importance through shortest paths | Find organizational bottlenecks; reserve broad recomputation for offline work |
| `algo.SPpaths` | Source/target, weight/cost/length constraints | Explain an efficient route or constrained dependency path |
| Other algorithms | Tagged source registers SSpaths, label propagation, MSF, harmonic centrality, maxFlow | Use only if one materially improves the selected problem |

Primary references: [BFS](https://docs.falkordb.com/algorithms/bfs), [PageRank](https://docs.falkordb.com/algorithms/pagerank), [WCC](https://docs.falkordb.com/algorithms/wcc), [Betweenness](https://docs.falkordb.com/algorithms/betweenness-centrality), [SPpaths](https://docs.falkordb.com/algorithms/sppath), [Tagged algorithm implementations](https://github.com/FalkorDB/FalkorDB/blob/v6.0.2/graph/src/runtime/functions/algo_procedures.rs).

**Verified source.** `maxFlow` imposes specific constraints: one relationship type, a capacity property, disjoint source/sink sets, and no multi-edges for that type. A domain that naturally contains parallel claims or transactions should not silently collapse those into a flow graph. [Tagged maxFlow implementation](https://github.com/FalkorDB/FalkorDB/blob/v6.0.2/graph/src/runtime/functions/algo_procedures.rs)

**Unknown / needs spike.** A*, CCH, newer k-shortest variants, Leiden, and Louvain are version-sensitive. Do not design the core demo around them before verifying the pinned version's procedure and result shape. Also verify whether a chosen algorithm operates on the intended labels, directions, weights, and active-time slice.

## 8. Concurrency, memory coordination, and action semantics

**Verified documentation and source.** Individual modifying queries are atomic; reads have committed snapshots; one writer per graph is serialized. Thread-pool parallelism is separate from same-graph write parallelism. [Concurrency guide](https://docs.falkordb.com/design/concurrency), [Tagged MVCC implementation](https://github.com/FalkorDB/FalkorDB/blob/v6.0.2/graph/src/graph/mvcc_graph.rs)

**Critical caveat.** Single-query atomicity does not imply a series of independently issued queries is one transaction. Redis `MULTI/EXEC` serializes commands but does not roll back successful commands when another fails during execution. The FalkorDB guide's all-or-fail wording should not be relied upon. [Redis transaction error semantics](https://redis.io/docs/latest/develop/using-commands/transactions/)

**Recommendation.** A handoff should record the task state, agent ownership, expected state version, evidence references, and next-step contract. Commit related changes in one statement. If an external action succeeds but the memory write fails, retry must reconcile by action ID. If the action times out, distinguish “unknown outcome” from “failed.” The database cannot supply exactly-once behavior for an arbitrary outside API.

Persistent memory needs more than transcript retention. Separate episodic observations, semantic claims, and procedural lessons. Include outcome feedback, rejection reasons, source permissions, and expiry policy. A second session should demonstrably use a prior success or avoid a prior failure. An append-only audit event is useful, but operational state may require a current projection.

**Recommendation.** Use a bounded retry policy for transient database/model/network errors; never repeat an external mutation merely because a tool response was lost. Test competing agents claiming one task, handoff interruption, stale state versions, duplicate observations, and read visibility after a write.

## 9. Documented limits and surprising behavior

**Verified documentation, runtime status untested.** The known-limitations page lists these behaviors: unreferenced relationships may be treated as existence matches, changing counts in multigraphs; trailing `LIMIT` does not restrict eager writes; `<>` filters do not benefit from its index optimization; aggregation is disallowed inside pattern comprehensions. These deserve regression probes on the selected engine. [Known limitations](https://docs.falkordb.com/cypher/known-limitations)

**Recommendation.** Reference relationships explicitly when counting transactions or evidence. Limit rows before a write rather than using `RETURN ... LIMIT` as an action cap. Treat a returned row limit as an output cap, not a general workload cap. Avoid unconstrained `[*]` exploration and “return entire graph” tools.

**Verified documentation.** Constraints can be mandatory or unique on nodes/relationships. Unique constraints need a supporting index and apply only when all constrained fields exist; arrays are excluded. Construction is asynchronous and can finish as `FAILED`. Wait for `OPERATIONAL` status before relying on protection. [Constraint creation](https://docs.falkordb.com/commands/graph.constraint-create)

**Recommendation.** A uniqueness constraint without mandatory identity fields is incomplete identity protection. Use both where appropriate. Keep ingestion idempotent, define canonicalization explicitly, and test duplicate documents and aliases. A confidently wrong entity merge damages many later answers because every traversal through it can inherit the error.

## 10. Import, updates, and provenance

**Verified documentation.** `LOAD CSV` accepts local files under `IMPORT_FOLDER` and remote HTTPS sources. Headers produce maps; parsed fields are strings and require explicit casts. [LOAD CSV](https://docs.falkordb.com/cypher/load-csv)

**Verified tool availability.** The bulk-loader repository provides CSV-based ingestion; migration tooling can export/import nodes, relationships, indexes, and constraints. These are options, not an obligation to use a large import pipeline. [Bulk loader](https://github.com/FalkorDB/falkordb-bulk-loader), [Migration reference](https://docs.falkordb.com/operations/migration/neo4j-to-falkordb)

**Recommendation.** Prefer deterministic parsing for structured input and model-assisted extraction only where structure is missing. Preserve original text, source URL, license, extraction version, and checksum. Re-ingestion should update the right document revision rather than create an unrelated second entity. Remove or supersede derived assertions when their source is changed or deleted; entity nodes shared by other sources should survive.

Estimate ingestion cost before selecting a corpus: document count, token volume, chunk count, model calls per chunk, retries, entity resolution work, and embedding storage. A curated corpus with known questions and deliberate contradictions can demonstrate more reliability than a huge poorly extracted corpus. Keep an explicit rejected-record log.

## 11. Deployment, durability, security, and tenancy

**Verified documentation.** Docker offers a database-plus-browser image and a server-only image. Standard tutorial ports are 6379 for the database and 3000 for the browser. Authentication can be set through Redis configuration. The database belongs behind the application's backend. [Docker deployment](https://docs.falkordb.com/operations/docker)

**Verified documentation / alternative to assess.** FalkorDBLite provides Python and TypeScript bindings that manage a local FalkorDB runtime. It may reduce setup for development or judging, but its packaged engine/platform support must be checked independently. Do not assume a Lite package, Docker `latest`, and a Cloud instance run identical engine releases. [FalkorDBLite](https://docs.falkordb.com/operations/falkordblite/)

**Recommendation.** Keep credentials server-side, bind local services deliberately, and authenticate every public application action. Do not expose a database socket or unrestricted browser console as the public demo. Confirm cloud TLS and retention behavior in the actual selected plan; local Docker features and hosted-plan entitlements are different.

**Verified documentation.** RDB snapshots and AOF provide persistence options. RDB can lose changes after its most recent snapshot; AOF safety depends on fsync policy. A mounted Docker volume retains files across container replacement but does not alone determine crash durability. ACL users have a separate persistence path. [Durability](https://docs.falkordb.com/operations/durability/), [Volume setup](https://docs.falkordb.com/operations/durability/persistence), [ACL persistence](https://docs.falkordb.com/operations/durability/acl-persistence)

**Recommendation.** Test a restart and restore after writing meaningful memory. Preserve a deterministic seed corpus and local setup path for judging. Use a binary-safe client for graph backup/restore; do not assume a shell-redirected `DUMP` output is automatically a replayable Redis protocol stream. Measure restart/index warm-up time.

**Verified documentation.** ACLs restrict commands and graph-name patterns, including read/write permissions. Graph metadata listing is distinct from reading graph contents. [ACL command reference](https://docs.falkordb.com/commands/acl)

**Recommendation.** A graph per tenant maps naturally to graph-key authorization. Node labels or a `tenant_id` property are not an authorization boundary by themselves. If the backend has access to multiple graphs, derive graph names from authenticated tenant state, never from an LLM's text. Apply access rules to citations and remembered evidence as well as final answers. Demonstrate a negative cross-tenant test.

**Verified documentation.** Redis Cluster distributes graph keys across shards. One graph remains on one shard; clustering does not split a huge single graph. Replicas synchronize asynchronously. [Cluster architecture](https://docs.falkordb.com/operations/cluster), [Replication](https://docs.falkordb.com/operations/replication)

**Inference.** Clustering helps many-graph throughput, not arbitrary horizontal scaling of one company graph. Immediate read-after-write correctness should use the primary unless a tested consistency mechanism says otherwise.

**Verified documentation / planning consequence.** Redis expiry applies to keys. Since a graph is a key, graph-key expiry is not individual memory-node expiry. Model `expires_at`/validity in retrieval and remove expired nodes through application work. [Redis EXPIRE](https://redis.io/docs/latest/commands/expire/), [Graph key architecture](https://docs.falkordb.com/operations/cluster)

**Verified licensing identity.** Core FalkorDB is SSPLv1; individual clients/SDKs may have different licenses. Check their actual license files. Treat public-service licensing as a concrete question for the sponsor rather than assuming that every application must adopt the core's license. [Core licensing reference](https://docs.falkordb.com/references/license), [Core LICENSE](https://github.com/FalkorDB/FalkorDB/blob/main/LICENSE)

## 12. Resource controls and observability

**Verified documentation.** Relevant controls include `THREAD_COUNT`, `OMP_THREAD_COUNT`, `TIMEOUT_DEFAULT`, `TIMEOUT_MAX`, `RESULTSET_SIZE`, `QUERY_MEM_CAPACITY`, and `MAX_QUEUED_QUERIES`. Several query/resource limits are unlimited by default. Runtime configuration changes are not persisted across restart. [Configuration reference](https://docs.falkordb.com/getting-started/configuration)

**Recommendation.** Set modest development limits after measuring the intended workload; record startup configuration, and test timeout rollback. Output limits and memory caps are complementary. A server memory cap should not be confused with a per-query cap or a complete protection against an external model request.

**Verified documentation.** `GRAPH.EXPLAIN` describes a plan without executing it. `GRAPH.PROFILE` executes the query, including writes, and reports operator metrics. `GRAPH.MEMORY` reports per-graph memory estimates and component breakdowns. Slowlog/telemetry provide further diagnostics. [EXPLAIN](https://docs.falkordb.com/commands/graph.explain), [PROFILE](https://docs.falkordb.com/commands/graph.profile), [MEMORY](https://docs.falkordb.com/commands/graph.memory), [SLOWLOG](https://docs.falkordb.com/commands/graph.slowlog)

**Recommendation.** Collect tool name, arguments with sensitive values removed, database/model latency, row count, evidence IDs, action result, and final answer. A readable execution trace should show what the agent discovered and why it acted, without claiming to expose private model reasoning. Compare cold and warm queries, p50/p95 latency, and mixed read/write memory use.

## 13. Bounded agent tools and failure handling

**Verified documentation.** `GRAPH.RO_QUERY` rejects graph writes. This gives a stronger retrieval boundary than asking the language model to promise read-only behavior. [Read-only command](https://docs.falkordb.com/commands/graph.ro-query)

**Recommendation.** Offer tools such as `find_entity`, `get_dependencies`, `find_policy_evidence`, `recall_relevant_episode`, and `claim_task`, with typed arguments and bounded output. An unrestricted text-to-Cypher tool should be an optional inspected escape hatch. Restrict read procedures too: read-only does not mean inexpensive, authorized, or trustworthy.

Treat ingested documents as evidence, not instructions. An agent must not execute commands or change its permissions because a retrieved chunk asks it to. Validate source locations before ingestion, parameterize data values, validate domain action preconditions, and require explicit user authorization for genuinely consequential outside effects. These are useful product behaviors: they allow the system to explain that an action is blocked or needs review.

When uncertain, retrieve more evidence within a budget, show conflicting records, request the missing input, or abstain. Empty results do not establish that something does not exist in the world. A claim supported by one stale document should not be presented with the same certainty as a current structured record corroborated by independent evidence.

## 14. Day 1 technical spike checklist

This is a plan for **after the hackathon's coding window opens**, not a request to build beforehand.

1. **Version manifest:** pin engine image/digest, client, SDK if used, model, embedder/dimension, architecture, and startup configuration. Prove client authentication and response decoding.
2. **Minimal schema:** create a tiny deterministic graph with duplicate-looking identities, parallel edges, missing fields, one contradiction, stale claims, and a small dependency chain.
3. **Capability probes:** verify exact/range index, lexical search, vector insertion/query, score ordering, missing/wrong dimensions, bound paths, subquery imports, and only the algorithms the project needs.
4. **Integrity:** wait for index/constraint readiness; test duplicate IDs, missing mandatory IDs, partial-write failure, and write-timeout rollback. Retest documented eager-LIMIT and multiedge-count behavior.
5. **Coordination:** two concurrent agents try one conditional claim; exactly one obtains it. Interrupt a handoff, retry an action ID, and inspect committed-state read visibility.
6. **Tenant isolation:** confirm unauthorized graph access fails. Verify the backend cannot choose a different tenant from prompt text. Check remembered evidence/citation access.
7. **Persistence:** write an episode, restart the chosen deployment, reload it, and continue the task. Test restore and index availability from a known backup.
8. **Capacity:** grow one representative workload stepwise, not arbitrarily. Measure query/model time, ingestion time, peak process memory, graph/index memory, and p95 under modest concurrency.
9. **Agent evaluation:** compare the same tasks with vector-only retrieval, graph retrieval, and graph-plus-memory. Score correct decisions, evidence support, stale-policy avoidance, extra useful actions, and replay consistency.
10. **Demo gate:** freeze a runnable vertical slice with an action, an inspectable evidence chain, and a later session that uses memory. Add secondary tracks only when that slice remains reliable.

The spike should produce a small capability matrix and recorded results. Unsupported features should be removed from the critical path early. A distinctive project with a verified narrow workflow is more convincing than three track labels attached to fragile functionality.

## 15. What remains unknown

Exact judging weights, organizer-preferred release, sponsor credits, allowed pre-event technical trials, submission format details, hosted-plan practical limits, and optional protocol behavior require direct confirmation or a later check. This dossier does not establish deployment latency, corpus extraction accuracy, end-to-end agent correctness, or any tested performance result.

Before commitment, resolve the pinned version's Bolt status if relevant; whether vector workers need explicit enabling; algorithm option differences; actual index/constraint readiness behavior; timeout/rollback semantics under resource pressure; and source ingestion costs. These are bounded engineering questions. None requires modifying FalkorDB itself to produce a graph-dependent agent.
