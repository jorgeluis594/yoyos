import { browserExpect, expect, prepareVerifiedCompany, test } from "./fixtures";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { seedProduct } from "@core/src/features/products/infrastructure/product-seed";

test("edit products from the private form, preserve unchanged data, and enforce boundaries", async ({ page, request }) => {
  const email = `edit-${crypto.randomUUID()}@example.test`;
  const otherEmail = `edit-other-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    const missingId = crypto.randomUUID();
    expect((await request.get(`/es-PE/products/${missingId}/edit`, { maxRedirects: 0 })).status()).toBe(302);
    await page.goto(`/es-PE/products/${missingId}/edit`);
    await browserExpect(page).toHaveURL(/\/es-PE\/login$/);

    companyId = await prepareVerifiedCompany(page, { email, name: "Ana Edita", companyName: "Empresa Edita", country: "PE" });
    await page.goto("/es-PE/dashboard");
    const tenantId = companyId;

    await page.goto("/es-PE/products/new");
    await page.getByLabel("Nombre *").fill("Cuaderno");
    await page.getByLabel("Descripción").fill("Algodón");
    await page.getByLabel("SKU").fill("CUAD-1");
    await page.getByLabel("Precio de venta (PEN) *").fill("12.50");
    await page.getByLabel("Precio de compra (PEN)").fill("4.00");
    await page.getByLabel("Stock inicial").fill("4");
    await page.getByRole("button", { name: "Guardar producto" }).click();
    await browserExpect(page).toHaveURL(/\/es-PE\/products\/[0-9a-f-]+$/);
    const firstProductUrl = page.url();
    const firstProductId = firstProductUrl.split("/").pop()!;
    await page.goto(`${firstProductUrl}/edit`);
    await browserExpect(page).toHaveURL(firstProductUrl);

    await browserExpect(page.getByLabel("SKU")).toHaveValue("CUAD-1");
    expect(await page.getByLabel("Stock").isEditable()).toBe(false);
    await browserExpect(page.getByLabel("Stock")).toHaveValue("4");
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole("button", { name: "Alternar tema" }).click();
    await browserExpect(page.locator("html")).toHaveClass(/dark/);
    await browserExpect(page.getByLabel("Nombre *")).toHaveCSS("background-color", "rgb(28, 27, 29)");
    await page.setViewportSize({ width: 390, height: 780 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Abrir menú" }).click();
    await page.getByRole("button", { name: "Alternar tema" }).click();
    await browserExpect(page.locator("html")).not.toHaveClass(/dark/);
    await page.getByRole("dialog").getByRole("button", { name: "Cerrar", exact: true }).click();
    // The sheet returns focus to its trigger after closing; wait so it cannot steal focus from the field below.
    await browserExpect(page.getByRole("button", { name: "Abrir menú" })).toBeFocused();
    await page.getByLabel("Nombre *").focus();
    await page.keyboard.press("Tab");
    await browserExpect(page.getByLabel("Descripción")).toBeFocused();
    await page.getByLabel("Nombre *").fill("Cuaderno editado");
    await page.getByLabel("Descripción").fill("");
    await page.getByLabel("SKU").fill("CUAD-2");
    await page.getByLabel("Precio de venta (PEN) *").fill("15.50");
    await page.getByLabel("Precio de compra (PEN)").fill("");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await browserExpect(page).toHaveURL(`${firstProductUrl}?saved=1`);
    await browserExpect(page.getByRole("status")).toContainText("Producto guardado correctamente.");
    await browserExpect(page.getByRole("heading", { name: "Cuaderno editado" })).toBeVisible();
    await browserExpect(page.getByLabel("SKU")).toHaveValue("CUAD-2");
    await browserExpect(page.getByLabel("Precio de venta (PEN) *")).toHaveValue("15.5");
    await browserExpect(page.getByLabel("Precio de compra (PEN)")).toHaveValue("");
    await browserExpect(page.getByText("Algodón")).toHaveCount(0);
    await browserExpect(page.getByLabel("Stock")).toHaveValue("4");

    const before = await withTenantIsolation(tenantId, async () => await prisma.product.findUniqueOrThrow({ where: { id: firstProductId }, select: { updatedAt: true } }));
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await browserExpect(page).toHaveURL(`${firstProductUrl}?saved=1`);
    const after = await withTenantIsolation(tenantId, async () => await prisma.product.findUniqueOrThrow({ where: { id: firstProductId }, select: { updatedAt: true } }));
    expect(after.updatedAt).toEqual(before.updatedAt);

    await page.goto("/es-PE/products/new");
    await page.getByLabel("Nombre *").fill("Otro cuaderno");
    await page.getByLabel("SKU").fill("DUP-1");
    await page.getByLabel("Precio de venta (PEN) *").fill("5");
    await page.getByRole("button", { name: "Guardar producto" }).click();
    await browserExpect(page).toHaveURL(/\/es-PE\/products\/[0-9a-f-]+$/);
    await page.goto(firstProductUrl);
    await page.getByLabel("SKU").fill("DUP-1");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await browserExpect(page.getByText("Este SKU ya está en uso.")).toBeVisible();
    await browserExpect(page.getByLabel("SKU")).toHaveValue("DUP-1");
    await page.getByLabel("SKU").fill("CUAD-3");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await browserExpect(page).toHaveURL(`${firstProductUrl}?saved=1`);
    await browserExpect(page.getByLabel("SKU")).toHaveValue("CUAD-3");

    const manipulated = await page.request.post(firstProductUrl, { data: { currency: "PEN" } });
    expect(manipulated.status()).toBe(200);
    expect(await manipulated.text()).toContain("La solicitud contiene campos no permitidos.");
    expect((await withTenantIsolation(tenantId, async () => await prisma.product.findUniqueOrThrow({ where: { id: firstProductId } }))).name).toBe("Cuaderno editado");

    const prepared = await withTenantIsolation(tenantId, async () => seedProduct({
      name: "Camisa con tallas",
      variants: [
        { attributes: { Talla: "M" }, sku: "CAM-M", salePrice: 20, stock: 2 },
        { attributes: { Talla: "L" }, sku: "CAM-L", salePrice: 25, stock: 3 },
      ],
    }));
    await page.goto(`/es-PE/products/${prepared.productId}`);
    await browserExpect(page.getByLabel("Precio de venta de M")).toHaveValue("20.00");
    await browserExpect(page.getByLabel("SKU")).toHaveCount(0);
    await browserExpect(page.getByLabel("Stock")).toHaveValue("5");
    await page.getByLabel("Nombre *").fill("Camisa con tallas editada");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await browserExpect(page).toHaveURL(new RegExp(`/es-PE/products/${prepared.productId}\\?saved=1$`));
    await browserExpect(page.getByRole("heading", { name: "Camisa con tallas editada" })).toBeVisible();
    await browserExpect(page.getByLabel("Precio de venta de M")).toHaveValue("20.00");
    await browserExpect(page.getByLabel("Precio de venta de L")).toHaveValue("25.00");

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await browserExpect(page).toHaveURL(/\/login$/);
    await prepareVerifiedCompany(page, { email: otherEmail, name: "Otra persona", companyName: "Otra empresa", country: "US" });
    await page.goto("/es-US/dashboard");
    await page.goto(firstProductUrl);
    await browserExpect(page).toHaveURL(/\/es-US\/products\/[0-9a-f-]+$/);
    await browserExpect(page.getByRole("heading", { name: "Producto no encontrado" })).toBeVisible();
  } finally {
    for (const accountEmail of [email, otherEmail]) {
      const user = await systemPrisma.user.findUnique({ where: { email: accountEmail }, select: { companyId: true } });
      await systemPrisma.user.deleteMany({ where: { email: accountEmail } });
      if (user?.companyId) await withTenantIsolation(user.companyId, async () => {
        await prisma.productStock.deleteMany({ where: { companyId: user.companyId! } });
        await prisma.productVariant.deleteMany({ where: { companyId: user.companyId! } });
        await prisma.productOption.deleteMany({ where: { companyId: user.companyId! } });
        await prisma.product.deleteMany({ where: { companyId: user.companyId! } });
        await prisma.image.deleteMany({ where: { companyId: user.companyId! } });
        await prisma.company.delete({ where: { id: user.companyId! } });
      });
    }
  }
});
