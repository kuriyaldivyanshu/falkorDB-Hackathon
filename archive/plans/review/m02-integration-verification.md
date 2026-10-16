# M02 independent integration verification

**Repository cleanup — 16 October 2026:** permanent package test suites and npm test scripts were later removed at the user's request. Test counts and commands below record earlier verification, not currently available suites.

**Final status — 16 October 2026:** M02 is complete within the user-approved API-key provider scope. All checklist gates are verified; the actual Space Bunny model/read-tool/next-turn/final-response test passed. Final regressions: 224 ordinary tests and 34 real-store cases. [Live evidence, repaired defects and failed-run accounting](../../../docs/m02-live-acceptance.md). The original local-only snapshots below retain their historical results and deferrals. No Git integration step was performed.

Verified locally on 16 October 2026, from merged M01 base `067f842` on `main`. Agent A/B changes and the pre-existing dirty documentation were retained. No branch, stage, commit, push or paid inference was performed during integration.

**Subsequent user-authorized provider extension:** one minimal real OpenCode Go / Space Bunny text request succeeded. Selectable API-key providers and Chat Completions now share the existing journal/tool loop. Follow-up verification passes 222 ordinary tests and 34 real-store cases with synthetic inference. [Provider configuration, exact smoke-test evidence and remaining limits](../../../docs/provider-configuration.md). The original 212/33 results below record the preceding M02 integration snapshot; no OpenAI or full live Go tool-loop gate is claimed by the text test.

## Result and checklist status

The authorized local M02 implementation is integrated: real stores → authenticated run admission → guarded exact-byte journal → explicitly injected provider → registered candidate read → durable result → rebuilt next input → terminal output. The actual CLI prepares real identities; a real PTY displays private activity and exits on Esc with code 0. A successful model run releases the task to `ready`, without accepting protected completion.

M02A01–A07, M02B02–B08, M02J01 and M02J03–J05 have local verification evidence. M02B01's transport implementation passes, but its complete task explicitly requires an account-compatible chosen model: that checkbox and M02J02 remain unchecked because the user deferred the paid account/model test. There is no claim that a real OpenAI model has run successfully.

## Executed verification

- `npm run build`: passed, TypeScript 7.0.2.
- `npm test`: backend 167 passed / 0 failed / 33 opt-in live cases skipped; CLI 45 passed / 0 failed / 1 existing opt-in case skipped. Total 212 passing; skipped cases are not counted as passing.
- Explicit live test run: **33 passed, 0 failed, 0 skipped**, consisting of M01 regression 10, M02 authority/journal 13, assembled/public-runtime 10.
- `git diff --check`: passed after documentation cleanup.

Runtime: Node v23.11.0, npm 11.4.1, PostgreSQL 18.6, FalkorDB 6.0.2. Verification used the existing isolated Agent B containers on loopback PostgreSQL 55434 and graph 56381, with the non-owner `threadline_app` database role and separate migration identity. Credentials were passed privately through environment variables; none are recorded here. No development volumes were reset or dropped. Live cases use unique tenant/data namespaces, and no longer delete an arbitrary configured data directory before running.

To reproduce against explicitly configured verification stores, set the documented `THREADLINE_LIVE_*` variables privately and run:

```sh
npm run build
THREADLINE_LIVE=1 node --test \
  packages/backend/dist/test/m01-live.test.js \
  packages/backend/dist/test/m02-execution-live.test.js \
  packages/backend/dist/test/m02-assembled-live.test.js
```

The assembled test injects `runtimeDriver` through the backend constructor. No environment setting, route parameter or missing credential selects this provider in production. Ordinary transport tests inject `fetchImpl`; neither test approach calls OpenAI. The PTY subcheck uses Python's standard-library PTY allocation on macOS, with an environment allowlist rather than forwarding verification-store credentials to the CLI.

## Observed acceptance paths

The assembled flow reads the real authored exporter candidate, verifies saved input bytes equal the transmitted body, inspects two separate physical attempt IDs, reads the response artifact and observed usage, and uses the persisted tool output in the next request. Partial terminal batches release no tool, unknown outcomes retain a reservation, unsupported tool names cause no workspace access, and missing/inconsistent history blocks another turn.

The public API proof covers preparation without inference; successful start; durable inspection; exact start replay without another dispatch; changed-input conflict; and missing graph receipt producing accepted/pending rather than fabricated success. A real CLI `run:prepare` returns actual profile/workspace/task/request IDs. The real PTY subscribes before execution, renders model/tool activity without its credential, and exits on Esc.

A hanging injected provider proves heartbeat extends the graph's operational session lease without moving the worker fence. Explicit cancellation aborts the local driver, records cancelled/uncertain usage honestly, retains its durable reservation and sends no retry. SQL and graph connection closure each cause HTTP 503 before provider dispatch. Anonymous SSE subscribers receive no private run output; authenticated delivery rechecks live session and project authority.

