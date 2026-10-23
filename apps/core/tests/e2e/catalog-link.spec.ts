import { describe } from "vitest";
import type { Page } from "@playwright/test";
import { browserExpect, expect, prepareVerifiedCompany, test } from "@core/tests/e2e/fixtures";
import { prisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

const domain = `localhost:${process.env.CORE_E2E_PORT ?? "4173"}`;
const origin = `http://127.0.0.1:${process.env.CORE_E2E_PORT ?? "4173"}`;
const unique = () => `e${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
const storedSubdomain = (companyId: string) => withTenantIsolation(companyId, async () =>
  (await prisma.company.findUnique({ where: { id: companyId }, select: { catalogSubdomain: true, catalogPublished: true } })));

/** The company name is the suggestion, so each run uses its own name: the suggestion is never taken by an earlier run's company. */
async function openEditor(page: Page, suffix = unique()) {
  const companyId = await prepareVerifiedCompany(page, { email: `link-${crypto.randomUUID()}@example.test`, name: "Vendedora", companyName: `Tienda ${suffix}`, country: "PE" });
  await page.goto("/es-PE/settings/store-appearance", { waitUntil: "networkidle" });
  await browserExpect(page.getByRole("heading", { name: "Apariencia de la tienda", level: 1 })).toBeVisible();
  return { companyId, suggestion: `tienda-${suffix}` };
}

describe("catalog link", () => {
  test("a seller chooses, saves, publishes and copies the brand link, and Settings → Catálogo shows it in full", async ({ page }) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin });
    const { companyId, suggestion } = await openEditor(page);
    const field = page.getByLabel("Link de tu catálogo", { exact: true });
    const status = page.locator("#catalog-subdomain-status");
    const publish = page.getByRole("switch", { name: "Publicar catálogo" });

    // The company name is the suggestion, free at this moment, and publishing waits for a saved link.
    await browserExpect(field).toHaveValue(suggestion);
    await browserExpect(status).toHaveText(`${suggestion}.${domain} está disponible`);
    await browserExpect(publish).toBeDisabled();
    await browserExpect(page.getByText("Elige el link de tu catálogo para poder publicarlo.")).toBeVisible();

    const name = unique();
    await field.fill(name.toUpperCase());
    await browserExpect(field).toHaveValue(name);
    await browserExpect(status).toHaveText(`${name}.${domain} está disponible`);
    await field.press("Enter");
    await browserExpect(status).toHaveText("Link guardado");
    await browserExpect(page.getByText(`Tu link: http://${name}.${domain}/`)).toBeVisible();
    expect(await storedSubdomain(companyId)).toEqual({ catalogSubdomain: name, catalogPublished: false });
    await browserExpect(page.getByRole("button", { name: "Copiar link" })).toHaveCount(0);

    await browserExpect(publish).toBeEnabled();
    await publish.click();
    await browserExpect(page.getByText("Catálogo publicado")).toBeVisible();
    await page.getByRole("button", { name: "Copiar link" }).click();
    await browserExpect(page.getByText("Link copiado")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`http://${name}.${domain}/`);

    await page.goto("/es-PE/settings/catalog", { waitUntil: "networkidle" });
    await browserExpect(page.getByText(`http://${name}.${domain}/`, { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Ir a Apariencia de la tienda" }).click();
    await browserExpect(page).toHaveURL(/\/settings\/store-appearance#catalog-publication$/);
    await browserExpect(page.locator("#catalog-publication")).toBeInViewport();
    await browserExpect(field).not.toBeFocused();
  });

  test("with the network cut, the check and the save show their messages inside the card and keep the editor and the typed link", async ({ page }) => {
    const { companyId, suggestion } = await openEditor(page);
    const field = page.getByLabel("Link de tu catálogo", { exact: true });
    const status = page.locator("#catalog-subdomain-status");
    const name = unique();

    await browserExpect(status).toHaveText(`${suggestion}.${domain} está disponible`);
    await page.context().setOffline(true);
    await field.fill(name);
    await browserExpect(status).toContainText("No pudimos revisar si está disponible.");
    await page.getByRole("button", { name: "Guardar link" }).click();
    await browserExpect(status).toHaveText("No pudimos guardar tu link. Revisa tu conexión.");
    await browserExpect(field).toHaveValue(name);
    await browserExpect(page.getByRole("heading", { name: "Apariencia de la tienda", level: 1 })).toBeVisible();
    await browserExpect(page.getByText("No se pudo cargar la apariencia")).toHaveCount(0);

    await page.context().setOffline(false);
    await page.getByRole("button", { name: "Reintentar" }).click();
    await browserExpect(status).toHaveText("Link guardado");
    expect((await storedSubdomain(companyId))?.catalogSubdomain).toBe(name);
  });

  test("changing a saved link asks first, keeps the typed value on Mantener link actual and releases the old link on Cambiar link", async ({ page }) => {
    const { companyId } = await openEditor(page);
    const field = page.getByLabel("Link de tu catálogo", { exact: true });
    const first = unique();
    const second = unique();
    await field.fill(first);
    await browserExpect(page.locator("#catalog-subdomain-status")).toHaveText(`${first}.${domain} está disponible`);
    await page.getByRole("button", { name: "Guardar link" }).click();
    await browserExpect(page.locator("#catalog-subdomain-status")).toHaveText("Link guardado");

    await field.fill(second);
    await browserExpect(page.locator("#catalog-subdomain-status")).toHaveText(`${second}.${domain} está disponible`);
    await page.getByRole("button", { name: "Guardar link" }).click();
    await browserExpect(page.getByRole("heading", { name: "¿Cambiar el link de tu catálogo?" })).toBeVisible();
    await page.getByRole("button", { name: "Mantener link actual" }).click();
    await browserExpect(page.getByRole("button", { name: "Guardar link" })).toBeFocused();
    await browserExpect(field).toHaveValue(second);
    expect((await storedSubdomain(companyId))?.catalogSubdomain).toBe(first);

    await page.getByRole("button", { name: "Guardar link" }).click();
    await page.getByRole("button", { name: "Cambiar link" }).click();
    await browserExpect(page.locator("#catalog-subdomain-status")).toHaveText("Link guardado");
    await browserExpect(field).toBeFocused();
    expect((await storedSubdomain(companyId))?.catalogSubdomain).toBe(second);
  });
});
