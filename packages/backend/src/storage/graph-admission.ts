import { createHash } from 'node:crypto';
import { ThreadlineError } from '@threadline/shared';

import type { GraphStore } from './graph.js';

/**
 * SQL-to-graph admission for captured evidence.
 *
 * Three invariants drive everything here.
 *
 * 1. **Mutation, Event and receipt commit together.** A write that produced no
 *    receipt is a write that cannot be reconciled, so all three land in one
 *    FalkorDB statement or none of them do.
 * 2. **Identity is stable and digest-bound.** The operation id and the payload
 *    digest are carried into the receipt, so a redelivery of the same evidence
 *    resolves to the same receipt rather than creating a second Source or
 *    forking an episode.
 * 3. **Missing facts stay missing.** A capture with no observed exit code, no
 *    candidate digest or no environment identity records `null` rather than a
 *    placeholder. A fabricated value is indistinguishable from a measured one
 *    once it is in the graph.
 *
 * FalkorDB 6.0.2 constraints learned the hard way and honoured below: `CREATE`
 * bindings are not visible to a later `CREATE` in the same query (only
 * `RETURN`), `FOREACH` needs both endpoints created inside the loop, a node that
 * needs an incoming relationship must be created inside that relationship's
 * clause, and `--` comments are not valid.
 */

export interface AdmittedFacts {
  readonly tenantId: string;
  readonly projectId: string;
  readonly projectIdGraph: string;
  readonly graphKey: string;
  readonly graphEpoch: string;
  readonly sourceKey: string;
  readonly kind: string;
  /** Stable capture identity; also the aggregate the Event points at. */
  readonly captureEventId: string;
  readonly operationId: string;
  readonly payloadDigest: string;
  readonly agentSessionId: string;
  readonly runId: string;
  readonly taskId: string;
  readonly captureSeq: number;
  readonly observedAt: string;
  /** Original bytes, when the capture archived any. */
  readonly rawArtifactId?: string | null;
  readonly rawContentDigest?: string | null;
  /** Facts that may genuinely be absent. Never invented. */
  readonly invocationId?: string | null;
  readonly toolName?: string | null;
  readonly outcome?: string | null;
  readonly exitCode?: number | null;
  readonly candidateDigest?: string | null;
  readonly environmentDigest?: string | null;
  readonly acceptedRevision?: number | null;
  readonly requirementRevision?: number | null;
  readonly completeVisibleOutput?: boolean | null;
  readonly visibility?: 'project' | 'user' | 'session';
  readonly ownerUserId?: string | null;
  readonly ownerSessionId?: string | null;
  readonly payload?: Readonly<Record<string, unknown>>;
}

export interface GraphAdmission {
  readonly graphEpoch: string;
  readonly eventSeq: number;
  readonly receiptId: string;
  /** True when this exact operation had already committed. */
  readonly replayed: boolean;
  readonly requestDigest: string;
}

export type AdmissionResult =
  | { readonly kind: 'committed'; readonly admission: GraphAdmission }
  /** No effect could be established; the caller may retry per its contract. */
  | { readonly kind: 'failed'; readonly code: string }
  /** The write may or may not have committed; reconcile against the receipt. */
  | { readonly kind: 'ambiguous'; readonly code: string };

export interface GraphAdmitter {
  admit(facts: AdmittedFacts): Promise<AdmissionResult>;
  /**
   * Reads the receipt for an operation without writing anything.
   *
   * This is what turns an ambiguous write into a decision, so it must never
   * mutate the graph.
   */
  findReceipt(
    tenantId: string,
    projectId: string,
    graphKey: string,
    operationId: string,
  ): Promise<GraphAdmission | null>;
}

