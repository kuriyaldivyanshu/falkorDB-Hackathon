/** Parameterized M01 queries. CREATE relationships share one clause on FalkorDB 6.0.2. */
export type GraphParam = string | number | boolean | null | GraphParam[] | { [key: string]: GraphParam };
export type GraphParams = { [key: string]: GraphParam };

export const ENSURE_ACTOR_CYPHER = String.raw`
MERGE (a:Entity:ActorRef {id:$actor_id})
ON CREATE SET a.schema_version=1,a.created_at_ms=$now_ms,a.producer_id=$producer_id,
 a.visibility='project',a.actor_kind='human',a.sql_id=$sql_id,a.display_label=$display_label
RETURN a.id AS actor_id`;

export const RESOLVE_RECEIPT_CYPHER = String.raw`
MATCH (p:ProjectRoot {id:$project_id}),
 (r:RequestReceipt {graph_epoch:$graph_epoch,request_id:$request_id})-[:COMMITTED_EVENT]->(e:Event)
WHERE p.graph_epoch=$graph_epoch
RETURN r.id AS receipt_id,r.request_digest AS request_digest,r.result_json AS result_json,
 r.actor_id AS actor_id,e.seq AS event_seq,e.id AS event_id,e.kind AS event_kind,
 e.aggregate_id AS aggregate_id,e.payload_json AS payload_json,e.payload_digest AS payload_digest`;

export const LATEST_RECEIPT_CYPHER = String.raw`
MATCH (p:ProjectRoot {id:$project_id}), (r:RequestReceipt {graph_epoch:$graph_epoch})
WHERE p.graph_epoch=$graph_epoch AND r.operation='task.accept_goal'
RETURN r.request_id AS request_id ORDER BY r.event_seq DESC LIMIT 1`;

const entity = (id: string): string => `id:${id},schema_version:1,created_at_ms:$now_ms,producer_id:$actor_id,visibility:'project'`;
const edge = (id: string): string => `id:${id},schema_version:1,created_at_ms:$now_ms,producer_id:$actor_id`;

/** Only bounded structural counts are interpolated; every user value is a bound parameter. */
export function admissionCypher(requirements: number, criteria: number): string {
  if (!Number.isInteger(requirements) || requirements < 1 || requirements > 32 ||
      !Number.isInteger(criteria) || criteria < 1 || criteria > 64) throw new RangeError('Invalid admission shape.');
  const patterns = [
    `(p)-[:HAS_GOAL {${edge('$root_goal_edge')}}]->(goal:Entity:Goal {${entity('$goal_id')},current_revision:1,status:'active'})`,
    `(goal)-[:CURRENT_VERSION {${edge('$goal_current_edge')}}]->(gv:Entity:GoalVersion {${entity('$goal_version_id')},revision:1,text:$goal_text,criteria_digest:$criteria_digest,source_id:$source_id})`,
    `(goal)-[:HAS_VERSION {${edge('$goal_version_edge')}}]->(gv)`,
    `(goal)-[:DECOMPOSES_INTO {${edge('$goal_task_edge')}}]->(task:Entity:Task {${entity('$task_id')},current_revision:1,current_status:'ready',requirement_revision:$requirement_revision,depth:0})`,
    `(task)-[:CURRENT_STATE {${edge('$task_state_edge')}}]->(state:Entity:TaskState {${entity('$task_state_id')},task_id:$task_id,revision:1,status:'ready',requirement_revision:$requirement_revision,unresolved_effects:false})`,
    `(gv)-[:SOURCED_FROM {${edge('$goal_source_edge')}}]->(src:Entity:Source {${entity('$source_id')},source_kind:'project_message',source_sql_id:$source_message_id,content_digest:$source_digest,locator_ref:$source_message_id,availability:'available'})`,
    `(event:Entity:Event {${entity('$event_id')},graph_epoch:$graph_epoch,seq:p.next_event_seq,kind:'task.accepted',aggregate_id:$task_id,request_id:$request_id,payload_json:$event_payload_json,payload_digest:$event_payload_digest,committed_at_ms:$now_ms})-[:CHANGES {${edge('$event_state_edge')}}]->(state)`,
    `(receipt:Entity:RequestReceipt {${entity('$receipt_id')},graph_epoch:$graph_epoch,request_id:$request_id,request_digest:$request_digest,operation:'task.accept_goal',event_seq:p.next_event_seq,result_json:$result_json,actor_id:$actor_id})-[:COMMITTED_EVENT {${edge('$receipt_event_edge')}}]->(event)`,
  ];
  for (let i = 0; i < requirements; i += 1) {
    const r = `$requirements[${i}]`;
    patterns.push(
      `(task)-[:SUBJECT_TO {${edge(`${r}.binding_edge`)}}]->(c${i}:Entity:Constraint {${entity(`${r}.constraint_id`)},current_revision:${r}.revision,scope_kind:'task',scope_id:$task_id})`,
      `(c${i})-[:CURRENT_VERSION {${edge(`${r}.current_edge`)}}]->(cv${i}:Entity:ConstraintVersion {${entity(`${r}.version_id`)},revision:${r}.revision,text:${r}.text,field:${r}.field,value:${r}.value,minimum:${r}.minimum,maximum:${r}.maximum,polarity:'must',accepted_by:$actor_id,source_id:$source_id,valid_from_revision:$requirement_revision})`,
      `(c${i})-[:HAS_VERSION {${edge(`${r}.version_edge`)}}]->(cv${i})`,
      `(cv${i})-[:SOURCED_FROM {${edge(`${r}.source_edge`)}}]->(src)`,
    );
  }
  for (let i = 0; i < criteria; i += 1) {
    const k = `$criteria[${i}]`;
    patterns.push(
      `(task)-[:REQUIRES {${edge(`${k}.task_edge`)}}]->(k${i}:Entity:Criterion {${entity(`${k}.criterion_id`)},kind:${k}.kind,ref:${k}.ref,text:${k}.text,check_ref:${k}.ref,required:${k}.required,expected_exit_code:${k}.expectedExitCode,criteria_digest:$criteria_digest,verification_status:'not_implemented'})`,
      `(gv)-[:REQUIRES {${edge(`${k}.goal_edge`)}}]->(k${i})`,
    );
  }
  return `MATCH (p:ProjectRoot {id:$project_id}), (actor:ActorRef {id:$actor_id})
OPTIONAL MATCH (prior:RequestReceipt {graph_epoch:$graph_epoch,request_id:$request_id})
WITH p,actor,prior WHERE prior IS NULL AND p.graph_epoch=$graph_epoch AND p.status='ready'
SET p.generation=p.generation+1,p.next_event_seq=p.next_event_seq+1,
 p.requirement_revision=$requirement_revision
CREATE ${patterns.join(',\n')}
RETURN receipt.id AS receipt_id`;
}

