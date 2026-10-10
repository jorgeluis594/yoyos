import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { browserExpect, expect, test } from "@core/tests/e2e/fixtures";
import { products } from "@core/src/features/products/composition";
import { orders } from "@core/src/features/orders/composition";
import { checkoutPalette } from "@core/src/features/checkout-appearance";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { removeCompanyAppearance, saveCompanyAppearance } from "@core/tests/e2e/checkout-appearance-fixtures";
import type { CompanyId, ContactId, OrderId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";

const logoSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#2F6B4F"/></svg>';
const forest = checkoutPalette("forest", "brand_tint");

function requestLogs(requestId: string) {
  return readFileSync("test-results/server.jsonl", "utf8").trim().split("\n")
    .flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } })
    .filter((event) => event.requestId === requestId);
}

async function fixture() {
  const companyId = randomUUID() as CompanyId;
  const userId = randomUUID() as UserId;
  const orderId = randomUUID() as OrderId;
  const contactId = randomUUID() as ContactId;
  await withTenantIsolation(companyId, async () => {
    await prisma.company.create({ data: { id: companyId, name: "Tienda con marca", country: "PE" } });
    await systemPrisma.user.create({ data: { id: userId, name: "Seller", email: `${userId}@example.test`, companyId } });
    const product = await products.create({ name: "Cuaderno", currency: "PEN", variants: [{ attributes: { Color: "Azul" }, salePrice: 10, initialStock: 3 }] });
    if (!product.success) throw new Error("Product fixture failed");
    const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: product.data } });
    await prisma.contact.create({ data: { id: contactId, name: "Ana", phone: "+51987654321" } });
    const created = await orders.create({ id: orderId, contactId, items: [{ variantId: variant.id as VariantId, quantity: 1 as PositiveInteger }] }, { companyId, userId });
    if (!created.success) throw new Error("Order fixture failed");
    await prisma.order.update({ where: { id: orderId }, data: { delivery: { method: "home",
      recipient: { name: "Recipient", phone: "999", identity: { kind: "absent" } }, destination: { address: "Historical address", district: "Lima", instructions: null },
      recordedBy: { kind: "seller", userId } } } });
    expect(await orders.enableCheckout(orderId, { companyId, userId })).toMatchObject({ success: true });
  });
  return { companyId, userId, orderId, path: `/checkout/${companyId}/${orderId}`,
    cancel: () => withTenantIsolation(companyId, () => orders.cancel(orderId, { companyId, userId })),
    async cleanup() {
      await removeCompanyAppearance(companyId);
      await withTenantIsolation(companyId, async () => {
        await prisma.payment.deleteMany(); await prisma.orderItem.deleteMany(); await prisma.order.deleteMany();
        await prisma.contact.deleteMany(); await prisma.productStock.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.product.deleteMany();
        await systemPrisma.user.delete({ where: { id: userId } }); await prisma.company.delete({ where: { id: companyId } });
      });
    },
  };
}

const primary = (page: import("@playwright/test").Page) =>
  page.locator("[data-checkout-theme]").evaluate((element) => getComputedStyle(element).getPropertyValue("--primary").trim().toUpperCase());

test.describe("buyer checkout with appearance", () => {
  test("shows the logo and brand colors in every order state", async ({ page }) => {
    const f = await fixture();
    const requestId = `appearance-${randomUUID()}`;
    try {
      await saveCompanyAppearance(f.companyId, { brandColor: "forest", background: "brand_tint", withLogo: true });
      await page.route("**/test-images/**", (route) => route.fulfill({ status: 200, contentType: "image/svg+xml", body: logoSvg }));
      await page.setExtraHTTPHeaders({ "x-request-id": requestId });
      const html = await (await page.request.get(f.path, { headers: { "x-request-id": requestId } })).text();
      expect(html).toContain("<style>[data-checkout-theme=");
      expect(html.toUpperCase()).toContain(forest.light.primary.toUpperCase());
      await page.emulateMedia({ colorScheme: "light" });
      await page.goto(f.path);
      await browserExpect(page.locator("[data-slot=brand-logo] img")).toBeVisible();
      await browserExpect.poll(() => primary(page)).toBe(forest.light.primary.toUpperCase());
      await page.emulateMedia({ colorScheme: "dark" });
      await page.reload();
      await browserExpect.poll(() => primary(page)).toBe(forest.dark.primary.toUpperCase());
      await page.emulateMedia({ colorScheme: "light" });
      await page.reload();
      await page.getByRole("button", { name: "Confirmar pedido", exact: true }).click();
      await browserExpect(page.getByRole("region", { name: "Pago del pedido", exact: true })).toBeVisible();
      await browserExpect(page.locator("[data-slot=brand-logo] img")).toBeVisible();
      await browserExpect.poll(() => primary(page)).toBe(forest.light.primary.toUpperCase());
      await f.cancel();
      await page.goto(f.path);
      await browserExpect(page.getByRole("heading", { name: "Pedido cancelado", exact: true })).toBeVisible();
      await browserExpect(page.locator("[data-slot=brand-logo] img")).toBeVisible();
      await expect.poll(() => requestLogs(requestId).some((event) => event.event === "http_request_completed" && event.checkoutAppearance === "custom")).toBe(true);
      expect(JSON.stringify(requestLogs(requestId))).not.toContain("test-images");
    } finally { await f.cleanup(); }
  });

  test("shows the company name when the logo fails to load", async ({ page }) => {
    const f = await fixture();
    try {
      await saveCompanyAppearance(f.companyId, { brandColor: "forest", background: "brand_tint", withLogo: true });
      await page.route("**/test-images/**", (route) => route.fulfill({ status: 404 }));
      await page.goto(f.path);
      await browserExpect(page.getByText("Tienda con marca", { exact: true })).toBeVisible();
      await browserExpect(page.locator("[data-slot=brand-logo]")).toHaveCount(0);
      await browserExpect.poll(() => primary(page)).toBe(forest.light.primary.toUpperCase());
    } finally { await f.cleanup(); }
  });

  test("keeps the Yoyos look for a company without appearance", async ({ page }) => {
    const f = await fixture();
    const requestId = `appearance-${randomUUID()}`;
    try {
      const html = await (await page.request.get(f.path, { headers: { "x-request-id": requestId } })).text();
      expect(html).not.toContain("<style>[data-checkout-theme=");
      await expect.poll(() => requestLogs(requestId).some((event) => event.event === "http_request_completed" && event.checkoutAppearance === "default")).toBe(true);
    } finally { await f.cleanup(); }
  });

  test("shows the generic error without branding for an unauthorized link", async ({ page }) => {
    const f = await fixture();
    try {
      await saveCompanyAppearance(f.companyId, { brandColor: "forest", background: "brand_tint", withLogo: false });
      for (const path of [`/checkout/${f.companyId}/${randomUUID()}`, `/checkout/${randomUUID()}/${f.orderId}`, "/checkout/bad/1001"]) {
        const response = await page.goto(path);
        expect(response?.status()).toBe(404);
        await browserExpect(page.getByRole("heading", { name: "Enlace no disponible" })).toBeVisible();
        expect(await page.content()).not.toContain("data-checkout-theme");
        await browserExpect(page.getByText("Tienda con marca")).toHaveCount(0);
      }
    } finally { await f.cleanup(); }
  });
});
