# M02 development and local execution

Updated 16 October 2026. M02 is integrated locally on top of merged M01 (`067f842`). Real PostgreSQL/FalkorDB authority, the journal, the sequential loop, read-only tools and CLI/TUI run control work together. Local acceptance uses an explicitly injected synthetic provider; it does not establish paid account/model compatibility. **M02B01 and M02J02 are now verified using the user-selected OpenCode Go / Space Bunny model.** See [live acceptance](m02-live-acceptance.md); live OpenAI access remains unclaimed.

## Starting the local runtime

Follow [local setup](local-development.md), build, start the backend, attach the local owner credential and explicitly admit the authored fixture:

```sh
npm run build
npm run start --workspace @threadline/backend
# Another terminal, after configuring required stores:
node packages/cli/dist/index.js init
node packages/cli/dist/index.js fixture
node packages/cli/dist/index.js admit --request-record .threadline/admission-PROJECT_ID.json
node packages/cli/dist/index.js inspect
```

The backend resolves the selected key from [owner-only saved provider settings](provider-setup.md), or root `.env` when no explicit saved selection exists. The CLI only holds transient masked setup input. See [provider configuration and the OpenCode smoke-test evidence](provider-configuration.md). OpenAI Responses, Anthropic native Messages, OpenRouter, OpenCode Go and an explicitly configured OpenAI-compatible endpoint are selectable; OpenRouter, OpenCode Go and generic compatible endpoints default to Chat Completions. There is no key/provider fallback, default model or subscription/OAuth route. Startup, preparation and inspection never infer. The configured base URL now controls the actual request endpoint and is pinned in newly prepared profiles.

Keep the same `--request-record` path when retrying an admission. An existing record from another project must not be reused or silently replaced. Run mutable candidates outside directories whose sync software creates hard links; the read-only tool safety checks intentionally refuse multiply linked files. See the [live acceptance environment finding](m02-live-acceptance.md).

M05 now requires explicit immutable profile selection before preparation. In the TUI use `/model` or `/model choose`, declare compatible context/output limits, then `/run prepare` and `/run start confirm`. See the [current command inventory and context evidence](../archive/plans/review/m05-integration-verification.md). Selection, listing and preparation do not probe the provider. The lower-level CLI requires the selected profile ID returned by selection; preparation creates a copied candidate and registrations while reusing that profile:

```sh
node packages/cli/dist/index.js run:prepare --project <project-id> --profile <selected-profile-id> --context-window <declared-tokens>
```

Use the returned real identities to construct the explicit start command. **`run:start` consumes provider allowance and can incur charges. Live acceptance was explicitly authorized; ordinary tests still use fixtures.**

```sh
node packages/cli/dist/index.js run:start \
  --project <projectId> --task <taskId> --profile <profileId> \
  --workspace <workspaceId> --request-id <requestId> \
  --expect-revision <expectedRevision> \
  --expect-requirement-revision <expectedRequirementRevision>
node packages/cli/dist/index.js run:inspect <run-id>
node packages/cli/dist/index.js run:cancel <run-id> --reason "stop requested by owner"
node packages/cli/dist/index.js tui
```

Reuse the exact start identities on a response retry. A replay returns the stored run and never restarts inference. Changed input under that request ID is rejected. Closing the TUI only disconnects the view; it does not cancel the backend run. Backend shutdown aborts its owned loop before closing storage.

## What is implemented

`runtime/managed.ts` composes one owned loop behind authenticated prepare/start/cancel/inspect/heartbeat routes. Candidate paths and host/fingerprint bindings are resolved from trusted registrations, never model arguments or client-supplied filesystem paths. Preparation uses a separate copy of the authored inventory fixture; the original UTC-formatting defect remains. M02 exposed `workspace.read`, `workspace.search` and `workspace.inspect`; [M03](m03-development.md) added source-range `memory.retrieve`; [M05](../archive/plans/review/m05-integration-verification.md) extends it with bounded graph search and composes current memory into every request. Traversal, hidden/secret paths, symlinks, hardlinks, non-regular files, invalid UTF-8 and NUL content are refused. Tool results are bounded to 32 KiB, scans to 1000 entries, 50 MiB and depth 16. These observed-change checks are not the future effectful OS sandbox.

The TurnGuard rechecks the initiating human session stored in the authorization manifest, membership, profile/account ownership, immutable profile digest, graph epoch/revisions/fence, live run/session, operational lease and original source bytes. Dispatch and tool intent admission share the per-project lock with human command admission. Reservations use the whole serialized request plus framing allowance and requested output ceiling. The conservative one-token-per-byte reservation estimate is not measured usage or proof of real model capacity. The run also enforces its input, attempt, tool, token and deadline limits.

The exact transmitted request bytes become a verified immutable artifact before dispatch. Complete terminal supported output, the ordered tool-call batch and actual usage become durable before tools are released. A tool intent must belong to that released batch. Results persist before the next input is rebuilt from verified SQL-backed artifacts. Partial/gapped outcomes release no tools. No hidden reasoning is retained. The driver rejects unsupported continuation items; actual chosen-model compatibility remains unverified.

Migration 3 adds nullable `model_requests.reserved_tokens` and `possible_charge`, retaining unknown legacy facts instead of fabricating zero. Bootstrap versions 1 and 2 remain unchanged. The graph keeps immutable TaskState revisions and a mutable operational `AgentSession.lease_expires_ms`; heartbeat extends the lease without invalidating the worker fence. Ending a successful read-only run releases the task to `ready`; this does **not** accept protected task completion.

`run.activity` delivers bounded visible-text/tool/state hints to the plain TUI. Every private delivery reauthenticates the session and checks its project authority. Anonymous subscribers receive no private activity. This activity SSE remains process-local, bounded and non-replayable; M03 adds a separate durable history stream; `run:inspect` reads durable backend facts.

## Verification and remaining limits

See [independent M02 integration evidence](../archive/plans/review/m02-integration-verification.md) for commands, exact results, repaired defects and limitations. Ordinary tests use injected transports; live tests require explicitly configured verification stores and use isolated tenant/data directories. They never delete development volumes or automatically reset existing credentials.

The real Space Bunny model/tool round trip passed with 3 completed turns, 2 successful tools, 8,045 reported tokens and zero unresolved attempts. See [full evidence](m02-live-acceptance.md). The shared local output ceiling is 4,096 tokens; each immutable profile and request remains subject to declared context capacity and run budget. A fully received Chat Completions `length` terminal with reported usage settles as failed, releases no partial tools and requires no automatic resend. Missing terminal evidence or usage remains uncertain. Live OpenAI account access remains unverified. No automatic restart/resume or operator reconciliation of an uncertain attempt is claimed. Unknown attempts and uncertain cancellations retain reservations and block dependent work; automatic resend is disabled. General source capture/projection is implemented by [M03](m03-development.md); effectful containment is M06, protected completion is M08, and release portability/pinning is M13. Node 24 compatibility remains unverified on this machine.
