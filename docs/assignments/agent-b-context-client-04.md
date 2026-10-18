# Agent B: bounded context clients

## Assignment contract

Follow AGENTS.md and [the parallel work rulebook](../parallel-work-rulebook.md)
in full. Use only this assignment's worktree, branch, writable paths and
resources. Finish the declared checkpoint, verify it, commit/push the feature
branch and open one PR. Later features stay out; review fixes stay with this PR.
The coordinator handles merges and retirement.

- ID: `b-context-client-04`; owner: Agent B; phase: N03 context client integration.
- Outcome/checkpoint: expose the merged bounded-context API through human CLI
  and explicitly enabled project-bound MCP, with one transport, truthful audit
  semantics, executable preview and authored end-to-end verification.
- Base: `main` / `origin/main`, resolved SHA
  `78e1960b1844e20af23b05bb6bfca8f960a1316f`.
- Branch: `threadline/b-context-client-04`; worktree:
  `/tmp/threadline-b-context-client-04` (canonical `/private/tmp/...`).
- Remote: `git@github-personal:kuriyaldivyanshu/falkorDB-Hackathon.git`;
  PR base `main`. Normal commits/push and one PR authorized; no merge, force
  push, main push, retirement, publication or next milestone.
- Independent of Agent A's unpublished reader API. Integration order:
  A reader access, then B compatibility pass with supported reader issuance,
  then B. Merge current main normally only after coordinator confirms A merged.

## Ownership and resources

