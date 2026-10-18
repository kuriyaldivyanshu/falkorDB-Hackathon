# Reproducible human memory demonstration

This walkthrough exercises the implemented memory lifecycle using public
[inventory exporter data](../fixtures/inventory-export-v1/README.md), an explicitly
selected human command and an authored MCP client. It proves persistence and
transport recall. It does not prove that another Codex session consumed memory,
that a model used it, or that Threadline independently verified command output.
No native inference, hook, enrollment, claim, handoff or execution harness is used.

Run the fenced shell blocks in order in **one Bash terminal**, from a built
checkout with Node.js >=22, npm, jq, Docker and Python 3. Each Threadline call
starts a fresh CLI process. The backend never copies or executes a fixture.

## 1. Start isolated storage and the service

Use fresh disposable stores, generated passwords and a separate installation.
The example ports are explicit choices: stop if any is already occupied. Never
reuse a different assignment's reserved resources. For an assigned development
run, use its reserved names/ports/data root instead of the example defaults.
Do not copy an existing installation or its credentials. Setup safety and the
privilege model are documented in [local development](local-development.md) and
[storage recovery](storage-recovery.md).

```bash
set -euo pipefail
umask 077
REPO=$(pwd -P)
export REPO
npm ci
npm run build

# Override these together for a coordinator-reserved development run.
DATA=${DEMO_DATA_ROOT:-$(mktemp -d "${TMPDIR:-/tmp}/threadline-memory-demo.XXXXXX")}
INSTALL="$DATA/home"
PREFIX=${DEMO_PREFIX:-threadline-memory-demo-$(date +%s)-$$}
HTTP_PORT=${DEMO_HTTP_PORT:-47843}
PG_PORT=${DEMO_PG_PORT:-55453}
GRAPH_PORT=${DEMO_GRAPH_PORT:-56453}
mkdir -p "$DATA"
DATA=$(cd "$DATA" && pwd -P)
INSTALL="$DATA/home"
export DATA INSTALL HTTP_PORT PG_PORT GRAPH_PORT
# This must be a fresh installation, not ~/.threadline.
test ! -e "$INSTALL"
python3 - <<'PY'
import os, socket
for key in ('HTTP_PORT', 'PG_PORT', 'GRAPH_PORT'):
    with socket.socket() as s:
        s.bind(('127.0.0.1', int(os.environ[key])))
print('Selected ports are available')
PY
test -z "$(docker ps -aq --filter "name=^/${PREFIX}-")"
test -z "$(docker volume ls -q --filter "name=^${PREFIX}-")"

PG_SECRET=$(node -e 'console.log(require("node:crypto").randomBytes(24).toString("hex"))')
APP_SECRET=$(node -e 'console.log(require("node:crypto").randomBytes(24).toString("hex"))')
GRAPH_SECRET=$(node -e 'console.log(require("node:crypto").randomBytes(24).toString("hex"))')
printf 'POSTGRES_USER=postgres\nPOSTGRES_DB=threadline_demo\nPOSTGRES_PASSWORD=%s\n' \
  "$PG_SECRET" > "$DATA/pg.env"
printf 'BROWSER=0\nREDIS_ARGS=--requirepass %s --appendonly yes --appendfsync always\n' \
  "$GRAPH_SECRET" > "$DATA/graph.env"
printf "CREATE ROLE threadline_demo_app LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '%s';\n" \
  "$APP_SECRET" > "$DATA/bootstrap.sql"

docker volume create "$PREFIX-pg-data"
docker volume create "$PREFIX-graph-data"
docker run -d --name "$PREFIX-postgres" --env-file "$DATA/pg.env" \
  -p "127.0.0.1:$PG_PORT:5432" -v "$PREFIX-pg-data:/var/lib/postgresql" postgres:18-alpine
docker run -d --name "$PREFIX-graph" --env-file "$DATA/graph.env" \
  -p "127.0.0.1:$GRAPH_PORT:6379" -v "$PREFIX-graph-data:/var/lib/falkordb/data" \
  falkordb/falkordb:6.0.2
for attempt in {1..30}; do
  if docker exec "$PREFIX-postgres" pg_isready -U postgres -d threadline_demo; then break; fi
  sleep 1
done
docker exec -i "$PREFIX-postgres" psql -v ON_ERROR_STOP=1 -U postgres \
  -d threadline_demo < "$DATA/bootstrap.sql"

export THREADLINE_HOST=127.0.0.1 THREADLINE_PORT="$HTTP_PORT"
export THREADLINE_PG_HOST=127.0.0.1 THREADLINE_PG_PORT="$PG_PORT"
export THREADLINE_PG_DATABASE=threadline_demo THREADLINE_PG_USER=threadline_demo_app
export THREADLINE_PG_APPLICATION_ROLE=threadline_demo_app THREADLINE_PG_PASSWORD="$APP_SECRET"
export THREADLINE_PG_MIGRATION_USER=postgres THREADLINE_PG_MIGRATION_PASSWORD="$PG_SECRET"
export THREADLINE_FALKORDB_HOST=127.0.0.1 THREADLINE_FALKORDB_PORT="$GRAPH_PORT"
export THREADLINE_FALKORDB_PASSWORD="$GRAPH_SECRET"

# Assert the resolved target before the first mutation. Prints no secrets.
node --input-type=module - <<'JS'
import assert from 'node:assert/strict';
import { loadServiceConfig } from '@threadline/backend';
const { config: c } = loadServiceConfig(process.env.INSTALL);
assert.equal(c.paths.home, process.env.INSTALL);
assert.equal(c.paths.sourceRoot, process.env.INSTALL + '/sources');
assert.equal(c.postgres.database, 'threadline_demo');
assert.equal(c.postgres.port, Number(process.env.PG_PORT));
assert.equal(c.falkordb.port, Number(process.env.GRAPH_PORT));
assert.equal(c.port, Number(process.env.HTTP_PORT));
console.log('Installation, source root, database and ports verified');
JS
node "$REPO/packages/cli/dist/index.js" init --home "$INSTALL"
tl() { node "$REPO/packages/cli/dist/index.js" --home "$INSTALL" "$@"; }
node "$REPO/packages/cli/dist/index.js" serve --home "$INSTALL" > "$DATA/service.log" 2>&1 &
SERVICE_PID=$!
# Wait for real graph readiness, not merely an HTTP listener.
for attempt in {1..30}; do
  if tl status --json > "$DATA/status.json" && \
    jq -e '.storage.graphReady and .storage.sqlReady' "$DATA/status.json" >/dev/null; then break; fi
  sleep 1
done
jq -e '.storage.graphReady and .storage.sqlReady' "$DATA/status.json" >/dev/null
tl capabilities --json > "$DATA/capabilities.json"
```

