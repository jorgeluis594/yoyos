import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { expect, test } from "vitest";
import type { DispatchDate } from "@shared/dispatch-date";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { seedProduct } from "@core/src/features/products/infrastructure/product-seed";
import { orders } from "@core/src/features/orders/composition";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { CompanyId, OrderId, UserId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";

type SeedPayment = Readonly<{ amount: number; status?: "confirmed" | "reported" | "voided" }>;
type SeedOrder = Readonly<{ number: number; total: number; quantity?: number; payments?: readonly SeedPayment[]; cancelled?: boolean; deliveryStatus?: "pending" | "shipped" | "delivered";
  date?: string | null; fromCatalog?: boolean; confirmed?: boolean; delivery?: object | null; buyer?: Readonly<{ name: string | null; phone: string | null }>; createdAt?: Date }>;

async function scenario<T>(work: (ctx: { companyId: CompanyId; access: { companyId: CompanyId; userId: UserId }; variant: VariantId; seed: (order: SeedOrder) => Promise<OrderId> }) => Promise<T>, stock = 10) {
  const companyId = randomUUID() as CompanyId;
  await withTenantIsolation(companyId, async () => { await prisma.company.create({ data: { id: companyId, name: companyId, country: "PE" } }); });
  const sellerId = randomUUID() as UserId;
  /** The company id is random and isolated, so the rows are left behind like the other order integration tests do. */
  return withTenantIsolation(companyId, async () => {
    await systemPrisma.user.create({ data: { id: sellerId, name: "Seller", email: `${sellerId}@example.test`, companyId } });
    const seeded = await seedProduct({ variants: [{ attributes: { Talla: "M" }, stock }] });
    const variant = [...seeded.variantIds][0] as VariantId;
    const seed = async (order: SeedOrder) => {
      const id = randomUUID();
      const quantity = order.quantity ?? 1;
      const confirmed = order.confirmed ?? true;
      await prisma.order.create({ data: { id, number: BigInt(order.number), currency: "PEN", total: new Prisma.Decimal(order.total), itemsTotal: new Prisma.Decimal(order.total),
        createdAt: order.createdAt ?? new Date("2026-10-20T15:00:00Z"), cancelled: order.cancelled ?? false, cancelledAt: order.cancelled ? new Date("2026-10-21T15:00:00Z") : null,
        deliveryStatus: order.deliveryStatus ?? "pending", stockDeducted: order.deliveryStatus === "shipped", stockDeductedAt: order.deliveryStatus === "shipped" ? new Date("2026-10-21T15:00:00Z") : null,
        shippedAt: order.deliveryStatus === "shipped" ? new Date("2026-10-21T15:00:00Z") : null, fromCatalog: order.fromCatalog ?? false, checkoutEnabledAt: order.fromCatalog ? new Date("2026-10-20T15:00:00Z") : null,
        checkoutConfirmedAt: order.fromCatalog && confirmed ? new Date("2026-10-20T15:00:00Z") : null,
        scheduledDispatchDate: order.date ? new Date(`${order.date}T00:00:00Z`) : null, delivery: (order.delivery ?? Prisma.JsonNull) as never,
        sellerId: order.fromCatalog ? null : sellerId } });
      const buyer = order.buyer ?? (order.fromCatalog && confirmed ? { name: "Ana Quispe", phone: "+51987654321" } : null);
      if (buyer) await prisma.orderBuyer.create({ data: { orderId: id, name: buyer.name, phone: buyer.phone } });
      await prisma.orderItem.create({ data: { orderId: id, variantId: variant, productName: "Camisa", variantAttributes: { Talla: "M" }, quantity: BigInt(quantity),
        unitPrice: new Prisma.Decimal(order.total / quantity), subtotal: new Prisma.Decimal(order.total) } });
      for (const payment of order.payments ?? []) await prisma.payment.create({ data: { id: randomUUID(), orderId: id, status: payment.status ?? "confirmed",
        amount: payment.status === "reported" ? null : new Prisma.Decimal(payment.amount), currency: "PEN", method: payment.status === "reported" ? null : "bank_transfer",
          data: payment.status === "reported" ? { receiptImageId: randomUUID(), reportedAt: "2026-10-21T15:00:00.000Z" }
            : { confirmedAt: "2026-10-21T15:00:00.000Z", confirmedBy: { kind: "seller", userId: sellerId }, evidence: { kind: "manual" } } } });
      return id as OrderId;
    };
    return await work({ companyId, access: { companyId, userId: sellerId }, variant, seed });
  });
}

const page = (over: object = {}) => ({ page: 1, view: "all" as const, customer: { kind: "all" as const }, ...over }) as never;
const numbersOf = (result: Awaited<ReturnType<typeof orders.listAggregates>>) => {
  if (!result.success) throw new Error(result.error.message);
  return result.data.items.map((item) => Number(item.number)).sort();
};

test("finds an order by number only in its company", async () => {
  let foreign = 0;
  await scenario(async ({ seed }) => { foreign = 1001; await seed({ number: foreign, total: 50 }); });
  await scenario(async ({ seed, access }) => {
    await seed({ number: 1002, total: 50 });
    const found = await orders.getAggregateByNumber({ number: 1002 as OrderNumber }, access);
    expect(found).toMatchObject({ success: true, data: { number: 1002 } });
    expect(await orders.getAggregateByNumber({ number: foreign as OrderNumber }, access)).toMatchObject({ success: false, error: { code: "ORDER_NOT_FOUND" } });
  });
});

test("does not find an unconfirmed catalog order by number", async () => {
  await scenario(async ({ seed, access }) => {
    await seed({ number: 1070, total: 50, fromCatalog: true, confirmed: false });
    await seed({ number: 1071, total: 50, fromCatalog: true, confirmed: true });
    expect(await orders.getAggregateByNumber({ number: 1070 as OrderNumber }, access)).toMatchObject({ success: false, error: { code: "ORDER_NOT_FOUND" } });
    expect(await orders.getAggregateByNumber({ number: 1071 as OrderNumber }, access)).toMatchObject({ success: true });
  });
});

test("search without phone does not match the buyer phone", async () => {
  await scenario(async ({ seed, access }) => {
    await seed({ number: 1001, total: 50, buyer: { name: "Ana Quispe", phone: "+51987654789" } });
    await seed({ number: 1002, total: 50, buyer: { name: "Luis Rojas", phone: null } });
    expect(numbersOf(await orders.listAggregates(page({ search: "987654789" }), access))).toEqual([1001]);
    expect(numbersOf(await orders.listAggregates(page({ search: "987654789", searchPhone: "exclude" }), access))).toEqual([]);
    expect(numbersOf(await orders.listAggregates(page({ search: "ana", searchPhone: "exclude" }), access))).toEqual([1001]);
    expect(numbersOf(await orders.listAggregates(page({ search: "#1002", searchPhone: "exclude" }), access))).toEqual([1002]);
  });
});

test("lists paid and unpaid views over not-cancelled orders and excludes cancelled ones on request", async () => {
  await scenario(async ({ seed, access }) => {
    await seed({ number: 1001, total: 100, payments: [{ amount: 100 }] });
    await seed({ number: 1002, total: 100, payments: [{ amount: 40 }] });
    await seed({ number: 1003, total: 100, payments: [{ amount: 100 }], cancelled: true });
    await seed({ number: 1004, total: 100, cancelled: true });
    await seed({ number: 1005, total: 100 });
    expect(numbersOf(await orders.listAggregates(page({ view: "paid" }), access))).toEqual([1001]);
    expect(numbersOf(await orders.listAggregates(page({ view: "unpaid" }), access))).toEqual([1002, 1005]);
    expect(numbersOf(await orders.listAggregates(page(), access))).toEqual([1001, 1002, 1003, 1004, 1005]);
    expect(numbersOf(await orders.listAggregates(page({ cancelled: "exclude" }), access))).toEqual([1001, 1002, 1005]);
  });
});

test("summarizes count, owed amount and pending reports over every unpaid order", async () => {
  await scenario(async ({ seed, access }) => {
    await seed({ number: 1060, total: 100 });
    await seed({ number: 1061, total: 80, payments: [{ amount: 30 }, { amount: 0, status: "reported" }] });
    await seed({ number: 1062, total: 80, payments: [{ amount: 80 }] });
    await seed({ number: 1063, total: 80, cancelled: true });
    await seed({ number: 1070, total: 90, fromCatalog: true, confirmed: false });
    expect(await orders.summarizeUnpaid({}, access)).toEqual({ success: true, data: { count: 2, withPendingReport: 1, owed: [{ amount: 150, currency: "PEN" }] } });
  });
  await scenario(async ({ access }) => {
    expect(await orders.summarizeUnpaid({}, access)).toEqual({ success: true, data: { count: 0, withPendingReport: 0, owed: [] } });
  });
});

test("knows whether a store has any confirmed order", async () => {
  await scenario(async ({ seed, access }) => {
    expect(await orders.hasAny({}, access)).toEqual({ success: true, data: false });
    await seed({ number: 1070, total: 90, fromCatalog: true, confirmed: false });
    expect(await orders.hasAny({}, access)).toEqual({ success: true, data: false });
    await seed({ number: 1001, total: 90 });
    expect(await orders.hasAny({}, access)).toEqual({ success: true, data: true });
  });
});

const recipient = { name: "Rosa Quispe", phone: "+51987654321", identity: { kind: "absent" } };
const pricing = { quotationId: randomUUID(), rateId: randomUUID(), optionId: randomUUID(), settingsVersion: 1 };
const home = { method: "home", recipient, pricing, recordedBy: { kind: "buyer" },
  destination: { country: "PE", districtCode: "150122", district: "Miraflores", province: "Lima", department: "Lima", address: "Av. Larco 123", instructions: null } };
const storePickup = { method: "store", recipient, settingsVersion: 1, recordedBy: { kind: "buyer" }, pickupPoint: { name: "Tienda principal", address: "Av. Lima 1", instructions: null } };
test("dispatch candidates exclude cancelled, delivered, future and unconfirmed catalog orders", async () => {
  await scenario(async ({ seed, access, variant }) => {
    const ready = await seed({ number: 1048, total: 80, date: "2026-10-28", delivery: home, payments: [{ amount: 80 }, { amount: 0, status: "reported" }] });
    await seed({ number: 1049, total: 80, date: "2026-10-31", delivery: home });
    await seed({ number: 1050, total: 80, date: "2026-10-30", delivery: home, cancelled: true });
    await seed({ number: 1051, total: 80, date: "2026-10-30", delivery: home, deliveryStatus: "shipped" });
    await seed({ number: 1052, total: 80, date: "2026-10-30", delivery: home, fromCatalog: true, confirmed: false });
    await seed({ number: 1053, total: 80, date: null, delivery: home });
    await seed({ number: 1054, total: 80, date: "2026-10-30", delivery: null });
    await seed({ number: 1055, total: 80, date: "2026-10-30", delivery: storePickup, quantity: 2 });
    const today = "2026-10-30" as DispatchDate;
    const queue = await orders.listDispatchQueue({ today, page: 1 }, access);
    if (!queue.success) throw new Error(queue.error.message);
    expect(queue.data.entries.map((entry) => [Number(entry.order.number), entry.group, entry.readiness.kind])).toEqual([
      [1048, "overdue", "ready"], [1054, "today", "delivery_unassigned"], [1055, "today", "blocked"]]);
    expect(queue.data.undatedPending).toBe(1);
    expect(queue.data.summary).toEqual({ overdue: 1, overdueReady: 1, today: 2, todayReady: 0 });
    expect(queue.data.entries[0]!.order.id).toBe(ready);
    expect(variant).toBeTruthy();
  });
});

test("answers queue too large above the candidate ceiling through the composed operation", async () => {
  await scenario(async ({ seed, access }) => {
    for (let index = 0; index < 4; index += 1) await seed({ number: 1001 + index, total: 10, date: "2026-10-29", delivery: home });
    const through = "2026-10-30" as DispatchDate;
    const { findDispatchCandidates } = await import("@core/src/features/orders/infrastructure/order-repository");
    const { withinReadSnapshot } = await import("@core/src/shared/infrastructure/persistance");
    const tooMany = await withinReadSnapshot(() => findDispatchCandidates(through, 3, access.companyId));
    expect(tooMany).toEqual({ success: true, data: "too_many" });
    const exact = await withinReadSnapshot(() => findDispatchCandidates(through, 4, access.companyId));
    expect(exact.success && exact.data !== "too_many" && exact.data.map((candidate) => candidate.number)).toEqual([1001, 1002, 1003, 1004]);
  });
});

test("lists the product's example queue in order with the expected reasons", async () => {
  await scenario(async ({ seed, access }) => {
    const paid = [{ amount: 80 }];
    await seed({ number: 1047, total: 80, date: null, delivery: home, payments: paid });
    await seed({ number: 1048, total: 80, date: "2026-10-28", delivery: home, payments: paid });
    await seed({ number: 1049, total: 80, date: "2026-10-31", delivery: home, payments: paid });
    await seed({ number: 1050, total: 80, date: "2026-10-30", delivery: home, payments: paid });
    await seed({ number: 1051, total: 80, date: "2026-10-30", delivery: home });
    await seed({ number: 1052, total: 880, quantity: 11, date: "2026-10-30", delivery: home, payments: [{ amount: 880 }] });
    await seed({ number: 1053, total: 80, date: "2026-10-30", delivery: storePickup, payments: [{ amount: 40 }] });
    await seed({ number: 1054, total: 80, date: "2026-10-30", delivery: home, payments: [{ amount: 0, status: "reported" }] });
    const queue = await orders.listDispatchQueue({ today: "2026-10-30" as DispatchDate, page: 1 }, access);
    if (!queue.success) throw new Error(queue.error.message);
    expect(queue.data.entries.map((entry) => [Number(entry.order.number), entry.readiness])).toEqual([
      [1048, { kind: "ready", operation: "ship" }],
      [1050, { kind: "ready", operation: "ship" }],
      [1051, { kind: "blocked", operation: "ship", reason: { code: "SHIP_PAYMENT_REQUIRED", pendingReport: false } }],
      [1052, { kind: "blocked", operation: "ship", reason: { code: "STOCK_WAITING", variantIds: [expect.any(String)] } }],
      [1053, { kind: "blocked", operation: "deliver", reason: { code: "PAYMENT_REQUIRED", pendingReport: false } }],
      [1054, { kind: "blocked", operation: "ship", reason: { code: "SHIP_PAYMENT_REQUIRED", pendingReport: true } }],
    ]);
    expect(queue.data.undatedPending).toBe(1);
    expect(queue.data.summary).toEqual({ overdue: 1, overdueReady: 1, today: 5, todayReady: 1 });
  });
});

test("a partially paid home delivery with more items than stock waits for stock naming the variant", async () => {
  await scenario(async ({ seed, access, variant }) => {
    await seed({ number: 1080, total: 80, quantity: 4, date: "2026-10-30", delivery: home, payments: [{ amount: 30 }] });
    const queue = await orders.listDispatchQueue({ today: "2026-10-30" as DispatchDate, page: 1 }, access);
    if (!queue.success) throw new Error(queue.error.message);
    expect(queue.data.entries.map((entry) => entry.readiness)).toEqual([{ kind: "blocked", operation: "ship", reason: { code: "STOCK_WAITING", variantIds: [variant] } }]);
    const detail = await orders.getAggregateByNumber({ number: 1080 as OrderNumber }, access);
    if (!detail.success) throw new Error(detail.error.message);
    const described = await orders.describeDispatchStock([detail.data]);
    if (!described.success) throw new Error(described.error.message);
    expect(described.data.get(detail.data.id)).toEqual({ stockDue: null, shortAtCurrentStock: [variant] });
  }, 3);
});
