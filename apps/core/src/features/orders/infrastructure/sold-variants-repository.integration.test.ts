import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { expect, test } from "vitest";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { seedProduct } from "@core/src/features/products/infrastructure/product-seed";
import { orders } from "@core/src/features/orders/composition";
import type { CompanyId, UserId } from "@core/src/features/orders/domain/order";

type SeedItem = Readonly<{ variant: string; quantity: number; unitPrice: number }>;
type SeedOrder = Readonly<{ createdAt: string; items: readonly SeedItem[]; currency?: "PEN" | "USD"; charge?: number; cancelled?: boolean; unconfirmedCatalog?: boolean }>;
type Store = Readonly<{ access: Readonly<{ companyId: CompanyId; userId: UserId }>; variants: readonly string[]; sell: (order: SeedOrder) => Promise<void> }>;

// October 2026 in Lima: [2026-10-01T05:00Z, 2026-11-01T05:00Z).
const october = { from: new Date("2026-10-01T05:00:00Z"), before: new Date("2026-11-01T05:00:00Z") };
const sale = (day: string, items: readonly SeedItem[], extra: Partial<SeedOrder> = {}): SeedOrder => ({ createdAt: `${day}Z`, items, ...extra });

async function store<T>(work: (store: Store) => Promise<T>, variantCount = 3): Promise<T> {
  const companyId = randomUUID() as CompanyId;
  await withTenantIsolation(companyId, async () => { await prisma.company.create({ data: { id: companyId, name: companyId, country: "PE" } }); });
  const userId = randomUUID() as UserId;
  let number = 1000;
  return withTenantIsolation(companyId, async () => {
    await systemPrisma.user.create({ data: { id: userId, name: "Seller", email: `${userId}@example.test`, companyId } });
    const seeded = await seedProduct({ variants: Array.from({ length: variantCount }, (_, index) => ({ attributes: { Talla: `T${index}` }, stock: 10 })) });
    const sell = async (order: SeedOrder) => {
      const createdAt = new Date(order.createdAt);
      const itemsTotal = order.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
      const currency = order.currency ?? "PEN";
      const id = randomUUID();
      await prisma.order.create({ data: { id, number: BigInt(++number), currency, total: new Prisma.Decimal(itemsTotal + (order.charge ?? 0)), itemsTotal: new Prisma.Decimal(itemsTotal),
        deliveryCharge: new Prisma.Decimal(order.charge ?? 0), deliveryCost: new Prisma.Decimal(order.charge ?? 0), createdAt, cancelled: order.cancelled ?? false, cancelledAt: order.cancelled ? createdAt : null,
        fromCatalog: order.unconfirmedCatalog ?? false, checkoutEnabledAt: order.unconfirmedCatalog ? createdAt : null, sellerId: order.unconfirmedCatalog ? null : userId } });
      for (const item of order.items) await prisma.orderItem.create({ data: { orderId: id, orderCreatedAt: createdAt, variantId: item.variant, productName: "Polo", variantAttributes: {},
        quantity: BigInt(item.quantity), unitPrice: new Prisma.Decimal(item.unitPrice), subtotal: new Prisma.Decimal(item.quantity * item.unitPrice) } });
    };
    return work({ access: { companyId, userId }, variants: [...seeded.variantIds], sell });
  });
}

const read = (access: Store["access"], variantIds?: readonly string[]) => orders.summarizeSoldVariants({ window: october, ...variantIds ? { variantIds } : {} }, access);
const unwrap = <T>(result: { success: true; data: T } | { success: false; error: { message: string } }): T => { if (!result.success) throw new Error(result.error.message); return result.data; };
const byVariant = (summary: Awaited<ReturnType<typeof read>>) => Object.fromEntries(unwrap(summary).variants.map((row) => [`${row.variantId}:${row.currency}`, [row.units, row.amount.amount]]));

