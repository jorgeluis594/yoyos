import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { action, handle, headers, loader } from "@core/app/routes/checkout";
import { orders } from "@core/src/features/orders/composition";
import { deliverySettings } from "@core/src/features/delivery-settings";
import { storeAppearance } from "@core/src/features/store-appearance/composition";
import { parseCompanyId } from "@core/src/features/store-appearance/domain/store-appearance";
import { bindRequestOperation, log } from "@core/src/shared/infrastructure/logger";
import { ok, err } from "@shared/functional";
import type { CheckoutPage } from "@core/src/features/orders/application/checkout";
import type { VariantId } from "@core/src/features/products/domain/product";
import type { CheckoutView, OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { PositiveInteger } from "@core/src/features/orders/domain/order";

vi.mock("@core/src/shared/infrastructure/logger", async (importOriginal) => ({
  ...await importOriginal<typeof import("@core/src/shared/infrastructure/logger")>(), bindRequestOperation: vi.fn(),
}));

vi.mock("@core/src/features/store-appearance/domain/store-appearance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@core/src/features/store-appearance/domain/store-appearance")>();
  return { ...actual, parseCompanyId: vi.fn(actual.parseCompanyId) };
});

const params = { companyId: "00000000-0000-4000-8000-000000000001", orderId: "00000000-0000-4000-8000-000000000002" };
const total = { amount: 10, currency: "PEN" as const };
const view: CheckoutView = { companyName: "Store", number: 1001 as OrderNumber, buyer: null, itemsTotal: total, total, delivery: null, deliveryCharge: { amount: 0, currency: "PEN" },
  items: [{ variantId: "00000000-0000-4000-8000-000000000004" as VariantId, productName: "Product", sku: null, variantAttributes: {}, quantity: 1 as PositiveInteger, unitPrice: total, subtotal: total }], state: { kind: "pending" } };
const page = (checkout: CheckoutView, photos: CheckoutPage["photos"] = new Map()): CheckoutPage => ({ checkout, photos });
const publicView = { ...view, items: [{ productName: "Product", sku: null, variantAttributes: {}, imageUrl: null, quantity: 1, unitPrice: total, subtotal: total }] };
const body = { buyer: { name: "Ana", phone: "+51987654321" }, expectedTotal: total, delivery: { kind: "keep" as const } };
const args = (payload: unknown, path = params) => ({ params: path, request: new Request("http://localhost/checkout/company/order", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
}) } as unknown as ActionFunctionArgs);
beforeEach(() => { vi.mocked(bindRequestOperation).mockClear(); vi.spyOn(storeAppearance, "getPublic").mockResolvedValue({ kind: "default" }); });
afterEach(() => vi.restoreAllMocks());

test("public loader preserves wire amounts and privacy headers without requiring an authenticated context", async () => {
  const settings = vi.spyOn(deliverySettings, "getCheckoutDeliveryOptions").mockResolvedValue(ok({ settings: { version: 0, home: { enabled: false }, agency: { enabled: false }, couriers: [], store: { enabled: false, pickupPoint: null } }, agencyCovered: false }));
  vi.spyOn(orders, "getCheckout").mockResolvedValue(ok(page(view)));
  expect(await loader({ params } as unknown as LoaderFunctionArgs)).toMatchObject({ data: { checkout: publicView }, init: { headers: headers() } });
  await expect(loader({ params: { companyId: "bad", orderId: "1001" } } as unknown as LoaderFunctionArgs)).rejects.toMatchObject({ status: 404 });
  vi.mocked(orders.getCheckout).mockResolvedValue(err({ code: "CHECKOUT_UNAVAILABLE", message: "not public" }));
  await expect(loader({ params } as unknown as LoaderFunctionArgs)).rejects.toMatchObject({ status: 404 });
  expect(settings).toHaveBeenCalledTimes(1);
});

