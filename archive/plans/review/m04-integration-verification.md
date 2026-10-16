# M04 checkpoint integration verification

Verified 16 October 2026 from merged M03 base `a2fe8a2`. M04 is integrated locally; no branch, staging, commit or push was performed. The controlling scope is [M04 in the master checklist](../track2-implementation-checklist.md#m04--structured-checkpoints-and-tactical-state), [the blueprint](../track2-development-blueprint.md), [checkpoint schema](../contracts/memory-checkpoint.schema.json), [episode schema](../contracts/memory-episode.schema.json) and [development profile](../contracts/development-profile.json).

## Implemented behavior

`services.checkpoints()` is the shared authority for HTTP callers, model tools and deterministic recovery. The runtime advertises seven tools: the three workspace reads, source-mode `memory.retrieve`, `memory.checkpoint`, `task.update_plan` and `memory.refresh`. Unknown tools and model overrides of authority/coverage fields are refused. The runtime instruction in `packages/backend/src/runtime/managed.ts` directs versioned updates through refresh; plans and prose remain proposals, and a completed checklist is not task verification.

Manifests retain exact immutable bytes, graph TaskState revision, requirement revision and distinct per-session coverage. `CheckpointPointerView.checkpointRevision` is a separate decimal counter. Candidate/environment identities remain null when no trusted snapshot establishes them. Model-authored narrative remains attributed as an agent proposal when carried through automatic checkpoints.

Real SQL and graph Run/AgentSession bindings are required. A newer run prevents an older run from publishing over its task memory; an unreconciled epoch change refuses publication. A task advisory lock covers policy evaluation, read/merge/staging/publication and claim release. This fixes both lost concurrent patches and the startup race in which an automatic poll could publish an unnecessary second initial checkpoint. New immutable TaskStates preserve the current ownership fence/requirements; claim release preserves the checkpoint edge. Guards follow checkpoint-only revisions while still checking epoch, fence, requirement, owner and lease.

SQL publication begins pending. One guarded FalkorDB mutation commits the immutable state, exact manifest Source, CHECKPOINT_SOURCE edge, project-sequenced Event and digest-bound receipt. An acknowledgement lost after that mutation yields ambiguous, retains the previous committed pointer and reconciles the receipt. Definitively refused writes are recorded separately. Additive PostgreSQL [migrations 4–6](../../../packages/backend/src/storage/migrate.ts) preserve versions 1–3; the new checkpoint tables use forced tenant RLS.

Coverage advances only through contiguous admitted positions in each task/run session stream. Later successful delivery cannot bridge an earlier pending capture. Required original artifacts are read and verified before coverage advances. Four streams represent the initial session and three permitted replacements; this milestone validates the representation, not successor launching.

Terminal observations generate schema-validated episode artifacts with original evidence Sources. Observed status comes from immutable captures; mutable execution rows supply current unresolved effects separately. Missing exit codes, affected-path sets or environment identities remain unknown. Unknown effects survive unrelated patches until observed reconciliation resolves them.

The worker checkpoints failure/unknown boundaries and coalesces other meaningful observations until five accumulate. Checkpoint publication is not a capture trigger. Initial accepted admission remains durable in M01's ledger; before a run exists, inspection reports awaiting_run_binding rather than inventing an identity. The first real run creates the initial checkpoint. Existing requirement-change and future mutation/command/handoff trigger seams are explicit; M06/M07 producers remain future work.

Recovery scans task/run-specific tails in pages of at most 100, processes at most 1,000 records and reads one additional sentinel only to detect overflow. It never compares capture sequences from different sessions. Pending admission, unavailable bytes, open/unrecoverable gaps and overflow are visible; critical pending coverage and unsafe recovery block dependent inference. Recovery makes no model request.

## Working commands

Use [local setup](../../../docs/local-development.md), existing admission and [run setup](../../../docs/m02-development.md). The commands below inspect or update memory and do not start inference:

```sh
npm run build
node packages/cli/dist/index.js tactical:inspect --project <project-id> --task <task-id>
node packages/cli/dist/index.js tactical:checkpoint --project <project-id> --task <task-id> --run <run-id> --base-revision <checkpoint-revision> --progress "Inspected exporter" --next-action "Investigate timestamp comparison" --request-record .threadline/checkpoint-inspection.json
node packages/cli/dist/index.js tactical:plan --project <project-id> --task <task-id> --run <run-id> --base-revision <checkpoint-revision> --step 'inspect:in_progress=Inspect exporter' --request-record .threadline/plan-inspection.json
node packages/cli/dist/index.js source:read <checkpoint-source-id> --project <project-id> --offset 0 --max-bytes 32768
node packages/cli/dist/index.js tui
```

In the TUI, `/tactical` or `/refresh` resolves the accepted task automatically. It shows progress, next action, plan, recent outcomes, Source links, pending replacement and blockers. `/source <id>` inspects evidence. Mutations are available through the model tools or scriptable CLI. A rejected stale update shows current revision and retry guidance.

The default tactical retry record is `.threadline/checkpoint.json`, separate from admission. Use a distinct record for each new logical mutation; retry unchanged input with the same record. A changed payload refuses replacement. Records are owner-only, synced and published without overwriting another process's winner. Corrupt, unreadable or symlink records refuse new identities. Pending/ambiguous operations retain their IDs and must be reconciled rather than submitted under fresh IDs.

Backend routes are POST `/projects/:projectId/tasks/:taskId/checkpoints`, GET `.../checkpoints/current` and POST `.../checkpoints/recover`. Recover's `limit` controls page size, not permission to skip the total tail bound. Scope is resolved from the authenticated caller and verified run binding.

## Executed evidence

Build passes. Temporary verification stayed outside the repository; permanent test directories and npm test scripts were not recreated.

- 94 focused cases: 20 schema/semantic fixtures, 32 tool-boundary/dispatch cases, 17 HTTP-route cases, 16 CLI transport/record cases, five intent/result-capture failure cases and four atomic-record/concurrency/filesystem cases.
- 26 real-store/terminal scenarios: seven publication/replay/concurrency/receipt cases, seven production-tool/episode/restart/coverage cases, eight policy/isolation/overflow cases and three terminal/CLI scenarios and one real second-run binding scenario. Final focused runs passed with no gated scenarios.
- Real admission, provider/profile/workspace registration and run start used the production routes with an explicitly injected provider. No provider/profile/session identity was fabricated for the bound-run flow. Additional registered sessions and diagnostic observations were synthetic boundary fixtures, not launched successor agents or executed shell commands.
- Lost graph acknowledgement, graph outage, an injected failure immediately after durable diagnostic capture, restart before a voluntary checkpoint, unavailable original bytes, stale patches, epoch mismatch and a real 1,001-record overflow tail were exercised.
- Real PTYs displayed ready and pending-replacement states, resolved task scope without flags, excluded the exact session token and exited with code zero on Esc. A real CLI stale mutation returned failure with revision/retry guidance.
- Verification used Node v23.11.0, npm 11.4.1, PostgreSQL 18.6 and FalkorDB 6.0.2 in the existing isolated Agent B containers. Development Compose volumes were untouched.

The temporary drivers were `/tmp/opencode/m04/validate.mjs`, `/tmp/m04b/{verify,checkpoint-routes,cli-transport,identity-and-capture}.mjs` and `/tmp/m04-{record,accept,recovery,policy,pty,run-binding}.mjs`. They are local evidence tools, not shipped commands or permanent repository dependencies.

## Scope limits

M05 relevance selection/context packets, M06 mutating execution/containment, M07 real successor lifecycle and human requirement-change orchestration, and M08 protected completion remain unimplemented. Future trigger seams were tested with authored observations. Checkpoint refresh does not acknowledge loading a new model context. New seven-tool compatibility was not tested with a paid/live provider; earlier M02 Space Bunny evidence remains scoped to that milestone. Node 24, load guarantees, artifact garbage collection and release packaging remain later validation work.
