import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { browserExpect, expect, prepareVerifiedCompany, publishCatalog, storeUrl, subdomainOf, test } from "@core/tests/e2e/fixtures";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { seedProduct } from "@core/src/features/products/infrastructure/product-seed";

const baseURL = `http://127.0.0.1:${process.env.CORE_E2E_PORT ?? "4173"}`;

function requestLogs(requestId: string) {
  return readFileSync("test-results/server.jsonl", "utf8").trim().split("\n")
    .flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } })
    .filter((event) => event.requestId === requestId);
}

test("buyer opens the brand host, adds two variants, continues to checkout on the brand host, confirms and finds an empty cart back in the store", async ({ page }) => {
  const email = `catalog-seller-${randomUUID()}@example.test`;
  const companyId = await prepareVerifiedCompany(page, { email, name: "Seller", companyName: "Tienda del catálogo", country: "PE" });
  const buyer = await page.context().browser()!.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  const buyerPage = await buyer.newPage();
  const requestId = `catalog-${randomUUID()}`;
  await buyerPage.setExtraHTTPHeaders({ "x-request-id": requestId });
  try {
    await withTenantIsolation(companyId, () => seedProduct({ name: "Polo básico", variants: [
      { attributes: { Talla: "M", Color: "Negro" }, salePrice: 45, stock: 5 },
      { attributes: { Talla: "L", Color: "Negro" }, salePrice: 45, stock: 5 },
    ] }));
    await page.goto("/es-PE/settings/delivery");
    await page.getByLabel("Ofrecer recojo en tienda").click();
    await page.getByLabel("Nombre del punto de recojo").fill("Tienda");
    await page.getByLabel("Dirección", { exact: true }).fill("Av. Larco 123");
    await page.getByLabel("Dirección", { exact: true }).blur();
    await browserExpect(page.getByText("Guardado", { exact: true })).toBeVisible();
    await browserExpect(page.getByLabel("Ofrecer recojo en tienda")).toBeChecked();

    // Choosing and publishing the link is the seller specs' job (catalog-link.spec.ts); the buyer starts from a published store.
    const subdomain = subdomainOf(companyId);
    const storeAddress = await publishCatalog(companyId, subdomain);

    const catalog = await buyerPage.goto(storeAddress);
    expect(catalog?.headers()["referrer-policy"]).toBe("no-referrer");
    await browserExpect(buyerPage.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
    await browserExpect(async () => {
      await buyerPage.getByRole("searchbox", { name: "Buscar productos" }).fill("polo");
      await buyerPage.waitForURL(/\?q=polo$/, { timeout: 1000 });
    }).toPass({ timeout: 10_000 });
    await buyerPage.getByRole("link", { name: /Polo básico/ }).click();
    await buyerPage.waitForURL(/\/productos\/[0-9a-f-]{36}$/);
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

    // The checkout opens on the same brand host.
    await buyerPage.waitForURL(new RegExp(`^${storeUrl(subdomain).replaceAll(".", "\\.")}checkout/[0-9a-f-]{36}$`));
    await browserExpect(buyerPage.getByRole("heading", { name: "Pedido #1001" })).toBeVisible();
    const orderId = buyerPage.url().split("/").at(-1)!;
    const orders = await page.request.get("/api/orders");
    expect(orders.status()).toBe(200);
    expect(JSON.stringify(await orders.json())).not.toContain(orderId);
    expect((await page.request.get(`/api/orders/${orderId}`)).status()).toBe(404);

    await buyerPage.getByLabel("Nombre", { exact: true }).fill("Ana");
    await buyerPage.getByLabel("Teléfono", { exact: true }).fill("+51987654321");
    await buyerPage.getByLabel("Recojo en tienda · Gratis").check();
    await buyerPage.getByRole("button", { name: "Confirmar pedido", exact: true }).click();
    await browserExpect(buyerPage.getByRole("region", { name: "Pago del pedido", exact: true })).toBeVisible();
    await expect.poll(() => requestLogs(requestId).filter((event) => event.event === "order_checkout_confirmed")).toEqual([
      expect.objectContaining({ companyId, orderNumber: 1001, fromCatalog: true }),
    ]);
    expect(requestLogs(requestId)).toContainEqual(expect.objectContaining({ event: "catalog_order_created", companyId, orderNumber: 1001, linesCount: 2 }));
    expect(JSON.stringify(requestLogs(requestId))).not.toContain(orderId);

    await buyerPage.goto(storeAddress);
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
      await prisma.productStock.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.productOption.deleteMany(); await prisma.product.deleteMany();
      await prisma.companyDeliverySettings.deleteMany();
      await systemPrisma.user.deleteMany({ where: { email } }); await prisma.company.delete({ where: { id: companyId } });
    });
  }
});

