import { readFileSync } from "node:fs";
import { createOrderApi } from "@mobile/features/orders/infrastructure/order-api";
import { ok, err } from "@shared/functional";
import { randomUUID } from "node:crypto";
import { browserExpect, expect, prepareVerifiedCompany, test } from "@core/tests/e2e/fixtures";
import { products } from "@core/src/features/products/composition";
import { deliverySettings } from "@core/src/features/delivery-settings";
import { orders } from "@core/src/features/orders/composition";
import { parseRatedDeliverySelection } from "@core/src/features/orders/domain/order-state-machine";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import type { CompanyId, ContactId, OrderId, PaymentId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";

function requestLogs(requestId: string) {
  return readFileSync("test-results/server.jsonl", "utf8").trim().split("\n")
    .flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } })
    .filter((event) => event.requestId === requestId);
}

async function fixture(prefill: "none" | "phone" | "full" = "none", enabled = true, assigned = true) {
  const companyId = randomUUID() as CompanyId;
  const userId = randomUUID() as UserId;
  const orderId = randomUUID() as OrderId;
  const contactId = randomUUID() as ContactId;
  await withTenantIsolation(companyId, async () => {
    await prisma.company.create({ data: { id: companyId, name: "Tienda del checkout", country: "PE" } });
    await systemPrisma.user.create({ data: { id: userId, name: "Seller", email: `${userId}@example.test`, companyId } });
    const product = await products.create({ name: "Cuaderno", currency: "PEN", variants: [{ attributes: { Color: "Azul" }, salePrice: 10, initialStock: 3 }] });
    if (!product.success) throw new Error("Product fixture failed");
    const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: product.data } });
    if (prefill !== "none") await prisma.contact.create({ data: { id: contactId, name: prefill === "full" ? "Anterior" : null, phone: "+51987654321" } });
    const created = await orders.create({ id: orderId, contactId: prefill === "none" ? null : contactId, items: [{ variantId: variant.id as VariantId, quantity: 1 as PositiveInteger }] }, { companyId, userId });
    if (!created.success) throw new Error("Order fixture failed");
    if (assigned) await prisma.order.update({ where: { id: orderId }, data: { delivery: { method: "home",
      recipient: { name: "Recipient", phone: "999", identity: { kind: "absent" } }, destination: { address: "Historical address", district: "Lima", instructions: null },
      recordedBy: { kind: "seller", userId } } } });
    if (enabled) expect(await orders.enableCheckout(orderId, { companyId, userId })).toMatchObject({ success: true });
  });
  return { companyId, userId, orderId, path: `/checkout/${companyId}/${orderId}`,
    read: () => withTenantIsolation(companyId, async () => await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { buyer: true, payments: true } })),
    cancel: () => withTenantIsolation(companyId, () => orders.cancel(orderId, { companyId, userId })),
    async cleanup() {
      await withTenantIsolation(companyId, async () => {
        await prisma.payment.deleteMany(); await prisma.orderItem.deleteMany(); await prisma.order.deleteMany();
        await prisma.contact.deleteMany(); await prisma.productStock.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.product.deleteMany();
        await prisma.deliveryRate.deleteMany(); await prisma.quotation.deleteMany(); await prisma.deliveryZoneDistrict.deleteMany();
        await prisma.deliveryZone.deleteMany(); await prisma.companyCourier.deleteMany(); await prisma.companyDeliverySettings.deleteMany();
        await systemPrisma.user.delete({ where: { id: userId } }); await prisma.company.delete({ where: { id: companyId } });
      });
    },
  };
}

test("anonymous mobile buyer reviews fixed products, corrects prefilled data and confirms once", async ({ page }) => {
  const f = await fixture("phone");
  const requestId = `checkout-${randomUUID()}`;
  await page.setExtraHTTPHeaders({ "x-request-id": requestId });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    const response = await page.goto(f.path);
    expect(response?.headers()["cache-control"]).toBe("no-store");
    expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
    await browserExpect(page.getByRole("heading", { name: "Pedido #1001" })).toBeVisible();
    await browserExpect(page.getByLabel("Nombre", { exact: true })).toHaveValue("");
    await browserExpect(page.getByLabel("Teléfono", { exact: true })).toHaveValue("+51987654321");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await browserExpect(page.getByText("Cuaderno", { exact: true })).toBeVisible();
    await page.getByLabel("Teléfono", { exact: true }).fill("invalid");
    await page.getByRole("button", { name: "Confirmar pedido", exact: true }).click();
    await browserExpect(page.getByText("Ingresa tu nombre.")).toBeVisible();
    await browserExpect(page.locator("#phone-error")).toBeVisible();
    await page.getByLabel("Nombre", { exact: true }).fill("Ana");
    await page.getByLabel("Teléfono", { exact: true }).fill("+14155552671");
    await page.getByRole("button", { name: "Confirmar pedido", exact: true }).click();
    await browserExpect(page.getByRole("heading", { name: "Pago del pedido", exact: true })).toBeVisible();
    await browserExpect(page.getByRole("textbox")).toHaveCount(0);
    await expect.poll(() => requestLogs(requestId).some((event) => event.event === "http_request_completed" && event.method === "POST" && event.outcome === "confirmed")).toBe(true);
    const logs = requestLogs(requestId);
    expect(logs.filter((event) => event.event === "order_checkout_confirmed")).toEqual([
      expect.objectContaining({ requestId, companyId: f.companyId, orderNumber: 1001, operation: "confirm_checkout" }),
    ]);
    for (const secret of [f.orderId, "+14155552671", "Tienda del checkout"]) expect(JSON.stringify(logs)).not.toContain(secret);
    const stored = await f.read();
    expect(stored.buyer).toMatchObject({ name: "Ana", phone: "+14155552671" });
    expect(stored.payments).toEqual([]);
    expect(stored.stockDeducted).toBe(false);
    await page.goto(f.path);
    await browserExpect(page.getByRole("heading", { name: "Pedido confirmado", exact: true })).toBeVisible();
    const replay = await page.request.post(f.path, { maxRedirects: 0, data: { delivery: { kind: "keep" }, buyer: { name: "Replacement", phone: "+51999999999" }, expectedTotal: { amount: 1, currency: "USD" } } });
    expect(replay.status()).toBe(302);
    expect(replay.headers().location).toBe(f.path);
    expect(await f.read()).toEqual(stored);
    expect(await withTenantIsolation(f.companyId, async () => (await prisma.contact.findFirstOrThrow()).name)).toBeNull();
    await f.cancel();
    await page.goto(f.path);
    await browserExpect(page.getByRole("heading", { name: "Pedido cancelado", exact: true })).toBeVisible();
  } finally { await f.cleanup(); }
});

