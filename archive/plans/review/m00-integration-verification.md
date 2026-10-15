# M00 independent integration verification

**15 October 2026. Verified against the combined working tree on `main` (reported baseline `91f8af4`).** This is M00 scaffold evidence only. No database, model/API inference, memory continuity, sandboxed coding tool or protected completion claim is established here. No branch, staging, commit, push or merge was performed in this verification pass.

## Verdict and checkpoint status

- **Verified complete:** M00A01–M00A07 and M00B01–M00B07, reconciled in both lane views and the master checklist.
- **Verified complete:** M00J01 (actual backend/CLI/TUI exchange), M00J02 (build, boundaries and shutdown), M00J03 (working-tree/generated-file/credential-pattern review and preservation of unrelated changes).
- **Pending:** M00J04's combined branch/commit workflow. Shared types and matching routes were reviewed and compiling mismatches resolved; actual Git workflow remains a separate step.

Use [master checklist](../track2-implementation-checklist.md), [Agent A](../track2-agent-a-checklist.md) and [Agent B](../track2-agent-b-checklist.md). Active plans remain in `archive/plans` by explicit user choice. The `.gitignore` now permits this directory and relocated historical `archive/notes`; reference source-code archives remain ignored. Links were adjusted for relocation. These paths are eligible to stage; no existing index entries were rewritten here.

## Actual verification

The observed environment was Node **v23.11.0**, npm **11.4.1**, TypeScript **7.0.2**, Fastify **5.12.7**, Ink **8.0.0** and React **19.3.1**. Node 24 remains the planned target and has not been validated in this pass; the package engine range is not evidence of every listed Node version working.

- `npm run build` passed for all three workspaces with strict TypeScript. Backend configuration explicitly includes both `src/**/*.ts` and `test/**/*.ts` in the build.
- Original `npm test --workspace @threadline/backend` passed **47/47** and exited normally. The reported lingering test handle was not reproduced. The initial restricted execution could not bind loopback ports (`EPERM`); the authorized local-port rerun passed.
- After the fixes below, root `npm test` built the workspace and passed **49 backend tests plus 5 CLI tests**, exiting normally. Root test delegates to real workspace tests; no forced exit was added.
- CLI integration spawned the actual built CLI for health, **25 sequential correlated echo exchanges** with a one-listener backend cap, invalid-input rejection, and connection refusal after shutdown. Each echo carried the same command ID in acknowledgement and event; subscribers returned to zero. A concurrent extra stream received **503** while the existing stream stayed valid.
- Backend tests exercised a single oversized event and, separately, multiple small writes under forced socket backpressure. The latter is a deterministic response/write seam test, not a network capacity benchmark.
- A real pseudo-terminal drove the TUI: connect, text input, Enter, actual acknowledgement/event and Esc. Esc exited **0**, with canonical mode/echo restored. A second session observed graceful backend shutdown, reconnect/disconnected status and retry guidance, then exited cleanly. Backend SIGTERM exited **0**.
- An invalid backend configuration exited **2** without reflecting the submitted probe value.
- `npm ls --depth=0` reported a resolved workspace/dependency tree. Backend and CLI route maps match `/healthz`, `/commands` and `/events`; `/v1` endpoints are not implemented in M00.
- Reviewed imports: shared contains no database/provider/transport clients; backend domain modules do not import Fastify; CLI does not contain database/provider credentials or clients. CLI activity and backend listener/backlog bounds are explicit.
- `git diff --check` passed. Targeted secret-pattern checks over source/config/plans found no candidate private keys or API/access-key patterns. This is a limited pattern check, not a claim that arbitrary sensitive content is automatically detected.

The PTY probe used ordinary text and Enter as separate keyboard events and drained output during shutdown, as a real terminal does. Its early probe failures were corrected observation/harness issues, not product test passes. No database/provider was contacted for this work.

## Defects reproduced and corrected during review

**Fragmented SSE parsing.** The original decoder treated a fetch chunk as a complete line and a trailing chunk boundary as an event separator. A split JSON data line produced invalid JSON; one-character/CRLF chunks also failed. It now retains unfinished lines, dispatches only real blank-line boundaries and enforces a frame-buffer cap. Regression tests enumerate every split position and cover character-wise chunks, CRLF, multiple frames and partial-input reset.

**Subscription-before-command race.** Starting the event fetch first did not prove the no-replay backend had subscribed before POST dispatch. A delayed-handshake fixture reproduced command dispatch before subscription. Stream handles now expose resolved readiness; echo awaits it, the TUI marks connected only after readiness, and the handshake is timed/bounded. The regression passes without adding replay or persistence claims.

**Subscriber-capacity response.** The original server sent 200/SSE headers before attempting to reserve publisher capacity. When full, it could no longer reject cleanly. Capacity is now reserved before headers; the route responds 503 before hijacking on capacity/closed-publisher failure. Tests cover untouched headers and an actual extra HTTP connection.

**Terminal signal cleanup.** The TUI now removes its own SIGINT/SIGTERM listeners when unmounted. Real PTY exit and terminal restoration passed.

## Files and limits of completion

Changes include the SSE decoder/readiness consumers, backend stream admission/route handling, focused CLI/backend regression tests, root/CLI test scripts, tracking exclusions/links and verified checklist status. Dependency versions were not changed and the existing generated lockfile was retained.

The existing index still contains previously staged `plans/*` entries while the working files live under `archive/plans`; historical `notes/*` were also relocated before this pass. At the actual branch/commit step, deliberately stage the chosen relocations/removals and new paths together, review the index and preserve unrelated changes. A bare commit of the old index would not capture this verified working tree. No reset, forced checkout, blanket staging or destructive cleanup was used to hide that discrepancy.

M00 is process-local and development-only. Nothing here proves persistence, replay, safe repository execution, subscription integration or cross-session memory. Continue to M01 only under the checklist's integration/merge procedure; the pending Git step is not silently marked complete.

## Subsequent Git integration

The user subsequently pushed/merged PR #1 with review resolutions. The local checkout inspected for M01 prompt preparation is `main` at merge commit `ed18168`, containing `13b17a2`. This closes the formerly pending M00J04 Git integration step. The execution evidence above describes the earlier independent verification snapshot; review resolutions changed lifecycle/health/frame-error behavior, so the M01 agents must rerun the current baseline before claiming it passes. No M01 implementation or additional product test was performed while preparing these prompts.
