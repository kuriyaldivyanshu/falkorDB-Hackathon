# M03 integration verification

Verified 16 October 2026 from merged M02 base `d09f35e`, on `main` with both agents' uncommitted work preserved. M03 is integrated and locally verified; this report supersedes the intermediate blocked lane handoffs. No branch, commit, push or paid-provider call was performed. M04 remains unstarted.

## Implemented result

The production managed runtime captures exact request references, visible partial bytes, complete permitted model output and tool intent/result. The original M02 journal remains authoritative for physical attempts and usage. Critical SQL capture failure blocks dependent dispatch; partial output cannot release a tool batch. Tool results gain a derived `evidenceSourceId` in reconstructed model input without altering their archived original bytes.

The backend explicitly starts/stops a scoped capture worker. Capture/outbox commit together, leases and retries are bounded, and ambiguous writes reconcile digest/epoch-bound receipts. FalkorDB atomically records Source/Message/Observation/Attempt provenance, task-bound Attempt relationships, Event and receipt. Diagnostic episodes record observed failure/unknown facts without inventing a cause or introducing executable commands.

SQL projection writes its contiguous offset with its rows. Authenticated source ranges and durable history pages/SSE work through the actual application. The TUI follows durable cursors and shows pending admission, available/missing Sources, partial ranges and explicit gaps independently of task completion. Existing process-local activity remains a separate stream.

[Working commands and boundaries](../../../docs/m03-development.md) and [implemented capture flow](../diagrams/m03-capture-flow.mmd) describe the delivered slice. Existing core tables were sufficient; no dependency or migration change was required.

## Repairs made during integration

- Replaced malformed deterministic graph UUIDs and a non-UUID projection-offset ID. Typed, bound scalar graph properties now execute on FalkorDB 6.0.2.
- Fixed numeric replay ordering: casting `event_seq` to text in SELECT made unqualified ORDER BY return `1, 10, 11, …, 2`. The assembled trace passes beyond event 9.
- Compared receipt digests/epochs at reconciliation, validated captured payload digests before admission, and consolidated the worker's receipt reconciliation through the shared reconciler. An absent receipt remains unresolved, not proof that an in-flight write stopped.
- Serialized capture deduplication and sequence allocation under the session lock. Completeness/references/correlation are included in the canonical stored digest. Concurrent same-key appends preserve one position; changed content conflicts.
- Wired the previously unconsumed provider adapter, real fourth tool, capture worker, source routes and durable replay transport into production composition. Tool result capture is now an actual durable boundary.
- Reused original journal/tool artifacts rather than publishing another copy for each capture reference. Partial visible chunks preserve their actual bytes.
- Fixed chunk drain/timeout handling, global pending/in-flight accounting and bounded stream creation. Failed/timed-out partial capture blocks terminal evidence instead of silently disappearing.
- Measured the actual complete serialized model-tool envelope, including metadata and base64. The shared derived original-byte allowance is currently 24,285; inspection remains 32,768 original bytes. Consumers import the helper, and whole-request budgeting uses actual serialized input.
- Source inspection verifies bytes rather than trusting an available row. Reads slice the verified buffer itself. Missing/corrupt bytes fail closed; scoped private denial and revoked membership/session checks remain effective.
- Fixed concurrent artifact publication so a losing publisher cannot delete the winner's bytes. Failed/ambiguous SQL acknowledgement retains immutable orphan files for reconciliation; cleanup does not destroy possibly referenced evidence.
- Added a separate SQL-backed durable SSE stream with per-delivery authorization, bounded backlog, explicit gaps and Last-Event-ID reconnect. A single missing position is a gap. Slow-consumer shutdown is exercised independently of ordinary process-local SSE.

## Observed acceptance evidence

Environment: Node `v23.11.0`, npm `11.4.1`; existing isolated PostgreSQL 18.6 and FalkorDB 6.0.2 verification containers. Application connections use the non-owner role with tenant RLS; migration identity remains separate. Every live case creates its own tenant/data directory. Development volumes were not reset or removed. Provider fixtures are explicitly injected; no account probe, model selection or external inference occurred.

Verification was targeted, not repeated full `npm test` runs:

