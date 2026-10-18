# Bounded context preparation

The backend exposes one authenticated context selector over canonical FalkorDB
memory, task requirements and SQL source history. CLI, MCP and native context
adapters are not implemented by this checkpoint. No native session, emission,
model comprehension or reusable procedure validation is inferred from preparation.

FalkorDB supplies the consequential selection state: Task → REQUIRES → Memory →
CURRENT → MemoryVersion, accepted decision/fact/episode content, applicability and
the project epoch/event head. SQL supplies access, source metadata and audit
records. A graph outage makes current-context preparation unavailable while SQL
source history remains usable; the graph is required for recovery and release.

## Endpoints and authorization

```text
POST /v2/context
POST /v2/context/occurrences
GET  /v2/operations/:operationId?projectId=<uuid>
```

Every request needs a bearer credential authorized for the requested project.
An active reader grant may prepare a packet: preparation records an audit Source
and occurrence but changes no accepted memory. Occurrence reports belong to the
exact preparing principal and token, within the tenant/project. A supplied session
must be active and owned by that principal; a session-bound credential must name
its own stored session. No registration or synthetic session is created to make
preparation succeed. Enrollment and native observation remain unavailable.

Both absolute and idle credential expiry use PostgreSQL `clock_timestamp()` at
release checks, which advances during a transaction. Fresh preparation and replay
perform their final authorization query after packet validation and graph reads,
immediately before returning to SQL commit. A credential that expires during
selection refuses release; the pending audit transaction rolls back. This check
cannot promise validity after commit or while a response travels to a client.

Example request (replace illustrative UUIDs with authorized stored identities):

```json
{
  "projectId": "11111111-1111-4111-8111-111111111111",
  "taskId": "22222222-2222-4222-8222-222222222222",
  "idempotencyKey": "inventory-context-boundary-1",
  "maxBodyBytes": 4096,
  "focus": "UTC",
  "conditions": {
    "selectionHints": [
      { "key": "contract_version", "values": ["v1"] },
      { "key": "runtime", "values": ["node22"] }
    ]
  }
}
```

`taskId`, `nativeSessionId`, `focus` and `conditions` are optional. Omitting the
task produces project context without mandatory requirements or a known task
family. Unknown request fields, duplicate hint keys and invalid/beyond-bound
values refuse. An idempotency key is required, nonempty and at most 200 UTF-8
bytes. Focus is at most 1024 bytes and is never treated as a runtime fact.

## Mandatory authority

The task supplies stable required Memory identities and its opaque revision.
Each identity must have exactly one accepted current version in the project
graph. A missing, proposed-only, ambiguous, retracted or unreadable head refuses
the packet. Semantic statements are supplied exactly, including whitespace and
multibyte characters. They are never excerpted or replaced by references to fit.

Requirements are sorted by stable identity. A correction moves current authority:
a 60-second freshness correction replaces the 600-second statement. Historical
`observedUnder.parameters.freshness` remains historical and cannot restore an
obsolete obligation.

## Optional selection and applicability

Collection first retrieves at most 33 semantic/episodic Memory identities, ordered
by creation time descending and stable identity ascending. Only the first 32 are
candidates; the extra identity signals `candidate_limit`. Its count names only
the observed extra candidate, not the total number of older omitted memories. The database applies
this bound before version traversal. Each candidate resolves at most three
current-head rows to detect ambiguity, then reads only that named version.
Proposals never become optional authority. Optional semantic requirements are
excluded unless the task requires them; accepted decisions and facts are eligible.
Accepted episodes are eligible with their stored precision and outcome intact.

Within that bounded window, selection priority is:

1. Episodes with failed, denied, interrupted or unknown outcomes.
2. Accepted decisions.
3. Accepted scoped facts.
4. Episodes with succeeded outcomes.

A case-insensitive full focus-string match ranks within a priority. Remaining ties
use creation time descending, then stable Memory identity ascending. Focus does
not expand the candidate window or infer facts, authority, outcomes or evidence.
A bounded window can omit older relevant material; its limit is reported.

All applicability predicates must match. `task_family` comes exclusively from the
stored task and cannot be supplied as a hint. The other allowlisted keys are
`schema_version`, `contract_version`, `runtime`, `tool`, `path_scope` and
`parameter`. Each can carry up to 16 nonempty, bounded string values in
`conditions.selectionHints`. These are caller assertions for selection, explicitly
not authenticated runtime facts or evidence of native identity/execution.

