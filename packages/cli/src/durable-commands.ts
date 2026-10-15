import { createInterface } from 'node:readline/promises';
import { isAdmissionReceipt, isUuid } from '@threadline/shared';
import type { CliInvocation } from './options.js';
import type { BackendClient } from './transport/backend-client.js';
import { loadFixtureManifest, previewFixture } from './fixture/manifest.js';
import { buildGoalAdmissionInput } from './admission/build.js';
import { resolveAdmissionRequestId } from './admission/request-record.js';
import { requestConsent } from './consent.js';

/** CLI owns presentation/consent; every identity and authority comes from the service. */
export async function runDurableCommand(client:BackendClient, invocation:CliInvocation, out:(line:string)=>void):Promise<number> {
  if (!client.authenticated) throw new Error('Owner credential is missing. Start the storage-configured backend first and pass --credential with its session.json path.');
  const principal = await client.principal();
  if (invocation.command === 'init') {
    out(JSON.stringify(principal,null,2));
    return 0;
  }
  const projectId = invocation.projectId ?? (principal.projects.length === 1 ? principal.projects[0]?.projectId : undefined);
  if (!isUuid(projectId) || !principal.projects.some(p => p.projectId === projectId))
    throw new Error('Select an authorized project UUID with --project.');
  if (invocation.command === 'inspect') {
    if (invocation.requestId !== null && !isUuid(invocation.requestId)) throw new Error('--request must be a UUID.');
    const view = invocation.requestId === null ? await client.authority(projectId) : await client.admission(projectId,invocation.requestId);
    out(JSON.stringify(view,null,2)); return 0;
  }
  const manifest = await loadFixtureManifest(invocation.fixtureManifestPath);
  const lines = previewFixture(manifest);
  lines.forEach(out);
  const input = buildGoalAdmissionInput(manifest,{projectId,requestId:'00000000-0000-4000-8000-000000000000'});
  out('Initial governing criteria:');
  input.criteria.forEach(c=>out(`  ${c.ref}: ${c.text}`));
  out('Changed-phase criteria are deferred. Checker execution is not implemented at M01.');
  if (invocation.acceptedFixtureDigest !== null) {
    if (invocation.acceptedFixtureDigest !== manifest.digest) throw new Error('--accept-fixture must exactly match the displayed manifest SHA-256. Nothing was submitted.');
  } else {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Explicit acceptance required. Review `fixture`, then pass --accept-fixture <displayed-sha256> or use an interactive terminal.');
    const readline = createInterface({input:process.stdin,output:process.stdout});
    try { await requestConsent({question:'Accept this initial goal, requirement and criteria?',lines:[]}, text=>readline.question(text)); }
    finally { readline.close(); }
  }
  const {requestId: _ignored,...payload} = input;
  const record = await resolveAdmissionRequestId(invocation.requestRecordPath,payload);
  out(`Admission request ${record.requestId}; retry using the same --request-record.`);
  const response = await client.sendCommand('task.accept_goal',record.input);
  if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
  out(JSON.stringify(response.result,null,2));
  return isAdmissionReceipt(response.result) ? 0 : 1;
}
