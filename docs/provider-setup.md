# Provider connection and API-key storage

Implemented 16 October 2026. Choose a provider, enter its model ID, paste a masked API key, and confirm validation. A successful check saves and selects the provider immediately. Invalid, denied, rate-limited or unavailable checks preserve the working credential and selection.

## User workflow

Start the storage-configured backend and attach your local owner session using `init`. Then open setup directly:

```sh
npm run build
node packages/cli/dist/index.js provider:setup
```

Or start the TUI and enter `/connect`:

```sh
node packages/cli/dist/index.js tui
```

Choose OpenAI, Anthropic (Claude API), OpenRouter or OpenCode Go. Enter the provider's exact model ID. Paste the key into the masked field; keys are never accepted as command arguments. Review the test notice and type `connect` to validate, save and select it. No key is written before that confirmation and successful validation.

Returning to a saved provider offers use, check, replace and remove. Checks require typing `test`; removing requires typing `remove`. Removal deletes the local saved key, not the remote provider credential. Removing the active account disables inference until another provider is selected. It never falls back silently to another provider or an environment key.

Inspect safe metadata without a provider network request:

```sh
node packages/cli/dist/index.js provider:list
```

Metadata includes saved/active state, selected model, latest key-check outcome and timestamp. It contains no complete key or key fragment. Opening the TUI, listing settings, starting the backend and reading `/healthz` do not call model providers.

## Validation is provider-specific

OpenAI uses authenticated `GET https://api.openai.com/v1/models`. This checks key acceptance, not inference credit or tool compatibility. [Official models endpoint](https://developers.openai.com/api/reference/resources/models/methods/list)

Anthropic uses authenticated `GET https://api.anthropic.com/v1/models`, with `x-api-key` and `anthropic-version` headers. This is Claude API-key access; it does not use a Claude Code subscription or OAuth. [Official models endpoint](https://platform.claude.com/docs/en/api/models/list)

OpenRouter uses authenticated `GET https://openrouter.ai/api/v1/key`. A public models list is not used to assert that a key is valid. [Official current-key endpoint](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key)

OpenCode Go uses one explicitly approved Chat Completions request: a fixed `Reply OK.` prompt, a 32-output-token ceiling and no workspace/task content. The UI states that this consumes allowance before confirmation. No authenticated metadata-only key-check route was established for the current Go integration, so a public catalog response is not treated as proof. Space Bunny and other compatible Go Chat Completions models use the tested `/inference/go/openai/v1` base. Models requiring another Go protocol are not automatically rerouted. [Official Go model/protocol list](https://opencode.ai/v2/docs/console/go)

Checks time out after 15 seconds, reject redirects and bound response bytes. Fixed official destinations prevent a settings request from selecting an arbitrary credential recipient. Raw provider error bodies and network exception details are never echoed. Authentication failure, permission failure, rate/quota limit and connectivity/unsupported-response outcomes remain distinct. No automatic probe retry occurs. A saved-key recheck updates its latest check metadata without replacing the secret.

## Credential storage and access

The standalone backend stores accounts outside the repository. On macOS the directory is `~/Library/Application Support/Threadline/providers/`; other POSIX systems use `~/.config/threadline/providers/`. The account file is `accounts.json`. The directory must be owned by the current OS user with mode 0700; the regular, singly linked file must be owner-only mode 0600. Symlinked credential files/directories and unsafe modes are refused. New files are published through a private temporary file, fsync and atomic rename. A post-publication directory-sync failure produces a warning rather than reporting that publication never happened.

**This is permission-protected plaintext storage, not encrypted storage or an OS keychain.** Users/processes with access as the same OS account can read it. OS-keychain integration and Windows credential-manager support are not implemented. Embedded/test backends can inject an isolated credential directory; release packaging and broader portability remain separate work.

Only the authenticated local installation owner can access `/providers`, and that route accepts loopback requests only. Browser-origin requests are refused. The key is transient input in the terminal, sent to the local backend and the chosen provider only; it does not enter SQL, FalkorDB, artifacts, SSE/activity or logs. M03 capture must continue excluding credential-setting requests and bodies.

One saved account per provider is supported. A saved explicit selection overrides legacy `.env` provider configuration after restart. An explicitly disconnected account file also overrides `.env`, preventing accidental reactivation. Legacy environment configuration continues when no saved credential file exists. The setup flow does not copy or delete existing environment keys.

## Runtime behavior

Provider changes are refused during a live run or run admission. Validation failures, withdrawn owner authorization and file-write failures do not activate a replacement. Each replacement receives a fresh opaque credential revision. Prepared provider profiles pin that revision alongside provider/protocol/endpoint; a profile prepared before rotation is refused, so prepare a new run after switching or replacing credentials.

OpenAI uses the existing Responses transport. OpenRouter and supported OpenCode Go models use Chat Completions. Anthropic uses its native Messages API, with exact-byte journaling, read-only tool calls/results, reported usage and durable conversation reconstruction through the same guard. The initial Anthropic adapter buffers a bounded complete response rather than streaming text deltas; unsupported extended-thinking blocks are not captured or used for continuation.

Key validity, model/account access, successful tool use and protected task completion are separate facts. The existing real Space Bunny acceptance remains the live-model evidence. Other providers have deterministic transport and real-store fixture coverage here, not a claim that private accounts/models were tested.

## Verification

Affected provider/configuration/driver/budget tests passed (64 tests at that verification point). After adding startup/recheck cases, the affected credential suite passed 9/9. CLI run-dispatch regressions passed 15/15. Provider-client and real PTY setup checks passed 2/2, proving masking, explicit confirmation, sanitized errors and clean terminal exit with synthetic credentials.

The isolated-store suite passed 36/36, including native Anthropic read-tool continuation and owner-only onboarding/stale-profile refusal. After final settings refinements, only those two affected store scenarios were rerun: 2/2 passed. Ordinary tests and provider validation probes were injected; no new real provider calls were made for this feature. Unrelated suites were not repeatedly rerun.
