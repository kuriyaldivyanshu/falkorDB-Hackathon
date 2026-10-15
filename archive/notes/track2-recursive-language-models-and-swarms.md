# RLMs, bounded workers and FalkorDB

**Research checked 13 October 2026. No implementation, installation or benchmark was run.** Recommendation: borrow bounded decomposition and external context handling; preserve Threadline's controlled runtime, evidence checks and recovery product. Do not reproduce an entire RLM or claim that more agents guarantee better results. The linked swarm blog is covered separately in the parent research; its simulations are not our product measurements.

## What RLM actually changes

The latest **Recursive Language Models** paper is **v3, 11 May 2026**. Its root model writes code to inspect an externally stored prompt, delegate constructed slices and retain intermediate variables. Bounded observations enter model context. Programmatic recursive inference is the distinctive mechanism. [Official paper](https://arxiv.org/html/2512.24601v3)

Tests include retrieval, aggregation and repository questions at depths 0–3; deeper recursion has mixed results. The authors identify subcall-cost and guardrail limitations. **Our inference:** those benchmarks do not establish patch completion, durable handoff, ownership or tenant isolation. We must evaluate those separately. [Methods, results and limitations](https://arxiv.org/html/2512.24601v3)

| Mechanism | Unit of work | State we still need |
|---|---|---|
| RLM inference | Programmatically constructed input slice and returned result | Cross-run authority, task ownership and evidence applicability |
| Coding worker | Objective, permitted tools, workspace and acceptance checks | Durable assignment, revision guard and reconciliation after failure |
| Proposed FalkorDB core | Relationships between goals, tasks, decisions, evidence and sessions | Application-enforced publication rules and observable file/tool verification |

These can complement one another. They solve different parts of the problem; a recursive model call need not become a durable worker session.

## What the official implementation supplies

The [authors' repository](https://github.com/alexzhang13/rlm) includes ordinary and recursive subcalls, batching, custom tools, environment options and trajectory logging. Its README warns that the default local environment executes on the same host and is inappropriate for production.

Inspected `main` source exposes depth, iteration, concurrency, token, timeout and budget controls. `persistent=True` reuses an environment attached to the live RLM object across completions; that does not establish recovery after a process restart. Child calls inherit configured subtools. Timeout checks occur before iterations and token/cost checks afterward: these are not hard guarantees against overspend or a blocked tool. Recursion and propagated concurrency limits do not establish one globally reserved worker budget. [Actual core source](https://raw.githubusercontent.com/alexzhang13/rlm/main/rlm/core/rlm.py)

There is documentation drift: the [API page](https://alexzhang13.github.io/rlm/api/) says only depth 1 is supported, while current source enables deeper recursion for local, IPython and Docker environments. Repository links here are moving `main`, inspected on the date above; no commit pin or runtime compatibility was verified. Pin and probe actual contracts before adopting this library. It is not a prerequisite for our MVP.

## Evidence against automatic scaling

**Towards a Science of Scaling Agent Systems**, **v3, 8 April 2026**, studies 260 configurations across six benchmarks and several coordination architectures. Parallelizable tasks sometimes benefit, but sequential planning deteriorates and tool-heavy coordination can add overhead. In its small SWE-bench extension, the reported mean single-agent score exceeds each multi-agent architecture; confidence intervals overlap and each configuration uses only 20 instances. This is evidence to test our decomposition, not to declare all multi-agent coding inferior. Its fitted capability threshold is not a universal spawning rule. [Current paper](https://arxiv.org/html/2512.08296v3), [authors' artifacts](https://github.com/ybkim95/agent-scaling)

The often repeated **17.2× independent / 4.4× centralized** figures concern a trace-level error-amplification measure, not task failure probabilities. Model families, scaffolds and small coding samples limit generalization. Earlier indexed summaries describe 180 configurations and four benchmarks; cite the inspected version explicitly. [Definitions and limitations](https://arxiv.org/html/2512.08296v3)

A separate **3 March 2026** RLM reproduction finds that depth 1 sometimes helps, while deeper recursion increases latency and reduces accuracy in its experiments. It uses two models, two narrow tasks, 20 examples per task and single runs without uncertainty estimates. It also predates the official paper's May revision. Preserve it as limited contrary evidence, not a universal verdict on recursion. [Independent primary report](https://arxiv.org/html/2603.02615v1)

## Actionable mapping for our four-day product

**The following is our proposed design, not a result demonstrated by those papers.** Keep Builder and Verifier. Let Builder request at most two additional, read-only investigations within the existing four-live-worker ceiling. Children cannot spawn in the core. Use the existing bounded-spawning proposal's global budget, lifetime and stop limits; do not introduce a second scheduler. [Proposed product extension](track2-bounded-swarm-product-extension.md)

The model chooses whether a question is worth delegating and which evidence to inspect. Deterministic code admits the request only when scope, prerequisites, duplication, ownership and budget are valid. A task graph records dependencies; it cannot prove the proposed split will save time.

For the inventory-export demo, backend freshness and serialization behavior can be investigated independently. Integration waits for the applicable findings. A protocol child publishes a reproduced quoted/multiline defect with source revision, fixture and tool receipt. Traversal links that finding to serializer work and the sessions that loaded its context; unrelated freshness work need not receive its transcript. Revise the freshness requirement and terminate its child. A successor receives current constraints, applicable prior attempts and observable receipts. A late result bound to the old revision cannot complete the current task.

FalkorDB should make these relations central:

`requirement/evidence revision → conditional decision or finding → dependent task → worker's loaded context → acknowledgement → current verification receipt`

Persist visible messages and tool events continuously. Separate proposed findings from accepted, source-bound knowledge. Keep contradictions and unknown coverage visible; agreement among children is not verification. Large transcripts and artifacts can remain immutable payloads referenced from the graph. Supply compact context packets with mandatory current constraints, then allow optional model-selected retrieval.

For fast sharing, start with indexed identifiers and bounded, batched traversals. Cache only packets keyed by scope and applicable revisions. A cache hit cannot override changed authority. Measure query latency, payload size and update-to-acknowledgement delay; do not promise low latency or complete affected-worker discovery before testing.

The service must enforce global reservations and cancellation, prevent repeated/cyclic subgoals, and reconcile uncertain effects before retry. Individual library limits or graph writes do not provide exactly-once filesystem execution. Keep code execution inside the controlled runtime's explicit workspace/tool boundary.

## First experiments and adoption gate

After the event opens, compare sequential investigation, equivalent flat delegation and bounded parent-initiated delegation with the same facts, tools, model, aggregate budget and interruption schedule. Separately replace graph retrieval with equally informative versioned JSON/files. This tests whether relational applicability adds value beyond good task notes.

Include separable questions, an entirely sequential task, duplicate requests, unsupported findings, changed requirements, a crashed child and exhausted budget. Report acceptance-test completion, stale/unsupported actions, duplicate work, total cost/tokens, latency and recovery effort. Preserve failures and repeated runs.

Keep delegation only if a declared useful outcome improves without weakening correctness under the matched budget. If flat workers perform equally well, use flat execution. If two roles suffice, omit spawning. Call the MVP **bounded delegation with durable graph context**. Reserve the RLM name for an actual implementation of external prompt/intermediate handling and programmatic recursive inference, tested on a suitable task.
