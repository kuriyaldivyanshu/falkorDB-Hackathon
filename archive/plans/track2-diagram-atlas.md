# Threadline detailed Mermaid diagram atlas

**Proposed owned-harness architecture, 15 October 2026.** These diagrams accompany [the final architecture](track2-final-architecture.md), [harness scope](track2-harness-scope.md), and [database model](track2-data-model.md). Solid/dotted lines distinguish ordinary and optional/asynchronous paths where indicated by labels; they do not imply a cross-store transaction. Native clients and SIWC are post-hackathon compatibility routes. The MVP has one logical Builder and a protected service checker. Target extension diagrams are references, not an implementation checklist. See the development blueprint.

Schema panels include every declared field. External entities are repeated as minimal anchors where needed; full fields live on their home panel. SQL FK optionality is derived from nullable columns. Graph associations use generic many-to-many marks; exact cardinalities and invariants are defined in the [graph dictionary](schema/graph-field-dictionary.md), not inferred from these association marks.

## Architecture and lifecycle

### Master Architecture

[Standalone source](diagrams/master-architecture.mmd)

```mermaid
flowchart LR
  subgraph interfaceLayer["User interfaces"]
    human["Developer"]
    tui["React / Ink TUI"]
    cli["CLI and diagnostics"]
    mcp["Optional scoped MCP gateway"]
  end
  subgraph backend["One TypeScript / Node coordinator"]
    api["Fastify: authenticated commands and SSE"]
    identity["Identity, membership and graph routing"]
    admission["Command policy and idempotency"]
    scheduler["Claims, budgets, spawn and handoff scheduler"]
    context["Current graph context and applicability"]
    ledger["Guarded graph ledger"]
    capture["Durable runtime capture and SQL outbox"]
    ingester["Observation-to-memory ingester"]
    projector["Graph Event projector and refresh delivery"]
    verifier["Candidate / criteria / evidence acceptance"]
  end
  subgraph execution["Execution and provider seam"]
    own["Primary: owned model / tool loop"]
    providers["Provider drivers and secret-owning broker"]
    tools["Validated tools and approvals"]
    sandbox["Isolated commands; no provider secrets"]
    builder["One Builder worktree"]
    checks["Protected service checker; immutable input plus scratch"]
    native["Post-hackathon official Codex / Claude runtime"]
  end
  subgraph storage["Persistent stores; independent commit boundaries"]
    pg[("PostgreSQL 18: users, user_sessions, capture, views")]
    graphDb[("FalkorDB: project authority, memory, Events")]
    objects[("Immutable logs, snapshots, packets, checkpoints")]
  end
  subgraph externalServices["Explicit inference routes"]
    apiModels["OpenAI / Anthropic / Gemini / tested compatible API"]
    nativeAuth["Native subscription login in official client"]
    localModel["Future local inference endpoint"]
    siwc["Post-hackathon eligible direct ChatGPT SIWC"]
  end
  human --> tui
  human --> cli
  tui --> api
  cli --> api
  mcp --> api
  api --> identity
  identity --> pg
  identity --> admission
  admission --> scheduler
  scheduler --> ledger
  scheduler --> own
  context --> graphDb
  own --> context
  own --> providers
  own --> tools
  tools --> sandbox
  sandbox --> builder
  sandbox --> checks
  own --> capture
  tools --> capture
  capture --> pg
  capture --> objects
  pg -.-> ingester
  ingester --> ledger
  ledger --> graphDb
  graphDb -.-> projector
  projector --> pg
  projector --> api
  projector --> context
  verifier --> ledger
  checks --> verifier
  verifier --> objects
  scheduler -.-> native
  native -.-> capture
  native -.-> nativeAuth
  providers --> apiModels
  providers -.-> localModel
  providers -.-> siwc
  admission -->|Durable human command inbox| pg
  providers -->|Model attempt journal| pg
```

### Backend Modules

[Standalone source](diagrams/backend-modules.mmd)

```mermaid
flowchart LR
  request["Typed user or worker command"] --> auth["Authenticate and resolve principal"]
  auth --> membership["Active tenant / project / source grants"]
  membership --> schema["Validate schema, sizes and canonical digest"]
  schema --> receipt["Resolve existing request receipt"]
  receipt --> guard["Check revision, fence, scope and evidence"]
  guard --> write["One atomic graph mutation"]
  write --> state["State revision plus current pointer"]
  write --> event["Event sequence plus RequestReceipt"]
  event --> notify["Wakeup hint"]
  event --> replay["Durable event replay"]
  replay --> sqlView["SQL projection with atomic cursor advance"]
  replay --> refresh["Affected context closure and worker refresh"]
  refresh --> insertion["Exact packet submission and ACK"]
  state --> selector["Bounded context selection"]
  selector --> insertion
```

### Owned Runtime Loop

[Standalone source](diagrams/owned-runtime-loop.mmd)

```mermaid
flowchart TD
  start["Current Builder claim and fence"] --> reconcile["Reconcile unknown actions"]
  reconcile --> context["Current mandatory context plus bounded history"]
  context --> fits{"Required context fits?"}
  fits -->|"No"| pause["Pause: narrow task or raise authorized budget"]
  fits -->|"Yes"| reserve["Reserve turn; persist model_requests attempt"]
  reserve --> model["Stream one provider response"]
  model --> persist["Persist complete visible response and tool requests"]
  persist --> toolCheck{"Tool calls requested?"}
  toolCheck -->|"Yes"| policy["Validate schema, role assignment, scope, epoch and approval"]
  policy --> intent["Persist action intent"]
  intent --> execute["Execute scoped tool in isolated environment"]
  execute --> result["Persist observed result; unknown if interrupted"]
  result --> graphMemory["Admit required evidence to graph"]
  graphMemory --> boundary["Checkpoint; settle usage; apply steering"]
  toolCheck -->|"No"| boundary
  boundary --> continueCheck{"Another turn permitted and needed?"}
  continueCheck -->|"Yes"| context
  continueCheck -->|"No"| stopped["Runtime stops; task awaits current verification"]
```

### Identity And Sessions

[Standalone source](diagrams/identity-and-sessions.mmd)

```mermaid
flowchart LR
  os["OS-protected local bootstrap"] --> session["Human user_sessions token"]
  session --> access["Active tenant and project membership"]
  access --> input["Atomic project_messages and command_inbox"]
  input --> run["Run policy and graph admission"]
  run --> agents["Builder / Verifier agent_sessions"]
  agents --> own["Threadline runtime context"]
  agents -.-> binding["Optional native_bindings"]
  agents --> capture["capture_events and session_messages"]
  agents --> packet["context_deliveries per submission occurrence"]
  access --> mapping["Trusted project to graph_key mapping"]
  mapping --> root["FalkorDB ProjectRoot and epoch"]
  packet --> loaded["Graph ContextLoad"]
```

