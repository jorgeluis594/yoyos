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
    await browserExpect(page.getByLabel("Ofrecer entrega a domicilio")).not.toBeChecked();
    await page.getByLabel("Ofrecer entrega a domicilio").check();
    await page.getByLabel("Ofrecer recojo en tienda").check();
    await page.getByLabel("Nombre del punto de recojo").fill("Tienda principal");
    await page.getByLabel("Dirección", { exact: true }).fill("Av. Lima 123");
    await page.getByLabel("Indicaciones (opcional)").fill("Puerta lateral");
    await page.getByRole("button", { name: "Guardar configuración" }).click();
    await browserExpect(page.getByRole("status")).toHaveText("Configuración guardada.");
    const saved = await page.request.get("/api/delivery-settings");
    expect(await saved.json()).toMatchObject({ version: 1, agency: { enabled: false }, couriers: [], home: { enabled: true }, store: { enabled: true, pickupPoint: { address: "Av. Lima 123" } } });
    await page.getByLabel("Dirección", { exact: true }).fill("Mi borrador");
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
    await browserExpect(page.getByRole("status")).toHaveText("Configuración guardada.");
    expect(await (await page.request.get("/api/delivery-settings")).json()).toMatchObject({ version: 3,
      agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: false, pickupPoint: { address: "Dirección concurrente" } } });
    await page.getByLabel("Ofrecer entrega a domicilio").check();
    const homeSaved = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname.includes("/settings/delivery"));
    await page.getByRole("button", { name: "Guardar configuración" }).click();
    await homeSaved;
    await browserExpect(page.getByRole("button", { name: "Guardar configuración" })).toBeEnabled();
    await browserExpect(page.getByRole("status")).toHaveText("Configuración guardada.");
    expect(await (await page.request.get("/api/delivery-settings")).json()).toMatchObject({ version: 4, agency: { enabled: false }, couriers: [], home: { enabled: true }, store: { enabled: false, pickupPoint: { address: "Dirección concurrente" } } });
    await mkdir("../../.impeccable/review", { recursive: true });
    await page.screenshot({ path: "../../.impeccable/review/delivery-settings-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: "../../.impeccable/review/delivery-settings-mobile.png", fullPage: true });
    await page.goto("/pt-BR/settings/delivery");
    await browserExpect(page.getByLabel("Oferecer retirada na loja")).not.toBeChecked();
    await browserExpect(page.getByLabel("Oferecer entrega em domicílio")).toBeChecked();
    await browserExpect(page.getByLabel("Endereço", { exact: true })).toHaveValue("Dirección concurrente");
    const current = deliverySettingsSchema.parse(await (await page.request.get("/api/delivery-settings")).json());
    const agencySave = await page.request.put("/api/delivery-settings", { data: { expectedVersion: current.version, home: current.home, store: current.store, agency: { enabled: true },
      couriers: [{ kind: "new", name: "Active courier", enabled: true }, { kind: "new", name: "Inactive courier", enabled: false }] } });
    expect(agencySave.ok()).toBe(true);
    const agencySettings = deliverySettingsSchema.parse(await agencySave.json());
    await page.reload();
    await page.getByLabel("Oferecer entrega em domicílio").uncheck();
    const preserved = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname.includes("/settings/delivery"));
    await page.getByRole("button", { name: "Salvar configuração" }).click();
    await preserved;
    expect(await (await page.request.get("/api/delivery-settings")).json()).toEqual({ ...agencySettings, version: 6, home: { enabled: false }, couriers: expect.arrayContaining(agencySettings.couriers) });

  } finally {
    if (companyId) await withTenantIsolation(companyId, async () => {
      await prisma.companyCourier.deleteMany();
      await prisma.companyDeliverySettings.deleteMany();
      await systemPrisma.user.deleteMany({ where: { email } });
      await prisma.company.delete({ where: { id: companyId } });
    });
  }
});
