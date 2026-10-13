/** One open transaction. Plain SQL with $1, $2 parameters; returns rows. */
export interface Tx {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

/**
 * Database access. Every call runs `fn` in one transaction.
 *
 * - withUser: acts as a signed-in user. Row-level security applies.
 * - withService: server-only work (role service_role, bypasses RLS). Callers
 *   must check the token, signature or session first.
 *
 * Do not call withUser/withService from inside `fn`: the mock runs one
 * transaction at a time, so a nested call would wait forever.
 */
export interface Db {
  withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T>;
  withService<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}
