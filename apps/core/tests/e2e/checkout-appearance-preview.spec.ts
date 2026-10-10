import type { Page } from "@playwright/test";
import { browserExpect, expect, prepareVerifiedCompany, test } from "@core/tests/e2e/fixtures";
import { systemPrisma } from "@core/src/shared/infrastructure/persistance";

const previewPath = "/settings/checkout-appearance/preview";
const update = (overrides: object = {}) => ({
  type: "checkout-appearance:update", mode: "light", state: "review",
  appearance: { logoUrl: null, brandColor: "forest", background: "brand_tint" }, ...overrides,
});

async function openPreview(page: Page) {
  await page.goto(previewPath);
  await browserExpect(page.getByText("Vista previa · Datos de ejemplo")).toBeVisible();
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

test("shows the checkout with sample data and labelled sample payment methods", async ({ page }) => {
  await withCompany(async () => {
    await openPreview(page);
    await browserExpect(page).toHaveURL(/\/es-PE\/settings\/checkout-appearance\/preview$/);
    await browserExpect(page.getByRole("heading", { name: "Pedido #1001" })).toBeVisible();
    await browserExpect(page.getByText("Lima Studio", { exact: true })).toBeVisible();
    await post(page, update({ state: "payment" }));
    await browserExpect(page.getByRole("heading", { name: "Cómo pagar" })).toBeVisible();
    await browserExpect(page.getByRole("note")).toContainText("datos de ejemplo");
    await browserExpect(page.getByRole("radio", { name: "Billetera de ejemplo" })).toBeVisible();
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
    await post(page, update({ appearance: { logoUrl: null, brandColor: "raspberry", background: "white" } }), "https://evil.example");
    await post(page, { ...update({ appearance: { logoUrl: null, brandColor: "raspberry", background: "white" } }), extra: true });
    await post(page, update({ appearance: { logoUrl: null, brandColor: "#ff0000", background: "white" } }));
    expect(await primary(page)).toBe(initial);
    await post(page, update({ appearance: { logoUrl: null, brandColor: "raspberry", background: "white" } }));
    await browserExpect.poll(() => primary(page)).not.toBe(initial);
  }, page);
});

test("dark mode leaves the seller's saved theme preference untouched", async ({ page }) => {
  await withCompany(async () => {
    await openPreview(page);
    await page.evaluate(() => localStorage.setItem("yoyos-theme", "light"));
    await post(page, update({ mode: "dark" }));
    await browserExpect(page.locator("html")).toHaveClass(/dark/);
    expect(await page.evaluate(() => localStorage.getItem("yoyos-theme"))).toBe("light");
  }, page);
});

test("never confirms orders, registers payments or submits forms from the preview", async ({ page }) => {
  await withCompany(async () => {
    await openPreview(page);
    const requests: string[] = [];
    page.on("request", (request) => { if (request.method() !== "GET") requests.push(`${request.method()} ${request.url()}`); });
    const url = page.url();
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
    await browserExpect(preview.getByText("Vista previa · Datos de ejemplo")).toBeVisible();
    const viewport = await page.locator("#preview").evaluate((frame: HTMLIFrameElement) => ({
      width: frame.contentWindow!.innerWidth, phone: frame.contentWindow!.matchMedia("(max-width: 767px)").matches }));
    expect(viewport).toEqual({ width: 390, phone: true });
    await page.evaluate(() => {
      const frame = document.querySelector<HTMLIFrameElement>("#preview")!;
      frame.contentWindow!.postMessage({ type: "checkout-appearance:update", mode: "dark", state: "payment",
        appearance: { logoUrl: null, brandColor: "ocean", background: "neutral" } }, window.location.origin);
    });
    await browserExpect(preview.getByRole("heading", { name: "Cómo pagar" })).toBeVisible();
    await browserExpect(preview.locator("html")).toHaveClass(/dark/);
  }, page);
});
