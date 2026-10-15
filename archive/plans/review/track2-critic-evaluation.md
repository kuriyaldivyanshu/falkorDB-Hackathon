# Independent evaluation of the Threadline architecture critique

> **Historical review snapshot.** The user subsequently requested complete removal of the proposed recursive-analysis module. Its plan document, SQL/graph entities and diagrams have now been deleted. Inventory counts and future-research recommendations below describe the reviewed baseline; use the [current schema inventory](../track2-data-model.md) and [resolution register](track2-review-resolutions.md) for the current design.


**Review date: 14 October 2026. Status: independent design review; no product execution or release certification.** This evaluator read the repository guidance, the four background decisions linked by the root README, the current architecture/protocol/authentication/delivery documents, reference schemas and relevant diagrams. Findings below concern specific proposed contracts, not hypothetical bugs in an implementation that does not yet exist.

The critic and evaluator are separate agents. The evaluator inspected the plans before receiving the critic's findings, challenged severity and proposed remedies, and independently checked current provider documentation. The parent agent owns revisions to the architecture; this report does not itself implement those changes.

## Priority decision: omit RLM from the hackathon release

**Confirmed release decision following the user's scope question and independent evaluation: build the ordinary model/tool harness and remove RLM from the hackathon release.** Retain RLM and Prime Agent as future research, clearly separated from required implementation, release migrations, installation, TUI actions and acceptance gates. Merely calling RLM optional while leaving its Python/kernel/subcall infrastructure in the first-release inventory still creates avoidable ambiguity.

| Mechanism | What changes in the harness | Recommendation |
|---|---|---|
| Ordinary model/tool loop | Model requests a typed action; harness validates, persists, executes and returns the observation | Core. This supplies all execution machinery needed to demonstrate Threadline memory and coordination |
| ReAct pattern | Interleaves reasoning and actions using observations to guide subsequent actions | Useful conceptual influence; no requirement to expose or store hidden reasoning |
| CodeAct pattern | Model expresses actions as executable code, composing calls/control flow in an execution environment | Separate optional tool-interface choice. A code executor still needs bounded capabilities, effect journaling and a sandbox |
| Bounded delegation | A separate worker receives a scoped task and returns a sourced finding | Optional after Builder/Verifier recovery; does not require RLM or a persistent Python kernel |
| RLM | Large input lives outside the root prompt; generated code inspects it and programmatically invokes model subcalls | Future research only until an incremental workload and measured benefit justify it |

