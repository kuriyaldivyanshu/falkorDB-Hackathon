# Threadline complete database model and ownership

**MVP authority — 15 October 2026:** [Development blueprint](track2-development-blueprint.md) controls release scope: two contributors, one logical Builder and fresh successor, a protected service checker, eleven tools and no automatic model summaries. This document retains broader target/reference contracts; model Verifier, polling, native adapters and fixed four-day schedules are not MVP commitments.

**Proposed schema, 13 October 2026.** PostgreSQL 18 is selected; MySQL is a future alternative driver. FalkorDB remains the authoritative memory and coordination store. No schema here has been applied to a live database.

## 1. Schema deliverables

- [PostgreSQL reference DDL](schema/postgresql-reference.sql): 33 tables (31 core and two post-hackathon adapter/auth extensions), complete columns, primary/foreign/unique/check constraints, initial lookup indexes and tenant RLS templates.
- [Relational field dictionary](schema/relational-field-dictionary.md): every column and its purpose.
- [Relational model JSON](schema/relational-model.json): machine-readable source for schema diagrams.
- [Graph field and relationship dictionary](schema/graph-field-dictionary.md): 31 node labels, all properties, and 82 typed endpoint relationships.
- [Graph model JSON](schema/graph-model.json): machine-readable graph design.
- [FalkorDB query sketches](schema/falkordb-reference.cypher) and [constraint commands](schema/falkordb-constraints.txt).
- [Diagram atlas](track2-diagram-atlas.md): domain-by-domain ER diagrams plus combined storage/protocol views.

The reference model is deliberately complete across core and planned extensions. It is not the first migration that must precede all feature work. Add tables through staged migrations as the corresponding vertical slice is built. The [core-only reference DDL](schema/postgresql-core-reference.sql) excludes the two non-core tables. The [first vertical slice](track2-first-vertical-slice.md) defines build order.

## 2. Ownership rules

1. SQL owns identity, active membership, project-to-graph routing, human application sessions and observed execution/capture.
2. FalkorDB owns accepted requirements/decisions, task revisions, claims, reservations, handoffs, context acceptance and evidence-backed completion.
3. SQL event/status views are projections. They never authorize a task transition.
4. Graph Source/Message/Observation nodes reference immutable SQL/blob payloads and retain relational provenance.
5. Native authentication remains in official clients; API and app-owned SIWC credentials remain in a protected host store. Neither database stores subscription token caches.
6. Actual artifact bytes live in registered workspaces or immutable storage. Their digest establishes identity, not recoverability without bytes.

The service is the only place that combines these facts. A SQL FK cannot reference FalkorDB, and graph atomicity cannot include SQL or filesystem changes. The [protocol specification](track2-runtime-and-protocols.md) gives the durable bridges.

## 3. Relational bounded contexts

| Domain | Tables | Authority and lifecycle |
|---|---|---|
| Identity | `users`, `auth_identities`, `tenants`, `tenant_memberships`, `projects`, `project_memberships`, `user_sessions`, `audit_events` | Authentication and grants; revoked sessions never renew task leases |
| Providers | `provider_accounts`, `provider_profiles`, `usage_ledger`, optional `provider_oauth_registrations` | Nonsecret routes/settings/registration and observed accounting; reservations remain graph authority |
| Execution | `worker_hosts`, `workspace_registrations`, `runs`, `agent_sessions`, `native_bindings`, `launch_attempts` | Registration and observed process lifecycle; native bindings only in compatibility modes |
| History | `project_messages`, `model_requests`, `capture_events`, `session_messages`, `tool_executions`, `tool_approvals`, `capture_gaps` | Durable human intent and visible runtime observations |
| Synchronization | `command_inbox`, `capture_outbox`, `graph_event_projection`, `projection_offsets` | Durable SQL-to-graph input and graph-to-SQL replay |
| Evidence | `artifacts`, `context_packets`, `context_deliveries` | Immutable content metadata and actual insertion observations |
| Operations | `schema_migrations` | Reviewed schema version/checksum inventory |

### 3.1 IDs and scope

Every table uses an application-generated UUID primary key; tenant/project tables also carry composite unique keys used by FKs. For example, a tool execution's `(tenant_id, project_id, agent_session_id, capture_event_id)` must refer to capture from that same session. A parent session belongs to the same run. A project's provider profile cannot point to another tenant's account. Admission additionally requires the run initiator, profile owner and provider-account owner to be the same active authorized human; scope FKs alone do not enforce this billing policy.

