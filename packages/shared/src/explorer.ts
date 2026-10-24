import { z } from 'zod';

import { projectProjectionV3Schema, readReleaseV3Schema } from './access.js';
import { MEMORY_KINDS_V3, memoryRecordV3Schema, memoryVersionRefV3Schema } from './memory.js';
import { CONTRACT_PROTOCOL_VERSION_V3, serializeSuccessEnvelopeV3 } from './protocol.js';
import { byteBoundedText, decimalStringSchema, isoInstantSchema, sha256HexSchema, utf8ByteLength, uuidSchema } from './validation.js';

export const EXPLORER_LIMITS_V3 = {
  defaultPage: 25, maxPage: 100, maxNodes: 100, maxEdges: 200,
  maxSeeds: 16, hops: 1, cursorLifetimeMs: 600_000,
  maxEnvelopeBytes: 65_536,
} as const;

/** AND between fields, OR within a field. Labels never establish authority;
 * inferred matches remain labelled and may be excluded. No implicit task. */
export const memoryFiltersV3Schema = z.strictObject({
  projectId: uuidSchema,
  session: z.array(byteBoundedText(256)).max(16).default([]),
  agent: z.array(byteBoundedText(256)).max(16).default([]),
  task: z.array(uuidSchema).max(16).default([]),
  topic: z.array(byteBoundedText(256)).max(16).default([]),
  ticket: z.array(byteBoundedText(256)).max(16).default([]),
  feature: z.array(byteBoundedText(256)).max(16).default([]),
  tag: z.array(byteBoundedText(256)).max(16).default([]),
  kinds: z.array(z.enum(MEMORY_KINDS_V3)).max(MEMORY_KINDS_V3.length).default([]),
  dateFrom: isoInstantSchema.nullable().default(null),
  dateTo: isoInstantSchema.nullable().default(null),
  includeInferred: z.boolean().default(false),
}).refine((v) => v.dateFrom === null || v.dateTo === null ||
  Date.parse(v.dateFrom) <= Date.parse(v.dateTo), 'Date range must be ordered.');
export type MemoryFiltersV3 = z.infer<typeof memoryFiltersV3Schema>;

/** Opaque authenticated token only. A syntactically valid token is not an
 * authenticated cursor. Verify its MAC/signature and expiry before using claims. */
export const explorerCursorV3Schema = z.string().min(32).max(2048).regex(/^[A-Za-z0-9_-]+$/);
export type ExplorerCursorV3 = z.infer<typeof explorerCursorV3Schema>;
const explorerCursorContentV3Schema = z.strictObject({
  protocolVersion: z.literal(CONTRACT_PROTOCOL_VERSION_V3),
  principalId: uuidSchema, tenantId: uuidSchema,
  surface: z.enum(['list', 'neighborhood', 'timeline', 'history']),
  projection: projectProjectionV3Schema,
  normalizedFilterDigest: sha256HexSchema,
  selectionDigest: sha256HexSchema,
  sort: z.enum(['date_id_asc', 'date_id_desc', 'event_id_asc', 'event_id_desc']),
  lastKey: z.strictObject({ position: z.union([isoInstantSchema, decimalStringSchema]), id: uuidSchema }),
  issuedAt: isoInstantSchema, expiresAt: isoInstantSchema,
});
export const explorerCursorClaimsV3Schema = explorerCursorContentV3Schema.refine((v) => {
  const lifetime = Date.parse(v.expiresAt) - Date.parse(v.issuedAt);
  const eventSort = v.sort.startsWith('event_');
  const eventSurface = v.surface === 'timeline' || v.surface === 'history';
  return lifetime > 0 && lifetime <= EXPLORER_LIMITS_V3.cursorLifetimeMs &&
    eventSort === eventSurface &&
    (eventSort ? decimalStringSchema.safeParse(v.lastKey.position).success : isoInstantSchema.safeParse(v.lastKey.position).success);
}, 'Cursor requires a matching surface/sort key and a positive lifetime of at most ten minutes.');
export type ExplorerCursorClaimsV3 = z.infer<typeof explorerCursorClaimsV3Schema>;

