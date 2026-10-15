# Threadline architecture review resolution register

**14 October 2026. Documentation/design corrections only; no implementation or runtime gate has passed.** The [critic report](track2-critic-report.md) records the baseline with line citations; later edits naturally move those lines. The [independent evaluation](track2-critic-evaluation.md) accepts 11 findings and partially accepts three, with qualifications. There are 14 findings: 12 P1, two P2, no P0.

## 1. Decision and disposition

The user requested removal of RLM from the entire current plan, including target schemas and diagrams. Build the ordinary TypeScript model/tool loop, graph memory, durable sessions, fresh recovery and bounded Builder/Verifier coordination. General CodeAct execution is also deferred. The [first vertical slice](../track2-first-vertical-slice.md) defines the deadline cut; the current target schemas retain only core and native/provider compatibility entities.

| Finding | Evaluation | Design correction | Required execution evidence |
|---|---|---|---|
| C01 command recovery | Accepted | Full immutable `command_inbox` plus source in one SQL transaction; leased retry and epoch-scoped receipt settlement | RV01 crash before/after graph commit without lost or duplicate requirement |
| C02 loaded private context | Accepted | Retire exposed sessions/descendants, discard continuation, sanitize fresh context; forward revocation only | RV02 old session refused, successor and exports contain no unauthorized canary |
| C03 superseding constraints | Accepted | Stable `SUBJECT_TO` Constraint links; current-version resolution, project barrier and guarded lazy rebase | RV03 new rule appears; missing/duplicate current authority blocks turn |
| C04 model-request journal | Accepted | `model_requests` logical request/attempt/status/input/response/usage binding; conservative unknown outcomes | RV04 dispatch/stream crash and possible duplicate-charge reconciliation |
| C05 check integrity | Accepted | Protected transitive bundle plus trusted assertions/receipt writer outside candidate process, pinned in Criterion/VerificationReceipt | RV05 tampered package script/helper cannot redefine successful acceptance |
| C06 provider owner | Accepted | Initiator = profile owner = provider-account owner; no inferred shared billing | RV06 another project member cannot spend the account |
| C07 authorization race | Partially accepted | One installation-wide coordinator gate serializes cross-project grant changes and admissions; restart loads current grants; already admitted effects reconciled | RV07 both race orderings and restart, without a retroactive rollback claim |
| C08 Verifier claim conflict | Accepted | Verifier assignment manifest/digest binds exact candidate/criteria/epoch/reservation, without Builder ownership | RV08 concurrent roles, denied patch/claim and rejected stale assignment |
| C09 repeated packet delivery | Accepted | Per-occurrence `submission_id`; packet reuse across turns keeps distinct records | RV09 two turns plus duplicate submission preserve two independent outcomes |
| C10 deadline scope | Partially accepted | One provider/OS/fixture; first 24 versus core 31 SQL inventory, two workers, small evaluation and explicit cut lines | RV10 packaged minimal path; declared rather than assumed team feasibility |
| C11 restore epoch | Accepted | Epoch in command/digest/receipt/index/lookup; old commands quarantined; observation repair is separate | RV11 matching old fence/revision still rejected across epoch |
| C12 design drift | Partially accepted | Canonical `INCLUDES`, complete cancellation paths, consistent provider route labels, generated schema views | RV12 semantic check in addition to Mermaid parsing |
| C13 private derived output | Accepted | Conservative source readership for whole session output; private detail separate from safe shared state; explicit Publication | RV13 shared checkpoint/Event/Receipt/SSE/export excludes private canary and metadata |
| C14 RLM necessity | Accepted; removal completed in planning artifacts | Deleted the module plan, SQL tables/roles, graph nodes/edges, dedicated Mermaid panels and schema-board content; no future implementation path retained | RV14 packaged implementation matches the remaining architecture |

The numbered `RV` cases are specified in [delivery validation](../track2-delivery-and-validation.md). They are distinct from the older test table's `C` identifiers. “Corrected” here means the proposed contract was changed; only executed evidence can close an implementation gate.

## 2. Corrected artifacts

- [Runtime protocols](../track2-runtime-and-protocols.md): command/model journals, stable requirements, role assignments, protected verification, provider ownership, permission ordering, privacy and retirement.
- [Database model](../track2-data-model.md), [full SQL](../schema/postgresql-reference.sql), [core SQL](../schema/postgresql-core-reference.sql), [graph dictionary](../schema/graph-field-dictionary.md) and [query sketches](../schema/falkordb-reference.cypher): explicit fields, constraints and authority boundaries.
- [Target architecture](../track2-final-architecture.md), [release cut](../track2-first-vertical-slice.md), [harness scope](../track2-harness-scope.md) and [technology decision](../track2-technology-decisions.md): ordinary tool loop and fixed release boundary.
- [Diagram atlas](../track2-diagram-atlas.md) and [local SVG exports](../figma/README.md): current architecture, full labelled schema references, command recovery and privacy flows. No remote Figma edits.

## 3. Remaining risks and open implementation choices

The dual-store design remains substantial for four days. The first integrated slice must prove its value before UI breadth or adapters. Exact supported patches, provider account eligibility, process sandbox behavior, persistence durability, SQL roles/RLS, Cypher guards and clean installation need real probes. No documentation edit establishes those properties.

The first release forbids implicit shared billing and multiple active coordinators. Mixed private-source readership that cannot be represented safely must be refused. For the smaller demo, use authored project-safe inputs; still execute private-source denial and canary tests. Unknown model usage/effects remain visible unknowns. Tests establish only the covered acceptance behavior, not general coding correctness.

Current provider documentation does not support a blanket claim that subscriptions are impossible. Existing direct local/OpenAI and official-native routes remain separately documented and gated. Their deferral is a delivery decision, not a universal OAuth/certificate limitation. The original research notes and source archives remain historical references; they introduce no runtime, migration or roadmap dependency.

## 4. Validation status

See [artifact validation](../validation.md) for actual static checks and the evaluator's remediation section for the independent reread. Baseline findings, proposed corrections, static consistency and runtime test results are different evidence levels. No runtime, database, authentication, inference or load result is claimed.

## 5. Inventory after complete removal

The current target has 33 SQL tables (31 core, two native/OAuth extensions), 31 graph labels and 82 typed endpoint relationships. All three analysis SQL tables, three graph node labels and six relationships were removed from the shared models, DDL, dictionaries, Mermaid and local SVG schema boards. The dedicated module plan and three dedicated diagram sources were deleted. Provider evidence was renamed to [track2-provider-evidence.md](../track2-provider-evidence.md) and retains provider/authentication material only. Historical critic/evaluator reports preserve their baseline findings under explicit snapshot banners.
