# Threadline FalkorDB field and relationship dictionary

**Proposed model, 13 October 2026.** Every node carries both `Entity` and its specific label. All graph nodes belong to the one project graph selected by authenticated backend routing. Fields marked `?` are absent when unknown; do not store null/maps as graph properties. All other fields are required by the application contract. Cardinalities and state machines require reviewed mutations and invariant checks, not merely unique indexes.

31 node labels and 82 typed endpoint relationships. Graph references to SQL identities are external references validated by the service.

## ProjectRoot

**Authority / core.** Single graph control record

| Property | Type | Contract |
|---|---|---|
| `id` | `string` | Stable UUID; unique on Entity |
| `schema_version` | `integer` | Application schema contract |
| `created_at_ms` | `integer` | UTC epoch milliseconds |
| `producer_id` | `string` | Authenticated actor or service ID |
| `visibility` | `string` | project / user / session |
| `visibility_user_id` | `string?` | Required when user-private |
| `visibility_session_id` | `string?` | Required when session-private |
| `tenant_id` | `string` | Trusted tenant |
| `project_id` | `string` | Trusted project |
| `graph_epoch` | `string` | Restore incarnation |
| `generation` | `integer` | Incremented each committed domain mutation |
| `next_event_seq` | `integer` | Last allocated sequence; initial zero |
| `requirement_revision` | `integer` | Current accepted governing generation |
| `status` | `string` | ready / paused / archived |

## ActorRef

**Authority / core.** Provenance identity without credentials

| Property | Type | Contract |
|---|---|---|
| `id` | `string` | Stable UUID; unique on Entity |
| `schema_version` | `integer` | Application schema contract |
| `created_at_ms` | `integer` | UTC epoch milliseconds |
| `producer_id` | `string` | Authenticated actor or service ID |
| `visibility` | `string` | project / user / session |
| `visibility_user_id` | `string?` | Required when user-private |
| `visibility_session_id` | `string?` | Required when session-private |
| `actor_kind` | `string` | human / agent / service |
| `sql_id` | `string` | Opaque identity reference |
| `display_label` | `string` | Nonsecret display label |

## Run

**Authority / core.** Run authority and shared scheduler limits

| Property | Type | Contract |
|---|---|---|
| `id` | `string` | Stable UUID; unique on Entity |
| `schema_version` | `integer` | Application schema contract |
| `created_at_ms` | `integer` | UTC epoch milliseconds |
| `producer_id` | `string` | Authenticated actor or service ID |
| `visibility` | `string` | project / user / session |
| `visibility_user_id` | `string?` | Required when user-private |
| `visibility_session_id` | `string?` | Required when session-private |
| `policy_digest` | `string` | Immutable authorized policy |
| `status` | `string` | pending / active / paused / completed / cancelled |
| `max_live_workers` | `integer` | MVP one model session; target review preset two, investigation four |
| `reserved_slots` | `integer` | Atomic active plus reserved slots |
| `child_launch_count` | `integer` | Includes replacements |
| `max_child_launches` | `integer` | Core zero; future investigation preset four |
| `reserved_tokens` | `integer` | Outstanding estimate |
| `used_tokens` | `integer` | Known usage; separate unknown flag |
| `usage_unknown` | `boolean` | Blocks claims of precise cap |
| `max_tokens` | `integer` | Configured run target |
| `deadline_ms` | `integer` | Wall-clock stop boundary |

## Goal

**Authority / core.** Stable goal identity

| Property | Type | Contract |
|---|---|---|
| `id` | `string` | Stable UUID; unique on Entity |
| `schema_version` | `integer` | Application schema contract |
| `created_at_ms` | `integer` | UTC epoch milliseconds |
| `producer_id` | `string` | Authenticated actor or service ID |
| `visibility` | `string` | project / user / session |
| `visibility_user_id` | `string?` | Required when user-private |
| `visibility_session_id` | `string?` | Required when session-private |
| `current_revision` | `integer` | Current GoalVersion |
| `status` | `string` | active / superseded / done |

## GoalVersion

**Authority / core.** Immutable accepted desired outcome

| Property | Type | Contract |
|---|---|---|
| `id` | `string` | Stable UUID; unique on Entity |
| `schema_version` | `integer` | Application schema contract |
| `created_at_ms` | `integer` | UTC epoch milliseconds |
| `producer_id` | `string` | Authenticated actor or service ID |
| `visibility` | `string` | project / user / session |
| `visibility_user_id` | `string?` | Required when user-private |
| `visibility_session_id` | `string?` | Required when session-private |
| `revision` | `integer` | Monotonic per goal |
| `text` | `string` | Exact bounded goal statement |
| `criteria_digest` | `string` | Canonical current criteria |
| `source_id` | `string` | Authorized source anchor |

## Constraint

**Authority / core.** Stable governing rule identity

