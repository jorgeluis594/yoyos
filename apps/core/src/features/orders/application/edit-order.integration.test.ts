import { randomUUID } from "node:crypto";
import { expect, test, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { err, ok } from "@shared/functional";
import { log } from "@core/src/shared/infrastructure/logger";
import { orders, publishStockEvent } from "@core/src/features/orders/composition";
import { editOrder, type EditOrderDependencies, type EditOrderInput } from "@core/src/features/orders/application/edit-order";
import { findOrderAggregate, findOrderForUpdate, saveDelivery, saveItemChanges, saveOrderCustomer } from "@core/src/features/orders/infrastructure/order-repository";
import { orderRevisions } from "@core/src/features/orders/domain/order-revisions";
import { orderStateMachine, parseRatedDeliverySelection } from "@core/src/features/orders/domain/order-state-machine";
import type { DeliveryEdit, OrderLineQuantity, OrderLineRequest, OrderPart } from "@core/src/features/orders/domain/order-edit";
import { findSellableVariants, findVariantStock } from "@core/src/features/products";
import { deliverySettings } from "@core/src/features/delivery-settings/composition";
import { prisma, systemPrisma, withinTransaction, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { seedProduct } from "@core/src/features/products/infrastructure/product-seed";
import type { CompanyId, OrderId, OrderItemId, PaymentId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";

const pen = (amount: number) => ({ amount, currency: "PEN" as const });
const ana = { name: "Ana", phone: "999", identity: { kind: "absent" as const } };
const storedHome = { method: "home", recipient: ana, destination: { address: "Av. Lima 123", country: "PE", districtCode: "150101", district: "Lima", province: "Lima", department: "Lima", instructions: "Timbre roto" },
  pricing: { quotationId: randomUUID(), rateId: randomUUID(), optionId: randomUUID(), settingsVersion: 1 }, recordedBy: { kind: "buyer" } };

/** Order 1042 of the design: two «Traje» lines at S/ 89.00 and «Deadpool · M» at S/ 120.00, with a S/ 150.00 payment. */
async function shop(stocks = { traje: 5, deadpool: 4 }) {
  const companyId = randomUUID() as CompanyId;
  const sellerId = randomUUID() as UserId;
  const seeded = await withTenantIsolation(companyId, async () => {
    await prisma.company.create({ data: { id: companyId, name: "Edit order", country: "PE" } });
    await systemPrisma.user.create({ data: { id: sellerId, name: "Seller", email: `${sellerId}@example.test`, companyId } });
    const traje = await seedProduct({ name: "Traje", variants: [{ attributes: { Talla: "S" }, salePrice: 89, stock: stocks.traje }, { attributes: { Talla: "M" }, salePrice: 89, stock: stocks.traje }] });
    const deadpool = await seedProduct({ name: "Deadpool", variants: [{ attributes: { Talla: "M" }, salePrice: 120, stock: stocks.deadpool }] });
    return { traje: traje.variantIds as VariantId[], deadpool: deadpool.variantIds as VariantId[] };
  });
  const [trajeS, trajeM] = seeded.traje as [VariantId, VariantId];
  const [deadpool] = seeded.deadpool as [VariantId];
  const context = { companyId, userId: sellerId };
  // `async` so a lazy Prisma promise runs inside the tenant scope.
  const run = <T>(work: () => Promise<T>) => withTenantIsolation(companyId, async () => work());
  const q = (n: number) => n as PositiveInteger;
  const create = (items: [VariantId, number][] = [[trajeS, 1], [trajeM, 1], [deadpool, 1]]) => run(async () => {
    const id = randomUUID() as OrderId;
    const [first, ...rest] = items.map(([variantId, quantity]) => ({ variantId, quantity: q(quantity) }));
    const created = await orders.create({ id, items: [first!, ...rest] }, context);
    if (!created.success) throw new Error(created.error.message);
    return id;
  });
  const pay = (orderId: OrderId, amount: number) => run(() => orders.registerPayment({ orderId, paymentId: randomUUID() as PaymentId, amount: pen(amount), method: "digital_wallet", deductStockIfPartial: false }, context));
  const load = (orderId: OrderId) => run(async () => {
    const found = await orders.getAggregate(orderId, context);
    if (!found.success) throw new Error(found.error.message);
    return { order: found.data, revisions: orders.revisions(found.data) };
  });
  const stock = (variantId: VariantId) => run(async () => Number((await prisma.productStock.findUniqueOrThrow({ where: { variantId } })).quantity));
  const edit = async (orderId: OrderId, parts: Partial<Record<OrderPart, object>>, base?: Awaited<ReturnType<typeof load>>["revisions"]) => {
    const revisions = base ?? (await load(orderId)).revisions;
    const input: Record<string, unknown> = { orderId };
    for (const [part, value] of Object.entries(parts)) input[part] = { base: revisions[part as OrderPart], ...value };
    return run(() => orders.edit(input as EditOrderInput, context));
  };
  const lines = (...entries: [VariantId, number][]) => ({ lines: entries.map(([variantId, quantity]): OrderLineRequest => ({ variantId, quantity: quantity as OrderLineQuantity })) });
  const cleanup = () => run(async () => {
    await prisma.payment.deleteMany();
    await prisma.orderItem.deleteMany();
    await prisma.order.deleteMany();
    await prisma.contact.deleteMany();
    await prisma.deliveryRate.deleteMany();
    await prisma.quotation.deleteMany();
    await prisma.deliveryOption.deleteMany();
    await prisma.deliveryZoneDistrict.deleteMany();
    await prisma.deliveryZone.deleteMany();
    await prisma.companyDeliverySettings.deleteMany();
    const { deleteSeededProducts } = await import("@core/src/features/products/infrastructure/product-seed");
    await deleteSeededProducts();
    await systemPrisma.user.delete({ where: { id: sellerId } });
    await prisma.company.delete({ where: { id: companyId } });
  });
  return { companyId, sellerId, context, trajeS, trajeM, deadpool, run, create, pay, load, stock, edit, lines, cleanup };
}
type Shop = Awaited<ReturnType<typeof shop>>;
async function inShop(work: (s: Shop) => Promise<void>, stocks?: Parameters<typeof shop>[0]) {
  const s = await shop(stocks);
  try { await work(s); } finally { await s.cleanup(); }
}
const unwrap = <T>(result: { success: true; data: T } | { success: false; error: unknown }) => { if (!result.success) throw new Error(JSON.stringify(result.error)); return result.data; };

test("raises a quantity of order 1042 to a total of 418.00 keeping the 150.00 Yape payment unchanged", async () => {
  await inShop(async (s) => {
    const id = await s.create();
    unwrap(await s.pay(id, 150));
    const before = await s.load(id);
    const edited = unwrap(await s.edit(id, { items: s.lines([s.trajeS, 1], [s.trajeM, 1], [s.deadpool, 2]) }));
    expect(edited.applied).toEqual(["items"]);
    expect(edited.order).toMatchObject({ itemsTotal: pen(418), total: pen(418), stockDeducted: false });
    expect(orderStateMachine.getPaymentSummary(edited.order)).toMatchObject({ success: true, data: { balanceDue: pen(268) } });
    const after = await s.load(id);
    expect(after.order.payments).toEqual(before.order.payments);
    expect(after.order.items.map((item) => [item.variantId, item.quantity, item.subtotal.amount]).sort()).toEqual([[s.trajeS, 1, 89], [s.trajeM, 1, 89], [s.deadpool, 2, 240]].sort());
    expect(after.revisions.customer).toBe(before.revisions.customer);
  });
});

test("removes two lines so payments cover the total and deducts stock in the same response", async () => {
  await inShop(async (s) => {
    const id = await s.create();
    unwrap(await s.pay(id, 150));
    const edited = unwrap(await s.edit(id, { items: s.lines([s.deadpool, 1]) }));
    expect(edited.order).toMatchObject({ itemsTotal: pen(120), stockDeducted: true });
    expect(edited.stockDue).toBeNull();
    expect(orderStateMachine.getPaymentSummary(edited.order)).toMatchObject({ success: true, data: { overpaidAmount: pen(30) } });
    expect(await s.stock(s.deadpool)).toBe(3);
    expect((await s.load(id)).order.stockDeducted).toBe(true);
  });
});

test("removes two lines with short stock and leaves the order waiting", async () => {
  await inShop(async (s) => {
    const id = await s.create();
    unwrap(await s.pay(id, 150));
    const edited = unwrap(await s.edit(id, { items: s.lines([s.deadpool, 1]) }));
    expect(edited.order.stockDeducted).toBe(false);
    expect(edited.stockDue).toMatchObject({ kind: "waiting" });
    expect(await s.stock(s.deadpool)).toBe(0);
  }, { traje: 5, deadpool: 0 });
});

test("refuses an items edit after a restock served the order and keeps the stored items", async () => {
  await inShop(async (s) => {
    const id = await s.create();
    unwrap(await s.pay(id, 150));
    const stale = await s.load(id);
    expect(unwrap(await s.edit(id, { items: s.lines([s.deadpool, 1]) }, stale.revisions)).stockDue).toMatchObject({ kind: "waiting" });
    const restocked = await s.run(() => withinTransaction(async () => {
      await prisma.productStock.update({ where: { variantId: s.deadpool }, data: { quantity: { increment: 5n } } });
      const published = await publishStockEvent("product_stock_increased", { companyId: s.companyId, variantIds: [s.deadpool] });
      return published.success ? ok(published.data) : published;
    }));
    expect(restocked).toMatchObject({ success: true, data: { deducted: 1 } });
    const fresh = await s.load(id);
    expect(await s.edit(id, { items: s.lines([s.deadpool, 3]) }, fresh.revisions)).toMatchObject({ success: false, error: { code: "ITEMS_LOCKED" } });
    expect((await s.load(id)).order.items.map((item) => item.quantity)).toEqual([1]);
  }, { traje: 5, deadpool: 0 });
});

test("saves a customer edit after a covering payment from another session deducted the stock", async () => {
  await inShop(async (s) => {
    const id = await s.create();
    const loaded = await s.load(id);
    unwrap(await s.pay(id, 298));
    expect((await s.load(id)).order.stockDeducted).toBe(true);
    const edited = unwrap(await s.edit(id, { customer: { value: { name: "Marta", phone: "+51999000111" } } }, loaded.revisions));
    expect(edited).toMatchObject({ applied: ["customer"], order: { buyer: { name: "Marta", phone: "+51999000111" }, stockDeducted: true } });
    expect(await s.edit(id, { items: s.lines([s.deadpool, 2]) }, loaded.revisions)).toMatchObject({ success: false, error: { code: "ITEMS_LOCKED" } });
  });
});

test("refuses the items edit when a chat message changed the items of the same order", async () => {
  await inShop(async (s) => {
    const id = await s.create();
    const loaded = await s.load(id);
    // What a chat message does to the items: a quantity change on the stored row.
    await s.run(async () => {
      await prisma.orderItem.updateMany({ where: { orderId: id, variantId: s.deadpool }, data: { quantity: 2n, subtotal: 240 } });
      await prisma.order.update({ where: { id }, data: { itemsTotal: 418, total: 418 } });
    });
    expect(await s.edit(id, { items: s.lines([s.trajeS, 2]) }, loaded.revisions)).toMatchObject({ success: false, error: { code: "ORDER_CHANGED", parts: ["items"] } });
    expect(await s.edit(id, { customer: { value: { name: "Marta", phone: "+51999000111" } } }, loaded.revisions)).toMatchObject({ success: true, data: { applied: ["customer"] } });
  });
});

test("serializes two simultaneous item saves: one succeeds, the other answers ORDER_CHANGED", async () => {
  await inShop(async (s) => {
    const id = await s.create();
    const { revisions } = await s.load(id);
    const results = await Promise.all([s.edit(id, { items: s.lines([s.deadpool, 2]) }, revisions), s.edit(id, { items: s.lines([s.deadpool, 3]) }, revisions)]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(results.filter((result) => !result.success)).toMatchObject([{ error: { code: "ORDER_CHANGED", parts: ["items"] } }]);
    const quantity = (await s.load(id)).order.items.find((item) => item.variantId === s.deadpool)?.quantity;
    expect([2, 3]).toContain(quantity);
  });
});

test("sending the same request twice succeeds with applied empty and does not double the quantities", async () => {
  await inShop(async (s) => {
    const id = await s.create();
    unwrap(await s.pay(id, 150));
    const { revisions } = await s.load(id);
    const first = unwrap(await s.edit(id, { items: s.lines([s.deadpool, 1]) }, revisions));
    expect(first.order.stockDeducted).toBe(true);
    const again = unwrap(await s.edit(id, { items: s.lines([s.deadpool, 1]) }, revisions));
    expect(again.applied).toEqual([]);
    expect((await s.load(id)).order.items.map((item) => item.quantity)).toEqual([1]);
    expect(await s.stock(s.deadpool)).toBe(3);
  });
});

async function seedStoredDelivery(s: Shop, id: OrderId) {
  await s.run(() => prisma.order.update({ where: { id }, data: { delivery: storedHome, deliveryCost: 10, deliveryCharge: 10, total: 308 } }));
}

test("keeps the buyer-chosen delivery untouched when only a quantity changes", async () => {
  await inShop(async (s) => {
    const id = await s.create();
    await seedStoredDelivery(s, id);
    const before = await s.run(() => prisma.order.findUniqueOrThrow({ where: { id } }));
    unwrap(await s.edit(id, { items: s.lines([s.trajeS, 1], [s.trajeM, 1], [s.deadpool, 2]) }));
    const after = await s.run(() => prisma.order.findUniqueOrThrow({ where: { id } }));
    expect(after.delivery).toEqual(before.delivery);
    expect(JSON.stringify(after.delivery)).toBe(JSON.stringify(before.delivery));
    expect([after.deliveryCost.toNumber(), after.deliveryCharge.toNumber(), after.total.toNumber()]).toEqual([10, 10, 428]);
  });
});

test("changes only the reference of a buyer-chosen delivery at the old price without quoting", async () => {
  await inShop(async (s) => {
    const id = await s.create();
    await seedStoredDelivery(s, id);
    const change: DeliveryEdit = { kind: "amend", amendment: { method: "home", recipient: ana, address: "Av. Lima 123", instructions: "Portón azul" } };
    const edited = unwrap(await s.edit(id, { delivery: { change } }));
    expect(edited.order).toMatchObject({ deliveryCharge: pen(10), total: pen(308), delivery: { destination: { instructions: "Portón azul" }, pricing: storedHome.pricing, recordedBy: { kind: "seller", userId: s.sellerId } } });
  });
});

test("refuses a district change after the rate price changed and keeps the item edits unsaved", async () => {
  await inShop(async (s) => {
    const id = await s.create();
    await s.run(async () => {
      expect(await deliverySettings.save({ expectedVersion: 0, agency: { enabled: false }, home: { enabled: true }, store: { enabled: false, pickupPoint: null } }, s.context)).toMatchObject({ success: true });
      expect(await deliverySettings.saveZones({ expectedVersion: 1, zones: [{ kind: "new", name: "Zona", enabled: true, districtCodes: ["150122"],
        options: [{ kind: "new", method: "home", name: "Home", enabled: true, price: pen(12) }] }] }, s.context)).toMatchObject({ success: true });
    });
    const quote = await s.run(() => deliverySettings.createQuotation({ companyId: s.companyId, country: "PE", districtCode: "150122", address: null, instructions: null }));
    if (!quote.success || !quote.data.rates[0]) throw new Error("Missing rate");
    const selection = parseRatedDeliverySelection({ method: "home", rateId: quote.data.rates[0].rate.id, recipient: ana, destination: { districtCode: "150122", address: "Av. Lima 123", instructions: null } });
    if (!selection.success) throw new Error(selection.error.message);
    const stale: DeliveryEdit = { kind: "replace", selection: selection.data, expectedPrice: pen(10) };
    expect(await s.edit(id, { items: s.lines([s.deadpool, 2]), delivery: { change: stale } }))
      .toMatchObject({ success: false, error: { code: "TOTAL_CHANGED", currentPrice: pen(12) } });
    expect((await s.load(id)).order).toMatchObject({ itemsTotal: pen(298), delivery: null });
    const current: DeliveryEdit = { kind: "replace", selection: selection.data, expectedPrice: pen(12) };
    expect(unwrap(await s.edit(id, { items: s.lines([s.deadpool, 2]), delivery: { change: current } })).order).toMatchObject({ itemsTotal: pen(240), deliveryCharge: pen(12), total: pen(252) });
  });
});

test("clears the customer of a manual order so the list shows general public", async () => {
  await inShop(async (s) => {
    const id = await s.create();
    await s.run(() => prisma.orderBuyer.create({ data: { orderId: id, name: "Ana", phone: "+51987654321" } }));
    const edited = unwrap(await s.edit(id, { customer: { value: null } }));
    expect(edited.order.buyer).toBeNull();
    expect(await s.run(() => prisma.orderBuyer.count({ where: { orderId: id } }))).toBe(0);
    expect((await s.load(id)).order.buyer).toBeNull();
  });
});

test("keeps the contact of a WhatsApp order when name and phone are emptied", async () => {
  await inShop(async (s) => {
    const id = await s.create();
    const contactId = randomUUID();
    await s.run(async () => {
      await prisma.contact.create({ data: { id: contactId, whatsappAccountId: "1@lid", whatsappLid: "2@lid" } });
      await prisma.orderBuyer.create({ data: { orderId: id, contactId, name: "Luis", phone: "+51999111222" } });
    });
    unwrap(await s.edit(id, { customer: { value: null } }));
    expect((await s.load(id)).order.buyer).toEqual({ contactId, name: null, phone: null });
  });
});

test("clears the customer of a confirmed checkout order and reads it back in the detail, the list and the stock listener", async () => {
  await inShop(async (s) => {
    const id = await s.create();
    await s.run(() => prisma.order.update({ where: { id }, data: { checkoutEnabledAt: new Date(), checkoutConfirmedAt: new Date(), buyer: { create: { name: "Ana", phone: "+51987654321" } } } }));
    unwrap(await s.edit(id, { customer: { value: null } }));
    expect((await s.load(id)).order).toMatchObject({ buyer: null, checkoutConfirmedAt: expect.any(Date) });
    const listed = await s.run(() => orders.listAggregates({ page: 1, customer: { kind: "all" } }, s.context));
    expect(listed).toMatchObject({ success: true, data: { items: [{ buyer: null }] } });
    expect(unwrap(await s.pay(id, 298)).order.stockDeducted).toBe(true);
  });
});

test("answers VARIANT_NOT_FOUND when a new variant is deleted between the lookup and the insert", async () => {
  await inShop(async (s) => {
    const id = await s.create([[s.deadpool, 1]]);
    const doomed = await s.run(() => seedProduct({ name: "Efimero", variants: [{ attributes: { Talla: "L" }, salePrice: 50, stock: 3 }] }));
    const variantId = doomed.variantIds[0] as VariantId;
    const { revisions } = await s.load(id);
    const deps: EditOrderDependencies = { transaction: (_companyId, work) => withinTransaction(work), findOrderForUpdate: (orderId, companyId) => findOrderForUpdate(orderId, companyId, "edit_order"),
      findSellableVariants: async (ids) => {
        const found = await findSellableVariants(ids);
        await prisma.productStock.deleteMany({ where: { variantId } });
        await prisma.productVariant.delete({ where: { id: variantId } });
        return found.success ? found : err({ code: "PERSISTENCE_UNAVAILABLE", message: found.error.message });
      },
      resolveRatedDelivery: async () => err({ code: "PERSISTENCE_UNAVAILABLE", message: "unused" }),
      saveItemChanges, saveOrderCustomer, saveDelivery, publishStockEvent: (payload) => publishStockEvent("order_edited", payload),
      publishStockIncreased: (variantIds) => publishStockEvent("product_stock_increased", { companyId: s.companyId, variantIds }),
      findVariantStock, newItemId: () => randomUUID() as OrderItemId };
    const result = await s.run(() => editOrder({ orderId: id, items: { base: revisions.items, lines: s.lines([s.deadpool, 1], [variantId, 1]).lines as never } }, s.context, deps));
    expect(result).toMatchObject({ success: false, error: { code: "VARIANT_NOT_FOUND", variantId } });
    expect((await s.load(id)).order.items).toHaveLength(1);
  });
});

test("answers VARIANT_NOT_FOUND for a new deactivated variant and writes nothing", async () => {
  await inShop(async (s) => {
    const id = await s.create([[s.deadpool, 1]]);
    const inactive = await s.run(() => seedProduct({ name: "Viejo", variants: [{ attributes: { Talla: "L" }, salePrice: 50, stock: 3, status: "inactive" }] }));
    const variantId = inactive.variantIds[0] as VariantId;
    expect(await s.edit(id, { items: s.lines([s.deadpool, 1], [variantId, 1]) })).toMatchObject({ success: false, error: { code: "VARIANT_NOT_FOUND", variantId } });
    expect((await s.load(id)).order.items).toHaveLength(1);
  });
});

test("answers the stock of sellable lines, leaves out an unsellable one and answers null without a query when the products are locked", async () => {
  await inShop(async (s) => {
    const id = await s.create();
    const { order } = await s.load(id);
    const inactive = await s.run(() => seedProduct({ name: "Viejo", variants: [{ attributes: { Talla: "L" }, stock: 3, status: "inactive" }] }));
    const withInactive = { ...order, items: [...order.items, { ...order.items[0]!, variantId: inactive.variantIds[0] as VariantId }] };
    expect(await s.run(() => orders.lineCatalog(withInactive as never, "detail_loader"))).toEqual({ [s.trajeS]: { stock: 5 }, [s.trajeM]: { stock: 5 }, [s.deadpool]: { stock: 4 } });
    const query = vi.spyOn(prisma, "$queryRaw");
    try {
      expect(await s.run(() => orders.lineCatalog({ ...order, cancelled: true }, "save_result"))).toBeNull();
      expect(await s.run(() => orders.lineCatalog({ ...order, stockDeducted: true }, "save_result"))).toBeNull();
      expect(await s.run(() => orders.lineCatalog({ ...order, deliveryStatus: "shipped" }, "save_result"))).toBeNull();
      expect(query).not.toHaveBeenCalled();
    } finally { query.mockRestore(); }
  });
});

test("answers null and warns when the stock read fails", async () => {
  await inShop(async (s) => {
    const { order } = await s.load(await s.create());
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const query = vi.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("database unavailable", { code: "P1001", clientVersion: "7.10.0" }));
    try {
      expect(await s.run(() => orders.lineCatalog(order, "detail_loader"))).toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: "order_line_catalog_unavailable", orderId: order.id, entryPoint: "detail_loader", errorCode: "PERSISTENCE_UNAVAILABLE", variantCount: 3 }), "order_line_catalog_unavailable");
    } finally { query.mockRestore(); warn.mockRestore(); }
  });
});

