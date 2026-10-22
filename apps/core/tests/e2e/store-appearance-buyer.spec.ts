import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { browserExpect, expect, test } from "@core/tests/e2e/fixtures";
import { products } from "@core/src/features/products/composition";
import { orders } from "@core/src/features/orders/composition";
import { deliverySettings } from "@core/src/features/delivery-settings";
import { deleteAgencies, insertAgency, seededCatalogId } from "@core/src/features/delivery-settings/infrastructure/courier-catalog-fixture";
import { companyPaymentSettings } from "@core/src/features/companies";
import { storeFontStacks } from "@core/src/features/store-appearance/presentation/store-theme-style";
import { storeThemeIds, storeThemes, type StoreThemeId } from "@shared/store-themes";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { removeCompanyAppearance, rgb, saveCompanyAppearance } from "@core/tests/e2e/store-appearance-fixtures";
import type { Page } from "@playwright/test";
import type { CompanyId, ContactId, OrderId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";

const logoSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#2F6B4F"/></svg>';
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==", "base64");
const boutique = storeThemes.boutique;

function requestLogs(requestId: string) {
  return readFileSync("test-results/server.jsonl", "utf8").trim().split("\n")
    .flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } })
    .filter((event) => event.requestId === requestId);
}

type OrderLine = Readonly<{ variantId: VariantId; quantity: PositiveInteger }>;

const photoSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="150"><rect width="120" height="150" fill="#C98B5B"/></svg>';

/** `photos` builds the order of «Polo básico» (with a product photo) and «Taza blanca» (without one) instead of the single «Cuaderno». */
async function fixture({ delivery = true, photos = false }: { delivery?: boolean; photos?: boolean } = {}) {
  const companyId = randomUUID() as CompanyId;
  const userId = randomUUID() as UserId;
  const orderId = randomUUID() as OrderId;
  const contactId = randomUUID() as ContactId;
  await withTenantIsolation(companyId, async () => {
    await prisma.company.create({ data: { id: companyId, name: "Tienda con marca", country: "PE" } });
    await systemPrisma.user.create({ data: { id: userId, name: "Seller", email: `${userId}@example.test`, companyId } });
    const addLine = async (name: string, withPhoto: boolean): Promise<OrderLine> => {
      const product = await products.create({ name, currency: "PEN", variants: [{ attributes: { Color: "Azul" }, salePrice: 10, initialStock: 3 }] });
      if (!product.success) throw new Error("Product fixture failed");
      const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: product.data } });
      if (withPhoto) {
        const imageId = randomUUID();
        await prisma.image.create({ data: { id: imageId, storageKey: `products/${imageId}.svg` } });
        await prisma.product.update({ where: { id: product.data }, data: { imageId } });
      }
      return { variantId: variant.id as VariantId, quantity: 1 as PositiveInteger };
    };
    const lines: readonly [OrderLine, ...OrderLine[]] = photos
      ? [await addLine("Polo básico", true), await addLine("Taza blanca", false)]
      : [await addLine("Cuaderno", false)];
    await prisma.contact.create({ data: { id: contactId, whatsappAccountId: "1@lid", whatsappLid: "2@lid" } });
    const created = await orders.create({ id: orderId, items: lines }, { companyId, userId });
    if (!created.success) throw new Error("Order fixture failed");
    await prisma.orderBuyer.create({ data: { orderId, contactId, name: "Ana", phone: "+51987654321" } });
    if (delivery) await prisma.order.update({ where: { id: orderId }, data: { delivery: { method: "store",
      recipient: { name: "Recipient", phone: "999", identity: { kind: "absent" } }, pickupPoint: { name: "Tienda", address: "Historical address", instructions: null },
      settingsVersion: 0, recordedBy: { kind: "seller", userId } } } });
    expect(await orders.enableCheckout(orderId, { companyId, userId })).toMatchObject({ success: true });
  });
  return { companyId, userId, orderId, path: `/checkout/${companyId}/${orderId}`,
    cancel: () => withTenantIsolation(companyId, () => orders.cancel(orderId, { companyId, userId })),
    read: () => withTenantIsolation(companyId, async () => await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { payments: true } })),
    async cleanup() {
      await withTenantIsolation(companyId, async () => {
        await prisma.payment.deleteMany(); await prisma.orderItem.deleteMany(); await prisma.order.deleteMany();
        await prisma.contact.deleteMany(); await prisma.productStock.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.product.deleteMany();
        await prisma.deliveryRate.deleteMany(); await prisma.quotation.deleteMany(); await prisma.deliveryZoneDistrict.deleteMany();
        await prisma.deliveryOptionAgency.deleteMany(); await prisma.deliveryOption.deleteMany(); await prisma.deliveryZone.deleteMany(); await prisma.companyCourier.deleteMany(); await prisma.companyDeliverySettings.deleteMany();
        await prisma.companyPaymentSettings.deleteMany();
      });
      await removeCompanyAppearance(companyId);
      await withTenantIsolation(companyId, async () => {
        await systemPrisma.user.delete({ where: { id: userId } }); await prisma.company.delete({ where: { id: companyId } });
      });
    },
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

