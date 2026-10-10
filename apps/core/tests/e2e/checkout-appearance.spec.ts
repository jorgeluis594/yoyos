import type { Locator, Page } from "@playwright/test";
import { describe } from "vitest";
import { browserExpect, expect, prepareVerifiedCompany, test } from "@core/tests/e2e/fixtures";
import { products } from "@core/src/features/products/composition";
import { orders } from "@core/src/features/orders/composition";
import type { ContactId, OrderId, PositiveInteger, UserId, CompanyId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==", "base64");
const editorPath = "/es-PE/settings/checkout-appearance";
const origin = `http://127.0.0.1:${process.env.CORE_E2E_PORT ?? "4173"}`;

async function openEditor(page: Page, email = `appearance-${crypto.randomUUID()}@example.test`) {
  const companyId = await prepareVerifiedCompany(page, { email, name: "Vendedora", companyName: "Lima Studio", country: "PE" });
  await page.goto(editorPath, { waitUntil: "networkidle" });
  await browserExpect(page.getByRole("heading", { name: "Apariencia del checkout", level: 1 })).toBeVisible();
  return companyId;
}

/** The upload endpoint answers with a stored public image, or with a failure. */
async function stubUpload(page: Page, companyId: string, outcome: "stored" | "missing" | "fails") {
  const id = crypto.randomUUID();
  if (outcome === "stored") await withTenantIsolation(companyId, async () => { await prisma.image.create({ data: { id, storageKey: `test/${id}` } }); });
  await page.route("**/test-images/*", (route) => route.fulfill({ status: 200, contentType: "image/png", body: png }));
  await page.route("**/api/images", (route) => outcome === "fails"
    ? route.fulfill({ status: 500, contentType: "application/json", body: "{}" })
    : route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id, url: `${origin}/test-images/test%2F${id}` }) }));
  return id;
}

/** Moves focus with the keyboard until the target has it; fails if it is not reachable. */
async function tabTo(page: Page, target: Locator, key: "Tab" | "Shift+Tab" = "Tab") {
  for (let step = 0; step < 20 && !(await target.evaluate((element) => element === document.activeElement)); step++) await page.keyboard.press(key);
  await browserExpect(target).toBeFocused();
}

const stored = (companyId: string) => withTenantIsolation(companyId, async () => await prisma.companyCheckoutAppearance.findUnique({ where: { companyId } }));
const uploadLogo = (page: Page) => page.getByTestId("logo-input").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png });

async function chooseColor(page: Page, name: string) {
  await page.getByRole("button", { name: /Cambiar$/ }).last().click();
  await page.getByRole("radio", { name }).click();
  await page.getByRole("button", { name: `Usar ${name}` }).click();
}

