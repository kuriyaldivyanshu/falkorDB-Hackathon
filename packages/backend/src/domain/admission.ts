import { randomUUID } from 'node:crypto';
import { ThreadlineError, isAdmissionReceipt, isGoalAdmissionInput, type AcceptedAuthority,
  type AuthorityView, type GoalAdmissionInput, type GoalAdmissionResult, type AdmissionReceipt } from '@threadline/shared';
import type { Graph } from 'falkordb';
import type { Logger } from '../log.js';
import { canonicalDigest, sha256Hex } from '../storage/digest.js';
import { admissionCypher, RESOLVE_RECEIPT_CYPHER, LATEST_RECEIPT_CYPHER,
  READ_AUTHORITY_CYPHER, READ_CONSTRAINTS_CYPHER, READ_CRITERIA_CYPHER, type GraphParams } from '../storage/graph-queries.js';
import type { GraphStore } from '../storage/graph.js';
import { findInbox, listPendingAdmissions, recordAdmissionIntent, settleCommitted, markQuarantined, type InboxRow } from '../storage/inbox.js';
import { loadProjectScopeByTenant, requireProjectMembership, type AuthenticatedPrincipal } from '../storage/identity.js';
import type { SqlDatabase } from '../storage/pg.js';

export interface AdmissionDeps { readonly db: SqlDatabase; readonly graphs: GraphStore; readonly clock: () => Date; readonly logger?: Logger }
export interface ProjectScope { readonly tenantId: string; readonly projectId: string; readonly graphKey: string; readonly graphEpoch: string; readonly slug: string; readonly role: string }
interface ReceiptRow {
  receipt_id: string; request_digest: string; result_json: string; actor_id: string;
  event_seq: number; event_id: string; event_kind: string; aggregate_id: string;
  payload_json: string; payload_digest: string;
}
interface Prepared { input: GoalAdmissionInput; params: GraphParams; authority: AcceptedAuthority; sourceMessageId: string }

export async function admitGoal(deps: AdmissionDeps, principal: AuthenticatedPrincipal, input: GoalAdmissionInput): Promise<GoalAdmissionResult> {
  const project = await requireProjectMembership(deps.db, principal.tenantId, input.projectId, principal.userId);
  if (project.role !== 'owner' && project.role !== 'editor')
    throw new ThreadlineError('unauthorized','Only a project owner or editor may accept a goal.');
  const normalized: GoalAdmissionInput = { ...input,
    requirements: [...input.requirements].sort((a,b) => a.field.localeCompare(b.field)),
    criteria: [...input.criteria].sort((a,b) => a.ref.localeCompare(b.ref)) };
  const digest = canonicalDigest({ schemaVersion:1, operation:'task.accept_goal', tenantId:project.tenantId,
    projectId:project.projectId, graphEpoch:project.graphEpoch, actorId:principal.userId,
    fixtureId:normalized.fixtureId, goalText:normalized.goalText,
    requirements:normalized.requirements.map(r => ({...r})), criteria:normalized.criteria.map(c => ({...c})) });
  const existing = await findInbox(deps.db, project.tenantId, project.projectId, input.requestId);
  let inbox = existing;
  if (inbox === null) {
    const prepared = prepare(project, principal, normalized, digest, deps.clock());
    const intent = await recordAdmissionIntent(deps.db, { tenantId:project.tenantId,projectId:project.projectId,
      userId:principal.userId,sessionId:principal.sessionId,requestId:input.requestId,graphEpoch:project.graphEpoch,
      operation:'task.accept_goal',payload:prepared,requestDigest:digest,goalText:input.goalText,
      sourceMessageId:prepared.sourceMessageId,bodyDigest:sha256Hex(input.goalText),now:deps.clock() });
    inbox = intent.inbox;
  }
  if (inbox.requestDigest !== digest) throw new ThreadlineError('idempotency_mismatch','This request ID already binds different accepted content or principal.');
  return commitInbox(deps, project, inbox, existing !== null);
}