### Sql Graph Reconciliation

[Standalone source](diagrams/sql-graph-reconciliation.mmd)

```mermaid
sequenceDiagram
  participant R as Runtime
  participant C as Capture service
  participant P as PostgreSQL
  participant I as Ingester
  participant G as FalkorDB
  participant V as Projector
  participant U as TUI or worker
  R->>C: Completed visible observation with stable source ID
  C->>P: BEGIN capture event and outbox
  P-->>C: COMMIT durable observation
  C-->>R: Captured, graph admission may be pending
  I->>P: Lease bounded ready outbox
  I->>G: Guarded idempotent admission
  G-->>I: Atomic anchors, Event, RequestReceipt
  I->>P: Mark original outbox receipt committed
  V->>G: Pull epoch and Events after cursor
  G-->>V: Ordered bounded committed Events
  V->>P: BEGIN apply projection and contiguous offset
  P-->>V: COMMIT
  V-->>U: Wakeup with scoped replay cursor
  U->>G: Through service: fetch current authorized packet
```

### Fresh Session Recovery

[Standalone source](diagrams/fresh-session-recovery.mmd)

```mermaid
sequenceDiagram
  participant H as Human
  participant C as Coordinator
  participant G as FalkorDB
  participant O as Old worker
  participant W as Workspace
  participant N as Fresh successor
  participant V as Trusted checker
  H->>C: Change requirement
  C->>C: SQL source plus durable command_inbox
  C->>G: Current version plus project revision barrier
  C->>G: Rebase affected task before further admission
  C->>G: Revoke old admission fence and offer handoff
  C->>O: Cancel and drain capture
  O-->>C: Termination confirmed or unknown
  C->>W: Inspect actual files and uncertain effects
  W-->>C: Reconciled candidate or quarantine
  C->>G: Retrieve current obligations and applicable attempts
  G-->>C: Versioned bounded context packet
  C->>N: Empty-history session and locally staged packet
  C->>G: Accept handoff, grant current claim and new fence
  C->>G: Rebuild packet against post-claim authority
  C->>N: Journal, reserve and submit first authorized request
  N-->>C: Actual submission / insertion acknowledgement
  N->>W: Continue scoped work
  C->>V: Run protected checks on exact immutable candidate
  V-->>C: Executable receipts
  C->>G: Guarded completion with matching evidence
```

### Requirement Invalidation

[Standalone source](diagrams/requirement-invalidation.mmd)

```mermaid
flowchart TD
  input["Human source plus command_inbox"] --> atom["Atomic current ConstraintVersion, project revision, Event and Receipt"]
  atom --> historical["Preserve SUPERSEDES and historical GOVERNED_BY"]
  atom --> barrier["Block tasks whose requirement revision is stale"]
  barrier --> rebase["Rebase applicable project, goal, task and artifact scopes"]
  rebase --> stable["Task SUBJECT_TO stable Constraint"]
  stable --> current["Constraint CURRENT_VERSION ConstraintVersion"]
  current --> valid{"Exactly one current required version per binding?"}
  valid -->|No| stop["Fail closed: missing, ambiguous or inaccessible authority"]
  valid -->|Yes| packet["Current bounded packet; generation rechecked"]
  packet --> invalidate["Historical receipts remain; stale completion rejected"]
  invalidate --> verify["New candidate-bound Verifier assignment"]
```

### Bounded Spawning

[Standalone source](diagrams/bounded-spawning.mmd)

```mermaid
flowchart TD
  phase["Post-hackathon reference; absent from core release"]
  proposal["Builder proposes narrow read-only investigation"] --> scope["Validate current claim, scope and prerequisite state"]
  scope --> duplicate{"Duplicate, cycle or depth exceeded?"}
  duplicate -->|"Yes"| deny["Reject or reuse existing result"]
  duplicate -->|"No"| capacity{"Shared slot and budget available?"}
  capacity -->|"No"| queue["Queue or continue sequentially"]
  capacity -->|"Yes"| reserve["Atomic Task, reservation, LaunchIntent and Event"]
  reserve --> launch["Supervisor starts tracked worker"]
  launch --> registered{"Launch token registered?"}
  registered -->|"Unknown"| reconcile["Keep reservation and reconcile stable launch ID"]
  registered -->|"Yes"| child["Child receives current packet and restricted tools"]
  child --> finding["Compact finding with source and artifact versions"]
  finding --> validate["Publication and applicability checks"]
  validate --> refresh["Refresh only relevant authorized work"]
  child --> stop["Deadline, tool cap, completion or cancel"]
  stop --> terminate["Confirm termination, settle usage and release slot"]
```

### Provider Routes

[Standalone source](diagrams/provider-routes.mmd)

```mermaid
flowchart LR
  phase["Route catalog; only one BYOK driver in hackathon"]
  profile["User-selected runtime and billing profile"] --> own["Owned Threadline loop"]
  profile --> native["Compatibility runtime"]
  own --> api["Explicit API credentials"]
  own -.-> siwc["Eligible local/open-source SIWC after its gate"]
  own -.-> local["Capability-tested local model"]
  api --> models["OpenAI / Anthropic / Gemini / tested compatible"]
  native --> codex["Official Codex app-server"]
  native --> claude["Official unmodified Claude Code"]
  codex --> codexAuth["Client-managed supported authentication"]
  claude --> claudeAuth["Client-managed supported authentication"]
  own --> memory["Same graph memory and evidence contract"]
  native --> memory
```

### Completion And Integration

[Standalone source](diagrams/completion-and-integration.mmd)

```mermaid
flowchart TD
  patch["Builder candidate checkpoint"] --> snapshot["Immutable candidate manifest"]
  snapshot --> verify["Verifier assignment plus protected acceptance bundle"]
  verify --> evidence["Receipts: candidate, environment, criteria, bundle, launcher, requirement"]
  evidence --> check{"All current required evidence valid?"}
  check -->|"No"| work["Return findings and require new work/checks"]
  check -->|"Yes"| complete["Guarded graph completion and receipt"]
  complete --> review["Human reviews patch and evidence"]
  review --> integrate["Authorized IntegrationIntent with expected target"]
  integrate --> external["Apply patch / Git operation outside graph transaction"]
  external --> actual["Inspect resulting tree and reconcile outcome"]
  actual --> match{"Expected integrated candidate?"}
  match -->|"No"| reverify["Block acceptance or run fresh verification"]
  match -->|"Yes"| receipt["Record integration result"]
```

### Deployment

[Standalone source](diagrams/deployment.mmd)

