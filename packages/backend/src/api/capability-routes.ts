import { ThreadlineError,CAPABILITY_ROUTE } from '@threadline/shared';
import type {FastifyInstance} from 'fastify';
import type {ApplicationServices} from '../domain/services.js';
export interface CapabilityRouteDeps {
 services():ApplicationServices|null;
 localBootstrap():{tenantId:string;userId:string;projectId:string;projectSlug:string}|null;
}
export const CAPABILITY_ROUTES={capabilities:CAPABILITY_ROUTE};
export function registerCapabilityRoutes(app:FastifyInstance,deps:CapabilityRouteDeps):void {
 app.get(CAPABILITY_ROUTE,async request=>{
  const services=deps.services();if(!services)throw new ThreadlineError('storage_unavailable','Capability storage unavailable.');
  const principal=await services.authenticate(typeof request.headers.authorization==='string'?request.headers.authorization:undefined);
  const query=request.query as {projectId?:unknown};
  if(query.projectId!==undefined&&(typeof query.projectId!=='string'||!/^[0-9a-f-]{36}$/i.test(query.projectId)))throw new ThreadlineError('invalid_request','A project UUID is required.');
  const projects=await services.projectsFor(principal);
  const projectId=typeof query.projectId==='string'?query.projectId:projects[0]?.projectId??null;
  if(projectId)await services.membership(principal,projectId);
  return services.capabilities({tenantId:principal.tenantId,userId:principal.userId,projectId});
 });
}
