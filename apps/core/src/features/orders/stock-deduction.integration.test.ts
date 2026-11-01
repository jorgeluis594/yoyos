import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { expect, test, vi } from "vitest";
import { err } from "@shared/functional";
import { persistenceFailureResult } from "@core/src/shared/infrastructure/persistence-error";
import { log } from "@core/src/shared/infrastructure/logger";
import pg from "pg";
import { lockVariantStock } from "@core/src/features/products/infrastructure/order-stock";
import { ok } from "@shared/functional";
import { orders, createConfiguredOrder, createStockPublisher, deductDueStockDependencies, publishStockEvent, recoveryDependencies, stockRegistry } from "@core/src/features/orders/composition";
import { recoverDueStockDeductions } from "@core/src/features/orders/application/recover-due-stock-deductions";
import { parseBuyer } from "@core/src/features/orders/domain/checkout";
import { serveWaitingOrders } from "@core/src/features/orders/application/deduct-due-stock";
import { listOverdueOrderIds, listWaitingOrderIds } from "@core/src/features/orders/infrastructure/order-repository";
import { restoreCancelledStock } from "@core/src/composition/event-handlers";
import { prisma, systemPrisma, withinTransaction, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { seedProduct } from "@core/src/features/products/infrastructure/product-seed";
import { parseRatedDeliverySelection } from "@core/src/features/orders/domain/order-state-machine";
import { deliverySettings } from "@core/src/features/delivery-settings/composition";
import type { CompanyId, OrderId, PaymentId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";

/** Appends a measurement for the pull request report when STOCK_MEASURE_FILE is set. */
function measure(entry: Record<string, unknown>) {
  if (process.env.STOCK_MEASURE_FILE) appendFileSync(process.env.STOCK_MEASURE_FILE, JSON.stringify(entry) + "\n");
}

type Shop = Awaited<ReturnType<typeof shop>>;
async function shop(stocks: (number | bigint)[]) {
  const companyId = randomUUID() as CompanyId;
  const sellerId = randomUUID() as UserId;
  const variants = await withTenantIsolation(companyId, async () => {
    await prisma.company.create({ data: { id: companyId, name: "Stock deduction", country: "PE" } });
    await systemPrisma.user.create({ data: { id: sellerId, name: "Seller", email: `${sellerId}@example.test`, companyId } });
    const seeded = await seedProduct({ variants: stocks.map((stock, index) => ({ attributes: { Talla: `T${index}` }, salePrice: 10, stock })) });
    return seeded.variantIds as VariantId[];
  });
  const context = { companyId, userId: sellerId };
  const run = <T>(work: () => Promise<T>) => withTenantIsolation(companyId, work);
  const stock = (index = 0) => run(async () => Number((await prisma.productStock.findUniqueOrThrow({ where: { variantId: variants[index]! } })).quantity));
  const create = (lines: [number, number][], createdAt?: Date) => run(async () => {
    const id = randomUUID() as OrderId;
    const [first, ...rest] = lines.map(([variant, quantity]) => ({ variantId: variants[variant]!, quantity: quantity as PositiveInteger }));
    const created = await orders.create({ id, items: [first!, ...rest] }, context);
    if (!created.success) throw new Error(created.error.message);
    if (createdAt) await prisma.order.update({ where: { id }, data: { createdAt } });
    return id;
  });
  const pay = (orderId: OrderId, amount: number, deductStockIfPartial = false) => run(() => orders.registerPayment({ orderId, paymentId: randomUUID() as PaymentId,
    amount: { amount, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial }, context));
  const deducted = (orderId: OrderId) => run(async () => (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).stockDeducted);
  const restock = (index: number, quantity: number) => run(() => withinTransaction(async () => {
    // A restoration of a cancelled order is the only caller today; the event is published the same way a stock edit will.
    await prisma.productStock.update({ where: { variantId: variants[index]! }, data: { quantity: { increment: BigInt(quantity) } } });
    const published = await publishStockEvent("product_stock_increased", { companyId, variantIds: [variants[index]!] });
    return published.success ? { success: true as const, data: published.data } : published;
  }));
  const cancelAndRestore = async (orderId: OrderId) => {
    expect(await run(() => orders.cancel(orderId, context))).toMatchObject({ success: true });
    expect(await restoreCancelledStock.handler({ orderId, companyId } as never, {} as never, {} as never)).toMatchObject({ success: true });
  };
  return { companyId, context, variants, run, stock, create, pay, deducted, restock, cancelAndRestore };
}
const waiting = (s: Shop, variant: number, available: number) => ({ kind: "waiting", shortItems: [{ variantId: s.variants[variant], available }] });

test("a covering payment with short stock is recorded and leaves the order waiting", async () => {
  const s = await shop([3]);
  const id = await s.create([[0, 4]]);
  expect(await s.pay(id, 40)).toMatchObject({ success: true, data: { order: { stockDeducted: false }, stockDue: waiting(s, 0, 3) } });
  expect(await s.stock()).toBe(3);
});

test("a covering payment with enough stock answers already deducted", async () => {
  const s = await shop([4]);
  const id = await s.create([[0, 4]]);
  expect(await s.pay(id, 40)).toMatchObject({ success: true, data: { order: { stockDeducted: true }, stockDue: null } });
  expect(await s.stock()).toBe(0);
});

test("a partial payment with deduction request and short stock is recorded as waiting, and without request is not due", async () => {
  const s = await shop([3]);
  const requested = await s.create([[0, 4]]);
  expect(await s.pay(requested, 10, true)).toMatchObject({ success: true, data: { order: { stockDeducted: false }, stockDue: waiting(s, 0, 3) } });
  const plain = await s.create([[0, 4]]);
  expect(await s.pay(plain, 10)).toMatchObject({ success: true, data: { order: { stockDeducted: false }, stockDue: null } });
});

test("cancelling an order that deducted stock deducts the waiting order it now covers", async () => {
  const s = await shop([4]);
  const first = await s.create([[0, 2]], new Date("2026-10-01"));
  const second = await s.create([[0, 4]], new Date("2026-10-02"));
  const third = await s.create([[0, 2]], new Date("2026-10-03"));
  await s.pay(first, 20);
  await s.pay(third, 20);
  expect(await s.pay(second, 40)).toMatchObject({ success: true, data: { stockDue: waiting(s, 0, 0) } });
  await s.cancelAndRestore(first);
  // 2 units restored: the 4-unit order still does not fit.
  expect(await s.deducted(second)).toBe(false);
  await s.cancelAndRestore(third);
  expect(await s.deducted(second)).toBe(true);
  expect(await s.stock()).toBe(0);
});

test("a restock serves the oldest waiting order that fits and leaves the larger one waiting", async () => {
  const s = await shop([0]);
  const old = await s.create([[0, 5]], new Date("2026-10-01"));
  const small = await s.create([[0, 2]], new Date("2026-10-02"));
  await s.pay(old, 50);
  await s.pay(small, 20);
  await s.restock(0, 3);
  expect(await s.deducted(old)).toBe(false);
  expect(await s.deducted(small)).toBe(true);
  expect(await s.stock()).toBe(1);
  expect(await s.run(() => orders.getAggregate(old, s.context)).then((found) => found.success ? found.data.stockDeducted : null)).toBe(false);
  const described = await s.run(async () => { const found = await orders.getAggregate(old, s.context); return found.success ? await orders.describeStockDue([found.data]) : null; });
  expect(described).toMatchObject({ success: true });
  expect(described && described.success ? described.data.get(old) : null).toEqual(waiting(s, 0, 1));
});

test("a restock of one variant leaves an order short of another variant waiting", async () => {
  const s = await shop([0, 0]);
  const id = await s.create([[0, 1], [1, 1]]);
  await s.pay(id, 20);
  await s.restock(0, 5);
  expect(await s.deducted(id)).toBe(false);
  const described = await s.run(async () => { const found = await orders.getAggregate(id, s.context); return found.success ? await orders.describeStockDue([found.data]) : null; });
  expect(described && described.success ? described.data.get(id) : null).toEqual(waiting(s, 1, 0));
  await s.restock(1, 1);
  expect(await s.deducted(id)).toBe(true);
  expect([await s.stock(0), await s.stock(1)]).toEqual([4, 0]);
});

test("a cancelled waiting order is not deducted on restock", async () => {
  const s = await shop([0]);
  const id = await s.create([[0, 2]]);
  await s.pay(id, 20);
  expect(await s.run(() => orders.cancel(id, s.context))).toMatchObject({ success: true });
  await s.restock(0, 5);
  expect(await s.deducted(id)).toBe(false);
  expect(await s.stock()).toBe(5);
});

test("voiding the covering payment takes the order out of waiting", async () => {
  const s = await shop([0]);
  const id = await s.create([[0, 2]]);
  const paid = await s.pay(id, 20);
  if (!paid.success) throw new Error("setup");
  const voided = await s.run(() => orders.voidPayment({ orderId: id, paymentId: paid.data.order.payments[0]!.id }, s.context));
  expect(voided).toMatchObject({ success: true });
  await s.restock(0, 5);
  expect(await s.deducted(id)).toBe(false);
  expect(await s.run(async () => { const found = await orders.getAggregate(id, s.context); return found.success ? (await orders.describeStockDue([found.data])) : null; }))
    .toMatchObject({ success: true, data: new Map([[id, null]]) });
});

test("a delivery change that keeps the payments covering the total leaves the order waiting", async () => {
  const s = await shop([0]);
  const settings = await s.run(() => deliverySettings.save({ expectedVersion: 0, agency: { enabled: false }, home: { enabled: false },
    store: { enabled: true, pickupPoint: { name: "Store", address: "Address", instructions: null } } }, s.context));
  expect(settings).toMatchObject({ success: true });
  const id = await s.create([[0, 2]]);
  expect(await s.pay(id, 20)).toMatchObject({ success: true, data: { stockDue: waiting(s, 0, 0) } });
  const store = parseRatedDeliverySelection({ method: "store", recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } } });
  if (!store.success) throw new Error("setup");
  expect(await s.run(() => orders.setDelivery({ orderId: id, delivery: store.data, expectedPrice: { amount: 0, currency: "PEN" } }, s.context)))
    .toMatchObject({ success: true, data: { order: { stockDeducted: false }, stockDue: waiting(s, 0, 0) } });
});

test("a delivery change that raises the total above the payments takes the order out of waiting", async () => {
  const s = await shop([0]);
  const zone = await s.run(() => deliverySettings.saveZones({ expectedVersion: 0, zones: [{ kind: "new" as const, name: "Home zone", enabled: true, districtCodes: ["150122"],
    options: [{ kind: "new" as const, method: "home" as const, name: "Home", enabled: true, price: { amount: 10, currency: "PEN" as const } }] }] }, s.context));
  expect(zone).toMatchObject({ success: true });
  expect(await s.run(() => deliverySettings.save({ expectedVersion: 1, home: { enabled: true }, agency: { enabled: false }, store: { enabled: false, pickupPoint: null } }, s.context)))
    .toMatchObject({ success: true });
  const quotation = await s.run(() => deliverySettings.createQuotation({ companyId: s.companyId, country: "PE", districtCode: "150122", address: null, instructions: null }));
  if (!quotation.success) throw new Error("setup");
  const id = await s.create([[0, 2]]);
  expect(await s.pay(id, 20)).toMatchObject({ success: true, data: { stockDue: waiting(s, 0, 0) } });
  const home = parseRatedDeliverySelection({ method: "home", rateId: quotation.data.rates[0]!.rate.id, recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } },
    destination: { address: "Street 1", districtCode: "150122", instructions: null } });
  if (!home.success) throw new Error("setup");
  const changed = await s.run(() => orders.setDelivery({ orderId: id, delivery: home.data, expectedPrice: { amount: 10, currency: "PEN" } }, s.context));
  expect(changed).toMatchObject({ success: true, data: { order: { stockDeducted: false, total: { amount: 30, currency: "PEN" } }, stockDue: null } });
  expect(await s.stock()).toBe(0);
});

