# M05 bounded context and terminal integration evidence

Verified 17 October 2026 against `main` base `cbf2733` (M04 merged). M05 is locally integrated and verified, **uncommitted**. This report supersedes the earlier A/B partial handoffs; the master and lane checklists use the same task descriptions and completion state. No branch, staging, commit, push or external model inference was performed.

## Implemented behavior

`packages/backend/src/context/` owns task-scoped selection, immutable packets, whole-request admission and occurrence persistence. Shared contracts are in `packages/shared/src/context.ts`; the context routes are registered in the production server and consumed by typed CLI clients. Capability metadata is authenticated and advisory: every operation still checks its own authority.

Current goal, constraints, accepted criteria, TaskState, observed registered candidate and unresolved effects form mandatory P0 context. Exact text is preserved. Current checkpoint state and sourced failures are P1; observed successful read metadata with explicit reuse preconditions is P2; routine successful output remains P3 references. Optional observations follow the indexed task → Attempt → Observation → Source closure, at most three edges and 64 candidates, with at most four current failure excerpts. Selection checks current requirement/candidate compatibility, visibility, availability and original-byte integrity. Scope/version/digest deduplication records omissions without treating repeated records as corroboration.

M05 does not create validated procedures: none are eligible until M09's trial/validation path exists, so the two-procedure ceiling currently admits zero. Search distinguishes compatible advice from stale historical proof. No record is promoted to current protected completion proof; that authority belongs to M08. The observed candidate digest covers the registered non-hidden tree; environment identity remains unknown. These are observed-change checks, not M06 containment.

Packets have immutable artifacts and SQL manifest rows: owner/task scope, epoch/generation, decimal revision tokens, template/policy versions, exact/excerpt/reference representations, source bindings, inclusion reasons, precision and omission counts. A compact lossless tuple/dictionary encoding avoids repeating shared Source metadata in each criterion. `/context` reads the full manifest. The packet is local SQL/artifact provenance; this change does not add graph ContextPacket/INCLUDES nodes.

A packet defaults to 6,000 conservative tokens with an 8,000 ceiling. Counts use labelled UTF-8 byte upper bounds, not a model tokenizer or measured usage. The runtime can reduce optional packet allocation to fit actual instructions, schema, memory and working-history costs. Mandatory overflow refuses. Exact serialized provider bytes are checked again before journaling, preserving selected output reservation and safety headroom, alongside the existing 12,000 input and run-budget limits.

The request contains one current memory block. Recent history retains complete model/tool batches, never orphaned call/results. Oversized retained tool output becomes an attributed Source reference; original bytes remain durable. Repeated refresh replaces the block. There is no summarizer call, RLM, classifier, vector store, transcript deletion or implicit inference.

Before request admission, authority and selected artifact bytes are rechecked, including candidate changes. A short task admission lock serializes this boundary with checkpoint publication; it is released before network I/O. A bounded local rebuild can retry a stale render only before journaling. Journaled or unknown sends are never automatically resent.

Each actual attempt has its own durable context occurrence, keyed by packet and attempt identity. Persistence verifies the exact journaled request contains that packet and links `model_requests.context_packet_id`. Exact retries deduplicate; changed identity/digest refuses. Lifecycle records distinguish journaled, locally observed dispatch, terminal response and unknown outcome. Local persistence is not a provider acknowledgement.

## Model selection and durable instructions

Model listing reports configured/manual choices without provider discovery or compatibility probes. Selection creates an immutable owned profile containing the explicit provider, transport, endpoint, model and declared context/output limits. `run.prepare` requires its profile ID; start binds those facts, refuses stale new starts and preserves exact-request replay. Selection does not switch an active run, change billing routes or infer. Account/model compatibility still needs a separately authorized live request; M05 injected results do not establish it.

Plain text and `/send` preserve the original instruction with its real human session/task/message identity. They record input only, with no inference consent; the runtime later includes source-message attribution. Requirement changes still need M07 explicit acceptance. Busy/unknown work refuses rather than queues. Payload-bound retry records are owner-only, atomically published, bounded and redacted. Corrupt or unsafe records refuse replacement. Identical text/kind under the same retry-record namespace replays; an intentional separate identical submission needs a distinct record namespace. M07 owns richer continuation/session semantics.

Additive migration **7** extends existing context packet/delivery, profile selection and project-message columns/indexes. Migrations 1–6 are unchanged. Existing tenant fencing and forced RLS remain in force; genuine registered rows and foreign keys were used throughout verification.

## Implemented command inventory

The registry drives parsing, help, capability-aware prefix completion and dispatch. An unknown slash command is a local refusal. It is never sent as ordinary model text. The CLI can exercise the same registry with `node packages/cli/dist/index.js command '<slash command>'`; local help works without backend scope.

