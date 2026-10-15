# M01 handoff — Agent A (persistence and task authority)

**15 October 2026.** Agent A lane report for M01, per [master checklist](archive/plans/track2-implementation-checklist.md) and the [Agent A lane checklist](archive/plans/track2-agent-a-checklist.md). No branch, staging, commit, push or merge was performed.

## 1. Recorded base and pre-existing dirty state

- Base commit: **`ed18168`** ("Merge pull request #1 … threadline/m00-scaffold"), implementation commit `13b17a2`. Branch `main`.
- Dirty on arrival (not mine, preserved): `README.md`, `archive/plans/README.md`, `archive/plans/review/m00-integration-verification.md`, `archive/plans/track2-agent-a-checklist.md`, `archive/plans/track2-agent-b-checklist.md`, `archive/plans/track2-implementation-checklist.md`, and untracked `archive/plans/prompts/`.

## 2. Baseline run before my changes

`npm run build` **failed** on the merged base and `npm test` reported **2 failing tests**. Both were pre-existing, not introduced by this lane:

1. `packages/backend/src/index.ts:220,227` — `TS2367` comparing `'created'` with `'starting'`. The M00 start/stop synchronisation narrowed `state` to `'created'` through the guard and then read it inside the asynchronous body of `start()`. Fixed by reading it through a `currentState()` accessor, preserving the merged start/stop behaviour exactly.
2. `packages/backend/test/backend-lifecycle.test.ts` — two cases used `assert.rejects(() => backend.start())`, but the merged `start()` rejects the lifecycle transition **synchronously**. Changed to `assert.throws`.

After those two narrow fixes: backend 47/47 and cli 5/5 green at the start of M01 work.

## 3. Completed and verified task IDs

| ID | Verified behaviour |
|---|---|
| **M01A01** | `pg` pool and FalkorDB client built by factories, closed explicitly, no import-time connection. Every statement is parameterised, including the tenant fence (`set_config` with a bound value). A caller-supplied project id is rechecked against active membership before it is used. |
| **M01A02** | The 31-table FK-closed core reference is applied as one versioned migration with a SHA-256 checksum. `applied` / `unapplied` / `incompatible` are distinguished; a restart takes the `applied` path and re-runs no DDL. The two native/OAuth extension tables are excluded. |
| **M01A03** | Only the operations this trace uses exist: local tenant/user/membership, project, human session, project message, command inbox, graph ProjectRoot/ActorRef/Goal/Constraint/Task/Criterion/Source/Event/RequestReceipt. |
| **M01A06** | Indexes and the four required UNIQUE constraints are created and polled until `db.constraints()` reports `OPERATIONAL`; admission waits for that. One guarded Cypher statement commits state, current pointers, project generation/sequence/requirement revision, Event and RequestReceipt. Zero rows never means success: the original receipt is resolved first. `bigint` is read as a string and rejected if it leaves the safe-integer range. |
| **M01A07** | Stable `Goal` and `Constraint` identities with immutable version 1 nodes, `HAS_VERSION` and `CURRENT_VERSION` edges, original source provenance and a criteria digest. Current authority is read back through stable ids. |
| **M01A08** | Same scope/epoch/request id with the same canonical payload returns the exact original receipt with `replayed: true` and no new event. The same id with a different payload is `idempotency_mismatch` (HTTP 409) with no mutation and no disclosure of the committed result. |

**Not claimed:**

- **M01A04** — bootstrap, token hashing, session lookup and both expiries are implemented, but revocation and the sliding-idle-cannot-extend-absolute rule were **not executed** against live stores. Left unchecked.
- **M01A05** — SQL-before-graph ordering and the pending/committed inbox states are verified, but a **lost-acknowledgement reconciliation** driven from a pending row was not exercised. Left unchecked.

## 4. Commands and observed results

```sh
npm run build                         # exit 0, TypeScript 7.0.2, strict + noUncheckedIndexedAccess
npm test -w @threadline/backend       # tests 55 / pass 49 / fail 0 / skipped 6

THREADLINE_LIVE=1 \
THREADLINE_LIVE_PGPASSWORD=<agent-a verification password> \
node --test --test-timeout=40000 packages/backend/dist/test/m01-live.test.js
                                      # tests 6 / pass 6 / fail 0
```

Unit cases (no stores): 47 pass. Live cases: 6 pass. The 6 live cases are **skipped, not silently passed**, when `THREADLINE_LIVE` is unset.

Direct inspection of the real stores after a clean bootstrap+admission:

