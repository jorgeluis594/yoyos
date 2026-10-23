import { afterEach, expect, test, vi } from "vitest";
import { RouterContextProvider, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { err, ok } from "@shared/functional";
import { action, loader } from "@core/app/routes/catalog-cart";
import { catalogCart } from "@core/src/features/catalog/cart-composition";
import { clientIpContext } from "@core/app/client-ip-context";
import { storefrontContext, type StorefrontState } from "@core/app/storefront-context";
import { log } from "@core/src/shared/infrastructure/logger";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { VariantId } from "@core/src/features/products/domain/product";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const published: StorefrontState = { kind: "published", companyId: id(1) as never, subdomain: "fantasio" as never, store: { name: "Fantasio", currency: "PEN" } };
const cart = { intent: "continue", orderId: id(2), lines: [{ variantId: id(3), quantity: 2 }] };
const check = { intent: "check_order", orderId: id(2) };
const post = (body: unknown, ip = "203.0.113.7", state: StorefrontState | null = published) => {
  const context = new RouterContextProvider();
  context.set(clientIpContext, ip);
  if (state) context.set(storefrontContext, state);
  return { params: {}, context, request: new Request("http://fantasio.localhost:3000/carrito", { method: "POST", body: JSON.stringify(body) }) } as unknown as ActionFunctionArgs;
};
const get = (query: string, state: StorefrontState | null = published) => {
  const context = new RouterContextProvider();
  if (state) context.set(storefrontContext, state);
  return { params: {}, context, request: new Request(`http://fantasio.localhost:3000/carrito?${query}`) } as unknown as LoaderFunctionArgs;
};
afterEach(() => vi.restoreAllMocks());

test("Continuar answers the checkout url, line issues and the closed catalog without caching", async () => {
  const continueToCheckout = vi.spyOn(catalogCart, "continueToCheckout").mockResolvedValue(ok({ id: id(2) } as OrderAggregate));
  const created = await action(post(cart, "198.51.100.1"));
  expect(created).toMatchObject({ data: { checkoutUrl: expect.stringMatching(new RegExp(`/checkout/${id(1)}/${id(2)}$`)) }, init: { status: 200, headers: { "Cache-Control": "no-store" } } });
  expect(continueToCheckout).toHaveBeenCalledWith({ orderId: id(2), lines: cart.lines }, published);
  continueToCheckout.mockResolvedValue(err({ code: "LINES_UNAVAILABLE", message: "x", issues: [{ variantId: id(3) as VariantId, reason: "insufficient", available: 1 }] }));
  expect(await action(post(cart, "198.51.100.1"))).toMatchObject({ data: { code: "LINES_UNAVAILABLE", issues: [{ reason: "insufficient", available: 1 }] }, init: { status: 409 } });
  continueToCheckout.mockResolvedValue(err({ code: "CATALOG_UNAVAILABLE", message: "x" }));
  expect(await action(post(cart, "198.51.100.1"))).toMatchObject({ data: { code: "CATALOG_UNAVAILABLE" }, init: { status: 409 } });
  continueToCheckout.mockResolvedValue(err({ code: "PERSISTENCE_UNAVAILABLE", message: "x" }));
  expect(await action(post(cart, "198.51.100.1"))).toMatchObject({ init: { status: 503 } });
});

test("rejects carts over 99 units per line, repeated variants and more than 30 lines", async () => {
  const continueToCheckout = vi.spyOn(catalogCart, "continueToCheckout");
  for (const lines of [[{ variantId: id(3), quantity: 100 }], [{ variantId: id(3), quantity: 1 }, { variantId: id(3), quantity: 1 }],
    Array.from({ length: 31 }, (_, index) => ({ variantId: id(100 + index), quantity: 1 })), []])
    expect(await action(post({ intent: "continue", orderId: id(2), lines }, "198.51.100.2"))).toMatchObject({ data: { code: "INVALID_CART" }, init: { status: 400 } });
  expect(continueToCheckout).not.toHaveBeenCalled();
});

test("rejects a body over 16 KB before parsing it, with or without Content-Length", async () => {
  const continueToCheckout = vi.spyOn(catalogCart, "continueToCheckout");
  // Valid JSON once parsed, so only the size limit rejects it.
  const padded = post(cart, "198.51.100.3");
  padded.request = new Request(padded.request.url, { method: "POST", body: JSON.stringify(cart) + " ".repeat(20_000) });
  expect(await action(padded)).toMatchObject({ data: { code: "INVALID_CART" }, init: { status: 400 } });
  const declared = post(cart, "198.51.100.3");
  declared.request = new Request(declared.request.url, { method: "POST", headers: { "Content-Length": "50000000" }, body: JSON.stringify(cart) });
  expect(await action(declared)).toMatchObject({ data: { code: "INVALID_CART" }, init: { status: 400 } });
  expect(continueToCheckout).not.toHaveBeenCalled();
});

test("a 21st Continuar from one IP within 10 minutes returns 429", async () => {
  vi.spyOn(catalogCart, "continueToCheckout").mockResolvedValue(ok({ id: id(2) } as OrderAggregate));
  for (let attempt = 0; attempt < 20; attempt++) expect(await action(post(cart, "192.0.2.50"))).toMatchObject({ init: { status: 200 } });
  expect(await action(post(cart, "192.0.2.50"))).toMatchObject({ data: { code: "RATE_LIMITED" }, init: { status: 429 } });
  expect(await action(post(cart, "192.0.2.51"))).toMatchObject({ init: { status: 200 } });
});

test("the cart refresh returns current variants and the same unavailable answer for a hidden catalog or a malformed link", async () => {
  const refresh = vi.spyOn(catalogCart, "refresh").mockResolvedValue(ok([]));
  expect(await loader(get(`v=${id(3)},${id(4)}`))).toMatchObject({ data: { variants: [] }, init: { status: 200 } });
  expect(refresh).toHaveBeenCalledWith(published, [id(3), id(4)]);
  refresh.mockClear();
  expect(await loader(get(`v=${id(3)}`, { kind: "unavailable" }))).toMatchObject({ data: { code: "CATALOG_UNAVAILABLE" }, init: { status: 404 } });
  expect(await loader(get(`v=${id(3)}`, null))).toMatchObject({ data: { code: "CATALOG_UNAVAILABLE" }, init: { status: 404 } });
  expect(await loader(get(`v=${id(3)}`, { kind: "error" }))).toMatchObject({ data: { code: "SERVICE_UNAVAILABLE" }, init: { status: 503 } });
  expect(refresh).not.toHaveBeenCalled();
});

test("refresh, Continuar and check_order on a just-hidden or just-released host answer CATALOG_UNAVAILABLE as JSON", async () => {
  const continueToCheckout = vi.spyOn(catalogCart, "continueToCheckout");
  const checkOrder = vi.spyOn(catalogCart, "checkOrder");
  for (const state of [{ kind: "unavailable" }, null] as const) {
    expect(await action(post(cart, "198.51.100.20", state))).toMatchObject({ data: { code: "CATALOG_UNAVAILABLE" }, init: { status: 409, headers: { "Cache-Control": "no-store" } } });
    expect(await action(post(check, "198.51.100.20", state))).toMatchObject({ data: { code: "CATALOG_UNAVAILABLE" }, init: { status: 409 } });
  }
  expect(await action(post(check, "198.51.100.20", { kind: "error" }))).toMatchObject({ data: { code: "SERVICE_UNAVAILABLE" }, init: { status: 503 } });
  expect(continueToCheckout).not.toHaveBeenCalled();
  expect(checkOrder).not.toHaveBeenCalled();
});

test("check_order answers confirmed or not_confirmed for the store's order and 400 for a bad body", async () => {
  const checkOrder = vi.spyOn(catalogCart, "checkOrder").mockResolvedValue(ok("confirmed"));
  expect(await action(post(check, "198.51.100.21"))).toMatchObject({ data: { order: "confirmed" }, init: { status: 200, headers: { "Cache-Control": "no-store" } } });
  expect(checkOrder).toHaveBeenCalledWith(id(2), published);
  checkOrder.mockResolvedValue(ok("not_confirmed"));
  expect(await action(post(check, "198.51.100.21"))).toMatchObject({ data: { order: "not_confirmed" } });
  checkOrder.mockResolvedValue(err({ code: "PERSISTENCE_UNAVAILABLE", message: "down" }));
  expect(await action(post(check, "198.51.100.21"))).toMatchObject({ data: { code: "SERVICE_UNAVAILABLE" }, init: { status: 503 } });
  checkOrder.mockClear();
  for (const body of [{ intent: "check_order" }, { intent: "check_order", orderId: "no" }, { intent: "check_order", orderId: id(2), lines: [] }, { orderId: id(2) }, { intent: "other" }, null])
    expect(await action(post(body, "198.51.100.22"))).toMatchObject({ data: { code: "INVALID_CART" }, init: { status: 400 } });
  expect(checkOrder).not.toHaveBeenCalled();
});

test("check_order requests do not spend the Continuar budget and have their own 429 with one warn per window", async () => {
  vi.spyOn(catalogCart, "checkOrder").mockResolvedValue(ok("not_confirmed"));
  vi.spyOn(catalogCart, "continueToCheckout").mockResolvedValue(ok({ id: id(2) } as OrderAggregate));
  const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
  for (let attempt = 0; attempt < 120; attempt++) expect(await action(post(check, "192.0.2.80"))).toMatchObject({ init: { status: 200 } });
  expect(await action(post(check, "192.0.2.80"))).toMatchObject({ data: { code: "RATE_LIMITED" }, init: { status: 429 } });
  expect(await action(post(check, "192.0.2.80"))).toMatchObject({ init: { status: 429 } });
  expect(warn.mock.calls.filter(([fields]) => (fields as { event?: string }).event === "catalog_order_check_rate_limited")).toHaveLength(1);
  expect(await action(post(cart, "192.0.2.80"))).toMatchObject({ init: { status: 200 } });
  expect(await action(post(check, "192.0.2.81"))).toMatchObject({ init: { status: 200 } });
});

test("twenty-one check_order calls do not make Continuar answer 429", async () => {
  vi.spyOn(catalogCart, "checkOrder").mockResolvedValue(ok("not_confirmed"));
  vi.spyOn(catalogCart, "continueToCheckout").mockResolvedValue(ok({ id: id(2) } as OrderAggregate));
  for (let attempt = 0; attempt < 21; attempt++) await action(post(check, "192.0.2.90"));
  expect(await action(post(cart, "192.0.2.90"))).toMatchObject({ init: { status: 200 } });
});