test("projects each item's current photo URL and no variant id", async () => {
  const [first] = view.items;
  const second = { ...first, variantId: "00000000-0000-4000-8000-000000000005" as VariantId, productName: "Taza blanca" };
  vi.spyOn(deliverySettings, "getCheckoutDeliveryOptions").mockResolvedValue(ok({ settings: { version: 0, home: { enabled: false }, agency: { enabled: false }, couriers: [], store: { enabled: false, pickupPoint: null } }, agencyCovered: false }));
  vi.spyOn(orders, "getCheckout").mockResolvedValue(ok(page({ ...view, items: [first, second] }, new Map([[first.variantId, "https://cdn.example/polo.webp"]]))));
  const result = await loader({ params } as unknown as LoaderFunctionArgs) as unknown as { data: { checkout: { items: Record<string, unknown>[] } } };
  expect(result.data.checkout.items.map((item) => item.imageUrl)).toEqual(["https://cdn.example/polo.webp", null]);
  expect(JSON.stringify(result.data)).not.toContain("variantId");
});

test("loads the checkout with markers when the photos cannot be read", async () => {
  vi.spyOn(deliverySettings, "getCheckoutDeliveryOptions").mockResolvedValue(ok({ settings: { version: 0, home: { enabled: false }, agency: { enabled: false }, couriers: [], store: { enabled: false, pickupPoint: null } }, agencyCovered: false }));
  vi.spyOn(orders, "getCheckout").mockResolvedValue(ok(page(view, new Map())));
  expect(await loader({ params } as unknown as LoaderFunctionArgs)).toMatchObject({ data: { checkout: { items: [{ imageUrl: null }] } } });
});

test("public action rejects tampering and attaches field errors before calling the use case", async () => {
  const confirm = vi.spyOn(orders, "confirmCheckoutDelivery");
  expect(await action(args({ ...body, companyId: params.companyId }))).toMatchObject({ init: { status: 422 } });
  expect(await action(args({ ...body, buyer: { name: " ", phone: "invalid" } }))).toMatchObject({
    data: { fieldErrors: { name: expect.any(String), phone: expect.any(String) } }, init: { status: 422 },
  });
  expect(await action(args(body, { ...params, orderId: "bad" }))).toMatchObject({ data: { unavailable: true }, init: { status: 404 } });
  expect(confirm).not.toHaveBeenCalled();
});

test("total conflict returns the current checkout and requires another explicit confirmation", async () => {
  const confirm = vi.spyOn(orders, "confirmCheckoutDelivery").mockResolvedValue(err({ code: "TOTAL_CHANGED", message: "changed" }));
  vi.spyOn(orders, "getCheckout").mockResolvedValue(ok(page({ ...view, total: { ...total, amount: 12 } })));
  expect(await action(args(body))).toMatchObject({ data: { checkout: { total: { amount: 12 } }, message: expect.stringContaining("vuelve a confirmar") }, init: { status: 409 } });
  expect(confirm).toHaveBeenCalledTimes(1);
});

test("confirmation requires an explicit delivery choice for JSON and form requests", async () => {
  const confirm = vi.spyOn(orders, "confirmCheckoutDelivery");
  const withoutDelivery = { buyer: body.buyer, expectedTotal: body.expectedTotal };
  expect(await action(args(withoutDelivery))).toMatchObject({ init: { status: 422 } });
  const fields = new URLSearchParams({ ...body.buyer, expectedTotal: JSON.stringify(total) });
  const request = new Request("http://localhost/checkout/company/order", { method: "POST", body: fields });
  expect(await action({ params, request } as unknown as ActionFunctionArgs)).toMatchObject({ init: { status: 422 } });
  expect(confirm).not.toHaveBeenCalled();
});

