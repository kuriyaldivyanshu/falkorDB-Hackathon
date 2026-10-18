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

Baseline gates passed: clean coordinator main fetched/fast-forward checked at
expected SHA, branch/path unused, new worktree clean at literal SHA with no
upstream. Assignment did not exist on baseline and is created before source.
Implementation and verification pending. N03 remains incomplete.
