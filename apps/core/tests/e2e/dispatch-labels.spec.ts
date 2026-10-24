import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { browserExpect, chooseOption, expect, prepareVerifiedCompany, test } from "@core/tests/e2e/fixtures";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

const district = { country: "PE", districtCode: "150122", district: "MIRAFLORES", province: "Lima", department: "Lima" };
const recipient = { name: "Ana Pérez", phone: "999 888 777", identity: { kind: "document", documentType: "national_id", document: "12345678" } };
const pricing = () => ({ quotationId: randomUUID(), rateId: randomUUID(), optionId: randomUUID(), settingsVersion: 1 });
const recordedBy = { kind: "seller", userId: "seller" };
const home = () => ({ method: "home", recipient, pricing: pricing(), recordedBy, destination: { address: "Calle 2 #123", ...district, instructions: "Portón azul" } });
const store = () => ({ method: "store", recipient, pickupPoint: { name: "Tienda", address: "Jr. 1", instructions: null }, settingsVersion: 1, recordedBy });

type Kind = "filler" | "home" | "pickup" | "none";
const pdfPages = (base64: string) => (Buffer.from(base64, "base64").toString("latin1").match(/\/Type \/Page\b(?!s)/g) ?? []).length;

/** 20 recent home orders fill the first list page; the four that matter are older and wait on the second. */
async function prepareOrders(page: Page, email: string) {
  const companyId = await prepareVerifiedCompany(page, { email, name: "Vendedor Demo", companyName: "Rótulos de prueba", country: "PE" });
  const seller = await systemPrisma.user.findUniqueOrThrow({ where: { email } });
  const orders = await withTenantIsolation(companyId, async () => {
    const productId = randomUUID();
    const variantId = randomUUID();
    await prisma.product.create({ data: { id: productId, name: "Camisa", currency: "PEN", qrCode: productId, status: "active", createdAt: new Date(), updatedAt: new Date() } });
    await prisma.productVariant.create({ data: { id: variantId, productId, attributes: { Talla: "M" }, sku: `SKU-${variantId}`, salePrice: 10, qrCode: variantId, status: "active" } });
    const created: Record<string, { id: string; number: number }> = {};
    const plan: [string, Kind, boolean][] = [
      ...Array.from({ length: 20 }, (_, index): [string, Kind, boolean] => [`filler${index}`, "filler", false]),
      ["home", "home", false], ["pickup", "pickup", false], ["none", "none", false], ["cancelled", "home", true],
    ];
    for (const [index, [name, kind, cancelled]] of plan.entries()) {
      const id = randomUUID();
      const number = 2001 + index;
      const delivery = kind === "none" ? undefined : kind === "pickup" ? store() : home();
      await prisma.order.create({ data: { id, number: BigInt(number), sellerId: seller.id, currency: "PEN", total: 10, itemsTotal: 10, cancelled, delivery: delivery as object | undefined,
        createdAt: new Date(Date.UTC(2026, 9, 20, 15, 0) - index * 60_000) } });
      await prisma.orderItem.create({ data: { orderId: id, variantId, productName: "Camisa", variantAttributes: { Talla: "M" }, sku: null, quantity: 1n, unitPrice: 10, subtotal: 10 } });
      created[name] = { id, number };
    }
    return created;
  });
  return { companyId, orders };
}

async function cleanup(companyId: string | undefined, email: string) {
  if (!companyId) return;
  await withTenantIsolation(companyId, async () => {
    await prisma.orderItem.deleteMany(); await prisma.order.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.product.deleteMany();
    await systemPrisma.user.deleteMany({ where: { email } });
    await prisma.company.delete({ where: { id: companyId } });
  });
}

/** Headless Chromium has no PDF viewer; a desktop browser does, and that is what the inline preview needs. */
const withPdfViewer = (page: Page) => page.addInitScript(() => Object.defineProperty(navigator, "pdfViewerEnabled", { get: () => true }));

const snapshot = (companyId: string) => withTenantIsolation(companyId, async () => JSON.stringify(await prisma.order.findMany({ orderBy: { number: "asc" } }), (_key, value) => typeof value === "bigint" ? value.toString() : value));

