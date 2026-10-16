import { ThreadlineError, type RequestBudgetInput, type RequestBudgetResult } from '@threadline/shared';
import { estimateRequestTokens } from '../storage/budget.js';

/** Conservative UTF-8 reservation basis, shared by rendering and exact wire admission. */
export function decideContextBudget(input: RequestBudgetInput, limitTokens: number): RequestBudgetResult {
  const parts = [input.instructionsText, input.historyText, input.toolSchemasText, input.packetText, input.retrievalText];
  const numeric = [limitTokens, input.reservedOutputTokens, input.safetyHeadroomTokens];
  if (parts.some(p => typeof p !== 'string') || numeric.some(n => !Number.isSafeInteger(n) || n < 0) || limitTokens < 1)
    throw new ThreadlineError('invalid_request', 'Invalid context budget declaration.');
  const inputTokensEstimate = parts.reduce((sum, p) => sum + Buffer.byteLength(p), 0) + 64;
  const totalTokens = inputTokensEstimate + input.reservedOutputTokens + input.safetyHeadroomTokens;
  return { permitted: totalTokens <= limitTokens, inputTokensEstimate, precision: 'upper_bound',
    reservedOutputTokens: input.reservedOutputTokens, headroomTokens: input.safetyHeadroomTokens,
    totalTokens, limitTokens, ...(totalTokens > limitTokens ? { overageTokens: totalTokens - limitTokens } : {}) };
}

/** The provider-specific serialized bytes are the final authority, not component arithmetic. */
export function admitContextWire(requestBody: string, limitTokens: number, output: number): RequestBudgetResult {
  const tokens = estimateRequestTokens(requestBody).tokens;
  const headroom = 256;
  return { permitted: tokens + output + headroom <= limitTokens, inputTokensEstimate: tokens,
    precision: 'upper_bound', reservedOutputTokens: output, headroomTokens: headroom,
    totalTokens: tokens + output + headroom, limitTokens };
}