test("cancelled, unavailable and technical failures never return false confirmation", async () => {
  const confirm = vi.spyOn(orders, "confirmCheckoutDelivery").mockResolvedValue(err({ code: "ORDER_CANCELLED", message: "cancelled" }));
  vi.spyOn(orders, "getCheckout").mockResolvedValue(ok(page({ ...view, state: { kind: "cancelled" } })));
  expect(await action(args(body))).toMatchObject({ data: { checkout: { state: { kind: "cancelled" } } }, init: { status: 409 } });
  confirm.mockResolvedValue(err({ code: "PERSISTENCE_UNAVAILABLE", message: "private cause" }));
  const error = vi.spyOn(log, "error").mockImplementation(() => undefined);
  expect(await action(args(body))).toMatchObject({ data: { checkout: null }, init: { status: 503 } });
  expect(error).not.toHaveBeenCalled();
  confirm.mockRejectedValue(new Error("private cause"));
  expect(await action(args(body))).toMatchObject({ data: { checkout: null }, init: { status: 503 } });
  expect(error).toHaveBeenCalledTimes(1);
});

test("delivery confirmation constructs domain selection and redirects to payment only on success", async () => {
  const confirm = vi.spyOn(orders, "confirmCheckoutDelivery").mockResolvedValue(ok(view));
  const delivery = { kind: "replace", selection: { method: "store", recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } } }, expectedPrice: { amount: 0, currency: "PEN" } };
  const result = await action(args({ ...body, delivery }));
  expect(result).toBeInstanceOf(Response);
  expect((result as Response).headers.get("Location")).toBe(`/checkout/${params.companyId}/${params.orderId}`);
  expect((result as Response).headers.get("Cache-Control")).toBe("no-store");
  expect(confirm).toHaveBeenCalledWith({ ...body, delivery: { ...delivery, selection: { ...delivery.selection, recipient: { ...delivery.selection.recipient, phone: body.buyer.phone } } } }, params);
});

