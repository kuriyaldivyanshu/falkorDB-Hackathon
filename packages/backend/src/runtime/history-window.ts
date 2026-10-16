import { ThreadlineError } from '@threadline/shared';
import type {ConversationItem} from '../provider/responses.js';
export function isMemoryItem(item:ConversationItem):boolean {
 if(!('role' in item)||item.role!=='user')return false;
 try{return JSON.parse(item.content)?.type==='threadline.current-memory';}catch{return false;}
}
/** Retain whole completed model/tool batches. Never split or orphan a call. */
export function boundWorkingHistory(history:readonly ConversationItem[],maxBytes=16000):{items:ConversationItem[];dropped:number;retained:number} {
 const roots:ConversationItem[]=[];const groups:ConversationItem[][]=[];let batch:ConversationItem[]=[];
 const open=new Set<string>();const seen=new Set<string>();
 const flush=()=>{if(batch.length){groups.push(batch);batch=[];}};
 for(const item of history.filter(i=>!isMemoryItem(i))) {
  if('role' in item&&item.role==='user'){if(open.size)throw new ThreadlineError('authority_conflict','Incomplete tool batch before user input.');flush();roots.push(item);continue;}
  if('type' in item&&item.type==='function_call'){
   if(seen.has(item.call_id))throw new ThreadlineError('authority_conflict','Duplicate tool identity in working history.');
   if(!open.size&&batch.some(i=>'type' in i&&i.type==='function_call_output'))flush();
   seen.add(item.call_id);open.add(item.call_id);
  }
  if('type' in item&&item.type==='function_call_output'){
   if(!open.delete(item.call_id))throw new ThreadlineError('authority_conflict','Orphan tool result in working history.');
  }
  batch.push(item);
 }
 if(open.size)throw new ThreadlineError('authority_conflict','Incomplete tool batch cannot be compacted.');flush();
 let dropped=0;const cost=()=>Buffer.byteLength(JSON.stringify([...roots,...groups.flat()]));
 while(groups.length>1&&(groups.length>4||cost()>maxBytes)){groups.shift();dropped++;}
 if(cost()>maxBytes){
  // Replace oversized retained results with attributed original-Source records.
  // The durable output is untouched and no generated summary is involved.
  for(const group of groups)for(let i=0;i<group.length;i++){
   const item=group[i];if(!item||!('type' in item)||item.type!=='function_call_output')continue;
   try{const output=JSON.parse(item.output);if(typeof output.evidenceSourceId==='string')group[i]={...item,output:JSON.stringify({evidenceSourceId:output.evidenceSourceId,representation:'reference',omittedBytes:Buffer.byteLength(item.output),reason:'Working-context budget; retrieve exact Source bytes when needed.'})};}catch{/* Non-JSON evidence cannot be safely attributed here. */}
  }
 }
 return {items:[...roots,...groups.flat()],dropped,retained:groups.length};
}