- `npm run build`: passes after final code changes.
- Affected module/API/CLI regression set: **155 passed, zero failed/cancelled/skipped**. This includes capture/provider/chunk/source/loop/route/history-stream tests, CLI source/reconnect reducers and affected backend lifecycle/API/CLI integration.
- Broad real-store acceptance plus PTY and affected M02 authority/runtime regressions: **76 passed, zero failed/cancelled/skipped**. This includes concurrent artifact publication and the actual model → workspace read → source retrieval → next model → final-report path.
- After adding the graph-outage case and real client reconnect check, the affected assembled/PTY subset passed **10/10**. This adds one new case, yielding **77 distinct real-store/PTY cases across these acceptance runs**, rather than counting rerun cases twice.
- After consolidating reconciliation, the two affected restart/outage cases passed **2/2**. The final duplicate-delivery graph cardinality assertion passed **1/1**. No unrelated suite was repeated for those changes.

The initial sandbox denied local socket binds for API tests (`EPERM`). Those tests were rerun with local socket access and passed; it was an environment restriction, not a hidden application failure.

### Joint checkpoints

- **M03J01:** five concurrent identical deliveries return one capture position, changed content conflicts, one replay Event is observed, and direct FalkorDB reads find one task-bound Attempt/Observation episode and one original Source relationship. The graph receipt replay test also rejects a changed digest.
- **M03J02:** pause the worker after SQL commit, restart the backend, and observe committed delivery. Separately commit the graph write but lose its acknowledgement, persist quarantine, restart and reconcile its receipt. Original inference dispatch count remains one. Failing the actual projection transaction at its offset INSERT rolls back the already-inserted projection rows.
- **M03J03:** remove a case-owned artifact, then inspect/read through authenticated HTTP and the model retrieval port. Missing content is unavailable, never successful empty bytes. Same-length digest corruption and cross-scope/private denial also pass.
- **M03J04:** a persisted cursor survives backend restart and catches a newly admitted event. Revoking the session stops the open stream. A real CLI SourceClient connection is cut after delivered evidence and reconnects with its last nonzero durable ID, retaining strict numeric order. In a real PTY, the TUI renders a genuine deleted-projection gap and exits cleanly. Unit checks prove per-frame authorization, slow-socket closure and oversized-frame gap reporting.
- **M03J05:** the production injected-provider trace advertises all four tools, performs workspace read and Source retrieval through the real guard, persists their evidence and reconstructs the next requests. Stored submitted bytes compare exactly with prepared/transmitted fixture bodies; original output bytes are inspected through Source ranges. The synthetic provider credential does not enter the captured evidence. Injected capture-INSERT failure after request preparation produces zero provider dispatches/tools. A real graph connection outage preserves pending SQL evidence and recovers after restart without another inference.

## Post-verification repository cleanup

After the acceptance runs above, the user requested removal of permanent backend/CLI/shared test suites and obsolete handoff notes before committing. The package test directories, helpers, generated test output and npm test scripts were removed. Backend compilation now includes only runtime source. Historical pass counts remain evidence of the earlier execution; the suite is no longer present or runnable in this checkout.

Post-cleanup validation passed: `npm run build -- --force`, CLI help, a temporary loopback backend with real CLI health and correlated echo, and clean backend shutdown. The smoke check created no repository script, opened no database and made no provider request. Current validation uses `npm run build` plus focused manual runtime checks. [Working commands](../../../docs/m03-development.md) describe Source/history inspection. No test-only API or runtime module was removed, and the authored fixture remains required application data. The redundant M00/M01/M02 handoff notes and two superseded M02 lane documents were removed; setup/provider guides and architecture plans remain.

## Remaining product boundaries

No M03 functional checkpoint remains open. Git publication is a separate next action. M04 checkpoints, M05 retrieval/context construction, executable containment, successor continuity, protected completion, subscription/OAuth adapters and additional paid-account compatibility are not delivered by this milestone. Model Source retrieval stays project-safe; private-content propagation into subsequent model journals is deliberately not advertised. Artifact garbage collection, host-power-loss durability and Node 24 compatibility are not claimed.