Opaque IDs are not authorization. The service checks active tenant/project membership, role and source visibility. Optional references use SQL null; graph optional fields are absent. Cross-aggregate constraints not expressed by SQL FKs—such as a Verifier assignment binding the current graph candidate—are checked by the domain service and tested as invariants.

Use UUIDs as strings in JSON and graph. Use UTC `timestamptz` in SQL and epoch milliseconds in graph. Serialize 64-bit sequence/fence counters as decimal strings at JS/JSON boundaries. Hash a declared canonical representation; `jsonb` is not an exact-original-byte archive.

### 3.2 Human sessions versus agent sessions

`user_sessions` contains a random bearer-token hash, human/tenant identity, authentication method, absolute/idle expiry and revocation. It is an application login. It does not contain a conversation, task lease, model API key or native OAuth token.

`agent_sessions` represents one runtime execution with a role, parent, run, provider profile, workspace and observed status. `native_bindings` maps it to a Codex/Claude conversation only when using those runtimes. An owned-runtime session needs no native binding. `project_messages` records the human's original goal or change even before a run or agent exists; its source remains available after launch failure.

Keep token lookup in a narrowly scoped authentication repository/role. Ordinary application queries use non-owner, non-BYPASSRLS roles and a trusted transaction-local tenant context. Tenant RLS is defense in depth; project membership and private-source predicates still apply. Do not expose a SQL console to agents or let them set session variables.

App-owned ChatGPT OAuth stores nonsecret registration metadata separately from `user_sessions`. Each registration binds the local owner, host, verified provider subject and issued client ID to a secret-store reference. It does not authenticate a new Threadline user merely by matching an email. See [the OAuth design](track2-authentication-and-oauth.md).

### 3.3 Capture and evidence

`capture_events` is immutable and deduplicated by adapter source key and per-session capture sequence. `session_messages` supplies conversation order and bounded inline body or blob reference. `tool_executions` records requested/running/succeeded/failed/denied/unknown; a later observation can refine status while preserving original events. Tool request/result IDs match exactly. Reasoning blocks are filtered before product storage.

Large artifacts are stored before durable references. Deduplication is scoped to project and visibility; do not create a global digest endpoint that reveals another tenant's content. A ContextPacket object contains the exact rendered submission and inclusion metadata. Deliveries record each insertion occurrence with a stable `submission_id`, unique per session/submission, separately from the packet ID and provider turn ID. The same packet can be used in multiple turns; a model's eventual behavior is measured separately.

## 4. FalkorDB model

One graph belongs to `(tenant_id, project_id)`. Its trusted SQL project record determines its opaque key. Every node has the `Entity` label plus a specific label and a stable ID. The common envelope records schema, producer, timestamp and visibility; private visibility uses `visibility_user_id` / `visibility_session_id` independently of a task's current owner.

| Group | Labels | Purpose |
|---|---|---|
| Authority | ProjectRoot, ActorRef, Run, Goal, GoalVersion, Constraint, ConstraintVersion, Criterion, Task, TaskState | Current obligations, revisions, ownership and run limits |
| Memory | Source, Message, Observation, Attempt, Decision, Finding, Procedure, Publication | Episodes, semantic/procedural knowledge and source publication |
| Execution | Workspace, AgentSession, Handoff, BudgetReservation, LaunchIntent | Registered workers, authorized spawning and recoverable ownership |
| Evidence | ArtifactVersion, VerificationReceipt, ContextPacket, ContextLoad, IntegrationIntent | Exact applicability, context insertion and guarded integration |
| Synchronization | Event, RequestReceipt, DeliveryCursor | Atomic outbox, idempotency and refresh replay |

### 4.1 Versions and accepted memory

Goal and Constraint provide stable identities; their version nodes contain immutable accepted text and source. `CURRENT_VERSION` points to one accepted current version. `HAS_VERSION` preserves history; new versions `SUPERSEDES` older ones. `Task-SUBJECT_TO->Constraint` is the current stable binding; `GOVERNED_BY` to a version records historical pinned inputs. Current retrieval resolves stable bindings through exactly one valid `CURRENT_VERSION`. Decisions/findings distinguish proposed, accepted/published, contradicted and superseded. Repetition is not evidence; similarity does not authorize acceptance.

TaskState is immutable. Task carries an indexed current revision/status/fence projection changed atomically with `CURRENT_STATE`. The state history links through `PREVIOUS_STATE`. A changed requirement increments project authority, changes applicability, and establishes a project revision barrier. Stale tasks rebase lazily before new work; they cannot act against the new project generation until rebase. Old verification receipts remain history.

Procedure steps/preconditions are bounded serialized opaque JSON only where traversal is unnecessary. Source, prerequisite and validation relationships stay explicit. A procedure is validated by held-out compatible reuse, not by the authoring agent's confidence or an incremented success counter alone.

