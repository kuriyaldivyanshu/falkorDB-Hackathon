import {
  CAPABILITY_SCHEMA_VERSION,
  PROTOCOL_VERSION,
  ThreadlineError,
  type CapabilityReport,
  type OperationCapability,
  type OperationId,
} from '@threadline/shared';

import { THREADLINE_BACKEND_VERSION } from './version.js';

/**
 * What this build actually supports.
 *
 * Capability output is generated from one table so a command cannot exist in
 * help text while its handler is missing. Every entry that is not supported
 * says so explicitly, with the milestone that unblocks it; nothing here reports
 * success it cannot produce.
 */

export const SUPPORTED_OPERATION_IDS: readonly OperationId[] = [
  'service.status',
  'project.list',
  'project.add',
  'project.grant.list',
  'source.append',
  'source.inspect',
  'source.read',
  'history.page',
  'operation.inspect',
  'memory.query',
  'memory.propose',
  'memory.accept',
  'memory.correct',
  'memory.episode.record',
  'task.create',
  'task.require',
];

interface OperationDefinition {
  readonly summary: string;
  readonly effect: 'read' | 'write' | 'admin';
  readonly scope: 'human' | 'producer' | 'both';
  /** Why it is unavailable; only the unimplemented entries carry this. */
  readonly unavailable?: string;
}

const OPERATION_TABLE: Readonly<Record<OperationId, OperationDefinition>> = {
  'service.status': { summary: 'Health, readiness and storage state of this service.', effect: 'read', scope: 'both' },
  'project.list': { summary: 'List projects the credential holds an active grant for.', effect: 'read', scope: 'both' },
  'project.add': {
    summary: 'Explicitly associate a workspace root with a new or existing project.',
    effect: 'admin',
    scope: 'human',
  },
  'project.grant.list': { summary: 'List grants for one project.', effect: 'read', scope: 'human' },
  'session.register': {
    summary: 'Register one native session against an enrollment and binding.',
    effect: 'write',
    scope: 'producer',
    unavailable: 'Native enrollment and session identity are qualified in N03.',
  },
  'session.list': {
    summary: 'List native sessions observed for a project.',
    effect: 'read',
    scope: 'both',
    unavailable: 'Native enrollment and session identity are qualified in N03.',
  },
  'source.append': {
    summary: 'Append bounded permitted visible records as immutable sources.',
    effect: 'write',
    scope: 'both',
  },
  'source.inspect': { summary: 'Read one source catalog entry without its bytes.', effect: 'read', scope: 'both' },
  'source.read': { summary: 'Read one bounded byte range of a source.', effect: 'read', scope: 'both' },
  'history.page': { summary: 'Page through ingested sources in project order.', effect: 'read', scope: 'both' },
  'memory.query': {
    summary: 'Read current accepted memory and proposed candidates for a project or task.',
    effect: 'read',
    scope: 'both',
  },
  'memory.propose': {
    summary: 'Capture a candidate semantic or procedural memory version from cited sources.',
    effect: 'write',
    scope: 'both',
  },
  'memory.accept': {
    summary: 'Explicitly accept one proposed version as current memory as a human actor.',
    effect: 'write',
    scope: 'human',
  },
  'memory.correct': {
    summary: 'Record a human correction that supersedes the current memory version.',
    effect: 'write',
    scope: 'human',
  },
  'memory.episode.record': {
    summary: 'Record one attempted action and the outcome established for it, with server-resolved evidence precision.',
    effect: 'write',
    scope: 'both',
  },
  'memory.procedure.validate': {
    summary: 'Move a procedure from candidate to validated reuse.',
    effect: 'write',
    scope: 'human',
    unavailable:
      'Validated reuse needs a declared review plus compatible observed reuse; a human-accepted candidate is not validated reuse.',
  },
  'task.create': {
    summary: 'Create a task with a bounded title and optional family.',
    effect: 'write',
    scope: 'both',
  },
  'task.require': {
    summary: 'Bind a required memory identity to a task and resolve current requirement versions.',
    effect: 'write',
    scope: 'both',
  },
  'claim.acquire': {
    summary: 'Acquire a bounded exclusive claim over a task.',
    effect: 'write',
    scope: 'producer',
    unavailable: 'Claims and handoffs land in N04.',
  },
  'claim.release': {
    summary: 'Release a claim that this credential owns.',
    effect: 'write',
    scope: 'producer',
    unavailable: 'Claims and handoffs land in N04.',
  },
  'claim.status': {
    summary: 'Read the current claim state for a task.',
    effect: 'read',
    scope: 'both',
    unavailable: 'Claims and handoffs land in N04.',
  },
  'handoff.offer': {
    summary: 'Offer a handoff of current task authority to another session.',
    effect: 'write',
    scope: 'producer',
    unavailable: 'Claims and handoffs land in N04.',
  },
  'handoff.accept': {
    summary: 'Accept an offered handoff as the receiving human or session.',
    effect: 'write',
    scope: 'both',
    unavailable: 'Claims and handoffs land in N04.',
  },
  'handoff.revoke': {
    summary: 'Revoke an offered or accepted handoff.',
    effect: 'write',
    scope: 'human',
    unavailable: 'Claims and handoffs land in N04.',
  },
  'context.prepare': {
    summary: 'Build one bounded applicable context packet for a boundary.',
    effect: 'read',
    scope: 'producer',
    unavailable: 'Bounded context selection lands in N02C.',
  },
  'context.occurrence': {
    summary: 'Record what was actually prepared, emitted or observed.',
    effect: 'write',
    scope: 'producer',
    unavailable: 'Occurrence recording lands with the N02C context contract.',
  },
  'operation.inspect': {
    summary: 'Read one operation intent, lease, settlement and graph receipt state.',
    effect: 'read',
    scope: 'both',
  },
  'job.import': {
    summary: 'Import an explicitly selected native history selection.',
    effect: 'write',
    scope: 'human',
    unavailable: 'Selected history import lands in N05.',
  },
  'job.delete': {
    summary: 'Delete selected sources and their derived material.',
    effect: 'admin',
    scope: 'human',
    unavailable: 'Deny-first erasure lands in N05.',
  },
  'job.export': {
    summary: 'Export an explicitly selected memory bundle.',
    effect: 'read',
    scope: 'human',
    unavailable: 'Export lands in N05.',
  },
};

