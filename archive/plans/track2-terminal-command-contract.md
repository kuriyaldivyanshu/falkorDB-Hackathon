# Threadline incremental terminal command and UI contract

Updated 16 October 2026. **Proposed implementation work from M05 onward.** This closes the missing command-surface specification; it does not claim the commands below already work. Existing M00–M04 acceptance remains historical evidence. Backend capability, CLI parity and TUI interaction must ship together in the owning milestone. M10 consolidates the interface rather than introducing core actions for the first time.

## 1. Scope and ownership

Keep TypeScript, Ink/React and the existing backend. Agent A owns authenticated application operations, capability metadata, immutable provider profiles, ordering, idempotency and authority. Agent B owns a small command registry/parser, CLI mapping, input/completion, selectors and rendering. Both integrate the real operation in the same milestone and combined branch/commit. Do not create a second domain model in the TUI or expose database queries as commands.

The command list below is the MVP interaction contract, not an expansion to Pi feature parity. Later capabilities may appear in `/help all` with their milestone and unavailability reason; normal completion lists only usable commands. Never display an enabled action backed by a stub. Do not reopen completed M04 checkboxes: expose its missing human controls through explicit M05 additions.

## 2. Current baseline and required changes

M04 currently provides `/connect`, `/tactical`, `/refresh`, `/source` and `/replay` paths. `/tactical` and `/refresh` inspect persisted tactical state; they do not rebuild a model input. CLI checkpoint/plan mutations and backend recovery already exist. The recovery HTTP client is not connected to a user command. Seven model tools are distinct from human slash commands.

M05 must retire the development echo behavior from normal chat input. An unknown slash command must return a local usage error, never become echo, a model prompt or a shell command. Plain text must have an explicit durable message/run contract before it is advertised as chat. Retain development echo only as the explicit development CLI operation until packaged-path cleanup.

## 3. Command catalog and delivery phases

Angle brackets denote a required argument; square brackets denote an optional argument. Argument parsing is typed, bounded and independent of shell parsing. IDs are selected from authorized backend records; no raw artifact paths, graph names, API keys or SQL/Cypher in command arguments. Preserve existing `/source <id>` and `/replay <epoch> [after-seq]` forms as compatibility aliases when the registry is introduced.

### M05 — Discoverability, provider/model selection and useful memory controls

