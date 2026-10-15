# Threadline architecture: adversarial critic report

> **Historical review snapshot.** The user subsequently requested complete removal of the proposed recursive-analysis module. Its plan document, SQL/graph entities and diagrams have now been deleted. Inventory counts and future-research recommendations below describe the reviewed baseline; use the [current schema inventory](../track2-data-model.md) and [resolution register](track2-review-resolutions.md) for the current design.


**Review date: 14 October 2026. Review target: the proposed architecture in `plans/`, before the parent agent's review corrections.** This is a design review, not a report of exploited vulnerabilities or executed runtime failures. Baseline line numbers below identify the version inspected; section names remain useful if corrections move lines. The separate evaluator adjudicates these findings, and the parent agent owns the final resolution ledger and changes.

## 1. Verdict

Keep the compact TypeScript harness, local TUI, PostgreSQL capture/session store and FalkorDB authority. Keep the owned API loop as the first execution route. These choices form a coherent product for Track 2. Do not expand the initial release into Prime Agent, a general agent platform, every provider, native subscription adapters and RLM simultaneously.

**Latest user-priority recommendation: remove RLM from the hackathon deliverable entirely.** The minimum product is a model/tool action-observation loop with durable graph memory. Code-as-action and recursive analysis are separate mechanisms, neither required for this memory/coordination proof. C14 below explains the distinction and the evidence needed to reopen that decision.

The weakest part is not the language choice. Several promises cross boundaries without a complete protocol: human intent to graph admission, provider requests to durable recovery, access revocation to active model context, and immutable criteria to actual executable checks. Those gaps must be closed before the plan can be used as an implementation contract.

**No P0 finding is justified by the evidence.** The P1 findings are concrete design blockers for the affected advertised guarantees, not proof that an implementation is already vulnerable. Scope and schedule are engineering risk judgments; no claim is made that the team cannot deliver a smaller valid release.

## 2. Method and coverage

Read the root `AGENTS.md`, README and the four Start-here background documents: package/requirements, local TUI delivery, Codex subscription adapter and Claude subscription adapter. Their native-first recommendations are historical because the user explicitly requested an owned harness. Read the complete current plan narratives, runtime/authentication contracts, field dictionaries and schema metadata. Inspect SQL, Cypher and constraint templates; inspect the standalone protocol diagrams and their atlas representation; inspect generated schema definitions/relationships through their canonical models.

| Material reviewed | Coverage and limit |
|---|---|
| `plans/README.md` | Recommendation, ordering, staging and claim boundaries |
| `track2-harness-scope.md` | Owned loop, tool presets, archive reuse, exclusions and minimum harness definition |
| `track2-technology-decisions.md` | TypeScript/Rust/Python tradeoff, libraries, two-store cost, delivery slices |
| `track2-final-architecture.md` | Every section: product, authority, identity, providers, memory, verification, recovery, spawning, RLM, TUI, operations and security |
| `track2-runtime-and-protocols.md` | Loop, durability barriers, commands, tool policies, state machines, cursors, API, errors and scheduling |
| `track2-data-model.md` | SQL/graph ownership, scope keys, visibility, current versions, recovery, MySQL, retention and migrations |
| `track2-delivery-and-validation.md` | Four-person milestones, fixture, correctness/fault/isolation/load/evaluation and release gates |
| `track2-authentication-and-oauth.md` | API/native/SIWC routes, OAuth, billing, credential separation and lifecycle |
| `track2-rlm-and-prime-agent.md` | Prime reference scope, RLM mechanism, bridge, checkpoints, authority and staged value test |
| `track2-provider-and-rlm-evidence.md` | Provider/native compatibility, historical caveats, RLM controls and acceptance matrix |
| `track2-storage-evidence.md` | Atomic single-query writes, no distributed transaction, constraints, RLS, outboxes, restore and historical conflicts |
| `schema/postgresql-reference.sql`, relational JSON/dictionary | Baseline 34 tables/355 columns, identity/scope references, intent/outcome representation and delivery keys; no live SQL migration executed |
| `schema/graph-model.json`, graph dictionary | Baseline 34 labels/82 typed endpoint relationships, versions, source provenance, task ownership, budgets and receipt boundaries |
| `schema/falkordb-reference.cypher`, constraint commands | Every statement, with special attention to R1/R2/M1, epoch identity and mandatory closure; no Cypher executed |
| All 28 `diagrams/*.mmd` and `track2-diagram-atlas.md` | Architecture/protocol semantics; SQL/graph field inventory via canonical source models. Mermaid parser success is not semantic correctness |
| `validation.md` | Existing static-check claims correctly separated from runtime evidence |
| `figma/README.md` and four local SVG exports | Delivery/status contract and model-derived asset role; no Figma interaction or claim of checking every SVG pixel |