test("changed total preserves buyer input and needs an explicit new confirmation", async ({ page }) => {
  const f = await fixture();
  const requestId = `checkout-${randomUUID()}`;
  await page.setExtraHTTPHeaders({ "x-request-id": requestId });
  try {
    await page.goto(f.path);
    await page.getByLabel("Nombre", { exact: true }).fill("Ana");
    await page.getByLabel("Teléfono", { exact: true }).fill("+51987654321");
    await withTenantIsolation(f.companyId, async () => {
      await prisma.order.update({ where: { id: f.orderId }, data: { total: 12, deliveryCost: 2, deliveryCharge: 2,
        delivery: { method: "home", recipient: { name: "Recipient", phone: "999", identity: { kind: "absent" } }, destination: { address: "Address", district: "Lima", instructions: null }, recordedBy: { kind: "seller", userId: f.userId } } } });
    });
    await page.getByRole("button", { name: "Confirmar pedido", exact: true }).click();
    await browserExpect(page.getByRole("alert")).toContainText("El total cambió");
    await browserExpect(page.getByLabel("Nombre", { exact: true })).toHaveValue("Ana");
    await browserExpect(page.getByLabel("Teléfono", { exact: true })).toHaveValue("+51987654321");
    await browserExpect(page.getByText("S/ 12.00", { exact: true })).toBeVisible();
    expect((await f.read()).checkoutConfirmedAt).toBeNull();
    await page.getByRole("button", { name: "Confirmar pedido", exact: true }).click();
    await browserExpect(page.getByRole("heading", { name: "Pago del pedido", exact: true })).toBeVisible();
    expect((await f.read()).total.toNumber()).toBe(12);
    await expect.poll(() => requestLogs(requestId).filter((event) => event.event === "http_request_completed" && event.method === "POST").map((event) => event.outcome))
      .toEqual(["total_changed", "confirmed"]);
    expect(requestLogs(requestId).filter((event) => event.event === "order_checkout_confirmed")).toHaveLength(1);
    expect(JSON.stringify(requestLogs(requestId))).not.toContain(f.orderId);
  } finally { await f.cleanup(); }
});

test("public links hide unavailable orders and show cancellation received during submission", async ({ page }) => {
  const f = await fixture("full");
  const disabled = await fixture("none", false);
  try {
    for (const path of ["/checkout/bad", "/checkout/bad/1001", `/checkout/${randomUUID()}/${f.orderId}`, disabled.path]) {
      expect((await page.goto(path))?.status()).toBe(404);
      await browserExpect(page.getByRole("heading", { name: "Enlace no disponible" })).toBeVisible();
      await browserExpect(page.getByText("Cuaderno")).toHaveCount(0);
    }
    await page.goto(f.path);
    await browserExpect(page.getByLabel("Nombre", { exact: true })).toHaveValue("Anterior");
    await f.cancel();
    await page.getByRole("button", { name: "Confirmar pedido", exact: true }).click();
    await browserExpect(page.getByRole("heading", { name: "Pedido cancelado", exact: true })).toBeVisible();
    await browserExpect(page.getByRole("button", { name: "Confirmar pedido", exact: true })).toHaveCount(0);
    expect((await f.read()).checkoutConfirmedAt).toBeNull();
  } finally { await f.cleanup(); await disabled.cleanup(); }
});

test("failed network requests recover pending orders and lost responses recover committed confirmations", async ({ page }) => {
  const f = await fixture();
  const requestId = `checkout-${randomUUID()}`;
  await page.setExtraHTTPHeaders({ "x-request-id": requestId });
  try {
    await page.goto(f.path);
    await page.getByLabel("Nombre", { exact: true }).fill("Ana");
    await page.getByLabel("Teléfono", { exact: true }).fill("+51987654321");
    await page.route("**/checkout/**", async (route) => {
      if (route.request().method() === "POST") await route.abort("failed");
      else await route.continue();
    });
    await page.getByRole("button", { name: "Confirmar pedido", exact: true }).click();
    await browserExpect(page.getByRole("heading", { name: "No se pudo cargar el pedido" })).toBeVisible();
    expect((await f.read()).checkoutConfirmedAt).toBeNull();
    await page.unrouteAll();
    await page.getByRole("link", { name: "Reintentar" }).click();
    await browserExpect(page.getByRole("button", { name: "Confirmar pedido", exact: true })).toBeVisible();
    await page.getByLabel("Nombre", { exact: true }).fill("Ana");
    await page.getByLabel("Teléfono", { exact: true }).fill("+51987654321");
    await page.route("**/checkout/**", async (route) => {
      if (route.request().method() === "POST") { await route.fetch(); await route.abort("failed"); }
      else await route.continue();
    });
    await page.getByRole("button", { name: "Confirmar pedido", exact: true }).click();
    await browserExpect(page.getByRole("heading", { name: "No se pudo cargar el pedido" })).toBeVisible();
    const persisted = await f.read();
    expect(persisted.checkoutConfirmedAt).not.toBeNull();
    await page.unrouteAll();
    await page.getByRole("link", { name: "Reintentar" }).click();
    await browserExpect(page.getByRole("heading", { name: "Pedido confirmado", exact: true })).toBeVisible();
    expect(await f.read()).toEqual(persisted);
    await expect.poll(() => requestLogs(requestId).filter((event) => event.event === "order_checkout_confirmed").length).toBe(1);
    expect(requestLogs(requestId)).toContainEqual(expect.objectContaining({ event: "http_request_completed", method: "POST", outcome: "confirmed" }));
    expect(JSON.stringify(requestLogs(requestId))).not.toContain(f.orderId);
  } finally { await page.unrouteAll(); await f.cleanup(); }
});