describe("recipient rule", () => {
  const recipient = (name: string, phone: string, identity: unknown = { kind: "absent" }) => ({ name, phone, identity });
  const rateId = "00000000-0000-4000-8000-000000000010";
  const selections = (who: ReturnType<typeof recipient>) => ({
    home: { method: "home", rateId, recipient: who, destination: { districtCode: "150101", address: "Av. Lima 123", instructions: null } },
    agency: { method: "agency", rateId, recipient: recipient(who.name, who.phone, { kind: "document", documentType: "national_id", document: "12345678" }), districtCode: "150101", agencyId: "00000000-0000-4000-8000-000000000011" },
    store: { method: "store", recipient: who },
  });
  const submit = (selection: unknown, extra: Record<string, unknown> = {}) =>
    action(args({ ...body, ...extra, delivery: { kind: "replace", selection, expectedPrice: { amount: 5, currency: "PEN" } } }));

  test.each(["home", "agency", "store"] as const)("saves the buyer as the %s recipient when nobody else receives, ignoring the recipient fields sent", async (method) => {
    const confirm = vi.spyOn(orders, "confirmCheckoutDelivery").mockResolvedValue(ok(view));
    expect(await submit(selections(recipient("Tampered", "+51900000000"))[method], { otherRecipient: false })).toBeInstanceOf(Response);
    const sent = confirm.mock.calls[0][0].delivery;
    expect(sent).toMatchObject({ kind: "replace", selection: { method, recipient: { name: "Ana", phone: "+51987654321" } } });
  });

  test("treats an absent flag as nobody else receiving", async () => {
    const confirm = vi.spyOn(orders, "confirmCheckoutDelivery").mockResolvedValue(ok(view));
    await submit(selections(recipient("Tampered", "+51900000000")).home);
    expect(confirm.mock.calls[0][0].delivery).toMatchObject({ selection: { recipient: { name: "Ana", phone: "+51987654321" } } });
  });

  test("keeps the document of the agency recipient when the buyer is the recipient", async () => {
    const confirm = vi.spyOn(orders, "confirmCheckoutDelivery").mockResolvedValue(ok(view));
    await submit(selections(recipient("x", "y")).agency, { otherRecipient: false });
    expect(confirm.mock.calls[0][0].delivery).toMatchObject({ selection: { recipient: { identity: { kind: "document", document: "12345678" } } } });
  });

  test.each(["home", "agency", "store"] as const)("saves another %s recipient and leaves the buyer unchanged when the flag is set", async (method) => {
    const confirm = vi.spyOn(orders, "confirmCheckoutDelivery").mockResolvedValue(ok(view));
    expect(await submit(selections(recipient("Luis", "+14155552671"))[method], { otherRecipient: true })).toBeInstanceOf(Response);
    const call = confirm.mock.calls[0][0];
    expect(call.buyer).toEqual(body.buyer);
    expect(call.delivery).toMatchObject({ selection: { method, recipient: { name: "Luis", phone: "+14155552671" } } });
  });

  test("requires a valid international recipient phone when someone else receives and answers in place", async () => {
    const confirm = vi.spyOn(orders, "confirmCheckoutDelivery");
    const result = await submit(selections(recipient("Luis", "999")).home, { otherRecipient: true });
    expect(result).toMatchObject({ init: { status: 422 }, data: { fieldErrors: { recipientPhone: expect.any(String) } } });
    expect(confirm).not.toHaveBeenCalled();
  });

  test("requires the recipient name and phone together when someone else receives", async () => {
    const confirm = vi.spyOn(orders, "confirmCheckoutDelivery");
    expect(await submit(selections(recipient(" ", "999")).home, { otherRecipient: true }))
      .toMatchObject({ init: { status: 422 }, data: { fieldErrors: { recipientName: "Ingresa el nombre de quien recibe.", recipientPhone: expect.any(String) } } });
    expect(await submit(selections(recipient(" ", "+14155552671")).home, { otherRecipient: true })).toMatchObject({ init: { status: 422 }, data: { fieldErrors: { recipientName: expect.any(String) } } });
    expect(confirm).not.toHaveBeenCalled();
  });

  test("ignores empty or invalid recipient fields entirely when nobody else receives", async () => {
    const confirm = vi.spyOn(orders, "confirmCheckoutDelivery").mockResolvedValue(ok(view));
    expect(await submit(selections(recipient("", "")).home, { otherRecipient: false })).toBeInstanceOf(Response);
    expect(confirm.mock.calls[0][0].delivery).toMatchObject({ selection: { recipient: { name: "Ana", phone: "+51987654321" } } });
  });

  test("a kept delivery goes to the buyer when nobody else receives, whatever recipient the client sent", async () => {
    const confirm = vi.spyOn(orders, "confirmCheckoutDelivery").mockResolvedValue(ok(view));
    await action(args({ ...body, otherRecipient: false, delivery: { kind: "keep", recipient: { name: "Tampered", phone: "+51900000000" } } }));
    expect(confirm.mock.calls[0][0].delivery).toEqual({ kind: "keep", recipient: { name: "Ana", phone: "+51987654321" } });
  });

  test("a kept delivery goes to the person named when someone else receives, and needs a valid one", async () => {
    const confirm = vi.spyOn(orders, "confirmCheckoutDelivery").mockResolvedValue(ok(view));
    await action(args({ ...body, otherRecipient: true, delivery: { kind: "keep", recipient: { name: "Luis", phone: "+14155552671" } } }));
    expect(confirm.mock.calls[0][0].delivery).toEqual({ kind: "keep", recipient: { name: "Luis", phone: "+14155552671" } });
    confirm.mockClear();
    expect(await action(args({ ...body, otherRecipient: true, delivery: { kind: "keep" } })))
      .toMatchObject({ init: { status: 422 }, data: { fieldErrors: { recipientName: expect.any(String), recipientPhone: expect.any(String) } } });
    expect(confirm).not.toHaveBeenCalled();
  });
});

