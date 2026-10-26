import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { afterAll, afterEach, expect, test, vi } from "vitest";
import { RouterContextProvider, type LoaderFunctionArgs } from "react-router";
import type { CatalogSubdomain } from "@shared/catalog-subdomain";
import { app } from "@core/src/app";
import { loader as catalogLoader } from "@core/app/routes/catalog";
import { action as checkoutAction, loader as checkoutLoader } from "@core/app/routes/checkout";
import { storeAppearance } from "@core/src/features/store-appearance/composition";
import { catalogCart } from "@core/src/features/catalog/cart-composition";
import { catalogStorefront } from "@core/src/features/catalog/composition";
import type { PublishedStorefront } from "@core/src/features/catalog/application/resolve-storefront";
import { action as cartAction, loader as cartLoader } from "@core/app/routes/catalog-cart";
import { brandHostCompanyContext } from "@core/app/brand-host-context";
import { requestHostContext } from "@core/app/request-host-context";
import { storefrontContext } from "@core/app/storefront-context";
import { storefrontMiddleware } from "@core/app/middleware/storefront";
import { orders } from "@core/src/features/orders/composition";
import { parseBuyer } from "@core/src/features/orders/domain/checkout";
import { prisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import type { CartQuantity } from "@core/src/features/orders/domain/catalog-order";
import type { CompanyId, OrderId, UserId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";
import { seedProduct, deleteSeededProducts } from "@core/src/features/products/infrastructure/product-seed";

const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Catalog test server did not bind");
const port = address.port;
const cleanups: (() => Promise<void>)[] = [];
afterEach(() => vi.restoreAllMocks());
afterAll(async () => { for (const cleanup of cleanups) await cleanup(); await new Promise((resolve) => server.close(resolve)); });

/** The buyer payment view on the company's brand host, with the `Host` header chosen by the test. */
function buyerPayment(host: string, orderId: string) {
  return new Promise<number>((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path: `/api/buyer/orders/${orderId}/payment`, headers: { host: `${host}:${port}` } }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode ?? 0)); });
    req.on("error", reject);
    req.end();
  });
}
const subdomainOf = (companyId: string) => `s${companyId.replaceAll("-", "").slice(0, 20)}` as CatalogSubdomain;
/** What the brand host middleware resolves for a published company, as the cart compositions receive it. */
async function storefrontOf(companyId: CompanyId): Promise<PublishedStorefront> {
  const resolved = await catalogStorefront.resolve({ kind: "store", subdomain: subdomainOf(companyId) });
  if (!resolved.success || resolved.data.kind !== "published") throw new Error("Company is not published");
  return resolved.data;
}
/** The request context the storefront middleware builds for the cart route of a company's brand host. */
async function cartContext(companyId: CompanyId) {
  const context = new RouterContextProvider();
  context.set(requestHostContext, `${subdomainOf(companyId)}.localhost`);
  await storefrontMiddleware({ request: new Request("http://localhost/carrito"), params: {}, context } as never, async () => new Response());
  return context;
}
function hostContext(companyId: CompanyId) {
  const context = new RouterContextProvider();
  context.set(brandHostCompanyContext, companyId);
  return context;
}
const cartRequest = (body: unknown) => new Request("http://localhost/carrito", { method: "POST", body: JSON.stringify(body) });