| Property | Type | Contract |
|---|---|---|
| `id` | `string` | Stable UUID; unique on Entity |
| `schema_version` | `integer` | Application schema contract |
| `created_at_ms` | `integer` | UTC epoch milliseconds |
| `producer_id` | `string` | Authenticated actor or service ID |
| `visibility` | `string` | project / user / session |
| `visibility_user_id` | `string?` | Required when user-private |
| `visibility_session_id` | `string?` | Required when session-private |
| `current_revision` | `integer` | Current ConstraintVersion |
| `scope_kind` | `string` | project / goal / task / artifact |
| `scope_id` | `string` | Applicable stable ID |

## ConstraintVersion

**Authority / core.** Immutable requirement text and authority

| Property | Type | Contract |
|---|---|---|
| `id` | `string` | Stable UUID; unique on Entity |
| `schema_version` | `integer` | Application schema contract |
| `created_at_ms` | `integer` | UTC epoch milliseconds |
| `producer_id` | `string` | Authenticated actor or service ID |
| `visibility` | `string` | project / user / session |
| `visibility_user_id` | `string?` | Required when user-private |
| `visibility_session_id` | `string?` | Required when session-private |
| `revision` | `integer` | Monotonic rule version |
| `text` | `string` | Exact accepted requirement |
| `polarity` | `string` | must / must_not / preference |
| `accepted_by` | `string` | Human or declared policy actor |
| `source_id` | `string` | Original authorized source |
| `valid_from_revision` | `integer` | Project requirement generation |

## Criterion

**Authority / core.** Executable or human acceptance requirement

| Property | Type | Contract |
|---|---|---|
| `id` | `string` | Stable UUID; unique on Entity |
| `schema_version` | `integer` | Application schema contract |
| `created_at_ms` | `integer` | UTC epoch milliseconds |
| `producer_id` | `string` | Authenticated actor or service ID |
| `visibility` | `string` | project / user / session |
| `visibility_user_id` | `string?` | Required when user-private |
| `visibility_session_id` | `string?` | Required when session-private |
| `kind` | `string` | command / assertion / human_review |
| `check_ref` | `string` | Approved immutable check definition |
| `acceptance_bundle_digest` | `string` | Protected transitive runner assertions configs and dependencies |
| `launcher_digest` | `string` | Trusted executable invocation independent of candidate scripts |
| `expected_result` | `string` | Declared success condition |
| `required` | `boolean` | Blocks completion when true |
| `timeout_ms` | `integer` | Execution bound |
| `criteria_digest` | `string` | Version binding |

## Workspace

**Execution / core.** Graph reference to registered workspace

| Property | Type | Contract |
|---|---|---|
| `id` | `string` | Stable UUID; unique on Entity |
| `schema_version` | `integer` | Application schema contract |
| `created_at_ms` | `integer` | UTC epoch milliseconds |
| `producer_id` | `string` | Authenticated actor or service ID |
| `visibility` | `string` | project / user / session |
| `visibility_user_id` | `string?` | Required when user-private |
| `visibility_session_id` | `string?` | Required when session-private |
| `sql_id` | `string` | workspace_registrations identity |
| `kind` | `string` | builder / verifier / investigator / fixture |
| `host_id` | `string` | Registered host |
| `repository_fingerprint` | `string` | Canonical repository evidence |

**Implemented M01 staging:** accepted goal/task/source/criterion authority is the first subset. Task.run_id is absent until M02. Protected Criterion checker bindings become required with actual M08 checker admission; M01 records no fabricated bundle, launcher or verification receipt. See [the implemented agreement](../../../docs/m01-contract-agreement.md).

## Task

**Authority / core.** Stable unit of work; indexed current projection

| Property | Type | Contract |
|---|---|---|
| `id` | `string` | Stable UUID; unique on Entity |
| `schema_version` | `integer` | Application schema contract |
| `created_at_ms` | `integer` | UTC epoch milliseconds |
| `producer_id` | `string` | Authenticated actor or service ID |
| `visibility` | `string` | project / user / session |
| `visibility_user_id` | `string?` | Required when user-private |
| `visibility_session_id` | `string?` | Required when session-private |
| `run_id` | `string?` | Absent for accepted-only M01 tasks; real execution run attaches at M02. Never fabricate a run ID. |
| `current_revision` | `integer` | Current immutable TaskState revision |
| `current_status` | `string` | Denormalized state updated atomically |
| `owner_session_id` | `string?` | Current admitted owner |
| `fence` | `integer` | Increases on claim/revocation |
| `requirement_revision` | `integer` | Governing accepted version |
| `depth` | `integer` | Parent depth; root zero |

## TaskState

**Authority / core.** Immutable revision of current work

