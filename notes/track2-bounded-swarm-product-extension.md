# Threadline: proposed bounded spawning extension

**Proposal, 2026-10-13; not implemented, measured or committed product scope.** Preserve the [Builder/Verifier browser workflow](track2-user-experience-and-delivery.md) and [graph-memory requirements](track2-package-and-requirements-decision.md). Add this only after fresh-session recovery, evidence checks and requirement revisions work.

Chai models standard, recursive and adaptive swarms through simulations with specified coordination costs. This motivates testing delegation; it does not demonstrate speedups for our coding workflow. [Predictable Swarm Scaling](https://wenhaochai.com/blogs/predictable-swarm-scaling.html)

## The proposed product mechanism

**An agent may request a bounded child investigation, but FalkorDB governs its scope, readiness, evidence and recovery.** Spawning is useful when a failed check leaves genuinely separable questions: backend freshness diagnosis, CSV/protocol checks or competing read-only hypotheses. It is not the default response to every task.

The standout demonstration is **targeted finding publication plus crash recovery**: a child discovers a source-backed fact, only affected workers receive it, then a failed child resumes in a fresh session against the current requirement. An unrelated worker keeps its context. The visible benefit is the right evidence reaching the right unfinished work despite disruption, not the number of agents on screen.

The Builder proposes a child objective, inputs, permitted tools, expected evidence and stopping condition. The service checks recorded prerequisites, duplication, ownership, workspace scope and available budget before creating the task/worker contract. No native process-spawn tool bypasses this path. The model chooses a useful investigation; deterministic code enforces bounds. A graph cannot establish that a proposed split will be productive, so actual outcomes must test that judgment.

The core supports **parent-initiated depth-1 branching**: Builder is depth 0; its children are depth 1 and cannot spawn. Do not advertise arbitrary recursive swarms. Depth 2 is a separately gated stretch experiment.

## One controlled demonstration

Use the authored inventory-export repository and actual agent/tool activity:

1. Builder encounters a failing export check and proposes two specific investigations: backend freshness and serialization/protocol behavior. Each child gets its applicable criteria, relevant files, earlier attempts and evidence references. Verifier remains a separate working role.
2. The protocol child reproduces a quoted/multiline defect and records the source revision, fixture and tool receipt. The finding is initially a proposal. Its cited evidence is checked before publication; an unsupported assertion is not accepted project knowledge.
3. Graph relations connect the published finding to serializer work and workers who loaded that context. Their next supported boundary delivers the relevant update and records acknowledgement. The backend child does not receive the entire protocol transcript merely because it exists.
4. Change the freshness requirement while backend investigation is unfinished, then actually terminate that child session/process. Mark any uncertain tool outcome. After its termination is confirmed, create a fresh successor with the current requirement, applicable earlier rejection and checkpoint. It inspects observable artifacts before retrying.
5. A late result from the old revision cannot complete the current task. The successor supplies current evidence; Builder makes the patch and Verifier runs current checks. The protocol evidence remains usable if its own conditions are unaffected.

If the evidence relationships are incomplete, show unknown coverage rather than claiming every affected task was found. Clearly label any replay; a canned child animation does not establish spawning or recovery.

## Graph authority and publication boundaries

The existing graph vocabulary needs only a small extension: parent/child task links, a spawn contract, budget reservation, finding status and links from evidence to applicable work. Reuse sessions, messages, task revisions, attempts, artifacts and loaded-context acknowledgements.

Useful traversal:

`source/requirement revision → finding or decision applicability → dependent task → worker's loaded context → refresh acknowledgement → current result receipt`

Keep independent hypothesis branches from sharing unverified conclusions. Store proposals, contradicted observations and accepted source-bound findings distinctly. A confident child is not an authority. Conflicting claims preserve their sources and request investigation; do not resolve them through majority vote. A receipt supports only the artifacts, environment and conditions it actually tested.

Publish compact findings and immutable evidence references, not full child transcripts into every parent context. Retrieval includes current mandatory constraints before optional discoveries; if required context exceeds the budget, expose the overflow. Relevance and delivery are different: record whether a worker received an update and test whether its subsequent action respected it.

FalkorDB supports atomic individual queries and serializes same-graph writes. Application claims, reservations and revision guards still require tested mutations; database behavior does not make filesystem actions exactly once. [Concurrency design](https://docs.falkordb.com/design/concurrency), [architecture boundaries](track2-continuity-architecture.md)

## Concrete bounds and user controls

| Bound | Proposed core rule |
|---|---|
| Global concurrency | **Four live model workers total**, including Builder, Verifier and waiting parents; therefore at most two additional children with both roles live. Coordinator/service code is not another model worker. |
| Depth | **1 in core; 2 only as stretch.** Global limits apply across every subtree, not separately per parent. |
| Lifetime spawning | At most **four child sessions per run**, including recovery replacements; termination/reconciliation precedes reuse of an occupied slot. |
| Child work | One narrow investigation, at most **10 tool calls or 3 minutes** before checkpoint/stop. Core children are read-only investigators; Builder owns edits and integration. |
| Run budget | Initial experiment ceiling: **40,000 aggregate input/output tokens, 20 minutes and a user-set monetary limit**. Count all workers and retries; reserve the bounded next request before launch. Dollar accounting uses the selected provider/model, not an invented universal token price. These are test settings, not measured optimal limits. |
| Overflow | Queue or continue sequentially when capacity is full; deny another child when budget is exhausted. A reservation is not a guarantee of a useful result. |

Expose “Parallel investigations: off/on,” the run budget and “stop children” in the existing workspace. Child cards show objective, parent, state, evidence and budget consumed. A compact task tree is sufficient; no separate swarm dashboard. Budget/runtime caps cannot reverse an external action already performed. Missing accounting must be visible and prevent further spending authorization.

## Why this might fail

Anthropic's production research account warns that coding has less genuine parallelism than research, and that additional agents materially increase token consumption. It also documents checkpointing and coordination problems. Those are contrary signals and existing practice, not evidence of our advantage. [Anthropic engineering](https://www.anthropic.com/engineering/multi-agent-research-system)

Four workers may be slower than Builder+Verifier because the Builder waits on evidence, children duplicate discovery or delivery introduces stale authority. Read-only investigation avoids concurrent patch merging but cannot eliminate conflicting interpretations. This extension must earn its complexity; spawning alone is established behavior and no novelty or placement claim follows.

## Falsifiable adoption gate and four-person scope

After the base recovery path passes, compare **sequential investigation**, **small flat delegation** and **bounded parent-initiated delegation** on the same public snapshots, captured facts, model/tools, permitted evidence, aggregate spend ceiling and interruption schedule. Give flat workers equivalent task context; do not handicap the baseline by deleting a needed source. Separately compare graph delivery with an equivalent versioned file/JSON record.

Use held-out variants: useful parallel questions; a wholly sequential dependency chain; a misleading unsupported finding; duplicate spawn requests; exhausted budget; changed requirement; crashed child; late stale result. Report current acceptance-test outcomes, unsupported/stale actions, duplicate investigations, delivered context, total tokens/cost, latency and recovery work. Show individual failures and repetitions, not simulated scaling curves as product measurements.

**Keep depth 1 only if it improves a declared useful outcome within the matched budget without weakening correctness.** If flat delegation matches it, keep flat execution and the evidence/continuity mechanism. If two workers suffice, drop spawning. Depth 2 additionally requires a genuinely nested held-out task and verified global bounds.

Owner A extends scope/evidence/claim guards; B adds the controlled child lifecycle; C tests publication, current verification and crash reconciliation; D adds child cards and matched-budget fixtures. No new provider, external connector, distributed scheduler, autonomous patch merger or full RLM belongs in this event extension. Written planning now; main implementation remains event-time work.
