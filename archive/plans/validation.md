# Architecture artifact validation

**Performed 15 October 2026. This validates documentation structure and reference-model consistency only.** No Threadline implementation, live SQL migration, Cypher execution, provider login, inference, sandbox, recovery or load test was run.

## Completed checks

| Check | Observed result | Limit |
|---|---|---|
| Official Mermaid parser | Mermaid `11.12.0` parsed all 31 standalone diagrams and 36 Markdown diagram blocks without errors | Syntax acceptance; not proof of runtime behavior or ideal renderer layout |
| SQL model inventory | 33 full-reference tables and 371 columns; 31 core tables; no duplicate column names | Proposed reference model |
| SQL references | 82 foreign keys checked for existing endpoints/columns, matching arity, referenced uniqueness and valid CREATE ordering | Static model check; no PostgreSQL server/parser was used |
| Graph inventory | 31 node labels, 433 property entries including common fields, and 82 typed endpoint relationships | Property counts include repeated common envelopes |
| Graph consistency | No duplicate property names or typed edges; all endpoints declared; all SQL/graph fields present in generated Mermaid ER panels | Application/cardinality invariants require execution tests |
| Release cut | Core SQL contains exactly the 31 core tables; no FK depends on the two excluded adapter/auth tables; removed analysis entities are absent from both full and core DDL | Proposed reference DDL, not an installed package |
| Semantic diagram checks | Canonical `INCLUDES`; cancellation from every unfinished task state; removed analysis nodes/roles/edges are absent from all current models and diagrams | Manual design review complements syntax checks |
| Markdown | 485 relative-link targets, one prose H1 per file and balanced code fences checked across 27 Markdown files in the index and plans | External URLs have source-inspection evidence, not a link-monitoring guarantee |
| Local SVG exports | Four XML-parseable SVGs; fields generated from the same JSON models as the dictionaries | Figma import/rendering not tested |
| Visual review | Architecture overview and detailed SQL/graph schema regions inspected using local raster previews | Code-drawn previews share geometry; not a browser rendering test of every SVG |
| Reference archives | Codex registry/specifications/selected handlers inspected for tool contracts; Pi and Prime Agent read for design patterns | No archive files edited; no reference project built or executed |
| Figma | Exact discovered connection metadata supplied; top-level and page inspection succeeded, showing one empty page | No remote nodes needed updating; no write/import test or mutation |

Temporary Mermaid/jsdom dependencies were installed outside the repository solely for parsing. No product dependency manifest or runtime was introduced. The reference SQL intentionally omits deployment roles/grants and remains a reviewed-migration starting point.

## Remaining implementation gates

Run the cases in [delivery and validation](track2-delivery-and-validation.md) and [OAuth acceptance](track2-authentication-and-oauth.md) when implementing. They cover actual database constraints, graph guards, scope isolation, persistent capture, uncertain effects, clean successor recovery, native adapters, subscription/API billing, bounded workers, backup/restore and the review-specific RV01–RV14 cases. Native/OAuth, investigator spawning, wider provider/OS coverage and larger evaluations are post-hackathon.

Diagrams and static schemas do not turn those gates into passing tests. Packaging versions must be pinned and recorded with executed evidence before any route is advertised as supported.

## Adversarial review

A critic and independent evaluator reviewed the baseline and proposed remedies. The review identified 14 findings (12 P1, two P2, no P0); the evaluator accepted 11 and partially accepted three. The [resolution register](review/track2-review-resolutions.md) records the corrected contracts and unexecuted acceptance cases. The evaluator completed a separate reread of actual corrections and found adequate design-level dispositions for all 14 findings. Its report distinguishes design remediation from runtime proof.

## Complete analysis-module removal

The dedicated plan and three diagram panels were deleted. The shared schema models, both SQL references, field dictionaries, Mermaid atlas and four local SVG boards were regenerated without those entities. Provider evidence now resides in [track2-provider-evidence.md](track2-provider-evidence.md). Original research notes and archived source repositories remain historical material; the critic/evaluator snapshots are explicitly labelled as baseline reviews.

## Codex-inspired tool contract update

The target catalogs agree on 14 tools; the controlling development MVP advertises eleven, including the added tactical checklist, structured human clarification and command polling. Codex archive evidence is linked per tool family. Tool-specific authority/recovery cases C17–C19 were added; they remain unexecuted. No archive source was copied or modified, no Codex build was run and no new SQL table or graph label was introduced. The tool-surface Mermaid and local architecture SVG were updated.

## Priority and summarization policy update

The runtime policy separates capture/retention from packet selection and defines P0–P3 bands, exact versus compressed representations, source/uncertainty/version bindings and whole-request budget checks. Architecture/data documentation and the existing HTML reading view reference that policy. Markdown/link/fence checks and all 60 Mermaid blocks passed; the JSON examples parse. Local HTML link targets and details-tag counts were checked; pre-existing project-root-relative links were corrected for the HTML file location. No browser-rendering or memory-quality test is claimed. No schema table/label was added. C20–C22 remain proposed acceptance cases.

## Capture and summarization cadence update

The proposed cadence distinguishes critical-boundary capture, meaningful state checkpoints and optional model condensation. The complete core recovery trace must run with model summarization disabled; C23/C24 remain unexecuted acceptance cases. Updated Markdown, link targets and all 60 Mermaid blocks passed static checks; HTML local links/details counts passed. No provider call, summarization service or schema entity was introduced.

## Two-person development-readiness cleanup

The fresh critic found ten issues (seven P1, three P2). The independent evaluator accepted nine and qualified the second-model choice, then reread the controlling blueprint and verified its three residual corrections. Design is ready for preflight and first vertical implementation. Runtime remains unexecuted. See [fresh evaluation](review/track2-development-readiness-evaluation.md) and [resolutions](review/track2-development-readiness-resolutions.md).

Four new JSON artifacts parse; the profile specifies eleven tools, two contributors and concrete containment/timing defaults. Checkpoint and episode artifacts declare JSON Schema 2020-12; no JSON Schema validator was installed/run, so schema-validator conformance is not claimed. Existing reference models, new diagrams and regenerated local SVGs passed static checks. The HTML reading view's embedded graph inventory, local links, script syntax and tag structure were checked; no browser rendering test is claimed. Figma assets remain local and the remote file was not mutated.

## Code-first implementation checklist

Created a master checklist and two task-ID-linked agent lane views covering fourteen MVP increments and broader deferred work. The first increment is running backend/TUI code; checker/containment and release pinning are later milestones with their original exposure/acceptance gates preserved. Blueprint, first slice, indexes, delivery/technology guidance and reading view now point to this execution order. Checklist boxes describe unexecuted work; no code, Git branch/commit/push/merge or package publication was performed by this documentation task.

Validated local links/fences/headings, matching lane task IDs, unique master task IDs, complete artifact coverage and explicit C01–C24, F01–F13 and RV01–RV14 dispositions. Mermaid and embedded HTML script checks remain syntax-only.

Checklist verification observed 456 uniquely identified unchecked master items, 100 Agent A tasks, 99 Agent B tasks and 63 joint milestone checks. All existing plans artifacts have an explicit referenced disposition; all 51 delivery correctness/fault/review case IDs are mapped. The current collection parses as 31 standalone Mermaid diagrams plus 36 Markdown diagram blocks (67 total), with no syntax errors. The HTML has 35 valid local file links and two syntax-checked embedded scripts. These counts include planning/deferred checks, not completed implementation.
