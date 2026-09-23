import { expect, test } from "@playwright/test";

test("legacy web routes preserve query parameters when redirecting", async ({ request }) => {
  for (const path of ["/", "/login", "/register", "/dashboard"]) {
    for (const search of ["", "?source=old&next=%2Fdashboard&tag=one&tag=two"]) {
      const response = await request.get(`${path}${search}`, { maxRedirects: 0 });
      expect(response.status()).toBe(308);
      expect(response.headers().location).toBe(`/es-PE${path}${search}`);
    }
  }
});

test("public navigation stays under es-PE", async ({ page }) => {
  await page.goto("/es-PE/");
  await expect(page.locator("html")).toHaveAttribute("lang", "es-PE");
  await page.getByRole("link", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/es-PE\/login$/);
  await page.getByRole("link", { name: "Regístrate" }).click();
  await expect(page).toHaveURL(/\/es-PE\/register$/);
  await page.getByRole("link", { name: "Inicia sesión" }).click();
  await expect(page).toHaveURL(/\/es-PE\/login$/);
  await page.getByRole("link", { name: "Yoyos" }).click();
  await expect(page).toHaveURL(/\/es-PE\/$/);
});