| Property | Type | Contract |
|---|---|---|
| `id` | `string` | Stable UUID; unique on Entity |
| `schema_version` | `integer` | Application schema contract |
| `created_at_ms` | `integer` | UTC epoch milliseconds |
| `producer_id` | `string` | Authenticated actor or service ID |
| `visibility` | `string` | project / user / session |
| `visibility_user_id` | `string?` | Required when user-private |
| `visibility_session_id` | `string?` | Required when session-private |
| `task_id` | `string` | Stable Task identity |
| `revision` | `integer` | Per-task monotonic revision |
| `status` | `string` | planned / ready / running / blocked / verifying / completed / cancelled |
| `owner_session_id` | `string?` | Admitted owner |
| `fence` | `integer` | Ownership fence |
| `lease_expires_ms` | `integer?` | Server-controlled lease |
| `requirement_revision` | `integer` | Accepted governing version |
| `checkpoint_text` | `string` | Project-safe orientation only; exact structured state is in checkpoint source |
| `checkpoint_source_id` | `string?` | Source of immutable checkpoint manifest |
| `checkpoint_session_id` | `string?` | Active producer session at checkpoint |
| `checkpoint_capture_seq` | `integer?` | Covered producer cursor; manifest also binds all prior task sessions |
| `candidate_digest` | `string?` | Exact candidate |
| `unresolved_effects` | `boolean` | Prevents acceptance until reconciled |

## AgentSession

**Execution / core.** Graph participation of one observed runtime

| Property | Type | Contract |
|---|---|---|
| `id` | `string` | Stable UUID; unique on Entity |
| `schema_version` | `integer` | Application schema contract |
| `created_at_ms` | `integer` | UTC epoch milliseconds |
| `producer_id` | `string` | Authenticated actor or service ID |
| `visibility` | `string` | project / user / session |
| `visibility_user_id` | `string?` | Required when user-private |
| `visibility_session_id` | `string?` | Required when session-private |
| `sql_id` | `string` | agent_sessions identity |
| `run_id` | `string` | Owning run |
| `role` | `string` | Core builder / verifier; future investigator |
| `status` | `string` | reserved / live / stopping / stopped / unknown |
| `last_capture_seq` | `integer` | Highest graph-admitted capture |
| `loaded_requirement_revision` | `integer` | Latest acknowledged required context |
| `authorization_kind` | `string` | task_claim / verification_assignment / investigation_assignment |
| `authorization_digest` | `string` | Immutable role authorization manifest digest |
| `authorization_json` | `string` | Canonical task epoch revision candidate criteria reservation contract |
| `output_visibility` | `string` | Most restrictive loaded source scope; project / user / session |
| `output_owner_user_id` | `string?` | Required for user-private derived output |
| `output_owner_session_id` | `string?` | Required for session-private derived output |

M02 runtime addition: `lease_expires_ms` is the operational session lease renewed by guarded heartbeats. The initial immutable TaskState retains its admission-time lease snapshot; renewal does not change its revision or worker fence.

## Source

**Memory / core.** Addressable provenance reference; content remains SQL/blob

| Property | Type | Contract |
|---|---|---|
| `id` | `string` | Stable UUID; unique on Entity |
| `schema_version` | `integer` | Application schema contract |
| `created_at_ms` | `integer` | UTC epoch milliseconds |
| `producer_id` | `string` | Authenticated actor or service ID |
| `visibility` | `string` | project / user / session |
| `visibility_user_id` | `string?` | Required when user-private |
| `visibility_session_id` | `string?` | Required when session-private |
| `source_kind` | `string` | project_message / session_message / capture / artifact |
| `source_sql_id` | `string` | Typed SQL identity |
| `content_digest` | `string` | Immutable exact or canonical bytes digest |
| `locator_ref` | `string` | Authorized resolver ID; not arbitrary path |
| `availability` | `string` | available / missing / tombstoned |

## Message

**Memory / core.** Conversation anchor preserving ordering and source

| Property | Type | Contract |
|---|---|---|
| `id` | `string` | Stable UUID; unique on Entity |
| `schema_version` | `integer` | Application schema contract |
| `created_at_ms` | `integer` | UTC epoch milliseconds |
| `producer_id` | `string` | Authenticated actor or service ID |
| `visibility` | `string` | project / user / session |
| `visibility_user_id` | `string?` | Required when user-private |
| `visibility_session_id` | `string?` | Required when session-private |
| `session_id` | `string` | Originating agent session |
| `message_seq` | `integer` | Per-session message order |
| `role` | `string` | user / assistant / tool / system |
| `body_digest` | `string` | Original visible content digest |
| `source_id` | `string` | Source anchor |
| `is_partial` | `boolean` | Incomplete visible message |

## Observation

**Memory / core.** Automatically captured event without truth promotion