`equals` needs one actual value and one identical predicate value. `in` needs a
nonempty predicate set containing every supplied value. `present` requires a
known nonempty value set and no predicate values. Unknown conditions and malformed
operator/value combinations never match. Matching is literal; there is no path
normalization, free-text parameter interpretation or inferred prerequisite.

`observedUnder` is never used as current applicability. Thus a UTC lesson whose
conditions still match survives an unrelated freshness correction. An incompatible
or unknown output contract excludes optional advice that requires that contract.

Every released item carries separate `applicability` and `observedUnder` fields.
The renderer labels the former as current selection predicates (caller hints are
not verified facts), and the latter as historical conditions, not current
applicability. Both are rendered in full as JSON alongside the statement or
episode; historical parameters never become current requirements.

Procedures are excluded as a category with `candidate_procedure`: all procedures
currently remain candidates, including human-accepted ones. No prerequisite is
assumed satisfied, and no candidate is presented as validated reusable advice.
Handoffs are excluded with `category_unavailable`. Those category exclusions have
`count: 0`, meaning the service did not enumerate that category; zero is not a
claim that the project has no such memory. Validated procedure/prerequisite reuse
and handoff selection await their own implementation.

## Body and provenance bounds

The complete rendered body defaults to 4096 UTF-8 bytes and has a hard maximum
of 8192. A caller may select a limit from 1024 through 8192 bytes. The byte count
includes the title, item headings, separators, identities, representation labels,
all applicability/historical condition JSON and its labels, and every rendered
source reference. `bodyBytes` is the UTF-8 byte length of `packet.body`, not
JavaScript string length or the size of the JSON envelope.

There are at most 16 mandatory and eight optional items, and at most 64 distinct
source references in the packet. Each item's full source closure may also contain
up to 64 references. This deliberately replaces the unused context contract's
former eight-reference per-item limit, which could not represent an existing
64-source Memory closure honestly. References shared between items still consume
rendered bytes each time they are rendered.

Mandatory overflow refuses. Optional material is tried exactly, then as an
explicit `excerpt` with a code-point-safe prefix of at most 1024 UTF-8 bytes. If
that representation still cannot fit, the item is omitted. Excerpting shortens
only the optional body text: applicability and observed conditions remain exact
and complete. Qualifications alone can force optional omission or mandatory
overflow refusal. `item.byteLength` measures the text alone; the complete
rendered total, including qualifications, is `manifest.bodyBytes`. An episode's
precision and outcome lead its text and remain visible in an excerpt. No reference-only
substitute is emitted for mandatory authority.

The source closure follows SQL parent dependencies with bounded frontiers, at
most 64 unique identities and one extra row for overflow detection. Cycles
terminate through identity deduplication. The service uses the existing source
reader for current visibility, availability and whole-file digest verification;
a missing, corrupt or private supporting source makes the item ineligible.
The entire closure is retained or the item refuses/omits: taking the first eight
or 64 references is never presented as complete provenance.

Optional omissions report aggregate kinds/reason codes/counts, without inaccessible
Memory identities, statements, source IDs or paths. Unreadable optional provenance
uses generic `orientation/source_unavailable`. Mandatory provenance failures return
only a generic refusal and no partial packet. No SQL/file fallback reconstructs
accepted memory while the graph is unavailable.

## Snapshot and release consistency

Preparation takes the existing tenant/project SQL advisory write barrier with a
two-second lock-wait timeout. SQL statements have a local ten-second timeout.
SQL source reads reuse that transaction. Graph commands retain the merged store's
five-second complete-reply deadline and reconnect/error-listener ownership.

The selector reads an active graph epoch, decimal-string event head and privacy
revision before collection. It reads the task revision and current requirement
heads, then rechecks selected source closures, credential/grant/project policy,
task revision and graph root before release. Relevant task and accepted-memory
commits advance the project graph head. The final matching root read, after the
last source/task recheck and before final SQL authorization/commit, is the selection
consistency point. A later mutation does not rewrite that historical snapshot.
This is optimistic consistency across SQL/graph, not a distributed transaction or
a promise that the snapshot remains current after release.

A changed head/task/privacy state rolls back the pending audit transaction and
retries once. Continued change returns `stale_snapshot`; no partial packet or
occurrence is committed. Authentication is not silently refreshed during a retry:
a privacy revision changed since authentication may require a new request.
Graph epoch/head/privacy counters are never rounded through JavaScript numbers.
No graph schema migration or reset is needed.

The manifest's own Source admission is queued in the same SQL transaction. That
operation cannot be leased until the transaction commits, so its graph event is
later than the selection head. `manifestOperationId` names its real source-append
operation; preparation does not claim that operation is committed. Inspect its
receipt through the existing operation endpoint for actual graph admission.

