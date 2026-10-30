import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { expect, test } from "vitest";
import { ok } from "@shared/functional";
import { prisma, systemPrisma, withinTransaction, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { seedProduct } from "@core/src/features/products/infrastructure/product-seed";
import { isStockDeductionDue } from "@core/src/features/orders/domain/stock-deduction";
import { listCompaniesWithOverdueStockDeductions, listOverdueOrderIds, listWaitingOrderIds, loadStockOrders, lockOrdersSkipLocked, saveStockDeductions } from "@core/src/features/orders/infrastructure/order-repository";
import type { CompanyId, OrderId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";

type SeedPayment = Readonly<{ amount: number; status?: "confirmed" | "voided" | "reported"; deductStockIfPartial?: boolean }>;
type SeedOrder = Readonly<{ total: number; items: readonly [number, number][]; payments?: readonly SeedPayment[]; createdAt?: Date; stockDeducted?: boolean; cancelled?: boolean; deliveryStatus?: string }>;
let numbers = 1001;

async function scenario<T>(stocks: number[], work: (ctx: { companyId: CompanyId; variants: VariantId[]; seed: (order: SeedOrder) => Promise<OrderId> }) => Promise<T>) {
  const companyId = randomUUID() as CompanyId;
  await withTenantIsolation(companyId, async () => { await prisma.company.create({ data: { id: companyId, name: companyId, country: "PE" } }); });
  return withTenantIsolation(companyId, async () => {
    const sellerId = randomUUID();
    await systemPrisma.user.create({ data: { id: sellerId, name: "Seller", email: `${sellerId}@example.test`, companyId } });
    const seeded = await seedProduct({ variants: stocks.map((stock, index) => ({ attributes: { Talla: `T${index}` }, stock })) });
    const variants = [...seeded.variantIds] as VariantId[];
    const seed = async (order: SeedOrder) => {
      const id = randomUUID();
      await prisma.order.create({ data: { id, number: BigInt(numbers++), currency: "PEN", total: new Prisma.Decimal(order.total), itemsTotal: new Prisma.Decimal(order.total),
        createdAt: order.createdAt ?? new Date(), stockDeducted: order.stockDeducted ?? false, cancelled: order.cancelled ?? false, deliveryStatus: order.deliveryStatus ?? "pending",
        fromCatalog: false, sellerId } });
      for (const [variant, quantity] of order.items) await prisma.orderItem.create({ data: { orderId: id, variantId: variants[variant]!, productName: "Camisa", variantAttributes: {},
        quantity: BigInt(quantity), unitPrice: new Prisma.Decimal(1), subtotal: new Prisma.Decimal(quantity) } });
      for (const payment of order.payments ?? []) await prisma.payment.create({ data: { id: randomUUID(), orderId: id, status: payment.status ?? "confirmed",
        amount: payment.status === "reported" ? null : new Prisma.Decimal(payment.amount), currency: "PEN", method: payment.status === "reported" ? null : "bank_transfer",
        deductStockIfPartial: payment.deductStockIfPartial ?? false, data: {} } });
      return id as OrderId;
    };
    return work({ companyId, variants, seed });
  });
}
const tx = <T>(work: () => Promise<T>) => withinTransaction(async () => ok(await work())).then((result) => (result as { data: T }).data);
const data = <T>(result: { success: boolean; data?: T }) => { if (!result.success) throw new Error("expected success"); return result.data as T; };

test("a partially paid order without deduction request is never listed as waiting or overdue", async () => {
  await scenario([100], async ({ companyId, variants, seed }) => {
    for (let n = 0; n < 300; n += 1) await seed({ total: 100, items: [[0, 1]], payments: [{ amount: 40 }] });
    expect(data(await tx(() => listOverdueOrderIds(companyId, 500, [])))).toEqual([]);
    expect(data(await tx(() => listWaitingOrderIds(companyId, [variants[0]!], 500)))).toEqual([]);
  });
});

test("lists waiting orders of a variant oldest first, due and fitting, within the company", async () => {
  await scenario([5, 1], async ({ companyId, variants, seed }) => {
    const older = await seed({ total: 100, items: [[0, 2]], payments: [{ amount: 100 }], createdAt: new Date("2026-10-01") });
    const newer = await seed({ total: 100, items: [[0, 1]], payments: [{ amount: 40, deductStockIfPartial: true }], createdAt: new Date("2026-10-02") });
    await seed({ total: 100, items: [[0, 9]], payments: [{ amount: 100 }] }); // does not fit
    await seed({ total: 100, items: [[0, 1], [1, 2]], payments: [{ amount: 100 }] }); // another variant does not fit
    await seed({ total: 100, items: [[1, 1]], payments: [{ amount: 100 }] }); // other variant, not asked
    await seed({ total: 100, items: [[0, 1]], payments: [{ amount: 100, status: "voided" }] });
    await seed({ total: 100, items: [[0, 1]], payments: [{ amount: 100 }], cancelled: true });
    await seed({ total: 100, items: [[0, 1]], payments: [{ amount: 100 }], stockDeducted: true });
    expect(data(await tx(() => listWaitingOrderIds(companyId, [variants[0]!], 100)))).toEqual([older, newer]);
    expect(data(await tx(() => listWaitingOrderIds(companyId, [variants[0]!], 1)))).toEqual([older]);
  });
});

test("locks a set of orders in one statement and skips those held elsewhere", async () => {
  await scenario([5], async ({ companyId, seed }) => {
    const first = await seed({ total: 10, items: [[0, 1]], createdAt: new Date("2026-10-01") });
    const second = await seed({ total: 10, items: [[0, 1]], createdAt: new Date("2026-10-02") });
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let locked!: () => void;
    const lockedPromise = new Promise<void>((resolve) => { locked = resolve; });
    const holder = withinTransaction(async () => { await prisma.$queryRaw`SELECT id FROM "Order" WHERE id = ${first}::uuid FOR UPDATE`; locked(); await held; return ok(null); });
    await lockedPromise;
    try {
      expect(data(await tx(() => lockOrdersSkipLocked([second, first], companyId)))).toEqual([second]);
    } finally { release(); await holder; }
    expect(data(await tx(() => lockOrdersSkipLocked([second, first], companyId)))).toEqual([first, second]);
    expect(data(await tx(() => saveStockDeductions([first, second], companyId)))).toBe(2);
    expect(data(await tx(() => saveStockDeductions([first, second], companyId)))).toBe(0);
  });
});

test("lists overdue orders only when every item fits the current stock", async () => {
  await scenario([3, 0], async ({ companyId, seed }) => {
    const fits = await seed({ total: 100, items: [[0, 3]], payments: [{ amount: 100 }], createdAt: new Date("2026-10-01") });
    await seed({ total: 100, items: [[0, 1], [1, 1]], payments: [{ amount: 100 }] });
    await seed({ total: 100, items: [[0, 4]], payments: [{ amount: 100 }] });
    expect(data(await tx(() => listOverdueOrderIds(companyId, 10, [])))).toEqual([fits]);
    expect(data(await tx(() => listOverdueOrderIds(companyId, 10, [fits])))).toEqual([]);
  });
});

test("the overdue companies lookup returns only company ids and other companies' orders stay invisible", async () => {
  await scenario([3], async ({ companyId, seed }) => {
    await seed({ total: 100, items: [[0, 1]], payments: [{ amount: 100 }] });
    const companies = data(await listCompaniesWithOverdueStockDeductions());
    expect(companies).toContain(companyId);
    expect(companies.every((id) => typeof id === "string")).toBe(true);
    // The restricted role sees no order outside its tenant context.
    expect(await systemPrisma.order.count()).toBe(0);
  });
});

test("stores and reads the partial deduction request of a payment", async () => {
  await scenario([3], async ({ companyId, seed }) => {
    const id = await seed({ total: 100, items: [[0, 1]], payments: [{ amount: 40, deductStockIfPartial: true }, { amount: 10 }] });
    const [row] = data(await tx(() => loadStockOrders([id], companyId)));
    expect(row).toMatchObject({ ok: true, order: { confirmedPayments: expect.arrayContaining([{ amount: { amount: 40, currency: "PEN" }, deductStockIfPartial: true }, { amount: { amount: 10, currency: "PEN" }, deductStockIfPartial: false }]) } });
    const stored = await prisma.payment.findMany({ where: { orderId: id }, select: { deductStockIfPartial: true } });
    expect(stored.map((payment) => payment.deductStockIfPartial).sort()).toEqual([false, true]);
  });
});

test("the SQL due-and-fit rule and isStockDeductionDue agree on zero totals, overpayment, null amounts, voided requests and shipped or delivered orders", async () => {
  await scenario([10], async ({ companyId, seed }) => {
    const cases: SeedOrder[] = [
      { total: 100, items: [[0, 1]], payments: [{ amount: 100 }] },
      { total: 100, items: [[0, 1]], payments: [{ amount: 150 }] },
      { total: 100, items: [[0, 1]], payments: [{ amount: 60 }, { amount: 40 }] },
      { total: 100, items: [[0, 1]], payments: [{ amount: 99.99 }] },
      { total: 100, items: [[0, 1]], payments: [{ amount: 0.01, deductStockIfPartial: true }] },
      { total: 100, items: [[0, 1]], payments: [{ amount: 50, status: "voided", deductStockIfPartial: true }] },
      { total: 100, items: [[0, 1]], payments: [{ amount: 0, status: "reported" }] },
      { total: 100, items: [[0, 1]], payments: [] },
      { total: 100, items: [[0, 1]], payments: [{ amount: 100 }], deliveryStatus: "shipped", stockDeducted: true },
      { total: 100, items: [[0, 1]], payments: [{ amount: 100 }], deliveryStatus: "delivered", stockDeducted: true },
    ];
    const ids = [];
    for (const definition of cases) ids.push(await seed(definition));
    const loaded = data(await tx(() => loadStockOrders(ids, companyId)));
    const dueByDomain = new Set(loaded.flatMap((row) => row.ok && isStockDeductionDue(row.order) ? [row.order.id] : []));
    const dueBySql = new Set(data(await tx(() => listOverdueOrderIds(companyId, 100, []))));
    expect(dueBySql).toEqual(dueByDomain);
    expect(dueByDomain.size).toBe(4);
  });
});

test("restock and recovery order locks do not block a payment report insert on the same order", async () => {
  await scenario([5], async ({ companyId, seed }) => {
    const id = await seed({ total: 100, items: [[0, 1]] });
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let locked!: () => void;
    const lockedPromise = new Promise<void>((resolve) => { locked = resolve; });
    const holder = withinTransaction(async () => { await lockOrdersSkipLocked([id], companyId); locked(); await held; return ok(null); });
    await lockedPromise;
    try {
      const inserted = await withinTransaction(async () => {
        await prisma.payment.create({ data: { id: randomUUID(), orderId: id, status: "reported", amount: null, currency: "PEN", data: {} } });
        return ok(true);
      }, { lockTimeoutMs: 1000 });
      expect(inserted).toEqual({ success: true, data: true });
    } finally { release(); await holder; }
  });
});
