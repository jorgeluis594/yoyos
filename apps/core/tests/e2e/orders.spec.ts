import { browserExpect, expect, test } from "@core/tests/e2e/fixtures";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { products } from "@core/src/features/products/composition";
import { orders } from "@core/src/features/orders/composition";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

test("seller completes a wallet sale and sees backend totals and stock", async ({ page, request }) => {
  const email = `orders-${crypto.randomUUID()}@example.test`;
  const otherEmail = `orders-other-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    expect((await request.get("/es-PE/orders/new", { maxRedirects: 0 })).status()).toBe(302);
    expect((await request.get("/es-PE/orders", { maxRedirects: 0 })).status()).toBe(302);
    expect((await request.get(`/es-PE/orders/${crypto.randomUUID()}`, { maxRedirects: 0 })).status()).toBe(302);
    await page.goto("/es-PE/register");
    await page.getByLabel("Nombre", { exact: true }).fill("Seller Orders");
    await page.getByLabel("Nombre de empresa").fill("Orders company");
    await page.getByLabel("País").click();
    await page.getByRole("option", { name: "Perú" }).click();
    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByLabel("Contraseña").fill("test-password-123");
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await browserExpect(page).toHaveURL(/\/es-PE\/dashboard$/);
    companyId = (await (await page.request.get("/api/me")).json()).company.id;
    if (!companyId) throw new Error("Company missing");
    const tenantId = companyId;
    const created = await withTenantIsolation(tenantId, () => products.create({ name: "Cuaderno POS", currency: "PEN",
      variants: [{ attributes: { Size: "M" }, sku: "POS-M", salePrice: 0.29, initialStock: 3 }] }));
    expect(created.success).toBe(true);

    await page.getByRole("complementary").getByRole("link", { name: "Ventas" }).click();
    await page.getByRole("link", { name: "Nueva venta" }).click();
    await browserExpect(page.getByRole("heading", { name: "Nueva venta" })).toBeVisible();
    await page.getByRole("searchbox", { name: "Buscar productos por nombre" }).fill("cuad");
    await page.getByRole("button", { name: "Buscar", exact: true }).first().click();
    await browserExpect(page.getByText("Cuaderno POS")).toBeVisible();
    await page.getByRole("button", { name: "Agregar" }).click();
    await browserExpect(page.getByText("Total mostrado: 0.29 PEN")).toBeVisible();
    await page.reload();
    await browserExpect(page.getByText("Agrega productos para comenzar.")).toBeVisible();
    expect(await withTenantIsolation(tenantId, async () => await prisma.order.count())).toBe(0);
    await page.getByRole("button", { name: "Agregar" }).click();
    await page.getByRole("button", { name: "Agregar" }).click();
    await browserExpect(page.getByText("Total mostrado: 0.58 PEN")).toBeVisible();
    await page.getByRole("button", { name: "Confirmar cobro y completar venta" }).click();
    await browserExpect(page).toHaveURL(/\/es-PE\/orders\/[0-9a-f-]+$/);
    await browserExpect(page.getByRole("heading", { name: "Venta completada" })).toBeVisible();
    await browserExpect(page.getByText("Público general")).toBeVisible();
    await browserExpect(page.getByText("Total: 0.58 PEN")).toBeVisible();
    await page.getByRole("link", { name: "Ver ventas" }).click();
    await browserExpect(page.getByText("1 venta completada")).toBeVisible();
    const stock = await withTenantIsolation(tenantId, async () => await prisma.productStock.findFirstOrThrow());
    expect(stock.quantity).toBe(1n);

    const contactId = crypto.randomUUID();
    await withTenantIsolation(tenantId, async () => await prisma.contact.create({ data: { id: contactId, phone: "+51912345678", name: null } }));
    await page.getByRole("link", { name: "Nueva venta" }).click();
    await browserExpect(page.getByText(/Stock: 1/)).toBeVisible();
    await page.getByRole("button", { name: "Agregar" }).click();
    await page.getByRole("button", { name: "Agregar" }).click();
    await page.getByRole("button", { name: "Seleccionar" }).click();
    await page.getByRole("button", { name: "Confirmar cobro y completar venta" }).click();
    await browserExpect(page.getByRole("alert")).toContainText("No hay stock suficiente");
    expect(await withTenantIsolation(tenantId, async () => await prisma.order.count())).toBe(1);
    await page.getByLabel("Cantidad").fill("1");
    await withTenantIsolation(tenantId, async () => await prisma.productVariant.update({ where: { id: stock.variantId }, data: { salePrice: 0.3 } }));
    await browserExpect(page.getByText("Total mostrado: 0.29 PEN")).toBeVisible();
    await page.getByRole("button", { name: "Confirmar cobro y completar venta" }).click();
    await browserExpect(page).toHaveURL(/\/es-PE\/orders\/[0-9a-f-]+$/);
    await browserExpect(page.getByText("Teléfono al vender")).toBeVisible();
    await browserExpect(page.getByText("+51912345678", { exact: true }).first()).toBeVisible();
    await browserExpect(page.getByText("Total: 0.30 PEN")).toBeVisible();
    const completedUrl = page.url();
    await page.getByRole("link", { name: "Ver ventas" }).click();
    await page.getByLabel("Cliente", { exact: true }).selectOption("contact");
    await page.getByLabel("Contacto", { exact: true }).selectOption(contactId);
    await page.getByRole("button", { name: "Filtrar" }).click();
    await browserExpect(page.getByText("1 venta completada")).toBeVisible();
    const tampered = await page.request.post("/es-PE/orders/new", { form: { order: JSON.stringify({ id: crypto.randomUUID(),
      companyId: crypto.randomUUID(), sellerId: crypto.randomUUID(), total: 0.01, contactId: null,
      items: [{ variantId: stock.variantId, quantity: 1 }] }) } });
    expect(await tampered.text()).toContain("Revisa los datos de la venta.");
    expect(await withTenantIsolation(tenantId, async () => await prisma.order.count())).toBe(2);

    await withTenantIsolation(tenantId, async () => await prisma.productStock.update({ where: { variantId: stock.variantId }, data: { quantity: 1n } }));
    await page.goto("/es-PE/orders/new");
    await page.getByRole("button", { name: "Agregar" }).click();
    const adminUrl = new URL(process.env.DATABASE_URL!);
    adminUrl.username = "core";
    adminUrl.password = "core";
    const admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: adminUrl.toString() }) });
    const triggerName = `reject_browser_sale_${crypto.randomUUID().replaceAll("-", "")}`;
    try {
      await admin.$executeRawUnsafe(`CREATE FUNCTION public.${triggerName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD."companyId" = '${tenantId}'::uuid THEN RAISE EXCEPTION 'test stock outage'; END IF; RETURN NEW; END $$`);
      await admin.$executeRawUnsafe(`CREATE TRIGGER ${triggerName} BEFORE UPDATE ON "ProductStock" FOR EACH ROW EXECUTE FUNCTION public.${triggerName}()`);
      await page.getByRole("button", { name: "Confirmar cobro y completar venta" }).click();
      await browserExpect(page.getByRole("alert")).toContainText("No se pudo completar la venta");
      expect(await withTenantIsolation(tenantId, async () => await prisma.order.count())).toBe(2);
    } finally {
      await admin.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${triggerName} ON "ProductStock"`);
      await admin.$executeRawUnsafe(`DROP FUNCTION IF EXISTS public.${triggerName}()`);
      await admin.$disconnect();
    }
    await page.getByRole("button", { name: "Confirmar cobro y completar venta" }).click();
    await browserExpect(page).toHaveURL(/\/es-PE\/orders\/[0-9a-f-]+$/);
    const recoveredId = page.url().split("/").at(-1)!;
    expect(await withTenantIsolation(tenantId, async () => await prisma.order.count())).toBe(3);
    const duplicate = await page.request.post("/es-PE/orders/new", { form: { order: JSON.stringify({ id: recoveredId, contactId: null,
      items: [{ variantId: stock.variantId, quantity: 1 }] }) } });
    expect(await duplicate.text()).toContain("Esta venta ya se registró");
    expect(await withTenantIsolation(tenantId, async () => await prisma.order.count())).toBe(3);

    await withTenantIsolation(tenantId, async () => {
      await prisma.productStock.update({ where: { variantId: stock.variantId }, data: { quantity: 25n } });
      const sellerId = (await systemPrisma.user.findUniqueOrThrow({ where: { email } })).id;
      for (let index = 0; index < 21; index++) {
        expect(await orders.create({ id: crypto.randomUUID(), contactId: null, items: [{ variantId: stock.variantId, quantity: 1 }] },
          { companyId: tenantId, sellerId })).toMatchObject({ success: true });
      }
    });
    await page.goto("/es-PE/orders");
    await browserExpect(page.getByRole("list", { name: "Ventas completadas" }).getByRole("listitem")).toHaveCount(20);
    await page.getByRole("navigation", { name: "Páginas de ventas" }).getByRole("link", { name: "Siguiente" }).click();
    await browserExpect(page).toHaveURL(/page=2/);
    await browserExpect(page.getByRole("list", { name: "Ventas completadas" }).getByRole("listitem")).toHaveCount(4);
    await page.getByLabel("Desde").fill("2020-01-01");
    await page.getByLabel("Antes de").fill("2020-01-02");
    await page.getByRole("button", { name: "Filtrar" }).click();
    await browserExpect(page.getByText("No hay ventas para estos filtros.")).toBeVisible();

    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await browserExpect(page).toHaveURL(/\/login$/);
    await page.goto("/es-PE/register");
    await page.getByLabel("Nombre", { exact: true }).fill("Other seller");
    await page.getByLabel("Nombre de empresa").fill("Other orders company");
    await page.getByLabel("País").click();
    await page.getByRole("option", { name: "Estados Unidos" }).click();
    await page.getByLabel("Correo electrónico").fill(otherEmail);
    await page.getByLabel("Contraseña").fill("test-password-123");
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await browserExpect(page).toHaveURL(/\/es-US\/dashboard$/);
    await page.goto(completedUrl);
    await browserExpect(page).toHaveURL(/\/es-US\/orders\/[0-9a-f-]+$/);
    await browserExpect(page.getByRole("heading", { name: "Venta no encontrada" })).toBeVisible();
  } finally {
    for (const accountEmail of [email, otherEmail]) {
      const user = await systemPrisma.user.findUnique({ where: { email: accountEmail }, select: { companyId: true } });
      if (user?.companyId) await withTenantIsolation(user.companyId, async () => {
        await prisma.orderItem.deleteMany();
        await prisma.order.deleteMany();
        await prisma.contact.deleteMany();
        await prisma.productStock.deleteMany();
        await prisma.productVariant.deleteMany();
        await prisma.product.deleteMany();
      });
      await systemPrisma.user.deleteMany({ where: { email: accountEmail } });
      if (user?.companyId) await withTenantIsolation(user.companyId, async () => await prisma.company.delete({ where: { id: user.companyId! } }));
    }
  }
});
