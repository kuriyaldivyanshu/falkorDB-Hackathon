import type { ServerResponse } from 'node:http';
import type { ReplayCursor, ReplayPage } from '@threadline/shared';

/** Bounded SQL-backed catch-up followed by polling the same durable sequence. */
export function openHistoryStream(deps: {
  raw: ServerResponse;
  cursor: ReplayCursor;
  /** Resolves session/project/Source permissions on every call. */
  read(cursor: ReplayCursor, limit: number): Promise<ReplayPage>;
  onClose(): void;
  maxBacklogBytes: number;
}): { close(): void } {
  const {raw}=deps;
  let cursor=deps.cursor, closed=false, timer: NodeJS.Timeout | undefined;
  const close=(destroy=false) => {
    if (closed) return;closed=true;clearTimeout(timer);raw.off('close',onRawClose);deps.onClose();
    if (destroy) raw.destroy(); else raw.end();
  };
  const onRawClose=()=>close();
  raw.once('close',onRawClose);
  const send=(event:string,data:unknown,id?:string) => {
    const frame=`${id ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    if (raw.writableLength+Buffer.byteLength(frame)>deps.maxBacklogBytes) {
      const gap=`event: history.gap\ndata: ${JSON.stringify({frames:[],cursor,hasMore:false,gap:{fromSeq:cursor.afterSeq+1,toSeq:cursor.afterSeq+1}})}\n\n`;
      if (raw.writableLength+Buffer.byteLength(gap)<=deps.maxBacklogBytes) raw.write(gap);
      close();return false;
    }
    if (!raw.write(frame)) { close(true);return false; }
    return true;
  };
  const poll=async()=>{
    try {
      if(closed)return;
      const page=await deps.read(cursor,100);
      if(closed)return;
      if(page.gap){send('history.gap',page);close();return;}
      for(const frame of page.frames){
        if(closed)return;
        // Re-read each delivery, so a revocation after page creation is effective.
        const checked=await deps.read({graphEpoch:cursor.graphEpoch,afterSeq:frame.seq-1},1);
        if(closed)return;
        const permitted=checked.frames[0];
        if(!permitted || checked.gap || permitted.seq!==cursor.afterSeq+1){send('history.gap',checked);close();return;}
        if(!send('history.event',permitted,`${cursor.graphEpoch}:${permitted.seq}`))return;
        cursor={graphEpoch:cursor.graphEpoch,afterSeq:permitted.seq};
      }
      if(!page.hasMore && !send('history.cursor',{...cursor,admission:page.admission}))return;
      if(!closed)timer=setTimeout(()=>{void poll();},page.hasMore?0:250);
    }catch{
      if(!closed){send('history.refused',{code:'authority_unavailable',message:'Delivery stopped; reauthenticate or refresh the durable cursor.'});close();}
    }
  };
  raw.write(': threadline durable project history; reconnect with Last-Event-ID\n\n');
  void poll();
  return {close:()=>close()};
}
