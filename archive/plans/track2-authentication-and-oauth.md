# Threadline subscription access, API billing and OAuth design

**MVP authority — 15 October 2026:** [Development blueprint](track2-development-blueprint.md) controls release scope: two contributors, one logical Builder and fresh successor, a protected service checker, eleven tools and no automatic model summaries. This document retains broader target/reference contracts; model Verifier, polling, native adapters and fixed four-day schedules are not MVP commitments.

**Checked 14 October 2026 against official documentation. Proposed integration only: no user login, token exchange, inference or billing test was performed.**

## 1. The delivery decision

Build the owned TypeScript model/tool loop with one explicit bring-your-own-API-key route first. The end user supplies their own supported credential; Threadline does not need to pay every user's inference bill. This provides a predictable implementation baseline while subscription routes are tested.

For the intended local/open-source distribution, add direct Sign in with ChatGPT as the preferred subscription experience for the owned loop after its gate passes. Retain native Codex and Claude Code as separate runtime options. Anthropic API credentials power Claude models in our own loop; native Claude subscription use stays inside official Claude Code.

This is a staged recommendation. An open-source/local release assumption must be reflected in the actual distribution. A paid/hosted service requires a fresh provider approval assessment; eligibility for one route does not transfer to another.

## 2. Route matrix

| User choice | Execution loop | Billing/allowance | Who implements login? | Proposed effort |
|---|---|---|---|---|
| Own OpenAI/Anthropic API key | Threadline | User's API account | Protected credential configuration | Smallest auth scope; full harness still needs implementation |
| Continue with ChatGPT | Threadline | Eligible authorized ChatGPT plan | Threadline's documented SIWC client | Moderate: registration, PKCE, validation, refresh and route-specific inference |
| Existing Codex installation | Codex app-server | Native selected account route | Official Codex | Small auth scope; medium lifecycle/capture integration |
| Existing Claude Code installation | Official Claude Code | Native selected account route | Official Claude Code | Small auth scope; medium stream/permissions/recovery integration |
| Local model | Threadline | Local compute | Endpoint configuration | Capability and tool-behavior testing still needed |

Effort is an engineering estimate, not elapsed-time evidence. Existing login makes onboarding easier; it does not implement transcript capture, approvals, cancellation, fresh recovery or accounting for us.

