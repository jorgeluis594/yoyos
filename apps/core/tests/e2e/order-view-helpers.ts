import type { Page } from "@playwright/test";

/** Adds one unit of a product to the order through the floating picker, the way a seller does: open it, search, press the chip or «Agregar», press «Listo». */
export async function addToOrder(page: Page, productName: string, variant?: string) {
  await page.getByRole("button", { name: "Agregar producto" }).click();
  const picker = page.getByRole("dialog");
  await picker.getByRole("combobox", { name: "Buscar producto" }).fill(productName);
  const group = picker.getByRole("group", { name: productName });
  await (variant ? group.getByRole("option", { name: new RegExp(`^${variant},`) }) : group.getByRole("option", { name: "Agregar", exact: true })).click();
  await picker.getByRole("button", { name: /^Listo/ }).click();
  await picker.waitFor({ state: "hidden" });
}

/** The «Total» amount of the totals under the products, not the one the sticky bar repeats. */
export const orderTotal = (page: Page) => page.locator("dl dt", { hasText: /^Total$/ }).locator("xpath=following-sibling::dd");