test("sums units and item subtotals per variant sold, excluding delivery, cancelled and unconfirmed catalog orders", async () => {
  await store(async ({ access, variants, sell }) => {
    const [polo, casaca] = variants as [string, string];
    await sell(sale("2026-10-03T15:00:00", [{ variant: polo, quantity: 3, unitPrice: 35 }], { charge: 15 }));
    await sell(sale("2026-10-20T15:00:00", [{ variant: polo, quantity: 2, unitPrice: 35 }, { variant: casaca, quantity: 1, unitPrice: 120 }], { charge: 10 }));
    await sell(sale("2026-10-12T15:00:00", [{ variant: casaca, quantity: 4, unitPrice: 100 }], { cancelled: true }));
    await sell(sale("2026-10-15T15:00:00", [{ variant: polo, quantity: 5, unitPrice: 35 }], { unconfirmedCatalog: true }));
    await sell(sale("2026-09-30T15:00:00", [{ variant: casaca, quantity: 9, unitPrice: 120 }]));
    const summary = unwrap(await read(access));
    expect(byVariant(await read(access))).toEqual({ [`${polo}:PEN`]: [5, 175], [`${casaca}:PEN`]: [1, 120] });
    expect(summary.currencies).toEqual([{ currency: "PEN", orders: 2, units: 6, amount: { amount: 295, currency: "PEN" } }]);
  });
});

test("an order at 23:30 Lima on 31/10 falls in October's window and one at 00:05 on 01/11 outside it", async () => {
  await store(async ({ access, variants, sell }) => {
    const [polo] = variants as [string];
    await sell(sale("2026-11-01T04:30:00", [{ variant: polo, quantity: 1, unitPrice: 10 }]));
    await sell(sale("2026-11-01T05:05:00", [{ variant: polo, quantity: 7, unitPrice: 10 }]));
    expect(byVariant(await read(access))).toEqual({ [`${polo}:PEN`]: [1, 10] });
  });
});

test("keeps each currency apart: a variant sold in two currencies has a row in each and the totals never mix them", async () => {
  await store(async ({ access, variants, sell }) => {
    const [polo] = variants as [string];
    await sell(sale("2026-10-03T15:00:00", [{ variant: polo, quantity: 2, unitPrice: 35 }]));
    await sell(sale("2026-10-04T15:00:00", [{ variant: polo, quantity: 3, unitPrice: 30 }], { currency: "USD" }));
    const summary = unwrap(await read(access));
    expect(byVariant(await read(access))).toEqual({ [`${polo}:PEN`]: [2, 70], [`${polo}:USD`]: [3, 90] });
    expect(summary.currencies).toEqual([
      { currency: "PEN", orders: 1, units: 2, amount: { amount: 70, currency: "PEN" } },
      { currency: "USD", orders: 1, units: 3, amount: { amount: 90, currency: "USD" } },
    ]);
  });
});

test("narrows variants to the given ids and keeps the per-currency totals and order counts of the whole period", async () => {
  await store(async ({ access, variants, sell }) => {
    const [polo, casaca] = variants as [string, string];
    await sell(sale("2026-10-03T15:00:00", [{ variant: polo, quantity: 3, unitPrice: 35 }, { variant: casaca, quantity: 1, unitPrice: 120 }]));
    await sell(sale("2026-10-05T15:00:00", [{ variant: casaca, quantity: 1, unitPrice: 120 }]));
    const narrowed = await read(access, [polo]);
    expect(byVariant(narrowed)).toEqual({ [`${polo}:PEN`]: [3, 105] });
    expect(unwrap(narrowed).currencies).toEqual([{ currency: "PEN", orders: 2, units: 5, amount: { amount: 345, currency: "PEN" } }]);
    expect(unwrap(await read(access, [])).variants).toEqual([]);
  });
});

test("another store's items and orders change no unit, amount or currency total", async () => {
  await store(async (other) => {
    await other.sell(sale("2026-10-03T15:00:00", [{ variant: other.variants[0]!, quantity: 50, unitPrice: 99 }], { currency: "USD" }));
  });
  await store(async (mine) => {
    const [polo] = mine.variants as [string];
    await mine.sell(sale("2026-10-03T15:00:00", [{ variant: polo, quantity: 2, unitPrice: 35 }]));
    const summary = unwrap(await read(mine.access));
    expect(byVariant(await read(mine.access))).toEqual({ [`${polo}:PEN`]: [2, 70] });
    expect(summary.currencies).toEqual([{ currency: "PEN", orders: 1, units: 2, amount: { amount: 70, currency: "PEN" } }]);
  });
});

const dates = (access: Store["access"], variantIds: readonly string[], needFirstAfter = true) => orders.findVariantSaleDates({ window: october, variantIds, needFirstAfter }, access);

