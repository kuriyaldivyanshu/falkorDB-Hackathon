import type { Graph } from 'falkordb';

/** Bound identities before traversing versions; never scan all versions into Node. */
export async function readContextCandidates(graph: Graph, root: string, limit: number, afterMemoryId = '', timeoutMs = 2000): Promise<string[]> {
  const reply = await graph.roQuery<{ memory_id: string }>(
    `MATCH (:Entity:ProjectRoot {id: $root})-[:HAS_MEMORY]->(m:Entity:Memory)
     WHERE m.kind IN ['semantic', 'episodic'] AND m.id > $afterMemoryId
     WITH m ORDER BY m.id ASC LIMIT $limit
     RETURN m.id AS memory_id`,
    { params: { root, limit, afterMemoryId }, TIMEOUT: Math.max(1,Math.min(2000,timeoutMs)) },
  );
  return (reply.data ?? []).map((row) => row.memory_id);
}

/** Two heads are enough to establish ambiguity, with one extra defensive row. */
export async function readContextHeads(graph: Graph, root: string, memoryId: string, timeoutMs=2000): Promise<string[]> {
  const reply = await graph.roQuery<{ version_id: string }>(
    `MATCH (:Entity:ProjectRoot {id: $root})-[:HAS_MEMORY]->(:Entity:Memory {id: $memoryId})
           -[:CURRENT]->(v:Entity:MemoryVersion)
     RETURN v.id AS version_id ORDER BY version_id ASC LIMIT 3`,
    { params: { root, memoryId }, TIMEOUT: Math.max(1,Math.min(2000,timeoutMs)) },
  );
  return (reply.data ?? []).map((row) => row.version_id);
}

/** Refuse corrupt/out-of-contract tasks before any unbounded task aggregation. */
export async function readContextRequirementIds(graph: Graph, root: string, taskId: string): Promise<string[]> {
  const reply = await graph.roQuery<{ memory_id: string }>(
    `MATCH (:Entity:ProjectRoot {id: $root})-[:HAS_TASK]->(:Entity:Task {id: $taskId})-[:REQUIRES]->(m:Entity:Memory)
     RETURN m.id AS memory_id ORDER BY memory_id ASC LIMIT 17`,
    { params: { root, taskId } },
  );
  return (reply.data ?? []).map((row) => row.memory_id);
}

export async function readContextTaskRevision(graph: Graph, root: string, taskId: string): Promise<string | null> {
  const reply = await graph.roQuery<{ revision: string }>(
    `MATCH (:Entity:ProjectRoot {id: $root})-[:HAS_TASK]->(t:Entity:Task {id: $taskId})
     RETURN t.revision AS revision LIMIT 1`,
    { params: { root, taskId } },
  );
  return reply.data?.[0]?.revision ?? null;
}