The owner token stays in `INSTALL/credential.json`; database passwords stay in
owner-only files/environment. This is local synthetic owner bootstrap, not
production credential issuance. Preserve the data root and container/volume
names for explicit later cleanup; no cleanup is automatic.

## 2. Associate a fresh project, capture and accept 600 seconds

For a second run, repeat **sections 2–6** with the same service and a newly
created `WORK`. Project/task/source/memory/version identifiers below all come
from service results. Keys are explicit and scoped to that fresh project.

```bash
WORK=$(mktemp -d "$DATA/project.XXXXXX")
export WORK
PROJECT=$(tl project:add --root "$WORK" --label "Public inventory memory demo" --json \
  | jq -er '.project.projectId')
TASK=$(tl task:create --project "$PROJECT" --title "Inventory CSV export" \
  --family inventory-export --idempotency-key demo-task --wait --json | jq -er '.taskId')
export PROJECT TASK
printf '%s\n' 'Authored human requirement: retain inventory rows aged 0 through 600 seconds, inclusive.' \
  > "$WORK/requirement-600.txt"
SOURCE_600=$(tl source:append --project "$PROJECT" --kind human_note \
  --file "$WORK/requirement-600.txt" --origin authored:requirement-600 --json \
  | jq -er '.outcomes[0].sourceId')

jq -n --arg p "$PROJECT" --arg t "$TASK" --arg s "$SOURCE_600" \
  '{projectId:$p,taskId:$t,content:{kind:"semantic",subtype:"requirement",
    statement:"Retain inventory rows aged 0 through 600 seconds, inclusive."},
    applicability:{predicates:[]},
    observedUnder:{taskFamily:"inventory-export",contractVersion:"csv-v1",runtime:null,
      tool:null,paths:[],parameters:{maxAgeSeconds:"600"}},
    sourceIds:[$s],idempotencyKey:"demo-propose-600"}' > "$WORK/propose.json"
tl memory:propose --input "$WORK/propose.json" --wait --json > "$WORK/proposal.json"
MEMORY=$(jq -er '.memoryId' "$WORK/proposal.json")
VERSION_600=$(jq -er '.versionId' "$WORK/proposal.json")
export MEMORY VERSION_600
tl memory:inspect --project "$PROJECT" "$MEMORY" --json > "$WORK/before-accept.json"
jq -e '.current == null and (.candidates | length) == 1' "$WORK/before-accept.json"
# Preserve the server-created intent Source naming the original version.
tl history --project "$PROJECT" --kinds memory_proposal --json > "$WORK/intent-history.json"
INTENT_600=$(jq -er '.entries[0].sourceId' "$WORK/intent-history.json")

tl memory:accept --project "$PROJECT" "$MEMORY" --version "$VERSION_600" \
  --expect-current none --reason "Human approves initial public requirement" \
  --idempotency-key demo-accept-600 --wait --json > "$WORK/accept-600.json"
REVISION=$(tl task:inspect --project "$PROJECT" "$TASK" --json | jq -er '.revision')
tl task:require --project "$PROJECT" "$TASK" --memory "$MEMORY" \
  --expect-revision "$REVISION" --idempotency-key demo-bind --wait --json

tl task:requirements --project "$PROJECT" "$TASK" --json > "$WORK/requirements-600.json"
jq -e --arg v "$VERSION_600" '.requirements[0] | .state == "current" and .current.versionId == $v' \
  "$WORK/requirements-600.json"
```