test("creating an order with payments and short stock saves it waiting, and with enough stock saves it deducted", async () => {
  const s = await shop([3]);
  const short = await s.run(() => createConfiguredOrder({ id: randomUUID() as OrderId, items: [{ variantId: s.variants[0]!, quantity: 4 as PositiveInteger }],
    payments: [{ paymentId: randomUUID() as PaymentId, amount: { amount: 40, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false }] }, s.context));
  expect(short).toMatchObject({ success: true, data: { order: { stockDeducted: false }, stockDue: waiting(s, 0, 3) } });
  const fits = await s.run(() => createConfiguredOrder({ id: randomUUID() as OrderId, items: [{ variantId: s.variants[0]!, quantity: 3 as PositiveInteger }],
    payments: [{ paymentId: randomUUID() as PaymentId, amount: { amount: 30, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false }] }, s.context));
  expect(fits).toMatchObject({ success: true, data: { order: { stockDeducted: true }, stockDue: null } });
  expect(await s.stock()).toBe(0);
});

test("creating a paid and delivered sale with short stock answers INSUFFICIENT_STOCK and persists nothing", async () => {
  const s = await shop([3]);
  const id = randomUUID() as OrderId;
  const result = await s.run(() => createConfiguredOrder({ id, items: [{ variantId: s.variants[0]!, quantity: 4 as PositiveInteger }], deliverImmediately: true,
    payments: [{ paymentId: randomUUID() as PaymentId, amount: { amount: 40, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false }] }, s.context));
  expect(result).toMatchObject({ success: false, error: { code: "INSUFFICIENT_STOCK", variantId: s.variants[0] } });
  expect(await s.run(async () => await prisma.order.count({ where: { id } }))).toBe(0);
  expect(await s.run(async () => await prisma.payment.count())).toBe(0);
  expect(await s.stock()).toBe(3);
  const immediate = await s.run(() => orders.registerImmediateSale({ id: randomUUID() as OrderId, items: [{ variantId: s.variants[0]!, quantity: 4 as PositiveInteger }] }, s.context));
  expect(immediate).toMatchObject({ success: false, error: { code: "INSUFFICIENT_STOCK", variantId: s.variants[0] } });
});

test("two restocks in quick succession deduct a waiting order once", async () => {
  const s = await shop([0]);
  const id = await s.create([[0, 2]]);
  await s.pay(id, 20);
  await Promise.all([s.restock(0, 2), s.restock(0, 2)]);
  expect(await s.deducted(id)).toBe(true);
  expect(await s.stock()).toBe(2);
});

test("a waiting order takes restored units before a new sale", async () => {
  const s = await shop([2]);
  const holder = await s.create([[0, 2]], new Date("2026-10-01"));
  const waitingOrder = await s.create([[0, 2]], new Date("2026-10-02"));
  const newSale = await s.create([[0, 2]], new Date("2026-10-03"));
  await s.pay(holder, 20);
  await s.pay(waitingOrder, 20);
  await s.cancelAndRestore(holder);
  expect(await s.deducted(waitingOrder)).toBe(true);
  expect(await s.pay(newSale, 20)).toMatchObject({ success: true, data: { order: { stockDeducted: false }, stockDue: waiting(s, 0, 0) } });
});

test("a new sale paid while the restoration runs never takes the units of an older waiting order", async () => {
  const s = await shop([2]);
  const holder = await s.create([[0, 2]], new Date("2026-10-01"));
  const waitingOrder = await s.create([[0, 2]], new Date("2026-10-02"));
  const newSale = await s.create([[0, 2]], new Date("2026-10-03"));
  await s.pay(holder, 20);
  await s.pay(waitingOrder, 20);
  const [, paid] = await Promise.all([s.cancelAndRestore(holder), s.pay(newSale, 20)]);
  expect(paid).toMatchObject({ success: true });
  expect(await s.deducted(waitingOrder)).toBe(true);
  expect(await s.deducted(newSale)).toBe(false);
  expect(await s.stock()).toBe(0);
});

test("shipping a partially paid order with short stock still answers INSUFFICIENT_STOCK", async () => {
  const s = await shop([3]);
  const id = await s.create([[0, 4]]);
  await s.pay(id, 10, true);
  expect(await s.run(() => orders.ship(id, s.context))).toMatchObject({ success: false, error: { code: "INSUFFICIENT_STOCK", variantId: s.variants[0] } });
  expect(await s.stock()).toBe(3);
  await s.run(async () => await prisma.productStock.update({ where: { variantId: s.variants[0]! }, data: { quantity: 4n } }));
  expect(await s.run(() => orders.ship(id, s.context))).toMatchObject({ success: true, data: { deliveryStatus: "shipped", stockDeducted: true } });
  expect(await s.stock()).toBe(0);
});

test("delivering a partially paid order deducts the pending stock and keeps the balance open", async () => {
  const s = await shop([4]);
  const id = await s.create([[0, 4]]);
  expect(await s.run(() => orders.deliver(id, s.context))).toMatchObject({ success: false, error: { code: "PAYMENT_REQUIRED" } });
  await s.pay(id, 10);
  expect(await s.deducted(id)).toBe(false);
  expect(await s.run(() => orders.deliver(id, s.context))).toMatchObject({ success: true,
    data: { deliveryStatus: "delivered", stockDeducted: true, deliveredAt: expect.any(Date), completedAt: null } });
  expect(await s.stock()).toBe(0);
  const covered = await s.pay(id, 30);
  expect(covered).toMatchObject({ success: true, data: { order: { deliveredAt: expect.any(Date), completedAt: expect.any(Date) } } });
});

test("delivering a shipped, partially paid order succeeds without completing it", async () => {
  const s = await shop([4]);
  const id = await s.create([[0, 4]]);
  await s.pay(id, 10);
  expect(await s.run(() => orders.ship(id, s.context))).toMatchObject({ success: true, data: { deliveryStatus: "shipped" } });
  expect(await s.run(() => orders.deliver(id, s.context))).toMatchObject({ success: true, data: { deliveryStatus: "delivered", completedAt: null } });
  expect(await s.stock()).toBe(0);
});

test("delivering a partially paid order with short stock answers INSUFFICIENT_STOCK and persists nothing", async () => {
  const s = await shop([3]);
  const id = await s.create([[0, 4]]);
  await s.pay(id, 10);
  expect(await s.run(() => orders.deliver(id, s.context))).toMatchObject({ success: false, error: { code: "INSUFFICIENT_STOCK", variantId: s.variants[0] } });
  expect(await s.stock()).toBe(3);
  expect(await s.run(async () => await prisma.order.findUniqueOrThrow({ where: { id } }))).toMatchObject({ deliveryStatus: "pending", deliveredAt: null, stockDeducted: false });
});

test("a stock row with an invalid quantity under a covering payment commits the payment and shows the order as being deducted", async () => {
  const s = await shop([9007199254740993n]);
  const id = await s.create([[0, 2]]);
  expect(await s.pay(id, 20)).toMatchObject({ success: true, data: { order: { stockDeducted: false }, stockDue: { kind: "deducting" } } });
  expect(await s.run(async () => await prisma.payment.count({ where: { orderId: id } }))).toBe(1);
});

test("a statement timeout while deducting is contained, the payment commits and the order shows as being deducted", async () => {
  const s = await shop([5]);
  const id = await s.create([[0, 2]]);
  const adminUrl = new URL(process.env.DATABASE_URL!);
  adminUrl.username = "core";
  adminUrl.password = "core";
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  const name = `slow_stock_${randomUUID().replaceAll("-", "")}`;
  try {
    await admin.query(`CREATE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD."companyId" = '${s.companyId}'::uuid THEN PERFORM pg_sleep(1.5); END IF; RETURN NEW; END $$`);
    await admin.query(`CREATE TRIGGER ${name} BEFORE UPDATE ON "ProductStock" FOR EACH ROW EXECUTE FUNCTION public.${name}()`);
    // The listener's savepoint limit is 1000 ms, so the 1.5 s write is cut as a contained statement timeout.
    expect(await s.pay(id, 20)).toMatchObject({ success: true, data: { order: { stockDeducted: false }, stockDue: { kind: "deducting" } } });
    expect(await s.run(async () => await prisma.payment.count({ where: { orderId: id } }))).toBe(1);
    expect(await s.stock()).toBe(5);
  } finally {
    await admin.query(`DROP TRIGGER IF EXISTS ${name} ON "ProductStock"`);
    await admin.query(`DROP FUNCTION IF EXISTS public.${name}()`);
    await admin.end();
  }
});

// --- Restoration, contention and bounds ---

test("a restock in one company never serves an order of another company", async () => {
  const a = await shop([0]);
  const b = await shop([0]);
  const inB = await b.create([[0, 1]]);
  await b.pay(inB, 10);
  await a.restock(0, 5);
  expect(await b.deducted(inB)).toBe(false);
  expect(await b.stock()).toBe(0);
});

test("a waiting order with invalid stored data does not stop the restoration", async () => {
  const s = await shop([0]);
  const broken = await s.create([[0, 1]], new Date("2026-10-01"));
  const fine = await s.create([[0, 1]], new Date("2026-10-02"));
  await s.pay(broken, 10);
  await s.pay(fine, 10);
  // A confirmed payment in another currency makes the stored order unreadable for the deduction.
  await s.run(async () => await prisma.payment.updateMany({ where: { orderId: broken }, data: { currency: "USD" } }));
  const outcome = await s.restock(0, 5);
  expect(outcome).toMatchObject({ success: true, data: { deducted: 1, skippedInvalid: 1 } });
  expect(await s.deducted(fine)).toBe(true);
  expect(await s.deducted(broken)).toBe(false);
  expect(await s.stock()).toBe(4);
});

test("a waiting-orders query that exceeds the serving budget still commits the restoration and leaves the orders to recovery", async () => {
  const s = await shop([0]);
  const id = await s.create([[0, 1]]);
  await s.pay(id, 10);
  const slow = createStockPublisher({ ...stockRegistry, product_stock_increased: serveWaitingOrders({ ...deductDueStockDependencies,
    listWaitingOrderIds: async (...args) => { await prisma.$queryRaw`SELECT pg_sleep(1.5)`; return listWaitingOrderIds(...args); } }) });
  const started = Date.now();
  const outcome = await s.run(() => withinTransaction(async () => {
    await prisma.productStock.update({ where: { variantId: s.variants[0]! }, data: { quantity: { increment: 3n } } });
    return slow("product_stock_increased", { companyId: s.companyId, variantIds: [s.variants[0]!] });
  }, { timeout: 5000, lockTimeoutMs: 2000, statementTimeoutMs: 2000 }));
  expect(outcome).toMatchObject({ success: true, data: { budgetExhausted: true, deducted: 0, candidates: 0 } });
  expect(Date.now() - started).toBeLessThan(1500);
  expect(await s.stock()).toBe(3);
  expect(await s.deducted(id)).toBe(false);
  // The recovery job finds it.
  const overdue = await s.run(() => withinTransaction(async () => ok(await listOverdueOrderIds(s.companyId, 10, []))));
  expect(overdue).toMatchObject({ success: true, data: { success: true, data: [id] } });
});

test("a failed increment rolls back the restoration and is retried", async () => {
  const s = await shop([2]);
  const first = await s.create([[0, 2]]);
  await s.pay(first, 20);
  expect(await s.run(() => orders.cancel(first, s.context))).toMatchObject({ success: true });
  const adminUrl = new URL(process.env.DATABASE_URL!);
  adminUrl.username = "core";
  adminUrl.password = "core";
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  const name = `reject_restore_${randomUUID().replaceAll("-", "")}`;
  try {
    await admin.query(`CREATE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD."companyId" = '${s.companyId}'::uuid THEN RAISE EXCEPTION 'restore rejected by test'; END IF; RETURN NEW; END $$`);
    await admin.query(`CREATE TRIGGER ${name} BEFORE UPDATE ON "ProductStock" FOR EACH ROW EXECUTE FUNCTION public.${name}()`);
    expect(await restoreCancelledStock.handler({ orderId: first, companyId: s.companyId } as never, {} as never, {} as never))
      .toMatchObject({ success: false, error: { retryable: true } });
    expect(await s.deducted(first)).toBe(true);
  } finally {
    await admin.query(`DROP TRIGGER IF EXISTS ${name} ON "ProductStock"`);
    await admin.query(`DROP FUNCTION IF EXISTS public.${name}()`);
    await admin.end();
  }
  expect(await restoreCancelledStock.handler({ orderId: first, companyId: s.companyId } as never, {} as never, {} as never)).toMatchObject({ success: true });
  expect(await s.stock()).toBe(2);
});

/** Holds the stock row of a variant locked from another transaction for `ms`. */
async function holdStockRow(s: Shop, ms: number) {
  let locked!: () => void;
  const ready = new Promise<void>((resolve) => { locked = resolve; });
  const holder = s.run(() => withinTransaction(async () => {
    await lockVariantStock([s.variants[0]!], "wait");
    locked();
    await new Promise((resolve) => setTimeout(resolve, ms));
    return ok(null);
  }));
  await ready;
  return { released: holder };
}

test("a payment whose stock-row wait times out is still recorded", async () => {
  const s = await shop([5]);
  const id = await s.create([[0, 2]]);
  const hold = await holdStockRow(s, 1800);
  const started = Date.now();
  const paid = await s.pay(id, 20);
  const elapsed = Date.now() - started;
  await hold.released;
  expect(paid).toMatchObject({ success: true, data: { order: { stockDeducted: false }, stockDue: { kind: "deducting" } } });
  // The listener waits at most its 1000 ms limit; the payment commits well inside the 5000 ms transaction timeout.
  expect(elapsed).toBeLessThan(2500);
  measure({ measure: "payment_with_stock_row_held_past_the_lock_timeout", elapsedMs: elapsed });
  expect(await s.run(async () => await prisma.payment.count({ where: { orderId: id } }))).toBe(1);
});

test("a payment waiting on a restock's stock rows completes within the transaction timeout", async () => {
  const s = await shop([5]);
  const id = await s.create([[0, 2]]);
  const hold = await holdStockRow(s, 500);
  const started = Date.now();
  const paid = await s.pay(id, 20);
  const elapsed = Date.now() - started;
  await hold.released;
  expect(paid).toMatchObject({ success: true, data: { order: { stockDeducted: true }, stockDue: null } });
  expect(elapsed).toBeLessThan(2000);
  measure({ measure: "payment_waiting_on_stock_rows_released_after_500ms", elapsedMs: elapsed });
});

test("a restoration that serves 100 candidates finishes within about a second", async () => {
  const s = await shop([0]);
  await s.run(async () => {
    await prisma.$executeRaw`INSERT INTO "Order" (id, number, "sellerId", currency, total, "itemsTotal", "createdAt")
      SELECT gen_random_uuid(), 100000 + n, (SELECT id FROM "user" WHERE "companyId" = current_setting('app.company_id')::uuid LIMIT 1), 'PEN', 10, 10, now() + n * interval '1 second'
      FROM generate_series(1, 100) n`;
    await prisma.$executeRaw`INSERT INTO "OrderItem" (id, "orderId", "orderCreatedAt", "variantId", "productName", "variantAttributes", quantity, "unitPrice", subtotal)
      SELECT gen_random_uuid(), o.id, o."createdAt", ${s.variants[0]!}::uuid, 'Camisa', '{}'::json, 1, 10, 10 FROM "Order" o`;
    await prisma.$executeRaw`INSERT INTO "Payment" (id, "orderId", status, amount, currency, method, data)
      SELECT gen_random_uuid(), o.id, 'confirmed', 10, 'PEN', 'bank_transfer', '{}'::jsonb FROM "Order" o`;
  });
  const started = Date.now();
  const outcome = await s.restock(0, 100);
  const elapsed = Date.now() - started;
  expect(outcome).toMatchObject({ success: true, data: { candidates: 100, deducted: 100, budgetExhausted: false } });
  expect(elapsed).toBeLessThan(1500);
  measure({ measure: "restoration_serving_100_candidates", elapsedMs: elapsed });
});

test("with 10,000 unpaid pending orders in the company the waiting query stays under the serving budget", async () => {
  const s = await shop([5]);
  // Each statement is its own interactive transaction (5 s Prisma timeout), so seed in batches that stay well under it on a slow runner.
  await s.run(async () => {
    for (let first = 1; first <= 10000; first += 1000) {
      const last = first + 999;
      await prisma.$executeRaw`INSERT INTO "Order" (id, number, "sellerId", currency, total, "itemsTotal", "createdAt")
        SELECT gen_random_uuid(), 200000 + n, (SELECT id FROM "user" WHERE "companyId" = current_setting('app.company_id')::uuid LIMIT 1), 'PEN', 10, 10, now() - n * interval '1 second'
        FROM generate_series(${first}::int, ${last}::int) n`;
      await prisma.$executeRaw`INSERT INTO "OrderItem" (id, "orderId", "orderCreatedAt", "variantId", "productName", "variantAttributes", quantity, "unitPrice", subtotal)
        SELECT gen_random_uuid(), o.id, o."createdAt", ${s.variants[0]!}::uuid, 'Camisa', '{}'::json, 1, 10, 10 FROM "Order" o WHERE o.number BETWEEN ${200000 + first}::int AND ${200000 + last}::int`;
    }
    await prisma.$executeRaw`ANALYZE "Order"`;
  });
  const timings: number[] = [];
  for (let run = 0; run < 3; run += 1) {
    const started = Date.now();
    const listed = await s.run(() => withinTransaction(async () => ok(await listWaitingOrderIds(s.companyId, [s.variants[0]!], 100))));
    timings.push(Date.now() - started);
    expect(listed).toMatchObject({ success: true, data: { success: true, data: [] } });
  }
  measure({ measure: "list_waiting_order_ids_with_10000_unpaid_pending_orders", timingsMs: timings });
  expect(Math.min(...timings)).toBeLessThan(500);
});

test("a serving timeout keeps the candidates it had already listed in the outcome", async () => {
  const s = await shop([0]);
  const id = await s.create([[0, 1]]);
  await s.pay(id, 10);
  const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
  try {
    const slowRegistry = { ...stockRegistry, product_stock_increased: serveWaitingOrders({ ...deductDueStockDependencies,
      lockOrdersSkipLocked: async () => {
        try { await prisma.$queryRaw`SELECT pg_sleep(1.5)`; return ok([]); }
        catch (cause) { return err(persistenceFailureResult(cause, "Unable to lock orders")); }
      } }) };
    const publish = createStockPublisher(slowRegistry);
    const outcome = await s.run(() => withinTransaction(async () => {
      await prisma.productStock.update({ where: { variantId: s.variants[0]! }, data: { quantity: { increment: 3n } } });
      return publish("product_stock_increased", { companyId: s.companyId, variantIds: [s.variants[0]!] });
    }, { timeout: 5000, lockTimeoutMs: 2000, statementTimeoutMs: 2000 }));
    // The partial progress (one candidate listed before the timeout) survives in the outcome.
    expect(outcome).toMatchObject({ success: true, data: { budgetExhausted: true, candidates: 1 } });
  } finally { warn.mockRestore(); }
});

test("serving that runs out of budget through the real publisher is logged with budgetExhausted true", async () => {
  const s = await shop([0]);
  const id = await s.create([[0, 1]]);
  await s.pay(id, 10);
  const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
  const previous = deductDueStockDependencies.waitingOrdersBudgetMs;
  try {
    // 1 ms of budget: the first statement already has none left, so serving is cut as a contained timeout.
    (deductDueStockDependencies as { waitingOrdersBudgetMs: number }).waitingOrdersBudgetMs = 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const outcome = await s.restock(0, 3);
    expect(outcome).toMatchObject({ success: true, data: { budgetExhausted: true } });
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: "waiting_orders_served", budgetExhausted: true, variantCount: 1 }), "waiting_orders_served");
    expect(await s.stock()).toBe(3);
  } finally {
    (deductDueStockDependencies as { waitingOrdersBudgetMs: number }).waitingOrdersBudgetMs = previous;
    warn.mockRestore();
  }
});