test("replaces 100 lines with a single insert and leaves the totals consistent", async () => {
  await inShop(async (s) => {
    const id = await s.create([[s.deadpool, 1]]);
    const many = await s.run(() => seedProduct({ name: "Muchos", variants: Array.from({ length: 100 }, (_, index) => ({ attributes: { Talla: `T${index}` }, salePrice: 2, stock: 5 })) }));
    const entries = many.variantIds.map((variantId): [VariantId, number] => [variantId as VariantId, 2]);
    const created = vi.spyOn(prisma.orderItem, "createMany");
    const single = vi.spyOn(prisma.orderItem, "create");
    try {
      const edited = unwrap(await s.edit(id, { items: s.lines(...entries) }));
      expect(edited.order).toMatchObject({ itemsTotal: pen(400), total: pen(400) });
      expect(created).toHaveBeenCalledTimes(1);
      expect(single).not.toHaveBeenCalled();
    } finally { created.mockRestore(); single.mockRestore(); }
    expect((await s.load(id)).order.items).toHaveLength(100);
  });
});

test("gives the same revisions from the unlocked read and from the locked read of one stored order", async () => {
  await inShop(async (s) => {
    const id = await s.create();
    await seedStoredDelivery(s, id);
    await s.run(() => prisma.orderBuyer.create({ data: { orderId: id, name: "Ana", phone: "+51987654321" } }));
    const unlocked = (await s.load(id)).revisions;
    const locked = await s.run(() => withinTransaction(async () => {
      const found = await findOrderForUpdate(id, s.companyId, "edit_order");
      return found.success && found.data ? ok(orderRevisions(found.data)) : err({ code: "ORDER_NOT_FOUND" as const, message: "missing" });
    }));
    expect(unwrap(locked)).toEqual(unlocked);
  });
});

