import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { ok } from "@shared/functional";
import { prisma, systemPrisma, withinTransaction, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

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
