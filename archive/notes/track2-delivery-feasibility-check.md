# Track 2 delivery feasibility check

**13 October 2026. Research/proposal only; no app, runtime, hook or benchmark was implemented or tested.** This narrows the initial delivery recommendation: agents first run through a controlled runtime behind our app; existing-host adapters are secondary. The earlier portability reports identify possible seams, not required launch integrations.

## Recommendation and submission fit

Deliver a focused **local browser agent app launched by a Node CLI**. Keep the CLI for setup/start/status, with the browser showing the work, current task contract, evidence and recovery outcome. Do not build an entire terminal coding harness or make judges configure several external plugins before seeing the product work.

The official rules do **not specify a graphical UI or TUI**. They require public code, setup/model documentation, indispensable queries/algorithms, a working demo video and either deployment or complete local setup. FalkorDB must perform a central function; infrastructure/templates may be reused. Main coding/design begins after 15 October, 12:01 AM IST. [Official rules](https://www.wemakedevs.org/hackathons/falkordb/rules). The FAQ prefers live deployment but explicitly permits the local route when deployment is unavailable. [Official FAQ](https://www.wemakedevs.org/hackathons/falkordb).

A browser makes source evidence, changing requirements and selective worker context easier to inspect. This is a delivery judgment, not a judging guarantee. A reliable local demonstration is stronger evidence than an inaccessible hosted shell. Hosting remains useful if tested without expanding the four-day scope.

## Minimal delivery boundary

**Proposed stack:** TypeScript Node backend/launcher, a small React browser interface, streaming application events, one existing agent SDK/runtime, isolated worker directories, and pinned FalkorDB. Keep database credentials and model credentials in the backend. The graph core owns task applicability, revisions, retrieval and accepted receipts; the runtime owns model interaction and its agent loop. An optional MCP façade exposes that same core to other coding hosts later.

A documented candidate is the TypeScript Claude Agent SDK: `query()` runs its existing loop; `tool()` and `createSdkMcpServer()` supply application tools. This avoids implementing a coding agent loop from scratch. [Custom tool API](https://code.claude.com/docs/en/agent-sdk/custom-tools), [Agent loop](https://code.claude.com/docs/en/agent-sdk/agent-loop). The final runtime choice should follow credentials and the first live probe, not require two SDKs at launch.

Its hooks document pre/post-tool capture, tool failures, worker boundaries and compaction events. **`allowedTools` is not a strict whitelist**, and `canUseTool` misses calls approved earlier. Every-call policy belongs in `PreToolUse`; remove undesired native tools explicitly and test bypass attempts. SDK hooks alone are not an operating-system sandbox. [Hooks](https://code.claude.com/docs/en/agent-sdk/hooks), [Permissions](https://code.claude.com/docs/en/agent-sdk/permissions).

Resume/fork retain prior history; a fresh worker must instead start without continuation options and consume the graph packet. A history fork does not isolate filesystem changes. [Sessions](https://code.claude.com/docs/en/agent-sdk/sessions).

## Continuous capture, with agent choice

Record throughout execution: submitted user messages, completed visible assistant messages, tool requests/results/failures, artifact versions and worker assignments. Link typed memory to these ordered sources. Persist a proposed decision and its explicit rationale when established, not only in a final handoff summary. A final summary can supplement the ledger; it cannot recover an uncaptured requirement. Do not claim to retain hidden reasoning.

Capture has two layers: an automatic observable-event recorder and model-selected tools for decision/attempt/procedure proposals. The recorder must operate even when the model omits a memory-tool call. Extraction should preserve uncertainty and authority: an assistant's interpretation cannot silently become a revised human goal. Missing intervals and interrupted effects remain unknown until reconciled.

The model should choose what evidence to inspect, which applicable lesson to retrieve, which patch/test to try and when to delegate. Deterministic checks enforce tenant scope, current revision, tool bounds and completion evidence. That leaves genuine agent judgment without scripting the whole successful workflow. Inject mandatory current constraints at task start; optional retrieval remains model-driven. Test whether the graph actually changes its next action.

## Decisive first tests after the event opens

1. **Runtime/control:** one real agent calls a custom tool; capture its request, result and IDs. Attempt an undesired native write and verify refusal. Pin actual SDK/runtime versions and credentials.
2. **Mid-run durability:** interrupt before a final summary. Recover captured history/receipts after backend/database restart, without inventing missing events. Database persistence and file effects need separate verification.
3. **Fresh recovery:** start a genuinely new session using only task ID, current graph packet and workspace evidence. Show it handles a conditional rejection and completes an independent acceptance test.
4. **Changed evidence:** revise one requirement while a worker runs. Reject its outdated completion; refresh affected context while preserving unrelated work.
5. **Delivery/isolation:** run setup from a clean environment; test second-user retrieval and two-worker conflicts. Compare with equally informative versioned files, and disclose unsupported capture boundaries.

Unknowns remain: exact installed SDK contracts, message completeness during cancellation, child-hook coverage, asynchronous capture loss, provisioning/credential friction and measured graph benefit. Build the working runtime-to-graph-to-action loop first. Browser polish, universal adapters and automatic context-quality detection should follow that proof.
