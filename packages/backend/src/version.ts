/**
 * Version identity for the memory service.
 *
 * Exact dependency patches, container digests and the qualified Codex version
 * are recorded during packaging qualification; these constants identify the
 * running code and the graph schema it expects so a mismatch is reported rather
 * than assumed compatible.
 */

export const THREADLINE_BACKEND_VERSION = '0.1.0';

/** Version of the FalkorDB node/relationship contract this build reads and writes. */
export const MEMORY_GRAPH_SCHEMA_VERSION = 1;

/** Version of the SQL contract in `threadline_memory`. */
export const MEMORY_SQL_SCHEMA_VERSION = 1;

/** Version of the selection policy that produced a context manifest. */
export const CONTEXT_SELECTION_POLICY_VERSION = 1;
