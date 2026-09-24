import { browserExpect, expect, test } from "./fixtures";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { products } from "@core/src/features/products/composition";
import type { CompanyId, ImageId } from "@core/src/features/products/domain/product";

test("create products from the private form, validate input, and reload detail", async ({ page, request }) => {
  const email = `product-${crypto.randomUUID()}@example.test`;
  const otherEmail = `product-other-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    expect((await request.get("/es-PE/products", { maxRedirects: 0 })).status()).toBe(302);
    expect((await request.get("/es-PE/products/new", { maxRedirects: 0 })).status()).toBe(302);
    expect((await request.get(`/es-PE/products/${crypto.randomUUID()}`, { maxRedirects: 0 })).status()).toBe(302);
    expect((await request.post("/es-PE/products/new", { maxRedirects: 0, data: { name: "Sin sesión", currency: "PEN", variants: [{ attributes: {}, salePrice: 1 }] } })).status()).toBe(302);
    await page.goto("/es-PE/products/new");
    await browserExpect(page).toHaveURL(/\/es-PE\/login$/);
    await page.getByRole("link", { name: "Regístrate" }).click();
    await page.getByLabel("Nombre", { exact: true }).fill("Ana Producto");
    await page.getByLabel("Nombre de empresa").fill("Empresa Producto");
    await page.getByLabel("País").selectOption("PE");
    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByLabel("Contraseña").fill("test-password-123");
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await browserExpect(page).toHaveURL(/\/es-PE\/dashboard$/);
    companyId = (await (await page.request.get("/api/me")).json()).company.id;
    if (!companyId) throw new Error("Company was not created");
    const tenantId = companyId;

    await page.getByRole("complementary").getByRole("link", { name: "Productos" }).click();
    await browserExpect(page).toHaveURL(/\/es-PE\/products$/);
    await browserExpect(page.getByText("Aún no hay productos en el catálogo.")).toBeVisible();
    await browserExpect(page.getByRole("complementary").getByRole("link", { name: "Productos" })).toHaveAttribute("aria-current", "page");
    await page.getByRole("link", { name: "Nuevo producto" }).click();
    await browserExpect(page).toHaveURL(/\/es-PE\/products\/new$/);
    await page.goto("/es-US/products/new?draft=1");
    await browserExpect(page).toHaveURL(/\/es-PE\/products\/new\?draft=1$/);
    await browserExpect(page.getByRole("complementary").getByRole("link", { name: "Productos" })).toHaveAttribute("data-active", "true");
    await page.setViewportSize({ width: 390, height: 780 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByLabel("Nombre *").focus();
    await page.keyboard.press("Tab");
    await browserExpect(page.getByLabel("Descripción")).toBeFocused();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByLabel("Nombre *").fill("  Cuaderno  ");
    await page.getByLabel("Precio de venta (PEN) *").fill("12.50");
    await page.getByRole("button", { name: "Guardar producto" }).click();
    await browserExpect(page).toHaveURL(/\/es-PE\/products\/[0-9a-f-]+$/);
    const firstProductUrl = page.url();
    await browserExpect(page.getByRole("heading", { name: "Cuaderno" })).toBeVisible();
    await browserExpect(page.getByRole("article")).toHaveCount(1);
    await browserExpect(page.getByText("12.50 PEN")).toBeVisible();
    await browserExpect(page.getByText("Sin SKU")).toBeVisible();
    await browserExpect(page.getByText("Sin precio")).toBeVisible();
    await browserExpect(page.getByText("Stock").locator("..")).toContainText("0");
    await page.reload();
    await browserExpect(page.getByRole("heading", { name: "Cuaderno" })).toBeVisible();
    await page.getByRole("link", { name: "Volver a productos" }).click();
    await browserExpect(page.getByRole("row", { name: /Cuaderno/ })).toContainText("Sin SKU");
    await page.getByRole("searchbox", { name: "Buscar por nombre o SKU" }).fill("cuad");
    await page.getByRole("button", { name: "Buscar" }).click();
    await browserExpect(page.getByRole("row", { name: /Cuaderno/ })).toBeVisible();
    await page.getByRole("link", { name: "Cuaderno" }).click();
    await browserExpect(page).toHaveURL(firstProductUrl);

    await page.getByRole("complementary").getByRole("link", { name: "Productos" }).click();
    await page.getByRole("link", { name: "Nuevo producto" }).click();
    await page.getByLabel("Nombre *").fill("Lápiz");
    await page.getByLabel("SKU").fill("LAP-1");
    await page.getByLabel("Precio de venta (PEN) *").fill("3.25");
    await page.getByLabel("Precio de compra (PEN)").fill("1.20");
    await page.getByLabel("Stock inicial").fill("7");
    await page.getByLabel("Descripción").fill("Grafito");
    await page.getByRole("button", { name: "Guardar producto" }).click();
    await browserExpect(page).toHaveURL(/\/es-PE\/products\/[0-9a-f-]+$/);
    await page.reload();
    await browserExpect(page.getByText("LAP-1")).toBeVisible();
    await browserExpect(page.getByText("1.20 PEN")).toBeVisible();
    await browserExpect(page.getByText("Grafito")).toBeVisible();
    await browserExpect(page.getByText("Stock").locator("..")).toContainText("7");

    await page.getByRole("complementary").getByRole("link", { name: "Productos" }).click();
    await page.getByRole("searchbox", { name: "Buscar por nombre o SKU" }).fill("lap-1");
    await page.getByRole("button", { name: "Buscar" }).click();
    await browserExpect(page.getByRole("row", { name: /Lápiz/ })).toContainText("LAP-1");
    await page.getByRole("searchbox", { name: "Buscar por nombre o SKU" }).fill("missing-product");
    await page.getByRole("button", { name: "Buscar" }).click();
    await browserExpect(page.getByText("No se encontraron productos para esta búsqueda.")).toBeVisible();
    await page.getByRole("link", { name: "Nuevo producto" }).click();
    await page.getByLabel("Nombre *").fill("Otro lápiz");
    await page.getByLabel("SKU").fill("lap-1");
    await page.getByLabel("Precio de venta (PEN) *").fill("0");
    await page.getByLabel("Stock inicial").fill("-1");
    await page.getByRole("button", { name: "Guardar producto" }).click();
    await browserExpect(page.getByText("Este SKU ya está en uso.")).toHaveCount(0);
    await browserExpect(page.getByText(/precio de venta debe estar/)).toBeVisible();
    await browserExpect(page.getByText(/stock inicial debe ser/)).toBeVisible();
    await browserExpect(page.getByLabel("Nombre *")).toHaveValue("Otro lápiz");
    await page.getByLabel("Precio de venta (PEN) *").fill("5");
    await page.getByLabel("Stock inicial").fill("1");
    await page.getByRole("button", { name: "Guardar producto" }).click();
    await browserExpect(page.getByText("Este SKU ya está en uso.")).toBeVisible();
    await page.getByLabel("SKU").fill("LAP-2");
    await page.getByRole("button", { name: "Guardar producto" }).click();
    await browserExpect(page).toHaveURL(/\/es-PE\/products\/[0-9a-f-]+$/);

    const count = await withTenantIsolation(companyId, async () => prisma.product.count({ where: { companyId } }));
    expect(count).toBe(3);
    await page.goto("/es-PE/products/new");
    await page.getByLabel("Nombre *").fill("Cancelado");
    await page.getByRole("link", { name: "Cancelar" }).click();
    await browserExpect(page).toHaveURL(/\/products$/);
    expect(await withTenantIsolation(companyId, async () => prisma.product.count({ where: { companyId } }))).toBe(3);

    const manipulated = await page.request.post("/es-PE/products/new", { data: { name: "Intruso", currency: "PEN", variants: [{ attributes: {}, salePrice: 1 }], companyId: crypto.randomUUID() } });
    expect(manipulated.status()).toBe(200);
    expect(await manipulated.text()).toContain("La solicitud contiene campos no permitidos.");
    expect(await withTenantIsolation(companyId, async () => prisma.product.count({ where: { companyId } }))).toBe(3);

    const prepared = await withTenantIsolation(tenantId, async () => {
      const image = await prisma.image.create({ data: { companyId: tenantId, storageKey: "prepared-product.jpg" } });
      return products.create(tenantId as CompanyId, {
        name: "Camisa con tallas", currency: "PEN", imageId: image.id as ImageId,
        variants: [
          { attributes: { Talla: "M" }, sku: "CAM-M", salePrice: 20, initialStock: 2 },
          { attributes: { Talla: "L" }, sku: "CAM-L", salePrice: 25, initialStock: 3 },
        ],
      });
    });
    expect(prepared.success).toBe(true);
    if (!prepared.success) throw new Error("Could not prepare multivariant product");
    await page.route("**/test-images/*", (route) => route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==", "base64") }));
    await page.goto(`/es-PE/products/${prepared.data}`);
    await browserExpect(page.getByRole("heading", { name: "Camisa con tallas" })).toBeVisible();
    await browserExpect(page.getByRole("article")).toHaveCount(2);
    await browserExpect(page.getByText("CAM-M")).toBeVisible();
    await browserExpect(page.getByText("CAM-L")).toBeVisible();
    await browserExpect(page.getByText("Talla", { exact: true })).toHaveCount(2);
    await browserExpect(page.getByText("M", { exact: true })).toBeVisible();
    await browserExpect(page.getByText("L", { exact: true })).toBeVisible();
    await browserExpect(page.getByText("20.00 PEN")).toBeVisible();
    await browserExpect(page.getByText("25.00 PEN")).toBeVisible();
    await browserExpect(page.getByRole("article").filter({ hasText: "CAM-M" })).toContainText("Stock2");
    await browserExpect(page.getByRole("article").filter({ hasText: "CAM-L" })).toContainText("Stock3");
    await browserExpect(page.getByRole("img", { name: "Camisa con tallas" })).toHaveAttribute("src", /prepared-product\.jpg$/);
    await page.getByRole("link", { name: "Volver a productos" }).click();
    const catalogRow = page.getByRole("row", { name: /Camisa con tallas/ });
    await browserExpect(catalogRow).toContainText("Varias variantes");
    await browserExpect(catalogRow).toContainText("Desde 20.00 PEN");
    await browserExpect(catalogRow).toContainText("5");
    await page.goto("/es-PE/products?pageSize=1");
    await browserExpect(page.getByRole("row")).toHaveCount(2);
    await browserExpect(page.getByRole("navigation", { name: "Páginas de productos" }).getByRole("link", { name: "Página 2" })).toBeVisible();
    await page.getByRole("link", { name: "Página 2" }).click();
    await browserExpect(page).toHaveURL(/page=2&pageSize=1/);
    await browserExpect(page.getByRole("row")).toHaveCount(2);
    await page.setViewportSize({ width: 390, height: 780 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("searchbox", { name: "Buscar por nombre o SKU" }).focus();
    await browserExpect(page.getByRole("searchbox", { name: "Buscar por nombre o SKU" })).toBeFocused();
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await browserExpect(page).toHaveURL(/\/login$/);
    await page.goto("/es-PE/register");
    await page.getByLabel("Nombre", { exact: true }).fill("Otra persona");
    await page.getByLabel("Nombre de empresa").fill("Otra empresa");
    await page.getByLabel("País").selectOption("US");
    await page.getByLabel("Correo electrónico").fill(otherEmail);
    await page.getByLabel("Contraseña").fill("test-password-123");
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await browserExpect(page).toHaveURL(/\/es-US\/dashboard$/);
    await page.goto(firstProductUrl);
    await browserExpect(page).toHaveURL(/\/es-US\/products\/[0-9a-f-]+$/);
    await browserExpect(page.getByRole("heading", { name: "Producto no encontrado" })).toBeVisible();
    await page.goto("/es-US/products?search=Cuaderno");
    await browserExpect(page.getByText("No se encontraron productos para esta búsqueda.")).toBeVisible();
  } finally {
    for (const accountEmail of [email, otherEmail]) {
      const user = await systemPrisma.user.findUnique({ where: { email: accountEmail }, select: { companyId: true } });
      await systemPrisma.user.deleteMany({ where: { email: accountEmail } });
      if (user?.companyId) await withTenantIsolation(user.companyId, async () => {
        await prisma.productStock.deleteMany({ where: { companyId: user.companyId! } });
        await prisma.productVariant.deleteMany({ where: { companyId: user.companyId! } });
        await prisma.product.deleteMany({ where: { companyId: user.companyId! } });
        await prisma.image.deleteMany({ where: { companyId: user.companyId! } });
        await prisma.company.delete({ where: { id: user.companyId! } });
      });
    }
  }
});