No installed clients were logged in, no provider requests were made, no credentials inspected, no databases started, and no Figma file was changed. Existing plans were left unchanged by this critic. The report is the critic's only repository write.

## 3. Prioritized findings and concrete remedies

### C01 — P1: human intent is durable, but its graph admission is not fully recoverable

**Evidence:** `track2-data-model.md:116` says human commands persist before graph admission and the UI shows pending/rejected status. `schema/postgresql-reference.sql:611` defines `project_messages` with message text, request ID and digest, but no operation, canonical command payload, expected revision, admission status or retry journal. The outbox at `schema/postgresql-reference.sql:404` accepts only `capture_event_id` from agent runtime capture.

**Failure scenario:** a user submits a targeted requirement change; its message commits, then the backend crashes before graph admission. After restart the text survives, but the system cannot reconstruct the exact accepted operation/preconditions without interpreting the text again. A second interpretation could target another constraint or apply against a newer revision. If graph committed before the crash, the UI also needs an explicit way to resolve the original receipt and distinguish pending from accepted intent.

**Minimal solution:** introduce one durable human command journal, or generalize an existing outbox with a typed source discriminator. Persist the canonical operation, principal, project/epoch, expected preconditions, payload reference/hash and stable request ID together with the original source message. Journal states must distinguish pending, processing, committed, conflict, rejected and unknown outcome. Retry the original immutable envelope; do not rerun natural-language interpretation automatically. Recheck authorization before admission. A stale requirement edit becomes a visible conflict requiring a revised command.

**Acceptance:** kill after message/journal commit, after graph commit and before SQL acknowledgement. Each restart must yield exactly one original transition or a visible terminal conflict/rejection, with the same source and no inferred replacement intent.

### C02 — P1: privacy revocation does not remove already loaded model context

**Evidence:** `track2-final-architecture.md:253` introduces project/user/session visibility. Its failure table at line 401 prescribes recomputation, revoking source access and refreshing affected sessions. Runtime section 1 maintains a normalized conversation, and section 8 rechecks current packets; neither defines removal of revoked content from existing history, summaries, opaque continuation state or in-flight requests.

**Failure scenario:** a session legitimately loads a private source. Access is then revoked. A new packet omits it, but a subsequent model request still contains the earlier message/summary, or a native conversation retains it. The model can keep reasoning from or quoting the source even though every new retrieval request is correctly denied.

**Minimal solution:** define source-access revocation as a session-contamination boundary. Stop admitting affected turns, cancel in-flight work where supported, quarantine unreviewed derived outputs, and start a fresh owned/native conversation from currently authorized sources. Remove retained provider continuation state when its dependency set is unknown. For the first release, conservatively taint the whole session if exact provenance is unavailable. State that previously transmitted data cannot be retroactively removed from a provider or a human reader; cancellation and future-use prevention are the available guarantees.

**Acceptance:** insert a synthetic secret into a legitimately authorized turn, revoke access, and attempt another turn plus checkpoint/export. Inspect exact request bytes and native restart choice. The new request must exclude contaminated history; outputs produced after the barrier must not be shared automatically. Report any cancellation uncertainty.

### C03 — P1: the mandatory-constraint query can omit a new current version

**Evidence:** `schema/falkordb-reference.cypher:18` labels R2 mandatory current governing constraints, but follows `Task -> GOVERNED_BY -> ConstraintVersion <- CURRENT_VERSION <- Constraint`. The graph model retains stable Constraint identities and immutable versions, while `track2-final-architecture.md:286` creates a superseding version. The data model also permits project/goal/task/artifact scope, and the context algorithm includes ancestors.

**Failure scenario:** Task T remains linked to version V1 when Constraint C changes `CURRENT_VERSION` to V2. R2's optional match no longer finds C, so the query returns no constraint for it. A caller can build a packet carrying the current project revision but missing the actual rule. Checking revision equality later does not prove packet completeness. The sample also does not resolve inherited project/goal/ancestor constraints.

**Minimal solution:** distinguish stable applicability from historical context. Resolve governing Constraint identities by explicit scope relationships, then resolve each current version. Preserve historical `INCLUDES` links to exact versions. Reject a governing identity without exactly one current version; do not interpret it as an empty set. Define the requirement activation boundary and fail closed until affected task readiness is refreshed. This avoids requiring an unbounded atomic fanout to rewrite every historical Task-to-version edge.

