import { randomUUID } from "node:crypto";
import { afterAll, afterEach, expect, test, vi } from "vitest";
import type { LoaderFunctionArgs } from "react-router";
import { app } from "@core/src/app";
import { loader as catalogLoader } from "@core/app/routes/catalog";
import { loader as checkoutLoader } from "@core/app/routes/checkout";
import { storeAppearance } from "@core/src/features/store-appearance/composition";
import { catalogCart } from "@core/src/features/catalog/cart-composition";
import { orders } from "@core/src/features/orders/composition";
import { parseBuyer } from "@core/src/features/orders/domain/checkout";
import { prisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import type { CartQuantity } from "@core/src/features/orders/domain/catalog-order";
import type { CompanyId, OrderId, UserId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";

const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Catalog test server did not bind");
const base = `http://127.0.0.1:${address.port}`;
const cleanups: (() => Promise<void>)[] = [];
afterEach(() => vi.restoreAllMocks());
afterAll(async () => { for (const cleanup of cleanups) await cleanup(); await new Promise((resolve) => server.close(resolve)); });

async function store(published = true) {
  const companyId = randomUUID() as CompanyId;
  const productId = randomUUID();
  const [black, beige] = [randomUUID(), randomUUID()] as VariantId[];
  await withTenantIsolation(companyId, async () => {
    await prisma.company.create({ data: { id: companyId, name: "Moda Lucía", country: "PE", catalogPublished: published, catalogSubdomain: published ? `s${companyId.replaceAll("-", "").slice(0, 20)}` : null } });
    await prisma.product.create({ data: { id: productId, name: "Polo básico", currency: "PEN", qrCode: productId, status: "active", createdAt: new Date(), updatedAt: new Date() } });
    for (const [variantId, color, stock] of [[black, "Negro", 3n], [beige, "Beige", 1n]] as const) {
      await prisma.productVariant.create({ data: { id: variantId, productId, attributes: { Talla: "M", Color: color }, sku: `SKU-${variantId}`, salePrice: 45, purchasePrice: 20, qrCode: variantId, status: "active" } });
      await prisma.productStock.create({ data: { variantId, quantity: stock } });
    }
  });
  cleanups.push(() => withTenantIsolation(companyId, async () => {
    await prisma.orderBuyer.deleteMany();
    await prisma.orderItem.deleteMany();
    await prisma.order.deleteMany();
    await prisma.productStock.deleteMany();
    await prisma.productVariant.deleteMany();
    await prisma.product.deleteMany();
    await prisma.company.delete({ where: { id: companyId } });
  }));
  return { companyId, black, beige };
}
const nextNumber = async (companyId: CompanyId) =>
  (await withTenantIsolation(companyId, async () => await prisma.company.findUniqueOrThrow({ where: { id: companyId } }))).nextOrderNumber;
const line = (variantId: VariantId, quantity: number) => ({ variantId, quantity: quantity as CartQuantity });

test("two simultaneous Continuar with the same id create one order and consume one number", async () => {
  const { companyId, black } = await store();
  const before = await nextNumber(companyId);
  const input = { orderId: randomUUID() as OrderId, lines: [line(black, 3)] };
  const [first, second] = await Promise.all([catalogCart.continueToCheckout(input, companyId), catalogCart.continueToCheckout(input, companyId)]);
  expect(first).toMatchObject({ success: true, data: { id: input.orderId, number: Number(before), fromCatalog: true, sellerId: null } });
  expect(second).toEqual(first);
  expect(await nextNumber(companyId)).toBe(before + 1n);
  const stored = await withTenantIsolation(companyId, async () => await prisma.order.findMany({ include: { items: true } }));
  expect(stored).toMatchObject([{ id: input.orderId, fromCatalog: true, sellerId: null, checkoutConfirmedAt: null, items: [{ quantity: 3n }] }]);
  expect(stored[0].checkoutEnabledAt).toBeInstanceOf(Date);
});

test("a rejected cart allocates no number", async () => {
  const { companyId, black, beige } = await store();
  const before = await nextNumber(companyId);
  expect(await catalogCart.continueToCheckout({ orderId: randomUUID() as OrderId, lines: [line(black, 1), line(beige, 2)] }, companyId))
    .toMatchObject({ success: false, error: { code: "LINES_UNAVAILABLE", issues: [{ variantId: beige, reason: "insufficient", available: 1 }] } });
  expect(await nextNumber(companyId)).toBe(before);
  expect(await withTenantIsolation(companyId, async () => await prisma.order.count())).toBe(0);
});

test("an id already used by another company is rejected without revealing the order", async () => {
  const first = await store();
  const second = await store();
  const orderId = randomUUID() as OrderId;
  expect(await catalogCart.continueToCheckout({ orderId, lines: [line(first.black, 1)] }, first.companyId)).toMatchObject({ success: true });
  const before = await nextNumber(second.companyId);
  expect(await catalogCart.continueToCheckout({ orderId, lines: [line(second.black, 1)] }, second.companyId))
    .toEqual({ success: false, error: { code: "ORDER_ID_CONFLICT", message: expect.any(String) } });
  expect(await nextNumber(second.companyId)).toBe(before);
});

test("an unpublished catalog does not accept Continuar and the cart refresh never exposes SKU, cost or stock", async () => {
  const hidden = await store(false);
  expect(await catalogCart.continueToCheckout({ orderId: randomUUID() as OrderId, lines: [line(hidden.black, 1)] }, hidden.companyId))
    .toMatchObject({ success: false, error: { code: "CATALOG_UNAVAILABLE" } });
  expect(await catalogCart.refresh(hidden.companyId, [hidden.black])).toEqual({ success: true, data: null });
  const open = await store();
  const refreshed = await catalogCart.refresh(open.companyId, [open.black, open.beige, randomUUID() as VariantId]);
  expect(refreshed).toMatchObject({ success: true, data: expect.arrayContaining([
    { variantId: open.black, productId: expect.any(String), productName: "Polo básico", attributes: { Talla: "M", Color: "Negro" },
      price: { amount: 45, currency: "PEN" }, maxQuantity: 3, imageUrl: null }]) });
  expect(JSON.stringify(refreshed)).not.toMatch(/SKU-|purchasePrice|"stock"|"sku"/);
});

test("buyer payment routes reject an unconfirmed catalog order, and the seller sees it only after confirmation", async () => {
  const { companyId, black } = await store();
  const orderId = randomUUID() as OrderId;
  const created = await catalogCart.continueToCheckout({ orderId, lines: [line(black, 2)] }, companyId);
  if (!created.success) throw new Error(created.error.code);
  expect((await fetch(`${base}/api/buyer/orders/${orderId}/payment`)).status).toBe(404);
  const seller = { companyId, userId: randomUUID() as UserId };
  const listed = () => withTenantIsolation(companyId, () => orders.listAggregates({ page: 1, customer: { kind: "all" } }, seller));
  expect(await listed()).toMatchObject({ success: true, data: { items: [] } });
  const buyer = parseBuyer({ name: "Ana", phone: "+51987654321" });
  if (!buyer.success) throw new Error(buyer.error.code);
  expect(await orders.confirmCheckout({ buyer: buyer.data, expectedTotal: created.data.total }, { companyId, orderId }))
    .toMatchObject({ success: true });
  expect(await listed()).toMatchObject({ success: true, data: { items: [{ id: orderId, fromCatalog: true, sellerId: null }] } });
  expect((await fetch(`${base}/api/buyer/orders/${orderId}/payment`)).status).toBe(200);
});

test("Continuar takes the current price and the checkout keeps working after the catalog is hidden", async () => {
  const { companyId, black } = await store();
  await withTenantIsolation(companyId, async () => await prisma.productVariant.update({ where: { id: black }, data: { salePrice: 50 } }));
  const orderId = randomUUID() as OrderId;
  const created = await catalogCart.continueToCheckout({ orderId, lines: [line(black, 2)] }, companyId);
  expect(created).toMatchObject({ success: true, data: { total: { amount: 100, currency: "PEN" } } });
  if (!created.success) return;
  await withTenantIsolation(companyId, async () => await prisma.company.update({ where: { id: companyId }, data: { catalogPublished: false } }));
  expect(await orders.getCheckout({ companyId, orderId })).toMatchObject({ success: true, data: { checkout: { number: created.data.number } } });
  const buyer = parseBuyer({ name: "Ana", phone: "+51987654321" });
  if (!buyer.success) throw new Error(buyer.error.code);
  expect(await orders.confirmCheckout({ buyer: buyer.data, expectedTotal: created.data.total }, { companyId, orderId })).toMatchObject({ success: true });
});

test("a buyer whose store appearance cannot be read browses in Clásico without logo, adds to the cart and continues to the checkout", async () => {
  const { companyId, black } = await store();
  vi.spyOn(storeAppearance, "getPublic").mockRejectedValue(new Error("appearance down"));
  const catalog = await catalogLoader({ params: { companyId }, request: new Request(`http://localhost/catalogo/${companyId}`) } as unknown as LoaderFunctionArgs);
  expect(catalog).toMatchObject({ data: { storeName: "Moda Lucía", appearance: { logoUrl: null, theme: "classic" }, items: [{ name: "Polo básico" }] } });

  const orderId = randomUUID() as OrderId;
  const created = await catalogCart.continueToCheckout({ orderId, lines: [line(black, 1)] }, companyId);
  expect(created).toMatchObject({ success: true, data: { id: orderId, fromCatalog: true } });

  const checkout = await checkoutLoader({ params: { companyId, orderId }, request: new Request(`http://localhost/checkout/${companyId}/${orderId}`) } as unknown as LoaderFunctionArgs);
  if (!created.success) return;
  expect(checkout).toMatchObject({ data: { checkout: { number: created.data.number, companyName: "Moda Lucía", items: [{ productName: "Polo básico", quantity: 1 }] }, appearance: null } });
});
