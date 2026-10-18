# Threadline domain language

Threadline preserves sourced project memory and coordinates its use across independent coding-agent sessions.

## Participants and scope

**Project**: A deliberately associated body of work with its own memory and access grants. A repository path alone does not establish the association.

**Native session**: A registered association with a reported conversation in an existing coding agent; provisional registration proves no observation. Its tools, model loop and execution remain under that agent's control.
_Avoid_: Threadline run, owned worker.

**Enrollment**: A stable owner-approved association between one project workspace binding and a dedicated producer principal. Its fixed-lifetime credential permits one provisional session registration, then project reads and its own context audits; capture remains unavailable.

**Binding generation**: The generation guarded when an enrollment pins its single session. It is fixed at 1; replacing an instance requires revoking its enrollment and issuing a fresh one.

**Producer credential**: A one-project bearer bound to one enrollment and dedicated service principal. It is delivered once and cannot prove which native process possesses it.

**Task**: A work item used to organize current requirements, relevant memory and coordination. Its identity can survive a change of native session.

**Task revision**: The opaque token a guarded change to a task's requirements must expect. It names the task state the caller saw, not a counter the caller may compute or reuse.

**Requirement**: A memory a task declares that it needs. It governs the task only through the current accepted version of that memory; an unaccepted proposal leaves the requirement unsatisfied.

**Coordination claim**: A time-bounded right to advance specified shared task memory. It does not grant or prevent native filesystem execution.
_Avoid_: Execution lock, sandbox permission.

**Reader credential**: A one-project opaque bearer issued by a human project
owner to a dedicated service principal with a reader grant. It permits scoped
reads and its own context audits, has fixed absolute/idle expiry and no native
enrollment or session identity. The bearer is delivered only once; retries
recover metadata, never the secret. Revocation blocks future authorized releases
but cannot recall delivered bytes. See [the access guide](docs/access.md).

## Evidence and memory

**Source**: A versioned record of permitted evidence, with its origin, retained bytes and completeness. Missing bytes remain unavailable even when their digest survives.

**Capture**: Recording supported visible work under an approved policy. Capturing a statement does not accept it as reusable truth.

**Episode**: A source-backed attempt and observed outcome under stated conditions. An unknown outcome stays unknown, and an outcome records what happened to one action, never the success of the wider task.

**Evidence precision**: How firmly an episode's outcome was established. `authored` means somebody asserted it and stays asserted however often it is repeated; `observed` means this service resolved it from evidence it verified itself. A caller may ask for observation; only the service grants it, and unsupported evidence is refused rather than recorded as something weaker.

**Semantic memory**: An accepted requirement, decision or scoped fact with provenance. An agent assertion is initially a proposal, and a proposal governs nothing until a human accepts it.

**Procedure**: A reusable sequence with explicit prerequisites, parameters and supporting outcomes. Validation requires evidence of compatible reuse. A human-accepted candidate is current, not validated: acceptance and validation are different decisions.

**Intent document**: The immutable captured form of one proposal or correction: its statement, applicability, observed conditions and cited sources. An operation references that document instead of restating its content.

**Memory version**: A specific authored or observed form of a memory, including its provenance and applicability. Corrections supersede versions instead of rewriting observations.

**Current authority**: The accepted memory version that presently governs a requirement or decision. The latest captured assertion is not automatically authoritative, and a superseded version stays recorded with its own evidence.

**Applicability**: The conditions under which a memory is useful for current work. Those conditions can differ from the conditions under which it was originally observed.

**Handoff**: A source-backed offer of current task state and unresolved work to another session, with a recorded acceptance state. It does not transfer hidden native state or control a process.

## Delivery and privacy

**Context packet**: Bounded exact current task authority and applicable optional evidence selected at a graph/task/privacy snapshot, with complete bounded source references and omission reasons. Released applicability predicates and historical observed conditions stay distinct and complete, including optional excerpts; caller selection hints are not authenticated runtime facts.

**Context manifest**: The metadata-only Source recording selected identities/versions, snapshot, limits and render digest. Released item text, applicability predicates, historical observed conditions and rendered body are not persisted in the manifest.

**Context occurrence**: A scoped record initially prepared, with a guarded operator/adapter report of emitted, unknown or refused delivery. Preparation proves no emission; reported emission proves no native observation, comprehension or following. Native observation remains unavailable.

**Operation receipt**: Durable proof of a particular guarded memory-state commit. It does not certify the correctness of native code execution.

**Capture gap**: An explicit interval or item whose evidence is missing, partial or unsupported. A later summary cannot turn the gap into a complete observation.

**Privacy revision**: The current boundary for admitting and releasing project memory after consent or availability changes. Earlier queued work cannot override a later erasure boundary.

**Erasure**: Denial and removal of managed source content and its derived memory, with persistence retention reported separately. It does not recall text already delivered to a native client.