test("cannot read or edit an order of another company", async () => {
  await inShop(async (s) => {
    await inShop(async (other) => {
      const id = await s.create();
      const { revisions } = await s.load(id);
      const stolen = await other.run(() => orders.edit({ orderId: id, items: { base: revisions.items, lines: s.lines([s.deadpool, 3]).lines as never } }, other.context));
      expect(stolen).toMatchObject({ success: false, error: { code: "ORDER_NOT_FOUND" } });
      expect((await s.load(id)).order.items.map((item) => item.quantity)).toEqual([1, 1, 1]);
    });
  });
});

test("rolls back items and customer when the transaction ends during stock deduction", async () => {
  await inShop(async (s) => {
    const id = await s.create();
    unwrap(await s.pay(id, 150));
    const { revisions } = await s.load(id);
    const deps: EditOrderDependencies = { transaction: (_companyId, work) => withinTransaction(work), findOrderForUpdate: (orderId, companyId) => findOrderForUpdate(orderId, companyId, "edit_order"),
      findSellableVariants: async (ids) => { const found = await findSellableVariants(ids); return found.success ? found : err({ code: "PERSISTENCE_UNAVAILABLE", message: found.error.message }); },
      resolveRatedDelivery: async () => err({ code: "PERSISTENCE_UNAVAILABLE", message: "unused" }),
      saveItemChanges, saveOrderCustomer, saveDelivery,
      publishStockEvent: async () => err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "closed", transactionEnding: true as const }),
      publishStockIncreased: async () => ok(null),
      findVariantStock, newItemId: () => randomUUID() as OrderItemId };
    const result = await s.run(() => editOrder({ orderId: id, items: { base: revisions.items, lines: s.lines([s.deadpool, 1]).lines as never },
      customer: { base: revisions.customer, value: { name: "Marta", phone: "+51999000111" } as never } }, s.context, deps));
    expect(result).toMatchObject({ success: false, error: { transactionEnding: true } });
    const after = await s.load(id);
    expect(after.order.items).toHaveLength(3);
    expect(after.order.buyer).toBeNull();
    expect(await s.run(async () => (await findOrderAggregate(id, s.companyId))).then((found) => found.success && found.data?.stockDeducted)).toBe(false);
  });
});
