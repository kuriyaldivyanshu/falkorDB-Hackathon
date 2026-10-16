# Threadline architecture plan

**Updated 16 October 2026. M00–M03 are merged; M04 checkpoints and tactical state are locally integrated and verified. M05 onward remain proposed.** This directory consolidates the Track 2 plan and the user's subsequent request for an owned harness. It supersedes native-wrapper-first scope in the historical notes while retaining local npm/TUI delivery.

**Current MVP: two contributors, one Builder, a fresh successor and a protected deterministic service checker.** Start with [the development blueprint](track2-development-blueprint.md), its fixture/contracts and ordered build gates. Eleven model-visible tools; no summarization API. Native subscription/OAuth adapters and investigator spawning are post-hackathon work.

**Code-first execution:** use the [master implementation checklist](track2-implementation-checklist.md), [Agent A — Memory/Coordinator](track2-agent-a-checklist.md) and [Agent B — Harness/Frontend](track2-agent-b-checklist.md). Fourteen milestones begin with a running small backend and plain TUI. Both lanes feed one combined branch/commit after joint validation; protected checks and release-version freezing follow working code. The checklist controls build order while the blueprint controls product contracts.

## Incremental terminal interface

[Terminal command and UI contract](track2-terminal-command-contract.md) specifies the command catalog, backend dependencies, screen/input behavior and selective Pi reuse. Commands ship with M05–M09 capabilities; M10 consolidates the interface. New gates are unchecked in both lanes and the master checklist.

## Interactive reading view

[Open threadline-plan.html](threadline-plan.html) — a single self-contained page that walks through the whole plan: the interactive architecture map, the ten-step agent loop, the memory model, the recovery sequence, live explorers for all 31 graph labels / 82 relationships / 33 target tables, the tool catalog, the broader target delivery references, and every test case. Technology sections are explained in plain language with analogies; status markers distinguish decided, proposed and deferred work.

## Read in this order

0. [Development blueprint](track2-development-blueprint.md) — controlling two-person MVP, frozen contracts, ownership and implementation gates; [domain glossary](../../CONTEXT.md).

1. [Harness scope](track2-harness-scope.md) — what we build, the 14-tool target registry (eleven in MVP), Codex tool inventory and selected additions.
2. [Technology decisions](track2-technology-decisions.md) — TypeScript versus Rust/Python, provider drivers and staged delivery.
   [Subscription access and OAuth](track2-authentication-and-oauth.md) explains API billing, direct ChatGPT plan access, native Claude/Codex routes and app registration.
