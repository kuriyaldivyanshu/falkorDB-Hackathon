# Threadline runtime, tools and coordination protocols

**MVP authority — 15 October 2026:** [Development blueprint](track2-development-blueprint.md) controls release scope: two contributors, one logical Builder and fresh successor, a protected service checker, eleven tools and no automatic model summaries. This document retains broader target/reference contracts; model Verifier, polling, native adapters and fixed four-day schedules are not MVP commitments.

**Proposed contracts, revised 14 October 2026 after adversarial review; not implemented.** Governed by [the owned-harness scope](track2-harness-scope.md) and [final architecture](track2-final-architecture.md). These interfaces describe behavior and failure semantics, not a ready SDK.

## 1. The execution kernel

One `RuntimeSession` executes one role against one task and immutable provider/tool profile. It has an input queue, normalized conversation, cancellation controller, role-specific authorization, context watermark and admitted budget. The durable session store is recoverable truth for visible history; the in-memory conversation is a working projection.

The selected first implementation owns the following loop:

1. Reconcile prior unknown actions and acquire Builder claim/reservation before any provider submission. The target model Verifier would require an independent immutable verification assignment.
2. Drain accepted human steering/requirement changes at a safe boundary.
3. Prepare current mandatory graph context and bounded conversation history. Validate scope/revisions; overflow pauses execution.
4. Reserve the next provider request; persist request intent, input digest, provider/profile and turn ID.
5. Stream one response. Forward safe text deltas to the TUI; accumulate complete tool calls before execution.
6. Persist the completed visible assistant message and full requested tool batch. No tool effect precedes this durability barrier.
7. Validate each tool's schema, role, scope, current fence/revisions, approval and budget. Initially execute effectful actions sequentially. A running command is observed through bounded polls; conflicting edits/commands remain blocked.
8. Persist each action intent; execute through the tool policy/sandbox; store bounded result plus original permitted evidence object.
9. Admit meaningful observations into graph memory; wait for required graph receipts before dependent work.
10. Settle usage, checkpoint, and evaluate stop conditions. A model final response stops inference but does not complete the task.

Persist opaque provider continuation data only when required, permitted and properly scoped. Hidden reasoning is not stored as product memory. If a provider needs encrypted/opaque continuation blocks, isolate them in provider-private state with retention/access rules; never treat them as public rationale or portable context. The first implementation can select a stateless request profile and reconstruct supported visible history.

## 2. Runtime interface

```typescript
type RuntimeMode = "threadline" | "codex-native" | "claude-native";
type DecimalCounter = string; // 64-bit counters across JSON boundaries

interface RuntimeDriver {
  probe(profile: ProfileRef): Promise<Capabilities>;
  start(contract: AdmittedLaunch): Promise<RuntimeHandle>;
  send(handle: RuntimeHandle, input: CommittedInput): Promise<SubmissionReceipt>;
  events(handle: RuntimeHandle): AsyncIterable<ObservedEvent>;
  cancel(handle: RuntimeHandle, reason: string): Promise<CancellationReceipt>;
  reconcile(handle: RuntimeHandle): Promise<ObservedRuntimeState>;
}
```

The actual definitions of referenced payloads must be generated from shared schemas at implementation. `start` consumes a committed launch contract; it cannot admit itself. `send` consumes durable input and a reservation; it does not silently change provider/profile. Cancellation receipt distinguishes requested, acknowledged, terminated and unknown. Runtime events use stable session/turn/action IDs generated before submission where possible.

Native drivers additionally support explicit `resumeNative` only when the host does. A fresh start never falls back to resume. Native tool/event coverage is capability-labelled; a host-limited integration is not assumed equal to the owned runtime.

## 3. Provider interface

`ModelProvider.capabilities(profile)` reports supported streaming, tool schemas, usage accounting, context/output limits, cancellation and provider state requirements. `stream(request, signal)` returns normalized text deltas, completed tool calls, final usage and a terminal status. The executor never acts on partial streamed JSON.

Initial driver: OpenAI Responses with explicit API credentials. Additional drivers: Anthropic Messages, Gemini, tested OpenAI-compatible endpoints and local Ollama. Each adds conformance fixtures. Unknown model IDs, unsupported required tools or invalid limits fail before the run starts. An “OpenAI-compatible” label alone does not establish equivalent errors, message history, parallel tool calls or token accounting.

Select provider credentials through the host secret store; never insert secret values into SQL, graph, logs, tool sandboxes or model prompts. A profile records billing route. Native subscription compatibility and direct local/open-source SIWC have different contracts; see [the primary-source matrix](track2-provider-evidence.md).

Retries are bounded and classified. A rate-limit or connection failure before accepted submission can retry the same logical request. A lost response after possible processing is `OUTCOME_UNKNOWN`; query provider status only where supported, otherwise record uncertainty and require a deliberate retry policy. A retry may incur another charge. Never replay a tool mutation just because inference was retried.

## 4. Command envelope and receipts

Every domain mutation carries a versioned envelope. Caller-supplied scope is a requested target only; the service derives actual principal and authorization from the authenticated connection.

```json
{
  "schema_version": 1,
  "request_id": "operation-uuid",
  "operation": "memory.checkpoint",
  "project_id": "project-uuid",
  "graph_epoch": "epoch-uuid",
  "run_id": "run-uuid",
  "task_id": "task-uuid",
  "expected_task_revision": "17",
  "requirement_revision": "4",
  "fence": "9",
  "context_packet_id": "packet-uuid",
  "payload": {
    "summary": "Serializer changed; freshness check remains open.",
    "candidate_digest": "sha256-hex",
    "source_ids": ["source-uuid"],
    "unresolved_effects": false
  }
}
```

