# API-key providers and OpenCode Go verification

Updated 16 October 2026. Use [interactive provider setup](provider-setup.md) to choose OpenAI, Anthropic (Claude API), OpenRouter or OpenCode Go, enter a masked key, validate it and save it outside the repository. Setup is available through `provider:setup` or `/connect` in the TUI. Saved providers can be checked, selected, replaced or removed without restarting an idle backend. Native subscription/OAuth authentication remains separate.

The manual environment examples below remain the legacy/advanced configuration route. Changes to those require a backend restart; an explicit saved provider selection takes precedence.

## OpenCode Go and Space Bunny

Set the following in the private root `.env`, using your own key. The supplied chat credential was tested in memory; it was not saved into the repository or `.env`.

```dotenv
THREADLINE_PROVIDER=opencode-go
MODEL_OPENCODE_API_KEY=<your-private-key>
THREADLINE_PROVIDER_MODEL=space-bunny
```

The default base URL is `https://opencode.ai/inference/go/openai/v1`; Space Bunny uses `/chat/completions`, not `/responses`. The model identifier in the direct request is `space-bunny`; `opencode-go/space-bunny` is OpenCode's own UI/config identifier. These routes and the stable `x-opencode-session` requirement are documented by [OpenCode Go](https://opencode.ai/v2/docs/console/go).

Restart the backend, then follow [the existing preparation/start workflow](m02-development.md). Preparation requires an explicitly declared effective model context window and performs no inference. Supply a window appropriate to the selected model/account rather than copying a synthetic test value.

Other Go models can use different protocols. Set `THREADLINE_PROVIDER_API=responses` only for a model documented as using Responses. Anthropic native Messages is implemented for the Anthropic provider; Google native protocols are not implemented. A Go key is never used for the OpenAI default endpoint unless the operator explicitly configures that target.

## OpenAI and custom compatible endpoints

OpenAI retains its existing default:

```dotenv
THREADLINE_PROVIDER=openai
THREADLINE_OPENAI_API_KEY=<your-private-key>
THREADLINE_PROVIDER_MODEL=<explicit-supported-model>
```

For another OpenAI-compatible service:

```dotenv
THREADLINE_PROVIDER=openai-compatible
THREADLINE_PROVIDER_API=chat-completions
THREADLINE_PROVIDER_BASE_URL=https://your-provider.example/v1
THREADLINE_PROVIDER_API_KEY=<your-private-key>
THREADLINE_PROVIDER_MODEL=<that-provider-model-id>
```

`THREADLINE_PROVIDER_API` accepts `responses`, `chat-completions` or `anthropic-messages`. Custom endpoints require an explicit HTTPS URL; HTTP is restricted to loopback. URL user information, query credentials and fragments are rejected. Only the selected provider's key variable is read into runtime configuration. There is no automatic switch of provider, key, model or billing route after a refusal or unknown send.

The provider/protocol/base URL are bound into prepared profile settings and checked at admission. Changing them requires a new matching profile. The private key stays in the coordinator; metadata summaries expose only whether it is configured. API keys do not enter SQL, artifacts, tools or CLI command arguments. Interactive setup briefly holds masked input and sends it to the local backend; only the backend persists it.

## What was verified with the real key

One user-authorized inline Python request was made to the documented OpenCode Go endpoint with `model=space-bunny`, `stream=false`, and a 128-output-token ceiling. It asked for the JavaScript result of `typeof 1`.

Observed result: HTTP **200**, returned model `space-bunny`, finish reason `stop`, visible answer **`number`**. Reported usage was **174 input tokens, 3 output tokens, 177 total**, including 143 cached input tokens. Elapsed request time was 1.35 seconds. No credential, raw authorization header or reasoning content was logged. No script file was created in the repository, and no additional paid requests were made for the transport implementation.

This establishes key/model/endpoint access for that request. That text test alone did not establish real streaming or tool calling. The subsequent explicitly authorized [full Space Bunny acceptance](m02-live-acceptance.md) now proves the model/tool loop for this account and authored fixture. The model's maximum context capacity and OpenAI account access remain unverified.

## Pi inspiration and implementation scope

The local Pi archive separates provider ID, credential source and model catalog from the wire API. Relevant references are `archive/pi-main/packages/ai/src/providers/opencode-go.ts`, `opencode-headers.ts`, `models.ts`, and `api/openai-completions.ts`. Pi's Go wrapper sends a stable conversation header and dispatches each model through its own protocol.

Threadline adopts that small separation with `provider/catalog.ts`; it does not import Pi's runtime, OAuth machinery, discovery system or SDK dependency tree. No Pi implementation body was copied. Responses, Chat Completions and native Anthropic Messages now share the same attempt identity, exact-byte journal barrier, reservation accounting, tool authorization and durable history. Chat reasoning text is not emitted or persisted; models requiring opaque reasoning continuation remain unverified.

Regression tests use synthetic keys and injected fetch responses. They cover fragmented streaming/tool arguments, incomplete terminal evidence, cancellation, no retry, usage, secret redaction, stable session headers and provider-key isolation. The real-store acceptance case exercises two chat turns, an actual candidate read, exact-byte artifacts and history reconstruction through the same backend API. These are meaningful transport/integration regressions, not scripts that make ordinary tests spend credits.

Follow-up verification: `npm test` passes 177 backend + 45 CLI tests (222 passing; 35 explicitly skipped); the opt-in real-store suite passes 34/34 with synthetic inference, including the Go chat transport and actual candidate read. That regression run used no further paid inference. The later explicitly authorized acceptance used real Space Bunny inference; see [final evidence](m02-live-acceptance.md).
