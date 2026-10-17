/**
 * M05.2 — prospective model selection and durable human input.
 *
 * Both features rest on the same idea: **configuration is prospective and
 * immutable, and human intent is durable and attributable.**
 *
 * A selection describes the run that has not started yet. It never edits a
 * profile an active run is already using, because a running session holds a
 * profile id and a declared context window; changing that underneath it would
 * silently change the limits it was admitted under. Selection therefore creates
 * a new immutable profile and returns its id, and preparation must be handed
 * that id explicitly. There is no ambient fallback: if the caller does not name
 * a profile, preparation refuses rather than quietly using an environment
 * default, because "it ran with something" is not an acceptable answer to "what
 * did you authorize".
 *
 * Human input is durable before it is anything else. A typed instruction that a
 * person submitted is recorded with its provenance, its authenticated scope and a
 * stable retry identity, so a reconnect or a double-submit cannot create two
 * instructions or silently drop one. Arbitrary prose is **not** an accepted
 * requirement change: it becomes a proposal, and only the existing admission
 * path can change governing requirements.
 */

import type { DecimalSequence } from './checkpoint.js';

/* ------------------------------------------------------------------ */
/* Model listing                                                       */
/* ------------------------------------------------------------------ */

/**
 * How a model was learned about.
 *
 * `catalogue` means the backend advertises the id from its own supported list.
 * That is **not** evidence the configured account can use it: compatibility is
 * proven by an actual authorized run, never by the presence of a string.
 */
export type ModelDiscoverySource = 'configured' | 'catalogue' | 'manual';

/**
 * One selectable model.
 *
 * Declared limits are the profile's own declaration. An unknown limit is
 * `null`, not zero: a missing capability must not become a small budget.
 */
export interface SelectableModel {
  readonly providerId: string;
  readonly modelId: string;
  readonly displayName: string;
  readonly source: ModelDiscoverySource;
  /** Effective context window in tokens, when the backend knows it. */
  readonly contextWindowTokens: number | null;
  /** Maximum output in tokens, when the backend knows it. */
  readonly maxOutputTokens: number | null;
  /** The billing route this model would be charged through. */
  readonly billingRoute: 'api_key' | 'local' | 'native';
  /**
   * Whether an authorized account for this provider is configured. Presence in
   * a catalogue does not imply this is true.
   */
  readonly accountConfigured: boolean;
}

export interface ModelListInput {
  /** Optional filter; an exact model id or a provider id. */
  readonly query?: string | null;
  readonly limit?: number;
}

export interface ModelListResult {
  readonly models: readonly SelectableModel[];
  readonly total: number;
  /** Present when discovery is unavailable, so a manual id remains the path. */
  readonly discoveryNote?: string | null;
  readonly truncated: boolean;
}

/* ------------------------------------------------------------------ */
/* Prospective selection                                               */
/* ------------------------------------------------------------------ */

/**
 * The selection itself: an immutable prospective description of the next run.
 *
 * Carries no credential. The provider account already exists and is selected by
 * id, so a key never travels through a selection, a command or a report.
 */
export interface ProfileSelection {
  readonly providerId: string;
  readonly modelId: string;
  /** Declared by the backend; the caller may not raise it. */
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number;
  readonly providerApi?: string;
  readonly baseUrl?: string;
  /** Human-readable label for the prospective profile. */
  readonly label?: string;
}

export type SelectionOutcomeKind = 'selected' | 'replayed' | 'rejected';

/**
 * Why a selection was refused.
 *
 * Each names what would make it usable, so a client can offer a real next step
 * instead of a dead end.
 */
export type SelectionRejection =
  | { readonly kind: 'unknown_provider'; readonly providerId: string }
  | { readonly kind: 'unknown_model'; readonly providerId: string; readonly modelId: string }
  | { readonly kind: 'no_configured_account'; readonly providerId: string }
  | { readonly kind: 'active_run_conflict'; readonly runId: string }
  | { readonly kind: 'declined_limit'; readonly field: 'contextWindowTokens' | 'maxOutputTokens'; readonly requested: number; readonly allowed: number }
  | { readonly kind: 'invalid'; readonly field: string; readonly reason: string };