test("delivery price conflict preserves current checkout and returns the price for explicit reconfirmation", async () => {
  vi.spyOn(orders, "confirmCheckoutDelivery").mockResolvedValue(err({ code: "TOTAL_CHANGED", message: "Private reason", currentPrice: { amount: 12, currency: "PEN" } }));
  vi.spyOn(orders, "getCheckout").mockResolvedValue(ok(page(view)));
  expect(await action(args({ ...body, delivery: { kind: "keep" } }))).toMatchObject({ init: { status: 409 },
    data: { checkout: publicView, code: "TOTAL_CHANGED", currentPrice: { amount: 12, currency: "PEN" }, message: expect.stringContaining("vuelve a confirmar") } });
});

test("delivery business failures do not redirect or falsely confirm", async () => {
  const confirm = vi.spyOn(orders, "confirmCheckoutDelivery");
  for (const error of [{ code: "RATE_UNAVAILABLE", message: "Private reason" }, { code: "INVALID_DISTRICT", message: "Private reason" },
    { code: "DELIVERY_METHOD_DISABLED", message: "Private reason" }] as const) {
    const code = error.code;
    confirm.mockResolvedValue(err(error));
    expect(await action(args({ ...body, delivery: { kind: "keep" } }))).toMatchObject({ init: { status: 422 }, data: { checkout: null, code } });
  }
  confirm.mockResolvedValue(err({ code: "INSUFFICIENT_STOCK", message: "Private reason" }));
  expect(await action(args({ ...body, delivery: { kind: "keep" } }))).toMatchObject({ init: { status: 409 }, data: { checkout: null } });
});

test("delivery form accepts exactly four fields and rejects repeated delivery values", async () => {
  vi.spyOn(orders, "confirmCheckoutDelivery").mockResolvedValue(ok(view));
  const fields = new URLSearchParams({ ...body.buyer, expectedTotal: JSON.stringify(total), delivery: JSON.stringify({ kind: "keep" }) });
  const request = () => new Request("http://localhost/checkout/company/order", { method: "POST", body: fields });
  expect(await action({ params, request: request() } as unknown as ActionFunctionArgs)).toBeInstanceOf(Response);
  fields.append("delivery", JSON.stringify({ kind: "keep" }));
  expect(await action({ params, request: request() } as unknown as ActionFunctionArgs)).toMatchObject({ init: { status: 422 } });
});

test("public checkout exposes current pickup configuration without courier names or seller identity", async () => {
  vi.spyOn(orders, "getCheckout").mockResolvedValue(ok(page(view)));
  vi.spyOn(deliverySettings, "getCheckoutDeliveryOptions").mockResolvedValue(ok({ settings: { version: 7, home: { enabled: true }, agency: { enabled: false }, couriers: [],
    store: { enabled: true, pickupPoint: { name: "Shop", address: "Pickup address", instructions: "Door 2" } } }, agencyCovered: false }));
  const result = await loader({ params } as unknown as LoaderFunctionArgs);
  expect(result.data.deliveryOptions).toEqual({ home: { enabled: true }, agency: { enabled: false, covered: false },
    store: { enabled: true, pickupPoint: { name: "Shop", address: "Pickup address", instructions: "Door 2" } } });
  expect(result.data.deliveryOptions).not.toHaveProperty("version");
  expect(result.data.deliveryOptions).not.toHaveProperty("couriers");
});

test("public loader exposes agency coverage only as a yes or no flag", async () => {
  vi.spyOn(orders, "getCheckout").mockResolvedValue(ok(page(view)));
  vi.spyOn(deliverySettings, "getCheckoutDeliveryOptions").mockResolvedValue(ok({ settings: { version: 7, home: { enabled: false }, agency: { enabled: true },
    couriers: [{ id: "private" }] as never, store: { enabled: false, pickupPoint: null } }, agencyCovered: true }));
  const result = await loader({ params } as unknown as LoaderFunctionArgs);
  expect(result.data.deliveryOptions).toEqual({ home: { enabled: false }, agency: { enabled: true, covered: true }, store: { enabled: false, pickupPoint: null } });
  expect(JSON.stringify(result.data.deliveryOptions)).not.toMatch(/zone|district|courier|agencies/i);
});

