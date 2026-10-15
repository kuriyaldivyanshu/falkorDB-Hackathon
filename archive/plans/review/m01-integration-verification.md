# M01 combined integration verification

Verified 15 October 2026 from the combined Agent A/B workspace, based on merged `ed18168` on `main`. Existing dirty documentation and lane work were preserved. This report supersedes the handoffs' unfinished integration claims; it does not claim a Git merge of M01.

## Result and checklist status

M01 implements one human-accepted fixture goal as durable SQL source/inbox and guarded graph authority, inspectable through the authenticated CLI and a plain TUI. Agent A tasks M01A01–A08 and Agent B tasks M01B01–B07 are verified in combination. Joint checks M01J01–J04 passed. M01J05's setup/version documentation is complete; its merge condition remains unchecked until the combined increment goes through the branch/commit/PR workflow.

The accepted task has no execution Run or fabricated provider profile. SQL message `run_id` is NULL and graph `Task.run_id` is absent. Real Run creation remains M02. No inference or paid provider request was made. This does not implement fresh agent continuity, tools, a checker or task completion.

## Environment and isolation

Observed Node v23.11.0, npm 11.4.1, TypeScript 7.0.2, Docker 28.0.4, Compose v2.34.0-desktop.1, PostgreSQL 18.6, FalkorDB 6.0.2/module 60002 on Redis 8.10.2, `pg@8.23.1`, `falkordb@6.8.0`. Node 24 remains unverified.

Independent regression stores used loopback ports 55434/56381 and unique test tenants/private credential directories. A separate real Compose project `threadline-m01-integration` used new named volumes on 55435/56382 for the clean setup/CLI/crash-persistence trace. Neither replaced the development volumes nor Agent A's containers. Verification credentials were kept in private temporary files and never printed or committed.

The normal `threadline-local` setup on 55432/56379 was also checked. Its private `.env` was aligned with its existing PostgreSQL owner credentials, a distinct NOSUPERUSER/NOBYPASSRLS app role was provisioned, and documented backend startup, `init` and readiness inspection succeeded. Existing volumes and provider settings were preserved. No fixture goal was admitted into that ordinary project without user consent; fixture acceptance proofs used isolated test projects.

## Defects reproduced and resolved

1. **Revoked sessions authenticated.** The session resolver ignored `revoked_at`. Additive checksummed migration 2 now excludes revoked sessions and inactive users/tenants/tenant memberships. The original version-1 SQL checksum is unchanged.
2. **Idle expiry never slid.** Authentication now conditionally updates the session deadline to `min(absoluteExpiry, now + configuredIdleWindow)`. Revocation and both stored expiries guard the update; absolute expiry is unchanged.
3. **RLS was decorative under the Compose superuser.** Compose now initializes a migration owner; `npm run db:setup` provisions a separate restricted application role. Startup rejects SUPERUSER/BYPASSRLS app identities. Grants are reapplied on already-migrated stores; application writes to migration bookkeeping are revoked.
4. **Graph authority was incomplete.** The reported created-variable limitation was reproduced on the actual server. A single CREATE clause correctly creates the topology; admission now commits goal/task/source/constraint/criterion/event/receipt bindings together. It does not patch SUBJECT_TO in a second write.
5. **Current authority could not find accepted goals and could silently omit required rules.** Reads now resolve the latest admission and validate exact goal/state/source topology, current-version cardinality and criterion identity/text. Missing constraint provenance/bindings, missing or duplicate required current versions, altered provenance or inaccessible original SQL sources deny authority.
6. **Retry settlement was not idempotent.** SQL settlement now locks and returns an already-matching committed receipt rather than trying another update. Concurrent same-request intent insertion serializes before creating its source/inbox. Fingerprints cover accepted bounds, revision, criterion text and all other accepted fields.
7. **A pre-graph crash could not reconstruct the mutation.** SQL now stores the complete immutable prepared envelope, including graph/source IDs. Startup and explicit retry can commit that exact intent. Lost graph acknowledgements reconcile the stored receipt/event, rather than fabricate a new projection event.
8. **Startup reconciliation errors were swallowed.** Unresolved or quarantined startup work blocks serving; malformed older lane-test envelopes are not guessed into authority. More than 1000 pending admissions fails explicitly.
9. **Bootstrap could select the wrong member.** An added viewer exposed the unrestricted owner lookup. Bootstrap now selects the active local owner, verifies its private file against SQL and refuses duplicate enrollment when existing identities are incomplete. Missing credential recovery/reissue remains explicit operator work.
10. **CLI work was incomplete.** Added real `init`, `admit` and `inspect`, authenticated view reads and result guards, exact route-table agreement, durable exclusive request records, interactive/digest-bound consent, and current task/criteria/source display. Backend-format credential files now work; symlinks and loose permissions are refused. Credential replacement uses an owner-only temporary file and rename.
11. **Initial fixture obligations were wrong.** Initial acceptance previously included the later changed-only case and omitted public rules from the persisted goal. Admission now binds six initial/both cases, all eight public rules and the reviewed manifest digest. The public CSV header is an authored rule, not leaked protected output.
12. **Real process startup differed from factory tests.** The npm workspace entry point did not load root `.env`. It now does, with explicit environment overrides and root-relative paths. Structured logging also rejected safe boolean configuration metadata and previously skipped later secret fields after the first primitive; both are fixed with regression tests.
13. **Transport/health regressions.** Restored rejection of full SSE capacity before hijacking the response; mapped typed authenticated-read failures to proper HTTP errors; validated UUID route parameters; kept SSE `replayable=false`; refreshed required-store checks and separated data-store readiness from absent future provider/checker components. Fixed startup/stop-state and failed-bind store cleanup regressions.

