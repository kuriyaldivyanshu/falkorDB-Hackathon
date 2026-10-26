import { CONTEXT_MAX_BODY_BYTES, RECALL_LIMITS_V3, ThreadlineError } from '@threadline/shared';

import {
  parseProductPolicy,
  type LoadedProductPolicy,
  type LoadedProjectPreferences,
  type ProductPolicySettings,
  type ProjectPreferences,
} from './policy.js';
import { canonicalDigest } from './storage/digest.js';

const DEFAULT_SETTINGS = parseProductPolicy('schema_version = 1\n');
const MAX_EXCLUSIONS = 64;
// A conservative byte allowance per requested token, not a token-count claim.
// The existing hard byte ceiling still applies; native context is harness-owned.
const CONTEXT_BYTES_PER_REQUESTED_TOKEN = 4;

function invalid(): never {
  throw new ThreadlineError('invalid_request', 'Effective policy settings are unsupported or exceed their bounds.');
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const entry of Object.values(value)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

/** Inputs are settings already validated by policy.ts. Defend the capability
 * boundary without introducing another parser or field-bound schema. */
function requireSupported(settings: ProductPolicySettings, project?: ProjectPreferences): void {
  if (settings.schema_version !== 1 || (project && project.schema_version !== 1)
    || settings.ceilings.checkpoint_callbacks !== false
    || settings.retrieval.mode !== 'on_demand'
    || settings.retrieval.automatic_session_start !== false
    || settings.retrieval.automatic_each_message !== false
    || settings.retrieval.automatic_task_change !== false
    || settings.retrieval.automatic_after_compaction !== false
    || settings.retrieval.background_prefetch !== false
    || settings.capture.enabled !== false || (project?.capture?.enabled ?? false) !== false
    || settings.capture.process_at !== 'turn_end'
    || settings.capture.on_filter_failure !== 'drop_and_record_gap'
    || settings.capture.capture_environment_values !== false
    || settings.capture.exclude_threadline_output !== true
    || settings.context.mandatory_overflow !== 'report_incomplete'
    || settings.admission.shared_decisions !== 'review' || settings.admission.agent_assertions !== 'candidate'
    || settings.processing.incremental !== true || settings.processing.reuse_completed_jobs !== true
    || settings.processing.optional_ai_enabled !== false
    || settings.compaction.failure_policy !== 'request_stop_if_supported'
    || settings.compaction.checkpoint_when_capture_enabled !== false
    || settings.compaction.retrieve_after_compaction !== false
    || settings.admission.automatic_permanent_deletion !== false
    || settings.notifications.enabled !== false
    || settings.diagnostics.include_memory_content !== false || settings.diagnostics.telemetry !== false
    || typeof settings.ceilings.manual_record !== 'boolean'
    || typeof settings.retrieval.allow_agent_requests !== 'boolean'
    || typeof settings.retrieval.allow_explicit_user_requests !== 'boolean') invalid();
  for (const value of [project?.retrieval?.allow_agent_requests, project?.retrieval?.allow_explicit_user_requests]) {
    if (value !== undefined && typeof value !== 'boolean') invalid();
  }
}

function minimum(owner: number, preference: number | undefined, zeroAllowed = false): number {
  for (const value of [owner, preference ?? owner]) {
    if (!Number.isSafeInteger(value) || value < (zeroAllowed ? 0 : 1)) invalid();
  }
  return Math.min(owner, preference ?? owner);
}

function unionExclusions(owner: readonly string[], project: readonly string[]): readonly string[] {
  const result = [...new Set([...DEFAULT_SETTINGS.capture.exclude_paths, ...owner, ...project])].sort();
  if (result.length > MAX_EXCLUSIONS) invalid();
  return result;
}

/** Accepts policy.ts parsed settings. Project text narrows an owner candidate;
 * it never supplies additional authority. No input object is frozen or mutated. */
export function resolvePolicySettings(owner: ProductPolicySettings, preferences: ProjectPreferences): ProductPolicySettings {
  requireSupported(owner, preferences);
  const trusted = structuredClone(owner);
  const project = preferences;
  return deepFreeze({
    ...trusted,
    retrieval: {
      ...trusted.retrieval,
      allow_agent_requests: trusted.retrieval.allow_agent_requests && (project.retrieval?.allow_agent_requests ?? true),
      allow_explicit_user_requests: trusted.retrieval.allow_explicit_user_requests
        && (project.retrieval?.allow_explicit_user_requests ?? true),
      max_candidates: minimum(trusted.retrieval.max_candidates, project.retrieval?.max_candidates),
      optional_wait_ms: minimum(trusted.retrieval.optional_wait_ms, project.retrieval?.optional_wait_ms, true),
    },
    context: {
      ...trusted.context,
      recall_max_tokens: minimum(trusted.context.recall_max_tokens, project.context?.recall_max_tokens),
      followup_max_tokens: minimum(trusted.context.followup_max_tokens, project.context?.followup_max_tokens),
      active_target_tokens: minimum(trusted.context.active_target_tokens, project.context?.active_target_tokens),
    },
    capture: {
      ...trusted.capture,
      enabled: trusted.capture.enabled && (project.capture?.enabled ?? false),
      exclude_paths: unionExclusions(trusted.capture.exclude_paths, project.capture?.exclude_paths ?? []),
    },
  });
}

/** Revision zero preserves M03's explicit manual workflow only when the caller
 * has established no prior approval and no owner file. Source age limits start
 * after owner approval; stored availability/denials still apply. */
export function baselinePolicySettings(): ProductPolicySettings {
  return deepFreeze({
    ...structuredClone(DEFAULT_SETTINGS),
    ceilings: { ...DEFAULT_SETTINGS.ceilings, manual_record: true },
  });
}

export function policyCandidate(
  owner: LoadedProductPolicy,
  preferences: LoadedProjectPreferences,
  bindingId: string | null,
): { digest: string; settings: ProductPolicySettings } {
  if (!['restrictive-defaults', 'configured'].includes(owner.state) || owner.activation !== 'unactivated'
    || !['absent', 'configured'].includes(preferences.state) || preferences.trust !== 'untrusted-preferences'
    || (bindingId !== null && typeof bindingId !== 'string')) invalid();
  const settings = resolvePolicySettings(owner.settings, preferences.settings);
  return deepFreeze({
    digest: canonicalDigest({
      owner: { state: owner.state, settings: owner.settings },
      project: { state: preferences.state, settings: preferences.settings },
      bindingId,
    }),
    settings,
  });
}

/** Request overrides are clamped by callers to these effective owner ceilings. */
export function contextPolicyLimits(settings: ProductPolicySettings): {
  maxBodyBytes: number;
  maxCandidates: number;
  deadlineMs: number;
} {
  requireSupported(settings);
  const policy = settings;
  return deepFreeze({
    maxBodyBytes: Math.min(CONTEXT_MAX_BODY_BYTES, minimum(policy.context.recall_max_tokens, undefined) * CONTEXT_BYTES_PER_REQUESTED_TOKEN),
    maxCandidates: Math.min(RECALL_LIMITS_V3.maxExaminedCandidates, minimum(policy.retrieval.max_candidates, undefined)),
    // optional_wait_ms bounds the complete optional discovery/selection phase.
    deadlineMs: Math.min(RECALL_LIMITS_V3.deadlineMs, minimum(policy.retrieval.optional_wait_ms, undefined, true)),
  });
}