The distinctions are supported by the original [ReAct paper](https://arxiv.org/abs/2210.03629), [CodeAct paper](https://proceedings.mlr.press/v235/wang24h.html) and [RLM paper](https://arxiv.org/html/2512.24601v3). These mechanisms can coexist; they are not mutually exclusive product categories. A coding harness can write and run repository code through ordinary tools without making arbitrary code its universal action interface or implementing recursive inference.

The inspected Pi source snapshot describes a minimal harness and an agent runtime with tool calling; it explicitly omits built-in subagents. This is direct evidence that a useful harness does not inherently require recursive workers. The inspected Codex snapshot describes core logic and execution isolation, while its tool documentation separates tool execution from orchestration. Those snapshots are useful design references but are not included in this repository export. This review does **not** establish that Codex implements a pure research-paper ReAct or CodeAct algorithm. The inspected Prime Agent snapshot chooses a persistent Python interface and recursive programming model; its additional product scope is a choice, not a requirement for Threadline. The Prime Agent snapshot is also omitted from this export.

The Track 2 differentiation remains durable source-linked memory, current requirement applicability, safe handoffs and verifiable fresh-session recovery. No RLM mechanism is needed to persist a goal, recall a failed attempt, supersede a constraint, supply a procedure or coordinate Builder and Verifier.

**Future RLM admission gate:** first identify an authored large-corpus task requiring dense evidence analysis that the ordinary graph-context/read/search loop demonstrably struggles with. Compare that loop, bounded delegation and RLM using the same source access, provider/model, answer rubric and declared total budget. Include all root/subcall/retry usage; if exact token/cost accounting is unavailable, use an enforceable common request/time ceiling and disclose that cost matching is approximate. Measure supported answers, missed evidence, incorrect citations, latency and usage across repeated held-out variants. Adopt RLM only if the observed gain matters enough to justify its additional containment, recursion, restart and operational cost. This is a future experiment, not a presumed advantage.

## 1. Evaluation standard

A finding is accepted when a concrete missing or conflicting contract can break a stated outcome, and its proposed remedy preserves the user's intended compact TypeScript harness, FalkorDB memory, local TUI, later subscription routes and separately retained RLM research. An unexecuted acceptance test is not, by itself, an architecture defect: the existing plans consistently identify their claims as proposals.

- **P1:** resolve the design before implementing the affected path; its runtime acceptance case blocks advertising that path as supported.
- **P2:** material precision, feasibility or observability issue; resolve before relying on the affected guarantee.
- **Accepted:** evidence supports the finding and an appropriately bounded remedy.
- **Partially accepted:** a narrower finding is real, but a broader interpretation or stronger guarantee is not justified.
- **Rejected:** the asserted defect is contradicted by the plans or current primary evidence.
- **Unresolved:** evidence or an execution probe is still required. A written resolution can close a design gap while leaving runtime proof unresolved.

## 2. Finding-by-finding adjudication

These IDs are coordinated with the architecture critic. Evidence describes the reviewed baseline; later remediation is assessed separately rather than silently rewriting the original observation.

### C01 — Durable admission of human intent

**Accepted, P1.** [Database ownership](../track2-data-model.md), section 5, preserves a human source before graph admission, but the original `project_messages` table retained text, digest and request ID without the complete operation, preconditions or retry lifecycle. The original `capture_outbox` required an agent capture event, so it did not cover a pre-run human requirement change. A crash can leave a durable sentence without enough information to safely finish or reject its intended operation.

**Resolution:** transactionally persist the original source and an immutable command envelope in a command inbox. Include actor/target, operation/schema, canonical digest, expected revisions, originating graph epoch and durable pending/leased/terminal state. Retry the same command identity; reconcile a committed RequestReceipt before resubmission. Never reinterpret stored prose into a different operation during recovery. Recheck authorization at admission; a stored command is not permanent permission.

**Future acceptance:** crash after the SQL transaction, after graph commit and before SQL acknowledgement, and after membership revocation. Restart must produce exactly one accepted graph transition or one visible terminal rejection, preserve the original source, and never mutate a new epoch by silently rebasing the old command.

### C02 — Revocation after private context was loaded

**Accepted, P1 for source-private operation.** The baseline failure table in [the architecture](../track2-final-architecture.md) prescribed recomputing packets and refreshing sessions after a visibility change. That cannot remove bytes already present in the runtime's conversation, its summaries, descendants, RLM variables or a provider's received request.

**Resolution:** stop further admission, revoke the affected runtime capabilities, cancel/reconcile active work, and retire exposed sessions and derived state. Resume only in a fresh authorized context assembled from still-permitted sources. Treat derived summaries and child/RLM context as potentially exposed unless their dependency provenance proves otherwise. Record that previously disclosed information cannot be retracted; source revocation is a forward-access guarantee, not remote erasure.

**Future acceptance:** load a synthetic private marker into a parent, derived summary and child; revoke access; attempt another turn, source read, tool action and export. Old execution must be refused, and the fresh request/artifact/export manifest must exclude the marker and its unauthorized derivations. This validates controlled submissions, not a promise that a model or remote recipient has forgotten prior data.

### C03 — Current-constraint resolution can omit a superseding version

**Accepted, P1 as a query-contract gap.** The baseline R2 sketch in [reference Cypher](../schema/falkordb-reference.cypher) followed `Task -> ConstraintVersion <- CURRENT_VERSION`. If the task retained an old-version edge after a constraint was superseded, the join could omit the rule. A global revision check cannot prove that a newly assembled packet contains the missing current rule.

**Qualification:** the file explicitly calls its queries sketches and does not claim they are a deployed complete implementation. The finding is that this sketch is unsuitable as the mandatory-context algorithm without another invariant.

**Resolution:** maintain stable task/scope membership to constraint identities and resolve their current versions during closure construction. Historical version links retain evidence meaning. Resolve inherited project/goal/task obligations, detect missing or multiple current versions, and fail closed rather than returning an apparently complete empty set. A lazy task rebase may acknowledge a new project revision only after complete current obligations and applicability have been rebuilt.

**Future acceptance:** replace a constraint version without rewriting historical task edges, then start a fresh worker. Its packet must contain the new exact rule and preserve the prior version only as historical evidence. Missing/duplicate current-version links must block the turn; unrelated changes may cause conservative revalidation but cannot erase obligations.

### C04 — Provider-request journal and recovery mapping

**Accepted, P1.** [Runtime protocol](../track2-runtime-and-protocols.md), execution step 4, requires persistence of request intent, input digest and turn identity. The baseline schema did not specify the recovery projection or typed capture-event payload that fulfils that requirement. A generic JSON event table can support it, but only with an explicit contract.

**Resolution:** define either an explicit request journal or typed append-only request events plus a recoverable index. Separate a logical turn from each network attempt; bind exact rendered input, provider/profile, reservation, permitted continuation state, usage precision and outcome. Persist before submission, retain an unknown outcome when submission may have succeeded, and never replay a tool effect because inference was retried. A new table is a reasonable design choice, not the only valid one.

**Future acceptance:** crash before submission, after submission but before receipt, mid-stream and after a completed tool request but before tool execution. Recovery must identify which requests are unsent, complete or unknown, account for possible duplicate inference cost, and execute no tool before the durable complete-call barrier.

### C05 — Protected verification must include the actual check implementation

**Accepted with narrowed wording, P1.** The graph already defines `Criterion.check_ref` as an approved immutable check definition. That is useful existing protection. However, [verification](../track2-final-architecture.md), section 10, does not explain whether a command such as `npm test` resolves a Builder-modified script, imported assertion helper, runner configuration or dependency.

**Resolution:** keep the acceptance bundle outside Builder-controlled writes and pin its transitive execution definition: launcher, assertions, configuration, relevant dependency/environment digest and expected result. Execute it against the immutable candidate as untrusted input. Ordinary repository tests can still be useful evidence, but changing them cannot silently change the accepted criterion. Human approval of a changed criterion creates a new criterion/requirement revision.

**Future acceptance:** alter the candidate's package script, local test or imported helper to return success while the implementation remains wrong. The protected acceptance check must still fail; changing a protected check must be denied or require a new approved criterion and new receipts.

### C06 — Project access must not imply permission to spend another user's provider allowance

**Accepted, P1.** The baseline SQL correctly binds profiles to their owning provider account, but the run FK only establishes that an initiator is a project member and that the selected profile belongs to that project. The plans do not explicitly require the initiating user to own the provider account or hold a separate delegation. Source visibility and billing authorization are different predicates.

**Resolution:** in the first local release, require the initiating principal, profile owner, provider-account owner and native host/account binding to agree. No implicit shared billing within a project or tenant. If service-account or delegated billing is later needed, add an explicit scoped grant and separate quota/audit policy rather than inferring it from project membership. The provider broker must enforce this at request admission, including retries, children and RLM calls.

**Future acceptance:** two synthetic project members, each with a distinct mock provider credential. One member tries the other's profile ID through run, child, resumed session and RLM APIs. Every unauthorized request must fail before credential resolution or provider submission, and errors must not disclose credential metadata.

### C07 — Define the ordering of revocation and graph admission

**Partially accepted, P1 for the advertised revocation guarantee.** SQL membership checks and graph mutations are separate operations. The baseline assertion that membership revocation stops new admission immediately is stronger than a check followed by an uncoordinated write. However, it does not follow that a distributed transaction or new service is necessary, and revocation cannot undo an already running external effect.

**Resolution:** define the admission linearization point and serialize authorization changes with affected admission in the selected single coordinator. Use a consistent lock/order and recoverable restrictive state; recheck current authorization while holding the admission gate. A revocation that wins ordering blocks later provider/tool/graph admission. Work admitted earlier is cancelled and reconciled according to its actual process outcome. Do not claim simultaneous atomic revocation across databases and filesystems.

**Future acceptance:** pause an operation after its initial membership lookup, commit revocation through the coordinator, then resume the operation. No later admission may occur. Exercise the inverse ordering too: an already admitted effect must be identified and cancelled/reconciled, never falsely described as prevented. Restart during the revocation sequence must fail closed.

### C08 — Verifier authority must be separate from Builder ownership

**Accepted, P1.** The runtime baseline tells every session to acquire a task claim, whereas the graph gives a TaskState one current owner. Builder and independent Verifier must operate without transferring the Builder's write ownership to the Verifier merely to run checks.

**Resolution:** retain the single Builder write claim. Give Verifier an evidence-only assignment/reservation bound to the target task, candidate, criteria, environment and requirement revision. Its permissions permit checks and receipt submission, not task ownership changes or Builder edits. A separate verification task could also work, but is unnecessary if the assignment is explicit in the existing launch/session contract.

**Future acceptance:** run Builder and Verifier together. Builder remains sole write owner; Verifier can check its assigned snapshot and submit a receipt; Verifier cannot patch or complete the coding task. Replace the candidate while verification runs and confirm the old receipt remains historical but cannot complete the new candidate.

### C09 — Context delivery identity is narrower than repeated submissions

**Accepted, P2.** The baseline `context_deliveries` uniqueness on `(tenant, project, session, packet)` allows only one delivery per packet per session, while the owned loop can legitimately submit the same unchanged packet on multiple model turns. Updating one row would erase insertion history.

**Resolution:** allocate a stable submission identity before transport submission, keep native turn IDs as optional observed correlation, and deduplicate on that identity. Allow the same packet/session pair to have several distinct deliveries. Each receipt must state its acknowledgement strength and target request/turn; do not infer a provider turn ID before it is observable.

**Future acceptance:** submit one packet in two different turns and retry the first submission. Persist two delivery records with independent outcomes and one deduplicated retry, preserving the exact request linkage for each.

### C10 — Freeze an implementable first slice and explicit release cut lines

**Partially accepted, P1 feasibility risk; not evidence that the architecture is intrinsically too large.** The full target is appropriate to the user's request for an end-to-end plan. The existing documents already mark RLM, native adapters and additional providers as extensions. The remaining gap is an exact first-slice inventory and a bounded evaluation campaign: generic staging language leaves engineers facing a broad dual-store system and many optional surfaces.

**Resolution:** name one provider/API route, one supported sandbox/OS environment, one authored fixture, one active run, sequential owned tools, one Builder plus one evidence-only Verifier, the required state/commands and one complete recovery path. Publish a milestone inventory before implementation. Install only the schema slices needed by that path or explicitly distinguish installed-but-unused reference tables. Scale the evaluation budget in stages, retaining matched facts and disclosed sample sizes. Keep the target design and Track 2 requirements; defer breadth rather than removing persistence, isolation, changed-requirement recovery or independent evidence.

**Future acceptance:** a teammate can enumerate the first slice's commands, tables/labels, supported route and failure gates from one document; the packaged entry point executes that slice without optional modules. The release manifest labels every skipped extension and unexecuted evaluation. A calendar estimate alone is never a passing gate.

### C11 — Restore epoch must remain bound to the original command

**Accepted, P1.** The architecture already recognizes graph epochs and mixed-store restore risks, which is correct. The baseline command JSON omitted the expected epoch, its digest contract did not explicitly include it, and R1 returned a receipt without resolving the original event epoch. If a backend substitutes a newly routed epoch during delayed-command admission, restored revision/fence values can accidentally satisfy an old command.

**Resolution:** include expected epoch in the immutable command, digest and scoped launch/tool authorization; validate it before current-authority admission. Receipt lookup must return the committed event's original epoch. Historical receipt inspection is allowed, but never constitutes authority for new-incarnation work. A controlled restore fences old capabilities and quarantines pending old-epoch domain/effect commands. Immutable source-observation repair is a separate history-ingestion policy, not automatic reexecution of the original user command or external effect.

**Future acceptance:** restore a graph whose task revision and fence happen to match a delayed old command. Admission must still return `EPOCH_MISMATCH`. Read an old receipt and verify it is labelled historical. Repair a retained SQL source anchor without granting the old worker ownership or repeating a tool/model operation.

### C12 — Canonical vocabulary and diagram semantics drift

**Partially accepted, P2.** `INCLUDED` in the baseline master text conflicts with the actual `INCLUDES` graph relation and could break copied invalidation logic. A state diagram omitted cancellations that the transition table permits. The master/provider/authentication views also differed in how directly they displayed the owned SIWC route.

**Qualification:** a high-level diagram may legitimately omit detail; it is not automatically defective because it shows fewer routes. The requirement is explicit simplification and consistency, not identical exhaustive diagrams everywhere. Historical evidence under an obvious supersession banner is not a live contract defect.

**Resolution:** establish canonical relation/state/runtime vocabulary, fix incorrect names, and generate repeated schema views from one model. Mark simplified architecture diagrams as summaries; ensure their labels do not contradict detailed route ownership. Include every advertised cancellation state in the canonical state machine. A semantic name/transition check complements Mermaid parsing.

**Future acceptance:** compare all current relation names and state-transition definitions to the canonical model; no accidental `INCLUDED` edge remains and every unfinished task state has the intended cancellation path. Review owned API/SIWC and native subscription routes together. Syntax success alone must not close this item.

### C13 — Private inputs can leak through project-visible derived output

**Accepted, P1; distinct from revocation.** The baseline already requires authorized publication, but it does not state an output-visibility rule for every checkpoint. M1 hardcodes project visibility on TaskState/Event/Receipt while accepting `checkpoint_text` and `result_json`. A session may be authorized to read a private source yet lack permission to paraphrase that source into shared task history. Citation filtering cannot catch an uncited paraphrase.

**Resolution:** use conservative source scope for derived content. Project-visible checkpoints must contain only content approved for that audience; privately derived detail stays private or is quarantined pending an explicit authorized Publication/declassification decision. Keep nonsensitive shared task metadata separate from private detail. With incomplete provenance, conservatively treat the whole producing session/output as restricted. For a smaller release, shared task workers may be restricted to project-safe inputs and must reject private inputs rather than pretending to support safe arbitrary declassification.

**Future acceptance:** provide a synthetic private marker to an authorized worker, request a project checkpoint without citing it, and inspect TaskState text, event payload, receipt, TUI, SSE and export as another member. No private content or sensitive source metadata may be disclosed; explicit authorized redacted publication must be independently recorded and checked.

### C14 — RLM has no demonstrated necessary role in the hackathon workflow

**Accepted, P1 scope decision.** The user specifically questioned whether RLM is needed. None of the declared core demonstrations requires recursive external-context inference. The priority decision above distinguishes RLM from ordinary tools, CodeAct and bounded delegation and gives a concrete future value gate.

**Resolution:** remove RLM from the hackathon runtime, dependency installation, migrations, feature menu and required acceptance suite. Keep its design and Prime Agent comparison as future reference. Retain the controlled model/tool loop, current graph context, durable history and Builder/Verifier coordination. This is a justified scope reduction, not a claim that RLM is generally ineffective.

**Future acceptance:** the supported release trace, runtime-mode manifest and installation contain no RLM/Python/kernel requirement; all core memory/recovery/verification cases pass without it. Any later proposal must satisfy the matched-source, matched-budget workload gate stated above.

## 3. Claims the evaluator does not accept as defects

1. **“The plans are untested, therefore misleading.”** Rejected. They repeatedly distinguish proposals, syntax checks and actual runtime tests. Preserve that distinction after remediation.
2. **“Subscriptions cannot be used by a custom local application.”** Rejected as a blanket statement. Current official OpenAI documentation describes an eligible local/open-source direct ChatGPT route with dynamic registration. Native Claude Code has a distinct permitted authentication route under its stated conditions; that does not authorize borrowing tokens for Threadline's own inference loop. [OpenAI registration](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [Claude product conditions](https://code.claude.com/docs/en/legal-and-compliance).
3. **“A universal certificate or provider-neutral OAuth implementation unlocks both subscriptions.”** Rejected. Issued client registration, user consent, route eligibility and application signing are different. Existing authentication guidance correctly treats them separately. [OpenAI scope](https://developers.openai.com/siwc/token-sharing-open-source), [Claude SDK conditions](https://code.claude.com/docs/en/agent-sdk/overview).
4. **“Use Rust or copy Prime Agent to make this a real harness.”** Rejected. Language choice does not establish durable effect barriers or sandboxing. The user-selected owned TypeScript loop remains compatible with the required behavior. RLM is optional workload-specific analysis; making a Python kernel mandatory would be a new product decision.
5. **“Exactly-once tools or model understanding must be guaranteed.”** Rejected. The architecture correctly limits receipts to actual recorded observations and uses reconciliation for unknown external effects. Stronger guarantees would be unsupported.

## 4. Provider evidence check

On 14 October 2026, the evaluator opened the official Claude Code legal and Agent SDK pages and fetched the official OpenAI SIWC registration page. The first web fetch of the latter failed, so its official Markdown version was retrieved read-only. No login, token file, model inference or account entitlement was inspected.

The primary sources support retaining the existing route distinction. The OpenAI page confirms an issued client ID, PKCE, state/nonce and validated inference scope; direct local registration does not require a client secret or partner API key. The Claude pages distinguish an unmodified native binary with direct end-user authentication from third-party SDK/application inference. The acceptance test must still establish actual account eligibility and pinned-client behavior. [OpenAI sign-in contract](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [Claude native conditions](https://code.claude.com/docs/en/legal-and-compliance), [Claude SDK overview](https://code.claude.com/docs/en/agent-sdk/overview).

## 5. Remediation re-review status

**Independent reread completed on 14 October 2026. All fourteen findings have an adequate documentation-level disposition within the declared first-release scope. No runtime acceptance gate is closed by this review.** The evaluator read the actual revised contracts, schema definitions and relevant diagram sources after the parent applied changes, rather than accepting the resolution register alone.

| Finding | Actual correction inspected | Re-review result |
|---|---|---|
| C01 | Runtime section 13, `command_inbox` DDL/dictionary, command-recovery diagram and RV01 | Complete immutable command/source binding, leased admission, original epoch/receipt settlement and visible pending versus accepted state are specified |
| C02 | Runtime section 18, master failure behavior, deletion workflow, privacy-revocation diagram and RV02 | Exposed conversations/descendants are retired; sanitized fresh sessions replace ordinary refresh; previously sent bytes are explicitly not retractable |
| C03 | Runtime section 15, graph `SUBJECT_TO` relationship, R2 and RV03 | Stable applicability and current-version resolution replace the omission-prone join; missing/duplicate/inaccessible obligations fail closed; lazy rebase sits behind the global requirement barrier |
| C04 | Runtime section 14, `model_requests` DDL/dictionary and RV04 | Logical request versus attempt, exact input artifact, dispatched/unknown outcomes, profile/reservation and response/usage correlation are represented |
| C05 | Runtime section 16, master verification contract, Criterion/VerificationReceipt bundle fields and RV05 | Protected transitive acceptance bundle plus trusted assertion/receipt process outside candidate control; malformed/forged/missing/early-exit results fail |
| C06 | Runtime section 17, authentication scope and RV06 | Explicit initiating-user/profile/account ownership equality is enforced by proposed admission; no project-wide shared spending grant is inferred |
| C07 | Runtime section 17, master membership behavior, resolution register and RV07 | One installation-wide authorization/admission gate now covers tenant/provider revocations across projects; restart and already-admitted-effect limits remain explicit |
| C08 | Runtime sections 1/15, SQL authorization manifest/digest, graph session/launch bindings and RV08 | Verifier gets evidence-only assignment/reservation and cannot take Builder's write claim; assignment staleness is explicit |
| C09 | SQL `context_deliveries.submission_id` and revised uniqueness, graph ContextLoad, runtime section 8 and RV09 | Owned submission ID binds the preallocated model-attempt ID with session/packet checks; persistence retries deduplicate, while deliberate new provider attempts retain distinct delivery records |
| C10 | First-vertical-slice document, delivery cuts and RV10 | One provider/OS/fixture/run, two role workers and exact first/core/full storage inventory replace an implicit all-feature deadline; feasibility remains a measured risk |
| C11 | Command envelope/digest, runtime section 13, epoch-scoped receipt index/constraint/R1/M1 and RV11 | Current admission binds original epoch; old domain/effect commands are quarantined; historical observation repair cannot replay effects |
| C12 | Canonical `INCLUDES`, state-machine cancellations, master/provider diagrams and RV12 | Specific vocabulary/state/route discrepancies are corrected; high-level target diagrams remain summaries rather than exhaustive core-release manifests |
| C13 | Runtime section 18, graph session output-scope properties, restricted public M1 and RV13 | Conservative readership applies to free-form derived outputs, not only citations; safe shared state is separated from private detail |
| C14 | Harness/technology/master/release documents, runtime/tool list, core DDL and RV14 | No RLM runtime, role, table, Python/kernel dependency or release action is required; full target research references are distinctly labelled |

The reread found two residual ambiguities, and the parent corrected both before this disposition: a per-project gate did not cover cross-project tenant/account revocation, so it became installation-wide; immutable test files did not prevent candidate code from interfering with assertions in the same process, so protected assertions and receipt writing now execute outside the candidate-controlled process/isolate. Both revised passages and RV05/RV07 were rechecked.

The evaluator independently counted **36 full-reference SQL tables and 31 core-reference tables** and confirmed that core DDL creates no `rlm_*` table or RLM role. The graph retains 34 target labels, with three identified as future RLM research; these are reference designs, not proof of an implemented schema. The parent's broader FK/link/Mermaid/SVG checks are reported in [artifact validation](../validation.md); the evaluator did not repeat those parser or renderer runs and does not promote them to runtime evidence.

The narrowed four-client probe supports only a declared smoke-test result. It cannot substantiate high-concurrency capacity; larger 8/16-client studies remain deferred and the current delivery wording says so. The full 31-table core remains substantial for four days even after removing RLM. That delivery risk remains open; the first integrated milestone must expose whether the chosen scope is achievable.

The [resolution register](track2-review-resolutions.md) and [RV acceptance cases](../track2-delivery-and-validation.md#14-adversarial-review-acceptance-additions) now distinguish baseline findings, changed contracts and future execution evidence. SQL/Cypher remain reference definitions; no login, provider inference, migration, sandbox, recovery, privacy-canary or load experiment was performed by this evaluator. Figma remains unchanged under the read-only instruction.

## 6. Release-blocking and optional gates

Before calling the core supported, execute durable-intent and request recovery, complete current context, stale-owner/candidate rejection, independent protected verification, authorized provider selection, forward revocation, tenant/project/source isolation, sandbox containment, persistent history and packaged fresh-session recovery. SQL/Cypher syntax or Mermaid rendering cannot substitute for those tests.

Native Codex/Claude, direct ChatGPT OAuth, spawning, extra providers, a second operating-system target, MySQL and remote hosting remain later candidates with independent gates. RLM is excluded from the hackathon and has no committed implementation milestone; reopening it first requires the workload-value decision above. An omitted extension is an honest scope cut. An enabled extension with unverified authentication, effect isolation or budget admission is not.

Residual risks even after the design is tightened: provider/client policy drift; unrecorded external effects; imperfect model behavior; incomplete dependency provenance; uncertain usage on interrupted inference; source loss; local same-user compromise; and a four-day integration schedule. Bound or disclose these risks and measure the selected workflow. Do not write that every possible issue is solved.