describe("checkout appearance editor", () => {
  test("publishes logo, color and background together when saving", async ({ page }) => {
    const companyId = await openEditor(page);
    const logoId = await stubUpload(page, companyId, "stored");
    await uploadLogo(page);
    await browserExpect(page.getByText("Logo cargado", { exact: true })).toBeVisible();
    await chooseColor(page, "Bosque");
    await page.getByRole("radio", { name: "De marca" }).click();
    expect(await stored(companyId)).toBeNull();
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await browserExpect(page.getByRole("status").filter({ hasText: "Apariencia actualizada" })).toBeVisible();
    expect(await stored(companyId)).toMatchObject({ logoImageId: logoId, brandColor: "forest", background: "brand_tint" });
    await page.reload();
    await browserExpect(page.getByText("Bosque", { exact: true })).toBeVisible();
    await browserExpect(page.getByRole("radio", { name: "De marca" })).toBeChecked();
    await browserExpect(page.getByText("Cambios sin guardar", { exact: true })).toHaveCount(0);
  });

  test("offers only the nine catalog colors, with no free color field", async ({ page }) => {
    await openEditor(page);
    await page.getByRole("button", { name: /Cambiar$/ }).last().click();
    await browserExpect(page.getByRole("dialog").getByRole("radio")).toHaveCount(9);
    await browserExpect(page.getByRole("dialog").locator("input[type=text], input[type=color]")).toHaveCount(0);
  });

  test("keeps the previous color when the dialog is cancelled, closed or dismissed with Escape", async ({ page }) => {
    await openEditor(page);
    const row = page.getByRole("button", { name: /Cambiar$/ }).last();
    for (const dismiss of [() => page.getByRole("button", { name: "Cancelar" }).click(), () => page.getByRole("button", { name: "Cerrar" }).click(), () => page.keyboard.press("Escape")]) {
      await row.click();
      await page.getByRole("radio", { name: "Océano" }).click();
      await dismiss();
      await browserExpect(page.getByRole("dialog")).toHaveCount(0);
      await browserExpect(row).toContainText("Yoyos");
      await browserExpect(row).toBeFocused();
    }
    await browserExpect(page.getByText("Cambios sin guardar", { exact: true })).toHaveCount(0);
  });

  test("chooses a color with the keyboard and changes only the draft", async ({ page }) => {
    const companyId = await openEditor(page);
    await page.getByRole("button", { name: /Cambiar$/ }).last().focus();
    await page.keyboard.press("Enter");
    await browserExpect(page.getByRole("radio", { name: /Yoyos/ })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await browserExpect(page.getByRole("radio", { name: "Bosque" })).toBeFocused();
    await page.keyboard.press("Space");
    await page.getByRole("button", { name: "Usar Bosque" }).click();
    await browserExpect(page.getByText("Cambios sin guardar", { exact: true })).toBeVisible();
    expect(await stored(companyId)).toBeNull();
  });

  test("shows the swatch of the active preview mode in the row and the dialog", async ({ page }) => {
    await openEditor(page);
    await chooseColor(page, "Bosque");
    const swatch = page.getByTestId("color-swatch");
    await browserExpect(swatch).toHaveCSS("background-color", "rgb(47, 107, 79)");
    await page.getByRole("button", { name: "Oscuro" }).click();
    await browserExpect(swatch).toHaveCSS("background-color", "rgb(143, 203, 168)");
    await browserExpect(page.getByText("Tono para modo oscuro")).toBeVisible();
    await page.getByRole("button", { name: /Cambiar$/ }).last().click();
    await browserExpect(page.getByTestId("swatch-forest")).toHaveCSS("background-color", "rgb(143, 203, 168)");
    await browserExpect(page.getByTestId("swatch-forest")).toHaveCount(1);
  });

  test("restores the published appearance when discarding", async ({ page }) => {
    await openEditor(page);
    await chooseColor(page, "Ciruela");
    await page.getByRole("radio", { name: "Blanco" }).click();
    await page.getByRole("button", { name: "Descartar" }).click();
    await browserExpect(page.getByText("Cambios sin guardar", { exact: true })).toHaveCount(0);
    await browserExpect(page.getByRole("radio", { name: "Neutro" })).toBeChecked();
    await browserExpect(page.getByRole("button", { name: /Cambiar$/ }).last()).toContainText("Yoyos");
  });

  test("requires saving to publish a reset", async ({ page }) => {
    const companyId = await openEditor(page);
    await chooseColor(page, "Bosque");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await browserExpect(page.getByRole("status").filter({ hasText: "Apariencia actualizada" })).toBeVisible();
    await page.getByRole("button", { name: "Restablecer apariencia" }).click();
    await browserExpect(page.getByText("Cambios sin guardar", { exact: true })).toBeVisible();
    expect(await stored(companyId)).toMatchObject({ brandColor: "forest" });
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await browserExpect(page.getByText("Cambios sin guardar", { exact: true })).toHaveCount(0);
    expect(await stored(companyId)).toMatchObject({ logoImageId: null, brandColor: "yoyos", background: "neutral" });
  });

  test("keeps the draft and the published appearance when an upload fails", async ({ page }) => {
    const companyId = await openEditor(page);
    await chooseColor(page, "Bosque");
    await stubUpload(page, companyId, "fails");
    await uploadLogo(page);
    await browserExpect(page.getByRole("alert").filter({ hasText: "No pudimos subir el logo" })).toBeVisible();
    await browserExpect(page.getByRole("button", { name: /Cambiar$/ }).last()).toContainText("Bosque");
    await browserExpect(page.getByRole("button", { name: "Guardar cambios" })).toBeEnabled();
    expect(await stored(companyId)).toBeNull();
  });

  test("keeps the draft and the published appearance when saving fails", async ({ page }) => {
    const companyId = await openEditor(page);
    await stubUpload(page, companyId, "missing");
    await uploadLogo(page);
    await chooseColor(page, "Bosque");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await browserExpect(page.getByRole("alert").filter({ hasText: "No pudimos usar ese logo" })).toBeVisible();
    await browserExpect(page.getByText("Cambios sin guardar", { exact: true })).toBeVisible();
    await browserExpect(page.getByRole("button", { name: /Cambiar$/ }).last()).toContainText("Bosque");
    expect(await stored(companyId)).toBeNull();
    await page.getByRole("button", { name: "Descartar" }).click();
    await browserExpect(page.getByRole("alert").filter({ hasText: "No pudimos usar ese logo" })).toHaveCount(0);
  });

  test("hides the saved notice once the draft changes, even after discarding", async ({ page }) => {
    await openEditor(page);
    await chooseColor(page, "Bosque");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    const notice = page.getByRole("status").filter({ hasText: "Apariencia actualizada" });
    await browserExpect(notice).toBeVisible();
    await chooseColor(page, "Ciruela");
    await browserExpect(notice).toHaveCount(0);
    await page.getByRole("button", { name: "Descartar" }).click();
    await browserExpect(page.getByText("Cambios sin guardar", { exact: true })).toHaveCount(0);
    await browserExpect(notice).toHaveCount(0);
  });

  test("disables discard and reset while a logo is uploading", async ({ page }) => {
    await openEditor(page);
    await chooseColor(page, "Bosque");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/api/images", async (route) => { await gate; await route.fulfill({ status: 500, contentType: "application/json", body: "{}" }); });
    await uploadLogo(page);
    await browserExpect(page.getByRole("status").filter({ hasText: "Subiendo logo" })).toBeVisible();
    await browserExpect(page.getByRole("button", { name: "Descartar" })).toBeDisabled();
    await browserExpect(page.getByRole("button", { name: "Restablecer apariencia" })).toBeDisabled();
    release();
    await browserExpect(page.getByRole("alert").filter({ hasText: "No pudimos subir el logo" })).toBeVisible();
    await browserExpect(page.getByRole("button", { name: "Descartar" })).toBeEnabled();
  });

  test("asks to keep editing or discard when leaving with changes", async ({ page }) => {
    await openEditor(page);
    await chooseColor(page, "Bosque");
    await page.getByRole("link", { name: "Productos" }).first().click();
    await browserExpect(page.getByRole("dialog", { name: "Tienes cambios sin guardar" })).toBeVisible();
    await page.getByRole("button", { name: "Seguir editando" }).click();
    await browserExpect(page).toHaveURL(/settings\/checkout-appearance/);
    await browserExpect(page.getByText("Cambios sin guardar", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Productos" }).first().click();
    await page.getByRole("button", { name: "Descartar y salir" }).click();
    await browserExpect(page).toHaveURL(/\/products/);
  });

  test("can be completed with the keyboard on a phone screen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const companyId = await openEditor(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const row = page.getByRole("button", { name: /Cambiar$/ }).last();
    await tabTo(page, row);
    await page.keyboard.press("Enter");
    await browserExpect(page.getByRole("dialog")).toBeVisible();
    await browserExpect(page.getByRole("radio", { name: /Yoyos/ })).toBeFocused();
    // Radix moves focus on a timer and selects only while the arrow is still down, so hold it like a real key press.
    await page.keyboard.press("ArrowRight", { delay: 50 });
    await browserExpect(page.getByRole("radio", { name: "Bosque" })).toBeFocused();
    await browserExpect(page.getByRole("radio", { name: "Bosque" })).toBeChecked();
    await page.keyboard.press("Tab");
    await browserExpect(page.getByRole("button", { name: "Cancelar" })).toBeFocused();
    await page.keyboard.press("Tab");
    await browserExpect(page.getByRole("button", { name: "Usar Bosque" })).toBeFocused();
    await page.keyboard.press("Enter");
    await browserExpect(page.getByRole("dialog")).toHaveCount(0);
    await browserExpect(row).toBeFocused();
    await browserExpect(row).toContainText("Bosque");
    await browserExpect(page.getByText("Cambios sin guardar", { exact: true })).toBeVisible();
    await page.keyboard.press("Tab");
    await browserExpect(page.getByRole("radio", { name: "Neutro" })).toBeFocused();
    await page.keyboard.press("ArrowRight", { delay: 50 });
    await browserExpect(page.getByRole("radio", { name: "De marca" })).toBeChecked();
    await tabTo(page, page.getByRole("button", { name: "Guardar cambios" }), "Shift+Tab");
    await page.keyboard.press("Enter");
    await browserExpect(page.getByRole("status").filter({ hasText: "Apariencia actualizada" })).toBeVisible();
    expect(await stored(companyId)).toMatchObject({ brandColor: "forest", background: "brand_tint" });
  });

  test("switches between edit and preview with the arrow keys on a phone and shows no tabs on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openEditor(page);
    const editTab = page.getByRole("tab", { name: "Editar" });
    const previewTab = page.getByRole("tab", { name: "Vista previa" });
    await tabTo(page, editTab);
    await browserExpect(editTab).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowRight");
    await browserExpect(previewTab).toBeFocused();
    await browserExpect(previewTab).toHaveAttribute("aria-selected", "true");
    await browserExpect(page.getByRole("region", { name: "Vista previa del checkout" })).toBeVisible();
    await page.keyboard.press("Tab");
    await browserExpect(editTab).not.toBeFocused();
    await page.setViewportSize({ width: 1280, height: 800 });
    await browserExpect(page.getByRole("tablist")).toHaveCount(0);
    await browserExpect(page.getByRole("tabpanel")).toHaveCount(0);
    await browserExpect(page.getByRole("button", { name: /Cambiar$/ }).last()).toBeVisible();
    await browserExpect(page.getByRole("region", { name: "Vista previa del checkout" })).toBeVisible();
  });

  test("shows the desktop layout before hydration on a wide screen", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openEditor(page);
    await page.route(/\.m?js(\?|$)/, (route) => route.abort());
    await page.reload({ waitUntil: "domcontentloaded" });
    await browserExpect(page.getByRole("tablist")).toHaveCount(0);
    const preview = page.getByRole("region", { name: "Vista previa del checkout" });
    const changeColor = page.getByRole("button", { name: /Cambiar$/ }).last();
    await browserExpect(preview).toBeVisible();
    await browserExpect(changeColor).toBeVisible();
    const [previewBox, colorBox] = [await preview.boundingBox(), await changeColor.boundingBox()];
    expect(colorBox!.x).toBeGreaterThan(previewBox!.x + previewBox!.width);
  });
});

