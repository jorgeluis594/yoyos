import type { FrameLocator, Page } from "@playwright/test";
import { browserExpect, expect, prepareVerifiedCompany, test } from "@core/tests/e2e/fixtures";
import { storeThemes } from "@shared/store-themes";
import { openEditor, removeCompanyAppearance, rgb, sharedCheckoutPath } from "@core/tests/e2e/store-appearance-fixtures";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

const previewPath = "/settings/store-appearance/preview";
const update = (overrides: object = {}) => ({
  type: "store-appearance:update", surface: "checkout", state: "review", catalog: { kind: "loading" },
  appearance: { logoUrl: null, theme: "boutique" }, ...overrides,
});

const ready = (scope: Page | FrameLocator) => scope.locator("html[data-store-preview=ready]");

/** The page paints nothing until the first draft message, so the helper waits for ready and then sends one. */
async function openPreview(page: Page) {
  await page.goto(previewPath);
  await browserExpect(ready(page)).toBeAttached();
  await post(page, update());
  await browserExpect(page.getByRole("heading", { name: "Pedido #1001" })).toBeVisible();
}
const primary = (page: Page) => page.getByRole("button", { name: "Confirmar pedido" }).evaluate((node) => getComputedStyle(node).backgroundColor);
const post = (page: Page, data: unknown, origin?: string) => page.evaluate(([message, from]) =>
  window.dispatchEvent(new MessageEvent("message", { data: message, origin: from ?? window.location.origin, source: window })), [data, origin] as const);

