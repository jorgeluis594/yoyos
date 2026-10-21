import type { Locator, Page } from "@playwright/test";
import { describe } from "vitest";
import { browserExpect, expect, test } from "@core/tests/e2e/fixtures";
import { checkoutThemeIds, checkoutThemes } from "@core/src/features/checkout-appearance/domain/checkout-themes";
import { openEditor, rgb, sharedCheckoutPath } from "@core/tests/e2e/checkout-appearance-fixtures";
import { prisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==", "base64");
const origin = `http://127.0.0.1:${process.env.CORE_E2E_PORT ?? "4173"}`;

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
  for (let step = 0; step < 30 && !(await target.evaluate((element) => element === document.activeElement)); step++) await page.keyboard.press(key);
  await browserExpect(target).toBeFocused();
}

const stored = (companyId: string) => withTenantIsolation(companyId, async () => await prisma.companyCheckoutAppearance.findUnique({ where: { companyId } }));
const uploadLogo = (page: Page) => page.getByTestId("logo-upload").locator("input[type=file]").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png });
const themeOption = (page: Page, name: string) => page.getByRole("radio", { name: new RegExp(`^${name}`) });
const themeList = (page: Page) => page.getByRole("radiogroup", { name: "Temas del checkout" });
const checkoutThemeId = (page: Page) => page.locator("[data-checkout-theme]").getAttribute("data-checkout-theme-id");
const saveChanges = (page: Page) => page.getByRole("button", { name: "Guardar cambios" });
const savedNotice = (page: Page) => page.getByRole("status").filter({ hasText: "Apariencia actualizada" });
const unsaved = (page: Page) => page.getByText("Cambios sin guardar", { exact: true });

