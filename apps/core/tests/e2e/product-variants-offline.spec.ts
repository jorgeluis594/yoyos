import { browserExpect, prepareVerifiedCompany, test } from "./fixtures";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { seedProduct } from "@core/src/features/products/infrastructure/product-seed";

const offlineNotice = "No se pudo guardar. Revisa tu conexión e inténtalo otra vez.";

async function cleanUp(email: string, companyId: string | undefined) {
  if (!companyId) return;
  await withTenantIsolation(companyId, async () => {
    await prisma.productStock.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.productOption.deleteMany(); await prisma.product.deleteMany();
    await systemPrisma.user.deleteMany({ where: { email } }); await prisma.company.delete({ where: { id: companyId } });
  });
}

test("a product save without connection keeps the form and the changes with the connection notice, and works again once back online", async ({ page }) => {
  const email = `offline-save-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    companyId = await prepareVerifiedCompany(page, { email, name: "Ana Sin Red", companyName: "Empresa Sin Red", country: "PE" });
    const { productId } = await withTenantIsolation(companyId, async () => await seedProduct({ name: "Taza" }));
    await page.goto(`/es-PE/products/${productId}`);
    await page.getByLabel("Nombre *").fill("Taza grande");
    await page.context().setOffline(true);
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await browserExpect(page.getByText(offlineNotice)).toBeVisible();
    await browserExpect(page.getByLabel("Nombre *")).toHaveValue("Taza grande");
    await browserExpect(page.getByText("Algo salió mal")).toHaveCount(0);

    await page.context().setOffline(false);
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await browserExpect(page).toHaveURL(/\?saved=1$/);
    await browserExpect(page.getByRole("heading", { name: "Taza grande" })).toBeVisible();
  } finally {
    await cleanUp(email, companyId);
  }
});

test("creating a product without connection keeps the form with the connection notice", async ({ page }) => {
  const email = `offline-create-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    companyId = await prepareVerifiedCompany(page, { email, name: "Ana Sin Red", companyName: "Empresa Sin Red Nueva", country: "PE" });
    await page.goto("/es-PE/products/new");
    await page.getByLabel("Nombre *").fill("Cuaderno");
    await page.getByLabel("Precio de venta (PEN) *").fill("12.50");
    await page.context().setOffline(true);
    await page.getByRole("button", { name: "Guardar producto" }).click();
    await browserExpect(page.getByText(offlineNotice)).toBeVisible();
    await browserExpect(page.getByLabel("Nombre *")).toHaveValue("Cuaderno");
    await browserExpect(page.getByText("Algo salió mal")).toHaveCount(0);
  } finally {
    await cleanUp(email, companyId);
  }
});

test("a gateway failure on the product save keeps the changes on screen with the uncertain-result notice", async ({ page }) => {
  const email = `doubt-save-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    companyId = await prepareVerifiedCompany(page, { email, name: "Ana Dudosa", companyName: "Empresa Dudosa", country: "PE" });
    const { productId } = await withTenantIsolation(companyId, async () => await seedProduct({ name: "Taza" }));
    await page.goto(`/es-PE/products/${productId}`);
    await page.route(`**/es-PE/products/${productId}.data`, (route) => route.request().method() === "PUT"
      ? route.fulfill({ status: 504, contentType: "text/html", body: "Gateway Timeout" }) : route.continue());
    await page.getByLabel("Nombre *").fill("Taza grande");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await browserExpect(page.getByText("Puede que se hayan guardado los cambios. Recarga el producto para revisarlos.")).toBeVisible();
    await browserExpect(page.getByLabel("Nombre *")).toHaveValue("Taza grande");
    await browserExpect(page.getByText("No se pudo cargar el producto")).toHaveCount(0);
  } finally {
    await cleanUp(email, companyId);
  }
});

test("deactivating a variant without connection keeps the detail with the connection notice and the variant active", async ({ page }) => {
  const email = `offline-variant-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    companyId = await prepareVerifiedCompany(page, { email, name: "Ana Sin Red", companyName: "Empresa Variante Sin Red", country: "PE" });
    const tenantId = companyId;
    const { productId, variantIds } = await withTenantIsolation(tenantId, async () => await seedProduct({ name: "Polo básico", options: [{ name: "Talla", values: ["S", "XL"] }],
      variants: [{ attributes: { Talla: "S" }, salePrice: 39.9, stock: 4 }, { attributes: { Talla: "XL" }, salePrice: 39.9, stock: 6 }] }));
    await page.goto(`/es-PE/products/${productId}/variants/${variantIds[1]}`);
    await page.getByRole("button", { name: "Desactivar variante" }).click();
    await page.context().setOffline(true);
    await page.getByRole("button", { name: "Desactivar", exact: true }).click();
    await browserExpect(page.getByText("No se pudo desactivar la variante. Revisa tu conexión e inténtalo otra vez.")).toBeVisible();
    await browserExpect(page.getByText("Algo salió mal")).toHaveCount(0);
    await page.context().setOffline(false);
    const status = async () => (await withTenantIsolation(tenantId, async () => await prisma.productVariant.findUniqueOrThrow({ where: { id: variantIds[1] } }))).status;
    browserExpect(await status()).toBe("active");
  } finally {
    await cleanUp(email, companyId);
  }
});

test("saving the variant detail without connection keeps the typed values with the connection notice, and saves them once back online", async ({ page }) => {
  const email = `offline-variant-save-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    companyId = await prepareVerifiedCompany(page, { email, name: "Ana Sin Red", companyName: "Empresa Detalle Sin Red", country: "PE" });
    const tenantId = companyId;
    const { productId, variantIds } = await withTenantIsolation(tenantId, async () => await seedProduct({ name: "Polo básico", options: [{ name: "Talla", values: ["S", "XL"] }],
      variants: [{ attributes: { Talla: "S" }, salePrice: 39.9, stock: 4 }, { attributes: { Talla: "XL" }, salePrice: 39.9, stock: 6 }] }));
    const stored = async () => await withTenantIsolation(tenantId, async () => await prisma.productVariant.findUniqueOrThrow({ where: { id: variantIds[1] } }));
    await page.goto(`/es-PE/products/${productId}/variants/${variantIds[1]}`);
    await page.locator("#variant-salePrice").fill("45.50");
    await page.locator("#variant-sku").fill("POLO-XL");
    await page.context().setOffline(true);
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await browserExpect(page.getByText(offlineNotice)).toBeVisible();
    await browserExpect(page.locator("#variant-salePrice")).toHaveValue("45.50");
    await browserExpect(page.locator("#variant-sku")).toHaveValue("POLO-XL");
    await browserExpect(page.getByText("Algo salió mal")).toHaveCount(0);
    browserExpect((await stored()).sku).not.toBe("POLO-XL");

    await page.context().setOffline(false);
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await browserExpect(page.getByText("Variante guardada")).toBeVisible();
    browserExpect((await stored()).sku).toBe("POLO-XL");
  } finally {
    await cleanUp(email, companyId);
  }
});