export const READ_AUTHORITY_CYPHER = String.raw`
MATCH (p:ProjectRoot {id:$project_id}),
 (p)-[:HAS_GOAL]->(goal:Goal {id:$goal_id})-[:CURRENT_VERSION]->(gv:GoalVersion),
 (goal)-[:DECOMPOSES_INTO]->(task:Task {id:$task_id})-[:CURRENT_STATE]->(s:TaskState),
 (gv)-[:SOURCED_FROM]->(src:Source)
WHERE p.graph_epoch=$graph_epoch AND p.next_event_seq >= $event_seq AND s.revision=task.current_revision AND s.status=task.current_status
RETURN gv.id AS goal_version_id,gv.revision AS goal_revision,gv.text AS goal_text,
 s.id AS state_id,s.revision AS task_revision,s.status AS task_status,
 src.id AS source_id,src.source_sql_id AS source_message_id,src.availability AS availability,
 src.content_digest AS source_digest`;
export const READ_CONSTRAINTS_CYPHER = String.raw`
MATCH (t:Task {id:$task_id})-[:SUBJECT_TO]->(c:Constraint)
OPTIONAL MATCH (c)-[:CURRENT_VERSION]->(v:ConstraintVersion)
OPTIONAL MATCH (v)-[:SOURCED_FROM]->(src:Source)
RETURN c.id AS constraint_id,c.current_revision AS current_revision,
 v.id AS version_id,v.revision AS revision,v.field AS field,v.value AS value,
 src.id AS source_id,v.source_id AS declared_source_id`;
export const READ_CRITERIA_CYPHER = String.raw`
MATCH (t:Task {id:$task_id})-[:REQUIRES]->(k:Criterion)
RETURN k.id AS criterion_id,k.ref AS ref,k.text AS text,k.required AS required`;

/**
 * Guarded task claim.
 *
 * The fence, revision and lease checks live **inside** this statement, not in a
 * prior read. A JavaScript check followed by an unguarded write would leave a
 * window in which a second claim could pass the check and both writers believe
 * they hold the task.
 *
 * Matches zero rows — rather than committing something — when the epoch moved,
 * the task revision or requirement revision differs from what the caller
 * expected, the task is already owned, or a receipt already exists for this
 * `(epoch, request_id)`.
 *
 * On a match it commits, in one statement: the project generation and event
 * sequence, the Task's owner/status/fence/revision, a new immutable TaskState,
 * the graph AgentSession and Run, the Event and the RequestReceipt.
 */