/** Agency delivery to Miraflores for S/ 8.00 and one bank transfer, so a pending order can be confirmed and paid. */
async function configureAgencyDelivery(f: Fixture, agencies: string[]) {
  await withTenantIsolation(f.companyId, async () => {
    const access = { companyId: f.companyId, userId: f.userId };
    expect((await deliverySettings.save({ expectedVersion: 0, home: { enabled: false }, agency: { enabled: true },
      store: { enabled: false, pickupPoint: null } }, access)).success).toBe(true);
    expect((await deliverySettings.saveZones({ expectedVersion: 1, zones: [{ kind: "new", name: "Agency zone", enabled: true, districtCodes: ["150122"],
      options: [{ kind: "new", method: "agency", name: "Retiro en agencia", enabled: true, price: { amount: 8, currency: "PEN" }, agencyIds: agencies }] }] }, access)).success).toBe(true);
    expect((await companyPaymentSettings.save(f.companyId, f.userId, [{ method: "bank_transfer", bank: "BCP", holder: "Tienda",
      accountNumber: null, cci: "00200000000000000001", imageId: null }])).success).toBe(true);
  });
}

const primary = (page: import("@playwright/test").Page) =>
  page.locator("[data-store-theme]").evaluate((element) => getComputedStyle(element).getPropertyValue("--primary").trim().toUpperCase());
const themeId = (page: import("@playwright/test").Page) => page.locator("[data-store-theme]").getAttribute("data-store-theme-id");
const isDark = (page: import("@playwright/test").Page) => page.evaluate(() => document.documentElement.classList.contains("dark"));

const captureDir = "test-results/store-themes";

