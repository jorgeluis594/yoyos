import { browserExpect, test } from "./fixtures";

test("system preference, manual selection, persistence, and keyboard activation", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/es-PE/");
  await page.evaluate(() => localStorage.removeItem("yoyos-theme"));
  await page.reload();
  await browserExpect(page.locator("body")).toHaveCSS("background-color", "rgb(28, 27, 29)");

  await page.emulateMedia({ colorScheme: "light" });
  await browserExpect(page.locator("body")).toHaveCSS("background-color", "rgb(247, 244, 239)");

  const themeButton = page.getByRole("button", { name: "Alternar tema" });
  await themeButton.click();
  await browserExpect.poll(() => page.evaluate(() => localStorage.getItem("yoyos-theme"))).toBe("dark");
  await page.reload();
  await browserExpect(page.locator("html")).toHaveClass(/dark/);

  await page.getByRole("link", { name: "Iniciar sesión" }).focus();
  await page.keyboard.press("Tab");
  await browserExpect(themeButton).toBeFocused();
  await page.keyboard.press("Enter");
  await browserExpect.poll(() => page.evaluate(() => localStorage.getItem("yoyos-theme"))).toBe("light");
});
