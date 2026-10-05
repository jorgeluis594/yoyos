import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";
import { vi } from "vitest";
import { browserExpect, expect, prepareVerifiedCompany, test } from "@core/tests/e2e/fixtures";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { products } from "@core/src/features/products/composition";
import { orders } from "@core/src/features/orders/composition";
import type { CompanyId, OrderId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";

test("normal composition saves configuration but never assigns an invented delivery cost", async () => {
  const baseURL = "http://127.0.0.1:4174";
  const server = spawn("node", ["--import", "tsx", "src/server.ts"], { env: { ...process.env, PORT: "4174", BETTER_AUTH_URL: baseURL }, stdio: "inherit" });
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  const email = `no-tariffs-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    await vi.waitFor(async () => {
      expect(server.exitCode).toBeNull();
      expect((await fetch(`${baseURL}/login`)).ok).toBe(true);
    }, { timeout: 120_000, interval: 200 });
    companyId = await prepareVerifiedCompany(page, { email, name: "Seller", companyName: "No tariffs", country: "PE" });
    const tenantId = companyId;
    await page.goto("/es-PE/settings/delivery");
    await page.getByLabel("Ofrecer recojo en tienda").check();
    await page.getByLabel("Nombre del punto de recojo").fill("Pickup");
    await page.getByLabel("Dirección", { exact: true }).fill("Lima");
    await page.getByRole("button", { name: "Guardar configuración" }).click();
    await browserExpect(page.getByRole("status")).toHaveText("Configuración guardada.");
    await page.reload();
    await browserExpect(page.getByLabel("Dirección", { exact: true })).toHaveValue("Lima");
    const sellerId = (await systemPrisma.user.findUniqueOrThrow({ where: { email } })).id;
    const orderId = crypto.randomUUID();
    const variantId = await withTenantIsolation(tenantId, async () => {
      const product = await products.create({ name: "Product", currency: "PEN", variants: [{ attributes: {}, salePrice: 10, initialStock: 3 }] });
      if (!product.success) throw new Error("Expected product");
      const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: product.data } });
      expect(await orders.create({ id: orderId as OrderId, contactId: null, items: [{ variantId: variant.id as VariantId, quantity: 1 as PositiveInteger }] }, { companyId: tenantId as CompanyId, userId: sellerId as UserId })).toMatchObject({ success: true });
      return variant.id;
    });
    await page.goto(`/es-PE/orders/${orderId}`);
    await page.getByLabel("Nombre del destinatario").fill("Recipient");
    await page.getByLabel("Teléfono del destinatario").fill("00123");
    await page.getByRole("button", { name: "Guardar entrega" }).click();
    await browserExpect(page.getByRole("alert")).toContainText("No se pudo confirmar");
    await browserExpect(page.getByLabel("Nombre del destinatario")).toHaveValue("Recipient");
    expect(await (await page.request.get(`/api/orders/${orderId}/aggregate`)).json()).toMatchObject({ delivery: null, total: { amount: 10 }, stockDeducted: false });
    await page.reload();
    await browserExpect(page.getByText("Entrega por definir", { exact: true })).toBeVisible();
    await mkdir("../../.impeccable/review", { recursive: true });
    for (const [width, height, label] of [[1280, 900, "desktop"], [390, 844, "mobile"]] as const) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: `../../.impeccable/review/undefined-delivery-${label}.png`, fullPage: true });
    }
    expect(await withTenantIsolation(tenantId, async () => (await prisma.productStock.findUniqueOrThrow({ where: { variantId } })).quantity)).toBe(3n);
  } finally {
    await browser.close();
    server.kill();
    if (server.exitCode === null) await new Promise<void>(resolve => server.once("exit", () => resolve()));
    if (companyId) await withTenantIsolation(companyId, async () => {
      await prisma.payment.deleteMany(); await prisma.orderItem.deleteMany(); await prisma.order.deleteMany();
      await prisma.productStock.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.product.deleteMany();
      await prisma.companyDeliverySettings.deleteMany();
      await systemPrisma.user.deleteMany({ where: { email } });
      await prisma.company.delete({ where: { id: companyId } });
    });
  }
});
