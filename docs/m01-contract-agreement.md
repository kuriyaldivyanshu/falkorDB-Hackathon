# M01 implemented transport agreement

Verified 15 October 2026 against the combined sources and real PostgreSQL/FalkorDB. This replaces the questions captured while Agent A was still publishing its lane. See the [integration evidence](../archive/plans/review/m01-integration-verification.md).

## Commands and reads

All requests target the configured local backend; there is no `/v1` prefix. Shared wire version is `1`.

- `GET /healthz`: backend lifecycle and actual component readiness. Required-store failure returns 503; no durable operation falls back to process memory.
- `POST /commands`: `{protocolVersion:1,command:"task.accept_goal",input:{projectId,requestId,fixtureId,goalText,requirements,criteria}}`. Requires `Authorization: Bearer <token>` and owner/editor project membership. Success/failure uses the shared command envelope. An accepted result includes exact source, epoch, sequence, receipt and current authority IDs. A pending result is not acceptance.
- `GET /auth/session`: authenticated principal, session absolute/idle expiry and permitted projects.
- `GET /auth/status`: non-secret bootstrap/authentication booleans; 200 for a valid session, 401 otherwise, 503 before storage exists.
- `POST /auth/session/revoke`: revokes the presented session. Further use returns 401.
- `GET /projects/:projectId/authority`: current goal, constraints, task state, criterion refs/text and original SQL source IDs; authenticated membership and source permission required.
- `GET /projects/:projectId/admissions/:requestId`: resolves/reconciles that exact durable request and returns its result; authenticated membership/source permission required.
- `GET /events`: M00 process-local status/echo notifications only. No replay, no durable acceptance event protocol and no task authority inferred from this stream.

Typed read failures use `{code,message,detail?}`. Command failures retain `{ok:false,...,error}`. SSE capacity failures retain their M00 `{error}` shape. The frontend route table matches the backend route table exactly. Public project/request parameters are UUID-validated.

## Owner bootstrap and credentials

The backend bootstraps the local owner at storage startup, protected by POSIX ownership and a private data directory. There is no anonymous HTTP bootstrap endpoint, token exchange, registration, OAuth or remote enrollment. SQL stores only a token hash. The backend writes `.threadline/session.json` with `{session_id,token,created_at}` using exclusive creation and mode 0600. CLI reads this format; compatibility with its original `{token,issuedAt,backendUrl}` test format remains.

`init` validates the existing credential through `/auth/session`; it does not create another identity. Both expiries and revocation are enforced. Idle usage slides the deadline to `min(absoluteExpiry, now + configuredIdleWindow)` without changing the absolute expiry. Inactive users, tenants and tenant memberships cannot authenticate. Existing credentials are checked against the database on restart. A missing/mismatched file fails closed; automatic credential recovery/reissue is not implemented. Preserve this file alongside database backups.

## Stable request identity and recovery

The CLI writes `.threadline/admission.json` before submitting. `--request-record` selects a different record for a deliberate new admission. Atomic exclusive creation prevents concurrent local invocations overwriting each other's request identity. The local digest binds the exact stored payload, with a placeholder request UUID, and is checked on read. It is independent of the backend digest.

The backend digest also binds principal, tenant, project, graph epoch, operation and every accepted requirement/criterion field. SQL atomically records original goal and a prepared immutable command envelope before graph mutation. The envelope includes generated graph/source IDs, so a crash before graph mutation can replay the original intent. Concurrent same-request SQL writes serialize; graph receipt uniqueness handles racing graph submissions. Settlement is idempotent and records the actual graph event identity/payload.

On lost acknowledgement, read the original graph receipt; do not allocate a new request ID. Pending intents reconcile at startup or explicit retry/receipt read. Unresolved/quarantined startup work blocks readiness. An old or malformed envelope is not guessed into authority. The MVP processes at most 1000 pending admissions per startup and fails explicitly above that bound.

## Fixture, execution and ownership

Initial consent binds the authored goal, all eight public rules, manifest digest, freshness value 600, accepted integer bounds/revision and six initial/both-phase criterion identities. The changed-only criterion belongs to a later requirement revision. Protected inputs and expected result bodies are not sent in the command. The public CSV header is an accepted rule, not a hidden expected result.

Interactive admission asks for an explicit affirmative response. Noninteractive acceptance requires `--accept-fixture <exact-sha256>`; missing/mismatched consent submits nothing. No `--yes` default or timeout implies acceptance.

M01 creates an accepted goal/task with no execution Run and no fabricated profile/run/model ID. SQL `project_messages.run_id` remains NULL; graph `Task.run_id` is absent until a real M02 Run exists. Provider, tool execution, checker and completion are not implemented.

The backend owns migrations, admission, identity and graph truth. The CLI owns local session/request-file access, consent and display. Only the backend reads database configuration. Exiting the TUI disconnects its stream; backend shutdown is explicit in its own terminal. Docker services/volumes survive both.