test("reports for each variant whether it sold in the window, its exact last sale before it and, when asked, its first sale after it, however old, in any currency", async () => {
  await store(async ({ access, variants, sell }) => {
    const [sold, quiet, usd] = variants as [string, string, string];
    await sell(sale("2026-10-03T15:00:00", [{ variant: sold, quantity: 1, unitPrice: 10 }]));
    await sell(sale("2024-02-10T15:00:00", [{ variant: sold, quantity: 1, unitPrice: 10 }]));
    await sell(sale("2023-01-05T15:00:00", [{ variant: quiet, quantity: 1, unitPrice: 10 }]));
    await sell(sale("2025-08-14T15:00:00", [{ variant: quiet, quantity: 1, unitPrice: 10 }]));
    await sell(sale("2026-11-10T15:00:00", [{ variant: quiet, quantity: 1, unitPrice: 10 }]));
    await sell(sale("2026-12-01T15:00:00", [{ variant: quiet, quantity: 1, unitPrice: 10 }]));
    await sell(sale("2026-08-01T15:00:00", [{ variant: usd, quantity: 1, unitPrice: 10 }], { currency: "USD" }));
    const found = unwrap(await dates(access, [sold, quiet, usd]));
    const of = (id: string) => found.find((row) => row.variantId === id)!;
    expect(of(sold)).toEqual({ variantId: sold, soldInWindow: true, lastBefore: null, firstAfter: null });
    expect(of(quiet)).toEqual({ variantId: quiet, soldInWindow: false, lastBefore: new Date("2025-08-14T15:00:00Z"), firstAfter: new Date("2026-11-10T15:00:00Z") });
    expect(of(usd)).toEqual({ variantId: usd, soldInWindow: false, lastBefore: new Date("2026-08-01T15:00:00Z"), firstAfter: null });
    expect(unwrap(await dates(access, [quiet], false))[0]).toMatchObject({ lastBefore: new Date("2025-08-14T15:00:00Z"), firstAfter: null });
  });
});

test("skips cancelled and unconfirmed catalog orders when looking for the last and first sale of a variant", async () => {
  await store(async ({ access, variants, sell }) => {
    const [gorro] = variants as [string];
    await sell(sale("2026-08-01T15:00:00", [{ variant: gorro, quantity: 1, unitPrice: 10 }]));
    await sell(sale("2026-09-20T15:00:00", [{ variant: gorro, quantity: 1, unitPrice: 10 }], { cancelled: true }));
    await sell(sale("2026-09-25T15:00:00", [{ variant: gorro, quantity: 1, unitPrice: 10 }], { unconfirmedCatalog: true }));
    await sell(sale("2026-10-12T15:00:00", [{ variant: gorro, quantity: 4, unitPrice: 25 }], { cancelled: true }));
    await sell(sale("2026-11-05T15:00:00", [{ variant: gorro, quantity: 1, unitPrice: 10 }], { cancelled: true }));
    await sell(sale("2026-11-20T15:00:00", [{ variant: gorro, quantity: 1, unitPrice: 10 }]));
    expect(unwrap(await dates(access, [gorro]))).toEqual([{ variantId: gorro, soldInWindow: false, lastBefore: new Date("2026-08-01T15:00:00Z"), firstAfter: new Date("2026-11-20T15:00:00Z") }]);
  });
});

test("a variant never sold answers all-null", async () => {
  await store(async ({ access, variants }) => {
    const [never] = variants as [string];
    expect(unwrap(await dates(access, [never]))).toEqual([{ variantId: never, soldInWindow: false, lastBefore: null, firstAfter: null }]);
  });
});

test("another store's items of the same variant id never give a sale date", async () => {
  let theirs = "";
  await store(async (other) => {
    theirs = other.variants[0]!;
    await other.sell(sale("2026-08-01T15:00:00", [{ variant: theirs, quantity: 1, unitPrice: 10 }]));
  });
  await store(async (mine) => {
    // Asking with the other store's variant id from this store finds no sale: the row is all-null, never the other store's date.
    expect(unwrap(await dates(mine.access, [theirs]))).toEqual([{ variantId: theirs, soldInWindow: false, lastBefore: null, firstAfter: null }]);
  });
});