export const CLAIM_TASK_CYPHER = String.raw`
MATCH (p:ProjectRoot {id:$project_id})
OPTIONAL MATCH (prior:Entity:RequestReceipt {graph_epoch:$graph_epoch, request_id:$request_id})
WITH p, prior
WHERE prior IS NULL
  AND p.graph_epoch = $graph_epoch
  AND p.status = 'ready'
MATCH (t:Entity:Task {id:$task_id})-[old:CURRENT_STATE]->(state:Entity:TaskState)
WHERE t.current_revision = $expected_revision
  AND t.requirement_revision = $expected_requirement_revision
  AND state.revision = t.current_revision
  AND state.status = 'ready'
  AND state.owner_session_id IS NULL
SET p.generation = p.generation + 1,
    p.next_event_seq = p.next_event_seq + 1,
    t.current_revision = t.current_revision + 1,
    t.current_status = 'running',
    t.owner_session_id = $session_id,
    t.fence = coalesce(t.fence, 0) + 1
DELETE old
CREATE (t)-[:CURRENT_STATE {id:$current_state_edge_id, created_at_ms:$now_ms, producer_id:$actor_id, schema_version:1}]->
  (:Entity:TaskState {
    id:$state_id, schema_version:1, created_at_ms:$now_ms, producer_id:$actor_id,
    visibility:'project', task_id:$task_id, revision:t.current_revision,
    status:'running', owner_session_id:$session_id, fence:t.fence,
    lease_expires_ms:$lease_expires_ms, requirement_revision:$requirement_revision,
    unresolved_effects:false})
CREATE (:Entity:AgentSession {
  id:$session_id, schema_version:1, created_at_ms:$now_ms, producer_id:$actor_id,
  visibility:'project', sql_id:$session_id, run_id:$run_id, role:'builder',
  status:'live', lease_expires_ms:$lease_expires_ms, last_capture_seq:0, loaded_requirement_revision:$requirement_revision,
  authorization_kind:'task_claim', authorization_digest:$authorization_digest,
  authorization_json:$authorization_json, output_visibility:'project'})
CREATE (p)-[:HAS_RUN {id:$has_run_edge_id, created_at_ms:$now_ms, producer_id:$actor_id, schema_version:1}]->
  (:Entity:Run {
    id:$run_id, schema_version:1, created_at_ms:$now_ms, producer_id:$actor_id,
    visibility:'project', policy_digest:$policy_digest, status:'active',
    max_live_workers:1, reserved_slots:1, child_launch_count:0, max_child_launches:0,
    reserved_tokens:0, used_tokens:0, usage_unknown:false, max_tokens:$max_total_tokens,
    deadline_ms:$deadline_ms})
CREATE (:Entity:Event {
  id:$event_id, schema_version:1, created_at_ms:$now_ms, producer_id:$actor_id,
  visibility:'project', graph_epoch:$graph_epoch, seq:p.next_event_seq,
  kind:'task.claimed', aggregate_id:$task_id, request_id:$request_id,
  payload_digest:$event_payload_digest, payload_json:$event_payload_json,
  committed_at_ms:$now_ms})
CREATE (:Entity:RequestReceipt {
  id:$receipt_id, schema_version:1, created_at_ms:$now_ms, producer_id:$actor_id,
  visibility:'project', graph_epoch:$graph_epoch, request_id:$request_id,
  request_digest:$request_digest, operation:'task.claim', event_seq:p.next_event_seq,
  result_json:$result_json, actor_id:$actor_id})
RETURN t.current_revision AS revision, t.fence AS fence, p.next_event_seq AS event_seq
`;

/**
 * Extends or verifies a claim under its current fence.
 *
 * Both the heartbeat and the release go through one guarded statement so a
 * stale owner cannot renew or drop a lease that has since moved. An expired
 * lease revokes admission; it never asserts that external execution stopped.
 */
export const RENEW_CLAIM_CYPHER = String.raw`
MATCH (p:ProjectRoot {id:$project_id}), (t:Task {id:$task_id})-[:CURRENT_STATE]->(s:TaskState),
      (a:AgentSession {sql_id:$session_id, status:'live'})
WHERE p.graph_epoch=$graph_epoch AND t.owner_session_id=$session_id
 AND t.fence=$fence AND t.current_status='running' AND s.revision=t.current_revision
 AND coalesce(a.lease_expires_ms,s.lease_expires_ms) >= $now_ms
SET a.lease_expires_ms=$lease_expires_ms
RETURN t.current_revision AS revision,t.fence AS fence
`;