test("seller prints one label from the order detail, switches to A4 and sees why a pickup order has none", async ({ page }) => {
  const email = `dispatch-labels-one-${randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    await withPdfViewer(page);
    const prepared = await prepareOrders(page, email);
    companyId = prepared.companyId;
    const { home: homeOrder, pickup } = prepared.orders;
    const before = await snapshot(companyId);

    await page.goto(`/es-PE/orders/${homeOrder.id}`);
    await page.setViewportSize({ width: 390, height: 844 });
    await browserExpect(page.getByRole("button", { name: "Imprimir rótulo", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: "test-results/dispatch-label-detail-mobile.png", animations: "disabled" });
    await page.setViewportSize({ width: 1280, height: 900 });
    const firstPdf = page.waitForResponse((response) => response.url().endsWith("/api/dispatch-labels"));
    await page.getByRole("button", { name: "Imprimir rótulo", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: `Imprimir rótulo · Pedido #${homeOrder.number}` });
    await browserExpect(dialog).toBeVisible();
    const first = await (await firstPdf).json();
    expect(first.printed).toHaveLength(1);
    expect(pdfPages(first.pdf)).toBe(1);
    await browserExpect(dialog.locator("iframe")).toHaveAttribute("src", /^blob:/);
    await browserExpect(dialog.getByText("Vista previa del PDF · 62 × 100 mm, vertical")).toBeVisible();
    await browserExpect(dialog.getByRole("combobox", { name: "Tamaño" })).toContainText("Etiqueta 62 × 100 mm");
    await browserExpect(dialog.getByText("Imprime al 100 % (sin ajustar a la página)")).toBeVisible();
    await browserExpect(dialog.getByRole("link", { name: "Cambiar remitente" })).toHaveAttribute("href", "/es-PE/settings/delivery#sender");
    await browserExpect(dialog.getByRole("button", { name: "Imprimir", exact: true })).toBeEnabled();
    await page.screenshot({ path: "test-results/dispatch-label-dialog-desktop.png", animations: "disabled" });

    const a4Pdf = page.waitForResponse((response) => response.url().endsWith("/api/dispatch-labels"));
    await chooseOption(page, "Tamaño", "A4");
    const a4 = await (await a4Pdf).json();
    expect(a4.size).toBe("a4");
    await browserExpect(dialog.getByText("Vista previa del PDF · A4, vertical · 6 rótulos por hoja")).toBeVisible();

    const download = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Descargar PDF" }).click();
    expect((await download).suggestedFilename()).toBe(`rotulo-pedido-${homeOrder.number}.pdf`);

    await page.keyboard.press("Escape");
    await browserExpect(dialog).toBeHidden();
    await page.goto(`/es-PE/orders/${pickup.id}`);
    await page.getByRole("button", { name: "Imprimir rótulo", exact: true }).click();
    const pickupDialog = page.getByRole("dialog", { name: `Imprimir rótulo · Pedido #${pickup.number}` });
    await browserExpect(pickupDialog.getByText("Recojo en tienda: no lleva rótulo")).toBeVisible();
    await browserExpect(pickupDialog.locator("iframe")).toHaveCount(0);
    await browserExpect(pickupDialog.getByRole("button", { name: "Descargar PDF" })).toBeDisabled();
    await browserExpect(pickupDialog.getByRole("button", { name: "Imprimir", exact: true })).toBeDisabled();

    expect(await snapshot(companyId)).toBe(before);
  } finally { await cleanup(companyId, email); }
});

