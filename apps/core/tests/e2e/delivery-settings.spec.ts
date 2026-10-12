import { deliverySettingsSchema } from "@shared/contracts/delivery-settings";
import { mkdir } from "node:fs/promises";
import { browserExpect, expect, prepareVerifiedCompany, test } from "@core/tests/e2e/fixtures";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { products } from "@core/src/features/products/composition";
import { deleteAgencies, insertAgency, seededCourier } from "@core/src/features/delivery-settings/infrastructure/courier-catalog-fixture";

test("seller configures store pickup, preserves a conflicting draft and explicitly reloads", async ({ page, request }) => {
  const email = `delivery-settings-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    expect((await request.get("/es-PE/settings/delivery", { maxRedirects: 0 })).status()).toBe(302);
    companyId = await prepareVerifiedCompany(page, { email, name: "Seller", companyName: "Store pickup", country: "PE" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/es-PE/dashboard");
    await page.getByRole("complementary").getByRole("link", { name: "Modalidades de entrega" }).click();
    await browserExpect(page.getByLabel("Ofrecer recojo en tienda")).not.toBeChecked();
    expect(await withTenantIsolation(companyId, async () => await prisma.companyDeliverySettings.count())).toBe(0);
    await browserExpect(page.getByRole("tabpanel")).toHaveCount(1);
    await browserExpect(page.getByLabel("Ofrecer entrega a domicilio")).not.toBeVisible();
    await page.getByRole("tab", { name: "Tienda", exact: false }).focus();
    await page.keyboard.press("ArrowRight");
    await browserExpect(page.getByRole("tab", { name: "Domicilio", exact: false })).toHaveAttribute("aria-selected", "true");
    await browserExpect(page.getByLabel("Ofrecer entrega a domicilio")).not.toBeChecked();
    await page.getByLabel("Ofrecer entrega a domicilio").check();
    await page.getByRole("tab", { name: "Tienda", exact: false }).click();
    await page.getByLabel("Ofrecer recojo en tienda").check();
    await page.getByRole("tab", { name: "Domicilio", exact: false }).click();
    await page.getByRole("button", { name: "Guardar configuración" }).click();
    await browserExpect(page.getByRole("tab", { name: "Tienda", exact: false })).toHaveAttribute("aria-selected", "true");
    await browserExpect(page.getByLabel("Nombre del punto de recojo")).toBeFocused();
    await browserExpect(page.getByLabel("Nombre del punto de recojo")).toHaveAttribute("aria-invalid", "true");
    await page.getByLabel("Nombre del punto de recojo").fill("Tienda principal");
    await page.getByLabel("Dirección", { exact: true }).fill("Av. Lima 123");
    await page.getByLabel("Indicaciones (opcional)").fill("Puerta lateral");
    await page.getByRole("button", { name: "Guardar configuración" }).click();
    await browserExpect(page.getByRole("status").filter({ hasText: "Configuración guardada." })).toHaveText("Configuración guardada.");
    await mkdir("../../.impeccable/review", { recursive: true });
    for (const [width, height, device] of [[1280, 900, "desktop"], [390, 844, "mobile"]] as const) {
      await page.setViewportSize({ width, height });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: `../../.impeccable/review/delivery-tabs-store-${device}.png`, fullPage: true, animations: "disabled" });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    const saved = await page.request.get("/api/delivery-settings");
    expect(await saved.json()).toMatchObject({ version: 1, agency: { enabled: false }, couriers: [], home: { enabled: true }, store: { enabled: true, pickupPoint: { address: "Av. Lima 123" } } });
    await page.getByLabel("Dirección", { exact: true }).fill("Mi borrador");
    await browserExpect(page.getByRole("status")).toHaveCount(0);
    await page.getByRole("tab", { name: "Agencia", exact: false }).click();
    await page.getByRole("tab", { name: "Tienda", exact: false }).click();
    await browserExpect(page.getByLabel("Dirección", { exact: true })).toHaveValue("Mi borrador");
    const concurrent = await page.request.put("/api/delivery-settings", { data: { expectedVersion: 1,
      agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: true, pickupPoint: { name: "Otra tienda", address: "Dirección concurrente", instructions: null } } } });
    expect(concurrent.ok()).toBe(true);
    await page.getByRole("button", { name: "Guardar configuración" }).click();
    await browserExpect(page.getByRole("alert")).toContainText("Otra persona cambió");
    await browserExpect(page.getByLabel("Dirección", { exact: true })).toHaveValue("Mi borrador");
    await browserExpect(page.getByLabel("Ofrecer entrega a domicilio")).toBeChecked();
    await browserExpect(page.getByRole("button", { name: "Guardar configuración" })).toBeDisabled();
    await page.getByRole("link", { name: "Recargar configuración" }).click();
    await browserExpect(page.getByLabel("Dirección", { exact: true })).toHaveValue("Dirección concurrente");
    await browserExpect(page.getByLabel("Ofrecer entrega a domicilio")).not.toBeChecked();
    await page.getByLabel("Ofrecer recojo en tienda").uncheck();
    await page.getByRole("button", { name: "Guardar configuración" }).click();
    await browserExpect(page.getByRole("status").filter({ hasText: "Configuración guardada." })).toHaveText("Configuración guardada.");
    expect(await (await page.request.get("/api/delivery-settings")).json()).toMatchObject({ version: 3,
      agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: false, pickupPoint: { address: "Dirección concurrente" } } });
    await page.getByRole("tab", { name: "Domicilio", exact: false }).click();
    await page.getByLabel("Ofrecer entrega a domicilio").check();
    const homeSaved = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname.includes("/settings/delivery"));
    await page.getByRole("button", { name: "Guardar configuración" }).click();
    await homeSaved;
    await browserExpect(page.getByRole("button", { name: "Guardar configuración" })).toBeEnabled();
    await browserExpect(page.getByRole("status").filter({ hasText: "Configuración guardada." })).toHaveText("Configuración guardada.");
    expect(await (await page.request.get("/api/delivery-settings")).json()).toMatchObject({ version: 4, agency: { enabled: false }, couriers: [], home: { enabled: true }, store: { enabled: false, pickupPoint: { address: "Dirección concurrente" } } });
    await mkdir("../../.impeccable/review", { recursive: true });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: "../../.impeccable/review/delivery-tabs-home-desktop.png", fullPage: true, animations: "disabled" });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: "../../.impeccable/review/delivery-tabs-home-mobile.png", fullPage: true, animations: "disabled" });
    await page.goto("/pt-BR/settings/delivery");
    await browserExpect(page.getByLabel("Oferecer retirada na loja")).not.toBeChecked();
    await browserExpect(page.getByLabel("Oferecer entrega em domicílio")).toBeChecked();
    await browserExpect(page.getByLabel("Endereço", { exact: true })).toHaveValue("Dirección concurrente");

    await page.getByRole("tab", { name: "Agência", exact: false }).click();
    await page.getByLabel("Oferecer envio para agência").check();
    await page.getByRole("tab", { name: "Loja", exact: false }).click();
    await page.getByRole("button", { name: "Salvar configuração" }).click();
    await browserExpect(page.getByLabel("Oferecer envio para agência")).toBeFocused();
    await browserExpect(page.getByLabel("Oferecer envio para agência")).toHaveAttribute("aria-invalid", "true");
    const catalog = page.getByLabel("Transportadora disponível");
    const choose = async (name: string) => { await catalog.click(); await page.getByRole("option", { name, exact: true }).click(); };
    await choose("Shalom");
    await page.getByRole("button", { name: "Adicionar transportadora" }).click();
    await catalog.click();
    await browserExpect(page.getByRole("option", { name: "Shalom", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Remover Shalom não salva" }).click();
    await catalog.click();
    await browserExpect(page.getByRole("option", { name: "Shalom", exact: true })).toHaveCount(1);
    await page.keyboard.press("Escape");
    await choose("Shalom");
    await page.getByRole("button", { name: "Adicionar transportadora" }).click();
    await choose("Olva Courier");
    await page.getByRole("button", { name: "Adicionar transportadora" }).click();
    await page.getByLabel("Habilitar Olva Courier").uncheck();
    const agencySaved = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname.includes("/settings/delivery"));
    await page.getByRole("button", { name: "Salvar configuração" }).click();
    await agencySaved;
    const agencySettings = deliverySettingsSchema.parse(await (await page.request.get("/api/delivery-settings")).json());
    expect(agencySettings).toMatchObject({ version: 5, agency: { enabled: true }, couriers: expect.arrayContaining([expect.objectContaining({ name: "Shalom", enabled: true }), expect.objectContaining({ name: "Olva Courier", enabled: false })]) });
    expect(agencySettings.couriers).toHaveLength(2);
    await browserExpect(page.getByText("Remover cadastro não salvo")).toHaveCount(0);
    await page.getByRole("tab", { name: "Domicílio", exact: false }).click();
    await page.getByLabel("Oferecer entrega em domicílio").uncheck();
    const preserved = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname.includes("/settings/delivery"));
    await page.getByRole("button", { name: "Salvar configuração" }).click();
    await preserved;
    expect(await (await page.request.get("/api/delivery-settings")).json()).toEqual({ ...agencySettings, version: 6, home: { enabled: false }, couriers: expect.arrayContaining(agencySettings.couriers) });
    await page.getByRole("tab", { name: "Agência", exact: false }).click();
    await page.getByLabel("Habilitar Shalom").uncheck();
    await page.getByRole("tab", { name: "Domicílio", exact: false }).click();
    await page.getByRole("button", { name: "Salvar configuração" }).click();
    await browserExpect(page.getByRole("alert")).toContainText("habilite pelo menos uma transportadora");
    expect(await (await page.request.get("/api/delivery-settings")).json()).toMatchObject({ version: 6, agency: { enabled: true } });
    await browserExpect(page.getByLabel("Habilitar Shalom")).not.toBeChecked();
    await page.getByLabel("Oferecer envio para agência").uncheck();
    const disabled = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname.includes("/settings/delivery"));
    await page.getByRole("button", { name: "Salvar configuração" }).click();
    await disabled;
    expect(await (await page.request.get("/api/delivery-settings")).json()).toMatchObject({ version: 7, agency: { enabled: false }, couriers: expect.arrayContaining(agencySettings.couriers.map(courier => ({ ...courier, enabled: false }))) });
    await page.getByLabel("Habilitar Shalom").check();
    await page.getByLabel("Oferecer envio para agência").check();
    const enabledAgain = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname.includes("/settings/delivery"));
    await page.getByRole("button", { name: "Salvar configuração" }).click();
    await enabledAgain;
    const current = deliverySettingsSchema.parse(await (await page.request.get("/api/delivery-settings")).json());
    await page.getByLabel("Habilitar Olva Courier").check();
    expect((await page.request.put("/api/delivery-settings", { data: { expectedVersion: current.version, home: { enabled: !current.home.enabled }, store: current.store, agency: current.agency,
      couriers: current.couriers.map(courier => ({ kind: "existing", id: courier.id, enabled: courier.enabled })) } })).ok()).toBe(true);
    await page.getByRole("button", { name: "Salvar configuração" }).click();
    await browserExpect(page.getByRole("alert")).toContainText("Outra pessoa alterou");
    await browserExpect(page.getByLabel("Habilitar Olva Courier")).toBeChecked();
    await browserExpect(page.getByRole("button", { name: "Salvar configuração" })).toBeDisabled();
    await page.getByRole("link", { name: "Recarregar configuração" }).click();
    await page.getByRole("tab", { name: "Agência", exact: false }).click();
    await browserExpect(page.getByLabel("Habilitar Olva Courier")).not.toBeChecked();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: "../../.impeccable/review/delivery-tabs-agency-desktop.png", fullPage: true, animations: "disabled" });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: "../../.impeccable/review/delivery-tabs-agency-mobile.png", fullPage: true, animations: "disabled" });
    await page.evaluate(() => { localStorage.setItem("yoyos-theme", "dark"); document.documentElement.classList.add("dark"); });
    await page.screenshot({ path: "../../.impeccable/review/delivery-tabs-agency-mobile-dark.png", fullPage: true, animations: "disabled" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: "../../.impeccable/review/delivery-tabs-agency-desktop-dark.png", fullPage: true, animations: "disabled" });
  } finally {
    if (companyId) await withTenantIsolation(companyId, async () => {
      await prisma.companyCourier.deleteMany();
      await prisma.companyDeliverySettings.deleteMany();
      await systemPrisma.user.deleteMany({ where: { email } });
      await prisma.company.delete({ where: { id: companyId } });
    });
  }
});

test("seller manages overlapping zones with delivery options and preserves an edit on a shared-version conflict", async ({ page }) => {
  const email = `delivery-zones-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  let agencyId: string | undefined;
  const buyer = await page.context().browser()!.newContext({ baseURL: `http://127.0.0.1:${process.env.CORE_E2E_PORT ?? "4173"}` });
  try {
    companyId = await prepareVerifiedCompany(page, { email, name: "Seller", companyName: "Zones store", country: "PE" });
    await page.goto("/es-PE/settings/delivery");
    await page.getByRole("tab", { name: "Domicilio", exact: false }).click();
    await page.getByRole("tabpanel").getByLabel("Ofrecer entrega a domicilio").check();
    await page.getByRole("button", { name: "Guardar configuración", exact: true }).click();
    await browserExpect(page.getByText("Configuración guardada.", { exact: true })).toBeVisible();
    await browserExpect(page.getByText("Falta una opción de domicilio activa con cobertura", { exact: true })).toBeVisible();
    for (const [name, option, price] of [["Cercana", "Moto", "8"], ["Extendida", "Camión", "12"]]) {
      await page.getByRole("button", { name: "Agregar zona", exact: true }).click();
      await page.getByLabel("Nombre de la zona", { exact: true }).fill(name);
      await page.getByLabel("Departamento", { exact: true }).selectOption("15");
      await page.getByLabel("Provincia", { exact: true }).selectOption("1501");
      await page.getByLabel("Buscar distrito", { exact: true }).fill("150122");
      await page.getByRole("checkbox", { name: "MIRAFLORES · 150122", exact: true }).check();
      if (name === "Cercana") {
        await page.getByLabel("Departamento", { exact: true }).selectOption("04");
        await page.getByLabel("Provincia", { exact: true }).selectOption("0401");
        await page.getByLabel("Buscar distrito", { exact: true }).fill("040110");
        await page.getByRole("checkbox", { name: "MIRAFLORES · 040110", exact: true }).check();
        await browserExpect(page.getByText("2 distritos seleccionados", { exact: true })).toBeVisible();
      }
      await page.getByRole("button", { name: "Agregar opción", exact: true }).click();
      await page.getByLabel("Nombre de la opción", { exact: true }).fill(option);
      await page.getByLabel("Tarifa de la opción (S/)", { exact: true }).fill(price);
      if (name === "Cercana") {
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.screenshot({ path: "test-results/delivery-zones-desktop.png", fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.screenshot({ path: "test-results/delivery-zones-mobile.png", fullPage: true });
      }
      await page.getByRole("button", { name: "Guardar zona", exact: true }).click();
      await browserExpect(page.getByRole("button", { name: `Editar ${name}`, exact: true })).toBeVisible();
      await browserExpect(page.getByLabel("Nombre de la zona", { exact: true })).toHaveCount(0);
    }
    const variantId = await withTenantIsolation(companyId, async () => {
      const created = await products.create({ name: "Coverage product", currency: "PEN", variants: [{ attributes: {}, salePrice: 10, initialStock: 3 }] });
      if (!created.success) throw new Error(created.error.message);
      return (await prisma.productVariant.findFirstOrThrow({ where: { productId: created.data } })).id;
    });
    const orderId = crypto.randomUUID();
    expect((await page.request.post("/api/orders", { data: { id: orderId, contactId: null, items: [{ variantId, quantity: 1 }] } })).status()).toBe(201);
    const enabled = await page.request.post(`/api/orders/${orderId}/checkout-link`);
    expect(enabled.ok()).toBe(true);
    const buyerPage = await buyer.newPage();
    await buyerPage.goto((await enabled.json()).url);
    await buyerPage.getByLabel("Departamento", { exact: true }).selectOption("15");
    await buyerPage.getByLabel("Provincia", { exact: true }).selectOption("1501");
    await buyerPage.getByLabel("Distrito", { exact: true }).selectOption("150122");
    const buyerRates = buyerPage.getByLabel("Tarifa de envío");
    await browserExpect(buyerRates.locator("option")).toHaveCount(3);
    await browserExpect(buyerRates).toContainText(/Moto · S\/\s?8[.,]00/);
    await browserExpect(buyerRates).toContainText(/Camión · S\/\s?12[.,]00/);
    await page.getByRole("button", { name: "Desactivar Cercana", exact: true }).click();
    await browserExpect(page.getByRole("button", { name: "Reactivar Cercana", exact: true })).toBeVisible();
    await buyerPage.getByLabel("Distrito", { exact: true }).selectOption("");
    await buyerPage.getByLabel("Distrito", { exact: true }).selectOption("150122");
    await browserExpect(buyerRates.locator("option")).toHaveCount(2);
    await browserExpect(buyerRates).toContainText(/Camión/);
    await browserExpect(buyerRates).not.toContainText(/Moto/);
    const current = await (await page.request.get("/api/delivery-settings")).json();
    const concurrent = await page.request.put("/api/delivery-settings", { data: {
      expectedVersion: current.version, home: current.home, agency: current.agency, store: current.store, couriers: [],
    } });
    expect(concurrent.status()).toBe(200);
    await page.getByRole("button", { name: "Editar Extendida", exact: true }).click();
    await page.getByLabel("Nombre de la zona", { exact: true }).fill("Mi borrador");
    await page.getByRole("button", { name: "Guardar zona", exact: true }).click();
    await browserExpect(page.getByRole("alert")).toContainText("Conservamos el borrador");
    await browserExpect(page.getByLabel("Nombre de la zona", { exact: true })).toHaveValue("Mi borrador");
    await browserExpect(page.getByLabel("Tarifa de la opción (S/)", { exact: true })).toHaveValue("12");
    await browserExpect(page.getByRole("button", { name: "Guardar zona", exact: true })).toBeDisabled();
    const stored = await (await page.request.get("/api/delivery-settings/zones")).json();
    expect(stored.zones.map((zone: { name: string }) => zone.name).sort()).toEqual(["Cercana", "Extendida"]);
    expect(stored.zones.find((zone: { name: string }) => zone.name === "Cercana")).toMatchObject({
      enabled: false, districtCodes: ["040110", "150122"], options: [{ method: "home", name: "Moto", price: { amount: 8, currency: "PEN" } }],
    });
    await page.getByRole("link", { name: "Recargar configuración", exact: true }).click();
    await browserExpect(page.getByRole("button", { name: "Editar Extendida", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Reactivar Cercana", exact: true }).click();
    await browserExpect(page.getByRole("button", { name: "Desactivar Cercana", exact: true })).toBeVisible();
    // An agency option can be configured, but without associated agencies it never produces a rate.
    await page.getByRole("button", { name: "Editar Extendida", exact: true }).click();
    await page.getByRole("button", { name: "Agregar opción", exact: true }).click();
    await page.getByLabel("Modalidad", { exact: true }).last().click();
    await page.getByRole("option", { name: "Agencia", exact: true }).click();
    await page.getByLabel("Nombre de la opción", { exact: true }).last().fill("Agencia");
    await page.getByLabel("Tarifa de la opción (S/)", { exact: true }).last().fill("0");
    await page.getByRole("button", { name: "Guardar zona", exact: true }).click();
    await browserExpect(page.getByText("Agencia · Agencia").first()).toBeVisible();
    const quoted = await page.request.post("/api/quotations", { data: { destination: { country: "PE", districtCode: "150122" } } });
    expect(quoted.status()).toBe(201);
    expect((await quoted.json()).rates).toMatchObject([{ method: "home", name: "Moto", zoneName: "Cercana" }, { method: "home", name: "Camión", zoneName: "Extendida" }]);
    await browserExpect(page.getByText("Sin agencias elegibles: no se ofrece al cotizar.", { exact: true })).toBeVisible();
    // The seller associates a catalog agency of an enabled courier through the zone editor and the option starts being quoted.
    const courier = await seededCourier("shalom");
    agencyId = await insertAgency({ courierId: courier.id, name: "Sucursal E2E", districtCode: "150122" });
    const latest = deliverySettingsSchema.parse(await (await page.request.get("/api/delivery-settings")).json());
    expect((await page.request.put("/api/delivery-settings", { data: { expectedVersion: latest.version, home: latest.home, store: latest.store, agency: { enabled: true },
      couriers: [{ kind: "new", courierId: courier.id, enabled: true }] } })).ok()).toBe(true);
    await page.reload();
    await page.getByRole("button", { name: "Editar Extendida", exact: true }).click();
    await page.getByLabel("Buscar agencia por nombre, distrito o dirección", { exact: true }).fill("e2e");
    await page.getByRole("checkbox", { name: /Sucursal E2E/ }).check();
    await page.getByRole("button", { name: "Guardar zona", exact: true }).click();
    await browserExpect(page.getByText("Zona guardada.", { exact: true })).toBeVisible();
    await browserExpect(page.getByText("Sin agencias elegibles: no se ofrece al cotizar.", { exact: true })).toBeHidden();
    const agencyQuote = await page.request.post("/api/quotations", { data: { destination: { country: "PE", districtCode: "150122" } } });
    expect((await agencyQuote.json()).rates).toMatchObject([{ method: "home" }, { method: "home" },
      { method: "agency", name: "Agencia", agencies: [{ id: agencyId, name: "Sucursal E2E", courier: { name: "Shalom" }, location: { districtCode: "150122" } }] }]);
  } finally {
    await buyer.close();
    if (companyId) await withTenantIsolation(companyId, async () => {
      await prisma.payment.deleteMany(); await prisma.orderItem.deleteMany(); await prisma.order.deleteMany();
      await prisma.productStock.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.product.deleteMany();
      await prisma.deliveryRate.deleteMany();
      await prisma.quotation.deleteMany();
      await prisma.deliveryOptionAgency.deleteMany();
      await prisma.deliveryOption.deleteMany();
      await prisma.deliveryZoneDistrict.deleteMany();
      await prisma.deliveryZone.deleteMany();
      await prisma.companyCourier.deleteMany();
      await prisma.companyDeliverySettings.deleteMany();
      await systemPrisma.user.deleteMany({ where: { email } });
      await prisma.company.delete({ where: { id: companyId } });
    });
    if (agencyId) await deleteAgencies([agencyId]);
  }
});