async function store(published = true) {
  const companyId = randomUUID() as CompanyId;
  const productId = randomUUID();
  const [black, beige] = [randomUUID(), randomUUID()] as VariantId[];
  await withTenantIsolation(companyId, async () => {
    await prisma.company.create({ data: { id: companyId, name: "Moda Lucía", country: "PE", catalogPublished: published, catalogSubdomain: subdomainOf(companyId) } });
    await seedProduct({ id: productId, name: "Polo básico", qrCode: productId, variants: ([[black, "Negro", 3n], [beige, "Beige", 1n]] as const).map(([variantId, color, stock]) => ({
      id: variantId, attributes: { Talla: "M", Color: color }, sku: `SKU-${variantId}`, salePrice: 45, purchasePrice: 20, qrCode: variantId, stock })) });
  });
  cleanups.push(() => withTenantIsolation(companyId, async () => {
    await prisma.orderBuyer.deleteMany();
    await prisma.orderItem.deleteMany();
    await prisma.order.deleteMany();
    await deleteSeededProducts();
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
  const [first, second] = await Promise.all([catalogCart.continueToCheckout(input, await storefrontOf(companyId)), catalogCart.continueToCheckout(input, await storefrontOf(companyId))]);
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
  expect(await catalogCart.continueToCheckout({ orderId: randomUUID() as OrderId, lines: [line(black, 1), line(beige, 2)] }, await storefrontOf(companyId)))
    .toMatchObject({ success: false, error: { code: "LINES_UNAVAILABLE", issues: [{ variantId: beige, reason: "insufficient", available: 1 }] } });
  expect(await nextNumber(companyId)).toBe(before);
  expect(await withTenantIsolation(companyId, async () => await prisma.order.count())).toBe(0);
});

test("an id already used by another company is rejected without revealing the order", async () => {
  const first = await store();
  const second = await store();
  const orderId = randomUUID() as OrderId;
  expect(await catalogCart.continueToCheckout({ orderId, lines: [line(first.black, 1)] }, await storefrontOf(first.companyId))).toMatchObject({ success: true });
  const before = await nextNumber(second.companyId);
  expect(await catalogCart.continueToCheckout({ orderId, lines: [line(second.black, 1)] }, await storefrontOf(second.companyId)))
    .toEqual({ success: false, error: { code: "ORDER_ID_CONFLICT", message: expect.any(String) } });
  expect(await nextNumber(second.companyId)).toBe(before);
});

test("an unpublished catalog resolves unavailable, so refresh, Continuar and check_order answer CATALOG_UNAVAILABLE as JSON", async () => {
  const hidden = await store(false);
  const context = await cartContext(hidden.companyId);
  expect(context.get(storefrontContext)).toEqual({ kind: "unavailable" });
  const orderId = randomUUID();
  expect(await cartLoader({ request: new Request(`http://localhost/carrito?v=${hidden.black}`), context } as never)).toMatchObject({ data: { code: "CATALOG_UNAVAILABLE" }, init: { status: 404 } });
  expect(await cartAction({ request: cartRequest({ intent: "continue", orderId, lines: [{ variantId: hidden.black, quantity: 1 }] }), context } as never))
    .toMatchObject({ data: { code: "CATALOG_UNAVAILABLE" }, init: { status: 409 } });
  expect(await cartAction({ request: cartRequest({ intent: "check_order", orderId }), context } as never)).toMatchObject({ data: { code: "CATALOG_UNAVAILABLE" }, init: { status: 409 } });
  expect(await withTenantIsolation(hidden.companyId, async () => await prisma.order.count())).toBe(0);
});

test("the cart refresh never exposes SKU, cost or stock", async () => {
  const open = await store();
  const refreshed = await catalogCart.refresh(await storefrontOf(open.companyId), [open.black, open.beige, randomUUID() as VariantId]);
  expect(refreshed).toMatchObject({ success: true, data: expect.arrayContaining([
    { variantId: open.black, productId: expect.any(String), productName: "Polo básico", attributes: { Talla: "M", Color: "Negro" },
      price: { amount: 45, currency: "PEN" }, maxQuantity: 3, imageUrl: null }]) });
  expect(JSON.stringify(refreshed)).not.toMatch(/SKU-|purchasePrice|"stock"|"sku"/);
});

test("Continuar on Fantasio's host with another company's variants creates no order", async () => {
  const mine = await store();
  const other = await store();
  const context = await cartContext(mine.companyId);
  const response = await cartAction({ request: cartRequest({ intent: "continue", orderId: randomUUID(), lines: [{ variantId: other.black, quantity: 1 }] }), context } as never);
  expect(response).toMatchObject({ data: { code: "LINES_UNAVAILABLE" }, init: { status: 409 } });
  expect(await withTenantIsolation(mine.companyId, async () => await prisma.order.count())).toBe(0);
  expect(await withTenantIsolation(other.companyId, async () => await prisma.order.count())).toBe(0);
});

test("check_order answers confirmed only for this store's confirmed order", async () => {
  const mine = await store();
  const other = await store();
  const orderId = randomUUID() as OrderId;
  const created = await catalogCart.continueToCheckout({ orderId, lines: [line(mine.black, 1)] }, await storefrontOf(mine.companyId));
  if (!created.success) throw new Error(created.error.code);
  const check = async (companyId: CompanyId) => cartAction({ request: cartRequest({ intent: "check_order", orderId }), context: await cartContext(companyId) } as never);
  expect(await check(mine.companyId)).toMatchObject({ data: { order: "not_confirmed" }, init: { status: 200 } });
  const buyer = parseBuyer({ name: "Ana", phone: "+51987654321" });
  if (!buyer.success) throw new Error(buyer.error.code);
  expect(await orders.confirmCheckout({ buyer: buyer.data, expectedTotal: created.data.total }, { companyId: mine.companyId, orderId })).toMatchObject({ success: true });
  expect(await check(mine.companyId)).toMatchObject({ data: { order: "confirmed" } });
  expect(await check(other.companyId)).toMatchObject({ data: { order: "not_confirmed" } });
});

test("confirming company A's order on company B's published host goes through the middleware and answers «no disponible»", async () => {
  const mine = await store();
  const other = await store();
  const orderId = randomUUID() as OrderId;
  const created = await catalogCart.continueToCheckout({ orderId, lines: [line(mine.black, 1)] }, await storefrontOf(mine.companyId));
  if (!created.success) throw new Error(created.error.code);
  const context = new RouterContextProvider();
  context.set(requestHostContext, `${subdomainOf(other.companyId)}.localhost`);
  const params = { orderId };
  const form = new URLSearchParams({ name: "Ana", phone: "+51987654321", expectedTotal: JSON.stringify(created.data.total), delivery: JSON.stringify({ kind: "keep" }) });
  const request = new Request(`http://localhost/checkout/${orderId}`, { method: "POST", body: form });
  const answered = await storefrontMiddleware({ request, params, context } as never, async () => checkoutAction({ request, params, context } as never) as never);
  expect(answered).toMatchObject({ data: { unavailable: true }, init: { status: 404 } });
  // The page reads the order under the host's company: another company's order and an unknown id are the same «Enlace no disponible».
  for (const id of [orderId, randomUUID(), "not-a-uuid"]) {
    const read = await checkoutLoader({ params: { orderId: id }, context: hostContext(other.companyId), request } as unknown as LoaderFunctionArgs).catch((error) => error);
    expect(read).toMatchObject({ status: 404 });
    expect(await read.text()).toBe("Enlace no disponible");
  }
  const check = await cartAction({ request: cartRequest({ intent: "check_order", orderId }), context: await cartContext(mine.companyId) } as never);
  expect(check).toMatchObject({ data: { order: "not_confirmed" } });
});

test("Continuar answers the full checkout URL on the store's brand host", async () => {
  const { companyId, black } = await store();
  const orderId = randomUUID();
  const response = await cartAction({ request: cartRequest({ intent: "continue", orderId, lines: [{ variantId: black, quantity: 1 }] }), context: await cartContext(companyId) } as never);
  expect(response).toMatchObject({ data: { checkoutUrl: `http://${subdomainOf(companyId)}.localhost:3000/checkout/${orderId}` }, init: { status: 200 } });
});

test("buyer payment routes reject an unconfirmed catalog order, and the seller sees it only after confirmation", async () => {
  const { companyId, black } = await store();
  const orderId = randomUUID() as OrderId;
  const created = await catalogCart.continueToCheckout({ orderId, lines: [line(black, 2)] }, await storefrontOf(companyId));
  if (!created.success) throw new Error(created.error.code);
  expect(await buyerPayment(`${subdomainOf(companyId)}.localhost`, orderId)).toBe(404);
  const seller = { companyId, userId: randomUUID() as UserId };
  const listed = () => withTenantIsolation(companyId, () => orders.listAggregates({ page: 1, customer: { kind: "all" } }, seller));
  expect(await listed()).toMatchObject({ success: true, data: { items: [] } });
  const buyer = parseBuyer({ name: "Ana", phone: "+51987654321" });
  if (!buyer.success) throw new Error(buyer.error.code);
  expect(await orders.confirmCheckout({ buyer: buyer.data, expectedTotal: created.data.total }, { companyId, orderId }))
    .toMatchObject({ success: true });
  expect(await listed()).toMatchObject({ success: true, data: { items: [{ id: orderId, fromCatalog: true, sellerId: null }] } });
  expect(await buyerPayment(`${subdomainOf(companyId)}.localhost`, orderId)).toBe(200);
});

test("Continuar takes the current price and the checkout keeps working after the catalog is hidden", async () => {
  const { companyId, black } = await store();
  await withTenantIsolation(companyId, async () => await prisma.productVariant.update({ where: { id: black }, data: { salePrice: 50 } }));
  const orderId = randomUUID() as OrderId;
  const created = await catalogCart.continueToCheckout({ orderId, lines: [line(black, 2)] }, await storefrontOf(companyId));
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
  const catalog = await catalogLoader({ params: {}, context: await cartContext(companyId), request: new Request(`http://${subdomainOf(companyId)}.localhost/`) } as unknown as LoaderFunctionArgs);
  expect(catalog).toMatchObject({ data: { storeName: "Moda Lucía", appearance: { logoUrl: null, theme: "classic" }, items: [{ name: "Polo básico" }] } });

  const orderId = randomUUID() as OrderId;
  const created = await catalogCart.continueToCheckout({ orderId, lines: [line(black, 1)] }, await storefrontOf(companyId));
  expect(created).toMatchObject({ success: true, data: { id: orderId, fromCatalog: true } });

  const checkout = await checkoutLoader({ params: { orderId }, context: hostContext(companyId), request: new Request(`http://localhost/checkout/${orderId}`) } as unknown as LoaderFunctionArgs);
  if (!created.success) return;
  expect(checkout).toMatchObject({ data: { checkout: { number: created.data.number, companyName: "Moda Lucía", items: [{ productName: "Polo básico", quantity: 1 }] }, appearance: null } });
});