```text
SQL   information_schema.tables in schema threadline ....... 31
SQL   schema_migrations ................................. postgres | 1 | 3033ec89e103e5ca
SQL   tables with rowsecurity ............................ 27
SQL   command_inbox ...................................... committed|1|t|t  (x2)
SQL   project_messages.body .............................. "Produce deterministic CSV for valid fresh ..."
SQL   graph_event_projection ............................. 1|task.accepted, 2|task.accepted
graph ProjectRoot ........................................ generation=2 next_event_seq=2 requirement_revision=1 status=ready
graph Goal/GoalVersion ................................... current_revision=1, source_id + criteria_digest set
graph Constraint/ConstraintVersion ....................... current_revision=1, polarity=must, accepted_by set
graph SUBJECT_TO ......................................... 2 bindings
graph Task/TaskState ..................................... current_status=ready, revision=1, unresolved_effects=false
graph Criterion .......................................... fixture:initial-mixed-offsets / fixture:negative-quantity
graph Source ............................................. source_kind=project_message, availability=available
graph RequestReceipt ..................................... 2 receipts, identical request_digest, event_seq 1 and 2
graph ActorRef ........................................... 1 node (Local Owner)
file  .threadline-agentA-test/session.json ................ mode 0600
```

Tenant fence, proved directly against a non-superuser application role:

```text
unfenced read            -> 0 rows
own tenant fence         -> 1 row  (the bootstrapped project)
foreign tenant fence     -> 0 rows
```

Store versions: PostgreSQL **18.6** (postgres:18-alpine), FalkorDB **6.0.2** (`falkordb/falkordb:6.0.2`, graph module 60002) on Redis 8.10.2, `pg` 8.23.1, `falkordb` 6.8.0, Node v23.11.0.

Verification used dedicated containers `threadline-agentA-pg` (55433) and `threadline-agentA-graph` (56380) with a generated password held only in the shell environment. The development Compose volumes were not reset or modified.

## 5. Two findings that need a decision

**5.1 The reference M1 Cypher does not run on FalkorDB 6.0.2 as written.** Verified against the live server:

- A variable bound by `CREATE` is **not** visible to a later `CREATE` clause, only to `RETURN`. The reference M1 relies on `event_seq:e.seq` inside a following `CREATE`, which fails with `'<var>' not defined`.
- `FOREACH` creates a relationship only when **both** endpoints are created inside the same `FOREACH` body. A relationship whose source was bound outside is silently skipped — the `SUBJECT_TO` edges in the reference M1 would not appear at all.
- `collect()` over nodes created earlier in the same query yields no rows.

The admission query here therefore uses only the matched `ProjectRoot` and bound parameters for cross-references. **Task applicability bindings (`SUBJECT_TO`) are written by a second, idempotent `MERGE` statement that runs only after the guarded mutation returns a fresh receipt.** That is a deliberate, documented deviation from "one guarded mutation" for the binding edges. Authority state, current pointers, generation, event sequence, Event and RequestReceipt remain in the single guarded statement. `archive/plans/schema/falkordb-reference.cypher` should be corrected before anyone builds M02 checkpointing on it.

**5.2 `FORCE ROW LEVEL SECURITY` does not bind a superuser.** The Compose `POSTGRES_USER` is a superuser, so the tenant fence is decorative in that setup. The backend now **refuses to start** with `storage_unavailable` when the application role is a superuser or holds `BYPASSRLS` (`assertTenantFenceEnforceable`). To run, the deployment needs a separate non-owner application role plus a schema-owner identity for migrations:

```sh
THREADLINE_PG_USER=threadline_app              # must NOT be superuser, must NOT have BYPASSRLS
THREADLINE_PG_APPLICATION_ROLE=threadline_app  # granted DML by the migration
THREADLINE_PG_MIGRATION_USER=threadline        # schema owner, used only for DDL and schema_migrations
THREADLINE_PG_MIGRATION_PASSWORD=…
```

This is an operator step, not something Compose can do for you. `development-profile.json` assumes the app never receives database credentials; it does not yet say that the *backend* must connect as a non-owner role.

## 6. Run/profile seam decision (M01A03)

`runs.initial_profile_id` is `NOT NULL` with a foreign key to `provider_profiles`, which in turn requires a `provider_accounts` row. M01 has no provider credentials and `M01B05` requires them to stay unset, so a `runs` row cannot be created without inventing a provider account.

**Decision: M01 does not create a `runs` row.** `project_messages.run_id` is nullable and `command_inbox` has no run column, so admission does not need one. The graph `Task` carries an explicit non-execution marker, `run_id = "no-run-accepted-goal-only"`, instead of a fabricated profile id. A real Run is created at M02 once a profile exists. This is a recorded seam, not a silent deferral, and it is visible in the graph.

