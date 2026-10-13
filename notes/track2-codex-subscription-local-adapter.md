# Codex subscription access for Threadline's local TUI

**Checked 13 October 2026. Documentation findings; no login, credential inspection, model request, installation or adapter implementation.** Read-only local checks found `codex-cli 0.161.0`; its app-server help supports stdio and labels the command experimental. This does not verify individual RPC contracts or account access.

## Conclusion

**A local open-source TUI using a user's ChatGPT plan has current official support.** OpenAI's **28 September 2026** cookbook explicitly describes eligible Plus/Pro users powering an open-source app without configuring an API key. Eligibility and allowance remain account-dependent. This changes the earlier assumption that API billing is necessarily required for our local product. [Official cookbook](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)

For the four-day MVP, first probe a thin client around the installed Codex app-server and Codex-managed authentication. Keep the newer app-owned Sign in with ChatGPT integration as an optional supported route. Do not make both authentication implementations mandatory for delivery.

## Native login versus our own OAuth client

Codex's native ChatGPT login is subscription-backed; its cached local login is reused and refreshed automatically. Let Codex access its own credential store rather than parsing or copying tokens into Threadline. Changing its state directory may separate it from the existing login, so test configuration deliberately. Workspace/admin constraints still apply. [Authentication and caching](https://learn.chatgpt.com/docs/auth)

App-server documentation permits continued local/OSS authentication, excludes commercial/hosted reuse, and recommends migration to Sign in with ChatGPT. [Current boundary](https://learn.chatgpt.com/docs/app-server#auth-endpoints)

The new **direct OSS/local OAuth flow** does not require a manually issued partner client ID first: begin with `client_id=dynamic_agent_client`, a stable `ext_agent_host_id` and consistent `agent_name_hint`. The user authorizes it; save the issued client ID for exchange and subsequent sign-ins. Neither a client secret nor a partner API key is required. Implement PKCE, state/nonce validation, a loopback callback on `127.0.0.1`, ID-token verification, granted-scope checks and protected account-specific credential records. Identity consent alone does not authorize plan usage. [Exact registration flow](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)

Each registration is bound to a user/workspace; host identity persists across restarts. The OSS/local documentation directs paid or remotely hosted applications to an interest form. The general client-ID page describes select commercial partners, so it should not be used to infer that this OSS dynamic flow needs the same waitlist. [OSS scope](https://developers.openai.com/siwc/token-sharing-open-source), [commercial route](https://developers.openai.com/siwc/request-client-id)

With app-owned SIWC tokens, the documented app-server configuration supplies the access token to a child process's environment and uses the Responses provider. Our app owns refresh; token replacement requires restarting that configured process and resuming its saved thread. A model catalog is not an entitlement check. [Official app-server configuration](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)

## Documented adapter seams

| Need | App-server surface |
|---|---|
| Connect | stdio; `initialize`, then `initialized` |
| Native sign-in | `account/login/start` (`chatgpt` / `chatgptDeviceCode`); `account/login/completed` |
| Fresh/resume | `thread/start`, `turn/start`; `thread/resume` retains history |
| Existing baseline | Persisted `thread/goal/*`; `thread/read` with `includeTurns` |
| Observe | `item/started`, `item/completed`, deltas, `turn/completed` |
| User approval | `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval` |
| Memory tools | Experimental `dynamicTools` / `item/tool/call`; opt into `capabilities.experimentalApi` |
| Stop/allowance | `turn/interrupt`; `account/rateLimits/read`, `account/rateLimits/updated` |

[Protocol reference](https://learn.chatgpt.com/docs/app-server). These documented capabilities have not been tested against the installed version.

Local MCP is an alternative to experimental dynamic tools: stdio and Streamable HTTP are supported, with tool filtering and `required=true` for startup failure when an enabled memory server cannot initialize. A memory tool interface alone does not implement automatic history capture or fresh-worker reinjection. [MCP configuration](https://learn.chatgpt.com/docs/extend/mcp)

SIWC preview supports Codex's local shell, MCP and child-agent execution, and local history despite `store:false`. This is separate from hosted Responses tools: hosted MCP and Responses `tool_search` are unsupported. The route requires streamed, non-stored requests and has other parameter restrictions. Test the chosen tool configuration rather than assuming normal API compatibility. [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)

## Event-time acceptance gate — proposal

Prove one local logged-in user can start a real coding turn, receive and refuse a scoped approval, invoke a typed graph-memory tool, and finish an independently checked task. Then interrupt, restart and compare native continuation with a genuinely fresh worker using only the graph packet and observable repository evidence.

Record submitted messages and completed visible/tool events continuously with thread/turn/item identifiers. Keep partial capture and interrupted effects uncertain; do not equate deltas, a completed turn or stored native history with successful current-task verification. Restrict graph publication and completion through our own scope/revision/evidence checks.

Native goal persistence and history must be fairly included in the baseline. Our proposed difference is conditional decision applicability, changed-evidence invalidation and selective team context—not merely remembering a goal.

Unknowns: installed-schema drift, managed-login behavior in a new custom client, actual account/model eligibility, concurrent-worker allowance consumption, cancellation completeness, capture gaps and SIWC refresh integration. No account status or rate-limit data was queried here.

## Timing and quality gates — planning estimates

Assume an experienced engineer with AI assistance, an installed eligible logged-in client, and available allowance. These are estimates, not measured timings:

- End-user setup once packaged: **5–15 minutes**; excludes installation/login/database troubleshooting.
- First programmatic coding turn: **1–3 engineer-hours**.
- One dependable narrow adapter, capture, approvals and fresh recovery: **1–2 working days**.
- Both clients plus graph integration/evaluation: **3–5 elapsed days** for this four-person team with two DevOps members; four days requires restricted scope and parallel work.

Choose Codex first. Timebox initial compatibility to three hours; if blocked, probe native Claude hooks/MCP or cut custom TUI scope. Avoid making a new OAuth implementation the rescue dependency.

Check three layers separately. **Model:** match native model/effort, tools, permissions and budget. **Adapter:** memory-off parity; complete captured events; decline approval; interrupt/restart; visibly report capture gaps. **Memory:** held-out changed-requirement, stale-worker, fresh-session and scope-isolation cases, verified through independent executable assertions. Compare native goals/history, equally informed versioned files, and graph recovery with matched budgets; repeat runs and report failures. A completed turn or LLM verifier is insufficient proof.
