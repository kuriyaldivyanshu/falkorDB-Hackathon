# Threadline: provider and native-client evidence

**MVP authority — 15 October 2026:** [Development blueprint](track2-development-blueprint.md) controls release scope: two contributors, one logical Builder and fresh successor, a protected service checker, eleven tools and no automatic model summaries. This document retains broader target/reference contracts; model Verifier, polling, native adapters and fixed four-day schedules are not MVP commitments.

> **Release decision, 14 October 2026:** the hackathon delivers an owned bounded typed-tool loop with one API provider and Builder/Verifier. Native adapters, direct subscription OAuth and read-only child spawning are post-hackathon candidates. [Harness scope](track2-harness-scope.md) and the [first vertical slice](track2-first-vertical-slice.md) govern; the research below preserves evidence, not extra delivery commitments.

**Evidence checked: 13 October 2026. Status: architecture research, local CLI/schema inspection and proposed integration contracts. No authentication, inference, provider billing, working adapter or recovery benchmark was tested.**

Read this with the final architecture in this directory. This evidence preserves the local npm/TUI decision in [the current package decision](../notes/track2-package-and-requirements-decision.md), [delivery decision](../notes/track2-local-tui-delivery-decision.md), [Codex adapter note](../notes/track2-codex-subscription-local-adapter.md) and [Claude adapter note](../notes/track2-claude-subscription-local-adapter.md). It refines the older [portability proposal](../notes/track2-portability-adapters.md).

## 1. Decisions for the final architecture

The release starts with a compact Threadline-owned coding loop using one explicit OpenAI API profile. For a later native subscription integration, Threadline would control the user's installed official client through a tested adapter; that client would own its inner coding/model loop, native tools and authentication. The coordinator retains assignment, memory, evidence applicability, refresh delivery and recovery. The original native-first recommendation is superseded.

Provider portability has two independent dimensions: **which runtime executes the agent** and **which authenticated service performs inference**. A native Codex adapter using an API key is still the Codex runtime. Replacing Codex with a generic model SDK also replaces its tools, permissions, history and scheduling unless Threadline implements them. A provider selector must not hide this distinction.

The ordinary model/tool action-observation loop supplies the required memory/recovery behavior. CodeAct-style general executable actions are not a prerequisite, and the inspected Codex/Pi implementations should not be reduced to a single paper label. OpenCode and MCP interoperability are later candidates. See [harness scope](track2-harness-scope.md).

All provider features below are documented candidates. The release support matrix must be populated from actual pinned-version acceptance runs, not copied from these research tables.

## 2. What was observed locally

Read-only inspection used the installed executable and generated its public protocol schema into a temporary directory. It did not start a model session, inspect account status, read credential files or alter login state.

| Probe | Observation on this host | What it establishes |
|---|---|---|
| `command -v codex` | `/opt/homebrew/bin/codex` | A local executable is available. |
| `codex --version` | `codex-cli 0.162.1` | The current installed version differs from the earlier note's `0.161.0`. |
| `codex app-server --help` | Experimental command; stdio is default; schema-generation commands available | A documented local process/control entry point exists. |
| `codex app-server generate-json-schema --out /private/tmp/threadline-codex-01621-schema` | Exited successfully | Schemas can be produced without a model turn. |
| Generated request/notification files | Methods listed in section 3 exist in the generated schemas | These method names occur in the installed version's schema; behavior remains untested. |
| `command -v claude` | No executable resolved | Claude cannot be called through this host's current PATH; this is not proof that no installation exists anywhere. |

The Codex commands emitted a warning that PATH aliases could not be created because of filesystem permissions, but the version/help/schema commands completed. No escalation was necessary for these observations. Temporary schema files are evidence of this inspection, not packaged source or a persistent project dependency.

## 3. Codex adapter and subscription route

### 3.1 Authentication boundary