**Acceptance:** advance C from V1 to V2 without modifying old packet links; the next mandatory packet must contain V2. Include inherited project/goal/parent requirements, a missing current-version edge, an overlarge closure and a change racing packet assembly. Missing authority must block, never silently disappear.

**Qualification:** R2 is explicitly an unexecuted sketch. The finding is that it cannot serve as the stated mandatory-closure contract without these rules, not that a deployed query has failed.

### C04 — P1: provider request recovery lacks an explicit durable record contract

**Evidence:** `track2-runtime-and-protocols.md:14` requires reserving/persisting request intent, input digest, provider/profile and turn ID. Line 52 defines uncertain provider outcomes. SQL has general capture events, tool executions and usage, but no specified request lifecycle record or typed capture payload/index that ties submission attempts, complete response, tool batch and usage settlement together.

**Failure scenario:** the model accepts a request and returns a tool batch, then the coordinator dies before terminal persistence. On restart the implementation needs to distinguish an unsubmitted request, possibly billed unknown request, completed response with unexecuted tools, and already dispatched effects. A session message alone cannot represent those distinctions. A digest alone cannot reconstruct the original request bytes.

**Minimal solution:** specify either a first-class model-request journal or exact typed capture events plus a recoverable indexed projection. Retain stable logical request/attempt/turn IDs, immutable input artifact and digest, provider/profile/route, reservation, submission state, provider response ID where available, terminal state, completed response/tool-batch reference and usage settlement state. Unknown outcomes must not auto-replay tools or reset the reservation. Give stateless/non-stored providers an explicit deliberate retry policy rather than promising status lookup.

**Acceptance:** crash before send, after potential acceptance, after terminal response persistence, before the first tool, between tools, and during usage settlement. No tool effect can lack its durable originating batch; repeats retain cost uncertainty and stable accounting.

### C05 — P1: immutable criteria must cover the actual acceptance test implementation

**Evidence:** `schema/graph-field-dictionary.md:155` already calls `Criterion.check_ref` an approved immutable check definition. `track2-final-architecture.md:274`–280 binds a candidate/environment/criteria and executes Verifier on its snapshot. `track2-harness-scope.md` allows Builder patches and registered commands. The transitive boundary between trusted acceptance code and candidate-controlled scripts/imports is not specified.

**Failure scenario:** Builder edits `package.json` so the registered test command exits zero, changes the test file, or modifies an imported test helper. The immutable command name or criterion text remains unchanged. Verifier executes the exact new candidate and records a passing exit code, but the promised independent acceptance assertion was bypassed.

**Minimal solution:** store trusted acceptance suites outside Builder's writable candidate. Pin the suite manifest, runner binary/image, command, configuration and trusted helper/dependency digests. Mount the candidate as input and scratch separately. Resolve registered commands against the trusted manifest, not candidate-provided command aliases. Repository tests may still run as supplemental evidence; changed tests require review or a separately authorized criterion revision. A candidate under test may be imported by the suite, but cannot replace the suite's assertions or result writer.

**Acceptance:** attempt to modify the test script, package command, loader/config, helper import and fake result file. The trusted checks must still run or reject integrity mismatch. Repeat against a valid candidate and an intentionally incorrect candidate to show the boundary is useful, not just restrictive.

### C06 — P1: project access is not permission to use another person's provider account

**Evidence:** `schema/postgresql-reference.sql:121` makes provider accounts user-owned; line 155 ties profile owner to account owner. The run at line 192 refers to a project profile while line 193 independently refers to an initiating project member. Runtime/API admission discusses project/source authorization but does not explicitly define account-use authorization.

**Failure scenario:** Alice creates a project profile backed by her private API key or native login. Bob is an editor in the same project. The schema permits Bob's run to reference Alice's profile. Without a separate predicate, Bob can consume Alice's allowance or run inside her native account simply because the profile is project-visible.

**Minimal solution:** default provider accounts and profiles to owner-only use, independently of project role. Require initiating principal to own the selected account; background sessions inherit an immutable authorized billing principal. Sharing an API account requires an explicit, revocable, bounded delegation policy if supported later. Native subscription routes must preserve the provider's direct-end-user conditions and must not inherit a generic shared billing grant. Restrict profile/account metadata visibility as well.

**Acceptance:** two users in one project attempt profile listing, direct profile-ID selection, run resume, RLM request, and fresh successor using each other's accounts. All unauthorized use fails before any provider request, and no credential metadata leaks in the rejection.

### C07 — P1: membership revocation needs a precise admission ordering boundary