Authority cases prove owner mismatch, revoked initiating session, removed membership, expired lease, changed source bytes, undeclared context capacity and digest mismatch all deny release. Human command admission and provider/tool intent admission share a transaction-scoped project lock. M01 live tests continue to prove RLS isolation, credential expiry/revocation, source access, lost-ACK reconciliation and idempotent admission.

## Defects repaired during integration

- Isolated the assembled harness's tenant/data directories; its previous shared owner credential blocked bootstrap before runtime verification.
- Corrected physical attempt inspection, which exposed `logical_request_id` as `attemptId` and broke artifact lookup.
- Read usage from the actual ledger instead of guessing from attempt status. Persisted explicit possible-charge and reservation facts with additive migration 3; migrations 1/2 remain unchanged. Legacy unknown facts remain nullable.
- Replaced the impossible `precision='reserved'` query with durable reservation accounting. Reserved output now matches the exact request ceiling. Input reservation uses the whole serialized body plus framing allowance, rather than a fixed 1000-token guess or optimistic bytes/2.
- Bound standing authority to the actual initiating human session in the immutable authorization manifest. Verified profile configuration against its digest and repeated authority checks inside the human/worker admission lock.
- Registered the run routes, resolved workspace paths from trusted SQL registrations, connected the real TurnGuard to the loop and made backend shutdown abort/drain its owned loop before closing stores.
- Made complete terminal output and results reconstruct the next request from durable artifacts; a tool intent must belong to the complete released batch.
- Repaired task-current-state replacement, source/goal reads after a task claim, operational lease renewal, graph run/session release and durable inspection of real fences/revisions/deadlines.
- Persisted the start request ID and full authorization binding, validated exact retries against SQL and graph receipts, and prevented receipt loss from causing automatic redispatch.
- Scoped private activity to an authenticated tenant/project on every delivery and kept pending authorization work bounded.
- Added scriptable CLI preparation, readable correlated errors and runtime activity in the existing plain TUI. Ignored credential-bearing scratch directories from all lanes, including stale copies.

## Remaining deliberate limitations

Paid model/account compatibility is unverified; no model has been selected for that gate. This transport rejects hidden reasoning/unsupported continuation items, so local fixtures do not prove compatibility with every Responses model. Profile capacity is explicitly declared; conservative reservation is not measured token usage or proof of a provider's capacity.

There is no automatic restart/resume or general operator reconciliation for an uncertain dispatched attempt. Such work remains visibly blocked and is never resent automatically. The M02 runtime is one owned local worker, not a multi-backend authority or an effectful sandbox. General capture/projection, memory continuity, effectful tools, protected completion, release pinning and broader portability remain later milestones. Node 24 compatibility was not tested; no Node 24 binary was available at the checked Homebrew location.

The reference schemas/dictionaries and SQL/graph Mermaid sources include migration-3 facts and the operational session lease. Future checkpoint Cypher sketches remain explicitly unexecuted; the canonical M01/M02 tested queries are in `packages/backend/src/storage/graph-queries.ts`. No external Figma file was modified during this code integration.

## PR review corrections — 16 October 2026

The nine supplied actionable comments were resolved. Run heartbeat and cancellation require both current project membership and initiating-user ownership, verified through another authenticated tenant user's real HTTP requests. A definite zero-row graph refusal closes its SQL run/session and remains a refusal on retry; thrown/ambiguous graph failures retain reconciliation behavior. Confirmed claims persist `active`, including receipt-based reconciliation, without reopening finished runs. Inspection reports the actual unresolved-attempt count from one count query.

SSE coalesces only adjacent text hints for the identical tenant/project/session/run, bounds its authorization queue by frames and bytes, preserves FIFO lifecycle delivery, and rechecks permission for every private delivered frame. No positive permission TTL is cached. A 200-chunk burst preserves text and event order; a subsequent revoked delivery is denied.

Preparation derives its minimum context window from the current output ceiling; full request-fit checks still run before dispatch. Candidate traversal rechecks a directory immediately before recursion and refuses a directory swapped for a symlink after listing. This is observed-change detection, not an OS sandbox. Typed unknown-run 404s retain their message and correlation ID; framework route 404s retain the distinct fail-closed message. Provider documentation lists all three supported wire APIs.

Verification: build passed; 31 affected candidate/SSE/CLI tests passed; 30 affected M02 execution/managed real-store cases passed. The new reproductions failed before fixes for the claim leak, unauthorized lease renewal, incorrect active-state reporting, undersized context admission, SSE burst closure and masked typed 404. No unrelated full-suite rerun, paid inference or development-store reset was performed. The review header mentioned two additional nitpicks whose text was not supplied; those are not claimed as reviewed here.
