import { CONTEXT_ROUTES, ThreadlineError, type ContextRefreshResult,type ContextInspectResult,type ContextCompactResult,type MemorySearchResult } from '@threadline/shared';
export function createContextHttp(options:{baseUrl:string;token:string|null;timeoutMs?:number;fetchImpl?:typeof fetch}) {
 const send=async<T>(projectId:string,taskId:string,key:keyof typeof CONTEXT_ROUTES,body?:unknown):Promise<T>=>{
  const path=CONTEXT_ROUTES[key].replace(':projectId',encodeURIComponent(projectId)).replace(':taskId',encodeURIComponent(taskId));
  const r=await (options.fetchImpl??fetch)(options.baseUrl.replace(/\/+$/,'')+path,{method:key==='inspect'?'GET':'POST',headers:{'content-type':'application/json',...(options.token?{authorization:`Bearer ${options.token}`}:{})},signal:AbortSignal.timeout(options.timeoutMs??15000),...(key==='inspect'?{}:{body:JSON.stringify(body??{})})});
  const data:unknown=await r.json();if(!r.ok){const e=data as {message?:string};throw new ThreadlineError('service_unavailable',e.message??`Context operation failed (${r.status}).`);}
  if(!data||typeof data!=='object'||Array.isArray(data))throw new ThreadlineError('invalid_request','Invalid context response.');
  const record=data as Record<string,unknown>;
  if(key==='inspect'&&!Object.hasOwn(record,'packet')||key==='search'&&!Array.isArray(record.hits)||key!=='inspect'&&key!=='search'&&typeof record.kind!=='string')throw new ThreadlineError('invalid_request','Incomplete context response.');
  const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
  const manifest=(v:unknown)=>object(v)&&typeof v.packetId==='string'&&typeof v.taskRevision==='string'&&typeof v.requirementRevision==='string'&&Array.isArray(v.items)&&Array.isArray(v.omissions);
  if(key==='inspect'&&((record.packet!==null&&!manifest(record.packet))||!Array.isArray(record.omissions)))throw new ThreadlineError('invalid_request','Invalid context inspector response.');
  if(key==='refresh'&&(!['refreshed','unchanged','refused'].includes(String(record.kind))||(record.kind!=='refused'&&!manifest(record.manifest))))throw new ThreadlineError('invalid_request','Invalid refresh response.');
  if(key==='compact'&&(!['compacted','refused'].includes(String(record.kind))||record.summaryModelCalls!==0||!Number.isSafeInteger(record.retainedTurns)||!Number.isSafeInteger(record.droppedTurns)))throw new ThreadlineError('invalid_request','Invalid compact response.');
  if(key==='search'&&(!(record.hits as unknown[]).every(hit=>object(hit)&&typeof hit.itemId==='string'&&typeof hit.snippet==='string'&&Array.isArray(hit.bindings)&&['exact_current','compatible_advice','stale_proof'].includes(String(hit.proofStatus)))||!object(record.limits)||!Number.isSafeInteger(record.scannedCandidates)))throw new ThreadlineError('invalid_request','Invalid search response.');
  return data as T;
 };
 return {inspect:(p:string,t:string)=>send<ContextInspectResult>(p,t,'inspect'),refresh:(p:string,t:string)=>send<ContextRefreshResult>(p,t,'refresh'),compact:(p:string,t:string)=>send<ContextCompactResult>(p,t,'compact'),search:(p:string,t:string,query:string)=>send<MemorySearchResult>(p,t,'search',{query})};
}
