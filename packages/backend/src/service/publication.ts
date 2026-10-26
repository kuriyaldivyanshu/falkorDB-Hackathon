import { randomUUID } from 'node:crypto';
import { ADMISSION_LIMITS } from '../admission.js';
import { ThreadlineError } from '@threadline/shared';
import { withProjectBarriers, type SqlDatabase, type TxClient } from '../storage/pg.js';
import { withFilePublication, type SourceFileStore, type PublishSourceBytesInput, type StoredSourceBytes, type FilePublication } from '../storage/files.js';

export interface PublicationInput extends Omit<PublishSourceBytesInput, 'publication'> {}
interface Reservation extends FilePublication { readonly generation: string }
export interface PublicationPlan<T> { readonly value: T; readonly inputs: readonly PublicationInput[] }
export interface PublicationService {
  run<P,T>(tenantId: string, projectId: string, prepare: (tx: TxClient) => Promise<PublicationPlan<P>>,
    finalize: (tx: TxClient, value: P, stored: ReadonlyMap<string,StoredSourceBytes>) => Promise<T>,
    revalidate: (tx: TxClient) => Promise<void>): Promise<T>;
  reconcile(): Promise<void>;
  close(): Promise<void>;
}

/** A reservation commits before bytes exist. The project/session object locks
 * outlive the file write, catalog COMMIT and any ambiguous outcome settlement.
 * No timer or lease authorizes taking a live publisher's ownership. */
