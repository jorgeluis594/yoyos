import { browserExpect, expect, test } from "./fixtures";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==", "base64");
const publicBase = "http://127.0.0.1:4173/test-images";
const file = (name: string) => ({ name, mimeType: "image/png", buffer: png });

test("create, replace, keep, and remove a product photo", async ({ page }) => {
  const email = `photo-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  let upload = { id: "", url: "" };
  let failUpload = false;
  try {
    await page.route("**/test-images/*", (route) => route.fulfill({ status: 200, contentType: "image/png", body: png }));
    await page.route("**/api/images", (route) => {
      if (route.request().method() !== "POST") return route.continue();
      return failUpload
        ? route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ code: "IMAGE_STORAGE_UNAVAILABLE", error: "Image storage unavailable" }) })
        : route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(upload) });
    });

    await page.goto("/es-PE/products/new");
    await browserExpect(page).toHaveURL(/\/es-PE\/login$/);
    await page.getByRole("link", { name: "Regístrate" }).click();
    await page.getByLabel("Nombre", { exact: true }).fill("Ana Foto");
    await page.getByLabel("Nombre de empresa").fill("Empresa Foto");
    await page.getByLabel("País").selectOption("PE");
    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByLabel("Contraseña").fill("test-password-123");
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await browserExpect(page).toHaveURL(/\/es-PE\/dashboard$/);
    companyId = (await (await page.request.get("/api/me")).json()).company.id;
    if (!companyId) throw new Error("Company was not created");
    const tenantId = companyId;
    const prepare = (key: string) => withTenantIsolation(tenantId, async () => await prisma.image.create({ data: { companyId: tenantId, storageKey: key } }));

    await page.getByRole("complementary").getByRole("link", { name: "Productos" }).click();
    await page.getByRole("link", { name: "Nuevo producto" }).click();
    await page.getByLabel("Nombre *").fill("Cuaderno con foto");
    await page.getByLabel("Descripción").fill("Con foto");
    await page.getByLabel("SKU").fill("FOTO-1");
    await page.getByLabel("Precio de venta (PEN) *").fill("12.50");
    await page.getByLabel("Precio de compra (PEN)").fill("4.00");
    await page.getByLabel("Stock inicial").fill("3");

    failUpload = true;
    await page.getByLabel("Foto", { exact: true }).setInputFiles(file("failed.png"));
    await browserExpect(page.getByText("No se pudo subir la imagen. Inténtalo de nuevo.")).toBeVisible();
    await browserExpect(page.getByLabel("Nombre *")).toHaveValue("Cuaderno con foto");

    const first = await prepare("photo-first.png");
    upload = { id: first.id, url: `${publicBase}/${first.storageKey}` };
    failUpload = false;
    await page.getByLabel("Foto", { exact: true }).setInputFiles(file("first.png"));
    await browserExpect(page.getByRole("img", { name: "Vista previa de la foto del producto" })).toHaveAttribute("src", /photo-first\.png$/);
    await page.getByRole("button", { name: "Guardar producto" }).click();
    await browserExpect(page).toHaveURL(/\/es-PE\/products\/[0-9a-f-]+$/);
    const productUrl = page.url();
    await browserExpect(page.locator("main img")).toHaveAttribute("src", /photo-first\.png$/);
    await page.getByRole("link", { name: "Volver a productos" }).click();
    await browserExpect(page.getByRole("row", { name: /Cuaderno con foto/ })).toContainText("FOTO-1");
    await browserExpect(page.getByRole("row", { name: /Cuaderno con foto/ }).locator("img")).toHaveCount(0);

    await page.goto(`${productUrl}/edit`);
    await browserExpect(page.getByRole("img", { name: "Vista previa de la foto del producto" })).toHaveAttribute("src", /photo-first\.png$/);
    await page.getByLabel("Nombre *").fill("Cuaderno con foto editado");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await browserExpect(page).toHaveURL(productUrl);
    await browserExpect(page.locator("main img")).toHaveAttribute("src", /photo-first\.png$/);

    const second = await prepare("photo-second.png");
    upload = { id: second.id, url: `${publicBase}/${second.storageKey}` };
    await page.getByRole("link", { name: "Editar" }).click();
    await page.getByLabel("Foto", { exact: true }).setInputFiles(file("second.png"));
    await browserExpect(page.getByRole("img", { name: "Vista previa de la foto del producto" })).toHaveAttribute("src", /photo-second\.png$/);
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await browserExpect(page).toHaveURL(productUrl);
    await browserExpect(page.locator("main img")).toHaveAttribute("src", /photo-second\.png$/);

    await page.getByRole("link", { name: "Editar" }).click();
    await page.getByRole("button", { name: "Quitar foto" }).click();
    await browserExpect(page.getByRole("img", { name: "Vista previa de la foto del producto" })).toHaveCount(0);
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await browserExpect(page).toHaveURL(productUrl);
    await browserExpect(page.locator("main img")).toHaveCount(0);

    const before = await withTenantIsolation(tenantId, async () => await prisma.product.count({ where: { companyId: tenantId } }));
    const third = await prepare("photo-cancelled.png");
    upload = { id: third.id, url: `${publicBase}/${third.storageKey}` };
    await page.goto("/es-PE/products/new");
    await page.getByLabel("Nombre *").fill("Descartado");
    await page.getByLabel("Precio de venta (PEN) *").fill("1");
    await page.getByLabel("Foto", { exact: true }).setInputFiles(file("cancelled.png"));
    await browserExpect(page.getByRole("img", { name: "Vista previa de la foto del producto" })).toBeVisible();
    await page.getByRole("link", { name: "Cancelar" }).click();
    await browserExpect(page).toHaveURL(/\/es-PE\/products$/);
    expect(await withTenantIsolation(tenantId, async () => await prisma.product.count({ where: { companyId: tenantId } }))).toBe(before);
  } finally {
    if (companyId) {
      const user = await systemPrisma.user.findUnique({ where: { email }, select: { companyId: true } });
      await systemPrisma.user.deleteMany({ where: { email } });
      if (user?.companyId) {
        await withTenantIsolation(user.companyId, async () => {
          await prisma.productStock.deleteMany({ where: { companyId: user.companyId! } });
          await prisma.productVariant.deleteMany({ where: { companyId: user.companyId! } });
          await prisma.product.deleteMany({ where: { companyId: user.companyId! } });
          await prisma.image.deleteMany({ where: { companyId: user.companyId! } });
          await prisma.company.delete({ where: { id: user.companyId! } });
        });
      }
    }
  }
});