Writable: `packages/cli/src/**`, README.md, docs/local-development.md,
docs/cli-memory-and-mcp.md, docs/native-integration-contract.md (client/preview
facts only), new docs/context-client.md, docs/memory-demo.md (separate authored
context-client section only), assets/codex/README.md, new
assets/codex/preview/context-read/**, and this file.

All other paths are frozen, particularly backend/shared, CONTEXT.md,
docs/context.md, docs/access.md, checklist/rulebook, manifests/lockfile,
build/Compose configuration, .gitignore, qualification/schema digest assets,
fixture seed/manifest and Agent A's assignment/worktree. No new dependencies.

Reserved synthetic resources: HTTP 127.0.0.1:47853, PostgreSQL 55463,
FalkorDB 56463, container/volume prefix `threadline-b-context-client-04-`,
data root `/tmp/threadline-b-context-client-data-04`, explicit installation
`/tmp/threadline-b-context-client-data-04/home`, checks
`/tmp/threadline-b-context-client-04-checks`. Verify availability/ownership
before mutation. Use unchanged merged backend and fresh stores. No real native
configuration/auth/transcript/inference access or changes. Synthetic owner
workflow allowed; any SQL reader seeding is verification setup, not issuance.

## Implementation and acceptance

Read the controlling docs named in the user assignment (README, CONTEXT,
context, CLI/MCP, local development, native integration, demo and coordinator
integration record), shared contracts, backend release/replay/occurrence guards,
CLI bounded JSON reader/client/index/options, MCP and preview renderer.

Reuse shared prepare/occurrence schemas, result/occurrence schemas, route
constants and typed transport errors through one client implementation. Parse
responses; preserve packet/refused reason, identities, operation, snapshot,
digest/body bytes and precision. No second selector/renderer, offline memory
reconstruction, applicability changes or mandatory-content truncation. Preserve
backend applicability/observedUnder separation, UTF-8 limits, exact authority,
metadata-only manifests, no standalone focus digest, advancing expiry checks,
renderer-version and scoped replay semantics.

Add `context:prepare --input <file|-> [--json]` and `context:occurrence` with
bounded reader, explicit caller idempotency, optional token-file using existing
format, project matching and unknown/routing field refusal. No secret argv or
output; no caller-created native sessions. Prepare JSON is one validated result:
packet exit 0, refusal exit 1, usage exit 2. Human output shows exact body and
audit/snapshot IDs, operation inspection, prepared does not mean delivered or
committed graph admission. No automatic emission. Occurrence forwards expected
state/key/report, preserves replay/conflicts, labels emission self-reported and
native_observed unsupported; transport failure is never successful emission.

Default MCP remains exactly six read-only tools. `--context-tools` adds only
`threadline_context_prepare`, configured project/destination/credential, explicit
key and only task/focus/condition/budget selectors. Reject identity/routing/native
session overrides. Annotations: readOnlyHint false, destructiveHint false,
openWorldHint false; keyed idempotency only. Audit writes preparation metadata,
not accepted knowledge. Treat retrieved text as untrusted data. Return exact
body once plus compact validated audit/snapshot/omission/refusal metadata, with
64 KiB serialized payload hard limit independent of backend 4/8 KiB body limit.
Oversize produces bounded explicit failure without truncating authority. Preserve
protocol-only stdout, timeout/concurrency, bounded auth/outage errors and no
fallback/restart. No occurrence MCP or generic/mutation/credential tools.

Preview renders real --context-tools only explicitly; defaults unchanged,
preview-only, token-free configuration, ownership/collision/project/home guards,
no unimplemented hook. Isolated offline inspection is not native model use.
Hook additionalContext, native identity and fork/subagent correlation remain
unqualified. Document syntax, complete examples, semantics, limits, side effects,
retry/lost response, binding, preview and evidence boundaries; keep baseline demo
truthful and N03 incomplete.

## Verification and delivery requirements

Run own `npm ci` and workspace `npm run build`. Temporary external checks only.
Exercise file/stdin, current 60-second authority and episode qualifications,
missing authority/overflow, conditions, exact/changed retries, malformed/oversize,
project mismatch, exit/JSON, guarded occurrence and native refusal, no automatic
emission, existing episode/acceptance behavior. Exercise MCP default/opt-in lists,
override refusal, authored initialize/list/call through actual backend, exact
body/metadata/refusal, payload cap, stable retries, concurrent/error protocol and
established-connection graph outage/recovery without service restart. Exercise
preview defaults/opt-in, no secret/hooks/native changes. Record exact outcomes
and unverified cases. Post-A compatibility uses supported reader API, verifies
knowledge mutation denial and audit policy, without credential CLI additions.

Before delivery inspect complete base diff, scope, secrets, Markdown links /
headings / fences, diff checks, clean state and exact remote branch SHA. Record
changed paths, resource ownership, limits, proposed checklist updates, final
commit/remote and real PR URL. If PR route unavailable report blocker, compare
link and prepared multiline body. Preserve worktree/resources for coordinator.

## Result record

### Coordinator takeover for combined verification

The user confirmed PR #18 merged and explicitly paused Agent B on 18 October
2026. The coordinator takes over only this assignment's pending integration
checks, necessary client/documentation fixes and normal commit/push delivery.
The clean branch already contains main `a4891f4` through normal merge
`1f2c797`; no second merge is needed. Use only B's reserved installation,
containers and synthetic credentials. Preserve the previous independent
verification record below; combined outcomes are recorded separately after the
checks. No merge, retirement, native inference or new milestone is authorized.

Baseline gates passed: clean coordinator main fetched/fast-forward checked at
expected SHA, branch/path unused, new worktree clean at literal SHA with no
upstream. Assignment did not exist on baseline and is created before source.
The independently implemented client portion was verified first as recorded
below. Its initial delivery waited for A's merge. The later coordinator takeover
and completed reader compatibility pass are recorded separately at the end of
this file. No unpublished peer branch was used. N03 remains incomplete.

### Behavior and changed paths

- `packages/cli/src/context-surface.ts`: one shared-schema transport for prepare
  and guarded occurrence; backend selection, rendering and authorization unchanged.
- `packages/cli/src/index.ts` and `options.ts`: bounded file/stdin context
  commands, explicit keys, project/document match, strict flag/identity refusal,
  existing raw token-file format, one validated JSON outcome and correct 0/1/2
  statuses. Human output shows exact body and audit/snapshot/operation IDs with
  truthful preparation/admission/self-report limitations. No automatic emission.
  Argument parser failures no longer echo supplied unknown option values.
- `packages/cli/src/mcp/server.ts` and new `mcp/context-output.ts`: defaults
  remain exactly six read-only tools; explicit --context-tools adds only audited
  preparation. Strict selectors exclude routing and native identity; full shared
  response validation precedes one body copy and metadata-only projection.
  Complete serialized tool-result cap is 64 KiB, separate from 4/8 KiB body.
  Oversize returns explicit failure without partial authority; SDK validation
  diagnostics are collapsed before serialization so huge unknown fields cannot
  bypass the cap. Retry reports preparation evidence, not guessed current
  occurrence state. Existing timeout/concurrency and no-fallback behavior retained.
- `packages/cli/src/codex/mcp-preview.ts`: explicit context-enabled preview,
  real startup flag, existing defaults/ownership/collision behavior, no hook or
  bearer, no native writes. New example files only under
  `assets/codex/preview/context-read/`; assets README explains their scope.
- New `docs/context-client.md`; README, local-development, CLI/MCP and native
  contract reconcile implemented client facts. `docs/memory-demo.md` changes only
  by appending a separated authored context-client section. This assignment is
  the sole execution record edited; no frozen paths/dependencies/configuration,
  existing qualification assets or permanent tests changed.

### Observed verification

Node v22.16.0, own npm ci and npm run build passed. Focused temporary scripts and
safe summaries are retained in `/tmp/threadline-b-context-client-04-checks`.
All final relevant runs passed:

- `demo.sh`: documented memory-demo sections 2–5 passed against fresh synthetic
  owner data: proposal/acceptance, task binding, real authored exporter command,
  eligible observed episode, 600→60 correction and candidate procedure. This run
  did not repeat section 6's normal service restart; existing historical evidence
  is not presented as newly rerun evidence.
- `verify.mjs`: **31 CLI/projection checks** passed: file/stdin, exact 60-second
  authority, applicable episode with full distinct applicability/observedUnder,
  UTF-8 byte/digest, stable prepare IDs/operation, human precision/admission notes,
  SQL-confirmed prepared state (no automatic emission), metadata-only manifest,
  no focus digest, exact/changed retries, arbitrary native identity refusal,
  missing/unknown fields and conditions, conflicting flags/project mismatch,
  malformed/oversized file and stdin, invalid token with no value disclosure,
  unknown/incompatible applicability, duplicate hint refusal, missing authority,
  mandatory multibyte overflow, guarded explicit reports/replays/stale and changed
  reports, native_observed refusal, unknown delivery and synthetic oversize cap.
- `mcp.mjs`: **17 actual-backend protocol checks** passed: authored initialize,
  exact six/default and seven/opt-in lists and annotations, strict JSON Schema,
  exact bounded current body once plus metadata, stable/changed retries,
  typed refusal, eight identity/routing override kinds, required key, huge-key
  and many-invalid-selector diagnostic bounds, 8 concurrent valid replays/errors,
  all six pre-existing reads, and established graph outage/recovery. Backend PID
  **1181** and the same MCP process survived without restart. Source metadata
  remained readable during graph outage; context refused with no body fallback.
  After explicit CLI emission, MCP replay still truthfully reports preparation
  evidence without inventing the occurrence's current state.
- `transport.mjs`: **6 authored transport checks** passed for common route/schema,
  caller key and guard forwarding, response validation, typed refusal and failure
  never becoming a successful occurrence. Responses here are simulated.
- `mcp-boundaries.mjs`: **3 bounded-error checks** passed on a constructed stdio
  server: actual-backend invalid synthetic token, injected service failure and
  validated synthetic oversized response through the SDK. Startup project binding
  is bypassed only by this temporary verifier to inject failures. This does not
  claim the normal public startup bypasses authorization.
- `preview.mjs`: **6 checks** passed: unchanged default args, explicit real flag,
  determinism, no credential/hook, absent/owned/edited classification and CLI
  modes leaving a foreign target byte-identical without writes. Python 3.12
  tomllib also parsed the context-enabled profile. No native binary was invoked.
- `context-demo.sh`: the new documented section 7 passed: current authority,
  historical episode qualifications, stable stdin retry and real operation
  inspection. The inspected manifest operation actually had a committed receipt;
  preparation alone was never used to infer that outcome.

Total: **63 grouped focused checks**, plus tomllib and both documented workflow
portions. Initial temporary verifier failures: an unhandled parent-side EPIPE
when the bounded child correctly closed oversized stdin (verifier fixed); an
assertion that concurrent newly created preparations must all succeed despite
backend stale-snapshot refusal (isolation check changed to identical replays,
without weakening product behavior). The first detached service launch was
sandbox-denied and exited before binding; authorized launch at the asserted
installation succeeded as PID 1181. Default Python lacked tomllib; installed
Python 3.12 passed. These are not hidden passing product observations.

### Limits, integration and recovery

At independent delivery, supported reader issuance was an ordered dependency;
no synthetic SQL reader setup was used. The combined pass below now exercises
A's merged supported API, preparation/own occurrence and mutation denials, with
affected CLI/MCP checks/build and reconciled issuance wording. No credential
administration CLI commands were added. The user confirmed A's merge before
the coordinator continued on the normally merged published branch.

No real native configuration/authentication/transcripts/inference, model packet
consumption, hook delivery/spilling, strong native identity or fork/subagent
correlation was exercised. Backend controlled-expiry/race/privacy/renderer-version
checks were read and preserved, not independently repeated. No intentionally
lost real HTTP response, complete load proof or validated procedure reuse claimed.

Owned resources retained for coordinator review/retirement: containers
`threadline-b-context-client-04-postgres` (55463) and `-graph` (56463), volumes
`threadline-b-context-client-04-pg-data` and `-graph-data`, backend PID 1181 on
47853. Isolated database `threadline_b_context_04`, schema `threadline_memory`,
fresh project graphs, sources/credentials under
`/tmp/threadline-b-context-client-data-04/home`; all runtime data stays outside
Git. Temporary verifier processes have exited. Peer stores/processes untouched.

Proposed coordinator checklist updates after final integration: section 2C's
client absence is now outdated; record audited CLI/MCP/preview implementation
and authored transport evidence, while keeping N03 and native/reader integration
gates open until actually qualified. Worker did not edit the checklist.

Final full-base scope/frozen-path audit, changed-file credential scan, all eight
Markdown files' local links/headings/labelled fences, and git diff --check passed.
Eight final transcript digests are retained in the external checks root's
SHA256SUMS.txt. No source changes followed the final successful build except
this result record.

Delivery: implementation commit
`a27649182a615a0c4cd7fc046125b93eba5ced19` was pushed normally to the exact
feature ref, and git ls-remote confirmed the same SHA. One
[draft PR #17](https://github.com/kuriyaldivyanshu/falkorDB-Hackathon/pull/17)
was created through the existing authenticated owner browser (gh is unavailable).
The real PR visibly has base main, head threadline/b-context-client-04 and draft
status. No borrowed credentials, authentication installation or probe issue.
This delivery-only follow-up records that URL; final HEAD/remote confirmation
is in the handoff rather than a self-referential commit hash. The source/config
implementation tree remains byte-identical to the tested implementation commit.

Initial delivery status: committed/pushed, draft PR open, reader integration
pending. This historical status is superseded by the completed combined pass
below. No merge, main update, retirement or new milestone was performed.

### Combined reader integration result

Coordinator verified the clean branch at
`1f2c797eb535d6104c2a223bb12f852398da3bb0`, already containing merged main
`a4891f4` (PR #18). Only B's allowed CLI/comment and documentation paths changed.
No runtime implementation defect was found, no backend/shared source changed,
and no dependency, permanent test or additional migration was added.

Explicit-home init upgraded B's existing populated synthetic database from v5
to v6, preserving the owner and demo data (`replacedInstallation: false`). The
normal merged service then started as PID 36103. Actual owner API issuance,
rather than SQL credential seeding, supplied the reader credentials used by
all new client authorization checks. One-time bearers stayed in exclusive
0600 files inside B's private data root; none entered tracked output.

Observed checks on the combined source:

- `npm run build`: passed after the final CLI comment edit.
- `reader-integration.mjs`: **44 checks passed**. Real issuance/no-store/one-time
  retry/listing, scoped project binding, CLI exact current 60-second authority
  and qualified historical episode, body bytes/digest, exact/changed retries,
  missing-authority refusal, manifest reads, own occurrence/self-report/replay,
  another issued reader's report refusal, native-observation refusal, stale
  state and foreign-project refusal. Fourteen HTTP mutation/administration
  categories refused with `scope_denied`, including forged public audit writes.
  Default MCP retained exactly six read-only tools; explicit opt-in added only
  audited preparation. All six reads, exact body/metadata, keyed retries,
  selector/identity refusal and bounded errors worked with API-issued readers.
  With an established graph read, stopping only B's graph container made CLI/MCP
  fail closed while SQL history/metadata remained readable. Backend PID 36103
  and MCP PID 38397 survived and recovered without restart; recovered retries
  retained identity. Revocation blocked CLI replay and an already running MCP;
  a genuinely short-lived API-issued credential expired and could not replay.
  Owner preparation still succeeded afterward.
- `reader-release-races.mjs`: **11 checks passed**. A temporary HTTP composition
  with real SQL/FalkorDB and instrumented graph-read pauses drove both the real
  CLI and real stdio MCP. Expiry at the final graph read, and owner API revocation
  committed during selection, prevented release in both transports. Every
  refused attempt committed no additional manifest/occurrence. Owner preparation
  remained usable. Instrumentation changes no product source and is not outage,
  native runtime or uncontrolled race evidence. The normal service was restored
  afterward as PID 39380; this restart was after, not part of, the independently
  completed same-process outage check.
- Existing `transport.mjs`: **6 authored checks passed** (simulated responses).
- Existing `preview.mjs`: **6 checks passed**; default/opt-in configuration,
  ownership guards and no real native writes/invocation.
- Existing `mcp-boundaries.mjs`: **3 checks passed**; actual invalid-token
  backend error plus constructed service-failure and oversized-response cases.

Total newly run: **70 grouped focused checks**, plus workspace build and final
documentation/scope/secret checks. Earlier 63 independent checks remain historical
evidence, not a claim that all were rerun. Two temporary-verifier input mistakes
were corrected before the final reader run: `native_observed` belongs in state,
not boundary, and write-route authorization checks require matching path/body
memory/task identities. Those failures were invalid test inputs, not product
fixes. No live native inference, configuration, hook delivery, host identity or
fork/subagent correlation was exercised; N03 stays incomplete.

Reconciled README, local development, CLI/MCP, context-client and native guides
with supported owner HTTP issuance/listing/revocation and actual context client
availability. Removed the CLI's stale explanatory comment about unsupported
issuance. Credential administration remains HTTP-only; the access guide's
backend-only checkpoint description is historical and was left in A's ownership.

New scripts/logs and `SHA256SUMS-combined.txt` remain under B's existing checks
root. B's two containers/volumes, private data root and worktree remain retained;
the normal service is on 47853 as PID 39380 (reidentify before later control).
Other assignments' resources and the coordinator main checkout were untouched.
This PR's reader dependency gate is satisfied; final PR review and merge remain
coordinator/user actions. Do not mark N03 complete or retire resources yet.