export function createPublicationService(deps: {db: SqlDatabase; files: SourceFileStore}): PublicationService {
  let closing=false;let active=0;let drained:(()=>void)|undefined;
  let closePromise:Promise<void>|undefined;
  const settle = async (db: SqlDatabase, tenantId: string, projectId: string, reservations: readonly Reservation[]) => {
    await db.withTenantTransaction(tenantId, async tx => {
      for (const reservation of reservations) {
        const rows = await tx.rows<{generation:string; state:string; digest:string; byte_size:string; storage_key:string; referenced:boolean}>(`SELECT p.generation::text,p.state,o.digest,o.byte_size::text,o.storage_key,
          EXISTS(SELECT 1 FROM threadline_memory.evidence_references r WHERE r.tenant_id=p.tenant_id
            AND r.project_id=p.project_id AND r.publication_id=p.id) AS referenced
          FROM threadline_memory.evidence_publications p JOIN threadline_memory.evidence_objects o
          USING(tenant_id,project_id,digest) WHERE p.tenant_id=$1 AND p.project_id=$2 AND p.id=$3
          AND o.generation=p.generation FOR UPDATE OF p,o`, [tenantId,projectId,reservation.id]);
        if (rows[0]?.generation !== reservation.generation) throw new ThreadlineError('storage_unavailable','Publication generation is unresolved.');
        // A successful ordered SQL read establishes whether catalog COMMIT landed.
        // On failure the durable reserved state remains and blocks publication.
        const object=rows[0]!;
        if(object.referenced) {
          const byteSize=Number(object.byte_size);
          if(!Number.isSafeInteger(byteSize) || byteSize<1 || byteSize>ADMISSION_LIMITS.memoryDocumentBytes)
            throw new ThreadlineError('storage_unavailable','Evidence recovery size is unresolved.');
          await deps.files.read({tenantId,projectId,digest:object.digest,storageKey:object.storage_key,byteSize,maxBytes:ADMISSION_LIMITS.memoryDocumentBytes});
        }
        await deps.files.recoverPartial(reservation);
        await tx.rows(`UPDATE threadline_memory.evidence_publications p SET state=CASE WHEN EXISTS(
          SELECT 1 FROM threadline_memory.evidence_references r WHERE r.tenant_id=p.tenant_id
          AND r.project_id=p.project_id AND r.publication_id=p.id) THEN 'referenced' ELSE 'orphan' END
          WHERE p.tenant_id=$1 AND p.project_id=$2 AND p.id=$3`, [tenantId,projectId,reservation.id]);
      }
    });
  };
  const lockObjects = async (db: SqlDatabase, reservations: readonly Reservation[]) => {
    const keys = [...new Set(reservations.map(r=>`threadline:object:${r.tenantId}:${r.projectId}:${r.digest}`))].sort();
    await db.query(`SELECT pg_advisory_lock(hashtextextended(key,0)) FROM
      (SELECT unnest($1::text[]) AS key ORDER BY key) ordered`, [keys]);
  };
  const withPermits = async <T>(reservations: readonly Reservation[], work: () => Promise<T>): Promise<T> => {
    const enter = (index:number):Promise<T> => index===reservations.length ? work()
      : withFilePublication(reservations[index]!,()=>enter(index+1));
    return enter(0);
  };
  return {
    close() {
      closing=true;
      closePromise ??= active ? new Promise<void>(resolve=>{drained=resolve;}) : Promise.resolve();
      return closePromise;
    },
    async run(tenantId,projectId,prepare,finalize,revalidate) {
      if(closing)throw new ThreadlineError('storage_unavailable','Evidence publication is quiescing.');
      active++;
      try { return await withProjectBarriers(deps.db,tenantId,[projectId],async db=> {
        let reservations: Reservation[] = [];
        const plan = await db.withTenantTransaction(tenantId,async tx=> {
          await revalidate(tx);
          const prepared = await prepare(tx);
          const inputs = [...new Map(prepared.inputs.map(input=>[input.digest,input])).values()].sort((a,b)=>a.digest.localeCompare(b.digest));
          for (const input of inputs) {
            if(input.tenantId!==tenantId || input.projectId!==projectId) throw new ThreadlineError('scope_denied','Publication crossed its project.');
            const pending = await tx.rows(`SELECT id FROM threadline_memory.evidence_publications
              WHERE tenant_id=$1 AND project_id=$2 AND digest=$3 AND state='reserved' LIMIT 1`,[tenantId,projectId,input.digest]);
            if(pending.length) throw new ThreadlineError('storage_unavailable','Evidence publication requires recovery.');
            const storageKey=`${tenantId}/${projectId}/${input.digest.slice(0,2)}/${input.digest}`;
            const objects=await tx.rows<{generation:string;byte_size:string;storage_key:string}>(`INSERT INTO threadline_memory.evidence_objects
              (tenant_id,project_id,digest,byte_size,storage_key) VALUES($1,$2,$3,$4,$5)
              ON CONFLICT(tenant_id,project_id,digest) DO UPDATE SET generation=evidence_objects.generation+1
              RETURNING generation::text,byte_size::text,storage_key`,[tenantId,projectId,input.digest,input.bytes.byteLength,storageKey]);
            const object=objects[0];
            if(!object || object.byte_size!==String(input.bytes.byteLength) || object.storage_key!==storageKey)
              throw new ThreadlineError('storage_unavailable','Evidence object catalog does not match publication.');
            const reservation={id:randomUUID(),tenantId,projectId,digest:input.digest,generation:object.generation};
            reservations.push(reservation);
            await tx.rows(`INSERT INTO threadline_memory.evidence_publications(tenant_id,project_id,id,digest,generation,state)
              VALUES($1,$2,$3,$4,$5,'reserved')`,[tenantId,projectId,reservation.id,input.digest,reservation.generation]);
          }
          return prepared;
        });
        return withPermits(reservations,async()=> {
          try {
            return await db.withTenantTransaction(tenantId,async tx=> {
              await revalidate(tx);
              await lockObjects(db,reservations);
              const stored=new Map<string,StoredSourceBytes>();
              for(const input of plan.inputs) {
                const reservation=reservations.find(r=>r.digest===input.digest)!;
                const owned=await tx.rows(`SELECT id FROM threadline_memory.evidence_publications
                  WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND generation=$4 AND state='reserved' FOR UPDATE`,
                [tenantId,projectId,reservation.id,reservation.generation]);
                if(owned.length!==1)throw new ThreadlineError('storage_unavailable','Publication ownership was lost.');
                stored.set(input.digest,await deps.files.publish({...input,publication:reservation}));
              }
              await revalidate(tx);
              const result=await finalize(tx,plan.value,stored);
              for(const reservation of reservations) {
                await tx.rows(`INSERT INTO threadline_memory.evidence_references(tenant_id,project_id,source_id,digest,publication_id)
                  SELECT tenant_id,project_id,id,digest,$4 FROM threadline_memory.sources
                  WHERE tenant_id=$1 AND project_id=$2 AND digest=$3
                  ON CONFLICT(tenant_id,project_id,source_id) DO NOTHING`,[tenantId,projectId,reservation.digest,reservation.id]);
                await tx.rows(`UPDATE threadline_memory.evidence_publications p SET state=CASE WHEN EXISTS(
                  SELECT 1 FROM threadline_memory.evidence_references r WHERE r.tenant_id=p.tenant_id AND r.project_id=p.project_id
                  AND r.publication_id=p.id) THEN 'referenced' ELSE 'orphan' END WHERE tenant_id=$1 AND project_id=$2 AND id=$3`,
                [tenantId,projectId,reservation.id]);
              }
              await revalidate(tx);
              return result;
            });
          } catch(error) {
            // Do not infer rollback from the thrown COMMIT response. Ordered
            // settlement must succeed; otherwise reserved ownership persists.
            await lockObjects(db,reservations);
            await settle(db,tenantId,projectId,reservations);
            throw error;
          }
        });
      }); } finally {active--;if(active===0)drained?.();}
    },
    async reconcile() {
      const projects=await deps.db.query<{tenant_id:string;project_id:string}>('SELECT * FROM threadline_memory.pending_evidence_publications()');
      if(projects.length>256)throw new ThreadlineError('storage_unavailable','Evidence recovery exceeds its startup bound.');
      for(const project of projects) await withProjectBarriers(deps.db,project.tenant_id,[project.project_id],async db=> {
        const rows=await db.withTenantTransaction(project.tenant_id,tx=>tx.rows<{id:string;digest:string;generation:string}>(`SELECT id,digest,generation::text
          FROM threadline_memory.evidence_publications WHERE tenant_id=$1 AND project_id=$2 AND state='reserved' ORDER BY digest,id LIMIT 257`,
        [project.tenant_id,project.project_id]));
        if(rows.length>256)throw new ThreadlineError('storage_unavailable','Evidence recovery exceeds its startup bound.');
        const reservations=rows.map(row=>({...row,tenantId:project.tenant_id,projectId:project.project_id}));
        await lockObjects(db,reservations);
        await withPermits(reservations,()=>settle(db,project.tenant_id,project.project_id,reservations));
      });
    },
  };
}