/** Compare only after cursor authentication. Head/generation/filter/scope
 * changes require resync, including for immutable history; never widen scope. */
export const explorerCursorContinuationV3Schema = z.strictObject({
  cursor: explorerCursorClaimsV3Schema,
  current: explorerCursorContentV3Schema.omit({ lastKey: true, issuedAt: true, expiresAt: true }),
  now: isoInstantSchema,
}).refine((v) => Date.parse(v.now) >= Date.parse(v.cursor.issuedAt) &&
  Date.parse(v.now) < Date.parse(v.cursor.expiresAt), 'Cursor expired; resync_required.')
  .refine((v) => {
    const { lastKey: _key, issuedAt: _issued, expiresAt: _expires, ...binding } = v.cursor;
    return JSON.stringify(binding) === JSON.stringify(v.current);
  }, 'Cursor scope or snapshot changed; resync_required.');
export type ExplorerCursorContinuationV3 = z.infer<typeof explorerCursorContinuationV3Schema>;

const explorerQueryBaseV3Schema = z.strictObject({
  protocolVersion: z.literal(CONTRACT_PROTOCOL_VERSION_V3),
  filters: memoryFiltersV3Schema,
  cursor: explorerCursorV3Schema.nullable().default(null),
  limit: z.number().int().min(1).max(EXPLORER_LIMITS_V3.maxPage).default(EXPLORER_LIMITS_V3.defaultPage),
});
export const memoryListV3Schema = explorerQueryBaseV3Schema.extend({
  sort: z.enum(['date_id_asc', 'date_id_desc']).default('date_id_desc'),
});
export type MemoryListV3 = z.infer<typeof memoryListV3Schema>;
export const memoryNeighborhoodV3Schema = explorerQueryBaseV3Schema.extend({
  seedMemoryIds: z.array(uuidSchema).min(1).max(EXPLORER_LIMITS_V3.maxSeeds)
    .refine((ids) => new Set(ids).size === ids.length, 'Seeds must be unique.'),
  hops: z.literal(1).default(1),
  maxNodes: z.number().int().min(1).max(EXPLORER_LIMITS_V3.maxNodes).default(100),
  maxEdges: z.number().int().min(1).max(EXPLORER_LIMITS_V3.maxEdges).default(200),
});
export type MemoryNeighborhoodV3 = z.infer<typeof memoryNeighborhoodV3Schema>;
export const memoryTimelineV3Schema = explorerQueryBaseV3Schema.extend({
  sort: z.enum(['event_id_asc', 'event_id_desc']).default('event_id_desc'),
});
export type MemoryTimelineV3 = z.infer<typeof memoryTimelineV3Schema>;
export const memoryHistoryV3Schema = memoryTimelineV3Schema.extend({ memoryId: uuidSchema });
export type MemoryHistoryV3 = z.infer<typeof memoryHistoryV3Schema>;

export const memoryHistoryEventV3Schema = z.strictObject({
  eventId: uuidSchema, at: isoInstantSchema, memory: memoryVersionRefV3Schema,
  kind: z.enum(['proposed', 'accepted', 'corrected', 'superseded', 'invalidated',
    'retracted', 'stale_flagged', 'stale_cleared', 'pinned', 'unpinned',
    'conflict_opened', 'conflict_resolved', 'shared', 'denied', 'deleted']),
  availability: z.enum(['current', 'superseded', 'unavailable', 'redacted', 'conflict']),
  detail: byteBoundedText(512).nullable(),
});
export type MemoryHistoryEventV3 = z.infer<typeof memoryHistoryEventV3Schema>;
export const memoryEdgeV3Schema = z.strictObject({
  edgeId: uuidSchema, fromMemoryId: uuidSchema, toMemoryId: uuidSchema,
  relation: z.enum(['supports', 'corrects', 'supersedes', 'conflicts', 'related', 'handoff']),
});
export type MemoryEdgeV3 = z.infer<typeof memoryEdgeV3Schema>;

