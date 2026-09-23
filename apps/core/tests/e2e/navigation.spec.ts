import { browserExpect, expect, test } from "./fixtures";

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
