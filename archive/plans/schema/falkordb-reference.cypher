// Threadline future graph schema/query sketches. PROPOSED AND UNEXECUTED.
// M01/M02 executable, FalkorDB-6.0.2-tested mutations live in
// packages/backend/src/storage/graph-queries.ts; use those for implementation.
// This checkpoint sketch is future M03/M04 guidance, not a runtime migration.
// FalkorDB 6.0.2 requires newly created endpoints and their relationships in
// one CREATE clause; avoid later CREATE clauses referencing a CREATE-bound name.
// Run each statement separately through the official client with bound parameters.
// Create supporting indexes, then constraints from falkordb-constraints.txt.
CREATE INDEX FOR (n:Entity) ON (n.id);
CREATE INDEX FOR (n:RequestReceipt) ON (n.graph_epoch, n.request_id);
CREATE INDEX FOR (n:Event) ON (n.graph_epoch, n.seq);
CREATE INDEX FOR (n:TaskState) ON (n.task_id, n.revision);
CREATE INDEX FOR (n:Task) ON (n.run_id, n.current_status);
CREATE INDEX FOR (n:Observation) ON (n.capture_event_id);
CREATE INDEX FOR (n:Message) ON (n.session_id, n.message_seq);
CREATE INDEX FOR (n:ArtifactVersion) ON (n.content_digest);
CREATE INDEX FOR (n:DeliveryCursor) ON (n.session_id);

// R1: Resolve an uncertain/duplicate command. Compare digest before returning result.
MATCH (p:ProjectRoot {id:$project_id}),
      (r:RequestReceipt {graph_epoch:$graph_epoch, request_id:$request_id})
WHERE p.graph_epoch=$graph_epoch
RETURN r.graph_epoch, r.request_digest, r.event_seq, r.result_json;

// R2: Mandatory task state and current governing constraints.
// Task bindings point to stable Constraint IDs, never only superseded versions.
// Resolve project/goal/task/artifact applicability into SUBJECT_TO before this read.
// Return each binding even if its current version is missing; service requires exactly
// one version per applicable constraint and matching current_revision, or fails closed.
// A stale task requirement_revision must be rebased under the project barrier first.
MATCH (p:ProjectRoot {id:$project_id}),
      (t:Task {id:$task_id})-[:CURRENT_STATE]->(s:TaskState)
WHERE p.graph_epoch=$graph_epoch AND t.requirement_revision=p.requirement_revision
OPTIONAL MATCH (t)-[:SUBJECT_TO]->(c:Constraint)
OPTIONAL MATCH (c)-[:CURRENT_VERSION]->(cv:ConstraintVersion)
RETURN p.graph_epoch,p.generation,p.requirement_revision,t.id,s,
       c.id,c.current_revision,cv.id,cv.text,cv.polarity,cv.revision;

// R3: Bounded dependency evidence. Service applies authorization to every source.
MATCH (t:Task {id:$task_id})-[:DEPENDS_ON*1..3]->(dependency:Task)
MATCH (dependency)-[:CURRENT_STATE]->(s:TaskState)
RETURN dependency.id,s.status,s.revision LIMIT 64;

// R4: Affected sessions that loaded an explicitly changed item.
MATCH (item:Entity {id:$changed_id})<-[:INCLUDES]-(packet:ContextPacket)
MATCH (session:AgentSession)-[:LOADED]->(packet)
WHERE session.status='live'
RETURN DISTINCT session.id,packet.id,packet.requirement_revision LIMIT 128;

// R5: Replay committed outbox; validate epoch and handle retention gaps before query.
MATCH (e:Event)
WHERE e.graph_epoch=$graph_epoch AND e.seq>$after_seq
RETURN e.id,e.seq,e.kind,e.aggregate_id,e.request_id,e.payload_json,e.payload_digest
ORDER BY e.seq LIMIT 100;