Official OpenAI documentation permits continued app-server authentication for local/open-source integrations, recommends migration to Sign in with ChatGPT, and excludes commercial/hosted reuse of app-server authentication. App-server supports Codex-managed ChatGPT login, API keys and other explicit modes. For a future native compatibility adapter, client-managed authentication over stdio is a candidate; this is not the hackathon's own-loop API route. [App-server authentication](https://learn.chatgpt.com/docs/app-server#auth-endpoints)

Codex caches and reuses its login; managed authentication owns refresh. A separate state directory can change which login/configuration is available, so Threadline must deliberately select the user's intended native profile. It must never read native token caches into its SQL session database or FalkorDB. [Codex authentication](https://learn.chatgpt.com/docs/auth)

OpenAI's current cookbook documents eligible ChatGPT Plus/Pro users authorizing an open-source app to use their plan allowance without an API key. This is a documented route, not proof that the present account, every model or every workspace is eligible. [Open-source app cookbook](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)

An optional future Threadline-owned Sign in with ChatGPT integration is distinct from native login reuse. The local/open-source flow dynamically registers a client using `dynamic_agent_client`, an installation's stable `ext_agent_host_id` and the actual app name. Save the issued account/workspace-bound client ID; the bootstrap ID is not the ID for token exchange. Implement PKCE, state/nonce validation and protected token storage. This flow needs neither a client secret nor a partner API key. [Registration contract](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)

Identity consent and permission to spend ChatGPT plan allowance are distinct. Plan authorization does not expose the user's ChatGPT conversation archive. Paid or remotely hosted applications follow a separate interest/approval route; do not treat this local architecture as permission to operate a public subscription proxy. [Plan-usage scope](https://developers.openai.com/siwc/token-sharing-open-source)

With app-owned plan tokens, the documented app-server configuration supplies a token through the child process environment and a Responses provider. Threadline must refresh it, restart the process and resume the saved thread. `model/list` may return a bundled catalog; a successful inference request, not the catalog, establishes access for that request. [Plan-token app-server configuration](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)

The plan route requires streaming and `store:false`, restricts request fields and hosted tools, and does not provide ordinary server-stored Responses conversation continuity. Codex's local shell, MCP, child agents and local thread history remain separate capabilities. [Preview limits](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)

**Post-hackathon design consequence:** implement one authentication strategy per adapter profile, record the strategy by name, and show the exact billing route. Do not silently fail over between billing routes. App-owned OAuth has its own later acceptance gate; the hackathon exposes only its supported API route.

### 3.2 Installed protocol surface

The following names were found in the locally generated `0.162.1` schemas. This table is an observation of public schema definitions, not a test of server responses.

| Threadline responsibility | Observed protocol method/event | Proposed handling |
|---|---|---|
| Establish a connection | `initialize` / initialized handshake in official protocol | Reject incompatible protocol assumptions before admitting work. |
| Start an empty native conversation | `thread/start` | Associate the returned native ID with one durable agent session. |
| Continue native history | `thread/resume` | Mark recovery as native resume. |
| Read retained native history | `thread/read` | Reconcile captured intervals where the host provides them. |
| Submit work/context | `turn/start` | Record submitted payload digest before submission; associate the returned turn. |
| Request interruption | `turn/interrupt` | Await terminal state and inspect effects before reassigning a writer. |
| Record visible output | `item/agentMessage/delta`, `item/completed` | Stream deltas to the UI; persist completed records and explicit partials. |
| Observe a terminal turn | `turn/completed` | Inspect status; turn completion does not accept the task. |
| Bridge a shell approval | `item/commandExecution/requestApproval` | Present scoped command, worktree and requested action. |
| Bridge a file approval | `item/fileChange/requestApproval` | Preserve native decision choices and scope. |
| Bridge permission expansion | `item/permissions/requestApproval` | Grant only the authorized subset. |
| Track native account/limits | `account/read`, `account/rateLimits/read` | Use minimum necessary metadata; hide credentials and personal account details from project events. |
| Account lifecycle | `account/login/start` | If needed, direct users through the native authorization ceremony. |
| Fair native baseline | `thread/goal/set`, `thread/goal/get` | Include persisted native goals in memory-off comparisons. |
| Optional dynamic tools | `item/tool/call` occurs in server schema | Feature-gate the full dynamic-tools path; a method's presence alone does not enable gated fields. |