describe("checkout appearance editor", () => {
  test("publishes logo and theme together when saving and the buyer sees the theme on the next load", async ({ page }) => {
    const email = `appearance-${crypto.randomUUID()}@example.test`;
    const companyId = await openEditor(page, email);
    const path = await sharedCheckoutPath(companyId, email);
    const buyer = await page.context().newPage();
    await buyer.goto(path);
    expect(await checkoutThemeId(buyer)).toBe("classic");
    const logoId = await stubUpload(page, companyId, "stored");
    await uploadLogo(page);
    await browserExpect(page.getByText("Logo cargado", { exact: true })).toBeVisible();
    await themeOption(page, "Antojo").click();
    await browserExpect(unsaved(page)).toBeVisible();
    expect(await stored(companyId)).toBeNull();
    await buyer.reload();
    expect(await checkoutThemeId(buyer)).toBe("classic");
    await saveChanges(page).click();
    await browserExpect(savedNotice(page)).toBeVisible();
    expect(await stored(companyId)).toMatchObject({ logoImageId: logoId, theme: "antojo" });
    await buyer.reload();
    expect(await checkoutThemeId(buyer)).toBe("antojo");
    await browserExpect(buyer.getByRole("button", { name: "Confirmar pedido" })).toHaveCSS("background-color", rgb(checkoutThemes.antojo.colors.primary));
    await page.reload();
    await browserExpect(themeOption(page, "Antojo")).toBeChecked();
    await browserExpect(unsaved(page)).toHaveCount(0);
  });

  test("offers the five themes and no color, background or light and dark control", async ({ page }) => {
    await openEditor(page);
    await browserExpect(page.getByText("Logo", { exact: true })).toBeVisible();
    await browserExpect(page.getByText("Tema", { exact: true })).toBeVisible();
    await browserExpect(page.getByRole("button", { name: "Restablecer apariencia" })).toBeVisible();
    const options = themeList(page).getByRole("radio");
    await browserExpect(options).toHaveCount(checkoutThemeIds.length);
    for (const [index, id] of checkoutThemeIds.entries()) await browserExpect(options.nth(index)).toContainText(checkoutThemes[id].name);
    await browserExpect(themeOption(page, "Clásico")).toBeChecked();
    await browserExpect(themeOption(page, "Clásico")).toContainText("Blanco y negro, sobrio. El tema por defecto.");
    for (const removed of ["Color de marca", "Fondo"]) await browserExpect(page.getByText(removed, { exact: true })).toHaveCount(0);
    for (const removed of ["Claro", "Oscuro"]) await browserExpect(page.getByRole("button", { name: removed, exact: true })).toHaveCount(0);
    await browserExpect(page.locator("input[type=color]")).toHaveCount(0);
  });

  test("keeps the selection when the selected theme is chosen again", async ({ page }) => {
    await openEditor(page);
    await themeOption(page, "Clásico").click();
    await browserExpect(themeOption(page, "Clásico")).toBeChecked();
    await browserExpect(unsaved(page)).toHaveCount(0);
  });

  test("restores the published appearance when discarding", async ({ page }) => {
    await openEditor(page);
    await themeOption(page, "Suave").click();
    await browserExpect(unsaved(page)).toBeVisible();
    await page.getByRole("button", { name: "Descartar" }).click();
    await browserExpect(unsaved(page)).toHaveCount(0);
    await browserExpect(themeOption(page, "Clásico")).toBeChecked();
  });

  test("requires saving to publish a reset", async ({ page }) => {
    const companyId = await openEditor(page);
    await themeOption(page, "Boutique").click();
    await saveChanges(page).click();
    await browserExpect(savedNotice(page)).toBeVisible();
    await page.getByRole("button", { name: "Restablecer apariencia" }).click();
    await browserExpect(unsaved(page)).toBeVisible();
    await browserExpect(themeOption(page, "Clásico")).toBeChecked();
    expect(await stored(companyId)).toMatchObject({ theme: "boutique" });
    await saveChanges(page).click();
    await browserExpect(unsaved(page)).toHaveCount(0);
    expect(await stored(companyId)).toMatchObject({ logoImageId: null, theme: "classic" });
  });

  test("keeps the draft and the published appearance when an upload fails", async ({ page }) => {
    const companyId = await openEditor(page);
    await themeOption(page, "Boutique").click();
    await stubUpload(page, companyId, "fails");
    await uploadLogo(page);
    await browserExpect(page.getByRole("alert").filter({ hasText: "No pudimos subir el logo" })).toBeVisible();
    await browserExpect(themeOption(page, "Boutique")).toBeChecked();
    await browserExpect(saveChanges(page)).toBeEnabled();
    expect(await stored(companyId)).toBeNull();
  });

  test("keeps the draft and the published appearance when saving fails", async ({ page }) => {
    const companyId = await openEditor(page);
    await stubUpload(page, companyId, "missing");
    await uploadLogo(page);
    await themeOption(page, "Boutique").click();
    await saveChanges(page).click();
    await browserExpect(page.getByRole("alert").filter({ hasText: "No pudimos usar ese logo" })).toBeVisible();
    await browserExpect(unsaved(page)).toBeVisible();
    await browserExpect(themeOption(page, "Boutique")).toBeChecked();
    expect(await stored(companyId)).toBeNull();
    await page.getByRole("button", { name: "Descartar" }).click();
    await browserExpect(page.getByRole("alert").filter({ hasText: "No pudimos usar ese logo" })).toHaveCount(0);
  });

  test("hides the saved notice once the draft changes, even after discarding", async ({ page }) => {
    await openEditor(page);
    await themeOption(page, "Boutique").click();
    await saveChanges(page).click();
    await browserExpect(savedNotice(page)).toBeVisible();
    await themeOption(page, "Antojo").click();
    await browserExpect(savedNotice(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Descartar" }).click();
    await browserExpect(unsaved(page)).toHaveCount(0);
    await browserExpect(savedNotice(page)).toHaveCount(0);
  });

  test("disables discard and reset while a logo is uploading", async ({ page }) => {
    await openEditor(page);
    await themeOption(page, "Boutique").click();
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
    await themeOption(page, "Boutique").click();
    await page.getByRole("link", { name: "Productos" }).first().click();
    await browserExpect(page.getByRole("dialog", { name: "Tienes cambios sin guardar" })).toBeVisible();
    await page.getByRole("button", { name: "Seguir editando" }).click();
    await browserExpect(page).toHaveURL(/settings\/checkout-appearance/);
    await browserExpect(unsaved(page)).toBeVisible();
    await page.getByRole("link", { name: "Productos" }).first().click();
    await page.getByRole("button", { name: "Descartar y salir" }).click();
    await browserExpect(page).toHaveURL(/\/products/);
  });

  test("keeps Suave selected when choosing to keep editing after trying to leave", async ({ page }) => {
    const companyId = await openEditor(page);
    await themeOption(page, "Suave").click();
    await page.getByRole("link", { name: "Productos" }).first().click();
    await page.getByRole("button", { name: "Seguir editando" }).click();
    await browserExpect(page).toHaveURL(/settings\/checkout-appearance/);
    await browserExpect(themeOption(page, "Suave")).toBeChecked();
    await browserExpect(unsaved(page)).toBeVisible();
    expect(await stored(companyId)).toBeNull();
  });

  test("keeps Suave selected when the save gets no response and publishes it once on retry", async ({ page }) => {
    const companyId = await openEditor(page);
    await themeOption(page, "Suave").click();
    // The whole connection is lost: neither the save nor the revalidation that could follow it gets through.
    let offline = true;
    let saves = 0;
    await page.route("**/settings/checkout-appearance*", (route) => {
      if (route.request().method() === "POST") saves += 1;
      return offline ? route.abort("failed") : route.continue();
    });
    await saveChanges(page).click();
    const notice = page.getByRole("alert").filter({ hasText: "No pudimos guardar la apariencia" });
    await browserExpect(notice).toBeVisible();
    await browserExpect(notice.getByRole("button", { name: "Reintentar" })).toBeVisible();
    await browserExpect(themeOption(page, "Suave")).toBeChecked();
    expect(await stored(companyId)).toBeNull();
    offline = false;
    await notice.getByRole("button", { name: "Reintentar" }).click();
    await browserExpect(savedNotice(page)).toBeVisible();
    expect(saves).toBe(2);
    expect(await stored(companyId)).toMatchObject({ theme: "suave" });
    await browserExpect(themeOption(page, "Suave")).toBeChecked();
  });

  test("can be completed with the keyboard on a phone screen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const companyId = await openEditor(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await tabTo(page, themeOption(page, "Clásico"));
    // Radix moves focus on a timer and selects only while the arrow is still down, so hold it like a real key press.
    await page.keyboard.press("ArrowDown", { delay: 50 });
    await browserExpect(themeOption(page, "Boutique")).toBeFocused();
    await browserExpect(themeOption(page, "Boutique")).toBeChecked();
    await browserExpect(unsaved(page)).toBeVisible();
    await tabTo(page, saveChanges(page), "Shift+Tab");
    await page.keyboard.press("Enter");
    await browserExpect(savedNotice(page)).toBeVisible();
    expect(await stored(companyId)).toMatchObject({ theme: "boutique" });
  });

  test("lists the themes in one column inside the 22 rem side panel on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openEditor(page);
    const [first, second] = [await themeOption(page, "Clásico").boundingBox(), await themeOption(page, "Boutique").boundingBox()];
    expect(second!.y).toBeGreaterThan(first!.y);
    expect(Math.abs(second!.x - first!.x)).toBeLessThan(1);
    expect(first!.height).toBeGreaterThanOrEqual(44);
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
    await browserExpect(themeList(page)).toBeVisible();
    await browserExpect(page.getByRole("region", { name: "Vista previa del checkout" })).toBeVisible();
  });

  test("shows the desktop layout before hydration on a wide screen", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openEditor(page);
    await page.route(/\.m?js(\?|$)/, (route) => route.abort());
    await page.reload({ waitUntil: "domcontentloaded" });
    await browserExpect(page.getByRole("tablist")).toHaveCount(0);
    const preview = page.getByRole("region", { name: "Vista previa del checkout" });
    const themes = themeList(page);
    await browserExpect(preview).toBeVisible();
    await browserExpect(themes).toBeVisible();
    const [previewBox, themesBox] = [await preview.boundingBox(), await themes.boundingBox()];
    expect(themesBox!.x).toBeGreaterThan(previewBox!.x + previewBox!.width);
  });
});

