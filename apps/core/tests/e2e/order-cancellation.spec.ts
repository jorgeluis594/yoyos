import type { Page } from "@playwright/test";
import { vi } from "vitest";
import pg from "pg";
import { browserExpect, expect, prepareVerifiedCompany, test } from "@core/tests/e2e/fixtures";
import { products } from "@core/src/features/products/composition";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { createEventBusRuntime } from "@core/src/composition/event-bus";
import { bootstrapEventHandlers, eventHandlers } from "@core/src/composition/event-handlers";

async function fixture(page: Page) {
  const email = `cancellation-${crypto.randomUUID()}@example.test`;
  const companyId = await prepareVerifiedCompany(page, { email, name: "Seller", companyName: "Cancellation", country: "PE" });
  const variantId = await withTenantIsolation(companyId, async () => {
    const product = await products.create({ name: "Cancellation product", currency: "PEN", variants: [{ attributes: {}, salePrice: 10, initialStock: 20 }] });
    if (!product.success) throw new Error("Product setup failed");
    return (await prisma.productVariant.findFirstOrThrow({ where: { productId: product.data } })).id;
  });
  return { companyId, variantId,
    stock: () => withTenantIsolation(companyId, async () => (await prisma.productStock.findUniqueOrThrow({ where: { variantId } })).quantity),
    async create(paid = 0) {
      const id = crypto.randomUUID();
      expect((await page.request.post("/api/orders/pending", { data: { id, contactId: null, items: [{ variantId, quantity: 1 }] } })).status()).toBe(201);
      if (paid) expect((await page.request.post(`/api/orders/${id}/payments`, { data: { paymentId: crypto.randomUUID(), amount: { amount: paid, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: true } })).ok()).toBe(true);
      return id;
    },
    async detail(id: string) { return (await page.request.get(`/api/orders/${id}/aggregate`)).json(); },
    async cleanup() {
      const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
      try { await pool.query("DELETE FROM pgboss.job WHERE data->'payload'->>'companyId' = $1", [companyId]); }
      finally { await pool.end(); }
      await withTenantIsolation(companyId, async () => {
        await prisma.payment.deleteMany(); await prisma.orderItem.deleteMany(); await prisma.order.deleteMany();
        await prisma.productStock.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.product.deleteMany();
        await systemPrisma.user.deleteMany({ where: { email } }); await prisma.company.delete({ where: { id: companyId } });
      });
    },
  };
}

async function confirm(page: Page) {
  await page.getByRole("button", { name: "Cancelar pedido", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancelar pedido", exact: true }).click();
}

test("core confirms cancellation, retains payments and updates operational views in both languages", async ({ page }) => {
  const f = await fixture(page);
  const { provider } = createEventBusRuntime(true);
  try {
    await provider.start();
    expect(await bootstrapEventHandlers(provider, eventHandlers)()).toMatchObject({ success: true });
    for (const paid of [0, 4, 10]) {
      const id = await f.create(paid);
      const before = await f.detail(id);
      const stock = await f.stock();
      await page.goto(`/es-PE/orders/${id}`);
      await page.getByRole("button", { name: "Cancelar pedido", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await browserExpect(dialog).toContainText("después de cancelar");
      await browserExpect(dialog).toContainText("No podrás reabrir");
      await dialog.getByRole("button", { name: "Conservar pedido" }).click();
      expect((await f.detail(id)).cancelled).toBe(false);
      await page.getByRole("button", { name: "Cancelar pedido", exact: true }).click();
      await page.keyboard.press("Escape");
      expect((await f.detail(id)).cancelled).toBe(false);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("button", { name: "Cancelar pedido", exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `/tmp/order-cancellation-confirm-${paid}.png`, fullPage: true });
      if (!paid) { await page.keyboard.press("Tab"); await page.keyboard.press("Enter"); }
      else await page.getByRole("dialog").getByRole("button", { name: "Cancelar pedido", exact: true }).click();
      await browserExpect(page.getByRole("status")).toContainText("Pedido cancelado");
      await browserExpect(page.getByRole("button", { name: "Cancelar pedido", exact: true })).toHaveCount(0);
      await browserExpect(page.getByRole("button", { name: "Marcar enviado", exact: true })).toHaveCount(0);
      await browserExpect(page.getByText("Entrega: Pendiente", { exact: true })).toHaveCount(0);
      expect((await f.detail(id)).payments).toEqual(before.payments);
      await vi.waitFor(async () => expect(await f.stock()).toBe(stock + (paid ? 1n : 0n)), { timeout: 15000 });
      await page.reload();
      await browserExpect(page.getByRole("status")).toContainText("Pedido cancelado");
      await page.getByRole("link", { name: "Ver ventas", exact: true }).click();
      await browserExpect(page.getByRole("link", { name: `Pedido #${before.number}`, exact: true })).toBeVisible();
      for (const view of ["unpaid", "undelivered"]) {
        await page.goto(`/es-PE/orders?view=${view}`);
        await browserExpect(page.getByRole("link", { name: `Pedido #${before.number}`, exact: true })).toHaveCount(0);
      }
    }
    const portuguese = await f.create();
    await page.goto(`/pt-BR/orders/${portuguese}`);
    await page.getByRole("button", { name: "Cancelar pedido", exact: true }).click();
    await browserExpect(page.getByRole("dialog")).toContainText("Você não poderá reabrir");
    await page.getByRole("dialog").getByRole("button", { name: "Manter pedido" }).click();
    expect((await f.detail(portuguese)).cancelled).toBe(false);
    await page.getByRole("button", { name: "Cancelar pedido", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Cancelar pedido", exact: true }).click();
    await browserExpect(page.getByRole("status")).toContainText("Pedido cancelado");
  } finally { await provider.stop(); await f.cleanup(); }
}, 120000);

test("core resolves a committed lost response, offers manual verification and reloads a dispatch conflict", async ({ page }) => {
  const f = await fixture(page);
  try {
    for (const uncertain of [false, true]) {
      const id = await f.create(4);
      const dataRoute = new RegExp(`/orders/${id}\\.data(?:\\?|$)`);
      await page.goto(`/es-PE/orders/${id}`);
      let submitted = 0;
      let release!: () => void;
      let reached!: () => void;
      const held = new Promise<void>(resolve => { release = resolve; });
      const committed = new Promise<void>(resolve => { reached = resolve; });
      await page.route(dataRoute, async route => {
        if (route.request().method() !== "POST") return route.continue();
        submitted++;
        await route.fetch();
        expect((await f.detail(id)).cancelled).toBe(true);
        reached(); await held;
        await route.abort("failed");
      });
      if (uncertain) await page.route(`**/api/orders/${id}/aggregate`, route => route.abort("failed"));
      await confirm(page);
      await committed;
      await browserExpect(page.getByRole("button", { name: "Marcar enviado", exact: true })).toBeDisabled();
      await browserExpect(page.getByRole("button", { name: "Confirmar pago", exact: true })).toBeDisabled();
      await browserExpect(page.getByRole("button", { name: "Anular pago", exact: true })).toBeDisabled();
      await browserExpect(page.getByRole("button", { name: "Cancelar pedido", exact: true })).toBeDisabled();
      release();
      if (uncertain) {
        await browserExpect(page.getByRole("alert")).toContainText("No pudimos confirmar si se canceló");
        await page.unroute(`**/api/orders/${id}/aggregate`);
        await page.getByRole("button", { name: "Consultar estado", exact: true }).click();
      }
      await browserExpect(page.getByRole("status")).toContainText("Pedido cancelado");
      expect(submitted).toBe(1);
      await page.unroute(dataRoute);
    }
    const id = await f.create(10);
    await page.goto(`/es-PE/orders/${id}`);
    expect((await page.request.post(`/api/orders/${id}/ship`)).ok()).toBe(true);
    await confirm(page);
    await browserExpect(page.getByRole("alert")).toContainText("ya fue enviado");
    await browserExpect(page.getByText("Entrega: Despachada", { exact: true })).toBeVisible();
    await browserExpect(page.getByRole("button", { name: "Cancelar pedido", exact: true })).toHaveCount(0);
  } finally { await f.cleanup(); }
}, 120000);
