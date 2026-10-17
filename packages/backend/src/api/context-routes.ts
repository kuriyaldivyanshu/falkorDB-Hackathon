import { CONTEXT_ROUTES, ThreadlineError, type ContextScope } from '@threadline/shared';
import type { FastifyInstance } from 'fastify';
import type { ApplicationServices } from '../domain/services.js';
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export function registerContextRoutes(app:FastifyInstance,deps:{services():ApplicationServices|null}):void {
 const resolve=async(request:{headers:{authorization?:string};params:unknown})=>{
  const services=deps.services();if(!services)throw new ThreadlineError('storage_unavailable','Context storage unavailable.');
  const principal=await services.authenticate(request.headers.authorization);
  const params=request.params as {projectId:unknown;taskId:unknown};
  if(!uuid(params.projectId)||!uuid(params.taskId))throw new ThreadlineError('invalid_request','Project and task UUIDs required.');
  const authority=await services.authority(principal,params.projectId);
  if(authority.taskId!==params.taskId)throw new ThreadlineError('not_found','No task exists in this scope.');
  const service=services.context();if(!service)throw new ThreadlineError('storage_unavailable','Context storage unavailable.');
  const scope:ContextScope={tenantId:principal.tenantId,projectId:params.projectId,taskId:params.taskId,userId:principal.userId,userSessionId:principal.sessionId};
  return {service,scope};
 };
 app.get(CONTEXT_ROUTES.inspect,async request=>{const {service,scope}=await resolve(request);return service.inspect(scope);});
 app.post(CONTEXT_ROUTES.refresh,async request=>{const {service,scope}=await resolve(request);const body=record(request.body);
  if(Object.keys(body).some(k=>k!=='maxTokens'))throw new ThreadlineError('invalid_request','Unknown refresh field.');
  if(body.maxTokens!==undefined&&typeof body.maxTokens!=='number')throw new ThreadlineError('invalid_request','maxTokens must be an integer.');
  return service.refresh(scope,{maxTokens:body.maxTokens as number|undefined});});
 app.post(CONTEXT_ROUTES.compact,async request=>{const {service,scope}=await resolve(request);if(Object.keys(record(request.body)).length)throw new ThreadlineError('invalid_request','Compact takes no body fields.');return service.compact(scope);});
 app.post(CONTEXT_ROUTES.search,async request=>{const {service,scope}=await resolve(request);const body=record(request.body);
  if(Object.keys(body).some(k=>!['query','limit','afterItemId'].includes(k))||typeof body.query!=='string'||(body.limit!==undefined&&typeof body.limit!=='number')||(body.afterItemId!==undefined&&body.afterItemId!==null&&typeof body.afterItemId!=='string'))throw new ThreadlineError('invalid_request','Invalid search input.');
  return service.search(scope,{query:body.query,limit:body.limit as number|undefined,afterItemId:body.afterItemId as string|null|undefined});});
}
function record(value:unknown):Record<string,unknown>{if(value===undefined||value===null)return {};if(typeof value!=='object'||Array.isArray(value))throw new ThreadlineError('invalid_request','An object body is required.');return value as Record<string,unknown>;}