test("a brand host serves only the storefront: other paths, hidden and unknown stores, the API and robots answer as designed", async ({ page }) => {
  const email = `catalog-edge-${randomUUID()}@example.test`;
  const companyId = await prepareVerifiedCompany(page, { email, name: "Seller", companyName: "Fantasio", country: "PE" });
  const subdomain = subdomainOf(companyId);
  // The test process resolves hosts by itself, so API calls go to the app address with the brand host in `Host`.
  const onBrandHost = (path: string) => page.request.get(`${baseURL}${path}`, { headers: { host: new URL(storeUrl(subdomain)).host }, maxRedirects: 0 });
  try {
    const storeAddress = await publishCatalog(companyId, subdomain);
    await withTenantIsolation(companyId, () => seedProduct({ name: "Polo básico", variants: [{ attributes: { Color: "Negro" }, salePrice: 45, stock: 5 }] }));

    const login = await page.goto(storeUrl(subdomain, "/login"));
    expect(login?.status()).toBe(404);
    expect(login?.headers()["referrer-policy"]).toBe("no-referrer");
    await browserExpect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
    await browserExpect(page.getByRole("heading", { name: "No encontramos esta página" })).toBeVisible();
    await browserExpect(page.getByText("Fantasio", { exact: true }).first()).toBeVisible();
    expect(await page.getByRole("heading", { name: "Página no encontrada" }).count()).toBe(0);
    await page.getByRole("link", { name: "Volver al catálogo" }).click();
    await page.waitForURL(storeAddress);
    await browserExpect(page.getByRole("link", { name: /Polo básico/ })).toBeVisible();
    expect((await page.goto(storeUrl(subdomain, "/settings")))?.status()).toBe(404);

    const api = await onBrandHost("/api/me");
    expect(api.status()).toBe(404);
    expect(await api.json()).toEqual({ code: "NOT_FOUND", error: "Not found" });
    expect(await (await onBrandHost("/robots.txt")).text()).toContain("Disallow: /");
    expect((await onBrandHost("/wp-login.php")).status()).toBe(404);

    const unknown = await page.goto(storeUrl("no-existe", "/"));
    expect(unknown?.status()).toBe(404);
    expect(unknown?.headers()["referrer-policy"]).toBe("no-referrer");
    await browserExpect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
    await browserExpect(page).toHaveTitle("Catálogo no disponible");
    await browserExpect(page.getByRole("heading", { name: "Catálogo no disponible" })).toBeVisible();
    const unknownBody = await page.content();

    // A hidden catalog reads exactly like an unknown host.
    await withTenantIsolation(companyId, async () => await prisma.company.update({ where: { id: companyId }, data: { catalogPublished: false } }));
    const hidden = await page.goto(storeAddress);
    expect(hidden?.status()).toBe(404);
    expect(hidden?.headers()["referrer-policy"]).toBe("no-referrer");
    const cart = await onBrandHost(`/carrito?v=${randomUUID()}`);
    expect(cart.status()).toBe(404);
    expect(await cart.json()).toEqual({ code: "CATALOG_UNAVAILABLE" });
    expect(strip(await page.content())).toBe(strip(unknownBody));
    // A checkout that is no order of this host's company is the same «Catálogo no disponible» on a hidden or unknown host; the app host does not serve it at all.
    for (const host of [subdomain, "no-existe"]) {
      const checkout = await page.goto(storeUrl(host, `/checkout/${randomUUID()}`));
      expect(checkout?.status()).toBe(404);
      expect(checkout?.headers()["referrer-policy"]).toBe("no-referrer");
      expect(strip(await page.content())).toBe(strip(unknownBody));
    }
    expect((await page.request.get(`/checkout/${randomUUID()}`, { maxRedirects: 0 })).status()).toBe(404);
    expect((await onBrandHost(`/api/buyer/orders/${randomUUID()}/payment`)).status()).toBe(404);
    expect((await page.request.get(`/api/buyer/orders/${randomUUID()}/payment`)).status()).toBe(404);

    // The legacy address redirects permanently once published, and says unavailable while hidden.
    const legacy = `/catalogo/${companyId}/productos/${randomUUID()}?x=1`;
    expect((await page.request.get(legacy, { maxRedirects: 0 })).status()).toBe(404);
    await withTenantIsolation(companyId, async () => await prisma.company.update({ where: { id: companyId }, data: { catalogPublished: true } }));
    const redirect = await page.request.get(legacy, { maxRedirects: 0 });
    expect(redirect.status()).toBe(308);
    expect(redirect.headers()["cache-control"]).toBe("no-store");
    expect(redirect.headers().location).toBe(storeUrl(subdomain, legacy.replace(`/catalogo/${companyId}`, "")));
  } finally {
    await withTenantIsolation(companyId, async () => {
      await prisma.productStock.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.productOption.deleteMany(); await prisma.product.deleteMany();
      await systemPrisma.user.deleteMany({ where: { email } }); await prisma.company.delete({ where: { id: companyId } });
    });
  }
});

/** The page without the build-specific bits (script and stylesheet hashes, hydration payloads) that differ per request. */
const strip = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<link[^>]*>/g, "");
