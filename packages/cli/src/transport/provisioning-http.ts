import { ThreadlineError, MODEL_SELECTION_ROUTES } from '@threadline/shared';
import type {
  HumanInputResult,
  ModelListResult,
  ProfileSelection,
  SelectableModel,
  SelectionResult,
} from '@threadline/shared';

/**
 * Typed client for the M05.2 provisioning routes.
 *
 * The DTOs are Agent A's published contracts in `shared/provisioning.ts` and the
 * routes come from `MODEL_SELECTION_ROUTES`; nothing here restates a field or
 * invents a route. Where the published types already say what an outcome means,
 * this client passes it through unchanged rather than flattening it.
 *
 * Both mutations take a durable `operationId`. The identity is allocated by the
 * caller from `admission/provisioning-record.ts`, so a retry replays the original
 * submission — the backend answers `replayed` — instead of recording a second
 * one.
 */

export type { HumanInputResult, ModelListResult, ProfileSelection, SelectableModel, SelectionResult };

export interface ProvisioningHttp {
  listModels(projectId: string, query?: { query?: string | null; limit?: number }): Promise<ModelListResult>;
  selectModel(projectId: string, operationId: string, selection: ProfileSelection): Promise<SelectionResult>;
  submitInput(
    projectId: string,
    operationId: string,
    input: { kind: 'initial' | 'follow_up'; text: string; consent?: 'explicit' | 'none' },
  ): Promise<HumanInputResult>;
}

const fill = (template: string, projectId: string): string =>
  template.replace(':projectId', encodeURIComponent(projectId));

export const MODEL_LIST_ROUTE = (projectId: string): string => fill(MODEL_SELECTION_ROUTES.list, projectId);
export const MODEL_SELECT_ROUTE = (projectId: string): string => fill(MODEL_SELECTION_ROUTES.select, projectId);
export const HUMAN_INPUT_ROUTE = (projectId: string): string => fill(MODEL_SELECTION_ROUTES.input, projectId);

export function createProvisioningHttp(options: {
  baseUrl: string;
  token: string | null;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): ProvisioningHttp {
  const base = options.baseUrl.replace(/\/+$/, '');
  const doFetch = options.fetchImpl ?? fetch;
  const headers = (): Record<string, string> => ({
    accept: 'application/json',
    ...(options.token === null ? {} : { authorization: `Bearer ${options.token}` }),
    'content-type': 'application/json',
  });

  const send = async <TResult>(
    path: string,
    init: { method: 'GET' | 'POST'; body?: unknown },
    decode: (value: Record<string, unknown>) => TResult | null,
  ): Promise<TResult> => {
    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, {
        method: init.method,
        headers: headers(),
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      });
    } catch {
      // An unreachable route is an absence. It is never reported as a rejection,
      // because a rejection is the backend's decision and this is not.
      throw new ThreadlineError('storage_unavailable', 'The provisioning route could not be reached.');
    }
    const text = await response.text();
    let value: unknown = null;
    try { value = text.length === 0 ? null : (JSON.parse(text) as unknown); } catch { value = null; }

    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new ThreadlineError('invalid_response' as ThreadlineError['code'], `The provisioning route answered ${response.status} with no usable body.`);
    }
    const body = value as Record<string, unknown>;
    const decoded = decode(body);
    if (decoded !== null) return decoded;
    if (typeof body['code'] === 'string') {
      throw new ThreadlineError(body['code'] as ThreadlineError['code'], String(body['message'] ?? body['code']));
    }
    throw new ThreadlineError('invalid_response' as ThreadlineError['code'], `Unrecognised provisioning response (${response.status}).`);
  };

  const isSelectableModel = (value: unknown): value is SelectableModel => {
    if (typeof value !== 'object' || value === null) return false;
    const entry = value as Record<string, unknown>;
    return typeof entry['providerId'] === 'string' && typeof entry['modelId'] === 'string';
  };

  return {
    listModels(projectId, query = {}) {
      const search = new URLSearchParams();
      if (query.query !== undefined && query.query !== null && query.query.length > 0) search.set('q', query.query);
      if (query.limit !== undefined) search.set('limit', String(query.limit));
      const suffix = search.size === 0 ? '' : `?${search.toString()}`;
      return send(`${MODEL_LIST_ROUTE(projectId)}${suffix}`, { method: 'GET' }, (body) => {
        if (!Array.isArray(body['models'])) return null;
        // A body that is not the documented shape is refused rather than reported
        // as an empty catalogue.
        if (!body['models'].every(isSelectableModel)) return null;
        return {
          models: body['models'] as SelectableModel[],
          total: typeof body['total'] === 'number' ? body['total'] : body['models'].length,
          discoveryNote: typeof body['discoveryNote'] === 'string' ? body['discoveryNote'] : null,
          truncated: body['truncated'] === true,
        } satisfies ModelListResult;
      });
    },

    selectModel(projectId, operationId, selection) {
      return send(MODEL_SELECT_ROUTE(projectId), { method: 'POST', body: { operationId, ...selection } }, (body) => {
        const outcome = body['outcome'];
        if (outcome !== 'selected' && outcome !== 'replayed' && outcome !== 'rejected') return null;
        return {
          outcome,
          operationId: typeof body['operationId'] === 'string' ? body['operationId'] : operationId,
          profileId: typeof body['profileId'] === 'string' ? body['profileId'] : undefined,
          configDigest: typeof body['configDigest'] === 'string' ? body['configDigest'] : undefined,
          providerId: typeof body['providerId'] === 'string' ? body['providerId'] : undefined,
          modelId: typeof body['modelId'] === 'string' ? body['modelId'] : undefined,
          rejection: typeof body['rejection'] === 'object' && body['rejection'] !== null ? (body['rejection'] as SelectionResult['rejection']) : undefined,
        } satisfies SelectionResult;
      });
    },

    submitInput(projectId, operationId, input) {
      return send(HUMAN_INPUT_ROUTE(projectId), {
        method: 'POST',
        body: { operationId, kind: input.kind, text: input.text, consent: input.consent ?? 'none' },
      }, (body) => {
        const outcome = body['outcome'];
        if (outcome !== 'recorded' && outcome !== 'replayed' && outcome !== 'rejected') return null;
        return {
          outcome,
          operationId: typeof body['operationId'] === 'string' ? body['operationId'] : operationId,
          messageId: typeof body['messageId'] === 'string' ? body['messageId'] : undefined,
          inferenceAuthorized: body['inferenceAuthorized'] === true ? true : undefined,
          rejection: typeof body['rejection'] === 'object' && body['rejection'] !== null ? (body['rejection'] as HumanInputResult['rejection']) : undefined,
        } satisfies HumanInputResult;
      });
    },
  };
}