export const RELEASE_CLAIM_CYPHER = String.raw`
MATCH (p:ProjectRoot {id:$project_id})
MATCH (t:Entity:Task {id:$task_id})-[old:CURRENT_STATE]->(s:Entity:TaskState)
MATCH (a:AgentSession {sql_id:$session_id,run_id:$run_id}), (r:Run {id:$run_id})
WHERE p.graph_epoch = $graph_epoch AND t.owner_session_id = $session_id
  AND t.fence = $fence AND t.current_status = 'running'
  AND s.revision = t.current_revision AND s.fence = $fence
  AND ($new_status = 'ready' OR s.lease_expires_ms >= $now_ms)
SET a.status='stopped', r.status='completed', r.reserved_slots=0, t.current_status = $new_status,
    t.current_revision = t.current_revision + CASE WHEN $new_status = 'ready' THEN 1 ELSE 0 END,
    t.fence = t.fence + CASE WHEN $new_status = 'ready' THEN 1 ELSE 0 END,
    t.owner_session_id = CASE WHEN $new_status = 'ready' THEN null ELSE $session_id END
DELETE old
CREATE (t)-[:CURRENT_STATE {id:$state_edge_id, schema_version:1, created_at_ms:$now_ms, producer_id:$session_id}]->
 (:Entity:TaskState {id:$state_id, schema_version:1, created_at_ms:$now_ms, producer_id:$session_id,
   visibility:'project', task_id:$task_id, revision:t.current_revision, status:$new_status,
   owner_session_id:t.owner_session_id, fence:t.fence, lease_expires_ms:$lease_expires_ms,
   requirement_revision:t.requirement_revision, unresolved_effects:false})
RETURN t.current_revision AS revision, t.fence AS fence
`;

/**
 * Current release authority for one worker turn.
 *
 * This is the guard that must hold immediately before every provider dispatch
 * and every tool execution. It reads the **graph** — not a cached local lease
 * timestamp — and refuses unless the epoch, requirement revision, owner session
 * and fence all still match what the caller believes it holds.
 *
 * It also returns the lease the graph actually records, so expiry is decided by
 * the controlled clock against authoritative state rather than against a value
 * cached when the run started.
 */
export const READ_RELEASE_AUTHORITY_CYPHER = String.raw`
MATCH (p:ProjectRoot {id:$project_id})
MATCH (t:Entity:Task {id:$task_id})
WHERE p.graph_epoch = $graph_epoch
  AND t.owner_session_id = $session_id
  AND t.fence = $fence
  AND t.current_revision = $revision
  AND t.requirement_revision = $requirement_revision
  AND t.current_status = 'running'
// The M02 Run binding is the graph Run node plus the AgentSession that points
// at it. M01 admits a goal/task without an execution Run. Task.run_id is not
// used as a fabricated marker or as the authority for this binding.
MATCH (:Entity:AgentSession {sql_id:$session_id, run_id:$run_id, status:'live'})
MATCH (p)-[:HAS_RUN]->(r:Entity:Run {id:$run_id})
WHERE r.status = 'active'
RETURN p.graph_epoch AS graph_epoch,
       p.requirement_revision AS requirement_revision,
       t.current_revision AS revision,
       t.requirement_revision AS task_requirement_revision,
       t.fence AS fence,
       t.owner_session_id AS owner_session_id,
       r.id AS run_id
`;

/**
 * Reads the lease the graph records for the current TaskState.
 *
 * A Task keeps every state it has ever held, so the lease must come from the
 * state matching the current revision and fence. Reading an older state would
 * see a null lease and expire a perfectly live claim.
 *
 *
 * A local cache of `lease_expires_ms` is not proof: only this read, plus the
 * controlled clock comparison, can establish that the claim is still live.
 */
export const READ_CLAIM_LEASE_CYPHER = String.raw`
MATCH (p:ProjectRoot {id:$project_id})
MATCH (t:Entity:Task {id:$task_id})-[:CURRENT_STATE]->(s:Entity:TaskState)
MATCH (a:AgentSession {sql_id:$session_id})
WHERE p.graph_epoch = $graph_epoch
  AND t.fence = $fence
  AND t.owner_session_id = $session_id
  AND s.revision = t.current_revision
  AND s.fence = $fence
  AND s.owner_session_id = $session_id
  AND s.status = 'running'
RETURN t.fence AS fence,
       coalesce(t.fence, 0) AS fence_observed,
       coalesce(a.lease_expires_ms,s.lease_expires_ms) AS lease_expires_ms,
       s.status AS status
`;

/**
 * Sources that must stay readable for this task's accepted authority.
 *
 * The GoalVersion records the Source that accepted it. If those bytes or the
 * SQL row behind them are gone, the work no longer has the provenance it was
 * authorized against, so a release must be refused rather than continued.
 */
export const READ_REQUIRED_SOURCES_CYPHER = String.raw`
MATCH (g:Entity:Goal)-[:CURRENT_VERSION]->(gv:Entity:GoalVersion)-[:SOURCED_FROM]->(src:Entity:Source)
RETURN src.id AS source_id,
       src.source_sql_id AS source_sql_id,
       src.availability AS availability,
       src.content_digest AS content_digest
`;
