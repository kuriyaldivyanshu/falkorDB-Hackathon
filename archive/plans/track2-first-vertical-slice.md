# Threadline first vertical slice

**Rebased 15 October 2026. Proposed, not executed. Two full-time contributors; deadline unknown.** [Development blueprint](track2-development-blueprint.md) is the controlling detailed draft.

## 1. Smallest complete workflow

Human accepts the authored inventory-export manifest. One logical Builder acquires a guarded graph claim and executes one journaled API/tool round trip. Capture produces sourced observations and a deterministic structured checkpoint. A protected service checker supplies real candidate-bound evidence. Interrupt after durable failure capture, start an empty-conversation successor, and recover current requirements and applicable evidence without a manual recap or entire transcript.

The harness is TypeScript/Node, local npm/Ink TUI, PostgreSQL, FalkorDB and immutable artifacts. Eleven model-visible tools ship; the 14-tool reference retains three deferred tools. No second model Verifier, polling, RLM, summary API, native adapters or child spawning is required.

## 2. Concrete build inputs

Use the [fixture](contracts/fixture-manifest.json), [limits](contracts/development-profile.json), [checkpoint schema](contracts/memory-checkpoint.schema.json) and [episode schema](contracts/memory-episode.schema.json). Create the authored candidate with the read-only model/tool slice and implement/hash its protected check bundle at the later verification milestone; they do not exist as working code yet. A generic candidate may already satisfy a changed parameter: invalidate its old proof and rerun checks without forcing a code edit.

The 31-table core SQL DDL is a reviewed bootstrap reference, not 31 implemented services or 24 repositories before the first turn. Validate it against the chosen PostgreSQL image and build only workflow operations needed by the current gate. The 33-table target adds two deferred extensions. Use logical backend sessions; actual command containers have process identities.

## 3. Gates and responsibility

The user owns authority, memory, capture/reconciliation and evidence acceptance. The teammate owns model loop, tools, checker, TUI and packaging. Pair on contract/fixture/containment preflight.

1. Start with a small running backend, shared types and plain CLI/TUI (M00).
2. Add real task authority, stores, one read-only provider/tool turn and durable capture (M01–M03).
3. Add structured checkpoints, exact bounded retrieval and whole-request budgets (M04–M05).
4. Implement guarded patches/registered commands and prove containment before enabling effects (M06).
5. Add actual interruption, changed requirements, clarification and fresh claim-before-send recovery (M07).
6. Implement protected checks/current receipts, then sourced procedural reuse (M08–M09).
7. Finish the plain UX and actual fault/scope/resource gates, compare an equally informed baseline and package the tested entry point (M10–M13).

Use the [detailed master checklist](track2-implementation-checklist.md) and its two agent variants. Both lanes feed one shared milestone branch/commit after joint integration. Dependency installation is normal scaffolding work; release pinning/doctor and protected checker work do not precede initial application code.

These are functional gates, not calendar promises. Estimate subsequent work from observed integration effort. An incomplete gate changes advertised scope; it does not become a passing test.

## 4. Honest delivery boundary

No runtime tests have been executed. Full backup tooling, prolonged load, multi-model coordination, broad repository compatibility, remote/private-source ingestion and additional providers remain separate feature gates. Preserve denial tests and source visibility even with one local owner. See [complete release gates](track2-development-blueprint.md#10-two-person-build-sequence-and-release-gates) and [independent development review](review/track2-development-readiness-evaluation.md).