| Property | Type | Contract |
|---|---|---|
| `id` | `string` | Stable UUID; unique on Entity |
| `schema_version` | `integer` | Application schema contract |
| `created_at_ms` | `integer` | UTC epoch milliseconds |
| `producer_id` | `string` | Authenticated actor or service ID |
| `visibility` | `string` | project / user / session |
| `visibility_user_id` | `string?` | Required when user-private |
| `visibility_session_id` | `string?` | Required when session-private |
| `capture_event_id` | `string` | SQL observation identity |
| `session_id` | `string` | Producer session |
| `capture_seq` | `integer` | Observed order |
| `kind` | `string` | message / tool / lifecycle / usage |
| `payload_digest` | `string` | Canonical captured event |
| `outcome` | `string` | observed / succeeded / failed / denied / unknown |

## Attempt

**Memory / core.** Interpreted hypothesis/action and actual outcome

| Property | Type | Contract |
|---|---|---|
| `id` | `string` | Stable UUID; unique on Entity |
| `schema_version` | `integer` | Application schema contract |
| `created_at_ms` | `integer` | UTC epoch milliseconds |
| `producer_id` | `string` | Authenticated actor or service ID |
| `visibility` | `string` | project / user / session |
| `visibility_user_id` | `string?` | Required when user-private |
| `visibility_session_id` | `string?` | Required when session-private |
| `task_id` | `string` | Attempted task |
| `hypothesis` | `string` | Bounded public rationale |
| `outcome` | `string` | success / failure / unknown |
| `requirement_revision` | `integer` | Conditions at attempt |
| `environment_digest` | `string` | Execution conditions |
| `summary` | `string` | Useful observed lesson; conditional |

## ArtifactVersion

**Evidence / core.** Exact tested/generated artifact manifest

| Property | Type | Contract |
|---|---|---|
| `id` | `string` | Stable UUID; unique on Entity |
| `schema_version` | `integer` | Application schema contract |
| `created_at_ms` | `integer` | UTC epoch milliseconds |
| `producer_id` | `string` | Authenticated actor or service ID |
| `visibility` | `string` | project / user / session |
| `visibility_user_id` | `string?` | Required when user-private |
| `visibility_session_id` | `string?` | Required when session-private |
| `sql_artifact_id` | `string` | Stored object metadata |
| `content_digest` | `string` | Exact file/manifest bytes |
| `candidate_digest` | `string` | Full candidate identity |
| `base_commit` | `string?` | Repository base |
| `environment_digest` | `string` | Tool/dependency/runtime manifest |
| `relative_path` | `string?` | Project-relative path |
| `kind` | `string` | snapshot / patch / file / test_log |

## Decision

**Memory / core.** Accepted choice or explicit pending proposal

| Property | Type | Contract |
|---|---|---|
| `id` | `string` | Stable UUID; unique on Entity |
| `schema_version` | `integer` | Application schema contract |
| `created_at_ms` | `integer` | UTC epoch milliseconds |
| `producer_id` | `string` | Authenticated actor or service ID |
| `visibility` | `string` | project / user / session |
| `visibility_user_id` | `string?` | Required when user-private |
| `visibility_session_id` | `string?` | Required when session-private |
| `status` | `string` | proposed / accepted / rejected / superseded |
| `choice` | `string` | Chosen tactic |
| `rationale` | `string` | Public bounded explanation |
| `scope_task_id` | `string` | Applicable task |
| `requirement_revision` | `integer` | Governing conditions |
| `accepted_by` | `string?` | Authorized actor |
| `rejected_alternative` | `string?` | Scoped alternative |

## Finding

**Memory / core.** Sourced conditional assertion; no majority truth rule

| Property | Type | Contract |
|---|---|---|
| `id` | `string` | Stable UUID; unique on Entity |
| `schema_version` | `integer` | Application schema contract |
| `created_at_ms` | `integer` | UTC epoch milliseconds |
| `producer_id` | `string` | Authenticated actor or service ID |
| `visibility` | `string` | project / user / session |
| `visibility_user_id` | `string?` | Required when user-private |
| `visibility_session_id` | `string?` | Required when session-private |
| `status` | `string` | proposed / published / contradicted / superseded |
| `statement` | `string` | Bounded assertion |
| `scope_task_id` | `string` | Applicable work |
| `requirement_revision` | `integer` | Conditions |
| `artifact_digest` | `string?` | Exact referenced input |
| `evidence_status` | `string` | unverified / reproduced / accepted |

## Procedure

**Memory / core.** Versioned workflow with explicit prerequisites

