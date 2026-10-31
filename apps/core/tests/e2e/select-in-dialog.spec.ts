import { randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { browserExpect, expect, prepareVerifiedCompany, test } from "@core/tests/e2e/fixtures";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { seedProduct, deleteSeededProducts } from "@core/src/features/products/infrastructure/product-seed";

const district = { country: "PE", districtCode: "150122", district: "MIRAFLORES", province: "Lima", department: "Lima" };
const recipient = { name: "Ana Pérez", phone: "999 888 777", identity: { kind: "document", documentType: "national_id", document: "12345678" } };
const delivery = { method: "home", recipient, pricing: { quotationId: randomUUID(), rateId: randomUUID(), optionId: randomUUID(), settingsVersion: 1 },
  recordedBy: { kind: "seller", userId: "seller" }, destination: { address: "Calle 2 #123", ...district, instructions: "Portón azul" } };

async function prepareOrder(page: Page, email: string) {
  const companyId = await prepareVerifiedCompany(page, { email, name: "Vendedor Demo", companyName: "Selects en diálogos", country: "PE" });
  const seller = await systemPrisma.user.findUniqueOrThrow({ where: { email } });
  const orderId = randomUUID();
  await withTenantIsolation(companyId, async () => {
    const productId = randomUUID();
    const variantId = randomUUID();
    await seedProduct({ id: productId, name: "Camisa", qrCode: productId, variants: [{ id: variantId, attributes: { Talla: "M" }, sku: `SKU-${variantId}`, salePrice: 10, qrCode: variantId }] });
    await prisma.order.create({ data: { id: orderId, number: 3001n, sellerId: seller.id, currency: "PEN", total: 10, itemsTotal: 10, delivery: delivery as object, createdAt: new Date() } });
    await prisma.orderItem.create({ data: { orderId, variantId, productName: "Camisa", variantAttributes: { Talla: "M" }, sku: null, quantity: 1n, unitPrice: 10, subtotal: 10 } });
  });
  return { companyId, orderId };
}

async function cleanup(companyId: string | undefined, email: string) {
  if (!companyId) return;
  await withTenantIsolation(companyId, async () => {
    await prisma.payment.deleteMany(); await prisma.orderItem.deleteMany(); await prisma.order.deleteMany(); await deleteSeededProducts();
    await systemPrisma.user.deleteMany({ where: { email } });
    await prisma.company.delete({ where: { id: companyId } });
  });
}

const animationsFinished = (page: Page) => page.evaluate(() => Promise.allSettled(document.getAnimations().map((animation) => animation.finished)));

/** Opens the select inside the dialog and checks the popup hugs its trigger without making the dialog move, grow or scroll. */
async function expectPopupBesideTrigger(page: Page, dialog: Locator, trigger: Locator, name: string, open: () => Promise<void>) {
  // The dialog zooms in when it opens; measure once it has settled.
  await animationsFinished(page);
  const dialogBefore = await dialog.boundingBox();
  const triggerBox = await trigger.boundingBox();
  await open();
  const listbox = page.getByRole("listbox");
  await browserExpect(listbox).toBeVisible();
  await animationsFinished(page);
  const popup = await listbox.boundingBox();
  const dialogAfter = await dialog.boundingBox();
  if (!dialogBefore || !triggerBox || !popup || !dialogAfter) throw new Error("Missing layout boxes");
  await page.screenshot({ path: `test-results/${name}.png`, animations: "disabled" });
  // Below the trigger (or above it when it does not fit), sharing its left edge and never off to the side.
  const gap = Math.min(Math.abs(popup.y - (triggerBox.y + triggerBox.height)), Math.abs(triggerBox.y - (popup.y + popup.height)));
  expect(gap).toBeLessThanOrEqual(12);
  expect(Math.abs(popup.x - triggerBox.x)).toBeLessThanOrEqual(8);
  expect(dialogAfter).toEqual(dialogBefore);
  const overflow = await dialog.evaluate((element) => ({ vertical: element.scrollHeight - element.clientHeight, horizontal: element.scrollWidth - element.clientWidth }));
  expect(overflow.vertical).toBeLessThanOrEqual(0);
  expect(overflow.horizontal).toBeLessThanOrEqual(0);
}

test("the payment dialog and the label dialog keep their size while their select opens beside the trigger", async ({ page }) => {
  const email = `select-in-dialog-${randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    await page.addInitScript(() => Object.defineProperty(navigator, "pdfViewerEnabled", { get: () => true }));
    const prepared = await prepareOrder(page, email);
    companyId = prepared.companyId;
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/es-PE/orders/${prepared.orderId}`);

    await page.getByRole("button", { name: "Agregar Yape" }).click();
    const payment = page.getByRole("dialog", { name: "Registrar pago" });
    await browserExpect(payment).toBeVisible();
    const method = payment.getByRole("combobox", { name: "Medio de pago" });
    await expectPopupBesideTrigger(page, payment, method, "web-payment-dialog-select-open", () => method.click());
    await page.getByRole("listbox").getByRole("option", { name: "Plin" }).click();
    await browserExpect(page.getByRole("listbox")).toHaveCount(0);
    await method.focus();
    await expectPopupBesideTrigger(page, payment, method, "web-payment-dialog-select-open-keyboard", () => page.keyboard.press("ArrowDown"));
    await page.getByRole("listbox").getByRole("option", { name: "Transferencia bancaria" }).click();
    await browserExpect(method).toContainText("Transferencia bancaria");
    await payment.getByRole("button", { name: "Cancelar" }).click();
    await browserExpect(payment).toBeHidden();

    await page.getByRole("button", { name: "Imprimir rótulo", exact: true }).click();
    const label = page.getByRole("dialog", { name: /^Imprimir rótulo/ });
    await browserExpect(label.locator("iframe")).toHaveAttribute("src", /^blob:/);
    const size = label.getByRole("combobox", { name: "Tamaño" });
    await expectPopupBesideTrigger(page, label, size, "web-dispatch-label-dialog-select-open", () => size.click());
  } finally { await cleanup(companyId, email); }
});