The proposal operation committed, but it governed nothing before acceptance.
`--expect-current none` explicitly guards the initial empty head; the CLI never
fetches a head to silently accept against it. Binding names the stable Memory,
so later corrections resolve through the same task requirement.

## 3. Execute one public case and record the actual result

Copy the seed, not the manifest expectations, to a disposable work directory.
The selected mixed-offset case exposes the seed's **deliberately authored UTC
normalization defect**. This is not a mistake observed from Codex. Exit zero
alone is not a passing check: stdout must match the public specification too.

```bash
mkdir "$WORK/exporter"
cp -R "$REPO/fixtures/inventory-export-v1/seed/." "$WORK/exporter/"
export DEMO_MANIFEST="$REPO/fixtures/inventory-export-v1/manifest.json"
node --input-type=module - <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const manifest = JSON.parse(readFileSync(process.env.DEMO_MANIFEST, 'utf8'));
const c = manifest.cases.find(c => c.id === 'initial-mixed-offsets');
const args = ['src/exporter.mjs', '--as-of', manifest.reference_time,
  '--max-age-seconds', String(c.max_age_seconds)];
const r = spawnSync(process.execPath, args, { cwd: process.env.WORK + '/exporter',
  input: JSON.stringify(c.input), encoding: 'utf8', timeout: 10000 });
if (r.error || r.status === null) throw r.error ?? new Error('No exit status');
writeFileSync(process.env.WORK + '/actual-outcome.json', JSON.stringify({
  caseId: c.id, executionOwner: 'explicit human demo command',
  fixtureDefect: 'authored seed preserves timestamp text instead of normalized UTC',
  command: ['node', ...args], input: c.input, stdout: r.stdout, stderr: r.stderr,
  exitStatus: r.status, signal: r.signal,
  matchesPublicSpecification: r.status === c.expected_exit && r.stdout === c.expected_stdout,
  limitation: 'Recorded by a human; Threadline does not independently check output truth.'
}, null, 2));
JS
jq -e '.exitStatus == 0 and .matchesPublicSpecification == false' "$WORK/actual-outcome.json"
OUTCOME_SOURCE=$(tl source:append --project "$PROJECT" --kind tool_result \
  --file "$WORK/actual-outcome.json" --origin human:public-mixed-offset-check --json \
  | jq -er '.outcomes[0].sourceId')

jq -n --arg p "$PROJECT" --arg t "$TASK" --arg s "$OUTCOME_SOURCE" \
  '{projectId:$p,taskId:$t,action:"Compare seed output for initial-mixed-offsets with the public CSV specification",
    outcome:"failed",observation:"Exporter exited 0, but stdout did not match required UTC-normalized CSV.",
    uncertainty:"Only this public case was checked; no claim about the entire task or independent verification by Threadline.",
    sourceIds:[$s],applicability:{predicates:[{key:"contract_version",operator:"equals",values:["csv-v1"]}]},
    observedUnder:{taskFamily:"inventory-export",contractVersion:"csv-v1",runtime:"node",
      tool:"human-command",paths:["src/exporter.mjs"],parameters:{maxAgeSeconds:"600"}},
    evidencePrecision:"observed",idempotencyKey:"demo-episode"}' > "$WORK/episode.json"
tl memory:episode:record --input "$WORK/episode.json" --wait --json > "$WORK/episode-result.json"
EPISODE=$(jq -er '.memoryId' "$WORK/episode-result.json")
EPISODE_VERSION=$(jq -er '.versionId' "$WORK/episode-result.json")
export EPISODE EPISODE_VERSION
tl memory:inspect --project "$PROJECT" "$EPISODE" --json > "$WORK/episode-view.json"
jq -e '.current | .acceptance == "accepted" and .content.evidencePrecision == "observed"
  and .content.outcome == "failed" and .acceptedByPrincipalId == null' "$WORK/episode-view.json"
```