**Evidence:** `track2-final-architecture.md:158` assigns membership/revocation authority to SQL; line 203 says membership revocation stops new admission immediately. Graph commands are separate transactions, and the command envelope does not include an authorization generation. No lock/serialization protocol orders SQL revocation relative to graph submission.

**Failure scenario:** request A passes the SQL membership check; request B revokes membership and returns success; A then commits a graph change or launches work using the earlier authorization result. Both individual store operations can be correct while violating the stated post-revocation promise.

**Minimal solution:** define an explicit linearization point in the one supported coordinator. Serialize revocation with final admission by principal/project, use an authorization generation and revalidate under that boundary, and ensure no alternate writer bypasses it. Mark revocation pending until conflicting admissions are resolved; future admissions fail after it completes. Already admitted/in-flight effects need cancellation and reconciliation and cannot be undone by changing SQL. Multi-coordinator support requires a stronger distributed protocol and remains disabled.

**Acceptance:** pause an operation immediately after membership lookup, complete revocation, then resume the operation. It must be ordered before the completed barrier or rejected; it cannot become a newly authorized operation afterward. Include a graph timeout with unknown commit and an already-running tool.

### C08 — P1: a Verifier cannot be required to take the Builder's exclusive task claim

**Evidence:** `track2-runtime-and-protocols.md:7` describes every RuntimeSession with a task/current claim, and line 11 requires acquiring a valid task claim. The graph has one current TaskState owner/fence. `track2-final-architecture.md:306` admits Builder and Verifier simultaneously, and the tool table allows Verifier scoped checkpoint observations and review submission.

**Failure scenario:** Builder owns Task T and creates a candidate. Verifier launches against T, but generic startup requires the same exclusive claim. It either cannot start or replaces the Builder owner. If Verifier's read-only check is treated as an ownership checkpoint, it can also mutate Builder's state incorrectly.

**Minimal solution:** keep the write claim exclusive to Builder. Give Verifier a separate evidence authorization bound to target task, immutable candidate, requirement/criteria, role, profile and reservation. It can append observations and submit receipts without owning or advancing the target task. Alternatively model verification as a separate child task with a clear relation to the target; do not leave both interpretations possible. Runtime startup validates role-appropriate authorization, not universally a writer claim.

**Acceptance:** Builder retains its fence while Verifier runs on a candidate. Verifier patch/checkpoint-owner operations are denied; evidence submission succeeds. A changed target requirement makes the receipt historical while leaving the trusted raw observation inspectable.

### C09 — P2: the context-delivery unique key prevents per-turn acknowledgement history

**Evidence:** `schema/postgresql-reference.sql:483` defines a delivery with `runtime_turn_id`; line 497 makes `(tenant, project, agent_session, context_packet)` unique. The master session table at `track2-final-architecture.md:200` describes a delivery to one agent at one turn/boundary. Runtime section 8 records exact receiving turns.

**Failure scenario:** the same immutable packet remains current for turns 1 and 2. A second delivery row violates uniqueness, or the application updates the first row and loses the original insertion evidence. Packet identity is content/context identity, not a delivery-attempt identity.

**Minimal solution:** introduce a stable delivery/submission ID and uniqueness on the recipient plus turn/submission attempt, allowing repeated packets. For native cases where no native turn ID is known yet, generate the internal submission ID before sending and bind the returned native ID later. Align Graph ContextLoad identity with that delivery.

**Acceptance:** deliver the same packet in two distinct turns and retry one submission. Retain two delivery receipts, deduplicate the retry only, and preserve both receiving turn mappings.

### C10 — P1 delivery risk: the four-day release boundary is still too implicit

**Evidence:** `track2-final-architecture.md:17`–22 makes a large feature set core. `track2-delivery-and-validation.md:54`–60 compresses it into four days. Lines 133–139 propose five evaluation baselines and at least twelve variants, while macOS/Linux/architecture support, packaging, recovery and two data services also need proof. The plan correctly says the full schema is staged, but does not name a single frozen hackathon feature/schema/operation whitelist or a specific extension-free release manifest.

**Failure scenario:** each owner reads a different document and treats another feature as necessary for the first demo. The team spends time on multi-provider infrastructure, OAuth, seven TUI views or generic migration/export functionality while current-evidence recovery and deterministic tests remain unfinished. Schema size alone is not the issue; the number of independent behavior guarantees is.