/** A pending order of the company with its checkout enabled, as the seller shares it with a buyer. */
async function sharedCheckoutPath(companyId: string, email: string) {
  const user = await systemPrisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  const [tenant, userId, orderId, contactId] = [companyId as CompanyId, user.id as UserId, crypto.randomUUID() as OrderId, crypto.randomUUID() as ContactId];
  await withTenantIsolation(tenant, async () => {
    const product = await products.create({ name: "Cuaderno", currency: "PEN", variants: [{ attributes: { Color: "Azul" }, salePrice: 10, initialStock: 3 }] });
    if (!product.success) throw new Error("Product fixture failed");
    const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: product.data } });
    await prisma.contact.create({ data: { id: contactId, name: "Ana", phone: "+51987654321" } });
    const created = await orders.create({ id: orderId, contactId, items: [{ variantId: variant.id as VariantId, quantity: 1 as PositiveInteger }] }, { companyId: tenant, userId });
    if (!created.success) throw new Error("Order fixture failed");
    expect(await orders.enableCheckout(orderId, { companyId: tenant, userId })).toMatchObject({ success: true });
  });
  return `/checkout/${companyId}/${orderId}`;
}

describe("checkout appearance editor with the live preview", () => {
  const previewFrame = (page: Page) => page.frameLocator('iframe[title="Vista previa del checkout"]');
  const confirmColor = (page: Page) => previewFrame(page).getByRole("button", { name: "Confirmar pedido" }).evaluate((node) => getComputedStyle(node).backgroundColor);

  test("shows the published appearance and a preview with sample data", async ({ page }) => {
    await openEditor(page);
    await browserExpect(previewFrame(page).getByText("Vista previa · Datos de ejemplo")).toBeVisible();
    await browserExpect(previewFrame(page).getByRole("heading", { name: "Pedido #1001" })).toBeVisible();
    await browserExpect(page.getByRole("button", { name: /Cambiar$/ }).last()).toContainText("Yoyos");
  });

  test("updates the preview without changing the public checkout", async ({ page }) => {
    const email = `appearance-${crypto.randomUUID()}@example.test`;
    const companyId = await openEditor(page, email);
    const path = await sharedCheckoutPath(companyId, email);
    const before = await confirmColor(page);
    await chooseColor(page, "Bosque");
    await browserExpect.poll(() => confirmColor(page)).toBe("rgb(47, 107, 79)");
    expect(await stored(companyId)).toBeNull();
    const buyer = await page.context().newPage();
    await buyer.goto(path);
    await browserExpect(buyer.getByRole("button", { name: "Confirmar pedido" })).toHaveCSS("background-color", before);
  });

  test("applies the new appearance to a previously shared link on reload", async ({ page }) => {
    const email = `appearance-${crypto.randomUUID()}@example.test`;
    const companyId = await openEditor(page, email);
    const path = await sharedCheckoutPath(companyId, email);
    const buyer = await page.context().newPage();
    await buyer.goto(path);
    const confirm = buyer.getByRole("button", { name: "Confirmar pedido" });
    await browserExpect(confirm).not.toHaveCSS("background-color", "rgb(47, 107, 79)");
    await chooseColor(page, "Bosque");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await browserExpect(page.getByRole("status").filter({ hasText: "Apariencia actualizada" })).toBeVisible();
    await buyer.reload();
    await browserExpect(confirm).toHaveCSS("background-color", "rgb(47, 107, 79)");
  });

  test("switches the preview between phone and desktop, light and dark, review and payment", async ({ page }) => {
    await openEditor(page);
    const frame = page.locator('iframe[title="Vista previa del checkout"]');
    await browserExpect(frame).toHaveAttribute("data-device", "phone");
    await page.getByRole("button", { name: "Escritorio" }).click();
    await browserExpect(frame).toHaveAttribute("data-device", "desktop");
    await page.getByRole("button", { name: "Oscuro", exact: true }).click();
    await browserExpect(previewFrame(page).locator("html.dark")).toBeAttached();
    await page.getByRole("button", { name: "Claro", exact: true }).click();
    await browserExpect(previewFrame(page).locator("html.dark")).toHaveCount(0);
    await page.getByRole("button", { name: "Pago", exact: true }).click();
    await browserExpect(previewFrame(page).getByRole("heading", { name: "Cómo pagar" })).toBeVisible();
    await page.getByRole("button", { name: "Revisión", exact: true }).click();
    await browserExpect(previewFrame(page).getByRole("heading", { name: "Tus datos" })).toBeVisible();
  });
});
