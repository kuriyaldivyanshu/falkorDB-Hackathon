import {
  ROUTES,
  contextOccurrenceSchema,
  contextResultSchema,
  parseContract,
  prepareContextInputSchema,
  recordOccurrenceInputSchema,
  type ContextOccurrence,
  type ContextResult,
  type PrepareContextInput,
  type RecordOccurrenceInput,
} from '@threadline/shared';

import type { ApiClient } from './client.js';

/** The backend alone selects, renders, authorizes and reconciles context. */
export interface ContextSurface {
  prepare(input: PrepareContextInput): Promise<ContextResult>;
  recordOccurrence(input: RecordOccurrenceInput): Promise<ContextOccurrence>;
}

export function createContextSurface(client: ApiClient): ContextSurface {
  return {
    async prepare(input) {
      const request = parseContract(prepareContextInputSchema, input, 'context preparation');
      return parseContract(contextResultSchema, await client.post(ROUTES.context, request), 'context result');
    },
    async recordOccurrence(input) {
      const request = parseContract(recordOccurrenceInputSchema, input, 'context occurrence');
      return parseContract(contextOccurrenceSchema, await client.post(ROUTES.contextOccurrences, request), 'context occurrence');
    },
  };
}
