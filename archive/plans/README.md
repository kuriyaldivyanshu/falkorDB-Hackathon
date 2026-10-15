# Threadline architecture plan

**Updated 15 October 2026. M00 and M01 now have implemented and independently verified code; later milestones remain proposed.** This directory consolidates the Track 2 plan and the user's subsequent request for an owned harness. It supersedes native-wrapper-first scope in the historical notes while retaining local npm/TUI delivery.

**Current MVP: two contributors, one Builder, a fresh successor and a protected deterministic service checker.** Start with [the development blueprint](track2-development-blueprint.md), its fixture/contracts and ordered build gates. Eleven model-visible tools; no summarization API. Native subscription/OAuth adapters and investigator spawning are post-hackathon work.

**Code-first execution:** use the [master implementation checklist](track2-implementation-checklist.md), [Agent A — Memory/Coordinator](track2-agent-a-checklist.md) and [Agent B — Harness/Frontend](track2-agent-b-checklist.md). Fourteen milestones begin with a running small backend and plain TUI. Both lanes feed one combined branch/commit after joint validation; protected checks and release-version freezing follow working code. The checklist controls build order while the blueprint controls product contracts.

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

[Independent M01 verification](review/m01-integration-verification.md) records the resolved session, graph topology, retry, owner-bootstrap and CLI integration defects; actual PostgreSQL/FalkorDB and CLI/TUI evidence; and remaining limits. All M01 A/B tasks and joint J01–J04 are verified. J05 awaits the actual merge workflow. See [working local setup](../../docs/local-development.md) and [implemented protocol agreement](../../docs/m01-contract-agreement.md). No M02 provider execution is claimed.
