# Figma destination and architecture exports

**Status: 14 October 2026. The connector is accessible again.** The latest request authorizes removing the analysis module from existing diagrams. Read-only metadata inspection of the supplied Design file succeeded and returned one empty page (`0:1`, “Page 1”), with no design nodes to update. No remote mutation was needed or performed.

Destination: [Threadline Design file](https://www.figma.com/design/9g6NAYfnHlTgjuIUI15hAu). File key: `9g6NAYfnHlTgjuIUI15hAu`. The earlier FigJam board was superseded by this project destination.

## Connector inspection

The earlier missing-connection and backend unknown-tool failures are historical. This inspection reloaded the available tool schema and used the exact previously discovered Figma connection ID, independently of the file key. The top-level page listing and subsequent page inspection both succeeded. This establishes read access; it does not claim a tested write/import operation.

## Updated local assets

- [Full architecture SVG](threadline-architecture.svg).
- [Complete PostgreSQL field schema SVG](threadline-postgresql-schema.svg).
- [Complete FalkorDB node/property schema SVG](threadline-falkordb-schema.svg).
- [Graph relationship catalog SVG](threadline-graph-relationships.svg).

All four vector exports were regenerated again on 15 October 2026 for the controlling two-person blueprint, checkpoint pointers and service checker identities. The current target has 33 SQL tables (31 core and two native/OAuth extensions), 31 graph labels and 82 typed endpoint relationships. The architecture shows the typed-tool loop, memory, durable sessions and one Builder, fresh successor and protected checker.

These are local exports; they have not been uploaded. SQL constraints and graph relationship semantics remain in the linked dictionaries and DDL. Importing an SVG yields vector/text artwork, not database-aware entities or automatic semantic connectors.

For editable relationship sources, use the [Mermaid atlas](../track2-diagram-atlas.md), [relational dictionary](../schema/relational-field-dictionary.md), [graph dictionary](../schema/graph-field-dictionary.md) and model JSON alongside these boards.