## Released packets and durable metadata

Successful responses use the standard API envelope with `data.kind: "packet"`.
`packet.items` and `packet.body` contain the released text. `packet.manifest`
contains metadata only, and is the exact JSON document retained as an immutable
`context_manifest` Source. Manifest schema version 2 separates metadata items
from the earlier unused text-bearing manifest form. The metadata schema and
projection explicitly allowlist fields; they do not merely omit `text`, which
would accidentally retain newly added plaintext-bearing qualification fields.

The manifest records selected stable identities/versions, task revision,
representation and text-byte counts, complete source refs, aggregate omissions,
limits, selection/renderer versions, render digest, graph epoch/head and privacy
revision. New manifests store `focusDigest: null`. Hint values, request text,
statement text, applicability predicates, historical observation conditions and
rendered plaintext are absent from manifest bytes and items.
The SQL preparation request is represented only by its digest. Operation payloads
hold the existing source-admission metadata, and occurrence rows hold identities,
state, counters, digests and safe report codes. There is no second persisted copy
of rendered plaintext and no plaintext-bearing context diagnostics.

A successful preparation atomically catalogs that Source, its normal graph
admission intent and one occurrence initially in `prepared`. File publication
still precedes SQL commit, as in the existing source store: a failed transaction
can leave an unreferenced immutable metadata object. It creates no catalogued
manifest/occurrence and contains no rendered plaintext. Orphan reclamation remains
outside this checkpoint.

## Retry identity

Preparation deduplicates by tenant, project, principal and a digest of the supplied
key. The exact credential and canonical request digest must also match. Same key
with changed request or credential returns `idempotency_mismatch`. Caller free text
is never retained as a deduplication key.

A retry rehydrates the recorded selected versions from FalkorDB and verifies the
render digest, current heads, task revision and current source/privacy permissions.
It returns the same manifest and occurrence identities and the same body. It does
not create another audit record or reset an occurrence's state. Unrelated graph
events, including the manifest's own admission, do not invalidate the recorded
selection if its current authorities and source permissions still hold. A changed
selected authority/task/privacy state returns `stale_preparation` rather than
releasing obsolete obligations under that identity. Use a new key for a new
selection. Concurrent exact requests serialize to that same recorded identity.

Renderer version 2 adds complete qualifications to released bodies and their
digests. Manifest schema remains version 2 because its persisted metadata shape
is unchanged. A stored preparation with another renderer version, including
version 1, returns `stale_preparation`; a new key prepares a qualified packet.
Old immutable manifests are preserved, never rewritten or silently upgraded.

## Occurrence precision

Preparation proves no emission. The reporting endpoint accepts only a guarded
transition from `prepared` to `emitted`, `unknown` or `refused`. Each terminal
report has its own idempotency key. Exact retries return the original report;
changed input under that key refuses, and another transition after a terminal
state returns `stale_revision`.

```json
{
  "projectId": "11111111-1111-4111-8111-111111111111",
  "occurrenceId": "33333333-3333-4333-8333-333333333333",
  "expectedState": "prepared",
  "state": "emitted",
  "boundary": "operator_report",
  "idempotencyKey": "inventory-context-emission-1"
}
```

An emission requires `operator_report` or `adapter_report` and no refusal reason.
`emittedAtMs` is the server's report-receipt time, not an independently observed
native write timestamp. A refusal requires `delivery_failed`, `cancelled` or
`unknown`; these are codes, never free text. `nativeTurnRef` is null/absent in
this checkpoint. No report establishes native identity, model comprehension or
following of the supplied advice. `native_observed` explicitly returns
`unsupported`, even if a caller requests it.

## Refusals and remaining limits

Context refusal results carry no body and use `detail: null`. Reasons include
`mandatory_overflow`, `missing_current_authority`, `incomplete_provenance`,
`store_unavailable`, `stale_snapshot`, `stale_preparation` and `deleting`.
Ordinary authentication, unknown task/session, invalid-input, ownership and
idempotency failures use the existing typed API error envelope instead. Policy
blocks may be refused at authentication before the selector runs.

No inference, embeddings, arbitrary caller Cypher, new database or transcript
reading is used. Native capture/enrollment, CLI/MCP context wiring, validated
procedures, claims, handoffs, import, erasure and export remain unavailable.
Selection is bounded recall within a recent candidate window, not exhaustive
project search. Snapshot tests use authored synthetic races; none qualify a real
native boundary. See the [assignment result](assignments/agent-a-n02c-context-03.md)
for observed verification and the coordinator's shared-document update requests.
