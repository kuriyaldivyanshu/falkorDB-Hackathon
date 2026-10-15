# Threadline domain language

Threadline preserves applicable working state across coding sessions. Its vocabulary distinguishes recorded observations, accepted obligations and evidence that permits completion.

## Work and participants

**Run**: One human-authorized goal execution with a shared policy and budget. It can span several replacement sessions.

**Task**: A bounded unit of work governed by current requirements and acceptance criteria. Its identity survives a change of worker.

**Builder**: The model-driven participant authorized to work on a task's candidate. Only its current claim permits writing.

**Fresh successor**: A new Builder session continuing the same task from current shared state. It does not inherit the previous conversation.
_Avoid_: Resume, fork, transcript replay.

**Trusted checker**: The deterministic participant that checks an exact candidate against approved criteria and records observed evidence. It is not a second model agent.
_Avoid_: AI Verifier when referring to the first-release checker.

**Claim**: The current worker's authority to advance a task. Replacing that authority makes the previous worker's future actions stale.

**Human session**: An authenticated person's application access. It is distinct from a Builder's conversation.

## Memory and evidence

**Requirement**: A human-accepted obligation governing a task. A changed obligation creates a new accepted version.

**Observation**: An immutable record of something actually captured. An observation alone does not establish that an explanation is true.

**Attempt**: A source-backed action and observed outcome under stated conditions. Its lesson can be useful without being a universal rule.

**Checkpoint**: A sourced snapshot of working state that states which observations it covers. Later observations remain available for reconciliation.
_Avoid_: Complete transcript, hidden thinking, guaranteed final recap.

**Context packet**: The bounded current obligations and applicable evidence selected for a participant. It contains source references and explains omissions.

**Decision**: An explicitly accepted choice. An agent-written preference remains a proposal or observation until accepted.

**Procedure**: A versioned reusable sequence with explicit preconditions and supporting outcomes. A candidate procedure is distinct from one validated on compatible later work.

**Verification receipt**: A trusted record of actual checks against one candidate and set of conditions. A model statement or completed checklist cannot substitute for it.

**Source**: The original authorized evidence supporting a record. A digest or summary does not make missing source bytes available.

**Capture**: Recording permitted observable work. Capture does not require accepting it as reusable knowledge or forwarding it to another session.

**Condensation**: Producing a smaller representation of optional history. It preserves attribution and uncertainty and cannot replace governing obligations.
_Avoid_: Lossless summary, automatic proof, summary as authority.
