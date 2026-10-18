# Inventory exporter memory demonstration

This public authored example supports the Codex-first memory demo. It contains [a schema-v2 manifest](manifest.json) and [a deliberately imperfect seed](seed/src/exporter.mjs).

## What is retained

- Inventory input/output rules and public cases, including malformed input and CSV escaping.
- An initial freshness requirement of 600 seconds and a later human-approved value of 60 seconds.
- A mixed-offset timestamp case exposing the seed's deliberate failure to normalize UTC.
- A distinct compatible reuse example and an incompatible JSON-output contract.

The defect is authored demonstration data, not an observed mistake by a model. The manifest's expected outputs are a specification, not passing evidence.

## How to use it

For the implemented baseline, follow the [human memory walkthrough](../../docs/memory-demo.md):
copy the seed into a disposable directory, run one explicitly selected public
case and capture the actual stdout, stderr and exit status as evidence. The
service does not independently check those recorded bytes. This demonstrates
persistence and read-only MCP recall, not model use.

For a later separately authorized native demonstration, copy the seed into an
explicitly selected native-agent demo worktree and run Codex there under its
normal permissions. Record actual observed failures/outcomes as Sources, accept the requirement change explicitly, then start a distinct session and inspect which current memory it receives.

Keep this seed unchanged while a demo copy is edited. A generic implementation may already handle the new freshness value; demonstrate current checked output without inventing a second code change.

The manifest has no owned checker, protected receipt, candidate-mount or agent-launch contract. Threadline supplies memory; a human or separate temporary verification command compares actual outputs with the public cases. No automatic fixture copying or execution belongs in backend startup.