test("public loader reports no agency coverage when the switch is on but no option has eligible agencies", async () => {
  vi.spyOn(orders, "getCheckout").mockResolvedValue(ok(page(view)));
  vi.spyOn(deliverySettings, "getCheckoutDeliveryOptions").mockResolvedValue(ok({ settings: { version: 7, home: { enabled: false }, agency: { enabled: true },
    couriers: [], store: { enabled: false, pickupPoint: null } }, agencyCovered: false }));
  expect((await loader({ params } as unknown as LoaderFunctionArgs)).data.deliveryOptions?.agency).toEqual({ enabled: true, covered: false });
});

test("failed coverage read answers 503 without manufacturing delivery options", async () => {
  vi.spyOn(orders, "getCheckout").mockResolvedValue(ok(page(view)));
  vi.spyOn(deliverySettings, "getCheckoutDeliveryOptions").mockResolvedValue(err({ code: "SERVICE_UNAVAILABLE", message: "Private detail" }));
  const failure = await loader({ params } as unknown as LoaderFunctionArgs).catch(error => error);
  expect(failure).toMatchObject({ status: 503 });
  expect(vi.mocked(bindRequestOperation)).toHaveBeenCalledWith({ outcome: "technical_failure" });
});

test("failed current configuration does not manufacture free shipping or enabled pickup", async () => {
  vi.spyOn(orders, "getCheckout").mockResolvedValue(ok(page(view)));
  vi.spyOn(deliverySettings, "getCheckoutDeliveryOptions").mockResolvedValue(err({ code: "SERVICE_UNAVAILABLE", message: "Private detail" }));
  await expect(loader({ params } as unknown as LoaderFunctionArgs)).rejects.toMatchObject({ status: 503 });
});

const paymentView = { orderId: params.orderId, total, deliveryCharge: { amount: 0, currency: "PEN" as const }, availability: "available" as const,
  paidAmount: { amount: 0, currency: "PEN" as const }, balanceDue: total, paymentStatus: "pending" as const, settings: [], payments: [] };
const confirmed = ok(page({ ...view, buyer: body.buyer, state: { kind: "confirmed" as const, confirmedAt: new Date("2026-10-05T00:00:00Z") } }));

test("confirmed checkout keeps its saved summary and loads the payment view without requiring current delivery settings", async () => {
  vi.spyOn(orders, "getCheckout").mockResolvedValue(confirmed);
  const payment = vi.spyOn(orders, "getBuyerPaymentView").mockResolvedValue(ok(paymentView));
  const settings = vi.spyOn(deliverySettings, "getCheckoutDeliveryOptions");
  expect(await loader({ params } as unknown as LoaderFunctionArgs)).toMatchObject({
    data: { checkout: { total, state: { kind: "confirmed" } }, payment: paymentView }, init: { headers: headers() } });
  expect(payment).toHaveBeenCalledWith(params.orderId);
  expect(settings).not.toHaveBeenCalled();
});

test("confirmed checkout logs and answers 503 when the payment view cannot be loaded", async () => {
  const error = vi.spyOn(log, "error").mockImplementation(() => undefined);
  vi.spyOn(orders, "getCheckout").mockResolvedValue(confirmed);
  vi.spyOn(orders, "getBuyerPaymentView").mockResolvedValue(err({ code: "PERSISTENCE_UNAVAILABLE", message: "Database down" }));
  await expect(loader({ params } as unknown as LoaderFunctionArgs)).rejects.toMatchObject({ status: 503 });
  expect(error).toHaveBeenCalledWith(expect.objectContaining({ event: "order_checkout_payment_unavailable", errorCode: "PERSISTENCE_UNAVAILABLE" }), expect.any(String));
});