### 4.2 Graph invariants

| Invariant | Enforcement |
|---|---|
| Exactly one ProjectRoot for the mapped project and epoch | Bootstrap guard + unique Entity ID + startup check |
| Unique entity IDs, request IDs and event sequence per epoch | Supporting indexes + mandatory/unique constraints, readiness verified |
| One current TaskState per Task | Single guarded mutation; invariant query after migrations/fault tests |
| Strict revision/fence progression | Expected revision and owner/fence predicates inside mutation |
| Task ownership belongs to same project/run | Validated session/run graph relationships and mutation predicates |
| No task dependency cycle | Bounded cycle check in coordinator admission; reject uncertain overlarge traversal |
| Accepted evidence matches candidate/environment/criteria/current requirements | Completion query guards; trusted artifact/test service |
| Every source-dependent accepted claim has readable authorized evidence | Source resolver/publication policy and integrity checks |
| Slots and reservations stay within Run policy | Atomic reservation mutation; unknown processes retain reservations |
| Every accepted domain change has Event + RequestReceipt | Same atomic graph statement |
| Packet authority is current before guarded effects | Revision checks at request/tool/completion barriers |

Property uniqueness alone does not enforce edge cardinality, acyclicity, authorization or arbitrary state transitions. Those remain explicit application contracts with failure tests. See [verified storage constraints](track2-storage-evidence.md).

### 4.3 Indexes and query planning

Initial exact/range indexes cover Entity ID, RequestReceipt epoch/request ID, Event epoch/sequence, TaskState task/revision, Task run/status, Observation capture ID, Message session/sequence, ArtifactVersion digest and DeliveryCursor session. Verify plans on realistic graph sizes; add indexes in response to query patterns rather than indexing every field.

Create supporting indexes before unique constraints and wait for `OPERATIONAL`; `PENDING` is not readiness. Pair uniqueness with mandatory fields. Range indexes are not a complete retrieval strategy. Mandatory context starts at exact IDs and bounded edge types/hops; optional lexical/vector search is scoped and revalidated. Do not apply an output `LIMIT` after an unbounded write and assume it limited effects.

## 5. Store reconciliation and recovery

SQL-to-graph: capture event + outbox are one SQL transaction. The ingester creates graph anchors and receipt with deterministic request ID/digest. A graph-committed/SQL-unacknowledged retry reads the same receipt. SQL outbox delivery metadata includes graph epoch and event sequence.

Graph-to-SQL: projector reads a bounded ordered committed Event range. It applies event rows and the highest contiguous offset in one SQL transaction. An interrupted transaction is replayed. After a restored graph changes epoch, rebuild projections under the new epoch; do not continue a stale cursor merely because its number is smaller.

Human commands persist original source messages and full immutable `command_inbox` envelopes in one SQL transaction before graph admission. Leased retries reconcile epoch-scoped receipts and record committed/rejected/quarantined status; text plus a hash is not the retry payload. On failure, the UI shows pending/rejected intent separately from accepted authority. A source record does not itself mean a requirement is active.

Blob writes, SQL commits, graph commits and process effects are separate boundaries. Each has a stable ID/digest and explicit unknown/pending state. No exactly-once external-effects or distributed-transaction claim is made.

## 6. MySQL alternative

PostgreSQL is the reference DDL shipped with this plan. Do not deploy both SQL engines or create MySQL tables simply to make a diagram appear portable. A future `SessionRepository` implementation must pass the same history/identity/outbox contract.

| PostgreSQL design | MySQL 8.4 mapping | Required verification |
|---|---|---|
| `uuid` | Consistent `BINARY(16)` codec or explicit `CHAR(36)` | Byte order and joins across every reference |
| `timestamptz` | `DATETIME(6)` normalized to UTC | Server/client timezone and precision |
| `jsonb` | `JSON`, targeted generated/indexed columns | Canonical digest independent of SQL representation |
| Partial indexes where added | Generated key/alternative index | Nullable uniqueness and workload plan |
| `ON CONFLICT` where used | Carefully constrained duplicate-key behavior | No overwrite of immutable conflicting payload |
| RLS | Application scope checks plus grants/isolation strategy | Equivalent tenant/project/private-source denial suite |
| SQL leasing/locking | InnoDB transactions and tested locking reads | Isolation-level, deadlock and crash behavior |
| NOTIFY wakeup, if used | Polling/application notification | Durable cursor remains recovery mechanism |