describe("checkout appearance editor with the live preview", () => {
  const previewFrame = (page: Page) => page.frameLocator('iframe[title="Vista previa del checkout"]');

  test("shows the published appearance and a preview with sample data", async ({ page }) => {
    await openEditor(page);
    await browserExpect(previewFrame(page).getByText("Vista previa · Datos de ejemplo")).toBeVisible();
    await browserExpect(previewFrame(page).getByRole("heading", { name: "Pedido #1001" })).toBeVisible();
    await browserExpect(themeOption(page, "Clásico")).toBeChecked();
  });

  test("switches the preview between phone and desktop and between review and payment, with no light or dark mode", async ({ page }) => {
    await openEditor(page);
    const frame = page.locator('iframe[title="Vista previa del checkout"]');
    await browserExpect(frame).toHaveAttribute("data-device", "phone");
    await page.getByRole("button", { name: "Escritorio" }).click();
    await browserExpect(frame).toHaveAttribute("data-device", "desktop");
    await themeOption(page, "Noche").click();
    await browserExpect(previewFrame(page).locator('[data-checkout-theme-id="noche"].dark')).toBeAttached();
    await browserExpect(previewFrame(page).locator("html.dark")).toHaveCount(0);
    await page.getByRole("button", { name: "Pago", exact: true }).click();
    await browserExpect(previewFrame(page).getByRole("heading", { name: "Cómo pagar" })).toBeVisible();
    await page.getByRole("button", { name: "Revisión", exact: true }).click();
    await browserExpect(previewFrame(page).getByRole("heading", { name: "Tus datos" })).toBeVisible();
  });
});
