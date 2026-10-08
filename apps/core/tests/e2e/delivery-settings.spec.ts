import { deliverySettingsSchema } from "@shared/contracts/delivery-settings";
import { mkdir } from "node:fs/promises";
import { browserExpect, expect, prepareVerifiedCompany, test } from "@core/tests/e2e/fixtures";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

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
    await page.getByRole("button", { name: "Adicionar transportadora" }).click();
    await page.getByRole("tab", { name: "Loja", exact: false }).click();
    await page.getByRole("button", { name: "Salvar configuração" }).click();
    await browserExpect(page.getByLabel("Nome da transportadora 1")).toBeFocused();
    await browserExpect(page.getByLabel("Nome da transportadora 1")).toHaveAttribute("aria-invalid", "true");
    await page.getByLabel("Nome da transportadora 1").fill("Discard");
    await page.getByRole("button", { name: "Adicionar transportadora" }).click();
    await page.getByLabel("Nome da transportadora 2").fill("Active courier");
    await page.getByRole("button", { name: "Adicionar transportadora" }).click();
    await page.getByLabel("Nome da transportadora 3").fill("Inactive courier");
    await page.getByRole("button", { name: "Remover transportadora 1 não salva" }).click();
    await browserExpect(page.getByLabel("Nome da transportadora 1")).toHaveValue("Active courier");
    await browserExpect(page.getByLabel("Nome da transportadora 2")).toHaveValue("Inactive courier");
    await page.getByLabel("Habilitar transportadora 2").uncheck();
    const agencySaved = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname.includes("/settings/delivery"));
    await page.getByRole("button", { name: "Salvar configuração" }).click();
    await agencySaved;
    const agencySettings = deliverySettingsSchema.parse(await (await page.request.get("/api/delivery-settings")).json());
    expect(agencySettings).toMatchObject({ version: 5, agency: { enabled: true }, couriers: expect.arrayContaining([expect.objectContaining({ name: "Active courier", enabled: true }), expect.objectContaining({ name: "Inactive courier", enabled: false })]) });
    expect(agencySettings.couriers).toHaveLength(2);
    await browserExpect(page.getByText("Remover cadastro não salvo")).toHaveCount(0);
    await page.getByRole("tab", { name: "Domicílio", exact: false }).click();
    await page.getByLabel("Oferecer entrega em domicílio").uncheck();
    const preserved = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname.includes("/settings/delivery"));
    await page.getByRole("button", { name: "Salvar configuração" }).click();
    await preserved;
    expect(await (await page.request.get("/api/delivery-settings")).json()).toEqual({ ...agencySettings, version: 6, home: { enabled: false }, couriers: expect.arrayContaining(agencySettings.couriers) });
    await page.getByRole("tab", { name: "Agência", exact: false }).click();
    await page.getByLabel("Habilitar transportadora 1").uncheck();
    await page.getByRole("tab", { name: "Domicílio", exact: false }).click();
    await page.getByRole("button", { name: "Salvar configuração" }).click();
    await browserExpect(page.getByRole("alert")).toContainText("habilite pelo menos uma transportadora");
    expect(await (await page.request.get("/api/delivery-settings")).json()).toMatchObject({ version: 6, agency: { enabled: true } });
    await browserExpect(page.getByLabel("Habilitar transportadora 1")).not.toBeChecked();
    await page.getByLabel("Oferecer envio para agência").uncheck();
    const disabled = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname.includes("/settings/delivery"));
    await page.getByRole("button", { name: "Salvar configuração" }).click();
    await disabled;
    expect(await (await page.request.get("/api/delivery-settings")).json()).toMatchObject({ version: 7, agency: { enabled: false }, couriers: expect.arrayContaining(agencySettings.couriers.map(courier => ({ ...courier, enabled: false }))) });
    await page.getByLabel("Habilitar transportadora 1").check();
    await page.getByLabel("Oferecer envio para agência").check();
    const enabledAgain = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname.includes("/settings/delivery"));
    await page.getByRole("button", { name: "Salvar configuração" }).click();
    await enabledAgain;
    const current = deliverySettingsSchema.parse(await (await page.request.get("/api/delivery-settings")).json());
    await page.getByLabel("Nome da transportadora 1").fill("My rename");
    await page.getByRole("button", { name: "Adicionar transportadora" }).click();
    await page.getByLabel("Nome da transportadora 3").fill("My new courier");
    expect((await page.request.put("/api/delivery-settings", { data: { expectedVersion: current.version, home: current.home, store: current.store, agency: current.agency,
      couriers: current.couriers.map(courier => ({ ...courier, kind: "existing", name: "Concurrent " + courier.name })) } })).ok()).toBe(true);
    await page.getByRole("button", { name: "Salvar configuração" }).click();
    await browserExpect(page.getByRole("alert")).toContainText("Outra pessoa alterou");
    await browserExpect(page.getByLabel("Nome da transportadora 1")).toHaveValue("My rename");
    await browserExpect(page.getByLabel("Nome da transportadora 3")).toHaveValue("My new courier");
    await browserExpect(page.getByRole("button", { name: "Salvar configuração" })).toBeDisabled();
    await page.getByRole("link", { name: "Recarregar configuração" }).click();
    await page.getByRole("tab", { name: "Agência", exact: false }).click();
    await browserExpect(page.getByLabel("Nome da transportadora 3")).toHaveCount(0);
    await browserExpect(page.getByLabel("Nome da transportadora 1")).toHaveValue(/^Concurrent /);
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

