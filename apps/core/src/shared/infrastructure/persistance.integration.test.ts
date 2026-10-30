import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { ok } from "@shared/functional";
import { afterTransactionCommit, getCompanyId, prisma, requireActiveTransaction, systemPrisma, withinSavepoint, withinTransaction, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

const company = () => randomUUID();

async function setting(name: "lock_timeout" | "statement_timeout" | "transaction_isolation") {
  const [row] = await prisma.$queryRawUnsafe<{ value: string }[]>(`SELECT current_setting('${name}') AS value`);
  return row.value;
}

test("opens the outermost transaction with the requested isolation level and timeouts", async () => {
  const seen = await withTenantIsolation(company(), () => withinTransaction(async () =>
    ok({ isolation: await setting("transaction_isolation"), lock: await setting("lock_timeout"), statement: await setting("statement_timeout") }),
  { isolationLevel: "RepeatableRead", lockTimeoutMs: 3000, statementTimeoutMs: 8000, timeout: 10_000, maxWait: 2000 }));
  expect(seen).toEqual({ success: true, data: { isolation: "repeatable read", lock: "3s", statement: "8s" } });
});

test("sets only the PostgreSQL limit that is named and keeps the other", async () => {
  const seen = await withTenantIsolation(company(), () => withinTransaction(async () =>
    ok({ lock: await setting("lock_timeout"), statement: await setting("statement_timeout") }), { lockTimeoutMs: 3000 }));
  const baseline = await withTenantIsolation(company(), () => withinTransaction(async () => ok({ statement: await setting("statement_timeout") })));
  expect(seen).toEqual({ success: true, data: { lock: "3s", statement: baseline.success ? baseline.data.statement : "" } });
  const statementOnly = await withTenantIsolation(company(), () => withinTransaction(async () =>
    ok({ lock: await setting("lock_timeout"), statement: await setting("statement_timeout") }), { statementTimeoutMs: 8000 }));
  expect(statementOnly).toEqual({ success: true, data: { lock: "0", statement: "8s" } });
});

test("leaves PostgreSQL defaults when no options are given", async () => {
  const seen = await withTenantIsolation(company(), () => withinTransaction(async () =>
    ok({ isolation: await setting("transaction_isolation"), lock: await setting("lock_timeout") })));
  expect(seen).toEqual({ success: true, data: { isolation: "read committed", lock: "0" } });
});

test("ignores the options inside an active transaction", async () => {
  const id = company();
  const seen = await withTenantIsolation(id, () => withinTransaction(async () =>
    withinTransaction(async () => ok({ isolation: await setting("transaction_isolation"), lock: await setting("lock_timeout") }),
      { isolationLevel: "Serializable", lockTimeoutMs: 1000 })));
  expect(seen).toEqual({ success: true, data: { isolation: "read committed", lock: "0" } });
});

test("a repeatable read transaction keeps one snapshot between its queries", async () => {
  const id = company();
  await withTenantIsolation(id, async () => await prisma.company.create({ data: { id, name: id, country: "PE" } }));
  try {
    const result = await withTenantIsolation(id, () => withinTransaction(async () => {
      const before = await prisma.company.findUniqueOrThrow({ where: { id } });
      // A concurrent writer outside this transaction commits between the two reads.
      await systemPrisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.company_id', ${id}, true)`;
        await tx.company.update({ where: { id }, data: { name: "renamed" } });
      });
      const after = await prisma.company.findUniqueOrThrow({ where: { id } });
      return ok({ before: before.name, after: after.name });
    }, { isolationLevel: "RepeatableRead" }));
    expect(result).toEqual({ success: true, data: { before: id, after: id } });
  } finally {
    await withTenantIsolation(id, async () => await prisma.company.delete({ where: { id } }));
  }
});

async function withCompany<T>(work: (id: string) => Promise<T>): Promise<T> {
  const id = company();
  await withTenantIsolation(id, async () => await prisma.company.create({ data: { id, name: id, country: "PE" } }));
  return withTenantIsolation(id, () => work(id));
}
const companyName = (id: string) => prisma.company.findUniqueOrThrow({ where: { id } }).then((row) => row.name);