OpenAI currently documents plan usage for eligible Plus/Pro users in open-source/local projects, with a separate path for commercial/hosted offerings. Identity consent and inference consent are separate. [Official quickstart](https://developers.openai.com/siwc/quickstart), [OSS/local availability](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)

For native Codex, the official app-server supports managed authentication and recommends SIWC migration for local/open-source integrations. Its authentication is not a commercial/hosted subscription proxy. [App-server authentication](https://learn.chatgpt.com/docs/app-server#auth-endpoints)

Anthropic permits qualifying products to run its unmodified binary under its stated terms with direct end-user authentication and billing. It prohibits collecting/intermediating Claude subscription tokens for third-party inference. Third-party Agent SDK products use API authentication unless separately approved. [Claude Code conditions](https://code.claude.com/docs/en/legal-and-compliance), [Agent SDK authentication](https://code.claude.com/docs/en/agent-sdk/overview)

## 3. Certificate, registration and approval are different

- **Direct local ChatGPT plan route:** the documented dynamic-registration flow requires neither a client secret nor a partner API key. It uses an HTTP callback bound to `127.0.0.1`, so this callback does not require a public HTTPS certificate. Provider requests still use HTTPS. The documented requirements do not include an application signing certificate. [Registration contract](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- **Native clients:** Threadline uses their supported control interfaces; the official client conducts its own sign-in. We do not register a replacement Claude subscription OAuth client.
- **Commercial/hosted ChatGPT integration:** this is a separate partner/interest route. A certificate or technically successful OAuth exchange does not establish program eligibility. [Availability and distribution scope](https://developers.openai.com/siwc/token-sharing-open-source)
- **OS app signing:** distribution trust for a desktop executable is a separate packaging concern. It does not grant model access or subscription usage.

Thus there is no universal certificate that makes any application eligible for both providers' subscriptions.

## 4. Three credentials to keep separate

| Credential | Purpose | Proposed location |
|---|---|---|
| Threadline application session | Authenticate TUI/CLI to our backend | Opaque bearer token on client; only hash in SQL `user_sessions` |
| Model-provider credential | Authorize inference and select billing | Official client for native mode; OS secret store for app-owned API/SIWC mode |
| MCP/tool credential | Access a particular tool server | Scoped connector secret/capability, separate from model credentials |

An MCP login does not unlock ChatGPT or Claude model usage. A provider ID token identifies an account; its presence alone does not grant plan inference. Connecting a provider account must require an existing authenticated Threadline user and explicit account-linking action. Do not merge local users solely by matching email.

## 5. ChatGPT OAuth setup

Implement a local public-client module using Authorization Code + PKCE and OIDC. Use a maintained OAuth/JWT library; do not invent cryptographic validation. Our proposed registration sequence is:

1. Persist one installation host identifier; a supported UUID URI is sufficient for the first implementation.
2. Bind the loopback callback listener, create fresh state/nonce/PKCE, and open the system browser.
3. First registration uses `dynamic_agent_client`, the host ID and our consistent application name. Save the returned **issued** client ID for that account registration.
4. Validate the callback, then exchange its one-use code with the issued client ID, PKCE verifier and identical callback URI.
5. Verify the ID token and granted plan-use permission before activating the profile.

Returning sign-in uses the saved client registration. These are design steps for the official flow, not credentials to copy from Codex. [Registration details](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [reference app walkthrough](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)

The provider's canonical endpoints, parameter names, exact scope set and validation rules remain in those references; implementation must pin and test the current contract. `dynamic_agent_client` is a registration entry point, not our saved client ID. The installation host ID, Threadline user ID and provider client ID are different identifiers.

## 6. Inference, refresh and logout

The SIWC driver sends the access token to the documented Responses endpoint and processes a successful terminal response. Model discovery alone is insufficient proof of access. [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)

This route needs its own request profile: streamed requests, `store:false`, caller-supplied history and supported tool framing. Several normal API fields and hosted tools are unavailable. In particular, do not assume `max_output_tokens`, `previous_response_id`, hosted Code Interpreter or Responses `tool_search` work. Threadline's local tool executor is separate from those hosted tools. [Preview restrictions](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)

Refresh uses the registration's issued client ID and latest refresh token. Serialize renewal per registration and atomically save replacements in protected storage. Logout stops work, attempts remote revocation and clears local credentials; report when remote revocation cannot be confirmed. Account changes must not combine one registration's ID with another's tokens. [Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)

Our hard controls remain admitted turns, deadlines, tools, child slots and request counts. Cancellation after an output threshold is a best-effort usage limit; it does not prove an exact server-side token/spend ceiling. For subscription usage, report observed allowance/usage or “unknown”; do not invent an API-dollar price. Never automatically fall back from a depleted subscription to API billing.

## 7. Threadline implementation modules and data

| Module | Interface/responsibility |
|---|---|
| Provider setup controller | List routes, launch an authorized connection attempt, return safe status |
| OAuth module | Begin/cancel/complete an attempt; validate identity and inference permission |
| Secret store | Atomically read/replace/revoke one registration's credential bundle |
| Provider broker | Resolve active profile, renew credentials, enforce exact route capabilities |
| Native adapters | Probe official client authentication and let that client own tokens |
| Usage policy | Explicit route selection, quota pause and no automatic paid fallback |

Short-lived OAuth attempts stay in the single local coordinator's memory with expiry and one-time consumption. A coordinator restart cancels the attempt and the user starts again. Do not persist authorization codes or PKCE verifiers in SQL. A future multi-process/hosted auth service needs a separate shared transaction-store design.

The optional SQL `provider_oauth_registrations` table stores nonsecret registration/account/host metadata and granted-scope status. `provider_accounts.secret_ref` points to the protected credential bundle; its values are never token bytes. `provider_profiles` selects an immutable model/request configuration. No provider token enters FalkorDB, prompts, test containers, logs or exported diagrams. Registration metadata is still user-private data.

Provider account linking does not require adding a new authentication method to Threadline's human login. A future “sign into Threadline with ChatGPT” flow may map verified issuer/subject through `auth_identities`; our first route only connects model usage to an already authenticated local user.

## 8. Native subscription onboarding

For Codex, the proposed setup detects the executable/version and asks the official client's public account interface whether login is available. When necessary, the official client opens its sign-in flow. Threadline then controls app-server over stdio and supplies graph context through supported inputs/tools. It does not read the token cache.

For Claude Code, the user signs into the unmodified official binary. Threadline runs its documented programmatic mode, streams observable events and supplies scoped memory tools. Detect environment/API credential precedence before reporting the selected billing route; do not disable its built-in authentication methods. [Native authentication](https://code.claude.com/docs/en/authentication), [programmatic mode](https://code.claude.com/docs/en/headless)

Provider authentication can be easy for an already signed-in user while complete integration remains substantial. Each adapter must still pass independent capture, permissions, interruption and current-context recovery tests.

## 9. Acceptance gates

All cases are proposed and unexecuted:

1. New local ChatGPT registration completes and an owned-loop tool round trip succeeds.
2. Returning registration survives restart without mixing user/workspace registrations.
3. Identity-only/declined inference permission blocks model requests while preserving the local application session.
4. Wrong state/nonce, reused code, altered callback and mismatched identity fail without switching accounts.
5. Concurrent refreshes produce one valid replacement, never overwrite newer credentials, and handle revocation.
6. Quota exhaustion pauses visibly; no API request is made without an explicit route change.
7. Native-client runs keep tokens inside their official client and report the actual configured route.
8. Hosted-tool and unsupported-field rejection is caught by the profile validator before starting a run.
10. Disconnect/restart cancels incomplete OAuth attempts and redacted diagnostics contain no credentials.


See [provider evidence](track2-provider-evidence.md), [harness scope](track2-harness-scope.md) and [database design](track2-data-model.md).

## Provider-account authorization after architecture review

The hackathon first slice uses one explicit user-owned API profile. Native Codex/Claude and app-owned SIWC are documented post-hackathon routes; the distinction below remains valid even though they are outside that release. No OAuth or subscription route is exercised by these planning documents.

Before launch and each provider submission, require the run initiator, profile owner and provider-account owner to be the same active authorized human, with matching project/tenant scope. A project member has no implicit permission to spend another member's subscription or API balance. Native routes must additionally establish the intended registered host OS user and selected provider account. Fail closed on an unknown account binding. Shared billing requires a future explicit revocable grant and separate budget/audit policy.

Serialize provider/account permission changes with admission in the one active coordinator as defined in [runtime protocols](track2-runtime-and-protocols.md). Local application login, provider OAuth registration, code signing and billing authorization remain different concerns.
