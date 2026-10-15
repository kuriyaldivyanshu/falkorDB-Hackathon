import type { SqlDatabase, TxClient } from '../src/storage/pg.js';

export function sqlDouble(
  run: (text: string, values: readonly unknown[]) => unknown[] | Promise<unknown[]>,
): SqlDatabase {
  let closed = false;
  const rows: TxClient['rows'] = async <T>(text: string, values: readonly unknown[] = []) =>
    await run(text, values) as T[];
  return {
    query: rows,
    withTransaction: work => work({ rows }),
    withTenantTransaction: (_tenantId, work) => work({ rows }),
    ping: async () => {},
    close: async () => { closed = true; },
    get closed() { return closed; },
  };
}
