# Track 2: agent tools and execution contract

**Planning only; 2026-10-13.** Proposed APIs below do not exist yet. No implementation, installation or runtime experiment has been performed. This updates the packaging recommendation to **one local browser app, a thin CLI launcher, an existing agent runtime and a shared FalkorDB memory service**. SDK selection and exact integration APIs remain the separate runtime investigation.

## Minimum product

The CLI starts the local backend and opens the browser. The browser lets a user register a repository, specify a goal and constraints, start/pause/resume work, inspect evidence and accept material scope changes. The backend owns sessions, authorized tools, task state, context selection and agent lifecycle; the existing runtime supplies the model/tool loop. FalkorDB holds durable relationships and state; repository files remain actual coding artifacts.

Use **one Builder and one Verifier**, plus deterministic tests. The Builder plans and edits. The Verifier independently reads the changed artifacts, runs approved checks and reports findings; it cannot edit by default. A third planning agent adds coordination without establishing the core memory benefit. Verifier runs after meaningful checkpoints, not after every tool call.

## Authority and bounded tools

The user approves the goal, hard constraints, repository root, command profile, privacy/sharing policy and resource budget. Within that authorization, the Builder chooses implementation tactics, retrieval follow-ups and checks autonomously. New external actions, expanded filesystem/network access and changed hard constraints require an explicit user decision. Routine authorized edits/tests do not prompt repeatedly.

All calls use server-issued actor/session identity and project scope. The backend supplies request IDs, task revisions and ownership fences; model text cannot impersonate another actor. Five repository tools are shared, with editing restricted to the Builder. Memory tools are role-filtered as specified below. These are conceptual contracts:

| Tool | Input and result | Guard / role |
| --- | --- | --- |
| `workspace.read` | Relative path and bounded range → text, digest | Authorized root; both roles. |
| `workspace.search` | Query, paths, result limit → matches | Bounded output and permitted paths. |
| `workspace.inspect` | Scope → current revision, dirty files, diff and digests | Both roles; never treat remembered artifacts as current files. |
| `workspace.edit` | Path, expected digest, patch → new digest | Builder only; reject stale files or revoked ownership. |
| `workspace.run` | Registered command ID and validated arguments → exit status, bounded output, receipt | Approved test/lint/build templates; timeout and configured network policy. No unrestricted shell string. |
| `memory.retrieve` | Task, question/focus, budget → evidence-backed context pack | Both roles; scoped closure with inclusion paths and validity status. |
| `memory.checkpoint` | Expected revision, evidence, progress, attempt interpretation and next step → receipt | Builder; cannot overwrite goals, hard constraints or accepted decisions. |
| `memory.propose_decision` | Choice, rationale, alternatives, source references → proposal ID | Builder; acceptance belongs to user or a declared policy within approved scope. |
| `memory.refresh` | Task and observed artifact/constraint revisions → changes and invalidated evidence | Both roles; reconcile current files and governing state. |
| `review.submit` | Findings, affected artifacts, check receipts → verdict record | Verifier; evidence must match reviewed revision. |
| `task.request_completion` | Task, artifact/test/verdict references → request receipt or rejection | Builder requests; backend verifies current ownership, requirements and evidence. |

Service-only `task.claim`, `task.handoff` and `task.complete` enforce ownership, accepted handoffs and completion gates. A Verifier's favorable opinion cannot mark a task done. Runtime-only `history.append` and `memory.record_attempt` record observable messages/actions/outcomes with sequence, source links and visibility. Agent interpretations remain assertions. No agent receives raw Cypher or database credentials.

## First run and execution

First run selects a repository, creates persistent project/tenant identifiers, connects an existing FalkorDB endpoint or explains the explicit Docker prerequisite, and configures the chosen runtime's credentials locally. Secrets stay server-side. Bind locally, authenticate browser/API access, and register additional worktrees explicitly; a directory name is not identity.

