import { randomUUID } from 'node:crypto';

import {
  ThreadlineError, parseContract, uuidSchema, enrollmentViewSchema,
  issueEnrollmentInputSchema, nativeSessionRegisterInputSchema, nativeSessionViewSchema,
  NATIVE_ACCESS_LIST_MAX,
  type EnrollmentView, type IssueEnrollmentResult, type ListEnrollmentsResult,
  type ListNativeSessionsResult, type NativeSessionView,
} from '@threadline/shared';

import { canonicalDigest, sha256Hex } from '../storage/digest.js';
import type { SqlDatabase, TxClient } from '../storage/pg.js';
import { authorizeProjectOwner } from './access.js';
import { generateClientToken, hashClientToken, type AuthenticatedCall } from './auth.js';
import { requireProducerAuthority } from './nativeAuthority.js';
import { requirePermission } from './permissions.js';
import { requireProjectScope } from './semanticSupport.js';

export interface NativeAccessService {
  issue(call: AuthenticatedCall, projectId: string, input: unknown): Promise<IssueEnrollmentResult>;
  list(call: AuthenticatedCall, projectId: string, limit?: number): Promise<ListEnrollmentsResult>;
  inspect(call: AuthenticatedCall, projectId: string, enrollmentId: string): Promise<EnrollmentView>;
  revoke(call: AuthenticatedCall, projectId: string, enrollmentId: string): Promise<EnrollmentView>;
  register(call: AuthenticatedCall, input: unknown): Promise<NativeSessionView>;
  sessions(call: AuthenticatedCall, projectId: string, limit?: number): Promise<ListNativeSessionsResult>;
}

interface EnrollmentRow {
  id: string; project_id: string; principal_id: string; binding_id: string; credential_id: string;
  label: string; binding_generation: number; native_session_id: string | null;
  state: 'active' | 'revoked' | 'expired'; created_at: Date; expires_at: Date;
  idle_expires_at: Date; revoked_at: Date | null; request_digest: string;
}
const ENROLLMENT_SELECT = `SELECT e.id,e.project_id,e.principal_id,e.binding_id,e.credential_id,
  e.label,e.binding_generation,e.native_session_id,e.created_at,e.expires_at,t.idle_expires_at,e.revoked_at,e.request_digest,
  CASE WHEN e.state<>'active' OR t.state<>'active' OR t.revoked_at IS NOT NULL OR a.state<>'active'
         OR t.kind<>'producer' OR a.kind<>'service' OR g.role<>'reader'
         OR g.state<>'active' OR b.state<>'active' OR (e.native_session_id IS NOT NULL AND s.state IS DISTINCT FROM 'active') THEN 'revoked'
       WHEN e.expires_at<=clock_timestamp() OR t.expires_at<=clock_timestamp() OR t.idle_expires_at<=clock_timestamp() THEN 'expired'
       ELSE 'active' END AS state
  FROM threadline_memory.native_enrollments e
  JOIN threadline_memory.client_tokens t ON t.tenant_id=e.tenant_id AND t.id=e.credential_id
  JOIN threadline_memory.principals a ON a.tenant_id=e.tenant_id AND a.id=e.principal_id
  JOIN threadline_memory.project_grants g ON g.tenant_id=e.tenant_id AND g.project_id=e.project_id AND g.principal_id=e.principal_id
  JOIN threadline_memory.workspace_bindings b ON b.tenant_id=e.tenant_id AND b.project_id=e.project_id AND b.id=e.binding_id
  LEFT JOIN threadline_memory.native_sessions s ON s.tenant_id=e.tenant_id AND s.project_id=e.project_id AND s.id=e.native_session_id`;

