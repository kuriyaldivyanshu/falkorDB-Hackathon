import { createHash, randomUUID } from 'node:crypto';
import { HUMAN_INPUT_MAX_CHARS, HUMAN_INPUT_MAX_ITEMS, ThreadlineError, isUuid, type HumanInputResult, type HumanInputSubmission,
 type ModelListResult, type ProfileSelection, type SelectionResult } from '@threadline/shared';
import { validModel } from '../provider/credentials.js';
import { PROVIDERS, type ProviderId, type ProviderApi } from '../provider/catalog.js';
import { withProjectAdmissionLock, type SqlDatabase } from '../storage/pg.js';
import { canonicalDigest } from '../storage/digest.js';
import type { ExecutionRegistry } from '../storage/execution.js';
export interface ProvisioningScope {tenantId:string;projectId:string;userId:string;userSessionId:string;taskId?:string}
interface RuntimeConfiguration {providerId:ProviderId;providerApi:ProviderApi;baseUrl:string;model:string;credentialRevision:string;configured:boolean;fixture:boolean}
export interface ProvisioningService {
 bindRuntime(runtime:{configuration():RuntimeConfiguration;assertConfigurable():void}):void;
 listModels(scope:ProvisioningScope,query?:string|null,limit?:number):Promise<ModelListResult>;
 selectModel(scope:ProvisioningScope,selection:ProfileSelection,operationId:string):Promise<SelectionResult>;
 submitInput(scope:ProvisioningScope,input:HumanInputSubmission):Promise<HumanInputResult>;
}
export function createProvisioningService(deps:{db:SqlDatabase;registry:ExecutionRegistry;clock():Date}):ProvisioningService {
 let runtime:{configuration():RuntimeConfiguration;assertConfigurable():void}|null=null;
 return {
  bindRuntime(value){runtime=value;},
  async listModels(_scope,query,limit=50){
   if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new ThreadlineError('invalid_request','Model list limit is 1–100.');
   const config=runtime?.configuration();
   const models=Object.values(PROVIDERS).map(p=>({providerId:p.id,modelId:config?.providerId===p.id?config.model:'',
    displayName:config?.providerId===p.id&&config.model?`${p.id}/${config.model}`:`${p.id} (manual model id)`,source:'configured' as const,
    contextWindowTokens:null,maxOutputTokens:null,billingRoute:'api_key' as const,accountConfigured:config?.providerId===p.id&&config.configured===true}))
    .filter(m=>!query||`${m.providerId}/${m.modelId}`.includes(query));
   return {models:models.slice(0,limit),total:models.length,truncated:models.length>limit,
    discoveryNote:'Configured model IDs only; manual IDs require declared limits. Listing and selection never probe account/model compatibility.'};
  },
  async selectModel(scope,selection,operationId){
   if(!isUuid(operationId))throw new ThreadlineError('invalid_request','A UUID operation identity is required.');
   const rejected=(rejection:NonNullable<SelectionResult['rejection']>):SelectionResult=>({outcome:'rejected',operationId,rejection});
   if(!Object.hasOwn(PROVIDERS,selection.providerId))return rejected({kind:'unknown_provider',providerId:selection.providerId});
   const config=runtime?.configuration();
   if(!config?.configured||config.providerId!==selection.providerId)return rejected({kind:'no_configured_account',providerId:selection.providerId});
   if(!validModel(selection.modelId))return rejected({kind:'invalid',field:'modelId',reason:'Use a valid model ID of at most 128 characters.'});
   if(!Number.isSafeInteger(selection.maxOutputTokens)||selection.maxOutputTokens<1||selection.maxOutputTokens>4096)return rejected({kind:'declined_limit',field:'maxOutputTokens',requested:selection.maxOutputTokens,allowed:4096});
   if(!Number.isSafeInteger(selection.contextWindowTokens)||selection.contextWindowTokens<=selection.maxOutputTokens||selection.contextWindowTokens>10_000_000)return rejected({kind:'invalid',field:'contextWindowTokens',reason:'Declare a context window greater than output reserve and at most 10000000.'});
   if((selection.providerApi&&selection.providerApi!==config.providerApi)||(selection.baseUrl&&selection.baseUrl!==config.baseUrl))return rejected({kind:'invalid',field:'endpoint',reason:'Select the configured transport and endpoint through masked provider setup first.'});
   const intent=canonicalDigest({provider:selection.providerId,model:selection.modelId,window:selection.contextWindowTokens,output:selection.maxOutputTokens,label:selection.label??null,api:config.providerApi,baseUrl:config.baseUrl,credentialRevision:config.credentialRevision});
   // Serialize exact retries before profile registration, on a reserved connection.
   return deps.db.withConnection(async db=>{
    await db.withTenantTransaction(scope.tenantId,tx=>tx.rows('SELECT pg_advisory_lock(hashtextextended($1,0))',[`selection:${scope.tenantId}:${scope.projectId}:${scope.userId}:${operationId}`]));
    const prior=await db.withTenantTransaction(scope.tenantId,tx=>tx.rows<{id:string;config_digest:string;provider_account_id:string;selection_digest:string;model_id:string}>(`SELECT id,config_digest,provider_account_id,selection_digest,model_id FROM threadline.provider_profiles WHERE tenant_id=$1 AND project_id=$2 AND owner_user_id=$3 AND selection_operation_id=$4`,[scope.tenantId,scope.projectId,scope.userId,operationId]));
    const old=prior[0];
    if(old){if(old.selection_digest.trim()!==intent)return rejected({kind:'invalid',field:'operationId',reason:'Selection payload conflicts with the original intent.'});return {outcome:'replayed',operationId,profileId:old.id,configDigest:old.config_digest.trim(),providerAccountId:old.provider_account_id,providerId:selection.providerId,modelId:old.model_id};}
    runtime!.assertConfigurable();
    const active=await db.withTenantTransaction(scope.tenantId,tx=>tx.rows<{id:string}>('SELECT id FROM threadline.runs WHERE tenant_id=$1 AND project_id=$2 AND finished_at IS NULL LIMIT 1',[scope.tenantId,scope.projectId]));
    if(active[0])return rejected({kind:'active_run_conflict',runId:active[0].id});
    const account=await deps.registry.registerProviderAccount({tenantId:scope.tenantId,userId:scope.userId,provider:config.providerId,runtime:`owned-${config.providerApi}`,authRoute:config.fixture?'local':'api_key',label:`Local ${config.providerId}`,secretRef:null,probeStatus:config.fixture?'fixture':'configured'});
    const profile=await deps.registry.registerProviderProfile({tenantId:scope.tenantId,projectId:scope.projectId,ownerUserId:scope.userId,providerAccountId:account.id,name:selection.label??`${config.providerId}/${selection.modelId}`,modelId:selection.modelId,selectionOperationId:operationId,selectionDigest:intent,adapterVersion:`threadline-${config.providerApi}-v1`,settings:{contextWindowTokens:selection.contextWindowTokens,maxOutputTokens:selection.maxOutputTokens,providerId:config.providerId,api:config.providerApi,baseUrl:config.baseUrl,credentialRevision:config.credentialRevision}});
    return {outcome:'selected',operationId,profileId:profile.id,configDigest:profile.configDigest,providerAccountId:account.id,providerId:config.providerId,modelId:selection.modelId};
   });
  },
  async submitInput(scope,input){
   const reject=(rejection:NonNullable<HumanInputResult['rejection']>):HumanInputResult=>({outcome:'rejected',operationId:input.operationId,rejection});
   if(!isUuid(input.operationId)||!['initial','follow_up'].includes(input.kind)||!['none','explicit',undefined].includes(input.consent)||!input.text.trim()||input.text.length>HUMAN_INPUT_MAX_CHARS)return reject({kind:'invalid',field:'input',reason:'Invalid identity, kind, consent or text size.'});
   // Consent is part of intent identity; recording is not a provider request.
   const bodyDigest=createHash('sha256').update(JSON.stringify({kind:input.kind,text:input.text,consent:input.consent??'none',userId:scope.userId})).digest('hex');
   return withProjectAdmissionLock(deps.db,scope.tenantId,scope.projectId,async tx=>{
    const prior=await tx.rows<{id:string;body_digest:string;inference_consent:string}>(`SELECT id,body_digest,inference_consent FROM threadline.project_messages WHERE tenant_id=$1 AND project_id=$2 AND request_id=$3`,[scope.tenantId,scope.projectId,input.operationId]);
    const old=prior[0];if(old){if(old.body_digest.trim()!==bodyDigest)return reject({kind:'duplicate_conflict',operationId:input.operationId});return {outcome:'replayed',operationId:input.operationId,messageId:old.id,inferenceAuthorized:old.inference_consent==='explicit'};}
    const active=await tx.rows<{id:string}>('SELECT id FROM threadline.runs WHERE tenant_id=$1 AND project_id=$2 AND finished_at IS NULL LIMIT 1',[scope.tenantId,scope.projectId]);
    if(active[0])return reject({kind:'busy',runId:active[0].id,reason:'Active execution cannot safely accept a follow-up yet. Retain the draft; no queue was created.'});
    const taskId=scope.taskId;
    if(!taskId)return reject({kind:'no_admitted_task',projectId:scope.projectId});
    const pending=await tx.rows<{n:string}>('SELECT count(*) AS n FROM threadline.project_messages WHERE tenant_id=$1 AND project_id=$2 AND author_user_id=$3 AND input_kind IS NOT NULL AND run_id IS NULL',[scope.tenantId,scope.projectId,scope.userId]);
    if(Number(pending[0]?.n??0)>=HUMAN_INPUT_MAX_ITEMS)return reject({kind:'busy',reason:'Pending human-input limit reached; resolve recorded instructions first.'});
    const id=randomUUID();await tx.rows(`INSERT INTO threadline.project_messages(tenant_id,project_id,id,author_user_id,user_session_id,request_id,body,body_digest,visibility,input_kind,inference_consent,task_graph_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'project',$9,$10,$11,$12)`,[scope.tenantId,scope.projectId,id,scope.userId,scope.userSessionId,input.operationId,input.text,bodyDigest,input.kind,input.consent??'none',taskId,deps.clock()]);
    return {outcome:'recorded',operationId:input.operationId,messageId:id,inferenceAuthorized:input.consent==='explicit'};
   });
  },
 };
}