Source ingestion can finish before its graph admission. If the episode call
refuses because that admission is not yet committed, allow the worker to finish
and repeat the **same command and document/key**. Do not change `observed` to
`authored` to make a refusal disappear. Other refusals require investigation.
`--wait` follows an admitted operation; it does not retry a refused request.

Observed precision is granted only when every source is in scope, project-visible
and available; of a qualifying outcome kind; complete; recorded by the acting
human principal; and admitted to the graph. A chosen `tool_result` kind or text
assertion alone does not establish observation. These checks validate evidence
eligibility, not the truth of the recorded stdout or the caller's interpretation.
An authored request (including one with omitted precision) stays a proposal until
explicit human acceptance; the episode command never accepts it automatically.

## 4. Correct authority to 60 seconds and inspect old provenance

The change is explicitly authored by the human. It does not rewrite the earlier
requirement, execution output or episode conditions.

```bash
printf '%s\n' 'Authored human change: retain inventory rows aged 0 through 60 seconds, inclusive.' \
  > "$WORK/requirement-60.txt"
SOURCE_60=$(tl source:append --project "$PROJECT" --kind human_note \
  --file "$WORK/requirement-60.txt" --origin authored:requirement-60 --json \
  | jq -er '.outcomes[0].sourceId')
jq --arg m "$MEMORY" --arg v "$VERSION_600" --arg s "$SOURCE_60" \
  'del(.taskId) | .memoryId=$m | .expectedCurrentVersionId=$v |
    .content.statement="Retain inventory rows aged 0 through 60 seconds, inclusive." |
    .observedUnder.parameters.maxAgeSeconds="60" | .sourceIds=[$s] |
    .reason="Explicit human change for the public demo" | .idempotencyKey="demo-correct-60"' \
  "$WORK/propose.json" > "$WORK/correct.json"
tl memory:correct --input "$WORK/correct.json" --wait --json > "$WORK/correction.json"
VERSION_60=$(jq -er '.versionId' "$WORK/correction.json")
export VERSION_60
tl task:requirements --project "$PROJECT" "$TASK" --json > "$WORK/requirements-60.json"
jq -e --arg v "$VERSION_60" --arg old "$VERSION_600" '.requirements[0] |
  .state == "current" and .current.versionId == $v and .current.supersedesVersionId == $old
  and .current.content.statement == "Retain inventory rows aged 0 through 60 seconds, inclusive."' \
  "$WORK/requirements-60.json"
tl memory:inspect --project "$PROJECT" "$MEMORY" --json
# Read retained source bytes and the canonical captured old version document.
tl source:read --project "$PROJECT" "$SOURCE_600"
tl source:read --project "$PROJECT" "$INTENT_600" > "$WORK/old-intent.json"
jq -e --arg v "$VERSION_600" --arg s "$SOURCE_600" \
  '.versionId == $v and .sourceIds == [$s] and
   .content.statement == "Retain inventory rows aged 0 through 600 seconds, inclusive."' "$WORK/old-intent.json"
tl operation:inspect --project "$PROJECT" "$(jq -er '.operationId' "$WORK/accept-600.json")" --json
```

