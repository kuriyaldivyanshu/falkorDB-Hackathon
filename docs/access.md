# Project reader credentials

A human project owner can issue a separate reader bearer credential through the
local authenticated API. The service creates a dedicated service principal and
reader grant for exactly that project. No native enrollment, session, qualified
harness identity or general account is created. Native capture and session to
session model use remain unqualified under N03.

This API is the supported issuance workflow. Earlier verification records that
inserted synthetic credentials into SQL describe test setup, not an operator
interface. There are no administrative CLI commands for these operations yet.

## Permissions

A reader can list its single project binding, inspect authorized current memory,
tasks, requirements, sources, bounded source ranges, history and operations. It
can read build capabilities. Principal-private evidence still requires ownership;
a reader grant does not expose other principals' private sources.

A reader can prepare bounded context and report only the occurrence belonging
to its exact principal and credential. These operations write server audit
metadata, never project knowledge. Emission remains self-reported. A caller
cannot report `native_observed` or manufacture native identity.

Readers cannot append public sources, propose/accept/correct memory, admit
episodes, create tasks, bind requirements, associate/administer projects, list
grants or administer credentials. Unsupported native enrollment, session
registration, claims and handoffs remain unavailable. Readers cannot access
another project or tenant or read installation status/backlog details. The same
policy applies to direct loopback HTTP calls; MCP's tool list is not the
permission boundary. Declaring `kind: "context_manifest"` or an `internal` field
does not permit public source writes. Context manifests use a trusted internal
metadata publication method and the common source file/catalog implementation.

## Owner API

All routes require a bearer header and an active human administrator credential
with a current owner grant on the path's project. The service rechecks stored
credential, principal, grant and project authority in the administration
transaction; the request cannot choose a tenant, principal, role, graph, secret,
hash, enrollment, session or wider scope.

```text
POST /v2/projects/:projectId/reader-credentials
GET  /v2/projects/:projectId/reader-credentials?limit=50
POST /v2/projects/:projectId/reader-credentials/:credentialId/revocation
```

Issuance accepts only `label`, explicit `idempotencyKey` and optional integer
`lifetimeSeconds`. Default lifetime is 86,400 seconds (24 hours), maximum 604,800
seconds (7 days), minimum one second. There is no refresh or renewal. Idle expiry
is fixed to the absolute deadline at issuance; successful requests do not slide
it. Both deadlines are checked, and idle expiry can never exceed absolute expiry.

List limit defaults to 50 and must be 1–100. Results are newest first with
`credentials` and `hasMore`; this checkpoint has no pagination cursor. Metadata
contains credential/project/principal IDs, label, fixed reader kind/role,
active/revoked/expired state and timestamps. It contains neither bearer nor token
hash. Revocation takes no body (or `{}`), names one credential in that project,
and repeat revocation preserves the first revocation timestamp. It revokes that
credential, its dedicated grant and service principal. Other credentials are
unaffected. Access administration is SQL-owned; no graph receipt is fabricated.

### One-time secret and retries

The service stores only the bearer hash. Successful first issuance returns
`{ secretDelivery: "initial", credential, bearer }` inside the normal
`{ ok: true, data }` envelope, with `Cache-Control: no-store`. Save the bearer
privately immediately; never print or copy the response into logs.

An exact retry scoped to the same actor principal/project/key returns the same
credential metadata with `secretDelivery: "not_repeated"` and **no bearer**.
Changing label or normalized lifetime under that key returns
`idempotency_mismatch`. Concurrent exact requests create one credential; only
the first committed issuance response contains the bearer. Default and explicit
86,400-second lifetimes are the same normalized request.

Retry never revives a revoked credential/grant or extends expiry. If the first
response is lost, repeat the exact request to recover its metadata, revoke that
credential ID, then issue another with a **new key**. The original secret is not
recoverable. If an operator file write fails after issuance, use the same
recovery. A lost revocation response can be retried safely.

## Authenticated operator workflow

Select the installation, loopback URL, existing project, output file and a fresh
issuance key. The output parent directory should be private. The following small
Node script reads the selected owner credential into memory, refuses output
file overwrite with exclusive creation, writes the reader bearer with mode 0600,
and prints only metadata and its path. Bearers never appear in argv or URLs.
The script uses Node.js 22 or later and built-in modules only.

Save this script as an explicitly selected local file, for example
`/tmp/threadline-access-operator.mjs`:

