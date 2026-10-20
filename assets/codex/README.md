# Codex preview assets

Preview artifacts for the future Codex installation step. Nothing here is
installed, executed or read by any Threadline command at startup; the files
exist so the reviewed bytes and the compatibility facts can be inspected
without running anything.

- `compatibility.json` — the qualification metadata: installed version,
  observed hook/MCP surface, documented behavior and the explicit unverified
  list. It is authored metadata, not a machine contract.
- `preview/` — a frozen example of the qualification renderer's output for
  `packages/cli/src/codex/config-preview.ts` with placeholder paths. It still
  contains hook entries for `threadline codex-hook`, with historical arguments
  that omit the now-required explicit routing/reader configuration. It remains
  reference material rather than an installable profile.
- `preview/mcp-only/` — a frozen example of the output of
  `packages/cli/src/codex/mcp-preview.ts`, the renderer behind
  `threadline codex:preview`. This remains the default profile shape: the stdio
  MCP server and no hook entry.

The original checked-in preview sets are snapshots of their renderers, generated with
these inputs:

```js
// preview/  (qualification renderer, MCP + hooks)
renderCodexConfigPreview({
  codexHome: '/Users/example/.codex',
  executable: '/usr/local/bin/node',
  entryScript: '/opt/threadline/bin/codex-entry.mjs',
  threadlineHome: '/Users/example/.threadline',
});

// preview/mcp-only/  (shipped renderer, MCP only, project-bound)
renderCodexMcpPreview({
  codexHome: '/Users/example/.codex',
  executable: '/usr/local/bin/node',
  entryScript: '/opt/threadline/bin/codex-entry.mjs',
  threadlineHome: '/Users/example/.threadline',
  projectId: '00000000-0000-4000-8000-000000000001',
});
```

`threadline codex:preview --project <uuid>` renders the live equivalent of
`preview/mcp-only/` against your own paths. It writes nothing and renders no
credential. The profile is selected with `codex --profile threadline`. Explicit
`--context-hooks` entries require native trust review
(`/hooks`) before they run; the MCP-only profile has no hook entry to trust.

## Explicit context retrieval preview

`preview/context-read/` is the shipped renderer's explicitly enabled context
profile, generated with the same placeholder paths/project above and
`contextTools: true`. It adds the real `--context-tools` argument, no hook or
bearer. `threadline codex:preview --project <uuid> --context-tools` renders this
shape without writing configuration. The six default read-only tools remain;
only `threadline_context_prepare` is added, with preparation audit writes and
no accepted-knowledge mutation or delivery report. See
[context clients](../../docs/context-client.md). Authored preview inspection
establishes configuration bytes, not actual native/model use. Ownership and
collision classification remain unchanged.

## Explicit context-only hook preview

`preview/context-hook/` contains a new placeholder example of the shipped
renderer with contextHooks configured (reader token-file, workspace root,
selector file and 2,000 ms total handler budget). Only SessionStart and
UserPromptSubmit are owned; additionalContextLimit is zero because the handler
enforces a strict UTF-8 byte cap. MCP uses the same selected reader file and
keeps six tools unless --context-tools is independently requested. No bearer
is rendered. The manifest explicitly labels this new hook route unqualified.

These files are review assets, not installed configuration or native execution
evidence. See [the hook guide](../../docs/codex-context-hook.md) for the complete
command, limits and separately authorized synthetic live-probe procedure.
Historical preview files and compatibility/schema digests are unchanged.