test("seller manages overlapping home zones and preserves an edit on a shared-version conflict", async ({ page }) => {
  const email = `delivery-zones-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    companyId = await prepareVerifiedCompany(page, { email, name: "Seller", companyName: "Zones store", country: "PE" });
    await page.goto("/es-PE/settings/delivery");
    await page.getByRole("tab", { name: "Domicilio", exact: false }).click();
    await page.getByLabel("Ofrecer entrega a domicilio").check();
    await page.getByRole("button", { name: "Guardar configuración", exact: true }).click();
    await browserExpect(page.getByText("Configuración guardada.", { exact: true })).toBeVisible();
    await browserExpect(page.getByText("Falta configurar cobertura", { exact: true })).toBeVisible();
    for (const [name, price] of [["Cercana", "8"], ["Extendida", "12"]]) {
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
        await page.getByLabel("Departamento", { exact: true }).selectOption("15");
        await page.getByLabel("Provincia", { exact: true }).selectOption("1501");
        await page.getByLabel("Buscar distrito", { exact: true }).fill("150122");
        await browserExpect(page.getByRole("checkbox", { name: "MIRAFLORES · 150122", exact: true })).toBeChecked();
      }
      await page.getByLabel("Tarifa por pedido (S/)", { exact: true }).fill(price);
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
    const quote = await page.request.post("/api/quotations", { data: { destination: { country: "PE", districtCode: "150122" } } });
    expect(quote.status()).toBe(201);
    expect((await quote.json()).rates.map((rate: { price: { amount: number } }) => rate.price.amount)).toEqual([8, 12]);
    await page.getByRole("button", { name: "Desactivar Cercana", exact: true }).click();
    await browserExpect(page.getByRole("button", { name: "Reactivar Cercana", exact: true })).toBeVisible();
    const remaining = await page.request.post("/api/quotations", { data: { destination: { country: "PE", districtCode: "150122" } } });
    expect((await remaining.json()).rates.map((rate: { price: { amount: number } }) => rate.price.amount)).toEqual([12]);
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
    await browserExpect(page.getByLabel("Tarifa por pedido (S/)", { exact: true })).toHaveValue("12");
    await browserExpect(page.getByRole("button", { name: "Guardar zona", exact: true })).toBeDisabled();
    const stored = await (await page.request.get("/api/delivery-settings/zones")).json();
    expect(stored.zones.map((zone: { name: string }) => zone.name).sort()).toEqual(["Cercana", "Extendida"]);
    expect(stored.zones.find((zone: { name: string }) => zone.name === "Cercana")).toMatchObject({ enabled: false, districtCodes: ["040110", "150122"] });
    await page.getByRole("link", { name: "Recargar configuración", exact: true }).click();
    await page.getByRole("tab", { name: "Domicilio", exact: false }).click();
    await browserExpect(page.getByRole("button", { name: "Editar Extendida", exact: true })).toBeVisible();
  } finally {
    if (companyId) await withTenantIsolation(companyId, async () => {
      await prisma.deliveryRate.deleteMany();
      await prisma.quotation.deleteMany();
      await prisma.deliveryZoneDistrict.deleteMany();
      await prisma.deliveryZone.deleteMany();
      await prisma.companyCourier.deleteMany();
      await prisma.companyDeliverySettings.deleteMany();
      await systemPrisma.user.deleteMany({ where: { email } });
      await prisma.company.delete({ where: { id: companyId } });
    });
  }
});