Before mutation, authenticate, canonicalize, validate schema/size and compute a request digest covering schema version, operation, principal, resolved tenant/project, graph epoch, all expected revisions/fences, context binding and canonical payload. Within the same graph epoch, a repeated request ID with the same digest returns its original committed result; a different digest returns `IDEMPOTENCY_MISMATCH`. A JSON-RPC transport ID is not this operation ID.

A successful receipt contains request ID/digest, graph epoch, event ID/sequence, aggregate ID/new revision and stable result. The state delta, event, sequence increment and receipt commit in one guarded graph query. A zero-row guard is not success. Conflicting/denied attempts can be audited in SQL without pretending they produced a committed domain event.

## 5. Tool catalog

The target registry has 14 tools; the MVP omits polling, decision proposal and model-review submission as specified in the blueprint. The three additions are based on [the inspected Codex contracts](track2-harness-scope.md#9-codex-tool-inventory-and-selected-additions).

| Tool | Required input | Result | Enforcement |
|---|---|---|---|
| `workspace.read` | Relative path, offset/length | Text, digest, truncation metadata | Canonical permitted root; file/byte cap |
| `workspace.search` | Query, permitted paths, limit | Matches and source digests | No arbitrary filesystem root; output cap |
| `workspace.inspect` | Workspace ID, scope | Base/tree/dirty paths, manifest | Trusted registration; actual current files |
| `workspace.apply_patch` | Patch, expected file digests | New digests, action receipt | Builder role, active fence, controlled atomic file replacement |
| `workspace.run` | Registered command ID, validated args | Terminal outcome or scoped running execution ID; captured output refs | Isolated process, timeout, output/disk/network limits |
| `workspace.poll` | Execution ID, output cursor, wait/output caps | Captured chunks, next cursor, observed status/exit code | Same session/role/workspace/epoch; no process launch or stdin |
| `task.update_plan` | Task/revisions/fence, bounded checklist | Guarded checkpoint and exact checklist source | Builder only; tactical steps cannot change requirements or complete task |
| `interaction.ask_user` | Stable question ID, prompt/options, task/revision | Authenticated answer or cancelled/stale result under original call ID | Builder only; durable pending intent, no inferred answer or permission grant |
| `memory.retrieve` | Task, focus, requested budget | Current packet or scoped evidence | Mandatory closure first; visibility/applicability |
| `memory.refresh` | Task, known revision, packet | Current changes/new packet | Same authorization as retrieve |
| `memory.checkpoint` | Progress, evidence, expected revision | State/event receipt | Current owner; cannot replace human authority |
| `memory.propose_decision` | Choice, rationale, alternatives, sources | Pending decision | Scoped proposal only |
| `review.submit` | Candidate/criteria/environment, observations | Verification proposal/receipt | Verifier identity; trusted check records |
| `task.request_completion` | Candidate, receipt IDs, expected revision | Accepted state or rejection | Deterministic current-evidence gate |

Post-hackathon candidate tools are `memory.publish_finding` and `agents.propose_spawn`, with independent publication/admission gates. They are not registered in the core release.

Service-only operations are `task.claim`, `task.revoke`, `handoff.offer`, `handoff.accept`, `task.complete`, `run.reserve`, `launch.authorize` and `requirements.accept`. Agents can request actions but cannot call these authority mutations directly. Runtime-only capture operations are `history.append`, `tool.record_outcome`, `context.record_submission`, `usage.record` and `session.record_gap`.

MCP is an optional transport for these tools and native-client integration. In-process calls in the owned runtime use exactly the same schemas/policy without an unnecessary local MCP round trip. An MCP tool server alone does not supply lifecycle capture, execution isolation or fresh-session restoration.

## 6. Tool execution, permissions and effects

A tool definition contains its input/output schema, semantic category, role grants, read/write resource declarations, approval rule, timeout, output limit, concurrency class and execution adapter. The policy resolves dynamic paths/commands itself; model-provided effect classifications are hints, not permission.

Approval binds one canonical invocation digest, session, project/workspace and expiry. If command/path/args change, recompute permission. Approved policy can permit routine operations without repeated questions. A pending native approval remains tied to its original native request ID; do not convert it into an unrestricted “allow everything” response.

`workspace.apply_patch` checks expected bytes under the task's current fence, writes safely, and returns before/after digests. Competing writes fail stale-content checks. File symlinks, root escapes and internal repository metadata writes require explicit policy. Patches are not applied through arbitrary shell substitution.

`workspace.run` launches a process with an allowlisted environment, no model secrets, controlled cwd and platform isolation. A command timeout kills the process group/container and then confirms exit. Shell children or background processes can outlive a parent unless the executor actually contains and reaps them. Unknown termination quarantines that execution scope.

Reserve an action ID and persist intended arguments before effects. Write actual output/effect evidence afterward. Crash between these steps leaves `unknown`; reconciliation inspects output artifacts, process identity and file hashes. Tool wrappers cannot promise exactly-once arbitrary commands. A deterministic read can usually repeat; package publishing or an external write cannot be retried blindly.

## 7. State transitions

| Aggregate | From | Trigger | To and guard |
|---|---|---|---|
| Task | planned | Prerequisites/current requirements available | ready |
| Task | ready | Claim | running; expected revision, new fence/lease |
| Task | running | Missing dependency/approval/reconciliation | blocked with reason |
| Task | blocked | Reconciled prerequisite | ready or running under a valid claim |
| Task | running | Candidate checkpoint | verifying; exact candidate/criteria recorded |
| Task | verifying | Current checks fail | running under current owner or ready for new claim |
| Task | verifying | Current required evidence accepted | completed |
| Task | any unfinished | Authorized cancellation | cancelled; revoke claim; stop runtime |
| Task | completed | Relevant requirement/artifact change | New ready/blocked TaskState; preserve prior completion |
| Runtime | reserved | Authorized launch registered | live |
| Runtime | live | Stop/cancel | stopping, then stopped only with evidence |
| Runtime | live/stopping | Lost process/outcome visibility | unknown; slot remains reserved |
| Launch | authorized | Supervisor attempts start | launching |
| Launch | launching | Registration with matching token | registered |
| Launch | launching | Lost start response | unknown; reconcile stable launch ID |
| Handoff | offered | Old writer termination/quarantine | reconciling |
| Handoff | reconciling | Current packet + candidate + claim accepted | accepted |

SQL process status never directly performs any Task transition. A heartbeat renews the execution liveness observation; claim lease renewal is a separate authorized graph operation. Expired lease does not prove an external process stopped.

## 8. Context packet contract

Packet metadata includes project/epoch, task/revision, requirement revision, graph generation, role/tool-policy digest, candidate/environment, mandatory items, optional items, source access scope, inclusion paths, omitted counts, token budget/precision and payload digest. Store exact rendered bytes, not just the IDs of intended inputs.

Graph `ContextPacket` links via `INCLUDES` to each governing/evidence record. `ContextLoad` records the recipient, packet, stable pre-submit `submission_id`, receiving turn when known and acknowledgement strength. `context_deliveries` is unique per `(tenant, project, agent_session, submission_id)`, so the same packet can be inserted in multiple turns without erasing an earlier observation. In the owned runtime, allocate the provider-attempt UUID before both rows and use `context_deliveries.submission_id = model_requests.id`; the service verifies their session and packet match. Retrying persistence/acknowledgement of that same insertion keeps the ID. A deliberate new provider attempt, even for the same logical request and packet, gets a new ID and delivery row; an unknown network submission is not blindly resent. Native modes use their own pre-submit ID and attach observed turn correlation later. The owned runtime can attest to the exact submitted request bytes; a native runtime may expose only weaker submission evidence. Label those levels explicitly. No acknowledgement claims model comprehension.

A required-context overflow prevents the model turn. The TUI offers narrower task scope or an explicitly increased compatible context budget. Optional recollections can be omitted with counts. Summarization cannot silently replace exact accepted constraints, source provenance or current criteria.

Before each own-runtime provider request, compare current required revisions with the loaded packet. Before each guarded effect/completion, check again. Native modes inject at supported boundaries and may require interrupt/fresh replacement; they cannot claim arbitrary mid-token insertion.

## 9. Synchronization and ordering

There are five different cursors: native/own-runtime source position, SQL capture order, SQL-to-graph admitted position, graph-to-SQL projected position, and recipient context-inserted position. Never reuse one number for all of them.

`capture_seq` is per session. `Event.seq` is per project graph/epoch. `projection_offsets` advances through a contiguous committed range in the same SQL transaction as projection updates. Worker refresh scanning can skip irrelevant events, but it records the scan watermark separately from the highest relevant inserted watermark. After retention expiry, rebuild a current packet and establish a new authenticated baseline.

Notifications and SSE are wakeup mechanisms. Disconnection reconnects using an event cursor; the backend pulls the durable log and applies source visibility before sending. A user must not receive private event payloads merely because a global sequence exists. A filtered stream may contain gaps; its opaque continuation cursor means “scanned through,” not “all those events were disclosed.”

Outbox retry: transactionally lease a bounded batch with timeout, publish using stable graph operation IDs, acknowledge committed receipts. Failed worker leases expire; a replacement uses the same IDs. Poison/schema-conflicting events enter quarantine with an inspectable reason, and dependent claims stay blocked. No infinite retry of an invalid payload.

## 10. Local API surface

| Method/path, proposed | Caller | Meaning |
|---|---|---|
| `GET /v1/health` | Local discovery | Minimal liveness; no private configuration |
| `POST /v1/auth/local-exchange` | OS-authenticated bootstrap | Create expiring human app session |
| `DELETE /v1/user-sessions/current` | Human | Revoke interactive token |
| `GET /v1/projects` | Human | Authorized projects only |
| `POST /v1/projects/:id/runs` | Human | Persist goal/policy and admit run |
| `POST /v1/projects/:id/requirements` | Human | Source-bound requirement change |
| `POST /v1/projects/:id/commands` | Human/worker, role filtered | Typed idempotent domain operation |
| `GET /v1/projects/:id/events` | Human/worker | Scoped SSE/replay |
| `GET /v1/projects/:id/tasks/:task/context` | Authorized worker | Bounded current packet |
| `POST /v1/projects/:id/sessions/:session/inputs` | Human/coordinator | Committed steering/input |
| `POST /v1/projects/:id/sessions/:session/cancel` | Human/coordinator | Persist cancel intent and reconcile |
| `POST /v1/projects/:id/approvals/:approval` | Human | Scoped invocation decision |
| `GET /v1/projects/:id/sources/:source` | Authorized reader | Resolve readable evidence, digest and availability |
| `POST /v1/projects/:id/exports` | Human | Redacted manifest-bound evidence export |

Local API binds loopback or an owner-only socket. Validate token, origin where relevant, body limits, target project and method role. No raw SQL/Cypher or arbitrary blob-path endpoint. Remote access requires the separately designed enrollment/TLS/auth mode.

## 11. Error taxonomy

| Code | Retry rule | User/runtime action |
|---|---|---|
| `UNAUTHENTICATED` / `UNAUTHORIZED` | Do not retry unchanged | Reauthenticate or correct scope |
| `REVISION_CONFLICT` / `STALE_FENCE` | Refresh, not blind replay | Rebuild current context/claim |
| `STALE_ARTIFACT` / `STALE_CRITERIA` | Reconcile/reverify | Inspect actual candidate and current checks |
| `IDEMPOTENCY_MISMATCH` | Never reuse conflicting ID | Integrity failure; investigate producer |
| `REQUIRED_CONTEXT_OVERFLOW` | No automatic truncation | Narrow scope or raise allowed budget |
| `CAPTURE_PENDING` | Bounded wait/pull | Wait for source admission |
| `CAPTURE_GAP` / `SOURCE_UNAVAILABLE` | Restore or reproduce explicitly | Mark unknown evidence |
| `OUTCOME_UNKNOWN` | Reconcile original operation | Avoid duplicate external effects |
| `PROVIDER_QUOTA` | Bounded backoff | Pause/queue; no billing switch |
| `BUDGET_EXHAUSTED` | No automatic increased limit | Checkpoint and stop admission |
| `DB_UNAVAILABLE` / `OVERLOADED` | Bounded jittered backoff | Stop guarded admission |
| `UNSUPPORTED_CAPABILITY` | No silent downgrade | Select compatible profile/runtime |

Errors include request/trace ID, retry classification and safe diagnostic details. They exclude credentials, SQL internals, graph keys and private source content.

## 12. Bounded roles and future spawning

The hackathon coordinator admits one logical Builder at a time, with one active run and at most three replacements. A protected service checker is not a live model slot. Arbitrary child spawning is deferred beyond this release. The following spawn contract is a future extension.

A spawn proposal creates no process. Admission checks role, parent claim, depth, objective duplication, permitted resources, current prerequisites, global slots and budget. One graph mutation reserves capacity and records Task + LaunchIntent + Event + Receipt. Only then does the supervisor launch. Registration must match the intended session/launch token before tools become available.

The future investigation extension has a four-slot ceiling including waiting parents. Core allows one run per installation; multiple active runs require an installation allocator rather than adding independent per-project limits and calling their sum global. API model requests stay behind the broker, and tool sandboxes contain no credentials or unrestricted network path to start hidden paid workers. Native compatibility can claim a hard bound only if its bypass paths are tested.


## 13. Durable command admission and epoch recovery

For a human goal or requirement change, one SQL transaction writes the original `project_messages` source and immutable `command_inbox` envelope. The envelope contains the authenticated human/session, resolved scope, operation, graph epoch, expected revisions, complete validated payload and digest. A message ID and payload hash alone cannot reconstruct a command. Command payloads carry the source's access restrictions; their repository is not a project-wide raw JSON endpoint.

The dispatcher leases pending rows with expiry and bounded retries. It revalidates current authorization, project epoch and revisions before each graph admission. Graph state + Event + epoch-scoped RequestReceipt commit together. If SQL acknowledgement is lost, resolve the graph receipt with the same epoch/request ID/digest and settle the inbox. Acknowledging an inbox row never independently makes a requirement active. Return a durable pending ID while awaiting admission, then committed/rejected/quarantined with a reason. A source or inbox commit does not mean accepted authority.

On controlled restore to a new graph epoch, quarantine pending/unknown domain and effect commands from old epochs. Never rewrite their epoch and blindly retry. An old receipt remains historical evidence but cannot authorize present work. Reissuing a human requirement is a new authenticated command with a new ID after current-state review. Immutable observation re-ingestion is a separate import operation: preserve original source identity/epoch, deduplicate provenance, and never replay its old state transition or external effect. Rebuild SQL projections from the new epoch's verified baseline.

## 14. Durable model attempts

Before provider dispatch, persist exact permitted request bytes as an immutable scoped artifact, then a `model_requests` row binding session, stable logical request ID, attempt number, input/profile digests, graph epoch, requirement revision, context packet and budget reservation. Status progresses `prepared → dispatched → streaming → completed/failed/cancelled`, with `unknown` whenever submission or completion cannot be observed. A prepared row with a provable no-send outcome can be sent; a crash at the dispatch boundary is conservatively unknown.

Store provider request ID when available; never invent one. Final visible response artifact and usage-ledger source key attach to that attempt. Missing usage stays unknown and retains conservative reservation accounting. Retry is a new attempt under the same logical request and run budget, after reconciliation or explicit policy accepts duplicate-charge risk. No retry silently reruns completed tool effects. Model requests and capture events are complementary: one tracks transport intent/outcome, the other records visible observations.

## 15. Current constraints and role authorization

A task's stable `SUBJECT_TO` edges bind `Constraint`, not only a historical ConstraintVersion. Accepting a new constraint version atomically changes its `CURRENT_VERSION`, current revision, project requirement revision and Event/Receipt. The project revision is a conservative admission barrier: every task with an older loaded/rebased revision blocks its next model/effect/completion boundary until reconciliation. No unbounded update of all tasks is required inside that mutation.

Rebase resolves applicable project, goal, ancestor/task and artifact rules from stable scope IDs, adds/removes the task's stable bindings, preserves historical `GOVERNED_BY` evidence, invalidates incompatible candidate/receipts, and writes the new TaskState/revision under a generation guard. Context closure requires exactly one current version for each applicable rule with a matching revision; missing, duplicate, inaccessible or over-budget mandatory authority fails closed. It does not quietly drop a broken binding. Recheck generation after a multi-query closure or retry a bounded number of times.

Builder has the sole task write claim/fence. Verifier instead has a role-bound assignment persisted as `agent_sessions.authorization_manifest` plus digest, mirrored by canonical `AgentSession.authorization_json/digest` and `LaunchIntent.authorization_digest`. The assignment binds task/run/project, graph epoch, requirement revision, candidate, criteria/acceptance bundle, environment, permitted tools and budget reservation. It grants read/check/review permission, never task ownership or patching. Admission and `review.submit` validate the assignment, live reservation and current bindings. A change makes it stale; rechecking requires a new assignment/session. Launch registration alone grants neither role authority.

## 16. Verification trust boundary

A required Criterion binds a protected, content-addressed acceptance bundle and trusted launcher. The bundle includes assertions, runner, transitive imported test helpers, configuration, lockfile/dependency identity and harness-controlled invocation. Builder cannot modify these bytes or resolve them through candidate-controlled package scripts/import paths. The candidate is mounted separately; expected outputs and acceptance logic remain outside its write scope. Candidate code can be executed in the sandbox, but its printed claims cannot manufacture a receipt.

The trusted assertion engine and receipt writer run outside the candidate-controlled process/isolate. For the authored fixture, a trusted supervisor invokes candidate code in a restricted subprocess, reads bounded protocol output as untrusted data, and performs the acceptance assertions in its own protected process. Candidate imports cannot monkey-patch the assertion engine, bypass it with an early exit, or forge its terminal receipt. Missing, malformed, forged or premature terminal results fail the check even if the candidate exits zero.

The trusted verifier service validates bundle/launcher hashes before and after execution, collects actual process exit and declared assertion evidence, and binds them to candidate/environment/criteria/requirement revision. Tests must independently assert the required behavior; `npm test` exiting zero is insufficient if Builder can redefine it. Authorized acceptance edits require a new bundle/criteria digest, human or declared policy approval, requirement invalidation and re-verification. This boundary does not prove the tests cover every bug; coverage of the authored scenario is a separate evaluation obligation.

## 17. Provider ownership and revocation ordering

Default billing authorization requires `runs.initiated_by == provider_profiles.owner_user_id == provider_accounts.user_id`, matching tenant/project scope and active membership. Recheck before launch and each provider submission. Project membership alone grants no right to use another human's provider account. Native compatibility additionally matches the registered host OS user and verified selected native account; unknown/mismatched bindings fail. Shared billing requires a future explicit revocable grant; no such grant is implied by the current schema.

One active coordinator serializes authorization-changing commands and admissions through the same installation-wide authorization/admission gate across all projects. Hold the gate while loading SQL membership/profile/source permissions and committing graph admission or releasing a provider/tool invocation to the supervisor. Tenant-wide membership and provider-account revocations use that same gate, so their scope cannot race an admission in another project. A permission mutation holds that gate through the SQL commit, invalidates cached grants and schedules affected cancellation before releasing it. This is an application linearization boundary, not a cross-database transaction. Already admitted/in-flight external effects may finish; cancel/reconcile them and report that limitation. New admissions after the revocation commit are denied.

On coordinator restart, reconcile current SQL grants and graph reservations before dispatch; admission is closed during uncertainty. Direct out-of-band membership writes and multiple active coordinators are unsupported until they have a tested fencing protocol. The service's privileged access does not bypass the application's human/account authorization rules.

## 18. Private inputs, derived outputs and live-session retirement

A session's effective output readership is the intersection of the source scopes loaded into it, including message history, tool results, provider continuation and descendant findings. The first implementation conservatively represents this as project/user/session scope; if the intersection cannot be represented safely, refuse the mixed context or run a dedicated session with narrower access. Record `output_visibility` and the required owner ID on graph AgentSession before releasing source bytes. Once narrowed, do not widen the session by removing a citation or asking the model to forget.

Reading private evidence does not authorize publishing a paraphrase. A private-input checkpoint/result stays private. Project-visible TaskState contains only service-derived safe status/digest metadata and a policy-approved public summary; free-form private checkpoint text belongs in a private Observation/source. Apply the same rule to Event payloads, RequestReceipt results, logs, tool results, projections, exports and citations. Shared findings require explicit Publication review and redaction of both content and revealing metadata. The sample public M1 query is limited to project-output sessions and trusted publication preflight; the boolean parameter is never supplied by an agent.

When source access is narrowed/revoked, block affected new admissions immediately, retire every session/descendant that loaded the source or derived content, cancel and reconcile running work, discard live conversation/provider continuation, and quarantine any unsafe output. Rebuild a sanitized authorized context in a genuinely new runtime/session with no opaque continuation or native resume. A normal refresh packet cannot erase tokens from an existing conversation. Bytes already sent to a provider/process cannot be recalled; enforce future access and the declared retention/deletion policy rather than claiming retroactive erasure.

## 19. Checklists, clarification and command polling

`task.update_plan` routes structured checklist data through the existing guarded checkpoint path. Persist exact visible invocation/result, checklist artifact and source bindings before graph admission; preserve unrelated checkpoint progress. Use the normal task revision/fence/epoch checks and publication scope. Its `completed` step means the agent marked a tactic finished, never that executable acceptance passed. A fresh session retrieves the current applicable checklist with its source and requirement binding; obsolete checklists stay historical.

For `interaction.ask_user`, durable input contains the question ID, original invocation digest/session/tool-call ID, task/epoch/revision and scoped prompt/options. Capture the pending tool intent before presenting it. Do not resolve the tool call until the human answer has a durable authenticated source and command receipt; the model history receives one final matching tool result. One pending question pauses new dependent model/effect admission without holding an OS command open. No new tool process is needed. Approval, question answer and accepted requirement are distinct operations. TUI disconnect retains the question; run/session cancellation returns an explicit cancelled outcome. After a requirement/source/owner change, old answers cannot silently apply to a new task revision. Private prompts/options use the same session output policy as checkpoints.

Question state is reconstructed from typed capture events (`question.requested`, `question.answered`, `question.cancelled`) and the scoped tool input/output artifacts. The human's `interaction.answer` command binds question ID and original digest. Duplicate same-answer commands settle idempotently; conflicting answers are rejected. The original tool execution is `running` while awaiting an answer and becomes terminal only after its captured result; this status grants no worker authority. A cancelled tool result is represented by a failed/known-cancelled outcome in its typed payload, not by inventing a successful answer.

`workspace.run` persists its execution identity and command/environment/workspace digest before launch. A configured bounded yield can return a `running` handle; that is an invocation result, not process completion. Capture later output/lifecycle as ordered observations for the original `tool_executions.id`; `workspace.poll` calls have their own tool-call IDs and reference that original execution. The original row remains running/unknown until an actual terminal observation. Its output manifest contains ordered chunk sequence/digests and final terminal metadata; capture event/artifact bytes are the durable source. Each poll cursor denotes captured output already disclosed, not commands already executed.

Poll responses have bounded wait/output and recommended retry delay, checked against the original session capability. The runtime/TUI streams observed output directly while waiting; it does not need paid inference just to redraw logs. Initially allow one running effectful command per writable workspace. Until exit/termination is proven, deny conflicting edits/commands; cancellation and read-only status reconciliation remain service responsibilities. Original deadline/output/scratch/network limits apply across polls and restarts. Output truncation is explicit, and referenced retained logs remain source-authorized. The executor must contain/reap children before a timeout is considered settled. Poll cannot send input, transfer handles, change command arguments, extend a deadline, release a reservation or turn an unknown outcome into a receipt.

Proposed acceptance additions are: a completed checklist cannot complete a failed candidate; a checkpoint survives fresh restore with current revisions; a question survives TUI/service disconnection without an invented answer; a late/conflicting answer is rejected; a question cannot approve a tool; two polls observe one process with contiguous output and no duplicate execution; foreign/stale handles are denied; lost termination remains unknown and blocks conflicting work. These gates are unexecuted.

## 20. Memory priority, representation and retention

**Proposed policy, 14 October 2026; unimplemented.** Priority is a task-relative selection decision, not a universal ordering of file types. A tool call, its response, relevant diagnostic and affected candidate form one sourced episode. A log is usually bulk evidence, but its current blocking error can be essential. The policy distinguishes what is captured, what becomes accepted reusable memory, what enters a successor's packet, and how long the supporting bytes are retained.

### 20.1 Capture and storage

Capture permitted visible tool intents, observable outcomes and final messages with exact IDs, arguments, status, digests and ordering. Write bounded text to SQL and large allowed payloads to scoped immutable artifacts; record truncation, redaction, missing capture and unknown outcomes explicitly. Do not copy complete logs/file contents into each graph node. Graph Source/Observation/Attempt relationships connect their immutable evidence to the task and conditions.

Meaningful problem episodes, decisions and reusable procedures become memory records with provenance and applicability; ordinary successful reads and progress updates remain trace history unless needed to explain an outcome. A model may propose importance or a lesson, but it cannot promote its own claim to accepted truth. Repeated messages and repeated errors do not create independent corroboration.

Hidden model reasoning, credentials and disallowed private material are excluded from product memory. A short deliberately visible decision rationale is permitted and can be useful. Streaming text deltas are transient presentation data unless needed to represent a captured partial message; retain the permitted final visible record and mark gaps. Capture limits and retention are separate from the token budget used for forwarding.

### 20.2 Context priority bands

Apply authorization and task/requirement/artifact/environment applicability before priority. Old or inaccessible evidence cannot outrank current authorized authority because it is frequent, recent or pinned. These bands are assessed for each task packet:

- **P0 — mandatory current authority and safe continuation:** exact accepted goal, current constraints and acceptance criteria; current task/candidate identity and applicable completion state; pending human clarification; unresolved effects or execution uncertainty that must be reconciled before another action. Include exact essential diagnostic/reproduction fields when they are necessary to resolve a blocker. P0 overflow stops the turn.
- **P1 — highest-value working context:** current blocker/problem statement, current applicable checkpoint/checklist and next action, relevant diff excerpts, source-supported active decisions and matched failing tool outcomes. Summarize explanatory prose; keep critical evidence fields exact.
- **P2 — useful conditional recollection:** compatible earlier failed attempts, validated procedures, accepted lessons and historical choices that materially help the current task. Forward compact sourced records only when budget remains. Promote an applicable earlier failure to P1 when it prevents repeating the current mistake.
- **P3 — bulk or low-value trace:** repeated logs, verbose successful output, ordinary read/search results, duplicate narration and irrelevant tangents. Keep available under retention policy; normally forward source references or omit entirely.

Mandatory P0 is not a ranked top-k result. Within optional bands, use deterministic task relevance, applicability/evidence status, whether it changes the next action, novelty and size; use recency only as a tie-breaker. Start with rules and stable IDs rather than inventing an unvalidated numeric importance score or paying for a classifier at every event. Run policy may adjust optional quotas/preferences but cannot demote governing obligations, hide unresolved effects, bypass source permissions or authorize hidden reasoning capture.

### 20.3 What remains exact and what is compressed

| Content | Stored representation | Forward representation | Summarization boundary |
|---|---|---|---|
| Accepted problem/goal, requirements and criteria | Immutable accepted version plus authored source | Exact current bounded statement and criteria, P0 | Large original specifications need an explicitly accepted scoped requirement set; no automatic paraphrase may remove obligations |
| Unresolved execution/approval/clarification | Exact IDs, status, bindings and original source | Exact actionable status/bindings; relevant prompt/diagnostic, P0 | Do not replace unknown with succeeded, infer an answer or carry expired permission |
| Current error or failed check | Original captured tool request/result and available log artifact | Reproduction command, actual status/exit code, exact failure/test identifier and useful frames, P1 or essential P0 | Summarize surrounding noise; distinguish observed error from a hypothesized cause |
| File diff and workspace state | Immutable patch/candidate manifest, before/after digests and source | Affected paths, inspected status, candidate identity, concise change intent and relevant hunks, P1 | A diff summary is orientation; exact bytes remain the source for inspection/verification |
| Tool invocation and response | Matched IDs/arguments/result, scoped source and environment | Relevant paired episode with minimal reproducible inputs and actual outcome, P1/P2 | Never separate a useful response from the invocation/candidate that explains it; do not replay it as a new command |
| Active plan, decisions and public rationale | Exact permitted checklist/checkpoint/decision plus provenance | Current steps, choice, short rationale, assumptions and uncertainty, P1/P2 | Checklist completion is not verified completion; unsupported rationale stays labelled as a hypothesis |
| Routine/repeated logs and successful reads | Captured bounded trace and ordered artifact chunks | References or a compact outcome/count, usually P3 | Group equivalent diagnostics only within matching conditions; keep distinct failures and disclose output truncation |
| Reusable lesson/procedure | Versioned preconditions, steps, evidence and actual validation status | Compact applicable lesson/procedure, P2 or P1 when needed | No unconditional universal rule from one failed attempt or a model confidence claim |
| Visible final response | Original permitted message/source | Relevant supported facts or concise attributed excerpt | A response saying tests passed cannot become a trusted receipt |

A file-touched list is useful orientation but does not prove how the file changed. File content digests, actual diffs and candidate snapshots establish that identity. A fresh worker can inspect those sources through its authorized tools. For a current failing check, exact diagnostic plus reproducible invocation is generally more valuable than a long natural-language summary of all earlier tool calls.

### 20.4 Summary contract and implementation order

Use deterministic extraction/templates first: checkpoint fields, structured check result, changed-path manifest and bounded error excerpt. Model-generated summarization is optional, budgeted through the existing provider broker, and must not block durable capture. If unavailable or insufficiently supported, use verified structured fields plus source references, or explicitly omit optional context. Never substitute a fabricated or unvalidated summary for mandatory authority.

A derived record carries source IDs/digests and relevant ranges, task/requirement/candidate/environment bindings, visibility, representation kind (`exact`, `excerpt`, `summary`, `reference_only`), uncertainty and summarizer/template version. Distinguish quoted observation, accepted decision and proposed lesson. Recompute or invalidate when source versions/applicability change. Create summaries from permitted original observations rather than repeatedly summarizing previous summaries. Do not claim a narrative summary is lossless.

The immutable context artifact records selected item/priority band, inclusion reason, actual rendered representation/range, source binding, token count/precision and omitted counts. Graph `INCLUDES.reason/mandatory/source_revision` records the traversal justification and version contract; full representation metadata belongs to the packet artifact, not a second authority table. Run policy stores the selection/template version and budgets, covered by the existing policy digest. No new SQL table or graph label is needed.

Useful episode template:

```json
{
  "problem": "UTC freshness check fails for offset timestamps",
  "conditions": {"requirement_revision": "4", "candidate_digest": "sha256-placeholder"},
  "affected_paths": ["src/serializer.ts"],
  "attempt": {"command_id": "check-export", "exit_code": 1},
  "observed_error": "expected UTC timestamp; received offset timestamp",
  "cause_status": "unconfirmed",
  "next_action": "Inspect timestamp normalization before re-running the declared check",
  "source_ids": ["tool-source-placeholder", "patch-source-placeholder"]
}
```

This is a synthetic illustration, not an executed result. The error statement is useful only with its original captured source; a template does not establish a root cause or acceptance.

### 20.5 Budget and repeated-context controls

The proposed 6,000-token default and 8,000-token maximum apply to the fully rendered memory packet, including its metadata/source excerpts. The complete provider request separately includes instructions, tool schemas, current user input and bounded recent history. Enforce both the configured total input ceiling and the supported context window after reserving output and safety headroom. Exact tokenizer support is preferred; otherwise use conservative labelled estimation. No model request proceeds without passing the checks.

Maintain one current memory block in each reconstructed owned-runtime request; refreshing replaces it rather than appending another copy to model history. Persist every submission as an independent delivery record even when content repeats. History pruning keeps valid tool-call/result pairs or replaces an entire old episode with an explicitly attributed memory record. Storing an old transcript does not imply replaying it in a fresh successor.

On-demand retrieval also has bounded paths/hops, item count, per-call output and cumulative context allocation. Many individually small responses must not bypass the next-request budget. Deduplicate repeated sources/episodes by scoped identity/version/digest; do not merge unrelated candidates or discard distinct failures. A source reference grants no additional source access. When mandatory authority alone is oversized, narrow the task or obtain an explicit compatible budget change; summarization cannot silently solve this overflow.

### 20.6 Retention and acceptance gates

Keep accepted governing records and evidence needed for retained verification/procedures under the declared project policy. Bulk diagnostics can have a shorter configurable retention, but deleting required bytes makes the source unavailable and blocks using it as current proof. A summary/digest cannot restore missing evidence. Preserve historical events showing what was observed without presenting a lost source as currently inspectable. Selecting P3 for forwarding is not authorization to delete its source.

Required unexecuted cases are: current exact constraints survive packet assembly; a low-level log error essential to a blocker is included while routine noise is omitted; an unknown effect remains explicit; wrong-candidate/old-requirement episodes do not become current advice; private material stays private after summarization; summary fields/quoted diagnostics resolve to the permitted original sources; repeated refresh/retrieval stays within packet and request budgets; mandatory overflow blocks inference; a repeated error is not promoted to truth; deleting required source bytes marks evidence unavailable. Publish actual counts/latency/model usage and memory usefulness only after executing the authored scenario and held-out variants.

## 21. Capture, checkpoint and summarization cadence

**Proposed first-release decision, 14 October 2026.** There is no separate summarization service, provider account or public summarization API. Core uses deterministic extraction from captured execution fields and the main agent's ordinary `memory.checkpoint`/`task.update_plan` output. That checkpoint is produced during normal task execution; it does not require another model request. Agent-written explanations remain attributed observations/proposals, not independent verified evidence.

A model-generated condensation of many observations is an optional later capability, disabled by default in the hackathon route. If explicitly enabled, it uses the existing provider broker, immutable input artifacts, `model_requests`, source policy and run budget. It must have an admitted global model-call reservation and cannot launch an uncounted background worker. No silent switch to a cheaper provider/model or different billing route. Durable capture and safe recovery do not depend on its availability.

### 21.1 Save at observable boundaries

- **Human input:** persist the original permitted goal/change/answer and complete `command_inbox` envelope before graph admission or dependent launch. Accepted human authority still requires its graph receipt.
- **Provider dispatch:** persist the exact supported input artifact/profile/context binding and model-attempt intent before submission. A lost response becomes unknown; saving later cannot reconstruct an unobserved result.
- **Completed visible assistant turn:** persist the visible message and complete validated tool-request batch before the executor releases any tool effect. Do not execute a partial streamed call.
- **Tool action:** persist its stable identity, canonical arguments and admission before effects. Persist actual terminal result/exit/evidence before returning success or making dependent verification/completion decisions. Unknown effects remain explicitly unknown.
- **Streaming output:** capture permitted logs in bounded ordered chunks and allow configurable batching of noncritical text deltas. The TUI can display live ephemeral deltas, but shared polls/source views return captured chunks only. Batch interval/byte limit and crash-loss behavior belong to the release manifest; an unfinished stream is marked partial/gapped when necessary. Do not perform a SQL/graph transaction or summarization call for each token/line.
- **Authority mutation:** accepted requirements, claims, reservations, handoff/completion and their Events/Receipts commit through the guarded graph path before dependent work. These cannot wait for a periodic memory flush.

The SQL-to-graph capture outbox creates provenance anchors idempotently. Memory-pending status remains visible; dependent actions wait when their required evidence has not been admitted. Capturing an event is different from accepting a lesson or updating task authority. Normal model turns and tool outcomes have durable records even when no new checkpoint or summary is created.

### 21.2 Checkpoint meaningful state changes

Update the working checkpoint when an approach fails materially, a candidate/milestone is produced, a tactic/decision changes, an important dependency/blocker appears, or the next action changes. Coalesce low-value progress and ordinary read/search observations within a phase. Capture them as observations rather than rewriting the graph checkpoint after every event.

At a planned pause or fresh handoff, checkpoint at a safe boundary when possible and record the pending/unknown work. Urgent cancellation never waits for a summary/model request. If the worker crashes, the successor uses the last durable checkpoint plus captured subsequent observations and actual workspace reconciliation; it must not assume an end-of-session recap was generated. Requirement changes are admitted immediately and invalidate incompatible older checkpoints; they do not wait for milestone processing.

A periodic timer may request a safe checkpoint after a configured amount of meaningful uncheckpointed work, but it is a fallback freshness bound rather than an instruction to call a model on every turn. No particular interval is claimed tested. Prefer checkpoint content from the already-running agent and deterministic captured fields; if it cannot checkpoint now, retain observations and mark its progress projection as behind.

### 21.3 Condense only when there is a useful job

Deterministic rendering is cheap and can run when constructing a packet: select current fields, deduplicate sources, extract exact relevant errors and attach references. That is not an inference API call. Cache rendered derived records by authorized source/version/template digest when worthwhile.

If optional model summarization is enabled later, all of the following are required before admission:

1. The selected applicable source set has meaningful unsummarized changes; a matching permitted, still-applicable summary is not already available.
2. A task/phase boundary or anticipated handoff/retrieval reveals a useful compact episode, or optional history exceeds its allocated context allowance after deterministic extraction/deduplication. An arbitrary Nth turn or elapsed minute alone is insufficient.
3. Only optional source material is condensed. Mandatory-authority overflow still blocks or requires a narrower accepted task/budget; a model summary cannot bypass that gate.
4. The immutable input manifest fits its own summarizer input/output limits and retains source visibility/versions. One job does not get the entire installation transcript.
5. Its run has budget/capacity and no summary is already in flight for the same task/source digest. Debounce source updates, admit at most one per task, and enforce a configured per-run call/token ceiling. These are limits, not a new background agent fleet.

Planned handoff can reuse a valid summary; missing/stale summaries fall back to structured facts and bounded excerpts. Do not make a paid summary mandatory for every task completion, failure, user answer or session replacement. Repeated failures/log noise should first use deterministic grouping within matching candidate/requirement/environment conditions.

On summary completion, recheck source availability, permissions, graph epoch and applicability; a job started before a requirement/privacy change cannot publish stale or newly unauthorized content. Retain original uncertainty and source links, and record source/template/model version and usage. If the source set changed in flight, discard the obsolete derived output or retain it as inaccessible/historical according to policy; do not immediately rerun an unbounded cascade. A summary failure leaves the original observations intact and uses the non-model fallback. Summarization proposals never grant a permission, complete a task or establish a root cause.

### 21.4 Persistence versus inference costs and acceptance

Saving a permitted tool intent/result is a local storage operation. Calling a model to condense history is inference with separate cost, latency and possible failure. Keeping durable per-step evidence does not imply calling a summarizer per step or injecting that evidence into every future prompt.

Core must pass a complete interruption/fresh-recovery trace with summarization disabled. Other proposed cases are: crash before/after each request/tool durability boundary; many routine reads produce capture records without extra model calls; significant failure produces an applicable structured checkpoint; forced cancellation starts no summary call; repeated handoffs/source manifests reuse eligible derived records; summary quotas and global reservations hold; in-flight source/requirement/privacy changes prevent unsafe publication. Report actual recovery gaps and all optional inference usage. These cases remain unexecuted.