The user enters a goal; the backend records accepted constraints, creates a task and grants a guarded Builder claim. Builder receives a bounded context pack, then iterates retrieve → inspect → propose/act → observe → checkpoint. Actual tool results become source evidence. Verifier receives the checkpoint and artifacts independently. Failing checks or findings return the task to the Builder; successful current evidence permits service-controlled completion. The browser shows decisions, sources, ownership and unresolved failures.

One Builder workspace and a read-only Verifier view are sufficient initially. On successor handoff, reconcile the repository before granting a fresh claim. If the selected runtime exposes native tools that bypass our guards, restrict/disable them through a tested adapter or disclose the gap; memory fences alone cannot prevent arbitrary outside filesystem writes.

## Fresh successor and changed requirements

“Reset and resume” starts a fresh model/runtime session with no preceding transcript in its prompt. Restore accepted goals/constraints, current decisions, dependency/blocker closure, artifact revisions, applicable failed attempts/procedures and relevant source messages under a declared budget. Required context that cannot fit produces an explicit overflow; it is not silently dropped. Historical messages remain retrievable separately.

The successor checks files and unknown tool outcomes, invalidates stale evidence, claims the task, then continues. It cannot recover unrecorded reasoning, unsaved edits or unseen messages. A new user constraint creates a superseding record; graph links identify affected tasks and evidence for refresh. Old checkpoints cannot overwrite that constraint.

## Where the agent uses the graph

Example: a shared helper belongs to both API and CLI tasks. A proposed API change retrieves `Task → Artifact ← dependent Task` and a prior failing attempt linked to the CLI under the current artifact digest. The Builder can ask a follow-up, choose another approach and run both relevant suites. A remembered procedure may suggest inspecting dependents, but the agent evaluates applicability and selects checks; a fixed executor does not preselect every path.

Expose the retrieved relationship paths so this decision is inspectable. Compare against identical-input JSON/files, vector retrieval and an agent without relationship closure. A well-designed JSON implementation can reproduce graph traversal; the claim to test is better dependency/validity retrieval under a fixed context budget, not inevitable superiority.

## Persistence, errors and evaluation

FalkorDB serializes writes within a graph; simultaneous clients do not mean simultaneous writers. Critical transitions require application revisions, idempotency and guards. [Concurrency](https://docs.falkordb.com/design/concurrency)

Store Session/Message history, typed episodic events and semantic state with source links. Include one candidate Procedure tested on a held-out task. Separate tenant graphs and backend user/source authorization prevent accidental cross-scope retrieval; private material is explicitly published before sharing. Declare and test RDB/AOF configuration rather than inferring durability from a mounted directory. [Durability](https://docs.falkordb.com/operations/durability/)

Return typed conflict, stale-artifact, unavailable-database and budget errors. Retry boundedly with the same idempotency key; reconcile unknown execution outcomes before rerunning commands. Verify restart reconstruction, lost acknowledgments, stale-owner rejection and tenant denial. The current consolidated experiment uses **4/8/16 real or simulated protocol clients**, labelled separately from actual model agents; report latency, throughput and correctness, without claiming performance in advance. The earlier 32-client suggestion is optional.

## Four people, four days

| Owner | Contract |
| --- | --- |
| 1 | Graph ledger, scoped identity, revision/fence/idempotency guards, persistence. |
| 2 | Runtime adapter, authorized coding tools, Builder/Verifier lifecycle and recovery. |
| 3 | Browser flow, thin launcher, configuration, context-pack presentation and trace. |
| 4 | Fixtures, deterministic verification, context selection/baselines and integration evaluation. |

Freeze schemas and one authored fixture on Day 1; prove single-Builder fresh recovery on Day 2; add Verifier, handoff and requirement changes on Day 3; evaluate, package and rehearse on Day 4. Support one runtime first. Drop extra host adapters, remote deployment and autonomous procedure generation before dropping recovery, evidence or independent tests.
