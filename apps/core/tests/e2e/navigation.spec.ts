import { browserExpect, expect, prepareVerifiedCompany, test } from "./fixtures";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

test("home preserves query parameters when redirecting", async ({ request }) => {
  for (const path of ["/"]) {
    for (const search of ["", "?source=old&next=%2Fdashboard&tag=one&tag=two"]) {
      const response = await request.get(`${path}${search}`, { maxRedirects: 0 });
      expect(response.status()).toBe(308);
      expect(response.headers().location).toBe(`/es-PE/${search}`);
    }
  }
});

test("public routes accept supported locales and reject unknown locales", async ({ page }) => {
  for (const locale of ["", "es-PE", "es-US", "es-CO", "es-AR", "es-CL", "es-BR"]) {
    for (const path of ["login", "register"]) {
      const prefix = locale ? `/${locale}` : "";
      await page.goto(`${prefix}/${path}`);
      await browserExpect(page.locator("html")).toHaveAttribute("lang", locale || "es");
      await browserExpect(page).toHaveURL(new RegExp(`${prefix}/${path}$`));
    }
  }
  expect((await page.request.get("/es-ZZ/login")).status()).toBe(404);
  expect((await page.request.get("/es-ZZ/register")).status()).toBe(404);
});

test("public navigation works from localized home", async ({ page }) => {
  await page.goto("/es-PE/");
  await browserExpect(page.locator("html")).toHaveAttribute("lang", "es-PE");
  await page.getByRole("link", { name: "Iniciar sesión" }).click();
  await browserExpect(page).toHaveURL(/\/login$/);
  await page.getByRole("link", { name: "Regístrate" }).click();
  await browserExpect(page).toHaveURL(/\/register$/);
  await page.getByRole("link", { name: "Inicia sesión" }).click();
  await browserExpect(page).toHaveURL(/\/login$/);
  await page.getByRole("link", { name: "Yoyos" }).click();
  await browserExpect(page).toHaveURL(/\/es-PE\/$/);
});

test("Portuguese navigation keeps its route locale", async ({ page }) => {
  await page.goto("/pt-BR/");
  await browserExpect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
  await page.getByRole("link", { name: "Entrar" }).click();
  await browserExpect(page).toHaveURL(/\/pt-BR\/login$/);
  await browserExpect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
  await page.getByRole("link", { name: "Cadastre-se" }).click();
  await browserExpect(page).toHaveURL(/\/pt-BR\/register$/);
  await browserExpect(page.getByRole("heading", { name: "Criar conta" })).toBeVisible();
  await page.getByRole("link", { name: "Entre" }).click();
  await browserExpect(page).toHaveURL(/\/pt-BR\/login$/);
});

test("private Portuguese views preserve the locale", async ({ page }) => {
  const email = `pt-navigation-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    companyId = await prepareVerifiedCompany(page, { email, name: "Ana", companyName: "Loja Ana", country: "PE" });
    await page.goto("/pt-BR/dashboard");
    await browserExpect(page).toHaveURL(/\/pt-BR\/dashboard$/);
    await browserExpect(page.getByRole("heading", { name: "Olá, Ana" })).toBeVisible();
    await page.getByRole("complementary").getByRole("link", { name: "Produtos" }).click();
    await browserExpect(page).toHaveURL(/\/pt-BR\/products$/);
    await browserExpect(page.getByRole("heading", { name: /Produtos/ })).toBeVisible();
    await page.getByRole("complementary").getByRole("link", { name: "Vendas" }).click();
    await browserExpect(page).toHaveURL(/\/pt-BR\/orders$/);
  } finally {
    await systemPrisma.user.deleteMany({ where: { email } });
    if (companyId) await withTenantIsolation(companyId, async () => { await prisma.company.deleteMany({ where: { id: companyId } }); });
  }
});
