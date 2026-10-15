# M00 handoff — Agent A (Memory / Coordinator)

**15 October 2026.** This is the Agent A lane report for milestone M00, per [master checklist](archive/plans/track2-implementation-checklist.md) sections 3–5 and the [Agent A lane checklist](archive/plans/track2-agent-a-checklist.md). It is a coordination artifact, not a branch or commit. No Git branch, staging, commit or push was performed.

## 1. Completed and verified task IDs

| ID | Verified behaviour | Evidence |
|---|---|---|
| **M00A01** | `packages/shared/src` holds branded IDs, command/result envelopes, event types, health shape and typed errors. No database client, provider SDK, filesystem access or credential. | `packages/backend/test/agent-b-usage-example.test.ts` imports only `@threadline/shared` and typechecks/runs |
| **M00A02** | `createBackend(deps)` composes the backend with explicit `start()`/`stop()`. Construction binds nothing; `main.ts` is the only process entry and guards direct invocation. | `createBackend binds nothing and reports state created`; `stopping a backend that never started is still clean` |
| **M00A03** | `GET /healthz` returns a typed report and a real backend-owned `backend.status` event on each transition. Health reports presence/readiness per component and never implies storage or model readiness. | `GET /healthz returns a typed report…`, `GET /healthz answers 503 while the backend is not ready`, `start publishes status transitions…` |
| **M00A04** | Configuration parses bind address, data directory and four declared limits, reports every problem at once with a fix hint, and never echoes the submitted value. | 12 config tests plus process-level exit code 2 with the formatted issue list |
| **M00A05** | Bounded publisher: enforced listener cap, isolated listener failures, idempotent unsubscribe, `close()` clears listeners and refuses further use. SSE streams are bounded and closed on shutdown. | 11 publisher tests, `a stream is closed rather than buffered without bound…`, `shutdown closes open event streams` |
| **M00A06** | Versioned `PROTOCOL_VERSION = 1` command/result/event shapes plus a compiling consumer example Agent B can mirror. | `packages/backend/test/agent-b-usage-example.test.ts` |
| **M00A07** | API handlers only translate transport into a backend call and a status code. Domain modules import no transport. Only four directories exist. | `rg "fastify" packages/backend/src/domain packages/backend/src/events packages/backend/src/config.ts` → no matches |

**47 tests pass; `npm run build` is clean.**

## 2. Files changed (all new)

```
packages/shared/src/index.ts               public export surface
packages/shared/src/ids.ts                 branded CommandId / EventId / EchoId + constructors
packages/shared/src/errors.ts              error payloads and ThreadlineError subclasses
packages/shared/src/protocol.ts            PROTOCOL_VERSION, command/result envelopes
packages/shared/src/events.ts              ThreadlineEventOf<E> + discriminated ThreadlineEvent union
packages/shared/src/health.ts              HealthReport, ComponentStatus, guards

packages/backend/src/index.ts              createBackend(deps): composition, lifecycle, health
packages/backend/src/config.ts             parseBackendConfig / describeConfig
packages/backend/src/log.ts                minimal JSON logger with sensitive-field refusal
packages/backend/src/version.ts            THREADLINE_BACKEND_VERSION
packages/backend/src/main.ts               process entry (env -> config -> start -> signals)
packages/backend/src/api/server.ts         Fastify instance, listen/close, no import-time binding
packages/backend/src/api/routes.ts         thin handlers; exports ROUTES
packages/backend/src/api/events-stream.ts  SSE connection with backlog bound
packages/backend/src/domain/dispatcher.ts  admission, validation, typed failure mapping
packages/backend/src/domain/validate.ts    untrusted body -> typed command
packages/backend/src/domain/development.ts the one development command
packages/backend/src/events/publisher.ts   bounded process-local publisher

packages/backend/test/config.test.ts
packages/backend/test/event-publisher.test.ts
packages/backend/test/backend-lifecycle.test.ts
packages/backend/test/api.test.ts
packages/backend/test/agent-b-usage-example.test.ts
```

Checklist edits: `archive/plans/track2-agent-a-checklist.md` and `archive/plans/track2-implementation-checklist.md` (M00A01–M00A07 only). No M00B* or M00J* box was touched.

## 3. Shared exports and transport for Agent B

Import only from `@threadline/shared`. Do not import `@threadline/backend` into the client.

**Exports:** `PROTOCOL_VERSION`, `BACKEND_STATES`, `COMPONENT_NAMES`, `THREADLINE_ERROR_CODES`, `DEVELOPMENT_DURABILITY`, plus types `Opaque`, `CommandId`, `EventId`, `EchoId`, `ThreadlineErrorCode`, `ThreadlineErrorDetail`, `ThreadlineErrorPayload`, `ConfigurationIssue`, `CommandMap`, `CommandName`, `CommandInput`, `CommandResult`, `CommandRequest`, `CommandResponse`, `CommandOutcome`, `CommandSuccess`, `CommandFailure`, `DevelopmentEchoInput`, `DevelopmentEchoResult`, `ThreadlineEventOf`, `ThreadlineEvent`, `EventMap`, `EventName`, `EventPayload`, `BackendState`, `BackendStatusPayload`, `DevelopmentEchoAcceptedPayload`, `ComponentName`, `ComponentStatus`, `BackendGuarantees`, `HealthReport`. Runtime guards: `newCommandId`, `newEventId`, `newEchoId`, `isCommandId`, `isEventId`, `isEchoId`, `isCommandName`, `isEventName`, `isThreadlineEvent`, `isHealthReport`, `isThreadlineErrorPayload`, `errorPayload`.