function preparedFrom(inbox: InboxRow): Prepared {
  const value = inbox.payload;
  if (typeof value !== 'object' || value === null || !('input' in value) || !('params' in value) || !('authority' in value) || !('sourceMessageId' in value) ||
      !isGoalAdmissionInput(value.input) || typeof value.params !== 'object' || value.params === null ||
      typeof value.authority !== 'object' || value.authority === null || typeof value.sourceMessageId !== 'string') {
    throw new ThreadlineError('authority_unavailable','The durable admission intent cannot be reconstructed.');
  }
  // This is a service-authored, immutable SQL envelope. Public input has a separate validator.
  return value as Prepared;
}
async function resolve(graph: Graph, project: ProjectScope, requestId: string): Promise<ReceiptRow | null> {
  const reply = await graph.roQuery<ReceiptRow>(RESOLVE_RECEIPT_CYPHER,{params:{project_id:project.projectId,graph_epoch:project.graphEpoch,request_id:requestId}});
  if ((reply.data?.length ?? 0) > 1) throw new ThreadlineError('authority_unavailable','Duplicate committed receipts exist.');
  return reply.data?.[0] ?? null;
}
function pending(inbox: InboxRow): GoalAdmissionResult {
  return {kind:'pending',requestId:inbox.requestId,sourceMessageId:inbox.sourceMessageId ?? '',inboxId:inbox.id,
    outcomeUnknown:true,reason:'The exact graph outcome or SQL settlement is not yet established; retry the same request ID.'};
}
function isRetryableGraphFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = 'code' in error ? error.code : undefined;
  return ['ECONNRESET','ECONNREFUSED','ECONNABORTED','EPIPE','ETIMEDOUT','ENETUNREACH','EHOSTUNREACH','EAI_AGAIN','ABORT_ERR'].includes(String(code)) ||
    ['AbortError','TimeoutError','ConnectionTimeoutError','SocketTimeoutError','SocketClosedUnexpectedlyError',
      'SocketTimeoutDuringMaintenanceError','CommandTimeoutDuringMaintenanceError',
      'ClientClosedError','ClientOfflineError','DisconnectsClientError'].some(name => error.name === name || error.constructor.name === name) ||
    /\b(query (timed out|timeout)|query execution (timed out|timeout)|execution time exceeded)\b/i.test(error.message);
}
function parseReceipt(row: ReceiptRow, inbox: InboxRow, project: ProjectScope, replayed: boolean): AdmissionReceipt {
  if (row.request_digest !== inbox.requestDigest || inbox.graphEpoch !== project.graphEpoch || !Number.isSafeInteger(row.event_seq))
    throw new ThreadlineError('authority_conflict','The receipt digest, epoch or sequence does not match the durable intent.');
  let authority: unknown;
  try { authority = JSON.parse(row.result_json); } catch { throw new ThreadlineError('authority_unavailable','Receipt payload is invalid.'); }
  const receipt = { kind:'accepted',requestId:inbox.requestId,requestDigest:inbox.requestDigest,replayed,
    graphEpoch:project.graphEpoch,eventSeq:row.event_seq,graphReceiptId:row.receipt_id,
    sourceMessageId:inbox.sourceMessageId,authority };
  if (!isAdmissionReceipt(receipt)) throw new ThreadlineError('authority_unavailable','Receipt payload is incomplete.');
  return receipt;
}
async function commitInbox(deps: AdmissionDeps, project: ProjectScope, inbox: InboxRow, replayed: boolean): Promise<GoalAdmissionResult> {
  if (inbox.graphEpoch !== project.graphEpoch || inbox.status === 'quarantined' || inbox.status === 'rejected')
    throw new ThreadlineError('authority_conflict','This admission is quarantined, rejected or belongs to an earlier epoch.');
  const graph = deps.graphs.graph(project.graphKey);
  try {
    let receipt = await resolve(graph,project,inbox.requestId);
    if (receipt === null) {
      if (inbox.status === 'committed') throw new ThreadlineError('authority_unavailable','Committed receipt is missing.');
      const prepared = preparedFrom(inbox);
      let retryableFailure = false;
      try { await graph.query(admissionCypher(prepared.input.requirements.length,prepared.input.criteria.length),{params:prepared.params}); }
      catch (error) { retryableFailure = isRetryableGraphFailure(error); }
      // Always resolve first: even a failed acknowledgement may hide a commit.
      receipt = await resolve(graph,project,inbox.requestId);
      if (receipt === null) {
        if (retryableFailure) return pending(inbox);
        throw new ThreadlineError('authority_conflict','The graph rejected this admission or its authority guards did not create a receipt.');
      }
    }
    const result = parseReceipt(receipt,inbox,project,replayed);
    await settleCommitted(deps.db,{tenantId:project.tenantId,projectId:project.projectId,requestId:inbox.requestId,
      receiptId:receipt.receipt_id,eventSeq:receipt.event_seq,eventGraphId:receipt.event_id,eventKind:receipt.event_kind,
      aggregateId:receipt.aggregate_id,eventPayload:JSON.parse(receipt.payload_json) as unknown,
      eventPayloadDigest:receipt.payload_digest,graphEpoch:project.graphEpoch,committedAt:deps.clock()});
    return result;
  } catch (error) {
    if (error instanceof ThreadlineError && ['authority_conflict','authority_unavailable','idempotency_mismatch'].includes(error.code)) throw error;
    deps.logger?.log({level:'warn',message:'Admission remains pending reconciliation.',fields:{requestId:inbox.requestId,errorName:error instanceof Error ? error.name : 'unknown'}});
    return pending(inbox);
  }
}

