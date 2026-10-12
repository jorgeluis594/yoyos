import type { SqlDatabase } from "@mobile/features/whatsapp/infrastructure/local-sql";

/** Test-only: a real SQLite (Node's built-in) exposed through the adapters' database interface. */
export function openTestDatabase(): SqlDatabase & Readonly<{ close(): void }> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  return {
    execAsync: async (sql) => { database.exec(sql); },
    runAsync: async (sql, params) => ({ changes: Number(database.prepare(sql).run(...(params as never[])).changes) }),
    getFirstAsync: async <T>(sql: string, params: unknown[]) => (database.prepare(sql).get(...(params as never[])) as T | undefined) ?? null,
    getAllAsync: async <T>(sql: string, params: unknown[]) => database.prepare(sql).all(...(params as never[])) as T[],
    close: () => database.close(),
  };
}
