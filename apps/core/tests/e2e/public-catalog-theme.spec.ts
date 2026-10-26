import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { browserExpect, expect, prepareVerifiedCompany, publishCatalog as publishStore, test } from "@core/tests/e2e/fixtures";
import { withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { openEditor, rgb, saveCompanyAppearance } from "@core/tests/e2e/store-appearance-fixtures";
import { storeThemes, type StoreThemeId } from "@shared/store-themes";
import { seedProduct } from "@core/src/features/products/infrastructure/product-seed";

const baseURL = `http://127.0.0.1:${process.env.CORE_E2E_PORT ?? "4173"}`;
const scope = (page: Page) => page.locator("[data-store-theme]");

/** A published catalog on its brand host with one product that has a single variant, so the buyer can add it with one click. Returns the brand address. */
async function publishCatalog(companyId: string) {
  await withTenantIsolation(companyId, async () => seedProduct({ name: "Polo básico", variants: [{ attributes: { Color: "Negro" }, salePrice: 45, stock: 5 }] }));
  return publishStore(companyId);
}

/** A phone browser of a buyer whose system asks for `colorScheme`. */
async function openBuyer(page: Page, colorScheme: "light" | "dark") {
  const context = await page.context().browser()!.newContext({ baseURL, viewport: { width: 390, height: 844 }, colorScheme });
  return { context, buyer: await context.newPage() };
}

async function expectTheme(page: Page, id: StoreThemeId) {
  await browserExpect(scope(page)).toHaveAttribute("data-store-theme-id", id);
  await browserExpect(scope(page)).toHaveCSS("background-color", rgb(storeThemes[id].colors.background));
  await browserExpect(page.locator("html")).toHaveAttribute("data-color-scheme", "fixed");
  expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(false);
}

test("seller saves Noche in Apariencia de la tienda and the buyer sees the catalog, product page, cart and checkout in Noche", async ({ page }) => {
  const email = `catalog-theme-${randomUUID()}@example.test`;
  const companyId = await openEditor(page, email);
  const storeAddress = await publishCatalog(companyId);
  await page.getByRole("radio", { name: /^Noche/ }).click();
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await browserExpect(page.getByRole("status").filter({ hasText: "Apariencia actualizada" })).toBeVisible();

  // A light system preference does not turn the Noche catalog light.
  const { context, buyer } = await openBuyer(page, "light");
  try {
    await buyer.goto(storeAddress);
    await expectTheme(buyer, "noche");
    await browserExpect(scope(buyer)).toHaveClass(/dark/);
    await browserExpect(buyer.getByRole("link", { name: /Polo básico/ })).toBeVisible();
    await browserExpect(buyer.locator('[data-store-part="catalog-card"]')).toHaveCSS("background-color", rgb(storeThemes.noche.colors.card));

    await buyer.getByRole("link", { name: /Polo básico/ }).click();
    await expectTheme(buyer, "noche");
    await browserExpect(buyer.getByRole("heading", { name: "Polo básico" })).toBeVisible();
    // Clicks before hydration are lost: retry until the cart reflects the add.
    await browserExpect(async () => {
      await buyer.getByRole("button", { name: "Agregar al carrito" }).click();
      await browserExpect(buyer.getByRole("button", { name: "Carrito, 1 unidad" })).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 10_000 });

    await buyer.getByRole("button", { name: "Carrito, 1 unidad" }).click();
    const cart = buyer.getByRole("dialog", { name: "Carrito" });
    await browserExpect(cart).toBeVisible();
    // The sheet stays inside the theme scope, so it takes the Noche values.
    expect(await cart.evaluate((element) => element.closest("[data-store-theme]") !== null)).toBe(true);
    await browserExpect(cart).toHaveCSS("background-color", rgb(storeThemes.noche.colors.background));
    await cart.getByRole("button", { name: "Continuar" }).click();

    await buyer.waitForURL(new RegExp(`/checkout/[0-9a-f-]{36}$`));
    await expectTheme(buyer, "noche");
  } finally {
    await context.close();
  }
});

test("buyer with a dark system preference sees a Boutique catalog in light mode and downloads only the Boutique font families", async ({ page }) => {
  const companyId = await prepareVerifiedCompany(page, { email: `catalog-boutique-${randomUUID()}@example.test`, name: "Vendedora", companyName: "Lima Studio", country: "PE" });
  const storeAddress = await publishCatalog(companyId);
  await saveCompanyAppearance(companyId, { theme: "boutique", withLogo: false });

  const { context, buyer } = await openBuyer(page, "dark");
  const fonts: string[] = [];
  buyer.on("request", (request) => { if (/\.woff2?(\?|$)/.test(request.url())) fonts.push(request.url()); });
  try {
    await buyer.goto(storeAddress);
    await expectTheme(buyer, "boutique");
    await browserExpect(scope(buyer)).not.toHaveClass(/dark/);
    await browserExpect.poll(() => buyer.evaluate(async () => {
      await document.fonts.ready;
      return [...document.fonts].filter((face) => face.status === "loaded").map((face) => face.family.replace(/"/g, ""));
    })).toEqual(browserExpect.arrayContaining(["Playfair Display Variable", "Inter Variable"]));
    const families = fonts.map((url) => url.split("/").at(-1) ?? "");
    expect(families.some((name) => name.includes("playfair-display"))).toBe(true);
    expect(families.some((name) => name.includes("inter"))).toBe(true);
    for (const other of ["fredoka", "nunito", "outfit"]) expect(families.filter((name) => name.includes(other)), other).toEqual([]);
  } finally {
    await context.close();
  }
});
