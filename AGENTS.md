# Repository Guidelines

## Project Structure & Module Organization

Threadline is a TypeScript/npm workspace for a local coding harness and FalkorDB Track 2 memory and coordination tool.

- `packages/shared/` contains the public protocol, event, identifier, health, and error contracts.
- `packages/backend/` contains backend composition, domain dispatch, HTTP routes, event streaming, and backend tests.
- `packages/cli/` contains the terminal client, TUI, and transport client.
- `archive/notes/` and `archive/plans/` retain architecture decisions, research, schemas, delivery plans, and historical alternatives.
- `README.md` indexes the documentation and identifies the current recommendation.

Before changing architecture or delivery guidance, read the four documents under README's **Start here** section. The owned npm/TUI proposal takes precedence over earlier web-first and independent SDK proposals. M01 persistence, local sessions and accepted-goal admission are merged. M02 run control, owned provider transport and read-only tools are locally integrated with real stores and an injected test provider. The user-selected Space Bunny model/tool compatibility gate has passed; live OpenAI account access, continuity and protected completion are not available. When changing M02 run/provider/tool code, read `docs/m02-development.md` for implemented seams and pending integration gates.

## Build, Test, and Development Commands

Use Node.js 22 or later and npm from the repository root:

- `npm run build` — build all workspace packages with TypeScript project references.
- `npm test` — build, then run each workspace's tests.
- `npm start --workspace @threadline/backend` — start the local backend.
- `node packages/cli/dist/index.js tui` — start the TUI after building.
- `node packages/cli/dist/index.js health` and `node packages/cli/dist/index.js echo "hello"` — exercise the development CLI commands.

Accepted M01 goal/task authority is durable when storage is configured. Echo and SSE remain process-local and non-replayable. OpenAI paid model/tool testing remains deferred. The user separately authorized completing M02 on 16 October 2026; Space Bunny passed the full model/read-tool/next-turn/final-response gate. See docs/m02-live-acceptance.md. This completed acceptance does not authorize unattended future live inference. Use local transport fixtures for ordinary tests. API-key provider selection is documented in docs/provider-configuration.md. Commands in architecture notes describe proposed future workflows unless they are listed above.

## Documentation Style & Naming Conventions

Use Markdown with one descriptive H1, hierarchical headings, short paragraphs, and fenced code blocks with language identifiers. Keep list indentation consistent with surrounding content. Use lowercase, hyphen-separated filenames; follow `track2-<topic>.md` for Track 2 notes. Add new documents to the relevant index using relative links. Include evidence dates and primary-source links for researched claims. Clearly distinguish proposals, documented capabilities, and tested behavior; preserve historical notes and identify superseded assumptions.

## Testing Guidelines

Run `npm test` for changes to workspace code. For documentation-only changes, check changed Markdown, relative links, code fences, and consistency with current decisions. When reporting experiments, include versions, setup, observable results, and limitations. Recovery, isolation, persistence, and load checks remain proposed acceptance gates until executed.

## Commit & Pull Request Guidelines

Use concise imperative commit subjects, such as `docs: clarify native adapter recovery`. PR descriptions should state affected packages or documents, behavior or decision changes, supporting sources, and validation performed; link relevant issues when available.

## Security & Configuration

Keep credentials, tokens, and private transcripts out of notes, source, and examples. Use authored, public, or synthetic demonstration data and placeholders for secrets.
