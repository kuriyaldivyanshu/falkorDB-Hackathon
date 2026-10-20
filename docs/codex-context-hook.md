# Context-only Codex hooks

`threadline codex-hook SessionStart` and `threadline codex-hook UserPromptSubmit`
retrieve context from the existing memory service. Enable them explicitly through
a reviewed configuration preview. They capture no prompts or tool results,
enroll no session and change no accepted knowledge. Native execution and model
consumption remain unqualified; N03 is incomplete.

## Configure a reader and selectors

First issue a project reader through the supported [owner API](access.md), saving
its one-time bearer in a private raw token file. There is no credential
administration CLI. The hook requires that file explicitly and never falls back
to the owner or `THREADLINE_MCP_TOKEN_FILE`. The current API cannot independently
introspect credential kind: selecting an issued reader is an operator requirement,
not a client claim that an arbitrary supplied token has reader authority.

Select a running installation, project UUID and absolute paths. The selector
file contains only optional taskId, focus, conditions and maxBodyBytes, validated
through a strict projection of the shared preparation contract. `{}` requests
project context. Files are bounded to 64 KiB before parsing. A complete example:

```json
{
  "taskId": "22222222-2222-4222-8222-222222222222",
  "focus": "UTC",
  "conditions": {
    "selectionHints": [{"key": "contract_version", "values": ["csv-v1"]}]
  },
  "maxBodyBytes": 4096
}
```

Replace the illustrative UUID with the stored task. Selectors cannot supply a
project, credential, destination, idempotency key or native identity. Hints are
caller assertions; task family comes from the stored task. Keep configuration
free of private prompt text.

For authored input verification, use the following command with an event object
on stdin. This is a transport check, not native qualification:

```sh
threadline codex-hook SessionStart \
  --home /absolute/threadline-home \
  --project 11111111-1111-4111-8111-111111111111 \
  --token-file /absolute/private/project-reader.token \
  --workspace-root /absolute/project \
  --context-input /absolute/private/context-selectors.json \
  --hook-timeout-ms 2000 < /absolute/authored-event.json
```

Use `UserPromptSubmit` for that event. All five routing/path flags are mandatory;
paths must be absolute and single-line. Unknown/repeated options and other events
withhold output. The configured home's non-secret config.json supplies the
loopback host/port, with existing THREADLINE_HOST/THREADLINE_PORT overrides.
The hook reads no installation owner credential or database secrets.

## Input, workspace and identity

Stdin is read asynchronously under the existing hook byte bound (1 MiB).
Malformed/oversized input and a hook_event_name different from the command
withhold context. Only that event name and cwd are used from the envelope.
Prompt/tool text, transcript paths and native identifiers are never persisted,
logged or used to select context. Transcript files and native history are never
opened. A normal envelope's session_id/turn_id fields are ignored.

Both configured workspace root and reported cwd are canonicalized with realpath.
The reported directory must equal or be contained within the configured root;
siblings, path-prefix tricks and symlink escapes withhold context. This is an
additional refusal guard. It authenticates neither a native conversation nor a
backend workspace binding. Project routing is explicit and backend reader scope
remains authoritative. Every preparation uses nativeSessionId null.

## Deadline and fail-open behavior

The default total deadline is 2,000 ms; `--hook-timeout-ms` accepts 250–5,000 ms.
The budget starts on handler entry and covers stdin, configured file reads,
canonicalization, preparation, stdout and best-effort reporting. Runtime startup
and OS scheduling can add process-launch overhead. Preparation reserves 150 ms
for reporting/cleanup without extending the total budget. Requests and response
reads share cancellation; HTTP replies are additionally bounded to 1 MiB.

Credential, selector and installation config inputs must be regular files, at
most 64 KiB each. Final-component symlinks are refused; files are opened with
nonblocking flags and checked through the actual descriptor to avoid FIFO races.
Pending input listeners, streams and timers are cleaned up. Filesystem system
calls cannot be interrupted in every OS failure; external termination, failed
storage hardware and a stalled OS are outside the process's guarantee.

Before output, ordinary usage, validation, authorization, storage and timeout
failures exit 0, emit no context and write a short fixed/code-only diagnostic to
stderr. They never echo raw envelopes, bearer values or backend error details.
A completed preparation is still withheld if the deadline expired before output
starts. Human context CLI usage/refusal exit semantics are unchanged.

## Exact output and audit precision

The shared context transport validates the entire backend result. The hook also
checks project/task, rendered UTF-8 byte count, budget and body digest. It uses
the backend's exact body, preserving current authority and every rendered
qualification. The default body is 4 KiB and the hard limit is 8 KiB. Overflow
always refuses; the renderer's optional truncation policy is never used here.
Stdout contains exactly one hook JSON line or nothing.