```mermaid
flowchart LR
  subgraph host["Developer host"]
    cli["npm CLI / React Ink TUI"]
    service["Node 24 TypeScript coordinator and provider broker"]
    secrets["Coordinator-only API environment and hashed app token"]
    own["Logical Builder sessions inside backend"]
    optionalNative["Post-hackathon official native clients"]
    files[("Project-scoped immutable artifact storage")]
  end
  subgraph containers["Pinned local containers"]
    pg[("PostgreSQL 18 and SQL volume")]
    falkor[("FalkorDB and configured persistence volume")]
    tools["Restricted command sandbox and workspace mount"]
  end
  providers["Selected remote or local inference"]
  cli --> service
  service --> secrets
  service --> own
  service --> pg
  service --> falkor
  own --> service
  own --> tools
  service --> files
  service --> providers
  service -.-> optionalNative
```

### State Machines

[Standalone source](diagrams/state-machines.mmd)

```mermaid
stateDiagram-v2
  [*] --> Planned
  Planned --> Ready: prerequisites accepted
  Ready --> Running: claim and new fence
  Running --> Blocked: approval or unknown effect
  Blocked --> Ready: reconciled and owner released
  Blocked --> Running: reconciled with valid claim
  Running --> Verifying: exact candidate snapshot
  Verifying --> Running: current checks fail
  Verifying --> Completed: current evidence accepted
  Completed --> Ready: relevant requirement changes
  Planned --> Cancelled: authorized cancellation
  Verifying --> Cancelled: authorized cancellation
  Running --> Cancelled: authorized cancellation
  Ready --> Cancelled: authorized cancellation
  Blocked --> Cancelled: authorized cancellation
  Cancelled --> [*]
```

### Chatgpt Oauth

[Standalone source](diagrams/chatgpt-oauth.mmd)

```mermaid
sequenceDiagram
  participant U as User and browser
  participant T as Threadline local OAuth module
  participant O as OpenAI authorization
  participant K as Protected local secret store
  participant D as PostgreSQL metadata
  participant P as Provider broker
  T->>T: Prepare host ID and one-use state, nonce, PKCE
  T->>U: Open official sign-in and consent
  U->>O: Authenticate and choose eligible plan permission
  O-->>T: Loopback callback with code, state and issued client ID
  T->>T: Validate callback against pending attempt
  T->>O: Exchange code with PKCE and issued client ID
  O-->>T: Tokens and granted scopes
  T->>T: Verify identity and plan permission
  T->>K: Atomically store registration credential bundle
  T->>D: Save nonsecret registration and secret reference
  P->>K: Resolve selected authorized credential
  P->>O: Stream supported Responses request
  O-->>P: Terminal response or explicit quota/auth error
  Note over T,P: No automatic switch to paid API billing
  Note over U,P: Post-hackathon route, no OAuth required by core BYOK slice
```

### Command Recovery

[Standalone source](diagrams/command-recovery.mmd)

```mermaid
sequenceDiagram
  participant H as Human
  participant C as Coordinator
  participant P as PostgreSQL
  participant G as FalkorDB
  H->>C: Authenticated goal/change with request ID and epoch
  C->>P: Commit source plus complete immutable command_inbox
  C-->>H: Durable pending ID, not accepted authority
  C->>P: Lease command and revalidate grants and epoch
  C->>G: Same epoch/request/digest with guarded admission
  G-->>C: Atomic state plus Event plus RequestReceipt
  Note over C,G: Lost reply causes receipt reconciliation, not blind effect replay
  C->>G: Resolve original epoch/request and compare digest
  G-->>C: Committed receipt or conflict
  C->>P: Settle leased command from observed result
  C-->>H: Accepted or rejected/quarantined
  Note over P,G: New graph epoch quarantines old domain/effect commands
```

### Privacy Revocation

[Standalone source](diagrams/privacy-revocation.mmd)

```mermaid
flowchart TD
  read["Authorized source load"] --> narrow["Narrow session output readership before dispatch"]
  narrow --> output["Derived text retains restricted scope"]
  output --> publish{"Explicit authorized redacted Publication?"}
  publish -->|No| private["Private observation; safe shared status only"]
  publish -->|Yes| shared["New reviewed shared record"]
  revoke["Membership or source access revoked"] --> gate["Serialize permission commit and deny new admission"]
  gate --> retire["Retire exposed sessions and descendants"]
  retire --> cancel["Cancel and reconcile in-flight work"]
  cancel --> discard["Discard conversation and opaque continuation"]
  discard --> fresh["New session with sanitized permitted context"]
  gate -.-> limit["Previously sent bytes cannot be recalled"]
```

### Harness Tool Surface

[Standalone source](diagrams/harness-tool-surface.mmd)

```mermaid
flowchart LR
  model["Owned model / tool loop"] --> policy["Schema, role, scope, epoch, budget and approval gate"]
  subgraph workspace["Workspace: six tools"]
    read["read / search / inspect"]
    patch["apply_patch: Builder only"]
    run["run: registered isolated command"]
    poll["poll: same scoped execution, captured output only"]
  end
  subgraph control["Task and interaction: three tools"]
    plan["update_plan: Builder tactical checklist"]
    ask["ask_user: one durable clarification"]
    finish["request_completion: deterministic evidence gate"]
  end
  subgraph memory["Memory: four tools"]
    retrieve["retrieve / refresh"]
    checkpoint["checkpoint: current owner and output scope"]
    propose["propose_decision: scoped proposal"]
  end
  review["review.submit: Verifier assigned candidate"]
  policy --> read
  policy --> patch
  policy --> run
  policy --> poll
  policy --> plan
  policy --> ask
  policy --> finish
  policy --> retrieve
  policy --> checkpoint
  policy --> propose
  policy --> review
  run --> capture["SQL capture, tool intent, process/output observations"]
  capture --> poll
  plan --> ledgerState["Guarded graph checkpoint, sources and current authority"]
  checkpoint --> ledgerState
  finish --> ledgerState
  review --> ledgerState
  ask --> tui["TUI question and authenticated human answer"]
  tui --> inbox["Durable source plus command_inbox"]
  inbox --> current["Revalidate answer binding and requirement revision"]
  current --> model
  plan -.-> limit["Checklist status cannot satisfy verification"]
```

### Development Mvp

[Standalone source](diagrams/development-mvp.mmd)

