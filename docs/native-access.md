# Native enrollment and provisional session access

Human project owners can approve an enrollment for an existing active workspace
binding, issue a dedicated producer bearer once, inspect/list/revoke metadata and
register one provisional session. These are backend HTTP operations. No native
capture, configuration installation, qualified Codex adapter, strong identity or
model-issued knowledge mutation is provided. N03 remains incomplete.

An enrollment has its own stable identity, separate from its credential. The
server derives its tenant, project, dedicated service principal, reader grant,
producer token kind and permissions. A path or reported native thread ID grants
no access. Select the `binding.bindingId` returned by the existing human
`project:add` association workflow; issuance accepts no filesystem path.

## HTTP contract

All routes require a bearer header and return the normal `{ ok, data }` or
`{ ok: false, error }` envelope. Native access responses use
`Cache-Control: no-store`.

```text
POST /v2/projects/:projectId/enrollments
GET  /v2/projects/:projectId/enrollments?limit=50
GET  /v2/projects/:projectId/enrollments/:enrollmentId
POST /v2/projects/:projectId/enrollments/:enrollmentId/revocation
POST /v2/native-sessions
GET  /v2/projects/:projectId/sessions?limit=50
```

Issuance accepts only `bindingId`, `label` (1–256 UTF-8 bytes), explicit
`idempotencyKey` (1–200 bytes) and optional integer `lifetimeSeconds`. Defaults
to 86,400 seconds (24 hours), minimum 1 second, maximum 604,800 seconds (7 days).
Idle and absolute expiry are equal and fixed. Authentication never extends them;
there is no renewal or refresh endpoint.

The first issuance returns `{ secretDelivery: "initial", enrollment, bearer }`.
SQL retains only the bearer hash. Exact actor-principal/project/key retries
return `{ secretDelivery: "not_repeated", enrollment }` without the bearer.
Default and explicit 86,400 seconds normalize identically. Changed requests
under the same key refuse with `idempotency_mismatch`. Concurrent exact requests
have one effect and at most one response containing the secret. A retry never
revives a revoked/expired enrollment or extends its deadline.

If the issuance response or local secret write is lost, repeat the same request
and key to recover the enrollment ID, revoke that enrollment, then issue a fresh
one using a new key and unused output file. There is no secret recovery. Keep
the IDs from responses for inspection and revocation.

Lists default to 50 entries and accept limits 1–100. They return `enrollments`
or `sessions`, newest first, plus `hasMore`; there is no cursor. Enrollment
metadata includes enrollment, credential, principal, project and binding IDs,
label, harness, generation, optional pinned session ID, effective
active/revoked/expired state and timestamps. It exposes no secret, hash,
filesystem root or stored issuance digests. Revocation accepts no body or `{}`;
retries preserve the first revocation timestamp and close its pinned session,
revoke its bearer, reader grant and dedicated principal. Other enrollments are
unaffected. These operations create no graph receipt.

## Permissions

- An active human administrator with a current owner grant can issue, list,
  inspect and revoke enrollments and list project sessions. Stored owner
  authority is rechecked and locked in each administration transaction.
- A producer before pinning can inspect only its own enrollment and register
  its one session. Project reads, capabilities and context preparation refuse.
- A pinned producer can inspect its own enrollment/session, read its authorized
  project memory, tasks, sources, history, operations and capabilities, prepare
  context naming its pinned session and report only its own context occurrence.
  Principal-private evidence still requires ownership.
- Producers cannot append public sources, propose/accept/correct memory, record
  episodes, create tasks, bind requirements, associate projects, list grants,
  administer credentials/enrollments or acquire claims/handoffs. Supplying
  `kind: "context_manifest"` or `internal` does not permit a source write.
  Context preparation writes server audit metadata only.
- Reader credentials retain [their existing permissions](access.md) and cannot
  administer native access, inspect enrollments/sessions or register sessions.
  Human member grants cannot administer native access either.

These checks apply at HTTP and core service entry points. Native observation
and model knowledge writes remain unavailable. Each enrolled producer has a
separate service principal. A human owner cannot attribute a source append or
context request to any enrolled producer's session, including a session from an
enrollment that owner issued. Human source appends without native-session
attribution remain supported. Producers cannot append public sources; context
preparation uses a separate trusted internal path to record its audit manifest.

## Safe operator example

Use Node.js 22 or later. Save this script as an explicitly selected local file,
for example `/tmp/threadline-native-access.mjs`. It reads the owner credential
from an absolute installation home, or a producer from an absolute raw token
file, exclusively creates a 0600 output file, and prints metadata only. Choose
a private parent directory. Bearers never appear in argv, URLs or output.

