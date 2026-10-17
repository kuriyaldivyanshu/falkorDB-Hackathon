# Memory kinds: episodes and procedures

What Threadline records about **what happened** and **what has been tried**, and
exactly how certain it is. Semantic memory and tasks are covered in
[docs/local-development.md](local-development.md); the domain wording is in
[CONTEXT.md](../CONTEXT.md).

Everything below is implemented and verified in the `a-n02b-evidence-02`
checkpoint. Bounded context selection, coordination claims, handoffs, native
enrollment and capture, retention and erasure remain unavailable and are
reported as such by `threadline capabilities`.

## Routes

```text
POST /v2/memories/episodes                record one attempted action and its outcome
POST /v2/memories/proposals               propose a semantic or procedural version
POST /v2/memories/:memoryId/acceptance    human acceptance of one candidate
POST /v2/memories/:memoryId/corrections   human correction that supersedes the head
GET  /v2/memories/:memoryId               current version, candidates and evidence
GET  /v2/memories[?kind=episodic|procedural|semantic]
GET  /v2/tasks/:taskId/requirements       exact current requirement versions
GET  /v2/operations/:operationId?projectId=<uuid>
```

Every route needs a project-bound bearer credential. A producer may record and
propose; only the local human administration credential accepts or corrects.

## Episodes

An episode records **one attempted action and the outcome that was established
for it**, under the conditions it was observed under.

```json
{"projectId":"…","taskId":"…",
 "action":"Restart the exporter after the timestamp-offset failure",
 "outcome":"failed",
 "observation":"The exporter exited 2 on the third batch; no output was written.",
 "uncertainty":null,
 "sourceIds":["…"],
 "applicability":{"predicates":[{"key":"task_family","operator":"equals","values":["inventory-export"]}]},
 "observedUnder":{"taskFamily":"inventory-export","contractVersion":"v1","runtime":"node-22","tool":null,
                  "paths":["services/exporter"],"parameters":{"batchSize":"500"}},
 "evidencePrecision":"observed",
 "idempotencyKey":"ep-1"}
```

### Outcomes stay distinct

`succeeded`, `failed`, `denied`, `interrupted` and `unknown` are five different
facts. A denied action was refused on purpose; an interrupted one was cut short;
an unknown one is not established. Collapsing them would lose the difference
between "we tried and it was refused" and "we do not know".

`unknown` additionally **requires** `uncertainty`. An episode that does not know
what happened must say what it does not know, rather than record a bare
`unknown` that reads like a conclusion.

An outcome is a statement about **this action under the recorded
`observedUnder`** and nothing wider. An exit status is not a root cause, and a
successful step is not a successful task: no episode is ever read as a claim
about the task it was performed under.

### Evidence precision is server-resolved, never caller-granted

| precision | meaning | acceptance |
| --- | --- | --- |
| `authored` | somebody wrote it down: a report, a recollection, a transcription | a candidate, until a human accepts it |
| `observed` | this service resolved the outcome itself from evidence it verified | current on admission |

`evidencePrecision` in a request is a **request**. The server grants it or
refuses the call; it never downgrades silently, because a caller who asked for
an observation must not be handed back a weaker record without being told.

`observed` requires **all five** conditions on **every** cited source:

1. it is in project scope, project-visible and available;
2. its catalogued kind is outcome evidence in this contract —
   `procedure_outcome`, `tool_result` or `permission_outcome`;
3. its completeness is `complete` (not `partial`, `unknown` or `gap`);
4. **the principal that recorded it is the acting human principal**;
5. its own admission has committed, so it exists in project memory.

Condition 4 is what makes this honest in a build with no native capture.
`source.append` always stamps the acting principal, so a producer or model
cannot mint observed-grade evidence by declaring a kind: its own records fail
condition 4 and stay authored.

**A caller-supplied outcome or Source kind does not prove native execution.**
Declaring `kind: "tool_result"` in a request only chooses which catalogue the
entry lands in. This build performs no native capture, no transcript parsing and
no model extraction, so the strongest episode it can record is one a human
recorded as a complete outcome record.

The worker re-derives all five conditions at delivery. If the evidence moved
while the intent waited behind a graph outage, the episode is refused rather
than committed at a precision its evidence no longer supports.

### An accepted observed episode has no accepting principal

