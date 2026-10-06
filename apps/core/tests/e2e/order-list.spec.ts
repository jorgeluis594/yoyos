import { browserExpect, expect, prepareVerifiedCompany, test } from "@core/tests/e2e/fixtures";
import { products } from "@core/src/features/products/composition";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

test("seller scans units and independent states, searches orders and combines work views with dates", async ({ page }) => {
  const email = `order-list-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    companyId = await prepareVerifiedCompany(page, { email, name: "Vendedor Demo", companyName: "Pedidos de prueba", country: "PE" });
    const tenantId = companyId;
    const { variantIds, contactId } = await withTenantIsolation(tenantId, async () => {
      const product = await products.create({ name: "Producto", currency: "PEN", variants: [
        { attributes: { Size: "M" }, salePrice: 10, initialStock: 20 },
        { attributes: { Size: "L" }, salePrice: 20, initialStock: 20 },
      ] });
      if (!product.success) throw new Error("Product setup failed");
      const variants = await prisma.productVariant.findMany({ where: { productId: product.data }, orderBy: { salePrice: "asc" } });
      const contact = await prisma.contact.create({ data: { id: crypto.randomUUID(), name: "Ana María Fernández del Castillo", phone: "+51912345678" } });
      return { variantIds: variants.map((variant) => variant.id), contactId: contact.id };
    });
    const summaries: { id: string; number: number; kind: string }[] = [];
    for (const [index, kind] of ["partial", "paid", "shipped", "completed", "cancelled", "historical"].entries()) {
      const id = crypto.randomUUID();
      const complete = kind === "completed" || kind === "historical";
      const created = await page.request.post("/api/orders", { data: { id, contactId: complete ? null : contactId,
        items: kind === "partial" ? [{ variantId: variantIds[0], quantity: 3 }, { variantId: variantIds[1], quantity: 2 }]
          : [{ variantId: variantIds[0], quantity: 1 }],
        ...(complete ? { payment: { method: "digital_wallet" }, delivery: { method: "handover" } } : {}),
      } });
      expect(created.status()).toBe(201);
      summaries.push({ id, number: (await created.json()).number, kind });
      if (["partial", "paid", "shipped"].includes(kind)) {
        expect((await page.request.post(`/api/orders/${id}/payments`, { data: { paymentId: crypto.randomUUID(),
          amount: { amount: kind === "partial" ? 20 : 10, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false } })).ok()).toBe(true);
      }
      if (kind === "shipped") expect((await page.request.post(`/api/orders/${id}/ship`)).ok()).toBe(true);
      if (kind === "cancelled") expect((await page.request.post(`/api/orders/${id}/cancel`)).ok()).toBe(true);
      await withTenantIsolation(tenantId, async () => await prisma.order.update({ where: { id }, data: {
        createdAt: new Date(kind === "historical" ? "2020-01-01T12:00:00Z" : `2026-10-${String(6 - index).padStart(2, "0")}T13:00:00Z`),
      } }));
    }
    await page.goto("/es-PE/orders");
    const table = page.getByRole("table", { name: "Órdenes" });
    const rows = table.locator("tbody tr");
    const row = (kind: string) => rows.filter({ hasText: `Pedido #${summaries.find((summary) => summary.kind === kind)!.number}` });
    await browserExpect(page.getByRole("navigation", { name: "Vistas de pedidos" }).getByRole("link", { name: "Todos", exact: true })).toHaveAttribute("aria-current", "page");
    await browserExpect(rows).toHaveCount(6);
    await browserExpect(table.getByRole("columnheader")).toHaveText(["Cliente", "Fecha", "Unidades", "Total", "Pago", "Entrega"]);
    await browserExpect(row("partial").locator('[data-column="itemCount"]')).toHaveText("5");
    await browserExpect(row("partial").locator('[data-column="paymentStatus"]')).toContainText("Por cobrar: S/ 50.00");
    await browserExpect(row("shipped").locator('[data-column="deliveryStatus"]')).toHaveText("Despachada");
    for (const kind of ["completed", "historical", "cancelled"]) {
      await browserExpect(row(kind).locator('[data-column="customer"]')).toContainText(kind === "cancelled" ? "Cancelado" : "Completado");
      await browserExpect(row(kind).locator('[data-column="paymentStatus"]')).toHaveText("—");
      await browserExpect(row(kind).locator('[data-column="deliveryStatus"]')).toHaveText("—");
    }
    await page.getByRole("link", { name: "Por cobrar", exact: true }).click();
    await browserExpect(rows).toHaveCount(1);
    await page.getByRole("link", { name: "Por entregar", exact: true }).click();
    await browserExpect(rows).toHaveCount(3);
    await page.getByRole("link", { name: "Todos", exact: true }).click();
    await browserExpect(rows).toHaveCount(6);
    for (const [query, count] of [["Ana María", 4], ["912345678", 4], [`#${summaries.find((summary) => summary.kind === "shipped")!.number}`, 1]] as const) {
      await page.getByRole("searchbox", { name: "Buscar por nombre, teléfono o número de pedido" }).fill(query);
      await page.getByRole("button", { name: "Buscar pedidos", exact: true }).click();
      await browserExpect(page).toHaveURL((url) => url.searchParams.get("search") === query);
      await browserExpect(rows).toHaveCount(count);
    }
    await page.getByRole("link", { name: "Por entregar", exact: true }).click();
    await browserExpect(page).toHaveURL((url) => url.searchParams.get("view") === "undelivered");
    await browserExpect(rows).toHaveCount(1);
    await browserExpect(page.getByRole("searchbox")).toHaveValue(`#${summaries.find((summary) => summary.kind === "shipped")!.number}`);
    await page.getByRole("button", { name: "Filtros", exact: true }).click();
    await page.getByLabel("Desde", { exact: true }).fill("2026-10-04");
    await page.getByLabel("Antes de", { exact: true }).fill("2026-10-05");
    await page.getByRole("button", { name: "Aplicar filtros" }).click();
    await browserExpect(rows).toHaveCount(1);
    await browserExpect(page).toHaveURL(/view=undelivered/);
    await page.getByRole("link", { name: "Por cobrar", exact: true }).click();
    await browserExpect(page.getByText("No hay órdenes para estos filtros.")).toBeVisible();
    await page.getByRole("link", { name: "Limpiar", exact: true }).click();
    await browserExpect(rows).toHaveCount(6);

    // Real test orders, captured in both themes and the existing responsive table layouts.
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      for (const [name, width, height] of [["desktop", 1280, 900], ["intermediate", 1056, 900], ["mobile", 390, 844]] as const) {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => document.fonts.ready);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: `test-results/order-list-${name}-${theme}.png`, fullPage: true, animations: "disabled" });
      }
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/pt-BR/orders");
    await browserExpect(page.getByRole("columnheader")).toHaveText(["Cliente", "Data", "Unidades", "Total", "Pagamento", "Entrega"]);
    await browserExpect(page.getByText("Concluído", { exact: true })).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: "test-results/order-list-desktop-pt.png", fullPage: true, animations: "disabled" });
  } finally {
    if (companyId) await withTenantIsolation(companyId, async () => {
      await prisma.payment.deleteMany(); await prisma.orderItem.deleteMany(); await prisma.order.deleteMany();
      await prisma.contact.deleteMany(); await prisma.productStock.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.product.deleteMany();
      await systemPrisma.user.deleteMany({ where: { email } });
      await prisma.company.delete({ where: { id: companyId } });
    });
  }
});