The reference schema avoids PG enums and extension-specific UUID generation to reduce migration cost. MySQL still requires separate DDL, queries and tests. SQL-dialect differences and RLS limitations are documented in [storage evidence](track2-storage-evidence.md).

## 7. Retention, migrations and deletion

Reference defaults: keep accepted goals/constraints/decisions, task history and verification receipts for the project lifetime; keep source bytes needed to support retained evidence; expire token deltas and verbose logs under a declared policy. Exact default days should be selected from actual disk/capture measurements. Do not delete original evidence while retaining a “verified” claim whose source is no longer available.

Migrations have immutable checksums and explicit SQL/graph compatibility versions. Apply SQL changes under the migration-owner role and graph changes under a controlled no-admission window. Back up first; run invariant checks; update readiness only after indexes/constraints and cross-store references pass. If rollback would lose new-format data, restore a verified backup rather than pretending every migration is reversible.

Deletion/redaction uses a coordinated workflow: stop admission for affected scope, revoke access, mark source tombstones, invalidate dependent context/evidence, retire affected live sessions/descendants and rebuild fresh sanitized contexts without provider continuation, remove authorized payloads from SQL/blobs/backups according to policy, then verify no public export/citation leaks remain. Graph project deletion and SQL project deletion are not one transaction. Journal progress and reconcile partial deletion.

## 8. What schema verification means here

Planning validation checks field/diagram completeness, duplicate names, reference targets, Markdown links and parser syntax where tooling is available. It does not prove PostgreSQL migrations, RLS, FalkorDB Cypher, restore behavior, query plans or concurrent guards. Those are mandatory implementation-time probes recorded in [delivery and validation](track2-delivery-and-validation.md).

## 9. Review-driven contract additions

`model_requests` persists each provider transport attempt and its logical-request, input artifact, profile, context, reservation, response and usage binding. Unknown outcome is first-class. `command_inbox` journals human command delivery separately from runtime `capture_outbox`. Old-epoch commands are quarantined on restore, never relabelled to a new epoch and replayed as current authority.

`agent_sessions.authorization_kind/manifest/digest`, graph AgentSession and LaunchIntent carry role-specific authorization. Verifier has an immutable assignment binding candidate/criteria/epoch/revision/reservation rather than Builder's exclusive task claim. Criterion and VerificationReceipt bind protected acceptance-bundle and trusted-launcher digests. Graph session output visibility is narrowed by all loaded source scopes; derived private text never enters public state/event/receipt fields without an explicit authorized publication.

These fields and the [runtime boundaries](track2-runtime-and-protocols.md) are proposed application contracts. SQL JSON types do not enforce their domain schemas; validate canonical payloads and cross-store bindings through shared schemas and invariant tests. The [review resolution register](review/track2-review-resolutions.md) maps corrections to adversarial acceptance cases.

## 10. Persistence for the additional control tools

The 14-tool target registry (eleven in MVP) adds checklist updates, human clarification and command polling without adding tables or graph labels. Typed `capture_events`/tool artifacts preserve exact checklist/question payloads and command chunk sequences; `tool_executions` preserves the original invocation/process outcome; human answers use `project_messages` plus `command_inbox`; current checklists use the guarded checkpoint/source path. The service reconstructs pending questions and original running commands from these durable records before resuming. JSON payload schemas and source/revision binding are mandatory implementation contracts, not inferred from the generic SQL types. See [runtime section 19](track2-runtime-and-protocols.md#19-checklists-clarification-and-command-polling).

## 11. Selection priority versus stored evidence

Priority bands and representation decisions live in the immutable context-packet manifest, with source/version bindings and omission reasons. Run policy identifies the selection/summary template version and budgets. Existing Source/Observation/Attempt, checkpoint/Decision/Procedure and INCLUDES records supply provenance/applicability; SQL/artifact records retain permitted originals. No importance score changes task authority, and no new table/label is introduced for the proposed policy. Summary metadata retains the producing source's readership and is invalidated on incompatible revisions. Details are in [runtime section 20](track2-runtime-and-protocols.md#20-memory-priority-representation-and-retention).

## Development checkpoint and service-check bindings

The controlling [blueprint](track2-development-blueprint.md) and four [contract artifacts](contracts/) define exact sources/cursors and numeric limits. TaskState now binds `checkpoint_source_id`, producer session and covered position, plus `CHECKPOINT_SOURCE`; the manifest covers up to four session streams. VerificationReceipt binds `check_run_id` and service `verified_by_actor_id`, linked through `CHECKED_BY`. Its model verifier session is optional. `ProjectRoot-HAS_PROCEDURE` supplies scoped new-task discovery. These are proposed fields/relations, not migrated data.