One random UUID is created per invocation; preparation and occurrence-report
keys are derived from that UUID and retained within that process. No retries are
currently automatic. Any future same-process retry must preserve these keys and
payloads. Separately launched hook processes can create separate preparation
audits, even for identical event/session envelopes. This adapter key rule leaves
human CLI idempotency unchanged.

Only a successful stdout write callback permits an emitted report, using the
same credential, expectedState prepared and boundary adapter_report. It reports
local stdout acceptance, not Codex receipt, model consumption or compliance.
A partial/broken write never reports emitted; where time permits it reports
unknown. A pre-output packet refusal can report refused. An expired deadline can
leave an audit prepared. Failed reporting after output produces
`report_uncertain_after_local_write` on stderr and leaves the report outcome
uncertain; bytes already written cannot be recalled. No second JSON object is
printed. native_observed remains unsupported.

The backend persists metadata-only manifests and occurrence audits; there is no
new capture, enrollment or accepted-memory path. See [context clients](context-client.md)
for release consistency, credential revocation and irreversible returned bytes.

## Preview without installation

```sh
threadline codex:preview \
  --home /absolute/threadline-home \
  --project 11111111-1111-4111-8111-111111111111 \
  --codex-home /absolute/isolated/codex-home \
  --context-hooks \
  --token-file /absolute/private/project-reader.token \
  --workspace-root /absolute/project \
  --context-input /absolute/private/context-selectors.json \
  --hook-timeout-ms 2000
```

Preview writes nothing. Mode context-hook renders only SessionStart and
UserPromptSubmit, exact quoted executable/entry/flag paths, a host timeout longer
than the handler deadline, and additionalContextLimit 0. The handler enforces its
own byte limit before output. Its ownership manifest names just those events
and labels the new hook path unqualified. The MCP process uses the same selected
reader file. No bearer appears in arguments, TOML or the manifest.

The SessionStart entry has no matcher, so it does not exclude the startup,
resume, clear, compact and fork events defined by the referenced hook schema.
Actual native hook execution remains unqualified. Each invocation uses the
same explicitly configured selectors; the adapter does not infer a new task or
native session identity.

Default preview remains six-tool MCP-only. Independent `--context-tools` adds
the seventh audited retrieval tool, with or without hooks. There is no occurrence
MCP tool. Existing absent/owned/edited/foreign target classifications and collision
guards apply; a preview never replaces any native file or trust state.

## Evidence categories and later live probe

Official [Codex hook documentation](https://learn.chatgpt.com/docs/hooks), checked
18 October 2026, documents command hooks, the two event output shapes, trust
review and per-handler additionalContextLimit. Setting it to zero passes complete
additional context; the documented recommendation requires a strict handler cap.
The snapshot's hooks/schema.rs and MCP metadata constructor agree with these
shapes, but snapshot implementation is read-only reference, not installed proof.

Installed offline evidence is separately recorded in the [assignment result](assignments/agent-b-codex-context-hook-05.md):
version/schema inspection does not establish hook execution. Authored stdin,
real-store audits and controlled stream/failure checks establish adapter behavior
only. Existing qualification assets remain historical and unchanged.

For a later synthetic native probe, obtain explicit authorization for each action
below before that action. This procedure has not been performed here:

1. **Installation:** authorize the exact isolated Codex home, synthetic workspace,
   issued reader/selector paths, executable and reviewed preview bytes/digests.
   Save only the two previewed owned files there after checking absent/owned
   classification. Do not modify the real user home or foreign/edited files.
2. **Trust:** authorize opening that isolated profile with `codex --profile
   threadline` in the synthetic workspace and reviewing/trusting precisely the
   two commands through `/hooks`. The exact launch from that workspace is
   `CODEX_HOME=/absolute/isolated/codex-home /opt/homebrew/bin/codex --profile threadline`.
   Do not synthesize trust hashes or bypass trust.
   Record version, paths, source/event names and visible trust status, without
   credentials or transcripts.
3. **Inference:** separately authorize one synthetic session and one explicit
   synthetic prompt, for example “State the current freshness requirement and
   distinguish it from the historical observation; do not mutate memory.”
   Agree the account, model, call/cost bound and stop conditions before running.
   Observe SessionStart/UserPromptSubmit hook execution, exact packet bytes and
   local-write audits. Check visible native additionalContext delivery for the
   bounded multibyte body and whether spilling occurs. Do not scan history.
4. **Separate-session recall:** obtain authorization for a second genuinely new
   session after a human-authored authority correction. Repeat the bounded
   prompt and record current authority versus historical qualifications. Visible
   model answers support a narrow use claim, not hidden-reasoning/compliance proof.
5. Keep native execution observations, adapter reports and model-visible behavior
   separate. Missing event/delivery evidence leaves that boundary unqualified.
   Native identity, capture, enrollment and fork/subagent correlation require
   their own later contracts. Retain resources for authorized coordinator review.