export interface SelectionResult {
  readonly outcome: SelectionOutcomeKind;
  /**
   * Stable across a retry of the same intent. Replaying it returns the original
   * profile rather than creating a second one.
   */
  readonly operationId: string;
  /** The immutable prospective profile. Absent on refusal. */
  readonly profileId?: string;
  readonly configDigest?: string;
  readonly providerAccountId?: string;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly rejection?: SelectionRejection;
}

/* ------------------------------------------------------------------ */
/* Durable human input                                                 */
/* ------------------------------------------------------------------ */

/**
 * Why typed human input was refused.
 *
 * The busy refusal is first-class rather than a generic failure: when an active
 * turn cannot yet accept a follow-up, the draft is retained by the client and
 * the boundary is named, instead of an unbounded queue being invented.
 */
export type HumanInputRejection =
  | { readonly kind: 'busy'; readonly reason: string; readonly runId?: string }
  | { readonly kind: 'no_admitted_task'; readonly projectId: string }
  | { readonly kind: 'consent_required'; readonly detail: string }
  | { readonly kind: 'duplicate_conflict'; readonly operationId: string }
  | { readonly kind: 'invalid'; readonly field: string; readonly reason: string };

/**
 * Whether this input starts the work or adds to it.
 *
 * `initial` is the first instruction for a task. `follow_up` is additional human
 * direction inside an existing task. Neither is an accepted requirement change:
 * that remains the admission path's exclusive authority.
 */
export type HumanInputKind = 'initial' | 'follow_up';

/**
 * Whether submitting this text authorizes a provider request.
 *
 * Deliberately separate from the input's existence: recording someone's words
 * is not consent to spend money, and setup, selection, refresh and reconnect
 * never carry it.
 */
export type InferenceConsent = 'none' | 'explicit';

export interface HumanInputSubmission {
  /** Stable per human intent. A retry reuses it; a changed body conflicts. */
  readonly operationId: string;
  readonly kind: HumanInputKind;
  readonly text: string;
  /**
   * Set only when the human explicitly submitted to an inference-labelled
   * action. Absent means the text is recorded and nothing is dispatched.
   */
  readonly consent?: InferenceConsent;
}

export type HumanInputOutcomeKind = 'recorded' | 'replayed' | 'rejected';

export interface HumanInputResult {
  readonly outcome: HumanInputOutcomeKind;
  readonly operationId: string;
  /** The durable message, when one was recorded. */
  readonly messageId?: string;
  /**
   * Whether an inference request was authorized by this submission. Absent or
   * false never implies a request was or was not made; the run surface reports
   * that.
   */
  readonly inferenceAuthorized?: boolean;
  readonly rejection?: HumanInputRejection;
}

/** Declared bounds on one human input, from the development profile. */
export const HUMAN_INPUT_MAX_CHARS = 8_000;
export const HUMAN_INPUT_MAX_ITEMS = 200;

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

export const MODEL_SELECTION_ROUTES = {
  /** Browse selectable models, including a manual-id fallback. */
  list: '/projects/:projectId/models',
  /** Create or replay an immutable prospective profile selection. */
  select: '/projects/:projectId/models/select',
  /** Record durable typed human input for the selected project. */
  input: '/projects/:projectId/input',
} as const;

/**
 * Canonical operation ids for M05.2.
 *
 * `input.submit` is the durable human-input operation; the fact that it exists
 * separately from `admit.accept` is the point, since one records what a person
 * said and the other changes governing requirements.
 */
export const HUMAN_INPUT_OPERATION_ID = 'input.submit';

/** Re-exported so a caller needs one import for sequence-bearing operations. */
export type { DecimalSequence };