export async function readAdmissionByRequestId(deps: AdmissionDeps, principal: AuthenticatedPrincipal, projectId: string, requestId: string): Promise<GoalAdmissionResult> {
  const project = await requireProjectMembership(deps.db,principal.tenantId,projectId,principal.userId);
  const inbox = await findInbox(deps.db,project.tenantId,projectId,requestId);
  if (inbox === null) throw new ThreadlineError('not_found','No admission exists for that request ID.');
  await requireSource(deps,principal,project,inbox.sourceMessageId);
  return commitInbox(deps,project,inbox,true);
}
async function requireSource(deps: AdmissionDeps, principal: AuthenticatedPrincipal, project: ProjectScope, sourceId: string | null): Promise<{body:string;body_digest:string}> {
  const rows = await deps.db.withTenantTransaction(project.tenantId,tx=>tx.rows<{body:string;body_digest:string}>(
    `SELECT body,body_digest FROM threadline.project_messages WHERE tenant_id=$1 AND project_id=$2 AND id=$3
       AND (visibility='project' OR author_user_id=$4)`,[project.tenantId,project.projectId,sourceId,principal.userId]));
  const row=rows[0];
  if (row===undefined) throw new ThreadlineError('unauthorized','The original source is not available to this principal.');
  if (sha256Hex(row.body)!==row.body_digest) throw new ThreadlineError('authority_unavailable','The original source digest does not match.');
  return row;
}
export async function readCurrentAuthority(deps: AdmissionDeps, principal: AuthenticatedPrincipal, projectId: string): Promise<AuthorityView> {
  const project = await requireProjectMembership(deps.db,principal.tenantId,projectId,principal.userId);
  const graph=deps.graphs.graph(project.graphKey);
  const latest=await graph.roQuery<{request_id:string}>(LATEST_RECEIPT_CYPHER,{params:{project_id:projectId,graph_epoch:project.graphEpoch}});
  const id=latest.data?.[0]?.request_id;
  if (id===undefined) throw new ThreadlineError('authority_unavailable','No accepted task exists for this project.');
  const accepted=await readAdmissionByRequestId(deps,principal,projectId,id);
  if (!isAdmissionReceipt(accepted)) throw new ThreadlineError('authority_unavailable','Admission settlement is still pending.');
  const a=accepted.authority;
  const base=await graph.roQuery<{goal_version_id:string;goal_revision:number;goal_text:string;state_id:string;task_revision:number;task_status:string;source_id:string;source_message_id:string;availability:string;source_digest:string}>(
    READ_AUTHORITY_CYPHER,{params:{project_id:projectId,graph_epoch:project.graphEpoch,goal_id:a.goalId,task_id:a.taskId,event_seq:accepted.eventSeq}});
  const row=base.data?.[0];
  if (base.data?.length!==1 || row===undefined || row.goal_version_id!==a.goalVersionId || row.availability!=='available' || row.goal_revision!==a.goalRevision || row.task_revision<a.taskRevision || row.source_message_id!==accepted.sourceMessageId)
    throw new ThreadlineError('authority_unavailable','Current goal/task/source topology is missing, duplicated or changed during read.');
  const source=await requireSource(deps,principal,project,row.source_message_id);
  if (row.source_digest!==source.body_digest || row.goal_text!==source.body) throw new ThreadlineError('authority_unavailable','Current goal provenance does not match its original source.');
  const c=await graph.roQuery<{constraint_id:string;version_id:string;revision:number;current_revision:number;field:string;value:number;source_id:string;declared_source_id:string}>(READ_CONSTRAINTS_CYPHER,{params:{task_id:a.taskId}});
  const k=await graph.roQuery<{criterion_id:string;ref:string;text:string;required:boolean}>(READ_CRITERIA_CYPHER,{params:{task_id:a.taskId}});
  if (c.data?.length!==a.constraints.length || k.data?.length!==a.criteria.length) throw new ThreadlineError('authority_unavailable','Required constraint or criterion bindings are incomplete or duplicated.');
  for (const expected of a.constraints) {
    const matches=c.data.filter(v=>v.constraint_id===expected.constraintId);
    const value=matches[0];
    if(matches.length!==1 || value===undefined || value.version_id!==expected.versionId || value.revision!==expected.revision || value.current_revision!==expected.revision || value.field!==expected.field || value.value!==expected.value || value.source_id!==expected.sourceId || value.declared_source_id!==expected.sourceId)
      throw new ThreadlineError('authority_unavailable','A constraint has no unique matching current version.');
  }
  for (const expected of a.criteria) {
    const matches=k.data.filter(v=>v.criterion_id===expected.criterionId);
    if(matches.length!==1 || matches[0]?.ref!==expected.ref || matches[0]?.required!==expected.required || matches[0]?.text!==expected.text)
      throw new ThreadlineError('authority_unavailable','A required criterion is missing or inconsistent.');
  }
  return {...a,goalText:row.goal_text,projectSlug:project.slug,graphKey:project.graphKey,
    taskStateId:row.state_id,sourceMessageIds:[row.source_message_id],taskRevision:row.task_revision,taskStatus:row.task_status};
}

