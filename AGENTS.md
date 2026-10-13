# Repository Guidelines

## Project Structure & Module Organization

This is a documentation-only architecture and research export for **Threadline**, a proposed FalkorDB Track 2 memory and coordination tool.

- `README.md` indexes the collection and identifies the current recommendation.
- `notes/track2-*.md` contains architecture decisions, adapter investigations, delivery plans, and historical alternatives.
- `notes/falkordb-*.md` and `notes/agentic-rag-memory-evaluation.md` provide technical research.

There are no source, test, or asset directories. Before changing architecture or delivery guidance, read the four documents under README's **Start here** section. The local npm/TUI proposal takes precedence over earlier web-first and independent SDK proposals.

## Build, Test, and Development Commands

No build, runtime, dependency manifest, or automated validation tooling is configured. Useful documentation commands from the repository root:

- `rg --files` — list documents before adding or moving files.
- `rg -n '^#{1,3} ' README.md notes/` — inspect headings and locate related sections.
- `rg -n 'search term' README.md notes/` — find claims that may need coordinated updates.

Commands shown inside architecture notes describe proposed workflows; they are not working repository entry points.

## Documentation Style & Naming Conventions

Use Markdown with one descriptive H1, hierarchical headings, short paragraphs, and fenced code blocks with language identifiers. Keep list indentation consistent with surrounding content. No formatter or linter is configured.

Use lowercase, hyphen-separated filenames; follow `track2-<topic>.md` for Track 2 notes. Add new documents to `README.md` using relative links. Include evidence dates and primary-source links for researched claims. Clearly distinguish proposals, documented capabilities, and tested behavior; preserve historical notes and identify superseded assumptions.

## Testing Guidelines

No test framework or coverage target exists. Preview changed Markdown, verify relative links and code fences, and check consistency with current decisions. When reporting experiments, include versions, setup, observable results, and limitations. Recovery, isolation, persistence, and load checks remain proposed acceptance gates until executed.

## Commit & Pull Request Guidelines

This export has no Git metadata, so existing commit conventions cannot be verified. In a Git checkout, use concise imperative subjects, such as `docs: clarify native adapter recovery`. PR descriptions should state affected documents, decision changes, supporting sources, and validation performed; link relevant issues when available.

## Security & Configuration

Keep credentials, tokens, and private transcripts out of notes and examples. Use authored, public, or synthetic demonstration data and placeholders for secrets.