test("a transaction-ending failure of the listener is logged as stock_deduction_rolled_back and rolls the payment back", async () => {
  const s = await shop([5]);
  const id = await s.create([[0, 2]]);
  const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
  try {
    const ending = createStockPublisher({ ...stockRegistry, payment_confirmed: async () => err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "closed", transactionEnding: true as const }) });
    const result = await s.run(() => withinTransaction(async () => {
      const published = await ending("payment_confirmed", { companyId: s.companyId, orderId: id, paymentId: randomUUID() as PaymentId });
      return published;
    }));
    expect(result).toMatchObject({ success: false, error: { transactionEnding: true } });
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: "stock_deduction_rolled_back", eventName: "payment_confirmed", companyId: s.companyId }), "stock_deduction_rolled_back");
  } finally { warn.mockRestore(); }
});

// --- Checkout, report approval and recovery overlap ---

test("the checkout confirms a delivery that covers the order with short stock", async () => {
  const s = await shop([3]);
  await s.run(async () => {
    expect((await deliverySettings.save({ expectedVersion: 0, home: { enabled: false }, agency: { enabled: false },
      store: { enabled: true, pickupPoint: { name: "Shop", address: "Street", instructions: null } } }, s.context)).success).toBe(true);
  });
  const orderId = await s.create([[0, 4]]);
  await s.run(async () => {
    await prisma.order.update({ where: { id: orderId }, data: { checkoutEnabledAt: new Date() } });
    await prisma.payment.create({ data: { id: randomUUID(), orderId, status: "confirmed", currency: "PEN", amount: 40, method: "digital_wallet",
      deductStockIfPartial: false, data: { confirmedAt: new Date().toISOString(), confirmedBy: { kind: "legacy" }, evidence: { kind: "manual" } } } });
  });
  const buyer = parseBuyer({ name: "Ana", phone: "+51987654321" });
  const pickup = parseRatedDeliverySelection({ method: "store", recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } } });
  if (!buyer.success || !pickup.success) throw new Error("setup");
  const confirmed = await orders.confirmCheckoutDelivery({ buyer: buyer.data, expectedTotal: { amount: 40, currency: "PEN" },
    delivery: { kind: "replace", selection: pickup.data, expectedPrice: { amount: 0, currency: "PEN" } } }, { companyId: s.companyId, orderId });
  expect(confirmed).toMatchObject({ success: true });
  expect(await s.run(async () => await prisma.order.findUniqueOrThrow({ where: { id: orderId } }))).toMatchObject({ checkoutConfirmedAt: expect.any(Date), stockDeducted: false });
  expect(await s.stock()).toBe(3);
  const described = await s.run(async () => { const found = await orders.getAggregate(orderId, s.context); return found.success ? await orders.describeStockDue([found.data]) : null; });
  expect(described && described.success ? described.data.get(orderId) : null).toEqual(waiting(s, 0, 3));
});

