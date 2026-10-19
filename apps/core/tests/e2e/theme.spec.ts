import { browserExpect, prepareVerifiedCompany, test } from "./fixtures";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

test("system preference, manual selection, persistence, and keyboard activation", async ({ page }) => {
  const email = `theme-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    companyId = await prepareVerifiedCompany(page, { email, name: "Ana", companyName: "Tienda Ana", country: "PE" });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/es-PE/dashboard");
    await page.evaluate(() => localStorage.removeItem("yoyos-theme"));
    await page.reload();
    await browserExpect(page.locator("body")).toHaveCSS("background-color", "rgb(28, 27, 29)");

    await page.emulateMedia({ colorScheme: "light" });
    await browserExpect(page.locator("body")).toHaveCSS("background-color", "rgb(247, 244, 239)");

    const themeButton = page.getByRole("complementary").getByRole("button", { name: "Alternar tema" });
    await themeButton.click();
    await browserExpect.poll(() => page.evaluate(() => localStorage.getItem("yoyos-theme"))).toBe("dark");
    await page.reload();
    await browserExpect(page.locator("html")).toHaveClass(/dark/);

    await themeButton.focus();
    await page.keyboard.press("Enter");
    await browserExpect.poll(() => page.evaluate(() => localStorage.getItem("yoyos-theme"))).toBe("light");
  } finally {
    await systemPrisma.user.deleteMany({ where: { email } });
    if (companyId) await withTenantIsolation(companyId, async () => { await prisma.company.deleteMany({ where: { id: companyId } }); });
  }
});