## Executed evidence

`npm test` builds sources before executing the backend and CLI suites. The final live run enables all store cases: 63 backend tests plus 31 CLI tests, with zero failures or skips. The ordinary run passes 83 cases and explicitly skips 11 live-store cases; it does not count skipped cases as passing.

The [captured final test output](m01-test-results.txt) records the actual run.

The committed live regressions are in `packages/backend/test/m01-live.test.ts` and `packages/cli/test/m01-live.test.mjs`. They verify real DDL/migrations, restart identity, exact receipt replay, payload conflict, anonymous/bad-token rejection, viewer write denial, restricted-role tenant fencing, session revocation, sliding idle/absolute expiry, unauthorized project/source access, missing/duplicate current versions and bindings, concurrent same-request delivery, lost-ACK resolution, pre-graph-crash recovery, and actual child CLI acceptance/inspection/restart. Lost acknowledgements/crashes are injected at the graph transport boundary while PostgreSQL and FalkorDB are real; they are not claimed as arbitrary network-fault coverage.

The separate clean Compose trace executed:

1. Create fresh named PostgreSQL/FalkorDB volumes with the actual revised Compose file.
2. Provision a distinct app role through the shipped setup entry point; start the real backend with structured logging.
3. Run actual `init`; refuse missing/mismatched acceptance; explicitly accept the reviewed fixture digest; inspect the accepted task/source/criteria and exact request receipt; retry the same local record.
4. Directly inspect SQL: 31 tables, 27 RLS-enabled, one committed inbox row for that request, full accepted source/envelope, event sequence 1. Inspect current authority from graph-backed reads.
5. Restart backend; read the same task/source IDs.
6. SIGKILL both isolated Compose stores; restart without removing volumes. Read the same owner session, original SQL source, receipt and graph authority.
7. Launch the actual TUI in a PTY: see connected backend, current task/constraint/six criteria/source IDs; Esc exits with code 0 and restores cursor/terminal state.

Ordinary transport regression also performs 25 real CLI echo exchanges, capacity rejection, connection failure and subscriber cleanup. Echo stays explicitly development-only.

## Limits and next action

This is M01 acceptance storage, not the finished hackathon product. No provider/tool execution, run scheduling, agent spawning, summarization API, RLM, OAuth, protected checker or completion is included. Docker/Node release digests, Node 24 and non-POSIX delivery remain unverified later gates. The amended checkpoint Cypher is still a reference sketch, not an executed M02 checkpoint implementation.

There is no automatic recovery/reissue for a lost or expired owner credential, and no automatic upgrade of malformed pre-integration test receipts. Preserve credentials with store backups. Broad outage/load/chaos recovery belongs to later gates; the tests above establish only their stated boundaries.

The code/checklists are prepared for the combined M01 branch/commit/PR workflow. No branch, staging, commit, push or merge was performed during this verification turn.

Temporary verification services were stopped after the final run; their data/volumes were retained. The pre-existing development services and Agent A containers were left untouched. The backend started for the local setup smoke test was shut down cleanly.