```mermaid
flowchart LR
  H["Local developer and Ink TUI"] --> C["One TypeScript backend: accepted requirements, claims and budgets"]
  C --> B["One logical Builder; fresh successor only after retirement"]
  B --> P["Journaled OpenAI Responses request; user API key"]
  B --> T["Eleven bounded typed tools"]
  T --> X["Isolated command container; no network or secrets"]
  X --> W["Candidate snapshot plus bounded scratch"]
  T --> E["Durable intent, result, Source and episode"]
  E --> SQL[("PostgreSQL capture, identities and request journals")]
  E --> G[("FalkorDB authority, memory links and events")]
  E --> A[("Immutable logs, checkpoints and packets")]
  G --> R["Bounded exact authority and compatible sourced advice"]
  R --> B
  C --> V["Protected trusted supervisor and assertions"]
  V --> W
  V --> Q["Service receipt: candidate, criteria and environment identity"]
  Q --> C
  C --> F["Guarded completion or rejection"]
```

### Checkpoint Recovery

[Standalone source](diagrams/checkpoint-recovery.mmd)

```mermaid
flowchart TD
  I["Persist critical tool intent"] --> O["Execute isolated action"]
  O --> T["Durable terminal result or explicit unknown"]
  T --> S["Immutable Source and deterministic Observation / Attempt"]
  S --> K["Checkpoint manifest with per-session covered positions"]
  K --> G["TaskState pointer plus CHECKPOINT_SOURCE"]
  crash["Crash before agent checkpoint"] --> reconcile["Reconcile effect and drain graph admission"]
  G --> reconcile
  reconcile --> tail["Ordered uncovered tail: batches 100, cap 1000"]
  tail --> gap{"Critical gap or overflow?"}
  gap -->|Yes| block["Block inference; reconcile or checkpoint safely"]
  gap -->|No| retire["Confirm old writer stopped or quarantine"]
  retire --> stage["Stage local fresh packet"]
  stage --> claim["Atomic successor claim and new fence"]
  claim --> render["Rebuild current exact authority under new claim"]
  render --> submit["Journal and submit first authorized request"]
  submit --> ack["Actual submission acknowledgement"]
```

### Tool Surface

[Standalone source](diagrams/tool-surface.mmd)

```mermaid
flowchart LR
  model["One Builder"] --> policy["Schema, role, revision, fence and size guards"]
  policy --> w["Workspace: read, search, inspect, apply_patch, run"]
  policy --> m["Memory: retrieve, refresh, checkpoint"]
  policy --> c["Control: update_plan, ask_user, request_completion"]
  w --> logs["Synchronous registered commands; captured TUI stream"]
  m --> source["Search advice or read authorized Source ranges"]
  c --> checker["Protected deterministic checker gates completion"]
  later["Deferred target tools: poll, propose_decision, review.submit"]
```

## Relational schema

### Sql Identity

[Standalone source](diagrams/sql-identity.mmd)

```mermaid
erDiagram
    direction LR
    users {
        uuid id PK
        text display_name
        text status
        timestamptz created_at
    }
    auth_identities {
        uuid id PK
        uuid user_id FK
        text issuer
        text subject
        timestamptz created_at
    }
    tenants {
        uuid id PK
        text slug
        text name
        text status
        timestamptz created_at
    }
    tenant_memberships {
        uuid tenant_id FK
        uuid id PK
        uuid user_id FK
        text role
        text status
        timestamptz created_at
    }
    projects {
        uuid tenant_id FK
        uuid id PK
        text slug
        text graph_key
        uuid graph_epoch
        text status
        integer schema_version
        timestamptz created_at
    }
    project_memberships {
        uuid tenant_id FK
        uuid project_id FK
        uuid id PK
        uuid user_id FK
        text role
        text status
        timestamptz created_at
    }
    user_sessions {
        uuid tenant_id FK
        uuid id PK
        uuid user_id FK
        char token_hash
        text auth_method
        timestamptz created_at
        timestamptz last_seen_at
        timestamptz expires_at
        timestamptz idle_expires_at
        timestamptz revoked_at
        text client_label
    }
    audit_events {
        uuid tenant_id FK
        uuid id PK
        uuid actor_user_id FK
        text kind
        uuid target_id
        uuid request_id
        jsonb payload
        timestamptz created_at
    }
    users ||--o{ auth_identities : "references"
    tenants ||--o{ tenant_memberships : "tenant_id"
    users ||--o{ tenant_memberships : "references"
    tenants ||--o{ projects : "tenant_id"
    tenant_memberships ||--o{ project_memberships : "user_id"
    projects ||--o{ project_memberships : "project_id"
    tenant_memberships ||--o{ user_sessions : "user_id"
    tenants ||--o{ user_sessions : "tenant_id"
    tenant_memberships o|--o{ audit_events : "actor_user_id"
    tenants ||--o{ audit_events : "tenant_id"
```

### Sql Execution

[Standalone source](diagrams/sql-execution.mmd)

```mermaid
erDiagram
    direction LR
    worker_hosts {
        uuid tenant_id FK
        uuid id PK
        uuid user_id FK
        text name
        char credential_hash
        timestamptz credential_expires_at
        uuid boot_id
        jsonb allowed_roots
        jsonb capabilities
        timestamptz last_seen_at
        timestamptz revoked_at
        timestamptz created_at
    }
    workspace_registrations {
        uuid tenant_id FK
        uuid project_id FK
        uuid id PK
        uuid host_id FK
        text canonical_path
        char repository_fingerprint
        text kind
        text status
        text base_commit
        timestamptz created_at
    }
    runs {
        uuid tenant_id FK
        uuid project_id FK
        uuid id PK
        uuid initiated_by FK
        uuid initial_profile_id FK
        jsonb policy
        char policy_digest
        text observed_status
        uuid projected_epoch
        bigint projected_seq
        timestamptz created_at
        timestamptz finished_at
    }
    agent_sessions {
        uuid tenant_id FK
        uuid project_id FK
        uuid id PK
        uuid run_id FK
        uuid task_graph_id
        uuid parent_session_id FK
        uuid profile_id FK
        uuid workspace_id FK
        text role
        text authorization_kind
        jsonb authorization_manifest
        char authorization_digest
        text runtime_status
        bigint capture_seq
        timestamptz started_at
        timestamptz ended_at
        timestamptz created_at
    }
    native_bindings {
        uuid tenant_id FK
        uuid project_id FK
        uuid id PK
        uuid agent_session_id FK
        text native_session_id
        text native_runtime
        text native_version
        char protocol_digest
        text mode
        timestamptz created_at
    }
    launch_attempts {
        uuid tenant_id FK
        uuid project_id FK
        uuid id PK
        uuid agent_session_id FK
        uuid launch_graph_id
        uuid host_id FK
        integer attempt_no
        bigint process_id
        text process_start_identity
        text status
        timestamptz created_at
        timestamptz reconciled_at
    }
    tenant_memberships ||--o{ worker_hosts : "user_id"
    tenants ||--o{ worker_hosts : "tenant_id"
    worker_hosts ||--o{ workspace_registrations : "host_id"
    projects ||--o{ workspace_registrations : "project_id"
    provider_profiles ||--o{ runs : "initial_profile_id"
    project_memberships ||--o{ runs : "initiated_by"
    projects ||--o{ runs : "project_id"
    runs ||--o{ agent_sessions : "run_id"
    provider_profiles ||--o{ agent_sessions : "profile_id"
    workspace_registrations ||--o{ agent_sessions : "workspace_id"
    agent_sessions o|--o{ agent_sessions : "parent_session_id"
    projects ||--o{ agent_sessions : "project_id"
    agent_sessions ||--o{ native_bindings : "agent_session_id"
    projects ||--o{ native_bindings : "project_id"
    agent_sessions ||--o{ launch_attempts : "agent_session_id"
    worker_hosts ||--o{ launch_attempts : "host_id"
    projects ||--o{ launch_attempts : "project_id"
```