```javascript
import { readFile, open } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

const home = process.env.ACCESS_HOME;
const projectId = process.env.ACCESS_PROJECT;
const base = new URL(process.env.ACCESS_URL);
const action = process.argv[2];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!home || !isAbsolute(home) || !uuid.test(projectId ?? '') ||
    base.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(base.hostname) ||
    base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
  throw new Error('Select an absolute installation home, project UUID and loopback HTTP URL.');
}
const owner = JSON.parse(await readFile(join(home, 'credential.json'), 'utf8'));
if (owner.kind !== 'human_admin' || typeof owner.token !== 'string') {
  throw new Error('The selected installation has no human administrator credential.');
}
const route = `/v2/projects/${projectId}/reader-credentials`;
async function api(method, path, body) {
  const response = await fetch(new URL(path, base), {
    method, cache: 'no-store',
    headers: { authorization: `Bearer ${owner.token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    // Print only the bounded code; never dump headers or the full response.
    throw new Error(`Access request refused: ${result.error?.code ?? response.status}`);
  }
  return result.data;
}
if (action === 'issue') {
  const output = process.env.ACCESS_OUTPUT;
  const key = process.env.ACCESS_KEY;
  if (!output || !isAbsolute(output) || !key) throw new Error('Select an absolute output path and issuance key.');
  const lifetime = process.env.ACCESS_LIFETIME_SECONDS;
  const request = { label: process.env.ACCESS_LABEL ?? 'Project MCP reader',
    idempotencyKey: key,
    ...(lifetime === undefined ? {} : { lifetimeSeconds: Number(lifetime) }) };
  // Reserve before issuing so an existing output can never consume a new secret.
  // On failure this may leave an empty file. Inspect it before choosing a new path.
  const file = await open(output, 'wx', 0o600);
  try {
    const result = await api('POST', route, request);
    console.log(JSON.stringify({ secretDelivery: result.secretDelivery, credential: result.credential }));
    if (result.secretDelivery === 'not_repeated') {
      throw new Error('Secret was already delivered. Revoke this credential and issue with a new key.');
    }
    if (!/^tl_[A-Za-z0-9_-]{43}$/.test(result.bearer ?? '')) throw new Error('Invalid issuance response.');
    await file.writeFile(`${result.bearer}\n`, 'utf8');
    await file.sync();
    console.log(`Reader credential saved: ${output}`);
  } finally { await file.close(); }
} else if (action === 'list') {
  console.log(JSON.stringify(await api('GET', `${route}?limit=50`), null, 2));
} else if (action === 'revoke') {
  const id = process.env.ACCESS_CREDENTIAL_ID;
  if (!uuid.test(id ?? '')) throw new Error('Select the credential UUID to revoke.');
  console.log(JSON.stringify(await api('POST', `${route}/${id}/revocation`), null, 2));
} else {
  throw new Error('Choose issue, list or revoke.');
}
```

Run with your explicit installation and service settings (replace illustrative
paths and UUID). Environment values below contain selectors, never bearers:

```sh
export ACCESS_HOME=/absolute/selected/threadline-home
export ACCESS_URL=http://127.0.0.1:47822
export ACCESS_PROJECT=11111111-1111-4111-8111-111111111111
export ACCESS_OUTPUT=/absolute/private/project-reader.token
export ACCESS_LABEL='Project MCP reader'
export ACCESS_KEY=project-reader-issuance-1
node /tmp/threadline-access-operator.mjs issue
node /tmp/threadline-access-operator.mjs list
```

To recover a lost response, re-run `issue` with the **same request/key** and a
new empty output path; it prints metadata and explicitly refuses secret recovery.
If the previous attempt left an empty reserved file, inspect it before selecting
a different path. Then select the returned credential ID and revoke it:

```sh
export ACCESS_CREDENTIAL_ID=22222222-2222-4222-8222-222222222222
node /tmp/threadline-access-operator.mjs revoke
```

Issue the replacement with a new key and an unused output path. To revoke a
normally delivered credential, use its ID from initial metadata or `list`.
Retain only the token files you intentionally want to use.

## Existing MCP token-file input

Use the raw token file saved above with the implemented MCP server. Configuration
and destination still come from the explicitly selected installation:

```sh
threadline mcp --home /absolute/selected/threadline-home \
  --project 11111111-1111-4111-8111-111111111111 \
  --token-file /absolute/private/project-reader.token
```

Alternatively set `THREADLINE_MCP_TOKEN_FILE` to that file path and pass the same
explicit `--home` and `--project`. Do not replace the installation's owner
`credential.json` with a reader file. MCP startup verifies its project binding
through authenticated HTTP; another project is refused. The six existing MCP
tools remain read-only. Backend context is available over the existing HTTP
contract; this checkpoint adds no context client or native integration.

## Release consistency and storage

Revoked/expired credentials fail new authentication requests. Context preparation
and replay recheck current token, principal, grant and project state with
PostgreSQL `clock_timestamp()` after selection, validation and the final graph
snapshot read, immediately before returning from the SQL transaction. Revocation
committed before that final authorization statement's snapshot prevents release.
Revocation does not wait on the context advisory project lock, so it can commit
during selection. Ordinary SQL row locks can still serialize administration
with audit publication; a blocked revocation has not committed yet. An expiry that occurs during preparation also blocks release.

The final authorization statement is the access consistency boundary. A
revocation committed after that statement begins, a later expiry, SQL commit
latency and network transit can occur after that check. Revocation cannot recall
bytes already returned. This is not a distributed transaction across SQL, graph
and the client. Existing selection, privacy, source visibility, task/head replay
and rendering guarantees remain described in [the context guide](context.md).

Migration 6 adds reader token constraints and a small forced-RLS issuance catalog
containing scoped identities, label and request/key digests. It retains no
recoverable plaintext bearer, adds no graph schema and preserves applied
migrations 1–5. Setup retains the restricted application role and the same three
narrow cross-tenant lookup/worker functions. Apply migrations only through an
explicitly selected authorized installation; see [storage safety](storage-recovery.md).
