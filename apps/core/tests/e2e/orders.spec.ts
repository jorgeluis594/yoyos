import { formatCurrency } from "@core/app/format-currency";
import { browserExpect, chooseOption, expect, openOptions, prepareVerifiedCompany, test } from "@core/tests/e2e/fixtures";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { productEditing } from "@core/src/features/products/product-editing";
import { orders } from "@core/src/features/orders/composition";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import type { CompanyId, OrderId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";
import { chooseDistrict, chooseDistrictInProvince } from "@core/tests/e2e/district-combobox";
import { seedProduct } from "@core/src/features/products/infrastructure/product-seed";
import { addToOrder, orderTotal } from "@core/tests/e2e/order-view-helpers";

test("seller completes a wallet sale and sees backend totals and stock", async ({ page, request }) => {
  // The browser's own leave warning on reload and close is accepted: this test reloads and navigates with a sale started.
  page.on("dialog", (dialog) => void dialog.accept());
  const email = `orders-${crypto.randomUUID()}@example.test`;
  const otherEmail = `orders-other-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    expect((await request.get("/es-PE/orders/new", { maxRedirects: 0 })).status()).toBe(302);
    expect((await request.get("/es-PE/orders", { maxRedirects: 0 })).status()).toBe(302);
    expect((await request.get(`/es-PE/orders/${crypto.randomUUID()}`, { maxRedirects: 0 })).status()).toBe(302);
    companyId = await prepareVerifiedCompany(page, { email, name: "Seller Orders", companyName: "Orders company", country: "PE" });
    await page.goto("/es-PE/dashboard");
    await browserExpect(page).toHaveURL(/\/es-PE\/dashboard$/);
    const tenantId = companyId;
    await withTenantIsolation(tenantId, () => seedProduct({ name: "Cuaderno POS", variants: [{ attributes: { Size: "M" }, sku: "POS-M", salePrice: 0.29, stock: 3 }] }));

    await page.getByRole("complementary").getByRole("link", { name: "Ventas" }).click();
    await page.getByRole("link", { name: "Nueva venta" }).click();
    await browserExpect(page.getByRole("heading", { name: "Nueva venta" })).toBeVisible();
    await addToOrder(page, "Cuaderno POS", "M");
    await browserExpect(orderTotal(page)).toHaveText(formatCurrency(0.29, "PEN", "es"));
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.setViewportSize({ width: 390, height: 500 });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await browserExpect(page.locator("div.fixed").getByRole("button", { name: "Guardar venta" })).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload();
    await browserExpect(page.getByText("Aún no hay productos")).toBeVisible();
    expect(await withTenantIsolation(tenantId, async () => await prisma.order.count())).toBe(0);
    await addToOrder(page, "Cuaderno POS", "M");
    await addToOrder(page, "Cuaderno POS", "M");
    await browserExpect(orderTotal(page)).toHaveText(formatCurrency(0.58, "PEN", "es"));
    await page.getByRole("button", { name: "Agregar Yape" }).click();
    await page.getByLabel("Importe recibido").fill("0.58");
    await page.getByLabel("Marcar como entregado al guardar").check();
    await page.getByRole("button", { name: "Guardar venta" }).click();
    await browserExpect(page).toHaveURL(/\/es-PE\/orders\/[0-9a-f-]+$/);
    await browserExpect(page.getByText("Venta completada", { exact: true })).toBeVisible();
    await browserExpect(page.getByText("Entrega por definir", { exact: true })).toHaveCount(0);
    await browserExpect(page.getByLabel("Nombre", { exact: true }).first()).toHaveValue("");
    await browserExpect(orderTotal(page)).toHaveText(formatCurrency(0.58, "PEN", "es"));
    const immediateId = page.url().split("/").at(-1)!;
    expect(await (await page.request.get(`/api/orders/${immediateId}/aggregate`)).json()).toMatchObject({
      status: "completed", paymentStatus: "paid", deliveryStatus: "delivered", stockDeducted: true,
      completedAt: expect.any(String), deliveredAt: expect.any(String),
      payments: [expect.objectContaining({ status: "confirmed", method: "digital_wallet", amount: { amount: 0.58, currency: "PEN" } })],
    });
    await page.getByRole("link", { name: "Ver ventas" }).click();
    await browserExpect(page.getByRole("heading", { name: /Ventas/ }).locator('[data-slot="page-header-count"]')).toHaveText("1");
    const stock = await withTenantIsolation(tenantId, async () => await prisma.productStock.findFirstOrThrow());
    expect(stock.quantity).toBe(1n);

    await page.getByRole("link", { name: "Nueva venta" }).click();
    await page.getByRole("button", { name: "Agregar producto" }).click();
    await browserExpect(page.getByRole("option", { name: "M, 1 en stock" })).toBeVisible();
    await page.getByRole("button", { name: /^Listo/ }).click();
    await addToOrder(page, "Cuaderno POS", "M");
    await addToOrder(page, "Cuaderno POS", "M");
    await page.getByRole("button", { name: "Agregar Yape" }).click();
    await page.getByLabel("Importe recibido").fill("0.58");
    await page.getByLabel("Marcar como entregado al guardar").check();
    await page.getByRole("button", { name: "Guardar venta" }).click();
    await browserExpect(page.getByRole("alert")).toContainText("No hay stock suficiente");
    expect(await withTenantIsolation(tenantId, async () => await prisma.order.count())).toBe(1);
    await page.getByLabel(/^Cantidad: Cuaderno POS/).fill("1");
    await page.getByLabel("Importe recibido").fill("0.30");
    await withTenantIsolation(tenantId, async () => await prisma.productVariant.update({ where: { id: stock.variantId }, data: { salePrice: 0.3 } }));
    await browserExpect(orderTotal(page)).toHaveText(formatCurrency(0.29, "PEN", "es"));
    await page.getByRole("button", { name: "Guardar venta" }).click();
    await browserExpect(page).toHaveURL(/\/es-PE\/orders\/[0-9a-f-]+$/);
    await browserExpect(orderTotal(page)).toHaveText(formatCurrency(0.30, "PEN", "es"));
    const completedUrl = page.url();
    await page.getByRole("link", { name: "Ver ventas" }).click();
    await page.getByRole("button", { name: "Filtros" }).click();
    await browserExpect(page.getByRole("dialog", { name: "Filtros de ventas" })).toBeVisible();
    await chooseOption(page, "Cliente", "Público general");
    await page.getByRole("button", { name: "Aplicar filtros" }).click();
    await browserExpect(page).toHaveURL(/customer=general_public/);
    await browserExpect(page.getByRole("heading", { name: /Ventas/ }).locator('[data-slot="page-header-count"]')).toHaveText("2");
    const tampered = await page.request.post("/es-PE/orders/new", { form: { order: JSON.stringify({ id: crypto.randomUUID(),
      companyId: crypto.randomUUID(), sellerId: crypto.randomUUID(), total: 0.01,
      items: [{ variantId: stock.variantId, quantity: 1 }] }) } });
    expect(await tampered.text()).toContain("Revisa los datos de la venta.");
    expect(await withTenantIsolation(tenantId, async () => await prisma.order.count())).toBe(2);

    await withTenantIsolation(tenantId, async () => await prisma.productStock.update({ where: { variantId: stock.variantId }, data: { quantity: 1n } }));
    await page.goto("/es-PE/orders/new");
    await addToOrder(page, "Cuaderno POS", "M");
    await page.getByRole("button", { name: "Agregar Yape" }).click();
    await page.getByLabel("Importe recibido").fill("0.30");
    await page.getByLabel("Marcar como entregado al guardar").check();
    const adminUrl = new URL(process.env.DATABASE_URL!);
    adminUrl.username = "core";
    adminUrl.password = "core";
    const admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: adminUrl.toString() }) });
    const triggerName = `reject_browser_sale_${crypto.randomUUID().replaceAll("-", "")}`;
    try {
      await admin.$executeRawUnsafe(`CREATE FUNCTION public.${triggerName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD."companyId" = '${tenantId}'::uuid THEN RAISE EXCEPTION 'test stock outage'; END IF; RETURN NEW; END $$`);
      await admin.$executeRawUnsafe(`CREATE TRIGGER ${triggerName} BEFORE UPDATE ON "ProductStock" FOR EACH ROW EXECUTE FUNCTION public.${triggerName}()`);
      await page.getByRole("button", { name: "Guardar venta" }).click();
      await browserExpect(page.getByRole("alert")).toContainText("No se pudo completar la venta");
      expect(await withTenantIsolation(tenantId, async () => await prisma.order.count())).toBe(2);
    } finally {
      await admin.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${triggerName} ON "ProductStock"`);
      await admin.$executeRawUnsafe(`DROP FUNCTION IF EXISTS public.${triggerName}()`);
      await admin.$disconnect();
    }
    await page.getByRole("button", { name: "Guardar venta" }).click();
    await browserExpect(page).toHaveURL(/\/es-PE\/orders\/[0-9a-f-]+$/);
    const recoveredId = page.url().split("/").at(-1)!;
    expect(await withTenantIsolation(tenantId, async () => await prisma.order.count())).toBe(3);
    const duplicate = await page.request.post("/es-PE/orders/new", { form: { order: JSON.stringify({ id: recoveredId,
      items: [{ variantId: stock.variantId, quantity: 1 }] }) } });
    expect(await duplicate.text()).toContain("Esta venta ya se registró");
    expect(await withTenantIsolation(tenantId, async () => await prisma.order.count())).toBe(3);

    await withTenantIsolation(tenantId, async () => {
      await prisma.productStock.update({ where: { variantId: stock.variantId }, data: { quantity: 25n } });
      const sellerId = (await systemPrisma.user.findUniqueOrThrow({ where: { email } })).id;
      for (let index = 0; index < 21; index++) {
        expect(await orders.registerImmediateSale({ id: crypto.randomUUID() as OrderId, 
          items: [{ variantId: stock.variantId as VariantId, quantity: 1 as PositiveInteger }] },
        { companyId: tenantId as CompanyId, userId: sellerId as UserId })).toMatchObject({ success: true });
      }
    });
    await page.goto("/es-PE/orders");
    await browserExpect(page.getByRole("table", { name: "Órdenes" }).getByRole("row")).toHaveCount(21);
    await page.getByRole("navigation", { name: "Páginas de ventas" }).getByRole("link", { name: "Siguiente" }).click();
    await browserExpect(page).toHaveURL(/page=2/);
    await browserExpect(page.getByRole("table", { name: "Órdenes" }).getByRole("row")).toHaveCount(5);
    await page.setViewportSize({ width: 390, height: 780 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await browserExpect(page.getByRole("searchbox", { name: "Buscar por nombre, teléfono o número de pedido" })).toBeVisible();
    await page.getByRole("button", { name: "Filtros" }).click();
    await page.getByLabel("Desde").fill("2020-01-01");
    await page.getByLabel("Antes de").fill("2020-01-02");
    await page.getByRole("button", { name: "Aplicar filtros" }).click();
    await browserExpect(page.getByText("No hay órdenes para estos filtros.")).toBeVisible();
    await page.getByRole("button", { name: /filtros activos/ }).click();
    await page.getByRole("link", { name: "Limpiar" }).click();
    await browserExpect(page).toHaveURL("/es-PE/orders");
    await browserExpect(page.getByRole("button", { name: "Filtros", exact: true })).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await browserExpect(page).toHaveURL(/\/login$/);
    await prepareVerifiedCompany(page, { email: otherEmail, name: "Other seller", companyName: "Other orders company", country: "US" });
    await page.goto("/es-US/dashboard");
    await browserExpect(page).toHaveURL(/\/es-US\/dashboard$/);
    await page.goto(completedUrl);
    await browserExpect(page).toHaveURL(/\/es-US\/orders\/[0-9a-f-]+$/);
    await browserExpect(page.getByRole("heading", { name: "Venta no encontrada" })).toBeVisible();
  } finally {
    for (const accountEmail of [email, otherEmail]) {
      const user = await systemPrisma.user.findUnique({ where: { email: accountEmail }, select: { companyId: true } });
      if (user?.companyId) await withTenantIsolation(user.companyId, async () => {
        await prisma.payment.deleteMany();
        await prisma.orderItem.deleteMany();
        await prisma.order.deleteMany();
        await prisma.contact.deleteMany();
        await prisma.productStock.deleteMany();
        await prisma.productVariant.deleteMany();
        await prisma.productOption.deleteMany();
        await prisma.product.deleteMany();
      });
      await systemPrisma.user.deleteMany({ where: { email: accountEmail } });
      if (user?.companyId) await withTenantIsolation(user.companyId, async () => await prisma.company.delete({ where: { id: user.companyId! } }));
    }
  }
});

test("pending order remains active when paid before delivery", async ({ page }) => {
  const email = `orders-pending-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    companyId = await prepareVerifiedCompany(page, { email, name: "Pending Seller", companyName: "Pending company", country: "PE" });
    const tenantId = companyId;
    const product = await withTenantIsolation(tenantId, () => productEditing.create({ name: "Producto pendiente", currency: "PEN",
      options: [], variants: [{ values: [], sku: "PENDING", salePrice: 10, initialStock: 2 }] }));
    expect(product.success).toBe(true);
    if (!product.success) return;
    const variantId = await withTenantIsolation(tenantId, async () => (await prisma.productVariant.findFirstOrThrow({ where: { productId: product.data } })).id);
    await page.goto("/es-PE/orders/new");
    await addToOrder(page, "Producto pendiente");
    await page.getByRole("button", { name: "Guardar venta" }).click();
    await browserExpect(page).toHaveURL(/\/orders\/[0-9a-f-]+$/);
    const orderId = page.url().split("/").at(-1)!;
    const pending = await (await page.request.get(`/api/orders/${orderId}/aggregate`)).json();
    expect(pending).toMatchObject({ status: "active", paymentStatus: "pending", deliveryStatus: "pending",
      payments: [], stockDeducted: false, deliveredAt: null, completedAt: null });
    expect(await withTenantIsolation(tenantId, async () => await prisma.payment.count({ where: { orderId } }))).toBe(0);
    await page.goto("/es-PE/orders");
    await browserExpect(page.getByRole("table", { name: "Órdenes" }).locator('summary[aria-label^="Estado del pago: Pago pendiente:"]')).toBeVisible();
    await page.getByRole("table", { name: "Órdenes" }).getByRole("link", { name: "Público general" }).click();
    await browserExpect(page).toHaveURL(new RegExp(`/orders/${orderId}$`));
    await browserExpect(page.getByRole("group", { name: "Estado del pago: Pago pendiente" })).toBeVisible();
    await browserExpect(page.getByText("Sin pagos · necesario para despachar")).toBeVisible();
    await browserExpect(page.getByText("Saldo pendiente").locator("xpath=following-sibling::dd")).toHaveText(formatCurrency(10, "PEN", "es"));
    expect(await withTenantIsolation(tenantId, async () => (await prisma.productStock.findUniqueOrThrow({ where: { variantId } })).quantity)).toBe(2n);
    const paymentId = crypto.randomUUID();
    const paid = await page.request.post(`/api/orders/${orderId}/payments`, { data: { paymentId,
      amount: { amount: 10, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false } });
    expect(paid.status()).toBe(200);
    await page.reload();
    await browserExpect(page.getByRole("group", { name: "Estado del pago: Pagada" })).toBeVisible();
    await browserExpect(page.getByRole("group", { name: "Estado de la entrega: Entrega pendiente" })).toBeVisible();
    expect(await withTenantIsolation(tenantId, async () => (await prisma.productStock.findUniqueOrThrow({ where: { variantId } })).quantity)).toBe(1n);
    expect(await withTenantIsolation(tenantId, async () => await prisma.payment.count({ where: { orderId } }))).toBe(1);
  } finally {
    const user = await systemPrisma.user.findUnique({ where: { email }, select: { companyId: true } });
    if (user?.companyId) await withTenantIsolation(user.companyId, async () => {
      await prisma.payment.deleteMany();
      await prisma.orderItem.deleteMany();
      await prisma.order.deleteMany();
      await prisma.productStock.deleteMany();
      await prisma.productVariant.deleteMany();
      await prisma.productOption.deleteMany();
      await prisma.product.deleteMany();
    });
    await systemPrisma.user.deleteMany({ where: { email } });
    if (user?.companyId) await withTenantIsolation(user.companyId, async () => await prisma.company.delete({ where: { id: user.companyId! } }));
  }
});

test("new order saves partial payments, paid pending delivery and configured delivery without partial writes", async ({ page }) => {
  const email = `orders-complete-${crypto.randomUUID()}@example.test`;
  try {
    const companyId = await prepareVerifiedCompany(page, { email, name: "Seller", companyName: "Complete orders", country: "PE" });
    const product = await withTenantIsolation(companyId, () => productEditing.create({ name: "Agenda", currency: "PEN",
      options: [], variants: [{ values: [], sku: "AGENDA", salePrice: 10, initialStock: 5 }] }));
    expect(product.success).toBe(true);
    expect((await page.request.put("/api/delivery-settings", { data: { expectedVersion: 0, home: { enabled: true },
      store: { enabled: false, pickupPoint: null }, agency: { enabled: false } } })).ok()).toBe(true);
    expect((await page.request.put("/api/delivery-settings/zones", { data: { expectedVersion: 1,
      zones: [{ kind: "new", name: "Creation zone", enabled: true, districtCodes: ["040110"], options: [{ kind: "new", method: "home", name: "Home", enabled: true, price: { amount: 3, currency: "PEN" } }] }] } })).ok()).toBe(true);
    for (const scenario of ["partial", "paid", "delivery", "no-stock"] as const) {
      if (scenario === "no-stock") await withTenantIsolation(companyId, async () => await prisma.productStock.updateMany({ data: { quantity: 0n } }));
      await page.goto("/es-PE/orders/new");
      await addToOrder(page, "Agenda");
      const total = (amount: number) => browserExpect(orderTotal(page)).toHaveText(formatCurrency(amount, "PEN", "es"));
      if (scenario !== "no-stock") {
        await page.getByRole("button", { name: "Agregar Yape" }).click();
        await page.getByLabel("Importe recibido").fill(scenario === "partial" ? "0.1" : "10");
      } else await browserExpect(page.getByText(/Disponible: 0/)).toBeVisible();
      if (scenario === "partial") {
        await page.getByRole("button", { name: "Agregar Yape" }).click();
        await page.getByLabel("Importe recibido").nth(1).fill("0.7");
        await browserExpect(page.getByText(`Pago parcial · falta ${formatCurrency(9.2, "PEN", "es")}`, { exact: true })).toBeVisible();
      }
      if (scenario === "delivery") {
        await page.getByRole("tab", { name: "Domicilio" }).click();
        await page.getByLabel("Dirección de entrega", { exact: true }).fill("Av. Lima 123");
        await chooseDistrict(page, "040110");
        const tariff = page.locator("#order-delivery-rateId");
        const chooseRate = async () => {
          const rates = await openOptions(page, "Tarifa de entrega");
          await browserExpect(rates).toHaveCount(1);
          await rates.first().click();
          return await tariff.innerText();
        };
        const rate = await chooseRate();
        expect(rate).toContain(formatCurrency(3, "PEN", "es"));
        await chooseDistrictInProvince(page, "040101");
        await browserExpect(page.getByRole("status").filter({ hasText: "No hay tarifas para esta modalidad y distrito." })).toBeVisible();
        await page.getByRole("button", { name: "Guardar venta" }).click();
        await browserExpect(page.getByText(/No se guardó: revisa \d+ campos? marcados?\./)).toBeVisible();
        await chooseDistrictInProvince(page, "040110");
        await browserExpect(tariff).not.toContainText(formatCurrency(3, "PEN", "es"));
        await chooseRate();
        await page.getByLabel("Indicaciones de entrega (opcional)").fill("Puerta 2");
        await page.getByLabel("Nombre del destinatario").fill("Ana");
        await page.getByLabel("Teléfono del destinatario").fill("999001");
        await total(13);
        // The first payment covered the products, so the balance is the delivery: only now is another payment offered.
        await page.getByRole("button", { name: "Agregar Yape" }).click();
        await page.getByLabel("Importe recibido").nth(1).fill("3");
        const countBefore = await withTenantIsolation(companyId, async () => await prisma.order.count());
        const stateBefore = await (await page.request.get("/api/delivery-settings/zones")).json();
        expect((await page.request.put("/api/delivery-settings/zones", { data: { expectedVersion: stateBefore.version,
          zones: stateBefore.zones.map((zone: { id: string; name: string; enabled: boolean; districtCodes: string[]; options: { price: unknown }[] }) => ({ ...zone, kind: "existing",
            options: zone.options.map(option => ({ ...option, kind: "existing", price: { amount: 4, currency: "PEN" } })) })) } })).ok()).toBe(true);
        await page.getByRole("button", { name: "Guardar venta" }).click();
        await browserExpect(page.getByRole("alert")).toContainText(`El precio de la entrega cambió a ${formatCurrency(4, "PEN", "es")}. Revísalo y guarda de nuevo.`);
        expect(await withTenantIsolation(companyId, async () => await prisma.order.count())).toBe(countBefore);
        await browserExpect(page.getByLabel("Dirección de entrega", { exact: true })).toHaveValue("Av. Lima 123");
        await browserExpect(page.getByLabel("Importe recibido").nth(1)).toHaveValue("3");
        // The quotation was renewed with the new price, so the old rate is gone from the card: the seller picks the current one.
        const refreshedRate = await chooseRate();
        expect(refreshedRate).toContain(formatCurrency(4, "PEN", "es"));
        await page.getByLabel("Importe recibido").nth(1).fill("4");
        await total(14);
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.screenshot({ path: "test-results/order-new-desktop.png", fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: "test-results/order-new-mobile.png", fullPage: true });
        await page.setViewportSize({ width: 1280, height: 900 });
      }
      await page.getByRole("button", { name: "Guardar venta" }).first().click();
      await browserExpect(page).toHaveURL(/\/orders\/[0-9a-f-]+$/);
      const id = page.url().split("/").at(-1)!;
      const order = await (await page.request.get(`/api/orders/${id}/aggregate`)).json();
      expect(order).toMatchObject({ deliveryStatus: "pending", completedAt: null,
        stockDeducted: scenario === "paid" || scenario === "delivery",
        paymentStatus: scenario === "paid" || scenario === "delivery" ? "paid" : "pending",
        balanceDue: { amount: scenario === "partial" ? 9.2 : scenario === "no-stock" ? 10 : 0 } });
      if (scenario === "delivery") expect(order).toMatchObject({ total: { amount: 14 }, deliveryCharge: { amount: 4 },
        payments: expect.arrayContaining([expect.objectContaining({ amount: { amount: 10, currency: "PEN" } }), expect.objectContaining({ amount: { amount: 4, currency: "PEN" } })]),
        delivery: { recipient: { name: "Ana", phone: "999001" }, destination: { address: "Av. Lima 123", district: "MIRAFLORES", districtCode: "040110", instructions: "Puerta 2" } } });
      if (scenario === "no-stock") expect(await withTenantIsolation(companyId, async () => await prisma.productStock.findFirst())).toMatchObject({ quantity: 0n });
    }
  } finally {
    const user = await systemPrisma.user.findUnique({ where: { email }, select: { companyId: true } });
    if (user?.companyId) await withTenantIsolation(user.companyId, async () => {
      await prisma.payment.deleteMany(); await prisma.orderItem.deleteMany(); await prisma.order.deleteMany();
      await prisma.productStock.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.productOption.deleteMany(); await prisma.product.deleteMany();
      await prisma.deliveryRate.deleteMany(); await prisma.quotation.deleteMany();
      await prisma.deliveryZoneDistrict.deleteMany(); await prisma.deliveryOptionAgency.deleteMany(); await prisma.deliveryOption.deleteMany(); await prisma.deliveryZone.deleteMany();
      await prisma.companyDeliverySettings.deleteMany();
    });
    await systemPrisma.user.deleteMany({ where: { email } });
    if (user?.companyId) await withTenantIsolation(user.companyId, async () => await prisma.company.delete({ where: { id: user.companyId! } }));
  }
});