### Sql Providers

[Standalone source](diagrams/sql-providers.mmd)

```mermaid
erDiagram
    direction LR
    provider_accounts {
        uuid tenant_id FK
        uuid id PK
        uuid user_id FK
        text provider
        text runtime
        text auth_route
        text label
        text secret_ref
        text native_profile_ref
        timestamptz last_probe_at
        text probe_status
        timestamptz created_at
    }
    provider_profiles {
        uuid tenant_id FK
        uuid project_id FK
        uuid id PK
        uuid owner_user_id FK
        uuid provider_account_id FK
        text name
        text model_id
        text adapter_version
        text effort
        jsonb settings
        char config_digest
        timestamptz created_at
    }
    usage_ledger {
        uuid tenant_id FK
        uuid project_id FK
        uuid id PK
        uuid agent_session_id FK
        text source_key
        bigint input_tokens
        bigint output_tokens
        bigint cost_microunits
        char currency
        text precision
        uuid reservation_graph_id
        timestamptz observed_at
    }
    provider_oauth_registrations {
        uuid tenant_id FK
        uuid id PK
        uuid user_id FK
        uuid provider_account_id FK
        uuid host_id FK
        text issuer
        text subject
        text client_id
        text ext_agent_host_id
        text[] scopes
        text status
        bigint credential_version
        timestamptz validated_at
        timestamptz created_at
    }
    tenant_memberships ||--o{ provider_accounts : "user_id"
    tenants ||--o{ provider_accounts : "tenant_id"
    provider_accounts ||--o{ provider_profiles : "provider_account_id"
    projects ||--o{ provider_profiles : "project_id"
    agent_sessions ||--o{ usage_ledger : "agent_session_id"
    projects ||--o{ usage_ledger : "project_id"
    provider_accounts ||--o{ provider_oauth_registrations : "provider_account_id"
    worker_hosts ||--o{ provider_oauth_registrations : "host_id"
    tenants ||--o{ provider_oauth_registrations : "tenant_id"
```

### Sql History

[Standalone source](diagrams/sql-history.mmd)

```mermaid
erDiagram
    direction LR
    capture_events {
        uuid tenant_id FK
        uuid project_id FK
        uuid id PK
        uuid agent_session_id FK
        text source_key
        bigint capture_seq
        text kind
        jsonb payload
        char payload_digest
        uuid raw_artifact_id FK
        timestamptz observed_at
        timestamptz captured_at
    }
    session_messages {
        uuid tenant_id FK
        uuid project_id FK
        uuid id PK
        uuid agent_session_id FK
        uuid capture_event_id FK
        bigint message_seq
        text role
        text body
        uuid body_artifact_id FK
        char body_digest
        text visibility
        uuid owner_user_id FK
        boolean is_partial
        timestamptz created_at
    }
    tool_executions {
        uuid tenant_id FK
        uuid project_id FK
        uuid id PK
        uuid agent_session_id FK
        uuid capture_event_id FK
        text runtime_call_id
        text tool_name
        char input_digest
        uuid input_artifact_id FK
        uuid output_artifact_id FK
        text status
        integer exit_code
        char candidate_digest
        timestamptz started_at
        timestamptz finished_at
    }
    tool_approvals {
        uuid tenant_id FK
        uuid project_id FK
        uuid id PK
        uuid agent_session_id FK
        text runtime_request_id
        uuid tool_execution_id FK
        char request_digest
        jsonb request_payload
        text status
        uuid decided_by FK
        timestamptz expires_at
        timestamptz decided_at
        timestamptz created_at
    }
    capture_gaps {
        uuid tenant_id FK
        uuid project_id FK
        uuid id PK
        uuid agent_session_id FK
        bigint from_seq
        bigint to_seq
        text reason
        text status
        timestamptz created_at
    }
    project_messages {
        uuid tenant_id FK
        uuid project_id FK
        uuid id PK
        uuid author_user_id FK
        uuid user_session_id FK
        uuid run_id FK
        uuid request_id
        text body
        char body_digest
        text visibility
        timestamptz created_at
    }
    model_requests {
        uuid tenant_id FK
        uuid project_id FK
        uuid id PK
        uuid agent_session_id FK
        uuid logical_request_id
        integer attempt_no
        uuid profile_id FK
        uuid context_packet_id FK
        uuid input_artifact_id FK
        char input_digest
        char profile_digest
        uuid graph_epoch
        bigint requirement_revision
        uuid reservation_graph_id
        text provider_request_id
        text status
        uuid response_artifact_id FK
        text usage_source_key FK
        text failure_code
        timestamptz created_at
        timestamptz dispatched_at
        timestamptz finished_at
    }
    agent_sessions ||--o{ capture_events : "agent_session_id"
    artifacts o|--o{ capture_events : "raw_artifact_id"
    projects ||--o{ capture_events : "project_id"
    agent_sessions ||--o{ session_messages : "agent_session_id"
    capture_events ||--o{ session_messages : "capture_event_id"
    artifacts o|--o{ session_messages : "body_artifact_id"
    tenant_memberships o|--o{ session_messages : "owner_user_id"
    projects ||--o{ session_messages : "project_id"
    agent_sessions ||--o{ tool_executions : "agent_session_id"
    capture_events ||--o{ tool_executions : "capture_event_id"
    artifacts o|--o{ tool_executions : "input_artifact_id"
    projects ||--o{ tool_executions : "project_id"
    agent_sessions ||--o{ tool_approvals : "agent_session_id"
    tool_executions o|--o{ tool_approvals : "tool_execution_id"
    project_memberships o|--o{ tool_approvals : "decided_by"
    projects ||--o{ tool_approvals : "project_id"
    agent_sessions ||--o{ capture_gaps : "agent_session_id"
    projects ||--o{ capture_gaps : "project_id"
    project_memberships ||--o{ project_messages : "author_user_id"
    user_sessions ||--o{ project_messages : "user_session_id"
    runs o|--o{ project_messages : "run_id"
    projects ||--o{ project_messages : "project_id"
    agent_sessions ||--o{ model_requests : "agent_session_id"
    provider_profiles ||--o{ model_requests : "profile_id"
    context_packets o|--o{ model_requests : "context_packet_id"
    artifacts ||--o{ model_requests : "input_artifact_id"
    usage_ledger o|--o{ model_requests : "usage_source_key"
    projects ||--o{ model_requests : "project_id"
```