// M01 integration finding (15 October 2026): new-node relationships must share ONE CREATE clause
// on the observed FalkorDB 6.0.2 build. Created values used in later CREATE clauses failed.
// The executable M01 admission template is packages/backend/src/storage/graph-queries.ts.
// This later checkpoint sketch remains UNEXECUTED; do not treat it as M02 implementation.
// M1: Minimal guarded checkpoint with state + event + request receipt in ONE query.
// Caller first resolves an existing receipt (R1); uniqueness handles racing duplicates.
// Core assumes one backend writer, but guards remain inside the atomic mutation.
// The role, evidence source access and transition semantics are checked by admission.
// This public checkpoint example accepts only project-scoped inputs and output.
// Private-input sessions store text in scoped Observations; only policy-derived safe
// status metadata may enter public task state. Reading private text never declassifies it.
MATCH (p:ProjectRoot {id:$project_id}),
      (t:Task {id:$task_id})-[old:CURRENT_STATE]->(s:TaskState),
      (agent:AgentSession {id:$session_id, output_visibility:'project'}),
      (cp:Source {id:$checkpoint_source_id, visibility:'project', availability:'available'})
OPTIONAL MATCH (prior:RequestReceipt {graph_epoch:$graph_epoch, request_id:$request_id})
WITH p,t,old,s,prior,agent,cp
WHERE prior IS NULL AND p.graph_epoch=$graph_epoch AND p.status='ready'
  AND agent.authorization_kind='task_claim' AND $publication_policy_checked=true
  AND cp.content_digest=$checkpoint_manifest_digest AND $checkpoint_manifest_validated=true
  AND $covered_capture_seq<=agent.last_capture_seq
  AND t.current_revision=$expected_revision
  AND s.owner_session_id=$session_id AND s.fence=$fence
  AND s.lease_expires_ms>$now_ms AND s.status='running'
  AND p.requirement_revision=$requirement_revision
  AND t.requirement_revision=$requirement_revision
SET p.next_event_seq=p.next_event_seq+1,p.generation=p.generation+1,
    t.current_revision=t.current_revision+1
DELETE old
CREATE (next:Entity:TaskState {id:$state_id,schema_version:1,created_at_ms:$now_ms,
  producer_id:$actor_id,visibility:'project',task_id:t.id,revision:t.current_revision,
  status:'running',owner_session_id:$session_id,fence:$fence,
  lease_expires_ms:s.lease_expires_ms,requirement_revision:$requirement_revision,
  checkpoint_text:$checkpoint_text,checkpoint_source_id:$checkpoint_source_id,
  checkpoint_session_id:$session_id,checkpoint_capture_seq:$covered_capture_seq,
  candidate_digest:$candidate_digest,
  unresolved_effects:$unresolved_effects}),
(next)-[:CHECKPOINT_SOURCE {id:$checkpoint_source_edge_id,created_at_ms:$now_ms,producer_id:$actor_id,schema_version:1}]->(cp),
(next)-[:PREVIOUS_STATE {id:$previous_edge_id,created_at_ms:$now_ms,producer_id:$actor_id,schema_version:1}]->(s),
(t)-[:CURRENT_STATE {id:$current_edge_id,created_at_ms:$now_ms,producer_id:$actor_id,schema_version:1}]->(next),
(e:Entity:Event {id:$event_id,schema_version:1,created_at_ms:$now_ms,
  producer_id:$actor_id,visibility:'project',graph_epoch:$graph_epoch,seq:p.next_event_seq,
  kind:'task.checkpointed',aggregate_id:t.id,request_id:$request_id,
  payload_digest:$event_payload_digest,payload_json:$event_payload_json,committed_at_ms:$now_ms}),
(e)-[:CHANGES {id:$changes_edge_id,created_at_ms:$now_ms,producer_id:$actor_id,schema_version:1}]->(next),
(r:Entity:RequestReceipt {id:$receipt_id,schema_version:1,created_at_ms:$now_ms,
  producer_id:$actor_id,visibility:'project',graph_epoch:$graph_epoch,request_id:$request_id,
  request_digest:$request_digest,operation:'memory.checkpoint',event_seq:p.next_event_seq,
  result_json:$result_json,actor_id:$actor_id}),
(r)-[:COMMITTED_EVENT {id:$receipt_edge_id,created_at_ms:$now_ms,producer_id:$actor_id,schema_version:1}]->(e)
RETURN t.id,next.revision,e.seq,r.id;

// If M1 returns no row: resolve receipt, else typed conflict. Never report success.
// All node and edge IDs, digests, and payloads are precomputed by trusted service.
// Production templates validate the immutable manifest and covered cursors, connect
// CHECKPOINT_SOURCE, owner/provenance/source/evidence references and
// validate run scope in the same statement. This M1 is not a complete implementation.
// A concurrent uniqueness failure is reconciled via R1, not treated as new authority.
// Do not use graph query schema 'version' as a task revision or MULTI/EXEC as rollback.