- `/help [command|all]`: generated usage, phase, availability and reasons from the same registry used by completion. `/hotkeys`: actual key bindings. Local views; no inference.
- `/status`: readiness, selected project/task, active run/session, pending effects, provider/model route, configured limits and observed usage. Unknown cost stays unknown. `/session [id]`: authorized identity, lifecycle, revisions/fence and context-delivery status, not a hidden provider thread.
- `/connect [provider]`: reuse masked provider-first setup. OpenAI, Anthropic API, OpenRouter and OpenCode Go retain distinct billing routes. Never place keys in history, activity or request records. Explicit validation may contact the selected provider; no silent inference or OAuth claim.
- `/model [provider/model]`: searchable configured/supported model selector with a manual model-ID fallback when discovery is unavailable. Backend validates transport, credentials, effective context/output limits and ownership. Persist a next-run selection as a new immutable profile; do not mutate an active run. Reject an incompatible choice with a useful reason. No automatic paid probe or provider fallback. Mid-run model switching is deferred.
- `/init`: attach/enroll the local owner through the existing bootstrap rules. `/admit`: preview the authored fixture goal/criteria and obtain explicit acceptance, preserving durable admission retry identity. `/task [id]`: inspect accepted goal, criteria, versions and Source links. Task switching is view selection, never permission or execution ownership.
- `/run prepare`: prepare against the selected profile and show effective limits without inference. `/run start`: explicitly confirm the model/billing route and start the prepared operation using a durable request identity. `/run inspect [id]`: inspect real run truth. `/run cancel [id]`: reuse authenticated existing cancellation; display requested versus confirmed. M06 extends this to contained process termination. Omitted IDs resolve the selected authorized run, never an arbitrary latest foreign run.
- `/tactical`: current plan/progress/blockers and freshness. `/checkpoint`: bounded progress/next-action form. `/plan`: bounded step editor with explicit base revision; at most eight steps/one in progress. Use existing checkpoint/plan services, stable per-intent IDs and visible stale conflicts. A new edit gets a new ID; exact retry reuses the original. No checkbox can mark task completion.
- `/recover`: explicit bounded checkpoint-tail recovery using the existing recovery operation. Show pending/gap/overflow/unknown effects and retain previous committed state on refusal. Recovery never repeats an uncertain tool or model send.
- `/refresh`: preview/rebuild the current bounded authority/memory packet at a safe turn boundary; replace the single memory block. Show staged versus actually submitted context occurrence. Does not start inference. Preserve a typed unavailable result when only the old M04 inspection surface is available.
- `/context`: inspect current packet, versions, inclusion reasons, omissions and budget precision. `/compact`: explicitly rebuild bounded working history plus the current packet, retaining valid tool-call/result pairs and exact authority. No summarizer API, transcript deletion or paid request; no fresh claim/session and no rewrite of durable history. Reject/defer while a provider attempt/tool batch is unresolved. Use the same renderer and budget authority as ordinary turns.
- `/search <query>`: bounded task-relevant graph recall with authorized Source references and pagination/omission markers. `/source <id> [offset] [max-bytes]`: inspect metadata, then explicitly read bounded authorized ranges. Keep inspection versus model-facing output limits distinct.
- `/history [after-seq]`: bounded selected-project history with explicit cursor/epoch. `/replay <epoch> [after-seq]`: retain the existing explicit cursor form; reconnect gaps are visible, not successful empty pages.
- `/quit`: detach the TUI and restore the terminal; preserve task/run/data. Existing Esc-to-exit behavior remains a compatibility shortcut when no picker/form is open. Closing a form or picker only cancels that view.
- Plain text: with an admitted task, show whether it is an initial run instruction or follow-up; persist original human input with source/session scope and stable retry identity. Never silently reinterpret text as accepted requirements. Explicit user submission to a clearly labelled inference action authorizes that request under declared run limits; setup, selection, refresh and reconnect do not. If an active turn cannot accept follow-up yet, refuse visibly and retain the draft rather than inventing an unbounded queue. `/send <text>` is the explicit equivalent, using exactly the same handler.

### M06 — Contained execution and lifecycle controls

- `/stop [run-id]`: request cancellation of active work and reconcile process/container termination. Show cancellation-requested, stopped or unknown separately. Alias `/run cancel` to this lifecycle implementation once containment lands.
- `/pause [run-id]`: stop admitting dependent work at a supported boundary; reconcile in-flight effects before declaring paused. Never equate pause with detach or kill.
- `/diff`: backend-authorized bounded candidate diff against its registered base with digest/path/truncation metadata; no host shell execution. `/logs [execution-id]`: bounded captured command output, cursor and gap/truncation inspection. No arbitrary command execution in the TUI; the model uses registered `workspace.run` operations only.

### M07 — Human changes, fresh successors and safe resume

- `/change`: structured requirement-change form, normalized preview, current base revision and explicit human acceptance. Free text remains a proposal until accepted.
- `/answer <question-id>`: answer the actual pending question with typed choices/text; enforce session/task/revision scope. Duplicate retries do not answer twice; a timer never answers for the user.
- `/new [task-id]`: **continue the selected accepted task with a fresh successor**, after confirming this meaning. Drain/reconcile the predecessor, retire its claim, allocate new session/fence, build current bounded context, then await explicit execution consent if no valid continuing run authorization exists. Never just clear the screen or inherit the previous conversation. A different goal uses `/admit`; do not silently create a second task.
- `/resume [session-id]`: list authorized resumable records or select one. Reattaching the view does not infer. Execution continuation requires current authority, budget, reconciled attempts and supported lifecycle state. A retired session cannot be revived; offer a confirmed `/new` successor. Unknown provider dispatches block continuation until resolved, not automatically resent. Fresh successor and existing-session continuation remain visibly distinct.
- Pending questions and fresh/resume progress survive TUI/backend restarts. Record user input Sources and actual context insertion acknowledgements.

### M08–M09 — Checked completion and reusable evidence

