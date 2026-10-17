import { randomUUID } from 'node:crypto';
import { chmodSync, closeSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

import { ThreadlineError } from '@threadline/shared';

import type { Logger } from '../log.js';
import { silentLogger } from '../log.js';
import type { SqlDatabase } from '../storage/pg.js';
import {
  createAuthService,
  generateClientToken,
  hashClientToken,
  HUMAN_ADMIN_IDLE_MS,
  HUMAN_ADMIN_TOKEN_TTL_MS,
} from './auth.js';

/**
 * Local owner identity.
 *
 * A fresh installation has no rows yet, so the first identity cannot be looked
 * up: it is created together with its tenant inside one tenant-fenced
 * transaction (the fence context is the new tenant's own id). The credential is
 * written to an owner-only file in the installation root; the plaintext token
 * never appears in SQL, logs or configuration summaries.
 */

export interface LocalCredentialFile {
  readonly version: 1;
  readonly tenantId: string;
  readonly principalId: string;
  readonly tokenId: string;
  readonly token: string;
  readonly kind: 'human_admin';
  readonly createdAtMs: number;
}

export function readCredentialFile(path: string): LocalCredentialFile | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const candidate = parsed as Record<string, unknown>;
    if (
      candidate.version !== 1 ||
      typeof candidate.tenantId !== 'string' ||
      typeof candidate.principalId !== 'string' ||
      typeof candidate.tokenId !== 'string' ||
      typeof candidate.token !== 'string' ||
      candidate.kind !== 'human_admin'
    ) {
      return null;
    }
    return {
      version: 1,
      tenantId: candidate.tenantId,
      principalId: candidate.principalId,
      tokenId: candidate.tokenId,
      token: candidate.token,
      kind: 'human_admin',
      createdAtMs: typeof candidate.createdAtMs === 'number' ? candidate.createdAtMs : 0,
    };
  } catch {
    return null;
  }
}

export function writeCredentialFile(path: string, credential: LocalCredentialFile): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const descriptor = openSync(path, 'w', 0o600);
  try {
    writeSync(descriptor, `${JSON.stringify(credential, null, 2)}\n`);
  } finally {
    closeSync(descriptor);
  }
  chmodSync(path, 0o600);
}

export interface BootstrapDeps {
  readonly db: SqlDatabase;
  readonly credentialPath: string;
  readonly ownerLabel: string;
  readonly clock?: () => Date;
  readonly logger?: Logger;
}

export interface BootstrapResult {
  readonly credential: LocalCredentialFile;
  /** False when an existing valid credential was reused unchanged. */
  readonly created: boolean;
}

export async function bootstrapLocalOwner(deps: BootstrapDeps): Promise<BootstrapResult> {
  const logger = deps.logger ?? silentLogger;
  const clock = deps.clock ?? (() => new Date());
  const existing = readCredentialFile(deps.credentialPath);

  if (existing !== null) {
    const auth = createAuthService({ db: deps.db, clock, logger });
    try {
      await auth.authenticate(`Bearer ${existing.token}`, { allowTenantLevel: true });
      return { credential: existing, created: false };
    } catch (error) {
      // A revoked or expired local credential is replaced, never resurrected:
      // the old token row stays revoked and a new token is issued for the same
      // owner principal.
      if (!(error instanceof ThreadlineError) || error.code !== 'unauthorized') {
        throw error;
      }
      const reissued = await issueTokenForExistingOwner(deps, existing, clock());
      writeCredentialFile(deps.credentialPath, reissued);
      logger.log({ level: 'warn', message: 'Reissued the local owner credential.', fields: { principalId: reissued.principalId } });
      return { credential: reissued, created: true };
    }
  }

  const tenantId = randomUUID();
  const principalId = randomUUID();
  const token = generateClientToken();
  const tokenId = randomUUID();
  const now = clock();

  await deps.db.withTenantTransaction(tenantId, async (tx) => {
    await tx.rows(
      `INSERT INTO threadline_memory.tenants (id, label, state, created_at)
       VALUES ($1, $2, 'active', $3)`,
      [tenantId, deps.ownerLabel, now],
    );
    await tx.rows(
      `INSERT INTO threadline_memory.principals
         (tenant_id, id, kind, display_label, local_identity_ref, state, created_at)
       VALUES ($1, $2, 'human', $3, 'local-owner', 'active', $4)`,
      [tenantId, principalId, deps.ownerLabel, now],
    );
  });

  const credential = await createOwnerToken(deps.db, { tenantId, principalId, now, token, tokenId });
  writeCredentialFile(deps.credentialPath, credential);
  logger.log({
    level: 'info',
    message: 'Created the local owner identity.',
    fields: { tenantId, principalId },
  });
  return { credential, created: true };
}

/** A new credential for an owner that already exists: no tenant is created. */
async function issueTokenForExistingOwner(
  deps: BootstrapDeps,
  existing: LocalCredentialFile,
  now: Date,
): Promise<LocalCredentialFile> {
  const token = generateClientToken();
  const tokenId = randomUUID();
  return createOwnerToken(deps.db, {
    tenantId: existing.tenantId,
    principalId: existing.principalId,
    now,
    token,
    tokenId,
  });
}

async function createOwnerToken(
  db: SqlDatabase,
  input: { tenantId: string; principalId: string; now: Date; token: string; tokenId: string },
): Promise<LocalCredentialFile> {
  const expiresAt = new Date(input.now.getTime() + HUMAN_ADMIN_TOKEN_TTL_MS);
  const idleExpiresAt = new Date(input.now.getTime() + HUMAN_ADMIN_IDLE_MS);
  await db.withTenantTransaction(input.tenantId, (tx) =>
    tx.rows(
      `INSERT INTO threadline_memory.client_tokens
         (tenant_id, id, principal_id, project_id, kind, token_hash, scopes,
          binding_generation, state, revision, created_at, expires_at, idle_expires_at)
       VALUES ($1, $2, $3, NULL, 'human_admin', $4, ARRAY['admin','producer'],
               0, 'active', 0, $5, $6, $7)`,
      [input.tenantId, input.tokenId, input.principalId, hashClientToken(input.token), input.now, expiresAt, idleExpiresAt],
    ),
  );
  return {
    version: 1,
    tenantId: input.tenantId,
    principalId: input.principalId,
    tokenId: input.tokenId,
    token: input.token,
    kind: 'human_admin',
    createdAtMs: input.now.getTime(),
  };
}