| Property | Type | Contract |
|---|---|---|
| `id` | `string` | Stable UUID; unique on Entity |
| `schema_version` | `integer` | Application schema contract |
| `created_at_ms` | `integer` | UTC epoch milliseconds |
| `producer_id` | `string` | Authenticated actor or service ID |
| `visibility` | `string` | project / user / session |
| `visibility_user_id` | `string?` | Required when user-private |
| `visibility_session_id` | `string?` | Required when session-private |
| `name` | `string` | Stable procedure name |
| `version` | `integer` | Version within name |
| `steps_json` | `string` | Canonical bounded opaque step list |
| `preconditions_json` | `string` | Canonical environment/artifact/scope predicates |
| `status` | `string` | candidate / validated / invalidated / superseded |
| `heldout_reuse_count` | `integer` | Verified distinct compatible tasks |
| `policy_digest` | `string` | Tool and safety assumptions |

## VerificationReceipt

**Evidence / core.** Trusted checked evidence for one exact candidate

| Property | Type | Contract |
|---|---|---|
| `id` | `string` | Stable UUID; unique on Entity |
| `schema_version` | `integer` | Application schema contract |
| `created_at_ms` | `integer` | UTC epoch milliseconds |
| `producer_id` | `string` | Authenticated actor or service ID |
| `visibility` | `string` | project / user / session |
| `visibility_user_id` | `string?` | Required when user-private |
| `visibility_session_id` | `string?` | Required when session-private |
| `candidate_digest` | `string` | Candidate actually executed |
| `environment_digest` | `string` | Dependency/runtime/check environment |
| `criteria_digest` | `string` | Versioned acceptance suite |
| `acceptance_bundle_digest` | `string` | Exact protected acceptance bundle executed |
| `launcher_digest` | `string` | Trusted launcher executed |
| `requirement_revision` | `integer` | Current governing generation at check |
| `command_digest` | `string` | Approved invocation |
| `exit_code` | `integer` | Actual exit code |
| `status` | `string` | passed / failed / unknown / stale |
| `check_run_id` | `string` | Stable trusted check execution identity |
| `verified_by_actor_id` | `string` | Service ActorRef that produced protected assertion result |
| `verifier_session_id` | `string?` | Optional later model reviewer; absent for deterministic MVP checker |
| `verified_at_ms` | `integer` | Observed finish time |

## Event

**Synchronization / core.** Durable domain outbox in same atomic write

| Property | Type | Contract |
|---|---|---|
| `id` | `string` | Stable UUID; unique on Entity |
| `schema_version` | `integer` | Application schema contract |
| `created_at_ms` | `integer` | UTC epoch milliseconds |
| `producer_id` | `string` | Authenticated actor or service ID |
| `visibility` | `string` | project / user / session |
| `visibility_user_id` | `string?` | Required when user-private |
| `visibility_session_id` | `string?` | Required when session-private |
| `graph_epoch` | `string` | Project incarnation |
| `seq` | `integer` | Strictly increasing project sequence |
| `kind` | `string` | Typed domain event |
| `aggregate_id` | `string` | Task/run/memory changed |
| `request_id` | `string` | Application operation ID |
| `payload_digest` | `string` | Canonical payload fingerprint |
| `payload_json` | `string` | Bounded replay payload |
| `committed_at_ms` | `integer` | Server application commit time |

## RequestReceipt

**Synchronization / core.** Idempotent result of one accepted domain command

| Property | Type | Contract |
|---|---|---|
| `id` | `string` | Stable UUID; unique on Entity |
| `schema_version` | `integer` | Application schema contract |
| `created_at_ms` | `integer` | UTC epoch milliseconds |
| `producer_id` | `string` | Authenticated actor or service ID |
| `visibility` | `string` | project / user / session |
| `visibility_user_id` | `string?` | Required when user-private |
| `visibility_session_id` | `string?` | Required when session-private |
| `graph_epoch` | `string` | Authority incarnation; receipt uniqueness includes epoch |
| `request_id` | `string` | Application operation UUID within epoch |
| `request_digest` | `string` | Immutable principal/scope/op/input hash |
| `operation` | `string` | Typed domain command |
| `event_seq` | `integer` | Committed Event |
| `result_json` | `string` | Bounded stable result |
| `actor_id` | `string` | Authenticated principal |

## ContextPacket

**Evidence / core.** Immutable context content and inclusion explanation

| Property | Type | Contract |
|---|---|---|
| `id` | `string` | Stable UUID; unique on Entity |
| `schema_version` | `integer` | Application schema contract |
| `created_at_ms` | `integer` | UTC epoch milliseconds |
| `producer_id` | `string` | Authenticated actor or service ID |
| `visibility` | `string` | project / user / session |
| `visibility_user_id` | `string?` | Required when user-private |
| `visibility_session_id` | `string?` | Required when session-private |
| `task_id` | `string` | Target work |
| `sql_id` | `string` | Packet metadata |
| `content_digest` | `string` | Exact rendered input |
| `task_revision` | `integer` | Observed current TaskState |
| `requirement_revision` | `integer` | Governing generation |
| `graph_generation` | `integer` | Snapshot/validated generation |
| `mandatory_count` | `integer` | Required included records |
| `omitted_optional_count` | `integer` | Explicit truncation disclosure |
| `token_count` | `integer` | Count/estimate as labelled in SQL |