- M08 `/verify`: explicit protected-check request bound to current candidate/criteria/environment. `/complete`: request guarded completion, invoke/reuse only matching protected evidence and display accepted/rejected/blocked. Neither a successful model response nor a completed plan is acceptance.
- M08 `/evidence [receipt-id]`: authorized current/historical receipt and original Source inspector; stale proof labelled historical.
- M09 extend `/search`, `/context` and `/evidence` to show procedure applicability, prerequisites, trial/supporting receipts and failed reuse. No new procedure-management command or automatic promotion required for the MVP.

### M10–M13 — Consolidation and delivery

M10 finishes keyboard/accessibility/narrow-terminal behavior and full journey consistency. M11 repeats command authorization, concurrency, disconnect and failure checks on assembled code. M12 uses the same controls for the continuity demonstration and matched baselines. M13 adds `/doctor` backed by packaged diagnostics: Node/Docker/store/artifact/profile readiness and actionable fixes; no automatic paid probe. Existing `/status` stays a lightweight readiness view.

Defer `/fork`, `/tree`, `/clone`, public `/share`, transcript import/export, plugin commands, arbitrary shell, theme/settings frameworks, thinking controls, spawning and subscription `/login` flows. Their backend/security/product contracts are not in the current critical path. `/connect` remains API-key setup, not borrowed subscription OAuth.

## 4. Backend capability contract before frontend wiring

For each owning milestone, A publishes typed operation input/result and transport binding before B connects its command. Reuse existing routes/services where available; do not mint competing routes from the command spelling. New operation names and routes must be published in shared protocol metadata by A before B binds them. The frontend never infers feature support from a lucky 404.

M05 adds a versioned capability response resolved for the authenticated principal/project: protocol version, operation ID, implemented/available state, reason code, required lifecycle state and limits. Publish only nonsecret authorized metadata; local commands need no round trip. Capabilities drive discoverability, never authorization: every mutation and Source read still rechecks server-side authority. Cache display metadata briefly and invalidate on reconnect/profile/task/run changes; execution uses fresh guards.

Every mutation uses stable request/operation identity bound to a canonical payload and selected scope. Persist retry records before send where needed; reconcile timeout/lost ACK before creating a new identity. Revision tokens are decimal strings. Typed outcomes distinguish rejected, accepted-pending, committed, ambiguous and replayed; HTTP success alone cannot imply completed execution. Frontend state is draft/selection/view state, not a shadow task database.

Provider selection is prospective configuration; profile IDs remain immutable. Preparation must consume the explicitly selected profile instead of silently falling back to environment defaults. A profile/ownership/credential change invalidates the relevant prepared-start token. Start confirmation binds the displayed provider/model/billing route and limits to the submitted request. No key ever belongs in shared metadata.

## 5. Small TUI layout and input behavior

Use one screen with a compact header (connection/project/task/provider/model/run state), bounded central activity, an on-demand inspector (task/plan/context/Source/receipt), input plus a short status/help footer. No graph editor, nested dashboard or separate terminal framework. Narrow terminals stack the inspector rather than hiding governing blockers. State uses text labels in addition to color.

A small typed registry stores command name/aliases, argument syntax, description, owning milestone, capability ID, local/read/mutation/inference classification and handler. Generate `/help`, suggestions, completion and usage errors from it. Cap shared names/aliases and refuse collisions. The registry references typed clients; it does not contain secrets or business rules. CLI and TUI share application clients/parsers where appropriate rather than duplicating validation policy.

Typing `/` opens a bounded command list; prefix matching is enough for the first version. Tab accepts a suggestion; arrows move selection; Enter submits the selected command or the input; Esc closes the picker before considering exit. Ctrl-C cancels a form/draft first; when idle it detaches with terminal restoration. Stop/pause require their explicit backend controls; Ctrl-C must not pretend an external process was terminated. Preserve existing exit shortcuts during transition and document actual bindings in `/hotkeys`.

Use small searchable model/session pickers and forms for checkpoint/plan/change/answer rather than demanding JSON or complex quote escaping. Busy actions show progress and cancellation semantics. Failed commands preserve nonsecret drafts, show correlation IDs and offer only supported next actions. Typed secrets are masked and excluded from command/input history. Bound activity, completion, history pages and retained drafts using existing profile limits or explicitly published UI limits; no full transcript in render state.

## 6. What to reuse from archived Pi

Local archive inspection planned for 17 October 2026; no claim about the latest upstream release:

- [Pi built-in catalog](../pi-main/packages/coding-agent/src/core/slash-commands.ts): reuse the small name/description/argument-hint pattern and a single source for discovery. Adapt to typed capability IDs and handlers. Pi's catalog is a useful short reference; avoid copying its entire interactive controller.
- [Pi interactive mode](../pi-main/packages/coding-agent/src/modes/interactive/interactive-mode.ts): inspect `createBaseAutocompleteProvider` and `setupEditorSubmitHandler` for completion/selection flow. Threadline should use registry dispatch rather than reproduce its large command if-chain or extension machinery.
- [Pi autocomplete](../pi-main/packages/tui/src/autocomplete.ts): borrow command/argument suggestion ideas only. It includes filesystem/process behavior and custom renderer dependencies; do not copy the module wholesale into the client.
- [Pi model selector](../pi-main/packages/coding-agent/src/modes/interactive/components/model-selector.ts): adapt searchable list, highlighted selection and cancel behavior to existing Ink components. Use backend-authorized configured models, not Pi's runtime/provider globals.
- [Pi session search](../pi-main/packages/coding-agent/src/modes/interactive/components/session-selector-search.ts): reuse the simple searchable-list concept over backend-authorized session metadata. Do not import its file-backed session manager/tree or infer access from local filenames.
- [Pi license](../pi-main/LICENSE): MIT, copyright 2025 Mario Zechner. Directly copied or substantially adapted code must retain the required copyright/permission notice with the copied module or an included notice. Record original path and copied revision/digest; inspect module imports before extraction. No new dependency on the archived tree at runtime.

Fast path: implement a small Threadline registry + prefix completion and reusable Ink selector. Copy a small pure helper only when it actually saves work after adaptation. Keep Pi's compaction prompts/model summarizer, provider credentials/session storage, OAuth and custom terminal renderer out of the implementation. Shared command names do not imply identical semantics: Threadline `/compact` is deterministic and `/new` is a guarded fresh successor.

## 7. Acceptance and two-agent integration

Each milestone needs a thin real vertical slice: A's operation → typed client → CLI/TUI action → authoritative result → reconnect/read-back. Agree operation names/scope/examples in shared code before independently building UI. When a backend surface is unavailable, B can build registry/forms against injected ports, but cannot check the assembled task until real composition is demonstrated. Use temporary scripts outside the repo, not permanent suite proliferation.

### M05 working order and small integration slices

1. **M05.1 — discovery and existing-operation controls:** A publishes capability metadata and confirms existing operation bindings. B builds registry/help/completion, status and forms over init/admit/run/checkpoint/plan/recover/source/history. Integrate these first; bounded graph retrieval need not be finished to expose working M04 recovery. Demonstrate one real mutation and one refusal before expanding forms.
2. **M05.2 — selected profile and real input:** A publishes prospective profile selection plus prepare/start and human-input bindings. B connects `/model`, `/send` and plain text using the displayed billing/limits confirmation. Prove the selected profile reaches the journaled request with an injected transport, not paid inference. Do not claim account/model compatibility from catalog selection.
3. **M05.3 — bounded context:** integrate the existing M05 retrieval/renderer work with `/refresh`, `/context`, `/compact` and `/search`. Demonstrate no transcript duplication, mandatory-overflow refusal and a real submitted context occurrence through an injected provider. Finish terminal checks and all M05 joint gates before the combined branch/commit.

These are integration slices inside M05, not separate branches or new independent milestones. B can work on local registry/forms while A publishes the next narrow typed operation. Share concrete exported signatures, example payloads, failure outcomes and a real composition call site; do not exchange speculative parallel DTOs. Missing dependencies stay named and unchecked, while independent slices continue.

Required affected checks: supported/unsupported/unknown command; help/completion consistency; no slash-to-echo/inference fallback; masked credentials; provider selection/start binding; exact retry vs changed payload; stale revision conflict; foreign-scope rejection; active-run restrictions; no inference on setup/inspect/compact; bounded output; actual ready/blocked/pending views; reconnect; terminal restoration. M07 additionally distinguishes reattach/resume/new and proves fresh context. M08 proves UI cannot bypass protected completion. Record implemented commands separately from planned commands at every gate.

Milestone task IDs in the master and both lane checklists are the execution authority. All newly added items remain unchecked until affected real behavior is observed. M04 evidence is not evidence these new human controls already exist.
