# Threadline: small Railway deployment

**Checked 13 October 2026. Documentation research and architecture proposal; nothing was deployed or runtime-tested.** With two DevOps members, make the hosted demo the primary delivery and keep the same application runnable locally. Preserve the controlled agent runtime, current-evidence checks and fresh-session recovery already proposed; hosting does not expand the product into arbitrary repository execution.

## Recommended architecture — proposal

Use **one Railway project/environment, three services, two volumes and one public domain**. Keep services in one region. No additional database, broker or distributed scheduler.

| Service | Responsibility | Exposure/storage |
|---|---|---|
| `app` | TypeScript Node API; serves built React UI; authenticates demo sessions; accepts start/cancel/change-requirement requests; streams recorded events | Public HTTPS; no volume required |
| `runner` | One pinned agent SDK; Builder/Verifier and bounded investigators; tool policy; workspace/receipt capture; task reconciliation | Private service; one volume containing workspaces and immutable artifact/log payloads |
| `falkordb` | Goals, task revisions, sessions/messages, conditional decisions, evidence links, assignments, budgets and event metadata | Private database service; its own data volume |

The browser talks only to `app`. The runner calls the application's typed domain API; only `app` owns graph credentials and invokes the graph core. The runner owns filesystem artifacts. Fetch large hosted artifacts through a scoped private runner endpoint, proxied by the API. These two services cannot rely on sharing a mounted filesystem. Small visible message payloads can live in FalkorDB; larger immutable payloads need digests and locators. Local workers push bounded observations/receipts outward; they expose no inbound filesystem endpoint.

Initially permit **one active hosted demo run**, using the authored inventory-export repository and explicit budgets. Builder owns edits; investigators inspect; Verifier runs current acceptance checks. Preserve the proposed four-live-worker maximum, but start with Builder/Verifier. Optional MCP and external-host adapters remain secondary.

## Platform facts established by current documentation

Railway services can run continuously and deploy from Docker images, GitHub or local source. Public images can come from Docker Hub/GHCR; a repository Dockerfile is supported. Therefore a custom runner image and pinned FalkorDB image are documented deployment routes; their particular compatibility remains untested. [Services](https://docs.railway.com/services), [Dockerfiles](https://docs.railway.com/builds/dockerfiles)

Private networking supports TCP between services in the same environment using internal DNS. New environments resolve IPv4 and IPv6; legacy ones may be IPv6-only. Configure the selected client and listening address accordingly. A browser cannot reach private DNS directly. Connect to the database's actual listening port, normally 6379, without creating a public TCP proxy. [Private network architecture](https://docs.railway.com/networking/private-networking/how-it-works), [domain scope](https://docs.railway.com/networking/domains/working-with-domains)

Volumes mount **when the container starts**, not during build or pre-deploy. Railway documents one volume per service, no replicas with volumes, and downtime when redeploying a volume-backed service. This is a single-instance demo with restart recovery, not high availability. Initialize writable workspace state at startup; keep packaged source outside the mount. [Volume use](https://docs.railway.com/volumes), [volume limitations](https://docs.railway.com/volumes/reference)

The edge supports WebSockets. Streaming HTTP requests can last up to **15 minutes**, or close after **5 minutes without data**; WebSockets are exempt from those edge limits. Connections can still disappear when their service stops. [Current networking limits](https://docs.railway.com/networking/public-networking/specs-and-limits)

Redeploy teardown sends SIGTERM and eventually SIGKILL, with configurable draining. Restart policy restarts a container; it does not reconstruct an agent's in-memory state. [Teardown](https://docs.railway.com/deployments/deployment-teardown), [restart policy](https://docs.railway.com/deployments/restart-policy)

## Persistence decision and important first probe

FalkorDB documents a server-only image, authentication and AOF configuration. Its Docker examples use `/data`, but its dedicated persistence guide and Docker FAQ identify **`/var/lib/falkordb/data`**. Do not copy the inconsistent mount blindly. Pin the actual compatible image and explicitly configure/inspect its data directory before choosing the Railway mount. [Docker guide](https://docs.falkordb.com/operations/docker), [dedicated persistence guide](https://docs.falkordb.com/operations/durability/persistence)

Proposed policy: enable AOF, probe `appendfsync always` for this small correctness-focused demo, and use backups. It trades throughput for stronger persistence; it does not establish zero loss under every failure. `everysec` permits an acknowledged-write loss window. Confirm the chosen engine's effective configuration and persistence status, including ACL configuration if used. [Durability options](https://docs.falkordb.com/operations/durability/)

Do not copy a cache-oriented eviction policy into authoritative memory. Fail visibly on exhausted resources; monitor graph RAM, disk, AOF growth and runner capacity. A data volume preserves files, not running processes or the relationship between a tool effect and its recorded receipt.

## Execution, streaming and cancellation — proposal

Start requests return a run ID promptly. The single runner checks persisted ready tasks and claims work through tested revision/ownership guards; no external queue is necessary at this scale. Disable service sleeping during the demo. Model credentials remain in the runner; database credentials remain server-side.

Use SSE for simple progress, with heartbeat, ordered event IDs, reconnect and replay from the last recorded event. Rotate the connection before the HTTP maximum. Execution must continue independently of that subscription. WebSockets are an alternative if already familiar; they do not supply durability.

On SIGTERM or cancel: stop admitting work, request SDK cancellation, terminate/reconcile controlled child processes, flush observable records and mark unfinished effects uncertain. After restart, validate artifacts and create fresh worker sessions from current graph context. Reject results from obsolete requirements/assignments. Cancellation cannot undo an effect already performed; do not label it complete until observed termination/reconciliation.

A Railway container is not a demonstrated security boundary for executing hostile repositories. Hosted core accepts the authored fixture only. General repository support belongs in a future sandbox boundary; separate directories alone are insufficient.

## Four-person delivery and local route — proposal

DevOps A owns images, private connectivity, FalkorDB persistence and tested backup/restore. DevOps B owns runner lifecycle, cancellation, restart/replay and clean local setup. The other members own graph/application behavior and browser/acceptance evidence, with shared integration from day one.

First event-time gate: deploy a tiny API/runner/graph path; write a graph event and artifact; replace each service; verify private access, preserved state and reconnect. Then prove a real SDK call, termination and fresh recovery. Test requirement revision, stale receipt rejection and a second demo identity before polishing.

Publish an npm CLI only after checking package-name availability and a clean install. The first package pairs and starts the same worker against the hosted API, scoped to a permitted local workspace; it needs Node, supported model credentials and an authenticated service session. Fully local use can follow documented Docker/self-hosted setup with the same API and worker, requiring Docker as an additional prerequisite. Automatic full-stack provisioning is secondary to the local connector. These are proposed distribution routes, not packages that exist today. Avoid a second TUI or universal installer during the event.

Outstanding probes: pinned-image startup/options, SDK dependencies and credentials, private client resolution, actual persistence after abrupt failure, child-process cancellation, SSE replay and resource/cost behavior. Railway infrastructure bills and model usage are separate; no reliable total estimate exists before these measurements.