function enrollment(row: EnrollmentRow): EnrollmentView {
  return parseContract(enrollmentViewSchema, {
    enrollmentId: row.id, projectId: row.project_id, principalId: row.principal_id,
    bindingId: row.binding_id, credentialId: row.credential_id, label: row.label,
    bindingGeneration: row.binding_generation, nativeSessionId: row.native_session_id,
    harness: 'codex', state: row.state, createdAtMs: row.created_at.getTime(),
    expiresAtMs: row.expires_at.getTime(), idleExpiresAtMs: row.idle_expires_at.getTime(),
    revokedAtMs: row.revoked_at?.getTime() ?? null,
  }, 'native enrollment metadata');
}
interface SessionRow {
  id: string; project_id: string; binding_id: string; enrollment_id: string; binding_generation: number;
  harness: string; harness_version: string; native_thread_ref: string | null; parent_thread_ref: string | null;
  identity_precision: string; capture_coverage: string; state: string; first_seen_at: Date; last_seen_at: Date;
  registration_key_digest: string; registration_digest: string;
}
function session(row: SessionRow): NativeSessionView {
  return parseContract(nativeSessionViewSchema, {
    nativeSessionId: row.id, projectId: row.project_id, bindingId: row.binding_id,
    enrollmentId: row.enrollment_id, bindingGeneration: row.binding_generation,
    harness: row.harness, harnessVersion: row.harness_version, nativeThreadRef: row.native_thread_ref,
    parentThreadRef: row.parent_thread_ref, identityPrecision: row.identity_precision,
    captureCoverage: row.capture_coverage, state: row.state,
    createdAtMs: row.first_seen_at.getTime(), lastSeenAtMs: row.last_seen_at.getTime(),
  }, 'native session metadata');
}
function checkLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > NATIVE_ACCESS_LIST_MAX) {
    throw new ThreadlineError('invalid_request', 'Native metadata limit must be 1 through 100.');
  }
}
export function createNativeAccessService(deps: { db: SqlDatabase }): NativeAccessService {
  const read = async (tx: TxClient, call: AuthenticatedCall, projectId: string, id: string) => {
    const rows = await tx.rows<EnrollmentRow>(`${ENROLLMENT_SELECT}
      WHERE e.tenant_id=$1 AND e.project_id=$2 AND e.id=$3`, [call.scope.tenantId, projectId, id]);
    if (rows[0] === undefined) throw new ThreadlineError('not_found', 'No such enrollment exists in this project.');
    return rows[0];
  };
  return {
    async issue(call, projectId, input) {
      parseContract(uuidSchema, projectId, 'project identity');
      requirePermission(call, 'access.admin');
      const parsed = parseContract(issueEnrollmentInputSchema, input, 'native enrollment issuance');
      const key = sha256Hex(parsed.idempotencyKey);
      const digest = canonicalDigest({ bindingId: parsed.bindingId, label: parsed.label, lifetimeSeconds: parsed.lifetimeSeconds });
      return deps.db.withTenantTransaction(call.scope.tenantId, async (tx) => {
        await tx.rows('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
          [`native-issuance:${call.scope.tenantId}:${projectId}:${call.scope.principalId}:${key}`]);
        await authorizeProjectOwner(tx, call, projectId);
        const known = await tx.rows<EnrollmentRow>(`${ENROLLMENT_SELECT}
          WHERE e.tenant_id=$1 AND e.project_id=$2 AND e.issued_by=$3 AND e.issuance_key_digest=$4`,
        [call.scope.tenantId, projectId, call.scope.principalId, key]);
        if (known[0] !== undefined) {
          if (known[0].request_digest !== digest) throw new ThreadlineError('idempotency_mismatch', 'This issuance key names another request.');
          return { secretDelivery: 'not_repeated', enrollment: enrollment(known[0]) };
        }
        const bindings = await tx.rows(`SELECT id FROM threadline_memory.workspace_bindings
          WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND state='active' FOR SHARE`,
        [call.scope.tenantId, projectId, parsed.bindingId]);
        if (bindings.length !== 1) throw new ThreadlineError('scope_denied', 'Select an existing active workspace binding in this project.');
        const id = randomUUID(), principalId = randomUUID(), credentialId = randomUUID();
        const bearer = generateClientToken();
        await tx.rows(`INSERT INTO threadline_memory.principals (tenant_id,id,kind,display_label)
          VALUES ($1,$2,'service',$3)`, [call.scope.tenantId, principalId, parsed.label]);
        await tx.rows(`INSERT INTO threadline_memory.project_grants (tenant_id,project_id,id,principal_id,role)
          VALUES ($1,$2,$3,$4,'reader')`, [call.scope.tenantId, projectId, randomUUID(), principalId]);
        await tx.rows(`INSERT INTO threadline_memory.native_enrollments
          (tenant_id,project_id,id,principal_id,binding_id,credential_id,label,issued_by,issuance_key_digest,request_digest,created_at,expires_at)
          SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,instant,instant+$11*interval '1 second'
          FROM (SELECT clock_timestamp() AS instant) n`,
        [call.scope.tenantId, projectId, id, principalId, parsed.bindingId, credentialId, parsed.label,
          call.scope.principalId, key, digest, parsed.lifetimeSeconds]);
        await tx.rows(`INSERT INTO threadline_memory.client_tokens
          (tenant_id,project_id,id,principal_id,kind,token_hash,enrollment_id,binding_generation,created_at,expires_at,idle_expires_at)
          SELECT tenant_id,project_id,credential_id,principal_id,'producer',$4,id,1,created_at,expires_at,expires_at
          FROM threadline_memory.native_enrollments WHERE tenant_id=$1 AND project_id=$2 AND id=$3`,
        [call.scope.tenantId, projectId, id, hashClientToken(bearer)]);
        return { secretDelivery: 'initial', enrollment: enrollment(await read(tx, call, projectId, id)), bearer };
      });
    },
    async list(call, projectId, limit = 50) {
      parseContract(uuidSchema, projectId, 'project identity');
      requirePermission(call, 'access.admin');
      checkLimit(limit);
      return deps.db.withTenantTransaction(call.scope.tenantId, async (tx) => {
        await authorizeProjectOwner(tx, call, projectId);
        const rows = await tx.rows<EnrollmentRow>(`${ENROLLMENT_SELECT}
          WHERE e.tenant_id=$1 AND e.project_id=$2 ORDER BY e.created_at DESC,e.id DESC LIMIT $3`,
        [call.scope.tenantId, projectId, limit + 1]);
        return { enrollments: rows.slice(0, limit).map(enrollment), hasMore: rows.length > limit };
      });
    },
    async inspect(call, projectId, id) {
      parseContract(uuidSchema, projectId, 'project identity');
      parseContract(uuidSchema, id, 'enrollment identity');
      requireProjectScope(call, projectId);
      requirePermission(call, 'native.inspect');
      return deps.db.withTenantTransaction(call.scope.tenantId, async (tx) => {
        if (call.scope.tokenKind === 'producer') {
          if (call.enrollmentId !== id) throw new ThreadlineError('scope_denied', 'A producer may inspect only its own enrollment.');
          await requireProducerAuthority(tx, call);
        } else await authorizeProjectOwner(tx, call, projectId);
        return enrollment(await read(tx, call, projectId, id));
      });
    },
    async revoke(call, projectId, id) {
      parseContract(uuidSchema, projectId, 'project identity');
      parseContract(uuidSchema, id, 'enrollment identity');
      requirePermission(call, 'access.admin');
      return deps.db.withTenantTransaction(call.scope.tenantId, async (tx) => {
        await authorizeProjectOwner(tx, call, projectId);
        await tx.rows(`SELECT id FROM threadline_memory.native_enrollments
          WHERE tenant_id=$1 AND project_id=$2 AND id=$3 FOR UPDATE`, [call.scope.tenantId, projectId, id]);
        const row = await read(tx, call, projectId, id);
        await tx.rows(`UPDATE threadline_memory.native_enrollments SET state='revoked',revoked_at=clock_timestamp()
          WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND state='active'`, [call.scope.tenantId, projectId, id]);
        await tx.rows(`UPDATE threadline_memory.client_tokens SET state='revoked',revoked_at=clock_timestamp(),revision=revision+1
          WHERE tenant_id=$1 AND id=$2 AND state='active'`, [call.scope.tenantId, row.credential_id]);
        await tx.rows(`UPDATE threadline_memory.native_sessions SET state='closed'
          WHERE tenant_id=$1 AND project_id=$2 AND enrollment_id=$3 AND state='active'`, [call.scope.tenantId, projectId, id]);
        await tx.rows(`UPDATE threadline_memory.project_grants SET state='revoked',revoked_at=clock_timestamp(),grant_revision=grant_revision+1
          WHERE tenant_id=$1 AND project_id=$2 AND principal_id=$3 AND state='active'`, [call.scope.tenantId, projectId, row.principal_id]);
        await tx.rows(`UPDATE threadline_memory.principals SET state='revoked'
          WHERE tenant_id=$1 AND id=$2 AND state='active'`, [call.scope.tenantId, row.principal_id]);
        return enrollment(await read(tx, call, projectId, id));
      });
    },
    async register(call, input) {
      requirePermission(call, 'native.register');
      const parsed = parseContract(nativeSessionRegisterInputSchema, input, 'native session registration');
      const projectId = call.scope.projectId!;
      const key = sha256Hex(parsed.idempotencyKey);
      const { idempotencyKey: _key, adapterInstanceNonce, ...hints } = parsed;
      const fingerprint = canonicalDigest({ tenantId: call.scope.tenantId, projectId,
        enrollmentId: call.enrollmentId, generation: parsed.expectedBindingGeneration, nonce: adapterInstanceNonce });
      const digest = canonicalDigest({ ...hints, instanceFingerprint: fingerprint });
      return deps.db.withTenantTransaction(call.scope.tenantId, async (tx) => {
        // Enrollment row is the serialization point for both pin and revocation.
        const rows = await tx.rows<{ native_session_id: string | null; binding_id: string; binding_generation: number }>(
          `SELECT native_session_id,binding_id,binding_generation FROM threadline_memory.native_enrollments
           WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND credential_id=$4 AND principal_id=$5 FOR UPDATE`,
          [call.scope.tenantId, projectId, call.enrollmentId, call.tokenId, call.scope.principalId]);
        const row = rows[0];
        if (row === undefined) throw new ThreadlineError('scope_denied', 'No enrollment belongs to this credential.');
        // Retain current token/principal/grant/binding facts through pin commit.
        await tx.rows(`SELECT t.id FROM threadline_memory.client_tokens t
          JOIN threadline_memory.principals a ON a.tenant_id=t.tenant_id AND a.id=t.principal_id
          JOIN threadline_memory.project_grants g ON g.tenant_id=t.tenant_id AND g.project_id=t.project_id AND g.principal_id=t.principal_id
          JOIN threadline_memory.projects p ON p.tenant_id=t.tenant_id AND p.id=t.project_id
          JOIN threadline_memory.workspace_bindings b ON b.tenant_id=t.tenant_id AND b.project_id=t.project_id AND b.id=$3
          WHERE t.tenant_id=$1 AND t.id=$2 FOR SHARE OF t,a,g,p,b`, [call.scope.tenantId, call.tokenId, row.binding_id]);
        const current = { ...call, scope: { ...call.scope, nativeSessionId: row.native_session_id } };
        await requireProducerAuthority(tx, current);
        if (parsed.expectedBindingGeneration !== row.binding_generation) throw new ThreadlineError('stale_revision', 'The expected enrollment generation does not match.');
        if (row.native_session_id !== null) {
          const known = await tx.rows<SessionRow>(`SELECT * FROM threadline_memory.native_sessions
            WHERE tenant_id=$1 AND project_id=$2 AND id=$3`, [call.scope.tenantId, projectId, row.native_session_id]);
          const pinned = known[0]!;
          if (pinned.registration_key_digest !== key) throw new ThreadlineError('authority_conflict', 'This enrollment is already pinned; revoke and issue a fresh enrollment to replace it.');
          if (pinned.registration_digest !== digest) throw new ThreadlineError('idempotency_mismatch', 'This registration key names a different instance or request.');
          const result = session(pinned);
          await requireProducerAuthority(tx, current);
          return result;
        }
        const id = randomUUID();
        const inserted = await tx.rows<SessionRow>(`INSERT INTO threadline_memory.native_sessions
          (tenant_id,project_id,id,enrollment_id,binding_id,binding_generation,principal_id,harness,harness_version,
           native_thread_ref,parent_thread_ref,instance_fingerprint,identity_precision,capture_coverage,registration_key_digest,registration_digest)
          VALUES ($1,$2,$3,$4,$5,1,$6,'codex',$7,$8,$9,$10,'provisional','unknown',$11,$12) RETURNING *`,
        [call.scope.tenantId, projectId, id, call.enrollmentId, row.binding_id, call.scope.principalId,
          parsed.harnessVersion, parsed.nativeThreadRef, parsed.parentThreadRef, fingerprint, key, digest]);
        const pinned = await tx.rows(`UPDATE threadline_memory.native_enrollments SET native_session_id=$4
          WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND native_session_id IS NULL AND binding_generation=$5 RETURNING id`,
        [call.scope.tenantId, projectId, call.enrollmentId, id, parsed.expectedBindingGeneration]);
        if (pinned.length !== 1) throw new ThreadlineError('authority_conflict', 'Another registration pinned this enrollment.');
        await tx.rows(`UPDATE threadline_memory.client_tokens SET native_session_id=$3,revision=revision+1
          WHERE tenant_id=$1 AND id=$2`, [call.scope.tenantId, call.tokenId, id]);
        await requireProducerAuthority(tx, { ...current, scope: { ...current.scope, nativeSessionId: id } });
        return session(inserted[0]!);
      });
    },
    async sessions(call, projectId, limit = 50) {
      parseContract(uuidSchema, projectId, 'project identity');
      requireProjectScope(call, projectId);
      requirePermission(call, 'native.sessions');
      checkLimit(limit);
      return deps.db.withTenantTransaction(call.scope.tenantId, async (tx) => {
        if (call.scope.tokenKind === 'producer') await requireProducerAuthority(tx, call);
        else await authorizeProjectOwner(tx, call, projectId);
        const rows = await tx.rows<SessionRow>(`SELECT * FROM threadline_memory.native_sessions
          WHERE tenant_id=$1 AND project_id=$2 AND ($3::uuid IS NULL OR (enrollment_id=$3 AND principal_id=$4))
          ORDER BY first_seen_at DESC,id DESC LIMIT $5`,
        [call.scope.tenantId, projectId, call.scope.tokenKind === 'producer' ? call.enrollmentId : null, call.scope.principalId, limit + 1]);
        return { sessions: rows.slice(0, limit).map(session), hasMore: rows.length > limit };
      });
    },
  };
}