```javascript
import { readFile, open } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

const home = process.env.NATIVE_HOME;
const project = process.env.NATIVE_PROJECT;
const base = new URL(process.env.NATIVE_URL);
const action = process.argv[2];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!home || !isAbsolute(home) || !uuid.test(project ?? '') ||
    base.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(base.hostname) ||
    base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
  throw new Error('Select an absolute home, project UUID and loopback HTTP URL.');
}
const producer = ['register', 'self', 'own-sessions'].includes(action);
let token;
if (producer) {
  const file = process.env.NATIVE_TOKEN_FILE;
  if (!file || !isAbsolute(file)) throw new Error('Select an absolute producer token file.');
  token = (await readFile(file, 'utf8')).trim();
} else {
  const owner = JSON.parse(await readFile(join(home, 'credential.json'), 'utf8'));
  if (owner.kind !== 'human_admin') throw new Error('Select a human administrator installation.');
  token = owner.token;
}
if (!/^tl_[A-Za-z0-9_-]{43}$/.test(token ?? '')) throw new Error('Invalid local credential.');
const collection = `/v2/projects/${project}/enrollments`;
function enrollmentPath() {
  const id = process.env.NATIVE_ENROLLMENT;
  if (!uuid.test(id ?? '')) throw new Error('Select an enrollment UUID.');
  return `${collection}/${id}`;
}
async function api(method, path, body) {
  const response = await fetch(new URL(path, base), {
    method, cache: 'no-store',
    headers: { authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    throw new Error(`Request refused: ${result.error?.code ?? response.status}`);
  }
  return result.data;
}
if (action === 'issue') {
  const output = process.env.NATIVE_OUTPUT;
  const bindingId = process.env.NATIVE_BINDING;
  const idempotencyKey = process.env.NATIVE_KEY;
  if (!output || !isAbsolute(output) || !uuid.test(bindingId ?? '') || !idempotencyKey) {
    throw new Error('Select absolute output, existing binding UUID and explicit issuance key.');
  }
  const request = { bindingId, label: process.env.NATIVE_LABEL ?? 'Approved adapter',
    idempotencyKey, ...(process.env.NATIVE_LIFETIME_SECONDS === undefined ? {} :
      { lifetimeSeconds: Number(process.env.NATIVE_LIFETIME_SECONDS) }) };
  // Reserve before issuing. Failure can leave an empty file; inspect it before
  // choosing a new path. Recover any issued identity through the same key.
  const file = await open(output, 'wx', 0o600);
  try {
    const result = await api('POST', collection, request);
    console.log(JSON.stringify({ secretDelivery: result.secretDelivery, enrollment: result.enrollment }));
    if (result.secretDelivery !== 'initial') {
      throw new Error('Secret unavailable: revoke the recovered enrollment and issue with a new key.');
    }
    if (!/^tl_[A-Za-z0-9_-]{43}$/.test(result.bearer ?? '')) throw new Error('Invalid issuance response.');
    await file.writeFile(`${result.bearer}\n`, 'utf8');
    await file.sync();
    console.log(`Producer saved: ${output}`);
  } finally { await file.close(); }
} else if (action === 'list') {
  console.log(JSON.stringify(await api('GET', `${collection}?limit=50`)));
} else if (action === 'inspect' || action === 'self') {
  console.log(JSON.stringify(await api('GET', enrollmentPath())));
} else if (action === 'revoke') {
  console.log(JSON.stringify(await api('POST', `${enrollmentPath()}/revocation`)));
} else if (action === 'sessions' || action === 'own-sessions') {
  console.log(JSON.stringify(await api('GET', `/v2/projects/${project}/sessions?limit=50`)));
} else if (action === 'register') {
  if (!process.env.NATIVE_KEY || !process.env.NATIVE_INSTANCE_NONCE || !process.env.NATIVE_ADAPTER_VERSION) {
    throw new Error('Select stable registration key, instance nonce and reported adapter version.');
  }
  console.log(JSON.stringify(await api('POST', '/v2/native-sessions', {
    expectedBindingGeneration: 1, idempotencyKey: process.env.NATIVE_KEY,
    adapterInstanceNonce: process.env.NATIVE_INSTANCE_NONCE,
    harnessVersion: process.env.NATIVE_ADAPTER_VERSION,
  })));
} else throw new Error('Choose issue, list, inspect, revoke, sessions, self, register or own-sessions.');
```

Replace illustrative paths and UUIDs with your selected installation/project
and an existing active binding. Environment values here contain selectors only:

```sh
export NATIVE_HOME=/absolute/selected/threadline-home
export NATIVE_URL=http://127.0.0.1:47822
export NATIVE_PROJECT=11111111-1111-4111-8111-111111111111
export NATIVE_BINDING=22222222-2222-4222-8222-222222222222
export NATIVE_OUTPUT=/absolute/private/adapter.token
export NATIVE_KEY=approved-adapter-issuance-1
node /tmp/threadline-native-access.mjs issue
node /tmp/threadline-native-access.mjs list

# Set this to the enrollment ID returned above.
export NATIVE_ENROLLMENT=33333333-3333-4333-8333-333333333333
node /tmp/threadline-native-access.mjs inspect
export NATIVE_TOKEN_FILE=/absolute/private/adapter.token
node /tmp/threadline-native-access.mjs self
export NATIVE_KEY=adapter-registration-1
export NATIVE_INSTANCE_NONCE=chosen-stable-instance-nonce-1
export NATIVE_ADAPTER_VERSION=manual-registration-1
node /tmp/threadline-native-access.mjs register
node /tmp/threadline-native-access.mjs own-sessions
node /tmp/threadline-native-access.mjs sessions
node /tmp/threadline-native-access.mjs revoke
```

The script demonstrates HTTP registration only. It does not launch Codex or
capture a conversation. Use a new issuance key/output path after revocation.
For lost-response recovery, restore the original issuance key/request and select
another unused output path before retrying `issue`, then revoke the recovered ID.

## Pinning and identity limits

Registration accepts only `expectedBindingGeneration`, explicit
`idempotencyKey`, bounded `adapterInstanceNonce` and `harnessVersion`, optional
bounded nullable `nativeThreadRef` and `parentThreadRef`, and optional
`identityPrecision: "provisional"` / `captureCoverage: "unknown"`. It derives
enrollment, workspace binding and principal from authentication. Strong identity,
supported/partial coverage, caller routing and unknown fields refuse. Native
references are reported hints and can repeat across enrollments.

Generation starts at 1 and is immutable. Its wire guard is an integer in
1–2,147,483,647 (the SQL integer range), but only stored generation 1 matches.
Actual int64 source/event/privacy counters retain decimal-string handling.
Registration stores a server-scoped instance fingerprint, key digest and request
digest in one fenced SQL transaction. The locked enrollment plus unique pin and
conditional update admit one session. Identical request/key retries return the
same session, changed requests refuse, and competing different registrations
have one winner. Registration retry does not update timestamps or expiry.

Replace an instance by owner revocation followed by fresh enrollment/credential.
There is no rebind/rotation endpoint. A shared bearer cannot distinguish two
processes replaying the same nonce and request. Registration proves server scope,
not possession by a particular native process, observed conversation, native
ordering, fork/subagent identity or protected completion. Source `session_seq`
remains null; this checkpoint establishes no capture ordering.

The [official hook documentation](https://learn.chatgpt.com/docs/hooks), checked
on 18 October 2026, reports parent session IDs for subagent hooks and an unstable
transcript format. Those documented fields do not qualify this installed adapter;
the existing native-runtime verification gates remain open.

## Release consistency and migration

Authentication validates current token, principal, grant, enrollment, binding,
generation and pinned-session state. A closed session makes its producer unusable.
Context preparation and replay recheck these facts in the final advancing-clock
SQL authorization statement after graph reads and packet validation. A committed
revocation, binding/grant/session/token change or expiry visible before that
statement prevents release. Own occurrence updates/retries also recheck before
commit. Enrollment revocation does not take the context advisory project lock.

That final statement snapshot is the access boundary. A later change/expiry,
commit latency and network transit remain outside it; bytes already returned
cannot be recalled. SQL row locks may delay a revocation, which is not committed
while blocked. The existing [context selection and replay guarantees](context.md)
remain in force.

Migration 7 adds SQL-owned enrollment metadata and pin constraints, corrects the
session enrollment foreign key formerly pointing at credentials, and retains
forced RLS, the restricted application role and exactly the same three narrow
privileged functions. Migrations 1–6 are unchanged. Populated supported v6
human/reader/source data needs no native backfill and is preserved. No prior
released API issued native authority: any legacy producer, enrollment-bearing
token, session-bearing token or native-session row causes an actionable atomic
`schema_incompatible` refusal. Preserve that database and obtain operator review;
this migration neither deletes those rows nor invents enrollment approval.
There is no graph schema change, database reset or automatic configuration install.
Use only an explicitly selected authorized installation for migration, following
[storage recovery guidance](storage-recovery.md).

Later work must integrate a permitted visible-capture service with stable delivery
identity and explicit gaps, plus separately authorized installed-Codex runtime
qualification for hooks, bounded delivery, MCP host metadata and fork/subagent
correlation. The [native qualification record](native-integration-contract.md)
remains evidence about its stated boundaries only. B's context-only hook uses
the existing reader API and does not depend on this enrollment contract.