Official app-server documentation defines streamed items, approvals, thread creation/resume and experimental dynamic tools. `dynamicTools` requires the experimental capability opt-in; generated bindings should match the pinned release. [Protocol reference](https://learn.chatgpt.com/docs/app-server)

Use a Threadline MCP server as the first memory-tool surface. Codex supports stdio and Streamable HTTP MCP, tool allow/deny lists, timeouts and `required=true`; required servers cause startup to fail when initialization fails. This avoids silently running a supposedly memory-enabled worker without its memory tools. MCP is not a transcript observer or session supervisor by itself. [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp)

### 3.3 Native spawning must not bypass the coordinator

Current Codex docs expose `agents.enabled` and `agents.max_concurrent_threads_per_session`. The latter counts spawned threads, excluding the primary; `agents.max_threads` remains a legacy alias. Native subagents inherit applicable runtime permission policy. These are host settings, not a shared cap across multiple Codex processes, Claude processes and Threadline API requests. [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)

**Post-hackathon adapter candidate:** set `agents.enabled=false` on Threadline-managed Codex workers. Only after the separate delegation gate passes may a coordinator-owned spawn tool admit another tracked session. Confirm the setting actually removes native delegation on the pinned release. If native spawning is enabled, every descendant must reserve capacity before launch and map to a durable assignment; observing it afterward cannot enforce a hard global cap.

## 4. Claude Code adapter and subscription route

### 4.1 Policy distinction

Anthropic's current product conditions allow running/preinstalling the unmodified Claude Code binary, with its authentication preserved and each end user paying/authenticating directly. They expressly preserve an end user's subscription login to that binary. The same page prohibits third-party Claude-login offerings, credential/token collection or intermediation, and routing subscription credentials through another application's inference path. [Claude Code product and authentication conditions](https://code.claude.com/docs/en/legal-and-compliance)

The Agent SDK overview directs third-party products to API authentication unless previously approved to offer claude.ai login/rate limits. A local experiment accepting a token is not authorization for a distributed SDK product. [Agent SDK authentication](https://code.claude.com/docs/en/agent-sdk/overview)

**Post-hackathon adapter candidate:** Threadline launches the user's official, unmodified native executable. Users complete Anthropic's own login; Threadline does not implement a Claude subscription login form, solicit subscription tokens, copy the native credential store or use those credentials for another inference runtime. Label this route **Claude Code native subscription**.

### 4.2 Programmatic operation and capture

`claude -p` supports programmatic operation; JSON streams expose visible messages and tool records. Nested output uses parent tool identifiers; extra subagent text requires forwarding options on compatible releases. `--bare` skips native OAuth/keychain login, so it cannot be the subscription adapter's default. SIGTERM can leave an unfinished turn with no result. [Programmatic operation](https://code.claude.com/docs/en/headless)

The CLI supplies streamed input, replay acknowledgements, session IDs, worktree options, explicit MCP configuration and a permission-prompt MCP tool. `--tools` restricts built-ins; `--allowedTools` automatically approves matching tools rather than being a complete whitelist. `--strict-mcp-config` narrows MCP loading. [CLI reference](https://code.claude.com/docs/en/cli-reference)

Hooks cover session startup, prompts, tools, failures, compaction and worker lifecycle. `SessionStart` can add initial context. PermissionRequest hooks also run where no interactive prompt exists; unresolved calls are denied. PostToolUse observes effects after execution, so it cannot retroactively prevent them. [Hooks reference](https://code.claude.com/docs/en/hooks)

Native subscription authentication can be superseded by provider/environment credentials. In print mode, a present `ANTHROPIC_API_KEY` is used. Native authentication supports subscription accounts, API/Console and selected cloud-provider routes. Doctor must detect the selected billing mode without emitting secret values. [Authentication and precedence](https://code.claude.com/docs/en/authentication)

**Proposed capture design:** persist submitted user/context payloads before launch; consume the stream continuously; associate parent/native/session/tool IDs; filter thinking blocks; preserve immutable visible tool output; mark missing final results and unknown effects. Version-probe all configured flags rather than assuming live documentation describes every installed binary. For restore, start without resume/continue/fork and supply the current graph packet. Native worktree features do not perform Threadline's guarded patch integration.

### 4.3 Current native recursion differs from old assumptions

Current Claude documentation allows subagents to spawn children by default, up to three layers below the main conversation. `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1` disables nesting. Removing or disallowing `Agent` prevents a selected worker from spawning. Non-interactive nested-background completion routing differs from interactive behavior. [Current nested-subagent contract](https://code.claude.com/docs/en/sub-agents#let-subagents-spawn-their-own-subagents)

**Proposed default:** exclude `Agent` from managed worker tool availability, deny equivalent untracked delegation routes, and use coordinator-owned child sessions. Depth configuration is additional defense, not the shared scheduler. A child must not evade the scheduler by launching another coding client through shell; process/tool policy and allowed command scope must enforce the intended boundary. If this cannot be enforced on a target client, expose a best-effort cap and do not advertise a hard four-worker guarantee.

## 5. Provider portability and fallback routes

### 5.1 Recommended route matrix

The priority column is a proposal. Every row remains untested end to end in Threadline.

| Runtime route | Authentication owner | Inference route | Priority | What Threadline must separately prove |
|---|---|---|---|---|
| Threadline-owned coding loop | Threadline provider driver | User's explicit API credentials | First baseline | Real model/tool round trip, durable barriers, permissions and fresh restore |
| Codex app-server with native login | Codex | Eligible ChatGPT allowance | Post-hackathon compatibility candidate | Capture, approval bridge, interruption, fresh restore and allowance errors |
| Claude Code native CLI | Official Claude Code | User's eligible Claude subscription | Post-hackathon compatibility candidate | Native binary boundary, headless stream/hooks, permission host and clean restore |
| Codex app-server with API/provider profile | Codex/provider configuration | API or supported configured provider | Future route on the same adapter | Protocol/model/tool compatibility and explicit billing selection |
| Claude Code with API/cloud profile | Claude Code/provider configuration | Anthropic API or supported cloud service | Future route on the same adapter | Provider-specific auth and feature restrictions |
| OpenCode with API provider | OpenCode | Configured API or local model | Later native adapter | Full lifecycle capture/recovery in addition to MCP calls |
| Generic host with Threadline MCP | Host | Whatever its own authorized runtime supports | Post-hackathon portable tool candidate | Only scoped tool interoperability until lifecycle probes pass |
| App-owned Sign in with ChatGPT | Future Threadline OAuth module | Authorized ChatGPT plan route | Post-hackathon local/OSS subscription candidate | Full identity/token lifecycle and route-specific inference restrictions; see [OAuth design](track2-authentication-and-oauth.md) |

Codex documents custom provider endpoints, authentication helpers, local Ollama/LM Studio mode and cloud-provider configuration. Configurable transport does not establish tool-call fidelity for every model. [Codex provider configuration](https://learn.chatgpt.com/docs/config-file/config-advanced)

OpenCode documents multiple providers and local endpoints. Its custom-provider configuration distinguishes Chat Completions (`@ai-sdk/openai-compatible`) from Responses (`@ai-sdk/openai`). Its current Anthropic section also explicitly says subscription plugins are prohibited; an older instruction on the same page still mentions Pro/Max login. Follow Anthropic's own policy for authorization, and use API credentials for the proposed OpenCode route. [OpenCode providers](https://opencode.ai/docs/providers/)

### 5.2 API adapter families

The backend has a small explicit provider contract; the hackathon implements only the selected OpenAI route. Other families below are researched candidates, not promised drivers or a universal OpenAI-compatible guarantee:

| Adapter family | Primary evidence | Proposed interoperability gate |
|---|---|---|
| OpenAI Responses | Native API/provider route documented above | Stream parsing, custom tools, state ownership and supported request fields |
| Anthropic Messages | SDK overview directs products to the API route | Tool-use/result round trip, stop reasons, usage and cancellation |
| Gemini native or compatible Chat Completions | Google's compatibility guide documents API-key configuration, streaming and function calling | Model-specific tool schema support and preservation of required protocol metadata |
| OpenRouter Chat Completions | Router documents a unified request shape and provider-dependent tool translation | Restrict routing to tested models/providers and record actual route |
| Ollama/local model | Ollama documents partial OpenAI compatibility | Explicit model capability probes, no inferred cloud entitlement or quality equivalence |

Google's supported compatibility endpoint is documented in its [Gemini OpenAI compatibility guide](https://ai.google.dev/gemini-api/docs/openai). OpenRouter's tool handling varies with the underlying provider; use its [API contract](https://openrouter.ai/docs/api_reference/overview) and test the selected route. Ollama documents non-stateful Responses support and explicitly excludes `previous_response_id`/`conversation` state; the application must carry the required history. [Ollama compatibility limits](https://docs.ollama.com/api/openai-compatibility)

An endpoint answering a text prompt proves only basic reachability. Tool support, output structure, context capacity, cancellation, streaming terminal status and usage accounting each require an independent capability probe. A small local model may be suitable for extraction or search assistance while failing coding acceptance tasks; role assignment must use measured capability.

### 5.3 Proposed registry and connection data

The following is a candidate registry shape spanning researched routes, not a vendor schema or a list of enabled release modes. The release registers only `threadline` with its one tested API profile; extension capabilities do not become supported because their strings occur in this reference:

```typescript
type RuntimeKind = "threadline" | "codex-native" | "claude-native" | "opencode-native";
type AuthKind = "native-subscription" | "api-key" | "cloud-identity"
  | "local-no-auth" | "app-owned-chatgpt-plan";

interface CapabilityEvidence {
  capability: string;
  status: "documented" | "passed" | "failed" | "unsupported";
  runtimeVersion: string;
  modelId: string | null;
  fixtureVersion: string | null;
  checkedAt: string;
  receiptId: string | null;
}

interface RuntimeProfile {
  id: string;
  ownerUserId: string;
  runtime: RuntimeKind;
  authKind: AuthKind;
  providerId: string;
  modelId: string;
  wireProtocol: "native-rpc" | "native-jsonl" | "responses"
    | "chat-completions" | "anthropic-messages" | "gemini";
  credentialRef: string | null; // Secret-store reference; never a token.
  endpointRef: string | null;   // Validated configured endpoint.
  capabilities: CapabilityEvidence[];
}
```

Do not store provider secrets in `user_sessions`, conversation messages, graph nodes, artifacts or diagnostic exports. A user-session authenticates a Threadline principal; it is not a provider subscription credential. Native thread IDs and Claude session IDs identify conversations; they are not authorization proofs. Cross-provider continuation uses the authorized Threadline packet and shared artifact references, never a native session ID from another runtime.

When a chosen provider is unavailable, return a structured state such as `auth_required`, `quota_exhausted`, `model_unavailable`, `capability_missing` or `transport_failed`. Show the queue and available explicitly configured alternatives. Changing provider/model starts an auditable new attempt with the same current requirement revision and revised cost/capability assumptions.

## 6. Native resume, compaction and fresh recovery

These are separate claims for their respective routes. Only owned-runtime fresh recovery is in the hackathon; native/cross-provider behavior is post-hackathon:

| Operation | Context origin | Threadline proof |
|---|---|---|
| Native resume | Client's retained history | Same native session can continue with verified current context refresh. |
| Native fork | Copied native history under a new ID | Branch identity is recorded; no fresh-context claim. |
| Compaction recovery | Native compressed history plus current graph additions | Record the visible boundary and exact packet inserted. |
| Fresh successor | New empty owned-runtime conversation plus authorized graph packet and workspace evidence; native route later | No resume/fork history supplied; current packet digest acknowledged before guarded work. |
| Cross-provider successor | Portable packet, sources, tasks and artifacts | Native IDs are replaced; role capabilities and current checks are revalidated. |

Fresh recovery must reconcile actual files and uncertain tool outcomes before repeating a command. An acknowledgement means the adapter inserted the packet; it does not prove the model understood or obeyed it. Completion needs independent current-artifact checks. Captured conversation history is observable input/output with explicit gaps, never an inferred record of private reasoning.

## 7. Acceptance matrix before support is advertised

This matrix covers all researched capabilities, not the hackathon checklist. Native/subagent gates are post-hackathon. The [first vertical slice](track2-first-vertical-slice.md) selects the core release gates.

| Gate | Observable evidence required |
|---|---|
| Native authentication | Real authorized turn under the selected billing route; no credential copied to Threadline storage |
| Pinning | Exact client version, protocol schema hash and adapter version recorded |
| Tool capture | Submitted call, result/error, native IDs and relevant artifact digest captured |
| Approvals | One accepted and one denied request; denial prevents the relevant effect |
| Mandatory MCP | Memory startup failure visibly blocks a worker requiring memory |
| Stream interruption | Partial event preserved; no invented final result; actual effects reconciled |
| Native resume | Same native conversation resumes with correctly labelled history |
| Fresh restore | New native conversation uses only the declared graph packet and permitted workspace |
| Requirement change | Late old-revision finding/receipt cannot complete current work |
| Subagent admission | Hidden native delegation disabled or included in shared reservations before launch |
| Global limit | Mixed native/API workload respects declared live-worker and call ceilings |
| Provider compatibility | Text, structured tool round trip, stream terminal state, error normalization and supported usage fields |
| Quota exhaustion | Queue pauses; billing route remains explicit; no silent paid fallback |
| Tenant separation | Colliding synthetic IDs cannot retrieve another principal's packet, transcript or source |
| Evaluation value | Matched-budget sequential and bounded delegation compared on actual acceptance results |

Use the same model/tool/context/spend conditions in native-memory-off, equally informative versioned-file and graph-context runs. Include native persistent goals/history in the baseline. Report task correctness, stale actions, duplicate work, recovery effort, total usage, latency and failures separately. Library features and screenshots are insufficient evidence for these gates.

## 8. Reconciliation of earlier notes

| Earlier assumption or ambiguous phrasing | Final treatment |
|---|---|
| API billing is always required for a local Codex-backed product | Superseded by documented native and local/open-source plan routes; eligibility still needs a real turn. |
| Any Claude subscription credential works in any SDK wrapper | Rejected; native binary use and third-party SDK authentication have distinct conditions. |
| No Claude subagent can spawn a child | Outdated for current docs; Threadline deliberately disables or accounts for nesting. |
| A per-runtime thread setting enforces the product's global worker limit | Rejected; reservations must cover every process/provider/subtree. |
| A new native session ID proves fresh context | Rejected; fork/resume can retain history. |
| MCP gives universal capture and automatic restoration | Rejected; it provides tools; lifecycle control needs a tested adapter. |
| Codex is purely CodeAct, so Threadline needs a code kernel | Not established by inspected source; executable tool/code-mode support is not a whole-product paper classification. |
| Universal OAuth unlocks all model providers | Rejected; each native, API, cloud or app-owned route has its own authorization and billing contract. |
| Codex `0.161.0` is the current observed version | Historical observation; this inspection found `0.162.1`. |
| Both native clients are already integrated | Rejected; only local Codex help/schema was inspected; neither adapter has executed. |

These findings update architecture guidance, not provider accounts or installed software. All performance, setup-time and quality statements remain targets until measured.
