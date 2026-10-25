import { mkdir, readFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { Route } from "@playwright/test";
import { afterAll, beforeAll } from "vitest";
import { brandHostHeaders, browserExpect, expect, prepareVerifiedCompany, storeUrl, subdomainOf, test, waitForReactHydration } from "@core/tests/e2e/fixtures";
import { products } from "@core/src/features/products/composition";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { formatCurrency } from "@core/app/format-currency";
import { startFakeS3 } from "@core/tests/e2e/fake-s3";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==", "base64");

// The settings save reads the wallet QR from the object storage the e2e server uses (server-setup.ts points R2_ENDPOINT at port + 1000).
let storage: Server;
beforeAll(async () => { storage = await startFakeS3(Number(process.env.CORE_E2E_PORT ?? "4173") + 1000); });
afterAll(async () => { await new Promise<void>((resolve) => storage?.close(() => resolve())); });
const walletQr = new URL("../../src/shared/images/infrastructure/qr-fixtures/non-uuid-qr.jpg", import.meta.url);

test("buyer pays with the verified wallet qr and the seller approves the report from the receipt dialog", async ({ page, request }) => {
  const email = `buyer-payment-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    companyId = await prepareVerifiedCompany(page, { email, name: "Vendedora", companyName: "Tienda", country: "PE" });
    const tenantId = companyId;
    const subdomain = subdomainOf(tenantId);
    const brand = brandHostHeaders(subdomain);
    // The checkout lives on the store's brand host, whatever the catalog publication.
    await withTenantIsolation(tenantId, async () => { await prisma.company.update({ where: { id: tenantId }, data: { catalogSubdomain: subdomain } }); });
    const product = await withTenantIsolation(tenantId, () => products.create({ name: "Cuaderno", currency: "PEN",
      variants: [{ attributes: {}, sku: `PAY-${crypto.randomUUID()}`, salePrice: 12.5, initialStock: 2 }] }));
    expect(product.success).toBe(true);
    if (!product.success) return;
    const variantId = await withTenantIsolation(tenantId, async () => (await prisma.productVariant.findFirstOrThrow({ where: { productId: product.data } })).id);
    await page.goto("/es-PE/settings/payments");
    await browserExpect(page.getByRole("heading", { name: "Medios de cobro" })).toBeVisible();
    await page.getByLabel("Ofrecer billetera digital").check();
    await page.getByLabel("Proveedor").fill("Yape");
    await page.getByLabel("Titular").first().fill("Tienda");
    await page.route("**/test-images/*", (route) => route.fulfill({ status: 200, contentType: "image/png", body: png }));
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Subir QR" }).click();
    await (await chooser).setFiles({ name: "plin.jpg", mimeType: "image/jpeg", buffer: await readFile(walletQr) });
    await browserExpect(page.getByText("✓ QR válido")).toBeVisible();
    await page.getByLabel("Ofrecer transferencia bancaria").check();
    await page.getByLabel("Banco", { exact: true }).fill("BCP");
    await page.getByLabel("Titular").last().fill("Tienda");
    await page.getByLabel("CCI").fill("00200000000000000001");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await browserExpect(page.getByText("Medios de cobro guardados.")).toBeVisible();
    const orderId = crypto.randomUUID();
    expect((await page.request.post("/api/orders/pending", { data: { id: orderId,
      items: [{ variantId, quantity: 1 }] } })).status()).toBe(201);
    expect((await page.request.put("/api/delivery-settings", { data: { expectedVersion: 0, home: { enabled: true }, agency: { enabled: false }, store: { enabled: true, pickupPoint: { name: "Tienda", address: "Av. Arequipa 123, Lima", instructions: null } } } })).ok()).toBe(true);
    // Orders are born enabled; a legacy row without the timestamp is simulated.
    await withTenantIsolation(tenantId, async () => { await prisma.order.update({ where: { id: orderId }, data: { checkoutEnabledAt: null } }); });
    await page.goto(`/es-PE/orders/${orderId}`);
    await browserExpect(page.getByRole("textbox", { name: "Enlace del pedido" })).toHaveCount(0);
    expect((await request.get(`/api/buyer/orders/${orderId}/payment`, { headers: brand })).status()).toBe(409);
    expect((await request.get(`/api/buyer/orders/${orderId}/payment`)).status()).toBe(404);
    await withTenantIsolation(tenantId, async () => { await prisma.order.update({ where: { id: orderId }, data: { checkoutEnabledAt: new Date() } }); });
    const checkoutPath = `/checkout/${orderId}`;
    const checkoutAddress = storeUrl(subdomain, checkoutPath);
    await page.goto(checkoutAddress);
    await page.getByLabel("Nombre", { exact: true }).fill("Ana Torres");
    await page.getByLabel("Teléfono", { exact: true }).fill("+51987654321");
    expect((await request.post(`/api/buyer/orders/${orderId}/reports`, { headers: brand, data: { paymentId: crypto.randomUUID(), receiptImageId: crypto.randomUUID() } })).status()).toBe(409);
    await page.getByRole("radio", { name: "Recojo en tienda · Gratis" }).check();
    await page.getByRole("button", { name: "Confirmar pedido", exact: true }).click();
    await browserExpect(page).toHaveURL(checkoutAddress);
    await browserExpect(page.getByRole("heading", { name: "Pedido confirmado" })).toBeVisible();
    const opened = await page.goto(checkoutAddress);
    expect(opened?.status()).toBe(200);
    await browserExpect(page.getByRole("heading", { name: "Pedido confirmado" })).toBeVisible();
    expect((await request.get(`/pago/${orderId}`, { maxRedirects: 0 })).status()).toBe(404);
    await page.goto(`/pago/${orderId}`);
    await browserExpect(page.getByRole("heading", { name: "Página no encontrada" })).toBeVisible();
    await page.goto(checkoutAddress);
    await browserExpect(page.getByRole("radio", { name: "Yape" })).toBeVisible();
    await browserExpect(page.getByRole("img", { name: "Instrucciones de billetera digital" })).toBeVisible();
    await page.getByRole("radio", { name: "Transferencia", exact: true }).check();
    await browserExpect(page.getByText("BCP")).toBeVisible();
    await browserExpect(page.getByText(formatCurrency(12.5, "PEN", "es")).first()).toBeVisible();
    await browserExpect(page.getByRole("button", { name: "Ya pagué" })).toBeDisabled();
    await mkdir("../../.impeccable/review", { recursive: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ animations: "disabled", path: "../../.impeccable/review/desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 938 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ animations: "disabled", path: "../../.impeccable/review/mobile.png", fullPage: true });
    // docs/checkout.md «Fixed mode»: a buyer with a dark system and a stored dark preference still gets the light Clásico checkout.
    await page.emulateMedia({ colorScheme: "dark" });
    await page.evaluate(() => localStorage.setItem("yoyos-theme", "dark"));
    await page.reload();
    await page.getByRole("radio", { name: "Transferencia", exact: true }).check();
    await browserExpect(page.locator("html")).toHaveAttribute("data-color-scheme", "fixed");
    await browserExpect(page.locator("html")).not.toHaveClass(/dark/);
    await page.screenshot({ animations: "disabled", path: "../../.impeccable/review/mobile-dark.png", fullPage: true });
    await expect.poll(() => page.getByRole("button", { name: "Copiar CCI" }).evaluate(element => {
      const channels = (color: string) => color.match(/[\d.]+/g)!.map(Number);
      const luminance = (color: string) => {
        const [red, green, blue] = channels(color).slice(0, 3).map(value => { const channel = value / 255; return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4; });
        return red * 0.2126 + green * 0.7152 + blue * 0.0722;
      };
      // The text sits on the nearest painted ancestor: the themed surface, not the page body.
      let surface: Element | null = element;
      while (surface && (channels(getComputedStyle(surface).backgroundColor)[3] ?? 1) === 0) surface = surface.parentElement;
      const text = luminance(getComputedStyle(element).color), background = luminance(getComputedStyle(surface ?? document.body).backgroundColor);
      return (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05);
    })).toBeGreaterThanOrEqual(4.5);
    await page.evaluate(() => localStorage.removeItem("yoyos-theme"));
    await page.emulateMedia({ colorScheme: "light" });
    const imageId = crypto.randomUUID();
    await withTenantIsolation(tenantId, async () => await prisma.image.create({ data: { id: imageId, storageKey: `test/${imageId}` } }));
    let uploadFailed = false;
    await page.route(`**/api/buyer/orders/${orderId}/images`, (route) => {
      if (!uploadFailed) { uploadFailed = true; return route.fulfill({ status: 502, body: "Upload unavailable" }); }
      return route.fulfill({ status: 201, contentType: "application/json",
        body: JSON.stringify({ id: imageId, url: `http://127.0.0.1:${process.env.CORE_E2E_PORT ?? "4173"}/test-images/test%2F${imageId}` }) });
    });
    await page.getByLabel("Captura del pago").setInputFiles({ name: "pago.png", mimeType: "image/png", buffer: png });
    await browserExpect(page.getByText("No se pudo subir la captura. Inténtalo de nuevo.")).toBeVisible();
    await page.getByRole("button", { name: "Reintentar subida" }).click();
    await browserExpect(page.getByText("Captura lista para enviar.")).toBeVisible();
    expect(await withTenantIsolation(tenantId, async () => await prisma.payment.count({ where: { orderId } }))).toBe(0);
    let responseLost = false;
    await page.route(`**/api/buyer/orders/${orderId}/reports`, async (route) => {
      if (!responseLost) {
        responseLost = true;
        await route.fetch();
        return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "SERVICE_UNAVAILABLE" }) });
      }
      return route.continue();
    });
    await page.getByRole("button", { name: "Ya pagué" }).click();
    await browserExpect(page.getByText("No se pudo enviar el aviso. Tu captura sigue lista; vuelve a intentarlo.")).toBeVisible();
    expect(await withTenantIsolation(tenantId, async () => await prisma.payment.count({ where: { orderId } }))).toBe(1);
    await page.getByRole("button", { name: "Ya pagué" }).click();
    await browserExpect(page.getByRole("heading", { name: "Pago pendiente de revisión" })).toBeVisible();
    const payment = await withTenantIsolation(tenantId, async () => await prisma.payment.findFirstOrThrow({ where: { orderId } }));
    expect(payment.status).toBe("reported");
    expect(payment.amount).toBeNull();
    await page.goto(`/es-PE/orders/${orderId}`);
    await browserExpect(page.getByRole("link", { name: "Abrir enlace en una pestaña nueva" })).toHaveAttribute("href", new RegExp(`${checkoutPath}$`));
    // One report: one row with thumbnail, «Ver captura», Rechazar and Aprobar, the manual payment as a separate action and no open form.
    const report = page.getByRole("listitem").filter({ hasText: "Pago reportado, pendiente de revisión" });
    await browserExpect(report).toHaveCount(1);
    await browserExpect(report.getByRole("button", { name: /^Ver comprobante del/ })).toBeVisible();
    await browserExpect(report.getByRole("button", { name: /^Rechazar pago reportado el/ })).toBeVisible();
    await browserExpect(page.getByText("Pago por revisar")).toBeVisible();
    await browserExpect(page.getByRole("button", { name: "¿Te pagaron por fuera? Registrar pago" })).toBeVisible();
    await browserExpect(page.getByLabel("Importe recibido")).toHaveCount(0);
    expect(await report.locator("img").first().evaluate((image: HTMLImageElement) => [image.loading, image.decoding, image.getAttribute("width"), image.getAttribute("height")])).toEqual(["lazy", "async", "56", "80"]);
    await report.getByRole("button", { name: /^Ver captura del/ }).click();
    const dialog = page.getByRole("dialog", { name: "Comprobante de pago" });
    await browserExpect(dialog).toBeVisible();
    await browserExpect(dialog.getByText("Saldo pendiente del pedido")).toBeVisible();
    await dialog.getByRole("button", { name: "Aprobar", exact: true }).click();
    // The decision area of the same dialog turns into the form, prefilled with the balance, and the box follows the stock rule.
    await browserExpect(dialog.getByLabel("Importe recibido")).toBeFocused();
    await browserExpect(dialog.getByLabel("Importe recibido")).toHaveValue("12.50");
    await browserExpect(dialog.getByLabel("Descontar stock aunque sea un abono parcial")).toHaveCount(0);
    await dialog.getByLabel("Importe recibido").fill("5");
    await browserExpect(dialog.getByLabel("Descontar stock aunque sea un abono parcial")).not.toBeChecked();
    await dialog.getByLabel("Importe recibido").fill("12.50");
    await browserExpect(dialog.getByLabel("Descontar stock aunque sea un abono parcial")).toHaveCount(0);
    await dialog.getByRole("combobox", { name: "Medio de pago" }).click();
    await page.getByRole("listbox").getByRole("option", { name: "Transferencia bancaria" }).click();
    await dialog.getByRole("button", { name: "Aprobar pago S/ 12.50" }).click();
    await browserExpect(dialog).toHaveCount(0);
    await browserExpect(page.getByText("Pago actualizado.")).toBeVisible();
    await browserExpect(page.getByRole("listitem").filter({ hasText: "Pago confirmado" })).toBeFocused();
    expect((await withTenantIsolation(tenantId, async () => await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } }))).status).toBe("confirmed");
    await page.goto(checkoutAddress);
    await browserExpect(page.getByRole("heading", { name: "Pedido pagado" })).toBeVisible();
    expect(await withTenantIsolation(tenantId, async () => (await prisma.productStock.findUniqueOrThrow({ where: { variantId } })).quantity)).toBe(1n);
    await page.goto(`/es-PE/orders/${orderId}`);
    await browserExpect(page.getByRole("button", { name: "¿Te pagaron por fuera? Registrar pago" })).toHaveCount(0);
    await page.getByRole("button", { name: /^Anular pago del/ }).click();
    await browserExpect(page.getByText("Pago anulado", { exact: false }).first()).toBeVisible();
    expect((await withTenantIsolation(tenantId, async () => await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } }))).status).toBe("voided");
    await page.getByRole("button", { name: "¿Te pagaron por fuera? Registrar pago" }).click();
    const manual = page.getByRole("dialog", { name: "Registrar pago" });
    const manualResponse = page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes(`/orders/${orderId}`));
    await manual.getByRole("button", { name: "Confirmar pago" }).click();
    await manualResponse;
    expect(await withTenantIsolation(tenantId, async () => await prisma.payment.count({ where: { orderId, status: "confirmed" } }))).toBe(1);
    await browserExpect(page.getByText("Pago actualizado.")).toBeVisible();
    await page.goto(checkoutAddress);
    await browserExpect(page.getByRole("heading", { name: "Pedido pagado" })).toBeVisible();
    expect(await withTenantIsolation(tenantId, async () => (await prisma.productStock.findUniqueOrThrow({ where: { variantId } })).quantity)).toBe(1n);
  } finally {
    const user = await systemPrisma.user.findUnique({ where: { email }, select: { companyId: true } });
    if (user?.companyId) await withTenantIsolation(user.companyId, async () => {
      await prisma.payment.deleteMany();
      await prisma.orderItem.deleteMany();
      await prisma.order.deleteMany();
      await prisma.productStock.deleteMany();
      await prisma.productVariant.deleteMany();
      await prisma.product.deleteMany();
      await prisma.image.deleteMany();
      await prisma.companyPaymentSettings.deleteMany();
      await prisma.companyDeliverySettings.deleteMany();
      await systemPrisma.user.deleteMany({ where: { email } });
      await prisma.company.delete({ where: { id: user.companyId! } });
    });
  }
});

