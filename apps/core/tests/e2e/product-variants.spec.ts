import { brandHostHeaders, browserExpect, expect, prepareVerifiedCompany, publishCatalog, subdomainOf, test } from "./fixtures";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { seedProduct } from "@core/src/features/products/infrastructure/product-seed";
import type { Page } from "@playwright/test";

const poloVariants = ["S", "M", "L"].flatMap((Talla) => ["Negro", "Azul"].map((Color) => ({ attributes: { Talla, Color }, salePrice: 39.9, stock: 4 })));
const poloOptions = [{ name: "Talla", values: ["S", "M", "L"] }, { name: "Color", values: ["Negro", "Azul"] }];

async function cleanUp(email: string, companyId: string | undefined) {
  if (!companyId) return;
  await withTenantIsolation(companyId, async () => {
    await prisma.payment.deleteMany(); await prisma.orderItem.deleteMany(); await prisma.order.deleteMany();
    await prisma.productStock.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.productOption.deleteMany(); await prisma.product.deleteMany();
    await systemPrisma.user.deleteMany({ where: { email } }); await prisma.company.delete({ where: { id: companyId } });
  });
}

async function addOption(page: Page, name: string, values: readonly string[]) {
  await page.getByLabel("Nombre de la opción").fill(name);
  for (const value of values) await page.getByLabel("Agregar otro valor").fill(value);
  await page.getByRole("button", { name: "Listo", exact: true }).click();
}

const rowLabels = (page: Page) => page.getByRole("row").filter({ has: page.getByRole("checkbox") });

test("creates Polo básico with Talla and Color, removes S / Azul and saves five variants", async ({ page }) => {
  const email = `variants-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    companyId = await prepareVerifiedCompany(page, { email, name: "Ana Variantes", companyName: "Empresa Variantes", country: "PE" });
    await page.goto("/es-PE/products/new");
    await page.getByLabel("Nombre *").fill("Polo básico");
    await page.getByLabel("Precio de venta (PEN) *").fill("39.90");
    await page.getByLabel("Stock inicial").fill("4");

    await page.getByRole("button", { name: "Agregar opciones como talla o color" }).click();
    await addOption(page, "Talla", ["S", "M", "L"]);
    await page.getByRole("button", { name: "Agregar otra opción" }).click();
    await addOption(page, "Color", ["Negro", "Azul"]);

    await browserExpect(rowLabels(page)).toHaveCount(6);
    await browserExpect(rowLabels(page).first()).toContainText("S / Negro");
    await browserExpect(rowLabels(page).last()).toContainText("L / Azul");
    await browserExpect(page.getByText("Se copió el stock 4 a cada combinación. Corrige las que tengan otra cantidad.")).toBeVisible();
    await browserExpect(page.getByLabel("Precio de venta de S / Azul")).toHaveValue("39.90");
    await browserExpect(page.getByLabel("Stock", { exact: true })).toHaveValue("24");
    await browserExpect(page.getByLabel("SKU")).toHaveCount(0);

    await page.getByRole("button", { name: "L", exact: true }).click();
    await page.getByRole("button", { name: "Editar precio", exact: true }).click();
    await page.getByRole("spinbutton", { name: "Editar precio de venta" }).fill("42.90");
    await page.getByRole("button", { name: "Aplicar a 2 variantes" }).click();
    await browserExpect(page.getByLabel("Precio de venta de L / Azul")).toHaveValue("42.90");
    await browserExpect(page.getByLabel("Precio de venta de M / Azul")).toHaveValue("39.90");
    await page.getByRole("button", { name: "L", exact: true }).click();
    await browserExpect(page.getByText("2 seleccionadas")).toHaveCount(0);

    await page.getByRole("button", { name: "Quitar S / Azul" }).click();
    await browserExpect(page.getByText("Se quitará", { exact: true })).toBeVisible();
    await browserExpect(page.getByText("5 de 100 variantes")).toBeVisible();
    await browserExpect(page.getByLabel("Stock", { exact: true })).toHaveValue("20");

    await page.getByRole("button", { name: "Guardar producto" }).click();
    await browserExpect(page).toHaveURL(/\/es-PE\/products\/[0-9a-f-]+(\?saved=1)?$/);
    await browserExpect(page.getByRole("heading", { name: "Polo básico" })).toBeVisible();
    await browserExpect(rowLabels(page)).toHaveCount(5);
    await browserExpect(rowLabels(page).filter({ hasText: "S / Azul" })).toHaveCount(0);
    await browserExpect(page.getByLabel("Precio de venta de L / Negro")).toHaveValue("42.90");
    await browserExpect(page.getByText("1 combinación sin crear: S / Azul")).toBeVisible();
    expect(await withTenantIsolation(companyId, async () => await prisma.productVariant.count())).toBe(5);

    await page.goto("/es-PE/products");
    await browserExpect(page.getByRole("row", { name: /Polo básico/ })).toContainText("20");
  } finally {
    await cleanUp(email, companyId);
  }
});

test("adds XL to a saved product and shows the two new variants in the saved table", async ({ page }) => {
  const email = `variants-add-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    companyId = await prepareVerifiedCompany(page, { email, name: "Ana Agrega", companyName: "Empresa Agrega", country: "PE" });
    const tenantId = companyId;
    const { productId } = await withTenantIsolation(tenantId, async () => await seedProduct({ name: "Polo básico", options: poloOptions, variants: poloVariants }));
    await page.goto(`/es-PE/products/${productId}`);
    await browserExpect(rowLabels(page)).toHaveCount(6);
    await browserExpect(page.getByLabel("Stock", { exact: true })).toHaveValue("24");

    await page.getByRole("button", { name: "Editar Talla" }).click();
    await page.getByLabel("Agregar otro valor").fill("XL");
    await page.getByRole("button", { name: "Listo", exact: true }).click();
    await browserExpect(rowLabels(page)).toHaveCount(8);
    await browserExpect(rowLabels(page).nth(6)).toContainText("XL / Negro");
    await browserExpect(rowLabels(page).nth(6)).toContainText("Nueva");
    await browserExpect(page.getByLabel("Stock de XL / Azul")).toHaveValue("0");
    await browserExpect(page.getByLabel("Precio de venta de XL / Negro")).toHaveValue("39.90");

    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await browserExpect(page).toHaveURL(`/es-PE/products/${productId}?saved=1`);
    await browserExpect(rowLabels(page)).toHaveCount(8);
    await browserExpect(page.getByText("Nueva", { exact: true })).toHaveCount(0);
    await browserExpect(rowLabels(page).nth(7)).toContainText("XL / Azul");
    const variants = await withTenantIsolation(tenantId, async () => await prisma.productVariant.findMany({ include: { stock: true } }));
    expect(variants).toHaveLength(8);
    expect(variants.filter((variant) => variant.stock?.quantity === 4n)).toHaveLength(6);
  } finally {
    await cleanUp(email, companyId);
  }
});