test("a savepoint rollback keeps the producer's writes", async () => {
  await withCompany(async (id) => {
    const result = await withinTransaction(async () => {
      await prisma.company.update({ where: { id }, data: { name: "producer" } });
      const inner = await withinSavepoint(async () => {
        await prisma.company.update({ where: { id }, data: { name: "savepoint" } });
        return { success: false as const, error: { code: "NOPE", message: "no" } };
      });
      expect(inner).toEqual({ success: false, error: { code: "NOPE", message: "no" } });
      expect(await companyName(id)).toBe("producer");
      return ok(null);
    });
    expect(result.success).toBe(true);
    expect(await companyName(id)).toBe("producer");
  });
});

test("a rolled-back savepoint discards its after-commit observers and restores the abort state", async () => {
  await withCompany(async () => {
    const seen: string[] = [];
    const result = await withinTransaction(async () => {
      afterTransactionCommit(() => seen.push("producer"));
      await withinSavepoint(async () => {
        afterTransactionCommit(() => seen.push("rolled back"));
        return withinTransaction(async () => ({ success: false as const, error: { code: "NESTED", message: "no" } }));
      });
      // The nested failed Result aborted the scope; the rollback must clear it.
      expect(() => requireActiveTransaction(getCompanyId())).not.toThrow();
      return ok(null);
    });
    expect(result.success).toBe(true);
    expect(seen).toEqual(["producer"]);
  });
});

test("a released savepoint runs its after-commit observers only when the outer transaction commits", async () => {
  await withCompany(async () => {
    const seen: string[] = [];
    const committed = await withinTransaction(async () => {
      await withinSavepoint(async () => { afterTransactionCommit(() => seen.push("released")); return ok(null); });
      expect(seen).toEqual([]);
      return ok(null);
    });
    expect(committed.success).toBe(true);
    expect(seen).toEqual(["released"]);
    const rolledBack: string[] = [];
    await withinTransaction(async () => {
      await withinSavepoint(async () => { afterTransactionCommit(() => rolledBack.push("released")); return ok(null); });
      return { success: false as const, error: { code: "PRODUCER_FAILED", message: "no" } };
    });
    expect(rolledBack).toEqual([]);
  });
});

test("a statement timeout inside a savepoint is recovered and the outer transaction commits", async () => {
  await withCompany(async (id) => {
    const result = await withinTransaction(async () => {
      await prisma.company.update({ where: { id }, data: { name: "producer" } });
      const inner = await withinSavepoint(async () => {
        await prisma.$queryRaw`SELECT pg_sleep(2)`;
        return ok(null);
      }, { limitMs: () => 100 });
      expect(inner).toMatchObject({ success: false, error: { code: "CONTAINED_FAILURE", errorCode: "STATEMENT_TIMEOUT" } });
      // The producer keeps working and its own timeouts are back.
      expect(await setting("statement_timeout")).toBe("5s");
      return ok(await companyName(id));
    }, { statementTimeoutMs: 5000, lockTimeoutMs: 2000 });
    expect(result).toEqual({ success: true, data: "producer" });
    expect(await companyName(id)).toBe("producer");
  });
});

test("restores the producer's timeouts after a released savepoint", async () => {
  await withCompany(async () => {
    const seen = await withinTransaction(async () => {
      const inside = await withinSavepoint(async () => ok(await setting("lock_timeout")), { limitMs: () => 700 });
      return ok({ inside, after: await setting("lock_timeout") });
    }, { lockTimeoutMs: 2000 });
    expect(seen).toEqual({ success: true, data: { inside: { success: true, data: "700ms" }, after: "2s" } });
  });
});

test("rethrows an error that is not a statement-level database error and aborts the scope", async () => {
  await withCompany(async () => {
    await expect(withinTransaction(async () => {
      await withinSavepoint(async () => { throw new Error("programming error"); });
      return ok(null);
    })).rejects.toThrow("programming error");
  });
});