test("seller rejects a report with a reason and the buyer sees it and sends another receipt", async ({ page, request }) => {
  const email = `buyer-reject-${crypto.randomUUID()}@example.test`;
  try {
    const tenantId = await prepareVerifiedCompany(page, { email, name: "Vendedora", companyName: "Tienda", country: "PE" });
    const subdomain = subdomainOf(tenantId);
    const brand = brandHostHeaders(subdomain);
    await withTenantIsolation(tenantId, async () => { await prisma.company.update({ where: { id: tenantId }, data: { catalogSubdomain: subdomain } }); });
    const product = await withTenantIsolation(tenantId, () => products.create({ name: "Cuaderno", currency: "PEN",
      variants: [{ attributes: {}, sku: `REJ-${crypto.randomUUID()}`, salePrice: 12.5, initialStock: 2 }] }));
    expect(product.success).toBe(true);
    if (!product.success) return;
    const variantId = await withTenantIsolation(tenantId, async () => (await prisma.productVariant.findFirstOrThrow({ where: { productId: product.data } })).id);
    // The offered wallet is stored as already verified: this journey is about reviewing reports, not about the QR check.
    const qrImageId = crypto.randomUUID();
    await withTenantIsolation(tenantId, async () => {
      await prisma.image.create({ data: { id: qrImageId, storageKey: `test/${qrImageId}` } });
      await prisma.companyPaymentSettings.create({ data: { companyId: tenantId, settings: [{ method: "digital_wallet", provider: "Plin", holder: "Tienda",
        qr: { status: "verified", imageId: qrImageId } }] } });
    });
    const orderId = crypto.randomUUID();
    expect((await page.request.post("/api/orders/pending", { data: { id: orderId, items: [{ variantId, quantity: 1 }] } })).status()).toBe(201);
    expect((await page.request.put("/api/delivery-settings", { data: { expectedVersion: 0, home: { enabled: true }, agency: { enabled: false },
      store: { enabled: true, pickupPoint: { name: "Tienda", address: "Av. Arequipa 123, Lima", instructions: null } } } })).ok()).toBe(true);
    await withTenantIsolation(tenantId, async () => { await prisma.order.update({ where: { id: orderId }, data: { checkoutEnabledAt: new Date() } }); });
    const checkoutPath = storeUrl(subdomain, `/checkout/${orderId}`);
    await page.goto(checkoutPath);
    await page.getByLabel("Nombre", { exact: true }).fill("Ana Torres");
    await page.getByLabel("Teléfono", { exact: true }).fill("+51987654321");
    await page.getByRole("radio", { name: "Recojo en tienda · Gratis" }).check();
    await page.getByLabel("Nombre del destinatario").fill("Ana Torres");
    await page.getByLabel("Teléfono del destinatario").fill("+51987654321");
    await page.getByRole("button", { name: "Confirmar pedido", exact: true }).click();
    await browserExpect(page.getByRole("heading", { name: "Pedido confirmado" })).toBeVisible();
    await page.goto(checkoutPath);
    await browserExpect(page.getByRole("img", { name: "Instrucciones de billetera digital" })).toBeVisible();

    const sendReceipt = async () => {
      await waitForReactHydration(page, "#receipt");
      const imageId = crypto.randomUUID();
      await withTenantIsolation(tenantId, async () => await prisma.image.create({ data: { id: imageId, storageKey: `test/${imageId}` } }));
      await page.route(`**/api/buyer/orders/${orderId}/images`, (route) => route.fulfill({ status: 201, contentType: "application/json",
        body: JSON.stringify({ id: imageId, url: `http://127.0.0.1:${process.env.CORE_E2E_PORT ?? "4173"}/test-images/test%2F${imageId}` }) }));
      await page.getByLabel("Captura del pago").setInputFiles({ name: "pago.png", mimeType: "image/png", buffer: png });
      await browserExpect(page.getByText("Captura lista para enviar.")).toBeVisible();
      await page.getByRole("button", { name: "Ya pagué" }).click();
      await browserExpect(page.getByRole("heading", { name: "Pago pendiente de revisión" })).toBeVisible();
      await page.unroute(`**/api/buyer/orders/${orderId}/images`);
    };
    await sendReceipt();
    const first = await withTenantIsolation(tenantId, async () => await prisma.payment.findFirstOrThrow({ where: { orderId } }));

    // Somebody else rejects the report while the dialog is open: approving answers «Este pago ya fue revisado.» inside the dialog.
    await page.goto(`/es-PE/orders/${orderId}`);
    await page.getByRole("button", { name: /^Ver captura del/ }).click();
    const dialog = page.getByRole("dialog", { name: "Comprobante de pago" });
    await dialog.getByRole("button", { name: "Aprobar", exact: true }).click();
    expect((await page.request.post(`/api/orders/${orderId}/payments/${first.id}/reject`, { data: { reason: "El monto no coincide" } })).status()).toBe(200);
    await dialog.getByRole("button", { name: "Aprobar pago S/ 12.50" }).click();
    await browserExpect(dialog.getByText("Este pago ya fue revisado.")).toBeVisible();
    await browserExpect(dialog.getByRole("button", { name: "Aprobar", exact: true })).toHaveCount(0);
    await browserExpect(dialog.getByText("Pago rechazado")).toBeVisible();
    await page.keyboard.press("Escape");
    await browserExpect(dialog).toHaveCount(0);
    expect(await withTenantIsolation(tenantId, async () => await prisma.payment.count({ where: { orderId, status: "confirmed" } }))).toBe(0);

    // The buyer sees the rejection first in the upload block and in the list of receipts, and sends another receipt.
    await page.goto(checkoutPath);
    await browserExpect(page.getByText("Tu comprobante fue rechazado")).toBeVisible();
    await browserExpect(page.getByText("Motivo: El monto no coincide")).toHaveCount(2);
    await browserExpect(page.getByRole("link", { name: "Ver captura · Rechazado" })).toBeVisible();
    // A retried «Ya pagué» with the rejected payment answers «reported», yet the checkout keeps showing the refreshed rejection.
    const replay = await request.post(`/api/buyer/orders/${orderId}/reports`, { headers: brand, data: { paymentId: first.id, receiptImageId: (first.data as { receiptImageId: string }).receiptImageId } });
    expect((await replay.json()).status).toBe("reported");
    await page.reload();
    await browserExpect(page.getByText("Tu comprobante fue rechazado")).toBeVisible();
    await sendReceipt();
    await browserExpect(page.getByRole("link", { name: "Ver captura · Pendiente" })).toBeVisible();
    await browserExpect(page.getByRole("link", { name: "Ver captura · Rechazado" })).toBeVisible();

    // The seller rejects the second report from its row, with a reason, without opening the receipt.
    await page.goto(`/es-PE/orders/${orderId}`);
    await browserExpect(page.getByRole("listitem").filter({ hasText: "Pago rechazado" })).toHaveCount(1);
    await page.getByRole("button", { name: /^Rechazar pago reportado el/ }).click();
    const rejection = page.getByRole("dialog", { name: "¿Rechazar este comprobante?" });
    await browserExpect(rejection.getByLabel("Motivo (opcional, lo verá el comprador)")).toBeFocused();
    await rejection.getByLabel("Motivo (opcional, lo verá el comprador)").fill("Foto borrosa");
    await rejection.getByRole("button", { name: "Rechazar comprobante" }).click();
    await browserExpect(rejection).toHaveCount(0);
    await browserExpect(page.getByRole("listitem").filter({ hasText: "Pago rechazado" })).toHaveCount(2);
    await browserExpect(page.getByText("Motivo: Foto borrosa")).toBeVisible();
    await browserExpect(page.getByText("Pago por revisar")).toHaveCount(0);

    // A third receipt is rejected from the receipt dialog: the dialog closes, the card says so and focus lands on the decided row.
    await page.goto(checkoutPath);
    await sendReceipt();
    await page.goto(`/es-PE/orders/${orderId}`);

    // A lost response leaves the decision unknown: the row waits for the reload and then lets the seller repeat it.
    const isOrderData = (url: URL) => url.pathname.endsWith(`/orders/${orderId}.data`);
    const loseAnswer = (route: Route) => route.request().method() === "POST" ? route.abort() : route.continue();
    await page.route(isOrderData, loseAnswer);
    await page.getByRole("button", { name: /^Rechazar pago reportado el/ }).click();
    const lost = page.getByRole("dialog", { name: "¿Rechazar este comprobante?" });
    await lost.getByRole("button", { name: "Rechazar comprobante" }).click();
    await browserExpect(lost.getByText("No sabemos si se guardó. Revisa el pedido antes de repetir.")).toBeVisible();
    await page.keyboard.press("Escape");
    await browserExpect(lost).toHaveCount(0);
    await browserExpect(page.getByRole("button", { name: /^Rechazar pago reportado el/ })).toBeEnabled();
    await browserExpect(page.getByRole("button", { name: /^Aprobar pago reportado el/ })).toBeEnabled();
    await page.unroute(isOrderData, loseAnswer);
    expect(await withTenantIsolation(tenantId, async () => await prisma.payment.count({ where: { orderId, status: "reported" } }))).toBe(1);

    await page.getByRole("button", { name: /^Ver captura del/ }).first().click();
    const review = page.getByRole("dialog", { name: "Comprobante de pago" });
    await review.getByRole("button", { name: "Rechazar", exact: true }).click();
    await browserExpect(review.getByRole("heading", { name: "¿Rechazar este comprobante?" })).toBeVisible();
    await browserExpect(review.getByLabel("Motivo (opcional, lo verá el comprador)")).toBeFocused();
    await review.getByLabel("Motivo (opcional, lo verá el comprador)").fill("Foto cortada");
    await review.getByRole("button", { name: "Rechazar comprobante" }).click();
    await browserExpect(review).toHaveCount(0);
    await browserExpect(page.getByText("Pago actualizado.")).toBeVisible();
    await browserExpect(page.getByRole("listitem").filter({ hasText: "Motivo: Foto cortada" })).toBeFocused();
    await browserExpect(page.getByRole("listitem").filter({ hasText: "Pago rechazado" })).toHaveCount(3);
    await browserExpect(page.getByText("Pago por revisar")).toHaveCount(0);
    expect(await withTenantIsolation(tenantId, async () => await prisma.payment.count({ where: { orderId, status: "rejected" } }))).toBe(3);
    expect(await withTenantIsolation(tenantId, async () => (await prisma.productStock.findUniqueOrThrow({ where: { variantId } })).quantity)).toBe(2n);
  } finally {
    const user = await systemPrisma.user.findUnique({ where: { email }, select: { companyId: true } });
    if (user?.companyId) await withTenantIsolation(user.companyId, async () => {
      await prisma.payment.deleteMany();
      await prisma.orderItem.deleteMany();
      await prisma.order.deleteMany();
      await prisma.productStock.deleteMany();
      await prisma.productVariant.deleteMany();
      await prisma.product.deleteMany();
      await prisma.image.deleteMany();
      await prisma.companyPaymentSettings.deleteMany();
      await prisma.companyDeliverySettings.deleteMany();
      await systemPrisma.user.deleteMany({ where: { email } });
      await prisma.company.delete({ where: { id: user.companyId! } });
    });
  }
});