test("renames Negro in the editor and a new order shows Negro carbón while the old one keeps Negro", async ({ page }) => {
  const email = `variants-rename-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    companyId = await prepareVerifiedCompany(page, { email, name: "Ana Renombra", companyName: "Empresa Renombra", country: "PE" });
    const tenantId = companyId;
    const { productId, variantIds } = await withTenantIsolation(tenantId, async () => await seedProduct({ name: "Polo básico", options: poloOptions, variants: poloVariants }));
    const mNegro = variantIds[2];
    const oldOrder = crypto.randomUUID();
    expect((await page.request.post("/api/orders", { data: { id: oldOrder, items: [{ variantId: mNegro, quantity: 1 }] } })).status()).toBe(201);

    await page.goto(`/es-PE/products/${productId}`);
    await page.getByRole("button", { name: "Editar Color" }).click();
    await page.getByLabel("Valor 1 de Color").fill("Negro carbón");
    await browserExpect(page.getByText("Antes «Negro». Los pedidos anteriores conservan el nombre «Negro».")).toBeVisible();
    await page.getByRole("button", { name: "Listo", exact: true }).click();
    await browserExpect(page.getByText("M / Negro carbón")).toBeVisible();
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await browserExpect(page).toHaveURL(`/es-PE/products/${productId}?saved=1`);

    const newOrder = crypto.randomUUID();
    expect((await page.request.post("/api/orders", { data: { id: newOrder, items: [{ variantId: mNegro, quantity: 1 }] } })).status()).toBe(201);
    const attributes = async (orderId: string) => (await withTenantIsolation(tenantId, async () => await prisma.orderItem.findFirstOrThrow({ where: { orderId } }))).variantAttributes;
    expect(await attributes(oldOrder)).toEqual({ Talla: "M", Color: "Negro" });
    expect(await attributes(newOrder)).toEqual({ Talla: "M", Color: "Negro carbón" });
  } finally {
    await cleanUp(email, companyId);
  }
});

test("opens the detail of a new variant from the saved table", async ({ page }) => {
  const email = `variants-detail-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    companyId = await prepareVerifiedCompany(page, { email, name: "Ana Detalle", companyName: "Empresa Detalle", country: "PE" });
    const { productId } = await withTenantIsolation(companyId, async () => await seedProduct({ name: "Polo básico", options: poloOptions, variants: poloVariants }));
    await page.goto(`/es-PE/products/${productId}`);
    await page.getByRole("button", { name: "Editar Talla" }).click();
    await page.getByLabel("Agregar otro valor").fill("XL");
    await page.getByRole("button", { name: "Listo", exact: true }).click();
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await browserExpect(page).toHaveURL(`/es-PE/products/${productId}?saved=1`);

    await rowLabels(page).filter({ hasText: "XL / Negro" }).getByRole("link", { name: "XL / Negro" }).click();
    await browserExpect(page).toHaveURL(new RegExp(`/es-PE/products/${productId}/variants/[0-9a-f-]+$`));
    await browserExpect(page.getByRole("heading", { name: "XL / Negro", level: 1 })).toBeVisible();
    await browserExpect(page.getByText("Variante de Polo básico")).toBeVisible();
    await browserExpect(page.getByLabel("Stock", { exact: true })).toHaveValue("0");
    await browserExpect(page.getByLabel("Precio de venta (PEN) *")).toHaveValue("39.90");
    await browserExpect(page.getByRole("link", { name: /XL \/ Negro/ })).toHaveAttribute("aria-current", "page");

    await page.getByLabel("SKU (opcional)").fill("POLO-XL-N");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await browserExpect(page.getByText("Variante guardada", { exact: true })).toBeVisible();
    const saved = await withTenantIsolation(companyId, async () => await prisma.productVariant.findMany({ where: { sku: "POLO-XL-N" } }));
    expect(saved).toHaveLength(1);
  } finally {
    await cleanUp(email, companyId);
  }
});

