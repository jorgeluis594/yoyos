// From the repository root, run against the built app with: playwright-cli run-code --filename apps/core/tests/theme.browser.js
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
async (page) => {
  const state = () => page.evaluate(() => ({
    dark: document.documentElement.classList.contains("dark"),
    saved: localStorage.getItem("yoyos-theme"),
    background: getComputedStyle(document.body).backgroundColor,
  }));
  const check = (condition, message) => { if (!condition) throw new Error(message); };

  await page.evaluate(() => localStorage.removeItem("yoyos-theme"));
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  await page.waitForFunction(() => document.querySelector("button")?.getAttribute("aria-pressed") === "true");
  check((await state()).background === "rgb(28, 27, 29)", "System dark palette did not load");

  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForFunction(() => !document.documentElement.classList.contains("dark"));
  check((await state()).background === "rgb(247, 244, 239)", "System light palette did not load");

  await page.getByRole("button", { name: "Alternar tema" }).click();
  check((await state()).saved === "dark", "Manual selection was not stored");
  await page.reload();
  check((await state()).dark, "Manual selection was not restored");

  await page.keyboard.press("Tab");
  check(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Alternar tema"), "Theme button is not keyboard focusable");
  await page.keyboard.press("Enter");
  check((await state()).saved === "light", "Keyboard activation did not change theme");
  return "Theme browser checks passed";
}