An observed episode is admitted as current, with `acceptedByPrincipalId: null`.
That null is the honest signal: no human accepted it, and its authority is an
observation this service verified, not a human decision. An authored episode is
a proposal and carries `delegation: "authored"` until a human accepts it.

### Episodes are never revised

An episode always creates a new Memory identity and one version. There is no
episode correction: a report that turns out to be wrong is a **new** episode, and
the earlier one keeps the outcome it recorded. A correction may not change the
kind of a memory identity either, so an episode cannot be turned into a
procedure.

## Procedures

A procedure is a goal with bounded ordered steps, declared prerequisites and
parameters, cited evidence, an independently declared applicability, and an
explicit state. It is proposed through the ordinary `POST /v2/memories/proposals`
route with `content.kind: "procedural"`.

```json
{"projectId":"…",
 "content":{"kind":"procedural",
   "goal":"Re-run the inventory exporter after a batch offset failure",
   "steps":[{"index":0,"text":"Stop the exporter and capture the failing batch id"},
            {"index":1,"text":"Re-run from the last committed offset"}],
   "prerequisites":["the exporter is idempotent on offset"],
   "parameters":[{"name":"offsetSource","value":"last_committed"}],
   "supportedBy":["<episode version id>"]},
 "applicability":{"predicates":[]},
 "observedUnder":{"taskFamily":"inventory-export","contractVersion":null,"runtime":null,
                  "tool":null,"paths":[],"parameters":{}},
 "sourceIds":["…"],"idempotencyKey":"p-1"}
```

### What a caller may not supply

The request carries `procedureAuthoringSchema`, which is narrower than the
stored form on purpose:

- `procedureState` and `reviewRef` are **absent** from the request. The service
  resolves them; the stored content always arrives as `procedureState:
  "candidate"`, `reviewRef: null`. A proposal cannot arrive already validated,
  and **a `reviewRef` string alone grants nothing**.
- `supportedBy` is a claim, not a fact. Every reference is checked against
  project memory before the commit: it must name a version that exists, that is
  **episodic**, and that is **accepted** (an unaccepted candidate is a
  proposal, not a recorded outcome).

### Accepted is not validated

Human acceptance makes a procedure the **current version** of its memory
identity. That is a different thing from validated reuse:

- acceptance is an explicit human decision recorded against the version;
- validation additionally requires a **declared review** and **compatible
  observed reuse** — evidence that the procedure worked on conditions it had not
  been written for.

No transition in this build performs validation. `memory.procedure.validate` is
reported **unavailable**, and a proposed or accepted procedure keeps
`procedureState: "candidate"`. Reaching `validated` is an N04 gate with its own
assignment and its own verification; this checkpoint does not manufacture it
from an arbitrary `reviewRef` or from repetition.

### Supporting observations keep their own outcomes

`supports` in a read reports, for each cited episode version, the outcome **it
actually recorded** and the `observedUnder` it was observed under:

```json
{"versionId":"…","memoryId":"…","outcome":"failed",
 "observedUnder":{"taskFamily":"inventory-export","contractVersion":"v1","runtime":"node-22",
                  "tool":null,"paths":["services/exporter"],"parameters":{"batchSize":"500"}},
 "observedAtMs":1792261328296}
```

The reference names a version, never an outcome, and the read resolves it from
project memory. A procedure therefore cannot present a success its evidence
never had, and a later change to a supporting episode shows up as a different
outcome rather than being smoothed over. A reference that cannot be resolved is
an explicit `authority_unavailable`, not a silent omission — dropping support
would understate what a procedure rests on.

### Corrections preserve history

A correction creates a new accepted version and supersedes the named head. The
earlier version keeps its own steps, its own `SUPPORTED_BY` and
`SOURCED_FROM` links, its own acceptance record and its `superseded_by_version_id`.
Only the `CURRENT` pointer moves. A correction may not change the memory's kind,
so a requirement cannot silently become advice.

## Requirements bind obligations only

`POST /v2/tasks/:taskId/requirements` binds a **semantic** memory identity and
refuses anything else with `requirement_kind_unsuitable`. An episode records what
happened and a procedure proposes how to act; neither is an obligation, so
binding either would let history or a suggestion stand in for a requirement.
The refusal is enforced twice — in the worker's precondition and in the commit
statement — so it cannot be bypassed by a direct graph write path.