test("deactivates a variant and the public catalog no longer offers it", async ({ page }) => {
  const email = `variants-off-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    companyId = await prepareVerifiedCompany(page, { email, name: "Ana Desactiva", companyName: "Empresa Desactiva", country: "PE" });
    const tenantId = companyId;
    const { productId, variantIds } = await withTenantIsolation(tenantId, async () => await seedProduct({ name: "Polo básico", options: [{ name: "Talla", values: ["S", "XL"] }],
      variants: [{ attributes: { Talla: "S" }, salePrice: 39.9, stock: 4 }, { attributes: { Talla: "XL" }, salePrice: 39.9, stock: 6 }] }));
    const subdomain = subdomainOf(tenantId);
    await publishCatalog(tenantId, subdomain);
    const catalogPage = async () => await (await page.request.get(`/productos/${productId}`, { headers: brandHostHeaders(subdomain) })).text();
    expect(await catalogPage()).toContain("XL");

    await page.goto(`/es-PE/products/${productId}/variants/${variantIds[1]}`);
    await page.getByRole("button", { name: "Desactivar variante" }).click();
    await browserExpect(page.getByText("¿Desactivar XL?")).toBeVisible();
    await browserExpect(page.getByText("Todavía tiene 6 unidades en stock.")).toBeVisible();
    await page.getByRole("button", { name: "Desactivar", exact: true }).click();
    await browserExpect(page.getByText("Variante desactivada", { exact: true })).toBeVisible();
    await browserExpect(page.getByText("Variante desactivada. No aparece en tu tienda ni al crear pedidos.")).toBeVisible();
    await browserExpect(page.getByRole("button", { name: "Activar variante" })).toBeVisible();
    expect((await withTenantIsolation(tenantId, async () => await prisma.productVariant.findUniqueOrThrow({ where: { id: variantIds[1] } }))).status).toBe("inactive");
    expect(await catalogPage()).not.toContain("XL");

    await page.getByRole("button", { name: "Activar variante" }).click();
    await browserExpect(page.getByText("Variante activada", { exact: true })).toBeVisible();
    expect(await catalogPage()).toContain("XL");
  } finally {
    await cleanUp(email, companyId);
  }
});

test("prints a variant label from its detail", async ({ page }) => {
  const email = `variants-print-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    companyId = await prepareVerifiedCompany(page, { email, name: "Ana Imprime", companyName: "Empresa Imprime", country: "PE" });
    const { productId, variantIds } = await withTenantIsolation(companyId, async () => await seedProduct({ name: "Polo básico", options: poloOptions,
      variants: poloVariants.map((variant, index) => ({ ...variant, sku: index === 5 ? "POLO-L-AZ" : null })) }));
    await page.addInitScript(() => { Object.assign(window, { printCalls: 0 }); window.print = () => { (window as unknown as { printCalls: number }).printCalls += 1; }; });
    await page.goto(`/es-PE/products/${productId}/variants/${variantIds[5]}`);
    await browserExpect(page.getByRole("heading", { name: "L / Azul", level: 1 })).toBeVisible();

    await page.getByRole("button", { name: "Imprimir" }).click();
    await browserExpect(async () => expect(await page.evaluate(() => (window as unknown as { printCalls: number }).printCalls)).toBe(1)).toPass();
    const label = page.locator("#variant-label");
    await browserExpect(label).toContainText("Polo básico");
    await browserExpect(label).toContainText("L / Azul");
    await browserExpect(label).toContainText("POLO-L-AZ");
    await browserExpect(label.locator("svg path")).toHaveCount(1);
    await page.emulateMedia({ media: "print" });
    await browserExpect(label).toBeVisible();
    await browserExpect(page.getByRole("heading", { name: "L / Azul", level: 1 })).toBeHidden();
  } finally {
    await cleanUp(email, companyId);
  }
});

