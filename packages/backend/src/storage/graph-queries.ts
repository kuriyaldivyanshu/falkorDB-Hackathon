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
WHERE p.graph_epoch=$graph_epoch AND p.next_event_seq=$event_seq
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
