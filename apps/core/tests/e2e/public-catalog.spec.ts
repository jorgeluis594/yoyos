import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { browserExpect, expect, prepareVerifiedCompany, test } from "@core/tests/e2e/fixtures";
import { products } from "@core/src/features/products/composition";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

function requestLogs(requestId: string) {
  return readFileSync("test-results/server.jsonl", "utf8").trim().split("\n")
    .flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } })
    .filter((event) => event.requestId === requestId);
}

test("seller publishes the catalog, buyer adds two variants, continues, confirms and the seller sees the order from the catalog", async ({ page }) => {
  const email = `catalog-seller-${randomUUID()}@example.test`;
  const companyId = await prepareVerifiedCompany(page, { email, name: "Seller", companyName: "Tienda del catálogo", country: "PE" });
  const buyer = await page.context().browser()!.newContext({ baseURL: `http://127.0.0.1:${process.env.CORE_E2E_PORT ?? "4173"}`, viewport: { width: 390, height: 844 } });
  const buyerPage = await buyer.newPage();
  const requestId = `catalog-${randomUUID()}`;
  await buyerPage.setExtraHTTPHeaders({ "x-request-id": requestId });
  try {
    const product = await withTenantIsolation(companyId, () => products.create({ name: "Polo básico", currency: "PEN", variants: [
      { attributes: { Talla: "M", Color: "Negro" }, salePrice: 45, initialStock: 5 },
      { attributes: { Talla: "L", Color: "Negro" }, salePrice: 45, initialStock: 5 },
    ] }));
    if (!product.success) throw new Error("Product fixture failed");
    await page.goto("/es-PE/settings/delivery");
    await page.getByLabel("Ofrecer recojo en tienda").check();
    await page.getByLabel("Nombre del punto de recojo").fill("Tienda");
    await page.getByLabel("Dirección", { exact: true }).fill("Av. Larco 123");
    await page.getByRole("button", { name: "Guardar configuración" }).click();
    await browserExpect(page.getByRole("status")).toHaveText("Configuración guardada.");

    await page.goto("/es-PE/settings/catalog");
    await page.getByRole("switch", { name: "Publicar catálogo" }).click();
    await browserExpect(page.getByText("Catálogo publicado", { exact: true })).toBeVisible();
    const url = new URL(await page.getByLabel("Link del catálogo").inputValue());
    expect(url.pathname).toBe(`/catalogo/${companyId}`);

    const catalog = await buyerPage.goto(url.pathname);
    expect(catalog?.headers()["referrer-policy"]).toBe("no-referrer");
    await browserExpect(buyerPage.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
    await browserExpect(async () => {
      await buyerPage.getByRole("searchbox", { name: "Buscar productos" }).fill("polo");
      await buyerPage.waitForURL(/\?q=polo$/, { timeout: 1000 });
    }).toPass({ timeout: 10_000 });
    await buyerPage.getByRole("link", { name: /Polo básico/ }).click();
    await buyerPage.getByRole("button", { name: "Volver al catálogo" }).click();
    await buyerPage.waitForURL(/\?q=polo$/);
    await browserExpect(buyerPage.getByRole("searchbox", { name: "Buscar productos" })).toHaveValue("polo");
    await buyerPage.getByRole("link", { name: /Polo básico/ }).click();
    // Clicks before hydration are lost: retry the first choice until React reflects it.
    await browserExpect(async () => {
      await buyerPage.getByRole("button", { name: "M", exact: true }).click();
      await browserExpect(buyerPage.getByRole("button", { name: "M", exact: true })).toHaveAttribute("aria-pressed", "true", { timeout: 1000 });
    }).toPass({ timeout: 10_000 });
    await buyerPage.getByRole("button", { name: "Negro", exact: true }).click();
    await buyerPage.getByRole("button", { name: "Agregar uno" }).click();
    await buyerPage.getByRole("button", { name: "Agregar al carrito" }).click();
    await browserExpect(buyerPage.getByRole("status").filter({ hasText: "Agregado al carrito" })).toBeVisible();
    await buyerPage.getByRole("button", { name: "L", exact: true }).click();
    await buyerPage.getByRole("button", { name: "Agregar al carrito" }).click();
    await buyerPage.getByRole("button", { name: "Carrito, 3 unidades" }).click();
    const cart = buyerPage.getByRole("dialog", { name: "Carrito" });
    await browserExpect(cart.getByRole("listitem")).toHaveCount(2);
    await browserExpect(cart.getByText("S/ 135.00", { exact: true })).toBeVisible();
    await cart.getByRole("button", { name: "Continuar" }).click();

    await buyerPage.waitForURL(new RegExp(`/checkout/${companyId}/`));
    await browserExpect(buyerPage.getByRole("heading", { name: "Pedido #1001" })).toBeVisible();
    const orderId = buyerPage.url().split("/").at(-1)!;
    const orders = await page.request.get("/api/orders");
    expect(orders.status()).toBe(200);
    expect(JSON.stringify(await orders.json())).not.toContain(orderId);
    expect((await page.request.get(`/api/orders/${orderId}`)).status()).toBe(404);

    await buyerPage.getByLabel("Nombre", { exact: true }).fill("Ana");
    await buyerPage.getByLabel("Teléfono", { exact: true }).fill("+51987654321");
    await buyerPage.getByLabel("Recojo en tienda · Gratis").check();
    await buyerPage.getByLabel("Nombre del destinatario").fill("Ana");
    await buyerPage.getByLabel("Teléfono del destinatario").fill("+51987654321");
    await buyerPage.getByRole("button", { name: "Confirmar pedido", exact: true }).click();
    await browserExpect(buyerPage.getByRole("region", { name: "Pago del pedido", exact: true })).toBeVisible();
    await expect.poll(() => requestLogs(requestId).filter((event) => event.event === "order_checkout_confirmed")).toEqual([
      expect.objectContaining({ companyId, orderNumber: 1001, fromCatalog: true }),
    ]);
    expect(requestLogs(requestId)).toContainEqual(expect.objectContaining({ event: "catalog_order_created", companyId, orderNumber: 1001, linesCount: 2 }));
    expect(JSON.stringify(requestLogs(requestId))).not.toContain(orderId);

    await buyerPage.goto(url.pathname);
    await buyerPage.getByRole("button", { name: "Carrito, 0 unidades" }).click();
    await browserExpect(buyerPage.getByRole("dialog", { name: "Carrito" }).getByText("Tu carrito está vacío")).toBeVisible();

    await page.goto("/es-PE/orders");
    const table = page.getByRole("table", { name: "Órdenes" });
    await browserExpect(table.getByRole("link", { name: "Pedido #1001" })).toBeVisible();
    await browserExpect(table.getByText("Desde el catálogo", { exact: true })).toBeVisible();
    await browserExpect(table.getByText("Confirmado por el comprador", { exact: true })).toBeVisible();
    await page.goto(`/es-PE/orders/${orderId}`);
    await browserExpect(page.getByText("Desde el catálogo", { exact: true })).toBeVisible();
    await browserExpect(page.getByText("S/ 135.00").first()).toBeVisible();
  } finally {
    await buyer.close();
    await withTenantIsolation(companyId, async () => {
      await prisma.payment.deleteMany(); await prisma.orderItem.deleteMany(); await prisma.order.deleteMany();
      await prisma.productStock.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.product.deleteMany();
      await prisma.companyDeliverySettings.deleteMany();
      await systemPrisma.user.deleteMany({ where: { email } }); await prisma.company.delete({ where: { id: companyId } });
    });
  }
});