test("seller selects orders across pages, sees what will be skipped and prints one PDF with the printable ones", async ({ page }) => {
  const email = `dispatch-labels-bulk-${randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    await withPdfViewer(page);
    const prepared = await prepareOrders(page, email);
    companyId = prepared.companyId;
    const { filler0, home: homeOrder, none, cancelled } = prepared.orders;
    const before = await snapshot(companyId);
    const row = (number: number) => page.getByRole("row").filter({ hasText: `#${number}` });
    const pick = (number: number) => page.getByRole("checkbox", { name: `Seleccionar el pedido #${number}` });
    const bar = page.getByRole("region", { name: "Pedidos seleccionados" });

    await page.goto("/es-PE/orders");
    await browserExpect(bar).toHaveCount(0);
    await pick(filler0.number).click();
    await page.getByRole("link", { name: "Siguiente", exact: true }).click();
    await browserExpect(page).toHaveURL(/page=2/);
    await pick(homeOrder.number).click();
    await pick(none.number).click();
    await browserExpect(row(none.number)).toContainText("Falta dirección · se omitirá");
    await browserExpect(bar).toContainText("3 pedidos seleccionados · 1 sin dirección no se imprimirá");
    await browserExpect(bar.getByRole("button", { name: "Imprimir rótulos (2)" })).toBeEnabled();
    await browserExpect(row(homeOrder.number)).toContainText("Miraflores");

    await page.getByRole("link", { name: "Anterior", exact: true }).click();
    await browserExpect(pick(filler0.number)).toBeChecked();
    await browserExpect(bar).toContainText("3 pedidos seleccionados");
    await page.screenshot({ path: "test-results/dispatch-label-bulk-bar-desktop.png", animations: "disabled" });

    const response = page.waitForResponse((item) => item.url().endsWith("/api/dispatch-labels"));
    await bar.getByRole("button", { name: "Imprimir rótulos (2)" }).click();
    const dialog = page.getByRole("dialog", { name: /Imprimir rótulos/ });
    const body = await (await response).json();
    expect(body.printed).toHaveLength(2);
    expect(pdfPages(body.pdf)).toBe(2);
    await browserExpect(dialog.locator("iframe")).toHaveAttribute("src", /^blob:/);
    await page.screenshot({ path: "test-results/dispatch-label-bulk-dialog-desktop.png", animations: "disabled" });
    await page.keyboard.press("Escape");
    await browserExpect(dialog).toBeHidden();

    await page.getByRole("link", { name: "Siguiente", exact: true }).click();
    await pick(cancelled.number).click();
    await browserExpect(row(cancelled.number)).toContainText("Cancelado · se omitirá");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Phones have no table header: a visible control selects the page, and a row checkbox answers taps well outside its 16 px box.
    const selectPage = page.getByRole("checkbox", { name: "Seleccionar página" });
    await browserExpect(selectPage).toBeVisible();
    const target = (await pick(homeOrder.number).boundingBox())!;
    expect(target.width).toBeLessThan(20);
    await browserExpect(pick(homeOrder.number)).toBeChecked();
    await page.mouse.click(target.x + target.width / 2 + 20, target.y + target.height / 2);
    await browserExpect(pick(homeOrder.number)).not.toBeChecked();
    await selectPage.click();
    await browserExpect(selectPage).toBeChecked();
    await browserExpect(pick(none.number)).toBeChecked();
    await page.screenshot({ path: "test-results/dispatch-label-bulk-bar-mobile.png", animations: "disabled" });
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.getByRole("link", { name: "Por cobrar", exact: true }).click();
    await browserExpect(page).toHaveURL(/view=unpaid/);
    await browserExpect(bar).toHaveCount(0);
    await browserExpect(pick(filler0.number)).not.toBeChecked();

    expect(await snapshot(companyId)).toBe(before);
  } finally { await cleanup(companyId, email); }
});

test("a browser that cannot show PDFs inline gets a note and opens the PDF in a new tab", async ({ page }) => {
  const email = `dispatch-labels-noviewer-${randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    const prepared = await prepareOrders(page, email);
    companyId = prepared.companyId;
    await page.goto(`/es-PE/orders/${prepared.orders.home.id}`);
    await page.getByRole("button", { name: "Imprimir rótulo", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: /Imprimir rótulo/ });

    await browserExpect(dialog.getByText("Tu navegador no muestra el PDF aquí")).toBeVisible();
    await browserExpect(dialog.locator("iframe")).toHaveCount(0);
    await browserExpect(dialog.getByRole("link", { name: "Abrir PDF" })).toHaveAttribute("href", /^blob:/);
    const popup = page.waitForEvent("popup");
    await dialog.getByRole("button", { name: "Imprimir", exact: true }).click();
    // Headless Chromium downloads the PDF instead of showing it, so the tab opening is what can be observed here; its URL is unit-tested.
    await popup;
  } finally { await cleanup(companyId, email); }
});
