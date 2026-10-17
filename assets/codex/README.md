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
  contains hook entries for `threadline codex-hook`, which this build does not
  implement, so it is reference material rather than an installable profile.
- `preview/mcp-only/` — a frozen example of the output of
  `packages/cli/src/codex/mcp-preview.ts`, the renderer behind
  `threadline codex:preview`. This is the profile shape this build actually
  produces: the stdio MCP server and no hook entry.

Both preview sets are generated, not hand-edited, so the checked-in examples
cannot drift from their renderers:

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
credential. The profile is selected with `codex --profile threadline`. Hook
entries, if they are ever rendered again, require native trust review
(`/hooks`) before they run; the MCP-only profile has no hook entry to trust.