test("confirmed checkout logs and answers 503 for an invalid payment view", async () => {
  const error = vi.spyOn(log, "error").mockImplementation(() => undefined);
  vi.spyOn(orders, "getCheckout").mockResolvedValue(confirmed);
  vi.spyOn(orders, "getBuyerPaymentView").mockResolvedValue(ok({ ...paymentView, orderId: "bad" }));
  await expect(loader({ params } as unknown as LoaderFunctionArgs)).rejects.toMatchObject({ status: 503 });
  expect(error).toHaveBeenCalledWith(expect.objectContaining({ event: "order_checkout_data_invalid" }), expect.any(String));
});

describe("checkout appearance", () => {
  const custom = { logoUrl: "https://images.example.test/logo.png", theme: "boutique" as const };
  const pendingSettings = () => vi.spyOn(deliverySettings, "getCheckoutDeliveryOptions").mockResolvedValue(ok({ settings: { version: 0, home: { enabled: false }, agency: { enabled: false }, couriers: [], store: { enabled: false, pickupPoint: null } }, agencyCovered: false }));
  const load = () => loader({ params } as unknown as LoaderFunctionArgs);

  test("includes the company appearance after authorizing the order", async () => {
    pendingSettings();
    vi.spyOn(orders, "getCheckout").mockResolvedValue(ok(page(view)));
    const getPublic = vi.mocked(storeAppearance.getPublic).mockResolvedValue({ kind: "custom", appearance: custom });
    expect(await load()).toMatchObject({ data: { appearance: custom } });
    expect(getPublic).toHaveBeenCalledWith(params.companyId);
  });

  test("exposes only the logo URL and the theme", async () => {
    pendingSettings();
    const error = vi.spyOn(log, "error").mockImplementation(() => undefined);
    vi.spyOn(orders, "getCheckout").mockResolvedValue(ok(page(view)));
    vi.mocked(storeAppearance.getPublic).mockResolvedValue({ kind: "custom", appearance: { ...custom, logoImageId: "private" } as never });
    expect(await load()).toMatchObject({ data: { appearance: null } });
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ event: "order_checkout_data_invalid", errorCode: "INVALID_APPEARANCE_RESPONSE" }), expect.any(String));
    expect(bindRequestOperation).toHaveBeenCalledWith({ storeAppearance: "fallback", storeTheme: "classic" });
  });

  test("logs and falls back when the company id cannot be parsed", async () => {
    pendingSettings();
    const error = vi.spyOn(log, "error").mockImplementation(() => undefined);
    vi.spyOn(orders, "getCheckout").mockResolvedValue(ok(page(view)));
    vi.mocked(parseCompanyId).mockReturnValueOnce(err({ code: "INVALID_STORE_APPEARANCE", message: "Invalid company id", invalidFields: ["companyId"] }));
    expect(await load()).toMatchObject({ data: { checkout: publicView, appearance: null } });
    expect(storeAppearance.getPublic).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ event: "order_store_appearance_failed", errorCode: "INVALID_STORE_APPEARANCE" }), expect.any(String));
    expect(bindRequestOperation).toHaveBeenCalledWith({ storeAppearance: "fallback", storeTheme: "classic" });
  });

  test("does not read the appearance for an unauthorized link", async () => {
    vi.spyOn(orders, "getCheckout").mockResolvedValue(err({ code: "CHECKOUT_UNAVAILABLE", message: "not public" }));
    await expect(load()).rejects.toMatchObject({ status: 404 });
    await expect(loader({ params: { companyId: "bad", orderId: "1001" } } as unknown as LoaderFunctionArgs)).rejects.toMatchObject({ status: 404 });
    expect(storeAppearance.getPublic).not.toHaveBeenCalled();
  });

  test("uses the default appearance when the company has none", async () => {
    pendingSettings();
    vi.spyOn(orders, "getCheckout").mockResolvedValue(ok(page(view)));
    expect(await load()).toMatchObject({ data: { appearance: null } });
  });

  test("uses the default appearance and still loads the order when reading it fails", async () => {
    pendingSettings();
    const error = vi.spyOn(log, "error").mockImplementation(() => undefined);
    vi.spyOn(orders, "getCheckout").mockResolvedValue(ok(page(view)));
    vi.mocked(storeAppearance.getPublic).mockResolvedValue({ kind: "fallback" });
    expect(await load()).toMatchObject({ data: { checkout: publicView, appearance: null } });
    vi.mocked(storeAppearance.getPublic).mockRejectedValue(new Error("private cause"));
    expect(await load()).toMatchObject({ data: { checkout: publicView, appearance: null } });
    expect(error).toHaveBeenCalledTimes(1);
  });

  test("brands the confirmed state and loads the payment in parallel with the appearance", async () => {
    vi.spyOn(orders, "getCheckout").mockResolvedValue(confirmed);
    vi.spyOn(orders, "getBuyerPaymentView").mockResolvedValue(ok(paymentView));
    vi.mocked(storeAppearance.getPublic).mockResolvedValue({ kind: "custom", appearance: custom });
    const result = await load();
    expect(result).toMatchObject({ data: { appearance: custom, payment: paymentView } });
    expect(orders.getBuyerPaymentView).toHaveBeenCalledTimes(1);
  });

  test("tags the request with default, custom or fallback appearance", async () => {
    pendingSettings();
    vi.spyOn(orders, "getCheckout").mockResolvedValue(ok(page(view)));
    const tagged = async (result: Awaited<ReturnType<typeof storeAppearance.getPublic>>) => {
      vi.mocked(storeAppearance.getPublic).mockResolvedValue(result);
      vi.mocked(bindRequestOperation).mockClear();
      await load();
      return vi.mocked(bindRequestOperation).mock.calls.flatMap(([fields]) => fields.storeAppearance ?? []);
    };
    expect(await tagged({ kind: "default" })).toEqual(["default"]);
    expect(await tagged({ kind: "custom", appearance: custom })).toEqual(["custom"]);
    expect(await tagged({ kind: "fallback" })).toEqual(["fallback"]);
  });
});

