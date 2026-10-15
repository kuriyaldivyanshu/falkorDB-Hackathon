# Track 2: user experience and delivery brief

**Written proposal, 2026-10-13. Nothing described here has been implemented or tested.** This brief narrows the [product decision](track2-package-and-requirements-decision.md), [scope](track2-investigation-and-product-scope.md) and [coverage review](track2-packaging-decision-review.md). It is preparation, not a pre-event UI mockup or product implementation.

## Product and delivery choice

**Build a small working coding-agent team with a local browser workspace, launched by a thin CLI.** Reuse an existing agent SDK/framework for the execution loop. The reusable FalkorDB memory service is the core; a complete, narrowly scoped agent workflow is what the user runs and the judges see.

The first user is a developer completing one feature through interruptions and requirement changes. The promise is: **continue recorded work with its current constraints and relevant evidence, without writing a manual recap.** This is not a replacement IDE or a general coding assistant. Editing remains in the developer's existing editor; our workspace explains progress, memory and continuation.

Choose the **browser UI over a TUI** because comparing a changed requirement, affected tasks and evidence benefits from persistent side-by-side views. It also makes the handoff visible in a short demonstration. The CLI handles launch, readiness checks, status and logs; do not build a second interactive TUI.

The CLI launches the local service and opens the browser. Setup documents the selected runtime, FalkorDB persistence and provider credentials; it must not imply these dependencies disappear behind one command. The event submission uses a reproducible local setup and demo video. A hosted informational/demo page is optional, not a second deployment project. The overview prefers live deployment but accepts complete local setup when deployment is unavailable. No particular UI format is prescribed. [Overview](https://www.wemakedevs.org/hackathons/falkordb), [submission rules](https://www.wemakedevs.org/hackathons/falkordb/rules)

## One complete user journey

1. **Open a project.** Select the authored inventory-export repository or another permitted public/toy workspace within demonstrated support. Setup checks the backend, writable workspace and provider connection. It states which runner/adapters were actually tested. Do not promise arbitrary repositories or universal harness compatibility.
2. **State the goal.** Enter the feature and observable acceptance criteria. The example asks for an inventory CSV export with precise quoting and freshness requirements. The agent proposes a short task split; the user resolves any consequential ambiguity. The accepted goal and criteria remain visible while work runs.
3. **Start the team.** A Builder implements the feature; a Verifier independently checks current criteria and returns actual test receipts. Both receive graph-selected context and use isolated worker copies. The service coordinates ownership and accepted integration. A third autonomous coordinator is unnecessary for the core.
4. **Inspect progress.** See each task, its worker, current requirement revision and evidence status. Open a recorded failed approach to inspect its scoped reason and source. A passing test is labelled with the revision it tested, not presented as permanent success.
5. **Change a requirement.** Edit one criterion and apply it. Show which tasks, receipts and loaded worker contexts are affected by recorded dependencies. Refresh affected workers at supported boundaries. Unrelated work stays current; missing dependency coverage is displayed as uncertainty.
6. **Continue with a fresh agent.** Select the interrupted task and choose “Continue fresh.” The controller commits an available checkpoint, starts a genuinely new session, retrieves current scoped memory, checks the workspace and continues. No pasted recap. Native Codex/Claude takeover appears only if its integration gate passes; the controlled reference runner remains the first working path.
7. **Finish with evidence.** Present the resulting patch and current verification receipts against each criterion. The user reviews the patch. Completion requires the current tests/receipts, not an agent's confidence. Demonstrate a stored CSV verification procedure reused on a held-out compatible task, with new evidence and an applicability check.

The memorable event is requirement change plus interruption: the successor recalls the reason a shortcut failed, reassesses its applicability and verifies the revised feature. Graph visualization supports this explanation; it is not the product outcome.

## Minimal interface and controls

Build one workspace screen with three regions:

- **Goal and tasks:** current criteria, Builder/Verifier status and task ownership; a small requirement editor.
- **Activity and history:** ordered captured user/assistant messages, meaningful tool events, checkpoints and handoffs. Older sessions remain inspectable after restart. Summaries supplement persisted messages.
- **Evidence inspector:** selected decision, source message, artifact version, procedure or test receipt. “Why this context?” shows the relevant relationship path and inclusion reason. A compact graph view can live here; do not build a graph editor.

A setup drawer provides readiness and diagnostics. An evidence drawer shows a diff or log excerpt and its source. These are panels within the workspace, not extra dashboard products.

User controls are: start; pause at a supported boundary; change a requirement; answer an unresolved question; continue fresh; inspect a patch/receipt; and review the final result. Optional adapter selection is a setup control, not a universal-provider marketplace. Ordinary changes already authorized by the selected task proceed within its execution permissions; a new provider session does not inherit permissions automatically.

## What runs automatically and which tools it uses

The runner automatically captures its declared message/tool surface, writes checkpoints at meaningful boundaries, retrieves relevant context before continuation, checks revisions, routes affected-worker refresh and records verification outcomes. The graph determines applicable decisions, required evidence and which workers need fresh context.

Builder tools are scoped file reading/search, editing and the permitted project commands. Verifier tools inspect artifacts and run acceptance checks in its isolated copy. Both use narrow memory operations: retrieve context, record an observation or decision proposal, checkpoint, claim/handoff and publish an evidenced result. Agents receive no unrestricted graph-administration tool. Concrete API/database constraints remain in the [architecture](track2-continuity-architecture.md).

Do not make a fixed context-fill percentage an automatic quality detector. For the first release, an explicit continuation action or demonstrated lifecycle boundary initiates recovery. The controller automates the subsequent capture/start/restore sequence. Native adapter support is tested separately from the reference runner.

## Honest user-facing failure states

| Label | Meaning and next behavior |
|---|---|
| **Checkpoint incomplete** | Critical work was not captured. Show the last checkpoint and missing observations; request the minimum clarification rather than invent a recap. |
| **Workspace changed** | Referenced artifacts differ. Reconcile them and obtain fresh evidence before accepting completion. |
| **Verification outdated** | A receipt predates relevant changes. Queue the affected check; do not declare the code broken merely because it changed. |
| **Action outcome unknown** | Interruption left a tool outcome uncertain. Inspect observable effects before retrying; do not claim exactly-once execution. |
| **Needs clarification** | Competing or ambiguous instructions cannot establish current authority. Surface the specific question. |
| **Memory unavailable / required context too large** | Recovery cannot supply trustworthy mandatory context. Pause that task and expose the cause; do not silently continue with a partial goal. |

Show “Memory started here” and capture gaps in history. The system cannot reconstruct an unrecorded reason, hidden model reasoning or deleted artifact from a hash. Only permitted event-created public/authored/synthetic history enters the submission graph. Tenant isolation comes from service identity; users and agents cannot authorize another graph by naming it.

## Four-person event scope

| Owner | Core responsibility |
|---|---|
| A | FalkorDB memory, revisions, persisted messages, bounded retrieval and procedure applicability |
| B | Controlled runner and Builder execution; fresh-session checkpoint/restore; Codex adapter only after the core path works |
| C | Verifier execution, evidence checks and isolation; Claude adapter under the same integration gate |
| D | Browser workspace, thin launch/diagnostics CLI, authored evaluation fixtures, load probe and submission evidence |

**Day 1:** one real agent records work and a fresh session continues through FalkorDB. **Day 2:** Builder/Verifier workflow and changed-requirement recovery work; adapter claims depend on actual tests. **Day 3:** held-out procedure reuse, history restart, stale-result/tenant tests and concurrent API workload. **Day 4:** fix failures, test clean local setup, freeze features and record the working demonstration.

Before the event, keep written planning and graph sketches. Main coding/design belongs in the permitted window; leaving implementation uncommitted does not change when it was created. [Timing rules](https://www.wemakedevs.org/hackathons/falkordb/rules)
