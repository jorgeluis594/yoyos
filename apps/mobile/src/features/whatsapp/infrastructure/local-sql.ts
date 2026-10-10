import type { SQLiteBindValue } from "expo-sqlite";

/** The subset of expo-sqlite's async database used by the WhatsApp adapters. */
export type SqlDatabase = Readonly<{
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params: SQLiteBindValue[]): Promise<{ changes: number }>;
  getFirstAsync<T>(sql: string, params: SQLiteBindValue[]): Promise<T | null>;
  getAllAsync<T>(sql: string, params: SQLiteBindValue[]): Promise<T[]>;
}>;

export type SqlTransaction = Readonly<{
  run(sql: string, ...params: SQLiteBindValue[]): Promise<number>;
  first<T>(sql: string, ...params: SQLiteBindValue[]): Promise<T | null>;
  all<T>(sql: string, ...params: SQLiteBindValue[]): Promise<T[]>;
}>;

export type LocalSql = SqlTransaction & Readonly<{
  /** Runs `work` inside BEGIN IMMEDIATE … COMMIT, rolling back when it throws. Statements of other callers wait. */
  transaction<T>(work: (tx: SqlTransaction) => Promise<T>): Promise<T>;
}>;

/**
 * Serializes every statement on the single connection so a transaction never interleaves with other callers.
 */
export function createLocalSql(database: SqlDatabase): LocalSql {
  let tail: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(work, work);
    tail = result.catch(() => undefined);
    return result;
  };
  const direct: SqlTransaction = {
    run: async (sql, ...params) => (await database.runAsync(sql, params)).changes,
    first: (sql, ...params) => database.getFirstAsync(sql, params),
    all: (sql, ...params) => database.getAllAsync(sql, params),
  };
  return {
    run: (sql, ...params) => exclusive(() => direct.run(sql, ...params)),
    first: (sql, ...params) => exclusive(() => direct.first(sql, ...params)),
    all: (sql, ...params) => exclusive(() => direct.all(sql, ...params)),
    transaction: <T>(work: (tx: SqlTransaction) => Promise<T>) => exclusive(async () => {
      await database.execAsync("BEGIN IMMEDIATE");
      try {
        const value = await work(direct);
        await database.execAsync("COMMIT");
        return value;
      } catch (error) {
        await database.execAsync("ROLLBACK");
        throw error;
      }
    }),
  };
}