## 7. Shared exports, routes, auth and config for Agent B

**New shared exports** (`@threadline/shared`, all additive):

- Types: `GoalAdmissionInput`, `GoalAdmissionResult`, `AdmissionReceipt`, `AdmissionPending`, `AdmissionRejected`, `AcceptedAuthority`, `AcceptedConstraintRef`, `AcceptedCriterionRef`, `AcceptedCriterion`, `AcceptedRequirement`, `AuthorityView`, `PrincipalView`, `ProjectMembershipView`, `AuthStatusView`, `Uuid`, `CriterionKind`, `AcceptedRequirementPolarity`, `AdmissionOutcomeKind`.
- Guards: `isUuid`, `isAdmissionReceipt`, `isAdmissionPending`, `isDevelopmentEchoResult`.
- Constants: `ADMISSION_COMMAND`, `CRITERION_KINDS`, `ACCEPTED_REQUIREMENT_POLARITY`, `ADMISSION_NOT_FOUND_REASON`.
- **Error codes added** (additive): `unauthorized`, `not_found`, `idempotency_mismatch`, `authority_conflict`, `authority_unavailable`, `storage_unavailable`, `schema_incompatible`.

**New routes** (M00 routes unchanged; no `/v1` prefix introduced):

| Route | Auth | Result |
|---|---|---|
| `GET /auth/status` | none | `{bootstrapped, authenticated, reason}`; 503 when storage is down, 401 when no valid token. Never echoes a token. |
| `GET /auth/session` | bearer | `PrincipalView` with the caller's active projects. |
| `POST /auth/session/revoke` | bearer | `{revoked: boolean}`. |
| `GET /projects/:projectId/authority` | bearer | `AuthorityView`. 409 `authority_unavailable` when no accepted goal exists yet. |
| `GET /projects/:projectId/admissions/:requestId` | bearer | The recorded outcome: committed receipt, or `pending` with `outcomeUnknown`. |

**Command:** `task.accept_goal`, request `{protocolVersion, command, input}`. `input` carries `projectId`, `requestId`, `fixtureId`, `goalText`, `requirements[]`, `criteria[]` — the content the human accepted, loaded by B from the fixture manifest. Validation checks shape and bounds only; it never invents or rewrites a criterion.

**Two identities, keep them apart:** `requestId` is a caller-supplied UUID, stable across retries and restarts — the idempotency key. `commandId` remains the M00 per-delivery transport id and has no durability. Reuse the same `requestId` on retry; a new value starts a new admission.

**How the CLI gets the credential:** the backend writes `<dataDirectory>/session.json` with mode `0600` at bootstrap, created with `flag: 'wx'` so it never follows a pre-planted symlink and never overwrites. The CLI reads that file and sends `Authorization: Bearer <token>`. The token is never placed in a URL, a log line, an SSE frame or an event payload. Read it with `readBearerToken` from `@threadline/backend` if you want the same parsing.

**Configuration (new env keys):**

```sh
THREADLINE_STORAGE_MODE=required|unconfigured     # default unconfigured (M00 behaviour)
THREADLINE_PG_HOST THREADLINE_PG_PORT
THREADLINE_PG_DATABASE THREADLINE_PG_USER THREADLINE_PG_PASSWORD
THREADLINE_PG_SSL THREADLINE_PG_CONNECT_TIMEOUT_MS THREADLINE_PG_MAX_CONNECTIONS
THREADLINE_PG_APPLICATION_ROLE
THREADLINE_PG_MIGRATION_USER THREADLINE_PG_MIGRATION_PASSWORD
THREADLINE_FALKORDB_HOST THREADLINE_FALKORDB_PORT
THREADLINE_FALKORDB_USERNAME THREADLINE_FALKORDB_PASSWORD
THREADLINE_FALKORDB_CONNECT_TIMEOUT_MS THREADLINE_FALKORDB_WRITE_TIMEOUT_MS
THREADLINE_TENANT_SLUG THREADLINE_USER_DISPLAY_NAME THREADLINE_PROJECT_SLUG
```

In `unconfigured` mode nothing durable starts and `POST /commands` answers `503 storage_unavailable` for admission — it never falls back to memory. `describeConfig` exposes `passwordConfigured` booleans; a test asserts the real secret never appears in the summary.

