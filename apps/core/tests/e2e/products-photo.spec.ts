import { browserExpect, expect, prepareVerifiedCompany, publishCatalog, test } from "./fixtures";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==", "base64");
const publicBase = `http://127.0.0.1:${process.env.CORE_E2E_PORT ?? "4173"}/test-images`;
const file = (name: string) => ({ name, mimeType: "image/png", buffer: png });
const names = ["frente.png", "espalda.png", "puesto.png"];

test("a seller creates a product with three photos and the catalog grid and the cart show the first one", async ({ page }) => {
  const email = `photo-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  const uploads = new Map<string, { id: string; url: string }>();
  const buyer = await page.context().browser()!.newContext({ baseURL: `http://127.0.0.1:${process.env.CORE_E2E_PORT ?? "4173"}`, viewport: { width: 390, height: 844 } });
  const buyerPage = await buyer.newPage();
  try {
    await page.route("**/test-images/*", (route) => route.fulfill({ status: 200, contentType: "image/png", body: png }));
    await buyerPage.route("**/test-images/*", (route) => route.fulfill({ status: 200, contentType: "image/png", body: png }));
    await page.route("**/api/images", (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const body = route.request().postData() ?? "";
      const upload = names.map((name) => uploads.get(name)!).find((candidate, index) => body.includes(`filename="${names[index]}"`));
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(upload) });
    });

    companyId = await prepareVerifiedCompany(page, { email, name: "Ana Foto", companyName: "Empresa Foto", country: "PE" });
    const tenantId = companyId;
    for (const name of names) {
      const image = await withTenantIsolation(tenantId, async () => await prisma.image.create({ data: { companyId: tenantId, storageKey: name } }));
      uploads.set(name, { id: image.id, url: `${publicBase}/${name}` });
    }

    await page.goto("/es-PE/products/new");
    await page.getByLabel("Nombre *").fill("Polo perro rayas");
    await page.getByLabel("Precio de venta (PEN) *").fill("30");
    await page.getByLabel("Stock inicial").fill("5");
    await browserExpect(page.getByText("Hasta 8 fotos. La primera es la principal.")).toBeVisible();

    await page.locator("input[type=file]").setInputFiles(names.map(file));
    await browserExpect(page.getByText("3 de 8 fotos")).toBeVisible();
    await browserExpect(page.getByRole("button", { name: "Cancelar la subida de la foto 1 de 3" })).toHaveCount(0);
    await browserExpect(page.getByRole("group", { name: "Foto 1 de 3, principal" })).toBeVisible();

    await page.getByRole("button", { name: "Hacer principal la foto 3 de 3" }).click();
    await browserExpect(page.getByRole("button", { name: "Quitar la foto 1 de 3" })).toBeFocused();
    await browserExpect(page.getByRole("group", { name: "Foto 1 de 3, principal" }).locator("img")).toHaveAttribute("src", /puesto\.png$/);

    await page.getByRole("button", { name: "Guardar producto" }).click();
    await browserExpect(page).toHaveURL(/\/es-PE\/products\/[0-9a-f-]+(\?saved=1)?$/);
    const productUrl = page.url().replace(/\?saved=1$/, "");
    await browserExpect(page.getByText("3 de 8 fotos")).toBeVisible();
    await browserExpect(page.getByRole("group", { name: "Foto 1 de 3, principal" }).locator("img")).toHaveAttribute("src", /puesto\.png$/);
    await browserExpect(page.getByRole("group", { name: "Foto 2 de 3" }).locator("img")).toHaveAttribute("src", /frente\.png$/);
    await browserExpect(page.getByRole("group", { name: "Foto 3 de 3" }).locator("img")).toHaveAttribute("src", /espalda\.png$/);

    const stored = await withTenantIsolation(tenantId, async () => await prisma.productPhoto.findMany({ where: { companyId: tenantId }, orderBy: { position: "asc" }, include: { image: true } }));
    expect(stored.map((photo) => photo.image.storageKey)).toEqual(["puesto.png", "frente.png", "espalda.png"]);

    const address = await publishCatalog(tenantId);
    await buyerPage.goto(address);
    await browserExpect(buyerPage.locator('[data-store-part="catalog-card-photo"] img')).toHaveAttribute("src", /puesto\.png$/);
    await buyerPage.getByRole("link", { name: /Polo perro rayas/ }).click();
    await buyerPage.waitForURL(/\/productos\/[0-9a-f-]{36}$/);
    await browserExpect(async () => {
      await buyerPage.getByRole("button", { name: "Agregar al carrito" }).click();
      await browserExpect(buyerPage.getByRole("status").filter({ hasText: "Agregado al carrito" })).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 10_000 });
    await buyerPage.getByRole("button", { name: /^Carrito, \d+ unidad/ }).click();
    await browserExpect(buyerPage.getByRole("dialog", { name: "Carrito" }).locator("img")).toHaveAttribute("src", /puesto\.png$/);

    await page.goto(productUrl);
    await page.getByRole("button", { name: "Quitar la foto 1 de 3" }).click();
    await browserExpect(page.getByRole("group", { name: "Foto 1 de 3, se eliminará al guardar" })).toBeVisible();
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await browserExpect(page).toHaveURL(`${productUrl}?saved=1`);
    await browserExpect(page.getByText("2 de 8 fotos")).toBeVisible();
    await browserExpect(page.getByRole("group", { name: "Foto 1 de 2, principal" }).locator("img")).toHaveAttribute("src", /frente\.png$/);
  } finally {
    await buyer.close();
    if (companyId) {
      const user = await systemPrisma.user.findUnique({ where: { email }, select: { companyId: true } });
      await systemPrisma.user.deleteMany({ where: { email } });
      if (user?.companyId) {
        await withTenantIsolation(user.companyId, async () => {
          await prisma.productPhoto.deleteMany({ where: { companyId: user.companyId! } });
          await prisma.productStock.deleteMany({ where: { companyId: user.companyId! } });
          await prisma.productVariant.deleteMany({ where: { companyId: user.companyId! } });
          await prisma.productOption.deleteMany({ where: { companyId: user.companyId! } });
          await prisma.product.deleteMany({ where: { companyId: user.companyId! } });
          await prisma.image.deleteMany({ where: { companyId: user.companyId! } });
          await prisma.company.delete({ where: { id: user.companyId! } });
        });
      }
    }
  }
});