## ContextLoad

**Evidence / core.** Actual packet insertion evidence; not comprehension

| Property | Type | Contract |
|---|---|---|
| `id` | `string` | Stable UUID; unique on Entity |
| `schema_version` | `integer` | Application schema contract |
| `created_at_ms` | `integer` | UTC epoch milliseconds |
| `producer_id` | `string` | Authenticated actor or service ID |
| `visibility` | `string` | project / user / session |
| `visibility_user_id` | `string?` | Required when user-private |
| `visibility_session_id` | `string?` | Required when session-private |
| `session_id` | `string` | Recipient |
| `packet_id` | `string` | Exact packet |
| `submission_id` | `string` | Stable pre-submit occurrence ID; packet may repeat |
| `runtime_turn_id` | `string?` | Receiving owned/native runtime turn |
| `ack_kind` | `string` | owned_request_assembled / host_ack / transport_submission_only |
| `acknowledged_at_ms` | `integer` | Boundary evidence |
| `requirement_revision` | `integer` | Packet governing generation |

## DeliveryCursor

**Synchronization / core.** Refresh/replay progress per worker consumer

| Property | Type | Contract |
|---|---|---|
| `id` | `string` | Stable UUID; unique on Entity |
| `schema_version` | `integer` | Application schema contract |
| `created_at_ms` | `integer` | UTC epoch milliseconds |
| `producer_id` | `string` | Authenticated actor or service ID |
| `visibility` | `string` | project / user / session |
| `visibility_user_id` | `string?` | Required when user-private |
| `visibility_session_id` | `string?` | Required when session-private |
| `session_id` | `string` | Recipient |
| `graph_epoch` | `string` | Bound incarnation |
| `scanned_seq` | `integer` | Highest scanned event including filtered skips |
| `inserted_seq` | `integer` | Highest contiguous relevant event inserted |
| `last_packet_id` | `string?` | Rebuilt closure packet |
| `updated_at_ms` | `integer` | Acknowledgement time |

## Handoff

**Execution / core.** Durable successor offer and reconciliation contract

| Property | Type | Contract |
|---|---|---|
| `id` | `string` | Stable UUID; unique on Entity |
| `schema_version` | `integer` | Application schema contract |
| `created_at_ms` | `integer` | UTC epoch milliseconds |
| `producer_id` | `string` | Authenticated actor or service ID |
| `visibility` | `string` | project / user / session |
| `visibility_user_id` | `string?` | Required when user-private |
| `visibility_session_id` | `string?` | Required when session-private |
| `task_id` | `string` | Transferred work |
| `from_session_id` | `string` | Old owner |
| `to_session_id` | `string?` | Designated successor |
| `status` | `string` | offered / reconciling / accepted / cancelled |
| `old_fence` | `integer` | Revoked ownership |
| `expected_revision` | `integer` | Offer state revision |
| `packet_id` | `string?` | Current restore context |
| `termination_confirmed` | `boolean` | Actual process proof or safe quarantine |

## BudgetReservation

**Execution / core.** Atomic scheduler authorization for bounded work

| Property | Type | Contract |
|---|---|---|
| `id` | `string` | Stable UUID; unique on Entity |
| `schema_version` | `integer` | Application schema contract |
| `created_at_ms` | `integer` | UTC epoch milliseconds |
| `producer_id` | `string` | Authenticated actor or service ID |
| `visibility` | `string` | project / user / session |
| `visibility_user_id` | `string?` | Required when user-private |
| `visibility_session_id` | `string?` | Required when session-private |
| `run_id` | `string` | Budget owner |
| `launch_id` | `string` | Associated LaunchIntent |
| `slots` | `integer` | Live/reserved execution slots |
| `tokens_reserved` | `integer` | Next bounded request estimate |
| `max_cost_microunits` | `integer?` | Priced route ceiling |
| `status` | `string` | reserved / active / settling / released |
| `deadline_ms` | `integer` | Lease/lifetime bound |
| `usage_precision` | `string` | reported / estimated / unknown |

## LaunchIntent

**Execution / core.** Authorization preceding an external process launch

| Property | Type | Contract |
|---|---|---|
| `id` | `string` | Stable UUID; unique on Entity |
| `schema_version` | `integer` | Application schema contract |
| `created_at_ms` | `integer` | UTC epoch milliseconds |
| `producer_id` | `string` | Authenticated actor or service ID |
| `visibility` | `string` | project / user / session |
| `visibility_user_id` | `string?` | Required when user-private |
| `visibility_session_id` | `string?` | Required when session-private |
| `run_id` | `string` | Owning run |
| `task_id` | `string` | Admitted objective |
| `agent_session_id` | `string` | Stable reserved execution identity |
| `parent_session_id` | `string?` | Requesting worker |
| `request_signature` | `string` | Deduped normalized objective and scope |
| `status` | `string` | authorized / launching / registered / unknown / stopped |
| `reservation_id` | `string` | Budget authorization |
| `claim_fence` | `integer?` | Builder claim only; absent for Verifier assignment |
| `authorization_digest` | `string` | Role-specific session authorization digest |