**Startup order:** parse config → connect graph → apply/verify schema → assert the tenant fence is enforceable → owner bootstrap → ProjectRoot + ActorRef → indexes and constraints to `OPERATIONAL` → reconcile pending admissions → bind the HTTP port. A failure at any durable step stops the backend; it never serves in a half-ready state.

## 8. Owned paths changed

```
packages/shared/src/admission.ts      new   M01 contracts and guards
packages/shared/src/errors.ts         changed  additive error codes
packages/shared/src/protocol.ts       changed  command registry gains task.accept_goal
packages/shared/src/index.ts          changed  re-exports

packages/backend/src/config.ts        changed  storage configuration, owner/migration roles
packages/backend/src/log.ts           changed  recursive bounded field validation
packages/backend/src/domain/dispatcher.ts   changed  status map, async handlers, authorization context
packages/backend/src/domain/validate.ts     changed  task.accept_goal boundary validation
packages/backend/src/domain/development.ts  changed  registers the admission handler
packages/backend/src/domain/admission.ts    new    guarded admission, reconciliation, authority read
packages/backend/src/domain/services.ts     new    authenticated service surface
packages/backend/src/api/routes.ts    changed  new authenticated routes
packages/backend/src/api/server.ts    changed  wires the new route dependencies
packages/backend/src/index.ts         changed  storage lifecycle, health, exports
packages/backend/src/storage/sql.ts          new  31-table bootstrap + session resolver
packages/backend/src/storage/pg.ts           new  pool, transactions, fence enforcement
packages/backend/src/storage/migrate.ts      new  versioned migration + grants
packages/backend/src/storage/identity.ts     new  bootstrap, sessions, membership
packages/backend/src/storage/inbox.ts        new  durable command inbox
packages/backend/src/storage/graph.ts        new  FalkorDB client + constraint readiness
packages/backend/src/storage/graph-queries.ts new  the actual Cypher
packages/backend/src/storage/digest.ts      new  canonical digest
packages/backend/test/m01-live.test.ts      new  live proof against real stores
packages/backend/test/config.test.ts         changed  storage allowlist and secret assertions
```

## 9. Requests for Agent B

1. **`packages/cli/test/integration.test.mjs` currently fails.** It pins `BACKEND_ROUTES` to the M00 set; the backend now serves six more routes. Update `packages/cli/src/transport/routes.ts` and that assertion. This is the only failing test in the tree and it is in your lane — I did not touch it.
2. **The `.env` password does not match the running Compose container.** `THREADLINE_PG_PASSWORD` in `.env` and `POSTGRES_PASSWORD` on `threadline-local-postgres-1` differ (compared by SHA-256 digest; neither value was printed). Until they agree, `THREADLINE_STORAGE_MODE=required` against the dev stack fails to connect. I used isolated verification containers rather than changing your credential file.
3. **Add the application role** to the documented local setup, per section 5.2. `threadline` is a superuser and the backend now refuses to start on it.
4. **No dependency changes were needed** — `pg ^8.23.1` and `falkordb ^6.8.0` were already present and sufficient.
5. `packages/cli` must not receive `THREADLINE_PG_*` or `THREADLINE_FALKORDB_*`. It only ever holds the owner session token.

## 10. Limitations and blockers

- M01A04 and M01A05 acceptance behaviours are unexecuted (section 3).
- The graph key format `threadline:project:<uuid>` works with the official client but `redis-cli -g` cannot parse it (it splits on `:`). Use the client for graph inspection.
- `SUBJECT_TO` bindings are written by a second statement after the guarded mutation (section 5.1). A crash between the two leaves an unbound task; reconciliation does not currently repair that, and it is listed as an M02 item rather than silently claimed here.
- Granting the application role happens inside the migration. A migration that applies but grants nothing would fail later with an opaque permission error; the role name is validated and a missing role surfaces at startup.
- Only the `TaskState` UNIQUE constraint is enforced among the M01 labels. `Observation` and `Message` uniqueness are deferred to the milestones that create those nodes.
- No model provider, execution, capture outbox, checkpoint, procedure or protected checker exists yet. `Task.current_status` is `ready`, and no completion can be accepted.
- Verification containers `threadline-agentA-pg` and `threadline-agentA-graph` are still running. Remove them when convenient: `docker rm -f threadline-agentA-pg threadline-agentA-graph`.

## 11. Readiness

**The combined tree is not ready for integration.** Agent A's verified lane is complete, but `npm test` has one failing test in Agent B's CLI lane (section 9.1), and M01A04/M01A05 acceptance behaviours remain unexecuted. Neither lane should be merged until B's route update lands and the joint M01J01–J05 checks are run on the combined tree.