export async function reconcilePendingAdmissions(deps: AdmissionDeps, tenantId: string, projectId: string, _now: Date): Promise<{resolved:number;unresolved:number;quarantined:number}> {
  const project=await loadProjectScopeByTenant(deps.db,tenantId,projectId);
  let resolved=0,unresolved=0,quarantined=0;
  const rows=await listPendingAdmissions(deps.db,tenantId,projectId);
  for(const inbox of rows){
    try { const result=await commitInbox(deps,project,inbox,true);if(result.kind==='accepted')resolved+=1;else unresolved+=1; }
    catch(error){
      if(error instanceof ThreadlineError && error.code!=='storage_unavailable'){
        await markQuarantined(deps.db,tenantId,projectId,inbox.requestId,error.code,deps.clock());quarantined+=1;
      }else throw error;
    }
  }
  return {resolved,unresolved,quarantined};
}
function prepare(project: ProjectScope, principal: AuthenticatedPrincipal, input: GoalAdmissionInput, digest: string, now: Date): Prepared {
  const sourceId=randomUUID(),sourceMessageId=randomUUID(),goalId=randomUUID(),goalVersionId=randomUUID(),taskId=randomUUID(),stateId=randomUUID();
  const requirements=input.requirements.map(r=>({...r,constraint_id:randomUUID(),version_id:randomUUID(),text:`${r.field} = ${r.value} (allowed ${r.minimum}..${r.maximum})`,binding_edge:randomUUID(),current_edge:randomUUID(),version_edge:randomUUID(),source_edge:randomUUID()}));
  const criteria=input.criteria.map(k=>({...k,criterion_id:randomUUID(),task_edge:randomUUID(),goal_edge:randomUUID()}));
  const authority:AcceptedAuthority={projectId:project.projectId,graphEpoch:project.graphEpoch,goalId,goalVersionId,goalRevision:1,
    constraints:requirements.map(r=>({constraintId:r.constraint_id,versionId:r.version_id,revision:r.revision,field:r.field,value:r.value,sourceId})),
    criteria:criteria.map(k=>({criterionId:k.criterion_id,ref:k.ref,required:k.required,text:k.text})),
    taskId,taskStateId:stateId,taskRevision:1,taskStatus:'ready',requirementRevision:Math.max(...input.requirements.map(r=>r.revision))};
  const eventJson=JSON.stringify({taskId,goalId,sourceMessageId,requirementRevision:authority.requirementRevision});
  const actor=sha256Hex(`actor:${project.tenantId}:${principal.userId}`);
  const actorId=[actor.slice(0,8),actor.slice(8,12),`5${actor.slice(13,16)}`,`8${actor.slice(17,20)}`,actor.slice(20,32)].join('-');
  const params:GraphParams={project_id:project.projectId,graph_epoch:project.graphEpoch,request_id:input.requestId,request_digest:digest,actor_id:actorId,now_ms:now.getTime(),
    goal_id:goalId,goal_version_id:goalVersionId,goal_text:input.goalText,criteria_digest:canonicalDigest(input.criteria.map(k=>({...k}))),
    task_id:taskId,task_state_id:stateId,source_id:sourceId,source_message_id:sourceMessageId,source_digest:sha256Hex(input.goalText),requirement_revision:authority.requirementRevision,
    event_id:randomUUID(),receipt_id:randomUUID(),event_payload_json:eventJson,event_payload_digest:sha256Hex(eventJson),result_json:JSON.stringify(authority),requirements,criteria};
  for(const key of ['root_goal_edge','goal_current_edge','goal_version_edge','goal_task_edge','task_state_edge','goal_source_edge','event_state_edge','receipt_event_edge'])params[key]=randomUUID();
  return {input,params,authority,sourceMessageId};
}