- `/help [command|all]`, `/hotkeys`: local generated usage and actual shortcuts. Availability says when backend metadata has not been checked.
- `/init`, `/admit`, `/task [id]`, `/status`, `/session [id]`: existing accepted task/readiness and attached human-session views. `/admit` previews the fixture; `/admit <displayed-manifest-digest>` explicitly accepts it. Only the attached human session is supported by `/session`; arbitrary session selection is explicitly deferred to M07.
- `/connect [provider]`: masked provider-first setup, reusing existing explicit validation. Keys never enter command history. Validation may contact the provider only after its existing confirmation; M05 verification canceled before that step.
- `/model`: searchable configured-model picker; manual `/model choose` form or `/model provider/model context-window max-output` fallback. Limits are declarations, not discovered capacities. Backend state persists the immutable profile; current TUI selection is view state, not an active-model switch.
- `/run prepare`, `/run start confirm`, `/run inspect [id]`, `/run cancel [id]`: selected-profile preparation, explicitly confirmed inference, durable truth and cancellation. `/run start` alone shows the confirmation prompt and does not dispatch. Production start may incur API charges. A successful final response is not protected task completion.
- `/tactical`, `/checkpoint`, `/plan`, `/recover`: current tactical view, bounded forms/mutations and bounded tail recovery. Forms pin the displayed base revision. Exact retry keeps intent identity/base; changed edits are new intents. Recovery never repeats uncertain effects.
- `/refresh`, `/context`, `/compact`, `/search <query>`: current packet staging/inspection, deterministic bounded-history rebuilding and scoped graph recall. Staged is distinct from actually submitted. Compact refuses active or unresolved work and reports zero summary calls.
- `/source <id> [offset] [max-bytes]`, `/history [after-seq]`, `/replay <epoch> [after-seq]`: authorized ranges and bounded durable project-history pages. Source inspection does not imply bytes are available. Inspection/model-output limits retain the M04 distinction.
- `/send <text>` and plain text: durable record-only instruction submission. `/quit` or idle Esc detaches and restores the terminal; it does not cancel backend work.

Tab completes; Enter submits the typed command without silently replacing it. Esc/Ctrl-C cancel an open form/picker/draft first. The compact header, bounded activity and inspector work in the exercised 70-column terminal. Full accessibility/platform/reconnect consolidation remains M10/M11.

`/stop`, `/pause`, `/diff`, `/logs` belong to M06; `/change`, `/answer`, `/new`, `/resume` to M07; `/verify`, `/complete`, `/evidence` to M08; `/doctor` to M13. They are not enabled by this change. Subscription OAuth and spawning remain deferred. The provider registry still exposes seven model tools; M05 extends existing memory tool behavior rather than adding unrestricted tools.

## Executed verification

All scripts are temporary, outside the repository. No permanent package test suite or new test dependency was added. Unique tenant/data directories used existing isolated `threadline-agentB-pg` and graph containers (ports 55434/56381); development Compose volumes were untouched. Store passwords were obtained in memory and never printed. PostgreSQL 18.6, FalkorDB 6.0.2, Node v23.11.0 and npm 11.4.1 were used. Node 24 and broader platform support are unverified.

- `npm run build`: passed, all workspace references.
- `/tmp/m05-accept.mjs`: **9 groups passed**. Real composed three-turn read → search → next-model → final-output path; exact persisted wire input with one packet/valid pairs; real occurrence lifecycle; refresh/inspect/compact/search; mandatory overflow, auth/foreign scope/schema refusal; budget; durable input and profile replay/conflict. Three injected requests, zero external requests.
- `/tmp/m05-faults.mjs`: **5 groups passed**. Authored graph-admitted diagnostic versus noisy success references; exact Source reads and cross-scope refusal; capped/duplicate/stale failures; optional missing evidence omission; epoch/missing mandatory checkpoint refusal.
- `/tmp/m05-lifecycle.mjs`: **5 groups passed**. Candidate mutation before admission refuses; 30 individually small retrieval pairs stay bounded through the actual renderer; selected-profile staleness refuses; packet survives real backend restart; unknown attempt blocks compact/follow-up with no automatic retry.
- `/tmp/m05-occurrences.mjs`: **2 groups passed**. One immutable packet tied to two genuine journal records gives two occurrences; same-occurrence persistence deduplicates and conflicts refuse. These extra rows are journal-only fixtures, not extra dispatched turns. A graph revision of `9007199254740993` round-trips byte-exact.
- `/tmp/m05-units.mjs`: **4 groups passed**. Concurrent owner-only redacted identity records, corrupt/symlink refusal, literal quoted command arguments, oversized Source-reference result preserving its call.
- `/tmp/m05b/registry.mjs`: **35 checks passed**; `/tmp/m05b/memory-slot.mjs`: **12 checks passed**. Collision/usage/capability classification, unknown slash refusal, generated help/completion and bounded memory replacement.
- `/tmp/m05-pty.mjs`: **28 submissions passed**, normal exit 0. Real mounted TUI/backend/stores/injected loop: context controls, unknown command, original durable instruction reaching the actual request, model/limit selection, start confirmation, committed checkpoint/plan read back from the real service, recovery/history, model picker Ctrl-C cancellation, masked authored dummy key cancellation and terminal restoration. Session token and dummy key were absent from terminal output. No provider-validation request was sent.

Earlier temporary A/B module checks remain useful history but do not replace the assembled evidence above. The unused provisional CLI episode-window module was removed; real pruning is in the backend request renderer. While reconciling checklists, the accidentally truncated B-lane M06–M13/final-handoff section was restored from merged HEAD; those later tasks remain unchecked.

## Remaining release boundaries

All M05A01–A12, M05B01–B11 and M05J01–J06 are verified locally within the limitations above. This does not complete cross-milestone privacy/export/recovery acceptance or packaging audits. M06 is the next implementation phase. No M05 PR exists from this work, no paid test is newly authorized, and no subscription integration is claimed.