## Limits and refusals

| bound | value | refusal |
| --- | --- | --- |
| version content | 16 KiB | `invalid_request` |
| intent document | 128 KiB | `invalid_request` |
| semantic statement | 4 KiB | `invalid_request` |
| episode field | 2 KiB | `invalid_request` |
| procedure step | 512 B, 8 steps | `invalid_request` |
| prerequisites / parameters | 8 / 16 | `invalid_request` |
| supporting episodes | 8 | `invalid_request` |
| source closure | 64 | `invalid_request` |
| proposed candidates per memory | 8 | `candidate_limit_reached` |
| task requirements | 16 | `requirement_limit_reached` |
| supports per read page | 8 per version | `invalid_request` |

Operation-level refusals, readable through `GET /v2/operations/:operationId`:

| code | meaning |
| --- | --- |
| `episode_evidence_unsupported` | an `observed` request whose evidence failed an eligibility check |
| `evidence_precision_conflict` | a captured document claims a precision its admission or evidence does not support |
| `supporting_episode_missing` | a supporting reference is not in project memory |
| `supporting_reference_not_episodic` | a supporting reference names a non-episodic version |
| `supporting_episode_not_accepted` | a supporting reference names a proposal, not a recorded outcome |
| `supporting_reference_self` | a procedure version cites itself |
| `procedure_state_unavailable` | a proposal tried to arrive validated |
| `memory_kind_change_refused` | a proposal or correction would change a memory identity's kind |
| `requirement_kind_unsuitable` | a task requirement named a non-obligation memory |
| `evidence_not_readable` / `source_unavailable` | cited evidence is absent from scope, foreign, private, or unavailable |
| `dependency_pending` | a cited source or supporting episode is still being admitted |

## Example sequence

```sh
curl -sS -X POST http://127.0.0.1:47832/v2/memories/episodes \
  -H "authorization: Bearer $PRODUCER_TOKEN" -H 'content-type: application/json' \
  -d '{"projectId":"…","action":"Restart the exporter after the offset failure",
       "outcome":"failed","observation":"Exited 2 on the third batch; nothing written.",
       "sourceIds":["…"],"applicability":{"predicates":[]},
       "observedUnder":{"taskFamily":"inventory-export","contractVersion":"v1",
       "runtime":"node-22","tool":null,"paths":[],"parameters":{}},
       "evidencePrecision":"authored","idempotencyKey":"ep-1"}'
```

First admission returns a pending operation (excerpt). No commit timestamp is
available yet (`committedAtMs` is `null` in the full response).

```json
{"ok":true,"data":{"operationId":"…","state":"pending","memoryId":"…","versionId":"…",
 "errorCode":null,"errorDetail":null}}
```

After the worker commits, inspect the same operation:

```sh
curl -sS "http://127.0.0.1:47832/v2/operations/…?projectId=…" \
  -H "authorization: Bearer $PRODUCER_TOKEN"
```

The later `GET /v2/operations/:operationId` response includes the commit timestamp
in its receipt:

```json
{"ok":true,"data":{"operationId":"…","kind":"memory.episode.record","state":"committed",
 "requestDigest":"…","attempts":1,"createdAtMs":1792261328000,
 "settledAtMs":1792261328296,"errorCode":null,
 "receipt":{"graphEpoch":"…","eventSeq":"1","outcome":"committed",
 "committedAtMs":1792261328296}}}
```

```sh
curl -sS "http://127.0.0.1:47832/v2/memories?projectId=…&kind=episodic" \
  -H "authorization: Bearer $PRODUCER_TOKEN"
```

## What is still unavailable

- Bounded context selection (`context.prepare`, `context.occurrence`) — N02C.
- Coordination claims and handoffs — N04.
- Validated procedural reuse (`memory.procedure.validate`) — N04.
- Native enrollment and capture, so no episode can originate from a real Codex
  session yet; `session.register` and `session.list` stay unavailable.
- Selected history import, retention, erasure and export — N05.

No claim in this document is made about any of those. The capability report is
the authority on what this build supports, and it changes with the build.
## Storage recovery

See [storage recovery and installation safety](storage-recovery.md) for connection deadlines, outage readiness, receipt reconciliation and the initialization target guard.