describe("checkout theme tag and color scheme", () => {
  test("tags the request with the checkout theme", async () => {
    vi.spyOn(deliverySettings, "getCheckoutDeliveryOptions").mockResolvedValue(ok({ settings: { version: 0, home: { enabled: false }, agency: { enabled: false }, couriers: [], store: { enabled: false, pickupPoint: null } }, agencyCovered: false }));
    vi.spyOn(orders, "getCheckout").mockResolvedValue(ok(page(view)));
    const tagged = async (result: Awaited<ReturnType<typeof storeAppearance.getPublic>>) => {
      vi.mocked(storeAppearance.getPublic).mockResolvedValue(result);
      vi.mocked(bindRequestOperation).mockClear();
      await loader({ params } as unknown as LoaderFunctionArgs);
      return vi.mocked(bindRequestOperation).mock.calls.flatMap(([fields]) => fields.storeTheme ?? []);
    };
    expect(await tagged({ kind: "custom", appearance: { logoUrl: null, theme: "noche" } })).toEqual(["noche"]);
    expect(await tagged({ kind: "default" })).toEqual(["classic"]);
    expect(await tagged({ kind: "fallback" })).toEqual(["classic"]);
  });

  test("renders a fixed scheme only when the loader produced a checkout", () => {
    expect(handle.colorScheme({ checkout: publicView, message: null })).toBe("fixed");
    expect(handle.colorScheme(undefined)).toBe("system");
    expect(handle.colorScheme({ checkout: null, message: "x" })).toBe("system");
  });
});
