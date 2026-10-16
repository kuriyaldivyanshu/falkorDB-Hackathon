# M03 durable capture and source inspection

Updated 16 October 2026 against merged M02 base `d09f35e`. M03 is integrated in the working tree. The owned runtime records permitted evidence, admits graph provenance, projects ordered history and serves bounded Source reads. Ordinary acceptance uses an injected provider; it makes no external inference requests.

For current checkpoint/plan tools and deterministic tail recovery, see [M04 workflow and verification](../archive/plans/review/m04-integration-verification.md). M03 source/history APIs remain the underlying evidence surface.

## Running and inspecting evidence

Build/start/configure/admit using [the executable M02 workflow](m02-development.md) and [provider setup](provider-setup.md). Starting an actual model run still requires explicit user authorization. Source/history inspection does not infer.

```sh
npm run build
npm start --workspace @threadline/backend
# Another terminal, using the attached local credential:
node packages/cli/dist/index.js inspect
node packages/cli/dist/index.js run:inspect <run-id>
node packages/cli/dist/index.js history:replay --project <project-id> --epoch <graph-epoch> --after-seq 0
node packages/cli/dist/index.js source:inspect <source-id> --project <project-id>
node packages/cli/dist/index.js source:read <source-id> --project <project-id> --offset 0 --max-bytes 256
node packages/cli/dist/index.js tui
```

History prints the Source IDs carried by captured events. A tool result's next model input contains `evidenceSourceId`, identifying its original output artifact. This is separate from `sourceId` inside a source-retrieval result, which identifies the Source being read. The extra reference is a derived context field; original tool output bytes remain unchanged in the artifact.

In the TUI, use `/source <source-id>` to inspect availability; `/source <source-id> 0 256` reads a range. `/replay <graph-epoch> 0` follows durable history and reconnects from the last delivered cursor. The panel distinguishes graph-admission pending, available/missing Source bytes, partial range and replay gaps. Esc disconnects the client and restores the terminal; it does not cancel a backend run.

`source:read` returns the bounded bytes in base64, alongside digest, offsets and size. A byte range may split a UTF-8 character; decode/reassemble the original bytes before interpreting text.

## What the backend persists

The existing M02 journal remains the owner of exact submitted request bodies and supported complete terminal response artifacts. Provider response artifacts contain the permitted normalized conversation/tool batch, not raw HTTP headers or unsupported provider output. Failed/unknown turns retain their observed status and any captured partial bytes; missing complete response bytes remain explicit. Provider capture references those identities and adds versioned `model.input`, `model.output.partial` and `model.output.complete` records. Partial visible chunks have their own original-byte artifacts because a crash can prevent a terminal artifact from existing. Hidden reasoning, authentication headers and provider setup/validation credentials have no capture path.

Tool intent is captured before execution; tool result is captured before dependent inference. A failed capture acknowledgement blocks dependent work. Complete terminal output and the complete tool batch must still pass the journal/authority gates; a capture completeness flag alone grants no execution authority.

A session row lock serializes sequence allocation and duplicate-key checks. A canonical payload digest binds the stored correlation, completeness, references and original-byte digest. Identical concurrent delivery returns one capture identity/position; changed content conflicts. Capture and its outbox row commit in the same SQL transaction. Existing M02 records are retained, with a separate legacy-digest diagnostic rather than rewritten history.

Immutable files are published before SQL references them. Reads hash and return the same buffer. Concurrent publication cannot delete another publisher's winning bytes. A failed or ambiguous SQL acknowledgement retains immutable orphan bytes for reconciliation; M03 does not ship automatic artifact garbage collection or a host-power-loss guarantee.

## Graph admission and recovery

One local-tenant worker starts explicitly with the backend and polls every 250 ms. It leases bounded outbox batches, uses stable operation IDs and compares digest-bound receipts before writing. Admission creates the appropriate Message/Observation/Attempt, available artifact Source and provenance edges, together with its Event and receipt in one FalkorDB statement. Tool results link to their existing Attempt; diagnostic/registered-command observations produce a task-bound Attempt with observed evidence. No executable command tool is added by this plumbing, and no guessed cause becomes accepted fact.

