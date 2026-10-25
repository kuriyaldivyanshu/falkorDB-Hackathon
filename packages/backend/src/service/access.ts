import { randomUUID } from 'node:crypto';

import {
  ThreadlineError, parseContract, uuidSchema, issueReaderCredentialInputSchema,
  readerCredentialMetadataSchema, READER_LIST_MAX,
  type ReaderCredentialMetadata, type IssueReaderCredentialResult, type ListReaderCredentialsResult,
} from '@threadline/shared';

import { withProjectWriteLock } from '../storage/pg.js';
import { canonicalDigest, sha256Hex } from '../storage/digest.js';
import type { SqlDatabase, TxClient } from '../storage/pg.js';
import { generateClientToken, hashClientToken, type AuthenticatedCall } from './auth.js';
import { requirePermission } from './permissions.js';
import type { AdmissionService } from './admission.js';
import { requireProjectScope } from './semanticSupport.js';

export interface AccessService {
  issue(call: AuthenticatedCall, projectId: string, input: unknown): Promise<IssueReaderCredentialResult>;
  list(call: AuthenticatedCall, projectId: string, limit?: number): Promise<ListReaderCredentialsResult>;
  revoke(call: AuthenticatedCall, projectId: string, credentialId: string): Promise<ReaderCredentialMetadata>;
}
interface CredentialRow {
  credential_id: string; project_id: string; principal_id: string; label: string;
  state: 'active' | 'revoked' | 'expired'; created_at: Date; expires_at: Date;
  idle_expires_at: Date; revoked_at: Date | null; request_digest: string;
}
const SELECT_METADATA = `SELECT r.credential_id,r.project_id,r.principal_id,r.label,r.request_digest,
  CASE WHEN t.state='revoked' OR t.revoked_at IS NOT NULL OR g.state<>'active' OR a.state<>'active' THEN 'revoked'
       WHEN t.expires_at<=clock_timestamp() OR t.idle_expires_at<=clock_timestamp() THEN 'expired'
       ELSE 'active' END AS state,
  t.created_at,t.expires_at,t.idle_expires_at,t.revoked_at
  FROM threadline_memory.reader_credentials r
  JOIN threadline_memory.client_tokens t ON t.tenant_id=r.tenant_id AND t.id=r.credential_id
  JOIN threadline_memory.project_grants g ON g.tenant_id=r.tenant_id AND g.project_id=r.project_id AND g.principal_id=r.principal_id
  JOIN threadline_memory.principals a ON a.tenant_id=r.tenant_id AND a.id=r.principal_id`;
function metadata(row: CredentialRow): ReaderCredentialMetadata {
  return parseContract(readerCredentialMetadataSchema, {
    credentialId: row.credential_id, projectId: row.project_id, principalId: row.principal_id,
    label: row.label, kind: 'reader', role: 'reader', state: row.state,
    createdAtMs: row.created_at.getTime(), expiresAtMs: row.expires_at.getTime(),
    idleExpiresAtMs: row.idle_expires_at.getTime(), revokedAtMs: row.revoked_at?.getTime() ?? null,
  }, 'reader credential metadata');
}

/** Recheck stored owner authority inside each transaction. Row locks preserve
 * that authority through mutation commit; current expiry uses advancing time.
 * Mutations take the common project barrier before these authority locks.
 * Release holds shared authority locks until its permit commits.
 */
export async function authorizeProjectOwner(tx: TxClient, call: AuthenticatedCall, projectId: string): Promise<void> {
  requireProjectScope(call, projectId);
  requirePermission(call, 'access.admin');
  const rows = await tx.rows(`SELECT t.id FROM threadline_memory.client_tokens t
    JOIN threadline_memory.principals a ON a.tenant_id=t.tenant_id AND a.id=t.principal_id
    JOIN threadline_memory.project_grants g ON g.tenant_id=t.tenant_id AND g.principal_id=t.principal_id
    JOIN threadline_memory.projects p ON p.tenant_id=g.tenant_id AND p.id=g.project_id
    WHERE t.tenant_id=$1 AND t.id=$2 AND t.principal_id=$3 AND p.id=$4
      AND t.kind='human_admin' AND a.kind='human' AND a.state='active'
      AND t.state='active' AND t.revoked_at IS NULL
      AND t.expires_at>clock_timestamp() AND t.idle_expires_at>clock_timestamp()
      AND (t.project_id IS NULL OR t.project_id=p.id)
      AND g.state='active' AND g.role='owner' AND p.state='active' AND p.policy_state<>'blocked'
    FOR SHARE OF t,a,g,p`, [call.scope.tenantId, call.tokenId, call.scope.principalId, projectId]);
  if (rows.length !== 1) throw new ThreadlineError('scope_denied', 'Current human project owner authority is required.');
}