async function withCompany(run: (page: Page) => Promise<void>, page: Page) {
  const email = `checkout-preview-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    companyId = await prepareVerifiedCompany(page, { email, name: "Vendedora", companyName: "Lima Studio", country: "PE" });
    await run(page);
  } finally {
    if (companyId) await systemPrisma.company.deleteMany({ where: { id: companyId } });
    await systemPrisma.user.deleteMany({ where: { email } });
  }
}

test("redirects to the login page without a session", async ({ request }) => {
  const response = await request.get(previewPath, { maxRedirects: 0 });
  expect(response.status()).toBe(302);
  expect(response.headers().location).toBe("/login");
});

test("the preview page stays blank until the first draft message", async ({ page }) => {
  await withCompany(async () => {
    await page.goto(previewPath);
    await browserExpect(ready(page)).toBeAttached();
    await browserExpect(page.getByRole("heading", { name: "Pedido #1001" })).toHaveCount(0);
    await browserExpect(page.getByRole("button")).toHaveCount(0);
    await browserExpect(page.locator("[data-store-theme]")).toHaveCount(0);
    await post(page, update());
    await browserExpect(page.getByRole("heading", { name: "Pedido #1001" })).toBeVisible();
  }, page);
});

test("shows the checkout with sample data and labelled sample payment methods", async ({ page }) => {
  await withCompany(async () => {
    await openPreview(page);
    await browserExpect(page).toHaveURL(/\/es-PE\/settings\/store-appearance\/preview$/);
    await browserExpect(page.getByRole("heading", { name: "Pedido #1001" })).toBeVisible();
    await browserExpect(page.getByText("Lima Studio", { exact: true })).toBeVisible();
    await post(page, update({ state: "payment" }));
    await browserExpect(page.getByRole("heading", { name: "Cómo pagar" })).toBeVisible();
    await browserExpect(page.getByRole("note")).toContainText("datos de ejemplo");
    await browserExpect(page.getByRole("radio", { name: "Billetera de ejemplo" })).toBeVisible();
    await browserExpect(page.getByRole("region", { name: "Pago del pedido" })).toBeVisible();
    await browserExpect(page.getByText("Datos del comprador")).toBeVisible();
  }, page);
});

test("shows the company's real payment methods in the payment state", async ({ page }) => {
  await withCompany(async () => {
    await page.goto("/es-PE/settings/payments");
    await page.getByLabel("Ofrecer billetera digital").check();
    await page.getByLabel("Proveedor").fill("Plin Lima");
    await page.getByLabel("Titular").first().fill("Lima Studio");
    await page.getByRole("button", { name: "Guardar medios de cobro" }).click();
    await browserExpect(page.getByText("Medios de cobro guardados.")).toBeVisible();
    await openPreview(page);
    await post(page, update({ state: "payment" }));
    await browserExpect(page.getByRole("radio", { name: "Plin Lima" })).toBeVisible();
    await browserExpect(page.getByRole("note")).toHaveCount(0);
  }, page);
});

test("applies valid updates and ignores other origins or shapes", async ({ page }) => {
  await withCompany(async () => {
    await openPreview(page);
    const initial = await primary(page);
    const antojo = update({ appearance: { logoUrl: null, theme: "antojo" } });
    await post(page, antojo, "https://evil.example");
    await post(page, { ...antojo, extra: true });
    await post(page, { ...antojo, mode: "dark" });
    await post(page, update({ appearance: { logoUrl: null, theme: "neon" } }));
    await post(page, update({ appearance: { logoUrl: null, brandColor: "forest", background: "soft" } }));
    expect(await primary(page)).toBe(initial);
    await post(page, antojo);
    await browserExpect.poll(() => primary(page)).toBe(rgb(storeThemes.antojo.colors.primary));
  }, page);
});

test("paints the page and the thumbnail frame of each theme in the preview", async ({ page }) => {
  await withCompany(async () => {
    await openPreview(page);
    for (const theme of ["classic", "boutique", "antojo", "suave", "noche"] as const) {
      await post(page, update({ appearance: { logoUrl: null, theme } }));
      const scope = page.locator(`[data-store-theme-id="${theme}"]`);
      await browserExpect(scope).toBeAttached();
      await browserExpect(scope).toHaveCSS("background-color", rgb(storeThemes[theme].colors.background));
    }
  }, page);
});

test("fixes the mode of the preview by the theme and leaves the seller's saved preference untouched", async ({ page }) => {
  await withCompany(async () => {
    await page.emulateMedia({ colorScheme: "dark" });
    // Storage belongs to an origin, so the preference is saved from a panel page, where it paints the panel dark.
    await page.goto("/es-PE/dashboard");
    await page.evaluate(() => localStorage.setItem("yoyos-theme", "dark"));
    await page.reload();
    await browserExpect(page.locator("html")).toHaveClass(/dark/);
    await openPreview(page);
    await post(page, update({ appearance: { logoUrl: null, theme: "boutique" } }));
    await browserExpect(page.locator('[data-store-theme-id="boutique"]')).toBeAttached();
    await browserExpect(page.locator("html")).not.toHaveClass(/dark/);
    await browserExpect(page.locator("html")).toHaveAttribute("data-color-scheme", "fixed");
    await post(page, update({ appearance: { logoUrl: null, theme: "noche" } }));
    await browserExpect(page.locator('[data-store-theme-id="noche"]')).toHaveClass(/dark/);
    await browserExpect(page.locator("html")).not.toHaveClass(/dark/);
    expect(await page.evaluate(() => localStorage.getItem("yoyos-theme"))).toBe("dark");
  }, page);
});

test("applies the theme draft to the preview without changing the public checkout", async ({ page }) => {
  const email = `appearance-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    companyId = await openEditor(page, email);
    const path = await sharedCheckoutPath(companyId, email);
    const frame = page.frameLocator('iframe[title="Vista previa de la tienda"]');
    const confirm = frame.getByRole("button", { name: "Confirmar pedido" });
    await page.getByRole("button", { name: "Checkout", exact: true }).click();
    await page.getByRole("radio", { name: /^Antojo/ }).click();
    await browserExpect(confirm).toHaveCSS("background-color", rgb(storeThemes.antojo.colors.primary));
    await browserExpect(page.getByText("Cambios sin guardar", { exact: true })).toBeVisible();
    expect(await withTenantIsolation(companyId, async () => await prisma.companyCheckoutAppearance.findUnique({ where: { companyId: companyId! } }))).toBeNull();
    const buyer = await page.context().newPage();
    await buyer.goto(path);
    await browserExpect(buyer.locator("[data-store-theme]")).toHaveAttribute("data-store-theme-id", "classic");
    await browserExpect(buyer.getByRole("button", { name: "Confirmar pedido" })).toHaveCSS("background-color", rgb(storeThemes.classic.colors.primary));
  } finally {
    // The shared order references the seller, so it goes before the user, as in the other checkout specs.
    if (companyId) {
      await withTenantIsolation(companyId, async () => {
        await prisma.payment.deleteMany(); await prisma.orderItem.deleteMany(); await prisma.order.deleteMany();
        await prisma.contact.deleteMany(); await prisma.productStock.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.product.deleteMany();
      });
      await removeCompanyAppearance(companyId);
      await withTenantIsolation(companyId, async () => {
        await systemPrisma.user.deleteMany({ where: { email } }); await prisma.company.delete({ where: { id: companyId! } });
      });
    } else await systemPrisma.user.deleteMany({ where: { email } });
  }
});