test("asks to discard the changes before opening a saved variant from a product with changes", async ({ page }) => {
  const email = `variants-discard-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    companyId = await prepareVerifiedCompany(page, { email, name: "Ana Descarta", companyName: "Empresa Descarta", country: "PE" });
    const { productId } = await withTenantIsolation(companyId, async () => await seedProduct({ name: "Polo básico", options: poloOptions, variants: poloVariants }));
    await page.goto(`/es-PE/products/${productId}`);
    await page.getByLabel("Precio de venta de S / Negro").fill("50.00");
    await rowLabels(page).filter({ hasText: "S / Negro" }).getByRole("link", { name: "S / Negro" }).click();
    await browserExpect(page.getByText("¿Descartar cambios?")).toBeVisible();
    await page.getByRole("button", { name: "Seguir editando" }).click();
    await browserExpect(page).toHaveURL(`/es-PE/products/${productId}`);
    await browserExpect(page.getByLabel("Precio de venta de S / Negro")).toHaveValue("50.00");
    await rowLabels(page).filter({ hasText: "S / Negro" }).getByRole("link", { name: "S / Negro" }).click();
    await page.getByRole("button", { name: "Descartar", exact: true }).click();
    await browserExpect(page).toHaveURL(new RegExp(`/es-PE/products/${productId}/variants/[0-9a-f-]+$`));
  } finally {
    await cleanUp(email, companyId);
  }
});

test("deletes a variant without orders or stock and returns to the product without asking to discard", async ({ page }) => {
  const email = `variants-delete-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    companyId = await prepareVerifiedCompany(page, { email, name: "Ana Elimina", companyName: "Empresa Elimina", country: "PE" });
    const tenantId = companyId;
    const { productId, variantIds } = await withTenantIsolation(tenantId, async () => await seedProduct({ name: "Polo básico", options: poloOptions, variants: poloVariants.map((variant) => ({ ...variant, stock: 0 })) }));
    await page.goto(`/es-PE/products/${productId}/variants/${variantIds[0]}`);
    await page.getByLabel("SKU (opcional)").fill("EDITADO");
    await page.getByRole("button", { name: "Eliminar variante" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Eliminar variante" }).click();
    await browserExpect(page).toHaveURL(`/es-PE/products/${productId}?variantDeleted=1`);
    await browserExpect(page.getByText("Variante eliminada", { exact: true })).toBeVisible();
    await browserExpect(rowLabels(page)).toHaveCount(5);
    expect(await withTenantIsolation(tenantId, async () => await prisma.productVariant.count())).toBe(5);
  } finally {
    await cleanUp(email, companyId);
  }
});