/** «Polo básico» shows its photo and «Taza blanca» the initial block, both with the size and shape of the theme. */
async function expectThumbnails(page: Page, id: StoreThemeId) {
  const { width, ratio, radius } = storeThemes[id].thumbnail;
  const photo = page.locator("[data-store-part=product-row]").filter({ hasText: "Polo básico" }).locator("[data-slot=product-thumbnail]");
  const marker = page.locator("[data-store-part=product-row]").filter({ hasText: "Taza blanca" }).locator("[data-slot=product-thumbnail]");
  await browserExpect(photo.locator("img")).toBeVisible();
  await browserExpect.poll(() => photo.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await browserExpect(marker.locator("img")).toHaveCount(0);
  await browserExpect(marker).toHaveText("T");
  const [photoBox, markerBox] = [await photo.boundingBox(), await marker.boundingBox()];
  const [w, h] = [parseFloat(width), parseFloat(width) * Number(ratio.split("/")[1]) / Number(ratio.split("/")[0])];
  for (const box of [photoBox, markerBox]) expect([box?.width, box?.height], id).toEqual([expect.closeTo(w, 0), expect.closeTo(h, 0)]);
  for (const thumbnail of [photo, marker]) await browserExpect(thumbnail).toHaveCSS("border-top-left-radius", radius === "0" ? "0px" : radius);
}

/** The theme's font files are loaded and used, not only named in the stack: a failed file would still leave the family name in `font-family`. */
async function expectFontsLoaded(page: Page, id: StoreThemeId) {
  const families = [...new Set(Object.values(storeThemes[id].fonts))].filter((font) => font !== "system")
    .map((font) => storeFontStacks[font].split(",")[0].replace(/"/g, "").trim());
  await browserExpect.poll(() => page.evaluate(async (names) => {
    await document.fonts.ready;
    return names.every((name) => [...document.fonts].some((face) => face.family.replace(/"/g, "") === name && face.status === "loaded"));
  }, families), { message: `${id}: ${families.join(", ")} loaded` }).toBe(true);
}

/** The whole checkout takes the theme: its page color and mode, and no theme id of another one. */
async function expectTheme(page: Page, id: StoreThemeId) {
  expect(await themeId(page)).toBe(id);
  await browserExpect(page.locator("[data-store-theme]")).toHaveCSS("background-color", rgb(storeThemes[id].colors.background));
  await browserExpect.poll(() => primary(page)).toBe(storeThemes[id].colors.primary.toUpperCase());
  await expectFontsLoaded(page, id);
}

const capture = (page: Page, name: string) => page.screenshot({ path: `${captureDir}/${name}.png`, fullPage: true });

test.describe("buyer checkout with appearance", () => {
  test("shows the logo and the theme in every order state", async ({ page }) => {
    const f = await fixture();
    const requestId = `appearance-${randomUUID()}`;
    try {
      await saveCompanyAppearance(f.companyId, { theme: "boutique", withLogo: true });
      await page.route("**/test-images/**", (route) => route.fulfill({ status: 200, contentType: "image/svg+xml", body: logoSvg }));
      const html = await (await page.request.get(f.path, { headers: { "x-request-id": requestId } })).text();
      expect(html).toContain("<style>[data-store-theme=");
      expect(html.toUpperCase()).toContain(boutique.colors.primary.toUpperCase());
      expect(html).toContain('data-color-scheme="fixed"');
      await page.emulateMedia({ colorScheme: "light" });
      await page.goto(f.path);
      await browserExpect(page.locator("[data-slot=brand-logo] img")).toBeVisible();
      await browserExpect.poll(() => primary(page)).toBe(boutique.colors.primary.toUpperCase());
      expect(await themeId(page)).toBe("boutique");
      await page.getByRole("button", { name: "Confirmar pedido", exact: true }).click();
      await browserExpect(page.getByRole("region", { name: "Pago del pedido", exact: true })).toBeVisible();
      await browserExpect(page.locator("[data-slot=brand-logo] img")).toBeVisible();
      await browserExpect.poll(() => primary(page)).toBe(boutique.colors.primary.toUpperCase());
      await f.cancel();
      await page.goto(f.path);
      await browserExpect(page.getByRole("heading", { name: "Pedido cancelado", exact: true })).toBeVisible();
      await browserExpect(page.locator("[data-slot=brand-logo] img")).toBeVisible();
      await expect.poll(() => requestLogs(requestId).some((event) => event.event === "http_request_completed" && event.storeAppearance === "custom" && event.storeTheme === "boutique")).toBe(true);
      expect(JSON.stringify(requestLogs(requestId))).not.toContain("test-images");
    } finally { await f.cleanup(); }
  });

  test("keeps the mode of each theme whatever the system prefers", async ({ page }) => {
    const f = await fixture();
    try {
      await saveCompanyAppearance(f.companyId, { theme: "boutique", withLogo: false });
      await page.emulateMedia({ colorScheme: "dark" });
      await page.goto(f.path);
      expect(await themeId(page)).toBe("boutique");
      expect(await isDark(page)).toBe(false);
      await browserExpect(page.locator("[data-store-theme]")).toHaveCSS("background-color", rgb(boutique.colors.background));
      await saveCompanyAppearance(f.companyId, { theme: "noche", withLogo: false });
      await page.emulateMedia({ colorScheme: "light" });
      await page.reload();
      expect(await themeId(page)).toBe("noche");
      await browserExpect(page.locator("[data-store-theme]")).toHaveClass(/dark/);
      expect(await isDark(page)).toBe(false);
      await browserExpect(page.locator("[data-store-theme]")).toHaveCSS("background-color", rgb(storeThemes.noche.colors.background));
    } finally { await f.cleanup(); }
  });

  test("shows the company name when the logo fails to load", async ({ page }) => {
    const f = await fixture();
    try {
      await saveCompanyAppearance(f.companyId, { theme: "boutique", withLogo: true });
      await page.route("**/test-images/**", (route) => route.fulfill({ status: 404 }));
      await page.goto(f.path);
      await browserExpect(page.getByText("Tienda con marca", { exact: true })).toBeVisible();
      await browserExpect(page.locator("[data-slot=brand-logo]")).toHaveCount(0);
      await browserExpect.poll(() => primary(page)).toBe(boutique.colors.primary.toUpperCase());
    } finally { await f.cleanup(); }
  });

  test("shows Clásico for a company without appearance", async ({ page }) => {
    const f = await fixture();
    const requestId = `appearance-${randomUUID()}`;
    try {
      const html = await (await page.request.get(f.path, { headers: { "x-request-id": requestId } })).text();
      expect(html).toContain('data-store-theme-id="classic"');
      expect(html.toUpperCase()).toContain(storeThemes.classic.colors.primary.toUpperCase());
      await expect.poll(() => requestLogs(requestId).some((event) => event.event === "http_request_completed" && event.storeAppearance === "default" && event.storeTheme === "classic")).toBe(true);
      await page.emulateMedia({ colorScheme: "dark" });
      await page.goto(f.path);
      expect(await isDark(page)).toBe(false);
    } finally { await f.cleanup(); }
  });

  test("shows the generic error without branding for an unauthorized link", async ({ page }) => {
    const f = await fixture();
    try {
      await saveCompanyAppearance(f.companyId, { theme: "noche", withLogo: false });
      await page.emulateMedia({ colorScheme: "dark" });
      for (const path of [`/checkout/${f.companyId}/${randomUUID()}`, `/checkout/${randomUUID()}/${f.orderId}`, "/checkout/bad/1001"]) {
        const response = await page.goto(path);
        expect(response?.status()).toBe(404);
        await browserExpect(page.getByRole("heading", { name: "Enlace no disponible" })).toBeVisible();
        expect(await page.content()).not.toContain("data-store-theme");
        await browserExpect(page.getByText("Tienda con marca")).toHaveCount(0);
        // «Enlace no disponible» keeps following the buyer's system preference, as before.
        expect(await isDark(page)).toBe(true);
      }
    } finally { await f.cleanup(); }
  });

  test("keeps delivery quote and payment flows working", async ({ page }) => {
    const f = await fixture({ delivery: false });
    const catalogId = await seededCatalogId();
    const agencies = [await insertAgency({ courierId: catalogId, name: "Sucursal Miraflores", districtCode: "150122" })];
    try {
      await saveCompanyAppearance(f.companyId, { theme: "boutique", withLogo: true });
      const receiptId = randomUUID();
      await configureAgencyDelivery(f, agencies);
      await withTenantIsolation(f.companyId, async () => await prisma.image.create({ data: { id: receiptId, storageKey: `test/${receiptId}` } }));
      await page.route("**/test-images/**", (route) => route.fulfill({ status: 200, contentType: "image/svg+xml", body: logoSvg }));
      await page.route(`**/api/buyer/orders/${f.orderId}/images`, (route) => route.fulfill({ status: 201, contentType: "application/json",
        body: JSON.stringify({ id: receiptId, url: `http://127.0.0.1:${process.env.CORE_E2E_PORT ?? "4173"}/test-images/test%2F${receiptId}` }) }));
      await page.goto(f.path);
      await browserExpect.poll(() => primary(page)).toBe(boutique.colors.primary.toUpperCase());
      await page.getByLabel("Departamento", { exact: true }).selectOption("15");
      await page.getByLabel("Provincia", { exact: true }).selectOption("1501");
      await page.getByLabel("Distrito", { exact: true }).selectOption("150122");
      await browserExpect(page.getByLabel("Agencia de destino")).toHaveValue(agencies[0]);
      await page.getByLabel("Nombre", { exact: true }).fill("Ana");
      await page.getByLabel("Teléfono", { exact: true }).fill("+51987654321");
      await page.getByLabel("Nombre del destinatario").fill("Recipient");
      await page.getByLabel("Teléfono del destinatario").fill("999");
      await page.getByLabel("Documento del destinatario").fill("12345678");
      await browserExpect(page.locator("dl > div").filter({ has: page.getByText("Total a pagar", { exact: true }) })).toContainText(/18[.,]00/);
      await page.getByRole("button", { name: "Confirmar pedido", exact: true }).click();
      await browserExpect(page.getByRole("region", { name: "Pago del pedido", exact: true })).toBeVisible();
      await browserExpect(page.locator("[data-slot=brand-logo] img")).toBeVisible();
      await page.getByLabel("Captura del pago").setInputFiles({ name: "pago.png", mimeType: "image/png", buffer: png });
      await browserExpect(page.getByText("Captura lista para enviar.")).toBeVisible();
      await page.getByRole("button", { name: "Ya pagué" }).click();
      await browserExpect(page.getByRole("heading", { name: "Pago pendiente de revisión" })).toBeVisible();
      await browserExpect.poll(() => primary(page)).toBe(boutique.colors.primary.toUpperCase());
      const stored = await f.read();
      expect(stored.deliveryCharge.toNumber()).toBe(8);
      expect(stored.delivery).toMatchObject({ method: "agency", destination: { districtCode: "150122" }, recordedBy: { kind: "buyer" } });
      expect(stored.payments).toMatchObject([{ status: "reported" }]);
    } finally { await f.cleanup(); await deleteAgencies(agencies); }
  });

  test("shows each theme in every order state with thumbnails and markers", async ({ page }) => {
    const catalogId = await seededCatalogId();
    await page.route("**/test-images/**", (route) => route.fulfill({ status: 200, contentType: "image/svg+xml", body: photoSvg }));
    for (const id of storeThemeIds) {
      const f = await fixture({ delivery: false, photos: true });
      const agencies = [await insertAgency({ courierId: catalogId, name: "Sucursal Miraflores", districtCode: "150122" })];
      try {
        await configureAgencyDelivery(f, agencies);
        await saveCompanyAppearance(f.companyId, { theme: id, withLogo: false });
        await page.emulateMedia({ colorScheme: id === "noche" ? "light" : "dark" });

        // Pending, on a 390 px phone: labels above fields, «Envío a agencia» offered, total before the action.
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(f.path);
        await expectTheme(page, id);
        await expectThumbnails(page, id);
        await browserExpect(page.getByText("Envío a agencia", { exact: true })).toBeVisible();
        await page.getByText("Envío a agencia", { exact: true }).click();
        const [label, field] = [await page.getByText("Nombre", { exact: true }).first().boundingBox(), await page.getByLabel("Nombre", { exact: true }).boundingBox()];
        expect(label!.y + label!.height, `${id}: the label sits above its field`).toBeLessThanOrEqual(field!.y + 1);
        await capture(page, `${id}-pending-390`);
        await page.setViewportSize({ width: 1280, height: 900 });
        await expectThumbnails(page, id);
        await capture(page, `${id}-pending-desktop`);
        await page.setViewportSize({ width: 390, height: 844 });

        // Agency delivery chosen, S/ 8.00 on top of the two items.
        await page.getByLabel("Departamento", { exact: true }).selectOption("15");
        await page.getByLabel("Provincia", { exact: true }).selectOption("1501");
        await page.getByLabel("Distrito", { exact: true }).selectOption("150122");
        await browserExpect(page.getByLabel("Agencia de destino")).toHaveValue(agencies[0]);
        await page.getByLabel("Nombre", { exact: true }).fill("Ana");
        await page.getByLabel("Teléfono", { exact: true }).fill("+51987654321");
        await page.getByLabel("Nombre del destinatario").fill("Recipient");
        await page.getByLabel("Teléfono del destinatario").fill("999");
        await page.getByLabel("Documento del destinatario").fill("12345678");
        const total = page.locator("dl > div").filter({ has: page.getByText("Total a pagar", { exact: true }) });
        await browserExpect(total).toContainText(/28[.,]00/);
        const confirm = page.getByRole("button", { name: "Confirmar pedido", exact: true });
        expect((await total.boundingBox())!.y, `${id}: the total is shown before the action`).toBeLessThan((await confirm.boundingBox())!.y);
        await capture(page, `${id}-agency-390`);

        // Confirmed, with the payment instructions.
        await confirm.click();
        await browserExpect(page.getByRole("region", { name: "Pago del pedido", exact: true })).toBeVisible();
        await expectTheme(page, id);
        await expectThumbnails(page, id);
        await capture(page, `${id}-payment-390`);
        await page.setViewportSize({ width: 1280, height: 900 });
        await capture(page, `${id}-payment-desktop`);

        // Cancelled.
        await f.cancel();
        await page.goto(f.path);
        await browserExpect(page.getByRole("heading", { name: "Pedido cancelado", exact: true })).toBeVisible();
        await expectTheme(page, id);
        await expectThumbnails(page, id);
        await capture(page, `${id}-cancelled-desktop`);
      } finally { await f.cleanup(); await deleteAgencies(agencies); }
    }
  }, 300_000);

  test("shows the marker, never a broken image, when a product photo fails to load", async ({ page }) => {
    const f = await fixture({ delivery: false, photos: true });
    try {
      await saveCompanyAppearance(f.companyId, { theme: "boutique", withLogo: false });
      await page.route("**/test-images/**", (route) => route.fulfill({ status: 404 }));
      await page.goto(f.path);
      const row = page.locator("[data-store-part=product-row]").filter({ hasText: "Polo básico" });
      await browserExpect(row.locator("[data-slot=product-thumbnail]")).toHaveText("P");
      await browserExpect(row.locator("img")).toHaveCount(0);
      await browserExpect(row).toContainText(/1 × S\/\s?10[.,]00/);
      await browserExpect(row).toContainText(/S\/\s?10[.,]00$/);
    } finally { await f.cleanup(); }
  });

  test("sets Boutique fields, prices and totals in Inter, and its titles and store name in Playfair Display", async ({ page }) => {
    const f = await fixture({ delivery: false, photos: true });
    try {
      await saveCompanyAppearance(f.companyId, { theme: "boutique", withLogo: false });
      await page.route("**/test-images/**", (route) => route.fulfill({ status: 200, contentType: "image/svg+xml", body: photoSvg }));
      await page.goto(f.path);
      await expectFontsLoaded(page, "boutique");
      const family = (locator: import("@playwright/test").Locator) => locator.first().evaluate((element) => getComputedStyle(element).fontFamily);
      const inter = /Inter/;
      const playfair = /Playfair Display/;
      expect(await family(page.getByText("Nombre", { exact: true }))).toMatch(inter);
      expect(await family(page.getByLabel("Nombre", { exact: true }))).toMatch(inter);
      expect(await family(page.locator("[data-store-part=price]"))).toMatch(inter);
      expect(await family(page.locator("[data-store-part=total-amount]"))).toMatch(inter);
      expect(await family(page.locator("[data-store-part=section-title]"))).toMatch(playfair);
      expect(await family(page.locator("[data-store-part=header-brand]"))).toMatch(playfair);
      await browserExpect(page.getByRole("button", { name: "Confirmar pedido", exact: true })).toBeVisible();
    } finally { await f.cleanup(); }
  });
});