/** Deterministic identity for a captured piece of evidence. */
function stableUuid(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function createGraphAdmitter(graphs: GraphStore): GraphAdmitter {
  // Written out rather than derived by string replacement: the receipt's
  // properties are read in the MATCH itself, because a CREATE binding is not
  // visible to a later clause on FalkorDB 6.0.2.
  const findReceiptCypher = `MATCH (r:Entity:RequestReceipt {operation_id:$operation_id})
    RETURN r.id AS receipt_id, r.event_seq AS event_seq, r.graph_epoch AS graph_epoch,
           r.request_digest AS request_digest`;

  /**
   * Commits the evidence, its Event and its receipt in one statement.
   *
   * Every label below is decided by the capture kind, so a `tool.intent`
   * becomes an Attempt bound to the session and task, and a model output
   * becomes a Message anchored on the bytes the journal already published.
   */
  const admitCypher = (
    entity: 'observation' | 'attempt' | 'message',
    observed: ReadonlyMap<string, string | number | boolean>,
    episode: boolean, linkAttempt: boolean,
  ): string => {
    const label = entity === 'attempt' ? 'Attempt' : entity === 'message' ? 'Message' : 'Observation';

    // Every property is emitted as an explicit `name:$param` pair and bound
    // through the parameter map. Nothing is interpolated into the query text, so
    // no value can ever be parsed as Cypher, and each parameter keeps the type it
    // was given: a number stays a number and a boolean stays a boolean.
    const propertyClause = [...observed.keys()].map((name) => `${name}:$${name}`).join(', ');
    const episodeProperties = [...observed.keys()].map(name => `${name}:$${name === 'id' ? 'episode_id' : name}`).join(', ');

    // FalkorDB 6.0.2 accepts neither `NOT EXISTS { ... }` subqueries nor a
    // UNION of two shapes here, so the already-committed case is excluded with
    // the `OPTIONAL MATCH ... WHERE prior IS NULL` idiom M02 proved. When this
    // returns no row the caller re-reads the receipt instead.
    // `WITH p, prior` is required: without it the WHERE binds to the first
    // MATCH rather than to the optional pattern, and an existing receipt does
    // not suppress the write -- which then violates Entity.id uniqueness.
    return `MATCH (p:ProjectRoot {id:$project_id})
MATCH (task:Entity:Task {id:$task_id})
${linkAttempt ? 'MATCH (attempt:Entity:Attempt {id:$attempt_id})' : ''}
OPTIONAL MATCH (prior:Entity:RequestReceipt {operation_id:$operation_id})
WITH p, prior, task${linkAttempt ? ', attempt' : ''}
WHERE prior IS NULL AND p.graph_epoch = $graph_epoch AND p.status = 'ready'
SET p.generation = p.generation + 1, p.next_event_seq = p.next_event_seq + 1
${observed.has('raw_artifact_id') ? `MERGE (src:Entity:Source {id:$raw_artifact_id})
ON CREATE SET src.schema_version=1, src.created_at_ms=$now_ms, src.producer_id=$agent_session_id,
 src.visibility=$visibility, src.source_kind='artifact', src.source_sql_id=$raw_artifact_id,
 src.content_digest=$raw_content_digest, src.availability='available'` : ''}
CREATE (p)-[:CHANGES {id:$edge_id, schema_version:1, created_at_ms:$now_ms, producer_id:$agent_session_id}]->
 (record:Entity:${label} {${propertyClause}}),
 (event:Entity:Event {id:$event_id, schema_version:1, created_at_ms:$now_ms, producer_id:$agent_session_id,
 visibility:$visibility, graph_epoch:$graph_epoch, seq:p.next_event_seq,
 kind:$event_kind, aggregate_id:$entity_id, request_id:$operation_id,
 payload_digest:$event_payload_digest, payload_json:$payload_json, committed_at_ms:$now_ms})-[:CHANGES]->(record),
 (receipt:Entity:RequestReceipt {id:$receipt_id, schema_version:1, created_at_ms:$now_ms, producer_id:$agent_session_id,
 graph_epoch:$graph_epoch, operation_id:$operation_id, request_digest:$payload_digest,
 operation:'capture.admit', event_seq:p.next_event_seq, result_json:$result_json,
 actor_id:$agent_session_id})-[:COMMITTED_EVENT]->(event)
 ${entity === 'attempt' ? ', (record)-[:ATTEMPTS]->(task)' : ''}
 ${linkAttempt ? ', (attempt)-[:EVIDENCED_BY]->(record)' : ''}
 ${episode ? `, (episode:Entity:Attempt {${episodeProperties}})-[:ATTEMPTS]->(task), (episode)-[:EVIDENCED_BY]->(record)` : ''}
 ${observed.has('raw_artifact_id') ? ', (record)-[:SOURCED_FROM]->(src)' : ''}
RETURN $event_id AS event_id, p.next_event_seq AS event_seq, $receipt_id AS receipt_id`;

  };

  return {
    async findReceipt(tenantId, projectId, graphKey, operationId): Promise<GraphAdmission | null> {
      void tenantId;
      void projectId;
      const graph = graphs.graph(graphKey);
      const reply = await graph.query<{
        receipt_id: string;
        event_seq: number;
        graph_epoch: string;
        request_digest: string;
      }>(findReceiptCypher, { params: { operation_id: operationId }, TIMEOUT:2000 });
      const row = reply.data?.[0];
      if (row === undefined) {
        return null;
      }
      return {
        graphEpoch: row.graph_epoch,
        eventSeq: Number(row.event_seq),
        receiptId: row.receipt_id,
        replayed: true,
        requestDigest: row.request_digest,
      };
    },

    async admit(facts: AdmittedFacts): Promise<AdmissionResult> {
      const entity = entityFor(facts.kind);
      const eventKind = eventKindFor(facts.kind);
      const graph = graphs.graph(facts.graphKey);
      const nowMs = Date.parse(facts.observedAt);
      if (!Number.isFinite(nowMs)) {
        throw new ThreadlineError('invalid_request', 'The capture observation time is not usable.');
      }

      const entityId = stableUuid(`${facts.projectIdGraph}:${facts.agentSessionId}:${facts.sourceKey}`);
      const eventId = stableUuid(`${facts.projectIdGraph}:${facts.agentSessionId}:${facts.sourceKey}:event`);
      const receiptId = stableUuid(`${facts.projectIdGraph}:${facts.agentSessionId}:${facts.sourceKey}:receipt`);
      // Only facts that were actually observed are written. A fact that was
      // never observed is omitted entirely rather than written as some
      // placeholder, so a later reader cannot mistake absence for a measurement.
      // Property names are server-controlled constants, never caller strings.
      const observed = new Map<string, string | number | boolean>();
      observed.set('id', entityId);
      observed.set('schema_version', 1);
      observed.set('created_at_ms', nowMs);
      observed.set('producer_id', facts.agentSessionId);
      observed.set('visibility', facts.visibility ?? 'project');
      observed.set('task_id', facts.taskId);
      observed.set('run_id', facts.runId);
      observed.set('agent_session_id', facts.agentSessionId);
      observed.set('source_key', facts.sourceKey);
      observed.set('capture_seq', facts.captureSeq);
      observed.set('schema_digest', facts.payloadDigest);

      const put = (name: string, value: string | number | boolean | null | undefined): void => {
        if (value === null || value === undefined) return;
        observed.set(name, value);
      };
      // Which facts apply is decided by the label, so an Attempt never grows a
      // Message-only field and a Message never grows an exit code.
      if (entity !== 'message') {
        put('invocation_id', facts.invocationId);
        put('tool_name', facts.toolName);
        put('outcome', facts.outcome);
        put('exit_code', facts.exitCode);
        put('candidate_digest', facts.candidateDigest);
        put('environment_digest', facts.environmentDigest);
      }
      put('raw_content_digest', facts.rawContentDigest);
      put('owner_user_id', facts.ownerUserId);
      put('owner_session_id', facts.ownerSessionId);
      put('raw_artifact_id', facts.rawArtifactId);
      put('accepted_revision', facts.acceptedRevision);
      put('requirement_revision', facts.requirementRevision);
      put('complete', facts.completeVisibleOutput);
      if (entity === 'message') {
        observed.set('role', facts.kind === 'model.input' ? 'user' : 'assistant');
      }

      // Bound parameters carry the same scalar types as the facts.
      const boundParams: Record<string, string | number | boolean> = {
        project_id: facts.projectIdGraph,
        graph_epoch: facts.graphEpoch,
        agent_session_id: facts.agentSessionId,
        operation_id: facts.operationId,
        payload_digest: facts.payloadDigest,
        payload_json: JSON.stringify({ ...facts.payload, sourceKey: facts.sourceKey, captureSeq: facts.captureSeq,
          sourceId: facts.rawArtifactId ?? null, visibility: facts.visibility ?? 'project',
          ownerUserId: facts.ownerUserId ?? null, ownerSessionId: facts.ownerSessionId ?? null }),
        result_json: JSON.stringify({ entityId, label: entity }),
        source_key: facts.sourceKey,
        capture_seq: facts.captureSeq,
        now_ms: nowMs,
        entity_id: entityId,
        event_id: eventId,
        receipt_id: receiptId,
        edge_id: `${entityId}-${facts.captureSeq}`,
        episode_id: stableUuid(`${facts.projectIdGraph}:${facts.agentSessionId}:${facts.sourceKey}:episode`),
        attempt_id: stableUuid(`${facts.projectIdGraph}:${facts.agentSessionId}:tool:${facts.invocationId ?? ''}`),
        event_kind: eventKind,
        capture_event_id: facts.captureEventId,
      };
      for (const [name, value] of observed) {
        boundParams[name] = value;
      }

      boundParams['event_payload_digest'] = createHash('sha256').update(String(boundParams['payload_json'])).digest('hex');
      let reply;
      try {
        reply = await graph.query<{
          event_id?: string;
          event_seq?: number;
          receipt_id?: string;
        }>(admitCypher(entity, observed, facts.kind === 'registered_command.observation' || facts.kind === 'diagnostic.observation', facts.kind === 'tool.result' && !!facts.invocationId), { params: boundParams, TIMEOUT:2000 });
      } catch (error) {
        // FalkorDB reports a lost acknowledgement and a genuine failure the
        // same way, so neither may be treated as a known no-effect failure.
        return { kind: 'ambiguous', code: describeGraphError(error) };
      }

      const row = reply.data?.[0];
      if (row === undefined) {
        // Either the write was suppressed because a receipt already exists, or
        // the epoch moved. The receipt is the authority, so it is consulted
        // before concluding anything.
        const existing = await this.findReceipt(
          facts.tenantId,
          facts.projectId,
          facts.graphKey,
          facts.operationId,
        );
        if (existing !== null) {
          if (existing.requestDigest !== facts.payloadDigest || existing.graphEpoch !== facts.graphEpoch)
            return { kind: 'failed', code: 'receipt_conflict' };
          return { kind: 'committed', admission: existing };
        }
        return { kind: 'failed', code: 'epoch_or_project_not_ready' };
      }
      return {
        kind: 'committed',
        admission: {
          graphEpoch: facts.graphEpoch,
          eventSeq: Number(row.event_seq ?? 0),
          receiptId: row.receipt_id ?? receiptId,
          replayed: false,
          requestDigest: facts.payloadDigest,
        },
      };
    },
  };
}

/**
 * Which entity a capture kind becomes.
 *
 * An intent is an Attempt because it is the invocation; a result is an
 * Observation because it is what actually happened. Nothing else is invented.
 */
function entityFor(kind: string): 'attempt' | 'observation' | 'message' {
  if (kind === 'tool.intent') return 'attempt';
  if (kind === 'model.input' || kind === 'model.output.complete' || kind === 'model.output.partial') {
    return 'message';
  }
  return 'observation';
}

function eventKindFor(kind: string): string {
  switch (kind) {
    case 'tool.intent':
      return 'attempt.requested';
    case 'tool.result':
      return 'attempt.observed';
    case 'model.input':
      return 'message.input';
    case 'model.output.complete':
      return 'message.output';
    case 'model.output.partial':
      return 'message.partial';
    case 'registered_command.observation':
      return 'observation.registered_command';
    case 'diagnostic.observation':
      return 'observation.diagnostic';
    case 'artifact.missing':
      return 'observation.artifact_missing';
    default:
      return 'capture.gap';
  }
}

function describeGraphError(error: unknown): string {
  if (error instanceof Error) {
    return error.name;
  }
  return typeof error;
}