`memory:inspect` exposes the current head and pending proposals, not a historical
version browser. The superseded version is retained in FalkorDB; its identity
is exposed by `supersedesVersionId`, and its immutable canonical intent Source,
original evidence and old acceptance operation remain inspectable with the
implemented commands above. No proposed historical-version endpoint is used.
The old episode still records `maxAgeSeconds: "600"`. Its CSV-format lesson is
separate from the changed freshness requirement. Applicability-aware selection
is implemented by [the backend context API](context.md); this walkthrough uses
the existing CLI/MCP reads and does not exercise that API or prove native context
delivery.

## 5. Human-accept a procedural candidate

This procedure proposes how to check UTC formatting. It cites the real **failed**
check, which does not become evidence of successful repair or compatible reuse.
No seed modification or procedure validation is claimed.

```bash
jq -n --arg p "$PROJECT" --arg t "$TASK" --arg s "$OUTCOME_SOURCE" --arg e "$EPISODE_VERSION" \
  '{projectId:$p,taskId:$t,content:{kind:"procedural",goal:"Check CSV timestamp normalization",
    steps:[{index:0,text:"Run the mixed-offset case under the current freshness requirement."},
      {index:1,text:"Compare parsed instants formatted as ISO UTC milliseconds with every emitted timestamp."}],
    prerequisites:["Inventory CSV v1 output contract; explicit human execution and comparison"],
    parameters:[{name:"maxAgeSeconds",value:"Read the current task requirement"}],supportedBy:[$e]},
    applicability:{predicates:[{key:"contract_version",operator:"equals",values:["csv-v1"]}]},
    observedUnder:{taskFamily:"inventory-export",contractVersion:"csv-v1",runtime:"node",
      tool:"human-command",paths:[],parameters:{maxAgeSeconds:"600"}},
    sourceIds:[$s],idempotencyKey:"demo-procedure"}' > "$WORK/procedure.json"
# stdin uses the same bounded JSON reader and shared schema as file input.
tl memory:propose --input - --wait --json < "$WORK/procedure.json" > "$WORK/procedure-result.json"
PROCEDURE=$(jq -er '.memoryId' "$WORK/procedure-result.json")
PROCEDURE_VERSION=$(jq -er '.versionId' "$WORK/procedure-result.json")
export PROCEDURE
tl memory:accept --project "$PROJECT" "$PROCEDURE" --version "$PROCEDURE_VERSION" \
  --expect-current none --reason "Human approves a candidate checking procedure, without validated reuse" \
  --idempotency-key demo-accept-procedure --wait --json

tl memory:inspect --project "$PROJECT" "$PROCEDURE" --json > "$WORK/procedure-view.json"
jq -e --arg e "$EPISODE_VERSION" '.current | .acceptance == "accepted" and
  .content.procedureState == "candidate" and .content.reviewRef == null and
  .content.supportedBy == [$e] and .supports[0].outcome == "failed"' "$WORK/procedure-view.json"
```

Operation commitment, memory acceptance/current authority, episode precision and
procedure validation are four separate facts. Human acceptance does not grant
validated reuse. This CSV procedure must not be assumed suitable for the public
incompatible JSON contract. Validation and applicability-aware selection remain
later work; this walkthrough uses direct reads only.

## 6. Restart normally and recall through fresh clients

Stop only the service started above, then restart against the same installation,
SQL database, graph volume and source root. No reset or setup rerun is needed.