/** Current release is mandatory even for historical rows and hidden totals
 * are never supplied. Every endpoint, metadata and count requires the same gate. */
export const explorerPageV3Schema = z.strictObject({
  protocolVersion: z.literal(CONTRACT_PROTOCOL_VERSION_V3),
  surface: z.enum(['list', 'neighborhood', 'timeline', 'history']),
  release: readReleaseV3Schema,
  filters: memoryFiltersV3Schema,
  seedMemoryIds: z.array(uuidSchema).max(EXPLORER_LIMITS_V3.maxSeeds).default([]),
  historyMemoryId: uuidSchema.nullable().default(null),
  memories: z.array(memoryRecordV3Schema).max(EXPLORER_LIMITS_V3.maxNodes),
  edges: z.array(memoryEdgeV3Schema).max(EXPLORER_LIMITS_V3.maxEdges),
  events: z.array(memoryHistoryEventV3Schema).max(EXPLORER_LIMITS_V3.maxPage),
  hasMore: z.boolean(), nextCursor: explorerCursorV3Schema.nullable(),
}).superRefine((v, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  const projectId = v.release.projection.projectId;
  if (v.filters.projectId !== projectId || v.memories.some((m) => m.projectId !== projectId)) issue('Page project scope mismatch.');
  if (v.hasMore !== (v.nextCursor !== null)) issue('Continuation must match hasMore.');
  const ids = new Set(v.memories.map((m) => m.memoryId));
  if (ids.size !== v.memories.length) issue('Page memory identities must be unique.');
  if (v.edges.some((e) => !ids.has(e.fromMemoryId) || !ids.has(e.toMemoryId))) issue('Every edge endpoint must be released in this page.');
  const seeds = new Set(v.seedMemoryIds);
  if (seeds.size !== v.seedMemoryIds.length || v.seedMemoryIds.some((id) => !ids.has(id))) issue('Every unique seed must be released in this page.');
  if (v.surface !== 'neighborhood' && (v.edges.length > 0 || seeds.size > 0)) issue('Only neighborhoods carry edges/seeds.');
  if (v.surface === 'neighborhood' && (
    (v.memories.length > 0 && seeds.size === 0) ||
    v.edges.some((e) => !seeds.has(e.fromMemoryId) && !seeds.has(e.toMemoryId)) ||
    v.memories.some((m) => !seeds.has(m.memoryId) && !v.edges.some((e) => e.fromMemoryId === m.memoryId || e.toMemoryId === m.memoryId))
  )) issue('A neighborhood contains only seeds and their direct one-hop neighbors.');
  if ((v.surface === 'history') !== (v.historyMemoryId !== null) ||
    (v.surface === 'history' && v.events.some((e) => e.memory.memoryId !== v.historyMemoryId))) issue('Per-memory history must keep its explicit selection.');
  if ((v.surface === 'list' || v.surface === 'neighborhood') && v.events.length > 0) issue('List and graph pages cannot carry history.');
  if ((v.surface === 'timeline' || v.surface === 'history') && v.memories.length > 0) issue('History pages carry bounded events.');
  if (utf8ByteLength(serializeSuccessEnvelopeV3(v)) > EXPLORER_LIMITS_V3.maxEnvelopeBytes) issue('Explorer envelope exceeds 64 KiB.');
});
export type ExplorerPageV3 = z.infer<typeof explorerPageV3Schema>;
export const explorerResyncV3Schema = z.strictObject({
  protocolVersion: z.literal(CONTRACT_PROTOCOL_VERSION_V3),
  status: z.enum(['cursor_expired', 'resync_required']),
  restart: z.literal(true),
});
export type ExplorerResyncV3 = z.infer<typeof explorerResyncV3Schema>;
