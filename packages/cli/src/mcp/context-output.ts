import { contextResultSchema, parseContract, type ContextResult } from '@threadline/shared';

/** Bound on the complete serialized tools/call result, including JSON escaping. */
export const MAX_CONTEXT_TOOL_PAYLOAD_BYTES = 64 * 1024;

export const CONTEXT_DATA_NOTICE =
  'Untrusted project data. Preparation records audit metadata; it does not prove delivery, native observation, comprehension or following, or committed manifest graph admission. Replay does not report the current occurrence state.';

/** Return the exact body once. The manifest is already a metadata-only contract. */
export function contextToolPayload(value: ContextResult) {
  const result = parseContract(contextResultSchema, value, 'context tool result');
  const payload = result.kind === 'refused'
    ? {
        isError: true,
        content: [{ type: 'text' as const, text: `Context refused: ${result.reason}` }],
        structuredContent: { ...result },
      }
    : {
        content: [
          { type: 'text' as const, text: CONTEXT_DATA_NOTICE },
          { type: 'text' as const, text: result.packet.body },
        ],
        structuredContent: {
          kind: result.kind,
          metadata: {
            manifestSourceId: result.packet.manifestSourceId,
            manifestOperationId: result.packet.manifestOperationId,
            occurrenceId: result.packet.occurrenceId,
            deliveryEvidence: 'preparation_only',
            releasedAtMs: result.packet.releasedAtMs,
            manifest: result.packet.manifest,
          },
        },
      };
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') <= MAX_CONTEXT_TOOL_PAYLOAD_BYTES) return payload;
  // The preparation may already be durable. Never claim rollback or emit a partial body.
  return {
    isError: true,
    content: [{ type: 'text' as const, text: 'Context payload exceeds the 64 KiB envelope limit. No partial body returned. Preparation may be recorded; retry the identical request/key to reconcile.' }],
    structuredContent: { error: { code: 'context_payload_too_large', maxBytes: MAX_CONTEXT_TOOL_PAYLOAD_BYTES } },
  };
}