export function buildCapabilityReport(): CapabilityReport {
  const operations: OperationCapability[] = (Object.keys(OPERATION_TABLE) as OperationId[]).map((id) => {
    const definition = OPERATION_TABLE[id];
    const supported = SUPPORTED_OPERATION_IDS.includes(id);
    if (!supported) {
      return {
        id,
        summary: definition.summary,
        effect: definition.effect,
        scope: definition.scope,
        status: 'unavailable',
        reason: definition.unavailable ?? 'Not implemented in this build.',
      };
    }
    return {
      id,
      summary: definition.summary,
      effect: definition.effect,
      scope: definition.scope,
      status: 'supported',
      reason: null,
    };
  });

  return {
    protocolVersion: PROTOCOL_VERSION,
    schemaVersion: CAPABILITY_SCHEMA_VERSION,
    serviceVersion: THREADLINE_BACKEND_VERSION,
    operations,
    adapter: {
      harness: 'codex',
      qualifiedVersion: null,
      observedVersion: null,
      boundaries: [],
      captureCoverage: 'Native configuration and capture are not installed or qualified by this build.',
      modelMutations: false,
      detail:
        'The Codex adapter is probed in N03. Until then this service accepts human-authored and producer-recorded sources only, and no episode is admitted as observed unless a human recorded complete outcome evidence.',
    },
  };
}

/** Throws the explicit unsupported result for a route with no handler. */
export function unsupportedOperation(operationId: OperationId): ThreadlineError {
  const definition = OPERATION_TABLE[operationId];
  return new ThreadlineError(
    'unsupported',
    definition?.unavailable ?? 'This capability is not implemented in this build.',
    { operation: operationId },
  );
}