### Sql Synchronization

[Standalone source](diagrams/sql-synchronization.mmd)

```mermaid
erDiagram
    direction LR
    capture_outbox {
        uuid tenant_id FK
        uuid project_id FK
        uuid id PK
        uuid capture_event_id FK
        uuid operation_id
        char request_digest
        text status
        integer attempts
        uuid lease_owner
        timestamptz lease_expires_at
        timestamptz next_attempt_at
        uuid graph_epoch
        bigint graph_event_seq
        text last_error_code
        timestamptz created_at
    }
    graph_event_projection {
        uuid tenant_id FK
        uuid project_id FK
        uuid id PK
        uuid graph_epoch
        bigint event_seq
        uuid event_graph_id
        text kind
        uuid aggregate_graph_id
        jsonb payload
        char payload_digest
        timestamptz committed_at
        timestamptz projected_at
    }
    projection_offsets {
        uuid tenant_id FK
        uuid project_id FK
        uuid id PK
        text consumer_name
        uuid graph_epoch
        bigint last_contiguous_seq
        timestamptz updated_at
    }
    command_inbox {
        uuid tenant_id FK
        uuid project_id FK
        uuid id PK
        uuid initiated_by FK
        uuid user_session_id FK
        uuid source_message_id FK
        uuid request_id
        uuid graph_epoch
        text operation
        jsonb payload
        char request_digest
        text status
        integer attempts
        uuid lease_owner
        timestamptz lease_expires_at
        timestamptz next_attempt_at
        uuid graph_receipt_id
        bigint graph_event_seq
        text last_error_code
        timestamptz created_at
        timestamptz settled_at
    }
    capture_events ||--o{ capture_outbox : "capture_event_id"
    projects ||--o{ capture_outbox : "project_id"
    projects ||--o{ graph_event_projection : "project_id"
    projects ||--o{ projection_offsets : "project_id"
    project_memberships ||--o{ command_inbox : "initiated_by"
    user_sessions ||--o{ command_inbox : "user_session_id"
    project_messages o|--o{ command_inbox : "source_message_id"
    projects ||--o{ command_inbox : "project_id"
```

### Sql Evidence

[Standalone source](diagrams/sql-evidence.mmd)

```mermaid
erDiagram
    direction LR
    artifacts {
        uuid tenant_id FK
        uuid project_id FK
        uuid id PK
        char content_digest
        text storage_key
        text kind
        text media_type
        bigint byte_size
        text visibility
        uuid owner_user_id FK
        uuid owner_session_id FK
        text status
        timestamptz created_at
    }
    context_packets {
        uuid tenant_id FK
        uuid project_id FK
        uuid id PK
        uuid task_graph_id
        uuid graph_epoch
        bigint task_revision
        bigint requirement_revision
        bigint graph_generation
        uuid content_artifact_id FK
        char content_digest
        integer token_count
        text count_precision
        timestamptz created_at
    }
    context_deliveries {
        uuid tenant_id FK
        uuid project_id FK
        uuid id PK
        uuid agent_session_id FK
        uuid context_packet_id FK
        uuid submission_id
        text runtime_turn_id
        text status
        timestamptz submitted_at
        timestamptz acknowledged_at
        uuid graph_ack_id
        timestamptz created_at
    }
    agent_sessions o|--o{ artifacts : "owner_session_id"
    tenant_memberships o|--o{ artifacts : "owner_user_id"
    projects ||--o{ artifacts : "project_id"
    artifacts ||--o{ context_packets : "content_artifact_id"
    projects ||--o{ context_packets : "project_id"
    agent_sessions ||--o{ context_deliveries : "agent_session_id"
    context_packets ||--o{ context_deliveries : "context_packet_id"
    projects ||--o{ context_deliveries : "project_id"
```

### Sql Operations

[Standalone source](diagrams/sql-operations.mmd)

```mermaid
erDiagram
    direction LR
    schema_migrations {
        uuid id PK
        text store
        integer version
        char checksum
        timestamptz applied_at
    }
```

## FalkorDB schema

### Graph Authority

[Standalone source](diagrams/graph-authority.mmd)