test("seller copies a stable link and sees buyer confirmation separately from payment", async ({ page }) => {
  const email = `checkout-seller-${randomUUID()}@example.test`;
  const companyId = await prepareVerifiedCompany(page, { email, name: "Seller", companyName: "Seller checkout", country: "PE" });
  const buyer = await page.context().browser()!.newContext({ baseURL: `http://127.0.0.1:${process.env.CORE_E2E_PORT ?? "4173"}`, viewport: { width: 390, height: 844 } });
  try {
    const product = await withTenantIsolation(companyId, () => products.create({ name: "Producto compartido", currency: "PEN", variants: [{ attributes: {}, salePrice: 10, initialStock: 3 }] }));
    if (!product.success) throw new Error("Product fixture failed");
    const variantId = await withTenantIsolation(companyId, async () => (await prisma.productVariant.findFirstOrThrow({ where: { productId: product.data } })).id);
    const firstId = randomUUID();
    const orderId = randomUUID();
    expect((await page.request.post("/api/orders", { data: { id: firstId, contactId: null, items: [{ variantId, quantity: 1 }] } })).status()).toBe(201);
    await withTenantIsolation(companyId, async () => { await prisma.company.update({ where: { id: companyId }, data: { nextOrderNumber: 10000n } }); });
    expect((await page.request.post("/api/orders", { data: { id: orderId, contactId: null, items: [{ variantId, quantity: 1 }] } })).status()).toBe(201);
    await withTenantIsolation(companyId, async () => {
      const stored = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      await prisma.order.update({ where: { id: orderId }, data: { delivery: { method: "home", recipient: { name: "Recipient", phone: "999", identity: { kind: "absent" } },
        destination: { address: "Historical address", district: "Lima", instructions: null }, recordedBy: { kind: "seller", userId: stored.sellerId } } } });
    });
    await page.goto(`/es-PE/orders/${orderId}`);
    await browserExpect(page.getByRole("heading", { name: "Pedido #10000" })).toBeVisible();
    await browserExpect(page.getByText("Enlace aún no habilitado", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Obtener enlace", exact: true }).click();
    const link = page.getByLabel("Enlace del pedido", { exact: true });
    await browserExpect(link).toHaveValue(`http://127.0.0.1:${process.env.CORE_E2E_PORT ?? "4173"}/checkout/${companyId}/${orderId}`);
    await browserExpect(page.getByText("Pendiente de confirmación", { exact: true })).toBeVisible();
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByRole("button", { name: "Copiar enlace", exact: true }).click();
    await browserExpect(page.getByRole("status")).toHaveText("Enlace copiado");
    const mobileApi = createOrderApi(async (path, init) => {
      const response = await page.request.fetch(path, { method: init?.method ?? "GET" });
      const body: unknown = await response.json();
      return response.ok() ? ok(body) : err({ code: "API_ERROR", message: "Order request failed", http: { status: response.status(), body } });
    });
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(await mobileApi.enableCheckout(orderId)).toEqual(ok({ url: copied }));
    expect(copied).toBe(await link.inputValue());
    await page.getByRole("button", { name: "Obtener enlace", exact: true }).click();
    await browserExpect(link).toHaveValue(copied);
    const buyerPage = await buyer.newPage();
    await buyerPage.goto(copied);
    await buyerPage.getByLabel("Nombre", { exact: true }).fill("Ana");
    await buyerPage.getByLabel("Teléfono", { exact: true }).fill("+51987654321");
    await buyerPage.getByRole("button", { name: "Confirmar pedido", exact: true }).click();
    await browserExpect(buyerPage.getByRole("heading", { name: "Pago del pedido", exact: true })).toBeVisible();
    expect(await mobileApi.getAggregate(orderId)).toMatchObject({ data: { number: 10000, buyer: { name: "Ana" }, checkoutConfirmedAt: expect.any(String), paymentStatus: "pending" } });
    expect(await mobileApi.listAggregates({ page: 1, customer: "all" })).toMatchObject({ data: { total: 2, items: expect.arrayContaining([expect.objectContaining({ number: 10000, checkoutConfirmedAt: expect.any(String) })]) } });
    await page.reload();
    await browserExpect(page.getByText("Confirmado por el comprador", { exact: true })).toBeVisible();
    await browserExpect(page.getByText("Ana", { exact: true })).toBeVisible();
    await browserExpect(page.getByText("Saldo pendiente", { exact: true }).locator("..").getByText("S/ 10.00", { exact: true })).toBeVisible();
    await page.goto("/es-PE/orders");
    const table = page.getByRole("table", { name: "Órdenes" });
    await browserExpect(table.getByRole("link", { name: "Pedido #10000" })).toBeVisible();
    await browserExpect(table.getByText("Confirmado por el comprador", { exact: true })).toBeVisible();
    await browserExpect(table.getByRole("link", { name: "Pedido #1001" })).toBeVisible();
    await browserExpect(table.getByText("Pendiente de confirmación", { exact: true })).toHaveCount(0);
  } finally {
    await buyer.close();
    await withTenantIsolation(companyId, async () => {
      await prisma.payment.deleteMany(); await prisma.orderItem.deleteMany(); await prisma.order.deleteMany();
      await prisma.productStock.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.product.deleteMany();
      await systemPrisma.user.deleteMany({ where: { email } }); await prisma.company.delete({ where: { id: companyId } });
    });
  }
});

test("old links remain usable for paid, shipped and delivered orders", async ({ page }) => {
  for (const state of ["paid", "shipped", "delivered"] as const) {
    const f = await fixture();
    try {
      await withTenantIsolation(f.companyId, async () => {
        const context = { companyId: f.companyId, userId: f.userId };
        expect(await orders.registerPayment({ orderId: f.orderId, paymentId: randomUUID() as PaymentId,
          amount: { amount: 10, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false }, context)).toMatchObject({ success: true });
        if (state !== "paid") expect(await orders.ship(f.orderId, context)).toMatchObject({ success: true });
        if (state === "delivered") expect(await orders.deliver(f.orderId, context)).toMatchObject({ success: true });
        await prisma.order.update({ where: { id: f.orderId }, data: { checkoutEnabledAt: new Date("2000-01-01") } });
        expect(await orders.enableCheckout(f.orderId, context)).toMatchObject({ data: { url: `http://127.0.0.1:${process.env.CORE_E2E_PORT ?? "4173"}${f.path}` } });
      });
      const before = await f.read();
      await page.goto(f.path);
      await page.getByLabel("Nombre", { exact: true }).fill("Ana");
      await page.getByLabel("Teléfono", { exact: true }).fill("+51987654321");
      await page.getByRole("button", { name: "Confirmar pedido", exact: true }).click();
      await browserExpect(page.getByRole("heading", { name: "Pago del pedido", exact: true })).toBeVisible();
      const after = await f.read();
      expect(after.payments).toEqual(before.payments);
      expect(after.deliveryStatus).toBe(before.deliveryStatus);
      expect(after.stockDeducted).toBe(before.stockDeducted);
      expect(after.checkoutEnabledAt).toEqual(before.checkoutEnabledAt);
    } finally { await f.cleanup(); }
  }
});

test("pending submit is disabled and browser history cannot reopen confirmed buyer editing", async ({ page }) => {
  const f = await fixture();
  const intercepted = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let submissions = 0;
  try {
    await page.goto(f.path);
    await page.getByLabel("Nombre", { exact: true }).fill("Ana");
    await page.getByLabel("Teléfono", { exact: true }).fill("+51987654321");
    await page.route("**/checkout/**", async (route) => {
      if (route.request().method() === "POST") { submissions++; intercepted.resolve(); await release.promise; }
      await route.continue();
    });
    await page.getByRole("button", { name: "Confirmar pedido", exact: true }).click();
    await intercepted.promise;
    await browserExpect(page.getByRole("button", { name: "Confirmando…", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Confirmando…", exact: true }).evaluate((button: HTMLButtonElement) => button.click());
    release.resolve();
    await browserExpect(page.getByRole("heading", { name: "Pago del pedido", exact: true })).toBeVisible();
    expect(submissions).toBe(1);
    await page.goto("/checkout/unavailable");
    await page.goBack();
    await browserExpect(page.getByRole("heading", { name: "Pago del pedido", exact: true })).toBeVisible();
    await browserExpect(page.getByRole("textbox")).toHaveCount(0);
  } finally { release.resolve(); await page.unrouteAll({ behavior: "wait" }); await f.cleanup(); }
});

test("buyer selects a district rate, preserves the form on price conflict and continues to payment", async ({ page }) => {
  const f = await fixture("none", true, false);
  const quoted: string[] = [];
  page.on("request", request => { if (request.url().endsWith("/api/quotations")) quoted.push(request.postData() ?? ""); });
  try {
    const zones = await withTenantIsolation(f.companyId, async () => {
      const access = { companyId: f.companyId, userId: f.userId };
      const saved = await deliverySettings.saveZones({ method: "home", expectedVersion: 0, zones: [8, 8].map(amount => ({ kind: "new", name: "Zone", enabled: true, districtCodes: ["150122"], price: { amount, currency: "PEN" } })) }, access);
      if (!saved.success) throw new Error(saved.error.message);
      expect((await deliverySettings.save({ expectedVersion: 1, home: { enabled: true }, agency: { enabled: false }, couriers: [],
        store: { enabled: true, pickupPoint: { name: "Shop", address: "Pickup address", instructions: "Door 2" } } }, access)).success).toBe(true);
      return saved.data.zones;
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(f.path);
    await page.getByLabel("Departamento", { exact: true }).selectOption("15");
    await page.getByLabel("Provincia", { exact: true }).selectOption("1501");
    await page.getByLabel("Buscar distrito", { exact: true }).fill("miraflores");
    await page.getByLabel("Distrito", { exact: true }).selectOption("150122");
    await browserExpect(page.getByLabel("Tarifa de envío").locator("option")).toHaveCount(3);
    await page.getByLabel("Tarifa de envío").selectOption({ index: 1 });
    const rates = page.getByLabel("Tarifa de envío");
    const firstRateId = await rates.inputValue();
    await rates.selectOption({ index: 2 });
    expect(await rates.inputValue()).not.toBe(firstRateId);
    await rates.selectOption(firstRateId);
    expect(quoted).toHaveLength(1);
    await page.getByLabel("Nombre", { exact: true }).fill("Ana");
    await page.getByLabel("Teléfono", { exact: true }).fill("+51987654321");
    await page.getByLabel("Nombre del destinatario").fill("Recipient");
    await page.getByLabel("Teléfono del destinatario").fill("999");
    await page.getByLabel("Dirección de entrega").fill("Street 123");
    await page.getByLabel("Indicaciones de entrega").fill("Door 3");
    await browserExpect(page.getByText("Subtotal de productos", { exact: true }).locator("..")).toContainText(/10[.,]00/);
    await browserExpect(page.locator("dl").getByText("Entrega", { exact: true }).locator("..")).toContainText(/8[.,]00/);
    await browserExpect(page.getByText("Total a pagar", { exact: true }).locator("..")).toContainText(/18[.,]00/);
    expect(quoted).toHaveLength(1);
    await browserExpect(page.getByRole("button", { name: "Confirmar pedido", exact: true })).toBeEnabled();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: "test-results/checkout-delivery-mobile.png", fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: "test-results/checkout-delivery-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await withTenantIsolation(f.companyId, async () => {
      expect((await deliverySettings.saveZones({ method: "home", expectedVersion: 2, zones: zones.map(zone => ({ kind: "existing", id: zone.id,
        name: zone.name, enabled: true, districtCodes: zone.districtCodes, price: { amount: 10, currency: "PEN" } })) }, { companyId: f.companyId, userId: f.userId })).success).toBe(true);
    });
    await page.getByRole("button", { name: "Confirmar pedido", exact: true }).click();
    await browserExpect(page.getByRole("alert")).toContainText("El total cambió");
    await browserExpect(page.getByLabel("Dirección de entrega")).toHaveCount(0);
    await browserExpect(page.getByLabel("Tarifa de envío").locator("option")).toHaveCount(3);
    await page.getByLabel("Tarifa de envío").selectOption({ index: 1 });
    await browserExpect(page.getByLabel("Dirección de entrega")).toHaveValue("Street 123");
    await browserExpect(page.getByLabel("Indicaciones de entrega")).toHaveValue("Door 3");
    await browserExpect(page.getByLabel("Nombre", { exact: true })).toHaveValue("Ana");
    expect((await f.read()).checkoutConfirmedAt).toBeNull();
    expect(quoted).toHaveLength(2);
    await page.getByRole("button", { name: "Confirmar pedido", exact: true }).click();
    await browserExpect(page.getByRole("heading", { name: "Pago del pedido", exact: true })).toBeVisible();
    await browserExpect(page.getByText("Total del pedido", { exact: true }).locator("..")).toContainText(/20[.,]00/);
    await browserExpect(page.getByText("Saldo pendiente", { exact: true }).locator("..")).toContainText(/20[.,]00/);
    const stored = await f.read();
    expect(stored.total.toNumber()).toBe(20);
    expect(stored.deliveryCharge.toNumber()).toBe(10);
    expect(stored.delivery).toMatchObject({ method: "home", recordedBy: { kind: "buyer" }, destination: { districtCode: "150122", address: "Street 123" } });
    expect(stored.payments).toEqual([]);
    expect(stored.stockDeducted).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await f.cleanup(); }
});

test("buyer pickup confirms explicit zero without district or quotation", async ({ page }) => {
  const f = await fixture("none", true, false);
  let quotations = 0;
  page.on("request", request => { if (request.url().endsWith("/api/quotations")) quotations++; });
  try {
    await withTenantIsolation(f.companyId, async () => {
      expect((await deliverySettings.save({ expectedVersion: 0, home: { enabled: false }, agency: { enabled: false }, couriers: [],
        store: { enabled: true, pickupPoint: { name: "Shop", address: "Pickup address", instructions: "Door 2" } } }, { companyId: f.companyId, userId: f.userId })).success).toBe(true);
    });
    await page.goto(f.path);
    await page.getByLabel("Forma de entrega").selectOption("store");
    await browserExpect(page.getByText("Pickup address", { exact: true })).toBeVisible();
    await page.getByLabel("Nombre", { exact: true }).fill("Ana");
    await page.getByLabel("Teléfono", { exact: true }).fill("+51987654321");
    await page.getByLabel("Nombre del destinatario").fill("Recipient");
    await page.getByLabel("Teléfono del destinatario").fill("999");
    const before = await f.read();
    const missingDelivery = await page.request.post(f.path, { data: {
      buyer: { name: "Bypass", phone: "+51987654321" }, expectedTotal: { amount: 10, currency: "PEN" },
    } });
    expect(missingDelivery.status()).toBe(422);
    expect(await f.read()).toEqual(before);
    await page.getByRole("button", { name: "Confirmar pedido", exact: true }).click();
    await browserExpect(page.getByRole("heading", { name: "Pago del pedido", exact: true })).toBeVisible();
    const stored = await f.read();
    expect(stored.total.toNumber()).toBe(10);
    expect(stored.deliveryCharge.toNumber()).toBe(0);
    expect(stored.delivery).toMatchObject({ method: "store", recordedBy: { kind: "buyer" }, settingsVersion: 1 });
    expect(stored.delivery).not.toHaveProperty("pricing");
    expect(quotations).toBe(0);
  } finally { await f.cleanup(); }
});


test("buyer chooses an agency rate and reaches payment without choosing an operational courier", async ({ page }) => {
  const f = await fixture("none", true, false);
  try {
    await withTenantIsolation(f.companyId, async () => {
      const access = { companyId: f.companyId, userId: f.userId };
      expect((await deliverySettings.saveZones({ method: "agency", expectedVersion: 0,
        zones: [{ kind: "new", name: "Agency zone", enabled: true, districtCodes: ["150122"], price: { amount: 8, currency: "PEN" } }] }, access)).success).toBe(true);
      expect((await deliverySettings.save({ expectedVersion: 1, home: { enabled: false }, agency: { enabled: true },
        couriers: [{ kind: "new", name: "Operational courier", enabled: true }], store: { enabled: false, pickupPoint: null } }, access)).success).toBe(true);
    });
    await page.goto(f.path);
    await page.getByLabel("Departamento", { exact: true }).selectOption("15");
    await page.getByLabel("Provincia", { exact: true }).selectOption("1501");
    await page.getByLabel("Distrito", { exact: true }).selectOption("150122");
    const rates = page.getByLabel("Tarifa de envío");
    await browserExpect(rates.locator("option")).toHaveCount(2);
    await browserExpect(rates.locator("option").nth(1)).toContainText("Retiro en agencia");
    await rates.selectOption({ index: 1 });
    await page.getByLabel("Nombre", { exact: true }).fill("Ana");
    await page.getByLabel("Teléfono", { exact: true }).fill("+51987654321");
    await page.getByLabel("Nombre del destinatario").fill("Recipient");
    await page.getByLabel("Teléfono del destinatario").fill("999");
    await browserExpect(page.getByRole("button", { name: "Confirmar pedido", exact: true })).toBeDisabled();
    await page.getByLabel("Documento del destinatario").fill("12345678");
    await browserExpect(page.getByText("La agencia y el courier se asignarán después. No necesitas elegirlos para confirmar.", { exact: true })).toBeVisible();
    await browserExpect(page.getByLabel("Dirección de entrega", { exact: true })).toHaveCount(0);
    await browserExpect(page.getByRole("combobox").filter({ hasText: "Operational courier" })).toHaveCount(0);
    const total = page.locator("dl > div").filter({ has: page.getByText("Total a pagar", { exact: true }) });
    await browserExpect(total).toContainText(/18[.,]00/);
    await page.getByRole("button", { name: "Confirmar pedido", exact: true }).click();
    await browserExpect(page.getByRole("heading", { name: "Pago del pedido", exact: true })).toBeVisible();
    await browserExpect(page.getByText("Total del pedido", { exact: true }).locator("..")).toContainText(/18[.,]00/);
    await browserExpect(page.getByText("Saldo pendiente", { exact: true }).locator("..")).toContainText(/18[.,]00/);
    const stored = await f.read();
    expect(stored.total.toNumber()).toBe(18);
    expect(stored.deliveryCharge.toNumber()).toBe(8);
    expect(stored.delivery).toMatchObject({ method: "agency", agency: null, courier: null,
      recipient: { identity: { kind: "document", documentType: "national_id", document: "12345678" } },
      destination: { districtCode: "150122" }, recordedBy: { kind: "buyer" } });
    expect(stored.checkoutConfirmedAt).not.toBeNull();
    expect(stored.payments).toEqual([]);
    expect(stored.stockDeducted).toBe(false);
  } finally { await f.cleanup(); }
});


test("buyer waits for a district and recovers a failed quotation without losing the form", async ({ page }) => {
  const f = await fixture("none", true, false);
  let attempts = 0;
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  try {
    await withTenantIsolation(f.companyId, async () => {
      const access = { companyId: f.companyId, userId: f.userId };
      expect((await deliverySettings.saveZones({ method: "home", expectedVersion: 0,
        zones: [{ kind: "new", name: "Home", enabled: true, districtCodes: ["150122"], price: { amount: 8, currency: "PEN" } }] }, access)).success).toBe(true);
      expect((await deliverySettings.save({ expectedVersion: 1, home: { enabled: true }, agency: { enabled: false }, couriers: [],
        store: { enabled: false, pickupPoint: null } }, access)).success).toBe(true);
    });
    await page.route("**/api/quotations", async route => {
      attempts++;
      if (attempts === 1) return route.abort("failed");
      const response = await route.fetch();
      await hold;
      await route.fulfill({ response });
    });
    await page.goto(f.path);
    await page.getByLabel("Nombre", { exact: true }).fill("Ana");
    await page.getByLabel("Teléfono", { exact: true }).fill("+51987654321");
    await page.getByLabel("Nombre del destinatario").fill("Recipient");
    await page.getByLabel("Teléfono del destinatario").fill("999");
    const confirm = page.getByRole("button", { name: "Confirmar pedido", exact: true });
    await browserExpect(confirm).toBeDisabled();
    expect(attempts).toBe(0);
    await page.getByLabel("Departamento", { exact: true }).selectOption("15");
    await page.getByLabel("Provincia", { exact: true }).selectOption("1501");
    await page.getByLabel("Distrito", { exact: true }).selectOption("150122");
    await browserExpect(page.getByRole("alert")).toContainText("No se pudieron cargar las tarifas. Tus datos siguen aquí.");
    await browserExpect(confirm).toBeDisabled();
    await browserExpect(page.getByText("Gratis", { exact: true })).toHaveCount(0);
    await browserExpect(page.getByLabel("Nombre", { exact: true })).toHaveValue("Ana");
    await browserExpect(page.getByLabel("Nombre del destinatario")).toHaveValue("Recipient");
    await page.getByRole("button", { name: "Reintentar tarifas", exact: true }).click();
    await browserExpect(page.getByRole("status").filter({ hasText: "Consultando opciones de envío…" })).toBeVisible();
    await browserExpect(confirm).toBeDisabled();
    release();
    const rates = page.getByLabel("Tarifa de envío");
    await browserExpect(rates.locator("option")).toHaveCount(2);
    expect(attempts).toBe(2);
    await rates.selectOption({ index: 1 });
    await page.getByLabel("Dirección de entrega").fill("Street 123");
    await browserExpect(confirm).toBeEnabled();
    await confirm.click();
    await browserExpect(page.getByRole("heading", { name: "Pago del pedido", exact: true })).toBeVisible();
    const stored = await f.read();
    expect(stored.total.toNumber()).toBe(18);
    expect(stored.delivery).toMatchObject({ recipient: { name: "Recipient" }, destination: { address: "Street 123" } });
    expect(stored.payments).toEqual([]);
  } finally { release(); await page.unrouteAll({ behavior: "wait" }); await f.cleanup(); }
});


test("buyer distinguishes uncovered shipping from an explicit free home rate", async ({ page }) => {
  const f = await fixture("none", true, false);
  try {
    await withTenantIsolation(f.companyId, async () => {
      const access = { companyId: f.companyId, userId: f.userId };
      expect((await deliverySettings.saveZones({ method: "home", expectedVersion: 0,
        zones: [{ kind: "new", name: "Free home", enabled: true, districtCodes: ["150122"], price: { amount: 0, currency: "PEN" } }] }, access)).success).toBe(true);
      expect((await deliverySettings.save({ expectedVersion: 1, home: { enabled: true }, agency: { enabled: false }, couriers: [],
        store: { enabled: true, pickupPoint: { name: "Shop", address: "Pickup address", instructions: "Door 2" } } }, access)).success).toBe(true);
    });
    await page.goto(f.path);
    await page.getByLabel("Nombre", { exact: true }).fill("Ana");
    await page.getByLabel("Teléfono", { exact: true }).fill("+51987654321");
    await page.getByLabel("Nombre del destinatario").fill("Recipient");
    await page.getByLabel("Teléfono del destinatario").fill("999");
    await page.getByLabel("Departamento", { exact: true }).selectOption("04");
    await page.getByLabel("Provincia", { exact: true }).selectOption("0401");
    await page.getByLabel("Distrito", { exact: true }).selectOption("040110");
    const confirm = page.getByRole("button", { name: "Confirmar pedido", exact: true });
    await browserExpect(page.getByText("No hay opciones de envío para este distrito. Elige otro distrito o recojo en tienda.", { exact: true })).toBeVisible();
    await browserExpect(confirm).toBeDisabled();
    await browserExpect(page.getByLabel("Tarifa de envío")).toHaveCount(0);
    await browserExpect(page.getByText("Gratis", { exact: true })).toHaveCount(0);
    await page.getByLabel("Forma de entrega").selectOption("store");
    await browserExpect(confirm).toBeEnabled();
    await browserExpect(page.getByText("Pickup address", { exact: true })).toBeVisible();
    await browserExpect(page.getByText("Door 2", { exact: true })).toBeVisible();
    await page.getByLabel("Forma de entrega").selectOption("ship");
    await page.getByLabel("Departamento", { exact: true }).selectOption("15");
    await page.getByLabel("Provincia", { exact: true }).selectOption("1501");
    await page.getByLabel("Distrito", { exact: true }).selectOption("150122");
    const rates = page.getByLabel("Tarifa de envío");
    await browserExpect(rates.locator("option")).toHaveCount(2);
    await browserExpect(rates.locator("option").nth(1)).toContainText("Gratis");
    await rates.selectOption({ index: 1 });
    await page.getByLabel("Dirección de entrega").fill("Street 123");
    await browserExpect(page.getByText("Gratis", { exact: true })).toBeVisible();
    await browserExpect(confirm).toBeEnabled();
    await confirm.click();
    await browserExpect(page.getByRole("heading", { name: "Pago del pedido", exact: true })).toBeVisible();
    await browserExpect(page.getByText("Saldo pendiente", { exact: true }).locator("..")).toContainText(/10[.,]00/);
    const stored = await f.read();
    expect(stored.delivery).toMatchObject({ method: "home", destination: { districtCode: "150122" }, pricing: { settingsVersion: 2 } });
    expect(stored.total.toNumber()).toBe(10);
    expect(stored.deliveryCharge.toNumber()).toBe(0);
    expect(stored.payments).toEqual([]);
  } finally { await f.cleanup(); }
});


test("buyer keeps the selected district rate when an earlier real quotation arrives late", async ({ page }) => {
  const f = await fixture("none", true, false);
  let release!: () => void;
  let received!: () => void;
  let delivered!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const firstReceived = new Promise<void>(resolve => { received = resolve; });
  const firstDelivered = new Promise<void>(resolve => { delivered = resolve; });
  try {
    await withTenantIsolation(f.companyId, async () => {
      const access = { companyId: f.companyId, userId: f.userId };
      expect((await deliverySettings.saveZones({ method: "home", expectedVersion: 0, zones: [
        { kind: "new", name: "District A", enabled: true, districtCodes: ["150122"], price: { amount: 8, currency: "PEN" } },
        { kind: "new", name: "District B", enabled: true, districtCodes: ["040110"], price: { amount: 12, currency: "PEN" } },
      ] }, access)).success).toBe(true);
      expect((await deliverySettings.save({ expectedVersion: 1, home: { enabled: true }, agency: { enabled: false }, couriers: [],
        store: { enabled: false, pickupPoint: null } }, access)).success).toBe(true);
    });
    await page.route("**/api/quotations", async route => {
      if (route.request().postDataJSON().destination.districtCode !== "150122") return route.continue();
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      received();
      await hold;
      await route.fulfill({ response });
      delivered();
    });
    await page.goto(f.path);
    await page.getByLabel("Nombre", { exact: true }).fill("Ana");
    await page.getByLabel("Teléfono", { exact: true }).fill("+51987654321");
    await page.getByLabel("Nombre del destinatario").fill("Recipient");
    await page.getByLabel("Teléfono del destinatario").fill("999");
    await page.getByLabel("Departamento", { exact: true }).selectOption("15");
    await page.getByLabel("Provincia", { exact: true }).selectOption("1501");
    await page.getByLabel("Distrito", { exact: true }).selectOption("150122");
    await firstReceived;
    await browserExpect(page.getByRole("button", { name: "Confirmar pedido", exact: true })).toBeDisabled();
    await page.getByLabel("Departamento", { exact: true }).selectOption("04");
    await page.getByLabel("Provincia", { exact: true }).selectOption("0401");
    await page.getByLabel("Distrito", { exact: true }).selectOption("040110");
    const rates = page.getByLabel("Tarifa de envío");
    await browserExpect(rates.locator("option")).toHaveCount(2);
    await rates.selectOption({ index: 1 });
    const selected = await rates.inputValue();
    await page.getByLabel("Dirección de entrega").fill("District B street");
    release();
    await firstDelivered;
    await browserExpect(rates).toHaveValue(selected);
    await browserExpect(rates.locator("option").nth(1)).toContainText(/12[.,]00/);
    await browserExpect(page.getByLabel("Distrito", { exact: true })).toHaveValue("040110");
    await browserExpect(page.getByText("Total a pagar", { exact: true }).locator("..")).toContainText(/22[.,]00/);
    await page.getByRole("button", { name: "Confirmar pedido", exact: true }).click();
    await browserExpect(page.getByRole("heading", { name: "Pago del pedido", exact: true })).toBeVisible();
    const stored = await f.read();
    expect(stored.delivery).toMatchObject({ destination: { districtCode: "040110", address: "District B street" }, pricing: { rateId: selected } });
    expect(stored.total.toNumber()).toBe(22);
  } finally { release(); await page.unrouteAll({ behavior: "wait" }); await f.cleanup(); }
});


test("buyer pickup removes the shipping rate and ignores a quotation still in flight", async ({ page }) => {
  const f = await fixture("none", true, false);
  let attempts = 0;
  let release!: () => void;
  let received!: () => void;
  let delivered!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const heldResponse = new Promise<void>(resolve => { received = resolve; });
  const releasedResponse = new Promise<void>(resolve => { delivered = resolve; });
  try {
    await withTenantIsolation(f.companyId, async () => {
      const access = { companyId: f.companyId, userId: f.userId };
      expect((await deliverySettings.saveZones({ method: "home", expectedVersion: 0,
        zones: [{ kind: "new", name: "Home", enabled: true, districtCodes: ["150122"], price: { amount: 8, currency: "PEN" } }] }, access)).success).toBe(true);
      expect((await deliverySettings.save({ expectedVersion: 1, home: { enabled: true }, agency: { enabled: false }, couriers: [],
        store: { enabled: true, pickupPoint: { name: "Shop", address: "Pickup address", instructions: "Door 2" } } }, access)).success).toBe(true);
    });
    await page.route("**/api/quotations", async route => {
      attempts++;
      if (attempts !== 2) return route.continue();
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      received();
      await hold;
      await route.fulfill({ response });
      delivered();
    });
    await page.goto(f.path);
    await page.getByLabel("Nombre", { exact: true }).fill("Ana");
    await page.getByLabel("Teléfono", { exact: true }).fill("+51987654321");
    await page.getByLabel("Nombre del destinatario").fill("Recipient");
    await page.getByLabel("Teléfono del destinatario").fill("999");
    await page.getByLabel("Departamento", { exact: true }).selectOption("15");
    await page.getByLabel("Provincia", { exact: true }).selectOption("1501");
    await page.getByLabel("Distrito", { exact: true }).selectOption("150122");
    const rate = page.getByLabel("Tarifa de envío");
    await browserExpect(rate.locator("option")).toHaveCount(2);
    await rate.selectOption({ index: 1 });
    const originalRate = await rate.inputValue();
    await page.getByLabel("Dirección de entrega").fill("Original street");
    await browserExpect(page.getByText("Total a pagar", { exact: true }).locator("..")).toContainText(/18[.,]00/);
    const mode = page.getByLabel("Forma de entrega");
    await mode.selectOption("store");
    await browserExpect(page.getByText("Total a pagar", { exact: true }).locator("..")).toContainText(/10[.,]00/);
    await browserExpect(rate).toHaveCount(0);
    expect(attempts).toBe(1);
    await mode.selectOption("ship");
    await heldResponse;
    await browserExpect(page.getByRole("button", { name: "Confirmar pedido", exact: true })).toBeDisabled();
    await mode.selectOption("store");
    release();
    await releasedResponse;
    await browserExpect(mode).toHaveValue("store");
    await browserExpect(rate).toHaveCount(0);
    await browserExpect(page.getByText("Gratis", { exact: true })).toBeVisible();
    await browserExpect(page.getByText("Total a pagar", { exact: true }).locator("..")).toContainText(/10[.,]00/);
    await mode.selectOption("ship");
    await browserExpect(rate.locator("option")).toHaveCount(2);
    await browserExpect(rate).toHaveValue("");
    expect(attempts).toBe(3);
    await rate.selectOption({ index: 1 });
    expect(await rate.inputValue()).not.toBe(originalRate);
    await browserExpect(page.getByLabel("Dirección de entrega")).toHaveValue("Original street");
    await mode.selectOption("store");
    await page.getByRole("button", { name: "Confirmar pedido", exact: true }).click();
    await browserExpect(page.getByRole("heading", { name: "Pago del pedido", exact: true })).toBeVisible();
    const stored = await f.read();
    expect(stored.delivery).toMatchObject({ method: "store", pickupPoint: { address: "Pickup address" } });
    expect(stored.delivery).not.toHaveProperty("pricing");
    expect(stored.deliveryCharge.toNumber()).toBe(0);
    expect(stored.total.toNumber()).toBe(10);
    expect(attempts).toBe(3);
  } finally { release(); await page.unrouteAll({ behavior: "wait" }); await f.cleanup(); }
});

test("buyer cannot use disabled pickup or confirm pickup disabled after opening checkout", async ({ page }) => {
  const f = await fixture("none", true, false);
  let quotations = 0;
  page.on("request", request => { if (request.url().endsWith("/api/quotations")) quotations++; });
  try {
    await page.goto(f.path);
    const mode = page.getByLabel("Forma de entrega");
    await browserExpect(mode.locator('option[value="store"]')).toHaveCount(0);
    const savePickup = (enabled: boolean, expectedVersion: number) => withTenantIsolation(f.companyId, () => deliverySettings.save({
      expectedVersion, home: { enabled: true }, agency: { enabled: false }, couriers: [],
      store: enabled ? { enabled: true, pickupPoint: { name: "Shop", address: "Pickup address", instructions: "Door 2" } } : { enabled: false, pickupPoint: null },
    }, { companyId: f.companyId, userId: f.userId }));
    expect((await savePickup(true, 0)).success).toBe(true);
    await page.reload();
    await page.getByLabel("Nombre", { exact: true }).fill("Ana");
    await page.getByLabel("Teléfono", { exact: true }).fill("+51987654321");
    await mode.selectOption("store");
    await page.getByLabel("Nombre del destinatario").fill("Recipient");
    await page.getByLabel("Teléfono del destinatario").fill("999");
    await browserExpect(page.getByText("Pickup address", { exact: true })).toBeVisible();
    const before = await f.read();
    expect((await savePickup(false, 1)).success).toBe(true);
    await page.getByRole("button", { name: "Confirmar pedido", exact: true }).click();
    await browserExpect(page.getByRole("alert")).toContainText("Revisa la entrega y vuelve a confirmar.");
    await browserExpect(page.getByLabel("Nombre", { exact: true })).toHaveValue("Ana");
    await browserExpect(page.getByLabel("Nombre del destinatario")).toHaveValue("Recipient");
    expect(await f.read()).toEqual(before);
    expect(quotations).toBe(0);
    await page.reload();
    await browserExpect(mode.locator('option[value="store"]')).toHaveCount(0);
  } finally { await f.cleanup(); }
});

test("buyer keeps a historical rate after its zone changes or replaces it with a current option", async ({ page }) => {
  for (const replace of [false, true]) {
    const f = await fixture("none", true, false);
    try {
      const original = await withTenantIsolation(f.companyId, async () => {
        const access = { companyId: f.companyId, userId: f.userId };
        const saved = await deliverySettings.saveZones({ method: "home", expectedVersion: 0,
          zones: [{ kind: "new", name: "Original", enabled: true, districtCodes: ["150122"], price: { amount: 8, currency: "PEN" } }] }, access);
        if (!saved.success) throw new Error(saved.error.message);
        expect((await deliverySettings.save({ expectedVersion: 1, home: { enabled: true }, agency: { enabled: false }, couriers: [],
          store: { enabled: false, pickupPoint: null } }, access)).success).toBe(true);
        const quote = await deliverySettings.createQuotation({ companyId: f.companyId, country: "PE", districtCode: "150122", address: null, instructions: null });
        if (!quote.success) throw new Error(quote.error.message);
        const selection = parseRatedDeliverySelection({ method: "home", rateId: quote.data.rates[0].id,
          recipient: { name: "Recipient", phone: "999", identity: { kind: "absent" } },
          destination: { districtCode: "150122", address: "Historical street", instructions: null } });
        if (!selection.success) throw new Error(selection.error.message);
        expect((await orders.setDelivery({ orderId: f.orderId, delivery: selection.data, expectedPrice: { amount: 8, currency: "PEN" } }, access)).success).toBe(true);
        expect((await deliverySettings.saveZones({ method: "home", expectedVersion: 2, zones: [
          { kind: "existing", id: saved.data.zones[0].id, name: "Original", enabled: false, districtCodes: ["150122"], price: { amount: 10, currency: "PEN" } },
          { kind: "new", name: "Current", enabled: true, districtCodes: ["150122"], price: { amount: 12, currency: "PEN" } },
        ] }, access)).success).toBe(true);
        return quote.data.rates[0].id;
      });
      const before = await f.read();
      let quotations = 0;
      const countQuotation = (request: { url: () => string }) => { if (request.url().endsWith("/api/quotations")) quotations++; };
      page.on("request", countQuotation);
      try {
        await page.goto(f.path);
        await browserExpect(page.getByLabel("Forma de entrega")).toHaveValue("keep");
        await browserExpect(page.getByText("Historical street, MIRAFLORES", { exact: true })).toBeVisible();
        await browserExpect(page.getByText("Total a pagar", { exact: true }).locator("..")).toContainText(/18[.,]00/);
        expect(quotations).toBe(0);
        await page.getByLabel("Nombre", { exact: true }).fill("Ana");
        await page.getByLabel("Teléfono", { exact: true }).fill("+51987654321");
        if (replace) {
          await page.getByLabel("Forma de entrega").selectOption("ship");
          const rates = page.getByLabel("Tarifa de envío");
          await browserExpect(rates.locator("option")).toHaveCount(2);
          await browserExpect(rates).toContainText(/12[.,]00/);
          await rates.selectOption({ index: 1 });
          expect(await rates.inputValue()).not.toBe(original);
          await browserExpect(page.getByLabel("Dirección de entrega")).toHaveValue("Historical street");
          await page.getByLabel("Dirección de entrega").fill("Replacement street");
        }
        await page.getByRole("button", { name: "Confirmar pedido", exact: true }).click();
        await browserExpect(page.getByRole("heading", { name: "Pago del pedido", exact: true })).toBeVisible();
        const total = replace ? 22 : 18;
        await browserExpect(page.getByText("Total del pedido", { exact: true }).locator("..")).toContainText(new RegExp(`${total}[.,]00`));
        const stored = await f.read();
        expect(stored.total.toNumber()).toBe(total);
        expect(stored.deliveryCharge.toNumber()).toBe(replace ? 12 : 8);
        if (replace) {
          expect(stored.delivery).toMatchObject({ destination: { address: "Replacement street" } });
          expect(stored.delivery).not.toEqual(before.delivery);
        }
        else expect(stored.delivery).toEqual(before.delivery);
        expect(quotations).toBe(replace ? 1 : 0);
        expect(stored.payments).toEqual([]);
      } finally { page.off("request", countQuotation); }
    } finally { await f.cleanup(); }
  }
});
