import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { brandHostHeaders, browserExpect, expect, storeUrl, subdomainOf, test } from "@core/tests/e2e/fixtures";
import { orders } from "@core/src/features/orders/composition";
import { deliverySettings } from "@core/src/features/delivery-settings";
import { deleteAgencies, insertAgency, seededCatalogId } from "@core/src/features/delivery-settings/infrastructure/courier-catalog-fixture";
import { storeThemeIds, type StoreThemeId } from "@shared/store-themes";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { removeCompanyAppearance, saveCompanyAppearance } from "@core/tests/e2e/store-appearance-fixtures";
import type { CompanyId, OrderId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";
import { seedProduct } from "@core/src/features/products/infrastructure/product-seed";

// Criteria 23, 24 and 33 of the checkout location feature (docs/checkout.md, «Delivery choice»), which PR #281 left as manual checks.
const shotsDir = "/tmp/claude-1000/-home-jorge-orca-workspaces-yoyos-checkout-mostrar-solo-departamentos-prov-a11y/d181e09e-8f7a-47b0-a7d6-3b09bf765d53/scratchpad/auto-shots";
const preselected = "Completamos automáticamente los campos que tienen una sola opción.";
const cleared = /Envío a agencia no llega a Miraflores\./;
const loading = "Consultando opciones de envío…";
const hint = "Solo aparecen los lugares donde la tienda entrega";
const noModes = "No hay modalidades de entrega disponibles. Consulta con la tienda cómo recibir tu pedido.";

type Mode = "home" | "agency" | "store";

/** An order with its checkout enabled, no saved delivery, and the delivery settings its `configure` step writes. */
async function fixture() {
  const companyId = randomUUID() as CompanyId;
  const userId = randomUUID() as UserId;
  const orderId = randomUUID() as OrderId;
  await withTenantIsolation(companyId, async () => {
    await prisma.company.create({ data: { id: companyId, name: "Tienda de ubicación", country: "PE", catalogSubdomain: subdomainOf(companyId) } });
    await systemPrisma.user.create({ data: { id: userId, name: "Seller", email: `${userId}@example.test`, companyId } });
    const variant = { id: (await seedProduct({ name: "Cuaderno", variants: [{ attributes: { Color: "Azul" }, salePrice: 10, stock: 3 }] })).variantIds[0] };
    const created = await orders.create({ id: orderId, items: [{ variantId: variant.id as VariantId, quantity: 1 as PositiveInteger }] }, { companyId, userId });
    if (!created.success) throw new Error("Order fixture failed");
  });
  const access = { companyId, userId };
  return { companyId, orderId, route: `/checkout/${orderId}`, path: storeUrl(subdomainOf(companyId), `/checkout/${orderId}`), headers: brandHostHeaders(subdomainOf(companyId)),
    /** Home only reaches Miraflores, agency only reaches the department of Arequipa, and the store pickup is on: entering agency from home clears the district. */
    async configureCoverage(agencyId: string) {
      await withTenantIsolation(companyId, async () => {
        expect((await deliverySettings.saveZones({ expectedVersion: 0, zones: [
          { kind: "new", name: "Home", enabled: true, districtCodes: ["150122"], options: [{ kind: "new", method: "home", name: "Motorizado", enabled: true, price: { amount: 8, currency: "PEN" } }] },
          { kind: "new", name: "Sur", enabled: true, departmentCodes: ["04"], districtCodes: [],
            options: [{ kind: "new", method: "agency", name: "Shalom", enabled: true, price: { amount: 12, currency: "PEN" }, agencyIds: [agencyId] }] },
        ] }, access)).success).toBe(true);
        expect((await deliverySettings.save({ expectedVersion: 1, home: { enabled: true }, agency: { enabled: true },
          store: { enabled: true, pickupPoint: { name: "Tienda", address: "Av. Recojo 1", instructions: null } } }, access)).success).toBe(true);
      });
    },
    /** Home is on but its only zone is disabled, and nothing else is offered. */
    async configureNoModes() {
      await withTenantIsolation(companyId, async () => {
        expect((await deliverySettings.saveZones({ expectedVersion: 0, zones: [
          { kind: "new", name: "Disabled", enabled: false, districtCodes: ["150122"], options: [{ kind: "new", method: "home", name: "Home", enabled: true, price: { amount: 5, currency: "PEN" } }] }] }, access)).success).toBe(true);
        expect((await deliverySettings.save({ expectedVersion: 1, home: { enabled: true }, agency: { enabled: false }, store: { enabled: false, pickupPoint: null } }, access)).success).toBe(true);
      });
    },
    async cleanup() {
      await withTenantIsolation(companyId, async () => {
        await prisma.payment.deleteMany(); await prisma.orderItem.deleteMany(); await prisma.order.deleteMany();
        await prisma.contact.deleteMany(); await prisma.productStock.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.productOption.deleteMany(); await prisma.product.deleteMany();
        await prisma.deliveryRate.deleteMany(); await prisma.quotation.deleteMany(); await prisma.deliveryZoneDistrict.deleteMany(); await prisma.deliveryZoneProvince.deleteMany(); await prisma.deliveryZoneDepartment.deleteMany();
        await prisma.deliveryOptionAgency.deleteMany(); await prisma.deliveryOption.deleteMany(); await prisma.deliveryZone.deleteMany(); await prisma.companyCourier.deleteMany(); await prisma.companyDeliverySettings.deleteMany();
      });
      await removeCompanyAppearance(companyId);
      await withTenantIsolation(companyId, async () => { await systemPrisma.user.delete({ where: { id: userId } }); await prisma.company.delete({ where: { id: companyId } }); });
    },
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

/** Runs `work` with a store covering home in Miraflores and agency in Arequipa, and removes everything afterwards. */
async function withStore(work: (f: Fixture) => Promise<void>) {
  const f = await fixture();
  const agencies = [await insertAgency({ courierId: await seededCatalogId(), name: "Sucursal Arequipa", districtCode: "040101" })];
  try { await f.configureCoverage(agencies[0]); await work(f); } finally { await f.cleanup(); await deleteAgencies(agencies); }
}

const section = (page: Page) => page.getByRole("group", { name: "Entrega", exact: true });
const regions = (page: Page) => section(page).locator('[role="status"][aria-live="polite"]');
const method = (page: Page, mode: Mode) => page.getByRole("radiogroup", { name: "Forma de entrega" }).locator(`input[value="${mode}"]`);

/** Waits until the form is interactive and the preselection of Miraflores has run: its quotation is the one a test may hold. */
async function settledOnHome(page: Page) {
  await browserExpect(page.getByRole("combobox", { name: "Distrito", exact: true })).toHaveValue("Miraflores");
  await browserExpect(regions(page).first().getByText(preselected)).toBeVisible();
}

/** An explicit clear of Distrito empties the notice; entering home again after a store pickup then preselects it with the notice. */
async function clearDistrict(page: Page) {
  const district = page.getByRole("combobox", { name: "Distrito", exact: true });
  await district.fill("");
  await district.press("Enter");
  await browserExpect(district).toHaveValue("");
  await browserExpect(regions(page).first().locator("p")).toHaveCount(0);
}

async function startQuotationHold(page: Page) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/quotations", async (route) => { await gate; await route.continue(); });
  return release;
}

/** WCAG contrast ratio of the text of `element` over the opaque background of its popup, from the colors the browser computes. */
const popupTextRatio = (element: Element) => {
  const channels = (color: string) => { const found = color.match(/^rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)$/); if (!found || found[4] === "0") throw new Error(`Not an opaque color: ${color}`); return found.slice(1, 4).map(Number); };
  const luminance = (color: string) => { const [r, g, b] = channels(color).map((value) => { const unit = value / 255; return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const [text, background] = [luminance(getComputedStyle(element).color), luminance(getComputedStyle(element.closest("[data-slot=combobox-content]")!).backgroundColor)];
  return (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05);
};

/**
 * Axe with only the color-contrast rule, over the delivery section, or over the open list when `list` is set (it is portaled out of the section).
 * Zero violations required. Axe cannot read the color behind the list's text at the rounded corners of its box, where the empty-search text
 * element reaches out of the popup's curve, and reports it as undecided; that text is then measured with the WCAG formula over the popup's own
 * opaque color, and anything else left undecided fails.
 */
async function expectContrast(page: Page, state: string, { list = false } = {}) {
  await section(page).evaluate((element) => element.setAttribute("data-axe-scope", ""));
  const results = await new AxeBuilder({ page }).withRules(["color-contrast"]).include(list ? "[data-slot=combobox-content]" : "[data-axe-scope]").analyze();
  const describe = (nodes: typeof results.violations[number]["nodes"]) => nodes.map((node) => `${node.target.join(" ")}: ${node.any.map((check) => check.message).join("; ")}`);
  expect(results.violations.flatMap((violation) => describe(violation.nodes)), `${state}: contrast violations`).toEqual([]);
  const undecided = results.incomplete.flatMap((rule) => rule.nodes);
  if (!list) expect(undecided.flatMap((node) => describe([node])), `${state}: contrast left undecided`).toEqual([]);
  for (const node of undecided) {
    const element = page.locator("[data-slot=combobox-content]").locator(String(node.target[0]));
    expect(await element.count(), `${state}: ${node.target[0]} is one element of the list`).toBe(1);
    expect(await element.evaluate(popupTextRatio), `${state}: contrast ratio of ${node.target[0]}`).toBeGreaterThanOrEqual(4.5);
  }
  expect(results.passes.flatMap((rule) => rule.nodes).length + undecided.length, `${state}: some text was checked`).toBeGreaterThan(0);
}

test("the location texts keep the contrast floor in every theme", async ({ page }) => {
  for (const id of storeThemeIds) {
    await withStore(async (f) => {
      const empty = await fixture();
      try {
        await empty.configureNoModes();
        for (const company of [f, empty]) await saveCompanyAppearance(company.companyId, { theme: id as StoreThemeId, withLogo: false });
        await page.emulateMedia({ colorScheme: id === "noche" ? "light" : "dark" });
        await page.goto(f.path);
        await settledOnHome(page);
        await browserExpect(page.getByText(hint, { exact: false })).toBeVisible();
        await expectContrast(page, `${id}: location group with preselection notice and hint`);
        await method(page, "agency").check();
        await browserExpect(regions(page).first().getByText(cleared)).toBeVisible();
        await expectContrast(page, `${id}: change notice after switching home to agency`);
        const department = page.getByRole("combobox", { name: "Departamento", exact: true });
        await department.click();
        await department.fill("zzz");
        await browserExpect(page.getByText("Ningún departamento de la lista coincide. Revisa cómo lo escribiste.")).toBeVisible();
        await expectContrast(page, `${id}: empty search in an open combobox`, { list: true });
        await page.goto(empty.path);
        await browserExpect(page.getByText(noModes, { exact: true })).toBeVisible();
        await expectContrast(page, `${id}: no delivery methods available`);
      } finally { await empty.cleanup(); }
    });
  }
});

type Item = Readonly<{ top: number; bottom: number }>;
type Layout = Readonly<{ gap: number; regionHeights: readonly number[]; items: readonly Item[]; methodsTop: number; trailing: number }>;

/** Boxes of what the delivery section shows. A status region counts through its text (the paragraph inside), and only when it has some. */
const layoutOf = (page: Page): Promise<Layout> => section(page).evaluate((fieldset) => {
  const box = (element: Element) => { const rect = element.getBoundingClientRect(); return { top: rect.top + scrollY, bottom: rect.bottom + scrollY, height: rect.height }; };
  const isRegion = (element: Element) => element.getAttribute("role") === "status" && element.getAttribute("aria-live") === "polite";
  const children = [...fieldset.children].filter((child) => child.tagName !== "LEGEND");
  const items = children.map((child) => isRegion(child) ? child.firstElementChild : child).filter((element): element is Element => element !== null && box(element).height > 0).map(box);
  const methods = fieldset.querySelector('[role="radiogroup"]');
  return { gap: parseFloat(getComputedStyle(fieldset).rowGap), regionHeights: children.filter(isRegion).map((region) => box(region).height), items,
    methodsTop: methods ? box(methods).top : NaN, trailing: box(fieldset).bottom - items[items.length - 1].bottom };
});

/** No blank gap: every visible block sits one section gap below the previous one, whichever regions are empty. */
function expectContiguous(layout: Layout, moment: string) {
  layout.items.slice(1).forEach((item, index) => {
    expect(item.top - layout.items[index].bottom, `${moment}: space between block ${index} and ${index + 1}`).toBeCloseTo(layout.gap, 0);
  });
}

const viewports = [{ name: "390", width: 390, height: 844 }, { name: "1280", width: 1280, height: 900 }] as const;

for (const viewport of viewports) {
  const shot = (page: Page, flow: string, moment: string) => page.screenshot({ path: `${shotsDir}/${viewport.name}-${flow}-${moment}.png`, fullPage: true });

  test(`no blank gap or jump around the location notice and quotation status at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    mkdirSync(shotsDir, { recursive: true });
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await withStore(async (f) => {
      // Before: the server render, without scripts, so neither region has been filled.
      const bare = await page.context().browser()!.newContext({ javaScriptEnabled: false, viewport: { width: viewport.width, height: viewport.height } });
      const server = await bare.newPage();
      await server.goto(f.path);
      const before = await layoutOf(server);
      await shot(server, "load", "before");
      await bare.close();
      expect(before.regionHeights, "server render: both regions take no height").toEqual([0, 0]);
      expectContiguous(before, "server render");

      // During: Miraflores is preselected, so its quotation starts by itself; it is held to see the status.
      const release = await startQuotationHold(page);
      await page.goto(f.path);
      await settledOnHome(page);
      await browserExpect(regions(page).nth(1).getByText(loading)).toBeVisible();
      const during = await layoutOf(page);
      await shot(page, "load", "during");
      expect(during.regionHeights.every((height) => height > 0), "during: notice and status both have text").toBe(true);
      expectContiguous(during, "during");
      expect(during.methodsTop, "the methods do not move when the notice appears").toBeCloseTo(before.methodsTop, 0);

      // After: the quotation answered; only the status disappears and nothing above it moves.
      release();
      await browserExpect(page.getByLabel("Tarifa de envío")).toBeVisible();
      await browserExpect(regions(page).nth(1).getByText(loading)).toHaveCount(0);
      const after = await layoutOf(page);
      await shot(page, "load", "after");
      expect(after.regionHeights[1], "after: the status region is empty again").toBe(0);
      expect(after.regionHeights[0], "after: the notice stays").toBeGreaterThan(0);
      expectContiguous(after, "after");
      expect(after.items.slice(0, during.items.length - 1), "nothing above the status moved").toEqual(during.items.slice(0, during.items.length - 1));
      await page.unrouteAll({ behavior: "wait" });

      // Switching: store pickup says nothing, entering home says the preselection again, agency says the cleared district in a padded block.
      await shot(page, "switch", "before");
      await clearDistrict(page);
      const emptied = await layoutOf(page);
      await shot(page, "switch", "district-cleared");
      expect(emptied.regionHeights, "district cleared: both regions take no height").toEqual([0, 0]);
      expectContiguous(emptied, "district cleared");
      await method(page, "store").check();
      await browserExpect(page.getByText("Av. Recojo 1")).toBeVisible();
      const store = await layoutOf(page);
      await shot(page, "switch", "store");
      expect(store.regionHeights, "store pickup: both regions take no height").toEqual([0, 0]);
      expectContiguous(store, "store pickup");
      await method(page, "home").check();
      await settledOnHome(page);
      await browserExpect(page.getByLabel("Tarifa de envío")).toBeVisible();
      await method(page, "agency").check();
      await browserExpect(regions(page).first().getByText(cleared)).toBeVisible();
      const agency = await layoutOf(page);
      await shot(page, "switch", "after");
      expect(agency.regionHeights[0], "agency: the cleared message is shown").toBeGreaterThan(0);
      expect(agency.regionHeights[1], "agency: no quotation status for a district that is still to be chosen").toBe(0);
      expectContiguous(agency, "agency");
      expect(agency.methodsTop, "the methods do not move when switching").toBeCloseTo(after.methodsTop, 0);
    });
  });
}

test("both live regions are in the server HTML, stay mounted, and announce the notice once before the loading text", async ({ page }) => {
  await withStore(async (f) => {
    const html = await (await page.request.get(f.route, { headers: f.headers })).text();
    const empties = html.match(/<div(?=[^>]*role="status")(?=[^>]*aria-live="polite")[^>]*><\/div>/g) ?? [];
    expect(empties, "two empty polite status regions come in the server render").toHaveLength(2);
    expect(html).not.toContain(preselected);
    expect(html).not.toContain(loading);

    // Records the regions as the parser creates them and every text inserted into them, in order.
    await page.addInitScript(() => {
      const w = window as unknown as { __live: { regions: Element[]; log: { region: number; text: string }[] } };
      w.__live = { regions: [], log: [] };
      const track = (region: Element) => {
        if (w.__live.regions.includes(region)) return;
        const index = w.__live.regions.push(region) - 1;
        new MutationObserver((records) => {
          for (const record of records) {
            record.addedNodes.forEach((node) => { if (node.textContent?.trim()) w.__live.log.push({ region: index, text: node.textContent.trim() }); });
            if (record.type === "characterData" && record.target.textContent?.trim()) w.__live.log.push({ region: index, text: record.target.textContent.trim() });
          }
        }).observe(region, { childList: true, subtree: true, characterData: true });
      };
      new MutationObserver(() => document.querySelectorAll('fieldset [role="status"][aria-live="polite"]').forEach(track)).observe(document, { childList: true, subtree: true });
    });
    const log = () => page.evaluate(() => (window as unknown as { __live: { log: { region: number; text: string }[] } }).__live.log);
    const reset = () => page.evaluate(() => { (window as unknown as { __live: { log: unknown[] } }).__live.log.length = 0; });
    const sameNodes = () => page.evaluate(() => {
      const live = (window as unknown as { __live: { regions: Element[] } }).__live.regions;
      const now = [...document.querySelectorAll('fieldset [role="status"][aria-live="polite"]')];
      return { tracked: live.length, mounted: now.length, same: now.every((node, index) => node === live[index]), connected: live.every((node) => node.isConnected) };
    });
    const texts = (entries: readonly { text: string }[]) => entries.map((entry) => entry.text);

    // On load: the notice is inserted once, then the loading text.
    await page.goto(f.path);
    await settledOnHome(page);
    await browserExpect.poll(async () => texts(await log()).includes(loading)).toBe(true);
    const onLoad = texts(await log());
    expect(onLoad.filter((text) => text === preselected), "on load: the notice is inserted once").toHaveLength(1);
    expect(onLoad.indexOf(preselected), "on load: the notice comes before the loading text").toBeLessThan(onLoad.indexOf(loading));
    expect((await log()).find((entry) => entry.text === preselected)?.region).toBe(0);
    expect((await log()).find((entry) => entry.text === loading)?.region).toBe(1);
    await browserExpect(page.getByLabel("Tarifa de envío")).toBeVisible();
    expect(await sameNodes(), "the regions of the server render are the ones of the live page").toEqual({ tracked: 2, mounted: 2, same: true, connected: true });

    // Entering a method: the store says nothing, then home inserts the notice once before the loading text, and focus stays on the radio.
    // The district is cleared first, so that home has something to preselect (a district still covered is kept without a notice).
    await clearDistrict(page);
    await method(page, "store").check();
    await browserExpect(page.getByText("Av. Recojo 1")).toBeVisible();
    await browserExpect(regions(page).first().getByText(preselected)).toHaveCount(0);
    expect(await sameNodes()).toEqual({ tracked: 2, mounted: 2, same: true, connected: true });
    await reset();
    await method(page, "home").check();
    await browserExpect(page.getByLabel("Tarifa de envío")).toBeVisible();
    const entered = texts(await log());
    expect(entered.filter((text) => text === preselected), "entering home: the notice is inserted once").toHaveLength(1);
    expect(entered.indexOf(preselected), "entering home: the notice comes before the loading text").toBeLessThan(entered.indexOf(loading));
    expect(await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.value)).toBe("home");

    // Agency: one cleared message, in the same region, with no loading text.
    await reset();
    await method(page, "agency").check();
    await browserExpect(regions(page).first().getByText(cleared)).toBeVisible();
    const toAgency = await log();
    expect(toAgency.filter((entry) => cleared.test(entry.text)), "entering agency: the cleared message is inserted once").toHaveLength(1);
    expect(toAgency.every((entry) => entry.region === 0 && entry.text !== loading), "entering agency: only the notice region changes").toBe(true);
    expect(await sameNodes(), "the regions survive every method switch").toEqual({ tracked: 2, mounted: 2, same: true, connected: true });
  });
});