**Minimal solution:** define one named first-release contract: one tested OS/container profile, one API driver, one local coordinator/run, one writer, one evidence-only Verifier, one authored fixture family, current requirement closure, durable messages/tool evidence, fresh recovery, original-source inspection, one validated procedure reuse and the declared isolation/concurrency proof. Seed local identities instead of building tenant administration UI. Freeze the exact required storage/command inventory per slice; disable extensions in code and menus. Keep safety/correctness gates mandatory. Schedule broader repeated model comparisons as an explicitly budgeted evaluation phase; label a small initial study honestly rather than suggesting general statistical superiority.

**Acceptance:** a release checklist lists every included command, table/label group, platform and acceptance case. A new teammate can determine in minutes whether OAuth/RLM/remote access/multiwriter support is in this release. End-of-Day-1 failure triggers an explicit re-scope, not another dependency stack.

**Qualification:** this is a risk, not a prediction of failure. PostgreSQL cannot be silently removed while the release claims its session/identity design; any storage cut must be a named alternative with revised guarantees.

### C11 — P1: restore epoch must be part of command and receipt identity

**Evidence:** `track2-runtime-and-protocols.md:60`–76 shows the domain envelope without `graph_epoch`, although successful receipts include one at line 81. `schema/falkordb-reference.cypher:14` looks up a receipt by request ID and returns digest/sequence/result but no event epoch. M1 checks an epoch, but the public contract does not explain whether it came from the original request or a freshly resolved routing row. `RequestReceipt` has no own epoch field; Event does. F11 proposes an older-graph/newer-SQL recovery scenario.

**Failure scenario:** a delayed command from an earlier graph incarnation arrives after restore. If the service substitutes the current epoch, old revision/fence numbers can coincidentally match restored state. A receipt retained in the restored graph can also be returned as if it proves a new-incarnation command succeeded. Rebuilding SQL projections alone cannot reconcile lost domain decisions or old external effects.

**Minimal solution:** require original expected epoch on every guarded command, delivery and launch capability, include it in the canonical request digest, and reject old-epoch requests before receipt replay. Receipt lookup must resolve the linked Event epoch and distinguish historical outcome lookup from current authority. Restore fences all old workers/capabilities and uses a controlled matching backup set first; partial/mixed restore stays a maintenance/reconciliation operation. SQL observations/outbox rows retained beyond a restored graph require explicit re-admission policy, never automatic revival of old task commands.

**Acceptance:** restore state with revision/fence values matching a delayed old command. The command still fails `EPOCH_MISMATCH`. Historical receipt lookup reports its original incarnation without authorizing new work. Test committed SQL observation metadata whose corresponding graph anchor was lost and ensure repair cannot grant an old claim.

### C12 — P2: semantic drift remains across diagrams and duplicate contracts

**Evidence:** `track2-final-architecture.md:288` uses `INCLUDED`, while graph JSON/dictionary/Cypher/runtime use `INCLUDES`. `diagrams/state-machines.mmd` omits planned/verifying cancellation although runtime section 7 allows cancellation from any unfinished state. `diagrams/master-architecture.mmd` omits the direct SIWC route shown by `provider-routes.mmd` and the authentication plan. Supporting evidence still includes earlier native-first interfaces under a supersession banner.

**Failure scenario:** an implementer copies the high-level relation name and invalidation finds no sessions; a UI state machine copied from the diagram disallows cancellation during verification; a reviewer assumes all subscription use delegates the loop to native clients. Successful Mermaid parsing will not catch these differences.

**Minimal solution:** declare canonical vocabularies for relation names, runtime modes, command/error codes and state transitions. Generate the atlas and field boards from the same model where possible, add a simple semantic consistency check for duplicated relations/state tables, and label deliberately simplified diagrams. Amend the master provider branch to show direct SIWC as an optional owned-loop route. Preserve historical research with clear dated scope rather than treating every excerpt as current code.

**Acceptance:** static comparison checks canonical names and supported transition coverage; review current master/provider/auth routes together. Parser checks remain separate from semantics and visual inspection.

### C13 — P1: private inputs can leak through derived project-visible checkpoints

**Evidence:** `track2-final-architecture.md:253` requires authorized publication of private sources. The checkpoint tool accepts an arbitrary summary, and the baseline M1 at `schema/falkordb-reference.cypher:60`–75 hardcodes project visibility for TaskState, Event and RequestReceipt while persisting checkpoint text and result/payload JSON. The sample warns that admission must check source access, but access by the producing session is not permission to disclose its derived content to the whole project.

**Failure scenario:** a worker is authorized to read a user-private note, paraphrases it in a checkpoint summary and emits no explicit source citation. The graph checkpoint and event stream expose that summary as project-visible. Correct source retrieval and citation checks do not prevent this disclosure. This can occur before any access revocation, so it is separate from C02.