async function reported(s: Shop, orderId: OrderId) {
  const paymentId = randomUUID() as PaymentId;
  await s.run(async () => {
    await prisma.payment.create({ data: { id: paymentId, orderId, status: "reported", currency: "PEN", amount: null, method: null,
      data: { receiptImageId: randomUUID(), reportedAt: new Date().toISOString() } } });
  });
  const approve = () => s.run(() => orders.registerPayment({ orderId, paymentId, source: "buyer_report", amount: { amount: 40, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false }, s.context));
  return { paymentId, approve };
}

test("approving a covering report with short stock confirms it and leaves the order waiting", async () => {
  const s = await shop([3]);
  const id = await s.create([[0, 4]]);
  const report = await reported(s, id);
  expect(await report.approve()).toMatchObject({ success: true, data: { order: { stockDeducted: false }, stockDue: waiting(s, 0, 3) } });
  expect(await s.run(async () => await prisma.payment.findUniqueOrThrow({ where: { id: report.paymentId } }))).toMatchObject({ status: "confirmed", deductStockIfPartial: false });
  expect(await s.stock()).toBe(3);
});

test("approving the same report twice records one payment and deducts once", async () => {
  const s = await shop([4]);
  const id = await s.create([[0, 4]]);
  const report = await reported(s, id);
  expect(await report.approve()).toMatchObject({ success: true, data: { order: { stockDeducted: true }, stockDue: null } });
  expect(await report.approve()).toMatchObject({ success: true, data: { order: { stockDeducted: true }, stockDue: null } });
  expect(await s.run(async () => await prisma.payment.count({ where: { orderId: id, status: "confirmed" } }))).toBe(1);
  expect(await s.stock()).toBe(0);
});

test("two concurrent recovery runs over the same due order deduct it once", async () => {
  const s = await shop([5]);
  const id = await s.create([[0, 2]]);
  await s.run(async () => {
    await prisma.payment.create({ data: { id: randomUUID(), orderId: id, status: "confirmed", currency: "PEN", amount: 20, method: "digital_wallet",
      deductStockIfPartial: false, data: { confirmedAt: new Date().toISOString(), confirmedBy: { kind: "legacy" }, evidence: { kind: "manual" } } } });
  });
  const once = { ...recoveryDependencies, passOffsetsMs: [0] };
  // The runs see every company of the shared test database; this order is checked through its own stock and flag.
  const runs = await Promise.all([recoverDueStockDeductions(new AbortController().signal, once), recoverDueStockDeductions(new AbortController().signal, once)]);
  expect(runs.every((run) => run.success)).toBe(true);
  expect(await s.deducted(id)).toBe(true);
  expect(await s.stock()).toBe(3);
});