```mermaid
erDiagram
    direction LR
    %% Graph edges are associations; exact multiplicities are in the graph dictionary.
    ProjectRoot {
        string id PK
        integer schema_version
        integer created_at_ms
        string producer_id
        string visibility
        string visibility_user_id
        string visibility_session_id
        string tenant_id
        string project_id
        string graph_epoch
        integer generation
        integer next_event_seq
        integer requirement_revision
        string status
    }
    ActorRef {
        string id PK
        integer schema_version
        integer created_at_ms
        string producer_id
        string visibility
        string visibility_user_id
        string visibility_session_id
        string actor_kind
        string sql_id
        string display_label
    }
    Run {
        string id PK
        integer schema_version
        integer created_at_ms
        string producer_id
        string visibility
        string visibility_user_id
        string visibility_session_id
        string policy_digest
        string status
        integer max_live_workers
        integer reserved_slots
        integer child_launch_count
        integer max_child_launches
        integer reserved_tokens
        integer used_tokens
        boolean usage_unknown
        integer max_tokens
        integer deadline_ms
    }
    Goal {
        string id PK
        integer schema_version
        integer created_at_ms
        string producer_id
        string visibility
        string visibility_user_id
        string visibility_session_id
        integer current_revision
        string status
    }
    GoalVersion {
        string id PK
        integer schema_version
        integer created_at_ms
        string producer_id
        string visibility
        string visibility_user_id
        string visibility_session_id
        integer revision
        string text
        string criteria_digest
        string source_id
    }
    Constraint {
        string id PK
        integer schema_version
        integer created_at_ms
        string producer_id
        string visibility
        string visibility_user_id
        string visibility_session_id
        integer current_revision
        string scope_kind
        string scope_id
    }
    ConstraintVersion {
        string id PK
        integer schema_version
        integer created_at_ms
        string producer_id
        string visibility
        string visibility_user_id
        string visibility_session_id
        integer revision
        string text
        string polarity
        string accepted_by
        string source_id
        integer valid_from_revision
    }
    Criterion {
        string id PK
        integer schema_version
        integer created_at_ms
        string producer_id
        string visibility
        string visibility_user_id
        string visibility_session_id
        string kind
        string check_ref
        string acceptance_bundle_digest
        string launcher_digest
        string expected_result
        boolean required
        integer timeout_ms
        string criteria_digest
    }
    Task {
        string id PK
        integer schema_version
        integer created_at_ms
        string producer_id
        string visibility
        string visibility_user_id
        string visibility_session_id
        string run_id
        integer current_revision
        string current_status
        string owner_session_id
        integer fence
        integer requirement_revision
        integer depth
    }
    TaskState {
        string id PK
        integer schema_version
        integer created_at_ms
        string producer_id
        string visibility
        string visibility_user_id
        string visibility_session_id
        string task_id
        integer revision
        string status
        string owner_session_id
        integer fence
        integer lease_expires_ms
        integer requirement_revision
        string checkpoint_text
        string checkpoint_source_id
        string checkpoint_session_id
        integer checkpoint_capture_seq
        string candidate_digest
        boolean unresolved_effects
    }
    ProjectRoot }o..o{ Run : "HAS_RUN"
    ProjectRoot }o..o{ Goal : "HAS_GOAL"
    ProjectRoot }o..o{ Constraint : "HAS_CONSTRAINT"
    ProjectRoot }o..o{ Procedure : "HAS_PROCEDURE"
    Goal }o..o{ GoalVersion : "CURRENT_VERSION"
    Constraint }o..o{ ConstraintVersion : "CURRENT_VERSION"
    GoalVersion }o..o{ Criterion : "REQUIRES"
    GoalVersion }o..o{ Source : "SOURCED_FROM"
    ConstraintVersion }o..o{ Source : "SOURCED_FROM"
    ConstraintVersion }o..o{ ConstraintVersion : "SUPERSEDES"
    GoalVersion }o..o{ GoalVersion : "SUPERSEDES"
    Goal }o..o{ Task : "DECOMPOSES_INTO"
    Task }o..o{ Constraint : "SUBJECT_TO"
    Constraint }o..o{ ConstraintVersion : "HAS_VERSION"
    Goal }o..o{ GoalVersion : "HAS_VERSION"
    Task }o..o{ ConstraintVersion : "GOVERNED_BY"
    Task }o..o{ Criterion : "REQUIRES"
    Run }o..o{ Task : "HAS_TASK"
    Task }o..o{ Task : "SUBTASK_OF"
    Task }o..o{ Task : "DEPENDS_ON"
    Task }o..o{ TaskState : "CURRENT_STATE"
    TaskState }o..o{ TaskState : "PREVIOUS_STATE"
    TaskState }o..o{ AgentSession : "OWNED_BY"
    Task }o..o{ Workspace : "USES_WORKSPACE"
    Run }o..o{ AgentSession : "HAS_SESSION"
    TaskState }o..o{ ArtifactVersion : "HAS_ARTIFACT"
    TaskState }o..o{ Source : "CHECKPOINT_SOURCE"
    Task }o..o{ ArtifactVersion : "TOUCHES"
    TaskState }o..o{ VerificationReceipt : "ACCEPTED_RECEIPT"
    Run }o..o{ BudgetReservation : "RESERVES"
```

### Graph Execution

[Standalone source](diagrams/graph-execution.mmd)

```mermaid
erDiagram
    direction LR
    %% Graph edges are associations; exact multiplicities are in the graph dictionary.
    Workspace {
        string id PK
        integer schema_version
        integer created_at_ms
        string producer_id
        string visibility
        string visibility_user_id
        string visibility_session_id
        string sql_id
        string kind
        string host_id
        string repository_fingerprint
    }
    AgentSession {
        string id PK
        integer schema_version
        integer created_at_ms
        string producer_id
        string visibility
        string visibility_user_id
        string visibility_session_id
        string sql_id
        string run_id
        string role
        string status
        integer last_capture_seq
        integer loaded_requirement_revision
        string authorization_kind
        string authorization_digest
        string authorization_json
        string output_visibility
        string output_owner_user_id
        string output_owner_session_id
    }
    Handoff {
        string id PK
        integer schema_version
        integer created_at_ms
        string producer_id
        string visibility
        string visibility_user_id
        string visibility_session_id
        string task_id
        string from_session_id
        string to_session_id
        string status
        integer old_fence
        integer expected_revision
        string packet_id
        boolean termination_confirmed
    }
    BudgetReservation {
        string id PK
        integer schema_version
        integer created_at_ms
        string producer_id
        string visibility
        string visibility_user_id
        string visibility_session_id
        string run_id
        string launch_id
        integer slots
        integer tokens_reserved
        integer max_cost_microunits
        string status
        integer deadline_ms
        string usage_precision
    }
    LaunchIntent {
        string id PK
        integer schema_version
        integer created_at_ms
        string producer_id
        string visibility
        string visibility_user_id
        string visibility_session_id
        string run_id
        string task_id
        string agent_session_id
        string parent_session_id
        string request_signature
        string status
        string reservation_id
        integer claim_fence
        string authorization_digest
    }
    AgentSession }o..o{ Observation : "PRODUCED"
    AgentSession }o..o{ Message : "HAS_MESSAGE"
    AgentSession }o..o{ ContextPacket : "LOADED"
    Handoff }o..o{ Task : "TRANSFERS"
    Handoff }o..o{ AgentSession : "FROM_SESSION"
    Handoff }o..o{ AgentSession : "TO_SESSION"
    LaunchIntent }o..o{ BudgetReservation : "CONSUMES"
    LaunchIntent }o..o{ AgentSession : "STARTS"
    LaunchIntent }o..o{ Task : "FOR_TASK"
```

### Graph Memory

[Standalone source](diagrams/graph-memory.mmd)