**Minimal solution:** make output visibility an enforced information-flow rule. Conservatively inherit the most restrictive visibility of inputs loaded into the producing session/turn. Keep project task state/status nonsensitive and place restricted detail in a separate authorized record if necessary. Only an explicit reviewed publication can create shared text from private inputs. Alternatively, prohibit private inputs in workers permitted to publish automatic project summaries in the first release. Never rely on the model to omit secrets or declare its own output public.

**Acceptance:** place a synthetic marker in a private source, then request checkpoint, finding, failure summary, event replay and export. A derived record must remain within the private scope or be rejected pending explicit publication; unprivileged project members must not obtain it through summary/result JSON. Run separately from revocation tests.

### C14 — P1 scope decision: RLM is not needed for the selected hackathon product

**Evidence:** baseline `track2-final-architecture.md` section 13, `track2-rlm-and-prime-agent.md` sections 4–7 and schema RLM entities design an optional persistent code analysis environment, recursive request scheduling and checkpoints. Yet the flagship acceptance trace in delivery section 5 consists of file inspection/editing, requirement changes, fresh continuation and independent checks. None requires programmatic recursive long-input inference. The new user question explicitly asks whether that extra mechanism is justified.

**Failure scenario:** the team interprets the detailed RLM schema and master diagram as promised deliverables, adds a Python/kernel bridge and recursion/recovery implementation, and spends the four-day window reproducing Prime Agent's machinery while the simpler graph-memory demonstration remains incomplete. Even an optional but exposed RLM button and installed dependency expands packaging, isolation and expectation scope.

**Recommendation:** exclude RLM from the hackathon's runtime, dependencies, migrations, enabled tools, TUI actions and acceptance claims. Keep a clearly separated research note if desired. Do not merely put the same workload behind a disabled menu entry and continue describing it as part of what will ship. Ordinary bounded subagent delegation is also an extension, but it does not require RLM when later justified.

| Mechanism | Precise meaning | What it gives Threadline | What it does not give automatically | Hackathon decision |
|---|---|---|---|---|
| Model/tool action-observation loop | Model selects typed actions; host validates/executes; observations feed the next request | Read/search/patch/run, current context, human steering, Builder/Verifier behavior | Durability, graph authority and safe effects still require our harness | **Use this as the baseline** |
| ReAct | The paper interleaves model reasoning and environment actions | A useful conceptual ancestor for iterative action/feedback | It is not a database, scheduler or requirement to capture hidden reasoning | Describe ours as tool-calling or ReAct-style, without claiming exact paper reproduction |
| CodeAct / code as action | The model expresses actions as executable code, often using an interpreter to compose operations | Loops, data transforms and composition within an action | Safe replay, scoped effects and recursive long-context analysis do not follow from executing code | Defer a general interpreter; scoped commands are sufficient initially |
| RLM | A long input resides externally; generated code inspects/decomposes it and makes programmatic recursive model calls | A candidate approach for broad, distributed evidence analysis beyond a bounded prompt | Persistent memory, correctness, authorization and superior cost are not automatic | **Exclude from release; research only** |
| Bounded delegation | Coordinator starts separately scoped agent tasks and collects findings | Parallel investigations and specialization when independently useful | It is not RLM just because one agent calls another | Optional later after core passes |

