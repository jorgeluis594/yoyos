import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import type { CompanyId } from "@shared/identity";
import { prisma, withTenantIsolation, withinTransaction } from "@core/src/shared/infrastructure/persistance";
import { log } from "@core/src/shared/infrastructure/logger";
import { deleteSeededProducts, seedProduct } from "@core/src/features/products/infrastructure/product-seed";
import { writeStock } from "@core/src/features/products/infrastructure/stock-repository";
import type { VariantId } from "@core/src/features/products/domain/product";

const companyId = randomUUID() as CompanyId;
const asCompany = <T>(work: () => Promise<T>) => withTenantIsolation(companyId, work);

beforeAll(async () => {
  expect(process.env.DATABASE_URL, "run sh scripts/run-tests.sh integration").toBeTruthy();
  await asCompany(async () => await prisma.company.create({ data: { id: companyId, name: companyId, country: "PE" } }));
});

afterAll(async () => {
  await asCompany(async () => {
    await deleteSeededProducts();
    await prisma.company.deleteMany({ where: { id: companyId } });
  });
});

test("answers PERSISTENCE_UNAVAILABLE and logs when the written rows differ", async () => {
  const errorLog = vi.spyOn(log, "error").mockImplementation(() => undefined);
  try {
    await asCompany(async () => {
      const seeded = await seedProduct({ name: "Polo", options: [{ name: "Talla", values: ["S", "M"] }], variants: [{ attributes: { Talla: "S" }, stock: 1 }, { attributes: { Talla: "M" }, stock: 2 }] });
      const [first, second] = seeded.variantIds as VariantId[];
      const written = await withinTransaction(() => writeStock(companyId, [{ variantId: first, stock: 5 }, { variantId: randomUUID() as VariantId, stock: 9 }]));
      expect(written).toEqual({ success: false, error: expect.objectContaining({ code: "PERSISTENCE_UNAVAILABLE" }) });
      expect(errorLog).toHaveBeenCalledWith(expect.objectContaining({ event: "product_stock_write_failed", companyId, errorCode: "UNEXPECTED_ROW_COUNT" }), "product_stock_write_failed");
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain("\"stock\"");
      const ok = await withinTransaction(() => writeStock(companyId, [{ variantId: first, stock: 5 }, { variantId: second, stock: 0 }]));
      expect(ok.success).toBe(true);
      expect((await prisma.productStock.findMany({ where: { variantId: { in: [first, second] } }, orderBy: { quantity: "desc" } })).map((row) => Number(row.quantity))).toEqual([5, 0]);
    });
  } finally { errorLog.mockRestore(); }
});

test("answers PERSISTENCE_UNAVAILABLE and logs for a failed statement, and rethrows a lock timeout", async () => {
  const errorLog = vi.spyOn(log, "error").mockImplementation(() => undefined);
  const statement = vi.spyOn(prisma, "$executeRaw");
  try {
    const counts = [{ variantId: randomUUID() as VariantId, stock: 5 }];
    statement.mockRejectedValueOnce(new Error("connection reset"));
    expect(await writeStock(companyId, counts)).toEqual({ success: false, error: expect.objectContaining({ code: "PERSISTENCE_UNAVAILABLE" }) });
    expect(errorLog).toHaveBeenCalledWith(expect.objectContaining({ event: "product_stock_write_failed", companyId, errorCode: "PERSISTENCE_UNAVAILABLE" }), "product_stock_write_failed");
    expect(Object.keys(errorLog.mock.calls[0][0] as object)).toEqual(["event", "companyId", "stage", "errorCode", "durationMs", "err"]);
    errorLog.mockClear();
    const timeout = new Error("canceling statement due to lock timeout 55P03");
    statement.mockRejectedValueOnce(timeout);
    await expect(writeStock(companyId, counts)).rejects.toBe(timeout);
    expect(errorLog).not.toHaveBeenCalled();
  } finally {
    statement.mockRestore();
    errorLog.mockRestore();
  }
});