## IntegrationIntent

**Evidence / core.** Reconciled patch adoption outside graph transaction

| Property | Type | Contract |
|---|---|---|
| `id` | `string` | Stable UUID; unique on Entity |
| `schema_version` | `integer` | Application schema contract |
| `created_at_ms` | `integer` | UTC epoch milliseconds |
| `producer_id` | `string` | Authenticated actor or service ID |
| `visibility` | `string` | project / user / session |
| `visibility_user_id` | `string?` | Required when user-private |
| `visibility_session_id` | `string?` | Required when session-private |
| `task_id` | `string` | Completed/ready candidate owner |
| `candidate_digest` | `string` | Approved source snapshot |
| `expected_target_digest` | `string` | Integration base |
| `status` | `string` | authorized / applying / unknown / applied / rejected |
| `result_digest` | `string?` | Inspected resulting tree |
| `operation_id` | `string` | Stable external action correlation |

## Publication

**Memory / core.** Explicit shared copy of private sourced knowledge

| Property | Type | Contract |
|---|---|---|
| `id` | `string` | Stable UUID; unique on Entity |
| `schema_version` | `integer` | Application schema contract |
| `created_at_ms` | `integer` | UTC epoch milliseconds |
| `producer_id` | `string` | Authenticated actor or service ID |
| `visibility` | `string` | project / user / session |
| `visibility_user_id` | `string?` | Required when user-private |
| `visibility_session_id` | `string?` | Required when session-private |
| `source_record_id` | `string` | Original authorized item |
| `published_record_id` | `string` | New shareable record |
| `source_policy_digest` | `string` | Reviewed redaction/citation permissions |
| `accepted_by` | `string` | Authorized publication actor |
| `status` | `string` | active / revoked |

## Relationship catalog

All edges have `id`, `created_at_ms`, `producer_id`, and `schema_version`. `INCLUDES` also has `reason`, `mandatory`, and `source_revision`; `DEPENDS_ON` has `dependency_kind` and `scope_digest`; `LOADED` has `context_load_id`. Relationships are created only between validated nodes in this graph. `SUPERSEDES` points from newer to older.