The ReAct and CodeAct papers define different aspects of agent execution. The RLM paper addresses long-input inference. These mechanisms can coexist, but they are not an either/or choice of universal harness architecture. An ordinary tool loop can call a code tool; a code-driven environment can call typed tools; neither must have recursive language-model calls. [ReAct paper](https://arxiv.org/abs/2210.03629), [CodeAct paper](https://arxiv.org/abs/2402.01030), [RLM paper](https://arxiv.org/abs/2512.24601)

**What the local references establish:**

- Pi's coding README calls it a minimal extensible harness and says it omits built-in subagents. Its `packages/agent/src/agent-loop.ts:242`–270 streams an assistant response, extracts tool calls and dispatches them; its agent README describes subsequent tool-result turns. That is sufficient evidence for a useful ordinary tool loop, not proof that Pi never executes generated code through a tool.
- Codex's `codex-rs/tools/README.md:14`–17 lists code-mode adaptation and executable ToolExecutor/ToolCall contracts; its core README discusses operating-system isolation. The inspected product contains several execution mechanisms. Labelling all Codex simply “CodeAct” would overstate what that inspection establishes.
- Prime Agent's README at lines 38–65 intentionally centers a persistent Python environment, prompt variables and programmatic subagents; line 97 explicitly says its worker/kernel processes are not a security sandbox. Its broader design is useful inspiration but not a requirement for Threadline.

All of the baseline Track 2 behaviors work with the ordinary tool loop: retrieve current graph obligations before a request, append actual action observations, checkpoint exact artifact versions, invalidate old evidence, start a fresh session from a bounded packet, and admit an independent verification receipt. Graph memory is independent of whether an action is JSON or executable code.

**What could justify reopening RLM later:** a real workload requires synthesizing dispersed evidence over a corpus that does not fit into the useful prompt budget, simple indexed/graph retrieval misses necessary relations, and generated partitioning with model subcalls improves a declared metric. One candidate is recurring-failure analysis across a large authorized session/log corpus where relevant facts are spread across many unrelated records. Large files alone do not justify RLM: deterministic parsing, SQL/graph aggregation, search and ordinary tool-driven chunking may solve the problem more cheaply.

There is no proven workload here that only RLM can solve. Compare on identical sources and tasks: graph/lexical retrieval plus the normal loop; deterministic code analysis with the same tool interface; bounded delegation; and an RLM experiment. Predeclare supported-answer/evidence coverage, false claims, task success, model calls/tokens/cost, latency and failures. Adopt only if its measured benefit is worth additional kernel, isolation, request accounting and recovery complexity. A paper's results on its benchmarks are not Threadline results.

**Acceptance of the scope correction:** the packaged baseline runs the entire Track 2 trace with no Python kernel, RLM dependencies or recursive-call schema migration. Runtime/tool descriptions identify the ordinary loop. Future RLM notes visibly state “not shipped.” No README diagram implies its presence in the hackathon feature set.

## 4. Decisions challenged that should remain

| Question | Critic conclusion | Required evidence or limit |
|---|---|---|
| Is this an agent product or a harness? | A reusable execution kernel with role presets is justified. The flagship experience should remain interrupted coding work | Avoid generalized plugin/SDK surface before a second real implementation needs it |
| Why own a loop rather than fork Codex/Pi/Prime? | Own only durability/policy/coordination behavior; learn from their seams and reuse small libraries where conformance holds | Library use must preserve awaited pre-effect persistence; do not equate source inspiration with authorization |
| Why TypeScript rather than Rust? | TypeScript fits I/O, TUI, contracts and npm delivery; Rust has no demonstrated requirement yet | Runtime validation, queue bounds and process isolation are necessary regardless of language |
| Why RLM? | Remove from this release; large-corpus analysis is only a future research hypothesis | Compare simpler baselines first; no RLM claim from a task tree |
| Why Python? | No Python runtime is required for the baseline; a future isolated analysis experiment may use it | No arbitrary Python object recovery claim |
| Why agent spawning? | A scoped investigation can help, but it is a measured extension | Four-slot accounting must include waiting parents, unknown launches and retries; native bypass caveat is sound |
| Why two databases? | SQL capture/identity plus graph authority is coherent but materially increases failure modes | Keep two explicit commit bridges; never add an ORM fiction of atomicity across stores |
| Why FalkorDB instead of files? | Connected applicability and concurrent guarded authority are plausible benefits | Existing equal-information/versioned adjacency-file baseline is good; do not claim graph improves answer quality by construction |
| Is a graph per project isolation? | Useful boundary, insufficient inside a shared project | Project/user/session visibility, metadata privacy and derived output publication still need enforcement |
| Is RLS sufficient? | The plan correctly says no | Scope context must be transaction-local and roles tested; direct project/private predicates remain required |
| Are SQL FKs adequate? | Composite scope keys are a strong start | Active membership, provider spending, runtime roles and graph references are application invariants; C06/C07 address specific omissions |
| Are hashes enough for recovery? | No; the plan correctly separates artifact identity from actual bytes | Restore/export must retain required immutable objects and reject missing ones |
| Are receipts proof of correctness? | Only of named checks on exact inputs | C05 closes trusted-suite provenance; passing finite tests never proves all program properties |
| Can fences stop filesystem work? | No; the plan already states this accurately | Retain confirmed termination/quarantine and immutable candidate checks; do not replace them with stronger wording |
| Are subscriptions interchangeable with API keys? | No; the plan's route distinction is supported by checked primary sources | Account eligibility and exact client/provider version remain live gates, with no hidden paid fallback |
| Does any app need a universal certificate? | No such universal requirement is established | OpenAI dynamic local registration and Anthropic native-client terms are distinct; OS signing is separate |
| Is local npm/TUI portable? | Reasonable delivery, not a zero-prerequisite promise | Pin one tested OS/container target first; separately measure cold installation, secret store and process behavior |
| Should MySQL, remote hosting and browser UI be built now? | No | Preserve future contract without presenting untested alternatives as supported |
| Does static validation prove the design? | No; the existing validation report is candid | Actual SQL/Cypher/sandbox/fault/auth tests remain mandatory before support claims |
| Should Figma be updated now? | No | User's read-only instruction controls; existing connection/tool error is an external limitation, not an architecture defect |

## 5. Proposed smallest defensible delivery

Freeze an extension-free first release around one full, real trace: human goal and source -> owned API turn -> controlled tool result -> durable graph memory -> changed requirement -> stopped Builder -> genuinely fresh successor -> trusted Verifier -> current completion receipt -> restart with original evidence intact.

Retain the Track 2 proof points: episodic failure recall, accepted current semantic memory, one held-out procedure reuse, persistent visible history, shared handoff/evidence, tenant/private-source denial, and separately labelled 4/8/16 protocol-client probes. Reduce polished views and provider breadth before reducing these promises.

Use a fixed authored environment and registered command manifest. Start with a small TUI showing task, activity and evidence rather than seven fully featured screens. Supply public source and a tested package/tarball with Docker prerequisites, exact versions and a reproducible fixture. Additional OS support is earned by a clean-machine test.

After that release, choose **one** next extension based on user value: direct SIWC onboarding, native Claude compatibility, or bounded investigations. RLM stays outside the product roadmap until an actual large-source workload and usefulness test justify adding it. No requirement says all three extensions must arrive together.

## 6. Open decisions requiring an explicit owner

| Decision | Recommended default | Owner / proof |
|---|---|---|
| Human command journal representation | First-class typed journal linked to original source message | Storage + coordinator; C01 fault matrix |
| Provider request journal representation | First-class request/attempt record or exact capture contract, chosen once | Runtime + storage; C04 crash matrix |
| Verifier authorization | Evidence-only capability; keep Builder write claim | Runtime + graph; C08 ownership race |
| Acceptance suite provenance | Immutable suite/runner manifest outside candidate writes | Fixture + tools; C05 tamper tests |
| Privacy revocation behavior | Cancel and clean-session reconstruction | Identity + runtime; C02 request inspection |
| Provider profile sharing | Owner-only in first release | Auth + broker; C06 two-user billing denial |
| Revocation linearization | Single coordinator serialized admission barrier | Coordinator + storage; C07 interleaving test |
| Mandatory constraint resolution | Stable scope-to-Constraint relations followed to current versions | Graph + context; C03 version race |
| Restore support | Matching quiesced backup set; mixed restores maintenance-only | Operations + graph; C11 epoch tests |
| Supported first platform | One declared tested Docker/host combination | Operations; clean install and containment test |
| Model evaluation budget | Predeclare a small exploratory primary comparison, widen later | Evaluation owner; denominators and spend report |
| Provider/distribution policy | Local/open-source baseline, explicit route support manifest | Release owner; official terms + real authorized probe |

These are implementation choices that can be resolved without asking the user to redesign the product. Decisions that change the product promise, billing route or distribution scope need to be made visible to the user.

## 7. Independent primary-source recheck

Checked 14 October 2026. The current OpenAI registration documentation supports dynamic local registration using an issued client ID, PKCE and loopback callback; it does not require a client secret or partner API key for that specific route. Its preview documentation confirms a distinct streamed, non-stored Responses request profile with unsupported fields/tools. The plan correctly treats it as a separate integration, not an ordinary API-key substitution. [OpenAI registration](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)

Anthropic's current conditions distinguish running its unmodified binary with direct end-user authentication from offering third-party Claude login or collecting/intermediating subscription tokens. The plan's native Claude compatibility route and own-loop API route preserve that distinction. This source review does not establish that Threadline's future distribution or a particular account has passed an integration gate. [Claude Code conditions](https://code.claude.com/docs/en/legal-and-compliance)

No finding recommends copying archived OAuth tokens, disabling native authentication, or silently changing to paid API billing.

## 8. Recommended resolution order

1. Freeze the first-release manifest, explicitly exclude RLM, and settle role authorization: C14, C10, C08.
2. Close intent/recovery/epoch contracts: C01, C04, C11.
3. Close current authority, privacy and account boundaries: C03, C02, C13, C06, C07.
4. Pin trusted verification and per-turn evidence: C05, C09.
5. Regenerate and semantically review diagrams/models: C12.
6. Implement the first real end-to-end slice, then execute the declared gates. Do not describe a documentation correction as a passing runtime test.
