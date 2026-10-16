import {placeMemoryBlock} from '../runtime/memory-slot.js';
import { randomUUID } from 'node:crypto';
import { PACKET_DEFAULT_TOKENS, ThreadlineError, type ContextService,type ContextScope,type ContextPacketManifest,type ContextOccurrence } from '@threadline/shared';
import type { ConversationItem } from '../provider/responses.js';
import type { PreparedAttempt,ProviderLifecycle,SettledAttempt } from '../provider/lifecycle.js';
import type { SqlDatabase } from '../storage/pg.js';
import { renderPacket } from './service.js';
import { admitContextWire } from './budget.js';

import { boundWorkingHistory } from '../runtime/history-window.js';
export {boundWorkingHistory,isMemoryItem} from '../runtime/history-window.js';

export function createRuntimeContext(deps:{service:ContextService;scope:ContextScope;db:SqlDatabase;limitTokens:number;maxOutputTokens:number;maxInputTokens:number;toolsText:string}) {
 let packet:ContextPacketManifest|null=null;const occurrences=new Map<string,ContextOccurrence>();
 let queue=Promise.resolve();let lifecycleError:unknown=null;
 return {
  async reconstruct(history:readonly ConversationItem[]):Promise<readonly ConversationItem[]> {
   let maxTokens=PACKET_DEFAULT_TOKENS;
   const inputCeiling=Math.min(deps.maxInputTokens,deps.limitTokens-deps.maxOutputTokens-256);
   if(inputCeiling<1)throw new ThreadlineError('authority_conflict','No input capacity remains after output reservation.');
   for(let round=0;round<4;round++){
     const result=await deps.service.refresh(deps.scope,{maxTokens});
     if(!result.manifest)throw new ThreadlineError('authority_conflict',result.refusal?.message??'Context could not be built.',result.refusal?.kind==='stale_revision'?{reason:'context_refresh_required'}:undefined);
     packet=result.manifest;
     const memory:ConversationItem={role:'user',content:renderPacket(packet)};
     const available=inputCeiling-Buffer.byteLength(deps.toolsText)-Buffer.byteLength(JSON.stringify(memory))-512;
     const bounded=boundWorkingHistory(history,Math.max(0,available));
     const budget=deps.service.budget({instructionsText:'',historyText:JSON.stringify(bounded.items),toolSchemasText:deps.toolsText,
       packetText:JSON.stringify(memory),retrievalText:'',reservedOutputTokens:0,safetyHeadroomTokens:448,limitTokens:inputCeiling});
     if(budget.permitted)return placeMemoryBlock(bounded.items,null,{items:[memory]},'start').history;
     maxTokens=Math.max(1,maxTokens-(budget.overageTokens??1)-256);
   }
   throw new ThreadlineError('authority_conflict','Required authority, input and schemas cannot fit the whole-request budget.');
  },
  async admit(prepared:PreparedAttempt){
   if(!packet)throw new ThreadlineError('authority_conflict','No current packet is staged.');
   const check=admitContextWire(prepared.requestBody,deps.limitTokens,prepared.maxOutputTokens);
   if(!check.permitted)throw new ThreadlineError('authority_conflict','Exact serialized context request exceeds declared capacity.',{reason:'context_window_exceeded'});
   await deps.service.validateForAdmission(deps.scope,packet.packetId);
  },
  async journaled(prepared:PreparedAttempt){
   if(!packet)throw new ThreadlineError('authority_conflict','Packet missing at journaling.');
   const rows=await deps.db.withTenantTransaction(deps.scope.tenantId,tx=>tx.rows<{content_digest:string;attempt_no:number}>(`SELECT trim(p.content_digest) AS content_digest,m.attempt_no FROM threadline.context_packets p JOIN threadline.model_requests m ON m.tenant_id=p.tenant_id AND m.project_id=p.project_id WHERE p.tenant_id=$1 AND p.project_id=$2 AND p.id=$3 AND m.id=$4`,[deps.scope.tenantId,deps.scope.projectId,packet!.packetId,prepared.attemptId]));
   const occurrence:ContextOccurrence={occurrenceId:randomUUID(),packetId:packet.packetId,tenantId:deps.scope.tenantId,projectId:deps.scope.projectId,taskId:deps.scope.taskId,attemptId:prepared.attemptId,
    attemptNo:rows[0]?.attempt_no??0,logicalRequestId:prepared.logicalRequestId,packetDigest:rows[0]?.content_digest??'',createdAt:new Date().toISOString()};
   occurrences.set(prepared.attemptId,await deps.service.recordOccurrence(deps.scope,occurrence));
  },
  observe(event:ProviderLifecycle){if(event.phase!=='dispatched')return;
   const o=occurrences.get(event.attempt.attemptId);if(!o){lifecycleError=new Error('Dispatch without context journal.');return;}
   queue=queue.then(async()=>{await deps.service.transitionOccurrence(deps.scope,{occurrenceId:o.occurrenceId,lifecycle:'dispatch_observed',recordedAt:new Date().toISOString()});}).catch(error=>{lifecycleError=error;});
  },
  async settled(turn:SettledAttempt){await queue;if(lifecycleError)throw lifecycleError;
   const o=occurrences.get(turn.attemptId);if(!o)throw new Error('Missing context occurrence for terminal attempt.');
   const terminal=turn.responseId!==null||turn.usage!==null;
   await deps.service.transitionOccurrence(deps.scope,{occurrenceId:o.occurrenceId,lifecycle:terminal?'terminal_observed':turn.possibleCharge?'outcome_unknown':'journaled',recordedAt:new Date().toISOString(),providerResponseId:turn.responseId,possibleCharge:turn.possibleCharge});
  },
 };
}