test("never confirms orders, registers payments or submits forms from the preview", async ({ page }) => {
  await withCompany(async () => {
    await openPreview(page);
    const requests: string[] = [];
    page.on("request", (request) => { if (request.method() !== "GET") requests.push(`${request.method()} ${request.url()}`); });
    const url = page.url();
    await browserExpect(page.getByRole("button", { name: "Confirmar pedido" })).toBeEnabled();
    await page.getByRole("button", { name: "Confirmar pedido" }).click();
    await page.getByLabel("Nombre", { exact: true }).press("Enter");
    await post(page, update({ state: "payment" }));
    await page.getByRole("radio", { name: "Transferencia", exact: true }).check();
    await page.getByRole("button", { name: "Copiar cuenta" }).click();
    await page.locator("input[type=file]").setInputFiles({ name: "pago.png", mimeType: "image/png", buffer: Buffer.from("x") });
    await browserExpect(page.getByRole("button", { name: "Ya pagué" })).toBeDisabled();
    expect(page.url()).toBe(url);
    expect(requests).toEqual([]);
  }, page);
});

test("keeps every payment detail inside its box at 390 px in the five themes and lets the total label wrap", async ({ page }) => {
  await withCompany(async () => {
    await page.setViewportSize({ width: 390, height: 938 });
    await openPreview(page);
    for (const theme of ["classic", "boutique", "antojo", "suave", "noche"] as const) {
      await post(page, update({ state: "payment", appearance: { logoUrl: null, theme } }));
      const details = page.locator(`[data-store-theme-id="${theme}"] [data-store-part=payment-details]`);
      await browserExpect(details).toBeVisible();
      const overflow = await details.evaluate((box) => {
        const edge = box.getBoundingClientRect().right;
        return [...box.querySelectorAll("*")].filter((child) => child.getBoundingClientRect().right > edge + 0.5).map((child) => child.textContent?.trim());
      });
      expect(overflow, theme).toEqual([]);
      // The sample methods carry no QR, so the narrow column is guarded by the label being allowed to wrap beside one.
      await browserExpect(details.locator("[data-store-part=total-label]")).toHaveCSS("white-space", "normal");
    }
  }, page);
});

test("embedded at 390 px the preview activates the phone breakpoints and cannot submit forms", async ({ page }) => {
  await withCompany(async () => {
    await page.goto("/es-PE/dashboard");
    await page.evaluate((src) => {
      const frame = document.createElement("iframe");
      frame.id = "preview";
      frame.src = src;
      frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
      frame.style.cssText = "position:fixed;inset:0 auto auto 0;width:390px;height:800px;z-index:9999;background:white";
      document.body.append(frame);
    }, previewPath);
    const preview = page.frameLocator("#preview");
    await browserExpect(ready(preview)).toBeAttached();
    await page.evaluate(() => {
      const frame = document.querySelector<HTMLIFrameElement>("#preview")!;
      frame.contentWindow!.postMessage({ type: "store-appearance:update", surface: "checkout", catalog: { kind: "loading" }, state: "review",
        appearance: { logoUrl: null, theme: "boutique" } }, window.location.origin);
    });
    await browserExpect(preview.getByRole("heading", { name: "Pedido #1001" })).toBeVisible();
    const viewport = await page.locator("#preview").evaluate((frame: HTMLIFrameElement) => ({
      width: frame.contentWindow!.innerWidth, phone: frame.contentWindow!.matchMedia("(max-width: 767px)").matches }));
    expect(viewport).toEqual({ width: 390, phone: true });
    await page.evaluate(() => {
      const frame = document.querySelector<HTMLIFrameElement>("#preview")!;
      frame.contentWindow!.postMessage({ type: "store-appearance:update", surface: "checkout", catalog: { kind: "loading" }, state: "payment",
        appearance: { logoUrl: null, theme: "noche" } }, window.location.origin);
    });
    await browserExpect(preview.getByRole("heading", { name: "Cómo pagar" })).toBeVisible();
    await browserExpect(preview.locator('[data-store-theme-id="noche"]')).toHaveClass(/dark/);
    await browserExpect(preview.locator("html")).not.toHaveClass(/dark/);
  }, page);
});

test("renders the catalog surface inert with real or sample cards and its loading placeholders", async ({ page }) => {
  await withCompany(async () => {
    await openPreview(page);
    await post(page, update({ surface: "catalog" }));
    await browserExpect(page.locator("[data-slot=card-placeholder]")).toHaveCount(3);
    await browserExpect(page.getByText("Cargando productos")).toBeAttached();
    await post(page, update({ surface: "catalog", catalog: { kind: "samples" } }));
    await browserExpect(page.locator("[data-store-part=catalog-card]")).toHaveCount(3);
    await browserExpect(page.locator("[data-slot=catalog-preview]")).toHaveAttribute("aria-hidden", "true");
    await browserExpect(page.locator("[data-slot=catalog-preview]")).toHaveAttribute("inert", "");
    await post(page, update({ surface: "catalog", catalog: { kind: "samples", cards: [] } }));
    await browserExpect(page.locator("[data-store-part=catalog-card]")).toHaveCount(3);
  }, page);
});