```bash
kill -TERM "$SERVICE_PID"
wait "$SERVICE_PID"
node "$REPO/packages/cli/dist/index.js" serve --home "$INSTALL" >> "$DATA/service.log" 2>&1 &
SERVICE_PID=$!
for attempt in {1..30}; do
  if tl status --json > "$DATA/status.json" && \
    jq -e '.storage.graphReady and .storage.sqlReady' "$DATA/status.json" >/dev/null; then break; fi
  sleep 1
done
jq -e '.storage.graphReady and .storage.sqlReady' "$DATA/status.json" >/dev/null
tl project:list --json
tl task:inspect --project "$PROJECT" "$TASK" --json
tl task:requirements --project "$PROJECT" "$TASK" --json | \
  jq -e --arg v "$VERSION_60" '.requirements[0].current.versionId == $v'
tl memory:inspect --project "$PROJECT" "$EPISODE" --json | \
  jq -e '.current.content.evidencePrecision == "observed"'
tl memory:inspect --project "$PROJECT" "$PROCEDURE" --json | \
  jq -e '.current.content.procedureState == "candidate"'

# A finite authored JSON-RPC client, not Codex and not an agent launcher.
node --input-type=module - <<'JS'
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
const child = spawn(process.execPath, [process.env.REPO + '/packages/cli/dist/index.js',
  'mcp', '--home', process.env.INSTALL, '--project', process.env.PROJECT],
  { stdio: ['pipe', 'pipe', 'inherit'] });
const pending = new Map(); let seq = 0;
const lines = createInterface({ input: child.stdout });
lines.on('line', line => {
  const message = JSON.parse(line);
  const handler = pending.get(message.id);
  if (handler) { pending.delete(message.id); handler(message); }
});
const request = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error('MCP timeout')); }, 15000);
  pending.set(id, message => { clearTimeout(timer);
    message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result); });
  child.stdin.write(JSON.stringify({ jsonrpc:'2.0', id, method, params }) + '\n');
});
try {
  await request('initialize', { protocolVersion:'2025-06-18', capabilities:{},
    clientInfo:{ name:'authored-memory-demo', version:'1' } });
  child.stdin.write(JSON.stringify({ jsonrpc:'2.0', method:'notifications/initialized' }) + '\n');
  const { tools } = await request('tools/list');
  assert.deepEqual(tools.map(t => t.name).sort(), ['threadline_memory_query',
    'threadline_memory_inspect', 'threadline_task_inspect', 'threadline_task_requirements',
    'threadline_source_inspect', 'threadline_source_read'].sort());
  assert.ok(tools.every(t => t.annotations.readOnlyHint === true));
  console.log('Six read-only tools; no mutation tool');
  const call = async (name, args) => {
    const response = await request('tools/call', { name, arguments:args });
    assert.ok(!response.isError, JSON.stringify(response));
    return response.structuredContent.result;
  };
  const requirements = await call('threadline_task_requirements', { taskId:process.env.TASK });
  assert.equal(requirements.requirements[0].current.versionId, process.env.VERSION_60);
  const episode = await call('threadline_memory_inspect', { memoryId:process.env.EPISODE });
  assert.equal(episode.current.content.evidencePrecision, 'observed');
  const procedure = await call('threadline_memory_inspect', { memoryId:process.env.PROCEDURE });
  assert.equal(procedure.current.content.procedureState, 'candidate');
  console.log(JSON.stringify({ requirement:requirements.requirements[0], episode, procedure }, null, 2));
} finally {
  lines.close(); child.stdin.end(); child.kill('SIGTERM');
}
JS
```

The MCP client reads through the six-tool surface
using the locally bootstrapped owner credential. There is no narrower credential
issuance command yet. Repeating sections 2–6 creates a new independent project
and checks for accidental dependence on earlier identifiers or keys.

Keep credentials, source bytes, command output and database state outside Git.
Keep the created resources available for review when working under an assignment;
the coordinator owns retirement. Ordinary users should explicitly retire only
their own named containers/volumes and data root after preserving useful results.

The backend context API is documented separately in [the context guide](context.md)
and is not exercised here. Native identity/capture, validated reuse,
coordination, retention/erasure and package publication are not established here.
See [the native contract](native-integration-contract.md) and
[the development checklist](development-checklist.md). N03 and N06 remain open.
