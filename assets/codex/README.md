# Codex preview assets

Preview artifacts for the future Codex installation step. Nothing here is
installed, executed or read by any Threadline command in this build; the files
exist so the reviewed bytes and the compatibility facts can be inspected
without running anything.

- `compatibility.json` — the qualification metadata: installed version,
  observed hook/MCP surface, documented behavior and the explicit unverified
  list. It is authored metadata, not a machine contract.
- `preview/threadline.config.toml` — a frozen example of the renderer's output
  for `packages/cli/src/codex/config-preview.ts` with placeholder paths.
- `preview/threadline-codex.manifest.json` — the matching ownership manifest.

The two preview files are generated, not hand-edited, so the checked-in
examples cannot drift from `packages/cli/src/codex/config-preview.ts`:

```js
renderCodexConfigPreview({
  codexHome: '/Users/example/.codex',
  executable: '/usr/local/bin/node',
  entryScript: '/opt/threadline/bin/codex-entry.mjs',
  threadlineHome: '/Users/example/.threadline',
});
```

A public command that regenerates them (`threadline codex config-preview`) is
not implemented in this build; a later assignment adds the entry point. The
`mcp` and `codex-hook` entry points referenced by the preview do not exist yet
either. The profile is selected with `codex --profile threadline`, and its
hooks require native trust review (`/hooks`) before they run.