3. [Complete architecture](track2-final-architecture.md) — product, backend, context, coordination, identity, providers, deployment and failure handling.
4. [Runtime and protocols](track2-runtime-and-protocols.md) — own execution loop, tools, durable barriers, commands, recovery, cancellation, [memory priority/summarization](track2-runtime-and-protocols.md#20-memory-priority-representation-and-retention), and [save/checkpoint cadence](track2-runtime-and-protocols.md#21-capture-checkpoint-and-summarization-cadence).
5. [Data model](track2-data-model.md) — SQL versus graph authority, schemas, session identities and MySQL portability.
6. [Delivery and validation plan](track2-delivery-and-validation.md) — packaging, setup, milestones, demonstrations and acceptance gates.

## Designs and complete schema references

- [Mermaid atlas](track2-diagram-atlas.md) and [standalone diagram sources](diagrams/).
- [Core-only PostgreSQL reference DDL](schema/postgresql-core-reference.sql) (31 tables; excludes the two adapter/auth extension tables).
- [PostgreSQL reference DDL](schema/postgresql-reference.sql), [field dictionary](schema/relational-field-dictionary.md) and [machine-readable model](schema/relational-model.json).
- [FalkorDB field/relationship dictionary](schema/graph-field-dictionary.md), [machine-readable graph model](schema/graph-model.json), [reference Cypher](schema/falkordb-reference.cypher) and [constraint readiness commands](schema/falkordb-constraints.txt).
- [Figma destination, connector status and local importable visuals](figma/README.md).
- [Actual documentation validation](validation.md). Runtime acceptance cases remain unexecuted.

The full target schema is an architectural reference, not the minimum first implementation. Add feature tables as their delivery slices become necessary. MySQL is an alternative future SQL adapter, not an additional database to deploy alongside PostgreSQL.

## Supporting evidence

- [Provider and subscription evidence](track2-provider-evidence.md).
- [FalkorDB/PostgreSQL/storage evidence](track2-storage-evidence.md).
- [Historical notes index](../../README.md).

Evidence has its own inspection date. Source review and diagram validation do not establish working authentication, safe execution, database correctness or performance.

## Critic and independent evaluator

- [Baseline critic report](review/track2-critic-report.md).
- [Independent evaluation and remediation reread](review/track2-critic-evaluation.md).
- [Resolution register](review/track2-review-resolutions.md): 14 findings, concrete corrections and future acceptance cases.

## Fresh development-readiness review

- [Fresh critic](review/track2-development-readiness-critic.md): 10 findings, seven P1 and three P2.
- [Independent evaluator](review/track2-development-readiness-evaluation.md).
- [Design resolution register](review/track2-development-readiness-resolutions.md); runtime gates remain unexecuted.

## M00 implemented scaffold

[Independent M00 integration verification](review/m00-integration-verification.md) records 49 backend and five CLI tests, a real TUI round trip/shutdown check, review fixes and current limitations. Both lane checklists and master M00 status are reconciled. The user subsequently merged PR #1 with resolutions into `main` (`ed18168`); active plans live here in `archive/plans`.

## Start M01 with two agents

- [Agent A launch prompt](prompts/track2-m01-agent-a.md): PostgreSQL/FalkorDB adapters, identity/session bootstrap, durable human command admission and current task authority.
- [Agent B launch prompt](prompts/track2-m01-agent-b.md): local Compose services, dependency configuration, explicit fixture acceptance and plain authenticated CLI/TUI.

Both prompts cover exact task IDs, file ownership, early contract coordination, targeted archive assistance, real-store verification, honest checklist updates and one combined milestone handoff. They preserve M00 review resolutions and require a new baseline check rather than assuming old test evidence covers merged changes.

## M01 combined integration

[Independent M01 verification](review/m01-integration-verification.md) records the resolved session, graph topology, retry, owner-bootstrap and CLI integration defects; actual PostgreSQL/FalkorDB and CLI/TUI evidence; and remaining limits. All M01 A/B tasks and joint J01–J04 are verified. J05 is complete after PR #2 merged at `067f842`. See [working local setup](../../docs/local-development.md) and [implemented protocol agreement](../../docs/m01-contract-agreement.md). That evidence predates M02; see the local integration below.

## M02 local integration

[Current executable workflow](../../docs/m02-development.md) and [independent integration evidence](review/m02-integration-verification.md) cover real-store run admission, exact-byte request journals, durable model/tool artifacts, bounded sequential execution, CLI preparation and private activity in an actual PTY. The original local snapshot passed 212 ordinary tests and 33 opt-in store cases; subsequent results are recorded in the linked evidence. Schemas and diagrams include additive attempt facts and the operational session lease.

All M02 A/B/joint checkpoints are checked. The user-selected Space Bunny acceptance passed with actual file bytes, next-turn continuation and final reported usage. Final regressions: 224 ordinary tests and 34 real-store cases pass. [Final live evidence and repairs](../../docs/m02-live-acceptance.md). OpenAI live-account and subscription support remain unclaimed. The combined implementation is ready for the branch/commit/PR workflow.


[API-key provider configuration](../../docs/provider-configuration.md) documents the subsequent user-approved OpenCode Go/custom-provider extension, Pi inspiration and successful one-request Space Bunny smoke test. The later full live model/tool acceptance is recorded separately in the evidence above.

## Provider connection extension

The user-authorized provider-first setup is implemented: masked key entry, validation before saving, owner-only local storage, selection/replacement/removal and stale-profile protection. OpenAI, Anthropic, OpenRouter and OpenCode Go are selectable; native Anthropic uses Messages. [Workflow, storage limits and targeted evidence](../../docs/provider-setup.md). Live non-Go account compatibility is not claimed.

## Start M03 with two agents

M02 and its review fixes merged into `main` at `d09f35e`. The next milestone is durable capture, immutable available Sources, graph admission and source inspection. M03 is now integrated in the working tree; see [executed M03 evidence](review/m03-integration-verification.md) and [current commands](../../docs/m03-development.md). The launch prompts below remain the historical lane assignment.

- [Shared M03 brief](prompts/track2-m03-shared-brief.md): read first; contract gate, exact file ownership, persistence/replay semantics and joint acceptance.
- [Agent A launch prompt](prompts/track2-m03-agent-a.md): artifacts, capture/outbox transactions, deterministic graph admission, projection and permission services.
- [Agent B launch prompt](prompts/track2-m03-agent-b.md): runtime capture, bounded chunks, source transport/tool, reconnecting TUI and assembled acceptance.

Both agents work on M03 in the same checkout. The integration owner verifies the combined result before one branch/commit. Ordinary acceptance uses an injected provider and isolated real stores; no additional paid inference is authorized by these prompts.

## M03 integrated capture and provenance

[Executed verification](review/m03-integration-verification.md), [working workflow](../../docs/m03-development.md) and [implemented capture flow](diagrams/m03-capture-flow.mmd) cover both lanes and joint acceptance. The existing core SQL tables were reused; no new migration was needed. M04 remains unstarted.

## M04 working checkpoint flow

[Executed checkpoint integration and commands](review/m04-integration-verification.md) cover the real seven-tool runtime, immutable manifest Sources, per-session coverage, automatic checkpoint policy, receipt recovery and CLI/TUI inspection. Retrieval packets and successor lifecycle remain later milestones.