Graph operations use the actual FalkorDB dialect with bound scalar parameters. UUIDs are SHA-256-derived stable identities; absent properties are omitted. A failure before a graph write can retry on the bounded profile schedule. An ambiguous write is quarantined and reconciled by its receipt; a matching committed receipt resolves without another mutation. Conflicting digests remain quarantined. Absent receipts do not authorize inference resend or tool re-execution.

The four positions remain distinct: session capture sequence, graph Event sequence within a project epoch, SQL projection offset, and client replay cursor. Projection rows and contiguous offset commit together. A numeric sequence is sorted numerically even after event 9. Missing positions stop progress or produce an explicit gap; old-epoch cursors are refused. A projection failure cannot advance its offset alone.

SQL outage stops durable capture and dependent dispatch. Graph outage can leave SQL evidence pending, with original bytes intact; a pre-write outage recovers when graph access returns. A pending/quarantined capture is not advertised as admitted memory. This is not offline execution or automatic model-session continuation.

## Transport and access

Registered local authenticated routes:

- `GET /projects/:projectId/sources/:sourceId`
- `GET /projects/:projectId/sources/:sourceId/range?offset=0&maxBytes=256`
- `GET /projects/:projectId/history/replay?epoch=<uuid>&afterSeq=0&limit=100`
- `GET /projects/:projectId/history/events?epoch=<uuid>&afterSeq=0`

The durable SSE endpoint also accepts `Last-Event-ID: <epoch>:<sequence>`. It catches up and polls the same SQL projection, avoiding a separate subscribe/handoff window. It reauthenticates and rechecks permissions per delivery. Server streams/pages and client buffers are bounded; slow consumers disconnect, and oversized or missing evidence produces explicit refresh/gap behavior. Client reconnect never restarts inference. Existing `/events` remains a separate process-local activity/status stream with no replay promise.

Every Source read rechecks project membership, visibility and an attributed human session when present, and verifies original bytes. Foreign and absent Sources are indistinguishable. SQL failures remain unavailable errors rather than being disguised as empty results. Builder session identity is distinct from human session identity. Replay redacts private payloads that the reader cannot access while retaining ordered restricted placeholders.

M03's model tool supports project-safe artifact Sources only. User/session-private bytes may be inspected by an authorized backend reader, but the model tool refuses them; propagation of private content through subsequent model/tool journals is not shipped. No raw locator, arbitrary graph query or filesystem path is accepted by the source tool. M01 project-message-backed authority Sources continue to use their existing authority path; the new Source range API addresses artifact-backed capture Sources.

## Limits and verification

The inspection range maximum is 32,768 original bytes. `model_tool_output_max_bytes` is a separate 32,768-byte serialized-result ceiling. The shared helper derives a smaller model-facing original-byte range, including base64 and metadata overhead; consumers must import it rather than hardcode a historic 24,408/24,411 value. Each actual result is measured, and whole-request budgeting still counts the exact serialized request. Read tools exceeding the result envelope limit return an explicit refusal so a model can request a smaller range.

Visible chunks use 16 KiB/250 ms boundaries, with a shared 1 MiB pending/in-flight budget, bounded stream count and five-second drain bound. Unacknowledged chunks are partial evidence, never a zero-loss transcript or executable partial arguments. Source/model retrieval was M03's fourth tool alongside the three workspace read tools. M04 added three tactical tools (seven total); locally integrated [M05](../archive/plans/review/m05-integration-verification.md) extends memory retrieval with graph search and bounded request context. Executable containment is M06; fresh-session continuity and protected completion remain later gates.

[Integration evidence and checklist closure](../archive/plans/review/m03-integration-verification.md) records the executed checks. Node 24 and additional paid-provider compatibility remain unclaimed. No schema migration or dependency change was necessary for M03: the core capture/outbox/projection tables already existed.