| From | Relationship | To | Cardinality / invariant |
|---|---|---|---|
| `ProjectRoot` | `HAS_RUN` | `Run` | 1:N |
| `ProjectRoot` | `HAS_GOAL` | `Goal` | 1:N |
| `ProjectRoot` | `HAS_CONSTRAINT` | `Constraint` | 1:N |
| `ProjectRoot` | `HAS_PROCEDURE` | `Procedure` | 1:N scoped discovery |
| `Goal` | `CURRENT_VERSION` | `GoalVersion` | 1:1 |
| `Constraint` | `CURRENT_VERSION` | `ConstraintVersion` | 1:1 |
| `GoalVersion` | `REQUIRES` | `Criterion` | 1:N |
| `GoalVersion` | `SOURCED_FROM` | `Source` | N:1 |
| `ConstraintVersion` | `SOURCED_FROM` | `Source` | N:1 |
| `ConstraintVersion` | `SUPERSEDES` | `ConstraintVersion` | 0..1 predecessor |
| `GoalVersion` | `SUPERSEDES` | `GoalVersion` | 0..1 predecessor |
| `Goal` | `DECOMPOSES_INTO` | `Task` | 1:N |
| `Task` | `SUBJECT_TO` | `Constraint` | N:M stable applicable bindings |
| `Constraint` | `HAS_VERSION` | `ConstraintVersion` | 1:N immutable history |
| `Goal` | `HAS_VERSION` | `GoalVersion` | 1:N immutable history |
| `Task` | `GOVERNED_BY` | `ConstraintVersion` | N:M historical pinned inputs |
| `Task` | `REQUIRES` | `Criterion` | N:M |
| `Run` | `HAS_TASK` | `Task` | 1:N |
| `Task` | `SUBTASK_OF` | `Task` | child:0..1 parent |
| `Task` | `DEPENDS_ON` | `Task` | acyclic N:M |
| `Task` | `CURRENT_STATE` | `TaskState` | 1:1 |
| `TaskState` | `PREVIOUS_STATE` | `TaskState` | 0..1 predecessor |
| `TaskState` | `OWNED_BY` | `AgentSession` | 0..1 owner |
| `Task` | `USES_WORKSPACE` | `Workspace` | N:1 |
| `Run` | `HAS_SESSION` | `AgentSession` | 1:N |
| `AgentSession` | `PRODUCED` | `Observation` | 1:N |
| `AgentSession` | `HAS_MESSAGE` | `Message` | 1:N |
| `Message` | `SOURCED_FROM` | `Source` | N:1 |
| `Observation` | `SOURCED_FROM` | `Source` | N:1 |
| `Attempt` | `ATTEMPTS` | `Task` | N:1 |
| `Attempt` | `EVIDENCED_BY` | `Observation` | 1:N |
| `Attempt` | `PRODUCES` | `ArtifactVersion` | N:M |
| `TaskState` | `HAS_ARTIFACT` | `ArtifactVersion` | N:M |
| `TaskState` | `CHECKPOINT_SOURCE` | `Source` | 0..1 exact current manifest |
| `Task` | `TOUCHES` | `ArtifactVersion` | N:M |
| `Decision` | `APPLIES_TO` | `Task` | N:M |
| `Decision` | `SUPPORTED_BY` | `Source` | N:M |
| `Finding` | `APPLIES_TO` | `Task` | N:M |
| `Finding` | `SUPPORTED_BY` | `Source` | N:M |
| `Finding` | `CONTRADICTS` | `Finding` | N:M |
| `Decision` | `SUPERSEDES` | `Decision` | 0..1 predecessor |
| `Finding` | `SUPERSEDES` | `Finding` | 0..1 predecessor |
| `Decision` | `DEPENDS_ON` | `ConstraintVersion` | N:M |
| `Finding` | `DEPENDS_ON` | `ArtifactVersion` | N:M |
| `Procedure` | `VALIDATED_BY` | `VerificationReceipt` | 1:N after validation |
| `Procedure` | `REQUIRES` | `ConstraintVersion` | N:M |
| `Attempt` | `USES_PROCEDURE` | `Procedure` | N:M |
| `VerificationReceipt` | `VERIFIES` | `ArtifactVersion` | N:M |
| `VerificationReceipt` | `SATISFIES` | `Criterion` | N:M |
| `VerificationReceipt` | `EVIDENCED_BY` | `Observation` | 1:N |
| `VerificationReceipt` | `CHECKED_BY` | `ActorRef` | N:1 trusted service |
| `TaskState` | `ACCEPTED_RECEIPT` | `VerificationReceipt` | 0:N |
| `Event` | `CHANGES` | `TaskState` | N:M |
| `Event` | `CAUSED_BY` | `ActorRef` | N:1 |
| `RequestReceipt` | `COMMITTED_EVENT` | `Event` | 1:1 |
| `ContextPacket` | `FOR_TASK` | `Task` | N:1 |
| `ContextPacket` | `INCLUDES` | `ConstraintVersion` | N:M |
| `ContextPacket` | `INCLUDES` | `Decision` | N:M |
| `ContextPacket` | `INCLUDES` | `Finding` | N:M |
| `ContextPacket` | `INCLUDES` | `Attempt` | N:M |
| `ContextPacket` | `INCLUDES` | `Procedure` | N:M |
| `ContextPacket` | `INCLUDES` | `GoalVersion` | N:M |
| `ContextPacket` | `INCLUDES` | `Criterion` | N:M |
| `ContextPacket` | `INCLUDES` | `TaskState` | N:M |
| `ContextPacket` | `INCLUDES` | `ArtifactVersion` | N:M |
| `ContextPacket` | `INCLUDES` | `VerificationReceipt` | N:M |
| `ContextPacket` | `INCLUDES` | `Source` | N:M |
| `AgentSession` | `LOADED` | `ContextPacket` | N:M via ContextLoad |
| `ContextLoad` | `ACKS` | `ContextPacket` | N:1 |
| `ContextLoad` | `BY_SESSION` | `AgentSession` | N:1 |
| `DeliveryCursor` | `FOR_SESSION` | `AgentSession` | 1:1 per consumer |
| `Handoff` | `TRANSFERS` | `Task` | N:1 |
| `Handoff` | `FROM_SESSION` | `AgentSession` | N:1 |
| `Handoff` | `TO_SESSION` | `AgentSession` | N:0..1 |
| `Run` | `RESERVES` | `BudgetReservation` | 1:N |
| `LaunchIntent` | `CONSUMES` | `BudgetReservation` | N:1 |
| `LaunchIntent` | `STARTS` | `AgentSession` | 1:1 |
| `LaunchIntent` | `FOR_TASK` | `Task` | N:1 |
| `IntegrationIntent` | `ADOPTS` | `ArtifactVersion` | N:1 |
| `Publication` | `PUBLISHES` | `Finding` | N:1 |
| `Publication` | `PUBLISHES` | `Decision` | N:1 |
| `Publication` | `SOURCED_FROM` | `Source` | N:M |
