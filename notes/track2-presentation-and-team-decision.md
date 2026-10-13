# Threadline: presentation and team decision

**Planning recommendation, 2026-10-13. No code, package, deployment or compatibility test exists yet.** This note incorporates two DevOps teammates; it does not modify the earlier master documents.

## Decision and delivery order

**Build a web-first working agent application: Railway dashboard and shared FalkorDB service, an existing-runtime Builder/Verifier team, and a thin npm local-worker connector.** The graph decides which constraints, decisions, evidence and unfinished work govern the next action. A memory API or attractive dashboard alone is not the submission.

Delivery order:

1. **Primary:** hosted dashboard plus real agents completing the authored public inventory-export fixture. Judges can inspect a working run, sources, changes and recovery.
2. **Next:** npm connector runs the same controlled workflow on a supported permitted local workspace, communicating with the same service protocol.
3. **Later/gated:** MCP exposure and native Codex/Claude adapters. Automatic integration with every harness is unsupported.
4. **Optional experiment:** bounded child investigations after the core works; depth 1 and four total live workers. Do not make recursive swarms the prerequisite for a complete demo.

There is one browser interface. CLI commands support connection, readiness and worker execution; no full TUI, embedded IDE or independent local dashboard is needed.

## Complete architecture

- **Web/API service:** React dashboard and TypeScript API; authentication, project routing, typed memory operations, revision guards, task ownership, delivery acknowledgements and coordination. Only this service owns database credentials. The worker runs the selected SDK/model loop and owns its provider credentials.
- **FalkorDB service:** private graph endpoint with pinned image and configured disk persistence. Own goals, current and historical constraints, decisions, tasks, attempts, procedures, sessions, ordered messages, receipts and loaded-context relationships. Trusted identity selects the `(tenant, project)` graph; the model cannot choose another graph.
- **Hosted fixture executor:** separate execution service for the authored repository, with Builder/Verifier working copies and controlled read/edit/test operations. No arbitrary repository uploads or open terminal endpoint. Keep provider/database credentials out of the test-code execution environment. Preserve needed patches/logs in a durable artifact store; the graph holds their versions, digests and relationships.
- **Local connector:** authenticated outbound HTTPS connection to the API; executes scoped workspace operations locally and returns declared messages, observations and actual receipts. No public local shell listener and no direct public database connection. The hosted browser cannot access local files without the running connector.

Railway documents container/image services, internal service networking and persistent mounted volumes. Use those capabilities, then test image startup, connectivity, mount paths and restart recovery. A private network and a mounted volume do not establish code isolation or correct database durability. [Services](https://docs.railway.com/services), [private networking](https://docs.railway.com/networking/private-networking), [volumes](https://docs.railway.com/volumes)

The cloud executor is a **controlled fixture demonstration**, not a proven safe platform for arbitrary agent-generated programs or mutually hostile users. Restricted tool interfaces and separate directories are not sufficient sandbox guarantees. Keep run controls authenticated, fixtures bounded and costs capped; do not open unrestricted execution to anonymous visitors. If the event-time execution boundary fails its tests, retain the hosted dashboard/service and execute the same fixture through the local worker. Label that topology accurately.

## User journey and controls

Open the web workspace, select the public fixture and enter exact feature criteria. Start Builder and Verifier. Builder investigates and edits; Verifier independently checks the current artifacts and criteria. The service accepts completion only with current evidence.

The screen shows current goal/tasks, captured conversation/activity and an evidence inspector. A selected decision reveals its source message, applicability and relevant path; a test receipt identifies its tested revision. The user can pause at a supported boundary, change a requirement, answer an ambiguity, continue a task with a fresh agent and review the final patch.

On a requirement change, follow recorded dependencies to affected tasks, evidence and workers who loaded that context. Refresh those workers at supported boundaries. Then interrupt Builder, start a genuinely fresh successor and let it reconcile the workspace, recall the applicable rejection and perform the required next check. An old worker's stale result cannot complete the current task. Unrecorded context remains missing, and outdated verification means recheck—not proof that code is broken.

Local use follows the same journey after connector pairing. Proposed command surface, **illustrative only; package name is unreserved**:

```text
npx <package> doctor
npx <package> connect --server <service-url> --workspace <permitted-path>
npx <package> worker
```

Use browser pairing for scoped authorization; do not put credentials into a shareable command. The submission uses authored/public/synthetic data, including local fixtures. No private repository/chat import is part of this plan.

## Demonstration of every Track 2 focus area

| Focus | Concrete proof required |
|---|---|
| Three memory types | Recall an evidenced failed attempt; use current source-bound constraints/decisions; reuse one tested procedure on a held-out compatible task, checking conditions and recording a new receipt. |
| Conversation persistence | Inspect ordered `Session`/`Message` history and a restored decision's original source after restart; display capture gaps. |
| Shared state/handoffs | Real Builder-to-fresh-successor continuation, Verifier evidence, affected-worker acknowledgement and stale completion rejection. |
| Concurrent access | Separate 4/8/16-client mixed API workload; report completed operations, correctness, conflicts/retries, throughput and latency. Label simulated clients separately from actual model agents. |
| Tenant separation | Two synthetic identities with colliding task/message IDs; deny cross-tenant reads and writes, including source references. |

These are proposed evidence requirements, not achieved results or numerical organizer thresholds. The [official track](https://www.wemakedevs.org/hackathons/falkordb#tracks) supplies the focus areas.

## Four-person ownership and event gates

| Member | Ownership |
|---|---|
| DevOps 1 | Railway services, FalkorDB networking/persistence, secrets, health checks, restart recovery and documented deployment/setup |
| DevOps 2 | Fixture execution boundary, local connector packaging, worker lifecycle, crash/load probes and deployment diagnostics |
| Engineer 3 | Typed graph memory, applicability/retrieval, revision/claim guards, SDK Builder/Verifier behavior and procedure evidence |
| Engineer 4 | Browser interaction, event delivery/history inspection, authored acceptance fixtures, fair baselines and demo/submission story |

Deployments alone do not verify the memory mechanism; share integration/testing across all four. Day 1 proves an agent action and fresh continuation through FalkorDB. Day 2 completes requirement-change recovery with both roles. Day 3 verifies history, procedure, concurrency, isolation and connector behavior. Day 4 fixes failures, freezes scope and records a reproducible working demo. Drop adapters/spawning before weakening these gates.

Present the outcome first: **“The original agent stopped and the requirement changed; its successor finished correctly using current connected memory and evidence.”** Then show the source path and measured comparison against equal-fact file/JSON continuity. No novelty, speed or winning claim precedes evidence. Main implementation and interface design remain event-time work; this is written preparation.