export function createAccessService(deps: { db: SqlDatabase; admission: AdmissionService }): AccessService {
  const read = async (tx: TxClient, tenantId: string, projectId: string, id: string) => {
    const rows = await tx.rows<CredentialRow>(`${SELECT_METADATA}
      WHERE r.tenant_id=$1 AND r.project_id=$2 AND r.credential_id=$3`, [tenantId, projectId, id]);
    if (rows[0] === undefined) throw new ThreadlineError('not_found', 'No such reader credential exists in this project.');
    return rows[0];
  };
  return {
    async issue(call, projectId, input) {
      parseContract(uuidSchema, projectId, 'project identity');
      requirePermission(call, 'access.admin');
      requireProjectScope(call, projectId);
      const parsed = parseContract(issueReaderCredentialInputSchema, input, 'reader credential issuance');
      const ticket = await deps.admission.check(call, 'reader.issue', parsed);
      const keyDigest = sha256Hex(parsed.idempotencyKey);
      const digest = canonicalDigest({ label: parsed.label, lifetimeSeconds: parsed.lifetimeSeconds });
      return withProjectWriteLock(deps.db, call.scope.tenantId, projectId, async (tx) => {
        await deps.admission.revalidate(ticket, tx);
        await tx.rows('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
          [`reader-issuance:${call.scope.tenantId}:${projectId}:${call.scope.principalId}:${keyDigest}`]);
        await authorizeProjectOwner(tx, call, projectId);
        const existing = await tx.rows<CredentialRow>(`${SELECT_METADATA}
          WHERE r.tenant_id=$1 AND r.project_id=$2 AND r.issued_by=$3 AND r.issuance_key_digest=$4`,
        [call.scope.tenantId, projectId, call.scope.principalId, keyDigest]);
        if (existing[0] !== undefined) {
          if (existing[0].request_digest !== digest) throw new ThreadlineError('idempotency_mismatch', 'This issuance key names a different request.');
          return { secretDelivery: 'not_repeated', credential: metadata(existing[0]) };
        }
        const principalId = randomUUID();
        const credentialId = randomUUID();
        const bearer = generateClientToken();
        await tx.rows(`INSERT INTO threadline_memory.principals (tenant_id,id,kind,display_label)
          VALUES ($1,$2,'service',$3)`, [call.scope.tenantId, principalId, parsed.label]);
        await tx.rows(`INSERT INTO threadline_memory.project_grants (tenant_id,project_id,id,principal_id,role)
          VALUES ($1,$2,$3,$4,'reader')`, [call.scope.tenantId, projectId, randomUUID(), principalId]);
        // No sliding idle renewal: idle and absolute expiry are the same deadline.
        await tx.rows(`INSERT INTO threadline_memory.client_tokens
          (tenant_id,id,principal_id,project_id,kind,token_hash,created_at,expires_at,idle_expires_at)
          SELECT $1,$2,$3,$4,'reader',$5,instant,instant + $6 * interval '1 second',instant + $6 * interval '1 second'
          FROM (SELECT clock_timestamp() AS instant) n`,
        [call.scope.tenantId, credentialId, principalId, projectId, hashClientToken(bearer), parsed.lifetimeSeconds]);
        await tx.rows(`INSERT INTO threadline_memory.reader_credentials
          (tenant_id,project_id,credential_id,principal_id,issued_by,issuance_key_digest,request_digest,label)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [call.scope.tenantId, projectId, credentialId, principalId, call.scope.principalId, keyDigest, digest, parsed.label]);
        return { secretDelivery: 'initial', credential: metadata(await read(tx, call.scope.tenantId, projectId, credentialId)), bearer };
      });
    },
    async list(call, projectId, limit = 50) {
      parseContract(uuidSchema, projectId, 'project identity');
      if (!Number.isInteger(limit) || limit < 1 || limit > READER_LIST_MAX) throw new ThreadlineError('invalid_request', 'Reader metadata limit must be 1 through 100.');
      return withProjectWriteLock(deps.db, call.scope.tenantId, projectId, async (tx) => {
        await authorizeProjectOwner(tx, call, projectId);
        const rows = await tx.rows<CredentialRow>(`${SELECT_METADATA}
          WHERE r.tenant_id=$1 AND r.project_id=$2 ORDER BY t.created_at DESC,r.credential_id DESC LIMIT $3`,
        [call.scope.tenantId, projectId, limit + 1]);
        return { credentials: rows.slice(0, limit).map(metadata), hasMore: rows.length > limit };
      });
    },
    async revoke(call, projectId, credentialId) {
      parseContract(uuidSchema, projectId, 'project identity');
      parseContract(uuidSchema, credentialId, 'credential identity');
      return withProjectWriteLock(deps.db, call.scope.tenantId, projectId, async (tx) => {
        await authorizeProjectOwner(tx, call, projectId);
        const row = await read(tx, call.scope.tenantId, projectId, credentialId);
        await tx.rows(`UPDATE threadline_memory.client_tokens SET state='revoked',revoked_at=clock_timestamp(),revision=revision+1
          WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND kind='reader' AND state='active'`,
        [call.scope.tenantId, projectId, credentialId]);
        await tx.rows(`UPDATE threadline_memory.project_grants SET state='revoked',revoked_at=clock_timestamp(),grant_revision=grant_revision+1
          WHERE tenant_id=$1 AND project_id=$2 AND principal_id=$3 AND state='active'`,
        [call.scope.tenantId, projectId, row.principal_id]);
        await tx.rows(`UPDATE threadline_memory.principals SET state='revoked'
          WHERE tenant_id=$1 AND id=$2 AND kind='service' AND state='active'`, [call.scope.tenantId, row.principal_id]);
        return metadata(await read(tx, call.scope.tenantId, projectId, credentialId));
      });
    },
  };
}
