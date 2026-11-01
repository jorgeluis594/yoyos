import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { expect, it, vi } from "vitest";
import { createPgBossProvider } from "@core/src/shared/events/infrastructure/pg-boss-provider";
import { registerScheduledJobs, scheduledJobs } from "@core/src/composition/scheduled-jobs";
import { recoverStockDeductionsJob } from "@core/src/features/orders/composition";
import { log } from "@core/src/shared/infrastructure/logger";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { seedProduct } from "@core/src/features/products/infrastructure/product-seed";

/**
 * Measures the recovery job against a running worker (a few minutes, so it only runs when STOCK_RECOVERY_MEASURE=1):
 * ten due and undeducted orders are inserted at different offsets of the minute, and each one is deducted by the job within the bound.
 */
it.skipIf(!process.env.STOCK_RECOVERY_MEASURE)("the recovery job deducts a due order that becomes overdue right after a pass within the worst-case bound", async () => {
  const companyId = randomUUID();
  const sellerId = randomUUID();
  const suffix = randomUUID().slice(0, 8);
  const variantId = await withTenantIsolation(companyId, async () => {
    await prisma.company.create({ data: { id: companyId, name: "Recovery", country: "PE" } });
    await systemPrisma.user.create({ data: { id: sellerId, name: "Seller", email: `${sellerId}@example.test`, companyId } });
    return (await seedProduct({ variants: [{ stock: 1000 }] })).variantIds[0]!;
  });
  const recovered = vi.spyOn(log, "warn");
  const provider = createPgBossProvider<Record<string, never>>({ connectionString: process.env.DATABASE_URL!, subscriptions: [], consume: true });
  await provider.start();
  // A unique queue name keeps this run apart from the real schedule; the job and its policy are the real ones.
  const [, , recovery] = scheduledJobs(7, { reader: { listBlockedKeys: async () => ({ success: true, data: [] }) }, handlerIds: [] }, recoverStockDeductionsJob);
  const registered = await registerScheduledJobs(provider, [{ ...recovery!, name: `recover-due-stock-deductions-${suffix}` }]);
  expect(registered.success).toBe(true);
  const results: { insertedAtSecond: number; deductedAfterMs: number }[] = [];
  try {
    const insert = () => withTenantIsolation(companyId, async () => {
      const id = randomUUID();
      const createdAt = new Date();
      await prisma.order.create({ data: { id, number: BigInt(Math.floor(Math.random() * 1e9) + 1001), sellerId, currency: "PEN", total: new Prisma.Decimal(10), itemsTotal: new Prisma.Decimal(10), createdAt } });
      await prisma.orderItem.create({ data: { orderId: id, orderCreatedAt: createdAt, variantId, productName: "Camisa", variantAttributes: {}, quantity: 1n, unitPrice: new Prisma.Decimal(10), subtotal: new Prisma.Decimal(10) } });
      await prisma.payment.create({ data: { id: randomUUID(), orderId: id, status: "confirmed", amount: new Prisma.Decimal(10), currency: "PEN", method: "bank_transfer",
        data: { confirmedAt: new Date().toISOString(), confirmedBy: { kind: "legacy" }, evidence: { kind: "manual" } } } });
      return id;
    });
    const isDeducted = (id: string) => withTenantIsolation(companyId, async () => (await prisma.order.findUniqueOrThrow({ where: { id } })).stockDeducted);
    const runStart = Date.now();
    const pending: Promise<void>[] = [];
    for (let index = 0; index < 10; index += 1) {
      const wait = runStart + index * 7000 - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      const insertedAt = Date.now();
      const id = await insert();
      pending.push((async () => {
        while (!await isDeducted(id)) await new Promise((resolve) => setTimeout(resolve, 250));
        results.push({ insertedAtSecond: new Date(insertedAt).getSeconds(), deductedAfterMs: Date.now() - insertedAt });
      })());
    }
    await Promise.all(pending);
    const max = Math.max(...results.map((result) => result.deductedAfterMs));
    if (process.env.STOCK_MEASURE_FILE) appendFileSync(process.env.STOCK_MEASURE_FILE, JSON.stringify({ measure: "recovery_deduction_latency", insertions: results.length, maxMs: max, results }) + "\n");
    expect(results).toHaveLength(10);
    expect(max).toBeLessThan(45_000);
    expect(recovered.mock.calls.some(([fields]) => (fields as { event?: string }).event === "stock_deduction_recovered")).toBe(true);
  } finally {
    recovered.mockRestore();
    if (registered.success) await registered.data();
    await provider.stop();
  }
}, 300_000);
