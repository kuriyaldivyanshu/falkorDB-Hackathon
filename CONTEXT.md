# Threadline domain language

Threadline preserves sourced project memory and coordinates its use across independent coding-agent sessions.

## Participants and scope

**Project**: A deliberately associated body of work with its own memory and access grants. A repository path alone does not establish the association.

**Native session**: An observed conversation in an existing coding agent. Its tools, model loop and execution remain under that agent's control.
_Avoid_: Threadline run, owned worker.

**Enrollment**: An explicitly approved connection between a native adapter, a principal and a project. It defines the capture and memory access scope.

**Binding generation**: The current association of an enrolled producer with a specific native session. Rebinding makes an earlier producer instance stale.

**Task**: A work item used to organize current requirements, relevant memory and coordination. Its identity can survive a change of native session.

**Task revision**: The opaque token a guarded change to a task's requirements must expect. It names the task state the caller saw, not a counter the caller may compute or reuse.

**Requirement**: A memory a task declares that it needs. It governs the task only through the current accepted version of that memory; an unaccepted proposal leaves the requirement unsatisfied.

**Coordination claim**: A time-bounded right to advance specified shared task memory. It does not grant or prevent native filesystem execution.
_Avoid_: Execution lock, sandbox permission.

## Evidence and memory

**Source**: A versioned record of permitted evidence, with its origin, retained bytes and completeness. Missing bytes remain unavailable even when their digest survives.

**Capture**: Recording supported visible work under an approved policy. Capturing a statement does not accept it as reusable truth.

**Episode**: A source-backed attempt and observed outcome under stated conditions. An unknown outcome stays unknown.

**Semantic memory**: An accepted requirement, decision or scoped fact with provenance. An agent assertion is initially a proposal, and a proposal governs nothing until a human accepts it.

**Procedure**: A reusable sequence with explicit prerequisites, parameters and supporting outcomes. Validation requires evidence of compatible reuse.

**Intent document**: The immutable captured form of one proposal or correction: its statement, applicability, observed conditions and cited sources. An operation references that document instead of restating its content.

**Memory version**: A specific authored or observed form of a memory, including its provenance and applicability. Corrections supersede versions instead of rewriting observations.

**Current authority**: The accepted memory version that presently governs a requirement or decision. The latest captured assertion is not automatically authoritative, and a superseded version stays recorded with its own evidence.

**Applicability**: The conditions under which a memory is useful for current work. Those conditions can differ from the conditions under which it was originally observed.

**Handoff**: A source-backed offer of current task state and unresolved work to another session, with a recorded acceptance state. It does not transfer hidden native state or control a process.

## Delivery and privacy

**Context packet**: Bounded current authority and applicable evidence selected for a session, with source references and omission reasons.

**Context occurrence**: A record of preparing or delivering a packet at a native boundary. Emission does not prove that a model read or followed it.

**Operation receipt**: Durable proof of a particular guarded memory-state commit. It does not certify the correctness of native code execution.

**Capture gap**: An explicit interval or item whose evidence is missing, partial or unsupported. A later summary cannot turn the gap into a complete observation.

**Privacy revision**: The current boundary for admitting and releasing project memory after consent or availability changes. Earlier queued work cannot override a later erasure boundary.

**Erasure**: Denial and removal of managed source content and its derived memory, with persistence retention reported separately. It does not recall text already delivered to a native client.