```mermaid
erDiagram
    direction LR
    %% Graph edges are associations; exact multiplicities are in the graph dictionary.
    Source {
        string id PK
        integer schema_version
        integer created_at_ms
        string producer_id
        string visibility
        string visibility_user_id
        string visibility_session_id
        string source_kind
        string source_sql_id
        string content_digest
        string locator_ref
        string availability
    }
    Message {
        string id PK
        integer schema_version
        integer created_at_ms
        string producer_id
        string visibility
        string visibility_user_id
        string visibility_session_id
        string session_id
        integer message_seq
        string role
        string body_digest
        string source_id
        boolean is_partial
    }
    Observation {
        string id PK
        integer schema_version
        integer created_at_ms
        string producer_id
        string visibility
        string visibility_user_id
        string visibility_session_id
        string capture_event_id
        string session_id
        integer capture_seq
        string kind
        string payload_digest
        string outcome
    }
    Attempt {
        string id PK
        integer schema_version
        integer created_at_ms
        string producer_id
        string visibility
        string visibility_user_id
        string visibility_session_id
        string task_id
        string hypothesis
        string outcome
        integer requirement_revision
        string environment_digest
        string summary
    }
    Decision {
        string id PK
        integer schema_version
        integer created_at_ms
        string producer_id
        string visibility
        string visibility_user_id
        string visibility_session_id
        string status
        string choice
        string rationale
        string scope_task_id
        integer requirement_revision
        string accepted_by
        string rejected_alternative
    }
    Finding {
        string id PK
        integer schema_version
        integer created_at_ms
        string producer_id
        string visibility
        string visibility_user_id
        string visibility_session_id
        string status
        string statement
        string scope_task_id
        integer requirement_revision
        string artifact_digest
        string evidence_status
    }
    Procedure {
        string id PK
        integer schema_version
        integer created_at_ms
        string producer_id
        string visibility
        string visibility_user_id
        string visibility_session_id
        string name
        integer version
        string steps_json
        string preconditions_json
        string status
        integer heldout_reuse_count
        string policy_digest
    }
    Publication {
        string id PK
        integer schema_version
        integer created_at_ms
        string producer_id
        string visibility
        string visibility_user_id
        string visibility_session_id
        string source_record_id
        string published_record_id
        string source_policy_digest
        string accepted_by
        string status
    }
    Message }o..o{ Source : "SOURCED_FROM"
    Observation }o..o{ Source : "SOURCED_FROM"
    Attempt }o..o{ Task : "ATTEMPTS"
    Attempt }o..o{ Observation : "EVIDENCED_BY"
    Attempt }o..o{ ArtifactVersion : "PRODUCES"
    Decision }o..o{ Task : "APPLIES_TO"
    Decision }o..o{ Source : "SUPPORTED_BY"
    Finding }o..o{ Task : "APPLIES_TO"
    Finding }o..o{ Source : "SUPPORTED_BY"
    Finding }o..o{ Finding : "CONTRADICTS"
    Decision }o..o{ Decision : "SUPERSEDES"
    Finding }o..o{ Finding : "SUPERSEDES"
    Decision }o..o{ ConstraintVersion : "DEPENDS_ON"
    Finding }o..o{ ArtifactVersion : "DEPENDS_ON"
    Procedure }o..o{ VerificationReceipt : "VALIDATED_BY"
    Procedure }o..o{ ConstraintVersion : "REQUIRES"
    Attempt }o..o{ Procedure : "USES_PROCEDURE"
    Publication }o..o{ Finding : "PUBLISHES"
    Publication }o..o{ Decision : "PUBLISHES"
    Publication }o..o{ Source : "SOURCED_FROM"
```

### Graph Evidence

[Standalone source](diagrams/graph-evidence.mmd)

```mermaid
erDiagram
    direction LR
    %% Graph edges are associations; exact multiplicities are in the graph dictionary.
    ArtifactVersion {
        string id PK
        integer schema_version
        integer created_at_ms
        string producer_id
        string visibility
        string visibility_user_id
        string visibility_session_id
        string sql_artifact_id
        string content_digest
        string candidate_digest
        string base_commit
        string environment_digest
        string relative_path
        string kind
    }
    VerificationReceipt {
        string id PK
        integer schema_version
        integer created_at_ms
        string producer_id
        string visibility
        string visibility_user_id
        string visibility_session_id
        string candidate_digest
        string environment_digest
        string criteria_digest
        string acceptance_bundle_digest
        string launcher_digest
        integer requirement_revision
        string command_digest
        integer exit_code
        string status
        string check_run_id
        string verified_by_actor_id
        string verifier_session_id
        integer verified_at_ms
    }
    ContextPacket {
        string id PK
        integer schema_version
        integer created_at_ms
        string producer_id
        string visibility
        string visibility_user_id
        string visibility_session_id
        string task_id
        string sql_id
        string content_digest
        integer task_revision
        integer requirement_revision
        integer graph_generation
        integer mandatory_count
        integer omitted_optional_count
        integer token_count
    }
    ContextLoad {
        string id PK
        integer schema_version
        integer created_at_ms
        string producer_id
        string visibility
        string visibility_user_id
        string visibility_session_id
        string session_id
        string packet_id
        string submission_id
        string runtime_turn_id
        string ack_kind
        integer acknowledged_at_ms
        integer requirement_revision
    }
    IntegrationIntent {
        string id PK
        integer schema_version
        integer created_at_ms
        string producer_id
        string visibility
        string visibility_user_id
        string visibility_session_id
        string task_id
        string candidate_digest
        string expected_target_digest
        string status
        string result_digest
        string operation_id
    }
    VerificationReceipt }o..o{ ArtifactVersion : "VERIFIES"
    VerificationReceipt }o..o{ Criterion : "SATISFIES"
    VerificationReceipt }o..o{ Observation : "EVIDENCED_BY"
    VerificationReceipt }o..o{ ActorRef : "CHECKED_BY"
    ContextPacket }o..o{ Task : "FOR_TASK"
    ContextLoad }o..o{ ContextPacket : "ACKS"
    ContextLoad }o..o{ AgentSession : "BY_SESSION"
    IntegrationIntent }o..o{ ArtifactVersion : "ADOPTS"
```

### Graph Synchronization

[Standalone source](diagrams/graph-synchronization.mmd)

```mermaid
erDiagram
    direction LR
    %% Graph edges are associations; exact multiplicities are in the graph dictionary.
    Event {
        string id PK
        integer schema_version
        integer created_at_ms
        string producer_id
        string visibility
        string visibility_user_id
        string visibility_session_id
        string graph_epoch
        integer seq
        string kind
        string aggregate_id
        string request_id
        string payload_digest
        string payload_json
        integer committed_at_ms
    }
    RequestReceipt {
        string id PK
        integer schema_version
        integer created_at_ms
        string producer_id
        string visibility
        string visibility_user_id
        string visibility_session_id
        string graph_epoch
        string request_id
        string request_digest
        string operation
        integer event_seq
        string result_json
        string actor_id
    }
    DeliveryCursor {
        string id PK
        integer schema_version
        integer created_at_ms
        string producer_id
        string visibility
        string visibility_user_id
        string visibility_session_id
        string session_id
        string graph_epoch
        integer scanned_seq
        integer inserted_seq
        string last_packet_id
        integer updated_at_ms
    }
    Event }o..o{ TaskState : "CHANGES"
    Event }o..o{ ActorRef : "CAUSED_BY"
    RequestReceipt }o..o{ Event : "COMMITTED_EVENT"
    DeliveryCursor }o..o{ AgentSession : "FOR_SESSION"
```
