import { deliverySettingsSchema } from "@shared/contracts/delivery-settings";
import { mkdir } from "node:fs/promises";
import { browserExpect, expect, prepareVerifiedCompany, subdomainOf, test } from "@core/tests/e2e/fixtures";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { products } from "@core/src/features/products/composition";
import { deleteAgencies, insertAgency, seededCourier } from "@core/src/features/delivery-settings/infrastructure/courier-catalog-fixture";
import { chooseDistrict, chooseDistrictInProvince } from "@core/tests/e2e/district-combobox";

test("seller toggles delivery methods and the pickup point without a save button and they persist after reload", async ({ page, request }) => {
  const email = `delivery-settings-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  const api = async () => deliverySettingsSchema.parse(await (await page.request.get("/api/delivery-settings")).json());
  const row = (title: string) => page.getByRole("region", { name: title, exact: true });
  try {
    expect((await request.get("/es-PE/settings/delivery", { maxRedirects: 0 })).status()).toBe(302);
    companyId = await prepareVerifiedCompany(page, { email, name: "Seller", companyName: "Store pickup", country: "PE" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/es-PE/dashboard");
    await page.getByRole("complementary").getByRole("link", { name: "Modalidades de entrega" }).click();
    await browserExpect(page.getByRole("button", { name: "Guardar configuración" })).toHaveCount(0);
    await browserExpect(page.getByText("Tienes cambios sin guardar.")).toHaveCount(0);
    await browserExpect(page.getByLabel("Ofrecer recojo en tienda")).not.toBeChecked();
    expect(await withTenantIsolation(companyId, async () => await prisma.companyDeliverySettings.count())).toBe(0);
    await browserExpect(page.getByLabel("Nombre del punto de recojo")).toHaveCount(0);

    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const enabled of [true, false]) {
        const home = page.getByLabel("Ofrecer entrega a domicilio");
        await (enabled ? home.check() : home.uncheck());
        await browserExpect(row("Entrega a domicilio").getByText("Guardado", { exact: true })).toBeVisible();
        expect((await api()).home.enabled).toBe(enabled);
      }
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByLabel("Ofrecer entrega a domicilio").check();
    await browserExpect(row("Entrega a domicilio").getByText("Guardado", { exact: true })).toBeVisible();
    await page.reload();
    await browserExpect(page.getByLabel("Ofrecer entrega a domicilio")).toBeChecked();

    // Tapping store pickup without a saved point keeps it off, opens the fields and asks for what is missing.
    await page.getByLabel("Ofrecer recojo en tienda").click();
    await browserExpect(page.getByLabel("Ofrecer recojo en tienda")).not.toBeChecked();
    await browserExpect(page.getByText("Completa el nombre y la dirección para activar el recojo.", { exact: true })).toBeVisible();
    await browserExpect(page.getByLabel("Nombre del punto de recojo")).toBeFocused();
    await page.getByLabel("Nombre del punto de recojo").fill("Tienda Cercado");
    await page.getByLabel("Dirección", { exact: true }).fill("Calle Mercaderes 210");
    await page.getByLabel("Dirección", { exact: true }).blur();
    await browserExpect(page.getByLabel("Ofrecer recojo en tienda")).toBeChecked();
    await browserExpect(row("Recojo en tienda").getByText("Guardado", { exact: true })).toBeVisible();
    expect(await api()).toMatchObject({ store: { enabled: true, pickupPoint: { name: "Tienda Cercado", address: "Calle Mercaderes 210", instructions: null } } });
    await page.reload();
    await browserExpect(page.getByLabel("Ofrecer recojo en tienda")).toBeChecked();
    await browserExpect(page.getByLabel("Nombre del punto de recojo")).toHaveValue("Tienda Cercado");

    // The instructions are saved once after the typing, not per keystroke.
    const saves: string[] = [];
    page.on("request", saved => { if (saved.method() === "POST" && new URL(saved.url()).pathname.includes("/settings/delivery")) saves.push(saved.url()); });
    await page.getByLabel("Indicaciones (opcional)").pressSequentially("Timbre 2");
    await browserExpect.poll(async () => (await api()).store.pickupPoint?.instructions).toBe("Timbre 2");
    expect(saves).toHaveLength(1);

    // An emptied required field is not saved: the last saved point stays and the store stays on.
    await page.getByLabel("Nombre del punto de recojo").fill("");
    await page.getByLabel("Nombre del punto de recojo").blur();
    await browserExpect(page.getByText("Completa los campos obligatorios.", { exact: true })).toBeVisible();
    await page.waitForTimeout(300);
    expect(await api()).toMatchObject({ store: { enabled: true, pickupPoint: { name: "Tienda Cercado" } } });
    await page.getByLabel("Nombre del punto de recojo").fill("Tienda Cercado");
    await page.getByLabel("Nombre del punto de recojo").blur();
    await browserExpect(page.getByText("Completa los campos obligatorios.", { exact: true })).toHaveCount(0);

    // Offline the switch goes back and Reintentar saves once the connection returns.
    await page.context().setOffline(true);
    await page.getByLabel("Ofrecer envío a agencia").click();
    await browserExpect(page.getByText("No se pudo guardar. Revisa tu conexión y vuelve a intentarlo.", { exact: true })).toBeVisible();
    await browserExpect(page.getByLabel("Ofrecer envío a agencia")).not.toBeChecked();
    await page.context().setOffline(false);
    await page.getByRole("button", { name: "Reintentar", exact: true }).click();
    await browserExpect(row("Envío a agencia").getByText("Guardado", { exact: true })).toBeVisible();
    await browserExpect(page.getByLabel("Ofrecer envío a agencia")).toBeChecked();
    expect((await api()).agency.enabled).toBe(true);

    // Leaving with a pickup text that failed to save asks for confirmation; staying keeps the text and Reintentar saves it.
    await page.context().setOffline(true);
    await page.getByLabel("Indicaciones (opcional)").fill("Portón verde");
    await page.getByLabel("Indicaciones (opcional)").blur();
    await browserExpect(page.getByText("No se pudo guardar. Revisa tu conexión y vuelve a intentarlo.", { exact: true })).toBeVisible();
    await page.getByRole("complementary").getByRole("link").filter({ hasNotText: "Modalidades de entrega" }).first().click();
    await browserExpect(page.getByRole("dialog").getByText("Hay cambios del punto de recojo sin guardar.")).toBeVisible();
    await page.getByRole("button", { name: "Seguir editando", exact: true }).click();
    await browserExpect(page.getByRole("dialog")).toHaveCount(0);
    await browserExpect(page.getByLabel("Indicaciones (opcional)")).toHaveValue("Portón verde");
    await page.context().setOffline(false);
    await page.getByRole("button", { name: "Reintentar", exact: true }).click();
    await browserExpect.poll(async () => (await api()).store.pickupPoint?.instructions).toBe("Portón verde");

    await mkdir("../../.impeccable/review", { recursive: true });
    for (const [width, height, device] of [[1280, 900, "desktop"], [390, 844, "mobile"]] as const) {
      await page.setViewportSize({ width, height });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: `../../.impeccable/review/delivery-methods-store-${device}.png`, fullPage: true, animations: "disabled" });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByLabel("Ofrecer recojo en tienda").uncheck();
    await browserExpect(row("Recojo en tienda").getByText("Guardado", { exact: true })).toBeVisible();
    expect(await api()).toMatchObject({ home: { enabled: true }, agency: { enabled: true }, store: { enabled: false, pickupPoint: { name: "Tienda Cercado" } } });
    await page.goto("/pt-BR/settings/delivery");
    await browserExpect(page.getByLabel("Oferecer retirada na loja")).not.toBeChecked();
    await browserExpect(page.getByLabel("Oferecer envio para agência")).toBeChecked();
    await browserExpect(page.getByText("Guardamos seu ponto para quando você reativar: Tienda Cercado · Calle Mercaderes 210")).toBeVisible();
    await page.getByLabel("Oferecer entrega em domicílio").uncheck();
    await browserExpect(row("Entrega em domicílio").getByText("Salvo", { exact: true })).toBeVisible();
    expect((await api()).home.enabled).toBe(false);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: "../../.impeccable/review/delivery-methods-agency-mobile.png", fullPage: true, animations: "disabled" });
  } finally {
    await page.context().setOffline(false);
    if (companyId) await withTenantIsolation(companyId, async () => {
      await prisma.companyCourier.deleteMany();
      await prisma.companyDeliverySettings.deleteMany();
      await systemPrisma.user.deleteMany({ where: { email } });
      await prisma.company.delete({ where: { id: companyId } });
    });
  }
});

test("seller keeps the pickup text and zone draft when reloading after a conflict from another tab", async ({ page }) => {
  const email = `delivery-conflict-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  const api = async () => deliverySettingsSchema.parse(await (await page.request.get("/api/delivery-settings")).json());
  try {
    companyId = await prepareVerifiedCompany(page, { email, name: "Seller", companyName: "Conflict store", country: "PE" });
    const store = { enabled: true, pickupPoint: { name: "Tienda Cercado", address: "Calle Mercaderes 210", instructions: null } };
    expect((await page.request.put("/api/delivery-settings", { data: { expectedVersion: 0, home: { enabled: false }, agency: { enabled: true }, store } })).ok()).toBe(true);
    await page.goto("/es-PE/settings/delivery");
    await browserExpect(page.getByLabel("Ofrecer envío a agencia")).toBeChecked();
    await page.getByRole("button", { name: "Agregar zona", exact: true }).click();
    await page.getByLabel("Nombre de la zona", { exact: true }).fill("Borrador de zona");

    // Another tab turns agency off while this one still has the old version.
    const current = await api();
    expect((await page.request.put("/api/delivery-settings", { data: { expectedVersion: current.version, home: current.home, agency: { enabled: false }, store: current.store } })).ok()).toBe(true);
    await page.getByLabel("Ofrecer entrega a domicilio").click();
    await browserExpect(page.getByRole("alert")).toContainText("Otra persona cambió la configuración. Recarga para ver los cambios.");
    // Typed after the conflict, so the pickup timer cannot race the home click; the switches stay disabled meanwhile.
    await page.getByLabel("Dirección", { exact: true }).fill("Av. Ejército 101");
    await browserExpect(page.getByLabel("Ofrecer entrega a domicilio")).not.toBeChecked();
    await browserExpect(page.getByLabel("Ofrecer envío a agencia")).toBeDisabled();
    await page.getByRole("button", { name: "Recargar configuración", exact: true }).click();
    await browserExpect(page.getByLabel("Ofrecer envío a agencia")).not.toBeChecked();
    await browserExpect(page.getByLabel("Ofrecer envío a agencia")).toBeEnabled();
    await browserExpect(page.getByLabel("Dirección", { exact: true })).toHaveValue("Av. Ejército 101");
    await browserExpect(page.getByLabel("Nombre de la zona", { exact: true })).toHaveValue("Borrador de zona");
    // The text left unsaved by the conflict saves after the reload without another blur or keystroke.
    await browserExpect.poll(async () => (await api()).store.pickupPoint?.address).toBe("Av. Ejército 101");
    await page.getByLabel("Ofrecer entrega a domicilio").check();
    await browserExpect(page.getByRole("region", { name: "Entrega a domicilio", exact: true }).getByText("Guardado", { exact: true })).toBeVisible();
    expect((await api()).home.enabled).toBe(true);

    // A lost response reverts to the last confirmed state, never says "Guardado", and retrying an applied save ends in the conflict notice.
    await page.route("**/settings/delivery.data*", async route => { if (route.request().method() === "POST") { await route.fetch(); await route.abort(); } else await route.continue(); });
    await page.getByLabel("Ofrecer envío a agencia").check({ noWaitAfter: true });
    await browserExpect(page.getByText("No pudimos confirmar el guardado.", { exact: true })).toBeVisible();
    await browserExpect(page.getByLabel("Ofrecer envío a agencia")).not.toBeChecked();
    await browserExpect(page.getByRole("region", { name: "Envío a agencia", exact: true }).getByText("Guardado", { exact: true })).toHaveCount(0);
    await page.unroute("**/settings/delivery.data*");
    await page.getByRole("button", { name: "Reintentar", exact: true }).click();
    await browserExpect(page.getByRole("alert")).toContainText("Otra persona cambió la configuración");
    expect((await api()).agency.enabled).toBe(true);
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
  const pickDistrict = async (code: string, selectedText: string) => {
    const listbox = page.getByRole("listbox");
    await page.getByLabel("Distritos", { exact: true }).fill(code);
    await listbox.getByRole("option", { name: "MIRAFLORES", exact: true }).click();
    // Picking closes the list; never press Escape afterwards, because Escape on a closed multiple combobox clears the selection.
    await browserExpect(listbox).toBeHidden();
    await browserExpect(page.getByText(selectedText, { exact: true })).toBeVisible();
  };
  try {
    companyId = await prepareVerifiedCompany(page, { email, name: "Seller", companyName: "Zones store", country: "PE" });
    await page.goto("/es-PE/settings/delivery");
    await page.getByLabel("Ofrecer entrega a domicilio").check();
    await browserExpect(page.getByText("Guardado", { exact: true })).toBeVisible();
    // The coverage warning lives next to the switch, not in the zones section.
    await browserExpect(page.getByRole("region", { name: "Entrega a domicilio", exact: true }).getByText("Falta una opción de domicilio activa con cobertura")).toBeVisible();
    await browserExpect(page.getByRole("region", { name: "Zonas y tarifas de envío" }).getByText("Falta una opción de domicilio activa con cobertura")).toHaveCount(0);
    for (const [name, option, price] of [["Cercana", "Moto", "8"], ["Extendida", "Camión", "12"]]) {
      await page.getByRole("button", { name: "Agregar zona", exact: true }).click();
      await page.getByLabel("Nombre de la zona", { exact: true }).fill(name);
      await page.getByLabel("Departamento", { exact: true }).selectOption("15");
      await page.getByLabel("Provincia", { exact: true }).selectOption("1501");
      await pickDistrict("150122", "1 distrito seleccionado");
      if (name === "Cercana") {
        await page.getByLabel("Departamento", { exact: true }).selectOption("04");
        await page.getByLabel("Provincia", { exact: true }).selectOption("0401");
        await pickDistrict("040110", "2 distritos seleccionados");
      }
      await page.getByRole("button", { name: "Agregar opción a domicilio", exact: true }).click();
      await page.getByLabel("Nombre que ve el cliente", { exact: true }).fill(option);
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
    expect((await page.request.post("/api/orders", { data: { id: orderId, items: [{ variantId, quantity: 1 }] } })).status()).toBe(201);
    const owner = companyId;
    await withTenantIsolation(owner, async () => { await prisma.company.update({ where: { id: owner }, data: { catalogSubdomain: subdomainOf(owner) } }); });
    const enabled = await page.request.post(`/api/orders/${orderId}/checkout-link`);
    expect(enabled.ok()).toBe(true);
    const buyerPage = await buyer.newPage();
    await buyerPage.goto((await enabled.json()).url);
    await chooseDistrict(buyerPage, "150122");
    const buyerRates = buyerPage.getByLabel("Tarifa de envío");
    await browserExpect(buyerRates.locator("option")).toHaveCount(3);
    await browserExpect(buyerRates).toContainText(/Moto · S\/\s?8[.,]00/);
    await browserExpect(buyerRates).toContainText(/Camión · S\/\s?12[.,]00/);
    await page.getByRole("button", { name: "Desactivar Cercana", exact: true }).click();
    await browserExpect(page.getByRole("button", { name: "Reactivar Cercana", exact: true })).toBeVisible();
    await chooseDistrictInProvince(buyerPage, "150101");
    await chooseDistrictInProvince(buyerPage, "150122");
    await browserExpect(buyerRates.locator("option")).toHaveCount(2);
    await browserExpect(buyerRates).toContainText(/Camión/);
    await browserExpect(buyerRates).not.toContainText(/Moto/);
    const current = await (await page.request.get("/api/delivery-settings")).json();
    const concurrent = await page.request.put("/api/delivery-settings", { data: {
      expectedVersion: current.version, home: current.home, agency: current.agency, store: current.store,
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
    await page.getByRole("button", { name: "Recargar configuración", exact: true }).click();
    await browserExpect(page.getByRole("button", { name: "Editar Extendida", exact: true })).toBeVisible();
    // The draft survives the reload and nobody changed the zone under it.
    await browserExpect(page.getByLabel("Nombre de la zona", { exact: true })).toHaveValue("Mi borrador");
    await browserExpect(page.getByText("Otra persona cambió esta zona. Revisa tu borrador antes de guardar.")).toHaveCount(0);
    await page.getByRole("button", { name: "Cancelar edición", exact: true }).click();
    await page.getByRole("button", { name: "Reactivar Cercana", exact: true }).click();
    await browserExpect(page.getByRole("button", { name: "Desactivar Cercana", exact: true })).toBeVisible();
    // Agency delivery is offered without enabling couriers first: the courier and its agencies are chosen inside the zone option.
    const courier = await seededCourier("shalom");
    agencyId = await insertAgency({ courierId: courier.id, name: "Sucursal E2E", districtCode: "150122" });
    await page.getByLabel("Ofrecer envío a agencia").check();
    await browserExpect(page.getByText("Guardado", { exact: true }).last()).toBeVisible();
    // No agency option yet: the warning sits under the switch and goes away once a zone option has an eligible agency, without reloading.
    const agencyWarning = page.getByRole("region", { name: "Envío a agencia", exact: true }).getByText("Falta una opción de agencia activa con cobertura");
    await browserExpect(agencyWarning).toBeVisible();
    await browserExpect(page.getByRole("link", { name: "Ir a zonas y tarifas" }).first()).toBeVisible();
    await page.getByRole("button", { name: "Editar Extendida", exact: true }).click();
    await page.getByRole("button", { name: "Agregar opción de agencia", exact: true }).click();
    await browserExpect(page.getByLabel("Nombre que ve el cliente", { exact: true }).last()).toHaveValue("Olva Courier");
    await page.getByLabel("Courier", { exact: true }).click();
    await page.getByRole("option", { name: "Shalom", exact: true }).click();
    await browserExpect(page.getByLabel("Nombre que ve el cliente", { exact: true }).last()).toHaveValue("Shalom");
    await page.getByLabel("Tarifa de la opción (S/)", { exact: true }).last().fill("0");
    await page.getByRole("button", { name: "Guardar zona", exact: true }).click();
    await browserExpect(page.getByText("Elige al menos una agencia de destino.", { exact: true })).toBeVisible();
    await page.getByLabel("Buscar agencia por nombre, distrito o dirección", { exact: true }).fill("e2e");
    await page.getByRole("checkbox", { name: /Sucursal E2E/ }).check();
    await browserExpect(page.getByText("1 agencia de destino elegida", { exact: true })).toBeVisible();
    for (const [width, height, device] of [[1280, 900, "desktop"], [390, 844, "mobile"]] as const) {
      await page.setViewportSize({ width, height });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: `../../.impeccable/review/delivery-zones-agency-option-${device}.png`, fullPage: true, animations: "disabled" });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole("button", { name: "Guardar zona", exact: true }).click();
    await browserExpect(page.getByText("Zona guardada.", { exact: true })).toBeVisible();
    await browserExpect(agencyWarning).toHaveCount(0);
    await browserExpect(page.getByText("Sin agencias elegibles: no se ofrece al cotizar.", { exact: true })).toBeHidden();
    expect(deliverySettingsSchema.parse(await (await page.request.get("/api/delivery-settings")).json()).couriers).toMatchObject([{ courierId: courier.id, name: "Shalom", enabled: true }]);
    const agencyQuote = await page.request.post("/api/quotations", { data: { destination: { country: "PE", districtCode: "150122" } } });
    expect((await agencyQuote.json()).rates).toMatchObject([{ method: "home" }, { method: "home" },
      { method: "agency", name: "Shalom", agencies: [{ id: agencyId, name: "Sucursal E2E", courier: { name: "Shalom" }, location: { districtCode: "150122" } }] }]);
  } finally {
    await buyer.close();
    if (companyId) await withTenantIsolation(companyId, async () => {
      await prisma.payment.deleteMany(); await prisma.orderItem.deleteMany(); await prisma.order.deleteMany();
      await prisma.productStock.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.productOption.deleteMany(); await prisma.product.deleteMany();
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

test("seller saves delivery settings behind an HTTPS-terminating proxy", async ({ page }) => {
  const email = `delivery-proxy-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    companyId = await prepareVerifiedCompany(page, { email, name: "Seller", companyName: "Proxy store", country: "PE" });
    const host = `127.0.0.1:${process.env.CORE_E2E_PORT ?? "4173"}`;
    const response = await page.request.post("/es-PE/settings/delivery.data", {
      headers: { origin: `https://${host}`, "x-forwarded-proto": "https", "content-type": "application/json" },
      data: { expectedVersion: 0, agency: { enabled: false }, home: { enabled: true }, store: { enabled: false, pickupPoint: null } },
    });
    expect(response.status()).toBe(200);
    expect(await (await page.request.get("/api/delivery-settings")).json()).toMatchObject({ version: 1, home: { enabled: true } });
  } finally {
    if (companyId) await withTenantIsolation(companyId, async () => {
      await prisma.companyDeliverySettings.deleteMany();
      await systemPrisma.user.deleteMany({ where: { email } });
      await prisma.company.delete({ where: { id: companyId } });
    });
  }
});

test("seller creates Zona sur with Arequipa and Cusco complete and a Cayma buyer gets its rate at checkout", async ({ page }) => {
  const email = `delivery-zona-sur-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  const buyer = await page.context().browser()!.newContext({ baseURL: `http://127.0.0.1:${process.env.CORE_E2E_PORT ?? "4173"}` });
  const zones = page.getByRole("region", { name: "Zonas y tarifas de envío" });
  const mark = async (department: string, name: string) => {
    await page.getByLabel("Departamento", { exact: true }).selectOption(department);
    await page.getByLabel(`Todos los distritos de ${name}`, { exact: true }).check();
  };
  try {
    companyId = await prepareVerifiedCompany(page, { email, name: "Seller", companyName: "Zona sur store", country: "PE" });
    await page.goto("/es-PE/settings/delivery");
    await page.getByLabel("Ofrecer entrega a domicilio").check();
    await browserExpect(page.getByText("Guardado", { exact: true })).toBeVisible();
    // An existing zone covers Cayma only, so Zona sur overlaps it by one district.
    const first = await page.request.put("/api/delivery-settings/zones", { data: { expectedVersion: (await (await page.request.get("/api/delivery-settings")).json()).version,
      zones: [{ kind: "new", name: "Arequipa ciudad", enabled: true, districtCodes: ["040103"],
        options: [{ kind: "new", method: "home", name: "Moto", enabled: true, price: { amount: 6, currency: "PEN" } }] }] } });
    expect(first.status()).toBe(200);
    await page.reload();

    await page.getByRole("button", { name: "Agregar zona", exact: true }).click();
    await page.getByRole("button", { name: "Guardar zona", exact: true }).click();
    await browserExpect(page.getByText("Selecciona al menos un distrito, provincia o departamento.", { exact: true })).toBeVisible();
    await page.getByLabel("Nombre de la zona", { exact: true }).fill("Zona sur");
    await mark("04", "Arequipa");
    await browserExpect(page.getByText("109 distritos seleccionados", { exact: true })).toBeVisible();
    await browserExpect(page.getByText("Arequipa ya está completo en la zona.", { exact: true })).toBeVisible();
    await browserExpect(page.getByLabel("Provincia", { exact: true })).toBeDisabled();
    await browserExpect(page.getByLabel("Distritos", { exact: true })).toBeDisabled();
    await browserExpect(page.getByText("Comparte 1 distrito con Arequipa ciudad. Esos distritos recibirán las tarifas de ambas zonas.", { exact: true })).toBeVisible();
    await mark("08", "Cusco");
    await browserExpect(page.getByText("225 distritos seleccionados: Arequipa, todos los distritos; Cusco, todos los distritos", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Agregar opción a domicilio", exact: true }).click();
    await page.getByLabel("Nombre que ve el cliente", { exact: true }).fill("Moto sur");
    await page.getByLabel("Tarifa de la opción (S/)", { exact: true }).fill("15");
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await page.getByRole("button", { name: "Guardar zona", exact: true }).click();
    await browserExpect(zones.getByText("Arequipa, todos los distritos; Cusco, todos los distritos", { exact: true })).toBeVisible();
    expect((await (await page.request.get("/api/delivery-settings/zones")).json()).zones.find((zone: { name: string }) => zone.name === "Zona sur"))
      .toMatchObject({ departmentCodes: ["04", "08"], provinceCodes: [], districtCodes: [] });

    await page.getByRole("button", { name: "Editar Zona sur", exact: true }).click();
    await browserExpect(page.getByLabel("Departamento", { exact: true })).toHaveValue("04");
    await browserExpect(page.getByLabel("Todos los distritos de Arequipa", { exact: true })).toBeChecked();
    await browserExpect(page.getByText("225 distritos seleccionados: Arequipa, todos los distritos; Cusco, todos los distritos", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Cancelar edición", exact: true }).click();

    const variantId = await withTenantIsolation(companyId, async () => {
      const created = await products.create({ name: "Sur product", currency: "PEN", variants: [{ attributes: {}, salePrice: 10, initialStock: 3 }] });
      if (!created.success) throw new Error(created.error.message);
      return (await prisma.productVariant.findFirstOrThrow({ where: { productId: created.data } })).id;
    });
    const orderId = crypto.randomUUID();
    expect((await page.request.post("/api/orders", { data: { id: orderId, items: [{ variantId, quantity: 1 }] } })).status()).toBe(201);
    const owner = companyId;
    await withTenantIsolation(owner, async () => { await prisma.company.update({ where: { id: owner }, data: { catalogSubdomain: subdomainOf(owner) } }); });
    const link = await page.request.post(`/api/orders/${orderId}/checkout-link`);
    expect(link.ok()).toBe(true);
    const buyerPage = await buyer.newPage();
    await buyerPage.goto((await link.json()).url);
    await chooseDistrict(buyerPage, "040103");
    const rates = buyerPage.getByLabel("Tarifa de envío");
    await browserExpect(rates).toContainText(/Moto sur · S\/\s?15[.,]00/);
    await browserExpect(rates).toContainText(/Moto · S\/\s?6[.,]00/);
  } finally {
    await buyer.close();
    if (companyId) await withTenantIsolation(companyId, async () => {
      await prisma.payment.deleteMany(); await prisma.orderItem.deleteMany(); await prisma.order.deleteMany();
      await prisma.productStock.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.productOption.deleteMany(); await prisma.product.deleteMany();
      await prisma.deliveryRate.deleteMany(); await prisma.quotation.deleteMany();
      await prisma.deliveryOptionAgency.deleteMany(); await prisma.deliveryOption.deleteMany();
      await prisma.deliveryZoneDistrict.deleteMany(); await prisma.deliveryZoneProvince.deleteMany(); await prisma.deliveryZoneDepartment.deleteMany();
      await prisma.deliveryZone.deleteMany(); await prisma.companyCourier.deleteMany(); await prisma.companyDeliverySettings.deleteMany();
      await systemPrisma.user.deleteMany({ where: { email } });
      await prisma.company.delete({ where: { id: companyId } });
    });
  }
});