**Three routes** (`ROUTES` is exported from the backend for reference):

- `GET /healthz` → `HealthReport`; **200** when `state === 'ready'`, **503** otherwise.
- `POST /commands` → `CommandResponse`. Body must be `{ "protocolVersion": 1, "command": "development.echo", "input": { "text": "..." } }`. Status: 200 ok / 400 `invalid_request` / 400 `unknown_command` / 503 `service_unavailable` / 500 `internal_error`. Non-JSON content type → 415. Body over `maxRequestBodyBytes` → 413.
- `GET /events` → `text/event-stream`. First frame is the comment `: threadline development events; process-local, no replay, no persistence`, then `id: <sequence>` / `event: <name>` / `data: <json>` / blank line. `sequence` is per-backend-process and starts at 1; it is **not** a durable cursor.

**Two event names:** `backend.status` (`{ state, since, detail }`) and `development.echo.accepted` (`{ commandId, echoId, text, acceptedAt, durability }`). `ThreadlineEvent` is a discriminated union, so narrowing works without casts:

```ts
import { isThreadlineEvent, type ThreadlineEvent } from '@threadline/shared';

const event: unknown = JSON.parse(dataLine.slice('data: '.length));
if (isThreadlineEvent(event) && event.name === 'development.echo.accepted') {
  render(event.payload.text, event.payload.durability); // 'development-only'
}
```

`packages/backend/test/agent-b-usage-example.test.ts` is the runnable version of this pattern, including command-response and health-report branching.

## 4. Verification commands and observed results

```sh
# from the repository root
npm run build                                  # tsc -b, TypeScript 7.0.2, strict + noUncheckedIndexedAccess
npm test -w @threadline/backend                # node --test "dist/test/*.test.js"
THREADLINE_PORT=47943 npm start -w @threadline/backend
```

Observed:

- `npm run build` → exit 0, no diagnostics, across all three workspace references.
- `npm test -w @threadline/backend` → `tests 47 / pass 47 / fail 0 / cancelled 0`.
- `rg -l "from 'fastify'" packages/` → only `packages/backend/src/api/server.ts` and `packages/backend/src/api/routes.ts`.
- `rg "^import" packages/shared/src` → only local relative imports plus `node:crypto`.
- Process check: `GET /healthz` → `state=ready`, `durable=false`, ready components exactly `api,eventPublisher`.
- Process check: `POST /commands` with `{"text":"repo build smoke test"}` → `ok=true`, `durability=development-only`.
- Process check: `THREADLINE_HOST=0.0.0.0 … npm start` → exit code **2** with the three-item formatted issue list on stderr, no socket bound.
- Process check: `SIGTERM` → logs shutdown, closes HTTP, exit code **0**.

Environment used: Node v23.11.0, npm 11.4.1, TypeScript 7.0.2, `@types/node` 26.6.5, fastify 5.12.7.

## 5. Requests for Agent B / integration owner

1. **Root `test` script:** resolved by the combined integration follow-up below; root `npm test` now builds and runs workspace tests.
2. **Checklist path:** resolved by keeping active plans in `archive/plans/`. The `.gitignore` exceptions make the relocated documentation trackable, and the root README links to the archive paths.
3. **Node engine.** `package.json` declares `node >=22`; this machine has v23.11.0, not Node 24 as the blueprint assumes. Recorded, not changed.
4. **No dependency changes were requested or made by this lane.** `fastify ^5.12.7` was already sufficient for everything in M00.

## 6. Unchecked, dependencies and honest limitations

**Unchecked by design:** M00B01–B07 (Agent B) and M00J01–J04 (joint integration). The combined backend/terminal round trip and the joint review have not been run by this lane, so those boxes stay empty.

**Limitations of what exists so far:**

- No database, graph, provider, checker, OAuth, migration framework or persistence of any kind. Nothing survives a restart.
- `development.echo` is a deliberate no-op with respect to task state. It proves the transport only.
- The event publisher has no replay buffer; a client connecting after an event is published will not see it.
- The backlog bound is enforced per connection against undelivered bytes. An event whose serialized size already exceeds the limit closes the stream; the multi-event accumulation path is implemented but was not independently exercised, because it depends on the socket high-water mark.
- Health `uptimeMs` measures time since `start()` succeeded, and the four absent components are reported as `present: false, ready: false` with the milestone that introduces them. These are static strings and must be revised as components land.
- `THREADLINE_BACKEND_VERSION = '0.0.0-m00'` is a placeholder, not a release version. A frozen version manifest is M13 packaging work.
- The backend binds loopback addresses only. That is enforced in configuration and is the honest current boundary, not a permanent constraint.
- One contained type assertion exists in `packages/backend/src/events/publisher.ts` (`asDeliveredEvent`). It is required to widen a generic event to the subscriber union and is commented; there is no `any` in the lane.

## 7. Readiness

**Agent A's lane is ready for combined M00 integration.** `M00A01`–`M00A07` are implemented and verified against the real workspace build and test commands, with no dependency on unfinished work. Integration still requires the joint M00J01–J04 checks and the checklist-path decision in section 5.
## Independent integration follow-up

The [combined verification](archive/plans/review/m00-integration-verification.md) supersedes the pending items above: routes/manifests agree, original backend tests exited normally, focused SSE/readiness/capacity fixes pass, and active checklists remain in trackable `archive/plans` by user choice. Both lanes and M00J01–M00J03 are verified. Actual branch/commit workflow remains pending.
