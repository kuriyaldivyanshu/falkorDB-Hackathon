# M02 live model and read-tool acceptance

**Repository cleanup — 16 October 2026:** permanent package test suites and npm test scripts were later removed at the user's request. Test counts and commands below record earlier verification, not currently available suites.

Verified 16 October 2026. The user explicitly requested completing M02 and selected their OpenCode Go account and `space-bunny` model for testing. All M02 A/B/joint checkpoints are now verified within that approved scope. OpenAI Responses remains implemented and fixture-tested; live OpenAI account access and subscription/OAuth support are not claimed. No branch, commit or push was performed.

## Passing run

Run `a5272d65-cbf2-4526-a334-35d159cf23a0` used the production backend, real PostgreSQL/FalkorDB, authenticated CLI admission, real streamed inference and real read-only workspace tools. Endpoint: `https://opencode.ai/inference/go/openai/v1/chat/completions`. No injected provider was used for this acceptance.

The run completed three physical requests:

1. Input 1,040 tokens; output 43. Model requested `workspace_inspect`, which listed `src/exporter.mjs`.
2. Input 1,129; output 59. Model requested `workspace_read` with offset 0 and maximum 32,768 bytes. The tool returned the entire 2,744-byte authored file without truncation.
3. Input 2,176; output 3,598. Model received the saved tool result and returned a terminal report identifying the deliberate UTC-normalization defect at line 47.

Total provider-reported usage: **4,345 input + 3,700 output = 8,045 tokens**. Monetary cost was not reported and is not fabricated. The final run is `completed`, session `stopped`, claim `released`; task revision 13/fence 12, zero unresolved attempts and zero retained token reservation. Every physical request is `completed`; provider request headers supplied no request ID, so none is invented.

A separate SQL/artifact inspection verified the request digests against the exact stored request bytes, read every response/tool artifact through the digest-checking artifact reader, and compared the successful file-read text byte-for-byte against the original authored seed. File SHA-256: `e792e8500d75de8e1fa2a449b24b43471aad4460abfce35288276692056caa66`. Submitted chat histories grew from 1 to 3 to 5 messages as tool calls/results were reconstructed. No hidden reasoning or authorization headers were stored in those artifacts. Provider-reported output usage may include content that is not retained as visible text.

The report is advisory. It also suggested changes that conflict with the accepted supported-timestamp profile and the allowed 0–3600 requirement bounds; those suggestions are not accepted facts. Successful runtime execution is not task correctness or protected completion, which remains M08.

Read the stored run without triggering inference:

```sh
node packages/cli/dist/index.js run:inspect a5272d65-cbf2-4526-a334-35d159cf23a0
```

## Defects and environment findings resolved

The real process uses a structured logger, while earlier assembled tests used a silent logger. After SQL preparation committed, logging numeric `reservedTokens`/`estimatedInputTokens` incorrectly threw a credential-field error. The logger now permits exactly those nonnegative safe-integer counter fields; secret-bearing strings, invalid numbers and arbitrary token fields remain rejected. A regression reproduced the exception before the fix. The Go real-store conformance test now uses the production logger.

The first attempt was proven never dispatched: `prepared`, `possible_charge=false`, null dispatch timestamp, and a deterministic exception before the transport call. With the worker stopped, its existing journal settled it as failed with known-zero usage, and its graph claim was released. The failed row remains in history; it was not deleted or resent.

Desktop sync created additional hard links to copied candidate files. The reader correctly refused these files; an initial model run completed but saw an empty eligible inventory. Acceptance was rerun using `THREADLINE_DATA_DIR=/private/tmp/threadline-m02-unsynced`, outside Desktop sync. The copied candidate was verified singly linked. Hard-link protection was preserved. The temporary candidate root is retained for inspection; this is test placement, not the release data-location policy. After testing, all 30 artifact files were copied byte-for-byte into the original artifact store without overwriting existing bytes. The backend was restored to its original configuration; health and the completed run were reread successfully. A digest-checked audit from the normal store passed, and a project-wide SQL check found zero unresolved attempts.

Two actual file-reading runs exhausted the initial 1,500-token output ceiling. Reported usage and an explicit terminal `length` outcome were available, but the driver classified them as unknown. A fully received `length` response with terminal usage now settles as **failed** (`output_limit_reached`), preserving usage and possible-charge status while releasing no partial tool calls. Missing terminal evidence or usage remains unknown and blocks repetition. Regression tests cover both cases. The historical length rows were reconciled only after inspecting their precise terminal reason and reported usage; successful prior tool records and billing facts were preserved.

The owned runtime, prepared profiles and both provider transports now share an explicit 4,096-token ceiling. One intermediate run exposed an old transport-only 1,500 ceiling and was refused before dispatch, with no provider attempt or usage. The corrected shared ceiling passed real-store conformance before the final acceptance. The visible report is requested under 300 words; this is model guidance, not an enforced output-length guarantee. Conservative input/output reservations and the declared profile context window remain authoritative. The local 12,000-token test cap is not a claim about the model's maximum window.

The completed non-passing diagnostics remain distinguishable: never-dispatched logger failure `2fa6b0e3-7f0d-4dd8-a986-2a8c82d3100a`; empty eligible workspace `32768ad6-62e8-47ae-839c-9c0e38267751`; explicit output exhaustion `fe8c7e47-d867-4c27-a41c-a6e3b8238821` and `13069432-21d2-4ec7-8f58-976b47e28e81`; pre-dispatch transport-limit refusal `1224fafe-ffcc-4f11-aecb-6d3043cf91b6`. These were not automatic retries of an uncertain send. Every additional live run was explicitly initiated during the user-authorized M02 completion work; no ordinary test performs paid inference.

## Final regression evidence

- `npm run build`: passed.
- `npm test`: backend 179 passing / 0 failing / 34 explicitly skipped; CLI 45 passing / 0 failing / 1 explicitly skipped. **224 passing, 35 skipped.**
- Opt-in isolated-store suites: M01 10, M02 authority/journal 13, assembled/public runtime 11: **34 passing, 0 failing, 0 skipped**, with injected inference. The Go conformance case exercises production logging and the same output-limit policy.
- Logger and terminal-exhaustion regressions were observed failing before their corresponding fixes.

Environment: Node v23.11.0, npm 11.4.1, TypeScript 7.0.2, PostgreSQL 18.6 and FalkorDB 6.0.2. Node 24 remains unverified. Development store volumes were not reset or removed. Credentials were not added to source, documentation or examples. Diagnostic scripts stayed outside the repository.

## Scope after closure

M02 is ready for the branch/commit/PR workflow and M03 development. General operator reconciliation of an ambiguous dispatched request, arbitrary editable workspaces, effects/shell tools, durable SSE replay, cross-session memory, a dedicated system prompt, OAuth and protected completion remain outside this milestone. Only the three read-only workspace tools are model-visible. The current task instruction is a user message assembled in `runtime/managed.ts`; permissions are enforced by backend guards independently of prompt text.
